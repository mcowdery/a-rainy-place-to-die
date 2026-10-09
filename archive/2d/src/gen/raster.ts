import { CHUNK, CHUNK_SHIFT } from '../config';
import { contains, intersect, type Rect } from '../core/coords';
import { hash } from '../core/hash';
import type { PlacedStamp } from '../content/stamps';
import { Chunk } from '../world/chunk';
import { PAL, T } from '../world/tiles';
import type { Building, CellPlan, Lot, Road } from './cellplan';
import type { CellKind } from './macro';
import { STYLES, type DistrictStyle } from './styles';

/**
 * Paints one chunk, in layer order:
 *   L0 base fill -> L2 lots -> L1 roads -> L3 stamps.
 * (L4 nodes are not tiles; they live in the NodeIndex.)
 */
export function rasterize(chunk: Chunk, kind: CellKind, plan: CellPlan | null, stamps: readonly PlacedStamp[]): void {
  const cr: Rect = { x: chunk.cx << CHUNK_SHIFT, y: chunk.cy << CHUNK_SHIFT, w: CHUNK, h: CHUNK };
  if (!plan) {
    chunk.tile.fill(kind === 'water' ? T.water : T.void);
  } else {
    const style = STYLES[plan.kind];
    chunk.tile.fill(T[style.fill]);
    for (const lot of plan.lots) {
      const clip = intersect(lot.rect, cr);
      if (clip) paintLot(chunk, cr, clip, lot, style);
    }
    paintRoads(chunk, cr, plan.roads);
  }
  for (const s of stamps) paintStamp(chunk, cr, s);
}

function paintLot(chunk: Chunk, cr: Rect, clip: Rect, lot: Lot, style: DistrictStyle): void {
  const { w, h } = lot.rect;
  for (let ty = clip.y; ty < clip.y + clip.h; ty++) {
    for (let tx = clip.x; tx < clip.x + clip.w; tx++) {
      const i = ((ty - cr.y) << CHUNK_SHIFT) | (tx - cr.x);
      const lx = tx - lot.rect.x;
      const ly = ty - lot.rect.y;
      const edge = lx === 0 || ly === 0 || lx === w - 1 || ly === h - 1;
      switch (lot.kind) {
        case 'building':
          paintBuilding(chunk, i, lot.building!, style, lx, ly, w, lot.seed);
          break;
        case 'park':
          chunk.put(i, !edge && hash(lot.seed, lx, ly) % 100 < 14 ? T.tree : T.grass);
          break;
        case 'parking':
          chunk.put(i, lx % 3 === 0 && !edge && ly % 6 !== 3 ? T.parking_line : T.parking);
          break;
        case 'plaza':
          chunk.put(i, T.plaza);
          break;
        case 'containers': {
          if (edge || ly % 3 === 2 || lx % 10 === 9) {
            chunk.put(i, T.dock);
          } else {
            const colors = [PAL.container_red, PAL.container_blue, PAL.container_green, PAL.container_orange];
            chunk.put(i, T.container, 0, colors[hash(lot.seed, (lx / 10) | 0, (ly / 3) | 0) % 4] + 1);
          }
          break;
        }
        case 'open':
          chunk.put(i, T[style.fill]);
          break;
      }
    }
  }
}

