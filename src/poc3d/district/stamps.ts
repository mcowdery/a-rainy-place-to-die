import YAML from 'yaml';
import { compileCondition, type Condition } from '../../core/condition';
import { overlaps, pad, type Rect } from '../../core/coords';
import { isLand, type MacroMap } from '../../gen/macro';
import { ID_PATTERN, type Facing, type NodeKind, type Trigger } from '../../content/stamps';
import { ASAGIRI_KINDS } from '../real/asagiri';
import { CELL, frontPoint, type Building3, type Side, type Sign3 } from './plan';

/**
 * 3D stamps: hand-authored set pieces for the district renderer (the 3D counterpart of the 2D ASCII-art
 * stamps). One YAML file per template:
 *
 *   id: bar_kanpai
 *   footprint: [12, 10]        # w (x) and d (z) in metres
 *   height: 9
 *   hue: '#ff5fc8'
 *   front: south               # face on the street; the door, signs and nodes are placed along it
 *   signs:
 *     - { text: かんぱい, vertical: true, at: [1.5, 8.5], color: '#ff5fc8' }   # at: [u along front, height]
 *   nodes:
 *     door: { kind: door, name: Bar Kanpai, at: [6, 0], returnSpawn: out }    # at: [u along front, metres out]
 *     out:  { kind: spawn, at: [6, 3], facing: south }
 *
 * A landmark stamp (landmark: mega_sign) keeps its footprint, collision and forecourt, but its mass is not
 * built by the chunk workers: the main thread adds the landmark itself (see real/megaSign.ts). A node may
 * set view: [yaw, pitch] in degrees for the camera when spawning there (overrides facing). A named spawn is
 * a fast-travel destination. An npc may set figure: { body, pose, hair, long, color, turn } for its ghost
 * (turn: radians from facing the street). A stamp's name is shown in the HUD while you're inside it.
 * A node's floor (metres, default 0) puts it on a raised level (a station platform). A station stamp gives
 * its names, station: { jp, en }; a station node takes the train to its returnSpawn (the world rides it,
 * it doesn't go to the VN). A stamp may
 * reserve an open plaza, plaza: { at: [x, z], size: [w, d] } in metres from the footprint's NW corner; it
 * may reach into neighbouring cells (e.g. the other corners of a junction), and no lot is built on it.
 * scramble: [x, z] (from the footprint's NW corner) marks a junction to paint as a scramble crossing.
 *
 * u runs along the front face from its left end as seen from the street. Placements anchor a template to
 * an L0 macro cell + offset (content/world3d/placements.yaml), exactly like the 2D placements.
 * Node ids are "<placement id>.<node id>".
 */

/** Landmarks built on the main thread instead of as a plain building mass. */
export const LANDMARKS = ['mega_sign', 'konbini', 'shrine', 'love_hotel', 'live_house', 'yokocho', 'ryujin', 'discount', 'station', 'subway', ...ASAGIRI_KINDS] as const;
export type Landmark = (typeof LANDMARKS)[number];

/** How an npc's ghost looks (see real/people.ts); anything left out gets a default. */
export interface NodeFigure {
  readonly body?: 'man' | 'woman' | 'child' | 'elder';
  readonly pose?: 'stand' | 'walk' | 'talk' | 'phone' | 'pockets' | 'wave' | 'hold';
  readonly hair?: 'short' | 'long' | 'bun' | 'hat' | 'cap' | 'none';
  readonly long?: boolean;
  readonly color?: number;
  /** Radians, relative to facing the street. */
  readonly turn?: number;
}

export interface StampSign {
  readonly text: string;
  readonly vertical: boolean;
  readonly u: number;
  readonly y: number;
  readonly color: number;
}

export interface StampNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly trigger: Trigger;
  readonly name: string | null;
  readonly condition: string | null;
  readonly returnSpawn: string | null;
  readonly facing: Facing | null;
  readonly view: readonly [number, number] | null;
  readonly figure: NodeFigure | null;
  readonly floor: number;
  readonly u: number;
  readonly out: number;
  readonly handoff: unknown;
}

export interface Stamp3 {
  readonly id: string;
  readonly file: string;
  /** Display name (HUD), if any. */
  readonly name: string | null;
  readonly w: number;
  readonly d: number;
  readonly height: number;
  readonly hue: number | null;
  readonly front: Side;
  readonly landmark: Landmark | null;
  /** A station's names (landmark station). */
  readonly station: { readonly jp: string; readonly en: string } | null;
  /** Open ground kept free of lots, relative to the footprint's NW corner. */
  readonly plaza: Rect | null;
  /** A junction (its centre, relative to the footprint's NW corner) painted as a scramble crossing. */
  readonly scramble: readonly [number, number] | null;
  readonly signs: readonly StampSign[];
  readonly nodes: readonly StampNode[];
}

