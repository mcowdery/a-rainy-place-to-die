import { CHUNK_SHIFT } from '../config';
import { key2, type Rect } from '../core/coords';
import { compileCondition, type Condition } from '../core/condition';
import type { Facing, NodeKind, PlacedStamp, Trigger } from './stamps';

/**
 * L4: story nodes resolved to world coordinates. Ids are "<placement id>.<node id>", stable and
 * never reused. Nodes are bucketed by chunk so lookups near the player cost the same at any world size.
 */
export interface WorldNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly trigger: Trigger;
  readonly x: number;
  readonly y: number;
  readonly name: string | null;
  readonly conditionSrc: string | null;
  readonly condition: Condition | null;
  /** Full node id of a spawn. */
  readonly returnSpawn: string | null;
  readonly facing: Facing | null;
  readonly glyph: number | null;
  readonly fg: number | null;
  readonly handoff: unknown;
  readonly placementId: string;
  readonly placementName: string | null;
}

export class NodeIndex {
  readonly byId = new Map<string, WorldNode>();
  private byChunk = new Map<number, WorldNode[]>();

  add(n: WorldNode): void {
    this.byId.set(n.id, n);
    const k = key2(n.x >> CHUNK_SHIFT, n.y >> CHUNK_SHIFT);
    const list = this.byChunk.get(k);
    if (list) list.push(n);
    else this.byChunk.set(k, [n]);
  }

  at(x: number, y: number): WorldNode[] {
    return (this.byChunk.get(key2(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT)) ?? []).filter((n) => n.x === x && n.y === y);
  }

  inRect(r: Rect): WorldNode[] {
    const out: WorldNode[] = [];
    for (let cy = r.y >> CHUNK_SHIFT; cy <= (r.y + r.h - 1) >> CHUNK_SHIFT; cy++) {
      for (let cx = r.x >> CHUNK_SHIFT; cx <= (r.x + r.w - 1) >> CHUNK_SHIFT; cx++) {
        for (const n of this.byChunk.get(key2(cx, cy)) ?? []) {
          if (n.x >= r.x && n.y >= r.y && n.x < r.x + r.w && n.y < r.y + r.h) out.push(n);
        }
      }
    }
    return out;
  }

  ofKind(kind: NodeKind): WorldNode[] {
    return [...this.byId.values()].filter((n) => n.kind === kind);
  }
}

export function resolveNodes(placements: readonly PlacedStamp[], errors: string[]): NodeIndex {
  const index = new NodeIndex();
  for (const p of placements) {
    for (const { def, at } of p.stamp.nodes) {
      const id = `${p.id}.${def.id}`;
      if (index.byId.has(id)) {
        errors.push(`${p.stamp.file}: duplicate node id '${id}'`);
        continue;
      }
      const returnSpawn = def.returnSpawn === null ? null : def.returnSpawn.includes('.') ? def.returnSpawn : `${p.id}.${def.returnSpawn}`;
      index.add({
        id,
        kind: def.kind,
        trigger: def.trigger,
        x: p.rect.x + at[0],
        y: p.rect.y + at[1],
        name: def.name,
        conditionSrc: def.condition,
        condition: def.condition === null ? null : compileCondition(def.condition),
        returnSpawn,
        facing: def.facing,
        glyph: def.glyph,
        fg: def.fg,
        handoff: def.handoff,
        placementId: p.id,
        placementName: p.name,
      });
    }
  }
  for (const n of index.byId.values()) {
    if (n.returnSpawn === null) continue;
    const target = index.byId.get(n.returnSpawn);
    if (!target) errors.push(`node '${n.id}': returnSpawn '${n.returnSpawn}' does not exist`);
    else if (target.kind !== 'spawn') errors.push(`node '${n.id}': returnSpawn '${n.returnSpawn}' is a ${target.kind}, not a spawn`);
  }
  return index;
}
