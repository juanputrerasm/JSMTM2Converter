import { title } from "../../shared/paths.js";
import { BUILD_ID } from "../../build-info.js";
import {
  buildMtm2Lte, emptyGroundBoxGrids, writeEmptyList, writeMtm2Lvl, writeMtm2Sit, writeTexList,
} from "../../vendor/openphotex/index.js";

/*
  The file layouts (SIT, LVL, TEX, LTE and the ground-box grids) are OpenPhotex's MTM2 writers.
  This file decides what goes in them: where each converted object, truck and course point
  stands on the converted terrain, which box type it gets, and which course the field follows.
*/

const CRLF = "\r\n";
const ascii = value => new TextEncoder().encode(value);
// Extended course slots MTM2 levels actually use, and the one the AI field is sent to.
const EXTENDED_COURSES = 2, AI_COURSE = 2;
// The "Your Truck" slot's course: it is not a racer.
const PLAYER_COURSE = 0;
// MTM2 reads a zero mass as "this object cannot be pushed".
const IMMOVABLE = "0.000000";
// MTM2's "drive thru" box type: drawn, never collided with.
const DRIVE_THRU = 7;

export function writeTrackFiles({ prefix, sit, lvl, terrain, textureNames, modelNames, modelBounds = new Map(), vegetation = [], hasLargeHdTexture = false, legacyFallback = false, options = {} }) {
  const files = [];
  const text = (name, value) => files.push({ name, data: ascii(value.replace(/\r?\n/g, CRLF)) });
  /*
    ⚠ THE TWO UI BITMAPS ARE NOT NAMED FOR THEIR SIZES. In all fifteen stock levels the
    "Track Logo" slot holds the 257x210 track PICTURE and the "Track Map" slot holds the 32x24
    list ICON - never the other way round - and Traxx writes the picture as <stem>S.BMP and
    the icon as <stem>L.BMP to match. Feeding the picture slot a 32x24 image is what left the
    track-selection screen with nothing legible on it.
  */
  const pictureBmp = `${prefix.slice(0, 7)}S.BMP`, iconBmp = `${prefix.slice(0, 7)}L.BMP`;
  /*
    ⛔ THE EXTENSION IS A LOAD-BEARING PROMISE, not a label. Track discovery in an unmodified
    1998 install is an extension scan for ".SIT", so a pod whose legacy RAW/ACT art was omitted
    is named .SI2 and that install never sees it - invisible beats loading with no textures.
    Ship the fallback and the track earns its .SIT back. Traxx enforces the same invariant from
    what was actually packed rather than from what the author asked for, and so does this.
  */
  const situation = legacyFallback ? "SIT" : "SI2";
  files.push({ name: `WORLD\\${prefix}.${situation}`, data: writeMtm2Sit(sitDocument({ prefix, sit, terrain, modelNames, modelBounds, vegetation, pictureBmp, iconBmp, options })) });
  files.push({ name: `LEVELS\\${prefix}.LVL`, data: writeMtm2Lvl(lvlDocument(prefix, lvl, terrain)) });
  files.push({ name: `DATA\\${prefix}.TEX`, data: writeTexList(textureNames) });
  for (const extension of ["TTY", "PUP", "ANI", "TDF", "DEF", "NAV"]) files.push({ name: `DATA\\${prefix}.${extension}`, data: writeEmptyList() });
  text(`DATA\\${prefix}.TXV`, `# MTM2 track version record - written by JSMTM2Converter\nformatVersion=1\ntool=JSMTM2Converter\ntoolVersion=${BUILD_ID}\nlegacyFallback=${legacyFallback ? 1 : 0}\nhdTextures=${hasLargeHdTexture ? 1 : 0}\n`);
  files.push({ name: `DATA\\${prefix}.LTE`, data: buildMtm2Lte(terrain.raw, sunVector(lvl)) });
  // Evo has no ground boxes, so every grid takes the stock "no boxes anywhere" value.
  for (const [extension, data] of Object.entries(emptyGroundBoxGrids())) files.push({ name: `DATA\\${prefix}.${extension}`, data });
  return { files, situation, pictureBmp: `UI\\${pictureBmp}`, iconBmp: `UI\\${iconBmp}` };
}

