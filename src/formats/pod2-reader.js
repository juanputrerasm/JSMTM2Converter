/*
  Reading the archive an Evo track or truck arrives in.

  Parsing is OpenPhotex's (src/vendor/openphotex, the canonical Terminal Reality format
  library): this file reads only the directory out of the input Blob, hands it over, and keeps
  the converter's own rules on top. Do not add POD format knowledge here; change OpenPhotex and
  re-vendor it.
*/
import { parsePod, podDirectoryEnd } from "../vendor/openphotex/index.js";
import { normalizePath, title } from "../shared/paths.js";

// The spellings this converter has always reported, in messages and results.
const FORMAT_NAMES = { pod1: "POD1", pod2: "POD2", epd: "EPD" };

/** A POD2 archive, which Evo vehicle archives always are. */
export async function readPod2(file) {
  if (!(file instanceof Blob) || file.size < 4) throw new Error("Input is too small to be a POD2 archive.");
  const signature = new TextDecoder("latin1").decode(new Uint8Array(await file.slice(0, 4).arrayBuffer()));
  if (signature !== "POD2") throw new Error("Input is not a POD2 archive (missing POD2 signature).");
  return readPod(file);
}

/*
  Either container an Evo track can arrive in.

  The stock games ship POD2, but tracks have been repacked as POD1 for years - several of
  OOPS's Evo 2 releases are POD1 - and the container says nothing about what is inside it. The
  situation file is what does, so the archive is opened however it is packed and the caller
  looks for an Evo .SIT in it (see locateEvoTrack in track-converter.js).
*/
export async function readPod(file) {
  if (!(file instanceof Blob) || file.size < 4) throw new Error("Input is too small to be a POD archive.");
  let prefix = new Uint8Array(0);
  for (;;) {
    const need = podDirectoryEnd(prefix, file.size);
    if (need <= prefix.length) break;
    prefix = new Uint8Array(await file.slice(0, need).arrayBuffer());
  }
  const pod = parsePod(prefix, { byteLength: file.size });
  return indexArchive({
    format: FORMAT_NAMES[pod.format],
    file,
    comment: pod.comment,
    entries: withoutRepeatedPaths(pod),
  });
}

/*
  The engine serves the first copy of a name it meets, so a repeated POD1 entry is dropped
  rather than rejected; community packers do write them. A POD2 duplicate is still an error,
  since no packer writes one.
*/
function withoutRepeatedPaths(pod) {
  const seen = new Set();
  const entries = [];
  for (const entry of pod.entries) {
    if (seen.has(entry.normalizedName)) {
      if (pod.format === "pod2") throw new Error(`Duplicate or empty POD2 path: ${entry.name}`);
      continue;
    }
    seen.add(entry.normalizedName);
    entries.push(entry);
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
