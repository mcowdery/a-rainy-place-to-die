import * as THREE from 'three';
import { KIND, MeshBuilder } from '../real/meshBuilder';
import { bodyShape, type BodyShape, type CarType } from './vehicles';

/**
 * Windscreen wipers. A car's windscreen is taken as a plane from its foot (the scuttle) to its top (the roof's
 * edge), with coordinates s across it (the car's x: +left) and t up it (m); a pair of wipers in tandem, as a
 * right-hand-drive car has them: pivots at the driver's corner and just right of the middle, both lying toward the
 * passenger's side at rest and sweeping up to stand by the driver's pillar. They park below the glass, on the
 * scuttle (`WIPER_PARK`), so from the driver's seat they lie under the bottom of the view, not across it. One layout (`wiperLayout`, pure) gives
 * the blades their place (`wiperMatrix`), the city shader the fans they clear of rain and snow (real/city.ts
 * `wiped`, its uniforms from `wiperUniforms`) and the cabin's windscreen the same from inside
 * (models/carInterior.ts), so the three agree.
 *
 * The beat (`wiperBeat`): a sweep up and back takes `WIPER_SWEEP_S`; in light rain the blades rest between sweeps.
 * A wiper's `phase` counts sweeps: 0 to 1 is one sweep (up to 0.5, back by 1), then it rests until the beat is up.
 */

export interface WiperLayout {
  /** The glass's foot in the car's frame (z forward of its middle, y up from the ground), the unit vector up the
   * blades' plane (z, y: it leans back) and the glass's length up it (m). */
  readonly foot: readonly [number, number];
  readonly up: readonly [number, number];
  readonly height: number;
  /** Half the glass's width at its foot and at its top. */
  readonly half: readonly [number, number];
  /** The two pivots (s) and the blades' length (m). */
  readonly pivots: readonly [number, number];
  readonly length: number;
  /** How far the blades stand off their plane (m): clear of the glass's curve. */
  readonly stand: number;
  /** The same parked, lying along the scuttle: clear of the body there. */
  readonly rest: number;
}

/**
 * Where the pivots are up the blades' plane (m): below the glass's foot, on the scuttle, where the blades park. (A
 * sports car's driver sits with his eyes barely 14 cm over the glass's foot: blades parked on the glass lay across
 * the road ahead.)
 */
export const WIPER_PARK = -0.08;

/** How far a blade swings from its rest along the foot (rad). */
export const WIPER_SWEEP = 1.5;
/** One sweep, up and back (s). */
export const WIPER_SWEEP_S = 1.15;
/** The share of a blade (from its pivot) that carries no rubber: the fan's inner edge. */
export const WIPER_INNER = 0.22;
const layouts = new Map<CarType, WiperLayout>();

export function wiperLayout(type: CarType): WiperLayout {
  let L = layouts.get(type);
  if (L) return L;
  const B = bodyShape(type);
  const w0 = B.windscreen[0];
  const w1 = glassFoot(B);
  const half = B.L / 2;
  // The glass's profile from its foot up (z, y), and its length.
  const prof: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const x = w1 + ((w0 - w1) * i) / 24;
    prof.push([x - half, B.top(x)]);
  }
  let height = 0;
  for (let i = 1; i < prof.length; i++) height += Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]);
  const halfFoot = Math.max(glassHalf(B, w1), glassHalf(B, w0));
  // (As long as leaves the first clear of the second's pivot, lying parked; `reach`: how far up the glass they get.)
  const length = Math.min(halfFoot * 0.83, height * 0.86 - WIPER_PARK);
  const reach = length + WIPER_PARK;
  // The blades' plane: from the foot to the glass as far up it as they reach (a windscreen is curved; the blades
  // work its lower part), standing off it by as much as the glass bulges between.
  let top = prof[prof.length - 1];
  for (const q of prof) {
    if (Math.hypot(q[0] - prof[0][0], q[1] - prof[0][1]) >= reach) {
      top = q;
      break;
    }
  }
  const dz = top[0] - prof[0][0];
  const dy = top[1] - prof[0][1];
  const d = Math.hypot(dz, dy);
  const up: [number, number] = [dz / d, dy / d];
  let bulge = 0;
  for (const q of prof) {
    const t = (q[0] - prof[0][0]) * up[0] + (q[1] - prof[0][1]) * up[1];
    if (t > reach * 1.05) break;
    // (Out of the plane: its normal is (z: up.y, y: -up.z).)
    bulge = Math.max(bulge, (q[0] - prof[0][0]) * up[1] - (q[1] - prof[0][1]) * up[0]);
  }
  // Parked, the blades lie on the body below the glass: clear of it there (the bonnet is flatter than the glass).
  let rest = 0;
  for (let d = 0; d <= 0.2; d += 0.01) {
    const z = w1 + d - half - prof[0][0];
    const y = B.top(w1 + d) - prof[0][1];
    const t = z * up[0] + y * up[1];
    if (t < WIPER_PARK - 0.03) break;
    if (t <= WIPER_PARK + 0.04) rest = Math.max(rest, z * up[1] - y * up[0]);
  }
  L = {
    foot: prof[0],
    up,
    height,
    half: [halfFoot, glassHalf(B, w0)],
    pivots: [-halfFoot * 0.9, -halfFoot * 0.9 + Math.min(length * 1.02, halfFoot * 0.85)],
    length,
    stand: bulge + 0.016,
    rest: rest + 0.014,
  };
  layouts.set(type, L);
  return L;
}

