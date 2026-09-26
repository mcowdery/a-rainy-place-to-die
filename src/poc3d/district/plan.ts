import { overlaps, type Rect } from '../../core/coords';
import { hash, rng, type Rng } from '../../core/hash';
import { isWide } from '../../core/wide';
import { isLand, type CellKind, type DistrictId, type MacroMap } from '../../gen/macro';
import { STYLES } from '../../gen/styles';
import type { AdCategory } from '../models/ads';

/**
 * 3D district planner: the 2D prototype's model (L0 macro cells, hashed cell-edge roads, BSP into
 * blocks, blocks into lots, stamps reserving space) in metres instead of tiles.
 *
 * Coordinates: metres, x east, z south, y up. A macro cell is CELL x CELL metres; cell (mx, my) spans
 * x in [mx*CELL, (mx+1)*CELL), z in [my*CELL, (my+1)*CELL). Rects reuse core/coords Rect with y = z.
 * Everything is a pure function of (seed, L0 map, reserved rects), so any cell regenerates identically.
 */
export const CELL = 128;

export type Side = 'north' | 'south' | 'east' | 'west';

export interface Road3 {
  readonly rect: Rect;
  readonly kind: 'boulevard' | 'street' | 'alley' | 'coast';
  /** Raised sidewalk width on each long side (0 = shared surface). */
  readonly sidewalk: number;
  readonly vertical: boolean;
}

export interface Sign3 {
  readonly text: string;
  readonly vertical: boolean;
  /** Hex colour. */
  readonly color: number;
  /** Anchor in world metres: top of a vertical sign, centre of a horizontal one. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Facade normal (the sign is only readable from this side). */
  readonly nx: number;
  readonly nz: number;
}

export interface Building3 {
  /** Stable id: seeds the facade style, hue and windows in the shader. */
  readonly id: number;
  /** Footprint centre and size. */
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
  /** Which face fronts the street. */
  readonly front: Side;
  readonly hue?: number;
  /** The zone it was generated in (look and ads); absent for stamps and zone-less districts. */
  readonly zone?: Zone3;
}

/** How a zone's buildings look: window-type weights and wall colours (see real/buildings.ts). */
export interface ZoneLook {
  /** [weight, WIN type] pairs. */
  readonly windows: readonly (readonly [number, number])[] | null;
  readonly walls: readonly number[] | null;
  /** Whether those walls are tiled (the small-tile finish of Japanese mid-rises). */
  readonly tiled: boolean;
  /** Storefront interiors: [weight, palette] pairs (0 warm, 1 cool white, 2 colourful, 3 dim bar). */
  readonly shops: readonly (readonly [number, number])[] | null;
  /** Share of storefronts open (the rest are shuttered). */
  readonly open: number | null;
}

/**
 * An area within a district with its own character (content/world3d/zones/*.yaml): planner parameters
 * (street and alley density, lot widths, heights, signs), the look of its buildings and its ad mix.
 */
export interface Zone3 {
  /** Its letter in the zone map. */
  readonly key: string;
  readonly id: string;
  readonly name: string;
  readonly style: DistrictStyle3;
  readonly look: ZoneLook;
  /** Category weights for the zone's billboards and posters. */
  readonly ads: Readonly<Partial<Record<AdCategory, number>>>;
}

export interface CellPlan3 {
  readonly mx: number;
  readonly my: number;
  readonly kind: DistrictId;
  readonly rect: Rect;
  readonly roads: readonly Road3[];
  readonly buildings: readonly Building3[];
  readonly signs: readonly Sign3[];
}

type Range = readonly [number, number];

export interface DistrictStyle3 {
  /** In-world name for the HUD. */
  readonly name: string;
  readonly edgeRoads: readonly number[];
  readonly localStreet: Range;
  /** Blocks split while larger than max, never below min. */
  readonly block: Range;
  /** Blocks deeper than this become two rows of lots back to back. */
  readonly twoRowDepth: number;
  readonly lotW: Range;
  readonly lotGap: number;
  /** Storeys: [min, max, weight] bands. */
  readonly floors: readonly (readonly [number, number, number])[];
  readonly signChance: number;
  readonly verticalSign: number;
  readonly signWords: readonly string[];
  readonly signColors: readonly number[];
}

