export class ByteWriter {
  constructor() { this.parts = []; this.length = 0; }
  bytes(value) { const part = value instanceof Uint8Array ? value : new Uint8Array(value); this.parts.push(part); this.length += part.length; return this; }
  u32(value) { const part = new Uint8Array(4); new DataView(part.buffer).setUint32(0, value >>> 0, true); return this.bytes(part); }
  i32(value) { const part = new Uint8Array(4); new DataView(part.buffer).setInt32(0, Math.round(value), true); return this.bytes(part); }
  fixed(value, width) { const part = new Uint8Array(width); part.set(new TextEncoder().encode(String(value)).subarray(0, width - 1)); return this.bytes(part); }
  finish() { const output = new Uint8Array(this.length); let at = 0; for (const part of this.parts) { output.set(part, at); at += part.length; } return output; }
}
