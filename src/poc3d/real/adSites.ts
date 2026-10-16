import { hash, u01 } from '../../core/hash';
import type { DistrictId } from '../../gen/macro';
import type { Road } from '../district/expressway';
import type { DistrictModel } from '../district/model';
import { CELL, cellKey, frontSpan, type Building3, type Side } from '../district/plan';
import type { RailLine3 } from '../district/rail';
import { DISTRICT_ADS, type AdCategory } from '../models/ads';
import { FH, frontFrame, GF, styleFor, tiers, WIN } from './buildings';
import { propDist, type Prop } from './props';
import { sightline } from './sightline';
import { hasRooftopLetters } from './signs';
import { RAIL_Y } from './station';

/**
 * Where the district's photo ads go (pure, so the chunk workers, the tests and the audit agree).
 *
 * A billboard is placed for somebody: a candidate (a roof edge, a windowless wall) is scored by the people who
 * would really see it, and only the best in its neighbourhood is built.
 * - Viewers are points people look from: along the expressway's decks (drivers), along the elevated lines
 *   (passengers at the windows), and down the middle of the boulevards and streets (anyone on the street).
 * - A viewer sees a panel if it is in range, the panel faces them, it isn't too high up to look at or too small
 *   to read, and nothing stands between (a ray over the buildings' heights). A panel's score is the metres of
 *   road, track or street it is well seen from; it needs enough of them (NEED) to be built at all.
 * - No two within RADIUS of each other: only the best-seen candidate of a neighbourhood stays.
 * - Never over windows: roofs, and the walls of windowless (WIN.blank) buildings only. A board is up to 14 m wide,
 *   18 m for the expressway (seen from further off, at speed).
 * Posters are for people standing about: at eye level beside a bus stop, a station's door, a big crossing, a square.
 * Which ad a panel carries follows its zone (a transit-facing one: the everyday brands), and the same brand never
 * comes twice within a tile or in neighbouring tiles (TILE).
 */

type C3 = [number, number, number];

/** Who a panel is for. */
export type AdView = 'expressway' | 'rail' | 'street' | 'wait';

export interface AdSite {
  readonly kind: 'rooftop' | 'wall' | 'poster';
  readonly b: Building3;
  /** A point on the panel's plane at ground level, under its middle; the panel's right and outward normal. */
  readonly c: C3;
  readonly r: C3;
  readonly n: C3;
  readonly w: number;
  readonly h: number;
  /** The panel's bottom edge (m above the building's footing). */
  readonly y0: number;
  /** Rooftop: the roof it stands on (its posts' feet). */
  readonly top: number;
  /** On the building's street face (flush), not a side or back wall (on a frame standing off it). */
  readonly front: boolean;
  readonly view: AdView;
  /** How well it is seen: 1 is just enough to be built. */
  readonly score: number;
  /** The nearest place it is well seen from (an eye's; a poster's: a step in front of it, over the ground). */
  readonly from: C3;
  /** Its ad (index into DISTRICT_ADS); -1 for a candidate that has none yet. */
  readonly ad: number;
}

/** The rules, each one a switch (for looking at one at a time). */
export const AD_RULES = { expressway: true, rail: true, street: true, posters: true };

const CLS = { expressway: 0, rail: 1, street: 2 } as const;
const VIEWS: readonly AdView[] = ['expressway', 'rail', 'street'];

interface ViewRule {
  /** Metres from the panel. */
  readonly min: number;
  readonly max: number;
  /** The least cosine between the panel's normal and the way to the viewer. */
  readonly face: number;
  /** The slope up to the panel's top edge at most, and down (or up) to a third of the way up it at least. */
  readonly up: number;
  readonly down: number;
  /** The panel's height over the distance, as it faces the viewer, at least. */
  readonly size: number;
  /** Metres of good view a panel needs. */
  readonly need: number;
  /** No other panel within this of one. */
  readonly radius: number;
}