/*
  The sun, as MTM2 line 18 states it: (east, up, north), the direction the light TRAVELS, in
  16.16 fixed point. Traxx's five-way compass fixes the axes - Noon (0,-64000,0), N
  (0,-46333,-46333), E (-46333,-46333,0), S (0,-46333,+46333), W (+46333,-46333,0) - and Evo
  writes the same vector, as a unit float triple, in its own .LVL `$lightSourceVector`. So the
  source track's sun transfers directly and there is no reason to substitute a stock preset:
  Baja Beach's (0.241845,-0.939692,0.241845) is a sun 70 degrees up on bearing 225, and only
  scaling stands between that and the MTM2 field.
*/
const SUN_FIXED_POINT = 65536;
const DEFAULT_SUN = [0.7071, -0.7071, 0];   // Traxx's W preset, for a level that states none.

export function sunVector(lvl) {
  const source = lvl?.lightVector;
  const length = source && Math.hypot(source[0], source[1], source[2]);
  if (!length) return DEFAULT_SUN;
  return source.map(component => component / length);
}

function lvlDocument(prefix, lvl, terrain) {
  // Evo's LVL water value is in half-units; terrain and placements are ordinary world units.
  return {
    descriptionTxt: `${prefix}.TXT`, rawName: `${prefix}.RAW`, clrName: `${prefix}.CLR`, actName: `${prefix}.ACT`, texName: `${prefix}.TEX`,
    pupName: `${prefix}.PUP`, aniName: `${prefix}.ANI`, tdfName: `${prefix}.TDF`, defName: `${prefix}.DEF`, navName: `${prefix}.NAV`,
    fogName: `${prefix}.FOG`, lteName: `${prefix}.LTE`,
    // Line 17 is the track's own sun; the four values after it stay stock.
    sunVector: sunVector(lvl).map(component => Math.round(component * SUN_FIXED_POINT)),
    waterHeight: Math.round(4 * terrain.mapHeight(lvl.water.height / 2)),
  };
}

function sitDocument({ prefix, sit, terrain, modelNames, modelBounds, vegetation, pictureBmp, iconBmp, options = {} }) {
  const starts = sit.vehicles.length ? sit.vehicles : [{ position: firstStart(sit), orient: [0,0,0] }];
  const truck = (vehicle, courseToFollow) => ({ position: placed(vehicle.position, terrain), orient: vehicle.orient, courseToFollow });
  const boxes = sit.boxes.filter(box =>
    (box.modelName && modelNames.has(title(box.modelName))) || isCheckpoint(box));
  const anchors = structureAnchors(boxes, terrain, modelBounds, options.seatOnTerrain !== false);
  const placements = boxes.map(box => {
    const gate = isCheckpoint(box) ? checkpointBox(box, terrain) : null;
    const position = gate?.ipos ?? (anchors.has(box) ? anchored(box.position, anchors.get(box), terrain) : placed(box.position, terrain));
    /*
      Mass zero is MTM2's "cannot be moved" - 195 of TPARK's 398 boxes are written that way
      and everything with a non-zero mass there is deliberately knockable. Evo scenery is
      static, so a converted rock, hut or wreck must not be shovable; 1000 made every one of
      them a prop the truck could push around.
    */
    return gate
      ? { position, orient: box.orient, extents: gate.extents, mass: IMMOVABLE, type: boxTypeFor(box, options) }
      : { position, orient: box.orient, modelName: modelNames.get(title(box.modelName)), mass: IMMOVABLE, type: boxTypeFor(box, options) };
  });
  // Type 7 is MTM2's "drive thru" - vegetation never collides - and mass zero keeps it rooted
  // rather than merely intangible.
  for (const tree of vegetation) {
    placements.push({ position: placedOnGround(tree, terrain), orient: [0, 0, tree.yaw], modelName: tree.modelName, mass: IMMOVABLE,
      type: options.vegetationNonCollide === false ? 0 : DRIVE_THRU });
  }
  const route = value => (value?.segments ?? []).map(segment => ({
    start: placed(segment.start, terrain), end: placed(segment.end, terrain), speedLimit: segment.speedLimit, trackWidth: segment.trackWidth,
  }));
  return {
    lvlName: `${prefix}.LVL`, trackName: sit.trackName || prefix, localeName: "EVO CONVERSION",
    // MTM2 situation files name the UI bitmaps with their folder and the description with the
    // DATA stem; stock TPARK reads "UI\Farm.bmp" and "tpark.txt" in these three slots.
    pictureBmp: `UI\\${pictureBmp}`, iconBmp: `UI\\${iconBmp}`, descriptionTxt: `${prefix}.TXT`,
    raceType: sit.raceType || 0, ambientSound: sit.ambientSound || 0, trackLength: sit.trackLength, weatherMask: sit.weatherMask || 0,
    yourTruck: truck(starts[0], PLAYER_COURSE),
    // Every racer follows extended course 2 in all fifteen stock levels, and Traxx's own notes
    // record the same ("Trucks always follow course 2???"). Evo's courseToFollow indexes Evo's
    // course list, not MTM2's four extended slots, so carrying it across pointed the field at
    // course 1 - the slot MTM2 uses for the map route - instead.
    vehicles: Array.from({ length: 8 }, (_, i) => truck(starts[i % starts.length], AI_COURSE)),
    boxes: placements,
    course: route(sit.courses[0]),
    /*
      The extended courses. All fifteen stock MTM2 levels fill [Course 1] and [Course 2] and
      leave [Course 3] and [Course 4] at "0,0" - and all of them send every racer to course 2.
      Filling 3 and 4 as well, as this used to, publishes two routes no stock track has and no
      truck asks for. An Evo level that authors alternate racing lines supplies them here;
      otherwise both AI routes repeat the primary line.
    */
    extendedCourses: [0, 1, 2, 3].map(i => {
      if (i >= EXTENDED_COURSES) return null;
      const alternate = sit.courses[i + 1];
      return route(alternate?.segments?.length >= 3 ? alternate : sit.courses[0]);
    }),
  };
}

