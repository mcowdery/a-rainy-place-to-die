import { hash, rng } from '../../core/hash';
import { EMIT, KIND, lin, type MeshBuilder } from './meshBuilder';

/**
 * Parked cars built from side profiles: the silhouette (bumpers, bonnet, windscreen, roof, rear window,
 * boot) is extruded across the car's width with tumblehome (the glasshouse narrows towards the roof), the
 * windscreen and rear window strips are glass, side windows are glass panels split by pillars, and the
 * wheels are real cylinders with hubcaps. Types: sedan, kei car (tall and short, yellow plates), minivan,
 * and taxi (with a roof lamp).
 */

type V3 = [number, number, number];
type P2 = readonly [number, number];

interface CarType {
  readonly name: 'sedan' | 'kei' | 'minivan' | 'taxi';
  /** Side profile from the rear bottom, over the top, to the front bottom (x along the car, y up). */
  readonly profile: readonly P2[];
  /** Profile segments (index of the start point) that are glass. */
  readonly glass: readonly number[];
  /** Side windows as polygons in (x, y). */
  readonly windows: readonly (readonly P2[])[];
  /** Half-width at the beltline, and at the roof. */
  readonly halfW: number;
  readonly roofW: number;
  readonly belt: number;
  readonly roofY: number;
  readonly wheelX: readonly [number, number];
  readonly wheelR: number;
  /** Segment carrying the headlights and the one carrying tail lights. */
  readonly head: number;
  readonly tail: number;
}

const SEDAN: CarType = {
  name: 'sedan',
  profile: [[-2.35, 0.3], [-2.38, 0.62], [-2.3, 0.88], [-2.1, 0.95], [-1.35, 0.98], [-0.85, 1.4], [0.4, 1.44], [1.15, 1.0], [2.05, 0.86], [2.33, 0.72], [2.36, 0.3]],
  glass: [4, 6],
  windows: [
    [[-1.22, 1.0], [-0.12, 1.0], [-0.12, 1.37], [-0.82, 1.36]],
    [[-0.02, 1.0], [1.02, 1.0], [0.38, 1.39], [-0.02, 1.39]],
  ],
  halfW: 0.86,
  roofW: 0.66,
  belt: 0.97,
  roofY: 1.44,
  wheelX: [-1.42, 1.45],
  wheelR: 0.32,
  head: 8,
  tail: 1,
};

const TAXI: CarType = {
  ...SEDAN,
  name: 'taxi',
  profile: [[-2.35, 0.3], [-2.38, 0.62], [-2.32, 0.9], [-2.0, 0.96], [-1.25, 1.0], [-0.8, 1.47], [0.45, 1.49], [1.1, 1.02], [2.1, 0.9], [2.34, 0.72], [2.36, 0.3]],
  windows: [
    [[-1.12, 1.02], [-0.12, 1.02], [-0.12, 1.42], [-0.76, 1.42]],
    [[-0.02, 1.02], [0.98, 1.02], [0.42, 1.44], [-0.02, 1.44]],
  ],
  roofY: 1.49,
};

const KEI: CarType = {
  name: 'kei',
  profile: [[-1.7, 0.28], [-1.72, 0.7], [-1.71, 1.05], [-1.68, 1.55], [-1.55, 1.66], [0.85, 1.66], [1.35, 1.02], [1.66, 0.86], [1.7, 0.28]],
  glass: [2, 5],
  windows: [
    [[-1.52, 1.08], [-0.35, 1.08], [-0.35, 1.56], [-1.48, 1.56]],
    [[-0.25, 1.08], [1.22, 1.08], [0.8, 1.58], [-0.25, 1.58]],
  ],
  halfW: 0.74,
  roofW: 0.66,
  belt: 1.05,
  roofY: 1.66,
  wheelX: [-1.12, 1.15],
  wheelR: 0.28,
  head: 7,
  tail: 1,
};

