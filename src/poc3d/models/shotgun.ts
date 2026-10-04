import * as THREE from 'three';
import { buildPistol } from './pistol';

/**
 * Mack's shotgun, sawn off, out of a yakuza stash. Two designs were reviewed in the showroom:
 *  - `lever` (approved, his): a lever-action with an oversized loop lever (the nod to the films: worked one-handed).
 *  - `double`: a side-by-side double, the gun a Japanese hunting licence actually covers. Not taken; it stays on
 *    the showroom's stand, out of his hands.
 * Built in metres from side profiles extruded across with rounded edges (receiver, stock, lever),
 * cross-sections extruded along the bore (forends, barrel band) and lathed barrels (tapered, crowned,
 * a dark bore) and a lofted handle (rounded sections along a line). The lever-action after the sawn-off
 * 1887s: the stock cut at the wrist into a rounded handle running back and down from the top of the
 * receiver's rounded back, the long loop lever under it, a long slim forend, all dark steel. Finishes: blued steel, the
 * double's action colour-case-hardened (mottled blue, straw and brown, canvas-painted), reddish walnut, a
 * brass bead.
 * The gun's frame: -z forward along the bore, +y up, x to the right; the origin is the back of the
 * receiver, above the pistol grip. `grip` and `fore` say where the hands go and how they lie.
 */

/** Mack's guns (the name is the shotguns', the first two; the pistol is models/pistol.ts). */
export type ShotgunKind = 'lever' | 'double' | 'pistol';
export const SHOTGUN_KINDS: readonly ShotgunKind[] = ['lever', 'double', 'pistol'];
/** The guns Mack carries (the showroom's G cycles them): the lever-action and the Type 54. */
export const MACK_GUNS: readonly ShotgunKind[] = ['lever', 'pistol'];

/** A gun's own holds for the rig (models/firstPerson.ts' HOLD, in the camera's frame), where they differ. */
export type GunHolds = Partial<Record<'low' | 'aim' | 'oneLow' | 'oneAim' | 'run', { readonly pos: THREE.Vector3; readonly rot: THREE.Euler }>>;

/** Where a hand goes on the gun (gun frame): the palm's centre, the palm's normal and the hand's
 * forward (wrist to middle knuckle). */
export interface HandHold {
  readonly at: THREE.Vector3;
  readonly palm: THREE.Vector3;
  readonly fwd: THREE.Vector3;
  /** How far the fingers curl (radians at each joint, or with `wrap` a scale on how far they may) and the thumb. */
  readonly curl: number;
  readonly thumb: number;
  /** What the fingers close round: a rod from a to b (the hold's frame) of half-depth r across the side plane and
   * half-width rx (default r) across the gun; they stop on touching it. */
  readonly wrap?: { readonly a: THREE.Vector3; readonly b: THREE.Vector3; readonly r: number; readonly rx?: number };
  /** The index finger rests on the trigger instead of closing with the rest. */
  readonly trigger?: boolean;
  /**
   * Where the hold lies in the hand: metres along it from the wrist, and off the palm. A gun's grip fills the
   * palm (the default); something thin (a steering wheel's rim) sits at the fingers' roots.
   */
  readonly seat?: readonly [number, number];
  /**
   * The thumb hooked round what's held from the side the hand is on (a steering wheel's rim: over its near face
   * and round its inside): `along` the hold's own line (the hold's frame), `off` where on its section the thumb's
   * first joint lies (from `at`), `round` the side it goes on round to.
   */
  readonly thumbRest?: { readonly along: THREE.Vector3; readonly off: THREE.Vector3; readonly round: THREE.Vector3 };
}


