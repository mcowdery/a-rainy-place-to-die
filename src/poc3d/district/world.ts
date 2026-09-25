import * as THREE from 'three';
import { overlaps, type Rect } from '../../core/coords';
import type { DistrictId, MacroMap } from '../../gen/macro';
import { addBuilding } from '../real/buildings';
import { addGround } from '../real/ground';
import type { Light, Lightmap } from '../real/lightmap';
import { MeshBuilder } from '../real/meshBuilder';
import { addProps, cellDetail, propBlocked, type CellDetail } from '../real/props';
import { addSigns, signLights, SignBuilder, type SignAtlas } from '../real/signs';
import { CELL, cellKey, planCell3, type Building3, type CellPlan3 } from './plan';
import { reservedRect, type Node3, type Placed3 } from './stamps';

/** Chunks (one per macro cell) whose centre is within LOAD_RADIUS are built; beyond UNLOAD_RADIUS dropped. */
export const LOAD_RADIUS = 620;
export const UNLOAD_RADIUS = 820;
/** Within this, a chunk shows its full detail (built on demand); beyond, plain building masses. */
export const LOD_DISTANCE = 300;
/** Detail is built a little before it's needed and dropped well after. */
const NEAR_BUILD = LOD_DISTANCE + 40;
const NEAR_DROP = LOD_DISTANCE + 160;

/** What the district renders with (created by the page once it has a renderer). */
export interface DistrictKit {
  readonly city: THREE.Material;
  readonly signs: THREE.Material;
  readonly atlas: SignAtlas;
  readonly lightmap: Lightmap;
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
  readonly plan: CellPlan3;
  readonly triangles: number;
  nearTriangles: number;
  readonly buildings: readonly Building3[];
}

const tri = (g: THREE.BufferGeometry | null): number => (g ? (g.index ? g.index.count : g.getAttribute('position').count) / 3 : 0);

/**
 * One district, streamed as chunks. Plans (roads, lots, buildings, signs) and their street furniture are
 * cheap and computed lazily for any cell, so collision works everywhere. Near the camera a chunk is built
 * in stages, nearest first within a per-frame time budget: ground + building masses + its lightmap tile
 * first, then full detail (building dressing, props, signs) once it's within NEAR_BUILD.
 */
export class District {
  readonly root = new THREE.Group();
  readonly nodes: readonly Node3[];
  readonly cells: readonly (readonly [number, number])[];
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  readonly stats = { generated: 0, genMsTotal: 0, genMsMax: 0, detailed: 0, detailMsTotal: 0, detailMsMax: 0, disposed: 0 };
  private readonly cellSet = new Set<number>();
  private readonly plans = new Map<number, CellPlan3>();
  private readonly details = new Map<number, CellDetail>();
  private readonly chunks = new Map<number, Chunk>();
  private readonly placedByCell = new Map<number, Placed3[]>();
  private kit: DistrictKit | null = null;
  /** Scratch builders, reused for every chunk (build() copies the data out). */
  private readonly mb = new MeshBuilder(1 << 16);
  private readonly sb = new SignBuilder();

  constructor(
    private readonly macro: MacroMap,
    readonly kind: DistrictId,
    private readonly placed: readonly Placed3[],
    private readonly seed: number,
  ) {
    const cells: [number, number][] = [];
    for (let my = 0; my < macro.rows; my++) for (let mx = 0; mx < macro.cols; mx++) if (macro.kindAt(mx, my) === kind) cells.push([mx, my]);
    this.cells = cells;
    for (const [mx, my] of cells) this.cellSet.add(cellKey(mx, my));
    const xs = cells.map(([mx]) => mx);
    const zs = cells.map(([, my]) => my);
    this.bounds = { minX: Math.min(...xs) * CELL, maxX: (Math.max(...xs) + 1) * CELL, minZ: Math.min(...zs) * CELL, maxZ: (Math.max(...zs) + 1) * CELL };
    for (const p of placed) {
      const k = cellKey(p.cell[0], p.cell[1]);
      this.placedByCell.set(k, [...(this.placedByCell.get(k) ?? []), p]);
    }
    this.nodes = placed.flatMap((p) => p.nodes);
  }