function placed(position, terrain) {
  const [x = 4096, y = 0, z = 4096] = position ?? [];
  const sourceGround = sampleTerrain(terrain.source, x / 32, z / 32);
  const targetGround = drawnGround(terrain.raw, x / 32, z / 32);
  // MTM2 renders SIT height as 1.5*Y and terrain as 3*RAW. Preserve the source clearance
  // using the same vertical scale selected for terrain, rather than multiplying it twice.
  // That is the AUTOMATIC fit, not the user's height factor: the factor makes hills taller,
  // and an object's height above its own patch of ground is part of the object, not a hill.
  return [num(x), num(2 * targetGround + 2 * objectScale(terrain) * (y - sourceGround)), num(z)];
}

/*
  One vertical anchor per placed model, so that a structure Evo built in one piece is not torn
  apart by the terrain being squeezed under it.

  A placement keeps the model's own heights at true scale, 2 * objectScale altitude units per
  Evo foot, while the terrain is usually squeezed harder to fit MTM2's byte. The two agree at
  one point only: a placement is exact where it is anchored and drifts from the ground by
  2 * (objectScale - terrain.scale) units for every foot the Evo ground differs from there -
  0.272 on Terramar. placed() anchors on the ground under the object's own centre, which is
  right for anything that stands on that ground and wrong for anything that does not.

  ⛔ TERRAMAR'S BRIDGE WAS TORN IN HALF BY EXACTLY THAT. Its deck and centre span hang 50 to
  100 ft over the river, so they were anchored on the river bed, 98 ft below the banks the
  abutments and end piers stand on, and came out 59 units above the rest of the bridge: towers
  on nothing, a deck cut through by its own truss. El Norte's ELBRG1 had the same fault and
  stood 67 ft clear of its banks; Deja Voodoo's rope bridges about 40.

  So a piece is anchored on what holds it up. First, if its own underside meets the terrain
  anywhere (RESTS, see restingPoint; the "Seat models where they rest" option), at the highest
  ground it meets - which is how Deja Voodoo's gorge bridge, whose piers look like a buried rock
  to its bounding box, lands on both rims. Otherwise by how far its base is clear of the ground
  under its own centre:
    - STANDS, within REST: the anchor under its centre, exactly as before;
    - PERCHED, within SPAN, and RESTS too: the anchor of the piece it sits on - a grandstand on a pit roof
      takes the pit building's - and its own when it rests on nothing;
    - SPANS, further - a deck whose centre is 95 ft over the river - or HANGING, reaching no
      ground anywhere under it - a truss, the tower standing on it: grouped with the others like
      it that it touches, and held by the pieces under the group or, failing those, braced by
      the lowest it touches, as the lower truss is by the abutments. A group with nothing to
      hold it is anchored on its own: at the highest ground a member spans, where a deck meets
      its banks (El Norte's ELBRG1), or else on the lowest of its members' centres (Terramar's
      biplane and its banner).
  A perched piece is never braced sideways: rocks piled against each other would otherwise
  drag one another toward whichever sits lowest.

  ⛔ EVERYTHING ELSE IS LEFT ALONE ON PURPOSE. Anchoring every grounded piece at the highest
  ground under it, the trees' rule, moved 591 of El Norte's rocks and hillsides by more than
  5 ft and up to 95; anchoring pieces whose tops are level with the ground moved 282; joining
  every touching piece into one rigid body sank El Norte's 1882 ft of tiled mountains 147 ft as
  one and Peak's fence chain 100 ft at its low end. A fence segment is held up by the ground,
  not by the segment beside it.

  ⛔ THE GAP ANCHOR IS READ FROM THE TERRAIN FIT, NOT FROM THE DRAWN SURFACE. drawnGround takes
  the lower of the two triangulations, which at the lip of a bank reaches down toward the valley
  floor, and a footprint that ends at a bank samples exactly there; one such reading dropped the
  whole bridge 21 units. The fit follows the Evo height smoothly, and it is short by half a
  level so that rounding the heights into the byte leaves a deck on or under the bank drawn
  under it, never above.

  With the terrain at true scale every anchor is the same number and none of this moves
  anything. Returns a Map from box to anchor, for anchored(); a box it cannot measure is left
  to placed().
*/
const TOUCH = 2;           // ft: bounding boxes this close touch - Evo leaves such gaps between stacked pieces
const REST = 1;            // ft: a base this close to the ground stands on it
const SPAN = 10;           // ft: a centre this far above the ground under it stands over a gap
const FOOTPRINT_STEP = 16; // ft: half an Evo terrain cell between footprint samples
function structureAnchors(boxes, terrain, modelBounds, seatOnTerrain = true) {
  const parts = [];
  for (const box of boxes) {
    const bounds = !isCheckpoint(box) && box.modelName ? modelBounds?.get(title(box.modelName)) : null;
    if (bounds) parts.push(pieceOf(box, bounds, terrain, seatOnTerrain));
  }
  const touching = (a, b) => a.minX <= b.maxX + TOUCH && b.minX <= a.maxX + TOUCH
    && a.minZ <= b.maxZ + TOUCH && b.minZ <= a.maxZ + TOUCH && a.low <= b.high + TOUCH && b.low <= a.high + TOUCH;
  const firm = parts.map((_, i) => i).filter(i => ["stands", "perched", "rests"].includes(parts[i].kind));
  const anchorOf = new Map();
  /*
    The placed piece a piece rests on: touching it, top no higher than its base, and of those
    the highest; where several tops are level, the one it covers most. A Terramar grandstand
    stands on a pit roof level with a wall panel beside it to a tenth of a foot, and taking the
    panel put it 8.7 units off the building under it.
  */
  const overlap = (a, b) => Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX))
    * Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ));
  const beneath = i => {
    const supports = firm.filter(j => j !== i && anchorOf.has(j) && parts[j].high <= parts[i].low + TOUCH && touching(parts[i], parts[j]));
    if (!supports.length) return -1;
    const top = Math.max(...supports.map(j => parts[j].high));
    return supports.filter(j => parts[j].high >= top - TOUCH)
      .reduce((best, j) => overlap(parts[i], parts[j]) > overlap(parts[i], parts[best]) ? j : best);
  };
  // Bottom up, so that a piece perched on a perched piece finds its support already placed.
  for (const i of [...firm].sort((a, b) => parts[a].low - parts[b].low)) {
    const support = parts[i].kind === "stands" ? -1 : beneath(i);
    anchorOf.set(i, support >= 0 ? anchorOf.get(support) : parts[i].anchor);
  }

  const loose = parts.map((_, i) => i).filter(i => !anchorOf.has(i));
  const group = parts.map((_, i) => i);
  const root = i => { while (group[i] !== i) i = group[i] = group[group[i]]; return i; };
  for (let m = 0; m < loose.length; m++) for (let n = m + 1; n < loose.length; n++) {
    if (touching(parts[loose[m]], parts[loose[n]])) group[root(loose[m])] = root(loose[n]);
  }
  const groups = new Map();
  for (const i of loose) {
    // Held from beneath if anything is under it, otherwise braced by whatever it touches.
    const support = beneath(i);
    let held = support >= 0 ? anchorOf.get(support) : Infinity;
    if (support < 0) for (const j of firm) if (touching(parts[i], parts[j])) held = Math.min(held, anchorOf.get(j));
    const current = groups.get(root(i)) ?? { held: Infinity, spans: Infinity, own: Infinity };
    current.held = Math.min(current.held, held);
    if (parts[i].kind === "spans") current.spans = Math.min(current.spans, parts[i].anchor);
    current.own = Math.min(current.own, parts[i].anchor);
    groups.set(root(i), current);
  }
  for (const i of loose) {
    const { held, spans, own } = groups.get(root(i));
    anchorOf.set(i, [held, spans, own].find(Number.isFinite));
  }
  return new Map(parts.map((part, i) => [part.box, anchorOf.get(i)]));
}

