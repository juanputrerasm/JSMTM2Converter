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
const readOptions = () => Object.fromEntries(Object.entries(optionBoxes).map(([key, box]) => [key, !!box?.checked]));
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
  if (!/\.pod$/i.test(file.name)) { log("Please select an Evolution POD2 .POD archive.", "error"); return; }
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  result = null; resultUrl = null;
  selectedFile = file; fileLabel.textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MiB`; convertButton.disabled = false; downloadButton.hidden = true; previewButton.hidden = true; progress(0);
  log(`Selected ${file.name}. Ready to convert.`);
}

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
      downloadButton.focus(); worker.terminate(); worker = null;
    } else if (data.type === "error") { log(data.message, "error"); progress(0); convertButton.disabled = false; worker.terminate(); worker = null; }
  };
  worker.onerror = event => { log(event.message || "Converter worker failed.", "error"); convertButton.disabled = false; worker?.terminate(); worker = null; };
  worker.postMessage({ type: "convert", file: selectedFile, options: readOptions() });
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
previewButton.addEventListener("click", () => {
  if (!resultUrl) return;
  const viewer = new URL("../JSTrackViewer/", location.href);
  viewer.searchParams.set("pod", resultUrl);
  window.open(viewer, "_blank", "noopener");
});

log(`JSMTM2Converter ready — UI BUILD ${BUILD_ID}`, "success");
log("Select or drop an Evo 1/Evo 2 POD2 track. Processing stays inside this browser.");
