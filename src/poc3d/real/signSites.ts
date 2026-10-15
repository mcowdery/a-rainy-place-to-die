import { hash, u01 } from '../../core/hash';
import { isWide } from '../../core/wide';
import { filipino } from '../district/cityConfig';
import { eraSign } from '../district/era';
import { frontSpan, frontWidth, type Building3, type CellPlan3, type Road3, type Sign3, type SignLook } from '../district/plan';
import { frontFrame, styleFor } from './buildings';
import { TRADE, tradeOfWord, type Trade } from './shops';
import { bladeLength, plateWidth } from './signs';

/**
 * Where a cell's shop signs go and how each is made (the user, 2026-10-15: "remove and then re-add all the neon signs
 * with better locations ... based on the district, the building type, the buildings around it (so no neon signs facing
 * walls)"). Pure, so every thread agrees: `DistrictModel.signs(mx, my)`. The plan only says what a shop's sign says
 * (`Building3.sign`: the shop is what it says, shops.ts); this says where it hangs, from what's round the building:
 *
 * - **A shop, on a street.** No sign on a home, nor on a face with no street in front of it (a yard, another
 *   building's back): that's a wall nobody walks past.
 * - **Read the way it's seen.** A blade (vertical, out from the wall) is read along the street, so it suits a lane;
 *   a fascia over the shopfront and channel letters are read face on, from across the street. A face-on sign whose
 *   view across is a back or side wall within 8 m becomes a blade where its words can be one, and is never neon
 *   (a lightbox); channel letters only where the street is wide or the view across open.
 * - **Blades between floors.** A blade's top is on a floor line, its foot over the fascia and the awnings (4.4 m),
 *   under the step-backs (14.6 m), with 2.2 m to pass the wall across; none on a tower; never two in each other's way.
 * - **The corner.** A corner building's blade hangs at the corner end of its front, and some (by district) have a
 *   second one round the corner, down the side street.
 * - **Upstairs tenants.** In Kaburo (as much as its zone's vice) and Denkō-chō, buildings of four floors and more
 *   get the blades of the bars or shops upstairs, stacked up the front.
 * - **The district's taste** (PROFILES): which looks each class of trade takes (neon for the night trades, lightboxes
 *   for the daily ones, painted boards in the old town), how many channel letters, corners and upstairs tenants.
 * - **A fascia no wider than its shopfront.**
 *
 * Everything that decides where and which way up is the same in every year (district/era.ts: the roads, the
 * building's 1992 height, its own hash, the footprints round it but the towers, which some years haven't): a blade
 * that doesn't fit the year's lower building is left off, so every sign of another year stands where one stands in 1992.
 */

type Class = 'night' | 'food' | 'daily' | 'shop' | 'craft' | 'big';

const CLASS: Readonly<Record<Trade, Class>> = {
  [TRADE.bar]: 'night', [TRADE.snack]: 'night', [TRADE.izakaya]: 'night', [TRADE.mahjong]: 'night', [TRADE.karaoke]: 'night',
  [TRADE.lounge]: 'night', [TRADE.pachinko]: 'night', [TRADE.arcade]: 'night', [TRADE.lovehotel]: 'night',
  [TRADE.noodles]: 'food', [TRADE.cafe]: 'food', [TRADE.bakery]: 'food',
  [TRADE.general]: 'daily', [TRADE.grocer]: 'daily', [TRADE.konbini]: 'daily', [TRADE.drugstore]: 'daily', [TRADE.bank]: 'daily',
  [TRADE.clinic]: 'daily', [TRADE.salon]: 'daily', [TRADE.laundry]: 'daily', [TRADE.estate]: 'daily', [TRADE.gym]: 'daily',
  [TRADE.florist]: 'daily', [TRADE.books]: 'daily',
  [TRADE.fashion]: 'shop', [TRADE.electronics]: 'shop', [TRADE.hobby]: 'shop', [TRADE.maid]: 'shop',
  [TRADE.craft]: 'craft',
  [TRADE.lobby]: 'big', [TRADE.hotel]: 'big', [TRADE.warehouse]: 'big',
};

type Looks = readonly (readonly [SignLook, number])[];

