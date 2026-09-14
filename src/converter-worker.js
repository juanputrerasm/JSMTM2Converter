import { convertTrack, locateEvoTrack } from "./convert/track-converter.js";
import { convertTruck, listEvoTrucks } from "./convert/truck-converter.js";
import { readPod } from "./formats/pod2-reader.js";

/*
  One archive can hold either kind of source, and an Evo TRUCK.POD holds 150 vehicles at once,
  so the page inspects an archive before offering Convert: "inspect" reports what is in there
  and, for a vehicle archive, the list to choose from. Tracks are accepted in POD1 or POD2 and
  recognised by their .SIT; see locateEvoTrack.
*/
self.onmessage = async event => {
  const request = event.data ?? {};
  try {
    if (request.type === "inspect") {
      self.postMessage({ type: "inspected", ...await inspect(request.file) });
      return;
    }
    if (request.type !== "convert") return;
    const report = update => self.postMessage({ type: "progress", ...update });
    const result = request.mode === "truck"
      ? await convertTruck(request.file, report, request.options)
      : await convertTrack(request.file, report, request.options);
    self.postMessage({ type: "complete", ...result });
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message || String(error), stack: error?.stack || "" });
  }
};

async function inspect(file) {
  const pod = await readPod(file);
  const hasTrack = pod.entries.some(entry => entry.title.endsWith(".SIT"));
  const hasTrucks = pod.entries.some(entry => entry.normalizedName.startsWith("TRUCK/") && entry.title.endsWith(".TRK"));
  if (!hasTrack && !hasTrucks) throw new Error(`This ${pod.format} archive holds neither an Evo .SIT track nor a TRUCK\\*.TRK vehicle.`);
  // A track archive is the older behaviour and stays the default when an archive somehow has
  // both, since that is what the situation file describes.
  if (hasTrack) {
    try {
      const { entry, version } = await locateEvoTrack(pod);
      return { mode: "track", format: pod.format, entries: pod.entries.length, comment: pod.comment, sit: entry.name, version, trucks: [] };
    } catch (error) {
      if (!hasTrucks) throw error;
    }
  }
  if (pod.format !== "POD2") throw new Error(`Evo vehicle archives are read from POD2; this one is ${pod.format}.`);
  return { mode: "truck", ...await listEvoTrucks(file) };
}
