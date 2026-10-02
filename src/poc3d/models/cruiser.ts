import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { add, canvas, gaugeTexture, mirror, pipe, plateTexture, rod, shell, v, type Bike, type V } from './bikeKit';

/**
 * Mack's second bike, the nod to the films: an invented Japanese V-twin cruiser built on American lines, the
 * Kaiun Raijin 1600 (雷神, the thunder god). Solid disc wheels on fat 16-inch tyres, a wide fork with chrome
 * shrouds under a nacelle and a big round headlight, a fat tank with a chrome console and the speedometer on
 * it, a 45-degree air-cooled V-twin with a big round air cleaner, staggered shotgun pipes down the right side,
 * deep fenders, a low scooped seat, pullback bars and floorboards; silver or gloss black (`CRUISER_LOOKS`). Built like the bōsōzoku bike (its
 * own meshes and materials), in its frame (models/bikeKit.ts).
 */

export interface CruiserLook {
  readonly paint: number;
  /** How metallic the paint is (a silver's flake; a solid black's barely). */
  readonly metal: number;
  /** The emblem's ground on the tank's sides. */
  readonly badge: number;
}

export const CRUISER_LOOKS = {
  black: { paint: 0x060607, metal: 0.25, badge: 0x15161a },
  silver: { paint: 0x9ca2aa, metal: 0.65, badge: 0x15161a },
} satisfies Record<string, CruiserLook>;
export const CRUISER_LOOK: CruiserLook = CRUISER_LOOKS.black;

const FRONT_AXLE = v(0, 0.33, -0.86);
const REAR_AXLE = v(0, 0.33, 0.78);
const RAKE = (32 * Math.PI) / 180;
const STEER_AXIS = v(0, Math.cos(RAKE), Math.sin(RAKE));
const HEAD = FRONT_AXLE.clone().addScaledVector(STEER_AXIS, 0.78);

/** The tank's badge: a dark disc, a chrome ring, 雷 in the middle and the name round it. */
function badgeTexture(look: CruiserLook): THREE.CanvasTexture {
  return canvas(256, 256, (g) => {
    g.translate(128, 128);
    g.fillStyle = '#d8dade';
    g.beginPath();
    g.arc(0, 0, 124, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = `#${look.badge.toString(16).padStart(6, '0')}`;
    g.beginPath();
    g.arc(0, 0, 110, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e6c25a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 110px "Yu Mincho", "MS Mincho", serif';
    g.fillText('雷', 0, -8);
    g.font = 'bold 26px Arial';
    g.fillText('KAIUN RAIJIN', 0, 74);
  });
}

function materials(env: THREE.Texture | null, look: CruiserLook) {
  const std = (o: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ envMap: env, ...o });
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: look.paint, metalness: look.metal, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, envMap: env, envMapIntensity: 0.7 }),
    chrome: std({ color: 0xd2d5da, metalness: 1, roughness: 0.16, envMapIntensity: 0.55 }),
    polished: std({ color: 0xb8bcc2, metalness: 1, roughness: 0.28, envMapIntensity: 0.55 }),
    alu: std({ color: 0xa0a4aa, metalness: 1, roughness: 0.45, envMapIntensity: 0.6 }),
    black: std({ color: 0x0b0b0d, metalness: 0.3, roughness: 0.3, envMapIntensity: 0.8 }),
    wrinkle: std({ color: 0x111113, metalness: 0.1, roughness: 0.8, envMapIntensity: 0.4 }),
    rubber: std({ color: 0x121213, roughness: 0.92, envMapIntensity: 0.2 }),
    leather: std({ color: 0x0f0e0e, roughness: 0.55, envMapIntensity: 0.6 }),
    head: std({ color: 0xf0eee6, emissive: new THREE.Color(1, 0.96, 0.86), emissiveIntensity: 0.2, roughness: 0.1 }),
    tail: std({ color: 0x5a0606, emissive: new THREE.Color(1, 0.05, 0.03), emissiveIntensity: 0.15, roughness: 0.2 }),
    amber: std({ color: 0xd07010, emissive: new THREE.Color(1, 0.45, 0.05), emissiveIntensity: 0.1, roughness: 0.2 }),
    plate: std({ map: plateTexture('東都 1600', 'さ', '7-19'), roughness: 0.5 }),
    badge: std({ map: badgeTexture(look), metalness: 0.5, roughness: 0.3 }),
  };
}
type Mats = ReturnType<typeof materials>;

