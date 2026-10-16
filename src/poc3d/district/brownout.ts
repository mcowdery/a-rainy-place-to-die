import { hash } from '../../core/hash';
import type { Outlook } from './forecast';

/**
 * Manila's brownouts (CityConfig.tropical): the power fails over whole districts for an hour or two, in the monsoon's
 * storms and a typhoon above all, and now and then in the dry season's heat. A pure function of (cell, story time,
 * the forecast), so saves and clocks agree, as the forecast does: the city is cut into feeders (3 x 2 cells each, a
 * few hundred metres a side) and each feeder, in each `BLOCK`-minute block, may go dark for a spell inside it, by a
 * chance the weather sets. The wall shader reads the cells in the dark as a bit field (`brownoutWords`, uniform
 * `uOut`), so the street lamps, the signs, the shops' and the windows' lights go out by where they stand; the
 * junction signals fail the same way (`Signals.dead`: the cars take turns, nobody's lamps are lit).
 */

/** A block of story time, minutes. */
export const BLOCK = 120;
/** A feeder: this many cells across and down. */
export const FEEDER_W = 3;
export const FEEDER_H = 2;
/** Cells packed in a float's 24 bits. */
export const BITS = 24;

/** The feeder a cell is on. */
export const feederOf = (mx: number, my: number): [number, number] => [Math.floor(mx / FEEDER_W), Math.floor(my / FEEDER_H)];

/**
 * The chance a feeder is out in a block with this weather: a rare thing in the dry, more with a hot day's load, much more in
 * a monsoon downpour, and most in a typhoon (the lines are down); a day of floods keeps it off.
 */
export function outageChance(o: Pick<Outlook, 'typhoon' | 'amount' | 'heat' | 'temp' | 'flood' | 'weather'>): number {
  const storm = o.typhoon > 0 ? 0.22 + 0.6 * Math.min(1, o.typhoon) : 0;
  const rain = o.amount > 0.55 ? 0.1 + 0.2 * (o.amount - 0.55) / 0.45 : o.amount > 0.25 ? 0.05 : 0;
  const hot = o.heat || o.temp >= 34 ? 0.09 : 0.015;
  const flood = (o.flood ?? 0) * 0.2;
  return Math.min(0.85, Math.max(storm, rain, hot) + flood);
}

/** Whether a feeder is dark at story minute `total` (a spell inside its block, 40 to 110 minutes long). */
export function feederOut(fx: number, fy: number, total: number, chance: number): boolean {
  if (chance <= 0) return false;
  const block = Math.floor(total / BLOCK);
  const u = (hash(fx + 101, fy + 53, block, 0xb70) % 10000) / 10000;
  if (u >= chance) return false;
  const len = 40 + (hash(fx, fy, block, 0xb71) % 71);
  const start = hash(fx, fy, block, 0xb72) % (BLOCK - len + 1);
  const at = total - block * BLOCK;
  return at >= start && at < start + len;
}

/** What forces an outage (the debug menu, `?brownout=1`): the feeders round (cx, cy), a ring of `reach` feeders. */
export interface BrownoutForce {
  readonly cx: number;
  readonly cy: number;
  readonly reach: number;
}

/** Whether a cell is in the dark. */
export function cellOut(mx: number, my: number, total: number, chance: number, force: BrownoutForce | null): boolean {
  const [fx, fy] = feederOf(mx, my);
  if (force) {
    const [cx, cy] = feederOf(force.cx, force.cy);
    if (Math.abs(fx - cx) <= force.reach && Math.abs(fy - cy) <= force.reach) return true;
  }
  return feederOut(fx, fy, total, chance);
}

/** The cells in the dark as a bit field: `BITS` cells to a float (what a uniform float array carries exactly), row by row. */
export function brownoutWords(cols: number, rows: number, total: number, chance: number, force: BrownoutForce | null, into?: Float32Array): Float32Array {
  const n = Math.ceil((cols * rows) / BITS);
  const out = into && into.length === n ? into : new Float32Array(n);
  out.fill(0);
  for (let my = 0; my < rows; my++) {
    for (let mx = 0; mx < cols; mx++) {
      if (!cellOut(mx, my, total, chance, force)) continue;
      const i = my * cols + mx;
      out[Math.floor(i / BITS)] += 2 ** (i % BITS);
    }
  }
  return out;
}

/** The size of `brownoutWords` for a map (for the shader's array). */
export const wordCount = (cols: number, rows: number): number => Math.ceil((cols * rows) / BITS);

/**
 * The dark cells now, for what is on the page: the junction signals and the sound ask `at(x, z)`, the wall shader has `words`.
 * One per page (set by `main.ts` once a second or so).
 */
export class Brownout {
  words: Float32Array = new Float32Array(0);
  on = false;
  private cols = 0;
  private rows = 0;
  private cell = 128;

  set(cols: number, rows: number, cell: number, words: Float32Array): void {
    this.cols = cols;
    this.rows = rows;
    this.cell = cell;
    this.words = words;
    this.on = words.some((w) => w > 0);
  }

  /** Whether the cell at (mx, my) is in the dark. */
  cellDark(mx: number, my: number): boolean {
    if (!this.on || mx < 0 || my < 0 || mx >= this.cols || my >= this.rows) return false;
    const i = my * this.cols + mx;
    return Math.floor(this.words[Math.floor(i / BITS)] / 2 ** (i % BITS)) % 2 === 1;
  }

  /** Whether the point is in the dark. */
  at(x: number, z: number): boolean {
    return this.cellDark(Math.floor(x / this.cell), Math.floor(z / this.cell));
  }

  /** Whether the junction at grid point (gx, gy) has no power (the cell to its south-east). */
  junctionDead(gx: number, gy: number): boolean {
    return this.cellDark(gx, gy);
  }
}
