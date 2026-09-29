import { describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { CELL, DISTRICTS3 } from '../src/poc3d/district/plan';
import { along, routeFor } from '../src/poc3d/district/traffic';
import { District } from '../src/poc3d/district/world';

const content = loadDistrictContent();

describe('bus stops', () => {
  // The tests' seed and the city's own (district/main.ts SEED): a stop at an edge's middle once stood in a junction.
  for (const seed of [7, 0x0c179090]) {
    it(`stand on the pavement, clear of junctions, crossing streets and anything built (seed ${seed})`, () => {
      const d = new District(content.macro, DISTRICTS3, content.placed, seed, content.zones, content.avenues);
      const onCarriageway = (x: number, z: number): boolean => {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            for (const r of d.plan(Math.floor(x / CELL) + dx, Math.floor(z / CELL) + dy)?.roads ?? []) {
              if (r.kind === 'coast') continue;
              const q = r.rect;
              const s = r.sidewalk;
              if (r.vertical ? x > q.x + s && x < q.x + q.w - s && z > q.y && z < q.y + q.h : z > q.y + s && z < q.y + q.h - s && x > q.x && x < q.x + q.w) return true;
            }
          }
        }
        return false;
      };
      for (const b of content.traffic.buses) {
        const route = routeFor(b.rect, false, (mx, my) => d.plan(mx, my), content.rail ? [content.rail.x] : []);
        for (const e of route.edges) {
          const p = along(route, e.mid);
          const kl = Math.hypot(e.kerb[0], e.kerb[1]);
          const o = [e.kerb[0] / kl, e.kerb[1] / kl];
          // The shelter (2 m either side of its centre) and the pole 3 m on, at and just behind the kerb.
          for (const t of [-2, 0, 2, 3]) {
            for (const out of [0, 0.6]) {
              const x = p.x + e.kerb[0] + e.dir[0] * t + o[0] * out;
              const z = p.z + e.kerb[1] + e.dir[1] * t + o[1] * out;
              const at = `${b.id} ${e.side} stop at ${x.toFixed(0)},${z.toFixed(0)}`;
              expect(onCarriageway(x, z), at).toBe(false);
              expect(d.obstacle(x, z, 0.2), at).toBe(null);
              expect(content.placed.some((q) => x > q.rect.x && x < q.rect.x + q.rect.w && z > q.rect.y && z < q.rect.y + q.rect.h), at).toBe(false);
            }
          }
        }
      }
    });
  }
});
