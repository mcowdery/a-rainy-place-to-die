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

**Screen light** (`real/screenLight.ts`): big screens (the mega-sign's four screens and corner sign, Stella Production's and Hakkodo's) are rectangular area lights whose colour follows the image showing (a chroma-weighted, saturated average of each ad, measured when it loads, crossfading with the screen). The 8 nearest go to the city shader (`screenLight()`), and rain in front of them catches their colour. `ScreenLights.gain` sets the strength. `ScreenGlows` adds a soft halo round each screen in its current colour (dimmer by day, thicker in rain and fog), so screens glow without the whole ad needing to cross the bloom threshold.

**Yūnagi Riverside Park** (`real/park.ts`): the land between the river and the Yūnagi headland, built from the city's lawns, paths, water, lamps and tree species; see roads-traffic.md (The park below the Wangan).