/** A node resolved to world coordinates. Satisfies the VN bridge's HandoffNode. */
export interface Node3 {
  readonly id: string;
  readonly kind: NodeKind;
  readonly trigger: Trigger;
  readonly name: string | null;
  readonly condition: Condition | null;
  readonly returnSpawn: string | null;
  readonly facing: Facing | null;
  /** Spawn camera [yaw, pitch] in degrees, if the stamp sets one. */
  readonly view: readonly [number, number] | null;
  readonly figure: NodeFigure | null;
  /** Height of the node's floor (0 on the street, raised on a platform). */
  readonly floor: number;
  /** The facade normal of the stamp's street face (npcs face it by default). */
  readonly nx: number;
  readonly nz: number;
  readonly x: number;
  readonly z: number;
  readonly handoff: unknown;
  readonly placementId: string;
}

export interface Placed3 {
  readonly id: string;
  readonly stamp: Stamp3;
  /** Footprint in world metres (y = z). */
  readonly rect: Rect;
  readonly cell: readonly [number, number];
  readonly building: Building3;
  readonly signs: readonly Sign3[];
  readonly nodes: readonly Node3[];
}

const SIDES: readonly Side[] = ['north', 'south', 'east', 'west'];
const KINDS: readonly NodeKind[] = ['spawn', 'door', 'npc', 'station', 'hotspot'];
const HEX = /^#[0-9a-f]{6}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number');

