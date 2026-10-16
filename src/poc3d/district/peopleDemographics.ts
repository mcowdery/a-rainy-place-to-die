/**
 * Who is where: the numbers (2026-10-10, a plan to edit, NOT wired into the crowd yet: people.ts `CITY_BUILDS` is off).
 *
 * The city is late-Showa Japan: most people are slim and black-haired, the fat are few and mostly middle-aged men, bosses
 * and politicians among them, hair is dyed by a few for a reason, and the night's trade works after midnight in the
 * shady places. A figure gets a hidden age (a number from a hash of its seed, so no other number in a crowd moves); its
 * age band, its sex, its outfit (its job) and its district's profile give the chances below, each a weight or a share.
 * Everything is a plain table: change a number and nothing else.
 */

import type { Body } from '../real/mobRig';

// ---- Ages ----

export type Age = 'teen' | 'young' | 'adult' | 'middle' | 'old';
/** The share of a street's adults (not children) in each band, before the district's profile and the outfit's own age (a school uniform is a teen's). */
export const AGE_SHARE: Readonly<Record<Age, number>> = { teen: 0.08, young: 0.27, adult: 0.28, middle: 0.22, old: 0.15 };

// ---- Builds ----

type Weights<K extends string> = Readonly<Partial<Record<K, number>>>;
/** A man's build by age: the share of each (the rest are the usual man, 'man'). Heavy men are middle-aged men; the old are `elderMen`. */
export const MAN_BUILD_BY_AGE: Readonly<Record<Age, Weights<Body>>> = {
  teen: { lean: 0.2, tall: 0.06, short: 0.1 },
  young: { lean: 0.16, tall: 0.07, short: 0.1, portly: 0.02, stout: 0.003, bulky: 0.03 },
  adult: { lean: 0.14, tall: 0.06, short: 0.12, portly: 0.1, stout: 0.012, bulky: 0.03 },
  middle: { lean: 0.12, tall: 0.05, short: 0.13, portly: 0.2, stout: 0.03, bulky: 0.03 },
  old: {},
};
/** A woman's build by age. Heavy women come after forty; a flat chest and a slight build are the young's. */
export const WOMAN_BUILD_BY_AGE: Readonly<Record<Age, Weights<Body>>> = {
  teen: { w_petite: 0.16, w_slim: 0.2, w_flat: 0.14, w_tall: 0.05, w_curvy: 0.02, w_pear: 0.03, w_plump: 0.02 },
  young: { w_petite: 0.12, w_slim: 0.18, w_flat: 0.08, w_tall: 0.08, w_curvy: 0.06, w_busty: 0.03, w_pear: 0.06, w_plump: 0.04 },
  adult: { w_petite: 0.1, w_slim: 0.14, w_flat: 0.05, w_tall: 0.07, w_curvy: 0.06, w_busty: 0.03, w_pear: 0.07, w_plump: 0.08, w_heavy: 0.01 },
  middle: { w_petite: 0.08, w_slim: 0.1, w_flat: 0.04, w_tall: 0.05, w_curvy: 0.05, w_busty: 0.02, w_pear: 0.08, w_plump: 0.14, w_heavy: 0.03 },
  old: {},
};
/** The old: a man (frail, stout, tall, else the usual elder) and a woman (slight, plump); half of the old are each. */
export const ELDER_MEN: Weights<Body> = { e_frail: 0.3, e_stout: 0.1, e_tall: 0.1 };
export const ELDER_WOMEN: Weights<Body> = { w_elder: 0.62, w_elder_plump: 0.38 };

/** A boss's (and a politician's) build, outright: most are fat. The rest are the usual man. */
export const BOSS_BUILD: Weights<Body> = { stout: 0.5, portly: 0.35 };

/**
 * An outfit's own pull on the build, on top of the age's: a multiplier on each build's weight (1 where not named). A boss
 * or a politician is fat (`boss`: also set outright, below); the shady and the labourers are big; the night's trade is
 * curvy; students and maids slight. The old are never in these.
 */
