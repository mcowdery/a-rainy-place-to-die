/**
 * Reading the tables in peopleDemographics.ts (pure: every pick is a number in [0, 1) from a hash the caller gives, so a
 * crowd stays a function of its seed and takes no number from the cell's own).
 */

import type { Body } from '../real/mobRig';
import {
  AGE_SHARE, BOSS_BUILD, BOSS_GREY, DEFAULT_PROFILE, DYE, DYE_NEVER, ELDER_MEN, ELDER_WOMEN, GREY_BY_AGE, MAN_BUILD_BY_AGE, MEN_CUT, MEN_CUT_LEFT_OUT,
  NATURAL_BROWN, NIGHT_TRADE, NIGHT_TRADE_PLACE, OLD_DARK_SHARE, OUTFIT_BUILD, PROFILE, WOMAN_BUILD_BY_AGE, type Age,
} from './peopleDemographics';

type Weights<K extends string> = Readonly<Partial<Record<K, number>>>;
type H = (a: number, b: number) => number;
const U = (seed: number, salt: number, hash: H): number => hash(seed, salt) / 4294967296;

/** The old and the teens and what else an outfit says about age: a multiplier on the age shares (1 where not named). */
export const OUTFIT_AGE: Readonly<Record<string, Weights<Age>>> = {
  kimono: { old: 2.5, middle: 1.8, young: 0.5 },
  hanten: { old: 2.5, middle: 1.6, young: 0.3 },
  jinbei: { old: 1.8, middle: 1.8, young: 0.6 },
  apron: { middle: 2, old: 1.5, young: 0.7 },
  boss: { middle: 4, old: 1.5, adult: 1, young: 0.1 },
  yakuza: { young: 1.6, adult: 1.6, middle: 1.2, old: 0.2 },
  chinpira: { young: 3, adult: 0.7, middle: 0.1, old: 0 },
  bosozoku: { young: 4, adult: 0.3, middle: 0, old: 0 },
  hood: { young: 3, adult: 0.6, middle: 0.1, old: 0 },
  maid: { young: 4, adult: 0.5, middle: 0, old: 0 },
  otaku: { young: 2.5, adult: 1.2, middle: 0.2, old: 0 },
  police: { young: 1.5, adult: 1.5, middle: 0.8, old: 0.05 },
  work: { adult: 1.4, middle: 1.4, young: 1, old: 0.2 },
  runner: { young: 2.5, adult: 1.5, middle: 0.5, old: 0.1 },
  nurse: { young: 1.8, adult: 1.5, middle: 0.8, old: 0 },
};
/** Outfits worn by teens (a school's, its sports clothes, a school gang's): always a teen, and never a build. */
export const TEEN_WEAR: readonly string[] = ['school', 'pinoy_school', 'track', 'gym', 'yankee'];
const HEAVY: readonly string[] = ['stout', 'portly', 'w_plump', 'w_heavy', 'e_stout', 'w_elder_plump'];

/** Which of `weights` by u in [0, 1); null if there are none. */
export function pickWeighted<K extends string>(weights: Weights<K>, u: number): K | null {
  let total = 0;
  for (const k in weights) total += weights[k] ?? 0;
  if (total <= 0) return null;
  let x = u * total;
  for (const k in weights) {
    x -= weights[k] ?? 0;
    if (x < 0) return k;
  }
  return null;
}

/** A figure's age band, from where it is (the district's profile) and what it wears. */
export function ageOf(outfit: string, district: string, seed: number, hash: H): Age {
  if (TEEN_WEAR.includes(outfit)) return 'teen';
  const p = PROFILE[district] ?? DEFAULT_PROFILE;
  const o = OUTFIT_AGE[outfit] ?? {};
  const w: Partial<Record<Age, number>> = {};
  for (const a of ['young', 'adult', 'middle', 'old'] as const) w[a] = AGE_SHARE[a] * (p.age[a] ?? 1) * (o[a] ?? 1);
  return pickWeighted(w, U(seed, 0xa6e, hash)) ?? 'adult';
}

