import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { cityMaterial, cityUniforms } from '../real/city';
import { KIND, lin, MeshBuilder } from '../real/meshBuilder';
import { addFigure, GHOST_COLORS, GhostBuilder, ghostMaterial, type Body, type FigureSpec, type Pose } from '../real/people';
import { Character, CHARACTERS, setCharacterEnvironment } from '../models/characters';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FpMode } from './fpMode';
import { buildShotgun, SHOTGUN_KINDS } from '../models/shotgun';
import { buildBosozoku } from '../models/bosozoku';
import type { Bike } from '../models/bikeKit';
import { buildCruiser, CRUISER_LOOKS } from '../models/cruiser';
import { addVehicle, addVehicleLow, addWheel, BIKE_TYPES, CAR_TYPES2, vehicleLights, vehicleTexts, WORK_TYPES, type VehicleSpec, type VehicleType } from '../models/vehicles';
import { Lightmap, paintLights, type Light } from '../real/lightmap';
import { AdAtlas, adMaterial, DistrictAdAtlas } from '../real/adAtlas';
import { buildMegaSign } from '../real/megaSign';
import { trainModel } from '../real/rail';
import { carGlass, carSet2 } from '../real/trainCar';
import { buildBus2 } from '../real/busModel';
import { airliner2, AIRLINES } from '../real/airliner';
import { airliner } from '../real/airport';
import { BUS } from '../district/busCabin';
import { parkedBus } from '../real/traffic';
import type { BusLine } from '../district/traffic';
import { CAR } from '../district/cabin';
import { addProps, type Prop } from '../real/props';
import { addTree, FOLIAGE_VARIANTS, setFoliageVariant, type TreeSpecies } from '../models/trees';
import { TAXI_ADS } from '../models/ads';
import { SignAtlas, SignBuilder, signBox, signMaterial } from '../real/signs';
import { BILLBOARDS, DISTRICT_BLANK, districtAdUv, POSTERS } from '../real/districtAds';

/**
 * Model showroom: every car type and every person body type x pose, laid out in a clean space with studio
 * lighting, for reviewing the designs before they go into the world. Shows the new generation under review
 * (models/) and, for comparison, the previous one the district still uses (real/); M switches. Uses the same builders and
 * materials as the district (city material for cars, ghost material for people, ACES + bloom), but no
 * city, lightmap or ASCII overlay.
 * Mouse: left-drag orbit, right-drag pan, wheel zoom. Keys: WASD / Q E fly the view (Shift faster),
 * M new/previous models, 1 studio / 2 night / 3 day lighting, L labels, X wireframe, B bloom, R turntable.
 */

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
const labels = new CSS2DRenderer();
labels.setSize(window.innerWidth, window.innerHeight);
Object.assign(labels.domElement.style, { position: 'fixed', top: '0', left: '0', pointerEvents: 'none' });
document.body.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 500);
camera.position.set(0, 7, 24);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 4);
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
const hemi = new THREE.HemisphereLight();
const key = new THREE.DirectionalLight();
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 120 });
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.02;
key.position.set(18, 30, 22);
const street = [new THREE.PointLight(0xffc98a, 0, 30, 1.6), new THREE.PointLight(0xffc98a, 0, 30, 1.6), new THREE.PointLight(0x9ac8ff, 0, 30, 1.6)];
street[0].position.set(-6, 5.5, 1);
street[1].position.set(6, 5.5, 9);
street[2].position.set(0, 5, 15);
scene.add(hemi, key, ...street);

const cityU = cityUniforms();
cityU.uLightGain.value = 0;
const city = cityMaterial(cityU);
const ghost = ghostMaterial();

// Floor: asphalt pad for the cars, a paved area for the people, on a neutral studio floor.
const floor = new MeshBuilder();
floor.kind = KIND.lot;
floor.color = lin(0x5e5e5c);
floor.box(0, 6, -0.2, 0, 80, 80, KIND.lot);
floor.kind = KIND.asphalt;
floor.box(0, -10.5, 0, 0.02, 32, 26, KIND.asphalt);
floor.box(0, -30, 0, 0.02, 32, 11, KIND.asphalt);
floor.kind = KIND.lot;
floor.box(0, -36, -0.2, 0, 80, 6, KIND.lot);
floor.kind = KIND.asphalt;
floor.kind = KIND.plain;
floor.color = lin(0x8a867e);
floor.box(9, 20, 0, 0.15, 38, 28, KIND.sidewalk);
const floorMesh = new THREE.Mesh(floor.build()!, city);
floorMesh.receiveShadow = true;
scene.add(floorMesh);

interface Item {
  readonly name: string;
  readonly group: string;
  readonly at: THREE.Vector3;
  readonly size: number;
  /** Fixed viewing direction (from the item towards the camera); otherwise keep the current one. */
  readonly view?: THREE.Vector3;
}
/** People face +z in rows; viewed from the front and ~30 degrees up, the row in front doesn't block. */
const FRONT_VIEW = new THREE.Vector3(0, 0.55, 0.85).normalize();
// Two generations of models side by side in the same layout: 'new' (models/vehicles.ts and the rest,
// under review) and 'previous' (the old street tree, what the district used before).
type Gen = 'new' | 'previous';
let gen: Gen = 'new';
const genRoot: Record<Gen, THREE.Group> = { new: new THREE.Group(), previous: new THREE.Group() };
const genLabels: Record<Gen, CSS2DObject[]> = { new: [], previous: [] };
const genItems: Record<Gen, Item[]> = { new: [], previous: [] };
scene.add(genRoot.new, genRoot.previous);
let labelsOn = true;
const label = (g: Gen, text: string, x: number, y: number, z: number): void => {
  const div = document.createElement('div');
  div.className = 'label';
  div.textContent = text;
  const o = new CSS2DObject(div);
  o.position.set(x, y, z);
  scene.add(o);
  genLabels[g].push(o);
};