const RULES: readonly ViewRule[] = [
  // A driver: ahead and to the side through the windscreen, above the parapet, not up under the roof.
  { min: 25, max: 120, face: 0.35, up: 0.27, down: -0.05, size: 0.035, need: 50, radius: 70 },
  // A passenger: out of the side windows, level or a little down onto the roofs.
  { min: 12, max: 90, face: 0.5, up: 0.4, down: -0.3, size: 0.045, need: 45, radius: 60 },
  // On the street: more or less head on (the end of a street, across a crossing or a square), without craning.
  { min: 18, max: 100, face: 0.77, up: 0.5, down: -1, size: 0.045, need: 36, radius: 50 },
];

/** How many street-facing billboards a district takes: its need divided by this, its spacing by the root. */
const DENSITY: Readonly<Record<string, number>> = { neon: 1, electric: 1, tower: 0.7, harbor: 0.3, residential: 0.35, campus: 0.3, oldtown: 0.25 };
const density = (kind: DistrictId): number => DENSITY[kind] ?? 0.5;

/** Metres between the viewers along the expressway and the lines, and along the streets. */
const STEP = 6;
const STREET_STEP = 8;
/** A street viewer's eye, a driver's above the deck, a passenger's above the rail. */
const EYE = 1.6;
const DRIVER_EYE = 1.2;
const PASSENGER_EYE = 2.2;

interface Viewer {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The way they travel (the expressway's). */
  readonly hx: number;
  readonly hz: number;
  readonly cls: number;
  /** Metres of path it stands for, weighted by how busy the path is. */
  readonly w: number;
}

interface Scored extends AdSite {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** What the placement reads besides the model: the expressway's decks and the elevated lines. */
export interface AdSources {
  readonly expressway: readonly Road[];
  readonly rails: readonly RailLine3[];
}

const N = CELL * 3;

export class AdSites {
  private readonly global = new Map<number, Viewer[]>();
  private readonly scoredCache = new Map<number, Scored[]>();
  private readonly sitesCache = new Map<number, AdSite[]>();
  /** Heights (roofs over the ground) of the 3x3 cells being scored, 1 m a cell. */
  private readonly hf = new Float32Array(N * N);
  private ox = 0;
  private oz = 0;

  constructor(
    private readonly model: DistrictModel,
    src: AdSources,
  ) {
    const put = (v: Viewer): void => {
      const k = cellKey(Math.floor(v.x / CELL), Math.floor(v.z / CELL));
      const list = this.global.get(k);
      if (list) list.push(v);
      else this.global.set(k, [v]);
    };
    if (AD_RULES.expressway) {
      for (const road of src.expressway) {
        if (road.kind !== 'loop' && road.kind !== 'route') continue;
        for (let i = 0; i < road.x.length; i += STEP) {
          // (Not in a tunnel's mouth or down at the street.)
          if (road.y[i] < 6) continue;
          put({ x: road.x[i], y: road.y[i] + DRIVER_EYE, z: road.z[i], hx: road.tx[i], hz: road.tz[i], cls: CLS.expressway, w: STEP });
        }
      }
    }
    if (AD_RULES.rail) {
      for (const line of src.rails) {
        const { xs, zs, ss } = line.path;
        let next = 0;
        for (let i = 0; i < xs.length; i++) {
          if (ss[i] < next) continue;
          next = ss[i] + STEP;
          put({ x: xs[i], y: RAIL_Y + PASSENGER_EYE, z: zs[i], hx: 0, hz: 0, cls: CLS.rail, w: STEP });
        }
      }
    }
  }

  /** A cell's ads: its billboards and posters, each with its ad. */
  sites(mx: number, my: number): readonly AdSite[] {
    const k = cellKey(mx, my);
    let s = this.sitesCache.get(k);
    if (!s) {
      s = this.model.has(mx, my) ? [...assign(this.billboards(mx, my), 'billboard'), ...assign(AD_RULES.posters ? this.posters(mx, my) : [], 'poster')] : [];
      this.sitesCache.set(k, s);
    }
    return s;
  }

