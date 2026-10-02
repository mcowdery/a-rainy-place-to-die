import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { add, canvas, gaugeTexture, hex, mirror, pipe, plateTexture, rod, shell, v, type Bike, type V } from './bikeKit';

export type { Bike } from './bikeKit';

/**
 * The bōsōzoku bike Mack takes on his first night: an invented late-70s 400cc air-cooled four, the Seika
 * Shiden 400F (紫電, "purple lightning"), customised as a gang leader's kaizōsha: a rocket cowl with a
 * three-tier smoked windscreen (三段シールド), tall oni-han bars, a three-step seat with a tall backrest
 * (三段シート), takeyari exhausts rising straight up behind it, a raised long tail, candy paint with white
 * stripes and gold pinstripes. Built like the shotgun (its own meshes and materials, for close-up and
 * first-person views), in metres.
 *
 * The bike's frame: -z forward, +y up, x to the rider's right; the origin on the ground under the middle of
 * the wheelbase. `steer` turns about the steering axis (the forks, front wheel, bars, gauges; the rocket
 * cowl is frame-mounted and stays); the wheels spin about x. `rider` gives the points a rider's body needs.
 */

export interface BikeLook {
  /** Candy base colour. */
  readonly paint: number;
  /** The stripes along the tank, cowl and tail. */
  readonly stripe: number;
  /** The fine lines beside each stripe. */
  readonly pinstripe: number;
}

export const BOSOZOKU_LOOK: BikeLook = { paint: 0x4a1470, stripe: 0xf2efe8, pinstripe: 0xd4a640 };

// --- the layout (bike frame) ---
const FRONT_AXLE = v(0, 0.315, -0.78);
const REAR_AXLE = v(0, 0.325, 0.64);
const HEAD = v(0, 0.98, -0.46);
const STEER_AXIS = HEAD.clone().sub(FRONT_AXLE).normalize();
const PIVOT = v(0, 0.4, 0.16);

// --- painted textures ---

/** The paint on a loft's UVs (u along, v round from the right side's middle): candy base, a white stripe
 * along each side with a gold pinstripe either side. */
function paintTexture(look: BikeLook): THREE.CanvasTexture {
  return canvas(64, 512, (g) => {
    const H = 512;
    g.fillStyle = hex(look.paint);
    g.fillRect(0, 0, 64, H);
    // A soft darker band underneath, the candy deepening away from the light.
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(0,0,0,0.18)');
    grad.addColorStop(0.25, 'rgba(0,0,0,0)');
    grad.addColorStop(0.75, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.18)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, H);
    // Round the section v runs 0 (right side, middle) -> 0.25 (top) -> 0.5 (left) -> 0.75 (bottom): a stripe on
    // each side a little above the middle.
    // (Canvas rows run top-down, UVs bottom-up.)
    for (const c of [0.12, 0.38]) {
      const y = (1 - c) * H;
      g.fillStyle = hex(look.stripe);
      g.fillRect(0, y - 18, 64, 36);
      g.fillStyle = hex(look.pinstripe);
      g.fillRect(0, y - 27, 64, 4);
      g.fillRect(0, y + 23, 64, 4);
    }
  });
}

// --- materials ---

