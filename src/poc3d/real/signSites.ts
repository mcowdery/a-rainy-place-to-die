import type { Rect } from '../../core/coords';
import { hash, u01 } from '../../core/hash';
import { isWide } from '../../core/wide';
import { filipino } from '../district/cityConfig';
import { era, eraSign } from '../district/era';
import { frontSpan, frontWidth, type Building3, type CellPlan3, type Road3, type Sign3, type SignLook } from '../district/plan';
import { frontFrame, styleFor, tierFront, tiers, WIN } from './buildings';
import { TRADE, tradeOfWord, type Trade } from './shops';
import { shopName } from './shopNames';
import { CROWN_NAMES, HOTEL_PRICES, LED_MESSAGES, WINDOW_WORDS, type Panel, type SignExtra, type WallFrame } from './signKinds';
import { bladeLength, fasciaSize, hasRooftopLetters, plateWidth } from './signs';

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
/** A shop's ground floor (city.ts `GF`). */
const GROUND_FLOOR = 4.2;
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
 * The extra kinds (signKinds.ts) by district: the chance a shop of the right trade gets a stand sign, an izakaya its
 * lanterns, a tenant building lettering on its windows, a tower a company's name, a karaoke box or a laundry its 24H
 * cube; in Kaburo the share of upstairs tenants on one tenant board rather than blades, in Denkō-chō on a banner flat
 * down the facade.
 */
interface Extras {
  readonly stand: number;
  readonly lantern: number;
  readonly window: number;
  readonly crown: number;
  readonly board: number;
  readonly banner: number;
  readonly cube: number;
}
const EXTRAS: Readonly<Record<string, Extras>> = {
  neon: { stand: 0.6, lantern: 0.85, window: 0.6, crown: 0.3, board: 0.6, banner: 0, cube: 0.3 },
  electric: { stand: 0.3, lantern: 0.7, window: 0.4, crown: 0.3, board: 0, banner: 0.5, cube: 0.3 },
  tower: { stand: 0.2, lantern: 0.7, window: 0.6, crown: 0.5, board: 0, banner: 0, cube: 0.2 },
  oldtown: { stand: 0.4, lantern: 0.9, window: 0.3, crown: 0, board: 0, banner: 0, cube: 0.15 },
  residential: { stand: 0.3, lantern: 0.8, window: 0.35, crown: 0, board: 0, banner: 0, cube: 0.25 },
  campus: { stand: 0.15, lantern: 0.7, window: 0.5, crown: 0, board: 0, banner: 0, cube: 0.2 },
  harbor: { stand: 0.1, lantern: 0.6, window: 0.15, crown: 0.2, board: 0, banner: 0, cube: 0.1 },
};

/** Trades with a stand sign by their door; the pictogram a neon fascia may have, by trade. */
const STAND_TRADES: readonly number[] = [TRADE.bar, TRADE.snack, TRADE.lounge, TRADE.mahjong, TRADE.karaoke, TRADE.izakaya];
const ICON_OF: Readonly<Partial<Record<number, string>>> = {
  [TRADE.bar]: 'cocktail', [TRADE.snack]: 'moon', [TRADE.izakaya]: 'beer', [TRADE.cafe]: 'coffee', [TRADE.karaoke]: 'note',
  [TRADE.lounge]: 'star', [TRADE.lovehotel]: 'heart', [TRADE.arcade]: 'star',
};
/** Bulbs round the fascia, by trade (the chance); an LED board over it (1992 only). */
const BULBS: Readonly<Partial<Record<number, number>>> = { [TRADE.pachinko]: 1, [TRADE.lovehotel]: 0.6, [TRADE.lounge]: 0.35, [TRADE.arcade]: 0.4, [TRADE.karaoke]: 0.25 };
const LED: Readonly<Partial<Record<number, [string, number]>>> = { [TRADE.pachinko]: ['pachinko', 1], [TRADE.arcade]: ['arcade', 0.5], [TRADE.karaoke]: ['karaoke', 0.3], [TRADE.electronics]: ['electronics', 0.2] };
const WINDOW_INK = [0xffffff, 0xffe45f, 0x9ad8ff, 0xff6a5a];

