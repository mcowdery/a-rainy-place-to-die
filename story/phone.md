# What he carries

Decided 2026-10-12 (the user): the phone of the game (the messenger KAIWA, the Maps app, the camera in a pocket) was
twenty years early for the era, so it's replaced by what the period had. The order has some hidden technology, but
the phone doesn't lean on it: that stays with its machines. The year is still **Open** ([premise.md](premise.md),
The year); this holds for anywhere from the late eighties to about 1993. The details of the period (what a pager
showed, what a payphone took) are from memory and are to be checked before they're written into a scene.

**The guide is rewritten for it** (the opening, the detective's thread, the mythos, style); **the game is not.** The game still has the phone as it was; this is the plan it changes to.

## What replaces what

| Was | Becomes |
|---|---|
| A message arriving anywhere | A **pager**, ポケベル *pokeberu* (ポケットベル, "pocket bell", the word Japan used; the user, 2026-10-12: it should sound Japanese): a beep and a row of digits (a number to call back, or a short code). Digits only: it can't show a name, so the game names the caller only when the number is on a card in the notebook. **Proposed:** its maker, an invented one, 東和通信 Tōwa Tsūshin |
| The chat itself | A **telephone call**: at a payphone, the office, home or a bar's phone; your replies are what you say |
| Messages while you're away | An **answering machine** at the office and each home: a light, and a tape that can be kept as evidence |
| Photos in a chat | **Prints in an envelope**: under a door, or in the office mailbox |
| Video in a chat | An **unlabelled videotape**, which needs a deck: the office, a flat, a love hotel room |
| The home screen and apps | A **pocket notebook**: a map folded in the back, business cards for contacts, case notes, a diary page that saves, a photo in the cover instead of wallpaper |
| Maps and the GPS | **Not in the notebook, and not given a reason from the era** (the user, 2026-10-13: "the map as it currently is"; a GPS wasn't something ordinary people had then). It stays the game's own: M for the map, a click to set a destination, N for auto drive. The paper atlas and its marker-pen route are dropped |
| The music app | A **cassette player**, and the car stereo |
| The weather app | The forecast on the car radio and shop-window TVs. The app is dropped (the user) |
| Wallpapers | Dropped (the user) |

## How it plays

- **The engine stays.** Beats that arrive when story flags hold, lines delivered one at a time, replies you pick,
  flags set. Each beat gains a **channel**: pager, call, machine or paper.
- **Being told and finding out are separate.** The pager reaches you anywhere, but you must get to a phone to learn
  what it's about, and you stand still while you talk. No reading a conversation while walking.
- **Saving is the pause menu's** (Esc → Save and load; the user, 2026-10-13), and anywhere, as before. It was to be the notebook's diary: not any more.
- **Dom starts with no pager**, and Mack giving him one is a beat (the user). The notebook is a phrasebook for him:
  his language record lives there ([language.md](language.md)).

## Building it

1. ~~Rewrite the guide's phone references and the opening ([main/spring/01-osananajimi.md](main/spring/01-osananajimi.md)).~~ Done 2026-10-12.
2. Add the channel to the message format and engine (`src/phone/`). **Format done** (a beat's `channel`: chat, pager, call, machine or paper, `chat` by default, parsed and tested); the engine and the phone's screens don't act on it yet.
3. Design the pager and the notebook for the user's review before they're wired in. **Pictures approved, 2026-10-12** (the user asked for a realistic, well-worn noir look, and for generated photographs): the pager, the binder open and closed, a blank leaf, a card, a folded sheet, a cassette, an envelope and (from a second batch) the videotape stopped part-way, each a photograph of one object with every display, page and label blank, cut out into `assets/phone/carry/` with the areas the game draws on (`scripts/crop_carry.py`; .claude/rules/generated-art.md). The mock-up on them: https://claude.ai/artifact/HmLoAUjpEfS679J4BH87pJ. The user's answer on the composed design, 2026-10-12: yes, but fix the cards first. Done since: the card squared off and aged, the cards tucked into the cover's pockets (pulled out to read), and candidates for the print of Megumi generated at the user's word (batch `megumi_print_01`, pending review). **Approved** ("original card is fine ... tucked is fine"): the card stays as first approved (the squared, aged one wasn't taken up), the cards are tucked into the pockets, and the print of Megumi is `megumi_kamakura` variant 2 (source 107, `assets/phone/carry/megumi.webp`).
   **The pager is in the game** (2026-10-12, the user: "tucked is fine. start on the pager"; .claude/rules/story.md, The pager): a pager beat pages him, the photograph of the pager is held up with the digits in its window, it keeps four pages, and ringing the number from a payphone plays what the page was about. No contact pages him yet: the story's calls are to be written.
4. ~~Move the map and the saves into the notebook.~~ Done differently, 2026-10-13: the saves are the pause menu's page and the map is the M map alone; the phone's Save and Maps apps are gone. Still to drop: the music, weather and wallpaper apps (or move music), once the notebook replaces the home screen.
5. Make payphones (the prop already stands on the street), the office machine, the mailbox and a tape deck usable.

## The opening, refitted (Proposed)

- Minato and Koharu's texts become calls between their flats, messages on his machine and pages in a number code.
  The signs become her line engaged at midnight, the machine picking up, her mother answering, a page unreturned.
- The seminar's group chat becomes talk on the steps and a tape passed round.
- The stranger phones his flat; the number on the pager rings in an empty phone box. The video is a tape in his
  letterbox, and the player puts it in the machine.
- The message forged in Koharu's name is her voice on his machine, cut together from recordings of her: ordinary
  tape editing, nothing from the order.
- Cash One's Monday photograph is a print in an envelope, with the words on the back.