function materials(env: THREE.Texture | null, look: BikeLook) {
  const std = (o: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ envMap: env, ...o });
  return {
    paint: new THREE.MeshPhysicalMaterial({ map: paintTexture(look), metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, envMap: env, envMapIntensity: 1.2 }),
    paintPlain: new THREE.MeshPhysicalMaterial({ color: look.paint, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, envMap: env, envMapIntensity: 1.2 }),
    chrome: std({ color: 0xd2d5da, metalness: 1, roughness: 0.16, envMapIntensity: 0.55 }),
    alu: std({ color: 0xa8acb2, metalness: 1, roughness: 0.42, envMapIntensity: 0.6 }),
    black: std({ color: 0x0b0b0d, metalness: 0.3, roughness: 0.3, envMapIntensity: 0.8 }),
    matte: std({ color: 0x141416, metalness: 0.2, roughness: 0.7, envMapIntensity: 0.5 }),
    rubber: std({ color: 0x121213, roughness: 0.92, envMapIntensity: 0.2 }),
    vinyl: std({ color: 0x0d0d10, roughness: 0.42, metalness: 0, envMapIntensity: 0.6 }),
    gold: std({ color: 0xc8a048, metalness: 1, roughness: 0.3, envMapIntensity: 1.2 }),
    screen: new THREE.MeshPhysicalMaterial({ color: 0x0e1218, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.72, side: THREE.DoubleSide, envMap: env, envMapIntensity: 1.4, depthWrite: false, forceSinglePass: true }),
    head: std({ color: 0xf0eee6, emissive: new THREE.Color(1, 0.96, 0.86), emissiveIntensity: 0.2, roughness: 0.1 }),
    tail: std({ color: 0x5a0606, emissive: new THREE.Color(1, 0.05, 0.03), emissiveIntensity: 0.15, roughness: 0.2 }),
    amber: std({ color: 0xd07010, emissive: new THREE.Color(1, 0.45, 0.05), emissiveIntensity: 0.1, roughness: 0.2 }),
    plate: std({ map: plateTexture(), roughness: 0.5 }),
  };
}
type Mats = ReturnType<typeof materials>;

// --- parts ---

/** A wheel at the origin, spinning about x: tyre, rim, a cast six-spoke, hub, and its brake. */
function wheel(m: Mats, r: number, width: number, front: boolean): THREE.Group {
  const g = new THREE.Group();
  const rimR = r - 0.075;
  // Tyre: a rounded profile turned about the axle.
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = -Math.PI / 2 + (i / 16) * Math.PI;
    prof.push(new THREE.Vector2(rimR + 0.02 + (r - rimR - 0.02) * (0.55 + 0.45 * Math.cos(a)) + 0.0, (width / 2) * Math.sin(a) * 0.98));
  }
  prof.unshift(new THREE.Vector2(rimR, -width * 0.42));
  prof.push(new THREE.Vector2(rimR, width * 0.42));
  add(g, new THREE.LatheGeometry(prof, 48).rotateZ(Math.PI / 2), m.rubber);
  // Rim: an aluminium hoop with a lip each side.
  const rim = [new THREE.Vector2(rimR - 0.02, -width * 0.4), new THREE.Vector2(rimR + 0.004, -width * 0.42), new THREE.Vector2(rimR + 0.004, width * 0.42), new THREE.Vector2(rimR - 0.02, width * 0.4), new THREE.Vector2(rimR - 0.024, 0)];
  add(g, new THREE.LatheGeometry(rim, 48).rotateZ(Math.PI / 2), m.gold);
  // Hub and six cast spokes, tapering out to the rim.
  add(g, rod(v(-width * 0.38, 0, 0), v(width * 0.38, 0, 0), 0.045, 20), m.gold);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const d = v(0, Math.cos(a), Math.sin(a));
    add(g, rod(d.clone().multiplyScalar(0.04), d.clone().multiplyScalar(rimR - 0.018), 0.014, 8, 0.009).scale(1.6, 1, 1), m.gold);
  }
  // Brakes: twin drilled-look discs and calipers in front, a disc and sprocket behind.
  for (const s of front ? [1, -1] : [1]) {
    const disc = new THREE.CylinderGeometry(0.135, 0.135, 0.005, 40).rotateZ(Math.PI / 2).translate(s * (width * 0.36 + 0.012), 0, 0);
    add(g, disc, m.alu);
  }
  if (!front) {
    add(g, new THREE.CylinderGeometry(0.11, 0.11, 0.006, 36).rotateZ(Math.PI / 2).translate(-width * 0.45 - 0.012, 0, 0), m.black);
  }
  return g;
}

