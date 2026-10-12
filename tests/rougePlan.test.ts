import { describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { CORRIDOR, DOOR_HALF, FLOORS, FRONT_DOOR, GROUND, IN, KEEP, ROOMS, roomsOn, SHAFT, SIDE_DOOR, STAIR, type R4 } from '../src/poc3d/real/rougePlan';

const overlap = (a: R4, b: R4, eps = 1e-6): boolean => a[0] < b[1] - eps && b[0] < a[1] - eps && a[2] < b[3] - eps && b[2] < a[3] - eps;
const inside = (a: R4, b: R4, eps = 1e-6): boolean => a[0] >= b[0] - eps && a[1] <= b[1] + eps && a[2] >= b[2] - eps && a[3] <= b[3] + eps;

describe("Hotel Rouge's plan", () => {
  it('keeps every room inside the keep, and the rooms of a floor apart', () => {
    for (const r of ROOMS) expect(inside(r.rect, [IN.u0, IN.u1, IN.t0, IN.t1]), r.no).toBe(true);
    for (const f of FLOORS) {
      const rs = roomsOn(f);
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) expect(overlap(rs[i].rect, rs[j].rect), `${rs[i].no} / ${rs[j].no}`).toBe(false);
    }
  });

  it("puts each room's door in its door wall, on the corridor or the hall, clear of everything inside", () => {
    for (const r of ROOMS) {
      expect(r.doorU - DOOR_HALF, r.no).toBeGreaterThan(r.rect[0]);
      expect(r.doorU + DOOR_HALF, r.no).toBeLessThan(r.rect[1]);
      // A lane 1.5 m wide runs in from the door for 2.4 m: no furniture in it.
      const lane = r.wall === 't1' ? ([r.doorU - 0.75, r.doorU + 0.75, r.rect[3] - 2.4, r.rect[3]] as R4) : ([r.doorU - 0.75, r.doorU + 0.75, r.rect[2], r.rect[2] + 2.4] as R4);
      for (const s of r.solids) expect(overlap(s, lane), `${r.no}: ${s.join(',')} in the door's lane`).toBe(false);
      // The doorway's rect is the wall's slab, centred on the door.
      expect(r.gap[0]).toBeCloseTo(r.doorU - DOOR_HALF, 5);
      expect(r.gap[1]).toBeCloseTo(r.doorU + DOOR_HALF, 5);
    }
  });

  it("keeps a room's furniture inside it", () => {
    for (const r of ROOMS) for (const s of r.solids) expect(inside(s, r.rect), `${r.no}: ${s.join(',')}`).toBe(true);
  });

  it('opens the corridor to the stair hall and keeps the stair clear of rooms', () => {
    for (const f of FLOORS) for (const r of roomsOn(f)) expect(overlap(r.rect, SHAFT), `${r.no} in the shaft`).toBe(false);
    // Both lanes are on the shaft, the landing at its east end; the hall (west of the shaft) touches the corridor.
    expect(STAIR.lane2[0]).toBeGreaterThan(CORRIDOR.t1 - 1e-6);
    expect(STAIR.hall[1]).toBeCloseTo(STAIR.u0, 5);
    expect(STAIR.u1 + 1).toBeLessThan(IN.u1);
  });

  it("matches the stamp's door nodes and the front's openings", () => {
    const content = loadDistrictContent();
    const hotel = content.placed.find((p) => p.id === 'hotel_rouge')!;
    for (const r of ROOMS) {
      const n = hotel.nodes.find((q) => q.id === r.key);
      expect(n, r.no).toBeTruthy();
      expect(n!.floor, r.no).toBe(r.floor);
      expect(n!.swing, r.no).toBe(r.key);
      expect(n!.gap, r.no).not.toBeNull();
      // Its bath's glass door, if it has a bath.
      if (r.bathDoor) {
        const b = hotel.nodes.find((q) => q.id === r.bathDoor!.key);
        expect(b, `${r.no} bath`).toBeTruthy();
        expect(b!.floor).toBe(r.floor);
        expect(b!.swing).toBe(r.bathDoor.key);
      }
    }
    expect(hotel.stamp.w).toBeGreaterThan(KEEP.u1);
    expect(hotel.stamp.d).toBeGreaterThan(KEEP.t1);
    expect(FRONT_DOOR[0]).toBeGreaterThan(IN.u0);
    expect(FRONT_DOOR[1]).toBeLessThan(IN.u1);
    expect(SIDE_DOOR[0]).toBeGreaterThan(IN.t0);
    expect(GROUND.garage[1]).toBeLessThanOrEqual(IN.u1);
  });
});
