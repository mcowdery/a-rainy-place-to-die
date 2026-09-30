import { Terrain } from './terrain';
import * as THREE from 'three';
import type { DistrictId, MacroMap } from '../../gen/macro';
import type { Lightmap } from '../real/lightmap';
import { KIND } from '../real/meshBuilder';
import { propBlocked, propDist, type Prop } from '../real/props';
import { CAR_PROPS, SOFT_PROPS, WALL_PROPS } from './crash';
import { rawBytes, rawTriangles, toGeometry } from '../real/rawGeometry';
import type { SignAtlas } from '../real/signs';
import type { ChunkBuilt, Stage } from './chunkBuild';
import type { WorkerIn } from './chunkWorker';
import { DistrictModel } from './model';
import { CELL, cellKey, DISTRICTS3, STYLES3, type Building3, type CellPlan3 } from './plan';
import type { Node3, Placed3 } from './stamps';
import type { ZoneMap } from './zones';
import type { Avenues, Bridge3 } from './roads';
import { landmarkColliders, landmarkFloor, landmarkRaisedColliders, landmarkShelters, type Shelter } from './landmarks';
import type { Rect } from '../../core/coords';
import type { Interior } from '../real/interiors';

/** Chunks (one per macro cell) whose centre is within LOAD_RADIUS are built; beyond UNLOAD_RADIUS dropped. */
export const LOAD_RADIUS = 620;
export const UNLOAD_RADIUS = 820;
/** The lightmap's wrapping window in cells (real/lightmap.ts): every loaded chunk must stay within half of it. */
export const LIGHTMAP_WINDOW = 16;
/** Within this, a chunk shows its full detail (built on demand); beyond, plain building masses. */
export const LOD_DISTANCE = 300;
/** Detail is built a little before it's needed and dropped well after. */
const NEAR_BUILD = LOD_DISTANCE + 40;
const NEAR_DROP = LOD_DISTANCE + 160;
/** People (ghosts) are shown within this distance of a chunk's centre, and built a little before. */
const GHOST_DISTANCE = 200;
const GHOST_BUILD = GHOST_DISTANCE + 40;
/**
 * Geometry bytes integrated per frame. Creating the meshes is cheap on the CPU, but their buffers reach the
 * GPU during the next render, and several chunks' worth in one frame (40 MB when streaming fast) is a hitch.
 */
const UPLOAD_BYTES_PER_FRAME = 3e6;
/** Stage requests allowed in flight per worker (keeps the queue short so priorities follow the camera). */
const IN_FLIGHT_PER_WORKER = 2;

/** What the district renders with (created by the page once it has a renderer). */
export interface DistrictKit {
  readonly city: THREE.Material;
  /** The city material's shadow caster (real/city.ts cityDepthMaterial: leaf cards cast only their leaves). */
  readonly cityDepth?: THREE.Material;
  readonly signs: THREE.Material;
  /** Translucent material for people. */
  readonly ghost: THREE.Material;
  /** Photo ads (billboards and posters). */
  readonly ads: THREE.Material;
  readonly atlas: SignAtlas;
  readonly lightmap: Lightmap;
  /** Sign words (the workers rebuild the same sign layout from them). */
  readonly words: readonly string[];
}

interface Chunk {
  readonly key: number;
  readonly mx: number;
  readonly my: number;
  readonly cx: number;
  readonly cz: number;
  readonly group: THREE.Group;
  readonly far: THREE.Mesh | null;
  near: THREE.Group | null;
  ghosts: THREE.Mesh | null;
  umbrellas: THREE.Mesh | null;
  ghostsBuilt: boolean;
  people: number;
  readonly triangles: number;
  nearTriangles: number;
  readonly buildings: readonly Building3[];
}

interface Task {
  readonly id: number;
  readonly key: number;
  readonly stage: Stage;
  readonly worker: number;
}

const stageStats = (): { count: number; msTotal: number; msMax: number } => ({ count: 0, msTotal: 0, msMax: 0 });

/**
 * One district, streamed as chunks. Plans and street furniture are cheap and computed lazily on the main
 * thread for collision (DistrictModel). Geometry is built by a pool of Web Workers (chunkWorker.ts), stage
 * by stage, nearest first: ground + building masses + lightmap tile, then full detail within NEAR_BUILD,
 * then the crowd within GHOST_BUILD. The main thread only turns finished arrays into meshes, within a
 * per-frame time budget, so streaming never stalls a frame on generation.
 */
