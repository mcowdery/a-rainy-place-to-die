import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import type { Interior } from './interiors';
import { Kit, text } from './kit';
import { localFrame, localRect, toLocal, toWorld, type LocalFrame } from './localFrame';
import { EMIT, KIND, lin } from './meshBuilder';

/**
 * 東都百貨店 Toto Department Store, inside: a walk-in interior at the building's true position (see
 * interiors.ts). You walk in through the entrance on the street; the interior switches on as you cross the
 * threshold. Three storeys joined by escalators you can ride (stand still and they carry you):
 *
 *   B1  食料品 the food hall (depachika): wagashi, patisserie, bakery, tea, sushi, deli, tempura, bento
 *       along the walls; fruit, sake, fish and chocolate islands; an eat-in counter, the tills.
 *   1F  化粧品・雑貨 cosmetics and accessories: the entrance vestibule, the information desk, six brand
 *       islands under chandeliers, handbags and jewellery, a spring fair stage.
 *   2F  婦人服 women's fashion: eight boutiques (one a kimono shop), a runway of mannequins, Café Toto,
 *       the ladies' lounge.
 *   R   屋上 the rooftop garden (part of the exterior, so it shows from outside): lawn, a small Inari
 *       shrine, a carousel and coin rides, an udon stand, telescopes over the city. Elevators on every
 *       floor go up to it.
 *
 * Everything is in the building's local frame (u along the street face, t inward). The layout (collision,
 * floors, escalators) is data, so it's testable without building the geometry.
 */

/** The store's footprint and height (the exterior in asagiri.ts is built to it). */
export const DEPT = { w: 44, d: 58, h: 62 } as const;
/** Floor levels: the food hall, the ground floor, fashion, the rooftop. */
export const DEPT_FLOORS = { b1: -5, f1: 0, f2: 6, roof: DEPT.h + 1.2 } as const;
const { b1: B1, f1: F1, f2: F2, roof: ROOF } = DEPT_FLOORS;
const CEIL_B1 = -1.2;
const CEIL_1F = 5.0;
const CEIL_2F = 10.6;
/** Inner faces of the outer walls. */
const IN = { u0: 0.3, u1: 43.7, t0: 1.5, t1: 57.7 } as const;
/** The street entrance (a gap in the show windows), and the vestibule's inner glass wall. */
export const DEPT_DOOR = { u0: 17.5, u1: 27.5 } as const;
const VEST = 4.2;
/** The show windows' back wall inside, either side of the vestibule. */
const SHOW = 3.0;

interface Escalator {
  readonly u0: number;
  readonly u1: number;
  /** The run: bottom at t0 (y0), top at t1 (y1). */
  readonly t0: number;
  readonly t1: number;
  readonly y0: number;
  readonly y1: number;
}
/** Two lanes each: up on the low-u side (carries +t), down on the other (carries -t). 30 degrees. */
const ESC_UP: Escalator = { u0: 16.2, u1: 19.2, t0: 26, t1: 26 + (F2 - F1) * Math.sqrt(3), y0: F1, y1: F2 };
const ESC_DN: Escalator = { u0: 25, u1: 28, t0: 26, t1: 26 + (F1 - B1) * Math.sqrt(3), y0: B1, y1: F1 };
const ESCALATORS = [ESC_UP, ESC_DN] as const;
const LANE = 1.4;
/** Horizontal speed of the escalators (m/s). */
const CARRY = 0.55;
const COLS_U = [11, 33] as const;
const COLS_T = [13, 24, 35, 46] as const;
/** Elevator doors on the back wall (centres). */
const LIFTS = [16.5, 20.5, 24.5, 28.5] as const;

type R4 = readonly [number, number, number, number];

// ---- Fixtures, as data: the geometry draws them, the collision is their footprints ----

interface Island {
  readonly name: string;
  readonly sub: string;
  readonly bg: string;
  readonly fg: string;
  readonly body: number;
  readonly floor: number;
  readonly products: readonly number[];
  readonly u0: number;
  readonly u1: number;
  readonly t0: number;
  readonly t1: number;
}
/** 1F: the cosmetics brands (all invented), each an island of counters round a lit tower. */
const BRANDS: readonly Island[] = [
  { name: 'LUMIÈRE', sub: 'PARIS · TOKYO', bg: '#f6f1e8', fg: '#a8843a', body: 0xf4efe6, floor: 0xe8dcc4, products: [0xc8a860, 0xf4e8d0, 0xd8b8a0, 0x8a6a3a], u0: 2.5, u1: 8.5, t0: 6, t1: 10.5 },
  { name: 'KAORI', sub: '香り 化粧品', bg: '#f8e0e8', fg: '#b83a6a', body: 0xf8e4ec, floor: 0xf0d0dc, products: [0xe85a8a, 0xf4b8c8, 0xffffff, 0xc83a5a], u0: 2.5, u1: 8.5, t0: 15.5, t1: 20 },
  { name: 'NOIR ROSE', sub: 'MAQUILLAGE', bg: '#121214', fg: '#e8364a', body: 0x18181a, floor: 0x2a2a2e, products: [0xc8202a, 0x0a0a0a, 0xe8c8a0, 0x8a1020], u0: 12.5, u1: 18.5, t0: 9.5, t1: 14 },
  { name: 'HANA', sub: '花 SKINCARE', bg: '#eef4e4', fg: '#4a7a3a', body: 0xf0f4e8, floor: 0xd8e4c8, products: [0x8ab86a, 0xf4f4e8, 0xc8d8a0, 0xe8a0b0], u0: 26.5, u1: 32.5, t0: 9.5, t1: 14 },
  { name: 'VELVET', sub: 'NEW YORK', bg: '#2a1838', fg: '#d8b8f0', body: 0x3a2448, floor: 0x4a3458, products: [0x8a4ac8, 0xd8b8f0, 0x2a1838, 0xc8a0e8], u0: 35.5, u1: 41.5, t0: 6, t1: 10.5 },
  { name: 'SORA', sub: '空 COSMETICS', bg: '#e4f0f8', fg: '#2a6aa8', body: 0xe8f2f8, floor: 0xc8dcea, products: [0x5a9ad8, 0xffffff, 0xa8d0f0, 0x2a5a8a], u0: 35.5, u1: 41.5, t0: 15.5, t1: 20 },
];

type Goods = 'wagashi' | 'cake' | 'bread' | 'tea' | 'sushi' | 'deli' | 'tempura' | 'bento' | 'fruit' | 'sake' | 'fish' | 'choco';
interface Stall {
  readonly name: string;
  readonly en: string;
  readonly bg: string;
  readonly fg: string;
  readonly wall: number;
  readonly goods: Goods;
  /** Against the left (L) or right (R) wall, or an island (I). */
  readonly side: 'L' | 'R' | 'I';
  readonly u0: number;
  readonly u1: number;
  readonly t0: number;
  readonly t1: number;
}
const STALL_DEPTH = 4.6;
const wallStall = (side: 'L' | 'R', t0: number, t1: number): Pick<Stall, 'side' | 'u0' | 'u1' | 't0' | 't1'> =>
  side === 'L' ? { side, u0: IN.u0, u1: IN.u0 + STALL_DEPTH, t0, t1 } : { side, u0: IN.u1 - STALL_DEPTH, u1: IN.u1, t0, t1 };
/** B1: the food hall's counters. */
const STALLS: readonly Stall[] = [
  { name: '和菓子', en: 'WAGASHI · 京都 鶴屋', bg: '#5a1a2a', fg: '#f8e8d0', wall: 0x8a5a4a, goods: 'wagashi', ...wallStall('L', 2, 12) },
  { name: '洋菓子', en: 'PÂTISSERIE MIYU', bg: '#f8f0f4', fg: '#b04a6a', wall: 0xf4e4ea, goods: 'cake', ...wallStall('L', 13, 23) },
  { name: 'パン', en: 'BOULANGERIE', bg: '#6a4a2a', fg: '#f8e8c8', wall: 0xa8804a, goods: 'bread', ...wallStall('L', 24, 34) },
  { name: '日本茶', en: 'TEA · 宇治', bg: '#2a4a2a', fg: '#e8f0d8', wall: 0x5a7a4a, goods: 'tea', ...wallStall('L', 35, 45) },
  { name: '寿司', en: 'SUSHI 魚河岸', bg: '#f4f0e6', fg: '#1a2a4a', wall: 0xe8e0d0, goods: 'sushi', ...wallStall('R', 2, 12) },
  { name: '惣菜', en: 'DELI 旬彩', bg: '#2a3a2a', fg: '#f4d890', wall: 0x6a5a3a, goods: 'deli', ...wallStall('R', 13, 23) },
  { name: '天ぷら', en: 'TEMPURA · 揚げ物', bg: '#e8a830', fg: '#2a1a0a', wall: 0xc88a3a, goods: 'tempura', ...wallStall('R', 24, 34) },
  { name: '弁当', en: 'BENTO 駅弁', bg: '#a81e1e', fg: '#ffffff', wall: 0x7a2a2a, goods: 'bento', ...wallStall('R', 35, 45) },
  { name: '果物', en: 'FRUIT 千疋', bg: '#f8f4e0', fg: '#3a7a2a', wall: 0xe8e0c0, goods: 'fruit', side: 'I', u0: 13, u1: 21, t0: 6, t1: 12 },
  { name: '酒', en: 'SAKE & WINE', bg: '#1a1a2a', fg: '#e8c870', wall: 0x3a2a1e, goods: 'sake', side: 'I', u0: 13, u1: 21, t0: 15, t1: 21 },
  { name: '鮮魚', en: 'FISH 築地', bg: '#1a3a6a', fg: '#ffffff', wall: 0xd8e4ec, goods: 'fish', side: 'I', u0: 26, u1: 34, t0: 6, t1: 12 },
  { name: 'ショコラ', en: 'CHOCOLATIER', bg: '#2a1810', fg: '#e8c070', wall: 0x3a241a, goods: 'choco', side: 'I', u0: 26, u1: 32, t0: 15, t1: 21 },
];

interface Shop {
  readonly name: string;
  readonly sub: string;
  readonly bg: string;
  readonly fg: string;
  readonly wall: number;
  readonly clothes: readonly number[];
  readonly side: 'L' | 'R';
  readonly t0: number;
  readonly kimono?: boolean;
}
const SHOP_LEN = 10;
const SHOP_DEPTH = 9;
/** 2F: the boutiques, four down each side wall. */
const SHOPS: readonly Shop[] = [
  { name: 'MAISON AOI', sub: 'メゾン・アオイ', bg: '#1e2a3a', fg: '#e8eef4', wall: 0xdce4ec, clothes: [0x2a3a5a, 0xe8ecf0, 0x8aa0b8, 0x3a4a5a, 0xc8d0d8], side: 'L', t0: 2 },
  { name: 'rue de Kaburo', sub: 'リュ・ド・カブロ', bg: '#f4ece0', fg: '#6a3a2a', wall: 0xf0e4d4, clothes: [0xc8784a, 0xe8d8b8, 0x8a4a2a, 0xf4ece0, 0x5a3a2a], side: 'L', t0: 13 },
  { name: 'Sakura & Co.', sub: 'サクラ・アンド・コー', bg: '#f8dce4', fg: '#a02a5a', wall: 0xf8e8ee, clothes: [0xf4a0b8, 0xffffff, 0xe85a8a, 0xf8d0dc, 0xc83a6a], side: 'L', t0: 24 },
  { name: 'ÉTOILE', sub: 'エトワール', bg: '#101014', fg: '#e8d090', wall: 0x2a2a30, clothes: [0x101014, 0xe8d090, 0x6a1a2a, 0x2a2a3a, 0xf0f0f0], side: 'L', t0: 35 },
  { name: 'LUNA', sub: 'ルナ', bg: '#e8e4f4', fg: '#4a3a8a', wall: 0xe8e4f4, clothes: [0x8a7ac8, 0xe8e4f4, 0x4a3a8a, 0xc8c0e8, 0x2a2440], side: 'R', t0: 2 },
  { name: '和装 きもの', sub: 'KIMONO 京屋', bg: '#3a0e14', fg: '#f0d8a0', wall: 0xc8b890, clothes: [0xa01a2a, 0x1a2a5a, 0xe8c8d0, 0x2a5a3a], side: 'R', t0: 13, kimono: true },
  { name: 'Tokyo Knit', sub: '東京ニット', bg: '#e8dcc8', fg: '#5a4a3a', wall: 0xece2d2, clothes: [0xc8a878, 0x8a9a6a, 0xe8d8c0, 0xa85a4a, 0x6a7a8a], side: 'R', t0: 24 },
  { name: 'MODE 21', sub: 'モード21', bg: '#e8202a', fg: '#ffffff', wall: 0xf4f4f4, clothes: [0xe8202a, 0x101010, 0xffffff, 0xf4d020, 0x2a6ae8], side: 'R', t0: 35 },
];
/** Depth from the shop's wall to local u. */
const shopU = (s: Pick<Shop, 'side'>, a: number): number => (s.side === 'L' ? IN.u0 + a : IN.u1 - a);