/*
  A placed model as structureAnchors sees it: its bounding box in Evo world feet, whether its
  base reaches the Evo ground anywhere under it, how far it is clear of the ground under its own
  centre (see structureAnchors), and its own anchor - at the highest ground under it for a piece
  that spans a gap, under its centre for any other.

  The box is turned exactly as JSTrackViewer's evoModelMatrix draws Evo models: roll about the
  depth axis, then pitch, then heading, in the viewer's mirrored Z. Terramar's upper bridge
  trusses are the lower ones rolled upside down; taking a turned piece as the cube around its
  reach instead made a 90 x 45 x 11 ft truss a 152 ft cube that reached up the bank for its
  anchor, which pulled the whole centre span down 18 units.
*/
function pieceOf(box, bounds, terrain, seatOnTerrain) {
  const [x = 0, y = 0, z = 0] = box.position;
  const [pitch = 0, roll = 0, heading = 0] = box.orient;
  const { lowX, highX, lowY, highY, lowZ, highZ } = bounds;
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(-pitch), sp = Math.sin(-pitch);
  const ch = Math.cos(-heading), sh = Math.sin(-heading);
  const turn = (u, h, w) => {
    let px = u, py = h, pz = -w;
    [px, py] = [px * cr - py * sr, px * sr + py * cr];
    [py, pz] = [py * cp - pz * sp, py * sp + pz * cp];
    [px, pz] = [px * ch + pz * sh, pz * ch - px * sh];
    return [x + px, y + py, z - pz];
  };
  const corners = [];
  for (const u of [lowX, highX]) for (const h of [lowY, highY]) for (const w of [lowZ, highZ]) corners.push(turn(u, h, w));
  const piece = {
    box,
    low: Math.min(...corners.map(c => c[1])), high: Math.max(...corners.map(c => c[1])),
    minX: Math.min(...corners.map(c => c[0])), maxX: Math.max(...corners.map(c => c[0])),
    minZ: Math.min(...corners.map(c => c[2])), maxZ: Math.max(...corners.map(c => c[2])),
  };
  // The footprint: a grid over the box's two horizontal faces, turned into the world.
  const across = Math.min(32, Math.max(2, Math.ceil((highX - lowX) / FOOTPRINT_STEP)));
  const deep = Math.min(32, Math.max(2, Math.ceil((highZ - lowZ) / FOOTPRINT_STEP)));
  let peak = null;
  for (let i = 0; i <= across; i++) for (let j = 0; j <= deep; j++) for (const h of [lowY, highY]) {
    const [px, , pz] = turn(lowX + (highX - lowX) * i / across, h, lowZ + (highZ - lowZ) * j / deep);
    const ground = sampleTerrain(terrain.source, px / 32, pz / 32);
    if (!peak || ground > peak.ground) peak = { px, pz, ground };
  }
  const scale = objectScale(terrain);
  const centreGround = sampleTerrain(terrain.source, x / 32, z / 32);
  const clear = piece.low - centreGround;
  // The anchor that puts this Evo height exactly where the terrain fit puts it, short by half a
  // level so the byte's rounding never leaves the piece above the surface drawn under it.
  const fittedAnchor = ground => 2 * (clamp((ground - terrain.base) * terrain.scale, 0, 255) - GROUND_MARGIN) - 2 * scale * ground;
  const rest = seatOnTerrain ? restingPoint(bounds.underside, lowX, lowZ, y, pitch, roll, turn, terrain) : null;
  piece.kind = rest ? "rests"
    : piece.low > peak.ground + REST ? "hanging" : clear > SPAN ? "spans" : clear > REST ? "perched" : "stands";
  if (rest) {
    piece.anchor = fittedAnchor(rest.ground);
  } else if (piece.kind === "spans") {
    piece.anchor = fittedAnchor(peak.ground);
  } else {
    // The anchor placed() uses.
    piece.anchor = 2 * drawnGround(terrain.raw, x / 32, z / 32) - 2 * scale * centreGround;
  }
  return piece;
}

