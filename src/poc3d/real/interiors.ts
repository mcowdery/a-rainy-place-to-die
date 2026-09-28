import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { Kit, text } from './kit';
import { localFrame, localRect, toLocal } from './localFrame';
import { KIND } from './meshBuilder';
import { deptInterior, deptLayout } from './deptStore';
import { penthouseInterior, penthouseLayout } from './penthouse';

/**
 * Door-entered interiors, built at the building's true position (the hybrid approach): while you're inside
 * the building's footprint, its exterior is hidden and its interior shown, and collision is the interior's
 * walls and fixtures instead of the solid footprint. The city stays loaded round it, so the doorway and
 * the windows look out on the real street. main.ts switches by where the walker is; a door node's E
 * (with a fade) takes you in, walking out of the doorway (or E at the inner door) takes you out.
 *
 * An interior lays itself out in the building's local frame (localFrame.ts: u along the street face,
 * t inward), like the landmarks, so the same layout gives the geometry and the collision.
 */
export interface Interior {
  /** The interior's geometry (hidden until you're inside). */
  readonly group: THREE.Group;
  /** Collision on the walker's level while inside (world rects): replaces the building's own. */
  colliders(floor: number): readonly Rect[];
  /** Floor height at a world point inside (other storeys, escalators), or null to leave it to the street. */
  floorAt(x: number, z: number, current: number): number | null;
  /** Whether a point (the camera) is inside: the footprint less the walls, and the storeys' heights. */
  contains(x: number, z: number, y: number): boolean;
  /** Escalators: the horizontal velocity (world x, z) carrying a walker at a point on a level, or null. */
  carry?(x: number, z: number, level: number): [number, number] | null;
}

type R4 = readonly [number, number, number, number];

// ---- 桜湯 Sakura-yu: the public bath (the stamp's footprint: 16 m along the street, 22 m deep) ----

/** The men's side (u 0.6-8); the women's side (u 8.3-15.4) is behind the partition. */
const SENTO = {
  front: 1.2,
  lobby: [3.2, 8] as const,
  change: [8.2, 13] as const,
  hall: [13.2, 21.4] as const,
  door: [5.4, 10.6] as const,
  menDoor: [2, 5] as const,
  hallDoor: [3, 6] as const,
  wallU: [0.6, 15.4] as const,
} as const;

const SENTO_COLLIDERS: readonly R4[] = [
  // The outer walls (the street doorway open), the back.
  [0.6, SENTO.door[0], 0.9, SENTO.front], [SENTO.door[1], 15.4, 0.9, SENTO.front],
  [0.3, 0.8, 0.9, 22], [15.2, 15.7, 0.9, 22], [0.6, 15.4, 21.4, 22],
  // The genkan's shoe lockers, the lobby's counter, fridge and bench.
  [3.7, 4.0, SENTO.front, 3.2], [12.0, 12.3, SENTO.front, 3.2],
  [6.5, 9.5, 5.5, 6.5], [14.4, 15.2, 3.4, 5.0], [1.0, 3.5, 3.4, 3.9],
  // The partition into the changing rooms (the men's doorway open), the wall between men and women.
  [0.6, SENTO.menDoor[0], 8.0, SENTO.change[0]], [SENTO.menDoor[1], 15.4, 8.0, SENTO.change[0]],
  [8.0, 8.3, SENTO.change[0], SENTO.hall[1]],
  // Changing room: lockers, the massage chair; the glass wall into the bath hall (its doors open).
  [0.8, 1.4, 8.4, 12.6], [6.0, 7.2, 10.4, 11.6],
  [0.6, SENTO.hallDoor[0], 13.0, SENTO.hall[0]], [SENTO.hallDoor[1], 8.0, 13.0, SENTO.hall[0]],
  // Bath hall: the washing counter along the wall, the tub at the back.
  [0.8, 1.3, 13.6, 17.4], [0.8, 7.8, 18.0, 21.2],
];

