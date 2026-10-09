/**
 * Which city the page is: Tōto (content/world3d, the default) or Manilaya (content/manila, `?city=manila`). Both run on
 * the same engine; this is the one place that says where a city's content lives and the few facts about it the
 * page needs (where you start, its seed, its save slot's name).
 */
import type { CellKind } from '../../gen/macro';
import { MANILA_TREES, TOTO_TREES, type TreeSet } from './treeSets';

export type CityId = 'toto' | 'manila';

export interface CityConfig {
  readonly id: CityId;
  readonly name: string;
  /** Folder under content/ holding the city's files. */
  readonly dir: string;
  /** The node the page starts at (a spawn). */
  readonly startSpawn: string;
  readonly seed: number;
  /** The district kind whose atmosphere rules the sky starts from before a district is known. */
  readonly atmosphereKind: CellKind;
  /** Prefix for localStorage keys that are the city's own (saves). */
  readonly storage: string;
  /** The money's symbol: ¥ in Tōto, ₱ in Manila. */
  readonly currency: string;
  /** Whether the city has ad art (district billboards, posters, taxi photo ads). Manilaya has none until it has Filipino ads: its signs are plain fascia signs. */
  readonly ads: boolean;
  /** Big neon channel letters on the roofs of taller buildings: Tōto's skyline, not Manilaya's. */
  readonly rooftopSigns: boolean;
  /** A tropical city has no seasons to turn: always summer's green, no petals, no leaves, no snow (its rainy season is the forecast's). */
  readonly tropical: boolean;
  /** A Filipino street: corrugated roofs, hollow-block houses, tangled wires, kiosks, banners, parols (real/manilaStreet.ts; zones' `look` keys say where). */
  readonly filipino: boolean;
  /** Boats on the water (real/boats.ts): bangkas, ferries, lighters and anchored ships. */
  readonly boats: boolean;
  /** Radians the sun's path is turned from the engine's (rising east, setting west): Manilaya's bay is to the south, so its sun sets over it. */
  readonly sunYaw: number;
  /** Which trees go where: streets, the bay and river walks, plazas, parks, shrubs (treeSets.ts). */
  readonly trees: TreeSet;
  /** The day's length by season (clock.ts `DayLight`); Tokyo's when absent. */
  readonly daylight?: Readonly<Record<'spring' | 'summer' | 'autumn' | 'winter', { rise: number; set: number; noon: number }>>;
  /** The far mountains in the sky (real/sky.ts): the ranges' azimuth sector [from, fade in to, fade out from, to] and the one cone (a volcano or Fuji) with whether it has snow and a plume. */
  readonly mountains: { readonly sector: readonly [number, number, number, number]; readonly cone: { readonly az: number; readonly width: number; readonly height: number; readonly snow: boolean; readonly plume: number } };
}

export const CITIES: Readonly<Record<CityId, CityConfig>> = {
  toto: { id: 'toto', name: '東都 Tōto', dir: 'world3d', startSpawn: 'kaburo_crossing.view', seed: 0x0c179090, atmosphereKind: 'neon', storage: 'rainyplace', currency: '¥', ads: true, rooftopSigns: true, tropical: false, filipino: false, boats: false, trees: TOTO_TREES, sunYaw: 0, mountains: { sector: [-2.6, -2.25, 0.85, 1.25], cone: { az: -1.95, width: 0.3, height: 0.092, snow: true, plume: 0 } } },
  manila: { id: 'manila', name: 'Manilaya', dir: 'manila', startSpawn: 'bayside.start', seed: 0x4d4e4c31, atmosphereKind: 'neon', storage: 'rainyplace.manila',
    currency: '₱',
    ads: false,
    rooftopSigns: false,
    tropical: true,
    filipino: true,
    boats: true,
    trees: MANILA_TREES,
    // (Rising in the north, setting in the south over the bay: the engine's compass turned a quarter.)
    sunYaw: -Math.PI / 2,
    // Manilaya's sun: up about 5:45 and down about 18:00 all year, nearly overhead at noon in the hot months.
    daylight: {
      spring: { rise: 5 * 60 + 50, set: 18 * 60 + 10, noon: 1.42 },
      summer: { rise: 5 * 60 + 30, set: 18 * 60 + 25, noon: 1.52 },
      autumn: { rise: 5 * 60 + 45, set: 17 * 60 + 45, noon: 1.3 },
      winter: { rise: 6 * 60 + 15, set: 17 * 60 + 40, noon: 1.1 },
    },
    // Low hills to the north and a tall volcano cone rising out of the bay to the south-east, with a thread of steam (after Mayon and Taal).
    mountains: { sector: [-2.3, -1.9, 2.0, 2.4], cone: { az: 2.55, width: 0.2, height: 0.075, snow: false, plume: 1 } },
  },
};

export const isCityId = (s: unknown): s is CityId => s === 'toto' || s === 'manila';

/**
 * The tree set of the city being built (treeSets.ts): set once at start-up, on the page (main.ts) and in each chunk
 * worker's init, as setFoliageVariant is for the foliage. Tōto's until set.
 */
let TREES: TreeSet = TOTO_TREES;
let FILIPINO = false;
export function setTreeSet(id: CityId): void {
  TREES = CITIES[id].trees;
  FILIPINO = CITIES[id].filipino;
}
/** Whether the city being built has Filipino streets (CityConfig.filipino), set with the tree set. */
export const filipino = (): boolean => FILIPINO;
export const treeSet = (): TreeSet => TREES;

/** The city named by `?city=` (Tōto when absent or unknown). */
export function cityFromUrl(search: string = typeof location === 'undefined' ? '' : location.search): CityConfig {
  const c = new URLSearchParams(search).get('city');
  return CITIES[isCityId(c) ? c : 'toto'];
}
