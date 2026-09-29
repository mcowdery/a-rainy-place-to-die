import YAML from 'yaml';
import type { MacroMap } from '../../gen/macro';
import { CELL } from './plan';

/**
 * The lie of the land (content/world3d/terrain.yaml): terraces of L0 cells raised to a level (the university on
 * its hill, the temple on its rise, the heights), and the ground's height everywhere else following from them.
 *
 * Each grid corner (a junction) stands at the highest level of the four cells round it, and a cell's ground is the
 * bilinear blend of its four corners. So a terrace's own cells are flat plateaus (all their corners at its level)
 * and the cells round it are hillsides, their streets climbing continuously: nothing steps, so no one is stranded,
 * on foot or at the wheel. Buildings stand level on a slope, at the lowest point of their footprint (their uphill
 * side set into the hill: `footing`). Pure, shared by the chunk workers (which lift the geometry: `liftRaw`) and
 * the main thread (the walker's floor, the car's ground, the traffic, the landmarks).
 */
export interface Terrace3 {
  readonly name: string;
  /** L0 cells [c0, r0, c1, r1), and their level (metres). */
  readonly cells: readonly [number, number, number, number];
  readonly level: number;
}

export class Terrain {
  private readonly levels = new Map<number, number>();
  readonly flat: boolean;

  constructor(readonly terraces: readonly Terrace3[] = []) {
    for (const t of terraces) {
      const [c0, r0, c1, r1] = t.cells;
      for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) this.levels.set(key(c, r), Math.max(this.levels.get(key(c, r)) ?? 0, t.level));
    }
    this.flat = this.levels.size === 0;
  }

  static readonly FLAT = new Terrain();

  /** A cell's level (0 unless a terrace raises it). */
  level(mx: number, my: number): number {
    return this.levels.get(key(mx, my)) ?? 0;
  }

  /** A grid corner's height: the highest of the four cells round it. */
  junction(gx: number, gy: number): number {
    if (this.flat) return 0;
    return Math.max(this.level(gx - 1, gy - 1), this.level(gx, gy - 1), this.level(gx - 1, gy), this.level(gx, gy));
  }

  /** The ground's height at (x, z). */
  height(x: number, z: number): number {
    if (this.flat) return 0;
    const fx = x / CELL;
    const fz = z / CELL;
    const gx = Math.floor(fx);
    const gz = Math.floor(fz);
    const u = fx - gx;
    const v = fz - gz;
    const a = this.junction(gx, gz);
    const b = this.junction(gx + 1, gz);
    const c = this.junction(gx, gz + 1);
    const d = this.junction(gx + 1, gz + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }

  /** Where a building of footprint (x, z, w, d) stands: the lowest ground under it. */
  footing(x: number, z: number, w: number, d: number): number {
    if (this.flat) return 0;
    let lo = Infinity;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]] as const) lo = Math.min(lo, this.height(x + (dx * w) / 2, z + (dz * d) / 2));
    return lo;
  }

  /** Does any ground in the cell stand off zero (so its geometry needs lifting)? */
  raised(mx: number, my: number): boolean {
    return !this.flat && [this.junction(mx, my), this.junction(mx + 1, my), this.junction(mx, my + 1), this.junction(mx + 1, my + 1)].some((h) => h !== 0);
  }
}

const key = (c: number, r: number): number => r * 4096 + c;

export function parseTerrain(file: string, text: string, macro: MacroMap, errors: string[]): Terrain {
  const err = (m: string): void => void errors.push(`${file}: ${m}`);
  let d: Record<string, unknown>;
  try {
    d = (YAML.parse(text) ?? {}) as Record<string, unknown>;
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return Terrain.FLAT;
  }
  if (!Array.isArray(d.terraces)) return Terrain.FLAT;
  const out: Terrace3[] = [];
  d.terraces.forEach((t: Record<string, unknown>, i: number) => {
    const c = t?.cells as unknown;
    const ok = typeof t?.name === 'string' && Array.isArray(c) && c.length === 4 && c.every((n) => Number.isInteger(n)) && (c as number[])[0] < (c as number[])[2] && (c as number[])[1] < (c as number[])[3];
    if (!ok) return err(`terraces[${i}]: { name, cells: [c0, r0, c1, r1], level }`);
    if (typeof t.level !== 'number' || t.level <= 0 || t.level > 60) return err(`terraces[${i}].level: 0-60 m`);
    const [c0, r0, c1, r1] = c as number[];
    if (c0 < 0 || r0 < 0 || c1 > macro.cols || r1 > macro.rows) return err(`terraces[${i}]: off the map`);
    out.push({ name: t.name as string, cells: [c0, r0, c1, r1], level: t.level });
  });
  return new Terrain(out);
}

/**
 * Lifts a chunk's geometry onto the ground (in place): positions are relative to (ox, oz), the cell's centre. A
 * vertex belonging to a building (its aBuilding id in `footings`) rises with the whole building to its footing;
 * everything else (the ground, the streets, props, people) to the ground under it.
 */
export function liftRaw(
  raw: { readonly attrs: Record<string, { readonly array: Float32Array; readonly size: number }>; sphere: readonly [number, number, number, number] } | null,
  terrain: Terrain,
  ox: number,
  oz: number,
  footings: ReadonlyMap<number, number> = new Map(),
): void {
  if (!raw || terrain.flat) return;
  const p = raw.attrs.position.array;
  const ids = raw.attrs.aBuilding?.array;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < p.length / 3; i++) {
    const f = ids && ids[i] ? footings.get(ids[i]) : undefined;
    const h = f ?? terrain.height(p[i * 3] + ox, p[i * 3 + 2] + oz);
    p[i * 3 + 1] += h;
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  // The bounding sphere moves up with it (and grows by the spread of the lift).
  const [cx, cy, cz, r] = raw.sphere;
  (raw as { sphere: readonly [number, number, number, number] }).sphere = [cx, cy + (lo + hi) / 2, cz, r + (hi - lo) / 2];
}
