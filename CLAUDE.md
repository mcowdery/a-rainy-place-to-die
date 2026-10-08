# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based engine for a large, sparse, walkable ASCII city: an alternate-reality Japan with a noir / city-pop look. The world handles traversal and atmosphere; story content runs in a separate VN mode, which will come from the Krea Studio VN generator (FastAPI + vanilla JS, a separate codebase). The world hands off to VN mode at story nodes. The handoff convention is the generator's **VN export format, schema 2** (its `docs/vn-export-format.md`, in the Trame repo next to this one): the game side is `src/vn/` (see the VN seam below). Don't change the format from this side; extend it in the generator.

## What's in the repository

- `index.html` + `src/` (everything outside `src/poc3d/`): the 2D top-down/3-4 tile prototype. **Set aside, don't extend.** The visual target turned out to be first-person 3D, but its world-data design (L0–L4 layers, stable ids, stamp validation, atmosphere lookup) is expected to carry over.
- `poc3d.html` + `src/poc3d/`: a first-person three.js proof of concept targeting the look of GrowNow's ASCII city. The scene renders into a low-resolution target (2×2 texels per character cell). The building material (`block.ts`) writes an integer surface code into alpha: per-building style, pane / mullion / slab grid, storefront band with sign letters, and a smooth intensity from light, street glow and distance. The ASCII pass (`asciiPass.ts`) maps each code to a glyph ramp in the building's hue, reads all 2×2 texels per cell to draw quadrant glyphs where a cell straddles a window edge, draws box-drawing edges from depth, and dithers between ramp steps (Bayer, G toggles). `glyphAtlas.ts` builds the ramps by measuring each candidate glyph's ink coverage: Latin + halfwidth katakana single-cell steps, then kanji (two cells, drawn across screen-aligned cell pairs) for the darkest tones. The facade material gets the target's pixels per cell (`uPxPerCell`) and uses a flat building id with sin-free hashes (interpolated ids caused per-pixel noise). Looking up is a vertical image shift, not pitch, so verticals stay vertical (P toggles to true pitch). Three switchable render modes: plain WebGL, the custom pass, and three's `AsciiEffect` for comparison. `node scripts/bench3d.mjs [--headed]` benchmarks them at several scene sizes in the installed Edge. PoC only: don't build the world on it until the approach is decided.
- `district.html` + `src/poc3d/district/`, `src/poc3d/real/`, `src/poc3d/models/`: **the city**, which is the game: a first-person 3D city at real-world scale (Kaburo, Asagiri and a dozen more districts, generated from the L0 map, zones and hand-placed stamps), drawn realistically with ASCII only as an optional overlay. You walk it, drive it, ride its trains and buses, and its story nodes hand off to VN mode. The branch `realistic-visuals` began this; the `ascii-v1` tag is the last ASCII-defined build.
- `race.html` + `garage.html` + `src/race/`: **racing** on its own venue maps (mountain passes, a wharf, a street circuit), your owned cars and the garage. The racing car model also drives your car in the city.
- `models.html`, `mob.html`, `characters.html`, `scenes.html` (`src/poc3d/showroom/`): the showrooms where car, cast, prop, mob and named-character designs are reviewed, and the editor for the rooms behind the windows.
- `anims.html`, `animbatch.html` (`src/poc3d/anims/`): the animation review pages, the cast playing clips from the animation library fitted to their own skeletons, one at a time or the whole library a page at a time with ticks to pick from ([cast.md](.claude/rules/cast.md)). Dev only.
- `fight.html` (`src/poc3d/fight/`): the fight test, a walled yard for trying the melee (fists, katana, bat, kill moves, duels) as Mack in first person. Fighting isn't in the city yet, nor in the showroom any more.
- `humans.html` (`src/poc3d/humans/`): the MakeHuman test: every figure made with MakeHuman but Mack (the salaryman, the maid, Julie, a generated crowd of 76) on a street and in line-ups, textured as built or in the mob's looks, to try them as passers-by and as the people you fight. A test only; on the dev server only.

## Area docs

Everything else about the city, racing, the cast, art, sound and story is written up by area in `.claude/rules/`, one file an area. Each loads into context by itself when you read or edit a file it covers (its `paths:`). **If your task touches an area whose doc isn't in context yet, read it before you start**: glue files such as `district/main.ts` load none of them.

