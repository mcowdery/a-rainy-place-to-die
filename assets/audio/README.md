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
| `step_hard_1`, `step_hard_2`, ... | footsteps on roads, pavements and floors | single dry steps (shoe on concrete), trimmed tight; one is picked at random per step |
| `step_grass_1`, ... | footsteps on lawns | single steps on grass |
| `step_gravel_1`, ... | footsteps on gravel and earth (playgrounds, vacant lots, the shrine) | single steps on gravel |

Levels still follow the rain, wind and cover (roof, indoors), so the recordings should be fairly even.
Free CC0 recordings: freesound.org (filter the licence to Creative Commons 0), or sonniss.com's GDC bundles.
Check each file's licence before committing it.
