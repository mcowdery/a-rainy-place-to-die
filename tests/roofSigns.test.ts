import { describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { DistrictModel } from '../src/poc3d/district/model';
import { DISTRICTS3 } from '../src/poc3d/district/plan';
import { roofClass, roofSign } from '../src/poc3d/real/roofSigns';
import { styleFor } from '../src/poc3d/real/buildings';
import { hasRooftopLetters } from '../src/poc3d/real/signs';
import { TRADE } from '../src/poc3d/real/shops';

describe('rooftop signs', () => {
  it('say what the building is: a love hotel a HOTEL, a pachinko parlour パチンコ, no bare NEON', () => {
    const seen = new Set<string>();
    for (let id = 1; id < 400; id++) {
      const hotel = roofSign(id, id * 37, id * 91, TRADE.lovehotel, null).text;
      expect(hotel).toMatch(/HOTEL|ホテル/);
      expect(roofSign(id, id * 37, id * 91, TRADE.pachinko, null).text).toMatch(/PACHINKO|パチンコ|パーラー/);
      for (const t of [TRADE.bar, TRADE.lounge, TRADE.general, TRADE.bank]) seen.add(roofSign(id, id * 37, id * 91, t, null).text);
    }
    expect(seen.has('NEON')).toBe(false);
    expect(seen.size).toBeGreaterThan(30);
  });

  it('keep the same sign out of the next tile', () => {
    // The same trade in the same tile class shares names; in the classes round it, none are shared.
    const names = (cls: number): Set<string> => {
      const out = new Set<string>();
      for (let id = 1; id < 2000; id++) out.add(roofSign(id, (cls & 1) * 80 + 5, (cls >> 1) * 80 + 5, TRADE.pachinko, null).text);
      return out;
    };
    const a = names(0);
    for (const c of [1, 2, 3]) for (const n of names(c)) expect(a.has(n), `${n} in tile classes 0 and ${c}`).toBe(false);
    expect(roofClass(5, 5)).toBe(0);
    expect(roofClass(85, 5)).toBe(1);
  });

  it('give the city a spread of them, not a few words', () => {
    const content = loadDistrictContent();
    const model = new DistrictModel(content.macro, DISTRICTS3, content.placed, 0x0c179090, content.zones, content.avenues);
    const words = new Map<string, number>();
    let n = 0;
    for (const [mx, my] of model.cells) {
      for (const b of model.plan(mx, my)!.buildings) {
        if (!hasRooftopLetters(b)) continue;
        n++;
        const w = roofSign(b.id, b.x, b.z, styleFor(b).trade, b.sign?.name ?? null).text;
        words.set(w, (words.get(w) ?? 0) + 1);
      }
    }
    expect(n).toBeGreaterThan(300);
    expect(words.size).toBeGreaterThan(60);
    expect(Math.max(...words.values()) / n).toBeLessThan(0.05);
  });
});
