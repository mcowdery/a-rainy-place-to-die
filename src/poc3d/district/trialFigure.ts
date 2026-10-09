import * as THREE from 'three';
import { Character, registerCharacters } from '../models/characters';

/**
 * A figure under trial, walking in the city so it can be judged where it would be seen: in the city's light, at
 * the city's distances, beside the crowd. Dev server only (`district.html?figure=<a .glb's path>`, e.g. a generated
 * figure given the cast's skeleton by scripts/blender/rig_figure.py, kept under debug-shots/): it isn't one of the
 * builds' files and nothing here is in a build (main.ts asks for this module on the dev server alone).
 *
 * She walks a stretch of ground across in front of where you stood when she was put down, turns at each end and
 * comes back, at the pace her walk's legs go, on whatever the ground is there (she knows nothing of walls, cars or
 * kerbs: this is for looking at her, not for a passer-by). Go far from her and she is put down in front of you again.
 */
const WALK = 'Walk_Normal_105_Loop';
/** How far she walks before she turns (m), how far in front of you she is put down, and how far off is lost. */
const STRETCH = 14;
const AHEAD = 5;
const LOST = 70;

/** The glow her materials give themselves in the dark (of their own colour), at full lamps: the city's street lights don't reach a character's materials (and a light added would recompile every city shader), so she'd be a black shape. */
const NIGHT_GLOW = 0.3;

export interface TrialFigure {
  update(dt: number, camera: THREE.Camera): void;
}

export async function trialFigure(scene: THREE.Scene, file: string, groundAt: (x: number, z: number) => number, lamps: () => number): Promise<TrialFigure> {
  registerCharacters({ figure: file });
  const figure = await Character.load('figure');
  await figure.play(WALK, 0, true);
  const speed = (await figure.pace(WALK)) || 1.2;
  const glow: THREE.MeshStandardMaterial[] = [];
  figure.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const s = mat as THREE.MeshStandardMaterial;
      if (!s.map || s.alphaTest > 0) continue;
      s.emissiveMap = s.map;
      s.emissive.set(0xffffff);
      s.emissiveIntensity = 0;
      glow.push(s);
    }
  });
  scene.add(figure.root);
  const middle = new THREE.Vector3();
  const along = new THREE.Vector3(1, 0, 0);
  const ahead = new THREE.Vector3();
  let placed = false;
  let gone = 0;
  let way = 1;
  return {
    update(dt, camera) {
      const here = camera.position;
      if (!placed || Math.hypot(figure.root.position.x - here.x, figure.root.position.z - here.z) > LOST) {
        camera.getWorldDirection(ahead);
        ahead.y = 0;
        if (ahead.lengthSq() < 1e-6) ahead.set(0, 0, -1);
        ahead.normalize();
        middle.set(here.x + ahead.x * AHEAD, 0, here.z + ahead.z * AHEAD);
        along.set(-ahead.z, 0, ahead.x);
        gone = 0;
        placed = true;
      }
      gone += way * speed * dt;
      if (Math.abs(gone) > STRETCH / 2) {
        gone = Math.sign(gone) * STRETCH / 2;
        way = -way;
      }
      const x = middle.x + along.x * gone;
      const z = middle.z + along.z * gone;
      figure.root.position.set(x, groundAt(x, z), z);
      // (The models face +z.)
      figure.root.rotation.y = Math.atan2(along.x * way, along.z * way);
      for (const m of glow) m.emissiveIntensity = NIGHT_GLOW * lamps();
      figure.update(dt);
    },
  };
}