interface Profile {
  /** The looks each class of trade takes, weighted (null: from each sign's own hash, as before: Manila). */
  readonly looks: Readonly<Record<Class, Looks>> | null;
  /** Multiplies the style's `verticalSign` (the share of wide words that are blades). */
  readonly blades: number;
  /** The chance a Latin sign on an open front is channel letters. */
  readonly channel: number;
  /** The chance a corner building has a second blade down its side street. */
  readonly corner: number;
  /** The chance a building of four floors and more has its upstairs tenants' blades (times twice its zone's vice for 'night'). */
  readonly stack: number;
  /** Whose words the upstairs blades have: the night trades among the zone's words, or any of them. */
  readonly tenants: 'night' | 'any';
}

const PROFILES: Readonly<Record<string, Profile>> = {
  // 歌舞路 Kaburo: neon first, white-on-colour boxes, channel letters on the open fronts, bars stacked up the fronts.
  neon: {
    looks: {
      night: [['neon', 6], ['inverse', 2], ['lightbox', 1]],
      food: [['neon', 2], ['lightbox', 3], ['inverse', 2]],
      daily: [['lightbox', 4], ['inverse', 2]],
      shop: [['neon', 2], ['lightbox', 2], ['inverse', 2]],
      craft: [['lightbox', 2], ['print', 1]],
      big: [['inverse', 2], ['lightbox', 1], ['neon', 1]],
    },
    blades: 1,
    channel: 0.5,
    corner: 0.6,
    stack: 0.6,
    tenants: 'night',
  },
  // 電光町 Denkō-chō: lightboxes and white-on-colour in every colour, blades on every corner and up the fronts.
  electric: {
    looks: {
      night: [['neon', 4], ['inverse', 2]],
      food: [['lightbox', 3], ['inverse', 1]],
      daily: [['lightbox', 3], ['inverse', 2]],
      shop: [['inverse', 4], ['lightbox', 3], ['neon', 2]],
      craft: [['lightbox', 1]],
      big: [['inverse', 2], ['lightbox', 1]],
    },
    blades: 1.1,
    channel: 0.4,
    corner: 0.7,
    stack: 0.55,
    tenants: 'any',
  },
  // 朝霧 Asagiri: the business district: lightboxes and corporate white, neon only on the night trades.
  tower: {
    looks: {
      night: [['neon', 2], ['inverse', 2]],
      food: [['lightbox', 3], ['inverse', 1]],
      daily: [['lightbox', 3], ['inverse', 1]],
      shop: [['lightbox', 2], ['inverse', 2]],
      craft: [['lightbox', 1]],
      big: [['inverse', 2], ['lightbox', 2]],
    },
    blades: 0.8,
    channel: 0.5,
    corner: 0.15,
    stack: 0,
    tenants: 'any',
  },
  // The old town: painted boards and warm lightboxes; a little neon over its bars.
  oldtown: {
    looks: {
      night: [['neon', 1], ['lightbox', 2], ['print', 1]],
      food: [['lightbox', 2], ['print', 2]],
      daily: [['lightbox', 2], ['print', 1]],
      shop: [['lightbox', 2], ['print', 1]],
      craft: [['print', 3], ['lightbox', 1]],
      big: [['lightbox', 1]],
    },
    blades: 1,
    channel: 0,
    corner: 0.25,
    stack: 0,
    tenants: 'any',
  },
  // The residential ring: the cleaner's, the barber's, the clinic's lightboxes; neon only over a snack bar.
  residential: {
    looks: {
      night: [['neon', 2], ['lightbox', 2]],
      food: [['lightbox', 3], ['print', 1]],
      daily: [['lightbox', 4]],
      shop: [['lightbox', 3]],
      craft: [['print', 1], ['lightbox', 1]],
      big: [['lightbox', 1]],
    },
    blades: 0.5,
    channel: 0,
    corner: 0,
    stack: 0,
    tenants: 'any',
  },
  campus: {
    looks: {
      night: [['neon', 1], ['lightbox', 2]],
      food: [['lightbox', 3], ['print', 1]],
      daily: [['lightbox', 3], ['inverse', 1]],
      shop: [['lightbox', 2]],
      craft: [['print', 1]],
      big: [['inverse', 1], ['lightbox', 2]],
    },
    blades: 0.6,
    channel: 0.2,
    corner: 0,
    stack: 0,
    tenants: 'any',
  },
  // The port: few signs, lit boxes and the forwarders' names in letters on the sheds.
  harbor: {
    looks: {
      night: [['neon', 1], ['lightbox', 1]],
      food: [['lightbox', 2], ['print', 1]],
      daily: [['lightbox', 2]],
      shop: [['lightbox', 2]],
      craft: [['print', 1]],
      big: [['inverse', 1], ['lightbox', 2]],
    },
    blades: 0.5,
    channel: 0.5,
    corner: 0,
    stack: 0,
    tenants: 'any',
  },
};

