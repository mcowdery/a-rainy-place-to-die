import { overlaps, type Rect } from '../../core/coords';
import { hash, rng, type Rng } from '../../core/hash';
import { isWide } from '../../core/wide';
import { isLand, type CellKind, type DistrictId, type MacroMap } from '../../gen/macro';
import { STYLES } from '../../gen/styles';
import type { AdCategory } from '../models/ads';
import type { EdgeSpec } from './roads';

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
  /** A raised central strip (m; 0 for none): an avenue's median, broken at junctions (`CellPlan3.medians`). */
  readonly median: number;
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
  /** A corner lot's corner cut at the junction (sumikiri): which footprint corner, and the cut's leg in metres. */
  readonly cut?: { readonly corner: Corner; readonly size: number };
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
  /** Share of buildings that are homes: a front door and a window on the ground floor, no shop. */
  readonly homes: number;
  /** Share of low homes (up to three storeys) with a pitched roof. */
  readonly roofs: number;
  /** Share of homes with bicycles parked out front. */
  readonly bikes: number;
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
  /** The neighbourhood's name for the HUD, when its zone file gives one (a residential area among several). */
  readonly area: string | null;
  /** Category weights for the zone's billboards and posters. */
  readonly ads: Readonly<Partial<Record<AdCategory, number>>>;
}

/**
 * Open ground: lots a row leaves open between buildings (coin parking, a pocket playground, a vacant
 * lot), the public plaza round towers, and parks.
 */
export type OpenKind = 'parking' | 'playground' | 'vacant' | 'plaza' | 'park' | 'yard';
/** The kinds a row of lots can leave open (plazas come from towerCover, parks from park). */
export const LOT_OPEN = ['parking', 'playground', 'vacant'] as const;
export type LotOpenKind = (typeof LOT_OPEN)[number];

export interface OpenLot3 {
  readonly kind: OpenKind;
  readonly rect: Rect;
  /** The street it opens onto (its entrance). */
  readonly front: Side;
  /** Seeds its dressing. */
  readonly seed: number;
}

