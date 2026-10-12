---
paths:
  - "src/poc3d/real/meshBuilder.ts"
  - "src/poc3d/real/city.ts"
  - "src/poc3d/real/park.ts"
  - "src/poc3d/real/buildings.ts"
  - "src/poc3d/real/props.ts"
  - "src/poc3d/real/cars.ts"
  - "src/poc3d/real/ground.ts"
  - "src/poc3d/real/lightmap.ts"
  - "src/poc3d/real/signs.ts"
  - "src/poc3d/real/letters.ts"
  - "src/poc3d/real/overlay.ts"
  - "src/poc3d/real/ssr.ts"
  - "src/poc3d/real/grade.ts"
  - "src/poc3d/real/screenLight.ts"
  - "src/poc3d/models/payphone.ts"
  - "scripts/blender/payphone.py"
---

# Rendering: the city material and the pipeline

Covers the mesh builder, the one city material, buildings, props, ground, the lightmap, signs, the ASCII overlay, the post-processing pipeline, screen light. One of the area docs indexed in the root CLAUDE.md; one topic a paragraph.

**Branch `realistic-visuals`** (the `ascii-v1` tag is the last ASCII-defined build): the district renders realistically and ASCII is only an overlay for mood. `src/poc3d/real/`:

- `meshBuilder.ts`: append-only merged-mesh builder (typed arrays, reused per chunk via `reset()`); per-vertex `aFacade` (u, v in metres, face width, surface `KIND`; +16 marks the street front), `aStyle`, `aFlags`, `aBuilding`.

- `city.ts`: one patched `MeshStandardMaterial` for every surface kind, so a chunk is one draw call. Walls get a procedural window grid by style (punched / ribbon / curtain wall / balcony doors / small / blank), interior-mapped rooms (lit warm or fluorescent, blinds, curtains, furniture), Fresnel sky reflection, storefronts (shop interior or shutter) under a fascia (see shop trades below), weathering, and per-axis prefiltering (rows become bands at grazing angles). Street light comes from the lightmap; rain makes the ground glossy with stretched reflections.

- `buildings.ts` (styles and dressing: parapets, rooftop tanks, AC units and stair housings, balconies, fins, awnings, wall AC units), `props.ts` (lamps, utility poles and wires, vending machines, street trees, parked cars, traffic signals, and the cell's lights), `cars.ts` (parked cars: the `models/vehicles.ts` models at street detail, `detail` 0.25 with simple wheels and their lamps off (`lamps: false`), lofted once per model and detail in each worker in a placeholder paint and stamped into place repainted: `MeshBuilder.append`, `recolor`), `ground.ts` (asphalt, kerbed pavements with their corners filled and the kerb rounded at every crossing and either side of a pavement-less lane's mouth (`pavementCorners`, `kerbRadius`), road paint and zebra crossings standing off each road's junction boxes (`junctionSpans` in plan.ts: a cell-edge road is in two cells' plans, each with its own cross streets, so `DistrictModel.plan` gives both the same boxes, `agreeJunctions`, the wider at each corner: one crossing, one stop line, one nose to the median; the people waiting to cross and the traffic's stop lines use them too); `District.pavingAt` gives the paving's height under a point, which Mack's body stands on while the eye is set from the ground), `lightmap.ts` (one district texture at 1 px/m; each chunk paints its cell, neighbours' lights included, and uploads just that region).

- `signs.ts` + `letters.ts`: signs are geometry. Blades and fascia plates use a pre-rendered text atlas (neon on a dark plate, or a lightbox). Channel letters (some Latin fascias, rooftop billboards) are extruded from glyph rasters merged into rectangles.

- `overlay.ts`: the ASCII pass, run before bloom: a faint glyph grain up close, cells dissolving into glyphs with distance (the dissolve follows the fog, so fog and rain bring it closer; this also hides the far LOD), a sparse sky, and rain streaks. Presets are `off` (default), `vibe`, `heavy` and `ascii` (everything). `sky.ts` is the gradient dome.

- The pipeline is an HDR MSAA target with depth, then screen-space reflections (`real/ssr.ts`: wet ground and roofs, and open water whatever the weather; only faces that really face up, so a deck's underside reflects nothing; half-res ray march through the depth buffer, rippled in puddles, added in place so the scene target keeps its depth), then the overlay, then `UnrealBloomPass`, then `OutputPass` (ACES), then the colour grade (`real/grade.ts`, on the display image): presets `neutral` (default), `nocturne`, `noir`, `citypop` (the debug menu's Grade, `?grade=`) for saturation that spares bright neon, split toning, a coloured black lift, contrast, vignette, grain, lens fringing, halation, and drops on the lens in rain. Sun shadows are on only in clear weather with the sun high enough.

