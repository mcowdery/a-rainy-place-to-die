import type * as THREE from 'three';
import type { Building3 } from '../district/plan';
import { printed, type Home, type HomePlan, homeInterior, homeLayout } from './homes';
import type { Interior } from './interiors';
import { kawabataColliders } from './kawabata';
import { text } from './kit';
import { suburbColliders } from './suburbs';

/**
 * The cast's homes (docs/city-plan.md: the story jumps between characters, each with a home), as flats in their
 * buildings (real/homes.ts):
 * - the detective's room 201 at コーポ川端 (Kawabata): six mats and a kitchen, the steel desk under the window with
 *   the blinds, the case board, whisky, the unmade futon.
 * - the salaryman's 402 in block 3 of 都営西原団地 (Nishihara): a 2DK, the dining kitchen with one chair pulled out,
 *   the kotatsu and the altar with the family photo, suits on the rail, the balcony where he smokes.
 */

// ---- コーポ川端 201 (the apato's first unit upstairs: u 0-4.4 of its 18 m, t from the corridor to the back) ----
export const KOPO_201: HomePlan = {
  box: [0.25, 4.25, 1.95, 11.85],
  y: 3.0,
  h: 2.4,
  walls: [
    // The fusuma frame between the kitchen and the six mats (its doorway open).
    [0.25, 2.0, 5.2, 5.3],
    [3.4, 4.25, 5.2, 5.3],
  ],
  solids: [
    [2.6, 4.25, 1.95, 2.55], // the kitchen run under the window
    [0.25, 0.85, 1.95, 2.6], // the fridge
    [0.25, 1.6, 3.2, 5.0], // the unit bath
    [1.0, 2.8, 11.1, 11.85], // the desk
    [0.25, 0.6, 8.9, 10.6], // the file shelf
    [3.75, 4.25, 5.35, 6.25], // the TV
    [3.75, 4.1, 10.0, 10.4], // the coat stand
  ],
  windows: [
    { side: 't0', a: 2.8, b: 3.6, y0: 1.0, y1: 1.7 },
    { side: 't1', a: 0.6, b: 3.9, y0: 0.8, y1: 2.05 },
  ],
  door: { side: 't0', a: 1.5, b: 2.4 },
};

