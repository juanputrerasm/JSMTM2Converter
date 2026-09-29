/*
  The level palette, ART\<track>.ACT, and its RGB555 lookup, FOG\<track>.MAP.

  Both layouts (the system bands, white at 229, the fog map's cell centres and byte zero) and
  the median cut that fills the authored band are OpenPhotex's, with the measurements behind
  them; see its src/mtm/level-palette.ts and src/texture/encode.ts. This keeps the names the
  converter uses.
*/
export {
  MTM2_PALETTE_FIRST_AUTHORED as FIRST_AUTHORED, MTM2_PALETTE_AUTHORED_COUNT as AUTHORED_COUNT,
  mtm2LevelPalette as createMtmPalette, buildFogMap as makeFogMap, sampleForPalette, medianCutPalette,
} from "../vendor/openphotex/index.js";
