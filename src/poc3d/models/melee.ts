import * as THREE from 'three';

/**
 * Fighting hand to hand and with the katana: the moves as keyframes and the state that runs them, for
 * models/firstPerson.ts to pose (`FirstPersonRig.melee`) and the page to score (`sweepHit` against a target's
 * capsules). Pure apart from three's vectors, so the tests drive it.
 *
 * A move's keys place what it moves in the view's frame (x right, y up, -z ahead; metres from the eyes): each
 * hand's wrist with the hand's forward (wrist to knuckles) and its palm's normal, or the sword's tsuba with its
 * blade's direction and its edge's; the kicking foot in the body's frame (x right, y up from the floor, z ahead);
 * the chest's turn and lean. A channel a key leaves out holds the weapon's guard. Between keys everything eases
 * (smoothstep), the sword's direction turning on the shortest arc, so a slash sweeps.
 */

type V3 = THREE.Vector3;
const v = (x: number, y: number, z: number): V3 => new THREE.Vector3(x, y, z);
const n = (x: number, y: number, z: number): V3 => new THREE.Vector3(x, y, z).normalize();

export type MeleeWeapon = 'fists' | 'katana';
/** What strikes: a fist, the right foot, the blade. */
export type Hitter = 'fist_l' | 'fist_r' | 'foot_r' | 'blade';
export type MoveId = 'jab' | 'cross' | 'hook' | 'hookR' | 'uppercut' | 'kick' | 'stomp' | 'slashR' | 'slashL' | 'overhead' | 'rising' | 'thrust' | 'draw' | 'sheathe';
/** Which way the mouse was moving as you struck (left: the swing goes right to left), or none. */
export type Dir = 'left' | 'right' | 'up' | 'down' | null;

export interface HandKey {
  /** The wrist. */
  readonly p: V3;
  /** Wrist to knuckles. */
  readonly f: V3;
  /** The palm's normal (out of the palm). */
  readonly n: V3;
  /** Where the elbow goes (a pole, view frame); default down and out. */
  readonly elbow?: V3;
}

export interface SwordKey {
  /** The tsuba. */
  readonly p: V3;
  /** Along the blade, toward the point. */
  readonly dir: V3;
  /** The edge's way (square to the blade once eased). */
  readonly edge: V3;
}

export interface Key {
  /** When, as a share of the move. */
  readonly t: number;
  readonly r?: HandKey;
  readonly l?: HandKey;
  /** The sword, or 'sheath': in its saya (the rig says where that is now). */
  readonly sword?: SwordKey | 'sheath';
  /** The kicking foot's ankle, body frame; `null` is standing on it. */
  readonly foot?: V3 | null;
  /** The chest turned (+ the right shoulder forward) and leaned (+ forward). */
  readonly twist?: number;
  readonly lean?: number;
}

export interface Move {
  readonly id: MoveId;
  /** Seconds. */
  readonly time: number;
  /** When it can hit, as shares of the move. */
  readonly active: readonly [number, number];
  readonly hitter: Hitter | null;
  readonly damage: number;
  /** How hard it shoves (m/s at the target). */
  readonly force: number;
  /** A blade's cut (bleeds, wounds) or a blow. */
  readonly cut: boolean;
  /** How far it carries you forward (m) over its active part. */
  readonly lunge: number;
  readonly keys: readonly Key[];
}

/** The guards: fists up by the chin (palms in, knuckles up), the sword ahead at the other's eyes (seigan). */
export const FIST_GUARD: { r: HandKey; l: HandKey } = {
  r: { p: v(0.15, -0.3, -0.33), f: n(-0.2, 0.75, -0.6), n: n(-1, 0, -0.15) },
  l: { p: v(-0.13, -0.27, -0.38), f: n(0.2, 0.75, -0.6), n: n(1, 0, -0.15) },
};
export const SWORD_GUARD: SwordKey = { p: v(0.05, -0.23, -0.4), dir: n(-0.07, 0.4, -1), edge: n(0, -1, -0.4) };
/** Guarding (the right button): fists high over the face; the sword across, edge up. */
export const FIST_BLOCK: { r: HandKey; l: HandKey } = {
  r: { p: v(0.09, -0.14, -0.25), f: n(-0.1, 1, -0.2), n: n(-1, 0, 0) },
  l: { p: v(-0.09, -0.13, -0.26), f: n(0.1, 1, -0.2), n: n(1, 0, 0) },
};
export const SWORD_BLOCK: SwordKey = { p: v(0.12, -0.12, -0.34), dir: n(-1, 0.32, -0.12), edge: n(0, 1, 0) };