// Fixed fixtures per floor (local rects), besides the brands, stalls and shops above.
const INFO_DESK: R4 = [28, 32, 6.2, 7.2];
const STAGE_1F: R4 = [19.6, 24.6, 40, 44];
const CASES_1F: readonly R4[] = [[4, 8, 28, 30.5], [4, 8, 38, 40.5], [36, 40, 28, 30.5], [36, 40, 38, 40.5]];
const BAG_WALLS: readonly R4[] = [[IN.u0, IN.u0 + 0.7, 24, 50], [IN.u1 - 0.7, IN.u1, 24, 44]];
const WRAP_DESK: R4 = [37, 42, 47, 48.2];
const GUIDE: R4 = [12.8, 14.2, 25.2, 25.5];
const RUNWAY: R4 = [14, 30, 6, 9];
const TABLES_2F: readonly R4[] = [[12.5, 14.5, 14, 16], [29.5, 31.5, 14, 16], [21, 23, 16, 18]];
const CAFE = { u0: 32, u1: IN.u1, t0: 47, t1: IN.t1 } as const;
const CAFE_COUNTER: R4 = [41.6, IN.u1, 48, 56.5];
const CAFE_TABLES: readonly (readonly [number, number])[] = [[34.5, 49.5], [37.5, 49.5], [34.5, 53], [37.5, 53]];
const LOUNGE_SOFAS: readonly R4[] = [[1.5, 2.4, 48, 55], [4, 8, 48, 48.9], [4, 8, 54.4, 55.3]];
const EAT_IN: R4 = [1, 11, 51.5, 52.5];
const TILLS: readonly R4[] = [[34, 36, 49, 50], [37.5, 39.5, 49, 50], [41, 43, 49, 50]];

// ---- Layout: collision per level, floors, escalators ----

function laneWalls(e: Escalator, ta: number, tb: number): R4[] {
  return [
    [e.u0 - 0.2, e.u0, ta, tb],
    [e.u1, e.u1 + 0.2, ta, tb],
    [e.u0 + LANE, e.u1 - LANE, ta, tb],
  ];
}
const COLUMNS: R4[] = COLS_U.flatMap((u) => COLS_T.map((t): R4 => [u - 0.45, u + 0.45, t - 0.45, t + 0.45]));
const OUTER: R4[] = [
  [0, IN.u0, 1.2, DEPT.d],
  [IN.u1, DEPT.w, 1.2, DEPT.d],
  [0, DEPT.w, IN.t1, DEPT.d],
];
const pad = (r: R4, du: number, dt: number): R4 => [r[0] - du, r[1] + du, r[2] - dt, r[3] + dt];
const tableAt = (u: number, t: number): R4 => [u - 1.05, u + 1.05, t - 0.5, t + 0.5];

/** Local collision rects for each level. */
function levelRects(): { b1: R4[]; f1: R4[]; f2: R4[] } {
  const front: R4[] = [[0, DEPT.w, 1.2, IN.t0]];
  const b1: R4[] = [
    ...OUTER,
    ...front,
    ...COLUMNS,
    ...laneWalls(ESC_DN, ESC_DN.t0 - 0.9, ESC_DN.t1),
    [ESC_DN.u0 - 0.2, ESC_DN.u1 + 0.2, ESC_DN.t1, ESC_DN.t1 + 0.2],
    ...STALLS.map((s) => (s.side === 'I' ? pad([s.u0, s.u1, s.t0, s.t1], 0, 0) : ([s.u0, s.u1, s.t0, s.t1] as R4))),
    EAT_IN,
    [1, 11, 55.3, 55.4],
    ...TILLS,
  ];
  const f1: R4[] = [
    ...OUTER,
    [0, DEPT_DOOR.u0, 1.2, SHOW],
    [DEPT_DOOR.u1, DEPT.w, 1.2, SHOW],
    [DEPT_DOOR.u0, DEPT_DOOR.u0 + 0.2, 1.2, VEST + 0.1],
    [DEPT_DOOR.u1 - 0.2, DEPT_DOOR.u1, 1.2, VEST + 0.1],
    [DEPT_DOOR.u0, 20, 1.2, IN.t0],
    [25, DEPT_DOOR.u1, 1.2, IN.t0],
    [25.6, 26.4, 3.3, 3.8],
    [DEPT_DOOR.u0, 20, VEST - 0.1, VEST + 0.1],
    [25, DEPT_DOOR.u1, VEST - 0.1, VEST + 0.1],
    ...COLUMNS,
    ...laneWalls(ESC_UP, ESC_UP.t0 - 0.9, ESC_UP.t1),
    ...laneWalls(ESC_DN, ESC_DN.t0, ESC_DN.t1 + 0.9),
    [ESC_DN.u0 - 0.2, ESC_DN.u1 + 0.2, ESC_DN.t0 - 0.2, ESC_DN.t0],
    ...BRANDS.map((b) => pad([b.u0, b.u1, b.t0, b.t1], 0, 0.5)),
    INFO_DESK,
    STAGE_1F,
    ...CASES_1F,
    ...BAG_WALLS,
    WRAP_DESK,
    GUIDE,
  ];
  const f2: R4[] = [
    ...OUTER,
    ...front,
    ...COLUMNS,
    ...laneWalls(ESC_UP, ESC_UP.t0, ESC_UP.t1 + 0.9),
    [ESC_UP.u0 - 0.2, ESC_UP.u1 + 0.2, ESC_UP.t0 - 0.2, ESC_UP.t0],
    ...SHOPS.flatMap((s) => shopRects(s)),
    RUNWAY,
    ...TABLES_2F,
    CAFE_COUNTER,
    ...CAFE_TABLES.map(([u, t]) => tableAt(u, t)),
    ...LOUNGE_SOFAS,
    [4.6, 7.4, 50.4, 52.9],
    [10.1, 10.9, 49.6, 50.4],
  ];
  return { b1, f1, f2 };
}

/** A boutique's fixtures: its partitions, wall rack, middle rack, fitting rooms, table and mannequins. */
function shopRects(s: Shop): R4[] {
  const U = (a0: number, a1: number): [number, number] => {
    const x = shopU(s, a0);
    const y = shopU(s, a1);
    return [Math.min(x, y), Math.max(x, y)];
  };
  const t0 = s.t0;
  const t1 = s.t0 + SHOP_LEN;
  const R = (a0: number, a1: number, ta: number, tb: number): R4 => [...U(a0, a1), ta, tb];
  if (s.kimono) {
    return [
      R(0, 6.5, t0 - 0.06, t0 + 0.06),
      R(0, 6.5, t1 - 0.06, t1 + 0.06),
      R(1, 3, t1 - 1.6, t1),
      R(1.5, 4.5, t0 + 2.5, t0 + 7.5),
      R(5.85, 6.15, t0 + 1.3, t0 + 3.7),
      R(5.85, 6.15, t0 + 6.1, t0 + 8.5),
      R(7.5, 8.6, t0 + 1.4, t0 + 7.6),
    ];
  }
  return [
    R(0, 6.5, t0 - 0.06, t0 + 0.06),
    R(0, 6.5, t1 - 0.06, t1 + 0.06),
    R(0, 0.9, t0, t1),
    R(1, 3, t1 - 1.6, t1),
    R(3.4, 4.2, t0 + 1.5, t0 + 6),
    R(5.3, 6.9, t0 + 6.8, t0 + 8.4),
    R(7.5, 8.6, t0 + 1.4, t0 + 7.6),
  ];
}

/** Which escalator lane a local point is on, and the ramp's height there. */
function onLane(u: number, t: number): { e: Escalator; y: number; dir: 1 | -1 } | null {
  for (const e of ESCALATORS) {
    if (u <= e.u0 || u >= e.u1 || t <= e.t0 || t >= e.t1) continue;
    const y = e.y0 + ((t - e.t0) / (e.t1 - e.t0)) * (e.y1 - e.y0);
    return { e, y, dir: u < e.u0 + LANE + 0.1 ? 1 : -1 };
  }
  return null;
}

/** The store's layout alone (collision, floors, escalators, what counts as inside), without its geometry. */
export function deptLayout(b: Building3): Omit<Interior, 'group'> {
  const f = localFrame(b);
  const W = (rs: readonly R4[]): Rect[] => rs.map((r) => localRect(f, r[0], r[1], r[2], r[3]));
  const lv = levelRects();
  const b1 = W(lv.b1);
  const f1 = W(lv.f1);
  const f2 = W(lv.f2);
  const inFoot = (u: number, t: number): boolean => u > IN.u0 && u < IN.u1 && t > IN.t0 && t < IN.t1;
  return {
    colliders: (floor) => (floor < -1 ? b1 : floor > 1 ? f2 : f1),
    floorAt(x, z, current) {
      const [u, t] = toLocal(f, x, z);
      if (!inFoot(u, t)) return null;
      const lane = onLane(u, t);
      if (lane && Math.abs(lane.y - current) < 1.5) return lane.y;
      return current < (B1 + F1) / 2 ? B1 : current > (F1 + F2) / 2 ? F2 : F1;
    },
    contains(x, z, y) {
      const [u, t] = toLocal(f, x, z);
      return y > B1 - 1.5 && y < DEPT.h && inFoot(u, t);
    },
    carry(x, z, level) {
      const [u, t] = toLocal(f, x, z);
      const lane = onLane(u, t);
      if (!lane || Math.abs(lane.y - level) > 1.5) return null;
      // +t is inward: world -n.
      return [-f.n[0] * CARRY * lane.dir, -f.n[2] * CARRY * lane.dir];
    },
  };
}

/** Where the street's ground is cut away: the escalator well down to the food hall. */
export function deptHoles(b: Building3): Rect[] {
  return [localRect(localFrame(b), ESC_DN.u0 - 0.2, ESC_DN.u1 + 0.2, ESC_DN.t0, ESC_DN.t1)];
}

// ---- The rooftop garden (built with the exterior; see asagiri.ts) ----

const ROOF_HOUSE: R4 = [16, 29, 50, 57.2];
const CAROUSEL = { u: 33, t: 24, r: 3.6 } as const;
const RIDES: readonly (readonly [number, number, number])[] = [
  [31, 10, 0xf4f4f0],
  [34, 10, 0x9aa0a8],
  [37, 10, 0xe8303a],
];
const UDON: R4 = [34, 42, 47, 52];
const SHRINE: R4 = [3.5, 9.5, 46, 53];
const TELESCOPES: readonly number[] = [9, 22.5, 36];
const PLANTERS: readonly (readonly [number, number])[] = [[3, 5], [41, 5], [3, 36], [41, 36], [12, 44]];

/** Floor on the roof, for a walker already up there. */
export function deptRoofFloor(b: Building3, x: number, z: number, current: number): number | null {
  if (current < DEPT.h / 2) return null;
  const [u, t] = toLocal(localFrame(b), x, z);
  return u > 0 && u < DEPT.w && t > 1.2 && t < DEPT.d ? ROOF : null;
}

/** Collision on the roof: the safety fence and what stands on it. */
export function deptRoofColliders(b: Building3): Rect[] {
  const f = localFrame(b);
  const rs: R4[] = [
    [0, DEPT.w, 1.2, 2.1],
    [0, DEPT.w, 56.9, DEPT.d],
    [0, 1.1, 1.2, DEPT.d],
    [42.9, DEPT.w, 1.2, DEPT.d],
    ROOF_HOUSE,
    [29.4, 31.6, 55.4, 56.9],
    [CAROUSEL.u - CAROUSEL.r, CAROUSEL.u + CAROUSEL.r, CAROUSEL.t - CAROUSEL.r, CAROUSEL.t + CAROUSEL.r],
    ...RIDES.map(([u, t]): R4 => [u - 0.7, u + 0.7, t - 0.5, t + 0.5]),
    UDON,
    SHRINE,
    [3.6, 4.0, 44.6, 45.0],
    [8.9, 9.3, 44.6, 45.0],
    ...TELESCOPES.map((u): R4 => [u - 0.3, u + 0.3, 2.3, 2.9]),
    ...PLANTERS.map(([u, t]): R4 => [u - 0.8, u + 0.8, t - 0.8, t + 0.8]),
  ];
  return rs.map((r) => localRect(f, r[0], r[1], r[2], r[3]));
}

// ---- Geometry ----

type C3 = [number, number, number];

