import * as THREE from 'three';
import type { HandHold } from './shotgun';

/**
 * A wooden baseball bat: pale ash under a thin lacquer, the grain running its length, the handle darkened where
 * it's been held, the maker's oval burned into the barrel (an invented maker: 鳴神, Narukami). 84 cm, a 66 mm
 * barrel tapering to a 25 mm handle and its knob. Built like the katana (models/katana.ts): -z along the barrel,
 * the origin at the top of the handle (where the hands end, the katana's tsuba), the knob behind at +z; it's
 * round, so "the edge" (-y) is only the way it's swung. Both hands on the handle, the right above the left, on
 * opposite sides of it.
 */

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Its whole length, and the handle's (from the knob's end up to the origin). */
export const BAT_LENGTH = 0.84;
export const BAT_HANDLE = 0.24;
/** The radius at the handle and at the barrel's widest. */
const R_HANDLE = 0.0125;
const R_BARREL = 0.033;

/** The profile from the knob's end to the barrel's: [metres from the knob's end, radius]. */
const PROFILE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.0008, 0.013],
  [0.004, 0.0215],
  [0.01, 0.0248],
  [0.017, 0.0248],
  [0.023, 0.021],
  [0.03, 0.0158],
  [0.042, 0.0133],
  [0.09, R_HANDLE],
  [0.2, R_HANDLE],
  [0.27, 0.0131],
  [0.36, 0.0152],
  [0.46, 0.0194],
  [0.55, 0.0248],
  [0.63, 0.0298],
  [0.69, 0.0322],
  [0.74, R_BARREL],
  [0.805, R_BARREL],
  [0.824, 0.0318],
  [0.835, 0.0272],
  [0.8395, 0.02],
  [BAT_LENGTH, 0.014],
  // The end is cupped a little.
  [BAT_LENGTH - 0.004, 0.008],
  [BAT_LENGTH - 0.005, 0],
];

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Ash: pale, with long tan grain lines that wander a little and widen into cathedrals on two faces; darker and
 * duller down the handle; the maker's mark burned in on one face of the barrel. x round the bat, y along it (the
 * knob at the bottom). */
function woodTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 2048;
  return canvas(W, H, (g) => {
    g.fillStyle = '#d8c096';
    g.fillRect(0, 0, W, H);
    // Broad, soft bands of the grain's colour.
    for (let i = 0; i < 26; i++) {
      const x = ((i * 197) % W) + 0.5;
      g.strokeStyle = `rgba(150, 112, 62, ${0.05 + ((i * 7) % 10) / 120})`;
      g.lineWidth = 10 + ((i * 13) % 22);
      g.beginPath();
      for (let y = 0; y <= H; y += 32) g.lineTo(x + Math.sin(y * 0.0021 + i * 1.7) * 10, y);
      g.stroke();
    }
    // The grain lines themselves.
    for (let i = 0; i < 90; i++) {
      const x = ((i * 89) % W) + 0.5;
      g.strokeStyle = `rgba(120, 84, 44, ${0.18 + ((i * 11) % 10) / 45})`;
      g.lineWidth = 0.8 + ((i * 5) % 4) * 0.5;
      g.beginPath();
      for (let y = 0; y <= H; y += 24) g.lineTo(x + Math.sin(y * 0.0026 + i * 0.9) * 7 + Math.sin(y * 0.011 + i) * 1.5, y);
      g.stroke();
    }
    // The handle: darkened by hands, smudged.
    const grip = g.createLinearGradient(0, H, 0, H * 0.62);
    grip.addColorStop(0, 'rgba(70, 48, 28, 0.55)');
    grip.addColorStop(0.7, 'rgba(70, 48, 28, 0.28)');
    grip.addColorStop(1, 'rgba(70, 48, 28, 0)');
    g.fillStyle = grip;
    g.fillRect(0, H * 0.62, W, H * 0.38);
    // Scuffs on the barrel.
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(60, 44, 30, ${0.05 + ((i * 3) % 7) / 80})`;
      g.beginPath();
      g.ellipse((i * 131) % W, H * 0.04 + ((i * 53) % (H * 0.3)), 3 + ((i * 7) % 9), 10 + ((i * 11) % 30), 0, 0, Math.PI * 2);
      g.fill();
    }
    // The maker's mark, burned in: an oval, the name, the model; read with the barrel to the right.
    g.save();
    g.translate(W * 0.25, H * 0.33);
    g.rotate(-Math.PI / 2);
    g.strokeStyle = 'rgba(38, 24, 14, 0.9)';
    g.fillStyle = 'rgba(38, 24, 14, 0.9)';
    g.lineWidth = 5;
    g.beginPath();
    g.ellipse(0, 0, 150, 62, 0, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(0, 0, 138, 52, 0, 0, Math.PI * 2);
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = "bold 50px 'Yu Mincho', 'Yu Gothic', serif";
    g.fillText('鳴神', 0, -8);
    g.font = "bold 17px 'Yu Gothic', sans-serif";
    g.fillText('NARUKAMI', 0, 30);
    g.font = "bold 20px 'Yu Gothic', sans-serif";
    g.fillText('硬式用  PRO MODEL  84', 0, 100);
    g.restore();
  });
}

/** Blood on the barrel: smears and spatters, thickest where it lands (toward the end), as alpha. */
function bloodTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 1024;
  return canvas(W, H, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 120; i++) {
      // Mostly in the top third of the canvas (the barrel's end), thinning down it.
      const y = H * 0.42 * Math.pow((i * 0.618) % 1, 1.7);
      const x = (i * 97) % W;
      const a = 0.7 + ((i * 13) % 30) / 100;
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.beginPath();
      g.ellipse(x, y, 5 + ((i * 7) % 22), 8 + ((i * 11) % 46), 0.03 * ((i % 7) - 3), 0, Math.PI * 2);
      g.fill();
    }
    // Runs down toward the handle.
    for (let i = 0; i < 14; i++) {
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillRect((i * 53) % W, H * 0.1 + ((i * 37) % 120), 3 + (i % 3), 90 + ((i * 29) % 220));
    }
  });
}

export interface Bat {
  readonly root: THREE.Group;
  /** The right hand at the top of the handle and the left just above the knob (the rig's `HandHold`s). */
  readonly grip: HandHold;
  readonly fore: HandHold;
  /** The right hand alone: down by the knob, for the reach. */
  readonly single: HandHold;
  /** The part that strikes: from where the barrel fills out to its end, the bat's frame. */
  readonly base: THREE.Vector3;
  readonly tip: THREE.Vector3;
  readonly label: string;
  /** Blood on the barrel, 0 clean to 1 (it dries darker as it fades). */
  setBlood(amount: number): void;
}

export function buildBat(env: THREE.Texture | null = null): Bat {
  // Lathed about y from the knob's end up, then laid along the frame: the knob's end at +z, the barrel's at -z.
  const pts = PROFILE.map(([along, r]) => new THREE.Vector2(r, along));
  const geo = new THREE.LatheGeometry(pts, 40);
  // The texture by length (the lathe's own goes by the profile's points, which crowd at the ends).
  const at = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < at.count; i++) uv.setY(i, at.getY(i) / BAT_LENGTH);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, BAT_HANDLE);
  geo.computeVertexNormals();
  const wood = new THREE.MeshPhysicalMaterial({ map: woodTexture(), roughness: 0.48, clearcoat: 0.35, clearcoatRoughness: 0.3, envMap: env, envMapIntensity: 0.45 });
  const root = new THREE.Group();
  root.name = 'bat';
  const mesh = new THREE.Mesh(geo, wood);
  mesh.castShadow = true;
  root.add(mesh);
  // Blood over it: the same faces just proud of the wood, wet and dark, as much as `setBlood` says.
  const bloodMat = new THREE.MeshPhysicalMaterial({ color: 0x4a0205, roughness: 0.2, clearcoat: 1, transparent: true, opacity: 0, alphaMap: bloodTexture(), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, envMap: env, envMapIntensity: 0.6 });
  const bloodMesh = new THREE.Mesh(geo, bloodMat);
  bloodMesh.visible = false;
  root.add(bloodMesh);

  // Where the hands go (the rig's HandHold: the palm's middle, its normal, the fingers' way, the rod they close
  // on): the right hand at the top of the handle, the left below it just above the knob, on opposite sides of it
  // (each forearm comes from its own side), the knuckles in line.
  const rod = { r: R_HANDLE + 0.001 };
  const hold = (z: number, side: 1 | -1): HandHold => ({
    at: v(0.011 * side, 0.007 * side, z),
    palm: v(-0.75 * side, -0.66 * side, 0).normalize(),
    fwd: v(0, -side, 0),
    curl: 1,
    thumb: 0.5,
    wrap: { a: v(0, 0, z - 0.05), b: v(0, 0, z + 0.05), ...rod },
  });
  const setBlood = (amount: number): void => {
    const a = THREE.MathUtils.clamp(amount, 0, 1);
    bloodMesh.visible = a > 0.01;
    bloodMat.opacity = Math.min(1, a * 1.3);
    bloodMat.color.setRGB(0.17 * (0.45 + 0.55 * a), 0.004, 0.008);
    bloodMat.roughness = 0.2 + 0.5 * (1 - a);
  };
  return { root, grip: hold(0.06, 1), fore: hold(0.155, -1), single: hold(0.15, 1), base: v(0, 0, -0.22), tip: v(0, 0, BAT_HANDLE - BAT_LENGTH), label: '木製バット bat', setBlood };
}
