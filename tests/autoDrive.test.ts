import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AutoDrive, laneAhead, lanePath, roadFinder, type AutoMode, type AutoVehicle, type AutoWorld, type RoadFinder, type RoadInfo } from '../src/poc3d/district/autoDrive';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { newParts, overall } from '../src/poc3d/district/crash';
import { Router } from '../src/poc3d/district/gps';
import { CITY_ASSISTS, OwnCar } from '../src/poc3d/district/ownCar';
import { CELL, DISTRICTS3 } from '../src/poc3d/district/plan';
import { scrambleKeys, Signals } from '../src/poc3d/district/traffic';
import { District } from '../src/poc3d/district/world';
import { Car, FLAT } from '../src/race/vehicle';
import type { DrivenVehicle, TrafficSystem } from '../src/poc3d/real/traffic';

/**
 * A little town: a north-south street down x = 0 and an east-west one along z = -128 (both on grid lines, 8 m
 * wide with 1.6 m pavements, so where they cross is a signal), and a side street along z = -60.
 */
const street = (vertical: boolean, centre: number): RoadInfo => ({ vertical, centre, width: 8, sidewalk: 1.6, median: 0, avenue: false });
const town: RoadFinder = (x, z, vertical) => {
  if (vertical) return Math.abs(x) <= 4.5 ? street(true, 0) : null;
  if (Math.abs(z + 128) <= 4.5) return street(false, -128);
  if (Math.abs(z + 60) <= 4.5) return street(false, -60);
  return null;
};
/** North up the street from z = 0, right at the signal, east to x = 120. */
const route: [number, number][] = [[0.5, 4], [0, 0], [0, -128], [120, -128], [120, -134]];
const nothing: AutoWorld = { light: () => 'green', vehicles: () => [], solid: () => null };

/** Drives the path on the real handling model on flat ground; `each` sees every step. */
function drive(mode: AutoMode, world: AutoWorld, each: (car: Car, auto: AutoDrive, t: number) => void = () => {}, secs = 90): { car: Car; auto: AutoDrive; t: number } {
  const car = new Car(undefined, CITY_ASSISTS);
  car.place(0.5, 4, Math.PI, FLAT);
  const auto = new AutoDrive(lanePath(route, car, town)!, mode, world);
  let t = 0;
  for (; t < secs && !auto.arrived; t += 1 / 60) {
    car.update(1 / 60, auto.step(1 / 60, car), FLAT);
    each(car, auto, t);
  }
  return { car, auto, t };
}

