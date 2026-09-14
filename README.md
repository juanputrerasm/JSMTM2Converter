# JSMTM2Converter

[![JavaScript](https://img.shields.io/badge/JavaScript-ES%20modules-F7DF1E?logo=javascript&logoColor=000)](https://developer.mozilla.org/docs/Web/JavaScript)
[![Input](https://img.shields.io/badge/input-POD1%20%7C%20POD2-blue)](#supported-conversion)
[![Output](https://img.shields.io/badge/output-POD1-blue)](#supported-conversion)
[![Platform](https://img.shields.io/badge/platform-web-blue)](https://developer.mozilla.org/docs/Web)
[![GitHub Pages](https://img.shields.io/badge/demo-GitHub%20Pages-222?logo=github)](https://juanputrerasm.github.io/JSMTM2Converter/)
[![License](https://img.shields.io/badge/license-Apache%202.0-green)](LICENSE)

**A browser-based 4x4 Evolution track and vehicle converter for Monster Truck Madness 2.**

JSMTM2Converter reads a 4x4 Evo 1 & 2 POD1 or POD2 archive and produces a classic POD1 container for
MTM2. It converts two kinds of source: an Evo `.SIT` v6/v7 track becomes a self-contained MTM2
track, and an Evo `TRUCK\*.TRK` v6/v7 vehicle becomes an MTM2 2.1 truck. Conversion runs
locally in a Web Worker: the source archive is not uploaded, and the finished POD is downloaded
by the browser.

There are no runtime dependencies, package installations, build steps, server components, or
embedded 3D viewers.

**Live demo:** [Open JSMTM2Converter on GitHub Pages](https://juanputrerasm.github.io/JSMTM2Converter/)

---

## Features

- **Evo 1 and Evo 2 input**: finds a `.SIT` v6/v7 track by its header in a POD1 or POD2 archive,
  and `TRUCK\*.TRK` v6/v7 vehicles in POD2, with a picker when an archive holds many vehicles.
- **MTM2 2.1 trucks**: converts an Evo vehicle to an MTM2 2.1 body, tire and axle set with its
  wheel anchors, scrape points and lights carried across unchanged.
- **MTM2-ready output**: writes terrain, texture tables, objects, trucks, courses, checkpoints,
  water, lighting, map images, metadata, and required companion files into POD1.
- **HD and legacy art modes**: converts Evo textures to PNG and can add 8-bit RAW/ACT fallbacks.
- **Model conversion**: translates referenced SMF geometry and materials to Community Patch 3
  BIN command streams the engine can instance, including normal-map companions for bump textures.
- **Vegetation conversion**: turns Evo 2 VEG trees into grounded MTM2 scenery at their authored
  size while respecting the Community Patch 3 object limit.
- **Terrain-aware placement**: remaps the 16-bit height field and re-grounds objects, courses,
  checkpoints, and vegetation against the converted terrain.
- **Auditable results**: validates the generated POD1 directory and includes a detailed
  `CONVERSION.LOG` with build identifiers, warnings, and a complete archive manifest.
- **Convert, look, adjust**: keeps one JSTrackViewer tab open and reloads it with every
  conversion, so an option can be tuned without downloading anything.

## Requirements

- A modern Chromium, Firefox, or Safari browser with JavaScript modules, Web Workers, and the
  [`CompressionStream`](https://developer.mozilla.org/docs/Web/API/CompressionStream) API
- A 4x4 Evolution 1 or 2 track archive packaged as POD1 or POD2, or a vehicle archive packaged as POD2

## Using the converter

Open the [live application](https://juanputrerasm.github.io/JSMTM2Converter/), then:

1. Choose **Open Evo POD**, or drop a `.POD` file into the page. The archive is inspected and
   the page reports whether it holds a track or vehicles.
2. For a vehicle archive, pick the truck to convert.
3. Select the desired options; the collision, terrain-height and file-stem options apply to
   tracks only and are disabled for vehicles.
4. Choose **Convert to MTM2** and review any warnings in the conversion log.
5. Download the generated POD1 archive.
6. Optionally choose **Preview in JSTrackViewer** or **Preview in JSTruckViewer**, whichever the
   output is, before opening it in MTM2. The track viewer tab stays connected: convert again and
   it reloads with the new result. If the viewer is not reachable beside this page, the log says
   so and the download still holds the converted POD.

> [!WARNING]
> This is an automatic conversion between engines with different terrain, material, animation,
> and physics capabilities. Inspect and tune the generated track or truck before distributing it.

## Supported conversion

| Source content | Output |
|---|---|
| POD1 or POD2 archive | Classic POD1 archive with 32-byte directory name fields |
| Evo `TRUCK\*.TRK` v6/v7 | MTM2 2.1 truck manifest, models and art |
| Evo `.SIT` v6/v7 | MTM2 `.SIT` or Community Patch 3 `.SI2` track definition |
| 256×256 16-bit height field | 256×256 8-bit MTM2 RAW terrain |
| LVL, TEX, and CLR terrain data | MTM2 LVL, TEX, CLR, LTE, and ground-box companion grids |
| RAW/ACT/OPA and palette TIFF art | PNG and, optionally, 8-bit RAW/ACT textures |
| SMF static models | Community Patch 3 BIN models using frame zero, with instanceable faces |
| Evo 2 VEG trees | MTM2 scenery objects using the tree models at their authored size |
| Course, vehicle, object, water, and sun data | MTM2 situation-file equivalents |

## Conversion options

The options are read when conversion begins:

| Option | Default | What it changes |
|---|---|---|
| Use HD art | On | Packs PNG textures at their source colour depth. DX11 and Vulkan draw them as authored; DX9 and the software renderer quantise them into the level palette, and the software renderer requires the fallback below. |
| Add RAW/ACT fallback | Off | Also packs a legacy 8-bit pair beside each compatible PNG. This substantially increases the texture payload. |
| Vegetation is non-collide | On | Gives trees MTM2 box type 7, `drive thru`, instead of solid type 0. |
| All objects non-collide | Off | Makes converted scenery drive-through. Checkpoints retain type 6 and continue to score; billboards lose type 8 and their collision. |
| Terrain height × | 1 | Multiplies the automatic height fit. Above 1 the 8-bit field can no longer hold the whole track, so a window centred on the racing line is kept and what lies outside it is clamped flat; the log reports how much. |
| Track file stem | auto | Names every track file in the POD (`DATA\<stem>.*`, `LEVELS`, `FOG`, `WORLD`). Empty derives it from the `.SIT` name and moves it aside if that is a stock MTM2 track's stem. |

> [!IMPORTANT]
> The first two options determine the situation file extension. A POD without legacy art uses
> `WORLD\<stem>.SI2`, because an unmodified 1998 installation discovers tracks by scanning for
> `.SIT` and cannot render the PNG-only art. When fallback art is packed, the converter writes
> `.SIT` and sets `legacyFallback=1`. Turning HD art off forces the fallback on so the archive
> always contains usable texture art.

## Vehicle conversion

An archive whose only manifests are `TRUCK\*.TRK` is converted as a vehicle. A stock Evo
`TRUCK.POD` holds 121 (Evo 1) or 150 (Evo 2) of them, so the archive is inspected when it is
opened and one vehicle is chosen from the picker; each conversion produces one MTM2 truck POD.

Both engines measure a truck in feet and build it from the same three things — a body model,
four wheel models and a manifest of anchors — so most of this is a faithful re-encoding rather
than a reinterpretation. A converted body keeps its source dimensions exactly.

| Evo source | MTM2 2.1 output |
|---|---|
| `TRUCK\<name>.TRK` v6/v7 | `TRUCK\<stem>.TRK` with the `MTM2.1` header |
| `<body>.SMF` / `<body>0.SMF` | `MODELS\<stem>.BIN` / `MODELS\<stem>0.BIN` |
| `<tire><08\|12\|16><L\|R>.SMF` | `MODELS\<tire><08\|10\|16><L\|R>.BIN` |
| — | `MODELS\<tire>{16FL,16FR,16RL,16RR}.BIN`, the 2.1 four-wheel set |
| — | `MODELS\<stem>AX.BIN`, a generated axle beam |
| Single-line `faxle.*`/`raxle.*` anchors | Per-axis `.x`/`.y`/`.z` pairs, grouped as stock files group them |
| `sc[].pt` run | `Scrape point N body axis x,y,z` |
| `Light N ...` block | The same block, with converted cone and source bitmaps |
| — | `axlebarOffset` `-2,999,0` and a zero `driveshaftPos`, suppressing MTM2's suspension linkage |
| RAW/ACT/OPA and TIFF art | `ART\<stem>.PNG` (+ optional legacy pair) |
| Evo 2 `_bump.TIF` | `ART\<stem>_N.PNG` normal-map companion |

### What Evo does not supply

Three references have no source to convert and fall back to stock MTM2 assets, which every
installation has: the instrument cluster (`powerbig`) and the three engine sounds. Evo names
none of them.

Evo also has no axle model — all 271 stock manifests say `NULL.BIN`, because an Evo body carries
its own moulded underbody and suspension as ordinary geometry. MTM2 draws a separate axle, so
the converter generates a slim beam scaled to the truck's measured track width. It is
deliberately smaller than a stock MTM2 monster-truck axle so it reads as the axle tube the body
is missing rather than adding a second visible suspension.

The second axle-bar set that MTM2 2.1 also supports is **not** written. Evo has no such
hardware, and inventing it would add visible parts the source truck never had; the 2.1 header
does not require it.

### Suspension linkage

MTM2 draws axle bars and a driveshaft as procedural cylinders slung between the body and the
axles. That is monster-truck hardware, and on a converted road vehicle it appears as a large
X-shaped frame under the body that makes the truck look like it is on stilts.

There is no flag for turning it off, so the community idiom is to move the mount out of range.
The Dodge Viper GTS-R — the reference small-tire truck — ships `axlebarOffset` of
`-2.000000,999.000000,0.000000` with an all-zero `driveshaftPos`, and every converted Evo
vehicle is written the same way. For comparison, all 20 stock trucks in `TRUCK2.POD` put that
mount between 2.156 and 3.250 ft from the body, and none has a zero driveshaft.

### Transparency comes from the group, not the texture

Evo carries a transparency flag per `.SMF` group, and on a vehicle that flag is the only
trustworthy answer. The texture behind it is a shared atlas: on the Nissan Frontier, `Body` is
flagged opaque and only `Glassi`/`Glasse` are transparent, while the one `NissanFrontierSC.TIF`
they all sample has an alpha plane that varies across 47% of its texels. Across Evo's 321 drawn
vehicle models, 215 flag no transparent group at all and every one of those still samples an
alpha-bearing texture, so letting the art decide would cut holes through every tire and wheel.

A vehicle mesh is therefore transparent only where its own group says so and its texture really
does have non-opaque texels, which keeps lamps and glass while leaving bodywork, tires, wheels
and mirrors solid. Vehicles otherwise get the same faces as track scenery: plain textured faces
for solid art, a material only for alpha-tested or genuinely translucent art, nothing two-sided,
and no `REFLECT` with no reflectivity to give it.

One exception puts a mesh on the material path whatever its transparency: a normal map is read
through `MATERIAL2`, which only a material face can carry, so a bumped mesh gives up the plain
fast path to get one. That is worth paying only when the pod actually carries the `_N` art, so
with HD art off the normal maps are not written and the faces stay plain. On the ARB Wrangler
that is the difference between 4850 material faces and 68.

### What is not carried across

Evo's engine, gearbox, differential and suspension tables have no MTM2 equivalent, so a
converted truck drives on MTM2's own defaults. Evo garage paint schemes are reported in the log
but not applied, because MTM2 has no paint system, and Evo stock parts are already baked into
the body model.

## Conversion pipeline

The track pipeline:

1. Index and validate the source POD1 or POD2 entirely in memory, then find the Evo track by
   its situation file's header rather than by container or name.
2. Detect Evo 1/Evo 2 from `.SIT` v6/v7 and read SIT, LVL, TEX and course metadata.
3. Convert the 256×256 little-endian 16-bit Evo height field to MTM2's 256×256 8-bit RAW,
   scaled by the terrain height factor.
4. Preserve the 16-bit CLR tile grid and rebuild the MTM2 TEX table.
5. Decode Evo RAW/ACT/OPA and palette TIFF art, then write PNG and/or legacy RAW/ACT textures
   according to the selected art mode. The generated `ART\<track>.ACT` VGA palette is retained
   even for HD output because MTM2 still opens it. Bump textures become Community Patch 3
   `<stem>_N.PNG` normal-map companions when HD art is enabled.
6. Convert referenced SMF models to CP3 HD BIN command streams, including 64-byte texture
   opcodes. Track scenery is written as faces the engine can instance; see *Scenery models*
   below. Every face carries an outward normal and its plane term, on trucks as well.
7. Translate object, vegetation, truck, course, water-height and light-vector data to MTM2
   SIT/SI2 and LVL conventions; create the required `DATA\<stem>.TXV` version record with the
   selected fallback state, metadata, map BMPs, and lighting data.
8. Pack and re-read the classic 40-byte-record POD1 directory before enabling download. Every
   generated name fits POD1's 31-character entry budget. The archive includes `CONVERSION.LOG`.

The terminal reports every created companion file, each converted/reused/skipped texture and
model with its source and destination, warnings, omissions, and a complete archive manifest.
It also prints the current `UI BUILD` and `CONVERTER BUILD` identifiers; the converter identifier
is embedded in `CONVERSION.LOG` so a generated POD can be tied to the exact code iteration.
After a conversion, **Preview in JSTrackViewer** opens one viewer tab and posts the generated
POD into it as a Blob. It does not pass a `blob:` URL, which resolves only while this page lives
and only where the browser agrees the two pages share storage - the case that failed when the
converter was not served beside the viewer. The tab stays connected, so each later conversion
reloads it automatically.

Both preview buttons check that the viewer is actually there before opening anything. The
viewers are expected beside this page, at `../JSTrackViewer/` and `../JSTruckViewer/`, which is
how they are published; serve the converter on its own, or open it over `file://`, and there is
nothing to hand a POD to. Rather than leave a dead tab, the button reports the address it tried
and asks for the viewer to be opened there. The check runs on the click, not at page load, so
starting a viewer afterwards and clicking again works with no reload.

## The unavoidable terrain downgrade

Evo and MTM2 both use a full 256×256 terrain grid, so this converter does **not** shrink or
crop the map horizontally. The loss is vertical: Evo stores an unsigned 16-bit height at
1/32-unit precision, while MTM2 terrain has only 256 possible byte values. Evo can therefore
represent much taller terrain and much finer elevation changes.

The converter uses a global linear remap. Since MTM2's 64-unit terrain cells are twice Evo's
32-unit cells and MTM2 renders each RAW step as three vertical units, the preferred conversion
factor is 2/3 RAW steps per Evo unit. It is reduced only when the complete source altitude
range cannot fit in 0..255. Objects and course points are bilinearly re-grounded against the
converted RAW so they stay aligned. Blind spatial smoothing is intentionally not applied
because it moves road surfaces and jump lips; very tall tracks may still need selective
smoothing/tuning after the first visual inspection.

The **terrain height factor** trades that back. Deja Voodoo's 724 ft go in at 0.352 RAW levels per
foot, 53% of their true slope, so its hills read flatter than in Evo. Raising the factor restores
them, but the byte then cannot hold the whole range: a 255-level window is kept and everything
outside it is clamped flat. The window is centred on the racing line, not pinned to the lowest
valley, because the course is what has to keep its shape and distant peaks are what can afford to
lose theirs. The log reports the resulting percentage of true slope and how many cells were
clamped, and warns if the racing line itself no longer fits.

## Known limitations and fidelity notes

- Evo animated water materials are reduced to MTM2's single static water height. Tide motion,
  water colour and Evo-specific shaders have no direct MTM2 equivalent.
- The sun is the source track's own. MTM2's `.LVL` line 18 and Evo's `$lightSourceVector` are
  the same vector in the same convention - (east, up, north), the direction the light travels -
  so the conversion is a scale to 16.16 and nothing else. Baja Beach's
  `0.241845,-0.939692,0.241845` becomes `15850,-61584,15850`: a sun 70 degrees up on bearing
  225, exactly as JSTrackViewer reads the Evo original. The four values after it are the same
  in all fifteen stock levels apart from the shade scalar, so they stay stock.
- Evo baked terrain shadow maps are not portable to MTM2. DATA LTE is rebuilt from the
  converted terrain over MTM2's stock 160..255 range using Traxx's four-cross-product cell
  normal, with the horizontal term taken from the track's own sun. Traxx offers that term as a
  five-way compass; dotting the sun's normalised horizontal direction with `(nx, ny)` is the
  same thing and also covers a sun between two compass points. The sign is fixed by regression
  against the stock grids: levels whose vector starts `+46333` match `+nx` (TPARK r=0.87,
  SUMMIT1 r=0.86), those starting `-46333` match `-nx` (BAJA r=0.90). Getting it backwards
  lights the hemisphere opposite the lens flare.
- `ART\<track>.ACT` is median-cut from the track's own converted art rather than being a fixed
  colour cube. This is not a legacy detail: HD registration - a PNG drawn at its own depth - is
  a DX11/Vulkan path, while the software and DX9 renderers read the same PNG and quantise it
  into this palette, so on those renderers the palette *is* the picture. Measured over Baja
  Beach's 191 terrain tiles (782,336 texels, 1,792 distinct colours) the cube quantised at an
  RMS error of 24.54 and the median cut reaches 1.97. Index 229 stays white because
  `STARTUP.POD`'s `FOG\VGA.LTE` maps its brightest shade row there.
- Courses follow the stock layout: the primary `*** Course ***` block is the Evo racing line,
  extended courses 1 and 2 carry the AI routes, and 3 and 4 stay empty - which is what all
  fifteen stock levels do. Every racer is sent to extended course 2, as they are in every stock
  level. Evo's own `courseToFollow` indexes Evo's course list, not MTM2's four slots, so it is
  not carried across.
- Scenery is immovable. MTM2 reads a zero mass as "cannot be pushed" and 195 of TPARK's 398
  boxes are written that way; converted objects, checkpoints and vegetation all take it, so a
  rock stays where it was placed. Vegetation additionally uses type 7, MTM2's "drive thru".
- Checkpoint gates are written as MTM2 half-extents on the right axes and at the right scale.
  `length,width,height` are half-extents on (y, x, z) - Traxx builds the prism from
  `-length..+length` on axis 1 and `-width..+width` on axis 0 - while Evo carries a full size on
  its own (x, up, z). The horizontal factors cancel as they do for positions: MTM2's world is
  twice Evo's and the situation file stores half-units. The vertical one does not. An extent is
  in world units, where MTM2 draws terrain at 3 per RAW level and a SIT altitude at 1.5, so an
  Evo foot is two of them. Baja Beach's `147,66,2` becomes `2,147,66`.
- Anything measured against a model - a tree's half height, an object's clearance above its own
  patch of ground, a gate's height - converts at a fixed 2 world units per Evo foot, never at the
  scale the terrain happened to be fitted to. A model keeps its size however much the height
  field had to be squeezed, so tying model distances to the terrain's fit sinks objects into the
  ground, by more the more the terrain was compressed. The constant is measured: across 604 stock
  MTM2 placements of flat-bottomed models on dead-flat ground, a model's lowest vertex meets the
  terrain when one BIN unit is 1.5 world units (median residual 0.00), and our vertical records
  are pre-divided by 0.75. Lifting trees by 2/3 of their half height instead of the full 2 buried
  each one by a third of it - about 19 units on a 115 ft jungle tree.
- Objects are grounded against the surface the engine draws, not the height field it was fitted
  from. Sampling the Evo source and rounding it to a level is a subtly different surface: it
  interpolates at full precision and then rounds, while the engine interpolates levels that were
  rounded first, and the two part company where cells meet steeply. On Baja Beach that left a
  quarter of the trees more than a unit above the ground and the worst 14.5 units up, which is
  what floating along a hill's edge looks like. A cell also has two possible surfaces, since it
  is split into triangles and nothing in the files says which diagonal the engine picks; at a
  saddle the two readings differ by up to 31 units. The lower of the two is used, so a model can
  sit slightly into the ground where the surface is ambiguous (median 0.79 units) but never hangs
  above it.
- A tree is grounded on the lowest surface under its trunk, not under the single point it stands
  at. A trunk is 5.6 to 12.1 world units wide on Baja Beach's four trees, so on a slope the
  ground under its downhill side sits lower than the ground under its middle and a tree planted
  by its centre overhangs the hill: 90% of that track's trees stood more than a unit clear that
  way, half more than 3.6 and the worst 24.4. The ground is read at eight points around the trunk
  and the **lowest** is used, so the base is under the surface everywhere across the footprint
  and the uphill side of the trunk goes into the hill. Taking the highest instead raises the tree
  by that same drop and makes the overhang worse; level ground is unaffected either way. Sixteen
  points miss the true low of a disk by a median of 0.013 world units where eight miss by 0.056,
  and interior samples add nothing, so the last tenths are covered by sinking every tree a further
  half level (1.5 world units, about nine inches) rather than by sampling harder.
- A gate is then grown downward until it reaches the terrain, measured over its whole footprint
  against the converted RAW grid rather than under its centre. Only the base moves, so a gate
  never grows up into scenery. Evo's own gates are usually sunk into the ground already and need
  none of this; it is there for the ones on a slope.
- The two picker bitmaps are generated from the height field: a 257x210 picture with the
  primary course drawn over it for the "Track Logo" slot, and a 32x24 list icon for
  "Track Map". ⚠ The slots are not named for their sizes - all fifteen stock levels put the
  large picture in Logo and the small icon in Map.
- The nine ground-box terrain grids (`DATA\<stem>.RA0`-`.RA5`, `.CL0`-`.CL2`) are always packed.
  MTM2 derives their names from the LVL's RAW entry and reads them for every level; all fifteen
  stock terrain sets ship them and Traxx writes them unconditionally. Evo authors no ground
  boxes, so they carry the stock "no boxes" values - zero altitudes and face textures, and the
  `0xFF` RA2/RA3 pair that marks the second layer solid rather than an open cavern at height
  zero. Omitting them leaves the engine reading whatever the previously loaded level left in
  those grids, which is what blacked out Clear-weather terrain in CommPatch 3.
- TEX and BIN records retain conventional `.RAW` references so MTM2 can use its normal lookup
  order. When HD art is enabled, the same-stem PNG is the primary art; enabling the fallback
  adds the RAW/ACT pair without changing those references.
- The POD is self-contained: its LVL references the included `ART\\<track>.ACT`, paired with its
  generated `FOG\\<track>.MAP`. That map's byte zero is a palette selector rather than an RGB555
  entry, and is written as `0` to match every stock map. Terrain art that was 8-bit per tile in
  Evo cannot gain colour depth in conversion; full-colour `.TIF` model art keeps its own.
- SMF frame zero is converted. Multi-frame SMF animation and Evo physics-only object fields do
  not have a direct static MTM2 BIN/SIT equivalent.
- Evo 2 VEG trees become ordinary MTM2 scenery boxes that place the slot's own converted model at
  its authored size, with its base on the bilinearly sampled converted terrain. The VEG's
  `treeSizeX,treeSizeY,treeBiasY` are **not** a model scale: they size Evo's distant billboard.
  Every `.VEG` names a `treeTex` that is a sheet of tree sprites (`SKULLSET0.TIF`,
  `DESERTSET0.TIF`), the bias is always negative - a sprite sunk into the ground - and against the
  models the sizes bear no consistent relation: across the five stock Evo 2 tracks `treeSizeY` /
  model height runs from 0.22 to 2.13, and TRIBAJA gives `DESERT115` 80 ft in one slot and 25 ft in
  another. Scaling to them made Snake River's trees 0.35 of their size, Deja Voodoo's 3.2 times and
  Terramar's 1.6 times. There are therefore no `V_*` pre-scaled copies any more, which also ends
  their cross-track collisions (two tracks each shipping a different `V_DESERT115.BIN`, of which
  the engine serves only the first). When necessary, trees are evenly thinned across the whole
  map after reserving space for ordinary objects and checkpoints, so the result stays within
  CP3's 4,096-object authoring limit (below the engine's 4,608 hard cap). Trees use MTM2 static
  no-collide type 7. Grass/scrub fields and RTD-specific behaviour are not synthesized.
- **Scenery models** are written for the engine's fast paths (CP3's
  `CONVERTER_HANDOVER_EVO2_MODELS.md`). Placed scenery is instanced, replayed from a resident
  cache, or rebuilt every frame; plain textured faces take both fast paths, and they are what stock
  MTM2 scenery uses (93% `ZFACETTMAP` across five stock tracks, no material faces at all). So
  opaque art is `ZFACETTMAP` (`ZGFACETTMAP` when the SMF marks it reflective); alpha-tested art is a
  material face with exactly `LIT|GOURAUD|ALPHATEST`; `BLEND` is kept only for a texture whose alpha
  is translucent in earnest (over 40% of texels between clear and solid - stock Evo trees, fences
  and drops stay under 22%), and never on vegetation. Which parts are transparent comes from the
  model when the model says: Evo splits mixed models into `OPAQUE` beside `TRANSP`/`TRANSPI`/
  `TRANSPE` groups on one shared texture, so `IL3WRECK`'s hull stays opaque while its glass does
  not. Only where no group is flagged does the texture decide for all of them, which is the tree
  case. A texture whose alpha plane is solid throughout counts as opaque, since some Evo art
  carries an alpha channel that asks for nothing. Nothing is `TWOSIDED` and nothing is
  `REFLECT`: Evo culls back faces and authors the ones it wants (70-79% of a tree's faces sit on
  another), and a reflectivity of zero only disqualifies a model. Faces repeated with the same
  winding are dropped, since they z-fight even with culling on.
- Every face points outward and carries its plane term, trucks included. The SMF reader reflects
  Z and reverses each triangle; the BIN writer reflects Z back, so it now writes the corners in
  reverse as well. Before that, Evo's convex rocks came out with 94% of their normals pointing
  inward and truck tires 100%, hidden by `TWOSIDED`. The face header's fourth word is the plane
  term - the stored normal dotted with the first corner in the file's units - which stock files
  hold on 99.96% of 21,053 faces and which used to be written as 0.
- The track's files are named from a stem that no stock MTM2 track uses. The engine serves the
  first mounted copy of every file name and the stock pods mount first, so a track converted from
  Evo's `SNAKE.POD` as `SNAKE` loaded MTM2's own Snake terrain, lighting, level and palette beneath
  its objects. A stock stem is now moved aside with the Evo generation (`SNAKE` becomes `SNAKEE2`),
  and an explicit stem that collides is refused.

These cases are logged as conversion limitations rather than silently presented as lossless.

## Architecture

| Component | Role |
|---|---|
| ES modules | Browser interface, format readers/writers, and conversion stages |
| Module Web Worker | Runs the conversion without blocking the page |
| POD reader | Indexes a POD1 or POD2 source archive and resolves referenced assets |
| Evo parsers | Read SIT, LVL, TEX, TRK, SMF, VEG, RAW/ACT/OPA, and TIFF content |
| Conversion pipeline | Remaps terrain, converts art and models, and translates placements |
| MTM2 writers | Build the situation, level, truck manifest, companion files, and validated POD1 archive |

## Contributing

Bug reports and pull requests are welcome. For conversion defects, include the source game,
track name, selected options, converter build identifier, and the relevant warnings from
`CONVERSION.LOG`. Do not attach copyrighted game archives to public issues.

## Related projects

- [JSTrackViewer](https://github.com/juanputrerasm/JSTrackViewer): browser-based 3D viewer used
  to inspect converted tracks and validate generated situation files.
- [JTraxx](https://github.com/juanputrerasm/JTraxx3): desktop MTM/MTM2 track editor and the
  source of several format conventions reproduced by this converter.
- [JSPod](https://github.com/juanputrerasm/JSPod): browser-based POD archive and asset viewer.

## Credits and license

Developed by **Juan Pablo Utreras** for the Monster Truck Madness Guild.

Released under the [Apache License 2.0](LICENSE).

The game names and Terminal Reality are trademarks of their respective owners. This project is
an independent community tool and is not affiliated with or endorsed by their owners.
