import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FlagStore } from '../../core/flags';
import { ContentError } from '../../content/load';
import { FLAG_TIME, FLAG_WEATHER, TIMES, WEATHERS, type TimeOfDay, type Weather } from '../../atmosphere/rules';
import { PlaceholderVnBridge } from '../../game/bridge';
import { FirstPerson } from '../controls';
import { frontFrame } from '../real/buildings';
import { cityMaterial, cityUniforms } from '../real/city';
import { Lightmap } from '../real/lightmap';
import { buildMegaSign } from '../real/megaSign';
import { buildKonbini } from '../real/konbini';
import { buildShrine } from '../real/shrine';
import { buildLoveHotel } from '../real/loveHotel';
import { buildLiveHouse } from '../real/liveHouse';
import { buildYokocho } from '../real/yokocho';
import { buildRyujin } from '../real/ryujin';
import { buildDiscount } from '../real/discount';
import { buildStation } from '../real/station';
import { ASAGIRI_KINDS, buildAsagiri, type AsagiriKind } from '../real/asagiri';
import { TrainSystem, viaductPiers, type RailStation } from '../real/rail';
import { TrafficSystem } from '../real/traffic';
import { GRADE_NAMES, GradePass } from '../real/grade';
import { DofPass } from '../real/dof';
import { SsrPass } from '../real/ssr';
import { CityAudio } from '../real/audio';
import { LampCones, LampShadows, Lightning, RainLayers, RainSystem, StreetWater } from '../real/weather';
import { moodFromUrl, MoodPanel } from './moodPanel';
import { routeFor } from './traffic';
import { destinations, TravelMap, type Destination } from './travel';
import { EMIT, KIND, lin, MeshBuilder } from '../real/meshBuilder';
import { AsciiOverlayPass, OVERLAY_PRESETS, type OverlayPreset } from '../real/overlay';
import { addFigure, GhostBuilder, ghostMaterial, type FigureSpec } from '../real/people';
import { SignAtlas, signMaterial } from '../real/signs';
import { adMaterial, DistrictAdAtlas } from '../real/adAtlas';
import { Sky } from '../real/sky';
import type { Atmosphere3 } from './atmosphere';
import { loadDistrictContent } from './content';
import { signTexts } from './model';
import { CELL, DISTRICTS3, STYLES3 } from './plan';
import type { Node3 } from './stamps';
import { District } from './world';

/**
 * Kaburo (Neon Core), generated at full scale from the L0 map and streamed in chunks, rendered
 * realistically with an ASCII overlay for mood (see real/overlay.ts).
 * URL: ?time=night|day|dusk|dawn &weather=clear|rain|fog &cam=x,y,z,yaw,pitch &spawn=<node id> &ascii=vibe|heavy|ascii|off &grade=neutral|nocturne|noir|citypop &bench=1
 * Keys: WASD/mouse, Shift run, E interact, M map / fast travel, T time, R weather, F fly, V overlay (1-4 direct), G dither,
 * B bloom, P look mode.
 */
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
const bench = params.get('bench') === '1';
const START_SPAWN = 'kaburo_crossing.view';
const SEED = 0x0c179090;
const CELL_W = 8;
const CELL_H = 14;

type C3 = [number, number, number];