const MINIVAN: CarType = {
  name: 'minivan',
  profile: [[-2.35, 0.3], [-2.38, 0.7], [-2.33, 1.1], [-2.25, 1.75], [-2.05, 1.85], [1.0, 1.85], [1.75, 1.1], [2.25, 0.9], [2.36, 0.7], [2.36, 0.3]],
  glass: [2, 5],
  windows: [
    [[-2.12, 1.12], [-0.95, 1.12], [-0.95, 1.74], [-2.06, 1.74]],
    [[-0.85, 1.12], [0.15, 1.12], [0.15, 1.76], [-0.85, 1.76]],
    [[0.25, 1.12], [1.6, 1.12], [0.97, 1.77], [0.25, 1.77]],
  ],
  halfW: 0.85,
  roofW: 0.72,
  belt: 1.1,
  roofY: 1.85,
  wheelX: [-1.5, 1.5],
  wheelR: 0.33,
  head: 7,
  tail: 1,
};

const PAINTS = [0xe2e2de, 0xe2e2de, 0xe2e2de, 0xd8d3c8, 0xa8aaae, 0xa8aaae, 0x5a5e62, 0x141416, 0x141416, 0x1e2c48, 0x5a1a20, 0x9a1a1a];
const KEI_PAINTS = [0xe2e2de, 0xc8b48c, 0x9ac8b0, 0xd8a8b0, 0xa8aaae, 0x8ab0d0];
const TAXI_PAINTS = [0x141416, 0x1c2438, 0xd89a20, 0x2a6a3a];

export interface CarSpec {
  readonly x: number;
  readonly z: number;
  /** Unit vector along the car (its front). */
  readonly fx: number;
  readonly fz: number;
  readonly variant: number;
  /** Force a type / paint (the model showroom); otherwise both are picked from the variant. */
  readonly type?: CarType['name'];
  readonly paint?: number;
  /** false leaves the wheels off: moving traffic draws them apart so they can turn (`carWheels`). */
  readonly wheels?: boolean;
}

export const CAR_TYPES: readonly CarType['name'][] = ['sedan', 'kei', 'minivan', 'taxi'];
const BY_NAME = { sedan: SEDAN, kei: KEI, minivan: MINIVAN, taxi: TAXI };

/**
 * Where a car type's wheels are, for drawing them apart (to spin and steer): hubs in the car's frame (at the
 * origin pointing +z, +x its left), their size, and the rims (hubcaps on kei cars and taxis).
 */
export function carWheels(type: CarType['name']): { r: number; tw: number; rims: 'alloy' | 'steel'; spots: { x: number; y: number; z: number; front: boolean; sd: 1 | -1 }[] } {
  const t = BY_NAME[type];
  // These bodies have no wheel arches (their sides come down to 0.3 m), so the wheels stand out from the side
  // far enough for the rims to show on it.
  const tw = 0.23;
  const spots = t.wheelX.flatMap((wx) => ([-1, 1] as const).map((sd) => ({ x: sd * (t.halfW + 0.075 - tw / 2), y: t.wheelR, z: wx, front: wx > 0, sd })));
  return { r: t.wheelR, tw, rims: type === 'kei' || type === 'taxi' ? 'steel' : 'alloy', spots };
}

