import { overlaps, type Rect } from '../../core/coords';
import { hash, rng, u01 } from '../../core/hash';
import { frontSpan, isRiverWalk, isVerge, throughMouths, type Building3, type CellPlan3, type Road3 } from '../district/plan';
import { frontFrame, styleFor } from './buildings';
import { shopLight, TRADES } from './shops';
import type { Light } from './lightmap';
import { addCar, addCarLow } from './cars';
import { carMixFor, pickCar } from '../district/carMix';
import type { CarType, VehicleSigns } from '../models/vehicles';
import { EMIT, KIND, lin, type MeshBuilder } from './meshBuilder';
import { filipino, treeSet } from '../district/cityConfig';
import * as manilaStreet from './manilaStreet';
import { addTree, foliageVariant, setFoliageVariant, TREE_REACH, type TreeSpecies } from '../models/trees';
import { addDressing } from './dressing';
import { footbridges, underFootbridge } from '../district/footbridges';
import { openLayout, type OpenLayout } from './openLots';

/** Cell size (district/plan.ts CELL): signals stand where cell-edge roads cross. */
const CELL3 = 128;

/**
 * Street furniture derived from a cell plan (pure: same plan, same props): street lamps along roads with
 * pavements, concrete utility poles with overhead wires along the narrow streets, and vending machines
 * against some buildings. Also the cell's lights for the lightmap (lamp pools, shop spill, vending glow).
 * A prop belongs to the cell containing it, so the shared edge roads aren't furnished twice.
 */

type C3 = [number, number, number];

export interface Prop {
  readonly kind:
    | 'lamp' | 'pole' | 'vending' | 'tree' | 'car' | 'signal'
    // Greenery and the furniture of open ground (openLots.ts).
    | 'hedge' | 'pots' | 'planter' | 'bench' | 'postlamp' | 'fence' | 'paymachine' | 'psign' | 'wheelstop'
    | 'swing' | 'slide' | 'sandbox' | 'toilet' | 'weeds' | 'board' | 'cones' | 'bike' | 'hoop'
    // The port's container yards: a stack of shipping containers (size: how many high; half: half its length).
    | 'container'
    // Manila's streets (manilaStreet.ts).
    | 'sarisari' | 'cart' | 'jeepstop' | 'parol' | 'parolline' | 'tarp' | 'shrine' | 'garbage' | 'barangay' | 'trusses' | 'footbridge';
  readonly x: number;
  readonly z: number;
  /**
   * Facing: towards the road for lamps and poles, out from the wall for vending machines and pots, the way
   * a bench looks. Runs (hedges, fences, cars) lie along the right vector (nz, -nx).
   */
  readonly nx: number;
  readonly nz: number;
  readonly radius: number;
  readonly variant: number;
  /** Half-length of the collision capsule along the right vector (cars, hedges, fences, benches). */
  readonly half?: number;
  /** Signals: arm length out over the road. */
  readonly arm?: number;
  /** Scale (trees, weeds, planters: side in metres). */
  readonly size?: number;
  /** Trees: the species (models/trees.ts); without one, the plain tree (the showroom's previous generation). */
  readonly species?: TreeSpecies;
  /** Cars: the model and its paint (picked by the cell's mix, district/carMix.ts). */
  readonly car?: CarType;
  readonly paint?: number;
  /** Trees: canopy shifted this far toward n (out over the road, off a facade), and raised for traffic. */
  readonly lean?: number;
  readonly high?: boolean;
  /** Trees: a grate at the foot (street trees); off on lawns. */
  readonly grate?: boolean;
  /** false: drawn, but doesn't block walking (weeds, wheel stops, sandboxes). */
  readonly solid?: boolean;
}

export interface CellDetail {
  readonly props: readonly Prop[];
  /** Overhead wires as polylines. */
  readonly wires: readonly (readonly C3[])[];
  readonly lights: readonly Light[];
  /** The cell's open ground, laid out (openLots.ts). */
  readonly open: readonly OpenLayout[];
  /** Solid areas that aren't props (ponds, planters, a park's toilet block). */
  readonly solids: readonly Rect[];
}

const LAMP_SPACING = 22;
const POLE_SPACING = 27;
const LAMP_COLOR: C3 = [1.0, 0.8, 0.55];
const POLE_LAMP: C3 = [0.8, 0.9, 1.0];

/**
 * Along-road spans of r not covered by crossing roads (with a margin), in the road's own axis; with `side`
 * (-1 the low edge, 1 the high), only those reaching that side's pavement (throughMouths: a street's mouth).
 */
function freeSpans(r: Road3, roads: readonly Road3[], margin: number, side = 0): [number, number][] {
  const q = r.rect;
  const s = r.sidewalk;
  const band: Rect = side === 0 ? q : r.vertical ? { ...q, x: side < 0 ? q.x : q.x + q.w - s, w: s } : { ...q, y: side < 0 ? q.y : q.y + q.h - s, h: s };
  let spans: [number, number][] = [r.vertical ? [q.y, q.y + q.h] : [q.x, q.x + q.w]];
  for (const o of roads) {
    if (o === r || o.vertical === r.vertical || o.kind === 'coast' || !overlaps(o.rect, band)) continue;
    const [a, b] = r.vertical ? [o.rect.y - margin, o.rect.y + o.rect.h + margin] : [o.rect.x - margin, o.rect.x + o.rect.w + margin];
    spans = spans.flatMap(([s, e]) => (b <= s || a >= e ? [[s, e]] : ([[s, a], [b, e]] as [number, number][]).filter(([p, t]) => t - p > 2)));
  }
  return spans;
}