async function run(): Promise<void> {
  const content = loadDistrictContent();
  const flags = new FlagStore({ [FLAG_TIME]: params.get('time') ?? 'night', [FLAG_WEATHER]: params.get('weather') ?? 'clear' });
  const time = (): TimeOfDay => flags.get(FLAG_TIME) as TimeOfDay;
  const weather = (): Weather => flags.get(FLAG_WEATHER) as Weather;

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 60, 620);
  const sky = new Sky();
  scene.add(sky.mesh);
  const hemi = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -110;
  sc.right = 110;
  sc.top = 110;
  sc.bottom = -110;
  sc.near = 1;
  sc.far = 700;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(hemi, sun, sun.target);
  const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 1200);

  const style = STYLES3.neon!;
  const cityU = cityUniforms();
  const city = cityMaterial(cityU);
  const district = new District(content.macro, DISTRICTS3, content.placed, SEED, content.zones);
  const words = content.zones.words([...new Set(DISTRICTS3.flatMap((k) => STYLES3[k]!.signWords))]);
  const atlas = new SignAtlas(signTexts(words, content.placed));
  const M = 16;
  const b = district.bounds;
  const lightmap = new Lightmap(renderer, { x: b.minX - M, y: b.minZ - M, w: b.maxX - b.minX + 2 * M, h: b.maxZ - b.minZ + 2 * M }, CELL);
  cityU.tLight.value = lightmap.texture;
  cityU.uLightRect.value = lightmap.uniformRect;
  const ghost = ghostMaterial();
  const ads = adMaterial(cityU, new DistrictAdAtlas());
  district.setKit({ city, signs: signMaterial(cityU, atlas), ghost, ads, atlas, lightmap, words });
  scene.add(district.root);

  // Post: HDR scene with MSAA and a depth texture -> ASCII overlay -> bloom -> tone mapping + sRGB.
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(size.x, size.y) });
  const composer = new EffectComposer(renderer, rt);
  composer.setSize(window.innerWidth, window.innerHeight);
  const overlay = new AsciiOverlayPass(CELL_W, CELL_H);
  overlay.setCamera(camera);
  const initial = params.get('ascii') as OverlayPreset | null;
  if (initial && OVERLAY_PRESETS.includes(initial)) overlay.preset = initial;
  // Bloom: [ ] strength, ; ' threshold, B on/off; ?bloom=strength sets it from the URL.
  const bloomParam = Number(params.get('bloom'));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), Number.isFinite(bloomParam) && params.has('bloom') ? bloomParam : 0.22, 0.45, 1.6);
  composer.addPass(new RenderPass(scene, camera));
  // Reflections on wet ground and roofs, straight after the scene (it reads the scene's depth there).
  const ssr = new SsrPass(camera);
  composer.addPass(ssr);
  composer.addPass(overlay);
  // Depth of field after the overlay (it reads the scene's depth from the first target) and before bloom.
  const dof = new DofPass(() => overlay.depth, camera);
  composer.addPass(dof);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // The colour grade, last, on the display image: C cycles the looks, ?grade= picks one.
  const grade = new GradePass();
  // Weather and light settings on top of the atmosphere (K opens the panel; also from the URL).
  const mood = moodFromUrl(params);
  grade.grade = mood.grade;
  composer.addPass(grade);

  // Stamp dressing (door, noren, lanterns) and NPCs as ghosts (visibility follows their conditions).
  const nodes = district.nodes;
  const npcMeshes = new Map<string, THREE.Object3D>();
  const dressing = new MeshBuilder();
  for (const placed of content.placed) {
    const f = frontFrame(placed.building);
    // Landmarks dress their own doors.
    if (placed.stamp.landmark === null) for (const n of placed.nodes) if (n.kind === 'door') dressDoor(dressing, n, f.r, f.n);
    for (const n of placed.nodes) {
      if (n.kind !== 'npc') continue;
      const gb = new GhostBuilder();
      addFigure(gb, npcSpec(n, f.n));
      const mesh = new THREE.Mesh(gb.build(0, 0)!, ghost);
      mesh.renderOrder = 2;
      scene.add(mesh);
      npcMeshes.set(n.id, mesh);
    }
  }
  const dressingGeo = dressing.build();
  if (dressingGeo) scene.add(new THREE.Mesh(dressingGeo, city));
  // Landmarks: built here rather than by the chunk workers (their own shaders and animation), always shown.
  const landmarkUpdates: ((camera: THREE.Vector3, dt: number) => void)[] = [];
  // The Toto Line: its stations (station stamps) and the viaduct and trains between them.
  const rail = content.rail;
  const stationPlaced = content.placed.filter((p) => p.stamp.landmark === 'station');
  const railStations: RailStation[] = stationPlaced.map((p) => ({
    id: p.id,
    names: p.stamp.station!,
    z: p.building.z,
    side: Math.sign(p.building.x - (rail?.x ?? 0)),
    z0: p.building.z - p.building.d / 2,
    z1: p.building.z + p.building.d / 2,
  }));
  const trains = rail ? new TrainSystem(rail, railStations, city) : null;
  if (trains && rail) {
    scene.add(trains.group);
    district.addColliders(viaductPiers(rail, railStations));
  }
  // Traffic: cars and taxis clockwise round their loops, buses anticlockwise round theirs.
  const piers = rail ? [rail.x] : [];
  const plan = (mx: number, my: number) => district.plan(mx, my);
  const traffic = new TrafficSystem(
    content.traffic.cars.map((c) => ({ route: routeFor(c.rect, true, plan, piers), spacing: c.spacing })),
    content.traffic.buses.map((line) => ({ line, route: routeFor(line.rect, false, plan, piers) })),
    city,
  );
  scene.add(traffic.group);
  // Weather near the camera: rain streaks and splashes lit by the street, light cones under the lamps.
  const rain = new RainSystem(cityU);
  const cones = new LampCones();
  const lampShadows = new LampShadows();
  const rainLayers = new RainLayers(cityU);
  const streetWater = new StreetWater(cityU);
  const lightning = new Lightning();
  // Sound: starts on the first click (browsers need a gesture); thunder follows each strike.
  const audio = new CityAudio();
  lightning.onStrike = (s) => {
    // Pan: how far right of the view the strike is (yaw 0 looks toward -z; its right is +x).
    const yaw = (lookYaw() * Math.PI) / 180;
    audio.thunder(s.cloudOnly ? s.distance * 1.3 : s.distance, s.dirX * Math.cos(yaw) - s.dirZ * Math.sin(yaw));
  };
  scene.add(lightning.bolt, lightning.light, lightning.light.target);
  scene.add(rain.group, rainLayers.group, streetWater.group, cones.mesh, lampShadows.group);
  const windVec = new THREE.Vector2();
  const windTarget = new THREE.Vector2();
  let skyTime = 0;
  // The viaduct keeps the rain off the street under it.
  if (rail) district.shelters.push({ rect: { x: rail.x - 5, y: rail.z0, w: 10, h: rail.z1 - rail.z0 }, y0: -1, y1: 7.8 });
  district.addColliders(traffic.colliders);
  for (const placed of content.placed) {
    const lm = placed.stamp.landmark;
    if (lm && (ASAGIRI_KINDS as readonly string[]).includes(lm)) {
      const a = buildAsagiri(lm as AsagiriKind, placed.building, placed.id, city, ghost, cityU);
      scene.add(a.group);
      landmarkUpdates.push(a.update);
    } else if (lm === 'station' && rail) {
      const other = railStations.find((s) => s.id !== placed.id)?.names ?? null;
      scene.add(buildStation(placed.building, city, placed.stamp.station!, other, rail));
    } else if (lm === 'mega_sign') {
      const mega = buildMegaSign(cityU, city);
      mega.group.position.set(placed.building.x, 0, placed.building.z);
      scene.add(mega.group);
    } else if (lm === 'konbini') {
      const k = buildKonbini(placed.building, city, ghost);
      scene.add(k.group);
      landmarkUpdates.push(k.update);
    } else if (lm === 'shrine') {
      scene.add(buildShrine(placed.building, city));
    } else if (lm === 'discount') {
      const d = buildDiscount(placed.building, city, cityU);
      scene.add(d.group);
      landmarkUpdates.push(d.update);
    } else if (lm === 'ryujin') {
      scene.add(buildRyujin(placed.building, city, ghost));
    } else if (lm === 'yokocho') {
      scene.add(buildYokocho(placed.building, city, ghost));
    } else if (lm === 'live_house') {
      const h = buildLiveHouse(placed.building, city, ghost);
      scene.add(h.group);
      landmarkUpdates.push(h.update);
    } else if (lm === 'love_hotel') {
      const h = buildLoveHotel(placed.building, city, ghost, cityU);
      scene.add(h.group);
      landmarkUpdates.push(h.update);
    }
  }
  const visibleNode = (n: Node3): boolean => n.condition === null || n.condition(flags.get);
  const npcBlocked = (x: number, z: number, r: number): boolean =>
    nodes.some((n) => n.kind === 'npc' && visibleNode(n) && Math.hypot(n.x - x, n.z - z) < r + 0.35);

  const controls = new FirstPerson(camera, document.body, (x, z, r, floor) => district.blocked(x, z, r, floor) || ((floor ?? 0) > -1 && (floor ?? 0) < 1 && (npcBlocked(x, z, r) || traffic.blocked(x, z, r))));
  controls.setShearMode(false);
  controls.fly = params.get('fly') === '1';
  controls.floorAt = district.floorAt;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const YAW: Record<string, number> = { north: 0, south: 180, east: -90, west: 90 };
  const teleport = (id: string): void => {
    const n = nodeById.get(id)!;
    const level = district.floorAt(n.x, n.z, n.floor);
    camera.position.set(n.x, level + 1.7, n.z);
    controls.setLevel(level);
    if (n.view) controls.setView(n.view[0], n.view[1]);
    else controls.setView(YAW[n.facing ?? 'north'], 4);
  };
  // Fast travel: M opens a map of the district's places and zones.
  const lookYaw = (): number => {
    const d = camera.getWorldDirection(new THREE.Vector3());
    return (Math.atan2(-d.x, -d.z) * 180) / Math.PI;
  };
  const travel = new TravelMap(district, content.zones, destinations(district, nodes, content.zones), (d: Destination) => {
    const level = district.floorAt(d.x, d.z, d.floor);
    camera.position.set(d.x, controls.fly ? Math.max(camera.position.y, 1.7) : level + 1.7, d.z);
    controls.setLevel(level);
    controls.setView(d.yaw, d.pitch);
    travel.hide();
    controls.look.lock();
  });
  if (params.get('diag') === '1') Object.assign(window, { __renderer: renderer, __dof: dof, __audio: audio, __strike: () => {
    const d = camera.getWorldDirection(new THREE.Vector3());
    lightning.strikeNow(camera.position, { x: d.x, z: d.z });
  } });
  // Review hook for screenshot scripts: point the view (yaw, pitch in degrees).
  (window as unknown as { __look: (y: number, p: number) => void }).__look = (y, p) => controls.setView(y, p);
  const spawnParam = params.get('spawn');
  teleport(spawnParam && nodeById.get(spawnParam)?.kind === 'spawn' ? spawnParam : START_SPAWN);
  const cam = params.get('cam')?.split(',').map(Number);
  if (cam && cam.length === 5 && cam.every(Number.isFinite)) {
    camera.position.set(cam[0], cam[1], cam[2]);
    controls.setView(cam[3], cam[4]);
  }

  // Warm start: the workers build the neighbourhood (every stage) before the first frame.
  $('overlay').textContent = 'building the city...';
  const warm0 = performance.now();
  await district.warm(camera.position);
  const warmMs = performance.now() - warm0;
  const warmChunks = district.loaded;

  // Atmosphere: re-applied whenever (district, time, weather) changes.
  let atm!: Atmosphere3;
  let atmKey = '';
  const SUN_DIR: Record<TimeOfDay, C3> = { day: [0.45, 0.85, 0.35], dawn: [0.9, 0.22, 0.35], dusk: [-0.85, 0.2, 0.45], night: [-0.35, 0.7, -0.55] };
  const applyAtmosphere = (): void => {
    const key = `${time()}|${weather()}`;
    if (key === atmKey) return;
    atmKey = key;
    atm = content.atmosphere.resolve('neon', time(), weather());
    const fog = scene.fog as THREE.Fog;
    fog.color.setHex(atm.fog);
    fog.near = atm.fogNear;
    fog.far = atm.fogFar;
    hemi.color.setHex(atm.hemiSky);
    hemi.groundColor.setHex(atm.hemiGround);
    hemi.intensity = atm.hemi;
    sun.color.setHex(atm.sunColor);
    sun.intensity = atm.sun;
    const clear = weather() === 'clear';
    sun.castShadow = atm.sun >= 1.0 && clear;
    const d = SUN_DIR[time()];
    sky.uniforms.uSunDir.value.set(d[0], d[1], d[2]).normalize();
    sky.uniforms.uZenith.value.setHex(atm.sky);
    sky.uniforms.uHorizon.value.setHex(atm.horizon);
    sky.uniforms.uSunColor.value.setHex(atm.sunColor).multiplyScalar(time() === 'night' ? 0.25 : 1);
    sky.uniforms.uDisc.value = clear ? 1 : 0;
    sky.uniforms.uStars.value = time() === 'night' && clear ? 1 : 0;
    sky.uniforms.uCover.value = atm.clouds;
    sky.uniforms.uCloudLit.value.setHex(atm.cloudLit);
    sky.uniforms.uCloudDark.value.setHex(atm.cloudDark);
    cityU.uZenith.value.setHex(atm.sky);
    cityU.uHorizon.value.setHex(atm.horizon);
    cityU.uRoomAmbient.value.setHex(atm.hemiSky).multiplyScalar(atm.hemi * 0.12);
    cityU.uWindowLit.value = atm.windowLit;
    cityU.uLamps.value = atm.lamps;
    cityU.uLightGain.value = 1.4 * atm.lamps;
    cityU.uNeon.value = atm.neon === 'off' ? 0 : 1;
    cityU.uFlicker.value = atm.neon === 'flicker' ? 1 : 0;
    renderer.toneMappingExposure = atm.exposure;
    applyMood();
  };
  // The mood settings layered on the atmosphere: rain strength, fog density, darkness, lamp shadows.
  const base = { zenith: new THREE.Color(), horizon: new THREE.Color(), cloudLit: new THREE.Color(), hemi: 0, fogNear: 60, fogFar: 620 };
  let rainAmount = 0;
  let wetness = -1;
  let cycleTick = 1;
  const applyMood = (): void => {
    const fog = scene.fog as THREE.Fog;
    rainAmount = mood.rain ?? (atm.rain > 0 ? 0.45 : 0);
    const d = mood.darkness;
    const keep = 1 - 0.9 * d;
    // Heavy rain and wind-blown spray close the view in; the fog setting scales the density.
    const vis = (1 - rainAmount * 0.45) * (1 - mood.wind * rainAmount * 0.3) / mood.fog;
    base.fogNear = atm.fogNear * vis;
    base.fogFar = atm.fogFar * vis;
    fog.color.setHex(atm.fog).multiplyScalar(1 - 0.8 * d);
    base.hemi = atm.hemi * keep;
    // At night the moon has no shadows (they only switch on for a strong sun), so it lights every wall facing it
    // evenly; the atmosphere keeps it faint. The slider overrides it: 1.0 is the old, brighter moon (0.22).
    const night = atm.lamps > 0.5;
    sun.intensity = (night && mood.moon !== null ? mood.moon * 0.22 : atm.sun) * keep;
    base.zenith.setHex(atm.sky).multiplyScalar(1 - 0.85 * d);
    base.horizon.setHex(atm.horizon).multiplyScalar(1 - 0.85 * d);
    base.cloudLit.setHex(atm.cloudLit).multiplyScalar(1 - 0.7 * d);
    sky.uniforms.uCloudDark.value.setHex(atm.cloudDark).multiplyScalar(1 - 0.7 * d);
    sky.uniforms.uCover.value = rainAmount > 0 ? Math.max(atm.clouds, 0.75 + rainAmount * 0.25) : atm.clouds;
    sky.uniforms.uStars.value = time() === 'night' && rainAmount === 0 && weather() === 'clear' ? 1 - d * 0.5 : 0;
    cityU.uZenith.value.copy(base.zenith);
    cityU.uHorizon.value.copy(base.horizon);
    cityU.uRoomAmbient.value.setHex(atm.hemiSky).multiplyScalar(atm.hemi * 0.12 * keep);
    cityU.uWindowLit.value = atm.windowLit * (1 - 0.85 * d);
    // Wet streets: straight to the target when set up (a scene starts wet), then eased per frame.
    if (wetness < 0) wetness = mood.wetness ?? (rainAmount > 0 ? 1 : 0);
    cityU.uWet.value = wetness;
    // With shadow-casting lamps, the lamps' share of the baked street light is handed to the real lights.
    lampShadows.setCount(mood.shadows);
    cityU.uLightGain.value = 1.4 * atm.lamps * (mood.shadows > 0 ? 0.6 : 1);
    cityU.uDark.value = d;
    dof.strength = mood.dof;
    dof.focus = mood.focus;
    renderer.toneMappingExposure = atm.exposure * (1 - 0.3 * d);
    grade.grade = mood.grade;
    fogScale = 0;
  };
  const panel = new MoodPanel(mood, applyMood);
  // Up high (the observatory, flying) the air clears: the fog and the overlay's dissolve move out.
  let fogScale = 1;
  const fitFog = (): void => {
    const k = Math.round(Math.min(4, Math.max(1, 1 + (camera.position.y - 20) / 45)) * 20) / 20;
    if (k === fogScale) return;
    fogScale = k;
    const fog = scene.fog as THREE.Fog;
    fog.near = base.fogNear * k;
    fog.far = base.fogFar * k;
    overlay.setFog(fog.near, fog.far, fog.color);
  };
  applyAtmosphere();
  // Compile every shader variant and upload the warm-start geometry now, rather than in the first frames.
  // Compile for the composer's HDR target (the scene is drawn into it, not the canvas): programs are keyed
  // by the target's colour space, so compiling for the canvas left every material to compile again later.
  renderer.setRenderTarget(rt);
  await renderer.compileAsync(scene, camera);
  renderer.setRenderTarget(null);
  // Upload every texture now too (sign canvases, posters): otherwise each uploads the first time its object
  // comes into view, a hitch of tens of milliseconds for the big ones.
  const textures = new Set<THREE.Texture>();
  scene.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
      const uniforms = (m as THREE.ShaderMaterial).uniforms;
      if (uniforms) for (const u of Object.values(uniforms)) if (u?.value instanceof THREE.Texture) textures.add(u.value);
    }
  });
  for (const t of textures) renderer.initTexture(t);
  // And every mesh's geometry: draw the whole scene once without culling, so the landmarks, the viaduct
  // and the trains upload now rather than the first time each comes into view.
  const culled: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.frustumCulled) {
      o.frustumCulled = false;
      culled.push(o);
    }
  });
  composer.render(0);
  for (const o of culled) o.frustumCulled = true;
  $('overlay').textContent = 'click to walk';

  // Interaction: nearest visible interactable within reach, roughly in front of you.
  const bridge = new PlaceholderVnBridge($('vn'));
  let inVn = false;
  const forward = new THREE.Vector3();
  const target = (): Node3 | null => {
    camera.getWorldDirection(forward);
    let best: Node3 | null = null;
    let bestD = 3.2;
    const level = camera.position.y - 1.7;
    for (const n of nodes) {
      if (n.trigger !== 'interact' || !visibleNode(n) || Math.abs(n.floor - level) > 2) continue;
      const dx = n.x - camera.position.x;
      const dz = n.z - camera.position.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD && (dx * forward.x + dz * forward.z) / Math.max(d, 1e-3) > 0.3) {
        best = n;
        bestD = d;
      }
    }
    return best;
  };
  const interact = async (): Promise<void> => {
    const n = target();
    if (!n || inVn) return;
    if (n.kind === 'station' && n.returnSpawn) {
      if (isRailStation(n.placementId)) return trains ? rideTrain(n.placementId, n.returnSpawn) : undefined;
      return ride(n.returnSpawn);
    }
    inVn = true;
    document.exitPointerLock();
    const result = await bridge.enter(n);
    const spawn = result.returnSpawn ?? n.returnSpawn;
    if (spawn) teleport(spawn);
    inVn = false;
  };

  // Riding the train: fade, stand in the car for the trip, fade, step out onto the other platform.
  const fade = document.createElement('div');
  Object.assign(fade.style, { position: 'fixed', inset: '0', background: '#000', opacity: '0', pointerEvents: 'none', transition: 'opacity 0.35s', zIndex: '15' });
  document.body.append(fade);
  const fadeTo = (o: number): Promise<void> => new Promise((r) => {
    fade.style.opacity = String(o);
    setTimeout(r, 380);
  });
  // Elevators: a station node in a building that isn't a railway station takes you to its spawn.
  const isRailStation = (placementId: string): boolean => railStations.some((s) => s.id === placementId);
  async function ride(spawn: string): Promise<void> {
    inVn = true;
    await fadeTo(1);
    teleport(spawn);
    await new Promise((r) => setTimeout(r, 500));
    await fadeTo(0);
    inVn = false;
  }
  async function rideTrain(fromId: string, spawn: string): Promise<void> {
    const from = railStations.find((s) => s.id === fromId);
    const to = railStations.find((s) => s.id === nodeById.get(spawn)?.placementId);
    if (!from || !to || !trains) return;
    inVn = true;
    controls.held = true;
    await fadeTo(1);
    const arrived = trains.startRide(from, to, camera);
    controls.setView(trains.rideYaw, 0);
    await fadeTo(0);
    inVn = false;
    await arrived;
    await fadeTo(1);
    controls.held = false;
    teleport(spawn);
    await fadeTo(0);
  }

  const direct: Record<string, OverlayPreset> = { Digit1: 'off', Digit2: 'vibe', Digit3: 'heavy', Digit4: 'ascii' };
  window.addEventListener('keydown', (e) => {
    if (bench || inVn) return;
    if (trains?.riding) {
      if (e.code === 'KeyE') trains.skip();
      return;
    }
    if (e.code === 'KeyM' || (e.code === 'Escape' && travel.open)) {
      if (travel.open) travel.hide();
      else {
        document.exitPointerLock();
        travel.show(camera.position.x, camera.position.z, lookYaw());
      }
      return;
    }
    if (travel.open) return;
    if (e.code === 'KeyE') void interact();
    if (e.code === 'KeyT') flags.set(FLAG_TIME, TIMES[(TIMES.indexOf(time()) + 1) % TIMES.length]);
    if (e.code === 'KeyR') flags.set(FLAG_WEATHER, WEATHERS[(WEATHERS.indexOf(weather()) + 1) % WEATHERS.length]);
    if (e.code === 'KeyF') controls.fly = !controls.fly;
    if (e.code === 'KeyC') {
      mood.grade = GRADE_NAMES[(GRADE_NAMES.indexOf(mood.grade) + 1) % GRADE_NAMES.length];
      grade.grade = mood.grade;
      panel.refresh();
    }
    if (e.code === 'KeyK') {
      panel.toggle();
      if (panel.open) document.exitPointerLock();
    }
    if (e.code === 'KeyV') overlay.preset = OVERLAY_PRESETS[(OVERLAY_PRESETS.indexOf(overlay.preset) + 1) % OVERLAY_PRESETS.length];
    if (direct[e.code]) overlay.preset = direct[e.code];
    if (e.code === 'KeyG') overlay.dither = !overlay.dither;
    if (e.code === 'KeyB') bloom.enabled = !bloom.enabled;
    if (e.code === 'BracketLeft') bloom.strength = Math.max(0, +(bloom.strength - 0.05).toFixed(2));
    if (e.code === 'BracketRight') bloom.strength = Math.min(2, +(bloom.strength + 0.05).toFixed(2));
    if (e.code === 'Semicolon') bloom.threshold = Math.max(0, +(bloom.threshold - 0.1).toFixed(2));
    if (e.code === 'Quote') bloom.threshold = Math.min(5, +(bloom.threshold + 0.1).toFixed(2));
    if (e.code === 'KeyP') controls.setShearMode(!controls.shearMode);
  });
  document.body.addEventListener('click', () => {
    audio.start();
    if (!bench && !inVn && !travel.open && !panel.open) controls.look.lock();
  });
  controls.look.addEventListener('lock', () => ($('overlay').hidden = true));
  controls.look.addEventListener('unlock', () => ($('overlay').hidden = bench));
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  const px = new Uint8Array(4);

  // Bench: stream along a boulevard through the district at run-to-fly speed, then hold still per preset.
  interface Sample { ms: number; calls: number; tris: number; built: number; t: number }
  const benchLog: { phase: string; samples: Sample[] }[] = [];
  const benchStart = performance.now();
  const PATH_X = 29 * CELL;
  // Up and down the north-south street through the district, turning at its edges.
  const PATH_Z0 = district.bounds.minZ + 12;
  const PATH_SPAN = district.bounds.maxZ - district.bounds.minZ - 24;
  const PATH_SPEED = 30;
  const PATH_S = 30;
  let benchDone = false;
  const benchPhase = (t: number): string | null => {
    if (t < PATH_S) return 'stream';
    if (t < PATH_S + 4) return 'still-vibe';
    if (t < PATH_S + 8) return 'still-plain';
    return null;
  };

  let frames = 0;
  let workSum = 0;
  let windowStart = performance.now();
  let fps = 0;
  let work = 0;
  let builtThisWindow = 0;
  const clock = new THREE.Clock();
  $('overlay').hidden = bench;

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const now = performance.now();
    let phase: string | null = null;
    if (bench) {
      const t = (now - benchStart) / 1000;
      phase = benchPhase(t);
      if (phase === 'stream') {
        const d = (t * PATH_SPEED) % (2 * PATH_SPAN);
        camera.position.set(PATH_X, 1.7, PATH_Z0 + (d < PATH_SPAN ? d : 2 * PATH_SPAN - d));
        controls.setView(d < PATH_SPAN ? 180 : 0, 4);
      } else if (phase) {
        overlay.preset = phase === 'still-plain' ? 'off' : 'vibe';
      } else if (!benchDone) {
        benchDone = true;
        (window as unknown as { __bench: unknown }).__bench = summarize();
      }
    } else if (!inVn) {
      controls.update(dt);
    }
    if (bench) controls.update(0);
    for (const update of landmarkUpdates) update(camera.position, dt);
    trains?.update(dt, camera);
    traffic.update(dt, camera.position);
    // Streets wet through over ~20-60 s of rain (faster when heavy) and dry over a few minutes.
    const wetTarget = mood.wetness ?? (rainAmount > 0 ? 1 : 0);
    const wetRate = mood.wetness !== null ? 2 : wetTarget > wetness ? 0.015 + 0.05 * rainAmount : 0.006;
    wetness += Math.max(-wetRate * dt, Math.min(wetRate * dt, wetTarget - wetness));
    cityU.uWet.value = wetness;
    ssr.wet = wetness;
    ssr.rain = rainAmount;
    cityU.uCarCount.value = traffic.fillLights(camera.position, cityU.uCars.value);
    // Headlights come on with the street lamps (dusk, dawn, night, dark storms).
    cityU.uHeadlights.value = Math.max(atm.lamps, mood.darkness, rainAmount > 0.5 ? 0.6 : 0);
    // Weather cycle: a storm that builds, peaks, eases and clears over six minutes, then again.
    if (mood.cycle && (cycleTick += dt) > 1) {
      cycleTick = 0;
      const c = ((now / 1000) % 360) / 360;
      const env = c < 0.15 ? 0 : c < 0.35 ? (c - 0.15) / 0.2 : c < 0.55 ? 1 : c < 0.85 ? 1 - ((c - 0.55) / 0.3) * 0.85 : Math.max(0, 0.15 - ((c - 0.85) / 0.15) * 0.15);
      mood.rain = env <= 0 ? 0 : 0.08 + 0.9 * env;
      mood.wind = Math.max(0, env - 0.3) * 0.9;
      applyMood();
      if (panel.open) panel.refresh();
    }
    // Wind: a direction and strength with gusts; the rain slants by up to ~3 m sideways per metre of fall.
    const tt = now / 1000;
    const gust = 0.72 + 0.2 * Math.sin(tt * 0.83) + 0.12 * Math.sin(tt * 2.31 + 1.3) + 0.06 * Math.sin(tt * 5.7);
    const blow = mood.wind * gust;
    const wa = (mood.windDir * Math.PI) / 180;
    // The wind turns and builds with a little inertia rather than snapping to the settings.
    windTarget.set(Math.sin(wa), -Math.cos(wa)).multiplyScalar(blow * 3.2);
    windVec.lerp(windTarget, Math.min(1, dt * 1.5));
    const cp = camera.position;
    const lamps = (x: number, z: number, r: number) => district.lampsNear(x, z, r);
    // Riding the train, the car is the shelter.
    const shelters = district.sheltersNear(cp.x, cp.z, 45, 11);
    if (trains?.riding) shelters.unshift({ rect: { x: cp.x - 1.6, y: cp.z - 30, w: 3.2, h: 60 }, y0: 0, y1: 20 });
    rain.update(tt, dt, cp, rainAmount, windVec, shelters);
    rainLayers.update(tt, cp, rainAmount, windVec, wetness, (scene.fog as THREE.Fog).far, base.horizon, shelters);
    streetWater.update(tt, cp, wetness, windVec, district.sheltersNear(cp.x, cp.z, 30, 24));
    district.umbrellas = rainAmount > 0.15;
    // Wet air spreads the glow round lights.
    bloom.radius = 0.45 + 0.35 * Math.min(1, rainAmount + (weather() === 'fog' ? 0.5 : 0));
    const inside = trains?.riding || district.sheltered(cp.x, cp.z, cp.y);
    cones.update(cp, lamps, Math.max(atm.haze, rainAmount * 1.2) * atm.lamps * 0.05 * (1 - 0.3 * mood.darkness));
    lampShadows.update(cp, lamps, atm.lamps * 55);
    skyTime += dt * (1 + mood.wind * 30);
    sky.uniforms.uTime.value = skyTime;
    grade.tick(tt, inside ? 0 : rainAmount * (1 + mood.wind));
    // Lightning in a storm (or on demand): the sky, the clouds and the ambient light flash.
    // Strikes per minute: auto brings them with a real storm (heavy rain and wind).
    const perMinute = mood.lightning === 'storm' ? 6 : mood.lightning === 'occasional' ? 1.2 : mood.lightning === 'auto' && rainAmount > 0.55 && mood.wind > 0.3 ? 1.5 + 6 * rainAmount * mood.wind : 0;
    const flash = lightning.update(dt, perMinute, cp);
    hemi.intensity = base.hemi + flash * 0.5;
    sky.uniforms.uFlash.value = flash;
    sky.uniforms.uFlashDir.value.copy(lightning.dir);
    sky.uniforms.uZenith.value.copy(base.zenith);
    sky.uniforms.uHorizon.value.copy(base.horizon);
    sky.uniforms.uCloudLit.value.copy(base.cloudLit);
    fitFog();
    // Sound follows the same weather: what's overhead, the wind, the nearest cars.
    const cover = trains?.riding ? 'enclosed' : district.shelterAt(cp.x, cp.z, cp.y)?.enclosed ? 'enclosed' : inside ? 'roof' : 'open';
    audio.update({
      dt,
      rain: rainAmount,
      wind: mood.wind,
      gust,
      cover,
      train: !!trains?.riding,
      volume: mood.volume,
      x: cp.x,
      z: cp.z,
      yaw: (lookYaw() * Math.PI) / 180,
      cars: traffic.nearest(cp, 3),
      wet: cityU.uWet.value,
    });

    const t0 = performance.now();
    // Turning worker results into meshes is the only streaming work on the main thread: ~2 ms a frame.
    const built = district.update(camera.position, 2);
    builtThisWindow += built;
    const tUpd = performance.now();
    applyAtmosphere();
    for (const n of nodes) {
      const m = npcMeshes.get(n.id);
      if (m) m.visible = visibleNode(n);
    }
    sky.follow(camera);
    // Keep the shadow frustum centred on the camera, snapped to shadow texels so edges don't crawl.
    const sd = sky.uniforms.uSunDir.value;
    const snap = (220 / 2048) * 4;
    const tx = Math.round(camera.position.x / snap) * snap;
    const tz = Math.round(camera.position.z / snap) * snap;
    sun.target.position.set(tx, 0, tz);
    sun.position.set(tx + sd.x * 400, sd.y * 400, tz + sd.z * 400);
    cityU.uTime.value = now / 1000;
    overlay.setRain(rainAmount * 0.11 * (inside ? 0 : 1), now / 1000);
    renderer.info.reset();
    composer.render(dt);
    if (bench) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const frameMs = performance.now() - t0;
    if (bench && phase && frameMs > 25 && params.get('diag') === '1') console.log(`slow frame ${frameMs.toFixed(1)} ms · update ${(tUpd - t0).toFixed(1)} · render ${(performance.now() - tUpd).toFixed(1)} · integrated ${built} (${(district.lastBytes / 1e6).toFixed(1)} MB) · tris ${renderer.info.render.triangles} · progs ${renderer.info.programs?.length}`);
    if (bench && phase) {
      let log = benchLog.find((l) => l.phase === phase);
      if (!log) benchLog.push((log = { phase, samples: [] }));
      log.samples.push({ ms: frameMs, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, built, t: now });
    }

    frames++;
    workSum += frameMs;
    if (now - windowStart >= 500) {
      fps = Math.round((frames * 1000) / (now - windowStart));
      work = workSum / frames;
      frames = 0;
      workSum = 0;
      windowStart = now;
      const info = renderer.info.render;
      const p = camera.position;
      const t = target();
      const s = district.stats;
      $('hud').textContent = [
        trains?.status ?? `${(district.districtAt(p.x, p.z) ?? style.name).toUpperCase()} · ${district.zoneAt(p.x, p.z) ?? ''}${district.placeAt(p.x, p.z) ? ` · ${district.placeAt(p.x, p.z)}` : ''}  ·  ${time()} / ${weather()}${controls.fly ? '  ·  FLY' : ''}  ·  ascii: ${overlay.preset}  ·  grade: ${grade.grade}${rainAmount > 0 ? `  ·  rain ${rainAmount.toFixed(2)}` : ''}${mood.wind > 0 ? `  ·  wind ${mood.wind.toFixed(2)}` : ''}${mood.darkness > 0 ? `  ·  dark ${mood.darkness.toFixed(2)}` : ''}${mood.shadows ? `  ·  lamp shadows ${mood.shadows}` : ''}${wetness > 0.01 ? `  ·  wet ${wetness.toFixed(2)}` : ''}${mood.dof ? `  ·  dof ${mood.dof.toFixed(2)} @ ${mood.focus === null ? 'auto' : `${mood.focus.toFixed(1)} m`}` : ''}`,
        `${fps} fps · ${work.toFixed(2)} ms/frame · draw calls ${info.calls} · triangles ${info.triangles.toLocaleString()}`,
        `chunks ${district.loaded} loaded (${district.detailedChunks} detailed) / ${district.cells.length} · ${district.loadedBuildings} buildings · ${district.loadedPeople} people`,
        `bloom ${bloom.enabled ? `strength ${bloom.strength.toFixed(2)} · threshold ${bloom.threshold.toFixed(1)}` : 'off'}  ([ ] strength · ; ' threshold · B toggle)`,
        `${district.workerCount} chunk workers · build avg base ${avg(s.base)} / detail ${avg(s.near)} / people ${avg(s.ghosts)} ms · main-thread integrate avg ${avg(s.integrate)} ms (max ${s.integrate.msMax.toFixed(1)}) · in flight ${district.inFlightCount} · integrated last 0.5 s ${builtThisWindow}`,
        `warm start ${warmChunks} chunks in ${warmMs.toFixed(0)} ms`,
        `pos ${p.x.toFixed(0)}, ${p.z.toFixed(0)} · cell ${Math.floor(p.x / CELL)}, ${Math.floor(p.z / CELL)} · GPU ${gpu}`,
        t ? `[E] ${t.kind === 'door' ? 'Enter' : t.kind === 'station' ? (isRailStation(t.placementId) ? 'Take the train' : 'Take the elevator') : t.kind === 'hotspot' ? 'Look' : 'Talk'}: ${t.name ?? t.id}` : ' ',
        'click to look · WASD · Shift run · E interact · M map / fast travel · T time · R weather · K weather & light panel · C grade · F fly · V ascii (1 off 2 vibe 3 heavy 4 full) · G dither · B bloom · P look',
      ].join('\n');
      builtThisWindow = 0;
    }
  });

  function summarize(): unknown {
    const stat = (xs: number[]): { avg: number; p95: number; max: number } => {
      const s = [...xs].sort((a, c) => a - c);
      return { avg: +(s.reduce((a, c) => a + c, 0) / s.length).toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2) };
    };
    const s = district.stats;
    return {
      gpu,
      viewport: `${renderer.domElement.width}x${renderer.domElement.height}`,
      districtCells: district.cells.length,
      warmStart: { chunks: warmChunks, ms: +warmMs.toFixed(1) },
      chunkGen: { count: s.base.count, avgMs: +avg(s.base), maxMs: +s.base.msMax.toFixed(2), disposed: s.disposed },
      detailGen: { count: s.near.count, avgMs: +avg(s.near), maxMs: +s.near.msMax.toFixed(2) },
      mainThread: {
        count: s.integrate.count,
        avgMs: avg(s.integrate),
        maxMs: s.integrate.msMax.toFixed(2),
        workerAvg: `${avg(s.base)} / ${avg(s.near)} / ${avg(s.ghosts)} ms in ${district.workerCount} workers`,
      },
      phases: benchLog.map((l) => ({
        phase: l.phase,
        frames: l.samples.length,
        firstFramesMaxMs: +Math.max(...l.samples.slice(0, 5).map((x) => x.ms)).toFixed(2),
        frameMs: stat(l.samples.slice(5).map((x) => x.ms)),
        // Delivered frame rate (wall clock between frames, not just our work) and hitches.
        fps: +((l.samples.length - 1) / ((l.samples[l.samples.length - 1].t - l.samples[0].t) / 1000)).toFixed(1),
        intervalMax: +Math.max(...l.samples.slice(5).map((x, i, a) => (i > 0 ? x.t - a[i - 1].t : 0))).toFixed(1),
        over33: l.samples.slice(5).filter((x) => x.ms > 33).length,
        over16: l.samples.slice(5).filter((x) => x.ms > 16.7).length,
        framesWithChunkBuild: l.samples.filter((x) => x.built > 0).length,
        chunkBuildFrameMs: l.samples.some((x) => x.built > 0) ? stat(l.samples.filter((x) => x.built > 0).map((x) => x.ms)) : null,
        avgCalls: Math.round(l.samples.reduce((a, x) => a + x.calls, 0) / l.samples.length),
        avgTriangles: Math.round(l.samples.reduce((a, x) => a + x.tris, 0) / l.samples.length),
      })),
      loadedAtEnd: { chunks: district.loaded, buildings: district.loadedBuildings, triangles: district.loadedTriangles },
    };
  }
}