/** Adds a parked car to the builder. */
export function addCar(mb: MeshBuilder, c: CarSpec): void {
  const rnd = rng(hash(c.variant, 0xca5));
  const roll = rnd.float();
  const t = c.type ? BY_NAME[c.type] : roll < 0.4 ? SEDAN : roll < 0.65 ? KEI : roll < 0.85 ? MINIVAN : TAXI;
  const picked = t === KEI ? rnd.pick(KEI_PAINTS) : t === TAXI ? rnd.pick(TAXI_PAINTS) : rnd.pick(PAINTS);
  const paintHex = c.paint ?? picked;
  const paint = lin(paintHex);
  const f: V3 = [c.fx, 0, c.fz];
  const s: V3 = [c.fz, 0, -c.fx]; // across: +s is the car's left... either side, both are built
  const L = (x: number, y: number, z: number): V3 => [c.x + f[0] * x + s[0] * z, y, c.z + f[2] * x + s[2] * z];
  const half = (y: number): number => (y <= t.belt ? t.halfW : t.halfW + (t.roofW - t.halfW) * Math.min(1, (y - t.belt) / (t.roofY - t.belt)));
  const centre = L(0, 0.8, 0);

  /** A face with its winding flipped as needed so the normal points along `out`. */
  const face = (pts: V3[], out: V3): void => {
    const [a, b, d] = [pts[0], pts[1], pts[pts.length - 1]];
    const n: V3 = [(b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]), (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])];
    const flip = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0;
    const q = flip ? [...pts].reverse() : pts;
    mb.poly4(q[0], q[1], q[2], q[3] ?? q[2]);
  };
  const outFrom = (p: V3): V3 => [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];

  // Body shell: strips across the width along every profile edge (the closing edge is the underside).
  const P = t.profile;
  mb.style = [0, 0, 0, 0];
  for (let i = 0; i < P.length; i++) {
    const [x0, y0] = P[i];
    const [x1, y1] = P[(i + 1) % P.length];
    const under = i === P.length - 1;
    const glass = t.glass.includes(i);
    mb.kind = glass ? KIND.glass : under ? KIND.plain : KIND.gloss;
    mb.color = under ? [0.02, 0.02, 0.02] : paint;
    const quad: V3[] = [L(x0, y0, -half(y0)), L(x1, y1, -half(y1)), L(x1, y1, half(y1)), L(x0, y0, half(y0))];
    const mid: V3 = [(quad[0][0] + quad[2][0]) / 2, (quad[0][1] + quad[2][1]) / 2, (quad[0][2] + quad[2][2]) / 2];
    face(quad, outFrom(mid));
  }
  // Sides: fans from the profile's centre, at each point's own half-width.
  const cx = P.reduce((a, p) => a + p[0], 0) / P.length;
  const cy = P.reduce((a, p) => a + p[1], 0) / P.length;
  for (const side of [-1, 1]) {
    const out: V3 = [s[0] * side, 0, s[2] * side];
    mb.kind = KIND.gloss;
    mb.color = paint;
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      const b = P[(i + 1) % P.length];
      face([L(cx, cy, side * half(cy)), L(a[0], a[1], side * half(a[1])), L(b[0], b[1], side * half(b[1]))], out);
    }
    // Side windows, just proud of the body.
    mb.kind = KIND.glass;
    for (const w of t.windows) face(w.map(([x, y]) => L(x, y, side * (half(y) + 0.006))), out);
    // Dark rubbing strip / sill along the bottom.
    mb.kind = KIND.plain;
    mb.color = [0.015, 0.015, 0.015];
    face([L(P[0][0] + 0.1, 0.3, side * (t.halfW + 0.005)), L(P[P.length - 1][0] - 0.1, 0.3, side * (t.halfW + 0.005)), L(P[P.length - 1][0] - 0.1, 0.42, side * (t.halfW + 0.005)), L(P[0][0] + 0.1, 0.42, side * (t.halfW + 0.005))], out);
    // Mirror.
    const mx = t.profile[t.glass[1]][0] + 0.05;
    mb.kind = KIND.gloss;
    mb.color = paint;
    mb.frameBox(L(mx, 0, side * (t.halfW + 0.12)), f, s, -0.08, 0.08, t.belt + 0.02, t.belt + 0.14, -0.08, 0.08);
  }

  // Wheels: tyre tread and sidewall, and a hubcap.
  for (const wx of c.wheels === false ? [] : t.wheelX) {
    for (const side of [-1, 1]) {
      const z0 = side * (t.halfW - 0.22);
      const z1 = side * (t.halfW + 0.01);
      const n = 12;
      const out: V3 = [s[0] * side, 0, s[2] * side];
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        const p = (a: number, r: number, z: number): V3 => L(wx + Math.cos(a) * r, t.wheelR + Math.sin(a) * r, z);
        mb.kind = KIND.plain;
        mb.color = [0.012, 0.012, 0.012];
        const radial: V3 = [f[0] * Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), f[2] * Math.cos((a0 + a1) / 2)];
        face([p(a0, t.wheelR, z0), p(a1, t.wheelR, z0), p(a1, t.wheelR, z1), p(a0, t.wheelR, z1)], radial);
        face([L(wx, t.wheelR, z1), p(a0, t.wheelR, z1), p(a1, t.wheelR, z1)], out);
        mb.kind = KIND.gloss;
        mb.color = [0.45, 0.46, 0.48];
        face([L(wx, t.wheelR, z1 + side * 0.012), p(a0, t.wheelR * 0.62, z1 + side * 0.012), p(a1, t.wheelR * 0.62, z1 + side * 0.012)], out);
      }
    }
  }

  // Lights and plates on the front and rear segments.
  const onSeg = (i: number, u: number, y: number, z: number, off: number): V3 => {
    const [x0, y0] = P[i];
    const [x1, y1] = P[i + 1];
    const k = (y - y0) / (y1 - y0 || 1e-3);
    const x = x0 + (x1 - x0) * Math.max(0, Math.min(1, k)) + u;
    return L(x + Math.sign(x) * off, y, z);
  };
  const lamp = (seg: number, yA: number, yB: number, zA: number, zB: number, front: number): void => {
    const out: V3 = [f[0] * front, 0, f[2] * front];
    face([onSeg(seg, 0, yA, zA, 0.01), onSeg(seg, 0, yA, zB, 0.01), onSeg(seg, 0, yB, zB, 0.01), onSeg(seg, 0, yB, zA, 0.01)], out);
  };
  const [hy0, hy1] = [P[t.head][1] - 0.06, P[t.head][1] - 0.01];
  mb.kind = KIND.gloss;
  mb.color = [0.85, 0.85, 0.82];
  for (const side of [-1, 1]) lamp(t.head, Math.min(hy0, hy1) - 0.08, Math.max(hy0, hy1) - 0.06, side * (t.halfW - 0.1), side * (t.halfW - 0.38), 1);
  mb.kind = KIND.emit;
  mb.style = [EMIT.always, 0, 0, 0];
  mb.color = [0.1, 0.0, 0.0];
  for (const side of [-1, 1]) lamp(t.tail, 0.7, 0.84, side * (t.halfW - 0.06), side * (t.halfW - 0.3), -1);
  mb.style = [0, 0, 0, 0];
  mb.kind = KIND.plain;
  mb.color = t === KEI ? lin(0xe0c020) : lin(0xe8e8e0);
  const front = P[P.length - 1][0] + 0.012;
  const rear = P[0][0] - 0.012;
  face([L(front, 0.42, -0.17), L(front, 0.42, 0.17), L(front, 0.58, 0.17), L(front, 0.58, -0.17)], f);
  face([L(rear, 0.5, -0.17), L(rear, 0.5, 0.17), L(rear, 0.66, 0.17), L(rear, 0.66, -0.17)], [-f[0], 0, -f[2]]);

  if (t === TAXI) {
    // Roof lamp ("andon").
    mb.kind = KIND.emit;
    mb.style = [EMIT.lamp, 0, 0, 0];
    mb.color = paintHex === 0xd89a20 ? [0.5, 0.5, 0.45] : [0.5, 0.33, 0.05];
    mb.frameBox(L(-0.15, 0, 0), f, s, -0.18, 0.18, t.roofY, t.roofY + 0.18, -0.24, 0.24);
    mb.style = [0, 0, 0, 0];
  }
  mb.kind = KIND.plain;
}
