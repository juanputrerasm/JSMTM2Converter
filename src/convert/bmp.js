/*
  The two 24-bit BMPs MTM2's track picker reads, both named in the situation file.

  The "Track Logo" slot is a 257x210 picture of the track and the "Track Map" slot a 32x24
  icon for the list; stock levels put a photograph in the first and a small name plate in the
  second. There is no photograph to convert, so the picture is drawn from the height field
  with the primary racing line over it - which is the one thing a converted track's picker
  entry can usefully say that a screenshot cannot.
*/

const WORLD = 256 * 64;   // MTM2 world units across the 256-cell grid.

export function terrainBmp(terrain, width = 257, height = 210, course = null) {
  const rowSize = (width * 3 + 3) & ~3;
  const pixels = new Uint8Array(rowSize * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.min(255, Math.round(x * 255 / Math.max(1, width - 1)));
    const sz = Math.min(255, Math.round((height - 1 - y) * 255 / Math.max(1, height - 1)));
    const h = terrain[sx + sz * 256];
    const at = y * rowSize + x * 3;
    pixels[at] = Math.round(h * 0.42); pixels[at + 1] = Math.min(255, 35 + h); pixels[at + 2] = Math.round(h * 0.55);
  }
  drawCourse(pixels, rowSize, width, height, course);
  const out = new Uint8Array(54 + pixels.length), view = new DataView(out.buffer);
  out.set([0x42, 0x4d]); view.setUint32(2, out.length, true); view.setUint32(10, 54, true);
  view.setUint32(14, 40, true); view.setInt32(18, width, true); view.setInt32(22, height, true);
  view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, pixels.length, true);
  out.set(pixels, 54); return out;
}

/*
  The primary course as a closed loop over the height shading. Course points are Evo world
  units, which is also what an MTM2 situation file stores: the file's half-unit convention
  and MTM2's doubled cell size cancel, so 0..8192 spans the whole picture either way.
*/
function drawCourse(pixels, rowSize, width, height, course) {
  const segments = course?.segments ?? [];
  if (segments.length < 2 || width < 64) return;
  const toPixel = ([x = 0, , z = 0]) => [
    clamp(Math.round(x / (WORLD / 2) * (width - 1)), 0, width - 1),
    clamp(Math.round((1 - z / (WORLD / 2)) * (height - 1)), 0, height - 1),
  ];
  for (const segment of segments) line(toPixel(segment.start ?? []), toPixel(segment.end ?? []));

  function line([x0, y0], [x1, y1]) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      plot(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t));
    }
  }
  // Two pixels wide, so the line survives the picker's own scaling.
  function plot(x, y) {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) {
      const px = x + dx, py = y + dy;
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      const at = py * rowSize + px * 3;
      pixels[at] = 32; pixels[at + 1] = 216; pixels[at + 2] = 255;   // BGR: MTM2 course yellow.
    }
  }
}

function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
