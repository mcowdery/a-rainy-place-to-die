import { describe, expect, it } from 'vitest';
import { isBare, OUTFITS, pickOutfit, smokeOf, SUGGESTIVE, DISTRICT_PEOPLE, CITY_PEOPLE, type Outfit } from '../src/poc3d/district/peopleMix';
import { HOURS, seasonsOf, whenOf } from '../src/poc3d/district/peopleHours';
import { NUDE_FORM } from '../src/poc3d/real/mobShape';
import { applyPaint, bandPainter, briefsPainter, combine, type Painter, type Surface } from '../src/poc3d/real/mobTight';
import { outfitOf } from '../src/poc3d/real/people';

/** A flat grid of triangles in the plane z = 0, `n` squares a side, 3 cm each: a stand-in for a body's skin. */
function grid(n: number): Surface {
  const pos: number[] = [], shade: number[] = [], b0: number[] = [], b1: number[] = [], w: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      pos.push((i - n / 2) * 0.03, 0.8 + j * 0.03, 0);
      shade.push(101);
      b0.push(0);
      b1.push(1);
      w.push(1);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  return { pos, shade, b0, b1, w, idx, ys: 1, xs: 1, centreZ: () => -1, skin: 101 };
}

const area = (m: Surface): number => {
  let sum = 0;
  for (let t = 0; t < m.idx.length; t += 3) {
    const [a, b, c] = [m.idx[t], m.idx[t + 1], m.idx[t + 2]];
    const ux = m.pos[b * 3] - m.pos[a * 3], uy = m.pos[b * 3 + 1] - m.pos[a * 3 + 1];
    const vx = m.pos[c * 3] - m.pos[a * 3], vy = m.pos[c * 3 + 1] - m.pos[a * 3 + 1];
    sum += Math.abs(ux * vy - uy * vx) / 2;
  }
  return sum;
};

describe('painting a garment on the body (real/mobTight.ts)', () => {
  // A slanted edge across the grid: painted where u (height) is under a line rising with the distance across.
  const slant: Painter = (p) => (p.u < 0.9 + p.a * 0.5 ? 301 : null);

  it('cuts only the triangles at the garment\'s edge, and keeps the skin whole', () => {
    const m = grid(12);
    const before = { tris: m.idx.length / 3, area: area(m) };
    applyPaint(m, 0, m.pos.length / 3, slant, 3, 0.002);
    expect(area(m)).toBeCloseTo(before.area, 9);
    expect(m.idx.length / 3).toBeGreaterThan(before.tris);
    // Not everywhere: the far side of the grid is as it was (a flat, uncut region keeps its big triangles).
    expect(m.idx.length / 3).toBeLessThan(before.tris * 6);
  });

  it('leaves no crack where a cut triangle meets one that is not (no point sits on another triangle\'s edge)', () => {
    const m = grid(8);
    applyPaint(m, 0, m.pos.length / 3, slant, 3, 0.002);
    const V = m.pos.length / 3;
    const at = (i: number): [number, number] => [m.pos[i * 3], m.pos[i * 3 + 1]];
    const used = new Set<number>(m.idx);
    for (let t = 0; t < m.idx.length; t += 3) {
      for (const [p, q] of [[m.idx[t], m.idx[t + 1]], [m.idx[t + 1], m.idx[t + 2]], [m.idx[t + 2], m.idx[t]]]) {
        const [px, py] = at(p), [qx, qy] = at(q);
        const len = Math.hypot(qx - px, qy - py);
        for (const v of used) {
          if (v === p || v === q || v >= V) continue;
          const [x, y] = at(v);
          // Distance from the point to the segment, and where along it.
          const u = ((x - px) * (qx - px) + (y - py) * (qy - py)) / (len * len);
          if (u <= 1e-6 || u >= 1 - 1e-6) continue;
          const d = Math.hypot(px + u * (qx - px) - x, py + u * (qy - py) - y);
          expect(d, `vertex ${v} on the edge ${p}-${q}`).toBeGreaterThan(1e-7);
        }
      }
    }
  });

  it('puts the garment\'s colour where it says and leaves the rest', () => {
    const m = grid(10);
    applyPaint(m, 0, m.pos.length / 3, combine(bandPainter(401, 0.9, 0.92), bandPainter(301, 0.8, 1.1)), 3, 0.002);
    for (let i = 0; i < m.pos.length / 3; i++) {
      const u = m.pos[i * 3 + 1];
      if (u >= 0.9 && u <= 0.92) expect(m.shade[i]).toBe(401);
      else if (u >= 0.8 && u <= 1.1) expect(m.shade[i]).toBe(301);
      else expect(m.shade[i]).toBe(101);
    }
  });

  it('keeps the cleft\'s darkening under what is painted over it', () => {
    const m = grid(4);
    m.shade[7] = 101 - 0.2;
    applyPaint(m, 0, m.pos.length / 3, () => 301, 0);
    expect(m.shade[7]).toBeCloseTo(301 - 0.2, 9);
    expect(m.shade[8]).toBe(301);
  });

  it('briefs are cut higher at the sides than a boy-short', () => {
    const d = { skin: 101, cloth: 301, trim: 401 };
    const high = briefsPainter(d, { front: 0.95, side: 0.99, back: 0.97, cut: 0.07 });
    const boy = briefsPainter(d, { front: 0.95, side: 0.99, back: 0.97, cut: 0 });
    const side = { u: 0.84, a: 0.16, x: 0.16, front: true };
    expect(boy(side)).toBe(301);
    expect(high(side)).toBeNull();
    expect(high({ ...side, a: 0, x: 0 })).toBe(301);
  });
});

