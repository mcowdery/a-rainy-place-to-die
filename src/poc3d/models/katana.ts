import * as THREE from 'three';
import type { HandHold } from './shotgun';

/**
 * Mack's katana: a plain fighting sword, black and red. A curved shinogi-zukuri blade (the edge, the ridge line
 * along each side, the back's peak; a kissaki whose edge sweeps up to the point) with a wavy temper line
 * (hamon) frosted along the edge, a brass habaki, an iron tsuba with openings either side of the blade, copper
 * seppa, and a tsuka of white rayskin under black silk wrap crossed into diamonds, gold menuki under the wrap,
 * fuchi and kashira in black iron. The saya is black lacquer with a horn mouth and end, the kurikata knob and a
 * red sageo cord. Built like the guns (models/shotgun.ts): -z along the blade, +y up, the edge down (-y), the
 * origin at the tsuba's front face; the blade curves up toward its back, so the point rides above the handle's
 * line. `sword` is the drawn sword, `saya` the scabbard (in the same frame, the sword sitting in it).
 */

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** The blade (nagasa, habaki to point), its curve's radius, the kissaki's length. */
export const BLADE = 0.71;
const RADIUS = 4.4;
const KISSAKI = 0.04;
/** Width edge to back at the base and toward the point; thickness at the base and the point. */
const WIDTH: [number, number] = [0.032, 0.022];
const THICK: [number, number] = [0.0075, 0.005];
/** The handle (tsuka) from the tsuba back. */
export const HANDLE = 0.27;

/** A point on the blade's back line (the mune) at distance s from the habaki, and the tangent there. The arc
 * leaves the habaki straight along -z and rises toward the point. */
function spine(s: number): { p: THREE.Vector3; t: THREE.Vector3; n: THREE.Vector3 } {
  const a = s / RADIUS;
  const p = v(0, RADIUS * (1 - Math.cos(a)), -RADIUS * Math.sin(a));
  const t = v(0, Math.sin(a), -Math.cos(a));
  // Toward the edge, square to the tangent (down at the habaki).
  const n = v(0, -Math.cos(a), -Math.sin(a));
  return { p, t, n };
}

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

/** The blade's flats: polished dark steel (ji) above a frosted pale hamon along the edge, its line a soft
 * irregular wave (notare with gunome), and the boshi following the kissaki's curve back. u along, v from the edge
 * (0) to the ridge (1). */
function hamonTexture(): THREE.CanvasTexture {
  return canvas(1024, 64, (g) => {
    const W = 1024;
    const H = 64;
    g.fillStyle = '#7d8590';
    g.fillRect(0, 0, W, H);
    const line = (x: number): number => {
      const u = x / W;
      const wave = 0.42 + 0.1 * Math.sin(u * 61) + 0.06 * Math.sin(u * 23 + 1.3) + 0.05 * Math.abs(Math.sin(u * 140));
      // The temper line narrows into the point (boshi).
      return u > 0.94 ? wave * (1 - (u - 0.94) / 0.08) + 0.12 : wave;
    };
    // The frosted hamon, its line soft (nioi): a few passes at falling strength.
    for (let pass = 0; pass < 4; pass++) {
      g.fillStyle = `rgba(232, 236, 240, ${0.3 + pass * 0.18})`;
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += 4) g.lineTo(x, H - (line(x) - (3 - pass) * 0.025) * H);
      g.lineTo(W, H);
      g.closePath();
      g.fill();
    }
    // Faint grain in the steel (hada) along the blade.
    g.strokeStyle = 'rgba(40, 46, 54, 0.12)';
    g.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      const y = ((i * 37) % 64) + 0.5;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= W; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 1.5);
      g.stroke();
    }
    // The cutting edge itself, bright.
    g.fillStyle = '#f2f4f6';
    g.fillRect(0, H - 3, W, 3);
  });
}

/** The tsuka: white rayskin (same) speckled, under black silk wrap (ito) crossing over the top and bottom, the
 * diamonds of rayskin showing on the sides. u along, v round from the right side (0.25 the top). */
