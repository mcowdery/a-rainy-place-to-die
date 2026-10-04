import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { GunHolds, HandHold, Shotgun } from './shotgun';

/**
 * Mack's handgun: the 黒星 Type 54, the black-market pistol of the yakuza (a slim, flat single-action
 * automatic: a long slide with its serrations at the back, an exposed hammer, a small trigger guard, black grips
 * with a star in a circle). Built in the guns' frame (models/shotgun.ts: -z along the bore, +y up, the origin at
 * the top of the grip under the slide's back), with its own holds for the rig: low ready (muzzle down), a
 * two-handed stance, one-handed by the thigh or out at arm's length. The slide (`slide`) kicks back on a shot.
 */

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** The grip's slant back from vertical. */
const GRIP_SLANT = (18 * Math.PI) / 180;
const GRIP_DIR = v(0, -Math.cos(GRIP_SLANT), Math.sin(GRIP_SLANT));

/** The star-in-a-circle grip panel (the 黒星, "black star"), as a texture. */
function gripTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#121214';
  g.fillRect(0, 0, 128, 256);
  // Fine ribs across the grip.
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  g.lineWidth = 3;
  for (let y = 10; y < 256; y += 9) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(128, y);
    g.stroke();
  }
  g.translate(64, 70);
  g.fillStyle = '#1c1c20';
  g.beginPath();
  g.arc(0, 0, 34, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#2c2c32';
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = '#2e2e34';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 26 : 11;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A side profile (z, y) extruded `width` across x, centred, with rounded edges. */
function side(pts: readonly [number, number][], width: number, bevel = 0.0015): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (const [a, b] of pts.slice(1)) s.lineTo(a, b);
  s.closePath();
  const depth = Math.max(0.0005, width - 2 * bevel);
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
  geo.translate(0, 0, -depth / 2);
  return geo.rotateY(-Math.PI / 2);
}

