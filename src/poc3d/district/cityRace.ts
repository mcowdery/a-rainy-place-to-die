import YAML from 'yaml';
import type { Parts } from '../../race/catalog';
import type { CarType } from '../models/vehicles';
import type { Expressway, Road } from './expressway';

/**
 * Races in the city (content/world3d/races.yaml): battles on the Tōto Expressway against a rival, through the
 * traffic, set up by a racer at a PA (a `host` npc). A race runs along one expressway road from a start (metres
 * along it) for a length, or laps of a loop; checkpoints along the way give splits; first to the line wins. Pure:
 * the path, progress along it, the state of a race. The rival's driving is district/raceRival.ts; the page wires
 * both (main.ts) with its HUD (district/raceHud.ts).
 *
 *   races:
 *     - id: c1_lap
 *       name: 都心環状 C1 ONE LAP
 *       blurb: ...
 *       host: ebisu_pa.racer      # the npc who offers it (E on them opens the challenge)
 *       road: c1                  # an expressway road id
 *       start: 300                # metres along it
 *       length: lap               # metres, or `lap` (a loop's whole length)
 *       laps: 1
 *       rival: { name: ..., type: rotary, paint: '#e8e8e4', skill: 1.0, parts: { engine: 2, tyres: 2 } }
 *       pay: { win: 40000, lose: 4000 }
 */

export interface RaceDef {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly host: string;
  readonly road: string;
  readonly start: number;
  /** Metres from the start to the finish (laps included). */
  readonly length: number | 'lap';
  readonly laps: number;
  readonly rival: { readonly name: string; readonly type: CarType; readonly paint: number; readonly skill: number; readonly parts: Parts };
  readonly pay: { readonly win: number; readonly lose: number };
}

const TYPES: readonly CarType[] = ['hatch', 'roadster', 'sports', 'rotary', 'awd'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseRaces(file: string, text: string, errors: string[]): RaceDef[] {
  const err = (m: string): void => void errors.push(`${file}: ${m}`);
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return [];
  }
  if (!isObj(doc) || !Array.isArray(doc.races)) return err('expected races: [...]'), [];
  const out: RaceDef[] = [];
  doc.races.forEach((r: unknown, i: number) => {
    const at = `races[${i}]`;
    if (!isObj(r)) return err(`${at} must be a mapping`);
    const id = String(r.id);
    if (!/^[a-z0-9_]+$/.test(id)) return err(`${at}: id must match [a-z0-9_]+`);
    const rv = r.rival;
    if (!isObj(rv) || !TYPES.includes(rv.type as CarType)) return err(`${at} (${id}): rival: { name, type: ${TYPES.join('|')}, paint, skill }`);
    const pay = r.pay;
    if (!isObj(pay) || typeof pay.win !== 'number' || typeof pay.lose !== 'number') return err(`${at} (${id}): pay: { win, lose }`);
    if (typeof r.road !== 'string' || typeof r.start !== 'number' || typeof r.host !== 'string') return err(`${at} (${id}): needs road, start, host`);
    const length = r.length === 'lap' ? 'lap' : typeof r.length === 'number' && r.length > 100 ? r.length : null;
    if (length === null) return err(`${at} (${id}): length is metres (over 100) or lap`);
    out.push({
      id,
      name: String(r.name ?? id),
      blurb: String(r.blurb ?? ''),
      host: r.host,
      road: r.road,
      start: r.start,
      length,
      laps: typeof r.laps === 'number' && r.laps >= 1 ? Math.floor(r.laps) : 1,
      rival: {
        name: String(rv.name ?? 'the rival'),
        type: rv.type as CarType,
        paint: /^#[0-9a-f]{6}$/i.test(String(rv.paint)) ? parseInt(String(rv.paint).slice(1), 16) : 0xc01818,
        skill: typeof rv.skill === 'number' ? rv.skill : 1,
        parts: isObj(rv.parts) ? (rv.parts as Parts) : {},
      },
      pay: { win: pay.win, lose: pay.lose },
    });
  });
  return out;
}

/** A race's line: the road's samples from the start to the finish (every metre, round a loop as often as it laps). */
export class RacePath {
  readonly road: Road;
  readonly length: number;
  /** The road sample the race starts at. */
  private readonly start: number;
  private readonly n: number;

  constructor(
    readonly def: RaceDef,
    ex: Expressway,
  ) {
    const road = ex.roads.find((r) => r.id === def.road);
    if (!road) throw new Error(`race ${def.id}: no expressway road '${def.road}'`);
    this.road = road;
    // (`start` is metres along the route as written; a trimmed route's samples begin further on.)
    this.start = def.start - (road.trim?.[0] ?? 0);
    this.n = road.x.length;
    const one = def.length === 'lap' ? this.n : def.length;
    this.length = def.length === 'lap' ? one * def.laps : Math.min(one, road.closed ? Infinity : this.n - 1 - this.start);
  }

  /** The road sample at s metres from the start. */
  index(s: number): number {
    const i = Math.floor(this.start + Math.max(0, Math.min(this.length, s)));
    return this.road.closed ? ((i % this.n) + this.n) % this.n : Math.min(this.n - 1, i);
  }

