# Credits and licences

Everything in the game that someone else made, and what each licence asks of us. The rules for adding to it are in
`.claude/rules/licences.md`: an entry is written here before the file is committed. Each asset folder's own
`CREDITS.md` has the detail (which file came from which, what was done to it).

**Before release:** the game has no credits screen yet. Section 1 has to be shown to players on one, and section 2's
notices have to ship in the build.

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
| Gunshots and gun handling | `assets/audio/guns/` | The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney), opengameart.org | CC0 | none |
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