/** What the siting puts up in a cell. */
export interface SignPlacement {
  /** Blades and fascias (signs.ts addSigns). */
  readonly signs: readonly Sign3[];
  /** The other kinds (signKinds.ts addSignExtras). */
  readonly extras: readonly SignExtra[];
  /** The ground the stand signs take (the rest of the street's furniture keeps off it), and their footprints (solid). */
  readonly claims: readonly Rect[];
  readonly solids: readonly Rect[];
}

/**
 * A cell's signs. `around`: the buildings of the cell and the eight round it (the view across a street); `roads`: the
 * roads of the same cells (what's in front of a wall); `taken`: ground already spoken for (bus stops, payphones,
 * stairwells), which a stand sign keeps off.
 */
export function placeSigns(plan: CellPlan3, around: readonly Building3[], roads: readonly Road3[], taken: (x: number, z: number, m?: number) => boolean = () => false): SignPlacement {
  const P = filipino() ? PLAIN : (PROFILES[plan.kind] ?? PLAIN);
  const E = filipino() ? null : (EXTRAS[plan.kind] ?? null);
  const year = era().id;
  const streets = roads.filter((r) => r.kind !== 'coast');
  const out: Sign3[] = [];
  const extras: SignExtra[] = [];
  const claims: Rect[] = [];
  const solids: Rect[] = [];
  const blades: Placed[] = [];
  const fits = new Map<Sign3 | SignExtra, boolean>();
  // The footprints across: where and which way up a sign goes leaves the towers out (some years haven't them); its
  // look (the same place in every year either way) takes them in.
  const across = around.filter((o) => (o.was ?? o.h) < TOWER);

  /** The street straight out from a wall point, within `max` metres: how far, how wide it is, its pavement. */
  const streetAhead = (x: number, z: number, nx: number, nz: number, max: number): { d: number; width: number; sidewalk: number } | null => {
    for (let d = 0.2; d <= max; d += 0.25) {
      const px = x + nx * d;
      const pz = z + nz * d;
      for (const r of streets) {
        const q = r.rect;
        if (px > q.x && px < q.x + q.w && pz > q.y && pz < q.y + q.h) return { d, width: r.vertical ? q.w : q.h, sidewalk: r.sidewalk };
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

  /** The floor lines a thing `len` tall can have its top on, its foot over the fascia, its top under min(the step-backs, `under`). */
  const tops = (tall: number, len: number, under = tall - 0.8): number[] => {
    const top = Math.min(under, BLADE_TOP);
    const first = Math.ceil((BLADE_FOOT + len - 0.6) / FLOOR);
    const last = Math.floor((top - 0.6) / FLOOR);
    const out: number[] = [];
    for (let k = first; k <= last; k++) out.push(k * FLOOR + 0.6);
    return out;
  };

  /**
   * A blade on a wall at (x, z) facing (nx, nz): its top on the first floor line from `floor` up that keeps it clear of
   * the others, or null. Chosen from the building's 1992 height; in a year it's lower, a blade that no longer fits keeps
   * its place among the others (so the rest are where they are in 1992) and is left off at the end (`fits`).
   */
  const blade = (b: Building3, x: number, z: number, nx: number, nz: number, text: string, color: number, look: SignLook | undefined, floor: number, fit = text): Sign3 | null => {
    // (Its length from what it says in 1992, `fit`: the year's own words may be shorter.)
    const len = Math.max(bladeLength(text), bladeLength(fit));
    const ys = tops(b.was ?? b.h, len);
    if (!ys.length) return null;
    const ahead = opposite(b, x, z, nx, nz);
    if (ahead && ahead.d < BLADE_REACH + PASS) return null;
    for (let i = 0; i < ys.length; i++) {
      const y1 = ys[(floor + i) % ys.length];
      const c: Placed = { x: x + nx * 0.4, z: z + nz * 0.4, nx, nz, y0: y1 - len, y1 };
      if (clash(c)) continue;
      blades.push(c);
      const sign: Sign3 = { text, vertical: true, color, x: c.x, y: y1, z: c.z, nx, nz, ...(look ? { look } : {}) };
      fits.set(sign, y1 <= b.h - 0.8);
      return sign;
    }
    return null;
  };

  /**
   * The upstairs tenants on one board at u: standing out from the wall (Kaburo's 袖看板) or flat on it (`flush`, Denkō-chō's
   * banner), as many panels as fit between the fascia and its top (at least `min`), or null. Kept clear of the blades
   * like one of them.
   */
  const board = (b: Building3, u: number, panels: Panel[], fit: readonly string[], flush: boolean, min: number, id: number): SignExtra | null => {
    const f = frontFrame(b);
    const width = flush ? 1.8 : 0.8;
    const x = f.p[0] + f.r[0] * u;
    const z = f.p[2] + f.r[2] * u;
    if (!flush) {
      const ahead = opposite(b, x, z, f.n[0], f.n[2]);
      if (ahead && ahead.d < 0.2 + width + PASS) return null;
    }
    // (Their lengths from what they say in 1992, `fit`.)
    const lens = panels.map((pn, i) => Math.max(bladeLength(pn.text), bladeLength(fit[i] ?? pn.text)) * (width / 0.9) + 0.1);
    for (let n = panels.length; n >= min; n--) {
      const len = lens.slice(0, n).reduce((a, l) => a + l, 0.1);
      for (const y1 of tops(b.was ?? b.h, len)) {
        const c: Placed = { x: x + f.n[0] * 0.4, z: z + f.n[2] * 0.4, nx: f.n[0], nz: f.n[2], y0: y1 - len, y1 };
        if (clash(c)) continue;
        blades.push(flush ? { ...c, x: x + f.n[0] * 0.4 - f.r[0] * 0.5, z: z + f.n[2] * 0.4 - f.r[2] * 0.5 } : c);
        if (flush) blades.push({ ...c, x: x + f.n[0] * 0.4 + f.r[0] * 0.5, z: z + f.n[2] * 0.4 + f.r[2] * 0.5 });
        const e: SignExtra = { kind: 'tenants', f, u, top: y1, panels: panels.slice(0, n), flush, width, id };
        fits.set(e, y1 <= b.h - 0.8);
        return e;
      }
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

  /** A rect in a wall frame (along it u0..u1, out from it o0..o1), as a world rect (the frame is on the axes). */
  const rectIn = (f: WallFrame, u0: number, u1: number, o0: number, o1: number): Rect => {
    const xs = [f.p[0] + f.r[0] * u0 + f.n[0] * o0, f.p[0] + f.r[0] * u1 + f.n[0] * o1];
    const zs = [f.p[2] + f.r[2] * u0 + f.n[2] * o0, f.p[2] + f.r[2] * u1 + f.n[2] * o1];
    const x = Math.min(...xs);
    const z = Math.min(...zs);
    return { x, y: z, w: Math.max(...xs) - x, h: Math.max(...zs) - z };
  };

  const lookFor = (b: Building3, roll: number): SignLook | undefined => (P.looks ? pickLook(P.looks[CLASS[styleFor(b).trade as Trade] ?? 'daily'], roll) : undefined);

  // Upstairs tenants' words (blades: the wide ones; Kaburo's only the night trades'), from the 1992 words so they're
  // the same pick in every year.
  const tenantWords = plan.style.signWords.filter((w) => allWide(w) && (P.tenants === 'any' || CLASS[tradeOfWord(w) as Trade] === 'night'));
  const windowWords = WINDOW_WORDS[plan.kind] ?? [];

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
    const f = frontFrame(b);
    const front = s1 - s0;
    const midU = (s0 + s1) / 2;
    const trade = s.trade as Trade;
    const id = b.id * 16;
    let fascia: Sign3 | null = null;

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
        const sign = blade(b, p.x, p.z, p.nx, p.nz, text, color, look, Math.floor(h(4) * 2), b.sign.name);
        if (sign) {
          out.push(sign);
          placed = true;
        }
      }
      if (!placed) {
        const maxW = front - 0.6;
        if (maxW >= 1.5) {
          const open = !walled && (street.width >= 10 || !view || view.d >= 14);
          let fl: SignLook | undefined = P.looks && open && latin(text) && maxW >= 2.5 && h(5) < P.channel ? 'channel' : look;
          // (No neon glows at a wall: a tower's either.)
          const facing = opposite(b, mid.x, mid.z, mid.nx, mid.nz, around);
          if (fl === 'neon' && facing && facing.face !== 'front' && facing.d < WALLED) fl = 'lightbox';
          // A neon name may be in tubing (Latin letters), with its trade's pictogram.
          const icon = fl === 'neon' && ICON_OF[trade] && h(30) < 0.6 ? ICON_OF[trade] : undefined;
          const tube = fl === 'neon' && latin(text) && h(31) < 0.6;
          fascia = { text, vertical: false, color, x: mid.x + mid.nx * 0.4, y: 3.6, z: mid.z + mid.nz * 0.4, nx: mid.nx, nz: mid.nz, ...(fl ? { look: fl } : {}), ...(maxW < plateWidth(text) || icon || tube ? { maxW } : {}), ...(tube ? { form: 'tube' as const } : {}), ...(icon ? { icon } : {}) };
          out.push(fascia);
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
          const sign = blade(b, p.x, p.z, p.nx, p.nz, text, color, look, 1 + Math.floor(h(8) * 2), b.sign.name);
          if (sign) {
            out.push(sign);
            break;
          }
        }
      }
    }

    // Upstairs: the bars (Kaburo) or shops (Denkō-chō) on the floors above, their blades stacked up the front, or all on
    // one board (Kaburo's 袖看板; Denkō-chō's banner, flat down a tall building).
    let bannered = false;
    if (P.stack > 0 && tenantWords.length && tall >= 12 && tall < TOWER && front >= 3.5) {
      const vice = b.zone?.look.vice ?? 0.4;
      const chance = Math.min(0.9, P.tenants === 'night' ? P.stack * vice * 2 : P.stack);
      if (h(10) < chance) {
        const asBoard = E !== null && (P.tenants === 'night' ? h(20) < E.board : tall >= 18 && front >= 4.5 && h(20) < E.banner);
        const n = asBoard ? 3 + Math.floor(h(11) * 3) : h(11) < 0.4 ? 2 : 1;
        // (Not the shop's own word again, nor another tenant's.)
        let words = tenantWords.filter((w) => w !== b.sign?.word);
        const panels: Panel[] = [];
        const fits: string[] = [];
        for (let i = 0; i < n && words.length; i++) {
          const word = words[Math.floor(h(12 + i) * words.length)];
          words = words.filter((w) => w !== word);
          // (Each tenant its own name: shopNames.ts.)
          const name = filipino() ? word : shopName(word, hash(b.id, 60 + i));
          const text = eraSign(name);
          const color = plan.style.signColors[Math.floor(h(40 + i) * plan.style.signColors.length)];
          const tenantLook = P.looks ? pickLook(P.tenants === 'night' ? P.looks.night : P.looks.shop, h(50 + i)) : undefined;
          if (asBoard) {
            panels.push({ text, color, look: tenantLook ?? 'lightbox' });
            fits.push(name);
            continue;
          }
          for (const end of (h(18 + i) < 0.5 ? [0, 1] : [1, 0]) as (0 | 1)[]) {
            const p = onFront(b, end === 0 ? s0 + 1.2 : s1 - 1.2);
            const sign = blade(b, p.x, p.z, p.nx, p.nz, text, color, tenantLook, 1 + i, name);
            if (sign) {
              out.push(sign);
              break;
            }
          }
        }
        if (asBoard && panels.length >= 2) {
          const flush = P.tenants !== 'night';
          for (const end of (h(18) < 0.5 ? [0, 1] : [1, 0]) as (0 | 1)[]) {
            const e = board(b, end === 0 ? s0 + (flush ? 1.1 : 1.2) : s1 - (flush ? 1.1 : 1.2), panels, fits, flush, flush ? 2 : 3, id + 1);
            if (e) {
              extras.push(e);
              bannered = flush;
              break;
            }
          }
        }
      }
    }

    if (!E) continue;
    const wide = b.sign ? allWide(b.sign.text) : false;
    // A stand sign by the door of a bar, a snack, a mahjong parlour: on a pavement with room to pass it, or in a lane wide enough.
    if (b.sign && wide && STAND_TRADES.includes(trade) && h(21) < E.stand) {
      const u = Math.min(s1 - 0.5, Math.max(s0 + 0.5, midU + (h(22) < 0.5 ? -1 : 1)));
      const paved = street.sidewalk > 0;
      const out_ = paved ? 0.55 : 0.45;
      const room = paved ? street.d + street.sidewalk : street.width;
      if (paved ? room >= 1.9 : room >= 4) {
        const p = onFront(b, u);
        const sx = p.x + p.nx * out_;
        const sz = p.z + p.nz * out_;
        if (!taken(sx, sz, 0.6)) {
          extras.push({ kind: 'stand', f, u, out: out_, text: b.sign.text, color: b.sign.color, look: lookFor(b, h(1)) === 'neon' ? 'neon' : 'inverse', id: id + 2 });
          solids.push(rectIn(f, u - 0.2, u + 0.2, out_ - 0.28, out_ + 0.28));
          claims.push(rectIn(f, u - 0.6, u + 0.6, 0, out_ + 0.6));
        }
      }
    }
    // Red lanterns either side of an izakaya's door (one on a narrow front), under its sign.
    if (trade === TRADE.izakaya && !s.awning && front >= 2.8 && h(23) < E.lantern) {
      const word = b.sign?.word ?? '';
      const own = word.includes('焼鳥') || word.includes('焼き鳥') ? (h(24) < 0.5 ? '焼鳥' : 'やきとり') : word.includes('もつ') ? 'もつ焼' : word.includes('ホルモン') ? 'ホルモン' : word.includes('串') ? '串焼' : word.includes('煮込') ? 'おでん' : (['焼鳥', 'やきとり', 'おでん', '居酒屋'] as const)[Math.floor(h(24) * 4)];
      const us = front >= 4.5 ? [s0 + 0.9, s1 - 0.9] : [midU + (h(25) < 0.5 ? -0.6 : 0.6)];
      us.forEach((u, i) => extras.push({ kind: 'lantern', f, u, y: 2.55, text: i === 1 ? '酒' : own, id: id + 3 + i }));
    }
    // A love hotel's vacancy lamp and prices by its door, and (on a wide front) an arrow of bulbs to it.
    if (trade === TRADE.lovehotel && front >= 4 && year !== '1964') {
      const left = h(26) < 0.5;
      extras.push({ kind: 'hotel', f, u: left ? s0 + 1 : s1 - 1, y: 2.45, prices: HOTEL_PRICES[Math.floor(h(27) * HOTEL_PRICES.length)], full: h(28) < 0.25, id: id + 5 });
      if (front >= 7 && h(29) < 0.5) {
        const len = Math.min(2.2, front / 2 - 1.6);
        extras.push({ kind: 'arrow', f, u: left ? s1 - 0.6 : s0 + 0.6, y: 2.95, len, dir: left ? -1 : 1 });
      }
    }
    // Bulbs chasing round the shop's fascia (pachinko, a love hotel, a cabaret, a game centre).
    if (fascia && (BULBS[trade] ?? 0) > h(32)) {
      const { w, h: fh } = fasciaSize(fascia);
      extras.push({ kind: 'bulbs', f, u0: midU - w / 2 - 0.25, u1: midU + w / 2 + 0.25, y0: 3.62 - fh / 2 - 0.2, y1: 3.62 + fh / 2 + 0.2 });
    }
    // An LED board over the fascia, its message scrolling (1992's: pachinko, game centres, karaoke, Denkō-chō's shops).
    const led = LED[trade];
    if (led && year === '1992' && b.h >= 7 && front >= 6.2 && (trade !== TRADE.electronics || plan.kind === 'electric') && h(33) < led[1]) {
      const msgs = LED_MESSAGES[led[0]];
      extras.push({ kind: 'led', f, u: midU, y: 4.35, text: msgs[Math.floor(h(34) * msgs.length)], w: Math.min(front - 3.2, 9), id: id + 6 });
    }
    // The names of the offices and schools upstairs on their windows, a floor each (tenant buildings with ribbon windows,
    // whose glass runs the width of the floor; not the towers).
    if (windowWords.length && !bannered && tall >= 9 && tall < TOWER && front >= 3.6 && s.type === WIN.ribbon && h(35) < E.window) {
      let words = [...windowWords];
      // (On the glass: a shop's ground floor is 4.2 m, each floor over it 3 m with its windows from 0.9 m up: city.ts.)
      for (let j = 0; j < 3 && words.length; j++) {
        const y = GROUND_FLOOR + FLOOR * j + 0.75;
        if (y + 1.4 > Math.min(tall, BLADE_TOP)) break;
        if (h(37 + j) > 0.6) continue;
        const word = words[Math.floor(h(42 + j) * words.length)];
        words = words.filter((w) => w !== word);
        if (y + 1.4 > b.h - 0.3) continue;
        extras.push({ kind: 'window', f, u: midU, y, text: word, color: WINDOW_INK[Math.floor(h(46 + j) * WINDOW_INK.length)], maxW: front - 1.6, id: id + 7 + j });
      }
    }
    // A company's name along a tower's top (not one with letters on its roof).
    if (tall >= TOWER && b.h >= TOWER && h(51) < E.crown && !hasRooftopLetters(b)) {
      const ts = tiers(b);
      const tt = ts[ts.length - 1];
      const tf = tierFront(b, tt);
      const ft: WallFrame = { p: [f.p[0] - f.n[0] * tf.inset, 0, f.p[2] - f.n[2] * tf.inset], r: f.r, n: f.n };
      if (tf.fw >= 10) extras.push({ kind: 'crown', f: ft, u: ts.length === 1 ? midU : f.fw / 2, top: tt[3] - 0.3, text: CROWN_NAMES[Math.floor(h(52) * CROWN_NAMES.length)], maxW: tf.fw - 2, id: id + 12 });
    }
    // The small lit 24H box over the door of a karaoke box, a manga café, a coin laundry; OPEN over a café's.
    const cubeText = trade === TRADE.karaoke || trade === TRADE.books || trade === TRADE.laundry ? '24H' : trade === TRADE.cafe ? 'OPEN' : null;
    if (cubeText && year !== '1964' && !s.awning && front >= 3.5 && h(53) < E.cube) {
      const u = Math.min(s1 - 0.5, Math.max(s0 + 0.5, midU + (h(54) < 0.5 ? -1.3 : 1.3)));
      extras.push({ kind: 'cube', f, u, y: 2.75, text: cubeText, color: b.sign?.color ?? 0x4fe3ff, id: id + 13 });
    }
  }
  return { signs: out.filter((s) => fits.get(s) ?? true), extras: extras.filter((e) => fits.get(e) ?? true), claims, solids };
}
