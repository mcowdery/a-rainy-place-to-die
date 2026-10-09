import { TemplateBuilder, type Row, type Template, type V3, type Weight } from './mobRig';

/**
 * The mesh operations the mob's shaped figures are built with (split from mobShape.ts, which keeps the figures'
 * measurements and what each body, hair and outfit does with them): pushing a surface about with `Bulge`s, welding
 * and zipping rings of vertices, lofting rows into a tube, smoothing normals, and the row maths. Moved as they were:
 * `tests/people.test.ts` and a fingerprint of every body, hair and outfit show the figures unchanged.
 */

/** A push on the surface: vertices within the ellipsoid (centre c, radii r) move by `push`, fading to its edge. */
export interface Bulge {
  readonly c: V3;
  readonly r: V3;
  readonly push: V3;
  /** How round its top is: 2 a soft bell (the default), nearer 1 a dome. */
  readonly round?: number;
  /** Its reach above its centre, where that's longer than below (a breast: a long upper slope, the underside short). */
  readonly up?: number;
  /**
   * How round it is toward its lower edge, where that differs from `round` (eased in from the centre's height down):
   * under 1 it meets the surface below at a crease instead of fading into it (the fold under a bare breast).
   */
  readonly under?: number;
  /**
   * How far its upper half and sides are a cone's rather than a dome's (0: a dome, the default; 1: straight slopes
   * to a point): a form that comes to its tip instead of being round all over.
   */
  readonly point?: number;
  /**
   * How round it is across the body, where that differs from up and down: under 1 its sides are steep (a mound
   * that stands off the chest all the way round its sides, not a swell that fades into it).
   */
  readonly side?: number;
  /**
   * Its lower half's profile, where that's its own (a bare breast's, rounding down under its tip and back up into
   * the fold): [how far from the centre (0) to the lower edge (1), the share of the push there, how far it's let
   * down besides (m)], straight under the centre; less of it round toward the sides.
   */
  readonly lower?: readonly (readonly [number, number, number])[];
  /**
   * The two sides meet in a crease down the middle instead of running together (the buttocks' cleft): where they
   * overlap a vertex takes the nearer side's push alone, not both.
   */
  readonly cleft?: boolean;
}

/** How far past a bulge's lower edge (of its reach) the surface still goes with that edge (`Bulge.lower`). */
export const LOWER_BAND = 0.6;
/** How far a field moves a point. Bulges with a centre off the middle are mirrored to the other side. */
export function pushAt(x: number, y: number, z: number, field: readonly Bulge[]): V3 {
  let dx = 0, dy = 0, dz = 0;
  for (const b of field) {
    let most = 0, side = 1, mostDrop = 0, pastMost = 0;
    for (const sx of b.c[0] === 0 ? [1] : [1, -1]) {
      const ex = (x - sx * b.c[0]) / b.r[0], ey = (y - b.c[1]) / (y > b.c[1] ? (b.up ?? b.r[1]) : b.r[1]), ez = (z - b.c[2]) / b.r[2];
      /** Its form across and above: a dome, part cone where it comes to a point. */
      const form = (d2: number, lower: number): number => {
        // (How much of the way out from its centre is across the body: there `side` is its roundness.)
        const across = b.side === undefined || d2 < 1e-9 ? 0 : (ex * ex) / d2;
        const round = (b.round ?? 2) + ((b.under ?? 0) - (b.round ?? 2)) * lower;
        const dome = Math.pow(1 - d2, round + ((b.side ?? round) - round) * across);
        // (The cone eased to nothing at its edge, so the form runs into the surface round it without a crease.)
        return b.point ? dome + (Math.pow(1 - Math.sqrt(d2), 1.4) - dome) * b.point * (1 - lower) * (1 - across) : dome;
      };
      let k: number, drop = 0;
      if (b.lower && ey < 0) {
        // Its lower half by its own profile, out from the centre to the lower edge: how far it stands out there and
        // how far it's let down, as the profile says straight under the centre, less of both the nearer the point
        // is to beside it (where it's the form the upper half has).
        const d2 = ex * ex + ey * ey + ez * ez;
        const t = Math.sqrt(d2);
        // (Fuller round toward the sides than straight in proportion: a round lower half, not a pointed one.)
        const under = t > 1e-6 ? Math.pow(-ey / t, 0.7) : 0;
        if (t >= 1) {
          // Past its lower edge the surface goes with the edge, less and less (LOWER_BAND of its reach on): where
          // the edge is drawn up into a fold, the chest under it is drawn up behind it, not left as a step.
          const past = clamp01((t - 1) / LOWER_BAND);
          const lift = -b.lower[b.lower.length - 1][2] * under * (1 - past * past * (3 - 2 * past));
          if (!b.cleft) dy += lift;
          else if (Math.abs(lift) > Math.abs(pastMost)) pastMost = lift;
          continue;
        }
        let n = 0;
        while (n < b.lower.length - 2 && b.lower[n + 1][0] < t) n++;
        const [t0, k0, d0] = b.lower[n], [t1, k1, d1] = b.lower[n + 1];
        const u = clamp01((t - t0) / (t1 - t0));
        const beside = form(d2, 0);
        k = beside + (k0 + (k1 - k0) * u - beside) * under;
        drop = (d0 + (d1 - d0) * u) * under;
      } else {
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 >= 1) continue;
        const low = b.under === undefined || ey >= 0 ? 0 : Math.min(1, -ey);
        k = form(d2, low * low * (3 - 2 * low));
      }
      if (b.cleft) {
        if (k > most) {
          most = k;
          side = sx;
          mostDrop = drop;
        }
        continue;
      }
      dx += sx * b.push[0] * k;
      dy += b.push[1] * k - drop;
      dz += b.push[2] * k;
    }
    // (On the middle itself neither side's push across counts.)
    dx += (Math.abs(x) < 1e-6 ? 0 : side) * b.push[0] * most;
    // (Where it's within one side, that side's alone; only clear of both does it go with a lower edge.)
    dy += most > 0 ? b.push[1] * most - mostDrop : pastMost;
    dz += b.push[2] * most;
  }
  return [dx, dy, dz];
}
export function displace(tb: TemplateBuilder, from: number, field: readonly Bulge[]): void {
  if (!field.length) return;
  const P = tb.pos;
  for (let i = from * 3; i < P.length; i += 3) {
    const d = pushAt(P[i], P[i + 1], P[i + 2], field);
    P[i] += d[0];
    P[i + 1] += d[1];
    P[i + 2] += d[2];
  }
}

