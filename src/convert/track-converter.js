import { readPod2, readEntry, resolveEntry } from "../formats/pod2-reader.js";
import { writePod1, validatePod1 } from "../formats/pod1-writer.js";
import { parseEvoSit } from "../formats/evo/evo-sit-parser.js";
import { parseEvoLvl } from "../formats/evo/evo-lvl-parser.js";
import { parseEvoTex } from "../formats/evo/evo-tex-parser.js";
import { parseEvoVeg } from "../formats/evo/veg-parser.js";
import { decodeSmfModel } from "../formats/evo/smf-parser.js";
import { decodeEvoImage } from "../formats/evo/evo-image.js";
import { replaceExtension, safeStem, stem, title } from "../shared/paths.js";
import { convertTerrain, convertClr } from "./terrain.js";
import { encodePng } from "./png.js";
import { writeMtmBin } from "./bin-writer.js";
import { terrainBmp } from "./bmp.js";
import { createMtmPalette, makeFogMap, sampleForPalette } from "./palette.js";
import { quantizeToRawAct } from "./raw-act.js";
import { writeTrackFiles } from "../formats/mtm2/track-writer.js";
import { BUILD_ID } from "../build-info.js";

/*
  Conversion options, as the four checkboxes above the Convert button state them.

  `hdArt` off means the pod carries no PNG at all, which is not the same thing as `rawFallback`
  on - one chooses what the engine draws, the other only adds the pair a stock install needs.
  Either way, the moment the legacy pair is packed the situation file becomes .SIT; see the
  block in track-writer.js for why that extension is a promise rather than a label.
*/
const DEFAULT_OPTIONS = {
  hdArt: true,
  rawFallback: false,
  vegetationNonCollide: true,
  allObjectsNonCollide: false,
};

