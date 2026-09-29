/*
  The MTM2 2.1 truck manifest.

  The layout is OpenPhotex's writeMtm2Trk: the stock field order, the wheel anchors grouped by
  axis (Evo lists them per wheel), one labelled "Scrape point N" line per point (Evo writes one
  unlabelled "sc[].pt" run), six-decimal numbers, and the 2.1 header and second axle-bar set.

  The 2.1 header is what activates the patched engine's extended loading. Its two published
  capabilities are four distinct high-detail wheels and a second axle-bar set; Evo supplies
  neither, so the converter writes the header and the second bar set (derived from the axle
  geometry) and leaves the wheel set at the classic left/right pair, which 2.1 still reads.
*/
export { writeMtm2Trk as writeMtm2Truck } from "../../vendor/openphotex/index.js";
