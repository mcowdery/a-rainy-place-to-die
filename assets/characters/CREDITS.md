# Character credits

The characters here are built by `scripts/blender/build_character.py` from the definitions in
`scripts/blender/characters/`, with MPFB (MakeHuman for Blender) and MakeHuman community assets.
Everything used is CC0 (no attribution required, credited anyway). Nothing CC-BY is used.

The assets were installed into MPFB's user data dir from the community asset packs at
https://static.makehumancommunity.org/assets/assetpacks.html (zips from
`https://files.makehumancommunity.org/asset_packs/<pack>/<pack>_cc0.zip`). The pack lists
(`packs/<pack>.json`) and each asset's page in the repository give the licence below.

## All characters

| What | Source | Author | Licence |
| --- | --- | --- | --- |
| Base mesh (hm08), macro and face targets | MPFB 2.0.17 data (`data/3dobjs/base.obj`, `data/targets/`) | MakeHuman team (Data Collection AB, Joel Palmius, Jonas Hauquier) | CC0 (released September 2020, per the file headers) |
| `game_engine` rig and its skin weights | MPFB 2.0.17 data (`data/rigs/standard/rig.game_engine.json`, `weights.game_engine.json`) | MakeHuman / MPFB team | weights file: CC0; the rig file has no licence header |
| Eyes `high-poly`, eye material `brown` | makehuman_system_assets pack, http://www.makehumancommunity.org | makehuman_system | CC0 |
| Eyelashes `eyelashes01`, `eyelashes02` | makehuman_system_assets pack | makehuman_system | CC0 |

MPFB itself (the Blender add-on's code) is GPL-3.0-or-later. It's a build tool and none of its
code is shipped in the GLBs.

## Salaryman (`salaryman.glb`)

| What | Asset | Source | Author | Licence |
| --- | --- | --- | --- | --- |
| Skin | `middleage_asian_male` (recoloured, smoothed) | makehuman_system_assets | makehuman_system | CC0 |
| Eyebrows | `eyebrow009` | makehuman_system_assets | makehuman_system | CC0 |
| Hair | `short02` (recoloured near-black) | makehuman_system_assets | makehuman_system | CC0 |
| Suit, shirt, tie | `male_elegantsuit01` (recoloured navy, tie darkened) | makehuman_system_assets | makehuman_system | CC0 |
| Shoes | `shoes04` | makehuman_system_assets | makehuman_system | CC0 |

## Maid (`maid.glb`)

| What | Asset | Source | Author | Licence |
| --- | --- | --- | --- | --- |
| Skin | `young_asian_female` (graded, smoothed) | makehuman_system_assets | makehuman_system | CC0 |
| Eyebrows | `eyebrow001` | makehuman_system_assets | makehuman_system | CC0 |
| Hair | `toigo_blunt_bob_with_bangs` (recoloured dark brown) | hair01 pack, http://www.makehumancommunity.org/node/1681 | MargaretToigo (MRT) | CC0 |
| Dress bodice | `wdg_mycenaean_tunic` (recoloured black, cut at the hip) | dress01 pack, http://www.makehumancommunity.org/node/1763 | WDG | CC0, see note |
| Skirt | `toigo_skirt_with_lace_ruffle` (recoloured black) | skirts01 pack, http://www.makehumancommunity.org/node/1731 | MargaretToigo (MRT) | CC0 |
| Stockings | `marco_105_stocking01` (made opaque, recoloured black) | underwear01 pack, http://www.makehumancommunity.org/node/348 | Marco_105 (FGH) | CC0, see note |
| Shoes | `toigo_mj_cloth_shoes` (Mary Janes, recoloured black) | shoes01 pack, http://www.makehumancommunity.org/node/1700 | MargaretToigo (MRT) | CC0 |
| Apron, headband (katyusha) | modelled for this project in `scripts/blender/garments.py` | this repository | this project | ours |

**Note:** the `.mhclo` and `.obj` files of `wdg_mycenaean_tunic` and `marco_105_stocking01`
still carry MakeClothes' default export header `# license AGPL3 (see also
http://www.makehuman.org/doc/node/external_tools_license.html)`. Both assets' pages in the
MakeHuman asset repository (nodes 1763 and 348), and the dress01 and underwear01 pack lists,
give **CC0**. That is the licence their authors chose when they published them. The header is
the tool's template, written before the author picked a licence. To avoid the ambiguity,
`v0rt3x_stockings_black_fishnet_small` (CC0 in its own header, by V0rT3X) can replace the
stockings. It was tried, but those stockings show through the shoes.

## Julie (`julie.glb`)

Julie is a synthetic singer, not a real person. Her likeness is matched to the project's own
MIDNIGHT PLASTIC album art (`assets/ads/source/25_julie_album.png`, `26_julie_album.png`). That
art was used only as a reference to compare renders against; none of it is in the GLB.

| What | Asset | Source | Author | Licence |
| --- | --- | --- | --- | --- |
| Skin | `young_asian_female` (graded cooler and fairer, smoothed; makeup painted in by the build: lip tint, blush, eyeshadow, liner, a beauty mark) | makehuman_system_assets | makehuman_system | CC0 |
| Eyebrows | `eyebrow009` | makehuman_system_assets | makehuman_system | CC0 |
| Hair (the long base) | `long01` (recoloured near-black, pushed out for volume) | makehuman_system_assets | makehuman_system | CC0 |
| Jacket | `male_casualsuit05`, the jacket only (the inner shirt and jeans removed; recoloured pink and mint; satin sheen) | makehuman_system_assets | makehuman_system | CC0 |
| Tee, jeans, belt | `female_casualsuit01` (the tee recoloured white and tucked in; a belt painted on the waistband) | makehuman_system_assets | makehuman_system | CC0 |
| Sneakers | `shoes05` | makehuman_system_assets | makehuman_system | CC0 |
| Fringe and side locks | alpha-card hair and its strand texture, generated for this project in `scripts/blender/garments.py` | this repository | this project | ours |
| Face shape beyond the MakeHuman targets | a shape key generated by `sculpt()` in `scripts/blender/build_character.py` | this repository | this project | ours |
