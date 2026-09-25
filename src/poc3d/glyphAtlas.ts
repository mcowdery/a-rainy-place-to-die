import * as THREE from 'three';
import { isWide } from '../core/wide';
import { SIGN_LETTERS } from './block';

/**
 * The glyph atlas for the ASCII pass: one row of cell-sized slots (slot 0 is blank).
 *
 * Density ramps aren't hand-ordered: every candidate glyph is rendered once and its ink coverage
 * measured, and each ramp is chosen from the measured candidates so steps are evenly spaced in actual
 * darkness. Japanese is woven into the ramps themselves:
 * - halfwidth katakana (ｱｶｻﾀ…) are single-cell glyphs and sit among the Latin letters and digits;
 * - dense kanji (田 回 国 園 龍 鬱…) provide the darkest tones. They're two cells wide, so each takes two
 *   slots (left half, right half) and the shader draws them across screen-aligned cell pairs.
 * Quadrant blocks (▘▝▖▗▚▞…, indexed by a 4-bit mask) and box-drawing lines (│ ─ ┌ ┐ └ ┘ ╱ ╲) are drawn
 * procedurally so they fill cells exactly and connect edge-to-edge with their neighbours.
 */

export interface Range {
  readonly start: number;
  readonly length: number;
}

export interface AtlasLayout {
  readonly texture: THREE.CanvasTexture;
  readonly count: number;
  /** Ground/props luminance ramp. */
  readonly ground: Range;
  /** Facade panes: single-cell ramp, sparse -> dense. */
  readonly pane: Range;
  /** Facade panes, darkest tones: kanji as (left, right) slot pairs; length = number of kanji. */
  readonly kanji: Range;
  readonly slab: Range;
  /** '8', '#', ':' then SIGN_LETTERS (storefront band codes, see FACADE.shop). */
  readonly shop: number;
  /** 16 quadrant glyphs indexed by mask: bit0 top-left, bit1 top-right, bit2 bottom-left, bit3 bottom-right. */
  readonly quad: number;
  readonly box: { readonly v: number; readonly h: number; readonly tl: number; readonly tr: number; readonly bl: number; readonly br: number; readonly rise: number; readonly fall: number };
  /** Sign characters (CJK: left half; right half is +1). */
  readonly text: ReadonlyMap<string, number>;
  /** Measured darkness per ramp entry, for reporting. */
  readonly report: { readonly pane: string; readonly kanji: string; readonly ground: string; readonly slab: string };
  /** Measured ink coverage (0-1) of each pane / ground ramp entry, in ramp order. */
  readonly cov: { readonly pane: readonly number[]; readonly ground: readonly number[] };
}

const GROUND_CANDIDATES = ' .,:;-=+*xo#%&@';
// No '@' or '%': in large blocks they read as noise, and the kanji carry the darkest tones instead.
const PANE_CANDIDATES = '.:;+*xoXZ0O8&#' + 'ｰｨｿﾉﾍﾊｶﾄﾛﾘﾈﾓﾑﾒﾎﾖﾏﾙﾕｹﾀﾅｷｻﾁﾂﾃﾆﾇﾐﾔﾜｦﾝ';
const KANJI_CANDIDATES = '口日目田回国画図園圖國闇龍鬱驫霧雷繁麗鑑醤鷹';
const SLAB_CANDIDATES = ':ﾆ=0';
const PANE_STEPS = 14;
const KANJI_STEPS = 6;

type Draw = (g: CanvasRenderingContext2D, x: number, w: number, h: number) => void;

