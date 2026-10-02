import { intersect, overlaps, type Rect } from '../../core/coords';
import { isRiverWalk, type CellPlan3, type Road3 } from '../district/plan';
import { KIND, lin, type MeshBuilder } from './meshBuilder';
import type { OpenLayout } from './openLots';

/**
 * Ground for one cell: lot concrete, asphalt for its share of each road, raised pavements with kerbs (cut
 * at crossings), and road paint: centre and lane lines, edge lines, zebra crossings and stop lines at
 * junctions. Paint belongs to the cell containing its centre so shared edge roads aren't painted twice.
 */
export function addGround(mb: MeshBuilder, plan: CellPlan3, plazas: readonly Rect[] = [], scrambles: readonly Rect[] = [], holes: readonly Rect[] = [], open: readonly OpenLayout[] = []): void {
  mb.id = 0;
  mb.flags = 0;
  mb.style = [0, 0, 0, 0];
  mb.frontNormal = null;
  const cell = plan.rect;
  // Each slab carries its whole rectangle (and a road its kerbs), so the city shader knows where its edges are:
  // fallen leaves and petals gather along them (city.ts fallenAt). style (0, x0, z0, w); flags SLAB_FLAG +
  // depth * 8 * 128 + the kerb (a road's pavement width * 2, +64 if it runs north-south).
  const slab = (r: Rect, y0: number, y1: number, kind: number, top: number, hex: number, kerb = 0): void => {
    const c = intersect(r, cell);
    if (!c || c.w < 0.01 || c.h < 0.01) return;
    mb.kind = kind;
    mb.color = lin(hex);
    mb.style = [0, r.x, r.y, r.w];
    mb.flags = SLAB_FLAG + Math.round(r.h * 8) * 128 + kerb;
    mb.box(c.x + c.w / 2, c.y + c.h / 2, y0, y1, c.w, c.h, top);
  };
  // Lot concrete, with any openings (stairwells to basements) cut out.
  for (const piece of subtract(cell, holes)) slab(piece, -0.2, 0, KIND.lot, KIND.lot, 0x6a6862);
  for (const r of plan.roads) slab(r.rect, 0, 0.02, KIND.asphalt, KIND.asphalt, r.kind === 'coast' ? 0x5a5e62 : 0x2a2a2e, r.sidewalk > 0 ? Math.min(63, Math.round(r.sidewalk * 2)) + (r.vertical ? 64 : 0) : 0);
  // Riverside walks: paved a step up from the street (plan.ts RIVER_WALK).
  // Along the water, the flood wall (a knee-high concrete parapet, as on the Sumida).
  for (const r of plan.roads) {
    if (!isRiverWalk(r)) continue;
    slab(r.rect, 0, 0.12, KIND.plain, KIND.sidewalk, 0x9a9488);
    const q = r.rect;
    const water = r.vertical ? q.x + q.w / 2 > cell.x + cell.w / 2 : q.y + q.h / 2 > cell.y + cell.h / 2;
    const wall = r.vertical ? { x: water ? q.x + q.w - 0.4 : q.x, y: q.y, w: 0.4, h: q.h } : { x: q.x, y: water ? q.y + q.h - 0.4 : q.y, w: q.w, h: 0.4 };
    slab(wall, 0.12, 1.0, KIND.plain, KIND.plain, 0x8e8c86);
  }
  for (const r of plan.roads) {
    if (r.sidewalk <= 0) continue;
    const crossings = plan.roads.filter((o) => o !== r && o.vertical !== r.vertical && o.kind !== 'coast' && overlaps(o.rect, r.rect));
    for (const strip of sidewalkStrips(r)) for (const piece of cut(strip, crossings, r.vertical)) slab(piece, 0, 0.15, KIND.plain, KIND.sidewalk, 0x8a867e);
  }
  // Avenues' medians: a kerbed strip down the middle, planted (the expressway's piers stand in it).
  for (const m of plan.medians) {
    slab(m, 0, 0.18, KIND.plain, KIND.sidewalk, 0x9a968c);
    const inset = 0.35;
    const g: Rect = { x: m.x + inset, y: m.y + inset, w: m.w - 2 * inset, h: m.h - 2 * inset };
    if (g.w > 0.3 && g.h > 0.3) slab(g, 0.18, 0.22, KIND.grass, KIND.grass, 0x3a5a2e);
  }
  // Stamp plazas: paving raised to pavement height, in a lighter stone.
  for (const q of plazas) slab(q, 0, 0.15, KIND.plain, KIND.sidewalk, 0xa09a90);
  // Open ground (openLots.ts): car park asphalt and bay lines, earth, lawns, paths, ponds, plaza paving.
  for (const o of open) {
    for (const g of o.ground) slab(g.rect, 0, g.top, g.kind === KIND.sidewalk ? KIND.plain : g.kind, g.kind, g.hex);
    mb.kind = KIND.paint;
    for (const l of o.paint) {
      mb.color = lin(l.hex);
      mb.quad([l.rect.x, l.y, l.rect.y + l.rect.h], [l.rect.w, 0, 0], [0, 0, -l.rect.h]);
    }
  }
  mb.style = [0, 0, 0, 0];
  mb.flags = 0;
  paint(mb, plan);
  for (const s of scrambles) scramble(mb, plan, s);
}

