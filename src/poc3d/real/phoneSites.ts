import type { Rect } from '../../core/coords';
import { hash, u01 } from '../../core/hash';
import { CELL, frontSpan, type Building3, type CellPlan3 } from '../district/plan';
import { frontFrame, styleFor } from './buildings';
import type { Light } from './lightmap';
import type { Prop } from './props';
import { TRADE } from './shops';

/**
 * Where a cell's payphones stand (docs/street-furniture-plan.md). Pure, part of the cell's street furniture
 * (`cellDetail`), so every thread agrees; they are `Prop`s of kind 'payphone' (their `variant` is which phone:
 * PHONE) that the chunks don't draw: real/payphoneField.ts draws them, since each can be used.
 *
 * Every phone stands against a building's street face, near one end of it (a shop's door is in the middle), facing
 * out. Which phone depends on the room in front of the wall (to the carriageway's edge) and on what the building is:
 *
 * - a **booth** needs 2.9 m (its own depth, its door's swing, room to pass): set pieces' fronts and the corner
 *   buildings of the avenues;
 * - the **green phone under its hood** needs 1.5 m and a raised pavement: the bigger shops (a konbini, a drugstore,
 *   pachinko, a bank, a hotel) and set pieces without room for a booth;
 * - the **red phone on its stand** needs almost none, and is what the lanes get: a grocer's, a noodle shop's, a
 *   laundry's front; the **pink** one is the same phone by the door of a bar, a snack, a mahjong parlour.
 *
 * How many: each set piece of a kind that has one gets its own (a station two), and beyond those a cell is cut into
 * tiles and each tile gets at most one, at its best front, with a chance that makes the cell's expected number its
 * zone's `look.payphone` (or its district's: PHONES_PER_CELL). So they are spread out and never bunch.
 */
export const PHONE = { hood: 0, booth: 1, red: 2, pink: 3 } as const;

/** Expected generated phones in a cell, by district kind (a zone's `look.payphone` overrides it). */
export const PHONES_PER_CELL: Readonly<Record<string, number>> = { neon: 2.2, electric: 2, tower: 1.5, campus: 1, oldtown: 0.9, residential: 0.45, harbor: 0.2 };

/** Set pieces with phones of their own outside, and how many. */
const LANDMARK_PHONES: Readonly<Record<string, number>> = {
  station: 2, subway: 1, rotary: 2, konbini: 1, koban: 1, hospital: 2, school: 1, university: 1, temple: 1, shrine: 1, ferry_terminal: 2, fish_market: 1, dome: 2,
  dept_store: 1, sento: 1, biz_hotel: 1, live_house: 1, discount: 1, tv_tower: 1, police_hq: 1, city_hall: 1, net_cafe: 1,
};

/** How much a trade wants a phone at its front (0: never), and whether it's a big shop (the green phone) or a small one (the red). */
const T = TRADE;
const WANT = new Map<number, readonly [weight: number, kind: 'big' | 'small' | 'night']>([
  [T.konbini, [9, 'big']], [T.pachinko, [6, 'big']], [T.hotel, [6, 'big']], [T.drugstore, [5, 'big']], [T.arcade, [5, 'big']], [T.bank, [5, 'big']], [T.lobby, [4, 'big']],
  [T.gym, [3, 'big']], [T.electronics, [3, 'big']], [T.hobby, [3, 'big']], [T.cafe, [3, 'big']], [T.fashion, [2, 'big']], [T.clinic, [2, 'big']], [T.warehouse, [2, 'big']],
  [T.grocer, [6, 'small']], [T.laundry, [4, 'small']], [T.noodles, [3, 'small']], [T.craft, [3, 'small']], [T.general, [3, 'small']], [T.izakaya, [3, 'small']],
  [T.bakery, [2, 'small']], [T.florist, [2, 'small']], [T.books, [2, 'small']], [T.salon, [1, 'small']], [T.estate, [1, 'small']],
  [T.bar, [5, 'night']], [T.snack, [5, 'night']], [T.lounge, [4, 'night']], [T.mahjong, [4, 'night']], [T.karaoke, [4, 'night']],
]);