  setKit(kit: DistrictKit): void {
    this.kit = kit;
  }

  /** Every sign text the district can show (for the sign atlas). */
  signTexts(words: readonly string[]): { text: string; vertical: boolean }[] {
    return [
      ...words.flatMap((text) => [{ text, vertical: false }, { text, vertical: true }]),
      ...this.placed.flatMap((p) => p.signs.map((s) => ({ text: s.text, vertical: s.vertical }))),
    ];
  }

  inDistrict(x: number, z: number): boolean {
    return this.cellSet.has(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  }

  plan(mx: number, my: number): CellPlan3 | null {
    const k = cellKey(mx, my);
    if (!this.cellSet.has(k)) return null;
    let p = this.plans.get(k);
    if (!p) {
      const cellRect: Rect = { x: mx * CELL, y: my * CELL, w: CELL, h: CELL };
      const reserved = this.placed.map(reservedRect).filter((r) => overlaps(r, cellRect));
      p = planCell3(this.macro, mx, my, reserved, this.seed)!;
      this.plans.set(k, p);
    }
    return p;
  }

  /** Street furniture and lights of a cell (null outside the district). */
  detail(mx: number, my: number): CellDetail | null {
    const k = cellKey(mx, my);
    let d = this.details.get(k);
    if (!d) {
      const p = this.plan(mx, my);
      if (!p) return null;
      const stamps = (this.placedByCell.get(k) ?? []).map((q) => q.building);
      d = cellDetail(p, stamps);
      this.details.set(k, d);
    }
    return d;
  }

  /** Collision: outside the district, inside a building footprint (this cell or a neighbour), a stamp or a prop. */
  blocked = (x: number, z: number, r: number): boolean => {
    if (!this.inDistrict(x, z)) return true;
    const mx = Math.floor(x / CELL);
    const my = Math.floor(z / CELL);
    const hit = (b: Pick<Building3, 'x' | 'z' | 'w' | 'd'>): boolean => Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const p = this.plan(mx + dx, my + dy);
        if (p?.buildings.some(hit)) return true;
        const d = this.detail(mx + dx, my + dy);
        if (d && propBlocked(d.props, x, z, r)) return true;
      }
    }
    return this.placed.some((p) => hit(p.building));
  };

  /** Build chunk stages near pos (nearest first) until the time budget is spent; drop far ones. Returns stages built. */
  update(pos: THREE.Vector3, budgetMs: number): number {
    const dist = (c: { cx: number; cz: number }): number => Math.hypot(c.cx - pos.x, c.cz - pos.z);
    for (const c of this.chunks.values()) {
      const d = dist(c);
      if (d > UNLOAD_RADIUS) this.unload(c);
      else if (c.near && d > NEAR_DROP) this.dropNear(c);
    }
    const t0 = performance.now();
    let built = 0;
    const spend = (): boolean => built > 0 && performance.now() - t0 > budgetMs;
    const wanted = this.cells
      .map(([mx, my]) => ({ mx, my, cx: (mx + 0.5) * CELL, cz: (my + 0.5) * CELL }))
      .filter((c) => !this.chunks.has(cellKey(c.mx, c.my)) && dist(c) <= LOAD_RADIUS)
      .sort((a, b) => dist(a) - dist(b));
    const nearWanted = () => [...this.chunks.values()].filter((c) => !c.near && dist(c) <= NEAR_BUILD).sort((a, b) => dist(a) - dist(b));
    // Interleave: whichever is closer first, so the ground under your feet and nearby detail come first.
    for (;;) {
      if (spend()) break;
      const nf = wanted[0];
      const nn = nearWanted()[0];
      if (!nf && !nn) break;
      if (nf && (!nn || dist(nf) < dist(nn))) {
        wanted.shift();
        this.build(nf.mx, nf.my);
      } else {
        this.buildNear(nn!);
      }
      built++;
    }
    for (const c of this.chunks.values()) {
      const showNear = c.near !== null && dist(c) < LOD_DISTANCE;
      if (c.near) c.near.visible = showNear;
      if (c.far) c.far.visible = !showNear;
    }
    return built;
  }

  get loaded(): number {
    return this.chunks.size;
  }

  get detailedChunks(): number {
    let n = 0;
    for (const c of this.chunks.values()) if (c.near) n++;
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

  private cellBuildings(mx: number, my: number, plan: CellPlan3): Building3[] {
    const stamps = (this.placedByCell.get(cellKey(mx, my)) ?? []).map((p) => p.building);
    return [...plan.buildings, ...stamps];
  }

  private build(mx: number, my: number): void {
    const kit = this.kit!;
    const t0 = performance.now();
    const plan = this.plan(mx, my)!;
    const key = cellKey(mx, my);
    const cx = (mx + 0.5) * CELL;
    const cz = (my + 0.5) * CELL;
    const all = this.cellBuildings(mx, my, plan);

    const mbBase = this.mb.reset();
    addGround(mbBase, plan);
    const baseGeo = mbBase.build(cx, cz)!;
    const base = new THREE.Mesh(baseGeo, kit.city);
    base.receiveShadow = true;

    const mbFar = this.mb.reset();
    for (const b of all) addBuilding(mbFar, b, false);
    const farGeo = mbFar.build(cx, cz);
    const far = farGeo ? new THREE.Mesh(farGeo, kit.city) : null;
    if (far) far.castShadow = far.receiveShadow = true;

    const group = new THREE.Group();
    group.position.set(cx, 0, cz);
    group.add(base);
    if (far) group.add(far);
    group.updateMatrixWorld(true);
    this.root.add(group);
    this.chunks.set(key, { key, mx, my, cx, cz, group, far, near: null, plan, triangles: tri(baseGeo) + tri(farGeo), nearTriangles: 0, buildings: all });

    // Lightmap tile: this cell's lights plus any from the neighbours that reach across the border.
    const lights: Light[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const d = this.detail(mx + dx, my + dy);
        if (d) lights.push(...d.lights);
        const p = this.plan(mx + dx, my + dy);
        if (p) lights.push(...signLights(p.signs));
        for (const q of this.placedByCell.get(cellKey(mx + dx, my + dy)) ?? []) {
          lights.push(...signLights(q.signs));
          for (const n of q.nodes) if (n.kind === 'door') lights.push({ x: n.x, z: n.z, r: 6, color: [1.0, 0.7, 0.4], i: 0.9 });
        }
      }
    }
    kit.lightmap.paint(mx * CELL, my * CELL, lights);

    const ms = performance.now() - t0;
    this.stats.generated++;
    this.stats.genMsTotal += ms;
    this.stats.genMsMax = Math.max(this.stats.genMsMax, ms);
  }

  private buildNear(c: Chunk): void {
    const kit = this.kit!;
    const t0 = performance.now();
    const mb = this.mb.reset();
    for (const b of c.buildings) addBuilding(mb, b, true);
    addProps(mb, this.detail(c.mx, c.my)!);
    const sb = this.sb.reset();
    const stampSigns = (this.placedByCell.get(c.key) ?? []).flatMap((p) => p.signs);
    addSigns([...c.plan.signs, ...stampSigns], c.buildings, kit.atlas, sb, mb);
    const geo = mb.build(c.cx, c.cz);
    const sgeo = sb.build(c.cx, c.cz);
    const near = new THREE.Group();
    if (geo) {
      const m = new THREE.Mesh(geo, kit.city);
      m.castShadow = m.receiveShadow = true;
      near.add(m);
    }
    if (sgeo) {
      const m = new THREE.Mesh(sgeo, kit.signs);
      m.castShadow = true;
      near.add(m);
    }
    c.group.add(near);
    near.updateMatrixWorld(true);
    c.near = near;
    c.nearTriangles = tri(geo) + tri(sgeo);
    const ms = performance.now() - t0;
    this.stats.detailed++;
    this.stats.detailMsTotal += ms;
    this.stats.detailMsMax = Math.max(this.stats.detailMsMax, ms);
  }

  private dropNear(c: Chunk): void {
    if (!c.near) return;
    c.group.remove(c.near);
    c.near.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    c.near = null;
    c.nearTriangles = 0;
  }

  private unload(c: Chunk): void {
    this.dropNear(c);
    this.root.remove(c.group);
    c.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.chunks.delete(c.key);
    this.stats.disposed++;
  }
}
