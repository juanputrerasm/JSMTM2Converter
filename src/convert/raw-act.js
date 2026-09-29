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
  palette in palette.js, which every texture in the track has to share. The encoding itself,
  index 0 as the colour key included, is OpenPhotex's encodeRawTexture.
*/
export { encodeRawTexture as quantizeToRawAct } from "../vendor/openphotex/index.js";
