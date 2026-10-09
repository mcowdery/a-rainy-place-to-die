import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { DistrictModel } from '../src/poc3d/district/model';
import { CELL, DISTRICTS3 } from '../src/poc3d/district/plan';
import { isBare, OUTFITS, smokeOf } from '../src/poc3d/district/peopleMix';
import { railReserved } from '../src/poc3d/district/rail';
import { buildShaped } from '../src/poc3d/real/mobShape';
import { scrambleKeys, Signals } from '../src/poc3d/district/traffic';
import { addFigure, addUmbrella, cellCrowd, handAt, holdHands, footingOf, FIGURE_STRIDE, GHOST_COLORS, GhostBuilder, figureMesh, packFigures, outfitOf, posedFigure, setMobShape, smokerJoints, smokerReach, templateIndex, TEMPLATE_COUNT, umbrellaIndex, type Body, type FigureSpec, type Hair, type Pose } from '../src/poc3d/real/people';

const spec = (body: Body, pose: Pose, extra: Partial<FigureSpec> = {}): FigureSpec => ({
  x: 10,
  z: 20,
  yaw: 0.7,
  body,
  pose,
  color: GHOST_COLORS[2],
  hair: 'short',
  long: false,
  phase: 0.25,
  side: 1,
  look: 0.2,
  ...extra,
});

const bounds = (s: FigureSpec): { lo: number; hi: number; r: number; n: number } => {
  const p = posedFigure(s);
  let lo = Infinity, hi = -Infinity, r = 0;
  for (let i = 0; i < p.length; i += 3) {
    expect(Number.isFinite(p[i] + p[i + 1] + p[i + 2])).toBe(true);
    lo = Math.min(lo, p[i + 1]);
    hi = Math.max(hi, p[i + 1]);
    r = Math.max(r, Math.hypot(p[i] - s.x, p[i + 2] - s.z));
  }
  return { lo, hi, r, n: p.length / 3 };
};

