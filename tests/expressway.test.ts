import { describe, expect, it } from 'vitest';
import text from '../content/world3d/expressway.yaml?raw';
import { Expressway, parseExpressway, type Road } from '../src/poc3d/district/expressway';
import { Car, ROAD_ASSISTS, type Ground } from '../src/race/vehicle';

const errors: string[] = [];
const def = parseExpressway('expressway.yaml', text, errors)!;
const ex = new Expressway(def);

/** The racing model's ground on the network alone (for a car that stays on it). */
function ground(car: () => Car): Ground {
  const h = (x: number, z: number): number => ex.at(x, z, car().y, 1.4)?.height ?? car().y;
  return {
    height: h,
    normal: (x, z) => {
      const e = 0.6;
      const nx = -(h(x + e, z) - h(x - e, z)) / (2 * e);
      const nz = -(h(x, z + e) - h(x, z - e)) / (2 * e);
      const l = Math.hypot(nx, 1, nz);
      return [nx / l, 1 / l, nz / l];
    },
    grip: () => 1,
    collide: (x, z, hd, hl, hw) => {
      for (const f of [hl - 0.3, -(hl - 0.3)]) {
        for (const s of [hw, -hw]) {
          const px = x + Math.sin(hd) * f + Math.cos(hd) * s;
          const pz = z + Math.cos(hd) * f - Math.sin(hd) * s;
          const p = ex.pushBack(px, pz, car().y);
          if (p) return p;
        }
      }
      return null;
    },
  };
}

/** Follow a road's centreline (offset left by `lane`) from sample i0 for up to n samples (or a lap). */
function follow(road: Road, i0: number, n: number, lane = 0, pace = 1): { car: Car; offRoad: number; maxBump: number; steps: number } {
  const car = new Car(undefined, ROAD_ASSISTS);
  const g = ground(() => car);
  const lx = (i: number): number => road.x[i] + road.tz[i] * lane;
  const lz = (i: number): number => road.z[i] - road.tx[i] * lane;
  car.place(lx(i0), lz(i0), Math.atan2(road.tx[i0], road.tz[i0]), g);
  car.y = road.y[i0];
  let offRoad = 0;
  let maxBump = 0;
  let i = i0;
  let steps = 0;
  const N = road.x.length;
  for (let t = 0; t < 600 && steps < n; t += 1 / 60) {
    // Nearest sample ahead.
    let best = i;
    for (let k = 0; k < 12; k++) {
      const j = road.closed ? (i + k) % N : Math.min(N - 1, i + k);
      if (Math.hypot(road.x[j] - car.x, road.z[j] - car.z) < Math.hypot(road.x[best] - car.x, road.z[best] - car.z)) best = j;
    }
    steps += (best - i + N) % N;
    i = best;
    if (!road.closed && i >= N - 3) break;
    const look = Math.round(6 + Math.abs(car.u) * 0.5);
    const j = road.closed ? (i + look) % N : Math.min(N - 1, i + look);
    const dx = lx(j) - car.x;
    const dz = lz(j) - car.z;
    const err = Math.atan2(dx * Math.cos(car.h) - dz * Math.sin(car.h), dx * Math.sin(car.h) + dz * Math.cos(car.h));
    let turn = 0;
    for (let k = 5; k <= 40; k += 5) {
      const a = road.closed ? (i + k - 5) % N : Math.min(N - 1, i + k - 5);
      const b = road.closed ? (i + k) % N : Math.min(N - 1, i + k);
      turn = Math.max(turn, Math.acos(Math.min(1, road.tx[a] * road.tx[b] + road.tz[a] * road.tz[b])));
    }
    const want = Math.min(33, Math.max(8, Math.sqrt(6 * (5 / Math.max(turn, 1e-3))))) * pace;
    car.update(1 / 60, { throttle: car.u < want ? 1 : 0, brake: car.u > want + 2 ? 1 : 0, steer: Math.max(-1, Math.min(1, err * 3)), handbrake: false }, g);
    maxBump = Math.max(maxBump, car.bump);
    if (!ex.at(car.x, car.z, car.y)) offRoad++;
  }
  return { car, offRoad, maxBump, steps };
}

