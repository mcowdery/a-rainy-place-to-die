import { afterEach, describe, expect, it } from 'vitest';
import { CITY_CARS, pickCar } from '../src/poc3d/district/carMix';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { era, eraCar, eraFromUrl, eraGlass, eraHeight, ERAS, eraSign, eraSignWords, eraTrade, setEra } from '../src/poc3d/district/era';
import { FRAME, TRADE, TRADES, tradeOfWord } from '../src/poc3d/real/shops';
import { styleFor, WIN } from '../src/poc3d/real/buildings';
import { DistrictModel } from '../src/poc3d/district/model';
import { DISTRICTS3, type CellPlan3 } from '../src/poc3d/district/plan';

afterEach(() => setEra('1992'));

/** Every planned cell of the two central districts, in the era that is set. */
function plans(): { content: ReturnType<typeof loadDistrictContent>; cells: CellPlan3[] } {
  const content = loadDistrictContent();
  const model = new DistrictModel(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
  const cells: CellPlan3[] = [];
  for (let my = 0; my < content.macro.rows; my++)
    for (let mx = 0; mx < content.macro.cols; mx++) {
      const kind = content.macro.kindAt(mx, my);
      if (kind !== 'neon' && kind !== 'tower') continue;
      const p = model.plan(mx, my);
      if (p) cells.push(p);
    }
  return { content, cells };
}

describe('The city in another year', () => {
  it('is 1992 unless the page says otherwise', () => {
    expect(era().id).toBe('1992');
    expect(eraFromUrl('?era=1977')).toBe('1977');
    expect(eraFromUrl('?era=1964')).toBe('1964');
    expect(eraFromUrl('?era=2077')).toBe('1992');
    expect(eraFromUrl('')).toBe('1992');
  });

  it('changes nothing in 1992: no height is touched, every car is itself, every landmark is built', () => {
    for (const h of [6, 31, 48, 120, 240]) expect(eraHeight(h, 100, 200)).toBe(h);
    for (const t of ['sports', 'minivan', 'roadster', 'taxi'] as const) expect(eraCar(t, 3)).toBe(t);
    for (const w of ['カラオケ館', 'メイド', 'GYM', 'コンビニ']) expect(eraSign(w)).toBe(w);
    expect(eraTrade(TRADE.karaoke)).toBe(TRADE.karaoke);
    const content = loadDistrictContent();
    expect(content.placed.find((p) => p.id === 'kaburo_crossing')?.stamp.landmark).toBe('mega_sign');
  });

  it('keeps the same streets and lots in 1977 and brings the roofline down', () => {
    const now = plans();
    setEra('1977');
    const then = plans();
    expect(then.cells.length).toBe(now.cells.length);
    const e = ERAS['1977'];
    let lots = 0;
    let tall = 0;
    let lower = 0;
    now.cells.forEach((a, i) => {
      const b = then.cells[i];
      // The roads are the same, to the metre.
      expect(b.roads).toEqual(a.roads);
      const before = new Map(a.buildings.map((x) => [`${x.x},${x.z}`, x]));
      for (const x of b.buildings) {
        const was = before.get(`${x.x},${x.z}`);
        // Nothing stands in 1977 that isn't there in 1992, on the same footprint.
        expect(was).toBeDefined();
        expect([x.w, x.d]).toEqual([was!.w, was!.d]);
        expect(x.h).toBeLessThanOrEqual(was!.h);
        if (x.h < was!.h) lower++;
        if (was!.h > e.cap! && x.h > e.cap! && x.h <= e.newCap) tall++;
        lots++;
      }
      // Fewer buildings only where a plaza's tower isn't up yet.
      expect(b.buildings.length).toBeLessThanOrEqual(a.buildings.length);
    });
    expect(lots).toBeGreaterThan(500);
    expect(lower).toBeGreaterThan(50);
    // A few newer buildings stand above the old limit; none of the lots' buildings above the newer one but the towers.
    expect(tall).toBeGreaterThan(0);
    const towersNow = now.cells.flatMap((c) => c.buildings).filter((x) => x.h > 60).length;
    const towersThen = then.cells.flatMap((c) => c.buildings).filter((x) => x.h > 60).length;
    expect(towersThen).toBeLessThan(towersNow * 0.6);
    expect(towersThen).toBeGreaterThan(0);
  });

  it('puts an ordinary building where a landmark is not built yet, and keeps the place to stand', () => {
    setEra('1977');
    const content = loadDistrictContent();
    const crossing = content.placed.find((p) => p.id === 'kaburo_crossing')!;
    expect(crossing.stamp.landmark).toBeNull();
    expect(crossing.building.h).toBeLessThanOrEqual(ERAS['1977'].cap!);
    expect(crossing.nodes.map((n) => n.id)).toContain('kaburo_crossing.view');
    expect(crossing.nodes.every((n) => n.kind === 'spawn')).toBe(true);
    // One that was there already is as it is.
    expect(content.placed.find((p) => p.id === 'hotel_rouge')?.stamp.landmark).toBe('love_hotel');
    setEra('1992');
    const now = loadDistrictContent();
    // The plot is the same: the streets round it don't move between the years.
    expect(crossing.rect).toEqual(now.placed.find((p) => p.id === 'kaburo_crossing')!.rect);
    expect(content.placed.length).toBe(now.placed.length);
  });

  it('has only the shops and signs the year had, each sign where and as it was', () => {
    const now = plans();
    setEra('1977');
    const then = plans();
    const banned = ERAS['1977'].signs.map(([w]) => w);
    let changed = 0;
    now.cells.forEach((a, i) => {
      const b = then.cells[i];
      // Every sign stands where one stands in 1992, the same way up and colour (a vertical one lower on a lower building):
      // only the words differ; a tower not up yet takes its sign with it.
      for (const s of b.signs) {
        const was = a.signs.find((o) => o.x === s.x && o.z === s.z && o.vertical === s.vertical && o.color === s.color);
        expect(was).toBeDefined();
        expect([s.vertical, s.color]).toEqual([was!.vertical, was!.color]);
        for (const w of banned) expect(s.text.toUpperCase()).not.toContain(w);
        if (s.text !== was!.text) changed++;
      }
    });
    expect(changed).toBeGreaterThan(10);
    // A wide sign's word is wide, a narrow one's narrow; the new words are in the atlas's list.
    expect(eraSign('カラオケ館')).toBe('スナック');
    expect(eraSign('KARAOKE')).toBe('BAR');
    expect(eraSignWords(['カラオケ館', 'BANK', 'GYM'])).toEqual(['スナック', 'BANK', 'BILLIARDS']);
    // A karaoke box, a maid café, a konbini, a gym and a figure shop are the year's own.
    for (const t of [TRADE.karaoke, TRADE.maid, TRADE.konbini, TRADE.gym, TRADE.hobby]) expect(eraTrade(t)).not.toBe(t);
    expect(eraTrade(TRADE.izakaya)).toBe(TRADE.izakaya);
    // A sign that names its trade and is of the year keeps it: a cinema (the karaoke trade's room) is a cinema.
    expect(eraTrade(TRADE.karaoke, '映画館')).toBe(TRADE.karaoke);
    expect(eraTrade(TRADE.karaoke, 'LIVE')).toBe(TRADE.snack);
    // The replacements name the trade they stand for where they name one.
    expect(tradeOfWord(eraSign('メイド喫茶'))).toBe(TRADE.cafe);
    expect(tradeOfWord(eraSign('カラオケ'))).toBe(TRADE.snack);
    // No frameless plate glass in 1977; the panes narrower; 1992's glazing as it is.
    expect(eraGlass(TRADES[TRADE.fashion].glass)[1]).toBe(FRAME.metal);
    expect(eraGlass(TRADES[TRADE.izakaya].glass)[1]).toBe(FRAME.wood);
    expect(eraGlass(TRADES[TRADE.konbini].glass)[0]).toBeLessThan(TRADES[TRADE.konbini].glass[0]);
    setEra('1964');
    for (const d of TRADES) expect([FRAME.wood, FRAME.lattice]).toContain(eraGlass(d.glass)[1]);
    setEra('1992');
    for (const d of TRADES) expect(eraGlass(d.glass)).toEqual(d.glass);
    setEra('1964');
    expect(eraTrade(TRADE.arcade)).toBe(TRADE.pachinko);
    expect(eraSign('GAME CENTER')).toBe('PACHINKO');
    // The rooftop words (real/signs.ts ROOF_WORDS) too: none of 1964's has a word the year hadn't.
    for (const w of ['KABURO', 'HOTEL', 'SAUNA', 'CABARET', 'PARADISE', 'NEON', 'CLUB', 'LIVE', '大吉', '夢', '銀河', '酒', 'ゲーム', 'カラオケ', 'ホテル'])
      for (const [bad] of ERAS['1964'].signs) expect(eraSign(w)).not.toContain(bad);
  });

  it('keeps the look of a building the year has lower, with no glass curtain wall under the old limit', () => {
    const now = plans();
    setEra('1977');
    const then = plans();
    const cap = ERAS['1977'].cap!;
    let lowered = 0;
    now.cells.forEach((a, i) => {
      const before = new Map(a.buildings.map((x) => [`${x.x},${x.z}`, x]));
      for (const x of then.cells[i].buildings) {
        const was = before.get(`${x.x},${x.z}`)!;
        // A lower building knows its 1992 height, and its corner is cut as in 1992.
        if (x.h < was.h) {
          lowered++;
          expect(x.was).toBe(was.h);
        } else expect(x.was).toBeUndefined();
        expect(x.cut).toEqual(was.cut);
        const s = styleFor(x);
        if (x.h <= cap) expect(s.type).not.toBe(WIN.curtain);
        // Its walls are its 1992 walls unless it was glass.
        setEra('1992');
        const s0 = styleFor(was);
        setEra('1977');
        if (s0.type !== WIN.curtain) expect(s.type).toBe(s0.type);
      }
    });
    expect(lowered).toBeGreaterThan(50);
  });

  it('has only the cars the year had', () => {
    setEra('1977');
    const cars = ERAS['1977'].cars!;
    const seen = new Set<string>();
    for (let s = 0; s < 400; s++) seen.add(pickCar(CITY_CARS, s).type);
    for (const t of seen) expect(cars).toContain(t);
    expect(seen.size).toBeGreaterThan(3);
    // The ordinary 1970s car is the square saloon, mostly, and the year's own designs are on the street.
    for (const t of ['box70', 'coupe70', 'kei70']) expect(seen).toContain(t);
    // A taxi is still a taxi; nothing ordinary turns into one, or into a lorry.
    expect(eraCar('taxi', 5)).toBe('taxi');
    for (let s = 0; s < 50; s++) expect(['taxi', 'taxi2', 'police', 'van', 'boxtruck', 'keitruck']).not.toContain(eraCar('sports', s));
    // Not one of the 1980s and 1990s designs is left.
    for (const t of ['sedan', 'luxury', 'sports', 'hatch', 'rotary', 'awd', 'roadster', 'minivan', 'taxi2']) expect(seen).not.toContain(t);
  });
});