  /** A cell's billboard candidates that are seen well enough, the best of each building (before the spacing rule). */
  candidates(mx: number, my: number): readonly AdSite[] {
    return this.scored(mx, my);
  }

  /** The candidates no better one stands near. */
  private billboards(mx: number, my: number): AdSite[] {
    const around: Scored[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) around.push(...this.scored(mx + dx, my + dy));
    return this.scored(mx, my).filter((s) => !around.some((t) => t !== s && (t.score > s.score || (t.score === s.score && t.b.id < s.b.id)) && Math.hypot(t.x - s.x, t.z - s.z) < s.radius));
  }

  private scored(mx: number, my: number): Scored[] {
    const k = cellKey(mx, my);
    let s = this.scoredCache.get(k);
    if (!s) {
      s = this.score(mx, my);
      this.scoredCache.set(k, s);
    }
    return s;
  }

  private score(mx: number, my: number): Scored[] {
    const m = this.model;
    const plan = m.plan(mx, my);
    if (!plan || plan.buildings.length === 0) return [];
    const T = m.terrain;
    let raised = false;
    const around: Building3[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        around.push(...m.buildings(mx + dx, my + dy));
        raised ||= m.has(mx + dx, my + dy) && T.raised(mx + dx, my + dy);
      }
    }
    const ground = raised ? (x: number, z: number): number => T.height(x, z) : (): number => 0;
    const footing = raised ? (b: Building3): number => T.footing(b.x, b.z, b.w, b.d) : (): number => 0;