function detective(h: Home): void {
  const [u0, u1] = [0.25, 4.25];
  // Genkan (concrete, a step down), the kitchen's cushion-floor, the six mats, boards by the window.
  h.box(0x6a6660, 1.2, 2.6, 1.95, 2.9, 0, 0.02);
  h.box(0x8a7a5a, u0, u1, 2.9, 5.25, 0, 0.04);
  h.tatami(u0, u1, 5.3, 9.6);
  h.boards(0x6a4a30, u0, u1, 9.6, 11.85);
  h.shoes(1.35, 2.1, [0x2a1a14, 0x3a3a3a]);
  h.box(0x2a2a3a, 2.3, 2.36, 2.0, 2.06, 0, 0.9); // an umbrella against the wall
  // The kitchen: the run under the little window, the fridge, the unit bath's box, a bare bulb.
  h.kitchen(2.6, 4.25, 1.95, 2.55, 't0', 0xc8c0b0);
  h.fridge(0.25, 0.85, 1.95, 2.6, 1.1);
  h.box(0xc8a040, 0.4, 0.7, 2.62, 2.64, 0.5, 0.8); // a takeaway menu on the fridge
  h.closet(0.25, 1.6, 3.2, 5.0, 'u1');
  h.ceilingLight(2.6, 3.6, 'bulb', [1.4, 1.15, 0.8]);
  for (const [uu, c] of [[2.9, 0xe8e0d0], [3.2, 0xc83a2a], [3.5, 0xe8e0d0]] as const) h.box(c, uu, uu + 0.12, 2.05, 2.17, 0.86, 1.0); // cup noodles
  // The six mats: the unmade futon, the low table with the ashtray and the bottle, the old TV.
  h.futon(0.45, 1.4, 5.6, 7.7, 0x5a6a8a, true);
  h.chabudai(2.9, 7.4);
  h.box(0x8a8a8a, 2.8, 2.98, 7.3, 7.48, 0.32, 0.35); // the ashtray
  h.box(0x6a3a14, 3.05, 3.15, 7.25, 7.35, 0.32, 0.6); // the whisky
  h.box(0xc8c8c0, 2.75, 2.83, 7.5, 7.58, 0.32, 0.4); // the glass
  h.tv(4.0, 5.8, 'u0', true, [0.25, 0.3, 0.4]);
  h.ceilingLight(2.25, 7.4, 'ring', [1.0, 1.05, 1.0]);
  // The desk under the window (the blinds half open), its lamp, files, the phone, the typewriter.
  h.table(1.0, 2.8, 11.1, 11.85, 0x5a5e62, 0.74);
  h.box(0x5a5e62, 1.0, 1.5, 11.15, 11.8, 0, 0.7); // the drawers
  h.chair(1.9, 10.6, 0x3a3a3a, 't0');
  h.box(0x2a2a2a, 2.35, 2.6, 11.5, 11.7, 0.74, 0.77);
  h.box(0x2a2a2a, 2.46, 2.49, 11.58, 11.62, 0.77, 1.1);
  h.box(0x2a2a2a, 2.3, 2.55, 11.4, 11.62, 1.08, 1.16);
  h.glow([1.6, 1.25, 0.8], 2.33, 2.52, 11.42, 11.6, 1.07, 1.08);
  h.box(0x3a3a3a, 1.5, 1.95, 11.35, 11.7, 0.74, 0.86); // the typewriter
  h.box(0xd8d0c0, 1.6, 1.85, 11.6, 11.62, 0.86, 1.0);
  h.box(0x1a1a1a, 1.05, 1.3, 11.5, 11.72, 0.74, 0.82); // the phone
  for (let i = 0; i < 5; i++) h.box([0xd8c8a0, 0xc8b890, 0xe8d8b0][i % 3], 2.0 + i * 0.02, 2.3, 11.2, 11.45, 0.74 + i * 0.012, 0.75 + i * 0.012);
  h.blinds('t1', 0.6, 3.9, 0.8, 2.05);
  // Files on the steel shelf, the coat stand with the trench coat and hat.
  h.shelf(0.25, 0.6, 8.9, 10.6, 1.8, 0x5a5e62, [0xd8c8a0, 0x3a4a6a, 0x8a3a2a, 0xc8b890, 0x2a2a2a]);
  h.box(0x3a3a3a, 3.88, 3.94, 10.15, 10.21, 0, 1.75);
  h.box(0x8a7a5a, 3.72, 4.1, 10.02, 10.38, 0.5, 1.6); // the coat
  h.box(0x3a3028, 3.75, 4.07, 10.05, 10.33, 1.72, 1.82); // the hat
  // The case board: photos, a map of Kawabata, cards and the red string between them.
  h.picture('u1', 7.6, 1.45, 2.0, 1.1, (g, W, H) => {
    g.fillStyle = '#a8845a';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#d8d0b8';
    g.fillRect(W * 0.34, H * 0.12, W * 0.32, H * 0.5);
    g.strokeStyle = '#8a8a7a';
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(W * 0.34, H * (0.15 + i * 0.08));
      g.lineTo(W * 0.66, H * (0.2 + i * 0.07));
      g.stroke();
    }
    const pins: [number, number][] = [[0.12, 0.2], [0.2, 0.62], [0.5, 0.78], [0.82, 0.25], [0.86, 0.66], [0.5, 0.36]];
    g.strokeStyle = '#c81a1a';
    g.lineWidth = 3;
    g.beginPath();
    for (const [x, y] of [pins[0], pins[5], pins[3], pins[4], pins[2], pins[5], pins[1]]) g.lineTo(W * x, H * y);
    g.stroke();
    for (const [x, y] of pins.slice(0, 5)) {
      g.fillStyle = '#f0ece4';
      g.fillRect(W * x - 34, H * y - 26, 68, 52);
      g.fillStyle = '#3a3a3a';
      g.fillRect(W * x - 28, H * y - 20, 56, 38);
      g.fillStyle = '#e8c020';
      g.beginPath();
      g.arc(W * x, H * y - 24, 5, 0, Math.PI * 2);
      g.fill();
    }
    text(g, '竜胆組?', W * 0.5, H * 0.9, `bold ${Math.round(H * 0.08)}px 'Yu Gothic', sans-serif`, '#1a1a1a');
  });
  // A calendar by the door, a clock.
  h.picture('t0', 0.9, 1.55, 0.35, 0.5, (g, W, H) => printed(g, W, H, '#f4f0e8', [['1989', '#c81a1a', 0.18], ['3月', '#1a1a1a', 0.45], ['川端酒店', '#3a3a3a', 0.85]]));
  h.picture('u0', 7.4, 2.0, 0.3, 0.3, (g, W, H) => {
    g.fillStyle = '#f4f0e8';
    g.beginPath();
    g.arc(W / 2, H / 2, W * 0.46, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#1a1a1a';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(W / 2, H / 2);
    g.lineTo(W * 0.72, H * 0.38);
    g.moveTo(W / 2, H / 2);
    g.lineTo(W / 2, H * 0.14);
    g.stroke();
  });
}

