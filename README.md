# A Rainy Place to Die

A noir, city-pop game set in an alternate-reality Japan, played in the browser. You walk its streets in first person, drive its roads, ride its trains and buses, race on its mountain passes, and (in time) follow its story. The city is generated from a hand-painted map, zones and hand-placed set pieces; ASCII rendering is an optional overlay on a realistic three.js scene.

**Status:** work in progress. There is no menu screen or story yet; what exists is the city, driving, racing, people and sound.

## Run it

Requires Node 22 or newer.

```
npm ci
npm run dev        # then open http://localhost:5173/
```

| Page | What it is |
|---|---|
| `index.html` | the city: walk, drive, ride |
| `race.html`, `garage.html` | racing venues and your cars |
| `models.html`, `mob.html`, `characters.html`, `scenes.html` | showrooms for cars, passers-by, cast and the rooms behind windows |
| `fight.html`, `figures.html`, `humans.html`, `anims.html` | test areas for melee, generated figures, the crowd and animations (dev only) |

In the city: `M` the map, `` ` `` the debug menu, `F` flies, `Space` jumps. URL parameters (`?time=night&weather=rain&spawn=<node>`) are listed in [CLAUDE.md](CLAUDE.md).

## Editions

Three builds share one codebase: **standard**, **demo** (gameplay only, no story) and **uncensored** (adds adult material that lives in a separate private repository and is not part of this one). `npm run build:all` builds all three and checks each holds only its own files.

## Tests and checks

```
npm run typecheck
npm test
npm run audit      # docs, secrets, dev-endpoint code in builds, file sizes, credits
```

CI runs these on every push.

## Working in the code

[CLAUDE.md](CLAUDE.md) is the map: what each page is, the layered world generation, and an index of area docs in [.claude/rules/](.claude/rules/) (the city, roads, cars, people, sound, rendering and more). Open items are in [TODO.md](TODO.md).

## Credits and licences

Third-party work (music, models, textures and tools) and what each licence asks is listed in [CREDITS.md](CREDITS.md). Security reports: see [SECURITY.md](SECURITY.md).
