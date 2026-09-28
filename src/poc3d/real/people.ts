import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import { hash, rng, type Rng } from '../../core/hash';
import type { CellPlan3, Road3 } from '../district/plan';
import { propDist, type CellDetail } from './props';
import { sphereOf, toGeometry, type RawGeometry } from './rawGeometry';

/**
 * People, as translucent coloured ghosts: stand-ins that show where life is without committing to character
 * art. Figures are built from smooth capsules and ellipsoids on a simple skeleton, so one generator covers
 * body types (man, woman, child, elder), clothes (skirt, long coat), hair and hats, and poses (standing,
 * walking, talking, on the phone, hands in pockets, waving, holding a hand). Static for now; a figure is a
 * pure function of its spec, so animation can later just re-pose it.
 */

type V3 = [number, number, number];

export type Body = 'man' | 'woman' | 'child' | 'elder';
export type Pose = 'stand' | 'walk' | 'talk' | 'phone' | 'pockets' | 'wave' | 'hold';
export type Hair = 'short' | 'long' | 'bun' | 'hat' | 'cap' | 'none';

export interface FigureSpec {
  readonly x: number;
  readonly z: number;
  /** Facing, radians: 0 faces +z (south); positive turns towards +x. */
  readonly yaw: number;
  readonly body: Body;
  readonly pose: Pose;
  /** Linear colour of the ghost. */
  readonly color: V3;
  readonly hair: Hair;
  /** A skirt / dress (women) or a long coat (men). */
  readonly long: boolean;
  /** Walk cycle phase 0-1 (which leg is forward, how far). */
  readonly phase: number;
  /** Which side a talking/waving/holding arm is on: 1 right, -1 left. */
  readonly side: number;
  /** Head turn, radians. */
  readonly look: number;
}

export const GHOST_COLORS: readonly V3[] = [
  [0.35, 0.85, 1.0],
  [1.0, 0.42, 0.72],
  [0.68, 0.52, 1.0],
  [0.42, 1.0, 0.66],
  [1.0, 0.72, 0.32],
  [0.78, 0.84, 1.0],
  [1.0, 0.52, 0.42],
];

/** Builder for ghost geometry with smooth normals (position, normal, color), into reused typed arrays. */
export class GhostBuilder {
  private pos = new Float32Array(3 * 65536);
  private nor = new Float32Array(3 * 65536);
  private col = new Float32Array(3 * 65536);
  private idx = new Uint32Array(6 * 65536);
  private nv = 0;
  private ni = 0;
  color: V3 = [1, 1, 1];

  get count(): number {
    return this.nv;
  }

  reset(): this {
    this.nv = 0;
    this.ni = 0;
    return this;
  }

  private grow(nv: number, ni: number): void {
    if ((this.nv + nv) * 3 > this.pos.length) {
      const cap = Math.max((this.nv + nv) * 3, this.pos.length * 2);
      for (const k of ['pos', 'nor', 'col'] as const) {
        const b = new Float32Array(cap);
        b.set(this[k].subarray(0, this.nv * 3));
        this[k] = b;
      }
    }
    if (this.ni + ni > this.idx.length) {
      const b = new Uint32Array(Math.max(this.ni + ni, this.idx.length * 2));
      b.set(this.idx.subarray(0, this.ni));
      this.idx = b;
    }
  }

  private v(px: number, py: number, pz: number, nx: number, ny: number, nz: number): void {
    const i = this.nv++ * 3;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    this.pos[i] = px;
    this.pos[i + 1] = py;
    this.pos[i + 2] = pz;
    this.nor[i] = nx / l;
    this.nor[i + 1] = ny / l;
    this.nor[i + 2] = nz / l;
    this.col[i] = this.color[0];
    this.col[i + 1] = this.color[1];
    this.col[i + 2] = this.color[2];
  }

  /** Joins `rings` consecutive rings of `seg` vertices starting at vertex `start` into a tube. */
  private band(start: number, rings: number, seg: number): void {
    for (let k = 0; k + 1 < rings; k++) {
      for (let j = 0; j < seg; j++) {
        const a = start + k * seg + j;
        const b = start + k * seg + ((j + 1) % seg);
        const c = start + (k + 1) * seg + ((j + 1) % seg);
        const d = start + (k + 1) * seg + j;
        const I = this.idx;
        const i = this.ni;
        I[i] = a;
        I[i + 1] = c;
        I[i + 2] = b;
        I[i + 3] = a;
        I[i + 4] = d;
        I[i + 5] = c;
        this.ni += 6;
      }
    }
  }

