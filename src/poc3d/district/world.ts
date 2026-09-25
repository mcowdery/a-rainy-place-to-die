import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { intersect, overlaps, type Rect } from '../../core/coords';
import { rng } from '../../core/hash';
import type { DistrictId, MacroMap } from '../../gen/macro';
import { buildingGeometry } from '../block';
import { CELL, cellKey, planCell3, type Building3, type CellPlan3, type Road3, type Sign3 } from './plan';
import { reservedRect, type Node3, type Placed3 } from './stamps';

/** Chunks (one per macro cell) whose centre is within LOAD_RADIUS are built; beyond UNLOAD_RADIUS dropped. */
export const LOAD_RADIUS = 620;
export const UNLOAD_RADIUS = 820;
/** Beyond this, a chunk swaps to its simplified mesh (base boxes of buildings >= 18 m only). */
export const LOD_DISTANCE = 300;

interface Chunk {
  readonly key: number;
  readonly cx: number;
  readonly cz: number;
  readonly object: THREE.Object3D;
  readonly plan: CellPlan3;
  readonly triangles: number;
}

const tri = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

/**
 * One district, streamed as chunks. Plans (roads, lots, buildings, signs) are cheap and computed lazily
 * for any cell, so collision works everywhere; meshes are built only near the camera, nearest first, within
 * a per-frame time budget, and disposed when far away.
 */
export class District {
  readonly root = new THREE.Group();
  readonly nodes: readonly Node3[];
  readonly cells: readonly (readonly [number, number])[];
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  readonly stats = { generated: 0, genMsTotal: 0, genMsMax: 0, disposed: 0 };
  private readonly cellSet = new Set<number>();
  private readonly plans = new Map<number, CellPlan3>();
  private readonly chunks = new Map<number, Chunk>();
  private readonly placedByCell = new Map<number, Placed3[]>();

  constructor(
    private readonly macro: MacroMap,
    readonly kind: DistrictId,
    private readonly placed: readonly Placed3[],
    private readonly facade: THREE.Material,
    private readonly ground: THREE.Material,
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

  /** Collision: outside the district, inside a building footprint (this cell or a neighbour) or a stamp. */
  blocked = (x: number, z: number, r: number): boolean => {
    if (!this.inDistrict(x, z)) return true;
    const mx = Math.floor(x / CELL);
    const my = Math.floor(z / CELL);
    const hit = (b: Pick<Building3, 'x' | 'z' | 'w' | 'd'>): boolean => Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const p = this.plan(mx + dx, my + dy);
        if (p?.buildings.some(hit)) return true;
      }
    }
    return this.placed.some((p) => hit(p.building));
  };

  /** Build chunks near pos (nearest first) until the time budget is spent; drop far ones. Returns chunks built. */
  update(pos: THREE.Vector3, budgetMs: number): number {
    for (const c of this.chunks.values()) {
      if (Math.hypot(c.cx - pos.x, c.cz - pos.z) > UNLOAD_RADIUS) this.unload(c);
    }
    const wanted = this.cells
      .map(([mx, my]) => ({ mx, my, d: Math.hypot((mx + 0.5) * CELL - pos.x, (my + 0.5) * CELL - pos.z) }))
      .filter((c) => c.d <= LOAD_RADIUS && !this.chunks.has(cellKey(c.mx, c.my)))
      .sort((a, b) => a.d - b.d);
    const t0 = performance.now();
    let built = 0;
    for (const c of wanted) {
      if (built > 0 && performance.now() - t0 > budgetMs) break;
      this.build(c.mx, c.my);
      built++;
    }
    return built;
  }

  /** Signs in loaded chunks within radius of (x, z), plus stamp signs. */
  signsNear(x: number, z: number, radius: number): Sign3[] {
    const out: Sign3[] = [];
    for (const c of this.chunks.values()) {
      if (Math.hypot(c.cx - x, c.cz - z) > radius + CELL) continue;
      out.push(...c.plan.signs);
      for (const p of this.placedByCell.get(c.key) ?? []) out.push(...p.signs);
    }
    return out;
  }

  get loaded(): number {
    return this.chunks.size;
  }

  get loadedBuildings(): number {
    let n = 0;
    for (const c of this.chunks.values()) n += c.plan.buildings.length;
    return n;
  }

  get loadedTriangles(): number {
    let n = 0;
    for (const c of this.chunks.values()) n += c.triangles;
    return n;
  }

  private build(mx: number, my: number): void {
    const t0 = performance.now();
    const plan = this.plan(mx, my)!;
    const key = cellKey(mx, my);
    const cx = (mx + 0.5) * CELL;
    const cz = (my + 0.5) * CELL;
    const stamps = (this.placedByCell.get(key) ?? []).map((p) => p.building);
    const all = [...plan.buildings, ...stamps];

    // Full detail: every building (with setbacks/antennas) merged into one mesh = one draw call.
    const full = mergeGeometries(all.map((b) => buildingGeometry(b, rng(b.id))));
    full.translate(-cx, 0, -cz);
    // Distant LOD: only buildings tall enough to show over their neighbours, as plain boxes.
    const tall = all.filter((b) => b.h >= 18);
    const simple = tall.length > 0 ? mergeGeometries(tall.map((b) => buildingGeometry(b, rng(b.id), true))) : null;
    simple?.translate(-cx, 0, -cz);
    const lod = new THREE.LOD();
    lod.addLevel(new THREE.Mesh(full, this.facade), 0);
    lod.addLevel(simple ? new THREE.Mesh(simple, this.facade) : new THREE.Object3D(), LOD_DISTANCE);
    const groundGeo = groundGeometry(plan);
    groundGeo.translate(-cx, 0, -cz);
    const group = new THREE.Group();
    group.position.set(cx, 0, cz);
    lod.position.set(0, 0, 0);
    group.add(lod, new THREE.Mesh(groundGeo, this.ground));
    group.updateMatrixWorld(true);
    this.root.add(group);
    this.chunks.set(key, { key, cx, cz, object: group, plan, triangles: tri(full) + tri(groundGeo) });

    const ms = performance.now() - t0;
    this.stats.generated++;
    this.stats.genMsTotal += ms;
    this.stats.genMsMax = Math.max(this.stats.genMsMax, ms);
  }

  private unload(c: Chunk): void {
    this.root.remove(c.object);
    c.object.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.chunks.delete(c.key);
    this.stats.disposed++;
  }
}