/** Bar entrance: wooden frame, warm glass door, a noren curtain and two red paper lanterns. */
function dressDoor(mb: MeshBuilder, n: Node3, r: C3, nn: C3): void {
  const o: C3 = [n.x, 0, n.z];
  mb.style = [0, 0, 0, 0];
  mb.kind = KIND.plain;
  mb.color = lin(0x3a2616);
  mb.frameBox(o, r, nn, -0.85, -0.7, 0, 2.6, 0, 0.14);
  mb.frameBox(o, r, nn, 0.7, 0.85, 0, 2.6, 0, 0.14);
  mb.frameBox(o, r, nn, -0.85, 0.85, 2.45, 2.6, 0, 0.14);
  // Sliding wooden door with a warm frosted-glass panel.
  mb.color = lin(0x4a3020);
  mb.frameBox(o, r, nn, -0.7, 0.7, 0, 2.45, 0, 0.04);
  mb.kind = KIND.emit;
  mb.style = [EMIT.always, 0, 0, 0];
  mb.color = [0.32, 0.16, 0.06];
  for (const u of [-0.6, 0.08]) mb.frameBox(o, r, nn, u, u + 0.52, 0.9, 2.2, 0.04, 0.05);
  // Noren: three indigo panels hanging from a rod.
  mb.kind = KIND.plain;
  mb.style = [0, 0, 0, 0];
  mb.color = lin(0x1c2a52);
  for (let i = 0; i < 3; i++) {
    const u0 = -0.72 + i * 0.49;
    mb.frameBox(o, r, nn, u0, u0 + 0.46, 1.55, 2.4, 0.2, 0.23);
  }
  mb.color = lin(0x2a1a10);
  mb.frameBox(o, r, nn, -0.8, 0.8, 2.4, 2.45, 0.19, 0.24);
  // Lanterns.
  for (const u of [-1.25, 1.25]) {
    const c: C3 = [o[0] + r[0] * u + nn[0] * 0.4, 0, o[2] + r[2] * u + nn[2] * 0.4];
    mb.kind = KIND.emit;
    mb.style = [EMIT.neon, 0, 0, 0];
    mb.color = [0.5, 0.045, 0.015];
    mb.cylinder(c[0], c[2], 2.0, 2.55, 0.2, 10);
    mb.kind = KIND.plain;
    mb.style = [0, 0, 0, 0];
    mb.color = lin(0x151515);
    mb.cylinder(c[0], c[2], 1.95, 2.0, 0.16, 8);
    mb.cylinder(c[0], c[2], 2.55, 2.62, 0.16, 8);
  }
}