/** A solid disc wheel on a fat tyre, at the origin, spinning about x. */
function discWheel(m: Mats, r: number, width: number, front: boolean): THREE.Group {
  const g = new THREE.Group();
  const rimR = 0.205;
  const tyre: THREE.Vector2[] = [new THREE.Vector2(rimR, -width * 0.4)];
  for (let i = 0; i <= 20; i++) {
    const a = -Math.PI / 2 + (i / 20) * Math.PI;
    tyre.push(new THREE.Vector2(rimR + 0.02 + (r - rimR - 0.02) * (0.5 + 0.5 * Math.cos(a)), (width / 2) * Math.sin(a)));
  }
  tyre.push(new THREE.Vector2(rimR, width * 0.4));
  add(g, new THREE.LatheGeometry(tyre, 56).rotateZ(Math.PI / 2), m.rubber);
  // The disc: dished in a little from the rim's lip to the hub, both faces.
  const hw = width * 0.38;
  const disc = [
    [0.001, hw * 0.9], [0.05, hw * 0.88], [0.07, hw * 0.7], [0.17, hw * 0.55], [rimR - 0.004, hw * 0.75], [rimR + 0.006, hw],
    [rimR + 0.006, -hw], [rimR - 0.004, -hw * 0.75], [0.17, -hw * 0.55], [0.07, -hw * 0.7], [0.05, -hw * 0.88], [0.001, -hw * 0.9],
  ].map(([a, b]) => new THREE.Vector2(a, b));
  add(g, new THREE.LatheGeometry(disc, 64).rotateZ(Math.PI / 2), m.polished);
  // Hub caps, chrome.
  mirror((s) => add(g, new THREE.CylinderGeometry(0.045, 0.05, 0.012, 28).rotateZ(Math.PI / 2).translate(s * hw * 0.93, 0, 0), m.chrome));
  if (front) {
    // A brake disc and caliper on the left.
    add(g, new THREE.CylinderGeometry(0.145, 0.145, 0.006, 48).rotateZ(Math.PI / 2).translate(-hw - 0.012, 0, 0), m.alu);
  } else {
    // The belt pulley on the left, a disc on the right.
    add(g, new THREE.CylinderGeometry(0.16, 0.16, 0.025, 56).rotateZ(Math.PI / 2).translate(-hw - 0.02, 0, 0), m.polished);
    add(g, new THREE.CylinderGeometry(0.14, 0.14, 0.006, 48).rotateZ(Math.PI / 2).translate(hw + 0.012, 0, 0), m.alu);
  }
  return g;
}

