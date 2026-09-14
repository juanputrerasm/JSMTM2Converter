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
  return indexArchive({ format: "POD2", file, comment: decoder.decode(commentBytes).trim(), entries });
}

/*
  Either container an Evo track can arrive in.

  The stock games ship POD2, but tracks have been repacked as POD1 for years - several of
  OOPS's Evo 2 releases are POD1 - and the container says nothing about what is inside it. The
  situation file is what does, so the archive is opened however it is packed and the caller
  looks for an Evo .SIT in it (see locateEvoTrack in track-converter.js).

  POD2 announces itself with a signature. POD1 has none, so its directory is validated
  instead: the classic 32-byte name field first, then Community Patch 3's widened 64-byte
  one - the same order and the same checks as JSTrackViewer's pod-format.js.
*/
export async function readPod(file) {
  if (!(file instanceof Blob) || file.size < 4) throw new Error("Input is too small to be a POD archive.");
  const signature = new TextDecoder("latin1").decode(new Uint8Array(await file.slice(0, 4).arrayBuffer()));
  return signature === "POD2" ? readPod2(file) : readPod1(file);
}

const POD1_HEADER_SIZE = 84;
const POD1_MAX_ENTRIES = 8192;
const POD1_LAYOUTS = [
  { format: "POD1", nameBytes: 32, recordBytes: 40 },
  { format: "Extended POD1", nameBytes: 64, recordBytes: 72 },
];

async function readPod1(file) {
  if (file.size < POD1_HEADER_SIZE) throw new Error("Input is too small to be a POD archive.");
  const header = new Uint8Array(await file.slice(0, POD1_HEADER_SIZE).arrayBuffer());
  const count = new DataView(header.buffer).getUint32(0, true);
  if (count < 1 || count > POD1_MAX_ENTRIES) throw new Error("Input is neither a POD2 archive nor a plausible POD1 directory.");
  const decoder = new TextDecoder("latin1");
  const commentEnd = header.subarray(4, 84).indexOf(0);
  const comment = decoder.decode(header.subarray(4, commentEnd < 0 ? 84 : 4 + commentEnd)).trim();
  for (const layout of POD1_LAYOUTS) {
    const entries = await readPod1Directory(file, count, layout, decoder);
    if (entries) return indexArchive({ format: layout.format, file, comment, entries });
  }
  throw new Error("Input is neither a POD2 archive nor a valid POD1 directory (32- or 64-byte names).");
}

// Null when the directory does not fit this layout, so the caller can try the next one.
async function readPod1Directory(file, count, { nameBytes, recordBytes }, decoder) {
  const tableEnd = POD1_HEADER_SIZE + count * recordBytes;
  if (tableEnd > file.size) return null;
  const table = new Uint8Array(await file.slice(POD1_HEADER_SIZE, tableEnd).arrayBuffer());
  const view = new DataView(table.buffer);
  const entries = [], seen = new Set();
  for (let i = 0; i < count; i++) {
    const at = i * recordBytes;
    let end = at;
    while (end < at + nameBytes && table[end] !== 0) end++;
    if (end === at + nameBytes) return null;
    const name = decoder.decode(table.subarray(at, end)).trim();
    const length = view.getUint32(at + nameBytes, true);
    const offset = view.getUint32(at + nameBytes + 4, true);
    if (!name || /[\0-\x1f:]/.test(name) || offset > file.size || length > file.size - offset) return null;
    const normalizedName = normalizePath(name);
    // The engine serves the first copy of a name it meets, so a repeated entry is ignored
    // rather than rejected; a POD2 duplicate is still an error, since no packer writes one.
    if (seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    entries.push({ name, normalizedName, title: title(name), offset, length });
  }
  return entries;
}

function indexArchive(archive) {
  archive.byPath = new Map(archive.entries.map(entry => [entry.normalizedName, entry]));
  archive.byTitle = new Map();
  for (const entry of archive.entries) if (!archive.byTitle.has(entry.title)) archive.byTitle.set(entry.title, entry);
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
