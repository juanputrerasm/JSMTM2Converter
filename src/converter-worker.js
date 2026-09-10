import { convertTrack } from "./convert/track-converter.js";

self.onmessage = async event => {
  if (event.data?.type !== "convert") return;
  try {
    const result = await convertTrack(event.data.file, update => self.postMessage({ type: "progress", ...update }), event.data.options);
    self.postMessage({ type: "complete", ...result });
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message || String(error), stack: error?.stack || "" });
  }
};
