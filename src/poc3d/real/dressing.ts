import { hash, rng } from '../../core/hash';
import { EMIT, KIND, lin, type MeshBuilder } from './meshBuilder';
import type { Prop } from './props';

/**
 * Geometry for greenery and the furniture of open ground (props.ts Prop kinds hedge to cones): kerb
 * hedges, potted plants, planters, benches, park lamps, fences, the coin parking's pay machine and P sign,
 * playground swings, slides and sandboxes, a toilet block, weeds, a for-sale board and traffic cones.
 * Each is drawn in the prop's frame: n its facing, r = (nz, -nx) along it.
 */

type C3 = [number, number, number];

const SHRUB = [0x2e4a26, 0x3e5a2e, 0x4a6a34, 0x36522a, 0x2a4a2e];
const POTS = [0xa0522d, 0xb8663a, 0x2a4a6a, 0xd8d4c8, 0x3a3a3a, 0x8a6a3a];
const PLAY = [0xc83a2a, 0x2a6ac8, 0xe0b020, 0x2a9a5a];

export function addDressing(mb: MeshBuilder, p: Prop): void {
  const r: C3 = [p.nz, 0, -p.nx];
  const n: C3 = [p.nx, 0, p.nz];
  const o: C3 = [p.x, 0, p.z];
  const at = (u: number, out: number, y = 0): C3 => [p.x + r[0] * u + n[0] * out, y, p.z + r[2] * u + n[2] * out];
  const half = p.half ?? 0.5;
  const rnd = rng(hash(p.variant, Math.round(p.x * 8), Math.round(p.z * 8)));
  mb.kind = KIND.plain;
  mb.style = [0, 0, 0, 0];
  switch (p.kind) {
    case 'hedge': {
      // Kerb planting on a concrete planter; park hedges straight from the lawn, taller.
      const park = p.variant === 1;
      const base = park ? 0.1 : 0.4;
      if (!park) {
        mb.color = lin(0x8a867e);
        mb.frameBox(o, r, n, -half, half, 0.15, base, -0.35, 0.35);
      }
      mb.color = lin(rnd.pick(SHRUB));
      const top = base + (park ? 0.8 : 0.45);
      mb.frameBox(o, r, n, -half + 0.05, half - 0.05, base, top, -0.3, 0.3);
      // Lumps along the top so it doesn't read as a green box.
      for (let u = -half + 0.6; u < half - 0.4; u += 1.5 + rnd.float() * 0.6) {
        const c = at(u, (rnd.float() - 0.5) * 0.2);
        mb.color = lin(rnd.pick(SHRUB));
        mb.lathe(c[0], c[2], [[top - 0.05, 0.32], [top + 0.18, 0.05]], 5);
      }
      if (!park && rnd.chance(0.5)) {
        // Azaleas in flower: a few blossom-coloured lumps along the top.
        const bloom = rnd.pick([0xd04a8a, 0xe06aa0, 0xe8e0e8]);
        for (let u = -half + 1.1; u < half - 0.5; u += 1.8 + rnd.float()) {
          const c = at(u, (rnd.float() - 0.5) * 0.3);
          mb.color = lin(bloom);
          mb.lathe(c[0], c[2], [[top - 0.02, 0.26], [top + 0.14, 0.04]], 5);
        }
      }
      break;
    }
    case 'pots': {
      // A jumble of pots against the wall, plants of all sizes.
      for (let u = -half + 0.2; u < half - 0.1; u += 0.35 + rnd.float() * 0.3) {
        const c = at(u, (rnd.float() - 0.5) * 0.3);
        const pr = 0.1 + rnd.float() * 0.1;
        const ph = 0.2 + rnd.float() * 0.25 + (rnd.chance(0.2) ? 0.3 : 0);
        mb.color = lin(rnd.pick(POTS));
        mb.lathe(c[0], c[2], [[0, pr * 0.75], [ph, pr]], 5);
        mb.color = lin(rnd.pick(SHRUB));
        const leaf = pr * (1.3 + rnd.float());
        mb.lathe(c[0], c[2], rnd.chance(0.25)
          ? [[ph, 0.03], [ph + 0.5, leaf], [ph + 1.25, 0.03]]
          : [[ph - 0.02, pr * 0.8], [ph + leaf * 0.6, leaf], [ph + leaf * 1.3, 0.04]], 4);
      }
      break;
    }
    case 'planter': {
      const s = p.size ?? 2.4;
      mb.color = lin(0x8e8a82);
      mb.box(p.x, p.z, 0.15, 0.7, s, s);
      mb.kind = KIND.grass;
      mb.color = lin(0x3a3226);
      mb.box(p.x, p.z, 0.7, 0.72, s - 0.3, s - 0.3, KIND.grass);
      mb.kind = KIND.plain;
      const shrubs = 2 + (p.variant % 3);
      for (let i = 0; i < shrubs; i++) {
        const sx = p.x + (rnd.float() - 0.5) * (s - 0.9);
        const sz = p.z + (rnd.float() - 0.5) * (s - 0.9);
        const rr = 0.35 + rnd.float() * 0.3;
        mb.color = lin(rnd.pick(SHRUB));
        mb.lathe(sx, sz, [[0.7, rr * 0.7], [0.7 + rr * 0.8, rr], [0.7 + rr * 1.7, 0.05]], 6);
      }
      break;
    }
    case 'bench': {
      // Slatted seat facing n, a backrest behind, cast legs.
      mb.color = lin(0x7a5a3c);
      mb.frameBox(o, r, n, -half, half, 0.42, 0.47, -0.22, 0.22);
      mb.frameBox(o, r, n, -half, half, 0.55, 0.85, -0.26, -0.22);
      mb.color = lin(0x3a3c40);
      for (const u of [-half + 0.15, half - 0.15]) {
        mb.frameBox(o, r, n, u - 0.03, u + 0.03, 0, 0.42, -0.2, 0.2);
        mb.frameBox(o, r, n, u - 0.03, u + 0.03, 0.42, 0.85, -0.27, -0.22);
      }
      break;
    }
    case 'postlamp': {
      // A post-top lantern (variant 1: a taller floodlight pole for car parks).
      const tall = p.variant === 1;
      const h = tall ? 5.5 : 3.6;
      mb.color = lin(0x3a3c40);
      mb.cylinder(p.x, p.z, 0, h, 0.07, 6);
      mb.box(p.x, p.z, 0, 0.4, 0.22, 0.22);
      if (tall) {
        mb.frameBox(o, r, n, -0.04, 0.04, h - 0.1, h, 0, 0.8);
        mb.frameBox(o, r, n, -0.25, 0.25, h - 0.2, h - 0.05, 0.5, 1.0);
        mb.kind = KIND.emit;
        mb.color = [0.85, 0.92, 1.0];
        mb.style = [EMIT.lamp, 0, 0, 0];
        mb.frameBox(o, r, n, -0.22, 0.22, h - 0.22, h - 0.2, 0.53, 0.97);
      } else {
        mb.box(p.x, p.z, h + 0.5, h + 0.6, 0.42, 0.42);
        mb.kind = KIND.emit;
        mb.color = [1.0, 0.85, 0.62];
        mb.style = [EMIT.lamp, 0, 0, 0];
        mb.box(p.x, p.z, h, h + 0.5, 0.3, 0.3);
      }
      break;
    }
    case 'fence': {
      if (p.variant === 2) {
        // Red and white posts and a sagging chain (vacant lots).
        const k = Math.max(1, Math.round((2 * half) / 1.8));
        let prev: C3 | null = null;
        for (let i = 0; i <= k; i++) {
          const c = at(-half + (2 * half * i) / k, 0);
          mb.color = lin(i % 2 ? 0xc83a2a : 0xd8d8d0);
          mb.box(c[0], c[2], 0, 0.9, 0.08, 0.08);
          const top: C3 = [c[0], 0.75, c[2]];
          if (prev) {
            mb.color = lin(0x5a5a5a);
            const mid: C3 = [(prev[0] + top[0]) / 2, 0.6, (prev[2] + top[2]) / 2];
            mb.beam(prev, mid, 0.02);
            mb.beam(mid, top, 0.02);
          }
          prev = top;
        }
      } else {
        // Low painted mesh fence: posts, top and bottom rails, a mesh panel.
        mb.color = lin(0x2e5a44);
        const k = Math.max(1, Math.ceil((2 * half) / 1.8));
        for (let i = 0; i <= k; i++) {
          const c = at(-half + (2 * half * i) / k, 0);
          mb.box(c[0], c[2], 0, 1.1, 0.06, 0.06);
        }
        mb.frameBox(o, r, n, -half, half, 1.02, 1.08, -0.025, 0.025);
        mb.frameBox(o, r, n, -half, half, 0.08, 0.12, -0.025, 0.025);
        mb.color = lin(0x24483a);
        mb.frameBox(o, r, n, -half, half, 0.12, 1.02, -0.008, 0.008);
      }
      break;
    }
    case 'paymachine': {
      mb.color = lin(0xd8d8d0);
      mb.frameBox(o, r, n, -0.25, 0.25, 0, 1.45, -0.2, 0.2);
      mb.color = lin(0xd8a830);
      mb.frameBox(o, r, n, -0.26, 0.26, 1.35, 1.5, -0.21, 0.21);
      mb.kind = KIND.emit;
      mb.style = [EMIT.always, 0, 0, 0];
      mb.color = [0.5, 0.75, 0.9];
      mb.quad(at(-0.18, 0.205, 0.95), [r[0] * 0.36, 0, r[2] * 0.36], [0, 0.25, 0]);
      break;
    }
    case 'psign': {
      // A yellow lightbox with a big P, lit at night.
      mb.color = lin(0x8a8c90);
      mb.cylinder(p.x, p.z, 0, 3.4, 0.06, 6);
      mb.kind = KIND.emit;
      mb.style = [EMIT.always, 0, 0, 0];
      mb.color = [1.0, 0.78, 0.1];
      mb.frameBox(o, r, n, -0.45, 0.45, 2.5, 3.4, -0.1, 0.1);
      mb.style = [0, 0, 0, 0];
      mb.kind = KIND.plain;
      mb.color = lin(0x1a2a5a);
      for (const side of [1, -1]) {
        const out0 = side > 0 ? 0.1 : -0.12;
        // Mirrored on the back face so it reads from both sides.
        const bar = (u0: number, u1: number, y0: number, y1: number): void =>
          mb.frameBox(o, r, n, Math.min(u0 * side, u1 * side), Math.max(u0 * side, u1 * side), y0, y1, out0, out0 + 0.02);
        bar(-0.22, -0.1, 2.62, 3.28);
        bar(-0.1, 0.16, 3.18, 3.28);
        bar(-0.1, 0.16, 2.9, 3.0);
        bar(0.08, 0.2, 2.9, 3.28);
      }
      break;
    }
    case 'wheelstop': {
      mb.color = lin(0xb8b4a8);
      mb.frameBox(o, r, n, -half, half, 0, 0.12, -0.1, 0.1);
      break;
    }
    case 'swing': {
      // A-frame ends, a top bar and two seats on chains.
      mb.color = lin(PLAY[p.variant % PLAY.length]);
      const top = 2.2;
      for (const u of [-half, half]) {
        mb.beam(at(u, -0.8), at(u, 0, top), 0.07);
        mb.beam(at(u, 0.8), at(u, 0, top), 0.07);
      }
      mb.beam(at(-half, 0, top), at(half, 0, top), 0.08);
      for (const u of [-half / 2, half / 2]) {
        mb.color = lin(0x6a6a6a);
        mb.beam(at(u - 0.2, 0, top), at(u - 0.2, 0, 0.45), 0.02);
        mb.beam(at(u + 0.2, 0, top), at(u + 0.2, 0, 0.45), 0.02);
        mb.color = lin(0x2a2a2a);
        mb.frameBox(o, r, n, u - 0.25, u + 0.25, 0.4, 0.45, -0.12, 0.12);
      }
      break;
    }
    case 'slide': {
      // Ladder and platform behind (-n), the chute running down toward n.
      mb.color = lin(0x9aa0a6);
      for (const u of [-0.3, 0.3]) for (const out of [-1.6, -0.9]) mb.beam(at(u, out), at(u, out, 1.5), 0.05);
      for (let y = 0.3; y < 1.5; y += 0.3) mb.frameBox(o, r, n, -0.3, 0.3, y, y + 0.04, -1.62, -1.58);
      mb.color = lin(PLAY[p.variant % PLAY.length]);
      mb.frameBox(o, r, n, -0.35, 0.35, 1.45, 1.55, -1.65, -0.85);
      const a = at(-0.3, -0.9, 1.5);
      const b = at(0.3, -0.9, 1.5);
      const d = at(0.3, 1.6, 0.25);
      const e = at(-0.3, 1.6, 0.25);
      // Both sides of the chute.
      mb.poly4(a, e, d, b);
      mb.poly4(a, b, d, e);
      mb.beam(a, e, 0.05);
      mb.beam(b, d, 0.05);
      break;
    }
    case 'sandbox': {
      const s = (p.radius || 1.5) * 2;
      mb.color = lin(0x7a5a3c);
      mb.frameBox(o, r, n, -s / 2, s / 2, 0, 0.25, -s / 2, -s / 2 + 0.15);
      mb.frameBox(o, r, n, -s / 2, s / 2, 0, 0.25, s / 2 - 0.15, s / 2);
      mb.frameBox(o, r, n, -s / 2, -s / 2 + 0.15, 0, 0.25, -s / 2, s / 2);
      mb.frameBox(o, r, n, s / 2 - 0.15, s / 2, 0, 0.25, -s / 2, s / 2);
      mb.kind = KIND.gravel;
      mb.color = lin(0xd0c098);
      mb.frameBox(o, r, n, -s / 2 + 0.15, s / 2 - 0.15, 0, 0.14, -s / 2 + 0.15, s / 2 - 0.15, KIND.gravel);
      break;
    }
    case 'toilet': {
      // Public toilet block (公衆トイレ): pale walls, a flat roof with an overhang, two doors, a lit sign.
      mb.color = lin(0xc8c0b0);
      mb.frameBox(o, r, n, -2, 2, 0, 2.8, -1.5, 1.5);
      mb.color = lin(0x5a5c60);
      mb.frameBox(o, r, n, -2.3, 2.3, 2.8, 3.0, -1.8, 1.8);
      mb.color = lin(0x2a2a2c);
      mb.frameBox(o, r, n, -1.6, -0.6, 0, 2.1, 1.5, 1.52);
      mb.frameBox(o, r, n, 0.6, 1.6, 0, 2.1, 1.5, 1.52);
      mb.kind = KIND.emit;
      mb.style = [EMIT.always, 0, 0, 0];
      mb.color = [0.8, 0.88, 1.0];
      mb.frameBox(o, r, n, -0.4, 0.4, 2.3, 2.6, 1.5, 1.54);
      break;
    }
    case 'weeds': {
      const k = p.size ?? 0.8;
      const blades = 2 + (p.variant % 3);
      for (let i = 0; i < blades; i++) {
        const c = at((rnd.float() - 0.5) * 0.5 * k, (rnd.float() - 0.5) * 0.5 * k);
        mb.color = lin(rnd.pick([0x4a5a2a, 0x5a6a30, 0x6a6a3a, 0x3e5228]));
        mb.lathe(c[0], c[2], [[0, 0.12 * k], [k * (0.35 + rnd.float() * 0.5), 0.02]], 3);
      }
      break;
    }
    case 'board': {
      // A for-sale board (売地) on two posts: a red title band and lines of small print.
      mb.color = lin(0x9aa0a6);
      for (const u of [-0.5, 0.5]) mb.frameBox(o, r, n, u - 0.03, u + 0.03, 0, 1.7, -0.03, 0.03);
      mb.color = lin(0xe8e8e0);
      mb.frameBox(o, r, n, -0.6, 0.6, 0.9, 1.7, 0.03, 0.06);
      mb.color = lin(0xc83a2a);
      mb.frameBox(o, r, n, -0.45, 0.45, 1.42, 1.6, 0.06, 0.07);
      mb.color = lin(0x2a2a2a);
      for (let y = 1.0; y < 1.35; y += 0.1) mb.frameBox(o, r, n, -0.45, -0.05 + rnd.float() * 0.45, y, y + 0.04, 0.06, 0.07);
      break;
    }
    case 'container': {
      // A stack of shipping containers along r: each a box with a darker band top and bottom (the frame and
      // the corrugation's shadow), doors at one end; colours by the shipping lines' liveries.
      const COLS = [0x1f4f8a, 0xb0302a, 0xd86a1e, 0x2a6a3a, 0x8a8e94, 0xe8e4dc, 0x6a2a6a, 0x2a8a9a, 0x9a6a2a];
      const H = 2.59;
      const w = 1.22;
      for (let k = 0; k < (p.size ?? 1); k++) {
        const y0 = k * H;
        mb.color = lin(COLS[hash(p.variant, k) % COLS.length]);
        mb.frameBox(o, r, n, -half + 0.02, half - 0.02, y0 + 0.12, y0 + H - 0.1, -w + 0.02, w - 0.02);
        mb.color = lin(0x2a2a2c);
        mb.frameBox(o, r, n, -half, half, y0, y0 + 0.12, -w, w);
        mb.frameBox(o, r, n, -half, half, y0 + H - 0.1, y0 + H, -w, w);
        // The doors' end: two dark lines down it.
        mb.frameBox(o, r, n, half - 0.02, half, y0 + 0.2, y0 + H - 0.2, -0.03, 0.03);
      }
      break;
    }
    case 'cones': {
      const k = 2 + (p.variant % 3);
      for (let i = 0; i < k; i++) {
        const c = at((rnd.float() - 0.5) * 1.2, (rnd.float() - 0.5) * 1.2);
        mb.color = lin(0xe05a1a);
        mb.box(c[0], c[2], 0, 0.04, 0.38, 0.38);
        mb.lathe(c[0], c[2], [[0.04, 0.15], [0.7, 0.03]], 6);
        mb.color = lin(0xe8e8e0);
        mb.lathe(c[0], c[2], [[0.35, 0.1], [0.5, 0.075]], 6);
      }
      break;
    }
    case 'bike': {
      // A mamachari, front wheel to the wall (along -n): two wheels, a step-through frame, a basket
      // at the front, a seat and handlebars; a pastel or silver frame.
      const frame = lin(rnd.pick([0xc8ccd0, 0xe8c8d0, 0xa8c8e0, 0xd8d8c0, 0x2a2a2e, 0x8a2a2a]));
      const R = 0.33;
      const wheel = (out: number): void => {
        mb.color = lin(0x1a1a1a);
        const c = at(0, out, R);
        const k = 10;
        for (let i = 0; i < k; i++) {
          const a0 = (i / k) * Math.PI * 2;
          const a1 = ((i + 1) / k) * Math.PI * 2;
          mb.beam([c[0] + n[0] * Math.cos(a0) * R, R + Math.sin(a0) * R, c[2] + n[2] * Math.cos(a0) * R], [c[0] + n[0] * Math.cos(a1) * R, R + Math.sin(a1) * R, c[2] + n[2] * Math.cos(a1) * R], 0.035);
        }
      };
      wheel(-0.55);
      wheel(0.55);
      mb.color = frame;
      const P = (out: number, y: number): C3 => at(0, out, y);
      mb.beam(P(0.55, R), P(0.05, 0.42), 0.03);
      mb.beam(P(0.05, 0.42), P(-0.4, 0.95), 0.03);
      mb.beam(P(0.25, 0.85), P(0.05, 0.42), 0.03);
      mb.beam(P(0.25, 0.85), P(0.55, R), 0.025);
      mb.beam(P(-0.4, 0.95), P(-0.55, R), 0.03);
      mb.color = lin(0x2a2a2a);
      mb.beam(at(-0.22, -0.42, 1.02), at(0.22, -0.42, 1.02), 0.02);
      mb.frameBox(o, r, n, -0.09, 0.09, 0.9, 0.95, 0.15, 0.4);
      mb.color = lin(0x9aa0a6);
      mb.frameBox(o, r, n, -0.18, 0.18, 0.72, 0.98, -0.85, -0.55);
      break;
    }
    default:
      break;
  }
  mb.kind = KIND.plain;
  mb.style = [0, 0, 0, 0];
}
