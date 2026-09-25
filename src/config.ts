/**
 * Tunable scale and feel parameters. Everything here is expected to change after playtesting;
 * nothing authored (stamps, placements, nodes) depends on these values, so tuning is safe.
 */
export const CONFIG = {
  /** World seed. Changing it reshuffles all generated (L1/L2) content; authored L3/L4 content is unaffected. */
  seed: 0x0c179090,
  /** Bump when a generator change is intentional. It is mixed into every cell seed, so all filler reshuffles at once. */
  generatorVersion: 1,
  /** Macro cell size in tiles (one character of the L0 map). 128x64 is square on screen with 1:2 cells. */
  cellW: 128,
  cellH: 64,
  /** Chunk edge is 1 << chunkShift tiles; must divide cellW and cellH. */
  chunkShift: 6,
  chunkCacheMax: 384,
  planCacheMax: 128,
  /** Vertical speed is half the horizontal so on-screen speed matches with 1:2 cells. */
  walk: { tilesPerSecX: 12, tilesPerSecY: 6, runMultiplier: 2, flyMultiplier: 8 },
  render: {
    cellPxW: 10,
    cellPxH: 20,
    fontPx: 16,
    fontFamily: "Consolas, 'Cascadia Mono', 'Yu Gothic', 'MS Gothic', 'Noto Sans Mono CJK JP', monospace",
  },
  /** Full node id of the spawn the player starts at. */
  startSpawn: 'home.front',
} as const;

export const CHUNK_SHIFT = CONFIG.chunkShift;
export const CHUNK = 1 << CHUNK_SHIFT;
export const CHUNK_MASK = CHUNK - 1;

if (CONFIG.cellW % CHUNK !== 0 || CONFIG.cellH % CHUNK !== 0) {
  throw new Error('CONFIG: chunk size must divide cellW and cellH (each chunk belongs to exactly one macro cell)');
}

/** Seconds to walk a distance at base walking speed, per axis. */
export function walkSeconds(tilesX: number, tilesY: number): { x: number; y: number } {
  return { x: tilesX / CONFIG.walk.tilesPerSecX, y: tilesY / CONFIG.walk.tilesPerSecY };
}
