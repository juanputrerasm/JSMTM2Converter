/*
  Evo textures: indexed .RAW + .ACT with an optional .OPA opacity plane, or a .TIF.

  RAW/ACT/OPA decoding is OpenPhotex's (src/vendor/openphotex, the canonical Terminal Reality
  format library), shared with JSTrackViewer. Its palette rule reads an .ACT as 6-bit only when
  its brightest channel is exactly 63; the dark 8-bit sky and glare palettes (NITESKY, RAINSKY,
  GLARE) are used as stored rather than multiplied by four. The TIFF path stays here until TIFF
  is extracted too.
*/
import { applyOpacityPlane, decodeActPalette, decodeRawTexture, rawTextureSide } from "../../vendor/openphotex/index.js";
import { decodeTiffTexture, isTiff } from "./tiff-decoder.js";

export function rawSide(length) {
  return rawTextureSide(length, "evo");
}

export function decodeAct(bytes) {
  return decodeActPalette(bytes);
}

export function decodeEvoImage(image, act, opa, name) {
  if (isTiff(image)) return applyOpacityPlane(decodeTiffTexture(image, name), opa);
  const side = rawSide(image?.length ?? 0);
  const palette = decodeAct(act);
  if (!side) throw new Error(`${name}: unsupported indexed image size ${image?.length ?? 0}`);
  if (!palette) throw new Error(`${name}: missing or invalid ACT palette`);
  const { width, height, rgba } = decodeRawTexture(image, palette, { family: "evo" });
  return applyOpacityPlane({ name, width, height, rgba, hasAlpha: false }, opa);
}
