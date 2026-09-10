const CELLS = 256 * 256;

export function convertTerrain(raw16, courses = []) {
  if (!raw16 || raw16.length !== CELLS * 2) throw new Error("Evo terrain RAW must be exactly 131072 bytes.");
  const source = new Float32Array(CELLS);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < CELLS; i++) {
    const height = (raw16[i * 2] | raw16[i * 2 + 1] << 8) / 32;
    source[i] = height; min = Math.min(min, height); max = Math.max(max, height);
  }
  // MTM2 doubles Evo's horizontal world scale (64 versus 32 units per cell). Its rendered
  // terrain height is 3 * RAW, so 2/3 RAW levels per Evo foot preserves the original slope.
  // Only reduce that scale when the complete altitude range cannot fit in one byte.
  const scale = Math.min(2 / 3, 255 / Math.max(1, max - min));
  const output = new Uint8Array(CELLS);
  const mapHeight = height => Math.round((height - min) * scale);
  for (let i = 0; i < CELLS; i++) output[i] = clamp(mapHeight(source[i]), 0, 255);
  return { raw: output, source, min, max, scale, mapHeight: height => clamp(mapHeight(height), 0, 255) };
}

export function convertClr(evoClr) {
  if (!evoClr || evoClr.length !== CELLS * 2) throw new Error("Evo CLR must be exactly 131072 bytes.");
  return evoClr.slice();
}

function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
