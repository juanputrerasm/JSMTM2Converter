import { readPod, readEntry, resolveEntry } from "../formats/pod2-reader.js";
import { writePod1, validatePod1 } from "../formats/pod1-writer.js";
import { parseEvoSit, isEvoSit } from "../formats/evo/evo-sit-parser.js";
import { parseEvoLvl } from "../formats/evo/evo-lvl-parser.js";
import { parseEvoTex } from "../formats/evo/evo-tex-parser.js";
import { parseEvoVeg } from "../formats/evo/veg-parser.js";
import { decodeSmfModel } from "../formats/evo/smf-parser.js";
import { decodeEvoImage } from "../formats/evo/evo-image.js";
import { replaceExtension, safeStem, stem, title } from "../shared/paths.js";
import { convertTerrain, convertClr } from "./terrain.js";
import { encodePng } from "./png.js";
import { writeMtmBin, alphaProfile } from "./bin-writer.js";
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
  // Anchor a model where its own underside meets the terrain; see restingPoint in track-writer.js.
  seatOnTerrain: true,
  // Multiplies the automatic terrain fit; see convertTerrain for what happens above 1.
  heightFactor: 1,
  // Empty means derived from the .SIT name; see trackStem.
  stem: "",
};

/*
  The file stems of MTM2's own tracks, from the LEVELS\<stem>.LVL of every stock pod.

  The engine serves the first mounted copy of every file name, and the stock pods mount first.
  A converted track that reuses one of these stems therefore loads the stock track's terrain,
  tile grid, lighting, level file and palette underneath its own objects: Snake River Canyon,
  converted from SNAKE.POD, did exactly that - nineteen of its own files never loaded.
*/
const STOCK_MTM2_STEMS = new Set([
  "ALASKA", "AUSSIE", "AZTEC", "BAJA", "CRAZY98", "GRAVEY", "JUNK", "MAIN",
  "ROCKQRY", "SNAKE", "SUMMIT1", "SUMMIT2", "SUMMIT3", "TPARK", "WAR",
]);

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
  emit(`Options: art = ${artLabel}; vegetation ${options.vegetationNonCollide ? "non-collide" : "solid"}; ${options.allObjectsNonCollide ? "all scenery non-collide" : "scenery solid"}; models seated ${options.seatOnTerrain ? "where they rest" : "on the ground under their centre"}.`, 1);
  emit(`Opening ${file.name || "POD archive"}...`, 2);
  const pod = await readPod(file);
  emit(`${pod.format} directory: ${pod.entries.length} entries.`, 7);
  const { entry: sitEntry } = await locateEvoTrack(pod);
  const sit = parseEvoSit(await readEntry(pod, sitEntry), sitEntry.name);
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
  const terrain = convertTerrain(heightBytes, sit.courses, options.heightFactor);
  const clr = convertClr(await readEntry(pod, clrEntry));
  const sourceRange = terrain.max - terrain.min;
  const slopePercent = Math.round(100 * terrain.scale / terrain.trueScale);
  warnings.push(`Terrain altitude ${terrain.min.toFixed(1)}..${terrain.max.toFixed(1)} ft was linearly fitted to MTM2's 8-bit height field at ${terrain.scale.toFixed(4)} RAW levels per Evo foot: ${slopePercent}% of the source's true slope (automatic fit ${terrain.autoScale.toFixed(4)} x height factor ${terrain.factor.toFixed(2)}).`);
  emit(`Terrain range ${terrain.min.toFixed(1)}..${terrain.max.toFixed(1)} ft (${sourceRange.toFixed(1)} ft span); MTM2 scale ${terrain.scale.toFixed(4)}, ${slopePercent}% of true slope.`, 21);
  if (terrain.clamped.low || terrain.clamped.high) {
    const span = 255 / terrain.scale, share = (100 * (terrain.clamped.low + terrain.clamped.high) / 65536).toFixed(1);
    warnings.push(`TERRAIN HEIGHT: at ${terrain.factor.toFixed(2)}x the height field holds ${span.toFixed(0)} ft, less than the track's ${sourceRange.toFixed(0)} ft, so a window of ${terrain.base.toFixed(0)}..${(terrain.base + span).toFixed(0)} ft centred on the racing line was kept: ${terrain.clamped.low} cells were clamped flat at its floor and ${terrain.clamped.high} at its ceiling (${share}% of the map).`);
  }
  if (terrain.courseClamped) warnings.push("TERRAIN HEIGHT: the racing line itself climbs further than this height factor can hold, so its highest or lowest stretch is clamped flat. Lower the factor.");

  const prefix = trackStem(sitEntry, sit, options, warnings);
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
  const transparentTextures = new Set(), alphaModes = new Map();
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
    const alpha = alphaProfile(decoded.rgba);
    if (alpha) {
      transparentTextures.add(sourceName.toUpperCase());
      alphaModes.set(sourceName.toUpperCase(), alpha);
    }
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
      const flat = opaqueNormalMap(decoded);
      addHd(normalName, await encodePng(flat.width, flat.height, flat.rgba), `normal map ${decoded.sourcePath || bumpName} -> ${normalName}`);
      hasLargeHdTexture ||= decoded.width > 256 || decoded.height > 256;
      emit(`NORMAL MAP CONVERTED ${decoded.sourcePath || bumpName} -> ${normalName}`, 79, "detail");
    } else emit(`NORMAL MAP NOT CONVERTED ${bumpName}: source missing or unreadable`, 79, "warning");
  }

  if (models.some(({ model }) => model.meshes.some(mesh => !mesh.textureName))) {
    await addTexture("DEFAULT", await placeholderArt(), "placeholder required only by converted meshes that have no texture name");
    emit("TEXTURE GENERATED <unnamed SMF material> -> ART\\DEFAULT placeholder", 79, "warning");
  }

  emit(`Writing ${models.length} CP3 HD BIN models (instanceable scenery faces)...`, 80);
  const successfulModels = new Map();
  const vegetationModels = new Set(vegModelNames);
  for (const { sourceName, sourcePath, model } of models) {
    const outputName = `${modelNames.get(title(sourceName))}.BIN`;
    const bin = writeMtmBin(model, name => `${textureMap.get(title(name)) || "DEFAULT"}.RAW`, {
      transparentTextures, alphaModes, faces: "scenery", foliage: vegetationModels.has(title(sourceName)),
      bumpMaps: options.hdArt,
    });
    addCommon(`MODELS\\${outputName}`, bin, `model ${sourcePath || sourceName} -> MODELS\\${outputName}`);
    emit(`MODEL CONVERTED ${sourcePath || sourceName} -> MODELS\\${outputName} (${model.meshes.length} meshes)`, 80, "detail");
    successfulModels.set(sourceName.toUpperCase(), outputName); successfulModels.set(title(sourceName), outputName);
  }

  const vegetationPlacements = [];
  if (vegetation?.trees.length) {
    /*
      Trees go in at the size their model was authored, which is the size Evo draws up close.

      treeSizeX, treeSizeY and treeBiasY are not a model scale. They size the distant billboard:
      every .VEG names a treeTex that is a sheet of tree sprites (SKULLSET0.TIF, DESERTSET0.TIF,
      ...), the bias is always negative - a sprite sunk into the ground - and against the models
      they bear no consistent relation. Across the five stock Evo 2 tracks treeSizeY / height
      runs from 0.22 to 2.13, and TRIBAJA gives DESERT115 80 ft in one slot and 25 ft in
      another. Scaling the models to them made Snake River's trees 0.35 of their size, Deja
      Voodoo's 3.2 times and Terramar's 1.6 times - small, gigantic and large, which is what
      players reported.

      With no per-slot size to bake in, a tree is simply its converted model. That retires the
      V_ copies, and with them a cross-track collision: Snake River and Terramar each shipped a
      different V_DESERT115.BIN, and the engine serves only the first one it mounts.
    */
    const modelsByName = new Map(models.map(item => [title(item.sourceName), item.model]));
    const variants = vegetation.treeModels.map((name, slot) => {
      const sourceName = title(name), modelName = successfulModels.get(sourceName);
      const extent = modelsByName.has(sourceName) ? modelExtent(modelsByName.get(sourceName)) : null;
      if (!modelName || !extent) { warnings.push(`Vegetation slot ${slot + 1} (${sourceName}) has no usable geometry and was omitted.`); return null; }
      const billboard = vegetation.treeSizes[slot];
      emit(`VEGETATION slot ${slot + 1}: MODELS\\${modelName} at its authored ${extent.height.toFixed(1)} ft${billboard ? ` (the .VEG's ${billboard.sizeX} x ${billboard.sizeY} ft is its distant billboard)` : ""}`, 82, "detail");
      return { modelName, clearance: -extent.lowY, footprint: extent.footprint };
    });
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
  const track = writeTrackFiles({ prefix, sit, lvl, terrain, textureNames, modelNames: successfulModels, modelBounds: boundsByTitle(models), vegetation: vegetationPlacements, hasLargeHdTexture, legacyFallback, options });
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
  const commonStats = { game: sit.game, textures: convertedTextures, models: models.length, boxes: sit.boxes.length, vegetation: vegetationPlacements.length, stem: prefix };
  return { blob, filename: `${prefix}_MTM2${options.hdArt ? "_HD" : ""}.POD`, format: "POD1", buildId: BUILD_ID, warnings, options,
    stats: { ...commonStats, files: validation.count, hasLargeHdTexture, art: artLabel, situation: track.situation } };

  function emitArchiveManifest(label, archiveEntries) {
    emit(`Archive manifest: ${label} (${archiveEntries.length + 1} files including CONVERSION.LOG)`, 89);
    for (const entry of [...archiveEntries].sort((a, b) => a.name.localeCompare(b.name)))
      emit(`ARCHIVE [${label}] ${entry.name} (${sizeOf(entry.data).toLocaleString()} bytes)`, 89, "detail");
    emit(`ARCHIVE [${label}] CONVERSION.LOG (generated after manifest)`, 89, "detail");
  }
}

/*
  A normal map carries vectors, not coverage. Evo 2's bump TIFFs do have a fourth sample, but
  it is not opacity - it averages 60 and never exceeds 128 across TrailBlazer_bump.TIF - so it
  is flattened before the PNG is written rather than becoming a semi-transparent normal map.
*/
function opaqueNormalMap(decoded) {
  const rgba = new Uint8Array(decoded.rgba);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { ...decoded, rgba, hasAlpha: false };
}

/*
  The Evo situation file an archive holds, found by what it is rather than where it sits.

  Neither container nor name says an archive is an Evo track: POD1 repacks exist, and an MTM2
  track's .SIT has the same extension. The header does - an Evo .SIT opens with the word
  "version" and a number, 6 for Evo 1 and 7 for Evo 2 - so every .SIT is read that far and the
  first Evo one wins. Only the first 64 bytes are read per candidate.
*/
export async function locateEvoTrack(pod) {
  const found = [];
  for (const entry of pod.entries) {
    if (!entry.title.endsWith(".SIT")) continue;
    const head = new Uint8Array(await pod.file.slice(entry.offset, entry.offset + Math.min(entry.length, 64)).arrayBuffer());
    const version = isEvoSit(head)
      ? Number.parseInt(new TextDecoder("latin1").decode(head).split(/\r?\n/)[1], 10)
      : null;
    if (version === 6 || version === 7) return { entry, version };
    found.push(version ? `${entry.name} (Evo .SIT v${version})` : `${entry.name} (not an Evo .SIT)`);
  }
  throw new Error(found.length
    ? `No Evo 1 or Evo 2 track (.SIT v6 or v7) in this ${pod.format} archive. Situation files found: ${found.join(", ")}.`
    : `No .SIT situation file in this ${pod.format} archive, so it holds no Evo track.`);
}

/*
  The stem every track file inside the pod is named from: DATA\<stem>.*, LEVELS\<stem>.LVL,
  FOG\<stem>.MAP, ART\<stem>.ACT and WORLD\<stem>.SIT/.SI2.

  An author's choice is taken as given, provided it is one the engine can use and not a stock
  track's. Otherwise it comes from the .SIT name, moved aside with the Evo generation when that
  lands on a stock stem - SNAKE becomes SNAKEE2 - so the converted track's files are the ones
  that load.
*/
function trackStem(sitEntry, sit, options, warnings) {
  const requested = String(options.stem ?? "").trim().toUpperCase();
  if (requested) {
    if (!/^[A-Z0-9_]{1,8}$/.test(requested)) throw new Error(`Track file stem "${options.stem}" must be 1 to 8 letters, digits or underscores.`);
    if (STOCK_MTM2_STEMS.has(requested)) throw new Error(`Track file stem ${requested} belongs to a stock MTM2 track, whose files would load in place of this one's.`);
    return requested;
  }
  const natural = safeStem(sitEntry.title).slice(0, 8);
  if (!STOCK_MTM2_STEMS.has(natural)) return natural;
  const renamed = `${natural.slice(0, 6)}E${sit.game}`;
  warnings.push(`FILE STEM: ${natural} is a stock MTM2 track's stem. Its files mount first and would load in place of this track's terrain, lighting and level, so the converted files are named ${renamed}.`);
  return renamed;
}

function modelExtent(model) {
  let lowX = Infinity, highX = -Infinity, lowY = Infinity, highY = -Infinity, lowZ = Infinity, highZ = -Infinity;
  const preferred = model.meshes.filter(mesh => mesh.visible && !mesh.lod && mesh.indices.length);
  for (const mesh of preferred) for (let i = 0; i < mesh.positions.length; i += 3) {
    lowX = Math.min(lowX, mesh.positions[i]); highX = Math.max(highX, mesh.positions[i]);
    lowY = Math.min(lowY, mesh.positions[i + 1]); highY = Math.max(highY, mesh.positions[i + 1]);
    // The parser has already negated Z into viewer axes; Evo's own depth is the opposite sign.
    lowZ = Math.min(lowZ, -mesh.positions[i + 2]); highZ = Math.max(highZ, -mesh.positions[i + 2]);
  }
  if (!(highY > lowY && highX > lowX)) return null;
  /*
    How far the model reaches sideways where it meets the ground: the trunk, not the canopy.
    A placement grounds the model at one point, so on a slope everything within this radius of
    that point is what decides whether the base hangs in the air. Measured over the bottom
    twentieth of the model's height, which is trunk on every stock Evo tree and is empty on
    nothing that gets placed.
  */
  let footprint = 0;
  for (const mesh of preferred) for (let i = 0; i < mesh.positions.length; i += 3) {
    if (mesh.positions[i + 1] - lowY >= 0.05 * (highY - lowY)) continue;
    footprint = Math.max(footprint, Math.hypot(mesh.positions[i], mesh.positions[i + 2]));
  }
  return { lowY, highY, lowX, highX, lowZ, highZ, height: highY - lowY, width: highX - lowX, footprint };
}

/*
  The model's own underside: over a grid of its footprint, the lowest point of its surface in
  each cell, in Evo feet, NaN where the model has nothing overhead. This is what lets the writer
  see where a model actually rests. A bounding box cannot: Deja Voodoo's gorge bridge carries
  piers 90 ft into the gorge floor, so its box reads as a rock set into a hill, while its deck
  lies level with both rims.

  Each triangle is sampled at the cell centres its plan covers; a wall seen edge-on covers none
  and says nothing about where the model rests, which is right.
*/
const UNDERSIDE_STEP = 8;  // ft: a quarter of an Evo terrain cell
const UNDERSIDE_CELLS = 64;
function undersideOf(model, extent) {
  const { lowX, highX, lowZ, highZ } = extent;
  const step = Math.max(UNDERSIDE_STEP, (highX - lowX) / UNDERSIDE_CELLS, (highZ - lowZ) / UNDERSIDE_CELLS);
  const across = Math.max(1, Math.ceil((highX - lowX) / step)), deep = Math.max(1, Math.ceil((highZ - lowZ) / step));
  const heights = new Float32Array(across * deep).fill(NaN);
  for (const mesh of model.meshes.filter(m => m.visible && !m.lod && m.indices.length)) {
    const p = mesh.positions;
    // Evo's own axes: X, height, depth (the parser negated depth into viewer axes).
    const at = index => [p[index * 3], p[index * 3 + 1], -p[index * 3 + 2]];
    for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
      const [a, b, c] = [at(mesh.indices[t]), at(mesh.indices[t + 1]), at(mesh.indices[t + 2])];
      const area = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
      if (Math.abs(area) < 1e-9) continue;
      const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - lowX) / step - 0.5));
      const i1 = Math.min(across - 1, Math.ceil((Math.max(a[0], b[0], c[0]) - lowX) / step - 0.5));
      const j0 = Math.max(0, Math.floor((Math.min(a[2], b[2], c[2]) - lowZ) / step - 0.5));
      const j1 = Math.min(deep - 1, Math.ceil((Math.max(a[2], b[2], c[2]) - lowZ) / step - 0.5));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const x = lowX + (i + 0.5) * step, z = lowZ + (j + 0.5) * step;
        const wa = ((b[0] - x) * (c[2] - z) - (c[0] - x) * (b[2] - z)) / area;
        const wb = ((c[0] - x) * (a[2] - z) - (a[0] - x) * (c[2] - z)) / area;
        const wc = 1 - wa - wb;
        if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
        const height = wa * a[1] + wb * b[1] + wc * c[1], k = i * deep + j;
        if (!(heights[k] <= height)) heights[k] = height;
      }
    }
  }
  return { step, across, deep, heights };
}

// Every converted model's bounds in Evo feet, by title, for the writer's structure anchoring.
function boundsByTitle(models) {
  const bounds = new Map();
  for (const { sourceName, model } of models) {
    const extent = modelExtent(model);
    if (extent) bounds.set(title(sourceName), { ...extent, underside: undersideOf(model, extent) });
  }
  return bounds;
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
