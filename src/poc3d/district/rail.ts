import YAML from 'yaml';
import type { MacroMap } from '../../gen/macro';
import type { Rect } from '../../core/coords';
import { CELL } from './plan';

/**
 * The elevated railways (content/world3d/rail.yaml), in world metres. Each line runs along L0 grid lines through
 * its points (`pts`, grid units; fractions allowed at the ends), its corners rounded into arcs (`radius` by kind),
 * sampled every metre as a path with s, the distance along it. Pure: shared by the page (viaducts, trains, rides)
 * and the network (district/subway.ts: its stations in order along s).
 *
 *   lines:
 *     - id: toto
 *       name: 東都線
 *       nameEn: TOTO LINE
 *       letter: T            # station codes T01... in order along the line
 *       color: '#10a060'
 *       kind: train          # train (a viaduct deck, two tracks, catenary) or monorail (two beams on T-piers)
 *       pts: [[26, 6], [26, 17]]
 *
 * Stations are stamps with landmark: station, their street face 10 m from the line on a straight stretch;
 * `station: { jp, en, line }` says which line (the first line if none).
 */
export type RailKind = 'train' | 'monorail';

/** Corner radius by kind. */
export const RAIL_RADIUS: Readonly<Record<RailKind, number>> = { train: 90, monorail: 45 };

export interface RailAt {
  readonly x: number;
  readonly z: number;
  /** Unit heading (direction of increasing s). */
  readonly hx: number;
  readonly hz: number;
}

/** A centreline sampled every metre or so, with arc length. */
export class RailPath {
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly ss: Float64Array;
  readonly length: number;
  /** Each rounded corner's bounding box (the arc cuts across the corner of a cell). */
  readonly arcs: { x0: number; z0: number; x1: number; z1: number }[] = [];

  constructor(pts: readonly (readonly [number, number])[], radius: number) {
    const out: [number, number][] = [[pts[0][0], pts[0][1]]];
    const line = (x: number, z: number): void => {
      const [px, pz] = out[out.length - 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x - px, z - pz)));
      for (let i = 1; i <= n; i++) out.push([px + ((x - px) * i) / n, pz + ((z - pz) * i) / n]);
    };
    for (let i = 1; i < pts.length; i++) {
      const [x, z] = pts[i];
      if (i === pts.length - 1) {
        line(x, z);
        break;
      }
      const [px, pz] = pts[i - 1];
      const [nx, nz] = pts[i + 1];
      const la = Math.hypot(x - px, z - pz);
      const lb = Math.hypot(nx - x, nz - z);
      const a = [(x - px) / la, (z - pz) / la];
      const b = [(nx - x) / lb, (nz - z) / lb];
      const cross = a[0] * b[1] - a[1] * b[0];
      const theta = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])));
      if (theta < 1e-4) {
        line(x, z);
        continue;
      }
      const L = Math.min(radius * Math.tan(theta / 2), la / 2, lb / 2);
      const R = L / Math.tan(theta / 2);
      const sx = x - a[0] * L;
      const sz = z - a[1] * L;
      line(sx, sz);
      // The arc's centre is off to the side the line turns to.
      const sg = Math.sign(cross);
      const cx = sx + sg * -a[1] * R;
      const cz = sz + sg * a[0] * R;
      const a0 = Math.atan2(sz - cz, sx - cx);
      const n = Math.max(2, Math.ceil(R * theta));
      const box = { x0: sx, z0: sz, x1: sx, z1: sz };
      for (let k = 1; k <= n; k++) {
        const ang = a0 + sg * theta * (k / n);
        const px = cx + Math.cos(ang) * R;
        const pz = cz + Math.sin(ang) * R;
        out.push([px, pz]);
        box.x0 = Math.min(box.x0, px);
        box.z0 = Math.min(box.z0, pz);
        box.x1 = Math.max(box.x1, px);
        box.z1 = Math.max(box.z1, pz);
      }
      this.arcs.push(box);
    }
    this.xs = new Float64Array(out.map((p) => p[0]));
    this.zs = new Float64Array(out.map((p) => p[1]));
    this.ss = new Float64Array(out.length);
    for (let i = 1; i < out.length; i++) this.ss[i] = this.ss[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]);
    this.length = this.ss[out.length - 1];
  }

  /** The point and heading at s (clamped to the path). */
  at(s: number): RailAt {
    const n = this.ss.length;
    const q = Math.max(0, Math.min(this.length, s));
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.ss[mid] <= q) lo = mid;
      else hi = mid;
    }
    const seg = this.ss[hi] - this.ss[lo] || 1;
    const f = (q - this.ss[lo]) / seg;
    const dx = this.xs[hi] - this.xs[lo];
    const dz = this.zs[hi] - this.zs[lo];
    const l = Math.hypot(dx, dz) || 1;
    return { x: this.xs[lo] + dx * f, z: this.zs[lo] + dz * f, hx: dx / l, hz: dz / l };
  }

  /** The nearest point of the path to (x, z): its s, and the distance off it. */
  project(x: number, z: number): { s: number; d: number } {
    let best = { s: 0, d: Infinity };
    for (let i = 0; i + 1 < this.xs.length; i++) {
      const ax = this.xs[i];
      const az = this.zs[i];
      const bx = this.xs[i + 1] - ax;
      const bz = this.zs[i + 1] - az;
      const l2 = bx * bx + bz * bz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / l2));
      const d = Math.hypot(x - ax - bx * t, z - az - bz * t);
      if (d < best.d) best = { s: this.ss[i] + t * Math.sqrt(l2), d };
    }
    return best;
  }
}

