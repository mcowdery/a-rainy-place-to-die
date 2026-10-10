import YAML from 'yaml';
import type { Rect } from '../../core/coords';
import { CELL, edgeKey } from './plan';
import type { Avenues } from './roads';

/**
 * Pedestrian footbridges (content/manila/footbridges.yaml): the covered concrete-and-steel walkways over a wide avenue
 * with a stair on each pavement, one of Metro Manila's signs. A bridge is a pure function of its site and the avenue's
 * width: this module has the layout (decks, stairs, rails, columns) as numbers, the floor under a point, and the
 * collision on the ground and up on the deck. real/manilaStreet.ts draws it (the prop kind `footbridge`),
 * district/world.ts walks it (floor and collision) and real/props.ts keeps lamps and trees out of its stairs.
 *
 * The frame: s runs along the avenue, t across it from the road's centre line; the pavements are the outer 3 m each way
 * (plan.ts `sidewalk`). The deck is 2 m wide at `DECK_Y`, 5.9 m up (5.5 m clear under it for a bus), reaching a landing
 * on each pavement, from which a straight stair runs down along the pavement each way.
 */

export const DECK_Y = 5.9;
/** Half the clear width of the deck and landings. */
export const DECK_HALF = 1.0;
/** Stair: its rise, run and number of steps. */
export const STEPS = 34;
export const TREAD = 0.28;
export const STAIR_LEN = STEPS * TREAD;
/** Half the stair's width. */
export const STAIR_HALF = 0.9;
/** The pavement's raised height, where a stair starts. */
export const KERB_Y = 0.15;
/** The pavement's width on each side of an avenue. */
const PAVEMENT = 3;

export interface Footbridge {
  readonly id: string;
  /** The centre of the span on the avenue's centre line. */
  readonly x: number;
  readonly z: number;
  /** The avenue runs along x (a row) or along z (a column). */
  readonly alongX: boolean;
  /** The avenue's full width, pavements included. */
  readonly width: number;
  /** The median's width (a column pair stands in it), 0 for none. */
  readonly median: number;
}

/** How far across from the centre line the stairs' centre lines are. */
export const stairT = (b: Footbridge): number => b.width / 2 - PAVEMENT / 2;

let LIST: readonly Footbridge[] = [];
/** The footbridges of the city being built (set by loadDistrictContent, as the page and each worker load it). */
export function setFootbridges(list: readonly Footbridge[]): void {
  LIST = list;
}
export const footbridges = (): readonly Footbridge[] => LIST;

/** The bridges whose reach (a stair's end) is within `m` metres of a point. */
export function footbridgesNear(x: number, z: number, m = 0): Footbridge[] {
  const out: Footbridge[] = [];
  for (const b of LIST) {
    const R = STAIR_LEN + 3 + m;
    const T = b.width / 2 + m;
    const dx = Math.abs(x - b.x);
    const dz = Math.abs(z - b.z);
    if (b.alongX ? dx < R && dz < T : dz < R && dx < T) out.push(b);
  }
  return out;
}

/** A world point's (s, t) in the bridge's frame. */
export const toLocal = (b: Footbridge, x: number, z: number): [number, number] => (b.alongX ? [x - b.x, z - b.z] : [z - b.z, x - b.x]);

/** A rect in the bridge's frame (s0..s1 along, t0..t1 across) as a world rect. */
export function localRect(b: Footbridge, s0: number, s1: number, t0: number, t1: number): Rect {
  return b.alongX ? { x: b.x + s0, y: b.z + t0, w: s1 - s0, h: t1 - t0 } : { x: b.x + t0, y: b.z + s0, w: t1 - t0, h: s1 - s0 };
}

/**
 * The floor in a point's place: a stair's ramp (always: it is solid under), or the deck and landings when the walker is
 * already up (`current`, relative to the ground; null under them, where the street is).
 */
export function footbridgeFloor(b: Footbridge, x: number, z: number, current: number): number | null {
  const [s, t] = toLocal(b, x, z);
  const T = stairT(b);
  const as = Math.abs(s);
  if (as <= DECK_HALF + STAIR_LEN + 0.01 && as >= DECK_HALF) {
    for (const e of [-1, 1]) {
      if (Math.abs(t - e * T) <= STAIR_HALF) return KERB_Y + (DECK_Y - KERB_Y) * (1 - (as - DECK_HALF) / STAIR_LEN);
    }
  }
  if (as <= DECK_HALF && Math.abs(t) <= T + 1.0) return current > DECK_Y / 2 ? DECK_Y : null;
  return null;
}

