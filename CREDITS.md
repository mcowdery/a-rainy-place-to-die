# Credits and licences

Everything in the game that someone else made, and what each licence asks of us. The rules for adding to it are in
`.claude/rules/licences.md`: an entry is written here before the file is committed. Each asset folder's own
`CREDITS.md` has the detail (which file came from which, what was done to it).

**Before release:** the start screen's Credits page (`src/poc3d/district/startScreen.ts`) shows section 1 and the
code notices of section 2: **add an entry there when you add one here.** Section 2's licence texts still have to ship in the build.

## 1. Credits the game must show

### Music: Kevin MacLeod, CC BY 4.0

28 tracks on two radio stations (`assets/radio/jazz/`, `assets/radio/bay/`; detail in `assets/radio/CREDITS.md`).
Licence: Creative Commons Attribution 4.0, https://creativecommons.org/licenses/by/4.0/. Fetched 2026-10-03 from
incompetech.com. Changed: re-encoded from MP3 to Opus, each brought to a common loudness with one plain gain.

What the licence asks: the author credited the way he asks, the licence named and linked, the source linked, and a
note that the tracks were changed. No wording that suggests he endorses the game. The credit to show, once per track:

> "<Title>" Kevin MacLeod (incompetech.com)
> Licensed under Creative Commons: By Attribution 4.0 License
> http://creativecommons.org/licenses/by/4.0/
> (re-encoded and level-adjusted for this game)

TŌTO JAZZ (`jazz/`): Backed Vibes Clean · Comfortable Mystery · Cool Vibes · Covert Affair · Dances and Dames ·
Deadly Roulette · George Street Shuffle · Hard Boiled · I Knew a Guy · Just As Soon · Lobby Time · Shades of Spring ·
Slow Burn · Walking Along

FM SHIOMI (`bay/`): Aces High · AcidJazz · Airport Lounge · Bossa Antigua · Disco con Tutti · Feelin Good ·
Funkorama · Groove Grove · Late Night Radio · Local Forecast - Elevator · Protofunk · Smooth Lovin · Stringed Disco ·
Ultralounge

### Engine sound: qubodup, CC BY 3.0

`assets/audio/engines/real.ogg`, from "Car Engine Loop 96kHz, 4s" by qubodup (https://opengameart.org/content/car-engine-loop-96khz-4s), fetched 2026-10-11; the page offers CC BY 3.0 (and GPL 2.0 / 3.0, not used). **CC BY 3.0 asks**: the author named, the title, the licence named and linked (https://creativecommons.org/licenses/by/3.0/), where it came from, and a note of changes. Changed: converted to mono Opus and played faster or slower with the revs. The credit to show (the game's credits screen, `startScreen.ts`):

> "Car Engine Loop 96kHz, 4s" by qubodup (opengameart.org/content/car-engine-loop-96khz-4s), CC BY 3.0, converted and played at the engine's revs

The same section, a second recording: `assets/audio/engines/honda_*.ogg` and `honda.json`, steady stretches cut from "2002-Honda-F20C.ogg" by Tyler Riddle (https://commons.wikimedia.org/wiki/File:2002-Honda-F20C.ogg; Commons' licence field: CC BY 3.0, "Own work"), fetched 2026-10-11. Same terms as above. Changed: steady stretches cut out and looped with a crossfade (`scripts/audio/cut_engine_runs.mjs`), converted, played at the engine's revs. The credit to show: `"2002-Honda-F20C" by Tyler Riddle (commons.wikimedia.org/wiki/File:2002-Honda-F20C.ogg), CC BY 3.0, cut into loops and played at the engine's revs`.

### The moon: NASA

`assets/sky/moon_albedo.jpg`, `moon_normal.jpg`, from NASA's CGI Moon Kit (https://svs.gsfc.nasa.gov/4720), by Ernie
Wright from Lunar Reconnaissance Orbiter data. A US government work, free to use; NASA asks to be acknowledged as the
source and not to be shown as endorsing anything. Changed: the normal map is baked from the kit's elevation map
(`scripts/sky/moon_maps.py`). The credit to show:

> Moon imagery: NASA's Scientific Visualization Studio

### Walks and runs: Carnegie Mellon University Motion Capture Database

Eight walking loops, seven running ones, and ten takes once through (two starts of a run, three stops, five jumps) (`assets/anims/cmu_*.glb`; detail in `assets/anims/CREDITS.md`), each one stride of a trial from
mocap.cs.cmu.edu, fetched 2026-10-06. The site's terms, in its own words: "This dataset of motions is free for all
uses." "You may include this data in commercially-sold products, but you may not resell this data directly, even in
converted form." "The motion capture data may be copied, modified, or redistributed without permission."

What that asks: nothing for a game, by the letter. The acknowledgement below is the one the site asks of published
research; it's given anyway. **The condition to keep to: the motions are never sold as motions** (an asset pack, a
store listing of the clips), converted or not. Changed: cut to one stride and looped, or to one take, made to walk on the spot, fitted to
the game's own skeletons. The credit to show:

> Motion capture data from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.

### Animals: Poly Pizza models, mostly CC BY 3.0

The street's animals (`assets/animals/candidates/`, `assets/animals/rigged/`; on by default, `?fauna=0` turns them off, `.claude/rules/fauna.md`). Each is a model from poly.pizza, fetched 2026-10-10, licence read from its page. **CC BY 3.0 asks**: the author named, the title, the licence named and linked (https://creativecommons.org/licenses/by/3.0/), where it came from, and a note of changes; nothing that suggests the author endorses the game. Changed: sized and lit for the game; many were rigged and animated by `scripts/animals/` (skeletons, weights and clips added), and one stood upright. The credit to show, once per model: `"<Title>" by <Author> (<page>), CC BY 3.0, rigged and animated for this game`. The models (the ones the street really uses; the list is also in the game's credits screen: `src/poc3d/real/faunaCredits.ts`, written by `scripts/animals/credits.py`; **when a model is added or dropped, run it**):

