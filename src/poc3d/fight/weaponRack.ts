import * as THREE from 'three';
import { buildBat } from '../models/bat';
import { buildKatana } from '../models/katana';

/**
 * The fight room's weapon rack: a black lacquered stand with three pairs of arms, the katana on the top pair, its
 * saya on the next (edge up, as swords are shown, the handles to the left), and the baseball bat on the lowest,
 * its barrel to the right and its maker's mark up. To look at; what's in hand is the keys' (1 to 4).
 */
export function buildWeaponRack(env: THREE.Texture | null): THREE.Group {
  const rack = new THREE.Group();
  rack.name = 'weapon rack';
  const black = new THREE.MeshPhysicalMaterial({ color: 0x080708, roughness: 0.25, clearcoat: 1, envMap: env, envMapIntensity: 0.6 });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), black);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    rack.add(m);
  };
  // A foot, two posts, and arms at three heights, each a little cupped by a lip at its end.
  const ARMS = [0.44, 0.68, 0.88];
  box(1.1, 0.04, 0.3, 0, 0.02, 0);
  for (const x of [-0.3, 0.3]) {
    box(0.05, 0.9, 0.07, x, 0.47, -0.04);
    for (const y of ARMS) {
      box(0.05, 0.03, 0.16, x, y, 0.03);
      box(0.05, 0.035, 0.02, x, y + 0.03, 0.1);
    }
  }
  const k = buildKatana(env);
  // The sword's frame: -z along the blade; turned so the blade runs to +x, edge up.
  k.root.rotation.set(0, -Math.PI / 2, Math.PI);
  k.root.position.set(-0.08, 0, 0.05);
  // (The frame's y is down here: the sword on the top arms, the saya on the middle ones.)
  k.sword.position.y = -(ARMS[2] + 0.032);
  k.saya.position.y = -(ARMS[1] + 0.032);
  rack.add(k.root);
  const bat = buildBat(env);
  // The bat's frame: -z along the barrel; turned so it runs to +x, its mark up and to the front.
  bat.root.rotation.set(0, -Math.PI / 2, 0.6, 'YXZ');
  bat.root.position.set(-0.16, ARMS[0] + 0.043, 0.05);
  rack.add(bat.root);
  return rack;
}