export const OUTFIT_BUILD: Readonly<Partial<Record<string, Weights<Body>>>> = {
  boss: { stout: 40, portly: 28, bulky: 2, lean: 0.1, short: 0.3, tall: 0.5 },
  suit: { portly: 1.2, stout: 1.5, lean: 1.1 },
  office: { portly: 0.9, lean: 1.2, w_slim: 1.4, w_tall: 1.4, w_plump: 0.7 },
  yakuza: { bulky: 8, stout: 3, portly: 1.5, lean: 0.6, short: 0.6, tall: 1.4 },
  chinpira: { lean: 1.8, bulky: 1.5, stout: 0.4, portly: 0.3 },
  irezumi: { bulky: 6, stout: 2, lean: 0.8 },
  bosozoku: { lean: 1.6, bulky: 1.5, stout: 0.3, portly: 0.2 },
  hood: { lean: 1.5, bulky: 1.5 },
  drunk: { portly: 2.5, stout: 2.5 },
  work: { bulky: 6, stout: 1.5, portly: 1.2, lean: 0.9 },
  coverall: { bulky: 5, stout: 1.5 },
  shirtless: { bulky: 5, stout: 1.5, lean: 0.8 },
  doorman: { bulky: 10, tall: 2, stout: 1.5, lean: 0.3, short: 0.1 },
  guard: { bulky: 3, portly: 1.5 },
  police: { bulky: 3, tall: 1.4, lean: 0.8, short: 0.5, portly: 0.8, stout: 0.2 },
  school: { portly: 0, stout: 0 },
  chef: { portly: 2.2, stout: 1.5 },
  apron: { w_plump: 1.8, w_heavy: 1.6 },
  maid: { w_petite: 3, w_slim: 1.6, w_flat: 1.6, w_plump: 0.2, w_heavy: 0 },
  nurse: { w_slim: 1.2, w_plump: 0.9 },
  // The night's trade: curvy and busty and slim and tall, not heavy.
  streetwalker: { w_curvy: 4, w_busty: 3.5, w_slim: 2, w_tall: 2, w_pear: 1.2, w_plump: 0.3, w_heavy: 0, w_flat: 0.3, w_petite: 0.6 },
  bunny: { w_curvy: 3.5, w_busty: 4, w_slim: 2, w_tall: 2.2, w_plump: 0, w_heavy: 0, w_flat: 0.4 },
  bodycon: { w_curvy: 3, w_busty: 2.5, w_slim: 2, w_tall: 2, w_plump: 0.3, w_heavy: 0 },
  mini: { w_curvy: 1.8, w_slim: 1.6, w_tall: 1.4, w_busty: 1.5, w_plump: 0.6 },
  gown: { w_curvy: 2.2, w_tall: 2, w_slim: 1.6, w_busty: 1.8, w_plump: 0.5 },
  lingerie: { w_curvy: 3, w_busty: 3, w_slim: 1.6, w_plump: 0.2, w_heavy: 0 },
};

/**
 * A district's profile: what its people are like. `age` multiplies the age shares; `fat` multiplies the heavy builds' weights
 * (stout, portly, plump, heavy); `big` the bulky men's; `night` how much of the night's trade there is (the outfit's
 * weight in the zone's own mix stays: this scales how many of them are the curvy kind); `dye` multiplies every dye chance.
 */
export interface Profile {
  readonly age: Weights<Age>;
  readonly fat: number;
  readonly big: number;
  readonly dye: number;
}
export const PROFILE: Readonly<Record<string, Profile>> = {
  // Kaburo, going out: young, slim, dyed heads at night; the hosts and the gangs.
  neon: { age: { young: 1.5, adult: 1.1, old: 0.4, teen: 0.5 }, fat: 0.8, big: 1.4, dye: 2.2 },
  // Asagiri, the offices: adults, middle-aged men, bosses; a suit's fat is the age's.
  tower: { age: { adult: 1.6, middle: 1.5, young: 1.1, teen: 0.1, old: 0.4 }, fat: 1.3, big: 0.5, dye: 0.4 },
  residential: { age: { adult: 1.1, middle: 1.2, old: 1.3, teen: 1.3 }, fat: 1.1, big: 0.5, dye: 0.6 },
  // The old town: the old, shopkeepers in aprons, a plumper crowd.
  oldtown: { age: { old: 2.2, middle: 1.5, young: 0.7, teen: 0.5 }, fat: 1.3, big: 0.8, dye: 0.5 },
  // The campus: the young, thin.
  campus: { age: { teen: 2.5, young: 2.5, adult: 0.5, middle: 0.3, old: 0.2 }, fat: 0.5, big: 0.4, dye: 1.0 },
  // Denkō-chō: young men, thin; otaku and maids.
  electric: { age: { young: 1.8, teen: 1.4, adult: 1.0, middle: 0.5, old: 0.3 }, fat: 0.9, big: 0.4, dye: 1.4 },
  // The port: workers, big men, few of the old and the young.
  harbor: { age: { adult: 1.4, middle: 1.3, young: 0.9, teen: 0.3, old: 0.7 }, fat: 0.9, big: 3, dye: 0.8 },
};
/** Anywhere without one. */
export const DEFAULT_PROFILE: Profile = { age: {}, fat: 1, big: 1, dye: 1 };