/*
  Where a model's own underside rests on the Evo terrain, or null where it rests nowhere: the
  highest ground among the cells of its underside grid lying within RESTING of the ground.

  ⛔ THE HIGHEST, NOT THE AVERAGE. Deja Voodoo's gorge bridge touches the ground at both rims,
  506 ft, and also where its arches graze the gorge walls on the way down, as low as 465; the
  average of those put its deck 13 units above the rims. The highest is where a deck meets its
  banks, and every lower resting point then comes out slightly buried, because squeezed terrain
  rises there relative to the anchor, never slightly afloat.

  Only an upright piece is read: the grid is the model's underside, and a piece turned over or
  tipped has a different one. Those keep the bounding-box rules.
*/
const RESTING = 2; // ft: an underside this close to the ground rests on it
function restingPoint(underside, lowX, lowZ, y, pitch, roll, turn, terrain) {
  if (!underside || Math.cos(pitch) < 0.9998 || Math.cos(roll) < 0.9998) return null;
  const { step, across, deep, heights } = underside;
  let best = null;
  for (let i = 0; i < across; i++) for (let j = 0; j < deep; j++) {
    const height = heights[i * deep + j];
    if (!Number.isFinite(height)) continue;
    const [px, , pz] = turn(lowX + (i + 0.5) * step, height, lowZ + (j + 0.5) * step);
    const ground = sampleTerrain(terrain.source, px / 32, pz / 32);
    if (Math.abs(y + height - ground) <= RESTING && (!best || ground > best.ground)) best = { ground };
  }
  return best;
}

