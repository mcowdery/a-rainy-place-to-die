import { describe, expect, it } from 'vitest';
import { overlaps, type Rect } from '../src/core/coords';
import { TIMES, WEATHERS } from '../src/atmosphere/rules';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { CELL, planCell3, STYLES3 } from '../src/poc3d/district/plan';
import { DistrictModel } from '../src/poc3d/district/model';
import { parseZones3 } from '../src/poc3d/district/zones';
import { destinations } from '../src/poc3d/district/travel';
import { District } from '../src/poc3d/district/world';
import { localFrame, toWorld } from '../src/poc3d/real/localFrame';
import { DISTRICT_ADS } from '../src/poc3d/models/ads';
import { addDistrictAds, type AdPlacement } from '../src/poc3d/real/districtAds';
import { MeshBuilder } from '../src/poc3d/real/meshBuilder';
import { SignBuilder } from '../src/poc3d/real/signs';
import { parseStamp3, plazaRect, reservedRect } from '../src/poc3d/district/stamps';

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
    const more: string[] = [];
    parseStamp3('bad2.yaml', 'id: ok\nfootprint: [4, 4]\nheight: 5\nlandmark: castle\nplaza: { at: [0, 0] }', more);
    expect(more.join('\n')).toMatch(/landmark must be one of/);
    expect(more.join('\n')).toMatch(/plaza must be/);
  });

  it('places the mega-sign as a landmark on an open crossing', () => {
    const mega = content.placed.find((p) => p.id === 'kaburo_crossing')!;
    expect(mega.stamp.landmark).toBe('mega_sign');
    const model = new DistrictModel(content.macro, 'neon', content.placed, 7);
    const [mx, my] = mega.cell;
    // The tower keeps its footprint for collision but is not built as a plain mass.
    expect(model.buildings(mx, my)).toContain(mega.building);
    expect(model.massed(mx, my)).not.toContain(mega.building);
    // No generated building stands on the plaza, in any cell it reaches.
    const plaza = plazaRect(mega)!;
    for (let y = my - 1; y <= my + 1; y++)
      for (let x = mx - 1; x <= mx + 1; x++) expect(model.plan(x, y)?.buildings.some((b) => overlaps(footprint(b), plaza)) ?? false).toBe(false);
    // The spawn stands on the plaza with a camera view set.
    const view = mega.nodes.find((n) => n.id === 'kaburo_crossing.view')!;
    expect(view.x > plaza.x && view.x < plaza.x + plaza.w && view.z > plaza.y && view.z < plaza.y + plaza.h).toBe(true);
    expect(view.view).not.toBeNull();
  });

  it('resolves every time/weather combination for Kaburo', () => {
    for (const t of TIMES) for (const w of WEATHERS) expect(Object.keys(content.atmosphere.resolve('neon', t, w))).toHaveLength(15);
    expect(content.atmosphere.resolve('neon', 'night', 'clear').neon).toBe('flicker');
    expect(content.atmosphere.resolve('neon', 'day', 'rain').rain).toBeGreaterThan(0);
  });
});

describe('district ads', async () => {
  const { addDistrictAds } = await import('../src/poc3d/real/districtAds');
  const { styleFor, WIN } = await import('../src/poc3d/real/buildings');
  const { MeshBuilder } = await import('../src/poc3d/real/meshBuilder');
  const { SignBuilder } = await import('../src/poc3d/real/signs');
  const { DistrictModel } = await import('../src/poc3d/district/model');
  const model = new DistrictModel(content.macro, 'neon', content.placed, 7);
  const place = (mx: number, my: number) => {
    const out: import('../src/poc3d/real/districtAds').AdPlacement[] = [];
    addDistrictAds(new SignBuilder(), new MeshBuilder(), model.buildings(mx, my), model.plan(mx, my)!.signs, model.detail(mx, my)!.props, out);
    return out;
  };

  it('fits the whole catalogue in the ad atlas', async () => {
    const { BILLBOARDS, POSTERS } = await import('../src/poc3d/real/districtAds');
    expect(BILLBOARDS.length).toBeLessThanOrEqual(36);
    expect(POSTERS.length).toBeLessThanOrEqual(48);
  });

  it('is deterministic and places every kind somewhere', () => {
    const cells = neonCells.slice(0, 20);
    expect(cells.map(([x, y]) => place(x, y))).toEqual(cells.map(([x, y]) => place(x, y)));
    const kinds = new Set(cells.flatMap(([x, y]) => place(x, y).map((p) => p.kind)));
    expect([...kinds].sort()).toEqual(['poster', 'rooftop', 'wall']);
  });

  it('keeps facade billboards off balcony fronts and posters clear of vending machines', () => {
    for (const [mx, my] of neonCells.slice(0, 20)) {
      const buildings = model.buildings(mx, my);
      const vending = model.detail(mx, my)!.props.filter((p) => p.kind === 'vending');
      for (const p of place(mx, my)) {
        if (p.kind === 'poster') expect(vending.every((v) => Math.hypot(v.x - p.x, v.z - p.z) >= 1.3)).toBe(true);
        if (p.kind === 'wall') {
          const b = buildings.find((q) => Math.abs(q.x - p.x) <= q.w / 2 + 0.01 && Math.abs(q.z - p.z) <= q.d / 2 + 0.01)!;
          expect(styleFor(b).type).not.toBe(WIN.balcony);
        }
      }
    }
  });
});

