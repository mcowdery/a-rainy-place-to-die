import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import { hash } from '../../core/hash';
import type { Building3 } from '../district/plan';
import { FH, GF, styleFor } from './buildings';
import type { Light } from './lightmap';
import { localBox, localFrame, localRect, localYaw, toWorld, type Part } from './localFrame';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';
import { addFigure, GHOST_COLORS, GhostBuilder, type FigureSpec, type Pose } from './people';

/**
 * Yoru Mart (ヨルマート), the konbini you can walk into: a ground-floor store under a few floors of offices.
 * Local frame (localFrame.ts): u along the shopfront (14 m), t inward (12 m). The glass front has
 * automatic sliding doors at u 2-4; inside are drink fridges along the back wall, three gondola aisles,
 * wall shelving, a magazine rack under the window, an ATM and copier, and the counter (hot snacks,
 * registers) with the staff area and back room behind it. The layout's solid parts are also the collision.
 * The stamp must be 14 m along its street face and 12 m deep.
 */
export const KONBINI = { fw: 14, depth: 12, ceiling: 3.0, door: [2.0, 4.0] as const } as const;

const GONDOLAS = [2.4, 4.7, 7.0];
const GONDOLA_T: [number, number] = [4.4, 9.8];

/** Customers browsing (decorative ghosts): local u, t, facing (du, dt), pose. */
const CUSTOMERS: readonly (readonly [number, number, number, number, Pose])[] = [
  [6.2, 1.3, 0, -1, 'phone'],
  [3.55, 6.8, -1, 0.2, 'stand'],
  [5.3, 10.2, 0, 1, 'pockets'],
  [10.9, 2.15, 0, 1, 'stand'],
];

function solids(): Part[] {
  const P = (u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, color: number): Part => ({ u0, u1, t0, t1, y0, y1, color, solid: true });
  const { fw, depth } = KONBINI;
  const [d0, d1] = KONBINI.door;
  return [
    // Shell: side and back walls, the shopfront either side of the doors.
    P(0, 0.25, 0, depth, 0, GF, 0xf0efe8),
    P(fw - 0.25, fw, 0, depth, 0, GF, 0xf0efe8),
    P(0, fw, depth - 0.25, depth, 0, GF, 0xf0efe8),
    P(0.25, d0, 0, 0.18, 0, 0.35, 0x2a2c30),
    P(d1, fw - 0.25, 0, 0.18, 0, 0.35, 0x2a2c30),
    // Drink fridges along the back wall.
    { ...P(0.3, 8.6, 10.8, depth - 0.25, 0, 2.4, 0x303338), hidden: true },
    // Wall shelving on the left.
    P(0.25, 0.75, 3.3, 10.4, 0, 1.9, 0xd8d8d4),
    // Gondolas.
    ...GONDOLAS.map((c) => ({ ...P(c - 0.45, c + 0.45, GONDOLA_T[0], GONDOLA_T[1], 0, 1.5, 0xe2e2de), hidden: true })),
    // Magazine rack under the window, ATM and copier by the door.
    P(4.6, 8.8, 0.25, 0.7, 0, 1.05, 0xd0d0cc),
    P(0.4, 1.3, 1.2, 1.9, 0, 1.55, 0xb8bcc2),
    P(0.4, 1.3, 2.1, 2.8, 0, 1.15, 0xe8e8e4),
    // Counter across the right front, the staff partition and the back room behind it.
    P(8.8, fw - 0.25, 2.8, 3.5, 0, 1.0, 0xeeeeea),
    P(8.8, 8.95, 3.5, 6.0, 0, KONBINI.ceiling, 0xf0efe8),
    P(8.8, fw - 0.25, 6.0, depth - 0.25, 0, KONBINI.ceiling, 0xf0efe8),
    // Recycling bins outside.
    P(10.5, 12.5, -0.9, -0.3, 0, 1.0, 0x2a5a9a),
  ];
}