- [district.md](.claude/rules/district.md): the 3D city's world model (cells, roads, blocks, lots), zones, open ground and trees, chunk streaming and level of detail, occlusion, stamps and landmarks as a mechanism, the atmosphere table.
- [places.md](.claude/rules/places.md): every district and its landmarks (Kaburo, Asagiri, Kasumi-chō, the port and islands, Denkō-chō, the north, Kawabata, the outer districts, the airport), terrain, the city's edges, the sea and waterfronts.
- [interiors.md](.claude/rules/interiors.md): walk-in interiors (the bath, the department store, the penthouse, Hotel Rouge) and the cast's homes.
- [transit.md](.claude/rules/transit.md): vehicles you walk about in, the elevated lines, the subway and its stations, the terminal, rides.
- [roads-traffic.md](.claude/rules/roads-traffic.md): traffic and signals, avenues and streets, the Tōto Expressway, taxis, headlights.
- [gps.md](.claude/rules/gps.md): the M map, routing, the phone's Maps app, the markers in the world, the car that drives itself.
- [own-car.md](.claude/rules/own-car.md): your car and garage, driving, crashing and damage, races in the city, the cabin and driving cameras, mirrors, lights, Mack at the wheel.
- [car-guns.md](.claude/rules/car-guns.md): shooting from your car, the draw and reload, recorded gunshots, the muzzle flash, bullets marking cars, car chases.
- [racing.md](.claude/rules/racing.md): the car model and its stunts, venues, time trials, drift attack, circuits, shooting and battles on the race page, owned cars, the garage, tuning.
- [rendering.md](.claude/rules/rendering.md): the mesh builder, the one city material, buildings, props, ground, the lightmap, signs, the ASCII overlay, the post-processing pipeline, screen light.
- [vehicles.md](.claude/rules/vehicles.md): the car and bike models, lettering and taxi ads, the car mix by district.
- [shops-windows.md](.claude/rules/shops-windows.md): shop trades and their interiors, the scenes behind upper-floor windows, shady shops, the scene editor.
- [mob-bodies.md](.claude/rules/mob-bodies.md): the passers-by as figures: the sculpted bodies, outfits and footwear, the palette, the mob showroom, modelled figures.
- [mob-life.md](.claude/rules/mob-life.md): posing on the GPU, walking and routines, emotes, who is out when, crowd shadows, passengers, followers.
- [smoking.md](.claude/rules/smoking.md): who smokes in the crowd, the smoke, Mack's cigarette and lighter, his idle squat.
- [time-weather.md](.claude/rules/time-weather.md): the story clock and the light through the day, the physical sky, seasons, the forecast, weather on the road, snow, wipers, rain and wet streets.
- [debug-performance.md](.claude/rules/debug-performance.md): the one debug menu and every setting in it, the URL parameters, performance findings and the rules that keep the frame rate.
- [audio.md](.claude/rules/audio.md): the city's procedural sound, footsteps, cabins and cover, the car radio, the phone's music app, generated music.
- [cast.md](.claude/rules/cast.md): how story characters are defined, built in Blender and loaded; Mack's model.
- [mack.md](.claude/rules/mack.md): the first-person rig, his guns, his walk, run and jump, his body in the city, the third-person camera, his hidden face, his wardrobe.
- [bikes.md](.claude/rules/bikes.md): the three motorcycles, the helmet, riding in the showroom, on the race page and in the city.
- [melee.md](.claude/rules/melee.md): the katana, the bat, the melee moves (whole-arm swings, the stances), ordinary fighters, kill moves, gore, duels with elites, the fight page.
- [humans.md](.claude/rules/humans.md): the MakeHuman test page, the textured crowd and how it's built, the looks, the street, fighting them.
- [generated-art.md](.claude/rules/generated-art.md): generating ad and signage art, the review flow, cropping and placing district ads.
- [story.md](.claude/rules/story.md): playing VN exports, the node mapping, the phone and its messenger, wallpapers, saves, writing a scene, the story guide.
- [editions.md](.claude/rules/editions.md): the three builds, what each may contain, overlays from adult/, the demo's hidden art.
- [licences.md](.claude/rules/licences.md): which licences an outside asset may have, what each asks, the credits list (`CREDITS.md`), what's in it so far.