/** The front end on the steering axis: fork, shrouds, nacelle and headlight, fender, wheel, bars, mirrors. */
function front(m: Mats, r: number): { steer: THREE.Group; wheelG: THREE.Group; gripL: V; gripR: V; axisL: V; axisR: V } {
  const steer = new THREE.Group();
  steer.position.copy(HEAD);
  const g = new THREE.Group();
  g.position.copy(HEAD).negate();
  steer.add(g);
  mirror((s) => {
    const off = v(s * 0.125, 0, 0);
    const low = FRONT_AXLE.clone().addScaledVector(STEER_AXIS, 0.34).add(off);
    const top = HEAD.clone().addScaledVector(STEER_AXIS, -0.06).add(off);
    // Polished sliders, then the chrome shrouds over the tubes up to the lower clamp.
    add(g, rod(FRONT_AXLE.clone().add(off), low, 0.03, 20, 0.032), m.polished);
    add(g, rod(low.clone().addScaledVector(STEER_AXIS, 0.03), top, 0.044, 24), m.chrome);
    add(g, rod(low, low.clone().addScaledVector(STEER_AXIS, 0.03), 0.034, 20), m.rubber);
    // The axle's nut.
    add(g, new THREE.CylinderGeometry(0.02, 0.02, 0.03, 12).rotateZ(Math.PI / 2).translate(FRONT_AXLE.x + s * 0.15, FRONT_AXLE.y, FRONT_AXLE.z), m.chrome);
  });
  add(g, new RoundedBoxGeometry(0.06, 0.1, 0.07, 2, 0.015).translate(-0.17, FRONT_AXLE.y + 0.1, FRONT_AXLE.z + 0.06), m.black);
  // Triple clamps, chrome.
  for (const k of [-0.07, 0.07]) {
    const p = HEAD.clone().addScaledVector(STEER_AXIS, k);
    add(g, new RoundedBoxGeometry(0.34, 0.035, 0.1, 3, 0.012).translate(p.x, p.y, p.z), m.chrome);
  }
  // The nacelle: a chrome cover over the fork's top, the headlight's bucket ahead of it.
  const nac = HEAD.clone().addScaledVector(STEER_AXIS, -0.02).add(v(0, 0, -0.08));
  add(g, shell([v(0, nac.y + 0.02, nac.z + 0.08), v(0, nac.y, nac.z - 0.02), v(0, nac.y - 0.03, nac.z - 0.1)], [0.17, 0.165, 0.12], [0.07, 0.08, 0.06], 2.6), m.chrome);
  const lampC = v(0, nac.y - 0.02, nac.z - 0.17);
  const bucket = [new THREE.Vector2(0.001, -0.09), new THREE.Vector2(0.05, -0.085), new THREE.Vector2(0.095, -0.05), new THREE.Vector2(0.113, 0.0), new THREE.Vector2(0.115, 0.012), new THREE.Vector2(0.105, 0.014)];
  add(g, new THREE.LatheGeometry(bucket, 48).rotateX(-Math.PI / 2).translate(lampC.x, lampC.y, lampC.z + 0.0), m.chrome);
  add(g, new THREE.CircleGeometry(0.104, 48).rotateY(Math.PI).translate(lampC.x, lampC.y, lampC.z - 0.013), m.head);
  // Turn signals: chrome bullets on stalks either side of the light.
  mirror((s) => {
    add(g, rod(v(s * 0.15, lampC.y - 0.03, lampC.z + 0.12), v(s * 0.24, lampC.y - 0.03, lampC.z + 0.08), 0.008, 8), m.chrome);
    add(g, new THREE.SphereGeometry(0.03, 16, 10).scale(1, 1, 1.5).translate(s * 0.25, lampC.y - 0.03, lampC.z + 0.06), m.chrome);
    add(g, new THREE.CircleGeometry(0.022, 16).rotateY(Math.PI).translate(s * 0.25, lampC.y - 0.03, lampC.z + 0.014), m.amber);
  });
  // The wheel and its deep fender, down low over the front of the tyre.
  const wheelG = discWheel(m, r, 0.13, true);
  wheelG.position.copy(FRONT_AXLE);
  g.add(wheelG);
  add(g, new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.2, 40, 1, true, 0.7, 2.25).rotateZ(Math.PI / 2).translate(FRONT_AXLE.x, FRONT_AXLE.y, FRONT_AXLE.z), m.paint);
  mirror((s) => add(g, new THREE.CylinderGeometry(r + 0.031, r + 0.031, 0.008, 40, 1, true, 0.7, 2.25).rotateZ(Math.PI / 2).translate(FRONT_AXLE.x + s * 0.1, FRONT_AXLE.y, FRONT_AXLE.z), m.chrome));
  // Pullback bars on short risers: out wide and back to the rider.
  const clamp = HEAD.clone().addScaledVector(STEER_AXIS, 0.09);
  let gripL = v(0, 0, 0);
  let gripR = v(0, 0, 0);
  let axisL = v(-1, 0, 0);
  let axisR = v(1, 0, 0);
  mirror((s) => {
    add(g, rod(v(s * 0.06, clamp.y, clamp.z), v(s * 0.06, clamp.y + 0.09, clamp.z - 0.01), 0.016, 14), m.chrome);
    const pts = [v(s * 0.0, clamp.y + 0.09, clamp.z - 0.01), v(s * 0.16, clamp.y + 0.12, clamp.z - 0.02), v(s * 0.3, clamp.y + 0.13, clamp.z + 0.08), v(s * 0.37, clamp.y + 0.1, clamp.z + 0.22)];
    add(g, pipe(pts, 0.0125, 48, 10), m.chrome);
    const end = pts[pts.length - 1];
    const grip = end.clone().add(v(s * 0.03, -0.004, 0.06));
    add(g, rod(end, grip.clone().addScaledVector(grip.clone().sub(end).normalize(), 0.06), 0.018, 14), m.rubber);
    // The grip's middle (the rubber runs from the bar's bend out past `grip`), and its axis.
    const axis = grip.clone().sub(end).normalize();
    const mid = end.clone().addScaledVector(axis, 0.065);
    if (s > 0) {
      gripR = mid;
      axisR = axis;
    } else {
      gripL = mid;
      axisL = axis;
    }
    // Levers, mirrors.
    add(g, pipe([end.clone().add(v(-s * 0.02, 0, -0.02)), end.clone().add(v(s * 0.05, -0.01, -0.05)), end.clone().add(v(s * 0.13, -0.02, 0.0))], 0.005, 16, 6), m.chrome);
    const m0 = end.clone().add(v(-s * 0.08, 0.0, -0.06));
    const m1 = m0.clone().add(v(s * 0.06, 0.2, -0.03));
    add(g, rod(m0, m1, 0.006, 8), m.chrome);
    add(g, new THREE.CylinderGeometry(0.05, 0.05, 0.018, 24).rotateX(Math.PI / 2 - 0.15).translate(m1.x + s * 0.01, m1.y + 0.03, m1.z), m.black);
    // A chrome rim round the dark glass (the glass a black mirror: it shows the night, not the studio lights).
    add(g, new THREE.TorusGeometry(0.05, 0.005, 6, 24).rotateX(-0.15).translate(m1.x + s * 0.01, m1.y + 0.03, m1.z), m.chrome);
  });
  return { steer, wheelG, gripL, gripR, axisL, axisR };
}

