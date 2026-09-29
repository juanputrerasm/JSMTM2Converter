/*
  4x4 Evolution vehicle manifests (TRK v6 and v7) for the converter.

  Parsing is OpenPhotex's (parseEvoTrk returns the manifest as written). This adapter reshapes
  it into the object the truck converter reads, and adds the converter's own warnings for the
  parts it cannot do without.
*/
import { EVO_WHEEL_KEYS, isEvoTrkLines, parseEvoTrk, trkSpecValue } from "../../vendor/openphotex/index.js";

export const WHEEL_KEYS = [...EVO_WHEEL_KEYS];

/** True when these lines open with the Evo "version" / 6|7 pair rather than an MTM header. */
export function isEvoTruckManifest(lines) {
  return isEvoTrkLines(lines);
}

export function parseEvoTruck(bytes, sourceName) {
  const trk = parseEvoTrk(bytes, sourceName);
  // Specs in file order, with the fields this converter never splits out kept among them.
  const specs = {};
  for (const label of trk.fieldOrder) {
    if (label in trk.specs) specs[label] = trk.specs[label];
    else if (label === "axlebarOffset" || label === "driveshaftPos") specs[label] = trkSpecValue(trk.rawValues[label]);
    else if (label === "Number of Lights") specs.numberOfLights = trk.numberOfLights;
  }
  const truck = {
    sourceName, version: trk.version, game: trk.game,
    truckName: trk.truckName,
    truckModelBaseName: trk.truckModelBaseName ?? "",
    tireModelBaseName: trk.tireModelBaseName ?? "",
    axleModelName: trk.axleModelName ?? "",
    shockTextureName: trk.shockTextureName ?? "",
    barTextureName: trk.barTextureName ?? "",
    wheelAnchors: trk.wheelAnchors, scrapePoints: trk.scrapePoints, lights: trk.lights,
    // Only the swatch is carried forward: every stock decal texture is "NULL".
    colors: trk.colors.map((color) => ({
      ...color, red: clampByte(color.red), green: clampByte(color.green), blue: clampByte(color.blue),
    })),
    stockParts: trk.stockParts,
    waveFiles: trk.waveFiles, instrumentCluster: trk.instrumentCluster ?? "", specs, signature: trk.signature, warnings: [],
  };
  if (!truck.truckModelBaseName) truck.warnings.push(`${sourceName}: no truckModelBaseName; there is no body to convert.`);
  for (const key of WHEEL_KEYS) if (!truck.wheelAnchors[key]) truck.warnings.push(`${sourceName}: missing wheel anchor ${key}; it was placed at the origin.`);
  return truck;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
