import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { HELMET_LOOKS, type HelmetLook } from './helmet';
import { add, canvas, gaugeTexture, hex, mirror, pipe, plateTexture, rod, shell, v, type Bike, type V } from './bikeKit';

/**
 * Mack's sports bike (the "crotch rocket"): an invented late-90s 900 four, the Ōmi Hayate 900RR (疾風, "gale").
 * A full fairing (the nose with twin headlamps under a smoked double-bubble screen, the lower panels round
 * the engine, a belly pan), clip-on bars, rear-set pegs, a short tank, a tall pointed tail with the light
 * under its tip, upside-down forks, twin front discs, three-spoke wheels, a braced aluminium swingarm and an
 * oval silencer up the right side. The rider tucks in (`rider.tuck`). Built on models/bikeKit.ts like the
 * others: -z forward, the origin on the ground under the middle of the wheelbase.
 */

export interface SportLook {
  readonly paint: number;
  /** The stripes and the 疾風 graphic. */
  readonly accent: number;
  readonly wheels: number;
  /** Two-tone: the colour below the side's middle line, and the whole lower fairing and belly pan. */
  readonly lower?: number;
  /** The 疾風 graphic, if not the accent (on a two-tone it sits on the lower colour). */
  readonly badge?: number;
  /** The helmet he wears on it (models/helmet.ts), if not the plain black one. */
  readonly helmet?: HelmetLook;
}

export const SPORT_LOOKS = {
  black: { paint: 0x0a0a0c, accent: 0xc8141c, wheels: 0x121214 },
  white: { paint: 0xeeeeea, accent: 0x1d3c9a, wheels: 0xb8a060 },
  redblack: { paint: 0xa80c16, accent: 0x0a0a0c, wheels: 0x121214, lower: 0x0a0a0c, badge: 0xc8141c, helmet: HELMET_LOOKS.redblack },
} satisfies Record<string, SportLook>;