describe('mob figures', () => {
  // (The classic templates: the sculpted ones, the city's now, have their own tests below.)
  beforeAll(() => setMobShape('classic'));
  it('stand on the floor at believable heights', () => {
    const heights: Record<Body, [number, number]> = { man: [1.66, 1.78], woman: [1.54, 1.66], child: [1.0, 1.2], elder: [1.55, 1.7] };
    for (const body of Object.keys(heights) as Body[]) {
      // On the pavement, 0.15 m above the road.
      const b = bounds(spec(body, 'stand', { hair: 'none' }));
      expect(b.lo - 0.15).toBeGreaterThan(-0.01);
      expect(b.lo - 0.15).toBeLessThan(0.03);
      expect(b.hi - 0.15).toBeGreaterThan(heights[body][0]);
      expect(b.hi - 0.15).toBeLessThan(heights[body][1]);
    }
  });

  it('keep their feet out of the floor in every pose and all through the walk', () => {
    for (const body of ['man', 'woman', 'child', 'elder'] as Body[]) {
      for (const pose of ['stand', 'talk', 'phone', 'pockets', 'wave', 'hold'] as Pose[]) expect(bounds(spec(body, pose, { y: 1 })).lo).toBeGreaterThan(1.15 - 0.012);
      for (let phase = 0; phase < 1; phase += 0.05) {
        const lo = bounds(spec(body, 'walk', { phase, y: 1 })).lo;
        expect(lo).toBeGreaterThan(1.15 - 0.015);
        // ...and a foot on the ground (not walking on air).
        expect(lo).toBeLessThan(1.15 + 0.05);
      }
    }
  });

  it('pose every body, hair and outfit within a person-sized footprint', () => {
    for (const body of ['man', 'woman', 'child', 'elder'] as Body[]) {
      for (const pose of ['stand', 'walk', 'talk', 'phone', 'pockets', 'wave', 'hold'] as Pose[]) {
        for (const hair of ['short', 'long', 'bun', 'hat', 'cap', 'none'] as Hair[]) {
          for (const outfit of OUTFITS) {
            const b = bounds(spec(body, pose, { hair, outfit }));
            expect(b.r).toBeLessThan(1.0);
            expect(b.n).toBeLessThan(1800);
          }
        }
      }
    }
  }, 300000);

  it('bake people standing together with one fade seed, so they come and go together', () => {
    const gb = new GhostBuilder();
    // A couple side by side, their child, and someone across the street; then a walker next to them.
    const at: [number, number][] = [[0, 0], [0.6, 0], [0.3, 0.7], [9, 4]];
    for (const [x, z] of at) addFigure(gb, spec('man', 'stand', { x, z }));
    addFigure(gb, spec('woman', 'walk', { x: 0.2, z: 0.2, seed: 0.77, walk: { ex: 10, ez: 0, speed: 1.2, gap: 4 } }));
    const raw = gb.raw(0, 0)!;
    const fig = raw.attrs.aFig.array;
    const seeds: number[] = [];
    for (let i = 0; i < fig.length; i += 4) if (!seeds.includes(fig[i + 3])) seeds.push(fig[i + 3]);
    // Three seeds: the group's, the stranger's, the walker's own.
    expect(seeds.length).toBe(3);
    expect(seeds).toContain(Math.fround(0.77));
  });

  it('are numbers for the GPU: template, seed, walk and floor', () => {
    const f = packFigures([spec('woman', 'walk', { hair: 'bun', long: true, y: 2, walk: { ex: 10, ez: 0, speed: 1.3, gap: 5 } })], (x) => x * 0.1);
    expect(f.length).toBe(FIGURE_STRIDE);
    expect(f[0]).toBe(templateIndex({ body: 'woman', hair: 'bun', long: true }));
    expect(f[0]).toBeLessThan(TEMPLATE_COUNT);
    expect(f[4]).toBeGreaterThanOrEqual(0);
    expect(f[4]).toBeLessThan(1);
    expect([f[9], f[10], f[11]]).toEqual([10, 0, expect.closeTo(1.3, 5)]);
    // The floor at the start and the end of the walk, from the ground there plus its own.
    expect(f[13]).toBeCloseTo(0.15 + 2 + 1, 5);
    expect(f[14]).toBeCloseTo(0.15 + 2 + 2, 5);
  });

  it('share a seed when together; story NPCs never fade', () => {
    const seed = (s: FigureSpec): number => packFigures([s])[4];
    expect(seed(spec('man', 'walk', { seed: 0.3 }))).toBeCloseTo(0.3, 6);
    expect(seed(spec('woman', 'stand', { x: 40, seed: 0.3 }))).toBeCloseTo(0.3, 6);
    expect(seed(spec('man', 'walk'))).not.toBe(seed(spec('man', 'walk', { x: 11 })));
    expect(seed(spec('man', 'stand', { fade: false }))).toBe(-1);
  });

  it('bake into a mesh with every figure attribute, bounded where they stand', () => {
    const gb = new GhostBuilder();
    const s = spec('man', 'talk');
    addFigure(gb, s);
    let umbrellas = 0;
    for (let i = 0; i < 20; i++) if (addUmbrella(gb, spec('man', 'stand', { x: i * 3.1 }))) umbrellas++;
    expect(umbrellas).toBeGreaterThan(5);
    const raw = gb.raw(10, 20)!;
    for (const name of ['position', 'normal', 'aShade', 'aBone', 'aMirror', 'aFig', 'aPose', 'aWalk', 'aGround', 'aTint']) expect(raw.attrs[name]).toBeTruthy();
    const fig = raw.attrs.aFig.array;
    // The first figure's numbers on its vertices, relative to the origin given.
    expect([fig[0], fig[1], fig[2]]).toEqual([0, 0, expect.closeTo(0.7, 5)]);
    expect(raw.sphere[3]).toBeGreaterThan(3);
    expect(umbrellaIndex('man')).toBe(TEMPLATE_COUNT);
  });

  it('hold their umbrellas up in the hand, over their heads', () => {
    for (const body of ['man', 'woman', 'child', 'elder'] as Body[]) {
      for (const [pose, side] of [['stand', 1], ['stand', -1], ['walk', 1], ['hold', 1]] as [Pose, number][]) {
        const s = spec(body, pose, { side });
        const fig = posedFigure(s, true);
        const um = posedFigure(s, 'canopy');
        let top = 0, high = 0, low = 0;
        for (let i = 0; i < fig.length; i += 3) top = Math.max(top, fig[i + 1]);
        // The canopy: everything above the head (its middle over the head), its rim clear of it.
        let cx = 0, cz = 0, n = 0;
        for (let i = 0; i < um.length; i += 3) {
          if (um[i + 1] < um[low + 1]) low = i;
          high = Math.max(high, um[i + 1]);
          if (um[i + 1] > top + 0.05) {
            cx += um[i];
            cz += um[i + 2];
            n++;
          }
        }
        const where = `${body} ${pose} ${side}`;
        expect(n, where).toBeGreaterThan(50);
        expect(high, where).toBeGreaterThan(top + 0.25);
        expect(Math.hypot(cx / n - s.x, cz / n - s.z), where).toBeLessThan(0.2);
        // The handle's end just below the fist: the figure's nearest vertex (the hand) close by.
        let near = Infinity;
        for (let i = 0; i < fig.length; i += 3) near = Math.min(near, Math.hypot(fig[i] - um[low], fig[i + 1] - um[low + 1], fig[i + 2] - um[low + 2]));
        expect(near, where).toBeLessThan(0.1);
        // In the hand it's in: on that side of the body.
        const hand = pose === 'hold' ? -side : side;
        const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
        expect(hand * ((um[low] - s.x) * rx + (um[low + 2] - s.z) * rz), where).toBeGreaterThan(0);
      }
    }
    // The crowd's carriers hold theirs while it rains; baked figures only when asked.
    const carriers = Array.from({ length: 20 }, (_, i) => spec('man', 'stand', { x: i * 3.1 })).filter((s) => packFigures([s])[19] > 0);
    expect(carriers.length).toBeGreaterThan(5);
    for (const s of carriers) {
      expect(Math.abs(packFigures([s])[7])).toBeGreaterThan(2.5);
      expect(Math.abs(packFigures([s], null, false)[7])).toBeLessThan(2.5);
    }
  });
});