export class District {
  readonly root = new THREE.Group();
  readonly nodes: readonly Node3[];
  readonly model: DistrictModel;
  /** Worker build times per stage, and main-thread time spent turning results into meshes. */
  readonly stats = { base: stageStats(), near: stageStats(), ghosts: stageStats(), integrate: stageStats(), disposed: 0 };
  private readonly chunks = new Map<number, Chunk>();
  private kit: DistrictKit | null = null;
  private workers: Worker[] = [];
  private readonly ready: Promise<void>[] = [];
  private readonly pending = new Map<string, Task>();
  private readonly inFlight: number[] = [];
  private readonly done: { task: Task; result: ChunkBuilt }[] = [];
  private nextId = 1;
  private wake: (() => void) | null = null;
  /** People carry their umbrellas (while it rains). */
  umbrellas = false;
  /** Geometry bytes integrated by the last update() (they reach the GPU in the next render). */
  lastBytes = 0;

  constructor(
    private readonly macro: MacroMap,
    /** The districts to generate (every district with a 3D style by default). */
    readonly kinds: DistrictId | readonly DistrictId[] = DISTRICTS3,
    placed: readonly Placed3[],
    private readonly seed: number,
    zones?: ZoneMap,
    avenues?: Avenues,
    /** Street bridges over the water (roads.ts): ground you can walk and drive, outside any cell. */
    readonly bridges: readonly Bridge3[] = [],
    /** The lie of the land (terrain.ts). */
    readonly terrain: Terrain = Terrain.FLAT,
    /** Ground kept clear under the rail lines' curves (rail.ts railReserved). */
    reserved: readonly Rect[] = [],
  ) {
    this.model = new DistrictModel(macro, kinds, placed, seed, zones, avenues, terrain, reserved);
    this.nodes = placed.flatMap((p) => p.nodes);
    // Stamps collide as their footprint, or (landmarks you can walk into) as their walls and fixtures.
    const solid = (p: Placed3): Rect[] => [{ x: p.building.x - p.building.w / 2, y: p.building.z - p.building.d / 2, w: p.building.w, h: p.building.d }];
    this.stampColliders = placed.map((p) => landmarkColliders(p, 0) ?? solid(p));
    // Below ground, by level: the concourse and basements (-5), and the subway platforms (-11).
    this.basementColliders = placed.map((p) => landmarkColliders(p, -5) ?? []);
    this.deepColliders = placed.map((p) => landmarkColliders(p, -11) ?? []);
    this.shelters.push(...placed.flatMap(landmarkShelters));
  }

  private readonly stampColliders: (readonly Rect[])[];
  private readonly stampOutside = new Map<number, readonly Rect[]>();

  /** Interiors you're inside (real/interiors.ts): their floors and collision per level. */
  private readonly interiors = new Map<string, Pick<Interior, 'colliders' | 'floorAt'>>();
  private readonly footings = new Map<Placed3, number>();
  private footingOf(p: Placed3): number {
    let f = this.footings.get(p);
    if (f === undefined) this.footings.set(p, (f = this.terrain.footing(p.building.x, p.building.z, p.building.w, p.building.d)));
    return f;
  }

  /**
   * Step inside a placement's interior: its storeys' floors, and its walls and fixtures on each level instead of
   * the solid footprint on the street; null puts the outside back.
   */
  setInterior(placementId: string, interior: Pick<Interior, 'colliders' | 'floorAt'> | null): void {
    const i = this.model.placed.findIndex((p) => p.id === placementId);
    if (i < 0) return;
    if (interior) {
      this.interiors.set(placementId, interior);
      if (!this.stampOutside.has(i)) this.stampOutside.set(i, this.stampColliders[i]);
      this.stampColliders[i] = interior.colliders(0);
    } else {
      this.interiors.delete(placementId);
      if (this.stampOutside.has(i)) {
        this.stampColliders[i] = this.stampOutside.get(i)!;
        this.stampOutside.delete(i);
      }
    }
  }

  /** More street-level colliders (the viaduct's piers). */
  addColliders(rects: readonly Rect[]): void {
    this.stampColliders.push(rects);
  }
  /** Below street level only basements collide (their walls keep you inside). */
  private readonly basementColliders: readonly (readonly Rect[])[];
  private readonly deepColliders: readonly (readonly Rect[])[];

