import * as THREE from 'three';
import type { AnimLibrary } from './characterAnims';
import { ClipLayer } from './clipLayer';
import type { ClipTable } from './cover';
import { GunBrain } from './gunmanBrain';
import { buildPistol } from './pistol';
import type { Thug, ThugBrain } from './thug';

/**
 * Makes a `Thug` a gunman (the user, 2026-10-16: enemy gunmen who take cover, shoot and flush you out, as well as the brawlers): the Type 54 in his
 * right hand, and a `GunBrain` (models/gunmanBrain.ts) at the head of him that moves him and says which clips lie over his pose, laid by a
 * `ClipLayer`. Everything else about him is the brawlers': his health, falls, blows from you, gore. The library has to be in.
 */

/** Where the pistol sits in the right hand's bone (its local frame): the barrel along the bone, the grip in the palm. By eye, from the photographs. */
export const PISTOL_IN_HAND = { pos: [0, 0.06, 0.012], rot: [Math.PI / 2, 0, 0] } as const;

export function armGunman(thug: Thug, anims: AnimLibrary, key: string, table: ClipTable, seed: number, env: THREE.Texture | null): GunBrain {
  const layer = new ClipLayer(thug.model, key);
  layer.anims = anims;
  const brain = new GunBrain(table, (c) => layer.lengthOf(c), seed, thug);
  const gun = buildPistol(env);
  const hand = thug.bone('hand_r');
  hand.add(gun.root);
  gun.root.position.set(...PISTOL_IN_HAND.pos);
  gun.root.rotation.set(...PISTOL_IN_HAND.rot);
  const head: ThugBrain = {
    get at() {
      return brain.at;
    },
    reset: () => brain.reset(),
    step: (self, dt, f) => {
      if (!f.gun) return;
      const out = brain.update(dt, { x: self.root.position.x, z: self.root.position.z }, f.gun);
      self.root.position.x = out.x;
      self.root.position.z = out.z;
      self.yaw = out.yaw;
      self.resetPose();
      layer.reset();
      for (const l of out.layers) layer.lay(l.name, l.time, l.weight);
      self.root.updateMatrixWorld(true);
    },
  };
  thug.brain = head;
  return brain;
}
