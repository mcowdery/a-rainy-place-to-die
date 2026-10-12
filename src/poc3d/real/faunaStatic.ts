import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Any animal model file, for the showroom's candidates (assets/animals/candidates/: other people's, each one's licence in
 * assets/animals/CREDITS.md): loaded, stood on the ground, sized to a length, turned to face +Z, and drawn with the animals'
 * own lighting so the candidates and the animals built in code can be judged side by side. Animated files play a clip.
 */
const VERT = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  attribute vec4 aCol;
  varying vec3 vCol;
  varying vec3 vN;
  varying vec2 vUv;
  void main() {
    vec3 objectNormal = vec3(normal);
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    vec3 transformed = vec3(position);
    #include <skinning_vertex>
    vCol = aCol.rgb;
    #ifdef USE_MAP
      vUv = uv;
    #else
      vUv = vec2(0.0);
    #endif
    vN = normalize(mat3(modelMatrix) * objectNormal);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(transformed, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform float uLight;
  uniform vec3 uSunDir;
  #ifdef USE_MAP
    uniform sampler2D tMap;
  #endif
  varying vec3 vCol;
  varying vec3 vN;
  varying vec2 vUv;
  void main() {
    vec3 c = vCol;
    #ifdef USE_MAP
      c *= pow(texture2D(tMap, vUv).rgb, vec3(1.0 / 2.2));
    #endif
    // (A file with no normals gives a zero vector here; a NaN written to the frame would spread through the bloom and blank it.)
    float ln = length(vN);
    vec3 n = ln > 1e-4 ? vN / ln : vec3(0.0, 1.0, 0.0);
    if (!gl_FrontFacing) n = -n;
    float l = 0.38 + 0.5 * smoothstep(-0.5, 1.0, dot(n, uSunDir)) + 0.12 * (n.y * 0.5 + 0.5);
    gl_FragColor = vec4(c * l * uLight, 1.0);
  }
`;

const loader = new GLTFLoader();
const toDisplay = (v: number): number => Math.pow(Math.max(0, v), 1 / 2.2);

/** What the animals share with models drawn beside them: the light and where the sun is. */
export interface SharedUniforms {
  readonly uLight: { value: number };
  readonly uSunDir: { value: THREE.Vector3 };
}

export interface StaticModel {
  readonly group: THREE.Group;
  update(dt: number): void;
}

export interface StaticOptions {
  /** The length of the animal (m) along its longest horizontal side, the tail and the wings in. */
  readonly len: number;
  /** Turns it further about Y (rad) when it faces the wrong way: the default faces its longer side's +X or +Z. */
  readonly yaw?: number;
  /** Raised off the ground (a flying one), m. */
  readonly lift?: number;
  /** A clip to play, if the file has any (a name, or the first that has 'idle' in it). */
  readonly clip?: string;
}

/** One animal made from a template: its group stands at the feet facing +Z; `play` crossfades to a clip. */
export interface ModelInstance {
  readonly group: THREE.Group;
  readonly clips: readonly string[];
  update(dt: number): void;
  /** Plays the first of `names` that the file has (else its Idle, else its first clip), at `timeScale`; false if it has none. */
  play(names: readonly string[], timeScale?: number, offset?: number): boolean;
}

export interface ModelTemplate {
  readonly clips: readonly string[];
  make(): ModelInstance;
}

/** Loads a model file once and returns what makes any number of animals from it (skinned ones are cloned with their own skeletons). */
export async function loadTemplate(url: string, shared: SharedUniforms, o: StaticOptions): Promise<ModelTemplate> {
  const gltf = await loader.loadAsync(url);
  const base = gltf.scene;
  base.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  base.traverse((m) => {
    if ((m as THREE.Mesh).isMesh) meshes.push(m as THREE.Mesh);
  });
  for (const m of meshes) {
    const g = m.geometry as THREE.BufferGeometry;
    if (!g.attributes.normal) g.computeVertexNormals();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 4);
    const groups = g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : n, materialIndex: 0 }];
    const vc = g.attributes.color as THREE.BufferAttribute | undefined;
    let map: THREE.Texture | null = null;
    const index = g.index;
    for (const grp of groups) {
      const mat = mats[grp.materialIndex ?? 0] as THREE.MeshStandardMaterial;
      const c = mat.color ?? new THREE.Color(1, 1, 1);
      if (mat.map && !map) map = mat.map;
      for (let i = grp.start; i < grp.start + grp.count; i++) {
        const v = index ? index.getX(i) : i;
        let r = c.r;
        let gg = c.g;
        let b = c.b;
        if (vc) {
          r *= vc.getX(v);
          gg *= vc.getY(v);
          b *= vc.getZ(v);
        }
        col.set([mat.map ? 1 : toDisplay(r), mat.map ? 1 : toDisplay(gg), mat.map ? 1 : toDisplay(b), 1], v * 4);
      }
    }
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 4));
    g.clearGroups();
    m.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uLight: shared.uLight, uSunDir: shared.uSunDir, tMap: { value: map } },
      defines: map ? { USE_MAP: '' } : {},
      side: THREE.DoubleSide,
    });
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = false;
  }
  // Size, stand and turn it: its box (in the bind pose, in world space), longest horizontal side to `len`.
  const box = new THREE.Box3().setFromObject(base);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const long = Math.max(size.x, size.z) || 1;
  const k = o.len / long;
  const facing = (size.x > size.z ? -Math.PI / 2 : 0) + (o.yaw ?? 0);
  const names = gltf.animations.map((c) => c.name);
  return {
    clips: names,
    make() {
      const scene = cloneSkinned(base) as THREE.Group;
      const inner = new THREE.Group();
      scene.position.set(-centre.x, -box.min.y, -centre.z);
      inner.add(scene);
      inner.scale.setScalar(k);
      inner.rotation.y = facing;
      inner.position.y = o.lift ?? 0;
      const group = new THREE.Group();
      group.add(inner);
      const mixer = gltf.animations.length ? new THREE.AnimationMixer(scene) : null;
      const actions = new Map<string, THREE.AnimationAction>();
      let current: THREE.AnimationAction | null = null;
      const action = (name: string): THREE.AnimationAction | null => {
        let a = actions.get(name) ?? null;
        if (!a && mixer) {
          const clip = gltf.animations.find((c) => c.name === name);
          if (clip) {
            a = mixer.clipAction(clip);
            actions.set(name, a);
          }
        }
        return a;
      };
      return {
        group,
        clips: names,
        update: (dt) => mixer?.update(dt),
        play(want, timeScale = 1, offset = 0) {
          if (!mixer) return false;
          const name = want.find((w) => names.includes(w)) ?? names.find((n) => /idle/i.test(n)) ?? names[0];
          const next = action(name);
          if (!next) return false;
          if (next !== current) {
            next.reset();
            next.time = (offset % 1) * next.getClip().duration;
            next.play();
            if (current) next.crossFadeFrom(current, 0.25, false);
            current = next;
          }
          next.setEffectiveTimeScale(timeScale);
          return true;
        },
      };
    },
  };
}

/** Loads a model file and makes one animal ready to place (the showroom's: its `group` at the animal's feet, facing +Z). */
export async function loadStatic(url: string, shared: SharedUniforms, o: StaticOptions): Promise<StaticModel> {
  const inst = (await loadTemplate(url, shared, o)).make();
  inst.play(o.clip ? [o.clip] : ['Idle']);
  return { group: inst.group, update: (dt) => inst.update(dt) };
}