export async function convertTrack(file, report = () => {}, requested = {}) {
  const options = { ...DEFAULT_OPTIONS, ...requested };
  const legacyFallback = !options.hdArt || options.rawFallback;
  const logs = [], warnings = [];
  let currentProgress = 0;
  const emit = (message, progress = currentProgress, level = "info") => {
    currentProgress = Math.max(currentProgress, progress ?? currentProgress);
    logs.push(`[${level.toUpperCase()}] ${message}`);
    report({ message, progress: currentProgress, level });
  };
  const commonEntries = [], hdEntries = [];
  /*
    Colours the level palette will be cut from. The software and DX9 renderers quantise every
    PNG into ART\<track>.ACT, so the palette has to describe this track's art rather than being
    a generic cube - see palette.js for the measurement.
  */
  const paletteHistogram = new Map();
  const sizeOf = data => data instanceof Blob ? data.size : data.byteLength;
  const addCommon = (name, data, note = "") => {
    commonEntries.push({ name, data });
    emit(`CREATE ${name} (${sizeOf(data).toLocaleString()} bytes)${note ? ` — ${note}` : ""}`, undefined, "detail");
  };
  const addHd = (name, data, note = "") => {
    hdEntries.push({ name, data });
    emit(`CREATE ${name} (${sizeOf(data).toLocaleString()} bytes)${note ? ` — ${note}` : ""}`, undefined, "detail");
  };
  /*
    One decoded texture, written in whichever forms the options asked for. The .TEX table and
    every BIN texture reference name the .RAW stem either way, so the engine's own probe order
    (PNG first, then RAW) is what selects between them and nothing downstream has to know which
    forms exist.
  */
  const addTexture = async (stem, decoded, note) => {
    if (options.hdArt) addHd(`ART\\${stem}.PNG`, await encodePng(decoded.width, decoded.height, decoded.rgba), note);
    if (!legacyFallback) return;
    if (decoded.width !== decoded.height) {
      warnings.push(`${note}: ${decoded.width}x${decoded.height} is not square, so no legacy RAW/ACT pair was written for it.`);
      return;
    }
    const { raw, act } = quantizeToRawAct(decoded.rgba, decoded.width, decoded.height);
    addHd(`ART\\${stem}.RAW`, raw, `${options.hdArt ? "legacy fallback" : "legacy art"} for ${stem}`);
    addHd(`ART\\${stem}.ACT`, act, `palette for ART\\${stem}.RAW`);
  };
  const artLabel = options.hdArt ? (options.rawFallback ? "HD PNG + legacy RAW/ACT" : "HD PNG only") : "legacy RAW/ACT only";
  emit(`CONVERTER BUILD ${BUILD_ID}`, 0, "success");
  emit(`Options: art = ${artLabel}; vegetation ${options.vegetationNonCollide ? "non-collide" : "solid"}; ${options.allObjectsNonCollide ? "all scenery non-collide" : "scenery solid"}.`, 1);
  emit(`Opening ${file.name || "POD2 archive"}...`, 2);
  const pod = await readPod2(file);
  emit(`POD2 directory: ${pod.entries.length} entries.`, 7);
  const sitEntry = pod.entries.find(entry => entry.title.endsWith(".SIT"));
  if (!sitEntry) throw new Error("No .SIT track file was found in this POD2 archive.");
  const sit = parseEvoSit(await readEntry(pod, sitEntry), sitEntry.name);
  if (![6, 7].includes(sit.version)) warnings.push(`SIT version ${sit.version} is treated as Evo ${sit.game}.`);
  emit(`Detected 4x4 Evolution ${sit.game}, SIT v${sit.version}: ${sit.trackName || sitEntry.title}`, 11);
  const lvlEntry = mustResolve(pod, sit.lvlName, "LEVELS", ".LVL");
  const lvl = parseEvoLvl(await readEntry(pod, lvlEntry), lvlEntry.name);
  const texEntry = mustResolve(pod, lvl.texName, "DATA", ".TEX");
  const tex = parseEvoTex(await readEntry(pod, texEntry), texEntry.name);
  warnings.push(...sit.warnings, ...tex.warnings);
  if (tex.shadowCount) warnings.push(`${tex.shadowCount} Evo baked shadow textures were replaced by MTM2 dynamic lighting.`);
  if (lvl.water.tideHeight || lvl.water.tidePeriod) warnings.push("Animated Evo water tide was reduced to MTM2's static water height.");

  emit("Converting 16-bit Evo terrain to MTM2's 8-bit vertical range...", 16);
  const heightEntry = mustResolve(pod, lvl.heightName, "DATA", ".RAW");
  const clrEntry = mustResolve(pod, lvl.clrName, "DATA", ".CLR");
  const heightBytes = await readEntry(pod, heightEntry);
  const terrain = convertTerrain(heightBytes, sit.courses);
  const clr = convertClr(await readEntry(pod, clrEntry));
  const sourceRange = terrain.max - terrain.min;
  warnings.push(`Terrain altitude ${terrain.min.toFixed(1)}..${terrain.max.toFixed(1)} ft was linearly fitted to MTM2's 8-bit height field at ${terrain.scale.toFixed(4)} RAW levels per Evo foot.`);
  emit(`Terrain range ${terrain.min.toFixed(1)}..${terrain.max.toFixed(1)} ft (${sourceRange.toFixed(1)} ft span); linear MTM2 scale ${terrain.scale.toFixed(4)}.`, 21);

  const prefix = safeStem(sitEntry.title).slice(0, 8);
  warnings.push("LIGHTING: the LVL keeps stock TPARK's five values (sun vector 46333,-46333,0; shade scalar 40960; sun position 32000,-46333,0; intensity 64000; final value 255) and DATA LTE is rebuilt from the converted terrain over MTM2's stock 160..255 range, with the east/west slope term added rather than subtracted so the lit hemisphere agrees with that sun vector.");
  warnings.push("PALETTE: ART\\<track>.ACT is median-cut from this track's converted art, paired with a matching FOG\\<track>.MAP. Only DX11/Vulkan draw the PNGs at full depth; the software and DX9 renderers quantise them into this palette, so it is what those renderers show.");
  warnings.push(`TEXTURE LOOKUP: TEX and BIN records name same-stem .RAW files following Traxx conventions. This POD packs ${artLabel}, so the situation file is .${legacyFallback ? "SIT" : "SI2"} and TXV declares legacyFallback=${legacyFallback ? 1 : 0}.` + (legacyFallback ? "" : " An unmodified 1998 install scans only for .SIT and will not list this track; enable the RAW/ACT fallback if you need it to."));
  const textureMap = makeNameMap([...tex.ordinary.map(record => record.name)], 18);

  emit(`Converting ${tex.ordinary.length} terrain textures (${artLabel})...`, 25);
  const textureNames = [];
  const producedTextures = new Set();
  let convertedTextures = 0, hasLargeHdTexture = false;
  for (let i = 0; i < tex.ordinary.length; i++) {
    const sourceName = tex.ordinary[i].name;
    const outputStem = textureMap.get(title(sourceName));
    textureNames.push(`${outputStem}.RAW`);
    if (producedTextures.has(outputStem)) {
      emit(`TEXTURE REUSE ${sourceName} -> ART\\${outputStem}.PNG`, 25 + 32 * i / Math.max(1, tex.ordinary.length), "detail");
      continue;
    }
    producedTextures.add(outputStem);
    const decoded = await loadImage(pod, sourceName, warnings);
    if (decoded) {
      sampleForPalette(paletteHistogram, decoded.rgba);
      await addTexture(outputStem, decoded, `terrain texture ${decoded.sourcePath || sourceName} -> ART\\${outputStem}`);
      hasLargeHdTexture ||= decoded.width > 256 || decoded.height > 256;
      emit(`TEXTURE CONVERTED ${decoded.sourcePath || sourceName} (${decoded.width}×${decoded.height}) -> ART\\${outputStem} [${artLabel}]`, 25 + 32 * i / Math.max(1, tex.ordinary.length), "detail");
      convertedTextures++;
    } else {
      await addTexture(outputStem, await placeholderArt(), `placeholder for missing/unreadable ${sourceName}`);
      emit(`TEXTURE NOT CONVERTED ${sourceName} -> ART\\${outputStem} placeholder`, 25 + 32 * i / Math.max(1, tex.ordinary.length), "warning");
    }
    if ((i & 31) === 0) emit(`Texture ${i + 1}/${tex.ordinary.length}: ${sourceName}`, 25 + 32 * i / Math.max(1, tex.ordinary.length), "detail");
  }

  let vegetation = null;
  const vegEntry = resolveWithExtensions(pod, replaceExtension(sitEntry.title, ".VEG"), "DATA", [".VEG"]);
  if (vegEntry) {
    try {
      vegetation = parseEvoVeg(await readEntry(pod, vegEntry), vegEntry.name);
      warnings.push(...vegetation.warnings);
      emit(`Vegetation map: ${vegetation.trees.length} trees using ${vegetation.treeModels.length} model slots.`, 56);
    } catch (error) { warnings.push(`Could not read ${vegEntry.name}: ${error.message}`); }
  } else if (lvl.vegTexture) warnings.push("The level references vegetation, but its .VEG placement file was not found.");

  const sitModelNames = sit.boxes.map(box => box.modelName).filter(Boolean).map(name => title(name));
  const vegModelNames = vegetation?.treeModels.map(name => title(name)) ?? [];
  const requestedModels = [...new Set([...sitModelNames, ...vegModelNames])];
  const modelNames = makeNameMap(requestedModels, 20, "MODEL");
  const models = [];
  emit(`Reading ${requestedModels.length} referenced SMF models...`, 58);
  for (let i = 0; i < requestedModels.length; i++) {
    const sourceName = requestedModels[i], entry = resolveWithExtensions(pod, sourceName, "MODELS", [".SMF"]);
    if (!entry) {
      warnings.push(`Missing model ${sourceName}; its placements were omitted.`);
      emit(`MODEL NOT CONVERTED ${sourceName} -> no BIN (source file not found)`, 58 + 13 * i / Math.max(1, requestedModels.length), "warning");
      continue;
    }
    try {
      const model = decodeSmfModel(await readEntry(pod, entry), entry.name);
      models.push({ sourceName, sourcePath: entry.name, model }); warnings.push(...model.warnings.map(w => `${sourceName}: ${w}`));
      emit(`MODEL READ ${entry.name}: ${model.meshes.length} meshes`, 58 + 13 * i / Math.max(1, requestedModels.length), "detail");
      if (model.meshes.some(mesh => mesh.frameCount > 1)) warnings.push(`${sourceName}: animated SMF frames were reduced to frame zero.`);
    } catch (error) {
      warnings.push(`Could not convert ${sourceName}: ${error.message}`);
      emit(`MODEL NOT CONVERTED ${entry.name} -> no BIN (${error.message})`, 58 + 13 * i / Math.max(1, requestedModels.length), "warning");
    }
    if ((i & 7) === 0) emit(`Model ${i + 1}/${requestedModels.length}: ${sourceName}`, 58 + 13 * i / Math.max(1, requestedModels.length), "detail");
  }

  const extraTextureNames = [...new Set(models.flatMap(item => item.model.meshes.map(mesh => mesh.textureName).filter(Boolean)).map(title))];
  const transparentTextures = new Set();
  for (const sourceName of extraTextureNames) if (!textureMap.has(sourceName)) textureMap.set(sourceName, allocateName(sourceName, new Set(textureMap.values()), 18));
  emit(`Converting ${extraTextureNames.length} model texture references...`, 72);
  for (let i = 0; i < extraTextureNames.length; i++) {
    const sourceName = extraTextureNames[i], outputStem = textureMap.get(sourceName);
    if (producedTextures.has(outputStem)) {
      emit(`TEXTURE REUSE ${sourceName} -> existing ART\\${outputStem}.PNG`, 72 + 7 * i / Math.max(1, extraTextureNames.length), "detail");
      continue;
    }
    producedTextures.add(outputStem);
    const decoded = await loadImage(pod, sourceName, warnings);
    if (!decoded) {
      await addTexture(outputStem, await placeholderArt(), `placeholder for missing/unreadable model texture ${sourceName}`);
      emit(`TEXTURE NOT CONVERTED ${sourceName} -> ART\\${outputStem} placeholder`, 72 + 7 * i / Math.max(1, extraTextureNames.length), "warning");
      continue;
    }
    if (decoded.hasAlpha) transparentTextures.add(sourceName.toUpperCase());
    sampleForPalette(paletteHistogram, decoded.rgba);
    await addTexture(outputStem, decoded, `model texture ${decoded.sourcePath || sourceName} -> ART\\${outputStem}`);
    hasLargeHdTexture ||= decoded.width > 256 || decoded.height > 256;
    emit(`TEXTURE CONVERTED ${decoded.sourcePath || sourceName} (${decoded.width}×${decoded.height}) -> ART\\${outputStem} [${artLabel}]`, 72 + 7 * i / Math.max(1, extraTextureNames.length), "detail");
  }

  const bumpPairs = new Map();
  for (const { model } of models) for (const mesh of model.meshes) {
    if (mesh.textureName && mesh.bumpTextureName) bumpPairs.set(title(mesh.textureName), title(mesh.bumpTextureName));
  }
  for (const [baseName, bumpName] of bumpPairs) {
    const baseStem = textureMap.get(baseName);
    if (!baseStem) continue;
    const decoded = await loadImage(pod, bumpName, warnings);
    // Normal maps never take a .RAW/.ACT sibling: they carry vectors, which do not survive
    // palette quantisation, and no legacy renderer reads them anyway.
    if (!options.hdArt) { emit(`NORMAL MAP SKIPPED ${bumpName}: HD art is off, and a normal map has no legacy form`, 79, "detail"); continue; }
    if (decoded) {
      const normalName = `ART\\${baseStem}_N.PNG`;
      addHd(normalName, await encodePng(decoded.width, decoded.height, decoded.rgba), `normal map ${decoded.sourcePath || bumpName} -> ${normalName}`);
      hasLargeHdTexture ||= decoded.width > 256 || decoded.height > 256;
      emit(`NORMAL MAP CONVERTED ${decoded.sourcePath || bumpName} -> ${normalName}`, 79, "detail");
    } else emit(`NORMAL MAP NOT CONVERTED ${bumpName}: source missing or unreadable`, 79, "warning");
  }

  if (models.some(({ model }) => model.meshes.some(mesh => !mesh.textureName))) {
    await addTexture("DEFAULT", await placeholderArt(), "placeholder required only by converted meshes that have no texture name");
    emit("TEXTURE GENERATED <unnamed SMF material> -> ART\\DEFAULT placeholder", 79, "warning");
  }

  emit(`Writing ${models.length} CP3 HD BIN models...`, 80);
  const successfulModels = new Map();
  for (const { sourceName, sourcePath, model } of models) {
    const outputName = `${modelNames.get(title(sourceName))}.BIN`;
    const bin = writeMtmBin(model, name => `${textureMap.get(title(name)) || "DEFAULT"}.RAW`, { transparentTextures });
    addCommon(`MODELS\\${outputName}`, bin, `model ${sourcePath || sourceName} -> MODELS\\${outputName}`);
    emit(`MODEL CONVERTED ${sourcePath || sourceName} -> MODELS\\${outputName} (${model.meshes.length} meshes)`, 80, "detail");
    successfulModels.set(sourceName.toUpperCase(), outputName); successfulModels.set(title(sourceName), outputName);
  }

  const vegetationPlacements = [];
  if (vegetation?.trees.length) {
    const modelsByName = new Map(models.map(item => [title(item.sourceName), item.model]));
    const usedNames = new Set(modelNames.values());
    const variants = [];
    for (let slot = 0; slot < vegetation.treeModels.length; slot++) {
      const sourceName = title(vegetation.treeModels[slot]);
      const model = modelsByName.get(sourceName);
      const extent = model && modelExtent(model);
      if (!model || !extent) { warnings.push(`Vegetation slot ${slot + 1} (${sourceName}) has no usable geometry and was omitted.`); variants.push(null); continue; }
      const size = vegetation.treeSizes[slot];
      const scaleY = size ? size.sizeY / extent.height : 1;
      const scaleXZ = size ? size.sizeX / extent.width : scaleY;
      const outputStem = allocateName(`V_${stem(sourceName)}`, usedNames, 20, "TREE");
      const outputName = `${outputStem}.BIN`;
      const variantBin = writeMtmBin(model, name => `${textureMap.get(title(name)) || "DEFAULT"}.RAW`, {
        scale: [scaleXZ, scaleY, scaleXZ], transparentTextures,
      });
      addCommon(`MODELS\\${outputName}`, variantBin, `vegetation variant ${sourceName} -> MODELS\\${outputName}; scale ${scaleXZ.toFixed(4)},${scaleY.toFixed(4)},${scaleXZ.toFixed(4)}`);
      emit(`MODEL CONVERTED [vegetation] ${sourceName} -> MODELS\\${outputName} (pre-scaled, no-collide placements)`, 82, "detail");
      variants.push({ modelName: outputName, clearance: -extent.lowY * scaleY });
    }
    const ordinaryCount = sit.boxes.filter(box => (box.modelName && successfulModels.has(title(box.modelName))) || isCheckpoint(box)).length;
    const capacity = Math.max(0, 4096 - ordinaryCount);
    const candidates = vegetation.trees.filter(tree => variants[(tree.value & 3) % Math.max(1, variants.length)]);
    const selected = evenlyThin(candidates, capacity);
    for (const tree of selected) {
      const variant = variants[(tree.value & 3) % variants.length];
      vegetationPlacements.push({ x: tree.x, z: tree.z, yaw: ((tree.value >> 4) & 15) * (Math.PI / 8), ...variant });
    }
    if (selected.length < candidates.length) warnings.push(`CP3 authoring limit: vegetation was evenly thinned from ${candidates.length} to ${selected.length} trees (${ordinaryCount} existing boxes + ${selected.length} trees = 4096).`);
    emit(`Prepared ${selected.length} vegetation objects within CP3's 4,096-object authoring limit (engine hard cap: 4,608).`, 84);
  }
  addCommon(`DATA\\${prefix}.RAW`, terrain.raw, `${heightEntry.name} 16-bit height field -> MTM2 8-bit terrain`);
  addCommon(`DATA\\${prefix}.CLR`, clr, `${clrEntry.name} -> MTM2 terrain tile grid`);
  addCommon("DATA\\ZERO.RAW", new Uint8Array(78), "required MTM2 zero-height auxiliary resource");
  const levelPalette = createMtmPalette(paletteHistogram);
  emit(`Level palette cut from ${paletteHistogram.size.toLocaleString()} distinct RGB555 colours in the converted art.`, 86, "detail");
  addCommon(`ART\\${prefix}.ACT`, levelPalette, "MTM2 level palette, median-cut from this track's own art");
  addCommon(`FOG\\${prefix}.MAP`, makeFogMap(levelPalette), "RGB555 lookup matched to the self-contained VGA level palette");
  const track = writeTrackFiles({ prefix, sit, lvl, terrain, textureNames, modelNames: successfulModels, vegetation: vegetationPlacements, hasLargeHdTexture, legacyFallback, options });
  for (const generated of track.files) addCommon(generated.name, generated.data, describeGeneratedFile(generated.name));
  addCommon(track.pictureBmp, terrainBmp(terrain.raw, 257, 210, sit.courses[0]), "generated 257x210 track picture with the primary course drawn on it");
  addCommon(track.iconBmp, terrainBmp(terrain.raw, 32, 24), "generated 32x24 track-list icon");
  addCommon(`DATA\\${prefix}.TXT`, new TextEncoder().encode(`Converted from ${file.name || "POD2"}\r\nOriginal author: ${sit.author || "unknown"}\r\n`), "conversion attribution metadata");

  emit(`Situation file: WORLD\\${prefix}.${track.situation} (legacyFallback=${legacyFallback ? 1 : 0}).`, 87, "detail");
  warnings.forEach(warning => emit(warning, 88, "warning"));

  const podBase = [...commonEntries, ...hdEntries];
  emitArchiveManifest(artLabel, podBase);
  const logFooter = ["", "This is an automatic format conversion. Verify and tune the track in JSTrackViewer/Traxx as needed."];
  const conversionLog = new TextEncoder().encode([...logs, ...logFooter].join("\r\n"));
  const files = [...podBase, { name: "CONVERSION.LOG", data: conversionLog }];
  emit(`CREATE CONVERSION.LOG (${conversionLog.byteLength.toLocaleString()} bytes) — complete conversion audit and archive manifest`, 90, "detail");

  const comment = `Evo${sit.game}->MTM2: ${sit.trackName || prefix}`;
  emit(`Packing ${files.length} files as POD1 (32-byte directory names)...`, 94);
  const blob = writePod1(comment, files);
  const validation = await validatePod1(blob);
  emit(`Validated POD1 directory: ${validation.count} files, ${(blob.size / 1048576).toFixed(1)} MiB.`, 99);
  emit(`Conversion complete. The ${track.situation}-based POD1 track is ready to download.`, 100, "success");
  const commonStats = { game: sit.game, textures: convertedTextures, models: models.length + (vegetationPlacements.length ? vegetation.treeModels.length : 0), boxes: sit.boxes.length, vegetation: vegetationPlacements.length };
  return { blob, filename: `${prefix}_MTM2${options.hdArt ? "_HD" : ""}.POD`, format: "POD1", buildId: BUILD_ID, warnings, options,
    stats: { ...commonStats, files: validation.count, hasLargeHdTexture, art: artLabel, situation: track.situation } };

  function emitArchiveManifest(label, archiveEntries) {
    emit(`Archive manifest: ${label} (${archiveEntries.length + 1} files including CONVERSION.LOG)`, 89);
    for (const entry of [...archiveEntries].sort((a, b) => a.name.localeCompare(b.name)))
      emit(`ARCHIVE [${label}] ${entry.name} (${sizeOf(entry.data).toLocaleString()} bytes)`, 89, "detail");
    emit(`ARCHIVE [${label}] CONVERSION.LOG (generated after manifest)`, 89, "detail");
  }
}

