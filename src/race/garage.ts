import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { CarType } from '../poc3d/models/vehicles';
import { cityMaterial, cityUniforms } from '../poc3d/real/city';
import { BANNERS, model, MODELS, NEON, PAINT_PALETTE, PARTS, PRICES, stats, tunedSpec, type Parts, type Stats } from './catalog';
import { buildCar, type CarView, type Look } from './carView';
import { buildGarage } from './garageScene';
import { buyCar, currentCar, loadProfile, saveProfile, spend, yen, type Livery, type OwnedCar } from './profile';

/**
 * The garage (garage.html): your cars in a railway-arch shutter unit. Orbit round the car (drag, wheel). The
 * panel: your cars and the dealer's (buy, drive), tuning parts (each a level up at a time, the stat bars
 * showing what it does), paint, livery (racing stripes, a side stripe, a door number, a windscreen banner) and
 * neon underglow. Changes are previewed on the car and paid for when applied. Everything is kept in the
 * browser (profile.ts), and the race page drives the car you picked. ?yen= sets your money (for testing).
 */

const params = new URLSearchParams(location.search);
const profile = loadProfile();
if (params.has('yen')) profile.yen = Number(params.get('yen'));
saveProfile(profile);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.FogExp2(0x05060a, 0.03);
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(4.2, 1.7, 5.4);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.6, 0);
controls.enableDamping = true;
controls.minDistance = 3;
controls.maxDistance = 8.5;
controls.maxPolarAngle = Math.PI * 0.49;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.4;
controls.addEventListener('start', () => (controls.autoRotate = false));
const garage = buildGarage();
scene.add(garage.group);
const cityU = cityUniforms();
cityU.uLightGain.value = 0;
cityU.uLamps.value = 1;
const carMat = cityMaterial(cityU);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.5, 1.2));
composer.addPass(new OutputPass());

// ---- What's on the floor: your car as it is, or with the change you're looking at (a draft), or a dealer's car.
type Tab = 'cars' | 'tuning' | 'paint' | 'livery' | 'neon';
let tab: Tab = 'cars';
/** A dealer's car you're looking at (not yours yet). */
let viewing: CarType | null = null;
/** Changes being previewed on your car. */
let draft: { paint?: number; paint2?: number | null; livery?: Livery; neon?: number | null } = {};
let shown: CarView | null = null;

const lookOf = (c: OwnedCar): Look => ({
  type: c.type,
  paint: draft.paint ?? c.paint,
  paint2: draft.paint2 !== undefined ? draft.paint2 : c.paint2,
  livery: draft.livery ?? c.livery,
  neon: draft.neon !== undefined ? draft.neon : c.neonFitted ? c.neon : null,
});

function showCar(): void {
  if (shown) scene.remove(shown.obj);
  const c = currentCar(profile);
  const look: Look = viewing ? { type: viewing, paint: model(viewing).paint, paint2: model(viewing).paint2 } : lookOf(c);
  shown = buildCar(look, carMat);
  scene.add(shown.obj);
}