describe('the expressway', () => {
  it('loads', () => {
    expect(errors).toEqual([]);
    expect(ex.loop.x.length).toBeGreaterThan(3000);
    // The loop's four pairs, route 1's pair into the port, the Wangan's at each end and at Ebisu-jima, the islands'.
    expect(ex.roads.filter((r) => r.rampKind === 'on')).toHaveLength(10);
    expect(ex.roads.filter((r) => r.rampKind === 'off')).toHaveLength(10);
    // The Yūnagi tunnel is at the Wangan's east end now, in the headland.
    const yunagi = ex.roads.find((r) => r.id === 'yunagi')!;
    expect(yunagi.x[0]).toBeGreaterThan(41 * 128 - 40);
    expect(yunagi.hill).toBeGreaterThan(0);
    // Two-way routes: a deck each way, side by side, their piers shared on the line between them.
    const r1s = ex.roads.find((r) => r.id === 'r1_s')!;
    const r1n = ex.roads.find((r) => r.id === 'r1_n')!;
    expect(Math.abs(r1s.x[100] - r1n.x[r1n.x.length - 101])).toBeCloseTo(10.4, 0);
    expect(ex.roads.filter((r) => r.kind === 'spur').map((r) => r.venue)).toEqual(['kurokami', 'yunagi']);
  });

  it('ramps meet the street and the deck, on a drivable grade', () => {
    for (const r of ex.roads.filter((x) => x.kind === 'ramp')) {
      const lo = Math.min(r.y[0], r.y[r.y.length - 1]);
      const hi = Math.max(r.y[0], r.y[r.y.length - 1]);
      expect(lo).toBeCloseTo(0, 3);
      expect(hi).toBeCloseTo(def.deck, 3);
      for (let i = 1; i < r.y.length; i++) expect(Math.abs(r.y[i] - r.y[i - 1])).toBeLessThan(0.1);
      // The deck end overlaps the loop at its height, on the ramp's inner (right) side: a merge.
      const top = r.y[0] > r.y[r.y.length - 1] ? 0 : r.y.length - 1;
      expect(ex.at(r.x[top] - r.tz[top] * 1.8, r.z[top] + r.tx[top] * 1.8, def.deck)).not.toBe(null);
    }
  });

  it('a car drives a lap of the loop in the outside lane without leaving it', () => {
    const lap = follow(ex.loop, 0, ex.loop.x.length - 5, 1.7);
    expect(lap.steps).toBeGreaterThan(ex.loop.x.length - 20);
    expect(lap.offRoad).toBe(0);
    expect(lap.maxBump).toBeLessThan(3);
  });

  it('a car climbs the on-ramp from the street onto the deck', () => {
    const on = ex.roads.find((r) => r.id === 'kaburo_n_on')!;
    const run = follow(on, 2, on.x.length, 0, 0.8);
    expect(run.offRoad).toBe(0);
    expect(run.car.y).toBeGreaterThan(def.deck - 0.5);
  });

  it('keeps you on: a point off the edge is pushed back; under the deck is the street', () => {
    const i = 400;
    const L = ex.loop;
    const out = { x: L.x[i] + L.tz[i] * (def.half + 0.5), z: L.z[i] - L.tx[i] * (def.half + 0.5) };
    const p = ex.pushBack(out.x, out.z, def.deck)!;
    expect(p).not.toBe(null);
    expect(ex.at(out.x + p.px, out.z + p.pz, def.deck)).not.toBe(null);
    // At street level under the deck: not on the network, and nothing solid 0.35-5 m up there.
    expect(ex.at(L.x[i], L.z[i], 0)).toBe(null);
    expect(ex.solidAbove(L.x[i], L.z[i], 0.35, 5)).toBe(false);
    // The piers stand clear of the junctions.
    const rects = ex.streetColliders();
    expect(rects.length).toBeGreaterThan(50);
  });

  it('spurs end at their portals', () => {
    const s = ex.roads.find((r) => r.kind === 'spur')!;
    const n = s.x.length;
    expect(ex.portal(s.x[n - 3], s.z[n - 3], def.deck)).toBe(s);
    expect(ex.portal(s.x[n - 40], s.z[n - 40], def.deck)).toBe(null);
  });
});

