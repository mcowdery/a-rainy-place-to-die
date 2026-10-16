# Street furniture plan: bus stops and payphones

Proposed 2026-10-11 and approved the same day (all nine recommendations). **Steps 1 and 2 are built (2026-10-12):
the bus stops are re-sited.** What was built, and where it differs from this plan, is in
`.claude/rules/roads-traffic.md` (**Bus stops**); in short: 50 stops in place of 36, each line's listed in
`traffic.yaml`; no stop is set back into a park yet; and no pole-only stop exists, because the blocks that would
have had one were widened or had room for a bench. **Steps 3 to 5 are built too (2026-10-12)**: the four phones (the booth in dark
aluminium, at the user's word, not green), 445 of them placed, drawn by an instanced system of their own, and usable
(E, the number keys, 117, 177 and 5100). What was built, what it differs in and what is left is in
`.claude/rules/rendering.md` (**Payphones in the city**). His hand on the handset is built too (mack.md). Left of
this plan: step 6's other items.

The city was laid out before either of these was thought about. Bus stops were added by the traffic code, which
knows the roads and not what stands beside them. Payphones need the same knowledge: what a spot is in front of, how
much pavement it has, what it would block. So this plan gives the city one way of choosing spots along its streets,
and puts bus stops and payphones on it.

## Decisions I need from you

Each has my recommendation. The rest of the document is the reasoning.

| # | Decision | Recommendation |
|---|---|---|
| 1 | How many bus stops a line has | One about every three blocks (a block is the 128 m of main road between two junctions, so 384 m) plus one at each place a line serves: about 55 stops in place of 36. Today it's four a line whatever its length. |
| 2 | Bus lines on roads too narrow for a bus (15 blocks on four lines, listed below) | Widen the 8 m and 6 m blocks to 12 m, as was done for Kawabata's and Nishihara's lines. Keep the 10 m blocks and give them a pole-and-sign stop with no shelter. |
| 3 | Stop names | Keep the names that name a place and move those stops to the place. Name the rest from their neighbourhood. I'd send you the full list to approve once the stops are placed. |
| 4 | How many payphones | About 450 on the streets and about 65 at set pieces (stations, konbini, the kōban and so on), against 2,875 vending machines. One number per zone sets it, so it's cheap to tune after you've walked it. |
| 5 | Walking into a booth | Yes: the door opens and you step in. It fits the no-teleports rule and it's the noir picture. |
| 6 | What a call costs, and with what | ¥10 from your money for the first version. A telephone card as an item is a later addition. |
| 7 | Who you can call in the first version | The speaking clock (117), the weather forecast (177) and a taxi to where you're standing. All three already exist in the game as data. Story calls come after, and need decision 8. |
| 8 | How a story call is written | As a KAIWA conversation file played as subtitles, not as a VN scene. The phone engine already does lines arriving, your replies and flags. |
| 9 | The red coin phone | Build it in Blender to match the other two, with a pink variant for bars. |

Two things the plan deliberately doesn't settle: whether Mack carries a mobile phone (you said you're still
deciding; nothing here depends on it), and Manila (its jeepney stops are re-sited by the same code, but it gets no
payphones until you ask).

## What's wrong with the bus stops today

I measured all 36 stops (nine lines, four each) with a script that reads the city's plan, and drew each as a text
map. The script is `tests/audit/streets.audit.ts` (`npm run audit:streets`); it writes `stops.txt`, `maps.txt`,
`lines.txt`, `anchors.txt`, `kerb.txt` and `frontages.txt` into `debug-shots/street-audit/`. The figures below are
from before the stops were moved; a run today measures the new ones.

| Fault | How many | Example |
|---|---|---|
| Stop on a road too narrow to read as a bus route | 2 on 8 m roads (1.6 m pavements), 3 on 10 m roads | 水道町東 and 鷹ノ台西: a 4.8 m carriageway with lane mouths either side of the stop |
| The shelter leaves no room to walk past | 11 of 36 leave under 1 m; 2 leave 0.1 m | The shelter is 1.5 m deep and 4.2 m long on any pavement, even a 1.6 m one |
| Stop across a side lane's mouth | 1 | 川端東: half the shelter stands in a lane's mouth |
| Stop in front of nothing, or of a fence | 2 | 竜胆町 faces bare ground; 西原駅前 stands against a playground fence |
| A lamp or hedge inside the shelter | 5 | 朝霧南, 霞町駅前, 鷹ノ台東, 西原団地, 朝霧西口 |
| The bus stops out in the road, not at the kerb | 25 of 36: its side is 1.3 m or more from the kerb, so you step off into the road. 5 are 4 to 10 m out | 歌舞路北, 朝霧北 and 都庁通り are 9.8 m out, across a slip lane from their shelters |
| Uneven spacing | The next stop is 193 m to 1,290 m on; 12 of 36 are over 600 m | The Nishihara line has four stops on 2.8 km |
| A stop named for a place isn't at it | 6 of the 9 named for a place are 92 to 347 m from it | 東都ドーム前 ("in front of the Dome") is 344 m from the Dome |