const BOUNDARY_ROAD = 16;
const COAST = 4;
const FLOOR_H = 3;

export const NEON_SIGN_COLORS = [0xff5fc8, 0x4fe3ff, 0xffe45f, 0x6bff8a, 0xff4f4f, 0xb48cff] as const;

/** Only districts with a 3D style are generated; others are left as open ground for now. */
export const STYLES3: Readonly<Partial<Record<DistrictId, DistrictStyle3>>> = {
  neon: {
    name: 'Kaburo',
    edgeRoads: [8, 10, 12],
    localStreet: [3, 7],
    block: [18, 46],
    twoRowDepth: 24,
    lotW: [6, 13],
    lotGap: 0.12,
    floors: [
      [3, 9, 78],
      [12, 20, 17],
      [25, 33, 5],
    ],
    signChance: 0.85,
    verticalSign: 0.55,
    signWords: [...STYLES.neon.signs.words, 'スナック 夜', 'ネオン', '麻雀', 'バー', '二次会', 'LIVE', 'PACHINKO', 'GAME CENTER', 'カラオケ館', '風俗案内所'],
    signColors: NEON_SIGN_COLORS,
  },
  tower: {
    name: 'Asagiri',
    edgeRoads: [10, 12, 14],
    localStreet: [6, 10],
    block: [30, 60],
    twoRowDepth: 30,
    lotW: [14, 26],
    lotGap: 0.3,
    floors: [
      [8, 15, 30],
      [18, 32, 45],
      [38, 52, 25],
    ],
    signChance: 0.35,
    verticalSign: 0.2,
    signWords: ['BANK', '銀行', 'HOTEL', 'CAFE', '郵便局', 'CLINIC', '証券', '保険', 'ビジネス', '書店', 'BAKERY', 'GYM'],
    signColors: [0xffffff, 0x4fe3ff, 0xffe45f, 0x6bff8a],
  },
};

/** Every district with a 3D style, i.e. every district the 3D city generates. */
export const DISTRICTS3 = Object.keys(STYLES3) as DistrictId[];

export const cellKey = (mx: number, my: number): number => my * 4096 + mx;

/** Width of the boulevards that meet at a scramble crossing. */
export const SCRAMBLE_ROAD = 18;

/** Key of a cell-edge road: the west/north cell of the pair and the edge's direction. */
export const edgeKey = (keyX: number, keyY: number, vertical: boolean): string => `${keyX},${keyY},${vertical ? 'v' : 'h'}`;

