import * as THREE from 'three';

/**
 * Mack's sunglasses (models/firstPerson.ts `setGlasses`): the T2 nod in the story ("sunglasses that hide eyes that
 * don't quite react to light"), and one more thing between the camera and his face. Three designs:
 *
 * - `wrap`: a single shield lens wrapped round from temple to temple under a flat top bar, a notch over the nose,
 *   the lens's lower edge sweeping up at the outsides (after the wraparounds of the films);
 * - `aviator`: teardrop lenses in thin gold wire, a double bridge, wire arms;
 * - `slim`: narrow rectangles in heavy black acetate, the 90s look.
 *
 * Built round the head's centre at the origin, facing +z, in metres, like the helmet (models/helmet.ts): Mack's eyes
 * (measured on the rig) are level with the centre and about 5.6 cm ahead of it, the lenses 3.4 cm ahead of them,
 * his temples about 7.5 cm either side, his ears a little below and behind the centre. The lenses are mirrored:
 * from outside they show the street, not the eyes.
 */

export type GlassesKind = 'wrap' | 'aviator' | 'slim';
export const GLASSES_KINDS: readonly GlassesKind[] = ['wrap', 'aviator', 'slim'];

/** Where things sit on the head (head-centre frame). */
const EYE_Y = -0.002;
const LENS_Z = 0.09;
const TEMPLE_X = 0.075;
const EAR = new THREE.Vector3(0.074, -0.008, -0.02);

/**
 * What the lenses reflect, their own (the city gives the cast no environment light, and a mirror with nothing to
 * mirror is a black hole on a face already in shadow): a dark sky, a bright band along the horizon, dark ground.
 * The band's the line of light across a pair of shades that says "sunglasses" from any angle.
 */
let lensEnv: THREE.Texture | null = null;
export function lensEnvironment(): THREE.Texture {
  if (lensEnv) return lensEnv;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, '#1a2230');
  grad.addColorStop(0.42, '#5a6a80');
  grad.addColorStop(0.49, '#e8eef6');
  grad.addColorStop(0.53, '#8a8f98');
  grad.addColorStop(0.6, '#1c1b1c');
  grad.addColorStop(1, '#0a0a0a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 64);
  lensEnv = new THREE.CanvasTexture(c);
  lensEnv.mapping = THREE.EquirectangularReflectionMapping;
  lensEnv.colorSpace = THREE.SRGBColorSpace;
  return lensEnv;
}

/** Mirrored smoke: dark, glossy, reflecting its own horizon. */
const lensMat = (_env: THREE.Texture | null): THREE.MeshPhysicalMaterial =>
  new THREE.MeshPhysicalMaterial({ color: 0x1a1c20, roughness: 0.06, metalness: 0.85, clearcoat: 1, clearcoatRoughness: 0.03, envMap: lensEnvironment(), envMapIntensity: 1.4, side: THREE.DoubleSide });
const acetate = (env: THREE.Texture | null, color = 0x0b0b0c): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.0, envMap: env, envMapIntensity: 0.6 });
const wire = (env: THREE.Texture | null, color = 0xc9a24a): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 1.0, envMap: env, envMapIntensity: 1.0 });

/** A lens's face from an outline in the plane (x across, y up), bent round the head so its outer side sweeps back. */
function bentShape(outline: THREE.Vector2[], bend: (x: number) => number, z: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(new THREE.Shape(outline), 24);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setZ(i, z - bend(p.getX(i)));
  g.computeVertexNormals();
  return g;
}

/** A tube along points (a rim, a bridge, an arm). */
function tube(points: THREE.Vector3[], r: number, closed = false, seg = 64): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed, 'centripetal'), seg, r, 8, closed);
}

/** An arm from the hinge back over the ear, dropping behind it. */
function arm(side: number, hingeX: number, hingeY: number, hingeZ: number, r: number, mat: THREE.Material): THREE.Mesh {
  const pts = [
    new THREE.Vector3(side * hingeX, hingeY, hingeZ),
    new THREE.Vector3(side * (EAR.x + 0.002), EAR.y + 0.012, (hingeZ + EAR.z) / 2),
    new THREE.Vector3(side * (EAR.x + 0.003), EAR.y + 0.01, EAR.z),
    new THREE.Vector3(side * (EAR.x - 0.002), EAR.y - 0.012, EAR.z - 0.022),
  ];
  return new THREE.Mesh(tube(pts, r, false, 24), mat);
}

function buildWrap(env: THREE.Texture | null): THREE.Group {
  const g = new THREE.Group();
  // One shield: a strip round a vertical axis behind the face, the top flat, the bottom sweeping up at the outsides
  // and notched over the nose.
  const R = 0.105;
  const cz = LENS_Z - R;
  const A = 0.86;
  const n = 48;
  const top = EYE_Y + 0.022;
  const bottomAt = (a: number): number => {
    const t = Math.abs(a) / A;
    const sweep = EYE_Y - 0.02 + 0.016 * t * t * t;
    const notch = Math.exp(-((a / 0.09) ** 2)) * 0.017;
    return sweep + notch;
  };
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = -A + (2 * A * i) / n;
    const x = Math.sin(a) * R;
    const z = cz + Math.cos(a) * R;
    pos.push(x, top, z, x, bottomAt(a), z);
    if (i < n) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  }
  const lens = new THREE.BufferGeometry();
  lens.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  lens.setIndex(idx);
  lens.computeVertexNormals();
  g.add(new THREE.Mesh(lens, lensMat(env)));
  // The top bar along the lens's upper edge, a little deeper.
  const bar: THREE.Vector3[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = -A * 1.02 + (2 * A * 1.02 * i) / 16;
    bar.push(new THREE.Vector3(Math.sin(a) * (R + 0.002), top + 0.001, cz + Math.cos(a) * (R + 0.002)));
  }
  const frame = acetate(env);
  g.add(new THREE.Mesh(tube(bar, 0.0036), frame));
  // Arms from the ends of the bar.
  const ex = Math.sin(A) * R;
  const ez = cz + Math.cos(A) * R;
  for (const s of [-1, 1]) g.add(arm(s, ex + 0.002, top - 0.004, ez, 0.003, frame));
  return g;
}