import { fare, rideMetres } from '../src/poc3d/district/taxi';

describe('taxi fares', () => {
  it('charges the flag fall, then by the distance, more late at night', () => {
    expect(fare(800, false)).toBe(500);
    expect(fare(1100, false)).toBe(500);
    expect(fare(1400, false)).toBe(700);
    expect(fare(5000, false)).toBeGreaterThan(fare(2000, false));
    expect(fare(3000, true)).toBeGreaterThan(fare(3000, false));
    expect(rideMetres(0, 0, 300, 400)).toBeGreaterThan(700);
  });
});

import { loadDistrictContent } from '../src/poc3d/district/content';
import { District } from '../src/poc3d/district/world';
import { DISTRICTS3 } from '../src/poc3d/district/plan';
import { along, carLoops, routeFor } from '../src/poc3d/district/traffic';

describe('the expressway over the avenues', () => {
  const content = loadDistrictContent();
  const district = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
  district.extraColliders.push(...ex.streetColliders());

  it('stands every ramp over a street, its foot reachable from the lane behind it', () => {
    for (const r of ex.roads.filter((q) => q.kind === 'ramp')) {
      const i = r.rampKind === 'on' ? 0 : r.x.length - 1;
      const s = r.rampKind === 'on' ? -1 : 1;
      // The foot, and 30 m of lane before an entrance (after an exit) at street level: open road.
      for (let d = 0; d <= 30; d += 3) {
        const x = r.x[i] + r.tx[i] * s * d;
        const z = r.z[i] + r.tz[i] * s * d;
        expect(district.blocked(x, z, 0.9), `${r.id} ${d} m`).toBe(false);
      }
    }
  });

  it('keeps the street traffic clear of the piers, the medians and the ramps', { timeout: 30000 }, () => {
    const plan = (mx: number, my: number) => district.plan(mx, my);
    for (const loop of [...carLoops(content.macro, content.traffic, plan, ex.rampColliders()).map((c) => [c.rect, true] as const), ...content.traffic.buses.map((b) => [b.rect, false] as const)]) {
      const route = routeFor(loop[0], loop[1], plan, content.rails.flatMap((l) => l.segments));
      for (let s = 0; s < route.length; s += 2) {
        const p = along(route, s);
        expect(district.blocked(p.x, p.z, 0.8), `${loop[0].join(',')} at ${s}`).toBe(false);
      }
    }
  });
});

describe('ramp feet', () => {
  it('lets a car drive off the bottom of an exit ramp onto the street', () => {
    for (const r of ex.roads.filter((q) => q.rampKind === 'off')) {
      const n = r.x.length - 1;
      // Just past the foot, at street level: nothing pushes you back up the ramp.
      expect(ex.pushBack(r.x[n] + r.tx[n] * 1.5, r.z[n] + r.tz[n] * 1.5, 0)).toBe(null);
    }
  });
});

