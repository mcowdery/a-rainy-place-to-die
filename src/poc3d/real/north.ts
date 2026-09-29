import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { Kit, neonText, text } from './kit';
import type { Light } from './lightmap';
import { localFrame, localRect, toWorld } from './localFrame';
import { EMIT, KIND } from './meshBuilder';

/**
 * The north's set pieces (the whole-city plan: docs/city-plan.md), registered with the kit landmarks (asagiri.ts),
 * in the building's local frame (u along the street face, t inward):
 * - university: 東都大学 大講堂, Tōto University's auditorium: a brick hall with arched windows and its clock tower.
 * - school: a Japanese school (the kit for every school: School No. 1 in Sakuragaoka, the university's affiliated
 *   high school in Gakuenzaka): the four-storey classroom block with its clock, the gym beside it, the pool on the
 *   roof, and the dirt sports field behind a tall netted fence, with its track, goals and baseball backstop.
 * - dome: 東都ドーム TŌTO DOME, the big concert venue: the white air-supported roof on its ring, the gates, the
 *   screen over the plaza with tonight's show.
 * - amusement: 水道町ワンダーランド, the amusement park beside the dome: the rollercoaster (its train running the
 *   track, slow up the lift hill and fast down the drops) and the drop tower.
 */
export const NORTH_KINDS = ['university', 'school', 'dome', 'amusement'] as const;
export type NorthKind = (typeof NORTH_KINDS)[number];

type C3 = [number, number, number];

/** The school kit's plan: the classroom block, the gym, the field. */
const SCHOOL = { block: [4, 70, 3, 19], gym: [74, 100, 3, 27], field: [2, 98, 32, 98] } as const;

export function northColliders(kind: NorthKind, b: Building3): Rect[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(f, u0, u1, t0, t1);
  switch (kind) {
    case 'university':
      return [R(0, 24, 6, 44), R(46, 70, 6, 44), R(24, 46, 10, 44)];
    case 'school': {
      const [fu0, fu1, ft0, ft1] = SCHOOL.field;
      // The block and the gym; the field's fence all round but for its gate (u 44..54 on the near side).
      return [R(SCHOOL.block[0], SCHOOL.block[1], SCHOOL.block[2], SCHOOL.block[3]), R(SCHOOL.gym[0], SCHOOL.gym[1], SCHOOL.gym[2], SCHOOL.gym[3]), R(fu0, 44, ft0 - 0.2, ft0 + 0.2), R(54, fu1, ft0 - 0.2, ft0 + 0.2), R(fu0, fu1, ft1 - 0.2, ft1 + 0.2), R(fu0 - 0.2, fu0 + 0.2, ft0, ft1), R(fu1 - 0.2, fu1 + 0.2, ft0, ft1)];
    }
    case 'dome': {
      // The ring, as a polygon of rects, open at the four gates.
      const out: Rect[] = [];
      const c = 52;
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        if (Math.abs(Math.sin(a * 2)) < 0.12) continue;
        const u = c + Math.cos(a) * 47;
        const t = c + Math.sin(a) * 47;
        out.push(R(u - 4.5, u + 4.5, t - 4.5, t + 4.5));
      }
      out.push(R(c - 38, c + 38, c - 38, c + 38));
      return out;
    }
    case 'amusement':
      return [R(78, 86, 60, 68), R(8, 30, 6, 16)];
  }
}

export function northShelters(kind: NorthKind, b: Building3): { rect: Rect; y0: number; y1: number; enclosed: boolean }[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): { rect: Rect; y0: number; y1: number; enclosed: boolean } => ({ rect: localRect(f, u0, u1, t0, t1), y0, y1, enclosed: false });
  switch (kind) {
    case 'university':
      return [R(26, 44, 0, 10, 0, 6)];
    case 'dome':
      return [R(40, 64, -2, 6, 0, 5)];
    default:
      return [];
  }
}

