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
