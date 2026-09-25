/**
 * The one coordinate convention in this codebase:
 * integer tile coordinates, origin at the world's north-west corner, +x east, +y south, always written [x, y].
 * "Local" coordinates (inside a stamp, lot or macro cell) use the same axes from that thing's north-west corner.
 */
export type Vec = readonly [x: number, y: number];

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
}

export const overlaps = (a: Rect, b: Rect): boolean => intersect(a, b) !== null;

export const contains = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

export const pad = (r: Rect, n: number): Rect => ({ x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n });

/** Packs two signed integers (|v| < 2^19) into one number, for Map keys. */
export const key2 = (a: number, b: number): number => (a + 0x80000) * 0x100000 + (b + 0x80000);