export interface CellPlan3 {
  readonly mx: number;
  readonly my: number;
  readonly kind: DistrictId;
  readonly rect: Rect;
  /** The style it was planned with (the zone's, or the district's). */
  readonly style: DistrictStyle3;
  readonly roads: readonly Road3[];
  /** The avenues' medians in this cell: raised strips down their middle, broken where streets cross. */
  readonly medians: readonly Rect[];
  readonly buildings: readonly Building3[];
  readonly open: readonly OpenLot3[];
  readonly signs: readonly Sign3[];
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

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
  /** Share of lots left open, by kind (coin parking, a pocket playground, a vacant lot). */
  readonly open: Readonly<Partial<Record<LotOpenKind, number>>>;
  /** Metres left open behind a building (back yards, light wells) and in front of it (half of them). */
  readonly rear: Range;
  readonly setback: Range;
  /** Chance a mid-rise steps its top floors back from the street (the road slant-plane limit). */
  readonly stepBack: number;
  /** Chance of a street tree at each slot along streets with pavements (boulevards always get them). */
  readonly streetTrees: number;
  /** Chance of a planted strip along the kerb between the trees. */
  readonly hedges: number;
  /** Chance a building keeps potted plants out front. */
  readonly pots: number;
  /** Towers standing in plazas: the share of a block each tower covers (null: rows of lots). */
  readonly towerCover: Range | null;
  /** Share of the cell given to a park (0 none, 1 the whole cell). */
  readonly park: number;
  /** Chance a big block (30 m and up) is a container yard, fenced, stacked and floodlit (the port). */
  readonly yardCover?: number;
  /**
   * Generate only the cells the district's zone file paints: a bounded neighbourhood in a district whose
   * L0 cells spread far beyond it (the residential ring round the centre).
   */
  readonly onlyZoned?: boolean;
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
    open: { parking: 0.06, vacant: 0.02, playground: 0.01 },
    rear: [0.5, 2.5],
    setback: [0.3, 1.2],
    stepBack: 0.35,
    streetTrees: 0.4,
    hedges: 0.3,
    pots: 0.15,
    towerCover: null,
    park: 0,
  },
  tower: {
    name: 'Asagiri',
    // West Shinjuku's grid of wide avenues (the loop's are wider still: roads.yaml). At most 20 m where a
    // subway runs under them (its stations stand 10 m from the road's centre).
    edgeRoads: [16, 18, 18],
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
    open: { parking: 0.04 },
    rear: [1, 4],
    setback: [0.5, 3],
    stepBack: 0.3,
    streetTrees: 0.9,
    hedges: 0.6,
    pots: 0.05,
    towerCover: null,
    park: 0,
  },
  residential: {
    // Sakuragaoka: houses and small apartment buildings on narrow lanes, only where its zones are painted.
    name: 'Sakuragaoka',
    edgeRoads: [6, 8, 10],
    localStreet: [3, 5],
    block: [16, 40],
    twoRowDepth: 22,
    lotW: [7, 12],
    lotGap: 0.4,
    floors: [
      [2, 2, 60],
      [3, 3, 22],
      [4, 6, 12],
      [8, 12, 6],
    ],
    signChance: 0.12,
    verticalSign: 0.3,
    signWords: ['クリーニング', '理容', 'コインランドリー', '薬局', '八百屋', '酒店', 'パン', 'たばこ', '歯科', '整骨院', '不動産', '牛乳'],
    signColors: [0xffffff, 0x4fe3ff, 0xffe45f, 0x6bff8a],
    open: { parking: 0.07, playground: 0.03, vacant: 0.03 },
    rear: [1.5, 3.5],
    setback: [0.8, 2.4],
    stepBack: 0.1,
    streetTrees: 0.3,
    hedges: 0.2,
    pots: 0.55,
    towerCover: null,
    park: 0,
    onlyZoned: true,
  },
  electric: {
    // 電光町 Denkō-chō, the electric town (Akihabara-like): tall narrow buildings covered in signs along the main
    // street, parts shops and arcades in the back streets, maid cafés, anime and card shops; generated where its
    // zone file paints (all of it).
    name: 'Denkō-chō',
    edgeRoads: [10, 12, 14],
    localStreet: [4, 7],
    block: [20, 44],
    twoRowDepth: 24,
    lotW: [5, 11],
    lotGap: 0.08,
    floors: [
      [4, 7, 45],
      [8, 12, 40],
      [13, 18, 15],
    ],
    signChance: 0.95,
    verticalSign: 0.7,
    signWords: ['電気', 'PC', 'パーツ', '無線', 'ゲーム', 'アニメ', 'フィギュア', 'カード', '中古', '買取', 'DUTY FREE', '免税', 'メイドカフェ', 'ホビー', 'レトロゲーム', 'オーディオ', 'カメラ', 'スマホ', '電子部品', 'ジャンク'],
    signColors: [0xff5fc8, 0x4fe3ff, 0xffe45f, 0x6bff8a, 0xff4f4f, 0xffffff, 0xff9a2a],
    open: { parking: 0.04 },
    rear: [0.3, 1.5],
    setback: [0, 0.6],
    stepBack: 0.15,
    streetTrees: 0.2,
    hedges: 0.1,
    pots: 0.05,
    towerCover: null,
    park: 0,
  },
  harbor: {
    // Tōto Port: warehouses on big blocks along wide truck roads, container yards, a few office and hotel
    // towers by the water; only where its zone file paints (the islands come with their set pieces).
    name: 'Tōto Port',
    edgeRoads: [16, 18],
    localStreet: [8, 12],
    block: [40, 90],
    twoRowDepth: 50,
    lotW: [22, 44],
    lotGap: 0.6,
    floors: [
      [3, 4, 55],
      [5, 7, 30],
      [10, 16, 15],
    ],
    signChance: 0.25,
    verticalSign: 0.1,
    signWords: ['倉庫', '東都港運', '冷蔵倉庫', '物流センター', '水産', '港湾', '海運', 'SHIPPING', 'LOGISTICS', '食堂', '運送', '船具'],
    signColors: [0xffffff, 0x4fe3ff, 0xffe45f, 0xff4f4f],
    open: { parking: 0.12, vacant: 0.05 },
    rear: [2, 6],
    setback: [2, 6],
    stepBack: 0,
    streetTrees: 0.15,
    hedges: 0.05,
    pots: 0.02,
    towerCover: null,
    park: 0,
    onlyZoned: true,
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
  /** Cell edges built to their own width (avenues, a scramble crossing's approaches): edgeKey to spec. */
  edges?: ReadonlyMap<string, EdgeSpec>,
): CellPlan3 | null {
  const kind = macro.kindAt(mx, my);
  if (!isLand(kind)) return null;
  if (!STYLES3[kind]) return null;
  const style = zone?.style ?? STYLES3[kind]!;
  const R: Rect = { x: mx * CELL, y: my * CELL, w: CELL, h: CELL };
  const roads: Road3[] = [];

  const edge = (neighbour: CellKind, keyX: number, keyY: number, vertical: boolean): { w: number; median: number } => {
    const spec = edges?.get(edgeKey(keyX, keyY, vertical));
    if (spec) return { w: spec.width, median: spec.median };
    if (neighbour !== kind) return { w: BOUNDARY_ROAD, median: 0 };
    const opts = style.edgeRoads;
    return { w: opts[hash(seed, keyX, keyY, vertical ? 1 : 2) % opts.length], median: 0 };
  };
  const road = (rect: Rect, width: number, vertical: boolean, coast = false, median = 0): Road3 => ({
    rect,
    vertical,
    kind: coast ? 'coast' : width >= 14 ? 'boulevard' : width >= 8 ? 'street' : width >= 3 ? 'street' : 'alley',
    sidewalk: coast ? 0 : width >= 8 ? Math.min(3, width * 0.2) : 0,
    median,
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
    const { w, median } = edge(n, keyX, keyY, vertical);
    const r = side === 'w' ? { x: R.x - w / 2, y: R.y, w, h: CELL } : side === 'e' ? { x: R.x + CELL - w / 2, y: R.y, w, h: CELL }
      : side === 'n' ? { x: R.x, y: R.y - w / 2, w: CELL, h: w } : { x: R.x, y: R.y + CELL - w / 2, w: CELL, h: w };
    roads.push(road(r, w, vertical, false, median));
    insets[side] = w / 2;
  }

  const interior: Rect = { x: R.x + insets.w, y: R.y + insets.n, w: CELL - insets.w - insets.e, h: CELL - insets.n - insets.s };
  const rnd = rng(hash(seed, mx, my, 0x3d));
  const open: OpenLot3[] = [];
  const rest = style.park > 0 ? carvePark(interior, style, rnd, reserved, roads, open, road) : interior;
  const blocks: Rect[] = [];
  if (rest) subdivide(rest, style, rnd, roads, blocks, reserved, road);

  const buildings: Building3[] = [];
  const signs: Sign3[] = [];
  // 256 ids per cell (dense zones have many small lots); stamps use 900000 and up.
  const idBase = 1 + (my * macro.cols + mx) * 256;
  const fill: Fill = { style, rnd, reserved, buildings, signs, open, idBase, zone };
  for (const b of blocks) {
    if (style.towerCover && Math.min(b.w, b.h) >= 30 && !reserved.some((q) => overlaps(q, b))) towerBlock(b, fill);
    else if (style.yardCover && Math.min(b.w, b.h) >= 30 && !reserved.some((q) => overlaps(q, b)) && rnd.chance(style.yardCover)) {
      open.push({ kind: 'yard', rect: b, front: b.w >= b.h ? 'south' : 'east', seed: openSeed(b, 6) });
    } else fillBlock(b, fill);
  }
  return { mx, my, kind, rect: R, style, roads, medians: medianRects(roads), buildings, open, signs };
}

/**
 * The medians of a cell's avenues: a strip down each one's centre, cut where another street crosses it (plus
 * room for the stop lines), so traffic turns and crosses at the junctions.
 */
function medianRects(roads: readonly Road3[]): Rect[] {
  const out: Rect[] = [];
  for (const r of roads) {
    if (!r.median) continue;
    const q = r.rect;
    const strip: Rect = r.vertical ? { x: q.x + q.w / 2 - r.median / 2, y: q.y, w: r.median, h: q.h } : { x: q.x, y: q.y + q.h / 2 - r.median / 2, w: q.w, h: r.median };
    // Along the road: the spans between the crossings.
    let spans: [number, number][] = [r.vertical ? [q.y, q.y + q.h] : [q.x, q.x + q.w]];
    for (const o of roads) {
      if (o === r || o.vertical === r.vertical || o.kind === 'coast' || !overlaps(o.rect, q)) continue;
      const [a, b] = r.vertical ? [o.rect.y - 4, o.rect.y + o.rect.h + 4] : [o.rect.x - 4, o.rect.x + o.rect.w + 4];
      spans = spans.flatMap(([s, e]) => [[s, Math.min(e, a)], [Math.max(s, b), e]] as [number, number][]).filter(([s, e]) => e - s > 1);
    }
    for (const [s, e] of spans) out.push(r.vertical ? { x: strip.x, y: s, w: strip.w, h: e - s } : { x: s, y: strip.y, w: e - s, h: strip.h });
  }
  return out;
}

/** What filling a block writes to, and with. */
interface Fill {
  readonly style: DistrictStyle3;
  readonly rnd: Rng;
  readonly reserved: readonly Rect[];
  readonly buildings: Building3[];
  readonly signs: Sign3[];
  readonly open: OpenLot3[];
  readonly idBase: number;
  readonly zone?: Zone3;
}

const between = (rnd: Rng, r: Range): number => r[0] + rnd.float() * (r[1] - r[0]);
const openSeed = (r: Rect, k: number): number => hash(Math.round(r.x * 4), Math.round(r.y * 4), k, 0x0be7);

/**
 * A park: the whole cell, or a strip along one side with a local street between it and the rest (the
 * first side, from a hashed start, that doesn't touch a stamp). Returns what's left to subdivide.
 */
function carvePark(
  interior: Rect,
  style: DistrictStyle3,
  rnd: Rng,
  reserved: readonly Rect[],
  roads: Road3[],
  open: OpenLot3[],
  road: (rect: Rect, width: number, vertical: boolean) => Road3,
): Rect | null {
  const I = interior;
  if (style.park >= 0.95) {
    if (reserved.some((q) => overlaps(q, I))) return I;
    open.push({ kind: 'park', rect: I, front: 'south', seed: openSeed(I, 5) });
    return null;
  }
  const s = between(rnd, style.localStreet);
  const start = rnd.int(0, 3);
  const sides: Side[] = ['west', 'north', 'east', 'south'];
  for (let k = 0; k < 4; k++) {
    const side = sides[(start + k) % 4];
    const vertical = side === 'west' || side === 'east';
    const depth = Math.round((vertical ? I.w : I.h) * style.park);
    let park: Rect;
    let street: Rect;
    let rest: Rect;
    if (side === 'west') {
      park = { x: I.x, y: I.y, w: depth, h: I.h };
      street = { x: I.x + depth, y: I.y, w: s, h: I.h };
      rest = { x: I.x + depth + s, y: I.y, w: I.w - depth - s, h: I.h };
    } else if (side === 'east') {
      park = { x: I.x + I.w - depth, y: I.y, w: depth, h: I.h };
      street = { x: I.x + I.w - depth - s, y: I.y, w: s, h: I.h };
      rest = { x: I.x, y: I.y, w: I.w - depth - s, h: I.h };
    } else if (side === 'north') {
      park = { x: I.x, y: I.y, w: I.w, h: depth };
      street = { x: I.x, y: I.y + depth, w: I.w, h: s };
      rest = { x: I.x, y: I.y + depth + s, w: I.w, h: I.h - depth - s };
    } else {
      park = { x: I.x, y: I.y + I.h - depth, w: I.w, h: depth };
      street = { x: I.x, y: I.y + I.h - depth - s, w: I.w, h: s };
      rest = { x: I.x, y: I.y, w: I.w, h: I.h - depth - s };
    }
    if (reserved.some((q) => overlaps(q, park) || overlaps(q, street))) continue;
    roads.push(road(street, s, vertical));
    // Its entrance faces the new street.
    const front: Side = side === 'west' ? 'east' : side === 'east' ? 'west' : side === 'north' ? 'south' : 'north';
    open.push({ kind: 'park', rect: park, front, seed: openSeed(park, 5) });
    return rest;
  }
  return I;
}

/**
 * Towers standing in a public plaza (the open space West Shinjuku-style towers trade for their height):
 * the block is paved as one plaza with one tower, or two along a long block, each covering towerCover of
 * its site, pushed to the back so the forecourt opens onto its street.
 */
function towerBlock(block: Rect, f: Fill): void {
  const { style, rnd } = f;
  const alongX = block.w >= block.h;
  const long = alongX ? block.w : block.h;
  const n = long >= 90 ? 2 : 1;
  f.open.push({ kind: 'plaza', rect: block, front: alongX ? 'south' : 'east', seed: openSeed(block, 4) });
  for (let i = 0; i < n; i++) {
    const site: Rect = alongX
      ? { x: block.x + (block.w / n) * i, y: block.y, w: block.w / n, h: block.h }
      : { x: block.x, y: block.y + (block.h / n) * i, w: block.w, h: block.h / n };
    const area = site.w * site.h * between(rnd, style.towerCover!);
    const aspect = 0.75 + rnd.float() * 0.5;
    const w = Math.min(Math.sqrt(area * aspect), site.w - 10);
    const d = Math.min(area / Math.sqrt(area * aspect), site.h - 10);
    const front = rnd.pick(['north', 'south', 'east', 'west'] as const);
    if (w < 14 || d < 14 || f.buildings.length >= 255) continue;
    // Back margin 5-8 m; the rest of the depth is the forecourt; centred across, with a little jitter.
    const back = 5 + rnd.float() * 3;
    const jx = (rnd.float() - 0.5) * Math.max(0, site.w - w - 10);
    const jz = (rnd.float() - 0.5) * Math.max(0, site.h - d - 10);
    const cx = front === 'east' ? site.x + back + w / 2 : front === 'west' ? site.x + site.w - back - w / 2 : site.x + site.w / 2 + jx;
    const cz = front === 'south' ? site.y + back + d / 2 : front === 'north' ? site.y + site.h - back - d / 2 : site.y + site.h / 2 + jz;
    const b: Building3 = { id: f.idBase + f.buildings.length, x: cx, z: cz, w, d, h: pickFloors(style, rnd) * FLOOR_H, front, ...(f.zone ? { zone: f.zone } : {}) };
    f.buildings.push(b);
    if (rnd.chance(style.signChance)) f.signs.push(makeSign(b, style, rnd));
  }
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
function fillBlock(block: Rect, f: Fill): void {
  const { style, rnd, reserved, buildings, signs, idBase, zone } = f;
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
    // Open lots are gaps in the street wall: never two side by side.
    let lastOpen = false;
    while (end - x > 0.5) {
      const rolled = pickOpen(style, rnd);
      const openKind = lastOpen ? null : rolled;
      lastOpen = false;
      let w = between(rnd, openKind ? OPEN_LOT[openKind].w : style.lotW);
      if (end - x - w < style.lotW[0]) w = end - x;
      const lot: Rect = { x, y: r.y, w, h: r.h };
      const lotFront: Side = x === r.x && end - x - w > 0.5 ? 'west' : end - x - w <= 0.5 && x > r.x ? 'east' : front;
      x += w;
      if (end - x > style.lotW[0] + 2 && rnd.chance(style.lotGap)) x += 1.5; // service alley
      const height = pickFloors(style, rnd) * FLOOR_H;
      const rear = between(rnd, style.rear) * (rows.length === 2 ? 1 : 0.5);
      const setback = rnd.chance(0.5) ? between(rnd, style.setback) : 0;
      const cutSize = rnd.chance(0.45) ? 1.8 + rnd.float() * 0.8 : 0;
      if (reserved.some((q) => overlaps(q, lot))) continue;
      if (openKind) {
        const [along, depth] = lotFront === 'north' || lotFront === 'south' ? [lot.w, lot.h] : [lot.h, lot.w];
        const [minAlong, minDepth] = OPEN_LOT[openKind].min;
        if (along >= minAlong && depth >= minDepth) {
          f.open.push({ kind: openKind, rect: lot, front: lotFront, seed: openSeed(lot, LOT_OPEN.indexOf(openKind)) });
          lastOpen = true;
          continue;
        }
      }
      if (buildings.length >= 255) continue;
      // The footprint: small gaps between neighbours so each reads as its own mass, a yard at the back
      // (away from the row's street), and sometimes a setback from its own street.
      let [x0, x1, z0, z1] = [lot.x + 0.2, lot.x + lot.w - 0.2, lot.y + 0.2, lot.y + lot.h - 0.2];
      const back = Math.min(rear, Math.max(0, z1 - z0 - Math.max(4, lot.h * 0.55)));
      if (front === 'north') z1 -= back;
      else z0 += back;
      const room = lotFront === 'north' || lotFront === 'south' ? z1 - z0 - 4 : x1 - x0 - 3;
      const fs = Math.min(setback, Math.max(0, room));
      if (lotFront === 'north') z0 += fs;
      else if (lotFront === 'south') z1 -= fs;
      else if (lotFront === 'west') x0 += fs;
      else x1 -= fs;
      // A corner lot's corner at the junction is often cut (sumikiri), on low and mid-rise buildings.
      const corner: Corner | null = lotFront === 'west' ? (front === 'north' ? 'nw' : 'sw') : lotFront === 'east' ? (front === 'north' ? 'ne' : 'se') : null;
      const cut = corner && cutSize > 0 && height <= 45 && Math.min(x1 - x0, z1 - z0) >= 6 ? { cut: { corner, size: cutSize } } : {};
      const b: Building3 = { id: idBase + buildings.length, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, h: height, front: lotFront, ...cut, ...(zone ? { zone } : {}) };
      buildings.push(b);
      if (rnd.chance(style.signChance)) signs.push(makeSign(b, style, rnd));
    }
  }
}

/** Open-lot widths along the street, and the smallest [along, depth] each needs. */
const OPEN_LOT: Record<LotOpenKind, { w: Range; min: readonly [number, number] }> = {
  parking: { w: [7.5, 16], min: [5.5, 5.5] },
  playground: { w: [12, 20], min: [10, 10] },
  vacant: { w: [6, 14], min: [4, 4] },
};

/** Whether the next lot is left open, and as what (one roll against the style's shares). */
function pickOpen(style: DistrictStyle3, rnd: Rng): LotOpenKind | null {
  let roll = rnd.float();
  for (const k of LOT_OPEN) {
    roll -= style.open[k] ?? 0;
    if (roll < 0) return k;
  }
  return null;
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

/** The footprint corner at each end of a street face (u = 0 and u = face width). */
const FACE_ENDS: Record<Side, readonly [Corner, Corner]> = { south: ['sw', 'se'], north: ['ne', 'nw'], east: ['se', 'ne'], west: ['nw', 'sw'] };

/** The part [u0, u1] of the street face clear of a corner cut (the whole face without one). */
export function frontSpan(b: Pick<Building3, 'w' | 'd' | 'front' | 'cut'>): [number, number] {
  const fw = frontWidth(b);
  const c = b.cut;
  if (!c) return [0, fw];
  const [a, e] = FACE_ENDS[b.front];
  return c.corner === a ? [c.size, fw] : c.corner === e ? [0, fw - c.size] : [0, fw];
}

function makeSign(b: Building3, style: DistrictStyle3, rnd: Rng): Sign3 {
  const text = rnd.pick(style.signWords);
  const color = rnd.pick(style.signColors);
  const allWide = [...text].every((c) => isWide(c.codePointAt(0)!) || c === ' ');
  const vertical = allWide && b.h >= 9 && rnd.chance(style.verticalSign);
  const [s0, s1] = frontSpan(b);
  if (vertical) {
    const p = frontPoint(b, rnd.chance(0.5) ? s0 + 1.2 : s1 - 1.2, 0.4);
    return { text, vertical, color, x: p.x, y: Math.min(b.h - 1, 7 + rnd.float() * 6), z: p.z, nx: p.nx, nz: p.nz };
  }
  // Horizontal signs sit on the fascia over the shopfront.
  const p = frontPoint(b, (s0 + s1) / 2, 0.4);
  return { text, vertical, color, x: p.x, y: 3.6, z: p.z, nx: p.nx, nz: p.nz };
}
