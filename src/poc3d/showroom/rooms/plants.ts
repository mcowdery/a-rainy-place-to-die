import * as THREE from 'three';
import { KIND, lin, MeshBuilder } from '../../real/meshBuilder';
import { addProps, type Prop } from '../../real/props';
import { addTree, FOLIAGE_VARIANTS, setFoliageVariant, type TreeSpecies } from '../../models/trees';
import { startRoom } from '../shell';

/**
 * Plants (models-plants.html): Tōto's tree species (models/trees.ts: zelkova, ginkgo, sakura, black pine, camphor, dogwood,
 * azalea, clipped box) on a lawn, the foliage variants side by side (the panel's Foliage seasons turn them all), and, with
 * M, the district's old one street tree. Manila's tropical trees are in models-plants-ph.html.
 */
const TREE_NAMES: Record<string, string> = {
  zelkova: 'zelkova 欅', ginkgo: 'ginkgo 銀杏', ginkgoGold: 'ginkgo (autumn)', sakura: 'sakura 桜', sakuraBloom: 'sakura (in bloom)',
  pine: 'black pine 黒松', camphor: 'camphor 楠', dogwood: 'dogwood 花水木', dogwoodBloom: 'dogwood (in flower)', azalea: 'azalea 躑躅', box: 'clipped box',
};
const TREE_ROWS: [number, TreeSpecies[], number][] = [
  [0, ['zelkova', 'ginkgo', 'ginkgoGold', 'sakura', 'sakuraBloom', 'camphor'], 11],
  [16, ['pine', 'dogwood', 'dogwoodBloom', 'azalea', 'box'], 8],
];
const GARDEN_X = -8;
startRoom({
  title: 'Plants',
  groups: ['Trees', 'Foliage'],
  previous: true,
  season: true,
  camera: { pos: [18, 9, 40], target: [18, 4, 8] },
  shadow: { x: 18, z: 20, half: 70 },
  overview: { at: [18, 4, 8], size: 60, view: [0.1, 0.35, 1] },
  setup(ctx) {
    const { genRoot, genItems, label, city } = ctx;
    ctx.floor((floor) => {
      floor.kind = KIND.lot;
      floor.color = lin(0x5e5e5c);
      floor.box(20, 70, -0.4, -0.2, 160, 220, KIND.lot);
    });
    // Trees (models/trees.ts, under review) on a lawn.
    {
      const pad = new MeshBuilder();
      pad.kind = KIND.grass;
      pad.color = lin(0x3e5a30);
      pad.box(GARDEN_X + 40, 8, -0.2, 0.1, 100, 46, KIND.grass);
      genRoot.new.add(new THREE.Mesh(pad.build()!, city));
      const trees = new MeshBuilder(1 << 16);
      for (const [z, species, dx] of TREE_ROWS) {
        species.forEach((sp, i) => {
          const x = GARDEN_X + i * dx;
          addTree(trees, { x, z, species: sp, seed: i });
          const big = sp !== 'azalea' && sp !== 'box';
          label('new', TREE_NAMES[sp], x, big ? (sp === 'camphor' ? 11.5 : 10) : 1.8, z);
          genItems.new.push({ name: TREE_NAMES[sp], group: 'Trees', at: new THREE.Vector3(x, big ? 4.5 : 0.6, z), size: big ? 11 : 2.5, view: new THREE.Vector3(0.2, 0.25, 1).normalize() });
        });
      }
      genItems.new.push({ name: 'all trees', group: 'Trees', at: new THREE.Vector3(GARDEN_X + 26, 4, 8), size: 60, view: new THREE.Vector3(0.1, 0.35, 1).normalize() });
      const treeMesh = new THREE.Mesh(trees.build()!, city);
      treeMesh.castShadow = treeMesh.receiveShadow = true;
      genRoot.new.add(treeMesh);
    }
    // Foliage variants (models/trees.ts FOLIAGE_VARIANTS), side by side for review: each row the same trees, shrubs and
    // hedges built and shaded one way. The season buttons (the panel's Foliage) turn them all.
    const VARIANT_Z = 60;
    const VARIANT_ROW: [TreeSpecies, number][] = [['zelkova', 0], ['ginkgo', 11], ['sakura', 21], ['camphor', 33], ['pine', 45], ['dogwood', 54]];
    {
      const pad = new MeshBuilder();
      const mb = new MeshBuilder(1 << 17);
      FOLIAGE_VARIANTS.forEach((name, v) => {
        const z = VARIANT_Z + v * 34;
        pad.kind = KIND.grass;
        pad.color = lin(0x3e5a30);
        pad.box(GARDEN_X + 42, z + 4, -0.2, 0.1, 110, 26, KIND.grass);
        pad.kind = KIND.plain;
        pad.color = lin(0x8a867e);
        pad.box(GARDEN_X + 78, z + 4, -0.2, 0.15, 30, 26, KIND.sidewalk);
        setFoliageVariant(v);
        for (const [sp, dx] of VARIANT_ROW) addTree(mb, { x: GARDEN_X + dx, z, species: sp, seed: dx + 1 });
        const P = (kind: Prop['kind'], x: number, dz: number, extra: Partial<Prop> = {}): Prop => ({ kind, x, z: z + dz, nx: 0, nz: 1, radius: 0.3, variant: 0, ...extra });
        addTree(mb, { x: GARDEN_X + 62, z: z + 2, species: 'azalea', seed: 3 });
        addTree(mb, { x: GARDEN_X + 65, z: z + 2, species: 'azalea', seed: 4 });
        addTree(mb, { x: GARDEN_X + 68, z: z + 2, species: 'box', seed: 5 });
        addProps(mb, {
          props: [P('hedge', GARDEN_X + 76, 2, { half: 3 }), P('hedge', GARDEN_X + 76, 7, { half: 3, variant: 1 }), P('pots', GARDEN_X + 83, 2, { half: 1.3, variant: 7 }), P('planter', GARDEN_X + 88, 3, { size: 2.4, variant: 2 })],
          wires: [], lights: [], open: [], solids: [],
        });
        label('new', `${v + 1} · ${name}`, GARDEN_X - 8, 3, z);
        genItems.new.push({ name: `${v + 1} ${name}: trees`, group: 'Foliage', at: new THREE.Vector3(GARDEN_X + 26, 4, z), size: 30, view: new THREE.Vector3(0.1, 0.25, 1).normalize() });
        genItems.new.push({ name: `${v + 1} ${name}: close`, group: 'Foliage', at: new THREE.Vector3(GARDEN_X + 22, 5, z), size: 7, view: new THREE.Vector3(0.3, 0.15, 1).normalize() });
        genItems.new.push({ name: `${v + 1} ${name}: shrubs`, group: 'Foliage', at: new THREE.Vector3(GARDEN_X + 76, 0.8, z + 3), size: 9, view: new THREE.Vector3(0.2, 0.4, 1).normalize() });
      });
      setFoliageVariant(3);
      genRoot.new.add(new THREE.Mesh(pad.build()!, city));
      const m = new THREE.Mesh(mb.build()!, city);
      m.castShadow = m.receiveShadow = true;
      genRoot.new.add(m);
    }
    // ---- Previous generation (for comparison) ----
    // The district's one street tree (real/props.ts), where the new species stand.
    {
      const pad = new MeshBuilder();
      pad.kind = KIND.grass;
      pad.color = lin(0x3e5a30);
      pad.box(GARDEN_X + 30, 8, -0.2, 0.1, 76, 46, KIND.grass);
      genRoot.previous.add(new THREE.Mesh(pad.build()!, city));
      const mb = new MeshBuilder();
      const props: Prop[] = [0, 1, 2, 3].map((i) => ({ kind: 'tree', x: GARDEN_X + i * 11, z: 0, nx: 0, nz: 1, radius: 0.3, variant: i * 3, size: [1, 1.3, 0.8, 1][i], grate: i !== 1 }));
      addProps(mb, { props, wires: [], lights: [], open: [], solids: [] });
      const m = new THREE.Mesh(mb.build()!, city);
      m.castShadow = m.receiveShadow = true;
      genRoot.previous.add(m);
      props.forEach((p, i) => {
        const name = ['street tree', 'park tree (1.3x)', 'narrow-pavement tree (0.8x)', 'street tree (variant)'][i];
        label('previous', name, p.x, 9, p.z);
        genItems.previous.push({ name, group: 'Trees', at: new THREE.Vector3(p.x, 4, p.z), size: 11, view: new THREE.Vector3(0.2, 0.25, 1).normalize() });
      });
    }
  },
});
