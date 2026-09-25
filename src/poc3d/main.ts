import * as THREE from 'three';
import { AsciiEffect } from 'three/examples/jsm/effects/AsciiEffect.js';
import { AsciiShaderPass } from './asciiPass';
import { buildGrid, buildingMaterial, buildTestBlock } from './block';
import { FirstPerson } from './controls';

/**
 * 3D rendering proof of concept. Three render modes to compare:
 *   1 webgl  - plain three.js render (baseline)
 *   2 shader - custom GPU ASCII pass (asciiPass.ts)
 *   3 dom    - three's built-in AsciiEffect (CPU readback -> HTML text)
 * URL: ?grid=2000 adds procedural buildings, &merge=1 merges them per 200 m chunk,
 *      ?bench=1 runs a scripted walk through every mode and publishes window.__bench.
 */
type Mode = 'webgl' | 'shader' | 'dom';

const params = new URLSearchParams(location.search);
const gridCount = Number(params.get('grid') ?? 0);
const merged = params.get('merge') === '1';
const bench = params.get('bench') === '1';

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const hud = $('hud');
const overlay = $('overlay');

const BG = new THREE.Color(0x040508);
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = BG;
scene.fog = new THREE.Fog(BG, 40, 650);
scene.add(new THREE.HemisphereLight(0x7080a8, 0x15151a, 0.6));
const moon = new THREE.DirectionalLight(0xa8b8ff, 1.8);
moon.position.set(120, 200, 60);
scene.add(moon);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2000);
const facade = { uWindowLit: { value: 0.35 } };
const material = buildingMaterial(facade);
const colliders = buildTestBlock(scene, material, params.get('scene') === 'downtown');
const extra = gridCount > 0 ? buildGrid(scene, material, gridCount, merged) : 0;
const controls = new FirstPerson(camera, document.body, colliders);
// Review shortcut: ?cam=x,y,z,yawDeg,pitchDeg sets the starting view (e.g. for comparable screenshots).
const cam = params.get('cam')?.split(',').map(Number);
if (cam && cam.length === 5 && cam.every(Number.isFinite)) {
  camera.position.set(cam[0], cam[1], cam[2]);
  controls.setView(cam[3], cam[4]);
}

let cellW = 8;
let color = true;
let edges = true;
const shader = new AsciiShaderPass(renderer, cellW, Math.round(cellW * 1.75), BG);

let dom: AsciiEffect | null = null;
let domColor = false;
function ensureDom(): AsciiEffect {
  if (dom && domColor === color) return dom;
  dom?.domElement.remove();
  domColor = color;
  dom = new AsciiEffect(renderer, ' .:-=+*#%@', { invert: true, color, resolution: 0.15 });
  dom.setSize(window.innerWidth, window.innerHeight);
  Object.assign(dom.domElement.style, { position: 'fixed', inset: '0', color: '#8fd8b0', backgroundColor: '#0b1020' });
  document.body.prepend(dom.domElement);
  return dom;
}

let mode: Mode = 'shader';
function setMode(m: Mode): void {
  mode = m;
  renderer.domElement.style.display = m === 'dom' ? 'none' : 'block';
  if (m === 'dom') ensureDom().domElement.style.display = 'block';
  else if (dom) dom.domElement.style.display = 'none';
}
setMode('shader');

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  shader.resize();
  dom?.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('keydown', (e) => {
  if (bench) return;
  if (e.code === 'Digit1') setMode('webgl');
  if (e.code === 'Digit2') setMode('shader');
  if (e.code === 'Digit3') setMode('dom');
  if (e.code === 'KeyE') shader.edges = edges = !edges;
  // Stand-in for the atmosphere lookup's per-(district, time) lit-window fraction.
  if (e.code === 'KeyP') controls.setShearMode(!controls.shearMode);
  if (e.code === 'KeyN') facade.uWindowLit.value = [0.12, 0.35, 0.65][([0.12, 0.35, 0.65].indexOf(facade.uWindowLit.value) + 1) % 3];
  if (e.code === 'KeyC') {
    color = !color;
    shader.color = color;
    if (mode === 'dom') setMode('dom');
  }
  if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
    cellW = Math.max(4, Math.min(20, cellW + (e.code === 'BracketLeft' ? -1 : 1)));
    shader.setCell(cellW, Math.round(cellW * 1.75));
  }
});
document.body.addEventListener('click', () => !bench && controls.look.lock());
controls.look.addEventListener('lock', () => (overlay.hidden = true));
controls.look.addEventListener('unlock', () => (overlay.hidden = bench));

const gl = renderer.getContext();
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown';
const px = new Uint8Array(4);

