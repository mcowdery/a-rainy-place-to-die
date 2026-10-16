import { CHUNK_MASK, CHUNK_SHIFT, CONFIG } from '../config';
import { key2 } from '../core/coords';
import { hash, u01 } from '../core/hash';
import { GLYPH_CONT, GLYPH_NONE, isWide } from '../core/wide';
import type { Atmosphere } from '../atmosphere/atmosphere';
import type { NodeIndex, WorldNode } from '../content/nodes';
import type { CellKind } from '../gen/macro';
import { PAL, TILES } from '../world/tiles';
import type { World } from '../world/world';
import { GlyphCache } from './glyphs';

export interface FrameState {
  readonly world: World;
  readonly nodes: NodeIndex;
  /** Atmosphere for a district under the current time/weather. */
  readonly atmosphere: (kind: CellKind) => Atmosphere;
  readonly player: { readonly x: number; readonly y: number };
  readonly isVisible: (n: WorldNode) => boolean;
  readonly now: number;
}

const SPACE = 0x20;
const PLAYER_GLYPH = 0x40; // @

/**
 * Draws the tile grid centred on the player. Everything is in device pixels on integer cell
 * boundaries so there are no seams at fractional devicePixelRatio. Each row is drawn in two passes
 * (backgrounds, then glyphs) so a wide glyph isn't overpainted by its right-hand cell's background.
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private glyphs!: GlyphCache;
  private cw = 0;
  private ch = 0;
  private rowCps: number[] = [];
  private rowColors: string[] = [];
  private rowBgs: string[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const r = CONFIG.render;
    this.cw = Math.round(r.cellPxW * dpr);
    this.ch = Math.round(r.cellPxH * dpr);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.glyphs = new GlyphCache(this.cw, this.ch, `${Math.round(r.fontPx * dpr)}px ${r.fontFamily}`);
  }

  /** Visible size in cells. */
  get cols(): number {
    return Math.ceil(this.canvas.width / this.cw);
  }
  get rows(): number {
    return Math.ceil(this.canvas.height / this.ch);
  }

  draw(s: FrameState): void {
    const { ctx, cw, ch } = this;
    const { world, now } = s;
    const cols = this.cols;
    const rows = this.rows;
    const ox = s.player.x - Math.floor(cols / 2);
    const oy = s.player.y - Math.floor(rows / 2);
    const waterFrame = Math.floor(now / 700);
    const flickerFrame = Math.floor(now / 110);

    // Entities are drawn as glyph overrides on their tile.
    const entities = new Map<number, { cp: number; fg: number }>();
    for (const n of s.nodes.inRect({ x: ox, y: oy, w: cols, h: rows })) {
      if (n.kind === 'npc' && n.glyph !== null && s.isVisible(n)) entities.set(key2(n.x, n.y), { cp: n.glyph, fg: n.fg ?? PAL.npc });
    }
    entities.set(key2(s.player.x, s.player.y), { cp: PLAYER_GLYPH, fg: PAL.player });

    const cps = this.rowCps;
    const colors = this.rowColors;
    const bgs = this.rowBgs;
    const leftHalf: [dx: number, cp: number, color: string][] = [];
    let playerAtm: Atmosphere | null = null;

    for (let sy = 0; sy < rows; sy++) {
      const ty = oy + sy;
      const py = sy * ch;
      let chunk = world.chunk(ox >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
      let chunkX = ox >> CHUNK_SHIFT;
      let cellX = NaN;
      let atm!: Atmosphere;
      for (let sx = 0; sx < cols; sx++) {
        const tx = ox + sx;
        if (tx >> CHUNK_SHIFT !== chunkX) {
          chunkX = tx >> CHUNK_SHIFT;
          chunk = world.chunk(chunkX, ty >> CHUNK_SHIFT);
        }
        const mx = Math.floor(tx / CONFIG.cellW);
        if (mx !== cellX) {
          cellX = mx;
          atm = s.atmosphere(world.macro.kindAt(mx, Math.floor(ty / CONFIG.cellH)));
        }
        const i = ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
        const tile = TILES[chunk.tile[i]];
        bgs[sx] = atm.colors[tile.bg];

        let cp = chunk.glyph[i];
        const fgOverride = chunk.fg[i];
        let fg = fgOverride ? fgOverride - 1 : tile.fg;
        if (cp === GLYPH_NONE) {
          const g = tile.glyphs;
          cp = g.length === 1 ? g[0] : g[(hash(tx, ty) + (tile.water ? waterFrame : 0)) % g.length];
        }
        let color = atm.colors[fg];
        if (tile.window && u01(hash(tx >> 1, ty, 77)) < atm.windowLit) color = atm.colors[PAL.window_lit];
        if (tile.neon && (atm.neon === 'off' || (atm.neon === 'flicker' && hash(tx >> 3, ty >> 2, flickerFrame) % 90 === 0))) {
          color = atm.colors[PAL.neon_off];
        }
        const ent = entities.get(key2(tx, ty));
        if (ent) {
          cp = ent.cp;
          fg = ent.fg;
          color = atm.colors[fg];
          if (tx === s.player.x && ty === s.player.y) playerAtm = atm;
        }
        // A wide glyph whose left half is just off-screen: draw it from one cell to the left.
        if (cp === GLYPH_CONT && sx === 0) {
          const left = world.chunk((tx - 1) >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
          const li = ((ty & CHUNK_MASK) << CHUNK_SHIFT) | ((tx - 1) & CHUNK_MASK);
          const lcp = left.glyph[li];
          if (lcp > GLYPH_CONT) leftHalf.push([-cw, lcp, color]);
        }
        cps[sx] = cp;
        colors[sx] = color;
      }
      // Backgrounds as runs of equal colour, then glyphs on top.
      for (let run = 0; run < cols; ) {
        let end = run + 1;
        while (end < cols && bgs[end] === bgs[run]) end++;
        ctx.fillStyle = bgs[run];
        ctx.fillRect(run * cw, py, (end - run) * cw, ch);
        run = end;
      }
      for (const [dx, cp, color] of leftHalf) this.glyphs.draw(ctx, cp, true, color, dx, py);
      leftHalf.length = 0;
      for (let sx = 0; sx < cols; sx++) {
        const cp = cps[sx];
        if (cp === SPACE || cp <= GLYPH_CONT) continue;
        this.glyphs.draw(ctx, cp, isWide(cp), colors[sx], sx * cw, py);
      }
    }

    // Weather overlays use the player's district.
    const atm = playerAtm ?? s.atmosphere(world.kindAt(s.player.x, s.player.y));
    if (atm.fog) {
      ctx.fillStyle = atm.fog;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (atm.rain > 0) {
      const n = Math.floor(cols * rows * atm.rain);
      const frame = Math.floor(now / 70);
      for (let k = 0; k < n; k++) {
        const h = hash(k, frame, 9);
        this.glyphs.draw(ctx, 0x2f, false, atm.colors[PAL.rain], (h % cols) * cw, ((h >>> 11) % rows) * ch);
      }
    }
  }
}
