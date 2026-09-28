import YAML from 'yaml';
import type { Ground } from './vehicle';

/**
 * A racing venue's course (content/race/courses/*.yaml): a practice lot, a road through control points (a
 * smooth centripetal Catmull-Rom curve) climbing a hillside, and a round viewpoint at its end.
 *
 * The hillside rises one way (to the north, `slope` m per m) with some roughness; the road's heights follow
 * it, smoothed along the road so the grade is even. Around the road the ground is cut and filled to meet it
 * (flat across the carriageway, the shoulder, then easing back into the hill). The course answers the car
 * (Ground): height, normal, grip (tarmac; gravel on the shoulder; grass beyond) and walls (the guardrails
 * along both sides of the road, the lot's edges and the viewpoint's rim), and gives the scene its geometry.
 */

export interface CourseDef {
  readonly name: string;
  readonly lot: { readonly x: number; readonly z: number; readonly w: number; readonly h: number };
  readonly road: {
    readonly width: number;
    readonly shoulder: number;
    readonly slope: number;
    readonly rough: number;
    readonly points: readonly (readonly [number, number])[];
  };
  readonly summit: { readonly r: number };
  /** Shooting practice (race/shooting.ts): what stands where, facing which way. */
  readonly targets?: readonly TargetDef[];
}

/**
 * A shooting target. `board`: a paper bullseye on a frame (points by ring; shot, it falls back and stands up
 * again). `plate`: a steel plate on a post (it swings and rings). `mover`: a board sliding back and forth
 * between `at` and `to` at `speed` m/s. `at` is [x, z] on the ground; `face` the way its face points (degrees:
 * 0 south (+z), 90 east (+x), 180 north, -90 west); `h` its centre's height (m, default 1.4 boards, 1.2 plates).
 */
export interface TargetDef {
  readonly kind: 'board' | 'plate' | 'mover';
  readonly at: readonly [number, number];
  readonly face: number;
  readonly h?: number;
  readonly to?: readonly [number, number];
  readonly speed?: number;
}

export function parseCourse(file: string, text: string, errors: string[]): CourseDef | null {
  const before = errors.length;
  const err = (m: string): void => void errors.push(`${file}: ${m}`);
  let d: Record<string, unknown>;
  try {
    d = YAML.parse(text) as Record<string, unknown>;
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return null;
  }
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const lot = d?.lot as Record<string, unknown> | undefined;
  if (!lot || !['x', 'z', 'w', 'h'].every((k) => num(lot[k]))) err('lot: { x, z, w, h } in metres');
  const road = d?.road as Record<string, unknown> | undefined;
  if (!road) err('road: missing');
  else {
    for (const k of ['width', 'shoulder', 'slope', 'rough']) if (!num(road[k])) err(`road.${k}: a number`);
    if (!Array.isArray(road.points) || road.points.length < 4) err('road.points: at least 4 [x, z] points');
    else road.points.forEach((p, i) => (!Array.isArray(p) || p.length !== 2 || !p.every(num)) && err(`road.points[${i}]: [x, z]`));
  }
  const summit = d?.summit as Record<string, unknown> | undefined;
  if (!summit || !num(summit.r)) err('summit: { r }');
  const xz = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(num);
  if (d?.targets !== undefined) {
    if (!Array.isArray(d.targets)) err('targets: a list');
    else {
      d.targets.forEach((t: Record<string, unknown>, i: number) => {
        const at = `targets[${i}]`;
        if (!['board', 'plate', 'mover'].includes(t?.kind as string)) err(`${at}.kind: board, plate or mover`);
        if (!xz(t?.at)) err(`${at}.at: [x, z]`);
        if (!num(t?.face)) err(`${at}.face: degrees`);
        if (t?.h !== undefined && !(num(t.h) && t.h > 0.3 && t.h < 4)) err(`${at}.h: a height in metres (0.3-4)`);
        if (t?.kind === 'mover' && (!xz(t.to) || !(num(t.speed) && t.speed > 0))) err(`${at}: a mover needs to: [x, z] and speed`);
      });
    }
  }
  if (errors.length > before) return null;
  return d as unknown as CourseDef;
}

