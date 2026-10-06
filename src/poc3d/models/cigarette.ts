import * as THREE from 'three';

/**
 * A cigarette and a cigar: their sizes (shared with the street crowd's, real/smoke.ts), and the thing itself for
 * Mack's hand (models/smoking.ts): a stick that burns down, with an ember, and his lighter.
 */

/** Length and radius (m), and how far from the mouth end the fingers hold it. */
export const STICKS = {
  cigarette: { len: 0.084, r: 0.004, grip: 0.03 },
  cigar: { len: 0.132, r: 0.0095, grip: 0.045 },
} as const;
export type StickKind = keyof typeof STICKS;

export interface Cigarette {
  readonly kind: StickKind;
  /** Its mouth end at the origin, the lit end along +z. */
  readonly root: THREE.Group;
  /** How far it's burnt down (0 fresh to 1, the stub) and how hot the ember is (0 out, ~0.3 idling, 1 on a drag). */
  set(burnt: number, heat: number): void;
  /** Its length now (m): where the lit end is along +z. */
  length(): number;
}

/** How much of the part that burns is left at the stub. */
const STUB = 0.22;

export function buildCigarette(kind: StickKind): Cigarette {
  const S = STICKS[kind];
  const cigar = kind === 'cigar';
  const root = new THREE.Group();
  root.name = kind;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  // (The ember is its own light: brighter than white, so it blooms.)
  const hot = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) });
  const tube = (z0: number, z1: number, r0: number, r1: number, color: number): THREE.Mesh => {
    const g = new THREE.CylinderGeometry(r1, r0, z1 - z0, 8, 1, false);
    // (Along +z, from z0.)
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, (z0 + z1) / 2);
    const c = new THREE.Color(color);
    const cols = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < cols.length; i += 3) cols.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const m = new THREE.Mesh(g, mat);
    root.add(m);
    return m;
  };
  // What doesn't burn: a cigarette's filter; a cigar's foot and its band.
  const fixed = cigar ? 0.27 * S.len : 0.27 * S.len;
  if (cigar) {
    tube(0, 0.2 * S.len, S.r * 0.78, S.r * 0.92, 0x3a2112);
    tube(0.2 * S.len, fixed, S.r * 0.96, S.r * 0.98, 0x8a1a12);
  } else tube(0, fixed, S.r, S.r, 0xa87848);
  // What burns (scaled along z as it goes), the ash on its end, and the ember under the ash.
  const burn = S.len - fixed;
  const body = tube(0, 1, S.r, S.r * (cigar ? 0.94 : 1), cigar ? 0x40241a : 0xd8d4cc);
  const ash = tube(0, 1, S.r * 0.94, S.r * 0.8, cigar ? 0x8a8a88 : 0x5c5a58);
  const ember = new THREE.Mesh(new THREE.CylinderGeometry(S.r * 0.96, S.r * 0.96, 1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5), hot);
  root.add(ember);
  let len = S.len;
  const set = (burnt: number, heat: number): void => {
    const left = burn * (1 - (1 - STUB) * THREE.MathUtils.clamp(burnt, 0, 1));
    const ashLen = (cigar ? 0.012 : 0.006) + 0.004 * (1 - heat);
    body.position.z = fixed;
    body.scale.z = Math.max(1e-4, left - ashLen);
    ember.position.z = fixed + left - ashLen - 0.0015;
    ember.scale.z = 0.003;
    ash.position.z = fixed + left - ashLen;
    ash.scale.z = ashLen;
    hot.color.setRGB(3.4 * heat, 1.0 * heat, 0.18 * heat);
    len = fixed + left;
  };
  set(0, 0);
  return { kind, root, set, length: () => len };
}

/** His lighter: a brushed steel flip-top, open, the wick at the top (+y), about the size of the palm's width. */
export function buildLighter(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'lighter';
  const steel = new THREE.MeshLambertMaterial({ color: 0x9a9a94 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material): void => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    g.add(b);
  };
  // The case, the lid thrown back on its hinge, the chimney round the wick.
  box(0.036, 0.038, 0.012, 0, 0.019, 0, steel);
  box(0.036, 0.018, 0.012, -0.03, 0.036, 0, steel);
  box(0.016, 0.013, 0.009, 0.004, 0.0445, 0, dark);
  return g;
}
/** Where the flame stands on the lighter (its own frame). */
export const LIGHTER_WICK = new THREE.Vector3(0.004, 0.056, 0);