/** Drawing helpers over a Kit: surfaces under the store's own light (self-lit, so the food hall works below ground). */
class Draw {
  readonly f: LocalFrame;
  /** The floor being furnished (people stand on it). */
  level = 0;
  private seed = 0x2f6e2b1;
  constructor(readonly k: Kit) {
    this.f = k.f;
  }
  rnd(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rnd() * xs.length)];
  }
  W(hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, bottom = false): void {
    this.k.lit(hex, u0, u1, t0, t1, y0, y1, true, bottom);
  }
  glow(rgb: C3, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, ch: number = EMIT.always): void {
    this.k.glow(rgb, u0, u1, t0, t1, y0, y1, ch);
  }
  P(u: number, t: number, y: number): [number, number, number] {
    const [x, z] = toWorld(this.f, u, t);
    return [x, y, z];
  }
  /** A self-lit quad, both sides. */
  quad(hex: number, a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number]): void {
    const mb = this.k.mb;
    mb.kind = KIND.emit;
    mb.style = [EMIT.interior, 0, 0, 0];
    mb.color = lin(hex);
    mb.poly4(a, b, c, d);
    mb.poly4(b, a, d, c);
    mb.style = [0, 0, 0, 0];
  }
  /** A self-lit round form (rings of [y, radius]); ch EMIT.always makes it glow. */
  lathe(hex: number, u: number, t: number, rings: readonly (readonly [number, number])[], n = 10, ch: number = EMIT.interior, rgb?: C3): void {
    const mb = this.k.mb;
    mb.kind = KIND.emit;
    mb.style = [ch, 0, 0, 0];
    mb.color = rgb ?? lin(hex);
    const [x, z] = toWorld(this.f, u, t);
    mb.lathe(x, z, rings, n);
    mb.style = [0, 0, 0, 0];
  }
  ball(hex: number, u: number, t: number, y: number, r: number, n = 8): void {
    this.lathe(hex, u, t, [[y, 0.001], [y + r * 0.3, r * 0.75], [y + r, r], [y + r * 1.7, r * 0.75], [y + r * 2, 0.001]], n);
  }
  /** A sign canvas: a main line and a smaller one under it. */
  sign(main: string, sub: string, bg: string, fg: string, pw = 512, ph = 160, serif = true): THREE.Texture {
    return this.k.canvas(pw, ph, (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, pw, ph);
      const fam = serif ? "'Yu Mincho', 'MS Mincho', 'Times New Roman', serif" : "'Yu Gothic', 'Meiryo', 'Segoe UI', sans-serif";
      const big = Math.round(ph * (sub ? 0.44 : 0.56));
      g.font = `bold ${big}px ${fam}`;
      const scale = Math.min(1, (pw * 0.9) / Math.max(1, g.measureText(main).width));
      text(g, main, pw / 2, sub ? ph * 0.4 : ph * 0.52, `bold ${Math.floor(big * scale)}px ${fam}`, fg);
      if (sub) text(g, sub, pw / 2, ph * 0.8, `${Math.round(ph * 0.16)}px ${fam}`, fg);
    });
  }
  /** Floor and ceiling of a storey over the whole footprint, less a hole (an escalator well). */
  storey(floorHex: number, y: number, ceilHex: number, ceil: number, holes: { floor?: R4; ceil?: R4 }): void {
    const pieces = (hole: R4 | undefined): R4[] =>
      hole
        ? [
            [IN.u0, IN.u1, IN.t0, hole[2]],
            [IN.u0, IN.u1, hole[3], IN.t1],
            [IN.u0, hole[0], hole[2], hole[3]],
            [hole[1], IN.u1, hole[2], hole[3]],
          ]
        : [[IN.u0, IN.u1, IN.t0, IN.t1]];
    for (const r of pieces(holes.floor)) this.W(floorHex, r[0], r[1], r[2], r[3], y - 0.02, y + 0.01);
    for (const r of pieces(holes.ceil)) this.W(ceilHex, r[0], r[1], r[2], r[3], ceil, ceil + 0.05, true);
    // The well's edges between the ceiling and the floor above.
    const h = holes.ceil;
    if (h) {
      const top = ceil + (y === B1 ? F1 - CEIL_B1 : F2 - CEIL_1F);
      this.W(0xd8d4cc, h[0] - 0.05, h[0], h[2], h[3], ceil, top, true);
      this.W(0xd8d4cc, h[1], h[1] + 0.05, h[2], h[3], ceil, top, true);
      this.W(0xd8d4cc, h[0], h[1], h[2] - 0.05, h[2], ceil, top, true);
      this.W(0xd8d4cc, h[0], h[1], h[3], h[3] + 0.05, ceil, top, true);
    }
    // Ceiling lights: long panels in rows.
    for (let t = IN.t0 + 3; t < IN.t1 - 2; t += 4.5) {
      for (let u = IN.u0 + 3; u < IN.u1 - 3; u += 8) {
        if (h && u + 3 > h[0] && u < h[1] && t + 0.4 > h[2] && t < h[3]) continue;
        this.glow([0.95, 0.92, 0.86], u, u + 3, t, t + 0.4, ceil - 0.02, ceil);
      }
    }
  }
  /** The outer walls' inner faces from y0 to y1. */
  walls(hex: number, y0: number, y1: number, front = true): void {
    this.W(hex, IN.u0 - 0.1, IN.u0, IN.t0, IN.t1, y0, y1);
    this.W(hex, IN.u1, IN.u1 + 0.1, IN.t0, IN.t1, y0, y1);
    this.W(hex, IN.u0, IN.u1, IN.t1, IN.t1 + 0.1, y0, y1);
    if (front) this.W(hex, IN.u0, IN.u1, IN.t0 - 0.1, IN.t0, y0, y1);
  }
  columns(hex: number, trim: number, y0: number, y1: number): void {
    for (const [u0, u1, t0, t1] of COLUMNS) {
      this.W(hex, u0, u1, t0, t1, y0, y1);
      this.W(trim, u0 - 0.03, u1 + 0.03, t0 - 0.03, t1 + 0.03, y0, y0 + 0.12);
      this.W(trim, u0 - 0.03, u1 + 0.03, t0 - 0.03, t1 + 0.03, y1 - 0.3, y1 - 0.22, true);
    }
  }
  /** Elevator hall: four doors on the back wall, the floor indicators over them. */
  lifts(y: number, floorLabel: string): void {
    for (const u of LIFTS) {
      this.W(0x8a7a5a, u - 1.0, u + 1.0, IN.t1 - 0.08, IN.t1, y, y + 2.8);
      this.W(0xc8b890, u - 0.8, u - 0.01, IN.t1 - 0.12, IN.t1 - 0.08, y, y + 2.5);
      this.W(0xc8b890, u + 0.01, u + 0.8, IN.t1 - 0.12, IN.t1 - 0.08, y, y + 2.5);
      this.glow([1.2, 0.7, 0.3], u - 0.3, u + 0.3, IN.t1 - 0.13, IN.t1 - 0.11, y + 2.62, y + 2.72);
      this.glow([0.8, 0.8, 0.75], u + 1.1, u + 1.2, IN.t1 - 0.12, IN.t1 - 0.08, y + 1.1, y + 1.25);
    }
    this.k.plane(this.sign(`${floorLabel}  エレベーター`, 'ELEVATORS · 屋上 ROOFTOP GARDEN', '#2a241c', '#e8d8b0', 768, 120, false), 5.4, 0.84, 22.5, IN.t1 - 0.14, y + 3.3, 'out', 1.0);
  }
  /** An escalator: two lanes of steps, balustrades with glass and handrails, the truss under it. */
  escalator(e: Escalator): void {
    const ramp = (t: number): number => e.y0 + ((t - e.t0) / (e.t1 - e.t0)) * (e.y1 - e.y0);
    const lanes: [number, number][] = [[e.u0, e.u0 + LANE], [e.u1 - LANE, e.u1]];
    for (const [a, b] of lanes) {
      for (let t = e.t0; t < e.t1 - 0.01; t += 0.4) {
        const y = ramp(Math.min(e.t1, t + 0.4));
        this.W(0x3a3c40, a, b, t, t + 0.4, y - 0.3, y);
        this.W(0xd8c040, a, b, t, t + 0.03, y - 0.005, y + 0.005);
      }
      this.W(0xa8acb0, a, b, e.t0 - 1.0, e.t0, e.y0 - 0.01, e.y0 + 0.01);
      this.W(0xa8acb0, a, b, e.t1, e.t1 + 1.0, e.y1 - 0.01, e.y1 + 0.01);
    }
    // Balustrades: a skirt, glass, a black handrail on each side of each lane.
    for (const u of [e.u0 - 0.1, e.u0 + LANE + 0.1, e.u1 + 0.1]) {
      for (let t = e.t0 - 0.6; t < e.t1 + 0.6; t += 0.4) {
        const y = t < e.t0 ? e.y0 : t > e.t1 ? e.y1 : ramp(t);
        this.k.paneT(u, t, t + 0.4, y + 0.15, y + 0.95);
      }
      const a = this.P(u - 0.06, e.t0 - 0.8, e.y0 + 0.98);
      const b = this.P(u + 0.06, e.t0 - 0.8, e.y0 + 0.98);
      this.quad(0x101012, a, b, this.P(u + 0.06, e.t0, e.y0 + 0.98), this.P(u - 0.06, e.t0, e.y0 + 0.98));
      this.quad(0x101012, this.P(u - 0.06, e.t0, e.y0 + 0.98), this.P(u + 0.06, e.t0, e.y0 + 0.98), this.P(u + 0.06, e.t1, e.y1 + 0.98), this.P(u - 0.06, e.t1, e.y1 + 0.98));
      this.quad(0x101012, this.P(u - 0.06, e.t1, e.y1 + 0.98), this.P(u + 0.06, e.t1, e.y1 + 0.98), this.P(u + 0.06, e.t1 + 0.8, e.y1 + 0.98), this.P(u - 0.06, e.t1 + 0.8, e.y1 + 0.98));
      // Skirt panels along the run (stainless), up to just over the steps.
      this.quad(0xb8bcc0, this.P(u, e.t0, e.y0 - 0.6), this.P(u, e.t1, e.y1 - 0.6), this.P(u, e.t1, e.y1 + 0.15), this.P(u, e.t0, e.y0 + 0.15));
    }
    // The truss: a sloped underside and its sides, and the newel ends.
    const u0 = e.u0 - 0.2;
    const u1 = e.u1 + 0.2;
    this.quad(0xc8ccd0, this.P(u0, e.t0, e.y0 - 0.6), this.P(u1, e.t0, e.y0 - 0.6), this.P(u1, e.t1, e.y1 - 0.6), this.P(u0, e.t1, e.y1 - 0.6));
    for (const u of [u0, u1]) this.quad(0xc8ccd0, this.P(u, e.t0, e.y0 - 0.6), this.P(u, e.t1, e.y1 - 0.6), this.P(u, e.t1, e.y1), this.P(u, e.t0, e.y0));
    for (const u of [e.u0 - 0.1, e.u0 + LANE + 0.1, e.u1 + 0.1]) {
      this.W(0xb8bcc0, u - 0.1, u + 0.1, e.t0 - 0.9, e.t0 - 0.5, e.y0, e.y0 + 0.95);
      this.W(0xb8bcc0, u - 0.1, u + 0.1, e.t1 + 0.5, e.t1 + 0.9, e.y1, e.y1 + 0.95);
    }
  }
  /** A ghost shopper (or staff) at local (u, t) facing (du, dt). */
  person(u: number, t: number, du: number, dt: number, spec: Parameters<Kit['person']>[4] = {}): void {
    this.k.person(u, t, du, dt, { y: this.level, ...spec });
  }
}

/** Goods on a flat surface (a counter top or a shelf) from u0..u1 x t0..t1 at height y. */
function goods(d: Draw, kind: Goods, u0: number, u1: number, t0: number, t1: number, y: number): void {
  const grid = (w: number, dd: number, gap: number, each: (u: number, t: number) => void): void => {
    for (let u = u0 + gap; u + w <= u1 - gap / 2; u += w + gap) for (let t = t0 + gap; t + dd <= t1 - gap / 2; t += dd + gap) each(u, t);
  };
  const box = (hexes: readonly number[], w: number, dd: number, h: number, gap: number): void =>
    grid(w, dd, gap, (u, t) => d.W(d.pick(hexes), u, u + w, t, t + dd, y, y + h * (0.8 + 0.4 * d.rnd())));
  switch (kind) {
    case 'wagashi':
      return box([0xf4b8c8, 0xf6f2ea, 0x9ac870, 0x8a5a3a, 0xe8d070, 0xc86a8a], 0.08, 0.08, 0.06, 0.05);
    case 'cake':
      return grid(0.12, 0.12, 0.06, (u, t) => {
        d.W(d.pick([0xfaf6f0, 0xf4c8d4, 0x6a3a22, 0xf0e0b0]), u, u + 0.12, t, t + 0.12, y, y + 0.09);
        d.W(0xd8182a, u + 0.04, u + 0.08, t + 0.04, t + 0.08, y + 0.09, y + 0.12);
      });
    case 'bread':
      return box([0xb8783a, 0xa86a2a, 0xd8a060, 0x8a5020], 0.22, 0.12, 0.09, 0.05);
    case 'tea':
      return box([0x2a5a2a, 0x1a1a1a, 0x6a8a3a, 0xc8a860], 0.08, 0.08, 0.13, 0.04);
    case 'sushi':
      return grid(0.2, 0.14, 0.04, (u, t) => {
        d.W(0xf4f2ec, u, u + 0.2, t, t + 0.14, y, y + 0.04);
        d.W(d.pick([0xf06a3a, 0xd8203a, 0xf4a0a0, 0xf0d040, 0xe8e8e8]), u + 0.02, u + 0.18, t + 0.03, t + 0.11, y + 0.04, y + 0.06);
      });
    case 'deli':
      return grid(0.24, 0.16, 0.04, (u, t) => {
        d.W(0x1a1a1a, u, u + 0.24, t, t + 0.16, y, y + 0.03);
        d.W(d.pick([0x6aa83a, 0xe8883a, 0x8a5a2a, 0xe8d050, 0xc83a2a]), u + 0.02, u + 0.22, t + 0.02, t + 0.14, y + 0.03, y + 0.06);
      });
    case 'tempura':
      return box([0xe8b040, 0xd89830, 0xf0c860, 0xc8802a], 0.1, 0.06, 0.05, 0.03);
    case 'bento':
      return grid(0.22, 0.15, 0.04, (u, t) => {
        d.W(0x121212, u, u + 0.22, t, t + 0.15, y, y + 0.05);
        d.W(d.pick([0xb81e1e, 0x1a1a1a, 0xc8a040]), u, u + 0.22, t, t + 0.15, y + 0.05, y + 0.065);
      });
    case 'fruit':
      return grid(0.3, 0.3, 0.06, (u, t) => {
        d.W(0xd8b880, u, u + 0.3, t, t + 0.3, y, y + 0.06);
        const hex = d.pick([0x8ab85a, 0x8ab85a, 0xd82a2a, 0xf0901a, 0xe8d040]);
        if (hex === 0x8ab85a) d.ball(hex, u + 0.15, t + 0.15, y + 0.05, 0.1);
        else for (const [a, b] of [[0.08, 0.08], [0.22, 0.08], [0.08, 0.22], [0.22, 0.22]] as const) d.ball(hex, u + a, t + b, y + 0.05, 0.05, 6);
      });
    case 'sake':
      return grid(0.1, 0.1, 0.05, (u, t) => {
        const r = 0.045;
        d.lathe(d.pick([0x1a3a1a, 0x3a2a1a, 0xd8e0e4, 0x2a1a3a]), u + 0.05, t + 0.05, [[y, r], [y + 0.2, r], [y + 0.26, r * 0.4], [y + 0.34, r * 0.35], [y + 0.35, 0.001]], 6);
      });
    case 'fish':
      d.W(0xf4f8fa, u0, u1, t0, t1, y, y + 0.03);
      return grid(0.34, 0.08, 0.05, (u, t) => d.W(d.pick([0xa8b4c0, 0x8a98a8, 0xd8606a, 0xc8ccd0]), u, u + 0.34, t, t + 0.08, y + 0.03, y + 0.07));
    case 'choco':
      return grid(0.14, 0.14, 0.05, (u, t) => {
        d.W(d.pick([0x2a1810, 0x4a2a1a, 0x1a0e08, 0xe8e0d0]), u, u + 0.14, t, t + 0.14, y, y + 0.04);
        d.W(0xd8b050, u + 0.06, u + 0.08, t, t + 0.14, y + 0.04, y + 0.045);
      });
  }
}

