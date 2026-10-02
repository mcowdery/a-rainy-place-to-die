import { describe, expect, it } from 'vitest';
import exText from '../content/world3d/expressway.yaml?raw';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { Expressway, parseExpressway } from '../src/poc3d/district/expressway';
import { CELL, DISTRICTS3 } from '../src/poc3d/district/plan';
import { leftOf, railReserved, roadUnder } from '../src/poc3d/district/rail';
import { subwayRoute } from '../src/poc3d/district/subway';
import { District } from '../src/poc3d/district/world';
import { railStation, trackAt, turnbacks, viaductPiers } from '../src/poc3d/real/rail';

const content = loadDistrictContent();
const line = (id: string) => content.rails.find((l) => l.id === id)!;
const net = content.subway;

describe('the elevated lines', () => {
  it('lays the lines out along the grid, corners rounded with no kinks', () => {
    expect(content.rails.map((l) => l.id)).toEqual(['toto', 'kawabata', 'monorail']);
    expect(line('toto').path.length).toBeCloseTo(10.6 * CELL, 3);
    for (const l of content.rails) {
      let prev = l.path.at(0);
      for (let s = 1; s <= l.path.length; s += 1) {
        const h = l.path.at(s);
        expect(Math.hypot(h.x - prev.x, h.z - prev.z), `${l.id} at ${s}`).toBeLessThan(1.05);
        // The heading turns no faster than the corner radius allows (a metre can span two samples).
        const turn = Math.acos(Math.min(1, h.hx * prev.hx + h.hz * prev.hz));
        expect(turn, `${l.id} at ${s}`).toBeLessThan(2 / (l.kind === 'monorail' ? 45 : 90) + 0.005);
        prev = h;
      }
    }
    expect(line('monorail').path.arcs).toHaveLength(4);
  });

  it("numbers each line's stations in order, each on a straight stretch 10 m off it", () => {
    const codes = (id: string) => net.lines.find((l) => l.id === id)!.stops.map((s) => `${s.code} ${s.en}`);
    expect(codes('toto')).toEqual(['T01 GAKUENZAKA', 'T02 ASAGIRI', 'T03 TŌTO-CHŪŌ', 'T04 KABURO', 'T05 KASUMI-CHŌ']);
    expect(codes('kawabata')).toEqual(['K01 KABURO-HIGASHI', 'K02 DENKŌ-CHŌ', 'K03 KAWABATA']);
    expect(codes('monorail')).toEqual(['M01 KASUMI-CHŌ', 'M02 TŌTO-KŌ', 'M03 TŌTO AIRPORT']);
    for (const p of content.placed.filter((q) => q.stamp.landmark === 'station')) {
      const l = line(p.stamp.station?.line ?? 'toto');
      const st = railStation(l, p.id, p.stamp.station!, p.building.x, p.building.z);
      // Straight under the whole platform, and the building's face 10 m off the line.
      const a = l.path.at(st.s0);
      const b = l.path.at(st.s1);
      expect(a.hx * b.hx + a.hz * b.hz, p.id).toBeCloseTo(1, 6);
      const h = l.path.at(st.s);
      const [lx, lz] = leftOf(h);
      const off = Math.abs((p.building.x - h.x) * lx + (p.building.z - h.z) * lz);
      const half = Math.abs(lx) > 0.5 ? p.building.w / 2 : p.building.d / 2;
      expect(off - half, p.id).toBeCloseTo(10, 1);
    }
  });

  it('routes across the lines: from the Wakaba Line to the airport, from the terminal to the old town', () => {
    const toAirport = subwayRoute(net, 'w03_station', 'airport_station')!;
    expect(toAirport[toAirport.length - 1]).toEqual({ kind: 'ride', line: 'monorail', from: 0, to: 2 });
    const toKawabata = subwayRoute(net, 'y03_station', 'kawabata_station')!;
    expect(toKawabata[toKawabata.length - 1]).toEqual({ kind: 'ride', line: 'kawabata', from: 0, to: 2 });
  });

  it('keeps the lines clear of the expressway (crossing under it) and of the buildings', () => {
    const ex = new Expressway(parseExpressway('expressway.yaml', exText, [])!);
    const d = new District(content.macro, DISTRICTS3, content.placed, 0x0c179090, content.zones, content.avenues, content.bridges, content.terrain, railReserved(content.rails));
    for (const l of content.rails) {
      for (let s = 0; s <= l.path.length; s += 2) {
        const p = l.path.at(s);
        // Nothing of the expressway between the beams' foot and the cars' roofs (6-12.5 m).
        for (const y of [7, 9, 11]) {
          const on = ex.at(p.x, p.z, y, 2.4);
          expect(on && on.height > 5.5 && on.height < 13 ? `${l.id} at ${s.toFixed(0)}: ${on.road.id}` : null).toBeNull();
        }
        // No generated building across the line (the cars and the deck: 4 m either side).
        const [lx, lz] = leftOf(p);
        for (const o of [-4, 0, 4]) {
          const x = p.x + lx * o;
          const z = p.z + lz * o;
          const cell = d.plan(Math.floor(x / CELL), Math.floor(z / CELL));
          const hit = cell?.buildings.find((b) => b.h > 5 && Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2);
          expect(hit ? `${l.id} at ${s.toFixed(0)} (${o}): building ${hit.id}` : null).toBeNull();
        }
      }
    }
  });

  it('stands the piers off the carriageway: in a median, or as portal frames on the pavements; one under each end', () => {
    const d = new District(content.macro, DISTRICTS3, content.placed, 0x0c179090, content.zones, content.avenues, content.bridges, content.terrain, railReserved(content.rails));
    const under = roadUnder((mx, my) => d.plan(mx, my));
    for (const l of content.rails) {
      const stations = content.placed
        .filter((p) => p.stamp.landmark === 'station' && (p.stamp.station?.line ?? 'toto') === l.id)
        .map((p) => railStation(l, p.id, p.stamp.station!, p.building.x, p.building.z));
      const piers = viaductPiers(l, stations, under);
      for (const r of piers) {
        const x = r.x + r.w / 2;
        const z = r.y + r.h / 2;
        const { s } = l.path.project(x, z);
        const h = l.path.at(s);
        const road = under(h.x, h.z, Math.abs(h.hz) > Math.abs(h.hx));
        if (!road || road.median) continue;
        // Across the line from its centre: past the kerb.
        const [lx, lz] = leftOf(h);
        const across = Math.abs((x - h.x) * lx + (z - h.z) * lz);
        expect(across - r.w / 2, `${l.id} pier at ${x.toFixed(0)},${z.toFixed(0)}`).toBeGreaterThan(road.half);
      }
      // Each end of the line stands on a pier.
      for (const end of [0, l.path.length]) {
        const e = l.path.at(end);
        expect(piers.some((r) => Math.hypot(r.x + r.w / 2 - e.x, r.y + r.h / 2 - e.z) < 12), `${l.id} end ${end}`).toBe(true);
      }
    }
  });

  it('turns the trains back at the ends over a crossover, clear of the platforms, the whole train on the line', () => {
    const TRAIN_HALF = (3 * 18 + 2 * 0.4) / 2;
    for (const l of content.rails) {
      const stations = content.placed
        .filter((p) => p.stamp.landmark === 'station' && (p.stamp.station?.line ?? 'toto') === l.id)
        .map((p) => railStation(l, p.id, p.stamp.station!, p.building.x, p.building.z));
      const tb = turnbacks(l.path.length, stations);
      for (const end of [tb.lo, tb.hi]) {
        const [z0, z1] = end.zone;
        expect(z0, `${l.id}`).toBeGreaterThan(0);
        expect(z1, `${l.id}`).toBeLessThan(l.path.length);
        expect(stations.some((st) => z1 > st.s0 && z0 < st.s1), `${l.id} crossover ${z0}-${z1} in a station`).toBe(false);
        // Standing to turn, the whole train is on the line and clear of the crossover.
        expect(end.stop - TRAIN_HALF).toBeGreaterThanOrEqual(0);
        expect(end.stop + TRAIN_HALF).toBeLessThanOrEqual(l.path.length);
        expect(end.stop - TRAIN_HALF >= z1 || end.stop + TRAIN_HALF <= z0, `${l.id} train at ${end.stop} on its crossover`).toBe(true);
      }
      // Up trains keep left (+), down trains (-), each crossing at its own end; never a jump along the way.
      for (const dir of [1, -1]) {
        let prev = trackAt(tb, 0, dir);
        for (let s = 0; s <= l.path.length; s += 0.5) {
          const o = trackAt(tb, s, dir);
          expect(Math.abs(o - prev), `${l.id} ${dir} at ${s}`).toBeLessThan(0.2);
          prev = o;
        }
      }
      expect(trackAt(tb, l.path.length / 2, 1)).toBeGreaterThan(0);
      expect(trackAt(tb, l.path.length / 2, -1)).toBeLessThan(0);
    }
  });
});