describe('auto drive', () => {
  it('lays the lane along the route: keeping left, the corner rounded, the junctions found', () => {
    const p = lanePath(route, { x: 0.5, z: 4 }, town)!;
    // Going north the lane is west of the centreline; going east, north of it.
    for (let i = 0; i < p.n; i++) {
      if (p.z[i] < -15 && p.z[i] > -110) expect(p.x[i]).toBeCloseTo(-1.2, 1);
      if (p.x[i] > 15 && p.x[i] < 90) expect(p.z[i]).toBeCloseTo(-129.2, 1);
      if (i) expect(Math.hypot(p.x[i] - p.x[i - 1], p.z[i] - p.z[i - 1])).toBeLessThan(1.3);
    }
    // The right turn is an arc, not a corner.
    expect(Math.max(...p.k)).toBeLessThan(0.2);
    expect(Math.max(...p.k)).toBeGreaterThan(0.08);
    // The side street is nothing to the main one; then the signal, where it turns right.
    expect(p.junctions.map((j) => [j.kind, j.turn])).toEqual([['signal', 'right']]);
    expect(p.junctions[0]).toMatchObject({ gx: 0, gy: -1, ns: true });
    // Out of the side street: a give-way line at the main street, turning left onto it.
    const out = lanePath([[30, -56], [30, -60], [0, -60], [0, 0], [0, 4]], { x: 30, z: -58 }, town)!;
    expect(out.junctions.map((j) => [j.kind, j.turn])).toEqual([['giveway', 'left']]);
    // Pulled in at the kerb at the end.
    expect(p.z[p.n - 1]).toBeCloseTo(-129.3, 1);
    expect(lanePath([[0, 0], [0, 0], [0, 0.2], [0, 0.3]], { x: 0, z: 0 }, town)).toBe(null);
  });

  it('gives the GPS the lane ahead of the car: its chevrons lie where it drives, round the corner too', () => {
    const p = lanePath(route, { x: 0.5, z: 4 }, town)!;
    // Half way up the street, a metre off the lane: the chevrons are in the lane, 7 m apart, pointing north.
    const a = laneAhead(p, -0.2, -60, -1, 90, 7, 6);
    expect(a.pts.length).toBeGreaterThan(8);
    expect(p.z[a.i]).toBeCloseTo(-60, 0);
    expect(a.pts[0].z).toBeCloseTo(-66, 0);
    for (const q of a.pts.filter((q) => q.z > -110)) {
      expect(q.x).toBeCloseTo(-1.2, 1);
      expect(q.dz).toBeLessThan(-0.99);
    }
    expect(Math.hypot(a.pts[1].x - a.pts[0].x, a.pts[1].z - a.pts[0].z)).toBeCloseTo(7, 1);
    // They carry on round the right turn into the eastbound lane, and stop at the path's end.
    const last = a.pts[a.pts.length - 1];
    expect(last.x).toBeGreaterThan(10);
    expect(last.z).toBeCloseTo(-129.2, 1);
    expect(last.dx).toBeGreaterThan(0.99);
    const end = laneAhead(p, 110, -129, a.i, 90, 7, 6);
    expect(end.pts.length).toBeLessThan(3);
    // Found again from the last place, and from nowhere.
    expect(laneAhead(p, -1.2, -80, a.i, 90, 7, 6).i).toBe(laneAhead(p, -1.2, -80, -1, 90, 7, 6).i);
  });

  it('drives it with the traffic: in its lane, slow round the corner, to the kerb', () => {
    let slowest = Infinity;
    let fastest = 0;
    const { car, auto, t } = drive('traffic', nothing, (c) => {
      if (c.z < -15 && c.z > -105) expect(c.x).toBeLessThan(-0.5);
      if (c.z < -15 && c.z > -105) expect(c.x).toBeGreaterThan(-2);
      if (c.z < -120 && c.x < 12) slowest = Math.min(slowest, c.u);
      fastest = Math.max(fastest, c.u);
    });
    expect(auto.arrived).toBe(true);
    expect(t).toBeLessThan(60);
    expect(slowest).toBeLessThan(6.5);
    expect(fastest).toBeLessThan(12.6);
    expect(fastest).toBeGreaterThan(10);
    expect(Math.abs(car.x - 120)).toBeLessThan(2);
    // (The carriageway's edge is 2.4 m from the centreline: the car's side a hand from the kerb.)
    expect(car.z).toBeLessThan(-129.1);
    expect(car.z).toBeGreaterThan(-129.6);
  });

  it('stops at a red light and goes on green; without the rules it goes through when nothing is coming', () => {
    let time = 0;
    const world: AutoWorld = { ...nothing, light: () => (time < 30 ? 'red' : 'green') };
    let waitedAt = -Infinity;
    const legal = drive('traffic', world, (c, a, t) => {
      time = t;
      // The nose behind the line (4.5 m short of the box, which starts at z = -124) while it's red.
      if (t < 30) expect(c.z).toBeGreaterThan(-119.5 + 2.2 - 0.3);
      if (t > 20 && t < 30 && c.u < 0.1) waitedAt = c.z;
      if (t > 20 && t < 29) expect(a.status).toBe('lights');
    });
    expect(waitedAt).toBeLessThan(-110);
    expect(legal.auto.arrived).toBe(true);
    // Without the rules: through a light that stays red, and on along the cross street.
    const red: AutoWorld = { ...nothing, light: () => 'red' };
    const careful = drive('careful', red, () => {}, 40);
    expect(careful.car.x).toBeGreaterThan(20);
    // Cross traffic coming: it waits at the line for it.
    time = 0;
    const cross: AutoVehicle = { x: -30, z: -126.8, dx: 1, dz: 0, v: 9, half: 2.2, width: 1.7 };
    const busy: AutoWorld = { ...red, vehicles: () => [cross] };
    const waits = drive('careful', busy, (c) => expect(c.z).toBeGreaterThan(-119.5 + 2.2 - 0.3), 30);
    expect(waits.car.u).toBeLessThan(0.3);
  });

  it('follows the vehicle ahead without touching it; the careful one goes round a stopped one', () => {
    // A car crawling north in the lane at 3 m/s.
    let lead = { x: -1.2, z: -30, dx: 0, dz: -1, v: 3, half: 2.2, width: 1.7 };
    const slow: AutoWorld = { ...nothing, vehicles: () => [lead] };
    drive('traffic', slow, (c) => {
      lead = { ...lead, z: lead.z - 3 / 60 };
      if (c.z > -110) expect(c.z - 2.2 - (lead.z + 2.2)).toBeGreaterThan(1);
      if (c.z > -110 && c.z < -15) expect(Math.abs(c.x + 1.2)).toBeLessThan(0.9);
    }, 25);
    // One stopped in the lane: the traffic's driver waits behind it; the careful one passes on the other side.
    const stopped: AutoVehicle = { x: -1.2, z: -40, dx: 0, dz: -1, v: 0, half: 2.2, width: 1.7 };
    const blocked: AutoWorld = { ...nothing, vehicles: () => [stopped] };
    const waits = drive('traffic', blocked, () => {}, 25);
    expect(waits.car.z).toBeGreaterThan(-40 + 4.4 + 1);
    expect(waits.car.u).toBeLessThan(0.3);
    const passes = drive('careful', blocked, (c) => {
      // Never into it.
      if (Math.abs(c.z + 40) < 4.4) expect(c.x).toBeGreaterThan(-1.2 + 1.7 + 0.2);
    }, 80);
    expect(passes.auto.arrived).toBe(true);
    // The fast one overtakes only into a lane going its way: on a street it follows.
    const fast = drive('fast', blocked, () => {}, 25);
    expect(fast.car.z).toBeGreaterThan(-40 + 4.4 + 1);
  });

  it('steers round something standing in its lane, and stops for what it cannot get round', () => {
    // A parked car against the kerb, half in the lane.
    const parked: AutoWorld = { ...nothing, solid: (x, z, r) => (Math.abs(x + 2.2) < 0.9 + r && Math.abs(z + 80) < 2.2 + r ? 'car' : null) };
    const round = drive('traffic', parked, (c) => {
      if (Math.abs(c.z + 80) < 2.2) expect(c.x - 0.85).toBeGreaterThan(-1.3);
    });
    expect(round.auto.arrived).toBe(true);
    // A wall right across the street.
    const wall: AutoWorld = { ...nothing, solid: (_x, z, r) => (Math.abs(z + 90) < 0.5 + r ? 'wall' : null) };
    const held = drive('fast', wall, (c) => expect(c.z - 2.2).toBeGreaterThan(-89.5), 30);
    expect(held.auto.status).toBe('in the way');
    expect(held.auto.blockedFor).toBeGreaterThan(5);
  });
});

