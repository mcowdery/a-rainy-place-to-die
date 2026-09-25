import { CONFIG } from '../config';
import { overlaps, type Rect } from '../core/coords';
import { hash, rng, type Rng } from '../core/hash';
import { GLYPH_NONE, isWide, textToCells } from '../core/wide';
import { PAL, type TileName } from '../world/tiles';
import { isLand, type CellKind, type DistrictId, type MacroMap } from './macro';
import { COAST_WIDTH, DISTRICT_BOUNDARY_ROAD, STYLES, type DistrictStyle, type LotKind } from './styles';

/**
 * L1 + L2 for one macro cell, as vector data (rects), not tiles. Cheap to build; raster.ts turns the
 * part that overlaps a chunk into tiles. Everything here is a pure function of
 * (seed, generatorVersion, L0 map, reserved rects) so any chunk can be regenerated identically.
 *
 * Buildings never cross a macro-cell edge: every land/land edge carries a road, split between the two
 * cells, and both cells derive the same width from a hash of the shared edge.
 */

export interface Road {
  /** Full road rect; may extend into the neighbouring cell (each cell only rasterises its own part). */
  readonly rect: Rect;
  readonly vertical: boolean;
  readonly kind: 'street' | 'alley' | 'coast';
  readonly width: number;
  /** Tile for coast strips. */
  readonly tile?: TileName;
}

export interface Sign {
  /** Position in the facade: x from lot west edge, y as facade row (0 = cornice). */
  readonly x: number;
  readonly y: number;
  readonly vertical: boolean;
  /** Glyph cells. Horizontal: one row including 1-cell plate padding each side. Vertical: [head, CONT] per row. */
  readonly cells: readonly number[];
  /** Palette index. */
  readonly fg: number;
}

export interface Building {
  /** Rows from the lot's north edge: yard (behind), then roof, then facade down to the lot's south edge. */
  readonly yardRows: number;
  readonly roofRows: number;
  readonly facadeRows: number;
  readonly doorX: number;
  readonly shopfront: boolean;
  /** Palette index, or -1 for no awning. */
  readonly awningFg: number;
  readonly sign: Sign | null;
}

export interface Lot {
  readonly rect: Rect;
  readonly kind: LotKind;
  readonly seed: number;
  readonly building: Building | null;
}

export interface CellPlan {
  readonly mx: number;
  readonly my: number;
  readonly kind: DistrictId;
  readonly rect: Rect;
  readonly roads: readonly Road[];
  readonly lots: readonly Lot[];
}

const roadKind = (w: number): Road['kind'] => (w >= 3 ? 'street' : 'alley');

/** Width of the road on the edge between a (west/north) and b (east/south). Both must be land. */
function edgeWidth(macro: MacroMap, ax: number, ay: number, bx: number, by: number, vertical: boolean, seed: number): number {
  const a = macro.kindAt(ax, ay);
  if (a !== macro.kindAt(bx, by)) return DISTRICT_BOUNDARY_ROAD;
  const opts = STYLES[a as DistrictId].edgeRoads;
  return opts[hash(seed, ax, ay, vertical ? 1 : 2) % opts.length];
}

/**
 * @param reserved world rects owned by stamps (L3); lots touching them are left open so no
 *        generated building is ever cut in half by authored content.
 */