export function parseStamp3(file: string, text: string, errors: string[]): Stamp3 | null {
  const err = (m: string): void => void errors.push(`${file}: ${m}`);
  const before = errors.length;
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return null;
  }
  if (!isObj(doc)) return err('expected a mapping'), null;
  const id = String(doc.id);
  if (!ID_PATTERN.test(id)) err(`id must match ${ID_PATTERN}`);
  if (!isPair(doc.footprint) || doc.footprint.some((n) => n <= 0)) err('footprint must be [w, d] in metres');
  if (typeof doc.height !== 'number' || doc.height <= 0) err('height must be a positive number of metres');
  const front = (doc.front ?? 'south') as Side;
  if (!SIDES.includes(front)) err(`front must be one of ${SIDES.join(', ')}`);
  if (doc.hue !== undefined && !HEX.test(String(doc.hue))) err("hue must be '#rrggbb'");
  const landmark = doc.landmark === undefined ? null : (String(doc.landmark) as Landmark);
  if (landmark !== null && !LANDMARKS.includes(landmark)) err(`landmark must be one of ${LANDMARKS.join(', ')}`);
  if (doc.scramble !== undefined && !isPair(doc.scramble)) err('scramble must be [x, z] in metres from the footprint');
  const st = doc.station;
  const stationNames = isObj(st) && typeof st.jp === 'string' && typeof st.en === 'string' ? { jp: st.jp, en: st.en } : null;
  if (st !== undefined && !stationNames) err('station must be { jp, en }');
  if ((landmark === 'station' || landmark === 'subway') && !stationNames) err(`a ${landmark} landmark needs station: { jp, en }`);
  let plaza: Rect | null = null;
  if (doc.plaza !== undefined) {
    const q = doc.plaza;
    if (!isObj(q) || !isPair(q.at) || !isPair(q.size) || q.size.some((n) => n <= 0)) err('plaza must be { at: [x, z], size: [w, d] } in metres');
    else plaza = { x: q.at[0], y: q.at[1], w: q.size[0], h: q.size[1] };
  }
  const [w, d] = isPair(doc.footprint) ? doc.footprint : [1, 1];
  const frontLen = front === 'north' || front === 'south' ? w : d;

  const signs: StampSign[] = [];
  for (const [i, s] of (Array.isArray(doc.signs) ? doc.signs : []).entries()) {
    if (!isObj(s) || typeof s.text !== 'string' || !isPair(s.at)) {
      err(`sign ${i}: needs text and at: [u, height]`);
      continue;
    }
    if (!HEX.test(String(s.color ?? '#ffffff'))) err(`sign ${i}: color must be '#rrggbb'`);
    if (s.at[0] < 0 || s.at[0] > frontLen) err(`sign ${i}: u ${s.at[0]} is off the ${frontLen} m front`);
    signs.push({ text: s.text, vertical: s.vertical === true, u: s.at[0], y: s.at[1], color: parseInt(String(s.color ?? '#ffffff').slice(1), 16) });
  }

  const nodes: StampNode[] = [];
  const src = isObj(doc.nodes) ? doc.nodes : {};
  for (const [nid, raw] of Object.entries(src)) {
    if (!ID_PATTERN.test(nid)) err(`node id '${nid}' must match ${ID_PATTERN}`);
    if (!isObj(raw)) {
      err(`node '${nid}' must be a mapping`);
      continue;
    }
    const kind = raw.kind as NodeKind;
    if (!KINDS.includes(kind)) err(`node '${nid}': kind must be one of ${KINDS.join(', ')}`);
    if (!isPair(raw.at)) err(`node '${nid}': at must be [u along front, metres out]`);
    const condition = raw.condition === undefined ? null : String(raw.condition);
    if (condition !== null) {
      try {
        compileCondition(condition);
      } catch (e) {
        err(`node '${nid}': condition: ${(e as Error).message}`);
      }
    }
    const returnSpawn = raw.returnSpawn === undefined ? null : String(raw.returnSpawn);
    if ((kind === 'door' || kind === 'station') && returnSpawn === null) err(`node '${nid}': ${kind} needs returnSpawn`);
    if (raw.view !== undefined && !isPair(raw.view)) err(`node '${nid}': view must be [yaw, pitch] in degrees`);
    let figure: NodeFigure | null = null;
    if (raw.figure !== undefined) {
      const f = raw.figure;
      if (!isObj(f)) err(`node '${nid}': figure must be a mapping`);
      else {
        const pick = <T extends string>(k: string, opts: readonly T[]): T | undefined => {
          if (f[k] === undefined) return undefined;
          if (!opts.includes(f[k] as T)) err(`node '${nid}': figure.${k} must be one of ${opts.join(', ')}`);
          return f[k] as T;
        };
        if (f.color !== undefined && !HEX.test(String(f.color))) err(`node '${nid}': figure.color must be '#rrggbb'`);
        figure = {
          body: pick('body', ['man', 'woman', 'child', 'elder'] as const),
          pose: pick('pose', ['stand', 'walk', 'talk', 'phone', 'pockets', 'wave', 'hold'] as const),
          hair: pick('hair', ['short', 'long', 'bun', 'hat', 'cap', 'none'] as const),
          long: f.long === undefined ? undefined : f.long === true,
          color: f.color === undefined ? undefined : parseInt(String(f.color).slice(1), 16),
          turn: typeof f.turn === 'number' ? f.turn : undefined,
        };
      }
    }
    const [u, out] = isPair(raw.at) ? raw.at : [0, 0];
    nodes.push({
      id: nid,
      kind,
      trigger: (raw.trigger ?? (kind === 'spawn' ? 'none' : 'interact')) as Trigger,
      name: raw.name === undefined ? null : String(raw.name),
      condition,
      returnSpawn,
      facing: (raw.facing ?? null) as Facing | null,
      view: isPair(raw.view) ? raw.view : null,
      figure,
      floor: typeof raw.floor === 'number' ? raw.floor : 0,
      u,
      out,
      handoff: raw.handoff ?? {},
    });
  }
  if (errors.length > before) return null;
  return { id, file, name: typeof doc.name === 'string' ? doc.name : null, w, d, height: doc.height as number, hue: doc.hue === undefined ? null : parseInt(String(doc.hue).slice(1), 16), front, landmark, station: stationNames, plaza, scramble: isPair(doc.scramble) ? doc.scramble : null, signs, nodes };
}

/** The planner's reserved area for a stamp: its footprint plus an open forecourt in front of the street face. */
export function reservedRect(p: Placed3): Rect {
  const r = pad(p.rect, 2);
  const apron = 10;
  switch (p.stamp.front) {
    case 'south': return { ...r, h: r.h + apron };
    case 'north': return { ...r, y: r.y - apron, h: r.h + apron };
    case 'east': return { ...r, w: r.w + apron };
    case 'west': return { ...r, x: r.x - apron, w: r.w + apron };
  }
}

/** A stamp's plaza in world metres, if it has one. */
export function plazaRect(p: Placed3): Rect | null {
  const q = p.stamp.plaza;
  return q ? { x: p.rect.x + q.x, y: p.rect.y + q.y, w: q.w, h: q.h } : null;
}

