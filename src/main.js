import { BUILD_ID } from "./build-info.js";

const fileInput = document.querySelector("#file-input");
const pickButton = document.querySelector("#pick-button");
const convertButton = document.querySelector("#convert-button");
const downloadButton = document.querySelector("#download-button");
const previewButton = document.querySelector("#preview-button");
const dropZone = document.querySelector("#drop-zone");
const terminal = document.querySelector("#terminal");
const bar = document.querySelector("#progress-bar");
const percent = document.querySelector("#progress-percent");
const fileLabel = document.querySelector("#file-label");
const truckPicker = document.querySelector("#truck-picker");
const truckSelect = document.querySelector("#truck-select");
const controls = document.querySelector("#controls");
const logPanel = document.querySelector("#log-panel");
/*
  What the selected archive turned out to hold. An Evo TRUCK.POD carries 150 vehicles, so the
  archive is inspected on selection and Convert stays disabled until that comes back - the
  picker has to be populated before the user can choose what to convert. Declared before the
  option wiring because syncOptions() reads it during the initial call below.
*/
let source = { mode: "track", trucks: [] };
/*
  The four conversion options. Read at Convert time rather than held in a variable, so the
  boxes always say what the next conversion will actually do.
*/
const optionBoxes = {
  hdArt: document.querySelector("#opt-hd-art"),
  rawFallback: document.querySelector("#opt-raw-fallback"),
  vegetationNonCollide: document.querySelector("#opt-veg-noncollide"),
  allObjectsNonCollide: document.querySelector("#opt-all-noncollide"),
};
const heightFactorInput = document.querySelector("#opt-height-factor");
const stemInput = document.querySelector("#opt-stem");
const readOptions = () => ({
  ...Object.fromEntries(Object.entries(optionBoxes).map(([key, box]) => [key, !!box?.checked])),
  heightFactor: Number.parseFloat(heightFactorInput?.value) || 1,
  stem: (stemInput?.value ?? "").trim(),
});
/*
  With HD art off the pod carries the legacy pair and nothing else, so "add the fallback" has
  nothing left to choose: it is forced on and disabled rather than silently ignored.
*/
function syncOptions() {
  const legacyOnly = !optionBoxes.hdArt.checked;
  optionBoxes.rawFallback.disabled = legacyOnly;
  optionBoxes.rawFallback.parentElement.classList.toggle("disabled", legacyOnly);
  if (legacyOnly) optionBoxes.rawFallback.checked = true;
}
/*
  Nothing but the archive box until an archive has been read, and then only the controls for
  what it turned out to hold: a track gets the scenery, terrain and file-stem options, a vehicle
  pack gets the truck picker, and both get the art options. `null` hides them all again, which
  is also where a failed read leaves the page.
*/
function showControls(mode) {
  controls.hidden = !mode;
  for (const element of document.querySelectorAll(".track-only")) element.hidden = mode !== "track";
  for (const element of document.querySelectorAll(".truck-only")) element.hidden = mode !== "truck";
}
optionBoxes.hdArt.addEventListener("change", syncOptions);
syncOptions();
let selectedFile = null, result = null, resultUrl = null, worker = null;