/**
 * Where the windscreen's glass really starts (x from the rear): the body is still bonnet (the scuttle) while its
 * top is within 14 cm of the beltline, as models/vehicles.ts paints it.
 */
function glassFoot(B: BodyShape): number {
  const [w0, w1] = B.windscreen;
  for (let x = w1; x > w0; x -= 0.01) {
    if (B.top(x) - Math.min(B.belt(x), B.top(x) - 0.02) >= 0.14) return Math.min(w1, x + 0.01);
  }
  return w1;
}

/** Half the glass's width at x: the roof's width less its rounded edge (the body's section, models/vehicles.ts). */
function glassHalf(B: BodyShape, x: number): number {
  return Math.max(0.2, B.halfW(x) - B.roofInset) - 0.05;
}

/**
 * The windscreen from inside, as rows from its foot to its top: where each is (z, y in the car's frame), half its
 * width there, and its place up the wipers' plane (t, m). For the cabin's glass (models/carInterior.ts).
 */
export function glassRows(type: CarType, n = 8): { z: number; y: number; half: number; t: number }[] {
  const B = bodyShape(type);
  const L = wiperLayout(type);
  const w0 = B.windscreen[0];
  const w1 = glassFoot(B);
  const rows = [];
  for (let i = 0; i <= n; i++) {
    const x = w1 + ((w0 - w1) * i) / n;
    const z = x - B.L / 2;
    const y = B.top(x);
    rows.push({ z, y, half: glassHalf(B, x), t: (z - L.foot[0]) * L.up[0] + (y - L.foot[1]) * L.up[1] });
  }
  return rows;
}

/** How long a beat is, in sweeps (1: no rest between them), by how hard it's raining (0-1) or snowing. */
export function wiperBeat(rain: number, snowing = false): number {
  return snowing || rain > 0.45 ? 1 : rain > 0.2 ? 1.8 : 3;
}

/** A wiper's phase (in sweeps, 0 to `beat`) at `time` (s), `offset` (0-1) its own place in the beat. */
export function wiperPhase(time: number, beat: number, offset = 0): number {
  return ((time / WIPER_SWEEP_S + offset * beat) % beat + beat) % beat;
}

/** How far through its swing a blade is (0 at rest, 1 upright) at `phase`. */
export function wiperSwing(phase: number): number {
  return phase >= 1 ? 0 : 1 - Math.abs(2 * phase - 1);
}

/**
 * One wiper for a blade of length 1 (scaled along x to its car's), lying along +x from its pivot at the origin,
 * y up the glass, z out of it: the arm from the spindle, and the blade it carries.
 */
export function wiperGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder(256);
  mb.kind = KIND.plain;
  mb.color = [0.012, 0.012, 0.014];
  // (MeshBuilder is x, y up, z: here its y is out of the glass and its z down the glass.)
  mb.beam([0, 0.004, 0], [0.62, 0.02, 0], 0.012);
  mb.box(0.61, 0, 0.002, 0.016, 0.78, 0.012, KIND.plain, true);
  mb.box(0, 0, 0, 0.02, 0.05, 0.03, KIND.plain);
  const g = mb.build()!;
  // To the wiper's frame: x along, y up the glass (the builder's -z), z out of it (the builder's y).
  g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0)));
  return g;
}

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _o = new THREE.Vector3();