/** From the wall out to the phone's own origin (the post's foot, the booth's middle), and the ground it takes: half its width along the wall, and how far out. */
const STAND: Record<number, { off: number; half: number; out: number; radius: number }> = {
  [PHONE.hood]: { off: 0.22, half: 0.5, out: 1.4, radius: 0.3 },
  [PHONE.booth]: { off: 0.62, half: 0.62, out: 2.3, radius: 0 },
  [PHONE.red]: { off: 0.2, half: 0.38, out: 1.0, radius: 0.28 },
  [PHONE.pink]: { off: 0.2, half: 0.38, out: 1.0, radius: 0.28 },
};
/** Generated phones stand at least this far from any other. */
const GAP = 24;
const STAMP_IDS = 900000;

export interface PhonePlacement {
  readonly props: Prop[];
  readonly lights: Light[];
  /** The ground each takes: the rest of the street's furniture keeps out. */
  readonly claims: Rect[];
  /** A booth's walls (you walk in at its door, between them). */
  readonly solids: Rect[];
}

export function placePhones(
  plan: CellPlan3,
  buildings: readonly Building3[],
  /** Set pieces' kinds, by their building's id. */
  landmarks: ReadonlyMap<number, string>,
  /** Ground already taken (bus stops). */
  taken: (x: number, z: number, m?: number) => boolean,
): PhonePlacement {
  const out: PhonePlacement = { props: [], lights: [], claims: [], solids: [] };
  const cell = plan.rect;
  const mine = (x: number, z: number): boolean => x >= cell.x && z >= cell.y && x < cell.x + cell.w && z < cell.y + cell.h;
  const roads = plan.roads.filter((r) => r.kind !== 'coast');

  /** From a point on a wall straight out: how far to a carriageway's edge, and whether that street has a raised pavement. */
  const roomAt = (x: number, z: number, nx: number, nz: number): { depth: number; paved: boolean; street: boolean; width: number } => {
    for (let d = 0.2; d <= 12; d += 0.2) {
      const px = x + nx * d;
      const pz = z + nz * d;
      for (const r of roads) {
        const q = r.rect;
        const s = r.sidewalk;
        const on = r.vertical ? px > q.x + s && px < q.x + q.w - s && pz > q.y && pz < q.y + q.h : pz > q.y + s && pz < q.y + q.h - s && px > q.x && px < q.x + q.w;
        if (on) return { depth: d, paved: s > 0, street: true, width: r.vertical ? q.w : q.h };
      }
    }
    return { depth: 12, paved: false, street: false, width: 0 };
  };

  interface Cand {
    readonly x: number;
    readonly z: number;
    readonly nx: number;
    readonly nz: number;
    readonly rx: number;
    readonly rz: number;
    readonly variant: number;
    readonly weight: number;
  }
  /** The phone a front's end can have, or null: `want` is a set piece's (it takes the biggest that fits) or a trade's. */
  const candAt = (b: Building3, u: number, want: 'landmark' | 'big' | 'small' | 'night', weight: number): Cand | null => {
    const f = frontFrame(b);
    const wx = f.p[0] + f.r[0] * u;
    const wz = f.p[2] + f.r[2] * u;
    const room = roomAt(wx, wz, f.n[0], f.n[2]);
    // (A generated building with no street in front of its face has a yard there, or another building's back.)
    if (!room.street && want !== 'landmark') return null;
    let variant: number;
    if (want === 'landmark') variant = room.depth >= 2.9 ? PHONE.booth : room.depth >= 1.5 ? PHONE.hood : PHONE.red;
    else if (want === 'night') variant = PHONE.pink;
    else if (want === 'big' && room.paved && room.depth >= 2.9 && b.cut) variant = PHONE.booth;
    else if (want === 'big' && room.paved && room.depth >= 1.5) variant = PHONE.hood;
    else variant = PHONE.red;
    const st = STAND[variant];
    // A stand phone in a lane takes a little of it: not where the lane is too narrow to pass, or the wall is on the kerb.
    if ((variant === PHONE.red || variant === PHONE.pink) && (room.depth < 0.25 || (!room.paved && room.width < 3))) return null;
    const x = wx + f.n[0] * st.off;
    const z = wz + f.n[2] * st.off;
    if (!mine(x, z) || taken(x, z, 0.6) || taken(x + f.n[0] * st.out * 0.6, z + f.n[2] * st.out * 0.6, 0.3)) return null;
    return { x, z, nx: f.n[0], nz: f.n[2], rx: f.r[0], rz: f.r[2], variant, weight: weight + (variant === PHONE.booth ? 4 : 0) + Math.min(room.depth, 3) * 0.5 };
  };
  const put = (c: Cand): void => {
    const st = STAND[c.variant];
    const booth = c.variant === PHONE.booth;
    out.props.push({ kind: 'payphone', x: c.x, z: c.z, nx: c.nx, nz: c.nz, radius: st.radius, variant: c.variant, ...(booth ? { solid: false } : {}) });
    // A rect in the phone's own frame (a along the wall, o out from its origin), as a world rect (the frame is on the axes).
    const rect = (a0: number, a1: number, o0: number, o1: number): Rect => {
      const xs = [c.x + c.rx * a0 + c.nx * o0, c.x + c.rx * a1 + c.nx * o1];
      const zs = [c.z + c.rz * a0 + c.nz * o0, c.z + c.rz * a1 + c.nz * o1];
      const x = Math.min(...xs);
      const z = Math.min(...zs);
      return { x, y: z, w: Math.max(...xs) - x, h: Math.max(...zs) - z };
    };
    out.claims.push(rect(-st.half, st.half, -st.off, st.out));
    if (booth) {
      // The walker is a circle 0.4 m in radius and the booth is 0.84 m inside: its walls as they block him are set so
      // that he comes in at the door, down its middle, and stops an arm's length from the phone.
      out.solids.push(rect(-0.5, 0.5, -0.55, -0.35), rect(-0.68, -0.6, -0.5, 0.1), rect(0.6, 0.68, -0.5, 0.1));
      out.lights.push({ x: c.x + c.nx * 0.4, z: c.z + c.nz * 0.4, r: 4, color: [0.78, 0.92, 0.84], i: 0.5 });
    } else if (c.variant === PHONE.hood) out.lights.push({ x: c.x + c.nx * 0.5, z: c.z + c.nz * 0.5, r: 2.6, color: [0.8, 0.95, 0.85], i: 0.3 });
  };
  const farFromOthers = (c: Cand): boolean => out.props.every((p) => Math.hypot(p.x - c.x, p.z - c.z) >= GAP);

  // Set pieces first: each of a kind that has phones gets its own, at an end of its street face (its entrance is in the middle).
  for (const b of buildings) {
    const n = b.id >= STAMP_IDS ? (LANDMARK_PHONES[landmarks.get(b.id) ?? ''] ?? 0) : 0;
    if (!n) continue;
    const [s0, s1] = frontSpan(b);
    if (s1 - s0 < 3) continue;
    const ends = [s0 + 0.8, s1 - 0.8];
    // (The end by the lower hash first, so two set pieces side by side don't both pick the same side.)
    if (hash(b.id, 0x9a7f) & 1) ends.reverse();
    let placed = 0;
    for (const u of ends) {
      if (placed >= n) break;
      const c = candAt(b, u, 'landmark', 100);
      if (!c || out.props.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 1.6)) continue;
      put(c);
      placed++;
    }
  }

  // Then the streets: a tile of the cell at a time, its best front.
  const zone = plan.buildings.find((b) => b.zone)?.zone;
  const expect = zone?.look.payphone ?? PHONES_PER_CELL[plan.kind] ?? 0;
  if (expect <= 0) return out;
  const n = expect <= 1 ? 1 : expect <= 4 ? 2 : 3;
  const chance = Math.min(1, expect / (n * n));
  const best: (Cand | null)[] = Array.from({ length: n * n }, () => null);
  for (const b of plan.buildings) {
    const s = styleFor(b);
    if (s.home) continue;
    const want = WANT.get(s.trade);
    if (!want) continue;
    const [s0, s1] = frontSpan(b);
    if (s1 - s0 < 2.4) continue;
    // One end of the front (by the building's hash); a shuttered shop is a little less likely to have one.
    const u = hash(b.id, 0x9a7e) & 1 ? s0 + 0.6 : s1 - 0.6;
    const c = candAt(b, u, want[1], want[0] * (s.shopOpen ? 1 : 0.6) + (b.cut ? 1.5 : 0) + u01(hash(b.id, 0x9a7d)) * 2);
    if (!c) continue;
    const tile = Math.min(n - 1, Math.floor(((c.x - cell.x) / CELL) * n)) + n * Math.min(n - 1, Math.floor(((c.z - cell.y) / CELL) * n));
    if (!best[tile] || c.weight > best[tile]!.weight) best[tile] = c;
  }
  best.forEach((c, tile) => {
    if (!c || u01(hash(plan.mx, plan.my, tile, 0x9a7f01)) >= chance || !farFromOthers(c)) return;
    put(c);
  });
  return out;
}