export function cellDetail(plan: CellPlan3, extraBuildings: readonly Building3[], plazas: readonly Rect[] = [], covered: readonly Rect[] = []): CellDetail {
  const props: Prop[] = [];
  const wires: C3[][] = [];
  const lights: Light[] = [];
  const cell = plan.rect;
  const mine = (x: number, z: number): boolean => x >= cell.x && z >= cell.y && x < cell.x + cell.w && z < cell.y + cell.h;
  const buildings = [...plan.buildings, ...extraBuildings];
  // Streets reaching through the pavements at their mouths: no lamps or trees there.
  const reach = throughMouths(plan.roads);
  // In front of a stamp (its entrance and forecourt): no street trees or hedges.
  const stampFronts = extraBuildings.map((b) => frontFrame(b));
  const beforeStamp = (x: number, z: number): boolean => stampFronts.some((f) => {
    const dx = x - f.p[0];
    const dz = z - f.p[2];
    const u = dx * f.r[0] + dz * f.r[2];
    const out = dx * f.n[0] + dz * f.n[2];
    return u > -3 && u < f.fw + 3 && out > -0.5 && out < 12;
  });
  // Under something built over it (a parking area's apron): no sunlight, no planting.
  const under = (x: number, z: number): boolean => covered.some((q) => x > q.x - 1.5 && x < q.x + q.w + 1.5 && z > q.y - 1.5 && z < q.y + q.h + 1.5);
  const inBuilding = (x: number, z: number, m: number): boolean => buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + m && Math.abs(z - b.z) < b.d / 2 + m);

  const style = plan.style;
  // Manila: how much street clutter the cell's zones want (0 for Tōto), and the pole runs with their wire bundles.
  const fil = filipino();
  const cellStreet = fil ? plan.buildings.reduce((m, b) => Math.max(m, b.zone?.look.street ?? 0), 0) : 0;
  const rc = { props, lights, mine };
  type Along = (t: number, side: number, inset: number) => [number, number, number, number];
  const poleRun = (r: Road3, side: number, along: Along, rnd: ReturnType<typeof rng>, inset: number): void => {
    for (const [s, e] of freeSpans(r, plan.roads, 1)) {
      let prev: [number, number, number, number] | null = null;
      for (let t = s + 3 + rnd.float() * 6; t < e - 2; t += fil ? 20 : POLE_SPACING) {
        const pt = along(t, side, inset);
        const [x, z, nx, nz] = pt;
        if (!mine(x, z) || inBuilding(x, z, 0.2) || underFootbridge(x, z, 1.5)) {
          prev = null;
          continue;
        }
        const variant = hash(Math.round(x * 10), Math.round(z * 10)) % 10;
        props.push({ kind: 'pole', x, z, nx, nz, radius: 0.25, variant });
        if (variant < 3) lights.push({ x: x + nx * 1.2, z: z + nz * 1.2, r: 7, color: POLE_LAMP, i: 0.5 });
        if (fil) {
          // Service drops: wires from the pole to the nearest building's wall, sagging.
          const wr = rng(hash(Math.round(x * 10), Math.round(z * 10), 0x31e5));
          let best: Building3 | null = null;
          let bd = 14;
          for (const b of buildings) {
            const d = Math.hypot(Math.max(Math.abs(x - b.x) - b.w / 2, 0), Math.max(Math.abs(z - b.z) - b.d / 2, 0));
            if (d < bd) { bd = d; best = b; }
          }
          if (best) {
            for (let k = 0; k < 3; k++) {
              const tx = Math.min(best.x + best.w / 2, Math.max(best.x - best.w / 2, x)) + (wr.float() - 0.5) * 1.5;
              const tz = Math.min(best.z + best.d / 2, Math.max(best.z - best.d / 2, z)) + (wr.float() - 0.5) * 1.5;
              const ya = 6 + wr.float() * 2.6;
              const yb = Math.min(best.h - 0.5, 4 + wr.float() * 3);
              const sag = 0.3 + bd * 0.05 + wr.float() * 0.5;
              const line: C3[] = [];
              for (let q = 0; q <= 3; q++) {
                const f = q / 3;
                line.push([x + (tx - x) * f, ya + (yb - ya) * f - sag * 4 * f * (1 - f), z + (tz - z) * f]);
              }
              wires.push(line);
            }
          }
        }
        if (prev) {
          if (fil) {
            // A tangle: the crossarms' wires, a second tier, and a dozen loose ones sagging deeper at random heights.
            const wr = rng(hash(Math.round(x * 10), Math.round(z * 10), 0x71a9));
            const lines: [number, number, number][] = [[-0.9, 8.9, 0], [-0.45, 8.9, 0], [0, 8.9, 0], [0.45, 8.9, 0], [0.9, 8.9, 0], [-0.6, 7.5, 0.1], [0, 7.5, 0.1], [0.6, 7.5, 0.1]];
            for (let k = 0; k < 5; k++) lines.push([(wr.float() - 0.5) * 2.0, 5.4 + wr.float() * 3.2, 0.5 + wr.float() * 1.0]);
            for (const [off, y, slack] of lines) {
              const a: C3 = [prev[0] + prev[2] * off, y + (slack > 0 ? (wr.float() - 0.5) * 0.4 : 0), prev[1] + prev[3] * off];
              const b: C3 = [x + nx * off, y + (slack > 0 ? (wr.float() - 0.5) * 0.4 : 0), z + nz * off];
              const sag = 0.35 + Math.hypot(b[0] - a[0], b[2] - a[2]) * 0.012 + slack;
              const line: C3[] = [];
              for (let k = 0; k <= 3; k++) {
                const f = k / 3;
                line.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f - sag * 4 * f * (1 - f), a[2] + (b[2] - a[2]) * f]);
              }
              wires.push(line);
            }
          } else {
            for (const [off, y] of [[-0.7, 8.9], [0, 8.9], [0.7, 8.9], [0, 7.5]] as const) {
              // Crossarms run across the street: offset along the pole's facing.
              const a: C3 = [prev[0] + prev[2] * off, y, prev[1] + prev[3] * off];
              const b: C3 = [x + nx * off, y, z + nz * off];
              const sag = 0.35 + Math.hypot(b[0] - a[0], b[2] - a[2]) * 0.012;
              const line: C3[] = [];
              for (let k = 0; k <= 4; k++) {
                const f = k / 4;
                line.push([a[0] + (b[0] - a[0]) * f, y - sag * 4 * f * (1 - f), a[2] + (b[2] - a[2]) * f]);
              }
              wires.push(line);
            }
          }
        }
        prev = pt;
      }
    }
  };
  /**
   * A riverside walk (plan.ts RIVER_WALK), as Tokyo's along the Sumida: a row of cherries along its land side,
   * lamps along the flood wall, and benches between the trees facing the water.
   */
  const riverWalk = (r: Road3): void => {
    const q = r.rect;
    const cx = cell.x + cell.w / 2;
    const cz = cell.y + cell.h / 2;
    // Which way the water is (+1 toward the rect's far edge), and the point at t along it, d in from the water.
    const water = r.vertical ? Math.sign(q.x + q.w / 2 - cx) : Math.sign(q.y + q.h / 2 - cz);
    const width = r.vertical ? q.w : q.h;
    const t0 = r.vertical ? q.y : q.x;
    const t1 = r.vertical ? q.y + q.h : q.x + q.w;
    const at = (t: number, d: number): [number, number] => {
      const edge = r.vertical ? (water > 0 ? q.x + q.w : q.x) : water > 0 ? q.y + q.h : q.y;
      const a = edge - water * d;
      return r.vertical ? [a, t] : [t, a];
    };
    const [wx, wz] = r.vertical ? [water, 0] : [0, water];
    // Cherries along the river; along the bay, black pines (as on Tokyo's bay promenades), a little sparser.
    const bay = r.water === 'bay';
    for (let t = t0 + 4; t < t1 - 3; t += 9) {
      const [x, z] = at(t, width - 1.2);
      if (mine(x, z) && (!bay || Math.round((t - t0) / 9) % 3 !== 2)) props.push({ kind: 'tree', species: (bay ? treeSet().bay : treeSet().riverWalk)[Math.round((t - t0) / 9) % (bay ? treeSet().bay : treeSet().riverWalk).length], x, z, nx: wx, nz: wz, radius: 0.3, variant: hash(Math.round(x), Math.round(z)) % 8, size: 0.85, lean: 1.2 });
      const k = Math.round((t - t0) / 9);
      if (k % 2 === 1) {
        const [bx, bz] = at(t + 4.5, 2.6);
        if (mine(bx, bz)) props.push({ kind: 'bench', x: bx, z: bz, nx: wx, nz: wz, radius: 0.35, variant: 0, half: 0.8 });
      }
      if (k % 3 === 0) {
        const [lx, lz] = at(t + 2, 0.6);
        if (mine(lx, lz)) {
          props.push({ kind: 'lamp', x: lx, z: lz, nx: -wx, nz: -wz, radius: 0.2, variant: 0 });
          lights.push({ x: lx - wx * 1.4, z: lz - wz * 1.4, r: 9, color: LAMP_COLOR, i: 0.7 });
        }
      }
    }
  };
  for (const r of plan.roads) {
    if (isRiverWalk(r)) {
      riverWalk(r);
      continue;
    }
    if (isVerge(r)) {
      // The city's edge: a row of trees along the verge (camphors, evergreen, screening what's beyond).
      const q = r.rect;
      const t0 = r.vertical ? q.y : q.x;
      const t1 = r.vertical ? q.y + q.h : q.x + q.w;
      const c = r.vertical ? q.x + q.w / 2 : q.y + q.h / 2;
      for (let t = t0 + 4; t < t1 - 3; t += 8) {
        const [x, z] = r.vertical ? [c, t] : [t, c];
        if (mine(x, z)) props.push({ kind: 'tree', species: treeSet().verge, x, z, nx: 0, nz: 1, radius: 0.3, variant: hash(Math.round(x), Math.round(z)) % 8, size: 0.9 });
      }
      continue;
    }
    if (r.kind === 'coast') continue;
    const q = r.rect;
    const rnd = rng(hash(Math.round(q.x * 4), Math.round(q.y * 4), Math.round(q.w * 4), Math.round(q.h * 4)));
    const along = (t: number, side: number, inset: number): [number, number, number, number] =>
      r.vertical
        ? side < 0 ? [q.x + inset, t, 1, 0] : [q.x + q.w - inset, t, -1, 0]
        : side < 0 ? [t, q.y + inset, 0, 1] : [t, q.y + q.h - inset, 0, -1];
    if (r.sidewalk > 0) {
      const width = r.vertical ? q.w : q.h;
      const boulevard = width >= 14;
      const edgeRoad = q.x < cell.x || q.y < cell.y || q.x + q.w > cell.x + cell.w || q.y + q.h > cell.y + cell.h;
      // Keep the kerb clear where bus stops can stand (the middle of each cell edge) and of blade signs.
      // One species along a stretch of street (keyed by its line and a two-cell stretch of it, so both cells of an
      // edge road agree), as Tokyo plants them: ginkgo and zelkova avenues, ginkgo and dogwood on narrower
      // pavements, and here and there a sakura namiki, a street lined with cherries (more of them in the
      // residential quarters).
      const stretch = Math.floor((r.vertical ? plan.my : plan.mx) / 2);
      const line = hash(Math.round(r.vertical ? q.x + q.w / 2 : q.y + q.h / 2), r.vertical ? 1 : 2, stretch, 0x5ee7) % 100;
      // (Only a street within one cell leans on its own quarter's style: an edge road's two cells may differ.)
      const homey = !edgeRoad && plan.buildings.some((b) => (b.zone?.look.homes ?? 0) > 0.3) ? 12 : 0;
      const cuts = boulevard ? treeSet().boulevard : treeSet().street;
      const streetSpecies: TreeSpecies = cuts.cuts.find(([, upTo, shifts]) => line < upTo - (shifts ? homey : 0))?.[0] ?? cuts.rest;
      const stopClear = (t: number): boolean => !edgeRoad || Math.abs((((t % CELL3) + CELL3) % CELL3) - CELL3 / 2) > 7;
      const bladeClear = (x: number, z: number, m: number): boolean => !plan.signs.some((g) => g.vertical && Math.hypot(g.x - x, g.z - z) < m);
      for (const side of [-1, 1]) {
        for (const [s, e] of freeSpans(r, reach, 2, side)) {
          // Street lamps on both pavements at the kerb, staggered; street trees between them (always on
          // boulevards, by the zone's streetTrees elsewhere), and on wide pavements a clipped hedge along
          // the kerb between lamp and tree.
          const phase = side > 0 ? LAMP_SPACING / 2 : 0;
          for (let t = s + 4 + phase; t < e - 3; t += LAMP_SPACING) {
            // (A lamp where a bus stop can stand steps aside, just out of its way.)
            const mid = t - (((t % CELL3) + CELL3) % CELL3) + CELL3 / 2;
            const tl = stopClear(t) ? t : t < mid ? mid - 7.5 : mid + 7.5;
            const [x, z, nx, nz] = along(tl, side, r.sidewalk - 0.45);
            if (mine(x, z) && !underFootbridge(x, z, 1.2)) {
              props.push({ kind: 'lamp', x, z, nx, nz, radius: 0.2, variant: 0 });
              lights.push({ x: x + nx * 1.4, z: z + nz * 1.4, r: 9, color: LAMP_COLOR, i: 0.7 });
              if (cellStreet > 0) manilaStreet.lampParol(x, z, nx, nz, hash(Math.round(x * 4), Math.round(z * 4), 0x9a401), cellStreet, rc);
            }
            const tt = t + LAMP_SPACING / 2;
            // The tree sits 0.6-0.9 m in from the kerb; its canopy leans out over the road so it stays
            // clear of the facades, and on narrow pavements it's pruned high for buses.
            const inset = boulevard ? r.sidewalk - 0.9 : r.sidewalk - 0.6;
            const [x2, z2, nx2, nz2] = along(tt, side, inset);
            const roll = u01(hash(Math.round(x2 * 4), Math.round(z2 * 4), 0x7ee));
            if (tt < e - 3 && (boulevard || roll < style.streetTrees) && mine(x2, z2) && stopClear(tt) && bladeClear(x2, z2, 3.2) && !beforeStamp(x2, z2) && !under(x2, z2) && !underFootbridge(x2, z2, 2.5)) {
              // Sized to the pavement: the crown reaches no closer than 0.25 m to the building line. A species
              // too big for its pavement even at half size isn't planted (a cherry on a 1.6 m pavement: its
              // crown stood 2 m out, the trunk in the carriageway on a stem leaning further than it rose).
              const reach = TREE_REACH[streetSpecies];
              const fit = (inset + (boulevard ? 0.9 : 1.2)) / reach;
              if (fit >= 0.5) {
                const size = Math.min(1, fit);
                const lean = Math.max(0, reach * size - (inset - 0.25));
                props.push({ kind: 'tree', species: streetSpecies, x: x2, z: z2, nx: nx2, nz: nz2, radius: 0.3, variant: hash(Math.round(x2), Math.round(z2)) % 8, size, lean, high: !boulevard });
              }
            }
            if (r.sidewalk >= 2.4) {
              for (const [c, h] of [[t + 5.5, 3.6], [t + 16.5, 3.6]] as const) {
                if (c + h > e - 3 || !stopClear(c) || !stopClear(c - h) || !stopClear(c + h)) continue;
                const [hx, hz, hnx, hnz] = along(c, side, r.sidewalk - 0.55);
                if (!mine(hx, hz) || under(hx, hz) || underFootbridge(hx, hz, 2) || u01(hash(Math.round(hx * 4), Math.round(hz * 4), 0x4ed9e)) >= style.hedges) continue;
                if (beforeStamp(hx - (r.vertical ? 0 : h), hz - (r.vertical ? h : 0)) || beforeStamp(hx + (r.vertical ? 0 : h), hz + (r.vertical ? h : 0)) || beforeStamp(hx, hz)) continue;
                props.push({ kind: 'hedge', x: hx, z: hz, nx: hnx, nz: hnz, radius: 0.35, half: h, variant: 0 });
              }
            }
          }
          // Manila: a jeepney stop or tricycle terminal on some stretches, and a tarpaulin across the road now and then.
          if (cellStreet > 0 && e - s > 30) {
            const hs = hash(Math.round(s * 4), Math.round(q.x * 4), Math.round(q.y * 4), side + 9);
            const ts = s + 10 + ((hs >>> 8) % Math.max(1, Math.round(e - s - 20)));
            if (hs % 100 < 60 * cellStreet && stopClear(ts) && stopClear(ts - 4) && stopClear(ts + 4)) {
              const [x, z, nx, nz] = along(ts, side, r.sidewalk - 0.4);
              manilaStreet.stopSign(x, z, nx, nz, hs >>> 4, rc);
            }
            if (side === 1 && width < 20 && (hs >>> 12) % 100 < 24 * cellStreet) {
              const tt = s + 8 + ((hs >>> 16) % Math.max(1, Math.round(e - s - 16)));
              const [cx, cz] = along(tt, -1, width / 2);
              manilaStreet.roadTarp(cx, cz, r.vertical ? 0 : 1, r.vertical ? 1 : 0, width / 2 - 0.5, hs >>> 3, rc);
            }
            if (side === -1 && width < 20 && (hs >>> 9) % 100 < 34 * cellStreet) {
              const tt = s + 8 + ((hs >>> 14) % Math.max(1, Math.round(e - s - 16)));
              const [cx, cz] = along(tt, 1, width / 2);
              manilaStreet.roadParols(cx, cz, r.vertical ? 0 : 1, r.vertical ? 1 : 0, width / 2 - 0.5, hs >>> 5, rc);
            }
          }
          // Traffic signals where two cell-edge roads cross (one per approach; traffic keeps left). Their lamps
          // are driven live (real/traffic.ts SignalLamps) from the junction's signal (district/traffic.ts).
          const q0 = r.vertical ? q.y : q.x;
          const q1 = r.vertical ? q.y + q.h : q.x + q.w;
          const centre = r.vertical ? q.x + q.w / 2 : q.y + q.h / 2;
          const signalRoad = Math.abs(centre - Math.round(centre / CELL3) * CELL3) < 0.01;
          if (width >= 8 && signalRoad) {
            const ends: [number, number][] = [[e - 1.5, -1], [s + 1.5, 1]];
            for (const [t, sd] of ends) {
              if (sd !== side || Math.abs(t - q0) < 2 || Math.abs(t - q1) < 2) continue;
              if (Math.abs(t - Math.round(t / CELL3) * CELL3) > 13) continue;
              const [x, z, nx, nz] = along(t, side, r.sidewalk - 0.35);
              if (mine(x, z)) props.push({ kind: 'signal', x, z, nx, nz, radius: 0.2, variant: hash(Math.round(x), Math.round(z)) % 3, arm: (width - 2 * r.sidewalk) / 2 - 0.5 });
            }
          }
          // Parked cars along the kerb, on the side streets only: the roads along the cell edges carry the
          // moving traffic (real/traffic.ts) in their kerb lanes.
          for (let t = s + 7; t < (edgeRoad ? s : e - 7); t += 6.5) {
            const h = hash(Math.round(t * 10), Math.round(q.x), Math.round(q.y), side + 5);
            if (h % 100 > 32) continue;
            const [x, z, nx, nz] = along(t, side, r.sidewalk + 1.05);
            if (!mine(x, z)) continue;
            props.push({ kind: 'car', x, z, nx, nz, radius: 0.95, variant: (h >>> 8) % 100000, half: 1.4 });
          }
        }
      }
      if (cellStreet > 0 && !boulevard) poleRun(r, rnd.chance(0.5) ? -1 : 1, along, rnd, Math.max(0.35, r.sidewalk - 0.35));
    } else if (q.w >= 2.5 && q.h >= 2.5 && Math.min(q.w, q.h) < 8) {
      // Utility poles along one edge of narrow streets, wired pole to pole.
      const side = rnd.chance(0.5) ? -1 : 1;
      poleRun(r, side, along, rnd, 0.35);
    }
  }

  // Shopfront spill, vending machines and potted plants (on the part of the face clear of a corner cut).
  for (const b of buildings) {
    const s = styleFor(b);
    const f = frontFrame(b);
    const mid = { x: f.p[0] + f.r[0] * (f.fw / 2), z: f.p[2] + f.r[2] * (f.fw / 2) };
    if (!mine(mid.x, mid.z)) continue;
    const [s0, s1] = frontSpan(b);
    const sw = s1 - s0;
    if (s.shopOpen) {
      const color: C3 = shopLight(s.trade, s.hue);
      lights.push({
        x: f.p[0] + f.r[0] * (s0 + 0.4),
        z: f.p[2] + f.r[2] * (s0 + 0.4),
        r: 0,
        color,
        i: TRADES[s.trade].spill,
        band: { dx: f.r[0] * (sw - 0.8), dz: f.r[2] * (sw - 0.8), nx: f.n[0], nz: f.n[2], depth: 4.5 },
      });
    }
    const rnd = rng(hash(b.id, 0x7e4d));
    // (Nothing against a wall in the middle of a cell edge's pavement, where a bus stop can stand: on a narrow
    // pavement its shelter reaches the wall.)
    const atStop = (u: number): boolean => {
      const x = f.p[0] + f.r[0] * u;
      const z = f.p[2] + f.r[2] * u;
      const near = (a: number, b: number): boolean => Math.abs(a - Math.round(a / CELL3) * CELL3) < 14 && Math.abs(b - (Math.floor(b / CELL3) + 0.5) * CELL3) < 9;
      return near(x, z) || near(z, x);
    };
    const used: [number, number][] = [];
    let vendAt: number | null = null;
    if (sw > 6 && b.hue === undefined && rnd.chance(b.zone?.look.vending ?? 0.14)) {
      const count = rnd.int(1, 3);
      const start = rnd.chance(0.5) ? s0 + 0.4 : s1 - 0.4 - count * 1.05;
      vendAt = start + (count * 1.05) / 2;
      used.push([start, start + count * 1.05]);
      for (let i = 0; i < count; i++) {
        const u = start + i * 1.05 + 0.5;
        if (atStop(u)) continue;
        const x = f.p[0] + f.r[0] * u + f.n[0] * 0.45;
        const z = f.p[2] + f.r[2] * u + f.n[2] * 0.45;
        props.push({ kind: 'vending', x, z, nx: f.n[0], nz: f.n[2], radius: 0.55, variant: rnd.int(0, 3) });
        lights.push({ x: x + f.n[0] * 0.8, z: z + f.n[2] * 0.8, r: 3.5, color: [0.8, 0.9, 1.0], i: 0.55 });
      }
    }
    // Potted plants (植木鉢) along the wall at one end, away from any vending machines.
    const pots = rng(hash(b.id, 0x9075));
    let potsAtStart: boolean | null = null;
    if (sw > 3.5 && b.hue === undefined && pots.chance(b.zone?.style.pots ?? plan.style.pots)) {
      const len = Math.min(sw * 0.4, 1.2 + pots.float() * 1.6);
      const atStart = vendAt === null ? pots.chance(0.5) : vendAt > s0 + sw / 2;
      potsAtStart = atStart;
      const u = atStart ? s0 + 0.2 + len / 2 : s1 - 0.2 - len / 2;
      const x = f.p[0] + f.r[0] * u + f.n[0] * 0.35;
      const z = f.p[2] + f.r[2] * u + f.n[2] * 0.35;
      used.push([u - len / 2, u + len / 2]);
      if (!atStop(u - len / 2) && !atStop(u + len / 2)) props.push({ kind: 'pots', x, z, nx: f.n[0], nz: f.n[2], radius: 0.3, half: len / 2, variant: pots.int(0, 99999) });
    }
    // Bicycles (mamachari) parked nose to the wall outside homes, at the other end from the pots.
    const bikes = rng(hash(b.id, 0xb1c5));
    if (s.home && sw > 4 && vendAt === null && bikes.chance(b.zone?.look.bikes ?? 0)) {
      const n = bikes.int(1, 3);
      const atStart = potsAtStart === null ? bikes.chance(0.5) : !potsAtStart;
      for (let i = 0; i < n; i++) {
        const u = atStart ? s0 + 0.5 + i * 0.7 : s1 - 0.5 - i * 0.7;
        if (atStop(u)) continue;
        const x = f.p[0] + f.r[0] * u + f.n[0] * 0.95;
        const z = f.p[2] + f.r[2] * u + f.n[2] * 0.95;
        props.push({ kind: 'bike', x, z, nx: f.n[0], nz: f.n[2], radius: 0.35, variant: bikes.int(0, 99999) });
      }
    }
    // Manila: kiosks, carts, shrines, rubbish, a barangay hall's porch, tarpaulins and parols along the frontage.
    if (fil && (b.zone?.look.street ?? 0) > 0 && b.hue === undefined) {
      const gfh = s.home ? 3 : 4.2;
      manilaStreet.frontage(b, b.zone!.look.street!, { props, lights, atStop, f, s0, s1, used, gf: gfh, floors: Math.max(0, Math.floor((b.h - gfh) / 3)) });
    }
  }
  // Open ground: its props and lights, and solids for collision.
  const open = plan.open.map((o) => openLayout(o, buildings));
  const solids: Rect[] = [];
  for (const o of open) {
    props.push(...o.props);
    lights.push(...o.lights);
    solids.push(...o.solids);
  }
  // Plazas: lamps round the edge facing in, and a loose grid of trees in the middle.
  for (const q of plazas) {
    const rnd = rng(hash(Math.round(q.x), Math.round(q.y), 0x91a2));
    const cx = q.x + q.w / 2;
    const cz = q.y + q.h / 2;
    const edge = (x: number, z: number, nx: number, nz: number): void => {
      if (inBuilding(x, z, 1)) return;
      props.push({ kind: 'lamp', x, z, nx, nz, radius: 0.2, variant: 0 });
      lights.push({ x: x + nx * 1.4, z: z + nz * 1.4, r: 10, color: LAMP_COLOR, i: 0.75 });
    };
    for (let x = q.x + 5; x < q.x + q.w - 3; x += 12) {
      edge(x, q.y + 0.8, 0, 1);
      edge(x + 6, q.y + q.h - 0.8, 0, -1);
    }
    for (let z = q.y + 8; z < q.y + q.h - 3; z += 12) {
      edge(q.x + 0.8, z, 1, 0);
      edge(q.x + q.w - 0.8, z + 6, -1, 0);
    }
    for (let x = q.x + 7; x < q.x + q.w - 5; x += 9) {
      for (let z = q.y + 7; z < q.y + q.h - 5; z += 9) {
        if (Math.abs(x - cx) < 5 && Math.abs(z - cz) < 5) continue; // keep the middle open
        if (!rnd.chance(0.55) || inBuilding(x, z, 2)) continue;
        props.push({ kind: 'tree', species: treeSet().grove, size: 0.75, x, z, nx: 0, nz: 1, radius: 0.3, variant: hash(Math.round(x), Math.round(z)) % 8 });
      }
    }
    lights.push({ x: cx, z: cz, r: Math.max(q.w, q.h) * 0.6, color: [0.9, 0.75, 0.85], i: 0.35 });
  }
  // Manila's footbridges over the avenues: drawn with the cell the span's centre is in; the walking is district/world.ts.
  for (const b of footbridges()) {
    if (!mine(b.x, b.z)) continue;
    const [nx, nz] = b.alongX ? [0, 1] : [1, 0];
    props.push({ kind: 'footbridge', x: b.x, z: b.z, nx, nz, radius: 0, variant: hash(Math.round(b.x), Math.round(b.z)) % 9973, half: b.width / 2, size: b.median, solid: false });
    manilaStreet.footbridgeLights(b, lights);
  }
  // Parked cars (the kerbs' and the open lots'): the models this part of the city has.
  const mix = carMixFor(plan.style, plan.kind);
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    if (p.kind !== 'car' || p.car) continue;
    const c = pickCar(mix, p.variant);
    props[i] = { ...p, car: c.type, paint: c.paint };
  }
  return { props, wires, lights, open, solids };
}

