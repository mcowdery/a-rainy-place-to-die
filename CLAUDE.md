# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based engine for a large, sparse, walkable ASCII city: an alternate-reality Japan with a noir / city-pop look. The world handles traversal and atmosphere; story content runs in a separate VN mode, which will come from the Krea Studio VN generator (FastAPI + vanilla JS, a separate codebase). The world hands off to VN mode at story nodes. The real handoff convention (exit/entry keys, shared flags) will be brought in later, so don't design it; leave the seams described below in place.

## Status: two prototypes

- `index.html` + `src/` (everything outside `src/poc3d/`): the 2D top-down/3-4 tile prototype. **Set aside, don't extend.** The visual target turned out to be first-person 3D, but its world-data design (L0–L4 layers, stable ids, stamp validation, atmosphere lookup) is expected to carry over.
- `poc3d.html` + `src/poc3d/`: a first-person three.js proof of concept targeting the look of GrowNow's ASCII city. The scene renders into a low-resolution target (2×2 texels per character cell). The building material (`block.ts`) writes an integer surface code into alpha: per-building style, pane / mullion / slab grid, storefront band with sign letters, and a smooth intensity from light, street glow and distance. The ASCII pass (`asciiPass.ts`) maps each code to a glyph ramp in the building's hue and draws edge glyphs from depth. Looking up is a vertical image shift, not pitch, so verticals stay vertical (P toggles to true pitch). Three switchable render modes: plain WebGL, the custom pass, and three's `AsciiEffect` for comparison. `node scripts/bench3d.mjs [--headed]` benchmarks them at several scene sizes in the installed Edge. PoC only: don't build the world on it until the approach is decided.
- `district.html` + `src/poc3d/district/`: **Kaburo (Neon Core) at full scale**, the first real district in the 3D pipeline. `plan.ts` is the 2D world model in metres (L0 cells of 128 m, hashed cell-edge roads, BSP blocks, lots, signs; only districts with a `STYLES3` entry are generated). `world.ts` streams one merged mesh per cell (simplified version beyond 300 m) nearest-first within a frame budget and answers collision from plans. `stamps.ts` holds the 3D stamps (`content/world3d/stamps/*.yaml`, placed by `content/world3d/placements.yaml`, ids `<placement>.<node>`). `signs.ts` writes signs into the ASCII pass's text layer (one cell per character, CJK two, depth-tested in the shader). `atmosphere.ts` is the (district, time, weather) table (`content/world3d/atmosphere.yaml`) on the shared matcher in `src/atmosphere/rules.ts`. Doors hand off through the same `VnBridge` as 2D. `node scripts/benchDistrict.mjs` measures warm start, chunk builds and streaming frame times.

## Commands

Node is installed at `C:\Program Files\nodejs`. If `node`/`npm` aren't on PATH in a shell, prefix with `$env:Path = "$env:ProgramFiles\nodejs;$env:Path"` (PowerShell) or `PATH="/c/Program Files/nodejs:$PATH"` (bash).

- `npm run dev` starts the Vite dev server. For the 2D prototype use `/` (review shortcuts: `?spawn=bar_kanpai.out&time=dusk&weather=rain`); for the district use `/district.html` (`?time=day|dusk|dawn|night&weather=rain|fog&cam=…`; F flies); for the 3D test block use `/poc3d.html` (`?scene=downtown` gives a tall-tower canyon, `?cam=x,y,z,yaw,pitch` sets the view, `?grid=2000&merge=1` adds buildings, `?bench=1` runs the scripted benchmark).
- `npm test` runs Vitest once. For a single file or test: `npx vitest run tests/stamps.test.ts -t "CJK"`.
- `npm run typecheck` runs `tsc` with no emit. `npm run build` runs the typecheck plus `vite build`.
- `npx vitest run -u` updates the generator snapshot. Only do this when a change to generated output is intended (see Determinism).

## Architecture: layered world generation

The world is never stored. Each 64×64 **chunk** is generated on first access and kept in an LRU cache ([src/world/world.ts](src/world/world.ts)). The layers, painted in [src/gen/raster.ts](src/gen/raster.ts):

