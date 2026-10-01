import { hash } from '../../core/hash';
import type { DistrictId } from '../../gen/macro';
import { CAR_TYPES2, PAINTS, type CarType } from '../models/vehicles';

/**
 * Which cars a part of the city has, parked and in traffic: weights by model (models/vehicles.ts). Each
 * district has its own (`DISTRICT_CARS`), and a zone can set its own with `cars:` in its file (zones.ts),
 * which travels with its style (`DistrictStyle3.cars`). The sports cars are the garage's; a few turn up where
 * the racing crowd goes. Work vans and kei vans are everywhere, box trucks mostly at the port and in
 * Denkō-chō, patrol cars most round the police HQ (Asagiri) and Kaburo. Pure, and deterministic by seed (the
 * chunk workers pick parked cars with it).
 */
export type CarMix = Readonly<Partial<Record<CarType, number>>>;

/** Anywhere without a mix of its own (the expressway, ungenerated ground). */
export const CITY_CARS: CarMix = { sedan: 26, kei: 20, minivan: 18, taxi: 10, taxi2: 8, luxury: 6, keitruck: 6, van: 6, keivan: 6, boxtruck: 3, police: 2, hatch: 1, sports: 1 };

export const DISTRICT_CARS: Readonly<Partial<Record<DistrictId, CarMix>>> = {
  // Kaburo: taxis waiting on the nightlife, black cars for the hosts and the clubs' owners.
  neon: { sedan: 20, luxury: 10, taxi: 16, taxi2: 12, kei: 12, minivan: 16, keitruck: 4, van: 4, keivan: 4, boxtruck: 2, police: 3, sports: 2, rotary: 1, hatch: 1 },
  // Asagiri: company cars, hire cars and the newer taxis.
  tower: { sedan: 26, luxury: 16, taxi: 10, taxi2: 16, kei: 8, minivan: 16, keitruck: 3, van: 5, keivan: 3, boxtruck: 2, police: 4, awd: 1, sports: 1 },
  // Houses and flats: kei cars and family minivans.
  residential: { sedan: 22, kei: 30, minivan: 26, keitruck: 6, van: 4, keivan: 6, boxtruck: 1, police: 1, taxi: 6, taxi2: 2, luxury: 3, hatch: 1, roadster: 1 },
  // The old town: kei cars and kei trucks on the lanes, the older taxis.
  oldtown: { kei: 30, keitruck: 14, keivan: 10, van: 5, sedan: 18, minivan: 16, boxtruck: 2, police: 1, taxi: 10, taxi2: 3, luxury: 3, hatch: 1 },
  campus: { kei: 26, sedan: 22, minivan: 20, keitruck: 6, van: 3, keivan: 5, boxtruck: 1, police: 1, taxi: 8, taxi2: 3, hatch: 2, roadster: 1 },
  electric: { sedan: 24, kei: 20, minivan: 18, taxi: 14, taxi2: 8, keitruck: 6, van: 6, keivan: 6, boxtruck: 5, police: 1, luxury: 3, sports: 1, rotary: 1, awd: 1 },
  // The port: work trucks and vans by day, and the racing crowd's cars by the warehouses at night.
  harbor: { keitruck: 18, boxtruck: 12, van: 8, keivan: 5, minivan: 18, sedan: 22, kei: 16, taxi: 10, taxi2: 3, luxury: 4, police: 1, rotary: 2, sports: 2, awd: 2 },
};

/** The mix for a cell planned with `style` in district `kind`: the zone's, else the district's, else the city's. */
export function carMixFor(style: { readonly cars?: CarMix }, kind: DistrictId | string): CarMix {
  return style.cars ?? DISTRICT_CARS[kind as DistrictId] ?? CITY_CARS;
}

/** A car by the mix's weights and its paint, both from the seed. */
export function pickCar(mix: CarMix, seed: number): { type: CarType; paint: number } {
  const entries = CAR_TYPES2.filter((t) => (mix[t] ?? 0) > 0);
  const total = entries.reduce((a, t) => a + mix[t]!, 0);
  let x = (hash(seed, 0xca2) / 4294967296) * total;
  let type: CarType = entries[entries.length - 1] ?? 'sedan';
  for (const t of entries) {
    x -= mix[t]!;
    if (x < 0) {
      type = t;
      break;
    }
  }
  const paints = PAINTS[type];
  return { type, paint: paints[hash(seed, 0x9a1) % paints.length] };
}

export const isTaxi = (t: CarType): boolean => t === 'taxi' || t === 'taxi2';