/** A teardrop lens outline (one side, centred on its own middle): flat-ish top, deep rounded bottom toward the nose. */
function teardrop(w: number, h: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    let x = Math.cos(t) * w;
    let y = Math.sin(t) * h;
    // Flatter on top, the bottom drooping toward the nose (inner, -x) as an aviator's does.
    if (y > 0) y *= 0.62;
    else x += -0.25 * w * Math.sin(-t) * (x < 0 ? 0.6 : 0.2);
    out.push(new THREE.Vector2(x, y));
  }
  return out;
}

function buildAviator(env: THREE.Texture | null): THREE.Group {
  const g = new THREE.Group();
  const metal = wire(env);
  const w = 0.029;
  const h = 0.026;
  const cx = 0.034;
  const lm = lensMat(env);
  for (const s of [-1, 1]) {
    const outline = teardrop(w, h).map((p) => new THREE.Vector2(p.x * s + s * cx, p.y + EYE_Y - 0.004));
    if (s < 0) outline.reverse();
    const bend = (x: number): number => 0.18 * Math.max(0, Math.abs(x) - 0.02) ** 1.6 * 10;
    g.add(new THREE.Mesh(bentShape(outline, bend, LENS_Z), lm));
    const rim = outline.map((p) => new THREE.Vector3(p.x, p.y, LENS_Z - bend(p.x) + 0.0006));
    g.add(new THREE.Mesh(tube(rim, 0.0012, true, 80), metal));
    // Arm from the outer top of the rim.
    g.add(arm(s, cx + w * 0.95, EYE_Y + 0.008, LENS_Z - bend(cx + w) - 0.003, 0.0011, metal));
  }
  // The double bridge: a straight bar over the brow and a curved one over the nose.
  g.add(new THREE.Mesh(tube([new THREE.Vector3(-0.022, EYE_Y + 0.014, LENS_Z + 0.001), new THREE.Vector3(0, EYE_Y + 0.0145, LENS_Z + 0.002), new THREE.Vector3(0.022, EYE_Y + 0.014, LENS_Z + 0.001)], 0.0011, false, 12), metal));
  g.add(new THREE.Mesh(tube([new THREE.Vector3(-0.009, EYE_Y + 0.004, LENS_Z), new THREE.Vector3(0, EYE_Y + 0.008, LENS_Z + 0.002), new THREE.Vector3(0.009, EYE_Y + 0.004, LENS_Z)], 0.0011, false, 12), metal));
  return g;
}

/** A rounded rectangle's outline (centred). */
function roundRect(w: number, h: number, r: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  const corners: [number, number, number][] = [[w - r, h - r, 0], [-w + r, h - r, Math.PI / 2], [-w + r, -h + r, Math.PI], [w - r, -h + r, (3 * Math.PI) / 2]];
  for (const [x, y, a0] of corners) for (let i = 0; i <= 6; i++) {
    const a = a0 + (i / 6) * (Math.PI / 2);
    out.push(new THREE.Vector2(x + Math.cos(a) * r, y + Math.sin(a) * r));
  }
  return out;
}

function buildSlim(env: THREE.Texture | null): THREE.Group {
  const g = new THREE.Group();
  const frame = acetate(env);
  const lm = lensMat(env);
  const w = 0.024;
  const h = 0.0115;
  const cx = 0.033;
  const bend = (x: number): number => 0.9 * Math.max(0, Math.abs(x) - 0.015) ** 2;
  for (const s of [-1, 1]) {
    const outline = roundRect(w, h, 0.004).map((p) => new THREE.Vector2(p.x + s * cx, p.y + EYE_Y));
    g.add(new THREE.Mesh(bentShape(outline, bend, LENS_Z), lm));
    const rim = outline.map((p) => new THREE.Vector3(p.x, p.y, LENS_Z - bend(p.x) + 0.0008));
    const r = new THREE.Mesh(tube(rim, 0.0028, true, 64), frame);
    r.scale.z = 0.8;
    g.add(r);
    g.add(arm(s, TEMPLE_X - 0.006, EYE_Y + 0.006, LENS_Z - bend(TEMPLE_X) - 0.004, 0.003, frame));
  }
  g.add(new THREE.Mesh(tube([new THREE.Vector3(-0.01, EYE_Y + 0.004, LENS_Z + 0.001), new THREE.Vector3(0, EYE_Y + 0.007, LENS_Z + 0.002), new THREE.Vector3(0.01, EYE_Y + 0.004, LENS_Z + 0.001)], 0.0026, false, 12), frame));
  return g;
}

/** A pair of sunglasses round the head's centre, facing +z. */
export function buildGlasses(kind: GlassesKind, env: THREE.Texture | null = null): THREE.Group {
  const g = kind === 'wrap' ? buildWrap(env) : kind === 'aviator' ? buildAviator(env) : buildSlim(env);
  g.name = `glasses:${kind}`;
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}