export interface Shotgun {
  readonly kind: ShotgunKind;
  readonly root: THREE.Group;
  /** The right hand's hold; it lives on `lever` for the lever-action, so the hand works it. */
  readonly grip: HandHold;
  readonly gripParent: THREE.Object3D;
  readonly fore: HandHold;
  /** The muzzle(s), gun frame. */
  readonly muzzles: readonly THREE.Vector3[];
  /** The lever (lever-action), turning about its pivot's x: 0 shut, about 0.9 thrown. */
  readonly lever: THREE.Object3D | null;
  readonly shells: number;
  /** Its name; pellets a shot and their cone's half-angle (rad); how hard it kicks (1 a shotgun's). */
  readonly label?: string;
  readonly pellets?: number;
  readonly spread?: number;
  readonly recoil?: number;
  /** A pistol's slide, kicked back along +z on a shot. */
  readonly slide?: THREE.Object3D;
  readonly holds?: GunHolds;
}

/** A seeded random for the painted textures. */
function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function canvasTexture(size: number, paint: (g: CanvasRenderingContext2D, rnd: () => number) => void, seed: number, repeat: number, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d')!, rng(seed));
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

/** Walnut: dark streaks of grain along the wood, a little figure across. */
function paintWalnut(g: CanvasRenderingContext2D, rnd: () => number): void {
  g.fillStyle = '#4e2418';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 180; i++) {
    const y = rnd() * 256;
    g.strokeStyle = `rgba(${rnd() < 0.55 ? '30,10,6' : '112,52,34'},${0.12 + rnd() * 0.3})`;
    g.lineWidth = 0.5 + rnd() * 2.5;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 3 + (rnd() - 0.5) * 1.5);
    g.stroke();
  }
}

let textures: { walnut: THREE.CanvasTexture; walnutAlong: THREE.CanvasTexture; case: THREE.CanvasTexture } | null = null;

