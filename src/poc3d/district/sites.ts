import type { Rect } from '../../core/coords';
import { CELL, type Building3, type CellPlan3, type OpenKind, type Road3 } from './plan';

/**
 * What stands along a street, for choosing where things go on its pavements (bus stops: stops.ts; payphones to
 * come; docs/street-furniture-plan.md). The traffic code knows the roads and the street furniture knows a cell's
 * own lots; a stop or a phone needs both: how wide the pavement is at a spot, and what is behind it (a building's
 * front, a lane's mouth, a car park's entrance, a gap between two lots). Pure, like the plan it reads.
 */
export type PlanAt = (mx: number, my: number) => CellPlan3 | null;

export interface SiteEnv {
  readonly plan: PlanAt;
  /** A cell's buildings, its set pieces' included (DistrictModel.buildings). */
  readonly buildings: (mx: number, my: number) => readonly Building3[];
  /** The set pieces' footprints (their ground: nothing of the street's stands in one). */
  readonly placed: readonly { readonly id: string; readonly rect: Rect }[];
}

/**
 * What is behind the pavement at a spot: a building (its street face, or a side or back wall), a set piece's
 * building (`door`: the face its entrance is in; `stamp`: another face), open ground (by kind), another street's
 * mouth, or nothing planned (a yard behind a row, a gap between two lots, ground kept clear for a viaduct).
 */
export type Behind = 'front' | 'flank' | 'door' | 'stamp' | `open:${OpenKind}` | 'road' | 'gap';

export interface KerbSample {
  readonly behind: Behind;
  /** Clear depth from the kerb's edge back to whatever stands there (m; at most DEEP). */
  readonly depth: number;
}

/** A building this far behind the pavement or further isn't "behind it": the ground between is a yard or a gap. */
const REACH = 9;
/** Clear depths are measured up to this (a forecourt deeper than a shelter needs is as good as any). */
const DEEP = 6;

/**
 * Neighbouring buildings stand 0.4 m apart (each a little inside its lot): not a gap anyone walks through. A wall
 * counts this far past its ends, so only a real gap (a 1.5 m service alley and up) reads as one. Sample a kerb
 * every 0.5 m to be sure of meeting it.
 */
const SEAM = 0.5;

/** A set piece's building has an id from here up (stamps.ts: 900000 + its placement's index; a generated one's is by cell). */
const STAMP_IDS = 900000;

const NORMAL = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] } as const;

/** The cell-edge road along a grid line (x = line for a north-south one), as a cell beside it planned it. */
export function edgeRoad(plan: CellPlan3 | null, vertical: boolean, line: number): Road3 | null {
  for (const r of plan?.roads ?? []) {
    if (r.vertical !== vertical || r.kind === 'coast') continue;
    const q = r.rect;
    if (vertical ? q.x < line && q.x + q.w > line : q.y < line && q.y + q.h > line) return r;
  }
  return null;
}

/**
 * What is behind the pavement at a point on the kerb's edge (x, z), looking `out` (a unit axis vector, away from
 * the road) across a pavement `pavement` m wide.
 */
export function kerbSample(env: SiteEnv, x: number, z: number, out: readonly [number, number], pavement: number): KerbSample {
  // Just behind the pavement: the point that says whose ground it is.
  const bx = x + out[0] * (pavement + 0.6);
  const bz = z + out[1] * (pavement + 0.6);
  const mx = Math.floor(bx / CELL);
  const my = Math.floor(bz / CELL);
  const plan = env.plan(mx, my);
  // Another street opening onto this pavement (a lane inside the block ends flush with the road's edge).
  for (const r of plan?.roads ?? []) {
    if (r.kind === 'coast') continue;
    const q = r.rect;
    const across = out[0] !== 0 ? !r.vertical : r.vertical;
    if (across && bx > q.x && bx < q.x + q.w && bz > q.y && bz < q.y + q.h) return { behind: 'road', depth: DEEP };
  }
  // The nearest building straight back from the kerb (the ray is along an axis, so this is a pass over the cell's).
  let near = Infinity;
  let hit: Building3 | null = null;
  for (const b of env.buildings(mx, my)) {
    const x0 = b.x - b.w / 2;
    const z0 = b.z - b.d / 2;
    let d: number;
    if (out[0] !== 0) {
      if (z <= z0 - SEAM || z >= z0 + b.d + SEAM) continue;
      d = out[0] > 0 ? x0 - x : x - (x0 + b.w);
    } else {
      if (x <= x0 - SEAM || x >= x0 + b.w + SEAM) continue;
      d = out[1] > 0 ? z0 - z : z - (z0 + b.d);
    }
    if (d > -0.5 && d < near) [near, hit] = [d, b];
  }
  for (const o of plan?.open ?? []) {
    const q = o.rect;
    if (bx > q.x && bx < q.x + q.w && bz > q.y && bz < q.y + q.h) {
      // Open ground at the pavement's back: fenced kinds end the clear depth there; a plaza or a park carries it on.
      const walkOn = o.kind === 'plaza' || o.kind === 'park';
      return { behind: `open:${o.kind}`, depth: walkOn ? DEEP : pavement };
    }
  }
  if (hit && near - pavement < REACH) {
    const n = NORMAL[hit.front];
    const facing = n[0] === -out[0] && n[1] === -out[1];
    return { behind: hit.id >= STAMP_IDS ? (facing ? 'door' : 'stamp') : facing ? 'front' : 'flank', depth: Math.min(DEEP, Math.max(0, near)) };
  }
  return { behind: 'gap', depth: DEEP };
}

/** Whether a point is on a set piece's ground. */
export function onPlaced(env: SiteEnv, x: number, z: number, m = 0): boolean {
  return env.placed.some((q) => x > q.rect.x - m && x < q.rect.x + q.rect.w + m && z > q.rect.y - m && z < q.rect.y + q.rect.h + m);
}
