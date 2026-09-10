import { normalizePath } from "../shared/paths.js";

const COMMENT_BYTES = 80;
const HEADER_BYTES = 4 + COMMENT_BYTES;
const MAX_ENTRIES = 8192;
const CLASSIC = { format: "POD1", nameBytes: 32, recordBytes: 40, maxPathBytes: 31 };

/** Write the classic 32-byte-name POD1 layout used by the original MTM2 engine. */
export function writePod1(comment, entries) { return writePod(comment, entries, CLASSIC); }

export function validatePod1(blob) { return validatePod(blob, CLASSIC); }

function writePod(comment, inputEntries, layout) {
  if (!inputEntries.length) throw new Error("Cannot write an empty POD.");
  if (inputEntries.length > MAX_ENTRIES) throw new Error(`${layout.format} supports at most ${MAX_ENTRIES} entries.`);
  const entries = [...inputEntries].map(entry => ({
    name: normalizePath(entry.name).replace(/\//g, "\\"),
    data: entry.data,
  }));
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Set();
  for (const entry of entries) {
    const encoded = new TextEncoder().encode(entry.name);
    if (!entry.name || encoded.length > layout.maxPathBytes) throw new Error(`${layout.format} path exceeds ${layout.maxPathBytes} bytes: ${entry.name}`);
    if (entry.name.includes("..") || entry.name.includes(":")) throw new Error(`Unsafe POD path: ${entry.name}`);
    const key = entry.name.toUpperCase();
    if (seen.has(key)) throw new Error(`Duplicate POD path: ${entry.name}`);
    if (!(entry.data instanceof Uint8Array) && !(entry.data instanceof Blob)) throw new Error(`Invalid payload: ${entry.name}`);
    seen.add(key);
  }

  const directoryEnd = HEADER_BYTES + entries.length * layout.recordBytes;
  const directory = new Uint8Array(directoryEnd);
  const view = new DataView(directory.buffer);
  view.setUint32(0, entries.length, true);
  writeAscii(directory, 4, COMMENT_BYTES, comment || "Converted by JSMTM2Converter");
  let payloadOffset = directoryEnd;
  entries.forEach((entry, i) => {
    const at = HEADER_BYTES + i * layout.recordBytes;
    writeAscii(directory, at, layout.nameBytes, entry.name);
    const size = entry.data instanceof Blob ? entry.data.size : entry.data.byteLength;
    view.setUint32(at + layout.nameBytes, size, true);
    view.setUint32(at + layout.nameBytes + 4, payloadOffset, true);
    payloadOffset += size;
    if (payloadOffset > 0xffffffff) throw new Error(`${layout.format} output exceeds the 4 GiB offset limit.`);
  });
  return new Blob([directory, ...entries.map(entry => entry.data)], { type: "application/octet-stream" });
}

/** Re-read an entire directory and reject malformed or overlapping records. */
async function validatePod(blob, layout) {
  if (blob.size < HEADER_BYTES) throw new Error("Generated POD is truncated.");
  const head = new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer());
  const count = new DataView(head.buffer).getUint32(0, true);
  const tableEnd = HEADER_BYTES + count * layout.recordBytes;
  if (!count || count > MAX_ENTRIES || tableEnd > blob.size) throw new Error(`Generated ${layout.format} directory is invalid.`);
  const bytes = new Uint8Array(await blob.slice(HEADER_BYTES, tableEnd).arrayBuffer());
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder("latin1");
  const names = new Set();
  let priorPayloadEnd = tableEnd;
  for (let i = 0; i < count; i++) {
    const at = i * layout.recordBytes;
    let end = at;
    while (end < at + layout.nameBytes && bytes[end] !== 0) end++;
    if (end === at + layout.nameBytes) throw new Error(`Generated ${layout.format} entry ${i} has no name terminator.`);
    const name = decoder.decode(bytes.subarray(at, end));
    const length = view.getUint32(at + layout.nameBytes, true);
    const offset = view.getUint32(at + layout.nameBytes + 4, true);
    if (!name || names.has(name.toUpperCase())) throw new Error(`Generated ${layout.format} has duplicate/empty entry ${i}.`);
    if (offset < priorPayloadEnd || offset > blob.size || length > blob.size - offset) throw new Error(`Generated ${layout.format} entry ${name} is out of bounds or overlaps another entry.`);
    priorPayloadEnd = offset + length;
    names.add(name.toUpperCase());
  }
  return { count, names, format: layout.format };
}

function writeAscii(target, offset, width, value) {
  const bytes = new TextEncoder().encode(String(value));
  target.set(bytes.subarray(0, width - 1), offset);
}
