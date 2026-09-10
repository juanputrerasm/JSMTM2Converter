import { ByteWriter } from "../shared/byte-writer.js";

const FIXED = 65536;
const UV_FIXED = 0xff0000;

/** Write a CP3-compatible HD BIN. Long texture names use opcode 62 and faces use material opcode 64. */
export function writeMtmBin(model, textureNameFor, options = {}) {
  const scale = options.scale ?? [1, 1, 1];
  const transparentTextures = options.transparentTextures ?? new Set();
  const meshes = model.meshes.filter(mesh => mesh.visible && !mesh.lod && mesh.indices.length);
  const writer = new ByteWriter();
  const vertexCount = meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0);
  writer.u32(20).u32(FIXED).u32(2).u32(0).u32(vertexCount);
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      /*
        SMF has already been changed to viewer axes (X, height, -depth). BIN is authored in
        Traxx axes (X, depth, height) and its world matrix later maps that to (X, .75H, -D).
        Undo that mapping here; compensating the .75 keeps the converted model's dimensions.
      */
      writer.i32(mesh.positions[i] * scale[0] * 256)
        .i32(mesh.positions[i + 1] * scale[1] / 0.75 * 256)
        .i32(-mesh.positions[i + 2] * scale[2] * 256);
    }
  }
  let base = 0;
  let lastTexture = null;
  for (const mesh of meshes) {
    const texture = textureNameFor(mesh.textureName) || "DEFAULT.RAW";
    if (texture !== lastTexture) {
      const longName = new TextEncoder().encode(texture).length > 15;
      writer.u32(longName ? 62 : 13).u32(0).fixed(texture, longName ? 64 : 16);
      lastTexture = texture;
    }
    let flags = 1 | 2 | 128; // lit, Gouraud and two-sided
    if (mesh.transparent || transparentTextures.has(mesh.textureName?.toUpperCase())) flags |= 4 | 8;
    if (mesh.reflective) flags |= 32;
    writer.u32(63).u32(flags)
      .i32(0).i32(0).i32(0).i32(FIXED).i32(32 * FIXED).i32(0)
      .i32(FIXED).i32(FIXED).i32(FIXED).i32(0);
    if (mesh.bumpTextureName) writer.u32(66).u32(1).i32(FIXED).i32(0).i32(0).i32(0).i32(0).i32(0);
    for (let i = 0; i < mesh.indices.length; i += 3) {
      writer.u32(64).u32(3).i32(0).i32(FIXED).i32(0).i32(0);
      for (let corner = 0; corner < 3; corner++) {
        const index = mesh.indices[i + corner];
        writer.u32(base + index)
          .i32((mesh.uvs[index * 2] || 0) * UV_FIXED)
          .i32((mesh.uvs[index * 2 + 1] || 0) * UV_FIXED);
      }
    }
    base += mesh.positions.length / 3;
  }
  writer.u32(0);
  return writer.finish();
}
