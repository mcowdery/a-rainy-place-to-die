import { EMIT, KIND, lin, type MeshBuilder } from '../real/meshBuilder';
import { addBike } from './bikes';
import { wheel } from './vehicles';

/**
 * The Manila tricycle: a 125 cc motorcycle (bikes.ts' naked 250, ridden on the right of the pair) with a steel sidecar on its
 * left, the kerb side in left-hand traffic. The sidecar: a painted tub with a rounded nose, a bench and a backrest, chrome poles
 * and a long arched canopy over the passenger with a valance round its edge, a slanted windscreen, a louvred rear curtain, a
 * chrome bumper, a mudguard over its own wheel, and the operator's number (the TODA's, a two-digit code in seven-segment
 * figures on its flank) with a plate behind. On the bike a driver in a cap (faceless, like the mob). Three wheels: the bike's
 * two and the sidecar's, drawn apart by traffic (`TRICYCLE_WHEELS`, `wheelLayout`) or in the body (`wheels` not false).
 *
 * In the vehicle's frame, centred on the pair: x forward, z to the left, y up.
 */
export interface TricycleSpec {
  readonly x: number;
  readonly z: number;
  /** Unit vector it points along. */
  readonly fx: number;
  readonly fz: number;
  /** The motorcycle's tank and the sidecar's tub. */
  readonly paint: number;
  /** The sidecar's roof and the stripe on its side. */
  readonly paint2?: number;
  /** Station spacing as for cars: from 0.2 the shapes are coarser and the wheels simple. */
  readonly detail?: number;
  /** false: no wheels (traffic draws them apart). */
  readonly wheels?: boolean;
  /** false: parked: no driver, the lamps off. */
  readonly lamps?: boolean;
  /** Seeds the operator's number and the driver's shirt. */
  readonly marks?: number;
  /** The brake lights, into a builder of their own (traffic shows it while braking). */
  readonly brake?: MeshBuilder;
}
/** Length (m), and half the width across bike and sidecar. */
export const TRICYCLE_LENGTH = 2.2;
export const TRICYCLE_WIDTH = 0.95;
/** Where the motorcycle's middle runs, and the sidecar tub's. */
const BIKE_Z = -0.55;
const TUB_Z = 0.26;
/** Wheel radius and thickness (all three), and the three hubs in the frame (x forward, z left). */
export const TRICYCLE_WHEELS = {
  r: 0.3,
  tw: 0.14,
  spots: [
    { x: 0.72, z: BIKE_Z, front: true },
    { x: -0.7, z: BIKE_Z, front: false },
    { x: -0.3, z: 0.86, front: false },
  ],
} as const;

type V3 = [number, number, number];

/** Seven-segment figures: which of a, b, c, d, e, f, g are lit. */
const SEGMENTS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcfgd'];

/** A tricycle's colour pairs: the tub and bike, then the canopy and its trim. */
export const TRICYCLE_ACCENT: Readonly<Record<number, number>> = {
  0xc81818: 0xe8c020,
  0x1c5aa8: 0xf0f0ec,
  0xe8c020: 0x1c5aa8,
  0x2a8a4a: 0xe8c020,
  0xf0f0ec: 0xc81818,
  0xe86a1a: 0x1c5aa8,
};

