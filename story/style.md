# Style

How the writing reads, and what each way of telling a scene can hold.

## Voice

- Short lines. A bubble is one breath: one or two sentences, rarely more than about 120 characters. Silence
  and a caption often say more than a speech.
- People talk around things. Nobody says "the occupant is missing"; they say "Nobody's seen them leave." Let
  the player put it together.
- Each character sounds like themselves (see their cast file's **Voice**).
- English dialogue with Japanese where it's natural: forms of address (-san, senpai, oyaji, mama for a bar's
  owner), exclamations (Ara), the names of places, food and things (oden, keep bottle, apāto). No glossary in the text;
  the context carries it.
- Signs, menus and the phone's official accounts can be in Japanese with English beside it (KAIWAへようこそ!
  Welcome to KAIWA.).
- Captions are present tense, second person, spare: "The rain stops. Somewhere above, a window closes."

## Grounded

Everything leans grounded in reality. The exceptions come from two places only: **technology** (Mack's body, the
machines, the Beast) and the **Christian supernatural** (demons, angels, the Nephilim, fallen ones). Anything
supernatural has to work by the Christian framework: the occult (fortune telling, a séance, a curse) can be real
if what's really behind it is demonic, but the story prefers the grounded explanation: a fortune teller is
usually a fraud, a strange coincidence usually has a human cause.

The Christian themes stay subtle: hinted at, never explicit, left for the reader to interpret that way. They
become more explicit only where the order is involved, and at the very end.

## The ways a scene can play

| Way | What the player sees | Good for | Made with |
|---|---|---|---|
| **VN with stills** | A still, letterboxed over the dimmed city, bubbles over it, choices, hotspots on the picture | Key moments, faces, places the 3D city can't show (a room's detail, a close-up) | Stills from Krea Studio, then the VN export |
| **VN without stills** | The paused city between cinematic bars, the same bubbles and choices | Most conversations: at a door, with an npc in the street | Text only, no art |
| **Phone (KAIWA)** | Messages arriving in the city while you walk; photos, videos, stickers, your replies | Keeping threads alive between scenes, people you haven't met, the time between chapters | `content/phone/<contact>.yaml` |
| **Choreographed scene** | (Not built yet.) Figures moving in the real city, the camera directed | Chases, arrivals, a crowd at the Dome | Later |

A scene starts where the player uses a world node: talking to an **npc**, a story **door** (a door that isn't a
walk-through) or a **hotspot**. The node's id is the scene's entry key. A scene ends by going back to the world:
to a spawn (`exit:<place>.<spawn>`) or where the player stood.

## Limits to write within

- Up to 12 bubbles on one frame and up to 6 choices (the player picks with 1–6). Most frames want 1–3 bubbles.
- Bubble kinds the player draws: **speech**, **thought**, **shout**, **caption**. (Whisper and phone voices
  are drawn as speech for now.)
- Chats: up to 4 replies to pick from.
- A choice or hotspot can need flags (`requires`) and set them (`set`). A choice that has been taken can hide
  itself by needing its own flag to be false (`!asked_about_x`).
- A scene can ask for a time of day (`time_evening` ...) and a chapter can turn the season (`season_summer`
  ...). See [flags.md](flags.md).
- **Open (a gap in the format):** a bubble has no speaker. With a still, the picture shows who's talking;
  without one, nothing does. Scenes without stills need a convention before there are many of them: the name
  in the bubble ("NAME: ..."), or a speaker field added to the export format in Studio.

## Adult content

- **Two editions.** The **standard** edition is censored and more family friendly, but still adult leaning:
  it's a noir game. The **uncensored** edition adds explicit images and sex scenes. One story: the same
  scenes, choices and flags in both; only what's shown differs.
- **A gameplay demo** as well: no story at all and none of the revealing ads, for audiences who want none of
  it. Nothing in the story needs writing for it.
- Everyone in a sexual scene or image is **21 or older**, and it's **consensual**.
- **Evil is chosen.** Villains are villains by what they and their organisations do, never by their race or
  nationality; every group in the story has good people in it too.
- **Nothing sexual, even implied, involves a minor or anyone who reads as one.** The city has schools, a
  teacher and idols; students stay entirely out of it, and any idol in a romantic or sexual storyline is
  plainly an adult.
- **Who writes what.** Claude writes the story, the characters and every scene up to the explicit part: the
  lead-in, the standard edition's cut (a fade, the morning after) and what follows. The explicit scenes and
  explicit image prompts are written in Cursor (Grok), from a brief Claude writes (who, where, the beat, what
  changes after, the flags), and slot into the uncensored edition.
- **How they slot in.** The explicit files live in `adult/` (its own repository; see CLAUDE.md, Editions). An
  uncensored scene is an overlay on the standard one: it can change what a frame shows (the still, the words)
  and add frames that lead back to where the story was going, but never the choices' targets, the flags or the
  entry points. So write the standard scene first, with a frame where the explicit part goes (the fade); the
  overlay replaces that frame and adds its own after it.

## The killings

The faceless man's killings (see [mythos.md](mythos.md)) are shown the way crime dramas show them: the scene
found afterwards, the reactions, the detective's reconstruction, the horror implied more than shown, never
lingered on. They are never sexualised and never part of the explicit edition: the uncensored edition is for
consensual sex, not for this.

## Crimes against children (under consideration)

**Open:** whether the story has villains who traffic and abuse children (an Epstein-like network), to show it
as the real evil it is and bring them to justice. If it does:

- It's never shown and never described. The story alludes to it through what's left behind: a ledger, a
  guest list, a locked room found empty, what an investigator won't say out loud, a survivor's silence.
- It's never sexual in any way and never near sexual content: no explicit or adult scenes in that thread or
  with those villains, in either edition. It plays the same in both editions.
- Not for shock, not a twist for its own sake, no jokes. The villains are plainly evil and they are brought
  to justice.
- Victims are people, not plot devices. Where a survivor appears, it's as an adult, later, with their
  dignity.
- Grounded in how it really happens (debt, false job offers, agencies, complicit officials and police), not
  in conspiracy-theory tropes.
- This thread is written here, not in the explicit-scene workflow.
- **Proposed:** a content note at the start of the game, and an end card with real support organisations.

## Art

- Stills are generated in Krea Studio and reviewed before they're used (the same review as ads). A scene can
  reuse a still across frames (one still for a whole conversation).
- A character's look is kept in Studio's Cast (description, outfits, LoRA); their cast file here links it.
