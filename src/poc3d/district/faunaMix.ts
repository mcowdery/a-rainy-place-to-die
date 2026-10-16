/**
 * Which animals are about, and how many (pure, tested in tests/faunaMix.test.ts): the street's birds, cats, dogs,
 * hens, bats and insects, by the city (Tokyo's are Japan's, Manila's the tropics'), the hour, the season, the
 * weather and the place (trees and water near). `real/fauna.ts` keeps that many of each in range of the viewer.
 */

export const FAUNA_KINDS = [
  'crow', 'pigeon', 'sparrow', 'gull', 'egret', 'cat', 'dog', 'chicken', 'butterfly', 'dragonfly', 'firefly', 'moth',
  'fox', 'tanuki', 'squirrel', 'rat', 'duck', 'turtle', 'frog', 'beetle', 'snail', 'goat', 'gecko', 'lizard', 'parrot', 'cockroach', 'crab', 'monkey',
] as const;
export type FaunaKind = (typeof FAUNA_KINDS)[number];
export type FaunaTargets = Readonly<Record<FaunaKind, number>>;

export interface FaunaContext {
  /** Manila (the tropics): no seasons, other animals. */
  readonly tropical: boolean;
  /** Hour of the story clock, 0-24. */
  readonly hour: number;
  readonly season: 'spring' | 'summer' | 'autumn' | 'winter';
  /** 0-1. */
  readonly rain: number;
  /** m/s. */
  readonly wind: number;
  readonly snow: boolean;
  readonly typhoon: boolean;
  /** 0-1: open water near (the sea, the bay, the river). */
  readonly water: number;
  /** 0-1: trees about (a tenth of a hundred within 45 m is full). */
  readonly green: number;
  /** 0-1: street lamps about, for the moths. */
  readonly lamps: number;
  /** Indoors, underground, in a vehicle: nothing is drawn. */
  readonly shut?: boolean;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 0-1 daylight by the hour (a clock's, not the season's: the light comes later and goes earlier in winter). */
export function dayShare(hour: number): number {
  return smooth(5.5, 7.5, hour) * (1 - smooth(17, 19.2, hour));
}

/** 0-1: dawn and dusk, when the bats are out and the crows go home. */
export function duskShare(hour: number): number {
  const d = (h: number, w: number): number => Math.max(0, 1 - Math.abs(hour - h) / w);
  return Math.max(d(18.3, 1.6), d(5.2, 1));
}

/** Where a spot is, for the animals: how built-up (0 a park or a suburb's edge, 1 the downtown core), whether in a park, by a pond, by the coast. */
export interface Habitat {
  readonly urban: number;
  readonly park: boolean;
  /** Within a few metres of a pond (a park's). */
  readonly pond: boolean;
  /** 0-1: open water (the sea, the bay, the river) near. */
  readonly coast: number;
  readonly tropical: boolean;
}

/**
 * How likely a kind is to be at a spot (0-1), by where it is: the user's rule (2026-10-10): downtown has almost nothing but pigeons,
 * crows and sparrows (and rats and cockroaches in the alleys at night), cats and dogs are few in the core and common in the suburbs,
 * the wild ones (foxes, squirrels, frogs, ducks) are in the parks and by the ponds only, the sea's birds and crabs are at the coast, and
 * a kind that makes sense nowhere has no row here (it gets 0). `faunaTargets` says how many; this says where.
 */
export function habitatWeight(kind: FaunaKind, h: Habitat): number {
  const sub = 1 - smooth(0.25, 0.7, h.urban);
  const core = smooth(0.3, 0.8, h.urban);
  const wild = h.park ? 1 : 0;
  const clamp = (v: number): number => Math.max(0, Math.min(1, v));
  switch (kind) {
    case 'pigeon': return clamp(0.4 + 0.6 * core + (h.park ? 0.3 : 0));
    case 'sparrow': return clamp(0.7 + 0.3 * sub);
    case 'crow': return h.tropical ? 0 : clamp(0.5 + 0.5 * core);
    case 'gull': return h.coast > 0.35 ? 1 : 0;
    case 'egret': return h.pond || (h.coast > 0.35 && h.urban < 0.8) ? 1 : 0;
    case 'crab': return h.coast > 0.35 ? 1 : 0;
    case 'duck': return h.pond ? 1 : 0;
    case 'turtle': return h.pond ? 1 : 0;
    case 'frog': return h.pond ? 1 : h.park ? 0.4 : 0;
    // (Manila is full of strays: its cats and dogs are in the streets of the core too, fewer, and thick in the barangays.)
    case 'cat': return h.park ? 0.25 : h.tropical ? clamp(0.45 + 0.55 * sub) : clamp(0.1 + 0.9 * sub);
    case 'dog': return h.park ? 0.5 : h.tropical ? clamp(0.4 + 0.6 * sub) : clamp(0.04 + 0.96 * sub);
    // Hens run in the barangays' lanes and goats are tethered at the city's edge: not in the centre.
    case 'chicken': return h.tropical ? clamp((0.5 - h.urban) / 0.18) : clamp(sub * sub);
    case 'goat': return h.tropical ? clamp((0.3 - h.urban) / 0.08) : sub > 0.6 ? sub : 0;
    case 'fox':
    case 'tanuki': return h.park ? 1 : 0.3 * sub * sub;
    case 'squirrel': return h.park ? 1 : 0.35 * sub;
    case 'monkey': return h.park ? 1 : 0.05 * sub;
    case 'parrot': return h.park ? 1 : 0.35 * sub;
    case 'beetle':
    case 'snail':
    case 'lizard': return h.park ? 1 : 0.5 * sub;
    case 'rat': return clamp(0.15 + 0.55 * core);
    case 'cockroach': return clamp(0.3 + 0.7 * core);
    case 'gecko': return clamp(0.5 + 0.5 * core);
    case 'butterfly':
    case 'dragonfly': return h.park || h.pond ? 1 : 0.5 * sub;
    case 'firefly': return h.park || h.pond ? 1 : 0.3 * sub;
    case 'moth': return 1;
  }
  return wild;
}

const NONE = Object.fromEntries(FAUNA_KINDS.map((k) => [k, 0])) as Record<FaunaKind, number>;
export const NO_FAUNA = NONE;

/** How many of each kind to keep in range (about 60 m round the viewer) now. */
export function faunaTargets(c: FaunaContext): FaunaTargets {
  if (c.shut || c.typhoon) return NONE;
  const day = dayShare(c.hour);
  const night = 1 - smooth(4.5, 6, c.hour) * (1 - smooth(19, 20.5, c.hour));
  const dusk = duskShare(c.hour);
  const wet = Math.min(1, c.rain * 1.6);
  const dry = 1 - wet;
  // Insects want warm, still, dry air.
  const calm = dry * (1 - smooth(5, 9, c.wind)) * (c.snow ? 0 : 1);
  const green = c.green;
  const n = (v: number): number => Math.max(0, Math.round(v));
  const out: Record<FaunaKind, number> = { ...NONE };

  if (c.tropical) {
    out.pigeon = n(5 * day * (1 - wet * 0.8));
    out.sparrow = n(9 * day * (0.45 + 0.55 * green) * (1 - wet * 0.7));
    out.egret = n(3.5 * c.water * (0.2 + 0.8 * day) * (1 - wet * 0.6));
    out.gull = n(26 * Math.min(1, c.water * 1.8) * (0.25 + 0.75 * day) * (1 - wet * 0.4));
    out.cat = n(6 * (0.3 + 0.7 * Math.max(night, dusk) + 0.5 * day) * (1 - wet * 0.8));
    out.dog = n(6 * (0.5 + 0.5 * day) * (1 - wet * 0.7));
    // Hens and roosters about the barangay lanes, at dawn most of all.
    out.chicken = n(5 * (0.25 + 0.75 * Math.max(day, dusk)) * (1 - wet * 0.8));
    out.butterfly = n(7 * day * green * calm);
    out.dragonfly = n(3 * day * (0.3 + 0.7 * Math.max(green, c.water)) * calm);
    out.firefly = n(10 * night * green * calm);
    out.moth = n(7 * night * (0.3 + 0.7 * c.lamps) * (1 - wet));
    // The lanes' and the markets' others: goats, rats, geckos on the walls at night, the cockroach, a lizard, a parrot in a tree, monkeys.
    out.goat = n(2 * (0.3 + 0.7 * day) * (1 - wet * 0.7));
    out.rat = n(3 * (0.3 + 0.7 * night) * (1 - wet * 0.3));
    out.gecko = n(3 * (0.3 + 0.7 * night) * (1 - wet * 0.3));
    out.cockroach = n(2 * night);
    out.lizard = n(1.2 * day * (0.3 + 0.7 * green) * (1 - wet));
    out.parrot = n(1.5 * day * green * (1 - wet));
    out.monkey = n(1.2 * day * green * (1 - wet) * (green > 0.5 ? 1 : 0));
    out.duck = n(3 * c.water * (0.3 + 0.7 * day) * (1 - wet * 0.3));
    out.crab = n(3 * c.water * (0.5 + 0.5 * night));
    out.frog = n(3 * (0.3 + 0.7 * night) * wet * 1.2 * Math.max(green, c.water));
    out.snail = n(2 * wet * green);
    out.beetle = n(2 * night * green * dry);
    return out;
  }

  const spring = c.season === 'spring';
  const summer = c.season === 'summer';
  const autumn = c.season === 'autumn';
  const winter = c.season === 'winter';
  const cold = winter ? 0.6 : 1;
  const snowy = c.snow ? 0.5 : 1;
  // Crows: the city's, scavenging by day and gathering at dusk, more in the cold months.
  out.crow = n(3 * (day + dusk * 0.7) * (0.55 + 0.45 * green) * (winter || autumn ? 1.4 : 1) * (1 - wet * 0.6) * snowy);
  out.pigeon = n(6 * day * (1 - wet * 0.75) * snowy * (winter ? 0.8 : 1));
  out.sparrow = n(7 * day * (0.35 + 0.65 * green) * (1 - wet * 0.7) * cold * snowy);
  out.gull = n(26 * Math.min(1, c.water * 1.8) * (0.25 + 0.75 * day) * (1 - wet * 0.4));
  out.cat = n(2.2 * (0.25 + 0.75 * Math.max(night, dusk) + 0.35 * day) * (1 - wet * 0.85) * cold * (c.snow ? 0.2 : 1));
  out.butterfly = n(6 * day * green * calm * (spring || summer ? 1 : autumn ? 0.25 : 0));
  out.dragonfly = n(4 * day * (0.3 + 0.7 * Math.max(green, c.water)) * calm * (summer ? 1 : autumn ? 1.2 : spring ? 0.2 : 0));
  out.firefly = n(14 * night * (0.2 + 0.8 * green) * calm * (summer ? 1 : spring ? 0.1 : 0));
  out.moth = n(5 * night * (0.3 + 0.7 * c.lamps) * (1 - wet) * (winter ? 0 : autumn ? 0.5 : 1) * (c.snow ? 0 : 1));
  // Japan's others: a fox or a tanuki come down at night where there is green, squirrels in the trees by day, rats at night,
  // ducks and turtles on the water, frogs in the rains, beetles on summer nights, snails when it is wet.
  out.fox = n(1 * (night + dusk * 0.5) * green * (1 - wet) * snowy);
  out.tanuki = n(1 * night * green * (1 - wet) * (winter ? 0.4 : 1));
  out.squirrel = n(2 * day * green * (1 - wet) * (winter ? 0.5 : 1) * snowy);
  out.rat = n(2 * (0.3 + 0.7 * night) * (1 - wet * 0.5) * snowy);
  out.duck = n(3 * c.water * (0.3 + 0.7 * day) * (1 - wet * 0.4) * (winter ? 1.3 : 1));
  out.turtle = n(1.5 * c.water * day * (summer || spring ? 1 : 0) * dry);
  out.frog = n(3 * (spring || summer ? 1 : 0) * (0.3 + 0.7 * night) * (0.4 + wet) * Math.max(green, c.water) * (c.snow ? 0 : 1));
  out.beetle = n(2 * night * green * dry * (summer ? 1 : 0));
  out.snail = n(2 * wet * green * (winter ? 0 : 1));
  return out;
}