// placed() for a box whose anchor structureAnchors chose: true-scale height above that anchor.
function anchored(position, anchor, terrain) {
  const [x = 4096, y = 0, z = 4096] = position ?? [];
  return [num(x), num(2 * objectScale(terrain) * y + anchor), num(z)];
}

function placedOnGround(tree, terrain) {
  /*
    Grounded on the LOWEST surface under the TRUNK, not on the one point the tree stands at.

    A trunk has width - 5.6 to 12.1 world units across on Baja Beach's four trees - and on a
    slope the ground under its downhill side is lower than the ground under its middle, so a
    tree planted by its centre hangs over the hill by however much the surface falls across
    that width. It is invisible on the flat and unmistakable on a ridge: 90% of Baja's trees
    stood more than a unit clear of the hill that way, half of them more than 3.6, the worst
    24.4.

    ⛔ IT IS THE LOWEST READING, AND THE SIGN IS THE WHOLE FIX. The base has to be at or under
    the ground at every point of the footprint, so it belongs at the minimum; grounding it on
    the maximum raises the tree by that same drop and makes the overhang worse, which is what
    a build that did exactly that looked like on a ridge. The uphill side of the trunk goes
    into the hill, the side nobody can see, and level ground is unaffected because there the
    readings are all the same.
  */
  const targetGround = footprintGround(terrain.raw, tree.x / 32, tree.z / 32, (tree.footprint ?? 0) / 32) - GROUND_MARGIN;
  /*
    A tree is lifted by its own half height, so that its trunk meets the ground. That is a
    distance measured against the model, so it converts at one SIT altitude per Evo foot - twice
    the object scale. It used to be 2/3 of the
    clearance, exactly half of what the model needs, which buried every tree by a third of its
    half height: 13 units of JUNGLE80, 19 of JUNGLE115, worse the taller the tree and worse
    again on a track whose terrain had to be squeezed harder.
  */
  return [num(tree.x), num(2 * targetGround + 2 * objectScale(terrain) * tree.clearance), num(tree.z)];
}


/*
  A checkpoint gate: its box, and the altitude that box has to sit at.

  MTM2's length,width,height are HALF-extents on (y, x, z) - Traxx builds the prism from
  -length..+length on axis 1, -width..+width on axis 0 and -height..+height on axis 2
  (TraxxViewDisplay.cpp:2746-2766). Evo instead carries a FULL size on its own (x, up, z), so
  the two differ by an axis permutation as well as by scale.

  ⛔ WRITING EVO'S TRIPLE STRAIGHT THROUGH LAID EVERY GATE FLAT. Baja Beach's first checkpoint
  is 147 x 66 x 2 - wide, tall and paper-thin across the track - and copied verbatim it became
  length 147, width 66, height 2: a 2-unit doormat 147 deep and 66 wide, which is both the
  "rotated 90 degrees" footprint and the reason nothing scored.

  ⚠ THE TWO AXES DO NOT SHARE A SCALE, WHICH IS THE SECOND HALF OF THE SAME BUG. Horizontally
  MTM2's world is twice Evo's while the situation file stores half-units, so a full Evo extent
  is already the MTM2 half-extent. Vertically nothing cancels: an extent here is in world units,
  where MTM2 draws terrain at 3 per RAW step and a SIT altitude at 1.5 - so an Evo foot is
  3 * terrain.scale of them. Leaving that factor out made every gate a third of its height, and
  since a gate is centred well above the ground, thirteen of Baja Beach's eighteen then hung in
  the air by as much as 28 units.
*/
const RAW_TO_WORLD = 3, SIT_TO_WORLD = 1.5;