/** A colour's brightness, 0..1. */
const luma = (c: number): number => (0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255;

const FRONT_AXLE = v(0, 0.3, -0.71);
const REAR_AXLE = v(0, 0.315, 0.69);
const RAKE = (24 * Math.PI) / 180;
const STEER_AXIS = v(0, Math.cos(RAKE), Math.sin(RAKE));
const HEAD = FRONT_AXLE.clone().addScaledVector(STEER_AXIS, 0.74);
const PIVOT = v(0, 0.46, 0.18);

/** The paint on a shell's UVs (u along, v round from the right side's middle, over the top to the left's at
 * 0.5): the base (on a two-tone, the lower colour under the middle line), a pinstripe pair along each side. */
function liveryTexture(look: SportLook): THREE.CanvasTexture {
  return canvas(64, 512, (g) => {
    const H = 512;
    g.fillStyle = hex(look.paint);
    g.fillRect(0, 0, 64, H);
    if (look.lower !== undefined) {
      // v 0.5..1 is the underside (canvas rows from the top: v = 1 - y / H).
      g.fillStyle = hex(look.lower);
      g.fillRect(0, 0, 64, H * 0.5);
    }
    for (const c of [0.07, 0.43]) {
      const y = (1 - c) * H;
      g.fillStyle = hex(look.accent);
      g.fillRect(0, y - 10, 64, 6);
      g.fillRect(0, y + 6, 64, 3);
    }
  });
}

/** The side graphic: 疾風 in a brush hand, HAYATE 900RR under it, on a clear ground. */
function badgeTexture(look: SportLook): THREE.CanvasTexture {
  return canvas(512, 256, (g) => {
    g.clearRect(0, 0, 512, 256);
    g.fillStyle = hex(look.badge ?? look.accent);
    g.textBaseline = 'middle';
    g.font = 'bold 150px "Yu Mincho", "MS Mincho", serif';
    g.fillText('疾風', 16, 100);
    g.fillStyle = luma(look.lower ?? look.paint) > 0.5 ? '#151517' : '#e8e8e4';
    g.font = 'italic bold 44px Arial';
    g.fillText('HAYATE 900RR', 22, 212);
  });
}

function materials(env: THREE.Texture | null, look: SportLook) {
  const std = (o: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ envMap: env, ...o });
  return {
    paint: new THREE.MeshPhysicalMaterial({ map: liveryTexture(look), metalness: 0.2, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, envMap: env, envMapIntensity: 0.9, side: THREE.DoubleSide }),
    /** The lower fairing and belly pan: the paint, or a two-tone's lower colour. */
    lowerPaint: new THREE.MeshPhysicalMaterial({ color: look.lower ?? look.paint, metalness: 0.2, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, envMap: env, envMapIntensity: 0.9, side: THREE.DoubleSide }),
    paintPlain: new THREE.MeshPhysicalMaterial({ color: look.paint, metalness: 0.2, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, envMap: env, envMapIntensity: 0.9, side: THREE.DoubleSide }),
    badge: new THREE.MeshStandardMaterial({ map: badgeTexture(look), transparent: true, roughness: 0.3, envMap: env, polygonOffset: true, polygonOffsetFactor: -2 }),
    alu: std({ color: 0xa8acb2, metalness: 1, roughness: 0.4, envMapIntensity: 0.6 }),
    chrome: std({ color: 0xd2d5da, metalness: 1, roughness: 0.16, envMapIntensity: 0.55 }),
    gold: std({ color: 0xc8a048, metalness: 1, roughness: 0.3, envMapIntensity: 0.6 }),
    black: std({ color: 0x0b0b0d, metalness: 0.3, roughness: 0.32, envMapIntensity: 0.5 }),
    matte: std({ color: 0x141416, metalness: 0.2, roughness: 0.75, envMapIntensity: 0.4 }),
    wheel: std({ color: look.wheels, metalness: 0.6, roughness: 0.35, envMapIntensity: 0.6 }),
    rubber: std({ color: 0x121213, roughness: 0.92, envMapIntensity: 0.2 }),
    vinyl: std({ color: 0x0d0d10, roughness: 0.45, envMapIntensity: 0.5 }),
    screen: new THREE.MeshPhysicalMaterial({ color: 0x10141c, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.72, side: THREE.DoubleSide, envMap: env, envMapIntensity: 1, depthWrite: false, forceSinglePass: true }),
    head: std({ color: 0xf0eee6, emissive: new THREE.Color(1, 0.96, 0.86), emissiveIntensity: 0.25, roughness: 0.1 }),
    tail: std({ color: 0x5a0606, emissive: new THREE.Color(1, 0.05, 0.03), emissiveIntensity: 0.15, roughness: 0.2 }),
    amber: std({ color: 0xd07010, emissive: new THREE.Color(1, 0.45, 0.05), emissiveIntensity: 0.1, roughness: 0.2 }),
    plate: std({ map: plateTexture('東都 900', 'ほ', '9-01'), roughness: 0.5 }),
  };
}
type Mats = ReturnType<typeof materials>;

