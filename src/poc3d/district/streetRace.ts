import YAML from 'yaml';
import type { CarType } from '../models/vehicles';
import type { ChaseCarDef } from './chase';

/**
 * Street races (content/<city>/streetraces.yaml): a field of cars, you and five or more rivals, racing through the
 * city's streets from a start through checkpoints to a finish, each on the road it likes best (every driver routes
 * between the gates over the street network, so a shortcut is a choice). Pure: the definition, the gates, who has
 * passed which, the places, the finish. The cars are district/streetRaceField.ts, the screens
 * district/streetRaceHud.ts.
 *
 *   races:
 *     - id: bay_sprint
 *       name: BAYWALK SPRINT
 *       blurb: ...
 *       host: marshal.npc                # the npc who offers it (E on them opens the challenge)
 *       points: [[8, 17], [14, 13], ...]  # L0 grid points [col, row] (the cell corners, the junctions): the start, the
 *                                         # gates in order, the finish last. Fractions put a gate part-way along a road.
 *       laps: 1                           # the gates after the start run this many times
 *       pay: [300000, 150000, 80000, 40000, 20000, 10000]    # by place
 *       field:                            # the rivals, grid order from the front
 *         - { name: Rico Santos, type: awd, paint: '#1a4ac8', pace: 1.0, power: 1.1, grip: 1.05, gunman: true, aim: 0.9, health: 80 }
 */

export interface StreetRaceDef {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  /** The npc node who offers it (`<placement>.<node>`). */
  readonly host: string;
  /** Grid points [col, row]: the start first, the finish last. */
  readonly points: readonly (readonly [number, number])[];
  readonly laps: number;
  readonly field: readonly ChaseCarDef[];
  /** Yen by place. */
  readonly pay: readonly number[];
}

