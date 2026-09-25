import { ByteWriter } from "../shared/byte-writer.js";

const FIXED = 65536;
const UV_FIXED = 0xff0000;

// The MRGL records this writer emits (engine 3D.H; numbering as in JSTrackViewer's decoder).
const MRGL_VLIST = 2, MRGL_TEXTURE = 13, MRGL_MAGNIFY = 20, MRGL_ZFACETTMAP = 24;
const MRGL_ZGFACETTMAP = 41, MRGL_TEXTURE64 = 62, MRGL_MATERIAL = 63, MRGL_MATFACET = 64;
const MRGL_MATERIAL2 = 66;

// MRGL_MATERIAL flags.
const LIT = 0x0001, GOURAUD = 0x0002, BLEND = 0x0004, ALPHATEST = 0x0008;
const REFLECT = 0x0020, TWOSIDED = 0x0080;

/** Write a CP3-compatible HD BIN. Long texture names use opcode 62. */
export function writeMtmBin(model, textureNameFor, options = {}) {
  const scale = options.scale ?? [1, 1, 1];
  /*
    Track scenery is drawn through a world matrix that maps BIN (X, depth, height) to
    (X, .75H, -D), so a track model's height is pre-divided here to survive it. Trucks are not
    drawn through that matrix: a stock MTM2 tire (BFC16L.BIN) measures 6.000 ft deep by 6.000
    ft tall, authored perfectly round, which it could not be if the engine squashed it. So the
    truck path passes 1 and the track path keeps the compensation.
  */
  const heightScale = options.heightScale ?? 1 / 0.75;
  const transparentTextures = options.transparentTextures ?? new Set();
  // An explicit "write this solid whatever the art says", for a caller that cannot trust either
  // the group flags or the texture. Nothing passes it now that each mode names its own authority.
  const opaque = options.opaque === true;
  /*
    Which face types to write. "scenery" and "truck" both take the engine's fast paths - see
    modelStyle - and differ only in who is allowed to call a mesh transparent. Any other caller
    keeps the two-sided material faces this writer used to produce for everything.
  */
  const faces = options.faces === "scenery" || options.faces === "truck" ? options.faces : "legacy";
  const alphaModes = options.alphaModes ?? new Map();
  const foliage = options.foliage === true;
  /*
    Whether this pod will actually carry the "_N" normal maps. A bump map is read through
    MATERIAL2, which only a material face can carry, so a bumped mesh gives up the plain fast
    path to get one. With HD art off no _N is written at all, so paying that price buys a map
    the pod does not contain: the caller says which case this is.
  */
  const bumpMaps = options.bumpMaps !== false;
  /*
    Subtracted from every vertex height, to move a model's origin.

    Evo measures a body from its underside; MTM2 measures one from its middle, and takes the
    centre of mass from there. Across all 271 stock Evo vehicles the wheel anchor sits 0.4 to
    1.8 ft below the Evo origin where every MTM2 truck puts it 2.8 to 3.8 ft below, so a body
    carried across unshifted drives with its mass down at axle height. See truck-converter.js.

    It is applied to the integer vertex records, so the normals, plane terms and duplicate
    keys derived from them all move with the geometry instead of having to know about it.
  */
  const heightOffset = options.heightOffset ?? 0;
  const meshes = model.meshes.filter(mesh => mesh.visible && !mesh.lod && mesh.indices.length);
  /*
    Whether this model sorts its own transparency into groups. Evo does that whenever a model
    mixes the two: the stock corpus has OPAQUE beside TRANSP, TRANSPI and TRANSPE sharing one
    texture - IL3WRECK is a 64-face hull with a 38-face interior and a 156-face exterior of
    glass, and Terramar's grandstand is two TRANSP shells. Where a model says which parts are
    which, that beats asking the texture, which is shared and so answers "transparent" for the
    hull as well. Where nothing is flagged the texture is all there is, which is the tree case:
    Evo leaves leaves in OPAQUE groups and cuts them out with the texture's alpha regardless.
  */
  const groupsSplitTransparency = meshes.some(mesh => mesh.transparent);
  const writer = new ByteWriter();
  const vertexCount = meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0);
  writer.u32(MRGL_MAGNIFY).u32(FIXED).u32(MRGL_VLIST).u32(0).u32(vertexCount);
  /*
    The vertex records exactly as the engine will read them. Normals, plane terms and the
    duplicate test are all computed from these integers rather than from the floats they came
    from, so a face can never disagree with the geometry the file holds.
  */
  const vertices = new Int32Array(vertexCount * 3);
  let cursor = 0;
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      // SMF has already been changed to viewer axes (X, height, -depth); BIN is authored in
      // Traxx axes (X, depth, height). See heightScale above for the vertical term.
      vertices[cursor++] = (mesh.positions[i] * scale[0] * 256) | 0;
      vertices[cursor++] = ((mesh.positions[i + 1] - heightOffset) * scale[1] * heightScale * 256) | 0;
      vertices[cursor++] = (-mesh.positions[i + 2] * scale[2] * 256) | 0;
    }
  }
  for (const value of vertices) writer.i32(value);

  let base = 0;
  let lastTexture = null;
  const written = faces === "legacy" ? null : new Set();
  for (const mesh of meshes) {
    const texture = textureNameFor(mesh.textureName) || "DEFAULT.RAW";
    if (texture !== lastTexture) {
      const longName = new TextEncoder().encode(texture).length > 15;
      writer.u32(longName ? MRGL_TEXTURE64 : MRGL_TEXTURE).u32(0).fixed(texture, longName ? 64 : 16);
      lastTexture = texture;
    }
    const style = faces === "legacy" ? legacyStyle(mesh) : modelStyle(mesh);
    if (style.material !== null) {
      writer.u32(MRGL_MATERIAL).u32(style.material)
        .i32(0).i32(0).i32(0).i32(FIXED).i32(32 * FIXED).i32(0)
        .i32(FIXED).i32(FIXED).i32(FIXED).i32(0);
      if (bumpMaps && mesh.bumpTextureName) writer.u32(MRGL_MATERIAL2).u32(1).i32(FIXED).i32(0).i32(0).i32(0).i32(0).i32(0);
    }
    for (let i = 0; i < mesh.indices.length; i += 3) {
      /*
        ⛔ THE CORNERS ARE WRITTEN IN REVERSE, AND THAT IS WHAT MAKES A FACE POINT OUTWARD.

        smf-parser.js reflects Evo's Z and reverses every triangle to compensate; the vertex
        loop above reflects Z back. A second reflection with no second reversal turns every
        face inside out - and it did. Run through this writer, Evo's own convex rocks came out
        with 94% of their stored normals pointing into the rock (SK4ROCK1: 97 of 103) and truck
        tires 100%, against 71% outward for stock MTM2 scenery measured the same way.
        TWOSIDED hid it: everything still drew, lit from behind, which is why converted models
        looked wrong rather than missing.
      */
      const corners = [mesh.indices[i], mesh.indices[i + 2], mesh.indices[i + 1]];
      const at = corners.map(index => (base + index) * 3);
      const normal = faceNormal(vertices, at);
      // A degenerate triangle has no direction to record or surface to draw, and MTM2's own
      // files never contain one.
      if (!normal) continue;
      /*
        Evo authors its back faces explicitly - 39% of Snake River's faces and 70-79% of its
        trees sit exactly on another face - so a face repeated with the SAME winding is the
        only kind that is redundant, and it z-fights even with culling on. The key keeps the
        corners' cyclic order, so a back face (the reverse order) is never mistaken for one.
      */
      if (written) {
        const key = faceKey(vertices, at);
        if (written.has(key)) continue;
        written.add(key);
      }
      writer.u32(style.op).u32(3).i32(normal[0]).i32(normal[1]).i32(normal[2]).i32(planeTerm(normal, vertices, at[0]));
      for (const index of corners) {
        writer.u32(base + index)
          .i32((mesh.uvs[index * 2] || 0) * UV_FIXED)
          .i32((mesh.uvs[index * 2 + 1] || 0) * UV_FIXED);
      }
    }
    base += mesh.positions.length / 3;
  }
  writer.u32(0);
  return writer.finish();

  // The truck path's faces, unchanged: every mesh two-sided, through a material.
  function legacyStyle(mesh) {
    let flags = LIT | GOURAUD | TWOSIDED;
    if (!opaque && (mesh.transparent || transparentTextures.has(mesh.textureName?.toUpperCase()))) flags |= BLEND | ALPHATEST;
    if (mesh.reflective) flags |= REFLECT;
    return { op: MRGL_MATFACET, material: flags };
  }

  /*
    Faces chosen for the engine's fast paths (CP3's CONVERTER_HANDOVER_EVO2_MODELS).

    Placed scenery is either instanced, replayed from a resident cache, or rebuilt every frame.
    Plain textured faces - ZFACETTMAP, ZGFACETTMAP - need no material and take both fast paths,
    which is what stock MTM2 scenery is written with (93% of its faces). A material face is
    instanced only if its flags stay within LIT, GOURAUD, ALPHATEST, TWOSIDED and TRANSLUCENT,
    with TWOSIDED only beside ALPHATEST, and it is never cached. Every converted face used to be
    a two-sided material face, so no converted prop - four thousand trees included - ever left
    the per-frame path.

    So: opaque art is a plain face, shiny art the shiny plain face. Alpha-tested art needs a
    material to say so, and gets exactly LIT, GOURAUD and ALPHATEST. BLEND survives only where
    a texture is translucent in earnest, since blending has to be sorted per frame. Nothing is
    TWOSIDED: Evo culls back faces and authors the back faces it wants, and with the winding
    above those now face the right way. REFLECT is never set - this writer has no reflectivity
    to give it, and at zero it does nothing but disqualify the model.
  */
  function modelStyle(mesh) {
    const name = mesh.textureName?.toUpperCase();
    /*
      Who gets to call a mesh transparent, and it is not the same answer for a track and a truck.

      Scenery: the art decides, because Evo marks its tree leaves OPAQUE - all 15 stock tree
      groups carry transparency flag 0 - and cuts them out with the texture's alpha anyway. Where
      a model does separate its transparent parts into their own groups, that beats the texture,
      which is shared and would answer "transparent" for the solid half too.

      ⛔ A TRUCK IS THE OTHER WAY ROUND: ONLY THE GROUP MAY SAY SO. Of Evo's 321 drawn vehicle
      models, 215 flag no transparent group at all and every one of those still samples a texture
      with an alpha plane, so letting the art decide would cut holes through every tire and wheel.
      The 106 that do flag split the lamps and glass (LIGHTBL, LIGHTHR, ...) from BODY, TIRE,
      WHEEL and MIRROR, which is exactly the split worth honouring - and honouring it is what
      brings back lamps and glass that were previously flattened into solid bodywork.
    */
    const flagged = faces === "truck" ? !!mesh.transparent : (!groupsSplitTransparency || mesh.transparent);
    const alpha = !opaque && transparentTextures.has(name) && flagged;
    if (alpha && !foliage && alphaModes.get(name) === "blend") return { op: MRGL_MATFACET, material: LIT | GOURAUD | BLEND };
    if (alpha) return { op: MRGL_MATFACET, material: LIT | GOURAUD | ALPHATEST };
    // A normal map is read through MATERIAL2, which only a material face carries.
    if (bumpMaps && mesh.bumpTextureName) return { op: MRGL_MATFACET, material: LIT | GOURAUD };
    return { op: mesh.reflective ? MRGL_ZGFACETTMAP : MRGL_ZFACETTMAP, material: null };
  }
}

