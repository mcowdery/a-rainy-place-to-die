# Manila's crowd: the Filipino outfits, under review

Not read by the game (only `.yaml` and `.txt` files in this folder are). The zones' `people:` lists are as they were: nothing unreviewed ships by accident.

## What is waiting for the user's word

Seven new outfits (`district/peopleMix.ts` `OUTFITS`, drawn by `real/mobShape.ts`), shown in the mob showroom's **filipino (under review)** stages (`mob.html`, press the stage's name in the list, or `__focus('filipino (under review)')`; `node debug-shots/outfitshots.mjs <dir> "lift=3" filipino` photographs them):

- `pinoy_school` (teen-sized like `school`; children too): a white short-sleeved blouse, a dark blue skirt (girls) or trousers (boys), a red neckerchief (girls and children) or tie (boys), white socks, a brown rucksack. Not the sailor suit.
- `baller`: a sleeveless basketball jersey with a number block, in the figure's own colour, over long baggy shorts, tsinelas. Men and women.
- `barong`: the barong tagalog, a pale long untucked shirt with embroidered panels each side of the placket, dark trousers. Men and elders; the office and politician types.
- `vendor`: a T-shirt, a pale waist apron, a towel on the neck with one end hanging, tsinelas, and the **salakot** (a wide conical straw hat) when the hair is `hat` (the crowd gives vendors `hat` about half the time). Men, women and elders.
- `jeep_crew`: the jeepney's driver or barker: a sleeveless shirt, a towel on the neck with both ends hanging, a fare pouch on the belt, tsinelas. Men.
- `trike_driver`: a polo shirt and a cap, tsinelas. Men.
- `guard`: a private security guard: blue-grey short-sleeved shirt, black belt, dark trousers, a peaked cap, a holstered pistol on the right hip, or (bareheaded kinds of hair: `none`, `bob`, `hat`, `ponytail`) a pump shotgun carried low in the right hand. Men and women.

Tsinelas are a new footwear, `flipflop` (a thin sole, the bare foot, one dusty-blue strap).

## Turning them on, once the user approves

```
node scripts/manilaPeople.mjs                 # says what it would change
node scripts/manilaPeople.mjs --apply         # writes the reviewed mixes into content/manila/zones/*.yaml
node scripts/manilaPeople.mjs --off --apply   # puts the original lists back
```

The script is the whole suggestion: its `MIXES` table has each of the twelve `people:` lines now in the zone files and the mix that would replace it. Edit the table for different weights, or approve only some of the outfits (delete them from the replacement lines) and run it. Reload the page (the chunk workers read the zone files at start).

## Cold-weather clothes in a tropical city

- **`long` (a trench coat or a long skirt, tan) is in every Manila zone's list at weight 2 to 5**, and nothing in `peopleHours.ts` keeps it out of the summer (`seasonsOf` gives it all four). That is the one coat in Manila's crowd; the table above cuts it to 0.3 (a long skirt now and then), keeping the weight in `plain`.
- **`puffer` (the down jacket) is in no Manila zone's list**, but a zone with no `people:` falls back to `DISTRICT_PEOPLE` for its district kind, which has it (`residential`, `oldtown`, `campus`, `electric`, `harbor`, `neon`, `tower`). It is worn in autumn and winter only (`seasonsOf`), and Manila's season is pinned to summer, so none is ever out; the share is only wasted placement. A zone that has no `people:` of its own would be better given one.
- Zones that fall back to `DISTRICT_PEOPLE` also get `school` (the Japanese sailor suit) and `otaku`, `maid`, `kimono`, `yukata` from the district's defaults (the old town and the electric quarter): they have no place in Manila either, so give those zones a `people:` before the review closes.
