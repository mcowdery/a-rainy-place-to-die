---
paths:
  - "src/vn/**"
  - "src/phone/**"
  - "src/save/**"
  - "content/vn/**"
  - "content/phone/**"
  - "story/**"
  - "scripts/vn/**"
  - "scripts/phone/**"
  - "src/poc3d/district/saveApp.ts"
---

# Story: VN mode, the phone, saves, the story guide

Covers playing VN exports, the node mapping, the phone and its messenger, wallpapers, saves, writing a scene, the story guide. One of the area docs indexed in the root CLAUDE.md; one topic a paragraph.

## VN mode

**VN mode** ([src/vn/](src/vn/)): plays the stories exported from the VN generator (Krea Studio). Each export (`vn-<story>.zip`: `scene.json`, `entry_points.json`, `assets/`) is unzipped into `content/vn/<story>/` (`npm run vn:pull -- <story_id>` downloads it from Studio for the account in `.env.krea`; `npm run vn:import -- <zip>` installs a file). `format.ts` is the schema and its validator; `engine.ts` is the library (every export merged; an entry key declared twice is an error) and a DOM-free state machine (frames, `next`, choices and hotspots filtered by `requires`, `set` / `on_enter` flags, targets), which the tests drive; `player.ts` (`VnPlayer`, the district's bridge) draws it: a frame's still letterboxed over the dimmed city, or (no image) the paused city between cinematic bars; bubbles typed out by kind (speech, thought, shout, caption); choices on 1-6; hotspots lit under the mouse; click / Space / Enter to go on; Esc leaves.

**The mapping, the game's half of the contract:** a world node's id is the entry key (`bar_kanpai.mama` plays the frame whose `entry_point` is `bar_kanpai.mama`); `exit:<a>.<b>` returns you to the spawn node `<a>.<b>` (or where you were if it isn't a spawn); a node no story knows falls back to `PlaceholderVnBridge`. Talking to an NPC turns you to face them. `tests/vn.test.ts` checks every shipped export (schema, entry points that are node ids, exits that are spawn ids) and plays a test story on real nodes.

## The phone

**The phone** ([src/phone/](src/phone/)): Tab opens the phone on its home screen (the clock and the apps: KAIWA and any `PhoneApp` registered with `PhoneUI.register`, like Maps; the bar at the bottom or Esc goes home). KAIWA (会話) is an invented LINE-style messenger (no real brands). Conversations are one file per contact in `content/phone/<contact>.yaml` (format in the header of `format.ts`): `beats` that arrive when their `when` condition on story flags first holds (plus `after` seconds), their messages typed out one at a time (text, `photo`, `video`, `sticker`, captions; `from: me` for yours), optional `replies` (you pick one; it's sent as your message, sets flags and brings their `then`), and flags `set` when the beat ends. A beat with only replies is you writing first; a contact's beats play one at a time, and one waiting for your reply holds back the rest. Media is `content/phone/media/` (`scripts/phone/record_clip.mjs` records a clip from the game's render canvas, no HUD, as webm). `engine.ts` is the DOM-free state machine (deliveries, typing, unread, 既読, the clock from the time of day), `ui.ts` draws it (chat list, threads with inline photos and videos, full-screen viewer, reply buttons or 1-4, a banner and `CityAudio.ping` for messages that arrive elsewhere, the corner chip with the unread count); the city keeps running and you can walk while it's open. It shares the `FlagStore` with the VN scenes, so VN choices trigger texts and replies can gate scenes and nodes. Only KAIWA's welcome ships for now.

**Wallpapers** (`src/phone/wallpapers.ts`, `wallpaperApp.ts`): the home screen draws one of the pictures in `assets/phone/wallpapers/` (approved Studio art, made from `assets/ads/source/` by `python scripts/crop_wallpapers.py`, 736x1536; a file's name is its id) with the clock at the top and the apps at the bottom, clear of a face in the middle; 壁紙, the wallpaper app, picks one or none (localStorage `citypop.phone.wallpaper`; `DEFAULT_WALLPAPER`). The seven so far are snapshots of a woman (the Julie, Koharu and Kimoto LoRAs) standing in for Megumi's photo; brief `assets/ads/briefs/phone-wallpaper-01.json`. `debug-shots/phonewallpaper.mjs`. `?debug=1&flags=a,b` sets story flags at the start; `window.__phone.skip(seconds)` fast-forwards. No saves yet: the phone's state lives in memory. `tests/phone.test.ts` checks the content and plays test conversations.

## Saves

**Saves** ([src/save/save.ts](src/save/save.ts)): the autosave and three slots in localStorage (`citypop.save.<slot>`). A save is the shared world (the story flags, which include the time of day and weather: `FlagStore.entries/load`) and each point-of-view character's state (`characters`, keyed by id; `current` is whose story it is): where they stand and look, whether they were driving their car (and where it is), their phone (`Phone.snapshot/restore`), their money and cars (the race profile). The story will jump between characters with homes (docs/city-plan.md); for now there is one, the MC. The phone's セーブ app (`district/saveApp.ts`) saves to a slot and loads one (a second tap confirms overwriting or leaving); the game autosaves every two minutes and when the tab is hidden, never mid-ride or mid-scene. Loading reopens the district with `?load=<slot>` (flags first, then the car, money, place and phone as each is set up). `?debug=1` exposes `__save`. `tests/save.test.ts`.

## Writing a scene, and the story guide

**Writing a scene:** in Studio's Storyboard (frames, bubbles, choices, hotspots, flags; the Route panel's entry point is a world node id), export it as VN, `npm run vn:pull -- <story_id>`. `npm run vn:keys` lists the keys a story can use (entry keys: npcs, story doors and hotspots, with the scene each already has; exit keys: spawns); `-- --json <file>` writes them out (`src/vn/keys.ts`). `npm run vn:try -- [story_id] <node id>` (pulling first if given a story) opens the district at `?debug=1&vn=<node id>`: in front of the node, facing it, its scene playing. `?debug=1` also exposes `window.__vn('<node id>')`. The only story shipped is a VN prototype kept as a working example, not canon: `content/vn/s90`, Mama-san at Bar Kanpai (`bar_kanpai.mama`: a flag on arrival, a menu with a choice that hides itself once taken, the bar inside with inspect and go hotspots). The rest of the old prototype (the trench-coat man, Room 303's knock, its phone chats) was removed; its approved stills stay in `assets/ads/source/` (82-85). The real story is planned in `story/`.

**The story guide** ([story/](story/README.md)): the premise, style, world (every story node by district), factions, cast (one file per character), the main story (`story/main/`: one per season, in chapters), side content (`story/side/`: optional side cases, side stories and the pool of unplaced ideas), the dating, names (who's who and where), threads (plot lines with their clues and flags), the timeline (a chapter per season) and the flags registry, as hand-written Markdown. Plain text is canon; **Proposed:** marks a suggestion waiting for the user's call; **Open:** a question not yet answered. Read the relevant files before writing a scene or chat, never settle an Open question without asking, and when a scene establishes something (a name, a history, a flag), move it into the guide as canon in the same change; keep `story/flags.md` and `story/world.md`'s node tables in step with `content/`. Studio's generated `story-bible/<user>.md` (krea-2-turbo) is a snapshot of Studio's data, not this; Studio stays the place for stills and Cast looks.