// ---- The panel.
const panel = document.getElementById('panel')!;
const walletEl = document.getElementById('wallet')!;
const toastEl = document.getElementById('toast')!;
let toastT = 0;
const toast = (s: string): void => {
  toastEl.textContent = s;
  toastT = 2.5;
};
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** Stat bars, with the change a part (or a car) would make shown against them. */
function statBars(now: Stats, then?: Stats): string {
  const rows: [string, (s: Stats) => number, number, number, (s: Stats) => string][] = [
    ['Power', (s) => s.ps, 40, 460, (s) => `${s.ps} PS`],
    ['Weight', (s) => -s.kg, -1500, -650, (s) => `${s.kg} kg`],
    ['Top speed', (s) => s.top, 130, 310, (s) => `${s.top} km/h`],
    ['Grip', (s) => s.grip, 0.9, 1.4, (s) => s.grip.toFixed(2)],
    ['Brakes', (s) => s.brake, 0.85, 1.5, (s) => s.brake.toFixed(2)],
    ['Drift', (s) => s.drift, 0, 1, (s) => `${Math.round(s.drift * 100)}`],
  ];
  const pct = (v: number, lo: number, hi: number): number => Math.max(3, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  return `<div class="stats">${rows
    .map(([label, f, lo, hi, txt]) => {
      const a = pct(f(now), lo, hi);
      const b = then ? pct(f(then), lo, hi) : a;
      const up = b > a + 0.1;
      const down = b < a - 0.1;
      return `<div class="stat"><span>${label}</span><i><b style="width:${Math.min(a, b)}%"></b>${up ? `<u class="up" style="left:${a}%;width:${b - a}%"></u>` : ''}${down ? `<u class="down" style="left:${b}%;width:${a - b}%"></u>` : ''}</i><em>${txt(then ?? now)}</em></div>`;
    })
    .join('')}<div class="layout">${(then ?? now).layout}</div></div>`;
}

function swatches(colors: readonly (number | null)[], selected: number | null | undefined, action: string): string {
  return `<div class="swatches">${colors.map((c) => `<button class="sw${c === selected ? ' on' : ''}" data-act="${action}" data-v="${c ?? 'none'}" style="background:${c === null ? 'transparent' : hex(c)}">${c === null ? '×' : ''}</button>`).join('')}</div>`;
}

function render(): void {
  const c = currentCar(profile);
  const m = model(c.type);
  walletEl.innerHTML = `${yen(profile.yen)}<small>earned ${yen(profile.earned)}</small>`;
  const tabs = (['cars', 'tuning', 'paint', 'livery', 'neon'] as Tab[]).map((t) => `<button class="tab${t === tab ? ' on' : ''}" data-act="tab" data-v="${t}">${{ cars: 'Cars', tuning: 'Tuning', paint: 'Paint', livery: 'Livery', neon: 'Neon' }[t]}</button>`).join('');
  let body = '';
  const spec = tunedSpec(c.type, c.parts);
  if (tab === 'cars') {
    const owned = profile.cars
      .map((o) => {
        const om = model(o.type);
        return `<button class="row${o.id === c.id && !viewing ? ' on' : ''}" data-act="pick" data-v="${o.id}"><b>${om.maker} ${om.name}</b><span>${o.id === c.id ? 'driving' : 'drive this'}</span></button>`;
      })
      .join('');
    const dealer = MODELS.map((dm) => {
      const own = profile.cars.some((o) => o.type === dm.type);
      return `<button class="row${viewing === dm.type ? ' on' : ''}" data-act="view" data-v="${dm.type}"><b>${dm.maker} ${dm.name} <small>${dm.year}</small></b><span>${own ? 'owned · ' : ''}${yen(dm.price)}</span></button>`;
    }).join('');
    const vm = viewing ? model(viewing) : null;
    body = `<h3>Your cars</h3>${owned}<h3>Dealer</h3>${dealer}${
      vm
        ? `<div class="detail"><b>${vm.maker} ${vm.name}</b><p>${vm.blurb}</p>${statBars(stats(spec), stats(vm.spec))}<button class="buy" data-act="buy" data-v="${vm.type}" ${profile.yen < vm.price ? 'disabled' : ''}>Buy · ${yen(vm.price)}</button></div>`
        : `<div class="detail"><b>${m.maker} ${m.name}</b><p>${m.blurb}</p>${statBars(stats(spec))}</div>`
    }`;
  } else if (tab === 'tuning') {
    let hover = spec;
    const rows = PARTS.map((p) => {
      const lvl = c.parts[p.id] ?? 0;
      const next = lvl + 1 < p.levels.length ? lvl + 1 : null;
      if (next !== null && hoverPart === p.id) hover = tunedSpec(c.type, { ...c.parts, [p.id]: next } as Parts);
      const pips = p.levels.map((_, i) => `<i class="${i <= lvl ? 'on' : ''}"></i>`).join('');
      return `<div class="part"><div><b>${p.label}</b><span>${p.levels[lvl]}</span><span class="pips">${pips}</span></div>${next !== null ? `<button data-act="part" data-v="${p.id}" data-hover="${p.id}" ${profile.yen < p.price[next] ? 'disabled' : ''}>${p.levels[next]} · ${yen(p.price[next])}</button>` : '<em>maxed</em>'}</div>`;
    }).join('');
    body = `${statBars(stats(spec), hover === spec ? undefined : stats(hover))}${rows}`;
  } else if (tab === 'paint') {
    const p = draft.paint ?? c.paint;
    const changed = draft.paint !== undefined || draft.paint2 !== undefined;
    body = `<h3>Body colour</h3>${swatches(PAINT_PALETTE, p, 'paint')}${
      c.type === 'hatch' ? `<h3>Lower body (two-tone)</h3>${swatches([null, ...PAINT_PALETTE], draft.paint2 !== undefined ? draft.paint2 : c.paint2, 'paint2')}` : ''
    }<button class="buy" data-act="apply" ${!changed || profile.yen < PRICES.paint ? 'disabled' : ''}>Respray · ${yen(PRICES.paint)}</button>`;
  } else if (tab === 'livery') {
    const L = draft.livery ?? c.livery;
    const cost = liveryCost(c.livery, L);
    body = `<h3>Racing stripes <small>${yen(PRICES.stripes)}</small></h3>${swatches([null, ...PAINT_PALETTE], L.stripes, 'stripes')}<h3>Side stripe <small>${yen(PRICES.side)}</small></h3>${swatches([null, ...PAINT_PALETTE], L.side, 'side')}<h3>Door number <small>${yen(PRICES.number)}</small></h3><div class="numbers"><button data-act="number" data-v="none" class="${L.number === null ? 'on' : ''}">none</button>${[7, 13, 21, 33, 46, 86].map((n) => `<button data-act="number" data-v="${n}" class="${L.number === n ? 'on' : ''}">${n}</button>`).join('')}<input id="num" type="number" min="1" max="99" placeholder="1-99" value="${L.number ?? ''}"></div><h3>Windscreen banner <small>${yen(PRICES.banner)}</small></h3><div class="numbers"><button data-act="banner" data-v="none" class="${L.banner === null ? 'on' : ''}">none</button>${BANNERS.map((b) => `<button data-act="banner" data-v="${b}" class="${L.banner === b ? 'on' : ''}">${b}</button>`).join('')}</div><button class="buy" data-act="apply" ${cost === 0 || profile.yen < cost ? 'disabled' : ''}>Apply livery · ${yen(cost)}</button>`;
  } else {
    const fitted = c.neonFitted;
    const col = draft.neon !== undefined ? draft.neon : c.neonFitted ? c.neon : null;
    const cost = !fitted ? PRICES.neon : draft.neon !== undefined && draft.neon !== null && draft.neon !== c.neon ? PRICES.neonColour : 0;
    body = `<p>Neon tubes under the sills, lighting the road under the car.</p><h3>Colour</h3><div class="neons">${NEON.map((n) => `<button class="sw${col === n.color ? ' on' : ''}" data-act="neon" data-v="${n.color}" style="background:${hex(n.color)};box-shadow:0 0 12px ${hex(n.color)}" title="${n.name}"></button>`).join('')}</div>${
      fitted
        ? `<button class="row" data-act="neonoff">${c.neon === null ? 'Turn on' : 'Turn off'}</button><button class="buy" data-act="apply" ${cost === 0 || profile.yen < cost ? 'disabled' : ''}>Change colour · ${yen(PRICES.neonColour)}</button>`
        : `<button class="buy" data-act="apply" ${draft.neon == null || profile.yen < cost ? 'disabled' : ''}>Fit neon · ${yen(PRICES.neon)}</button>`
    }`;
  }
  panel.innerHTML = `<div class="car">${viewing ? `${model(viewing).maker} ${model(viewing).name}` : `${m.maker} ${m.name}`}</div><div class="tabs">${tabs}</div><div class="body">${body}</div><a class="drive" href="race.html">Drive ▸ the passes</a>`;
  const num = document.getElementById('num') as HTMLInputElement | null;
  num?.addEventListener('change', () => {
    const n = Math.max(1, Math.min(99, Math.round(Number(num.value))));
    if (Number.isFinite(n)) setLivery({ number: n });
  });
}

let hoverPart: string | null = null;

const liveryCost = (a: Livery, b: Livery): number =>
  (a.stripes !== b.stripes && b.stripes !== null ? PRICES.stripes : 0) + (a.side !== b.side && b.side !== null ? PRICES.side : 0) + (a.number !== b.number && b.number !== null ? PRICES.number : 0) + (a.banner !== b.banner && b.banner !== null ? PRICES.banner : 0);

function setLivery(change: Partial<Livery>): void {
  const c = currentCar(profile);
  draft.livery = { ...(draft.livery ?? c.livery), ...change };
  showCar();
  render();
}

panel.addEventListener('mouseover', (e) => {
  const h = (e.target as HTMLElement).closest('[data-hover]') as HTMLElement | null;
  const v = h?.dataset.hover ?? null;
  if (v !== hoverPart) {
    hoverPart = v;
    render();
  }
});

panel.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!el || (el as HTMLButtonElement).disabled) return;
  const act = el.dataset.act!;
  const v = el.dataset.v ?? '';
  const c = currentCar(profile);
  const num = (): number | null => (v === 'none' ? null : Number(v));
  switch (act) {
    case 'tab':
      tab = v as Tab;
      draft = {};
      viewing = null;
      showCar();
      break;
    case 'pick':
      profile.current = v;
      viewing = null;
      draft = {};
      saveProfile(profile);
      showCar();
      break;
    case 'view':
      viewing = v as CarType;
      showCar();
      break;
    case 'buy': {
      const bought = buyCar(profile, v as CarType);
      if (bought) {
        saveProfile(profile);
        toast(`Bought: ${model(bought.type).maker} ${model(bought.type).name}`);
        viewing = null;
        showCar();
      }
      break;
    }
    case 'part': {
      const p = PARTS.find((x) => x.id === v)!;
      const next = (c.parts[p.id] ?? 0) + 1;
      if (spend(profile, p.price[next])) {
        c.parts[p.id] = next;
        saveProfile(profile);
        toast(`${p.label}: ${p.levels[next]}`);
      }
      break;
    }
    case 'paint':
      draft.paint = num() ?? c.paint;
      showCar();
      break;
    case 'paint2':
      draft.paint2 = num();
      showCar();
      break;
    case 'stripes':
    case 'side':
      setLivery({ [act]: num() });
      return;
    case 'number':
      setLivery({ number: num() });
      return;
    case 'banner':
      setLivery({ banner: v === 'none' ? null : v });
      return;
    case 'neon':
      draft.neon = Number(v);
      showCar();
      break;
    case 'neonoff':
      if (c.neon === null) c.neon = NEON[0].color;
      else c.neon = null;
      draft = {};
      saveProfile(profile);
      showCar();
      break;
    case 'apply':
      apply(c);
      break;
  }
  render();
});

