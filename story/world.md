# The world

Tōto as the story sees it. For how the city is built, see [docs/city-plan.md](../docs/city-plan.md) and
CLAUDE.md; this file is about what each place means to the story.

The **story nodes** under each district are every npc, story door and hotspot in the city today: the places
a scene can start. `npm run vn:keys` prints the live list (and each node's scene, if it has one).
Walk-through doors and spawns aren't listed; spawns are where a scene can send you (`exit:`).

## 東都 Tōto

A coastal capital on a bay, about 4.7 × 3.3 km of city: two cores (Kaburo's neon and Asagiri's towers) ringed by
newer districts, then homes and the old town, then hills to the north and west and the bay to the south.
The river 隅川 Sumikawa runs down from the northern hills to the bay, with the old town across it. The Toto
Line, the Kawabata Line, the monorail, two subway lines and the Seikō Line join it up; the Tōto Expressway
loops over the core and runs out along the port. The last train leaves at 00:40.

**Open:** what's wrong with the city (who really runs it, what everyone knows and nobody says).

## 歌舞路 Kaburo: the neon core

After Kabukichō. The crossing and the mega-sign, Host Street, the Love District, the back alleys, the food lane,
the station edge. Where the story starts: the MC's bed is a manga café booth here.

- Bar Kanpai: a small snack bar.
- Hotel Rouge: the castle love hotel, the Love District's flagship. Walk-in: lobby, room panel, themed rooms;
  the Rouge Suite (303) is a story door.
- Hoshikuzu Yokocho: forty tiny bars along narrow alleys; BAR 黒猫 Kuroneko and its mama.
- Ryujin Kogyo: the yakuza front company whose dragon crowns the mega-sign.
- LIVE HOUSE 地下室: the basement venue where the underground idols play.
- Manga Café Tsukiyo: 24 hours; booth 17 is the MC's (the first rung of the housing ladder).
- Yotaka Garage: the MC's rented unit in a railway arch by the Toto Line, where the car lives.
- 歌舞路交番 Kaburo Kōban: the police box at the back of the square across the crossing from the mega-sign, a
  clock tower on its corner, the wanted posters on its side wall; the young officer of spring's "Papers" stands
  guard at its door. Walk-in: the front room, the counter and its bell.
- キャッシュ・ワン Cash One and 質 マルヨシ Maruyoshi: one mixed-tenant building in the back alleys. The pawn shop at
  street level (the noir hub: things, and what people know); a mahjong parlour, 雀荘 東風荘, on the second floor;
  Cash One's office on the third, up a narrow stair from its own street door, where Mack pays every Monday. Its
  sign is on the roof. (Where the office is, and Maruyoshi under it, was placed with the build: say so if the
  story wants them elsewhere.)

| Node | Kind | Name | Scene |
|---|---|---|---|
| `bar_kanpai.mama` | npc | Mama-san (the bar's mama) | s90, a VN prototype kept as an example (not canon) |
| `bar_kanpai.door` | door | Bar Kanpai | — |
| `hotel_rouge.room_303` | door | Room 303 · Rouge Suite | — |
| `yokocho.kuroneko` | door | BAR 黒猫 | — |
| `yokocho.mama` | npc | Kuroneko's mama | — |
| `ryujin_kogyo.door` | door | Ryujin Kogyo | — |
| `ryujin_kogyo.guard` | npc | Man in a dark suit | — |
| `live_house.show` | hotspot | Julie's show | — |
| `kaburo_inari.offering` | hotspot | Offering box | — |
| `yoru_mart.clerk` | npc | Clerk | — |
| `tsukiyo.booth_17` | hotspot | Booth 17 (yours) | — |
| `tsukiyo.sleep` | hotspot | Booth 17 (sleep until morning) | — |
| `tsukiyo.clerk` | npc | The night clerk | — |
| `city_garage.door` | door | Your garage (opens the garage screen) | — |
| `koban.officer` | npc | The officer at the kōban door | — |
| `koban.wanted` | hotspot | 指名手配 (the wanted posters) | — |
| `koban.counter` | hotspot | The counter (ring the bell) | — |
| `cash_one.collector` | npc | A Cash One collector (at the counter, 3F) | — |
| `cash_one.payment` | hotspot | Cash One's counter (Monday's payment) | — |
| `cash_one.pawnbroker` | npc | The pawnbroker (質 マルヨシ) | — |
| `cash_one.pawn_case` | hotspot | The display case (watches, rings) | — |
| `cash_one.mahjong` | door | 雀荘 東風荘 (2F) | — |

## 朝霧 Asagiri: towers and the terminal

After West Shinjuku. Skyscrapers, the terminal station 東都中央 Tōto-Chūō and its department store, the west
exit's bus rotary, Omoide Lane, Central Park. Money and the law.

- Stella Production: the idol agency. Glamour out front; a staff entrance, a black van and a car-park ramp
  round the side.
- The Peak: a luxury tower crowned by the CEO's penthouse.
- Police HQ, Club Shirasagi (members only), the bank, the law firm, Hakkodo the ad agency, City Hall.

| Node | Kind | Name | Scene |
|---|---|---|---|
| `stella_production.lobby` | door | Stella Production (lobby) | — |
| `stella_production.staff_door` | door | Staff entrance 関係者口 | — |
| `stella_production.security` | npc | Security guard | — |
| `the_peak.ceo` | npc | The CEO (on the penthouse terrace) | — |
| `the_peak.concierge` | npc | Concierge | — |
| `police_hq.entrance` | door | Police HQ 警視庁 | — |
| `police_hq.officer` | npc | Duty officer | — |
| `club_shirasagi.entrance` | door | Club Shirasagi · Members only | — |

## 桜ヶ丘 Sakuragaoka: houses and a shopping street

Residential, west of Asagiri on the Seikō Line. Houses, マンション, Sakuragaoka Ginza, Sakura-yu the sentō.

- Kōpo Sakura: the teacher's 102 downstairs, and 203 upstairs, the MC's first proper room (the ladder's second rung).
- The Stella dorm: the idols come home here, across the avenue from the agency.
- Sakuragaoka Junior High.

| Node | Kind | Name | Scene |
|---|---|---|---|
| `kopo_sakura.tests` | hotspot | The tests to mark (the teacher's) | — |
| `kopo_sakura.mc_sleep` | hotspot | The futon (the MC's, sleep) | — |
| `kopo_sakura.mailbox` | hotspot | The mailboxes | — |
| `stella_dorm.rules` | hotspot | The dorm rules | — |
| `stella_dorm.sofa` | hotspot | The girls on the sofa | — |
| `school_1.entrance` | door | School entrance 昇降口 | — |
| `school_1.staff` | npc | Teacher on gate duty | — |

## 電光町 Denkō-chō: the electric town

After Akihabara. Denkō-dōri's sign-covered towers, parts shops, maid café lanes. The otaku district: anime,
manga, eroge, cosplay and hentai culture. Opens in summer, the season of the conventions.

| Node | Kind | Name | Scene |
|---|---|---|---|
| `idol_theatre.lift` | door | Theatre lift to 8F (STELLA THEATER) | — |
| `idol_theatre.flyer` | npc | Maid handing out flyers | — |
| `maid_cafe.tout` | npc | Maid handing out flyers (めいどかふぇ ♡ぴゅあ♡, on the pavement) | — |
| `maid_cafe.maid` | npc | The maid at the door (upstairs in the café) | — |
| `maid_cafe.menu` | hotspot | The menu (萌え萌えオムライス) | — |
| `game_tower.crane` | hotspot | The crane game | — |
| `game_tower.regular` | npc | Arcade regular | — |
| `manager_flat.schedule` | hotspot | The girls' week (the idol manager's whiteboard) | — |
| `manager_flat.laptop` | hotspot | The laptop (mail from the agency) | — |

## 学園坂 Gakuenzaka and 水道町 Suidō-chō: the north

Tōto University on its slope, the student town below; Dome City and its flats.

| Node | Kind | Name | Scene |
|---|---|---|---|
| `university.hall` | door | The lecture hall 大講堂 | — |
| `university.student` | npc | Student on the steps | — |
| `school_2.entrance` | door | School entrance (University High) | — |
| `school_2.staff` | npc | PE teacher | — |
| `dome.gate` | door | TŌTO DOME Gate 22 | — |
| `dome.staff` | npc | Dome staff with a megaphone | — |
| `wonderland.gate` | door | Suidō Wonderland ticket gate | — |

## 鷹ノ台 Takanodai: the heights

Big houses behind hedges, the summit woods, the lookout over the city. Where the MC ends up if the ladder goes
all the way.

| Node | Kind | Name | Scene |
|---|---|---|---|
| `takanodai_villa.front_door` | door | The house on the heights (for sale) | — |
| `takanodai_lookout.telescope` | hotspot | The coin telescope | — |
| `takanoyu.genkan` | door | Ryokan Taka-no-yu's genkan | — |
| `takanoyu.okami` | npc | The okami at the gate | — |
| `flood_shaft.shaft_door` | door | Flood tunnel shaft 3: the steel door (立入禁止) | — |

## 西原 Nishihara: the western suburbs

Houses, danchi estates, a shōtengai, the city's edge. Nishihara Dreamland, closed for years, with a gap in the
fence.

| Node | Kind | Name | Scene |
|---|---|---|---|
| `nishihara_danchi.altar` | hotspot | The family photo (the salaryman's) | — |
| `nishihara_danchi.balcony` | hotspot | A cigarette on the balcony | — |
| `nishihara_danchi.bench` | npc | Old man on the bench | — |
| `dreamland.chained_gate` | hotspot | The chained gate | — |
| `dreamland.wheel` | hotspot | Under the rusted wheel | — |

## 川端 Kawabata: the old town across the river

Wooden houses and apāto on narrow lanes, the temple quarter, Tōto Tower, the riverside. Old money and old
loyalties.

- Kōpo Kawabata: the detective's room 201, with the case board.
- **To build: a church**, with an interior you can walk into. **Proposed:** a small Catholic church in the old
  town, near Tōkō-ji and Mack's office: pews, candles, a stained-glass window, a confessional (noir needs a
  confessional). Japan's Catholics go back to the hidden Christians. How it's used in the story stays subtle.
- The Rindō-gumi's family house: the gate with the crest lanterns.

| Node | Kind | Name | Scene |
|---|---|---|---|
| `kopo.case_board` | hotspot | The case board (the detective's) | — |
| `kopo.mailbox` | hotspot | The mailboxes | — |
| `rindo.gate` | door | The Rindō-gumi's gate | — |
| `rindo.guard` | npc | Young man at the gate | — |
| `tokoji.hall` | hotspot | Pray at the main hall | — |
| `tokoji.omikuji` | hotspot | Omikuji (fortunes) | — |
| `tokoji.monk` | npc | Monk sweeping the steps | — |
| `toto_tower.lift` | door | Tower lift to the main deck | — |
| `riverside.yatai` | npc | Oden stall keeper | — |
| `riverside.boat` | hotspot | The houseboat | — |

## 東都港 Tōto Port and the islands

Warehouses, the container terminal, the fish market, warehouse nightlife; over the bridges, Shiomi-jima's TV
station, wheel and hall, Ebisu-jima's car meets, and the airport on Hanejima.

| Node | Kind | Name | Scene |
|---|---|---|---|
| `juliet.door` | door | JULIET BAYSIDE (the disco) | — |
| `juliet.doorman` | npc | Doorman | — |
| `speed_lab.mechanic` | npc | Mechanic (SPEED LAB) | — |
| `fish_market.auction` | hotspot | The tuna auction | — |
| `ferry_terminal.gate` | door | Ferry boarding gate | — |
| `tv_station.lobby` | door | TŌTO TV lobby | — |
| `sky_wheel.boarding` | door | Sky Wheel boarding | — |
| `bay_hall.door` | door | TŌTO BAY HALL | — |
| `bay_hall.staff` | npc | Hall staff | — |
| `ebisu_pa.racer` | npc | Racer by the silver coupe (offers races) | — |
| `ebisu_pa.vending` | hotspot | Vending machines | — |
| `airport.check_in` | door | Check-in | — |

## 霞町 Kasumi-chō: south of the core

Mid-rise homes, offices, a shopping street, a park. Planned story places still to build: the fire station, the
batting centre, the MC's one-room flat (ladder rung 3).

- 霞町霊園 Kasumi Reien (**Proposed:** the name), the cemetery avenue, on Kasumi-dōri in the park's quarter: a walled
  cemetery, a paved avenue under cherry trees from its stone gate to a large family plot at the far end, blocks of
  family graves either side; the flower and incense shop and the water station by the gate; in the far corner the
  mound of stones nobody tends (無縁塚). Autumn opens here at higan. Whose the family plot is, the city doesn't
  say (no name is carved on it).
- The redevelopment site (霞町一丁目地区再開発; the board calls the tower KASUMI GATE TOWER and names no
  developer: that's **Open** in factions.md), on Kasumi-dōri: hoardings, a gate with a guard, site offices, a
  crane, and a shored pit you look down into. At its bottom a corner is fenced off under blue tarps behind a
  notice, 埋蔵文化財 調査中 立入禁止 (a cultural-property survey, the city's board of education): the sealing of
  mythos.md. What's under the tarps is never shown by the city.

- 霞町総合病院 Kasumi General Hospital (**Proposed:** the name, given with the build), on Kasumi-dōri under the
  monorail: autumn's hospital. Walk-in: the lobby; elevators up to the ward on 5F (the nurse station, the day
  room, room 501 at the corridor's end, the private room) and down to B1 (the morgue, and at the corridor's end a
  steel door to B2, authorised personnel only). What is behind that door is the story's (autumn, chapter 3); the
  city only has the door.

| Node | Kind | Name | Scene |
|---|---|---|---|
| `hospital.reception` | npc | The receptionist | — |
| `hospital.nurse` | npc | The nurse at the station (5F) | — |
| `hospital.room_501` | door | Room 501 · 特別室 (the private room) | — |
| `hospital.morgue` | hotspot | 霊安室 (the morgue, B1) | — |
| `hospital.sealed` | door | The steel door (B2 · authorised personnel only) | — |
| `hospital.emergency` | door | 救急入口 (the emergency entrance) | — |
| `reien.flower_seller` | npc | The flower seller (by the cemetery gate) | — |
| `reien.water` | hotspot | 水汲み場 (buckets and ladles) | — |
| `reien.family_grave` | hotspot | The family grave at the avenue's end | — |
| `reien.muenzuka` | hotspot | 無縁塚 (the stones nobody tends) | — |
| `kasumi_site.guard` | npc | The gate guard | — |
| `kasumi_site.notice` | hotspot | 建築計画のお知らせ (the planning notice) | — |
| `kasumi_site.pit` | hotspot | The excavation (blue tarps at the bottom) | — |
| `kasumi_site.office` | door | 現場事務所 (the site office) | — |

## Open

- **Open:** which places the first chapter uses, and which wait for later chapters.
- Maruyoshi the pawn shop and the kōban, Kaburo's planned story sources, are built (`cash_one`, `koban`).
