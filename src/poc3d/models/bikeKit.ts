import * as THREE from 'three';

/**
 * What the hero bikes share (models/bosozoku.ts, models/cruiser.ts): the `Bike` they return, painted canvas
 * textures (plates, gauge faces) and geometry helpers (rods, pipes along curves, lofted shells). The bikes'
 * frame: -z forward, +y up, x to the rider's right, the origin on the ground under the wheelbase's middle.
 */

export interface Bike {
  readonly root: THREE.Group;
  /** Turns about the steering axis: set `steer.quaternion` with `steerAxis`. */
  readonly steer: THREE.Group;
  readonly steerAxis: THREE.Vector3;
  readonly frontWheel: THREE.Group;
  readonly rearWheel: THREE.Group;
  readonly wheelRadius: { readonly front: number; readonly rear: number };
  /** Where a rider goes (bike frame): the seat's top, the bar grips (in the steer group's frame at rest), the
   * footpegs. */
  readonly rider: {
    readonly seat: THREE.Vector3;
    readonly gripL: THREE.Vector3;
    readonly gripR: THREE.Vector3;
    /** Each grip's axis (unit, from its inner end out to the bar end): out to the side on straight bars, mostly
     * back toward the rider on pullbacks. */
    readonly gripAxisL: THREE.Vector3;
    readonly gripAxisR: THREE.Vector3;
    readonly pegL: THREE.Vector3;
    readonly pegR: THREE.Vector3;
    /** Where the eyes must be (the frame's own: a car's driver's eye), the body moved to put them there. */
    readonly eye?: THREE.Vector3;
    /** Which way each palm faces on its grip (a steering wheel's rim: toward its middle); else down. */
    readonly palmL?: THREE.Vector3;
    readonly palmR?: THREE.Vector3;
  };
  /** The lamps' materials, to switch on at night. */
  readonly lamps: { readonly head: THREE.MeshStandardMaterial; readonly tail: THREE.MeshStandardMaterial };
}

export type V = THREE.Vector3;
export const v = (x: number, y: number, z: number): V => new THREE.Vector3(x, y, z);

// --- painted textures ---

export function canvas(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** A Japanese plate, invented: white, a green border and lettering (area and class on top, the kana and
 * number below). */
export function plateTexture(top = '東都 400', kana = 'な', num = '12-34'): THREE.CanvasTexture {
  return canvas(256, 128, (g) => {
    g.fillStyle = '#f4f4ee';
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#1f6b3a';
    g.lineWidth = 6;
    g.strokeRect(5, 5, 246, 118);
    g.fillStyle = '#1f6b3a';
    g.textAlign = 'center';
    g.font = 'bold 30px "Yu Gothic", "Meiryo", sans-serif';
    g.fillText(top, 128, 42);
    g.font = 'bold 26px "Yu Gothic", "Meiryo", sans-serif';
    g.fillText(kana, 40, 100);
    g.font = 'bold 52px "Arial", sans-serif';
    g.fillText(num, 150, 106);
  });
}

/** A gauge face: black, white marks round 270 degrees, numbers, a red needle at rest. */
export function gaugeTexture(max: number, step: number, label: string): THREE.CanvasTexture {
  return canvas(256, 256, (g) => {
    g.fillStyle = '#0c0c0e';
    g.fillRect(0, 0, 256, 256);
    g.translate(128, 128);
    const a0 = Math.PI * 0.75;
    const span = Math.PI * 1.5;
    g.strokeStyle = '#e8e8e2';
    g.fillStyle = '#e8e8e2';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 22px Arial';
    for (let n = 0; n <= max; n += step) {
      const a = a0 + (n / max) * span;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(Math.cos(a) * 108, Math.sin(a) * 108);
      g.lineTo(Math.cos(a) * 92, Math.sin(a) * 92);
      g.stroke();
      g.fillText(String(n), Math.cos(a) * 72, Math.sin(a) * 72);
    }
    g.font = '14px Arial';
    g.fillText(label, 0, 46);
    g.strokeStyle = '#e03020';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a0) * 96, Math.sin(a0) * 96);
    g.stroke();
  });
}

// --- geometry helpers ---

/** A cylinder from a to b. */
export function rod(a: V, b: V, r: number, seg = 16, r2 = r): THREE.BufferGeometry {
  const d = b.clone().sub(a);
  const geo = new THREE.CylinderGeometry(r2, r, d.length(), seg, 1);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), d.clone().normalize()));
  return geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** A tube along smooth curve through points. */
export function pipe(pts: readonly V[], r: number, seg = 64, radial = 12): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts as V[], false, 'centripetal'), seg, r, radial, false);
}

/** A shell lofted along a line of centres, each a superellipse section (half-width w across x, half-height h
 * in the section's up) square to the line; UVs u along (0..1), v round (0 at the right side's middle). */
export function shell(centres: readonly V[], w: readonly number[], h: readonly number[], power = 2.4, around = 40, caps = true): THREE.BufferGeometry {
  const n = centres.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const len: number[] = [0];
  for (let i = 1; i < n; i++) len.push(len[i - 1] + centres[i].distanceTo(centres[i - 1]));
  const total = len[n - 1] || 1;
  const X = v(1, 0, 0);
  for (let i = 0; i < n; i++) {
    const t = centres[Math.min(n - 1, i + 1)].clone().sub(centres[Math.max(0, i - 1)]).normalize();
    const up = new THREE.Vector3().crossVectors(X, t).normalize();
    for (let k = 0; k <= around; k++) {
      const a = (k / around) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const sx = Math.sign(c) * Math.abs(c) ** (2 / power);
      const sy = Math.sign(s) * Math.abs(s) ** (2 / power);
      const p = centres[i].clone().addScaledVector(X, w[i] * sx).addScaledVector(up, h[i] * sy);
      pos.push(p.x, p.y, p.z);
      uv.push(len[i] / total, k / around);
    }
  }
  const R = around + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < around; k++) {
      const a = i * R + k;
      idx.push(a, a + R, a + 1, a + 1, a + R, a + R + 1);
    }
  }
  if (caps) {
    for (const [i, flip] of [[0, false], [n - 1, true]] as const) {
      const base = pos.length / 3;
      pos.push(centres[i].x, centres[i].y, centres[i].z);
      uv.push(len[i] / total, 0.5);
      for (let k = 0; k < around; k++) {
        const a = i * R + k;
        if (flip) idx.push(base, a, a + 1);
        else idx.push(base, a + 1, a);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function add(g: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[]): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

/** Both sides: builds once at x and once mirrored at -x. */
export function mirror(fn: (s: 1 | -1) => void): void {
  fn(1);
  fn(-1);
}