/*
  Half a level of extra sink for a planted model, which is 1.5 world units or one foot.

  Sampling a trunk's footprint cannot find the very lowest point of a piecewise surface exactly,
  and it does not have to: the residual measured against a 449-point reference is a tenth of a
  unit for 93% of Baja Beach's trees and 1.3 at the very worst. This margin is larger than that
  worst case, so nothing is left hanging, and it is far too small to see on a tree between 40 and
  115 feet tall. It also absorbs the hundredths lost when an altitude is written to two decimals.
*/
const GROUND_MARGIN = 0.5;

function checkpointBox(box, terrain) {
  const ipos = placed(box.position, terrain);
  const [width = 64, up = 64, depth = 64] = box.size ?? [];
  const [x = 0, , z = 0] = box.position ?? [];
  // The gate's own height follows the automatic fit, like every object's; the reach to the
  // ground below still measures the terrain as converted, factor and all.
  const full = up * RAW_TO_WORLD * objectScale(terrain);
  const top = Number(ipos[1]) * SIT_TO_WORLD + full / 2;
  /*
    And then make sure it reaches the ground, because a gate that hangs is a gate the truck can
    pass under. The top stays where the source put it and only the base is allowed to move down,
    so a gate never grows upward into scenery. The ground is measured across the whole footprint
    rather than under the centre alone - these are several cells wide, and a gate on a slope
    touches at its centre while its low end still hangs.
  */
  const base = Math.min(top - full, RAW_TO_WORLD * lowestCell(terrain.raw, x, z, Math.max(width, depth) / 2));
  return {
    ipos: [ipos[0], num((top + base) / 2 / SIT_TO_WORLD), ipos[2]],
    extents: [depth, width, Math.max(1, (top - base) / 2)],
  };
}

/*
  MTM2 box types: 0 normal, 6 checkpoint, 7 "drive thru", 8 "always face" (Model Types.txt).
  Only 0 and 8 are collidable scenery, so those are the two "make everything non-collide"
  turns into 7; a checkpoint that stopped registering, or a billboard, is not scenery to pass
  through and keeps its own type.
*/
function boxTypeFor(box, options) {
  if (isCheckpoint(box)) return 6;
  if (/facing/i.test(box.sourceClass)) return options.allObjectsNonCollide ? DRIVE_THRU : 8;
  return options.allObjectsNonCollide ? DRIVE_THRU : 0;
}

/*
  The vertical scale for anything that belongs to an object rather than to the terrain.

  ⚠ IT IS THE TRUE SCALE, NOT THE TRACK'S FITTED ONE. A model is drawn at its own size however
  much the terrain had to be squeezed to fit MTM2's 256 height levels, so a distance measured
  against a model - a tree's half height, a rock's origin above its base, a gate's height -
  converts at the constant the world uses and not at this track's fit: 1/2 RAW level per Evo
  foot, which is one SIT altitude unit and one BIN unit per foot (see TRUE_SCALE in terrain.js).

  Measured, not assumed. Across 604 stock MTM2 placements of flat-bottomed models standing on
  dead-flat ground, a model's own lowest vertex lands exactly on the terrain when one BIN unit
  (1/256) is worth 1.5 world units, one SIT altitude: median residual 0.00, with 98-100% of
  ALASKA's, CRAZY98's and ROCKQRY's within a single unit, and every other factor off by a wide
  margin. Model heights are written 1:1, so that is 1.5 world units per Evo foot here.

  ⛔ IT USED TO BE 2/3, "2 world units per foot, the same as the horizontal". Traxx's world
  units are not the same size both ways in game, and 2/3 put every object offset, like every
  model height, 4/3 too high.
*/
function objectScale(terrain) { return terrain.trueScale ?? 1 / 2; }