function renderFrame(): void {
  renderer.info.reset();
  if (mode === 'webgl') renderer.render(scene, camera);
  else if (mode === 'shader') shader.render(scene, camera);
  else ensureDom().render(scene, camera);
}

// Stats over a rolling window. "work" = CPU time in our render call; in bench mode it also waits for
// the GPU (1-pixel readback) so it approximates the true per-frame cost independent of vsync.
let frames = 0;
let workSum = 0;
let windowStart = performance.now();
let fps = 0;
let work = 0;

// --- Bench -------------------------------------------------------------------------------------------
interface BenchStep {
  mode: Mode;
  color: boolean;
}
interface BenchResult extends BenchStep {
  fps: number;
  workMs: number;
  p95Ms: number;
  calls: number;
  triangles: number;
}
const steps: BenchStep[] = [
  { mode: 'webgl', color: true },
  { mode: 'shader', color: true },
  { mode: 'dom', color: false },
  ...(gridCount === 0 ? [{ mode: 'dom' as const, color: true }] : []),
];
const WARM = 700;
const MEASURE = 3000;
const results: BenchResult[] = [];
let stepIdx = 0;
let stepStart = 0;
let stepFrames = 0;
let stepWork: number[] = [];

function benchCamera(t: number): void {
  // Walk down the street toward the towers with a slow look-around.
  const u = Math.min(1, t / MEASURE);
  camera.position.set(Math.sin(u * 6) * 2, 1.7, 38 - u * 76);
  camera.quaternion.setFromEuler(new THREE.Euler(0.06, Math.sin(u * 4) * 0.6, 0, 'YXZ'));
}

function benchStep(now: number, frameWork: number): void {
  if (stepIdx >= steps.length) return;
  const s = steps[stepIdx];
  if (stepStart === 0) {
    color = s.color;
    shader.color = color;
    setMode(s.mode);
    stepStart = now;
    stepFrames = 0;
    stepWork = [];
  }
  const t = now - stepStart - WARM;
  benchCamera(Math.max(0, t));
  if (t < 0) return;
  stepFrames++;
  stepWork.push(frameWork);
  if (t >= MEASURE) {
    const sorted = [...stepWork].sort((a, b) => a - b);
    results.push({
      ...s,
      fps: Math.round((stepFrames * 1000) / t),
      workMs: +(stepWork.reduce((a, b) => a + b, 0) / stepWork.length).toFixed(2),
      p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    });
    stepIdx++;
    stepStart = 0;
    if (stepIdx >= steps.length) {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      (window as unknown as { __bench: unknown }).__bench = {
        gpu, grid: gridCount, extraBuildings: extra, merged, viewport: `${size.x}x${size.y}`, cells: `${shader.cols}x${shader.rows}`, results,
      };
    }
  }
}

// --- Loop --------------------------------------------------------------------------------------------
const clock = new THREE.Clock();
overlay.hidden = bench;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!bench) controls.update(dt);
  const t0 = performance.now();
  renderFrame();
  if (bench && mode !== 'dom') gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const frameWork = performance.now() - t0;
  const now = performance.now();
  if (bench) benchStep(now, frameWork);
  frames++;
  workSum += frameWork;
  if (now - windowStart >= 500) {
    fps = Math.round((frames * 1000) / (now - windowStart));
    work = workSum / frames;
    frames = 0;
    workSum = 0;
    windowStart = now;
    const info = renderer.info.render;
    hud.textContent = [
      `mode ${mode}${mode === 'webgl' ? '' : color ? ' · colour' : ' · mono'}  ·  ${fps} fps  ·  ${work.toFixed(2)} ms/frame (CPU${bench ? '+GPU' : ''})`,
      `draw calls ${info.calls} · triangles ${info.triangles.toLocaleString()} · buildings ${6 + 4 + extra}${merged ? ' (merged per chunk)' : ''}`,
      mode === 'shader' ? `ascii grid ${shader.cols}x${shader.rows} cells of ${cellW}x${Math.round(cellW * 1.75)} px · edges ${edges ? 'on' : 'off'}` : ' ',
      `windows lit ${Math.round(facade.uWindowLit.value * 100)}%  ·  GPU: ${gpu}  ·  pos ${camera.position.x.toFixed(1)}, ${camera.position.z.toFixed(1)}`,
      bench ? `bench: step ${Math.min(stepIdx + 1, steps.length)}/${steps.length}${stepIdx >= steps.length ? ' — done' : ''}` : 'click to look · WASD move · Shift run · 1 webgl · 2 ascii shader · 3 AsciiEffect · C colour · E edges · N lit windows · P look: shift/pitch · [ ] cell size · Esc release',
    ].join('\n');
  }
});
