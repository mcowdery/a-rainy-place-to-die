import { hash } from '../../core/hash';

/**
 * What the mob wears where (real/people.ts draws the outfits): weights by outfit per district
 * (`DISTRICT_PEOPLE`), a zone's own with `people:` in its file (zones.ts), which travels with its style
 * (`DistrictStyle3.people`), `CITY_PEOPLE` elsewhere. Suits round the offices and the host clubs, maids in
 * Denkō-chō's café lanes, uniforms by the schools and the university, kimono by the temple. An outfit a body
 * can't wear (a man in a maid's dress, a child in a suit) falls back to its everyday clothes. Pure, and
 * deterministic by seed (the chunk workers dress the crowds with it).
 */
export const OUTFITS = ['plain', 'long', 'suit', 'maid', 'school', 'kimono'] as const;
export type Outfit = (typeof OUTFITS)[number];
export type PeopleMix = Readonly<Partial<Record<Outfit, number>>>;

/** Anywhere without a mix of its own. */
export const CITY_PEOPLE: PeopleMix = { plain: 6, long: 3, suit: 2, school: 0.5 };

export const DISTRICT_PEOPLE: Readonly<Record<string, PeopleMix>> = {
  // Kaburo: going out, the hosts and the salarymen on their way home.
  neon: { plain: 5, long: 4, suit: 3, maid: 0.2, kimono: 0.2 },
  // Asagiri: the offices.
  tower: { suit: 6, plain: 3, long: 2 },
  residential: { plain: 6, long: 2, school: 2, suit: 1.5 },
  oldtown: { plain: 5, long: 2, kimono: 1, suit: 0.5, school: 0.5 },
  campus: { school: 5, plain: 3, long: 1 },
  electric: { plain: 6, suit: 1, maid: 0.6, school: 1 },
  harbor: { plain: 6, long: 2, suit: 1 },
};

/** The mix for a cell planned with `style` in district `kind`: the zone's, else the district's, else the city's. */
export function peopleMixFor(style: { readonly people?: PeopleMix }, kind: string): PeopleMix {
  return style.people ?? DISTRICT_PEOPLE[kind] ?? CITY_PEOPLE;
}

/** An outfit by the mix's weights from those `allowed`, from the seed. */
export function pickOutfit(mix: PeopleMix, seed: number, allowed: (o: Outfit) => boolean): Outfit {
  const entries = OUTFITS.filter((o) => (mix[o] ?? 0) > 0 && allowed(o));
  const total = entries.reduce((a, o) => a + mix[o]!, 0);
  if (total <= 0) return 'plain';
  let x = (hash(seed, 0x0f7) / 4294967296) * total;
  for (const o of entries) {
    x -= mix[o]!;
    if (x < 0) return o;
  }
  return entries[entries.length - 1];
}
