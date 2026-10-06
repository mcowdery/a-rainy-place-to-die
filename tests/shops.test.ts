import { describe, expect, it } from 'vitest';
import { HOME_FLAG } from '../src/poc3d/real/buildings';
import { DEN_FLAG, VICE_SHIFT } from '../src/poc3d/real/buildings';
import { ROOMS, roomTables } from '../src/poc3d/real/shopAtlas';
import { isBare, OUTFITS, pickOutfit } from '../src/poc3d/district/peopleMix';
import { outfitOf } from '../src/poc3d/real/people';
import { DISTRICT_PEOPLE, CITY_PEOPLE } from '../src/poc3d/district/peopleMix';
import { allScenes, CAST, CATS, catsOf, checkScene, holdAt, holdOf, isAdult, isShopKind, isVice, isWindowScene, MAX_SCENES, maskShare, MIN_PERIOD, periodOf, posesOf, SCENES, SHADY_TRADES, shadyTable, SHOP_KINDS, shopScenes, TEEN_OUTFITS, tweenFig, WHEN, whenOf, whoOf, WINDOW_ATLAS, WINDOW_ROWS, windowGlsl, windowLayout, windowsAt, windowSceneIndex, windowScenes, windowTables, type Fig, type Scene } from '../src/poc3d/real/windowScenes';
import { HUES, hueOfColor, pickTrade, shopFlags, TRADE, TRADE_COUNT, TRADES, tradeOfWord } from '../src/poc3d/real/shops';
import { STYLES3 } from '../src/poc3d/district/plan';

