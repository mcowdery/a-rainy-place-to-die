import YAML from 'yaml';
import type { MacroMap } from '../../gen/macro';
import { CELL } from './plan';

/** A railway line (content/world3d/rail.yaml), in world metres: it runs north-south along x. */
export interface RailLine3 {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string;
  readonly color: number;
  readonly x: number;
  readonly z0: number;
  readonly z1: number;
}

export function parseRail3(file: string, text: string, macro: MacroMap, errors: string[]): RailLine3 | null {
  const err = (m: string): void => void errors.push(`${file}: ${m}`);
  let doc: Record<string, unknown>;
  try {
    doc = YAML.parse(text) as Record<string, unknown>;
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return null;
  }
  const edge = doc?.edge;
  const rows = doc?.rows;
  if (typeof edge !== 'number' || !Number.isInteger(edge) || edge <= 0 || edge >= macro.cols) return err('edge must be an L0 column inside the map'), null;
  if (!Array.isArray(rows) || rows.length !== 2 || !rows.every((r) => Number.isInteger(r)) || rows[0] >= rows[1] || rows[0] < 0 || rows[1] >= macro.rows) {
    return err('rows must be [first, last] L0 rows inside the map'), null;
  }
  if (!/^#[0-9a-f]{6}$/i.test(String(doc.color))) err("color must be '#rrggbb'");
  return {
    id: String(doc.id),
    name: String(doc.name),
    nameEn: String(doc.nameEn),
    color: parseInt(String(doc.color).slice(1), 16),
    x: edge * CELL,
    z0: rows[0] * CELL,
    z1: (rows[1] + 1) * CELL,
  };
}