// The real city: your car on its own handling and collisions (ownCar.ts), the district's walls, poles and parked cars.
const content = loadDistrictContent();
const district = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
const nav = new Router({ bounds: district.bounds, cells: district.cells, plan: (mx, my) => district.plan(mx, my), blocked: content.placed.map((p) => p.rect), cell: CELL, bridges: content.bridges }, 'drive');
const roads = roadFinder((mx, my) => district.plan(mx, my), content.bridges);
const signals = new Signals(scrambleKeys(content.placed, CELL));
const node = (id: string) => content.placed.flatMap((p) => p.nodes).find((n) => n.id === id)!;
const traffic = {
  addOwn: (_o: THREE.Object3D, half: number, width: number, label: string, x: number, z: number, dx: number, dz: number): DrivenVehicle =>
    ({ obj: new THREE.Group(), half, width, bus: false, axle: 1, label, x, z, dx, dz, v: 0, acc: 0, curv: 0, hideBody: false }) as DrivenVehicle,
} as unknown as TrafficSystem;

/** Drives from one node's street to another's, on the real car. `turned`: set out facing the wrong way. */
function trip(a: string, b: string, mode: AutoMode, turned = false): { car: OwnCar; auto: AutoDrive; t: number; km: number; top: number } {
  const A = node(a);
  const B = node(b);
  const from = nav.snap(A.x, A.z)!;
  const first = nav.route(from[0], from[1], B.x, B.z)!;
  const h = Math.atan2(first[2][0] - first[1][0], first[2][1] - first[1][1]) + (turned ? Math.PI : 0);
  // On the left of the road, as you'd be parked.
  const start = { x: from[0] + Math.cos(h) * 1.5 * (turned ? -1 : 1), z: from[1] - Math.sin(h) * 1.5 * (turned ? -1 : 1), h };
  const car = new OwnCar(new THREE.MeshBasicMaterial(), traffic, start, (x, z, r) => district.obstacle(x, z, r), null, () => [], true);
  Object.assign(car.parts, newParts());
  const route = nav.route(start.x, start.z, B.x, B.z, [Math.sin(h), Math.cos(h)])!;
  let clock = 0;
  const world: AutoWorld = { light: (gx, gy, ns) => signals.state(gx, gy, ns, clock), vehicles: () => [], solid: (x, z, r) => district.obstacle(x, z, r) };
  const auto = new AutoDrive(lanePath(route, car.sim, roads, car.size[0])!, mode, world, ...car.size);
  let top = 0;
  for (; clock < 900 && !auto.arrived && auto.blockedFor < 10; clock += 1 / 60) {
    car.drive(1 / 60, auto.step(1 / 60, car.sim));
    top = Math.max(top, car.sim.u);
  }
  return { car, auto, t: clock, km: auto.path.length / 1000, top };
}