function wrapTexture(): THREE.CanvasTexture {
  const tex = canvas(512, 256, (g) => {
    const W = 512;
    const H = 256;
    g.fillStyle = '#e8e2d2';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1400; i++) {
      const x = (i * 97) % W;
      const y = (i * 61 + ((i * i) % 13)) % H;
      g.fillStyle = 'rgba(160, 150, 128, 0.5)';
      g.beginPath();
      g.arc(x, y, 1.6 + (i % 3) * 0.6, 0, Math.PI * 2);
      g.fill();
    }
    // Ten crossings along the handle: bands of silk running diagonally both ways, so they cross over the top
    // and bottom (v 0.25 and 0.75) and leave diamonds on the sides (v 0 and 0.5).
    const n = 10;
    const p = W / n;
    g.lineCap = 'butt';
    for (const dir of [1, -1]) {
      for (let i = -2; i <= n + 2; i++) {
        for (const off of [0, H / 2]) {
          const x0 = i * p;
          const y0 = H / 4 + off;
          g.strokeStyle = '#0c0c0e';
          g.lineWidth = p * 0.62;
          g.beginPath();
          g.moveTo(x0 - dir * p, y0 - H / 4 - 2);
          g.lineTo(x0 + dir * p, y0 + H / 4 + 2);
          g.stroke();
          // The silk's sheen, a lighter twist down the band.
          g.strokeStyle = 'rgba(70, 70, 80, 0.5)';
          g.lineWidth = p * 0.12;
          g.stroke();
        }
      }
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Lofts a closed oval tube along points (each with its own half-width and half-height, sections square to the
 * line in its plane with +x across); UVs u along, v round from +x. */
function ovalLoft(pts: readonly THREE.Vector3[], w: readonly number[], h: readonly number[], around = 24, caps = true): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = pts.length;
  const len = [0];
  for (let i = 1; i < n; i++) len.push(len[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const X = v(1, 0, 0);
  for (let i = 0; i < n; i++) {
    const t = pts[Math.min(n - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
    const up = new THREE.Vector3().crossVectors(t, X).normalize();
    for (let k = 0; k <= around; k++) {
      const a = (k / around) * Math.PI * 2;
      const p = pts[i].clone().addScaledVector(X, Math.cos(a) * w[i]).addScaledVector(up, Math.sin(a) * h[i]);
      pos.push(p.x, p.y, p.z);
      uv.push(len[i] / len[n - 1], k / around);
    }
  }
  const R = around + 1;
  for (let i = 0; i < n - 1; i++)
    for (let k = 0; k < around; k++) {
      const a = i * R + k;
      idx.push(a, a + 1, a + R, a + 1, a + R + 1, a + R);
    }
  if (caps)
    for (const [i, flip] of [[0, true], [n - 1, false]] as const) {
      const c = pos.length / 3;
      pos.push(pts[i].x, pts[i].y, pts[i].z);
      uv.push(len[i] / len[n - 1], 0.5);
      for (let k = 0; k < around; k++) {
        const a = i * R + k;
        if (flip) idx.push(c, a + 1, a);
        else idx.push(c, a, a + 1);
      }
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * The blade, faceted: each section the edge, the ridge (shinogi) either side, the back's shoulders and its
 * peak, swept along the curve; in the kissaki the edge sweeps up to meet the back at the point. The flats below
 * the ridges (the hira, where the hamon is) are one geometry group, the rest (shinogi-ji and back) another.
 */
function bladeGeometry(): THREE.BufferGeometry {
  const steps = 90;
  // The section, from the edge round: [across (of half-thickness), from the edge (of the width)].
  const SECTION: [number, number][] = [
    [0, 0],
    [1, 0.74],
    [0.62, 0.95],
    [0, 1],
    [-0.62, 0.95],
    [-1, 0.74],
  ];
  const rings: THREE.Vector3[][] = [];
  const along: number[] = [];
  const edgeV: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    // Denser into the point.
    const f = i / steps;
    const s = BLADE * (1 - (1 - f) ** 1.6);
    const { p, n } = spine(s);
    const taper = s / BLADE;
    const w = WIDTH[0] + (WIDTH[1] - WIDTH[0]) * taper;
    let t = THICK[0] + (THICK[1] - THICK[0]) * taper;
    // In the kissaki the edge rises along a curve (fukura) to the point, the thickness thins to nothing.
    const k = Math.max(0, (s - (BLADE - KISSAKI)) / KISSAKI);
    const rise = 1 - Math.sqrt(Math.max(0, 1 - k * k));
    t *= 1 - k * 0.92;
    const ring: THREE.Vector3[] = [];
    const ev: number[] = [];
    for (const [ax, from] of SECTION) {
      // From the edge, compressed between the risen edge and the back.
      const h = rise + (1 - rise) * from;
      ring.push(p.clone().addScaledVector(n, w * (1 - h)).add(v((ax * t) / 2, 0, 0)));
      ev.push(from);
    }
    rings.push(ring);
    along.push(s / BLADE);
    edgeV.push(ev);
  }
  // Each panel its own vertices (flat facets, crisp lines); the hira panels (edge to ridge) first.
  const pos: number[] = [];
  const uv: number[] = [];
  const hira: number[] = [];
  const rest: number[] = [];
  const m = SECTION.length;
  for (let j = 0; j < m; j++) {
    const j2 = (j + 1) % m;
    const isHira = j === 0 || j === m - 1;
    for (let i = 0; i < steps; i++) {
      const a = rings[i][j];
      const b = rings[i][j2];
      const c = rings[i + 1][j];
      const d = rings[i + 1][j2];
      const base = pos.length / 3;
      for (const q of [a, b, c, d]) pos.push(q.x, q.y, q.z);
      // u along, v from the edge (0) to the ridge (1) on the hira; the rest just along.
      const va = edgeV[i][j] / 0.74;
      const vb = edgeV[i][j2] / 0.74;
      uv.push(along[i], va, along[i], vb, along[i + 1], va, along[i + 1], vb);
      // Wound so the faces look out (the section runs round the +x side first).
      const tri = [base, base + 2, base + 1, base + 1, base + 2, base + 3];
      (isHira ? hira : rest).push(...tri);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex([...hira, ...rest]);
  geo.addGroup(0, hira.length, 0);
  geo.addGroup(hira.length, rest.length, 1);
  geo.computeVertexNormals();
  return geo;
}

/** The tsuba's outline: a rounded square (mokkō-ish) with the blade's slot and two openings (hitsu-ana). */
function tsubaGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const R = 0.039;
  const pts = 64;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    // A squarish circle: a superellipse.
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const x = Math.sign(c) * Math.abs(c) ** 0.8 * R * 0.94;
    const y = Math.sign(sn) * Math.abs(sn) ** 0.8 * R;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  const slot = new THREE.Path();
  slot.moveTo(-0.0045, 0.013);
  slot.lineTo(0.0045, 0.013);
  slot.lineTo(0.0035, -0.017);
  slot.lineTo(-0.0035, -0.017);
  slot.closePath();
  s.holes.push(slot);
  for (const side of [-1, 1]) {
    const h = new THREE.Path();
    h.absarc(side * 0.019, 0.004, 0.0075, side > 0 ? -Math.PI / 2 : Math.PI / 2, side > 0 ? Math.PI / 2 : (3 * Math.PI) / 2, false);
    h.closePath();
    s.holes.push(h);
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 2, curveSegments: 12 });
  // The shape's y is the blade's back-to-edge axis; extruded along z toward the handle.
  return geo.rotateZ(0).translate(0, 0, 0.0008);
}

export interface Katana {
  readonly root: THREE.Group;
  /** The drawn sword (blade, fittings and handle), in the sword's frame. */
  readonly sword: THREE.Group;
  /** The scabbard, the sword's frame: the sword sits in it as it is. */
  readonly saya: THREE.Group;
  /** The right hand just behind the tsuba, the left at the handle's end (the rig's `HandHold`s). */
  readonly grip: HandHold;
  readonly fore: HandHold;
  /** The point, and the blade's root at the habaki, the sword's frame. */
  readonly tip: THREE.Vector3;
  readonly base: THREE.Vector3;
  readonly label: string;
  /** Blood on the blade, 0 clean to 1 (models/gore.ts adds it with each cut; it dries darker as it fades). */
  setBlood(amount: number): void;
}

/** Blood on steel: runs and smears along the blade, thicker toward the edge and the point, as alpha. */
function bloodTexture(): THREE.CanvasTexture {
  return canvas(512, 64, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 512, 64);
    for (let i = 0; i < 70; i++) {
      // Streaks along the blade (u), more of them in the front half, near the edge (v low = canvas bottom).
      const x = 512 * Math.pow(((i * 0.618) % 1), 0.7);
      const y = 64 - 64 * Math.pow(((i * 0.382 + 0.13) % 1), 1.6);
      const len = 20 + ((i * 53) % 90);
      const w = 2 + ((i * 7) % 6);
      const a = 0.35 + ((i * 13) % 60) / 100;
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.beginPath();
      g.ellipse(x, y, len / 2, w / 2, 0.02 * ((i % 5) - 2), 0, Math.PI * 2);
      g.fill();
    }
    // A wash along the edge.
    const grad = g.createLinearGradient(0, 64, 0, 30);
    grad.addColorStop(0, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 30, 512, 34);
  });
}

export function buildKatana(env: THREE.Texture | null = null): Katana {
  const steel = new THREE.MeshStandardMaterial({ map: hamonTexture(), metalness: 1, roughness: 0.3, envMap: env, envMapIntensity: 0.5 });
  const steelDark = new THREE.MeshStandardMaterial({ color: 0x6d747e, metalness: 1, roughness: 0.26, envMap: env, envMapIntensity: 0.5 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x1a1816, metalness: 0.8, roughness: 0.55, envMap: env, envMapIntensity: 0.6 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc89a4a, metalness: 1, roughness: 0.3, envMap: env, envMapIntensity: 0.9 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xa8643a, metalness: 1, roughness: 0.35, envMap: env, envMapIntensity: 0.8 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8b050, metalness: 1, roughness: 0.25, envMap: env, envMapIntensity: 0.9 });
  const wrap = new THREE.MeshStandardMaterial({ map: wrapTexture(), roughness: 0.7, envMap: env, envMapIntensity: 0.3 });
  const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04, envMap: env, envMapIntensity: 0.9 });
  const horn = new THREE.MeshStandardMaterial({ color: 0x0b0a0a, roughness: 0.3, envMap: env, envMapIntensity: 0.6 });
  const cord = new THREE.MeshStandardMaterial({ color: 0x9c0c14, roughness: 0.8, envMap: env, envMapIntensity: 0.2 });
  const peg = new THREE.MeshStandardMaterial({ color: 0x9a7a48, roughness: 0.7 });

  const root = new THREE.Group();
  root.name = 'katana';
  const sword = new THREE.Group();
  const saya = new THREE.Group();
  root.add(saya, sword);
  const add = (p: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[]): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    p.add(mesh);
    return mesh;
  };

  // The blade starts in the habaki, 3 cm ahead of the tsuba.
  const HAB = 0.032;
  const bladeGeo = bladeGeometry();
  const blade = add(sword, bladeGeo, [steel, steelDark]);
  blade.position.z = -HAB;
  // Blood over it: the same faces just proud of the steel, wet and dark, as much as `setBlood` says.
  const bloodMat = new THREE.MeshPhysicalMaterial({ color: 0x4a0205, roughness: 0.12, clearcoat: 1, transparent: true, opacity: 0, alphaMap: bloodTexture(), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, envMap: env, envMapIntensity: 0.8 });
  const bloodMesh = new THREE.Mesh(bladeGeo, bloodMat);
  bloodMesh.position.z = -HAB;
  bloodMesh.visible = false;
  sword.add(bloodMesh);
  // The blade's mid-line height at the habaki: the edge is at y -WIDTH[0], the back at 0.
  const mid = -WIDTH[0] / 2;
  // Habaki: a brass collar round the blade's root, a little proud of it, sloping into the blade.
  add(sword, ovalLoft([v(0, mid, -0.002), v(0, mid, -HAB + 0.004), v(0, mid, -HAB)], [0.0068, 0.0058, 0.0048], [0.0185, 0.018, 0.0172], 20), brass);
  // Seppa either side of the tsuba, the tsuba itself.
  for (const z of [-0.0012, 0.0062]) add(sword, ovalLoft([v(0, mid, z - 0.0006), v(0, mid, z + 0.0006)], [0.0095, 0.0095], [0.021, 0.021], 24), copper);
  const ts = add(sword, tsubaGeometry(), iron);
  ts.position.set(0, mid, 0);
  // Behind the tsuba: the fuchi collar, the tsuka, the kashira on its end.
  const T0 = 0.0072;
  const T1 = T0 + 0.016;
  add(sword, ovalLoft([v(0, mid, T0), v(0, mid, T1)], [0.0128, 0.0128], [0.0172, 0.0168], 28), iron);
  // The tsuka: oval, a little waisted in the middle, wider again at the kashira; it follows the blade's curve
  // a touch (its end slightly lower).
  const tsuka: THREE.Vector3[] = [];
  const tw: number[] = [];
  const th: number[] = [];
  const TEND = HANDLE - 0.02;
  for (let i = 0; i <= 12; i++) {
    const f = i / 12;
    tsuka.push(v(0, mid - 0.004 * f * f, T1 + (TEND - T1) * f));
    const waist = 1 - 0.07 * Math.sin(f * Math.PI);
    tw.push(0.0122 * waist);
    th.push(0.0162 * waist * (1 + 0.04 * f));
  }
  const tsukaMesh = add(sword, ovalLoft(tsuka, tw, th, 32, false), wrap);
  (tsukaMesh.material as THREE.MeshStandardMaterial).map!.repeat.set(1, 1);
  // Menuki: gold ornaments under the wrap, one each side, a little apart.
  for (const [side, z] of [[1, T1 + 0.07], [-1, T1 + 0.1]] as const) {
    const m = add(sword, new THREE.SphereGeometry(1, 16, 8).scale(0.0035, 0.008, 0.017), gold);
    m.position.set(side * 0.0118, mid - 0.0005, z);
  }
  // The mekugi peg through the handle near the front.
  add(sword, new THREE.CylinderGeometry(0.0022, 0.0022, 0.0255, 10).rotateZ(Math.PI / 2).translate(0, mid - 0.002, T1 + 0.025), peg);
  // The kashira: a black iron cap, rounded at the end.
  const kEnd = tsuka[tsuka.length - 1];
  add(sword, ovalLoft([kEnd.clone().add(v(0, 0, -0.002)), kEnd.clone().add(v(0, 0, 0.012)), kEnd.clone().add(v(0, -0.0005, 0.018)), kEnd.clone().add(v(0, -0.0008, 0.0205))], [0.0128, 0.0126, 0.0105, 0.004], [0.017, 0.0168, 0.014, 0.006], 28), iron);

  // The saya: black lacquer along the blade's curve, a horn mouth (koiguchi) at the habaki, a horn end (kojiri),
  // the kurikata knob a hand's width down with the red sageo tied through it and hanging in a loop.
  const sp: THREE.Vector3[] = [];
  const sw: number[] = [];
  const sh: number[] = [];
  const S0 = 0.007;
  const SLEN = BLADE + HAB + 0.015;
  for (let i = 0; i <= 40; i++) {
    const s = S0 + ((SLEN - S0) * i) / 40;
    const along = Math.max(0, s - HAB);
    const { p, n } = spine(along);
    const taper = along / BLADE;
    const w = WIDTH[0] + (WIDTH[1] - WIDTH[0]) * taper;
    sp.push(p.clone().addScaledVector(n, w / 2).add(v(0, 0, -Math.min(s, HAB))));
    sw.push(0.0118 - 0.0022 * taper);
    sh.push(w / 2 + 0.0058);
  }
  add(saya, ovalLoft(sp, sw, sh, 28), lacquer);
  add(saya, ovalLoft(sp.slice(0, 3), sw.slice(0, 3).map((x) => x + 0.0006), sh.slice(0, 3).map((x) => x + 0.0006), 28), horn);
  add(saya, ovalLoft(sp.slice(-3), sw.slice(-3).map((x) => x + 0.0006), sh.slice(-3).map((x) => x + 0.0006), 28), horn);
  const kuri = sp[5];
  const knob = add(saya, new THREE.TorusGeometry(0.0065, 0.0028, 8, 16).rotateY(Math.PI / 2), horn);
  knob.position.set(-sw[5] - 0.002, kuri.y + 0.002, kuri.z);
  // The sageo: through the knob, tied round the saya and hanging in a loop.
  const cordPts = [
    v(-sw[5] - 0.003, kuri.y + 0.004, kuri.z - 0.004),
    v(-sw[5] - 0.006, kuri.y - 0.012, kuri.z - 0.02),
    v(-sw[5] - 0.008, kuri.y - 0.05, kuri.z - 0.07),
    v(-sw[5] - 0.007, kuri.y - 0.075, kuri.z - 0.13),
    v(-sw[5] - 0.005, kuri.y - 0.06, kuri.z - 0.2),
    v(-sw[5] - 0.003, kuri.y - 0.03, kuri.z - 0.24),
    v(-sw[5] - 0.0015, kuri.y - 0.006, kuri.z - 0.26),
  ];
  add(saya, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cordPts, false, 'centripetal'), 60, 0.0026, 8, false), cord);
  for (const dz of [-0.264, -0.27]) {
    const p = sp[0].clone().setZ(kuri.z + dz + 0.012);
    const i = sp.reduce((best, q, j) => (Math.abs(q.z - p.z) < Math.abs(sp[best].z - p.z) ? j : best), 0);
    add(saya, ovalLoft([sp[i].clone().add(v(0, 0, 0.002)), sp[i].clone().add(v(0, 0, -0.002))], [sw[i] + 0.0015, sw[i] + 0.0015], [sh[i] + 0.0015, sh[i] + 0.0015], 20, false), cord);
  }

  // Where the hands go (the rig's HandHold: the palm's middle, its normal, the fingers' way, the rod they close
  // on): both overhand round the tsuka, the edge down, the right a finger's width behind the tsuba, the left at
  // the kashira with its little finger round the end.
  const along = (z: number): THREE.Vector3 => v(0, mid - 0.004 * ((z - T1) / (TEND - T1)) ** 2, z);
  const rod = { r: 0.0165, rx: 0.0124 };
  const grip: HandHold = {
    at: along(T1 + 0.05).add(v(0.012, 0.008, 0)),
    palm: v(-0.75, -0.66, 0).normalize(),
    fwd: v(0, -1, 0),
    curl: 1,
    thumb: 0.5,
    wrap: { a: along(T1 + 0.005), b: along(T1 + 0.1), ...rod },
  };
  const fore: HandHold = {
    at: along(TEND - 0.045).add(v(0.012, 0.008, 0)),
    palm: v(-0.75, -0.66, 0).normalize(),
    fwd: v(0, -1, 0),
    curl: 1,
    thumb: 0.5,
    wrap: { a: along(TEND - 0.1), b: along(TEND), ...rod },
  };
  const tip = spine(BLADE).p.add(v(0, 0, -HAB));
  const setBlood = (amount: number): void => {
    const a = THREE.MathUtils.clamp(amount, 0, 1);
    bloodMesh.visible = a > 0.01;
    bloodMat.opacity = Math.min(1, a * 1.3);
    // Drying: darker and duller as it thins.
    bloodMat.color.setRGB(0.29 * (0.45 + 0.55 * a), 0.008, 0.02);
    bloodMat.roughness = 0.12 + 0.5 * (1 - a);
  };
  return { root, sword, saya, grip, fore, tip, base: v(0, mid, -HAB), label: '刀 katana', setBlood };
}
