import { describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';

// Manila (content/manila, ?city=manila) runs on the same engine as Toto: its content has to load and cross-validate.
describe('Manila content', () => {
  it('loads', () => {
    const c = loadDistrictContent('manila');
    expect(c.macro.cols).toBe(42);
    expect(c.macro.rows).toBe(28);
    expect(c.placed.some((p) => p.nodes.some((n) => n.id === 'bayside.start'))).toBe(true);
    expect(c.placed.some((p) => p.nodes.some((n) => n.id === 'city_garage.bay'))).toBe(true);
  });
  it('leaves Toto as it was', () => {
    expect(loadDistrictContent().macro.cols).toBe(44);
  });
});

describe('Manila street races', () => {
  it('have a field of six or more and a marshal', () => {
    const c = loadDistrictContent('manila');
    expect(c.streetRaces.length).toBeGreaterThan(0);
    for (const r of c.streetRaces) {
      expect(r.field.length + 1).toBeGreaterThanOrEqual(6);
      expect(c.placed.some((p) => p.nodes.some((n) => n.id === r.host))).toBe(true);
      // every gate is on the map's land
      for (const [col, row] of r.points) expect(c.macro.kindAt(Math.floor(col), Math.floor(row))).not.toBe('water');
    }
  });
});

describe('Manila rail', () => {
  it('has the Tafto Line: eight stations, each on a straight stretch with its face 10 m off the line', async () => {
    const { leftOf } = await import('../src/poc3d/district/rail');
    const { railStation } = await import('../src/poc3d/real/rail');
    const c = loadDistrictContent('manila');
    expect(c.rails.map((l) => l.id)).toEqual(['tafto']);
    const l = c.rails[0];
    const stations = c.placed.filter((p) => p.stamp.landmark === 'station');
    expect(stations).toHaveLength(8);
    for (const p of stations) {
      expect(p.stamp.station?.line).toBe('tafto');
      const st = railStation(l, p.id, p.stamp.station!, p.building.x, p.building.z);
      const a = l.path.at(st.s0);
      const b = l.path.at(st.s1);
      expect(a.hx * b.hx + a.hz * b.hz, p.id).toBeCloseTo(1, 6);
      const h = l.path.at(st.s);
      const [lx, lz] = leftOf(h);
      const off = Math.abs((p.building.x - h.x) * lx + (p.building.z - h.z) * lz);
      const half = Math.abs(lx) > 0.5 ? p.building.w / 2 : p.building.d / 2;
      expect(off - half, p.id).toBeCloseTo(10, 1);
    }
    expect(c.subway.lines.find((s) => s.id === 'tafto')?.stops.map((s) => s.code)).toEqual(['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08']);
  });
});

describe('Manila footbridges', () => {
  it('stand where nothing else is within the stairs\' reach, and can be walked from the street to the deck and back', async () => {
    const { DistrictModel } = await import('../src/poc3d/district/model');
    const { DISTRICTS3 } = await import('../src/poc3d/district/plan');
    const { CITIES } = await import('../src/poc3d/district/cityConfig');
    const fb = await import('../src/poc3d/district/footbridges');
    const c = loadDistrictContent('manila');
    expect(c.footbridges.length).toBeGreaterThan(8);
    const m = new DistrictModel(c.macro, [...DISTRICTS3], c.placed, CITIES.manila.seed, c.zones, c.avenues, c.terrain, [], []);
    for (const b of c.footbridges) {
      const R = fb.footbridgeReach(b);
      const [cx, cz] = b.alongX ? [0, 1] : [1, 0];
      const cells = new Set<string>();
      for (const [px, pz] of [[R.x, R.y], [R.x + R.w, R.y], [R.x, R.y + R.h], [R.x + R.w, R.y + R.h]]) cells.add(`${Math.floor(px / 128)},${Math.floor(pz / 128)}`);
      for (const k of cells) {
        const [mx, my] = k.split(',').map(Number);
        const p = m.plan(mx, my);
        if (!p) continue;
        for (const r of p.roads) {
          const q = r.rect;
          if (!(q.x < R.x + R.w && q.x + q.w > R.x && q.y < R.y + R.h && q.y + q.h > R.y)) continue;
          // only the avenue itself (running the bridge's way) may be under it
          expect(b.alongX ? !r.vertical : r.vertical, `${b.id}: a cross street under the stairs`).toBe(true);
        }
        for (const s of m.stamps(mx, my)) expect(s.rect.x < R.x + R.w && s.rect.x + s.rect.w > R.x && s.rect.y < R.y + R.h && s.rect.y + s.rect.h > R.y, `${b.id}: ${s.id} in reach`).toBe(false);
      }
      // Up the stair: the floor rises from the pavement to the deck, level for level, along the walker's line.
      const T = fb.stairT(b);
      const at = (s: number, t: number): [number, number] => (b.alongX ? [b.x + s, b.z + t] : [b.x + t, b.z + s]);
      let y = fb.KERB_Y;
      for (let s = fb.DECK_HALF + fb.STAIR_LEN; s >= fb.DECK_HALF; s -= 0.1) {
        const [x, z] = at(s, T);
        const f = fb.footbridgeFloor(b, x, z, y);
        expect(f, `${b.id} stair at ${s}`).not.toBeNull();
        expect(f! - y).toBeLessThan(0.2);
        y = f!;
      }
      expect(y).toBeCloseTo(fb.DECK_Y, 1);
      // From the street: the stair's foot is open to a walker on the ground, its flanks and the tower above one metre are not.
      const ground = fb.footbridgeGround(b);
      const inG = (x: number, z: number, r: number): boolean => ground.some((q) => x > q.x - r && x < q.x + q.w + r && z > q.y - r && z < q.y + q.h + r);
      for (let s = fb.DECK_HALF + fb.STAIR_LEN + 3; s >= fb.DECK_HALF + fb.STAIR_LEN - 1.3; s -= 0.1) expect(inG(...at(s, T), 0.3), b.id + ' foot of the stair ' + s).toBe(false);
      expect(inG(...at(fb.DECK_HALF + 4, T + 1.2), 0.3)).toBe(true);
      expect(inG(...at(fb.DECK_HALF + 4, T), 0.3)).toBe(true);
      // Across the deck to the far stair: the floor holds, nothing blocks the middle.
      const raised = fb.footbridgeRaised(b);
      const inR = (x: number, z: number, r: number): boolean => raised.some((q) => x > q.x - r && x < q.x + q.w + r && z > q.y - r && z < q.y + q.h + r);
      for (let t = T; t >= -T; t -= 0.25) {
        const [x, z] = at(0, t);
        expect(fb.footbridgeFloor(b, x, z, y), `${b.id} deck at ${t}`).toBe(fb.DECK_Y);
        expect(inR(x, z, 0.3), `${b.id} deck blocked at ${t}`).toBe(false);
      }
      // Under the deck it is the street: no floor to stand on when you are on the ground.
      expect(fb.footbridgeFloor(b, ...at(0, 0), 0)).toBeNull();
      // The rails hold you in.
      expect(inR(...at(fb.DECK_HALF + 0.05, 0), 0.3)).toBe(true);
      // Clear of the road: a bus (4.2 m) passes under.
      expect(fb.DECK_Y - 0.9).toBeGreaterThan(4.6);
      void cx;
      void cz;
    }
  });
});

describe('Manila brownouts', () => {
  it('are a pure function of the cell, the time and the weather, and likelier in a typhoon', async () => {
    const b = await import('../src/poc3d/district/brownout');
    const calm = { typhoon: 0, amount: 0, heat: false, temp: 28, weather: 'clear' as const };
    const storm = { ...calm, typhoon: 0.9, amount: 0.9 };
    const count = (c: number): number => b.brownoutWords(42, 28, 5000, c, null).reduce((n, w) => { let k = 0; for (let v = w; v > 0; v = Math.floor(v / 2)) k += v % 2; return n + k; }, 0);
    expect(count(b.outageChance(storm))).toBeGreaterThan(count(b.outageChance(calm)));
    expect(b.brownoutWords(42, 28, 5000, 0.5, null)).toEqual(b.brownoutWords(42, 28, 5000, 0.5, null));
    const forced = new b.Brownout();
    forced.set(42, 28, 128, b.brownoutWords(42, 28, 0, 0, { cx: 10, cy: 8, reach: 1 }));
    expect(forced.at(10 * 128 + 5, 8 * 128 + 5)).toBe(true);
    expect(forced.at(30 * 128, 20 * 128)).toBe(false);
  });
});
