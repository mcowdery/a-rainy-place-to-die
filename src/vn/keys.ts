import type { Node3, Placed3 } from '../poc3d/district/stamps';
import type { VnLibrary } from './engine';

/**
 * The keys a VN story can use, from the world: entry keys (nodes that hand off to VN mode: npcs, story doors,
 * hotspots) and exit keys (`exit:<key>` returns you to that spawn). For writing stories in Studio: a frame's
 * entry point is an entry key; a choice or hotspot target `exit:<key>` takes an exit key.
 */
export interface VnKeys {
  readonly schema: 1;
  readonly entries: Readonly<Record<string, { readonly name: string; readonly kind: string; readonly place: string; readonly floor: number; readonly scene: string | null }>>;
  readonly exits: Readonly<Record<string, { readonly name: string; readonly place: string; readonly floor: number }>>;
}

/** Whether a node hands off to VN mode (rather than being a spawn, a ride, or a plain doorway). */
export const isVnEntry = (n: Node3): boolean => n.kind === 'npc' || n.kind === 'hotspot' || (n.kind === 'door' && !n.through);

export function vnKeys(placed: readonly Placed3[], lib?: VnLibrary): VnKeys {
  const entries: Record<string, VnKeys['entries'][string]> = {};
  const exits: Record<string, VnKeys['exits'][string]> = {};
  for (const p of placed) {
    const place = p.stamp.name ?? p.id;
    for (const n of p.nodes) {
      if (isVnEntry(n)) entries[n.id] = { name: n.name ?? n.id, kind: n.kind, place, floor: n.floor, scene: lib?.entries.get(n.id) ?? null };
      else if (n.kind === 'spawn') exits[n.id] = { name: n.name ?? n.id, place, floor: n.floor };
    }
  }
  return { schema: 1, entries, exits };
}
