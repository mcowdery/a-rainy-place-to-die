# The story guide

Everything the story needs that the code doesn't hold: the premise and tone, the world as the story sees it,
the factions, the cast, the plot threads, the calendar, and the flags that tie them to the game. Writers (you,
and Claude in this repo) read it before writing a scene, and update it when a scene decides something.

It's plain Markdown in git, next to the content it points at (node ids in `content/world3d/stamps/`, scenes in
`content/vn/`, chats in `content/phone/`), so it can be checked against them.

## Files

| File | What's in it |
|---|---|
| [premise.md](premise.md) | The pitch, the shape of the year, the pillars, tone |
| [style.md](style.md) | How the writing reads: voice, dialogue, the three ways a scene can play, language |
| [names.md](names.md) | Who's who and where: every district and person named so far, what the names mean, plain English handles |
| [world.md](world.md) | Tōto as the story sees it: districts, places and every story node, by district |
| [factions.md](factions.md) | The groups with power: yakuza, the agency, the police, the racing scene |
| [cast/](cast/README.md) | One file per character that matters, plus the minor ones in one list |
| [main/](main/README.md) | The main story: one per season, in chapters, with its lead, reveal and machine |
| [side/](side/README.md) | Optional side content: side cases, side stories, and the pool of ideas not yet placed |
| [threads/](threads/README.md) | Plot threads: what happens, the clues, the flags, the scenes |
| [dating.md](dating.md) | The open world's dating: one-night stands and short stories, how they play, the rules |
| [timeline.md](timeline.md) | Chapters (one per season), the map by season, what each season brings |
| [flags.md](flags.md) | Every flag: what the engine owns, what the story sets, where each is set and read |

## Canon, proposals and open questions

- Plain text is **canon**: it's in the game already, or you've decided it.
- **Proposed:** marks a suggestion from Claude, waiting for your call. Accept it by deleting the label; reject it
  by deleting the line.
- **Open:** marks a question nobody has answered yet. The open questions in each file are the to-do list.

When a scene is written, what it establishes moves into the guide as canon (a character's history, a new flag,
a clue) in the same change.

## How the pieces fit

```
story/            the story guide (this folder): decisions, in prose
  ↓ written from it
scripts           (not built yet) scenes and chats as text, compiled to the formats below
  ↓
content/vn/       VN exports (schema 2/3 scene.json): scenes, with stills or without
content/phone/    KAIWA chats (one YAML per contact)
  ↑
Krea Studio       stills for the scenes that need them, Cast looks and LoRAs, media-heavy chats
```

Studio's own "story bible" (the generated `story-bible/<user>.md` in krea-2-turbo) is a snapshot of Studio's
data, not this. It's still handy for a character's look (Cast) when briefing art.