// ---- New generation ----
const t0 = performance.now();
// Taxi ads (models/ads.ts): photo + printed copy, one option per taxi in row 4.
const ADS = TAXI_ADS.map((ad, i) => ({ ...ad, photo: i }));
const adAtlas = new SignAtlas(vehicleTexts(ADS));
const signsMat = signMaterial(cityU, adAtlas);
const photoAtlas = new AdAtlas(TAXI_ADS);
const adSigns = {
  sb: new SignBuilder(),
  layout: adAtlas,
  photos: { sb: new SignBuilder(), uv: (i: number, part: 'roof' | 'door') => photoAtlas.uv(i, part), blankUv: photoAtlas.blankUv, roofAspect: AdAtlas.ROOF_ASPECT, doorAspect: AdAtlas.DOOR_ASPECT },
};
const NAMES: Record<VehicleType, string> = {
  sedan: 'sedan', luxury: 'luxury sedan', sports: 'sports coupe', taxi: 'taxi (classic)', taxi2: 'taxi (modern)', kei: 'kei tall-wagon',
  minivan: 'minivan', keitruck: 'kei truck', scooter: 'scooter', motorcycle: 'motorcycle', delivery: 'delivery scooter',
  hatch: 'hatchback (80s)', rotary: 'rotary coupe', awd: 'turbo AWD coupe', roadster: 'kei roadster',
  van: 'work van', keivan: 'kei van', boxtruck: 'box truck (2 t)', police: 'patrol car',
};
const PAINT_A: Record<VehicleType, number> = {
  sedan: 0xe8e8e4, luxury: 0x07070a, sports: 0xc01818, taxi: 0x121316, taxi2: 0x1c2240, kei: 0xa8d4bc, minivan: 0xb4b6ba, keitruck: 0xe8e8e4,
  scooter: 0xe8e0c8, motorcycle: 0xb81818, delivery: 0xc81818,
  hatch: 0xf0f0ec, rotary: 0xe8c020, awd: 0x5a5e66, roadster: 0xe8c020,
  van: 0xf0f0ec, keivan: 0xf0f0ec, boxtruck: 0xf0f0ec, police: 0xf2f2ee,
};
const PAINT_B: Record<VehicleType, number> = {
  sedan: 0x1c2a44, luxury: 0xf0efe8, sports: 0xf0f0ec, taxi: 0xe0a818, taxi2: 0x121316, kei: 0xd8c09a, minivan: 0x121316, keitruck: 0xb4b6ba,
  scooter: 0x8ab0d0, motorcycle: 0x121316, delivery: 0x1c4a9a,
  hatch: 0xc01818, rotary: 0xc01818, awd: 0x1a2c5a, roadster: 0xc01818,
  van: 0x1c2a44, keivan: 0x8ab0d0, boxtruck: 0x2a5a9a, police: 0xf2f2ee,
};
const newCars = new MeshBuilder(1 << 17);
const nightLights: Light[] = [];
const vehicle = (spec: VehicleSpec, name: string, size: number, labelY = 2.4): void => {
  addVehicle(newCars, spec, adSigns);
  nightLights.push(...vehicleLights(spec));
  genItems.new.push({ name, group: 'Cars', at: new THREE.Vector3(spec.x, 0.8, spec.z), size });
  label('new', name, spec.x, labelY, spec.z);
};
CAR_TYPES2.filter((t) => !WORK_TYPES.includes(t)).forEach((type, i) => {
  const x = -13 + i * 3.7;
  vehicle({ x, z: -1.5, fx: 0, fz: 1, type, paint: PAINT_A[type] }, NAMES[type], 4.5);
  // Second row: other paints, facing away; the taxis carry ads.
  const ad = type === 'taxi' ? ADS[1] : type === 'taxi2' ? ADS[0] : undefined;
  vehicle({ x, z: -8.5, fx: 0, fz: -1, type, paint: PAINT_B[type], ad }, `${NAMES[type]} (alt${ad ? ' + ad' : ''})`, 4.5);
});
// The middle-distance versions (addVehicleLow: parked cars beyond ~140 m, traffic beyond 80 m), in front of row 1.
CAR_TYPES2.filter((t) => !WORK_TYPES.includes(t)).forEach((type, i) => addVehicleLow(newCars, { x: -13 + i * 3.7, z: 3, fx: 0, fz: 1, type, paint: PAINT_A[type] }));
WORK_TYPES.forEach((type, i) => addVehicleLow(newCars, { x: 30 + i * 6.5, z: 3, fx: 0, fz: 1, type, paint: PAINT_A[type] }));
label('new', 'middle-distance models (parked beyond ~140 m, traffic beyond 80 m)', 4, 2.6, 3);
genItems.new.push({ name: 'middle-distance cars', group: 'Cars', at: new THREE.Vector3(4, 0.8, 3), size: 16 });
// Working vehicles and the patrol car (new, under review): a row of their own behind the taxi ads, the second
// paint facing away.
// Each in two companies' lettering (WORK_LIVERIES), the patrol cars two units.
const COMPANY: Partial<Record<VehicleType, [number, number]>> = { van: [0, 4], keivan: [1, 6], boxtruck: [2, 3] };
WORK_TYPES.forEach((type, i) => {
  const x = -10 + i * 6.5;
  const [ca, cb] = COMPANY[type] ?? [undefined, undefined];
  vehicle({ x, z: -27, fx: 0, fz: 1, type, paint: PAINT_A[type], company: ca, marks: 1 }, NAMES[type], 5.5, 3.4);
  vehicle({ x, z: -33, fx: 0, fz: -1, type, paint: PAINT_B[type], company: cb, marks: 7 }, `${NAMES[type]} (alt)`, 5.5, 3.4);
});
BIKE_TYPES.forEach((type, i) => {
  for (const [j, paints] of [PAINT_A, PAINT_B].entries()) {
    const x = -9 + i * 6 + j * 2.2;
    vehicle({ x, z: -13.5, fx: 0, fz: 1, type, paint: paints[type], paint2: type === 'delivery' && j === 1 ? 0xe8c020 : undefined }, `${NAMES[type]}${j ? ' (alt)' : ''}`, 2.4, 1.7);
  }
});
// Ad options, parked side-on so the roof panel and door wrap face the camera.
ADS.forEach((ad, i) => {
  // Two staggered rows so the back row's doors aren't hidden.
  const x = -13.5 + (i % 4) * 9 + (i < 4 ? 0 : 4.5);
  const z = i < 4 ? -18 : -21.5;
  const type = i % 2 ? 'taxi2' : 'taxi';
  vehicle({ x, z, fx: 1, fz: 0, type, paint: type === 'taxi' ? [0x121316, 0xe0a818, 0x1f5a36][i % 3] : 0x1c2240, ad }, `ad ${ad.name}`, 5);
});
const newCarMesh = new THREE.Mesh(newCars.build()!, city);
newCarMesh.castShadow = newCarMesh.receiveShadow = true;
genRoot.new.add(newCarMesh);
const signGeo = adSigns.sb.build(0, 0);
if (signGeo) genRoot.new.add(new THREE.Mesh(signGeo, signsMat));
const photoGeo = adSigns.photos.sb.build(0, 0);
if (photoGeo) genRoot.new.add(new THREE.Mesh(photoGeo, adMaterial(cityU, photoAtlas)));
// Headlight and brake-light spill on the ground, painted into a lightmap tile like the district's.
const showLightmap = new Lightmap(renderer, { x: -64, y: -64, w: 128, h: 128 }, 128);
showLightmap.upload(-64, -64, paintLights(new OffscreenCanvas(128, 128).getContext('2d', { willReadFrequently: true })!, -64, -64, 128, nightLights));
cityU.tLight.value = showLightmap.texture;
cityU.uLightRect.value = showLightmap.uniformRect;
// Kaburo district ads: a wall of every approved billboard (on stands) with the posters below, facing +x.
{
  const wallX = -34;
  const dAtlas = new DistrictAdAtlas();
  const asb = new SignBuilder();
  const amb = new MeshBuilder();
  const n: [number, number, number] = [1, 0, 0];
  const r: [number, number, number] = [0, 0, -1];
  const place = (list: typeof BILLBOARDS, w: number, h: number, y0: number, z0: number, dz: number, group: string, perTier = 99, tierDy = 0): void => {
    list.forEach(({ a, i }, k) => {
      const z = z0 + (k % perTier) * dz;
      const tier = Math.floor(k / perTier);
      y0 += tier > 0 && k % perTier === 0 ? tierDy : 0;
      const p: [number, number, number] = [wallX, 0, z];
      amb.kind = KIND.plain;
      amb.color = lin(0x2c2e32);
      amb.frameBox(p, r, n, -w / 2 - 0.1, w / 2 + 0.1, y0 - 0.1, y0 + h + 0.1, -0.2, 0);
      amb.frameBox(p, r, n, -0.1, 0.1, 0, y0, -0.2, -0.05);
      asb.sign = [i, 1];
      signBox(asb, p, r, n, -w / 2, w / 2, y0, y0 + h, 0, 0.05, DISTRICT_BLANK, { n: districtAdUv(i) });
      label('new', a.brand, wallX + 0.3, y0 + h + 0.35, z);
      genItems.new.push({ name: `${a.brand}`, group, at: new THREE.Vector3(wallX, y0 + h / 2, z), size: Math.max(w, h) * 0.9, view: new THREE.Vector3(1, 0.1, 0).normalize() });
    });
  };
  // Billboards in tiers of 7 (stacked upward), posters in one long row at eye level.
  place(BILLBOARDS, 6, 3, 3.2, -24, 7.2, 'Billboards', 7, 3.8);
  place(POSTERS, 1.2, 1.8, 0.4, -25, 2.4, 'Posters');
  genRoot.new.add(new THREE.Mesh(asb.build(0, 0)!, adMaterial(cityU, dAtlas)));
  const frames = new THREE.Mesh(amb.build()!, city);
  frames.castShadow = true;
  genRoot.new.add(frames);
  genItems.new.push({ name: 'all district ads', group: 'Billboards', at: new THREE.Vector3(wallX, 3, -2), size: 30, view: new THREE.Vector3(1, 0.2, 0).normalize() });
}
// The Toto Line train (three cars) on a short length of track: the district's (previous) and the new commuter car
// (real/trainCar.ts, under review: walk-in insides, doors that open), with a platform along it; and the new car in
// a subway line's colours beside it.
{
  const at = new THREE.Vector3(-40, 0, 60);
  const track = new MeshBuilder();
  track.kind = KIND.plain;
  for (const x of [at.x, at.x - 9]) {
    track.color = lin(0x3a3a3c);
    track.box(x, at.z, 0, 0.08, 2.6, 70, KIND.plain);
    track.color = lin(0xb0b0b4);
    for (const s of [-0.53, 0.53]) track.box(x + s, at.z, 0.08, 0.2, 0.07, 70, KIND.plain);
  }
  // A platform along the left of the new train, at its floor (0.9 m over the rail).
  track.kind = KIND.sidewalk;
  track.color = lin(0xb4b0a8);
  track.box(at.x - 4.55, at.z, 0, 1.1, 3.0, 64, KIND.sidewalk);
  track.kind = KIND.plain;
  track.color = lin(0xe8c030);
  track.box(at.x - 3.4, at.z, 1.1, 1.11, 0.3, 64, KIND.plain);
  scene.add(new THREE.Mesh(track.build()!, city));
  const old = trainModel(0x10a060, city);
  old.position.set(at.x, 0.2, at.z);
  genRoot.previous.add(old);
  label('previous', 'Toto Line train', at.x, 6, at.z);
  const mats = { city, glass: carGlass(), ads: adMaterial(cityU, photoAtlas) };
  const set = carSet2(0x10a060, mats, { dest: { jp: '学園坂', en: 'Gakuenzaka' } })();
  set.group.children.forEach((car, i) => (car.position.z = (i - 1) * (CAR.L + CAR.GAP)));
  set.group.position.set(at.x, 0.2, at.z);
  set.setScreens({ jp: '霞町', en: 'Kasumi-chō', code: 'T05' }, { jp: '学園坂', en: 'Gakuenzaka' });
  // The doors on the platform's side open (the cars' right), as at a station.
  set.setDoors(-1, 1);
  genRoot.new.add(set.group);
  const sub = carSet2(0xd8a020, mats, { subway: true, dest: { jp: '夜光線', en: 'Yakō Line' } })();
  sub.group.children.forEach((car, i) => (car.position.z = (i - 1) * (CAR.L + CAR.GAP)));
  sub.group.position.set(at.x - 9, 0.2, at.z);
  genRoot.new.add(sub.group);
  label('new', 'Toto Line commuter car (new)', at.x, 6, at.z);
  label('new', 'subway car (Yakō Line colours)', at.x - 9, 6, at.z);
  for (const g of ['new', 'previous'] as const) {
    genItems[g].push({ name: 'train', group: 'Transit', at: new THREE.Vector3(at.x, 2, at.z), size: 60, view: new THREE.Vector3(1, 0.3, 0.6).normalize() });
    genItems[g].push({ name: 'train (cab)', group: 'Transit', at: new THREE.Vector3(at.x, 2, at.z + 28), size: 8, view: new THREE.Vector3(0.5, 0.15, 1).normalize() });
    genItems[g].push({ name: 'train (inside)', group: 'Transit', at: new THREE.Vector3(at.x, 2.4, at.z + 3), size: 3, view: new THREE.Vector3(0.01, 0.05, 1).normalize() });
  }
  genItems.new.push({ name: 'train (inside, to the cab)', group: 'Transit', at: new THREE.Vector3(at.x, 2.5, at.z + 22), size: 2.5, view: new THREE.Vector3(0.0, 0.02, -1).normalize() });
  genItems.new.push({ name: 'train (doors, platform)', group: 'Transit', at: new THREE.Vector3(at.x - 1, 2.0, at.z + 2.3), size: 4, view: new THREE.Vector3(-1, 0.15, 0.2).normalize() });
  genItems.new.push({ name: 'subway car', group: 'Transit', at: new THREE.Vector3(at.x - 9, 2, at.z), size: 24, view: new THREE.Vector3(-1, 0.25, 0.5).normalize() });
}
// The city bus: the district's (previous) and the new one (real/busModel.ts, under review: walk-in, doors that
// open), at a stop's kerb.
{
  const at = new THREE.Vector3(-40, 0, 104);
  const kerb = new MeshBuilder();
  kerb.kind = KIND.sidewalk;
  kerb.color = lin(0xb4b0a8);
  kerb.box(at.x + 3.6, at.z, 0, 0.15, 3.0, 16, KIND.sidewalk);
  scene.add(new THREE.Mesh(kerb.build()!, city));
  const old = parkedBus('歌舞路循環', city);
  old.position.copy(at);
  genRoot.previous.add(old);
  label('previous', 'city bus', at.x, 4, at.z);
  const line = { id: 'kaburo', name: '歌舞路循環', en: 'KABURO LOOP', rect: [26, 10, 31, 12], buses: 1, stops: ['歌舞路北', '歌舞路東口', '歌舞路二丁目', '歌舞路西口'] } as unknown as BusLine;
  const bus = buildBus2(line, { city, glass: carGlass(), ads: null });
  bus.obj.position.copy(at);
  bus.setDoors(1);
  bus.setNext({ jp: '歌舞路東口', en: 'Kaburo East Exit' }, true);
  genRoot.new.add(bus.obj);
  for (const z of BUS.AXLES) for (const sd of [-1, 1] as const) {
    const w = new MeshBuilder(2048);
    addWheel(w, BUS.WHEEL_R, 0.3, sd, 'steel');
    const m = new THREE.Mesh(w.build()!, city);
    m.position.set(at.x + sd * 1.1, BUS.WHEEL_R, at.z + z);
    genRoot.new.add(m);
  }
  label('new', 'city bus (new)', at.x, 4, at.z);
  for (const g of ['new', 'previous'] as const) genItems[g].push({ name: 'bus', group: 'Transit', at: new THREE.Vector3(at.x, 1.5, at.z), size: 13, view: new THREE.Vector3(1, 0.3, 0.7).normalize() });
  genItems.new.push({ name: 'bus (inside, to the back)', group: 'Transit', at: new THREE.Vector3(at.x, 2.0, at.z + 2.4), size: 1.5, view: new THREE.Vector3(0, 0.05, 1).normalize() });
  genItems.new.push({ name: 'bus (inside, to the front)', group: 'Transit', at: new THREE.Vector3(at.x, 2.4, at.z - 3.5), size: 1.5, view: new THREE.Vector3(0, 0.1, -1).normalize() });
  genItems.new.push({ name: 'bus (doors)', group: 'Transit', at: new THREE.Vector3(at.x + 1.2, 1.4, at.z + 1.5), size: 6, view: new THREE.Vector3(1, 0.15, 0.3).normalize() });
}
// The airliner: the airport's (previous) and the new one (real/airliner.ts, under review), in each airline's colours.
{
  const at = new THREE.Vector3(40, 0, 270);
  const pad = new MeshBuilder();
  pad.kind = KIND.lot;
  pad.color = lin(0x5a5a5c);
  pad.box(at.x + 30, at.z, -0.2, 0.01, 130, 60, KIND.lot);
  scene.add(new THREE.Mesh(pad.build()!, city));
  const old = airliner(0x1a4aa0);
  old.group.position.copy(at);
  old.landing.visible = false;
  genRoot.previous.add(old.group);
  label('previous', 'airliner', at.x, 15, at.z);
  AIRLINES.forEach((a, i) => {
    const p = airliner2(a, city);
    p.group.position.set(at.x + i * 40, 0, at.z);
    p.landing.visible = false;
    genRoot.new.add(p.group);
    label('new', `airliner · ${a.name}`, at.x + i * 40, 15, at.z);
  });
  for (const g of ['new', 'previous'] as const) genItems[g].push({ name: 'airliner', group: 'Transit', at: new THREE.Vector3(at.x, 4, at.z), size: 40, view: new THREE.Vector3(1, 0.35, 0.8).normalize() });
  genItems.new.push({ name: 'airliners (all)', group: 'Transit', at: new THREE.Vector3(at.x + 60, 4, at.z), size: 110, view: new THREE.Vector3(0.2, 0.5, 1).normalize() });
}
// Kaburo mega-sign (the corner tower with its screens and the neon dragon) on its own plaza.
{
  const at = new THREE.Vector3(62, 0, 18);
  const plaza = new MeshBuilder();
  plaza.kind = KIND.lot;
  plaza.color = lin(0x5e5e5c);
  plaza.box(at.x - 6, at.z + 6, -0.2, 0.01, 56, 56, KIND.lot);
  plaza.kind = KIND.asphalt;
  plaza.box(at.x - 20, at.z + 20, 0.01, 0.03, 16, 16, KIND.asphalt);
  // Scramble-crossing stripes in front of the corner.
  plaza.kind = KIND.paint;
  plaza.color = lin(0xd8d8d0);
  for (let k = -6; k <= 6; k++) {
    plaza.quad([at.x - 27, 0.035, at.z + 17 + k + 0.25], [14, 0, 0], [0, 0, -0.5]);
    plaza.quad([at.x - 17 + k - 0.25, 0.035, at.z + 27], [0.5, 0, 0], [0, 0, -14]);
  }
  const plazaMesh = new THREE.Mesh(plaza.build()!, city);
  plazaMesh.receiveShadow = true;
  genRoot.new.add(plazaMesh);
  const mega = buildMegaSign(cityU, city);
  mega.group.position.copy(at);
  genRoot.new.add(mega.group);
  const head = mega.headAt.clone().add(at);
  label('new', 'Kaburo mega-sign', at.x - 14, 38, at.z + 14);
  genItems.new.push({ name: 'mega-sign', group: 'Mega-sign', at: new THREE.Vector3(at.x - 4, 28, at.z + 4), size: 48, view: new THREE.Vector3(-1, 0.12, 1).normalize() });
  genItems.new.push({ name: 'screens (close)', group: 'Mega-sign', at: new THREE.Vector3(at.x - 10, 20, at.z + 10), size: 16, view: new THREE.Vector3(-1, 0.05, 1).normalize() });
  genItems.new.push({ name: 'dragon', group: 'Mega-sign', at: new THREE.Vector3(at.x - 4, 40, at.z + 4), size: 40, view: new THREE.Vector3(-1, 0.05, -0.3).normalize() });
  genItems.new.push({ name: 'dragon head', group: 'Mega-sign', at: head, size: 14, view: new THREE.Vector3(-0.35, 0.1, 1).normalize() });
  genItems.new.push({ name: 'from the crossing', group: 'Mega-sign', at: new THREE.Vector3(at.x - 4, 34, at.z + 4), size: 70, view: new THREE.Vector3(-1, -0.62, 1.1).normalize() });
}
// Trees (models/trees.ts, under review) on a lawn, and the street and park furniture the district uses
// (real/dressing.ts) on paving beside them.
const TREE_NAMES: Record<TreeSpecies, string> = {
  zelkova: 'zelkova 欅', ginkgo: 'ginkgo 銀杏', ginkgoGold: 'ginkgo (autumn)', sakura: 'sakura 桜', sakuraBloom: 'sakura (in bloom)',
  pine: 'black pine 黒松', camphor: 'camphor 楠', dogwood: 'dogwood 花水木', dogwoodBloom: 'dogwood (in flower)', azalea: 'azalea 躑躅', box: 'clipped box',
};
const TREE_ROWS: [number, TreeSpecies[], number][] = [
  [70, ['zelkova', 'ginkgo', 'ginkgoGold', 'sakura', 'sakuraBloom', 'camphor'], 11],
  [86, ['pine', 'dogwood', 'dogwoodBloom', 'azalea', 'box'], 8],
];
const GARDEN_X = -8;
{
  const pad = new MeshBuilder();
  pad.kind = KIND.grass;
  pad.color = lin(0x3e5a30);
  pad.box(GARDEN_X + 30, 80, -0.2, 0.1, 76, 30, KIND.grass);
  pad.kind = KIND.plain;
  pad.color = lin(0x8a867e);
  pad.box(GARDEN_X + 30, 102, -0.2, 0.15, 76, 14, KIND.sidewalk);
  genRoot.new.add(new THREE.Mesh(pad.build()!, city));
  const trees = new MeshBuilder(1 << 16);
  for (const [z, species, dx] of TREE_ROWS) {
    species.forEach((sp, i) => {
      const x = GARDEN_X + i * dx;
      addTree(trees, { x, z, species: sp, seed: i });
      const big = sp !== 'azalea' && sp !== 'box';
      label('new', TREE_NAMES[sp], x, big ? (sp === 'camphor' ? 11.5 : 10) : 1.8, z);
      genItems.new.push({ name: TREE_NAMES[sp], group: 'Trees', at: new THREE.Vector3(x, big ? 4.5 : 0.6, z), size: big ? 11 : 2.5, view: new THREE.Vector3(0.2, 0.25, 1).normalize() });
    });
  }
  genItems.new.push({ name: 'all trees', group: 'Trees', at: new THREE.Vector3(GARDEN_X + 26, 4, 78), size: 60, view: new THREE.Vector3(0.1, 0.35, 1).normalize() });
  const treeMesh = new THREE.Mesh(trees.build()!, city);
  treeMesh.castShadow = treeMesh.receiveShadow = true;
  genRoot.new.add(treeMesh);
  // Furniture, left to right along the paving (facing +z, toward the camera).
  const furn = new MeshBuilder(1 << 15);
  const P = (kind: Prop['kind'], x: number, extra: Partial<Prop> = {}): Prop => ({ kind, x, z: 102, nx: 0, nz: 1, radius: 0.3, variant: 0, ...extra });
  const sample: [string, Prop][] = [
    ['kerb hedge', P('hedge', GARDEN_X, { half: 2.5 })],
    ['park hedge', P('hedge', GARDEN_X + 6, { half: 2, variant: 1 })],
    ['potted plants', P('pots', GARDEN_X + 10, { half: 1.1, variant: 7 })],
    ['planter', P('planter', GARDEN_X + 14, { size: 2.4, variant: 2 })],
    ['bench', P('bench', GARDEN_X + 18, { half: 0.8 })],
    ['park lamp', P('postlamp', GARDEN_X + 21)],
    ['car park lamp', P('postlamp', GARDEN_X + 23, { variant: 1 })],
    ['playground fence', P('fence', GARDEN_X + 27, { half: 1.8, variant: 1 })],
    ['post & chain', P('fence', GARDEN_X + 32, { half: 1.8, variant: 2 })],
    ['pay machine', P('paymachine', GARDEN_X + 35.5)],
    ['P sign', P('psign', GARDEN_X + 37.5)],
    ['wheel stop', P('wheelstop', GARDEN_X + 39.5, { half: 0.6 })],
    ['swing', P('swing', GARDEN_X + 43, { half: 1.6 })],
    ['slide', P('slide', GARDEN_X + 48, { variant: 1 })],
    ['sandbox', P('sandbox', GARDEN_X + 52, { radius: 1.5 })],
    ['toilet block', P('toilet', GARDEN_X + 58)],
    ['weeds', P('weeds', GARDEN_X + 62, { size: 1.2, variant: 4 })],
    ['for-sale board', P('board', GARDEN_X + 64.5, { half: 0.6 })],
    ['cones', P('cones', GARDEN_X + 67, { variant: 2 })],
  ];
  addProps(furn, { props: sample.map(([, p]) => p), wires: [], lights: [], open: [], solids: [] });
  for (const [name, p] of sample) {
    label('new', name, p.x, 3.2, p.z);
    genItems.new.push({ name, group: 'Street & park', at: new THREE.Vector3(p.x, 1, p.z), size: 4, view: new THREE.Vector3(0.3, 0.3, 1).normalize() });
  }
  const furnMesh = new THREE.Mesh(furn.build()!, city);
  furnMesh.castShadow = furnMesh.receiveShadow = true;
  genRoot.new.add(furnMesh);
}
// Foliage variants (models/trees.ts FOLIAGE_VARIANTS), side by side for review: each row the same trees, shrubs and
// hedges built and shaded one way. The season buttons (the panel's Foliage) turn them all.
const VARIANT_Z = 150;
const VARIANT_ROW: [TreeSpecies, number][] = [['zelkova', 0], ['ginkgo', 11], ['sakura', 21], ['camphor', 33], ['pine', 45], ['dogwood', 54]];
{
  const pad = new MeshBuilder();
  const mb = new MeshBuilder(1 << 17);
  FOLIAGE_VARIANTS.forEach((name, v) => {
    const z = VARIANT_Z + v * 34;
    pad.kind = KIND.grass;
    pad.color = lin(0x3e5a30);
    pad.box(GARDEN_X + 42, z + 4, -0.2, 0.1, 110, 26, KIND.grass);
    pad.kind = KIND.plain;
    pad.color = lin(0x8a867e);
    pad.box(GARDEN_X + 78, z + 4, -0.2, 0.15, 30, 26, KIND.sidewalk);
    setFoliageVariant(v);
    for (const [sp, dx] of VARIANT_ROW) addTree(mb, { x: GARDEN_X + dx, z, species: sp, seed: dx + 1 });
    const P = (kind: Prop['kind'], x: number, dz: number, extra: Partial<Prop> = {}): Prop => ({ kind, x, z: z + dz, nx: 0, nz: 1, radius: 0.3, variant: 0, ...extra });
    addTree(mb, { x: GARDEN_X + 62, z: z + 2, species: 'azalea', seed: 3 });
    addTree(mb, { x: GARDEN_X + 65, z: z + 2, species: 'azalea', seed: 4 });
    addTree(mb, { x: GARDEN_X + 68, z: z + 2, species: 'box', seed: 5 });
    addProps(mb, {
      props: [P('hedge', GARDEN_X + 76, 2, { half: 3 }), P('hedge', GARDEN_X + 76, 7, { half: 3, variant: 1 }), P('pots', GARDEN_X + 83, 2, { half: 1.3, variant: 7 }), P('planter', GARDEN_X + 88, 3, { size: 2.4, variant: 2 })],
      wires: [], lights: [], open: [], solids: [],
    });
    label('new', `${v + 1} · ${name}`, GARDEN_X - 8, 3, z);
    genItems.new.push({ name: `${v + 1} ${name}: trees`, group: 'Foliage', at: new THREE.Vector3(GARDEN_X + 26, 4, z), size: 30, view: new THREE.Vector3(0.1, 0.25, 1).normalize() });
    genItems.new.push({ name: `${v + 1} ${name}: close`, group: 'Foliage', at: new THREE.Vector3(GARDEN_X + 22, 5, z), size: 7, view: new THREE.Vector3(0.3, 0.15, 1).normalize() });
    genItems.new.push({ name: `${v + 1} ${name}: shrubs`, group: 'Foliage', at: new THREE.Vector3(GARDEN_X + 76, 0.8, z + 3), size: 9, view: new THREE.Vector3(0.2, 0.4, 1).normalize() });
  });
  setFoliageVariant(3);
  genRoot.new.add(new THREE.Mesh(pad.build()!, city));
  const m = new THREE.Mesh(mb.build()!, city);
  m.castShadow = m.receiveShadow = true;
  genRoot.new.add(m);
}
const tCars = performance.now() - t0;