/** Collision at street level, for walkers and cars both: the stairs' solid towers and their sides, the median columns. */
export function footbridgeGround(b: Footbridge): Rect[] {
  const T = stairT(b);
  const out: Rect[] = [];
  const top = DECK_HALF + STAIR_LEN - 3.2;
  for (const e of [-1, 1]) {
    out.push(localRect(b, -top, top, e * T - STAIR_HALF - 0.15, e * T + STAIR_HALF + 0.15));
    for (const d of [-1, 1]) {
      for (const k of [-1, 1]) {
        const t = e * T + k * (STAIR_HALF + 0.075);
        out.push(localRect(b, d > 0 ? top : -DECK_HALF - STAIR_LEN, d > 0 ? DECK_HALF + STAIR_LEN : -top, t - 0.075, t + 0.075));
      }
    }
  }
  if (b.median > 0) for (const d of [-1, 1]) out.push(localRect(b, d * 0.8 - 0.25, d * 0.8 + 0.25, -0.25, 0.25));
  return out;
}

/** Collision on the deck and the stairs above the first metre: the rails. */
export function footbridgeRaised(b: Footbridge): Rect[] {
  const T = stairT(b);
  const out: Rect[] = [];
  for (const d of [-1, 1]) {
    // The deck's side rails, between the landings.
    out.push(localRect(b, d > 0 ? DECK_HALF : -DECK_HALF - 0.15, d > 0 ? DECK_HALF + 0.15 : -DECK_HALF, -T + 1.0, T - 1.0));
  }
  for (const e of [-1, 1]) {
    // The landing's outer end, and the stairs' rails.
    out.push(localRect(b, -DECK_HALF - 0.15, DECK_HALF + 0.15, e > 0 ? T + 1.0 : -T - 1.15, e > 0 ? T + 1.15 : -T - 1.0));
    for (const d of [-1, 1]) {
      for (const k of [-1, 1]) {
        const t = e * T + k * (STAIR_HALF + 0.075);
        out.push(localRect(b, d > 0 ? DECK_HALF : -DECK_HALF - STAIR_LEN, d > 0 ? DECK_HALF + STAIR_LEN : -DECK_HALF, t - 0.075, t + 0.075));
      }
    }
  }
  return out;
}

/** The roofed length over the deck, as a rain shelter. */
export function footbridgeShelter(b: Footbridge): { rect: Rect; y0: number; y1: number } {
  const T = stairT(b);
  return { rect: localRect(b, -DECK_HALF - 0.3, DECK_HALF + 0.3, -T - 1.0, T + 1.0), y0: DECK_Y - 0.5, y1: DECK_Y + 3.2 };
}

/** The ground a bridge and its stairs cover (nothing is planted under it). */
export function footbridgeReach(b: Footbridge): Rect {
  const T = stairT(b);
  return localRect(b, -DECK_HALF - STAIR_LEN - 1, DECK_HALF + STAIR_LEN + 1, -T - 1.2, T + 1.2);
}

/** Whether a point is in a bridge's stairs or tower, within `m` (for keeping lamps, poles and trees out of them). */
export function underFootbridge(x: number, z: number, m = 0.8): boolean {
  for (const b of footbridgesNear(x, z, 2)) {
    const [s, t] = toLocal(b, x, z);
    const T = stairT(b);
    if (Math.abs(s) < DECK_HALF + STAIR_LEN + m && (Math.abs(t - T) < STAIR_HALF + 0.3 + m || Math.abs(t + T) < STAIR_HALF + 0.3 + m)) return true;
  }
  return false;
}

/**
 * footbridges.yaml: `footbridges: [{ row: n, at: cells }, { col: n, at: cells }]`, `at` the span's place along the
 * avenue in cells from the map's origin (a row's x, a column's z); the width and median are the avenue's.
 */
export function parseFootbridges(file: string, text: string, avenues: Avenues, errors: string[]): Footbridge[] {
  const err = (m: string): void => void errors.push(`${file}: ${m}`);
  let d: { footbridges?: unknown };
  try {
    d = (YAML.parse(text) ?? {}) as { footbridges?: unknown };
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return [];
  }
  if (d.footbridges === undefined) return [];
  if (!Array.isArray(d.footbridges)) {
    err('footbridges: a list');
    return [];
  }
  const out: Footbridge[] = [];
  d.footbridges.forEach((a: Record<string, unknown>, i: number) => {
    const at = `footbridges[${i}]`;
    const row = a?.row;
    const col = a?.col;
    const pos = a?.at;
    if ((row === undefined) === (col === undefined) || typeof (row ?? col) !== 'number' || typeof pos !== 'number') return err(`${at}: one of row: n or col: n, and at: cells`);
    const line = (row ?? col) as number;
    const k = Math.floor(pos);
    const spec = avenues.get(row !== undefined ? edgeKey(k, line - 1, false) : edgeKey(line - 1, k, true));
    if (!spec || spec.bridge) return err(`${at}: no avenue at ${row !== undefined ? 'row' : 'col'} ${line}, ${pos}`);
    if (spec.width < 20) return err(`${at}: the avenue is ${spec.width} m, too narrow for a footbridge`);
    out.push({ id: `fb_${row !== undefined ? 'r' : 'c'}${line}_${Math.round(pos * 100)}`, x: row !== undefined ? pos * CELL : line * CELL, z: row !== undefined ? line * CELL : pos * CELL, alongX: row !== undefined, width: spec.width, median: spec.median });
  });
  return out;
}
