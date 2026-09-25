import { describe, expect, it } from 'vitest';
import { overlaps, type Rect } from '../src/core/coords';
import { TIMES, WEATHERS } from '../src/atmosphere/rules';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { CELL, planCell3, STYLES3 } from '../src/poc3d/district/plan';
import { parseStamp3, reservedRect } from '../src/poc3d/district/stamps';

const content = loadDistrictContent();
const neonCells: [number, number][] = [];
for (let my = 0; my < content.macro.rows; my++)
  for (let mx = 0; mx < content.macro.cols; mx++) if (content.macro.kindAt(mx, my) === 'neon') neonCells.push([mx, my]);

const footprint = (b: { x: number; z: number; w: number; d: number }): Rect => ({ x: b.x - b.w / 2, y: b.z - b.d / 2, w: b.w, h: b.d });

describe('3D district planner', () => {
  it('is deterministic', () => {
    const [mx, my] = neonCells[10];
    expect(planCell3(content.macro, mx, my, [], 7)).toEqual(planCell3(content.macro, mx, my, [], 7));
  });

  it('only generates districts with a 3D style', () => {
    expect(STYLES3.neon).toBeDefined();
    expect(planCell3(content.macro, 18, 12, [], 7)).toBeNull(); // tower district: no 3D style yet
  });

  it('keeps buildings inside their cell, off streets and apart from each other', () => {
    for (const [mx, my] of neonCells.slice(0, 30)) {
      const p = planCell3(content.macro, mx, my, [], 7)!;
      const cell: Rect = { x: mx * CELL, y: my * CELL, w: CELL, h: CELL };
      const streets = p.roads.filter((r) => r.kind !== 'alley').map((r) => r.rect);
      p.buildings.forEach((b, i) => {
        const f = footprint(b);
        expect(f.x >= cell.x && f.y >= cell.y && f.x + f.w <= cell.x + CELL && f.y + f.h <= cell.y + CELL).toBe(true);
        expect(streets.some((s) => overlaps(s, f)), `building ${b.id} on a street`).toBe(false);
        for (const o of p.buildings.slice(i + 1)) expect(overlaps(f, footprint(o)), `buildings ${b.id}/${o.id} overlap`).toBe(false);
      });
    }
  });

  it('keeps ids unique across the district', () => {
    const ids = neonCells.flatMap(([mx, my]) => planCell3(content.macro, mx, my, [], 7)!.buildings.map((b) => b.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves stamps and their forecourt clear', () => {
    for (const placed of content.placed) {
      const r = reservedRect(placed);
      const p = planCell3(content.macro, placed.cell[0], placed.cell[1], [r], 7)!;
      expect(p.buildings.some((b) => overlaps(footprint(b), r))).toBe(false);
      expect(p.roads.some((q) => q.kind !== 'coast' && overlaps(q.rect, placed.rect))).toBe(false);
    }
  });
});

describe('3D stamps and atmosphere', () => {
  it('places Bar Kanpai with resolvable nodes', () => {
    const bar = content.placed.find((p) => p.id === 'bar_kanpai')!;
    const ids = bar.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['bar_kanpai.door', 'bar_kanpai.out', 'bar_kanpai.mama', 'bar_kanpai.detective']));
    expect(bar.nodes.find((n) => n.id === 'bar_kanpai.door')!.returnSpawn).toBe('bar_kanpai.out');
    const detective = bar.nodes.find((n) => n.id === 'bar_kanpai.detective')!;
    expect(detective.condition!((k) => (k === 'world.time' ? 'night' : undefined))).toBe(true);
    expect(detective.condition!((k) => (k === 'world.time' ? 'day' : undefined))).toBe(false);
  });

  it('rejects malformed stamps', () => {
    const errors: string[] = [];
    parseStamp3('bad.yaml', 'id: Bad!\nfootprint: [0, 3]\nheight: 5\nnodes:\n  door: { kind: door, at: [1, 0] }', errors);
    expect(errors.join('\n')).toMatch(/id must match/);
    expect(errors.join('\n')).toMatch(/footprint/);
    expect(errors.join('\n')).toMatch(/door needs returnSpawn/);
  });

  it('resolves every time/weather combination for Kaburo', () => {
    for (const t of TIMES) for (const w of WEATHERS) expect(Object.keys(content.atmosphere.resolve('neon', t, w))).toHaveLength(15);
    expect(content.atmosphere.resolve('neon', 'night', 'clear').neon).toBe('flicker');
    expect(content.atmosphere.resolve('neon', 'day', 'rain').rain).toBeGreaterThan(0);
  });
});