// The generation under review in the mob showroom (real/mobShape.ts): the same skeleton, fuller bodies.
describe('shaped mob figures', () => {
  beforeAll(() => setMobShape('shaped'));
  afterAll(() => setMobShape('classic'));
  const BODIES: Body[] = ['man', 'woman', 'child', 'elder'];
  const HAIRS: Hair[] = ['short', 'long', 'bun', 'hat', 'cap', 'none', 'bob', 'ponytail', 'twin'];

  it('stand on the floor at the same heights', () => {
    const heights: Record<Body, [number, number]> = { man: [1.66, 1.78], woman: [1.54, 1.66], child: [1.0, 1.2], elder: [1.55, 1.7] };
    for (const body of BODIES) {
      const b = bounds(spec(body, 'stand', { hair: 'none' }));
      expect(b.lo - 0.15).toBeGreaterThan(-0.01);
      expect(b.lo - 0.15).toBeLessThan(0.03);
      expect(b.hi - 0.15).toBeGreaterThan(heights[body][0]);
      expect(b.hi - 0.15).toBeLessThan(heights[body][1]);
    }
  });

  it('keep their feet out of the floor in every pose and all through the walk', () => {
    for (const body of BODIES) {
      for (const outfit of ['plain', 'long'] as const) {
        for (const pose of ['stand', 'talk', 'phone', 'pockets', 'wave', 'hold'] as Pose[]) expect(bounds(spec(body, pose, { y: 1, outfit })).lo).toBeGreaterThan(1.15 - 0.012);
        for (let phase = 0; phase < 1; phase += 0.05) {
          const lo = bounds(spec(body, 'walk', { phase, y: 1, outfit })).lo;
          expect(lo).toBeGreaterThan(1.15 - 0.015);
          expect(lo).toBeLessThan(1.15 + 0.05);
        }
      }
    }
  }, 30000);

  it('build teens shorter: whoever wears the school uniform, standing and walking on the floor', () => {
    for (const [body, lo, hi] of [['woman', 1.38, 1.52], ['man', 1.48, 1.62]] as const) {
      const adult = bounds(spec(body, 'stand', { hair: 'none' }));
      const teen = bounds(spec(body, 'stand', { hair: 'none', outfit: 'school' }));
      expect(teen.hi).toBeLessThan(adult.hi - 0.1);
      expect(teen.hi - 0.15).toBeGreaterThan(lo);
      expect(teen.hi - 0.15).toBeLessThan(hi);
      for (let phase = 0; phase < 1; phase += 0.05) {
        const foot = bounds(spec(body, 'walk', { phase, y: 1, outfit: 'school' })).lo;
        expect(foot).toBeGreaterThan(1.15 - 0.015);
        expect(foot).toBeLessThan(1.15 + 0.05);
      }
    }
  }, 120000);

  it('hold hands with their hands meeting: a child and a grown-up, a couple, a teen', () => {
    const pairs: [Body, Partial<FigureSpec>, Body, Partial<FigureSpec>][] = [['woman', { side: 1 }, 'child', {}], ['man', { side: -1 }, 'child', {}], ['elder', { side: 1 }, 'child', {}], ['man', { side: 1 }, 'woman', {}], ['woman', { side: -1, outfit: 'school' }, 'child', {}]];
    for (const [ba, ea, bb, eb] of pairs) {
      const [A, B] = holdHands(spec(ba, 'stand', { x: 3, z: -2, yaw: 0.7, ...ea }), spec(bb, 'stand', eb));
      const ha = handAt(A), hb = handAt(B);
      expect(Math.hypot(ha[0] - hb[0], ha[1] - hb[1], ha[2] - hb[2])).toBeLessThan(0.01);
      // Side by side, on its holding side, and not on top of one another.
      const d = Math.hypot(A.x - B.x, A.z - B.z);
      expect(d).toBeGreaterThan(0.3);
      expect(d).toBeLessThan(1.1);
      expect(B.side).toBe(-A.side);
    }
  }, 120000);

  it('stand on the floor whatever is on their feet (shoes, flats, heels, boots, sandals)', () => {
    for (const body of BODIES) {
      for (const outfit of OUTFITS) {
        const b = bounds(spec(body, 'stand', { outfit }));
        expect(b.lo - 0.15).toBeGreaterThan(-0.012);
        expect(b.lo - 0.15).toBeLessThan(0.03);
      }
    }
  }, 120000);

  it('build every body, hair and outfit, person-sized and within the triangle budget', () => {
    let most = 0;
    for (const body of BODIES) {
      for (const hair of HAIRS) {
        for (const outfit of OUTFITS) {
          for (const pose of ['stand', 'walk', 'wave', 'sit'] as Pose[]) expect(bounds(spec(body, pose, { hair, outfit })).r).toBeLessThan(1.0);
          // (A body with nothing on is never in a crowd, and a woman's has more points across the chest: a bound of its own.)
          const triangles = figureMesh({ body, hair, long: false, outfit }).triangles;
          if (isBare(outfit)) expect(triangles).toBeLessThan(9000);
          else most = Math.max(most, triangles);
        }
      }
    }
    expect(most).toBeLessThan(5100);
    // An everyday figure: a little over twice the classic one's triangles, no more.
    expect(figureMesh({ body: 'man', hair: 'short', long: false }).triangles).toBeLessThan(2800);
    // (A woman's hips and legs are one surface, finer round the back of the hips and through the thighs.)
    expect(figureMesh({ body: 'woman', hair: 'long', long: false }).triangles).toBeLessThan(4000);
  }, 300000);

  it("join a woman's hips, legs and the skin between them the right way out (the mob's material draws one side)", () => {
    // Where two faces share an edge they must run along it in opposite senses: the same sense means one of them faces
    // in, and is not drawn (a slit you see through, at the crotch).
    for (const outfit of ['plain', 'shorts', 'nude'] as const) {
      const t = buildShaped('woman', 'bob', outfit);
      const body = (i: number): boolean => Math.abs(t.pos[i * 3]) < 0.1 && t.pos[i * 3 + 1] > 0.72 && t.pos[i * 3 + 1] < 0.84 && (outfit !== 'nude' || t.shade[i] === 101);
      const edges = new Map<string, number[]>();
      for (let q = 0; q < t.idx.length; q += 3) {
        const tri = [t.idx[q], t.idx[q + 1], t.idx[q + 2]];
        if (!tri.every(body) || new Set(tri).size < 3) continue;
        for (let e = 0; e < 3; e++) {
          const a = tri[e], b = tri[(e + 1) % 3];
          const key = a < b ? `${a}_${b}` : `${b}_${a}`;
          edges.set(key, [...(edges.get(key) ?? []), a < b ? 1 : -1]);
        }
      }
      const wrong = [...edges.values()].filter((d) => d.length > 2 || (d.length === 2 && d[0] === d[1])).length;
      expect(wrong, outfit).toBe(0);
    }
  });

  it('give women a figure: a bust, the back hollow over round hips', () => {
    // The foremost and the rearmost points of the torso by height (standing square, facing +z; the arms hang outside).
    const p = posedFigure({ ...spec('woman', 'gait', { hair: 'none' }), x: 0, z: 0, yaw: 0, look: 0, pace: 0 });
    const band = (lo: number, hi: number): { back: number; front: number } => {
      let back = 1, front = -1;
      for (let i = 0; i < p.length; i += 3) {
        const y = p[i + 1] - 0.15;
        if (y < lo || y > hi || Math.abs(p[i]) > 0.12) continue;
        back = Math.min(back, p[i + 2]);
        front = Math.max(front, p[i + 2]);
      }
      return { back, front };
    };
    const bust = band(1.13, 1.2), waist = band(0.97, 1.02);
    expect(bust.front - waist.front).toBeGreaterThan(0.06);
    expect(bust.front - waist.front).toBeLessThan(0.14);
    expect(waist.back - band(0.8, 0.86).back).toBeGreaterThan(0.035);
  });
});

