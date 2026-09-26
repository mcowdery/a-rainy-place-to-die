import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { WIN } from './buildings';
import { addCar } from './cars';
import type { Light } from './lightmap';
import { localBox, localFrame, localRect, localYaw, toWorld } from './localFrame';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';
import { addFigure, GhostBuilder } from './people';

/**
 * Ryujin Kogyo (竜神興業), the yakuza front company whose dragon crowns the mega-sign. Deliberately plain
 * and deliberately unfriendly: a dark granite block with tinted ribbon windows set back behind a gated
 * forecourt, two black sedans parked nose-out, a reinforced steel door under CCTV cameras with a brass
 * nameplate, a gold dragon crest above it, and two men in suits who watch the street.
 * Local frame (localFrame.ts): u along the 18 m front, t inward over 22 m; the building starts at t 8.
 */
export const RYUJIN = { fw: 18, depth: 22, setback: 8 } as const;

const B0 = RYUJIN.setback;
const GATE: readonly [number, number] = [7.5, 10.5];
const CARS: readonly (readonly [number, number])[] = [[3.6, 4.2], [14.4, 4.2]];
const GUARDS: readonly (readonly [number, number, number])[] = [[7.0, 6.6, -0.35], [11.0, 6.6, 0.35]];

/** Collision: the building, the forecourt wall and gate posts, the parked cars, the guards. */
export function ryujinColliders(b: Building3): Rect[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(f, u0, u1, t0, t1);
  return [
    R(0, RYUJIN.fw, B0, RYUJIN.depth),
    R(0, GATE[0], 0, 0.35),
    R(GATE[1], RYUJIN.fw, 0, 0.35),
    R(0, 0.3, 0, B0),
    R(RYUJIN.fw - 0.3, RYUJIN.fw, 0, B0),
    ...CARS.map(([u, t]) => R(u - 1.0, u + 1.0, t - 2.4, t + 2.4)),
    ...GUARDS.map(([u, t]) => R(u - 0.3, u + 0.3, t - 0.3, t + 0.3)),
  ];
}

/** Lightmap lights: the cold lamp over the door, the gate lamps, the crest's glow. */
export function ryujinLights(b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: [number, number, number], i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  return [L(9, 6.5, 5, [0.75, 0.85, 1.0], 0.7), L(GATE[0], -0.6, 3, [1.0, 0.8, 0.55], 0.45), L(GATE[1], -0.6, 3, [1.0, 0.8, 0.55], 0.45)];
}

const GRANITE = 0x2a2a2e;
const GOLD = 0xc8a040;

