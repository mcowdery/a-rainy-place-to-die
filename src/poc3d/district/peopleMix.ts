import { hash } from '../../core/hash';

/**
 * What the mob wears where (real/people.ts draws the outfits): weights by outfit per district
 * (`DISTRICT_PEOPLE`), a zone's own with `people:` in its file (zones.ts), which travels with its style
 * (`DistrictStyle3.people`), `CITY_PEOPLE` elsewhere. Suits round the offices and the host clubs, maids in
 * Denkō-chō's café lanes, uniforms by the schools and the university, kimono by the temple, yukata by the river,
 * hard hats and hi-vis at the port, a few police officers about, otaku (a rucksack, glasses, hands on its straps) in Denkō-chō and round the campus. An outfit a body
 * can't wear (a man in a maid's dress, a child in a suit) falls back to its everyday clothes. Pure, and
 * deterministic by seed (the chunk workers dress the crowds with it).
 */
// (The Filipino ones, for Manila, are UNDER REVIEW in the mob showroom (mob.html) and in no mix yet: content/manila/PEOPLE-REVIEW.md
// says how to turn them on once approved. The later ones are the sculpted generation's, real/mobShape.ts; the classic templates draw each as the nearest of
// the first ten, people.ts CLASSIC_OUTFIT. Shorts and the down jacket keep to their seasons (district/peopleHours.ts);
// nurses and doctors are in no mix yet: they want a place. `nude` is a woman's or a man's body with nothing over it,
// barefoot, and `nude_heels` a woman's in high heels (a cabaret's dancer behind its door), for the rooms of adult
// scenes (real/windowScenes.ts): never in a mix, and pickOutfit never gives either, so nobody in the street's crowd
// can wear them.)
export const OUTFITS = ['plain', 'long', 'suit', 'maid', 'school', 'kimono', 'yukata', 'work', 'police', 'otaku', 'dress', 'mini', 'gown', 'shorts', 'hoodie', 'office', 'track', 'nurse', 'doctor', 'apron', 'puffer', 'gym', 'yakuza', 'chinpira', 'bosozoku', 'boss', 'hood', 'yankee', 'drunk', 'irezumi', 'pinoy_school', 'baller', 'barong', 'vendor', 'jeep_crew', 'trike_driver', 'guard', 'nude', 'nude_heels'] as const;
export type Outfit = (typeof OUTFITS)[number];
/** Nothing on (barefoot, or a woman in heels): only ever in a room of an adult scene. */
export const isBare = (o: unknown): boolean => o === 'nude' || o === 'nude_heels';
export type PeopleMix = Readonly<Partial<Record<Outfit, number>>>;

/** Anywhere without a mix of its own. */
export const CITY_PEOPLE: PeopleMix = { plain: 6, long: 3, suit: 2, school: 0.5, otaku: 1, police: 0.06, dress: 1, hoodie: 1, office: 1, shorts: 1.2, puffer: 1.5, hood: 0.1, chinpira: 0.1, drunk: 0.1 };

export const DISTRICT_PEOPLE: Readonly<Record<string, PeopleMix>> = {
  // Kaburo: going out, the hosts and the salarymen on their way home.
  neon: { plain: 5, long: 4, suit: 3, maid: 0.2, kimono: 0.2, otaku: 0.8, police: 0.12, dress: 1, mini: 0.8, gown: 0.5, hoodie: 0.6, office: 1, apron: 0.3, shorts: 0.8, puffer: 1, yakuza: 0.35, chinpira: 0.5, hood: 0.3, drunk: 0.5, yankee: 0.2, bosozoku: 0.1, boss: 0.15 },
  // Asagiri: the offices.
  tower: { suit: 6, plain: 3, long: 2, police: 0.1, office: 3, dress: 0.5, puffer: 0.6, boss: 0.25 },
  residential: { plain: 6, long: 2, school: 2, suit: 1.5, dress: 1, hoodie: 1, apron: 0.3, track: 0.3, shorts: 1, puffer: 1.2, yankee: 0.25 },
  oldtown: { plain: 5, long: 2, kimono: 1, yukata: 0.6, suit: 0.5, school: 0.5, police: 0.06, apron: 0.4, dress: 0.5, shorts: 0.6, puffer: 1, chinpira: 0.3, irezumi: 0.15, yakuza: 0.15, drunk: 0.2 },
  campus: { school: 5, plain: 3, long: 1, otaku: 2, hoodie: 1.5, track: 1, gym: 0.5, shorts: 0.8, puffer: 1 },
  electric: { plain: 6, suit: 1, maid: 0.6, school: 1, otaku: 3, hoodie: 1.5, apron: 0.3, shorts: 0.8, puffer: 1, hood: 0.2, yankee: 0.3, chinpira: 0.2 },
  harbor: { plain: 5, long: 1.5, suit: 1, work: 3, hoodie: 0.6, puffer: 0.8, chinpira: 0.4, irezumi: 0.3, hood: 0.4, bosozoku: 0.3, yakuza: 0.2 },
};