/** The footprint of the bath less its walls: inside is where the interior shows. */
const SENTO_INSIDE = { u0: 0.8, u1: 15.2, t0: 1.0, t1: 21.4 } as const;

/** The bath's interior layout alone (collision, and what counts as inside), without its geometry. */
export function sentoLayout(b: Building3): Omit<Interior, 'group'> {
  const f = localFrame(b);
  const rects = SENTO_COLLIDERS.map((r) => localRect(f, r[0], r[1], r[2], r[3]));
  return {
    colliders: (floor) => (Math.abs(floor) <= 1 ? rects : []),
    floorAt: () => null,
    contains(x, z, y) {
      const [u, t] = toLocal(f, x, z);
      return y > -1 && y < b.h + 2 && u > SENTO_INSIDE.u0 && u < SENTO_INSIDE.u1 && t > SENTO_INSIDE.t0 && t < SENTO_INSIDE.t1;
    },
  };
}

export function sentoInterior(b: Building3, city: THREE.Material, ghost: THREE.Material): Interior {
  const k = new Kit(b);
  const W = (hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, bottom = false): void =>
    k.lit(hex, u0, u1, t0, t1, y0, y1, true, bottom);
  const TILE = 0xd8e4e8;
  const WOOD = 0x8a6a4a;
  const PLASTER = 0xe8e0d0;
  const CEIL = 4.4;
  const HALL_CEIL = 6.3;

  // ---- Shell: floors, ceilings, the walls' inner faces (with the high windows of the bath hall) ----
  W(0x7a7670, SENTO.door[0], SENTO.door[1], SENTO.front, 3.2, 0, 0.04);
  W(0x8a6a4a, 0.8, 15.2, 3.2, SENTO.change[0], 0, 0.06);
  W(0x9a7a58, 0.8, 8, SENTO.change[0], SENTO.hall[0], 0, 0.06);
  W(0xb8ccd4, 0.8, 8, SENTO.hall[0], 21.4, 0, 0.05);
  W(0x8a8680, 0.8, 15.2, SENTO.front, SENTO.change[0], CEIL, CEIL + 0.1, true);
  W(0x8a8680, 0.8, 8, SENTO.change[0], SENTO.hall[0], CEIL, CEIL + 0.1, true);
  W(0xe0e4e4, 0.8, 15.2, SENTO.hall[0], 21.4, HALL_CEIL, HALL_CEIL + 0.1, true);
  for (let t = 2; t < 8; t += 2.5) k.glow([1.3, 1.2, 1.0], 5, 11, t, t + 0.3, CEIL - 0.03, CEIL);
  for (let t = 9; t < 13; t += 2) k.glow([1.3, 1.2, 1.0], 2, 6, t, t + 0.3, CEIL - 0.03, CEIL);
  for (let t = 14; t < 21; t += 2.4) k.glow([1.2, 1.2, 1.15], 1.5, 14.5, t, t + 0.3, HALL_CEIL - 0.03, HALL_CEIL);
  // Front wall inside (either side of the doorway), the side walls, the back wall.
  W(PLASTER, 0.6, SENTO.door[0], 1.1, SENTO.front, 0, CEIL);
  W(PLASTER, SENTO.door[1], 15.4, 1.1, SENTO.front, 0, CEIL);
  W(PLASTER, SENTO.door[0], SENTO.door[1], 1.1, SENTO.front, 3.2, CEIL);
  for (const [u0, u1] of [[0.6, 0.8], [15.2, 15.4]] as const) {
    W(PLASTER, u0, u1, SENTO.front, SENTO.hall[0], 0, CEIL);
    // The bath hall's walls, open for the high windows (glass: the street's light and the sky beyond).
    W(TILE, u0, u1, SENTO.hall[0] - 4.2, 21.4, 0, 4.6);
    W(TILE, u0, u1, SENTO.hall[0] - 4.2, 21.4, 5.8, HALL_CEIL);
    let t = SENTO.hall[0] - 4.2;
    for (let w = 9.5; w < 21; w += 2.4) {
      W(TILE, u0, u1, t, w, 4.6, 5.8);
      k.paneT((u0 + u1) / 2, w, w + 1.6, 4.6, 5.8);
      t = w + 1.6;
    }
    W(TILE, u0, u1, t, 21.4, 4.6, 5.8);
  }
  W(TILE, 0.6, 15.4, 21.4, 21.6, 0, HALL_CEIL);

  // ---- Genkan: stone floor, the shoe lockers either side (wooden doors with numbered keys) ----
  for (const [u0, u1] of [[3.7, 4.0], [12.0, 12.3]] as const) {
    W(WOOD, u0, u1, SENTO.front, 3.2, 0, 1.8);
    const face = u0 < 8 ? u1 + 0.005 : u0 - 0.005;
    for (let t = SENTO.front + 0.1; t < 3.1; t += 0.4) {
      for (let y = 0.15; y < 1.7; y += 0.38) {
        W(0x9a7a5a, Math.min(face, face + (u0 < 8 ? 0.02 : -0.02)), Math.max(face, face + (u0 < 8 ? 0.02 : -0.02)), t, t + 0.34, y, y + 0.32);
        k.box(0xd8c8a0, face - 0.03, face + 0.03, t + 0.12, t + 0.22, y + 0.18, y + 0.26);
      }
    }
  }
  // ---- Lobby: the counter with the attendant, the noren doorways, the milk fridge, a bench, the price board ----
  W(WOOD, 6.5, 9.5, 5.5, 6.5, 0, 1.1);
  W(0xa88a64, 6.4, 9.6, 5.4, 6.6, 1.1, 1.16);
  k.person(8, 6.9, 0, -1, { body: 'elder', pose: 'stand', color: [0.95, 0.85, 0.7] });
  // The partition and its two doorways: 男 (blue, the way in) and 女 (red; the wall behind it).
  W(PLASTER, 0.6, SENTO.menDoor[0], 8.0, SENTO.change[0], 0, CEIL);
  W(PLASTER, SENTO.menDoor[1], 15.4, 8.0, SENTO.change[0], 0, CEIL);
  W(PLASTER, SENTO.menDoor[0], SENTO.menDoor[1], 8.0, SENTO.change[0], 2.4, CEIL);
  const noren = (label: string, color: string): THREE.Texture =>
    k.canvas(384, 256, (g) => {
      g.fillStyle = color;
      g.fillRect(0, 0, 384, 256);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      for (const x of [127, 255]) g.fillRect(x - 2, 60, 4, 196);
      text(g, label, 192, 128, "bold 130px 'Yu Mincho', 'MS Mincho', serif", '#ffffff');
    });
  k.plane(noren('男', '#1a3a6a'), 3.0, 1.2, (SENTO.menDoor[0] + SENTO.menDoor[1]) / 2, 7.95, 1.8, 'out', 1.0);
  k.plane(noren('女', '#8a1a2a'), 3.0, 1.2, 12.5, 7.86, 1.8, 'out', 1.0);
  W(0x3a2a1e, 11, 14, 7.9, 7.95, 0, 2.4);
  // The coffee-milk fridge against the side wall: glass front to the lobby, bottles glowing.
  W(0xe8e8e4, 14.4, 15.2, 3.4, 5.0, 0, 1.9);
  k.glow([0.9, 0.95, 1.05], 14.38, 14.4, 3.5, 4.9, 0.2, 1.8);
  for (let y = 0.35; y < 1.7; y += 0.4) for (let t = 3.6; t < 4.8; t += 0.25) k.glow(t % 0.5 < 0.25 ? [1.2, 1.05, 0.8] : [1.25, 1.25, 1.2], 14.34, 14.38, t, t + 0.12, y, y + 0.22);
  W(WOOD, 1.0, 3.5, 3.4, 3.9, 0.42, 0.48);
  for (const u of [1.2, 3.3]) W(0x3a3c40, u - 0.05, u + 0.05, 3.45, 3.85, 0, 0.42);
  k.plane(k.canvas(420, 300, (g) => {
    g.fillStyle = '#f4ecd8';
    g.fillRect(0, 0, 420, 300);
    text(g, '入浴料金', 210, 50, "bold 44px 'Yu Mincho', serif", '#2a1a0e');
    text(g, '大人  520円', 210, 130, "bold 40px 'Yu Mincho', serif", '#2a1a0e');
    text(g, '中人  200円', 210, 190, "36px 'Yu Mincho', serif", '#2a1a0e');
    text(g, '小人  100円', 210, 245, "36px 'Yu Mincho', serif", '#2a1a0e');
  }), 1.2, 0.86, 8, 5.45, 2.4, 'out', 1.0);

  // ---- The changing room: lockers, baskets on shelves, the massage chair, a scale, a ceiling fan ----
  W(WOOD, 0.8, 1.4, 8.4, 12.6, 0, 2.2);
  for (let t = 8.5; t < 12.5; t += 0.5) for (let y = 0.1; y < 2.1; y += 0.52) W(0x9a7a5a, 1.4, 1.42, t, t + 0.44, y, y + 0.46);
  W(WOOD, 7.7, 8.0, 8.4, 12.8, 0.9, 0.95);
  for (let t = 8.6; t < 12.6; t += 0.8) W(0xc8a870, 7.2, 7.95, t, t + 0.6, 0.95, 1.3);
  W(0x2a2a30, 6.0, 7.2, 10.4, 11.6, 0, 0.6);
  W(0x2a2a30, 6.0, 7.2, 11.3, 11.6, 0.6, 1.4);
  W(0xe8e8e0, 1.8, 2.4, 12.0, 12.6, 0, 0.12);
  k.box(0x4a4a4c, 4.3, 4.5, 10.4, 10.6, CEIL - 0.4, CEIL);
  k.box(0xc8c8c0, 3.4, 5.4, 10.45, 10.55, CEIL - 0.45, CEIL - 0.4);
  k.box(0xc8c8c0, 4.35, 4.45, 9.5, 11.5, CEIL - 0.45, CEIL - 0.4);
  k.person(3.2, 10.2, 1, 0, { body: 'man', pose: 'pockets', color: [0.8, 0.85, 1.0] });
  // The wall between the men's and women's sides: full height here, 2.4 m in the bath hall (the mural shows over it).
  W(PLASTER, 8.0, 8.3, SENTO.change[0], SENTO.hall[0], 0, CEIL);
  W(TILE, 8.0, 8.3, SENTO.hall[0], 21.4, 0, 2.4);
  // The glass wall into the bath hall, its doors open.
  W(0x9aa0a6, 0.6, SENTO.hallDoor[0], 13.0, SENTO.hall[0], 0, 0.3);
  W(0x9aa0a6, SENTO.hallDoor[1], 8.0, 13.0, SENTO.hall[0], 0, 0.3);
  k.pane(0.6, SENTO.hallDoor[0], 0.3, 2.4, 13.1);
  k.pane(SENTO.hallDoor[1], 8.0, 0.3, 2.4, 13.1);
  W(PLASTER, 0.6, 8.0, 13.0, SENTO.hall[0], 2.4, CEIL);
  W(PLASTER, 8.3, 15.4, 8.0, SENTO.hall[0], 0, CEIL);

  // ---- The bath hall: washing stations along the wall, the tub, the Fuji mural ----
  W(TILE, 0.8, 1.3, 13.6, 17.4, 0, 0.8);
  for (let t = 13.9; t < 17.2; t += 0.85) {
    k.glow([0.75, 0.82, 0.86], 0.81, 0.83, t, t + 0.6, 1.1, 1.8);
    W(0xc8ccd0, 1.3, 1.45, t + 0.25, t + 0.35, 0.85, 0.95);
    W(0xe8c020, 1.7, 2.0, t + 0.15, t + 0.45, 0.3, 0.5);
    W(0x6a9ac8, 1.8, 2.2, t + 0.1, t + 0.5, 0, 0.3);
  }
  k.plane(k.canvas(200, 90, (g) => {
    g.fillStyle = '#e8c020';
    g.fillRect(0, 0, 200, 90);
    text(g, 'ケロリン', 100, 48, "bold 40px 'Yu Gothic', sans-serif", '#c82020');
  }), 0.28, 0.13, 1.85, 14.2, 0.42, '+u', 1.0);
  // The tub: a tiled rim, hot water (a faint glow of steam over it).
  W(0x8ab8c8, 0.8, 7.8, 18.0, 18.3, 0, 0.6);
  W(0x8ab8c8, 7.5, 7.8, 18.0, 21.2, 0, 0.6);
  k.kind(KIND.water, 0x2a7a8a, 0.8, 7.5, 18.3, 21.2, 0.3, 0.45);
  k.glow([0.22, 0.3, 0.32], 0.9, 7.4, 18.4, 21.1, 0.45, 0.46);
  k.person(4.6, 16.2, 0, 1, { body: 'elder', pose: 'stand', color: [1.0, 0.9, 0.8] });
  // The mural: Mount Fuji over the sea, pines on the shore (a classic sentō painting).
  k.plane(k.canvas(1536, 512, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 330);
    sky.addColorStop(0, '#3a78c8');
    sky.addColorStop(1, '#bcdcf0');
    g.fillStyle = sky;
    g.fillRect(0, 0, 1536, 512);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    for (const [x, y, r] of [[220, 90, 60], [300, 80, 48], [1200, 110, 70], [1290, 96, 52], [760, 60, 40]] as const) {
      g.beginPath();
      g.ellipse(x, y, r * 1.8, r * 0.6, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#4a6a9a';
    g.beginPath();
    g.moveTo(330, 350);
    g.lineTo(768, 110);
    g.lineTo(1206, 350);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(640, 180);
    g.lineTo(768, 110);
    g.lineTo(896, 180);
    for (let x = 880; x >= 656; x -= 32) g.lineTo(x, 180 + (x % 64 === 0 ? 22 : 6));
    g.fill();
    g.fillStyle = '#2a5a8a';
    g.fillRect(0, 340, 1536, 172);
    g.strokeStyle = '#e8f0f8';
    g.lineWidth = 4;
    for (let y = 360; y < 512; y += 26) {
      g.beginPath();
      for (let x = 0; x <= 1536; x += 12) g.lineTo(x, y + Math.sin(x / 40 + y) * 5);
      g.stroke();
    }
    g.fillStyle = '#1e3a1e';
    for (const x of [60, 140, 1420, 1480]) {
      g.fillRect(x - 6, 250, 12, 110);
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.ellipse(x + (i % 2 ? 30 : -24), 250 - i * 28, 56 - i * 8, 16, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }), 14.4, 4.8, 8, 21.38, 3.9, 'out', 1.05);

  const group = k.finish(city, ghost);
  group.visible = false;
  return { group, ...sentoLayout(b) };
}

/**
 * Interiors by landmark kind: the builder (a generator, so a big interior can be built a slice per frame), the
 * layout alone (collision and floors, also for tests), how near to start building it (m from the centre), and
 * which named part of the exterior it replaces (the whole exterior if none).
 */
export const INTERIORS: Readonly<Record<string, { build: (b: Building3, city: THREE.Material, ghost: THREE.Material) => Generator<void, Interior>; layout: (b: Building3) => Omit<Interior, 'group'>; range: number; hides?: string }>> = {
  sento: {
    *build(b, city, ghost) {
      return sentoInterior(b, city, ghost);
    },
    layout: sentoLayout,
    range: 70,
  },
  dept_store: { build: deptInterior, layout: deptLayout, range: 120 },
  residence: { build: penthouseInterior, layout: penthouseLayout, range: 60, hides: 'crown' },
};