function tank(g: THREE.Group, m: Mats): void {
  // A teardrop over the frame's top tube, deepest at the knees, rising toward the head.
  const c = [v(0, 0.885, 0.03), v(0, 0.91, -0.04), v(0, 0.94, -0.16), v(0, 0.965, -0.28), v(0, 0.98, -0.37), v(0, 0.985, -0.42)];
  add(g, shell(c, [0.07, 0.13, 0.165, 0.16, 0.12, 0.06], [0.04, 0.085, 0.1, 0.095, 0.075, 0.035], 2.2), m.paint);
  // Cap, chrome.
  add(g, rod(v(0, 1.05, -0.24), v(0, 1.07, -0.24), 0.035, 24), m.chrome);
}

/** The three-step seat: the rider's pad, the passenger's raised behind it, the tall backrest. */
function seat(g: THREE.Group, m: Mats): number {
  add(g, new RoundedBoxGeometry(0.28, 0.07, 0.36, 4, 0.03).translate(0, 0.835, 0.21), m.vinyl);
  add(g, new RoundedBoxGeometry(0.27, 0.11, 0.24, 4, 0.035).translate(0, 0.93, 0.5), m.vinyl);
  // The backrest: tall, a little raked back, rolled at the top; on a chrome hoop.
  add(g, new RoundedBoxGeometry(0.26, 0.5, 0.075, 4, 0.03).rotateX(-0.12).translate(0, 1.23, 0.66), m.vinyl);
  mirror((s) => add(g, pipe([v(s * 0.1, 0.9, 0.58), v(s * 0.12, 1.2, 0.72), v(s * 0.08, 1.5, 0.74)], 0.009, 24, 8), m.chrome));
  // Piping where the rider's pad meets the passenger's step.
  add(g, rod(v(-0.135, 0.875, 0.385), v(0.135, 0.875, 0.385), 0.01, 10), m.chrome);
  return 0.87;
}

/** The rocket cowl: a long nose shell ahead of the head, the headlight in its tip, the three-tier smoked
 * screen stacked on it (frame-mounted). */
function cowl(g: THREE.Group, m: Mats): void {
  const c = [v(0, 1.0, -0.5), v(0, 1.01, -0.6), v(0, 1.0, -0.72), v(0, 0.98, -0.84), v(0, 0.965, -0.93)];
  add(g, shell(c, [0.2, 0.21, 0.19, 0.15, 0.115], [0.16, 0.165, 0.15, 0.12, 0.1], 2.2, 40, false), m.paint);
  // The headlight: a chrome ring and the lens, in the nose.
  add(g, new THREE.TorusGeometry(0.098, 0.012, 10, 40).translate(0, 0.965, -0.93), m.chrome);
  add(g, new THREE.CircleGeometry(0.096, 40).rotateY(Math.PI).translate(0, 0.965, -0.932), m.head);
  // The three-tier screen: one tall curved smoked panel raked back from the cowl, chrome bands marking its
  // tiers, each tier narrowing a little as it rises.
  const scr = new THREE.Group();
  scr.position.set(0, 1.1, -0.66);
  scr.rotation.x = -0.42;
  g.add(scr);
  const R = 0.22;
  const H = 0.44;
  const arc = Math.PI * 0.62;
  const panel = new THREE.CylinderGeometry(R * 0.82, R, H, 40, 6, true, Math.PI - arc / 2, arc).translate(0, H / 2, R);
  add(scr, panel, m.screen);
  for (let i = 0; i < 4; i++) {
    const y = (i / 3) * H;
    const r = R + (R * 0.82 - R) * (i / 3);
    add(scr, new THREE.TorusGeometry(r + 0.003, i === 0 || i === 3 ? 0.006 : 0.0045, 6, 40, arc).rotateX(Math.PI / 2).rotateY(Math.PI / 2 + arc / 2).translate(0, y, R), m.chrome);
  }
  // Turn signals on stalks either side of the cowl.
  mirror((s) => {
    add(g, rod(v(s * 0.2, 0.97, -0.62), v(s * 0.29, 0.97, -0.64), 0.008, 8), m.black);
    add(g, new THREE.SphereGeometry(0.028, 16, 10).scale(1, 0.8, 1.3).translate(s * 0.3, 0.97, -0.65), m.amber);
  });
}

