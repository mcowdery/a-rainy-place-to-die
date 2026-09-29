# Tōto: the whole-city plan (L0 v2)

Approved 2026-09-29. The map is `content/world3d/l0.txt` (44 × 29 cells of 128 m; the land is about 4.7 × 3.3 km
with the bay's islands, 746 cells). The interactive version, with every marker, is the published plan page
(https://claude.ai/artifact/HqFBmsBqAJLPjV7sT5NGT2). Cells below are `[col, row]`.

The built core stays where it is; the map only grows right and down, so placements keep their cells. The city
is laid out in rings: the core (Asagiri, Kaburo), then the new districts, then residential and old-town rings,
then the edges (hills north and west, the bay south, the coast east).

## Districts

| District | L0 | Cells (about) | Character | Anchors |
|---|---|---|---|---|
| 歌舞路 Kaburo (built) | N | 26–31 × 9–13 | The neon core | Mega-sign, Hotel Rouge, Yokocho; capsule hotel and net café (MC ladder 1) |
| 朝霧 Asagiri (built) | T | 20–25 × 9–13 | Towers, the terminal | The Peak (CEO), Stella Production, idol dorm [21, 8] |
| 桜ヶ丘 Sakuragaoka (built) | R | 14–19 × 9–12 | Houses, a shopping street | Sakura-yu; school No. 1 [15, 11]; teacher [16, 12]; apāto (MC ladder 2) [17, 11] |
| 電光町 Denkō-chō | E | 32–36 × 8–13 | Akihabara-like electric town, elevated line overhead | Idol theatre [34, 10]; idol manager [33, 8]; multi-storey car park [33, 13] |
| 学園坂 Gakuenzaka | U | 22–29 × 3–7 | University on its slope, student town | Tōto University [25, 4]; school No. 2 [21, 5] |
| 水道町 Suidō-chō | R | 30–36 × 3–7 | Dome City and flats | Tōto Dome [33, 5] (big concerts); MC ladder 4 [30, 5] |
| 鷹ノ台 Takanodai | R | 10–21 × 1–8 | The north-west heights | Hill house (MC ladder 6) [12, 4]; lookout [14, 3]; ryokan [11, 3]; flood tunnel [13, 5] |
| 西原 Nishihara | R | 7–13 × 8–17 | Western suburbs on the Seikō Line | Salaryman's danchi [11, 11]; abandoned amusement park [8, 7] |
| 霞町 Kasumi-chō | R | 8–36 × 14–17 | South of the core, mid-rise | Hospital [23, 15]; cemetery avenue [19, 15]; fire station [29, 15]; batting centre [34, 16]; redevelopment site [32, 15]; MC ladder 3 [26, 16] |
| 川端 Kawabata | O | 38–42 × 4–17 | Old town across the river | Temple and shopping street [40, 7] (on a rise); broadcast tower [40, 13]; yakuza house [41, 9]; detective [40, 15] |
| 東都港 Tōto Port | H | 6–36 × 18–21 | Port | Fish market [35, 19]; container terminal [9, 20]; ferry [20, 21]; disco [24, 19]; tuning shop [25, 18]; harbour towers (MC ladder 5) [30, 19] |
| 汐見島 Shiomi-jima | H | 26–31 × 23–25 | Harbour island (Odaiba-like), over the bridge | TV station [27, 23]; Ferris wheel [31, 23]; Zepp-style hall [30, 25] |
| 恵比寿島 Ebisu-jima | H | 15–18 × 22–23 | Island under the Wangan | Ebisu-jima PA [16, 22] (Daikoku-like car meets) |
| 羽根島 Hanejima | H | 4–11 × 23–26 | Airport on reclaimed land | Tōto Airport [8, 25] |
| 夕凪浜 Yūnagi beach | B | 39–42 × 18–20 | Beach past the river mouth | The Yūnagi tunnel |

The river (隅川 Sumikawa) runs down column 37 from the northern hills to the bay: embankments, houseboats,
food stalls, the fireworks; bridges at the avenues.

## Idol venues

Small: the idol theatre in Denkō-chō. Medium: the Zepp-style hall on Shiomi-jima. Large: Tōto Dome. Kaburo's
basement LIVE HOUSE (built) takes the underground idols.

## Driving

Avenues (grid lines; `content/world3d/roads.yaml` as each district is built): the outer ring road (row 3,
col 9, col 41, and Kaigan-dōri on row 18), crosstown avenues on rows 6, 10 and 13 across the river, radials on
cols 21 and 31 from the ring to the harbour front, col 24 south under the harbour radial.

Expressway (`content/world3d/expressway.yaml`, to become a network of routes):

- C1 inner loop, as built: [21, 10] – [31, 13].
- Route 4, the Kurokami radial: from C1's north-west corner north along col 21 to row 3, then west to the
  Kurokami tunnel at [9, 3].
- Route 1, the harbour radial: col 24 from C1's south side down to the Wangan (row 22).
- Wangan: along the port a block in from the seawall (row 21, over Wangan-dōro: ramps need a street under
  them), from the airport branch (col 8) to the Yūnagi tunnel at the east headland; Ebisu-jima PA on its
  island; a suspension bridge branch (col 28) to Shiomi-jima. Route 1 and the Wangan are two-way (a deck each
  way).

The pass tunnels move: Kurokami to the end of route 4, Yūnagi to the east end of the Wangan.

Rail: the Toto Line extends north to Gakuenzaka and south to the port (col 26); the elevated Kawabata Line
runs east along row 11 through Denkō-chō and over the river; a monorail runs along the port to the airport.

## Homes

Characters: the detective (Kawabata), the salaryman (Nishihara danchi), the CEO (The Peak, built), the idol
manager (Denkō-chō), the idol dorm (by Stella Production), the teacher (Sakuragaoka), Mama-san (above Bar
Kanpai, built). The MC's housing ladder: 1 capsule hotel / net café (Kaburo), 2 six-tatami apāto
(Sakuragaoka), 3 one-room flat (Kasumi-chō), 4 larger flat with a doorman (Suidō-chō), 5 tower apartment
(harbour towers), 6 house on the heights (Takanodai). Better homes come with parking bays (more cars).

## Edges

South: the bay to the horizon, ships, the airport; the seawall and quays stop cars. East: the river mouth, the
beach, the headland the Wangan tunnels into. North and west: wooded hills beyond the outer ring road,
mountains on the horizon (a Fuji-like peak to the west). Past the last block: a band of low suburb masses
fading into haze. Every road out ends somewhere real (a pass tunnel, the airport, the island bridge).

## Elevation

The core stays flat. Three outer places get height in steps (each block flat at its own height, streets ramping
between; slopes and stairs): Takanodai heights, Gakuenzaka's slope, Kawabata's temple rise. After the harbour.

## Build order

Progress: L0 v2 and the groundwork are in; Kasumi-chō and the port's streets and warehouses are generated, with
the sea; route 1 and the Wangan are built (two-way, ramps into the port); next the port's set pieces and islands.

1. The plan (this; L0 v2 in place).
2. Groundwork: the lightmap in tiles, routing on the road network, traffic generated from the streets, the
   expressway as a network of routes; saves and per-character state.
3. The harbour and the Wangan (port, fish market, disco, Ebisu-jima PA, the bridge, Shiomi-jima).
4. Denkō-chō. 5. Gakuenzaka and Dome City. 6. Kawabata. 7. The residential rings, homes, the edges.