// ---- The night's trade, by the hour and the place ----

/**
 * How much of the night's trade (`NIGHT_TRADE`) is out at a given hour (0-23, the story clock): nothing by day, a few at dusk,
 * most from midnight to four, thinning to dawn. Times the zone's own `night:` and its mix's weight of them. The shady men (a
 * hood, a drunk, a chinpira) keep the same hours a little earlier.
 */
export const NIGHT_TRADE_HOURS: readonly number[] = [
  // 0     1     2     3     4     5     6    7  8  9  10 11 12 13 14 15 16 17    18    19    20    21    22    23
  1.0, 1.0, 0.95, 0.8, 0.5, 0.15, 0.02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.05, 0.12, 0.25, 0.45, 0.7, 0.9,
];
export const NIGHT_TRADE: readonly string[] = ['streetwalker', 'bunny', 'bodycon', 'lingerie', 'crop', 'catsuit'];
/** Which districts they work in, as a share of the hours' above: Kaburo first, the port's bars and the old town's back streets a little, the rest almost none. */
export const NIGHT_TRADE_PLACE: Readonly<Record<string, number>> = { neon: 1, harbor: 0.25, oldtown: 0.1, electric: 0.08, tower: 0.04, residential: 0.01, campus: 0 };

// ---- Hair ----

/**
 * A man's cut (the `m_*` kinds, mobMenHairKinds.ts), the weight of each by who he is: the plain short cut is the rest.
 * Keys: 'any' (everyone), then a band or an outfit that replaces it.
 */
export const MEN_CUT: Readonly<Record<string, Weights<string>>> = {
  any: { m_side_part: 3, m_crew: 3, m_messy: 1.2, m_bowl: 0.8, m_receding: 1, m_horseshoe: 0.5, m_undercut: 0.5, m_slick_long: 0.4, m_perm: 1, m_long: 0.2, m_mullet: 0.2, m_quiff: 0.5 },
  teen: { m_crew: 4, m_bowl: 2, m_messy: 1.5, m_side_part: 2 },
  young: { m_messy: 2, m_undercut: 1.5, m_quiff: 1.5, m_perm: 1.5, m_crew: 1.5, m_side_part: 2, m_bowl: 0.6, m_long: 0.5, m_mullet: 0.4 },
  adult: { m_side_part: 4, m_crew: 2, m_receding: 1.2, m_perm: 0.8, m_slick_long: 0.6 },
  middle: { m_side_part: 3, m_receding: 3, m_horseshoe: 1.5, m_crew: 1.5, m_slick_long: 0.8 },
  old: { m_receding: 2, m_horseshoe: 2, m_crew: 2 },
  work: { m_crew: 5, m_horseshoe: 1, m_receding: 1 },
  police: { m_crew: 8, m_side_part: 2 },
  office: { m_side_part: 6, m_crew: 1.5, m_receding: 1.5 },
  suit: { m_side_part: 5, m_slick_long: 1, m_receding: 1.5, m_crew: 1 },
  boss: { m_slick_long: 3, m_horseshoe: 3, m_receding: 3, m_side_part: 1 },
  bosozoku: { m_perm: 3, m_slick_long: 2, m_mullet: 2, m_long: 1 },
  chinpira: { m_perm: 3, m_undercut: 1.5, m_slick_long: 1.5 },
  host: { m_undercut: 3, m_quiff: 3, m_slick_long: 2, m_long: 0.8 },
  // Festivals: a topknot, once in a long while.
  matsuri: { m_topknot: 1, m_crew: 3, m_side_part: 1 },
};
/** The man bun and the low ponytail are not of the period or the place: left out of the crowd (kept in the showroom). */
export const MEN_CUT_LEFT_OUT: readonly string[] = ['m_bun', 'm_ponytail'];

