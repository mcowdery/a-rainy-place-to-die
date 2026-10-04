import { liftRaw } from './terrain';
import { addBuilding } from '../real/buildings';
import { addDistrictAds } from '../real/districtAds';
import { addGround } from '../real/ground';
import { paintLights, type Light } from '../real/lightmap';
import { MeshBuilder } from '../real/meshBuilder';
import { cellCrowd, packFigures } from '../real/people';
import { addProps } from '../real/props';
import { taxiPhotos } from '../real/taxiAdLayout';
import type { RawGeometry } from '../real/rawGeometry';
import { sightline } from '../real/sightline';
import { addSigns, signLights, SignBuilder, type SignLayout } from '../real/signs';
import type { Building3 } from './plan';
import { landmarkLights } from './landmarks';
import type { DistrictModel } from './model';
import { CELL } from './plan';
import { scrambleKeys, Signals } from './traffic';

/**
 * Builds a chunk's geometry in stages, as transferable arrays. Runs in the chunk workers (chunkWorker.ts);
 * the main thread only turns the arrays into meshes.
 * - base: ground, the plain building masses (distant LOD) and the cell's lightmap tile;
 * - near: full building dressing, street furniture, signs; the props with a middle-distance version (parked
 *   cars, trees, hedges, bikes) apart, full and simplified, for the streamer to show by distance;
 * - ghosts: the crowd of people, as numbers (people.ts packFigures) for the instanced crowd (real/crowd.ts).
 * Coordinates are relative to the cell centre.
 */
export type Stage = 'base' | 'near' | 'ghosts';

export interface ChunkBuilt {
  readonly mx: number;
  readonly my: number;
  readonly stage: Stage;
  readonly meshes: Partial<Record<'base' | 'far' | 'near' | 'props' | 'propsMid' | 'signs' | 'ads' | 'taxiAds', RawGeometry | null>>;
  /** The crowd stage's people, as numbers for the instanced crowd (people.ts packFigures). */
  readonly crowd?: Float32Array;
  readonly lightmap?: Uint8Array;
  readonly people?: number;
  /** Time spent building, in the worker. */
  readonly ms: number;
}

export class ChunkBuilder {
  private readonly mb = new MeshBuilder(1 << 16);
  /** The junctions' signals (the crowd crosses on them). */
  private readonly signals: Signals;
  /** The props with a middle-distance version (cars, trees, hedges, bikes): full, and the middle distance's. */
  private readonly pf = new MeshBuilder(1 << 16);
  private readonly pm = new MeshBuilder(1 << 14);
  private readonly sb = new SignBuilder();
  private readonly ab = new SignBuilder();
  /** Parked taxis' photo ads (the taxi ad atlas). */
  private readonly tb = new SignBuilder();
  private readonly canvas = new OffscreenCanvas(CELL, CELL);
  private readonly g = this.canvas.getContext('2d', { willReadFrequently: true })!;

  constructor(
    private readonly model: DistrictModel,
    private readonly layout: SignLayout,
  ) {
    this.signals = new Signals(scrambleKeys(model.placed, CELL));
  }

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
      const detail = m.detail(mx, my)!;
      addProps(mb, detail, undefined, 'fixed');
      const pf = this.pf.reset();
      addProps(pf, detail, { sb, layout: this.layout, photos: taxiPhotos(tb) }, 'swap');
      const pm = this.pm.reset();
      addProps(pm, detail, undefined, 'swap', true);
      // Sightlines for billboards and rooftop letters: this cell's and the neighbours' buildings.
      const around: Building3[] = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) around.push(...m.buildings(mx + dx, my + dy));
      const seen = sightline(around);
      addSigns([...plan.signs, ...m.stamps(mx, my).flatMap((p) => p.signs)], buildings, this.layout, sb, mb, seen);
      const ab = this.ab.reset();
      addDistrictAds(ab, mb, buildings, plan.signs, m.detail(mx, my)!.props, undefined, seen, plan.open);
      return { mx, my, stage, meshes: { near: lift(mb.raw(cx, cz)), props: lift(pf.raw(cx, cz)), propsMid: lift(pm.raw(cx, cz)), signs: lift(sb.raw(cx, cz)), ads: lift(ab.raw(cx, cz)), taxiAds: lift(tb.raw(cx, cz)) }, ms: performance.now() - t0 };
    }
    // People as numbers (the main thread draws them instanced), standing on the lie of the land.
    const around = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) around.push(...(m.plan(mx + dx, my + dy)?.roads ?? []));
    // The set pieces are solid to the crowd: the small, closed ones whole, all of them by their walls and fixtures.
    const solid = m.crowdSolids(mx, my);
    const crowd = cellCrowd(plan, m.detail(mx, my)!, m.plazas(mx, my), this.signals, around, solid.stamps, solid.fixtures);
    return { mx, my, stage, meshes: {}, crowd: packFigures(crowd, raised ? (x, z) => T.height(x, z) : null), people: crowd.length, ms: performance.now() - t0 };
  }
}

