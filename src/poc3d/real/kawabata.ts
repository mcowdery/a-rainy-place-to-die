import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { addTree } from '../models/trees';
import { addCar } from './cars';
import type { CityUniforms } from './city';
import { Kit, text } from './kit';
import type { Light } from './lightmap';
import { localFrame, localRect, toWorld } from './localFrame';
import { EMIT, KIND, lin } from './meshBuilder';

/**
 * 川端 Kawabata's set pieces (the old town across the river; the whole-city plan: docs/city-plan.md), registered
 * with the kit landmarks (asagiri.ts), in the building's local frame (u along the street face, t inward):
 * - temple: 東光寺 Tōkō-ji (Sensō-ji-like): the thunder gate with its giant red lantern, the Nakamise street of
 *   little shops up to the second gate, the incense burner, the main hall under its sweeping roof, the pagoda.
 * - tv_tower: 東都タワー TŌTO TOWER (Tokyo Tower-like): a 250 m lattice tower in orange and white, two observation
 *   decks, lit at night by lines that show through the haze (the city's compass).
 * - yakuza_house: 竜胆組 本家, the Rindō-gumi's family house: a plastered wall capped in black tile all round, the
 *   heavy gate with the crest's lanterns, black sedans and men in dark suits outside, a pine over the wall.
 * - apato: コーポ川端 Kōpo Kawabata, a worn two-storey wooden apartment block: the outside steel stair, the open
 *   corridor with its doors and washing machines, laundry out, bicycles. The detective lives in 201.
 * - river_walk: the riverside promenade on the embankment: paving, cherry trees, lanterns, food stalls (yatai)
 *   under red lanterns, and houseboats (yakatabune) moored in the river, their lanterns lit at night.
 */
/** The apato kit's name plate, by placement (Kōpo Kawabata, and Kōpo Sakura in Sakuragaoka). */
const APATO_NAMES: Readonly<Record<string, string>> = { kopo: 'コーポ川端', kopo_sakura: 'コーポ桜' };

export const KAWABATA_KINDS = ['temple', 'tv_tower', 'yakuza_house', 'apato', 'river_walk'] as const;
export type KawabataKind = (typeof KAWABATA_KINDS)[number];

type C3 = [number, number, number];

export function kawabataColliders(kind: KawabataKind, b: Building3): Rect[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(f, u0, u1, t0, t1);
  switch (kind) {
    case 'temple': {
      const out = [R(24, 80, 80, 102), R(10, 22, 64, 76), R(49.5, 54.5, 72, 77)];
      // The Nakamise shop rows, the gates' pillars.
      out.push(R(36, 44, 12, 58), R(60, 68, 12, 58));
      for (const [t0, t1] of [[2, 8], [62, 68]] as const) for (const u of [44, 49, 55, 60]) out.push(R(u - 0.6, u + 0.6, t0, t0 + 1.2), R(u - 0.6, u + 0.6, t1 - 1.2, t1));
      // The precinct's wall, open at the front gate.
      out.push(R(0, 40, 0, 0.6), R(64, 104, 0, 0.6), R(0, 0.6, 0, 104), R(103.4, 104, 0, 104), R(0, 104, 103.4, 104));
      return out;
    }
    case 'tv_tower':
      return [R(2, 12, 2, 12), R(68, 78, 2, 12), R(2, 12, 68, 78), R(68, 78, 68, 78), R(30, 50, 30, 50)];
    case 'yakuza_house':
      return [R(0, 20, 0, 0.8), R(28, 48, 0, 0.8), R(0, 0.8, 0, 40), R(47.2, 48, 0, 40), R(0, 48, 39.2, 40), R(20, 28, 2, 3)];
    case 'apato':
      return [R(0, 18, 1.8, 12), R(18, 22, 3, 12)];
    case 'river_walk':
      return [20, 40, 60, 80].flatMap((u) => [R(u - 1, u + 1, 3, 4.6)]);
  }
}