describe('Kaburo zones', () => {
  const model = new DistrictModel(content.macro, 'neon', content.placed, 7, content.zones);
  const inZone = (id: string) => model.cells.filter(([mx, my]) => content.zones.at(mx, my)?.id === id);

  it('gives every Kaburo cell a zone, and Kaburo a real district size', () => {
    expect(model.cells.length).toBeLessThanOrEqual(30);
    for (const [mx, my] of model.cells) expect(content.zones.at(mx, my), `cell ${mx},${my}`).toBeDefined();
    expect(new Set(model.cells.map(([mx, my]) => content.zones.at(mx, my)!.id)).size).toBe(6);
  });

  it('plans the back alleys lower and finer-grained than the crossing', () => {
    const stats = (id: string) => {
      const bs = inZone(id).flatMap(([mx, my]) => model.plan(mx, my)!.buildings);
      return { h: bs.reduce((t, b) => t + b.h, 0) / bs.length, n: bs.length / inZone(id).length };
    };
    const alleys = stats('back_alleys');
    const crossing = stats('crossing');
    expect(alleys.h).toBeLessThan(crossing.h / 2);
    expect(alleys.n).toBeGreaterThan(crossing.n * 1.5);
  });

  it('fills love hotel hill with love hotel and adult ads only', () => {
    const out: AdPlacement[] = [];
    for (const [mx, my] of inZone('hotel_hill')) addDistrictAds(new SignBuilder(), new MeshBuilder(), model.buildings(mx, my), model.plan(mx, my)!.signs, model.detail(mx, my)!.props, out);
    expect(out.length).toBeGreaterThan(20);
    for (const a of out) expect(['lovehotel', 'adult']).toContain(DISTRICT_ADS[a.ad].cat);
  });

  it('rejects malformed zones', () => {
    const errors: string[] = [];
    parseZones3('z.yaml', 'district: neon\norigin: [26, 9]\nmap: [XQ]\nzones:\n  Q: { id: q, name: Q, plan: { lotW: [9, 3], wat: 1 }, ads: { nope: 1 }, look: { windows: { round: 1 } } }', content.macro, errors);
    const all = errors.join('\n');
    for (const m of [/no zone 'X'/, /lotW must be/, /unknown plan key 'wat'/, /unknown ad category 'nope'/, /unknown window type 'round'/]) expect(all).toMatch(m);
  });
});

describe('Places you can walk into, and fast travel', () => {
  const district = new District(content.macro, 'neon', content.placed, 7, content.zones);
  const placed = (id: string) => content.placed.find((p) => p.id === id)!;

  it('lets you walk into Yoru Mart through its doors, but not through the glass or the shelves', () => {
    const f = localFrame(placed('yoru_mart').building);
    const at = (u: number, t: number) => toWorld(f, u, t);
    expect(district.blocked(...at(3, -1.5), 0.3)).toBe(false); // outside the doors
    expect(district.blocked(...at(3, 0.1), 0.3)).toBe(false); // in the doorway
    expect(district.blocked(...at(3.55, 5), 0.3)).toBe(false); // an aisle (a customer browses further in)
    expect(district.blocked(...at(8, 0.1), 0.3)).toBe(true); // the shop window
    expect(district.blocked(...at(4.7, 7), 0.3)).toBe(true); // a gondola
    expect(district.blocked(...at(11, 3.2), 0.3)).toBe(true); // the counter (the staff area behind it is walled off)
  });

  it('lets you walk the shrine path up to the hall', () => {
    const f = localFrame(placed('kaburo_inari').building);
    for (const t of [0.5, 3.7, 8, 12, 15]) expect(district.blocked(...toWorld(f, 5, t), 0.3), `path at ${t}`).toBe(false);
    expect(district.blocked(...toWorld(f, 5, 20), 0.3)).toBe(true);
  });

  it('widens the roads into the scramble crossing', () => {
    const mega = placed('kaburo_crossing');
    const [x, z] = [mega.rect.x + mega.stamp.scramble![0], mega.rect.y + mega.stamp.scramble![1]];
    const roads = district.plan(Math.floor(x / CELL), Math.floor(z / CELL))!.roads.filter((r) => x >= r.rect.x && x <= r.rect.x + r.rect.w && z >= r.rect.y && z <= r.rect.y + r.rect.h);
    expect(roads.length).toBeGreaterThanOrEqual(2);
    for (const r of roads) expect(r.kind).toBe('boulevard');
  });

  it('offers every named spawn and every zone as a free fast-travel spot', () => {
    const dests = destinations(district, district.nodes, content.zones);
    const names = dests.map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(['Kaburo Crossing', 'Bar Kanpai', 'Yoru Mart', 'Yoru Mart (inside)', 'Kaburo Inari Shrine']));
    expect(dests.filter((d) => d.group === 'Zones')).toHaveLength(content.zones.zones.length);
    for (const d of dests) expect(district.blocked(d.x, d.z, 0.3), d.name).toBe(false);
  });
});
