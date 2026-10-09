---
paths:
  - "src/poc3d/district/plan.ts"
  - "src/poc3d/district/zones.ts"
  - "src/poc3d/district/world.ts"
  - "src/poc3d/district/model.ts"
  - "src/poc3d/district/stamps.ts"
  - "src/poc3d/district/landmarks.ts"
  - "src/poc3d/district/chunkBuild.ts"
  - "src/poc3d/district/chunkWorker.ts"
  - "src/poc3d/district/content.ts"
  - "src/poc3d/district/atmosphere.ts"
  - "src/poc3d/real/occlusion.ts"
  - "src/poc3d/real/openLots.ts"
  - "src/poc3d/real/dressing.ts"
  - "src/poc3d/real/rawGeometry.ts"
  - "src/poc3d/real/localFrame.ts"
  - "src/poc3d/real/tiles.ts"
  - "src/poc3d/models/trees.ts"
  - "content/world3d/zones/**"
  - "content/world3d/l0.txt"
  - "content/world3d/atmosphere.yaml"
  - "scripts/benchDistrict.mjs"
---

# The city: plan, zones, streaming

Covers the 3D city's world model (cells, roads, blocks, lots), zones, open ground and trees, chunk streaming and level of detail, occlusion, stamps and landmarks as a mechanism, the atmosphere table. One of the area docs indexed in the root CLAUDE.md; one topic a paragraph.

## The plan and its zones