  /**
   * A capsule from a to b, radius ra at a and rb at b, cross-section stretched by `wide` along `side`
   * (for torsos). Hemispherical caps; smooth normals.
   */
  capsule(a: V3, b: V3, ra: number, rb: number, side: V3 = [1, 0, 0], wide = 1, seg = 6): void {
    const d = sub(b, a);
    const L = len(d) || 1e-4;
    const dn = scale(d, 1 / L);
    let u = sub(side, scale(dn, dot(side, dn)));
    if (len(u) < 1e-3) u = Math.abs(dn[1]) < 0.9 ? cross(dn, [0, 1, 0]) : cross(dn, [1, 0, 0]);
    u = norm(u);
    // (u, w, dn) ordered so the ring winding faces outward, like the ellipsoid and lathe.
    const w = cross(u, dn);
    const lats = [-Math.PI / 2 + 0.01, -Math.PI / 4, 0, 0, Math.PI / 4, Math.PI / 2 - 0.01];
    this.grow(lats.length * seg, (lats.length - 1) * seg * 6);
    const start = this.nv;
    for (let k = 0; k < lats.length; k++) {
      const c = k < 3 ? a : b;
      const r = k < 3 ? ra : rb;
      const phi = lats[k];
      const sp = Math.sin(phi);
      const cp = Math.cos(phi);
      for (let j = 0; j < seg; j++) {
        const t = (j / seg) * Math.PI * 2;
        const ct = Math.cos(t);
        const st = Math.sin(t);
        const rx = u[0] * ct * wide + w[0] * st;
        const ry = u[1] * ct * wide + w[1] * st;
        const rz = u[2] * ct * wide + w[2] * st;
        const nx = u[0] * ct + w[0] * st;
        const ny = u[1] * ct + w[1] * st;
        const nz = u[2] * ct + w[2] * st;
        this.v(
          c[0] + dn[0] * sp * r + rx * cp * r, c[1] + dn[1] * sp * r + ry * cp * r, c[2] + dn[2] * sp * r + rz * cp * r,
          dn[0] * sp + nx * cp, dn[1] * sp + ny * cp, dn[2] * sp + nz * cp,
        );
      }
    }
    this.band(start, lats.length, seg);
  }

  /** Ellipsoid at c with radii along the frame (right, up, fwd). */
  ellipsoid(c: V3, right: V3, fwd: V3, rx: number, ry: number, rz: number, seg = 8, lat = 5): void {
    this.grow((lat + 1) * seg, lat * seg * 6);
    const start = this.nv;
    for (let k = 0; k <= lat; k++) {
      const phi = Math.min(Math.max(-Math.PI / 2 + (k / lat) * Math.PI, -Math.PI / 2 + 0.01), Math.PI / 2 - 0.01);
      const cp = Math.cos(phi);
      const ly = Math.sin(phi);
      for (let j = 0; j < seg; j++) {
        const t = (j / seg) * Math.PI * 2;
        const lx = cp * Math.cos(t);
        const lz = cp * Math.sin(t);
        this.v(
          c[0] + right[0] * lx * rx + fwd[0] * lz * rz, c[1] + ly * ry, c[2] + right[2] * lx * rx + fwd[2] * lz * rz,
          right[0] * lx / rx + fwd[0] * lz / rz, ly / ry, right[2] * lx / rx + fwd[2] * lz / rz,
        );
      }
    }
    this.band(start, lat + 1, seg);
  }

  /** Open lathe (skirt, coat, hat) around a vertical axis at c: rings of [height, rx, rz] in the figure frame. */
  lathe(c: V3, right: V3, fwd: V3, rings: readonly [number, number, number][], seg = 10): void {
    this.grow(rings.length * seg, (rings.length - 1) * seg * 6);
    const start = this.nv;
    for (let k = 0; k < rings.length; k++) {
      const [y, rx, rz] = rings[k];
      const prev = rings[Math.max(0, k - 1)];
      const next = rings[Math.min(rings.length - 1, k + 1)];
      const slope = (next[1] - prev[1]) / Math.max(1e-3, next[0] - prev[0]);
      for (let j = 0; j < seg; j++) {
        const t = (j / seg) * Math.PI * 2;
        const ct = Math.cos(t);
        const st = Math.sin(t);
        this.v(
          c[0] + right[0] * ct * rx + fwd[0] * st * rz, y, c[2] + right[2] * ct * rx + fwd[2] * st * rz,
          right[0] * ct + fwd[0] * st, -slope, right[2] * ct + fwd[2] * st,
        );
      }
    }
    this.band(start, rings.length, seg);
  }

