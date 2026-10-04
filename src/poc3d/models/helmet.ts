import * as THREE from 'three';

/**
 * A full-face motorcycle helmet for the cast (models/firstPerson.ts `setHelmet`): one shell round the head, its
 * chin bar jutting ahead of the jaw, open at the neck and at the eye port; a smoked visor over the port on its
 * pivots, a rubber gasket round the port and the neck, a stripe over the crown, vents at the brow and the chin,
 * a spoiler at the back, and a dark liner inside. Built round a head's centre at the origin, facing +z, in
 * metres, sized for a man's head (Mack's): the eyes sit about 1 cm above the centre and 6.5 cm ahead of it.
 */

export interface HelmetLook {
  readonly shell: number;
  /** The stripe over the crown and the spoiler. */
  readonly accent: number;
  /** The chin bar, if not the shell's colour. */
  readonly chin?: number;
}

export const HELMET_LOOKS = {
  black: { shell: 0x0c0c0e, accent: 0xc8141c },
  /** To go with the red and black Hayate: a red shell, the chin bar, stripe and spoiler black. */
  redblack: { shell: 0xa80c16, accent: 0x0a0a0c, chin: 0x0a0a0c },
} satisfies Record<string, HelmetLook>;

export const HELMET_LOOK: HelmetLook = HELMET_LOOKS.black;

/** The shell's centre and radii (across, up, front to back). */
const C = new THREE.Vector3(0, 0.022, -0.006);
const R = new THREE.Vector3(0.146, 0.166, 0.172);
const DEG = Math.PI / 180;
/** The eye port: its half-width round the front, and its top and bottom (angles down from the crown). */
const PORT_PHI = 66 * DEG;
const PORT_TOP = 78 * DEG;
const PORT_BOTTOM = 105 * DEG;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How far down the shell reaches at azimuth `phi` (0 the front): low under the chin, up at the nape. */
function bottom(phi: number): number {
  const f = Math.cos(phi);
  return (f > 0 ? 133 + 9 * f : 133 + 3 * f) * DEG;
}

/** The point on the shell at (phi round from the front, theta down from the crown), scaled by `k`: an
 * ellipsoid with the chin bar pushed forward and the jaw flared a touch. */
function at(phi: number, theta: number, k = 1): THREE.Vector3 {
  const s = Math.sin(theta);
  let x = R.x * s * Math.sin(phi);
  const y = R.y * Math.cos(theta);
  let z = R.z * s * Math.cos(phi);
  const front = smooth(0.2, 0.85, Math.cos(phi));
  const low = smooth(98 * DEG, 125 * DEG, theta);
  z *= 1 + 0.16 * front * low;
  x *= 1 + 0.04 * low;
  return new THREE.Vector3(x, y, z).multiplyScalar(k).add(C);
}

/** A patch of the shell's surface over a range of angles, `keep` choosing which cells to make; vertex
 * colours from `paint`. */
function surface(
  phis: [number, number],
  thetas: (phi: number) => [number, number],
  nu: number,
  nv: number,
  k: number,
  keep: (phi: number, theta: number) => boolean = () => true,
  paint?: (p: THREE.Vector3, phi: number, theta: number) => THREE.Color,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const ang: [number, number][] = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const phi = phis[0] + ((phis[1] - phis[0]) * i) / nu;
      const [t0, t1] = thetas(phi);
      const theta = t0 + ((t1 - t0) * j) / nv;
      const p = at(phi, theta, k);
      pos.push(p.x, p.y, p.z);
      ang.push([phi, theta]);
      const c = paint ? paint(p, phi, theta) : new THREE.Color(1, 1, 1);
      col.push(c.r, c.g, c.b);
    }
  }
  const W = nu + 1;
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * W + i;
      const phi = (ang[a][0] + ang[a + W + 1][0]) / 2;
      const theta = (ang[a][1] + ang[a + W + 1][1]) / 2;
      if (!keep(phi, theta)) continue;
      idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** A tube through points on the shell. */
function bead(pts: THREE.Vector3[], r: number, closed = false): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed, 'centripetal'), pts.length * 3, r, 8, closed);
}

const inPort = (phi: number, theta: number): boolean => Math.abs(phi) < PORT_PHI && theta > PORT_TOP && theta < PORT_BOTTOM;