const VENDING = [0xd8d8d4, 0xb8242a, 0x2a4a8a, 0x2a2a2e];

/** Geometry for a cell's props and wires; with `signs`, the parked cars' lettering and ads. */
/**
 * Which props a build takes: all of them, only those with a middle-distance version (`swap`: parked cars,
 * trees, hedges, bikes, the bulk of a chunk's triangles) or only the rest (`fixed`). The chunks build the swap
 * set twice, full and `mid`, and show one or the other by distance (district/world.ts).
 */
export type PropPart = 'all' | 'swap' | 'fixed';
const SWAP_KINDS = new Set<Prop['kind']>(['car', 'tree', 'hedge', 'bike', 'tarp', 'jeepstop']);

export function addProps(mb: MeshBuilder, d: CellDetail, signs?: VehicleSigns, part: PropPart = 'all', mid = false): void {
  mb.id = 0;
  mb.flags = 0;
  // In the middle distance, foliage takes the lighter leaf-card crowns (FOLIAGE_VARIANTS 'cards': the same look as
  // 'airy', ~15-30% fewer triangles; the plain 'puffs' read as balloons).
  const variant = foliageVariant();
  if (mid) setFoliageVariant(2);
  for (const p of d.props) {
    if (part !== 'all' && SWAP_KINDS.has(p.kind) !== (part === 'swap')) continue;
    if (mid && p.kind === 'bike') continue;
    if (mid && p.kind === 'car') {
      const dir = p.variant % 2 ? 1 : -1;
      addCarLow(mb, { x: p.x, z: p.z, fx: p.nz * dir, fz: -p.nx * dir, variant: p.variant, type: p.car, paint: p.paint });
      continue;
    }
    const r: C3 = [p.nz, 0, -p.nx];
    const n: C3 = [p.nx, 0, p.nz];
    const o: C3 = [p.x, 0, p.z];
    if (p.kind === 'lamp') {
      mb.kind = KIND.plain;
      mb.style = [0, 0, 0, 0];
      mb.color = lin(0x5a5e64);
      mb.cylinder(p.x, p.z, 0, 6.6, 0.09, 6);
      mb.box(p.x, p.z, 0, 0.5, 0.3, 0.3);
      // Arm out over the road and the lamp head.
      mb.frameBox(o, r, n, -0.05, 0.05, 6.45, 6.55, 0, 1.6);
      mb.color = lin(0x3a3c40);
      mb.frameBox(o, r, n, -0.18, 0.18, 6.35, 6.5, 1.1, 1.75);
      mb.kind = KIND.emit;
      mb.color = [1.0, 0.85, 0.62];
      mb.style = [EMIT.lamp, 0, 0, 0];
      mb.frameBox(o, r, n, -0.15, 0.15, 6.33, 6.36, 1.15, 1.7);
      mb.style = [0, 0, 0, 0];
    } else if (p.kind === 'pole') {
      mb.kind = KIND.plain;
      mb.style = [0, 0, 0, 0];
      mb.color = lin(0x8a8884);
      mb.cylinder(p.x, p.z, 0, 10, 0.16, 7);
      mb.color = lin(0x4a4a4c);
      // Crossarms across the street.
      mb.frameBox(o, r, n, -0.06, 0.06, 8.8, 8.95, -0.9, 0.9);
      mb.frameBox(o, r, n, -0.05, 0.05, 7.45, 7.55, -0.3, 0.3);
      if (p.variant >= 6) {
        // Pole transformer.
        mb.color = lin(0x7a8288);
        mb.cylinder(p.x - r[0] * 0.35, p.z - r[2] * 0.35, 6.6, 7.6, 0.28, 8);
      }
      if (filipino()) {
        // Manila's poles carry everything: more transformer cans, coloured cable boxes, a coil of slack cable, a second crossarm.
        const v = p.variant;
        mb.color = lin(0x7a8288);
        for (let k = 0; k < (v % 3); k++) mb.cylinder(p.x + n[0] * 0.3 + r[0] * (0.35 * k - 0.1), p.z + n[2] * 0.3 + r[2] * (0.35 * k - 0.1), 6.7, 7.6, 0.26, 8);
        mb.color = lin([0x2f6a4a, 0x5a5e62, 0x2a3a6a, 0x8a3a2a][v % 4]);
        mb.frameBox(o, r, n, 0.12, 0.55, 4.6, 5.4, 0.12, 0.5);
        mb.color = lin([0x5a5e62, 0x2a3a6a, 0x2f6a4a][v % 3]);
        mb.frameBox(o, r, n, -0.5, -0.15, 5.7, 6.3, 0.12, 0.42);
        mb.color = lin(0x2a2a2a);
        mb.lathe(p.x + n[0] * 0.4, p.z + n[2] * 0.4, [[5.0, 0.22], [5.1, 0.28], [5.2, 0.22]], 8);
        mb.color = lin(0x4a4a4c);
        mb.frameBox(o, r, n, -0.7, 0.7, 6.4, 6.5, -0.2, 0.2);
      }
      // Yellow-and-black guard sleeve at the foot.
      mb.color = lin(0xc8a020);
      mb.cylinder(p.x, p.z, 0.2, 2.0, 0.19, 7, false);
      if (p.variant < 3) {
        mb.color = lin(0x3a3c40);
        mb.frameBox(o, r, n, -0.04, 0.04, 5.9, 6.0, 0, 1.0);
        mb.kind = KIND.emit;
        mb.color = [0.85, 0.92, 1.0];
        mb.style = [EMIT.lamp, 0, 0, 0];
        mb.frameBox(o, r, n, -0.12, 0.12, 5.8, 5.9, 0.7, 1.1);
        mb.style = [0, 0, 0, 0];
      }
    } else if (p.kind === 'tree') {
      tree(mb, p);
    } else if (p.kind === 'car') {
      // Cars face either way along the kerb.
      const dir = p.variant % 2 ? 1 : -1;
      addCar(mb, { x: p.x, z: p.z, fx: p.nz * dir, fz: -p.nx * dir, variant: p.variant, type: p.car, paint: p.paint }, signs);
    } else if (p.kind === 'signal') {
      signal(mb, p);
    } else if (p.kind !== 'vending') {
      addDressing(mb, p, signs);
    } else {
      // Vending machine: body, a glowing display front, and a dark slot strip.
      mb.kind = KIND.plain;
      mb.style = [0, 0, 0, 0];
      mb.color = lin(VENDING[p.variant % VENDING.length]);
      mb.frameBox(o, r, n, -0.5, 0.5, 0, 1.83, -0.4, 0.4);
      mb.kind = KIND.emit;
      mb.style = [EMIT.always, 0, 0, 0];
      mb.color = [0.75, 0.8, 0.85];
      mb.quad([o[0] - r[0] * 0.44 + n[0] * 0.405, 0.95, o[2] - r[2] * 0.44 + n[2] * 0.405], [r[0] * 0.88, 0, r[2] * 0.88], [0, 0.78, 0]);
      mb.color = [0.9, 0.35, 0.3];
      mb.quad([o[0] - r[0] * 0.44 + n[0] * 0.405, 0.78, o[2] - r[2] * 0.44 + n[2] * 0.405], [r[0] * 0.88, 0, r[2] * 0.88], [0, 0.06, 0]);
      mb.style = [0, 0, 0, 0];
    }
  }
  if (mid) setFoliageVariant(variant);
  // Manila's wire bundles (about 13 wires a span, ~10k triangles a cell) are a swap part too: full within the middle
  // distance, beyond it every other wire in two segments (a third of the triangles). Tōto's stay in the fixed part.
  const swapWires = filipino();
  if (part === 'swap' && !swapWires) return;
  if (part === 'fixed' && swapWires) return;
  mb.kind = KIND.plain;
  mb.color = [0.02, 0.02, 0.02];
  if (mid) {
    for (let k = 0; k < d.wires.length; k += 2) {
      const w = d.wires[k];
      if (w.length < 2) continue;
      const m = w[w.length >> 1];
      mb.beam(w[0], m, 0.035);
      mb.beam(m, w[w.length - 1], 0.035);
    }
    return;
  }
  for (const w of d.wires) for (let i = 0; i + 1 < w.length; i++) mb.beam(w[i], w[i + 1], 0.035);
}

