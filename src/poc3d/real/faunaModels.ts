import * as THREE from 'three';
import type { FaunaKind } from '../district/faunaMix';

/**
 * The animals' models (real/fauna.ts draws them): each a small mesh of tapered limbs, blobs and boxes in metres, +z
 * forward, +y up, feet on y = 0. What the vertex shader moves is tagged per vertex (`aPart`): x the distance out along a
 * wing, y the leg's swing (its sign the leg's side of the gait; fractions at the hip, 1 at the paw), z how far the head
 * dips when it pecks or sniffs. A cat and a dog have a standing model and a sitting one (and the cat a loaf), since an
 * animal at rest is not a standing animal with its legs held still.
 */

/** A model: one per kind, plus the resting poses of the cat and the dog. */
export const SHAPES = ['crow', 'pigeon', 'sparrow', 'gull', 'egret', 'cat', 'catSit', 'catLoaf', 'dog', 'dogSit', 'chicken', 'butterfly', 'dragonfly', 'firefly', 'moth'] as const;
export type FaunaShape = (typeof SHAPES)[number];
export const kindOfShape = (s: FaunaShape): FaunaKind => (s === 'catSit' || s === 'catLoaf' ? 'cat' : s === 'dogSit' ? 'dog' : s);

interface Build {
  pos: number[];
  col: number[];
  part: number[];
  idx: number[];
}
const newBuild = (): Build => ({ pos: [], col: [], part: [], idx: [] });
type Rgb = readonly [number, number, number];
type V3 = readonly [number, number, number];
const rgb = (hex: number): Rgb => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
interface Tags {
  /** Wing: the vertex's distance out from the body (m). */
  wing?: boolean;
  /** Leg: the swing weight, + or - by the leg's phase in the gait; the paw is 1. */
  leg?: number;
  /** Head: how far it dips (1 whole head, less on the neck). */
  head?: number;
}

function vert(b: Build, x: number, y: number, z: number, c: Rgb, shade: number, t: Tags): number {
  b.pos.push(x, y, z);
  b.col.push(c[0] * shade, c[1] * shade, c[2] * shade);
  b.part.push(t.wing ? Math.abs(x) : 0, t.leg ?? 0, t.head ?? 0);
  return b.pos.length / 3 - 1;
}
/** (Shading is done in the shader from the normals; a vertex's own colour is its colour.) */
const topLit = (_ny: number): number => 1;

/** A blob: an ellipsoid of `seg` sides and `rings` rings, lit from above in its colour. */
function blob(b: Build, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, c: Rgb, t: Tags = {}, seg = 9, rings = 5): void {
  const base = b.pos.length / 3;
  for (let j = 0; j <= rings; j++) {
    const v = (j / rings) * Math.PI;
    const ny = Math.cos(v);
    const rr = Math.sin(v);
    for (let i = 0; i < seg; i++) {
      const u = (i / seg) * Math.PI * 2;
      vert(b, cx + Math.cos(u) * rr * rx, cy + ny * ry, cz + Math.sin(u) * rr * rz, c, topLit(ny), t);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = base + j * seg + i;
      const a2 = base + j * seg + ((i + 1) % seg);
      b.idx.push(a, a + seg, a2, a2, a + seg, base + (j + 1) * seg + ((i + 1) % seg));
    }
  }
}