export function planCell(macro: MacroMap, mx: number, my: number, reserved: readonly Rect[], seed: number): CellPlan | null {
  const kind = macro.kindAt(mx, my);
  if (!isLand(kind)) return null;
  const style = STYLES[kind];
  const W = CONFIG.cellW;
  const H = CONFIG.cellH;
  const R: Rect = { x: mx * W, y: my * H, w: W, h: H };
  const roads: Road[] = [];

  const coastTile = (n: CellKind): TileName => (n === 'water' ? style.coast : style.fill);

  // West / east edges (vertical roads). The west/north cell of a pair owns ceil(w/2) of the road.
  let inL: number, inR: number, inT: number, inB: number;
  const west = macro.kindAt(mx - 1, my);
  if (isLand(west)) {
    const w = edgeWidth(macro, mx - 1, my, mx, my, true, seed);
    roads.push({ rect: { x: R.x - Math.ceil(w / 2), y: R.y, w, h: H }, vertical: true, kind: roadKind(w), width: w });
    inL = Math.floor(w / 2);
  } else {
    roads.push({ rect: { x: R.x, y: R.y, w: COAST_WIDTH, h: H }, vertical: true, kind: 'coast', width: COAST_WIDTH, tile: coastTile(west) });
    inL = COAST_WIDTH;
  }
  const east = macro.kindAt(mx + 1, my);
  if (isLand(east)) {
    const w = edgeWidth(macro, mx, my, mx + 1, my, true, seed);
    roads.push({ rect: { x: R.x + W - Math.ceil(w / 2), y: R.y, w, h: H }, vertical: true, kind: roadKind(w), width: w });
    inR = Math.ceil(w / 2);
  } else {
    roads.push({ rect: { x: R.x + W - COAST_WIDTH, y: R.y, w: COAST_WIDTH, h: H }, vertical: true, kind: 'coast', width: COAST_WIDTH, tile: coastTile(east) });
    inR = COAST_WIDTH;
  }
  const north = macro.kindAt(mx, my - 1);
  if (isLand(north)) {
    const w = edgeWidth(macro, mx, my - 1, mx, my, false, seed);
    roads.push({ rect: { x: R.x, y: R.y - Math.ceil(w / 2), w: W, h: w }, vertical: false, kind: roadKind(w), width: w });
    inT = Math.floor(w / 2);
  } else {
    roads.push({ rect: { x: R.x, y: R.y, w: W, h: COAST_WIDTH }, vertical: false, kind: 'coast', width: COAST_WIDTH, tile: coastTile(north) });
    inT = COAST_WIDTH;
  }
  const south = macro.kindAt(mx, my + 1);
  if (isLand(south)) {
    const w = edgeWidth(macro, mx, my, mx, my + 1, false, seed);
    roads.push({ rect: { x: R.x, y: R.y + H - Math.ceil(w / 2), w: W, h: w }, vertical: false, kind: roadKind(w), width: w });
    inB = Math.ceil(w / 2);
  } else {
    roads.push({ rect: { x: R.x, y: R.y + H - COAST_WIDTH, w: W, h: COAST_WIDTH }, vertical: false, kind: 'coast', width: COAST_WIDTH, tile: coastTile(south) });
    inB = COAST_WIDTH;
  }
  // Coast strips go first so streets paint over them where they meet.
  roads.sort((a, b) => Number(b.kind === 'coast') - Number(a.kind === 'coast'));

  const interior: Rect = { x: R.x + inL, y: R.y + inT, w: W - inL - inR, h: H - inT - inB };
  const rnd = rng(hash(seed, mx, my, CONFIG.generatorVersion));
  const blocks: Rect[] = [];
  subdivide(interior, style, rnd, roads, blocks, reserved);

  const lots: Lot[] = [];
  for (const block of blocks) fillBlock(block, style, rnd, roads, lots, reserved);
  return { mx, my, kind, rect: R, roads, lots };
}

/** BSP the cell interior into blocks separated by local streets. */
function subdivide(r: Rect, style: DistrictStyle, rnd: Rng, roads: Road[], out: Rect[], reserved: readonly Rect[]): void {
  const canV = r.w > style.blockW[1];
  const canH = r.h > style.blockH[1];
  if (!canV && !canH) {
    out.push(r);
    return;
  }
  const s = rnd.range(style.localStreet);
  // Compare in on-screen units: cells are twice as tall as wide.
  const vertical = canV && (!canH || r.w >= r.h * 2);
  if (vertical) {
    const lo = r.x + style.blockW[0];
    const hi = r.x + r.w - style.blockW[0] - s;
    if (hi < lo) return void out.push(r);
    // Streets extend one tile past the block so they cut through the crossing road's sidewalk.
    const street = pickCut(rnd, lo, hi, reserved, (cut) => ({ x: cut, y: r.y - 1, w: s, h: r.h + 2 }));
    if (!street) return void out.push(r);
    const cut = street.x;
    roads.push({ rect: street, vertical: true, kind: roadKind(s), width: s });
    subdivide({ x: r.x, y: r.y, w: cut - r.x, h: r.h }, style, rnd, roads, out, reserved);
    subdivide({ x: cut + s, y: r.y, w: r.x + r.w - cut - s, h: r.h }, style, rnd, roads, out, reserved);
  } else {
    const lo = r.y + style.blockH[0];
    const hi = r.y + r.h - style.blockH[0] - s;
    if (hi < lo) return void out.push(r);
    const street = pickCut(rnd, lo, hi, reserved, (cut) => ({ x: r.x - 1, y: cut, w: r.w + 2, h: s }));
    if (!street) return void out.push(r);
    const cut = street.y;
    roads.push({ rect: street, vertical: false, kind: roadKind(s), width: s });
    subdivide({ x: r.x, y: r.y, w: r.w, h: cut - r.y }, style, rnd, roads, out, reserved);
    subdivide({ x: r.x, y: cut + s, w: r.w, h: r.y + r.h - cut - s }, style, rnd, roads, out, reserved);
  }
}

