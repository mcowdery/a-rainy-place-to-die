/**
 * Deterministic hashing and seeded RNG. All generation goes through these so that
 * (seed, coordinates, generatorVersion) fully determines the world.
 */

function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash of up to four integers to an unsigned 32-bit int. Fixed arity so the renderer's hot loop doesn't allocate. */
export function hash(a: number, b = 0, c = 0, d = 0): number {
  let h = mix32(Math.imul(0x811c9dc5 ^ (a | 0), 0x01000193) + 0x9e3779b9);
  h = mix32(Math.imul(h ^ (b | 0), 0x01000193) + 0x9e3779b9);
  h = mix32(Math.imul(h ^ (c | 0), 0x01000193) + 0x9e3779b9);
  h = mix32(Math.imul(h ^ (d | 0), 0x01000193) + 0x9e3779b9);
  return h;
}

/** Maps a 32-bit hash to [0, 1). */
export const u01 = (h: number): number => h / 4294967296;

export interface Rng {
  u32(): number;
  float(): number;
  /** Inclusive on both ends. */
  int(min: number, max: number): number;
  range(r: readonly [number, number]): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<K extends string>(weights: Readonly<Partial<Record<K, number>>>): K;
}

/** mulberry32 */
export function rng(seed: number): Rng {
  let s = seed >>> 0;
  const u32 = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  const float = (): number => u32() / 4294967296;
  const int = (min: number, max: number): number => min + Math.floor(float() * (max - min + 1));
  return {
    u32,
    float,
    int,
    range: (r) => int(r[0], r[1]),
    chance: (p) => float() < p,
    pick: (items) => items[Math.floor(float() * items.length)],
    weighted<K extends string>(weights: Readonly<Partial<Record<K, number>>>): K {
      const entries = Object.entries(weights) as [K, number][];
      let total = 0;
      for (const [, w] of entries) total += w;
      let roll = float() * total;
      for (const [k, w] of entries) {
        roll -= w;
        if (roll < 0) return k;
      }
      return entries[entries.length - 1][0];
    },
  };
}
