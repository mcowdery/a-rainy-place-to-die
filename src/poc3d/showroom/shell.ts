import './nav';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { cityMaterial, cityUniforms } from '../real/city';
import { MeshBuilder } from '../real/meshBuilder';
import { setCharacterEnvironment } from '../models/characters';
import { CensorPass } from '../models/censorPass';
import type { FpMode } from './fpMode';
import './room.css';

/**
 * The shared shell of the model showrooms (models-*.html, one page and one module a room, src/poc3d/showroom/rooms/):
 * the renderer with the district's post (HDR + MSAA, bloom, ACES, no city, lightmap or ASCII overlay), the orbit camera and
 * its fly keys, the studio / night / day lighting, the labels over the models, the panel of focus buttons (one section a
 * group the room names), `window.__view`, and the render loop. A room (`startRoom`) says what it is called, what groups it
 * has and where the camera and the key light stand, and in `setup` adds its floor and its models to the scene, their
 * labels and their focus items. Each room uses clean coordinates of its own.
 * Mouse: left-drag orbit, right-drag pan, wheel zoom. Keys: WASD / Q E fly the view (Shift faster), M new/previous models
 * (rooms that have a previous generation), 1 studio / 2 night / 3 day lighting, L labels, X wireframe, B bloom, R turntable.
 */

export interface Item {
  readonly name: string;
  readonly group: string;
  readonly at: THREE.Vector3;
  readonly size: number;
  /** Fixed viewing direction (from the item towards the camera); otherwise keep the current one. */
  readonly view?: THREE.Vector3;
}
/** Two generations of models side by side in the same layout: 'new' (under review) and 'previous' (what the district still uses). */
export type Gen = 'new' | 'previous';

export interface RoomConfig {
  /** The room's name, in the HUD. */
  readonly title: string;
  /** The panel's sections, in order: each lists the items of that group. */
  readonly groups: readonly string[];
  /** Where the camera starts: position and orbit target (default: 24 m back and 7 up, looking at the origin). */
  readonly camera?: { readonly pos: readonly [number, number, number]; readonly target: readonly [number, number, number] };
  /** The panel's `overview` button. */
  readonly overview?: { readonly at: readonly [number, number, number]; readonly size: number; readonly view: readonly [number, number, number] };
  /** Where the key light looks and how far its shadow reaches (default: the origin, 25 m each way). */
  readonly shadow?: { readonly x: number; readonly z: number; readonly half: number };
  /** The camera's far plane (default 500). */
  readonly far?: number;
  /** The room has a previous generation (the M switch and the panel's Models section). */
  readonly previous?: boolean;
  /** The panel has the foliage seasons. */
  readonly season?: boolean;
  /** The room's light is a summer one all year (Manila: no seasons, no petals on the ground). */
  readonly summer?: boolean;
  /** The room adds its floor, models, labels and items here. */
  readonly setup: (ctx: RoomCtx) => void;
}

export interface RoomCtx {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  /** The city material and its uniforms: the district's. */
  readonly city: ReturnType<typeof cityMaterial>;
  readonly cityU: ReturnType<typeof cityUniforms>;
  /** What each generation holds (shown by M), its labels' objects and its focus items. */
  readonly genRoot: Record<Gen, THREE.Group>;
  readonly genItems: Record<Gen, Item[]>;
  /** A label over a model (drawn over everything). */
  readonly label: (g: Gen, text: string, x: number, y: number, z: number) => void;
  /** Adds the room's floor: the builder is given to `build`, the result is lit and receives shadows, always visible. */
  readonly floor: (build: (f: MeshBuilder) => void) => void;
  /** The soft environment light of the characters, guns and bikes (made at first use, and handed to `setCharacterEnvironment`). */
  readonly env: () => THREE.Texture;
  /** Called every frame with the frame's seconds. */
  readonly onFrame: (fn: (dt: number) => void) => void;
  /** Gives the room first-person Mack: it takes over the render loop and keys while active. */
  readonly setFirstPerson: (fp: FpMode, enter: () => void) => void;
  /** Extra panel sections: called each time the panel is drawn. */
  readonly panelExtra: (fn: (p: PanelApi) => void) => void;
  readonly renderPanel: () => void;
  readonly focus: (it: Item) => void;
  readonly fp: () => FpMode | null;
}
export interface PanelApi {
  section(title: string): void;
  button(text: string, on: boolean, fn: () => void): void;
}