/**
 * Two shapes pushed into one another made one surface (a character's arm and chest): `a` and `b` are each a run of
 * the builder's points (first, one past the last) with the faces among them. Every point of either that lies inside
 * the other (a ray's crossings of the other's faces; only points `near` allows) goes, with the faces on it, which
 * leaves each shape open along a ragged line beside where the two met; the two open edges are then joined by faces,
 * going round both together and advancing along whichever makes the shorter new edge. Each new face is wound against
 * the edge it stands on, so the surface faces out without being told which way that is. Nothing is changed, and
 * false comes back, where the two don't meet in one closed line each (an edge that forks, more than one opening).
 */
export function weld(tb: TemplateBuilder, a: readonly [number, number], b: readonly [number, number], near: (x: number, y: number, z: number) => boolean, axis: V3 = [1, 0, 0]): number[][] | null {
  const P = tb.pos, I = tb.idx;
  const of = (v: number): number => (v >= a[0] && v < a[1] ? 0 : v >= b[0] && v < b[1] ? 1 : -1);
  const tris: number[][] = [[], []];
  for (let t = 0; t < I.length; t += 3) {
    const k = of(I[t]);
    if (k >= 0 && of(I[t + 1]) === k && of(I[t + 2]) === k) tris[k].push(t);
  }
  // (A ray a little off level and off every axis, so it doesn't run along the shapes' own lines.)
  const D = [0.297, 0.031, 0.954];
  const inside = (v: number, other: readonly number[]): boolean => {
    const ox = P[v * 3], oy = P[v * 3 + 1], oz = P[v * 3 + 2];
    let hits = 0;
    for (const t of other) {
      const p0 = I[t] * 3, p1 = I[t + 1] * 3, p2 = I[t + 2] * 3;
      const e1x = P[p1] - P[p0], e1y = P[p1 + 1] - P[p0 + 1], e1z = P[p1 + 2] - P[p0 + 2];
      const e2x = P[p2] - P[p0], e2y = P[p2 + 1] - P[p0 + 1], e2z = P[p2 + 2] - P[p0 + 2];
      const hx = D[1] * e2z - D[2] * e2y, hy = D[2] * e2x - D[0] * e2z, hz = D[0] * e2y - D[1] * e2x;
      const det = e1x * hx + e1y * hy + e1z * hz;
      if (Math.abs(det) < 1e-14) continue;
      const sx = ox - P[p0], sy = oy - P[p0 + 1], sz = oz - P[p0 + 2];
      const u = (sx * hx + sy * hy + sz * hz) / det;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const w = (D[0] * qx + D[1] * qy + D[2] * qz) / det;
      if (w < 0 || u + w > 1) continue;
      if ((e2x * qx + e2y * qy + e2z * qz) / det > 1e-9) hits++;
    }
    return hits % 2 === 1;
  };
  const gone = new Set<number>();
  for (const k of [0, 1]) {
    const [from, to] = k === 0 ? a : b;
    for (let v = from; v < to; v++) if (near(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]) && inside(v, tris[1 - k])) gone.add(v);
  }
  if (!gone.size) return null;
  // Each shape's open edge: the edges of the faces that stay which a face that goes shared, the way the staying face
  // has them. It must be one closed line: a point where it forks (the opening pinched there) goes too, and so does
  // any piece left cut off from the rest (the top of the arm standing out above the shoulder), until it is.
  const loops: number[][] = [];
  const drop = new Set<number>();
  for (const k of [0, 1]) {
    let loop: number[] | null = null;
    for (let pass = 0; pass < 12 && !loop; pass++) {
      const cut = new Set<string>();
      const stay: number[] = [];
      for (const t of tris[k]) {
        if (gone.has(I[t]) || gone.has(I[t + 1]) || gone.has(I[t + 2])) for (let e = 0; e < 3; e++) cut.add(`${I[t + e]},${I[t + ((e + 1) % 3)]}`);
        else stay.push(t);
      }
      if (stay.length === tris[k].length || !stay.length) return null;
      // (The pieces the staying faces are in, by the points they share; all but the biggest go.)
      const piece = new Map<number, number>();
      const top = (v: number): number => {
        let r = v;
        while (piece.get(r) !== r) r = piece.get(r)!;
        piece.set(v, r);
        return r;
      };
      for (const t of stay) {
        for (let e = 0; e < 3; e++) if (!piece.has(I[t + e])) piece.set(I[t + e], I[t + e]);
        piece.set(top(I[t + 1]), top(I[t]));
        piece.set(top(I[t + 2]), top(I[t]));
      }
      const size = new Map<number, number>();
      for (const t of stay) size.set(top(I[t]), (size.get(top(I[t])) ?? 0) + 1);
      const main = [...size.entries()].sort((p, q) => q[1] - p[1])[0][0];
      let again = false;
      for (const v of piece.keys()) {
        if (top(v) === main) continue;
        gone.add(v);
        again = true;
      }
      if (again) continue;
      // (The staying faces' free edges: the opening, and with it any of the shape's own open end it runs into, the
      // top of the arm; the shape's other open ends are lines of their own and are left.)
      const has = new Set<string>();
      for (const t of stay) for (let e = 0; e < 3; e++) has.add(`${I[t + e]},${I[t + ((e + 1) % 3)]}`);
      const next = new Map<number, number>();
      for (const t of stay) {
        for (let e = 0; e < 3; e++) {
          const p = I[t + e], q = I[t + ((e + 1) % 3)];
          if (has.has(`${q},${p}`)) continue;
          if (next.has(p)) {
            gone.add(p);
            again = true;
          } else next.set(p, q);
        }
      }
      if (again) continue;
      // The closed lines among them, and which have an edge of the cut.
      const seen = new Set<number>();
      const cuts: number[][] = [];
      let open = false;
      for (const first of next.keys()) {
        if (seen.has(first)) continue;
        const round = [first];
        seen.add(first);
        let v = next.get(first);
        while (v !== undefined && v !== first && !seen.has(v)) {
          round.push(v);
          seen.add(v);
          v = next.get(v);
        }
        if (v !== first) open = true;
        else if (round.some((q) => cut.has(`${next.get(q)},${q}`))) cuts.push(round);
      }
      if (open || !cuts.length) return null;
      cuts.sort((p, q) => q.length - p.length);
      // (More than one opening: the smaller ones' points go, and it's looked at again.)
      if (cuts.length > 1) {
        for (const round of cuts.slice(1)) for (const q of round) gone.add(q);
        continue;
      }
      loop = cuts[0];
    }
    if (!loop) return null;
    loops.push(loop);
  }
  for (const k of [0, 1]) for (const t of tris[k]) if (gone.has(I[t]) || gone.has(I[t + 1]) || gone.has(I[t + 2])) drop.add(t);
  // Joined: the second runs the other way round the opening, so it is taken backward. The two are gone round together
  // by the angle each has come about the middle of the opening, seen along the body's width (the way an arm or a leg
  // leaves it): whichever is behind goes on. (By the shorter new edge alone the faces slanted all one way round, and
  // an arm raised wrung them like a cloth.)
  const A = loops[0], B = loops[1].slice().reverse();
  // (Seen along `axis`: the way the one shape leaves the other. Across the body by default, an arm's way.)
  const c: V3 = [0, 0, 0];
  for (const v of [...A, ...B]) for (let k = 0; k < 3; k++) c[k] += P[v * 3 + k] / (A.length + B.length);
  const up: V3 = Math.abs(axis[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  let e1: V3 = [axis[1] * up[2] - axis[2] * up[1], axis[2] * up[0] - axis[0] * up[2], axis[0] * up[1] - axis[1] * up[0]];
  const l1 = Math.hypot(e1[0], e1[1], e1[2]) || 1;
  e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
  const e2: V3 = [axis[1] * e1[2] - axis[2] * e1[1], axis[2] * e1[0] - axis[0] * e1[2], axis[0] * e1[1] - axis[1] * e1[0]];
  const angle = (v: number): number => {
    const d = [P[v * 3] - c[0], P[v * 3 + 1] - c[1], P[v * 3 + 2] - c[2]];
    return Math.atan2(d[0] * e2[0] + d[1] * e2[1] + d[2] * e2[2], d[0] * e1[0] + d[1] * e1[1] + d[2] * e1[2]);
  };
  const turn = (p: number, q: number): number => {
    const d = angle(q) - angle(p);
    return d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d;
  };
  let start = 0;
  for (let j = 1; j < B.length; j++) if (Math.abs(turn(A[0], B[j])) < Math.abs(turn(A[0], B[start]))) start = j;
  const kept: number[] = [];
  for (let t = 0; t < I.length; t += 3) if (!drop.has(t)) kept.push(I[t], I[t + 1], I[t + 2]);
  const n = A.length, m = B.length;
  // (How far round each has come: its own turns added up, the second's from where it stands to the first's start.)
  const way = Math.sign(A.reduce((sum, v, q) => sum + turn(v, A[(q + 1) % n]), 0)) || 1;
  let i = 0, j = 0, ta = 0, tb2 = turn(A[0], B[start]) * way;
  while (i < n || j < m) {
    const ai = A[i % n], an = A[(i + 1) % n], bj = B[(start + j) % m], bn = B[(start + j + 1) % m];
    const da = turn(ai, an) * way, db = turn(bj, bn) * way;
    if (j >= m || (i < n && ta + da <= tb2 + db)) {
      kept.push(an, ai, bj);
      ta += da;
      i++;
    } else {
      kept.push(bj, bn, ai);
      tb2 += db;
      j++;
    }
  }
  tb.idx = kept;
  return loops;
}

/**
 * The edge of the opening left in a shape (a run of the builder's points) when some of its points go, as one closed
 * line of points, the way the faces that stay have it; null where it can't be made one (it is asked for where it
 * should be: a hole cut in the chest). A point where the edge forks, and any smaller opening's points, go too
 * (`gone` grows), until it is one.
 */
export function openingOf(tb: TemplateBuilder, run: readonly [number, number], gone: Set<number>): number[] | null {
  const I = tb.idx;
  const tris: number[] = [];
  for (let t = 0; t < I.length; t += 3) if ([0, 1, 2].every((e) => I[t + e] >= run[0] && I[t + e] < run[1])) tris.push(t);
  for (let pass = 0; pass < 12; pass++) {
    const cut = new Set<string>(), has = new Set<string>();
    const stay: number[] = [];
    for (const t of tris) {
      const off = gone.has(I[t]) || gone.has(I[t + 1]) || gone.has(I[t + 2]);
      if (!off) stay.push(t);
      for (let e = 0; e < 3; e++) (off ? cut : has).add(`${I[t + e]},${I[t + ((e + 1) % 3)]}`);
    }
    const next = new Map<number, number>();
    let again = false;
    for (const t of stay) {
      for (let e = 0; e < 3; e++) {
        const a = I[t + e], b = I[t + ((e + 1) % 3)];
        if (!cut.has(`${b},${a}`) || has.has(`${b},${a}`)) continue;
        if (next.has(a)) {
          gone.add(a);
          again = true;
        } else next.set(a, b);
      }
    }
    if (again) continue;
    if (!next.size) return null;
    const seen = new Set<number>();
    const rounds: number[][] = [];
    for (const first of next.keys()) {
      if (seen.has(first)) continue;
      const round = [first];
      seen.add(first);
      let v = next.get(first);
      while (v !== undefined && v !== first && !seen.has(v)) {
        round.push(v);
        seen.add(v);
        v = next.get(v);
      }
      if (v !== first) return null;
      rounds.push(round);
    }
    rounds.sort((a, b) => b.length - a.length);
    if (rounds.length === 1) return rounds[0];
    for (const round of rounds.slice(1)) for (const v of round) gone.add(v);
  }
  return null;
}

/**
 * Faces joining two closed lines of points that go the same way round an opening (`a` the way its own faces have it,
 * so each new face is wound against the edge it stands on): both are gone round together by the angle each has come
 * (`angle`: a point's angle about the opening's middle), whichever is behind going on.
 */
export function stitchRings(a: readonly number[], b: readonly number[], angle: (v: number) => number): number[] {
  const turn = (p: number, q: number): number => {
    const d = angle(q) - angle(p);
    return d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d;
  };
  const n = a.length, m = b.length;
  let start = 0;
  for (let j = 1; j < m; j++) if (Math.abs(turn(a[0], b[j])) < Math.abs(turn(a[0], b[start]))) start = j;
  const way = Math.sign(a.reduce((sum, v, q) => sum + turn(v, a[(q + 1) % n]), 0)) || 1;
  const out: number[] = [];
  let i = 0, j = 0, ta = 0, tb = turn(a[0], b[start]) * way;
  while (i < n || j < m) {
    const ai = a[i % n], an = a[(i + 1) % n], bj = b[(start + j) % m], bn = b[(start + j + 1) % m];
    const da = turn(ai, an) * way, db = turn(bj, bn) * way;
    if (j >= m || (i < n && ta + da <= tb + db)) {
      out.push(an, ai, bj);
      ta += da;
      i++;
    } else {
      out.push(bj, bn, ai);
      tb += db;
      j++;
    }
  }
  return out;
}

/**
 * Faces between two rows of points of different counts (vertex indices, both listed the same way round, `lo` the
 * lower): a zipper, advancing along whichever row is behind by its share of the way. The vertices are shared with
 * the lofts either side, so the surface shades as one. `closed`: rings (the upper is turned to start where the
 * lower does). `flip`: the rows are listed against a loft's sense (from +z toward +x).
 */
export function zip(tb: TemplateBuilder, lo: readonly number[], hi: readonly number[], closed: boolean, flip = false): void {
  const P = tb.pos;
  const dist = (a: number, b: number): number => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
  let H = hi.slice();
  if (closed) {
    let k0 = 0;
    for (let k = 1; k < H.length; k++) if (dist(H[k], lo[0]) < dist(H[k0], lo[0])) k0 = k;
    H = [...H.slice(k0), ...H.slice(0, k0)];
  }
  const L = closed ? [...lo, lo[0]] : lo;
  if (closed) H.push(H[0]);
  const along = (row: readonly number[]): number[] => {
    const f = [0];
    for (let i = 1; i < row.length; i++) f.push(f[i - 1] + dist(row[i - 1], row[i]));
    return f.map((v) => v / (f[f.length - 1] || 1));
  };
  const fl = along(L), fh = along(H);
  let i = 0, k = 0;
  while (i < L.length - 1 || k < H.length - 1) {
    const stepLo = k === H.length - 1 || (i < L.length - 1 && fl[i + 1] <= fh[k + 1]);
    const c = stepLo ? L[i + 1] : H[k + 1];
    if (flip) tb.idx.push(L[i], c, H[k]);
    else tb.idx.push(L[i], H[k], c);
    if (stepLo) i++;
    else k++;
  }
}

/**
 * A tube along a path: a ring of `seg` points square to it at each point, its radius there (`flat`: how much
 * thinner it is across its second axis), closed to a point just past its end. A finger, a toe.
 */
export function tube(tb: TemplateBuilder, path: readonly V3[], radii: readonly number[], seg: number, weights: Weight | readonly Weight[], shade: number, flat = 1): void {
  const start = tb.pos.length / 3;
  const n = path.length;
  // (One weight for all of it, or one a ring: a finger's joints.)
  const each = typeof weights[0] !== 'number';
  let weight = (each ? (weights as readonly Weight[])[0] : weights) as Weight;
  const put = (x: number, y: number, z: number): void => {
    tb.pos.push(x, y, z);
    tb.b0.push(weight[0]);
    tb.b1.push(weight[1]);
    tb.w.push(weight[2]);
    tb.shade.push(shade);
  };
  let last: V3 = [0, -1, 0];
  let before: V3 | null = null;
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)], c = path[i];
    if (each) weight = (weights as readonly Weight[])[Math.min(i, weights.length - 1)];
    let d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    d = [d[0] / dl, d[1] / dl, d[2] / dl];
    last = d;
    // (Across it: square to its length and to x where it runs up and down, else to y; and from then on the ring
    // before's own across, carried along. Chosen afresh at each ring it turned a quarter round wherever the path
    // passed from mostly upright to mostly level, a curled finger's last joint, which wrung the tube to a thread
    // there and left the fingertip looking like a bead come off.)
    const ref: V3 = Math.abs(d[1]) > 0.6 ? [1, 0, 0] : [0, 1, 0];
    const k: number = before ? before[0] * d[0] + before[1] * d[1] + before[2] * d[2] : 0;
    let u: V3 = before ? [before[0] - d[0] * k, before[1] - d[1] * k, before[2] - d[2] * k] : [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
    const ul = Math.hypot(u[0], u[1], u[2]) || 1;
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    before = u;
    const v: V3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
    for (let j = 0; j < seg; j++) {
      const t = (j / seg) * Math.PI * 2, cu = Math.cos(t) * radii[i], cv = Math.sin(t) * radii[i] * flat;
      put(c[0] + u[0] * cu + v[0] * cv, c[1] + u[1] * cu + v[1] * cv, c[2] + u[2] * cu + v[2] * cv);
    }
  }
  const e = path[n - 1], r = radii[n - 1] * 0.7;
  put(e[0] + last[0] * r, e[1] + last[1] * r, e[2] + last[2] * r);
  const tip = tb.pos.length / 3 - 1;
  // Faces out: away from the path.
  const P = tb.pos;
  const out = (a: number, b: number, c: number, about: V3): void => {
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3 - about[0], my = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3 - about[1], mz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3 - about[2];
    if (nx * mx + ny * my + nz * mz >= 0) tb.idx.push(a, b, c);
    else tb.idx.push(a, c, b);
  };
  for (let i = 0; i + 1 < n; i++) {
    const mid: V3 = [(path[i][0] + path[i + 1][0]) / 2, (path[i][1] + path[i + 1][1]) / 2, (path[i][2] + path[i + 1][2]) / 2];
    for (let j = 0; j < seg; j++) {
      const a = start + i * seg + j, b = start + i * seg + ((j + 1) % seg), c = start + (i + 1) * seg + ((j + 1) % seg), d = start + (i + 1) * seg + j;
      out(a, c, b, mid);
      out(a, d, c, mid);
    }
  }
  for (let j = 0; j < seg; j++) out(start + (n - 1) * seg + j, start + (n - 1) * seg + ((j + 1) % seg), tip, e);
}

