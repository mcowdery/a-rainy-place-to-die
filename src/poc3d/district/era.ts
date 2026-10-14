import { hash } from '../../core/hash';
import type { GradeName } from '../real/grade';
import type { CarType } from '../models/vehicles';
import type { Placed3 } from './stamps';

/**
 * The city in another year: the same map, streets and lots, with what differed then (story/threads/the-old-case.md:
 * the user wants to see how the city changed, in the 1970s and the 1960s). An era is a setting, not a copy of the
 * city: the plan asks it how tall a building may stand and which plaza towers are up, the content loader asks it
 * which landmarks weren't built yet, the chunk builder whether there is ad art, the car mix which cars were on the
 * road. 1992 is the game's own year and changes nothing.
 *
 * `?era=1977` on the city's page. Set once at start-up, on the page (main.ts) and in each chunk worker's init, as the
 * city's tree set is (cityConfig.ts): the plan is cached, so an era can't change under a running city.
 *
 * **A first cut, to see what an era costs** (2026-10-13). It uses only what the game already has: no model, sign,
 * advert or outfit here was made for 1977 or 1964, and the figures below are from memory, not checked.
 */
export type EraId = '1992' | '1977' | '1964';

export interface Era {
  readonly id: EraId;
  readonly year: number;
  /**
   * Buildings put up on ordinary lots stand no taller than this (metres); null for no limit. Japan held buildings to
   * 31 m (a hundred shaku) until the 1960s, so most of a 1977 street is still at or under it.
   */
  readonly cap: number | null;
  /** The share of taller buildings that stand above the cap anyway (built since the limit went), and how tall those may be. */
  readonly newShare: number;
  readonly newCap: number;
  /** The share of plaza towers that are up; the rest of their plazas are cleared ground waiting for one. */
  readonly towers: number;
  /** Whether the city has its ad art (photo billboards, posters, taxi ads: all of it made in a late-80s look). */
  readonly ads: boolean;
  /** The cars on the road; a car of any other type is one of `standIn` instead. null: every type. */
  readonly cars: readonly CarType[] | null;
  /** What takes the place of a type the year hadn't, by weight (a type listed twice is twice as likely): the year's ordinary cars. */
  readonly standIn: readonly CarType[];
  /**
   * The date the older city's card shows (month, day, weekday 0 = Sunday). **A placeholder** (the user, 2026-10-13: "let's add it"):
   * the story hasn't dated its tellings. 1977's is a Friday, as the game's own first day is; 1964's is the day before the
   * Olympic Games opened, a Friday too (both weekdays worked out from the calendar, not looked up).
   */
  readonly date: { readonly month: number; readonly day: number; readonly weekday: number } | null;
  /** The colour grade the page starts in (real/grade.ts), unless `?grade=` says otherwise: the year's film. */
  readonly grade: GradeName;
  /** Placements (their ids) not built yet: an ordinary building of the street stands on the plot. */
  readonly unbuilt: readonly string[];
}

/**
 * The 1970s street (models/vehicles.ts `SEVENTIES_TYPES`, approved in the showroom 2026-10-14): the square family
 * saloon, a few GT coupes and bubble kei cars, the big hardtop, the classic taxi, the work vehicles and the patrol car.
 * The newer taxi, the minivan, the tall kei wagon, the hatchbacks and the rest are 1980s and 1990s.
 */
const OLD_CARS: readonly CarType[] = ['box70', 'coupe70', 'kei70', 'hardtop', 'taxi', 'keitruck', 'van', 'boxtruck', 'police'];
/** What an ordinary 1970s car is, by weight: mostly the square saloon. */
const OLD_STAND_IN: readonly CarType[] = ['box70', 'box70', 'box70', 'box70', 'kei70', 'kei70', 'coupe70', 'hardtop'];

