import { describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { CELL, DISTRICTS3 } from '../src/poc3d/district/plan';
import { STOP_SPAN, stopClaim } from '../src/poc3d/district/stops';
import { along, parseTraffic3, routeFor, STOP_BUS_HALF } from '../src/poc3d/district/traffic';
import { District } from '../src/poc3d/district/world';

const content = loadDistrictContent();
const CITY_SEED = 0x0c179090;

describe('bus stops', () => {
  // The tests' seed and the city's own (district/main.ts SEED): a stop at an edge's middle once stood in a junction.
  for (const seed of [7, CITY_SEED]) {
    const d = new District(content.macro, DISTRICTS3, content.placed, seed, content.zones, content.avenues, content.bridges, undefined, [], [], content.traffic.buses);
    const roadsNear = (x: number, z: number) => {
      const out = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push(...(d.plan(Math.floor(x / CELL) + dx, Math.floor(z / CELL) + dy)?.roads ?? []));
      return out.filter((r) => r.kind !== 'coast');
    };
    const onCarriageway = (x: number, z: number): boolean =>
      roadsNear(x, z).some((r) => {
        const q = r.rect;
        const s = r.sidewalk;
        return r.vertical ? x > q.x + s && x < q.x + q.w - s && z > q.y && z < q.y + q.h : z > q.y + s && z < q.y + q.h - s && x > q.x && x < q.x + q.w;
      });
    const routes = content.traffic.buses.map((b) => ({ b, sites: d.model.busStops(b.id), route: routeFor(b.rect, false, (mx, my) => d.plan(mx, my), content.rails.flatMap((l) => l.segments), d.model.busStops(b.id)) }));

    it(`stand on the pavement, clear of junctions, side streets' mouths and anything built (seed ${seed})`, () => {
      for (const { b, sites, route } of routes) {
        expect(route.stops, b.id).toHaveLength(sites.length);
        route.stops.forEach((e, i) => {
          const site = sites[i];
          const p = along(route, e.s);
          const at = `${b.id} ${e.name} (${e.kind}) at ${site.x.toFixed(0)},${site.z.toFixed(0)}`;
          // The route's stop is the model's: the bus's middle stands beside the site.
          expect(Math.hypot(p.x + e.kerb[0] - site.x, p.z + e.kerb[1] - site.z), at).toBeLessThan(0.05);
          const kerbEdge = -site.pavement / 2;
          const [f0, f1] = STOP_SPAN[e.kind];
          // What it stands on: the pole's line by the kerb, and a shelter's depth.
          for (let t = f0; t <= f1; t += 1) {
            for (const out of [kerbEdge + 0.45, kerbEdge + (e.kind === 'shelter' ? 1.5 : 0.7)]) {
              const x = site.x + site.dir[0] * t + site.out[0] * out;
              const z = site.z + site.dir[1] * t + site.out[1] * out;
              expect(onCarriageway(x, z), at).toBe(false);
              expect(d.obstacle(x, z, 0.2), at).toBe(null);
              expect(content.placed.some((q) => x > q.rect.x && x < q.rect.x + q.rect.w && z > q.rect.y && z < q.rect.y + q.rect.h), at).toBe(false);
            }
            // No other street opens onto the pavement behind it (a lane inside the block ends at the road's edge).
            const bx = site.x + site.dir[0] * t + site.out[0] * (site.pavement / 2 + 0.6);
            const bz = site.z + site.dir[1] * t + site.out[1] * (site.pavement / 2 + 0.6);
            const mouth = roadsNear(bx, bz).some((r) => r.vertical !== (site.dir[0] === 0) && bx > r.rect.x && bx < r.rect.x + r.rect.w && bz > r.rect.y && bz < r.rect.y + r.rect.h);
            expect(mouth, `${at}: across a street's mouth`).toBe(false);
          }
          for (const j of route.junctions) {
            // Along the road from the junction's middle: clear of its box (the road crossed, or at a corner of the
            // loop the one the bus turned out of, which `cross` isn't) and the bus's own length beyond.
            const gap = Math.max(Math.abs(site.x - j.x), Math.abs(site.z - j.z));
            if (gap < CELL / 2) expect(gap, `${at}: by a junction`).toBeGreaterThan(j.turn ? 20 : j.cross / 2 + 10);
          }
        });
      }
    });

    it(`are a kind the pavement has room for, on a road wide enough for a bus (seed ${seed})`, () => {
      for (const { b, sites } of routes) {
        for (const s of sites) {
          if (s.forced) continue;
          const at = `${b.id} ${s.name} (${s.kind})`;
          expect(s.depth, at).toBeGreaterThanOrEqual(s.kind === 'shelter' ? 3 : s.kind === 'bench' ? 2 : 1.6);
          expect(s.pavement, at).toBeGreaterThanOrEqual(1.6);
          // A shelter leaves room to walk behind it.
          if (s.kind === 'shelter') expect(s.depth - 1.65, at).toBeGreaterThanOrEqual(1.3);
        }
      }
    });

    it(`have the bus stand by the kerb (seed ${seed})`, () => {
      for (const { b, sites, route } of routes) {
        route.stops.forEach((e, i) => {
          if (sites[i].forced) return;
          const laneToKerb = Math.hypot(e.kerb[0], e.kerb[1]) - e.pavement / 2;
          const side = laneToKerb - e.pull - STOP_BUS_HALF;
          expect(side, `${b.id} ${e.name}`).toBeGreaterThan(-0.3);
          expect(side, `${b.id} ${e.name}`).toBeLessThan(0.6);
        });
      }
    });

    it(`have the street's furniture keep off them (seed ${seed})`, () => {
      for (const { b, sites } of routes) {
        for (const s of sites) {
          const c = stopClaim(s);
          const inWay = d.propsNear(s.x, s.z, 12).filter((q) => ['lamp', 'tree', 'hedge', 'vending', 'pots', 'bike'].includes(q.kind) && q.x > c.x && q.x < c.x + c.w && q.z > c.y && q.z < c.y + c.h);
          expect(inWay.map((q) => q.kind), `${b.id} ${s.name}`).toEqual([]);
        }
      }
    });
  }

  it('are where each line asked, a few blocks apart', () => {
    const d = new District(content.macro, DISTRICTS3, content.placed, CITY_SEED, content.zones, content.avenues, content.bridges, undefined, [], [], content.traffic.buses);
    expect(d.model.stopProblems()).toEqual([]);
    for (const b of content.traffic.buses) {
      const sites = d.model.busStops(b.id);
      const route = routeFor(b.rect, false, (mx, my) => d.plan(mx, my), content.rails.flatMap((l) => l.segments), sites);
      expect(sites.length, b.id).toBe(b.serves!.length);
      expect(sites.every((s) => !s.forced), b.id).toBe(true);
      const at = route.stops.map((e) => e.s).sort((p, q) => p - q);
      at.forEach((s, i) => {
        const gap = (((at[(i + 1) % at.length] - s) % route.length) + route.length) % route.length;
        // (The longest gaps are the avenues under the expressway's ramps, where a slip lane lies between lane and kerb.)
        expect(gap, `${b.id} after stop ${i}`).toBeGreaterThan(150);
        expect(gap, `${b.id} after stop ${i}`).toBeLessThan(800);
      });
    }
  });

  it('read a line by the places it serves, or by four names', () => {
    const errors: string[] = [];
    const t = parseTraffic3('t.yaml', 'buses:\n  - { id: a, name: A, en: A, rect: [26, 10, 31, 12], stops: [{ name: 一, cell: [26, 10], side: west }, { name: 二, at: koban }] }\n  - { id: b, name: B, en: B, rect: [26, 10, 31, 12], stops: [北, 東, 南, 西] }', content.macro, errors);
    expect(errors).toEqual([]);
    expect(t.buses[0].serves).toEqual([{ name: '一', cell: [26, 10], side: 'west' }, { name: '二', at: 'koban' }]);
    expect(t.buses[1].serves).toBe(null);
    expect(t.buses[1].stops).toEqual(['北', '東', '南', '西']);
    parseTraffic3('t.yaml', 'buses:\n  - { id: a, name: A, en: A, rect: [26, 10, 31, 12], stops: [{ name: 一 }] }\n  - { id: b, name: B, en: B, rect: [26, 10, 31, 12], stops: [北, 東] }', content.macro, errors);
    expect(errors).toHaveLength(2);
  });
});