    // Viewers: the expressway's and the lines' near here, and the streets' (a street under a deck or a viaduct sees
    // nothing over it; a road along a cell's edge is in both cells' plans, so each point is taken once).
    const viewers: Viewer[] = [];
    const covered = new Set<number>();
    const q8 = (x: number, z: number): number => Math.round(x / 8) * 65536 + Math.round(z / 8);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const v of this.global.get(cellKey(mx + dx, my + dy)) ?? []) {
          viewers.push(v);
          for (let a = -8; a <= 8; a += 8) for (let b = -8; b <= 8; b += 8) covered.add(q8(v.x + a, v.z + b));
        }
      }
    }
    if (AD_RULES.street) {
      const seen = new Set<number>();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const road of m.plan(mx + dx, my + dy)?.roads ?? []) {
            if (road.kind === 'alley' || road.verge) continue;
            const w = (road.kind === 'boulevard' ? 1 : 0.75) * STREET_STEP;
            const q = road.rect;
            const len = road.vertical ? q.h : q.w;
            for (let t = STREET_STEP / 2; t < len; t += STREET_STEP) {
              const x = road.vertical ? q.x + q.w / 2 : q.x + t;
              const z = road.vertical ? q.y + t : q.y + q.h / 2;
              const key = Math.round(x / 4) * 65536 + Math.round(z / 4);
              if (seen.has(key) || covered.has(q8(x, z))) continue;
              seen.add(key);
              viewers.push({ x, y: ground(x, z) + EYE, z, hx: 0, hz: 0, cls: CLS.street, w });
            }
          }
        }
      }
    }
    if (viewers.length === 0) return [];

    // The heights round here.
    const hf = this.hf;
    this.ox = (mx - 1) * CELL;
    this.oz = (my - 1) * CELL;
    hf.fill(0);
    // (The ground is a blend of each cell's four corners: terrain.ts.)
    for (let cy = 0; raised && cy < 3; cy++) {
      for (let cx = 0; cx < 3; cx++) {
        const [gx, gy] = [mx - 1 + cx, my - 1 + cy];
        const [a, b, c, d] = [T.junction(gx, gy), T.junction(gx + 1, gy), T.junction(gx, gy + 1), T.junction(gx + 1, gy + 1)];
        if (a === 0 && b === 0 && c === 0 && d === 0) continue;
        for (let iz = 0; iz < CELL; iz++) {
          const v = (iz + 0.5) / CELL;
          const [l, r] = [a + (c - a) * v, b + (d - b) * v];
          const row = (cy * CELL + iz) * N + cx * CELL;
          for (let ix = 0; ix < CELL; ix++) hf[row + ix] = l + ((r - l) * (ix + 0.5)) / CELL;
        }
      }
    }
    for (const b of around) {
      const f = footing(b);
      for (const [w, d, , y1, ox, oz] of b.hue === undefined ? tiers(b) : [[b.w, b.d, 0, b.h, 0, 0]]) {
        const x0 = Math.max(0, Math.ceil(b.x + ox - w / 2 - this.ox - 0.5));
        const x1 = Math.min(N - 1, Math.floor(b.x + ox + w / 2 - this.ox - 0.5));
        const z0 = Math.max(0, Math.ceil(b.z + oz - d / 2 - this.oz - 0.5));
        const z1 = Math.min(N - 1, Math.floor(b.z + oz + d / 2 - this.oz - 0.5));
        for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) if (hf[iz * N + ix] < f + y1) hf[iz * N + ix] = f + y1;
      }
    }

    const letters = sightline(around);
    const dens = density(plan.kind);
    const out: Scored[] = [];
    const sums = [0, 0, 0];
    // (The nearest viewer of each kind that sees a panel.)
    const nearest: (Viewer | null)[] = [null, null, null];
    const reach = [0, 0, 0];
    for (const b of plan.buildings) {
      if (b.hue !== undefined) continue; // stamps are hand-dressed
      const base = footing(b);
      let best: Scored | null = null;
      for (const c of panels(b, letters)) {
        const y0 = base + c.y0;
        const tx = c.c[0] + c.n[0] * 0.4;
        const tz = c.c[2] + c.n[2] * 0.4;
        const ty = y0 + c.h * 0.35;
        const side = c.w * 0.3;
        sums[0] = sums[1] = sums[2] = 0;
        nearest[0] = nearest[1] = nearest[2] = null;
        for (const v of viewers) {
          const dx = v.x - tx;
          const dz = v.z - tz;
          const rule = RULES[v.cls];
          const d2 = dx * dx + dz * dz;
          if (d2 < rule.min * rule.min || d2 > rule.max * rule.max) continue;
          const d = Math.sqrt(d2);
          const facing = (dx * c.n[0] + dz * c.n[2]) / d;
          if (facing < rule.face) continue;
          if (y0 + c.h - v.y > rule.up * d || y0 + c.h / 3 - v.y < rule.down * d || c.h * facing < rule.size * d) continue;
          // A driver looks where the road goes: not at what is level with the car or behind it.
          if (v.cls === CLS.expressway && -(dx * v.hx + dz * v.hz) < 0.1 * d) continue;
          if (!this.clear(v.x, v.y, v.z, tx - c.r[0] * side, ty, tz - c.r[2] * side) || !this.clear(v.x, v.y, v.z, tx + c.r[0] * side, ty, tz + c.r[2] * side)) continue;
          sums[v.cls] += v.w;
          if (!nearest[v.cls] || d2 < reach[v.cls]) {
            nearest[v.cls] = v;
            reach[v.cls] = d2;
          }
        }
        let score = 0;
        let top = 0;
        let view: AdView = 'street';
        for (let k = 0; k < 3; k++) {
          const s = (sums[k] / RULES[k].need) * (k === CLS.street ? dens : 1);
          score += s;
          if (s > top) {
            top = s;
            view = VIEWS[k];
          }
        }
        if (top < 1 || (c.w > BOARD && view !== 'expressway')) continue;
        if (!best || score > best.score) {
          const k = CLS[view as keyof typeof CLS];
          const rad = RULES[k].radius;
          const v = nearest[k]!;
          const from: C3 = [v.x, v.y, v.z];
          best = { ...c, view, score, from, ad: -1, x: tx, z: tz, radius: view === 'street' ? rad / Math.sqrt(dens) : rad };
        }
      }
      if (best) out.push(best);
    }
    return out;
  }

  /** Whether the way from a viewer to a point clears the roofs between (the last metre, the panel's own wall, apart). */
  private clear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const n = Math.ceil(Math.hypot(dx, dz));
    const hf = this.hf;
    for (let i = 1; i < n - 1; i++) {
      const t = i / n;
      const ix = Math.floor(ax + dx * t - this.ox);
      const iz = Math.floor(az + dz * t - this.oz);
      if (ix < 0 || iz < 0 || ix >= N || iz >= N) continue;
      if (hf[iz * N + ix] > ay + (by - ay) * t + 0.05) return false;
    }
    return true;
  }

  /**
   * Posters, where people stand about: on the shopfronts nearest a bus stop, a station's door, a crossing of two
   * avenues, and along a square. Each just inside one of its storefront's pillars, clear of what stands there.
   */
  private posters(mx: number, my: number): AdSite[] {
    const m = this.model;
    const plan = m.plan(mx, my)!;
    const props = m.detail(mx, my)?.props ?? [];
    const cell = { x: mx * CELL, y: my * CELL };
    const inReach = (x: number, z: number, reach: number): boolean => x > cell.x - reach && x < cell.x + CELL + reach && z > cell.y - reach && z < cell.y + CELL + reach;
    // Where people wait: [x, z, how far its posters may be, how many].
    const waits: [number, number, number, number][] = [];
    for (const s of m.stopSites()) if (inReach(s.x, s.z, 12)) waits.push([s.x, s.z, 12, 2]);
    for (const p of m.placed) for (const n of p.nodes) if (n.kind === 'station' && inReach(n.x, n.z, 30)) waits.push([n.x, n.z, 30, 3]);
    // Crossings only where there are crowds to wait at them. (A crossing is in four cells' plans: one poster from each.)
    const big = density(plan.kind) < 0.7 ? [] : plan.roads.filter((r) => r.kind === 'boulevard' && (r.vertical ? r.rect.w : r.rect.h) >= 15);
    for (const a of big) {
      for (const b of big) {
        if (!a.vertical || b.vertical) continue;
        const x0 = Math.max(a.rect.x, b.rect.x);
        const x1 = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w);
        const z0 = Math.max(a.rect.y, b.rect.y);
        const z1 = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h);
        if (x1 > x0 && z1 > z0) waits.push([(x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(a.rect.w, b.rect.h) / 2 + 9, 1]);
      }
    }
    for (const q of m.plazas(mx, my)) waits.push([q.x + q.w / 2, q.y + q.h / 2, Math.hypot(q.w, q.h) / 2 + 5, 4]);
    if (waits.length === 0) return [];

    // Each shopfront's spot: the pillar end nearer the people, unless something stands there.
    const pw = 0.6;
    const spots: { b: Building3; c: C3; r: C3; n: C3 }[] = [];
    for (const b of plan.buildings) {
      if (b.hue !== undefined || styleFor(b).home) continue;
      const [s0, s1] = frontSpan(b);
      if (s1 - s0 <= 3.5) continue;
      const f = frontFrame(b);
      const at = (u: number): [number, number] => [f.p[0] + f.r[0] * u, f.p[2] + f.r[2] * u];
      const blocked = (u: number): boolean => props.some((q: Prop) => (q.kind === 'vending' || q.kind === 'pots' || q.kind === 'payphone') && propDist(q, at(u)[0], at(u)[1]) < 1.3);
      const ends = [s0 + 0.4 + pw / 2, s1 - 0.4 - pw / 2].filter((u) => !blocked(u));
      for (const u of ends) spots.push({ b, c: [at(u)[0], 0, at(u)[1]], r: f.r, n: f.n });
    }
    const out: AdSite[] = [];
    const taken = new Set<number>();
    for (const [x, z, reach, count] of waits) {
      const near = spots
        .map((s) => ({ s, d: Math.hypot(s.c[0] - x, s.c[2] - z) }))
        // In reach, and on a front that looks toward the place.
        .filter(({ s, d }) => d < reach && (x - s.c[0]) * s.n[0] + (z - s.c[2]) * s.n[2] > -1)
        .sort((a, b) => a.d - b.d || a.s.b.id - b.s.b.id);
      let n = 0;
      for (const { s } of near) {
        if (n >= count) break;
        if (taken.has(s.b.id) || out.some((o) => Math.hypot(o.c[0] - s.c[0], o.c[2] - s.c[2]) < 5)) continue;
        taken.add(s.b.id);
        n++;
        out.push({ kind: 'poster', b: s.b, c: s.c, r: s.r, n: s.n, w: pw, h: pw * 1.5, y0: 0.95, top: 0, front: true, view: 'wait', score: 1, from: [s.c[0] + s.n[0] * 2.2, EYE, s.c[2] + s.n[2] * 2.2], ad: -1 });
      }
    }
    return out.sort((a, b) => a.b.id - b.b.id);
  }
}