/** Stamps keep this far inside their cell so they clear the widest edge road (half of 16 m) plus a margin. */
const CELL_MARGIN = 10;

/**
 * placements.yaml: - { id, stamp, cell: [mx, my], offset: [ox, oz] }  (offset: metres from the cell's NW
 * corner to the footprint's NW corner). Validates ids, bounds, overlaps and node references.
 */
export function placeStamps3(file: string, text: string, macro: MacroMap, stamps: ReadonlyMap<string, Stamp3>, errors: string[]): Placed3[] {
  const err = (m: string): void => void errors.push(`${file}: ${m}`);
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return [];
  }
  if (!Array.isArray(doc)) return err('expected a list of placements'), [];
  const out: Placed3[] = [];
  doc.forEach((p: Record<string, unknown>, i) => {
    const id = String(p.id);
    const at = `placement ${i} (${id})`;
    if (!ID_PATTERN.test(id)) return err(`${at}: id must match ${ID_PATTERN}`);
    if (out.some((o) => o.id === id)) return err(`${at}: duplicate placement id`);
    const stamp = stamps.get(String(p.stamp));
    if (!stamp) return err(`${at}: unknown stamp '${String(p.stamp)}'`);
    if (!isPair(p.cell) || !isPair(p.offset)) return err(`${at}: cell and offset must be [x, y] pairs`);
    const [mx, my] = p.cell;
    if (!isLand(macro.kindAt(mx, my))) return err(`${at}: cell [${mx}, ${my}] is not a district`);
    const [ox, oz] = p.offset;
    if (ox < CELL_MARGIN || oz < CELL_MARGIN || ox + stamp.w > CELL - CELL_MARGIN || oz + stamp.d > CELL - CELL_MARGIN) {
      return err(`${at}: ${stamp.w}x${stamp.d} m stamp must stay ${CELL_MARGIN} m inside its ${CELL} m cell`);
    }
    const rect: Rect = { x: mx * CELL + ox, y: my * CELL + oz, w: stamp.w, h: stamp.d };
    const clash = out.find((o) => overlaps(pad(o.rect, 2), rect));
    if (clash) return err(`${at}: overlaps placement '${clash.id}'`);
    const building: Building3 = {
      id: 900000 + i,
      x: rect.x + stamp.w / 2,
      z: rect.y + stamp.d / 2,
      w: stamp.w,
      d: stamp.d,
      h: stamp.height,
      front: stamp.front,
      ...(stamp.hue === null ? {} : { hue: stamp.hue }),
    };
    const signs: Sign3[] = stamp.signs.map((s) => {
      const q = frontPoint(building, s.u, 0.4);
      return { text: s.text, vertical: s.vertical, color: s.color, x: q.x, y: s.y, z: q.z, nx: q.nx, nz: q.nz };
    });
    const nodes: Node3[] = stamp.nodes.map((n) => {
      const q = frontPoint(building, n.u, n.out);
      return {
        id: `${id}.${n.id}`,
        kind: n.kind,
        trigger: n.trigger,
        name: n.name,
        condition: n.condition === null ? null : compileCondition(n.condition),
        returnSpawn: n.returnSpawn === null ? null : n.returnSpawn.includes('.') ? n.returnSpawn : `${id}.${n.returnSpawn}`,
        facing: n.facing,
        view: n.view,
        figure: n.figure,
        floor: n.floor,
        nx: q.nx,
        nz: q.nz,
        x: q.x,
        z: q.z,
        handoff: n.handoff,
        placementId: id,
      };
    });
    out.push({ id, stamp, rect, cell: [mx, my], building, signs, nodes });
  });
  for (const p of out) {
    const q = plazaRect(p);
    const clash = q && out.find((o) => o !== p && overlaps(o.rect, q));
    if (clash) err(`placement '${p.id}': its plaza covers placement '${clash.id}'`);
  }
  const all = new Map(out.flatMap((p) => p.nodes.map((n) => [n.id, n] as const)));
  for (const n of all.values()) {
    if (n.returnSpawn === null) continue;
    const t = all.get(n.returnSpawn);
    if (!t) err(`node '${n.id}': returnSpawn '${n.returnSpawn}' does not exist`);
    else if (t.kind !== 'spawn') err(`node '${n.id}': returnSpawn '${n.returnSpawn}' is a ${t.kind}, not a spawn`);
  }
  return out;
}