/** Steering: the forks, front wheel and fender, the oni-han bars, grips, levers, mirrors and gauges. */
function front(m: Mats, wheelR: number): { steer: THREE.Group; inner: THREE.Group; wheelG: THREE.Group; gripL: V; gripR: V; axisL: V; axisR: V } {
  const steer = new THREE.Group();
  steer.position.copy(HEAD);
  const inner = new THREE.Group();
  inner.position.copy(HEAD).negate();
  steer.add(inner);
  const g = inner;
  // Fork legs along the steering axis: chrome stanchions above, black sliders down to the axle.
  const top = HEAD.clone().addScaledVector(STEER_AXIS, 0.06);
  mirror((s) => {
    const off = v(s * 0.1, 0, 0);
    const mid = FRONT_AXLE.clone().addScaledVector(STEER_AXIS, 0.3).add(off);
    add(g, rod(mid, top.clone().add(off), 0.019, 18), m.chrome);
    add(g, rod(FRONT_AXLE.clone().add(off), mid, 0.027, 18), m.black);
    // The caliper on each disc.
    add(g, new RoundedBoxGeometry(0.03, 0.09, 0.05, 2, 0.01).translate(s * 0.075, FRONT_AXLE.y + 0.09, FRONT_AXLE.z + 0.08), m.black);
  });
  // Triple clamps.
  for (const k of [0.0, 0.09]) {
    const p = HEAD.clone().addScaledVector(STEER_AXIS, k - 0.04);
    add(g, new RoundedBoxGeometry(0.26, 0.03, 0.08, 2, 0.01).translate(p.x, p.y, p.z), m.alu);
  }
  // Front wheel and fender.
  const wheelG = wheel(m, wheelR, 0.09, true);
  wheelG.position.copy(FRONT_AXLE);
  g.add(wheelG);
  // (A cylinder's segment at angle a lies at y = r sin a, z = r cos a once turned onto x: over the top and
  // ahead of the tyre is a from about 70 to 160 degrees.)
  add(g, new THREE.CylinderGeometry(wheelR + 0.035, wheelR + 0.035, 0.11, 32, 1, true, 1.2, 1.6).rotateZ(Math.PI / 2).translate(FRONT_AXLE.x, FRONT_AXLE.y, FRONT_AXLE.z), m.paintPlain);
  // Oni-han: tall bars rising from the top clamp, then back to the grips at chest height.
  const clamp = HEAD.clone().addScaledVector(STEER_AXIS, 0.07);
  let gripL = v(0, 0, 0);
  let gripR = v(0, 0, 0);
  mirror((s) => {
    const pts = [v(s * 0.07, clamp.y, clamp.z), v(s * 0.1, clamp.y + 0.2, clamp.z - 0.06), v(s * 0.16, clamp.y + 0.42, clamp.z - 0.03), v(s * 0.2, clamp.y + 0.47, clamp.z + 0.07), v(s * 0.25, clamp.y + 0.45, clamp.z + 0.13)];
    add(g, pipe(pts, 0.011, 48, 10), m.chrome);
    // Grip and bar end.
    const end = pts[pts.length - 1];
    const grip = end.clone().add(v(s * 0.06, 0, 0.01));
    add(g, rod(end.clone().add(v(-s * 0.005, 0, 0)), grip.clone().add(v(s * 0.06, 0, 0.01)), 0.017, 14), m.rubber);
    if (s > 0) gripR = grip.clone();
    else gripL = grip.clone();
    // Lever ahead of the grip, its perch.
    add(g, pipe([end.clone().add(v(-s * 0.02, 0, -0.02)), end.clone().add(v(s * 0.06, -0.01, -0.07)), end.clone().add(v(s * 0.15, -0.02, -0.06))], 0.005, 16, 6), m.alu);
    // Mirrors on tall stalks.
    const m0 = end.clone().add(v(-s * 0.06, 0, -0.01));
    const m1 = m0.clone().add(v(s * 0.1, 0.22, -0.02));
    add(g, rod(m0, m1, 0.006, 8), m.chrome);
    add(g, new THREE.CylinderGeometry(0.055, 0.055, 0.02, 24).rotateX(Math.PI / 2 - 0.15).translate(m1.x + s * 0.02, m1.y + 0.03, m1.z), m.black);
    // A chrome rim round the dark glass (the glass a black mirror: it shows the night, not the studio lights).
    add(g, new THREE.TorusGeometry(0.055, 0.005, 6, 24).rotateX(-0.15).translate(m1.x + s * 0.02, m1.y + 0.03, m1.z), m.chrome);
  });
  // Gauges on the top clamp, faces to the rider: speedometer left, tachometer right.
  const faces = [gaugeTexture(180, 20, 'km/h'), gaugeTexture(12, 1, '×1000 r/min')];
  // Their faces look up and back at the rider.
  const n = v(0, Math.sin(1.0), Math.cos(1.0));
  [-1, 1].forEach((side, i) => {
    const p = clamp.clone().add(v(side * 0.075, 0.07, 0.03));
    add(g, new THREE.CylinderGeometry(0.052, 0.046, 0.06, 28).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), n)).translate(p.x, p.y, p.z), m.black);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.046, 32), new THREE.MeshStandardMaterial({ map: faces[i], roughness: 0.3, emissive: 0xffffff, emissiveMap: faces[i], emissiveIntensity: 0.08 }));
    face.quaternion.setFromUnitVectors(v(0, 0, 1), n);
    face.position.copy(p).addScaledVector(n, 0.031);
    g.add(face);
    add(g, new THREE.TorusGeometry(0.048, 0.004, 6, 32).applyQuaternion(face.quaternion).translate(face.position.x, face.position.y, face.position.z), m.chrome);
  });
  // The grips run out from the bar ends, a little back.
  return { steer, inner, wheelG, gripL, gripR, axisL: v(-0.06, 0, 0.01).normalize(), axisR: v(0.06, 0, 0.01).normalize() };
}