/** Smooth noise (value noise, two octaves) for the hillside. */
function noise(x: number, z: number): number {
  const h = (i: number, j: number): number => {
    const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const one = (x: number, z: number): number => {
    const i = Math.floor(x);
    const j = Math.floor(z);
    const fx = x - i;
    const fz = z - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const a = h(i, j) + (h(i + 1, j) - h(i, j)) * sx;
    const b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * sx;
    return a + (b - a) * sz;
  };
  return one(x, z) * 0.7 + one(x * 2.3 + 17, z * 2.3 - 5) * 0.3 - 0.5;
}

const SAMPLE = 1;
const CELL = 16;

export class Course {
  readonly def: CourseDef;
  /** The road sampled every metre: centre, heading (unit), height, distance. */
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly y: Float64Array;
  readonly tx: Float64Array;
  readonly tz: Float64Array;
  readonly length: number;
  readonly half: number;
  private readonly grid = new Map<number, number[]>();
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };

  constructor(def: CourseDef) {
    this.def = def;
    this.half = def.road.width / 2;
    // Centripetal Catmull-Rom through the points (the ends doubled), sampled finely, then evenly by length.
    const P = def.road.points;
    const pts = [P[0], ...P, P[P.length - 1]];
    const fine: [number, number][] = [];
    for (let i = 1; i + 2 < pts.length; i++) {
      const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
      const tj = (a: readonly number[], b: readonly number[]): number => Math.max(1e-3, Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5);
      const t0 = 0;
      const t1 = t0 + tj(p0, p1);
      const t2 = t1 + tj(p1, p2);
      const t3 = t2 + tj(p2, p3);
      const n = Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.25));
      for (let k = 0; k < n; k++) {
        const t = t1 + ((t2 - t1) * k) / n;
        const L = (a: readonly number[], b: readonly number[], ta: number, tb: number): [number, number] => [
          ((tb - t) / (tb - ta)) * a[0] + ((t - ta) / (tb - ta)) * b[0],
          ((tb - t) / (tb - ta)) * a[1] + ((t - ta) / (tb - ta)) * b[1],
        ];
        const A1 = L(p0, p1, t0, t1);
        const A2 = L(p1, p2, t1, t2);
        const A3 = L(p2, p3, t2, t3);
        const B1 = L(A1, A2, t0, t2);
        const B2 = L(A2, A3, t1, t3);
        fine.push(L(B1, B2, t1, t2));
      }
    }
    fine.push([P[P.length - 1][0], P[P.length - 1][1]]);
    const xs: number[] = [fine[0][0]];
    const zs: number[] = [fine[0][1]];
    let carry = 0;
    for (let i = 1; i < fine.length; i++) {
      const [ax, az] = fine[i - 1];
      const [bx, bz] = fine[i];
      const seg = Math.hypot(bx - ax, bz - az);
      let at = SAMPLE - carry;
      while (at <= seg) {
        xs.push(ax + ((bx - ax) * at) / seg);
        zs.push(az + ((bz - az) * at) / seg);
        at += SAMPLE;
      }
      carry = seg - (at - SAMPLE);
    }
    const n = xs.length;
    this.x = Float64Array.from(xs);
    this.z = Float64Array.from(zs);
    this.length = (n - 1) * SAMPLE;
    this.tx = new Float64Array(n);
    this.tz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const dx = xs[b] - xs[a];
      const dz = zs[b] - zs[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
    }
    // Heights: the hill under the road, smoothed along it (a 60 m window) for an even grade; flat at the lot.
    // Before the road starts is the lot, level at 0: it counts in the window, so the climb eases out of it.
    const raw = xs.map((x, i) => this.hill(x, zs[i]));
    const y = new Float64Array(n);
    const W = 30;
    for (let i = 0; i < n; i++) {
      let s = 0;
      let c = 0;
      for (let k = i - W; k <= Math.min(n - 1, i + W); k++) {
        s += k < 0 ? 0 : raw[k];
        c++;
      }
      y[i] = s / c;
    }
    // ...and it leaves the lot exactly level (the offset that leaves eased away over 40 m).
    const y0 = y[0];
    for (let i = 0; i < Math.min(n, 40); i++) y[i] -= y0 * (1 - smooth(0, 40, i));
    // The viewpoint is level: the road rounds over (a parabola from its grade to flat over 20 m) as it
    // enters, then stays at that height across it, so the disc, the ground and the car all agree.
    let e = n - 1;
    while (e > 0 && Math.hypot(xs[e - 1] - xs[n - 1], zs[e - 1] - zs[n - 1]) < def.summit.r) e--;
    const s0 = Math.max(1, e - 20);
    const g = y[s0] - y[s0 - 1];
    const L = e - s0;
    for (let i = s0; i < n; i++) {
      const t = Math.min(i - s0, L);
      y[i] = y[s0] + g * t - (g * t * t) / (2 * L);
    }
    this.y = y;
    for (let i = 0; i < n; i++) {
      const key = this.key(Math.floor(xs[i] / CELL), Math.floor(zs[i] / CELL));
      const l = this.grid.get(key);
      if (l) l.push(i);
      else this.grid.set(key, [i]);
    }
    const M = 120;
    const lot = def.lot;
    this.bounds = {
      minX: Math.min(lot.x, ...xs) - M,
      maxX: Math.max(lot.x + lot.w, ...xs) + M,
      minZ: Math.min(lot.z, ...zs) - M,
      maxZ: Math.max(lot.z + lot.h, ...zs) + M,
    };
  }

  private key(i: number, j: number): number {
    return (i + 4096) * 8192 + (j + 4096);
  }

  /** The bare hillside (before the road is cut in). */
  hill(x: number, z: number): number {
    const r = this.def.road;
    const up = Math.max(0, -z + this.def.lot.z) * r.slope;
    return up + r.rough * noise(x / 70, z / 70) * Math.min(1, up / 6);
  }

  /** The nearest road sample to (x, z) (within about 50 m; -1 if none), and the signed offset to its left. */
  nearest(x: number, z: number): { i: number; d: number; dist: number } {
    const ci = Math.floor(x / CELL);
    const cj = Math.floor(z / CELL);
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r <= 3 && (best < 0 || r <= 1); r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          for (const i of this.grid.get(this.key(ci + di, cj + dj)) ?? []) {
            const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
            if (d < bestD) [best, bestD] = [i, d];
          }
        }
      }
    }
    if (best < 0) return { i: -1, d: 0, dist: Infinity };
    // Left of the road's heading (sin-cos convention: left = (tz, -tx)).
    const d = (x - this.x[best]) * this.tz[best] - (z - this.z[best]) * this.tx[best];
    return { i: best, d, dist: Math.sqrt(bestD) };
  }

  inLot(x: number, z: number, m = 0): boolean {
    const l = this.def.lot;
    return x > l.x + m && x < l.x + l.w - m && z > l.z + m && z < l.z + l.h - m;
  }

  /** The viewpoint at the top: its centre and height. */
  get summit(): { x: number; z: number; y: number; r: number } {
    const n = this.x.length - 1;
    return { x: this.x[n], z: this.z[n], y: this.y[n], r: this.def.summit.r };
  }

  inSummit(x: number, z: number, m = 0): boolean {
    const s = this.summit;
    return Math.hypot(x - s.x, z - s.z) < s.r - m;
  }

  /** Ground height anywhere: the lot, the viewpoint, the road, the cut and fill round it, the hillside. */
  height(x: number, z: number): number {
    if (this.inLot(x, z)) return 0;
    const s = this.summit;
    const ds = Math.hypot(x - s.x, z - s.z);
    const n = this.nearest(x, z);
    const hill = this.hill(x, z);
    // Near the lot, the ground comes down to it.
    const l = this.def.lot;
    const toLot = Math.hypot(Math.max(l.x - x, 0, x - (l.x + l.w)), Math.max(l.z - z, 0, z - (l.z + l.h)));
    let g = hill * smooth(0, 25, toLot);
    if (ds < s.r + 25) g = lerp(s.y, g, smooth(s.r, s.r + 25, ds));
    if (n.i < 0) return g;
    const road = this.y[n.i];
    const flat = this.half + this.def.road.shoulder + 0.8;
    const a = Math.abs(n.d);
    if (a <= flat) return ds < s.r ? s.y : road;
    // Cut and fill: easing from the road back to the hill over 14 m.
    return lerp(road, g, smooth(flat, flat + 14, a));
  }

  normal(x: number, z: number): [number, number, number] {
    const e = 0.6;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    const nx = -hx / (2 * e);
    const nz = -hz / (2 * e);
    const l = Math.hypot(nx, 1, nz);
    return [nx / l, 1 / l, nz / l];
  }

  /** Tarmac on the road, the lot and the viewpoint; gravel on the shoulder; grass beyond. */
  grip(x: number, z: number): number {
    if (this.inLot(x, z) || this.inSummit(x, z)) return 1;
    const n = this.nearest(x, z);
    const a = Math.abs(n.d);
    return a <= this.half ? 1 : a <= this.half + this.def.road.shoulder ? 0.7 : 0.55;
  }

  /** Whether a point is inside the walls: on the lot, the viewpoint, or between the road's guardrails. */
  inside(x: number, z: number): boolean {
    if (this.inLot(x, z, 0.5) || this.inSummit(x, z, 0.8)) return true;
    const n = this.nearest(x, z);
    return n.i >= 0 && Math.abs(n.d) < this.rail;
  }

  /** The guardrails' offset from the road's centre line. */
  get rail(): number {
    return this.half + this.def.road.shoulder;
  }

  /**
   * Walls for a car (half length hl, half width hw) at (x, z) heading h: the corner furthest outside, pushed
   * back to the nearest inside (the road between its rails, the lot, the viewpoint).
   */
  collide(x: number, z: number, h: number, hl: number, hw: number): { px: number; pz: number; nx: number; nz: number } | null {
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const lx = Math.cos(h);
    const lz = -Math.sin(h);
    let worst: { px: number; pz: number; nx: number; nz: number; d: number } | null = null;
    for (const [a, b] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [0, hw], [0, -hw]] as const) {
      const cx = x + fx * a + lx * b;
      const cz = z + fz * a + lz * b;
      if (this.inside(cx, cz)) continue;
      const pushes: [number, number][] = [];
      // Back between the rails.
      const n = this.nearest(cx, cz);
      if (n.i >= 0) {
        const over = Math.abs(n.d) - (this.rail - 0.01);
        const s = Math.sign(n.d);
        pushes.push([-this.tz[n.i] * s * over, this.tx[n.i] * s * over]);
      }
      // Back onto the lot.
      const l = this.def.lot;
      const m = 0.51;
      const qx = Math.min(Math.max(cx, l.x + m), l.x + l.w - m);
      const qz = Math.min(Math.max(cz, l.z + m), l.z + l.h - m);
      pushes.push([qx - cx, qz - cz]);
      // Back into the viewpoint.
      const S = this.summit;
      const ds = Math.hypot(cx - S.x, cz - S.z);
      if (ds > 0) {
        const k = (S.r - 0.81 - ds) / ds;
        pushes.push([(cx - S.x) * k, (cz - S.z) * k]);
      }
      let best = pushes[0];
      for (const p of pushes) if (Math.hypot(p[0], p[1]) < Math.hypot(best[0], best[1])) best = p;
      const d = Math.hypot(best[0], best[1]);
      if (!worst || d > worst.d) worst = { px: best[0], pz: best[1], nx: best[0] / (d || 1), nz: best[1] / (d || 1), d };
    }
    return worst ? { px: worst.px, pz: worst.pz, nx: worst.nx, nz: worst.nz } : null;
  }

  /** As the car's Ground. */
  get ground(): Ground {
    return {
      height: (x, z) => this.height(x, z),
      normal: (x, z) => this.normal(x, z),
      grip: (x, z) => this.grip(x, z),
      collide: (x, z, h, hl, hw) => this.collide(x, z, h, hl, hw),
    };
  }
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