describe('street crowds', () => {
  const content = loadDistrictContent();
  const model = new DistrictModel(content.macro, DISTRICTS3, content.placed, 1, content.zones, content.avenues, content.terrain, railReserved(content.rails));

  it('dress for where they are: maids in the café lanes, suits on Skyscraper Row, never what a body cannot wear', () => {
    const tally = (zone: string): Record<string, number> => {
      const t: Record<string, number> = {};
      for (let my = 0; my < content.macro.rows; my++) {
        for (let mx = 0; mx < content.macro.cols; mx++) {
          const plan = model.plan(mx, my);
          if (!plan || content.zones.at(mx, my)?.id !== zone) continue;
          for (const f of cellCrowd(plan, model.detail(mx, my)!, model.plazas(mx, my))) {
            const o = outfitOf(f);
            t[o] = (t[o] ?? 0) + 1;
            if (o === 'maid') expect(f.body).toBe('woman');
            if (f.body === 'child') expect(['plain', 'school', 'yukata', 'otaku', 'hoodie', 'track', 'gym']).toContain(o);
            if (o === 'work' || o === 'police') expect(['man', 'woman']).toContain(f.body);
          }
        }
      }
      return t;
    };
    const lanes = tally('denko_culture');
    expect(lanes.maid ?? 0).toBeGreaterThan(5);
    const row = tally('skyscraper_row');
    expect(row.suit ?? 0).toBeGreaterThan((row.plain ?? 0) + (row.long ?? 0));
    expect(tally('kawabata_temple').kimono ?? 0).toBeGreaterThan(3);
  });

  const signals = new Signals(scrambleKeys(content.placed, CELL));
  const cells: [number, number][] = [[29, 12], [30, 12], [34, 10], [16, 9], [21, 10], [33, 8], [22, 11]];
  const crowdAt = (mx: number, my: number): { crowd: FigureSpec[]; foot: (x: number, z: number) => string; plan: NonNullable<ReturnType<typeof model.plan>> } => {
    const plan = model.plan(mx, my)!;
    const around = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) around.push(...(model.plan(mx + dx, my + dy)?.roads ?? []));
    // (As the chunk workers build it: chunkBuild.ts.)
    const solid = model.crowdSolids(mx, my);
    return { plan, foot: footingOf(around), crowd: cellCrowd(plan, model.detail(mx, my)!, model.plazas(mx, my), signals, around, solid.stamps, solid.fixtures) };
  };

  it('are mostly going somewhere, and nobody stands in the road', () => {
    let walking = 0, total = 0;
    for (const [mx, my] of cells) {
      const { crowd, foot, plan } = crowdAt(mx, my);
      for (const f of crowd) {
        total++;
        if (f.walk) walking++;
        if (!f.walk) {
          expect(foot(f.x, f.z)).toBe('foot');
          // Nobody stands with a building right in front of their face.
          const ax = f.x + Math.sin(f.yaw) * 0.9, az = f.z + Math.cos(f.yaw) * 0.9;
          for (const b of plan.buildings) expect(Math.abs(ax - b.x) < b.w / 2 && Math.abs(az - b.z) < b.d / 2).toBe(false);
          continue;
        }
        if (f.walk.signal) continue;
        // Walkers keep off the road (a shared lane is fine), out of buildings, facing the way they go.
        const L = Math.hypot(f.walk.ex, f.walk.ez);
        expect(Math.sin(f.yaw) * f.walk.ex + Math.cos(f.yaw) * f.walk.ez).toBeCloseTo(L, 3);
        for (let s = 0; s <= L; s += 1) {
          const x = f.x + (f.walk.ex * s) / L, z = f.z + (f.walk.ez * s) / L;
          if (L > 12) expect(foot(x, z)).not.toBe('road');
          for (const b of plan.buildings) expect(Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2).toBe(false);
        }
      }
    }
    expect(walking / total).toBeGreaterThan(0.65);
  });

  it('cross at the signals on the walk light', () => {
    let crossers = 0, scramble = 0;
    for (const [mx, my] of cells) {
      for (const f of crowdAt(mx, my).crowd) {
        const g = f.walk?.signal;
        if (!g) continue;
        crossers++;
        const w = f.walk!;
        const gx = Math.round(f.x / CELL), gy = Math.round(f.z / CELL);
        const alongNS = Math.abs(w.ez) > Math.abs(w.ex);
        const go = g.at + g.wait + 0.3;
        const there = g.at + g.wait + Math.hypot(w.ex, w.ez) / w.speed - 0.3;
        for (const t of [go, there, go + g.cycle * 7]) {
          if (signals.isScramble(gx, gy)) {
            // Every car stopped.
            expect(signals.state(gx, gy, true, t)).toBe('red');
            expect(signals.state(gx, gy, false, t)).toBe('red');
          } else {
            // The light alongside them green (and the road they cross red).
            expect(signals.state(gx, gy, alongNS, t)).not.toBe('red');
            expect(signals.state(gx, gy, !alongNS, t)).toBe('red');
          }
        }
        if (signals.isScramble(gx, gy)) scramble++;
      }
    }
    expect(crossers).toBeGreaterThan(20);
    expect(scramble).toBeGreaterThan(4);
  });

  it('keep out of the set pieces: nobody stands in or walks through their walls and fixtures', { timeout: 60000 }, () => {
    // Yasuichi's racks stand out on the pavement in front of its footprint, and are solid to the crowd there.
    const yasuichi = content.placed.find((p) => p.id === 'yasuichi')!;
    const [ymx, ymy] = yasuichi.cell;
    expect(model.crowdSolids(ymx, ymy).fixtures.filter((q) => q.y >= yasuichi.rect.y + yasuichi.rect.h).length).toBe(4);
    // Every cell a set piece's own collision reaches (stores, stations, precincts, forecourts).
    const stuck: string[] = [];
    let checked = 0;
    for (const [mx, my] of model.cells) {
      const { fixtures } = model.crowdSolids(mx, my);
      if (!fixtures.length) continue;
      const inside = (x: number, z: number): boolean => fixtures.some((q) => x > q.x && x < q.x + q.w && z > q.y && z < q.y + q.h);
      for (const f of crowdAt(mx, my).crowd) {
        checked++;
        // Where they stand (or wait for the walk light), and all along an ordinary walk.
        let hit = inside(f.x, f.z);
        if (f.walk && !f.walk.signal) {
          const L = Math.hypot(f.walk.ex, f.walk.ez);
          for (let s = 0; s <= L && !hit; s += 0.5) hit = inside(f.x + (f.walk.ex * s) / L, f.z + (f.walk.ez * s) / L);
        }
        if (hit) stuck.push(`${f.x.toFixed(1)}, ${f.z.toFixed(1)}`);
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(stuck).toEqual([]);
  });

  it('walk together when they go together', () => {
    for (const [mx, my] of cells) {
      const { crowd } = crowdAt(mx, my);
      for (let i = 0; i + 1 < crowd.length; i++) {
        const a = crowd[i], b = crowd[i + 1];
        if (a.walk && b.walk && a.seed !== undefined && a.seed === b.seed) expect(b.walk).toEqual(a.walk);
      }
    }
  });

  it('has smokers as the period had them: many of the men, few of the women, never the young; cigars for the bosses', () => {
    // Who: never a child, a school's clothes, a uniform at work, or anyone running; a fat cat and the old boss smoke cigars.
    for (let i = 0; i < 200; i++) {
      const r = i / 200;
      expect(smokeOf({ body: 'child', outfit: 'plain' }, 'stand', r)).toBeNull();
      for (const o of ['school', 'track', 'gym', 'yankee', 'police', 'nurse', 'maid'] as const) expect(smokeOf({ body: 'man', outfit: o }, 'stand', r)).toBeNull();
      expect(smokeOf({ body: 'man', outfit: 'suit' }, 'run', r)).toBeNull();
    }
    expect(smokeOf({ body: 'man', outfit: 'boss' }, 'stand', 0)).toBe('cigar');
    expect(smokeOf({ body: 'elder', outfit: 'yakuza', hair: 'hat' }, 'stand', 0)).toBe('cigar');
    expect(smokeOf({ body: 'man', outfit: 'yakuza', hair: 'short' }, 'stand', 0)).toBe('cigarette');
    const share = (who: Parameters<typeof smokeOf>[0], doing: 'stand' | 'walk'): number => Array.from({ length: 1000 }, (_, i) => smokeOf(who, doing, i / 1000)).filter(Boolean).length / 1000;
    expect(share({ body: 'man', outfit: 'plain' }, 'stand')).toBeGreaterThan(0.3);
    expect(share({ body: 'man', outfit: 'plain' }, 'walk')).toBeLessThan(share({ body: 'man', outfit: 'plain' }, 'stand'));
    expect(share({ body: 'woman', outfit: 'plain' }, 'stand')).toBeLessThan(0.1);
    expect(share({ body: 'man', outfit: 'yakuza' }, 'stand')).toBeGreaterThan(share({ body: 'man', outfit: 'plain' }, 'stand'));
    // In the streets: some of every crowd, and the same people every time.
    let smokers = 0, total = 0, cigars = 0;
    for (const [mx, my] of cells) {
      const { crowd } = crowdAt(mx, my);
      expect(crowdAt(mx, my).crowd.map((f) => f.smokes)).toEqual(crowd.map((f) => f.smokes));
      for (const f of crowd) {
        total++;
        if (!f.smokes) continue;
        smokers++;
        if (f.smokes === 'cigar') cigars++;
        expect(f.body).not.toBe('child');
        expect(f.pose).not.toBe('hold');
        expect(['school', 'track', 'gym', 'yankee', 'police']).not.toContain(outfitOf(f));
        if (f.walk) expect(f.walk.speed).toBeLessThanOrEqual(1.9);
        // (What it smokes rides in the carry number, over the bag, the umbrella and the straps.)
        const carry = Math.round(Math.abs(packFigures([f])[7])) - 1;
        expect(Math.floor(carry / 8)).toBe(f.smokes === 'cigar' ? 2 : 1);
      }
    }
    expect(smokers / total).toBeGreaterThan(0.04);
    expect(smokers / total).toBeLessThan(0.3);
    expect(cigars).toBeLessThan(smokers / 2);
    // And nobody else's numbers changed: someone who doesn't smoke packs as before.
    expect(Math.round(Math.abs(packFigures([{ ...crowdAt(29, 12).crowd.find((f) => !f.smokes)!, smokes: undefined }])[7])) - 1).toBeLessThan(8);
  });

  it("brings a smoker's fingers to the mouth, on every body that smokes", () => {
    for (const body of ['man', 'woman', 'elder'] as const) {
      const J = smokerJoints(body);
      const up = smokerReach(body, 1);
      const down = smokerReach(body, 0);
      // At the mouth: the fingers just in front of the lips (the cigarette's mouth end is 3 cm past them).
      const d = Math.hypot(up.hand[0] - up.mouth[0], up.hand[1] - up.mouth[1], up.hand[2] - up.mouth[2]);
      expect(d).toBeGreaterThan(0.015);
      expect(d).toBeLessThan(0.05);
      expect(up.hand[2]).toBeGreaterThan(up.mouth[2]);
      // Down: by the hip, below the chest, a little out in front.
      expect(down.hand[1]).toBeLessThan(up.mouth[1] - 0.45);
      expect(down.hand[2]).toBeGreaterThan(0);
      // (An arm that could do it: the elbow folded, not past what an elbow does.)
      expect(J.reach.bend).toBeGreaterThan(1.5);
      expect(J.reach.bend).toBeLessThanOrEqual(2.75);
    }
  });
});