/** Marks a ground slab's flags (see addGround's slab). */
export const SLAB_FLAG = 4096;

/**
 * A scramble crossing: zebra bands along both diagonals of the junction box (bars 0.45 m across the
 * walking direction, 3 m long), each bar painted by the cell holding its centre.
 */
function scramble(mb: MeshBuilder, plan: CellPlan3, box: Rect): void {
  const cell = plan.rect;
  mb.kind = KIND.paint;
  mb.color = lin(WHITE);
  const corners: [[number, number], [number, number]][] = [
    [[box.x, box.y], [box.x + box.w, box.y + box.h]],
    [[box.x + box.w, box.y], [box.x, box.y + box.h]],
  ];
  for (const [a, c] of corners) {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const d = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
    const p = [-d[1], d[0]];
    for (let s = 1.2; s < len - 1.2; s += 0.9) {
      const cx = a[0] + d[0] * s;
      const cz = a[1] + d[1] * s;
      if (cx < cell.x || cz < cell.y || cx >= cell.x + cell.w || cz >= cell.y + cell.h) continue;
      const along: [number, number, number] = [d[0] * 0.45, 0, d[1] * 0.45];
      const across: [number, number, number] = [p[0] * 3, 0, p[1] * 3];
      const o: [number, number, number] = [cx - along[0] / 2 - across[0] / 2, Y + 0.002, cz - along[2] / 2 - across[2] / 2];
      // Keep the painted face up: flip the edge order if along x across points down.
      if (along[2] * across[0] - along[0] * across[2] > 0) mb.quad(o, along, across);
      else mb.quad(o, across, along);
    }
  }
}

/** A rect minus some holes, as a list of rects (each hole splits a piece into up to four). */
export function subtract(r: Rect, holes: readonly Rect[]): Rect[] {
  let pieces = [r];
  for (const h of holes) {
    const next: Rect[] = [];
    for (const p of pieces) {
      const c = intersect(p, h);
      if (!c) {
        next.push(p);
        continue;
      }
      const parts: Rect[] = [
        { x: p.x, y: p.y, w: p.w, h: c.y - p.y },
        { x: p.x, y: c.y + c.h, w: p.w, h: p.y + p.h - c.y - c.h },
        { x: p.x, y: c.y, w: c.x - p.x, h: c.h },
        { x: c.x + c.w, y: c.y, w: p.x + p.w - c.x - c.w, h: c.h },
      ];
      next.push(...parts.filter((q) => q.w > 0.01 && q.h > 0.01));
    }
    pieces = next;
  }
  return pieces;
}

function sidewalkStrips(r: Road3): Rect[] {
  const s = r.sidewalk;
  const q = r.rect;
  return r.vertical
    ? [{ x: q.x, y: q.y, w: s, h: q.h }, { x: q.x + q.w - s, y: q.y, w: s, h: q.h }]
    : [{ x: q.x, y: q.y, w: q.w, h: s }, { x: q.x, y: q.y + q.h - s, w: q.w, h: s }];
}

/** Removes the spans of a strip covered by crossing roads (1D along the strip's long axis). */
function cut(strip: Rect, crossings: readonly Road3[], vertical: boolean, margin = 0): Rect[] {
  let spans: [number, number][] = [vertical ? [strip.y, strip.y + strip.h] : [strip.x, strip.x + strip.w]];
  for (const o of crossings) {
    const [a, b] = vertical ? [o.rect.y - margin, o.rect.y + o.rect.h + margin] : [o.rect.x - margin, o.rect.x + o.rect.w + margin];
    spans = spans.flatMap(([s, e]) => (b <= s || a >= e ? [[s, e]] : ([[s, a], [b, e]] as [number, number][]).filter(([p, q]) => q - p > 0.1)));
  }
  return spans.map(([s, e]) => (vertical ? { x: strip.x, y: s, w: strip.w, h: e - s } : { x: s, y: strip.y, w: e - s, h: strip.h }));
}