/** Elsewhere (Manila's districts): the looks from each sign's own hash, as before, and no corners or tenants. */
const PLAIN: Profile = { looks: null, blades: 1, channel: 0, corner: 0, stack: 0, tenants: 'any' };

const FLOOR = 3;
/** A blade's foot over the fascia and the awnings, its top under the step-backs (buildings.ts tiers: from 15 m). */
const BLADE_FOOT = 4.4;
const BLADE_TOP = 14.6;
/** How far a blade reaches out from its wall (signs.ts: 0.12 m off it, 0.9 m wide), and room to pass beyond it. */
const BLADE_REACH = 1.02;
const PASS = 1.2;
/** A face-on sign with a back or side wall this close across is looking at a wall. */
const WALLED = 8;
/** Towers: some years haven't them (era.ts), so the view across leaves them out, and they carry no blades. */
const TOWER = 45;

const allWide = (text: string): boolean => [...text].every((c) => isWide(c.codePointAt(0)!) || c === ' ');
const latin = (text: string): boolean => [...text].every((c) => !isWide(c.codePointAt(0)!));

function pickLook(looks: Looks, roll: number): SignLook {
  const total = looks.reduce((a, [, w]) => a + w, 0);
  let r = roll * total;
  for (const [look, w] of looks) if ((r -= w) < 0) return look;
  return looks[looks.length - 1][0];
}

interface Placed {
  readonly x: number;
  readonly z: number;
  readonly nx: number;
  readonly nz: number;
  readonly y0: number;
  readonly y1: number;
}

/**
 * A cell's signs. `around`: the buildings of the cell and the eight round it (the view across a street); `roads`: the
 * roads of the same cells (what's in front of a wall).
 */