export function buildHelmet(env: THREE.Texture | null = null, look: HelmetLook = HELMET_LOOK): THREE.Group {
  const g = new THREE.Group();
  g.name = 'helmet';
  const shell = new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.15, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04, envMap: env, envMapIntensity: 0.55 });
  const accent = new THREE.MeshPhysicalMaterial({ color: look.accent, metalness: 0.15, roughness: 0.28, clearcoat: 1, envMap: env, envMapIntensity: 0.55 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x070707, roughness: 0.8, envMap: env, envMapIntensity: 0.2 });
  const liner = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.95, side: THREE.BackSide });
  const visor = new THREE.MeshPhysicalMaterial({ color: 0x06070a, metalness: 0.35, roughness: 0.04, clearcoat: 1, transparent: true, opacity: 0.9, envMap: env, envMapIntensity: 1, side: THREE.DoubleSide, forceSinglePass: true });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  const shellC = new THREE.Color(look.shell);
  const chinC = new THREE.Color(look.chin ?? look.shell);
  const accentC = new THREE.Color(look.accent);
  const down = (phi: number): [number, number] => [0.001, bottom(phi)];

  // The shell, open at the port; the stripe down the crown (brow to nape), the chin bar its own colour.
  add(
    surface([-Math.PI, Math.PI], down, 96, 56, 1, (phi, theta) => !inPort(phi, theta), (p, phi, theta) => {
      const front = Math.cos(phi) > 0;
      if (front && theta > PORT_BOTTOM - 0.02 && Math.abs(phi) < PORT_PHI + 14 * DEG) return chinC;
      const stripe = Math.abs(p.x) < 0.018 && Math.abs(p.x) > 0.006 && theta < (front ? PORT_TOP - 0.06 : 128 * DEG);
      return stripe ? accentC : shellC;
    }),
    shell,
  );
  // The liner, seen through the port and up from the neck.
  add(surface([-Math.PI, Math.PI], down, 48, 28, 0.94), liner);
  // The visor: a smoked sheet over the port, a little proud of the shell and a little larger than it.
  add(surface([-PORT_PHI - 6 * DEG, PORT_PHI + 6 * DEG], () => [PORT_TOP - 5 * DEG, PORT_BOTTOM + 2 * DEG], 48, 12, 1.012), visor);
  // Its pivots either side, round plates on the shell.
  const up = new THREE.Vector3(0, 1, 0);
  for (const s of [-1, 1]) {
    const p = at(s * (PORT_PHI + 12 * DEG), 84 * DEG, 1.01);
    const pivot = add(new THREE.CylinderGeometry(0.017, 0.017, 0.006, 20), rubber);
    pivot.position.copy(p);
    pivot.quaternion.setFromUnitVectors(up, p.clone().sub(C).normalize());
  }
  // The rubber gasket round the port (its corners rounded) and round the neck.
  const port: THREE.Vector3[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const phi = Math.sign(c) * Math.abs(c) ** 0.35 * PORT_PHI;
    const theta = (PORT_TOP + PORT_BOTTOM) / 2 + Math.sign(s) * Math.abs(s) ** 0.35 * ((PORT_BOTTOM - PORT_TOP) / 2);
    port.push(at(phi, theta, 1.002));
  }
  add(bead(port, 0.0035, true), rubber);
  const neck: THREE.Vector3[] = [];
  for (let i = 0; i < 48; i++) {
    const phi = -Math.PI + (i / 48) * Math.PI * 2;
    neck.push(at(phi, bottom(phi), 0.99));
  }
  add(bead(neck, 0.007, true), rubber);
  // Vents: two slots at the brow, a grille in the chin bar.
  for (const s of [-1, 1]) {
    const p = at(s * 12 * DEG, 42 * DEG, 1.004);
    const vent = add(new THREE.BoxGeometry(0.024, 0.006, 0.03), rubber);
    vent.position.copy(p);
    vent.quaternion.setFromUnitVectors(up, p.clone().sub(C).normalize());
  }
  {
    const grille = add(new THREE.BoxGeometry(0.05, 0.02, 0.008), rubber);
    grille.position.copy(at(0, 118 * DEG, 1.006));
    grille.rotation.x = -0.35;
  }
  // The spoiler: a low fin across the back of the crown.
  {
    const sp = add(new THREE.BoxGeometry(0.1, 0.014, 0.04), accent);
    sp.position.copy(at(Math.PI, 72 * DEG, 1.0)).add(new THREE.Vector3(0, 0.002, -0.008));
    sp.rotation.x = 0.5;
  }
  return g;
}