/** The build of a body of this sex, age and outfit in this district; `man` or `woman` when none. */
export function buildFor(sex: 'man' | 'woman', outfit: string, age: Age, district: string, seed: number, hash: H): Body {
  const usual: Body = sex;
  if (age === 'old') {
    const w: Partial<Record<Body, number>> = { ...(sex === 'man' ? ELDER_MEN : ELDER_WOMEN) };
    w[sex === 'man' ? 'elder' : 'w_elder'] = 1 - Object.values(w).reduce((a, b) => a + (b ?? 0), 0);
    return pickWeighted<Body>(w, U(seed, 0xb11d, hash)) ?? usual;
  }
  if (age === 'teen' || TEEN_WEAR.includes(outfit)) return usual;
  const p = PROFILE[district] ?? DEFAULT_PROFILE;
  if (sex === 'man' && outfit === 'boss') {
    return pickWeighted<Body>({ ...BOSS_BUILD, man: 1 - (BOSS_BUILD.stout ?? 0) - (BOSS_BUILD.portly ?? 0) }, U(seed, 0xb11d, hash)) ?? usual;
  }
  const base = (sex === 'man' ? MAN_BUILD_BY_AGE : WOMAN_BUILD_BY_AGE)[age];
  const pull = OUTFIT_BUILD[outfit] ?? {};
  const w: Partial<Record<Body, number>> = {};
  let used = 0;
  for (const k in base) {
    const b = k as Body;
    used += base[b] ?? 0;
    w[b] = (base[b] ?? 0) * (pull[b] ?? 1) * (HEAVY.includes(b) ? p.fat : 1) * (b === 'bulky' ? p.big : 1);
  }
  // (An outfit that pulls a build the age has none of: a few, so a doorman is bulky at any age.)
  for (const k in pull) {
    const b = k as Body;
    if (w[b] === undefined && (pull[b] ?? 0) > 1 && (sex === 'man') === !b.startsWith('w_')) w[b] = 0.01 * (pull[b] ?? 0);
  }
  w[usual] = Math.max(0.2, 1 - used);
  return pickWeighted<Body>(w, U(seed, 0xb11d, hash)) ?? usual;
}

/** Whether a night's-trade outfit is out in this district at all (the district's share; the hours are the material's: `deep`). */
export const nightTradeHere = (outfit: string, district: string, seed: number, hash: H): boolean =>
  !NIGHT_TRADE.includes(outfit) || U(seed, 0x7ad, hash) < (NIGHT_TRADE_PLACE[district] ?? 0.02);

/** A man's cut by who he is (null: the plain short cut): `host` is a suit in Kaburo among the young. */
export function menCutFor(outfit: string, age: Age, district: string, seed: number, hash: H): string | null {
  if (U(seed, 0xca7, hash) > 0.55) return null;
  const key = outfit === 'suit' && district === 'neon' && (age === 'young' || age === 'adult') ? 'host' : MEN_CUT[outfit] ? outfit : age;
  const w: Record<string, number> = { ...(MEN_CUT[key] ?? MEN_CUT.any) } as Record<string, number>;
  for (const k of MEN_CUT_LEFT_OUT) delete w[k];
  return pickWeighted(w, U(seed, 0xca8, hash));
}

/** The group of the women's cuts (peopleDemographics.ts `WOMEN_CUT_GROUPS`) for her. */
export const womenGroupKey = (outfit: string, age: Age): string =>
  outfit === 'maid' ? 'maid' : NIGHT_TRADE.includes(outfit) || outfit === 'bodycon' || outfit === 'gown' || outfit === 'mini' ? 'night' : outfit === 'office' || outfit === 'suit' ? 'office' : age;

/**
 * The hair colour: 0 as the material picks (the showrooms'), 1 black, 2 a natural brown, 3 grey, 4 white or light grey, 5 a dyed brown,
 * 6 a dyed blonde, 7 an old person's dark dye (black or a faint violet-grey). Dyed by who (`DYE`, the district's `dye`), grey by age
 * (the middle-aged covering it, a boss more), white for the old.
 */
export function hairTone(sex: 'man' | 'woman', age: Age, outfit: string, district: string, seed: number, hash: H): number {
  const p = PROFILE[district] ?? DEFAULT_PROFILE;
  if (age === 'old') {
    if (U(seed, 0x6a1, hash) < OLD_DARK_SHARE) return 7;
    return U(seed, 0x6a2, hash) < GREY_BY_AGE[sex].old ? (U(seed, 0x6a3, hash) < 0.5 ? 4 : 3) : 1;
  }
  if (!DYE_NEVER.includes(outfit) && (age !== 'teen' || outfit === 'yankee')) {
    const rebel = outfit === 'hood' || outfit === 'hoodie' || outfit === 'otaku' || outfit === 'blouson';
    const host = outfit === 'suit' && district === 'neon' && sex === 'man' && (age === 'young' || age === 'adult');
    const key = DYE[outfit] ? outfit : host ? 'host' : rebel && age === 'young' ? 'rebel' : age === 'young' ? (sex === 'woman' ? 'young_woman' : 'young_man') : 'none';
    const d = DYE[key];
    if (d.chance > 0 && U(seed, 0x6d1, hash) < d.chance * p.dye) return U(seed, 0x6d2, hash) < d.blonde ? 6 : 5;
  }
  const grey = GREY_BY_AGE[sex][age] * (outfit === 'boss' ? BOSS_GREY : 1);
  if (U(seed, 0x6a4, hash) < grey) return U(seed, 0x6a5, hash) < 0.25 ? 4 : 3;
  return U(seed, 0x6b1, hash) < NATURAL_BROWN ? 2 : 1;
}
