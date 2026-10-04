import type * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { type Flat, printed, type Home, type HomePlan, homeInterior, homeLayout, homeShelters } from './homes';
import type { Interior } from './interiors';
import { kawabataColliders } from './kawabata';
import { text } from './kit';
import { mansionFloorY, residenceColliders } from './residences';
import { suburbColliders } from './suburbs';

/**
 * The cast's homes (docs/city-plan.md: the story jumps between characters, each with a home), as flats in their
 * buildings (real/homes.ts):
 * - the detective's room 201 at コーポ川端 (Kawabata): six mats and a kitchen, the steel desk under the window with
 *   the blinds, the case board, whisky, the unmade futon.
 * - the salaryman's 402 in block 3 of 都営西原団地 (Nishihara): a 2DK, the dining kitchen with one chair pulled out,
 *   the kotatsu and the altar with the family photo, suits on the rail, the balcony where he smokes.
 * - the idol manager's 603 at メゾン電光 (Denkō-chō): a 1LDK over the back street, the concert on the TV, the laptop,
 *   the whiteboard of the girls' week, merch boxes, a bed barely slept in.
 * - the Stella dorm's lounge (Sakuragaoka, across the avenue from the agency): the genkan's lockers and the rules
 *   (恋愛禁止), the sofa and the big TV, the long table, the mirror wall with its barre, two of the girls home.
 * - コーポ桜 (Sakuragaoka): the teacher's 102 (books, the kotatsu with red-penned tests, the class photo) and the MC's
 *   203 upstairs (just moved in: boxes, a cooler for a fridge, one bulb), the second rung of the housing ladder.
 * - 漫画喫茶 月夜 (Kaburo): the net café where the MC sleeps for now, booth 17 (the first rung).
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

// ---- メゾン電光 603, the idol manager's (the mansion's sixth floor; the balcony over Denkō-chō's back street) ----
const M6 = mansionFloorY(6);
export const MANAGER_603: HomePlan = {
  box: [1.2, 8.8, 1.45, 10.4],
  y: M6,
  h: 2.5,
  walls: [
    [5.6, 5.7, 1.45, 4.6],
    [5.6, 5.7, 5.6, 6.4],
    [1.2, 4.2, 6.4, 6.5],
    [5.4, 8.8, 6.4, 6.5],
  ],
  solids: [
    [1.2, 4.1, 6.5, 10.4], // the bathroom
    [5.5, 8.8, 6.5, 10.4], // the walk-in closet
    [1.2, 1.6, 2.2, 3.8], // the TV
    [3.5, 4.3, 2.0, 4.2], // the sofa
    [5.0, 5.6, 1.6, 4.4], // the kitchen run
    [1.3, 3.3, 5.7, 6.4], // the desk
    [6.4, 8.6, 3.6, 6.35], // the bed
  ],
  windows: [{ side: 't0', a: 6.0, b: 8.5, y0: 0.9, y1: 2.1 }],
  balcony: { side: 't0', a: 1.2, b: 8.8, depth: 1.3, glass: [1.4, 3.4], open: [3.4, 5.4] },
  door: { side: 't1', a: 4.3, b: 5.3 },
};

function manager(h: Home): void {
  h.box(0x6a6660, 4.2, 5.4, 9.4, 10.4, 0, 0.02);
  h.boards(0x8a6a4a, 1.2, 8.8, 1.45, 9.4);
  h.shoes(4.3, 9.9, [0x1a1a1a, 0xe8e0d8, 0x8a2a3a]);
  h.closet(1.2, 4.1, 6.5, 10.4, 'u1', 0xe8e4dc);
  h.closet(5.5, 8.8, 6.5, 10.4, 'u0', 0xe8e4dc);
  // The living room: the TV on (a concert), the sofa, the low table with energy drinks and a light-stick bundle.
  h.tv(1.4, 3.0, 'u1', false, [1.0, 0.45, 0.8]);
  h.box(0x4a4a58, 3.5, 4.3, 2.0, 4.2, 0, 0.42);
  h.box(0x4a4a58, 4.0, 4.3, 2.0, 4.2, 0.42, 0.85);
  h.box(0xd8d0c0, 2.3, 3.1, 2.7, 3.5, 0.34, 0.38);
  for (const [uu, tt, c] of [[2.45, 2.85, 0x2a6ac8], [2.6, 2.9, 0x2a6ac8], [2.8, 3.2, 0xe8c020]] as const) h.box(c, uu, uu + 0.07, tt, tt + 0.07, 0.38, 0.52);
  for (let i = 0; i < 6; i++) h.glow([[1.4, 0.4, 0.9], [0.4, 0.9, 1.4], [1.4, 1.2, 0.3]][i % 3] as [number, number, number], 2.4 + i * 0.05, 2.43 + i * 0.05, 3.3, 3.34, 0.38, 0.62);
  // The kitchen run along the partition, a microwave, a dining counter with two stools.
  h.kitchen(5.0, 5.6, 1.6, 4.4, 'u1', 0xf0ece4);
  h.box(0x2a2a2e, 5.1, 5.55, 3.7, 4.2, 0.86, 1.18);
  // The desk: the laptop open (its glow), schedules everywhere, a stack of CDs, the whiteboard of the girls' week.
  h.table(1.3, 3.3, 5.7, 6.4, 0xe8e4dc, 0.72);
  h.chair(2.3, 5.3, 0x2a2a2e, 't0');
  h.box(0x3a3a3e, 1.9, 2.5, 5.9, 6.3, 0.72, 0.74);
  h.glow([0.6, 0.75, 1.0], 1.92, 2.48, 6.28, 6.3, 0.74, 1.1);
  for (let i = 0; i < 7; i++) h.box([0xf0f0f0, 0xffe0f0, 0xe0f0ff][i % 3], 1.4 + (i % 3) * 0.02, 1.8, 5.75, 6.1, 0.72 + i * 0.012, 0.73 + i * 0.012);
  for (let i = 0; i < 8; i++) h.box(0xe84a8a, 2.8, 3.1, 5.8, 5.94, 0.72 + i * 0.012, 0.73 + i * 0.012);
  h.picture('u0', 5.2, 1.5, 1.6, 0.9, (g, W, H) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#9a9a9a';
    g.lineWidth = 2;
    const days = ['月', '火', '水', '木', '金', '土', '日'];
    days.forEach((dd, i) => {
      const x = (W * (i + 0.5)) / 7;
      text(g, dd, x, H * 0.1, `bold ${Math.round(H * 0.08)}px 'Yu Gothic', sans-serif`, i > 4 ? '#c81a1a' : '#1a1a1a');
      g.beginPath();
      g.moveTo((W * i) / 7, 0);
      g.lineTo((W * i) / 7, H);
      g.stroke();
    });
    const jobs: [number, number, string, string][] = [[0, 0.3, 'レッスン', '#1a4ac8'], [1, 0.45, 'TV収録', '#c81a1a'], [2, 0.3, '握手会', '#1a8a3a'], [3, 0.6, 'ラジオ', '#1a4ac8'], [4, 0.35, '取材', '#1a1a1a'], [5, 0.5, 'LIVE 劇場', '#c81a1a'], [6, 0.5, 'LIVE ドーム?', '#c81a1a']];
    for (const [i, y, s, c] of jobs) text(g, s, (W * (i + 0.5)) / 7, H * y, `bold ${Math.round(H * 0.07)}px 'Yu Gothic', sans-serif`, c);
  });
  // A Stella Production poster (the group in silhouette, stars), a stack of merch boxes.
  h.picture('t1', 3.0, 1.55, 0.9, 1.2, (g, W, H) => {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#ff7ab8');
    grd.addColorStop(1, '#5a2a8a');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 5; i++) {
      const x = W * (0.15 + i * 0.175);
      g.beginPath();
      g.arc(x, H * 0.5, W * 0.055, 0, Math.PI * 2);
      g.fill();
      g.fillRect(x - W * 0.06, H * 0.56, W * 0.12, H * 0.3);
    }
    text(g, 'STELLA☆', W / 2, H * 0.2, `900 ${Math.round(H * 0.11)}px Arial, sans-serif`, '#ffffff');
    text(g, '1st LIVE', W / 2, H * 0.93, `bold ${Math.round(H * 0.06)}px Arial, sans-serif`, '#ffe45f');
  });
  for (let i = 0; i < 3; i++) h.box(0xb8966a, 7.8 - i * 0.05, 8.7, 1.6 + i * 0.03, 2.3, i * 0.4, i * 0.4 + 0.4);
  h.ceilingLight(3.2, 3.8, 'ring', [1.25, 1.25, 1.3]);
  // The bedroom: the bed barely slept in, a suit over the chair, the alarm.
  h.box(0x5a4a3a, 6.4, 8.6, 3.6, 6.35, 0, 0.45);
  h.box(0xf0ece4, 6.45, 8.55, 3.65, 6.3, 0.45, 0.6);
  h.box(0x8a9ab8, 6.5, 8.5, 3.7, 5.4, 0.6, 0.72);
  h.box(0xf8f8f8, 6.8, 8.2, 5.7, 6.2, 0.6, 0.74);
  h.hanging(6.0, 8.6, 1.75, 2.0, [0x2a2a2e, 0x3a2a3a, 0x2a2a2e]);
  h.ceilingLight(7.2, 4.4, 'ring', [1.1, 1.05, 1.0]);
  h.curtains('t0', 6.0, 8.5, 0.9, 2.1, 0x8a8aa0);
  // The balcony: a cheap chair, the AC unit.
  h.box(0xe0dcd4, 7.6, 8.5, 0.2, 0.7, 0, 0.6);
  h.chair(2.2, 0.7, 0xd8d8d8, 't0');
}

// ---- The Stella dorm's lounge (the ground floor of the white block, where the girls come home to) ----
export const DORM_LOUNGE: HomePlan = {
  box: [1.0, 23.0, 1.6, 14.4],
  y: 0.3,
  h: 2.7,
  walls: [],
  solids: [
    [7.8, 9.8, 1.6, 2.0], // the shoe lockers
    [11.4, 13.4, 1.6, 2.0],
    [12.0, 14.0, 3.2, 8.0], // the stair up to the rooms
    [1.0, 1.4, 7.6, 10.6], // the TV
    [5.0, 5.8, 7.2, 11.0], // the sofa and its return
    [2.4, 5.8, 11.0, 11.8],
    [15.0, 20.0, 9.0, 11.5], // the dining table
    [14.0, 22.8, 13.8, 14.4], // the kitchen
    [22.2, 23.0, 12.2, 13.6], // the fridge
  ],
  windows: [
    { side: 't0', a: 2.0, b: 7.0, y0: 0.9, y1: 2.1 },
    { side: 't0', a: 14.5, b: 17.5, y0: 0.9, y1: 2.1 },
    { side: 't1', a: 2.0, b: 10.0, y0: 0.9, y1: 2.1 },
  ],
  door: { side: 't0', a: 10.0, b: 11.2 },
};

function dorm(h: Home): void {
  h.box(0x8a8680, 9.8, 11.4, 1.6, 3.0, 0, 0.02);
  h.boards(0xc8b090, 1.0, 23.0, 3.0, 14.4);
  h.boards(0xc8b090, 1.0, 9.8, 1.6, 3.0);
  h.boards(0xc8b090, 11.4, 23.0, 1.6, 3.0);
  // The genkan: lockers full, a row of sneakers in every colour, the rules on the wall.
  for (const [a, b] of [[7.8, 9.8], [11.4, 13.4]] as const) {
    h.box(0xf0ece4, a, b, 1.6, 2.0, 0, 1.8);
    for (let u = a + 0.05; u < b - 0.1; u += 0.4) for (let y = 0.1; y < 1.7; y += 0.34) h.box(0xe0dcd4, u, u + 0.36, 2.0, 2.01, y, y + 0.3);
  }
  h.shoes(9.9, 2.4, [0xf0a0c0, 0xffffff, 0xa0c8f0]);
  h.shoes(10.3, 2.75, [0xf0e0a0, 0x1a1a1a]);
  h.picture('t0', 12.3, 2.0, 0.7, 0.9, (g, W, H) => {
    printed(g, W, H, '#ffffff', [['寮のルール', '#c81a1a', 0.12], ['門限 22:00', '#1a1a1a', 0.32], ['男子禁制', '#1a1a1a', 0.47], ['恋愛禁止！', '#c81a1a', 0.62], ['SNS 事前確認', '#1a1a1a', 0.77], ['— マネージャー', '#5a5a5a', 0.92]]);
  });
  // The stair to the rooms, its steps rising away.
  for (let i = 0; i < 14; i++) h.box(0xb89a70, 12.0, 14.0, 3.2 + i * 0.34, 8.0, i * 0.19, i * 0.19 + 0.19);
  // The lounge: the big TV (a dance video), the L sofa with cushions, the low table with snacks; two of them home.
  h.tv(1.2, 9.1, 'u1', false, [1.0, 0.6, 1.1]);
  h.box(0xf0e8f0, 5.0, 5.8, 7.2, 11.0, 0, 0.42);
  h.box(0xf0e8f0, 5.5, 5.8, 7.2, 11.0, 0.42, 0.85);
  h.box(0xf0e8f0, 2.4, 5.8, 11.0, 11.8, 0, 0.42);
  h.box(0xf0e8f0, 2.4, 5.8, 11.5, 11.8, 0.42, 0.85);
  for (const [uu, tt, c] of [[5.2, 7.6, 0xff9ac8], [5.2, 9.6, 0xa0d8ff], [3.0, 11.2, 0xffe08a]] as const) h.box(c, uu, uu + 0.4, tt, tt + 0.4, 0.42, 0.72);
  h.box(0xffffff, 2.8, 4.2, 8.4, 9.8, 0.34, 0.38);
  for (let i = 0; i < 4; i++) h.box([0xe8c020, 0xe84a4a, 0x4ac84a][i % 3], 3.0 + i * 0.28, 3.2 + i * 0.28, 8.8, 9.1, 0.38, 0.5);
  h.d.person(5.3, 8.4, -1, 0, { body: 'woman', pose: 'stand', color: [1.0, 0.85, 0.95], hair: 'long', y: 0.3 });
  h.d.person(3.8, 11.3, 0, -1, { body: 'woman', pose: 'phone', color: [0.85, 0.9, 1.0], hair: 'short', y: 0.3 });
  // The dining table (protein shakes, a birthday cake box), the kitchen, the fridge covered in notes.
  h.table(15.0, 20.0, 9.0, 11.5, 0xf0ece4, 0.72);
  for (let i = 0; i < 6; i++) h.chair(15.6 + (i % 3) * 1.9, i < 3 ? 8.6 : 11.9, 0xe8a0b8, i < 3 ? 't0' : 't1');
  for (const uu of [15.6, 16.2, 18.8]) h.box(0xf0f0f0, uu, uu + 0.09, 9.6, 9.69, 0.72, 0.95);
  h.box(0xffd0e0, 17.2, 17.8, 10.0, 10.5, 0.72, 0.95);
  h.kitchen(14.0, 22.8, 13.8, 14.4, 't1', 0xf8f4f0);
  h.fridge(22.2, 23.0, 12.2, 13.6, 1.8, 0xf0f0f0);
  for (let i = 0; i < 6; i++) h.box([0xffe45f, 0xff9ac8, 0xa0d8ff][i % 3], 22.19, 22.2, 12.3 + (i % 3) * 0.4, 12.6 + (i % 3) * 0.4, 0.8 + Math.floor(i / 3) * 0.35, 1.1 + Math.floor(i / 3) * 0.35);
  // The practice corner: the mirror wall, the barre, a speaker.
  h.glow([0.55, 0.6, 0.68], 22.97, 23.0, 1.8, 6.4, 0.1, 2.5);
  h.box(0xc8b090, 22.6, 22.7, 1.8, 6.4, 1.0, 1.05);
  h.box(0x1a1a1a, 21.9, 22.4, 6.6, 7.1, 0, 0.9);
  // The week's schedule on the back wall, plants, the lights.
  h.picture('t1', 12.0, 1.6, 1.8, 0.9, (g, W, H) => printed(g, W, H, '#ffffff', [['今週のスケジュール', '#1a4ac8', 0.15], ['月 レッスン 10:00', '#1a1a1a', 0.35], ['水 握手会 13:00', '#1a1a1a', 0.5], ['土 劇場公演 18:30', '#c81a1a', 0.65], ['日 ベイホール!!', '#c81a1a', 0.8]]));
  h.plant(1.5, 2.2, 1.2);
  h.plant(21.8, 8.0, 1.0);
  for (const [uu, tt] of [[4, 5], [4, 10], [10, 8], [17.5, 5], [17.5, 10.5]] as const) h.ceilingLight(uu, tt, 'ring', [1.3, 1.25, 1.2]);
  h.curtains('t0', 2.0, 7.0, 0.9, 2.1, 0xf0d8e0);
  h.curtains('t0', 14.5, 17.5, 0.9, 2.1, 0xf0d8e0);
}

// ---- コーポ桜 (Sakuragaoka): the teacher's 102 downstairs, the MC's 203 upstairs (the apato's units 2 and 3) ----
export const SAKURA_102: HomePlan = {
  box: [4.65, 8.65, 1.95, 11.85],
  y: 0.3,
  h: 2.4,
  walls: [[4.65, 6.4, 5.2, 5.3], [7.8, 8.65, 5.2, 5.3]],
  solids: [
    [7.05, 8.65, 1.95, 2.55],
    [4.65, 5.25, 1.95, 2.6],
    [4.65, 6.0, 3.2, 5.0],
    [5.2, 7.2, 11.1, 11.85],
    [8.25, 8.65, 6.0, 10.6],
    [4.75, 5.95, 8.4, 10.6],
  ],
  windows: [
    { side: 't0', a: 7.2, b: 8.0, y0: 1.0, y1: 1.7 },
    { side: 't1', a: 5.0, b: 8.3, y0: 0.8, y1: 2.05 },
  ],
  door: { side: 't0', a: 5.8, b: 6.7 },
};

function teacher(h: Home): void {
  h.box(0x6a6660, 5.6, 7.0, 1.95, 2.9, 0, 0.02);
  h.box(0x9a8a6a, 4.65, 8.65, 2.9, 5.25, 0, 0.04);
  h.boards(0x9a7a54, 4.65, 8.65, 5.3, 11.85);
  h.box(0x6a8a9a, 5.9, 8.0, 6.2, 8.8, 0.05, 0.07); // the rug
  h.shoes(5.75, 2.1, [0x5a3a2a, 0xf0f0f0]);
  h.kitchen(7.05, 8.65, 1.95, 2.55, 't0', 0xe8e0d0);
  h.fridge(4.65, 5.25, 1.95, 2.6, 1.3, 0xf0ece4);
  h.closet(4.65, 6.0, 3.2, 5.0, 'u1');
  h.plant(8.3, 2.3, 0.5);
  // The room: the bed made, the kotatsu with red-penned tests, the books, the desk under the window, the class photo.
  h.box(0x8a6a4a, 4.75, 5.95, 8.4, 10.6, 0, 0.38);
  h.box(0xe8e4dc, 4.8, 5.9, 8.45, 10.55, 0.38, 0.5);
  h.box(0xd8b8a0, 4.8, 5.9, 8.9, 10.55, 0.5, 0.58);
  h.kotatsu(6.9, 7.5, 0.8, 0x3a6a5a);
  for (let i = 0; i < 12; i++) h.box(0xf8f8f4, 6.7 + (i % 2) * 0.02, 7.05, 7.25, 7.6, 0.4 + i * 0.006, 0.405 + i * 0.006);
  h.box(0xc81a1a, 7.1, 7.25, 7.35, 7.37, 0.4, 0.42);
  h.box(0xe8e4dc, 7.3, 7.42, 7.7, 7.82, 0.4, 0.5); // the tea
  h.shelf(8.25, 8.65, 6.0, 10.6, 1.9, 0x8a6a4a);
  h.table(5.2, 7.2, 11.1, 11.85, 0x8a6a4a, 0.72);
  h.chair(6.2, 10.6, 0x7a5a3a, 't0');
  h.box(0x2a4a2a, 5.4, 5.7, 11.5, 11.8, 0.72, 0.98); // the school bag
  for (let i = 0; i < 4; i++) h.box(0xf0ece4, 6.2, 6.8, 11.3, 11.7, 0.72 + i * 0.012, 0.73 + i * 0.012);
  h.curtains('t1', 5.0, 8.3, 0.8, 2.05, 0xd8e0c8);
  h.picture('u0', 6.6, 1.6, 0.8, 0.55, (g, W, H) => {
    g.fillStyle = '#e8e4dc';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#2a3a5a';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) {
      g.beginPath();
      g.arc(W * (0.08 + c * 0.105), H * (0.28 + r * 0.22), W * 0.028, 0, Math.PI * 2);
      g.fill();
    }
    text(g, '桜ヶ丘中学校 3年B組', W / 2, H * 0.92, `bold ${Math.round(H * 0.09)}px 'Yu Gothic', sans-serif`, '#3a3a3a');
  });
  h.picture('t0', 5.0, 1.5, 0.45, 0.6, (g, W, H) => printed(g, W, H, '#ffffff', [['時間割', '#1a1a1a', 0.12], ['月 国語 3B', '#1a1a1a', 0.35], ['火 国語 3A', '#1a1a1a', 0.52], ['水 職員会議', '#c81a1a', 0.69], ['木 国語 2C', '#1a1a1a', 0.86]]));
  h.ceilingLight(6.65, 8.4, 'pendant', [1.4, 1.2, 0.9]);
  h.ceilingLight(7.4, 3.6, 'bulb', [1.3, 1.15, 0.9]);
}

export const SAKURA_203: HomePlan = {
  box: [8.95, 12.95, 1.95, 11.85],
  y: 3.0,
  h: 2.4,
  walls: [[8.95, 10.7, 5.2, 5.3], [12.1, 12.95, 5.2, 5.3]],
  solids: [
    [11.35, 12.95, 1.95, 2.55],
    [8.95, 10.3, 3.2, 5.0],
    [9.1, 10.2, 9.2, 10.4],
  ],
  windows: [
    { side: 't0', a: 11.5, b: 12.3, y0: 1.0, y1: 1.7 },
    { side: 't1', a: 9.3, b: 12.6, y0: 0.8, y1: 2.05 },
  ],
  door: { side: 't0', a: 10.1, b: 11.0 },
};

function mcRoom(h: Home): void {
  h.box(0x6a6660, 9.9, 11.3, 1.95, 2.9, 0, 0.02);
  h.box(0x8a7a5a, 8.95, 12.95, 2.9, 5.25, 0, 0.04);
  h.tatami(8.95, 12.95, 5.3, 11.85);
  h.shoes(10.05, 2.1, [0x2a2a2a]);
  h.kitchen(11.35, 12.95, 1.95, 2.55, 't0', 0xd0c8b8);
  h.closet(8.95, 10.3, 3.2, 5.0, 'u1');
  h.box(0x3a7ac8, 9.1, 9.6, 2.1, 2.5, 0, 0.35); // a cooler box (no fridge yet)
  // Just moved in: boxes, the futon rolled up, a konbini bag, the phone charging on the floor, one bare bulb.
  for (const [u0, t0, y0, s] of [[9.1, 9.2, 0, 0.55], [9.65, 9.3, 0, 0.5], [9.2, 9.8, 0, 0.55], [9.3, 9.35, 0.55, 0.45]] as const) {
    h.box(0xb8966a, u0, u0 + s, t0, t0 + s, y0, y0 + s * 0.9);
    h.box(0xd8c8a0, u0 + 0.05, u0 + s - 0.05, t0 + s * 0.45, t0 + s * 0.55, y0 + s * 0.9, y0 + s * 0.9 + 0.005);
  }
  h.box(0x5a6a8a, 11.6, 12.8, 10.6, 11.0, 0.05, 0.45);
  h.box(0xf0f0f0, 10.6, 10.9, 7.0, 7.25, 0.05, 0.35);
  h.box(0x1a1a1a, 11.3, 11.38, 8.2, 8.35, 0.05, 0.06);
  h.glow([0.5, 0.8, 1.2], 11.3, 11.38, 8.2, 8.35, 0.06, 0.065);
  h.box(0x2a2a2a, 12.5, 12.9, 6.0, 7.2, 0.05, 0.3); // a sports bag
  h.ceilingLight(10.95, 8.0, 'bulb', [1.35, 1.15, 0.85]);
  h.picture('t0', 9.5, 1.55, 0.3, 0.42, (g, W, H) => printed(g, W, H, '#ffffff', [['ゴミ出し', '#1a1a1a', 0.2], ['月木 燃える', '#c81a1a', 0.5], ['水 資源', '#1a4ac8', 0.75]]));
}

// ---- 漫画喫茶 月夜 (Kaburo's back alleys): where the MC sleeps for now, booth 17 ----
const BOOTH = 1.2;
export const NET_CAFE: HomePlan = {
  box: [0.6, 15.4, 1.4, 19.4],
  y: 0.05,
  h: 2.6,
  walls: [],
  solids: [
    [10.2, 14.4, 3.0, 3.8], // the reception counter
    [0.6, 3.6, 1.4, 2.1], // the drink bar
    [0.6, 1.0, 3.0, 8.0], // manga shelves
    [3.0, 3.4, 3.5, 8.0],
    [5.0, 5.4, 3.5, 8.0],
    [0.6, 2.6, 9.0, 9.0 + 4 * BOOTH], // bank A (booth 17 open)
    [0.6, 2.6, 9.0 + 5 * BOOTH, 19.4],
    [0.6, 2.6, 9.0 + 4 * BOOTH - 0.05, 9.0 + 4 * BOOTH + 0.05],
    [3.8, 7.8, 9.0, 19.4], // bank B
    [9.2, 13.2, 9.0, 19.4], // bank C
    [14.0, 15.4, 9.0, 13.0], // the showers
  ],
  windows: [],
  door: { side: 't0', a: 6.2, b: 9.8 },
};

function netCafe(h: Home): void {
  h.box(0x2a2830, 0.6, 15.4, 1.4, 19.4, 0, 0.03);
  h.box(0x5a3a6a, 6.2, 9.8, 1.4, 2.6, 0.03, 0.04);
  // Reception: the counter, the clerk, the price board; the drink bar; the manga shelves.
  h.box(0x3a2a4a, 10.2, 14.4, 3.0, 3.8, 0, 1.05);
  h.box(0xe8d8f0, 10.1, 14.5, 2.95, 3.85, 1.05, 1.1);
  h.picture('t0', 12.3, 2.0, 1.6, 0.6, (g, W, H) => printed(g, W, H, '#1a1030', [['3時間 ¥980 · ナイト8h ¥1,480', '#ffe45f', 0.4], ['シャワー ¥300 · ブランケット無料', '#ffffff', 0.8]]));
  h.box(0xe8e8ec, 0.6, 3.6, 1.4, 2.1, 0, 0.9);
  for (let i = 0; i < 6; i++) h.glow([[0.3, 0.2, 0.1], [1.2, 0.5, 0.2], [0.3, 0.8, 0.3]][i % 3] as [number, number, number], 0.8 + i * 0.45, 1.1 + i * 0.45, 2.08, 2.1, 1.1, 1.6);
  h.box(0xd8d8dc, 0.6, 3.6, 1.4, 1.8, 0.9, 1.7);
  h.shelf(0.6, 1.0, 3.0, 8.0, 2.1, 0x3a3a40, [0xe84a4a, 0x4a8ae8, 0xe8c020, 0xf0f0f0, 0x4ac86a, 0xe87ac8]);
  h.shelf(3.0, 3.4, 3.5, 8.0, 1.9, 0x3a3a40, [0xe84a4a, 0x4a8ae8, 0xe8c020, 0xf0f0f0, 0x4ac86a, 0xe87ac8]);
  h.shelf(5.0, 5.4, 3.5, 8.0, 1.9, 0x3a3a40, [0xe84a4a, 0x4a8ae8, 0xe8c020, 0xf0f0f0, 0x4ac86a, 0xe87ac8]);
  // The booths: partitions 1.6 m high, a door each, their PCs glowing over the tops; numbered.
  const booth = (u0: number, u1: number, t0: number, open: 'u0' | 'u1', mine = false): void => {
    const [a, b] = [t0, t0 + BOOTH];
    h.box(0x4a4250, u0, u1, a, a + 0.05, 0, 1.6);
    h.box(0x4a4250, open === 'u1' ? u0 : u1 - 0.05, open === 'u1' ? u0 + 0.05 : u1, a, b, 0, 1.6);
    h.box(0x2a2830, u0 + 0.1, u1 - 0.1, a + 0.1, b - 0.1, 0.03, 0.25);
    const deskU = open === 'u1' ? u0 + 0.05 : u1 - 0.55;
    h.box(0x6a5a4a, deskU, deskU + 0.5, a + 0.1, b - 0.1, 0.25, 0.3);
    h.glow([0.35, 0.5, 0.8], open === 'u1' ? deskU + 0.1 : deskU + 0.38, open === 'u1' ? deskU + 0.12 : deskU + 0.4, a + 0.3, b - 0.3, 0.35, 0.7);
    const doorU = open === 'u1' ? u1 - 0.03 : u0;
    if (!mine) h.box(0x5a5068, doorU, doorU + 0.03, a + 0.1, b - 0.05, 0.05, 1.55);
  };
  for (let i = 0; i < 8; i++) {
    booth(0.6, 2.6, 9.0 + i * BOOTH, 'u1', i === 4);
    booth(3.8, 5.8, 9.0 + i * BOOTH, 'u0');
    booth(5.8, 7.8, 9.0 + i * BOOTH, 'u1');
    booth(9.2, 11.2, 9.0 + i * BOOTH, 'u0');
    booth(11.2, 13.2, 9.0 + i * BOOTH, 'u1');
  }
  // Booth 17, yours: the backpack, a suit in its dry-cleaning bag on the hook, cup noodles, the blanket, the charger.
  const t17 = 9.0 + 4 * BOOTH;
  h.box(0x2a3a2a, 0.8, 1.2, t17 + 0.2, t17 + 0.5, 0.25, 0.7);
  h.box(0x2a2e38, 2.45, 2.55, t17 + 0.8, t17 + 1.1, 0.6, 1.5);
  h.box(0xe8e8f0, 2.42, 2.58, t17 + 0.75, t17 + 1.15, 0.55, 1.55);
  h.box(0xe8e0d0, 1.0, 1.12, t17 + 0.8, t17 + 0.92, 0.3, 0.42);
  h.box(0x8a6aa0, 1.3, 2.3, t17 + 0.2, t17 + 1.0, 0.25, 0.32);
  // The showers along the far wall, a lit sign; fluorescent strips over the aisles; the clerk.
  h.box(0xd8dce0, 14.0, 15.4, 9.0, 13.0, 0, h.p.h);
  h.picture('u1', 11, 1.9, 1.0, 0.3, (g, W, H) => printed(g, W, H, '#1a4ac8', [['シャワー SHOWER', '#ffffff', 0.62]]));
  for (const uu of [3.2, 8.5, 13.6]) for (let t = 4; t < 19; t += 3) h.glow([1.05, 1.1, 1.2], uu - 0.08, uu + 0.08, t, t + 1.2, h.p.h - 0.03, h.p.h);
  h.d.person(8.5, 12.5, 0, 1, { body: 'man', pose: 'walk', color: [0.8, 0.8, 0.85], y: 0.05 });
}

/**
 * The homes by placement: the building's flats (plan, look, furnishing) and the street's own collision under
 * them (the building's exterior colliders).
 */