  /** Where s is: the point on the centreline, its heading (unit), height; left of it is (tz, -tx). */
  at(s: number, lateral = 0): { x: number; z: number; y: number; tx: number; tz: number } {
    const r = this.road;
    const i = this.index(s);
    return { x: r.x[i] + r.tz[i] * lateral, z: r.z[i] - r.tx[i] * lateral, y: r.y[i], tx: r.tx[i], tz: r.tz[i] };
  }

  /**
   * How far along the race a point is, searching near where it last was (`near`, metres) so a lap's start and
   * finish (the same place on a loop) aren't confused; and how far off the line it is.
   */
  progress(x: number, z: number, near: number): { s: number; off: number } {
    let best = { s: near, off: Infinity };
    const r = this.road;
    for (let d = -40; d <= 120; d++) {
      const s = near + d;
      if (s < 0 || s > this.length) continue;
      const i = this.index(s);
      const off = Math.hypot(x - r.x[i], z - r.z[i]);
      if (off < best.off) best = { s, off };
    }
    return best;
  }

  /** The turn ahead from s: the heading change over the next `ahead` metres (radians). */
  turnAhead(s: number, ahead: number): number {
    let turn = 0;
    const r = this.road;
    for (let k = 5; k <= ahead; k += 5) {
      const a = this.index(s + k - 5);
      const b = this.index(s + k);
      turn = Math.max(turn, Math.acos(Math.min(1, r.tx[a] * r.tx[b] + r.tz[a] * r.tz[b])));
    }
    return turn;
  }

  /**
   * The fastest a car at s can go and still make every bend in the next `ahead` metres: at each point, the speed its
   * curvature allows (lateral grip aLat), plus what braking at `brake` m/s^2 takes off over the distance to it.
   */
  safeSpeed(s: number, ahead: number, aLat: number, brake: number): number {
    const r = this.road;
    let v = Infinity;
    for (let k = 0; k <= ahead; k += 4) {
      const a = this.index(s + k);
      const b = this.index(s + k + 4);
      const kappa = Math.acos(Math.min(1, r.tx[a] * r.tx[b] + r.tz[a] * r.tz[b])) / 4;
      if (kappa < 0.002) continue;
      const vc = Math.sqrt(aLat / kappa);
      v = Math.min(v, Math.sqrt(vc * vc + 2 * brake * Math.max(0, k - 4)));
    }
    return v;
  }

  /** Checkpoints: every quarter of the way (the last is the line). */
  get checkpoints(): number[] {
    return [0.25, 0.5, 0.75, 1].map((f) => this.length * f);
  }
}

export type RacePhase = 'countdown' | 'racing' | 'finished';

/** A race's state: the countdown, both cars' progress and splits, who's ahead, the result. */
export class RaceState {
  phase: RacePhase = 'countdown';
  /** Seconds left of the countdown (3-2-1), then seconds since the start. */
  countdown = 3.5;
  t = 0;
  you = 0;
  rival = 0;
  youSplits: number[] = [];
  rivalSplits: number[] = [];
  result: { won: boolean; why: string; you: number | null; rival: number | null } | null = null;
  private readonly cps: number[];

  constructor(readonly path: RacePath) {
    this.cps = path.checkpoints;
  }

  get leading(): boolean {
    return this.you >= this.rival;
  }

  /** Advance: dt real seconds, and both cars' progress along the path (metres). Returns a split just made, if any. */
  update(dt: number, you: number, rival: number): { cp: number; t: number; gap: number | null } | null {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.phase = 'racing';
      return null;
    }
    if (this.phase !== 'racing') return null;
    this.t += dt;
    this.you = Math.max(this.you, you);
    this.rival = Math.max(this.rival, rival);
    let split: { cp: number; t: number; gap: number | null } | null = null;
    while (this.rivalSplits.length < this.cps.length && this.rival >= this.cps[this.rivalSplits.length]) this.rivalSplits.push(this.t);
    while (this.youSplits.length < this.cps.length && this.you >= this.cps[this.youSplits.length]) {
      const k = this.youSplits.length;
      this.youSplits.push(this.t);
      split = { cp: k, t: this.t, gap: this.rivalSplits[k] !== undefined ? this.t - this.rivalSplits[k] : null };
    }
    const youDone = this.youSplits.length === this.cps.length;
    const rivalDone = this.rivalSplits.length === this.cps.length;
    if (youDone || rivalDone) {
      const won = youDone && (!rivalDone || this.youSplits[this.cps.length - 1] <= this.rivalSplits[this.cps.length - 1]);
      this.finish(won, won ? 'First to the line.' : 'The rival got there first.');
    }
    return split;
  }

  /** Ends the race now (a totalled car, falling far behind, leaving the route). */
  finish(won: boolean, why: string): void {
    if (this.phase === 'finished') return;
    this.phase = 'finished';
    const last = this.cps.length - 1;
    this.result = { won, why, you: this.youSplits[last] ?? null, rival: this.rivalSplits[last] ?? null };
  }
}