export function kawabataShelters(kind: KawabataKind, b: Building3): { rect: Rect; y0: number; y1: number; enclosed: boolean }[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): { rect: Rect; y0: number; y1: number; enclosed: boolean } => ({ rect: localRect(f, u0, u1, t0, t1), y0, y1, enclosed: false });
  switch (kind) {
    case 'temple':
      return [R(43, 61, 1, 9, 0, 7), R(43, 61, 61, 69, 0, 9), R(36, 44, 10, 58, 0, 3.2), R(60, 68, 10, 58, 0, 3.2)];
    case 'apato':
      return [R(0, 18, 0, 1.8, 0, 3)];
    case 'yakuza_house':
      return [R(20, 28, 0, 3, 0, 3.6)];
    default:
      return [];
  }
}

export function kawabataLights(kind: KawabataKind, b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: C3, i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  const warm: C3 = [1.0, 0.72, 0.45];
  const red: C3 = [1.0, 0.45, 0.3];
  switch (kind) {
    case 'temple':
      return [L(52, 4, 9, red, 0.9), L(52, 20, 8, warm, 0.7), L(52, 40, 8, warm, 0.7), L(52, 65, 9, red, 0.8), L(52, 78, 10, warm, 0.6)];
    case 'tv_tower':
      return [L(40, 40, 22, [1.0, 0.6, 0.3], 0.5)];
    case 'yakuza_house':
      return [L(24, -1, 6, warm, 0.7)];
    case 'apato':
      return [L(9, 0.5, 6, [0.9, 0.95, 1.0], 0.5)];
    case 'river_walk':
      return [20, 40, 60, 80].map((u) => L(u, 4, 7, red, 0.8));
  }
}

function plate(k: Kit, w: number, h: number, u: number, t: number, y: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void, neon = false, facing: 'out' | 'in' | '+u' | '-u' = 'out'): THREE.Mesh {
  const W = Math.round(w * 64);
  const H = Math.round(h * 64);
  return k.plane(k.canvas(W, H, (g) => draw(g, W, H)), w, h, u, t, y, facing, neon ? 1.4 : 1.0, neon);
}

/** A tiled roof over [u0, u1] x [t0, t1] from y: stepped slabs narrowing to the ridge, the eaves swept out. */
function roof(k: Kit, u0: number, u1: number, t0: number, t1: number, y: number, h: number, over = 1.6, hex = 0x3a3c40): void {
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const f = i / steps;
    const inset = (Math.min(u1 - u0, t1 - t0) / 2) * f * 0.85;
    const o = over * (1 - f);
    // The eaves' ends lifted a little (the swept-up corners).
    k.box(hex, u0 - o + inset, u1 + o - inset, t0 - o + inset, t1 + o - inset, y + (h * i) / steps, y + (h * (i + 1)) / steps + 0.05);
  }
  k.box(hex, u0 + (u1 - u0) * 0.2, u1 - (u1 - u0) * 0.2, (t0 + t1) / 2 - 0.3, (t0 + t1) / 2 + 0.3, y + h, y + h + 0.5);
}

/** A red paper lantern on a hanger: a lathe, glowing at night, its name on a plate. */
function lantern(k: Kit, u: number, t: number, y: number, r: number, h: number, name: string | null, facing: 'out' | 'in' = 'out'): void {
  // The paper glows with the light inside it at night (a lit surface: its colour, and part of it light).
  const [x, z] = toWorld(k.f, u, t);
  k.mb.kind = KIND.emit;
  k.mb.style = [EMIT.lit, 0, 0, 0];
  k.mb.color = lin(0xd8321e);
  k.mb.lathe(x, z, [[y - h / 2, r * 0.7], [y - h / 3, r], [y + h / 3, r], [y + h / 2, r * 0.7]], 14);
  k.mb.style = [0, 0, 0, 0];
  k.mb.kind = KIND.plain;
  k.glow([1.4, 0.3, 0.2], u - r * 0.5, u + r * 0.5, t - r * 0.5, t + r * 0.5, y - h / 2 - 0.05, y - h / 2, EMIT.lamp);
  k.box(0x1a1a1a, u - r * 0.72, u + r * 0.72, t - r * 0.72, t + r * 0.72, y + h / 2, y + h / 2 + 0.2);
  k.box(0x1a1a1a, u - r * 0.72, u + r * 0.72, t - r * 0.72, t + r * 0.72, y - h / 2 - 0.2, y - h / 2);
  if (name) {
    plate(k, r * 1.2, h * 0.7, u, t + (facing === 'out' ? -r - 0.02 : r + 0.02), y, (g, W, H) => {
      g.fillStyle = '#d8321e';
      g.fillRect(0, 0, W, H);
      [...name].forEach((c, i) => text(g, c, W / 2, H * ((i + 0.5) / name.length), `bold ${Math.round(Math.min(W * 0.8, (H * 0.9) / name.length))}px 'Yu Mincho', serif`, '#1a0a08'));
    }, false, facing);
  }
}

