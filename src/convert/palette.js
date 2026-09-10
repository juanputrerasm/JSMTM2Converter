/*
  The level palette, ART\<track>.ACT, and its RGB555 lookup, FOG\<track>.MAP.

  These matter more than "HD track" suggests. HD registration - a PNG drawn at its own colour
  depth - is a DX11/Vulkan path; the software and DX9 renderers read the same PNG but quantise
  it into this palette on the way in, and that is the picture most people see. A palette that
  does not describe the track's art is therefore not a fallback detail, it is the track looking
  posterised.

  Which is what a fixed 6x6x6 colour cube was doing. Measured over Baja Beach's 191 terrain
  tiles - 782,336 texels in 1,792 distinct colours - the cube quantises at an RMS error of
  24.54, while a median cut over the track's own colours reaches 1.95. Twelve times closer, and
  close enough that the 219 authored entries are nearly lossless for terrain art that was 8-bit
  per tile to begin with.
*/

// Indices reserved either side of the authored band, kept byte-for-byte as stock levels write
// them: the Windows system colours below, and the system/UI band from 230 up. VGA.LTE's top
// shade row maps everything to 229, so 229 must stay white.
const SYSTEM_LOW = [
  0,0,0, 128,0,0, 0,128,0, 128,128,0, 0,0,128,
  128,0,128, 0,128,128, 192,192,192, 192,220,192, 166,202,240,
];
const SYSTEM_HIGH = [
  0,0,0, 0,0,0, 0,0,0, 0,0,0, 0,0,0, 0,0,0, 0,0,0, 0,0,0,
  0,0,0, 0,0,0, 0,0,0, 0,0,0, 0,0,0, 0,0,0, 0,0,0, 0,0,0,
  255,251,240, 160,160,164, 128,128,128, 255,0,0, 0,255,0,
  255,255,0, 0,0,255, 255,0,255, 0,255,255, 255,255,255,
];
/*
  ⚠ 229 IS WHITE AND IS NOT AVAILABLE TO AUTHOR. STARTUP.POD's FOG\VGA.LTE is a 32-level shade
  table whose top row maps every index to 229, and every stock level's 229 is white or near it
  (TPARK 252,252,252; BAJA 255,255,255). Letting the median cut have it - which it will, since
  it is inside the band otherwise - hands the brightest shade row whatever colour the track
  happened to use most, and 226..228 show it is only this one entry that is spoken for.
*/
const WHITE_INDEX = 229;
export const FIRST_AUTHORED = 10, AUTHORED_COUNT = WHITE_INDEX - 10;

/**
 * Builds the level palette. `histogram` maps an RGB555 key to a texel count, as collected
 * from the converted art; without one the authored band falls back to a colour cube.
 */
export function createMtmPalette(histogram = null) {
  const act = new Uint8Array(768);
  act.set(SYSTEM_LOW);
  act.set(SYSTEM_HIGH, 230 * 3);
  const authored = histogram?.size ? medianCutPalette(histogram, AUTHORED_COUNT) : colourCube();
  for (let i = 0; i < AUTHORED_COUNT; i++) {
    const colour = authored[i] ?? authored[authored.length - 1] ?? [0, 0, 0];
    act.set(colour, (FIRST_AUTHORED + i) * 3);
  }
  act.set([252, 252, 252], WHITE_INDEX * 3);
  return act;
}

/*
  Adds up to `budget` texels of one decoded image to the colour histogram.

  ⚠ COUNT EXACT COLOURS, NOT RGB555 BUCKETS. Bucketing first looks harmless - the fog map is
  RGB555 anyway - but it is the median cut's input, and rounding every channel to five bits
  before choosing 219 colours collapsed Baja Beach's 1,792 distinct terrain colours into 223
  buckets and left an RMS error of 4.07 where exact counting reaches 1.95. The cap is there so
  photographic model art cannot grow the map without bound; terrain tiles never approach it.
*/
const MAX_HISTOGRAM = 1 << 18;