// The mob (real/people.ts): every body type in every pose, the hair and clothes, and groups as they stand
// in the street. Fading is off here except in the last row, which shows the crowd coming and going.
const mob = new GhostBuilder();
const person = (s: Partial<FigureSpec> & Pick<FigureSpec, 'x' | 'z' | 'body' | 'pose'>): void => {
  addFigure(mob, { yaw: 0, color: GHOST_COLORS[1], hair: s.body === 'woman' ? 'long' : s.body === 'elder' ? 'none' : 'short', long: false, phase: 0.25, side: 1, look: 0, fade: false, ...s });
};
const BODIES: Body[] = ['man', 'woman', 'child', 'elder'];
const POSES: Pose[] = ['stand', 'walk', 'talk', 'phone', 'pockets', 'wave', 'hold'];
const DX = 2.0;
const DZ = 3.6;
const x0 = -((POSES.length - 1) * DX) / 2;
BODIES.forEach((body, r) => {
  const z = 8 + r * DZ;
  POSES.forEach((pose, c) => {
    const x = x0 + c * DX;
    person({ x, z, body, pose, color: GHOST_COLORS[(r * 3 + c) % GHOST_COLORS.length] });
    label('new', `${body} · ${pose}`, x, body === 'child' ? 1.5 : 2.2, z);
  });
  genItems.new.push({ name: `${body} × all poses`, group: 'People', at: new THREE.Vector3(0, 1, z), size: 7, view: FRONT_VIEW });
});
const LOOKS: [string, Partial<FigureSpec> & Pick<FigureSpec, 'body' | 'pose'>][] = [
  ['bob · skirt', { body: 'woman', pose: 'stand', hair: 'short', long: true }],
  ['bun · skirt', { body: 'woman', pose: 'walk', hair: 'bun', long: true }],
  ['sun hat', { body: 'woman', pose: 'pockets', hair: 'hat' }],
  ['long coat · fedora', { body: 'man', pose: 'pockets', hair: 'hat', long: true }],
  ['cap', { body: 'man', pose: 'stand', hair: 'cap' }],
  ['bald', { body: 'man', pose: 'phone', hair: 'none' }],
  ['elder · cap', { body: 'elder', pose: 'stand', hair: 'cap' }],
];
const zv = 8 + BODIES.length * DZ;
LOOKS.forEach(([name, s], c) => {
  const x = x0 + c * DX;
  person({ x, z: zv, color: GHOST_COLORS[(c * 5 + 2) % GHOST_COLORS.length], ...s });
  label('new', name, x, 2.3, zv);
});
genItems.new.push({ name: 'hair & clothes', group: 'People', at: new THREE.Vector3(0, 1, zv), size: 7.5, view: FRONT_VIEW });
// Groups as they'll appear in the street, fading in and out on their own cycles.
const zg = zv + DZ + 0.2;
const GROUP: (Partial<FigureSpec> & Pick<FigureSpec, 'x' | 'z' | 'body' | 'pose'>)[] = [
  { x: -5.2, z: zg - 0.45, body: 'woman', pose: 'talk', hair: 'bun', long: true },
  { x: -5.2, z: zg + 0.45, body: 'man', pose: 'stand', yaw: Math.PI, color: GHOST_COLORS[3] },
  { x: -1.9, z: zg, body: 'woman', pose: 'hold', side: 1, color: GHOST_COLORS[4] },
  { x: -1.35, z: zg, body: 'child', pose: 'hold', side: -1, hair: 'cap', look: -0.4, color: GHOST_COLORS[6] },
  { x: 1.5, z: zg, body: 'man', pose: 'walk', phase: 0.25, color: GHOST_COLORS[0] },
  { x: 2.15, z: zg + 0.1, body: 'woman', pose: 'walk', phase: 0.75, look: -0.4, color: GHOST_COLORS[5] },
  { x: 5.2, z: zg - 0.4, body: 'man', pose: 'pockets', hair: 'hat', long: true, color: GHOST_COLORS[2] },
  { x: 5.6, z: zg + 0.4, body: 'woman', pose: 'phone', yaw: Math.PI, color: GHOST_COLORS[7] },
];
for (const g of GROUP) person({ ...g, fade: true });
label('new', 'talking pair', -5.2, 2.4, zg);
label('new', 'parent + child', -1.6, 2.4, zg);
label('new', 'couple walking', 1.8, 2.4, zg);
label('new', 'waiting', 5.4, 2.4, zg);
genItems.new.push({ name: 'groups (fading)', group: 'People', at: new THREE.Vector3(0, 1, zg), size: 7, view: FRONT_VIEW });
// Outfits (district/peopleMix.ts): what the mob wears where.
const zo = zg + DZ;
const DRESSED: [string, Partial<FigureSpec> & Pick<FigureSpec, 'body' | 'pose'>][] = [
  ['salaryman · suit', { body: 'man', pose: 'walk', outfit: 'suit', phase: 0.3 }],
  ['office · suit', { body: 'woman', pose: 'stand', outfit: 'suit', hair: 'bun' }],
  ['maid', { body: 'woman', pose: 'wave', outfit: 'maid', hair: 'long' }],
  ['maid', { body: 'woman', pose: 'stand', outfit: 'maid', hair: 'short' }],
  ['schoolgirl', { body: 'woman', pose: 'phone', outfit: 'school', hair: 'long' }],
  ['schoolboy', { body: 'man', pose: 'walk', outfit: 'school', phase: 0.7 }],
  ['randoseru', { body: 'child', pose: 'walk', outfit: 'school', hair: 'cap', phase: 0.2 }],
  ['kimono', { body: 'woman', pose: 'stand', outfit: 'kimono', hair: 'bun' }],
  ['kimono (man)', { body: 'man', pose: 'pockets', outfit: 'kimono' }],
  ['kimono (elder)', { body: 'elder', pose: 'stand', outfit: 'kimono', hair: 'none' }],
  ['yukata', { body: 'woman', pose: 'walk', outfit: 'yukata', hair: 'bun', phase: 0.4 }],
  ['yukata (child)', { body: 'child', pose: 'stand', outfit: 'yukata', hair: 'bun' }],
  ['yukata (man)', { body: 'man', pose: 'pockets', outfit: 'yukata' }],
  ['hard hat · hi-vis', { body: 'man', pose: 'stand', outfit: 'work' }],
  ['police', { body: 'man', pose: 'stand', outfit: 'police', color: GHOST_COLORS[3] }],
  ['police (woman)', { body: 'woman', pose: 'walk', outfit: 'police', color: GHOST_COLORS[3], phase: 0.6 }],
  ['backpack', { body: 'man', pose: 'walk', outfit: 'backpack', phase: 0.1 }],
  ['backpack (girl)', { body: 'woman', pose: 'phone', outfit: 'backpack', hair: 'long' }],
  ['sitting', { body: 'man', pose: 'sit', outfit: 'suit', y: 0 }],
  ['sitting', { body: 'woman', pose: 'sit', outfit: 'long', hair: 'long', y: 0 }],
  ['strap', { body: 'man', pose: 'strap', outfit: 'plain' }],
];
DRESSED.forEach(([name, sp], c) => {
  const x = x0 - 2 + c * DX;
  person({ x, z: zo, color: GHOST_COLORS[(c * 3 + 1) % GHOST_COLORS.length], ...sp });
  person({ x, z: zo + 1.4, yaw: Math.PI, color: GHOST_COLORS[(c * 3 + 1) % GHOST_COLORS.length], ...sp });
  label('new', name, x, 2.3, zo);
});
genItems.new.push({ name: 'outfits', group: 'People', at: new THREE.Vector3(x0 - 2 + 8.5 * DX, 1, zo), size: 17, view: FRONT_VIEW });
genItems.new.push({ name: 'outfits (backs)', group: 'People', at: new THREE.Vector3(x0 - 2 + 4.5 * DX, 1, zo + 1.4), size: 9, view: new THREE.Vector3(0, 0.55, -0.85).normalize() });
const mobMesh = new THREE.Mesh(mob.build(0, 0)!, ghost);
genRoot.new.add(mobMesh);
(window as unknown as { __mob: unknown }).__mob = { scene, mobMesh, floorMesh, ghost };
// The cast as modelled characters (models/characters.ts), on a pad of their own past the mob, idling.
const CAST_Z = 38;
const castPad = new MeshBuilder();
castPad.kind = KIND.plain;
castPad.color = lin(0x8a867e);
castPad.box(0, CAST_Z, 0, 0.15, Math.max(6, CHARACTERS.length * 2.2 + 2), 5, KIND.sidewalk);
genRoot.new.add(new THREE.Mesh(castPad.build()!, city));
const pmrem = new THREE.PMREMGenerator(renderer);
const charEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
setCharacterEnvironment(charEnv);
const cast: Character[] = [];
CHARACTERS.forEach((name, i) => {
  const x = (i - (CHARACTERS.length - 1) / 2) * 2.2;
  label('new', name, x, 2.15, CAST_Z);
  genItems.new.push({ name, group: 'Characters', at: new THREE.Vector3(x, 1.1, CAST_Z), size: 2.2, view: new THREE.Vector3(0.25, 0.2, 1).normalize() });
  genItems.new.push({ name: `${name}: face`, group: 'Characters', at: new THREE.Vector3(x, 1.55, CAST_Z), size: 0.45, view: new THREE.Vector3(0.2, 0.05, 1).normalize() });
  Character.load(name, i)
    .then((c) => {
      c.root.position.set(x, 0.15, CAST_Z);
      genRoot.new.add(c.root);
      cast.push(c);
    })
    .catch((e: unknown) => console.warn(`character ${name}:`, e));
});
if (CHARACTERS.length > 0) genItems.new.push({ name: 'the cast', group: 'Characters', at: new THREE.Vector3(0, 1, CAST_Z), size: 3 + CHARACTERS.length, view: FRONT_VIEW });
// Mack's shotguns (models/shotgun.ts), side by side on a stand at the end of the cast's pad.
{
  const gx = Math.max(6, CHARACTERS.length * 2.2 + 2) / 2 + 1.4;
  const stand = new MeshBuilder();
  stand.kind = KIND.plain;
  stand.color = lin(0x2c2a28);
  stand.box(gx, CAST_Z, 0.15, 0.95, 1.2, 0.8, KIND.plain);
  genRoot.new.add(new THREE.Mesh(stand.build()!, city));
  SHOTGUN_KINDS.forEach((k, i) => {
    const gun = buildShotgun(k, charEnv);
    gun.root.userData.shotgun = k;
    // Lying on its right side across the stand, muzzle to the left, as on a gun dealer's table.
    gun.root.rotation.set(0, -Math.PI / 2, Math.PI / 2);
    gun.root.position.set(gx + 0.06, 1.2, CAST_Z - 0.18 + i * 0.36);
    genRoot.new.add(gun.root);
    label('new', `shotgun: ${k}`, gx, 1.42, CAST_Z - 0.18 + i * 0.36);
    genItems.new.push({ name: `shotgun: ${k}`, group: 'Characters', at: new THREE.Vector3(gx + 0.1, 1.2, CAST_Z - 0.18 + i * 0.36), size: 0.42, view: new THREE.Vector3(0.05, 0.75, 0.66).normalize() });
  });
}
// Bikes you can ride in first person (E by one).
const rideable: Bike[] = [];
// Mack's bike (models/bosozoku.ts), on the pad beyond the guns, turned three-quarters to the front.
{
  const bx = Math.max(6, CHARACTERS.length * 2.2 + 2) / 2 + 4.2;
  const bike = buildBosozoku(charEnv);
  bike.root.position.set(bx, 0.15, CAST_Z);
  bike.root.rotation.y = -0.6;
  bike.steer.quaternion.setFromAxisAngle(bike.steerAxis, 0.25);
  genRoot.new.add(bike.root);
  rideable.push(bike);
  label('new', 'bike: Seika Shiden 400F (bōsōzoku)', bx, 2.0, CAST_Z);
  genItems.new.push({ name: 'bike: bōsōzoku', group: 'Characters', at: new THREE.Vector3(bx, 0.8, CAST_Z), size: 1.6, view: new THREE.Vector3(-0.6, 0.25, 0.75).normalize() });
}
// The cruiser (models/cruiser.ts) beside it, in each of its colours.
(Object.keys(CRUISER_LOOKS) as (keyof typeof CRUISER_LOOKS)[]).forEach((name, i) => {
  const bx = Math.max(6, CHARACTERS.length * 2.2 + 2) / 2 + 6.8 + i * 2.6;
  const bike = buildCruiser(charEnv, CRUISER_LOOKS[name]);
  bike.root.position.set(bx, 0.15, CAST_Z);
  bike.root.rotation.y = -0.6;
  bike.steer.quaternion.setFromAxisAngle(bike.steerAxis, 0.25);
  genRoot.new.add(bike.root);
  rideable.push(bike);
  label('new', `bike: Kaiun Raijin 1600 (${name})`, bx, 1.7, CAST_Z);
  genItems.new.push({ name: `bike: cruiser (${name})`, group: 'Characters', at: new THREE.Vector3(bx, 0.7, CAST_Z), size: 1.7, view: new THREE.Vector3(-0.6, 0.25, 0.75).normalize() });
});
// First person as Mack (models/firstPerson.ts), on the cast's pad facing them. The floors: the cast pad and
// the people's pavement are 0.15 m up.
const castHalfW = Math.max(6, CHARACTERS.length * 2.2 + 2) / 2;
const fpFloor = (x: number, z: number): number =>
  (Math.abs(x) < castHalfW && Math.abs(z - CAST_Z) < 2.5) || (x > -10 && x < 28 && z > 6 && z < 34) ? 0.15 : 0;