/** 3/4 view: yard (behind), roof, then the facade facing south down to the lot's south edge. */
function paintBuilding(chunk: Chunk, i: number, b: Building, style: DistrictStyle, lx: number, ly: number, w: number, seed: number): void {
  if (ly < b.yardRows) return chunk.put(i, T[style.yard]);
  const ry = ly - b.yardRows;
  if (ry < b.roofRows) {
    const equip = style.roof === 'roof_tower' && (hash(seed, lx, ry) & 31) === 0;
    return chunk.put(i, equip ? T.roof_equip : T[style.roof]);
  }
  const fr = ry - b.roofRows;
  const f = b.facadeRows;
  const s = b.sign;
  if (s) {
    if (s.vertical) {
      if ((lx === s.x || lx === s.x + 1) && fr >= s.y && fr < s.y + s.cells.length / 2) {
        return chunk.put(i, T.sign, s.cells[(fr - s.y) * 2 + (lx - s.x)], s.fg + 1);
      }
    } else if (fr === s.y && lx >= s.x && lx < s.x + s.cells.length) {
      return chunk.put(i, T.sign, s.cells[lx - s.x], s.fg + 1);
    }
  }
  if (fr === 0) return chunk.put(i, T.cornice);
  const edge = lx === 0 || lx === w - 1;
  if (fr === f - 1) {
    if (lx === b.doorX) return chunk.put(i, T.door_facade);
    if (edge) return chunk.put(i, T[style.wall]);
    return chunk.put(i, b.shopfront ? T.window_shop : windowPattern(style, lx));
  }
  if (b.awningFg >= 0 && fr === f - 2) return chunk.put(i, T.awning, 0, b.awningFg + 1);
  chunk.put(i, edge ? T[style.wall] : windowPattern(style, lx));
}

function windowPattern(style: DistrictStyle, lx: number): number {
  switch (style.windows) {
    case 'curtain': return lx % 4 === 0 ? T[style.wall] : T[style.window];
    case 'grid': return lx % 2 === 1 ? T[style.window] : T[style.wall];
    case 'sparse': return lx % 3 === 1 ? T[style.window] : T[style.wall];
  }
}

/**
 * Pass 1: coast strips, street sidewalks (outer rows), alleys.
 * Pass 2: street asphalt (overwrites crossing sidewalks, so intersections join cleanly).
 * Pass 3: centre markings on wide streets, skipped inside intersections.
 */
function paintRoads(chunk: Chunk, cr: Rect, roads: readonly Road[]): void {
  const each = (r: Road, fn: (i: number, across: number, along: number, tx: number, ty: number) => void): void => {
    const clip = intersect(r.rect, cr);
    if (!clip) return;
    for (let ty = clip.y; ty < clip.y + clip.h; ty++) {
      for (let tx = clip.x; tx < clip.x + clip.w; tx++) {
        const across = r.vertical ? tx - r.rect.x : ty - r.rect.y;
        const along = r.vertical ? ty - r.rect.y : tx - r.rect.x;
        fn(((ty - cr.y) << CHUNK_SHIFT) | (tx - cr.x), across, along, tx, ty);
      }
    }
  };
  for (const r of roads) {
    if (r.kind === 'coast') each(r, (i) => chunk.put(i, T[r.tile!]));
    else if (r.kind === 'street') each(r, (i, a) => (a === 0 || a === r.width - 1) && chunk.put(i, T.sidewalk));
  }
  for (const r of roads) if (r.kind === 'alley') each(r, (i) => chunk.put(i, T.alley));
  for (const r of roads) if (r.kind === 'street') each(r, (i, a) => a > 0 && a < r.width - 1 && chunk.put(i, T.asphalt));
  for (const r of roads) {
    if (r.kind !== 'street' || r.width < 6) continue;
    const mid = r.width >> 1;
    each(r, (i, a, along, tx, ty) => {
      if (a !== mid || along % 6 >= 3) return;
      const crossing = roads.some((o) => o.kind === 'street' && o.vertical !== r.vertical && contains(o.rect, tx, ty));
      if (!crossing) chunk.put(i, r.vertical ? T.road_mark_v : T.road_mark);
    });
  }
}

function paintStamp(chunk: Chunk, cr: Rect, s: PlacedStamp): void {
  const clip = intersect(s.rect, cr);
  if (!clip) return;
  const st = s.stamp;
  for (let ty = clip.y; ty < clip.y + clip.h; ty++) {
    for (let tx = clip.x; tx < clip.x + clip.w; tx++) {
      const j = (ty - s.rect.y) * st.w + (tx - s.rect.x);
      chunk.put(((ty - cr.y) << CHUNK_SHIFT) | (tx - cr.x), st.tile[j], st.glyph[j], st.fg[j]);
    }
  }
}