export function northLights(kind: NorthKind, b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: C3, i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  const warm: C3 = [1.0, 0.82, 0.6];
  const cool: C3 = [0.85, 0.92, 1.0];
  switch (kind) {
    case 'university':
      return [L(35, -2, 10, warm, 0.7)];
    case 'school':
      return [L(49, 30, 8, cool, 0.4), L(37, -1, 6, warm, 0.5)];
    case 'dome':
      return [L(52, -6, 16, [0.9, 0.7, 1.0], 0.8), L(52, 2, 10, cool, 0.7)];
    case 'amusement':
      return [L(50, 50, 18, [1.0, 0.7, 0.9], 0.6), L(19, 2, 8, warm, 0.7)];
  }
}

function plate(k: Kit, w: number, h: number, u: number, t: number, y: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void, neon = false): THREE.Mesh {
  const W = Math.round(w * 64);
  const H = Math.round(h * 64);
  return k.plane(k.canvas(W, H, (g) => draw(g, W, H)), w, h, u, t, y, 'out', neon ? 1.4 : 1.0, neon);
}

/** A clock face (canvas): hands at ten past ten, the way a clock on a building is always photographed. */
function clockFace(k: Kit, d: number, u: number, t: number, y: number): void {
  plate(k, d, d, u, t, y, (g, W) => {
    g.fillStyle = '#f4f0e4';
    g.beginPath();
    g.arc(W / 2, W / 2, W * 0.48, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2a2a2a';
    g.lineWidth = W * 0.04;
    g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.fillStyle = '#2a2a2a';
      g.fillRect(W / 2 + Math.sin(a) * W * 0.38 - W * 0.015, W / 2 - Math.cos(a) * W * 0.38 - W * 0.04, W * 0.03, W * 0.08);
    }
    g.lineCap = 'round';
    g.lineWidth = W * 0.05;
    g.beginPath();
    g.moveTo(W / 2, W / 2);
    g.lineTo(W / 2 + Math.sin(-Math.PI / 6 * 1.7) * W * 0.24, W / 2 - Math.cos(-Math.PI / 6 * 1.7) * W * 0.24);
    g.stroke();
    g.lineWidth = W * 0.03;
    g.beginPath();
    g.moveTo(W / 2, W / 2);
    g.lineTo(W / 2 + Math.sin(Math.PI / 3) * W * 0.34, W / 2 - Math.cos(Math.PI / 3) * W * 0.34);
    g.stroke();
  });
}

const SCHOOL_NAMES: Record<string, [string, string]> = {
  school_1: ['東都市立 桜ヶ丘中学校', 'SAKURAGAOKA JUNIOR HIGH'],
  school_2: ['東都大学附属高等学校', 'TŌTO UNIVERSITY HIGH SCHOOL'],
};

