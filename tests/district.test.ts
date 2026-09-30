import { describe, expect, it } from 'vitest';
import { overlaps, pad, type Rect } from '../src/core/coords';
import { TIMES, WEATHERS } from '../src/atmosphere/rules';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { CELL, DISTRICTS3, planCell3, STYLES3 } from '../src/poc3d/district/plan';
import { DistrictModel } from '../src/poc3d/district/model';
import { parseZones3 } from '../src/poc3d/district/zones';
import { destinations } from '../src/poc3d/district/travel';
import * as THREE from 'three';
import { along, carLoops, parseTraffic3, routeFor, Signals, TURN, TURN_R } from '../src/poc3d/district/traffic';
import { TrafficSystem } from '../src/poc3d/real/traffic';
import { District } from '../src/poc3d/district/world';
import { localFrame, toWorld } from '../src/poc3d/real/localFrame';
import { DISTRICT_ADS } from '../src/poc3d/models/ads';
import { addDistrictAds, type AdPlacement } from '../src/poc3d/real/districtAds';
import { MeshBuilder } from '../src/poc3d/real/meshBuilder';
import { tiers } from '../src/poc3d/real/buildings';
import { SignBuilder } from '../src/poc3d/real/signs';
import { INTERIORS, interiorFor } from '../src/poc3d/real/interiors';
import { parseStamp3, plazaRect, reservedRect } from '../src/poc3d/district/stamps';
import { departsAt, lineSchedule, nextDepartures, parseSubway3, subwayRoute, trainAt } from '../src/poc3d/district/subway';

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
    expect(planCell3(content.macro, 5, 10, [], 7)).toBeNull(); // old town: no 3D style yet
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

  it('leaves stamps and their forecourt clear, with the avenues at their full width', () => {
    const model = new DistrictModel(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
    for (const placed of content.placed) {
      const r = reservedRect(placed);
      const p = model.plan(placed.cell[0], placed.cell[1])!;
      expect(p.buildings.some((b) => overlaps(footprint(b), r))).toBe(false);
      // No road under any stamp, in its cell or a neighbour's (an avenue's half reaches 16 m in).
      for (let y = placed.cell[1] - 1; y <= placed.cell[1] + 1; y++)
        for (let x = placed.cell[0] - 1; x <= placed.cell[0] + 1; x++)
          expect(model.plan(x, y)?.roads.some((q) => q.kind !== 'coast' && overlaps(q.rect, placed.rect)) ?? false, `${placed.id} on a road`).toBe(false);
    }
  });

  it('builds the avenues round the expressway: 32 m with a median, broken at junctions', () => {
    const model = new DistrictModel(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
    const p = model.plan(27, 11)!;
    const south = p.roads.find((r) => !r.vertical && r.rect.y + r.rect.h / 2 === 12 * CELL)!;
    expect(south.rect.h).toBe(32);
    expect(south.median).toBeGreaterThan(2);
    expect(p.medians.length).toBeGreaterThan(0);
    // The median stops short of the junctions at the cell's corners.
    for (const m of p.medians) expect(m.x > 27 * CELL + 2 && m.x + m.w < 28 * CELL - 2).toBe(true);
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
    for (const t of TIMES) for (const w of WEATHERS) expect(Object.keys(content.atmosphere.resolve('neon', t, w))).toHaveLength(19);
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

  it('hangs billboards on side walls that face a car park, playground or vacant lot', () => {
    const sides: { p: import('../src/poc3d/real/districtAds').AdPlacement; open: Rect[] }[] = [];
    for (const [mx, my] of neonCells) {
      const plan = model.plan(mx, my)!;
      const out: import('../src/poc3d/real/districtAds').AdPlacement[] = [];
      addDistrictAds(new SignBuilder(), new MeshBuilder(), model.buildings(mx, my), plan.signs, model.detail(mx, my)!.props, out, undefined, plan.open);
      for (const p of out) if (p.kind === 'side') sides.push({ p, open: plan.open.filter((o) => o.kind !== 'plaza' && o.kind !== 'park').map((o) => o.rect) });
    }
    expect(sides.length).toBeGreaterThan(5);
    // Each faces into a lot: a few metres out along its normal is open ground.
    for (const { p, open } of sides) {
      const [x, z] = [p.x + p.nx * 3, p.z + p.nz * 3];
      expect(open.some((r) => x > r.x - 0.5 && x < r.x + r.w + 0.5 && z > r.y - 0.5 && z < r.y + r.h + 0.5)).toBe(true);
    }
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
    expect(new Set(model.cells.map(([mx, my]) => content.zones.at(mx, my)!.id)).size).toBe(7);
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

  it('fills the Love District with love hotel and adult ads only', () => {
    const out: AdPlacement[] = [];
    for (const [mx, my] of inZone('love_district')) addDistrictAds(new SignBuilder(), new MeshBuilder(), model.buildings(mx, my), model.plan(mx, my)!.signs, model.detail(mx, my)!.props, out);
    expect(out.length).toBeGreaterThan(20);
    for (const a of out) expect(['lovehotel', 'adult']).toContain(DISTRICT_ADS[a.ad].cat);
  });

  it('rejects malformed zones', () => {
    const errors: string[] = [];
    parseZones3('z.yaml', 'district: neon\norigin: [26, 9]\nmap: [XQ]\nzones:\n  Q: { id: q, name: Q, plan: { lotW: [9, 3], wat: 1, open: { garden: 0.1, parking: 2 }, pots: 3 }, ads: { nope: 1 }, look: { windows: { round: 1 } } }', content.macro, errors);
    const all = errors.join('\n');
    for (const m of [/no zone 'X'/, /lotW must be/, /unknown plan key 'wat'/, /unknown ad category 'nope'/, /unknown window type 'round'/, /unknown open-lot kind 'garden'/, /open.parking must be a share/, /pots must be between 0 and 1/]) expect(all).toMatch(m);
  });
});

describe('Open ground and greenery', () => {
  const model = new DistrictModel(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
  const inZone = (id: string) => model.cells.filter(([mx, my]) => content.zones.at(mx, my)?.id === id);
  const area = (rs: readonly Rect[]) => rs.reduce((t, r) => t + r.w * r.h, 0);

  it('leaves open lots, plazas and parks clear of buildings and streets, inside their cell', () => {
    for (const [mx, my] of model.cells) {
      const p = model.plan(mx, my)!;
      const cell: Rect = { x: mx * CELL, y: my * CELL, w: CELL, h: CELL };
      const streets = p.roads.filter((r) => r.kind !== 'alley').map((r) => r.rect);
      for (const o of p.open) {
        const r = o.rect;
        expect(r.x >= cell.x - 0.01 && r.y >= cell.y - 0.01 && r.x + r.w <= cell.x + CELL + 0.01 && r.y + r.h <= cell.y + CELL + 0.01, `${o.kind} in ${mx},${my}`).toBe(true);
        expect(streets.some((s) => overlaps(s, pad(r, -0.01))), `${o.kind} on a street in ${mx},${my}`).toBe(false);
        // Only a plaza has buildings standing in it (its towers).
        if (o.kind !== 'plaza') expect(p.buildings.some((b) => overlaps(footprint(b), r)), `${o.kind} built on in ${mx},${my}`).toBe(false);
      }
    }
  });

  it('opens gaps in the back alleys, and never two open lots side by side', () => {
    const cells = inZone('back_alleys');
    const open = cells.flatMap(([mx, my]) => model.plan(mx, my)!.open);
    expect(area(open.map((o) => o.rect)) / (cells.length * CELL * CELL)).toBeGreaterThan(0.05);
    for (const kind of ['parking', 'vacant'] as const) expect(open.some((o) => o.kind === kind), kind).toBe(true);
    for (const [mx, my] of cells) {
      const lots = model.plan(mx, my)!.open;
      lots.forEach((a, i) => lots.slice(i + 1).forEach((b) => expect(Math.abs(a.rect.y - b.rect.y) < 0.01 && Math.abs(a.rect.x + a.rect.w - b.rect.x) < 0.01).toBe(false)));
    }
  });

  it('stands Asagiri towers in plazas, well under half the ground built on', () => {
    const cells = inZone('skyscraper_row');
    const built = area(cells.flatMap(([mx, my]) => model.plan(mx, my)!.buildings.map(footprint)));
    const plazas = cells.flatMap(([mx, my]) => model.plan(mx, my)!.open.filter((o) => o.kind === 'plaza'));
    expect(built / (cells.length * CELL * CELL)).toBeLessThan(0.45);
    // Most cells have one (the avenues round the expressway loop take some of the ground: the blocks along
    // Yasuhara-dōri, the loop's south side, hold one big tower plaza each rather than several).
    expect(plazas.length).toBeGreaterThanOrEqual(cells.length * 0.6);
    for (const [mx, my] of cells) {
      const p = model.plan(mx, my)!;
      for (const b of p.buildings) {
        const plaza = p.open.find((o) => o.kind === 'plaza' && overlaps(o.rect, footprint(b)));
        if (plaza) expect(area([footprint(b)])).toBeLessThan(plaza.rect.w * plaza.rect.h * 0.9);
      }
    }
  });

  it('gives Asagiri a central park and Kaburo a park, with trees and paths', () => {
    // (Central Park is bounded by avenues on the expressway loop, as the real one is, so less of its cells is park.)
    for (const [id, share] of [['central_park', 0.6], ['kaburo_park', 0.35]] as const) {
      const cells = inZone(id);
      expect(cells.length).toBeGreaterThan(0);
      const parks = cells.flatMap(([mx, my]) => model.plan(mx, my)!.open.filter((o) => o.kind === 'park'));
      expect(area(parks.map((o) => o.rect)) / (cells.length * CELL * CELL), id).toBeGreaterThan(share);
      const trees = cells.flatMap(([mx, my]) => model.detail(mx, my)!.props.filter((q) => q.kind === 'tree'));
      expect(trees.length / cells.length).toBeGreaterThan(40);
    }
  });

  it('plants street trees and hedges on pavements, clear of blade signs', () => {
    const cells = inZone('crossing');
    const props = cells.flatMap(([mx, my]) => model.detail(mx, my)!.props);
    expect(props.filter((q) => q.kind === 'tree').length / cells.length).toBeGreaterThan(8);
    expect(props.some((q) => q.kind === 'hedge')).toBe(true);
    for (const [mx, my] of cells) {
      const blades = model.plan(mx, my)!.signs.filter((s) => s.vertical);
      for (const t of model.detail(mx, my)!.props.filter((q) => q.kind === 'tree' && q.grate !== false)) {
        expect(blades.some((s) => Math.hypot(s.x - t.x, s.z - t.z) < 3.2)).toBe(false);
      }
    }
  });

  it('cuts some corners and steps some mid-rises back, keeping blade signs on the facade', () => {
    const bs = model.cells.flatMap(([mx, my]) => model.plan(mx, my)!.buildings);
    const cut = bs.filter((b) => b.cut);
    expect(cut.length).toBeGreaterThan(50);
    expect(cut.length).toBeLessThan(bs.length * 0.35);
    expect(bs.filter((b) => b.h <= 45 && tiers(b).length > 1).length).toBeGreaterThan(50);
    for (const b of bs.filter((q) => q.h <= 45)) {
      const ts = tiers(b);
      // A step-back starts at 15 m or higher, above the blade signs (their tops are at 13 m or lower).
      if (ts.length > 1) expect(ts[1][2]).toBeGreaterThanOrEqual(15);
    }
  });
});

describe('Places you can walk into, and fast travel', () => {
  const district = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
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
    // The path runs up the middle of the precinct (u = 12); the grove either side is walled off from the street.
    for (const t of [0.5, 3.7, 8, 12, 15]) expect(district.blocked(...toWorld(f, 12, t), 0.3), `path at ${t}`).toBe(false);
    expect(district.blocked(...toWorld(f, 12, 20), 0.3)).toBe(true);
    expect(district.blocked(...toWorld(f, 3, 0.1), 0.3)).toBe(true);
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
    // Spots inside an interior are clear once you're inside it.
    const inner = content.placed.filter((p) => interiorFor(p)).map((p) => ({ id: p.id, l: interiorFor(p)!.layout(p.building) }));
    for (const d of dests) {
      const it = inner.find((i) => i.l.contains(d.x, d.z, d.floor + 1.7));
      if (it) district.setInterior(it.id, it.l);
      expect(district.blocked(d.x, d.z, 0.3, district.floorAt(d.x, d.z, d.floor)), d.name).toBe(false);
      if (it) district.setInterior(it.id, null);
    }
  });
});

describe('Live house 地下室', () => {
  const district = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
  const f = localFrame(content.placed.find((p) => p.id === 'live_house')!.building);
  const at = (u: number, t: number) => toWorld(f, u, t);

  it('takes you down the stairs into the basement', () => {
    expect(district.floorAt(...at(1.7, -1))).toBe(0);
    expect(district.floorAt(...at(1.7, 3.25))).toBeCloseTo(-2.25, 1);
    expect(district.floorAt(...at(5, 12))).toBe(-4.5);
    // Walking the stairwell's centre line never hits anything, at whatever level you're on.
    for (let t = -1; t < 11; t += 0.25) {
      const [x, z] = at(t < 6.5 ? 1.7 : 2.7, t);
      expect(district.blocked(x, z, 0.4, district.floorAt(x, z)), `t ${t}`).toBe(false);
    }
  });

  it('keeps the building solid at street level and the basement walled in below', () => {
    expect(district.blocked(...at(6, 12), 0.4, 0)).toBe(true);
    expect(district.blocked(...at(5, 12), 0.4, -4.5)).toBe(false);
    expect(district.blocked(...at(5, 19), 0.4, -4.5)).toBe(true); // the stage
    expect(district.blocked(...at(10.2, 12), 0.4, -4.5)).toBe(true); // the side wall
  });

  it('cuts the stairwell out of the pavement', () => {
    const [x, z] = at(1.7, 3);
    const model = new DistrictModel(content.macro, 'neon', content.placed, 7, content.zones);
    expect(model.holes(Math.floor(x / CELL), Math.floor(z / CELL)).some((r) => x > r.x && x < r.x + r.w && z > r.y && z < r.y + r.h)).toBe(true);
  });
});

describe('Hoshikuzu Yokocho', () => {
  const district = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
  const f = localFrame(content.placed.find((p) => p.id === 'yokocho')!.building);
  const at = (u: number, t: number) => toWorld(f, u, t);

  it('lets you walk both alleys and the cross alley, but not into the bars', () => {
    // Down the middle of each alley, skipping the spots where the regulars stand.
    for (let t = -1; t < 28; t += 0.5) {
      if (t < 8.4 || t > 10.3) expect(district.blocked(...at(5, t), 0.3), `west alley ${t}`).toBe(false);
      if (Math.abs(t - 6) > 0.6 && Math.abs(t - 21.5) > 0.6) expect(district.blocked(...at(15, t), 0.3), `east alley ${t}`).toBe(false);
    }
    for (let u = 6.5; u < 14; u += 0.5) if (u < 9.5 || u > 11.5) expect(district.blocked(...at(u, 15), 0.3), `cross ${u}`).toBe(false);
    expect(district.blocked(...at(2, 10), 0.3)).toBe(true);
    expect(district.blocked(...at(8, 5), 0.3)).toBe(true);
  });
});

describe('Asagiri set pieces and traffic', () => {
  const district = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
  const plan = (mx: number, my: number) => district.plan(mx, my);

  it('keeps every traffic lane clear of buildings, props and stops', { timeout: 30000 }, () => {
    for (const loop of [...carLoops(content.macro, content.traffic, plan).map((c) => [c.rect, true] as const), ...content.traffic.buses.map((b) => [b.rect, false] as const)]) {
      const route = routeFor(loop[0], loop[1], plan, content.rails.flatMap((l) => l.segments));
      for (let s = 0; s < route.length; s += 2) {
        const p = along(route, s);
        expect(district.blocked(p.x, p.z, 0.8), `${loop[0].join(',')} at ${s}`).toBe(false);
      }
    }
  });

  it('rejects traffic loops off the generated districts (across the river, not built yet)', () => {
    const errors: string[] = [];
    parseTraffic3('t.yaml', 'cars:\n  - { rect: [34, 10, 39, 12] }', content.macro, errors);
    expect(errors.join('\n')).toMatch(/generated cells on both sides/);
  });

  it('takes the city hall elevator up to a walkable observatory', () => {
    const hall = content.placed.find((p) => p.id === 'city_hall')!;
    const deck = hall.nodes.find((n) => n.id === 'city_hall.observatory')!;
    const lift = hall.nodes.find((n) => n.id === 'city_hall.elevator')!;
    expect(lift.kind).toBe('station');
    expect(lift.returnSpawn).toBe('city_hall.observatory');
    expect(district.floorAt(deck.x, deck.z, deck.floor)).toBe(172);
    expect(district.floorAt(deck.x, deck.z, 0)).toBe(0);
    expect(district.blocked(deck.x, deck.z, 0.4, 172)).toBe(false);
  });

  it('gives the story locations their doors and people', () => {
    const ids = content.placed.flatMap((p) => p.nodes.map((n) => `${n.id}:${n.kind}`));
    for (const want of ['stella_production.lobby:door', 'stella_production.staff_door:door', 'police_hq.entrance:door', 'police_hq.officer:npc', 'the_peak.penthouse:station', 'the_peak.concierge:npc', 'the_peak.ceo:npc']) {
      expect(ids).toContain(want);
    }
  });
});

describe('Traffic signals and junctions', () => {
  const district = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
  const plan = (mx: number, my: number) => district.plan(mx, my);

  it('never shows green (or amber) to both roads at once, and clears with all-red', () => {
    const sig = new Signals(new Set(['30,12']));
    for (const [gx, gy] of [[27, 11], [30, 12], [22, 10]]) {
      let allRed = 0;
      for (let t = 0; t < 200; t += 0.25) {
        const ns = sig.state(gx, gy, true, t);
        const ew = sig.state(gx, gy, false, t);
        expect(ns !== 'red' && ew !== 'red', `${gx},${gy} at ${t}`).toBe(false);
        if (ns === 'red' && ew === 'red') allRed++;
      }
      expect(allRed).toBeGreaterThan(0);
    }
    // The scramble crossing has a longer cycle (the pedestrian phase).
    expect(sig.cycle(30, 12)).toBeGreaterThan(sig.cycle(27, 11));
  });

  it('puts a junction with a stop line before it at every grid corner along each loop', () => {
    for (const loop of carLoops(content.macro, content.traffic, plan)) {
      const route = routeFor(loop.rect, true, plan, []);
      const [c0, r0, c1, r1] = loop.rect;
      expect(route.junctions).toHaveLength(2 * (c1 - c0) + 2 * (r1 - r0));
      expect(route.junctions.filter((j) => j.turn)).toHaveLength(4);
      for (const j of route.junctions) {
        expect(j.stop).toBeLessThan(j.s);
        expect(j.s - j.stop).toBeGreaterThan(j.cross / 2);
        // Stopped at the line, a turning car is still pointing straight: the turn starts after it.
        if (j.turn) expect(along(route, j.stop).k).toBe(0);
      }
    }
  });

  it('drives round the corners on a smooth path, moving the way it faces (no sliding)', { timeout: 30000 }, () => {
    for (const [rect, cw] of [...carLoops(content.macro, content.traffic, plan).map((c) => [c.rect, true] as const), ...content.traffic.buses.map((b) => [b.rect, false] as const)]) {
      const route = routeFor(rect, cw, plan, []);
      const ds = 0.25;
      let prev = along(route, 0);
      for (let s = ds; s <= route.length + ds / 2; s += ds) {
        const p = along(route, s);
        const mx = (p.x - prev.x) / ds;
        const mz = (p.z - prev.z) / ds;
        // No jumps, and the step is along the heading (a slide would be sideways to it).
        expect(Math.hypot(mx, mz), `${rect} at ${s}`).toBeGreaterThan(0.97);
        expect(Math.hypot(mx, mz)).toBeLessThan(1.03);
        expect(mx * p.dx + mz * p.dz, `${rect} at ${s}`).toBeGreaterThan(0.995);
        // The heading turns no faster than the tightest radius allows.
        const turned = Math.acos(Math.min(1, p.dx * prev.dx + p.dz * prev.dz));
        expect(turned, `${rect} at ${s}`).toBeLessThan(ds / Math.min(TURN_R.left, TURN_R.right) + 0.01);
        prev = p;
      }
    }
  });

  it('winds the steering in: a turn starts and ends straight, and never tighter than its radius', () => {
    expect(TURN.pts[0].k).toBe(0);
    expect(TURN.pts[TURN.pts.length - 1].k).toBeCloseTo(0, 5);
    expect(TURN.pts[TURN.pts.length - 1].th).toBeCloseTo(Math.PI / 2, 2);
    expect(TURN.pts[TURN.pts.length - 1].y).toBeCloseTo(TURN.leg, 2);
    expect(Math.max(...TURN.pts.map((p) => p.k))).toBeLessThanOrEqual(1);
  });

  it('stops short of someone standing in the lane, and sounds the horn', () => {
    const loop = content.traffic.cars[0];
    const route = routeFor(loop.rect, true, plan, []);
    const traffic = new TrafficSystem([{ route, spacing: route.length / 3 }], [], new THREE.MeshBasicMaterial(), new Signals());
    const j = route.junctions[0];
    const p = along(route, j.s + j.cross / 2 + 30);
    const walker = { x: p.x, z: p.z, vx: 0, vz: 0 };
    const cam = new THREE.Vector3(p.x, 1.7, p.z);
    let closest = Infinity;
    let honks = 0;
    for (let t = 0; t < 240; t += 0.05) {
      traffic.update(0.05, cam, [walker]);
      honks += traffic.honks.length;
      traffic.honks.length = 0;
      for (const c of traffic.nearest(cam, 3)) closest = Math.min(closest, Math.hypot(c.x - p.x, c.z - p.z));
    }
    // A car came up, stopped a few metres short (never touching), and waited there with the horn.
    const first = traffic.nearest(cam, 1)[0];
    expect(first.speed).toBeLessThan(0.1);
    expect(Math.hypot(first.x - p.x, first.z - p.z)).toBeLessThan(10);
    expect(closest).toBeGreaterThan(3);
    expect(honks).toBeGreaterThan(0);
  });

  it('keeps traffic far from the camera waiting where it is, and drives it on when you come back', () => {
    const loop = content.traffic.cars[0];
    const route = routeFor(loop.rect, true, plan, []);
    const traffic = new TrafficSystem([{ route, spacing: route.length / 4 }], [], new THREE.MeshBasicMaterial(), new Signals());
    const start = along(route, 0);
    const where = (): number[] => traffic.nearest(new THREE.Vector3(start.x, 0, start.z), 4).map((c) => Math.round(c.x * 10) + Math.round(c.z * 10) * 1e5);
    const before = where();
    const far = new THREE.Vector3(start.x + 5000, 1.7, start.z);
    for (let t = 0; t < 10; t += 0.1) traffic.update(0.1, far);
    expect(where()).toEqual(before);
    const near = new THREE.Vector3(start.x, 1.7, start.z);
    for (let t = 0; t < 10; t += 0.1) traffic.update(0.1, near);
    expect(where()).not.toEqual(before);
  });

  it('drives on past someone waiting on the pavement', () => {
    const loop = content.traffic.cars[0];
    const route = routeFor(loop.rect, true, plan, []);
    const traffic = new TrafficSystem([{ route, spacing: route.length / 3 }], [], new THREE.MeshBasicMaterial(), new Signals());
    const j = route.junctions[0];
    const p = along(route, j.s + j.cross / 2 + 30);
    // Left of the lane (Japan keeps left, the kerb is on the left): 3.2 m over, on the pavement.
    const walker = { x: p.x + p.dz * 3.2, z: p.z - p.dx * 3.2, vx: 0, vz: 0 };
    const cam = new THREE.Vector3(walker.x, 1.7, walker.z);
    let honks = 0;
    let passed = 0;
    for (let t = 0; t < 120; t += 0.05) {
      traffic.update(0.05, cam, [walker]);
      honks += traffic.honks.length;
      traffic.honks.length = 0;
      for (const c of traffic.nearest(cam, 3)) if (Math.hypot(c.x - p.x, c.z - p.z) < 2 && c.speed > 4) passed++;
    }
    expect(honks).toBe(0);
    expect(passed).toBeGreaterThan(0);
  });
});

describe('Subway', () => {
  const net = content.subway;
  const district = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
  const placed = (id: string) => content.placed.find((p) => p.id === id)!;

  it('numbers the stations along two straight lines under the roads', () => {
    expect(net.lines.map((l) => l.id)).toEqual(['toto', 'kawabata', 'monorail', 'yako', 'wakaba', 'seiko']);
    const codes = (id: string) => net.lines.find((l) => l.id === id)!.stops.map((s) => s.code);
    expect(codes('seiko')).toEqual(['S01', 'S02', 'S03', 'S04', 'S05', 'S06']);
    expect(codes('yako')).toEqual(['Y01', 'Y02', 'Y03', 'Y04', 'Y05']);
    expect(codes('wakaba')).toEqual(['W01', 'W02', 'W03']);
    // (The elevated lines, the monorail with its corners, are tests/rail.test.ts.)
    for (const l of net.lines.filter((q) => q.id !== 'monorail')) {
      // Each line runs along a cell edge (a road), its platforms on it.
      expect(l.at % CELL).toBe(0);
      for (const s of l.stops) expect(l.along === 'x' ? s.z : s.x).toBeCloseTo(l.at, 3);
    }
  });

  it('finds routes, changing lines where they meet', () => {
    expect(subwayRoute(net, 'y02_station', 'y05_station')).toEqual([{ kind: 'ride', line: 'yako', from: 1, to: 4 }]);
    expect(subwayRoute(net, 'y01_station', 'w03_station')).toEqual([
      { kind: 'ride', line: 'yako', from: 0, to: 3 },
      { kind: 'transfer', from: 'y04_station', to: 'w02_station' },
      { kind: 'ride', line: 'wakaba', from: 1, to: 2 },
    ]);
    expect(subwayRoute(net, 'y03_station', 'y03_station')).toBeNull();
    // The Toto Line joins at the terminal: from the Wakaba Line to Asagiri on the Toto Line.
    expect(subwayRoute(net, 'w03_station', 'asagiri_station')).toEqual([
      { kind: 'ride', line: 'wakaba', from: 2, to: 1 },
      { kind: 'transfer', from: 'w02_station', to: 'y04_station' },
      { kind: 'ride', line: 'yako', from: 3, to: 2 },
      { kind: 'transfer', from: 'y03_station', to: 'totochuo_station' },
      { kind: 'ride', line: 'toto', from: 2, to: 1 },
    ]);
    // Up the Toto Line to its new northern end, Gakuenzaka (the university).
    expect(subwayRoute(net, 'totochuo_station', 'gakuenzaka_station')).toEqual([{ kind: 'ride', line: 'toto', from: 2, to: 0 }]);
  });

  it('walks the underground mall from Kaburo-nishiguchi to the west exit and up to the rotary', () => {
    const y03 = localFrame(placed('y03_station').building);
    const rot = localFrame(placed('west_exit').building);
    // From the concourse (unpaid side) west through the opening, along the mall, up the far stairs.
    const pts: [number, number][] = [
      toWorld(y03, 20, 0), toWorld(y03, 29, 0), toWorld(rot, -20, 0), toWorld(rot, 40, 0), toWorld(rot, 77, 0), toWorld(rot, 77, 4), toWorld(rot, 77, 13.4), toWorld(rot, 77, 15),
    ];
    let floor = -5;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.1);
      for (let k = 1; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n;
        const z = z0 + ((z1 - z0) * k) / n;
        floor = district.floorAt(x, z, floor);
        expect(district.blocked(x, z, 0.4, floor), `at ${x.toFixed(1)}, ${z.toFixed(1)} floor ${floor.toFixed(2)}`).toBe(false);
      }
    }
    expect(floor).toBe(0);
    // The mall is walled: its north side is shops, not a way through.
    const [wx, wz] = toWorld(rot, 40, -3.6);
    expect(district.blocked(wx, wz, 0.4, -5)).toBe(true);
  });

  it('rejects stations off the line, unknown ones and bad transfers', () => {
    const errors: string[] = [];
    parseSubway3('s.yaml', 'lines:\n  - { id: a, name: A, nameEn: A, letter: A, color: "#ff0000", stations: [y01_station, w01_station, nope] }\ntransfers:\n  - [y01_station, y01_station]', content.placed, errors);
    const all = errors.join('\n');
    for (const m of [/no placement 'nope'/, /is not a station on a line|same line/]) expect(all).toMatch(m);
    const e2: string[] = [];
    parseSubway3('s.yaml', 'lines:\n  - { id: a, name: A, nameEn: A, letter: A, color: "#ff0000", stations: [y01_station, w01_station] }', content.placed, e2);
    expect(e2.join('\n')).toMatch(/is not on the line/);
  });

  it('runs a timetable: trains leave every station within a cycle, both ways', () => {
    for (const l of net.lines) {
      for (const dir of [1, -1] as const) {
        const { legs, period } = lineSchedule(l, dir);
        expect(period).toBeGreaterThan(60);
        for (const s of l.stops) {
          const d = nextDepartures(l, s.index, dir, 1234.5);
          expect(d.length).toBe(2);
          expect(d[0]).toBeGreaterThanOrEqual(0);
          expect(d[0]).toBeLessThan(period);
          // A train standing at the stop is at its platform.
          const t = departsAt(legs, s.index)! - 1;
          expect(trainAt(legs, t).stop).toBe(s.index);
          expect(trainAt(legs, t).s).toBeCloseTo(s.s, 3);
        }
      }
    }
  });

  it('walks from the street down the stairs, through the gates, down to the platform', () => {
    for (const id of ['y04_station', 'w02_station']) {
      const f = localFrame(placed(id).building);
      // Street -> into the pavilion -> round to the stairs' head at the back -> down -> a gate lane ->
      // the stairs to the platform -> the platform.
      const path: [number, number][] = [[7, -4], [3, 1], [3, 11], [7, 11], [7, 10], [7, 2], [7, 0], [0.25, -2], [0.25, -6], [7.5, -10], [8.5, -10], [19.8, -10], [23, -10], [24, -12.5]];
      let floor = 0;
      for (let i = 0; i + 1 < path.length; i++) {
        const [u0, t0] = path[i];
        const [u1, t1] = path[i + 1];
        const n = Math.ceil(Math.hypot(u1 - u0, t1 - t0) / 0.1);
        for (let k = 1; k <= n; k++) {
          const [x, z] = toWorld(f, u0 + ((u1 - u0) * k) / n, t0 + ((t1 - t0) * k) / n);
          floor = district.floorAt(x, z, floor);
          expect(district.blocked(x, z, 0.4, floor), `${id} at (${(u0 + ((u1 - u0) * k) / n).toFixed(1)}, ${(t0 + ((t1 - t0) * k) / n).toFixed(1)}) floor ${floor.toFixed(2)}`).toBe(false);
        }
      }
      expect(floor).toBe(-11);
      // And a street walker over the platform stairs stays on the street.
      const [x, z] = toWorld(f, 14, -10);
      expect(district.floorAt(x, z, 0)).toBe(0);
      // You can't walk off the platform onto the tracks.
      const [tx, tz] = toWorld(f, 0, -15.6);
      expect(district.blocked(tx, tz, 0.4, -11) || district.floorAt(tx, tz, -11) !== -11).toBe(true);
    }
  });
});

describe('Sakuragaoka (residential)', () => {
  const model = new DistrictModel(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
  // Sakuragaoka's own cells (its zone file names no area; Kasumi-chō's is another residential area).
  const residential = model.cells.filter(([mx, my]) => content.macro.kindAt(mx, my) === 'residential');
  const cells = residential.filter(([mx, my]) => content.zones.at(mx, my)?.id.startsWith('sakuragaoka'));

  it('is generated only where its zones are painted, west of Asagiri', () => {
    expect(cells.length).toBe(24);
    // Every generated residential cell is painted by some zone file.
    for (const [mx, my] of residential) expect(content.zones.at(mx, my), `${mx},${my}`).toBeDefined();
    for (const [mx, my] of cells) {
      expect(mx >= 14 && mx <= 19 && my >= 9 && my <= 12, `${mx},${my}`).toBe(true);
      expect(content.zones.at(mx, my)).toBeDefined();
    }
  });

  it('is mostly low homes with pitched roofs, bicycles and pots at the doors', async () => {
    const { styleFor } = await import('../src/poc3d/real/buildings');
    const houses = cells.filter(([mx, my]) => content.zones.at(mx, my)!.id === 'sakuragaoka_houses');
    const bs = houses.flatMap(([mx, my]) => model.plan(mx, my)!.buildings);
    const homes = bs.filter((b) => styleFor(b).home);
    expect(homes.length / bs.length).toBeGreaterThan(0.8);
    expect(bs.filter((b) => styleFor(b).roof).length / bs.length).toBeGreaterThan(0.4);
    expect(bs.reduce((t, b) => t + b.h, 0) / bs.length).toBeLessThan(10);
    const props = houses.flatMap(([mx, my]) => model.detail(mx, my)!.props);
    expect(props.filter((p) => p.kind === 'bike').length).toBeGreaterThan(20);
    expect(props.filter((p) => p.kind === 'pots').length).toBeGreaterThan(20);
    // Poles and wires over the narrow lanes.
    expect(props.filter((p) => p.kind === 'pole').length).toBeGreaterThan(20);
  });

  it('is reached from Kaburo through the terminal on the Seikō Line', () => {
    const route = subwayRoute(content.subway, 'y05_station', 's04_station')!;
    expect(route[route.length - 1]).toEqual({ kind: 'ride', line: 'seiko', from: 0, to: 3 });
    expect(route.some((l) => l.kind === 'transfer' && l.to === 's01_station')).toBe(true);
  });
});

describe('Interiors: Sakura-yu, the public bath', () => {
  const district = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
  const bath = content.placed.find((p) => p.id === 'sakura_yu')!;

  it('keeps the bath solid from the street, but for the doorway pocket', async () => {
    const f = localFrame(bath.building);
    expect(district.blocked(...toWorld(f, 8, 5), 0.4)).toBe(true);
    expect(district.blocked(...toWorld(f, 3, 0.9), 0.4)).toBe(true);
    expect(district.blocked(...toWorld(f, 8, 0.3), 0.3)).toBe(false);
  });

  it('lets you walk through it once inside: genkan, lobby, the men’s side, into the bath hall', async () => {
    const { sentoLayout } = await import('../src/poc3d/real/interiors');
    const layout = sentoLayout(bath.building);
    const f = localFrame(bath.building);
    district.setInterior('sakura_yu', layout);
    try {
      const path: [number, number][] = [[8, 2.4], [8, 4.5], [5, 4.5], [3.5, 7], [3.5, 9], [4.5, 12], [4.5, 14], [4.5, 17], [3, 17]];
      for (let i = 0; i + 1 < path.length; i++) {
        const [u0, t0] = path[i];
        const [u1, t1] = path[i + 1];
        const n = Math.ceil(Math.hypot(u1 - u0, t1 - t0) / 0.1);
        for (let k = 1; k <= n; k++) {
          const [x, z] = toWorld(f, u0 + ((u1 - u0) * k) / n, t0 + ((t1 - t0) * k) / n);
          expect(layout.contains(x, z, 1.7)).toBe(true);
          expect(district.blocked(x, z, 0.4), `at ${(u0 + ((u1 - u0) * k) / n).toFixed(1)}, ${(t0 + ((t1 - t0) * k) / n).toFixed(1)}`).toBe(false);
        }
      }
      // Not into the tub, not through to the women's side.
      expect(district.blocked(...toWorld(f, 4, 19.5), 0.4)).toBe(true);
      expect(district.blocked(...toWorld(f, 8.15, 16), 0.4)).toBe(true);
      // Out of the doorway is outside.
      expect(layout.contains(...toWorld(f, 8, 0.5), 1.7)).toBe(false);
    } finally {
      district.setInterior('sakura_yu', null);
    }
    expect(district.blocked(...toWorld(f, 8, 5), 0.4)).toBe(true);
  });
});

describe('Interiors: the Toto department store', () => {
  const district = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
  const store = content.placed.find((p) => p.id === 'totochuo_dept')!;
  const f = localFrame(store.building);
  const layout = INTERIORS.dept_store.layout(store.building);

  /**
   * Walk local waypoints like the controls do: the level follows the floor under you, the interior switches on
   * and off by where the camera is, and nothing may block a step. Returns the level at the end.
   */
  const walk = (path: [number, number][], level: number): number => {
    let inside = layout.contains(...toWorld(f, path[0][0], path[0][1]), level + 1.7);
    district.setInterior('totochuo_dept', inside ? layout : null);
    for (let i = 0; i + 1 < path.length; i++) {
      const [u0, t0] = path[i];
      const [u1, t1] = path[i + 1];
      const n = Math.ceil(Math.hypot(u1 - u0, t1 - t0) / 0.1);
      for (let k = 1; k <= n; k++) {
        const u = u0 + ((u1 - u0) * k) / n;
        const t = t0 + ((t1 - t0) * k) / n;
        const [x, z] = toWorld(f, u, t);
        expect(district.blocked(x, z, 0.4, level), `at ${u.toFixed(1)}, ${t.toFixed(1)} on ${level.toFixed(2)}`).toBe(false);
        level = district.floorAt(x, z, level);
        const now = layout.contains(x, z, level + 1.7);
        if (now !== inside) district.setInterior('totochuo_dept', now ? layout : null);
        inside = now;
      }
    }
    district.setInterior('totochuo_dept', null);
    return level;
  };

  it('lets you walk in from the street and out again', () => {
    expect(walk([[22.5, -3], [22.5, 6], [22.5, 22]], 0)).toBe(0);
    expect(walk([[22.5, 22], [22.5, 3], [22.5, -3]], 0)).toBe(0);
    // Only through the doors: the show windows either side stay solid.
    expect(district.blocked(...toWorld(f, 10, 1.6), 0.4, 0)).toBe(true);
  });

  it('walks the ground floor round the brands to the elevators', () => {
    expect(walk([[22.5, -3], [22.5, 8], [10, 8], [10, 22.5], [30, 22.5], [30, 50], [22.5, 55]], 0)).toBe(0);
  });

  it('rides the escalators: up to 2F, down to the food hall and back up', () => {
    const up = walk([[22.5, -3], [22.5, 23], [16.9, 24.5], [16.9, 38.5], [22.5, 40]], 0);
    expect(up).toBe(6);
    const down = walk([[22.5, -3], [22.5, 36.5], [27.3, 36.2], [27.3, 24.5], [22.5, 22]], 0);
    expect(down).toBe(-5);
    // And the food hall's aisles, then back up the other lane.
    const x = walk([[22.5, 22], [22.5, 4], [7, 4], [7, 48], [22.5, 48], [22.5, 55], [22.5, 24.5], [25.7, 24.5], [25.7, 36.2], [22.5, 37]], -5);
    expect(x).toBe(0);
  });

  it('carries you on the escalators, and keeps you out of the wells', () => {
    const [x, z] = toWorld(f, 16.9, 30);
    const up = layout.carry!(x, z, layout.floorAt(x, z, 2)!);
    expect(up).not.toBeNull();
    // Up the up lane is inward (+t).
    const [ux, uz] = toWorld(f, 16.9, 31);
    expect(up![0] * (ux - x) + up![1] * (uz - z)).toBeGreaterThan(0);
    district.setInterior('totochuo_dept', layout);
    try {
      // From the ground floor into the food hall's well, or from 2F into the escalator's.
      expect(district.blocked(...toWorld(f, 24.5, 30), 0.4, 0)).toBe(true);
      expect(district.blocked(...toWorld(f, 15.7, 30), 0.4, 6)).toBe(true);
      expect(district.blocked(...toWorld(f, 17.7, 30), 0.4, 6)).toBe(true);
    } finally {
      district.setInterior('totochuo_dept', null);
    }
  });

  it('has elevators on every floor to the rooftop garden, fenced in', () => {
    const ids = ['elevator_b1', 'elevator_1f', 'elevator_2f'].map((n) => `totochuo_dept.${n}`);
    for (const id of ids) expect(district.nodes.find((n) => n.id === id)?.returnSpawn).toBe('totochuo_dept.rooftop');
    const roof = district.nodes.find((n) => n.id === 'totochuo_dept.rooftop')!;
    expect(district.floorAt(roof.x, roof.z, roof.floor)).toBeCloseTo(63.2);
    expect(district.blocked(roof.x, roof.z, 0.4, 63.2)).toBe(false);
    expect(district.blocked(...toWorld(f, 22.5, 1.6), 0.4, 63.2)).toBe(true);
    expect(district.blocked(...toWorld(f, 0.5, 30), 0.4, 63.2)).toBe(true);
  });
});

describe('Interiors: the penthouse at The Peak', () => {
  const district = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
  const tower = content.placed.find((p) => p.id === 'the_peak')!;
  const f = localFrame(tower.building);
  const layout = INTERIORS.residence.layout(tower.building);

  /** Walk local waypoints on a level (the interior on while inside), never blocked; returns the end level. */
  const walk = (path: [number, number][], level: number): number => {
    let inside = layout.contains(...toWorld(f, path[0][0], path[0][1]), level + 1.7);
    district.setInterior('the_peak', inside ? layout : null);
    for (let i = 0; i + 1 < path.length; i++) {
      const [u0, t0] = path[i];
      const [u1, t1] = path[i + 1];
      const n = Math.ceil(Math.hypot(u1 - u0, t1 - t0) / 0.1);
      for (let k = 1; k <= n; k++) {
        const u = u0 + ((u1 - u0) * k) / n;
        const t = t0 + ((t1 - t0) * k) / n;
        const [x, z] = toWorld(f, u, t);
        expect(district.blocked(x, z, 0.4, level), `at ${u.toFixed(1)}, ${t.toFixed(1)} on ${level.toFixed(2)}`).toBe(false);
        level = district.floorAt(x, z, level);
        const now = layout.contains(x, z, level + 1.7);
        if (now !== inside) district.setInterior('the_peak', now ? layout : null);
        inside = now;
      }
    }
    district.setInterior('the_peak', null);
    return level;
  };

  it('lets you walk into the lobby, round the desk, to the private elevator', () => {
    expect(walk([[13, 2], [13, 9.3], [16.9, 9.3], [17, 12.5], [14, 13.5], [14, 16.6], [16.5, 16.8]], 0)).toBe(0);
    const lift = district.nodes.find((n) => n.id === 'the_peak.penthouse')!;
    expect(lift.kind).toBe('station');
    expect(lift.returnSpawn).toBe('the_peak.penthouse_hall');
  });

  it('walks the main floor: foyer, living room, dining, kitchen, the study', () => {
    expect(walk([[15.5, 25.9], [15.5, 21.5], [18.5, 21.5], [20.5, 16.7], [25, 16.7], [25, 22], [25, 27], [22.5, 25.6], [21.3, 25.3], [20.6, 25.2], [20.6, 22.5], [18.5, 21.5], [18.5, 20.2], [11.9, 20.2], [11.9, 21.6], [11.3, 23], [11.3, 24.6], [7.5, 24.8]], 130)).toBe(130);
  });

  it('climbs the stair to the master suite and out onto the terrace', () => {
    const top = walk([[15.5, 25.9], [15.5, 21.5], [18.5, 21.5], [20.5, 16.7], [26.95, 16.7], [26.95, 28.5], [24, 28.5], [23, 24], [21.2, 20], [21.2, 18], [12, 17.8], [11, 20], [8.8, 22], [8.8, 27.5]], 130);
    expect(top).toBeCloseTo(136.6);
    // Back down again.
    expect(walk([[21.2, 18], [21.2, 22], [24.5, 25], [25, 28.5], [26.95, 28.5], [26.95, 16.7], [20, 16.7]], 136.6)).toBe(130);
  });

  it('keeps you out of the pool and inside the glass', () => {
    district.setInterior('the_peak', layout);
    try {
      expect(district.blocked(...toWorld(f, 14, 14.5), 0.4, 136.6)).toBe(true);
      expect(district.blocked(...toWorld(f, 6.2, 20), 0.4, 136.6)).toBe(true);
      expect(district.blocked(...toWorld(f, 17, 12.2), 0.4, 130)).toBe(true);
    } finally {
      district.setInterior('the_peak', null);
    }
  });
});

describe('Interiors: Hotel Rouge', () => {
  const district = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
  const hotel = content.placed.find((p) => p.id === 'hotel_rouge')!;
  const f = localFrame(hotel.building);
  const layout = INTERIORS.love_hotel.layout(hotel.building);

  /** Walk local waypoints (the interior on while inside), never blocked; returns the end level. */
  const walk = (path: [number, number][], level: number): number => {
    let inside = layout.contains(...toWorld(f, path[0][0], path[0][1]), level + 1.7);
    district.setInterior('hotel_rouge', inside ? layout : null);
    for (let i = 0; i + 1 < path.length; i++) {
      const [u0, t0] = path[i];
      const [u1, t1] = path[i + 1];
      const n = Math.ceil(Math.hypot(u1 - u0, t1 - t0) / 0.1);
      for (let k = 1; k <= n; k++) {
        const u = u0 + ((u1 - u0) * k) / n;
        const t = t0 + ((t1 - t0) * k) / n;
        const [x, z] = toWorld(f, u, t);
        expect(district.blocked(x, z, 0.4, level), `at ${u.toFixed(1)}, ${t.toFixed(1)} on ${level.toFixed(2)}`).toBe(false);
        level = district.floorAt(x, z, level);
        const now = layout.contains(x, z, level + 1.7);
        if (now !== inside) district.setInterior('hotel_rouge', now ? layout : null);
        inside = now;
      }
    }
    district.setInterior('hotel_rouge', null);
    return level;
  };

  it('lets you walk in past the screen wall, to the room panel and into the back hall', () => {
    expect(walk([[12, -2], [16, -1], [16, 2.6], [12, 2.6], [12, 6.5], [14.5, 8.5], [14.5, 10.6], [14.5, 12], [6, 12], [5, 12.2]], 0)).toBe(0);
  });

  it('climbs the switchback to both floors and into a themed room on each', () => {
    const up2 = walk([[12, 6.5], [14.5, 8.5], [14.5, 10.6], [14.4, 17], [19, 17], [20.1, 17], [20.1, 15.5], [19, 15.55], [15, 15.55], [14.4, 13], [14.4, 11.3], [6.15, 11.3], [6.15, 9.6], [6.15, 7.6]], 0);
    expect(up2).toBe(5);
    const up3 = walk([[6.15, 7.6], [6.15, 11.3], [14.4, 11.3], [14.4, 17], [19, 17], [20.1, 17], [20.1, 15.5], [19, 15.55], [15, 15.55], [14.4, 13], [14.4, 11.3], [11.9, 11.3], [11.9, 7.6]], 5);
    expect(up3).toBe(10);
  });

  it('fences the well on the top floor, and keeps the taken rooms shut', () => {
    district.setInterior('hotel_rouge', layout);
    try {
      expect(district.blocked(...toWorld(f, 16.5, 17), 0.4, 10)).toBe(true);
      expect(district.blocked(...toWorld(f, 17.75, 9.6), 0.4, 10)).toBe(true);
      expect(district.blocked(...toWorld(f, 11.9, 9.6), 0.4, 5)).toBe(true);
    } finally {
      district.setInterior('hotel_rouge', null);
    }
    const suite = district.nodes.find((n) => n.id === 'hotel_rouge.room_303')!;
    expect(suite.through).toBe(false);
    expect(district.nodes.find((n) => n.id === 'hotel_rouge.entrance')!.through).toBe(true);
  });
});

describe('the lightmap window', () => {
  it('holds every loaded chunk: they all lie within half the wrapping window of the camera, clear of the fade', async () => {
    const { UNLOAD_RADIUS, LIGHTMAP_WINDOW } = await import('../src/poc3d/district/world');
    // A chunk is kept while its centre is within UNLOAD_RADIUS; its far corner is half a cell's diagonal on.
    const farthest = UNLOAD_RADIUS + (CELL * Math.SQRT2) / 2;
    const fadeStart = (LIGHTMAP_WINDOW * CELL) / 2 - CELL * 0.6;
    expect(farthest).toBeLessThan(fadeStart);
  });
});