/** Left of the heading (x east, z south, seen from above). */
export const leftOf = (h: { hx: number; hz: number }): [number, number] => [h.hz, -h.hx];

export interface RailLine3 {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string;
  readonly letter: string;
  readonly color: number;
  readonly kind: RailKind;
  readonly path: RailPath;
  /** The straight runs between the given points (grid-aligned, world metres), for the traffic under them. */
  readonly segments: readonly { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number }[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseRails3(file: string, text: string, macro: MacroMap, errors: string[]): RailLine3[] {
  const err = (m: string): void => void errors.push(`${file}: ${m}`);
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return [];
  }
  if (!isObj(doc) || !Array.isArray(doc.lines)) return err('expected lines: [...]'), [];
  const out: RailLine3[] = [];
  doc.lines.forEach((raw: unknown, i: number) => {
    const at = `lines[${i}]`;
    if (!isObj(raw)) return err(`${at} must be a mapping`);
    const id = String(raw.id);
    if (!/^[a-z0-9_]+$/.test(id)) return err(`${at}: id must match [a-z0-9_]+`);
    if (out.some((l) => l.id === id)) return err(`${at}: duplicate id '${id}'`);
    if (typeof raw.letter !== 'string' || !/^[A-Z]$/.test(raw.letter)) return err(`${at} (${id}): letter must be one capital`);
    if (!/^#[0-9a-f]{6}$/i.test(String(raw.color))) return err(`${at} (${id}): color must be '#rrggbb'`);
    const kind = raw.kind ?? 'train';
    if (kind !== 'train' && kind !== 'monorail') return err(`${at} (${id}): kind must be train or monorail`);
    const pts = raw.pts;
    if (!Array.isArray(pts) || pts.length < 2 || !pts.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number'))) {
      return err(`${at} (${id}): pts must be at least two [col, row] grid points`);
    }
    const P = pts as [number, number][];
    for (let k = 0; k < P.length; k++) {
      const [c, r] = P[k];
      if (c < 0 || r < 0 || c > macro.cols || r > macro.rows) return err(`${at} (${id}): point ${k} is off the map`);
      if (k > 0 && P[k - 1][0] !== c && P[k - 1][1] !== r) return err(`${at} (${id}): points ${k - 1} and ${k} must share a grid line`);
    }
    const world = P.map(([c, r]) => [c * CELL, r * CELL] as const);
    out.push({
      id,
      name: String(raw.name),
      nameEn: String(raw.nameEn),
      letter: raw.letter,
      color: parseInt(String(raw.color).slice(1), 16),
      kind,
      path: new RailPath(world, RAIL_RADIUS[kind]),
      segments: world.slice(1).map((p, k) => ({ x0: Math.min(world[k][0], p[0]), z0: Math.min(world[k][1], p[1]), x1: Math.max(world[k][0], p[0]), z1: Math.max(world[k][1], p[1]) })),
    });
  });
  return out;
}

/**
 * Ground the planner keeps clear under the lines' curves (district/model.ts: lots touching it are left open): each
 * arc's box, widened by the beams or deck and the cars' swing. The straight runs are over the roads already.
 */
export function railReserved(lines: readonly RailLine3[]): Rect[] {
  const pad = 7;
  return lines.flatMap((l) => l.path.arcs.map((a) => ({ x: a.x0 - pad, y: a.z0 - pad, w: a.x1 - a.x0 + pad * 2, h: a.z1 - a.z0 + pad * 2 })));
}
