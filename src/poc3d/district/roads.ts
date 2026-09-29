import YAML from 'yaml';
import type { MacroMap } from '../../gen/macro';
import { edgeKey } from './plan';

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