const TYPES: readonly CarType[] = ['sedan', 'luxury', 'sports', 'taxi', 'taxi2', 'kei', 'minivan', 'keitruck', 'hatch', 'rotary', 'awd', 'roadster', 'van', 'keivan', 'boxtruck', 'police', 'hardtop'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const HEX = /^#[0-9a-f]{6}$/i;

export function parseStreetRaces(file: string, text: string, errors: string[]): StreetRaceDef[] {
  const err = (m: string): void => void errors.push(`${file}: ${m}`);
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return [];
  }
  if (!isObj(doc) || !Array.isArray(doc.races)) return err('expected races: [...]'), [];
  const out: StreetRaceDef[] = [];
  doc.races.forEach((r: unknown, i: number) => {
    const at = `races[${i}]`;
    if (!isObj(r)) return err(`${at} must be a mapping`);
    const id = String(r.id);
    if (!/^[a-z0-9_]+$/.test(id)) return err(`${at}: id must match [a-z0-9_]+`);
    const pts = r.points;
    if (!Array.isArray(pts) || pts.length < 3 || !pts.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number'))) return err(`${at} (${id}): points: at least a start, a gate and a finish, each [col, row]`);
    const laps = r.laps === undefined ? 1 : Number(r.laps);
    if (!Number.isInteger(laps) || laps < 1 || laps > 9) return err(`${at} (${id}): laps must be 1 to 9`);
    if (!Array.isArray(r.field) || r.field.length < 5) return err(`${at} (${id}): field: at least five rivals, a race is six cars or more`);
    const field: ChaseCarDef[] = [];
    for (const [k, f] of (r.field as unknown[]).entries()) {
      if (!isObj(f) || typeof f.name !== 'string' || !TYPES.includes(f.type as CarType) || !HEX.test(String(f.paint))) {
        err(`${at} (${id}): field[${k}]: { name, type: ${TYPES.join('|')}, paint: '#rrggbb', pace, power, grip, gunman, aim, health }`);
        continue;
      }
      const num = (key: string, dflt: number): number => (f[key] === undefined ? dflt : Number(f[key]));
      field.push({ name: f.name, type: f.type as CarType, paint: parseInt(String(f.paint).slice(1), 16), power: num('power', 1), grip: num('grip', 1), pace: num('pace', 0.95), gunman: f.gunman === true, aim: num('aim', 1), health: num('health', 70) });
    }
    if (field.length !== (r.field as unknown[]).length) return;
    const pay = Array.isArray(r.pay) && r.pay.every((n) => typeof n === 'number' && n >= 0) ? (r.pay as number[]) : null;
    if (!pay) return err(`${at} (${id}): pay: a list of yen by place`);
    out.push({ id, name: String(r.name), blurb: String(r.blurb ?? ''), host: String(r.host ?? ''), points: pts as [number, number][], laps, field, pay });
  });
  const ids = out.map((r) => r.id);
  if (new Set(ids).size !== ids.length) err('race ids must be unique');
  return out;
}

/** A gate: how close (m) a car must pass it to count. The streets are wide and the gates sit at junctions. */
export const GATE = 26;

export type Phase = 'countdown' | 'running' | 'over';

export interface Gate {
  readonly x: number;
  readonly z: number;
}

export interface Standing {
  /** The racer's index (0 is you). */
  readonly who: number;
  readonly place: number;
  /** Gates passed, of `goals.length`. */
  readonly gates: number;
  readonly finished: number | null;
  readonly out: string | null;
}

/**
 * The race's book-keeping: each racer's next gate, who has finished and when, who is out. Gates count only in order
 * and from close by, so skipping one is no shortcut.
 */
export class StreetRaceState {
  phase: Phase = 'countdown';
  countdown = 3;
  t = 0;
  /** Gates passed by each racer, how far each is from its next one (m), when each finished, why each is out. */
  readonly passed: number[];
  readonly toNext: number[];
  readonly finishedAt: (number | null)[];
  readonly outBecause: (string | null)[];
  private order = 0;
  /** The straight-line distance along the gates to each (from the start), for a rough measure of progress. */
  private readonly cum: number[] = [];
  /** The place each finisher took. */
  readonly finishPlace: (number | null)[];

  /** `goals`: the gates in order, the finish last. `names[0]` is you. */
  constructor(
    readonly goals: readonly Gate[],
    readonly names: readonly string[],
    start?: Gate,
  ) {
    const n = names.length;
    let at = start ?? goals[0];
    let sum = 0;
    for (const g of goals) {
      sum += Math.hypot(g.x - at.x, g.z - at.z);
      this.cum.push(sum);
      at = g;
    }
    this.passed = new Array<number>(n).fill(0);
    this.toNext = new Array<number>(n).fill(Infinity);
    this.finishedAt = new Array<number | null>(n).fill(null);
    this.outBecause = new Array<string | null>(n).fill(null);
    this.finishPlace = new Array<number | null>(n).fill(null);
  }

  get running(): boolean {
    return this.phase === 'running';
  }

  /** The racer's next gate, or null once it has finished. */
  next(i: number): Gate | null {
    return this.passed[i] < this.goals.length ? this.goals[this.passed[i]] : null;
  }

  /** The next `n` gates from racer i's next, fewer near the end (the drivers plan a few ahead). */
  ahead(i: number, n: number): Gate[] {
    return this.goals.slice(this.passed[i], this.passed[i] + n);
  }

  /** The gate after the next, or null. */
  after(i: number): Gate | null {
    return this.passed[i] + 1 < this.goals.length ? this.goals[this.passed[i] + 1] : null;
  }

  /** How far along the course racer i is (m, straight-line along the gates; the finish is `total`). */
  progress(i: number): number {
    const p = this.passed[i];
    if (p >= this.goals.length) return this.total;
    return this.cum[p] - (Number.isFinite(this.toNext[i]) ? this.toNext[i] : this.cum[p] - (p > 0 ? this.cum[p - 1] : 0));
  }

  get total(): number {
    return this.cum[this.cum.length - 1] ?? 0;
  }

  /** A racer is done for (wrecked, shot up, shot): it takes no more places. */
  retire(i: number, why: string): void {
    if (this.outBecause[i] === null && this.finishedAt[i] === null) this.outBecause[i] = why;
  }

  /**
   * One step. `at[i]` is where racer i is. Returns the gates passed this step, as { who, gate (1-based), place when
   * it was the finish }.
   */
  update(dt: number, at: readonly { x: number; z: number }[]): { who: number; gate: number; place: number | null }[] {
    const events: { who: number; gate: number; place: number | null }[] = [];
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.phase = 'running';
      return events;
    }
    if (this.phase !== 'running') return events;
    this.t += dt;
    at.forEach((p, i) => {
      if (this.outBecause[i] !== null || this.finishedAt[i] !== null) return;
      const g = this.next(i);
      if (!g) return;
      const d = Math.hypot(g.x - p.x, g.z - p.z);
      this.toNext[i] = d;
      if (d > GATE) return;
      this.passed[i]++;
      const done = this.passed[i] >= this.goals.length;
      if (done) {
        this.finishedAt[i] = this.t;
        this.finishPlace[i] = ++this.order;
        this.toNext[i] = 0;
      } else {
        const n = this.goals[this.passed[i]];
        this.toNext[i] = Math.hypot(n.x - p.x, n.z - p.z);
      }
      events.push({ who: i, gate: this.passed[i], place: done ? this.finishPlace[i] : null });
    });
    // It ends when you've finished or are out (the rest are placed as they stand), or when everyone is.
    if (this.finishedAt[0] !== null || this.outBecause[0] !== null || this.names.every((_, i) => this.finishedAt[i] !== null || this.outBecause[i] !== null)) this.phase = 'over';
    return events;
  }

  /** Everyone in order: the finishers by their places, then by gates passed and nearness to the next, the retired last. */
  standings(): Standing[] {
    const idx = this.names.map((_, i) => i);
    idx.sort((a, b) => {
      const ao = this.outBecause[a] !== null;
      const bo = this.outBecause[b] !== null;
      if (ao !== bo) return ao ? 1 : -1;
      const af = this.finishPlace[a];
      const bf = this.finishPlace[b];
      if (af !== null || bf !== null) return af === null ? 1 : bf === null ? -1 : af - bf;
      if (this.passed[a] !== this.passed[b]) return this.passed[b] - this.passed[a];
      return this.toNext[a] - this.toNext[b];
    });
    return idx.map((who, k) => ({ who, place: k + 1, gates: this.passed[who], finished: this.finishedAt[who], out: this.outBecause[who] }));
  }

  placeOf(who: number): number {
    return this.standings().find((s) => s.who === who)!.place;
  }
}

/** The pay for a place (yen): the def's list, nothing past its end. */
export const payFor = (def: StreetRaceDef, place: number): number => def.pay[place - 1] ?? 0;
