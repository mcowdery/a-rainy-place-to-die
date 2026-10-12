import { describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { CELL, DISTRICTS3 } from '../src/poc3d/district/plan';
import { District } from '../src/poc3d/district/world';
import { PHONE, PHONES_PER_CELL } from '../src/poc3d/real/phoneSites';

const content = loadDistrictContent();
const CITY_SEED = 0x0c179090;

describe('payphones', () => {
  const d = new District(content.macro, DISTRICTS3, content.placed, CITY_SEED, content.zones, content.avenues, content.bridges, undefined, [], [], content.traffic.buses);
  const cells = d.model.cells;
  const all = cells.flatMap(([mx, my]) => (d.model.phones(mx, my)?.props ?? []).map((p) => ({ p, mx, my, kind: d.plan(mx, my)!.kind })));

  it('stand all over the city, about as many a cell as each district is meant to have', () => {
    expect(all.length).toBeGreaterThan(300);
    expect(all.length).toBeLessThan(650);
    for (const [kind, want] of Object.entries(PHONES_PER_CELL)) {
      const n = cells.filter(([mx, my]) => d.plan(mx, my)!.kind === kind).length;
      if (n < 20) continue;
      const got = all.filter((q) => q.kind === kind).length / n;
      // (The set pieces' own are on top of a district's number, and a cell with few shops has fewer fronts to take one.)
      expect(got, kind).toBeGreaterThan(want * 0.5);
      expect(got, kind).toBeLessThan(want * 1.6 + 0.2);
    }
    // All four kinds are out there.
    for (const v of Object.values(PHONE)) expect(all.some((q) => q.p.variant === v), `variant ${v}`).toBe(true);
  });

  it('are the same every time, and the cell’s furniture has them', () => {
    const again = new District(content.macro, DISTRICTS3, content.placed, CITY_SEED, content.zones, content.avenues, content.bridges, undefined, [], [], content.traffic.buses);
    for (const [mx, my] of cells.slice(0, 200)) expect(again.model.phones(mx, my)?.props).toEqual(d.model.phones(mx, my)?.props);
    for (const [mx, my] of [[28, 11], [22, 11], [16, 10], [40, 10]] as const) {
      const inDetail = d.model.detail(mx, my)!.props.filter((p) => p.kind === 'payphone');
      expect(inDetail).toEqual(d.model.phones(mx, my)!.props);
    }
  });

  it('stand off the carriageways, out of buildings and in their own cell, clear of each other and of bus stops', () => {
    const stops = content.traffic.buses.flatMap((b) => d.model.busStops(b.id));
    for (const { p, mx, my } of all) {
      const at = `phone ${p.variant} at ${p.x.toFixed(0)},${p.z.toFixed(0)}`;
      expect(Math.floor(p.x / CELL) === mx && Math.floor(p.z / CELL) === my, at).toBe(true);
      const inRoad = (d.plan(mx, my)?.roads ?? []).some((r) => r.kind !== 'coast' && r.sidewalk > 0 && (r.vertical ? p.x > r.rect.x + r.sidewalk && p.x < r.rect.x + r.rect.w - r.sidewalk && p.z > r.rect.y && p.z < r.rect.y + r.rect.h : p.z > r.rect.y + r.sidewalk && p.z < r.rect.y + r.rect.h - r.sidewalk && p.x > r.rect.x && p.x < r.rect.x + r.rect.w));
      expect(inRoad, `${at}: in a carriageway`).toBe(false);
      const inBuilding = d.model.buildings(mx, my).some((b) => Math.abs(p.x - b.x) < b.w / 2 && Math.abs(p.z - b.z) < b.d / 2);
      expect(inBuilding, `${at}: in a building`).toBe(false);
      for (const s of stops) expect(Math.hypot(s.x - p.x, s.z - p.z), `${at}: by the stop ${s.name}`).toBeGreaterThan(1.5);
    }
    const nearest = all.map((a) => Math.min(...all.filter((b) => b !== a).map((b) => Math.hypot(a.p.x - b.p.x, a.p.z - b.p.z))));
    expect(Math.min(...nearest)).toBeGreaterThan(1.5);
  });

  it('give every station phones of its own', () => {
    for (const q of content.placed.filter((s) => s.stamp.landmark === 'station' || s.stamp.landmark === 'subway')) {
      const near = all.filter(({ p }) => Math.hypot(Math.max(q.rect.x - p.x, 0, p.x - q.rect.x - q.rect.w), Math.max(q.rect.y - p.z, 0, p.z - q.rect.y - q.rect.h)) < 2.5);
      expect(near.length, q.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('let you walk into a booth at its door and not through its walls', () => {
    const booth = all.find((q) => q.p.variant === PHONE.booth)!.p;
    const at = (along: number, out: number): [number, number] => [booth.x + booth.nz * along + booth.nx * out, booth.z - booth.nx * along + booth.nz * out];
    // Down the middle from the street: free to just inside. From the side and through the back: a wall.
    expect(d.blocked(...at(0, 1.2), 0.4), 'in front of the door').toBe(false);
    expect(d.blocked(...at(0, 0.5), 0.4), 'in the doorway').toBe(false);
    expect(d.blocked(...at(0, 0.1), 0.4), 'inside').toBe(false);
    expect(d.blocked(...at(0, -0.3), 0.4), 'into the phone').toBe(true);
    expect(d.blocked(...at(0.55, 0), 0.4), 'through the side').toBe(true);
    expect(d.blocked(...at(-0.55, 0), 0.4), 'through the other side').toBe(true);
  });
});
