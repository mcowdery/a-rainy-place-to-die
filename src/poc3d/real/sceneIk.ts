import { placeFigure, type JointName } from './windowAtlas';
import { holdAt, holdOf, LIMB_REST, type Fig, type Pose } from './windowScenes';

/**
 * Taking hold of a figure in the scene editor (showroom/scenes.ts): dragging a hand, a foot, an elbow, a knee, the
 * head or the chest to a point in the room, solved in the scene's own pose angles (windowScenes.ts Pose), so what's
 * saved is exactly what the painter reads: there is no second skeleton. The point is the joint as the street sees it
 * (the view's plane), with the figure placed as the painter places it (its hips across the room, its seat or its
 * lowest point on the floor), so a foot dragged down pushes the body up as it would in the room.
 *
 * Solved by damped least squares on a few angles from where they are now (a finite-difference Jacobian of the
 * painter's own posing: `placeFigure`), kept inside a joint's range; where that stalls (an arm hanging straight
 * down can't start sideways) a few other starts are tried and the nearest result wins. Out of reach, the limb
 * straightens toward the point.
 */

export const HANDLES = ['handL', 'handR', 'elbowL', 'elbowR', 'footL', 'footR', 'kneeL', 'kneeR', 'head', 'chest'] as const;
export type Handle = (typeof HANDLES)[number];

type Vec = readonly number[];
interface Part {
  /** The joint that follows the pointer. */
  readonly joint: JointName;
  /** The angles that move it, with their ranges. */
  readonly range: readonly (readonly [number, number])[];
  readonly get: (p: Pose) => number[];
  readonly set: (p: Pose, v: Vec) => Pose;
  /** Other starts to try when the solve from here stalls. */
  readonly seeds: readonly Vec[];
}

const ARM_RANGE = [[-120, 220], [-100, 190], [0, 155]] as const;
const LEG_RANGE = [[-70, 150], [-50, 100], [0, 155]] as const;
const ARM_SEEDS: readonly Vec[] = [[60, 0, 30], [60, 90, 30], [60, -45, 40], [130, 40, 50], [-30, 0, 20], [100, 90, 5]];
const LEG_SEEDS: readonly Vec[] = [[40, 0, 40], [40, 45, 40], [-20, 0, 40], [90, 0, 90]];
/**
 * A limb's handle: its joint follows the pointer by the limb's first n angles (an arm's raise, swing and elbow; a
 * leg's raise, swing and knee). The rest of its list (the twists, a forearm's side bend) stay as they were set.
 */
const limb = (key: 'aL' | 'aR' | 'lL' | 'lR', joint: JointName, n: number): Part => {
  const isArm = key[0] === 'a';
  const rest = isArm ? LIMB_REST.a : LIMB_REST.l;
  return {
    joint,
    range: (isArm ? ARM_RANGE : LEG_RANGE).slice(0, n),
    get: (p) => rest.slice(0, n).map((r, i) => p[key]?.[i] ?? r),
    set: (p, v) => {
      const all = [...(p[key] ?? [])] as number[];
      for (let i = 0; i < n; i++) all[i] = v[i];
      return { ...p, [key]: all };
    },
    seeds: (isArm ? ARM_SEEDS : LEG_SEEDS).map((s) => s.slice(0, n)),
  };
};
const pair = (a: 'nod' | 'lean', b: 'tilt' | 'bend', joint: JointName, range: Part['range']): Part => ({
  joint,
  range,
  get: (p) => [p[a] ?? 0, p[b] ?? 0],
  // (An angle left at nothing isn't written where the pose didn't have it.)
  set: (p, v) => {
    const next: Record<string, unknown> = { ...p };
    [a, b].forEach((k, i) => {
      if (v[i] !== 0 || k in p) next[k] = v[i];
    });
    return next as Pose;
  },
  seeds: [],
});

/** How far the neck goes: nod, tilt, and turn. */
export const HEAD_RANGE = [[-70, 80], [-50, 50]] as const;
export const HEAD_TURN = 90;
/** A figure with its head turned (looking round) to `turn` degrees, within the neck's range. */
export function turnHead(f: Fig, turn: number): Fig {
  const t = Math.round(Math.min(HEAD_TURN, Math.max(-HEAD_TURN, turn))) || 0;
  const pose: Record<string, unknown> = { ...f.pose };
  if (t !== 0 || 'turn' in f.pose) pose.turn = t;
  return { ...f, pose: pose as Pose };
}

const PARTS: Record<Handle, Part> = {
  handL: limb('aL', 'handL', 3),
  handR: limb('aR', 'handR', 3),
  elbowL: limb('aL', 'elbowL', 2),
  elbowR: limb('aR', 'elbowR', 2),
  footL: limb('lL', 'footL', 3),
  footR: limb('lR', 'footR', 3),
  kneeL: limb('lL', 'kneeL', 2),
  kneeR: limb('lR', 'kneeR', 2),
  // (The head's top follows the pointer: facing the window or the room that is mostly its tilt, in profile its nod.)
  head: pair('nod', 'tilt', 'head', HEAD_RANGE),
  chest: pair('lean', 'bend', 'chest', [[-50, 100], [-50, 50]]),
};
/** The joint a handle moves. */
export const handleJoint = (h: Handle): JointName => PARTS[h].joint;

const clampTo = (v: Vec, range: Part['range']): number[] => v.map((x, i) => Math.min(range[i][1], Math.max(range[i][0], x)));

