import * as THREE from 'three';
import { KIND, lin, MeshBuilder } from '../../real/meshBuilder';
import { addProps, type Prop } from '../../real/props';
import { addTree, type TreeSpecies } from '../../models/trees';
import { setTreeSet } from '../../district/cityConfig';
import { startRoom } from '../shell';

/**
 * Plants of Manila (models-plants-ph.html): the tropical species (models/trees.ts: coconut and royal palms, banana, rain tree,
 * mango, bougainvillea, banyan (balete), flame tree) in a row on a lawn, and under them the shrubs Manila's hedges, pots and
 * planters are made of (its tree set, district/treeSets.ts). No seasons there: the light is a summer one.
 */
const TREE_NAMES: Record<string, string> = {
  coconut: 'coconut palm', royalPalm: 'royal palm', banana: 'banana', raintree: 'rain tree', mango: 'mango',
  bougainvillea: 'bougainvillea', banyan: 'banyan (balete)', flametree: 'flame tree',
};
const TREES: TreeSpecies[] = ['coconut', 'royalPalm', 'banana', 'raintree', 'mango', 'bougainvillea', 'banyan', 'flametree'];
const X0 = -8;
startRoom({
  title: 'Plants (Manila)',
  groups: ['Trees', 'Shrubs'],
  summer: true,
  camera: { pos: [30, 9, 34], target: [30, 4, 0] },
  shadow: { x: 30, z: 6, half: 60 },
  overview: { at: [30, 4, 0], size: 54, view: [0.1, 0.35, 1] },
  setup(ctx) {
    // Manila's state (as the district page sets it for ?city=manila): its tree set for the hedges.
    setTreeSet('manila');
    const { genRoot, genItems, label, city } = ctx;
    ctx.floor((floor) => {
      floor.kind = KIND.lot;
      floor.color = lin(0x5e5e5c);
      floor.box(30, 0, -0.4, -0.2, 140, 100, KIND.lot);
    });
    const pad = new MeshBuilder();
    pad.kind = KIND.grass;
    pad.color = lin(0x4a6a30);
    pad.box(X0 + 38, 0, -0.2, 0.1, 100, 30, KIND.grass);
    pad.kind = KIND.plain;
    pad.color = lin(0x8a867e);
    pad.box(X0 + 38, 22, -0.2, 0.15, 60, 12, KIND.sidewalk);
    genRoot.new.add(new THREE.Mesh(pad.build()!, city));
    const trees = new MeshBuilder(1 << 16);
    TREES.forEach((sp, i) => {
      const x = X0 + i * 11;
      addTree(trees, { x, z: 0, species: sp, seed: i });
      label('new', TREE_NAMES[sp], x, 11, 0);
      genItems.new.push({ name: TREE_NAMES[sp], group: 'Trees', at: new THREE.Vector3(x, 4.5, 0), size: 11, view: new THREE.Vector3(0.2, 0.25, 1).normalize() });
    });
    genItems.new.push({ name: 'all trees', group: 'Trees', at: new THREE.Vector3(X0 + 38, 4, 0), size: 56, view: new THREE.Vector3(0.1, 0.35, 1).normalize() });
    const treeMesh = new THREE.Mesh(trees.build()!, city);
    treeMesh.castShadow = treeMesh.receiveShadow = true;
    genRoot.new.add(treeMesh);
    // The shrubs of Manila's hedges, pots and planters (the tree set's `shrubs`), along the paving.
    const furn = new MeshBuilder(1 << 15);
    const P = (kind: Prop['kind'], x: number, extra: Partial<Prop> = {}): Prop => ({ kind, x, z: 22, nx: 0, nz: 1, radius: 0.3, variant: 0, ...extra });
    const sample: [string, Prop][] = [
      ['kerb hedge', P('hedge', X0 + 6, { half: 2.5 })],
      ['park hedge', P('hedge', X0 + 14, { half: 2, variant: 1 })],
      ['potted plants', P('pots', X0 + 21, { half: 1.1, variant: 7 })],
      ['planter', P('planter', X0 + 27, { size: 2.4, variant: 2 })],
      ['planter (large)', P('planter', X0 + 34, { size: 3, variant: 5 })],
      ['weeds', P('weeds', X0 + 41, { size: 1.2, variant: 4 })],
    ];
    addProps(furn, { props: sample.map(([, p]) => p), wires: [], lights: [], open: [], solids: [] });
    for (const [name, p] of sample) {
      label('new', name, p.x, 3.2, p.z);
      genItems.new.push({ name, group: 'Shrubs', at: new THREE.Vector3(p.x, 1, p.z), size: 4, view: new THREE.Vector3(0.3, 0.3, 1).normalize() });
    }
    const furnMesh = new THREE.Mesh(furn.build()!, city);
    furnMesh.castShadow = furnMesh.receiveShadow = true;
    genRoot.new.add(furnMesh);
  },
});