`district.html` + `src/poc3d/district/`: **Kaburo (Neon Core) at full scale**, the first real district in the 3D pipeline. `plan.ts` is the 2D world model in metres (L0 cells of 128 m, hashed cell-edge roads, BSP blocks, lots, signs; corner lots front the side street; only districts with a `STYLES3` entry are generated). The 3D city has its own L0 map, `content/world3d/l0.txt`, with districts at real-world size: Kaburo (`N`, 6×5 cells, about Kabukichō; its south row, Station Edge, runs down to the expressway's avenue) and Asagiri (`T`, 6×5 cells west of it, a West Shinjuku-style business district); `DISTRICTS3` is every district with a `STYLES3` entry, and the page generates them all.

**Zones** (`zones.ts`, one file per district in `content/world3d/zones/`) paint areas with their own character onto a district's cells: planner overrides (street and alley density, lot widths, heights, signs), the buildings' look (window types, wall colours, storefront interiors, open rate) and an ad mix by category (`cat` on each `DISTRICT_ADS` entry). Kaburo has seven: crossing, host street, Love District, back alleys, food lane, station edge, Kaburo Park. Asagiri has five: skyscraper row, tower plaza, west exit, Omoide Lane, Central Park.

## Open ground, greenery and trees

**Open ground and greenery** (zone plan keys, format in `zones.ts`): `open` leaves a share of lots open as coin parking, pocket playgrounds or vacant lots (never two side by side); `rear`/`setback` leave back yards and front setbacks, so buildings no longer fill their whole lot; `stepBack` steps mid-rise tops back from the street (from 15 m, above the blade signs; `tiers()` in `real/buildings.ts` gives each tier an offset); corner lots often get a cut corner (`Building3.cut`, sumikiri; `frontSpan()` is the part of the face clear of it, used by signs, ads, shops and dressing); `towerCover` stands towers in a paved public plaza on big blocks instead of rows of lots (Asagiri); `park` turns a share of a cell into a park (lawn, paths, hub, pond, playground, toilet block); `streetTrees`, `hedges` and `pots` plant the pavements and shopfronts. Plans carry these as `CellPlan3.open` (`OpenLot3`); `real/openLots.ts` lays each out (ground pieces, props, solids for collision, lights, crowd areas) and `real/dressing.ts` draws the new props. The ground has `grass`, `gravel` and `water` kinds. Trees are species (`models/trees.ts`: zelkova, ginkgo, sakura, black pine, camphor, dogwood, azalea, box; `Prop.species`): one species per street (ginkgo and zelkova avenues, ginkgo and dogwood on narrow pavements), sized to the pavement with the crown leaning out over the road (never further than 1.45 m: a species too big for its pavement even at half size, a cherry on a 1.6 m pavement, isn't planted) and lifted for buses; plazas and parks mix them (pines by ponds, azaleas round the hub, box at the gates). Crown masses are smooth-shaded (`MeshBuilder.latheSmooth`: ellipsoid normals) and the city shader gives them their leaves (3D noise clusters, darker underneath, a leaf bump on the lighting normal, a ragged edge up close, colour in patches, blossom florets, the sun glowing through). Crowns are airy (`FOLIAGE_VARIANTS` in `models/trees.ts`, the default `VARIANT` 3; the others stay for the showroom's comparison rows, kept in each vertex's style.z): each of a species' crown masses is filled with leaf cards on visible twigs (`MeshBuilder.card`: two-sided, lit as the crown's round surface; the city shader cuts individual leaves out of each card before any other shading, fades cards seen edge-on, and drops them all when the tree is bare in winter), and the city material's shadow caster (`cityDepthMaterial`, a chunk's and a landmark's `customDepthMaterial`) casts only the leaves, dappled. Trees sway in the wind: `addTree` (and `shrubMass`) tag each vertex with its height above the foot (`MeshBuilder.sway`, style.w negative), and the city material and its shadow caster bend them in the vertex stage (`swayVertex` in `real/city.ts`, `uWind` from main.ts: a lean downwind, gusts running through downwind, rocking, leaf flutter), barely in a breeze, thrashing in a typhoon. About 20-40% more triangles than the old puffs; 60 fps in the park and at the crossing on a GTX 1070 Ti. Shrubs and hedges are the same foliage (`shrubMass`: box, azalea (flowers in spring) or camphor tags; hedges a clipped body rounded over by clumps). Keep crowns to a handful of 15-quad masses: trees and parked cars are the biggest share of near-chunk triangles.

## Streaming, level of detail and occlusion

The warm start compiles shaders for the composer's HDR target, uploads every texture and draws once without culling, so nothing compiles or uploads mid-walk. `world.ts` streams each cell in stages, nearest first: ground, building masses and a lightmap tile first, then full detail within 340 m (shown within 300 m, dropped beyond 460 m), then crowds. The near stage builds the props with a middle-distance version (parked cars, trees, hedges, bikes: `PropPart` `swap` in `real/props.ts`, the bulk of a chunk's triangles) apart, twice: full within `MID_DISTANCE` (140 m, `District.midDistance`), and beyond it trees and hedges as the lighter 'cards' crowns (not 'puffs': they read as balloons), bikes dropped and cars as `addVehicleLow` (models/vehicles.ts: a body box, the glasshouse as a prism, wheel blocks, ~60 triangles against ~2,000; shown in the showroom's Cars row). Traffic cars beyond `CAR_LOD` (80 m, `TrafficSystem.carLod`) swap to the same low model, without lettering, brake lights or separate wheels.

**Occlusion culling** (`real/occlusion.ts`, `?occlusion=0` off): a composer pass after the overlay reduces the scene's depth to quarter size (the farthest depth of each 4x4 block, read with texture2D: texelFetch on the depth texture reads 0 under ANGLE), and each frame every full-detail chunk's box (`District.occlusionBoxes`) is drawn against it in a GPU occlusion query; a chunk hidden in two results running drops to its building masses (`District.occluded`), any visible sample brings it back, never the chunk you're in. At street level it hides a quarter to a third of the detailed chunks (~1 ms of GPU in Asagiri and Denkō-chō, ~1.4 ms from the observatory).

**Detail** (the debug menu, `?quality=high|medium|low`, `QUALITY` in `district/moodPanel.ts`) sets how far full detail, the full props, traffic and people reach; lamp shadows, resolution and the effects keep their own settings. High is the full city. Geometry is built off the main thread by a pool of Web Workers (`chunkWorker.ts` running `chunkBuild.ts`; each worker loads the content itself and returns transferable arrays, see `real/rawGeometry.ts`). The main thread only makes meshes, limited per frame by time and by upload bytes (GPU upload was the real hitch), and precompiles shaders during the warm start. `model.ts` holds plans and props for collision (and for the workers). New placements go at the end of `placements.yaml` (a stamp's building id is its index there, and its look and ads hash from it). The crowd keeps out of small closed set pieces (footprints up to 400 m², not the yokocho or the shrine: `cellCrowd`'s `stamps`) and of every set piece's own street-level collision (`fixtures`: a store's racks on the pavement, a station's piers, a precinct's walls; `DistrictModel.crowdSolids`, `streetColliders`). Use `?bench=1&diag=1` to log slow frames with an update/render breakdown.

## Basements, landmark layouts, plazas

Basements: the controls take a floor-height function (`District.floorAt`: stairs ramp, basement floor) and collision gets the walker's floor, so below street level only basement walls collide; the ground cuts `holes` for stairwells. Landmarks lay themselves out in the building's local frame (`real/localFrame.ts`: u along the street face, t inward), and the same layout gives their collision (walls and fixtures instead of a solid footprint) and lightmap lights (`district/landmarks.ts`). A stamp can also reserve a paved `plaza` that may reach across a junction into neighbouring cells (lamps, trees and a crowd are added to it), mark a `scramble` junction (its four roads become 18 m boulevards and it gets diagonal zebras), have a `name` (shown in the HUD inside it), give a spawn a camera `view: [yaw, pitch]`, and give an npc a `figure`.

## Where it starts, the atmosphere table, the benchmark

The district starts at `kaburo_crossing.view`, across the crossing from the mega-sign. `atmosphere.ts` is the (district, time, weather) table (`content/world3d/atmosphere.yaml`: sky/horizon, fog, lights, windows, neon, rain, lamps, exposure) on the shared matcher in `src/atmosphere/rules.ts`. Doors hand off through the same `VnBridge` as 2D. `node scripts/benchDistrict.mjs` measures warm start, chunk builds and streaming frame times.
