import * as THREE from 'three';
import { KIND, lin, MeshBuilder } from '../../real/meshBuilder';
import { adMaterial, DistrictAdAtlas } from '../../real/adAtlas';
import { buildMegaSign } from '../../real/megaSign';
import { buildCinema70 } from '../../real/cinema70';
import { buildInn64, buildLiquor64, buildPachinko70 } from '../../real/eraLandmarks';
import type { Building3, Sign3 } from '../../district/plan';
import { era } from '../../district/era';
import { addProps, type Prop } from '../../real/props';
import { loadStatue } from '../../models/statues';
import { loadPayphone, PAYPHONE_KEYS, PayphoneRig, type PayphoneKind } from '../../models/payphone';
import { addSigns, ICON_NAMES, SignAtlas, SignBuilder, signBox, signMaterial } from '../../real/signs';
import { addBuilding, frontFrame } from '../../real/buildings';
import { barberPole, bulbArrow, bulbFrame, crown, cube, hotelBoards, lantern, ledBoard, signKindTexts, standSign, tenantBoard, tubeSign, windowLetters, type Panel } from '../../real/signKinds';
import { BILLBOARDS, DISTRICT_BLANK, districtAdUv, POSTERS } from '../../real/districtAds';
import { startRoom } from '../shell';

/**
 * Buildings and street (models-buildings.html): Kaburo's mega-sign (the corner tower with its screens and the neon dragon) on
 * its plaza, the tanuki statue candidate, the wall of every approved district billboard and poster, and the street and park
 * furniture the district uses (real/dressing.ts) on paving: hedges, lamps, benches, fences, the playground; and the street of
 * proposed signs (real/signKinds.ts), each kind on the building it belongs on.
 */
