import YAML from 'yaml';
import type { Rect } from '../../core/coords';
import type { MacroMap } from '../../gen/macro';
import { CELL, edgeKey, type Road3 } from './plan';

/**
 * Avenues (content/world3d/roads.yaml): runs of cell-edge roads built wider than their district's own, for
 * driving, some with a raised central strip (a median, where the expressway's piers stand). The planner
 * (planCell3) takes them as a map from edge key to width and median; everything else (pavements, paint,
 * lanes, props, traffic, the GPS) follows from the plan's roads.
 */

export interface EdgeSpec {
  /** Kerb to kerb plus both pavements (m). */
  readonly width: number;
  /** Raised central strip (m, 0 for none). */
  readonly median: number;
  readonly name: string;
}

export type Avenues = ReadonlyMap<string, EdgeSpec>;

export function parseRoads3(file: string, text: string, macro: MacroMap, errors: string[]): Avenues {
  const err = (m: string): void => void errors.push(`${file}: ${m}`);
  const out = new Map<string, EdgeSpec>();
  let d: Record<string, unknown>;
  try {
    d = YAML.parse(text) as Record<string, unknown>;
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return out;
  }
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!Array.isArray(d?.avenues)) {
    err('avenues: a list');
    return out;
  }
  d.avenues.forEach((a: Record<string, unknown>, i: number) => {
    const at = `avenues[${i}]`;
    const row = a?.row;
    const col = a?.col;
    if (typeof a?.name !== 'string') err(`${at}.name: a name`);
    if ((row === undefined) === (col === undefined) || !num(row ?? col)) return err(`${at}: exactly one of row: n or col: n`);
    if (!num(a.from) || !num(a.to) || !(a.from < a.to)) return err(`${at}: from < to (cells along the line)`);
    if (!num(a.width) || a.width < 8 || a.width > 40) return err(`${at}.width: 8-40 m`);
    const median = a.median ?? 0;
    if (!num(median) || median < 0 || median > a.width / 2 - 6) return err(`${at}.median: 0 or up to half the width less 6 m`);
    const line = (row ?? col) as number;
    const limit = row !== undefined ? macro.rows : macro.cols;
    const span = row !== undefined ? macro.cols : macro.rows;
    if (line < 1 || line >= limit || a.from < 0 || (a.to as number) > span) return err(`${at}: off the map`);
    for (let k = a.from as number; k < (a.to as number); k++) {
      const key = row !== undefined ? edgeKey(k, line - 1, false) : edgeKey(line - 1, k, true);
      out.set(key, { width: a.width, median, name: a.name as string });
    }
  });
  return out;
}

/**
 * A street bridge (roads.yaml `bridges`): a road across water cells along a grid line, carrying on the cell-edge
 * roads either side of it (their ends meet it on the line). Its deck is at street level (the seawalls drop to the
 * water under it), with pavements, a median if it has one, parapets and lamps (real/sea.ts draws it); you walk,
 * drive and route over it (world.ts inDistrict, gps.ts), and past its parapets is the water.
 */
export interface Bridge3 {
  readonly name: string;
  /** The road, as a plan road (its rect spans the water cells it crosses). */
  readonly road: Road3;
  /** Its median strip (solid, like an avenue's), or null. */
  readonly median: Rect | null;
}

export function parseBridges(file: string, text: string, macro: MacroMap, errors: string[]): Bridge3[] {
  const err = (m: string): void => void errors.push(`${file}: ${m}`);
  let d: Record<string, unknown>;
  try {
    d = YAML.parse(text) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (d?.bridges === undefined) return [];
  if (!Array.isArray(d.bridges)) return err('bridges: a list'), [];
  const out: Bridge3[] = [];
  d.bridges.forEach((b: Record<string, unknown>, i: number) => {
    const at = `bridges[${i}]`;
    const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    if (typeof b?.name !== 'string') return err(`${at}.name: a name`);
    const row = b.row;
    const col = b.col;
    if ((row === undefined) === (col === undefined) || !num(row ?? col)) return err(`${at}: exactly one of row: n or col: n`);
    if (!num(b.from) || !num(b.to) || !(b.from < b.to)) return err(`${at}: from < to (the water cells it crosses)`);
    if (!num(b.width) || b.width < 8 || b.width > 40) return err(`${at}.width: 8-40 m`);
    const median = (b.median ?? 0) as number;
    if (!num(median) || median < 0 || median > b.width / 2 - 6) return err(`${at}.median: 0 or up to half the width less 6 m`);
    const vertical = col !== undefined;
    const line = (vertical ? col : row) as number;
    // Every cell it crosses is water on both sides of the line.
    for (let k = b.from as number; k < (b.to as number); k++) {
      for (const side of [line - 1, line]) {
        const [mx, my] = vertical ? [side, k] : [k, side];
        if (macro.kindAt(mx, my) !== 'water') return err(`${at}: cell [${mx}, ${my}] beside it isn't water`);
      }
    }
    const w = b.width as number;
    const c = line * CELL;
    const a0 = (b.from as number) * CELL;
    const a1 = (b.to as number) * CELL;
    const rect: Rect = vertical ? { x: c - w / 2, y: a0, w, h: a1 - a0 } : { x: a0, y: c - w / 2, w: a1 - a0, h: w };
    const road: Road3 = { rect, vertical, kind: w >= 14 ? 'boulevard' : 'street', sidewalk: Math.min(3, w * 0.2), median };
    const m: Rect | null = median ? (vertical ? { x: c - median / 2, y: a0, w: median, h: a1 - a0 } : { x: a0, y: c - median / 2, w: a1 - a0, h: median }) : null;
    out.push({ name: b.name as string, road, median: m });
  });
  return out;
}