/** The 45-degree V-twin: crankcase, two finned cylinders with chrome rocker boxes, the round air cleaner on
 * the right, the primary's long chrome cover on the left, the gearbox behind. */
function engine(g: THREE.Group, m: Mats): void {
  add(g, new RoundedBoxGeometry(0.26, 0.24, 0.36, 4, 0.06).translate(0, 0.38, -0.08), m.polished);
  add(g, new RoundedBoxGeometry(0.22, 0.18, 0.26, 4, 0.04).translate(0, 0.38, 0.2), m.polished);
  const crank = v(0, 0.44, -0.08);
  for (const tilt of [-1, 1]) {
    const cyl = new THREE.Group();
    cyl.position.copy(crank);
    cyl.rotation.x = (tilt * 22.5 * Math.PI) / 180;
    g.add(cyl);
    // Fins: discs stacked up the barrel, a little narrower at the top.
    for (let i = 0; i < 11; i++) add(cyl, new THREE.CylinderGeometry(0.085 - i * 0.0012, 0.085 - i * 0.0012, 0.008, 32).translate(0, 0.1 + i * 0.019, 0), m.alu);
    add(cyl, new THREE.CylinderGeometry(0.06, 0.06, 0.22, 24).translate(0, 0.19, 0), m.wrinkle);
    // Head, finned too, then the chrome rocker box.
    add(cyl, new RoundedBoxGeometry(0.2, 0.08, 0.17, 3, 0.02).translate(0, 0.34, 0), m.alu);
    add(cyl, new RoundedBoxGeometry(0.16, 0.06, 0.15, 3, 0.025).translate(0, 0.41, 0), m.chrome);
  }
  // Pushrod tubes up the right side, the big round air cleaner over the carburettor between the heads.
  for (const z of [-0.04, -0.12]) add(g, rod(v(0.08, 0.46, z), v(0.08, 0.72, z + Math.sign(z + 0.08) * 0.12), 0.01, 10), m.chrome);
  add(g, new THREE.CylinderGeometry(0.12, 0.12, 0.045, 48).rotateZ(Math.PI / 2).translate(0.155, 0.7, -0.08), m.chrome);
  add(g, new THREE.CylinderGeometry(0.09, 0.09, 0.006, 40).rotateZ(Math.PI / 2).translate(0.18, 0.7, -0.08), m.black);
  add(g, rod(v(0.02, 0.68, -0.08), v(0.13, 0.7, -0.08), 0.03, 14), m.alu);
  // The primary cover on the left: a long chrome lozenge from the crank back to the gearbox.
  add(g, new RoundedBoxGeometry(0.05, 0.2, 0.5, 4, 0.025).translate(-0.17, 0.33, 0.06), m.chrome);
  add(g, new THREE.CylinderGeometry(0.075, 0.075, 0.02, 32).rotateZ(Math.PI / 2).translate(-0.2, 0.33, -0.1), m.chrome);
}

/** Staggered shotgun pipes down the right: from each head down, then back side by side, one above the other,
 * to slash-cut mufflers past the rear axle. */