/** Collision rects in world space (walls, fixtures and the browsing customers). */
export function konbiniColliders(b: Building3): Rect[] {
  const f = localFrame(b);
  return [
    ...solids().map((p) => localRect(f, p.u0, p.u1, p.t0, p.t1)),
    ...CUSTOMERS.map(([u, t]) => localRect(f, u - 0.3, u + 0.3, t - 0.3, t + 0.3)),
  ];
}

/** Lightmap lights: the fluorescent interior and its spill onto the pavement. */
export function konbiniLights(b: Building3): Light[] {
  const f = localFrame(b);
  const out: Light[] = [];
  for (const u of [2.5, 7, 11.5]) {
    for (const t of [2.5, 7.5]) {
      const [x, z] = toWorld(f, u, t);
      out.push({ x, z, r: 7, color: [0.92, 0.96, 1.0], i: 0.7 });
    }
  }
  const [x, z] = toWorld(f, 7, -3);
  out.push({ x, z, r: 9, color: [0.85, 0.95, 1.0], i: 0.7 });
  return out;
}

const PRODUCTS = [0xd83a2a, 0xf0c020, 0x2a6ad0, 0x30a050, 0xf08030, 0xe8e0d0, 0x8a3a8a, 0x202020, 0xd060a0, 0x60c0e0, 0xa06030, 0xffffff];
const DRINKS = [0x2a9a4a, 0xe07020, 0x6a3a1a, 0x2a5ad0, 0xe8e8e0, 0xd02a2a, 0xf0d040, 0x80c8e0];
const posterArt = import.meta.glob(['../../../assets/ads/kaburo/32_yorumart_poster.jpg', '../../../assets/ads/kaburo/33_yorumart_poster.jpg'], { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export interface Konbini {
  readonly group: THREE.Group;
  /** Opens the automatic doors when the camera is near them. */
  update(camera: THREE.Vector3, dt: number): void;
}

export function buildKonbini(b: Building3, city: THREE.Material, ghost: THREE.Material): Konbini {
  const f = localFrame(b);
  const group = new THREE.Group();
  const mb = new MeshBuilder();
  mb.id = b.id;
  mb.flags = 0;
  mb.style = [0, 0, 0, 0];
  mb.frontNormal = null;
  const box = (hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, kind: number = KIND.plain): void => {
    mb.kind = kind;
    mb.color = lin(hex);
    localBox(mb, f, u0, u1, t0, t1, y0, y1);
  };
  const glow = (rgb: [number, number, number], u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void => {
    mb.kind = KIND.emit;
    mb.style = [EMIT.always, 0, 0, 0];
    mb.color = rgb;
    localBox(mb, f, u0, u1, t0, t1, y0, y1);
    mb.style = [0, 0, 0, 0];
  };
  const pick = (list: readonly number[], ...k: number[]): number => list[hash(b.id, ...k.map((v) => Math.round(v * 100))) % list.length];
  const rnd = (...k: number[]): number => hash(b.id, 77, ...k.map((v) => Math.round(v * 100))) / 4294967296;
  const { fw, depth, ceiling } = KONBINI;
  const [d0, d1] = KONBINI.door;

  // Offices above: the building's own facade style from the first floor up.
  const s = styleFor(b);
  const floors = Math.max(0, Math.floor((b.h - GF - 0.5) / FH));
  mb.kind = KIND.wall;
  mb.color = s.wall;
  mb.flags = s.flags;
  mb.style = [s.bay, s.ratio, s.winH, s.type + 8 * floors];
  mb.box(b.x, b.z, GF, b.h, b.w, b.d);
  mb.flags = 0;
  mb.style = [0, 0, 0, 0];
  mb.kind = KIND.plain;
  mb.color = s.trim;
  mb.box(b.x, b.z, b.h, b.h + 0.6, b.w, b.d);

  // Solid parts (walls and fixture bodies), then the details on them.
  for (const p of solids()) if (!p.hidden) box(p.color, p.u0, p.u1, p.t0, p.t1, p.y0, p.y1);
  box(0xdcdcd6, 0.25, fw - 0.25, 0.18, depth - 0.25, 0, 0.03, KIND.sidewalk);
  box(0xdcdcd6, d0, d1, 0, 0.18, 0, 0.03, KIND.sidewalk);
  // Shopfront frame: mullions, the transom band over the glass, and a ceiling with light strips.
  for (const u of [d0 - 0.07, d1, 7.2, 10.4]) box(0x3a3c40, u, u + 0.07, 0, 0.18, 0.35, 2.8);
  box(0x2a2c30, 0, fw, 0, 0.3, 2.8, GF);
  box(0xf4f4f0, 0.25, fw - 0.25, 0.3, depth - 0.25, ceiling, ceiling + 0.06);
  for (const u of [1.5, 3.55, 5.85, 8.1, 11.3]) glow([1.5, 1.55, 1.6], u - 0.11, u + 0.11, 0.8, depth - 0.8, ceiling - 0.03, ceiling);

  // Fridges: the cabinet, backlit, shelves of bottles, door frames and a green header.
  box(0x303338, 0.3, 8.6, 11.25, depth - 0.25, 0, 2.4);
  box(0x303338, 0.3, 8.6, 10.8, 11.25, 2.2, 2.4);
  box(0x303338, 0.3, 0.36, 10.8, 11.25, 0, 2.2);
  box(0x303338, 8.54, 8.6, 10.8, 11.25, 0, 2.2);
  glow([0.5, 0.56, 0.6], 0.35, 8.55, 11.2, 11.25, 0.15, 2.15);
  glow([0.1, 0.8, 0.45], 0.3, 8.6, 10.78, 10.8, 2.2, 2.38);
  for (const y of [0.3, 0.72, 1.14, 1.56, 1.98]) {
    box(0xc8c8c8, 0.35, 8.55, 10.85, 11.2, y - 0.02, y);
    for (let u = 0.42; u < 8.45; u += 0.11) box(pick(DRINKS, u, y), u, u + 0.08, 10.95, 11.1, y, y + 0.2 + rnd(u, y) * 0.04);
  }
  for (let u = 0.3; u <= 8.61; u += 1.038) box(0x2a2c30, u, u + 0.05, 10.8, 10.86, 0, 2.2);

  // Shelving and the three gondolas, stocked on every face, with yellow price rails.
  const stock = (u0: number, u1: number, t0: number, t1: number, levels: readonly number[], lip: 'u0' | 'u1' | null): void => {
    for (const y of levels) {
      box(0xe8e8e4, u0, u1, t0, t1, y - 0.03, y);
      if (lip === 'u1') box(0xf0d040, u1 - 0.01, u1 + 0.01, t0, t1, y - 0.08, y);
      if (lip === 'u0') box(0xf0d040, u0 - 0.01, u0 + 0.01, t0, t1, y - 0.08, y);
      for (let t = t0 + 0.05; t < t1 - 0.2; ) {
        const w = 0.1 + rnd(u0, t, y) * 0.1;
        box(pick(PRODUCTS, u0, t, y), u0 + 0.02, u1 - 0.02, t, t + w, y, y + 0.12 + rnd(t, y, u0) * 0.14);
        t += w + 0.02;
      }
    }
  };
  stock(0.75, 1.05, 3.4, 10.3, [0.15, 0.55, 0.95, 1.35], 'u1');
  for (const c of GONDOLAS) {
    box(0xe2e2de, c - 0.1, c + 0.1, GONDOLA_T[0], GONDOLA_T[1], 0, 1.5);
    box(0xcfcfca, c - 0.45, c + 0.45, GONDOLA_T[0], GONDOLA_T[1], 0, 0.1);
    for (const t of [GONDOLA_T[0], GONDOLA_T[1] - 0.04]) box(0xe2e2de, c - 0.45, c + 0.45, t, t + 0.04, 0, 1.5);
    stock(c + 0.12, c + 0.45, GONDOLA_T[0] + 0.05, GONDOLA_T[1] - 0.05, [0.12, 0.47, 0.82, 1.17], 'u1');
    stock(c - 0.45, c - 0.12, GONDOLA_T[0] + 0.05, GONDOLA_T[1] - 0.05, [0.12, 0.47, 0.82, 1.17], 'u0');
    glow([1.2, 0.3, 0.2], c - 0.3, c + 0.3, GONDOLA_T[0] - 0.02, GONDOLA_T[0], 1.5, 1.8);
  }
  // Magazines facing into the store; ATM screen; copier lid.
  for (let u = 4.7; u < 8.7; u += 0.27) {
    box(pick(PRODUCTS, u, 1), u, u + 0.23, 0.7, 0.73, 0.62, 0.98);
    box(pick(PRODUCTS, u, 2), u, u + 0.23, 0.7, 0.73, 0.2, 0.56);
  }
  glow([0.25, 0.55, 1.0], 1.3, 1.31, 1.35, 1.75, 1.0, 1.3);
  box(0x303338, 0.4, 1.3, 2.1, 2.8, 1.15, 1.22);

  // Counter: green band, hot snack case, registers; the back counter, coffee machine, fryer, cigarettes.
  box(0x10804a, 8.8, fw - 0.25, 2.78, 2.8, 0.55, 0.8);
  glow([1.1, 0.62, 0.28], 9.0, 9.9, 2.85, 3.45, 1.0, 1.5);
  for (const u of [10.4, 12.2]) {
    box(0x26282c, u, u + 0.5, 3.0, 3.4, 1.0, 1.35);
    glow([0.3, 0.8, 0.6], u + 0.05, u + 0.45, 2.99, 3.0, 1.12, 1.3);
  }
  box(0xdcd8d0, 8.95, fw - 0.25, 5.3, 6.0, 0, 0.95);
  box(0x26282c, 9.2, 9.8, 5.4, 5.9, 0.95, 1.65);
  glow([0.9, 0.5, 0.2], 9.3, 9.7, 5.39, 5.4, 1.3, 1.5);
  box(0xa0a4a8, 12.0, 13.0, 5.4, 5.95, 0.95, 1.3);
  for (let y = 1.3; y < 2.5; y += 0.14) for (let u = 9.1; u < 13.5; u += 0.12) box(pick(PRODUCTS, u, y, 3), u, u + 0.09, 5.9, 5.99, y, y + 0.11);
  // Staff-only door into the back room.
  box(0x8a8e94, 8.77, 8.8, 9.0, 10.0, 0, 2.1);

  const mesh = new THREE.Mesh(mb.build()!, city);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);

  // Glass: the shopfront panes and the two sliding door leaves.
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xa8c4cc, transparent: true, opacity: 0.14, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
  const gb = new MeshBuilder();
  const pane = (m: MeshBuilder, u0: number, u1: number, y0: number, y1: number, t: number): void => {
    const [ax, az] = toWorld(f, u0, t);
    const [bx, bz] = toWorld(f, u1, t);
    m.quad([ax, y0, az], [bx - ax, 0, bz - az], [0, y1 - y0, 0]);
  };
  pane(gb, 0.25, d0, 0.35, 2.8, 0.1);
  pane(gb, d1, fw - 0.25, 0.35, 2.8, 0.1);
  const glass = new THREE.Mesh(gb.build()!, glassMat);
  glass.renderOrder = 3;
  group.add(glass);
  const leaves: { obj: THREE.Group; dir: number }[] = [];
  for (const [u0, u1, dir] of [[d0, (d0 + d1) / 2, -1], [(d0 + d1) / 2, d1, 1]] as const) {
    const leaf = new THREE.Group();
    const lg = new MeshBuilder();
    pane(lg, u0 + 0.04, u1 - 0.04, 0.05, 2.7, 0.04);
    const g = new THREE.Mesh(lg.build()!, glassMat);
    g.renderOrder = 3;
    const fr = new MeshBuilder();
    fr.kind = KIND.plain;
    fr.color = lin(0xb0b4b8);
    for (const [a, c] of [[u0, u0 + 0.04], [u1 - 0.04, u1]]) localBox(fr, f, a, c, 0.0, 0.08, 0, 2.75);
    localBox(fr, f, u0, u1, 0.0, 0.08, 2.7, 2.78);
    localBox(fr, f, u0, u1, 0.0, 0.08, 0, 0.05);
    leaf.add(g, new THREE.Mesh(fr.build()!, city));
    group.add(leaf);
    leaves.push({ obj: leaf, dir });
  }

  // The sign: a lit fascia over the shopfront.
  const canvas = document.createElement('canvas');
  canvas.width = 1780;
  canvas.height = 140;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#f6f8f4';
  g.fillRect(0, 0, 1780, 140);
  g.fillStyle = '#40e090';
  g.fillRect(0, 0, 1780, 18);
  g.fillStyle = '#10804a';
  g.fillRect(0, 112, 1780, 28);
  g.fillStyle = '#10804a';
  g.font = "bold 78px 'Yu Gothic', 'Meiryo', sans-serif";
  g.textBaseline = 'middle';
  g.fillText('ヨルマート', 70, 66);
  g.font = "bold 66px 'Arial', sans-serif";
  g.fillText('YORU MART', 560, 68);
  g.fillRect(1560, 26, 170, 80);
  g.fillStyle = '#ffffff';
  g.font = "bold 60px 'Arial', sans-serif";
  g.fillText('24H', 1590, 68);
  const signTex = new THREE.CanvasTexture(canvas);
  signTex.colorSpace = THREE.SRGBColorSpace;
  signTex.anisotropy = 4;
  const facing = Math.atan2(f.n[0], f.n[2]);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(fw, 1.1), new THREE.MeshBasicMaterial({ map: signTex, color: new THREE.Color(1.25, 1.25, 1.25) }));
  const [sx, sz] = toWorld(f, fw / 2, -0.32);
  sign.position.set(sx, 3.5, sz);
  sign.rotation.y = facing;
  group.add(sign);
  const backing = new MeshBuilder();
  backing.kind = KIND.plain;
  backing.color = lin(0x2a2c30);
  localBox(backing, f, 0, fw, -0.3, 0, 2.9, 4.1);
  group.add(new THREE.Mesh(backing.build()!, city));

  // Window posters (the approved Yoru Mart art), just inside the glass.
  const loader = new THREE.TextureLoader();
  Object.values(posterArt).forEach((url, i) => {
    const tex = loader.load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.15), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.9, 0.9, 0.9) }));
    const [px, pz] = toWorld(f, 11.0 + i * 1.3, 0.14);
    poster.position.set(px, 1.75, pz);
    poster.rotation.y = facing;
    group.add(poster);
  });

  // Customers browsing.
  const people = new GhostBuilder();
  CUSTOMERS.forEach(([u, t, du, dt, pose], i) => {
    const [x, z] = toWorld(f, u, t);
    const spec: FigureSpec = {
      x,
      z,
      yaw: localYaw(f, du, dt),
      body: i % 2 === 0 ? 'man' : 'woman',
      pose,
      color: GHOST_COLORS[(hash(b.id, i) >>> 3) % GHOST_COLORS.length],
      hair: i % 2 === 0 ? 'short' : 'long',
      long: i === 1,
      phase: 0,
      side: 1,
      look: 0,
    };
    addFigure(people, spec);
  });
  const crowd = people.build(0, 0);
  if (crowd) {
    const m = new THREE.Mesh(crowd, ghost);
    m.renderOrder = 2;
    group.add(m);
  }

  let open = 0;
  const [dx, dz] = toWorld(f, (d0 + d1) / 2, 0);
  return {
    group,
    update(camera, dt) {
      const near = Math.hypot(camera.x - dx, camera.z - dz) < 2.8;
      open = THREE.MathUtils.clamp(open + (near ? dt : -dt) * 2.2, 0, 1);
      const e = open * open * (3 - 2 * open);
      for (const { obj, dir } of leaves) obj.position.set(f.r[0] * dir * e * 0.95, 0, f.r[2] * dir * e * 0.95);
    },
  };
}