/** Solves n x n (n up to 3) by Gaussian elimination; null if singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let j = r + 1; j < n; j++) s -= M[r][j] * x[j];
    x[r] = s / M[r][r];
  }
  return x;
}

/** How far (m) a handle's joint is from a point. */
export function reachError(f: Fig, handle: Handle, target: readonly [number, number]): number {
  const [x, y] = placeFigure(f).joints[PARTS[handle].joint];
  return Math.hypot(x - target[0], y - target[1]);
}

function descend(f: Fig, P: Part, start: Vec, target: readonly [number, number]): { v: number[]; err: number } {
  const at = (v: Vec): [number, number] => placeFigure({ ...f, pose: P.set(f.pose, v) }).joints[P.joint];
  const n = P.range.length;
  let v = clampTo(start, P.range);
  let p = at(v);
  let err = Math.hypot(p[0] - target[0], p[1] - target[1]);
  let lambda = 1e-4;
  for (let it = 0; it < 40 && err > 2e-4; it++) {
    // The joint's move per degree of each angle.
    const J: number[][] = [[], []];
    for (let k = 0; k < n; k++) {
      const h = v[k] + 0.5 > P.range[k][1] ? -0.5 : 0.5;
      const w = [...v];
      w[k] += h;
      const q = at(w);
      J[0][k] = (q[0] - p[0]) / h;
      J[1][k] = (q[1] - p[1]) / h;
    }
    // (An angle that barely shows from here, a head's tilt seen in profile, is left as it is.)
    const shows = Array.from({ length: n }, (_, k) => Math.hypot(J[0][k], J[1][k]));
    const most = Math.max(...shows);
    for (let k = 0; k < n; k++) if (shows[k] < 0.06 * most) J[0][k] = J[1][k] = 0;
    const r = [p[0] - target[0], p[1] - target[1]];
    let stepped = false;
    for (let tries = 0; tries < 8 && !stepped; tries++) {
      const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => J[0][i] * J[0][j] + J[1][i] * J[1][j] + (i === j ? lambda : 0)));
      const g = Array.from({ length: n }, (_, i) => -(J[0][i] * r[0] + J[1][i] * r[1]));
      const d = solve(A, g);
      if (d) {
        // (No more than 25 degrees a step: the posing is far from linear.)
        const big = Math.max(1, ...d.map((x) => Math.abs(x) / 25));
        const w = clampTo(v.map((x, i) => x + d[i] / big), P.range);
        const q = at(w);
        const e = Math.hypot(q[0] - target[0], q[1] - target[1]);
        if (e < err - 1e-7) {
          v = w;
          p = q;
          err = e;
          lambda = Math.max(lambda * 0.3, 1e-7);
          stepped = true;
          break;
        }
      }
      lambda *= 8;
    }
    if (!stepped) break;
  }
  return { v, err };
}

const round1 = (x: number): number => Math.round(x * 10) / 10 || 0;

/**
 * The figure with `handle`'s joint brought to `target` (the room's metres), by the angles that move it, written
 * back into its pose to a tenth of a degree. Reachable points are met within a few millimetres; out of reach, it
 * comes as near as its limb allows.
 */
export function reach(f: Fig, handle: Handle, target: readonly [number, number]): Fig {
  const P = PARTS[handle];
  const now = P.get(f.pose);
  let best = descend(f, P, now, target);
  // Stalled short of it: other starts, and the one that gets nearest (of those as near, the least changed).
  if (best.err > 0.004) {
    const turned = (v: Vec): number => v.reduce((s, x, i) => s + Math.abs(x - now[i]), 0);
    for (const seed of P.seeds) {
      const got = descend(f, P, seed, target);
      if (got.err < best.err - 0.004 || (Math.abs(got.err - best.err) <= 0.004 && got.err < best.err && turned(got.v) < turned(best.v))) best = got;
    }
  }
  return { ...f, pose: P.set(f.pose, best.v.map(round1)) };
}

/** A figure turned to face the other way across the room: its place, its facing, its sides and what its hands hold. */
export function mirrorFig(f: Fig): Fig {
  const p = f.pose;
  const neg = (v: number | undefined): number | undefined => (v === undefined ? undefined : -v || 0);
  // (A limb's numbers are all outward or inward of its own side, so the sides just change places.)
  const pose: Record<string, unknown> = { ...p, yaw: neg(p.yaw), roll: neg(p.roll), bend: neg(p.bend), twist: neg(p.twist), tilt: neg(p.tilt), turn: neg(p.turn), aL: p.aR, aR: p.aL, lL: p.lR, lR: p.lL, fL: p.fR, fR: p.fL, hL: p.hR, hR: p.hL };
  for (const k of Object.keys(pose)) if (pose[k] === undefined) delete pose[k];
  // (What's held goes to the other hand: its angle and where it's been put mirrored with it.)
  const hold = f.hold?.map((h) => {
    const a = holdAt(h);
    return holdOf({ ...a, hand: a.hand === 'L' ? 'R' : 'L', rot: a.rot === undefined ? undefined : 180 - a.rot, dx: -a.dx || 0 });
  });
  return { ...f, x: -f.x || 0, pose: pose as Pose, ...(hold ? { hold } : {}) };
}

/** A figure with its left and right limbs' poses swapped (it stays where it is and faces as it did). */
export function swapSides(f: Fig): Fig {
  const p = f.pose;
  const pose: Record<string, unknown> = { ...p, aL: p.aR, aR: p.aL, lL: p.lR, lR: p.lL, fL: p.fR, fR: p.fL, hL: p.hR, hR: p.hL };
  for (const k of Object.keys(pose)) if (pose[k] === undefined) delete pose[k];
  return { ...f, pose: pose as Pose };
}
