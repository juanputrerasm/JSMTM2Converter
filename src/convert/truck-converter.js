import { readPod2, readEntry, resolveEntry } from "../formats/pod2-reader.js";
import { writePod1, validatePod1 } from "../formats/pod1-writer.js";
import { parseEvoTruck, WHEEL_KEYS } from "../formats/evo/evo-trk-parser.js";
import { decodeSmfModel } from "../formats/evo/smf-parser.js";
import { decodeEvoImage } from "../formats/evo/evo-image.js";
import { writeMtm2Truck } from "../formats/mtm2/truck-writer.js";
import { buildAxleModel } from "./axle-model.js";
import { writeMtmBin, alphaProfile } from "./bin-writer.js";
import { encodePng } from "./png.js";
import { quantizeToRawAct } from "./raw-act.js";
import { replaceExtension, safeStem, stem, title } from "../shared/paths.js";
import { BUILD_ID } from "../build-info.js";

/*
  Evo vehicle -> MTM2 2.1 truck.

  Both engines measure a truck in feet and both draw it from the same three things: a body
  model, four wheel models, and a manifest of anchors. So the conversion is mostly a faithful
  re-encoding rather than a reinterpretation - the height fitting and re-grounding the track
  path needs has no equivalent here.

  What genuinely differs:

    - Evo has no axle model (every stock manifest says "NULL.BIN") because Evo bodies carry
      their own moulded underbody. MTM2 draws a separate axle, so one is generated. See
      axle-model.js.
    - Evo names no instrument cluster, no engine sounds, and no light source bitmap. Those
      three fall back to stock MTM2 assets, which every install has; everything else in the
      output is converted from the source archive.
    - Evo body LOD is a second file ("TRBLAZ.SMF" full, "TRBLAZ0.SMF" reduced) and MTM2 uses
      the same bare/0 convention, so the two tiers map straight across.
    - Tire detail tiers are 08/12/16 in Evo and 08/10/16 in MTM2, both with L and R sides.
*/

const DEFAULT_OPTIONS = { hdArt: true, rawFallback: false };

// Evo tier -> MTM2 tier. Every stock MTM2 tire family ships all three, so all three are written.
const TIRE_TIERS = [["16", "16"], ["12", "10"], ["08", "08"]];
// The 2.1 four-wheel set. Evo mirrors one pair across both axles, so front and rear share a side.
const ENHANCED_TIERS = [["16FL", "L"], ["16RL", "L"], ["16FR", "R"], ["16RR", "R"]];

// "MODELS\" + stem + "16FL" + ".BIN" is the longest path any model name grows into, and POD1
// stops at 31 bytes.
const MAX_MODEL_STEM = 12;

/*
  Where MTM2 hangs the axle bars and the driveshaft.

  Measured across the stock trucks and six small-tire community trucks rather than guessed.
  The sideways offset is always POSITIVE and small - 0.742 to 1.800 across all of them -
  because the engine mirrors it for the two sides, so a negative value swaps them and the bars
  come out crossed. Its height sits a fixed step above the wheel anchor: stock BIGFOOT, the
  Pikes Peak Tacoma and the #13 CORR Nissan, three different authors, all use exactly 0.644.
  The driveshaft then sits 0.700 above the bars, which is universal in the stock corpus.

  The Dodge Viper GTS-R's "-2.000000,999.000000,0.000000" was read here as a disable switch.
  It is not one - the engine still draws the bars - it is simply a truck shipped with a
  negative offset, and crossed bars are exactly what that produces.
*/
const AXLE_BAR_SIDE_OFFSET = 1.28125;
const AXLE_BAR_ABOVE_ANCHOR = 0.644;
const DRIVESHAFT_ABOVE_AXLE_BAR = 0.7;

const STOCK_CLUSTER = "powerbig";
const STOCK_WAVES = ["bfootf.wav", "bfootu.wav", "bfootd.wav"];

