const CELLS = 256 * 256;

/*
  MTM2 doubles Evo's horizontal scale (64 versus 32 units per cell) and draws terrain at 3 world
  units per RAW level, so 2/3 RAW levels per Evo foot keeps every slope exactly as authored.
*/
const TRUE_SCALE = 2 / 3;
export const HEIGHT_FACTOR_RANGE = [0.25, 4];

/*
  The 16-bit Evo height field into MTM2's single byte.

  By default the whole altitude range is fitted linearly: 2/3 RAW levels per foot when it fits,
  and less when it does not, which is the only thing an 8-bit field can do with a tall track -
  Deja Voodoo's 724 ft go in at 0.352, a little over half their true slope.

  `heightFactor` scales that fit, for a track that reads better with its hills restored at the
  cost of what lies far from the course. Above 1 the byte can no longer hold the whole range, so
  a 255-level window is chosen and everything outside it is clamped flat. The window is centred
  on the racing line rather than pinned to the lowest valley, because the course is what has to
  keep its shape; distant peaks are what can afford to lose theirs. The caller reports how many
  cells were clamped so the trade is visible before the track is saved.
*/
export function convertTerrain(raw16, courses = [], heightFactor = 1) {
  if (!raw16 || raw16.length !== CELLS * 2) throw new Error("Evo terrain RAW must be exactly 131072 bytes.");
  const source = new Float32Array(CELLS);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < CELLS; i++) {
    const height = (raw16[i * 2] | raw16[i * 2 + 1] << 8) / 32;
    source[i] = height; min = Math.min(min, height); max = Math.max(max, height);
  }
  const range = Math.max(1, max - min);
  const autoScale = Math.min(TRUE_SCALE, 255 / range);
  const factor = clamp(Number(heightFactor) || 1, HEIGHT_FACTOR_RANGE[0], HEIGHT_FACTOR_RANGE[1]);
  const scale = autoScale * factor;
  const span = 255 / scale;
  const course = courseAltitudes(courses);
  let base = min;
  if (span < range) {
    const centre = course ? (course[0] + course[1]) / 2 : min + span / 2;
    base = clamp(centre - span / 2, min, max - span);
  }
  const unclamped = height => Math.round((height - base) * scale);
  const output = new Uint8Array(CELLS);
  let clampedLow = 0, clampedHigh = 0;
  for (let i = 0; i < CELLS; i++) {
    const level = unclamped(source[i]);
    if (level < 0) clampedLow++; else if (level > 255) clampedHigh++;
    output[i] = clamp(level, 0, 255);
  }
  return {
    raw: output, source, min, max, scale, autoScale, trueScale: TRUE_SCALE, factor, base,
    clamped: { low: clampedLow, high: clampedHigh }, course,
    courseClamped: !!course && (unclamped(course[0]) < 0 || unclamped(course[1]) > 255),
    mapHeight: height => clamp(unclamped(height), 0, 255),
  };
}

// The lowest and highest point the racing lines pass through, or null for a track without one.
function courseAltitudes(courses) {
  let low = Infinity, high = -Infinity;
  for (const course of courses ?? []) for (const segment of course?.segments ?? []) {
    for (const point of [segment.start, segment.end]) {
      const height = point?.[1];
      if (Number.isFinite(height)) { low = Math.min(low, height); high = Math.max(high, height); }
    }
  }
  return low <= high ? [low, high] : null;
}

export function convertClr(evoClr) {
  if (!evoClr || evoClr.length !== CELLS * 2) throw new Error("Evo CLR must be exactly 131072 bytes.");
  return evoClr.slice();
}

function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