function modelExtent(model) {
  let lowX = Infinity, highX = -Infinity, lowY = Infinity, highY = -Infinity;
  const preferred = model.meshes.filter(mesh => mesh.visible && !mesh.lod && mesh.indices.length);
  for (const mesh of preferred) for (let i = 0; i < mesh.positions.length; i += 3) {
    lowX = Math.min(lowX, mesh.positions[i]); highX = Math.max(highX, mesh.positions[i]);
    lowY = Math.min(lowY, mesh.positions[i + 1]); highY = Math.max(highY, mesh.positions[i + 1]);
  }
  return highY > lowY && highX > lowX ? { lowY, height: highY - lowY, width: highX - lowX } : null;
}

function evenlyThin(values, limit) {
  if (values.length <= limit) return values;
  if (limit <= 0) return [];
  return Array.from({ length: limit }, (_, i) => values[Math.floor((i + 0.5) * values.length / limit)]);
}

function isCheckpoint(box) { return box.sourceClass === "CCheckpoint" || box.boxType === 6; }

function mustResolve(pod, name, folder, extension) { const entry = resolveWithExtensions(pod, name, folder, [extension]); if (!entry) throw new Error(`Required ${extension} resource not found: ${name}`); return entry; }
function resolveWithExtensions(pod, name, folder, extensions) { let entry = resolveEntry(pod, name, folder); if (entry) return entry; for (const ext of extensions) { entry = resolveEntry(pod, replaceExtension(name, ext), folder); if (entry) return entry; } return null; }
async function loadImage(pod, name, warnings) {
  const imageEntry = resolveWithExtensions(pod, name, "ART", [".RAW", ".TIF", ".TIFF"]);
  if (!imageEntry) { warnings.push(`Missing texture ${name}; using a placeholder.`); return null; }
  try {
    const image = await readEntry(pod, imageEntry);
    const actEntry = resolveEntry(pod, replaceExtension(imageEntry.name, ".ACT"), "ART");
    const opaEntry = resolveEntry(pod, replaceExtension(imageEntry.name, ".OPA"), "ART");
    const companions = [actEntry?.name, opaEntry?.name].filter(Boolean);
    const sourcePath = companions.length ? `${imageEntry.name} + ${companions.join(" + ")}` : imageEntry.name;
    return { ...decodeEvoImage(image, actEntry && await readEntry(pod, actEntry), opaEntry && await readEntry(pod, opaEntry), imageEntry.name), sourcePath };
  } catch (error) { warnings.push(`${name}: ${error.message}; using a placeholder.`); return null; }
}
function makeNameMap(names, max = 20, fallback = "TEXTURE") { const map = new Map(), used = new Set(); for (const name of names) { const key = title(name); if (!map.has(key)) map.set(key, allocateName(key, used, max, fallback)); } return map; }
function allocateName(name, used, max = 20, fallback = "TEXTURE") { const base = (stem(name).replace(/[^A-Z0-9_]/gi, "_").toUpperCase() || fallback).slice(0, max); let value = base, n = 2; while (used.has(value)) value = `${base.slice(0, max - String(n).length - 1)}_${n++}`; used.add(value); return value; }