const palmDown = n(0, -1, 0);

const BASE_MOVES: Record<Exclude<MoveId, 'hookR'>, Move> = {
  // Fists: a jab, a cross, a hook, an uppercut, in that order as a combo.
  jab: {
    id: 'jab',
    time: 0.34,
    active: [0.22, 0.55],
    hitter: 'fist_l',
    damage: 15,
    force: 0.8,
    cut: false,
    lunge: 0.06,
    keys: [
      { t: 0 },
      { t: 0.38, l: { p: v(-0.05, -0.08, -0.64), f: n(0.06, 0.05, -1), n: palmDown }, twist: -0.28, lean: 0.06 },
      { t: 0.55, l: { p: v(-0.05, -0.08, -0.64), f: n(0.06, 0.05, -1), n: palmDown }, twist: -0.28, lean: 0.06 },
      { t: 1, twist: 0 },
    ],
  },
  cross: {
    id: 'cross',
    time: 0.42,
    active: [0.25, 0.58],
    hitter: 'fist_r',
    damage: 24,
    force: 1.4,
    cut: false,
    lunge: 0.1,
    keys: [
      { t: 0 },
      { t: 0.4, r: { p: v(0.0, -0.08, -0.66), f: n(-0.08, 0.04, -1), n: palmDown }, twist: 0.42, lean: 0.1 },
      { t: 0.58, r: { p: v(0.0, -0.08, -0.66), f: n(-0.08, 0.04, -1), n: palmDown }, twist: 0.42, lean: 0.1 },
      { t: 1, twist: 0 },
    ],
  },
  hook: {
    id: 'hook',
    time: 0.46,
    active: [0.3, 0.62],
    hitter: 'fist_l',
    damage: 26,
    force: 1.6,
    cut: false,
    lunge: 0.05,
    keys: [
      { t: 0 },
      { t: 0.28, l: { p: v(-0.34, -0.1, -0.32), f: n(0.5, 0.1, -0.85), n: palmDown, elbow: n(-1, 0.6, 0.2) }, twist: 0.15 },
      { t: 0.5, l: { p: v(0.04, -0.1, -0.46), f: n(1, 0, -0.35), n: palmDown, elbow: n(-0.6, 0.7, 0.2) }, twist: -0.45, lean: 0.08 },
      { t: 0.64, l: { p: v(0.08, -0.12, -0.42), f: n(1, -0.05, -0.2), n: palmDown, elbow: n(-0.6, 0.7, 0.2) }, twist: -0.45, lean: 0.08 },
      { t: 1, twist: 0 },
    ],
  },
  uppercut: {
    id: 'uppercut',
    time: 0.5,
    active: [0.32, 0.62],
    hitter: 'fist_r',
    damage: 32,
    force: 1.8,
    cut: false,
    lunge: 0.06,
    keys: [
      { t: 0 },
      { t: 0.3, r: { p: v(0.15, -0.42, -0.3), f: n(0, 0.3, -1), n: n(0, 0.2, 1) }, twist: 0.1, lean: 0.12 },
      { t: 0.52, r: { p: v(0.03, -0.06, -0.44), f: n(-0.1, 1, -0.35), n: n(0, 0.3, 1) }, twist: 0.4, lean: -0.05 },
      { t: 0.64, r: { p: v(0.03, -0.04, -0.42), f: n(-0.1, 1, -0.3), n: n(0, 0.3, 1) }, twist: 0.4, lean: -0.05 },
      { t: 1, twist: 0 },
    ],
  },
  // A front kick with the right foot: knee up, foot out, back; the body leans back over the standing leg.
  kick: {
    id: 'kick',
    time: 0.72,
    active: [0.38, 0.62],
    hitter: 'foot_r',
    damage: 28,
    force: 4.2,
    cut: false,
    lunge: 0,
    keys: [
      { t: 0, foot: null },
      { t: 0.3, foot: v(0.1, 0.62, 0.32), lean: -0.12 },
      { t: 0.48, foot: v(0.1, 1.0, 0.86), lean: -0.32 },
      { t: 0.62, foot: v(0.1, 0.98, 0.84), lean: -0.32 },
      { t: 0.82, foot: v(0.1, 0.55, 0.3), lean: -0.1 },
      { t: 1, foot: null, lean: 0 },
    ],
  },
  // The katana: kesa-giri from over the right shoulder down to the left hip, its mirror, a straight cut down
  // the middle, and a thrust; drawing and sheathing.
  slashR: {
    id: 'slashR',
    time: 0.58,
    active: [0.36, 0.66],
    hitter: 'blade',
    damage: 90,
    force: 1.2,
    cut: true,
    lunge: 0.15,
    keys: [
      { t: 0 },
      { t: 0.32, sword: { p: v(0.17, 0.0, -0.18), dir: n(0.35, 0.85, 0.4), edge: n(-0.5, 0.1, -0.85) }, twist: 0.35, lean: -0.04 },
      { t: 0.5, sword: { p: v(0.02, -0.16, -0.42), dir: n(-0.55, 0.05, -0.85), edge: n(-0.5, -0.85, 0.2) }, twist: 0, lean: 0.12 },
      { t: 0.66, sword: { p: v(-0.16, -0.42, -0.3), dir: n(-0.8, -0.5, -0.3), edge: n(-0.2, -0.5, 0.85) }, twist: -0.35, lean: 0.18 },
      { t: 1 },
    ],
  },
  slashL: {
    id: 'slashL',
    time: 0.58,
    active: [0.36, 0.66],
    hitter: 'blade',
    damage: 90,
    force: 1.2,
    cut: true,
    lunge: 0.15,
    keys: [
      { t: 0 },
      { t: 0.32, sword: { p: v(-0.12, 0.0, -0.2), dir: n(-0.35, 0.85, 0.4), edge: n(0.5, 0.1, -0.85) }, twist: -0.3, lean: -0.04 },
      { t: 0.5, sword: { p: v(0.04, -0.16, -0.42), dir: n(0.55, 0.05, -0.85), edge: n(0.5, -0.85, 0.2) }, twist: 0, lean: 0.12 },
      { t: 0.66, sword: { p: v(0.2, -0.42, -0.28), dir: n(0.8, -0.5, -0.3), edge: n(0.2, -0.5, 0.85) }, twist: 0.4, lean: 0.18 },
      { t: 1 },
    ],
  },
  overhead: {
    id: 'overhead',
    time: 0.62,
    active: [0.4, 0.68],
    hitter: 'blade',
    damage: 110,
    force: 1.5,
    cut: true,
    lunge: 0.2,
    keys: [
      { t: 0 },
      { t: 0.34, sword: { p: v(0.03, 0.1, -0.14), dir: n(0, 0.85, 0.5), edge: n(0, 0.5, -0.85) }, lean: -0.08 },
      { t: 0.52, sword: { p: v(0.02, -0.14, -0.46), dir: n(0, -0.15, -1), edge: n(0, -1, 0.15) }, lean: 0.15 },
      { t: 0.68, sword: { p: v(0.02, -0.36, -0.4), dir: n(0, -0.65, -0.75), edge: n(0, -0.75, 0.65) }, lean: 0.22 },
      { t: 1 },
    ],
  },
  thrust: {
    id: 'thrust',
    time: 0.5,
    active: [0.35, 0.62],
    hitter: 'blade',
    damage: 100,
    force: 2.0,
    cut: true,
    lunge: 0.35,
    keys: [
      { t: 0 },
      { t: 0.3, sword: { p: v(0.08, -0.27, -0.24), dir: n(-0.06, 0.14, -1), edge: n(0, -1, 0.14) }, twist: 0.1 },
      { t: 0.48, sword: { p: v(0.07, -0.25, -0.72), dir: n(-0.06, 0.1, -1), edge: n(0, -1, 0.1) }, twist: 0.3, lean: 0.2 },
      { t: 0.62, sword: { p: v(0.07, -0.25, -0.72), dir: n(-0.06, 0.1, -1), edge: n(0, -1, 0.1) }, twist: 0.3, lean: 0.2 },
      { t: 1 },
    ],
  },
  rising: {
    id: 'rising',
    time: 0.58,
    active: [0.36, 0.66],
    hitter: 'blade',
    damage: 90,
    force: 1.3,
    cut: true,
    lunge: 0.12,
    keys: [
      { t: 0 },
      { t: 0.3, sword: { p: v(0.18, -0.46, -0.24), dir: n(0.45, -0.55, -0.7), edge: n(-0.3, -0.75, 0.55) }, twist: 0.35, lean: 0.1 },
      { t: 0.5, sword: { p: v(0.02, -0.24, -0.44), dir: n(-0.4, 0.3, -0.87), edge: n(-0.5, 0.8, 0.1) }, twist: 0, lean: 0 },
      { t: 0.66, sword: { p: v(-0.14, -0.02, -0.3), dir: n(-0.6, 0.75, -0.25), edge: n(-0.3, 0.1, 0.95) }, twist: -0.35, lean: -0.08 },
      { t: 1 },
    ],
  },
  // A stomp on a man on the ground: knee high, the heel down onto him.
  stomp: {
    id: 'stomp',
    time: 0.7,
    active: [0.4, 0.62],
    hitter: 'foot_r',
    damage: 40,
    force: 0.5,
    cut: false,
    lunge: 0.05,
    keys: [
      { t: 0, foot: null },
      { t: 0.32, foot: v(0.1, 0.75, 0.45), lean: 0.1 },
      { t: 0.5, foot: v(0.1, 0.12, 0.6), lean: 0.3 },
      { t: 0.65, foot: v(0.1, 0.12, 0.6), lean: 0.3 },
      { t: 1, foot: null, lean: 0 },
    ],
  },
  draw: {
    id: 'draw',
    time: 0.62,
    active: [1, 1],
    hitter: null,
    damage: 0,
    force: 0,
    cut: false,
    lunge: 0,
    keys: [
      { t: 0, sword: 'sheath' },
      { t: 0.15, sword: 'sheath' },
      { t: 0.6, sword: { p: v(0.18, -0.25, -0.32), dir: n(0.4, 0.15, -1), edge: n(0, -1, 0.2) }, twist: 0.3 },
      { t: 1, twist: 0 },
    ],
  },
  sheathe: {
    id: 'sheathe',
    time: 0.7,
    active: [1, 1],
    hitter: null,
    damage: 0,
    force: 0,
    cut: false,
    lunge: 0,
    keys: [
      { t: 0 },
      { t: 0.4, sword: { p: v(0.18, -0.25, -0.32), dir: n(0.4, 0.15, -1), edge: n(0, -1, 0.2) }, twist: 0.3 },
      { t: 0.85, sword: 'sheath', twist: 0.1 },
      { t: 1, sword: 'sheath', twist: 0 },
    ],
  },
};