function engine(g: THREE.Group, m: Mats): void {
  // Crankcase.
  add(g, new RoundedBoxGeometry(0.36, 0.22, 0.42, 4, 0.05).translate(0, 0.38, -0.06), m.alu);
  // The block, tilted forward, finned: a stack of thin plates, then the head and the cam cover.
  const blk = new THREE.Group();
  blk.position.set(0, 0.48, -0.12);
  blk.rotation.x = 0.3;
  g.add(blk);
  for (let i = 0; i < 11; i++) add(blk, new RoundedBoxGeometry(0.42, 0.008, 0.2, 2, 0.003).translate(0, 0.02 + i * 0.019, 0), m.alu);
  add(blk, new RoundedBoxGeometry(0.3, 0.2, 0.15, 2, 0.02).translate(0, 0.11, 0), m.matte);
  add(blk, new RoundedBoxGeometry(0.34, 0.06, 0.17, 3, 0.02).translate(0, 0.245, 0), m.alu);
  // Carburettors behind the block, one a cylinder.
  for (const x of [-0.12, -0.04, 0.04, 0.12]) add(g, rod(v(x, 0.66, 0.0), v(x, 0.61, 0.1), 0.026, 14), m.alu);
  // Side covers: the alternator's round chrome cover on the left, the clutch's on the right.
  add(g, new THREE.CylinderGeometry(0.095, 0.095, 0.025, 32).rotateZ(Math.PI / 2).translate(-0.19, 0.38, -0.06), m.chrome);
  add(g, new RoundedBoxGeometry(0.03, 0.16, 0.2, 3, 0.012).translate(0.19, 0.39, -0.02), m.chrome);
  // Oil cooler ahead of the engine.
  add(g, new RoundedBoxGeometry(0.24, 0.06, 0.03, 2, 0.008).translate(0, 0.72, -0.37), m.black);
}