const SIDES: readonly Side[] = ['north', 'east', 'south', 'west'];

type Panel = Omit<AdSite, 'view' | 'score' | 'from' | 'ad'>;
/** A rooftop board's width at most, and on a roof wide enough the larger one put up for the expressway alone. */
const BOARD = 14;
const BOARD_EXPRESSWAY = 18;

/** A building's candidate panels: one on each edge of its roof, and one on each wall if it has no windows. */
function panels(b: Building3, letters: (b: Building3, y: number) => boolean): Panel[] {
  const s = styleFor(b);
  const out: Panel[] = [];
  const ts = tiers(b);
  // A roof: flat, of a building that isn't a home, without the channel letters (they have the roof to themselves).
  if (b.h >= 9 && !s.home && !s.roof && !s.church && !s.block && !hasRooftopLetters(b, letters)) {
    const [tw, td, , y1, ox, oz] = ts[ts.length - 1];
    const top = y1 + s.parapet;
    for (const side of SIDES) {
      // The top tier's face on this side, clear of a corner cut when the top is the cut tier.
      const tb = { x: b.x + ox, z: b.z + oz, w: tw, d: td, front: side, cut: ts.length === 1 ? b.cut : undefined };
      const f = frontFrame(tb as Building3);
      const [s0, s1] = frontSpan(tb);
      const room = (s1 - s0) * 0.85;
      // (Room behind it for its frame: not on a sliver of a roof.)
      if (room < 4 || (side === 'north' || side === 'south' ? td : tw) < 4) continue;
      const mid = (s0 + s1) / 2;
      // The usual board, and where the roof has the room a larger one (kept only if it is the expressway's: score()).
      for (const w of room > BOARD + 1 ? [Math.min(BOARD_EXPRESSWAY, room), BOARD] : [room]) out.push({ kind: 'rooftop', b, c: [f.p[0] + f.r[0] * mid - f.n[0], 0, f.p[2] + f.r[2] * mid - f.n[2]], r: f.r, n: f.n, w, h: w / 2, y0: top + 1.2, top, front: side === b.front });
    }
  }
  // A wall: only one with no windows to cover, above the ground floor and below any step-back.
  if (s.type === WIN.blank && !s.home) {
    const mainTop = ts[0][3];
    for (const side of SIDES) {
      const tb = { x: b.x, z: b.z, w: b.w, d: b.d, front: side, cut: b.cut };
      const f = frontFrame(tb as Building3);
      const [s0, s1] = frontSpan(tb);
      // (The street face keeps its ends for a blade sign.)
      const w = Math.min(12, side === b.front ? s1 - s0 - 4.4 : (s1 - s0) * 0.8);
      const y0 = GF + FH * 0.6;
      if (w < 4 || y0 + w / 2 > mainTop - 1) continue;
      const mid = (s0 + s1) / 2;
      out.push({ kind: 'wall', b, c: [f.p[0] + f.r[0] * mid, 0, f.p[2] + f.r[2] * mid], r: f.r, n: f.n, w, h: w / 2, y0, top: 0, front: side === b.front });
    }
  }
  return out;
}