/** The missing-texture checkerboard, as a decoded image so it takes whichever forms are on. */
function placeholderArt() {
  const rgba = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const offset = (y * 64 + x) * 4, magenta = ((x >> 3) ^ (y >> 3)) & 1;
    rgba[offset] = magenta ? 255 : 24; rgba[offset + 1] = 0; rgba[offset + 2] = magenta ? 255 : 24; rgba[offset + 3] = 255;
  }
  return { width: 64, height: 64, rgba, hasAlpha: false };
}

function describeGeneratedFile(name) {
  const extension = name.slice(name.lastIndexOf(".")).toUpperCase();
  return ({
    ".SI2": "generated MTM2 track, objects, trucks, courses, water and sun data (HD-only, invisible to a 1998 install)",
    ".SIT": "generated MTM2 track, objects, trucks, courses, water and sun data",
    ".LVL": "generated MTM2 level manifest",
    ".TEX": "generated MTM2 terrain texture table",
    ".TTY": "generated MTM2 texture-type table",
    ".PUP": "generated MTM2 power-up placement data",
    ".ANI": "generated MTM2 animation table",
    ".TDF": "generated MTM2 track definition",
    ".DEF": "generated MTM2 race definition",
    ".NAV": "generated MTM2 navigation data",
    ".LTE": "generated MTM2 terrain lighting table",
    ".RA0": "required MTM2 ground-box lower altitude grid (no boxes: zero)",
    ".RA1": "required MTM2 ground-box upper altitude grid (no boxes: zero)",
    ".RA2": "required MTM2 second-layer floor grid (solid rock: 0xFF)",
    ".RA3": "required MTM2 second-layer ceiling grid (solid rock: 0xFF)",
    ".RA4": "required MTM2 reserved terrain grid (zero in every stock track)",
    ".RA5": "required MTM2 reserved terrain grid (zero in every stock track)",
    ".CL0": "required MTM2 ground-box face texture grid (no boxes: zero)",
    ".CL1": "required MTM2 reserved terrain grid (zero in every stock track)",
    ".CL2": "required MTM2 reserved terrain grid (zero in every stock track)",
    ".TXV": "generated track-version record",
  })[extension] || "generated MTM2 companion file";
}
