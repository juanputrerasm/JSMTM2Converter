import { title } from "../../shared/paths.js";
import { BUILD_ID } from "../../build-info.js";

const CRLF = "\r\n";
const ascii = value => new TextEncoder().encode(value);
// Extended course slots MTM2 levels actually use, and the one the AI field is sent to.
const EXTENDED_COURSES = 2, AI_COURSE = 2;
// MTM2 reads a zero mass as "this object cannot be pushed".
const IMMOVABLE = "0.000000";
// MTM2's "drive thru" box type: drawn, never collided with.
const DRIVE_THRU = 7;

export function writeTrackFiles({ prefix, sit, lvl, terrain, textureNames, modelNames, vegetation = [], hasLargeHdTexture = false, legacyFallback = false, options = {} }) {
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
  text(`WORLD\\${prefix}.${situation}`, buildSit({ prefix, sit, terrain, modelNames, vegetation, pictureBmp, iconBmp, options }));
  text(`LEVELS\\${prefix}.LVL`, buildLvl(prefix, lvl, terrain));
  text(`DATA\\${prefix}.TEX`, `${textureNames.length}\n${textureNames.join("\n")}\n`);
  text(`DATA\\${prefix}.TTY`, "0\n");
  text(`DATA\\${prefix}.PUP`, "0\n"); text(`DATA\\${prefix}.ANI`, "0\n");
  text(`DATA\\${prefix}.TDF`, "0\n"); text(`DATA\\${prefix}.DEF`, "0\n"); text(`DATA\\${prefix}.NAV`, "0\n");
  text(`DATA\\${prefix}.TXV`, `# MTM2 track version record - written by JSMTM2Converter\nformatVersion=1\ntool=JSMTM2Converter\ntoolVersion=${BUILD_ID}\nlegacyFallback=${legacyFallback ? 1 : 0}\nhdTextures=${hasLargeHdTexture ? 1 : 0}\n`);
  files.push({ name: `DATA\\${prefix}.LTE`, data: makeLte(terrain, sunVector(lvl)) });
  for (const grid of groundBoxGrids(prefix)) files.push(grid);
  return { files, situation, pictureBmp: `UI\\${pictureBmp}`, iconBmp: `UI\\${iconBmp}` };
}