const WHITE = 0xd8d8d0;
const YELLOW = 0xd8a830;
const Y = 0.028;

function paint(mb: MeshBuilder, plan: CellPlan3): void {
  const cell = plan.rect;
  const mine = (x: number, z: number): boolean => x >= cell.x && z >= cell.y && x < cell.x + cell.w && z < cell.y + cell.h;
  mb.kind = KIND.paint;
  // A flat painted rectangle, kept if its centre is in this cell.
  const mark = (x: number, z: number, w: number, d: number, hex: number): void => {
    if (!mine(x + w / 2, z + d / 2)) return;
    mb.color = lin(hex);
    mb.quad([x, Y, z + d], [w, 0, 0], [0, 0, -d]);
  };
  for (const r of plan.roads) {
    if (r.kind === 'coast') continue;
    const q = r.rect;
    const width = r.vertical ? q.w : q.h;
    const carriage = width - 2 * r.sidewalk;
    if (carriage < 5.5) continue;
    const crossings = plan.roads.filter((o) => o !== r && o.vertical !== r.vertical && o.kind !== 'coast' && overlaps(o.rect, q));
    const centre = r.vertical ? q.x + q.w / 2 : q.y + q.h / 2;
    const lo = centre - carriage / 2;
    const hi = centre + carriage / 2;
    // Lines run along the free spans between junctions (stopping short for the crossings).
    const spanRect = r.vertical ? { x: q.x, y: q.y, w: q.w, h: q.h } : { x: q.x, y: q.y, w: q.w, h: q.h };
    for (const s of cut(spanRect, crossings, r.vertical, 4.5)) {
      const [a, b] = r.vertical ? [s.y, s.y + s.h] : [s.x, s.x + s.w];
      const line = (off: number, w: number, hex: number, dash: number, gap: number): void => {
        for (let t = a; t < b - 0.5; t += dash + gap) {
          const len = Math.min(dash, b - t);
          if (r.vertical) mark(off - w / 2, t, w, len, hex);
          else mark(t, off - w / 2, len, w, hex);
        }
      };
      const boulevard = carriage >= 11;
      if (r.median) {
        // Two lanes each way either side of the median: a lane line down the middle of each side.
        const lane = r.median / 2 + (carriage / 2 - r.median / 2) / 2;
        line(centre - lane, 0.15, WHITE, 5, 5);
        line(centre + lane, 0.15, WHITE, 5, 5);
        line(centre - r.median / 2 - 0.3, 0.15, YELLOW, 1e9, 0);
        line(centre + r.median / 2 + 0.3, 0.15, YELLOW, 1e9, 0);
      } else if (boulevard) {
        line(centre - 0.12, 0.15, YELLOW, 1e9, 0);
        line(centre + 0.12, 0.15, YELLOW, 1e9, 0);
        line(centre - carriage / 4, 0.15, WHITE, 5, 5);
        line(centre + carriage / 4, 0.15, WHITE, 5, 5);
      } else {
        line(centre, 0.15, WHITE, 5, 5);
      }
      line(lo + 0.5, 0.15, WHITE, 1e9, 0);
      line(hi - 0.5, 0.15, WHITE, 1e9, 0);
    }
    // Zebra crossings and stop lines at each junction with another real street.
    for (const o of crossings) {
      if (Math.min(o.rect.w, o.rect.h) < 3) continue;
      const [ja, jb] = r.vertical ? [o.rect.y, o.rect.y + o.rect.h] : [o.rect.x, o.rect.x + o.rect.w];
      for (const [edge, dir] of [[ja, -1], [jb, 1]] as const) {
        const start = edge + dir * 0.6;
        const end = edge + dir * 3.6;
        const [z0, z1] = [Math.min(start, end), Math.max(start, end)];
        for (let s = lo + 0.3; s < hi - 0.3; s += 0.9) {
          if (r.vertical) mark(s, z0, 0.45, z1 - z0, WHITE);
          else mark(z0, s, z1 - z0, 0.45, WHITE);
        }
        const stop = edge + dir * 4.4;
        if (r.vertical) mark(dir < 0 ? lo : centre, stop - 0.2, carriage / 2, 0.4, WHITE);
        else mark(stop - 0.2, dir < 0 ? centre : lo, 0.4, carriage / 2, WHITE);
      }
    }
  }
}