export function buildAtlas(cellW: number, cellH: number, signText: string): AtlasLayout {
  const scale = 3;
  const w = cellW * scale;
  const h = cellH * scale;
  const font = `bold ${Math.round(h * 0.82)}px Consolas, 'Cascadia Mono', 'MS Gothic', 'Yu Gothic', 'Meiryo', monospace`;
  // Wide glyphs get the full cell height: a kanji spans a square two-cell box and should fill it to be
  // darker than any single-cell glyph.
  const wideFont = `bold ${Math.round(h * 1.0)}px 'MS Gothic', 'Yu Gothic', 'Meiryo', sans-serif`;
  const text = (ch: string, wide = false): Draw => (g, x, cw, ch2) => {
    g.font = wide ? wideFont : font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // '*' sits in the top of the cell in most monospace fonts and reads as '"'; centre it.
    g.fillText(ch, x + (wide ? cw : cw / 2), ch2 / 2 + scale + (ch === '*' ? ch2 * 0.2 : 0));
  };

  // Measure ink coverage of a glyph (fraction of its slot area).
  const probe = document.createElement('canvas');
  probe.width = w * 2;
  probe.height = h;
  const pg = probe.getContext('2d', { willReadFrequently: true })!;
  const coverage = (draw: Draw, slots: number): number => {
    pg.fillStyle = '#000';
    pg.fillRect(0, 0, probe.width, probe.height);
    pg.fillStyle = '#fff';
    draw(pg, 0, w, h);
    const px = pg.getImageData(0, 0, w * slots, h).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += px[i];
    return sum / 255 / (w * slots * h);
  };
  const measured = (chars: string, wide: boolean): { ch: string; cov: number }[] =>
    [...new Set(chars)].map((ch) => ({ ch, cov: coverage(text(ch, wide), wide ? 2 : 1) })).sort((a, b) => a.cov - b.cov);

  /** Pick `steps` glyphs evenly spaced in coverage between lo and hi; kana get a small preference. */
  const evenly = (cands: { ch: string; cov: number }[], steps: number, lo: number, hi: number): { ch: string; cov: number }[] => {
    const out: { ch: string; cov: number }[] = [];
    const pool = [...cands];
    for (let i = 0; i < steps && pool.length > 0; i++) {
      const target = lo + ((hi - lo) * i) / Math.max(1, steps - 1);
      let best = 0;
      let bestScore = Infinity;
      pool.forEach((c, j) => {
        const kana = /[ｦ-ﾝ]/.test(c.ch);
        const score = Math.abs(c.cov - target) * (kana ? 0.75 : 1);
        if (score < bestScore) {
          bestScore = score;
          best = j;
        }
      });
      out.push(pool.splice(best, 1)[0]);
    }
    return out.sort((a, b) => a.cov - b.cov);
  };

  const ground = measured(GROUND_CANDIDATES, false);
  const paneAll = measured(PANE_CANDIDATES, false).filter((c) => c.cov > 0.02);
  const pane = evenly(paneAll, PANE_STEPS, paneAll[0].cov, paneAll[paneAll.length - 1].cov);
  const kanjiAll = measured(KANJI_CANDIDATES, true);
  const maxSingle = pane[pane.length - 1].cov;
  const kanji = evenly(kanjiAll.filter((c) => c.cov > maxSingle * 0.85), KANJI_STEPS, maxSingle, kanjiAll[kanjiAll.length - 1].cov);
  const slab = measured(SLAB_CANDIDATES, false);

  // Layout: list of (draw, slots) in slot order.
  const entries: { draw: Draw; slots: number }[] = [{ draw: () => {}, slots: 1 }];
  let next = 1;
  const add = (draw: Draw, slots = 1): number => {
    entries.push({ draw, slots });
    const at = next;
    next += slots;
    return at;
  };
  const addRange = (list: { ch: string }[], wide = false): Range => {
    const start = next;
    for (const { ch } of list) add(text(ch, wide), wide ? 2 : 1);
    return { start, length: list.length };
  };

  const groundR = addRange(ground);
  const paneR = addRange(pane);
  const kanjiR = addRange(kanji, true);
  const slabR = addRange(slab);
  const shop = next;
  for (const ch of '8#:' + SIGN_LETTERS) add(text(ch));

  const quad = next;
  for (let mask = 0; mask < 16; mask++) {
    add((g, x, cw, ch) => {
      const hw = cw / 2;
      const hh = ch / 2;
      if (mask & 1) g.fillRect(x, 0, hw, hh);
      if (mask & 2) g.fillRect(x + hw, 0, cw - hw, hh);
      if (mask & 4) g.fillRect(x, hh, hw, ch - hh);
      if (mask & 8) g.fillRect(x + hw, hh, cw - hw, ch - hh);
    });
  }

  // Box drawing: lines through the cell centre, reaching the cell edges exactly so neighbours connect.
  const t = Math.max(2, Math.round(w / 8));
  const vLine = (g: CanvasRenderingContext2D, x: number, cw: number, y0: number, y1: number): void => g.fillRect(x + Math.round(cw / 2 - t / 2), y0, t, y1 - y0);
  const hLine = (g: CanvasRenderingContext2D, x0: number, x1: number, ch: number): void => g.fillRect(x0, Math.round(ch / 2 - t / 2), x1 - x0, t);
  const diag = (rising: boolean): Draw => (g, x, cw, ch) => {
    g.strokeStyle = '#fff';
    g.lineWidth = t;
    g.beginPath();
    g.moveTo(x, rising ? ch : 0);
    g.lineTo(x + cw, rising ? 0 : ch);
    g.stroke();
  };
  const box = {
    v: add((g, x, cw, ch) => vLine(g, x, cw, 0, ch)),
    h: add((g, x, cw, ch) => hLine(g, x, x + cw, ch)),
    // Corners (screen orientation: canvas y grows downward = screen down).
    tl: add((g, x, cw, ch) => (hLine(g, x + cw / 2 - t / 2, x + cw, ch), vLine(g, x, cw, ch / 2 - t / 2, ch))), // ┌
    tr: add((g, x, cw, ch) => (hLine(g, x, x + cw / 2 + t / 2, ch), vLine(g, x, cw, ch / 2 - t / 2, ch))), // ┐
    bl: add((g, x, cw, ch) => (hLine(g, x + cw / 2 - t / 2, x + cw, ch), vLine(g, x, cw, 0, ch / 2 + t / 2))), // └
    br: add((g, x, cw, ch) => (hLine(g, x, x + cw / 2 + t / 2, ch), vLine(g, x, cw, 0, ch / 2 + t / 2))), // ┘
    rise: add(diag(true)), // ╱
    fall: add(diag(false)), // ╲
  };

  const textSlots = new Map<string, number>();
  for (const ch of new Set(signText)) {
    if (ch === ' ' || textSlots.has(ch)) continue;
    const wide = isWide(ch.codePointAt(0)!);
    textSlots.set(ch, add(text(ch, wide), wide ? 2 : 1));
  }

  const c = document.createElement('canvas');
  c.width = w * next;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  let slot = 0;
  for (const e of entries) {
    e.draw(g, slot * w, w, h);
    slot += e.slots;
  }
  const texture = new THREE.CanvasTexture(c);
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const fmt = (list: { ch: string; cov: number }[]): string => list.map((x) => `${x.ch}${(x.cov * 100).toFixed(0)}`).join(' ');
  return {
    texture,
    count: next,
    ground: groundR,
    pane: paneR,
    kanji: kanjiR,
    slab: slabR,
    shop,
    quad,
    box,
    text: textSlots,
    report: { pane: fmt(pane), kanji: fmt(kanji), ground: fmt(ground), slab: fmt(slab) },
    cov: { pane: pane.map((x) => x.cov), ground: ground.map((x) => x.cov) },
  };
}
