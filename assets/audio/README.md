# City sound recordings (optional)

The district's sound (`src/poc3d/real/audio.ts`) is synthesized, so nothing here is required. A recording
dropped in this folder replaces its synthesized part. Use `.ogg`, `.mp3`, `.wav` or `.m4a`:

| File name | Used for | Notes |
|---|---|---|
| `rain_loop` | the rain bed out in the open | a seamless loop of steady rain, 20-60 s |
| `rain_roof_loop` | rain drumming on the roof overhead | a loop of rain on an awning or canopy |
| `wind_loop` | wind | a loop of steady wind; its level and filtering still follow the gusts |
| `tyre_hiss` | cars passing on a wet road | a loop of tyre spray/hiss (not a single pass-by) |
| `thunder_1`, `thunder_2`, ... | thunder | single claps and rolls; one is picked at random per strike |
| `step_<surface>_1`, `step_<surface>_2`, ... | footsteps on that surface, in any footwear | single dry steps, trimmed tight; one is picked at random per step |
| `step_<surface>_<footwear>_1`, ... | footsteps on that surface in that footwear | used before the plain `step_<surface>_*` ones |
| `step_hard_1`, ... | footsteps on `asphalt`, `paving` and `tile` without recordings of their own | single dry steps (shoe on concrete) |

Surfaces (`src/poc3d/district/footing.ts`): `asphalt` (roads, car parks), `paving` (pavements, plazas, concrete
floors), `tile` (shops, stations, lobbies), `wood` (boards), `tatami`, `carpet`, `metal` (a train's or bus's floor),
`grass`, `gravel` (park paths, vacant lots, the shrine), `earth` (playgrounds, the building site), `snow`.
Footwear: `boots`, `shoes` (dress shoes), `bare`. So `step_gravel_boots_1.ogg`, `step_tile_bare_2.ogg`,
`step_wood_1.ogg`. Record one foot's step only: a landing plays it heavier, and a wet street adds its own splash.

Levels still follow the rain, wind and cover (roof, indoors), so the recordings should be fairly even.
Free CC0 recordings: freesound.org (filter the licence to Creative Commons 0), or sonniss.com's GDC bundles.
Check each file's licence before committing it.

## Gunshots (`guns/`)

The guns' shots are recordings: `guns/<pistol|shotgun>_<voice>_<near|far>_<n>.ogg`, with their handling sounds as
`guns/foley_<name>.ogg` (the magazine out and in, the slide, a dry click, the lever), cut by `scripts/audio/cut_guns.py` from the Free Firearm
Sound Library (CC0; see `guns/CREDITS.md`). `src/race/gunSound.ts` plays them; the voices are listed in `src/race/gunVoices.ts`.
To add a voice, add its files to the script's `VOICES`, run it, and add the name to `GUN_VOICES`.