// ---- B1: the food hall ----

function* foodHall(d: Draw): Generator<void> {
  const y = B1;
  d.level = y;
  d.storey(0xd8d8d4, y, 0xe8e6e0, CEIL_B1, { ceil: [ESC_DN.u0 - 0.2, ESC_DN.u1 + 0.2, ESC_DN.t0, ESC_DN.t1] });
  d.walls(0xe4e0d8, y, CEIL_B1);
  d.columns(0xeeeae4, 0x9a8a6a, y, CEIL_B1);
  d.lifts(y, 'B1');
  // Aisle stripes in the floor.
  for (const u of [5.6, 38.4]) d.W(0xb8b4ac, u - 0.3, u + 0.3, IN.t0, 46, y, y + 0.014);
  yield;
  for (const s of STALLS) {
    (s.side === 'I' ? islandStall : wallStallGeo)(d, s);
    yield;
  }
  // The eat-in counter, the tills by the elevators, the sign over the escalators.
  d.W(0xa8784a, EAT_IN[0], EAT_IN[1], EAT_IN[2], EAT_IN[3], y, y + 1.05);
  d.W(0xd8b888, EAT_IN[0] - 0.05, EAT_IN[1] + 0.05, EAT_IN[2] - 0.15, EAT_IN[3], y + 1.05, y + 1.1);
  for (let u = 1.6; u < 11; u += 1.2) d.lathe(0x3a3a3a, u, 51.0, [[y, 0.16], [y + 0.04, 0.16], [y + 0.05, 0.03], [y + 0.72, 0.03], [y + 0.73, 0.18], [y + 0.8, 0.18]], 8);
  d.k.plane(d.sign('イートイン', 'EAT-IN', '#3a2a1e', '#f4e8d0', 384, 120, false), 2.4, 0.75, 6, 55.3, y + 2.3, 'out', 1.0);
  d.W(0x5a4a3a, 1, 11, 55.3, 55.4, y, CEIL_B1);
  for (const [u0, u1, t0, t1] of TILLS) {
    d.W(0xe8e4dc, u0, u1, t0, t1, y, y + 1.0);
    d.W(0x2a2a2e, u0 + 0.6, u1 - 0.6, t0 + 0.3, t1 - 0.2, y + 1.0, y + 1.35);
    d.glow([0.4, 0.8, 0.5], u0 + 0.65, u1 - 0.65, t0 + 0.28, t0 + 0.3, y + 1.1, y + 1.3);
    d.person((u0 + u1) / 2, t1 + 0.5, 0, -1, { body: 'woman', color: [0.9, 0.95, 1.0], hair: 'bun' });
  }
  d.k.plane(d.sign('レジ', 'CHECKOUT', '#1a3a2a', '#ffffff', 256, 100, false), 1.6, 0.62, 38.5, 48.6, y + 2.6, 'out', 1.0);
  d.k.plane(d.sign('B1  食料品', 'FOOD HALL · ↑ 1F', '#1a1a1e', '#f4e8c8', 640, 160), 3.6, 0.9, (ESC_DN.u0 + ESC_DN.u1) / 2, ESC_DN.t0 - 1.6, CEIL_B1 - 0.6, 'out', 1.0);
  // Shoppers in the aisles.
  const shoppers: [number, number, number, number, Parameters<Kit['person']>[4]][] = [
    [7, 8, 1, 0.3, { body: 'woman', pose: 'walk', color: [1.0, 0.72, 0.6], phase: 0.2 }],
    [6.5, 19, -1, 0, { body: 'elder', color: [0.9, 0.85, 1.0] }],
    [9, 29, 0, 1, { body: 'woman', pose: 'walk', color: [0.7, 0.9, 1.0], phase: 0.6, long: true }],
    [8, 40, -1, 0.2, { body: 'man', color: [0.8, 0.9, 0.8] }],
    [36.5, 7, 1, 0, { body: 'woman', color: [1.0, 0.85, 0.9], hair: 'long' }],
    [35.8, 18, 1, 0, { body: 'man', pose: 'phone', color: [0.85, 0.85, 1.0] }],
    [36.2, 30, 1, 0.2, { body: 'elder', color: [1.0, 0.9, 0.75], hair: 'hat' }],
    [22.8, 9, 0, -1, { body: 'child', color: [1.0, 0.8, 0.5] }],
    [23.5, 9.6, -0.3, -1, { body: 'woman', pose: 'hold', color: [1.0, 0.7, 0.8], side: -1 }],
    [17, 23.5, 1, 0, { body: 'man', pose: 'walk', color: [0.7, 0.85, 1.0], phase: 0.4 }],
    [30, 41, -1, 0, { body: 'woman', pose: 'walk', color: [0.95, 0.9, 0.7], phase: 0.1, long: true }],
    [5, 50, 0, 1, { body: 'man', color: [0.8, 0.8, 0.9] }],
  ];
  for (const [u, t, du, dt, s] of shoppers) d.person(u, t, du, dt, s);
}

/** A counter along a side wall: back shelves, a staff aisle, a lit display case, the name over it. */
function wallStallGeo(d: Draw, s: Stall): void {
  const y = B1;
  const L = s.side === 'L';
  const A = (a: number): number => (L ? IN.u0 + a : IN.u1 - a);
  const span = (a0: number, a1: number): [number, number] => [Math.min(A(a0), A(a1)), Math.max(A(a0), A(a1))];
  const [bu0, bu1] = span(0, 0.6);
  d.W(s.wall, bu0, bu1, s.t0, s.t1, y, y + 2.3);
  d.W(s.wall, ...span(0, 0.02), s.t0, s.t1, y + 2.3, CEIL_B1);
  for (const h of [0.9, 1.4, 1.9]) {
    const [su0, su1] = span(0.6, 0.64);
    d.glow([0.9, 0.85, 0.7], su0, su1, s.t0 + 0.2, s.t1 - 0.2, y + h - 0.04, y + h);
    goods(d, s.goods, ...span(0.1, 0.55), s.t0 + 0.2, s.t1 - 0.2, y + h);
  }
  // Partitions at the ends; the floor of the staff side.
  d.W(s.wall, ...span(0, STALL_DEPTH), s.t0, s.t0 + 0.08, y, y + 2.3);
  d.W(s.wall, ...span(0, STALL_DEPTH), s.t1 - 0.08, s.t1, y, y + 2.3);
  d.W(0x8a8680, ...span(0.6, 3.6), s.t0 + 0.08, s.t1 - 0.08, y, y + 0.016);
  // The case: a base, the glass top lit from inside, goods in and on it.
  const [cu0, cu1] = span(3.6, STALL_DEPTH);
  d.W(0xf0ece4, cu0, cu1, s.t0 + 0.3, s.t1 - 0.3, y, y + 0.75);
  d.glow([0.95, 0.95, 0.9], cu0 + 0.05, cu1 - 0.05, s.t0 + 0.35, s.t1 - 0.35, y + 0.75, y + 0.77);
  goods(d, s.goods, cu0 + 0.05, cu1 - 0.05, s.t0 + 0.35, s.t1 - 0.35, y + 0.77);
  const gu = L ? cu1 : cu0;
  d.k.paneT(gu, s.t0 + 0.3, s.t1 - 0.3, y + 0.75, y + 1.15);
  d.W(0xf0ece4, ...span(3.6, 3.9), s.t0 + 0.3, s.t1 - 0.3, y + 1.15, y + 1.2);
  // The name over it, hanging from the ceiling, facing the aisle; staff behind the counter.
  const tex = d.sign(s.name, s.en, s.bg, s.fg);
  const [hu0, hu1] = span(STALL_DEPTH - 0.1, STALL_DEPTH);
  d.W(0x2a2a2a, hu0, hu1, s.t0 + 0.8, s.t1 - 0.8, y + 2.5, CEIL_B1);
  d.k.plane(tex, Math.min(5, s.t1 - s.t0 - 2), 0.8, L ? hu1 + 0.02 : hu0 - 0.02, (s.t0 + s.t1) / 2, y + 2.75, L ? '+u' : '-u', 1.0);
  const face = L ? 1 : -1;
  d.person(A(2.4), s.t0 + 2.5, face, 0, { body: 'woman', color: [0.95, 0.95, 0.92], hair: 'cap' });
  d.person(A(2.2), s.t1 - 3, face, 0, { body: s.goods === 'sushi' || s.goods === 'tempura' ? 'man' : 'woman', pose: 'talk', color: [0.95, 0.95, 0.92], hair: 'cap', side: -1 });
}

/** An island: cases on four sides round the staff, goods on a tiered centre, the name hanging over it both ways. */
function islandStall(d: Draw, s: Stall): void {
  const y = B1;
  const { u0, u1, t0, t1 } = s;
  const um = (u0 + u1) / 2;
  const tm = (t0 + t1) / 2;
  d.W(0x8a8680, u0, u1, t0, t1, y, y + 0.016);
  const cases: R4[] = [
    [u0, u1, t0, t0 + 0.9],
    [u0, u1, t1 - 0.9, t1],
    [u0, u0 + 0.9, t0 + 0.9, t1 - 0.9],
    [u1 - 0.9, u1, t0 + 0.9, t1 - 0.9],
  ];
  for (const [a, b, c, e] of cases) {
    d.W(s.wall, a, b, c, e, y, y + 0.8);
    d.glow([0.95, 0.95, 0.9], a + 0.05, b - 0.05, c + 0.05, e - 0.05, y + 0.8, y + 0.82);
    goods(d, s.goods, a + 0.05, b - 0.05, c + 0.05, e - 0.05, y + 0.82);
  }
  // The tiered centre: two shelves of goods under a canopy post.
  d.W(s.wall, um - 1.2, um + 1.2, tm - 0.6, tm + 0.6, y, y + 1.0);
  goods(d, s.goods, um - 1.15, um + 1.15, tm - 0.55, tm + 0.55, y + 1.0);
  d.W(s.wall, um - 0.7, um + 0.7, tm - 0.25, tm + 0.25, y + 1.0, y + 1.5);
  goods(d, s.goods, um - 0.65, um + 0.65, tm - 0.22, tm + 0.22, y + 1.5);
  d.W(0x2a2a2a, um - 0.05, um + 0.05, tm - 0.05, tm + 0.05, y + 1.5, CEIL_B1);
  const tex = d.sign(s.name, s.en, s.bg, s.fg);
  d.W(0x2a2a2a, um - 1.9, um + 1.9, tm - 0.04, tm + 0.04, y + 2.3, y + 3.2);
  d.k.plane(tex, 3.6, 0.9, um, tm - 0.05, y + 2.75, 'out', 1.0);
  d.k.plane(tex, 3.6, 0.9, um, tm + 0.05, y + 2.75, 'in', 1.0);
  d.person(u0 + 1.6, tm, -1, 0, { body: 'man', color: [0.95, 0.95, 0.92], hair: 'cap' });
  d.person(u1 - 1.6, tm + 1, 1, 0, { body: 'woman', pose: 'talk', color: [0.95, 0.95, 0.92], hair: 'cap' });
}

// ---- 1F: the entrance, cosmetics and accessories ----