const fp = new FpMode(scene, camera, renderer.domElement, controls, charEnv, fpFloor);
fp.bikes = rideable;
const enterFp = (): void => void fp.enter(0.6, CAST_Z + 2.2, 0);
(window as unknown as { __fp: unknown }).__fp = fp.script();
// For scripted shots of a model on its own: three, the showroom's scene, the gun builder and the characters' light.
(window as unknown as { __lab: unknown }).__lab = { THREE, scene, buildShotgun, buildBosozoku, buildCruiser, CRUISER_LOOKS, env: charEnv };
if (new URLSearchParams(location.search).has('fp')) enterFp();
const tPeople = performance.now() - t0 - tCars;

// ---- Previous generation (for comparison) ----
// The district's one street tree (real/props.ts), where the new species stand.
{
  const pad = new MeshBuilder();
  pad.kind = KIND.grass;
  pad.color = lin(0x3e5a30);
  pad.box(GARDEN_X + 30, 80, -0.2, 0.1, 76, 30, KIND.grass);
  genRoot.previous.add(new THREE.Mesh(pad.build()!, city));
  const mb = new MeshBuilder();
  const props: Prop[] = [0, 1, 2, 3].map((i) => ({ kind: 'tree', x: GARDEN_X + i * 11, z: 70, nx: 0, nz: 1, radius: 0.3, variant: i * 3, size: [1, 1.3, 0.8, 1][i], grate: i !== 1 }));
  addProps(mb, { props, wires: [], lights: [], open: [], solids: [] });
  const m = new THREE.Mesh(mb.build()!, city);
  m.castShadow = m.receiveShadow = true;
  genRoot.previous.add(m);
  props.forEach((p, i) => {
    const name = ['street tree', 'park tree (1.3x)', 'narrow-pavement tree (0.8x)', 'street tree (variant)'][i];
    label('previous', name, p.x, 9, p.z);
    genItems.previous.push({ name, group: 'Trees', at: new THREE.Vector3(p.x, 4, p.z), size: 11, view: new THREE.Vector3(0.2, 0.25, 1).normalize() });
  });
}
const applyGen = (g: Gen): void => {
  gen = g;
  genRoot.new.visible = g === 'new';
  genRoot.previous.visible = g === 'previous';
  for (const k of ['new', 'previous'] as const) for (const o of genLabels[k]) o.visible = labelsOn && k === g;
  renderPanel();
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
  cityU.uSunDir.value.copy(key.position).normalize();
  cityU.uSunCol.value.copy(key.color).multiplyScalar(key.intensity);
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
  const section = (title: string): void => {
    const h = document.createElement('h3');
    h.textContent = title;
    panel.appendChild(h);
  };
  const button = (text: string, on: boolean, fn: () => void): void => {
    const b = document.createElement('button');
    b.textContent = text;
    if (on) b.className = 'on';
    b.onclick = fn;
    panel.appendChild(b);
  };
  section('Models');
  button('new (under review)', gen === 'new', () => applyGen('new'));
  button('previous (in the district)', gen === 'previous', () => applyGen('previous'));
  section('Lighting');
  for (const m of ['studio', 'night', 'day'] as const) button(m, mode === m, () => applyMode(m));
  section('Foliage season');
  (['spring', 'summer', 'autumn', 'winter'] as const).forEach((sn, i) => button(sn, cityU.uSeason.value === i, () => {
    cityU.uSeason.value = i;
    renderPanel();
  }));
  for (const g of ['Characters', 'Foliage', 'Transit', 'Mega-sign', 'Cars', 'Billboards', 'Posters', 'People']) {
    section(g);
    for (const it of genItems[gen].filter((i) => i.group === g)) button(it.name, false, () => focus(it));
  }
  section('First person');
  button(fp.active ? 'back to orbiting (V)' : 'Mack, first person (V)', fp.active, () => (fp.active ? fp.exit() : enterFp(), setTimeout(renderPanel, 50)));
  section('View');
  button('overview', false, () => focus({ name: '', group: '', at: new THREE.Vector3(0, 1, 8), size: 20, view: new THREE.Vector3(0.3, 0.6, 0.75).normalize() }));
}
applyMode('studio');
applyGen('new');