export function addTricycle(mb: MeshBuilder, spec: TricycleSpec): void {
  const f: V3 = [spec.fx, 0, spec.fz];
  const s: V3 = [spec.fz, 0, -spec.fx];
  const P = (x: number, y: number, z: number): V3 => [spec.x + f[0] * x + s[0] * z, y, spec.z + f[2] * x + s[2] * z];
  const N = (n: V3): V3 => [f[0] * n[0] + s[0] * n[2], n[1], f[2] * n[0] + s[2] * n[2]];
  const coarse = (spec.detail ?? 0.05) >= 0.2;
  const seed = spec.marks ?? 7;
  const paint = lin(spec.paint);
  const paint2 = lin(spec.paint2 ?? TRICYCLE_ACCENT[spec.paint] ?? 0xe8e8e4);
  const BLACK: V3 = [0.012, 0.012, 0.014];
  const CHROME: V3 = [0.82, 0.83, 0.86];
  const VINYL: V3 = lin(0x1a1c22);

  const set = (kind: number, color: V3, emit = 0): void => {
    mb.kind = kind;
    mb.color = color;
    mb.style = [emit, 0, 0, 0];
  };
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, into: MeshBuilder = mb): void => {
    const faces: [V3, V3[]][] = [
      [[1, 0, 0], [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]]],
      [[-1, 0, 0], [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]]],
      [[0, 1, 0], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]],
      [[0, -1, 0], [[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]]],
      [[0, 0, 1], [[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]]],
      [[0, 0, -1], [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]]],
    ];
    for (const [n, q] of faces) {
      const nw = N(n);
      into.quadN(P(...q[0]), P(...q[1]), P(...q[2]), P(...q[3]), nw, nw, nw, nw);
    }
  };
  const blob = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, seg = 12, lat = 7): void => {
    if (coarse) {
      seg = Math.max(6, seg >> 1);
      lat = Math.max(3, lat >> 1);
    }
    const pt = (i: number, k: number): { p: V3; n: V3 } => {
      const ph = -Math.PI / 2 + (k / lat) * Math.PI;
      const t = (i / seg) * Math.PI * 2;
      const lx = Math.cos(ph) * Math.cos(t);
      const lz = Math.cos(ph) * Math.sin(t);
      const ly = Math.sin(ph);
      return { p: P(cx + lx * rx, cy + ly * ry, cz + lz * rz), n: N([lx / rx, ly / ry, lz / rz]) };
    };
    for (let k = 0; k < lat; k++) {
      for (let i = 0; i < seg; i++) {
        const a = pt(i, k), b = pt(i + 1, k), c = pt(i + 1, k + 1), e = pt(i, k + 1);
        mb.quadN(a.p, b.p, c.p, e.p, a.n, b.n, c.n, e.n);
      }
    }
  };
  const tube = (a: V3, b: V3, t: number): void => mb.beam(P(...a), P(...b), t);

  // The motorcycle: wheels apart (below), on the right of the pair.
  addBike(mb, { x: spec.x + s[0] * BIKE_Z, z: spec.z + s[2] * BIKE_Z, fx: spec.fx, fz: spec.fz, type: 'motorcycle', paint: spec.paint, detail: spec.detail, wheels: false, lamps: spec.lamps });

  // The sidecar's frame: rails under the tub, struts across to the motorcycle's frame, the axle to the wheel.
  set(KIND.plain, BLACK);
  box(-0.7, 0.55, 0.26, 0.3, TUB_Z - 0.46, TUB_Z + 0.46);
  for (const x of [-0.5, 0.2]) tube([x, 0.34, -0.28], [x * 0.9, 0.44, BIKE_Z + 0.08], 0.022);
  tube([-0.3, 0.3, TUB_Z + 0.3], [-0.3, 0.3, 0.84], 0.02);
  tube([0.52, 0.32, TUB_Z], [0.62, 0.55, -0.3], 0.018);

  // The tub: the floor, the sides and the back (painted, a low door-less wall), the rounded nose over the front.
  set(KIND.gloss, paint);
  box(-0.66, 0.32, 0.3, 0.8, TUB_Z - 0.47, TUB_Z - 0.43);
  box(-0.66, 0.32, 0.3, 0.8, TUB_Z + 0.43, TUB_Z + 0.47);
  box(-0.7, -0.64, 0.3, 0.84, TUB_Z - 0.47, TUB_Z + 0.47);
  blob(0.34, 0.54, TUB_Z, 0.5, 0.26, 0.47, 14, 8);
  set(KIND.plain, BLACK);
  box(-0.64, 0.4, 0.28, 0.34, TUB_Z - 0.43, TUB_Z + 0.43);
  // The nose's hood over the bonnet-like front, and a stripe along the flank in the second colour.
  set(KIND.gloss, paint2);
  box(-0.66, 0.34, 0.5, 0.58, TUB_Z + 0.468, TUB_Z + 0.478);
  box(-0.66, 0.34, 0.5, 0.58, TUB_Z - 0.478, TUB_Z - 0.468);
  // The bench and its back (vinyl).
  set(KIND.gloss, lin(0x5a1a1a));
  box(-0.6, -0.08, 0.34, 0.48, TUB_Z - 0.4, TUB_Z + 0.4);
  box(-0.64, -0.58, 0.48, 0.98, TUB_Z - 0.4, TUB_Z + 0.4);
  // Chrome trim: the rail round the tub's top and the bumper across its nose.
  set(KIND.chrome, CHROME);
  tube([-0.7, 0.84, TUB_Z + 0.47], [0.3, 0.8, TUB_Z + 0.47], 0.012);
  tube([-0.7, 0.84, TUB_Z - 0.47], [0.3, 0.8, TUB_Z - 0.47], 0.012);
  tube([0.76, 0.4, TUB_Z - 0.4], [0.84, 0.4, TUB_Z], 0.016);
  tube([0.84, 0.4, TUB_Z], [0.76, 0.4, TUB_Z + 0.42], 0.016);
  tube([0.76, 0.4, TUB_Z - 0.4], [0.52, 0.3, TUB_Z - 0.4], 0.014);
  tube([0.76, 0.4, TUB_Z + 0.42], [0.52, 0.3, TUB_Z + 0.42], 0.014);

  // The poles: front ones leaning back with the windscreen, rear ones upright, to the canopy.
  for (const z of [TUB_Z - 0.46, TUB_Z + 0.46]) {
    tube([0.4, 0.72, z], [0.3, 1.36, z], 0.013);
    tube([-0.66, 0.84, z], [-0.66, 1.4, z], 0.013);
  }
  // The windscreen: a slanted pane between the front poles.
  set(KIND.glass, [0.012, 0.014, 0.018]);
  mb.quadN(P(0.4, 0.76, TUB_Z - 0.45), P(0.4, 0.76, TUB_Z + 0.45), P(0.31, 1.32, TUB_Z + 0.45), P(0.31, 1.32, TUB_Z - 0.45), N([1, 0.2, 0]), N([1, 0.2, 0]), N([1, 0.2, 0]), N([1, 0.2, 0]));
  set(KIND.chrome, CHROME);
  tube([0.4, 0.76, TUB_Z - 0.45], [0.4, 0.76, TUB_Z + 0.45], 0.013);
  tube([0.31, 1.32, TUB_Z - 0.45], [0.31, 1.32, TUB_Z + 0.45], 0.013);

  // The canopy: an arched roof over the passenger (rises to the middle and sags at its edges), thin, with the underside dark.
  {
    const xs = [0.56, 0.42, 0.22, -0.05, -0.32, -0.55, -0.74];
    const hs = [1.3, 1.4, 1.47, 1.5, 1.49, 1.45, 1.38];
    const nz = coarse ? 4 : 8;
    const hw = 0.58;
    const at = (i: number, j: number): V3 => {
      const t = (j / nz) * 2 - 1;
      return P(xs[i], hs[i] - 0.13 * t * t, TUB_Z + t * hw);
    };
    const upN = (i: number, j: number): V3 => {
      const t = (j / nz) * 2 - 1;
      const dh = (hs[Math.min(i + 1, xs.length - 1)] - hs[Math.max(i - 1, 0)]) / (xs[Math.min(i + 1, xs.length - 1)] - xs[Math.max(i - 1, 0)]);
      return N([-dh, 1, (0.26 * t) / hw]);
    };
    for (let i = 0; i + 1 < xs.length; i++) {
      for (let j = 0; j < nz; j++) {
        set(KIND.gloss, paint2);
        mb.quadN(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), upN(i, j), upN(i + 1, j), upN(i + 1, j + 1), upN(i, j + 1));
        set(KIND.plain, lin(0xcfc8b4));
        const lo = (a: V3): V3 => [a[0], a[1] - 0.03, a[2]];
        const dn = (a: V3): V3 => [-a[0], -a[1], -a[2]];
        mb.quadN(lo(at(i, j)), lo(at(i + 1, j)), lo(at(i + 1, j + 1)), lo(at(i, j + 1)), dn(upN(i, j)), dn(upN(i + 1, j)), dn(upN(i + 1, j + 1)), dn(upN(i, j + 1)));
      }
    }
    // The rolled lip along the front edge and a valance of the trim colour hanging round the sides and front.
    set(KIND.chrome, CHROME);
    for (let j = 0; j < nz; j++) mb.beam(at(0, j), at(0, j + 1), 0.014);
    set(KIND.gloss, paint);
    for (let i = 0; i + 1 < xs.length; i++) {
      for (const j of [0, nz]) {
        const a = at(i, j), b = at(i + 1, j);
        const n = N([0, 0, j === 0 ? -1 : 1]);
        mb.quadN(a, b, [b[0], b[1] - 0.1, b[2]], [a[0], a[1] - 0.1, a[2]], n, n, n, n);
      }
    }
    for (let j = 0; j < nz; j++) {
      const a = at(0, j), b = at(0, j + 1);
      const n = N([1, 0, 0]);
      mb.quadN(a, b, [b[0], b[1] - 0.1, b[2]], [a[0], a[1] - 0.1, a[2]], n, n, n, n);
    }
  }
  // The rear curtain: vinyl from the roof's edge down to the back's top, with louvres (slats) across its middle and a pane.
  set(KIND.plain, VINYL);
  box(-0.74, -0.7, 1.12, 1.34, TUB_Z - 0.47, TUB_Z + 0.47);
  set(KIND.chrome, [0.62, 0.64, 0.68]);
  for (let k = 0; k < 4; k++) box(-0.78, -0.72, 0.88 + k * 0.06, 0.9 + k * 0.06, TUB_Z - 0.44, TUB_Z + 0.44);

  // The sidecar's wheel, with a mudguard over it; the number on the flank; the plate and lamp behind.
  if (spec.wheels !== false) {
    const [{ r, tw }, , side] = [TRICYCLE_WHEELS, 0, TRICYCLE_WHEELS.spots[2]];
    wheel(mb, P, N, side.x, r, tw, side.z + tw / 2, 1, 'steel', coarse);
    for (const sp of TRICYCLE_WHEELS.spots.slice(0, 2)) {
      wheel(mb, P, N, sp.x, r, tw / 2, sp.z + tw / 4, 1, 'alloy', coarse);
      wheel(mb, P, N, sp.x, r, tw / 2, sp.z - tw / 4, -1, 'alloy', coarse);
    }
  }
  set(KIND.gloss, paint);
  blob(-0.3, 0.6, 0.86, 0.36, 0.05, 0.12, 10, 4);
  {
    // Two figures on a patch of the trim colour.
    const n0 = (seed * 7 + 3) % 10;
    const n1 = (seed * 3 + 1) % 10;
    set(KIND.plain, lin(0xeeeee6));
    box(-0.52, 0.0, 0.52, 0.74, TUB_Z + 0.478, TUB_Z + 0.482);
    set(KIND.plain, lin(0x14161a));
    const fig = (digit: number, xr: number): void => {
      const segs = SEGMENTS[digit];
      const w = 0.09;
      const h = 0.085;
      const t = 0.014;
      const y0 = 0.55;
      const z = TUB_Z + 0.482;
      // (Read from the left, the forward end is on the right hand's side: the figures run toward the back.)
      const on = (c: string): boolean => segs.includes(c);
      if (on('a')) box(xr - w, xr, y0 + 2 * h - t, y0 + 2 * h, z, z + 0.004);
      if (on('g')) box(xr - w, xr, y0 + h - t / 2, y0 + h + t / 2, z, z + 0.004);
      if (on('d')) box(xr - w, xr, y0, y0 + t, z, z + 0.004);
      if (on('b')) box(xr - t, xr, y0 + h, y0 + 2 * h, z, z + 0.004);
      if (on('c')) box(xr - t, xr, y0, y0 + h, z, z + 0.004);
      if (on('f')) box(xr - w, xr - w + t, y0 + h, y0 + 2 * h, z, z + 0.004);
      if (on('e')) box(xr - w, xr - w + t, y0, y0 + h, z, z + 0.004);
    };
    fig(n0, -0.18);
    fig(n1, -0.34);
    // The plate on the back, white with dark edges, and a tail lamp on each side of it.
    set(KIND.plain, lin(0xeeeee6));
    box(-0.76, -0.74, 0.5, 0.62, TUB_Z - 0.12, TUB_Z + 0.12);
    set(KIND.emit, [0.14, 0.004, 0.004], EMIT.always);
    box(-0.77, -0.74, 0.6, 0.68, TUB_Z + 0.3, TUB_Z + 0.42);
    set(KIND.emit, [0.3, 0.006, 0.004], spec.lamps === false ? 0 : EMIT.lamp);
    if (spec.lamps !== false) box(-0.775, -0.745, 0.62, 0.66, TUB_Z + 0.32, TUB_Z + 0.4);
    if (spec.brake) {
      spec.brake.kind = KIND.plain;
      box(-0.79, -0.77, 0.6, 0.68, TUB_Z + 0.3, TUB_Z + 0.42, spec.brake);
    }
    // The headlamp on the nose.
    set(KIND.emit, [0.95, 0.9, 0.8], spec.lamps === false ? 0 : EMIT.lamp);
    blob(0.8, 0.6, TUB_Z, 0.04, 0.05, 0.08, 8, 4);
  }

  // The driver, seated on the bike: a shirt, trousers, a cap; hands on the bars, feet on the pegs.
  if (spec.lamps !== false) {
    const SHIRTS = [0x2a4a7a, 0x8a2a2a, 0x3a6a4a, 0xc8c2b0, 0x6a5a3a, 0x1a1a22];
    const shirt = lin(SHIRTS[(seed * 5 + 2) % SHIRTS.length]);
    const skin = lin(0x8a5a3a);
    set(KIND.plain, lin(0x22262e));
    for (const dz of [-0.16, 0.16]) {
      tube([-0.3, 0.95, BIKE_Z + dz], [0.2, 0.9, BIKE_Z + dz * 1.1], 0.06);
      tube([0.2, 0.9, BIKE_Z + dz * 1.1], [0.1, 0.4, BIKE_Z + dz * 1.2], 0.045);
    }
    set(KIND.plain, shirt);
    blob(-0.24, 1.3, BIKE_Z, 0.17, 0.3, 0.21, 10, 6);
    for (const dz of [-0.26, 0.26]) tube([-0.18, 1.45, BIKE_Z + dz], [0.34, 1.1, BIKE_Z + dz * 1.4], 0.04);
    set(KIND.plain, skin);
    blob(-0.12, 1.72, BIKE_Z, 0.1, 0.12, 0.1, 8, 5);
    for (const dz of [-0.36, 0.36]) blob(0.36, 1.1, BIKE_Z + dz, 0.04, 0.04, 0.04, 6, 4);
    set(KIND.plain, lin(0x14161a));
    blob(-0.1, 1.82, BIKE_Z, 0.11, 0.04, 0.1, 8, 4);
    box(-0.02, 0.1, 1.79, 1.81, BIKE_Z - 0.07, BIKE_Z + 0.07);
  }
}

