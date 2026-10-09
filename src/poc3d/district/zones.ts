import { isBare, OUTFITS } from './peopleMix';
import YAML from 'yaml';
import { ID_PATTERN } from '../../content/stamps';
import type { DistrictId, MacroMap } from '../../gen/macro';
import { AD_CATEGORIES, type AdCategory } from '../models/ads';
import { CAR_TYPES2 } from '../models/vehicles';
import { WIN } from '../real/buildings';
import { LOT_OPEN, STYLES3, type DistrictStyle3, type Zone3, type ZoneLook } from './plan';

/**
 * Zones: areas within a district with their own character, painted onto its L0 cells.
 *
 *   district: neon
 *   origin: [26, 9]            # L0 cell of the map's first character
 *   area: Kasumi-chō           # optional: the neighbourhood's name in the HUD (else the district style's)
 *   map:                       # one letter per L0 cell; '.' keeps the district's own style
 *     - AAHHLL
 *   zones:
 *     A:
 *       id: back_alleys
 *       name: Back Alleys
 *       plan: { floors: [[2, 4, 70], [5, 7, 30]], lotW: [4, 7], lotGap: 0.35, localStreet: [2.5, 4] }
 *       signs: { words: [質, 金融], colors: ['#ff4f4f'] }
 *       ads: { loan: 4, street: 3 }
 *       look: { windows: { punched: 50, small: 40 }, walls: ['#6c5242'], tiled: true, shops: { warm: 2, bar: 3 }, open: 0.9 }
 *       # look may also set homes (share of buildings that are homes: a door, not a shop), roofs (share of
 *       # low homes with a pitched roof), bikes (share of homes with bicycles out front) and vice (0 to 1: how
 *       # much of the city's vice goes on behind its windows at night, and how many of its buildings have bars
 *       # and clubs upstairs; real/windowScenes.ts).
 *       cars: { luxury: 3, taxi: 4, sedan: 2 }   # optional: the cars parked and driving here, by model
 *       # (models/vehicles.ts); otherwise the district's (district/carMix.ts).
 *       people: { suit: 4, plain: 2 }   # optional: what the people here wear, by outfit (district/peopleMix.ts:
 *       # plain, long, suit, maid, school, kimono); otherwise the district's.
 *       night: 1   # optional: how alive the streets are at night, 0 asleep to 1 sleepless (district/peopleHours.ts);
 *       # otherwise the district's.
 *
 * plan overrides any DistrictStyle3 field (localStreet, block, twoRowDepth, lotW, lotGap, floors,
 * signChance, verticalSign); anything not given comes from the district's style. Zones are part of the
 * generator's input, like L0 and the placements. Open ground and greenery are plan keys too:
 *
 *   open: { parking: 0.06, vacant: 0.02, playground: 0.01 }   # share of lots left open, by kind
 *   rear: [0.5, 2.5]        # metres left behind a building (back yards); setback: the same in front
 *   stepBack: 0.35          # chance a mid-rise steps its top floors back from the street
 *   streetTrees: 0.4        # street trees per slot on streets with pavements; hedges: kerb planting
 *   pots: 0.15              # chance of potted plants outside a building
 *   towerCover: [0.3, 0.45] # towers standing in plazas, covering this share of their block
 *   park: 0.5               # share of each cell given to a park (1: the whole cell)
 *   yardCover: 0.8          # chance a big block is a container yard (the port)
 */
export class ZoneMap {
  constructor(
    readonly zones: readonly Zone3[],
    readonly cells: ReadonlyMap<string, Zone3>,
  ) {}

  static readonly EMPTY = new ZoneMap([], new Map());

  /** Several districts' zone maps as one. */
  static merge(maps: readonly ZoneMap[]): ZoneMap {
    return new ZoneMap(maps.flatMap((m) => m.zones), new Map(maps.flatMap((m) => [...m.cells])));
  }

