import YAML from 'yaml';
import type { Rect, Vec } from '../core/coords';
import { compileCondition } from '../core/condition';
import { GLYPH_CONT, GLYPH_NONE, isWide } from '../core/wide';
import { PAL, T, TILES, isPaletteName, isTileName } from '../world/tiles';

/**
 * L3 stamps: hand-authored ASCII set pieces. One YAML file per stamp template:
 *
 *   id: neon_bar_kanpai
 *   legend:
 *     'r': roof_flat                          # char -> tile name
 *     '[': { tile: sign, fg: neon_pink }       # sign style: text between [ and ] is literal
 *     'D': { tile: door, node: door }          # node marker: must appear exactly once in art
 *   nodes:
 *     door: { kind: door, name: Bar Kanpai, returnSpawn: out }
 *   art: |
 *     rrrrrrr
 *     r[酒場]r
 *
 * Rules (all enforced, with file/row/col errors):
 *  - every art char outside [ ] must be in the legend; spaces are only allowed inside [ ]
 *  - wide (CJK) characters take 2 cells and are only allowed inside [ ]
 *  - the brackets themselves render as blank sign plate cells
 *  - every row must be the same width in cells (so CJK misalignment is a load error, not a visual bug)
 */

export type NodeKind = 'spawn' | 'door' | 'npc' | 'station' | 'hotspot';
export type Trigger = 'interact' | 'step_on' | 'none';
export type Facing = 'north' | 'south' | 'east' | 'west';

const NODE_KINDS: readonly NodeKind[] = ['spawn', 'door', 'npc', 'station', 'hotspot'];
const TRIGGERS: readonly Trigger[] = ['interact', 'step_on', 'none'];
const FACINGS: readonly Facing[] = ['north', 'south', 'east', 'west'];
export const ID_PATTERN = /^[a-z0-9_]+$/;

export interface StampNodeDef {
  readonly id: string;
  readonly kind: NodeKind;
  readonly trigger: Trigger;
  readonly name: string | null;
  readonly condition: string | null;
  /** Spawn id (local to the placement, or a full "placement.node" id) to put the player at afterwards. */
  readonly returnSpawn: string | null;
  readonly facing: Facing | null;
  readonly glyph: number | null;
  /** Palette index. */
  readonly fg: number | null;
  /** Opaque payload for the VN integration; the world never reads it. */
  readonly handoff: unknown;
}

export interface Stamp {
  readonly id: string;
  readonly file: string;
  readonly w: number;
  readonly h: number;
  readonly tile: Uint16Array;
  readonly glyph: Uint32Array;
  /** Palette index + 1, 0 = tile default. */
  readonly fg: Uint8Array;
  readonly nodes: readonly { readonly def: StampNodeDef; readonly at: Vec }[];
}

/** A stamp instance in the world. Node ids are namespaced by the placement id. */
export interface PlacedStamp {
  readonly id: string;
  readonly stamp: Stamp;
  readonly rect: Rect;
  readonly name: string | null;
}

interface LegendEntry {
  tile: number;
  fg: number;
  glyph: number;
  node: string | null;
}