export function placeSigns(plan: CellPlan3, around: readonly Building3[], roads: readonly Road3[]): Sign3[] {
  const P = filipino() ? PLAIN : (PROFILES[plan.kind] ?? PLAIN);
  const streets = roads.filter((r) => r.kind !== 'coast');
  const out: Sign3[] = [];
  const blades: Placed[] = [];
  const fits = new Map<Sign3, boolean>();
  // The footprints across: where and which way up a sign goes leaves the towers out (some years haven't them); its
  // look (the same place in every year either way) takes them in.
  const across = around.filter((o) => (o.was ?? o.h) < TOWER);

  /** The street straight out from a wall point, within `max` metres: how far, and how wide it is. */
  const streetAhead = (x: number, z: number, nx: number, nz: number, max: number): { d: number; width: number } | null => {
    for (let d = 0.2; d <= max; d += 0.25) {
      const px = x + nx * d;
      const pz = z + nz * d;
      for (const r of streets) {
        const q = r.rect;
        if (px > q.x && px < q.x + q.w && pz > q.y && pz < q.y + q.h) return { d, width: r.vertical ? q.w : q.h };
      }
    }
    return null;
  };

  /** The first building straight out from a wall point (within 40 m): how far, and which of its faces looks back. */
  const opposite = (b: Building3, x: number, z: number, nx: number, nz: number, among: readonly Building3[] = across): { d: number; face: 'front' | 'back' | 'side' } | null => {
    let best: { d: number; face: 'front' | 'back' | 'side' } | null = null;
    for (const o of among) {
      if (o === b) continue;
      const x0 = o.x - o.w / 2;
      const x1 = o.x + o.w / 2;
      const z0 = o.z - o.d / 2;
      const z1 = o.z + o.d / 2;
      let t: number;
      if (nx !== 0) {
        if (z < z0 || z > z1) continue;
        t = nx > 0 ? x0 - x : x - x1;
      } else {
        if (x < x0 || x > x1) continue;
        t = nz > 0 ? z0 - z : z - z1;
      }
      if (t < 0 || t > 40 || (best && t >= best.d)) continue;
      const of = frontFrame(o).n;
      const dot = of[0] * nx + of[2] * nz;
      best = { d: t, face: dot < -0.5 ? 'front' : dot > 0.5 ? 'back' : 'side' };
    }
    return best;
  };

  const clash = (c: Placed): boolean =>
    blades.some((o) => {
      const dist = Math.hypot(o.x - c.x, o.z - c.z);
      const near = dist < 1.1 || (dist < 1.8 && o.nx === c.nx && o.nz === c.nz);
      return near && o.y0 < c.y1 + 0.3 && c.y0 < o.y1 + 0.3;
    });

  /**
   * A blade on a wall at (x, z) facing (nx, nz): its top on the first floor line from `floor` up that keeps it clear of
   * the others, or null. Chosen from the building's 1992 height; in a year it's lower, a blade that no longer fits keeps
   * its place among the others (so the rest are where they are in 1992) and is left off at the end (`fits`).
   */
  const blade = (b: Building3, x: number, z: number, nx: number, nz: number, text: string, color: number, look: SignLook | undefined, floor: number): Sign3 | null => {
    const tall = b.was ?? b.h;
    const len = bladeLength(text);
    const top = Math.min(tall - 0.8, BLADE_TOP);
    const first = Math.ceil((BLADE_FOOT + len - 0.6) / FLOOR);
    const last = Math.floor((top - 0.6) / FLOOR);
    if (first > last) return null;
    const ahead = opposite(b, x, z, nx, nz);
    if (ahead && ahead.d < BLADE_REACH + PASS) return null;
    for (let i = 0; i <= last - first; i++) {
      const k = first + ((floor + i) % (last - first + 1));
      const y1 = k * FLOOR + 0.6;
      const c: Placed = { x: x + nx * 0.4, z: z + nz * 0.4, nx, nz, y0: y1 - len, y1 };
      if (clash(c)) continue;
      blades.push(c);
      const sign: Sign3 = { text, vertical: true, color, x: c.x, y: y1, z: c.z, nx, nz, ...(look ? { look } : {}) };
      fits.set(sign, y1 <= b.h - 0.8);
      return sign;
    }
    return null;
  };

  /** A point on the building's street face, u metres along it. */
  const onFront = (b: Building3, u: number): { x: number; z: number; nx: number; nz: number } => {
    const f = frontFrame(b);
    return { x: f.p[0] + f.r[0] * u, z: f.p[2] + f.r[2] * u, nx: f.n[0], nz: f.n[2] };
  };

  /** A point on a side wall, `back` metres behind the front at that end (0 the left end, 1 the right), facing out sideways. */
  const onSide = (b: Building3, end: 0 | 1, back: number): { x: number; z: number; nx: number; nz: number } => {
    const f = frontFrame(b);
    const u = end === 0 ? 0 : f.fw;
    const s = end === 0 ? -1 : 1;
    return { x: f.p[0] + f.r[0] * u - f.n[0] * back, z: f.p[2] + f.r[2] * u - f.n[2] * back, nx: f.r[0] * s, nz: f.r[2] * s };
  };

  /** How far behind the front a side wall starts at that end (past a corner cut). */
  const cutAt = (b: Building3, end: 0 | 1): number => {
    const [s0, s1] = frontSpan(b);
    return end === 0 ? s0 : frontWidth(b) - s1;
  };
  const depthOf = (b: Building3): number => (b.front === 'north' || b.front === 'south' ? b.d : b.w);

  /** Whether that end of the front is a street corner: a street just round it. */
  const corner = (b: Building3, end: 0 | 1): boolean => {
    const back = cutAt(b, end) + 1.5;
    if (back > depthOf(b) - 0.5) return false;
    const p = onSide(b, end, back);
    return streetAhead(p.x, p.z, p.nx, p.nz, 6) !== null;
  };

  const lookFor = (b: Building3, roll: number): SignLook | undefined => (P.looks ? pickLook(P.looks[CLASS[styleFor(b).trade as Trade] ?? 'daily'], roll) : undefined);

  // Upstairs tenants' words (blades: the wide ones; Kaburo's only the night trades'), from the 1992 words so they're
  // the same pick in every year.
  const tenantWords = plan.style.signWords.filter((w) => allWide(w) && (P.tenants === 'any' || CLASS[tradeOfWord(w) as Trade] === 'night'));

  for (const b of plan.buildings) {
    const s = styleFor(b);
    if (s.home) continue;
    const tall = b.was ?? b.h;
    const [s0, s1] = frontSpan(b);
    if (s1 - s0 < 2) continue;
    const mid = onFront(b, (s0 + s1) / 2);
    const street = streetAhead(mid.x, mid.z, mid.nx, mid.nz, 8);
    // (A yard in front, or another building's back: nobody passes.)
    if (!street) continue;
    const view = opposite(b, mid.x, mid.z, mid.nx, mid.nz);
    const walled = view !== null && view.face !== 'front' && view.d < WALLED;
    const corners = [corner(b, 0), corner(b, 1)] as const;
    const h = (salt: number): number => u01(hash(b.id, salt, 0x5165));
    const bladeable = tall >= 9 && tall < TOWER;

    if (b.sign) {
      const { text, color } = b.sign;
      const look = lookFor(b, h(1));
      // The shop's own sign: a blade where its words read down and it's wanted (always, rather than face a wall), else on the fascia.
      const share = Math.min(0.95, plan.style.verticalSign * P.blades * (street.width <= 8 ? 1.3 : 0.85));
      let placed = false;
      if (bladeable && allWide(text) && (walled || h(2) < share)) {
        // At the corner end where there is one (seen from both streets), else either.
        const end = corners[0] !== corners[1] ? (corners[0] ? 0 : 1) : h(3) < 0.5 ? 0 : 1;
        const p = onFront(b, end === 0 ? s0 + 1.2 : s1 - 1.2);
        const sign = blade(b, p.x, p.z, p.nx, p.nz, text, color, look, Math.floor(h(4) * 2));
        if (sign) {
          out.push(sign);
          placed = true;
        }
      }
      if (!placed) {
        const maxW = s1 - s0 - 0.6;
        if (maxW >= 1.5) {
          const open = !walled && (street.width >= 10 || !view || view.d >= 14);
          let fl: SignLook | undefined = P.looks && open && latin(text) && maxW >= 2.5 && h(5) < P.channel ? 'channel' : look;
          // (No neon glows at a wall: a tower's either.)
          const facing = opposite(b, mid.x, mid.z, mid.nx, mid.nz, around);
          if (fl === 'neon' && facing && facing.face !== 'front' && facing.d < WALLED) fl = 'lightbox';
          const p = onFront(b, (s0 + s1) / 2);
          out.push({ text, vertical: false, color, x: p.x + p.nx * 0.4, y: 3.6, z: p.z + p.nz * 0.4, nx: p.nx, nz: p.nz, ...(fl ? { look: fl } : {}), ...(maxW < plateWidth(text) ? { maxW } : {}) });
        }
      }
      // Round the corner: the same shop's blade down the side street, a floor apart from the front's.
      if (bladeable && allWide(text) && P.corner > 0 && h(6) < P.corner) {
        for (const end of (h(7) < 0.5 ? [0, 1] : [1, 0]) as (0 | 1)[]) {
          if (!corners[end]) continue;
          const back = cutAt(b, end) + 1.2;
          if (back > depthOf(b) - 1) continue;
          const p = onSide(b, end, back);
          if (!streetAhead(p.x, p.z, p.nx, p.nz, 8)) continue;
          const sign = blade(b, p.x, p.z, p.nx, p.nz, text, color, look, 1 + Math.floor(h(8) * 2));
          if (sign) {
            out.push(sign);
            break;
          }
        }
      }
    }

    // Upstairs: the bars (Kaburo) or shops (Denkō-chō) on the floors above, their blades stacked up the front.
    if (P.stack > 0 && tenantWords.length && tall >= 12 && tall < TOWER && s1 - s0 >= 3.5) {
      const vice = b.zone?.look.vice ?? 0.4;
      const chance = Math.min(0.9, P.tenants === 'night' ? P.stack * vice * 2 : P.stack);
      if (h(10) < chance) {
        const n = h(11) < 0.4 ? 2 : 1;
        // (Not the shop's own word again, nor the other tenant's.)
        let words = tenantWords.filter((w) => w !== b.sign?.word);
        for (let i = 0; i < n && words.length; i++) {
          const word = words[Math.floor(h(12 + i) * words.length)];
          words = words.filter((w) => w !== word);
          const text = eraSign(word);
          const color = plan.style.signColors[Math.floor(h(14 + i) * plan.style.signColors.length)];
          const tenantLook = P.looks ? pickLook(P.tenants === 'night' ? P.looks.night : P.looks.shop, h(16 + i)) : undefined;
          for (const end of (h(18 + i) < 0.5 ? [0, 1] : [1, 0]) as (0 | 1)[]) {
            const p = onFront(b, end === 0 ? s0 + 1.2 : s1 - 1.2);
            const sign = blade(b, p.x, p.z, p.nx, p.nz, text, color, tenantLook, 1 + i);
            if (sign) {
              out.push(sign);
              break;
            }
          }
        }
      }
    }
  }
  return out.filter((s) => fits.get(s) ?? true);
}