function* groundFloor(d: Draw): Generator<void> {
  const y = F1;
  d.level = y;
  const MARBLE = 0xf0ebe2;
  d.storey(MARBLE, y, 0xf4f0e8, CEIL_1F, {
    floor: [ESC_DN.u0 - 0.2, ESC_DN.u1 + 0.2, ESC_DN.t0, ESC_DN.t1],
    ceil: [ESC_UP.u0 - 0.2, ESC_UP.u1 + 0.2, ESC_UP.t0, ESC_UP.t1],
  });
  d.walls(0xf4eee4, y, F2 - 1, false);
  d.W(0xf4eee4, IN.u0, IN.u1, IN.t0 - 0.1, IN.t0, CEIL_1F - 0.4, CEIL_1F);
  d.columns(0xf6f0e6, 0xc8a860, y, CEIL_1F);
  // Column mirrors on the aisle faces.
  for (const u of COLS_U) for (const t of COLS_T) d.glow([0.5, 0.52, 0.55], u - 0.35, u + 0.35, t - 0.47, t - 0.45, 0.4, 2.4);
  d.lifts(y, '1F');
  // Inlaid aisles: from the door to the escalators, and across the floor.
  d.W(0xc8b89a, 20.2, 24.8, VEST, 25, y, y + 0.014);
  d.W(0xe4dccc, 20.5, 24.5, VEST + 0.2, 24.8, y, y + 0.018);
  d.W(0xc8b89a, IN.u0 + 1, IN.u1 - 1, 22.2, 23.2, y, y + 0.014);

  // The show windows' backs (panelled), either side of the vestibule, with posters for the spring fair.
  for (const [u0, u1] of [[IN.u0, DEPT_DOOR.u0], [DEPT_DOOR.u1, IN.u1]] as const) {
    d.W(0xe8e0d0, u0, u1, IN.t0, SHOW, y, CEIL_1F);
    for (let u = u0 + 1.2; u < u1 - 2; u += 3.2) d.W(0xd8ccb4, u, u + 2.4, SHOW, SHOW + 0.02, y + 0.6, y + 3.6);
  }
  const fair = d.k.canvas(512, 720, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 720);
    gr.addColorStop(0, '#f8d8e4');
    gr.addColorStop(1, '#f4f0f8');
    g.fillStyle = gr;
    g.fillRect(0, 0, 512, 720);
    g.fillStyle = 'rgba(232,120,160,0.55)';
    for (let i = 0; i < 26; i++) {
      const x = (i * 197) % 512;
      const yy = (i * 311) % 480;
      g.beginPath();
      g.ellipse(x, yy, 16, 10, i, 0, Math.PI * 2);
      g.fill();
    }
    text(g, '春', 256, 300, "bold 220px 'Yu Mincho', serif", '#b83a6a');
    text(g, 'SPRING BEAUTY FAIR', 256, 500, "bold 40px 'Times New Roman', serif", '#6a2a4a');
    text(g, '1F 化粧品  3.1 — 4.15', 256, 570, "30px 'Yu Gothic', sans-serif", '#6a2a4a');
  });
  for (const u of [6, 12, 33, 39]) d.k.plane(fair, 2.2, 3.1, u, SHOW + 0.03, y + 2.1, 'in', 1.0);

  // The vestibule: two sets of automatic glass doors (open), the mat, the umbrella-bag stand.
  const V0 = DEPT_DOOR.u0;
  const V1 = DEPT_DOOR.u1;
  d.W(0xd8d0c0, V0, V0 + 0.2, IN.t0 - 0.3, VEST, y, CEIL_1F);
  d.W(0xd8d0c0, V1 - 0.2, V1, IN.t0 - 0.3, VEST, y, CEIL_1F);
  d.W(0x3a3a3e, V0 + 0.2, V1 - 0.2, 1.3, VEST, y, y + 0.014);
  d.W(0x5a4a3a, 20, 25, 1.8, 3.8, y, y + 0.02);
  for (const [a, b] of [[V0 + 0.2, 20], [25, V1 - 0.2]] as const) {
    d.k.pane(a, b, y, CEIL_1F - 0.8, 1.35);
    d.k.pane(a, b, y, CEIL_1F - 0.8, VEST);
    d.W(0x9a9ca0, a, b, VEST - 0.04, VEST + 0.04, CEIL_1F - 0.8, CEIL_1F);
  }
  d.W(0x9a9ca0, 20, 25, VEST - 0.04, VEST + 0.04, CEIL_1F - 0.8, CEIL_1F);
  d.W(0x9a9ca0, 20, 25, 1.31, 1.39, CEIL_1F - 0.8, CEIL_1F);
  d.W(0xc8c8cc, 25.6, 26.4, 3.3, 3.8, y, y + 1.0);
  for (let u = 25.65; u < 26.4; u += 0.12) d.W(0xe8f0f4, u, u + 0.08, 3.35, 3.4, y + 1.0, y + 1.5);
  d.k.plane(d.sign('傘袋', 'UMBRELLA BAGS', '#1a3a6a', '#ffffff', 256, 128, false), 0.6, 0.3, 26, 3.28, y + 1.25, 'out', 1.0);
  d.k.plane(d.sign('東都百貨店', 'TOTO DEPARTMENT STORE', '#2a241c', '#e8d8b0', 768, 160), 4.6, 0.96, 22.5, VEST + 0.06, CEIL_1F - 0.4, 'in', 1.0);

  // Chandeliers over the main aisle.
  for (const t of [9, 15.5, 21]) {
    d.lathe(0, 22.5, t, [[CEIL_1F - 1.4, 0.02], [CEIL_1F - 1.3, 0.55], [CEIL_1F - 1.0, 0.8], [CEIL_1F - 0.75, 0.6], [CEIL_1F - 0.6, 0.12]], 12, EMIT.always, [1.1, 1.0, 0.8]);
    d.W(0xc8a860, 22.47, 22.53, t - 0.03, t + 0.03, CEIL_1F - 0.6, CEIL_1F);
  }

  yield;
  for (const b of BRANDS) {
    brandIsland(d, b);
    yield;
  }

  // The information desk and its two greeters; the floor guide by the escalators.
  const [iu0, iu1, it0, it1] = INFO_DESK;
  d.W(0xf4f0e8, iu0, iu1, it0, it1, y, y + 1.0);
  d.W(0xc8a860, iu0 - 0.03, iu1 + 0.03, it0 - 0.03, it1 + 0.03, y + 1.0, y + 1.05);
  d.k.plane(d.sign('ご案内', 'INFORMATION', '#2a241c', '#e8d8b0', 384, 128), 1.6, 0.53, (iu0 + iu1) / 2, it0 - 0.01, y + 0.6, 'out', 1.0);
  d.person(29.2, 7.8, 0, -1, { body: 'woman', color: [0.7, 0.8, 1.0], hair: 'hat' });
  d.person(30.8, 7.8, 0, -1, { body: 'woman', pose: 'wave', color: [0.7, 0.8, 1.0], hair: 'hat', side: -1 });
  const guide = d.k.canvas(360, 640, (g) => {
    g.fillStyle = '#2a241c';
    g.fillRect(0, 0, 360, 640);
    text(g, 'フロアガイド', 180, 50, "bold 38px 'Yu Gothic', sans-serif", '#e8d8b0');
    text(g, 'FLOOR GUIDE', 180, 92, "22px 'Segoe UI', sans-serif", '#c8b890');
    const rows: [string, string, string][] = [['R', '屋上庭園', 'Rooftop Garden'], ['2F', '婦人服・カフェ', "Women's Fashion · Café"], ['1F', '化粧品・雑貨', 'Cosmetics · Accessories'], ['B1', '食料品', 'Food Hall']];
    rows.forEach(([fl, jp, en], i) => {
      const yy = 170 + i * 120;
      g.fillStyle = i === 2 ? '#c8a860' : '#4a4034';
      g.fillRect(20, yy - 40, 80, 80);
      text(g, fl, 60, yy, "bold 40px 'Segoe UI', sans-serif", i === 2 ? '#2a241c' : '#e8d8b0');
      text(g, jp, 116, yy - 14, "bold 30px 'Yu Gothic', sans-serif", '#f4ecd8', 'left');
      text(g, en, 116, yy + 22, "20px 'Segoe UI', sans-serif", '#c8b890', 'left');
    });
  });
  const [gu0, gu1, gt0, gt1] = GUIDE;
  d.W(0x2a241c, gu0, gu1, gt0, gt1, y, y + 2.3);
  d.k.plane(guide, 1.3, 2.2, (gu0 + gu1) / 2, gt0 - 0.01, y + 1.15, 'out', 1.1);
  d.k.plane(guide, 1.3, 2.2, (gu0 + gu1) / 2, gt1 + 0.01, y + 1.15, 'in', 1.1);

  yield;
  // Escalators and their signs.
  d.escalator(ESC_UP);
  d.escalator(ESC_DN);
  d.k.plane(d.sign('↑ 2F  婦人服', "WOMEN'S FASHION · CAFÉ", '#2a241c', '#f4e8c8', 640, 160), 3.0, 0.75, (ESC_UP.u0 + ESC_UP.u1) / 2, ESC_UP.t0 - 1.2, CEIL_1F - 0.5, 'out', 1.0);
  d.k.plane(d.sign('↓ B1  食料品', 'FOOD HALL', '#2a241c', '#f4e8c8', 640, 160), 3.0, 0.75, (ESC_DN.u0 + ESC_DN.u1) / 2, ESC_DN.t1 + 1.0, CEIL_1F - 0.5, 'in', 1.0);

  yield;
  // Accessories: handbag walls, jewellery and watch cases, the gift-wrapping desk.
  for (const [u0, u1, t0, t1] of BAG_WALLS) {
    d.W(0x3a2e24, u0, u1, t0, t1, y, y + 3.2);
    const L = u0 < 20;
    const face = L ? u1 : u0;
    for (const h of [0.5, 1.4, 2.3]) {
      d.glow([0.95, 0.88, 0.72], L ? face : face - 0.02, L ? face + 0.02 : face, t0 + 0.2, t1 - 0.2, y + h - 0.03, y + h);
      for (let t = t0 + 0.4; t < t1 - 0.6; t += 0.75) {
        const hex = d.pick([0x2a1a14, 0xc8a070, 0x8a1a2a, 0xe8e0d4, 0x1a2a4a, 0x6a4a2a]);
        const [a, b] = L ? [face + 0.05, face + 0.4] : [face - 0.4, face - 0.05];
        d.W(hex, a, b, t, t + 0.45, y + h, y + h + 0.32);
        d.W(hex, a + 0.15, b - 0.15, t + 0.08, t + 0.12, y + h + 0.32, y + h + 0.5);
        d.W(hex, a + 0.15, b - 0.15, t + 0.33, t + 0.37, y + h + 0.32, y + h + 0.5);
        d.W(hex, a + 0.15, b - 0.15, t + 0.08, t + 0.37, y + h + 0.47, y + h + 0.5);
      }
    }
  }
  d.k.plane(d.sign('バッグ', 'HANDBAGS', '#3a2e24', '#e8d8b0', 384, 120), 2.2, 0.69, IN.u0 + 0.72, 37, y + 3.7, '+u', 1.0);
  for (const [u0, u1, t0, t1] of CASES_1F) {
    d.W(0x1a1a1e, u0, u1, t0, t1, y, y + 0.95);
    d.glow([0.9, 0.9, 0.95], u0 + 0.05, u1 - 0.05, t0 + 0.05, t1 - 0.05, y + 0.95, y + 0.97);
    for (let u = u0 + 0.2; u < u1 - 0.2; u += 0.3) for (const t of [t0 + 0.4, t1 - 0.6]) d.W(d.pick([0xd8b860, 0xe8e8ec, 0xc89a70]), u, u + 0.12, t, t + 0.12, y + 0.97, y + 1.0);
    d.k.pane(u0, u1, y + 0.97, y + 1.3, t0);
    d.k.pane(u0, u1, y + 0.97, y + 1.3, t1);
    d.W(0x1a1a1e, u0, u1, t0, t1, y + 1.3, y + 1.32);
    d.person(u0 - 0.6, (t0 + t1) / 2, 1, 0, { body: 'man', color: [0.85, 0.85, 0.95] });
  }
  d.k.plane(d.sign('時計・宝飾', 'WATCHES · JEWELLERY', '#1a1a1e', '#e8d090', 512, 128), 2.6, 0.65, 6, 34.4, y + 3.4, 'out', 1.0);
  d.k.plane(d.sign('帽子・スカーフ', 'HATS · SCARVES', '#1a1a1e', '#e8d090', 512, 128), 2.6, 0.65, 38, 34.4, y + 3.4, 'out', 1.0);
  const [wu0, wu1, wt0, wt1] = WRAP_DESK;
  d.W(0xf4f0e8, wu0, wu1, wt0, wt1, y, y + 1.0);
  for (let u = wu0 + 0.3; u < wu1 - 0.4; u += 0.6) d.W(d.pick([0x2a5a8a, 0xc83a4a, 0xf4e8d0]), u, u + 0.36, wt0 + 0.3, wt0 + 0.8, y + 1.0, y + 1.18);
  d.k.plane(d.sign('ギフト包装', 'GIFT WRAPPING', '#2a5a8a', '#ffffff', 512, 128, false), 2.4, 0.6, (wu0 + wu1) / 2, wt1 + 0.02, y + 2.6, 'in', 1.0);
  d.person(39.5, 48.8, 0, -1, { body: 'woman', color: [0.7, 0.8, 1.0], hair: 'bun' });

  // The spring fair stage behind the escalators: a plinth, mannequins, a backdrop.
  const [su0, su1, st0, st1] = STAGE_1F;
  d.W(0xf4ecf0, su0, su1, st0, st1, y, y + 0.35);
  d.W(0xf8d8e4, su0, su1, st1 - 0.2, st1, y + 0.35, y + 3.6);
  d.k.plane(fair, 2.4, 3.2, (su0 + su1) / 2, st1 - 0.22, y + 2.0, 'out', 1.0);
  for (const [u, hex] of [[su0 + 0.9, 0xe85a8a], [su1 - 0.9, 0xf4f0f4]] as const) mannequin(d, u, st0 + 1.4, y + 0.35, hex);

  // Shoppers.
  const shoppers: [number, number, number, number, Parameters<Kit['person']>[4]][] = [
    [22, 6.5, 0, 1, { body: 'woman', pose: 'walk', color: [1.0, 0.72, 0.8], phase: 0.3, long: true }],
    [23.4, 12, 0, -1, { body: 'man', pose: 'walk', color: [0.7, 0.85, 1.0], phase: 0.7 }],
    [11, 8, 0, -1, { body: 'woman', pose: 'phone', color: [0.9, 0.8, 1.0], hair: 'long' }],
    [20.5, 17.5, 1, 0.4, { body: 'woman', color: [1.0, 0.85, 0.7], hair: 'hat' }],
    [21, 18.2, 1, 0, { body: 'woman', pose: 'talk', color: [0.85, 1.0, 0.85] }],
    [34, 13, -1, 0, { body: 'elder', color: [1.0, 0.9, 0.8] }],
    [14, 29, 0, 1, { body: 'man', pose: 'pockets', color: [0.8, 0.8, 0.95], long: true }],
    [30.5, 31, 0, -1, { body: 'woman', pose: 'walk', color: [1.0, 0.7, 0.6], phase: 0.5 }],
    [22.5, 38, 0, 1, { body: 'child', color: [0.9, 1.0, 0.6] }],
    [9, 45, 1, 0, { body: 'woman', color: [0.8, 0.7, 1.0], hair: 'bun', long: true }],
    [22.5, 52, 0, 1, { body: 'man', color: [0.85, 0.9, 1.0] }],
  ];
  for (const [u, t, du, dt, s] of shoppers) d.person(u, t, du, dt, s);
}