const $ = (id: string): HTMLElement => {
  let e = document.getElementById(id);
  if (!e) {
    e = document.createElement('div');
    e.id = id;
    document.body.appendChild(e);
  }
  return e;
};

/** People face +z in rows; viewed from the front and ~30 degrees up, the row in front doesn't block. */
export const FRONT_VIEW = new THREE.Vector3(0, 0.55, 0.85).normalize();

export function startRoom(cfg: RoomConfig): RoomCtx {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // (PCFSoftShadowMap is removed in three: it swaps this in at the first render, recompiling every shadowed shader)
  document.body.prepend(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.setSize(window.innerWidth, window.innerHeight);
  Object.assign(labels.domElement.style, { position: 'fixed', top: '0', left: '0', pointerEvents: 'none' });
  document.body.appendChild(labels.domElement);
  document.title = `Showroom: ${cfg.title}`;
  $('hud');
  $('panel');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, cfg.far ?? 500);
  const cam = cfg.camera ?? { pos: [0, 7, 24], target: [0, 1, 4] };
  camera.position.set(...cam.pos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...cam.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.update();
  // For scripted screenshots: __view(x, y, z, tx, ty, tz) puts the camera at (x, y, z) looking at (tx, ty, tz).
  (window as unknown as { __view: (...v: number[]) => void }).__view = (x, y, z, tx, ty, tz) => {
    camera.position.set(x, y, z);
    controls.target.set(tx, ty, tz);
    controls.update();
  };

  // Lighting: a key light with soft shadows, sky/ground fill, and two warm "street" point lights for night.
  const sh = cfg.shadow ?? { x: 0, z: 0, half: 25 };
  const hemi = new THREE.HemisphereLight();
  const key = new THREE.DirectionalLight();
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -sh.half, right: sh.half, top: sh.half, bottom: -sh.half, near: 1, far: 120 + sh.half });
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  key.position.set(sh.x + 18, 30, sh.z + 22);
  key.target.position.set(sh.x, 0, sh.z);
  const street = [new THREE.PointLight(0xffc98a, 0, 30, 1.6), new THREE.PointLight(0xffc98a, 0, 30, 1.6), new THREE.PointLight(0x9ac8ff, 0, 30, 1.6)];
  street[0].position.set(sh.x - 6, 5.5, sh.z + 1);
  street[1].position.set(sh.x + 6, 5.5, sh.z + 9);
  street[2].position.set(sh.x, 5, sh.z + 15);
  scene.add(hemi, key, key.target, ...street);

  const cityU = cityUniforms();
  cityU.uLightGain.value = 0;
  if (cfg.summer) cityU.uSeason.value = 1;
  const city = cityMaterial(cityU);

  const genRoot: Record<Gen, THREE.Group> = { new: new THREE.Group(), previous: new THREE.Group() };
  const genLabels: Record<Gen, CSS2DObject[]> = { new: [], previous: [] };
  const genItems: Record<Gen, Item[]> = { new: [], previous: [] };
  scene.add(genRoot.new, genRoot.previous);
  let gen: Gen = 'new';
  let fp: FpMode | null = null;
  let enterFp: () => void = () => undefined;
  const frameFns: ((dt: number) => void)[] = [];
  const panelFns: ((p: PanelApi) => void)[] = [];
  let floorMesh: THREE.Mesh | null = null;

  // The labels over the models (drawn over everything, so they can cover what's in front): shown orbiting, hidden in
  // first person (looking at Mack), each switched by L or the panel's Labels while in that mode; remembered.
  let labelsOn = true;
  let fpLabels = false;
  try {
    labelsOn = localStorage.getItem('rainyplace.showroom.labels') !== '0';
    fpLabels = localStorage.getItem('rainyplace.showroom.labels.fp') === '1';
  } catch {
    /* no storage */
  }
  const fpActive = (): boolean => fp !== null && fp.active;
  /** Whether the labels show now. */
  const labelsShown = (): boolean => (fpActive() ? fpLabels : labelsOn);
  let labelsShownNow = true;
  const setLabels = (on: boolean): void => {
    if (fpActive()) fpLabels = on;
    else labelsOn = on;
    try {
      localStorage.setItem(fpActive() ? 'rainyplace.showroom.labels.fp' : 'rainyplace.showroom.labels', on ? '1' : '0');
    } catch {
      /* no storage */
    }
    applyGen(gen);
    renderPanel();
  };
  const label = (g: Gen, text: string, x: number, y: number, z: number): void => {
    const div = document.createElement('div');
    div.className = 'label';
    div.textContent = text;
    const o = new CSS2DObject(div);
    o.position.set(x, y, z);
    scene.add(o);
    genLabels[g].push(o);
  };
  let charEnv: THREE.Texture | null = null;
  const env = (): THREE.Texture => {
    if (!charEnv) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      charEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      setCharacterEnvironment(charEnv);
    }
    return charEnv;
  };

  // Lighting modes.
  type Mode = 'studio' | 'night' | 'day';
  let mode: Mode = 'studio';
  const applyMode = (m: Mode): void => {
    mode = m;
    const L = {
      studio: { bg: 0x2a2c30, hs: 0xdde4ee, hg: 0x4a4640, hi: 1.4, kc: 0xfff4e8, ki: 2.4, exp: 1.0, pts: 0, zen: 0x9aa4b4, hor: 0xc8ccd4, lamps: 0 },
      night: { bg: 0x05060a, hs: 0x3a4668, hg: 0x2a2018, hi: 0.25, kc: 0x9fb0ff, ki: 0.3, exp: 1.2, pts: 60, zen: 0x03050c, hor: 0x2c1e2a, lamps: 1 },
      day: { bg: 0x7aa4d4, hs: 0xbcd4f0, hg: 0x5a4e40, hi: 1.3, kc: 0xfff1dc, ki: 3.2, exp: 0.85, pts: 0, zen: 0x3f78c0, hor: 0xb8cfe0, lamps: 0 },
    }[m];
    (scene.background as THREE.Color).setHex(L.bg);
    hemi.color.setHex(L.hs);
    hemi.groundColor.setHex(L.hg);
    hemi.intensity = L.hi;
    key.color.setHex(L.kc);
    key.intensity = L.ki;
    for (const p of street) p.intensity = L.pts;
    renderer.toneMappingExposure = L.exp;
    cityU.uZenith.value.setHex(L.zen);
    cityU.uHorizon.value.setHex(L.hor);
    cityU.uRoomAmbient.value.setHex(L.hs).multiplyScalar(L.hi * 0.12);
    cityU.uLamps.value = L.lamps;
    cityU.uLightGain.value = 1.4 * L.lamps;
    cityU.uNeon.value = m === 'day' ? 0 : 1;
    cityU.uSunDir.value.copy(key.position).sub(key.target.position).normalize();
    cityU.uSunCol.value.copy(key.color).multiplyScalar(key.intensity);
    renderPanel();
  };
  const applyGen = (g: Gen): void => {
    gen = g;
    genRoot.new.visible = g === 'new';
    genRoot.previous.visible = g === 'previous';
    for (const k of ['new', 'previous'] as const) for (const o of genLabels[k]) o.visible = labelsShown() && k === g;
    labelsShownNow = labelsShown();
    renderPanel();
  };

  // Post: HDR + MSAA -> bloom -> ACES, like the district (no ASCII overlay here).
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 }));
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.45, 1.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // Mack's face censored on the finished image when the style asks (models/censorPass.ts).
  const censor = new CensorPass();
  composer.addPass(censor);

  // Focus: glide the orbit target and camera to an item.
  let glide: { t0: number; from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3 } | null = null;
  const focus = (it: Item): void => {
    const dir = it.view ? it.view.clone() : camera.position.clone().sub(controls.target).normalize();
    if (dir.y < 0.25) dir.y = 0.35;
    dir.normalize();
    glide = { t0: performance.now(), from: controls.target.clone(), to: it.at.clone(), camFrom: camera.position.clone(), camTo: it.at.clone().addScaledVector(dir, it.size * 1.3) };
  };

  // Click (without dragging) on a car or a person to glide to it.
  const raycaster = new THREE.Raycaster();
  let downAt: [number, number] | null = null;
  renderer.domElement.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
    const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(genRoot[gen].children, false).find((h) => h.object !== floorMesh);
    if (!hit) return;
    const m = hit.object as THREE.Mesh;
    // People are placed by their mesh position (feet); cars are one merged mesh, so use the hit point.
    const person = m.position.lengthSq() > 0;
    const at = person ? m.position.clone().add(new THREE.Vector3(0, 0.95, 0)) : hit.point.clone().setY(0.8);
    focus({ name: '', group: '', at, size: person ? 2.2 : 4.2 });
  });
  (window as unknown as { __season: (i: number) => void }).__season = (i) => {
    cityU.uSeason.value = i;
    renderPanel();
  };
  (window as unknown as { __focusAt: (x: number, y: number, z: number, size: number, vx: number, vy: number, vz: number) => void }).__focusAt = (x, y, z, size, vx, vy, vz) =>
    focus({ name: '', group: '', at: new THREE.Vector3(x, y, z), size, view: new THREE.Vector3(vx, vy, vz).normalize() });

  function renderPanel(): void {
    const panel = $('panel');
    panel.innerHTML = '';
    const api: PanelApi = {
      section(title) {
        const h = document.createElement('h3');
        h.textContent = title;
        panel.appendChild(h);
      },
      button(text, on, fn) {
        const b = document.createElement('button');
        b.textContent = text;
        if (on) b.className = 'on';
        b.onclick = fn;
        panel.appendChild(b);
      },
    };
    const { section, button } = api;
    section(cfg.title);
    if (cfg.previous) {
      section('Models');
      button('new (under review)', gen === 'new', () => applyGen('new'));
      button('previous (in the district)', gen === 'previous', () => applyGen('previous'));
    }
    section('Labels');
    button(labelsShown() ? 'labels on (L)' : 'labels off (L)', labelsShown(), () => setLabels(!labelsShown()));
    section('Lighting');
    for (const m of ['studio', 'night', 'day'] as const) button(m, mode === m, () => applyMode(m));
    if (cfg.season) {
      section('Foliage season');
      (['spring', 'summer', 'autumn', 'winter'] as const).forEach((sn, i) => button(sn, cityU.uSeason.value === i, () => {
        cityU.uSeason.value = i;
        renderPanel();
      }));
    }
    for (const g of cfg.groups) {
      const list = genItems[gen].filter((i) => i.group === g);
      if (list.length === 0) continue;
      section(g);
      for (const it of list) button(it.name, false, () => focus(it));
    }
    for (const fn of panelFns) fn(api);
    section('Showrooms');
    button('→ all the showrooms (models.html)', false, () => (location.href = 'models.html'));
    if (cfg.overview) {
      const o = cfg.overview;
      section('View');
      button('overview', false, () => focus({ name: '', group: '', at: new THREE.Vector3(...o.at), size: o.size, view: new THREE.Vector3(...o.view).normalize() }));
    }
  }

  const ctx: RoomCtx = {
    renderer, scene, camera, controls, city, cityU, genRoot, genItems, label, env, renderPanel, focus,
    floor(build) {
      const f = new MeshBuilder();
      build(f);
      floorMesh = new THREE.Mesh(f.build()!, city);
      floorMesh.receiveShadow = true;
      scene.add(floorMesh);
    },
    onFrame: (fn) => void frameFns.push(fn),
    setFirstPerson(f, enter) {
      fp = f;
      enterFp = enter;
    },
    panelExtra: (fn) => void panelFns.push(fn),
    fp: () => fp,
  };

  const t0 = performance.now();
  cfg.setup(ctx);
  const tBuilt = performance.now() - t0;

  applyMode('studio');
  applyGen('new');

  // Fly keys move the camera and its orbit target together.
  const keys = new Set<string>();
  let turntable = false;
  let wire = false;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyL') return setLabels(!labelsShown());
    if (fpActive()) return;
    if (e.code === 'KeyV' && fp) {
      enterFp();
      setTimeout(renderPanel, 50);
      return;
    }
    keys.add(e.code);
    if (e.code === 'Digit1') applyMode('studio');
    if (e.code === 'Digit2') applyMode('night');
    if (e.code === 'Digit3') applyMode('day');
    if (e.code === 'KeyM' && cfg.previous) applyGen(gen === 'new' ? 'previous' : 'new');
    if (e.code === 'KeyB') bloom.enabled = !bloom.enabled;
    if (e.code === 'KeyR') turntable = !turntable;
    if (e.code === 'KeyX') {
      wire = !wire;
      city.wireframe = wire;
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    labels.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (fpActive()) keys.clear();
    const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 14 : 4) * dt;
    camera.getWorldDirection(fwd);
    right.crossVectors(fwd, camera.up).normalize();
    const move = new THREE.Vector3();
    if (keys.has('KeyW')) move.add(fwd);
    if (keys.has('KeyS')) move.sub(fwd);
    if (keys.has('KeyD')) move.add(right);
    if (keys.has('KeyA')) move.sub(right);
    if (keys.has('KeyE')) move.y += 1;
    if (keys.has('KeyQ')) move.y -= 1;
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed);
      camera.position.add(move);
      controls.target.add(move);
      glide = null;
    }
    if (glide && !fpActive()) {
      const t = Math.min(1, (performance.now() - glide.t0) / 600);
      const k = t * t * (3 - 2 * t);
      controls.target.lerpVectors(glide.from, glide.to, k);
      camera.position.lerpVectors(glide.camFrom, glide.camTo, k);
      if (t >= 1) glide = null;
    }
    controls.autoRotate = turntable;
    if (fp && fp.active) fp.update(dt);
    else controls.update();
    // Into or out of first person: its own label setting.
    if (labelsShown() !== labelsShownNow) applyGen(gen);
    cityU.uTime.value = performance.now() / 1000;
    for (const fn of frameFns) fn(dt);
    censor.track(fp ? fp.body : null, camera);
    composer.render(dt);
    labels.render(scene, camera);
    $('hud').textContent = fp && fp.active ? fp.hud() : [
      `MODEL SHOWROOM · ${cfg.title}${cfg.previous ? ` · ${gen === 'new' ? 'NEW models (under review)' : 'previous models (district)'}` : ''} · ${mode} lighting · built in ${tBuilt.toFixed(0)} ms`,
      'click a model to focus it · left-drag orbit · right-drag pan · wheel zoom · WASD / Q E fly (Shift faster)',
      `${cfg.previous ? 'M new/previous models · ' : ''}1 studio · 2 night · 3 day · L labels · X wireframe${wire ? ' (on)' : ''} · B bloom${bloom.enabled ? '' : ' (off)'} · R turntable${turntable ? ' (on)' : ''}`,
    ].join('\n');
  });
  return ctx;
}