/** Four headers sweeping down from the head, into two takeyari pipes running back and rising straight up
 * behind the seat. */
function exhaust(g: THREE.Group, m: Mats): void {
  for (const x of [-0.12, -0.04, 0.04, 0.12]) {
    const side = Math.sign(x);
    add(g, pipe([v(x, 0.66, -0.3), v(x * 1.05, 0.55, -0.4), v(x * 1.15, 0.32, -0.36), v(side * 0.17, 0.22, -0.18), v(side * 0.2, 0.22, 0.0)], 0.017, 48, 10), m.chrome);
  }
  mirror((s) => {
    const pts = [v(s * 0.2, 0.22, 0.0), v(s * 0.22, 0.25, 0.3), v(s * 0.23, 0.34, 0.6), v(s * 0.24, 0.6, 0.78), v(s * 0.24, 1.2, 0.86), v(s * 0.24, 1.72, 0.92)];
    add(g, pipe(pts, 0.03, 96, 14), m.chrome);
    // The cut end, a little flared, dark inside.
    const top = pts[pts.length - 1];
    add(g, rod(top.clone().add(v(0, -0.02, 0)), top.clone().add(v(0, 0.03, 0.004)), 0.03, 20, 0.036), m.chrome);
    add(g, new THREE.CircleGeometry(0.03, 20).rotateX(-Math.PI / 2).translate(top.x, top.y + 0.029, top.z + 0.004), m.rubber);
  });
}

function frameAndRear(g: THREE.Group, m: Mats, rearR: number): THREE.Group {
  // Double-cradle frame, black: the backbone from the head over the engine to the seat, the down tubes under
  // it, the seat rails out to the tail.
  mirror((s) => {
    const x = s * 0.07;
    add(g, pipe([v(0, HEAD.y + 0.02, HEAD.z + 0.02), v(x * 0.5, 0.94, -0.2), v(x, 0.87, 0.12), v(x * 1.4, 0.82, 0.3)], 0.02, 32, 10), m.black);
    add(g, pipe([v(x, HEAD.y - 0.05, HEAD.z + 0.01), v(x * 1.3, 0.62, -0.42), v(x * 1.6, 0.27, -0.3), v(x * 1.7, 0.24, 0.05), v(x * 1.6, 0.36, 0.17), v(x * 1.4, 0.82, 0.3)], 0.018, 48, 10), m.black);
    add(g, pipe([v(x * 1.4, 0.82, 0.3), v(x * 1.5, 0.84, 0.55), v(x * 1.3, 0.92, 0.78)], 0.015, 24, 8), m.black);
  });
  // Side cover under the seat, in the paint.
  mirror((s) => add(g, new RoundedBoxGeometry(0.03, 0.15, 0.22, 3, 0.012).translate(s * 0.12, 0.72, 0.2), m.paintPlain));
  // Swingarm and twin shocks (chrome springs on black bodies).
  const arm = new THREE.Group();
  g.add(arm);
  mirror((s) => {
    add(arm, rod(v(s * 0.1, PIVOT.y, PIVOT.z), v(s * 0.1, REAR_AXLE.y, REAR_AXLE.z), 0.02, 12), m.black);
    const lo = v(s * 0.12, REAR_AXLE.y + 0.04, REAR_AXLE.z - 0.04);
    const hi = v(s * 0.12, 0.84, 0.48);
    add(g, rod(lo, hi, 0.018, 12), m.black);
    const spring = new THREE.Group();
    g.add(spring);
    const coil = new THREE.CatmullRomCurve3(Array.from({ length: 60 }, (_, i) => {
      const t = i / 59;
      const a = t * Math.PI * 2 * 9;
      const p = lo.clone().lerp(hi, 0.15 + 0.7 * t);
      return p.add(v(Math.cos(a) * 0.028, 0, Math.sin(a) * 0.028));
    }));
    add(spring, new THREE.TubeGeometry(coil, 240, 0.0045, 6, false), m.chrome);
  });
  // Rear wheel, chain guard, the long raised tail with its light and plate.
  const wheelG = wheel(m, rearR, 0.11, false);
  wheelG.position.copy(REAR_AXLE);
  g.add(wheelG);
  add(g, rod(v(-0.11, 0.3, PIVOT.z + 0.04), v(-0.11, 0.36, REAR_AXLE.z - 0.04), 0.024, 10).scale(1, 1, 1), m.black);
  const tc = [v(0, 0.86, 0.6), v(0, 0.9, 0.75), v(0, 0.97, 0.88), v(0, 1.05, 0.98)];
  add(g, shell(tc, [0.13, 0.12, 0.1, 0.085], [0.045, 0.04, 0.035, 0.03], 2.6), m.paint);
  // Rear fender under the tail, black, over the tyre.
  add(g, new THREE.CylinderGeometry(rearR + 0.04, rearR + 0.04, 0.13, 32, 1, true, 0.25, 1.75).rotateZ(Math.PI / 2).translate(0, REAR_AXLE.y, REAR_AXLE.z), m.black);
  return wheelG;
}