Keeping them:

- A change is documented in its area's file, not here. This file stays short: what the project is, what holds everywhere, the commands.
- One topic a paragraph. Add to the paragraph your change belongs to, or start a new paragraph with a **bold lead**; don't grow one paragraph to cover several things. (Git merges by line, and a paragraph is a line: two agents writing in different paragraphs merge cleanly.)
- A new source file that belongs to an area goes in that doc's `paths:`. A new area gets a new file and a line in the list above.

## What holds everywhere

Rules from the area docs that apply whatever you're working on:

- **Designs are approved before they're used.** New models (cars, bikes, cast, props, mob bodies and outfits) are reviewed in a showroom before they go into the district ([vehicles.md](.claude/rules/vehicles.md), [mob-bodies.md](.claude/rules/mob-bodies.md), [cast.md](.claude/rules/cast.md)).
- **Generated art and music: propose, then review.** Generate only when the user asks for a batch, and never wire a generated image or track into the world without the user's approval. Claude can't hear: anything put on air unheard must be said to be so ([generated-art.md](.claude/rules/generated-art.md), [audio.md](.claude/rules/audio.md)).
- **No real brands**, artists, bands or songs: makers, companies, stations and apps are invented.
- **Other people's work: licence read, credit recorded, before it's used.** Commercial use, changes and adult use must all be allowed; CC BY is fine with its credit in `CREDITS.md`, NC, ND, share-alike and GPL content aren't without asking ([licences.md](.claude/rules/licences.md)).
- **Mack is faceless.** Never frame a camera on his face ([mack.md](.claude/rules/mack.md)).
- **Three editions** (standard, uncensored, demo). Explicit material lives only in `adult/` (its own repository, never committed to this one), Claude doesn't write the explicit scenes, the demo must never import `art.ts` or `story.ts`, and art that shows nudity or is strongly suggestive goes in `DEMO_HIDDEN_ART`. `npm run build:all` before sharing any build ([editions.md](.claude/rules/editions.md)).
- **The story guide (`story/`) is canon.** Read the relevant files before writing a scene or chat, and never settle an **Open:** question without asking ([story.md](.claude/rules/story.md)).
- **The frame rate is the geometry's.** One merged or instanced mesh, not many small ones; never a city-wide mesh left unculled; a light added, removed or hidden recompiles every city shader, so lights are only ever switched off; per-item art goes in an atlas, not in GLSL ([debug-performance.md](.claude/rules/debug-performance.md), [rendering.md](.claude/rules/rendering.md)).

## Working alongside other agents

Several Claude sessions often work in this repository at once, while the user plays the game on the dev server at `localhost:5173`. So that nobody trips anybody else up:

