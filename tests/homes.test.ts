import { describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { DISTRICTS3 } from '../src/poc3d/district/plan';
import { District } from '../src/poc3d/district/world';
import { HOMES } from '../src/poc3d/real/homesCast';
import { interiorFor } from '../src/poc3d/real/interiors';

const content = loadDistrictContent();
const district = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues, content.bridges, content.terrain);

describe("the cast's homes", () => {
  const homes = content.placed.filter((p) => HOMES[p.id]);

  it('has every home placed, each with a way in and a way out', () => {
    expect(homes.map((p) => p.id).sort()).toEqual(Object.keys(HOMES).sort());
    for (const p of homes) {
      const l = interiorFor(p)!.layout(p.building);
      const byId = new Map(p.nodes.map((n) => [n.id, n]));
      const doors = p.nodes.filter((n) => n.kind === 'door' && n.through);
      // Each flat has a door in from the street (to a spawn inside) and one out (to a spawn outside).
      const inside = (id: string | null): boolean => {
        const n = id ? byId.get(id) : undefined;
        return !!n && l.contains(n.x, n.z, n.floor + 1.7);
      };
      const ins = doors.filter((d) => !inside(d.id) && inside(d.returnSpawn));
      const outs = doors.filter((d) => inside(d.id) && !inside(d.returnSpawn));
      expect(ins.length, p.id).toBeGreaterThan(0);
      expect(outs.length, p.id).toBe(ins.length);
    }
  });

  it('lets you walk from where you come in to the door out, and keeps you inside', () => {
    for (const p of homes) {
      const l = interiorFor(p)!.layout(p.building);
      const byId = new Map(p.nodes.map((n) => [n.id, n]));
      district.setInterior(p.id, l);
      for (const d of p.nodes.filter((n) => n.kind === 'door' && n.through && n.returnSpawn && l.contains(byId.get(n.returnSpawn)!.x, byId.get(n.returnSpawn)!.z, byId.get(n.returnSpawn)!.floor + 1.7))) {
        const s = byId.get(d.returnSpawn!)!;
        const out = p.nodes.find((n) => n.kind === 'door' && n.through && Math.abs(n.floor - s.floor) < 0.5 && l.contains(n.x, n.z, n.floor + 1.7))!;
        const floor = district.floorAt(s.x, s.z, s.floor);
        expect(floor, `${s.id}`).toBeCloseTo(s.floor, 3);
        // Up to the door (you use it from within a few metres; it stands by its wall).
        const len = Math.hypot(out.x - s.x, out.z - s.z);
        for (let i = 0; i <= 20; i++) {
          const k = (Math.max(0, len - 0.6) / Math.max(len, 1e-6)) * (i / 20);
          const x = s.x + (out.x - s.x) * k;
          const z = s.z + (out.z - s.z) * k;
          expect(district.blocked(x, z, 0.3, floor), `${s.id} → ${out.id} ${i}`).toBe(false);
        }
        // Walls all round: a step 12 m off in any direction from the spawn meets one.
        for (let a = 0; a < 8; a++) {
          const dx = Math.cos((a * Math.PI) / 4);
          const dz = Math.sin((a * Math.PI) / 4);
          let hit = false;
          for (let r = 0; r < 30 && !hit; r += 0.2) hit = district.blocked(s.x + dx * r, s.z + dz * r, 0.3, floor);
          expect(hit, `${s.id} dir ${a}`).toBe(true);
        }
      }
      district.setInterior(p.id, null);
    }
  });
});