function firstStart(sit) { return sit.courses[0]?.segments[0]?.start ?? [4096, 0, 4096]; }
function isCheckpoint(box) { return box.sourceClass === "CCheckpoint" || box.boxType === 6; }
/*
  The lowest ground under a footprint, read from the CONVERTED grid rather than by resampling
  the Evo source. That grid is the surface MTM2 actually draws, so this cannot drift from it by
  the half step that rounding a source sample into a RAW level can, and taking the minimum over
  the cells the box covers is the terrain's own low point rather than an interpolated one.
*/
function lowestCell(raw, x, z, reach) {
  const span = Math.min(64, Math.ceil(reach / 32));
  const cx = Math.floor(x / 32), cz = Math.floor(z / 32);
  let lowest = 255;
  for (let dz = -span; dz <= span + 1; dz++) for (let dx = -span; dx <= span + 1; dx++) {
    lowest = Math.min(lowest, raw[clamp(cx + dx, 0, 255) + (clamp(cz + dz, 0, 255) << 8)]);
  }
  return lowest;
}

/*
  The lowest ground the engine draws under a model's footprint: its own point and sixteen around
  it at `radius` cells. A radius of zero is just the point.

  The rim is where to look. Terrain is flat within a triangle, so the low point under a disk this
  small - a few feet against a 32-foot cell - is on its edge unless a cell corner falls inside,
  which a trunk almost never spans. Measured against a 449-point sampling of the same disks over
  Baja Beach's 3,819 trees, that is exactly what the readings say: sixteen points around the rim
  miss the true low by a median of 0.013 world units against 0.056 for eight, while adding
  interior rings or the corners inside the disk changes the 99th percentile from 0.249 to 0.230,
  which is to say nothing. The last tenths are covered by GROUND_MARGIN instead.
*/
function footprintGround(raw, gx, gz, radius) {
  let lowest = drawnGround(raw, gx, gz);
  if (!(radius > 0)) return lowest;
  for (let step = 0; step < 16; step++) {
    const angle = step * Math.PI / 8;
    lowest = Math.min(lowest, drawnGround(raw, gx + radius * Math.cos(angle), gz + radius * Math.sin(angle)));
  }
  return lowest;
}

/*
  The ground the engine actually draws, in RAW levels, at a point in the converted grid.

  A model has to meet the surface MTM2 rasterises, not the height field it was fitted from.
  Sampling the Evo source and rounding it to a level - what this used to do - is a different
  surface: it interpolates at full precision and then rounds, while the engine interpolates
  levels that were rounded first, and the two part company exactly where cells meet steeply.
  Measured over Baja Beach's 3,819 trees, that left a quarter of them more than a unit above
  the drawn surface and the worst 14.5 units up, which is the floating seen along hill edges.

  ⚠ AND A CELL HAS TWO POSSIBLE SURFACES. It is drawn as four corners split into triangles,
  and nothing in the files says which diagonal the engine picks; at a saddle the two readings
  differ by up to 31 units. Taking the lower of them means a model can sit slightly into the
  ground where the surface is ambiguous - median 0.79 units, 5.7 at the 95th percentile - but
  never hangs above it, which is the trade worth making for a tree trunk.
*/
function drawnGround(raw, gx, gz) {
  const x0 = Math.floor(gx), z0 = Math.floor(gz);
  const fx = gx - x0, fz = gz - z0;
  const at = (x, z) => raw[clamp(x, 0, 255) + (clamp(z, 0, 255) << 8)];
  const corner00 = at(x0, z0), corner10 = at(x0 + 1, z0);
  const corner01 = at(x0, z0 + 1), corner11 = at(x0 + 1, z0 + 1);
  const acrossA = fx >= fz
    ? corner00 + (corner10 - corner00) * fx + (corner11 - corner10) * fz
    : corner00 + (corner11 - corner01) * fx + (corner01 - corner00) * fz;
  const acrossB = fx + fz <= 1
    ? corner00 + (corner10 - corner00) * fx + (corner01 - corner00) * fz
    : corner11 + (corner01 - corner11) * (1 - fx) + (corner10 - corner11) * (1 - fz);
  return Math.min(acrossA, acrossB);
}

function sampleTerrain(data, x, z) {
  const x0 = clamp(Math.floor(x), 0, 255), z0 = clamp(Math.floor(z), 0, 255);
  const x1 = clamp(x0 + 1, 0, 255), z1 = clamp(z0 + 1, 0, 255);
  const fx = clamp(x - x0, 0, 1), fz = clamp(z - z0, 0, 1);
  return data[x0 + z0 * 256] * (1-fx) * (1-fz) + data[x1 + z0 * 256] * fx * (1-fz)
    + data[x0 + z1 * 256] * (1-fx) * fz + data[x1 + z1 * 256] * fx * fz;
}
function num(value) { return Number(value || 0).toFixed(2); }
function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
