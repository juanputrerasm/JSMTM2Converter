import { medianCutPalette, sampleForPalette } from "./palette.js";

/*
  The legacy texture pair: an 8-bit ART\<stem>.RAW of palette indices beside its own
  ART\<stem>.ACT.

  This is not a downgrade for its own sake. The software renderer has no HD path at all, and
  an unmodified 1998 install has neither - so a pod that ships only PNG is invisible to the
  first and unusable by the second. Packing the pair is also what decides the situation file's
  extension: Traxx's rule is .SIT with the fallback and .SI2 without it, precisely so a track
  that would load wrong on a stock install is never offered to one.

  Each texture carries its own palette, exactly as Evo's art and MTM2's stock art both do, so
  a 64x64 tile keeps essentially all of its colour. That is a different thing from the level
  palette in palette.js, which every texture in the track has to share.
*/

/** Quantises one decoded RGBA image into an MTM2 .RAW index plane and its 256-entry .ACT. */
export function quantizeToRawAct(rgba, width, height) {
  if (width !== height) throw new Error(`Legacy RAW art must be square, got ${width}x${height}`);
  /*
    Legacy art keys transparency on palette index 0 - PNG and TGA are the formats where alpha
    is authoritative and no colour is magic. So a texture with real alpha gives up index 0 to
    it and quantises into the remaining 255; one without keeps all 256.
  */
  const keyed = hasAlpha(rgba);
  const first = keyed ? 1 : 0;
  const palette = medianCutPalette(sampleForPalette(new Map(), rgba, width * height), 256 - first);

  const act = new Uint8Array(768);
  for (let i = 0; i < palette.length; i++) act.set(palette[i], (first + i) * 3);
  const raw = new Uint8Array(width * height);
  for (let i = 0; i < raw.length; i++) {
    const at = i << 2;
    if (keyed && rgba[at + 3] < 128) { raw[i] = 0; continue; }
    let best = first, distance = Infinity;
    for (let index = 0; index < palette.length; index++) {
      const [r, g, b] = palette[index];
      const dr = r - rgba[at], dg = g - rgba[at + 1], db = b - rgba[at + 2];
      const candidate = dr * dr + dg * dg + db * db;
      if (candidate < distance) { distance = candidate; best = first + index; }
    }
    raw[i] = best;
  }
  return { raw, act };
}

function hasAlpha(rgba) {
  for (let at = 3; at < rgba.length; at += 4) if (rgba[at] < 128) return true;
  return false;
}