/**
 * Normals softened where two parts of a figure meet (a shoulder, an ankle: each built as a shape of its own, pushed
 * into the other, so the light broke along the join): within each zone (centre, radius) a point's normal becomes
 * the mean of those near it that face about the same way, whichever part they belong to. The join then shades as
 * one surface. (Opposite faces close together, an arm against the ribs, are left alone.)
 */
export function softenNormals(t: Template, zones: readonly (readonly [V3, number])[]): void {
  const P = t.pos, N = t.nor;
  const idx: number[] = [];
  for (let i = 0; i < P.length / 3; i++) if (zones.some(([c, r]) => Math.hypot(P[i * 3] - c[0], P[i * 3 + 1] - c[1], P[i * 3 + 2] - c[2]) < r)) idx.push(i);
  const S2 = 0.016 * 0.016, R2 = 0.045 * 0.045;
  const next = new Float32Array(idx.length * 3);
  idx.forEach((i, n) => {
    let sx = 0, sy = 0, sz = 0;
    for (const j of idx) {
      const d2 = (P[i * 3] - P[j * 3]) ** 2 + (P[i * 3 + 1] - P[j * 3 + 1]) ** 2 + (P[i * 3 + 2] - P[j * 3 + 2]) ** 2;
      if (d2 > R2 || N[i * 3] * N[j * 3] + N[i * 3 + 1] * N[j * 3 + 1] + N[i * 3 + 2] * N[j * 3 + 2] < 0.2) continue;
      const w = Math.exp(-d2 / S2);
      sx += N[j * 3] * w;
      sy += N[j * 3 + 1] * w;
      sz += N[j * 3 + 2] * w;
    }
    const l = Math.hypot(sx, sy, sz) || 1;
    next.set([sx / l, sy / l, sz / l], n * 3);
  });
  idx.forEach((i, n) => N.set(next.subarray(n * 3, n * 3 + 3), i * 3));
}