export const NORTH_BUILDERS: Record<NorthKind, (k: Kit, id: string) => ((camera: THREE.Vector3, dt: number) => void) | void> = {
  // ---- 東都大学 大講堂: the brick auditorium with arched windows along its wings, stone steps up to the entrance,
  // and the clock tower rising over the middle, a clock on each face and a spire on top ----
  university(k) {
    const BRICK = 0x8a4a36;
    const STONE = 0xd8d0c0;
    k.facade(BRICK, [3.2, 0.45, 2.6, 0], 1 + 2 * 2 + 128, 0, 24, 6, 44, 0, 18, true);
    k.facade(BRICK, [3.2, 0.45, 2.6, 0], 1 + 2 * 2 + 128, 46, 70, 6, 44, 0, 18, true);
    k.facade(BRICK, [4, 0.4, 3.2, 0], 1 + 2 * 2 + 128, 24, 46, 10, 44, 0, 22, true);
    for (const [u0, u1] of [[0, 24], [46, 70], [24, 46]] as const) k.box(0x5a3a2e, u0 - 0.3, u1 + 0.3, 5.7, 44.3, u0 === 24 ? 22 : 18, (u0 === 24 ? 22 : 18) + 1.2);
    // The entrance: stone steps and a portico.
    for (let i = 0; i < 5; i++) k.box(STONE, 26, 44, 4 + i * 1.2, 10, 0, 0.3 + i * 0.3);
    for (const u of [28, 32, 38, 42]) k.box(STONE, u - 0.6, u + 0.6, 4.2, 5.4, 1.5, 9);
    k.box(STONE, 26, 44, 3.8, 10, 9, 10.2);
    k.lit(0xf0e0c0, 27, 43, 9.9, 10, 1.5, 8.5, false);
    // The clock tower: its shaft, the clock stage, the belfry, the spire.
    const TU = 35;
    const TT = 20;
    k.box(BRICK, TU - 5, TU + 5, TT - 5, TT + 5, 22, 44);
    k.box(STONE, TU - 5.5, TU + 5.5, TT - 5.5, TT + 5.5, 44, 45);
    k.box(BRICK, TU - 4.5, TU + 4.5, TT - 4.5, TT + 4.5, 45, 52);
    clockFace(k, 6, TU, TT - 4.55, 48.5);
    k.box(STONE, TU - 5, TU + 5, TT - 5, TT + 5, 52, 53);
    for (const [du, dt] of [[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6]] as const) k.box(STONE, TU + du - 0.6, TU + du + 0.6, TT + dt - 0.6, TT + dt + 0.6, 53, 58);
    k.box(STONE, TU - 4.5, TU + 4.5, TT - 4.5, TT + 4.5, 58, 59);
    k.lathe(0x3a5a4a, TU, TT, [[59, 4.4], [66, 1.2], [70, 0.05]], 8);
    k.glow([3, 0.2, 0.15], TU - 0.3, TU + 0.3, TT - 0.3, TT + 0.3, 70, 70.6, EMIT.always);
    plate(k, 16, 1.4, 35, 3.7, 11.2, (g, W, H) => {
      g.fillStyle = '#e8e0cc';
      g.fillRect(0, 0, W, H);
      text(g, '東都大学 大講堂', W / 2, H * 0.6, `bold ${Math.round(H * 0.62)}px 'Yu Mincho', serif`, '#3a2a1a');
    });
    k.person(30, -3, 0, 1, { body: 'woman', pose: 'walk', color: [1.0, 0.85, 0.8], hair: 'long' });
    k.person(40, -5, -1, 0, { body: 'man', pose: 'phone', color: [0.8, 0.85, 1.0] });
    k.person(22, -8, 1, 0, { body: 'man', pose: 'walk', color: [0.85, 0.9, 0.8] });
  },

  // ---- A Japanese school: the classroom block (four floors, a clock over the entrance, the name by the gate),
  // the gym, the rooftop pool behind its fence, and the sports field behind a tall netted fence ----
  school(k, id) {
    const [bu0, bu1, bt0, bt1] = SCHOOL.block;
    const [gu0, gu1, gt0, gt1] = SCHOOL.gym;
    const [fu0, fu1, ft0, ft1] = SCHOOL.field;
    k.facade(0xe8e4d8, [3.4, 0.55, 1.8, 0], 1 + 1 * 2, bu0, bu1, bt0, bt1, 0, 16, true);
    k.box(0xc8c4b8, bu0 - 0.2, bu1 + 0.2, bt0 - 0.2, bt1 + 0.2, 16, 17);
    clockFace(k, 2.6, (bu0 + bu1) / 2, bt0 - 0.05, 14);
    // The rooftop pool behind its fence.
    k.box(0x9aa0a6, bu0 + 20, bu0 + 45, bt0 + 3, bt1 - 3, 17, 17.6);
    k.glow([0.2, 0.8, 1.2], bu0 + 21, bu0 + 44, bt0 + 4, bt1 - 4, 17.55, 17.65, EMIT.always);
    for (const [u0, u1, t0, t1] of [[bu0 + 19.5, bu0 + 45.5, bt0 + 2.5, bt0 + 2.7], [bu0 + 19.5, bu0 + 45.5, bt1 - 2.7, bt1 - 2.5], [bu0 + 19.5, bu0 + 19.7, bt0 + 2.5, bt1 - 2.5], [bu0 + 45.3, bu0 + 45.5, bt0 + 2.5, bt1 - 2.5]] as const) k.box(0x7a9a8a, u0, u1, t0, t1, 17, 19);
    // The gym: a big hall with a shallow roof.
    k.facade(0xc8ccd0, [4, 0.25, 1.4, 1], 0, gu0, gu1, gt0, gt1, 0, 11, false);
    k.box(0x5a6a7a, gu0 - 0.4, gu1 + 0.4, gt0 - 0.4, gt1 + 0.4, 11, 11.8);
    k.box(0x5a6a7a, gu0, gu1, gt0 + 4, gt1 - 4, 11.8, 12.8);
    plate(k, 8, 1.2, (gu0 + gu1) / 2, gt0 - 0.05, 9, (g, W, H) => {
      g.fillStyle = '#f4f4f0';
      g.fillRect(0, 0, W, H);
      text(g, '体育館 GYM', W / 2, H * 0.6, `bold ${Math.round(H * 0.6)}px 'Yu Gothic', sans-serif`, '#1a3a6a');
    });
    // The gate and the school's name on the gatepost.
    const [jp, en] = SCHOOL_NAMES[id] ?? ['東都市立中学校', 'TŌTO MUNICIPAL SCHOOL'];
    for (const u of [-3, 3]) k.box(0xa8a49a, 37 + u - 0.5, 37 + u + 0.5, -1, 0, 0, 2.2);
    plate(k, 1.2, 4, 33.5, -1.05, 1.9, (g, W, H) => {
      g.fillStyle = '#e8e4d8';
      g.fillRect(0, 0, W, H);
      [...jp].forEach((c, i) => text(g, c, W / 2, H * (0.06 + (i * 0.9) / jp.length), `bold ${Math.round(Math.min(W * 0.7, (H * 0.85) / jp.length))}px 'Yu Mincho', serif`, '#1a1a1a'));
    });
    plate(k, 10, 1.1, (bu0 + bu1) / 2, bt0 - 0.05, 4.9, (g, W, H) => {
      g.fillStyle = '#1a3a2a';
      g.fillRect(0, 0, W, H);
      text(g, en, W / 2, H * 0.6, `bold ${Math.round(H * 0.5)}px Arial, sans-serif`, '#f4f0e4');
    });
    // The field: packed earth, the track round it, the goals, the baseball backstop in the far corner.
    k.kind(KIND.gravel, 0xb89a70, fu0, fu1, ft0, ft1, 0, 0.04);
    const cu = (fu0 + fu1) / 2;
    const ct = (ft0 + ft1) / 2;
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const u = cu + Math.cos(a) * 40;
      const t = ct + Math.sin(a) * 26;
      k.box(0xf4f4ec, u - 0.5, u + 0.5, t - 0.5, t + 0.5, 0.04, 0.06);
    }
    for (const u of [cu - 30, cu + 30]) {
      k.box(0xf4f4f4, u - 0.06, u + 0.06, ct - 3.6, ct - 3.5, 0, 2.4);
      k.box(0xf4f4f4, u - 0.06, u + 0.06, ct + 3.5, ct + 3.6, 0, 2.4);
      k.box(0xf4f4f4, u - 0.06, u + 0.06, ct - 3.6, ct + 3.6, 2.35, 2.45);
    }
    k.box(0x6a6e72, fu1 - 14, fu1 - 13.8, ft1 - 14, ft1 - 2, 0, 7);
    k.box(0x6a6e72, fu1 - 14, fu1 - 2, ft1 - 14, ft1 - 13.8, 0, 7);
    // The netted fence round the field (tall posts, the net a haze), open at the gate.
    const post = (u: number, t: number): void => k.box(0x7a8086, u - 0.1, u + 0.1, t - 0.1, t + 0.1, 0, 8);
    for (let u = fu0; u <= fu1; u += 6) {
      post(u, ft1);
      if (u < 44 || u > 54) post(u, ft0);
    }
    for (let t = ft0; t <= ft1; t += 6) {
      post(fu0, t);
      post(fu1, t);
    }
    const net = new THREE.MeshBasicMaterial({ color: 0x3a5a4a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
    const netPlane = (u0: number, t0: number, u1: number, t1: number): void => {
      const [ax, az] = toWorld(k.f, u0, t0);
      const [bx, bz] = toWorld(k.f, u1, t1);
      const L = Math.hypot(bx - ax, bz - az);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(L, 8), net);
      m.position.set((ax + bx) / 2, 4, (az + bz) / 2);
      m.rotation.y = Math.atan2(-(bz - az), bx - ax);
      m.renderOrder = 3;
      k.group.add(m);
    };
    netPlane(fu0, ft0, 44, ft0);
    netPlane(54, ft0, fu1, ft0);
    netPlane(fu0, ft1, fu1, ft1);
    netPlane(fu0, ft0, fu0, ft1);
    netPlane(fu1, ft0, fu1, ft1);
    // Students: a few on the field, a pair at the gate.
    k.person(cu - 12, ct, 1, 0, { body: 'child', pose: 'walk', color: [0.8, 0.85, 1.0] });
    k.person(cu + 6, ct - 8, -1, 0, { body: 'child', pose: 'wave', color: [1.0, 0.85, 0.9], hair: 'long' });
    k.person(35, -2.5, 0, -1, { body: 'child', pose: 'talk', color: [0.8, 0.85, 1.0] });
    k.person(36.2, -2.8, 0, -1, { body: 'child', pose: 'phone', color: [1.0, 0.85, 0.9], hair: 'long' });
  },

  // ---- 東都ドーム TŌTO DOME: the white air-supported roof on its concrete ring, four gates under canopies, the big
  // screen over the front plaza with tonight's show, and the crowd ----
  dome(k) {
    const c = 52;
    k.lathe(0xb8bcc0, c, c, [[0, 50], [12, 50], [12.5, 49.2]], 48);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      if (i % 3 !== 0) continue;
      const u = c + Math.cos(a) * 50.2;
      const t = c + Math.sin(a) * 50.2;
      k.glow([1.6, 1.5, 1.3], u - 0.6, u + 0.6, t - 0.6, t + 0.6, 10.5, 11, EMIT.lamp);
    }
    k.lathe(0xf0f0ec, c, c, [[12.5, 49.2], [17, 46], [22, 39], [25.5, 30], [27.5, 18], [28.5, 6], [28.6, 0.05]], 48);
    // The gates: canopies at the four quarters.
    for (let q = 0; q < 4; q++) {
      const a = (q / 4) * Math.PI * 2 + Math.PI / 2 + Math.PI;
      const u = c + Math.cos(a) * 52;
      const t = c + Math.sin(a) * 52;
      k.box(0x4a5a6a, u - 7, u + 7, t - 3, t + 3, 4.5, 5);
      k.lit(0xf0f4f4, u - 6.8, u + 6.8, t - 2.8, t + 2.8, 4.48, 4.5);
    }
    // The screen over the front plaza: the name, tonight's show.
    k.box(0x1a1a1e, c - 13, c + 13, -0.5, 0.5, 0, 16);
    plate(k, 24, 9, c, -0.55, 11, (g, W, H) => {
      g.fillStyle = '#08060e';
      g.fillRect(0, 0, W, H);
      neonText(g, 'TŌTO DOME', W / 2, H * 0.2, `900 ${Math.round(H * 0.17)}px Arial, sans-serif`, '#ffffff');
      text(g, '東都ドーム', W / 2, H * 0.36, `bold ${Math.round(H * 0.1)}px 'Yu Gothic', sans-serif`, '#a8c8ff');
      neonText(g, 'STELLA PRODUCTION', W / 2, H * 0.58, `bold ${Math.round(H * 0.1)}px Arial, sans-serif`, '#ffe45f');
      neonText(g, '5th ANNIVERSARY LIVE', W / 2, H * 0.74, `900 ${Math.round(H * 0.12)}px Arial, sans-serif`, '#ff8ad8');
      text(g, 'TONIGHT 18:00 開場 · 19:00 開演', W / 2, H * 0.9, `bold ${Math.round(H * 0.07)}px 'Yu Gothic', sans-serif`, '#ffffff');
    }, true);
    // The crowd in the plaza, light sticks up.
    for (let i = 0; i < 18; i++) {
      const u = c - 20 + (i % 9) * 5 + (i > 8 ? 2.5 : 0);
      const t = -4 - (i > 8 ? 3 : 0);
      k.person(u, t, 0, 1, { body: i % 3 ? 'woman' : 'man', pose: i % 4 === 0 ? 'wave' : i % 4 === 1 ? 'phone' : 'stand', color: i % 2 ? [1.0, 0.6, 0.9] : [0.6, 0.8, 1.0], ...(i % 3 ? { hair: 'long' as const } : {}) });
    }
  },

  // ---- 水道町ワンダーランド: the rollercoaster (a looping track on white supports, its train running round: slow up
  // the lift hill, fast down the drops) and the drop tower (the ring of seats hauled up, held, dropped) ----
  amusement(k) {
    // The gate.
    k.box(0xe8e0f0, 8, 30, 6, 16, 0, 5);
    plate(k, 20, 2.6, 19, 5.95, 6.6, (g, W, H) => {
      g.fillStyle = '#2a1a4a';
      g.fillRect(0, 0, W, H);
      neonText(g, '水道町ワンダーランド', W / 2, H * 0.45, `bold ${Math.round(H * 0.42)}px 'Yu Gothic', sans-serif`, '#ff8ad8');
      neonText(g, 'SUIDŌ WONDERLAND', W / 2, H * 0.82, `bold ${Math.round(H * 0.2)}px Arial, sans-serif`, '#4fe3ff');
    }, true);
    // The coaster's track: a closed curve through the park (local u, height, t).
    const P = (u: number, y: number, t: number): THREE.Vector3 => {
      const [x, z] = toWorld(k.f, u, t);
      return new THREE.Vector3(x, y, z);
    };
    const curve = new THREE.CatmullRomCurve3(
      [P(20, 4, 24), P(45, 5, 22), P(70, 34, 22), P(84, 36, 30), P(90, 8, 50), P(80, 18, 80), P(55, 26, 90), P(30, 12, 86), P(14, 20, 66), P(10, 6, 42)],
      true,
      'centripetal',
    );
    const track = new THREE.Mesh(new THREE.TubeGeometry(curve, 400, 0.45, 6, true), new THREE.MeshStandardMaterial({ color: 0xd83a5a, roughness: 0.5, metalness: 0.3 }));
    track.castShadow = true;
    k.group.add(track);
    const support = new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.6 });
    const N = 90;
    for (let i = 0; i < N; i++) {
      const p = curve.getPointAt(i / N);
      if (p.y < 2) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.35, p.y, 0.35), support);
      m.position.set(p.x, p.y / 2, p.z);
      k.group.add(m);
    }
    // The train: five cars riding the track.
    const cars = Array.from({ length: 5 }, (_, i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 2.6), new THREE.MeshStandardMaterial({ color: [0xffe45f, 0x4fe3ff, 0xff8ad8, 0x6bff8a, 0xffffff][i], roughness: 0.4 }));
      m.castShadow = true;
      k.group.add(m);
      return m;
    });
    // The drop tower: its column, the ring of seats (moved each frame).
    k.box(0x9aa0a6, 80, 84, 62, 66, 0, 62);
    k.glow([3, 0.3, 0.2], 81.6, 82.4, 63.6, 64.4, 62, 62.8, EMIT.always);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.7, 8, 20), new THREE.MeshStandardMaterial({ color: 0xff5fc8, roughness: 0.4, emissive: 0xff5fc8, emissiveIntensity: 0.3 }));
    ring.rotation.x = Math.PI / 2;
    const [rx, rz] = toWorld(k.f, 82, 64);
    ring.position.set(rx, 3, rz);
    k.group.add(ring);
    const L = curve.getLength();
    const top = 36;
    let s = 0;
    let dropT = 0;
    const tmp = new THREE.Vector3();
    return (_c, dt) => {
      // Speed by the drop from the top (a little friction), slow on the lift hill.
      const here = curve.getPointAt(s / L);
      const v = here.y > 5 && s / L > 0.08 && s / L < 0.24 ? 4 : Math.sqrt(Math.max(9, 2 * 9.8 * (top - here.y)));
      s = (s + v * dt) % L;
      cars.forEach((m, i) => {
        const at = ((s - i * 2.9) % L + L) % L;
        const p = curve.getPointAt(at / L);
        m.position.copy(p).setY(p.y + 0.9);
        curve.getPointAt(((at + 1) % L) / L, tmp);
        m.lookAt(tmp.x, tmp.y + 0.9, tmp.z);
      });
      // The drop tower's cycle: hauled up over 20 s, held 3 s, dropped in 2 s, 5 s at the bottom.
      dropT = (dropT + dt) % 30;
      const y = dropT < 20 ? 3 + (dropT / 20) * 55 : dropT < 23 ? 58 : dropT < 25 ? 58 - ((dropT - 23) / 2) ** 2 * 55 : 3;
      ring.position.y = y;
    };
  },
};