/** Pay for the change on show and keep it. */
function apply(c: OwnedCar): void {
  if (tab === 'paint') {
    if (!spend(profile, PRICES.paint)) return;
    if (draft.paint !== undefined) c.paint = draft.paint;
    if (draft.paint2 !== undefined) c.paint2 = draft.paint2;
    toast('Resprayed');
  } else if (tab === 'livery' && draft.livery) {
    if (!spend(profile, liveryCost(c.livery, draft.livery))) return;
    c.livery = draft.livery;
    toast('Livery done');
  } else if (tab === 'neon' && draft.neon != null) {
    if (!spend(profile, c.neonFitted ? PRICES.neonColour : PRICES.neon)) return;
    c.neonFitted = true;
    c.neon = draft.neon;
    toast('Neon fitted');
  }
  draft = {};
  saveProfile(profile);
  showCar();
}

showCar();
render();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  controls.update();
  const { rumble } = garage.update(dt);
  // A train overhead: the camera trembles.
  if (rumble > 0) camera.position.y += (Math.random() - 0.5) * 0.01 * rumble;
  toastT = Math.max(0, toastT - dt);
  toastEl.style.opacity = Math.min(1, toastT * 2).toFixed(2);
  composer.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
(window as unknown as { __garage: unknown }).__garage = { profile, controls, camera, render: () => render() };