const GARDEN_X = -8;
/** The furniture's row (along z). */
const FURN_Z = 66;
startRoom({
  title: 'Buildings and street',
  groups: ['Mega-sign', 'Billboards', 'Posters', 'Street & park', 'Signs (proposed)'],
  camera: { pos: [30, 20, 96], target: [30, 6, 24] },
  shadow: { x: 30, z: 40, half: 70 },
  overview: { at: [30, 4, 30], size: 70, view: [0.1, 0.5, 1] },
  setup(ctx) {
    const { cityU, city, genRoot, genItems, label } = ctx;
    ctx.floor((floor) => {
      floor.kind = KIND.lot;
      floor.color = lin(0x5e5e5c);
      floor.box(30, 28, -0.3, -0.05, 140, 124, KIND.lot);
      floor.kind = KIND.plain;
      floor.color = lin(0x8a867e);
      floor.box(GARDEN_X + 44, FURN_Z, -0.2, 0.15, 104, 14, KIND.sidewalk);
    });
    // Kaburo district ads: a wall of every approved billboard (on stands) with the posters below, facing +x.
    {
      const wallX = 4;
      const dAtlas = new DistrictAdAtlas();
      const asb = new SignBuilder();
      const amb = new MeshBuilder();
      const n: [number, number, number] = [1, 0, 0];
      const r: [number, number, number] = [0, 0, -1];
      const place = (list: typeof BILLBOARDS, w: number, h: number, y0: number, z0: number, dz: number, group: string, perTier = 99, tierDy = 0): void => {
        list.forEach(({ a, i }, k) => {
          const z = z0 + (k % perTier) * dz;
          const tier = Math.floor(k / perTier);
          y0 += tier > 0 && k % perTier === 0 ? tierDy : 0;
          const p: [number, number, number] = [wallX, 0, z];
          amb.kind = KIND.plain;
          amb.color = lin(0x2c2e32);
          amb.frameBox(p, r, n, -w / 2 - 0.1, w / 2 + 0.1, y0 - 0.1, y0 + h + 0.1, -0.2, 0);
          amb.frameBox(p, r, n, -0.1, 0.1, 0, y0, -0.2, -0.05);
          asb.sign = [i, 1];
          signBox(asb, p, r, n, -w / 2, w / 2, y0, y0 + h, 0, 0.05, DISTRICT_BLANK, { n: districtAdUv(i) });
          label('new', a.brand, wallX + 0.3, y0 + h + 0.35, z);
          genItems.new.push({ name: `${a.brand}`, group, at: new THREE.Vector3(wallX, y0 + h / 2, z), size: Math.max(w, h) * 0.9, view: new THREE.Vector3(1, 0.1, 0).normalize() });
        });
      };
      // Billboards in tiers of 7 (stacked upward), posters in one long row at eye level.
      place(BILLBOARDS, 6, 3, 3.2, -24, 7.2, 'Billboards', 7, 3.8);
      place(POSTERS, 1.2, 1.8, 0.4, -25, 2.4, 'Posters');
      genRoot.new.add(new THREE.Mesh(asb.build(0, 0)!, adMaterial(cityU, dAtlas)));
      const frames = new THREE.Mesh(amb.build()!, city);
      frames.castShadow = true;
      genRoot.new.add(frames);
      genItems.new.push({ name: 'all district ads', group: 'Billboards', at: new THREE.Vector3(wallX, 3, -2), size: 30, view: new THREE.Vector3(1, 0.2, 0).normalize() });
    }
    // Kaburo mega-sign (the corner tower with its screens and the neon dragon) on its own plaza.
    {
      const at = new THREE.Vector3(62, 0, 18);
      const plaza = new MeshBuilder();
      plaza.kind = KIND.lot;
      plaza.color = lin(0x5e5e5c);
      plaza.box(at.x - 6, at.z + 6, -0.2, 0.01, 56, 56, KIND.lot);
      plaza.kind = KIND.asphalt;
      plaza.box(at.x - 20, at.z + 20, 0.01, 0.03, 16, 16, KIND.asphalt);
      // Scramble-crossing stripes in front of the corner.
      plaza.kind = KIND.paint;
      plaza.color = lin(0xd8d8d0);
      for (let k = -6; k <= 6; k++) {
        plaza.quad([at.x - 27, 0.035, at.z + 17 + k + 0.25], [14, 0, 0], [0, 0, -0.5]);
        plaza.quad([at.x - 17 + k - 0.25, 0.035, at.z + 27], [0.5, 0, 0], [0, 0, -14]);
      }
      const plazaMesh = new THREE.Mesh(plaza.build()!, city);
      plazaMesh.receiveShadow = true;
      genRoot.new.add(plazaMesh);
      // (`?era=1977`: what stood on the corner before it, the 1970s cinema palace: a candidate, real/cinema70.ts.)
      const old = era().id !== '1992';
      const mega = old ? buildCinema70(city) : buildMegaSign(cityU, city);
      mega.group.position.copy(at);
      genRoot.new.add(mega.group);
      const head = mega.headAt.clone().add(at);
      label('new', old ? '歌舞路座 cinema (1970s candidate)' : 'Kaburo mega-sign', at.x - 14, old ? 24 : 38, at.z + 14);
      if (old) {
        genItems.new.push({ name: 'cinema (1970s)', group: 'Mega-sign', at: new THREE.Vector3(at.x - 4, 10, at.z + 4), size: 34, view: new THREE.Vector3(-1, 0.12, 1).normalize() });
        genItems.new.push({ name: 'cinema: billboard', group: 'Mega-sign', at: new THREE.Vector3(at.x, 11, at.z + 10), size: 18, view: new THREE.Vector3(-0.2, 0.05, 1).normalize() });
        genItems.new.push({ name: 'cinema: entrance', group: 'Mega-sign', at: new THREE.Vector3(at.x - 8, 3, at.z + 8), size: 12, view: new THREE.Vector3(-1, 0.15, 1).normalize() });
        // The other plots' predecessors (real/eraLandmarks.ts, candidates) on plots of their own sizes past the floor's far edge,
        // facing south: Yasuichi's pachinko hall (both older years), and in 1964 Hotel Rouge's inn and Yoru Mart's shop.
        const lots: [string, (b: Building3, c: THREE.Material) => { group: THREE.Group }, number, number, number, number][] = [['pachinko hall (1970s)', buildPachinko70, 8, 112, 22, 20]];
        if (era().id === '1964') lots.push(['tsurekomi inn (1964)', buildInn64, 50, 117, 34, 30], ['rice and liquor shop (1964)', buildLiquor64, 88, 110, 10, 12]);
        const ground = new MeshBuilder();
        ground.kind = KIND.lot;
        ground.color = lin(0x5e5e5c);
        lots.forEach(([name, build, x, z, w, d], i) => {
          ground.box(x, z + 4, -0.2, 0.01, w + 10, d + 18, KIND.lot);
          const b: Building3 = { id: 99000 + i, x, z, w, d, h: 14, front: 'south' };
          genRoot.new.add(build(b, city).group);
          label('new', name, x, 18, z + d / 2);
          genItems.new.push({ name, group: 'Mega-sign', at: new THREE.Vector3(x, 5, z + d / 2), size: Math.max(w, 16) + 6, view: new THREE.Vector3(-0.35, 0.18, 1).normalize() });
        });
        const groundMesh = new THREE.Mesh(ground.build()!, city);
        groundMesh.receiveShadow = true;
        genRoot.new.add(groundMesh);
      }
      genItems.new.push({ name: 'mega-sign', group: 'Mega-sign', at: new THREE.Vector3(at.x - 4, 28, at.z + 4), size: 48, view: new THREE.Vector3(-1, 0.12, 1).normalize() });
      genItems.new.push({ name: 'screens (close)', group: 'Mega-sign', at: new THREE.Vector3(at.x - 10, 20, at.z + 10), size: 16, view: new THREE.Vector3(-1, 0.05, 1).normalize() });
      genItems.new.push({ name: 'dragon', group: 'Mega-sign', at: new THREE.Vector3(at.x - 4, 40, at.z + 4), size: 40, view: new THREE.Vector3(-1, 0.05, -0.3).normalize() });
      genItems.new.push({ name: 'dragon head', group: 'Mega-sign', at: head, size: 14, view: new THREE.Vector3(-0.35, 0.1, 1).normalize() });
      genItems.new.push({ name: 'from the crossing', group: 'Mega-sign', at: new THREE.Vector3(at.x - 4, 34, at.z + 4), size: 70, view: new THREE.Vector3(-1, -0.62, 1.1).normalize() });
    }
    // A candidate for the mega-sign's roof (the user wants a giant tanuki there in time, and the dragon moved): a
    // statue made from a generated picture (models/statues.ts), stood at a shop front's size, a metre and a half, to be
    // looked over before it's used anywhere.
    {
      const CAST_Z = 52;
      const charEnv = ctx.env();
      const sx = 20;
      const tall = 1.5;
        void loadStatue('tanuki', charEnv)
          .then((statue) => {
            statue.scale.setScalar(tall);
            statue.position.set(sx, 0, CAST_Z);
            genRoot.new.add(statue);
          })
          .catch((e: unknown) => console.warn('statue:', e));
        label('new', 'tanuki (candidate)', sx, tall + 0.25, CAST_Z);
        genItems.new.push({ name: 'tanuki (candidate)', group: 'Mega-sign', at: new THREE.Vector3(sx, tall * 0.5, CAST_Z), size: 2.4, view: new THREE.Vector3(0.3, 0.15, 1).normalize() });
        genItems.new.push({ name: 'tanuki: face', group: 'Mega-sign', at: new THREE.Vector3(sx, tall * 0.72, CAST_Z), size: 0.8, view: new THREE.Vector3(0.15, 0.05, 1).normalize() });
        genItems.new.push({ name: 'tanuki: back', group: 'Mega-sign', at: new THREE.Vector3(sx, tall * 0.5, CAST_Z), size: 2.4, view: new THREE.Vector3(-0.4, 0.2, -1).normalize() });
    }
    // The street and park furniture the district uses (real/dressing.ts) on paving beside them.
    {
    // Furniture, left to right along the paving (facing +z, toward the camera).
    const furn = new MeshBuilder(1 << 15);
    const P = (kind: Prop['kind'], x: number, extra: Partial<Prop> = {}): Prop => ({ kind, x, z: FURN_Z, nx: 0, nz: 1, radius: 0.3, variant: 0, ...extra });
    const sample: [string, Prop][] = [
      ['kerb hedge', P('hedge', GARDEN_X, { half: 2.5 })],
      ['park hedge', P('hedge', GARDEN_X + 6, { half: 2, variant: 1 })],
      ['potted plants', P('pots', GARDEN_X + 10, { half: 1.1, variant: 7 })],
      ['planter', P('planter', GARDEN_X + 14, { size: 2.4, variant: 2 })],
      ['bench', P('bench', GARDEN_X + 18, { half: 0.8 })],
      ['park lamp', P('postlamp', GARDEN_X + 21)],
      ['car park lamp', P('postlamp', GARDEN_X + 23, { variant: 1 })],
      ['playground fence', P('fence', GARDEN_X + 27, { half: 1.8, variant: 1 })],
      ['post & chain', P('fence', GARDEN_X + 32, { half: 1.8, variant: 2 })],
      ['pay machine', P('paymachine', GARDEN_X + 35.5)],
      ['P sign', P('psign', GARDEN_X + 37.5)],
      ['wheel stop', P('wheelstop', GARDEN_X + 39.5, { half: 0.6 })],
      ['swing', P('swing', GARDEN_X + 43, { half: 1.6 })],
      ['slide', P('slide', GARDEN_X + 48, { variant: 1 })],
      ['sandbox', P('sandbox', GARDEN_X + 52, { radius: 1.5 })],
      ['toilet block', P('toilet', GARDEN_X + 58)],
      ['weeds', P('weeds', GARDEN_X + 62, { size: 1.2, variant: 4 })],
      ['for-sale board', P('board', GARDEN_X + 64.5, { half: 0.6 })],
      ['cones', P('cones', GARDEN_X + 67, { variant: 2 })],
    ];
    addProps(furn, { props: sample.map(([, p]) => p), wires: [], lights: [], open: [], solids: [] });
    for (const [name, p] of sample) {
      label('new', name, p.x, 3.2, p.z);
      genItems.new.push({ name, group: 'Street & park', at: new THREE.Vector3(p.x, 1, p.z), size: 4, view: new THREE.Vector3(0.3, 0.3, 1).normalize() });
    }
    const furnMesh = new THREE.Mesh(furn.build()!, city);
    furnMesh.castShadow = furnMesh.receiveShadow = true;
    genRoot.new.add(furnMesh);
    }
    // The proposed sign kinds (real/signKinds.ts), a street of them: eight buildings fronting south across z = 113, each
    // with the kinds that belong on it, the blades and fascias of today's signs (real/signs.ts) among them.
    {
      const Z = 108;
      const D = 10;
      const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
      const FRONT = V(0.15, 0.12, 1).normalize();
      const specs: { name: string; w: number; h: number; word: string; color: number }[] = [
        { name: 'bar building', w: 7, h: 18, word: 'スナック', color: 0xff5fc8 },
        { name: 'izakaya', w: 6.5, h: 7, word: '居酒屋', color: 0xffb040 },
        { name: 'love hotel', w: 10, h: 15, word: 'レジャーホテル', color: 0xff5fc8 },
        { name: 'pachinko', w: 12, h: 12, word: 'パチンコ', color: 0xff4f4f },
        { name: 'tenant offices', w: 8, h: 21, word: 'OFFICE', color: 0xffffff },
        { name: 'electronics (Denkō-chō)', w: 7, h: 27, word: '家電', color: 0x4fe3ff },
        { name: 'kissaten', w: 7, h: 9, word: '喫茶', color: 0xffe45f },
        { name: 'office tower (Asagiri)', w: 16, h: 42, word: 'OFFICE', color: 0xffffff },
        { name: 'barber', w: 5, h: 7, word: '理容', color: 0x4fe3ff },
      ];
      let x = -24;
      const bs: Building3[] = specs.map((sp, i) => {
        const b: Building3 = { id: 310000 + i * 7, x: x + sp.w / 2, z: Z, w: sp.w, d: D, h: sp.h, front: 'south', sign: { text: sp.word, color: sp.color, word: sp.word, name: sp.word } };
        x += sp.w + 0.4;
        return b;
      });
      const [bar, izakaya, hotel, pachinko, offices, denki, kissa, tower, barber] = bs;
      const fr = frontFrame;
      // Today's kinds, through addSigns: a blade on the hotel and the pachinko, fascias.
      const sign = (b: Building3, text: string, color: number, look: Sign3['look'], u: number, vertical = false, top = 0): Sign3 => {
        const f = fr(b);
        const p = { x: f.p[0] + f.r[0] * u + f.n[0] * 0.4, z: f.p[2] + f.r[2] * u + f.n[2] * 0.4 };
        return { text, vertical, color, ...p, y: vertical ? top : 3.6, nx: f.n[0], nz: f.n[2], look, maxW: b.w - 0.8 };
      };
      const plain: Sign3[] = [
        sign(izakaya, '居酒屋', 0xffb040, 'print', izakaya.w / 2),
        sign(hotel, 'ホテル', 0xff5fc8, 'neon', hotel.w - 1.2, true, 12.6),
        sign(pachinko, 'パーラー大吉', 0xff4f4f, 'inverse', pachinko.w / 2),
        sign(pachinko, 'パチンコ', 0xff4f4f, 'neon', 1.2, true, 9.6),
        sign(denki, 'DUTY FREE', 0x4fe3ff, 'channel', denki.w / 2),
        sign(offices, '英会話', 0xffffff, 'lightbox', offices.w / 2),
        sign(barber, '理容 タナカ', 0x4fe3ff, 'lightbox', barber.w / 2),
      ];
      const tenants: Panel[] = [
        { text: 'スナック', color: 0xff5fc8, look: 'neon' },
        { text: 'ラウンジ蘭', color: 0xb48cff, look: 'inverse' },
        { text: '麻雀', color: 0x6bff8a, look: 'lightbox' },
        { text: 'クラブ', color: 0x4fe3ff, look: 'neon' },
        { text: '和子', color: 0xffe45f, look: 'inverse' },
      ];
      const banner: Panel[] = [
        { text: '家電', color: 0x4fe3ff, look: 'inverse' },
        { text: 'パソコン', color: 0xff4f4f, look: 'inverse' },
        { text: 'ゲーム', color: 0xffe45f, look: 'lightbox' },
        { text: '免税', color: 0x6bff8a, look: 'inverse' },
        { text: '買取', color: 0xff9a2a, look: 'inverse' },
      ];
      const windows: [string, number][] = [['英会話スクール', 0xffffff], ['歯科', 0x9ad8ff], ['学習塾', 0xffe45f], ['雀荘', 0xff6a5a], ['司法書士', 0xffffff]];
      const prices = ['休憩 ¥4,500', '宿泊 ¥7,800', 'サービスタイム'];
      const led = '本日新台入替 ★ 朝十時開店 ★ 全台開放中 ★ ';
      const atlas = new SignAtlas([
        ...plain.map((q) => ({ text: q.text, vertical: q.vertical })),
        ...signKindTexts({
          vertical: [...tenants, ...banner].map((q) => q.text).concat(['焼鳥', '酒', 'スナック']),
          horizontal: [...windows.map(([t]) => t), ...prices, '空室', '満室', led, 'OPEN'],
          tube: ['SNACK', 'HOTEL VENUS', '喫茶ルナ'],
          icons: ICON_NAMES,
        }),
      ]);
      const sb = new SignBuilder();
      const mb = new MeshBuilder(1 << 16);
      for (const b of bs) addBuilding(mb, b, true);
      addSigns(plain, [], atlas, sb, mb);
      const item = (name: string, at: THREE.Vector3, size: number, view = FRONT): void => void genItems.new.push({ name, group: 'Signs (proposed)', at, size, view });
      const wx = (b: Building3, u: number): number => b.x - b.w / 2 + u;
      const zf = Z + D / 2;
      // 1. The bar building: a tenant board down the front, the snack's stand sign at its door, its name in tubing.
      tenantBoard(sb, mb, atlas, fr(bar), 1.0, 17, tenants, { id: 1 });
      standSign(sb, mb, atlas, fr(bar), 5.6, 0.9, 'スナック', 0xff5fc8, 'neon', 2);
      tubeSign(sb, mb, atlas, fr(bar), 4.4, 3.3, 'SNACK', 'moon', 0xff5fc8, { iconHex: 0xffe45f, id: 3 });
      item('tenant board (袖看板)', V(wx(bar, 1.6), 10, zf), 15, V(0.8, 0.1, 1).normalize());
      item('stand sign (電飾スタンド)', V(wx(bar, 5.6), 0.8, zf + 0.9), 2.4, V(0.6, 0.15, 1).normalize());
      item('tube lettering + icon', V(wx(bar, 4.4), 3.6, zf), 3.2);
      // 2. The izakaya: red lanterns either side of its door under a painted board.
      lantern(sb, mb, atlas, fr(izakaya), 1.1, 0.45, 2.6, '焼鳥', { id: 4 });
      lantern(sb, mb, atlas, fr(izakaya), izakaya.w - 1.1, 0.45, 2.6, '酒', { id: 5 });
      item('red lanterns (赤ちょうちん)', V(wx(izakaya, izakaya.w / 2), 2.8, zf), 6);
      // 3. The love hotel: its name in tubing in a frame of chasing bulbs, the vacancy lamp and price board by the door, an arrow of bulbs to it.
      const hotelW = tubeSign(sb, mb, atlas, fr(hotel), hotel.w / 2, 4.4, 'HOTEL VENUS', 'heart', 0xff5fc8, { h: 0.7, iconHex: 0xff4f4f, id: 6 });
      bulbFrame(mb, fr(hotel), hotel.w / 2 - hotelW / 2 - 0.25, hotel.w / 2 + hotelW / 2 + 0.25, 4.15, 5.35, { out: 0.1 });
      hotelBoards(sb, mb, atlas, fr(hotel), 1.3, 2.6, prices, { id: 7 });
      bulbArrow(mb, fr(hotel), hotel.w - 0.6, 3.2, 1.8, -1, { color: [1.9, 0.5, 1.2] });
      item('chasing bulbs round a name', V(wx(hotel, hotel.w / 2), 4.8, zf), 7);
      item('vacancy lamp + price board', V(wx(hotel, 1.3), 2.2, zf), 2.6);
      item('arrow of bulbs', V(wx(hotel, hotel.w - 1.5), 3.2, zf), 3.4);
      // 4. The pachinko parlour: an LED board over the doors, bulbs round its fascia.
      ledBoard(sb, mb, atlas, fr(pachinko), pachinko.w / 2, 4.55, led, { w: 8, id: 8 });
      bulbFrame(mb, fr(pachinko), pachinko.w / 2 - 3.1, pachinko.w / 2 + 3.1, 3.15, 4.1, { step: 0.26, out: 0.24 });
      item('LED board (電光掲示板)', V(wx(pachinko, pachinko.w / 2), 4.8, zf), 9);
      // 5. Tenant offices: cut-out letters across the windows, a floor each.
      windows.forEach(([t, c], i) => windowLetters(sb, atlas, fr(offices), offices.w / 2, 4.2 + 3 * i + 0.75, t, c, { maxW: offices.w - 1.2, id: 9 + i }));
      item('window lettering (窓文字)', V(wx(offices, offices.w / 2), 11, zf), 16);
      // 6. Denkō-chō: a banner of the shop's lines flat down the facade.
      tenantBoard(sb, mb, atlas, fr(denki), denki.w - 1.3, 25.5, banner, { flush: true, width: 1.9, id: 20 });
      item('full-height banner (flush)', V(wx(denki, denki.w - 1.3), 14, zf), 26);
      // 7. The kissaten: its name in tubing with a cup, an OPEN cube over the door.
      tubeSign(sb, mb, atlas, fr(kissa), kissa.w / 2, 3.35, '喫茶ルナ', 'coffee', 0xffe45f, { id: 30 });
      cube(sb, mb, atlas, fr(kissa), kissa.w - 1.0, 2.6, 'OPEN', 0x6bff8a, 31);
      item('kissaten: tube + cup, OPEN cube', V(wx(kissa, kissa.w / 2), 3.2, zf), 7);
      // 8. The tower: the company's name at its top. (An invented company: 朝霧生命, Asagiri Life.)
      crown(mb, fr(tower), tower.w / 2, tower.h, '朝霧生命', { maxW: tower.w - 2, id: 32 });
      item('crown letters (company)', V(wx(tower, tower.w / 2), tower.h - 2, zf), 20, V(0.1, -0.2, 1).normalize());
      // Every pictogram, lit in a row on the tower's foot.
      ICON_NAMES.forEach((name, i) => {
        const q = atlas.rect(name, false, 'icon');
        if (!q) return;
        sb.ink = lin([0xff5fc8, 0x4fe3ff, 0xffe45f, 0x6bff8a][i % 4]);
        sb.plate = lin(0x141418);
        sb.sign = [40 + i, 0];
        signBox(sb, fr(tower).p, fr(tower).r, fr(tower).n, 2 + i * 1.5, 3.2 + i * 1.5, 2.4, 3.6, 0.05, 0.1, atlas.blankUv, { n: [q.u0, q.v0, q.u1, q.v1] });
      });
      item('pictograms', V(wx(tower, 7.5), 3, zf), 13);
      // 9. The barber's: the turning pole by its door (a candidate, 2026-10-15).
      barberPole(sb, mb, fr(barber), 0.7, 1.7, 33);
      item('barber pole (サインポール, candidate)', V(wx(barber, 0.7), 2.1, zf + 0.3), 2.6, V(0.5, 0.1, 1).normalize());
      item('the whole street', V(x / 2 - 12, 10, zf), 80, V(0.2, 0.25, 1).normalize());
      label('new', 'proposed signs', -24 + (x + 24) / 2, 30, zf);
      // The pavement and the street in front.
      mb.kind = KIND.sidewalk;
      mb.color = lin(0x8a867e);
      mb.box((x - 24) / 2, zf + 1.75, -0.1, 0.15, x + 24 + 4, 3.5, KIND.sidewalk);
      mb.kind = KIND.asphalt;
      mb.box((x - 24) / 2, zf + 8.5, -0.2, 0.0, x + 24 + 4, 10, KIND.asphalt);
      const mesh = new THREE.Mesh(mb.build()!, city);
      mesh.castShadow = mesh.receiveShadow = true;
      genRoot.new.add(mesh);
      genRoot.new.add(new THREE.Mesh(sb.build(0, 0)!, signMaterial(cityU, atlas)));
    }
    // The Blender-modelled payphones (scripts/blender/payphone.py), with their parts moving: the handset comes off its
    // hooks, the keys go in one after another, the flap and the booth's door swing, then it all goes back. A candidate,
    // for the phone you walk up to; the code-built ones above are the street furniture.
    {
      const env = ctx.env();
      const rigs: { rig: PayphoneRig; at: number; booth: boolean }[] = [];
      const spots: [PayphoneKind, number, string][] = [
        ['payphone', GARDEN_X + 82, 'payphone (Blender): green card phone'],
        ['payphone_booth', GARDEN_X + 86.5, 'payphone (Blender): booth'],
        ['payphone_red', GARDEN_X + 90, 'payphone (Blender): red coin phone'],
        ['payphone_pink', GARDEN_X + 92.5, 'payphone (Blender): pink phone (bars)'],
      ];
      for (const [kind, x, name] of spots) {
        void loadPayphone(kind, env)
          .then((obj) => {
            obj.position.set(x, 0, FURN_Z);
            genRoot.new.add(obj);
            rigs.push({ rig: new PayphoneRig(obj), at: x, booth: kind === 'payphone_booth' });
          })
          .catch((e: unknown) => console.warn('payphone:', e));
        // The same phone as the middle distance draws it (30 m and beyond), a row in front.
        void loadPayphone(kind, env, true)
          .then((obj) => {
            obj.position.set(x, 0, FURN_Z + 4);
            genRoot.new.add(obj);
          })
          .catch((e: unknown) => console.warn('payphone (low):', e));
        label('new', name, x, 3.2, FURN_Z);
        genItems.new.push({ name, group: 'Street & park', at: new THREE.Vector3(x, 1.2, FURN_Z), size: kind === 'payphone' ? 2.4 : 3.2, view: new THREE.Vector3(0.3, 0.2, 1).normalize() });
        genItems.new.push({ name: `${name} (close)`, group: 'Street & park', at: new THREE.Vector3(x, 1.25, FURN_Z + (kind === 'payphone' ? 0 : -0.35)), size: 0.9, view: new THREE.Vector3(0.2, 0.1, 1).normalize() });
      }
      let t = 0;
      const ease = (k: number): number => {
        const x = THREE.MathUtils.clamp(k, 0, 1);
        return x * x * (3 - 2 * x);
      };
      ctx.onFrame((dt) => {
        t += dt;
        const c = t % 9;
        for (const { rig, booth } of rigs) {
          if (booth) rig.setDoor(ease(c / 1) * (1 - ease((c - 8) / 1)));
          rig.setHandset(ease((c - 1) / 1) * (1 - ease((c - 7) / 1)));
          PAYPHONE_KEYS.forEach((key, i) => rig.setKey(key, Math.max(0, 1 - Math.abs(c - (2.2 + i * 0.35)) / 0.18)));
          // (A dial: wound round to the stop and let run back, twice.)
          const wind = (t0: number): number => ease((c - t0) / 0.9) * (1 - ease((c - t0 - 0.9) / 1.1));
          rig.setDial(Math.max(wind(2.2) * 0.7, wind(4.3)));
          rig.setFlap(ease((c - 6.4) / 0.3) * (1 - ease((c - 7) / 0.3)));
        }
      });
    }
  },
});
