import { CHUNK_MASK, CHUNK_SHIFT, CONFIG } from '../config';
import { key2, pad, type Rect } from '../core/coords';
import type { PlacedStamp } from '../content/stamps';
import { planCell, type CellPlan } from '../gen/cellplan';
import type { CellKind, MacroMap } from '../gen/macro';
import { rasterize } from '../gen/raster';
import { Chunk } from './chunk';
import { T, TILES } from './tiles';

/**
 * The tile world. Nothing is stored up front: chunks are generated on first access from
 * (seed, L0 map, stamps) and kept in a small LRU cache, so world size costs nothing until visited.
 */
export class World {
  readonly widthTiles: number;
  readonly heightTiles: number;
  private chunks = new Map<number, Chunk>();
  private plans = new Map<number, CellPlan | null>();
  private stampsByCell = new Map<number, PlacedStamp[]>();
  private readonly outside: Chunk;
  chunksGenerated = 0;

  constructor(
    readonly macro: MacroMap,
    readonly placements: readonly PlacedStamp[],
    readonly seed: number = CONFIG.seed,
  ) {
    this.widthTiles = macro.cols * CONFIG.cellW;
    this.heightTiles = macro.rows * CONFIG.cellH;
    this.outside = new Chunk(-1, -1);
    this.outside.tile.fill(T.void);
    for (const p of placements) {
      for (let my = Math.floor(p.rect.y / CONFIG.cellH); my <= Math.floor((p.rect.y + p.rect.h - 1) / CONFIG.cellH); my++) {
        for (let mx = Math.floor(p.rect.x / CONFIG.cellW); mx <= Math.floor((p.rect.x + p.rect.w - 1) / CONFIG.cellW); mx++) {
          const k = key2(mx, my);
          this.stampsByCell.set(k, [...(this.stampsByCell.get(k) ?? []), p]);
        }
      }
    }
  }

  chunk(cx: number, cy: number): Chunk {
    const x = cx << CHUNK_SHIFT;
    const y = cy << CHUNK_SHIFT;
    if (x < 0 || y < 0 || x >= this.widthTiles || y >= this.heightTiles) return this.outside;
    const k = key2(cx, cy);
    let c = this.chunks.get(k);
    if (c) {
      // LRU: move to most-recent.
      this.chunks.delete(k);
      this.chunks.set(k, c);
      return c;
    }
    c = new Chunk(cx, cy);
    const mx = Math.floor(x / CONFIG.cellW);
    const my = Math.floor(y / CONFIG.cellH);
    const stamps = this.stampsByCell.get(key2(mx, my)) ?? [];
    rasterize(c, this.macro.kindAt(mx, my), this.plan(mx, my), stamps);
    this.chunksGenerated++;
    this.chunks.set(k, c);
    if (this.chunks.size > CONFIG.chunkCacheMax) this.chunks.delete(this.chunks.keys().next().value!);
    return c;
  }

  plan(mx: number, my: number): CellPlan | null {
    const k = key2(mx, my);
    if (this.plans.has(k)) return this.plans.get(k)!;
    const reserved: Rect[] = (this.stampsByCell.get(k) ?? []).map((p) => pad(p.rect, 1));
    const plan = planCell(this.macro, mx, my, reserved, this.seed);
    this.plans.set(k, plan);
    if (this.plans.size > CONFIG.planCacheMax) this.plans.delete(this.plans.keys().next().value!);
    return plan;
  }

  tileAt(x: number, y: number): number {
    return this.chunk(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT).tile[((y & CHUNK_MASK) << CHUNK_SHIFT) | (x & CHUNK_MASK)];
  }

  isWalkable(x: number, y: number): boolean {
    return TILES[this.tileAt(x, y)].walk;
  }

  kindAt(x: number, y: number): CellKind {
    return this.macro.kindAt(Math.floor(x / CONFIG.cellW), Math.floor(y / CONFIG.cellH));
  }

  get cachedChunks(): number {
    return this.chunks.size;
  }
}
