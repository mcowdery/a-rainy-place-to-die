# Kaburo (Neon Core): district plan

Direction (2026-09-25): Kaburo should feel dense, vibrant and lived-in, not sparse. Exploring it should keep turning up new things to look at. This plan is for the next district update. Nothing here is built yet except the generic streets and the ads already wired in.

## Zones

**Built (2026-09-26):** Kaburo is now district-sized (6×4 cells, 768×512 m) with the six zones below in `content/world3d/zones.yaml` (planner, building look, storefronts, signs and ads per zone). Still to do per zone: props (lanterns, touts, vending clusters) and hand-made set pieces.

The district stays procedurally generated, but zones steer what each block gets: building mix, signage, ad pool and props. Hand-built stamps mark the primary areas.

| Zone | Feel | Businesses / signage | Ad pool |
|---|---|---|---|
| **Central crossing** (primary area) | Kaburo's front door: widest boulevard, scramble crossing, crowds | Mega-sign building, big chains, konbini on corners, pachinko, arcade | Mega-sign screens, soft drinks, cosmetics, idols, whisky |
| **Love District** | Quieter, sloped side streets, discreet entrances, rate boards | Love hotels (Rouge, Venus, Aqua, Orient Express, Sakura, Mirage), 無料案内所 | Explicit love-hotel ads, information-centre lightboxes |
| **Host & hostess street** | Glitzy, gold and pink, touts outside | Host clubs (Adonis, Prince), kyabakura (Moonlight), snack bars | Host boards, hostess glamour, champagne |
| **Back alleys** (noir) | Narrow, wet, dim, wires overhead, a lot of story | Pawn shop (Maruyoshi), quick cash (Cash One), mahjong, esthe, the Ryujin Kogyo front office | Loan and pawn posters, wanted notices, missing-person flyers |
| **Music & food lane** | Warm, busy, smells good | Live house (地下室, basement stairs), izakaya, ramen, yakitori, karaoke, maid café, record shop | Gig posters, food, maid café, album posters |
| **Station edge** | Commuters, last trains, net cafés | Net café, capsule hotel, konbini, 24h ramen | Konbini promos, capsule and net café, election posters |

## Primary areas and event buildings

These are hand-authored stamps with interiors or VN hooks, placed on L0 cells like Bar Kanpai. They get more detail than the generated blocks.

- **Bar Kanpai** (exists): Mama-san and the detective.
- **Kirishima Investigations**: the detective agency's office up a narrow stairwell (taxi ad B, poster).
- **Kaburo Crossing / mega-sign building**: the landmark, see below.
- **Live house 地下室**: basement venue with a lit stairwell and gig posters; a natural event location. **Built (2026-09-26)**: walk down into B1 (Julie's MIDNIGHT PLASTIC release show on stage; a hotspot for the VN).
- **Maid café ♡ぴゅあ♡**: upstairs café with a street tout.
- **Hotel Rouge**: the flagship love hotel in the Love District, with a hidden side entrance. **Built (2026-09-26)** as a castle love hotel.
- **Maruyoshi pawn shop**: the noir hub (items, information).
- **Ryujin Kogyo office**: the yakuza front company, a story antagonist hook. **Built (2026-09-26)** on Host Street: granite block, gated forecourt, black sedans, CCTV, gold 竜 crest, guards; door to the VN.
- **Koban (police box)**: wanted notices; story source.
- **Hoshikuzu Yokocho 星屑横丁**: **built (2026-09-26)**, a Golden Gai-style bar alley in the back alleys; BAR 黒猫 (door to VN) and its mama-san outside are a story hook.
- **Konbini (Yoru Mart)**: several copies; a save/rest point or recurring hangout. **Built (2026-09-26):** one you can walk into, on the crossing's south-east corner.
- **Kaburo Inari shrine**: **built (2026-09-26)** in the back alleys: torii tunnel, fox guardians, lanterns, hall, an offering box hotspot.

## The mega-sign (landmark)

Recommended. A corner building on the central crossing, wrapped in a stack of three to four giant screens that cycle between ads with a crossfade (content: `kaburo-megasign-01`). On the roof sits a giant 3D sculpture that becomes Kaburo's visual shorthand, like Kabukichō's Godzilla head. Candidates:
- a giant **neon dragon** coiled around the rooftop (ties to Ryujin Kogyo, 竜神);
- a huge **maneki-neko** with a slowly waving, glowing paw;
- a giant **tanuki** in a salaryman suit (humour, very Kaburo).

It should be visible from most of the district, and it's the natural spawn view.

**Built (2026-09-26):** the mega-sign stands on the north-east corner of the junction at cells [29–30, 11–12], with an open square (Hachikō-style) on the south-west corner where the district now starts, Yoru Mart on the south-east corner, and a scramble crossing where four boulevards meet. The north-west corner is 激安の殿堂 ヤスイチ, a discount megastore (Kabukichō's Don Quijote), with 牛丼 たつ屋 and ミドリ薬局 along its side.

**Decision (2026-09-26): the neon dragon.** A long serpentine Japanese dragon in pink and cyan neon tubing, coiled around the rooftop edge with its head rising over the crossing, facing the main approach. Its body pulses in a slow wave along the tubes. It ties the landmark to Ryujin Kogyo (竜神, dragon god), whose office should be nearby, so the district's symbol quietly belongs to the people who run it. It reads as a clear silhouette against the sky at any distance. Screen content: approved art 49–52, 64, 65 and 80.

## More ideas

- Street touts and flyer handers (ghost NPCs) outside host clubs and maid cafés.
- Vending-machine clusters with lit product panels; cigarette machines.
- Pachinko-parlour exteriors with flashing marquee bulbs.
- A shrine squeezed between buildings (a quiet contrast, and a story spot).
- Train overpass at the station edge (ads on the girders, a rumble overhead).
- Missing-person flyers taped to poles, tied to taxi ad C.
- A second mega-screen, smaller, on the host street.
