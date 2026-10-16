import * as THREE from 'three';
import { KIND, lin, MeshBuilder } from '../../real/meshBuilder';
import { BOAT_MODELS } from '../../real/boats';
import { startRoom } from '../shell';

/**
 * Boats (models-boats-ph.html): Manila's bay and Pasig (real/boats.ts): the six bangkas, the passenger launch and the lighterage
 * barge in a row on a patch of water, the container ships and tankers behind them.
 */
startRoom({
  title: 'Boats (Manila)',
  groups: ['Boats'],
  summer: true,
  far: 1200,
  camera: { pos: [20, 9, 46], target: [20, 1.5, 0] },
  shadow: { x: 25, z: 12, half: 45 },
  overview: { at: [20, 1.2, 0], size: 22, view: [0.4, 0.35, 0.8] },
  setup(ctx) {
    const { scene, city, genRoot, genItems, label } = ctx;
  {
    const at = new THREE.Vector3(0, 0, 0);
    const pad = new MeshBuilder();
    pad.kind = KIND.lot;
    pad.color = lin(0x1c3a4a);
    pad.box(at.x + 100, at.z + 120, -0.3, 0.0, 420, 480, KIND.lot);
    scene.add(new THREE.Mesh(pad.build()!, city));
    const row = (ids: readonly string[], x0: number, dx: number, z: number): void => {
      ids.forEach((id, i) => {
        const bm = BOAT_MODELS.find((b) => b.id === id)!;
        const g = bm.build().build()!;
        const mesh = new THREE.Mesh(g, city);
        mesh.position.set(at.x + x0 + i * dx, 0.02, at.z + z);
        genRoot.new.add(mesh);
        label('new', bm.name, mesh.position.x, 6 + bm.len * 0.12, mesh.position.z);
      });
    };
    row(['bangka0', 'bangka1', 'bangka2', 'bangka3', 'bangka4', 'bangka5'], 0, 8, 0);
    row(['ferry'], 0, 0, 24);
    row(['lighter'], 24, 0, 24);
    row(['cargo0', 'cargo1'], 0, 60, 220);
    row(['tanker0', 'tanker1'], 110, 60, 220);
    genItems.new.push(
      { name: 'bangkas (all six)', group: 'Boats', at: new THREE.Vector3(at.x + 20, 1.2, at.z), size: 22, view: new THREE.Vector3(0.4, 0.35, 0.8).normalize() },
      { name: 'bangka (canopy)', group: 'Boats', at: new THREE.Vector3(at.x, 1.2, at.z), size: 10, view: new THREE.Vector3(1, 0.3, 0.6).normalize() },
      { name: 'bangka (sail)', group: 'Boats', at: new THREE.Vector3(at.x + 16, 2, at.z), size: 10, view: new THREE.Vector3(1, 0.3, 0.6).normalize() },
      { name: 'passenger launch', group: 'Boats', at: new THREE.Vector3(at.x, 2, at.z + 24), size: 32, view: new THREE.Vector3(1, 0.35, 0.7).normalize() },
      { name: 'lighterage barge', group: 'Boats', at: new THREE.Vector3(at.x + 24, 1.5, at.z + 24), size: 28, view: new THREE.Vector3(1, 0.35, 0.7).normalize() },
      { name: 'container ships', group: 'Boats', at: new THREE.Vector3(at.x + 20, 12, at.z + 220), size: 190, view: new THREE.Vector3(1, 0.25, 0.9).normalize() },
      { name: 'tankers', group: 'Boats', at: new THREE.Vector3(at.x + 140, 8, at.z + 220), size: 250, view: new THREE.Vector3(1, 0.25, 0.9).normalize() },
    );
  }
  },
});