- AssetQuest (CC0 1.0): Red Dragonfly (https://poly.pizza/m/UIxtFAD1ve); Dragonfly (https://poly.pizza/m/de6jep5Fq5)
- elkiotbear (CC-BY 3.0): Black Shiba Inu (https://poly.pizza/m/aT17TtLWOL); Brown Shiba Inu (https://poly.pizza/m/ieGuPyxGTr); Cat (https://poly.pizza/m/ovFy5UldDq)
- Hiroyuki Kajiwara (hk) (CC-BY 3.0): cat loaf (https://poly.pizza/m/5qGO_C5GvAB)
- Jeff Larson (CC-BY 3.0): Spotted Gecko (https://poly.pizza/m/65Yj7059c2K)
- jeremy (CC-BY 3.0): Gecko (https://poly.pizza/m/3FxwLOrGiNL); Parrot (https://poly.pizza/m/3zS1cxISN0E); Crab (https://poly.pizza/m/bmZ6-LnPmp0)
- Lee Mason (CC-BY 3.0): Lil' Moth (https://poly.pizza/m/8ojwMQpu6DK)
- madtrollstudio (CC-BY 3.0): Lizard (https://poly.pizza/m/0z3NJc5zAE); Cat (https://poly.pizza/m/YvVobPlTlQ)
- Pat Siefring (CC-BY 3.0): Shiba Inu (https://poly.pizza/m/1sr1MDt9db5)
- Poly by Google (CC-BY 3.0): Seagull (https://poly.pizza/m/0WRzrtCIIRp); Dragonfly (https://poly.pizza/m/0myA_BOcZrD); Fox (https://poly.pizza/m/10u8FYPC5Br); Crow (https://poly.pizza/m/1MIvWQ5Q3R9); Mourning dove (https://poly.pizza/m/1cF8DTp2sAi); Dog (https://poly.pizza/m/24WsfFi7Q8s); Capuchin (https://poly.pizza/m/29hG1_J1Uiq); Crab (https://poly.pizza/m/2DgM36qZW2u); Turtle (https://poly.pizza/m/2LCcq8vhqJ3); Butterfly (https://poly.pizza/m/2ZwYwkTVnfG); Raccoon (https://poly.pizza/m/2iYORwFng3_); Sparrow (https://poly.pizza/m/3rTjKefT184); Great egret (https://poly.pizza/m/4GacWAa1lit); Sparrow (https://poly.pizza/m/4uL9XFDcdQK); Beetle (https://poly.pizza/m/4yufxgZ1QQ2); Dog (https://poly.pizza/m/5ttSZIlA0t6); Duck (https://poly.pizza/m/6HpauUCfIAb); Rooster (https://poly.pizza/m/6NTegstc5Jy); Flying seagull (https://poly.pizza/m/6Tpj_vcWP3f); Cat (https://poly.pizza/m/6dM1J6f6pm9); Rat (https://poly.pizza/m/6hsesZHvcPI); Heron (https://poly.pizza/m/74guNhJR5Ij); Gull (https://poly.pizza/m/7sQHkW0ylJy); Butterfly (https://poly.pizza/m/814CINpG3H1); Dog (https://poly.pizza/m/83Ha6EKTaOv); Hen (https://poly.pizza/m/8Unya0rw9tR); Snowy egret (https://poly.pizza/m/8VTUh9niy9k); Snail (https://poly.pizza/m/aZ_cT-AIu2y); Goat (https://poly.pizza/m/bNYS7ETDNCt); Dog (https://poly.pizza/m/baWJfMjFFC2); Turtle (https://poly.pizza/m/c6n73UnGEP4); Squirrel (https://poly.pizza/m/caxos24uWC9); Tree frog (https://poly.pizza/m/cwyNyIba6WE); Goat (https://poly.pizza/m/d7dImmjtF8E); Kitten (https://poly.pizza/m/dBJgGEu5bHW); Blue Heron (https://poly.pizza/m/dMR6NWzjlYT); Seagull (https://poly.pizza/m/dUFuQoM-k3s); Dog (https://poly.pizza/m/eDmSVe4TKwF); Flying gull (https://poly.pizza/m/eMNhHDZakYp); Cockroach (https://poly.pizza/m/eSCFQN_47V4); Baby chick (https://poly.pizza/m/fozJTmMX5yv); Mallard duck (https://poly.pizza/m/frSLi6b6Vid)

### Umbrella: "Umbrella" by Poly by Google, CC BY 3.0

`assets/props/umbrella/umbrella_open.glb`, the open umbrella Mack holds in the rain (`src/poc3d/models/heldItem.ts`). From https://poly.pizza/m/ez4MoDQFgXz, fetched 2026-10-11; its page gives the licence as CC-BY 3.0 (https://creativecommons.org/licenses/by/3.0/) and the author as "Poly by Google" (published 2017-10-23; 664 triangles). **CC BY 3.0 asks**: the author named, the title, the licence named and linked, where it came from, and a note of changes; nothing that suggests the author endorses the game. Changed (by the game as it loads it; the file is as fetched): scaled to a 1.5 m canopy, darkened, its shaft thinned, the canopy split from the handle and opened from a furled width. The credit to show: `"Umbrella" by Poly by Google (poly.pizza/m/ez4MoDQFgXz), CC BY 3.0, darkened and animated for this game`

## 2. Code that ships in the game

Their licences ask that the copyright notice and licence text go with every copy. **Not yet checked that a build
keeps them**; a licences file in the build would settle it.

| What | Licence | Notice |
| --- | --- | --- |
| three.js (rendering) | MIT | Copyright © 2010-2026 three.js authors (`node_modules/three/LICENSE`) |
| yaml (reads the content files) | ISC | Copyright Eemeli Aro (`node_modules/yaml/LICENSE`) |

## 3. Used with no credit owed (recorded anyway)

| What | Where | From | Licence | Conditions |
| --- | --- | --- | --- | --- |
| The cast's and crowd's bodies, skins, hair and clothes | `assets/characters/`, `assets/humans/`, `assets/mob/` | MakeHuman and its community asset packs, through MPFB (authors by asset in those folders' `CREDITS.md`) | CC0 | none. Two clothing files' headers still say AGPL3 though their pages say CC0: see the note in `assets/characters/CREDITS.md` |
| The cast's animations | `assets/anims/` | Universal Animation Library 1 (the whole pack, its paid tier, bought by the user 2026-10-06 at quaternius.itch.io) and 2 (Standard, fetched 2026-10-06 from opengameart.org), by Quaternius, https://quaternius.com | CC0 1.0 (each pack's `License.txt`, the paid one's too) | none. The bought zip isn't in the repository, only the motion cut from it. Detail in `assets/anims/CREDITS.md` |
| Cover, vault and roll animations | `assets/anims/mixamo_picked.glb` | 17 clips from Mixamo, Adobe, https://www.mixamo.com (the Action Adventure Pack and others), downloaded 2026-10-16 | Mixamo's terms (FAQ, 2022): free for games, commercial or not, no credit needed, raw files not to be passed on | none required. Credited anyway; the rest of the library stays out of the repository. Detail in `assets/anims/CREDITS.md` |
| The furled umbrella | `assets/props/umbrella/umbrella_closed.glb` | "Closed Umbrella" by CreativeTrio, https://poly.pizza/m/o0CUgpt8pm, fetched 2026-10-11 (page: "Public Domain (CC0)", CC0 1.0; 436 triangles) | CC0 1.0 | none. Scaled and held by the game |
| Gunshots and gun handling | `assets/audio/guns/` | The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney), opengameart.org | CC0 | none |
| Engine loops (six pitch steps of one engine) | `assets/audio/engines/loop_*.ogg` | "Racing car engine sound loops" by domasx2, opengameart.org/node/5633 | CC0 | none (the other loop, `real.ogg`, is the CC BY one in section 1) |
| The muzzle flash | `assets/vfx/` | CGHEVEN "Muzzle Flash 01", by Ammar Khan, cgheven.com | CC0, by the site's licence page | not to be resold as a standalone asset: don't publish the raw flipbooks |

Fetched for trying, not yet in anything that ships (`node scripts/materials/fetch.mjs list` says what's in
`.cache/materials/`): scanned materials and skies from Poly Haven and ambientCG, all CC0. One that goes into a model
gets a row above when it does.

## 4. Made for this game

Nothing owed to anyone; listed so it's clear what isn't from outside.

- **Generated music** (`assets/radio/`, every station's tracks but the 28 above): made on the developer's machine
  with ACE-Step 1.5 (the model's code is MIT, https://github.com/ace-step/ACE-Step-1.5) from prompts and lyrics
  written for the game. The artist names are invented.
- **Generated ad and signage art** (`assets/ads/`): made with the developer's own Krea Studio. Provenance beside each
  image.
- **Statues** (`assets/props/`): each a shape generated from a picture of the project's own and finished in
  Blender (`assets/props/CREDITS.md`). The tanuki is a candidate, in the model showroom only.
- Every other model, texture, sound and line of text is the project's own.

## 5. Tools (nothing of theirs ships)

Blender and MPFB (GPL), ffmpeg (the GPL build in `ffmpeg-static`), glTF-Transform (MIT), Vite, TypeScript, Vitest,
Playwright; MediaPipe and its pose model (Apache 2.0), which turn a video of someone into a clip
(`scripts/mocap/`): the clips made with it are the project's own; TripoSR (MIT, code and weights, by Tripo AI
and Stability AI) with rembg (MIT) and U-2-Net (Apache 2.0), which turn a picture of an object into a rough mesh
(`scripts/props/`): a mesh made with it from the project's own picture is the project's own, and gets a row in
section 4 if one ships; the same goes for Hi3DGen (MIT, code and weights, by Stable-X; with StableNormal, Apache
2.0, BiRefNet, MIT, and DINOv2, Apache 2.0), which makes a better shape on a rented GPU
(`scripts/props/mesh_endpoint.mjs`). What they produce isn't under their licences. None of their code or binaries may go into a build.

Not in that list, and not to be: Tencent's Hunyuan3D 2.1 (`mesh_endpoint.mjs --engine hunyuan`), tried privately. Its
licence does bind what it makes (no use, distribution or display in the EU, the UK or South Korea), so **nothing made
with it is in the game or may be put there**; its test meshes are in `debug-shots/` only.
