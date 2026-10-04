import { describe, expect, it } from 'vitest';
import type { Road3 } from '../src/poc3d/district/plan';
import { offKerb, pavementCorners } from '../src/poc3d/real/ground';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { CELL, DISTRICTS3 } from '../src/poc3d/district/plan';
import { DistrictModel } from '../src/poc3d/district/model';
import { District } from '../src/poc3d/district/world';
import { konbiniColliders } from '../src/poc3d/real/konbini';

const street = (vertical: boolean, at: number, w: number): Road3 => ({
  rect: vertical ? { x: at - w / 2, y: -100, w, h: 200 } : { x: -100, y: at - w / 2, w: 200, h: w },
  vertical,
  kind: 'street',
  sidewalk: 3,
  median: 0,
});

describe('pavement corners', () => {
  it('fills each block corner at a crossing, its kerb rounded toward the junction', () => {
    // Two 12 m streets crossing at the origin: carriageways 6 m wide, pavements 3 m.
    const corners = pavementCorners([street(true, 0, 12), street(false, 0, 12)]);
    expect(corners).toHaveLength(4);
    for (const c of corners) {
      // Each corner sits in its quadrant's pavement square (3 to 6 m out on both axes)...
      const [cx, cz] = c.centre;
      expect(Math.abs(cx)).toBeGreaterThanOrEqual(3);
      expect(Math.abs(cx)).toBeLessThanOrEqual(6);
      expect(Math.abs(cz)).toBeGreaterThanOrEqual(3);
      expect(Math.abs(cz)).toBeLessThanOrEqual(6);
      // ...and its arc runs from one kerb line (x = +-3) to the other (z = +-3), never into the carriageway.
      const ends = [c.arc[0], c.arc[c.arc.length - 1]];
      expect(ends.some(([x]) => Math.abs(Math.abs(x) - 3) < 1e-6)).toBe(true);
      expect(ends.some(([, z]) => Math.abs(Math.abs(z) - 3) < 1e-6)).toBe(true);
      for (const [x, z] of c.arc) expect(Math.abs(x) >= 3 - 1e-6 && Math.abs(z) >= 3 - 1e-6).toBe(true);
      // The square's other pieces stay within the square.
      for (const r of c.rects) {
        expect(Math.min(Math.abs(r.x), Math.abs(r.x + r.w))).toBeGreaterThanOrEqual(3 - 1e-6);
        expect(Math.max(Math.abs(r.x), Math.abs(r.x + r.w))).toBeLessThanOrEqual(6 + 1e-6);
      }
    }
  });

  it('leaves a T-junction’s far pavement alone', () => {
    // A side street from the south ending at the far kerb of an east-west street: only its two corners.
    const side: Road3 = { rect: { x: -6, y: -3, w: 12, h: 103 }, vertical: true, kind: 'street', sidewalk: 3, median: 0 };
    expect(pavementCorners([side, street(false, 0, 12)])).toHaveLength(2);
  });

  it('rounds the kerb either side of a lane’s mouth', () => {
    // A 7 m lane without pavements from the south, through the south pavement of an east-west street to its kerb.
    const lane: Road3 = { rect: { x: -3.5, y: 3, w: 7, h: 97 }, vertical: true, kind: 'street', sidewalk: 0, median: 0 };
    const corners = pavementCorners([lane, street(false, 0, 12)]);
    expect(corners).toHaveLength(2);
    for (const c of corners) {
      expect(c.radius).toBeCloseTo(2.7, 6);
      // Cut from the end of the street's pavement: the arc runs from the lane's edge (x = +-3.5) to the kerb (z = 3).
      const ends = [c.arc[0], c.arc[c.arc.length - 1]];
      expect(ends.some(([x]) => Math.abs(Math.abs(x) - 3.5) < 1e-6)).toBe(true);
      expect(ends.some(([, z]) => Math.abs(z - 3) < 1e-6)).toBe(true);
      for (const [x, z] of c.arc) expect(Math.abs(x) >= 3.5 - 1e-6 && z >= 3 - 1e-6 && z <= 6 + 1e-6).toBe(true);
      // The sharp tip that was there is road now; the paving behind the arc stays.
      const side = Math.sign(c.centre[0]);
      expect(offKerb(c, side * 3.6, 3.1)).toBe(true);
      expect(offKerb(c, side * 5.8, 5.4)).toBe(false);
    }
  });
});

