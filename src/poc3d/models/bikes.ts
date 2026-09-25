import { EMIT, KIND, lin, type MeshBuilder } from '../real/meshBuilder';
import { signBox } from '../real/signs';
import { DELIVERY_TEXT, wheel, type VehicleSigns, type VehicleSpec } from './vehicles';

/**
 * Two-wheelers, in the same smooth low-poly style as the cars: bodies from ellipsoids and tubes with smooth
 * normals, the cars' turned wheels at bike width.
 * - scooter: a Japanese 50cc step-through (leg shield, rounded rear body, floorboard);
 * - motorcycle: a naked 250 (tank, forks, engine, rising exhaust, tail cowl);
 * - delivery: a sturdy step-through with a front basket and an insulated delivery box on the rack.
 */
export type BikeType = 'scooter' | 'motorcycle' | 'delivery';
export const BIKE_LENGTH = 1.9;

type V3 = [number, number, number];

export function addBike(mb: MeshBuilder, spec: VehicleSpec & { type: BikeType }, signs?: VehicleSigns): void {
  const f: V3 = [spec.fx, 0, spec.fz];
  const s: V3 = [spec.fz, 0, -spec.fx];
  const P = (x: number, y: number, z: number): V3 => [spec.x + f[0] * x + s[0] * z, y, spec.z + f[2] * x + s[2] * z];
  const N = (n: V3): V3 => [f[0] * n[0] + s[0] * n[2], n[1], f[2] * n[0] + s[2] * n[2]];
  const paint = lin(spec.paint);
  const BLACK: V3 = [0.012, 0.012, 0.014];
  const CHROME: V3 = [0.82, 0.83, 0.86];
  const METAL: V3 = [0.05, 0.05, 0.055];

  /** Smooth ellipsoid in the bike frame. */
  const blob = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, seg = 10, lat = 6): void => {
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
        const a = pt(i, k), b = pt(i + 1, k), c = pt(i + 1, k + 1), d = pt(i, k + 1);
        mb.quadN(a.p, b.p, c.p, d.p, a.n, b.n, c.n, d.n);
      }
    }
  };
  /** Smooth tube between two points in the bike frame (open ends). */
  const tube = (a: V3, b: V3, r: number, seg = 7): void => {
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(...d) || 1e-4;
    const dn: V3 = [d[0] / L, d[1] / L, d[2] / L];
    const ref: V3 = Math.abs(dn[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let u: V3 = [dn[1] * ref[2] - dn[2] * ref[1], dn[2] * ref[0] - dn[0] * ref[2], dn[0] * ref[1] - dn[1] * ref[0]];
    const ul = Math.hypot(...u);
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const w: V3 = [dn[1] * u[2] - dn[2] * u[1], dn[2] * u[0] - dn[0] * u[2], dn[0] * u[1] - dn[1] * u[0]];
    const ring = (c: V3, i: number): { p: V3; n: V3 } => {
      const t = (i / seg) * Math.PI * 2;
      const n: V3 = [u[0] * Math.cos(t) + w[0] * Math.sin(t), u[1] * Math.cos(t) + w[1] * Math.sin(t), u[2] * Math.cos(t) + w[2] * Math.sin(t)];
      return { p: P(c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r), n: N(n) };
    };
    for (let i = 0; i < seg; i++) {
      const p0 = ring(a, i), p1 = ring(a, i + 1), p2 = ring(b, i + 1), p3 = ring(b, i);
      mb.quadN(p0.p, p1.p, p2.p, p3.p, p0.n, p1.n, p2.n, p3.n);
    }
  };
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void => {
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
      mb.quadN(P(...q[0]), P(...q[1]), P(...q[2]), P(...q[3]), nw, nw, nw, nw);
    }
  };
  const set = (kind: number, color: V3, emit = -1): void => {
    mb.kind = kind;
    mb.color = color;
    mb.style = [emit < 0 ? 0 : emit, 0, 0, 0];
  };
  const wheels = (xs: readonly number[], r: number, w: number, rims: 'alloy' | 'steel'): void => {
    for (const wx of xs) {
      wheel(mb, P, N, wx, r, w / 2, w / 2, 1, rims);
      wheel(mb, P, N, wx, r, w / 2, -w / 2, -1, rims);
    }
  };
  const lamps = (hx: number, hy: number, tx: number, ty: number): void => {
    set(KIND.emit, [0.95, 0.9, 0.8], EMIT.lamp);
    blob(hx, hy, 0, 0.03, 0.055, 0.07, 8, 4);
    set(KIND.emit, [0.14, 0.004, 0.004], EMIT.always);
    blob(tx, ty, 0, 0.025, 0.035, 0.07, 8, 4);
    set(KIND.emit, [0.3, 0.006, 0.004], EMIT.lamp);
    blob(tx - 0.004, ty, 0, 0.022, 0.028, 0.055, 8, 4);
  };

  if (spec.type === 'motorcycle') {
    wheels([-0.7, 0.72], 0.3, 0.13, 'alloy');
    // Front: forks, headlight in a chrome bucket, bars and mirrors.
    set(KIND.chrome, CHROME);
    for (const z of [-0.1, 0.1]) tube([0.72, 0.3, z], [0.5, 0.98, z], 0.022);
    blob(0.52, 1.0, 0, 0.07, 0.085, 0.085);
    set(KIND.gloss, BLACK);
    tube([0.36, 1.1, -0.36], [0.36, 1.1, 0.36], 0.013);
    tube([0.44, 1.02, 0], [0.36, 1.1, 0], 0.02);
    for (const z of [-0.3, 0.3]) {
      tube([0.36, 1.1, z], [0.33, 1.3, z * 1.1], 0.007);
      blob(0.33, 1.32, z * 1.1, 0.02, 0.035, 0.05, 8, 4);
    }
    // Tank, seat, tail cowl.
    set(KIND.gloss, paint);
    blob(0.12, 0.93, 0, 0.3, 0.12, 0.17);
    blob(-0.62, 0.86, 0, 0.2, 0.065, 0.1);
    set(KIND.gloss, BLACK);
    blob(-0.3, 0.88, 0, 0.32, 0.06, 0.14);
    // Engine with cooling fins, frame, swingarm, shocks, exhaust.
    set(KIND.gloss, METAL);
    box(-0.15, 0.25, 0.3, 0.62, -0.15, 0.15);
    set(KIND.chrome, [0.6, 0.61, 0.63]);
    for (let i = 0; i < 4; i++) box(0.0 + i * 0.05, 0.02 + i * 0.05, 0.62, 0.8, -0.13, 0.13);
    set(KIND.gloss, BLACK);
    for (const z of [-0.09, 0.09]) {
      tube([0.46, 0.96, z], [-0.1, 0.42, z], 0.02);
      tube([-0.1, 0.42, z], [-0.52, 0.84, z], 0.018);
      tube([-0.05, 0.38, z], [-0.7, 0.3, z * 1.2], 0.022);
    }
    set(KIND.chrome, CHROME);
    for (const z of [-0.12, 0.12]) tube([-0.6, 0.34, z], [-0.44, 0.84, z], 0.022);
    tube([0.22, 0.36, 0.14], [-0.25, 0.3, 0.17], 0.04);
    tube([-0.25, 0.3, 0.17], [-0.9, 0.48, 0.17], 0.045);
    // Fenders.
    set(KIND.gloss, paint);
    blob(0.74, 0.62, 0, 0.22, 0.05, 0.08, 8, 4);
    set(KIND.gloss, BLACK);
    blob(-0.76, 0.6, 0, 0.16, 0.05, 0.08, 8, 4);
    lamps(0.59, 1.0, -0.82, 0.84);
    return;
  }

  // Step-through scooter (the delivery bike is a sturdier one with luggage).
  const delivery = spec.type === 'delivery';
  wheels([-0.62, 0.62], delivery ? 0.28 : 0.24, 0.1, 'steel');
  set(KIND.gloss, paint);
  blob(-0.38, delivery ? 0.55 : 0.58, 0, 0.5, 0.25, 0.2);
  blob(0.42, 0.62, 0, 0.12, 0.34, 0.2);
  blob(0.62, delivery ? 0.56 : 0.52, 0, 0.26, 0.07, 0.1, 8, 4);
  blob(0.42, 1.02, 0, 0.11, 0.08, 0.2);
  set(KIND.gloss, BLACK);
  box(-0.15, 0.32, 0.26, 0.33, -0.16, 0.16);
  blob(delivery ? -0.2 : -0.3, 0.84, 0, delivery ? 0.26 : 0.34, 0.07, 0.16);
  tube([0.5, 0.4, 0], [0.4, 1.0, 0], 0.025);
  tube([0.4, 1.02, -0.34], [0.4, 1.02, 0.34], 0.017);
  for (const z of [-0.28, 0.28]) {
    tube([0.4, 1.02, z], [0.36, 1.25, z * 1.12], 0.007);
    blob(0.36, 1.27, z * 1.12, 0.02, 0.035, 0.05, 8, 4);
  }
  lamps(0.53, 1.0, -0.88, 0.62);
  if (delivery) {
    // Front wire basket.
    set(KIND.chrome, [0.55, 0.56, 0.58]);
    box(0.52, 0.8, 0.84, 0.86, -0.17, 0.17);
    for (const [x0, x1, z0, z1] of [[0.52, 0.8, -0.17, -0.16], [0.52, 0.8, 0.16, 0.17], [0.79, 0.8, -0.17, 0.17], [0.52, 0.53, -0.17, 0.17]] as const) box(x0, x1, 0.86, 1.06, z0, z1);
    // Rear rack and the insulated delivery box, lettered on both sides.
    set(KIND.gloss, BLACK);
    box(-0.95, -0.35, 0.86, 0.9, -0.2, 0.2);
    for (const x of [-0.9, -0.4]) tube([x, 0.58, 0], [x, 0.87, 0], 0.015);
    const boxColor = lin(spec.paint2 ?? 0xf2f0e8);
    set(KIND.gloss, boxColor);
    box(-0.98, -0.32, 0.9, 1.36, -0.24, 0.24);
    set(KIND.gloss, paint);
    box(-0.985, -0.315, 1.3, 1.365, -0.245, 0.245);
    const rect = signs?.layout.rect(DELIVERY_TEXT, false);
    if (signs && rect) {
      signs.sb.ink = lin(spec.paint);
      signs.sb.plate = boxColor;
      signs.sb.sign = [0, 2];
      const len = 0.6;
      const h = Math.min(0.3, len * (rect.h / rect.w) * 1.2);
      for (const sd of [-1, 1]) {
        const n: V3 = [s[0] * sd, 0, s[2] * sd];
        const r: V3 = [n[2], 0, -n[0]];
        signBox(signs.sb, P(-0.65, 0, 0), r, n, -len / 2, len / 2, 1.1 - h / 2, 1.1 + h / 2, 0.241, 0.243, signs.layout.blankUv, { n: [rect.u0, rect.v0, rect.u1, rect.v1] });
      }
    }
  } else {
    // Small rear carrier.
    set(KIND.gloss, BLACK);
    box(-0.82, -0.55, 0.84, 0.87, -0.14, 0.14);
  }
}
