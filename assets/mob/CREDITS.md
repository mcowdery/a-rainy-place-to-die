# Mob models: where they came from

The figures here are the mob's modelled generation, under review on the MakeHuman test page, `humans.html`
(`mob.html` until 2026-10-06; none is in the district yet). Each
is a MakeHuman body built with MPFB (`scripts/blender/mpfb_base.py`), then converted by
`scripts/blender/mob_from_model.py`: the face blanked and sealed, cut to about 3,200 triangles, re-bound to the
mob's skeleton. `scripts/blender/mob_figures.json` lists every figure with its body, hair and clothes;
`python scripts/blender/mob_figures.py` rebuilds them.

## The figures

| Prefix | What | From |
|---|---|---|
| `mhbody_*` | ten body types, nude | hand-written entries in the list |
| `mw_*`, `mm_*` | women and men of different ages and builds, dressed | generated (`mob_figures_generate.py`, seeded) |
| `ms_*` | students | generated |
| `mk_*` | children | generated |

All are built as Japanese: MakeHuman's Asian body and the Asian skins.

## The assets (all CC0)

Every hair and clothing asset is from MakeHuman's CC0 asset packs
(https://static.makehumancommunity.org/assets/assetpacks.html), installed in MPFB's data folder. An asset's folder
name starts with its author where it has one (`toigo_…` Margaret Toigo, `elvs_…` Elvaerwyn, `cortu_…`,
`culturalibre_…`, `joepal_…`, `mindfront_…`, `frankyaye_…`, `wolgade_…`, `namuhekam_…`, `rehmanpolanski_…`,
`o4saken_…`, `littleright_…`, `kwnet_…`, `marco_105_…`); the ones without (`short01`, `male_casualsuit01`, `shoes01`
…) are MakeHuman's own system assets.

Packs: MakeHuman system assets, Hair 01, Dress 01, Skirts 01, Shoes 01, Hats 01, Underwear 01 (installed before);
Shirts 01, Pants 01 and Suits 01 (added 2026-10-04; the zips are in `Documents/proj/makehuman_packs`). CC0 asks no
credit; this file is the record of what was used.

No CC-BY pack is installed. MakeHuman also offers CC-BY packs (more shirts, pants, skirts, shoes, hair): using one
would mean crediting its authors here and in the game.

## Tried and turned down

- **Microsoft Rocketbox** (MIT): seven avatars were converted on 2026-10-04 and removed the same day at the user's
  word: they all look Western, and a realistic figure here has to look Japanese.
- **VRoid Studio exports** (anime): four figures made from the user's exports of VRoid's bundled AvatarSample_A were
  converted the same day, then set aside when the user chose MakeHuman. Their licence was never confirmed. The
  converter still reads VRM.
- Three garments came through the triangle cut in shards and are left out: a qipao (`elvs_fashion_stylized_qipoa`),
  `cortu_cargo_pants` and `toigo_tiered_mini_skirt`.