// ---- 都営西原団地 3号棟 402 (block 3: t 58-70, the balconies to the south; floors of 3 m) ----
export const DANCHI_402: HomePlan = {
  box: [24.2, 30.6, 58.3, 66.8],
  y: 9.0,
  h: 2.4,
  walls: [
    // Between the two mat rooms; between them and the dining kitchen (two doorways); the bath and toilet's box.
    [27.45, 27.55, 58.3, 62.0],
    [24.2, 25.0, 62.0, 62.1],
    [26.2, 28.4, 62.0, 62.1],
    [29.6, 30.6, 62.0, 62.1],
  ],
  solids: [
    [28.75, 30.6, 62.1, 65.2], // the bath and toilet
    [24.2, 27.2, 66.2, 66.8], // the kitchen run
    [27.3, 28.0, 66.1, 66.8], // the fridge
    [25.2, 26.6, 63.3, 64.5], // the table
    [24.2, 24.75, 59.4, 61.0], // the TV
    [26.75, 27.45, 61.45, 62.0], // the altar
  ],
  windows: [{ side: 't1', a: 24.6, b: 26.9, y0: 1.15, y1: 1.9 }],
  balcony: { side: 't0', a: 24.2, b: 30.6, depth: 1.3, glass: [24.6, 27.7], open: [27.7, 30.2] },
  door: { side: 't1', a: 29.2, b: 30.2 },
};