/** Builds the bike. `env` lights the chrome and paint (they read flat without one). */
export function buildBosozoku(env: THREE.Texture | null = null, look: BikeLook = BOSOZOKU_LOOK): Bike {
  const m = materials(env, look);
  const root = new THREE.Group();
  root.name = 'bike:shiden';
  const wheelR = { front: 0.31, rear: 0.32 };
  tank(root, m);
  seat(root, m);
  cowl(root, m);
  engine(root, m);
  exhaust(root, m);
  const rearWheel = frameAndRear(root, m, wheelR.rear);
  // Tail light and the plate below it, turn signals either side.
  add(root, new RoundedBoxGeometry(0.12, 0.045, 0.04, 3, 0.012).translate(0, 1.03, 1.0), m.tail);
  add(root, new THREE.PlaneGeometry(0.2, 0.1).rotateX(-0.25).translate(0, 0.9, 1.02), m.plate);
  mirror((s) => {
    add(root, rod(v(s * 0.07, 0.98, 0.95), v(s * 0.17, 0.99, 0.97), 0.007, 8), m.black);
    add(root, new THREE.SphereGeometry(0.024, 14, 8).scale(1, 0.8, 1.3).translate(s * 0.18, 0.99, 0.97), m.amber);
  });
  // Footpegs: the rider's under the seat's front, the passenger's behind.
  mirror((s) => {
    add(root, rod(v(s * 0.13, 0.32, 0.14), v(s * 0.23, 0.32, 0.14), 0.012, 10), m.rubber);
    add(root, rod(v(s * 0.13, 0.4, 0.42), v(s * 0.22, 0.4, 0.42), 0.01, 10), m.alu);
  });
  // The side stand, folded up.
  add(root, rod(v(-0.17, 0.26, 0.02), v(-0.2, 0.24, 0.3), 0.01, 8), m.black);
  const f = front(m, wheelR.front);
  root.add(f.steer);
  return {
    root,
    steer: f.steer,
    steerAxis: STEER_AXIS.clone(),
    frontWheel: f.wheelG,
    rearWheel,
    wheelRadius: wheelR,
    rider: { seat: v(0, 0.87, 0.2), gripL: f.gripL, gripR: f.gripR, gripAxisL: f.axisL, gripAxisR: f.axisR, pegL: v(-0.2, 0.33, 0.14), pegR: v(0.2, 0.33, 0.14) },
    lamps: { head: m.head, tail: m.tail },
  };
}