- **Never stop, restart or kill what you didn't start**: not the dev server on 5173, not any node, Edge, Python or Blender process (never `taskkill /IM node.exe`, never by a port you didn't open). Stop a process of your own by its PID. If someone else's looks stuck, tell the user.
- **Checks run on a server of their own, never on 5173.** Every shot script and benchmark starts one with `shotServer(config)` (`scripts/shotServer.mjs`: Vite's `createServer` rooted at the script's own checkout, on a free port, with nothing watched and no hot reload, so another agent saving a file can't reload or restart a run part way through). New scripts use it too, never `createServer`. To look at a page by hand, start your own `npm run dev`: it takes the next free port (localStorage, so settings and saves, is per port). No dev server hot-reloads (`server.hmr: false` in `vite.config.ts`, so an agent's save never reloads the game the user is playing): refresh the page to see a change. **A file added to, moved out of or removed from a folder a module lists with `import.meta.glob` isn't seen by a server already running** (it listed the folder when it first read the module): re-save the module that has the glob, or the user's refresh gets the old list (a file that's gone comes back as HTML; `debug-shots/citymoves.mjs <dir> http://localhost:5173/` checks a running server from a fresh browser, read-only).
- **Saving `vite.config.ts` or `scripts/debugShots.mjs` restarts every dev server that's watching**, the user's included, mid-play. Change them only when the task needs it, all in one save, and say so in your report. The dev server's endpoints (`/__shot`, `/__scene`) aren't in either: they're in `scripts/devEndpoints.mjs`, loaded at each request, so adding or changing one there restarts nothing.
- **One GPU for everything.** Shot scripts queue for it by themselves (`gpuQueue` in `scripts/shotServer.mjs`): ordinary runs go together, a run that measures frame times or fills the GPU is `exclusive` (the benchmarks, the `*perf` scripts and the music generator already are; for one run of anything else, `CITYPOP_GPU=exclusive node debug-shots/<script>.mjs ...`): it waits for the others and holds new ones back. Timings taken any other way, with other runs going, aren't to be trusted. A script saying `GPU: waiting for ...` is working as meant.
- **Give a shot script an output folder of your own** (`debug-shots/<your task>/`), not its default, which another agent's run may be writing. The scripts themselves (`debug-shots/*.mjs`) are in git; the pictures and folders beside them aren't.
- **Shared files** (this file and the area docs, `district/main.ts`, `district/moodPanel.ts`, `real/people.ts`, the showrooms' `main.ts`): small exact edits, never a whole-file rewrite from an old read. If typecheck or a test fails in a file you haven't touched, another agent is probably part way through an edit there: don't fix it for them; try again in a minute, and tell the user if it stays broken.
- **A checkout of your own** for work that will take a while or break things on the way: `node scripts/worktree.mjs add <name>` makes `.claude/worktrees/<name>` on branch `worktree-<name>` from the commit you're on, installed and ready (`list`, `remove <name>`; what does and doesn't come along is in the script's header). It starts from the last commit, so uncommitted work in the main checkout isn't in it. The work comes back as commits on its branch (`git merge worktree-<name>` from the main checkout, when the user asks).

## Commands

Node is installed at `C:\Program Files\nodejs`. If `node`/`npm` aren't on PATH in a shell, prefix with `$env:Path = "$env:ProgramFiles\nodejs;$env:Path"` (PowerShell) or `PATH="/c/Program Files/nodejs:$PATH"` (bash).

- `npm run dev` starts the Vite dev server. For the 2D prototype use `/` (review shortcuts: `?spawn=bar_kanpai.out&time=dusk&weather=rain`); for the district use `/district.html` (`?spawn=<node id>` starts at any node: a spawn, or in front of a door, hotspot, npc or station, facing it; `?time=day|dusk|dawn|night&weather=rain|fog&cam=…&ascii=vibe|heavy|ascii|off&fly=1`; Space jumps, F flies (Space up, Ctrl down), I inverts mouse Y (walking and driving; remembered in localStorage, `?invertY=1|0`), M map (wheel zoom, drag pan), ` the debug menu (`district/debugMenu.ts`, tabs: the settings in every build, and on the dev server or with `?debug=1` the season, the time (jumps, ±1 h, stop the clock), the weather and snow cover, your car (drive it here, repair), races, fly, the moon (size and glow sliders (`DebugSection.sliders`; `Sky.moonSize`/`moonGlow`, `?moonSize=&moonGlow=`), look at it, copy settings), a search box that teleports to any place or node, a story flag toggle; the ASCII overlay, bloom and its strength and threshold are in its Graphics tab), `?bloom=0.3`); for reviewing car, cast and prop models in isolation use `/models.html` (the mob's passers-by are in `/mob.html`) (orbit + WASD/QE fly, focus buttons, studio/night/day lighting, labels (L or the panel, a setting of its own orbiting and in first person, where they start hidden; remembered), wireframe); for the melee use `/fight.html` (`?hand=fists|katana|bat|gun&duel=1&light=night`; 1 guns, 2 fists, 3 katana, 4 bat, a click strikes where you aim (bare-handed a button a hand, both block), R / C the stance up and down, H one hand or two, L keyed or library moves, E dodges, Space jumps, T a fresh group, B a duel, V orbits); for the MakeHuman figures use `/humans.html` (`?look=original|mob|black&crowd=40&enemies=men&fp=1`; K the look, V walk the street as Mack); for the racing venues use `/race.html` and the garage `/garage.html` (the venue menu; `?venue=yunagi&mode=up`, `?at=lot|top|road&cam=bumper`); for the 3D test block use `/poc3d.html` (`?scene=downtown` gives a tall-tower canyon, `?cam=x,y,z,yaw,pitch` sets the view, `?grid=2000&merge=1` adds buildings, `?bench=1` runs the scripted benchmark).
- **F9** on the district, race and garage pages (`src/debug/snap.ts`) saves a snapshot for reporting an issue: the canvas after the next frame, an optional note (Enter saves, Esc skips), and a JSON (URL, HUD text, position, car state and damage) into `debug-shots/` (git-ignored) through the dev server's `/__shot` endpoint (`scripts/devEndpoints.mjs`); without the dev server the PNG downloads. When the user says they took shots, read the newest files there.
- **A recording, for a fault in how something moves** (`node scripts/clipFrames.mjs [clip] [--from s --to s --fps n --crop w:h:x:y --out dir]`): Claude reads stills, not video, so this turns a clip into sheets of frames in order, each stamped with its time, in `debug-shots/clips/<clip>/`. With no clip it takes the newest video under the user's Videos folder (a screen recording: Win+Shift+R, or Win+Alt+R in the Game Bar). When the user says they recorded something, run it and read the sheets; go back with `--from/--to` and a higher `--fps` for the move in question. ffmpeg is the `ffmpeg-static` dev dependency (`import ffmpeg from 'ffmpeg-static'` gives its path), not on PATH.
- `npm run dev:uncensored` / `npm run build:uncensored` (into `dist-uncensored/`) are the uncensored edition, `npm run dev:demo` / `npm run build:demo` (into `dist-demo/`) the gameplay demo (see Editions); `npm run dev` / `npm run build` are the standard edition. `npm run build:all` (`scripts/buildAll.mjs`) typechecks, builds all three and checks each holds only its own files (the demo: no hidden art, VN stills or story text; standard and demo: nothing from `adult/`; the age check only in uncensored); run it before sharing any build.
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

**VN seam:** `VnBridge.enter(node)` in [src/game/bridge.ts](src/game/bridge.ts). The world awaits it and never reads `node.handoff`. Flags go through `FlagStore` ([src/core/flags.ts](src/core/flags.ts)); VN flags (`[a-z0-9_]`, booleans) live in it beside the world's own, so node `condition`s can test them.

## Invariants (don't break these)

- **One coordinate convention:** integer tiles, origin at the northwest corner, +x east, +y south, always `[x, y]`. Local coordinates (stamp, lot, cell) use the same axes from that thing's northwest corner.
- **Stable IDs:** node ids are `<placement id>.<node id>` (e.g. `neon_station.gate`), must match `[a-z0-9_]+`, and are never reused. Placements anchor to an L0 cell plus an offset, never raw world coordinates, so retuning `cellW`/`cellH` keeps stamps in their district. A stamp must stay `CELL_MARGIN` tiles inside one cell.
- **Wide (CJK) cells:** a wide char is `[codepoint, GLYPH_CONT]` across two cells in every layer (stamps, generated signs, chunks, renderer). In stamp art, CJK is only allowed inside `[ ]` sign brackets, and every row must have the same width in *cells*. Both rules are load errors, not visual bugs.
- **Determinism:** generation is a pure function of `CONFIG.seed`, `CONFIG.generatorVersion`, L0 and the placements. All randomness goes through [src/core/hash.ts](src/core/hash.ts) (no `Math.random` in gen). Authored content must never depend on generated layout. [tests/world.test.ts](tests/world.test.ts) fingerprints sample chunks; if a generator change is intended, update the snapshot (and bump `generatorVersion` once saves exist).
- **Content validation:** [src/content/load.ts](src/content/load.ts) collects *all* content errors (file/row/col) and the app shows them on screen. When adding content rules, add a check there or in the parser, not a runtime fallback.

## Stamp format

See the header comment in [src/content/stamps.ts](src/content/stamps.ts). In short: a `legend` maps characters to tiles; `'X': { tile, node: id }` marks a node, which must appear exactly once; text inside `[ ]` is literal sign text; `door`/`station` nodes need a `returnSpawn`.
