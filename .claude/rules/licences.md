---
paths:
  - "CREDITS.md"
  - "assets/**/CREDITS.md"
  - "scripts/anims/**"
  - "scripts/materials/**"
---

# Other people's work: licences and credits

Covers which licences an asset from outside may have, what each one asks, and where credits are recorded. One of the area docs indexed in the root CLAUDE.md; one topic a paragraph.

**The rule** (the user, 2026-10-06: the cast's "CC0 only" was an earlier session's caution, not theirs; relaxed, "but let's make sure to keep a list of the required crediting and pay close attention to any rules they might have"). The game is sold, in three editions, one of them adult, so everything brought in from outside (models, textures, animations, sounds, music, fonts, code) has to allow commercial use, changes, and use in an adult work. Its licence is read, on the author's own page and in the file's own licence text, before the file is used, and its entry is written into the credits before it's committed. A licence that can't be found, or that says two things, counts as not allowed until the user decides.

**What may be used.** CC0 and public domain: nothing owed, recorded anyway. CC BY (any version): with its credit in `CREDITS.md`. Code under MIT, BSD, ISC or Apache-2.0: its copyright notice kept with what ships. Fonts under the SIL Open Font License: the licence file shipped beside the font, the font never sold alone. Works of the US government (NASA): free, with the credit they ask for.

**What may not, without asking the user.** NC (non-commercial) and "free for personal use". ND (no derivatives): cropping, re-encoding, recolouring and retargeting are all changes. SA (share-alike, CC BY-SA) and GPL/AGPL for anything that ships: they can ask for the game's own work to be released under the same terms. "Editorial use only". Anything taken from another game or film. Any licence with a clause against adult, "sensitive" or "objectionable" use (common on stock sites and some model libraries: read for it every time, since the uncensored edition would break it). A licence that forbids passing the files on, if the asset would sit in this repository as its source file.

**Rules that come with allowed licences, to keep to.** CC BY wants, for each work: the author named the way they ask, the title, the licence named with its link, a link to where it came from, and a note that it was changed if it was (4.0 §3(a); a credit a player can find, so a credits screen, not only a file in the repository). It also says the credit must not suggest the author endorses the game, and that no technical lock may stop someone using the work as the licence allows (4.0 §2(a)(5)(C)): a matter for the user if a store's copy protection wraps the game's files. "Not to be resold as a standalone asset" (CGHEVEN, Sonniss and others): fine inside a game, and a reason not to publish the raw file. GPL tools (Blender, MPFB, the ffmpeg build in `ffmpeg-static`) are tools: what they make isn't under the GPL, but none of their own code or binaries may ship in a build.

**Where it's recorded.** `CREDITS.md` at the root is the one list: first the credits the game is obliged to show, with the exact wording, then everything else that came from outside and what it asks. Each asset folder's own `CREDITS.md` keeps the detail (which file came from which source file, what was done to it). An entry gives the author, the title, the licence and its version, the page it came from, the date it was fetched, and what was changed. Licence pages change: quote the sentence that grants the use, as the gun and flash credits do. **The game needs a credits screen listing the first section before it's released**; there isn't one yet.

**Scanned materials and skies** (`node scripts/materials/fetch.mjs search <words> | get <polyhaven|ambientcg>:<id> [--res 1k] | list`): Poly Haven's textures and HDRI skies and ambientCG's materials, both CC0 with nothing owed ("You can use our assets for any purpose, including commercial work. You do not need to give credit"; "You can include the raw files in your project, for example a video game"). `get` puts a material's maps (colour, normal the OpenGL way up, roughness, ambient occlusion, height) or a sky's .hdr into `.cache/materials/<library>/<id>/` with a `source.json` (who made it, its licence, its page, the day): that is its credit entry when it's used. It is a quarry, not the game: a material reaches a model through the model's build and the model reaches the city through a showroom and the user's approval; only what ships is copied out and written into `CREDITS.md`. Poly Haven's API terms ask every caller to name itself (the script's User-Agent) and, of software that shows its content to users, a "Powered by Poly Haven" line, which a private fetch isn't.

**Reference photos** (`refs/`, its README): pictures to look at before modelling something, in a folder a subject. Git-ignored but for the README, never shipped, so they can be anything; and for that reason nothing of one goes into the game (not as a texture, not traced, not as a generator's input), and a brand seen in one isn't copied.

**A generator's or a tracker's licence is three licences**: its code's, its model weights', and what either says of what it makes. The good video-to-motion models of 2026 (GVHMR, WHAM and their kin) are for non-commercial research and rest on the SMPL body model, whose commercial licence is bought by the year: not allowed here, however good. What is used instead is in cast.md (MediaPipe, Apache 2.0 for code and model alike).

**Sources fetched, not kept** go in `.cache/` (git-ignored): packs as downloaded, to be cut down by a script in `scripts/` that says where they came from, so a build can be repeated.
