# Flags

Story flags live in one store (`FlagStore`, `src/core/flags.ts`), shared by VN scenes, KAIWA chats, node
`condition`s and saves. Kept by hand for now; once scenes are written as scripts, a check will build or verify
this list.

## Naming

- Story flags: `[a-z0-9_]`, true or false, named for what happened, in the past tense: `met_x`,
  `got_key`, `saw_photo`. A thread's flags share words so they sort together.
- Never reuse a name for something else (saves carry flags).
- `world.*` belongs to the game. Scenes and chats can't read those (a VN flag can't contain a dot); node
  conditions in stamps can (`world.time == "night"`).

## Owned by the game (`world.*`)

| Flag | Values | What it is |
|---|---|---|
| `world.clock` | minutes | Minutes since day 1, Friday 22:00 |
| `world.time` | `dawn` `day` `dusk` `night` | The time of day as the story and nodes read it, by the season's sunrise and sunset (dawn from 30 min before sunrise to 45 after, dusk from 45 min before sunset to 50 after) |
| `world.late` | bool | After the last train (00:40) until 05:00 |
| `world.season` | `spring` `summer` `autumn` `winter` | The season (the story's chapter) |
| `world.season_start` | minute | When the season began (the rainy season's start) |
| `world.weather` | `clear` `rain` `fog` `snow` | Weather now |
| `world.rain_amount` | 0–1 | How hard it's raining |
| `world.weather_hold` | bool | The weather was set by hand; the forecast waits |
| `world.tsuyu` | bool | The rainy season |
| `world.heat` | bool | A heat wave |
| `world.heat_until` | minute | A forced heat wave's end |
| `world.typhoon` | bool | A typhoon is passing |
| `world.typhoon_at` | minute | A forced typhoon's start |
| `world.settled_until` | minute | Settled weather (no heat wave or typhoon of the forecast's own) until then |

## Requests the story makes (the game acts, then clears them)

| Flag | Effect |
|---|---|
| `time_morning` `time_noon` `time_evening` `time_night` `time_late` | Run the clock on to 07:00, 12:00, 18:00, 22:00 or 01:30 |
| `season_spring` `season_summer` `season_autumn` `season_winter` | Turn the season (a chapter change) |

## Story flags

None yet.

| Flag | Set in | Read in |
|---|---|---|

A flag nobody reads is a loose end.

## Open

- **Open:** scenes that depend on the weather or the time of day need a way to see them. Either the game keeps
  a few plain booleans in step for the VN (`raining`, `is_night`, `last_train_gone`), or the choice is made
  in the world, with node conditions. Worth deciding before the first scene that needs it.