export const ERAS: Readonly<Record<EraId, Era>> = {
  '1992': { id: '1992', year: 1992, cap: null, newShare: 1, newCap: Infinity, towers: 1, ads: true, cars: null, standIn: [], date: null, grade: 'neutral', unbuilt: [] },
  // The neon district first: the crossing's sign with its video screens and the discount store are later than this.
  '1977': { id: '1977', year: 1977, cap: 31, newShare: 0.14, newCap: 48, towers: 0.3, ads: false, cars: OLD_CARS, standIn: OLD_STAND_IN, date: { month: 10, day: 14, weekday: 5 }, grade: 'seventies', unbuilt: ['kaburo_crossing', 'yasuichi'] },
  // Defined so the setting has its second step; not looked at yet.
  '1964': { id: '1964', year: 1964, cap: 31, newShare: 0, newCap: 31, towers: 0, ads: false, cars: OLD_CARS, standIn: OLD_STAND_IN, date: { month: 10, day: 9, weekday: 5 }, grade: 'sixties', unbuilt: ['kaburo_crossing', 'yasuichi', 'hotel_rouge', 'yoru_mart'] },
};

export const isEraId = (s: unknown): s is EraId => s === '1992' || s === '1977' || s === '1964';

let ERA: Era = ERAS['1992'];
/** The era being built (1992 until set). */
export const era = (): Era => ERA;
export function setEra(id: EraId): void {
  ERA = ERAS[id];
}

/** The era named by `?era=` (1992 when absent or unknown). */
export function eraFromUrl(search: string = typeof location === 'undefined' ? '' : location.search): EraId {
  const e = new URLSearchParams(search).get('era');
  return isEraId(e) ? e : '1992';
}

const unit = (x: number, z: number, salt: number): number => hash((Math.round(x * 8) * 73856093) ^ (Math.round(z * 8) * 19349663), salt) / 4294967296;

/**
 * How tall a lot's building stands in this era, given the height the plan rolled for it (by its place, not by the
 * plan's own dice, so the plan rolls the same in every era and only the result differs). Under the cap, as rolled;
 * over it, a few stand tall, the rest come down to the cap or a storey or two under it, so the roofline isn't ruled.
 */
export function eraHeight(h: number, x: number, z: number): number {
  const e = ERA;
  if (e.cap === null || h <= e.cap) return h;
  if (unit(x, z, 0xe7a1) < e.newShare) return Math.min(h, e.newCap);
  return e.cap - 3 * Math.floor(unit(x, z, 0xe7a2) * 4);
}

/** Whether the plaza tower centred here is up in this era. */
export const eraTower = (x: number, z: number): boolean => ERA.towers >= 1 || unit(x, z, 0xe7a3) < ERA.towers;

/** The car type on the road in this era for one the mix picked. */
export function eraCar(type: CarType, seed: number): CarType {
  const cars = ERA.cars;
  if (!cars || cars.includes(type)) return type;
  // (An ordinary car takes an ordinary car's place: never a taxi or the patrol car, and never a lorry.)
  return ERA.standIn[hash(seed, 0xe7a4) % ERA.standIn.length];
}

/**
 * The placements as they stand in this era: one not built yet keeps its plot (so the streets and lots round it are
 * the same in every year) but is an ordinary building there, no taller than the era allows, with no name, signs or
 * story nodes. Its spawns stay: they are places to stand, and the city starts at one.
 */
export function eraPlaced(placed: readonly Placed3[]): readonly Placed3[] {
  const e = ERA;
  if (e.unbuilt.length === 0) return placed;
  return placed.map((p) =>
    e.unbuilt.includes(p.id)
      ? {
          ...p,
          stamp: { ...p.stamp, landmark: null, name: null, signs: [], nodes: p.stamp.nodes.filter((n) => n.kind === 'spawn') },
          building: { ...p.building, h: e.cap === null ? p.building.h : Math.min(p.building.h, e.cap) },
          signs: [],
          nodes: p.nodes.filter((n) => n.kind === 'spawn'),
        }
      : p,
  );
}
