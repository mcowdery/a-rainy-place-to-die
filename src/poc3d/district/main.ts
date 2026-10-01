import { TuningPanel } from '../../race/tuning';
import { RacePath, RaceState, type RaceDef } from './cityRace';
import { RaceHud } from './raceHud';
import { RaceRival } from './raceRival';
import { separateCars } from '../../race/battle';
import { FLAG_SEASON, isSeason, SEASON_NAMES, seasonFlag, seasonIndex, type Season } from './seasons';
import { DebugMenu, type DebugHit } from './debugMenu';
import { WaitPanel } from './waitPanel';
import { outlookAt } from './forecast';
import { WeatherApp } from './weatherApp';
import { puddleAt, weatherGrip, wheelsOf as carWheels, type RoadWeather } from './roadGrip';
import { blendAtmosphere } from './atmosphere';
import { clockAt, clockLabel, DAY, lateAt, phaseAt, RATE, sleepUntil, START_MINUTE, sunDirAt, TIMES_OF_DAY, untilMinute, blendAt, type NamedTime } from './clock';
import { buildEdges } from '../real/edges';
import { railReserved } from './rail';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FlagStore } from '../../core/flags';
import { ContentError } from '../../content/load';
import { FLAG_TIME, FLAG_WEATHER, WEATHERS, type TimeOfDay, type Weather } from '../../atmosphere/rules';
import { PlaceholderVnBridge } from '../../game/bridge';
import { loadVnLibrary } from '../../vn/content';
import { VnPlayer } from '../../vn/player';
import { loadPhoneContent } from '../../phone/content';
import { edition } from '@edition';
import { Phone } from '../../phone/engine';
import { PhoneUI } from '../../phone/ui';
import { FirstPerson } from '../controls';
import { frontFrame } from '../real/buildings';
import { cityDepthMaterial, cityMaterial, cityUniforms } from '../real/city';
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
import { ASAGIRI_KINDS, buildAsagiri, type AsagiriBuilt, type AsagiriKind } from '../real/asagiri';
import { railStation, TrainSystem, viaductPiers, type RailStation } from '../real/rail';
import { SubwaySystem } from '../real/subway';
import { buildSubwayStation, subwayShutter, type SubwayStationView } from '../real/subwayStation';
import { buildRotary, type RotaryBuilt } from '../real/rotary';
import { interiorFor, type Interior } from '../real/interiors';
import { hash } from '../../core/hash';
import { SignalLamps, TrafficSystem, type DrivenVehicle, setTrafficGround, useNewBuses } from '../real/traffic';
import { Driving } from './driving';
import { CITY_ASSISTS, OwnCar } from './ownCar';
import { DamageHud } from './damageHud';
import { SaveApp } from './saveApp';
import { readSave, SAVE_VERSION, SLOTS, writeSave, type SaveGame, type Slot } from '../../save/save';
import { installSnap } from '../../debug/snap';
import { fare, rideMetres, TaxiPicker } from './taxi';
import { earn, loadProfile, saveProfile, spend } from '../../race/profile';
import { Expressway, parseExpressway } from './expressway';
import { buildExpressway, ExpresswayTraffic } from '../real/expressway';
import { buildSea } from '../real/sea';
import { buildAirport, onAirfield } from '../real/airport';
import { carParkDecks } from '../real/denko';
import expresswayText from '../../../content/world3d/expressway.yaml?raw';
import { pointsAhead, Router, type NavMode } from './gps';
import { Guide, type GuideDest, type GuideFrom } from './guide';
import { PhoneMaps } from './phoneMaps';
import { GpsMarks } from '../real/gpsMarks';
import { ScreenGlows, ScreenLights } from '../real/screenLight';
import { GRADE_NAMES, GradePass } from '../real/grade';
import { DofPass } from '../real/dof';
import { SsrPass } from '../real/ssr';
import { CityAudio } from '../real/audio';
import { LampCones, LampShadows, Lightning, RainLayers, RainSystem, StreetWater, Drift, Splashes } from '../real/weather';
import { TrackMap, type Wheel } from '../real/tracks';
import { setTreeSink, TREE_REACH, type TreeSpecies } from '../models/trees';
import { LITTER, WIPERS } from '../real/city';
import { moodFromUrl, MoodPanel } from './moodPanel';
import { carLoops, routeFor, Signals } from './traffic';
import { carMixFor, CITY_CARS } from './carMix';
import { CAR } from './cabin';
import { BUS } from './busCabin';
import { carGlass, type CarMaterials } from '../real/trainCar';
import { CabinRider, type Ridable } from '../real/cabinRider';
import type { RideState } from './rideTimeline';
import { destinations, TravelMap, type Destination, type MapLine } from './travel';
import { RoutePicker } from './routePicker';
import { subwayRoute } from './subway';
import { EMIT, KIND, lin, MeshBuilder } from '../real/meshBuilder';
import { AsciiOverlayPass, OVERLAY_PRESETS, type OverlayPreset } from '../real/overlay';
import { addFigure, GhostBuilder, ghostMaterial, type FigureSpec } from '../real/people';
import { SignAtlas, signMaterial } from '../real/signs';
import { AdAtlas, adMaterial, DistrictAdAtlas } from '../real/adAtlas';
import { TAXI_ADS } from '../models/ads';
import { Sky } from '../real/sky';
import type { Atmosphere3 } from './atmosphere';
import { loadDistrictContent } from './content';
import { signTexts } from './model';
import { CELL, DISTRICTS3, STYLES3 } from './plan';
import type { Node3 } from './stamps';
import { District, LIGHTMAP_WINDOW } from './world';

/**
 * Kaburo (Neon Core), generated at full scale from the L0 map and streamed in chunks, rendered
 * realistically with an ASCII overlay for mood (see real/overlay.ts).
 * URL: ?time=night|day|dusk|dawn &weather=clear|rain|fog &cam=x,y,z,yaw,pitch &spawn=<node id> &late=1 (after the last train)
 * &debug=1 (M opens the map, a fast-travel tool; &ride=<from>,<to> starts on a subway ride) &ascii=vibe|heavy|ascii|off &grade=neutral|nocturne|noir|citypop &bench=1
 * Keys: WASD/mouse, Shift run, Space jump (up in fly, Ctrl down), E interact, M map / fast travel (debug), T time, R weather, F fly, V overlay (1-4 direct), G dither,
 * B bloom, P look mode.
 */
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
const bench = params.get('bench') === '1';
/** Debug: M opens the map and teleports (players get around by train and on foot; they have no map). */
const debug = params.get('debug') === '1';
/** After the last train (終電): stations shut, no trains. A story flag; ?late=1, or L to toggle. */
const FLAG_LATE = 'world.late';
/** Minutes since the story began (district/clock.ts). */
const FLAG_CLOCK = 'world.clock';
/** The weather stays as it is (the story's, a test's) instead of following the forecast. */
const FLAG_WEATHER_HOLD = 'world.weather_hold';
/** How hard it's raining or snowing (0-1: a drizzle to a downpour), from the forecast. */
const FLAG_RAIN_AMOUNT = 'world.rain_amount';
/** When the season began (the clock's minute): the rainy season opens summer. */
const FLAG_SEASON_START = 'world.season_start';
/** The rainy season (梅雨) and a heat wave (猛暑), as the forecast has them (for the story and the look). */
const FLAG_TSUYU = 'world.tsuyu';
const FLAG_HEAT = 'world.heat';
/** A typhoon passing (台風), as the forecast has it; and the story's (or the debug menu's) say: a typhoon that
 * began at this minute, a heat wave until this minute. */
const FLAG_TYPHOON = 'world.typhoon';
const FLAG_TYPHOON_AT = 'world.typhoon_at';
const FLAG_HEAT_UNTIL = 'world.heat_until';
const HEAT_HAZE = new THREE.Color(0xfff4e0);
const HEAT_ZENITH = new THREE.Color(0x3f86d8);
const HEAT_SUN = new THREE.Color(0xfff2d6);
const HEAT_FILL = new THREE.Color(0xfff0d8);
const HEAT_GROUND = new THREE.Color(0x9a7a52);
const START_SPAWN = 'kaburo_crossing.view';
const SEED = 0x0c179090;
const CELL_W = 8;
const CELL_H = 14;

type C3 = [number, number, number];