  /**
   * Floor height: 0 on the street, a ramp on stairs, negative in a basement, raised on a station platform.
   * Where levels overlap (a platform over the pavement), the one nearest the walker's current floor wins.
   */
  floorAt = (x: number, z: number, current = 0): number => {
    for (const it of this.interiors.values()) {
      const y = it.floorAt(x, z, current);
      if (y !== null) return y;
    }
    for (const p of this.model.placed) {
      // A landmark's levels are its own, from its footing (on a hill it stands level at its lowest corner).
      const base = this.footingOf(p);
      const y = landmarkFloor(p, x, z, current - base);
      if (y !== null) return y + base;
    }
    return this.terrain.height(x, z);
  };

  /** Height above the ground (the terrain) at (x, z): 0 at street level anywhere, on a hill or not. */
  aboveGround(x: number, z: number, y: number): number {
    return y - this.terrain.height(x, z);
  }

  get placed(): readonly Placed3[] {
    return this.model.placed;
  }

  /**
   * Whether the walker is under a roof (no rain, no drops on the lens): below or above street level
   * (basements, platforms, the observatory), or inside a walk-in building on the ground.
   */
  sheltered(x: number, z: number, y: number): boolean {
    return this.shelterAt(x, z, y) !== null;
  }

  /** The covered volume a point is in (enclosed ones first), or null out in the open. */
  shelterAt(x: number, z: number, y: number): Shelter | null {
    let best: Shelter | null = null;
    for (const s of this.shelters) {
      const yr = y - this.terrain.height(x, z);
      if (yr > s.y0 && yr < s.y1 && x > s.rect.x && x < s.rect.x + s.rect.w && z > s.rect.y && z < s.rect.y + s.rect.h) {
        if (s.enclosed) return s;
        best = s;
      }
    }
    return best;
  }

  /** Every covered volume (landmarks, plus any added: the viaduct). */
  readonly shelters: Shelter[] = [];

  /** The covered volumes within r metres of (x, z), nearest first (for the rain shader). */
  sheltersNear(x: number, z: number, r: number, max: number): Shelter[] {
    const d = (s: Shelter): number => Math.hypot(Math.max(s.rect.x - x, 0, x - s.rect.x - s.rect.w), Math.max(s.rect.y - z, 0, z - s.rect.y - s.rect.h));
    return this.shelters.filter((s) => d(s) < r).sort((a, b) => d(a) - d(b)).slice(0, max);
  }

  /** Traffic signal poles within r metres of (x, z). */
  signalsNear(x: number, z: number, r: number): Prop[] {
    const out: Prop[] = [];
    for (let my = Math.floor((z - r) / CELL); my <= Math.floor((z + r) / CELL); my++) {
      for (let mx = Math.floor((x - r) / CELL); mx <= Math.floor((x + r) / CELL); mx++) {
        for (const p of this.model.detail(mx, my)?.props ?? []) if (p.kind === 'signal' && Math.hypot(p.x - x, p.z - z) < r) out.push(p);
      }
    }
    return out;
  }

