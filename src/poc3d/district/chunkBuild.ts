import { liftRaw } from './terrain';
import { addBuilding } from '../real/buildings';
import { addDistrictAds } from '../real/districtAds';
import { addGround } from '../real/ground';
import { paintLights, type Light } from '../real/lightmap';
import { MeshBuilder } from '../real/meshBuilder';
import { addFigure, addUmbrella, cellCrowd, GhostBuilder } from '../real/people';
import { addProps } from '../real/props';
import { taxiPhotos } from '../real/taxiAdLayout';
import type { RawGeometry } from '../real/rawGeometry';
import { sightline } from '../real/sightline';
import { addSigns, signLights, SignBuilder, type SignLayout } from '../real/signs';
import type { Building3 } from './plan';
import { landmarkLights } from './landmarks';
import type { DistrictModel } from './model';
import { CELL } from './plan';

/**
 * Builds a chunk's geometry in stages, as transferable arrays. Runs in the chunk workers (chunkWorker.ts);
 * the main thread only turns the arrays into meshes.
 * - base: ground, the plain building masses (distant LOD) and the cell's lightmap tile;
 * - near: full building dressing, street furniture, signs;
 * - ghosts: the crowd of people.
 * Coordinates are relative to the cell centre.
 */
export type Stage = 'base' | 'near' | 'ghosts';

export interface ChunkBuilt {
  readonly mx: number;
  readonly my: number;
  readonly stage: Stage;
  readonly meshes: Partial<Record<'base' | 'far' | 'near' | 'signs' | 'ads' | 'taxiAds' | 'ghosts' | 'umbrellas', RawGeometry | null>>;
  readonly lightmap?: Uint8Array;
  readonly people?: number;
  /** Time spent building, in the worker. */
  readonly ms: number;
}

export class ChunkBuilder {
  private readonly mb = new MeshBuilder(1 << 16);
  private readonly sb = new SignBuilder();
  private readonly ab = new SignBuilder();
  /** Parked taxis' photo ads (the taxi ad atlas). */
  private readonly tb = new SignBuilder();
  private readonly gb = new GhostBuilder();
  private readonly ub = new GhostBuilder();
  private readonly canvas = new OffscreenCanvas(CELL, CELL);
  private readonly g = this.canvas.getContext('2d', { willReadFrequently: true })!;

  constructor(
    private readonly model: DistrictModel,
    private readonly layout: SignLayout,
  ) {}

  build(mx: number, my: number, stage: Stage): ChunkBuilt {
    const t0 = performance.now();
    const m = this.model;
    const plan = m.plan(mx, my)!;
    const cx = (mx + 0.5) * CELL;
    const cz = (my + 0.5) * CELL;
    // Landmarks keep their footprint (collision, prop clearance) but are built on the main thread.
    const buildings = m.massed(mx, my);
    // The lie of the land (terrain.ts): everything lifted onto the ground, buildings level at their footing.
    const T = m.terrain;
    const raised = T.raised(mx, my);
    const footings = new Map<number, number>();
    if (raised) for (const b of m.buildings(mx, my)) footings.set(b.id, T.footing(b.x, b.z, b.w, b.d));
    const lift = <R extends Parameters<typeof liftRaw>[0]>(r: R): R => {
      if (raised) liftRaw(r, T, cx, cz, footings);
      return r;
    };
    if (stage === 'base') {
      addGround(this.mb.reset(), plan, m.plazas(mx, my), m.scrambles(mx, my), m.holes(mx, my), m.detail(mx, my)!.open);
      const base = lift(this.mb.raw(cx, cz));
      const mb = this.mb.reset();
      for (const b of buildings) addBuilding(mb, b, false);
      const far = lift(mb.raw(cx, cz));
      // Lightmap tile: this cell's lights plus any from the neighbours that reach across the border.
      const lights: Light[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const d = m.detail(mx + dx, my + dy);
          if (d) lights.push(...d.lights);
          const p = m.plan(mx + dx, my + dy);
          if (p) lights.push(...signLights(p.signs));
          for (const q of m.stamps(mx + dx, my + dy)) {
            lights.push(...signLights(q.signs));
            lights.push(...landmarkLights(q));
            for (const n of q.nodes) if (n.kind === 'door') lights.push({ x: n.x, z: n.z, r: 6, color: [1.0, 0.7, 0.4], i: 0.9 });
          }
        }
      }
      const lightmap = paintLights(this.g, mx * CELL, my * CELL, CELL, lights);
      return { mx, my, stage, meshes: { base, far }, lightmap, ms: performance.now() - t0 };
    }
    if (stage === 'near') {
      const mb = this.mb.reset();
      for (const b of buildings) addBuilding(mb, b, true);
      const sb = this.sb.reset();
      const tb = this.tb.reset();
      addProps(mb, m.detail(mx, my)!, { sb, layout: this.layout, photos: taxiPhotos(tb) });
      // Sightlines for billboards and rooftop letters: this cell's and the neighbours' buildings.
      const around: Building3[] = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) around.push(...m.buildings(mx + dx, my + dy));
      const seen = sightline(around);
      addSigns([...plan.signs, ...m.stamps(mx, my).flatMap((p) => p.signs)], buildings, this.layout, sb, mb, seen);
      const ab = this.ab.reset();
      addDistrictAds(ab, mb, buildings, plan.signs, m.detail(mx, my)!.props, undefined, seen, plan.open);
      return { mx, my, stage, meshes: { near: lift(mb.raw(cx, cz)), signs: lift(sb.raw(cx, cz)), ads: lift(ab.raw(cx, cz)), taxiAds: lift(tb.raw(cx, cz)) }, ms: performance.now() - t0 };
    }
    const crowd = cellCrowd(plan, m.detail(mx, my)!, m.plazas(mx, my));
    const gb = this.gb.reset();
    const ub = this.ub.reset();
    for (const f of crowd) {
      addFigure(gb, f);
      addUmbrella(ub, f);
    }
    return { mx, my, stage, meshes: { ghosts: lift(gb.raw(cx, cz)), umbrellas: lift(ub.raw(cx, cz)) }, people: crowd.length, ms: performance.now() - t0 };
  }
}