/** A three-spoke cast wheel on a sports tyre (round-profiled, wide at the back), spinning about x. */
function wheel(m: Mats, r: number, width: number, front: boolean): THREE.Group {
  const g = new THREE.Group();
  const rimR = r - 0.085;
  const tyre: THREE.Vector2[] = [new THREE.Vector2(rimR, -width * 0.42)];
  for (let i = 0; i <= 20; i++) {
    const a = -Math.PI / 2 + (i / 20) * Math.PI;
    // A sports tyre's round crown: the tread wraps far round the shoulder.
    tyre.push(new THREE.Vector2(rimR + 0.03 + (r - rimR - 0.03) * Math.cos(a) ** 0.6, (width / 2) * Math.sin(a)));
  }
  tyre.push(new THREE.Vector2(rimR, width * 0.42));
  add(g, new THREE.LatheGeometry(tyre, 56).rotateZ(Math.PI / 2), m.rubber);
  const rim = [new THREE.Vector2(rimR - 0.018, -width * 0.4), new THREE.Vector2(rimR + 0.004, -width * 0.43), new THREE.Vector2(rimR + 0.004, width * 0.43), new THREE.Vector2(rimR - 0.018, width * 0.4), new THREE.Vector2(rimR - 0.022, 0)];
  add(g, new THREE.LatheGeometry(rim, 56).rotateZ(Math.PI / 2), m.wheel);
  add(g, rod(v(-width * 0.3, 0, 0), v(width * 0.3, 0, 0), 0.05, 20), m.wheel);
  // Three broad spokes, each forking into two near the rim.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const d = v(0, Math.cos(a), Math.sin(a));
    add(g, rod(d.clone().multiplyScalar(0.045), d.clone().multiplyScalar(rimR * 0.62), 0.016, 8, 0.013).scale(1.3, 1, 1), m.wheel);
    for (const s of [-1, 1]) {
      const b = (i / 3) * Math.PI * 2 + s * 0.22;
      const e = v(0, Math.cos(b), Math.sin(b));
      add(g, rod(d.clone().multiplyScalar(rimR * 0.6), e.multiplyScalar(rimR - 0.016), 0.011, 8, 0.009).scale(1.3, 1, 1), m.wheel);
    }
  }
  if (front) {
    for (const s of [1, -1]) add(g, new THREE.CylinderGeometry(0.15, 0.15, 0.005, 48).rotateZ(Math.PI / 2).translate(s * (width * 0.36 + 0.016), 0, 0), m.chrome);
  } else {
    add(g, new THREE.CylinderGeometry(0.11, 0.11, 0.005, 40).rotateZ(Math.PI / 2).translate(width * 0.38 + 0.012, 0, 0), m.chrome);
    add(g, new THREE.CylinderGeometry(0.1, 0.1, 0.008, 36).rotateZ(Math.PI / 2).translate(-width * 0.4 - 0.014, 0, 0), m.alu);
  }
  return g;
}

/** Steering: USD forks, the wheel and its hugger fender, the top clamp and the clip-ons. */
function front(m: Mats, r: number): { steer: THREE.Group; wheelG: THREE.Group; gripL: V; gripR: V; axisL: V; axisR: V } {
  const steer = new THREE.Group();
  steer.position.copy(HEAD);
  const g = new THREE.Group();
  g.position.copy(HEAD).negate();
  steer.add(g);
  mirror((s) => {
    const off = v(s * 0.1, 0, 0);
    const mid = FRONT_AXLE.clone().addScaledVector(STEER_AXIS, 0.3).add(off);
    const top = HEAD.clone().addScaledVector(STEER_AXIS, 0.05).add(off);
    // Upside down: the fat tubes at the top, the slim chrome stanchions into the axle.
    add(g, rod(mid, top, 0.03, 20), m.gold);
    add(g, rod(FRONT_AXLE.clone().add(off), mid, 0.021, 16), m.chrome);
    add(g, new RoundedBoxGeometry(0.035, 0.1, 0.07, 2, 0.012).translate(s * 0.08, FRONT_AXLE.y + 0.11, FRONT_AXLE.z + 0.05), m.gold);
  });
  for (const k of [-0.07, 0.04]) {
    const p = HEAD.clone().addScaledVector(STEER_AXIS, k);
    add(g, new RoundedBoxGeometry(0.27, 0.03, 0.08, 2, 0.01).translate(p.x, p.y, p.z), m.alu);
  }
  const wheelG = wheel(m, r, 0.11, true);
  wheelG.position.copy(FRONT_AXLE);
  g.add(wheelG);
  // The hugger: a short fender close over the tyre.
  add(g, new THREE.CylinderGeometry(r + 0.025, r + 0.025, 0.13, 32, 1, true, 1.25, 1.3).rotateZ(Math.PI / 2).translate(FRONT_AXLE.x, FRONT_AXLE.y, FRONT_AXLE.z), m.paintPlain);
  // Clip-ons below the top clamp: out, back and down from the fork tubes; the grip on the last half.
  let gripL = v(0, 0, 0);
  let gripR = v(0, 0, 0);
  let axisL = v(-1, 0, 0);
  let axisR = v(1, 0, 0);
  mirror((s) => {
    const a = HEAD.clone().addScaledVector(STEER_AXIS, -0.03).add(v(s * 0.1, 0, 0));
    const axis = v(s * 0.92, -0.14, 0.36).normalize();
    const b = a.clone().addScaledVector(axis, 0.26);
    add(g, rod(a, b, 0.012, 12), m.black);
    const mid = a.clone().addScaledVector(axis, 0.18);
    add(g, rod(a.clone().addScaledVector(axis, 0.11), b.clone().addScaledVector(axis, 0.02), 0.017, 14), m.rubber);
    add(g, pipe([a.clone().addScaledVector(axis, 0.08).add(v(0, 0, -0.02)), a.clone().addScaledVector(axis, 0.16).add(v(0, -0.01, -0.07)), a.clone().addScaledVector(axis, 0.26).add(v(0, -0.02, -0.05))], 0.005, 16, 6), m.alu);
    if (s > 0) {
      gripR = mid;
      axisR = axis;
    } else {
      gripL = mid;
      axisL = axis;
    }
  });
  return { steer, wheelG, gripL, gripR, axisL, axisR };
}