describe('the clothes of the night and of the period', () => {
  it('only adults wear the revealing ones: a child, an elder or a man falls back to everyday clothes', () => {
    for (const o of NUDE_FORM.filter((o) => o !== 'runner')) {
      expect(outfitOf({ long: false, body: 'child', outfit: o })).toBe('plain');
      expect(outfitOf({ long: false, body: 'elder', outfit: o })).toBe('plain');
      expect(outfitOf({ long: false, body: 'man', outfit: o })).toBe('plain');
      expect(outfitOf({ long: false, body: 'woman', outfit: o })).toBe(o);
    }
    expect(outfitOf({ long: false, body: 'man', outfit: 'runner' })).toBe('runner');
    expect(outfitOf({ long: false, body: 'child', outfit: 'runner' })).toBe('plain');
    for (const o of ['bikini', 'bunny', 'streetwalker', 'lingerie'] as const) expect(outfitOf({ long: false, body: 'woman', outfit: o })).toBe(o);
    expect(outfitOf({ long: false, body: 'man', outfit: 'trunks' })).toBe('trunks');
    expect(outfitOf({ long: false, body: 'woman', outfit: 'trunks' })).toBe('plain');
  });

  it('none of them is the nude body (that is the uncensored edition\'s hooks), and the demo hides the strongest', () => {
    for (const o of NUDE_FORM) expect(isBare(o)).toBe(false);
    for (const o of SUGGESTIVE) {
      expect(OUTFITS).toContain(o);
      expect(isBare(o)).toBe(false);
    }
    expect(SUGGESTIVE.has('lingerie' as Outfit) && SUGGESTIVE.has('bikini' as Outfit) && SUGGESTIVE.has('streetwalker' as Outfit)).toBe(true);
    expect(SUGGESTIVE.has('leggings' as Outfit)).toBe(false);
  });

  it('turn up in the places and at the hours they belong to', () => {
    // The night's streets have those who work them, and they keep the small hours and watch from a doorway.
    expect(whenOf('streetwalker', 'woman', 1, 0.5)).toEqual({ hours: 'deep', manner: 'shady' });
    expect(whenOf('lingerie', 'woman', 1, 0.5).hours).toBe('deep');
    expect(whenOf('bunny', 'woman', 1, 0.5).hours).toBe('evening');
    expect(whenOf('runner', 'man', 0.1, 0.5).hours).toBe('commute');
    expect(whenOf('driver', 'man', 0.1, 0.5).hours).toBe('always');
    for (const o of OUTFITS) expect(HOURS).toContain(whenOf(o, 'woman', 0.5, 0.5).hours);
    // Seasons: a jinbei and a bare chest in summer, a hanten in the cold.
    expect(seasonsOf('jinbei')).toBe(2);
    expect(seasonsOf('shirtless')).toBe(2);
    expect(seasonsOf('hanten') & 2).toBe(0);
    expect(seasonsOf('hanten') & 8).toBe(8);
    expect(seasonsOf('trench') & 2).toBe(0);
  });

  it('are in the mixes of the places that suit them, and not in the offices\' or the schools\'', () => {
    const count = (mix: Readonly<Record<string, number>>, from: readonly Outfit[]): number => from.reduce((a, o) => a + (mix[o] ?? 0), 0);
    const trade: readonly Outfit[] = ['streetwalker', 'lingerie', 'bunny', 'catsuit', 'bodycon', 'crop'];
    // Kaburo's district mix has a little; the other districts' none of the night's trade.
    expect(count(DISTRICT_PEOPLE.neon, trade)).toBeGreaterThan(0);
    for (const kind of ['tower', 'residential', 'oldtown', 'campus', 'electric', 'harbor']) expect(count(DISTRICT_PEOPLE[kind], ['streetwalker', 'lingerie', 'bunny', 'catsuit'])).toBe(0);
    expect(count(CITY_PEOPLE, ['streetwalker', 'lingerie', 'bunny', 'catsuit', 'bikini', 'bodycon', 'crop'])).toBe(0);
    // The offices have the power suit and the trench; the harbour its coveralls; the old town its jinbei, hanten and smocks.
    expect(DISTRICT_PEOPLE.tower.powersuit).toBeGreaterThan(1);
    expect(DISTRICT_PEOPLE.harbor.coverall).toBeGreaterThan(1);
    expect(DISTRICT_PEOPLE.oldtown.kappogi).toBeGreaterThan(0.5);
    expect(DISTRICT_PEOPLE.campus.runner).toBeGreaterThan(0.5);
    // A crowd of Kaburo at night is dressed in them, in the proportion the mix says, and never bare.
    let walkers = 0;
    const N = 4000;
    for (let seed = 0; seed < N; seed++) {
      const o = pickOutfit(DISTRICT_PEOPLE.neon, seed, (x) => x !== 'nude' && x !== 'nude_heels');
      expect(isBare(o)).toBe(false);
      if (o === 'streetwalker') walkers++;
    }
    expect(walkers / N).toBeGreaterThan(0.002);
    expect(walkers / N).toBeLessThan(0.03);
  });

  it('smoke where the trade and the trades do', () => {
    // A woman on the street late at night smokes far more often than the crowd's women.
    let n = 0, m = 0;
    for (let i = 0; i < 2000; i++) {
      const r = i / 2000;
      if (smokeOf({ body: 'woman', outfit: 'streetwalker' }, 'stand', r)) n++;
      if (smokeOf({ body: 'woman', outfit: 'plain' }, 'stand', r)) m++;
    }
    expect(n).toBeGreaterThan(m * 2);
    // Nobody in a leotard or a runner's kit does.
    for (const o of ['leotard', 'runner', 'bikini'] as const) expect(smokeOf({ body: 'woman', outfit: o }, 'stand', 0)).toBeNull();
  });
});