/** A box, centred, with flat faces. */
function box(b: Build, cx: number, cy: number, cz: number, w: number, h: number, d: number, c: Rgb, t: Tags = {}): void {
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;
  // Each face: four corners in order seen from outside.
  const faces: V3[][] = [
    [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]],
    [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]],
    [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]],
    [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]],
    [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]],
    [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]],
  ];
  for (const f of faces) {
    const base = b.pos.length / 3;
    for (const p of f) vert(b, cx + p[0], cy + p[1], cz + p[2], c, 1, t);
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/**
 * A tapered limb from p0 (radius r0) to p1 (radius r1), `sides` round, closed at both ends; `t0` and `t1` tag its ends
 * (a leg's swing grows from the hip to the paw). The animal's legs, necks, tails, ears and beaks are these.
 */
function seg(b: Build, p0: V3, p1: V3, r0: number, r1: number, c: Rgb, t0: Tags = {}, t1: Tags = t0, sides = 6): void {
  let dx = p1[0] - p0[0];
  let dy = p1[1] - p0[1];
  let dz = p1[2] - p0[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  // Two axes across the limb.
  const up: V3 = Math.abs(dy) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let ex = dy * up[2] - dz * up[1];
  let ey = dz * up[0] - dx * up[2];
  let ez = dx * up[1] - dy * up[0];
  const el = Math.hypot(ex, ey, ez) || 1;
  ex /= el;
  ey /= el;
  ez /= el;
  const fx = dy * ez - dz * ey;
  const fy = dz * ex - dx * ez;
  const fz = dx * ey - dy * ex;
  const base = b.pos.length / 3;
  for (let end = 0; end < 2; end++) {
    const p = end ? p1 : p0;
    const r = end ? r1 : r0;
    const t = end ? t1 : t0;
    for (let i = 0; i < sides; i++) {
      const u = (i / sides) * Math.PI * 2;
      const cu = Math.cos(u);
      const su = Math.sin(u);
      const ny = ey * cu + fy * su;
      vert(b, p[0] + (ex * cu + fx * su) * r, p[1] + ny * r, p[2] + (ez * cu + fz * su) * r, c, topLit(ny), t);
    }
  }
  for (let i = 0; i < sides; i++) {
    const a = base + i;
    const a2 = base + ((i + 1) % sides);
    b.idx.push(a, a + sides, a2, a2, a + sides, base + sides + ((i + 1) % sides));
  }
  // Ends: a fan to the centre.
  for (let end = 0; end < 2; end++) {
    const p = end ? p1 : p0;
    const o = vert(b, p[0], p[1], p[2], c, 0.8, end ? t1 : t0);
    for (let i = 0; i < sides; i++) {
      const a = base + end * sides + i;
      const a2 = base + end * sides + ((i + 1) % sides);
      if (end) b.idx.push(o, a, a2);
      else b.idx.push(o, a2, a);
    }
  }
}

/** A smooth tapered chain through points (a tail, a neck): a limb between each pair, radius easing from r0 to r1. */
function chain(b: Build, pts: readonly V3[], r0: number, r1: number, c: Rgb, t0: Tags = {}, t1: Tags = t0): void {
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = i / n;
    const z = (i + 1) / n;
    const lerp = (k: number): Tags => ({ leg: (t0.leg ?? 0) + ((t1.leg ?? 0) - (t0.leg ?? 0)) * k, head: (t0.head ?? 0) + ((t1.head ?? 0) - (t0.head ?? 0)) * k });
    seg(b, pts[i], pts[i + 1], r0 + (r1 - r0) * a, r0 + (r1 - r0) * z, c, lerp(a), lerp(z), 6);
    if (i + 1 < n) blob(b, pts[i + 1][0], pts[i + 1][1], pts[i + 1][2], r0 + (r1 - r0) * z, r0 + (r1 - r0) * z, r0 + (r1 - r0) * z, c, lerp(z), 6, 3);
  }
}

/**
 * Both wings: from the body out to `span`, `root` chord at the body and `tip` at the end, the leading edge swept back by
 * `sweep` and bowed forward, the trailing edge scalloped into feathers (four strips, so the wing can bend as it beats).
 */
function wings(b: Build, span: number, root: number, tip: number, sweep: number, c: Rgb, tipC: Rgb = c, at = 0, z0 = 0.02): void {
  const N = 4;
  for (const s of [-1, 1]) {
    const lead: V3[] = [];
    const trail: V3[] = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const chord = root + (tip - root) * u;
      const bow = Math.sin(u * Math.PI) * 0.08 * span;
      const z = z0 - sweep * u * u;
      // (The feathers: every other trailing point trails a little further, more towards the tip.)
      const scallop = i > 0 && i < N ? (i % 2 ? 0.06 : 0.0) * span * (0.5 + u) : 0;
      lead.push([s * (0.03 + (span - 0.03) * u), at + 0.01 * Math.sin(u * 3), z + chord / 2 + bow]);
      trail.push([s * (0.03 + (span - 0.03) * u), at - 0.004 * u, z - chord / 2 - scallop]);
    }
    const base = b.pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const col = mix(c, tipC, Math.max(0, (i / N - 0.45) / 0.55));
      vert(b, lead[i][0], lead[i][1], lead[i][2], col, 1, { wing: true });
      vert(b, trail[i][0], trail[i][1], trail[i][2], col, 1, { wing: true });
    }
    for (let i = 0; i < N; i++) {
      const k = base + i * 2;
      b.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
}

const BLACK = rgb(0x121216);
const EYE = rgb(0x0b0b0d);

/** Two small dark eyes on the sides of a head at (x, y, z), `r` each, set `out` from the middle. */
function eyes(b: Build, y: number, z: number, out: number, r: number): void {
  for (const s of [-1, 1]) blob(b, s * out, y, z, r, r, r, EYE, { head: 1 }, 5, 3);
}
const PINK = rgb(0xb06a6a);
const NOSE = rgb(0x3a2a2a);

interface BirdLook {
  /** Body length and half-width (m), and the height of the body's middle above the ground. */
  len: number;
  w: number;
  h: number;
  body: Rgb;
  head: Rgb;
  /** Underparts. */
  belly?: Rgb;
  beak: Rgb;
  beakLen: number;
  headR: number;
  /** Neck: how far the head stands above the shoulders, and forward of them. */
  neckUp: number;
  neckFwd: number;
  tail: number;
  tailC: Rgb;
  legs: Rgb;
  legLen: number;
  span: number;
  wingC: Rgb;
  tipC: Rgb;
  /** How much the body tips up at the front (0 level, 1 upright like a pigeon's). */
  tilt?: number;
}

/** A perching, walking bird: breast and rump, a neck, a head and beak, a tail, two jointed legs, and folding wings. */
function bird(b: Build, o: BirdLook): void {
  const tilt = o.tilt ?? 0.15;
  const { len, w, h } = o;
  const front = h + tilt * len * 0.25;
  const back = h - tilt * len * 0.25;
  blob(b, 0, front, len * 0.17, w, w * 1.05, len * 0.38, o.body);
  blob(b, 0, back, -len * 0.22, w * 0.82, w * 0.86, len * 0.36, o.body);
  if (o.belly) blob(b, 0, front - w * 0.35, len * 0.12, w * 0.75, w * 0.6, len * 0.34, o.belly);
  // The neck and head.
  const nx: V3 = [0, front + w * 0.45, len * 0.3];
  const hd: V3 = [0, front + w * 0.45 + o.neckUp, len * 0.3 + o.neckFwd];
  seg(b, nx, hd, w * 0.55, w * 0.42, o.body, { head: 0.5 }, { head: 1 });
  blob(b, hd[0], hd[1], hd[2], o.headR * 0.9, o.headR, o.headR * 1.1, o.head, { head: 1 }, 8, 4);
  eyes(b, hd[1] + o.headR * 0.2, hd[2] + o.headR * 0.45, o.headR * 0.78, o.headR * 0.2);
  seg(b, [0, hd[1] - o.headR * 0.1, hd[2] + o.headR * 0.8], [0, hd[1] - o.headR * 0.35, hd[2] + o.headR * 0.8 + o.beakLen], o.headR * 0.4, o.headR * 0.08, o.beak, { head: 1 }, { head: 1 }, 4);
  // The tail, a slab behind the rump, pointing a little down.
  box(b, 0, back - 0.005, -len * 0.38 - o.tail / 2, w * 1.0, 0.008, o.tail, o.tailC);
  // Legs: a thin stalk, a foot.
  for (const s of [-1, 1]) {
    const x = s * w * 0.4;
    seg(b, [x, front - w * 0.7, len * 0.02], [x, 0.012, len * 0.04], 0.0095, 0.0065, o.legs, { leg: 0.3 * s }, { leg: s }, 5);
    box(b, x, 0.006, len * 0.04 + 0.012, 0.014, 0.008, 0.035, o.legs, { leg: s });
  }
  wings(b, o.span, len * 0.5, len * 0.28, len * 0.1, o.wingC, o.tipC, front + w * 0.35, len * 0.08);
}

/** A limb with a bend (a shoulder or hip, a joint, a paw): two segments tagged for the gait, and a foot. */
function leg(b: Build, hip: V3, knee: V3, paw: V3, r: number, c: Rgb, side: number, foot: number, footC: Rgb = c): void {
  seg(b, hip, knee, r * 1.25, r, c, { leg: 0.15 * side }, { leg: 0.55 * side });
  seg(b, knee, paw, r, r * 0.75, c, { leg: 0.55 * side }, { leg: side });
  box(b, paw[0], paw[1] + 0.006, paw[2] + foot * 0.4, r * 1.7, 0.014, foot, footC, { leg: side });
}

function catStand(b: Build, c: Rgb, belly: Rgb): void {
  // A short body with an arched back: the chest, the haunches, the loin between.
  blob(b, 0, 0.245, 0.085, 0.063, 0.082, 0.1, c);
  blob(b, 0, 0.245, -0.095, 0.068, 0.086, 0.1, c);
  seg(b, [0, 0.262, 0.05], [0, 0.262, -0.07], 0.058, 0.062, c);
  blob(b, 0, 0.2, -0.0, 0.048, 0.05, 0.12, belly);
  // The neck rising from the shoulders, the head carried level.
  seg(b, [0, 0.27, 0.14], [0, 0.31, 0.2], 0.04, 0.034, c, { head: 0.4 }, { head: 0.8 });
  blob(b, 0, 0.318, 0.225, 0.048, 0.043, 0.044, c, { head: 1 });
  blob(b, 0, 0.305, 0.262, 0.026, 0.02, 0.023, belly, { head: 1 }, 6, 4);
  box(b, 0, 0.312, 0.283, 0.011, 0.008, 0.006, NOSE, { head: 1 });
  eyes(b, 0.325, 0.25, 0.034, 0.0085);
  for (const s of [-1, 1]) seg(b, [s * 0.034, 0.347, 0.208], [s * 0.029, 0.392, 0.2], 0.019, 0.002, c, { head: 1 }, { head: 1 }, 3);
  // Four slim legs, the hind ones folding at the hock under a rounded thigh.
  for (const s of [-1, 1]) {
    blob(b, s * 0.056, 0.2, -0.12, 0.032, 0.07, 0.065, c, { leg: -0.15 * s });
    leg(b, [s * 0.04, 0.22, 0.095], [s * 0.038, 0.11, 0.1], [s * 0.036, 0.0, 0.1], 0.0155, c, s, 0.04, belly);
    leg(b, [s * 0.05, 0.23, -0.12], [s * 0.046, 0.09, -0.16], [s * 0.04, 0.0, -0.11], 0.019, c, -s, 0.05, belly);
  }
  // A long tail, hanging low and curving up at the tip.
  chain(b, [[0, 0.235, -0.17], [0, 0.2, -0.25], [0, 0.17, -0.34], [0, 0.17, -0.43], [0, 0.2, -0.5], [0, 0.26, -0.53]], 0.019, 0.011, c);
}

function catSit(b: Build, c: Rgb, belly: Rgb): void {
  // Haunches on the ground, the back rising to the shoulders, the chest and the head high.
  blob(b, 0, 0.1, -0.08, 0.075, 0.105, 0.12, c);
  seg(b, [0, 0.12, -0.04], [0, 0.23, 0.07], 0.07, 0.058, c);
  blob(b, 0, 0.22, 0.075, 0.056, 0.095, 0.065, c);
  blob(b, 0, 0.18, 0.1, 0.04, 0.07, 0.04, belly);
  seg(b, [0, 0.29, 0.085], [0, 0.34, 0.11], 0.034, 0.03, c, { head: 0.4 }, { head: 0.8 });
  blob(b, 0, 0.355, 0.125, 0.046, 0.042, 0.042, c, { head: 1 });
  eyes(b, 0.363, 0.148, 0.033, 0.0085);
  blob(b, 0, 0.343, 0.162, 0.024, 0.019, 0.021, belly, { head: 1 }, 5, 3);
  box(b, 0, 0.349, 0.183, 0.01, 0.008, 0.006, NOSE, { head: 1 });
  for (const s of [-1, 1]) seg(b, [s * 0.033, 0.382, 0.115], [s * 0.027, 0.428, 0.108], 0.018, 0.002, c, { head: 1 }, { head: 1 }, 3);
  for (const s of [-1, 1]) {
    // Front legs straight down; hind feet flat out in front of the haunches; the thigh a bump at the side.
    seg(b, [s * 0.035, 0.2, 0.1], [s * 0.034, 0.0, 0.125], 0.017, 0.013, c);
    box(b, s * 0.034, 0.007, 0.145, 0.026, 0.014, 0.05, belly);
    blob(b, s * 0.062, 0.075, -0.08, 0.03, 0.065, 0.085, c);
    box(b, s * 0.055, 0.007, 0.03, 0.03, 0.014, 0.085, belly);
  }
  // The tail round the front of the feet.
  seg(b, [0.02, 0.03, -0.17], [0.09, 0.012, -0.13], 0.018, 0.016, c);
  seg(b, [0.09, 0.012, -0.13], [0.115, 0.012, 0.0], 0.016, 0.014, c);
  seg(b, [0.115, 0.012, 0.0], [0.07, 0.012, 0.1], 0.014, 0.01, c);
}

function catLoaf(b: Build, c: Rgb, belly: Rgb): void {
  // Lying with the paws tucked under: a loaf, a head a little raised, the tail wrapped along the side.
  blob(b, 0, 0.085, -0.02, 0.085, 0.09, 0.2, c, {}, 8, 4);
  blob(b, 0, 0.11, 0.14, 0.07, 0.07, 0.09, c);
  blob(b, 0, 0.155, 0.2, 0.047, 0.043, 0.043, c, { head: 1 });
  eyes(b, 0.163, 0.223, 0.033, 0.0085);
  blob(b, 0, 0.143, 0.238, 0.024, 0.019, 0.021, belly, { head: 1 }, 5, 3);
  box(b, 0, 0.149, 0.259, 0.01, 0.008, 0.006, NOSE, { head: 1 });
  for (const s of [-1, 1]) {
    seg(b, [s * 0.034, 0.182, 0.19], [s * 0.028, 0.228, 0.184], 0.018, 0.002, c, { head: 1 }, { head: 1 }, 3);
    box(b, s * 0.035, 0.012, 0.25, 0.026, 0.024, 0.06, belly);
  }
  seg(b, [0.06, 0.04, -0.2], [0.115, 0.025, -0.06], 0.017, 0.015, c);
  seg(b, [0.115, 0.025, -0.06], [0.1, 0.02, 0.14], 0.015, 0.011, c);
}

function dogStand(b: Build, c: Rgb, belly: Rgb): void {
  // A deep chest, a tucked waist, the haunches.
  blob(b, 0, 0.37, 0.15, 0.1, 0.135, 0.15, c);
  blob(b, 0, 0.36, -0.2, 0.088, 0.105, 0.14, c);
  seg(b, [0, 0.36, 0.1], [0, 0.35, -0.12], 0.082, 0.082, c);
  blob(b, 0, 0.31, 0.0, 0.07, 0.07, 0.16, belly);
  // The neck, the head with a muzzle and a dark nose, drop ears.
  seg(b, [0, 0.43, 0.22], [0, 0.52, 0.32], 0.07, 0.055, c, { head: 0.4 }, { head: 0.8 });
  blob(b, 0, 0.545, 0.345, 0.058, 0.055, 0.065, c, { head: 1 });
  eyes(b, 0.56, 0.375, 0.046, 0.01);
  seg(b, [0, 0.527, 0.375], [0, 0.505, 0.455], 0.037, 0.028, mix(c, belly, 0.5), { head: 1 }, { head: 1 }, 5);
  box(b, 0, 0.505, 0.462, 0.034, 0.026, 0.02, NOSE, { head: 1 });
  for (const s of [-1, 1]) seg(b, [s * 0.05, 0.585, 0.325], [s * 0.075, 0.52, 0.31], 0.028, 0.02, mix(c, BLACK, 0.3), { head: 1 }, { head: 1 }, 4);
  // Legs: straight forelegs under the shoulders, the hind legs bent at the hock under a round thigh.
  for (const s of [-1, 1]) {
    blob(b, s * 0.078, 0.32, -0.23, 0.05, 0.1, 0.095, c, { leg: -0.15 * s });
    blob(b, s * 0.076, 0.33, 0.16, 0.042, 0.09, 0.08, c, { leg: 0.15 * s });
    leg(b, [s * 0.07, 0.34, 0.16], [s * 0.068, 0.17, 0.175], [s * 0.066, 0.0, 0.18], 0.028, c, s, 0.07, belly);
    leg(b, [s * 0.07, 0.38, -0.22], [s * 0.07, 0.19, -0.29], [s * 0.066, 0.0, -0.24], 0.03, c, -s, 0.07, belly);
  }
  // The tail up and over.
  chain(b, [[0, 0.42, -0.3], [0, 0.47, -0.37], [0, 0.53, -0.41], [0, 0.6, -0.4]], 0.029, 0.012, c);
}

function dogSit(b: Build, c: Rgb, belly: Rgb): void {
  // Sitting: haunches on the ground, the back steep, the chest high, the forelegs straight, the head up.
  blob(b, 0, 0.14, -0.14, 0.095, 0.14, 0.15, c);
  seg(b, [0, 0.2, -0.1], [0, 0.4, 0.1], 0.1, 0.095, c);
  blob(b, 0, 0.4, 0.12, 0.1, 0.14, 0.11, c);
  blob(b, 0, 0.34, 0.15, 0.065, 0.1, 0.06, belly);
  seg(b, [0, 0.5, 0.14], [0, 0.6, 0.18], 0.066, 0.054, c, { head: 0.4 }, { head: 0.8 });
  blob(b, 0, 0.635, 0.2, 0.058, 0.055, 0.065, c, { head: 1 });
  eyes(b, 0.65, 0.23, 0.046, 0.01);
  seg(b, [0, 0.617, 0.23], [0, 0.592, 0.31], 0.037, 0.028, mix(c, belly, 0.5), { head: 1 }, { head: 1 }, 5);
  box(b, 0, 0.592, 0.318, 0.034, 0.026, 0.02, NOSE, { head: 1 });
  for (const s of [-1, 1]) {
    seg(b, [s * 0.05, 0.675, 0.18], [s * 0.075, 0.61, 0.165], 0.028, 0.02, mix(c, BLACK, 0.3), { head: 1 }, { head: 1 }, 4);
    seg(b, [s * 0.065, 0.34, 0.13], [s * 0.062, 0.0, 0.17], 0.03, 0.022, c);
    box(b, s * 0.062, 0.008, 0.2, 0.05, 0.016, 0.08, belly);
    blob(b, s * 0.1, 0.1, -0.14, 0.04, 0.09, 0.1, c);
    box(b, s * 0.085, 0.008, -0.02, 0.05, 0.016, 0.12, belly);
  }
  // The tail on the ground behind.
  seg(b, [0, 0.04, -0.25], [0, 0.015, -0.4], 0.025, 0.014, c);
  seg(b, [0, 0.015, -0.4], [0.04, 0.012, -0.5], 0.014, 0.01, c);
}

export function geometryOf(shape: FaunaShape): { geo: THREE.BufferGeometry; glow: boolean } {
  const b = newBuild();
  let glow = false;
  switch (shape) {
    case 'crow': {
      const c = rgb(0x1a1b22);
      bird(b, { len: 0.42, w: 0.058, h: 0.17, body: c, head: c, beak: rgb(0x0e0e10), beakLen: 0.07, headR: 0.04, neckUp: 0.035, neckFwd: 0.07, tail: 0.2, tailC: BLACK, legs: BLACK, legLen: 0.12, span: 0.48, wingC: c, tipC: BLACK, tilt: 0.12 });
      break;
    }
    case 'pigeon': {
      const c = rgb(0x6b6f7a);
      bird(b, { len: 0.3, w: 0.058, h: 0.13, body: c, head: rgb(0x4f5370), belly: rgb(0x8a8d98), beak: rgb(0xd8d2c8), beakLen: 0.022, headR: 0.03, neckUp: 0.05, neckFwd: 0.04, tail: 0.11, tailC: rgb(0x55586a), legs: PINK, legLen: 0.08, span: 0.3, wingC: rgb(0x80848f), tipC: rgb(0x4d5060), tilt: 0.3 });
      break;
    }
    case 'sparrow': {
      const c = rgb(0x73563a);
      bird(b, { len: 0.13, w: 0.03, h: 0.055, body: c, head: rgb(0x6a5a48), belly: rgb(0xa8a090), beak: rgb(0x3a3a3a), beakLen: 0.012, headR: 0.02, neckUp: 0.02, neckFwd: 0.02, tail: 0.06, tailC: rgb(0x5a432e), legs: PINK, legLen: 0.04, span: 0.12, wingC: rgb(0x7d5f40), tipC: rgb(0x4a3a2a), tilt: 0.25 });
      break;
    }
    case 'gull': {
      const w = rgb(0xeeeeea);
      bird(b, { len: 0.46, w: 0.075, h: 0.22, body: w, head: w, beak: rgb(0xe2b73a), beakLen: 0.07, headR: 0.046, neckUp: 0.04, neckFwd: 0.06, tail: 0.13, tailC: w, legs: rgb(0xd29a3a), legLen: 0.14, span: 0.62, wingC: rgb(0xb8bec6), tipC: rgb(0x1c1c22), tilt: 0.2 });
      break;
    }
    case 'egret': {
      const w = rgb(0xf4f4ee);
      blob(b, 0, 0.52, 0.0, 0.07, 0.08, 0.21, w);
      blob(b, 0, 0.5, -0.16, 0.055, 0.06, 0.13, w);
      // A long S-curved neck, a small head and a long yellow bill.
      seg(b, [0, 0.56, 0.16], [0, 0.66, 0.21], 0.03, 0.024, w, { head: 0.3 }, { head: 0.5 });
      seg(b, [0, 0.66, 0.21], [0, 0.76, 0.18], 0.024, 0.02, w, { head: 0.5 }, { head: 0.8 });
      seg(b, [0, 0.76, 0.18], [0, 0.84, 0.22], 0.02, 0.022, w, { head: 0.8 }, { head: 1 });
      blob(b, 0, 0.855, 0.235, 0.025, 0.024, 0.03, w, { head: 1 }, 8, 4);
      eyes(b, 0.862, 0.245, 0.021, 0.005);
      seg(b, [0, 0.852, 0.255], [0, 0.825, 0.36], 0.012, 0.003, rgb(0xd8b640), { head: 1 }, { head: 1 }, 4);
      for (const s of [-1, 1]) {
        seg(b, [s * 0.03, 0.46, -0.02], [s * 0.03, 0.24, 0.0], 0.012, 0.009, BLACK, { leg: 0.2 * s }, { leg: 0.5 * s }, 4);
        seg(b, [s * 0.03, 0.24, 0.0], [s * 0.03, 0.005, 0.02], 0.009, 0.007, BLACK, { leg: 0.5 * s }, { leg: s }, 4);
        box(b, s * 0.03, 0.004, 0.05, 0.016, 0.008, 0.07, BLACK, { leg: s });
      }
      wings(b, 0.55, 0.3, 0.15, 0.1, w, w, 0.55, 0);
      break;
    }
    case 'cat':
      catStand(b, rgb(0xb8b2a8), rgb(0xd6d0c6));
      break;
    case 'catSit':
      catSit(b, rgb(0xb8b2a8), rgb(0xd6d0c6));
      break;
    case 'catLoaf':
      catLoaf(b, rgb(0xb8b2a8), rgb(0xd6d0c6));
      break;
    case 'dog':
      dogStand(b, rgb(0xb59468), rgb(0xd4bc94));
      break;
    case 'dogSit':
      dogSit(b, rgb(0xb59468), rgb(0xd4bc94));
      break;
    case 'chicken': {
      const c = rgb(0x8a5a36);
      const comb = rgb(0xc43a2c);
      blob(b, 0, 0.21, 0.02, 0.1, 0.1, 0.17, c);
      blob(b, 0, 0.26, 0.1, 0.07, 0.08, 0.1, mix(c, rgb(0xd8b080), 0.4));
      seg(b, [0, 0.3, 0.12], [0, 0.37, 0.15], 0.034, 0.026, c, { head: 0.5 }, { head: 1 });
      blob(b, 0, 0.385, 0.16, 0.034, 0.036, 0.042, c, { head: 1 }, 8, 4);
      eyes(b, 0.395, 0.175, 0.029, 0.0065);
      box(b, 0, 0.43, 0.158, 0.012, 0.045, 0.06, comb, { head: 1 });
      box(b, 0, 0.35, 0.185, 0.012, 0.05, 0.012, comb, { head: 1 });
      seg(b, [0, 0.382, 0.195], [0, 0.372, 0.235], 0.012, 0.003, rgb(0xd8b640), { head: 1 }, { head: 1 }, 4);
      // Tail feathers sweeping up and back.
      seg(b, [0, 0.25, -0.14], [0, 0.34, -0.22], 0.045, 0.03, rgb(0x4a2c1c));
      seg(b, [0, 0.34, -0.22], [0, 0.4, -0.3], 0.03, 0.012, rgb(0x2a1c18));
      for (const s of [-1, 1]) {
        seg(b, [s * 0.04, 0.14, 0.01], [s * 0.04, 0.0, 0.03], 0.012, 0.008, rgb(0xd8b640), { leg: 0.4 * s }, { leg: s }, 4);
        box(b, s * 0.04, 0.005, 0.06, 0.02, 0.008, 0.05, rgb(0xd8b640), { leg: s });
      }
      wings(b, 0.2, 0.18, 0.1, 0.03, rgb(0x9a6a40), rgb(0x5a3a22), 0.22, 0.02);
      break;
    }
    case 'butterfly': {
      const c = rgb(0xffffff);
      box(b, 0, 0, 0, 0.006, 0.006, 0.05, rgb(0x2a2420));
      wings(b, 0.035, 0.04, 0.045, -0.005, c, c, 0, 0);
      break;
    }
    case 'dragonfly': {
      const c = rgb(0xffffff);
      box(b, 0, 0, 0, 0.006, 0.006, 0.14, c);
      box(b, 0, 0.003, 0.075, 0.016, 0.014, 0.016, c);
      wings(b, 0.05, 0.015, 0.012, 0, rgb(0xdfe8ee), rgb(0xdfe8ee), 0, 0.03);
      wings(b, 0.05, 0.015, 0.012, 0, rgb(0xdfe8ee), rgb(0xdfe8ee), 0, 0.01);
      break;
    }
    case 'firefly': {
      glow = true;
      blob(b, 0, 0, 0, 0.035, 0.035, 0.035, rgb(0xd8ff70), {}, 4, 2);
      break;
    }
    case 'moth': {
      const c = rgb(0xc9bfa6);
      blob(b, 0, 0, 0, 0.012, 0.012, 0.035, c, {}, 4, 2);
      wings(b, 0.03, 0.035, 0.035, -0.004, c, rgb(0x9a9078), 0, 0);
      break;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  geo.setAttribute('aCol', new THREE.Float32BufferAttribute(b.col, 3));
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(b.part, 3));
  geo.setIndex(b.idx);
  geo.computeVertexNormals();
  return { geo, glow };
}