/** A key mirrored left for right (the other hand, the other way round). */
function mirrorKey(k: Key): Key {
  const fx = (p: V3): V3 => new THREE.Vector3(-p.x, p.y, p.z);
  const hand = (h?: HandKey): HandKey | undefined => h && { p: fx(h.p), f: fx(h.f), n: fx(h.n), elbow: h.elbow && fx(h.elbow) };
  const sw = k.sword && k.sword !== 'sheath' ? { p: fx(k.sword.p), dir: fx(k.sword.dir), edge: fx(k.sword.edge) } : k.sword;
  return { t: k.t, r: hand(k.l), l: hand(k.r), sword: sw, foot: k.foot, twist: k.twist === undefined ? undefined : -k.twist, lean: k.lean };
}
export const MOVES: Record<MoveId, Move> = { ...BASE_MOVES, hookR: { ...BASE_MOVES.hook, id: 'hookR', hitter: 'fist_r', keys: BASE_MOVES.hook.keys.map(mirrorKey) } };

/** The combos: each click starts the next if it comes before the last ends (or just after). */
export const COMBO: Record<MeleeWeapon, readonly MoveId[]> = {
  fists: ['jab', 'cross', 'hook', 'uppercut'],
  katana: ['slashR', 'slashL', 'overhead'],
};
/** A swing the way the mouse moves (Bannerlord's directions): moving left swings right to left. */
export const DIRECTED: Record<MeleeWeapon, Record<Exclude<Dir, null>, MoveId>> = {
  fists: { left: 'hookR', right: 'hook', up: 'uppercut', down: 'cross' },
  katana: { left: 'slashR', right: 'slashL', up: 'rising', down: 'overhead' },
};
/** How long after a move ends a click still carries the combo on. */
const COMBO_WINDOW = 0.35;
/** Once a move is this far through, a click queues the next. */
const QUEUE_FROM = 0.45;

