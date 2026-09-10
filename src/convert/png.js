const encoder = new TextEncoder();

export async function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error("PNG pixel buffer has the wrong size.");
  if (typeof CompressionStream !== "function") throw new Error("This browser lacks CompressionStream support.");
  const scanlines = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) scanlines.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const compressed = new Uint8Array(await new Response(new Blob([scanlines]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return concat(new Uint8Array([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", new Uint8Array()));
}

function chunk(type, data) {
  const name = encoder.encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(name, 4); out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