function exhaust(g: THREE.Group, m: Mats): void {
  const runs: V[][] = [
    // front cylinder: forward and down round the frame, back low
    [v(0.08, 0.74, -0.27), v(0.13, 0.66, -0.36), v(0.19, 0.42, -0.3), v(0.22, 0.3, -0.14), v(0.23, 0.29, 0.2), v(0.24, 0.3, 0.45)],
    // rear cylinder: down behind the engine, back high
    [v(0.08, 0.7, 0.1), v(0.16, 0.6, 0.12), v(0.22, 0.46, 0.18), v(0.235, 0.42, 0.32), v(0.245, 0.43, 0.45)],
  ];
  runs.forEach((pts, i) => {
    add(g, pipe(pts, 0.022, 64, 12), m.chrome);
    const y = pts[pts.length - 1].y;
    const z0 = pts[pts.length - 1].z;
    // The muffler, a long chrome can, the end cut at a slant.
    add(g, rod(v(0.245, y, z0), v(0.245, y + (i === 0 ? 0.03 : 0.04), 1.05 - i * 0.04), 0.04, 24), m.chrome);
    const cut = new THREE.CircleGeometry(0.04, 24).scale(1, 1, 1).rotateY(-Math.PI / 2 + 0.0).rotateX(0);
    const end = v(0.245, y + (i === 0 ? 0.03 : 0.04), 1.05 - i * 0.04);
    add(g, cut.rotateY(Math.PI / 2).rotateX(-0.6).translate(end.x, end.y, end.z), m.rubber);
  });
  // A heat shield over the joint.
  add(g, new RoundedBoxGeometry(0.03, 0.2, 0.18, 3, 0.012).translate(0.23, 0.38, 0.0), m.chrome);
}

function body(g: THREE.Group, m: Mats, r: number): THREE.Group {
  // Frame: the backbone from the head under the tank to the seat, the cradle down and under the engine, the
  // rear section to the axle (a rigid-looking triangle, the shocks hidden under it).
  mirror((s) => {
    const x = s * 0.06;
    add(g, pipe([v(0, HEAD.y - 0.02, HEAD.z + 0.03), v(x * 0.5, 0.86, -0.15), v(x, 0.7, 0.15), v(x * 1.6, 0.6, 0.4)], 0.022, 32, 10), m.black);
    add(g, pipe([v(x * 0.7, HEAD.y - 0.08, HEAD.z), v(x * 1.2, 0.6, -0.4), v(x * 1.6, 0.24, -0.34), v(x * 1.8, 0.2, 0.0), v(x * 1.8, 0.22, 0.3), v(x * 1.7, 0.3, 0.52)], 0.02, 48, 10), m.black);
    add(g, rod(v(s * 0.11, 0.3, 0.52), v(s * 0.1, REAR_AXLE.y, REAR_AXLE.z), 0.022, 12), m.black);
    add(g, rod(v(s * 0.1, 0.6, 0.4), v(s * 0.1, REAR_AXLE.y + 0.02, REAR_AXLE.z - 0.02), 0.018, 12), m.black);
  });
  // The fat tank, split over the backbone, its chrome console running along the top with the speedometer.
  const tc = [v(0, 0.82, 0.04), v(0, 0.88, -0.04), v(0, 0.92, -0.16), v(0, 0.94, -0.3), v(0, 0.95, -0.39), v(0, 0.94, -0.44)];
  add(g, shell(tc, [0.07, 0.17, 0.205, 0.2, 0.16, 0.08], [0.05, 0.1, 0.12, 0.12, 0.1, 0.05], 2.2), m.paint);
  add(g, shell([v(0, 1.035, -0.4), v(0, 1.05, -0.28), v(0, 1.04, -0.1), v(0, 0.99, 0.0)], [0.045, 0.055, 0.05, 0.035], [0.012, 0.015, 0.014, 0.01], 3), m.chrome);
  const n = v(0, Math.sin(1.25), Math.cos(1.25));
  const gp = v(0, 1.065, -0.27);
  add(g, new THREE.CylinderGeometry(0.05, 0.05, 0.02, 32).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), n)).translate(gp.x, gp.y, gp.z), m.chrome);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.043, 32), new THREE.MeshStandardMaterial({ map: gaugeTexture(220, 20, 'km/h'), roughness: 0.3 }));
  face.quaternion.setFromUnitVectors(v(0, 0, 1), n);
  face.position.copy(gp).addScaledVector(n, 0.011);
  g.add(face);
  // Fuel caps either side of the console, the badge on each side of the tank.
  mirror((s) => {
    add(g, new THREE.CylinderGeometry(0.03, 0.03, 0.015, 24).translate(s * 0.09, 1.04, -0.18), m.chrome);
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.055, 40), m.badge);
    badge.position.set(s * 0.198, 0.93, -0.22);
    badge.rotation.y = (s * Math.PI) / 2;
    g.add(badge);
  });
  // The seat: low and scooped for the rider, the pillion rising behind; a chrome grab rail.
  const sc = [v(0, 0.76, 0.02), v(0, 0.71, 0.12), v(0, 0.69, 0.24), v(0, 0.71, 0.36), v(0, 0.76, 0.48), v(0, 0.79, 0.62), v(0, 0.79, 0.7)];
  add(g, shell(sc, [0.1, 0.17, 0.19, 0.18, 0.14, 0.13, 0.1], [0.035, 0.045, 0.05, 0.05, 0.045, 0.04, 0.03], 2.8), m.leather);
  // The rear fender, deep and long over the tyre, the tail light and plate on its end.
  add(g, new THREE.CylinderGeometry(r + 0.035, r + 0.035, 0.24, 40, 1, true, -0.15, 2.0).rotateZ(Math.PI / 2).translate(REAR_AXLE.x, REAR_AXLE.y, REAR_AXLE.z), m.paint);
  mirror((s) => add(g, new THREE.CylinderGeometry(r + 0.036, r + 0.036, 0.008, 40, 1, true, -0.15, 2.0).rotateZ(Math.PI / 2).translate(REAR_AXLE.x + s * 0.12, REAR_AXLE.y, REAR_AXLE.z), m.chrome));
  // Floorboards for the rider, chrome-edged rubber, well forward; the passenger's pegs.
  mirror((s) => {
    add(g, new RoundedBoxGeometry(0.11, 0.02, 0.3, 3, 0.008).translate(s * 0.27, 0.3, -0.24), m.chrome);
    add(g, new RoundedBoxGeometry(0.1, 0.012, 0.28, 3, 0.005).translate(s * 0.27, 0.316, -0.24), m.rubber);
    add(g, rod(v(s * 0.12, 0.3, -0.24), v(s * 0.22, 0.3, -0.24), 0.012, 10), m.black);
    add(g, rod(v(s * 0.14, 0.42, 0.42), v(s * 0.23, 0.42, 0.42), 0.011, 10), m.chrome);
  });
  // The battery and oil tank's cover under the seat.
  mirror((s) => add(g, new RoundedBoxGeometry(0.03, 0.16, 0.2, 3, 0.012).translate(s * 0.13, 0.52, 0.3), m.chrome));
  const wheelG = discWheel(m, r, 0.15, false);
  wheelG.position.copy(REAR_AXLE);
  g.add(wheelG);
  return wheelG;
}