function bodywork(g: THREE.Group, m: Mats): void {
  // The upper fairing: the nose round the headlamps, open behind (shells listed back to front).
  add(g, shell([v(0, 0.95, -0.3), v(0, 0.93, -0.5), v(0, 0.89, -0.68), v(0, 0.83, -0.83), v(0, 0.77, -0.95), v(0, 0.74, -1.0)], [0.25, 0.245, 0.22, 0.165, 0.09, 0.03], [0.17, 0.175, 0.16, 0.125, 0.075, 0.03], 2.3, 44, false), m.paint);
  // Twin headlamps in the nose, under clear covers.
  mirror((s) => {
    const c = v(s * 0.06, 0.825, -0.86);
    add(g, new THREE.CircleGeometry(0.05, 28).scale(1.2, 0.85, 1).rotateY(Math.PI).rotateX(-0.45).translate(c.x, c.y, c.z - 0.012), m.head);
    add(g, new THREE.TorusGeometry(0.052, 0.006, 6, 28).scale(1.2, 0.85, 1).rotateX(-0.45).translate(c.x, c.y, c.z - 0.008), m.black);
  });
  // The double-bubble screen: a smoked dome raked back over the dash.
  const scr = new THREE.SphereGeometry(0.26, 32, 12, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.12, Math.PI * 0.34).scale(0.95, 1, 1.5).rotateY(Math.PI).translate(0, 0.94, -0.42);
  add(g, scr, m.screen);
  // The lower fairing round the engine, and the belly pan.
  add(g, shell([v(0, 0.58, 0.08), v(0, 0.6, -0.15), v(0, 0.6, -0.4), v(0, 0.64, -0.6), v(0, 0.72, -0.72)], [0.2, 0.23, 0.235, 0.22, 0.2], [0.24, 0.27, 0.27, 0.22, 0.14], 3.2, 44, false), m.lowerPaint);
  add(g, shell([v(0, 0.31, 0.02), v(0, 0.29, -0.3), v(0, 0.32, -0.55)], [0.15, 0.17, 0.14], [0.06, 0.07, 0.05], 2.4, 32), m.lowerPaint);
  // The side graphic on each lower panel.
  mirror((s) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), m.badge);
    p.position.set(s * 0.238, 0.6, -0.3);
    p.rotation.y = (s * Math.PI) / 2;
    g.add(p);
  });
  // Tank, short and high over the frame.
  add(g, shell([v(0, 0.9, 0.12), v(0, 0.97, 0.02), v(0, 1.01, -0.12), v(0, 1.0, -0.26), v(0, 0.96, -0.33)], [0.12, 0.17, 0.18, 0.16, 0.12], [0.05, 0.1, 0.12, 0.1, 0.06], 2.4), m.paint);
  add(g, rod(v(0, 1.11, -0.15), v(0, 1.125, -0.15), 0.033, 20), m.alu);
  // The rider's pad and the tail: tall and pointed, the pillion under a cowl in the paint.
  add(g, new RoundedBoxGeometry(0.25, 0.06, 0.32, 4, 0.025).translate(0, 0.84, 0.26), m.vinyl);
  add(g, shell([v(0, 1.02, 0.95), v(0, 0.99, 0.82), v(0, 0.95, 0.64), v(0, 0.9, 0.46), v(0, 0.85, 0.36)], [0.025, 0.08, 0.12, 0.13, 0.13], [0.02, 0.05, 0.07, 0.07, 0.05], 2.6), m.paint);
  // Under the tail: the light under its tip, the plate hanger, the indicators.
  add(g, new RoundedBoxGeometry(0.1, 0.035, 0.05, 3, 0.012).translate(0, 0.95, 0.9), m.tail);
  add(g, new THREE.PlaneGeometry(0.19, 0.1).rotateX(-0.2).translate(0, 0.74, 0.92), m.plate);
  add(g, rod(v(0, 0.92, 0.82), v(0, 0.79, 0.9), 0.01, 8), m.black);
  mirror((s) => {
    add(g, rod(v(s * 0.06, 0.8, 0.88), v(s * 0.15, 0.81, 0.9), 0.006, 8), m.black);
    add(g, new THREE.SphereGeometry(0.02, 12, 8).scale(1, 0.8, 1.4).translate(s * 0.16, 0.81, 0.9), m.amber);
  });
  // Mirrors on the fairing, the indicators in their stalks.
  mirror((s) => {
    const a = v(s * 0.24, 1.0, -0.6);
    const b = v(s * 0.33, 1.05, -0.58);
    add(g, rod(a, b, 0.009, 8), m.black);
    add(g, new RoundedBoxGeometry(0.11, 0.06, 0.03, 3, 0.012).translate(b.x + s * 0.03, b.y + 0.015, b.z), m.paintPlain);
    add(g, new THREE.SphereGeometry(0.014, 10, 6).scale(1.6, 0.8, 1).translate(b.x + s * 0.03, b.y, b.z - 0.017), m.amber);
  });
  // The dash behind the screen: the tach big in the middle, facing the rider.
  const n = v(0, Math.sin(0.85), Math.cos(0.85));
  const dp = v(0, 0.98, -0.46);
  add(g, new THREE.CylinderGeometry(0.06, 0.055, 0.04, 28).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), n)).translate(dp.x, dp.y, dp.z), m.black);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.052, 32), new THREE.MeshStandardMaterial({ map: gaugeTexture(14, 1, '×1000 r/min'), roughness: 0.3, emissive: 0xffffff, emissiveMap: gaugeTexture(14, 1, '×1000 r/min'), emissiveIntensity: 0.1 }));
  face.quaternion.setFromUnitVectors(v(0, 0, 1), n);
  face.position.copy(dp).addScaledVector(n, 0.021);
  g.add(face);
}