interface Cell {
  tile: number;
  glyph: number;
  fg: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseStamp(file: string, text: string, errors: string[]): Stamp | null {
  const err = (msg: string): void => void errors.push(`${file}: ${msg}`);
  const before = errors.length;
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return null;
  }
  if (!isObj(doc)) return err('expected a mapping'), null;
  const id = doc.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) err(`id must match ${ID_PATTERN}`);
  if (!isObj(doc.legend)) return err('missing legend'), null;
  if (typeof doc.art !== 'string') return err('missing art (use a YAML block literal: art: |)'), null;

  // Legend
  const legend = new Map<string, LegendEntry>();
  for (const [ch, raw] of Object.entries(doc.legend)) {
    const cps = [...ch];
    if (cps.length !== 1 || ch === ' ' || ch === ']' || isWide(ch.codePointAt(0)!)) {
      err(`legend key '${ch}' must be a single narrow non-space character (and not ']')`);
      continue;
    }
    const e = isObj(raw) ? raw : { tile: raw };
    const tile = String(e.tile);
    if (!isTileName(tile)) {
      err(`legend '${ch}': unknown tile '${tile}'`);
      continue;
    }
    let fg = 0;
    if (e.fg !== undefined) {
      if (isPaletteName(String(e.fg))) fg = PAL[String(e.fg) as keyof typeof PAL] + 1;
      else err(`legend '${ch}': unknown palette colour '${String(e.fg)}'`);
    }
    let glyph = GLYPH_NONE;
    if (e.glyph !== undefined) {
      const g = [...String(e.glyph)];
      if (g.length !== 1 || isWide(g[0].codePointAt(0)!)) err(`legend '${ch}': glyph must be one narrow character`);
      else glyph = g[0].codePointAt(0)!;
    }
    legend.set(ch, { tile: T[tile], fg, glyph, node: e.node === undefined ? null : String(e.node) });
  }

  // Art
  const lines = doc.art.replace(/\r/g, '').split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const rows: Cell[][] = [];
  const markers = new Map<string, Vec[]>();
  lines.forEach((line, r) => {
    const row: Cell[] = [];
    let sign: LegendEntry | null = null;
    for (const ch of line) {
      const cp = ch.codePointAt(0)!;
      const col = row.length;
      if (sign) {
        if (ch === ']') {
          row.push({ tile: sign.tile, glyph: GLYPH_NONE, fg: sign.fg });
          sign = null;
        } else {
          row.push({ tile: sign.tile, glyph: ch === ' ' ? GLYPH_NONE : cp, fg: sign.fg });
          if (isWide(cp)) row.push({ tile: sign.tile, glyph: GLYPH_CONT, fg: sign.fg });
        }
        continue;
      }
      if (ch === '[') {
        const e = legend.get('[');
        if (!e) {
          err(`art row ${r} col ${col}: '[' used but no '[' sign style in legend`);
          row.push({ tile: T.void, glyph: 0, fg: 0 });
          continue;
        }
        sign = e;
        row.push({ tile: e.tile, glyph: GLYPH_NONE, fg: e.fg });
        continue;
      }
      if (isWide(cp)) {
        err(`art row ${r} col ${col}: wide character '${ch}' outside [ ] (CJK text belongs in a sign)`);
        row.push({ tile: T.void, glyph: 0, fg: 0 }, { tile: T.void, glyph: 0, fg: 0 });
        continue;
      }
      const e = legend.get(ch);
      if (!e) {
        err(`art row ${r} col ${col}: '${ch === ' ' ? 'space' : ch}' is not in the legend`);
        row.push({ tile: T.void, glyph: 0, fg: 0 });
        continue;
      }
      if (e.node) markers.set(e.node, [...(markers.get(e.node) ?? []), [col, r]]);
      row.push({ tile: e.tile, glyph: e.glyph, fg: e.fg });
    }
    if (sign) err(`art row ${r}: unclosed [`);
    rows.push(row);
  });
  if (rows.length === 0) return err('art is empty'), null;
  const w = rows[0].length;
  rows.forEach((row, r) => {
    if (row.length !== w) err(`art row ${r} is ${row.length} cells wide, expected ${w} (wide chars count as 2)`);
  });

  // Nodes
  const nodeSrc = isObj(doc.nodes) ? doc.nodes : {};
  const nodes: { def: StampNodeDef; at: Vec }[] = [];
  for (const [nid, raw] of Object.entries(nodeSrc)) {
    if (!ID_PATTERN.test(nid)) err(`node id '${nid}' must match ${ID_PATTERN}`);
    if (!isObj(raw)) {
      err(`node '${nid}' must be a mapping`);
      continue;
    }
    const def = parseNodeDef(nid, raw, err);
    const at = markers.get(nid) ?? [];
    if (at.length !== 1) {
      err(`node '${nid}' needs exactly one marker in art (legend entry with node: ${nid}), found ${at.length}`);
      continue;
    }
    if (def) nodes.push({ def, at: at[0] });
  }
  for (const m of markers.keys()) if (!(m in nodeSrc)) err(`legend marks node '${m}' but nodes: has no '${m}'`);
  for (const { def, at } of nodes) {
    const cell = rows[at[1]][at[0]];
    const standable = def.kind === 'spawn' || def.kind === 'npc' || def.trigger === 'step_on';
    if (standable && !TILES[cell.tile].walk) err(`node '${def.id}' (${def.kind}) is on non-walkable tile '${TILES[cell.tile].name}'`);
  }

  if (errors.length > before) return null;
  const h = rows.length;
  const tile = new Uint16Array(w * h);
  const glyph = new Uint32Array(w * h);
  const fg = new Uint8Array(w * h);
  rows.forEach((row, y) =>
    row.forEach((c, x) => {
      tile[y * w + x] = c.tile;
      glyph[y * w + x] = c.glyph;
      fg[y * w + x] = c.fg;
    }),
  );
  return { id: id as string, file, w, h, tile, glyph, fg, nodes };
}

function parseNodeDef(id: string, raw: Record<string, unknown>, err: (m: string) => void): StampNodeDef | null {
  const kind = raw.kind as NodeKind;
  if (!NODE_KINDS.includes(kind)) return err(`node '${id}': kind must be one of ${NODE_KINDS.join(', ')}`), null;
  const trigger = (raw.trigger ?? (kind === 'spawn' ? 'none' : 'interact')) as Trigger;
  if (!TRIGGERS.includes(trigger)) err(`node '${id}': trigger must be one of ${TRIGGERS.join(', ')}`);
  const facing = raw.facing === undefined ? null : (raw.facing as Facing);
  if (facing !== null && !FACINGS.includes(facing)) err(`node '${id}': facing must be one of ${FACINGS.join(', ')}`);
  const condition = raw.condition === undefined ? null : String(raw.condition);
  if (condition !== null) {
    try {
      compileCondition(condition);
    } catch (e) {
      err(`node '${id}': condition: ${(e as Error).message}`);
    }
  }
  const returnSpawn = raw.returnSpawn === undefined ? null : String(raw.returnSpawn);
  if ((kind === 'door' || kind === 'station') && returnSpawn === null) err(`node '${id}': ${kind} needs returnSpawn`);
  let glyph: number | null = null;
  if (kind === 'npc') {
    const g = [...String(raw.glyph ?? '&')];
    if (g.length !== 1 || isWide(g[0].codePointAt(0)!)) err(`node '${id}': glyph must be one narrow character`);
    glyph = g[0].codePointAt(0)!;
  }
  let fg: number | null = null;
  if (kind === 'npc') {
    const name = String(raw.fg ?? 'npc');
    if (isPaletteName(name)) fg = PAL[name];
    else err(`node '${id}': unknown palette colour '${name}'`);
  }
  return {
    id,
    kind,
    trigger,
    name: raw.name === undefined ? null : String(raw.name),
    condition,
    returnSpawn,
    facing,
    glyph,
    fg,
    handoff: raw.handoff ?? {},
  };
}