  /** Street lamp heads within r metres (for the light cones in wet air), nearest first. */
  lampsNear(x: number, z: number, r: number): { x: number; y: number; z: number }[] {
    const out: { x: number; y: number; z: number; d: number }[] = [];
    const c0 = Math.floor((x - r) / CELL);
    const c1 = Math.floor((x + r) / CELL);
    const r0 = Math.floor((z - r) / CELL);
    const r1 = Math.floor((z + r) / CELL);
    for (let my = r0; my <= r1; my++) {
      for (let mx = c0; mx <= c1; mx++) {
        for (const p of this.model.detail(mx, my)?.props ?? []) {
          if (p.kind !== 'lamp') continue;
          // The head hangs 1.5 m out over the road on its arm, 6.35 m up.
          const hx = p.x + p.nx * 1.5;
          const hz = p.z + p.nz * 1.5;
          const d = Math.hypot(hx - x, hz - z);
          if (d < r) out.push({ x: hx, y: 6.35, z: hz, d });
        }
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }

  /** A cell's plan (roads, buildings) for maps and fast travel. */
  plan(mx: number, my: number): CellPlan3 | null {
    return this.model.plan(mx, my);
  }

  /** The named stamp at a world position (for the HUD), if any. */
  placeAt(x: number, z: number): string | null {
    for (const p of this.model.placed) {
      const r = p.rect;
      if (p.stamp.name && x >= r.x && x <= r.x + r.w && z >= r.y && z <= r.y + r.h) return p.stamp.name;
    }
    return null;
  }

  /**
   * What's underfoot at a world position (for footsteps): lawn, earth and gravel (parks, playgrounds,
   * vacant lots, the shrine precinct), or hard ground (roads, pavements, paving, floors).
   */
  surfaceAt(x: number, z: number, floor = 0): 'hard' | 'grass' | 'gravel' {
    if (Math.abs(floor) > 0.5) return 'hard';
    for (const p of this.model.placed) {
      const r = p.rect;
      if (p.stamp.landmark === 'shrine' && x >= r.x && x <= r.x + r.w && z >= r.y && z <= r.y + r.h) return 'gravel';
    }
    const d = this.model.detail(Math.floor(x / CELL), Math.floor(z / CELL));
    let top = -1;
    let kind: number = KIND.asphalt;
    for (const o of d?.open ?? []) {
      for (const g of o.ground) {
        const r = g.rect;
        if (g.top > top && x >= r.x && x <= r.x + r.w && z >= r.y && z <= r.y + r.h) {
          top = g.top;
          kind = g.kind;
        }
      }
    }
    return kind === KIND.grass ? 'grass' : kind === KIND.gravel ? 'gravel' : 'hard';
  }

  get cells(): readonly (readonly [number, number])[] {
    return this.model.cells;
  }

  /** The zone at a world position (for the HUD), if any. */
  zoneAt(x: number, z: number): string | null {
    return this.model.zones.at(Math.floor(x / CELL), Math.floor(z / CELL))?.name ?? null;
  }

  /** The district's name at a world position (for the HUD), if it's a generated one. */
  districtAt(x: number, z: number): string | null {
    const [mx, my] = [Math.floor(x / CELL), Math.floor(z / CELL)];
    const area = this.model.zones.at(mx, my)?.area;
    if (area) return area;
    const k = this.macro.kindAt(mx, my);
    return k in STYLES3 ? STYLES3[k as DistrictId]!.name : null;
  }

  get bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    return this.model.bounds;
  }

  /** Sets the render kit and starts the worker pool. */
  setKit(kit: DistrictKit, workerCount = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2))): void {
    this.kit = kit;
    for (let i = 0; i < workerCount; i++) {
      const w = new Worker(new URL('./chunkWorker.ts', import.meta.url), { type: 'module' });
      this.ready.push(
        new Promise((resolve) => {
          w.addEventListener('message', (e) => {
            if (e.data.type === 'ready') resolve();
          });
        }),
      );
      w.addEventListener('message', (e) => this.onMessage(i, e.data));
      w.addEventListener('error', (e) => console.error('chunk worker error', e.message));
      w.postMessage({ type: 'init', kinds: typeof this.kinds === 'string' ? [this.kinds] : [...this.kinds], seed: this.seed, words: kit.words } satisfies WorkerIn);
      this.workers.push(w);
      this.inFlight.push(0);
    }
  }

  get workerCount(): number {
    return this.workers.length;
  }

  inDistrict(x: number, z: number): boolean {
    if (this.model.has(Math.floor(x / CELL), Math.floor(z / CELL))) return true;
    return this.bridges.some((b) => x >= b.road.rect.x && x <= b.road.rect.x + b.road.rect.w && z >= b.road.rect.y && z <= b.road.rect.y + b.road.rect.h);
  }

  /** On a bridge's median (solid, like an avenue's). */
  private onBridgeMedian(x: number, z: number, r: number): boolean {
    return this.bridges.some((b) => b.median !== null && x > b.median.x - r && x < b.median.x + b.median.w + r && z > b.median.y - r && z < b.median.y + b.median.h + r);
  }

  /** Collision: outside the district, inside a building footprint (this cell or a neighbour), a stamp or a prop. */
  blocked = (x: number, z: number, r: number, floorAbs = 0): boolean => {
    // (Levels are relative to the ground: street level on a hill is still 0.)
    const floor = floorAbs - this.terrain.height(x, z);
    const inRects = (rs: readonly Rect[]): boolean => rs.some((q) => x > q.x - r && x < q.x + q.w + r && z > q.y - r && z < q.y + q.h + r);
    const inside = (): boolean => {
      for (const it of this.interiors.values()) if (inRects(it.colliders(floor))) return true;
      return false;
    };
    if (floor < -1) return (floor > -8 ? this.basementColliders : this.deepColliders).some(inRects) || inside();
    if (floor > 1) return this.model.placed.some((p) => inRects(landmarkRaisedColliders(p, floor) ?? [])) || inside();
    if (!this.inDistrict(x, z)) return true;
    if (this.onBridgeMedian(x, z, r)) return true;
    const mx = Math.floor(x / CELL);
    const my = Math.floor(z / CELL);
    const hit = (b: Pick<Building3, 'x' | 'z' | 'w' | 'd'>): boolean => Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const p = this.model.plan(mx + dx, my + dy);
        if (p?.buildings.some(hit)) return true;
        // An avenue's median (raised, planted, the expressway's piers in it): only crossed at junctions.
        if (p?.medians.length && inRects(p.medians)) return true;
        const d = this.model.detail(mx + dx, my + dy);
        if (d && (propBlocked(d.props, x, z, r) || inRects(d.solids))) return true;
      }
    }
    return this.stampColliders.some(inRects) || inRects(this.extraColliders);
  };

  /**
   * For a car at street level (crash.ts): what's at (x, z) within r, the most solid first: a `wall` (buildings,
   * set pieces, playground frames and toilets, the expressway's piers and ramp walls, the edge of the district),
   * a `car` (parked), a `pole` (lamps, poles, signals, trees, vending machines), `soft` (hedges, pots, bikes,
   * fences, the avenues' medians), or null.
   */
  obstacle = (x: number, z: number, r: number): 'wall' | 'car' | 'pole' | 'soft' | null => {
    const inRects = (rs: readonly Rect[]): boolean => rs.some((q) => x > q.x - r && x < q.x + q.w + r && z > q.y - r && z < q.y + q.h + r);
    for (const it of this.interiors.values()) if (inRects(it.colliders(0))) return 'wall';
    if (!this.inDistrict(x, z)) return 'wall';
    if (this.stampColliders.some(inRects) || inRects(this.extraColliders)) return 'wall';
    if (this.onBridgeMedian(x, z, r)) return 'soft';
    const mx = Math.floor(x / CELL);
    const my = Math.floor(z / CELL);
    let found: 'car' | 'pole' | 'soft' | null = null;
    const rank = { soft: 1, pole: 2, car: 3 } as const;
    const see = (k: 'car' | 'pole' | 'soft'): void => {
      if (!found || rank[k] > rank[found]) found = k;
    };
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const p = this.model.plan(mx + dx, my + dy);
        if (p?.buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r)) return 'wall';
        if (p?.medians.length && inRects(p.medians)) see('soft');
        const d = this.model.detail(mx + dx, my + dy);
        if (!d) continue;
        if (inRects(d.solids)) return 'wall';
        for (const q of d.props) {
          if (q.solid === false || propDist(q, x, z) >= q.radius + r) continue;
          if (WALL_PROPS.has(q.kind)) return 'wall';
          see(SOFT_PROPS.has(q.kind) ? 'soft' : CAR_PROPS.has(q.kind) ? 'car' : 'pole');
        }
      }
    }
    return found;
  };

  /** More street-level colliders from outside the plan (the expressway's piers and ramp walls). */
  readonly extraColliders: Rect[] = [];

  /**
   * Per frame: drop far chunks, send the nearest wanted stages to the workers, and turn finished results
   * into meshes until the time budget is spent. Returns the number of results integrated.
   */
  update(pos: THREE.Vector3, budgetMs: number): number {
    const dist = (c: { cx: number; cz: number }): number => Math.hypot(c.cx - pos.x, c.cz - pos.z);
    for (const c of this.chunks.values()) {
      const d = dist(c);
      if (d > UNLOAD_RADIUS) this.unload(c);
      else if (c.near && d > NEAR_DROP) this.dropNear(c);
    }
    this.dispatch(pos);
    const t0 = performance.now();
    let n = 0;
    this.lastBytes = 0;
    // Nearest results first; at least one per frame so streaming always progresses.
    this.done.sort((a, b) => this.taskDist(a.task, pos) - this.taskDist(b.task, pos));
    while (this.done.length > 0 && (n === 0 || (performance.now() - t0 < budgetMs && this.lastBytes < (budgetMs === Infinity ? Infinity : UPLOAD_BYTES_PER_FRAME)))) {
      const { task, result } = this.done.shift()!;
      const s = performance.now();
      if (this.integrate(task, result, pos)) {
        n++;
        for (const m of Object.values(result.meshes)) this.lastBytes += rawBytes(m);
        const ms = performance.now() - s;
        const st = this.stats.integrate;
        st.count++;
        st.msTotal += ms;
        st.msMax = Math.max(st.msMax, ms);
      }
    }
    if (n > 0) this.dispatch(pos);
    for (const c of this.chunks.values()) {
      const showNear = c.near !== null && dist(c) < LOD_DISTANCE;
      if (c.near) c.near.visible = showNear;
      if (c.far) c.far.visible = !showNear;
      if (c.ghosts) c.ghosts.visible = showNear && dist(c) < GHOST_DISTANCE;
      if (c.umbrellas) c.umbrellas.visible = this.umbrellas && showNear && dist(c) < GHOST_DISTANCE;
    }
    return n;
  }

  /**
   * Warm start: builds everything wanted around pos (all stages) before the first frame. Resolves once
   * nothing in range is missing or in flight.
   */
  async warm(pos: THREE.Vector3): Promise<void> {
    await Promise.all(this.ready);
    for (;;) {
      this.update(pos, Infinity);
      if (this.pending.size === 0 && this.done.length === 0 && this.wanted(pos).length === 0) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }

  get loaded(): number {
    return this.chunks.size;
  }

  get inFlightCount(): number {
    return this.pending.size;
  }

  get detailedChunks(): number {
    let n = 0;
    for (const c of this.chunks.values()) if (c.near) n++;
    return n;
  }

  get loadedPeople(): number {
    let n = 0;
    for (const c of this.chunks.values()) n += c.people;
    return n;
  }

  get loadedBuildings(): number {
    let n = 0;
    for (const c of this.chunks.values()) n += c.buildings.length;
    return n;
  }

  get loadedTriangles(): number {
    let n = 0;
    for (const c of this.chunks.values()) n += c.triangles + c.nearTriangles;
    return n;
  }

  private taskDist(t: Task, pos: THREE.Vector3): number {
    const mx = t.key % 4096;
    const my = Math.floor(t.key / 4096);
    return Math.hypot((mx + 0.5) * CELL - pos.x, (my + 0.5) * CELL - pos.z);
  }

  /** Stages wanted around pos, nearest first: missing chunks, then detail, then crowds. */
  private wanted(pos: THREE.Vector3): { key: number; mx: number; my: number; stage: Stage; d: number }[] {
    const out: { key: number; mx: number; my: number; stage: Stage; d: number }[] = [];
    for (const [mx, my] of this.model.cells) {
      const key = cellKey(mx, my);
      const d = Math.hypot((mx + 0.5) * CELL - pos.x, (my + 0.5) * CELL - pos.z);
      const c = this.chunks.get(key);
      let stage: Stage | null = null;
      if (!c) stage = d <= LOAD_RADIUS ? 'base' : null;
      else if (!c.near) stage = d <= NEAR_BUILD ? 'near' : null;
      else if (!c.ghostsBuilt) stage = d <= GHOST_BUILD ? 'ghosts' : null;
      if (stage && !this.pending.has(`${key}:${stage}`)) out.push({ key, mx, my, stage, d });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  private dispatch(pos: THREE.Vector3): void {
    if (this.workers.length === 0) return;
    for (const w of this.wanted(pos)) {
      // Least-loaded worker with room.
      let best = -1;
      for (let i = 0; i < this.workers.length; i++) if (this.inFlight[i] < IN_FLIGHT_PER_WORKER && (best < 0 || this.inFlight[i] < this.inFlight[best])) best = i;
      if (best < 0) return;
      const task: Task = { id: this.nextId++, key: w.key, stage: w.stage, worker: best };
      this.pending.set(`${w.key}:${w.stage}`, task);
      this.inFlight[best]++;
      this.workers[best].postMessage({ type: 'build', id: task.id, mx: w.mx, my: w.my, stage: w.stage } satisfies WorkerIn);
    }
  }

  private onMessage(worker: number, msg: { type: string; id?: number; result?: ChunkBuilt }): void {
    if (msg.type !== 'built' || !msg.result) return;
    const r = msg.result;
    const key = cellKey(r.mx, r.my);
    const task = this.pending.get(`${key}:${r.stage}`);
    this.inFlight[worker]--;
    const st = this.stats[r.stage];
    st.count++;
    st.msTotal += r.ms;
    st.msMax = Math.max(st.msMax, r.ms);
    if (task && task.id === msg.id) this.done.push({ task, result: r });
    this.wake?.();
    this.wake = null;
  }

  /** Turns a finished stage into meshes. Returns false if it arrived too late to be useful. */
  private integrate(task: Task, r: ChunkBuilt, pos: THREE.Vector3): boolean {
    this.pending.delete(`${task.key}:${task.stage}`);
    const kit = this.kit!;
    const cx = (r.mx + 0.5) * CELL;
    const cz = (r.my + 0.5) * CELL;
    const d = Math.hypot(cx - pos.x, cz - pos.z);
    const c = this.chunks.get(task.key);
    if (r.stage === 'base') {
      if (c || d > UNLOAD_RADIUS) return false;
      const base = new THREE.Mesh(toGeometry(r.meshes.base!), kit.city);
      base.receiveShadow = true;
      const far = r.meshes.far ? new THREE.Mesh(toGeometry(r.meshes.far), kit.city) : null;
      if (far) {
        far.castShadow = far.receiveShadow = true;
        if (kit.cityDepth) far.customDepthMaterial = kit.cityDepth;
      }
      const group = new THREE.Group();
      group.position.set(cx, 0, cz);
      group.add(base);
      if (far) group.add(far);
      group.updateMatrixWorld(true);
      this.root.add(group);
      this.chunks.set(task.key, {
        key: task.key, mx: r.mx, my: r.my, cx, cz, group, far, near: null, ghosts: null, umbrellas: null, ghostsBuilt: false, people: 0,
        triangles: rawTriangles(r.meshes.base ?? null) + rawTriangles(r.meshes.far ?? null), nearTriangles: 0, buildings: this.model.buildings(r.mx, r.my),
      });
      if (r.lightmap) kit.lightmap.upload(r.mx * CELL, r.my * CELL, r.lightmap);
      return true;
    }
    if (r.stage === 'near') {
      if (!c || c.near || d > NEAR_DROP) return false;
      const near = new THREE.Group();
      if (r.meshes.near) {
        const m = new THREE.Mesh(toGeometry(r.meshes.near), kit.city);
        m.castShadow = m.receiveShadow = true;
        if (kit.cityDepth) m.customDepthMaterial = kit.cityDepth;
        near.add(m);
      }
      if (r.meshes.signs) {
        const m = new THREE.Mesh(toGeometry(r.meshes.signs), kit.signs);
        m.castShadow = true;
        near.add(m);
      }
      if (r.meshes.ads) {
        const m = new THREE.Mesh(toGeometry(r.meshes.ads), kit.ads);
        m.castShadow = true;
        near.add(m);
      }
      c.group.add(near);
      near.updateMatrixWorld(true);
      c.near = near;
      c.nearTriangles = rawTriangles(r.meshes.near ?? null) + rawTriangles(r.meshes.signs ?? null) + rawTriangles(r.meshes.ads ?? null);
      return true;
    }
    if (!c || !c.near || c.ghostsBuilt) return false;
    c.ghostsBuilt = true;
    c.people = r.people ?? 0;
    if (r.meshes.ghosts) {
      c.ghosts = new THREE.Mesh(toGeometry(r.meshes.ghosts), kit.ghost);
      c.ghosts.renderOrder = 2;
      c.near.add(c.ghosts);
      c.ghosts.updateMatrixWorld(true);
      c.nearTriangles += rawTriangles(r.meshes.ghosts);
    }
    if (r.meshes.umbrellas) {
      c.umbrellas = new THREE.Mesh(toGeometry(r.meshes.umbrellas), kit.ghost);
      c.umbrellas.renderOrder = 2;
      c.umbrellas.visible = false;
      c.near.add(c.umbrellas);
      c.umbrellas.updateMatrixWorld(true);
    }
    return true;
  }

  private dropNear(c: Chunk): void {
    if (!c.near) return;
    c.group.remove(c.near);
    c.near.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    c.near = null;
    c.ghosts = null;
    c.ghostsBuilt = false;
    c.people = 0;
    c.nearTriangles = 0;
  }

  private unload(c: Chunk): void {
    this.dropNear(c);
    this.kit?.lightmap.clear(c.mx * CELL, c.my * CELL);
    this.root.remove(c.group);
    c.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.chunks.delete(c.key);
    this.stats.disposed++;
  }
}