/** Distance from (x, z) to a prop's axis: its centre, or for runs (half set) the segment along (nz, -nx). */
export function propDist(p: Prop, x: number, z: number): number {
  let dx = x - p.x;
  let dz = z - p.z;
  if (p.half) {
    // Project onto the long axis (perpendicular to its facing) and clamp to the segment.
    const ax = p.nz;
    const az = -p.nx;
    const t = Math.max(-p.half, Math.min(p.half, dx * ax + dz * az));
    dx -= ax * t;
    dz -= az * t;
  }
  return Math.hypot(dx, dz);
}

/** Collision: is a circle at (x, z) blocked by one of these props? (Runs and cars are capsules.) */
export function propBlocked(props: readonly Prop[], x: number, z: number, r: number): boolean {
  return props.some((p) => p.solid !== false && propDist(p, x, z) < p.radius + r);
}

const LEAVES = [0x2e4a26, 0x36522a, 0x2a4222, 0x3e5a2e];

/**
 * Tree: a grate (street trees), a trunk and a lumpy low-poly canopy, scaled by size. A leaning canopy
 * (street trees on narrow pavements) sits out over the road on a branch; high ones clear buses.
 */
function tree(mb: MeshBuilder, p: Prop): void {
  if (p.species) {
    const lean = p.lean ?? 0;
    addTree(mb, { x: p.x, z: p.z, species: p.species, size: p.size, seed: p.variant, lean: [p.nx * lean, p.nz * lean], lift: p.high ? 1.5 : 0, grate: p.grate !== false && p.species !== 'azalea' && p.species !== 'box' && p.species !== 'bougainvillea' });
    return;
  }
  const k = p.size ?? 1;
  const lean = p.lean ?? 0;
  const lift = p.high ? 0.9 : 0;
  const hy = 0.6 + 0.4 * k;
  const Y = (y: number): number => lift + y * hy;
  const cx = p.x + p.nx * lean;
  const cz = p.z + p.nz * lean;
  mb.kind = KIND.plain;
  mb.style = [0, 0, 0, 0];
  if (p.grate !== false) {
    mb.color = lin(0x2a2a2a);
    mb.box(p.x, p.z, 0.15, 0.17, 1.2, 1.2);
  }
  mb.color = lin(0x4a3a2c);
  mb.cylinder(p.x, p.z, 0.1, Y(3.0), 0.1 + 0.05 * k, 6, false);
  if (lean > 0.3) mb.beam([p.x, Y(2.9), p.z], [cx, Y(3.8), cz], 0.12);
  const s = (0.85 + (p.variant % 4) * 0.08) * k;
  mb.color = lin(LEAVES[p.variant % LEAVES.length]);
  mb.lathe(cx, cz, [[Y(2.6), 0.2], [Y(3.1), 1.5 * s], [Y(4.2), 2.0 * s], [Y(5.4), 1.7 * s], [Y(6.3), 0.9 * s], [Y(6.7), 0.1]], 7);
  mb.color = lin(LEAVES[(p.variant + 1) % LEAVES.length]);
  const ox = (p.variant % 2 ? 0.7 : -0.7) * k;
  mb.lathe(cx + ox * p.nz, cz - ox * p.nx, [[Y(3.6), 0.2], [Y(4.0), 1.1 * s], [Y(4.9), 1.4 * s], [Y(5.8), 1.0 * s], [Y(6.3), 0.1]], 6);
}

