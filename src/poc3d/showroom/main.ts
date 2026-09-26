import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { addCar, CAR_TYPES } from '../real/cars';
import { cityMaterial, cityUniforms } from '../real/city';
import { KIND, lin, MeshBuilder } from '../real/meshBuilder';
import { addFigure, GHOST_COLORS, GhostBuilder, ghostMaterial, type Body, type FigureSpec, type Pose } from '../real/people';
import { figureGeometry, ghostMaterials2, POSES2, type Body2, type FigureShape, type Pose2 } from '../models/figures';
import { addVehicle, BIKE_TYPES, CAR_TYPES2, vehicleLights, vehicleTexts, type VehicleSpec, type VehicleType } from '../models/vehicles';
import { Lightmap, paintLights, type Light } from '../real/lightmap';
import { AdAtlas, adMaterial, DistrictAdAtlas } from '../real/adAtlas';
import { buildMegaSign } from '../real/megaSign';
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
floor.kind = KIND.plain;
floor.color = lin(0x8a867e);
floor.box(0, 17.5, 0, 0.15, 17, 23, KIND.sidewalk);
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
// Two generations of models side by side in the same layout: 'new' (models/vehicles.ts, models/figures.ts,
// under review) and 'previous' (real/cars.ts, real/people.ts, what the district uses today).
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
};
const PAINT_A: Record<VehicleType, number> = {
  sedan: 0xe8e8e4, luxury: 0x07070a, sports: 0xc01818, taxi: 0x121316, taxi2: 0x1c2240, kei: 0xa8d4bc, minivan: 0xb4b6ba, keitruck: 0xe8e8e4,
  scooter: 0xe8e0c8, motorcycle: 0xb81818, delivery: 0xc81818,
};
const PAINT_B: Record<VehicleType, number> = {
  sedan: 0x1c2a44, luxury: 0xf0efe8, sports: 0xf0f0ec, taxi: 0xe0a818, taxi2: 0x121316, kei: 0xd8c09a, minivan: 0x121316, keitruck: 0xb4b6ba,
  scooter: 0x8ab0d0, motorcycle: 0x121316, delivery: 0x1c4a9a,
};
const newCars = new MeshBuilder(1 << 17);
const nightLights: Light[] = [];
const vehicle = (spec: VehicleSpec, name: string, size: number, labelY = 2.4): void => {
  addVehicle(newCars, spec, adSigns);
  nightLights.push(...vehicleLights(spec));
  genItems.new.push({ name, group: 'Cars', at: new THREE.Vector3(spec.x, 0.8, spec.z), size });
  label('new', name, spec.x, labelY, spec.z);
};
CAR_TYPES2.forEach((type, i) => {
  const x = -13 + i * 3.7;
  vehicle({ x, z: -1.5, fx: 0, fz: 1, type, paint: PAINT_A[type] }, NAMES[type], 4.5);
  // Second row: other paints, facing away; the taxis carry ads.
  const ad = type === 'taxi' ? ADS[1] : type === 'taxi2' ? ADS[0] : undefined;
  vehicle({ x, z: -8.5, fx: 0, fz: -1, type, paint: PAINT_B[type], ad }, `${NAMES[type]} (alt${ad ? ' + ad' : ''})`, 4.5);
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
const tCars = performance.now() - t0;

const ghostCache = new Map<number, ReturnType<typeof ghostMaterials2>>();
const ghostOf = (hex: number): ReturnType<typeof ghostMaterials2> => {
  let g = ghostCache.get(hex);
  if (!g) ghostCache.set(hex, (g = ghostMaterials2(hex)));
  return g;
};
const COLORS2 = [0x5ad8ff, 0xff6ab8, 0xb08cff, 0x6affa8, 0xffb850, 0xc8d4ff, 0xff8a6a];
const figure2 = (shape: FigureShape, x: number, z: number, yaw: number, hex: number): void => {
  const geo = figureGeometry(shape);
  const mats = ghostOf(hex);
  for (const [m, order] of [[mats.depth, 1], [mats.color, 2]] as const) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, 0.15, z);
    mesh.rotation.y = yaw;
    mesh.renderOrder = order;
    genRoot.new.add(mesh);
  }
};
const shape = (body: Body2, pose: Pose2, extra: Partial<FigureShape> = {}): FigureShape => ({
  body,
  pose,
  outfit: body === 'woman' ? 'dress' : 'casual',
  hair: body === 'woman' ? 'bob' : body === 'elder' ? 'none' : 'short',
  hat: 'none',
  accessory: pose === 'phone' ? 'phone' : 'none',
  phase: 0.25,
  side: 1,
  look: 0,
  ...extra,
});
const BODIES2: Body2[] = ['man', 'woman', 'child', 'elder'];
const DX = 2.0;
const DZ = 3.6;
const x0 = -((POSES2.length - 1) * DX) / 2;
BODIES2.forEach((body, r) => {
  const z = 8 + r * DZ;
  POSES2.forEach((pose, c) => {
    const x = x0 + c * DX;
    figure2(shape(body, pose), x, z, 0, COLORS2[r]);
    label('new', `${body} · ${pose}`, x, body === 'child' ? 1.55 : 2.2, z);
  });
  genItems.new.push({ name: `${body} × all poses`, group: 'People', at: new THREE.Vector3(0, 1, z), size: 7, view: FRONT_VIEW });
});
const OUTFITS: [string, FigureShape][] = [
  ['salaryman · suit + briefcase', shape('man', 'carry', { outfit: 'suit', accessory: 'briefcase' })],
  ['salaryman · bowing (ojigi)', shape('man', 'bow', { outfit: 'suit' })],
  ['office worker · bag + ponytail', shape('woman', 'walk', { hair: 'ponytail', accessory: 'shoulderbag', phase: 0.5 })],
  ['kimono · obi + bun', shape('woman', 'stand', { outfit: 'kimono', hair: 'bun' })],
  ['detective · trench + fedora', shape('man', 'pockets', { outfit: 'coat', hat: 'fedora' })],
  ['schoolchild · randoseru + hat', shape('child', 'walk', { outfit: 'school', hat: 'schoolhat' })],
  ['elder · cane + sun hat', shape('elder', 'carry', { accessory: 'cane', hat: 'sunhat' })],
  ['vinyl umbrella · long hair', shape('woman', 'umbrella', { outfit: 'casual', hair: 'long', accessory: 'umbrella' })],
];
const zv = 8 + BODIES2.length * DZ;
OUTFITS.forEach(([name, s], c) => {
  const x = x0 + c * DX;
  figure2(s, x, zv, 0, COLORS2[(c + 4) % COLORS2.length]);
  label('new', name, x, s.body === 'child' ? 1.6 : s.accessory === 'umbrella' ? 2.7 : 2.3, zv);
});
genItems.new.push({ name: 'outfits & accessories', group: 'People', at: new THREE.Vector3(0, 1, zv), size: 7.5, view: FRONT_VIEW });
const zg = zv + DZ + 0.2;
// Groups as they'll appear in the street.
figure2(shape('woman', 'talk', { outfit: 'kimono', hair: 'bun', look: 0 }), -5.2, zg - 0.45, 0, COLORS2[1]);
figure2(shape('man', 'stand', { outfit: 'suit' }), -5.2, zg + 0.45, Math.PI, COLORS2[0]);
figure2(shape('woman', 'hold', { side: 1 }), -1.9, zg, 0, COLORS2[3]);
figure2(shape('child', 'hold', { side: -1, outfit: 'school', hat: 'schoolhat', look: -0.4 }), -1.35, zg, 0, COLORS2[4]);
figure2(shape('man', 'walk', { phase: 0.25 }), 1.5, zg, 0, COLORS2[5]);
figure2(shape('woman', 'walk', { phase: 0.75, look: -0.4, hair: 'long' }), 2.15, zg + 0.1, 0, COLORS2[2]);
figure2(shape('man', 'bow', { outfit: 'suit' }), 5.2, zg - 0.55, 0, COLORS2[6]);
figure2(shape('man', 'bow', { outfit: 'suit' }), 5.2, zg + 0.55, Math.PI, COLORS2[0]);
label('new', 'talking pair', -5.2, 2.4, zg);
label('new', 'parent + child', -1.6, 2.4, zg);
label('new', 'couple walking', 1.8, 2.4, zg);
label('new', 'bowing pair', 5.2, 2.2, zg);
genItems.new.push({ name: 'groups', group: 'People', at: new THREE.Vector3(0, 1, zg), size: 7, view: FRONT_VIEW });
const tPeople = performance.now() - t0 - tCars;