describe('junctions on cell-edge roads', () => {
  const content = loadDistrictContent();
  const model = new DistrictModel(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
  const line = (r: Road3): number => (r.vertical ? r.rect.x + r.rect.w / 2 : r.rect.y + r.rect.h / 2);

  it('gives the two cells along a road one junction box and its median one nose', () => {
    let pairs = 0;
    let widened = 0;
    for (const [mx, my] of model.cells) {
      const p = model.plan(mx, my)!;
      for (const [nx, ny, vertical, at] of [[mx + 1, my, true, (mx + 1) * CELL], [mx, my + 1, false, (my + 1) * CELL]] as const) {
        const q = model.plan(nx, ny);
        const r = p.roads.find((o) => o.kind !== 'coast' && o.vertical === vertical && Math.abs(line(o) - at) < 0.01);
        const t = q?.roads.find((o) => o.kind !== 'coast' && o.vertical === vertical && Math.abs(line(o) - at) < 0.01);
        if (!r || !t) continue;
        pairs++;
        // The same boxes from either side (so the two halves of a crossing, and its stop line, line up)...
        expect(r.boxes, `${mx},${my} ${vertical ? 'east' : 'south'}`).toBeDefined();
        expect(r.boxes).toEqual(t.boxes);
        // ...at least as wide as each cell's own cross streets (where the one across is wider, widened to it)...
        for (const o of p.roads) {
          if (o.vertical === vertical || o.kind === 'coast' || line(o) % CELL !== 0) continue;
          const [a, b] = vertical ? [o.rect.y, o.rect.y + o.rect.h] : [o.rect.x, o.rect.x + o.rect.w];
          const box = r.boxes!.find(([s, e]) => s <= a && e >= b);
          if (!box) continue;
          if (box[0] < a - 0.01 || box[1] > b + 0.01) widened++;
        }
        // ...and the median's pieces end at the same places in both cells.
        if (!r.median) continue;
        const ends = (plan: typeof p, road: Road3): number[] =>
          plan.medians
            .filter((m) => (vertical ? Math.abs(m.x + m.w / 2 - at) < 0.01 : Math.abs(m.y + m.h / 2 - at) < 0.01))
            .flatMap((m) => (vertical ? [m.y, m.y + m.h] : [m.x, m.x + m.w]))
            .filter((v) => (vertical ? v > Math.max(road.rect.y, t.rect.y) && v < Math.min(road.rect.y + road.rect.h, t.rect.y + t.rect.h) : v > Math.max(road.rect.x, t.rect.x) && v < Math.min(road.rect.x + road.rect.w, t.rect.x + t.rect.w)))
            .sort((u, v) => u - v);
        expect(ends(p, r)).toEqual(ends(q!, t));
      }
    }
    expect(pairs).toBeGreaterThan(200);
    // (The case that showed: the streets either side of a line seldom have the same width.)
    expect(widened).toBeGreaterThan(20);
  });
});

describe('what you stand on', () => {
  const content = loadDistrictContent();
  const d = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);

  it('stands you on the raised pavement, the road a step down', () => {
    // Along a cell-edge street in Kaburo: a point on its pavement and one in its carriageway.
    const p = d.plan(27, 10)!;
    const r = p.roads.find((q) => q.sidewalk > 0 && q.vertical)!;
    const zMid = r.rect.y + r.rect.h / 2;
    expect(d.pavingAt(r.rect.x + r.sidewalk / 2, zMid)).toBeCloseTo(0.15, 3);
    expect(d.pavingAt(r.rect.x + r.rect.w / 2, zMid)).toBeLessThan(0.1);
  });

  it('lets you walk through the shoppers in Yoru Mart', () => {
    const konbini = content.placed.find((p) => p.stamp.landmark === 'konbini')!;
    // Only walls and fixtures: no small person-sized squares among them.
    for (const r of konbiniColliders(konbini.building)) expect(Math.abs(r.w - 0.6) < 0.01 && Math.abs(r.h - 0.6) < 0.01).toBe(false);
  });
});