/*
  What a texture's alpha actually asks for, or null when it asks for nothing.

  An Evo image carries an alpha plane whenever an .OPA or a four-sample .TIF sits beside it, and
  plenty of those planes are solid throughout - Terramar's TERPIT01 and 2PLANE are 100% opaque,
  and so is most truck art. Treating "has an alpha channel" as "is transparent" would put those
  on the material path for nothing, so a texture counts as transparent only if some texel is not.

  Then: alpha-testing is what the engine can instance, while blending has to be sorted every
  frame. Stock Evo cut-outs - trees, fences, drops - keep at most 22% of their texels between
  clear and solid (their antialiased edges), so only a texture past 40% is translucent in earnest
  and keeps BLEND. It lives here, beside the code that acts on the answer, because both the track
  and the vehicle path ask the same question of their art.
*/
export function alphaProfile(rgba) {
  let soft = 0, clear = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 250) clear++;
    if (rgba[i] > 16 && rgba[i] < 239) soft++;
  }
  if (!clear) return null;
  return soft / (rgba.length / 4) > 0.4 ? "blend" : "cutout";
}

/*
  The outward normal MTM2 stores on every face record, as 16.16 fixed point.

  This was a constant (0, 1, 0) until it was measured against the real thing: across five
  stock and community models - BIGFOOT, BFC16L, AXLE3 and the Viper's KAR11 and AST16L - all
  3,807 faces have their stored normal opposing the cross product of their own corners,
  without a single exception. So the convention is exact, and a face whose stored normal
  points somewhere unrelated is lit and culled as though it faced a direction it does not.

  The cross is taken in the component order the vertex records are written in - (x, height,
  depth) - which is an odd permutation of the (x, depth, height) frame the comparison above
  is expressed in, so a cross product computed here comes out with the opposite sign to one
  computed there. Writing the cross unnegated is therefore what produces the opposing stored
  normal the format wants; the sign was settled by measurement, not by reasoning about it.
  Stock track scenery agrees: in raw record order its stored normal and corner cross point
  the same way on 12,670 of 12,678 faces.

  Returns null for a degenerate triangle. Computed in doubles from the integer records: the
  cross of two edges can pass 2^31, but never 2^53.
*/
function faceNormal(vertices, at) {
  const [a, b, c] = at;
  const u = [vertices[b] - vertices[a], vertices[b + 1] - vertices[a + 1], vertices[b + 2] - vertices[a + 2]];
  const v = [vertices[c] - vertices[a], vertices[c + 1] - vertices[a + 1], vertices[c + 2] - vertices[a + 2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(n[0], n[1], n[2]);
  return length ? n.map(component => Math.round(component / length * FIXED)) : null;
}

/*
  The fourth word of a face header: the face's plane term, the stored normal dotted with its own
  first corner in the file's units (16.16 normal by raw vertex) and wrapped to 32 bits. Stock
  files hold exactly that on 99.96% of 21,053 faces across eight tracks, to within the rounding
  of whatever tool computed it. It was written as 0, which puts every face's plane through the
  model's origin for any engine path that culls or clips with it.
*/
function planeTerm(normal, vertices, at) {
  return Math.round(normal[0] * vertices[at] + normal[1] * vertices[at + 1] + normal[2] * vertices[at + 2]) | 0;
}

// Identity of a face by its corner positions, rotated to start at the least but never
// reordered, so a face and its back face (the same corners reversed) keep different keys.
function faceKey(vertices, at) {
  const points = at.map(i => `${vertices[i]},${vertices[i + 1]},${vertices[i + 2]}`);
  let first = 0;
  for (let k = 1; k < 3; k++) if (points[k] < points[first]) first = k;
  return [points[first], points[(first + 1) % 3], points[(first + 2) % 3]].join("|");
}
