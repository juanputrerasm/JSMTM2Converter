/*
  Packing converted files as a POD1 the MTM2 engine mounts.

  The POD1 format itself (the 40-byte record, the 31-byte name budget, offsets) is OpenPhotex's
  (src/vendor/openphotex); this file keeps the converter's packing policy on top: its default
  comment, upper-case backslash names in sorted order, and a re-read of what it wrote.
*/
import { buildPod1Directory, parsePod, podDirectoryEnd } from "../vendor/openphotex/index.js";
import { normalizePath } from "../shared/paths.js";

const COMMENT_CHARS = 79;

/** Write the classic 32-byte-name POD1 layout used by the original MTM2 engine. */
export function writePod1(comment, inputEntries) {
  if (!inputEntries.length) throw new Error("Cannot write an empty POD.");
  const entries = [...inputEntries].map(entry => ({
    name: normalizePath(entry.name).replace(/\//g, "\\"),
    data: entry.data,
  }));
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.includes("..")) throw new Error(`Unsafe POD path: ${entry.name}`);
    if (!(entry.data instanceof Uint8Array) && !(entry.data instanceof Blob)) throw new Error(`Invalid payload: ${entry.name}`);
  }
  // The comment is display text; a long track name is cut to the field rather than refused.
  const text = String(comment || "Converted by JSMTM2Converter").slice(0, COMMENT_CHARS);
  const directory = buildPod1Directory(text, entries.map(entry => ({ name: entry.name, length: sizeOf(entry.data) })));
  return new Blob([directory, ...entries.map(entry => entry.data)], { type: "application/octet-stream" });
}

/** Re-read an entire directory and reject malformed, duplicate or overlapping records. */
export async function validatePod1(blob) {
  let prefix = new Uint8Array(0);
  for (;;) {
    const need = podDirectoryEnd(prefix, blob.size);
    if (need <= prefix.length) break;
    prefix = new Uint8Array(await blob.slice(0, need).arrayBuffer());
  }
  let pod;
  try {
    pod = parsePod(prefix, { byteLength: blob.size });
  } catch (error) {
    throw new Error(`Generated POD1 directory is invalid: ${error.message}`);
  }
  if (pod.format !== "pod1") throw new Error(`Generated archive reads as ${pod.format}, not POD1.`);
  const names = new Set();
  let priorPayloadEnd = pod.directoryEnd;
  for (const entry of pod.entries) {
    const key = entry.name.toUpperCase();
    if (names.has(key)) throw new Error(`Generated POD1 has duplicate entry ${entry.index}.`);
    if (entry.offset < priorPayloadEnd) throw new Error(`Generated POD1 entry ${entry.name} overlaps another entry.`);
    priorPayloadEnd = entry.offset + entry.length;
    names.add(key);
  }
  return { count: pod.entries.length, names, format: "POD1" };
}

function sizeOf(data) {
  return data instanceof Blob ? data.size : data.byteLength;
}