// ---- Previous generation (for comparison) ----
const carRows: { z: number; dir: number; paints: Record<string, number> }[] = [
  { z: -1.5, dir: 1, paints: { sedan: 0xe2e2de, kei: 0x9ac8b0, minivan: 0xa8aaae, taxi: 0x141416 } },
  { z: -8.5, dir: -1, paints: { sedan: 0x1e2c48, kei: 0xc8b48c, minivan: 0x141416, taxi: 0xd89a20 } },
];
const carMb = new MeshBuilder();
for (const [ri, row] of carRows.entries()) {
  CAR_TYPES.forEach((type, i) => {
    const x = -6 + i * 4;
    addCar(carMb, { x, z: row.z, fx: 0, fz: row.dir, variant: 1, type, paint: row.paints[type] });
    const name = `${type}${ri ? ' (alt paint)' : ''}`;
    genItems.previous.push({ name, group: 'Cars', at: new THREE.Vector3(x, 0.8, row.z), size: 4.5 });
    label('previous', name, x, 2.4, row.z);
  });
}
const cars = new THREE.Mesh(carMb.build()!, city);
cars.castShadow = cars.receiveShadow = true;
genRoot.previous.add(cars);
const BODIES: Body[] = ['man', 'woman', 'child', 'elder'];
const POSES: Pose[] = ['stand', 'walk', 'talk', 'phone', 'pockets', 'wave', 'hold'];
const px0 = -((POSES.length - 1) * DX) / 2;
const person = (s: FigureSpec): void => {
  const gb = new GhostBuilder();
  addFigure(gb, s);
  const m = new THREE.Mesh(gb.build(0, 0)!, ghost);
  m.renderOrder = 2;
  genRoot.previous.add(m);
};
const base = (x: number, z: number, body: Body, pose: Pose, color: [number, number, number]): FigureSpec => ({
  x, z, yaw: 0, body, pose, color, hair: body === 'woman' ? 'long' : body === 'elder' ? 'none' : 'short',
  long: false, phase: 0.25, side: 1, look: 0,
});
BODIES.forEach((body, r) => {
  const z = 8 + r * DZ;
  POSES.forEach((pose, c) => {
    const x = px0 + c * DX;
    person(base(x, z, body, pose, GHOST_COLORS[r % GHOST_COLORS.length] as [number, number, number]));
    label('previous', `${body} · ${pose}`, x, body === 'child' ? 1.5 : 2.2, z);
  });
  genItems.previous.push({ name: `${body} × all poses`, group: 'People', at: new THREE.Vector3(0, 1, z), size: 7, view: FRONT_VIEW });
});

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
  for (const g of ['Mega-sign', 'Cars', 'Billboards', 'Posters', 'People']) {
    section(g);
    for (const it of genItems[gen].filter((i) => i.group === g)) button(it.name, false, () => focus(it));
  }
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
  if (glide) {
    const t = Math.min(1, (performance.now() - glide.t0) / 600);
    const k = t * t * (3 - 2 * t);
    controls.target.lerpVectors(glide.from, glide.to, k);
    camera.position.lerpVectors(glide.camFrom, glide.camTo, k);
    if (t >= 1) glide = null;
  }
  controls.autoRotate = turntable;
  controls.update();
  cityU.uTime.value = performance.now() / 1000;
  composer.render(dt);
  labels.render(scene, camera);
  $('hud').textContent = [
    `MODEL SHOWROOM · ${gen === 'new' ? 'NEW models (under review)' : 'previous models (district)'} · ${mode} lighting · built cars ${tCars.toFixed(0)} ms, people ${tPeople.toFixed(0)} ms`,
    'click a model to focus it · left-drag orbit · right-drag pan · wheel zoom · WASD / Q E fly (Shift faster)',
    `M new/previous models · 1 studio · 2 night · 3 day · L labels · X wireframe${wire ? ' (on)' : ''} · B bloom${bloom.enabled ? '' : ' (off)'} · R turntable${turntable ? ' (on)' : ''}`,
  ].join('\n');
});
