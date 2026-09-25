import * as THREE from 'three';
import { FlagStore } from '../../core/flags';
import { ContentError } from '../../content/load';
import { FLAG_TIME, FLAG_WEATHER, TIMES, WEATHERS, type TimeOfDay, type Weather } from '../../atmosphere/rules';
import { PlaceholderVnBridge } from '../../game/bridge';
import { AsciiShaderPass } from '../asciiPass';
import { buildingMaterial } from '../block';
import { FirstPerson } from '../controls';
import type { Atmosphere3 } from './atmosphere';
import { loadDistrictContent } from './content';
import { CELL, STYLES3 } from './plan';
import { drawSigns, SIGN_RANGE } from './signs';
import type { Node3 } from './stamps';
import { District } from './world';

/**
 * Kaburo (Neon Core), generated at full scale from the L0 map and streamed in chunks.
 * URL: ?time=night|day|dusk|dawn &weather=clear|rain|fog &cam=x,y,z,yaw,pitch &bench=1
 * Keys: WASD/mouse, Shift run, E interact, T time, R weather, F fly, 1 webgl / 2 ascii, C colour, P look mode.
 */
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
const bench = params.get('bench') === '1';
const START_SPAWN = 'bar_kanpai.out';
const SEED = 0x0c179090;

function run(): void {
  const content = loadDistrictContent();
  const flags = new FlagStore({ [FLAG_TIME]: params.get('time') ?? 'night', [FLAG_WEATHER]: params.get('weather') ?? 'clear' });
  const time = (): TimeOfDay => flags.get(FLAG_TIME) as TimeOfDay;
  const weather = (): Weather => flags.get(FLAG_WEATHER) as Weather;

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.info.autoReset = false;
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 60, 620);
  const hemi = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  sun.position.set(120, 200, 60);
  scene.add(hemi, sun);
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1200);

  const facade = { uWindowLit: { value: 0.4 } };
  const style = STYLES3.neon!;
  const district = new District(content.macro, 'neon', content.placed, buildingMaterial(facade), new THREE.MeshLambertMaterial({ vertexColors: true }), SEED);
  scene.add(district.root);

  // Every character any sign can show gets an atlas slot (CJK as two).
  const signText = [...style.signWords, ...content.placed.flatMap((p) => p.stamp.signs.map((s) => s.text))].join('');
  const ascii = new AsciiShaderPass(renderer, 8, 14, new THREE.Color(0x000000), signText);

  // Stamp props: a lit door and simple figures for NPCs (visibility follows their conditions).
  const nodes = district.nodes;
  const npcMeshes = new Map<string, THREE.Object3D>();
  for (const n of nodes) {
    if (n.kind === 'door') {
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 0.3), new THREE.MeshBasicMaterial({ color: 0xe8b04a }));
      door.position.set(n.x, 1.2, n.z);
      scene.add(door);
    } else if (n.kind === 'npc') {
      const fig = new THREE.Group();
      const color = n.id.endsWith('detective') ? 0x8a8478 : 0xd9608a;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 1.35, 10), new THREE.MeshLambertMaterial({ color }));
      body.position.y = 0.68;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshLambertMaterial({ color: 0xe8c8a8 }));
      head.position.y = 1.55;
      fig.add(body, head);
      fig.position.set(n.x, 0.15, n.z);
      scene.add(fig);
      npcMeshes.set(n.id, fig);
    }
  }
  const visibleNode = (n: Node3): boolean => n.condition === null || n.condition(flags.get);
  const npcBlocked = (x: number, z: number, r: number): boolean =>
    nodes.some((n) => n.kind === 'npc' && visibleNode(n) && Math.hypot(n.x - x, n.z - z) < r + 0.35);

  const controls = new FirstPerson(camera, document.body, (x, z, r) => district.blocked(x, z, r) || npcBlocked(x, z, r));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const YAW: Record<string, number> = { north: 0, south: 180, east: -90, west: 90 };
  const teleport = (id: string): void => {
    const n = nodeById.get(id)!;
    camera.position.set(n.x, 1.7, n.z);
    controls.setView(YAW[n.facing ?? 'north'], 8);
  };
  teleport(START_SPAWN);
  const cam = params.get('cam')?.split(',').map(Number);
  if (cam && cam.length === 5 && cam.every(Number.isFinite)) {
    camera.position.set(cam[0], cam[1], cam[2]);
    controls.setView(cam[3], cam[4]);
  }

  // Warm start: build the neighbourhood synchronously so the first frame isn't empty.
  const warm0 = performance.now();
  district.update(camera.position, Infinity);
  const warmMs = performance.now() - warm0;
  const warmChunks = district.loaded;

  // Atmosphere: re-applied whenever (district, time, weather) changes.
  let atm!: Atmosphere3;
  let atmKey = '';
  const applyAtmosphere = (): void => {
    const key = `${time()}|${weather()}`;
    if (key === atmKey) return;
    atmKey = key;
    atm = content.atmosphere.resolve('neon', time(), weather());
    (scene.background as THREE.Color).setHex(atm.sky);
    const fog = scene.fog as THREE.Fog;
    fog.color.setHex(atm.fog);
    fog.near = atm.fogNear;
    fog.far = atm.fogFar;
    hemi.color.setHex(atm.hemiSky);
    hemi.groundColor.setHex(atm.hemiGround);
    hemi.intensity = atm.hemi;
    sun.color.setHex(atm.sunColor);
    sun.intensity = atm.sun;
    facade.uWindowLit.value = atm.windowLit;
    ascii.setBackground(atm.sky);
  };
  applyAtmosphere();

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

  let mode: 'webgl' | 'ascii' = 'ascii';
  let color = true;
  window.addEventListener('keydown', (e) => {
    if (bench || inVn) return;
    if (e.code === 'KeyE') void interact();
    if (e.code === 'KeyT') flags.set(FLAG_TIME, TIMES[(TIMES.indexOf(time()) + 1) % TIMES.length]);
    if (e.code === 'KeyR') flags.set(FLAG_WEATHER, WEATHERS[(WEATHERS.indexOf(weather()) + 1) % WEATHERS.length]);
    if (e.code === 'KeyF') controls.fly = !controls.fly;
    if (e.code === 'Digit1') mode = 'webgl';
    if (e.code === 'Digit2') mode = 'ascii';
    if (e.code === 'KeyC') ascii.color = color = !color;
    if (e.code === 'KeyP') controls.setShearMode(!controls.shearMode);
  });
  document.body.addEventListener('click', () => !bench && !inVn && controls.look.lock());
  controls.look.addEventListener('lock', () => ($('overlay').hidden = true));
  controls.look.addEventListener('unlock', () => ($('overlay').hidden = bench));
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    renderer.setSize(window.innerWidth, window.innerHeight);
    ascii.resize();
  });

  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  const px = new Uint8Array(4);

  // Bench: stream along a boulevard through the district at run-to-fly speed, then hold still per mode.
  interface Sample { ms: number; calls: number; tris: number; built: number }
  const benchLog: { phase: string; samples: Sample[] }[] = [];
  const benchStart = performance.now();
  const PATH_X = 29 * CELL;
  const PATH_Z0 = 8 * CELL + 20;
  const PATH_SPEED = 30;
  const PATH_S = 30;
  let benchDone = false;
  const benchPhase = (t: number): string | null => {
    if (t < PATH_S) return 'stream';
    if (t < PATH_S + 4) return 'still-ascii';
    if (t < PATH_S + 8) return 'still-webgl';
    return null;
  };

  let frames = 0;
  let workSum = 0;
  let windowStart = performance.now();
  let fps = 0;
  let work = 0;
  let signsDrawn = 0;
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
        camera.position.set(PATH_X, 1.7, PATH_Z0 + t * PATH_SPEED);
        controls.setView(180, 10);
      } else if (phase) {
        mode = phase === 'still-webgl' ? 'webgl' : 'ascii';
      } else if (!benchDone) {
        benchDone = true;
        (window as unknown as { __bench: unknown }).__bench = summarize();
      }
    } else if (!inVn) {
      controls.update(dt);
    }
    if (bench) controls.update(0);

    const t0 = performance.now();
    const built = district.update(camera.position, 4);
    builtThisWindow += built;
    applyAtmosphere();
    for (const n of nodes) {
      const m = npcMeshes.get(n.id);
      if (m) m.visible = visibleNode(n);
    }
    renderer.info.reset();
    if (mode === 'ascii') {
      signsDrawn = drawSigns(ascii, camera, district.signsNear(camera.position.x, camera.position.z, SIGN_RANGE), atm, now);
      ascii.setRain(atm.rain, now / 1000);
      ascii.render(scene, camera);
    } else {
      renderer.render(scene, camera);
    }
    if (bench) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const frameMs = performance.now() - t0;
    if (bench && phase) {
      let log = benchLog.find((l) => l.phase === phase);
      if (!log) benchLog.push((log = { phase, samples: [] }));
      log.samples.push({ ms: frameMs, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, built });
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
      const avgGen = district.stats.generated ? district.stats.genMsTotal / district.stats.generated : 0;
      $('hud').textContent = [
        `KABURO · ${style.name} (Neon Core)  ·  ${time()} / ${weather()}${controls.fly ? '  ·  FLY' : ''}  ·  ${mode}`,
        `${fps} fps · ${work.toFixed(2)} ms/frame · draw calls ${info.calls} · triangles ${info.triangles.toLocaleString()}`,
        `chunks ${district.loaded} loaded / ${district.cells.length} in district · ${district.loadedBuildings} buildings loaded · signs drawn ${signsDrawn}`,
        `chunk gen avg ${avgGen.toFixed(1)} ms · max ${district.stats.genMsMax.toFixed(1)} ms · warm start ${warmChunks} chunks in ${warmMs.toFixed(0)} ms · built last 0.5 s ${builtThisWindow}`,
        `pos ${p.x.toFixed(0)}, ${p.z.toFixed(0)} · cell ${Math.floor(p.x / CELL)}, ${Math.floor(p.z / CELL)} · GPU ${gpu}`,
        t ? `[E] ${t.kind === 'door' ? 'Enter' : 'Talk'}: ${t.name ?? t.id}` : ' ',
        'click to look · WASD · Shift run · E interact · T time · R weather · F fly · 1 webgl · 2 ascii · C colour · P look',
      ].join('\n');
      builtThisWindow = 0;
    }
  });

  function summarize(): unknown {
    const stat = (xs: number[]): { avg: number; p95: number; max: number } => {
      const s = [...xs].sort((a, b) => a - b);
      return { avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2) };
    };
    return {
      gpu,
      viewport: `${renderer.domElement.width}x${renderer.domElement.height}`,
      cells: `${ascii.cols}x${ascii.rows}`,
      districtCells: district.cells.length,
      warmStart: { chunks: warmChunks, ms: +warmMs.toFixed(1) },
      chunkGen: { count: district.stats.generated, avgMs: +(district.stats.genMsTotal / district.stats.generated).toFixed(2), maxMs: +district.stats.genMsMax.toFixed(2), disposed: district.stats.disposed },
      // The first frames of a phase include one-off shader compiles (e.g. the first plain-WebGL frame needs
      // screen-output program variants); reported separately from steady-state frames.
      phases: benchLog.map((l) => ({
        phase: l.phase,
        frames: l.samples.length,
        firstFramesMaxMs: +Math.max(...l.samples.slice(0, 5).map((s) => s.ms)).toFixed(2),
        frameMs: stat(l.samples.slice(5).map((s) => s.ms)),
        framesWithChunkBuild: l.samples.filter((s) => s.built > 0).length,
        chunkBuildFrameMs: l.samples.some((s) => s.built > 0) ? stat(l.samples.filter((s) => s.built > 0).map((s) => s.ms)) : null,
        avgCalls: Math.round(l.samples.reduce((a, s) => a + s.calls, 0) / l.samples.length),
        avgTriangles: Math.round(l.samples.reduce((a, s) => a + s.tris, 0) / l.samples.length),
      })),
      loadedAtEnd: { chunks: district.loaded, buildings: district.loadedBuildings, triangles: district.loadedTriangles },
    };
  }
}

try {
  run();
} catch (e) {
  const pre = $('errors');
  pre.hidden = false;
  pre.textContent = e instanceof ContentError ? e.message : String((e as Error).stack ?? e);
  throw e;
}
