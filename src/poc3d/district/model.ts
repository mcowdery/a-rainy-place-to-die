import { Terrain } from './terrain';
import { intersect, overlaps, type Rect } from '../../core/coords';
import type { DistrictId, MacroMap } from '../../gen/macro';
import { cellDetail, type CellDetail } from '../real/props';
import { CELL, cellKey, edgeKey, planCell3, STYLES3, type Building3, type CellPlan3 } from './plan';
import { plazaRect, reservedRect, type Placed3 } from './stamps';
import { ZoneMap } from './zones';
import type { Avenues, EdgeSpec } from './roads';
import { SCRAMBLE_ROAD } from './plan';
import { landmarkHoles } from './landmarks';

/**
 * The district as data: which cells belong to it, each cell's plan (roads, lots, buildings, signs) and
 * street furniture, and the stamps placed in it. Everything is computed lazily and cached, and is a pure
 * function of (seed, L0 map, placements), so the main thread (collision) and the chunk workers (geometry)
 * each keep their own copy and always agree.
 */
export class DistrictModel {
  readonly cells: readonly (readonly [number, number])[];
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private readonly cellSet = new Set<number>();
  private readonly plans = new Map<number, CellPlan3>();
  private readonly details = new Map<number, CellDetail>();
  readonly placedByCell = new Map<number, Placed3[]>();
  /** Cell edges built to their own width: the avenues, and a scramble crossing's approaches (at least 18 m). */
  private readonly edges = new Map<string, EdgeSpec>();

  constructor(
    private readonly macro: MacroMap,
    /** The districts to generate (every district with a 3D style by default). */
    kinds: DistrictId | readonly DistrictId[],
    readonly placed: readonly Placed3[],
    private readonly seed: number,
    readonly zones: ZoneMap = ZoneMap.EMPTY,
    avenues: Avenues = new Map(),
    /** The lie of the land (terrain.ts): the chunk workers lift the geometry onto it. */
    readonly terrain: Terrain = Terrain.FLAT,
    /** More ground to keep clear (under the rail lines' curves: rail.ts railReserved). */
    private readonly extraReserved: readonly Rect[] = [],
  ) {
    for (const [k, v] of avenues) this.edges.set(k, v);
    const cells: [number, number][] = [];
    const wanted = new Set<string>(typeof kinds === 'string' ? [kinds] : kinds);
    for (let my = 0; my < macro.rows; my++) {
      for (let mx = 0; mx < macro.cols; mx++) {
        const k = macro.kindAt(mx, my);
        // A district that's only generated where its zones are painted (the residential neighbourhood).
        if (wanted.has(k) && (!STYLES3[k as DistrictId]?.onlyZoned || zones.at(mx, my))) cells.push([mx, my]);
      }
    }
    this.cells = cells;
    for (const [mx, my] of cells) this.cellSet.add(cellKey(mx, my));
    const xs = cells.map(([mx]) => mx);
    const zs = cells.map(([, my]) => my);
    this.bounds = { minX: Math.min(...xs) * CELL, maxX: (Math.max(...xs) + 1) * CELL, minZ: Math.min(...zs) * CELL, maxZ: (Math.max(...zs) + 1) * CELL };
    // Scramble crossings on a cell corner widen the four roads that meet there.
    for (const p of placed) {
      const s = p.stamp.scramble;
      if (!s) continue;
      const gx = (p.rect.x + s[0]) / CELL;
      const gy = (p.rect.y + s[1]) / CELL;
      if (!Number.isInteger(gx) || !Number.isInteger(gy)) continue;
      for (const k of [edgeKey(gx - 1, gy - 1, true), edgeKey(gx - 1, gy, true), edgeKey(gx - 1, gy - 1, false), edgeKey(gx, gy - 1, false)]) {
        const a = this.edges.get(k);
        this.edges.set(k, { width: Math.max(SCRAMBLE_ROAD, a?.width ?? 0), median: a?.median ?? 0, name: a?.name ?? 'scramble' });
      }
    }
    for (const p of placed) {
      const k = cellKey(p.cell[0], p.cell[1]);
      this.placedByCell.set(k, [...(this.placedByCell.get(k) ?? []), p]);
    }
  }

  has(mx: number, my: number): boolean {
    return this.cellSet.has(cellKey(mx, my));
  }

  plan(mx: number, my: number): CellPlan3 | null {
    const k = cellKey(mx, my);
    if (!this.cellSet.has(k)) return null;
    let p = this.plans.get(k);
    if (!p) {
      const cellRect: Rect = { x: mx * CELL, y: my * CELL, w: CELL, h: CELL };
      const reserved = [...this.placed.flatMap((q) => [reservedRect(q), plazaRect(q) ?? []].flat()), ...this.extraReserved].filter((r) => overlaps(r, cellRect));
      p = planCell3(this.macro, mx, my, reserved, this.seed, this.zones.at(mx, my), this.edges)!;
      this.plans.set(k, p);
    }
    return p;
  }