const ease = (x: number): number => x * x * (3 - 2 * x);

/** The whole pose at a moment: both hands or the sword, the foot, the chest. */
export interface MeleePose {
  readonly r: HandKey | null;
  readonly l: HandKey | null;
  readonly sword: SwordKey | null;
  /** The left hand on the saya's mouth (drawing and sheathing). */
  readonly leftOnSaya: boolean;
  /** The kicking foot's ankle (body frame) and how far it's taken over from standing (0..1). */
  readonly foot: { readonly p: V3; readonly w: number } | null;
  /** Or the foot placed in the world (a kill move's stomp on a man's head). */
  readonly footWorld?: { readonly p: V3; readonly w: number } | null;
  readonly twist: number;
  readonly lean: number;
}

export function lerpHand(a: HandKey, b: HandKey, u: number): HandKey {
  return {
    p: a.p.clone().lerp(b.p, u),
    f: a.f.clone().lerp(b.f, u).normalize(),
    n: a.n.clone().lerp(b.n, u).normalize(),
    elbow: a.elbow || b.elbow ? (a.elbow ?? DEFAULT_ELBOW[0]).clone().lerp(b.elbow ?? DEFAULT_ELBOW[0], u).normalize() : undefined,
  };
}
const DEFAULT_ELBOW = [n(0.8, -1, 0.25)];

