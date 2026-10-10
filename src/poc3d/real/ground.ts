import { intersect, overlaps, type Rect } from '../../core/coords';
import { isRiverWalk, isVerge, junctionSpans, throughMouths, type CellPlan3, type Road3, type Span } from '../district/plan';
import { KIND, lin, type MeshBuilder } from './meshBuilder';
import type { OpenLayout } from './openLots';
import { inPark } from '../district/parkLand';

/**
 * Ground for one cell: lot concrete, asphalt for its share of each road, raised pavements with kerbs (cut
 * at crossings), and road paint: centre and lane lines, edge lines, zebra crossings and stop lines at
 * junctions. Paint belongs to the cell containing its centre so shared edge roads aren't painted twice.
 */
export function addGround(mb: MeshBuilder, plan: CellPlan3, plazas: readonly Rect[] = [], scrambles: readonly Rect[] = [], holes: readonly Rect[] = [], open: readonly OpenLayout[] = [], covered: readonly Rect[] = []): void {
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
  // The city's edge: a grass verge a step up from the outer street, a low guardrail along its far side.
  for (const r of plan.roads) {
    if (!isVerge(r)) continue;
    slab(r.rect, 0, 0.14, KIND.grass, KIND.grass, 0x4a5a34);
    const q = r.rect;
    const out = r.vertical ? q.x + q.w / 2 > cell.x + cell.w / 2 : q.y + q.h / 2 > cell.y + cell.h / 2;
    const rail = r.vertical ? { x: out ? q.x + q.w - 0.25 : q.x, y: q.y, w: 0.25, h: q.h } : { x: q.x, y: out ? q.y + q.h - 0.25 : q.y, w: q.w, h: 0.25 };
    // (No rail where the edge meets Yūnagi Riverside Park: its lawn is open to walk and drive onto.)
    if (!inPark(rail.x + rail.w / 2, rail.y + rail.h / 2, 2)) slab(rail, 0.14, 0.85, KIND.plain, KIND.plain, 0xa8acb0);
  }
  // Along the water, the flood wall (a knee-high concrete parapet, as on the Sumida).
  for (const r of plan.roads) {
    if (!isRiverWalk(r)) continue;
    slab(r.rect, 0, 0.12, KIND.plain, KIND.sidewalk, 0x9a9488);
    const q = r.rect;
    const water = r.vertical ? q.x + q.w / 2 > cell.x + cell.w / 2 : q.y + q.h / 2 > cell.y + cell.h / 2;
    const wall = r.vertical ? { x: water ? q.x + q.w - 0.4 : q.x, y: q.y, w: 0.4, h: q.h } : { x: q.x, y: water ? q.y + q.h - 0.4 : q.y, w: q.w, h: 0.4 };
    slab(wall, 0.12, 1.0, KIND.plain, KIND.plain, 0x8e8c86);
  }
  // (Streets ending at a road's side reach through its pavement, so it's cut across their mouths; a street
  // without pavements of its own leaves room either side of its mouth for the kerb's rounded corner.)
  const reach = throughMouths(plan.roads);
  for (const r of reach) {
    if (r.sidewalk <= 0) continue;
    for (const strip of sidewalkStrips(r)) {
      const crossings = reach.filter((o) => o !== r && o.vertical !== r.vertical && o.kind !== 'coast' && overlaps(o.rect, strip));
      const gaps = crossings.map((o): Span => {
        const m = o.sidewalk > 0 ? 0 : kerbRadius(r, o);
        return r.vertical ? [o.rect.y - m, o.rect.y + o.rect.h + m] : [o.rect.x - m, o.rect.x + o.rect.w + m];
      });
      for (const piece of cut(strip, gaps, r.vertical)) slab(piece, 0, 0.15, KIND.plain, KIND.sidewalk, 0x8a867e);
    }
  }
  // The pavements' corners at each junction, kerbs rounded (pavementCorners).
  for (const c of pavementCorners(reach)) {
    for (const piece of c.rects) slab(piece, 0, 0.15, KIND.plain, KIND.sidewalk, 0x8a867e);
    const [cx, cz] = c.centre;
    if (cx < cell.x || cz < cell.y || cx >= cell.x + cell.w || cz >= cell.y + cell.h) continue;
    mb.kind = KIND.sidewalk;
    mb.color = lin(0x8a867e);
    mb.style = [0, 0, 0, 0];
    mb.flags = 0;
    const up: [number, number, number] = [0, 1, 0];
    const H = 0.15;
    for (let k = 0; k < c.arc.length - 1; k++) {
      const [ax, az] = c.arc[k];
      const [bx, bz] = c.arc[k + 1];
      // Top: a wedge of the fan (wound to face up), and the kerb's face under its edge (facing out).
      const ccw = (ax - cx) * (bz - cz) - (az - cz) * (bx - cx) < 0;
      const [p, q] = ccw ? [[ax, az], [bx, bz]] : [[bx, bz], [ax, az]];
      mb.quadN([cx, H, cz], [p[0], H, p[1]], [q[0], H, q[1]], [q[0], H, q[1]], up, up, up, up);
      mb.kind = KIND.plain;
      const mx = (ax + bx) / 2 - cx;
      const mz = (az + bz) / 2 - cz;
      const l = Math.hypot(mx, mz) || 1;
      const n: [number, number, number] = [mx / l, 0, mz / l];
      mb.quadN([p[0], 0, p[1]], [p[0], H, p[1]], [q[0], H, q[1]], [q[0], 0, q[1]], n, n, n, n);
      mb.kind = KIND.sidewalk;
    }
  }
  // Avenues' medians: a kerbed strip down the middle, planted (the expressway's piers stand in it).
  for (const m of plan.medians) {
    slab(m, 0, 0.18, KIND.plain, KIND.sidewalk, 0x9a968c);
    const inset = 0.35;
    const g: Rect = { x: m.x + inset, y: m.y + inset, w: m.w - 2 * inset, h: m.h - 2 * inset };
    // (Nothing grows under a parking area's apron: the strip there is bare.)
    if (g.w > 0.3 && g.h > 0.3 && !covered.some((q) => overlaps(q, g))) slab(g, 0.18, 0.22, KIND.grass, KIND.grass, 0x3a5a2e);
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

/** A pavement's corner at a junction (pavementCorners). */
export interface PavementCorner {
  /** The corner's paving less the rounded part. */
  readonly rects: Rect[];
  /** The rounded part: a fan round `centre` to the `arc` (points, from one kerb line to the other). */
  readonly centre: [number, number];
  readonly arc: [number, number][];
  readonly radius: number;
  /** Which way the corner points from `centre` (toward the junction), in x and z. */
  readonly toward: readonly [number, number];
}

/**
 * The radius of the kerb's corner where two streets meet: most of the narrower pavement's width; where one of
 * them has no pavements (a shared lane opening through the other's pavement), most of that pavement's, and no
 * more than half the lane's width.
 */
export function kerbRadius(a: Road3, b: Road3): number {
  if (a.sidewalk > 0 && b.sidewalk > 0) return 0.9 * Math.min(a.sidewalk, b.sidewalk);
  const lane = a.sidewalk > 0 ? b : a;
  return Math.min(0.9 * Math.max(a.sidewalk, b.sidewalk), Math.min(lane.rect.w, lane.rect.h) / 2);
}

/**
 * The pavement at each block corner where two streets cross, its outer corner, toward the junction, rounded
 * into a kerb (kerbRadius). Two streets with pavements: the square where the two strips would meet (each strip
 * stops at the other street). A street without pavements crossing or opening through another's pavement (a
 * shared lane's mouth): the end of that pavement's strip, which stops a radius short of the lane (addGround).
 * `rects` are the corner's paving less the rounded part; that is the fan round `centre` to the `arc`.
 */
export function pavementCorners(roads: readonly Road3[]): PavementCorner[] {
  const out: PavementCorner[] = [];
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;
  for (const a of roads) {
    if (!a.vertical || a.kind === 'coast') continue;
    for (const b of roads) {
      if (b.vertical || b.kind === 'coast' || (a.sidewalk <= 0 && b.sidewalk <= 0)) continue;
      const o = intersect(a.rect, b.rect);
      if (!o || o.w < 0.5 || o.h < 0.5) continue;
      for (const ix of [1, -1]) {
        for (const iz of [1, -1]) {
          // The corner of the overlap (ix, iz: inward), where a's and b's own pavement edges meet.
          const ex = ix > 0 ? o.x : o.x + o.w;
          const ez = iz > 0 ? o.y : o.y + o.h;
          if (!near(ex, ix > 0 ? a.rect.x : a.rect.x + a.rect.w) || !near(ez, iz > 0 ? b.rect.y : b.rect.y + b.rect.h)) continue;
          const sx = a.sidewalk;
          const sz = b.sidewalk;
          const R = kerbRadius(a, b);
          const inX = ex + ix * sx;
          const inZ = ez + iz * sz;
          const cx = inX - ix * R;
          const cz = inZ - iz * R;
          // (Beside a street without pavements the corner is the last R of the other's strip, back from its edge.)
          const ox = sx > 0 ? ex : ex - ix * R;
          const oz = sz > 0 ? ez : ez - iz * R;
          const span = (p: number, q: number): [number, number] => [Math.min(p, q), Math.abs(q - p)];
          const [x0, w0] = span(ox, cx);
          const [z0, h0] = span(oz, inZ);
          const [x1, w1] = span(cx, inX);
          const [z1, h1] = span(oz, cz);
          const rects = [{ x: x0, y: z0, w: w0, h: h0 }, { x: x1, y: z1, w: w1, h: h1 }].filter((r) => r.w > 0.01 && r.h > 0.01);
          const arc: [number, number][] = [];
          for (let k = 0; k <= 8; k++) {
            const t = (k / 8) * (Math.PI / 2);
            arc.push([cx + ix * R * Math.cos(t), cz + iz * R * Math.sin(t)]);
          }
          out.push({ rects, centre: [cx, cz], arc, radius: R, toward: [ix, iz] });
        }
      }
    }
  }
  return out;
}

/** Whether a point is off a pavement corner's rounded kerb: in the corner's tip, outside its arc (on the road). */
export function offKerb(c: PavementCorner, x: number, z: number): boolean {
  const dx = (x - c.centre[0]) * c.toward[0];
  const dz = (z - c.centre[1]) * c.toward[1];
  return dx > 0 && dz > 0 && dx <= c.radius && dz <= c.radius && dx * dx + dz * dz > c.radius * c.radius;
}

/** Removes the spans of a strip that crossing roads cover (`gaps`, each widened by `margin`; 1D along the strip's long axis). */
function cut(strip: Rect, gaps: readonly Span[], vertical: boolean, margin = 0): Rect[] {
  let spans: [number, number][] = [vertical ? [strip.y, strip.y + strip.h] : [strip.x, strip.x + strip.w]];
  for (const [ja, jb] of gaps) {
    const [a, b] = [ja - margin, jb + margin];
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
    // Its junction boxes (the same in both cells along a cell-edge road: plan.ts agreeJunctions).
    const boxes = junctionSpans(r, plan.roads);
    const centre = r.vertical ? q.x + q.w / 2 : q.y + q.h / 2;
    const lo = centre - carriage / 2;
    const hi = centre + carriage / 2;
    // Lines run along the free spans between junctions (stopping short for the crossings).
    const spanRect = r.vertical ? { x: q.x, y: q.y, w: q.w, h: q.h } : { x: q.x, y: q.y, w: q.w, h: q.h };
    for (const s of cut(spanRect, boxes, r.vertical, 4.5)) {
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
        // (A slip lane along each kerb (`Road3.slip`) is a lane of its own, set off by a solid line.)
        const slip = (r.slip ?? 0) / 2;
        const lane = r.median / 2 + (carriage / 2 - slip - r.median / 2) / 2;
        line(centre - lane, 0.15, WHITE, 5, 5);
        line(centre + lane, 0.15, WHITE, 5, 5);
        if (slip) {
          line(centre - (carriage / 2 - slip), 0.2, WHITE, 1e9, 0);
          line(centre + (carriage / 2 - slip), 0.2, WHITE, 1e9, 0);
        }
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
    for (const [ja, jb] of boxes) {
      if (jb - ja < 3) continue;
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