  /** Street furniture and lights of a cell (null outside the district). */
  detail(mx: number, my: number): CellDetail | null {
    const k = cellKey(mx, my);
    let d = this.details.get(k);
    if (!d) {
      const p = this.plan(mx, my);
      if (!p) return null;
      d = cellDetail(p, this.stamps(mx, my).map((q) => q.building), this.plazas(mx, my));
      this.details.set(k, d);
    }
    return d;
  }

  /**
   * The parts of stamp plazas in this cell that are off the roads (paved, with lamps and trees). A road
   * crossing a plaza piece trims it to the largest side left over.
   */
  plazas(mx: number, my: number): Rect[] {
    const p = this.plan(mx, my);
    if (!p) return [];
    const out: Rect[] = [];
    for (const q of this.placed) {
      const pr = plazaRect(q);
      let piece = pr && intersect(pr, p.rect);
      for (const r of p.roads) {
        if (!piece) break;
        const c = intersect(piece, r.rect);
        if (!c) continue;
        const s: Rect = piece;
        const sides: Rect[] = [
          { x: s.x, y: s.y, w: c.x - s.x, h: s.h },
          { x: c.x + c.w, y: s.y, w: s.x + s.w - c.x - c.w, h: s.h },
          { x: s.x, y: s.y, w: s.w, h: c.y - s.y },
          { x: s.x, y: c.y + c.h, w: s.w, h: s.y + s.h - c.y - c.h },
        ].filter((t) => t.w > 0.5 && t.h > 0.5);
        piece = sides.sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
      }
      if (piece) out.push(piece);
    }
    return out;
  }

  /**
   * Scramble crossings whose junction touches this cell: the carriageway box where the two streets cross
   * (from the roads of the cells around the junction centre, sidewalks excluded).
   */
  scrambles(mx: number, my: number): Rect[] {
    const out: Rect[] = [];
    for (const p of this.placed) {
      const s = p.stamp.scramble;
      if (!s) continue;
      const x = p.rect.x + s[0];
      const z = p.rect.y + s[1];
      let hx = 0;
      let hz = 0;
      // The cells just either side of the point (four when it's on a cell corner).
      const cxs = new Set([Math.floor((x - 0.01) / CELL), Math.floor((x + 0.01) / CELL)]);
      const czs = new Set([Math.floor((z - 0.01) / CELL), Math.floor((z + 0.01) / CELL)]);
      for (const cz of czs) {
        for (const cx of cxs) {
          for (const r of this.plan(cx, cz)?.roads ?? []) {
            const q = r.rect;
            if (x < q.x || x > q.x + q.w || z < q.y || z > q.y + q.h) continue;
            if (r.vertical) hx = Math.max(hx, q.w / 2 - r.sidewalk);
            else hz = Math.max(hz, q.h / 2 - r.sidewalk);
          }
        }
      }
      const box: Rect = { x: x - hx, y: z - hz, w: 2 * hx, h: 2 * hz };
      if (hx > 0 && hz > 0 && overlaps(box, { x: mx * CELL, y: my * CELL, w: CELL, h: CELL })) out.push(box);
    }
    return out;
  }

  /** Openings in this cell's pavement (stairwells down to basements). */
  holes(mx: number, my: number): Rect[] {
    const cell: Rect = { x: mx * CELL, y: my * CELL, w: CELL, h: CELL };
    return this.placed.flatMap(landmarkHoles).filter((r) => overlaps(r, cell));
  }

  stamps(mx: number, my: number): readonly Placed3[] {
    return this.placedByCell.get(cellKey(mx, my)) ?? [];
  }

  /** The cell's buildings with a plain mass (generated ones and non-landmark stamps). */
  massed(mx: number, my: number): Building3[] {
    const p = this.plan(mx, my);
    return p ? [...p.buildings, ...this.stamps(mx, my).filter((q) => q.stamp.landmark === null).map((q) => q.building)] : [];
  }

  /** The cell's generated buildings plus any stamp buildings (landmarks included). */
  buildings(mx: number, my: number): Building3[] {
    const p = this.plan(mx, my);
    return p ? [...p.buildings, ...this.stamps(mx, my).map((q) => q.building)] : [];
  }
}

/** Every sign text the district can show (for the sign atlas / layout; identical on every thread). */
export function signTexts(words: readonly string[], placed: readonly Placed3[]): { text: string; vertical: boolean }[] {
  return [
    ...words.flatMap((text) => [{ text, vertical: false }, { text, vertical: true }]),
    ...placed.flatMap((p) => p.signs.map((s) => ({ text: s.text, vertical: s.vertical }))),
  ];
}