/** The sword between two keys: the tsuba along a line, the blade turning on the shortest arc. */
export function lerpSword(a: SwordKey, b: SwordKey, u: number): SwordKey {
  const qa = swordQuat(a);
  const qb = swordQuat(b);
  const q = qa.clone().slerp(qb, u);
  return { p: a.p.clone().lerp(b.p, u), dir: v(0, 0, -1).applyQuaternion(q), edge: v(0, -1, 0).applyQuaternion(q) };
}

/** The sword's turn from its own frame (-z along the blade, -y the edge) to a key's. */
export function swordQuat(k: SwordKey): THREE.Quaternion {
  const z = k.dir.clone().normalize().negate();
  const y = k.edge.clone().negate();
  y.addScaledVector(z, -y.dot(z)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** One channel's value at share `t` of a move: from the keys that set it (the guard where none does). */
export function channel<T>(keys: readonly Key[], t: number, get: (k: Key) => T | undefined, rest: T, mix: (a: T, b: T, u: number) => T): T {
  let prev: { t: number; val: T } = { t: 0, val: rest };
  for (const k of keys) {
    const val = get(k) ?? (k.t === 0 || k.t === 1 ? rest : undefined);
    if (val === undefined) continue;
    if (k.t >= t) {
      const span = k.t - prev.t;
      const u = span <= 0 ? 1 : ease(Math.min(1, Math.max(0, (t - prev.t) / span)));
      return mix(prev.val, val, u);
    }
    prev = { t: k.t, val };
  }
  return prev.val;
}

export class Melee {
  weapon: MeleeWeapon = 'fists';
  /** Fists up / the sword out. */
  drawn = false;
  /** Guarding (held), and how far into the guard (eased). */
  guarding = false;
  guard = 0;
  move: Move | null = null;
  /** Seconds into the move. */
  t = 0;
  private queued: MoveId | null = null;
  private comboAt = 0;
  private sinceEnd = 99;
  /** Counts each move started, so a page can tell a new swing from the last. */
  swing = 0;
  /** How fast moves play (an enemy's are slower than yours, so you can read them). */
  rate = 1;
  /** The way the last move went, for a page's indicator. */
  lastDir: Dir = null;
  private queuedDir: Dir = null;

  /** Switches weapon (put away first). */
  setWeapon(w: MeleeWeapon): void {
    if (w === this.weapon) return;
    this.weapon = w;
    this.drawn = false;
    this.move = null;
    this.queued = null;
  }

  /** Puts up the fists or draws the sword; or puts them away. */
  toggleDrawn(): void {
    if (this.move && (this.move.id === 'draw' || this.move.id === 'sheathe')) return;
    if (this.weapon === 'katana') this.start(this.drawn ? 'sheathe' : 'draw');
    else this.drawn = !this.drawn;
  }

  /**
   * A click: with a direction, that swing; without, the next of the combo. Now if nothing's under way, queued
   * if a move is far enough along, else nothing.
   */
  attack(dir: Dir = null): void {
    if (!this.drawn) {
      this.toggleDrawn();
      return;
    }
    // From the guard, the sword thrusts.
    if (this.weapon === 'katana' && this.guarding && !this.move) {
      this.start('thrust');
      return;
    }
    const combo = COMBO[this.weapon];
    const directed = dir ? DIRECTED[this.weapon][dir] : null;
    if (this.move) {
      if (this.t / this.move.time >= QUEUE_FROM && (combo.includes(this.move.id) || Object.values(DIRECTED[this.weapon]).includes(this.move.id))) {
        this.queued = directed ?? combo[(this.comboAt + 1) % combo.length];
        this.queuedDir = dir;
      }
      return;
    }
    if (directed) {
      this.lastDir = dir;
      this.start(directed);
      return;
    }
    this.comboAt = this.sinceEnd < COMBO_WINDOW ? (this.comboAt + 1) % combo.length : 0;
    this.lastDir = null;
    this.start(combo[this.comboAt]);
  }

  /** Stops whatever move is under way (a blow that lands on you, a kill move taking over). */
  cancel(): void {
    this.move = null;
    this.queued = null;
    this.sinceEnd = 99;
  }

  kick(): void {
    if (this.move && this.move.id !== 'kick' && this.t / this.move.time < QUEUE_FROM) return;
    if (this.move?.id === 'kick') return;
    this.start('kick');
  }

  /** Plays a move now (scripts and checks). */
  play(id: MoveId): void {
    if (id !== 'kick' && id !== 'draw' && id !== 'sheathe') this.drawn = true;
    this.start(id);
  }

  private start(id: MoveId): void {
    this.move = MOVES[id];
    this.t = 0;
    this.queued = null;
    this.swing++;
    if (id === 'draw') this.drawn = true;
  }

  update(dt0: number): void {
    const dt = dt0 * this.rate;
    this.guard += ((this.guarding && this.drawn && !this.move ? 1 : 0) - this.guard) * Math.min(1, dt0 * 14);
    if (!this.move) {
      this.sinceEnd += dt;
      return;
    }
    this.t += dt;
    if (this.t >= this.move.time) {
      const done = this.move.id;
      this.move = null;
      // Only a move of the combo carries it on (not a draw or a kick).
      this.sinceEnd = COMBO[this.weapon].includes(done) ? 0 : 99;
      if (done === 'sheathe') this.drawn = false;
      if (this.queued) {
        const combo = COMBO[this.weapon];
        const i = combo.indexOf(this.queued);
        if (i >= 0) this.comboAt = i;
        this.lastDir = this.queuedDir;
        this.start(this.queued);
      }
    }
  }

  /** The share of the move done. */
  get phase(): number {
    return this.move ? Math.min(1, this.t / this.move.time) : 0;
  }

  /** What's striking now (inside the move's active part), if anything. */
  get striking(): Hitter | null {
    if (!this.move || !this.move.hitter) return null;
    const p = this.phase;
    return p >= this.move.active[0] && p <= this.move.active[1] ? this.move.hitter : null;
  }

  /** How fast the move carries you forward now (m/s). */
  get lungeSpeed(): number {
    if (!this.move || !this.move.lunge) return 0;
    const [a, b] = this.move.active;
    const p = this.phase;
    const from = Math.max(0, a - 0.2);
    if (p < from || p > b) return 0;
    return (this.move.lunge / ((b - from) * this.move.time)) * this.rate;
  }

  /** The pose now. `sheath` is where the sword sits in its saya, in the view's frame. */
  pose(sheath: SwordKey): MeleePose {
    const katana = this.weapon === 'katana';
    const g = this.guard;
    const fistRest = { r: lerpHand(FIST_GUARD.r, FIST_BLOCK.r, g), l: lerpHand(FIST_GUARD.l, FIST_BLOCK.l, g) };
    const swordRest = this.drawn ? lerpSword(SWORD_GUARD, SWORD_BLOCK, g) : sheath;
    const m = this.move;
    if (!m) {
      if (katana) return { r: null, l: null, sword: this.drawn ? swordRest : null, leftOnSaya: false, foot: null, twist: 0, lean: 0 };
      return { r: this.drawn ? fistRest.r : null, l: this.drawn ? fistRest.l : null, sword: null, leftOnSaya: false, foot: null, twist: 0, lean: 0 };
    }
    const t = this.phase;
    const resolve = (s: SwordKey | 'sheath' | undefined): SwordKey | undefined => (s === 'sheath' ? sheath : s);
    // Drawing starts from the saya, sheathing ends in it; any other move starts and ends at the guard.
    const swordBase = m.id === 'draw' ? sheath : SWORD_GUARD;
    const sword = katana ? channel<SwordKey>(m.keys, t, (k) => resolve(k.sword), swordBase, lerpSword) : null;
    // A kick with the fists down leaves them in the guard; with the sword out, the sword stays at its guard.
    const r = katana ? null : channel<HandKey>(m.keys, t, (k) => k.r, fistRest.r, lerpHand);
    const l = katana ? null : channel<HandKey>(m.keys, t, (k) => k.l, fistRest.l, lerpHand);
    type Foot = { p: V3 | null; w: number };
    const footC = channel<Foot>(
      m.keys,
      t,
      (k) => (k.foot === undefined ? undefined : { p: k.foot, w: k.foot ? 1 : 0 }),
      { p: null, w: 0 },
      (a, b, u) => ({ p: a.p && b.p ? a.p.clone().lerp(b.p, u) : (a.p ?? b.p), w: a.w + (b.w - a.w) * u }),
    );
    const footV = footC.p && footC.w > 0.001 ? { p: footC.p, w: footC.w } : null;
    const num = (get: (k: Key) => number | undefined): number => channel<number>(m.keys, t, get, 0, (a, b, u) => a + (b - a) * u);
    const kickOnly = m.id === 'kick' || m.id === 'stomp';
    return {
      r: kickOnly && !this.drawn && !katana ? FIST_GUARD.r : r,
      l: kickOnly && !this.drawn && !katana ? FIST_GUARD.l : l,
      sword: katana ? (kickOnly ? (this.drawn ? swordRest : null) : sword) : null,
      leftOnSaya: m.id === 'draw' ? t < 0.5 : m.id === 'sheathe' ? t > 0.55 : false,
      foot: footV,
      twist: num((k) => k.twist),
      lean: num((k) => k.lean),
    };
  }
}

/** A part of a body to be hit: a capsule from a to b. */
export interface Capsule {
  readonly name: string;
  readonly a: V3;
  readonly b: V3;
  readonly r: number;
}

export interface HitInfo {
  readonly point: V3;
  /** The way the striking part was moving (unit). */
  readonly dir: V3;
  readonly part: string;
  readonly damage: number;
  readonly force: number;
  readonly cut: boolean;
  readonly move: MoveId;
  readonly hitter: Hitter;
}

/** Something that can be struck. */
export interface MeleeTarget {
  readonly alive: boolean;
  parts(): readonly Capsule[];
  hit(h: HitInfo): void;
}

/** The closest points between segments p1-q1 and p2-q2; returns the distance and fills the points. */
export function segmentDistance(p1: V3, q1: V3, p2: V3, q2: V3, c1 = new THREE.Vector3(), c2 = new THREE.Vector3()): number {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s = 0;
  let t = 0;
  if (a <= 1e-9 && e <= 1e-9) {
    c1.copy(p1);
    c2.copy(p2);
    return c1.distanceTo(c2);
  }
  if (a <= 1e-9) t = THREE.MathUtils.clamp(f / e, 0, 1);
  else {
    const c = d1.dot(r);
    if (e <= 1e-9) s = THREE.MathUtils.clamp(-c / a, 0, 1);
    else {
      const b = d1.dot(d2);
      const den = a * e - b * b;
      s = den > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }
  c1.copy(p1).addScaledVector(d1, s);
  c2.copy(p2).addScaledVector(d2, t);
  return c1.distanceTo(c2);
}

/** A striking part's sweep this frame (its segment last frame to now, `r` its thickness) against a body's
 * capsules: the first part it passes through (head before the rest), with where. */
export function sweepHit(from: [V3, V3], to: [V3, V3], r: number, parts: readonly Capsule[], steps = 5): { part: Capsule; point: V3 } | null {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c1 = new THREE.Vector3();
  const c2 = new THREE.Vector3();
  let best: { part: Capsule; point: V3; d: number } | null = null;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    a.copy(from[0]).lerp(to[0], u);
    b.copy(from[1]).lerp(to[1], u);
    for (const p of parts) {
      const d = segmentDistance(a, b, p.a, p.b, c1, c2) - p.r - r;
      if (d < 0 && (!best || d < best.d)) best = { part: p, point: c1.clone().lerp(c2, 0.5), d };
    }
    if (best) return { part: best.part, point: best.point };
  }
  return null;
}

/** How much a part takes: the head more, the limbs less. */
export function partFactor(part: string): number {
  if (part === 'head') return 1.6;
  if (part === 'neck') return 1.8;
  if (/arm|hand|thigh|calf|leg/.test(part)) return 0.6;
  return 1;
}

export type GoreLevel = 'full' | 'low' | 'off';
export const GORE_LEVELS: readonly GoreLevel[] = ['full', 'low', 'off'];

/** The gore setting: `?gore=`, else the browser's saved choice, else full. */
export function goreSetting(search = typeof location !== 'undefined' ? location.search : ''): GoreLevel {
  const q = new URLSearchParams(search).get('gore');
  if (q && (GORE_LEVELS as readonly string[]).includes(q)) return q as GoreLevel;
  try {
    const s = localStorage.getItem('citypop.gore');
    if (s && (GORE_LEVELS as readonly string[]).includes(s)) return s as GoreLevel;
  } catch {
    /* no storage */
  }
  return 'full';
}

export function saveGore(level: GoreLevel): void {
  try {
    localStorage.setItem('citypop.gore', level);
  } catch {
    /* no storage */
  }
}