- **L0 macro map.** [content/world/l0.txt](content/world/l0.txt) is hand-painted: one character per macro cell (`CONFIG.cellW × cellH` = 128×64 tiles, square on screen).
- **L1 streets.** Every land/land cell edge carries a road split between the two cells. Both cells derive its width from a hash of the shared edge, so buildings never cross cells. Cell interiors are split into blocks by local streets (a BSP split). See [src/gen/cellplan.ts](src/gen/cellplan.ts).
- **L2 lots.** Blocks → bands → lots → buildings, as vector data (a `CellPlan`) that's cheap to build. Per-district parameters are in [src/gen/styles.ts](src/gen/styles.ts).
- **L3 stamps.** Hand-authored set pieces in `content/stamps/**/*.yaml`, placed by [content/world/placements.yaml](content/world/placements.yaml). They override L1/L2. The generator treats stamp rects as reserved: lots that touch them become open plaza, and local streets route around them.
- **L4 nodes.** Story nodes (spawn / door / npc / station / hotspot) are declared inside stamps and resolved to world coordinates by [src/content/nodes.ts](src/content/nodes.ts). They aren't tiles; the `NodeIndex` buckets them by chunk.

**3/4 view:** a building lot, from north to south, is yard (behind) → roof rows → facade rows facing south. What you see is what collides. Tall buildings are tall because their facade has many rows.

**Atmosphere** ([src/atmosphere/atmosphere.ts](src/atmosphere/atmosphere.ts), [content/world/atmosphere.yaml](content/world/atmosphere.yaml)) is a pure lookup from (district, time, weather) to a palette plus effects. Rules layer by specificity, and tints skip `EMISSIVE` colors. Time and weather are story flags (`world.time`, `world.weather`), not clocks. Tiles reference palette *names* ([src/world/tiles.ts](src/world/tiles.ts)), so atmosphere never changes world data.

**VN seam:** `VnBridge.enter(node)` in [src/game/bridge.ts](src/game/bridge.ts). The world awaits it and never reads `node.handoff`. `PlaceholderVnBridge` is the stand-in. Flags go through `FlagStore` ([src/core/flags.ts](src/core/flags.ts)), which is also a placeholder for the shared-flag convention.

## Invariants (don't break these)

- **One coordinate convention:** integer tiles, origin at the northwest corner, +x east, +y south, always `[x, y]`. Local coordinates (stamp, lot, cell) use the same axes from that thing's northwest corner.
- **Stable IDs:** node ids are `<placement id>.<node id>` (e.g. `neon_station.gate`), must match `[a-z0-9_]+`, and are never reused. Placements anchor to an L0 cell plus an offset, never raw world coordinates, so retuning `cellW`/`cellH` keeps stamps in their district. A stamp must stay `CELL_MARGIN` tiles inside one cell.
- **Wide (CJK) cells:** a wide char is `[codepoint, GLYPH_CONT]` across two cells in every layer (stamps, generated signs, chunks, renderer). In stamp art, CJK is only allowed inside `[ ]` sign brackets, and every row must have the same width in *cells*. Both rules are load errors, not visual bugs.
- **Determinism:** generation is a pure function of `CONFIG.seed`, `CONFIG.generatorVersion`, L0 and the placements. All randomness goes through [src/core/hash.ts](src/core/hash.ts) (no `Math.random` in gen). Authored content must never depend on generated layout. [tests/world.test.ts](tests/world.test.ts) fingerprints sample chunks; if a generator change is intended, update the snapshot (and bump `generatorVersion` once saves exist).
- **Content validation:** [src/content/load.ts](src/content/load.ts) collects *all* content errors (file/row/col) and the app shows them on screen. When adding content rules, add a check there or in the parser, not a runtime fallback.

## Stamp format

See the header comment in [src/content/stamps.ts](src/content/stamps.ts). In short: a `legend` maps characters to tiles; `'X': { tile, node: id }` marks a node, which must appear exactly once; text inside `[ ]` is literal sign text; `door`/`station` nodes need a `returnSpawn`.