/** A cosmetics island: counters with lit tops and testers, a tower with the brand's name both ways, stools, staff. */
function brandIsland(d: Draw, b: Island): void {
  const y = F1;
  const { u0, u1, t0, t1 } = b;
  const um = (u0 + u1) / 2;
  const tm = (t0 + t1) / 2;
  d.W(b.floor, u0 - 0.3, u1 + 0.3, t0 - 0.5, t1 + 0.5, y, y + 0.02);
  const counters: R4[] = [
    [u0, u1, t0, t0 + 0.6],
    [u0, u1, t1 - 0.6, t1],
    [u0, u0 + 0.6, t0 + 0.6, t1 - 0.6],
    [u1 - 0.6, u1, t0 + 0.6, t1 - 0.6],
  ];
  for (const [a, c, e, g] of counters) {
    d.W(b.body, a, c, e, g, y, y + 0.9);
    d.glow([0.95, 0.94, 0.92], a + 0.04, c - 0.04, e + 0.04, g - 0.04, y + 0.9, y + 0.915);
    for (let u = a + 0.12; u < c - 0.1; u += 0.13) {
      for (let t = e + 0.12; t < g - 0.1; t += 0.13) d.W(d.pick(b.products), u, u + 0.05, t, t + 0.05, y + 0.915, y + 0.915 + 0.06 + 0.08 * d.rnd());
    }
  }
  // Mirrors on the long counters, facing out.
  for (const u of [u0 + 1.2, u1 - 1.2]) {
    d.W(0xc8c0b0, u - 0.25, u + 0.25, t0 + 0.2, t0 + 0.26, y + 0.915, y + 1.45);
    d.glow([0.55, 0.57, 0.6], u - 0.22, u + 0.22, t0 + 0.19, t0 + 0.2, y + 0.95, y + 1.42);
  }
  // The tower: shelves of product each side, the name above both ways.
  d.W(b.body, um - 1.6, um + 1.6, tm - 0.35, tm + 0.35, y, y + 3.4);
  for (const side of [-1, 1] as const) {
    const face = tm + side * 0.35;
    for (const h of [1.1, 1.55, 2.0]) {
      d.glow([1.0, 0.97, 0.9], um - 1.45, um + 1.45, side < 0 ? face - 0.03 : face, side < 0 ? face : face + 0.03, y + h - 0.03, y + h);
      for (let u = um - 1.35; u < um + 1.35; u += 0.16) {
        const [a, c] = side < 0 ? [face - 0.12, face - 0.03] : [face + 0.03, face + 0.12];
        d.W(d.pick(b.products), u, u + 0.08, a, c, y + h, y + h + 0.1 + 0.08 * d.rnd());
      }
    }
  }
  const tex = d.sign(b.name, b.sub, b.bg, b.fg, 640, 192, b.name !== 'KAORI' && b.name !== 'HANA');
  d.k.plane(tex, 3.0, 0.9, um, tm - 0.36, y + 2.85, 'out', 1.1);
  d.k.plane(tex, 3.0, 0.9, um, tm + 0.36, y + 2.85, 'in', 1.1);
  // Stools at the long counters; staff inside, a customer at a mirror.
  for (const u of [u0 + 1.2, u1 - 1.2]) {
    for (const t of [t0 - 0.35, t1 + 0.35]) d.lathe(b.body, u, t, [[y, 0.18], [y + 0.03, 0.18], [y + 0.04, 0.03], [y + 0.62, 0.03], [y + 0.63, 0.2], [y + 0.72, 0.2]], 10);
  }
  const staff: [number, number, number] = b.body < 0x404040 || b.name === 'VELVET' ? [0.95, 0.9, 0.95] : [0.55, 0.55, 0.65];
  d.person(um - 1.4, t0 + 1.1, 0, -1, { body: 'woman', color: staff, hair: 'bun' });
  d.person(um + 1.6, t1 - 1.0, 0, 1, { body: 'woman', pose: 'talk', color: staff, hair: 'bun' });
  d.person(u0 + 1.2, t0 - 0.35, 0, 1, { body: 'woman', color: [1.0, 0.8, 0.85], hair: 'long' });
}

/** A dress-form mannequin on a stand, in a dress of the given colour. */
function mannequin(d: Draw, u: number, t: number, y: number, dress: number): void {
  d.lathe(0x9a9ca0, u, t, [[y, 0.2], [y + 0.03, 0.2], [y + 0.04, 0.02], [y + 0.5, 0.02]], 8);
  d.lathe(dress, u, t, [[y + 0.45, 0.36], [y + 0.5, 0.35], [y + 0.9, 0.22], [y + 1.12, 0.15], [y + 1.32, 0.18], [y + 1.46, 0.2], [y + 1.56, 0.12], [y + 1.6, 0.05]], 12);
  d.lathe(0xf4f0ea, u, t, [[y + 1.6, 0.045], [y + 1.68, 0.05], [y + 1.72, 0.07], [y + 1.8, 0.1], [y + 1.92, 0.09], [y + 1.98, 0.001]], 10);
}

// ---- 2F: women's fashion ----

function* fashionFloor(d: Draw): Generator<void> {
  const y = F2;
  d.level = y;
  d.storey(0xb89a78, y, 0xf4f2ee, CEIL_2F, { floor: [ESC_UP.u0 - 0.2, ESC_UP.u1 + 0.2, ESC_UP.t0, ESC_UP.t1] });
  d.walls(0xf2ece4, y, CEIL_2F);
  d.columns(0xf4f0ea, 0x8a7a64, y, CEIL_2F);
  d.lifts(y, '2F');
  // A pale stone aisle round the floor (the shops are wood).
  d.W(0xe8e2d8, 9.8, 34.2, IN.t0, IN.t1, y, y + 0.014);
  // The well round the escalator: glass balustrade on the floor's edge.
  const [hu0, hu1] = [ESC_UP.u0 - 0.2, ESC_UP.u1 + 0.2];
  d.k.pane(hu0, hu1, y, y + 1.05, ESC_UP.t0);
  d.W(0x3a3430, hu0, hu1, ESC_UP.t0 - 0.03, ESC_UP.t0 + 0.03, y + 1.05, y + 1.1);
  d.k.plane(d.sign('↓ 1F  化粧品・雑貨', 'COSMETICS · ACCESSORIES · B1 FOOD HALL', '#2a241c', '#f4e8c8', 768, 160), 3.2, 0.67, (ESC_UP.u0 + ESC_UP.u1) / 2, ESC_UP.t1 + 1.2, CEIL_2F - 1.2, 'in', 1.0);
  d.k.plane(d.sign('2F  婦人服', "WOMEN'S FASHION", '#2a241c', '#f4e8c8', 640, 160), 3.2, 0.8, (ESC_UP.u0 + ESC_UP.u1) / 2, ESC_UP.t1 + 1.25, CEIL_2F - 1.2, 'out', 1.0);
  d.W(0x2a241c, 16.2, 19.2, ESC_UP.t1 + 1.2, ESC_UP.t1 + 1.25, CEIL_2F - 0.8, CEIL_2F);

  yield;
  for (const s of SHOPS) {
    boutique(d, s);
    yield;
  }

  // The runway at the front: a white plinth of mannequins before the season's poster.
  const [ru0, ru1, rt0, rt1] = RUNWAY;
  d.W(0xf6f4f0, ru0, ru1, rt0, rt1, y, y + 0.3);
  const dresses = [0xe8202a, 0xf4f0ea, 0x1a2a5a, 0xf4a0b8, 0xe8c040, 0x101014, 0x6ab0d8];
  dresses.forEach((hex, i) => mannequin(d, ru0 + 1.2 + i * ((ru1 - ru0 - 2.4) / (dresses.length - 1)), (rt0 + rt1) / 2, y + 0.3, hex));
  const season = d.k.canvas(1024, 320, (g) => {
    const gr = g.createLinearGradient(0, 0, 1024, 0);
    gr.addColorStop(0, '#1a1a24');
    gr.addColorStop(1, '#3a2a4a');
    g.fillStyle = gr;
    g.fillRect(0, 0, 1024, 320);
    text(g, 'SPRING COLLECTION', 512, 120, "bold 84px 'Times New Roman', serif", '#f4e8d8');
    text(g, '春の新作  ·  2F 婦人服', 512, 230, "44px 'Yu Mincho', serif", '#d8b8e8');
  });
  d.W(0x1a1a24, 13, 31, IN.t0, IN.t0 + 0.1, y + 1.2, y + 5.2);
  d.k.plane(season, 16, 5, 22, IN.t0 + 0.12, y + 3.4, 'in', 1.0);
  for (const [u0, u1, t0, t1] of TABLES_2F) {
    d.W(0xd8c8b0, u0, u1, t0, t1, y, y + 0.78);
    for (let u = u0 + 0.15; u < u1 - 0.3; u += 0.42) {
      for (let t = t0 + 0.15; t < t1 - 0.3; t += 0.42) {
        const hex = d.pick([0xc8a878, 0x8a9a6a, 0xe8d8c0, 0xa85a4a, 0x6a7a8a, 0xf4f0ea]);
        const n = 2 + Math.floor(d.rnd() * 4);
        d.W(hex, u, u + 0.34, t, t + 0.32, y + 0.78, y + 0.78 + n * 0.05);
      }
    }
  }

  yield;
  // Café Toto (the back right corner): a cake counter, a menu board, round tables.
  d.W(0x8a6a4a, CAFE.u0, CAFE.u1, CAFE.t0, CAFE.t1, y, y + 0.016);
  const [cu0, cu1, ct0, ct1] = CAFE_COUNTER;
  d.W(0x6a4a30, cu0, cu1, ct0, ct1, y, y + 1.05);
  d.glow([0.95, 0.92, 0.85], cu0 + 0.05, cu0 + 0.5, ct0 + 0.3, ct0 + 3.5, y + 1.05, y + 1.07);
  goods(d, 'cake', cu0 + 0.05, cu0 + 0.5, ct0 + 0.3, ct0 + 3.5, y + 1.07);
  d.k.paneT(cu0, ct0 + 0.3, ct0 + 3.5, y + 1.05, y + 1.45);
  d.W(0xd8c8a8, cu1 - 0.6, cu1, ct0, ct1, y + 1.05, y + 2.2);
  d.k.plane(d.k.canvas(512, 384, (g) => {
    g.fillStyle = '#1e1a16';
    g.fillRect(0, 0, 512, 384);
    text(g, 'Café Toto', 256, 60, "italic bold 56px 'Times New Roman', serif", '#f4e8d0');
    const menu: [string, string][] = [['ブレンドコーヒー', '¥650'], ['ロイヤルミルクティー', '¥720'], ['苺のショートケーキ', '¥780'], ['プリン・ア・ラ・モード', '¥980']];
    menu.forEach(([a, b], i) => {
      text(g, a, 40, 150 + i * 56, "30px 'Yu Gothic', sans-serif", '#e8dcc8', 'left');
      text(g, b, 472, 150 + i * 56, "30px 'Segoe UI', sans-serif", '#e8dcc8', 'right');
    });
  }), 2.4, 1.8, cu1 - 0.62, (ct0 + ct1) / 2, y + 3.0, '-u', 1.0);
  d.k.plane(d.sign('Café Toto', 'カフェ・トト', '#1e1a16', '#f4e8d0', 512, 160), 3.2, 1.0, 36.5, CAFE.t0 - 0.02, y + 3.6, 'out', 1.0);
  d.W(0x1e1a16, 34.8, 38.2, CAFE.t0 - 0.02, CAFE.t0, y + 3.1, CEIL_2F);
  for (const [u, t] of CAFE_TABLES) {
    d.lathe(0xf4f0ea, u, t, [[y, 0.25], [y + 0.03, 0.25], [y + 0.04, 0.04], [y + 0.72, 0.04], [y + 0.73, 0.45], [y + 0.76, 0.45]], 14);
    d.W(0xf4f0ea, u - 0.06, u + 0.06, t - 0.06, t + 0.06, y + 0.76, y + 0.85);
    for (const du of [0.8, -0.8]) {
      d.W(0x6a4a30, u + du - 0.22, u + du + 0.22, t - 0.22, t + 0.22, y + 0.42, y + 0.47);
      d.W(0x6a4a30, du > 0 ? u + du + 0.18 : u + du - 0.22, du > 0 ? u + du + 0.22 : u + du - 0.18, t - 0.22, t + 0.22, y + 0.47, y + 0.95);
      for (const [a, b] of [[-0.2, -0.2], [0.18, -0.2], [-0.2, 0.18], [0.18, 0.18]] as const) d.W(0x3a2a1e, u + du + a, u + du + a + 0.03, t + b, t + b + 0.03, y, y + 0.42);
    }
  }
  d.person(36, 49.5, -1, 0, { body: 'woman', pose: 'talk', color: [1.0, 0.8, 0.7], long: true });
  d.person(34.5, 51.2, 0, -1, { body: 'woman', color: [0.8, 0.9, 1.0], hair: 'bun' });
  d.person(40.8, 52, 1, 0, { body: 'man', color: [0.95, 0.95, 0.92], hair: 'cap' });

  // The ladies' lounge (back left): sofas round a low table, a plant, a long mirror.
  d.W(0xd8c8c0, IN.u0, 12, 47, IN.t1, y, y + 0.016);
  for (const [u0, u1, t0, t1] of LOUNGE_SOFAS) {
    d.W(0xb86a7a, u0, u1, t0, t1, y, y + 0.45);
    const tall = u1 - u0 < 1 ? ([u0, u0 + 0.25, t0, t1] as const) : t0 < 50 ? ([u0, u1, t0, t0 + 0.25] as const) : ([u0, u1, t1 - 0.25, t1] as const);
    d.W(0xb86a7a, tall[0], tall[1], tall[2], tall[3], y + 0.45, y + 0.9);
  }
  d.W(0x3a2a24, 4.6, 7.4, 50.4, 52.9, y + 0.35, y + 0.4);
  d.lathe(0x8a6a4a, 10.5, 50, [[y, 0.3], [y + 0.5, 0.35], [y + 0.52, 0.3]], 10);
  d.lathe(0x3a6a3a, 10.5, 50, [[y + 0.5, 0.1], [y + 0.9, 0.5], [y + 1.5, 0.55], [y + 2.0, 0.3], [y + 2.2, 0.02]], 10);
  d.glow([0.55, 0.57, 0.6], IN.u0 + 0.01, IN.u0 + 0.03, 48.5, 54.5, y + 0.9, y + 2.4);
  d.k.plane(d.sign('レディースラウンジ', "LADIES' LOUNGE", '#b86a7a', '#ffffff', 640, 128, false), 3.0, 0.6, 6, 47.02, y + 3.2, 'out', 1.0);
  d.W(0xc8b8b0, 2, 10, 46.9, 47.0, y + 2.8, CEIL_2F);
  d.person(5.5, 52, 1, 0, { body: 'woman', pose: 'phone', color: [1.0, 0.85, 0.9], hair: 'long' });

  // Shoppers.
  const shoppers: [number, number, number, number, Parameters<Kit['person']>[4]][] = [
    [22, 11, -1, 0, { body: 'woman', color: [1.0, 0.75, 0.85], hair: 'long', long: true }],
    [23, 11.4, -1, 0.3, { body: 'woman', pose: 'talk', color: [0.8, 0.85, 1.0], side: -1 }],
    [11, 20, 0, 1, { body: 'woman', pose: 'walk', color: [0.9, 1.0, 0.8], phase: 0.3 }],
    [32, 27, 0, -1, { body: 'woman', pose: 'walk', color: [1.0, 0.85, 0.6], phase: 0.8, long: true }],
    [6, 7, -1, 0, { body: 'woman', color: [0.9, 0.8, 1.0], hair: 'bun' }],
    [38, 18, 1, 0, { body: 'woman', pose: 'phone', color: [1.0, 0.7, 0.7] }],
    [7, 30, -1, 0.2, { body: 'man', pose: 'pockets', color: [0.8, 0.85, 0.95] }],
    [37.5, 40, 1, 0, { body: 'woman', color: [0.85, 0.95, 1.0], hair: 'hat', long: true }],
    [22.5, 45, 0, -1, { body: 'elder', color: [1.0, 0.9, 0.85], long: true }],
  ];
  for (const [u, t, du, dt, s] of shoppers) d.person(u, t, du, dt, s);
}