The "middle of an alleyway" you see is mostly the first two rows together: a full shelter on a back street, with
lanes opening onto the road beside it.

Three causes sit under these:

- **A stop's place comes from the road alone.** Each line is a rectangle of roads, and each side gets one stop at
  the middle of the block nearest that side's middle. Nothing anchors it to a station or a landmark.
- **The check for side streets misses most of them.** It tests whether the stop's kerb point is inside a crossing
  road. The lanes inside a block end flush with the main road's edge, about a metre short of that point, so they
  aren't seen. A second check (is there a building behind?) usually catches it, and when it can't find a spot it
  is dropped altogether.
- **Stops and street furniture don't know about each other.** Lamps, trees, hedges and vending machines keep clear
  of the middle 14 m of every block edge, on every main road in the city, in case a stop is there. 17 of the 36
  stops are somewhere else, and hundreds of block edges with no bus line have an empty gap for nothing.

## The idea: choose spots along the street once, for everything

Add one layer to the city's model between the street plan and the street furniture. It's computed the same way on
the page and in the chunk workers, like everything else in the model.

1. **Describe every stretch of kerb.** For each side of each road with a pavement: the stretches between side
   streets and junctions, and for each, the road's width, the pavement's width, and what is behind it every two
   metres (a building's front, side or back, a shop door, a park, a car park's entrance, a set piece, a gap between
   lots, nothing).