/** The mix for a cell planned with `style` in district `kind`: the zone's, else the district's, else the city's. */
export function peopleMixFor(style: { readonly people?: PeopleMix }, kind: string): PeopleMix {
  return style.people ?? DISTRICT_PEOPLE[kind] ?? CITY_PEOPLE;
}

/** An outfit by the mix's weights from those `allowed`, from the seed. */
export function pickOutfit(mix: PeopleMix, seed: number, allowed: (o: Outfit) => boolean): Outfit {
  const entries = OUTFITS.filter((o) => (mix[o] ?? 0) > 0 && !isBare(o) && allowed(o));
  const total = entries.reduce((a, o) => a + mix[o]!, 0);
  if (total <= 0) return 'plain';
  let x = (hash(seed, 0x0f7) / 4294967296) * total;
  for (const o of entries) {
    x -= mix[o]!;
    if (x < 0) return o;
  }
  return entries[entries.length - 1];
}

// ---- Smoking ----

/**
 * What someone smokes in the street: the city is late-Showa Japan, where about two men in three smoked and one
 * woman in seven, on the pavement, at the kerb, walking along. (real/people.ts gives the hand to it and
 * real/smoke.ts draws the cigarette, its ember and the smoke.)
 */
export const SMOKES = ['cigarette', 'cigar'] as const;
export type Smoke = (typeof SMOKES)[number];

/** Who never smokes in the street: the young, and those at work in a uniform that forbids it. */
const NO_SMOKE: ReadonlySet<Outfit> = new Set<Outfit>(['school', 'track', 'gym', 'yankee', 'nurse', 'doctor', 'police', 'maid', 'apron', 'otaku', 'pinoy_school', 'nude', 'nude_heels']);
/** The share of each kind of person with one lit, standing about and walking along: [standing, walking]. */
const SMOKE_SHARE: Readonly<Partial<Record<Outfit, readonly [number, number]>>> = {
  suit: [0.46, 0.17],
  office: [0.4, 0.14],
  work: [0.5, 0.2],
  yakuza: [0.6, 0.3],
  chinpira: [0.6, 0.3],
  irezumi: [0.55, 0.25],
  bosozoku: [0.55, 0.25],
  hood: [0.45, 0.2],
  boss: [0.65, 0.35],
  drunk: [0.35, 0.12],
};
const SMOKE_MEN: readonly [number, number] = [0.38, 0.14];
/** Women smoked far less, and seldom in the street; the nightlife's more than most. */
const SMOKE_WOMEN: readonly [number, number] = [0.07, 0.02];
const SMOKE_WOMEN_NIGHT: readonly [number, number] = [0.2, 0.06];

/**
 * Whether this one has something lit, and what: by who they are and what they're doing, from `r` in [0, 1) (their
 * own number). A fat cat, a politician and the old boss under his hat smoke cigars. Nobody running does, nor a
 * child, nor anyone in a school's clothes.
 */
export function smokeOf(who: { readonly body: 'man' | 'woman' | 'child' | 'elder'; readonly outfit: Outfit; readonly hair?: string }, doing: 'stand' | 'walk' | 'run', r: number): Smoke | null {
  if (who.body === 'child' || doing === 'run' || NO_SMOKE.has(who.outfit)) return null;
  const woman = who.body === 'woman';
  const share = SMOKE_SHARE[who.outfit] ?? (woman ? (who.outfit === 'gown' || who.outfit === 'mini' ? SMOKE_WOMEN_NIGHT : SMOKE_WOMEN) : SMOKE_MEN);
  // (A woman in a suit or at the office smokes as women did, a little more than most; the old a little less.)
  const k = woman && SMOKE_SHARE[who.outfit] ? 0.3 : who.body === 'elder' ? 0.8 : 1;
  if (r >= share[doing === 'stand' ? 0 : 1] * k) return null;
  return who.outfit === 'boss' || (who.outfit === 'yakuza' && who.hair === 'hat') ? 'cigar' : 'cigarette';
}
