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
| A message arriving anywhere | A **pager**: a beep and a row of digits (a number to call back, or a short code) |
| The chat itself | A **telephone call**: at a payphone, the office, home or a bar's phone; your replies are what you say |
| Messages while you're away | An **answering machine** at the office and each home: a light, and a tape that can be kept as evidence |
| Photos in a chat | **Prints in an envelope**: under a door, or in the office mailbox |
| Video in a chat | An **unlabelled videotape**, which needs a deck: the office, a flat, a love hotel room |
| The home screen and apps | A **pocket notebook**: a map folded in the back, business cards for contacts, case notes, a diary page that saves, a photo in the cover instead of wallpaper |
| Maps and the GPS | A **paper street atlas**, with the you-are-here dot and a marker-pen route line kept (the user, 2026-10-12) |
| The music app | A **cassette player**, and the car stereo |
| The weather app | The forecast on the car radio and shop-window TVs. The app is dropped (the user) |
| Wallpapers | Dropped (the user) |

## How it plays

- **The engine stays.** Beats that arrive when story flags hold, lines delivered one at a time, replies you pick,
  flags set. Each beat gains a **channel**: pager, call, machine or paper.
- **Being told and finding out are separate.** The pager reaches you anywhere, but you must get to a phone to learn
  what it's about, and you stand still while you talk. No reading a conversation while walking.
- **Saving works anywhere**, from the notebook (the user, 2026-10-12).
- **Dom starts with no pager**, and Mack giving him one is a beat (the user). The notebook is a phrasebook for him:
  his language record lives there ([language.md](language.md)).

## Building it

1. ~~Rewrite the guide's phone references and the opening ([main/spring/01-osananajimi.md](main/spring/01-osananajimi.md)).~~ Done 2026-10-12.
2. Add the channel to the message format and engine (`src/phone/`). **Format done** (a beat's `channel`: chat, pager, call, machine or paper, `chat` by default, parsed and tested); the engine and the phone's screens don't act on it yet.
3. Design the pager and the notebook for the user's review before they're wired in.
4. Move the map and the saves into the notebook; drop the music, weather and wallpaper apps (or move music).
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