/** How far along a ray (from o, direction u, in a horizontal section) an ellipse's far side is; 0 if it misses. */
export function rayEllipse(ox: number, oz: number, ux: number, uz: number, cx: number, cz: number, a: number, b: number): number {
  const px = ox - cx, pz = oz - cz;
  const A = (ux / a) ** 2 + (uz / b) ** 2;
  const B = 2 * ((px * ux) / (a * a) + (pz * uz) / (b * b));
  const C = (px / a) ** 2 + (pz / b) ** 2 - 1;
  const D = B * B - 4 * A * C;
  return D < 0 ? 0 : Math.max(0, (-B + Math.sqrt(D)) / (2 * A));
}
/** The larger of two, rounded over where they're within k of one another. */
export function smoothMax(a: number, b: number, k: number): number {
  const h = clamp01(0.5 + (0.5 * (a - b)) / k);
  return b + (a - b) * h + k * h * (1 - h);
}

/**
 * A loft through horizontal rings with its points at the given angles round each (from +x; pi/2 is the front), so a
 * torso can have them close together across the chest, where its form is, and few round the back.
 */
export function loftAt(tb: TemplateBuilder, rows: readonly Row[], angles: readonly number[], weight: (r: Row) => Weight, shade: number, n: number): void {
  const start = tb.pos.length / 3;
  const e = 2 / n;
  const se = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), e);
  const m = angles.length;
  for (const r of rows) {
    const [b0, b1, w] = weight(r);
    for (const t of angles) {
      tb.pos.push(r[1] * se(Math.cos(t)), r[0], r[3] + r[2] * se(Math.sin(t)));
      tb.b0.push(b0);
      tb.b1.push(b1);
      tb.w.push(w);
      tb.shade.push(shade);
    }
  }
  for (let k = 0; k + 1 < rows.length; k++) {
    for (let j = 0; j < m; j++) {
      const a = start + k * m + j, b = start + k * m + ((j + 1) % m), c = start + (k + 1) * m + ((j + 1) % m), d = start + (k + 1) * m + j;
      tb.idx.push(a, c, b, a, d, c);
    }
  }
}