/** A street position in [lo, hi] that doesn't run through a stamp; null if none found (block stays whole). */
function pickCut(rnd: Rng, lo: number, hi: number, reserved: readonly Rect[], rectAt: (cut: number) => Rect): Rect | null {
  for (let attempt = 0; attempt < 8; attempt++) {
    const rect = rectAt(rnd.int(lo, hi));
    if (!reserved.some((r) => overlaps(r, rect))) return rect;
  }
  return null;
}

const MIN_BAND = 6;

/** Split a block into east-west bands (rows of buildings), then each band into lots. */
function fillBlock(block: Rect, style: DistrictStyle, rnd: Rng, roads: Road[], lots: Lot[], reserved: readonly Rect[]): void {
  const bands: Rect[] = [];
  if (block.h >= 2 * MIN_BAND + 1 && rnd.chance(style.bandSplit)) {
    const h1 = rnd.int(MIN_BAND, block.h - MIN_BAND - 1);
    bands.push({ x: block.x, y: block.y, w: block.w, h: h1 });
    roads.push({ rect: { x: block.x, y: block.y + h1, w: block.w, h: 1 }, vertical: false, kind: 'alley', width: 1 });
    bands.push({ x: block.x, y: block.y + h1 + 1, w: block.w, h: block.h - h1 - 1 });
  } else {
    bands.push(block);
  }

  for (const band of bands) {
    let x = band.x;
    const end = band.x + band.w;
    while (x < end) {
      let w = rnd.range(style.lotW);
      if (end - x - w < style.lotW[0]) w = end - x;
      const rect: Rect = { x, y: band.y, w, h: band.h };
      x += w;
      lots.push(makeLot(rect, style, rnd, reserved));
      if (end - x > style.lotW[0] + 1 && rnd.chance(style.lotGap)) {
        roads.push({ rect: { x, y: band.y, w: 1, h: band.h }, vertical: true, kind: 'alley', width: 1 });
        x += 1;
      }
    }
  }
}

function makeLot(rect: Rect, style: DistrictStyle, rnd: Rng, reserved: readonly Rect[]): Lot {
  const seed = rnd.u32();
  if (reserved.some((r) => overlaps(r, rect))) return { rect, kind: 'plaza', seed, building: null };
  let kind = rnd.weighted(style.lots);
  if (kind === 'building' && (rect.w < 3 || rect.h < 3)) kind = 'open';
  return { rect, kind, seed, building: kind === 'building' ? makeBuilding(rect, style, rnd) : null };
}

function makeBuilding(rect: Rect, style: DistrictStyle, rnd: Rng): Building {
  const facadeRows = Math.max(2, Math.min(rnd.range(style.facade), rect.h - 1));
  const behind = rect.h - facadeRows;
  const roofRows = Math.max(1, Math.min(behind, style.roofDepth[1], Math.max(style.roofDepth[0], behind - rnd.int(0, style.yardMax))));
  const yardRows = behind - roofRows;
  const doorX = rnd.int(1, Math.max(1, rect.w - 2));
  const shopfront = rnd.chance(style.shopfront);
  const awningFg = facadeRows >= 4 && style.awningColors.length > 0 && rnd.chance(style.awning) ? PAL[rnd.pick(style.awningColors)] : -1;
  return { yardRows, roofRows, facadeRows, doorX, shopfront, awningFg, sign: makeSign(rect.w, facadeRows, awningFg >= 0, style, rnd) };
}

function makeSign(w: number, f: number, awning: boolean, style: DistrictStyle, rnd: Rng): Sign | null {
  if (!rnd.chance(style.signs.chance)) return null;
  const word = rnd.pick(style.signs.words);
  const fg = PAL[rnd.pick(style.signs.colors)];
  // Rows available for signage: below the cornice, above the awning / ground floor.
  const lastRow = f - (awning ? 3 : 2);
  const chars = [...word];
  if (chars.every((c) => isWide(c.codePointAt(0)!)) && rnd.chance(style.signs.vertical) && w >= 4 && lastRow >= chars.length) {
    const cells = textToCells(word);
    return { x: rnd.chance(0.5) ? 1 : w - 3, y: 1, vertical: true, cells, fg };
  }
  const cells = [GLYPH_NONE, ...textToCells(word), GLYPH_NONE];
  if (lastRow < 1 || cells.length > w - 2) return null;
  return { x: Math.floor((w - cells.length) / 2), y: rnd.int(1, lastRow), vertical: false, cells, fg };
}
