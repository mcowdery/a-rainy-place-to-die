# The textured crowd: where it came from

The figures here are the MakeHuman test page's crowd (`humans.html`; none is in the district). Each is one of the
dressed figures listed in `scripts/blender/mob_figures.json`, built textured by `scripts/blender/human_figures.py`
through the cast's pipeline (`build_character.py`): a MakeHuman body made with MPFB on the `game_engine` rig, the
Asian skin for its age, a hair asset recoloured black, dark brown or grey, clothes as their assets come.

They are the same bodies, hair and clothes as the mob's converted figures, so the assets and their licences are the
ones recorded in `assets/mob/CREDITS.md` (MakeHuman's CC0 asset packs; nothing CC-BY), with the base mesh, rig,
skins, eyes, brows and lashes as in `assets/characters/CREDITS.md`. The note there on MakeClothes files whose
headers still say AGPL3 though their pages say CC0 applies to `marco_105_stocking01` here too.

## The women made by hand (`bijin_*.glb`)

Five figures built by `scripts/blender/human_bijin.py` (humans.md), from the same MakeHuman CC0 packs. Checked
2026-10-06 in each asset's own files and in the pack lists MPFB keeps (`data/packs/*.json`):

| Figure | Hair | Clothes |
| --- | --- | --- |
| `bijin_office` | `toigo_curled_under_bob` | `toigo_female_suit`, `toigo_stiletto_booties` |
| `bijin_club` | `long01` | `toigo_halter_dress_midi`, `toigo_stiletto_booties` |
| `bijin_casual` | `toigo_blunt_bob_with_bangs` | `toigo_fisherman_sweater`, `toigo_skirt_with_lace_ruffle`, `toigo_lace_frill_socks`, `toigo_mj_cloth_shoes` |
| `bijin_elegant` | `rehmanpolanski_hair_bun_brown` | `toigo_shift_dress`, `marco_105_stocking01`, `toigo_stiletto_booties` |
| `bijin_ponytail` | `ponytail01` | `female_casualsuit01`, `shoes05` |

All share the skin `young_asian_female`, the eyes `high-poly`, the lashes `eyelashes02` and the teeth `teeth_base`
(MakeHuman system assets, CC0); the eyebrows and makeup are painted by the build. `bijin_elegant` and
`bijin_ponytail` also wear the fringe of a second hair asset (`toigo_blunt_bob_with_bangs`,
`toigo_curled_under_bob_with_bangs`: `license CC0` in their files). Their expressions are mixed from the expression
targets that come with MPFB itself (`data/targets/expression/units/asian/`). The add-on's code is GPL; of the
assets it bundles (the base mesh, the targets, the rigs) its licence file says: "These assets have been released
under CC0 1.0 Universal", and of what's made with them: "there is no limitation on what you can do with this
combined output" (https://github.com/makehumancommunity/mpfb2/blob/master/LICENSE.md, read 2026-10-06). Everything is recoloured, cut down in triangles and, for the
tee, has MakeHuman's logo painted out.

- The `toigo_*` assets (Margaret Toigo) say `license CC0` in their own files. The system assets (`long01`,
  `ponytail01`, `female_casualsuit01`, `shoes05`, the skin, eyes and lashes) carry MakeHuman's own notice: "This asset
  was explicitly released as CC0 in september 2020."
- **Two say two things**: the files of `rehmanpolanski_hair_bun_brown` and `marco_105_stocking01` carry MakeClothes'
  default export header `license AGPL3`, while their pack entries give CC0 (the bun: hair01 pack, by RehmanPolanski,
  http://www.makehumancommunity.org/node/2477, "adapted from the MH Ponytail01"; the stockings as noted in
  `assets/characters/CREDITS.md`). Fine for a test page that no edition ships; **before either goes into a build the
  user decides**, or they are swapped for an asset whose own files say CC0.
- Dropped for that reason: `culturalibre_hair_01` (AGPL3 in its files; its pack entry says CC0 but describes it as
  "Female hair from an old Makehuman assets 2015", author unknown). The hostess has `long01` instead.