// Fly keys move the camera and its orbit target together.
const keys = new Set<string>();
let turntable = false;
let wire = false;
window.addEventListener('keydown', (e) => {
  if (fp.active) return;
  if (e.code === 'KeyV') {
    enterFp();
    setTimeout(renderPanel, 50);
    return;
  }
  keys.add(e.code);
  if (e.code === 'Digit1') applyMode('studio');
  if (e.code === 'Digit2') applyMode('night');
  if (e.code === 'Digit3') applyMode('day');
  if (e.code === 'KeyL') {
    labelsOn = !labelsOn;
    applyGen(gen);
  }
  if (e.code === 'KeyM') applyGen(gen === 'new' ? 'previous' : 'new');
  if (e.code === 'KeyB') bloom.enabled = !bloom.enabled;
  if (e.code === 'KeyR') turntable = !turntable;
  if (e.code === 'KeyX') {
    wire = !wire;
    city.wireframe = wire;
    ghost.wireframe = wire;
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
  if (fp.active) keys.clear();
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
  if (glide && !fp.active) {
    const t = Math.min(1, (performance.now() - glide.t0) / 600);
    const k = t * t * (3 - 2 * t);
    controls.target.lerpVectors(glide.from, glide.to, k);
    camera.position.lerpVectors(glide.camFrom, glide.camTo, k);
    if (t >= 1) glide = null;
  }
  controls.autoRotate = turntable;
  if (fp.active) fp.update(dt);
  else controls.update();
  cityU.uTime.value = performance.now() / 1000;
  ghost.uniforms.uTime.value = performance.now() / 1000;
  for (const c of cast) c.update(dt);
  composer.render(dt);
  labels.render(scene, camera);
  $('hud').textContent = fp.active ? fp.hud() : [
    `MODEL SHOWROOM · ${gen === 'new' ? 'NEW models (under review)' : 'previous models (district)'} · ${mode} lighting · built cars ${tCars.toFixed(0)} ms, people ${tPeople.toFixed(0)} ms`,
    'click a model to focus it · left-drag orbit · right-drag pan · wheel zoom · WASD / Q E fly (Shift faster)',
    `M new/previous models · 1 studio · 2 night · 3 day · L labels · X wireframe${wire ? ' (on)' : ''} · B bloom${bloom.enabled ? '' : ' (off)'} · R turntable${turntable ? ' (on)' : ''}`,
  ].join('\n');
});