  build(ox: number, oz: number): THREE.BufferGeometry | null {
    const r = this.raw(ox, oz);
    return r ? toGeometry(r) : null;
  }

  raw(ox: number, oz: number): RawGeometry | null {
    if (this.nv === 0) return null;
    const p = this.pos.slice(0, this.nv * 3);
    for (let i = 0; i < p.length; i += 3) {
      p[i] -= ox;
      p[i + 2] -= oz;
    }
    return {
      attrs: {
        position: { array: p, size: 3 },
        normal: { array: this.nor.slice(0, this.nv * 3), size: 3 },
        color: { array: this.col.slice(0, this.nv * 3), size: 3 },
      },
      index: this.idx.slice(0, this.ni),
      sphere: sphereOf(p),
    };
  }
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => scale(a, 1 / (len(a) || 1));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

interface Limb {
  /** Forward swing, radians (positive = forward). */
  swing: number;
  /** Outward raise, radians. */
  raise: number;
  /** Elbow / knee bend, radians (elbow folds forward, knee folds back). */
  bend: number;
}

interface Skeleton {
  lean: number;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
}

function skeleton(s: FigureSpec): Skeleton {
  const still: Limb = { swing: 0, raise: 0.08, bend: 0.15 };
  const leg: Limb = { swing: 0, raise: 0.02, bend: 0 };
  const sk: Skeleton = { lean: s.body === 'elder' ? 0.2 : 0.02, armL: { ...still }, armR: { ...still }, legL: { ...leg }, legR: { ...leg } };
  const gest = (l: Limb, swing: number, raise: number, bend: number): void => {
    l.swing = swing;
    l.raise = raise;
    l.bend = bend;
  };
  const armS = s.side > 0 ? sk.armR : sk.armL;
  switch (s.pose) {
    case 'walk': {
      const a = Math.sin(s.phase * Math.PI * 2) * 0.42;
      gest(sk.legL, a, 0.02, a < 0 ? 0.35 : 0.08);
      gest(sk.legR, -a, 0.02, -a < 0 ? 0.35 : 0.08);
      gest(sk.armL, -a * 0.8, 0.1, 0.3);
      gest(sk.armR, a * 0.8, 0.1, 0.3);
      sk.lean += 0.05;
      break;
    }
    case 'talk':
      gest(armS, 0.35, 0.15, 1.3);
      gest(sk.legL, 0.05, 0.06, 0.05);
      gest(sk.legR, -0.05, 0.1, 0.05);
      break;
    case 'phone':
      gest(armS, 0.25, 0.3, 2.5);
      break;
    case 'pockets':
      gest(sk.armL, -0.12, 0.22, 0.5);
      gest(sk.armR, -0.12, 0.22, 0.5);
      break;
    case 'wave':
      gest(armS, 0.2, 1.1, 1.5);
      break;
    case 'hold':
      gest(armS, 0.1, s.body === 'child' ? 0.75 : 0.28, 0.1);
      break;
    case 'stand':
      gest(sk.legR, 0.02, 0.1, 0.02);
      break;
  }
  return sk;
}

/** Builds one ghost figure into gb. */
/**
 * A clear vinyl umbrella (the konbini kind) held over a figure: a shallow dome over the head, tilted a
 * little forward, and its shaft down to the hand on the figure's side. Built separately from the figure
 * (the district shows umbrellas only while it rains). Most people carry one: whether this one does is a
 * pure function of where they stand.
 */
export function addUmbrella(gb: GhostBuilder, s: FigureSpec): boolean {
  const h = (Math.imul(Math.round(s.x * 10), 73856093) ^ Math.imul(Math.round(s.z * 10), 19349663)) >>> 0;
  if (h % 100 >= 72) return false;
  const child = s.body === 'child';
  const k = child ? 0.62 : s.body === 'woman' ? 0.95 : 1;
  const fwd: V3 = [Math.sin(s.yaw), 0, Math.cos(s.yaw)];
  const right: V3 = [fwd[2], 0, -fwd[0]];
  const hand = s.side >= 0 ? 0.2 : -0.2;
  // Canopy centre: over the head, a little forward and toward the hand.
  const cx = s.x + right[0] * hand * 0.5 * k + fwd[0] * 0.1;
  const cz = s.z + right[2] * hand * 0.5 * k + fwd[2] * 0.1;
  const top = 1.95 * k + 0.35;
  const R = child ? 0.42 : 0.52;
  gb.color = [0.82, 0.88, 0.95];
  gb.lathe([cx, 0, cz], right, fwd, [
    [top - 0.22, R, R],
    [top - 0.14, R * 0.86, R * 0.86],
    [top - 0.05, R * 0.55, R * 0.55],
    [top, R * 0.15, R * 0.15],
    [top + 0.02, 0.01, 0.01],
  ], 12);
  const hx = s.x + right[0] * hand * k + fwd[0] * 0.15;
  const hz = s.z + right[2] * hand * k + fwd[2] * 0.15;
  gb.capsule([hx, 1.05 * k, hz], [cx, top, cz], 0.012, 0.012, right, 1, 4);
  return true;
}

export function addFigure(gb: GhostBuilder, s: FigureSpec): void {
  gb.color = s.color;
  const child = s.body === 'child';
  const woman = s.body === 'woman';
  const k = child ? 0.62 : woman ? 0.95 : s.body === 'elder' ? 0.96 : 1;
  const headK = child ? 1.25 : 1;
  const fwd: V3 = [Math.sin(s.yaw), 0, Math.cos(s.yaw)];
  const right: V3 = [fwd[2], 0, -fwd[0]];
  const o: V3 = [s.x, 0.15, s.z];
  const sk = skeleton(s);
  // Local (x right, y up, z forward) -> world.
  const W = (x: number, y: number, z: number): V3 => add(o, add(add(scale(right, x), [0, y, 0]), scale(fwd, z)));
  const limbDir = (l: Limb, sideSign: number, extra = 0): V3 => {
    const a = l.swing + extra;
    return [sideSign * Math.sin(l.raise), -Math.cos(a) * Math.cos(l.raise), Math.sin(a) * Math.cos(l.raise)];
  };
  const walking = s.pose === 'walk';
  const legLen = 0.9 * k * (child ? 0.92 : 1);
  const pelvisY = legLen * (walking ? 0.97 : 1) + 0.02;
  const hipW = (woman ? 0.1 : 0.095) * k;
  const shoulderW = (woman ? 0.16 : s.body === 'man' ? 0.19 : 0.17) * k;
  const torsoLen = 0.52 * k * (child ? 0.95 : 1);
  const lean = sk.lean;
  const up: V3 = [0, Math.cos(lean), Math.sin(lean)];
  const pelvis: V3 = [0, pelvisY, 0];
  const chest: V3 = add(pelvis, scale(up, torsoLen));
  const neck: V3 = add(chest, scale(up, 0.07 * k));
  const headC: V3 = add(neck, [0, 0.13 * k * headK, 0.01]);

  // Legs.
  for (const [sgn, leg] of [[-1, sk.legL], [1, sk.legR]] as const) {
    const hip: V3 = [sgn * hipW, pelvisY, 0];
    const d1 = limbDir(leg, sgn);
    const knee = add(hip, scale(d1, legLen * 0.5));
    const d2 = limbDir(leg, sgn, -leg.bend);
    const ankle = add(knee, scale(d2, legLen * 0.48));
    const toe = add(ankle, [0, -0.03 * k, 0.16 * k]);
    gb.capsule(W(...hip), W(...knee), 0.075 * k, 0.058 * k);
    gb.capsule(W(...knee), W(...ankle), 0.056 * k, 0.042 * k);
    gb.capsule(W(...ankle), W(...toe), 0.042 * k, 0.038 * k);
  }
  // Torso: hips to waist, waist to chest (a narrower waist and wider hips for women).
  const waist: V3 = add(pelvis, scale(up, torsoLen * 0.42));
  gb.capsule(W(...pelvis), W(...waist), (woman ? 0.16 : 0.145) * k, 0.13 * k, right, 1.0, 8);
  gb.capsule(W(...waist), W(...add(chest, [0, -0.04 * k, 0])), 0.13 * k, (woman ? 0.15 : 0.18) * k, right, 1.0, 8);
  gb.capsule(W(...neck), W(...add(neck, [0, 0.06 * k, 0])), 0.05 * k, 0.05 * k);
  // Skirt / dress, or a long coat.
  if (s.long) {
    const wy = W(...waist)[1];
    const hem = woman ? pelvisY * 0.4 : pelvisY * 0.45;
    const c = W(0, 0, 0);
    gb.lathe(c, right, fwd, [[wy, 0.15 * k, 0.11 * k], [(wy + hem + 0.15) / 2, 0.2 * k, 0.15 * k], [hem + 0.15, 0.25 * k, 0.2 * k]]);
  }
  // Arms.
  for (const [sgn, arm] of [[-1, sk.armL], [1, sk.armR]] as const) {
    const sh: V3 = add(chest, [sgn * shoulderW, -0.05 * k, 0]);
    const d1 = limbDir(arm, sgn);
    const elbow = add(sh, scale(d1, 0.3 * k));
    const d2 = limbDir(arm, sgn * 0.6, arm.bend);
    const hand = add(elbow, scale(d2, 0.27 * k));
    gb.capsule(W(...sh), W(...elbow), 0.052 * k, 0.045 * k);
    gb.capsule(W(...elbow), W(...hand), 0.042 * k, 0.036 * k);
    gb.ellipsoid(W(...add(hand, scale(d2, 0.04 * k))), right, fwd, 0.04 * k, 0.05 * k, 0.03 * k, 6, 4);
  }
  // Head (turned by `look`), hair and hats.
  const hf: V3 = [Math.sin(s.yaw + s.look), 0, Math.cos(s.yaw + s.look)];
  const hr: V3 = [hf[2], 0, -hf[0]];
  const hc = W(...headC);
  const hk = k * headK;
  gb.ellipsoid(hc, hr, hf, 0.09 * hk, 0.115 * hk, 0.1 * hk);
  switch (s.hair) {
    case 'long':
      gb.ellipsoid(add(hc, add(scale(hf, -0.04 * hk), [0, -0.07 * hk, 0])), hr, hf, 0.1 * hk, 0.16 * hk, 0.07 * hk, 8, 5);
      break;
    case 'bun':
      gb.ellipsoid(add(hc, add(scale(hf, -0.07 * hk), [0, 0.08 * hk, 0])), hr, hf, 0.05 * hk, 0.05 * hk, 0.05 * hk, 7, 4);
      break;
    case 'hat':
      gb.lathe(hc, hr, hf, [[hc[1] + 0.07 * hk, 0.17 * hk, 0.17 * hk], [hc[1] + 0.085 * hk, 0.15 * hk, 0.15 * hk], [hc[1] + 0.09 * hk, 0.09 * hk, 0.1 * hk], [hc[1] + 0.2 * hk, 0.08 * hk, 0.09 * hk]], 10);
      break;
    case 'cap':
      gb.ellipsoid(add(hc, [0, 0.06 * hk, 0]), hr, hf, 0.095 * hk, 0.06 * hk, 0.105 * hk, 8, 4);
      gb.ellipsoid(add(hc, add(scale(hf, 0.1 * hk), [0, 0.04 * hk, 0])), hr, hf, 0.07 * hk, 0.012 * hk, 0.06 * hk, 6, 3);
      break;
    default:
      break;
  }
}

/**
 * The ghost material: translucent, brighter at the silhouette (Fresnel rim), fogged, drawn after opaque
 * geometry without writing depth.
 */
export function ghostMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uGlow: { value: 1 } }]),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    fog: true,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vC;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mvPosition.xyz;
        vC = color;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uGlow;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vC;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float rim = f * f;
        gl_FragColor = vec4(vC * (0.25 + 1.5 * rim) * uGlow, 0.12 + 0.55 * rim);
        #include <fog_fragment>
      }`,
  });
}

// ---- Crowds ----

function randomPerson(rnd: Rng, x: number, z: number, yaw: number, pose: Pose, body?: Body): FigureSpec {
  const b: Body = body ?? (rnd.chance(0.45) ? 'man' : rnd.chance(0.85) ? 'woman' : 'elder');
  const woman = b === 'woman';
  const hair: Hair = woman ? rnd.pick(['long', 'long', 'bun', 'short', 'hat'] as const) : b === 'elder' ? rnd.pick(['none', 'hat', 'cap'] as const) : rnd.pick(['short', 'short', 'none', 'cap', 'hat'] as const);
  return {
    x,
    z,
    yaw,
    body: b,
    pose,
    color: rnd.pick(GHOST_COLORS),
    hair,
    long: woman ? rnd.chance(0.5) : b === 'man' && rnd.chance(0.2),
    phase: rnd.float(),
    side: rnd.chance(0.5) ? 1 : -1,
    look: (rnd.float() - 0.5) * 0.6,
  };
}

/**
 * Deterministic groups of people along a cell's pavements: lone walkers, couples walking together, people
 * talking face to face, a parent with a child, a few friends chatting, someone on the phone.
 */
export function cellCrowd(plan: CellPlan3, detail: CellDetail, plazas: readonly Rect[] = []): FigureSpec[] {
  const out: FigureSpec[] = [];
  const cell = plan.rect;
  const mine = (x: number, z: number): boolean => x >= cell.x && z >= cell.y && x < cell.x + cell.w && z < cell.y + cell.h;
  const inRect = (q: Rect, x: number, z: number, m: number): boolean => x > q.x - m && x < q.x + q.w + m && z > q.y - m && z < q.y + q.h + m;
  const clear = (x: number, z: number): boolean =>
    !detail.props.some((p) => propDist(p, x, z) < p.radius + (p.kind === 'car' ? 1.6 : 0.8)) &&
    !detail.solids.some((q) => inRect(q, x, z, 0.8)) &&
    !plan.buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + 0.8 && Math.abs(z - b.z) < b.d / 2 + 0.8);
  const onRoad = (r: Road3, side: number, t: number, across: number): [number, number, number, number] => {
    const q = r.rect;
    // (x, z) on the pavement, plus the direction along the road.
    return r.vertical ? [side < 0 ? q.x + across : q.x + q.w - across, t, 0, 1] : [t, side < 0 ? q.y + across : q.y + q.h - across, 1, 0];
  };
  for (const r of plan.roads) {
    if (r.kind === 'coast') continue;
    const q = r.rect;
    const pave = r.sidewalk > 0 ? r.sidewalk : 1.4;
    const rnd = rng(hash(Math.round(q.x * 3), Math.round(q.y * 3), 0x9e0, r.vertical ? 1 : 2));
    const [a, b] = r.vertical ? [q.y, q.y + q.h] : [q.x, q.x + q.w];
    for (const side of [-1, 1]) {
      for (let t = a + 3 + rnd.float() * 6; t < b - 3; t += 9 + rnd.float() * 10) {
        if (!rnd.chance(r.sidewalk > 0 ? 0.55 : 0.3)) continue;
        const across = pave * (0.35 + rnd.float() * 0.3);
        const [x, z, dx, dz] = onRoad(r, side, t, across);
        if (!mine(x, z) || !clear(x, z)) continue;
        const dirYaw = Math.atan2(dx, dz) + (rnd.chance(0.5) ? Math.PI : 0);
        const f: V3 = [Math.sin(dirYaw), 0, Math.cos(dirYaw)];
        const rt: V3 = [f[2], 0, -f[0]];
        const roll = rnd.float();
        const p = (ox: number, oz: number): [number, number] => [x + rt[0] * ox + f[0] * oz, z + rt[2] * ox + f[2] * oz];
        if (roll < 0.3) {
          out.push(randomPerson(rnd, x, z, dirYaw, 'walk'));
        } else if (roll < 0.45) {
          // Couple walking side by side.
          const [x1, z1] = p(-0.35, 0);
          const [x2, z2] = p(0.35, 0.1);
          out.push(randomPerson(rnd, x1, z1, dirYaw, 'walk', 'man'));
          out.push({ ...randomPerson(rnd, x2, z2, dirYaw, 'walk', 'woman'), look: -0.4 });
        } else if (roll < 0.62) {
          // Two people talking, face to face.
          const [x1, z1] = p(0, -0.45);
          const [x2, z2] = p(0, 0.45);
          out.push({ ...randomPerson(rnd, x1, z1, dirYaw, 'talk'), look: 0 });
          out.push({ ...randomPerson(rnd, x2, z2, dirYaw + Math.PI, rnd.chance(0.5) ? 'stand' : 'pockets'), look: 0 });
        } else if (roll < 0.76) {
          // Parent and child holding hands, walking or waiting.
          const walking = rnd.chance(0.6);
          const [x1, z1] = p(-0.28, 0);
          const [x2, z2] = p(0.3, 0);
          const parent = randomPerson(rnd, x1, z1, dirYaw, walking ? 'walk' : 'hold', rnd.chance(0.6) ? 'woman' : 'man');
          out.push({ ...parent, side: 1, pose: walking ? 'walk' : 'hold' });
          out.push({ ...randomPerson(rnd, x2, z2, dirYaw, walking ? 'walk' : 'hold', 'child'), side: -1, hair: rnd.pick(['short', 'cap', 'bun'] as const), long: false, look: -0.3, phase: parent.phase + 0.5 });
        } else if (roll < 0.88) {
          // Friends chatting in a loose circle.
          const n = rnd.int(3, 4);
          for (let i = 0; i < n; i++) {
            const ang = (i / n) * Math.PI * 2 + rnd.float() * 0.4;
            const [xi, zi] = [x + Math.sin(ang) * 0.6, z + Math.cos(ang) * 0.6];
            out.push({ ...randomPerson(rnd, xi, zi, ang + Math.PI, rnd.pick(['talk', 'stand', 'pockets', 'phone'] as const)), look: (rnd.float() - 0.5) * 0.8 });
          }
        } else if (roll < 0.95) {
          // On the phone, facing the street from the building side.
          const [x1, z1] = onRoad(r, side, t, pave - 0.4);
          out.push(randomPerson(rnd, x1, z1, Math.atan2(r.vertical ? -side : 0, r.vertical ? 0 : -side), 'phone'));
        } else {
          out.push(randomPerson(rnd, x, z, dirYaw + Math.PI / 2, 'wave'));
        }
      }
    }
  }
  // Plazas (a busy square of people crossing, waiting to meet someone, and standing in groups), and more
  // thinly the open ground: tower plazas, park paths, playgrounds.
  const areas = [...plazas.map((rect) => ({ rect, density: 0.5 })), ...detail.open.flatMap((o) => o.crowd)];
  for (const { rect: q, density } of areas) {
    const rnd = rng(hash(Math.round(q.x), Math.round(q.y), 0x9e1));
    for (let x = q.x + 2.5; x < q.x + q.w - 2; x += 4.2) {
      for (let z = q.y + 2.5; z < q.y + q.h - 2; z += 4.2) {
        if (!rnd.chance(density)) continue;
        const px = x + (rnd.float() - 0.5) * 2.4;
        const pz = z + (rnd.float() - 0.5) * 2.4;
        if (!mine(px, pz) || !clear(px, pz)) continue;
        const yaw = rnd.float() * Math.PI * 2;
        const roll = rnd.float();
        if (roll < 0.45) {
          out.push(randomPerson(rnd, px, pz, yaw, 'walk'));
        } else if (roll < 0.6) {
          const [sx, sz] = [Math.cos(yaw) * 0.35, -Math.sin(yaw) * 0.35];
          out.push(randomPerson(rnd, px - sx, pz - sz, yaw, 'walk', 'man'));
          out.push({ ...randomPerson(rnd, px + sx, pz + sz, yaw, 'walk', 'woman'), look: -0.4 });
        } else if (roll < 0.8) {
          out.push(randomPerson(rnd, px, pz, yaw, rnd.pick(['phone', 'pockets', 'stand'] as const)));
        } else {
          const n = rnd.int(2, 4);
          for (let i = 0; i < n; i++) {
            const ang = (i / n) * Math.PI * 2 + rnd.float() * 0.4;
            out.push({ ...randomPerson(rnd, px + Math.sin(ang) * 0.6, pz + Math.cos(ang) * 0.6, ang + Math.PI, rnd.pick(['talk', 'stand', 'pockets', 'phone'] as const)), look: (rnd.float() - 0.5) * 0.8 });
          }
        }
      }
    }
  }
  return out;
}
