import * as THREE from 'three';
import { lensEnvironment } from './sunglasses';

/**
 * A RoboCop-style helmet for Mack (a face style under review: models/faceShadow.ts `robo`, models/firstPerson.ts
 * `setFaceStyle`): a close-fitting metal shell over the crown, the back of the head and the ears, coming forward
 * as cheek guards along the jaw; a dark visor band across the eyes from temple to temple; the nose, mouth and chin
 * left bare, as the film's. A ridge down the crown, ear discs, a seam round the visor. Built round the head's
 * centre at the origin, facing +z, in metres, like the bike helmet (models/helmet.ts): Mack's eyes sit about 1 cm
 * above the centre and 6.5 cm ahead of it.
 */

const DEG = Math.PI / 180;
/** The shell's centre and radii (across, up, front to back): close over the skull, a centimetre proud of it. */
const C = new THREE.Vector3(0, 0.01, -0.03);
const R = new THREE.Vector3(0.094, 0.13, 0.138);
/** The visor band: half its width round the front, its top and bottom (angles down from the crown). */
const VISOR_PHI = 80 * DEG;
const VISOR_TOP = 74 * DEG;
const VISOR_BOTTOM = 97 * DEG;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How far down the shell reaches at azimuth `phi` (0 the front): just under the visor in front, down the cheek
 * guards to the jaw at the sides, to the nape behind. */
function bottom(phi: number): number {
  const a = Math.abs(phi);
  if (a < 40 * DEG) return VISOR_BOTTOM;
  if (a < 72 * DEG) return VISOR_BOTTOM + (118 * DEG - VISOR_BOTTOM) * smooth(40 * DEG, 72 * DEG, a);
  return 118 * DEG + 14 * DEG * smooth(72 * DEG, 160 * DEG, a);
}

/** The point on the shell at (phi round from the front, theta down from the crown), scaled by `k`. The cheek
 * guards come in a little under the cheekbones; the front over the brow is a little flatter. */
function at(phi: number, theta: number, k = 1): THREE.Vector3 {
  const s = Math.sin(theta);
  let x = R.x * s * Math.sin(phi);
  const y = R.y * Math.cos(theta);
  let z = R.z * s * Math.cos(phi);
  const low = smooth(95 * DEG, 120 * DEG, theta);
  x *= 1 - 0.1 * low;
  z *= 1 + 0.05 * smooth(0.6, 1, Math.cos(phi)) * (1 - low);
  return new THREE.Vector3(x, y, z).multiplyScalar(k).add(C);
}

function surface(phis: [number, number], thetas: (phi: number) => [number, number], nu: number, nv: number, k: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const phi = phis[0] + ((phis[1] - phis[0]) * i) / nu;
      const [t0, t1] = thetas(phi);
      const p = at(phi, t0 + ((t1 - t0) * j) / nv, k);
      pos.push(p.x, p.y, p.z);
    }
  const W = nu + 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * W + i;
    idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function bead(pts: THREE.Vector3[], r: number, closed = false): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed, 'centripetal'), pts.length * 3, r, 8, closed);
}

export function buildRoboHelmet(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'robo-helmet';
  const env = lensEnvironment();
  const metal = new THREE.MeshPhysicalMaterial({ color: 0x9aa4b0, metalness: 0.9, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.15, envMap: env, envMapIntensity: 1.1, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.8, roughness: 0.45, envMap: env, envMapIntensity: 0.6 });
  const visor = new THREE.MeshPhysicalMaterial({ color: 0x050608, metalness: 0.6, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMap: env, envMapIntensity: 1.5, side: THREE.DoubleSide });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  // The shell all round, down to its edge.
  add(surface([-Math.PI, Math.PI], (phi) => [0.001, bottom(phi)], 96, 48, 1), metal);
  // The visor, a band a little proud of the shell across the eyes.
  add(surface([-VISOR_PHI, VISOR_PHI], () => [VISOR_TOP, VISOR_BOTTOM], 48, 10, 1.018), visor);
  // A seam round the visor, and a bead along the shell's lower edge.
  const seam: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) seam.push(at(-VISOR_PHI + (2 * VISOR_PHI * i) / 24, VISOR_TOP - 1.5 * DEG, 1.02));
  for (let i = 0; i <= 6; i++) seam.push(at(VISOR_PHI + 1.5 * DEG, VISOR_TOP + ((VISOR_BOTTOM - VISOR_TOP) * i) / 6, 1.02));
  for (let i = 24; i >= 0; i--) seam.push(at(-VISOR_PHI + (2 * VISOR_PHI * i) / 24, VISOR_BOTTOM + 1.5 * DEG, 1.02));
  for (let i = 6; i >= 0; i--) seam.push(at(-VISOR_PHI - 1.5 * DEG, VISOR_TOP + ((VISOR_BOTTOM - VISOR_TOP) * i) / 6, 1.02));
  add(bead(seam, 0.0022, true), dark);
  const edge: THREE.Vector3[] = [];
  for (let i = 0; i < 64; i++) {
    const phi = -Math.PI + (i / 64) * Math.PI * 2;
    edge.push(at(phi, bottom(phi), 1.0));
  }
  add(bead(edge, 0.003, true), dark);
  // The ridge down the crown, brow to nape.
  const ridge: THREE.Vector3[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = -60 * DEG + (i / 20) * 190 * DEG;
    ridge.push(t < 0 ? at(0, -t, 1.012) : at(Math.PI, t, 1.012));
  }
  ridge.sort((a, b) => b.z - a.z);
  add(bead(ridge, 0.004), metal);
  // Ear discs.
  const up = new THREE.Vector3(0, 1, 0);
  for (const s of [-1, 1]) {
    const p = at(s * 95 * DEG, 100 * DEG, 1.012);
    const disc = add(new THREE.CylinderGeometry(0.022, 0.024, 0.008, 28), dark);
    disc.position.copy(p);
    disc.quaternion.setFromUnitVectors(up, p.clone().sub(C).normalize());
  }
  return g;
}