describe('shop trades', () => {
  it('reads a trade from a sign, the particular words before the general', () => {
    expect(tradeOfWord('蕎麦')).toBe(TRADE.noodles);
    expect(tradeOfWord('立ち食いそば')).toBe(TRADE.noodles);
    expect(tradeOfWord('酒店')).toBe(TRADE.grocer);
    expect(tradeOfWord('酒')).toBe(TRADE.izakaya);
    expect(tradeOfWord('レトロゲーム')).toBe(TRADE.hobby);
    expect(tradeOfWord('GAME CENTER')).toBe(TRADE.arcade);
    expect(tradeOfWord('シャンパン')).toBe(TRADE.lounge);
    expect(tradeOfWord('BARBER')).toBe(TRADE.salon);
    expect(tradeOfWord('KSK BANK')).toBe(TRADE.bank);
    expect(tradeOfWord('メイドカフェ')).toBe(TRADE.maid);
    expect(tradeOfWord('ネットカフェ')).toBe(TRADE.books);
    expect(tradeOfWord('ヨルマート')).toBe(TRADE.konbini);
    expect(tradeOfWord('LIVE')).toBeNull();
  });

  it('names a trade for most of the districts\' sign words', () => {
    const words = [...new Set(Object.values(STYLES3).flatMap((s) => s!.signWords))];
    const named = words.filter((w) => tradeOfWord(w) !== null);
    expect(named.length / words.length).toBeGreaterThan(0.75);
  });

  it('keys a sign colour to the nearest hue', () => {
    expect(hueOfColor(0xff5fc8)).toBe(0);
    expect(hueOfColor(0xffffff)).toBe(6);
    expect(hueOfColor(0xff9a2a)).toBe(7);
  });

  it('makes a shop what its sign says, and fits it to the building', () => {
    const site = { id: 7, mood: 0, front: 8, tower: false };
    expect(pickTrade({ ...site, sign: { text: '蕎麦', color: 0xffffff } }).trade).toBe(TRADE.noodles);
    expect(pickTrade({ ...site, sign: { text: '蕎麦', color: 0xffffff } }).hue).toBe(6);
    // A plain HOTEL among love hotels is one.
    const love = { ...site, words: ['休憩', '宿泊', 'HOTEL'], sign: { text: 'HOTEL', color: 0xff5fc8 } };
    expect(pickTrade(love).trade).toBe(TRADE.lovehotel);
    // Narrow fronts never hold a convenience store; tower feet are mostly lobbies.
    let lobbies = 0;
    for (let id = 0; id < 400; id++) {
      const narrow = pickTrade({ id, mood: 1, front: 3.5, tower: false }).trade;
      expect(TRADES[narrow].minFront).toBeLessThanOrEqual(3.5);
      if (pickTrade({ id, mood: 1, front: 20, tower: true }).trade === TRADE.lobby) lobbies++;
    }
    expect(lobbies).toBeGreaterThan(150);
  });

  it('follows the zone: an unsigned shop in the electric town sells electronics or games', () => {
    const words = STYLES3.electric!.signWords;
    const counts = new Map<number, number>();
    for (let id = 0; id < 300; id++) {
      const t = pickTrade({ id, mood: 2, front: 6, tower: false, words }).trade;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const themed = (counts.get(TRADE.electronics) ?? 0) + (counts.get(TRADE.hobby) ?? 0) + (counts.get(TRADE.arcade) ?? 0) + (counts.get(TRADE.maid) ?? 0);
    expect(themed / 300).toBeGreaterThan(0.6);
  });

  it('packs trade and hue above the other flag bits', () => {
    const f = shopFlags(TRADE_COUNT - 1, HUES.length - 1) + 255 + HOME_FLAG;
    expect(Math.floor(f / 512) % 32).toBe(TRADE_COUNT - 1);
    expect(Math.floor(f / 16384) % 8).toBe(HUES.length - 1);
    expect(f).toBeLessThan(2 ** 24);
  });
});

describe('shop rooms', () => {
  it('has a room for every trade, its layers inside it, each layer region once', () => {
    for (let t = 0; t < TRADE_COUNT; t++) {
      const r = ROOMS[t];
      expect(r, `trade ${t}`).toBeDefined();
      expect(r.layers.length).toBeLessThanOrEqual(4);
      expect(new Set(r.layers.map((l) => l.region)).size).toBe(r.layers.length);
      for (const l of r.layers) {
        expect(l.depth).toBeGreaterThan(0);
        // Inside the shortest the room gets (its depth varies by 10% either way).
        expect(l.depth).toBeLessThan(r.depth * 0.9 - 0.1);
      }
    }
  });

  it('gives the shader its layers nearest first', () => {
    const { layers } = roomTables();
    // (The trades' rooms, then the shady rooms'.)
    expect(layers.length).toBe((TRADE_COUNT + SHOP_KINDS.length) * 4);
    for (let t = 0; t < TRADE_COUNT; t++) {
      const used = layers.slice(t * 4, t * 4 + 4).map((l) => l[0]).filter((d) => d < 0);
      expect([...used].sort((a, b) => b - a)).toEqual(used);
    }
  });
});

describe('the rooms behind the windows', () => {
  const figs = (sc: Scene): Fig[] => [...sc.a, ...(sc.b ?? []), ...(sc.deep ?? [])];
  const strict = (sc: Scene): boolean => sc.adult === true || catsOf(sc).some(isVice);
  const scenes = windowScenes('standard', [], []);
  const WINDOWS = SCENES.filter(isWindowScene).length;

  it('passes its own check, every built-in scene, with unique ids', () => {
    const errors: string[] = [];
    for (const sc of SCENES) checkScene(sc, errors);
    expect(errors).toEqual([]);
    expect(new Set(SCENES.map((sc) => sc.id)).size).toBe(SCENES.length);
    expect(scenes).toEqual(SCENES.filter(isWindowScene));
    // Plain data: a scene survives a trip through JSON, as an edition's files are.
    expect(JSON.parse(JSON.stringify(SCENES))).toEqual(SCENES);
    expect(windowSceneIndex('v_den_mahjong', scenes)).toBeGreaterThan(0);
    expect(windowSceneIndex('nothing', scenes)).toBe(-1);
    for (const sc of SCENES) {
      expect(WHEN).toContain(whenOf(sc));
      if (sc.slide) expect(sc.anim, sc.id).toBeDefined();
    }
  });

  it('keeps children and teens out of every adult and vice scene: adults in adult clothes only', () => {
    const vice = SCENES.filter(strict);
    expect(vice.length).toBeGreaterThan(30);
    for (const sc of vice) {
      for (const fg of figs(sc)) {
        const c = whoOf(fg.who);
        expect(c.body, `${sc.id}`).not.toBe('child');
        expect(TEEN_OUTFITS, `${sc.id}`).not.toContain(c.outfit);
        expect(isAdult(fg.who)).toBe(true);
      }
    }
    // The children are a home's; whatever is adult is vice.
    for (const sc of SCENES) if (figs(sc).some((fg) => whoOf(fg.who).body === 'child')) for (const c of catsOf(sc)) expect(['home', 'home_tv'], sc.id).toContain(c);
    for (const sc of SCENES) if (sc.adult) expect(catsOf(sc).every(isVice), sc.id).toBe(true);
  });

  it('refuses a child or a teen in an adult or vice scene from any source, and anything malformed', () => {
    const ok = { id: 'x_test', label: 'a test', cat: 'v_hotel', a: [{ who: 'suit', x: 0, pose: { yaw: 90, aR: [80, 0, 10] } }] };
    const check = (sc: unknown): string[] => {
      const errors: string[] = [];
      expect(checkScene(sc, errors)).toBe(errors.length === 0);
      return errors;
    };
    expect(check(ok)).toEqual([]);
    expect(check({ ...ok, a: [{ who: { body: 'woman', outfit: 'gown', hair: 'long' }, x: 0.3, pose: {} }] })).toEqual([]);
    // The rule: by the cast's name or spelled out, in the first frame, the second or at the back; in a vice room or
    // anywhere once it's marked adult.
    for (const who of ['boy', 'girl', { body: 'child', outfit: 'plain', hair: 'short' }, { body: 'woman', outfit: 'school', hair: 'twin' }, { body: 'man', outfit: 'yankee', hair: 'short' }, { body: 'woman', outfit: 'gym', hair: 'bob' }, { body: 'man', outfit: 'track', hair: 'short' }]) {
      const fg = { who, x: 0.5, pose: {} };
      for (const sc of [{ ...ok, a: [fg] }, { ...ok, a: [...ok.a, fg] }, { ...ok, deep: [fg] }, { ...ok, b: [...ok.a, fg], anim: [2, 0.5] }, { ...ok, cat: 'home', adult: true, a: [fg] }, { ...ok, cat: ['home', 'v_love'], a: [fg] }]) {
        expect(check(sc).join(' '), JSON.stringify(sc)).toMatch(/child's body|teen's outfit/);
      }
    }
    // (In an ordinary home scene a child is fine.)
    expect(check({ ...ok, cat: 'home', a: [{ who: 'boy', x: 0, pose: {} }] })).toEqual([]);
    // Malformed.
    expect(check({ ...ok, extra: 1 }).join()).toMatch(/unknown field/);
    expect(check({ ...ok, cat: 'cellar' }).join()).toMatch(/cat must be/);
    expect(check({ ...ok, a: [] }).join()).toMatch(/one to six figures/);
    expect(check({ ...ok, a: [{ who: 'nobody', x: 0, pose: {} }] }).join()).toMatch(/who is a name/);
    expect(check({ ...ok, a: [{ who: { body: 'robot', outfit: 'suit', hair: 'short' }, x: 0, pose: {} }] }).join()).toMatch(/no body/);
    expect(check({ ...ok, a: [{ who: 'suit', x: 9, pose: {} }] }).join()).toMatch(/x is -2 to 2/);
    expect(check({ ...ok, a: [{ who: 'suit', x: 0, pose: { wings: 3 } }] }).join()).toMatch(/unknown pose part/);
    expect(check({ ...ok, a: [{ who: 'suit', x: 0, pose: {}, hold: [['R', 'bazooka']] }] }).join()).toMatch(/hold is/);
    expect(check({ ...ok, back: [['throne', 0]] }).join()).toMatch(/no item/);
    expect(check({ ...ok, anim: [2, 0.5] }).join()).toMatch(/go together/);
    expect(check({ ...ok, weight: 9 }).join()).toMatch(/weight/);
    expect(check('nonsense').join()).toMatch(/is an object/);
  });

  it("merges an edition's scenes after the built-in ones, leaving out the bad and the overflow", () => {
    const mine = { id: 'x_extra', label: 'an edition scene', cat: 'v_love', adult: true, when: 'lovers', a: [{ who: 'hostess', x: 0, pose: {} }] };
    const bad = { ...mine, id: 'x_bad', a: [{ who: 'girl', x: 0, pose: {} }] };
    const warn = console.warn;
    const said: string[] = [];
    console.warn = (m: string) => void said.push(m);
    try {
      // (A second scene of an id is turned away. An adult one with a built-in scene's id is something else: the
      // edition's own version of that scene, tests/sceneEditor.test.ts.)
      const got = windowScenes('uncensored', [mine, bad, { ...mine, label: 'the same id again' }], []);
      expect(got.length).toBe(WINDOWS + 1);
      expect(got[got.length - 1].id).toBe('x_extra');
      expect(windowSceneIndex('x_extra', got)).toBe(WINDOWS);
      expect(said.join(' ')).toMatch(/x_bad.*child's body/);
      expect(said.join(' ')).toMatch(/id is taken/);
      // No more than there are cells: the rest are dropped, with a warning.
      const many = Array.from({ length: 61 }, (_, k) => ({ ...mine, id: `x_many_${k}` }));
      const fits = windowScenes('uncensored', many, []);
      expect(fits.length).toBeLessThan(WINDOWS + many.length);
      expect(windowLayout(fits).cells).toBe(MAX_SCENES);
      expect(said.join(' ')).toMatch(/no cell left/);
      // The demo has no adult scene, its own or an edition's, and still something for every kind of room.
      const demo = windowScenes('demo', [mine], []);
      expect(demo.some((sc) => sc.adult)).toBe(false);
      expect(demo.length).toBe(SCENES.filter((sc) => !sc.adult && isWindowScene(sc)).length);
      expect(SCENES.some((sc) => sc.adult)).toBe(true);
    } finally {
      console.warn = warn;
    }
    // What the header tells an author is left: the built-in scenes' cells, their frame slots, the room for more.
    const lay = windowLayout(scenes);
    expect(WINDOWS).toBe(84);
    expect(lay.poses.reduce((n, ps) => n + Math.max(0, ps.length - 2), 0)).toBe(26);
    expect(MAX_SCENES - lay.cells).toBe(45);
  });

  it('gives the shader its numbers: a play for each scene, a pick list for each kind of room and glass', () => {
    for (const list of [scenes, windowScenes('demo', [], [])]) {
      const T = windowTables(list);
      expect(T.play.length).toBe(list.length);
      expect(T.ranges.length).toBe(CATS.length * 2);
      CATS.forEach((cat, k) => {
        for (const glass of [0, 1]) {
          const [lo, hi, count] = T.ranges[k * 2 + glass];
          // Something for every kind, behind a sill too.
          expect(count, `${cat} ${glass}`).toBeGreaterThan(0);
          const picks = T.picks.slice(lo + 256 * hi, lo + 256 * hi + count);
          for (const n of picks) {
            expect(catsOf(list[n])).toContain(cat);
            if (glass === 0) expect(list[n].low, list[n].id).not.toBe(true);
          }
          // Every scene of the kind that this glass can show is there, as often as its weight.
          list.forEach((sc, n) => expect(picks.filter((v) => v === n).length, sc.id).toBe(catsOf(sc).includes(cat) && (glass === 1 || !sc.low) ? (sc.weight ?? 1) : 0));
        }
      });
      for (const v of [...T.play.flat(), ...T.more.flat(), ...T.ranges.flat(), ...T.picks]) expect(Number.isInteger(v) && v >= 0 && v <= 255).toBe(true);
      // Each scene's later poses lie in the cells after the scenes', inside the atlas.
      const lay = windowLayout(list);
      expect(lay.cells).toBeLessThanOrEqual(MAX_SCENES);
      list.forEach((sc, n) => {
        const count = lay.poses[n].length;
        expect(Math.floor(T.play[n][3] / 8) + 1, sc.id).toBe(count);
        if (count > 2) {
          expect(T.more[n][0]).toBeGreaterThanOrEqual(list.length);
          expect(T.more[n][0] + Math.floor((T.more[n][1] + count - 3) / 4)).toBeLessThan(lay.cells);
        }
      });
      // (The lists are one row of texels.)
      expect(T.picks.length).toBeLessThanOrEqual(WINDOW_ATLAS.maskW);
    }
    // The atlas: the cells under the numbers under the masks, the same for every edition (so is the shader's GLSL).
    expect(WINDOW_ATLAS.cols * WINDOW_ATLAS.cellW).toBe(WINDOW_ATLAS.maskW);
    expect(WINDOW_ROWS).toBe(WINDOW_ATLAS.dataRows + WINDOW_ATLAS.rows * WINDOW_ATLAS.cellH);
    expect(maskShare()).toBeCloseTo(WINDOW_ATLAS.maskH / (WINDOW_ATLAS.maskH + WINDOW_ROWS));
    expect(windowGlsl()).toContain('windowData');
    // The kinds in the order the shader's literals have them, and the flags it reads.
    expect(CATS).toEqual(['home', 'home_tv', 'office', 'hotel', 'den', 'v_home', 'v_office', 'v_hotel', 'v_love', 'v_den']);
    expect(VICE_SHIFT).toBe(2 ** 17);
    expect(DEN_FLAG).toBe(2 ** 19);
    expect(TRADE.lovehotel).toBe(TRADE.hotel + 1);
  });

  it("takes the repository's overrides: one replaces the built-in scene of its id in place, a bad one is passed over", () => {
    const edited = { ...SCENES[3], label: 'edited by hand' };
    const added = { id: 'x_new_home', label: 'a new one', cat: 'home', a: [{ who: 'man', x: 0, pose: {} }] };
    const bad = { ...SCENES[5], a: [{ who: 'nobody', x: 0, pose: {} }] };
    const warn = console.warn;
    const said: string[] = [];
    console.warn = (m: string) => void said.push(m);
    try {
      const got = allScenes('standard', [], [edited, added, bad]);
      expect(got.length).toBe(SCENES.length + 1);
      expect(got[3].label).toBe('edited by hand');
      expect(got[3].id).toBe(SCENES[3].id);
      expect(got[5]).toBe(SCENES[5]);
      expect(got[got.length - 1].id).toBe('x_new_home');
      expect(said.join(' ')).toMatch(/content\/world3d\/windows.*who is a name/);
      // (The other scenes keep their cells.)
      expect(windowScenes('standard', [], [edited]).map((sc) => sc.id)).toEqual(windowScenes('standard', [], []).map((sc) => sc.id));
    } finally {
      console.warn = warn;
    }
  });

  it('plays every scene there and back through its poses, never faster than a calm room allows', () => {
    const a = { who: 'suit', x: -0.5, pose: { yaw: 90, aR: [0, 0, 10] }, hold: [['R', 'glass', 80]] };
    const b = { who: 'suit', x: 0.5, pose: { yaw: 90, lean: 20, aR: [90, 0, 30] }, hold: [['R', 'glass', 120]] };
    // A scene written the old way (two frames, [period, hold]) still loads, and plays no faster than MIN_PERIOD.
    const old = { id: 'x_old', label: 'two frames', cat: 'v_den', a: [a], b: [b], anim: [0.5, 0.5] } as unknown as Scene;
    expect(checkScene(old, [])).toBe(true);
    expect(posesOf(old).length).toBe(2);
    expect(periodOf(old)).toBe(MIN_PERIOD);
    expect(periodOf({ ...old, slide: 0.7 })).toBeLessThan(MIN_PERIOD);
    // In-betweens: the angles and the place part way, in order; the first and last poses as written.
    const tw = posesOf({ ...old, tween: 2 });
    expect(tw.length).toBe(4);
    expect(tw[0].a[0]).toEqual(a);
    expect(tw[3].a[0]).toEqual(b);
    expect(tw[1].a[0].x).toBeCloseTo(-1 / 6);
    expect(tw[1].a[0].pose.aR![0]).toBeCloseTo(30);
    expect(tw[2].a[0].pose.lean).toBeCloseTo(40 / 3);
    const mid = tweenFig(a as never, b as never, 0.5);
    expect(mid.pose.aR).toEqual([45, 0, 20, 0]);
    expect(mid.hold![0][2]).toBeCloseTo(100);
    // (An angle goes the short way round.)
    expect(tweenFig({ ...a, pose: { yaw: 170 } } as never, { ...b, pose: { yaw: -170 } } as never, 0.5).pose.yaw! % 360).toBeCloseTo(180);
    // More poses: a, b, frames, with in-betweens, ten at most; a still scene has one.
    const long = { ...old, frames: [{ a: [a] }, { a: [b] }], tween: 1 } as unknown as Scene;
    expect(checkScene(long, [])).toBe(true);
    expect(posesOf(long).length).toBe(7);
    expect(posesOf({ ...old, b: undefined, anim: undefined } as unknown as Scene).length).toBe(1);
    const check = (sc: unknown): string => {
      const errors: string[] = [];
      checkScene(sc, errors);
      return errors.join(' ');
    };
    expect(check({ ...long, tween: 3 })).toMatch(/more than 10/);
    expect(check({ ...old, anim: [3, 0.5, 0.3] })).toBe('');
    expect(check({ ...old, anim: [3, 0.5, 9] })).toMatch(/anim is/);
    expect(check({ ...old, b: undefined, frames: [{ a: [b] }] })).toBe('');
    expect(check({ ...old, frames: [{ a: [b], extra: 1 }] })).toMatch(/unknown field/);
    // The rule holds in every pose: a child or a teen in a later frame of a vice scene is refused.
    expect(check({ ...old, frames: [{ a: [{ who: 'girl', x: 0, pose: {} }] }] })).toMatch(/frames\[0\]\.a\[0\]: a child's body/);
    expect(check({ ...old, frames: [{ a: [{ who: { body: 'woman', outfit: 'school', hair: 'twin' }, x: 0, pose: {} }] }] })).toMatch(/teen's outfit/);
    // The built-in scenes that move: none cycles under MIN_PERIOD but the walkers.
    for (const sc of SCENES) if (sc.anim && !sc.slide) expect(periodOf(sc), sc.id).toBeGreaterThanOrEqual(MIN_PERIOD);
  });

  it('has a room for every kind of shady shop, adults only, and none of the adult ones in the demo', () => {
    const rooms = shopScenes('standard', [], []);
    for (const kind of SHOP_KINDS) {
      const sc = rooms[kind];
      expect(sc, kind).toBeDefined();
      // Still rooms: nothing a ground-floor room can't draw.
      expect(sc!.b ?? sc!.anim ?? sc!.slide, kind).toBeUndefined();
      for (const fg of figs(sc!)) expect(isAdult(fg.who), `${kind}: ${JSON.stringify(fg.who)}`).toBe(true);
    }
    // They take no cell of the windows' atlas.
    for (const sc of SCENES) if (catsOf(sc).every(isShopKind)) expect(scenes).not.toContain(sc);
    // The demo: no strip club, no love hotel lobby, nobody nude; the rest stay.
    const demo = shopScenes('demo', [], []);
    expect(demo.g_cabaret).toBeUndefined();
    expect(demo.g_lobby).toBeUndefined();
    expect(demo.g_slumped && demo.g_cards && demo.g_loan && demo.g_hostess).toBeTruthy();
    for (const sc of allScenes('demo', [], [])) for (const fg of figs(sc)) expect(isBare(whoOf(fg.who).outfit), sc.id).toBe(false);
    // An edition's scene of a kind takes the built-in one's place (and can bring the demo nothing adult).
    const mine = { id: 'x_cabaret', label: 'an edition room', cat: 'g_cabaret', adult: true, a: [{ who: 'nude', x: 0, pose: {} }] };
    expect(shopScenes('uncensored', [mine], []).g_cabaret?.id).toBe('x_cabaret');
    expect(shopScenes('demo', [mine], []).g_cabaret).toBeUndefined();
  });

  it('keeps the nude body to a woman or a man in a scene marked adult, and out of every crowd', () => {
    const check = (sc: unknown): string => {
      const errors: string[] = [];
      checkScene(sc, errors);
      return errors.join(' ');
    };
    const sc = { id: 'x_nude', label: 'a test', cat: 'g_cabaret', adult: true, a: [{ who: 'nude', x: 0, pose: {} }] };
    expect(check(sc)).toBe('');
    expect(check({ ...sc, adult: false })).toMatch(/nude outfit/);
    expect(check({ ...sc, adult: undefined, cat: 'v_den' })).toMatch(/nude outfit/);
    // A man's too (the same thing: the bare body, a mannequin's), by name or made up; never an elder's or a child's.
    const bare = (body: string): unknown => ({ ...sc, a: [{ who: { body, outfit: 'nude', hair: 'short' }, x: 0, pose: {} }] });
    expect(check(bare('man'))).toBe('');
    expect(check(bare('woman'))).toBe('');
    expect(check({ ...sc, a: [{ who: 'nude_man', x: 0, pose: {} }] })).toBe('');
    expect(CAST.nude_man).toEqual({ body: 'man', outfit: 'nude', hair: 'short' });
    expect(check(bare('elder'))).toMatch(/nude outfit/);
    expect(check(bare('child'))).toMatch(/child's body/);
    // Nowhere that isn't marked adult, whoever it is and whatever the room, in any pose.
    for (const cat of [...CATS, ...SHOP_KINDS]) for (const who of ['nude', 'nude_man', { body: 'man', outfit: 'nude', hair: 'none' }]) {
      expect(check({ id: 'x_nude', label: 'a test', cat, a: [{ who, x: 0, pose: {} }] }), `${cat}`).toMatch(/nude outfit/);
      expect(check({ id: 'x_nude', label: 'a test', cat, a: [{ who: 'suit', x: 0, pose: {} }], b: [{ who, x: 0, pose: {} }], anim: [4, 0.5] }), `${cat}`).toMatch(/nude outfit/);
    }
    // The mob draws it on those two bodies and on no other (an elder or a child asked for it gets everyday clothes).
    expect(outfitOf({ body: 'man', long: false, outfit: 'nude' })).toBe('nude');
    expect(outfitOf({ body: 'woman', long: false, outfit: 'nude' })).toBe('nude');
    expect(outfitOf({ body: 'elder', long: false, outfit: 'nude' })).toBe('plain');
    expect(outfitOf({ body: 'child', long: false, outfit: 'nude' })).toBe('plain');
    for (const built of SCENES) if (figs(built).some((fg) => isBare(whoOf(fg.who).outfit))) expect(built.adult, built.id).toBe(true);
    // No mix gives it, whatever it says; and no mix says it.
    for (let seed = 0; seed < 200; seed++) expect(pickOutfit({ nude: 50, plain: 1 }, seed, () => true)).toBe('plain');
    for (let seed = 0; seed < 400; seed++) expect(isBare(pickOutfit(Object.fromEntries(OUTFITS.map((o) => [o, 1])), seed, () => true))).toBe(false);
    for (const mix of [CITY_PEOPLE, ...Object.values(DISTRICT_PEOPLE)]) expect(Object.keys(mix).some(isBare)).toBe(false);
    // The demo has nobody nude, man or woman, even handed an edition's scene.
    const edition = { id: 'x_bare', label: 'an edition scene', cat: 'v_love', adult: true, when: 'lovers', a: [{ who: 'nude_man', x: 0, pose: {} }] };
    expect(allScenes('uncensored', [edition], []).some((x) => x.id === 'x_bare')).toBe(true);
    expect(allScenes('demo', [edition], []).some((x) => x.id === 'x_bare')).toBe(false);
  });

  it('lets a held thing be moved, turned and sized, and keeps every hold already written as it was', () => {
    const check = (hold: unknown, adult = false): string => {
      const errors: string[] = [];
      checkScene({ id: 'x_hold', label: 'a test', cat: 'home', ...(adult ? { adult: true } : {}), a: [{ who: 'man', x: 0, pose: {}, hold: [hold] }] }, errors);
      return errors.join(' ');
    };
    // The old forms, and the new numbers after them (null: the angle left to the forearm).
    for (const h of [['R', 'glass'], ['L', 'glass', 90], ['R', 'bottle', null, 0.1, -0.05], ['R', 'bottle', 30, 0, 0, 1.5], ['L', 'cig', null, -0.6, 0.6, 0.4], ['R', 'bat', -100, 0.6, -0.6, 2.5], ['R', 'glass', 90, 0.02]]) expect(check(h), JSON.stringify(h)).toBe('');
    // Out of range, or not a hold.
    for (const h of [['R', 'glass', 90, 0.61], ['R', 'glass', 90, 0, -0.7], ['R', 'glass', 90, 0, 0, 0.39], ['R', 'glass', 90, 0, 0, 2.6], ['R', 'glass', 90, null], ['R', 'glass', 90, 0, 0, null], ['R', 'glass', 90, 0, 0, 1, 1], ['R', 'glass', '90'], ['X', 'glass'], ['R', 'no_such_thing'], ['R', 'glass', 400]]) expect(check(h), JSON.stringify(h)).not.toBe('');
    // What's kept to adult scenes stays so however it's placed.
    expect(check(['R', 'cock', null, 0.1, 0.1, 1.2])).toMatch(/adult scene/);
    expect(check(['R', 'cock', null, 0.1, 0.1, 1.2], true)).toBe('');

    // Read and written back: only the numbers that are set, nothing trailing at its default.
    expect(holdAt(['R', 'glass'])).toEqual({ hand: 'R', prop: 'glass', rot: undefined, dx: 0, dy: 0, scale: 1 });
    expect(holdAt(['L', 'bottle', null, 0.1])).toEqual({ hand: 'L', prop: 'bottle', rot: undefined, dx: 0.1, dy: 0, scale: 1 });
    expect(holdOf({ hand: 'R', prop: 'glass', rot: undefined, dx: 0, dy: 0, scale: 1 })).toEqual(['R', 'glass']);
    expect(holdOf({ hand: 'R', prop: 'glass', rot: 90, dx: 0, dy: 0, scale: 1 })).toEqual(['R', 'glass', 90]);
    expect(holdOf({ hand: 'R', prop: 'glass', rot: undefined, dx: 0.1, dy: 0, scale: 1 })).toEqual(['R', 'glass', null, 0.1]);
    expect(holdOf({ hand: 'R', prop: 'glass', rot: undefined, dx: 0, dy: -0.2, scale: 1 })).toEqual(['R', 'glass', null, 0, -0.2]);
    expect(holdOf({ hand: 'R', prop: 'glass', rot: 45, dx: 0, dy: 0, scale: 1.5 })).toEqual(['R', 'glass', 45, 0, 0, 1.5]);
    expect(JSON.stringify(holdOf({ hand: 'R', prop: 'glass', rot: undefined, dx: -0, dy: 0, scale: 2 }))).toBe('["R","glass",null,0,0,2]');
    // Every hold there is comes back as it was written (so a scene saved untouched is the same bytes).
    const files = import.meta.glob('../adult/content/windows/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
    const fromFiles = Object.values(files).flatMap((raw) => (Array.isArray(raw) ? raw : [raw]) as Scene[]);
    let n = 0;
    for (const sc of [...SCENES, ...fromFiles]) for (const fg of figs(sc)) for (const h of fg.hold ?? []) {
      expect(JSON.stringify(holdOf(holdAt(h))), sc.id).toBe(JSON.stringify(h));
      n++;
    }
    expect(n).toBeGreaterThan(60);

    // Between two poses the new numbers go across with the rest; a hold with nothing set comes through as it was.
    const a: Fig = { who: 'man', x: 0, pose: {}, hold: [['R', 'glass', 90], ['L', 'bottle']] };
    const b: Fig = { who: 'man', x: 0, pose: {}, hold: [['R', 'glass', 130, 0.1, -0.2, 2], ['L', 'bottle']] };
    const near = (h: readonly unknown[] | undefined, want: readonly unknown[]): void => {
      expect(h!.length).toBe(want.length);
      want.forEach((v, i) => (typeof v === 'number' ? expect(h![i] as number).toBeCloseTo(v, 9) : expect(h![i]).toBe(v)));
    };
    near(tweenFig(a, b, 0.25).hold![0], ['R', 'glass', 100, 0.025, -0.05, 1.25]);
    near(tweenFig(a, b, 0.75).hold![0], ['R', 'glass', 120, 0.075, -0.15, 1.75]);
    expect(tweenFig(a, b, 0.25).hold![1]).toEqual(['L', 'bottle']);
    expect(tweenFig(a, a, 0.5).hold).toEqual(a.hold);
    // (An angle left to the forearm in either pose stays the nearer pose's own.)
    near(tweenFig({ ...a, hold: [['R', 'glass']] }, b, 0.25).hold![0], ['R', 'glass', null, 0.025, -0.05, 1.25]);
    near(tweenFig({ ...a, hold: [['R', 'glass']] }, b, 0.75).hold![0], ['R', 'glass', 130, 0.075, -0.15, 1.75]);
    // In-betweens of the built-in scenes hold what their poses hold, in range.
    for (const sc of SCENES) for (const pose of posesOf(sc)) for (const fg of pose.a) for (const h of fg.hold ?? []) {
      const at = holdAt(h);
      expect(Math.abs(at.dx) <= 0.6 && Math.abs(at.dy) <= 0.6 && at.scale >= 0.4 && at.scale <= 2.5, sc.id).toBe(true);
    }
  });

  it('tells the shader which shops can be which shady rooms, only rooms that are painted', () => {
    for (const name of ['standard', 'demo'] as const) {
      const rooms = shopScenes(name, []);
      const T = shadyTable(rooms);
      expect(T.length).toBe(TRADE_COUNT);
      T.forEach(([r, g, b, share], trade) => {
        const row = SHADY_TRADES.find((e) => e[0] === trade);
        if (share === 0) return expect([r, g, b]).toEqual([trade, trade, trade]);
        expect(row, `trade ${trade}`).toBeDefined();
        expect(share).toBeLessThanOrEqual(255);
        for (const n of [r, g, b]) {
          const kind = SHOP_KINDS[n - TRADE_COUNT];
          expect(row![2]).toContain(kind);
          expect(rooms[kind], `${name}: ${kind}`).toBeDefined();
        }
      });
      // Every trade that can be a shady room has one in the standard edition; a love hotel none in the demo.
      for (const [trade] of SHADY_TRADES) expect(T[trade][3] > 0, `${name} ${trade}`).toBe(name === 'standard' || trade !== TRADE.lovehotel);
    }
    // Only the night's trades: no shady room behind a school's shopping street's greengrocer.
    const shadyTrades: number[] = [TRADE.bar, TRADE.snack, TRADE.lounge, TRADE.izakaya, TRADE.mahjong, TRADE.estate, TRADE.lovehotel, TRADE.pachinko];
    expect(SHADY_TRADES.map((e) => e[0]).sort()).toEqual([...shadyTrades].sort());
  });

  it('lights the windows by the hour: homes through the evening, going out after midnight; offices by day', () => {
    const lit = (h: number, o = {}): number[] => windowsAt(h, o).lit;
    // Homes (as a factor on the atmosphere's share): most in the evening, a third of that at midnight, least at 3:30,
    // a few more before dawn.
    expect(lit(21)[1]).toBeGreaterThan(1.7);
    expect(lit(0)[1]).toBeLessThan(lit(21)[1] * 0.4);
    expect(lit(3.5)[1]).toBeLessThan(lit(21)[1] * 0.1);
    expect(lit(6.5)[1]).toBeGreaterThan(lit(3.5)[1] * 2);
    // Never rising between the evening and the small hours: a window's hash against it is its bedtime.
    for (let h = 21; h < 27.5; h += 0.25) expect(lit(h + 0.25)[1]).toBeLessThanOrEqual(lit(h)[1] + 1e-9);
    // Offices: the working day, thinning over the evening; the night's buildings late.
    expect(lit(14)[0]).toBeGreaterThan(lit(21)[0] * 2);
    expect(lit(2)[0]).toBeLessThan(lit(21)[0]);
    expect(lit(1)[3]).toBeGreaterThan(lit(18)[3] * 1.5);
    // Winter, the rainy season and the rain bring people home; summer keeps them up later; a wet day lights offices.
    expect(lit(20, { season: 3 })[1]).toBeGreaterThan(lit(20)[1]);
    expect(lit(20, { tsuyu: true })[1]).toBeGreaterThan(lit(20)[1]);
    expect(lit(20, { wet: 1 })[1]).toBeGreaterThan(lit(20)[1]);
    expect(lit(0.3, { season: 1 })[1]).toBeGreaterThan(lit(0.3)[1]);
    expect(lit(14, { wet: 1 })[0]).toBeGreaterThan(lit(14)[0] * 2);
    expect(windowsAt(20, { wet: 1 }).folk[1]).toBeGreaterThan(windowsAt(20).folk[1]);
  });

  it('keeps the vice for the night, each kind at its own hours, and next to none for breakfast', () => {
    const night = (h: number): number[] => windowsAt(h).night;
    for (const h of [7, 8, 12, 15]) for (const v of night(h).slice(1)) expect(v).toBeLessThan(0.05);
    // The evening's (drinking, gambling) is under way by eight; the late ones wait; lovers come between.
    expect(night(20)[1]).toBeGreaterThan(0.6);
    expect(night(20)[2]).toBeLessThan(0.2);
    expect(night(22)[3]).toBeGreaterThan(night(22)[2]);
    for (const k of [1, 2, 3]) expect(night(1)[k]).toBe(1);
    expect(night(3.5)[2]).toBeGreaterThan(night(3.5)[3]);
    // Midnight is one moment whichever side it's reached from, and everything stays in range.
    for (const key of ['lit', 'folk', 'night'] as const) {
      const a = windowsAt(23.999)[key], b = windowsAt(0)[key];
      a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(0.01));
    }
    for (let h = 0; h < 24; h += 0.25) {
      const w = windowsAt(h, { wet: 1, season: 3 });
      for (const v of [...w.folk, ...w.night]) expect(v >= 0 && v <= 1.8).toBe(true);
      for (const v of w.lit) expect(v > 0 && v < 6).toBe(true);
    }
  });
});