export function buildRyujin(b: Building3, city: THREE.Material, ghost: THREE.Material): THREE.Group {
  const f = localFrame(b);
  const group = new THREE.Group();
  const mb = new MeshBuilder();
  mb.id = b.id;
  mb.flags = 0;
  mb.style = [0, 0, 0, 0];
  const box = (hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void => {
    mb.kind = KIND.plain;
    mb.color = lin(hex);
    localBox(mb, f, u0, u1, t0, t1, y0, y1);
  };
  const glow = (ch: number, rgb: [number, number, number], u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void => {
    mb.kind = KIND.emit;
    mb.style = [ch, 0, 0, 0];
    mb.color = rgb;
    localBox(mb, f, u0, u1, t0, t1, y0, y1, KIND.emit, true);
    mb.style = [0, 0, 0, 0];
  };
  const { fw, depth } = RYUJIN;

  // The block: dark granite, tinted ribbon windows (few lit), a blank ground floor.
  mb.kind = KIND.wall;
  mb.color = lin(GRANITE);
  mb.flags = 8 + 1 * 16;
  mb.frontNormal = f.n;
  mb.style = [2.2, 0.55, 1.2, WIN.ribbon + 8 * 5];
  localBox(mb, f, 0.5, fw - 0.5, B0, depth, 4.2, b.h, KIND.roof);
  mb.style = [0, 0, 0, 0];
  mb.flags = 0;
  mb.frontNormal = null;
  box(0x1e1e22, 0.5, fw - 0.5, B0, depth, 0, 4.2);
  box(0x3a3a3e, 0.3, fw - 0.3, B0 - 0.2, depth, 4.0, 4.4);
  box(0x3a3a3e, 0.3, fw - 0.3, B0 - 0.1, depth, b.h, b.h + 0.8);
  // Vertical granite fins between the window bays.
  for (let u = 0.5; u <= fw - 0.5; u += 2.83) box(0x323236, u - 0.18, u + 0.18, B0 - 0.25, B0, 4.4, b.h);

  // Entrance: a recessed steel door, a cold lamp, the nameplate, CCTV, the crest.
  box(0x0e0e10, 7.4, 10.6, B0 - 0.05, B0, 0, 3.4);
  box(0x4a4c50, 7.8, 10.2, B0 - 0.12, B0 - 0.05, 0, 2.6);
  box(0x2a2c30, 8.98, 9.02, B0 - 0.14, B0 - 0.12, 0, 2.6);
  for (const y of [0.6, 1.3, 2.0]) box(0x2a2c30, 7.8, 10.2, B0 - 0.14, B0 - 0.12, y, y + 0.04);
  box(0x6a6c70, 7.6, 10.4, B0 - 1.4, B0, 3.4, 3.55);
  glow(EMIT.lamp, [0.14, 0.16, 0.2], 8.6, 9.4, B0 - 1.0, B0 - 0.6, 3.36, 3.4);
  box(GOLD, 10.8, 11.8, B0 - 0.04, B0, 1.3, 1.9);
  for (const [u, s] of [[7.1, -1], [10.9, 1], [0.8, -1], [fw - 0.8, 1]] as const) {
    box(0xd8d8d8, u - 0.1, u + 0.1, B0 - 0.45, B0, 3.9, 4.1);
    box(0x1a1a1a, u - 0.07 + s * 0.02, u + 0.07 + s * 0.02, B0 - 0.5, B0 - 0.44, 3.93, 4.07);
    glow(EMIT.always, [1.2, 0.1, 0.1], u - 0.02, u + 0.02, B0 - 0.51, B0 - 0.5, 4.07, 4.1);
  }
  const n = f.n;

  // Forecourt: dark paving, a low granite wall with a sliding steel gate (open), lamps on the gate posts.
  box(0x242426, 0.3, fw - 0.3, 0.35, B0, 0, 0.04);
  box(GRANITE, 0, GATE[0], 0, 0.35, 0, 1.0);
  box(GRANITE, GATE[1], fw, 0, 0.35, 0, 1.0);
  box(GRANITE, 0, 0.3, 0.35, B0, 0, 1.0);
  box(GRANITE, fw - 0.3, fw, 0.35, B0, 0, 1.0);
  for (const u of GATE) {
    box(0x1a1a1c, u - 0.25, u + 0.25, -0.05, 0.4, 0, 2.0);
    box(0xe8e0d0, u - 0.18, u + 0.18, 0.0, 0.35, 2.0, 2.4);
    glow(EMIT.lamp, [0.18, 0.13, 0.08], u - 0.15, u + 0.15, -0.01, 0.36, 2.05, 2.35);
  }
  for (let u = 1.0; u < GATE[0] - 0.2; u += 0.35) box(0x3a3c40, u, u + 0.08, 0.35, 0.45, 0, 1.3);

  // Black sedans, nose to the street.
  for (const [u, t] of CARS) {
    const [x, z] = toWorld(f, u, t);
    addCar(mb, { x, z, fx: f.n[0], fz: f.n[2], variant: Math.round(u * 13), type: 'sedan', paint: 0x0c0c0e });
  }

  const mesh = new THREE.Mesh(mb.build()!, city);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);

  // Nameplate text: 竜神興業株式会社 in engraved black on brass.
  const c = document.createElement('canvas');
  c.width = 200;
  c.height = 520;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b08a38';
  g.fillRect(0, 0, 200, 520);
  g.fillStyle = '#1a1206';
  g.font = "bold 58px 'Yu Mincho', 'MS Mincho', serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  ['竜', '神', '興', '業'].forEach((ch, i) => g.fillText(ch, 100, 60 + i * 80));
  g.font = "bold 32px 'Yu Mincho', 'MS Mincho', serif";
  ['株', '式', '会', '社'].forEach((ch, i) => g.fillText(ch, 100, 370 + i * 40));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 1.2), new THREE.MeshStandardMaterial({ map: tex, metalness: 0.5, roughness: 0.4 }));
  const [px, pz] = toWorld(f, 11.3, B0 - 0.05);
  plate.position.set(px, 1.6, pz);
  plate.rotation.y = Math.atan2(n[0], n[2]);
  group.add(plate);

  // The crest: 竜 in gold inside a double ring with a dragon coiling round it, on black.
  const crest = document.createElement('canvas');
  crest.width = crest.height = 512;
  const k = crest.getContext('2d')!;
  k.fillStyle = '#08080a';
  k.beginPath();
  k.arc(256, 256, 250, 0, Math.PI * 2);
  k.fill();
  const gold = k.createLinearGradient(0, 0, 512, 512);
  gold.addColorStop(0, '#f0d488');
  gold.addColorStop(0.5, '#b88a30');
  gold.addColorStop(1, '#e8c070');
  k.strokeStyle = gold;
  k.lineWidth = 14;
  for (const rad of [236, 206]) {
    k.beginPath();
    k.arc(256, 256, rad, 0, Math.PI * 2);
    k.stroke();
  }
  // The dragon: a scaled body running round between the rings, its head at the top biting its tail.
  k.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const a = -Math.PI / 2 + 0.35 + (i / 70) * Math.PI * 1.85;
    const w = 20 - i * 0.2;
    k.fillStyle = gold;
    k.beginPath();
    k.arc(256 + Math.cos(a) * 221, 256 + Math.sin(a) * 221, w / 2, 0, Math.PI * 2);
    k.fill();
  }
  k.beginPath();
  k.moveTo(256 + 60, 30);
  k.lineTo(256 + 10, 8);
  k.lineTo(256 - 20, 30);
  k.lineTo(256 + 20, 50);
  k.closePath();
  k.fill();
  k.fillStyle = '#ff3020';
  k.beginPath();
  k.arc(256 + 14, 26, 5, 0, Math.PI * 2);
  k.fill();
  k.fillStyle = gold;
  k.font = "bold 250px 'Yu Mincho', 'MS Mincho', serif";
  k.textAlign = 'center';
  k.textBaseline = 'middle';
  k.fillText('竜', 256, 270);
  const crestTex = new THREE.CanvasTexture(crest);
  crestTex.colorSpace = THREE.SRGBColorSpace;
  crestTex.anisotropy = 4;
  const emblem = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48), new THREE.MeshBasicMaterial({ map: crestTex, color: new THREE.Color(0.95, 0.9, 0.85) }));
  const [ex, ez] = toWorld(f, 9, B0 - 0.08);
  emblem.position.set(ex, 5.5, ez);
  emblem.rotation.y = Math.atan2(n[0], n[2]);
  group.add(emblem);

  // The men in suits.
  const people = new GhostBuilder();
  GUARDS.forEach(([u, t, turn], i) => {
    const [x, z] = toWorld(f, u, t);
    addFigure(people, {
      x,
      z,
      yaw: localYaw(f, 0, -1) + turn,
      body: 'man',
      pose: i === 0 ? 'pockets' : 'stand',
      color: [0.78, 0.84, 1.0],
      hair: 'short',
      long: true,
      phase: 0,
      side: 1,
      look: -turn,
    });
  });
  const crowd = people.build(0, 0);
  if (crowd) {
    const m = new THREE.Mesh(crowd, ghost);
    m.renderOrder = 2;
    group.add(m);
  }
  return group;
}
