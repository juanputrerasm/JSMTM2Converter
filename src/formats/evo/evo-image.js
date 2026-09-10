import { decodeTiffTexture, isTiff } from "./tiff-decoder.js";

export function rawSide(length) {
  for (let side = 8; side <= 2048; side <<= 1) if (length === side * side) return side;
  return 0;
}

export function decodeAct(bytes) {
  if (!bytes || bytes.length < 768) return null;
  const palette = new Uint8Array(768);
  let max = 0;
  for (let i = 0; i < 768; i++) max = Math.max(max, bytes[i]);
  const scale = max <= 63 ? 4 : 1;
  for (let i = 0; i < 768; i++) palette[i] = Math.min(255, bytes[i] * scale);
  return palette;
}

export function decodeEvoImage(image, act, opa, name) {
  if (isTiff(image)) return withOpacity(decodeTiffTexture(image, name), opa);
  const side = rawSide(image?.length ?? 0);
  const palette = decodeAct(act);
  if (!side) throw new Error(`${name}: unsupported indexed image size ${image?.length ?? 0}`);
  if (!palette) throw new Error(`${name}: missing or invalid ACT palette`);
  const rgba = new Uint8Array(side * side * 4);
  for (let i = 0; i < image.length; i++) {
    const p = image[i] * 3, o = i * 4;
    rgba[o] = palette[p]; rgba[o + 1] = palette[p + 1]; rgba[o + 2] = palette[p + 2]; rgba[o + 3] = 255;
  }
  return withOpacity({ name, width: side, height: side, rgba, hasAlpha: false }, opa);
}

function withOpacity(decoded, opacity) {
  if (!opacity || opacity.length !== decoded.width * decoded.height) return decoded;
  for (let i = 0; i < opacity.length; i++) decoded.rgba[i * 4 + 3] = opacity[i];
  return { ...decoded, hasAlpha: true };
}