function shotgunTextures(): NonNullable<typeof textures> {
  if (textures) return textures;
  const walnut = canvasTexture(256, paintWalnut, 11, 9);
  // The same, turned a quarter: on a cross-section extruded along the bore the grain then runs along it.
  const walnutAlong = walnut.clone();
  walnutAlong.center.set(0.5, 0.5);
  walnutAlong.rotation = Math.PI / 2;
  textures = {
    walnut,
    walnutAlong,
    // Colour case hardening: soft overlapping blooms of deep blue, violet, straw, brown and grey.
    case: canvasTexture(256, (g, rnd) => {
      g.fillStyle = '#34363e';
      g.fillRect(0, 0, 256, 256);
      const cols = ['22,38,86', '58,36,90', '128,96,40', '84,50,26', '70,74,86', '30,50,104'];
      for (let i = 0; i < 90; i++) {
        const x = rnd() * 256;
        const y = rnd() * 256;
        const r = 8 + rnd() * 34;
        const c = cols[Math.floor(rnd() * cols.length)];
        for (const [ox, oy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) {
          const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          gr.addColorStop(0, `rgba(${c},0.5)`);
          gr.addColorStop(1, `rgba(${c},0)`);
          g.fillStyle = gr;
          g.fillRect(x + ox - r, y + oy - r, 2 * r, 2 * r);
        }
      }
    }, 31, 12),
  };
  return textures;
}

type Mats = Record<'blued' | 'case' | 'bright' | 'wood' | 'woodAlong' | 'endGrain' | 'black' | 'brass', THREE.MeshStandardMaterial>;

function materials(env: THREE.Texture | null): Mats {
  const t = shotgunTextures();
  return {
    blued: new THREE.MeshStandardMaterial({ color: 0x1a1d26, metalness: 1, roughness: 0.3, envMap: env, envMapIntensity: 1.5 }),
    case: new THREE.MeshStandardMaterial({ color: 0xc8c8c8, map: t.case, metalness: 1, roughness: 0.36, envMap: env, envMapIntensity: 1.3 }),
    bright: new THREE.MeshStandardMaterial({ color: 0x8a8c92, metalness: 1, roughness: 0.35, envMap: env, envMapIntensity: 1.2 }),
    wood: new THREE.MeshStandardMaterial({ color: 0xffffff, map: t.walnut, roughness: 0.42, envMap: env, envMapIntensity: 0.5 }),
    endGrain: new THREE.MeshStandardMaterial({ color: 0x8a6a60, map: t.walnut, roughness: 0.75, envMap: env, envMapIntensity: 0.3 }),
    woodAlong: new THREE.MeshStandardMaterial({ color: 0xffffff, map: t.walnutAlong, roughness: 0.42, envMap: env, envMapIntensity: 0.5 }),
    black: new THREE.MeshStandardMaterial({ color: 0x020202, roughness: 1 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc09a48, metalness: 1, roughness: 0.25, envMap: env }),
  };
}

type Outline = (s: THREE.Shape) => void;

function shapeOf(pts: readonly [number, number][] | Outline): THREE.Shape {
  const shape = new THREE.Shape();
  if (typeof pts === 'function') pts(shape);
  else {
    shape.moveTo(pts[0][0], pts[0][1]);
    for (const [a, b] of pts.slice(1)) shape.lineTo(a, b);
    shape.closePath();
  }
  return shape;
}

/** A side profile ([z, y] points or an outline, gun frame) extruded `width` across x, centred, its edges
 * rounded by `bevel` (which grows the outline by as much). */
function side(pts: readonly [number, number][] | Outline, width: number, bevel = 0.003, segs = 2): THREE.BufferGeometry {
  const depth = Math.max(0.0005, width - 2 * bevel);
  const geo = new THREE.ExtrudeGeometry(shapeOf(pts), { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segs, curveSegments: 16 });
  geo.translate(0, 0, -depth / 2);
  // Shape (u, v, extrusion) -> gun (x = -extrusion, y = v, z = u).
  geo.rotateY(-Math.PI / 2);
  return geo;
}

/** A cross-section ([x, y] points or an outline) extruded along the bore from z0 back to z1 (z1 < z0). */
function section(pts: readonly [number, number][] | Outline, z0: number, z1: number, bevel = 0.003, segs = 3): THREE.BufferGeometry {
  const depth = Math.max(0.0005, z0 - z1 - 2 * bevel);
  const geo = new THREE.ExtrudeGeometry(shapeOf(pts), { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segs, curveSegments: 16 });
  return geo.translate(0, 0, z1 + bevel);
}

/** A barrel lathed along -z from the breech at z0 for `length`: tapering from r0 to r1, the muzzle crowned
 * round the bore, and the bore's mouth a dark disc a little way in. */
function barrel(g: THREE.Object3D, m: Mats, x: number, y: number, z0: number, length: number, r0: number, r1: number, bore: number): void {
  const L = length;
  const pts = [
    new THREE.Vector2(bore, L - 0.02),
    new THREE.Vector2(bore, L),
    new THREE.Vector2(r1 - 0.0016, L),
    new THREE.Vector2(r1, L - 0.0016),
    new THREE.Vector2(r1 + 0.0004, L - 0.012),
    new THREE.Vector2(r1, L - 0.014),
    new THREE.Vector2(r0, 0),
    new THREE.Vector2(0.001, 0),
  ];
  // Lathe's axis is y: up the barrel; turned onto -z.
  add(g, new THREE.LatheGeometry(pts, 28).rotateX(-Math.PI / 2).translate(x, y, z0), m.blued);
  add(g, new THREE.CircleGeometry(bore, 20).translate(0, 0, -(L - 0.012)).translate(x, y, z0), m.black);
}

/** Screw heads on both sides of a part `width` wide, at [z, y]s, a slot across each. */
function screws(g: THREE.Object3D, m: Mats, width: number, at: readonly [number, number][]): void {
  for (const [z, y] of at) {
    for (const s of [-1, 1]) {
      add(g, new THREE.CylinderGeometry(0.0028, 0.003, 0.0012, 14).rotateZ(Math.PI / 2).translate(s * (width / 2 + 0.0006), y, z), m.bright);
      add(g, new THREE.BoxGeometry(0.0006, 0.0045, 0.0007).rotateX(0.6).translate(s * (width / 2 + 0.0012), y, z), m.black);
    }
  }
}

function add(group: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  group.add(m);
  return m;
}

/** A tapering rod of rounded cross-sections along a line in the gun's side plane: `stations` are distances
 * along it from `start` (z, y) in direction `angle` (radians below the bore, toward the back), each with a
 * half-height and half-width. Sections are superellipses (`power` 2 an ellipse, more a squarer oval); the
 * ends are capped flat. UVs run in metres / `tile` along it and round it, so wood grain runs along. */
function loft(start: [number, number], angle: number, stations: readonly (readonly [number, number, number])[], tile = 0.12, power = 2.6, around = 28): THREE.BufferGeometry {
  const dz = Math.cos(angle);
  const dy = -Math.sin(angle);
  // "Up" across the rod in the side plane; x is across it.
  const uz = -dy;
  const uy = dz;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const ring = (u: number, h: number, w: number): [number, number, number][] => {
    const out: [number, number, number][] = [];
    const cz = start[0] + dz * u;
    const cy = start[1] + dy * u;
    for (let i = 0; i <= around; i++) {
      const t = (i / around) * Math.PI * 2;
      const c = Math.cos(t);
      const sn = Math.sin(t);
      const sx = Math.sign(c) * Math.abs(c) ** (2 / power);
      const sy = Math.sign(sn) * Math.abs(sn) ** (2 / power);
      out.push([w * sx, cy + uy * h * sy, cz + uz * h * sy]);
    }
    return out;
  };
  const rings = stations.map(([u, h, w]) => ({ u, pts: ring(u, h, w) }));
  for (const r of rings) {
    let perim = 0;
    r.pts.forEach((q, i) => {
      if (i > 0) perim += Math.hypot(q[0] - r.pts[i - 1][0], q[1] - r.pts[i - 1][1], q[2] - r.pts[i - 1][2]);
      pos.push(...q);
      uv.push(r.u / tile, perim / tile);
    });
  }
  const n = around + 1;
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < around; i++) {
      const a = j * n + i;
      const b = a + n;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const sides = idx.length;
  // Flat caps: a fan round each end's centre, with their own vertices so the edge stays crisp (group 1).
  const caps: [(typeof rings)[number], boolean][] = [[rings[0], true], [rings[rings.length - 1], false]];
  for (const [r, flip] of caps) {
    const base = pos.length / 3;
    const cz = start[0] + dz * r.u;
    const cy = start[1] + dy * r.u;
    pos.push(0, cy, cz);
    uv.push(0.5, 0.5);
    for (const q of r.pts) {
      pos.push(...q);
      uv.push(0.5 + q[0] / tile, 0.5 + (q[1] - cy) / tile);
    }
    for (let i = 0; i < around; i++) {
      if (flip) idx.push(base, base + 2 + i, base + 1 + i);
      else idx.push(base, base + 1 + i, base + 2 + i);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.addGroup(0, sides, 0);
  geo.addGroup(sides, idx.length - sides, 1);
  geo.computeVertexNormals();
  return geo;
}

/** The handle's slope below the bore (as the 1887 sawn-offs: the stock cut at the wrist). */
const HANDLE_ANGLE = (30 * Math.PI) / 180;
/** Along the handle from where its top leaves the receiver: [distance, half-height, half-width]. Deep where it
 * meets the receiver, narrowing to the wrist, flaring a little to the cut end, its last edge eased round. */
const HANDLE: readonly (readonly [number, number, number])[] = [
  [0, 0.035, 0.016], [0.03, 0.031, 0.0155], [0.065, 0.0275, 0.015], [0.135, 0.029, 0.016],
  [0.198, 0.0315, 0.017], [0.206, 0.0305, 0.0165], [0.21, 0.0285, 0.0152],
];

/** How far the grip hand slants toward the muzzle from square across the handle. */
const GRIP_SLANT = (40 * Math.PI) / 180;

/** A point on the handle's centre line, `u` along it, when its top leaves the receiver at height `top` (z 0.008). */
function handleAt(top: number, u: number): THREE.Vector3 {
  const h0 = HANDLE[0][1];
  const z0 = 0.008 - Math.sin(HANDLE_ANGLE) * h0;
  const y0 = top - Math.cos(HANDLE_ANGLE) * h0;
  return new THREE.Vector3(0, y0 - Math.sin(HANDLE_ANGLE) * u, z0 + Math.cos(HANDLE_ANGLE) * u);
}

/** What's left of the stock, sawn off at the wrist: a rounded wooden handle running back and down from the
 * top of the receiver's back (`top`, its height there), the same on both guns. Returns the right hand's hold. */
function stock(g: THREE.Group, m: Mats, top: number): HandHold {
  const c0 = handleAt(top, 0);
  // The sides walnut, the cut end its darker end grain.
  const mesh = new THREE.Mesh(loft([c0.z, c0.y], HANDLE_ANGLE, HANDLE), [m.wood, m.endGrain]);
  mesh.castShadow = true;
  g.add(mesh);
  // The hand closes round the handle between the wrist and the end: the palm on its right side, the
  // knuckles under it (the hand's forward runs down across the handle).
  return {
    at: handleAt(top, 0.07),
    palm: new THREE.Vector3(-1, 0, 0),
    // Slanted GRIP_SLANT toward the muzzle from square across the handle, so the wrist is behind it and the
    // forearm comes from behind, as on a pistol grip; the fingers then wrap the handle obliquely.
    fwd: new THREE.Vector3(0, -Math.cos(HANDLE_ANGLE), -Math.sin(HANDLE_ANGLE)).multiplyScalar(Math.cos(GRIP_SLANT))
      .addScaledVector(new THREE.Vector3(0, Math.sin(HANDLE_ANGLE), -Math.cos(HANDLE_ANGLE)), Math.sin(GRIP_SLANT)),
    curl: 1,
    thumb: 0.5,
    wrap: { a: handleAt(top, 0.02), b: handleAt(top, 0.2), r: 0.029, rx: 0.016 },
    trigger: true,
  };
}

/** The loop lever's outline (z, y in the gun's frame, with the lever shut): down from the receiver's floor in
 * front of the trigger, back and round under the handle a hand's depth below it, its upper rail running forward
 * along the handle's underside. */
const LOOP: readonly [number, number][] = [
  [-0.032, -0.030], [-0.022, -0.058], [0.005, -0.093], [0.055, -0.129], [0.109, -0.147], [0.146, -0.137],
  [0.146, -0.113], [0.112, -0.089], [0.065, -0.061], [0.021, -0.038],
];

/** The lever-action's receiver at the back, where the handle's top leaves it. */
const RECEIVER_TOP = 0.05;

function leverGun(m: Mats): Shotgun {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  const BORE = 0.024;
  const W = 0.034;
  // Receiver: dark steel, low at the front round the barrel and magazine, rising toward the back where the
  // breech block and hammer sit, its lower tang running down into the handle.
  add(gun, side((s) => {
    s.moveTo(-0.158, -0.022);
    s.lineTo(-0.158, 0.034);
    s.lineTo(-0.085, 0.036);
    s.quadraticCurveTo(-0.04, 0.038, -0.02, 0.05);
    s.quadraticCurveTo(-0.004, 0.058, 0.008, RECEIVER_TOP);
    s.lineTo(0.016, 0.035);
    s.lineTo(0.004, -0.03);
    s.quadraticCurveTo(-0.03, -0.034, -0.06, -0.026);
    s.closePath();
  }, W, 0.0022), m.blued);
  screws(gun, m, W, [[-0.135, 0.012], [-0.09, -0.006], [-0.03, 0.03]]);
  barrel(gun, m, 0, BORE, -0.158, 0.462, 0.0128, 0.0118, 0.0091);
  // The magazine tube under the barrel, a little shorter, its cap.
  add(gun, new THREE.CylinderGeometry(0.0104, 0.0104, 0.38, 24).rotateX(Math.PI / 2).translate(0, -0.006, -0.158 - 0.19), m.blued);
  add(gun, new THREE.CylinderGeometry(0.0108, 0.011, 0.012, 24).rotateX(Math.PI / 2).translate(0, -0.006, -0.544), m.blued);
  add(gun, new THREE.SphereGeometry(0.0108, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 1, 0.35).translate(0, -0.006, -0.55), m.blued);
  // The hammer at the back of the receiver; the trigger inside the loop; the bead.
  add(gun, side((s) => {
    s.moveTo(-0.006, 0.044);
    s.lineTo(-0.002, 0.062);
    s.quadraticCurveTo(0.004, 0.07, 0.016, 0.066);
    s.lineTo(0.016, 0.06);
    s.quadraticCurveTo(0.007, 0.06, 0.006, 0.044);
    s.closePath();
  }, 0.008, 0.0012), m.blued);
  add(gun, side((s) => {
    s.moveTo(-0.012, -0.028);
    s.quadraticCurveTo(0.0, -0.04, -0.002, -0.058);
    s.lineTo(-0.007, -0.057);
    s.quadraticCurveTo(-0.006, -0.04, -0.018, -0.027);
    s.closePath();
  }, 0.005, 0.0008), m.blued);
  add(gun, new THREE.SphereGeometry(0.0026, 10, 8).translate(0, BORE + 0.0135, -0.607), m.brass);
  // Forend: long and slim, walnut along two thirds of the barrel, round the magazine, its front tapered.
  add(gun, section((s) => {
    s.moveTo(-0.016, 0.016);
    s.lineTo(-0.0175, -0.006);
    s.quadraticCurveTo(-0.017, -0.024, 0, -0.025);
    s.quadraticCurveTo(0.017, -0.024, 0.0175, -0.006);
    s.lineTo(0.016, 0.016);
    s.closePath();
  }, -0.168, -0.47, 0.004), m.woodAlong);
  const grip = stock(gun, m, RECEIVER_TOP);
  // The lever, pivoting under the front of the receiver: a bar back along the bottom, then the long loop
  // under the handle, round the fingers.
  const pivot = new THREE.Group();
  pivot.position.set(0, -0.026, -0.13);
  gun.add(pivot);
  const lever = new THREE.Group();
  pivot.add(lever);
  add(lever, side((s) => {
    s.moveTo(0, -0.002);
    s.quadraticCurveTo(-0.006, -0.008, 0, -0.014);
    s.lineTo(0.112, -0.016);
    s.lineTo(0.118, -0.004);
    s.closePath();
  }, 0.011, 0.0018), m.blued);
  const loop = new THREE.CatmullRomCurve3(LOOP.map(([z, y]) => new THREE.Vector3(0, y + 0.026, z + 0.13)), true, 'centripetal');
  add(lever, new THREE.TubeGeometry(loop, 80, 0.0045, 10, true), m.blued);
  // The right hand rides the lever, so working it carries the hand: its hold is in the lever's frame
  // (an anchor that's at the gun's origin while the lever is shut).
  const gripAnchor = new THREE.Group();
  gripAnchor.position.set(0, 0.026, 0.13);
  lever.add(gripAnchor);
  return {
    kind: 'lever',
    root,
    grip,
    gripParent: gripAnchor,
    fore: { at: new THREE.Vector3(-0.012, -0.022, -0.2), palm: new THREE.Vector3(0.55, 1, 0).normalize(), fwd: new THREE.Vector3(0.8, -0.2, -0.75).normalize(), curl: 1, thumb: -0.2, wrap: { a: new THREE.Vector3(0, -0.005, -0.168), b: new THREE.Vector3(0, -0.005, -0.47), r: 0.02 } },
    muzzles: [new THREE.Vector3(0, BORE, -0.62)],
    lever: pivot,
    shells: 5,
  };
}

function doubleGun(m: Mats): Shotgun {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  const BORE = 0.02;
  const X = 0.0122;
  const W = 0.044;
  // The action: a case-hardened block, its front rounded into fences round the barrels' breech.
  add(gun, side((s) => {
    s.moveTo(-0.094, -0.02);
    s.lineTo(-0.094, 0.029);
    s.lineTo(-0.04, 0.032);
    s.quadraticCurveTo(-0.008, 0.034, 0.004, 0.024);
    s.lineTo(0.03, 0.02);
    s.lineTo(0.03, 0.015);
    s.lineTo(0.002, -0.022);
    s.closePath();
  }, W, 0.0035, 3), m.case);
  for (const x of [-X, X]) add(gun, new THREE.SphereGeometry(0.0138, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 1, 0.55).translate(x, BORE, -0.094), m.case);
  screws(gun, m, W, [[-0.07, 0.006], [-0.03, -0.006]]);
  for (const x of [-X, X]) barrel(gun, m, x, BORE, -0.094, 0.306, 0.0124, 0.0114, 0.0089);
  // The top rib and its bead, the bottom rib; the top lever and safety on the tang.
  add(gun, side([[-0.098, BORE + 0.006], [-0.098, BORE + 0.0135], [-0.4, BORE + 0.0115], [-0.4, BORE + 0.006]], 0.008, 0.0008), m.blued);
  add(gun, side([[-0.098, BORE - 0.016], [-0.098, BORE - 0.006], [-0.4, BORE - 0.006], [-0.4, BORE - 0.016]], 0.008, 0.0008), m.blued);
  add(gun, new THREE.SphereGeometry(0.0026, 10, 8).translate(0, BORE + 0.0145, -0.394), m.brass);
  add(gun, side((s) => {
    s.moveTo(-0.004, 0.031);
    s.lineTo(0.028, 0.026);
    s.quadraticCurveTo(0.034, 0.03, 0.028, 0.034);
    s.lineTo(-0.004, 0.037);
    s.closePath();
  }, 0.011, 0.0015).rotateY(0.3).translate(0.007, 0, 0), m.blued);
  add(gun, new THREE.BoxGeometry(0.006, 0.003, 0.01).translate(0, 0.0235, 0.03), m.bright);
  // Splinter forend under the barrels.
  add(gun, section((s) => {
    s.moveTo(-0.021, 0.008);
    s.lineTo(-0.022, -0.006);
    s.quadraticCurveTo(-0.021, -0.022, 0, -0.023);
    s.quadraticCurveTo(0.021, -0.022, 0.022, -0.006);
    s.lineTo(0.021, 0.008);
    s.closePath();
  }, -0.1, -0.24, 0.005), m.woodAlong);
  const grip = stock(gun, m, 0.032);
  // Trigger guard and the two triggers.
  add(gun, new THREE.TorusGeometry(0.022, 0.0032, 8, 24, Math.PI * 1.2).rotateZ(Math.PI * 0.9).rotateY(Math.PI / 2).scale(1, 0.9, 1.1).translate(0, -0.03, -0.012), m.blued);
  for (const [z, l] of [[-0.022, 0.024], [-0.008, 0.022]] as const) {
    add(gun, side((s) => {
      s.moveTo(z - 0.003, -0.02);
      s.quadraticCurveTo(z + 0.007, -0.02 - l * 0.5, z + 0.003, -0.02 - l);
      s.lineTo(z - 0.002, -0.02 - l + 0.002);
      s.quadraticCurveTo(z + 0.002, -0.02 - l * 0.5, z - 0.008, -0.02);
      s.closePath();
    }, 0.005, 0.0008), m.blued);
  }
  return {
    kind: 'double',
    root,
    grip,
    gripParent: gun,
    fore: { at: new THREE.Vector3(-0.016, -0.018, -0.165), palm: new THREE.Vector3(0.55, 1, 0).normalize(), fwd: new THREE.Vector3(0.8, -0.2, -0.75).normalize(), curl: 1, thumb: -0.2, wrap: { a: new THREE.Vector3(0, -0.007, -0.1), b: new THREE.Vector3(0, -0.007, -0.24), r: 0.02 } },
    muzzles: [new THREE.Vector3(-X, BORE, -0.4), new THREE.Vector3(X, BORE, -0.4)],
    lever: null,
    shells: 2,
  };
}

/** Builds a shotgun. `env` is an environment map for the steel (it reads as black plastic without one). */
export function buildShotgun(kind: ShotgunKind, env: THREE.Texture | null = null): Shotgun {
  if (kind === 'pistol') return buildPistol(env);
  const m = materials(env);
  return kind === 'lever' ? { ...leverGun(m), label: 'Sawn-off lever-action', pellets: 9, spread: 0.04 } : { ...doubleGun(m), label: 'Sawn-off double', pellets: 9, spread: 0.045 };
}