/** A boutique along a side wall: its fascia over the aisle, racks, a table, fitting rooms, mannequins, staff. */
function boutique(d: Draw, s: Shop): void {
  const y = F2;
  const t0 = s.t0;
  const t1 = s.t0 + SHOP_LEN;
  const U = (a: number): number => shopU(s, a);
  const span = (a0: number, a1: number): [number, number] => [Math.min(U(a0), U(a1)), Math.max(U(a0), U(a1))];
  const facing = s.side === 'L' ? '+u' : '-u';
  const toAisle = s.side === 'L' ? 1 : -1;
  d.W(s.wall, ...span(0, 0.05), t0, t1, y, CEIL_2F);
  d.W(s.wall, ...span(0, SHOP_DEPTH), t0 + 0.06, t1 - 0.06, y, y + 0.016);
  for (const t of [t0, t1]) d.W(0xf0ece6, ...span(0, 6.5), t - 0.06, t + 0.06, y, y + 3.2);
  // The fascia: a header over the shop's front with its name.
  d.W(0xf0ece6, ...span(SHOP_DEPTH - 0.2, SHOP_DEPTH), t0, t1, y + 3.6, CEIL_2F);
  const tex = d.sign(s.name, s.sub, s.bg, s.fg, 640, 160, !/Knit|MODE|和装/.test(s.name));
  d.k.plane(tex, 5.2, 1.3, U(SHOP_DEPTH) + toAisle * 0.02, (t0 + t1) / 2, y + 4.3, facing, 1.05);
  d.glow([0.9, 0.86, 0.78], ...span(SHOP_DEPTH - 0.2, SHOP_DEPTH - 0.1), t0 + 0.3, t1 - 0.3, y + 3.56, y + 3.6);
  if (s.kimono) {
    kimonoShop(d, s);
    return;
  }
  // The wall rack: garments on a rail, folded ones on a shelf above.
  d.W(0xc8ccd0, ...span(0.45, 0.5), t0 + 0.3, t1 - 1.8, y + 1.68, y + 1.72);
  for (let t = t0 + 0.4; t < t1 - 1.9; t += 0.11) {
    const hex = d.pick(s.clothes);
    d.W(hex, ...span(0.22, 0.78), t, t + 0.05, y + 0.75 + 0.2 * d.rnd(), y + 1.66);
  }
  d.glow([0.95, 0.9, 0.8], ...span(0, 0.5), t0 + 0.3, t1 - 1.8, y + 2.2, y + 2.23);
  for (let t = t0 + 0.4; t < t1 - 2.2; t += 0.45) d.W(d.pick(s.clothes), ...span(0.08, 0.42), t, t + 0.36, y + 2.23, y + 2.23 + (1 + Math.floor(d.rnd() * 3)) * 0.06);
  // The middle rack (both sides), the fitting rooms against the far partition.
  d.W(0xc8ccd0, ...span(3.78, 3.82), t0 + 1.5, t0 + 6, y + 1.5, y + 1.54);
  for (const t of [t0 + 1.5, t0 + 6]) d.W(0xc8ccd0, ...span(3.77, 3.83), t - 0.02, t + 0.02, y, y + 1.54);
  for (let t = t0 + 1.6; t < t0 + 5.9; t += 0.11) d.W(d.pick(s.clothes), ...span(3.5, 4.1), t, t + 0.05, y + 0.6 + 0.3 * d.rnd(), y + 1.48);
  d.W(0xf0ece6, ...span(1, 3), t1 - 1.6, t1 - 1.5, y, y + 2.3);
  d.W(0xf0ece6, ...span(1.95, 2.05), t1 - 1.5, t1, y, y + 2.3);
  d.W(0xf0ece6, ...span(1, 3), t1 - 1.6, t1, y + 2.3, y + 2.35);
  for (const [a0, a1] of [[1.05, 1.95], [2.05, 2.95]] as const) d.W(s.wall === 0x2a2a30 ? 0x6a1a2a : 0xd8d0c4, ...span(a0, a1), t1 - 1.62, t1 - 1.6, y + 0.15, y + 2.25);
  // A table of folded clothes, the cash desk, mannequins on a plinth at the front.
  d.W(0xd8c8b0, ...span(5.3, 6.9), t0 + 6.8, t0 + 8.4, y, y + 0.78);
  for (let t = t0 + 6.9; t < t0 + 8.2; t += 0.42) for (const a of [5.4, 5.85, 6.3]) d.W(d.pick(s.clothes), ...span(a, a + 0.36), t, t + 0.34, y + 0.78, y + 0.78 + (2 + Math.floor(d.rnd() * 3)) * 0.05);
  d.W(0xd8c8b0, ...span(7.5, 8.6), t0 + 1.4, t0 + 7.6, y, y + 0.2);
  for (const t of [t0 + 2.2, t0 + 4.5, t0 + 6.8]) mannequin(d, U(8.05), t, y + 0.2, d.pick(s.clothes));
  d.person(U(5.8), t0 + 3.6, toAisle, 0, { body: 'woman', color: s.bg === '#101014' ? [0.95, 0.9, 0.8] : [0.6, 0.6, 0.7], hair: 'bun', long: true });
  d.person(U(2), t0 + 4.2, -toAisle, 0.3, { body: 'woman', color: [1.0, 0.8, 0.9], hair: 'long' });
}

