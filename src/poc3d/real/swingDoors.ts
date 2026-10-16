/**
 * Doors you open and close with E: hotspot nodes with `swing: true` (district/stamps.ts), kept shut until used.
 * One state shared by the door's drawing (it swings), the interior's collision (a shut door is a wall) and the
 * prompt, keyed by the node's id (`<placement>.<node>`). Not saved: every door starts shut.
 */
const open = new Map<string, boolean>();

export const doorOpen = (nodeId: string): boolean => open.get(nodeId) ?? false;

/** Flip a door; the new state (true: open). */
export function toggleDoor(nodeId: string): boolean {
  const v = !doorOpen(nodeId);
  open.set(nodeId, v);
  return v;
}