/** Rows with one more between each pair (Catmull-Rom through the sections), so a silhouette curves. */
export function smooth(rows: readonly Row[]): Row[] {
  const out: Row[] = [];
  const at = (i: number): Row => rows[Math.min(rows.length - 1, Math.max(0, i))];
  for (let i = 0; i + 1 < rows.length; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    out.push(p1);
    const c = (k: number): number => 0.5 * (p1[k] + p2[k]) + (p1[k] + p2[k] - p0[k] - p3[k]) / 16;
    out.push([0.5 * (p1[0] + p2[0]), Math.max(0.002, c(1)), Math.max(0.002, c(2)), c(3)]);
  }
  out.push(rows[rows.length - 1]);
  return out;
}

/** The section at a height: half width, half depth, centre z. */
export function rowAt(rows: readonly Row[], y: number): [number, number, number] {
  let i = 0;
  while (i < rows.length - 2 && rows[i + 1][0] < y) i++;
  const a = rows[i], b = rows[i + 1];
  const k = Math.min(1, Math.max(0, (y - a[0]) / (b[0] - a[0])));
  return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
}

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
/** A value by a table of [x, value], linear between. */
export function table(t: readonly (readonly [number, number])[], x: number): number {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 0; i + 1 < t.length; i++) {
    if (x <= t[i + 1][0]) return t[i][1] + ((t[i + 1][1] - t[i][1]) * (x - t[i][0])) / (t[i + 1][0] - t[i][0]);
  }
  return t[t.length - 1][1];
}
