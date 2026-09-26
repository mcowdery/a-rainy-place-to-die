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
import { CELL, STYLES3 } from './plan';
import type { Node3 } from './stamps';
import { District } from './world';

/**
 * Kaburo (Neon Core), generated at full scale from the L0 map and streamed in chunks, rendered
 * realistically with an ASCII overlay for mood (see real/overlay.ts).
 * URL: ?time=night|day|dusk|dawn &weather=clear|rain|fog &cam=x,y,z,yaw,pitch &spawn=<node id> &ascii=vibe|heavy|ascii|off &bench=1
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
  const district = new District(content.macro, 'neon', content.placed, SEED, content.zones);
  const words = content.zones.words(style.signWords);
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
  composer.addPass(overlay);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

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
  for (const placed of content.placed) {
    const lm = placed.stamp.landmark;
    if (lm === 'mega_sign') {
      const mega = buildMegaSign(cityU, city);
      mega.group.position.set(placed.building.x, 0, placed.building.z);
      scene.add(mega.group);
    } else if (lm === 'konbini') {
      const k = buildKonbini(placed.building, city, ghost);
      scene.add(k.group);
      landmarkUpdates.push(k.update);
    } else if (lm === 'shrine') {
      scene.add(buildShrine(placed.building, city));
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

  const controls = new FirstPerson(camera, document.body, (x, z, r, floor) => district.blocked(x, z, r, floor) || (floor ?? 0) > -1 && npcBlocked(x, z, r));
  controls.setShearMode(false);
  controls.fly = params.get('fly') === '1';
  controls.floorAt = district.floorAt;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const YAW: Record<string, number> = { north: 0, south: 180, east: -90, west: 90 };
  const teleport = (id: string): void => {
    const n = nodeById.get(id)!;
    camera.position.set(n.x, district.floorAt(n.x, n.z) + 1.7, n.z);
    if (n.view) controls.setView(n.view[0], n.view[1]);
    else controls.setView(YAW[n.facing ?? 'north'], 4);
  };
  // Fast travel: M opens a map of the district's places and zones.
  const lookYaw = (): number => {
    const d = camera.getWorldDirection(new THREE.Vector3());
    return (Math.atan2(-d.x, -d.z) * 180) / Math.PI;
  };
  const travel = new TravelMap(district, content.zones, destinations(district, nodes, content.zones), (d: Destination) => {
    camera.position.set(d.x, controls.fly ? Math.max(camera.position.y, 1.7) : district.floorAt(d.x, d.z) + 1.7, d.z);
    controls.setView(d.yaw, d.pitch);
    travel.hide();
    controls.look.lock();
  });
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
    cityU.uZenith.value.setHex(atm.sky);
    cityU.uHorizon.value.setHex(atm.horizon);
    cityU.uRoomAmbient.value.setHex(atm.hemiSky).multiplyScalar(atm.hemi * 0.12);
    cityU.uWindowLit.value = atm.windowLit;
    cityU.uLamps.value = atm.lamps;
    cityU.uLightGain.value = 1.4 * atm.lamps;
    cityU.uNeon.value = atm.neon === 'off' ? 0 : 1;
    cityU.uFlicker.value = atm.neon === 'flicker' ? 1 : 0;
    cityU.uWet.value = atm.rain > 0 ? 1 : 0;
    renderer.toneMappingExposure = atm.exposure;
    overlay.setFog(atm.fogNear, atm.fogFar, fog.color);
  };
  applyAtmosphere();
  // Compile every shader variant and upload the warm-start geometry now, rather than in the first frames.
  await renderer.compileAsync(scene, camera);
  composer.render(0);
  $('overlay').textContent = 'click to walk';

  // Interaction: nearest visible interactable within reach, roughly in front of you.
  const bridge = new PlaceholderVnBridge($('vn'));
  let inVn = false;
  const forward = new THREE.Vector3();
  const target = (): Node3 | null => {
    camera.getWorldDirection(forward);
    let best: Node3 | null = null;
    let bestD = 3.2;
    for (const n of nodes) {
      if (n.trigger !== 'interact' || !visibleNode(n)) continue;
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
    inVn = true;
    document.exitPointerLock();
    const result = await bridge.enter(n);
    const spawn = result.returnSpawn ?? n.returnSpawn;
    if (spawn) teleport(spawn);
    inVn = false;
  };

  const direct: Record<string, OverlayPreset> = { Digit1: 'off', Digit2: 'vibe', Digit3: 'heavy', Digit4: 'ascii' };
  window.addEventListener('keydown', (e) => {
    if (bench || inVn) return;
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
  document.body.addEventListener('click', () => !bench && !inVn && !travel.open && controls.look.lock());
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
    overlay.setRain(atm.rain, now / 1000);
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
        `KABURO · ${district.zoneAt(p.x, p.z) ?? style.name}${district.placeAt(p.x, p.z) ? ` · ${district.placeAt(p.x, p.z)}` : ''} (Neon Core)  ·  ${time()} / ${weather()}${controls.fly ? '  ·  FLY' : ''}  ·  ascii: ${overlay.preset}`,
        `${fps} fps · ${work.toFixed(2)} ms/frame · draw calls ${info.calls} · triangles ${info.triangles.toLocaleString()}`,
        `chunks ${district.loaded} loaded (${district.detailedChunks} detailed) / ${district.cells.length} · ${district.loadedBuildings} buildings · ${district.loadedPeople} people`,
        `bloom ${bloom.enabled ? `strength ${bloom.strength.toFixed(2)} · threshold ${bloom.threshold.toFixed(1)}` : 'off'}  ([ ] strength · ; ' threshold · B toggle)`,
        `${district.workerCount} chunk workers · build avg base ${avg(s.base)} / detail ${avg(s.near)} / people ${avg(s.ghosts)} ms · main-thread integrate avg ${avg(s.integrate)} ms (max ${s.integrate.msMax.toFixed(1)}) · in flight ${district.inFlightCount} · integrated last 0.5 s ${builtThisWindow}`,
        `warm start ${warmChunks} chunks in ${warmMs.toFixed(0)} ms`,
        `pos ${p.x.toFixed(0)}, ${p.z.toFixed(0)} · cell ${Math.floor(p.x / CELL)}, ${Math.floor(p.z / CELL)} · GPU ${gpu}`,
        t ? `[E] ${t.kind === 'door' ? 'Enter' : 'Talk'}: ${t.name ?? t.id}` : ' ',
        'click to look · WASD · Shift run · E interact · M map / fast travel · T time · R weather · F fly · V ascii (1 off 2 vibe 3 heavy 4 full) · G dither · B bloom · P look',
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