export function planCell3(
  macro: MacroMap,
  mx: number,
  my: number,
  reserved: readonly Rect[],
  seed: number,
  zone?: Zone3,
  /** Cell edges widened to boulevards (edgeKey), e.g. the approaches to a scramble crossing. */
  wide?: ReadonlySet<string>,
): CellPlan3 | null {
  const kind = macro.kindAt(mx, my);
  if (!isLand(kind)) return null;
  if (!STYLES3[kind]) return null;
  const style = zone?.style ?? STYLES3[kind]!;
  const R: Rect = { x: mx * CELL, y: my * CELL, w: CELL, h: CELL };
  const roads: Road3[] = [];

  const edge = (neighbour: CellKind, keyX: number, keyY: number, vertical: boolean): number => {
    if (neighbour !== kind) return BOUNDARY_ROAD;
    if (wide?.has(edgeKey(keyX, keyY, vertical))) return SCRAMBLE_ROAD;
    const opts = style.edgeRoads;
    return opts[hash(seed, keyX, keyY, vertical ? 1 : 2) % opts.length];
  };
  const road = (rect: Rect, width: number, vertical: boolean, coast = false): Road3 => ({
    rect,
    vertical,
    kind: coast ? 'coast' : width >= 14 ? 'boulevard' : width >= 8 ? 'street' : width >= 3 ? 'street' : 'alley',
    sidewalk: coast ? 0 : width >= 8 ? Math.min(3, width * 0.2) : 0,
  });

  // Cell edges: roads centred on the boundary (each side owns half), width hashed from the shared edge
  // so both cells agree; coast strips where the neighbour is water or void.
  const insets = { w: 0, e: 0, n: 0, s: 0 };
  const sides: [keyof typeof insets, number, number, boolean][] = [
    ['w', mx - 1, my, true],
    ['e', mx + 1, my, true],
    ['n', mx, my - 1, false],
    ['s', mx, my + 1, false],
  ];
  for (const [side, nx, ny, vertical] of sides) {
    const n = macro.kindAt(nx, ny);
    if (!isLand(n)) {
      const r = side === 'w' ? { x: R.x, y: R.y, w: COAST, h: CELL } : side === 'e' ? { x: R.x + CELL - COAST, y: R.y, w: COAST, h: CELL }
        : side === 'n' ? { x: R.x, y: R.y, w: CELL, h: COAST } : { x: R.x, y: R.y + CELL - COAST, w: CELL, h: COAST };
      roads.push(road(r, COAST, vertical, true));
      insets[side] = COAST;
      continue;
    }
    const keyX = side === 'w' ? mx - 1 : mx;
    const keyY = side === 'n' ? my - 1 : my;
    const w = edge(n, keyX, keyY, vertical);
    const r = side === 'w' ? { x: R.x - w / 2, y: R.y, w, h: CELL } : side === 'e' ? { x: R.x + CELL - w / 2, y: R.y, w, h: CELL }
      : side === 'n' ? { x: R.x, y: R.y - w / 2, w: CELL, h: w } : { x: R.x, y: R.y + CELL - w / 2, w: CELL, h: w };
    roads.push(road(r, w, vertical));
    insets[side] = w / 2;
  }

  const interior: Rect = { x: R.x + insets.w, y: R.y + insets.n, w: CELL - insets.w - insets.e, h: CELL - insets.n - insets.s };
  const rnd = rng(hash(seed, mx, my, 0x3d));
  const blocks: Rect[] = [];
  subdivide(interior, style, rnd, roads, blocks, reserved, road);

  const buildings: Building3[] = [];
  const signs: Sign3[] = [];
  // 256 ids per cell (dense zones have many small lots); stamps use 900000 and up.
  const idBase = 1 + (my * macro.cols + mx) * 256;
  for (const b of blocks) fillBlock(b, style, rnd, reserved, buildings, signs, idBase, zone);
  return { mx, my, kind, rect: R, roads, buildings, signs };
}

function subdivide(
  r: Rect,
  style: DistrictStyle3,
  rnd: Rng,
  roads: Road3[],
  out: Rect[],
  reserved: readonly Rect[],
  road: (rect: Rect, width: number, vertical: boolean) => Road3,
): void {
  const [min, max] = style.block;
  const splitX = r.w > max;
  const splitZ = r.h > max;
  if (!splitX && !splitZ) return void out.push(r);
  const s = rnd.float() * (style.localStreet[1] - style.localStreet[0]) + style.localStreet[0];
  const vertical = splitX && (!splitZ || r.w >= r.h);
  const span = vertical ? r.w : r.h;
  const lo = min;
  const hi = span - min - s;
  if (hi < lo) return void out.push(r);
  for (let attempt = 0; attempt < 8; attempt++) {
    const cut = lo + rnd.float() * (hi - lo);
    const rect: Rect = vertical ? { x: r.x + cut, y: r.y, w: s, h: r.h } : { x: r.x, y: r.y + cut, w: r.w, h: s };
    if (reserved.some((q) => overlaps(q, rect))) continue;
    roads.push(road(rect, s, vertical));
    if (vertical) {
      subdivide({ x: r.x, y: r.y, w: cut, h: r.h }, style, rnd, roads, out, reserved, road);
      subdivide({ x: r.x + cut + s, y: r.y, w: r.w - cut - s, h: r.h }, style, rnd, roads, out, reserved, road);
    } else {
      subdivide({ x: r.x, y: r.y, w: r.w, h: cut }, style, rnd, roads, out, reserved, road);
      subdivide({ x: r.x, y: r.y + cut + s, w: r.w, h: r.h - cut - s }, style, rnd, roads, out, reserved, road);
    }
    return;
  }
  out.push(r);
}

/**
 * A block becomes one or two rows of lots along x, each fronting the block's north or south street; the
 * corner lots at either end of a row front the side street instead, so every street is lined with fronts.
 */