2. **Claim ground in a fixed order.** Bus stops first, then payphones. Each claims a rectangle: its own footprint
   plus the room it needs (where people wait, where a booth's door swings).
3. **Everything else keeps out of claimed ground.** Lamps step aside, trees, hedges, vending machines, potted
   plants, bicycles and posters skip it. This replaces the fixed 14 m gap.

The mouths of side streets come from the same function the ground already uses to cut the pavement
(`throughMouths` in [plan.ts](../src/poc3d/district/plan.ts)), so a mouth that is drawn is a mouth that is avoided.

## Bus stops

**Which blocks get a stop.** A line lists the places it serves; each becomes a stop in the block of the route
nearest that place. Between them, a stop is added wherever the gap would be more than three blocks. A stop's exact
spot is then chosen within its block.

**Where in the block.** Spots are ruled out if they are:

- across a side street's or lane's mouth, or within 3 m of one, or across a gap between lots;
- within 12 m of a junction past it, or 20 m before it (the queue for the lights);
- across a set piece's door or forecourt, or a car park's or playground's entrance;
- on a block with an expressway ramp's foot or slip lane, on a bridge, or on a riverside walk.

Among what's left, the best is the one nearest the place it serves, then the one with the widest pavement, then
one just past a junction, with a wall or a park behind it for its whole length.

**What kind of stop**, by the clear depth from kerb to building line:

| Clear depth | Stop | Leaves to walk past |
|---|---|---|
| A park or plaza behind | The shelter set back into the open ground | The whole pavement |
| 3 m or more | The shelter, against the kerb | 1.4 m or more |
| 2 to 3 m | A pole with its sign, and a bench against the wall | 1.4 m or more |
| 1.6 to 2 m | The pole and sign only | The pavement less the pole |
| Under 1.6 m | No stop: the line shouldn't be on this road | |

The pole-only stop is the ordinary Japanese bus stop; shelters are the exception there too. The pole and the bench
are parts the game already has, so there's no new model, but I'd show the two new arrangements in the showroom
before using them.

**The bus pulls in.** Traffic can already ease a vehicle sideways toward the kerb (it does for the police beacon).
A bus would do the same on its way into a stop, so its doors open 0.4 m from the kerb and you step off onto the
pavement. Blocks where a slip lane or a ramp is between the lane and the kerb are ruled out above.

**Roads too narrow.** A line should run on roads of at least 10 m, and a shelter needs 12 m. These blocks are narrower:

| Line | Blocks under 12 m |
|---|---|
| Gakuenzaka–Suidō-chō | 10 m: row 5 at columns 25, 29 and 30, and column 25 at row 6. **6 m with no pavement: column 25 at row 8** |
| Dome | 8 m: column 33 at row 6, column 32 at rows 6 and 7. 10 m: column 33 at rows 7 and 8 |
| Kasumi-chō | 8 m: column 26 at row 17 |
| Takanodai | 8 m: row 4 at column 21, column 17 at rows 4 and 5. 10 m: row 6 at column 21 |

Widening a block to 12 m (a line in `roads.yaml`) re-plans the lots on both sides of it, so the buildings there
change. Kawabata's and Nishihara's lines were done this way. The other choice is to move the line a block over
onto a wider road; I'd look at each of the eight blocks of 8 m or less and pick whichever disturbs less.

**The content format.** A line's `stops:` in `traffic.yaml` changes from four names to a list of places:
`{ name: 東都ドーム前, at: dome }` for a set piece, or `{ name: 竜胆町, block: ... }` for a block with no set piece.
The stops in between are named by the game from the neighbourhood (a zone's area name and a number, as 霞町二丁目).

## Payphones: where they go

**How much room there is.** I measured the clear depth in front of all 20,217 generated buildings (wall to the
edge of the carriageway).

| District | Buildings | Faces on a street with no raised pavement | Median clear depth |
|---|---|---|---|
| Residential (all the outer districts) | 10,742 | 77% | 1.3 m |
| Kawabata (old town) | 4,565 | 81% | 0.6 m |
| Denkō-chō | 1,939 | 69% | 0.5 m |
| Kaburo | 1,125 | 63% | 1.0 m |
| Tokyo Port | 866 | 23% | 3.3 m |
| Gakuenzaka | 741 | 62% | 2.3 m |
| Asagiri | 239 | 19% | 3.3 m |

So most of the city is lanes with no pavement, and a booth (0.9 by 1.0 m, with a door that swings 0.85 m) fits
almost none of it. That decides which phone goes where:

| Phone | Needs | Goes |
|---|---|---|
| Booth | 2.2 m clear, or open ground | Station fronts, corners of the avenues, park and plaza edges, big set pieces |
| Green phone under its hood | 1.2 m clear | Shop fronts on streets with pavements: konbini, drugstores, pachinko, banks, hotels; beside a bank of vending machines |
| Red (or pink) phone on a stand against the wall | 0.5 m | Lanes: tobacconists, grocers, noodle shops, laundries; bars, snack bars and mahjong parlours get the pink one |

**At set pieces**, by a table of defaults that a stamp's file can override with exact positions: a row of booths
beside each of the 11 station entrances and one phone at each of the 17 subway entrances; one at the konbini, the
kōban, each school gate, the temple and shrine gates, the ferry terminal, the fish market, the Dome, the hospital;
three on the terminal's bus island; two at the expressway parking area. Each is checked against the set piece's
own doors and fixtures, and I'd photograph every one for you, since generic positions will be wrong at some.

**On the streets**, one number per zone: the phones to expect in a cell (a 128 m square of the city). Each cell is
cut into tiles (one, four or nine by that number), and each tile gets at most one phone, at its best spot, so phones
are spread out and never bunch. A first guess at the numbers:

| District | Per cell | Cells | Phones |
|---|---|---|---|
| Kaburo | 2.2 (station edge 3, back alleys 2, Love District 1.5) | 30 | 66 |
| Denkō-chō | 2 | 30 | 60 |
| Asagiri | 1.5 (west exit 3) | 30 | 45 |
| Gakuenzaka | 1 | 40 | 40 |
| Kawabata | 0.9 (shopping street 2) | 68 | 61 |
| Residential | 0.45 (shopping streets 1.5, housing 0.3) | 327 | 147 |
| Tokyo Port | 0.2 | 165 | 33 |
| Total | | 690 | about 450 |

A spot is ruled out by the same tests as a bus stop's (mouths, doors, entrances, claimed ground), and a phone is
never put across an open shopfront's door or in front of a home.

## Payphones: drawing them and using them

**They aren't part of the chunk meshes.** A chunk is one merged mesh, and a merged mesh can't lift one phone's
handset. So phones are drawn by one small system on the page, the way the traffic signals' lamps are: it asks the
model for the phones near you and draws them all with a handful of instanced meshes. The cost is about a dozen draw
calls however many phones there are.

| Distance | What's drawn | Triangles each |
|---|---|---|
| Under 30 m | The Blender model: body, and the moving parts at rest | About 5,000 |
| 30 to 140 m | A low version from the same Blender script (no numerals, no bevels) | 300 to 600 |
| Beyond 140 m | Booths only, as the low version, to the edge of full detail | |

There are rarely more than half a dozen phones under 30 m, so a heavy case is about 50,000 triangles, which is small
beside a chunk's parked cars and trees.

**They use the city's material**, converted once when the page loads, so they take the street's lamp light, the
rain and the fog like every other object on the pavement. The booth's panes are the exception: you said the dark
glass read as a solid panel, so they stay see-through, as the buses' windows are. Each phone also adds a small pool
of light to the pavement at night, as a vending machine does.

**The phone you're using** swaps its moving parts for a copy that can move: the handset, the twelve keys, the coin
flap, the hook and, on a booth, the door. Only one exists at a time, and it's made during the loading screen so
nothing compiles while you play.

**Using one:**

- E within reach of a phone picks up the handset. A booth's door opens as you reach it and you step in; its walls
  are solid.
- You dial on the keyboard's number keys or by clicking the keys you're looking at. The keys press, the digits show
  on the display, and each key has its tone.
- You hear a dial tone, the ringing, then an answer, an engaged tone, or nothing. E or Esc hangs up.
- An answer is shown as subtitles, with your replies to pick from where a call has them.

**Sound.** Japan's telephone tones are a 400 Hz tone in three patterns (steady for dial, pulsed for ringing and
engaged), and the key tones are the standard pairs, so they can be generated exactly. I can't hear them, so the
first version would be unheard until you've listened.

**Mack's hands.** Lifting a handset to his ear is a new move for him, in first person and from outside. Under your
rule that moves are acted and shown moving before they're wired in, it gets its own review in the showroom.

**The code-built payphones** I made first (in `props.ts`) would be removed, since nothing would use them.

## Order of work

Each step ends with something you can look at, and the bus stops don't wait for the phones.

1. **Groundwork**, no visible change: the kerb description and its tests; the measuring script moved somewhere
   permanent; a debug layer on the M map marking every stop and phone, and a debug command to visit them in turn.
2. **Bus stops**: the new `stops:` format, the three kinds of stop, the bus pulling in, claimed ground in place of
   the fixed gap, the narrow blocks. You review the map, the stop names and a photograph of every stop.
3. **The models**: the red phone and the low versions from Blender, converted to the city's material, shown in the
   showroom by day and night for your approval.
4. **Phones in the city**: the drawing system, the zone numbers, the set-piece defaults, collision, the light on
   the pavement, the words for looking at one. You review the map layer and photographs; I measure the frame rate
   on the pod, and you check it on your own PC.
5. **Using one**: picking up, the booth door, dialling, the tones, the display, paying, the three service numbers,
   and one test conversation as a story call.
6. **Later, each on its own**: phones inside (station concourses, the hotel lobby, the sentō, bars); passers-by
   using phones and waiting at bus stops; a phone that rings as you pass, for the story; telephone cards; Manila.

## What else changes, and the risks

- **Street furniture shifts along the main roads everywhere.** With the fixed gap gone, lamps, trees and hedges
  near the middle of each block edge are placed differently. Posters that avoid them may move too. Nothing saved
  depends on it; some tests that expect exact positions will need updating.
- **Widening a road changes the buildings beside it.** Any set piece on those blocks has to still fit; the tests
  check that.
- **The bus pulling in is new behaviour in traffic.** Cars behind it wait as they do now. I'd check the avenues,
  where it moves furthest, before calling it done.
- **Frame rate.** The design holds the draw calls constant, but it's unmeasured until step 4.
- **The plan's counts are estimates.** The 55 stops and 450 phones come from arithmetic on block counts; the real
  numbers appear when the placement runs.

## Where this touches the code

For whoever builds it.

- New, pure: `district/sites.ts` (kerb stretches, what's behind, claimed ground), `district/stops.ts` (a line's
  stops), `district/payphoneSites.ts` (phones by zone and by set piece). Tests beside each.
- [model.ts](../src/poc3d/district/model.ts): holds the bus lines; `sites(mx, my)` cached like `detail`.
  `cellDetail` takes the cell's claimed rectangles; `stopClear` and `atStop` in
  [props.ts](../src/poc3d/real/props.ts) go.
- [district/traffic.ts](../src/poc3d/district/traffic.ts): `routeFor` takes its stops from `stops.ts`;
  `Route.edges[].mid` becomes `Route.stops[]`, any number a side. [real/traffic.ts](../src/poc3d/real/traffic.ts):
  `busStops` draws three kinds; the dwell loop runs over `stops`; a bus's `pull` rises into a stop.
- Zones: `payphone` in `ZoneLook` and its parser, a line in each zone file. Stamps: optional `phones:`.
- New on the page: `real/payphoneField.ts` (instanced, by distance, fed by `District.propsNear`),
  `district/payphone.ts` (the use: states, keys, the call), tone methods on `CityAudio`.
- [main.ts](../src/poc3d/district/main.ts): a branch in `interact()` before `target()`, and the modal gates (the
  lists of open panels that hold the mouse and keys).
- [payphone.py](../scripts/blender/payphone.py): `--mount stand` (the red phone) and `--low`.