/** Builds the cruiser. `env` lights the chrome and paint. */
export function buildCruiser(env: THREE.Texture | null = null, look: CruiserLook = CRUISER_LOOK): Bike {
  const m = materials(env, look);
  const root = new THREE.Group();
  root.name = 'bike:raijin';
  const r = 0.33;
  engine(root, m);
  exhaust(root, m);
  const rearWheel = body(root, m, r);
  // Tail light on the fender's end, the plate under it, turn signals either side.
  const tailP = REAR_AXLE.clone().add(v(0, (r + 0.04) * Math.sin(1.25), (r + 0.04) * Math.cos(1.25)));
  add(root, new RoundedBoxGeometry(0.1, 0.05, 0.05, 3, 0.015).translate(tailP.x, tailP.y + 0.02, tailP.z + 0.04), m.tail);
  add(root, new THREE.PlaneGeometry(0.2, 0.1).rotateX(-0.35).translate(tailP.x, tailP.y - 0.08, tailP.z + 0.1), m.plate);
  mirror((s) => {
    add(root, rod(v(s * 0.1, tailP.y, tailP.z), v(s * 0.2, tailP.y, tailP.z + 0.02), 0.008, 8), m.chrome);
    add(root, new THREE.SphereGeometry(0.026, 14, 8).scale(1, 1, 1.4).translate(s * 0.21, tailP.y, tailP.z + 0.04), m.amber);
  });
  // The side stand, folded.
  add(root, rod(v(-0.17, 0.25, -0.05), v(-0.2, 0.22, 0.25), 0.011, 8), m.black);
  const f = front(m, r);
  root.add(f.steer);
  return {
    root,
    steer: f.steer,
    steerAxis: STEER_AXIS.clone(),
    frontWheel: f.wheelG,
    rearWheel,
    wheelRadius: { front: r, rear: r },
    rider: { seat: v(0, 0.69, 0.24), gripL: f.gripL, gripR: f.gripR, gripAxisL: f.axisL, gripAxisR: f.axisR, pegL: v(-0.27, 0.32, -0.24), pegR: v(0.27, 0.32, -0.24) },
    lamps: { head: m.head, tail: m.tail },
  };
}