function fillBlock(block: Rect, style: DistrictStyle3, rnd: Rng, reserved: readonly Rect[], buildings: Building3[], signs: Sign3[], idBase: number, zone?: Zone3): void {
  const rows: { r: Rect; front: Side }[] = [];
  if (block.h > style.twoRowDepth) {
    const split = block.h * (0.4 + rnd.float() * 0.2);
    rows.push({ r: { x: block.x, y: block.y, w: block.w, h: split }, front: 'north' });
    rows.push({ r: { x: block.x, y: block.y + split, w: block.w, h: block.h - split }, front: 'south' });
  } else {
    rows.push({ r: block, front: rnd.chance(0.5) ? 'north' : 'south' });
  }
  for (const { r, front } of rows) {
    let x = r.x;
    const end = r.x + r.w;
    while (end - x > 0.5) {
      let w = style.lotW[0] + rnd.float() * (style.lotW[1] - style.lotW[0]);
      if (end - x - w < style.lotW[0]) w = end - x;
      const lot: Rect = { x, y: r.y, w, h: r.h };
      const lotFront: Side = x === r.x && end - x - w > 0.5 ? 'west' : end - x - w <= 0.5 && x > r.x ? 'east' : front;
      x += w;
      if (end - x > style.lotW[0] + 2 && rnd.chance(style.lotGap)) x += 1.5; // service alley
      const height = pickFloors(style, rnd) * FLOOR_H;
      if (reserved.some((q) => overlaps(q, lot))) continue;
      if (buildings.length >= 255) continue;
      // Small gaps between neighbours so each building reads as its own mass (edges in the ASCII pass).
      const b: Building3 = { id: idBase + buildings.length, x: lot.x + lot.w / 2, z: lot.y + lot.h / 2, w: lot.w - 0.4, d: lot.h - 0.4, h: height, front: lotFront, ...(zone ? { zone } : {}) };
      buildings.push(b);
      if (rnd.chance(style.signChance)) signs.push(makeSign(b, style, rnd));
    }
  }
}

function pickFloors(style: DistrictStyle3, rnd: Rng): number {
  let total = 0;
  for (const [, , wgt] of style.floors) total += wgt;
  let roll = rnd.float() * total;
  for (const [lo, hi, wgt] of style.floors) {
    roll -= wgt;
    if (roll < 0) return rnd.int(lo, hi);
  }
  return style.floors[0][0];
}

/** Facade normal and a point on the front face, u metres from the face's left end seen from outside. */
export function frontPoint(b: Pick<Building3, 'x' | 'z' | 'w' | 'd' | 'front'>, u: number, out = 0): { x: number; z: number; nx: number; nz: number } {
  const x0 = b.x - b.w / 2;
  const z0 = b.z - b.d / 2;
  switch (b.front) {
    case 'south': return { x: x0 + u, z: z0 + b.d + out, nx: 0, nz: 1 };
    case 'north': return { x: x0 + b.w - u, z: z0 - out, nx: 0, nz: -1 };
    case 'east': return { x: x0 + b.w + out, z: z0 + b.d - u, nx: 1, nz: 0 };
    case 'west': return { x: x0 - out, z: z0 + u, nx: -1, nz: 0 };
  }
}

export const frontWidth = (b: Pick<Building3, 'w' | 'd' | 'front'>): number => (b.front === 'north' || b.front === 'south' ? b.w : b.d);

function makeSign(b: Building3, style: DistrictStyle3, rnd: Rng): Sign3 {
  const text = rnd.pick(style.signWords);
  const color = rnd.pick(style.signColors);
  const allWide = [...text].every((c) => isWide(c.codePointAt(0)!) || c === ' ');
  const vertical = allWide && b.h >= 9 && rnd.chance(style.verticalSign);
  const fw = frontWidth(b);
  if (vertical) {
    const p = frontPoint(b, rnd.chance(0.5) ? 1.2 : fw - 1.2, 0.4);
    return { text, vertical, color, x: p.x, y: Math.min(b.h - 1, 7 + rnd.float() * 6), z: p.z, nx: p.nx, nz: p.nz };
  }
  // Horizontal signs sit on the fascia over the shopfront.
  const p = frontPoint(b, fw / 2, 0.4);
  return { text, vertical, color, x: p.x, y: 3.6, z: p.z, nx: p.nx, nz: p.nz };
}
