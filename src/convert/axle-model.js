/*
  A generated solid-axle beam.

  Evo has no axle model at all: every one of the 271 stock manifests names "NULL.BIN", because
  an Evo body carries its own moulded underbody and suspension as ordinary geometry. MTM2
  instead draws a separate axle at each axle position, so the format needs a model here even
  when the source had nothing to convert.

  A stock MTM2 axle (AXLE3.BIN) is 6.00 x 1.40 x 1.70 ft, sized for a monster truck's beam
  axle. A converted Evo 4x4 is a road vehicle whose body already shows its own axles, so this
  one is deliberately slim and is scaled to the truck's own measured track width: it reads as
  the axle tube the body is missing rather than adding a second visible suspension.

  Output is in the same shape decodeSmfModel produces - viewer axes (X, height, -depth),
  centred on the origin, since MTM2 places the axle by its own centre.
*/

const DEPTH_FT = 0.42;
const HEIGHT_FT = 0.42;

export function buildAxleModel(trackWidthFt, textureName) {
  // Stop short of the hubs so the beam meets the wheels instead of passing through them.
  const halfWidth = Math.max(0.5, (Number(trackWidthFt) || 4) / 2 - 0.35);
  const halfDepth = DEPTH_FT / 2;
  const halfHeight = HEIGHT_FT / 2;

  const positions = [], uvs = [], indices = [];
  // Six quads, each with its own four vertices so the texture restarts on every face.
  const faces = [
    { normal: [0, 1, 0], corners: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]] },
    { normal: [0, -1, 0], corners: [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]] },
    { normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { normal: [0, 0, -1], corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    { normal: [1, 0, 0], corners: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { normal: [-1, 0, 0], corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  ];
  const uvCorners = [[0, 1], [1, 1], [1, 0], [0, 0]];
  for (const face of faces) {
    const base = positions.length / 3;
    face.corners.forEach((corner, i) => {
      positions.push(corner[0] * halfWidth, corner[1] * halfHeight, corner[2] * halfDepth);
      uvs.push(uvCorners[i][0], uvCorners[i][1]);
    });
    /*
      Wound the way decodeSmfModel emits its triangles - reversed from outward-CCW, because
      the SMF reader negates Z and flips winding to match, and writeMtmBin reverses that back
      so a face ends up pointing outward. Keeping the reader's convention here is what puts the
      generated beam on the same footing as a converted one.
    */
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  return {
    name: "generated-axle",
    format: "GENERATED",
    meshes: [{
      groupName: "Axle",
      visible: true,
      lod: false,
      textureName: textureName || null,
      bumpTextureName: null,
      transparent: false,
      reflective: false,
      frameCount: 1,
      positions: new Float32Array(positions),
      normals: new Float32Array(positions.length),
      uvs: new Float32Array(uvs),
      indices: new Uint32Array(indices),
    }],
    textureNames: textureName ? [textureName.toUpperCase()] : [],
    warnings: [],
  };
}