const GROUND = { lot: 0x3a3640, boulevard: 0x24242a, street: 0x2c2c33, alley: 0x34302e, coast: 0x3a4048, sidewalk: 0x5a5862 };

/** Ground for one cell: lot/plaza base, asphalt for its share of each road, raised sidewalks cut at crossings. */
function groundGeometry(plan: CellPlan3): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (r: Rect, y0: number, y1: number, hex: number): void => {
    const c = intersect(r, plan.rect);
    if (!c) return;
    const g = new THREE.BoxGeometry(c.w, y1 - y0, c.h);
    g.translate(c.x + c.w / 2, (y0 + y1) / 2, c.y + c.h / 2);
    const col = new THREE.Color(hex);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.toArray(colors, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  };
  add(plan.rect, -0.2, 0, GROUND.lot);
  for (const r of plan.roads) add(r.rect, 0, 0.02, GROUND[r.kind]);
  for (const r of plan.roads) {
    if (r.sidewalk <= 0) continue;
    const crossings = plan.roads.filter((o) => o !== r && o.vertical !== r.vertical && o.kind !== 'coast' && overlaps(o.rect, r.rect));
    for (const strip of sidewalkStrips(r)) for (const piece of cut(strip, crossings, r.vertical)) add(piece, 0, 0.15, GROUND.sidewalk);
  }
  return mergeGeometries(parts);
}

function sidewalkStrips(r: Road3): Rect[] {
  const s = r.sidewalk;
  const q = r.rect;
  return r.vertical
    ? [{ x: q.x, y: q.y, w: s, h: q.h }, { x: q.x + q.w - s, y: q.y, w: s, h: q.h }]
    : [{ x: q.x, y: q.y, w: q.w, h: s }, { x: q.x, y: q.y + q.h - s, w: q.w, h: s }];
}

/** Removes the spans of a strip covered by crossing roads (1D along the strip's long axis). */
function cut(strip: Rect, crossings: readonly Road3[], vertical: boolean): Rect[] {
  let spans: [number, number][] = [vertical ? [strip.y, strip.y + strip.h] : [strip.x, strip.x + strip.w]];
  for (const o of crossings) {
    const [a, b] = vertical ? [o.rect.y, o.rect.y + o.rect.h] : [o.rect.x, o.rect.x + o.rect.w];
    spans = spans.flatMap(([s, e]) => (b <= s || a >= e ? [[s, e]] : ([[s, a], [b, e]] as [number, number][]).filter(([p, q]) => q - p > 0.1)));
  }
  return spans.map(([s, e]) => (vertical ? { x: strip.x, y: s, w: strip.w, h: e - s } : { x: s, y: strip.y, w: e - s, h: strip.h }));
}