export function sampleForPalette(histogram, rgba, budget = 4096) {
  const texels = rgba.length >> 2;
  const step = Math.max(1, Math.ceil(texels / budget));
  for (let i = 0; i < texels; i += step) {
    const at = i << 2;
    if (rgba[at + 3] < 128) continue;   // A transparent texel is never drawn, so never counted.
    const key = rgba[at] << 16 | rgba[at + 1] << 8 | rgba[at + 2];
    const seen = histogram.get(key);
    if (seen === undefined && histogram.size >= MAX_HISTOGRAM) continue;
    histogram.set(key, (seen ?? 0) + 1);
  }
  return histogram;
}

/*
  Median cut. Split the box that costs the most - its population times its longest side cubed -
  along that side at the weighted median, and keep going until there are `count` boxes. Each
  box becomes its population-weighted mean, which is what makes the result track the art's
  actual density rather than the corners of its bounding box.
*/
export function medianCutPalette(histogram, count) {
  const entries = [...histogram].map(([key, weight]) => ({
    rgb: [key >> 16 & 255, key >> 8 & 255, key & 255], weight,
  }));
  if (!entries.length) return colourCube();
  let boxes = [entries];
  while (boxes.length < count) {
    boxes.sort((a, b) => cost(b) - cost(a));
    const box = boxes[0];
    if (box.length < 2) break;
    boxes.shift();
    const axis = widestAxis(box);
    box.sort((a, b) => a.rgb[axis] - b.rgb[axis]);
    const total = box.reduce((sum, entry) => sum + entry.weight, 0);
    let seen = 0, cut = 1;
    for (let i = 0; i < box.length - 1; i++) {
      seen += box[i].weight;
      if (seen * 2 >= total) { cut = i + 1; break; }
    }
    boxes.push(box.slice(0, cut), box.slice(cut));
  }
  return boxes.map(mean);
}

function cost(box) {
  const weight = box.reduce((sum, entry) => sum + entry.weight, 0);
  return weight * Math.pow(Math.max(1, spread(box, widestAxis(box))), 3);
}
function widestAxis(box) {
  let axis = 0, best = -1;
  for (let c = 0; c < 3; c++) { const s = spread(box, c); if (s > best) { best = s; axis = c; } }
  return axis;
}
function spread(box, axis) {
  let low = 255, high = 0;
  for (const entry of box) { low = Math.min(low, entry.rgb[axis]); high = Math.max(high, entry.rgb[axis]); }
  return high - low;
}
function mean(box) {
  const weight = box.reduce((sum, entry) => sum + entry.weight, 0) || 1;
  return [0, 1, 2].map(c => Math.round(box.reduce((sum, e) => sum + e.rgb[c] * e.weight, 0) / weight));
}
function colourCube() {
  const out = [];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++)
    out.push([Math.round(r * 255 / 5), Math.round(g * 255 / 5), Math.round(b * 255 / 5)]);
  for (let i = 0; i < 4; i++) out.push([Math.round(i * 255 / 3), Math.round(i * 255 / 3), Math.round(i * 255 / 3)]);
  return out;
}

/** Build MTM2's RGB555-to-palette lookup table for the indexed-art loader. */
export function makeFogMap(palette) {
  const map = new Uint8Array(32 * 32 * 32);
  let offset = 0;
  for (let r5 = 0; r5 < 32; r5++) for (let g5 = 0; g5 < 32; g5++) for (let b5 = 0; b5 < 32; b5++) {
    const r = r5 * 8 + 3, g = g5 * 8 + 3, b = b5 * 8 + 3;
    let best = FIRST_AUTHORED, distance = Infinity;
    // MTM2 reserves the bottom ten entries and 230..255 for system/sky colours. White at 229
    // is a legitimate target for art even though the cut may not author it.
    for (let index = FIRST_AUTHORED; index <= WHITE_INDEX; index++) {
      const at = index * 3;
      const dr = palette[at] - r, dg = palette[at + 1] - g, db = palette[at + 2] - b;
      const candidate = dr * dr + dg * dg + db * db;
      if (candidate <= distance) { distance = candidate; best = index; }
    }
    map[offset++] = best;
  }
  // Byte zero is a palette selector an editor may scribble on, not an RGB555 entry. Every
  // stock FOG\<stem>.MAP stores 0 there and Traxx forces 0 back on save, so anything else is
  // a value the engine was never shipped.
  map[0] = 0;
  return map;
}