export const HOMES: Readonly<Record<string, { flats: readonly Flat[]; ground: (b: Building3) => Rect[] }>> = {
  kopo: { flats: [{ plan: KOPO_201, look: { wall: 0xc8bca4, ceiling: 0xb8ae98 }, furnish: detective }], ground: (b) => kawabataColliders('apato', b) },
  nishihara_danchi: { flats: [{ plan: DANCHI_402, look: { wall: 0xe0d8c4, ceiling: 0xe8e4d8 }, furnish: salaryman }], ground: (b) => suburbColliders('danchi', b) },
  manager_flat: { flats: [{ plan: MANAGER_603, look: { wall: 0xf0ece4, ceiling: 0xf4f2ee }, furnish: manager }], ground: (b) => residenceColliders('mansion', b) },
  stella_dorm: { flats: [{ plan: DORM_LOUNGE, look: { wall: 0xf4f0ec, ceiling: 0xf8f6f2 }, furnish: dorm }], ground: (b) => residenceColliders('dorm', b) },
  kopo_sakura: {
    flats: [
      { plan: SAKURA_102, look: { wall: 0xd8d0c0, ceiling: 0xd0c8b8 }, furnish: teacher },
      { plan: SAKURA_203, look: { wall: 0xc8bca4, ceiling: 0xb8ae98 }, furnish: mcRoom },
    ],
    ground: (b) => kawabataColliders('apato', b),
  },
  tsukiyo: { flats: [{ plan: NET_CAFE, look: { wall: 0x3a3440, ceiling: 0x2a2630, floor: 0x2a2830 }, furnish: netCafe }], ground: (b) => residenceColliders('net_cafe', b) },
};

/** A placement's home as an interior (real/interiors.ts), or null. */
export function homeFor(placementId: string): { build: (b: Building3, city: THREE.Material, ghost: THREE.Material) => Generator<void, Interior>; layout: (b: Building3) => Omit<Interior, 'group'>; range: number; keep: true } | null {
  const def = HOMES[placementId];
  if (!def) return null;
  return {
    *build(b, city, ghost) {
      return homeInterior(b, def.flats, city, ghost, def.ground(b));
    },
    layout: (b) => homeLayout(b, def.flats.map((f) => f.plan), def.ground(b)),
    range: 50,
    keep: true,
  };
}

/** A placement's flats as covered volumes (no rain inside them), none if it holds no home. */
export function homeSheltersFor(placementId: string, b: Building3): { rect: Rect; y0: number; y1: number; enclosed: boolean }[] {
  const def = HOMES[placementId];
  return def ? homeShelters(b, def.flats.map((f) => f.plan)) : [];
}