  at(mx: number, my: number): Zone3 | undefined {
    return this.cells.get(`${mx},${my}`);
  }

  /** Every sign word any zone can use (the sign atlas renders them all up front). */
  words(base: readonly string[]): string[] {
    return [...new Set([...base, ...this.zones.flatMap((z) => z.style.signWords)])];
  }
}

const HEX = /^#[0-9a-f]{6}$/i;
/** Storefront interior kinds, in the order of the city shader's shop palettes. */
const SHOPS = ['warm', 'cool', 'colourful', 'bar'] as const;
const PLAN_KEYS = [
  'localStreet', 'block', 'twoRowDepth', 'lotW', 'lotGap', 'floors', 'signChance', 'verticalSign',
  'open', 'rear', 'setback', 'stepBack', 'streetTrees', 'hedges', 'pots', 'towerCover', 'park', 'yardCover',
] as const;
/** Plan keys that are chances or shares, 0 to 1. */
const SHARES = ['stepBack', 'streetTrees', 'hedges', 'pots', 'park', 'yardCover'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isRange = (v: unknown, min = 1e-9): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n >= min) && v[0] <= v[1];
const hex = (s: string): number => parseInt(s.slice(1), 16);

export function parseZones3(file: string, text: string, macro: MacroMap, errors: string[]): ZoneMap {
  const err = (m: string): void => void errors.push(`${file}: ${m}`);
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return ZoneMap.EMPTY;
  }
  if (!isObj(doc)) return err('expected a mapping'), ZoneMap.EMPTY;
  const district = String(doc.district) as DistrictId;
  const base = STYLES3[district];
  if (!base) return err(`district '${district}' has no 3D style`), ZoneMap.EMPTY;
  if (!isObj(doc.zones)) return err('zones must be a mapping of map letters to zones'), ZoneMap.EMPTY;

  // The neighbourhood's name for the HUD (a district kind spread over several areas, like the residential rings).
  if (doc.area !== undefined && (typeof doc.area !== 'string' || !doc.area.trim())) err('area must be a name');
  const area = typeof doc.area === 'string' && doc.area.trim() ? doc.area.trim() : null;
  const zones = new Map<string, Zone3>();
  for (const [key, raw] of Object.entries(doc.zones)) {
    const at = `zone '${key}'`;
    if (!/^[A-Z]$/.test(key)) err(`${at}: map letters are single capitals`);
    if (!isObj(raw)) {
      err(`${at} must be a mapping`);
      continue;
    }
    const id = String(raw.id);
    if (!ID_PATTERN.test(id)) err(`${at}: id must match ${ID_PATTERN}`);
    if (typeof raw.name !== 'string') err(`${at}: needs a name`);

    const plan = isObj(raw.plan) ? raw.plan : {};
    const style: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(plan)) {
      if (!(PLAN_KEYS as readonly string[]).includes(k)) err(`${at}: unknown plan key '${k}' (${PLAN_KEYS.join(', ')})`);
      else if (k === 'floors') {
        if (!Array.isArray(v) || v.length === 0 || !v.every((b) => Array.isArray(b) && b.length === 3 && b.every((n) => typeof n === 'number' && n > 0) && b[0] <= b[1])) {
          err(`${at}: floors must be a list of [min, max, weight]`);
        } else style.floors = v;
      } else if (k === 'localStreet' || k === 'block' || k === 'lotW') {
        if (!isRange(v)) err(`${at}: ${k} must be [min, max] in metres`);
        else style[k] = v;
      } else if (k === 'rear' || k === 'setback') {
        if (!isRange(v, 0)) err(`${at}: ${k} must be [min, max] in metres`);
        else style[k] = v;
      } else if (k === 'towerCover') {
        if (!isRange(v) || v[1] > 0.9) err(`${at}: towerCover must be [min, max], shares of the block up to 0.9`);
        else style[k] = v;
      } else if (k === 'open') {
        const shares: Record<string, number> = {};
        if (!isObj(v)) err(`${at}: open must map open-lot kinds to shares of lots`);
        else {
          for (const [kind, s] of Object.entries(v)) {
            if (!(LOT_OPEN as readonly string[]).includes(kind)) err(`${at}: unknown open-lot kind '${kind}' (${LOT_OPEN.join(', ')})`);
            else if (typeof s !== 'number' || s < 0 || s > 1) err(`${at}: open.${kind} must be a share of lots, 0 to 1`);
            else shares[kind] = s;
          }
          if (Object.values(shares).reduce((a, b) => a + b, 0) > 0.5) err(`${at}: open lots can't be more than half the lots`);
          style.open = shares;
        }
      } else if (typeof v !== 'number' || v < 0) err(`${at}: ${k} must be a number`);
      else if (SHARES.includes(k) && v > 1) err(`${at}: ${k} must be between 0 and 1`);
      else style[k] = v;
    }
    const signs = isObj(raw.signs) ? raw.signs : {};
    if (signs.words !== undefined) {
      if (!Array.isArray(signs.words) || signs.words.length === 0 || !signs.words.every((w) => typeof w === 'string' && w.trim())) err(`${at}: signs.words must be a list of texts`);
      else style.signWords = signs.words;
    }
    if (signs.colors !== undefined) {
      if (!Array.isArray(signs.colors) || signs.colors.length === 0 || !signs.colors.every((c) => HEX.test(String(c)))) err(`${at}: signs.colors must be a list of '#rrggbb'`);
      else style.signColors = signs.colors.map((c) => hex(String(c)));
    }

    const ads: Partial<Record<AdCategory, number>> = {};
    for (const [k, v] of Object.entries(isObj(raw.ads) ? raw.ads : {})) {
      if (!(AD_CATEGORIES as readonly string[]).includes(k)) err(`${at}: unknown ad category '${k}' (${AD_CATEGORIES.join(', ')})`);
      else if (typeof v !== 'number' || v <= 0) err(`${at}: ad weight for ${k} must be a positive number`);
      else ads[k as AdCategory] = v;
    }

    if (raw.cars !== undefined) {
      const cars: Record<string, number> = {};
      if (!isObj(raw.cars)) err(`${at}: cars must map car models to weights`);
      else {
        for (const [k, v] of Object.entries(raw.cars)) {
          if (!(CAR_TYPES2 as readonly string[]).includes(k)) err(`${at}: unknown car model '${k}' (${CAR_TYPES2.join(', ')})`);
          else if (typeof v !== 'number' || v <= 0) err(`${at}: car weight for ${k} must be a positive number`);
          else cars[k] = v;
        }
        style.cars = cars;
      }
    }

    if (raw.people !== undefined) {
      const people: Record<string, number> = {};
      if (!isObj(raw.people)) err(`${at}: people must map outfits to weights`);
      else {
        for (const [k, v] of Object.entries(raw.people)) {
          if (!(OUTFITS as readonly string[]).includes(k) || isBare(k)) err(`${at}: unknown outfit '${k}' (${OUTFITS.filter((o) => !isBare(o)).join(', ')})`);
          else if (typeof v !== 'number' || v <= 0) err(`${at}: outfit weight for ${k} must be a positive number`);
          else people[k] = v;
        }
        style.people = people;
      }
    }

    if (raw.night !== undefined) {
      if (typeof raw.night !== 'number' || raw.night < 0 || raw.night > 1) err(`${at}: night must be a number from 0 (asleep at night) to 1 (sleepless)`);
      else style.night = raw.night;
    }

    const lookRaw = isObj(raw.look) ? raw.look : {};
    let windows: [number, number][] | null = null;
    if (lookRaw.windows !== undefined) {
      if (!isObj(lookRaw.windows)) err(`${at}: look.windows must map window types to weights`);
      else {
        windows = [];
        for (const [k, v] of Object.entries(lookRaw.windows)) {
          if (!(k in WIN)) err(`${at}: unknown window type '${k}' (${Object.keys(WIN).join(', ')})`);
          else if (typeof v !== 'number' || v <= 0) err(`${at}: window weight for ${k} must be a positive number`);
          else windows.push([v, WIN[k as keyof typeof WIN]]);
        }
      }
    }
    let walls: number[] | null = null;
    if (lookRaw.walls !== undefined) {
      if (!Array.isArray(lookRaw.walls) || lookRaw.walls.length === 0 || !lookRaw.walls.every((c) => HEX.test(String(c)))) err(`${at}: look.walls must be a list of '#rrggbb'`);
      else walls = lookRaw.walls.map((c) => hex(String(c)));
    }
    let shops: [number, number][] | null = null;
    if (lookRaw.shops !== undefined) {
      if (!isObj(lookRaw.shops)) err(`${at}: look.shops must map shop kinds to weights`);
      else {
        shops = [];
        for (const [k, v] of Object.entries(lookRaw.shops)) {
          const pal = SHOPS.indexOf(k as (typeof SHOPS)[number]);
          if (pal < 0) err(`${at}: unknown shop kind '${k}' (${SHOPS.join(', ')})`);
          else if (typeof v !== 'number' || v <= 0) err(`${at}: shop weight for ${k} must be a positive number`);
          else shops.push([v, pal]);
        }
      }
    }
    const open = lookRaw.open === undefined ? null : Number(lookRaw.open);
    if (open !== null && !(open >= 0 && open <= 1)) err(`${at}: look.open must be between 0 and 1`);
    const share = (key: 'homes' | 'roofs' | 'bikes' | 'vice' | 'block' | 'arch' | 'street' | 'church' | 'informal'): number => {
      if (lookRaw[key] === undefined) return 0;
      const v = Number(lookRaw[key]);
      if (!(v >= 0 && v <= 1)) err(`${at}: look.${key} must be between 0 and 1`);
      return v;
    };
    const look: ZoneLook = { windows, walls, tiled: lookRaw.tiled === true, shops, open, homes: share('homes'), roofs: share('roofs'), bikes: share('bikes'), vice: share('vice'), block: share('block'), arch: share('arch'), church: share('church'), informal: share('informal'), street: share('street'), vending: lookRaw.vending === undefined ? null : Math.min(1, Math.max(0, Number(lookRaw.vending))) };
    zones.set(key, { key, id, name: String(raw.name), style: style as unknown as DistrictStyle3, look, ads, area });
  }
  const ids = [...zones.values()].map((z) => z.id);
  if (new Set(ids).size !== ids.length) err('zone ids must be unique');

  const cells = new Map<string, Zone3>();
  const origin = doc.origin;
  if (!Array.isArray(origin) || origin.length !== 2 || !origin.every((n) => Number.isInteger(n))) err('origin must be [col, row] of an L0 cell');
  else if (!Array.isArray(doc.map) || !doc.map.every((r) => typeof r === 'string')) err('map must be a list of rows');
  else {
    const rows = doc.map as string[];
    if (rows.some((r) => r.length !== rows[0].length)) err('map rows must all be the same width');
    rows.forEach((row, dy) => {
      [...row].forEach((ch, dx) => {
        if (ch === '.') return;
        const [mx, my] = [origin[0] + dx, origin[1] + dy];
        const z = zones.get(ch);
        if (!z) err(`map row ${dy + 1} col ${dx + 1}: no zone '${ch}'`);
        else if (macro.kindAt(mx, my) !== district) err(`map row ${dy + 1} col ${dx + 1}: L0 cell [${mx}, ${my}] is not in district '${district}'`);
        else cells.set(`${mx},${my}`, z);
      });
    });
    const used = new Set(cells.values());
    for (const z of zones.values()) if (!used.has(z)) err(`zone '${z.key}' (${z.id}) is not on the map`);
  }
  return new ZoneMap([...zones.values()], cells);
}