export const KAWABATA_BUILDERS: Record<KawabataKind, (k: Kit, id: string, part: (name: string) => Kit, u: CityUniforms) => ((camera: THREE.Vector3, dt: number) => void) | void> = {
  // ---- 東光寺 Tōkō-ji: the thunder gate, the Nakamise street, the second gate, the incense burner, the main hall,
  // the five-storey pagoda; the precinct's wall round it all ----
  temple(k) {
    const RED = 0xb8281e;
    const GREY = 0x3a3c40;
    k.kind(KIND.sidewalk, 0xb8b0a0, 0, 104, 0, 104, 0, 0.05);
    for (const [u0, u1, t0, t1] of [[0, 40, 0, 0.6], [64, 104, 0, 0.6], [0, 0.6, 0, 104], [103.4, 104, 0, 104], [0, 104, 103.4, 104]] as const) {
      k.box(0xe8e4d8, u0, u1, t0, t1, 0, 2.4);
      k.box(GREY, u0 - 0.2, u1 + 0.2, t0 - 0.2, t1 + 0.2, 2.4, 2.8);
    }
    // A gate: four red pillars each side, the beams, a two-tier roof, a giant lantern hung in the middle.
    const gate = (t0: number, t1: number, h: number, name: string): void => {
      for (const u of [44, 49, 55, 60]) for (const t of [t0 + 0.6, t1 - 0.6]) k.box(RED, u - 0.5, u + 0.5, t - 0.5, t + 0.5, 0, h);
      k.box(RED, 43.5, 60.5, t0, t1, h - 0.8, h);
      roof(k, 43, 61, t0, t1, h, 2.2, 1.8, GREY);
      roof(k, 44.5, 59.5, t0 + 1, t1 - 1, h + 2.6, 1.8, 1.2, GREY);
      k.box(RED, 45, 59, t0 + 1.2, t1 - 1.2, h + 2.2, h + 2.7);
      lantern(k, 52, (t0 + t1) / 2, h - 2.6, 1.9, 3.4, name);
    };
    gate(2, 8, 7, '東光門');
    gate(62, 68, 9, '宝蔵門');
    // Nakamise: two rows of little shops facing the path, each with its awning and a sign.
    const SHOPS = ['人形焼', '煎餅', '扇子', '雷おこし', '手拭', '甘味', '玩具', '簪', '団子', '和傘', '提灯', '土産'];
    for (const [u0, u1, face] of [[36, 44, 1], [60, 68, -1]] as const) {
      for (let i = 0; i < 12; i++) {
        const t0 = 12 + i * 3.8;
        k.box(0xe8dcc8, u0, u1, t0, t0 + 3.7, 0, 3.2);
        k.box(0x8a2a22, u0, u1, t0, t0 + 3.7, 3.2, 3.5);
        // The shopfront, lit, and an awning over the path.
        const fu = face > 0 ? u1 : u0;
        k.lit(0xfff0d8, fu - 0.02, fu + 0.02, t0 + 0.3, t0 + 3.4, 0.2, 2.6, true);
        k.box(i % 2 ? 0xc83a2a : 0xe8e8e0, face > 0 ? u1 : u0 - 1.2, face > 0 ? u1 + 1.2 : u0, t0, t0 + 3.7, 2.6, 2.75);
        const name = SHOPS[(i + (face > 0 ? 0 : 5)) % SHOPS.length];
        plate(k, 0.6, 1.4, face > 0 ? u1 + 0.02 : u0 - 0.02, t0 + 1.85, 1.9, (g, W, H) => {
          g.fillStyle = '#f4ecd8';
          g.fillRect(0, 0, W, H);
          [...name].forEach((c, j) => text(g, c, W / 2, H * ((j + 0.5) / name.length), `bold ${Math.round(Math.min(W * 0.8, (H * 0.85) / name.length))}px 'Yu Mincho', serif`, '#6a1a12'));
        }, false, face > 0 ? '+u' : '-u');
      }
    }
    // Paper lanterns hung along the path.
    for (let t = 14; t < 58; t += 6) for (const u of [45.5, 58.5]) lantern(k, u, t, 3.3, 0.35, 0.7, null);
    // The incense burner.
    k.lathe(0x5a4a2a, 52, 74.5, [[0, 1.2], [0.9, 1.4], [1.1, 2.2], [2.2, 2.4], [2.4, 1.2], [3.6, 1.0], [4.2, 0.2]], 12);
    // The main hall: a stone base, red columns, the great roof in three tiers.
    k.box(0xb8b0a0, 22, 82, 78, 104, 0, 1.4);
    for (let u = 26; u <= 78; u += 4.4) for (const t of [80, 101]) k.box(RED, u - 0.45, u + 0.45, t - 0.45, t + 0.45, 1.4, 9);
    k.lit(0xf0c080, 25, 79, 81, 81.2, 1.4, 8, false);
    k.box(0x6a2a1e, 24, 80, 80, 102, 9, 10);
    roof(k, 24, 80, 80, 102, 10, 5, 3.2, GREY);
    roof(k, 32, 72, 84, 98, 15.6, 5, 1.6, GREY);
    k.box(0xc8a040, 50, 54, 90.5, 91.5, 21, 22.4);
    for (const u of [34, 70]) lantern(k, u, 79, 6, 0.8, 1.6, null);
    plate(k, 9, 2.2, 52, 79.9, 8.2, (g, W, H) => {
      g.fillStyle = '#2a1a0e';
      g.fillRect(0, 0, W, H);
      text(g, '東光寺', W / 2, H * 0.58, `bold ${Math.round(H * 0.72)}px 'Yu Mincho', serif`, '#e8c860');
    });
    // The five-storey pagoda.
    const PU = 16;
    const PT = 70;
    for (let s = 0; s < 5; s++) {
      const w = 5.6 - s * 0.55;
      const y = 1.2 + s * 5.2;
      k.box(RED, PU - w / 2, PU + w / 2, PT - w / 2, PT + w / 2, y, y + 3.6);
      roof(k, PU - w / 2 - 0.3, PU + w / 2 + 0.3, PT - w / 2 - 0.3, PT + w / 2 + 0.3, y + 3.6, 1.2, 1.4, GREY);
    }
    k.box(0xb8b0a0, PU - 3.2, PU + 3.2, PT - 3.2, PT + 3.2, 0, 1.2);
    k.lathe(0xc8a040, PU, PT, [[27.4, 0.3], [34, 0.12], [34.6, 0.02]], 6);
    // Visitors: along the Nakamise, at the burner, at the hall.
    for (let i = 0; i < 14; i++) {
      const t = 12 + i * 3.4;
      k.person(48 + (i % 3) * 3, t, 0, i % 2 ? 1 : -1, { body: i % 5 === 0 ? 'elder' : i % 2 ? 'woman' : 'man', pose: i % 4 === 0 ? 'talk' : 'walk', color: i % 2 ? [1.0, 0.85, 0.9] : [0.8, 0.88, 1.0], ...(i % 2 ? { hair: 'long' as const } : {}) });
    }
    k.person(50, 73, 1, 0, { body: 'elder', pose: 'stand', color: [0.9, 0.85, 0.8] });
    k.person(54, 76, -1, 0, { body: 'woman', pose: 'stand', color: [1.0, 0.85, 0.9], hair: 'bun' });
  },

  // ---- 東都タワー TŌTO TOWER: four lattice legs rising from the corners of its base, tapering to a single mast;
  // braces across each face; the main deck at 110 m, the upper deck at 200 m, the antenna to 250 m; banded orange
  // and white. At night its outline glows (lines that show through the haze), the decks lit ----
  tv_tower(k, _id, _part, u) {
    const ORANGE = 0xe04a1a;
    const WHITE = 0xece8e0;
    const C = 40;
    const H = 230;
    // Half-width of the tower at height y (a curved taper: wide at the foot, slender above the decks).
    const half = (y: number): number => 36 * Math.pow(1 - y / H, 1.8) + 2.2;
    const band = (y: number): number => (Math.floor(y / 20) % 2 ? WHITE : ORANGE);
    const mb = k.mb;
    const beam = (a: THREE.Vector3, b: THREE.Vector3, r: number, hex: number): void => {
      // Two crossed ribbons along a-b, both faces (a lattice member from any side).
      const d = new THREE.Vector3().subVectors(b, a);
      const side = new THREE.Vector3(-d.z, 0, d.x).normalize().multiplyScalar(r);
      const up = new THREE.Vector3().crossVectors(d, side).normalize().multiplyScalar(r);
      mb.kind = KIND.plain;
      mb.color = lin(hex);
      for (const w of [side, up]) {
        const c: [number, number, number] = [a.x - w.x, a.y - w.y, a.z - w.z];
        mb.quad(c, [d.x, d.y, d.z], [w.x * 2, w.y * 2, w.z * 2]);
        mb.quad(c, [w.x * 2, w.y * 2, w.z * 2], [d.x, d.y, d.z]);
      }
    };
    const P = (uu: number, y: number, t: number): THREE.Vector3 => {
      const [x, z] = toWorld(k.f, uu, t);
      return new THREE.Vector3(x, y, z);
    };
    const corner = (i: number, y: number): THREE.Vector3 => {
      const h = half(y);
      const s = [[-1, -1], [1, -1], [1, 1], [-1, 1]][i];
      return P(C + s[0] * h, y, C + s[1] * h);
    };
    const lines: number[] = [];
    const line = (a: THREE.Vector3, b: THREE.Vector3): void => void lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const STEP = 10;
    for (let y = 0; y < H; y += STEP) {
      const y1 = Math.min(H, y + STEP);
      for (let i = 0; i < 4; i++) {
        const a = corner(i, y);
        const b = corner(i, y1);
        beam(a, b, y < 60 ? 1.1 : 0.7, band(y));
        line(a, b);
        // A brace across each face (alternating diagonals), and a ring every other step.
        const n = (i + 1) % 4;
        beam(corner(i, y), corner(n, y1), 0.3, band(y));
        if ((y / STEP) % 2 === 0) beam(corner(i, y1), corner(n, y1), 0.35, band(y));
      }
    }
    // The feet on their plinths.
    for (let i = 0; i < 4; i++) {
      const c = corner(i, 0);
      const [cu, ct] = [[6, 6], [74, 6], [74, 74], [6, 74]][i];
      k.box(0x9a9a94, cu - 5, cu + 5, ct - 5, ct + 5, 0, 3);
      void c;
    }
    // The decks: the main deck at 110 m (two floors of glass round the tower), the upper deck at 200 m.
    const deck = (y: number, w: number, h: number): void => {
      k.box(0xd8d8d0, C - w, C + w, C - w, C + w, y - 0.6, y);
      k.lit(0xffe8c8, C - w + 0.2, C + w - 0.2, C - w + 0.2, C + w - 0.2, y, y + h, false);
      k.box(0xd8d8d0, C - w, C + w, C - w, C + w, y + h, y + h + 0.8);
    };
    deck(110, 13, 7);
    deck(200, 6.5, 4);
    // The mast and the antenna.
    k.box(ORANGE, C - 1.6, C + 1.6, C - 1.6, C + 1.6, H, H + 12);
    k.box(WHITE, C - 0.6, C + 0.6, C - 0.6, C + 0.6, H + 12, H + 24);
    k.glow([3, 0.2, 0.15], C - 0.8, C + 0.8, C - 0.8, C + 0.8, H + 24, H + 25, EMIT.always);
    // The base building (the Foot Town of shops) and its sign.
    k.facade(0xd8d4cc, [3, 0.5, 1.6, 1], 1 + 2 * 2, 30, 50, 30, 50, 0, 12, false);
    plate(k, 18, 2.4, 40, -0.1, 5, (g, W, H2) => {
      g.fillStyle = '#e04a1a';
      g.fillRect(0, 0, W, H2);
      text(g, '東都タワー TŌTO TOWER', W / 2, H2 * 0.6, `bold ${Math.round(H2 * 0.5)}px 'Yu Gothic', sans-serif`, '#ffffff');
    });
    // The night outline: orange lines up the legs and round the decks, not fogged (they glow through the haze).
    for (const y of [110, 117, 200, 204]) {
      for (let i = 0; i < 4; i++) {
        const w = y < 150 ? 13 : 6.5;
        const s = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        line(P(C + s[i][0] * w, y, C + s[i][1] * w), P(C + s[(i + 1) % 4][0] * w, y, C + s[(i + 1) % 4][1] * w));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(1.6, 0.7, 0.25), fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.LineSegments(geo, mat);
    glow.frustumCulled = false;
    k.group.add(glow);
    return () => {
      const on = u.uLamps.value;
      glow.visible = on > 0.05;
      mat.opacity = on;
    };
  },

  // ---- 竜胆組 本家: the plastered wall capped in black tile all round, the heavy gate with its crest lanterns, the
  // pine over the wall, the house's big tiled roof behind; black sedans and the men outside ----
  yakuza_house(k) {
    const PLASTER = 0xe8e2d4;
    const TILE = 0x26282c;
    for (const [u0, u1, t0, t1] of [[0, 20, 0, 0.8], [28, 48, 0, 0.8], [0, 0.8, 0, 40], [47.2, 48, 0, 40], [0, 48, 39.2, 40]] as const) {
      k.box(0x5a5a58, u0, u1, t0, t1, 0, 0.6);
      k.box(PLASTER, u0, u1, t0, t1, 0.6, 2.9);
      k.box(TILE, u0 - 0.3, u1 + 0.3, t0 - 0.3, t1 + 0.3, 2.9, 3.4);
    }
    // The gate: dark wood posts, the doors shut, the gate's own roof, a lantern each side with the crest.
    for (const uu of [20, 27.4]) k.box(0x3a2a1e, uu, uu + 0.6, 0, 3, 0, 3.4);
    k.box(0x4a3424, 20.6, 27.4, 1.3, 1.6, 0, 3.0);
    for (const uu of [22.2, 25.8]) k.box(0x2a1e14, uu - 0.05, uu + 0.05, 1.25, 1.3, 0.3, 2.8);
    roof(k, 19.5, 28.5, -0.4, 3.4, 3.4, 1.4, 1.2, TILE);
    for (const uu of [18.6, 29.4]) {
      k.post(0x2a2a2a, uu, -0.6, 0, 2.2, 0.05, 6);
      k.lathe(0xf4ecd8, uu, -0.6, [[2.2, 0.25], [2.4, 0.35], [2.9, 0.35], [3.1, 0.25]], 10);
      k.glow([1.3, 1.0, 0.7], uu - 0.2, uu + 0.2, -0.8, -0.4, 2.3, 3.0, EMIT.lamp);
    }
    plate(k, 1.1, 3, 29.2, -0.05, 1.6, (g, W, H) => {
      g.fillStyle = '#d8ccb0';
      g.fillRect(0, 0, W, H);
      const s = '竜胆組';
      [...s].forEach((c, i) => text(g, c, W / 2, H * ((i + 0.5) / s.length), `bold ${Math.round(Math.min(W * 0.8, (H * 0.9) / s.length))}px 'Yu Mincho', serif`, '#1a1a1a'));
    }, false);
    // The house behind: plaster and dark timber, a big hipped roof; the pine leaning over the wall.
    k.box(PLASTER, 8, 40, 12, 34, 0, 4.2);
    for (let uu = 8; uu <= 40; uu += 3.2) k.box(0x3a2a1e, uu - 0.12, uu + 0.12, 11.9, 12, 0, 4.2);
    roof(k, 8, 40, 12, 34, 4.2, 4.2, 2.2, TILE);
    addTree(k.mb, { ...(() => { const [x, z] = toWorld(k.f, 38, 6); return { x, z }; })(), species: 'pine', size: 1.1, seed: 7 });
    // Outside: two black sedans at the kerb, the men in dark suits.
    for (const [uu, v] of [[10, 1], [36, 2]] as const) {
      const [x, z] = toWorld(k.f, uu, -5);
      k.mb.kind = KIND.plain;
      addCar(k.mb, { x, z, fx: k.f.r[0], fz: k.f.r[2], variant: 60 + v, type: 'luxury', paint: 0x0c0c0e });
    }
    k.person(18.4, -1.6, 0, -1, { body: 'man', pose: 'pockets', color: [0.55, 0.55, 0.65] });
    k.person(31, -2.4, -1, 0, { body: 'man', pose: 'stand', color: [0.55, 0.55, 0.65] });
  },

  // ---- コーポ川端: a worn two-storey wooden apartment block. The outside steel stair up the east end, the open
  // corridor along the front of the upper floor with four doors, washing machines, laundry on the rail, bicycles ----
  apato(k, id) {
    const WALL = 0xc8b8a0;
    k.facade(WALL, [4.5, 0.25, 1.1, 4], 256 + 128, 0, 18, 1.8, 12, 0, 5.8, true);
    k.box(0x5a5048, -0.3, 18.3, 1.5, 12.3, 5.8, 6.2);
    // The open corridor on the upper floor, its rail, the doors along it.
    k.box(0x7a7064, 0, 18, 0, 1.8, 2.8, 3.0);
    k.box(0x9a8a6a, 0, 18, 0, 0.08, 3.0, 4.0);
    for (let i = 0; i < 4; i++) {
      const uu = 1.5 + i * 4.3;
      k.box(0x6a5a48, uu, uu + 0.9, 1.75, 1.8, 3.0, 5.0);
      k.box(0xe8e8e0, uu + 1.3, uu + 2.0, 1.2, 1.75, 3.0, 3.9);
      k.box(0x6a5a48, uu, uu + 0.9, 1.75, 1.8, 0, 2.0);
      k.glow([1.2, 1.1, 0.9], uu + 1.1, uu + 1.3, 1.7, 1.75, 4.6, 4.8, EMIT.lamp);
    }
    // Laundry on the rail.
    for (let uu = 2; uu < 16; uu += 1.1) k.box([0xf0f0f0, 0x8ab0d8, 0xe8c8a0, 0xd88a8a][Math.floor(uu) % 4], uu, uu + 0.8, -0.05, 0.05, 3.2, 3.9);
    // The steel stair at the east end.
    for (let s = 0; s < 14; s++) k.box(0x6a6e72, 18.2, 20.8, 11.4 - s * 0.62, 12 - s * 0.62, 2.9 - s * 0.2, 3.0 - s * 0.2);
    k.box(0x6a6e72, 18, 21, 1.6, 3.6, 2.8, 3.0);
    for (const t of [3, 11.8]) k.box(0x4a4e52, 20.6, 20.8, t - 0.1, t + 0.1, 0, 3.8);
    plate(k, 3.2, 0.8, 9, 1.75, 5.2, (g, W, H) => {
      g.fillStyle = '#e8e0cc';
      g.fillRect(0, 0, W, H);
      text(g, APATO_NAMES[id] ?? 'コーポ', W / 2, H * 0.6, `bold ${Math.round(H * 0.6)}px 'Yu Gothic', sans-serif`, '#3a2a1a');
    });
    // Bicycles by the ground floor.
    for (const uu of [2, 3.2, 12]) {
      const [x, z] = toWorld(k.f, uu, 0.8);
      void x;
      void z;
      k.box(0x2a2a2e, uu - 0.05, uu + 0.05, 0.3, 1.9, 0.3, 1.0);
      k.lathe(0x1a1a1a, uu, 0.6, [[0, 0.34], [0.02, 0.34]], 10);
      k.lathe(0x1a1a1a, uu, 1.6, [[0, 0.34], [0.02, 0.34]], 10);
    }
  },

  // ---- The riverside walk: paving on the embankment, cherry trees, lanterns, food stalls under red lanterns, and
  // houseboats moored in the river beside it (out over the water: t < 0) ----
  river_walk(k) {
    k.kind(KIND.sidewalk, 0xa89e8c, 0, 100, -9.6, 22, 0, 0.12);
    k.box(0x8a8478, 0, 100, -10, -9.6, -1.6, 0.9);
    k.box(0x6a6e72, 0, 100, -9.9, -9.7, 0.9, 1.1);
    for (let uu = 4; uu < 100; uu += 12) {
      const [x, z] = toWorld(k.f, uu, 14);
      addTree(k.mb, { x, z, species: uu % 24 < 12 ? 'sakuraBloom' : 'sakura', size: 0.8, seed: uu });
      k.post(0x3a3a3a, uu + 6, -8.8, 0, 3.2, 0.06, 6);
      k.lathe(0xf4ecd8, uu + 6, -8.8, [[3.2, 0.2], [3.35, 0.28], [3.75, 0.28], [3.9, 0.2]], 10);
      k.glow([1.3, 1.0, 0.7], uu + 5.85, uu + 6.15, -8.95, -8.65, 3.3, 3.8, EMIT.lamp);
    }
    // The yatai: a cart, a roof, noren, red lanterns, stools and a customer or two.
    const NAMES = ['おでん', 'ラーメン', '焼鳥', 'たこ焼'];
    [20, 40, 60, 80].forEach((uu, i) => {
      k.box(0x8a5a32, uu - 1, uu + 1, 3, 4.6, 0, 1.0);
      k.box(0xd8c8a8, uu - 1.1, uu + 1.1, 2.9, 4.7, 1.0, 1.08);
      for (const du of [-1, 1]) k.box(0x5a3a22, uu + du * 0.95 - 0.05, uu + du * 0.95 + 0.05, 4.4, 4.5, 1.0, 2.3);
      k.box(0x5a3a22, uu - 1.2, uu + 1.2, 2.6, 4.8, 2.3, 2.4);
      k.box(0xe8dcc0, uu - 1.1, uu + 1.1, 2.75, 2.8, 1.7, 2.3);
      for (const du of [-0.8, 0.8]) lantern(k, uu + du, 2.6, 1.95, 0.22, 0.45, null);
      plate(k, 1.8, 0.45, uu, 2.72, 2.05, (g, W, H) => {
        g.fillStyle = '#a8201a';
        g.fillRect(0, 0, W, H);
        text(g, NAMES[i], W / 2, H * 0.6, `bold ${Math.round(H * 0.7)}px 'Yu Gothic', sans-serif`, '#ffffff');
      });
      for (const du of [-0.7, 0.7]) k.box(0x6a4a2a, uu + du - 0.2, uu + du + 0.2, 2.1, 2.5, 0, 0.5);
      k.person(uu - 0.7, 2.2, 0, 1, { body: i % 2 ? 'man' : 'woman', pose: 'stand', color: [0.9, 0.85, 1.0], ...(i % 2 ? {} : { hair: 'bun' as const }) });
    });
    // The houseboats (yakatabune) moored along the embankment in the river: a low hull, the long cabin with its
    // roof, windows lit, a row of red lanterns along the eaves.
    for (const [u0, u1] of [[6, 30], [40, 64], [74, 96]] as const) {
      const t0 = -18;
      const t1 = -12.5;
      k.box(0x3a2a22, u0, u1, t0, t1, -2.4, -0.9);
      k.box(0x6a4a32, u0 + 1.5, u1 - 1.5, t0 + 0.5, t1 - 0.5, -0.9, 1.3);
      k.glow([1.4, 1.1, 0.7], u0 + 2, u1 - 2, t1 - 0.52, t1 - 0.48, -0.5, 0.9, EMIT.lamp);
      k.glow([1.4, 1.1, 0.7], u0 + 2, u1 - 2, t0 + 0.48, t0 + 0.52, -0.5, 0.9, EMIT.lamp);
      roof(k, u0 + 1.2, u1 - 1.2, t0 + 0.3, t1 - 0.3, 1.3, 0.8, 0.5, 0x2a2a2e);
      for (let uu = u0 + 2; uu < u1 - 1.5; uu += 1.6) k.glow([2.2, 0.35, 0.2], uu - 0.2, uu + 0.2, t1 - 0.35, t1 - 0.05, 0.6, 1.1, EMIT.lamp);
      plate(k, 5, 0.9, (u0 + u1) / 2, t1 - 0.2, 1.8, (g, W, H) => {
        g.fillStyle = '#f4ecd8';
        g.fillRect(0, 0, W, H);
        text(g, '屋形船 川端丸', W / 2, H * 0.6, `bold ${Math.round(H * 0.6)}px 'Yu Mincho', serif`, '#6a1a12');
      }, false, 'out');
    }
  },
};