// ---- Which ad ----

/** The brands that fit anywhere (a zone with ads of its own kinds uses those instead). */
const EVERYDAY: readonly AdCategory[] = ['mainstream', 'food', 'loan', 'lodging'];
/** What's sold to the people going by on the expressway and the lines. */
const TRANSIT: readonly AdCategory[] = ['mainstream', 'food', 'loan'];
/** A tile's side (m): a brand comes once in a tile, and not in the tiles round it. */
export const TILE = { billboard: 64, poster: 32 } as const;

interface Brand {
  readonly cat: AdCategory;
  /** Its pictures (indices into DISTRICT_ADS). */
  readonly arts: number[];
  /** Which of the four tile classes shows it. */
  cls: number;
}

const strHash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

/**
 * A format's ads by brand (two pictures of one campaign are one brand: nobody should see them side by side), each
 * dealt to one of the four tile classes: the everyday brands first, so every class has some of them.
 */
function brandsOf(format: 'billboard' | 'poster'): Brand[] {
  const out: (Brand & { name: string })[] = [];
  DISTRICT_ADS.forEach((a, i) => {
    if (a.format !== format) return;
    const had = out.find((g) => g.cat === a.cat && (g.name.startsWith(a.brand) || a.brand.startsWith(g.name)));
    if (had) had.arts.push(i);
    else out.push({ name: a.brand, cat: a.cat, arts: [i], cls: 0 });
  });
  const order = [...out].sort((a, b) => Number(!EVERYDAY.includes(a.cat)) - Number(!EVERYDAY.includes(b.cat)) || strHash(a.name) - strHash(b.name));
  order.forEach((g, k) => (g.cls = k % 4));
  return out;
}

