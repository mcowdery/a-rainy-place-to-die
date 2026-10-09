import { describe, expect, it } from 'vitest';
import { CHUNK, CONFIG } from '../src/config';
import { loadContent } from '../src/content/load';
import { overlaps } from '../src/core/coords';
import { hash } from '../src/core/hash';
import { isLand } from '../src/gen/macro';
import { TILES, T } from '../src/world/tiles';
import { World } from '../src/world/world';

const content = loadContent();
const newWorld = () => new World(content.macro, content.placements);

/** Order-sensitive fingerprint of a chunk's contents. */
function fingerprint(w: World, cx: number, cy: number): number {
  const c = w.chunk(cx, cy);
  let h = 0;
  for (let i = 0; i < c.tile.length; i++) h = hash(h, c.tile[i], c.glyph[i], c.fg[i]);
  return h;
}

/** A spread of chunks: every district, a coast, a stamp. */
const SAMPLE: [number, number][] = [
  [35, 3], [37, 12], [59, 11], [15, 12], [37, 19], [5, 23], [4, 21], [0, 0],
];

describe('world generation', () => {
  it('is deterministic across worlds and cache evictions', () => {
    const a = newWorld();
    const b = newWorld();
    for (const [cx, cy] of SAMPLE) expect(fingerprint(a, cx, cy)).toBe(fingerprint(b, cx, cy));
    // Churn a's cache far past its limit, then regenerate.
    for (let i = 0; i < CONFIG.chunkCacheMax + 50; i++) a.chunk(i % 80, 10 + Math.floor(i / 80));
    for (const [cx, cy] of SAMPLE) expect(fingerprint(a, cx, cy)).toBe(fingerprint(b, cx, cy));
  });

  it('matches the recorded snapshot (fails on unintended generator drift; bump generatorVersion + update if intended)', () => {
    const w = newWorld();
    expect(Object.fromEntries(SAMPLE.map(([cx, cy]) => [`${cx},${cy}`, fingerprint(w, cx, cy)]))).toMatchSnapshot();
  });

  it('is void outside the world', () => {
    const w = newWorld();
    expect(w.tileAt(-5, 10)).toBe(T.void);
    expect(w.tileAt(w.widthTiles + 3, 0)).toBe(T.void);
  });

  it('agrees on roads across a cell boundary', () => {
    // Along an interior vertical cell edge, the tile just left and right of the boundary must both be road.
    const w = newWorld();
    const mx = 18, my = 12; // tower, with tower to the east
    const x = (mx + 1) * CONFIG.cellW;
    const road = new Set([T.asphalt, T.sidewalk, T.road_mark, T.road_mark_v, T.alley]);
    for (let y = my * CONFIG.cellH + 10; y < (my + 1) * CONFIG.cellH - 10; y++) {
      expect(road.has(w.tileAt(x - 1, y)), `left of edge at y=${y}`).toBe(true);
      expect(road.has(w.tileAt(x, y)), `right of edge at y=${y}`).toBe(true);
    }
  });

  it('generates chunks fast enough to stream while walking', () => {
    const w = newWorld();
    const t0 = performance.now();
    let n = 0;
    for (let cy = 8; cy < 18; cy++) for (let cx = 20; cx < 40; cx++, n++) w.chunk(cx, cy);
    const ms = (performance.now() - t0) / n;
    expect(ms).toBeLessThan(10);
  });
});

describe('authored content', () => {
  const w = newWorld();

  it('places every stamp in a district cell', () => {
    for (const p of content.placements) {
      const kind = w.kindAt(p.rect.x, p.rect.y);
      expect(isLand(kind), `${p.id} is in ${kind}`).toBe(true);
    }
  });

  it('stamps override generated tiles exactly', () => {
    for (const p of content.placements) {
      for (let y = 0; y < p.stamp.h; y++) {
        for (let x = 0; x < p.stamp.w; x++) expect(w.tileAt(p.rect.x + x, p.rect.y + y)).toBe(p.stamp.tile[y * p.stamp.w + x]);
      }
    }
  });

  it('routes streets around stamps', () => {
    for (const p of content.placements) {
      const plan = w.plan(Math.floor(p.rect.x / CONFIG.cellW), Math.floor(p.rect.y / CONFIG.cellH))!;
      const through = plan.roads.filter((r) => r.kind === 'street' && overlaps(r.rect, p.rect));
      expect(through, `street through ${p.id}`).toEqual([]);
    }
  });

  it('every spawn opens onto the city (not boxed in)', () => {
    // BFS a bounded area from each spawn; it must reach well beyond its own stamp.
    for (const n of content.nodes.ofKind('spawn')) {
      const seen = new Set<string>([`${n.x},${n.y}`]);
      const queue: [number, number][] = [[n.x, n.y]];
      while (queue.length > 0 && seen.size < 400) {
        const [x, y] = queue.shift()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = `${x + dx},${y + dy}`;
          if (!seen.has(k) && TILES[w.tileAt(x + dx, y + dy)].walk) {
            seen.add(k);
            queue.push([x + dx, y + dy]);
          }
        }
      }
      expect(seen.size, `spawn ${n.id} reaches only ${seen.size} tiles`).toBeGreaterThanOrEqual(400);
    }
  });

  it('has one station per district, each with a working exit', () => {
    const stations = content.nodes.ofKind('station');
    const districts = new Set(stations.map((s) => w.kindAt(s.x, s.y)));
    expect(districts).toEqual(new Set(['residential', 'tower', 'neon', 'oldtown', 'harbor', 'beach']));
    for (const s of stations) expect(content.nodes.byId.get(s.returnSpawn!)?.kind).toBe('spawn');
  });

  it('keeps chunk and cell sizes aligned', () => {
    expect(CONFIG.cellW % CHUNK).toBe(0);
    expect(CONFIG.cellH % CHUNK).toBe(0);
  });
});
