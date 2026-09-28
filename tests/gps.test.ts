import { describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { NavGrid, onRoute, pointsAhead } from '../src/poc3d/district/gps';
import { CELL, DISTRICTS3 } from '../src/poc3d/district/plan';
import { District } from '../src/poc3d/district/world';

const content = loadDistrictContent();
const district = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones);
const t0 = performance.now();
const nav = new NavGrid({ bounds: district.bounds, cells: district.cells, plan: (mx, my) => district.plan(mx, my), blocked: content.placed.map((p) => p.rect), cell: CELL });
const buildMs = performance.now() - t0;
const node = (id: string) => content.placed.flatMap((p) => p.nodes).find((n) => n.id === id)!;
const inBuilding = (x: number, z: number): boolean => {
  const p = district.plan(Math.floor(x / CELL), Math.floor(z / CELL));
  return !!p?.buildings.some((b) => Math.abs(x - b.x) < b.w / 2 - 0.2 && Math.abs(z - b.z) < b.d / 2 - 0.2);
};

describe('GPS', () => {
  it('routes along the streets between places across the city, never through a building', () => {
    const trips: [string, string][] = [
      ['kaburo_crossing.view', 'bar_kanpai.out'],
      ['bar_kanpai.out', 'hotel_rouge.front'],
      ['hotel_rouge.front', 'the_peak.front'],
      ['the_peak.front', 'sakura_yu.front'],
    ];
    for (const [a, b] of trips) {
      const A = node(a);
      const B = node(b);
      const t = performance.now();
      const r = nav.route(A.x, A.z, B.x, B.z);
      const ms = performance.now() - t;
      expect(r, `${a} -> ${b}`).not.toBeNull();
      const route = r!;
      expect(route[0]).toEqual([A.x, A.z]);
      expect(route[route.length - 1]).toEqual([B.x, B.z]);
      let len = 0;
      for (let i = 0; i + 1 < route.length; i++) {
        const [ax, az] = route[i];
        const [bx, bz] = route[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        len += L;
        // The first and last legs join the snapped grid; check the rest metre by metre.
        if (i === 0 || i + 2 === route.length) continue;
        for (let s = 0; s <= L; s += 1) expect(inBuilding(ax + ((bx - ax) * s) / L, az + ((bz - az) * s) / L), `${a} -> ${b} leg ${i}`).toBe(false);
      }
      const straight = Math.hypot(B.x - A.x, B.z - A.z);
      expect(len).toBeLessThan(straight * 1.8 + 60);
      expect(ms).toBeLessThan(400);
    }
    expect(buildMs).toBeLessThan(1500);
  });

  it('snaps a mark inside a building to the street outside it', () => {
    const p = district.plan(29, 11)!;
    const b = p.buildings[0];
    const s = nav.snap(b.x, b.z)!;
    expect(inBuilding(s[0], s[1])).toBe(false);
    expect(Math.hypot(s[0] - b.x, s[1] - b.z)).toBeLessThan(Math.max(b.w, b.d));
  });

  it('knows how far is left and where the route goes next', () => {
    const route: [number, number][] = [[0, 0], [100, 0], [100, 50]];
    const at = onRoute(route, 40, 3);
    expect(at.seg).toBe(0);
    expect(at.off).toBeCloseTo(3);
    expect(at.left).toBeCloseTo(110);
    const pts = pointsAhead(route, at.seg, at.t, 70, 10);
    // From 40 m along, every 10 m for 70 m: 50 ... 110 (round the corner at 100).
    expect(pts.map((p) => [Math.round(p.x), Math.round(p.z)])).toEqual([[50, 0], [60, 0], [70, 0], [80, 0], [90, 0], [100, 0], [100, 10]]);
    expect(pts[6].dz).toBeCloseTo(1);
  });
});