**One material for what you walk and drive on** (the user, 2026-10-12, after a bridge missed the siren's light and its road was darker than the city's): a surface the player stands, walks or drives on is built with the `MeshBuilder` on the city material (`KIND.asphalt`, `sidewalk`, `paint`, `grass`, `emit` for lamps), never as a separate `MeshStandardMaterial` mesh, or it misses everything the city shader does: the lightmap, traffic and own-car headlights, the beacon, wet roads and reflections, snow, leaves, the seasons, the time of day. The street bridges' decks (`real/sea.ts` `bridgeDeck`, which `buildSea` takes the city material for) were the one place that wasn't. A new city-wide light goes into the city shader's uniforms, not a patch on some other material.

**Screen light** (`real/screenLight.ts`): big screens (the mega-sign's four screens and corner sign, Stella Production's and Hakkodo's) are rectangular area lights whose colour follows the image showing (a chroma-weighted, saturated average of each ad, measured when it loads, crossfading with the screen). The 8 nearest go to the city shader (`screenLight()`), and rain in front of them catches their colour. `ScreenLights.gain` sets the strength. `ScreenGlows` adds a soft halo round each screen in its current colour (dimmer by day, thicker in rain and fog), so screens glow without the whole ad needing to cross the bloom threshold.

**Yūnagi Riverside Park** (`real/park.ts`): the land between the river and the Yūnagi headland, built from the city's lawns, paths, water, lamps and tree species; see roads-traffic.md (The park below the Wangan).

**Payphones** (公衆電話; the user, 2026-10-11, after the era-phone talk: "add these to the game"; candidates in `models-buildings.html`, street furniture row, **not placed in the city yet**, awaiting approval): two forms. **Built in code**, `payphone` in `real/props.ts` (`Prop.kind 'payphone'`, `variant` 0 the green card-and-coin phone on a post under a hood, 1 a booth, 2 the older red coin phone with a dial): street furniture in the chunk's one merged mesh, for placing by the hundred (stations, konbini, bars). **Modelled in Blender** for the phone you walk up to, `scripts/blender/payphone.py` (`-- <out.glb> [--mount hood|booth] [--preview <dir>]`, run on the pod with `/workspace/blender/blender -b --python ...`; ~4.7k and ~5k polygons, plain PBR materials, the display, lit strip and sign emissive) into `assets/props/payphone/payphone.glb` and `payphone_booth.glb`: every part you touch is its own node with its origin at its pivot (`handset`, `hook_switch`, `key_0`..`key_9`, `key_star`, `key_hash`, `display`, `coin_return`, and for the booth `door` and `glass`; empties `use_point`, `cord_anchor_body`, `cord_anchor_handset`). **The stand phone and the low versions** (2026-10-12, step 3 of the plan, awaiting approval in the showroom): `--mount stand` is the older coin phone on a post and shelf for a shop front in a lane, red (`payphone_red.glb`) or with `--color pink` the one a bar keeps by its door (`payphone_pink.glb`): a rotary `dial` node in place of the keys and display (its finger wheel turns about its centre: `PayphoneRig.setDial`), the handset lying across the top (~3.4k polygons). `--low` builds any of them for the middle distance (`<kind>_low.glb`: no bevels, numerals, screws or cord, round parts in eight sides, all one object `payphone_low`; 238, 350 and 142 polygons), loaded with `loadPayphone(kind, env, true)` and stood in a row in front of the full ones in the showroom. All eight files are rebuilt by running the script once per mount (the command line is in its header). `models/payphone.ts` loads them (`loadPayphone`) and `PayphoneRig` drives the parts (`setHandset`, `setKey`, `setFlap`, `setDoor`, `setDisplay`, 0 to 1); the showroom loops a demo of them. **Not built yet: using one** (walking up, the dialling, the call, the card, what a call does in the story) and the cord following a lifted handset (the model's cord is the rest pose only; draw one between the two anchors). Nothing in either is anybody else's work. **Where they go, and how every one is made usable, is planned in `docs/street-furniture-plan.md`** (proposed 2026-10-11 with the re-siting of the bus stops; awaiting the user's decisions: nothing of it is built, and under it the code-built ones here are dropped for instanced Blender models).