/** The women's detailed cuts (mobHairKinds.ts) by who she is: the groups of cuts (HAIR_GROUPS' names) that suit her, and what share of her kind wear them (the rest: the old anime cuts the city has). */
export const WOMEN_CUT_GROUPS: Readonly<Record<string, readonly string[]>> = {
  teen: ['short hair', 'tails and braids', 'low ponytails', 'shoulder-length hair'],
  young: ['long hair', 'shoulder-length hair', 'short hair', 'tails and braids', 'hair up'],
  adult: ['shoulder-length hair', 'hair up', 'short hair', 'long hair'],
  middle: ['hair up', 'shoulder-length hair', 'short hair'],
  old: ['hair up', 'short hair'],
  office: ['shoulder-length hair', 'hair up', 'short hair'],
  maid: ['tails and braids', 'long hair', 'hair up'],
  night: ['long hair', 'more long hair', 'hair up', 'more hair up'],
};
/** How many women wear one of the detailed cuts at all (the rest keep today's six): start low until the cuts are judged lit and moving. */
export const WOMEN_DETAILED_SHARE = 0.35;

// ---- Hair colour ----

/**
 * The chance of dyed hair (brown, chestnut, a light blonde much more rarely), by who: a share, times the district's `dye`, and
 * for the night's trade and the host men times the hour's (NIGHT_TRADE_HOURS). The rest keep their own dark. `blonde`: how
 * many of the dyed are a light blonde (the rest browns).
 */
export const DYE: Readonly<Record<string, { readonly chance: number; readonly blonde: number }>> = {
  bosozoku: { chance: 0.35, blonde: 0.07 },
  yankee: { chance: 0.35, blonde: 0.07 },
  chinpira: { chance: 0.35, blonde: 0.07 },
  host: { chance: 0.25, blonde: 0.1 },
  streetwalker: { chance: 0.3, blonde: 0.08 },
  bunny: { chance: 0.3, blonde: 0.08 },
  bodycon: { chance: 0.2, blonde: 0.06 },
  mini: { chance: 0.08, blonde: 0.04 },
  gown: { chance: 0.1, blonde: 0.04 },
  crop: { chance: 0.1, blonde: 0.04 },
  lingerie: { chance: 0.25, blonde: 0.08 },
  // Young rebels, everyone else young, by sex and band; none in uniform, at a desk or in a suit.
  young_woman: { chance: 0.04, blonde: 0 },
  young_man: { chance: 0.02, blonde: 0 },
  rebel: { chance: 0.1, blonde: 0.03 },
  none: { chance: 0, blonde: 0 },
};
/** Who never dyes: school (its rules), the offices and the police, the bosses (who black it, below), and the old. */
export const DYE_NEVER: readonly string[] = ['school', 'track', 'gym', 'police', 'nurse', 'doctor', 'office', 'suit', 'boss', 'work', 'guard', 'doorman', 'maid'];
/** Grey hair by age, as the share with visible grey (the old are greyer: white); the middle-aged cover it (black dye), so it is fewer than their years. */
export const GREY_BY_AGE: Readonly<Record<'man' | 'woman', Readonly<Record<Age, number>>>> = {
  man: { teen: 0, young: 0.01, adult: 0.06, middle: 0.12, old: 0.9 },
  woman: { teen: 0, young: 0, adult: 0.02, middle: 0.08, old: 0.85 },
};
/** A boss covers his grey more than other men (a multiplier on the share above). */
export const BOSS_GREY = 0.4;
/** Of the old, how many keep a dark dyed black or a faint violet-grey in place of white. */
export const OLD_DARK_SHARE = 0.1;
/** How many have a brownish natural cast (the red-brown and the dark chestnut natural to Japanese hair: not a dye). */
export const NATURAL_BROWN = 0.2;