/** Japanese traffic signal: pole, an arm over the road and a horizontal three-lamp head. */
function signal(mb: MeshBuilder, p: Prop): void {
  const n: C3 = [p.nx, 0, p.nz];
  const r: C3 = [p.nz, 0, -p.nx];
  const o: C3 = [p.x, 0, p.z];
  const arm = Math.max(1.5, p.arm ?? 3);
  mb.kind = KIND.plain;
  mb.style = [0, 0, 0, 0];
  mb.color = lin(0x8a8c90);
  mb.cylinder(p.x, p.z, 0, 5.6, 0.1, 6);
  mb.frameBox(o, r, n, -0.05, 0.05, 5.3, 5.4, 0, arm);
  mb.color = lin(0x5a5e62);
  mb.frameBox(o, r, n, -0.25, 0.0, 5.0, 5.45, arm - 1.2, arm);
  for (const face of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const a = arm - 1.1 + i * 0.37;
      // Dark lenses: the lit one is drawn over them live.
      mb.kind = KIND.plain;
      mb.style = [0, 0, 0, 0];
      mb.color = [0.03, 0.03, 0.03];
      // A lamp disc on each broad face of the head (facing -r and +r).
      const du = face < 0 ? -0.255 : 0.005;
      const c: C3 = [o[0] + r[0] * du + n[0] * (face < 0 ? a : a + 0.3), 5.06, o[2] + r[2] * du + n[2] * (face < 0 ? a : a + 0.3)];
      const along: C3 = face < 0 ? [n[0] * 0.3, 0, n[2] * 0.3] : [-n[0] * 0.3, 0, -n[2] * 0.3];
      mb.quad(c, along, [0, 0.32, 0]);
    }
  }
  mb.kind = KIND.plain;
  mb.style = [0, 0, 0, 0];
}