/** The bar's NPCs as ghosts: Mama-san talking at the door, the detective hands in pockets under his hat. */
function npcSpec(n: Node3, facing: C3): FigureSpec {
  const detective = n.id.endsWith('detective');
  const yaw = Math.atan2(facing[0], facing[2]);
  const f = n.figure;
  if (f) {
    const c = f.color ?? 0x60c0ff;
    return {
      x: n.x,
      z: n.z,
      yaw: yaw + (f.turn ?? 0),
      body: f.body ?? 'woman',
      pose: f.pose ?? 'stand',
      color: [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255],
      hair: f.hair ?? 'short',
      long: f.long ?? false,
      phase: 0,
      side: 1,
      look: 0,
    };
  }
  return {
    x: n.x,
    z: n.z,
    yaw: detective ? yaw - 0.5 : yaw + 0.4,
    body: detective ? 'man' : 'woman',
    pose: detective ? 'pockets' : 'talk',
    color: detective ? [0.9, 0.82, 0.62] : [1.0, 0.42, 0.72],
    hair: detective ? 'hat' : 'bun',
    long: true,
    phase: 0,
    side: 1,
    look: detective ? -0.4 : 0.3,
  };
}

const avg = (s: { count: number; msTotal: number }): string => (s.msTotal / Math.max(1, s.count)).toFixed(2);

run().catch((e: unknown) => {
  const pre = $('errors');
  pre.hidden = false;
  pre.textContent = e instanceof ContentError ? e.message : String((e as Error).stack ?? e);
  throw e;
});
