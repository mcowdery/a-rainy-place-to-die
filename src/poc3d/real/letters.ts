import { isWide } from '../../core/wide';

/**
 * Channel letters: 3D sign letters built from geometry. Each glyph is rasterised once on a small canvas
 * (any font the browser has, CJK included) and its filled pixels are greedily merged into rectangles; each
 * rectangle becomes an extruded block. Chunky pixel-built letters suit the ASCII city, and a kanji costs a
 * few dozen boxes.
 */

/** Raster size of one em. */
export const EM = 28;

export interface Glyph {
  /** Advance in pixels (EM for wide glyphs). */
  readonly advance: number;
  /** [x, y, w, h] in pixels, y down from the em box's top. */
  readonly rects: readonly (readonly [number, number, number, number])[];
}

const cache = new Map<string, Glyph>();
let ctx: OffscreenCanvasRenderingContext2D | null = null;

export function glyph(ch: string): Glyph {
  let g = cache.get(ch);
  if (g) return g;
  if (!ctx) {
    ctx = new OffscreenCanvas(EM * 2, EM).getContext('2d', { willReadFrequently: true })!;
  }
  const wide = isWide(ch.codePointAt(0)!);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, EM * 2, EM);
  if (ch === ' ') {
    g = { advance: EM * 0.4, rects: [] };
    cache.set(ch, g);
    return g;
  }
  ctx.font = wide ? `bold ${EM - 2}px 'Yu Gothic', 'Meiryo', 'MS Gothic', sans-serif` : `bold ${EM + 2}px 'Arial Black', 'Arial', sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  const adv = wide ? EM : Math.min(EM * 1.2, Math.ceil(ctx.measureText(ch).width) + 2);
  ctx.fillText(ch, wide ? 1 : 1, EM / 2 + 1);
  const px = ctx.getImageData(0, 0, Math.ceil(adv), EM).data;
  const W = Math.ceil(adv);
  const on = (x: number, y: number): boolean => px[(y * W + x) * 4] > 110;
  // Greedy: horizontal runs per row, extended downward while the next row has the identical run.
  const done = new Uint8Array(W * EM);
  const rects: [number, number, number, number][] = [];
  for (let y = 0; y < EM; y++) {
    let x = 0;
    while (x < W) {
      if (!on(x, y) || done[y * W + x]) {
        x++;
        continue;
      }
      let x1 = x;
      while (x1 < W && on(x1, y) && !done[y * W + x1]) x1++;
      let y1 = y + 1;
      const rowMatches = (yy: number): boolean => {
        for (let k = x; k < x1; k++) if (!on(k, yy) || done[yy * W + k]) return false;
        return (x === 0 || !on(x - 1, yy) || done[yy * W + x - 1] === 1) && (x1 >= W || !on(x1, yy));
      };
      while (y1 < EM && rowMatches(y1)) y1++;
      for (let yy = y; yy < y1; yy++) for (let k = x; k < x1; k++) done[yy * W + k] = 1;
      rects.push([x, y, x1 - x, y1 - y]);
      x = x1;
    }
  }
  g = { advance: adv, rects };
  cache.set(ch, g);
  return g;
}

/** Total advance of a string in pixels. */
export const textAdvance = (text: string): number => [...text].reduce((a, ch) => a + glyph(ch).advance, 0);