function salaryman(h: Home): void {
  // Floors: the genkan's tiles, the kitchen's vinyl, six mats and four and a half.
  h.box(0x7a7670, 28.8, 30.6, 65.3, 66.8, 0, 0.02);
  h.boards(0xa89070, 24.2, 28.75, 62.1, 66.8);
  h.tatami(24.2, 27.45, 58.3, 62.0);
  h.tatami(27.55, 30.6, 58.3, 62.0);
  h.shoes(29.0, 66.3, [0x1a1a1a, 0x5a4a3a]);
  h.box(0x6a4a30, 30.2, 30.6, 65.4, 66.8, 0, 1.0); // the shoe cupboard
  // The dining kitchen: the run under the window, the fridge (a child's drawing on it), the table for two, one chair
  // pulled out, the konbini bento and the cans.
  h.kitchen(24.2, 27.2, 66.2, 66.8, 't1', 0xd8d0b8);
  h.fridge(27.3, 28.0, 66.1, 66.8, 1.6, 0xe0dcd0);
  h.picture('t1', 27.65, 1.2, 0.3, 0.24, (g, W, H) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    for (const [x, c] of [[0.25, '#3a6ac8'], [0.5, '#e84a8a'], [0.72, '#e8a020']] as const) {
      g.fillStyle = c;
      g.beginPath();
      g.arc(W * x, H * 0.4, H * (x === 0.72 ? 0.12 : 0.16), 0, Math.PI * 2);
      g.fill();
      g.fillRect(W * x - 3, H * 0.5, 6, H * 0.3);
    }
    text(g, 'パパ', W * 0.25, H * 0.9, `bold ${Math.round(H * 0.16)}px 'Yu Gothic', sans-serif`, '#3a3a3a');
  });
  h.table(25.2, 26.6, 63.3, 64.5, 0x9a7a54, 0.7);
  h.chair(25.9, 63.0, 0x7a5a3a, 't0');
  h.chair(25.6, 65.1, 0x7a5a3a, 't1');
  h.box(0xf0ece4, 25.7, 26.0, 63.6, 63.85, 0.7, 0.74); // the bento
  for (const [uu, tt] of [[26.2, 63.8], [26.35, 64.1], [26.1, 64.2]] as const) h.box(0xc8c8c8, uu, uu + 0.07, tt, tt + 0.07, 0.7, 0.82);
  h.box(0xe8e0d0, 25.3, 25.6, 64.1, 64.4, 0.7, 0.72); // the post
  h.ceilingLight(25.9, 64.2, 'pendant', [1.4, 1.2, 0.9]);
  h.closet(28.75, 30.6, 62.1, 65.2, 't1', 0xe8e4dc);
  h.picture('u0', 64.5, 1.6, 0.4, 0.55, (g, W, H) => printed(g, W, H, '#ffffff', [['東邦商事', '#1a3a8a', 0.2], ['1989 · 3', '#1a1a1a', 0.5], ['営業部', '#3a3a3a', 0.85]]));
  // Six mats: the kotatsu and the TV, the altar with the family photo (the photo turned down).
  h.kotatsu(25.8, 60.2, 0.8, 0x6a4a8a);
  h.tv(24.5, 60.2, 'u1', true, [0.3, 0.45, 0.6]);
  h.box(0x2a1a14, 26.75, 27.45, 61.45, 62.0, 0, 0.9);
  h.box(0xc8a040, 26.85, 27.35, 61.5, 61.52, 0.4, 0.8);
  h.box(0x1a1a1a, 26.95, 27.25, 61.6, 61.8, 0.9, 0.92); // the photo, face down
  h.glow([1.4, 0.9, 0.4], 26.85, 26.88, 61.7, 61.73, 0.9, 0.98); // a candle
  h.ceilingLight(25.8, 60.2, 'ring');
  // Four and a half mats: the futon laid out, suits along the rail over the partition, the briefcase.
  h.futon(28.0, 29.1, 59.0, 61.1, 0x6a8a9a, false);
  h.hanging(28.6, 30.5, 61.72, 2.05, [0x2a2e38, 0x3a3e48, 0x2a2e38, 0xe8e8e8]);
  h.box(0x3a2a1e, 29.4, 29.85, 58.6, 58.72, 0, 0.32);
  h.box(0xe8e4dc, 29.9, 30.1, 59.1, 59.3, 0.04, 0.14); // the alarm clock
  h.ceilingLight(29.1, 60.2, 'ring', [1.0, 1.0, 0.95]);
  h.curtains('t0', 24.6, 30.2, 0.02, 2.0, 0xc8c0a0);
  // The balcony: the AC unit, shirts on the laundry pole, sandals, the stool and the coffee-can ashtray.
  h.box(0xe0dcd4, 24.35, 25.15, 57.0, 57.5, 0, 0.6);
  h.box(0x8a8a8a, 24.3, 30.5, 57.25, 57.28, 1.75, 1.78);
  for (const uu of [26.0, 26.6, 27.2]) h.box(0xf4f4f4, uu, uu + 0.45, 57.2, 57.33, 1.0, 1.72);
  h.shoes(28.1, 57.9, [0x3a5a8a]);
  h.box(0x5a5e62, 29.3, 29.65, 57.2, 57.55, 0, 0.42);
  h.box(0xc8a040, 29.4, 29.48, 57.3, 57.38, 0.42, 0.52);
}

/** The homes by landmark kind: the flat's plan, how to build it, and the street's own collision under it. */
export const HOMES: Readonly<Record<string, { plan: HomePlan; look: { wall: number; ceiling: number; floor?: number }; furnish: (h: Home) => void; ground: (b: Building3) => ReturnType<typeof kawabataColliders> }>> = {
  apato: { plan: KOPO_201, look: { wall: 0xc8bca4, ceiling: 0xb8ae98 }, furnish: detective, ground: (b) => kawabataColliders('apato', b) },
  danchi: { plan: DANCHI_402, look: { wall: 0xe0d8c4, ceiling: 0xe8e4d8 }, furnish: salaryman, ground: (b) => suburbColliders('danchi', b) },
};

export function homeFor(kind: string): { build: (b: Building3, city: THREE.Material, ghost: THREE.Material) => Generator<void, Interior>; layout: (b: Building3) => Omit<Interior, 'group'>; range: number; keep: true } {
  const def = HOMES[kind];
  return {
    *build(b, city, ghost) {
      return homeInterior(b, def.plan, city, ghost, def.look, def.furnish, def.ground(b));
    },
    layout: (b) => homeLayout(b, def.plan, def.ground(b)),
    range: 50,
    keep: true,
  };
}
