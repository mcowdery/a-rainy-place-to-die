import { describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { CELL, DISTRICTS3 } from '../src/poc3d/district/plan';
import { along, loopValid, routeFor } from '../src/poc3d/district/traffic';
import { District } from '../src/poc3d/district/world';
import { JEEP, jeepFloor, jeepLayout, jeepSeats } from '../src/poc3d/district/jeepCabin';
import { JEEPNEY_LIVERIES } from '../src/poc3d/models/vehicles';

const content = loadDistrictContent('manila');
const lines = content.traffic.buses.filter((b) => b.jeepney !== undefined);
const district = new District(content.macro, DISTRICTS3, content.placed, 0x4d4e4c31, content.zones, content.avenues);

describe('Manila jeepney lines', () => {
  it('has several, each in one of the liveries, whose route board is the line', () => {
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) {
      expect(l.jeepney!, l.id).toBeLessThan(JEEPNEY_LIVERIES.length);
      expect(JEEPNEY_LIVERIES[l.jeepney!].route, l.id).toBe(l.name);
      expect(l.stops).toHaveLength(4);
      expect(l.buses, l.id).toBeGreaterThanOrEqual(2);
    }
    // All four liveries run somewhere.
    expect(new Set(lines.map((l) => l.jeepney)).size).toBe(JEEPNEY_LIVERIES.length);
  });

  it('run loops of built cells on both sides of every edge, on streets the planner made, none overlapping', () => {
    for (const l of lines) {
      expect(loopValid(content.macro, l.rect), l.id).toBe(true);
      const [c0, r0, c1, r1] = l.rect;
      for (let r = r0 - 1; r <= r1; r++) for (let c = c0 - 1; c <= c1; c++) expect(district.plan(c, r), `${l.id} cell ${c},${r}`).not.toBe(null);
      // The river (column 20) is never crossed.
      expect(c0 > 20 || c1 < 20, l.id).toBe(true);
    }
    for (const a of lines) for (const b of lines) {
      if (a === b) continue;
      const overlap = a.rect[0] < b.rect[2] && b.rect[0] < a.rect[2] && a.rect[1] < b.rect[3] && b.rect[1] < a.rect[3];
      expect(overlap, `${a.id} / ${b.id}`).toBe(false);
    }
  });

  it('have each stop (the pole, its bench) on the pavement, clear of junctions, crossing streets and anything built', () => {
    const onCarriageway = (x: number, z: number): boolean => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const r of district.plan(Math.floor(x / CELL) + dx, Math.floor(z / CELL) + dy)?.roads ?? []) {
            if (r.kind === 'coast') continue;
            const q = r.rect;
            const s = r.sidewalk;
            if (r.vertical ? x > q.x + s && x < q.x + q.w - s && z > q.y && z < q.y + q.h : z > q.y + s && z < q.y + q.h - s && x > q.x && x < q.x + q.w) return true;
          }
        }
      }
      return false;
    };
    for (const l of lines) {
      const route = routeFor(l.rect, false, (mx, my) => district.plan(mx, my), content.rails.flatMap((s) => s.segments));
      expect(route.length, l.id).toBeGreaterThan(1500);
      expect(route.edges).toHaveLength(4);
      for (const e of route.edges) {
        const p = along(route, e.mid);
        const kl = Math.hypot(e.kerb[0], e.kerb[1]);
        const o = [e.kerb[0] / kl, e.kerb[1] / kl];
        // The pole 4.2 m behind the stop's centre, the bench 1.3 m on from it (busStops in real/traffic.ts).
        for (const t of [-4.2, -3.5, -2.9, -2.2]) {
          const x = p.x + e.kerb[0] + e.dir[0] * t - o[0] * 0.3;
          const z = p.z + e.kerb[1] + e.dir[1] * t - o[1] * 0.3;
          const at = `${l.id} ${e.side} stop at ${x.toFixed(0)},${z.toFixed(0)}`;
          expect(onCarriageway(x, z), at).toBe(false);
          expect(district.obstacle(x, z, 0.2), at).toBe(null);
          expect(content.placed.some((q) => x > q.rect.x && x < q.rect.x + q.rect.w && z > q.rect.y && z < q.rect.y + q.rect.h), at).toBe(false);
        }
        // And no junction within the jeepney's own length of its stop.
        for (const j of route.junctions) expect(Math.abs(j.s - e.mid), `${l.id} ${e.side}`).toBeGreaterThan(j.cross / 2 + 4.5);
      }
    }
  });
});