describe('auto drive in the city', () => {
  it('is routed as a car can go: no turn across an avenue\u2019s unbroken median', () => {
    const inMedian = (x: number, z: number): boolean => {
      for (let my = Math.floor((z - 1) / CELL); my <= Math.floor((z + 1) / CELL); my++) {
        for (let mx = Math.floor((x - 1) / CELL); mx <= Math.floor((x + 1) / CELL); mx++) {
          if (district.plan(mx, my)?.medians.some((q) => x > q.x - 0.2 && x < q.x + q.w + 0.2 && z > q.y - 0.2 && z < q.y + q.h + 0.2)) return true;
        }
      }
      return false;
    };
    // Kaigan-dori by SPEED LAB: an avenue with a median, mid-block.
    expect(inMedian(3262, 2304)).toBe(true);
    // From its south side (traffic keeps left: the carriageway going west) to somewhere east, and from its north
    // side to somewhere west: round the block to the other carriageway, never straight over the median.
    const east = nav.route(3262, 2310, 3700, 2310)!;
    const west = nav.route(3262, 2298, 2900, 2298)!;
    const len = (r: [number, number][]): number => r.reduce((d, p, k) => (k ? d + Math.hypot(p[0] - r[k - 1][0], p[1] - r[k - 1][1]) : 0), 0);
    expect(len(east)).toBeGreaterThan(438 + 120);
    expect(len(west)).toBeGreaterThan(362 + 120);
    let corners = 0;
    // And along the way, every corner on a median is a left turn (x east, z south: a negative cross product).
    for (const r of [east, west, nav.route(node('speed_lab.front').x, node('speed_lab.front').z, node('totochuo_dept.front').x, node('totochuo_dept.front').z)!]) {
      for (let i = 2; i + 2 < r.length; i++) {
        const [x0, z0] = r[i - 1];
        const [x1, z1] = r[i];
        const [x2, z2] = r[i + 1];
        if (!inMedian(x1, z1)) continue;
        corners++;
        const cross = (x1 - x0) * (z2 - z1) - (z1 - z0) * (x2 - x1);
        const dot = (x1 - x0) * (x2 - x1) + (z1 - z0) * (z2 - z1);
        expect(cross < 0 || (dot > 0 && Math.abs(cross) < 0.3 * dot), `at ${Math.round(x1)}, ${Math.round(z1)}`).toBe(true);
      }
    }
    expect(corners).toBeGreaterThan(0);
  });

  // One trip for each way of driving (they're minutes of driving each): out of the garage and up to the crossing,
  // across Kaburo, and the long way out west to Sakuragaoka.
  const trips: [AutoMode, string, string][] = [
    ['traffic', 'city_garage.front', 'kaburo_crossing.view'],
    ['careful', 'kaburo_crossing.view', 'hotel_rouge.front'],
    ['fast', 'hotel_rouge.front', 'sakura_yu.front'],
  ];
  for (const [mode, a, b] of trips) {
    it(`gets there without a scratch: ${mode}`, () => {
      const r = trip(a, b, mode);
      const said = `${a} -> ${b}: ${r.auto.status} after ${r.t.toFixed(0)} s of ${r.km.toFixed(2)} km, ${r.auto.left.toFixed(0)} m left, top ${(r.top * 3.6).toFixed(0)} km/h`;
      expect(r.auto.arrived, said).toBe(true);
      expect(overall(r.car.parts), said).toBe(0);
      const B = node(b);
      expect(Math.hypot(r.car.sim.x - B.x, r.car.sim.z - B.z), said).toBeLessThan(60);
      // A sensible pace for the way of driving (lights and all).
      const kmh = (r.km / r.t) * 3600;
      if (mode === 'traffic') expect(r.top, said).toBeLessThan(14);
      if (mode === 'careful') expect(r.top, said).toBeLessThan(7.2);
      if (mode === 'fast') expect(r.top, said).toBeGreaterThan(17);
      expect(kmh, said).toBeGreaterThan(mode === 'careful' ? 9 : mode === 'fast' ? 25 : 14);
      console.info(said, `${kmh.toFixed(0)} km/h overall`);
    }, 120000);
  }

  it('gets there when it sets out facing away from the route', () => {
    const r = trip('kaburo_crossing.view', 'bar_kanpai.out', 'traffic', true);
    expect(r.auto.arrived, `${r.auto.status}, ${r.auto.left.toFixed(0)} m left`).toBe(true);
    expect(overall(r.car.parts)).toBe(0);
  }, 120000);
});