export function buildPistol(env: THREE.Texture | null = null): Shotgun {
  const blued = new THREE.MeshStandardMaterial({ color: 0x17191f, metalness: 1, roughness: 0.32, envMap: env, envMapIntensity: 1.2 });
  const worn = new THREE.MeshStandardMaterial({ color: 0x3a3c42, metalness: 1, roughness: 0.4, envMap: env, envMapIntensity: 1.2 });
  const black = new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 1 });
  const grips = new THREE.MeshStandardMaterial({ map: gripTexture(), roughness: 0.6, envMap: env, envMapIntensity: 0.3 });
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  const add = (p: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    p.add(mesh);
    return mesh;
  };
  // The frame: the dust cover under the slide, the grip frame slanting back, the trigger guard.
  add(gun, side([[-0.14, -0.002], [-0.14, 0.006], [0.04, 0.006], [0.042, -0.004], [0.05, -0.016], [0.056, -0.104], [0.026, -0.112], [0.006, -0.03], [-0.03, -0.008], [-0.14, -0.006]], 0.026), blued);
  add(gun, new THREE.TorusGeometry(0.02, 0.003, 6, 20, Math.PI * 1.15).rotateZ(Math.PI * 0.92).rotateY(Math.PI / 2).scale(1, 0.85, 1.25).translate(0, -0.024, -0.022), blued);
  add(gun, side([[-0.024, -0.006], [-0.018, -0.006], [-0.012, -0.03], [-0.017, -0.032]], 0.005, 0.0008), worn);
  // Grip panels with the star, either side.
  for (const s of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.082), grips);
    panel.position.copy(v(s * 0.0142, -0.058, 0.032));
    panel.rotation.set(-GRIP_SLANT, (s * Math.PI) / 2, 0, 'YXZ');
    gun.add(panel);
  }
  // The slide: long and flat, serrations at the back, the front sight, the ejection port; it kicks back.
  const slide = new THREE.Group();
  gun.add(slide);
  add(slide, side([[-0.155, 0.004], [-0.155, 0.028], [-0.15, 0.032], [0.032, 0.032], [0.038, 0.028], [0.038, 0.004]], 0.024, 0.0018), blued);
  for (let i = 0; i < 9; i++) add(slide, new THREE.BoxGeometry(0.0252, 0.018, 0.0018).translate(0, 0.019, 0.008 + i * 0.0032), black);
  add(slide, new THREE.BoxGeometry(0.004, 0.006, 0.006).translate(0, 0.035, -0.148), blued);
  add(slide, new THREE.BoxGeometry(0.012, 0.005, 0.008).translate(0, 0.034, 0.03), blued);
  add(slide, new THREE.BoxGeometry(0.0005, 0.01, 0.026).translate(0.0122, 0.022, -0.03), black);
  // The muzzle's mouth, dark.
  add(slide, new THREE.CircleGeometry(0.0046, 16).rotateY(Math.PI).translate(0, 0.017, -0.1555), black);
  // The hammer behind, a small spur; the slide stop and the magazine's base.
  add(gun, side([[0.034, 0.012], [0.05, 0.03], [0.056, 0.028], [0.046, 0.01]], 0.007, 0.0008), worn);
  add(gun, new THREE.CylinderGeometry(0.0035, 0.0035, 0.004, 10).rotateZ(Math.PI / 2).translate(0.0142, 0.0, -0.02), worn);
  add(gun, new RoundedBoxGeometry(0.024, 0.008, 0.036, 2, 0.002).translate(0, -0.11, 0.042).rotateX(0), blued);

  const at = (d: number): THREE.Vector3 => v(0, -0.012, 0.012).addScaledVector(GRIP_DIR, d);
  const gripFwd = v(0, -Math.sin(GRIP_SLANT), -Math.cos(GRIP_SLANT));
  const grip: HandHold = {
    // The palm's middle sits back on the grip's side, over the backstrap (a pistol's grip is short front to
    // back: the knuckles come about to its front edge and the fingers wrap round from there).
    at: at(0.045).addScaledVector(gripFwd, -0.034),
    palm: v(-1, 0, 0),
    // Square to the grip, toward the front: the fingers wrap its front strap.
    fwd: gripFwd,
    curl: 1,
    thumb: 0.4,
    // What the fingers close on: the grip itself, deeper at the top than at the base, between its panels.
    wrap: { a: v(0, -0.03, 0.029), b: v(0, -0.104, 0.041), r: 0.019, rx: 0.015 },
    trigger: true,
  };
  // Two hands: the left wraps the right's fingers from the left side, its thumb along the frame.
  const foreFwd = v(0.15, -0.45, -0.88).normalize();
  const fore: HandHold = {
    at: at(0.06).add(v(-0.03, -0.004, -0.018)).addScaledVector(foreFwd, -0.022),
    palm: v(1, 0.15, 0.1).normalize(),
    fwd: foreFwd,
    curl: 0.95,
    thumb: -0.2,
    // What its fingers close on: the grip with the right hand's fingers round its front.
    wrap: { a: v(0, -0.035, 0.016), b: v(0, -0.108, 0.03), r: 0.033, rx: 0.028 },
  };
  const R = (x: number, y: number, z: number): THREE.Euler => new THREE.Euler(x, y, z, 'YXZ');
  const holds: GunHolds = {
    low: { pos: v(0.06, -0.33, -0.3), rot: R(-0.62, 0.06, 0) },
    aim: { pos: v(0.03, -0.13, -0.44), rot: R(0.01, 0, 0) },
    oneLow: { pos: v(0.22, -0.58, -0.04), rot: R(-1.3, 0.05, 0) },
    oneAim: { pos: v(0.14, -0.16, -0.5), rot: R(0.01, 0.01, -0.05) },
    run: { pos: v(0.22, -0.6, -0.06), rot: R(-1.3, 0.06, 0.1) },
  };
  return { kind: 'pistol', root, grip, gripParent: gun, fore, muzzles: [v(0, 0.017, -0.156)], lever: null, shells: 8, label: '黒星 Type 54', pellets: 1, spread: 0.006, recoil: 0.55, slide, holds };
}