const log = (message, level = "info") => {
  const line = document.createElement("div"); line.className = `line ${level}`;
  line.textContent = `${level === "detail" ? "  " : "> "}${message}`; terminal.append(line); terminal.scrollTop = terminal.scrollHeight;
};
const progress = value => { const n = Math.max(0, Math.min(100, Math.round(value || 0))); bar.style.width = `${n}%`; percent.textContent = `${n}%`; };
function select(file) {
  if (!file) return;
  if (!/\.pod$/i.test(file.name)) { log("Please select an Evolution .POD archive (POD1 or POD2).", "error"); return; }
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  result = null; resultUrl = null;
  selectedFile = file; fileLabel.textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MiB`;
  convertButton.disabled = true; downloadButton.hidden = true; previewButton.hidden = true; progress(0);
  truckSelect.innerHTML = "";
  source = { mode: "track", trucks: [] };
  syncOptions();
  showControls(null);
  logPanel.hidden = false;
  log(`Selected ${file.name}. Reading the archive directory...`);
  inspect(file);
}

function inspect(file) {
  if (worker) worker.terminate();
  worker = new Worker(new URL("./converter-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = event => {
    const data = event.data;
    if (data.type === "inspected") {
      source = { mode: data.mode, trucks: data.trucks ?? [] };
      syncOptions();
      showControls(data.mode);
      if (data.mode === "truck") {
        truckSelect.innerHTML = source.trucks.map(truck => {
          const label = truck.name ? `${truck.title} — ${truck.name}` : truck.title;
          return `<option value="${escapeAttribute(truck.path)}">${escapeText(label)}</option>`;
        }).join("");
        truckPicker.hidden = source.trucks.length === 0;
        log(`Vehicle archive: ${data.entries} entries, ${source.trucks.length} Evo ${source.trucks[0]?.game ?? ""} truck${source.trucks.length === 1 ? "" : "s"}.`, "success");
        if (source.trucks.length > 1) log("Choose a vehicle, then convert.", "detail");
      } else {
        log(`Track archive (${data.format}): ${data.entries} entries${data.comment ? ` — ${data.comment}` : ""}. Evo ${data.version >= 7 ? 2 : 1} track ${data.sit}.`, "success");
      }
      convertButton.textContent = data.mode === "truck" ? "Convert to MTM2 2.1 truck" : "Convert to MTM2";
      convertButton.disabled = false;
    } else if (data.type === "error") {
      log(data.message, "error");
      convertButton.disabled = true;
      showControls(null);
    }
    worker?.terminate(); worker = null;
  };
  worker.onerror = event => { log(event.message || "Converter worker failed.", "error"); worker?.terminate(); worker = null; };
  worker.postMessage({ type: "inspect", file });
}

const escapeText = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = value => escapeText(value).replace(/"/g, "&quot;");

pickButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => select(fileInput.files[0]));
for (const type of ["dragenter", "dragover"]) dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add("dragging"); });
for (const type of ["dragleave", "drop"]) dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove("dragging"); });
dropZone.addEventListener("drop", event => select(event.dataTransfer.files[0]));

convertButton.addEventListener("click", () => {
  if (!selectedFile) return;
  if (worker) worker.terminate();
  if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }
  result = null;
  terminal.textContent = ""; progress(0); convertButton.disabled = true; downloadButton.hidden = true; previewButton.hidden = true;
  log(`UI BUILD ${BUILD_ID}`, "success");
  worker = new Worker(new URL("./converter-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = event => {
    const data = event.data;
    if (data.type === "progress") { log(data.message, data.level); progress(data.progress); }
    else if (data.type === "complete") {
      result = data; resultUrl = URL.createObjectURL(result.blob); downloadButton.hidden = false; previewButton.hidden = false; convertButton.disabled = false;
      downloadButton.textContent = `Download ${result.filename}`;
      previewButton.textContent = result.stats?.kind === "truck" ? "Preview in JSTruckViewer" : "Preview in JSTrackViewer";
      downloadButton.focus(); worker.terminate(); worker = null;
      if (sendToTrackViewer()) log("Preview updated in the open JSTrackViewer tab.", "success");
    } else if (data.type === "error") { log(data.message, "error"); progress(0); convertButton.disabled = false; worker.terminate(); worker = null; }
  };
  worker.onerror = event => { log(event.message || "Converter worker failed.", "error"); convertButton.disabled = false; worker?.terminate(); worker = null; };
  const options = readOptions();
  if (source.mode === "truck") options.truckPath = truckSelect.value || source.trucks[0]?.path || "";
  worker.postMessage({ type: "convert", file: selectedFile, mode: source.mode, options });
});
function download(output) {
  if (!output?.blob) return;
  // Use a fresh, short-lived URL for each download. The persistent URL belongs to the
  // JSTrackViewer preview window and must stay alive while that window reads it.
  const downloadUrl = URL.createObjectURL(output.blob);
  const link = document.createElement("a");
  link.href = downloadUrl; link.download = output.filename; link.hidden = true;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}
downloadButton.addEventListener("click", () => download(result));
/*
  The track preview is one JSTrackViewer tab that this page keeps hold of and posts each POD
  into, rather than a blob: URL handed over on its command line. That URL only resolves while
  this page lives and only where the browser agrees the two share storage - the case that
  failed for people running the converter anywhere but beside the viewer - and a posted Blob
  has neither condition. Keeping the tab also means every later conversion lands in it
  automatically, so adjusting an option and converting again is the whole loop.

  The viewer says when it is listening (see its app.js); until then a result waits here.
*/
const TRACK_VIEWER_URL = new URL("../JSTrackViewer/?handoff=1", location.href);
let trackViewer = null, trackViewerReady = false;
window.addEventListener("message", event => {
  if (!trackViewer || event.source !== trackViewer || event.data?.type !== "jstrackviewer:ready") return;
  trackViewerReady = true;
  sendToTrackViewer();
});
function sendToTrackViewer() {
  if (!trackViewer || trackViewer.closed || !trackViewerReady || !result?.blob || result.stats?.kind === "truck") return false;
  // Addressed to the viewer's own origin, so a tab that has navigated elsewhere is sent nothing.
  trackViewer.postMessage({ type: "jstrackviewer:pod", name: result.filename, blob: result.blob }, TRACK_VIEWER_URL.origin);
  return true;
}
/*
  Whether the viewer is actually there, asked when the button is clicked rather than at load.

  Both viewers are meant to sit beside this page - published that way they are sibling paths on
  one origin, which is exactly what lets the handoff above post a Blob across - but nothing
  guarantees that layout. Serve this converter on its own, or open it over file://, and there is
  no viewer to hand anything to; window.open would then leave a dead tab rather than an answer,
  so say so instead. A viewer that answers is remembered, a silent one is not, so starting it and
  clicking again works without reloading this page.
*/
const viewersFound = new Set();
async function viewerReachable(url) {
  if (viewersFound.has(url.href)) return true;
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 6000);
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store", signal: stop.signal });
    if (!response.ok) return false;
    viewersFound.add(url.href);
    return true;
  } catch {
    // A blocked, refused or cross-origin request all mean the same thing here: nothing to open.
    return false;
  } finally {
    clearTimeout(timer);
  }
}
previewButton.addEventListener("click", async () => {
  if (!result?.blob) return;
  const truck = result.stats?.kind === "truck";
  const viewerName = truck ? "JSTruckViewer" : "JSTrackViewer";
  const viewerUrl = truck ? new URL("../JSTruckViewer/", location.href) : TRACK_VIEWER_URL;
  /*
    A tab this page opened and still holds has already proved the viewer is there, so it is sent
    the POD without a probe. Everything else is checked first.
  */
  if (!(!truck && trackViewer && !trackViewer.closed)) {
    previewButton.disabled = true;
    const reachable = await viewerReachable(viewerUrl);
    previewButton.disabled = false;
    if (!reachable) {
      // The plain address, without the handoff flag the viewer is opened with internally.
      const viewerHome = `${viewerUrl.origin}${viewerUrl.pathname}`;
      log(`${viewerName} is not answering at ${viewerHome}, so there is nothing to preview into. Open ${viewerName} there first - it has to be served beside this converter - then click Preview again.`, "error");
      log(`Your converted ${truck ? "truck" : "track"} is not lost: Download ${result.filename} still writes it out, and ${viewerName} can open that file directly.`, "detail");
      return;
    }
  }
  if (truck) {
    // JSTruckViewer takes the in-memory POD under the query name it already understands.
    viewerUrl.searchParams.set("file", resultUrl);
    window.open(viewerUrl, "_blank", "noopener");
    return;
  }
  if (trackViewer && !trackViewer.closed) {
    if (!sendToTrackViewer()) log("JSTrackViewer is still starting; the track will load as soon as it is ready.", "detail");
    trackViewer.focus();
    return;
  }
  trackViewerReady = false;
  trackViewer = window.open(TRACK_VIEWER_URL, "jstrackviewer");
  if (!trackViewer) log("The browser blocked the preview window. Allow pop-ups for this page and try again.", "error");
});

log(`JSMTM2Converter ready — UI BUILD ${BUILD_ID}`, "success");
log("Select or drop an Evo 1/Evo 2 archive (POD1 or POD2) — a track or a vehicle pack. Processing stays inside this browser.");
