# JSMTM2Converter

[![JavaScript](https://img.shields.io/badge/JavaScript-ES%20modules-F7DF1E?logo=javascript&logoColor=000)](https://developer.mozilla.org/docs/Web/JavaScript)
[![Input](https://img.shields.io/badge/input-POD2-blue)](#supported-conversion)
[![Output](https://img.shields.io/badge/output-POD1-blue)](#supported-conversion)
[![Platform](https://img.shields.io/badge/platform-web-blue)](https://developer.mozilla.org/docs/Web)
[![GitHub Pages](https://img.shields.io/badge/demo-GitHub%20Pages-222?logo=github)](https://juanputrerasm.github.io/JSMTM2Converter/)
[![License](https://img.shields.io/badge/license-Apache%202.0-green)](LICENSE)

**A browser-based 4x4 Evolution track converter for Monster Truck Madness 2.**

JSMTM2Converter reads a 4x4 Evo 1 & 2 POD2 archive containing an Evo `.SIT` v6 or v7
track and produces a self-contained MTM2 track in a classic POD1 container. Conversion runs
locally in a Web Worker: the source archive is not uploaded, and the finished POD is downloaded
by the browser.

There are no runtime dependencies, package installations, build steps, server components, or
embedded 3D viewers.

**Live demo:** [Open JSMTM2Converter on GitHub Pages](https://juanputrerasm.github.io/JSMTM2Converter/)

---

## Features

- **Evo 1 and Evo 2 input**: detects `.SIT` v6/v7 tracks inside POD2 archives.
- **MTM2-ready output**: writes terrain, texture tables, objects, trucks, courses, checkpoints,
  water, lighting, map images, metadata, and required companion files into POD1.
- **HD and legacy art modes**: converts Evo textures to PNG and can add 8-bit RAW/ACT fallbacks.
- **Model conversion**: translates referenced SMF geometry and materials to Community Patch 3
  BIN command streams, including normal-map companions for bump textures.
- **Vegetation conversion**: turns Evo 2 VEG trees into grounded, scaled MTM2 scenery while
  respecting the Community Patch 3 object limit.
- **Terrain-aware placement**: remaps the 16-bit height field and re-grounds objects, courses,
  checkpoints, and vegetation against the converted terrain.
- **Auditable results**: validates the generated POD1 directory and includes a detailed
  `CONVERSION.LOG` with build identifiers, warnings, and a complete archive manifest.
- **Immediate inspection**: opens the generated in-memory POD directly in JSTrackViewer.

## Requirements

- A modern Chromium, Firefox, or Safari browser with JavaScript modules, Web Workers, and the
  [`CompressionStream`](https://developer.mozilla.org/docs/Web/API/CompressionStream) API
- A 4x4 Evolution 1 or 2 track packaged as a POD2 archive

## Using the converter

Open the [live application](https://juanputrerasm.github.io/JSMTM2Converter/), then:

1. Choose **Open Evo POD2**, or drop a `.POD` file into the page.
2. Select the desired art and collision options.
3. Choose **Convert to MTM2** and review any warnings in the conversion log.
4. Download the generated POD1 archive.
5. Optionally choose **Preview in JSTrackViewer** before opening the track in MTM2.

> [!WARNING]
> This is an automatic conversion between engines with different terrain, material, animation,
> and physics capabilities. Inspect and tune the generated track before distributing it.

## Supported conversion

| Source content | Output |
|---|---|
| POD2 archive | Classic POD1 archive with 32-byte directory name fields |
| Evo `.SIT` v6/v7 | MTM2 `.SIT` or Community Patch 3 `.SI2` track definition |
| 256×256 16-bit height field | 256×256 8-bit MTM2 RAW terrain |
| LVL, TEX, and CLR terrain data | MTM2 LVL, TEX, CLR, LTE, and ground-box companion grids |
| RAW/ACT/OPA and palette TIFF art | PNG and, optionally, 8-bit RAW/ACT textures |
| SMF static models | Community Patch 3 BIN models using frame zero |
| Evo 2 VEG trees | Scaled MTM2 scenery objects |
| Course, vehicle, object, water, and sun data | MTM2 situation-file equivalents |

## Conversion options

The four options are read when conversion begins:

| Option | Default | What it changes |
|---|---|---|
| Use HD art | On | Packs PNG textures at their source colour depth. DX11 and Vulkan draw them as authored; DX9 and the software renderer quantise them into the level palette, and the software renderer requires the fallback below. |
| Add RAW/ACT fallback | Off | Also packs a legacy 8-bit pair beside each compatible PNG. This substantially increases the texture payload. |
| Vegetation is non-collide | On | Gives trees MTM2 box type 7, `drive thru`, instead of solid type 0. |
| All objects non-collide | Off | Makes converted scenery drive-through. Checkpoints retain type 6 and continue to score; billboards lose type 8 and their collision. |

> [!IMPORTANT]
> The first two options determine the situation file extension. A POD without legacy art uses
> `WORLD\<stem>.SI2`, because an unmodified 1998 installation discovers tracks by scanning for
> `.SIT` and cannot render the PNG-only art. When fallback art is packed, the converter writes
> `.SIT` and sets `legacyFallback=1`. Turning HD art off forces the fallback on so the archive
> always contains usable texture art.

## Conversion pipeline

1. Index and validate the source POD2 entirely in memory.
2. Detect Evo 1/Evo 2 from `.SIT` v6/v7 and read SIT, LVL, TEX and course metadata.
3. Convert the 256×256 little-endian 16-bit Evo height field to MTM2's 256×256 8-bit RAW.
4. Preserve the 16-bit CLR tile grid and rebuild the MTM2 TEX table.
5. Decode Evo RAW/ACT/OPA and palette TIFF art, then write PNG and/or legacy RAW/ACT textures
   according to the selected art mode. The generated `ART\<track>.ACT` VGA palette is retained
   even for HD output because MTM2 still opens it. Bump textures become Community Patch 3
   `<stem>_N.PNG` normal-map companions when HD art is enabled.
6. Convert referenced SMF models to CP3 HD BIN command streams, including 64-byte texture
   opcodes and material facets. Evo 2 VEG tree slots receive pre-scaled BIN variants.
7. Translate object, vegetation, truck, course, water-height and light-vector data to MTM2
   SIT/SI2 and LVL conventions; create the required `DATA\<stem>.TXV` version record with the
   selected fallback state, metadata, map BMPs, and lighting data.
8. Pack and re-read the classic 40-byte-record POD1 directory before enabling download. Every
   generated name fits POD1's 31-character entry budget. The archive includes `CONVERSION.LOG`.

The terminal reports every created companion file, each converted/reused/skipped texture and
model with its source and destination, warnings, omissions, and a complete archive manifest.
It also prints the current `UI BUILD` and `CONVERTER BUILD` identifiers; the converter identifier
is embedded in `CONVERSION.LOG` so a generated POD can be tied to the exact code iteration.
After a conversion, **Preview in JSTrackViewer** opens the generated in-memory POD through a
same-origin Blob URL; downloading or copying the POD to the server is unnecessary.

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
  Evo foot is `3 * terrain.scale` of them. Baja Beach's `147,66,2` becomes `2,147,52.3`.
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
- Evo 2 VEG trees become ordinary MTM2 scenery boxes. Their four model slots are independently
  scaled to the VEG sizes, based on each SMF's measured extents, and their bases are placed on
  the bilinearly sampled converted terrain. When necessary, trees are evenly thinned across the
  whole map after reserving space for ordinary objects and checkpoints, so the result stays
  within CP3's 4,096-object authoring limit (below the engine's 4,608 hard cap). Trees use
  MTM2 static no-collide type 7. Grass/scrub fields and RTD-specific behaviour are not
  synthesized.

These cases are logged as conversion limitations rather than silently presented as lossless.

## Architecture

| Component | Role |
|---|---|
| ES modules | Browser interface, format readers/writers, and conversion stages |
| Module Web Worker | Runs the conversion without blocking the page |
| POD2 reader | Indexes the source archive and resolves referenced assets |
| Evo parsers | Read SIT, LVL, TEX, SMF, VEG, RAW/ACT/OPA, and TIFF content |
| Conversion pipeline | Remaps terrain, converts art and models, and translates placements |
| MTM2 writers | Build the situation, level, companion files, and validated POD1 archive |

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