async function run(): Promise<void> {
  // The uncensored edition asks your age first (src/edition/ageGate.ts); the standard edition goes straight on.
  await edition.ageGate();
  const content = loadDistrictContent();
  // The clock (district/clock.ts): minutes since the story began, in the flags so saves carry it. ?clock=HH:MM and
  // ?day= set it; ?time= (dawn, day, dusk, night) picks a time in that look; ?late=1 starts after the last train.
  const startMinute = ((): number => {
    const c = /^(\d{1,2}):(\d{2})$/.exec(params.get('clock') ?? '');
    if (c) return (Number(c[1]) % 24) * 60 + Number(c[2]);
    if (params.get('late') === '1') return TIMES_OF_DAY.late;
    const byLook: Record<string, number> = { dawn: 5 * 60 + 45, day: 12 * 60, dusk: 18 * 60, night: START_MINUTE };
    return byLook[params.get('time') ?? ''] ?? START_MINUTE;
  })();
  const startTotal = (Math.max(1, Number(params.get('day')) || 1) - 1) * DAY + startMinute;
  const startSeason: Season = isSeason(params.get('season')) ? (params.get('season') as Season) : params.get('weather') === 'snow' ? 'winter' : 'spring';
  // The weather follows the forecast (district/forecast.ts) unless it's held: ?weather= (and the benchmark) hold it.
  const holdWeather = params.has('weather') || bench;
  const flags = new FlagStore({ [FLAG_CLOCK]: startTotal, [FLAG_TIME]: phaseAt(startMinute), [FLAG_WEATHER]: params.get('weather') ?? (bench ? 'clear' : outlookAt(startTotal, startSeason).weather), [FLAG_WEATHER_HOLD]: holdWeather, [FLAG_RAIN_AMOUNT]: bench || params.has('weather') ? 0.45 : outlookAt(startTotal, startSeason).amount || 0.45, [FLAG_SEASON_START]: 0, [FLAG_LATE]: lateAt(startMinute), [FLAG_SEASON]: startSeason });
  // ?load=<slot>: a saved game (save/save.ts). Its world's flags now; its character's car, money, place and phone
  // as each of those is set up below.
  const loadSlot = params.get('load') as Slot | null;
  const loaded: SaveGame | null = loadSlot && (SLOTS as readonly string[]).includes(loadSlot) ? readSave(loadSlot) : null;
  const me = loaded ? loaded.characters[loaded.current] : null;
  if (loaded) flags.load(loaded.world.flags);
  const late = (): boolean => flags.get(FLAG_LATE) === true;
  const time = (): TimeOfDay => flags.get(FLAG_TIME) as TimeOfDay;
  const weather = (): Weather => flags.get(FLAG_WEATHER) as Weather;
  const season = (): Season => (isSeason(flags.get(FLAG_SEASON)) ? (flags.get(FLAG_SEASON) as Season) : 'spring');

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
  sun.castShadow = true;
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

  const cityU = cityUniforms();
  const city = cityMaterial(cityU);
  const district = new District(content.macro, DISTRICTS3, content.placed, SEED, content.zones, content.avenues, content.bridges, content.terrain, railReserved(content.rails));
  // The ground's height (terrain.ts): 0 but on the hills.
  const groundAt = (x: number, z: number): number => content.terrain.height(x, z);
  /** The camera's height over the ground there (so street level is the same on a hill). */
  const camAbove = (): number => camera.position.y - groundAt(camera.position.x, camera.position.z);
  // The Tōto Expressway's layout (expressway.ts): built here, as its entrances are places to go (the map, taxis).
  const exErrors: string[] = [];
  const exDef = parseExpressway('content/world3d/expressway.yaml', expresswayText, exErrors);
  if (!exDef) throw new Error(exErrors.join('\n'));
  const expressway = new Expressway(exDef);
  /** Every place to go: the named spawns and zones, and the expressway's entrances (the street before each). */
  const allPlaces = (): Destination[] => [
    ...destinations(district, nodes, content.zones),
    ...expressway.roads
      .filter((r) => r.rampKind === 'on')
      .map((r) => {
        const back = 26;
        const x = r.x[0] - r.tx[0] * back;
        const z = r.z[0] - r.tz[0] * back;
        return { id: `expressway.${r.id}`, name: `東都高速 入口 Expressway entrance · ${r.sign}`, group: 'Expressway' as const, x, z, yaw: (Math.atan2(-r.tx[0], -r.tz[0]) * 180) / Math.PI, pitch: 4, floor: 0 };
      }),
  ];
  const words = content.zones.words([...new Set(DISTRICTS3.flatMap((k) => STYLES3[k]!.signWords))]);
  const atlas = new SignAtlas(signTexts(words, content.placed));
  const M = 16;
  const b = district.bounds;
  // The lightmap wraps round a 16-cell window (2 km) about the camera, so it doesn't grow with the city.
  const lightmap = new Lightmap(renderer, { x: b.minX - M, y: b.minZ - M, w: b.maxX - b.minX + 2 * M, h: b.maxZ - b.minZ + 2 * M }, CELL, LIGHTMAP_WINDOW);
  cityU.tLight.value = lightmap.texture;
  cityU.uLightRect.value = lightmap.uniformRect;
  cityU.uLightFade.value.set(...lightmap.fade);
  const ghost = ghostMaterial();
  const ads = adMaterial(cityU, new DistrictAdAtlas());
  const cityDepth = cityDepthMaterial(cityU);
  // Taxis' photo ads (parked and in traffic) and the vehicles' lettering (in the sign atlas).
  const taxiAds = adMaterial(cityU, new AdAtlas(TAXI_ADS));
  const signs = signMaterial(cityU, atlas);
  district.setKit({ city, cityDepth, signs, ghost, ads, taxiAds, atlas, lightmap, words });
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
  // Render resolution (K panel, ?res=): fixed, or auto: stepped down a tenth while frames run slow (over ~24 ms for
  // 1.5 s) and back up after 3 s of room (under ~17.5 ms), never back up for 20 s after a step down, between 60%
  // and 100% of the display's. The benchmark keeps it at 100%.
  let resScale = 1;
  const setRes = (s: number): void => {
    resScale = s;
    renderer.setPixelRatio(dpr * s);
    composer.setPixelRatio(dpr * s);
  };
  const resFixed = (): number | null => (bench && !params.has('res') ? 1 : mood.resolution === 'auto' ? null : Number(mood.resolution) / 100);
  const resAuto = { slow: 0, room: 0, hold: 0 };
  const adaptRes = (frameMs: number, windowS: number): void => {
    resAuto.hold = Math.max(0, resAuto.hold - windowS);
    if (frameMs > 24) {
      resAuto.room = 0;
      if (++resAuto.slow >= 3 && resScale > 0.61) {
        setRes(Math.max(0.6, resScale - 0.1));
        resAuto.slow = 0;
        resAuto.hold = 20;
      }
    } else if (frameMs < 17.5) {
      resAuto.slow = 0;
      if (++resAuto.room >= 6 && resAuto.hold === 0 && resScale < 0.99) {
        setRes(Math.min(1, resScale + 0.1));
        resAuto.room = 0;
      }
    } else resAuto.slow = resAuto.room = 0;
  };
  grade.grade = mood.grade;
  composer.addPass(grade);

  // Stamp dressing (door, noren, lanterns) and NPCs as ghosts (visibility follows their conditions).
  const nodes = district.nodes;
  /**
   * Things that never move: their matrices computed once, and the per-frame update skips them (three otherwise
   * recomposes every object's matrix every frame; most of the city stands still). Only matrices: visibility,
   * materials and textures still change.
   */
  const frozen = new Set<THREE.Object3D>();
  const freeze = (o: THREE.Object3D): void => {
    o.updateMatrixWorld(true);
    o.traverse((x) => (x.matrixAutoUpdate = false));
    o.matrixWorldAutoUpdate = false;
    frozen.add(o);
  };
  const npcMeshes = new Map<string, THREE.Object3D>();
  const dressing = new MeshBuilder();
  for (const placed of content.placed) {
    const f = frontFrame(placed.building);
    // Landmarks dress their own doors.
    if (placed.stamp.landmark === null) for (const n of placed.nodes) if (n.kind === 'door') dressDoor(dressing, n, f.r, f.n, groundAt(n.x, n.z));
    for (const n of placed.nodes) {
      if (n.kind !== 'npc') continue;
      const gb = new GhostBuilder();
      addFigure(gb, { ...npcSpec(n, f.n), y: n.floor + groundAt(n.x, n.z) });
      const mesh = new THREE.Mesh(gb.build(0, 0)!, ghost);
      mesh.renderOrder = 2;
      scene.add(mesh);
      freeze(mesh);
      npcMeshes.set(n.id, mesh);
    }
  }
  const dressingGeo = dressing.build();
  if (dressingGeo) {
    const m = new THREE.Mesh(dressingGeo, city);
    scene.add(m);
    freeze(m);
  }
  // Landmarks: built here rather than by the chunk workers (their own shaders and animation), always shown.
  const landmarkUpdates: ((camera: THREE.Vector3, dt: number) => void)[] = [];
  // Big screens light their surroundings in the colours they show.
  const screens = new ScreenLights(cityU);
  const glows = new ScreenGlows();
  scene.add(glows.group);
  // The Toto Line: its stations (station stamps) and the viaduct and trains between them.
  const rails = content.rails;
  // The station's line (station.line, or the first line).
  const lineOfStation = (p: (typeof content.placed)[number]) => rails.find((l) => l.id === (p.stamp.station?.line ?? rails[0]?.id));
  const railStations: RailStation[] = content.placed
    .filter((p) => p.stamp.landmark === 'station')
    .flatMap((p) => {
      const l = lineOfStation(p);
      return l ? [railStation(l, p.id, p.stamp.station!, p.building.x, p.building.z)] : [];
    });
  // The new trains (real/trainCar.ts, under review): walk about inside while they run. ?transit=new turns them on.
  const transitNew = params.get('transit') === 'new';
  const carMats: CarMaterials | null = transitNew ? { city, glass: carGlass(), ads: taxiAds } : null;
  useNewBuses(carMats);
  const trainLines = new Map(rails.map((l) => [l.id, new TrainSystem(l, railStations.filter((s) => s.line === l.id), city, carMats)]));
  for (const t of trainLines.values()) {
    scene.add(t.group);
    // (The viaduct stands still; the trains in the same group move.)
    t.group.children[0].updateMatrixWorld(true);
    t.group.children[0].matrixAutoUpdate = false;
    district.addColliders(viaductPiers(t.line, railStations.filter((s) => s.line === t.line.id)));
  }
  /** The line you're riding, if any. */
  const trainRiding = (): TrainSystem | null => [...trainLines.values()].find((t) => t.riding) ?? null;
  // The subway: tunnels and trains below ground (shown only there), and its stations (landmarks, below).
  const subway = new SubwaySystem(content.subway, city, carMats);
  subway.group.visible = false;
  scene.add(subway.group);
  const subwayViews: { view: SubwayStationView; x: number; z: number }[] = [];
  // Landmarks with a part below ground (the terminal's underground mall): their plaza stays shown (you see
  // it up the stairs), the part below only below ground or nearby.
  const rotaries: { r: RotaryBuilt; x: number; z: number }[] = [];
  // Landmark exteriors by placement (an interior hides its building's exterior while you're inside).
  const exteriors = new Map<string, Pick<AsagiriBuilt, 'group' | 'parts'>>();
  // Everything on the surface, hidden below ground (the stations' own groups stay: they reach up to the street).
  const surface: THREE.Object3D[] = [];
  // Traffic: cars and taxis clockwise round their loops, buses anticlockwise round theirs.
  const piers = rails.flatMap((l) => l.segments);
  const plan = (mx: number, my: number) => district.plan(mx, my);
  // Every grid-corner junction has signals; scramble crossings add a pedestrian phase.
  const scrambles = new Set(
    content.placed.filter((p) => p.stamp.scramble).map((p) => `${Math.round((p.rect.x + p.stamp.scramble![0]) / CELL)},${Math.round((p.rect.y + p.stamp.scramble![1]) / CELL)}`),
  );
  const signals = new Signals(scrambles);
  setTrafficGround(groundAt);
  const traffic = new TrafficSystem(
    carLoops(content.macro, content.traffic, plan, expressway.rampColliders()).map((c) => ({ route: routeFor(c.rect, true, plan, piers), spacing: c.spacing })),
    content.traffic.buses.map((line) => ({ line, route: routeFor(line.rect, false, plan, piers) })),
    city,
    signals,
    { signs, taxiAds, layout: atlas },
    (x, z) => {
      const p = plan(Math.floor(x / CELL), Math.floor(z / CELL));
      return p ? carMixFor(p.style, p.kind) : CITY_CARS;
    },
    carMats,
  );
  if (debug && transitNew) {
    // Checks: stand at the front door of a bus that's standing at a stop with its doors open (true if there is one).
    (window as unknown as { __gotoBus: () => boolean }).__gotoBus = () => {
      const vs = (traffic as unknown as { vehicles: { obj: THREE.Object3D; dx: number; dz: number; bus2?: unknown }[] }).vehicles;
      for (const v of vs) {
        if (!v.bus2 || traffic.busDoors(v as never) < 0.85) continue;
        const zf = (BUS.FRONT_DOOR[0] + BUS.FRONT_DOOR[1]) / 2;
        const x = v.obj.position.x + v.dx * zf + v.dz * (BUS.W + 1.0);
        const z = v.obj.position.z + v.dz * zf - v.dx * (BUS.W + 1.0);
        camera.position.set(x, groundAt(x, z) + 1.7, z);
        controls.setLevel(groundAt(x, z));
        controls.setView((Math.atan2(v.dz, -v.dx) * 180) / Math.PI, 0);
        return true;
      }
      return false;
    };
  }
  const signalLamps = new SignalLamps(signals, (x, z, r) => district.signalsNear(x, z, r));
  scene.add(traffic.group, signalLamps.mesh);
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
  // What drifts down: snow in snowy weather, petals in spring, leaves in autumn.
  const drift = new Drift(cityU);
  // Water thrown up by tyres through puddles.
  const splashes = new Splashes(cityU);
  scene.add(splashes.group);
  scene.add(rain.group, rainLayers.group, streetWater.group, cones.mesh, lampShadows.group, drift.points);
  const windVec = new THREE.Vector2();
  const windTarget = new THREE.Vector2();
  let skyTime = 0;
  // The viaduct keeps the rain off the street under it.
  for (const l of rails) {
    if (l.kind !== 'train') continue;
    for (const q of l.segments) district.shelters.push({ rect: { x: q.x0 - 5, y: q.z0 - 5, w: q.x1 - q.x0 + 10, h: q.z1 - q.z0 + 10 }, y0: -1, y1: 7.8 });
  }
  district.addColliders(traffic.colliders);
  // The landmarks' trees (for the petals and leaves falling under them), recorded as they're built.
  const landmarkTrees: { x: number; z: number; y: number; species: TreeSpecies; reach: number }[] = [];
  let treeY = 0;
  setTreeSink((t) => landmarkTrees.push({ ...t, y: treeY }));
  for (const placed of content.placed) {
    const lm = placed.stamp.landmark;
    // On a hill, the landmark stands level at its footing (everything it adds to the scene lifted with it).
    const sceneBefore = scene.children.length;
    const updatesBefore = landmarkUpdates.length;
    let still = true;
    const b0 = placed.building;
    const footing = content.terrain.footing(b0.x, b0.z, b0.w, b0.d);
    treeY = footing ?? 0;
    if (lm && (ASAGIRI_KINDS as readonly string[]).includes(lm)) {
      const a = buildAsagiri(lm as AsagiriKind, placed.building, placed.id, city, ghost, cityU);
      scene.add(a.group);
      exteriors.set(placed.id, a);
      screens.add(...a.lights);
      glows.add(...a.lights);
      landmarkUpdates.push(a.update);
      still = !a.moves;
    } else if (lm === 'subway') {
      const stop = content.subway.stops.get(placed.id);
      const line = stop && content.subway.lines.find((l) => l.id === stop.line);
      if (stop && line) {
        const view = buildSubwayStation(placed.building, { stop, line, lines: content.subway.lines.filter((l) => l.kind === 'subway'), departures: () => subway.departures(stop), passage: placed.stamp.passage }, city);
        scene.add(view.group);
        subwayViews.push({ view, x: stop.x, z: stop.z });
      }
    } else if (lm === 'rotary') {
      const r = buildRotary(placed.building, city, ghost);
      scene.add(r.group);
      rotaries.push({ r, x: placed.building.x, z: placed.building.z });
      landmarkUpdates.push(() => r.update(cityU));
    } else if (lm === 'station' && lineOfStation(placed)) {
      const l = lineOfStation(placed)!;
      const other = railStations.find((s) => s.line === l.id && s.id !== placed.id)?.names ?? null;
      scene.add(buildStation(placed.building, city, placed.stamp.station!, other, l));
    } else if (lm === 'mega_sign') {
      const mega = buildMegaSign(cityU, city);
      mega.group.position.set(placed.building.x, 0, placed.building.z);
      scene.add(mega.group);
      for (const l of mega.lights) l.centre.add(mega.group.position);
      screens.add(...mega.lights);
      glows.add(...mega.lights);
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
      exteriors.set(placed.id, { group: h.group, parts: {} });
      landmarkUpdates.push(h.update);
    }
    if (footing) for (let i = sceneBefore; i < scene.children.length; i++) scene.children[i].position.y += footing;
    // A landmark with nothing that moves (no update of its own, or a kit one only lighting its neon) stays put.
    if (still && (landmarkUpdates.length === updatesBefore || (lm && (ASAGIRI_KINDS as readonly string[]).includes(lm)))) for (let i = sceneBefore; i < scene.children.length; i++) freeze(scene.children[i]);
  }
  setTreeSink(null);
  // (Landmarks on the city material cast their shadows through its caster too: their trees' leaf cards.)
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material === city && m.castShadow) m.customDepthMaterial = cityDepth;
  });
  // The surface: the city, traffic, weather and the other landmarks (everything but the subway's own).
  for (const o of scene.children) if (o !== subway.group && !subwayViews.some((v) => v.view.group === o) && !rotaries.some((v) => v.r.group === o) && !(o instanceof THREE.Light) && o !== sky.mesh) surface.push(o);
  // Door-entered interiors (real/interiors.ts), at their buildings' true positions: built as you approach,
  // shown (with the exterior hidden and the collision swapped) while you're inside the footprint.
  // Built a slice at a time as you approach (a few ms a frame), all at once if you step in first. Escalators
  // carry a walker standing on them (dt > 0: the frame's time).
  const interiors = content.placed
    .filter((p) => interiorFor(p))
    .map((p) => {
      const def = interiorFor(p)!;
      return { id: p.id, b: p.building, range: def.range, hides: def.hides, keep: !!def.keep, layout: def.layout(p.building), start: () => def.build(p.building, city, ghost), job: null as Generator<void, Interior> | null, built: null as Interior | null, active: false };
    });
  const inInterior = (): boolean => interiors.some((i) => i.active);
  const updateInteriors = (dt = 0): void => {
    const cp = camera.position;
    for (const it of interiors) {
      if (!it.built) {
        const near = Math.hypot(it.b.x - cp.x, it.b.z - cp.z) < it.range;
        if (!near && !it.job) continue;
        it.job ??= it.start();
        const rush = it.layout.contains(cp.x, cp.z, cp.y);
        const until = performance.now() + 3;
        let r = it.job.next();
        while (!r.done && (rush || performance.now() < until)) r = it.job.next();
        if (!r.done) continue;
        it.job = null;
        it.built = r.value;
        scene.add(it.built.group);
        // Upload its signs now, not on the first step inside.
        it.built.group.traverse((o) => {
          const map = ((o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined)?.map;
          if (map) renderer.initTexture(map);
        });
      }
      const inside = !!it.built && it.built.contains(cp.x, cp.z, cp.y);
      if (inside !== it.active) {
        it.active = inside;
        it.built!.group.visible = inside;
        const ext = exteriors.get(it.id);
        const shell = it.keep ? null : it.hides ? ext?.parts[it.hides] : ext?.group;
        if (shell) shell.visible = !inside;
        district.setInterior(it.id, inside ? it.built : null);
      }
      if (it.active && dt > 0 && !controls.fly && it.built!.carry) {
        const level = district.floorAt(cp.x, cp.z, cp.y - 1.7);
        const v = it.built!.carry(cp.x, cp.z, level);
        if (v && !district.blocked(cp.x + v[0] * dt, cp.z + v[1] * dt, 0.4, level)) {
          cp.x += v[0] * dt;
          cp.z += v[1] * dt;
        }
      }
    }
  };
  const visibleNode = (n: Node3): boolean => n.condition === null || n.condition(flags.get);
  const npcBlocked = (x: number, z: number, r: number): boolean =>
    nodes.some((n) => n.kind === 'npc' && visibleNode(n) && Math.hypot(n.x - x, n.z - z) < r + 0.35);

  // After the last train the entrances' shutters are down (from outside: anyone still below can get out).
  const shutters = content.placed.filter((p) => p.stamp.landmark === 'subway').map((p) => ({ shut: subwayShutter(p.building), inside: { x: p.rect.x, y: p.rect.y, w: p.rect.w, h: p.rect.h } }));
  const shutterBlocked = (x: number, z: number, r: number): boolean => {
    if (!late()) return false;
    const cp = camera.position;
    return shutters.some(({ shut, inside }) => {
      const within = cp.x > inside.x && cp.x < inside.x + inside.w && cp.z > inside.y && cp.z < inside.y + inside.h;
      return !within && cp.y > 0.5 && x > shut.x - r && x < shut.x + shut.w + r && z > shut.y - r && z < shut.y + shut.h + r;
    });
  };
  const controls = new FirstPerson(camera, document.body, (x, z, r, floor) => district.blocked(x, z, r, floor) || ((floor ?? 0) > -1 && (floor ?? 0) < 1 && (npcBlocked(x, z, r) || traffic.blocked(x, z, r) || shutterBlocked(x, z, r))));
  controls.setShearMode(false);
  controls.fly = params.get('fly') === '1';
  controls.floorAt = district.floorAt;
  /** Walking about inside a moving train (the new cars). */
  const rider = new CabinRider(camera, controls);
  /** The ride you're walking about in: the train's system, and what to call when you're off. */
  let cabin: Cabin | null = null;
  /** Walking about in a train or a bus: its doors, where it stands, getting off, and the HUD's line. */
  interface Cabin {
    /** How open the doors are. */
    doors(): number;
    /** Whether E gets you off now (not at the stop you boarded at: there E skips on). */
    canLeave(): boolean;
    /** The station it's standing at (a train), or null (a bus). */
    atKey(): string | null;
    /** You're off: a train shuts its doors and pulls away (a bus goes on). */
    alight(): void;
    /** Off by E (or a door with no floor outside): put the walker where they'd be (the platform, the pavement). */
    fallback(): void;
    /** E with the doors shut: skip to your stop (a train) or press the stop button (a bus). */
    press(): void;
    status(): string;
    /** The bus you're on, if it's a bus. */
    readonly bus?: Parameters<TrafficSystem['busRide']>[0];
    done(key: string | null): void;
  }
  /** On a train or a subway: walking about in one, or (the district's cars) standing in one. */
  if (debug) Object.assign(window, { __rider: rider, __trains: trainLines, __subway: subway });
  const aboard = (): boolean => rider.active || (!!trainRiding() && !trainRiding()!.walkable) || (subway.riding && !subway.walkable);
  // Footsteps and landings, by what's underfoot, wet or not, and under cover (set each frame below).
  let stepCover: 'open' | 'roof' | 'enclosed' = 'open';
  const stepSound = (run: boolean, land?: number): void => {
    const p = camera.position;
    audio.step(district.surfaceAt(p.x, p.z, district.aboveGround(p.x, p.z, p.y) - 1.7), { run, wet: cityU.uWet.value, cover: stepCover, volume: mood.volume, land });
  };
  controls.onStep = (run) => stepSound(run);
  controls.onLand = (speed) => stepSound(false, speed);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const YAW: Record<string, number> = { north: 0, south: 180, east: -90, west: 90 };
  const teleport = (id: string): void => {
    const n = nodeById.get(id)!;
    // Inside first (an interior's storeys decide the floor), then the level.
    // (A node's floor is from the ground under it: on a hill, add the ground.)
    const floor = n.floor + groundAt(n.x, n.z);
    camera.position.set(n.x, floor + 1.7, n.z);
    updateInteriors();
    const level = district.floorAt(n.x, n.z, floor);
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
  const mapLines: MapLine[] = [
    ...content.subway.lines.map((l) => ({ name: `${l.name} ${l.nameEn}`, color: l.color, letter: l.letter, stops: l.stops.map((s) => ({ x: s.x, z: s.z, code: s.code, name: `${s.jp} ${s.en}` })) })),
    // The Toto Line is in the subway network (as an elevated line) since the terminal; only add it here if not.
  ];
  const goPlace = (d: Destination): void => {
    const floor = d.floor + groundAt(d.x, d.z);
    camera.position.set(d.x, floor + 1.7, d.z);
    updateInteriors();
    const level = district.floorAt(d.x, d.z, floor);
    camera.position.set(d.x, controls.fly ? Math.max(camera.position.y, 1.7) : level + 1.7, d.z);
    controls.setLevel(level);
    controls.setView(d.yaw, d.pitch);
  };
  const travel = new TravelMap(district, content.zones, allPlaces(), (d: Destination) => {
    goPlace(d);
    travel.hide();
    controls.lock();
  }, { travel: debug, lines: mapLines, mark: (m) => setGps(m), expressway: expressway.roads });
  const picker = new RoutePicker(content.subway);
  // Short messages at the top of the screen.
  const toastEl = document.createElement('div');
  Object.assign(toastEl.style, { position: 'fixed', top: '18%', left: '50%', transform: 'translateX(-50%)', padding: '10px 18px', background: 'rgba(8, 8, 14, 0.85)', border: '1px solid #3a3850', color: '#e8e6f0', font: "14px 'Consolas', monospace", zIndex: '16', display: 'none', pointerEvents: 'none' });
  document.body.append(toastEl);
  let toastTimer = 0;
  const toast = (text: string, seconds = 4): void => {
    toastEl.textContent = text;
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.style.display = 'none'), seconds * 1000);
  };
  const LAST_TRAIN = '終電 · The last train has gone. Trains run again from 5:00.';
  const applyLate = (): void => {
    subway.running = !late();
    for (const t of trainLines.values()) t.running = !late();
    for (const v of subwayViews) v.view.setClosed(late());
  };
  applyLate();
  flags.subscribe((k) => {
    if (k === FLAG_LATE) applyLate();
  });
  // Station sounds on a ride: the departure melody (each station its own), the door chime on arrival.
  subway.onEvent = (kind, stop) => (kind === 'depart' ? audio.melody(hash(stop.key.length, stop.s | 0, 0x5eed)) : audio.chime());
  for (const t of trainLines.values()) {
    t.onEvent = (e) => {
      if (e.kind === 'depart') audio.melody(hash(e.stop.key.length, e.stop.s | 0, 0x5eed));
      else if (e.kind === 'arrive') audio.chime();
    };
  }
  if (params.get('diag') === '1') Object.assign(window, { __scene: scene, __renderer: renderer, __dof: dof, __audio: audio, __city: cityU, __traffic: traffic, __strike: () => {
    const d = camera.getWorldDirection(new THREE.Vector3());
    lightning.strikeNow(camera.position, { x: d.x, z: d.z });
  },
  // What the GPU is sent from here: triangles and draws in view (visible and in the frustum) by top-level group.
  __tris: () => {
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const out: Record<string, { tris: number; draws: number }> = {};
    const sphere = new THREE.Sphere();
    for (const top of scene.children) {
      const name = top.name || top.type + (top.children.length ? `(${top.children.length})` : '');
      const acc = (out[name] ??= { tris: 0, draws: 0 });
      top.traverseVisible((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.geometry) return;
        const g = m.geometry;
        if (m.frustumCulled) {
          const bs = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).boundingSphere : g.boundingSphere ?? (g.computeBoundingSphere(), g.boundingSphere);
          if (bs && !frustum.intersectsSphere(sphere.copy(bs).applyMatrix4(m.matrixWorld))) return;
        }
        const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
        acc.tris += n * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
        acc.draws++;
      });
    }
    return Object.entries(out).filter(([, v]) => v.tris > 0).sort((a, b) => b[1].tris - a[1].tris).map(([k, v]) => `${k}: ${Math.round(v.tris / 1000)}k tris, ${v.draws} draws`);
  } });
  // Review hook for screenshot scripts: point the view (yaw, pitch in degrees).
  (window as unknown as { __look: (y: number, p: number) => void }).__look = (y, p) => controls.setView(y, p);
  // ?spawn= takes any node: a spawn puts you there; a door, hotspot, npc or station stands you just in front of it,
  // facing it (stepping back less where something's in the way).
  const standBy = (n: Node3): void => {
    for (const step of [1.4, 1.0, 0.6, 0]) {
      const x = n.x + n.nx * step;
      const z = n.z + n.nz * step;
      const floor = n.floor + groundAt(x, z);
      camera.position.set(x, floor + 1.7, z);
      updateInteriors();
      const level = district.floorAt(x, z, floor);
      if (step > 0 && district.blocked(x, z, 0.3, level)) continue;
      camera.position.y = level + 1.7;
      controls.setLevel(level);
      controls.setView(step > 0 ? (Math.atan2(n.nx, n.nz) * 180) / Math.PI : YAW[n.facing ?? 'north'], -8);
      return;
    }
  };
  const spawnParam = params.get('spawn');
  const spawnNode = spawnParam ? nodeById.get(spawnParam) : undefined;
  if (spawnParam && !spawnNode) toast(`?spawn=${spawnParam}: no such node`);
  if (spawnNode && spawnNode.kind !== 'spawn') standBy(spawnNode);
  else teleport(spawnNode ? spawnNode.id : START_SPAWN);
  const cam = params.get('cam')?.split(',').map(Number);
  if (cam && cam.length === 5 && cam.every(Number.isFinite)) {
    camera.position.set(cam[0], cam[1], cam[2]);
    // Underground (or on a platform), the walker stands on the level nearest the camera's feet.
    updateInteriors();
    controls.setLevel(district.floorAt(cam[0], cam[2], cam[1] - 1.7));
    controls.setView(cam[3], cam[4]);
  }

  if (me) {
    camera.position.set(me.at.x, me.at.y, me.at.z);
    updateInteriors();
    controls.setLevel(district.floorAt(me.at.x, me.at.z, me.at.y - 1.7));
    controls.setView(me.at.yaw, me.at.pitch);
  }
  // Warm start: the workers build the neighbourhood (every stage) before the first frame.
  $('overlay').textContent = 'building the city...';
  const warm0 = performance.now();
  await district.warm(camera.position);
  const warmMs = performance.now() - warm0;
  const warmChunks = district.loaded;

  // The clock: running (half a game minute a real second) except in scenes, menus and the benchmark; its flags kept
  // up to date (the minute, the time of day's look, the last train); jumps for waiting, sleep, taxis and the story.
  let clockTotal = Number(flags.get(FLAG_CLOCK) ?? startTotal);
  let clockStopped = false;
  // The forecast's weather last applied: a new spell changes the weather (so a change by hand lasts till then).
  const num = (k: string): number | null => (typeof flags.get(k) === 'number' ? (flags.get(k) as number) : null);
  const outlookNow = (total = Math.floor(clockTotal)) => outlookAt(total, season(), Number(flags.get(FLAG_SEASON_START) ?? 0), { typhoonAt: num(FLAG_TYPHOON_AT), heatUntil: num(FLAG_HEAT_UNTIL) });
  // The forecast's own wind (a typhoon's), and how far it turns the setting's direction.
  let forecastWind = 0;
  let forecastTurn = 0;
  let lastForecast = outlookNow().weather;
  const syncClockFlags = (): void => {
    const total = Math.floor(clockTotal);
    flags.set(FLAG_CLOCK, total);
    flags.set(FLAG_TIME, phaseAt(total % DAY));
    flags.set(FLAG_LATE, lateAt(total % DAY));
    const o = outlookNow(total);
    flags.set(FLAG_TSUYU, o.tsuyu);
    flags.set(FLAG_HEAT, o.heat);
    flags.set(FLAG_TYPHOON, o.typhoon > 0.05);
    const held = flags.get(FLAG_WEATHER_HOLD) === true;
    if (!held && o.amount > 0) flags.set(FLAG_RAIN_AMOUNT, o.amount);
    forecastWind = held ? 0 : o.wind;
    forecastTurn = held ? 0 : o.turn;
    if (o.weather !== lastForecast) {
      lastForecast = o.weather;
      if (!held) flags.set(FLAG_WEATHER, o.weather);
    }
  };
  const advanceClock = (minutes: number): void => {
    clockTotal += Math.max(0, minutes);
    syncClockFlags();
  };
  const clockNow = (): string => clockLabel(clockAt(Math.floor(clockTotal)));
  /** Let time pass (a wait, sleep): fade out, the clock running on, fade back in on the new time. */
  const waitFor = async (minutes: number, what = 'Waiting'): Promise<void> => {
    if (inVn || minutes <= 0) return;
    inVn = true;
    await fadeTo(1);
    const from = clockTotal;
    for (let i = 1; i <= 20; i++) {
      clockTotal = from + (minutes * i) / 20;
      // (The flag too, each step: the frame loop takes the flag's minute as the truth when they differ.)
      syncClockFlags();
      toast(`${what}… ${clockNow()}`, 1.5);
      await new Promise((r) => setTimeout(r, 45));
    }
    syncClockFlags();
    applyAtmosphere();
    await new Promise((r) => setTimeout(r, 250));
    await fadeTo(0);
    inVn = false;
    toast(clockNow(), 3);
  };
  const waitPanel = new WaitPanel(() => Math.floor(clockTotal), (m) => {
    controls.lock();
    void waitFor(m);
  });
  // The story asks for a time of day by flag (time_morning, time_noon, time_evening, time_night, time_late): the
  // clock runs on to it (a scene that needs night; later, choreographed scenes).
  flags.subscribe((k) => {
    const m = /^time_(morning|noon|evening|night|late)$/.exec(k);
    if (!m || flags.get(k) !== true) return;
    flags.set(k, false);
    advanceClock(untilMinute(Math.floor(clockTotal), TIMES_OF_DAY[m[1] as NamedTime]));
  });
  if (debug) (window as unknown as { __clock: unknown }).__clock = { now: () => clockNow(), total: () => clockTotal, advance: (m: number) => advanceClock(m), wait: (m: number) => waitFor(m), outlook: (t?: number) => outlookNow(t), sun: () => sky.uniforms.uSunDir.value };

  // Atmosphere: re-applied whenever (district, time, weather) changes.
  let atm!: Atmosphere3;
  let atmKey = '';
  const applyAtmosphere = (): void => {
    const minute = Math.floor(clockTotal) % DAY;
    const key = `${minute}|${weather()}`;
    if (key === atmKey) return;
    atmKey = key;
    const bl = blendAt(minute);
    atm = blendAtmosphere(content.atmosphere.resolve('neon', bl.a, weather()), content.atmosphere.resolve('neon', bl.b, weather()), bl.f);
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
    // Sun shadows in clear weather with the sun high enough, faded in and out with it (never switched: a change in
    // the number of shadow-casting lights recompiles every shader, and the clock crosses dawn and dusk); the map
    // only redraws while they show.
    const sunShadow = clear ? Math.max(0, Math.min(1, (atm.sun - 0.8) / 0.4)) : 0;
    sun.shadow.intensity = sunShadow;
    sun.shadow.autoUpdate = sunShadow > 0;
    // (Drawn at least once, so the map exists for the shaders that read it: a night start never draws it otherwise.)
    if (!sun.shadow.map) sun.shadow.needsUpdate = true;
    const d = sunDirAt(minute);
    sky.uniforms.uSunDir.value.set(d[0], d[1], d[2]).normalize();
    sky.uniforms.uZenith.value.setHex(atm.sky);
    sky.uniforms.uHorizon.value.setHex(atm.horizon);
    sky.uniforms.uSunColor.value.setHex(atm.sunColor).multiplyScalar(1 - 0.75 * atm.lamps);
    sky.uniforms.uDisc.value = clear ? 1 : 0;
    sky.uniforms.uStars.value = clear ? Math.max(0, Math.min(1, (atm.lamps - 0.7) / 0.3)) : 0;
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
  let rainAmount = -1;
  let rainTarget = 0;
  /** The wind now: the setting's, the season's breeze and the forecast's (a typhoon). */
  let windNow = 0;
  /** A heat wave's hold on the light now (0-1, by day). */
  let heatNow = 0;
  let wetness = -1;
  let sunBase = 0;
  let lightGainBase = 1;
  let wasUnder = false;
  const surfaceShown = new Map<THREE.Object3D, boolean>();
  // The walker's last position (for their velocity: the traffic looks where they're heading).
  const lastWalker = new THREE.Vector3().copy(camera.position);
  let cycleTick = 1;
  const applyMood = (): void => {
    const fog = scene.fog as THREE.Fog;
    // How hard it rains: the forecast's (a drizzle to a downpour), eased in and out each frame; the K panel's
    // setting at once.
    rainTarget = mood.rain ?? (atm.rain > 0 ? Math.max(0.12, Math.min(1, Number(flags.get(FLAG_RAIN_AMOUNT) ?? 0.45))) : 0);
    if (mood.rain !== null || rainAmount < 0) rainAmount = rainTarget;
    const d = mood.darkness;
    const keep = 1 - 0.9 * d;
    // Heavy rain and wind-blown spray close the view in; the fog setting scales the density.
    const vis = (1 - rainAmount * 0.45) * (1 - Math.min(1, windNow) * rainAmount * 0.3) / mood.fog;
    base.fogNear = atm.fogNear * vis;
    base.fogFar = atm.fogFar * vis;
    fog.color.setHex(atm.fog).multiplyScalar(1 - 0.8 * d);
    base.hemi = atm.hemi * keep;
    // At night the moon has no shadows (they only switch on for a strong sun), so it lights every wall facing it
    // evenly; the atmosphere keeps it faint. The slider overrides it: 1.0 is the old, brighter moon (0.22).
    const night = atm.lamps > 0.5;
    sun.intensity = (night && mood.moon !== null ? mood.moon * 0.22 : atm.sun) * keep;
    sunBase = sun.intensity;
    base.zenith.setHex(atm.sky).multiplyScalar(1 - 0.85 * d);
    base.horizon.setHex(atm.horizon).multiplyScalar(1 - 0.85 * d);
    // A heat wave by day: a blazing sun (hard light, hard shadows, its glare: grade.ts), a clear bright sky with a
    // white-hot horizon, warm light thrown back off the hot ground, and hardly a cloud.
    const heatHaze = flags.get(FLAG_HEAT) === true && weather() === 'clear' ? Math.max(0, Math.min(1, (0.5 - atm.lamps) / 0.4)) : 0;
    sun.color.setHex(atm.sunColor);
    hemi.color.setHex(atm.hemiSky);
    hemi.groundColor.setHex(atm.hemiGround);
    sky.uniforms.uSunColor.value.setHex(atm.sunColor).multiplyScalar((1 - 0.75 * atm.lamps) * (1 + 0.15 * heatHaze));
    if (heatHaze > 0) {
      const h = heatHaze;
      base.zenith.lerp(HEAT_ZENITH, 0.35 * h);
      base.horizon.lerp(HEAT_HAZE, 0.45 * h);
      base.fogFar *= 1 - 0.15 * h;
      fog.color.lerp(HEAT_HAZE, 0.35 * h);
      sun.intensity *= 1 + 0.9 * h;
      sunBase = sun.intensity;
      sun.color.lerp(HEAT_SUN, 0.45 * h);
      hemi.color.lerp(HEAT_FILL, 0.25 * h);
      hemi.groundColor.lerp(HEAT_GROUND, 0.5 * h);
      base.hemi *= 1 + 0.1 * h;
    }
    // The sun (or moon) for the leaves' glow against it.
    cityU.uSunDir.value.copy(sky.uniforms.uSunDir.value as THREE.Vector3).normalize();
    cityU.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity);
    base.cloudLit.setHex(atm.cloudLit).multiplyScalar(1 - 0.7 * d);
    sky.uniforms.uCloudDark.value.setHex(atm.cloudDark).multiplyScalar(1 - 0.7 * d);
    // (Autumn skies are cloudier.)
    const clouds = flags.get(FLAG_TSUYU) === true ? atm.clouds + (1 - atm.clouds) * 0.75 : season() === 'autumn' ? atm.clouds + (1 - atm.clouds) * 0.4 : atm.clouds;
    sky.uniforms.uCover.value = rainAmount > 0 ? Math.max(clouds, 0.75 + rainAmount * 0.25) : clouds * (1 - 0.75 * heatHaze);
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
    lightGainBase = cityU.uLightGain.value;
    cityU.uDark.value = d;
    dof.strength = mood.dof;
    dof.focus = mood.focus;
    renderer.toneMappingExposure = atm.exposure * (1 - 0.3 * d) * (1 + 0.1 * heatHaze);
    heatNow = heatHaze;
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
  // VN mode: the stories exported from the VN generator (content/vn/); a node no story knows shows the placeholder.
  const vnLibrary = loadVnLibrary();
  if (vnLibrary.errors.length) console.error(`VN content:\n${vnLibrary.errors.join('\n')}`);
  const bridge = new VnPlayer(vnLibrary, { get: flags.get, set: (k, v) => flags.set(k, v) }, new PlaceholderVnBridge($('vn')), (id) => nodeById.get(id)?.kind === 'spawn', debug);
  // The phone (Tab): the KAIWA messenger, conversations in content/phone/ that arrive as story flags come true.
  const phoneContent = loadPhoneContent();
  if (phoneContent.errors.length) console.error(`Phone content:\n${phoneContent.errors.join('\n')}`);
  // ?debug=1&flags=met_x,asked_y: set story flags from the start (to try conversations).
  if (debug) for (const f of (params.get('flags') ?? '').split(',').filter(Boolean)) flags.set(f, true);
  const phone = new Phone(phoneContent.contacts, { get: flags.get, set: (k, v) => flags.set(k, v) });
  if (me?.phone) phone.restore(me.phone);
  const phoneUi = new PhoneUI(phone, phoneContent.url, {
    onOpen: () => document.exitPointerLock(),
    onClose: () => controls.lock(),
    onMessage: () => audio.ping(),
    blocked: () => bench || document.body.classList.contains('vn-on') || travel.open,
  });
  if (debug) (window as unknown as { __traffic: unknown }).__traffic = traffic;
  if (debug) (window as unknown as { __phone: unknown }).__phone = { phone, ui: phoneUi, skip: (s: number) => phoneUi.update(phone.update(s)) };
  // ?debug=1: window.__vn('bar_kanpai.mama') plays a node's scene (for screenshots and checks).
  if (debug) {
    (window as unknown as { __vn: (id: string) => void }).__vn = (id) => {
      const n = nodeById.get(id)!;
      controls.setView((Math.atan2(-(n.x - camera.position.x), -(n.z - camera.position.z)) * 180) / Math.PI, 0);
      void bridge.enter(n);
    };
  }
  let inVn = false;
  // What the game handles itself when you press E, rather than the story (the VN): your garage, sleeping, trains
  // and elevators, plain doorways, a racer's challenge. The demo edition has no story, so only these can be used.
  const gameplayNode = (n: Node3): boolean =>
    n.id === 'city_garage.door' ||
    (n.kind === 'hotspot' && !!n.sleep) ||
    (n.kind === 'station' && !!n.returnSpawn) ||
    (n.kind === 'door' && !!n.returnSpawn && !!n.through) ||
    content.races.some((r) => r.host === n.id);
  const forward = new THREE.Vector3();
  const target = (): Node3 | null => {
    camera.getWorldDirection(forward);
    let best: Node3 | null = null;
    let bestD = 3.2;
    const level = camAbove() - 1.7;
    for (const n of nodes) {
      if (n.trigger !== 'interact' || !visibleNode(n) || Math.abs(n.floor - level) > 2) continue;
      if (!edition.narrative && !gameplayNode(n)) continue;
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
    if (driving.car) return exitCar();
    if (taxiHere()) return getInTaxi();
    const bus = transitNew && !rider.active ? traffic.busToBoard(camera.position) : null;
    if (bus) return boardBus(bus);
    const n = target();
    if (n) return use(n);
    const car = takeableCar();
    if (car) enterCar(car);
  };
  // Driving: your own car (ownCar.ts), which lives in its bay at your garage (夜鷹ガレージ, by the Toto Line)
  // or wherever you left it. E by it takes the wheel; E again gets out. Cars in traffic aren't yours to take.
  const driving = new Driving(camera, (x, z, r) => district.blocked(x, z, r, 0) || traffic.blocked(x, z, r, driving.car) || npcBlocked(x, z, r));
  // The Tōto Expressway (expressway.ts): the elevated inner loop, its ramps and its exits to the passes.
  district.extraColliders.push(...expressway.streetColliders());
  // Set pieces you drive up (real/denko.ts: the car park's floors and ramps) join the network as decks.
  for (const p of content.placed) if (p.stamp.landmark === 'car_park') expressway.addDecks(carParkDecks(p.building, p.id));
  // The bay and the river (real/sea.ts): water over the map's water cells, seawalls where built land meets it.
  const sea = buildSea(content.macro, CELL, (mx, my) => district.model.has(mx, my) || onAirfield(mx, my), cityU.uHorizon, content.bridges, content.terrain);
  // Hanejima's airfield and its traffic (real/airport.ts).
  const airport = buildAirport(transitNew ? city : null);
  scene.add(airport.group);
  scene.add(sea.group);
  freeze(sea.group);
  // The city's edges (real/edges.ts): forest over the hills, a fringe of houses at their foot; the mountains beyond
  // are in the sky.
  const edges = buildEdges(content.macro, CELL, content.terrain, (mx, my) => district.model.has(mx, my) || onAirfield(mx, my));
  scene.add(edges.group);
  freeze(edges.group);
  surface.push(edges.group);
  sky.uniforms.uMountains.value = 1;
  // The season (district/seasons.ts): the trees, the lawns, the forest on the hills, snow on the mountains. The story
  // moves it by flag (season_spring ... season_winter).
  const seasonWind = (): number => (season() === 'autumn' ? 0.3 : season() === 'spring' ? 0.1 : 0);
  const applySeason = (): void => {
    // (The atmosphere again: autumn's cloudier sky.)
    atmKey = '';
    const i = seasonIndex(season());
    cityU.uSeason.value = i;
    edges.setSeason(i);
    sky.uniforms.uWinter.value = season() === 'winter' ? 1 : 0;
  };
  applySeason();
  flags.subscribe((k) => {
    const want = seasonFlag(k);
    if (want && flags.get(k) === true) {
      flags.set(k, false);
      flags.set(FLAG_SEASON, want);
    }
    if (k === FLAG_SEASON) {
      // (A new season starts now: summer opens with its rainy season.)
      flags.set(FLAG_SEASON_START, Math.floor(clockTotal));
      applySeason();
    }
    // Snow means winter (the forecast only snows then; snow set by hand, from R, the debug menu or the story,
    // brings the winter with it: bare trees, the snowy mountains).
    if (k === FLAG_WEATHER && weather() === 'snow' && season() !== 'winter') flags.set(FLAG_SEASON, 'winter');
  });
  // Snow and the traffic (real/tracks.ts, city.ts): the moving cars nearest you have their wipers going, and every
  // wheel on the street near you presses a track into the snow.
  const tracks = new TrackMap(cityU);
  const wheelMap = new Map<unknown, Wheel[]>();
  if (debug) (window as unknown as { __tracks: unknown }).__tracks = { tracks, wheelMap, rect: cityU.uTrackRect.value, wipers: cityU.uWiperCount, litter: cityU.uLitter, litterCount: cityU.uLitterCount, reach: cityU.uLitterReach };
  const wheelsOf = (x: number, z: number, y: number, dx: number, dz: number, half: number, width: number): Wheel[] => {
    const f = Math.max(0.6, half - 0.8);
    const w = width / 2 - 0.2;
    return [[f, w], [f, -w], [-f, w], [-f, -w]].map(([a, b]) => ({ x: x + dx * a + dz * b, z: z + dz * a - dx * b, y }));
  };
  // Splashes: water thrown up where a wheel runs through a puddle, yours or the traffic's near you, and its sound
  // (a whoosh as a car hits one, and on while it ploughs through).
  const splashT = new Map<unknown, number>();
  const updateSplashes = (dt: number, wet: number): void => {
    splashes.update(dt, 0.12 + 0.5 * (1 - cityU.uLamps.value));
    if (wet <= 0.35) return;
    const cp = camera.position;
    const yaw = (lookYaw() * Math.PI) / 180;
    const through = (key: unknown, wheels: readonly (readonly [number, number])[], y: number, fx: number, fz: number, speed: number, you: boolean): void => {
      if (Math.abs(speed) < 2.5) return;
      let deepest = 0;
      let at = 0;
      wheels.forEach(([x, z], i) => {
        const d = puddleAt(x, z, wet);
        if (d > 0.15) splashes.emit(x, y, z, fx, fz, i % 2 === 0 ? 1 : -1, speed, d, dt);
        if (d > deepest) [deepest, at] = [d, i];
      });
      const t = (splashT.get(key) ?? 0) - dt;
      if (deepest > 0.3 && t <= 0) {
        const [x, z] = wheels[at];
        const dx = x - cp.x;
        const dz = z - cp.z;
        const dist = Math.hypot(dx, dz);
        const right = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / Math.max(dist, 0.1);
        audio.splash(Math.min(1, (Math.abs(speed) / 22) * deepest), you ? right * 0.6 : right, you ? 1 : Math.min(1, 7 / Math.max(dist, 1)));
        splashT.set(key, 0.4);
      } else splashT.set(key, deepest > 0.3 ? t : Math.min(t, 0));
    };
    if (driving.own && !ownCar.aloft()) {
      const c = ownCar.sim;
      through(ownCar, carWheels(c, 1.3, -1.25, 0.75), c.y, Math.sin(c.h), Math.cos(c.h), c.u, true);
    }
    for (const v of traffic.movingNear(cp, 60)) {
      const f = Math.max(0.6, v.half - 0.8);
      const w = v.width / 2 - 0.15;
      through(v.key, [[v.x + v.dx * f + v.dz * w, v.z + v.dz * f - v.dx * w], [v.x + v.dx * f - v.dz * w, v.z + v.dz * f + v.dx * w], [v.x - v.dx * f + v.dz * w, v.z - v.dz * f - v.dx * w], [v.x - v.dx * f - v.dz * w, v.z - v.dz * f + v.dx * w]], v.y, v.dx, v.dz, v.v, false);
    }
  };
  // Summer's insects (real/audio.ts): the cicadas by day (a few in the rainy season, loud in a heat wave, into
  // the first days of autumn), the higurashi at dawn and dusk; more among trees, none at night or underground.
  const insects = (): { cicadas: number; higurashi: number } => {
    const m = Math.floor(clockTotal) % DAY;
    const o = outlookNow();
    const autumnDays = (Math.floor(clockTotal) - Number(flags.get(FLAG_SEASON_START) ?? 0)) / DAY;
    const sing = season() === 'summer' ? (o.tsuyu ? 0.3 : o.heat ? 1 : 0.65) : season() === 'autumn' && autumnDays < 10 ? 0.3 : 0;
    if (!sing || camera.position.y < -2.6 || o.typhoon > 0.2) return { cicadas: 0, higurashi: 0 };
    const trees = 0.35 + 0.65 * Math.min(1, treesNear / 10);
    const day = m >= 7 * 60 && m < 18 * 60 ? 1 : m >= 6 * 60 && m < 19 * 60 ? 0.4 : 0;
    const dusk = (m >= 17 * 60 + 30 && m < 19 * 60 + 30) || (m >= 4 * 60 + 30 && m < 5 * 60 + 45) ? 1 : 0;
    return { cicadas: sing * day * trees, higurashi: (season() === 'summer' ? 0.9 : 0.5) * dusk * trees };
  };
  const updateSnowTraffic = (dt: number, snowing: boolean): void => {
    const moving = snowCover > 0.02 ? traffic.movingNear(camera.position, 130) : [];
    const own = driving.own && !ownCar.aloft() ? ownCar.sim : null;
    const wipers = cityU.uWipers.value;
    let n = 0;
    if (own && n < WIPERS) wipers[n++].set(own.x, own.z, own.h, own.y);
    for (const v of moving) {
      if (n >= WIPERS) break;
      if (!v.bus) wipers[n++].set(v.x, v.z, Math.atan2(v.dx, v.dz), v.y);
    }
    cityU.uWiperCount.value = snowCover > 0.02 ? n : 0;
    wheelMap.clear();
    for (const v of moving) wheelMap.set(v.key, wheelsOf(v.x, v.z, v.y, v.dx, v.dz, v.half, v.width));
    if (own) wheelMap.set(ownCar, wheelsOf(own.x, own.z, own.y, Math.sin(own.h), Math.cos(own.h), 2.1, 1.75));
    tracks.update(renderer, dt, camera.position, snowCover, snowing, wheelMap);
  };
  // Petals (spring) and leaves (autumn) under the trees near you: the cherries and dogwoods in spring, the
  // deciduous trees in autumn, on the ground under them (city.ts litterAt) and falling (Drift). Slots stay put while
  // their tree stays near, so the falling points don't jump from tree to tree.
  const litterCode = (sp: TreeSpecies, s: Season): number => {
    const g = sp === 'zelkova' ? 0 : sp.startsWith('ginkgo') ? 1 : sp.startsWith('sakura') ? 2 : sp.startsWith('dogwood') ? 3 : -1;
    return s === 'spring' ? (g === 2 || g === 3 ? g : -1) : s === 'autumn' ? g : -1;
  };
  const litterSlots: (string | null)[] = new Array(LITTER).fill(null);
  let litterT = 1;
  const litterAt = new THREE.Vector3(1e9, 0, 0);
  let litterSeason = '';
  /** Trees within 45 m of you (the cicadas sing from them). */
  let treesNear = 0;
  const refreshLitter = (dt: number): void => {
    litterT += dt;
    const cp = camera.position;
    if (litterSeason === season() && (litterT < 1 || cp.distanceToSquared(litterAt) < 16)) return;
    litterT = 0;
    litterAt.copy(cp);
    litterSeason = season();
    const s = season();
    const cand: { key: string; x: number; z: number; y: number; r: number; code: number; d: number }[] = [];
    treesNear = 0;
    const add = (x: number, z: number, y: number, species: TreeSpecies, reach: number): void => {
      const code = litterCode(species, s);
      const d = Math.hypot(x - cp.x, z - cp.z);
      if (d < 45) treesNear++;
      if (code >= 0 && d < 95) cand.push({ key: `${Math.round(x * 4)},${Math.round(z * 4)}`, x, z, y, r: reach, code, d });
    };
    {
      const mx0 = Math.floor(cp.x / CELL);
      const my0 = Math.floor(cp.z / CELL);
      for (let my = my0 - 1; my <= my0 + 1; my++) {
        for (let mx = mx0 - 1; mx <= mx0 + 1; mx++) {
          const d = district.model.detail(mx, my);
          if (!d) continue;
          for (const list of [d.props, ...d.open.map((o) => o.props)]) {
            for (const p of list) {
              if (p.kind !== 'tree' || !p.species) continue;
              const k = p.size ?? 1;
              const lean = p.lean ?? 0;
              add(p.x + p.nx * lean, p.z + p.nz * lean, groundAt(p.x, p.z), p.species, TREE_REACH[p.species] * k);
            }
          }
        }
      }
      for (const t of landmarkTrees) add(t.x, t.z, t.y, t.species, t.reach);
    }
    cand.sort((a, b) => a.d - b.d);
    const chosen = cand.slice(0, LITTER);
    const byKey = new Map(chosen.map((c) => [c.key, c]));
    // Keep the slots of trees still chosen; the rest go to the new ones.
    for (let i = 0; i < LITTER; i++) if (litterSlots[i] && !byKey.has(litterSlots[i]!)) litterSlots[i] = null;
    const placed = new Set(litterSlots.filter(Boolean));
    for (const c of chosen) {
      if (placed.has(c.key)) continue;
      const free = litterSlots.indexOf(null);
      if (free < 0) break;
      litterSlots[free] = c.key;
    }
    let count = 0;
    litterSlots.forEach((key, i) => {
      const c = key ? byKey.get(key) : undefined;
      cityU.uLitter.value[i].set(c ? c.x : 0, c ? c.z : 0, c ? c.r : 0, c ? c.code + 8 * Math.max(0, Math.round(c.y * 2)) : 0);
      if (c) count = i + 1;
    });
    cityU.uLitterCount.value = count;
    cityU.uLitterReach.value = cand.length > LITTER ? Math.max(30, chosen[chosen.length - 1].d) : 95;
  };
  let snowCover = params.has('snowcover') ? Math.max(0, Math.min(1, Number(params.get('snowcover')))) : weather() === 'snow' ? 0.8 : 0;
  if (debug) (window as unknown as { __sea: unknown }).__sea = { sea, renderer, horizon: cityU.uHorizon };
  const exView = buildExpressway(expressway, city);
  const exTraffic = new ExpresswayTraffic(expressway, city, undefined, { signs, taxiAds, layout: atlas });
  scene.add(exView.group, exTraffic.group);
  freeze(exView.group);
  const sodium = exView.group.getObjectByName('sodium') as THREE.Mesh;
  const bay = nodeById.get('city_garage.bay');
  if (me?.profile) saveProfile(me.profile);
  if (me?.car) {
    try {
      localStorage.setItem('citypop.city.car', JSON.stringify(me.car));
    } catch {
      /* this session only */
    }
  }
  const ownCar = new OwnCar(
    city,
    traffic,
    bay ? { x: bay.x, z: bay.z, h: Math.atan2(bay.nx, bay.nz) } : { x: camera.position.x + 4, z: camera.position.z, h: 0 },
    // What's in the way (crash.ts): people stop you; other vehicles are hard; the district says hard or soft.
    (x, z, r, self) => (npcBlocked(x, z, r) ? 'person' : traffic.blocked(x, z, r, self) ? 'car' : district.obstacle(x, z, r)),
    expressway,
    () => exTraffic.obstacles,
    params.get('car') === 'home',
    content.terrain,
  );
  // Back from a pass (race.html's 'Back to the city'): on the loop just past that exit's corner, driving.
  const back = params.get('from');
  const exitRoad = back ? expressway.roads.find((r) => r.kind === 'spur' && r.id === back) : undefined;
  if (exitRoad) {
    // A route heading away from the tunnel from near its mouth (the other deck of a two-way route): on it, a
    // little way along. Else (a loop's corner) on the loop, just past the corner.
    const near = (r: typeof exitRoad): { i: number; d: number } => {
      let i = 0;
      let d = Infinity;
      for (let k = 0; k < r.x.length; k++) {
        const e = Math.hypot(r.x[k] - exitRoad.x[0], r.z[k] - exitRoad.z[0]);
        if (e < d) [i, d] = [k, e];
      }
      return { i, d };
    };
    const away = expressway.roads
      .filter((r) => r.kind === 'route')
      .map((r) => ({ r, ...near(r) }))
      .find(({ r, i, d }) => d < 30 && r.tx[i] * exitRoad.tx[0] + r.tz[i] * exitRoad.tz[0] < -0.5);
    const L = away?.r ?? expressway.loop;
    const i = away ? Math.min(L.x.length - 1, away.i + 30) : (near(L).i + 55) % L.x.length;
    ownCar.place(L.x[i] + L.tz[i] * 1.8, L.z[i] - L.tx[i] * 1.8, Math.atan2(L.tx[i], L.tz[i]), L.y[i]);
    ownCar.sim.u = 16;
  }
  let leavingFor: string | null = null;
  // Taxis (taxi.ts): H at the kerb waves one down; it pulls in beside you; E gets in and you say where to.
  const taxiPicker = new TaxiPicker();
  const places = allPlaces();
  /** The ride under way: from, to, the fare, and the seconds it lasts (sped up) and has run. */
  let taxiRide: { dest: Destination; fare: number; t: number; T: number; x0: number; z0: number; path: [number, number][]; cum: number[]; heading?: number } | null = null;
  const hailTaxi = (): void => {
    if (driving.car || taxiRide || inVn || Math.abs(camAbove() - 1.7) > 1.2) return;
    const h = traffic.hailTaxi(camera.position);
    toast(h ? 'タクシー! A taxi is pulling in for you: E to get in when it stops.' : 'No free taxi coming this way. Stand at the kerb of a main street (the cell-edge roads) and try again.', 4);
  };
  const taxiHere = (): boolean => {
    const h = traffic.hail;
    return !!h && h.stopped && Math.hypot(h.taxi.x - camera.position.x, h.taxi.z - camera.position.z) < 10;
  };
  const getInTaxi = (): void => {
    const profile = loadProfile();
    document.exitPointerLock();
    taxiPicker.show({ x: camera.position.x, z: camera.position.z }, places, profile.yen, late(), (d) => {
      // The way a car goes (the GPS's driving grid: along the carriageways), else the grid's L.
      const x0 = camera.position.x;
      const z0 = camera.position.z;
      const path = navGrid('drive').route(x0, z0, d.x, d.z) ?? [[x0, z0], [d.x, z0], [d.x, d.z]];
      const cum = [0];
      for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
      const m = Math.max(cum[cum.length - 1], rideMetres(x0, z0, d.x, d.z) * 0.7);
      // The ride takes a few seconds per kilometre (the city going by, sped up); E skips.
      taxiRide = { dest: d, fare: fare(m, late()), t: 0, T: Math.min(24, 5 + (m / 1000) * 5), x0, z0, path, cum };
      controls.held = true;
      controls.lock();
      toast(`${d.name} · 〜¥${taxiRide.fare.toLocaleString('en-US')} · E to skip the ride`, 4);
    });
  };
  const endTaxi = async (): Promise<void> => {
    const r = taxiRide!;
    taxiRide = null;
    traffic.releaseHail();
    await fadeTo(1);
    // The ride's time through the streets (about 25 km/h, lights and all).
    advanceClock((r.cum[r.cum.length - 1] / 1000) * 2.4);
    const profile = loadProfile();
    const paid = Math.min(profile.yen, r.fare);
    profile.yen -= paid;
    saveProfile(profile);
    const floor = r.dest.floor + groundAt(r.dest.x, r.dest.z);
    camera.position.set(r.dest.x, floor + 1.7, r.dest.z);
    updateInteriors();
    controls.setLevel(district.floorAt(r.dest.x, r.dest.z, floor));
    controls.setView(r.dest.yaw, r.dest.pitch);
    controls.held = false;
    await fadeTo(0);
    toast(paid < r.fare ? `The driver takes the ¥${paid.toLocaleString('en-US')} you have, with a look. どうも。` : `¥${paid.toLocaleString('en-US')} · ありがとうございました`, 4);
  };
  /** The back seat: the camera in the taxi, looking out of the side window, the city passing (a straight line, sped up). */
  const rideTaxi = (dt: number): void => {
    const r = taxiRide!;
    r.t += dt;
    const k = Math.min(1, r.t / r.T);
    const e = k * k * (3 - 2 * k);
    // Along the route: where we are on it, and the way it's heading (eased round the corners).
    const total = r.cum[r.cum.length - 1] || 1;
    const at = (d: number): [number, number] => {
      let i = 1;
      while (i < r.path.length - 1 && r.cum[i] < d) i++;
      const f = (d - r.cum[i - 1]) / (r.cum[i] - r.cum[i - 1] || 1);
      return [r.path[i - 1][0] + (r.path[i][0] - r.path[i - 1][0]) * Math.min(1, Math.max(0, f)), r.path[i - 1][1] + (r.path[i][1] - r.path[i - 1][1]) * Math.min(1, Math.max(0, f))];
    };
    const [x, z] = at(e * total);
    const [ax, az] = at(Math.min(total, e * total + 30));
    const want = Math.atan2(ax - x, az - z);
    r.heading = r.heading === undefined ? want : r.heading + Math.atan2(Math.sin(want - r.heading), Math.cos(want - r.heading)) * Math.min(1, dt * 3);
    // From the back seat (behind the driver, on the left): ahead down the street, turned a little to the side.
    camera.position.set(x, 1.3, z);
    const look = r.heading + 0.3;
    camera.lookAt(x + Math.sin(look) * 10, 1.25, z + Math.cos(look) * 10);
    meterEl.style.display = 'block';
    meterEl.innerHTML = `<b>¥${Math.round((r.fare * Math.min(1, 0.3 + e * 0.7)) / 10) * 10}</b> 賃走 ${r.dest.name}`;
    if (r.t >= r.T) void endTaxi();
  };
  const meterEl = document.createElement('div');
  Object.assign(meterEl.style, { position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', display: 'none', padding: '8px 18px', background: 'rgba(8,8,16,0.85)', border: '1px solid #ffd34f', borderRadius: '4px', font: "15px Consolas, 'Yu Gothic', monospace", color: '#ffd34f', zIndex: '6' } satisfies Partial<CSSStyleDeclaration>);
  document.body.append(meterEl);
  const takeableCar = (): DrivenVehicle | null => {
    if (controls.fly || inVn || Math.abs(camAbove() - 1.7) > 1.2) return null;
    camera.getWorldDirection(forward);
    return traffic.takeable(camera.position, forward.x, forward.z, 2.2, false, true);
  };
  scene.add(ownCar.smoke);
  // Totalled (crash.ts): the car won't go; a moment later the tow truck has it, back in its bay at your
  // garage, and you're on the street where it happened. The garage repairs it.
  ownCar.onTotaled = () => {
    toast('大破 Totalled. Get out: the tow truck will take it to your garage.', 6);
  };
  const towHome = async (): Promise<void> => {
    if (!bay) return;
    await fadeTo(1);
    ownCar.place(bay.x, bay.z, Math.atan2(bay.nx, bay.nz));
    ownCar.save();
    await fadeTo(0);
    toast('Your car was towed to your garage. It needs repairing before you can drive it (the garage: E at its door).', 7);
  };
  // Races in the city (district/cityRace.ts, races.yaml): a host at a PA offers them; you and a rival on the
  // expressway through its traffic; first to the line wins (and pays).
  const raceHud = new RaceHud();
  let race: { st: RaceState; path: RacePath; rival: RaceRival; you: number; paid: boolean } | null = null;
  const startRace = async (def: RaceDef): Promise<void> => {
    inVn = true;
    await fadeTo(1);
    const path = new RacePath(def, expressway);
    // The grid: you in the left lane (keep left), the rival beside you; the loop's traffic cleared from round it.
    const g = path.at(0, 1.8);
    ownCar.place(g.x, g.z, Math.atan2(g.tx, g.tz), g.y);
    if (!driving.car) enterCar(ownCar.vehicle);
    if (path.road === expressway.loop) exTraffic.clearAround(path.index(0));
    const rival = new RaceRival(path, expressway, city, def.rival.skill, def.rival);
    rival.place(0, -1.8);
    scene.add(rival.view.obj);
    rival.sound.start();
    race = { st: new RaceState(path), path, rival, you: 0, paid: false };
    driving.hold = true;
    await new Promise((r) => setTimeout(r, 400));
    await fadeTo(0);
    inVn = false;
  };
  if (debug) (window as unknown as { __race: unknown }).__race = { start: (id: string) => startRace(content.races.find((r) => r.id === id)!), state: () => race && { phase: race.st.phase, t: race.st.t, you: race.you, rival: race.rival.s, result: race.st.result } };
  const endRace = (): void => {
    if (!race) return;
    race.rival.stop();
    scene.remove(race.rival.view.obj);
    driving.hold = false;
    race = null;
  };
  /** Each frame: the rival drives, both cars' progress, knocks between them, the splits, and how it ends. */
  const updateRace = (dt: number): void => {
    if (!race) return;
    const { st, path, rival } = race;
    const pr = path.progress(ownCar.sim.x, ownCar.sim.z, race.you);
    if (pr.off < 14) race.you = pr.s;
    const others = [...exTraffic.obstacles.map((o) => ({ x: o.x, z: o.z, vx: o.vx, vz: o.vz })), { x: ownCar.sim.x, z: ownCar.sim.z, vx: Math.sin(ownCar.sim.h) * ownCar.sim.u, vz: Math.cos(ownCar.sim.h) * ownCar.sim.u }];
    rival.update(inVn ? 0 : dt, others, race.you - rival.s, st.phase === 'countdown', camera.position);
    separateCars(ownCar.sim, rival.car);
    driving.hold = st.phase === 'countdown';
    const split = st.update(inVn ? 0 : dt, race.you, rival.s);
    if (split && split.cp < 3) raceHud.flash(split.gap === null ? `CHECKPOINT ${split.cp + 1} · LEADING` : `CHECKPOINT ${split.cp + 1} · +${split.gap.toFixed(2)} s`, split.gap === null ? '#7cffb0' : '#ff9a9a');
    if (st.phase === 'racing') {
      if (!driving.own) st.finish(false, 'You got out of the car.');
      else if (ownCar.totaled) st.finish(false, 'Your car is wrecked.');
      else if (pr.off > 40) st.finish(false, 'You left the route.');
      else if (rival.s - race.you > 700) st.finish(false, 'Left far behind.');
    }
    if (st.phase === 'finished' && !race.paid) {
      race.paid = true;
      const def = path.def;
      const pay = st.result!.won ? def.pay.win : def.pay.lose;
      const profile = loadProfile();
      earn(profile, pay);
      saveProfile(profile);
      raceHud.result(st, pay, def.rival.name, () => endRace());
    }
  };

  const enterCar = (car: DrivenVehicle): void => {
    if (car === ownCar.vehicle && ownCar.totaled) {
      toast('It won’t start: totalled. Repair it at your garage.', 4);
      return;
    }
    traffic.take(car);
    driving.enter(car, car === ownCar.vehicle ? ownCar : null);
    controls.held = true;
    controls.mouseLook = false;
    toast(`${car.label} · W/S drive · A/D steer · Space handbrake · Q camera · E get out`, 5);
  };
  const exitCar = (): void => {
    // Totalled up on the expressway: the tow truck takes you both down (you to your garage too).
    if (driving.own && ownCar.totaled && ownCar.aloft()) {
      traffic.leave(driving.car!);
      driving.leave();
      controls.held = false;
      controls.mouseLook = true;
      void towHome().then(() => teleport('city_garage.front'));
      return;
    }
    if (driving.own && ownCar.aloft()) return toast('Not on the expressway: take the Kaburo ramp down first.');
    const spot = driving.exitSpot((x, z) => !district.blocked(x, z, 0.4, 0) && !traffic.blocked(x, z, 0.4) && !npcBlocked(x, z, 0.4));
    if (!spot) return toast('No room to get out here.');
    traffic.leave(driving.car!);
    driving.leave();
    camera.position.set(spot.x, 1.7, spot.z);
    lastWalker.copy(camera.position);
    controls.setLevel(0);
    controls.held = false;
    controls.mouseLook = true;
    controls.setView(spot.yawDeg, 0);
    // Out of a totalled car: the tow truck comes for it.
    if (ownCar.totaled) setTimeout(() => void towHome(), 2500);
  };
  // ?debug=1: window.__drive() takes the wheel of your car (bringing it to where you stand, facing your way,
  // if it's more than 15 m off).
  const driveHere = (): string => {
    const yaw = (lookYaw() * Math.PI) / 180;
    if (Math.hypot(ownCar.sim.x - camera.position.x, ownCar.sim.z - camera.position.z) > 15) ownCar.place(camera.position.x, camera.position.z, Math.atan2(-Math.sin(yaw), -Math.cos(yaw)));
    enterCar(ownCar.vehicle);
    return ownCar.name;
  };
  if (debug) (window as unknown as { __drive: () => string; __own: OwnCar }).__drive = driveHere;
  if (exitRoad) enterCar(ownCar.vehicle);
  if (me?.driving && !exitRoad) enterCar(ownCar.vehicle);
  if (debug) (window as unknown as { __own: OwnCar; __ex: Expressway }).__own = ownCar;
  if (debug) (window as unknown as { __taxi: unknown }).__taxi = { hail: () => hailTaxi(), state: () => ({ hail: traffic.hail && { stopped: traffic.hail.stopped, d: Math.hypot(traffic.hail.taxi.x - camera.position.x, traffic.hail.taxi.z - camera.position.z) }, here: taxiHere(), ride: taxiRide && { t: taxiRide.t, T: taxiRide.T, fare: taxiRide.fare } }), getIn: () => getInTaxi(), path: () => taxiRide && { path: taxiRide.path.map((p) => p.map(Math.round)), blocked: taxiRide.path.map((p) => district.blocked(p[0], p[1], 0.5)) }, taxis: () => (traffic as unknown as { vehicles: { label: string; x: number; z: number; mode: string }[] }).vehicles.filter((v) => v.label === 'Taxi').map((v) => [Math.round(v.x), Math.round(v.z), v.mode, Math.round(Math.hypot(v.x - camera.position.x, v.z - camera.position.z))]) };
  if (debug) (window as unknown as { __ex: Expressway }).__ex = expressway;
  // ?debug=1: window.__onExpressway(i, road) puts your car on the loop (or the named ramp or spur) at sample i
  // (outside lane) and takes the wheel.
  if (debug) (window as unknown as { __onExpressway: (i: number, road?: string) => void }).__onExpressway = (i, road) => {
    const L = expressway.roads.find((r) => r.id === road) ?? expressway.loop;
    ownCar.place(L.x[i] + L.tz[i] * 1.8, L.z[i] - L.tx[i] * 1.8, Math.atan2(L.tx[i], L.tz[i]), L.y[i]);
    if (!driving.car) enterCar(ownCar.vehicle);
  };
  // Mouse Y: normal (mouse up looks up) or inverted, for walking and driving alike. I toggles it; the choice is
  // remembered in this browser; ?invertY=1 / 0 sets it.
  const INVERT_KEY = 'citypop.invertY';
  const setInvertY = (on: boolean, save: boolean): void => {
    controls.invertY = on;
    driving.invertY = on;
    if (save) {
      try {
        localStorage.setItem(INVERT_KEY, on ? '1' : '0');
      } catch {
        /* storage blocked: it lasts this session */
      }
    }
  };
  {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(INVERT_KEY);
    } catch {
      /* none */
    }
    const url = params.get('invertY');
    setInvertY((url ?? saved) === '1', url !== null);
  }
  // The GPS: mark a destination on the map (M) or in the phone's Maps app; the route follows the streets for
  // how you're getting about (gps.ts: on foot, or by car on the carriageways only), chevrons light the next
  // stretch of it on the ground, a beacon stands on the destination, and the compass at the top points the way.
  const grids = new Map<NavMode, Router>();
  const navGrid = (mode: NavMode): Router => {
    let g = grids.get(mode);
    if (!g) grids.set(mode, (g = new Router({ bounds: district.bounds, cells: district.cells, plan: (mx, my) => district.plan(mx, my), blocked: content.placed.map((p) => p.rect), cell: CELL, bridges: content.bridges }, mode)));
    return g;
  };
  const guide = new Guide(navGrid);
  guide.subscribe(() => travel.setGps(guide.dest ? { ...guide.dest, route: guide.route } : null));
  const gpsMarks = new GpsMarks();
  scene.add(gpsMarks.group);
  /** Where the GPS routes from: the car you're driving (by road), or you (on foot). */
  const gpsFrom = (): GuideFrom => (driving.car ? { x: driving.car.x, z: driving.car.z, mode: 'drive' } : { x: camera.position.x, z: camera.position.z, mode: 'walk' });
  const setGps = (m: GuideDest | null): void => {
    guide.set(m, gpsFrom());
    if (guide.dest) toast(guide.route ? `GPS: ${guide.dest.label}` : `GPS: ${guide.dest.label} (no way through: heading straight for it)`);
    else toast('GPS cleared');
  };
  const compass = document.createElement('div');
  Object.assign(compass.style, { position: 'fixed', top: '14px', left: '50%', transform: 'translateX(-50%)', zIndex: '16', display: 'none', alignItems: 'center', gap: '10px', padding: '6px 14px 6px 8px', background: 'rgba(8,10,16,0.78)', border: '1px solid #2a4a5a', borderRadius: '18px', color: '#bfefff', font: "13px 'Consolas', monospace", pointerEvents: 'none' });
  const compassArrow = document.createElement('div');
  Object.assign(compassArrow.style, { width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', color: '#5adcff', transition: 'transform 0.12s linear' });
  compassArrow.textContent = '▲';
  const compassText = document.createElement('div');
  compass.append(compassArrow, compassText);
  document.body.append(compass);
  /** Per frame: reroute if you've strayed (or got in or out of a car), arrival, chevrons, beacon, compass. */
  const updateGps = (dt: number): void => {
    const from = gpsFrom();
    const g = guide.update(from);
    if (g?.arrived) toast(`Arrived: ${g.arrived.label}`);
    const dest = guide.dest;
    if (!g || !dest) {
      gpsMarks.update(dt, [], null);
      compass.style.display = 'none';
      return;
    }
    const { at } = g;
    const route = guide.route;
    // Chevrons on the street ahead (not below ground or up in a building).
    const street = (driving.car || Math.abs(camAbove() - 1.7) < 1.2) && !aboard();
    const car = from.mode === 'drive';
    // Driving, the route runs down the road's centre line: the chevrons sit in the left lane (keep left).
    const ahead = (at && route && street ? pointsAhead(route, at.seg, at.t, car ? 90 : 60, car ? 7 : 4.5, car ? 6 : 3) : []).map((p) => (car ? { ...p, x: p.x + p.dz * 1.5, z: p.z - p.dx * 1.5 } : p));
    gpsMarks.update(dt, ahead.map((p) => ({ ...p, y: (driving.own && ownCar.aloft() ? ownCar.sim.y : groundAt(p.x, p.z)) })), { ...dest, y: groundAt(dest.x, dest.z) });
    gpsMarks.group.visible = camera.position.y > -2 && !aboard();
    // The compass: toward the route a little way ahead (or the destination itself), from where you're looking.
    const next = at && route ? (pointsAhead(route, at.seg, at.t, 14, 14, 14)[0] ?? dest) : dest;
    camera.getWorldDirection(forward);
    const tx = next.x - from.x;
    const tz = next.z - from.z;
    const ang = Math.atan2(forward.x * tz - forward.z * tx, forward.x * tx + forward.z * tz);
    compassArrow.style.transform = `rotate(${(ang * 180) / Math.PI}deg)`;
    compassText.textContent = `${car ? '🚗' : '🚶'} ${metres(at ? at.left : g.direct)} · ${dest.label}`;
    compass.style.display = 'flex';
  };
  // The phone's Maps app: the same GPS, in your hand.
  phoneUi.register(
    new PhoneMaps(
      () => travel.baseImage(),
      district.bounds,
      allPlaces(),
      guide,
      () => ({ ...gpsFrom(), yaw: driving.car ? (Math.atan2(-driving.car.dx, -driving.car.dz) * 180) / Math.PI : lookYaw() }),
      (d) => setGps(d),
      (x, z) => district.zoneAt(x, z),
    ),
  );
  // Saving (save/save.ts): the world's flags and the MC's place, car, phone, money and cars. Not in the middle of a
  // ride or a scene (you'd load into a moving train); the autosave waits for those to end.
  const played0 = loaded?.played ?? 0;
  const t0 = performance.now();
  const saveBlocked = (): string | null => (inVn ? 'Not during a scene.' : taxiRide || aboard() ? 'Not during a ride.' : race ? 'Not during a race.' : null);
  const gather = (): SaveGame => {
    const d = camera.getWorldDirection(new THREE.Vector3());
    const p = driving.car ? { x: driving.car.x, z: driving.car.z } : camera.position;
    const zone = district.zoneAt(p.x, p.z);
    const place = `${district.districtAt(p.x, p.z) ?? 'Tōto'}${zone ? ` · ${zone}` : ''}`;
    return {
      v: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      place,
      played: played0 + (performance.now() - t0) / 1000,
      current: 'mc',
      world: { flags: flags.entries() },
      characters: {
        mc: {
          id: 'mc',
          name: 'MC',
          at: { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: lookYaw(), pitch: (Math.asin(Math.max(-1, Math.min(1, d.y))) * 180) / Math.PI },
          driving: !!driving.own,
          car: { x: ownCar.sim.x, z: ownCar.sim.z, h: ownCar.sim.h, y: ownCar.sim.y },
          phone: phone.snapshot(),
          profile: loadProfile(),
        },
      },
    };
  };
  const saveTo = (slot: Slot): string | null => {
    const blocked = saveBlocked();
    if (blocked) return blocked;
    ownCar.save();
    return writeSave(slot, gather()) ? null : 'The browser won’t keep the save (storage blocked or full).';
  };
  const loadFrom = (slot: Slot): void => {
    const url = new URL(location.href);
    for (const k of ['spawn', 'cam', 'car', 'from', 'ride', 'vn', 'load']) url.searchParams.delete(k);
    url.searchParams.set('load', slot);
    void fadeTo(1).then(() => (location.href = url.toString()));
  };
  let autosaveIn = 120;
  const autosave = (): void => {
    if (!saveBlocked()) saveTo('auto');
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') autosave();
  });
  phoneUi.register(new SaveApp(saveTo, loadFrom));
  // 天気, the weather app: the forecast ahead (district/weatherApp.ts).
  phoneUi.register(new WeatherApp({
    now: () => clockTotal,
    at: (t) => outlookNow(t),
    current: () => ({ weather: weather(), amount: rainTarget }),
    season: () => SEASON_NAMES[season()],
  }));
  if (debug) (window as unknown as { __save: unknown }).__save = { save: saveTo, load: loadFrom, gather };
  // ?debug=1: window.__gps('<spawn id>') marks it as the GPS destination (for checks).
  if (debug) (window as unknown as { __gps: (id: string) => boolean }).__gps = (id) => {
    const n = nodeById.get(id);
    if (n) setGps({ x: n.x, z: n.z, label: n.name ?? id });
    return !!guide.route;
  };
  if (debug) (window as unknown as { __guide: Guide }).__guide = guide;

  // The debug menu (` backquote, district/debugMenu.ts): on the dev server, or with ?debug=1.
  const setClockTo = (minute: number): void => {
    clockTotal = Math.floor(clockTotal / DAY) * DAY + minute;
    syncClockFlags();
    applyAtmosphere();
  };
  const shiftClock = (minutes: number): void => {
    clockTotal = Math.max(0, clockTotal + minutes);
    syncClockFlags();
    applyAtmosphere();
  };
  const minuteNow = (): number => Math.floor(clockTotal) % DAY;
  // Driving tuning (race/tuning.ts): the debug menu's Car: tune driving; your car re-specced as you slide.
  const tuningPanel = new TuningPanel('road', (t) => ownCar.retune(t));
  const debugMenu = import.meta.env.DEV || debug
    ? new DebugMenu([
        {
          // Every season, and summer's stages: the rainy season (a new summer), high summer (past it), a heat wave
          // and a typhoon (each starting now, on the forecast).
          title: 'Season',
          items: () => {
            const now = Math.floor(clockTotal);
            const o = outlookNow();
            const go = (x: Season, start: number): void => {
              flags.set(FLAG_HEAT_UNTIL, false);
              flags.set(FLAG_TYPHOON_AT, false);
              flags.set(FLAG_SEASON, x);
              flags.set(FLAG_SEASON_START, start);
            };
            const auto = (): void => {
              flags.set(FLAG_WEATHER_HOLD, false);
              syncClockFlags();
              const w = outlookNow();
              lastForecast = w.weather;
              if (w.amount > 0) flags.set(FLAG_RAIN_AMOUNT, w.amount);
              flags.set(FLAG_WEATHER, w.weather);
            };
            return [
              { label: SEASON_NAMES.spring, on: () => season() === 'spring', run: () => go('spring', now) },
              { label: '夏 梅雨 rainy season', on: () => o.tsuyu, run: () => { go('summer', now); auto(); } },
              { label: '夏 summer', on: () => season() === 'summer' && !o.tsuyu && !o.heat && o.typhoon === 0, run: () => { go('summer', now - 7 * DAY); auto(); } },
              { label: '夏 猛暑 heat wave', on: () => o.heat, run: () => { go('summer', now - 7 * DAY); flags.set(FLAG_HEAT_UNTIL, now + 2 * DAY); auto(); } },
              { label: '台風 typhoon', on: () => o.typhoon > 0, run: () => { if (season() !== 'summer' && season() !== 'autumn') go('summer', now - 7 * DAY); flags.set(FLAG_TYPHOON_AT, now - 8 * 60); auto(); } },
              { label: SEASON_NAMES.autumn, on: () => season() === 'autumn' && o.typhoon === 0, run: () => { go('autumn', now - 20 * DAY); auto(); } },
              { label: SEASON_NAMES.winter, on: () => season() === 'winter', run: () => go('winter', now) },
            ];
          },
        },
        {
          title: () => `Time · ${clockNow()}${clockStopped ? ' · stopped' : ''}`,
          items: () => [
            ...(Object.entries(TIMES_OF_DAY) as [NamedTime, number][]).map(([k, m]) => ({ label: `${k} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, on: () => minuteNow() === m, run: () => setClockTo(m) })),
            { label: 'dawn 05:45', on: () => minuteNow() === 345, run: () => setClockTo(345) },
            { label: '−1 h', run: () => shiftClock(-60) },
            { label: '+1 h', run: () => shiftClock(60) },
            { label: '+1 day', run: () => shiftClock(DAY) },
            { label: clockStopped ? 'start clock' : 'stop clock', on: () => clockStopped, run: () => (clockStopped = !clockStopped) },
          ],
        },
        {
          title: 'Weather',
          items: () => [
            { label: 'auto (forecast)', on: () => flags.get(FLAG_WEATHER_HOLD) !== true, run: () => {
              flags.set(FLAG_WEATHER_HOLD, false);
              const o = outlookNow();
              lastForecast = o.weather;
              if (o.amount > 0) flags.set(FLAG_RAIN_AMOUNT, o.amount);
              flags.set(FLAG_WEATHER, lastForecast);
            } },
            ...WEATHERS.map((w) => ({ label: w, on: () => weather() === w, run: () => {
              flags.set(FLAG_WEATHER_HOLD, true);
              flags.set(FLAG_WEATHER, w);
            } })),
            { label: 'snow cover 0', on: () => snowCover < 0.01, run: () => (snowCover = 0) },
            { label: 'snow cover full', on: () => snowCover > 0.99, run: () => (snowCover = 1) },
          ],
        },
        {
          title: 'Car',
          items: () => [
            { label: driving.car ? 'driving' : 'drive my car here', on: () => !!driving.car, run: () => void (driving.car || driveHere()) },
            { label: 'repair', run: () => ownCar.repair() },
            { label: 'tune driving…', on: () => tuningPanel.open, run: () => (tuningPanel.open ? tuningPanel.hide() : tuningPanel.show(ownCar.sim, ownCar.baseSpec, CITY_ASSISTS)) },
          ],
        },
        {
          title: 'Races',
          items: () => [
            ...content.races.map((r) => ({ label: r.name, on: () => race?.path.def.id === r.id, run: () => void (race ? toast('A race is on.') : startRace(r)) })),
            ...(race ? [{ label: 'end race', run: () => endRace() }] : []),
          ],
        },
        { title: 'Moving', items: () => [{ label: 'fly (F)', on: () => controls.fly, run: () => (controls.fly = !controls.fly) }] },
      ], {
        find: (q): DebugHit[] => {
          const t = q.toLowerCase();
          const score = (s: string): number => (s.toLowerCase().startsWith(t) ? 0 : s.toLowerCase().includes(t) ? 1 : -1);
          const places = allPlaces()
            .map((d) => ({ d, k: Math.min(...[score(d.name), score(d.id)].map((v) => (v < 0 ? 9 : v))) }))
            .filter((x) => x.k < 9)
            .map((x) => ({ k: x.k, hit: { label: x.d.name, detail: x.d.group, go: () => goPlace(x.d) } }));
          const byNode = nodes
            .map((n) => ({ n, k: score(n.id) }))
            .filter((x) => x.k >= 0)
            .map((x) => ({ k: x.k, hit: { label: x.n.id, detail: x.n.kind, go: () => (x.n.kind === 'spawn' ? teleport(x.n.id) : standBy(x.n)) } }));
          return [...places, ...byNode].sort((a, b) => a.k - b.k).map((x) => x.hit);
        },
        flag: { get: (k) => flags.get(k), set: (k, v) => flags.set(k, v) },
        onOpen: () => document.exitPointerLock(),
        onClose: () => {
          if (!inVn) controls.lock();
        },
      })
    : null;
  // The dashboard: speed and gear, while driving.
  const dash = document.createElement('div');
  Object.assign(dash.style, { position: 'fixed', left: '24px', bottom: '22px', zIndex: '16', padding: '8px 14px', background: 'rgba(8,8,14,0.72)', border: '1px solid #3a3850', color: '#e8e6f0', font: "bold 26px 'Consolas', monospace", display: 'none', pointerEvents: 'none' });
  document.body.append(dash);
  // Your car's damage by part, over the speedo (damageHud.ts).
  const damageHud = new DamageHud();
  // F9: a snapshot and a note for reporting an issue (debug/snap.ts, saved to debug-shots/).
  const shot = installSnap(renderer.domElement, 'district', () => ({
    camera: [camera.position.x, camera.position.y, camera.position.z].map((v) => Math.round(v * 10) / 10),
    yaw: Math.round(lookYaw()),
    time: time(),
    weather: weather(),
    driving: driving.car
      ? {
          vehicle: driving.car.label,
          kmh: Math.round(driving.kmh),
          own: !!driving.own,
          ...(driving.own
            ? { at: [ownCar.sim.x, ownCar.sim.y, ownCar.sim.z].map((v) => Math.round(v * 10) / 10), heading: Math.round((ownCar.sim.h * 180) / Math.PI), onExpressway: ownCar.onExpressway(), condition: Math.round(ownCar.condition * 10) / 10, parts: Object.fromEntries(Object.entries(ownCar.parts).map(([k, v]) => [k, Math.round(v * 10) / 10])) }
            : {}),
        }
      : null,
  }));
  const use = async (n: Node3): Promise<void> => {
    if (inVn) return;
    // Your garage: its screen (buy, tune, paint), and back out to the street.
    if (n.id === 'city_garage.door') {
      inVn = true;
      await fadeTo(1);
      location.href = 'garage.html?from=city';
      return;
    }
    if (n.kind === 'hotspot' && n.sleep) {
      await waitFor(sleepUntil(Math.floor(clockTotal)), 'Sleeping');
      autosave();
      return;
    }
    if (n.kind === 'station' && n.returnSpawn) {
      if (content.subway.stops.has(n.placementId)) {
        if (late()) return toast(LAST_TRAIN);
        document.exitPointerLock();
        // The choice is a click: lock the mouse for the ride now, while the gesture counts.
        picker.show(n.placementId, (to) => {
          controls.lock();
          void rideSubway(n.placementId, to);
        });
        return;
      }
      return ride(n.returnSpawn);
    }
    // A plain doorway (into or out of an interior): a fade, and you're through (the interior switches on by where you are).
    if (n.kind === 'door' && n.returnSpawn && n.through) {
      inVn = true;
      await fadeTo(1);
      teleport(n.returnSpawn);
      updateInteriors();
      await new Promise((r) => setTimeout(r, 150));
      await fadeTo(0);
      inVn = false;
      return;
    }
    const offered = content.races.filter((r) => r.host === n.id);
    if (offered.length && !race) {
      document.exitPointerLock();
      raceHud.challenge(n.name ?? 'A racer', offered, ownCar.name, ownCar.totaled, (r) => {
        controls.lock();
        void startRace(r);
      });
      return;
    }
    if (!edition.narrative) return;
    inVn = true;
    document.exitPointerLock();
    // Turn to face whoever you're talking to (the scene plays over the paused city).
    if (n.kind === 'npc') controls.setView((Math.atan2(-(n.x - camera.position.x), -(n.z - camera.position.z)) * 180) / Math.PI, 0);
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
  // Riding the subway: each leg in real time (E skips it); a change of line is a short walk (a fade).
  /**
   * Off the train at the stop it's standing at: out of the door you walked through onto the platform when there's
   * floor there (the near platforms), else (or with E) onto the station's platform spawn after a fade.
   */
  function getOff(door: THREE.Vector3 | null): void {
    const c = cabin;
    if (!c || c.doors() < 0.85) return;
    const key = c.atKey();
    cabin = null;
    if (door) {
      const level = door.y - 1.7;
      const f = district.floorAt(door.x, door.z, level);
      if (Math.abs(f - level) < 0.6 && !district.blocked(door.x, door.z, 0.4, f)) {
        rider.leave();
        controls.setLevel(f);
        camera.position.set(door.x, f + 1.7, door.z);
        c.alight();
        c.done(key);
        return;
      }
    }
    void (async () => {
      inVn = true;
      await fadeTo(1);
      rider.leave();
      c.fallback();
      c.alight();
      await fadeTo(0);
      inVn = false;
      c.done(key);
    })();
  }

  /** The cabin for a train ride (its system's ride in the new cars). */
  const trainCabin = (system: { alight(): void; skip(): void; readonly ride2State: RideState | null; readonly status: string | null }, done: (key: string | null) => void): Cabin => {
    const boarded = system.ride2State?.at?.key ?? null;
    return {
      doors: () => system.ride2State?.doors ?? 0,
      canLeave: () => (system.ride2State?.at?.key ?? null) !== boarded,
      atKey: () => system.ride2State?.at?.key ?? null,
      alight: () => system.alight(),
      fallback: () => {
        const at = system.ride2State?.at;
        if (at) teleport(`${at.key}.platform`);
      },
      press: () => system.skip(),
      status: () => system.status ?? '',
      done,
    };
  };

  /** Board a bus at its front door: pay the flat fare, stand inside facing down the bus. */
  const BUS_FARE = 210;
  function boardBus(v: Parameters<TrafficSystem['busRide']>[0]): void {
    const profile = loadProfile();
    if (!spend(profile, BUS_FARE)) return toast(`Not enough for the fare (¥${BUS_FARE}).`);
    saveProfile(profile);
    rider.board(traffic.busRide(v), 0, 0.72, 4.15, 0);
    audio.chime();
    toast(`IC ¥${BUS_FARE} · ピッ · walk about, sit (E by a seat), E for the stop button, off at the middle door`, 5);
    cabin = {
      bus: v,
      doors: () => traffic.busDoors(v),
      canLeave: () => true,
      atKey: () => null,
      alight: () => undefined,
      fallback: () => {
        // Out of the middle door onto the pavement.
        const z = (BUS.MID_DOOR[0] + BUS.MID_DOOR[1]) / 2;
        v.obj.updateWorldMatrix(true, false);
        const p = new THREE.Vector3(BUS.W + 1.1, 0, z).applyMatrix4(v.obj.matrixWorld);
        const f = district.floorAt(p.x, p.z, groundAt(p.x, p.z));
        controls.setLevel(f);
        camera.position.set(p.x, f + 1.7, p.z);
      },
      press: () => {
        traffic.requestStop(v);
        audio.chime();
        toast('とまります · Stopping at the next stop', 2);
      },
      status: () => {
        const st = traffic.busStops(v);
        return st ? `${st.line.name} ${st.line.en} · ${st.at ? `${st.at} · doors open` : `next: ${st.next}`}` : '';
      },
      done: () => undefined,
    };
  }

  /**
   * A journey in the new trains: each leg's train with you standing in its middle car by the doors; you walk
   * about, sit, and get off by walking out at a stop (the journey ends where you get off; at a change of line the
   * next leg's train takes over).
   */
  async function rideWalk(from: string, to: string): Promise<void> {
    const legs = subwayRoute(content.subway, from, to);
    if (!legs) return;
    inVn = true;
    for (const leg of legs) {
      if (leg.kind === 'transfer') {
        const s = content.subway.stops.get(leg.to)!;
        const l = content.subway.lines.find((x) => x.id === s.line)!;
        toast(`Change here for the ${l.nameEn} (${l.name}): ${s.jp} ${s.en} ${s.code}`, 5);
        continue;
      }
      await fadeTo(1);
      inVn = true;
      const line = content.subway.lines.find((l) => l.id === leg.line)!;
      let ridable: Ridable;
      let system: { alight(): void; skip(): void; readonly ride2State: RideState | null; readonly status: string | null };
      if (line.kind === 'elevated') {
        const tl = trainLines.get(line.id);
        const step = leg.to > leg.from ? 1 : -1;
        const keys: string[] = [];
        for (let i = leg.from; i !== leg.to + step; i += step) keys.push(line.stops[i].key);
        const stations = keys.map((k) => railStations.find((s) => s.id === k)).filter((s): s is RailStation => !!s);
        if (!tl || !tl.walkable || stations.length < 2) break;
        ridable = tl.startRide2(stations);
        system = tl;
      } else {
        ridable = subway.startRide2(leg.line, leg.from, leg.to);
        system = subway;
      }
      // Standing in the middle car by a door on the platform side, facing it (the doors are closing).
      rider.board(ridable, 1, ridable.doorSide * 0.6, CAR.DOORS[1], ridable.doorSide > 0 ? -Math.PI / 2 : Math.PI / 2);
      const got = new Promise<string | null>((done) => (cabin = trainCabin(system, done)));
      await fadeTo(0);
      inVn = false;
      const key = await got;
      // Off before the end of this leg: the journey ends there.
      if (key !== line.stops[leg.to].key) break;
      inVn = true;
    }
    inVn = false;
  }

  async function rideSubway(from: string, to: string): Promise<void> {
    if (transitNew) return rideWalk(from, to);
    const legs = subwayRoute(content.subway, from, to);
    if (!legs) return;
    inVn = true;
    controls.held = true;
    for (const leg of legs) {
      if (leg.kind === 'transfer') {
        const s = content.subway.stops.get(leg.to)!;
        const l = content.subway.lines.find((x) => x.id === s.line)!;
        toast(`Change here for the ${l.nameEn} (${l.name}): ${s.jp} ${s.en} ${s.code}`, 5);
        continue;
      }
      await fadeTo(1);
      const line = content.subway.lines.find((l) => l.id === leg.line)!;
      let done: Promise<void>;
      if (line.kind === 'elevated') {
        // The Toto Line: its own trains along the viaduct (real/rail.ts).
        const tl = trainLines.get(line.id);
        const a = railStations.find((s) => s.id === line.stops[leg.from].key);
        const b = railStations.find((s) => s.id === line.stops[leg.to].key);
        if (!tl || !a || !b) break;
        done = tl.startRide(a, b, camera);
        controls.setView(tl.rideYaw, 0);
      } else {
        done = subway.startRide(leg.line, leg.from, leg.to, camera);
        controls.setView(subway.rideYaw, -3);
      }
      await fadeTo(0);
      inVn = false;
      await done;
      inVn = true;
    }
    await fadeTo(1);
    controls.held = false;
    teleport(`${to}.platform`);
    await fadeTo(0);
    inVn = false;
  }

  const direct: Record<string, OverlayPreset> = { Digit1: 'off', Digit2: 'vibe', Digit3: 'heavy', Digit4: 'ascii' };
  window.addEventListener('keydown', (e) => {
    if (bench || inVn) return;
    if (rider.active && cabin) {
      // Aboard: E sits down (or gets up) by a seat; at a stop with the doors open it gets you off; else it skips
      // to your stop.
      if (e.code !== 'KeyE') return;
      if (rider.seated) rider.stand();
      else if (cabin.doors() > 0.85 && cabin.canLeave()) getOff(null);
      else if (rider.sit()) toast('Sitting · E to get up', 2);
      else cabin.press();
      return;
    }
    const riding = trainRiding();
    if (riding && !riding.walkable) {
      if (e.code === 'KeyE') riding.skip();
      return;
    }
    if (subway.riding && !subway.walkable) {
      if (e.code === 'KeyE') subway.skip();
      return;
    }
    if (picker.open) {
      if (e.code === 'Escape' || e.code === 'KeyE') picker.hide();
      return;
    }
    if (taxiRide) {
      if (e.code === 'KeyE') taxiRide.t = taxiRide.T;
      return;
    }
    if (taxiPicker.open) {
      if (e.code === 'Escape') taxiPicker.hide();
      return;
    }
    if (e.code === 'KeyH') hailTaxi();
    if (e.code === 'KeyL') {
      void waitFor(untilMinute(Math.floor(clockTotal), late() ? 5 * 60 + 30 : TIMES_OF_DAY.late));
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
    if (e.code === 'KeyT') {
      if (driving.car || taxiRide || aboard()) toast("You can't wait here.");
      else {
        document.exitPointerLock();
        waitPanel.show();
      }
    }
    if (e.code === 'KeyR') {
      // (By hand: held until the debug menu's 'auto weather'.)
      flags.set(FLAG_WEATHER_HOLD, true);
      flags.set(FLAG_WEATHER, WEATHERS[(WEATHERS.indexOf(weather()) + 1) % WEATHERS.length]);
    }
    if (e.code === 'KeyF' && !driving.car) controls.fly = !controls.fly;
    if (e.code === 'KeyI') {
      setInvertY(!controls.invertY, true);
      toast(controls.invertY ? 'Mouse Y inverted (mouse up looks down) · I to switch back' : 'Mouse Y normal (mouse up looks up) · I to invert');
    }
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
    if (!bench && !inVn && !travel.open && !panel.open && !picker.open && !taxiPicker.open && !debugMenu?.open) controls.lock();
  });
  controls.look.addEventListener('lock', () => ($('overlay').hidden = true));
  controls.look.addEventListener('unlock', () => ($('overlay').hidden = bench));
  // Debug: start on a ride, ?debug=1&ride=<from station>,<to station> (placement ids, e.g. y01_station,w03_station).
  // ?debug=1&vn=<node id>: stand in front of the node (a step out from an npc), face it, play its scene.
  const vnParam = debug ? params.get('vn') : null;
  if (vnParam) {
    const n = nodeById.get(vnParam);
    if (!n) toast(`?vn=${vnParam}: no such node`);
    else {
      const step = n.kind === 'npc' ? 1.8 : 0;
      const x = n.x + n.nx * step;
      const z = n.z + n.nz * step;
      const floor = n.floor + groundAt(x, z);
      camera.position.set(x, floor + 1.7, z);
      updateInteriors();
      const level = district.floorAt(x, z, floor);
      camera.position.y = level + 1.7;
      controls.setLevel(level);
      void use(n);
    }
  }
  const rideParam = debug ? params.get('ride')?.split(',') : undefined;
  if (rideParam?.length === 2 && content.subway.stops.has(rideParam[0]) && content.subway.stops.has(rideParam[1])) {
    teleport(`${rideParam[0]}.platform`);
    void rideSubway(rideParam[0], rideParam[1]);
  }
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
      rider.before();
      controls.update(dt);
      rider.after();
      if (rider.exited) {
        const p = rider.exited;
        rider.exited = null;
        getOff(p);
      }
    }
    if (bench) controls.update(0);
    for (const update of landmarkUpdates) update(camera.position, dt);
    for (const t of trainLines.values()) t.update(dt, camera);
    subway.update(dt, camera);
    // Riding: the camera goes with the car you're in, wherever it's got to.
    rider.compose();
    updateInteriors(inVn ? 0 : dt);
    if (Number(flags.get(FLAG_CLOCK)) !== Math.floor(clockTotal)) clockTotal = Number(flags.get(FLAG_CLOCK)) || clockTotal;
    if (!bench && !inVn && !travel.open && !waitPanel.open && !clockStopped) {
      const before = Math.floor(clockTotal);
      clockTotal += dt * RATE;
      if (Math.floor(clockTotal) !== before) syncClockFlags();
    }
    if (!bench) {
      phoneUi.update(phone.update(dt));
      phone.clock = Math.floor(clockTotal) % DAY;
      phoneUi.tick(dt);
    }
    // The walker, when on foot at street level, is someone the traffic has to stop for.
    const cp0 = camera.position;
    if (!inVn) driving.update(dt);
    ownCar.pose(inVn ? 0 : dt);
    if (taxiRide && !inVn) rideTaxi(dt);
    else meterEl.style.display = 'none';
    // Walked away from the taxi you hailed: it gives up after a while and drives on.
    const hail = traffic.hail;
    if (hail && !taxiRide && !taxiPicker.open && Math.hypot(hail.taxi.x - camera.position.x, hail.taxi.z - camera.position.z) > 60) traffic.releaseHail();
    // The expressway: its traffic (slowing for you in its lane), the sodium lamps' light at night, and the
    // tunnels at the end of the exits (drive in: you're at that pass).
    const onLoop = ownCar.onExpressway() ? expressway.at(ownCar.sim.x, ownCar.sim.z, ownCar.sim.y) : null;
    const rivalOn = race ? expressway.at(race.rival.car.x, race.rival.car.z, race.rival.car.y) : null;
    exTraffic.update(inVn ? 0 : dt, onLoop && onLoop.road === expressway.loop ? { i: onLoop.i, lateral: onLoop.lateral, v: ownCar.sim.u } : null, rivalOn && rivalOn.road === expressway.loop ? [{ i: rivalOn.i, lateral: rivalOn.lateral, v: race!.rival.car.u }] : []);
    updateRace(dt);
    raceHud.update(dt, race?.st ?? null, race?.path.def.name ?? '');
    airport.update(inVn ? 0 : dt, time() === 'night' || time() === 'dusk');
    (sodium.material as THREE.MeshBasicMaterial).opacity = cityU.uLamps.value;
    sodium.visible = cityU.uLamps.value > 0.05;
    edges.update(camera.position, cityU.uLamps.value);
    const tunnel = driving.own ? expressway.portal(ownCar.sim.x, ownCar.sim.z, ownCar.sim.y) : null;
    if (tunnel && !leavingFor) {
      leavingFor = tunnel.venue!;
      ownCar.save();
      void fadeTo(1).then(() => (location.href = `race.html?venue=${tunnel.venue}&mode=free&from=${tunnel.id}`));
    }
    updateGps(dt);
    autosaveIn -= dt;
    if (autosaveIn <= 0) {
      autosaveIn = saveBlocked() ? 10 : 120;
      autosave();
    }
    if (driving.bump > 2) audio.bump(driving.bump);
    dash.style.display = driving.car ? 'block' : 'none';
    if (driving.car) dash.textContent = `${Math.round(driving.kmh).toString().padStart(3, ' ')} km/h  ${driving.gear}`;
    damageHud.update(inVn ? 0 : dt, driving.own ? ownCar : null);
    const onFoot = !driving.car && !controls.fly && !inVn && !rider.active && Math.abs(camAbove() - 1.7) < 1.2;
    let wvx = dt > 0 ? (cp0.x - lastWalker.x) / dt : 0;
    let wvz = dt > 0 ? (cp0.z - lastWalker.z) / dt : 0;
    // Faster than anyone runs: a teleport or a ride, not a step.
    if (Math.hypot(wvx, wvz) > 12) wvx = wvz = 0;
    const walkers = onFoot ? [{ x: cp0.x, z: cp0.z, vx: wvx, vz: wvz }] : [];
    lastWalker.set(cp0.x, cp0.y, cp0.z);
    traffic.update(dt, camera.position, walkers);
    if (cabin?.bus) {
      traffic.busScreens(cabin.bus);
      rider.compose();
    }
    // Horns: from where the car is, panned by where it is from the view (yaw 0 looks toward -z; right is +x).
    for (const h of traffic.honks) {
      const yaw = (lookYaw() * Math.PI) / 180;
      const dx = h.x - cp0.x;
      const dz = h.z - cp0.z;
      const d = Math.hypot(dx, dz);
      audio.horn(d, d > 0.1 ? (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d : 0, h.bus);
    }
    traffic.honks.length = 0;
    signalLamps.update(camera.position, traffic.clock);
    screens.update(camera.position, now / 1000, cityU.uNeon.value);
    // Screen glow: dimmer by day, thicker in wet air.
    glows.strength = mood.screenGlow * (0.35 + 0.65 * cityU.uNeon.value) * (1 + 0.8 * Math.min(1, rainAmount + (weather() === 'fog' ? 0.6 : 0)));
    glows.update(now / 1000, cityU.uNeon.value);
    // Streets wet through over ~20-60 s of rain (faster when heavy) and dry over a few minutes.
    const wetTarget = mood.wetness ?? (rainAmount > 0 ? 1 : 0);
    // Rain comes and goes over ten seconds or so (a shower's start, the end of a spell).
    if (Math.abs(rainTarget - rainAmount) > 1e-3) {
      rainAmount += Math.max(-dt / 10, Math.min(dt / 10, rainTarget - rainAmount));
      applyMood();
    }
    const wetRate = mood.wetness !== null ? 2 : wetTarget > wetness ? 0.015 + 0.05 * rainAmount : 0.006;
    wetness += Math.max(-wetRate * dt, Math.min(wetRate * dt, wetTarget - wetness));
    cityU.uWet.value = wetness;
    // Snow settles over a minute or two of snowfall and melts over several once it stops.
    const snowing = weather() === 'snow';
    const snowRate = 0.5 + Number(flags.get(FLAG_RAIN_AMOUNT) ?? 0.45);
    snowCover = Math.max(0, Math.min(1, snowCover + (snowing ? (dt / 80) * snowRate : -dt / 400)));
    cityU.uSnow.value = snowCover;
    edges.setSnow(snowCover);
    sea.setSnow(snowCover);
    updateSnowTraffic(dt, snowing);
    // The weather on the road (district/roadGrip.ts): your car and a race's rival feel it; the traffic drives
    // with care (slower, longer gaps, gentler braking and corners) in rain, fog and snow.
    {
      const onBridge = content.bridges.some((b) => ownCar.sim.x >= b.road.rect.x && ownCar.sim.x <= b.road.rect.x + b.road.rect.w && ownCar.sim.z >= b.road.rect.y && ownCar.sim.z <= b.road.rect.y + b.road.rect.h);
      const road: RoadWeather = { wet: Math.max(0, wetness), snow: snowCover, leaves: season() === 'autumn' ? 1 : 0, wind: [windVec.x / 3.2, windVec.y / 3.2] };
      ownCar.weather = { ...road, exposure: ownCar.aloft() || onBridge ? 1 : 0.45 };
      if (race) race.rival.weather = { ...road, exposure: 1 };
      const fog = weather() === 'fog' ? 1 : 0;
      const cond = { speed: 1 - 0.1 * road.wet - 0.3 * snowCover - 0.15 * fog, gap: 1 + 0.3 * road.wet + 0.9 * snowCover + 0.3 * fog, grip: weatherGrip(road) };
      traffic.conditions = cond;
      exTraffic.conditions = cond;
      updateSplashes(dt, road.wet);
    }
    const outdoors = !inInterior() && camera.position.y > -2.6 && !aboard();
    refreshLitter(dt);
    const breeze = Math.min(1, windVec.length() / 3);
    drift.set(!outdoors ? 'none' : snowing ? 'snow' : season() === 'spring' ? 'petals' : season() === 'autumn' ? 'leaves' : 'none', snowing ? 0.75 : season() === 'spring' ? 0.1 + 0.1 * breeze : 0.07 + 0.2 * breeze);
    tuningPanel.tick();
    drift.update(dt, camera.position, 0.12 + 0.5 * (1 - cityU.uLamps.value), windVec, groundAt(camera.position.x, camera.position.z));
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
    // Autumn is windier (and spring a little): a season's breeze under the setting.
    const windAmt = mood.wind + seasonWind() + forecastWind;
    windNow = windAmt;
    const blow = windAmt * gust;
    const wa = ((mood.windDir + forecastTurn) * Math.PI) / 180;
    // The wind turns and builds with a little inertia rather than snapping to the settings.
    windTarget.set(Math.sin(wa), -Math.cos(wa)).multiplyScalar(blow * 3.2);
    windVec.lerp(windTarget, Math.min(1, dt * 1.5));
    // The trees lean and sway with it (real/city.ts): the way it blows and its strength, easing to a change
    // (the gusts are the shader's own, running downwind through the trees).
    const treeWind = cityU.uWind.value;
    const blowLen = windVec.length();
    if (blowLen > 0.01) treeWind.setX(windVec.x / blowLen).setY(windVec.y / blowLen);
    treeWind.z += (Math.min(1.4, windAmt) - treeWind.z) * Math.min(1, dt * 0.5);
    const cp = camera.position;
    const lamps = (x: number, z: number, r: number) => district.lampsNear(x, z, r);
    // Riding the train, the car is the shelter.
    const shelters = district.sheltersNear(cp.x, cp.z, 45, 11);
    if (rider.active) shelters.unshift({ rect: { x: cp.x - 3.2, y: cp.z - 3.2, w: 6.4, h: 6.4 }, y0: -20, y1: 20 });
    else if (aboard()) shelters.unshift({ rect: { x: cp.x - 1.6, y: cp.z - 30, w: 3.2, h: 60 }, y0: 0, y1: 20 });
    rain.update(tt, dt, cp, rainAmount, windVec, shelters);
    rainLayers.update(tt, cp, rainAmount, windVec, wetness, (scene.fog as THREE.Fog).far, base.horizon, shelters);
    streetWater.update(tt, cp, wetness, windVec, district.sheltersNear(cp.x, cp.z, 30, 24));
    district.umbrellas = rainAmount > 0.15;
    // Wet air spreads the glow round lights.
    bloom.radius = 0.45 + 0.35 * Math.min(1, rainAmount + (weather() === 'fog' ? 0.5 : 0));
    const inside = aboard() || district.sheltered(cp.x, cp.z, cp.y);
    cones.update(cp, lamps, Math.max(atm.haze, rainAmount * 1.2) * atm.lamps * 0.05 * (1 - 0.3 * mood.darkness));
    lampShadows.update(cp, lamps, atm.lamps * 55);
    skyTime += dt * (1 + windAmt * 30);
    sky.uniforms.uTime.value = skyTime;
    grade.tick(tt, inside ? 0 : rainAmount * (1 + mood.wind));
    // A heat wave by day: the shimmer along the horizon (its place on the screen from a point far ahead).
    {
      const fwd = camera.getWorldDirection(new THREE.Vector3());
      const hz = new THREE.Vector3(cp.x + fwd.x * 1000, cp.y, cp.z + fwd.z * 1000).project(camera);
      const day = Math.max(0, Math.min(1, (0.5 - atm.lamps) / 0.4));
      // (It hugs the ground: from up high, little of it.)
      const lowDown = 1 - THREE.MathUtils.smoothstep(cp.y - groundAt(cp.x, cp.z), 4, 30) * 0.85;
      const shimmer = flags.get(FLAG_HEAT) === true && weather() === 'clear' && !inside && cp.y > -2 ? day * (1 - rainAmount) * lowDown : 0;
      grade.heat(shimmer, (hz.y + 1) / 2, overlay.depth, camera.near, camera.far);
      // The sun's glare (clear days, strongest in a heat wave): where the sun is on the screen, if in front.
      const sd = sky.uniforms.uSunDir.value as THREE.Vector3;
      const sp = new THREE.Vector3().copy(cp).addScaledVector(sd, 1000).project(camera);
      const inFront = fwd.dot(sd) > 0 && sd.y > 0.02;
      const clearSky = weather() === 'clear' && rainAmount < 0.05 && !inside && cp.y > -2;
      grade.glare(inFront && clearSky ? day * (0.4 + 0.6 * heatNow) * Math.min(1, sd.y * 8) : 0, (sp.x + 1) / 2, (sp.y + 1) / 2);
    }
    // Lightning in a storm (or on demand): the sky, the clouds and the ambient light flash.
    // Strikes per minute: auto brings them with a real storm (heavy rain and wind).
    const perMinute = mood.lightning === 'storm' ? 6 : mood.lightning === 'occasional' ? 1.2 : mood.lightning === 'auto' && rainAmount > 0.55 && windNow > 0.3 ? 1.5 + 6 * rainAmount * Math.min(1.2, windNow) : 0;
    const flash = lightning.update(dt, perMinute, cp);
    hemi.intensity = base.hemi + flash * 0.5;
    // Below ground: the surface is hidden (and costs nothing), the sky's light and the street's don't reach.
    const under = (subway.riding && !subway.walkable) || (!controls.fly && camera.position.y < -2.6);
    if (under !== wasUnder) {
      if (under) for (const o of surface) surfaceShown.set(o, o.visible);
      else for (const o of surface) o.visible = surfaceShown.get(o) ?? true;
      wasUnder = under;
    }
    if (under) {
      for (const o of surface) o.visible = false;
      hemi.intensity *= 0.12;
      sun.intensity = 0;
      cityU.uLightGain.value = 0;
    } else {
      sun.intensity = sunBase;
      cityU.uLightGain.value = lightGainBase;
    }
    subway.group.visible = under;
    for (const v of rotaries) v.r.below.visible = under || Math.hypot(v.x - cp.x, v.z - cp.z) < 70;
    for (const v of subwayViews) {
      const d = Math.hypot(v.x - cp.x, v.z - cp.z);
      // A station's underground half only below ground (or by its entrance, looking down the stairs).
      v.view.group.visible = d < 450;
      v.view.below.visible = under || d < 40;
      if (d < 120 && under) v.view.update(subway.clock);
    }
    sky.uniforms.uFlash.value = flash;
    sky.uniforms.uFlashDir.value.copy(lightning.dir);
    sky.uniforms.uZenith.value.copy(base.zenith);
    sky.uniforms.uHorizon.value.copy(base.horizon);
    sky.uniforms.uCloudLit.value.copy(base.cloudLit);
    fitFog();
    // Sound follows the same weather: what's overhead, the wind, the nearest cars.
    const cover = aboard() ? 'enclosed' : district.shelterAt(cp.x, cp.z, cp.y)?.enclosed ? 'enclosed' : inside ? 'roof' : 'open';
    stepCover = cover;
    audio.update({
      dt,
      rain: rainAmount,
      wind: windAmt,
      gust,
      cover,
      train: aboard(),
      volume: mood.volume,
      x: cp.x,
      z: cp.z,
      yaw: (lookYaw() * Math.PI) / 180,
      cars: traffic.nearest(cp, 3),
      wet: cityU.uWet.value,
      ...insects(),
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
    // Hidden groups (the subway above ground, interiors you're not in, the surface below ground) skip the matrix
    // update too; the frozen ones always do.
    for (const o of scene.children) o.matrixWorldAutoUpdate = o.visible && !frozen.has(o);
    composer.render(dt);
    shot.afterRender();
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
      const fixedRes = resFixed();
      if (fixedRes !== null) {
        if (Math.abs(resScale - fixedRes) > 0.001) setRes(fixedRes);
      } else if (!inVn && document.visibilityState === 'visible') adaptRes((now - windowStart) / Math.max(1, frames), (now - windowStart) / 1000);
      work = workSum / frames;
      frames = 0;
      workSum = 0;
      windowStart = now;
      const info = renderer.info.render;
      const p = camera.position;
      const t = target();
      const s = district.stats;
      $('hud').textContent = [
        (rider.active && cabin ? `${cabin.status()}  ·  [E] ${rider.seated ? 'stand up' : cabin.doors() > 0.85 && cabin.canLeave() ? 'get off' : rider.seatNear() ? 'sit' : cabin.bus ? 'stop button' : 'skip to your stop'}` : null) ??
        trainRiding()?.status ??
        subway.status ??
        `${late() ? '終電 ·  ' : ''}${(district.districtAt(p.x, p.z) ?? (content.bridges.find((b) => p.x >= b.road.rect.x && p.x <= b.road.rect.x + b.road.rect.w && p.z >= b.road.rect.y && p.z <= b.road.rect.y + b.road.rect.h)?.name ?? (content.macro.kindAt(Math.floor(p.x / CELL), Math.floor(p.z / CELL)) === 'water' ? '東都湾 Tōto Bay' : 'Tōto'))).toUpperCase()}${district.zoneAt(p.x, p.z) ? ` · ${district.zoneAt(p.x, p.z)}` : ''}${district.placeAt(p.x, p.z) ? ` · ${district.placeAt(p.x, p.z)}` : ''}  ·  ${clockNow()} (${time()}) · ${SEASON_NAMES[season()]}${flags.get(FLAG_TSUYU) === true ? ' 梅雨' : ''}${flags.get(FLAG_HEAT) === true ? ' 猛暑' : ''}${flags.get(FLAG_TYPHOON) === true ? ' 台風' : ''} / ${weather()}${controls.fly ? '  ·  FLY' : ''}  ·  ascii: ${overlay.preset}  ·  grade: ${grade.grade}${rainAmount > 0 ? `  ·  rain ${rainAmount.toFixed(2)}` : ''}${mood.wind > 0 ? `  ·  wind ${mood.wind.toFixed(2)}` : ''}${mood.darkness > 0 ? `  ·  dark ${mood.darkness.toFixed(2)}` : ''}${mood.shadows ? `  ·  lamp shadows ${mood.shadows}` : ''}${wetness > 0.01 ? `  ·  wet ${wetness.toFixed(2)}` : ''}${mood.dof ? `  ·  dof ${mood.dof.toFixed(2)} @ ${mood.focus === null ? 'auto' : `${mood.focus.toFixed(1)} m`}` : ''}`,
        `${fps} fps · ${work.toFixed(2)} ms/frame · res ${Math.round(resScale * 100)}%${resFixed() === null ? ' (auto)' : ''} · draw calls ${info.calls} · triangles ${info.triangles.toLocaleString()}`,
        `chunks ${district.loaded} loaded (${district.detailedChunks} detailed) / ${district.cells.length} · ${district.loadedBuildings} buildings · ${district.loadedPeople} people`,
        `bloom ${bloom.enabled ? `strength ${bloom.strength.toFixed(2)} · threshold ${bloom.threshold.toFixed(1)}` : 'off'}  ([ ] strength · ; ' threshold · B toggle)`,
        `${district.workerCount} chunk workers · build avg base ${avg(s.base)} / detail ${avg(s.near)} / people ${avg(s.ghosts)} ms · main-thread integrate avg ${avg(s.integrate)} ms (max ${s.integrate.msMax.toFixed(1)}) · in flight ${district.inFlightCount} · integrated last 0.5 s ${builtThisWindow}`,
        `warm start ${warmChunks} chunks in ${warmMs.toFixed(0)} ms`,
        `pos ${p.x.toFixed(0)}, ${p.z.toFixed(0)} · cell ${Math.floor(p.x / CELL)}, ${Math.floor(p.z / CELL)} · GPU ${gpu}`,
        t && !driving.car ? `[E] ${t.kind === 'door' ? (t.through && inInterior() && interiors.some((i) => i.id === t.placementId) && !interiors.find((i) => i.id === t.placementId)?.layout.contains(nodeById.get(t.returnSpawn ?? '')?.x ?? 0, nodeById.get(t.returnSpawn ?? '')?.z ?? 0, (nodeById.get(t.returnSpawn ?? '')?.floor ?? 0) + 1.7) ? 'Leave for' : 'Enter') : t.kind === 'station' ? (isRailStation(t.placementId) ? (railStations.find((r) => r.id === t.placementId)?.line === 'monorail' ? 'Take the monorail' : 'Take the train') : content.subway.stops.has(t.placementId) ? 'Take the subway' : 'Take the elevator') : t.kind === 'hotspot' ? (t.sleep ? 'Sleep until morning' : 'Look') : 'Talk'}: ${t.name ?? t.id}` : driving.car ? '[E] Get out · W/S drive · A/D steer · Space handbrake · Q camera' : taxiHere() ? '[E] Get in the taxi' : transitNew && !rider.active && traffic.busToBoard(camera.position) ? `[E] Board the bus · ¥${BUS_FARE}` : taxiRide ? '[E] Skip the ride' : takeableCar() ? `[E] Take the wheel: ${takeableCar()!.label}` : ' ',
        `click to look · WASD · Shift run · Space jump (fly: Space up, Ctrl down) · E interact · H hail a taxi${debug ? ' · M map / fast travel' : ''} · T time · R weather · K weather & light panel · C grade · F fly · I invert mouse Y · V ascii (1 off 2 vibe 3 heavy 4 full) · G dither · B bloom · P look${debugMenu ? ' · ` debug menu' : ''}`,
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
function dressDoor(mb: MeshBuilder, n: Node3, r: C3, nn: C3, y = 0): void {
  const o: C3 = [n.x, y, n.z];
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

/** An NPC as a ghost: its stamp's figure, else a woman talking (Bar Kanpai's mama at her door). */
function npcSpec(n: Node3, facing: C3): FigureSpec {
  const yaw = Math.atan2(facing[0], facing[2]);
  const f = n.figure;
  if (f) {
    const c = f.color ?? 0x60c0ff;
    return {
      x: n.x,
      z: n.z,
      y: n.floor,
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
    yaw: yaw + 0.4,
    body: 'woman',
    pose: 'talk',
    color: [1.0, 0.42, 0.72],
    hair: 'bun',
    long: true,
    phase: 0,
    side: 1,
    look: 0.3,
  };
}

const avg = (s: { count: number; msTotal: number }): string => (s.msTotal / Math.max(1, s.count)).toFixed(2);

run().catch((e: unknown) => {
  const pre = $('errors');
  pre.hidden = false;
  pre.textContent = e instanceof ContentError ? e.message : String((e as Error).stack ?? e);
  throw e;
});

/** A distance for the GPS: "85 m", "1.2 km". */
function metres(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(5, Math.round(m / 5) * 5)} m`;
}
