import { describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { DistrictModel } from '../src/poc3d/district/model';
import { DISTRICTS3 } from '../src/poc3d/district/plan';
import { OUTFITS } from '../src/poc3d/district/peopleMix';
import { railReserved } from '../src/poc3d/district/rail';
import { addFigure, addUmbrella, cellCrowd, FIGURE_STRIDE, GHOST_COLORS, GhostBuilder, packFigures, outfitOf, posedFigure, templateIndex, TEMPLATE_COUNT, umbrellaIndex, type Body, type FigureSpec, type Hair, type Pose } from '../src/poc3d/real/people';

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
            expect(b.n).toBeLessThan(1500);
          }
        }
      }
    }
  }, 60000);

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
            if (o !== 'plain' && o !== 'school') expect(f.body).not.toBe('child');
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

  it('walk clear stretches of their own cell, together when they go together', () => {
    let walkers = 0;
    for (const [mx, my] of [[29, 12], [34, 10], [16, 9], [21, 10]] as const) {
      const plan = model.plan(mx, my)!;
      const crowd = cellCrowd(plan, model.detail(mx, my)!, model.plazas(mx, my));
      const cell = plan.rect;
      for (const f of crowd) {
        if (!f.walk) continue;
        walkers++;
        expect(f.pose).toBe('walk');
        const L = Math.hypot(f.walk.ex, f.walk.ez);
        expect(L).toBeGreaterThanOrEqual(7);
        expect(f.walk.speed).toBeGreaterThan(0.8);
        expect(f.walk.speed).toBeLessThan(1.7);
        // It faces the way it walks.
        expect(Math.sin(f.yaw) * f.walk.ex + Math.cos(f.yaw) * f.walk.ez).toBeCloseTo(L, 3);
        for (let s = 0; s <= 1; s += 0.1) {
          const x = f.x + f.walk.ex * s;
          const z = f.z + f.walk.ez * s;
          expect(x >= cell.x - 1 && x <= cell.x + cell.w + 1 && z >= cell.y - 1 && z <= cell.y + cell.h + 1).toBe(true);
          for (const b of plan.buildings) expect(Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2).toBe(false);
        }
      }
      // Couples and families walking together share their seed and their walk.
      for (let i = 0; i + 1 < crowd.length; i++) {
        const a = crowd[i], b = crowd[i + 1];
        if (a.walk && b.walk && a.seed === b.seed) expect(b.walk).toEqual(a.walk);
      }
    }
    expect(walkers).toBeGreaterThan(10);
  });
});
