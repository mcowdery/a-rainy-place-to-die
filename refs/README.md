# Reference photos

Photos to look at, not to use. Drop pictures here of the real things the game's models should resemble, and tell
Claude which folder to read before it builds or revises a model: it reads the images and works from what's in them
(proportions, details, how a thing is worn or weathered) where it would otherwise work from memory.

Nothing here ships and nothing here is committed: only this file is in git, the pictures are git-ignored. So they
can be anything you can look at, a screenshot, a photo off the web, your own: looking at a picture isn't copying it.
What that rules out: **no part of a reference picture goes into the game**, not as a texture, not traced, not as a
generator's input image (those have to pass `.claude/rules/licences.md`). And no real brand's name, logo or product
is reproduced because it's in a reference (CLAUDE.md: no real brands): take the shape of a 1980s kei truck, not its
badge.

## Where to put things

A folder a subject, named as you'd say it; a few good pictures beat fifty. Sub-folders if a subject has parts.

| Folder | For |
| --- | --- |
| `streets/` | Japanese streets: shopfronts, shutters, signage density, kerbs, poles and wires, vending machines, alleys |
| `vehicles/` | Cars, kei trucks, taxis, buses, motorcycles of the period: one model a sub-folder (front, side, rear, cabin) |
| `people/` | How people dress and carry themselves: salarymen, students, shop staff, the old; hair; shoes; bags |
| `interiors/` | Bars, kissaten, konbini, sentō, apartments, offices, hotel rooms |
| `props/` | Single objects: a phone box, a shrine lantern, a ticket gate, a tanuki statue |
| `mack/` | The main character's clothes, his bikes, his guns as objects (never a face to copy: he has none) |
| `motion/` | Short clips of how something moves (a walk, a gesture, a draw): `node scripts/clipFrames.mjs <clip>` turns one into frame sheets Claude can read; one to act out yourself goes through `scripts/mocap/` instead |

A text file beside a picture (`same-name.txt`) can say what to take from it: "the awning's sag, not the colours".
