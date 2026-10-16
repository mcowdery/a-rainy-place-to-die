# Engine loops

Cut to mono Ogg Opus (48 kHz) by `scripts/audio/cut_engines.mjs` from files fetched 2026-10-11 into `.cache/engine-sounds/`. Played by `src/race/engineSamples.ts` / `sound.ts`, faster as the revs rise (a change of pitch and a low-pass; nothing else done to the recordings).

| File | Source | Licence |
|---|---|---|
| `real.ogg` | "Car Engine Loop 96kHz, 4s" (`motor-loop-1-normalized.wav`, the 44.1 kHz version) by qubodup, https://opengameart.org/content/car-engine-loop-96khz-4s. A car engine recorded and looped for the Trigger racing game. | CC BY 3.0 (the page also offers GPL 2.0 / 3.0; the CC BY is the one used). Credit owed: qubodup, "Car Engine Loop 96kHz, 4s", CC BY 3.0, changed (pitch-shifted live, converted). |
| `loop_0.ogg` ... `loop_5.ogg` | "Racing car engine sound loops" by domasx2, https://opengameart.org/node/5633 (`loop_0.wav`, `loop_1_0.wav` ... `loop_5_0.wav`: one engine at six pitches). Made from a public-domain sound (pdsounds.org); the author remade them from a public-domain sample after a licence question in the page's comments. | CC0 (the licence badge on the page) |
| `honda_0.ogg` ... `honda_2.ogg`, `honda.json` | "2002-Honda-F20C" by Tyler Riddle, https://commons.wikimedia.org/wiki/File:2002-Honda-F20C.ogg (a Honda F20C, microphone in the engine bay). Three steady stretches found and looped (crossfaded) by `scripts/audio/cut_engine_runs.mjs`; `honda.json` holds each loop's measured pitch. | CC BY 3.0 (Commons licence field). Credit owed: Tyler Riddle, the title, CC BY 3.0, changed. |
