import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Statues: one-off objects that are a loaded model with a picture on it, where everything else in the city is
 * built in code and drawn by the one city material (real/props.ts). Each is `assets/props/<name>.glb`: a shape
 * generated from a picture of the project's own (scripts/props/mesh_endpoint.mjs), then reduced, given a normal
 * map and painted from that picture in Blender (scripts/blender/prop_from_mesh.py); where each came from is in
 * `assets/props/CREDITS.md`. One mesh, one material, y up, facing +z, standing on y 0, one metre tall: whoever
 * places one scales it.
 *
 * Candidates until the user approves them in the model showroom (models.html, the Mega-sign group): none is in
 * the district. A statue is a draw call and a material of its own, so this is for a landmark, not for street
 * furniture.
 */
const FILES = import.meta.glob('/assets/props/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const byName = new Map(Object.entries(FILES).map(([path, url]) => [/([^/]+)\.glb$/.exec(path)![1], url]));

/** The statues there are (file names without .glb). */
export const STATUES: readonly string[] = [...byName.keys()].sort();

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();

/** A statue by name: a copy of its own to place and scale, sharing the one geometry and material. `env` lights its glaze. */
export function loadStatue(name: string, env: THREE.Texture | null = null): Promise<THREE.Object3D> {
  let p = cache.get(name);
  if (!p) {
    const url = byName.get(name);
    if (!url) return Promise.reject(new Error(`no statue '${name}' in assets/props/`));
    p = loader.loadAsync(url).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (env) {
          mat.envMap = env;
          mat.envMapIntensity = 0.5;
        }
      });
      return g.scene;
    });
    cache.set(name, p);
  }
  return p.then((scene) => scene.clone());
}