const BRANDS = { billboard: brandsOf('billboard'), poster: brandsOf('poster') };

/** The brand a site's ad belongs to (for the tests and the audit). */
export const adBrand = (ad: number): number => {
  const f = DISTRICT_ADS[ad].format;
  return BRANDS[f].findIndex((g) => g.arts.includes(ad));
};

/**
 * Gives each site its ad: of its tile's brands (a class of four, by the tile's place: neighbouring tiles share
 * none), one of a kind its zone takes, not yet used in the tile. A site left with none isn't built: fewer ads
 * where there are few to show, not the same one again.
 */
function assign(sites: readonly AdSite[], format: 'billboard' | 'poster'): AdSite[] {
  const brands = BRANDS[format];
  if (brands.length === 0) return [];
  const size = TILE[format];
  const used = new Set<string>();
  const out: AdSite[] = [];
  for (const s of [...sites].sort((a, b) => a.b.id - b.b.id)) {
    const tx = Math.floor(s.c[0] / size);
    const tz = Math.floor(s.c[2] / size);
    const cls = (tx & 1) | ((tz & 1) << 1);
    // The kinds of ad wanted here, weighted; the everyday ones where the zone's own kinds have no ads in this format.
    let weights: [AdCategory, number][] = s.view === 'expressway' || s.view === 'rail' ? TRANSIT.map((c) => [c, 1]) : (Object.entries(s.b.zone?.ads ?? {}) as [AdCategory, number][]);
    weights = weights.filter(([c]) => brands.some((g) => g.cat === c));
    if (weights.length === 0) weights = EVERYDAY.map((c) => [c, 1]);
    const pool = brands.map((g, k) => ({ g, k, w: weights.find(([c]) => c === g.cat)?.[1] ?? 0 })).filter((e) => e.w > 0 && e.g.cls === cls && !used.has(`${tx},${tz},${e.k}`));
    if (pool.length === 0) continue;
    let roll = u01(hash(s.b.id, 0xad5, format === 'poster' ? 2 : 1)) * pool.reduce((t, e) => t + e.w, 0);
    let pick = pool[pool.length - 1];
    for (const e of pool) {
      if ((roll -= e.w) < 0) {
        pick = e;
        break;
      }
    }
    used.add(`${tx},${tz},${pick.k}`);
    out.push({ ...s, ad: pick.g.arts[hash(s.b.id, 0xa27) % pick.g.arts.length] });
  }
  return out;
}