describe('inside a jeepney', () => {
  const lay = jeepLayout();

  it('has seven seats along each bench, inside the body, none overlapping', () => {
    const seats = jeepSeats();
    expect(seats).toHaveLength(2 * JEEP.SEATS);
    for (const s of seats) {
      expect(Math.abs(s.x)).toBeGreaterThan(JEEP.AISLE);
      expect(Math.abs(s.x)).toBeLessThan(JEEP.INNER);
      expect(s.z - s.hd).toBeGreaterThanOrEqual(JEEP.BENCH_Z[0] - 1e-9);
      expect(s.z + s.hd).toBeLessThanOrEqual(JEEP.BENCH_Z[1] + 1e-9);
    }
    for (const a of seats) for (const b of seats) if (a !== b && a.side === b.side) expect(Math.abs(a.z - b.z)).toBeGreaterThanOrEqual(a.hd + b.hd - 1e-9);
  });

  it('lets you walk the aisle from the step to the cab, not into the benches, the walls or the partition', () => {
    for (let z = JEEP.BODY_Z[0] - 0.2; z < JEEP.BODY_Z[1] - 0.4; z += 0.2) expect(lay.blocked(0, z, 0.4, 1), `aisle ${z}`).toBe(false);
    expect(lay.blocked(0, JEEP.BODY_Z[1] - 0.1, 0.4, 1)).toBe(true);
    for (const s of jeepSeats()) expect(lay.blocked(s.x, s.z, 0.3, 1)).toBe(true);
    expect(lay.blocked(1.1, -1, 0.3, 1)).toBe(true);
    // Out of the back only while it stands; shut (moving) it is a wall.
    expect(lay.blocked(0, JEEP.STEP_Z[0] - 0.1, 0.4, 0)).toBe(true);
    expect(lay.blocked(0, JEEP.STEP_Z[0] - 0.1, 0.4, 1)).toBe(false);
    expect(lay.exit(0, JEEP.STEP_Z[0] - 0.1, 1)).toBe('door');
    expect(lay.exit(0, JEEP.STEP_Z[0] - 0.1, 0)).toBe(null);
    expect(lay.exit(0, -1, 1)).toBe(null);
  });

  it('keeps the eye under the canopy: stooped in the body, lower on the step', () => {
    expect(jeepFloor(-1) + 1.7).toBeLessThan(JEEP.CANOPY - 0.1);
    expect(jeepFloor(JEEP.BODY_Z[0] - 0.3)).toBeLessThan(jeepFloor(-1));
    for (const s of jeepSeats()) {
      const at = lay.seatNear(s.x, s.z, 0.8)!;
      expect(at.eye[1]).toBeLessThan(JEEP.CANOPY - 0.1);
      expect(at.eye[1]).toBeGreaterThan(JEEP.BENCH + 0.5);
      // Facing across the aisle: the left bench looks to -x (yaw +pi/2), the right to +x.
      expect(at.face).toBeCloseTo(s.side > 0 ? Math.PI / 2 : -Math.PI / 2);
      expect(lay.blocked(at.up[0], at.up[1], 0.2, 1)).toBe(false);
    }
  });

  it('seats you from the aisle, by the nearest seat, and from nowhere out on the road', () => {
    const near = lay.seatNear(0, -1.4, 0.8)!;
    expect(Math.hypot(near.x, near.z + 1.4)).toBeLessThan(0.8);
    expect(lay.seatNear(0, -6, 0.8)).toBe(null);
  });
});