/** Lists the Evo vehicles in a POD2 archive so the UI can offer a choice. */
export async function listEvoTrucks(file) {
  const pod = await readPod2(file);
  const entries = pod.entries.filter(entry => entry.normalizedName.startsWith("TRUCK/") && entry.title.endsWith(".TRK"));
  const trucks = [];
  for (const entry of entries) {
    try {
      const truck = parseEvoTruck(await readEntry(pod, entry), entry.name);
      trucks.push({ path: entry.name, title: entry.title, name: truck.truckName, game: truck.game, version: truck.version });
    } catch {
      // A TRK this reader cannot parse is not offered rather than failing the whole listing.
    }
  }
  return { comment: pod.comment, entries: pod.entries.length, trucks };
}

export async function convertTruck(file, report = () => {}, requested = {}) {
  const options = { ...DEFAULT_OPTIONS, ...requested };
  const legacyFallback = !options.hdArt || options.rawFallback;
  const logs = [], warnings = [];
  let currentProgress = 0;
  const emit = (message, progress = currentProgress, level = "info") => {
    currentProgress = Math.max(currentProgress, progress ?? currentProgress);
    logs.push(`[${level.toUpperCase()}] ${message}`);
    report({ message, progress: currentProgress, level });
  };
  const files = [];
  const sizeOf = data => (data instanceof Blob ? data.size : data.byteLength);
  const add = (name, data, note = "") => {
    files.push({ name, data });
    emit(`CREATE ${name} (${sizeOf(data).toLocaleString()} bytes)${note ? ` — ${note}` : ""}`, undefined, "detail");
  };
  /*
    One decoded texture in whichever forms the options asked for. Every reference in the TRK
    and in the BIN command streams names the .RAW stem either way, so the engine's own probe
    order (PNG first, then RAW) selects between them - the same rule the track path uses.
  */
  const addTexture = async (outputStem, decoded, note) => {
    if (options.hdArt) add(`ART\\${outputStem}.PNG`, await encodePng(decoded.width, decoded.height, decoded.rgba), note);
    if (!legacyFallback) return;
    if (decoded.width !== decoded.height) {
      warnings.push(`${note}: ${decoded.width}x${decoded.height} is not square, so no legacy RAW/ACT pair was written for it.`);
      return;
    }
    const { raw, act } = quantizeToRawAct(decoded.rgba, decoded.width, decoded.height);
    add(`ART\\${outputStem}.RAW`, raw, `${options.hdArt ? "legacy fallback" : "legacy art"} for ${outputStem}`);
    add(`ART\\${outputStem}.ACT`, act, `palette for ART\\${outputStem}.RAW`);
  };

  const artLabel = options.hdArt ? (options.rawFallback ? "HD PNG + legacy RAW/ACT" : "HD PNG only") : "legacy RAW/ACT only";
  emit(`CONVERTER BUILD ${BUILD_ID}`, 0, "success");
  emit(`Options: art = ${artLabel}.`, 1);
  emit(`Opening ${file.name || "POD2 archive"}...`, 2);
  const pod = await readPod2(file);
  emit(`POD2 directory: ${pod.entries.length} entries.`, 5);

  const trkEntry = selectTruckEntry(pod, options.truckPath);
  const truck = parseEvoTruck(await readEntry(pod, trkEntry), trkEntry.name);
  warnings.push(...truck.warnings);
  emit(`Detected 4x4 Evolution ${truck.game}, TRK v${truck.version}: ${truck.truckName || trkEntry.title}`, 9);
  emit(`Source: ${trkEntry.name}; body "${truck.truckModelBaseName}", tires "${truck.tireModelBaseName}".`, 11, "detail");

  /*
    Three model names that must differ from each other and still fit a POD1 path. The budget
    is 31 bytes, and the longest name any of them grows into is "MODELS\<tire>16FL.BIN", so a
    12-character stem leaves room to spare.

    Truncating a suffix onto an already-full stem is what makes them collide - "CSLSE3S2"
    plus "AX" cut back to 8 is "CSLSE3S2" again - so each suffix is appended to a stem that
    was shortened first, and the three are then checked against each other.
  */
  const modelNames = new Set();
  const prefix = uniqueName(safeStem(trkEntry.title).slice(0, MAX_MODEL_STEM) || "EVOTRUCK", modelNames);
  const tireStem = uniqueName(`${prefix.slice(0, MAX_MODEL_STEM - 1)}T`, modelNames);
  const axleName = uniqueName(`${prefix.slice(0, MAX_MODEL_STEM - 2)}AX`, modelNames);

  emit("Reading source models...", 14);
  const bodyEntry = resolveSmf(pod, truck.truckModelBaseName);
  if (!bodyEntry) throw new Error(`Body model not found in this archive: ${truck.truckModelBaseName}.SMF`);
  const body = decodeSmfModel(await readEntry(pod, bodyEntry), bodyEntry.name);
  warnings.push(...body.warnings.map(warning => `${bodyEntry.name}: ${warning}`));
  emit(`MODEL READ ${bodyEntry.name}: ${body.meshes.length} meshes`, 17, "detail");

  const bodyLodEntry = resolveSmf(pod, `${truck.truckModelBaseName}0`);
  let bodyLod = null;
  if (bodyLodEntry) {
    bodyLod = decodeSmfModel(await readEntry(pod, bodyLodEntry), bodyLodEntry.name);
    warnings.push(...bodyLod.warnings.map(warning => `${bodyLodEntry.name}: ${warning}`));
    emit(`MODEL READ ${bodyLodEntry.name}: ${bodyLod.meshes.length} meshes (reduced LOD)`, 19, "detail");
  } else warnings.push(`No reduced-detail body (${truck.truckModelBaseName}0.SMF); MTM2 will draw the full model at every distance.`);

  const tires = await readTireSet(pod, truck.tireModelBaseName, warnings, emit);
  if (!tires.best.L || !tires.best.R) throw new Error(`No left/right tire models found for "${truck.tireModelBaseName}".`);

  /*
    Evo measures a body from its underside and MTM2 from its middle, so the converted model is
    re-centred on its own vertical extent and everything mounted to it - the wheel anchors, the
    scrape hull, the light positions - moves by the same amount. Relative geometry is untouched;
    only the origin moves, and that is where MTM2 reads the centre of mass from.

    Checked against every stock Evo vehicle: raw anchors sit 0.4 to 1.8 ft below the origin, and
    after this shift all 271 land between 2.4 and 4.0 ft below it, inside the 2.8 to 3.8 ft band
    every MTM2 truck uses.
  */
  const bodyCentre = verticalCentre(body);

  const sourceModels = [body, bodyLod, ...Object.values(tires.models)].filter(Boolean);
  if (sourceModels.some(model => model.meshes.some(mesh => mesh.frameCount > 1))) {
    warnings.push("Animated SMF frames were reduced to frame zero.");
  }

  /*
    Every texture the converted BINs will name, plus the two the manifest names itself. Evo
    ships SUSP.RAW for shocks and LGTCNEW1.RAW for light cones, so both are real conversions
    rather than references to stock art.
  */
  emit("Converting textures...", 28);
  const modelTextures = [...new Set(sourceModels.flatMap(model => model.meshes.map(mesh => mesh.textureName).filter(Boolean)).map(title))];
  const suspSource = resolveEntry(pod, "SUSP.RAW", "ART") ? "SUSP.RAW" : null;
  const coneSource = truck.lights.map(light => light.coneTexture).find(name => name && !/^NULL/i.test(name)) || null;
  const wanted = [...new Set([...modelTextures, suspSource, coneSource && title(coneSource)].filter(Boolean))];

  const textureMap = new Map();
  const used = new Set();
  for (const name of wanted) textureMap.set(name, allocateName(name, used));
  // What each texture's alpha asks for, so the models below can tell a lamp from bodywork.
  const transparentTextures = new Set(), alphaModes = new Map();
  let convertedTextures = 0;
  for (let i = 0; i < wanted.length; i++) {
    const sourceName = wanted[i], outputStem = textureMap.get(sourceName);
    const progress = 28 + 22 * i / Math.max(1, wanted.length);
    const decoded = await loadImage(pod, sourceName, warnings);
    if (!decoded) {
      await addTexture(outputStem, placeholderArt(), `placeholder for missing texture ${sourceName}`);
      emit(`TEXTURE NOT CONVERTED ${sourceName} -> ART\\${outputStem} placeholder`, progress, "warning");
      continue;
    }
    await addTexture(outputStem, decoded, `texture ${decoded.sourcePath || sourceName} -> ART\\${outputStem}`);
    const alpha = alphaProfile(decoded.rgba);
    if (alpha) { transparentTextures.add(sourceName.toUpperCase()); alphaModes.set(sourceName.toUpperCase(), alpha); }
    convertedTextures++;
    emit(`TEXTURE CONVERTED ${decoded.sourcePath || sourceName} (${decoded.width}×${decoded.height}) -> ART\\${outputStem} [${artLabel}]`, progress, "detail");
  }

  // Evo 2 names a bump map per group; MTM2 CP3 finds it as the diffuse stem plus "_N".
  const bumpPairs = new Map();
  for (const model of sourceModels) for (const mesh of model.meshes) {
    if (mesh.textureName && mesh.bumpTextureName) bumpPairs.set(title(mesh.textureName), title(mesh.bumpTextureName));
  }
  for (const [baseName, bumpName] of bumpPairs) {
    const baseStem = textureMap.get(baseName);
    if (!baseStem) continue;
    if (!options.hdArt) { emit(`NORMAL MAP SKIPPED ${bumpName}: HD art is off, and a normal map has no legacy form`, 51, "detail"); continue; }
    const decoded = await loadImage(pod, bumpName, warnings);
    if (!decoded) { emit(`NORMAL MAP NOT CONVERTED ${bumpName}: source missing or unreadable`, 51, "warning"); continue; }
    const flat = opaqueCopy(decoded);
    add(`ART\\${baseStem}_N.PNG`, await encodePng(flat.width, flat.height, flat.rgba), `normal map ${decoded.sourcePath || bumpName} -> ART\\${baseStem}_N.PNG`);
    emit(`NORMAL MAP CONVERTED ${decoded.sourcePath || bumpName} -> ART\\${baseStem}_N.PNG`, 51, "detail");
  }

  if (sourceModels.some(model => model.meshes.some(mesh => !mesh.textureName))) {
    await addTexture("DEFAULT", placeholderArt(), "placeholder required only by converted meshes that have no texture name");
    emit("TEXTURE GENERATED <unnamed SMF material> -> ART\\DEFAULT placeholder", 52, "warning");
  }
  // A soft round glow so the light source bitmap is converted output rather than a stock
  // reference: Evo names NULL.RAW for every light on every stock truck, so there is nothing
  // in the source archive to convert.
  const glowStem = allocateName("EVOGLOW", used);
  await addTexture(glowStem, glowArt(), "generated light source bitmap (Evo names none)");

  const textureFor = name => `${textureMap.get(title(name || "")) || "DEFAULT"}.RAW`;
  /*
    The same face types the track path writes - plain textured faces for solid art, a material
    only where the art is actually alpha-tested or translucent, nothing two-sided - with the
    vehicle rule for transparency: a mesh is transparent only if its own .SMF group says so.
    That is what returns lamps and glass, which the previous blanket "write it all solid" had to
    flatten because a truck's shared atlas carries an alpha plane its bodywork never uses.
  */
  const binOptions = { heightScale: 1, faces: "truck", transparentTextures, alphaModes, bumpMaps: options.hdArt };
  // Only the body is re-centred. Tires and the axle are drawn at the anchors, which have
  // already moved, so shifting their geometry as well would move them twice.
  const bodyBinOptions = { ...binOptions, heightOffset: bodyCentre };
  const evoTransparentGroups = [...new Set(sourceModels.flatMap(model => model.meshes.filter(mesh => mesh.transparent).map(mesh => mesh.groupName)))];

  emit("Writing MTM2 BIN models...", 56);
  add(`MODELS\\${prefix}.BIN`, writeMtmBin(body, textureFor, bodyBinOptions), `body ${bodyEntry.name} -> MODELS\\${prefix}.BIN`);
  emit(`MODEL CONVERTED ${bodyEntry.name} -> MODELS\\${prefix}.BIN (${drawableMeshes(body)} drawn meshes)`, 60, "detail");
  if (bodyLod) {
    add(`MODELS\\${prefix}0.BIN`, writeMtmBin(bodyLod, textureFor, bodyBinOptions), `reduced body ${bodyLodEntry.name} -> MODELS\\${prefix}0.BIN`);
    emit(`MODEL CONVERTED ${bodyLodEntry.name} -> MODELS\\${prefix}0.BIN (${drawableMeshes(bodyLod)} drawn meshes)`, 63, "detail");
  }

  const tireBins = new Map();
  for (const [evoTier, mtmTier] of TIRE_TIERS) {
    for (const side of ["L", "R"]) {
      const chosen = tires.tiers[evoTier]?.[side] ?? tires.best[side];
      const key = `${side}:${chosen.entry.name}`;
      const bin = tireBins.get(key) ?? writeMtmBin(chosen.model, textureFor, binOptions);
      tireBins.set(key, bin);
      const outputName = `MODELS\\${tireStem}${mtmTier}${side}.BIN`;
      const note = tires.tiers[evoTier]?.[side] ? `tire ${chosen.entry.name}` : `tire ${chosen.entry.name} reused: Evo has no ${evoTier}${side} tier`;
      add(outputName, bin, `${note} -> ${outputName}`);
    }
  }
  /*
    The 2.1 four-wheel set. Evo authors one mirrored pair and reuses it on both axles, so the
    front and rear entries of a side are the same model. Shipping the set as well as the
    legacy pair is what the 2.1 contract asks for, and it costs four small duplicates.
  */
  for (const [slot, side] of ENHANCED_TIERS) {
    const chosen = tires.tiers["16"]?.[side] ?? tires.best[side];
    const outputName = `MODELS\\${tireStem}${slot}.BIN`;
    add(outputName, writeMtmBin(chosen.model, textureFor, binOptions), `2.1 wheel slot ${slot} from ${chosen.entry.name} -> ${outputName}`);
  }
  emit(`MODELS CONVERTED tires -> ${tireStem}{08,10,16}{L,R} and the 2.1 set ${tireStem}{16FL,16FR,16RL,16RR}`, 74, "detail");

  const anchors = WHEEL_KEYS.map(key => lower(truck.wheelAnchors[key] ?? { x: 0, y: 0, z: 0 }, bodyCentre));
  const frontTrack = Math.abs((truck.wheelAnchors["faxle.rtire.static_bpos"]?.x ?? 0) - (truck.wheelAnchors["faxle.ltire.static_bpos"]?.x ?? 0));
  const rearTrack = Math.abs((truck.wheelAnchors["raxle.rtire.static_bpos"]?.x ?? 0) - (truck.wheelAnchors["raxle.ltire.static_bpos"]?.x ?? 0));
  const axleWidth = Math.max(frontTrack, rearTrack) || 4;
  const anchorHeight = anchors.reduce((sum, anchor) => sum + anchor.y, 0) / anchors.length;
  const axleBarHeight = anchorHeight + AXLE_BAR_ABOVE_ANCHOR;
  const suspStem = suspSource ? textureMap.get(title(suspSource)) : null;
  const axleModel = buildAxleModel(axleWidth, suspStem ? `${suspStem}.RAW` : null);
  add(`MODELS\\${axleName}.BIN`, writeMtmBin(axleModel, textureFor, binOptions), `generated ${axleWidth.toFixed(2)} ft axle beam (Evo has no axle model)`);
  emit(`MODEL GENERATED axle beam ${axleWidth.toFixed(2)} ft wide -> MODELS\\${axleName}.BIN`, 78, "detail");

  emit("Writing the MTM2 2.1 manifest...", 82);
  // Stock manifests name their art in lower case; the lookup is case-insensitive either way,
  // but matching them keeps a converted file diffable against a hand-authored one.
  const shockName = suspStem ? `${suspStem.toLowerCase()}.raw` : "shock2.raw";
  const converted = {
    truckName: truck.truckName || prefix,
    truckModelBaseName: prefix.toLowerCase(),
    tireModelBaseName: tireStem.toLowerCase(),
    axleModelName: `${axleName.toLowerCase()}.bin`,
    shockTextureName: shockName,
    barTextureName: shockName,
    axlebarOffset: { x: AXLE_BAR_SIDE_OFFSET, y: axleBarHeight, z: 0 },
    driveshaftPos: { x: 0, y: axleBarHeight + DRIVESHAFT_ABOVE_AXLE_BAR, z: 0 },
    wheelAnchors: Object.fromEntries(WHEEL_KEYS.map((key, i) => [key, anchors[i]])),
    scrapePoints: truck.scrapePoints.map(point => lower(point, bodyCentre)),
    instrumentCluster: STOCK_CLUSTER,
    waveFiles: STOCK_WAVES,
    lights: truck.lights.map(light => ({
      ...light,
      pos: lower(light.pos ?? { x: 0, y: 0, z: 0 }, bodyCentre),
      coneTexture: light.coneTexture && !/^NULL/i.test(light.coneTexture) && textureMap.has(title(light.coneTexture))
        ? `${textureMap.get(title(light.coneTexture)).toLowerCase()}.raw`
        : `${glowStem.toLowerCase()}.raw`,
      sourceBitmap: `${glowStem.toLowerCase()}.raw`,
    })),
    // Deliberately absent: Evo has no second axle-bar set, and inventing one would add
    // visible hardware the source truck never had. The 2.1 header does not require it.
    superiorAxlebarOffset: null,
  };
  add(`TRUCK\\${prefix}.TRK`, writeMtm2Truck(converted), `MTM2 2.1 manifest for ${converted.truckName}`);

  warnings.push(`RIDE HEIGHT: the body was re-centred by ${bodyCentre.toFixed(3)} ft. Evo measures a vehicle from its underside and MTM2 from its middle, so without this the centre of mass sits down at axle height, which makes the truck wallow and eventually throw itself off the level.`);
  warnings.push(`SUSPENSION: axle bars at x=${AXLE_BAR_SIDE_OFFSET}, y=${axleBarHeight.toFixed(3)} (${AXLE_BAR_ABOVE_ANCHOR} ft above the wheel anchors), driveshaft ${DRIVESHAFT_ABOVE_AXLE_BAR} ft above that, following the stock and small-tire community trucks. The sideways offset stays positive because MTM2 mirrors it and a negative one crosses the bars.`);
  warnings.push(`AXLE: Evo names "NULL.BIN" for its axle because Evo bodies carry their own moulded underbody, so a ${axleWidth.toFixed(2)} ft beam was generated. The converted body may already show suspension detail behind it.`);
  warnings.push(`FACES: a vehicle mesh is transparent only where its own .SMF group says so and its texture has non-opaque texels${evoTransparentGroups.length ? `; this one flags ${evoTransparentGroups.slice(0, 8).join(", ")}` : ", and this one flags none, so every face is solid"}. Everything else is written as the plain textured faces stock MTM2 models use, with nothing two-sided.`);
  warnings.push(`STOCK REFERENCES: the instrument cluster ("${STOCK_CLUSTER}") and the three engine sounds (${STOCK_WAVES.join(", ")}) are stock MTM2 assets. Evo names none of them and they cannot be synthesised, so they are referenced rather than packed; every MTM2 install has them.`);
  warnings.push(`TEXTURE LOOKUP: TRK and BIN records name same-stem .RAW files following Traxx conventions. This POD packs ${artLabel}.` + (options.hdArt ? "" : " PNG art was not written, so a Community Patch 3 install will fall back to the 8-bit pair."));
  if (truck.colors.length) {
    warnings.push(`PAINT: Evo offers ${truck.colors.length} garage paint schemes (${truck.colors.slice(0, 4).map(colour => `#${hex(colour)}`).join(", ")}${truck.colors.length > 4 ? ", ..." : ""}). MTM2 has no paint system, so the body keeps its source texture unrecoloured.`);
  }
  if (truck.stockParts.length) warnings.push(`PARTS: ${truck.stockParts.length} Evo stock parts (${truck.stockParts.slice(0, 6).join(", ")}${truck.stockParts.length > 6 ? ", ..." : ""}) are already baked into the body model; MTM2 has no upgrade system.`);
  warnings.push("PHYSICS: Evo's engine, gearbox, suspension and differential tables have no MTM2 equivalent and were not converted. The truck drives on MTM2's own defaults.");
  warnings.forEach(warning => emit(warning, 88, "warning"));

  emitManifest();
  const logFooter = ["", "This is an automatic format conversion. Verify the truck in JSTruckViewer before racing it."];
  const conversionLog = new TextEncoder().encode([...logs, ...logFooter].join("\r\n"));
  files.push({ name: "CONVERSION.LOG", data: conversionLog });
  emit(`CREATE CONVERSION.LOG (${conversionLog.byteLength.toLocaleString()} bytes) — complete conversion audit and archive manifest`, 90, "detail");

  emit(`Packing ${files.length} files as POD1 (32-byte directory names)...`, 94);
  const blob = writePod1(`Evo${truck.game}->MTM2: ${converted.truckName}`, files);
  const validation = await validatePod1(blob);
  emit(`Validated POD1 directory: ${validation.count} files, ${(blob.size / 1048576).toFixed(2)} MiB.`, 99);
  emit("Conversion complete. The MTM2 2.1 truck POD is ready to download.", 100, "success");
  return {
    blob, filename: `${prefix}_MTM2${options.hdArt ? "_HD" : ""}.POD`, format: "POD1", buildId: BUILD_ID, warnings, options,
    stats: {
      kind: "truck", game: truck.game, truckName: converted.truckName, textures: convertedTextures,
      models: 1 + (bodyLod ? 1 : 0) + TIRE_TIERS.length * 2 + ENHANCED_TIERS.length + 1,
      lights: converted.lights.length, scrapePoints: converted.scrapePoints.length,
      files: validation.count, art: artLabel,
    },
  };

  function emitManifest() {
    emit(`Archive manifest: ${artLabel} (${files.length + 1} files including CONVERSION.LOG)`, 89);
    for (const entry of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
      emit(`ARCHIVE [${artLabel}] ${entry.name} (${sizeOf(entry.data).toLocaleString()} bytes)`, 89, "detail");
    }
    emit(`ARCHIVE [${artLabel}] CONVERSION.LOG (generated after manifest)`, 89, "detail");
  }
}

function selectTruckEntry(pod, requestedPath) {
  const trucks = pod.entries.filter(entry => entry.normalizedName.startsWith("TRUCK/") && entry.title.endsWith(".TRK"));
  if (!trucks.length) throw new Error("No TRUCK\\*.TRK vehicle manifest was found in this POD2 archive.");
  if (!requestedPath) return trucks[0];
  const found = trucks.find(entry => entry.name === requestedPath || entry.normalizedName === String(requestedPath).replace(/\\/g, "/").toUpperCase());
  if (!found) throw new Error(`Vehicle not found in this archive: ${requestedPath}`);
  return found;
}

/*
  Tire models are "<stem><tier><side>.SMF". A bare prefix search is not enough: "Class3Tire"
  also matches "Class3TireB16L", and both would score 16 on the tier sort, so which one a
  truck got would come down to directory order. Only names that are exactly the stem plus a
  tier and a side are accepted.
*/
async function readTireSet(pod, baseName, warnings, emit) {
  const pattern = new RegExp(`^${escapeRegExp(String(baseName || "").toUpperCase())}(\\d+)([LR])\\.SMF$`, "i");
  const matches = pod.entries.filter(entry => entry.normalizedName.startsWith("MODELS/") && pattern.test(entry.title));
  const tiers = {}, models = {}, best = { L: null, R: null };
  for (const entry of matches) {
    const [, tier, side] = entry.title.match(pattern);
    const model = decodeSmfModel(await readEntry(pod, entry), entry.name);
    warnings.push(...model.warnings.map(warning => `${entry.name}: ${warning}`));
    models[entry.title] = model;
    const key = tier.padStart(2, "0");
    (tiers[key] ??= {})[side.toUpperCase()] = { entry, model };
    const upperSide = side.toUpperCase();
    if (!best[upperSide] || Number(tier) > Number(best[upperSide].tier)) best[upperSide] = { entry, model, tier };
    emit(`MODEL READ ${entry.name}: ${model.meshes.length} meshes (tier ${key}${upperSide})`, 22, "detail");
  }
  if (!matches.length) warnings.push(`No tire models matched "${baseName}<tier><side>.SMF".`);
  return { tiers, models, best };
}

function resolveSmf(pod, baseName) {
  if (!baseName) return null;
  return resolveEntry(pod, `${baseName}.SMF`, "MODELS") ?? resolveEntry(pod, replaceExtension(baseName, ".SMF"), "MODELS");
}

async function loadImage(pod, name, warnings) {
  const imageEntry = ["", ".RAW", ".TIF", ".TIFF"].reduce((found, extension) =>
    found ?? resolveEntry(pod, extension ? replaceExtension(name, extension) : name, "ART"), null);
  if (!imageEntry) { warnings.push(`Missing texture ${name}; using a placeholder.`); return null; }
  try {
    const image = await readEntry(pod, imageEntry);
    const actEntry = resolveEntry(pod, replaceExtension(imageEntry.name, ".ACT"), "ART");
    const opaEntry = resolveEntry(pod, replaceExtension(imageEntry.name, ".OPA"), "ART");
    const companions = [actEntry?.name, opaEntry?.name].filter(Boolean);
    const sourcePath = companions.length ? `${imageEntry.name} + ${companions.join(" + ")}` : imageEntry.name;
    const decoded = decodeEvoImage(image, actEntry && await readEntry(pod, actEntry), opaEntry && await readEntry(pod, opaEntry), imageEntry.name);
    return { ...decoded, sourcePath };
  } catch (error) { warnings.push(`${name}: ${error.message}; using a placeholder.`); return null; }
}

/*
  A normal map carries vectors, not coverage. Evo 2's bump TIFFs do have a fourth sample, but
  it is not opacity - it averages 60 and never exceeds 128 across TrailBlazer_bump.TIF - so it
  is flattened before the PNG is written rather than becoming a semi-transparent normal map.
*/
function opaqueCopy(decoded) {
  const rgba = new Uint8Array(decoded.rgba);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { ...decoded, rgba, hasAlpha: false };
}

/** A model name that is not already taken, so the body, tires and axle cannot collide. */
function uniqueName(base, used) {
  let value = base || "EVOTRUCK", n = 2;
  while (used.has(value)) value = `${base.slice(0, MAX_MODEL_STEM - String(n).length)}${n++}`;
  used.add(value);
  return value;
}

/** The mid-height of a model's drawable geometry, which is where MTM2 wants the origin. */
function verticalCentre(model) {
  let low = Infinity, high = -Infinity;
  for (const mesh of model.meshes) {
    if (!mesh.visible || mesh.lod || !mesh.indices.length) continue;
    for (let i = 1; i < mesh.positions.length; i += 3) {
      if (mesh.positions[i] < low) low = mesh.positions[i];
      if (mesh.positions[i] > high) high = mesh.positions[i];
    }
  }
  return Number.isFinite(low) && Number.isFinite(high) ? (low + high) / 2 : 0;
}

/** Moves a body-relative point down with the re-centred origin. */
function lower(point, offset) {
  return { x: point?.x ?? 0, y: (point?.y ?? 0) - offset, z: point?.z ?? 0 };
}

function drawableMeshes(model) { return model.meshes.filter(mesh => mesh.visible && !mesh.lod && mesh.indices.length).length; }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function hex(colour) { return [colour.red, colour.green, colour.blue].map(part => part.toString(16).padStart(2, "0")).join(""); }

// POD1 paths stop at 31 bytes and "ART\" plus ".PNG" already spend 8, so texture stems are
// capped well inside that and de-duplicated against everything already allocated.
function allocateName(name, used, max = 18) {
  const base = (stem(name).replace(/[^A-Z0-9_]/gi, "_").toUpperCase() || "TEXTURE").slice(0, max);
  let value = base, n = 2;
  while (used.has(value)) value = `${base.slice(0, max - String(n).length - 1)}_${n++}`;
  used.add(value);
  return value;
}

function placeholderArt() {
  const rgba = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const offset = (y * 64 + x) * 4, magenta = ((x >> 3) ^ (y >> 3)) & 1;
    rgba[offset] = magenta ? 255 : 24; rgba[offset + 1] = 0; rgba[offset + 2] = magenta ? 255 : 24; rgba[offset + 3] = 255;
  }
  return { width: 64, height: 64, rgba, hasAlpha: false };
}

/** A soft white glow, the light source bitmap Evo never names. */
function glowArt() {
  const side = 32, centre = (side - 1) / 2, rgba = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const distance = Math.hypot(x - centre, y - centre) / (side / 2);
    const level = Math.round(255 * Math.max(0, 1 - distance) ** 2);
    const offset = (y * side + x) * 4;
    rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = level;
    rgba[offset + 3] = level;
  }
  return { width: side, height: side, rgba, hasAlpha: true };
}
