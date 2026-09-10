import { normalizePath, title } from "../shared/paths.js";

const HEADER_SIZE = 0x60;
const RECORD_SIZE = 20;

export async function readPod2(file) {
  if (!(file instanceof Blob) || file.size < HEADER_SIZE) throw new Error("Input is too small to be a POD2 archive.");
  const header = new Uint8Array(await file.slice(0, HEADER_SIZE).arrayBuffer());
  if (new TextDecoder("latin1").decode(header.subarray(0, 4)) !== "POD2") {
    throw new Error("Input is not a POD2 archive (missing POD2 signature).");
  }
  const head = new DataView(header.buffer);
  const count = head.getUint32(0x58, true);
  if (count < 1 || count > 65536) throw new Error(`Suspicious POD2 entry count: ${count}`);
  const tableEnd = HEADER_SIZE + count * RECORD_SIZE;
  if (tableEnd > file.size) throw new Error("POD2 directory exceeds the input file.");
  const tableBytes = new Uint8Array(await file.slice(HEADER_SIZE, tableEnd).arrayBuffer());
  const table = new DataView(tableBytes.buffer);
  let firstPayload = file.size;
  for (let i = 0; i < count; i++) {
    const offset = table.getUint32(i * RECORD_SIZE + 8, true);
    if (offset >= tableEnd && offset < firstPayload) firstPayload = offset;
  }
  if (firstPayload < tableEnd) throw new Error("POD2 payload overlaps its directory.");
  const names = new Uint8Array(await file.slice(tableEnd, firstPayload).arrayBuffer());
  const decoder = new TextDecoder("latin1");
  const entries = [];
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    const at = i * RECORD_SIZE;
    const nameOffset = table.getUint32(at, true);
    const length = table.getUint32(at + 4, true);
    const offset = table.getUint32(at + 8, true);
    if (nameOffset >= names.length) throw new Error(`POD2 entry ${i} has an invalid name offset.`);
    if (offset > file.size || length > file.size - offset) throw new Error(`POD2 entry ${i} lies outside the file.`);
    let end = nameOffset;
    while (end < names.length && names[end] !== 0) end++;
    if (end === names.length) throw new Error(`POD2 entry ${i} has an unterminated name.`);
    const name = decoder.decode(names.subarray(nameOffset, end)).trim();
    const normalizedName = normalizePath(name);
    if (!name || seen.has(normalizedName)) throw new Error(`Duplicate or empty POD2 path: ${name || `(entry ${i})`}`);
    seen.add(normalizedName);
    entries.push({ name, normalizedName, title: title(name), offset, length });
  }
  const commentEnd = header.subarray(8, 88).indexOf(0);
  const commentBytes = header.subarray(8, commentEnd < 0 ? 88 : 8 + commentEnd);
  const archive = { format: "POD2", file, comment: decoder.decode(commentBytes).trim(), entries };
  archive.byPath = new Map(entries.map(entry => [entry.normalizedName, entry]));
  archive.byTitle = new Map();
  for (const entry of entries) if (!archive.byTitle.has(entry.title)) archive.byTitle.set(entry.title, entry);
  return archive;
}

export function findEntry(archive, name) {
  const normalized = normalizePath(name);
  return archive.byPath.get(normalized) ?? archive.byTitle.get(title(normalized)) ?? null;
}

export function resolveEntry(archive, name, preferredFolder = "") {
  if (!name) return null;
  const normalized = normalizePath(name);
  if (preferredFolder) {
    const preferred = archive.byPath.get(`${normalizePath(preferredFolder)}/${title(normalized)}`);
    if (preferred) return preferred;
  }
  return findEntry(archive, normalized);
}

export async function readEntry(archive, entry) {
  return new Uint8Array(await archive.file.slice(entry.offset, entry.offset + entry.length).arrayBuffer());
}