/*
  The ground-box terrain grids. MTM2 derives these nine names from the .LVL's RAW entry and
  reads them for every level, so they are not optional companions: all fifteen stock MTM2
  terrain sets ship the complete set, MAIN.POD included, and Traxx writes them unconditionally.
  A track that omits them leaves the engine's grids holding whatever the previously loaded
  level put there, which is why the terrain lit correctly under overcast weather but not under
  the Clear sun path that consults them.

  Evo has no ground-box equivalent, so every grid takes the "no boxes anywhere" value the stock
  files use: zero lower/upper altitudes (RA0/RA1), zero face textures (CL0/CL1/CL2), and the
  0xFF floor/ceiling pair (RA2/RA3) that marks the second layer as solid rock rather than an
  open cavern at height zero. RA4/RA5 are zero in every stock track.
*/
function groundBoxGrids(prefix) {
  const grid = (extension, bytes, fill) => ({
    name: `DATA\\${prefix}.${extension}`,
    data: fill ? new Uint8Array(bytes).fill(fill) : new Uint8Array(bytes),
  });
  return [
    grid("RA0", 65536), grid("RA1", 65536), grid("RA2", 65536, 0xff), grid("RA3", 65536, 0xff),
    grid("RA4", 65536), grid("RA5", 65536),
    grid("CL0", 12 * 65536), grid("CL1", 4 * 65536), grid("CL2", 12 * 65536),
  ];
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

function buildLvl(prefix, lvl, terrain) {
  // Evo's LVL water value is in half-units; terrain and placements are ordinary world units.
  const water = Math.round(4 * terrain.mapHeight(lvl.water.height / 2));
  const sun = sunVector(lvl).map(component => Math.round(component * SUN_FIXED_POINT)).join(",");
  return [
    "0", `${prefix}.TXT`, `${prefix}.RAW`, `${prefix}.CLR`, `${prefix}.ACT`, `${prefix}.TEX`,
    "ZERO.RAW", `${prefix}.PUP`, `${prefix}.ANI`, `${prefix}.TDF`, "CLOUDY2.RAW", "CLOUDY2.ACT",
    `${prefix}.DEF`, `${prefix}.NAV`, "ROCKX.WAV", `${prefix}.FOG`, `${prefix}.LTE`,
    // Line 18 is the track's own sun. The four values after it are the same in all fifteen
    // stock MTM2 levels apart from the shade scalar (23000..40960), so they stay stock:
    // runtime shade scalar, sun position, intensity, and the trailing 255.
    sun, "40960", "32000,-46333,0", "64000", "255", "!waterHeight", String(water), "",
  ].join("\n");
}

function buildSit({ prefix, sit, terrain, modelNames, vegetation, pictureBmp, iconBmp, options = {} }) {
  const out = [
    `${prefix}.LVL`, "!Race Track Name", clean(sit.trackName || prefix), "Race Track Locale", "EVO CONVERSION",
    "Track Longtitude, Latitude", "7947984,7947988", "Track Logo .BMP file", `UI\\${pictureBmp}`,
    "Track Map .BMP file", `UI\\${iconBmp}`, "Track Fly-By .AVI file", "Sonic", "Track Announcer .WAV file", "Track",
    // MTM2 situation files name the UI bitmaps with their folder and the description with the
    // DATA stem; stock TPARK reads "UI\Farm.bmp" and "tpark.txt" in these three slots.
    "Track Description .TXT file", `${prefix}.TXT`, "Track Race Type", String(sit.raceType || 0), "@Redbook Audio Track", "2",
    "!ambient sound,track length,weather mask", `${sit.ambientSound || 0},${num(sit.trackLength)},${sit.weatherMask || 0}`,
    "viewmode,spotd,spotp,spoth,zoom", "0,16384,-16383,24832,98304", "$racetime, raceStartTime, dragDebugTimer", "0,0,0",
    "controlflag, autoShift, autoStage, bothStaged, bothStagedPrev", "0,1,0,0,0", "stageComFlag, bonusLapFlag", "0,0",
  ];
  const starts = sit.vehicles.length ? sit.vehicles : [{ position: firstStart(sit), orient: [0,0,0] }];
  out.push("*** Your Truck (Not used anymore) ***", "*********************************************");
  truck(out, starts[0], terrain, 0);
  out.push("*** Vehicles ***", "8");
  // Every racer follows extended course 2 in all fifteen stock levels, and Traxx's own notes
  // record the same ("Trucks always follow course 2???"). Evo's courseToFollow indexes Evo's
  // course list, not MTM2's four extended slots, so carrying it across pointed the field at
  // course 1 - the slot MTM2 uses for the map route - instead.
  for (let i = 0; i < 8; i++) { out.push("*********************************************"); truck(out, starts[i % starts.length], terrain, AI_COURSE); }
  out.push("*** Ramps ***", "0", "*** Boxes ***");
  const boxes = sit.boxes.filter(box =>
    (box.modelName && modelNames.has(title(box.modelName))) || isCheckpoint(box));
  out.push(String(boxes.length + vegetation.length));
  for (const box of boxes) {
    const gate = isCheckpoint(box) ? checkpointBox(box, terrain) : null;
    out.push("*********************************************", "ipos", (gate?.ipos ?? placed(box.position, terrain)).join(","), "theta,phi,psi", box.orient.map(num).join(","));
    if (gate) out.push("length,width,height", gate.extents.map(num).join(","));
    else out.push("model", modelNames.get(title(box.modelName)));
    /*
      Mass zero is MTM2's "cannot be moved" - 195 of TPARK's 398 boxes are written that way
      and everything with a non-zero mass there is deliberately knockable. Evo scenery is
      static, so a converted rock, hut or wreck must not be shovable; 1000 made every one of
      them a prop the truck could push around.
    */
    out.push("mass", IMMOVABLE, "bvel", "0,0,0", "p,q,r", "0,0,0",
      "!type,flags", `${boxTypeFor(box, options)},0`, "priority", "0", "@sound effect entries", "NULL.WAV", "NULL.WAV", "0,0");
  }
  for (const tree of vegetation) {
    out.push("*********************************************", "ipos", placedOnGround(tree, terrain).join(","), "theta,phi,psi", `0.00,0.00,${num(tree.yaw)}`,
      // Type 7 is MTM2's "drive thru" - vegetation never collides - and mass zero keeps it
      // rooted rather than merely intangible.
      "model", tree.modelName, "mass", IMMOVABLE, "bvel", "0,0,0", "p,q,r", "0,0,0",
      "!type,flags", `${options.vegetationNonCollide === false ? 0 : DRIVE_THRU},0`, "priority", "0", "@sound effect entries", "NULL.WAV", "NULL.WAV", "0,0");
  }
  out.push("*** Cylinders ***", "0", "*** Top Crush ***", "0", "*** Course ***", "c1Count,course_direction");
  course(out, sit.courses[0], terrain);
  /*
    The extended courses. All fifteen stock MTM2 levels fill [Course 1] and [Course 2] and
    leave [Course 3] and [Course 4] at "0,0" - and all of them send every racer to course 2
    (see the truck writer). Filling 3 and 4 as well, as this used to, publishes two routes no
    stock track has and no truck asks for. An Evo level that authors alternate racing lines
    supplies them here; otherwise both AI routes repeat the primary line.
  */
  out.push("@*********** Extended Course Definitions *************", "4");
  for (let i = 0; i < 4; i++) {
    out.push(`[Course ${i + 1}] c1Count,course_direction`);
    if (i >= EXTENDED_COURSES) { out.push("0,0"); continue; }
    const alternate = sit.courses[i + 1];
    course(out, alternate?.segments?.length >= 3 ? alternate : sit.courses[0], terrain);
  }
  out.push("*** Stadium ***", "stadiumFlag,stadiumModelName", "0,none", "*** Backdrop ***", "backdropType,backdropCount", "0,0", "backdropModelName", "");
  return out.join("\n");
}

function truck(out, vehicle, terrain, courseNumber) {
  out.push("truckFile", "POWERBIG.TRK", "ipos", placed(vehicle.position, terrain).join(","), "bvel", "0,0,0", "theta,phi,psi", vehicle.orient.map(num).join(","),
    "p,q,r", "0,0,0", "faxle.angle,faxle.steering_angle", "0,0", "faxle.rtire.on_gnd,faxle.ltire.on_gnd", "-1,1",
    "raxle.angle,raxle.steering_angle", "0,0", "raxle.rtire.on_gnd,raxle.ltire.on_gnd", "-1,1", "xm.gear", "4",
    "ap.autopilot,ap.cnumber", "0,1", "ap.speed_control,ap.course_control,ap.lasterror", "0,0,0", "!ap.courseToFollow", String(courseNumber),
    "$heliTimer,heliTheta,heliPhi,heliPsi", "0,0,0,0", "heliPos", "0,0,0", "^segments,laps,staged,bonusLaps,finishedRace,nextcheckpoint", "0,0,0,0,0,0", "totalracetime,fastestLap,dragTimer", "0,0,0");
  for (let lap = 0; lap < 20; lap++) out.push("***Lap time***", "0", "*****Checkpoint times*****", ...Array(20).fill("0"));
}

function course(out, value, terrain) {
  const segments = value?.segments ?? []; out.push(`${segments.length},0`);
  segments.forEach((segment, i) => out.push(`********************************************* ${2*i+1}`, "ctype,cspeed_type", "1,0",
    "cstart", placed(segment.start, terrain).join(","), "cend", placed(segment.end, terrain).join(","),
    // Stock levels record 0 here (WAR's arena is the one exception at 16), and so does Evo.
    "cdec_point,cspeed,lastentry", "30,0,0", "&cSpeedLimit,cTrackWidth", `${num(segment.speedLimit)},${num(segment.trackWidth)}`));
}

function placed(position, terrain) {
  const [x = 4096, y = 0, z = 4096] = position ?? [];
  const sourceGround = sampleTerrain(terrain.source, x / 32, z / 32);
  const targetGround = terrain.mapHeight(sourceGround);
  // MTM2 renders SIT height as 1.5*Y and terrain as 3*RAW. Preserve the source clearance
  // using the same vertical scale selected for terrain, rather than multiplying it twice.
  return [num(x), num(2 * targetGround + 2 * terrain.scale * (y - sourceGround)), num(z)];
}

function placedOnGround(tree, terrain) {
  const sourceGround = sampleTerrain(terrain.source, tree.x / 32, tree.z / 32);
  const targetGround = terrain.mapHeight(sourceGround);
  // The BIN variant is already scaled to the authored tree height. MTM2 renders a SIT Y
  // coordinate at 1.5 world units, so add 2/3 of the model-origin clearance above ground.
  return [num(tree.x), num(2 * targetGround + (2 / 3) * tree.clearance), num(tree.z)];
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

function checkpointBox(box, terrain) {
  const ipos = placed(box.position, terrain);
  const [width = 64, up = 64, depth = 64] = box.size ?? [];
  const [x = 0, , z = 0] = box.position ?? [];
  const full = up * RAW_TO_WORLD * terrain.scale;
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

function sampleTerrain(data, x, z) {
  const x0 = clamp(Math.floor(x), 0, 255), z0 = clamp(Math.floor(z), 0, 255);
  const x1 = clamp(x0 + 1, 0, 255), z1 = clamp(z0 + 1, 0, 255);
  const fx = clamp(x - x0, 0, 1), fz = clamp(z - z0, 0, 1);
  return data[x0 + z0 * 256] * (1-fx) * (1-fz) + data[x1 + z0 * 256] * fx * (1-fz)
    + data[x0 + z1 * 256] * (1-fx) * fz + data[x1 + z1 * 256] * fx * fz;
}
/*
  DATA\<stem>.LTE, MTM2's baked terrain light grid: seven bytes per cell, of which only the
  first (ground) is meaningful here. The remaining six describe ground-box faces and stay zero
  because Evo authors none.

  This reproduces Traxx's BuildLte: accumulate the cell normal from four cross products over
  the 64-unit neighbourhood, take |nz|/len as the overhead term, then add a horizontal term.
  The 160..255 range is the value stock MTM2 ships (ROCKQRY, SUMMIT1-3 and TPARK all use it).

  ⚠ THE HORIZONTAL TERM BELONGS TO THE .LVL SUN VECTOR, NOT TO TASTE. Traxx offers it as a
  five-way compass - Noon adds nothing, and the other four add or subtract nx or ny - which is
  the same thing as dotting the sun's normalised horizontal direction with (nx, ny), and that
  generalises to a sun like Baja Beach's that sits between two compass points. Regressing the
  stock grids against their own RAW settles the sign: levels whose vector starts +46333 match
  +nx (TPARK r=0.87, SUMMIT1 r=0.86) and the ones starting -46333 match -nx (BAJA r=0.90).
  Getting it backwards lights the hemisphere opposite the lens flare.
*/
function makeLte(terrain, sun = DEFAULT_SUN) {
  const out = new Uint8Array(256 * 256 * 7);
  const raw = terrain.raw;
  const dark = 160, bright = 255;
  // The sun's compass direction, in the grid's own axes: LVL east is grid x, LVL north grid y.
  const horizontal = Math.hypot(sun[0], sun[2]);
  const sunX = horizontal ? sun[0] / horizontal : 0, sunY = horizontal ? sun[2] / horizontal : 0;
  for (let y = 0; y < 256; y++) {
    const row = y << 8;
    for (let x = 0; x < 256; x++) {
      const height = raw[x + row];
      // West, south, east and north neighbours, wrapped exactly as MTM2's grid wraps.
      const ring = [
        [-64, 0, raw[((x - 1) & 255) + row]],
        [0, 64, raw[x + (((y + 1) & 255) << 8)]],
        [64, 0, raw[((x + 1) & 255) + row]],
        [0, -64, raw[x + (((y - 1) & 255) << 8)]],
      ];
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < 4; i++) {
        const [x1, y1, z1] = ring[i], [x2, y2, z2] = ring[(i + 1) & 3];
        nx += y1 * (z2 - height) - y2 * (z1 - height);
        ny += x1 * (z2 - height) - x2 * (z1 - height);
        nz += x1 * y2 - x2 * y1;
      }
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const facing = (Math.abs(nz) + sunX * nx + sunY * ny) / length;
      out[(x + row) * 7] = clamp(dark + Math.trunc((bright - dark) * facing), 8, 255);
    }
  }
  return out;
}
function num(value) { return Number(value || 0).toFixed(2); }
function clean(value) { return String(value).replace(/[\r\n]/g, " ").slice(0, 80); }
function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