function chassis(g: THREE.Group, m: Mats, r: number): THREE.Group {
  // The twin-spar frame, aluminium, from the head down to the swingarm pivot (above the fairing's top edge).
  mirror((s) => add(g, pipe([v(s * 0.06, HEAD.y - 0.03, HEAD.z + 0.04), v(s * 0.15, 0.86, -0.22), v(s * 0.16, 0.74, 0.04), v(s * 0.14, PIVOT.y + 0.05, PIVOT.z)], 0.035, 32, 10), m.alu));
  // The engine's sump and the cases under the fairing; the radiator behind the front wheel.
  add(g, new RoundedBoxGeometry(0.34, 0.2, 0.36, 4, 0.04).translate(0, 0.4, -0.18), m.black);
  add(g, new RoundedBoxGeometry(0.36, 0.3, 0.04, 2, 0.01).translate(0, 0.62, -0.5), m.matte);
  // Braced aluminium swingarm, the shock, the chain guard.
  mirror((s) => {
    add(g, rod(v(s * 0.11, PIVOT.y, PIVOT.z), v(s * 0.1, REAR_AXLE.y, REAR_AXLE.z), 0.028, 12).scale(1, 1.6, 1), m.alu);
    add(g, rod(v(s * 0.11, PIVOT.y - 0.04, PIVOT.z + 0.05), v(s * 0.1, REAR_AXLE.y - 0.04, REAR_AXLE.z - 0.15), 0.012, 8), m.alu);
  });
  add(g, rod(v(0, 0.48, 0.22), v(0, 0.76, 0.38), 0.03, 12), m.gold);
  const wheelG = wheel(m, r, 0.17, false);
  wheelG.position.copy(REAR_AXLE);
  g.add(wheelG);
  // The silencer up the right side under the tail: an oval can, a carbon-dark sleeve and a polished end.
  const can = rod(v(0.19, 0.42, 0.34), v(0.21, 0.62, 0.8), 0.06, 24).scale(0.75, 1, 1);
  add(g, can, m.matte);
  add(g, rod(v(0.21, 0.62, 0.8), v(0.212, 0.63, 0.83), 0.055, 24, 0.045).scale(0.75, 1, 1), m.chrome);
  add(g, pipe([v(0.12, 0.3, -0.2), v(0.16, 0.26, 0.05), v(0.18, 0.36, 0.3)], 0.028, 24, 10), m.chrome);
  // The rear hugger and the chain.
  add(g, new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.17, 32, 1, true, 1.0, 1.2).rotateZ(Math.PI / 2).translate(REAR_AXLE.x, REAR_AXLE.y, REAR_AXLE.z), m.black);
  return wheelG;
}

