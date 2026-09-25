import { overlaps, type Rect } from '../../core/coords';
import type { DistrictId, MacroMap } from '../../gen/macro';
import { cellDetail, type CellDetail } from '../real/props';
import { CELL, cellKey, planCell3, type Building3, type CellPlan3 } from './plan';
import { reservedRect, type Placed3 } from './stamps';

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

  constructor(
    private readonly macro: MacroMap,
    readonly kind: DistrictId,
    readonly placed: readonly Placed3[],
    private readonly seed: number,
  ) {
    const cells: [number, number][] = [];
    for (let my = 0; my < macro.rows; my++) for (let mx = 0; mx < macro.cols; mx++) if (macro.kindAt(mx, my) === kind) cells.push([mx, my]);
    this.cells = cells;
    for (const [mx, my] of cells) this.cellSet.add(cellKey(mx, my));
    const xs = cells.map(([mx]) => mx);
    const zs = cells.map(([, my]) => my);
    this.bounds = { minX: Math.min(...xs) * CELL, maxX: (Math.max(...xs) + 1) * CELL, minZ: Math.min(...zs) * CELL, maxZ: (Math.max(...zs) + 1) * CELL };
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
      const reserved = this.placed.map(reservedRect).filter((r) => overlaps(r, cellRect));
      p = planCell3(this.macro, mx, my, reserved, this.seed)!;
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
      d = cellDetail(p, this.stamps(mx, my).map((q) => q.building));
      this.details.set(k, d);
    }
    return d;
  }

  stamps(mx: number, my: number): readonly Placed3[] {
    return this.placedByCell.get(cellKey(mx, my)) ?? [];
  }

  /** The cell's generated buildings plus any stamp buildings. */
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