/** The kimono shop: kimono spread on stands (衣桁) and on the wall, a tatami dais with a low table. */
function kimonoShop(d: Draw, s: Shop): void {
  const y = F2;
  const t0 = s.t0;
  const t1 = s.t0 + SHOP_LEN;
  const U = (a: number): number => shopU(s, a);
  const span = (a0: number, a1: number): [number, number] => [Math.min(U(a0), U(a1)), Math.max(U(a0), U(a1))];
  const facing = s.side === 'L' ? '+u' : '-u';
  const toAisle = s.side === 'L' ? 1 : -1;
  const kimono = (base: string, flower: string, band: string): THREE.Texture =>
    d.k.canvas(320, 360, (g) => {
      g.clearRect(0, 0, 320, 360);
      g.fillStyle = base;
      g.beginPath();
      g.moveTo(0, 20);
      g.lineTo(320, 20);
      g.lineTo(320, 130);
      g.lineTo(250, 130);
      g.lineTo(250, 360);
      g.lineTo(70, 360);
      g.lineTo(70, 130);
      g.lineTo(0, 130);
      g.closePath();
      g.fill();
      g.fillStyle = flower;
      for (let i = 0; i < 24; i++) {
        const x = 20 + ((i * 131) % 280);
        const yy = 40 + ((i * 97) % 300);
        if ((x < 70 || x > 250) && yy > 130) continue;
        for (let p = 0; p < 5; p++) {
          g.beginPath();
          g.ellipse(x + Math.cos((p * Math.PI * 2) / 5) * 7, yy + Math.sin((p * Math.PI * 2) / 5) * 7, 6, 4, (p * Math.PI * 2) / 5, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.fillStyle = band;
      g.fillRect(70, 170, 180, 34);
      g.strokeStyle = 'rgba(255,255,255,0.6)';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(130, 20);
      g.lineTo(160, 170);
      g.lineTo(190, 20);
      g.stroke();
    });
  const looks = [kimono('#a01a2a', '#f4c8d0', '#e8c060'), kimono('#1a2a5a', '#e8e0f0', '#c8a040'), kimono('#e8c8d0', '#a02a4a', '#2a5a3a'), kimono('#2a5a3a', '#f0e0a0', '#a01a2a')];
  // Two on the back wall, two on lacquered stands facing the aisle.
  looks.slice(0, 2).forEach((tex, i) => {
    const m = d.k.plane(tex, 1.9, 2.1, U(0.08), t0 + 2.6 + i * 4.4, y + 1.6, facing, 1.0);
    (m.material as THREE.MeshBasicMaterial).transparent = true;
  });
  looks.slice(2).forEach((tex, i) => {
    const t = t0 + 2.5 + i * 4.8;
    for (const dt of [-1.05, 1.05]) d.W(0x2a0e0e, ...span(5.95, 6.05), t + dt - 0.04, t + dt + 0.04, y, y + 2.4);
    d.W(0x2a0e0e, ...span(5.95, 6.05), t - 1.2, t + 1.2, y + 2.3, y + 2.38);
    const m = d.k.plane(tex, 1.9, 2.1, U(6.07), t, y + 1.2, facing, 1.0);
    (m.material as THREE.MeshBasicMaterial).transparent = true;
  });
  // The tatami dais with a low table and cushions; a folded-obi display case.
  d.W(0xc8b87a, ...span(1.5, 4.5), t0 + 2.5, t0 + 7.5, y, y + 0.3);
  for (let t = t0 + 2.5; t < t0 + 7.4; t += 0.9) d.W(0x3a3020, ...span(1.5, 4.5), t, t + 0.02, y + 0.3, y + 0.302);
  d.W(0x2a0e0e, ...span(2.4, 3.6), t0 + 4.2, t0 + 5.8, y + 0.3, y + 0.62);
  for (const t of [t0 + 3.6, t0 + 6.4]) d.W(0x6a1a2a, ...span(2.7, 3.3), t - 0.3, t + 0.3, y + 0.3, y + 0.38);
  d.W(0x2a0e0e, ...span(7.5, 8.6), t0 + 1.4, t0 + 7.6, y, y + 0.85);
  d.glow([0.95, 0.9, 0.8], ...span(7.55, 8.55), t0 + 1.45, t0 + 7.55, y + 0.85, y + 0.87);
  for (let t = t0 + 1.6; t < t0 + 7.4; t += 0.5) d.W(d.pick([0xe8c060, 0xa01a2a, 0xf4f0e8, 0x2a5a3a]), ...span(7.7, 8.4), t, t + 0.3, y + 0.87, y + 0.93);
  // A stock cupboard where the other shops have fitting rooms.
  d.W(0x2a0e0e, ...span(1, 3), t1 - 1.6, t1, y, y + 2.3);
  d.person(U(3), t0 + 3.2, toAisle, 0, { body: 'elder', color: [1.0, 0.85, 0.8], hair: 'bun', long: true });
  d.person(U(6.8), t0 + 5, -toAisle, 0, { body: 'woman', pose: 'talk', color: [0.95, 0.8, 0.9], long: true });
}

/**
 * The store's interior: B1, 1F and 2F (the rooftop is part of the exterior). Starts hidden. A generator: it
 * yields between counters and shops, so the caller can spread the build over frames.
 */
export function* deptInterior(b: Building3, city: THREE.Material, ghost: THREE.Material): Generator<void, Interior> {
  const k = new Kit(b);
  const d = new Draw(k);
  yield* foodHall(d);
  yield* groundFloor(d);
  yield* fashionFloor(d);
  const group = k.finish(city, ghost);
  group.visible = false;
  return { group, ...deptLayout(b) };
}

/** The rooftop garden, built with the exterior: fence, lawn, shrine, carousel, rides, udon stand, telescopes. */
export function deptRoof(k: Kit): void {
  const y = ROOF;
  const d = new Draw(k);
  d.level = y;
  const lit = (hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, bottom = false): void => k.lit(hex, u0, u1, t0, t1, y0, y1, false, bottom);
  // Deck tiles, the lawn, paths.
  lit(0x8a8680, 0.2, 43.8, 1.4, 57.8, y, y + 0.03);
  lit(0x4a7a34, 5, 28, 8, 40, y + 0.03, y + 0.06);
  lit(0xb8b0a0, 13, 15, 8, 40, y + 0.03, y + 0.065);
  // The safety fence: posts, glass, a top rail.
  const FH = 2.6;
  for (let u = 0.8; u <= 43.3; u += 3.06) {
    k.box(0x3a3a3e, u - 0.05, u + 0.05, 1.65, 1.75, y, y + FH);
    k.box(0x3a3a3e, u - 0.05, u + 0.05, 56.95, 57.05, y, y + FH);
  }
  for (let t = 1.7; t <= 57; t += 3.05) {
    k.box(0x3a3a3e, 0.75, 0.85, t - 0.05, t + 0.05, y, y + FH);
    k.box(0x3a3a3e, 43.15, 43.25, t - 0.05, t + 0.05, y, y + FH);
  }
  k.pane(0.8, 43.2, y + 0.1, y + FH, 1.7);
  k.pane(0.8, 43.2, y + 0.1, y + FH, 57);
  k.paneT(0.8, 1.7, 57, y + 0.1, y + FH);
  k.paneT(43.2, 1.7, 57, y + 0.1, y + FH);
  k.box(0x3a3a3e, 0.75, 43.25, 1.65, 1.75, y + FH, y + FH + 0.06, true);
  k.box(0x3a3a3e, 0.75, 43.25, 56.95, 57.05, y + FH, y + FH + 0.06, true);
  k.box(0x3a3a3e, 0.75, 0.85, 1.65, 57.05, y + FH, y + FH + 0.06, true);
  k.box(0x3a3a3e, 43.15, 43.25, 1.65, 57.05, y + FH, y + FH + 0.06, true);
  // The crown sign's frame behind the neon (seen from the roof).
  for (let u = 9; u <= 35; u += 4.33) k.box(0x4a4a4e, u - 0.08, u + 0.08, 1.35, 1.5, y, y + 5.2);
  for (const h of [1.6, 3.6, 5.1]) k.box(0x4a4a4e, 9, 35, 1.38, 1.47, y + h, y + h + 0.1, true);

  // The elevator house: pale stone, lift doors facing the garden, the rooftop sign.
  const [eu0, eu1, et0, et1] = ROOF_HOUSE;
  k.box(0xd8ccb4, eu0, eu1, et0, et1, y, y + 4.4);
  k.box(0x3a3a3e, eu0 - 0.2, eu1 + 0.2, et0 - 1.6, et1 + 0.2, y + 4.4, y + 4.6, true);
  for (const u of [20.5, 24.5]) {
    lit(0xc8b890, u - 0.8, u + 0.8, et0 - 0.04, et0, y, y + 2.5);
    k.glow([1.2, 0.7, 0.3], u - 0.3, u + 0.3, et0 - 0.06, et0 - 0.04, y + 2.62, y + 2.72);
  }
  k.glow([0.9, 0.85, 0.7], eu0, eu1, et0 - 1.5, et0 - 1.3, y + 4.36, y + 4.4, EMIT.lit);
  k.plane(d.sign('屋上庭園', 'ROOFTOP GARDEN · TOTO', '#2a241c', '#e8d8b0', 640, 160), 4.6, 1.15, 22.5, et0 - 0.03, y + 3.4, 'out', 1.1);
  // Vending machines by the house.
  for (const [u, rgb] of [[30, [0.9, 0.95, 1.0]], [31, [1.0, 0.5, 0.45]]] as const) {
    k.box(u > 30.5 ? 0xc82a2a : 0xe8e8ec, u - 0.45, u + 0.45, 55.5, 56.4, y, y + 1.85);
    k.glow(rgb as C3, u - 0.38, u + 0.38, 55.46, 55.5, y + 0.8, y + 1.7, EMIT.lit);
  }

  // The rooftop shrine (屋上神社): a stone base, a small hall, a red torii, two lanterns.
  const [su0, su1, st0, st1] = SHRINE;
  k.box(0xa8a49c, su0, su1, st0 + 1, st1, y, y + 0.35);
  k.box(0x8a6a4a, 5.3, 7.7, 49, 51.6, y + 0.35, y + 1.9);
  k.box(0xe8e0d0, 5.9, 7.1, 48.96, 49.0, y + 0.7, y + 1.6);
  const P = (u: number, t: number, yy: number): [number, number, number] => d.P(u, t, yy);
  k.mb.kind = KIND.roof;
  k.mb.color = lin(0x3a3a40);
  for (const [a, b] of [[4.9, 6.5], [8.1, 6.5]] as const) {
    k.mb.poly4(P(a, 48.6, y + 1.9), P(a, 52, y + 1.9), P(b, 52, y + 2.6), P(b, 48.6, y + 2.6));
    k.mb.poly4(P(a, 52, y + 1.9), P(a, 48.6, y + 1.9), P(b, 48.6, y + 2.6), P(b, 52, y + 2.6));
  }
  for (const u of [3.8, 9.1]) k.box(0xd8321e, u - 0.12, u + 0.12, 44.7, 44.9, y, y + 2.6);
  k.box(0xd8321e, 3.3, 9.6, 44.65, 44.95, y + 2.6, y + 2.8, true);
  k.box(0x1a1a1a, 3.1, 9.8, 44.6, 45.0, y + 2.8, y + 2.9, true);
  k.box(0xd8321e, 3.7, 9.2, 44.72, 44.88, y + 2.1, y + 2.22, true);
  for (const u of [4.8, 8.2]) {
    k.lathe(0xa8a49c, u, 47, [[y, 0.25], [y + 0.1, 0.2], [y + 0.12, 0.08], [y + 0.8, 0.08], [y + 0.82, 0.25], [y + 0.9, 0.25]], 8);
    k.glow([1.2, 0.7, 0.35], u - 0.12, u + 0.12, 46.88, 47.12, y + 0.9, y + 1.2, EMIT.lamp);
    k.lathe(0xa8a49c, u, 47, [[y + 1.2, 0.3], [y + 1.35, 0.02]], 8);
  }
  k.plane(d.sign('東都稲荷', 'TOTO INARI', '#f4ece0', '#8a1a14', 256, 96), 1.0, 0.38, 6.45, 44.58, y + 2.45, 'out', 1.0);

  // The carousel: a turning platform (still, at this hour), its horses, a striped canopy with bulbs.
  const { u: cu, t: ct, r } = CAROUSEL;
  lit(0xe8d8c0, cu - r, cu + r, ct - r, ct + r, y, y + 0.02);
  k.lathe(0xc8a860, cu, ct, [[y, r], [y + 0.3, r], [y + 0.32, r - 0.1]], 20);
  k.post(0xc8a860, cu, ct, y, y + 3.4, 0.25, 10);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const hu = cu + Math.cos(a) * (r - 0.8);
    const ht = ct + Math.sin(a) * (r - 0.8);
    k.post(0xe8d090, hu, ht, y + 0.3, y + 3.2, 0.03, 6);
    const hex = [0xf4f0ea, 0xe8a0b8, 0x8ab8e8, 0xf4d070][i % 4];
    k.lathe(hex, hu, ht, [[y + 1.0, 0.02], [y + 1.05, 0.22], [y + 1.35, 0.26], [y + 1.55, 0.16], [y + 1.8, 0.1], [y + 1.9, 0.01]], 8);
  }
  k.lathe(0xe84a5a, cu, ct, [[y + 3.1, r + 0.2], [y + 3.3, r + 0.2], [y + 4.4, 0.6], [y + 4.6, 0.1], [y + 5.0, 0.05]], 16);
  k.lathe(0xf4f0e8, cu, ct, [[y + 3.29, r + 0.22], [y + 3.5, r - 0.2]], 16);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const bu = cu + Math.cos(a) * (r + 0.22);
    const bt = ct + Math.sin(a) * (r + 0.22);
    k.glow([1.4, 1.1, 0.6], bu - 0.06, bu + 0.06, bt - 0.06, bt + 0.06, y + 3.1, y + 3.22, EMIT.lamp);
  }
  // Coin rides: a panda, an elephant, a little red car.
  RIDES.forEach(([u, t, hex], i) => {
    k.box(0x5a5a60, u - 0.7, u + 0.7, t - 0.5, t + 0.5, y, y + 0.25);
    k.box(hex, u - 0.55, u + 0.55, t - 0.3, t + 0.3, y + 0.25, y + 0.85);
    k.box(hex, u + 0.35, u + 0.8, t - 0.25, t + 0.25, y + 0.6, y + 1.1);
    if (i === 0) {
      for (const dt of [-0.18, 0.18]) k.box(0x1a1a1a, u + 0.5, u + 0.62, t + dt - 0.06, t + dt + 0.06, y + 1.1, y + 1.22);
      for (const [a, b] of [[-0.45, -0.3], [0.35, -0.3], [-0.45, 0.2], [0.35, 0.2]] as const) k.box(0x1a1a1a, u + a, u + a + 0.14, t + b, t + b + 0.12, y + 0.25, y + 0.6);
    }
    if (i === 1) k.box(hex, u + 0.75, u + 0.9, t - 0.06, t + 0.06, y + 0.3, y + 0.85);
    k.glow([1.2, 1.0, 0.5], u - 0.7, u - 0.6, t - 0.12, t + 0.12, y + 0.3, y + 0.5, EMIT.lit);
  });
  k.plane(d.sign('こどもの広場', "KIDS' CORNER · ¥100", '#f4d040', '#c82a2a', 512, 128, false), 3.0, 0.75, 34, 8.3, y + 2.2, 'out', 1.0);
  for (const u of [32.4, 35.6]) k.box(0x3a3a3e, u - 0.04, u + 0.04, 8.26, 8.34, y, y + 1.85);

  // The udon stand: a kiosk with its noren and lantern, a counter to stand at, benches.
  const [uu0, uu1, ut0, ut1] = UDON;
  k.box(0x8a6a4a, uu0, uu1, ut0 + 0.8, ut1, y, y + 2.8);
  lit(0xf4e8d0, uu0 + 0.3, uu1 - 0.3, ut0 + 0.78, ut0 + 0.8, y + 1.1, y + 2.3);
  k.box(0x5a3a24, uu0, uu1, ut0, ut0 + 0.8, y, y + 1.05);
  k.box(0x3a2a1e, uu0 - 0.2, uu1 + 0.2, ut0 - 0.6, ut1 + 0.2, y + 2.8, y + 3.0, true);
  k.plane(d.k.canvas(512, 160, (g) => {
    g.fillStyle = '#1a2a4a';
    g.fillRect(0, 0, 512, 160);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    for (const x of [128, 256, 384]) g.fillRect(x - 2, 30, 4, 130);
    text(g, 'うどん・そば', 256, 80, "bold 70px 'Yu Mincho', serif", '#ffffff');
  }), 5, 0.9, (uu0 + uu1) / 2, ut0 - 0.02, y + 2.35, 'out', 1.0);
  k.glow([1.3, 0.5, 0.25], uu1 - 0.1, uu1 + 0.3, ut0 - 0.2, ut0 + 0.2, y + 1.9, y + 2.5, EMIT.lamp);
  for (const [u0, u1, t0, t1] of [[16, 20, 43, 43.5], [25, 29, 43, 43.5], [6, 10, 20, 20.5], [6, 10, 28, 28.5]] as const) {
    lit(0xa8784a, u0, u1, t0, t1, y + 0.42, y + 0.48);
    for (const u of [u0 + 0.2, u1 - 0.3]) k.box(0x3a3a3e, u, u + 0.1, t0 + 0.1, t1 - 0.1, y, y + 0.42);
  }
  // Telescopes at the front fence, pointed over the city; planters with small trees; lamps.
  for (const u of TELESCOPES) {
    k.post(0x5a6a7a, u, 2.6, y, y + 1.2, 0.06, 8);
    k.box(0x2a5a8a, u - 0.18, u + 0.18, 2.2, 2.9, y + 1.2, y + 1.5);
    k.box(0x1a1a1a, u - 0.14, u + 0.14, 2.1, 2.2, y + 1.25, y + 1.45);
  }
  for (const [u, t] of PLANTERS) {
    k.box(0x9a948a, u - 0.8, u + 0.8, t - 0.8, t + 0.8, y, y + 0.6);
    k.post(0x5a4030, u, t, y + 0.6, y + 1.8, 0.08, 6);
    k.lathe(0x3a6a2e, u, t, [[y + 1.4, 0.1], [y + 1.8, 0.9], [y + 2.4, 1.0], [y + 3.0, 0.6], [y + 3.3, 0.05]], 8);
  }
  for (const [u, t] of [[5, 8], [28, 8], [5, 40], [28, 40]] as const) {
    k.post(0x2a2a2e, u, t, y, y + 3.2, 0.05, 6);
    k.glow([1.3, 1.1, 0.8], u - 0.15, u + 0.15, t - 0.15, t + 0.15, y + 3.2, y + 3.45, EMIT.lamp);
  }
  // People: children at the rides, a couple at the fence, someone at the shrine, customers at the stand.
  d.person(32.2, 11.2, 0, -1, { body: 'child', color: [1.0, 0.85, 0.5] });
  d.person(33.2, 11.4, -0.5, -1, { body: 'woman', pose: 'hold', color: [1.0, 0.75, 0.8], side: -1 });
  d.person(36.6, 11.2, 0, -1, { body: 'child', pose: 'wave', color: [0.6, 0.9, 1.0] });
  d.person(21.9, 3.2, 0, -1, { body: 'man', pose: 'hold', color: [0.75, 0.85, 1.0], side: 1 });
  d.person(22.6, 3.2, 0, -1, { body: 'woman', pose: 'hold', color: [1.0, 0.8, 0.9], side: -1, long: true });
  d.person(6.4, 48.2, 0, 1, { body: 'elder', color: [1.0, 0.9, 0.8] });
  d.person(36, 46.3, 0, 1, { body: 'man', pose: 'pockets', color: [0.85, 0.85, 0.95], long: true });
  d.person(38.5, 46.3, 0, 1, { body: 'man', color: [0.9, 0.95, 0.85], hair: 'cap' });
  d.person(18, 43.9, 0, -1, { body: 'elder', color: [0.95, 0.9, 1.0], hair: 'hat' });
  d.person(19, 43.9, 0, -1, { body: 'elder', pose: 'talk', color: [1.0, 0.85, 0.85], long: true });
}