/** Builds the sports bike. `env` lights the paint and metal. */
export function buildSportBike(env: THREE.Texture | null = null, look: SportLook = SPORT_LOOKS.black): Bike {
  const m = materials(env, look);
  const root = new THREE.Group();
  root.name = 'bike:hayate';
  const r = 0.31;
  bodywork(root, m);
  const rearWheel = chassis(root, m, r);
  // Rear-set pegs (the rider's high and back), the pillion's behind.
  mirror((s) => {
    add(root, new RoundedBoxGeometry(0.03, 0.1, 0.05, 2, 0.01).translate(s * 0.15, 0.48, 0.1), m.alu);
    add(root, rod(v(s * 0.15, 0.44, 0.1), v(s * 0.24, 0.44, 0.1), 0.011, 10), m.alu);
    add(root, rod(v(s * 0.15, 0.53, 0.42), v(s * 0.22, 0.53, 0.42), 0.009, 8), m.alu);
  });
  add(root, rod(v(-0.15, 0.28, -0.02), v(-0.19, 0.24, 0.26), 0.01, 8), m.black);
  const f = front(m, r);
  root.add(f.steer);
  return {
    root,
    steer: f.steer,
    steerAxis: STEER_AXIS.clone(),
    frontWheel: f.wheelG,
    rearWheel,
    wheelRadius: { front: r, rear: r },
    rider: { seat: v(0, 0.83, 0.26), gripL: f.gripL, gripR: f.gripR, gripAxisL: f.axisL, gripAxisR: f.axisR, pegL: v(-0.22, 0.44, 0.1), pegR: v(0.22, 0.44, 0.1), tuck: 1.4, helmet: look.helmet ?? true },
    lamps: { head: m.head, tail: m.tail },
  };
}
