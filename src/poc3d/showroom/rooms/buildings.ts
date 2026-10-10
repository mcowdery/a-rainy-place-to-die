import * as THREE from 'three';
import { KIND, lin, MeshBuilder } from '../../real/meshBuilder';
import { adMaterial, DistrictAdAtlas } from '../../real/adAtlas';
import { buildMegaSign } from '../../real/megaSign';
import { addProps, type Prop } from '../../real/props';
import { loadStatue } from '../../models/statues';
import { SignBuilder, signBox } from '../../real/signs';
import { BILLBOARDS, DISTRICT_BLANK, districtAdUv, POSTERS } from '../../real/districtAds';
import { startRoom } from '../shell';

/**
 * Buildings and street (models-buildings.html): Kaburo's mega-sign (the corner tower with its screens and the neon dragon) on
 * its plaza, the tanuki statue candidate, the wall of every approved district billboard and poster, and the street and park
 * furniture the district uses (real/dressing.ts) on paving: hedges, lamps, benches, fences, the playground.
 */
const GARDEN_X = -8;
/** The furniture's row (along z). */
const FURN_Z = 66;
startRoom({
  title: 'Buildings and street',
  groups: ['Mega-sign', 'Billboards', 'Posters', 'Street & park'],
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
      floor.box(GARDEN_X + 30, FURN_Z, -0.2, 0.15, 76, 14, KIND.sidewalk);
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
      const mega = buildMegaSign(cityU, city);
      mega.group.position.copy(at);
      genRoot.new.add(mega.group);
      const head = mega.headAt.clone().add(at);
      label('new', 'Kaburo mega-sign', at.x - 14, 38, at.z + 14);
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
  },
});