/** Wiper k's place in the car's frame at `swing` (0 at rest to 1 upright), for `wiperGeometry`. */
export function wiperMatrix(L: WiperLayout, k: 0 | 1, swing: number, out: THREE.Matrix4): THREE.Matrix4 {
  // The glass's frame in the car's: s across (+x), t up the glass, n out of it.
  const [uz, uy] = L.up;
  const a = swing * WIPER_SWEEP + 0.03;
  const c = Math.cos(a);
  const s = Math.sin(a);
  _x.set(c, s * uy, s * uz).multiplyScalar(L.length);
  _y.set(-s, c * uy, c * uz);
  _z.set(0, -uz, uy);
  // (Off the scuttle parked; off the glass's bulge once it's up on it.)
  const stand = L.rest + (L.stand - L.rest) * Math.min(1, swing * 3);
  _o.set(L.pivots[k], L.foot[1] + uy * WIPER_PARK, L.foot[0] + uz * WIPER_PARK).addScaledVector(_z, stand);
  return out.makeBasis(_x, _y, _z).setPosition(_o);
}

/** What the city shader needs of a car's wipers: (foot z, foot y, the glass's rake, the blades' length) and
 * (pivot, pivot, phase, 0). */
export function wiperUniforms(L: WiperLayout, phase: number, glass: THREE.Vector4, pivots: THREE.Vector4): void {
  glass.set(L.foot[0], L.foot[1], Math.atan2(L.up[1], L.up[0]), L.length);
  pivots.set(L.pivots[0], L.pivots[1], phase, 0);
}

/**
 * GLSL: how much of the glass at (s, t) the wipers have cleared. Returns x: in a blade's fan (0-1), and y: how
 * long ago the blade passed, in sweeps (0 just now). pv: the pivots (xy) and the phase (z); len: the blades'.
 */
export const WIPER_GLSL = /* glsl */ `
  vec2 wiperFan(vec2 st, vec3 pv, float len, float beat) {
    vec2 w = vec2(0.0, 9.0);
    for (int k = 0; k < 2; k++) {
      vec2 q = vec2(st.x - (k == 0 ? pv.x : pv.y), st.y - (${WIPER_PARK.toFixed(3)}));
      float r = length(q) / len;
      float a = atan(q.y, q.x) / ${WIPER_SWEEP.toFixed(3)};
      float m = smoothstep(${WIPER_INNER.toFixed(2)}, ${(WIPER_INNER + 0.03).toFixed(2)}, r) * (1.0 - smoothstep(0.97, 1.0, r)) * step(0.0, a) * step(a, 1.0);
      if (m <= 0.0) continue;
      // The blade passes this angle going up and coming back.
      float since = min(mod(pv.z - a * 0.5, beat), mod(pv.z - 1.0 + a * 0.5, beat));
      if (since < w.y) w = vec2(m, since);
    }
    return w;
  }
`;

/**
 * The wipers of the cars near the camera, as one instanced mesh on the city material (two blades a car): the
 * traffic's, which share their bodies and so can't carry their own.
 */
export class WiperSet {
  readonly mesh: THREE.InstancedMesh;
  private readonly local = new THREE.Matrix4();

  constructor(material: THREE.Material, cars: number) {
    this.mesh = new THREE.InstancedMesh(wiperGeometry(), material, cars * 2);
    this.mesh.count = 0;
    // The instances move every frame and may be anywhere: no bounds to cull by.
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  /** The cars whose wipers are going: each one's model, its body's matrix (posed) and its phase. */
  update(cars: readonly { type: CarType; matrix: THREE.Matrix4; phase: number }[]): void {
    let n = 0;
    for (const c of cars) {
      if (n + 2 > this.mesh.instanceMatrix.count) break;
      const L = wiperLayout(c.type);
      const swing = wiperSwing(c.phase);
      for (const k of [0, 1] as const) this.mesh.setMatrixAt(n++, wiperMatrix(L, k, swing, this.local).premultiply(c.matrix));
    }
    if (n > 0) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
  }
}
