import { WHEEL_KEYS } from "../evo/evo-trk-parser.js";

/*
  The MTM2 2.1 truck manifest.

  Line-oriented label/value text, CRLF, no terminator - a stock BIGFOOT.TRK ends on the last
  light's "0,0" and nothing else. The field order below is the stock order, which is worth
  matching even though the parsers are order-tolerant: it keeps a converted truck diffable
  against a hand-authored one.

  Two shapes differ from the Evo source and are converted here rather than upstream:

    - Wheel anchors are three ".x"/".y"/".z" pairs per wheel, and stock files group them by
      AXIS (all four x, then all four y, then all four z) rather than by wheel.
    - Scrape points are one "Scrape point N body axis x,y,z" label per point, numbered from 1,
      where Evo writes a single unlabelled "sc[].pt" run.

  The 2.1 header is what activates the patched engine's extended loading. Its two published
  capabilities are four distinct high-detail wheels and a second axle-bar set; Evo supplies
  neither, so the converter writes the header and the second bar set (derived from the axle
  geometry) and leaves the wheel set at the classic left/right pair, which 2.1 still reads.
*/

const CRLF = "\r\n";

export function writeMtm2Truck(truck) {
  const lines = [];
  const pair = (label, value) => { lines.push(label, String(value)); };
  const vec = value => `${fixed(value?.x)},${fixed(value?.y)},${fixed(value?.z)}`;

  lines.push("MTM2.1 truckName", truck.truckName);
  pair("truckModelBaseName", truck.truckModelBaseName);
  pair("tireModelBaseName", truck.tireModelBaseName);
  pair("axleModelName", truck.axleModelName);
  pair("shockTextureName", truck.shockTextureName);
  pair("barTextureName", truck.barTextureName);
  pair("axlebarOffset", vec(truck.axlebarOffset));
  pair("driveshaftPos", vec(truck.driveshaftPos));

  // Grouped by axis, matching the stock layout.
  for (const axis of ["x", "y", "z"]) {
    for (const key of WHEEL_KEYS) pair(`${key}.${axis}`, fixed(truck.wheelAnchors[key]?.[axis]));
  }

  truck.scrapePoints.forEach((point, i) => pair(`Scrape point ${i + 1} body axis x,y,z`, vec(point)));

  pair("Instrument Cluster", truck.instrumentCluster);
  lines.push("Wave File", ...truck.waveFiles);
  pair("Number of Lights", truck.lights.length);
  truck.lights.forEach((light, i) => {
    pair(`Light ${i} type`, light.type ?? 0);
    pair(`Light ${i} body axis pos x,y,z (ft), bitmap radius (ft)`,
      `${vec(light.pos)},${fixed(light.bitmapRadius)}`);
    pair(`Light ${i} heading (rad), pitch (rad), heading spin speed (rad/sec)`,
      `${fixed(light.heading)},${fixed(light.pitch)},${fixed(light.spinSpeed)}`);
    pair(`Light ${i} cone: length (ft), base radius (ft), rim radius (ft), texture name`,
      `${fixed(light.coneLength)},${fixed(light.coneBaseRadius)},${fixed(light.coneRimRadius)},${light.coneTexture}`);
    pair(`Light ${i} source: bitmap name`, light.sourceBitmap);
    pair(`Light ${i} ms on, ms off (0 if light doesn't blink)`, `${light.msOn ?? 0},${light.msOff ?? 0}`);
  });

  /*
    2.1's second axle-bar set. The three values are heights relative to the classic bars -
    front connection, rear connection and midpoint - not a position, so they are written last
    exactly as the extension appends them.
  */
  if (truck.superiorAxlebarOffset) {
    const { frontAxleY, rearAxleY, middleY } = truck.superiorAxlebarOffset;
    pair("superiorAxlebarOffset", `${fixed(frontAxleY)},${fixed(rearAxleY)},${fixed(middleY)}`);
  }

  return new TextEncoder().encode(lines.join(CRLF) + CRLF);
}

function fixed(value) {
  const n = Number(value);
  return (Number.isFinite(n) ? n : 0).toFixed(6);
}