describe('the expressway as a network', () => {
  it('builds an open route off the loop: joined to it where they meet, walled elsewhere, into a tunnel at its end', () => {
    // A radial from the loop's south side straight down three blocks, with a tunnel at its end.
    const net: typeof def = {
      ...def,
      routes: [...def.routes, { id: 'r1', name: '1号線', nameEn: 'ROUTE 1', loop: false, pts: [[27, 13], [27, 16]] }],
      exits: [...def.exits, { id: 'port', venue: 'kurokami', route: 'r1', at: 1, length: 60, name: 'PORT' }],
    };
    const errs: string[] = [];
    const reparsed = parseExpressway('net.yaml', JSON.stringify(net), errs);
    expect(errs).toEqual([]);
    const n = new Expressway(reparsed!);
    const r1 = n.roads.find((r) => r.id === 'r1')!;
    expect(r1.kind).toBe('route');
    expect(r1.x.length).toBeGreaterThan(380);
    // Along it at deck height: on the network; where it starts, it's on the loop's deck too (a junction).
    for (let i = 0; i < r1.x.length; i += 10) expect(n.at(r1.x[i], r1.z[i], def.deck), `r1 ${i}`).not.toBe(null);
    expect(n.at(27 * 128, 13 * 128 + 3, def.deck)).not.toBe(null);
    // Off its side, part-way down: a wall pushes you back on.
    const i = 200;
    const side = { x: r1.x[i] + r1.tz[i] * (def.half + 0.5), z: r1.z[i] - r1.tx[i] * (def.half + 0.5) };
    expect(n.pushBack(side.x, side.z, def.deck)).not.toBe(null);
    // Its end runs on into the tunnel.
    const s = n.roads.find((r) => r.id === 'port')!;
    expect(n.portal(s.x[s.x.length - 3], s.z[s.x.length - 3], def.deck)).toBe(s);
  });

  it('refuses a ramp on a leg a route does not have, and a leg off the grid lines', () => {
    const errs: string[] = [];
    parseExpressway('bad.yaml', JSON.stringify({ ...def, ramps: [{ id: 'x', kind: 'on', route: 'c1', leg: 9, block: 0, name: 'X' }] }), errs);
    expect(errs.length).toBeGreaterThan(0);
    const errs2: string[] = [];
    parseExpressway('bad.yaml', JSON.stringify({ ...def, routes: [{ id: 'd', name: 'D', nameEn: 'D', loop: false, pts: [[0, 0], [3, 4]] }] }), errs2);
    expect(errs2.join()).toMatch(/grid line/);
  });
});

describe('the Denkō-chō car park', () => {
  it('drives from the street up every ramp to the roof without a step, and walls its floors off from the ramps beside them', async () => {
    const { carParkDecks, PARK } = await import('../src/poc3d/real/denko');
    const { localFrame, toWorld } = await import('../src/poc3d/real/localFrame');
    const content = loadDistrictContent();
    const p = content.placed.find((q) => q.stamp.landmark === 'car_park')!;
    const n = new Expressway(def);
    n.addDecks(carParkDecks(p.building, p.id));
    const f = localFrame(p.building);
    const { east, west, u0, u1, levels } = PARK;
    // Up ramp 1, along the first floor, up ramp 2, along the second, up ramp 3 to the roof.
    const legs: [number, number][][] = [
      [[east, -4], [east, 33.5]],
      [[east, 33.5], [u0 - 1.5, 33.5]],
      [[west, 33.5], [west, 6.5]],
      [[west, 6.5], [u1 + 1.5, 6.5]],
      [[east, 6.5], [east, 33.5]],
      [[east, 33.5], [30, 33.5]],
    ];
    let y = 0;
    for (const [a, b] of legs) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s <= L; s += 0.5) {
        const [x, z] = toWorld(f, a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L);
        const on = n.at(x, z, y);
        expect(on, `at ${a} +${s}`).not.toBe(null);
        expect(Math.abs(on!.height - y), `step at ${a} +${s}`).toBeLessThan(0.3);
        y = on!.height;
      }
    }
    expect(y).toBeCloseTo(levels[2], 1);
    // Off the first floor's east edge mid-way (beside ramp 1): a wall.
    const [x, z] = toWorld(f, u1 + 1.6, 20);
    expect(n.pushBack(x, z, levels[0])).not.toBe(null);
  });
});
