import * as THREE from 'three';

/**
 * Fighting hand to hand, with the katana and with the bat: the moves as keyframes and the state that runs them,
 * for models/firstPerson.ts to pose (`FirstPersonRig.melee`) and the page to score (`sweepHit` against a target's
 * capsules). Pure apart from three's vectors, so the tests drive it.
 *
 * A move's keys place what it moves in the view's frame (x right, y up, -z ahead; metres from the eyes): each
 * hand's wrist with the hand's forward (wrist to knuckles) and its palm's normal, or the weapon's top of the
 * handle (the sword's tsuba) with the way it points and the way it's swung (the sword's edge); the kicking foot in
 * the body's frame (x right, y up from the floor, z ahead); the chest's turn and lean. A channel a key leaves out
 * holds the weapon's rest (the fists' guard, the stance). Between keys everything eases (smoothstep), the
 * weapon's direction turning on the shortest arc, so a swing sweeps.
 *
 * A weapon's swings are whole-arm arcs, made from one shape (`Arc`: the hands from over the head, out to arm's
 * length, down to the hips) turned about the way ahead (`swing`): straight down, down across from either
 * shoulder, level, rising from either hip, straight up. Which of them a click gives depends on the stance
 * (`Stance`: high, mid, low: where the weapon is held ready) and the way the mouse is moving (`DIRECTED`): the
 * stance is the height the swing comes from, the mouse the side. A swing from where the stance already has the
 * weapon wound up skips most of its wind-up (`start`), so each stance is quick at its own.
 *
 * A swing is the whole body's (`LegsKey`): the hips turn back as it loads and lead it through (the chest's turn is
 * on top of theirs), his weight goes back and then into it, he sinks as it lands, the foot away from the side it
 * comes from steps in and the other is left behind (the rig pivots it on its ball as the hips come round). And it
 * loads further than the stance holds the weapon (`Arc.load`): the blade or the barrel right back behind his head.
 * Either weapon can be swung in the right hand alone (`oneHand`): the same swings, wider, quicker and weaker.
 *
 * Which blow a click gives (`strike`, since the mouse's way was shelved 2026-10-06): the stance is the kind of
 * swing (down, across, rising), where you aim is where it lands (`Zone`: his head, his body, his legs), sides
 * taking turns; what he's doing has an attack of its own (`Doing`: running, in the air, stepping back, out of a
 * dodge); and a click held as it winds up makes it a heavier blow (`heavy`). The nine swings a weapon has for that
 * are made, not keyed: `zoneMoves`.
 *
 * Or (`style` 'clips', under trial against the keyed swings) a swing is one of the animation library's
 * (models/characterAnims.ts: Quaternius' sword clips, one-handed, and its punches): the move names the clips (`Move.clip`), the
 * pose says which and when (`MeleePose.clip`), and the rig plays it over the whole body, the weapon in his hand.
 */

type V3 = THREE.Vector3;
const v = (x: number, y: number, z: number): V3 => new THREE.Vector3(x, y, z);
const n = (x: number, y: number, z: number): V3 => new THREE.Vector3(x, y, z).normalize();
const rad = (deg: number): number => (deg * Math.PI) / 180;

export type MeleeWeapon = 'fists' | 'katana' | 'bat';
/** The weapons held in both hands and placed by a `SwordKey`. */
export type Armed = Exclude<MeleeWeapon, 'fists'>;
/** How a weapon is held ready: low (trailing by the right hip: the swings rise), mid (ahead, the guard), high
 * (wound up overhead or over the shoulder: the swings come down). */
export type Stance = 'low' | 'mid' | 'high';
export const STANCES: readonly Stance[] = ['low', 'mid', 'high'];
/** What strikes: a fist, the right foot, the blade, the bat's barrel. */
export type Hitter = 'fist_l' | 'fist_r' | 'foot_r' | 'blade' | 'bat';
export type MoveId =
  | 'jab' | 'cross' | 'hook' | 'hookR' | 'uppercut' | 'kick' | 'stomp'
  | 'overhead' | 'slashR' | 'slashL' | 'sideR' | 'sideL' | 'rising' | 'risingL' | 'upcut' | 'legCut' | 'thrust' | 'highThrust' | 'draw' | 'sheathe'
  | 'batDown' | 'batChopR' | 'batChopL' | 'batR' | 'batL' | 'batRiseR' | 'batRiseL' | 'batUp' | 'batLegs' | 'batJab' | 'batReady' | 'batLower'
  | 'swAttack' | 'swRise' | 'swChop' | 'swSpin' | 'swAxe' | 'btAttack' | 'btRise' | 'btChop' | 'btSpin' | 'btAxe' | 'fsJab' | 'fsCross' | 'fsHook' | 'libKick' | 'dodgeL' | 'dodgeR'
  | ZoneMoveId;
/** Where a blow is aimed (the page reads it from where you're looking): at his head, his body or his legs. */
export type Zone = 'head' | 'body' | 'legs';
export const ZONES: readonly Zone[] = ['head', 'body', 'legs'];
/** What he's doing as he strikes, where that has an attack of its own. */
export type Doing = 'run' | 'air' | 'back' | 'dodge' | null;
/** A weapon's swing for a stance and a zone, from the right or the left (`zoneMoves`): kz the katana's, bz the bat's. */
export type ZoneMoveId = `${'kz' | 'bz'}_${Stance}_${Zone}_${'r' | 'l'}`;
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
  /** The top of the handle: the sword's tsuba, the bat where the hands end. */
  readonly p: V3;
  /** Along the blade (or the barrel), toward its end. */
  readonly dir: V3;
  /** The way it's swung: the sword's edge (square to the blade once eased). */
  readonly edge: V3;
}

export interface Key {
  /** When, as a share of the move. */
  readonly t: number;
  readonly r?: HandKey;
  readonly l?: HandKey;
  /** The sword or the bat, or 'sheath': put away (the sword in its saya, the bat at his side; the rig says where
   * that is now). */
  readonly sword?: SwordKey | 'sheath';
  /** The kicking foot's ankle, body frame; `null` is standing on it. */
  readonly foot?: V3 | null;
  /** The chest turned (+ the right shoulder forward) and leaned (+ forward). */
  readonly twist?: number;
  readonly lean?: number;
  /** The hips and the feet. */
  readonly legs?: LegsKey;
}

/** The lower body in a move (the body's frame: x right, y up, z ahead; metres). */
export interface LegsKey {
  /** The hips turned (+ the right hip forward), radians; the chest's `twist` is on top of it. */
  readonly hips: number;
  /** The hips let down (the knees bend), and moved over his feet: his weight. */
  readonly sink: number;
  readonly shift: readonly [number, number];
  /** Each foot moved from where it stands: a step. */
  readonly l: V3;
  readonly r: V3;
}
const legsOf = (hips = 0, sink = 0, shift: readonly [number, number] = [0, 0], l: V3 = v(0, 0, 0), r: V3 = v(0, 0, 0)): LegsKey => ({ hips, sink, shift, l, r });
export const NO_LEGS: LegsKey = legsOf();
export function lerpLegs(a: LegsKey, b: LegsKey, u: number): LegsKey {
  const m = (x: number, y: number): number => x + (y - x) * u;
  return { hips: m(a.hips, b.hips), sink: m(a.sink, b.sink), shift: [m(a.shift[0], b.shift[0]), m(a.shift[1], b.shift[1])], l: a.l.clone().lerp(b.l, u), r: a.r.clone().lerp(b.r, u) };
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
  /** Played from the animation library instead of the keys: its clips, one after the other, each for so long (s). */
  readonly clip?: readonly { readonly name: string; readonly time: number }[];
  /** Aimed at the legs: it floors a man more often than not. */
  readonly low?: boolean;
  /** A dodge: how far it carries you to your right (m; negative, left), and between which shares of the move;
   * blows aimed at you miss while it does. */
  readonly slide?: { readonly side: number; readonly from: number; readonly to: number };
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
/** The bat held ready (ahead of the right side, the barrel up and a little forward), and across to guard. */
export const BAT_GUARD: SwordKey = { p: v(0.14, -0.3, -0.36), dir: n(-0.08, 0.8, -0.6), edge: n(0, -0.6, -0.8) };
export const BAT_BLOCK: SwordKey = { p: v(0.2, -0.16, -0.36), dir: n(-1, 0.25, -0.1), edge: n(0, 1, 0.1) };

const palmDown = n(0, -1, 0);

// ---- Swings as arcs ----

/** A point of a swing straight down, in its plane (the view's frame: y up, -z ahead): when, where the hands are,
 * and how the weapon lies (`a`: degrees from straight up, turning forward: 90 ahead, 180 down, negative back
 * over the shoulder). */
interface ArcPoint {
  readonly t: number;
  readonly y: number;
  readonly z: number;
  readonly a: number;
}
/** How much further than `wind` (where a stance holds the weapon) a swing loads: the weapon turned this many more
 * degrees back (and `acrossA` more again for a swing across), and for a swing across the hands this much further
 * back and up (m): by the shoulder, the weapon behind his head. */
interface Load {
  readonly a: number;
  readonly acrossA: number;
  readonly back: number;
  readonly lift: number;
}
/** A swing's shape: wound up over the head, coming through at arm's length, landing, and at its end by the hips;
 * `wrap` a follow-through that carries on round the body (swings across only). */
interface Arc {
  readonly wind: ArcPoint;
  readonly through: ArcPoint;
  readonly land: ArcPoint;
  readonly end: ArcPoint;
  readonly wrap?: ArcPoint;
  readonly load: Load;
}
/** The katana: from jōdan (the hands above the forehead, the blade up and back) out and down to the hips; loaded,
 * the blade lies back level behind his head. */
const KATANA_ARC: Arc = {
  wind: { t: 0.32, y: 0.14, z: -0.08, a: -40 },
  through: { t: 0.46, y: -0.03, z: -0.5, a: 68 },
  land: { t: 0.54, y: -0.22, z: -0.52, a: 97 },
  end: { t: 0.68, y: -0.56, z: -0.36, a: 135 },
  load: { a: -35, acrossA: -10, back: 0.1, lift: 0.1 },
};
/** The bat: loaded right back (the barrel down behind his head and across his back, a batter's), and it carries
 * on round. */
const BAT_ARC: Arc = {
  wind: { t: 0.38, y: 0.12, z: -0.06, a: -50 },
  through: { t: 0.52, y: -0.04, z: -0.46, a: 62 },
  land: { t: 0.59, y: -0.2, z: -0.5, a: 95 },
  end: { t: 0.72, y: -0.48, z: -0.36, a: 140 },
  wrap: { t: 0.82, y: -0.46, z: -0.2, a: 205 },
  load: { a: -60, acrossA: -25, back: 0.18, lift: 0.18 },
};
/** The chest's height below the eyes (the arcs turn about it); how far the hands go sideways of what they go up
 * and down (two hands on one handle only reach so far across); how far ahead they keep clear of the body; how
 * much further a swing across carries on past the middle than one straight down (which stops at the hips); the
 * lowest the hands go. */
const CHEST = -0.38;
const ACROSS = 0.65;
const CLEAR = 0.12;
const CARRY = 1.2;
const LOWEST = -0.8;

/**
 * An arc's point for a swing turned `roll` degrees about the way ahead (0 straight down, 45 down from the right
 * shoulder, 90 level from the right, 135 rising from the right hip, 180 straight up; negative from the left),
 * `drop` metres lower (a cut at the legs) and the weapon dipped by `dip` toward the floor; `load` (and how much
 * of it) for a wind-up taken further back than the point has it.
 */
function arcKey(pt: ArcPoint, roll: number, drop = 0, dip = 0, load: Load | null = null, loaded = 1): SwordKey {
  const s = Math.sin(rad(roll));
  const c = Math.cos(rad(roll));
  const across = Math.abs(s);
  const a = rad(pt.a + (load ? (load.a + load.acrossA * across) * loaded : 0));
  const out = (pt.y - CHEST) * (pt.y < CHEST ? 1 + CARRY * across : 1);
  const dir = v(Math.cos(a) * s, Math.cos(a) * c - dip, -Math.sin(a)).normalize();
  const near = pt.z > -0.3 ? pt.z - CLEAR * (1 - Math.max(0, c)) : pt.z;
  return {
    p: v(out * s * ACROSS, Math.max(LOWEST, CHEST + out * c - drop + (load ? load.lift * across * loaded : 0)), near + (load ? load.back * across * loaded : 0)),
    dir,
    edge: v(-Math.sin(a) * s, -Math.sin(a) * c, -Math.cos(a)),
  };
}

interface SwingSpec {
  readonly time: number;
  readonly damage: number;
  readonly force: number;
  readonly lunge: number;
  readonly drop?: number;
  readonly dip?: number;
}

/**
 * A swing of `arc` turned `roll` degrees, the whole body's: the weapon through the arc's points (loaded right
 * back first, and by way of a point between, so it comes round the long way); the hips turned back to the side it
 * comes from as it loads and leading it through, the chest's turn on top of theirs and behind it; his weight back
 * and then into it; sinking as a swing down lands (crouched to load one that rises, and up with it); the foot
 * away from the side it comes from stepping in (the right, for one straight down or up), the other left behind.
 */
function swing(id: MoveId, arc: Arc, hitter: 'blade' | 'bat', roll: number, o: SwingSpec): Move {
  const s = Math.sin(rad(roll));
  const c = Math.cos(rad(roll));
  const low = (o.drop ?? 0) * 0.75;
  const down = Math.max(0, c);
  const up = Math.max(0, -c);
  const lead: 'l' | 'r' = Math.abs(s) > 0.3 && s > 0 ? 'l' : 'r';
  /** Hips (of the swing's side), sink, weight sideways (toward the side it comes from) and ahead, the leading
   * foot's step ahead and lift, how far the other is left behind. */
  const legs = (hips: number, sink: number, side: number, ahead: number, step: number, lift: number, trail: number): LegsKey => {
    // (The step goes out a little to its own side too: a wider base under a swing across.)
    const stepV = v((lead === 'l' ? -1 : 1) * 0.25 * step * Math.abs(s), lift, step);
    const trailV = v(0, 0, -trail);
    return legsOf(hips * s, sink + (o.drop ?? 0) * 0.35, [side * s, ahead], lead === 'l' ? stepV : trailV, lead === 'r' ? stepV : trailV);
  };
  const loadedA = arc.wind.a + arc.load.a + arc.load.acrossA * Math.abs(s);
  const between: ArcPoint = { t: (arc.wind.t + arc.through.t) / 2, y: (arc.wind.y + arc.through.y) / 2, z: (arc.wind.z + arc.through.z) / 2, a: loadedA + 0.45 * (arc.through.a - loadedA) };
  const at = (pt: ArcPoint): SwordKey => arcKey(pt, roll, o.drop, o.dip);
  const keys: Key[] = [
    { t: 0 },
    { t: arc.wind.t, sword: arcKey(arc.wind, roll, o.drop, 0, arc.load), twist: -0.45 * s, lean: -0.14 * c + low, legs: legs(-0.7, 0.08 + 0.12 * up, 0.1, -0.06, 0, 0, 0) },
    { t: between.t, sword: arcKey(between, roll, o.drop, (o.dip ?? 0) * 0.5, { a: 0, acrossA: 0, back: arc.load.back, lift: arc.load.lift }, 0.4), twist: -0.42 * s, lean: -0.05 * c + low, legs: legs(-0.25, 0.1 + 0.08 * up, 0.04, 0, 0.18, 0.07, 0.04) },
    { t: arc.through.t, sword: at(arc.through), twist: -0.1 * s, lean: 0.05 + low, legs: legs(0.35, 0.14, -0.03, 0.05, 0.32, 0, 0.09) },
    { t: arc.land.t, sword: at(arc.land), twist: 0.2 * s, lean: 0.12 + 0.16 * c + low, legs: legs(0.65, 0.16 + 0.08 * down, -0.08, 0.1, 0.32, 0, 0.12) },
    { t: arc.end.t, sword: at(arc.end), twist: 0.4 * s, lean: 0.14 + 0.26 * c + low, legs: legs(0.8, 0.06 + 0.16 * down, -0.08, 0.1, 0.32, 0, 0.12) },
  ];
  if (arc.wrap && Math.abs(s) > 0.5) keys.push({ t: arc.wrap.t, sword: at(arc.wrap), twist: 0.5 * s, lean: 0.1 + low, legs: legs(0.85, 0.08, -0.08, 0.08, 0.32, 0, 0.12) });
  keys.push({ t: 1 });
  return { id, time: o.time, active: [arc.through.t - 0.05, arc.end.t], hitter, damage: o.damage, force: o.force, cut: hitter === 'blade', lunge: o.lunge, keys };
}

const FIST_MOVES = {
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
} satisfies Record<string, Move>;

/** Neither a cut nor a blow: getting a weapon out or putting it away. */
const handling = (id: MoveId, time: number, keys: readonly Key[]): Move => ({ id, time, active: [1, 1], hitter: null, damage: 0, force: 0, cut: false, lunge: 0, keys });

const KATANA_MOVES = {
  // The cuts, each a whole-arm arc (see `swing`): straight down (shōmen), down across from either shoulder
  // (kesa-giri), level across the body (dō), rising from either hip (gyaku-kesa), straight up, and across the legs.
  overhead: swing('overhead', KATANA_ARC, 'blade', 0, { time: 0.62, damage: 110, force: 1.5, lunge: 0.2 }),
  slashR: swing('slashR', KATANA_ARC, 'blade', 45, { time: 0.58, damage: 90, force: 1.2, lunge: 0.15 }),
  slashL: swing('slashL', KATANA_ARC, 'blade', -45, { time: 0.58, damage: 90, force: 1.2, lunge: 0.15 }),
  sideR: swing('sideR', KATANA_ARC, 'blade', 90, { time: 0.56, damage: 80, force: 1.4, lunge: 0.15 }),
  sideL: swing('sideL', KATANA_ARC, 'blade', -90, { time: 0.56, damage: 80, force: 1.4, lunge: 0.15 }),
  rising: swing('rising', KATANA_ARC, 'blade', 135, { time: 0.58, damage: 90, force: 1.3, lunge: 0.12 }),
  risingL: swing('risingL', KATANA_ARC, 'blade', -135, { time: 0.58, damage: 90, force: 1.3, lunge: 0.12 }),
  upcut: swing('upcut', KATANA_ARC, 'blade', 180, { time: 0.56, damage: 85, force: 1.6, lunge: 0.12 }),
  legCut: swing('legCut', KATANA_ARC, 'blade', 90, { time: 0.6, damage: 60, force: 1.0, lunge: 0.15, drop: 0.34, dip: 0.75 }),
  // The thrusts: from the guard (drawn back to the hip, then out), and from high beside the head, down at the face.
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
      { t: 0.3, sword: { p: v(0.1, -0.3, -0.16), dir: n(-0.06, 0.14, -1), edge: n(0, -1, 0.14) }, twist: -0.2 },
      { t: 0.48, sword: { p: v(0.06, -0.24, -0.56), dir: n(-0.05, 0.08, -1), edge: n(0, -1, 0.08) }, twist: 0.35, lean: 0.24 },
      { t: 0.62, sword: { p: v(0.06, -0.24, -0.56), dir: n(-0.05, 0.08, -1), edge: n(0, -1, 0.08) }, twist: 0.35, lean: 0.24 },
      { t: 1 },
    ],
  },
  highThrust: {
    id: 'highThrust',
    time: 0.52,
    active: [0.36, 0.64],
    hitter: 'blade',
    damage: 100,
    force: 1.8,
    cut: true,
    lunge: 0.3,
    keys: [
      { t: 0 },
      { t: 0.3, sword: { p: v(0.17, 0.02, -0.1), dir: n(-0.12, -0.1, -1), edge: n(0.8, -0.6, 0) }, twist: -0.35 },
      { t: 0.5, sword: { p: v(0.1, -0.2, -0.54), dir: n(-0.1, -0.05, -1), edge: n(0.8, -0.6, 0) }, twist: 0.35, lean: 0.22 },
      { t: 0.64, sword: { p: v(0.1, -0.2, -0.54), dir: n(-0.1, -0.05, -1), edge: n(0.8, -0.6, 0) }, twist: 0.35, lean: 0.22 },
      { t: 1 },
    ],
  },
  draw: handling('draw', 0.62, [
    { t: 0, sword: 'sheath' },
    { t: 0.15, sword: 'sheath' },
    { t: 0.6, sword: { p: v(0.18, -0.25, -0.32), dir: n(0.4, 0.15, -1), edge: n(0, -1, 0.2) }, twist: 0.3 },
    { t: 1, twist: 0 },
  ]),
  sheathe: handling('sheathe', 0.7, [
    { t: 0 },
    { t: 0.4, sword: { p: v(0.18, -0.25, -0.32), dir: n(0.4, 0.15, -1), edge: n(0, -1, 0.2) }, twist: 0.3 },
    { t: 0.85, sword: 'sheath', twist: 0.1 },
    { t: 1, sword: 'sheath', twist: 0 },
  ]),
} satisfies Record<string, Move>;

const BAT_MOVES = {
  // The bat's swings, the same arcs, heavier and slower: an overhead smash, a chop down across from either
  // shoulder, the level swing (a batter's) and its backhand, rising from either hip, straight up under the chin,
  // and level at the knees.
  batDown: swing('batDown', BAT_ARC, 'bat', 0, { time: 0.78, damage: 40, force: 2.2, lunge: 0.18 }),
  batChopR: swing('batChopR', BAT_ARC, 'bat', 45, { time: 0.7, damage: 36, force: 2.6, lunge: 0.15 }),
  batChopL: swing('batChopL', BAT_ARC, 'bat', -45, { time: 0.7, damage: 36, force: 2.6, lunge: 0.15 }),
  batR: swing('batR', BAT_ARC, 'bat', 90, { time: 0.8, damage: 34, force: 3.2, lunge: 0.15 }),
  batL: swing('batL', BAT_ARC, 'bat', -90, { time: 0.8, damage: 34, force: 3.2, lunge: 0.15 }),
  batRiseR: swing('batRiseR', BAT_ARC, 'bat', 135, { time: 0.7, damage: 34, force: 3.0, lunge: 0.12 }),
  batRiseL: swing('batRiseL', BAT_ARC, 'bat', -135, { time: 0.7, damage: 34, force: 3.0, lunge: 0.12 }),
  batUp: swing('batUp', BAT_ARC, 'bat', 180, { time: 0.68, damage: 34, force: 3.0, lunge: 0.12 }),
  batLegs: swing('batLegs', BAT_ARC, 'bat', 90, { time: 0.72, damage: 30, force: 2.0, lunge: 0.15, drop: 0.34, dip: 0.75 }),
  // A jab with the end of it, from the guard: a shove more than a blow.
  batJab: {
    id: 'batJab',
    time: 0.5,
    active: [0.34, 0.62],
    hitter: 'bat',
    damage: 16,
    force: 3.0,
    cut: false,
    lunge: 0.3,
    keys: [
      { t: 0 },
      { t: 0.3, sword: { p: v(0.12, -0.3, -0.18), dir: n(-0.05, 0.12, -1), edge: n(0, -1, 0.12) }, twist: -0.15 },
      { t: 0.5, sword: { p: v(0.06, -0.24, -0.5), dir: n(-0.04, 0.06, -1), edge: n(0, -1, 0.06) }, twist: 0.3, lean: 0.2 },
      { t: 0.62, sword: { p: v(0.06, -0.24, -0.5), dir: n(-0.04, 0.06, -1), edge: n(0, -1, 0.06) }, twist: 0.3, lean: 0.2 },
      { t: 1 },
    ],
  },
  // Up from his side into both hands, and back down to hang in the right.
  batReady: handling('batReady', 0.45, [{ t: 0, sword: 'sheath' }, { t: 1 }]),
  batLower: handling('batLower', 0.45, [{ t: 0 }, { t: 1, sword: 'sheath' }]),
} satisfies Record<string, Move>;

/** How far a dodge carries you (m). */
const DODGE = 1.7;
/** A move that's the library's: its clips end to end, and when (in seconds) the weapon is sweeping. */
function clipMove(id: MoveId, hitter: Hitter | null, parts: readonly (readonly [string, number])[], from: number, to: number, damage: number, force: number, lunge: number): Move {
  const time = parts.reduce((a, [, s]) => a + s, 0);
  return { id, time, active: [from / time, to / time], hitter, damage, force, cut: hitter === 'blade', lunge, keys: [{ t: 0 }, { t: 1 }], clip: parts.map(([name, s]) => ({ name, time: s })) };
}
/** The library's swings (all in the right hand): a lunging cut down across from the right; a crouched cut rising to
 * the right, and a chop down to the left, each with its recovery; a spinning cut; and an overhead chop (the tree
 * feller's). The same five for the bat, as blows. */
const A: readonly (readonly [string, number])[] = [['Sword_Regular_A', 0.433], ['Sword_Regular_A_Rec', 0.967]];
const B: readonly (readonly [string, number])[] = [['Sword_Regular_B', 0.533], ['Sword_Regular_B_Rec', 1.033]];
const CLIP_MOVES = {
  swAttack: clipMove('swAttack', 'blade', [['Sword_Attack', 1.533]], 0.3, 0.75, 80, 1.3, 0.3),
  swRise: clipMove('swRise', 'blade', A, 0.08, 0.4, 70, 1.2, 0.15),
  swChop: clipMove('swChop', 'blade', B, 0.06, 0.42, 75, 1.2, 0.15),
  swSpin: clipMove('swSpin', 'blade', [['Sword_Regular_C', 2.0]], 0.45, 1.2, 110, 1.8, 0.3),
  swAxe: clipMove('swAxe', 'blade', [['TreeChopping_Loop', 0.967]], 0.06, 0.4, 85, 1.4, 0.1),
  btAttack: clipMove('btAttack', 'bat', [['Sword_Attack', 1.533]], 0.3, 0.75, 30, 2.8, 0.3),
  btRise: clipMove('btRise', 'bat', A, 0.08, 0.4, 26, 2.6, 0.15),
  btChop: clipMove('btChop', 'bat', B, 0.06, 0.42, 28, 2.4, 0.15),
  btSpin: clipMove('btSpin', 'bat', [['Sword_Regular_C', 2.0]], 0.45, 1.2, 40, 3.4, 0.3),
  btAxe: clipMove('btAxe', 'bat', [['TreeChopping_Loop', 0.967]], 0.06, 0.4, 32, 2.4, 0.1),
  // The fists': a jab with the left, a cross with the right, and a lunging overhand hook with the right.
  fsJab: clipMove('fsJab', 'fist_l', [['Punch_Jab', 0.867]], 0.16, 0.45, 15, 0.8, 0.06),
  fsCross: clipMove('fsCross', 'fist_r', [['Punch_Cross', 1.0]], 0.2, 0.5, 24, 1.4, 0.1),
  fsHook: clipMove('fsHook', 'fist_r', [['Melee_Hook', 0.467], ['Melee_Hook_Rec', 0.6]], 0.16, 0.42, 30, 2.2, 0.3),
  // A high kick with the right leg (pack 1's, whatever is in hand).
  libKick: clipMove('libKick', 'foot_r', [['Kick', 1.1]], 0.26, 0.56, 30, 4.2, 0),
  // A dodge: a hop to one side, out of the way of what's coming.
  dodgeL: { ...clipMove('dodgeL', null, [['Dodge_Left', 1.3]], 1.3, 1.3, 0, 0, 0), slide: { side: -DODGE, from: 0.08, to: 0.6 } },
  dodgeR: { ...clipMove('dodgeR', null, [['Dodge_Right', 1.3]], 1.3, 1.3, 0, 0, 0), slide: { side: DODGE, from: 0.08, to: 0.6 } },
} satisfies Record<string, Move>;
/** Which of them a click gives: by the mouse's way, or in turn (the library's own combo: rising, down, the spin). */
const CLIP_SWINGS: Record<MeleeWeapon, { combo: readonly MoveId[]; directed: Record<Exclude<Dir, null>, MoveId> }> = {
  fists: { combo: ['fsJab', 'fsCross', 'fsHook'], directed: { left: 'fsHook', right: 'fsJab', up: 'fsCross', down: 'fsCross' } },
  katana: { combo: ['swRise', 'swChop', 'swSpin'], directed: { left: 'swAttack', right: 'swRise', down: 'swAxe', up: 'swChop' } },
  bat: { combo: ['btRise', 'btChop', 'btSpin'], directed: { left: 'btAttack', right: 'btRise', down: 'btAxe', up: 'btChop' } },
};
/** The library's by zone, and its lunges for a run. */
const CLIP_ZONES: Record<MeleeWeapon, Record<Zone, readonly MoveId[]>> = {
  fists: { head: ['fsJab', 'fsCross'], body: ['fsHook'], legs: ['libKick'] },
  katana: { head: ['swAxe'], body: ['swChop', 'swAttack'], legs: ['swRise'] },
  bat: { head: ['btAxe'], body: ['btChop', 'btAttack'], legs: ['btRise'] },
};
const CLIP_RUN: Record<MeleeWeapon, MoveId> = { fists: 'fsHook', katana: 'swAttack', bat: 'btAttack' };
/** How long a clip takes to come in over the pose before it and to go out again (s), and how long after its
 * sweep a clip can be cut short by the next click. */
const CLIP_IN = 0.1;
const CLIP_OUT = 0.2;
const CLIP_CUT = 0.12;

/** A key mirrored left for right (the other hand, the other way round). */
function mirrorKey(k: Key): Key {
  const fx = (p: V3): V3 => new THREE.Vector3(-p.x, p.y, p.z);
  const hand = (h?: HandKey): HandKey | undefined => h && { p: fx(h.p), f: fx(h.f), n: fx(h.n), elbow: h.elbow && fx(h.elbow) };
  const sw = k.sword && k.sword !== 'sheath' ? { p: fx(k.sword.p), dir: fx(k.sword.dir), edge: fx(k.sword.edge) } : k.sword;
  return { t: k.t, r: hand(k.l), l: hand(k.r), sword: sw, foot: k.foot, twist: k.twist === undefined ? undefined : -k.twist, lean: k.lean };
}
/** How far from straight down a stance's swings turn (degrees): the high stance's come down, a little across; the
 * mid's go level; the low's rise. */
const STANCE_ROLL: Record<Stance, number> = { high: 30, mid: 90, low: 140 };
/** A zone lowers the swing and dips the weapon to it, and a blow there has this much of the swing's damage (the
 * head's and the legs' own worth is the target's: `partFactor`, and a man with his legs cut from under him). */
const ZONE_ARC: Record<Zone, { drop: number; dip: number; power: number }> = {
  head: { drop: 0, dip: 0, power: 1 },
  body: { drop: 0.2, dip: 0.12, power: 0.9 },
  legs: { drop: 0.34, dip: 0.7, power: 0.65 },
};
/** A weapon's nine swings from each side: each stance's kind of swing, at each zone. */
function zoneMoves(prefix: 'kz' | 'bz', arc: Arc, hitter: 'blade' | 'bat', base: SwingSpec): Record<ZoneMoveId, Move> {
  const out = {} as Record<ZoneMoveId, Move>;
  for (const stance of STANCES)
    for (const zone of ZONES)
      for (const side of ['r', 'l'] as const) {
        const id: ZoneMoveId = `${prefix}_${stance}_${zone}_${side}`;
        const z = ZONE_ARC[zone];
        out[id] = { ...swing(id, arc, hitter, STANCE_ROLL[stance] * (side === 'r' ? 1 : -1), { ...base, damage: Math.round(base.damage * z.power), drop: z.drop || undefined, dip: z.dip || undefined }), low: zone === 'legs' };
      }
  return out;
}

export const MOVES: Record<MoveId, Move> = {
  ...FIST_MOVES,
  hookR: { ...FIST_MOVES.hook, id: 'hookR', hitter: 'fist_r', keys: FIST_MOVES.hook.keys.map(mirrorKey) },
  ...KATANA_MOVES,
  ...BAT_MOVES,
  ...CLIP_MOVES,
  ...zoneMoves('kz', KATANA_ARC, 'blade', { time: 0.58, damage: 90, force: 1.3, lunge: 0.15 }),
  ...zoneMoves('bz', BAT_ARC, 'bat', { time: 0.76, damage: 36, force: 2.8, lunge: 0.15 }),
};

/** The fists' blows by zone (in turn), and each weapon's attack for what he's doing: running (a lunge), in the
 * air (down from over his head), stepping back (keeping them off) and out of a dodge (across, at once). */
const FIST_ZONES: Record<Zone, readonly MoveId[]> = { head: ['jab', 'cross', 'hook', 'uppercut'], body: ['hook', 'hookR'], legs: ['kick'] };
/** Bare hands, a button a hand (the user's, from Skyrim, 2026-10-06): each hand's blow at each zone, and for what
 * he's doing. The left jabs and hooks; the right crosses and comes up under the ribs; either way a kick at the legs. */
const FIST_HANDS: Record<'l' | 'r', Record<Zone, MoveId>> = {
  l: { head: 'jab', body: 'hook', legs: 'kick' },
  r: { head: 'cross', body: 'uppercut', legs: 'kick' },
};
const FIST_DOING: Record<'l' | 'r', Record<Exclude<Doing, null>, MoveId>> = {
  l: { run: 'jab', air: 'hook', back: 'jab', dodge: 'hook' },
  r: { run: 'cross', air: 'hookR', back: 'cross', dodge: 'hookR' },
};
const CLIP_HANDS: Record<'l' | 'r', Record<Zone, MoveId>> = {
  l: { head: 'fsJab', body: 'fsJab', legs: 'libKick' },
  r: { head: 'fsCross', body: 'fsHook', legs: 'libKick' },
};
const DOING: Record<MeleeWeapon, Record<Exclude<Doing, null>, MoveId>> = {
  fists: { run: 'cross', air: 'hookR', back: 'jab', dodge: 'hook' },
  katana: { run: 'thrust', air: 'overhead', back: 'thrust', dodge: 'sideR' },
  bat: { run: 'batJab', air: 'batDown', back: 'batJab', dodge: 'batR' },
};

/** Where each weapon is held in each stance: the sword at jōdan (overhead), seigan (the guard) and waki (trailing
 * by the right hip); the bat over the right shoulder, ready ahead, and low by the right hip. Each is where its
 * own swings wind up to. */
export const STANCE_REST: Record<Armed, Record<Stance, SwordKey>> = {
  katana: { high: arcKey(KATANA_ARC.wind, 0), mid: SWORD_GUARD, low: arcKey(KATANA_ARC.wind, 135) },
  bat: { high: { p: v(0.26, -0.2, -0.1), dir: n(0.3, 0.78, 0.55), edge: n(0.75, 0, -0.66) }, mid: BAT_GUARD, low: arcKey(BAT_ARC.wind, 135) },
};
/** How he stands in each: his knees a little bent; side on (the hips and the chest turned back to the right) where
 * the weapon is held to that side. */
const STANCE_BODY: Record<Armed, Record<Stance, { twist: number; legs: LegsKey }>> = {
  katana: { high: { twist: 0, legs: legsOf(0, 0.03) }, mid: { twist: 0, legs: legsOf(0, 0.03) }, low: { twist: -0.25, legs: legsOf(-0.25, 0.06) } },
  bat: { high: { twist: -0.35, legs: legsOf(-0.35, 0.05) }, mid: { twist: 0, legs: legsOf(0, 0.03) }, low: { twist: -0.25, legs: legsOf(-0.2, 0.06) } },
};
const BLOCK: Record<Armed, SwordKey> = { katana: SWORD_BLOCK, bat: BAT_BLOCK };
/** In the right hand alone: how much quicker a swing is, how much of its damage and shove it has, and how the
 * weapon's place changes (out toward that shoulder, wider and further: one arm reaches where two can't). */
const ONE_HAND = { speed: 1.2, power: 0.7, out: 0.13, wide: 1.1, far: 1.08 } as const;

const every = <T>(x: T): Record<Stance, T> => ({ low: x, mid: x, high: x });
/** The combos, by stance: each click starts the next if it comes before the last ends (or just after). */
export const COMBO: Record<MeleeWeapon, Record<Stance, readonly MoveId[]>> = {
  fists: every(['jab', 'cross', 'hook', 'uppercut']),
  katana: { high: ['overhead', 'slashR', 'slashL'], mid: ['slashR', 'slashL', 'overhead'], low: ['rising', 'risingL', 'upcut'] },
  bat: { high: ['batChopR', 'batChopL', 'batDown'], mid: ['batR', 'batL', 'batDown'], low: ['batRiseR', 'batRiseL', 'batUp'] },
};
/** A swing the way the mouse moves (Bannerlord's directions: moving left swings right to left), from the stance:
 * the stance is the height it comes from, the mouse the side. */
export const DIRECTED: Record<MeleeWeapon, Record<Stance, Record<Exclude<Dir, null>, MoveId>>> = {
  fists: every({ left: 'hookR', right: 'hook', up: 'uppercut', down: 'cross' }),
  katana: {
    high: { left: 'slashR', right: 'slashL', down: 'overhead', up: 'highThrust' },
    mid: { left: 'sideR', right: 'sideL', down: 'overhead', up: 'thrust' },
    low: { left: 'rising', right: 'risingL', up: 'upcut', down: 'legCut' },
  },
  bat: {
    high: { left: 'batChopR', right: 'batChopL', down: 'batDown', up: 'batDown' },
    mid: { left: 'batR', right: 'batL', down: 'batDown', up: 'batJab' },
    low: { left: 'batRiseR', right: 'batRiseL', up: 'batUp', down: 'batLegs' },
  },
};
/** From the guard (the right button held), a click: the sword thrusts, the bat jabs. */
const FROM_GUARD: Record<Armed, MoveId> = { katana: 'thrust', bat: 'batJab' };
/** Getting each weapon out and putting it away. */
const OUT: Record<Armed, MoveId> = { katana: 'draw', bat: 'batReady' };
const AWAY: Record<Armed, MoveId> = { katana: 'sheathe', bat: 'batLower' };

/** A weapon's attacks, each with the stance it belongs to (the first that has it), for a page's list. */
export function attacksOf(w: MeleeWeapon): { id: MoveId; stance: Stance }[] {
  const out = new Map<MoveId, Stance>();
  for (const s of ['mid', 'high', 'low'] as const) for (const id of [...COMBO[w][s], ...Object.values(DIRECTED[w][s])]) if (!out.has(id)) out.set(id, s);
  return [...out].map(([id, stance]) => ({ id, stance }));
}
const clipIds = (w: MeleeWeapon): MoveId[] => [...CLIP_SWINGS[w].combo, ...Object.values(CLIP_SWINGS[w].directed)];
const SWINGS: Record<MeleeWeapon, ReadonlySet<MoveId>> = {
  fists: new Set([...attacksOf('fists').map((a) => a.id), ...clipIds('fists')]),
  katana: new Set([...attacksOf('katana').map((a) => a.id), ...clipIds('katana')]),
  bat: new Set([...attacksOf('bat').map((a) => a.id), ...clipIds('bat')]),
};
/** The library's swings for a weapon, for a page's list. */
export function clipAttacksOf(w: MeleeWeapon): MoveId[] {
  return [...new Set(clipIds(w))];
}

/** How long after a move ends a click still carries the combo on. */
const COMBO_WINDOW = 0.35;
/** Once a move is this far through, a click queues the next. */
const QUEUE_FROM = 0.45;
/** How long a change of stance takes (s); how far apart (m, with the weapon's turn at a quarter metre a radian)
 * the stance and a swing's wind-up are for the wind-up to take its whole time, and the least of it there is. */
const STANCE_TIME = 0.24;
const WIND_FAR = 0.8;
const WIND_LEAST = 0.3;

/** A click held this long into a swing's wind-up makes it a heavy one: the wind-up then plays this much slower,
 * and the blow has this much more damage and shove. */
const HEAVY = { after: 0.14, slow: 0.5, power: 1.6 } as const;

const ease = (x: number): number => x * x * (3 - 2 * x);

/** The whole pose at a moment: both hands or the weapon, the foot, the chest. */
export interface MeleePose {
  readonly r: HandKey | null;
  readonly l: HandKey | null;
  readonly sword: SwordKey | null;
  /** The left hand off the weapon: on the saya's mouth (drawing and sheathing the sword), or free (the bat coming
   * up from his side or going back to it). */
  readonly leftOnSaya: boolean;
  /** The kicking foot's ankle (body frame) and how far it's taken over from standing (0..1). */
  readonly foot: { readonly p: V3; readonly w: number } | null;
  /** Or the foot placed in the world (a kill move's stomp on a man's head). */
  readonly footWorld?: { readonly p: V3; readonly w: number } | null;
  readonly twist: number;
  readonly lean: number;
  /** The hips and the feet (none: he stands as his walk has him). */
  readonly legs?: LegsKey;
  /** The weapon in the right hand alone. */
  readonly single?: boolean;
  /** The library's clip the whole body plays now (its name, seconds into it) and how far it has taken over (0..1). */
  readonly clip?: { readonly name: string; readonly time: number; readonly weight: number } | null;
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

/** One channel's value at share `t` of a move: from the keys that set it (where none does, `rest` at the start
 * and `end`, the same unless given, at the end). */
export function channel<T>(keys: readonly Key[], t: number, get: (k: Key) => T | undefined, rest: T, mix: (a: T, b: T, u: number) => T, end: T = rest): T {
  let prev: { t: number; val: T } = { t: 0, val: rest };
  for (const k of keys) {
    const val = get(k) ?? (k.t === 0 ? rest : k.t === 1 ? end : undefined);
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
  /** Fists up / the sword out / the bat up in both hands. */
  drawn = false;
  /** Guarding (held), and how far into the guard (eased). */
  guarding = false;
  guard = 0;
  /** A weapon in the right hand alone (`ONE_HAND`): the same swings, wider, quicker and weaker. */
  oneHand = false;
  /** Where a weapon's swings come from: the keys here, or the animation library's clips (one-handed, `CLIP_SWINGS`). */
  style: 'keys' | 'clips' = 'keys';
  /** How a weapon is held ready (`setStance`); the fists have the one. */
  stance: Stance = 'mid';
  private stanceFrom: Stance = 'mid';
  private stanceT = 1;
  private stanceNext: Stance | null = null;
  move: Move | null = null;
  /** Seconds into the move. */
  t = 0;
  private queued: MoveId | null = null;
  private comboAt = 0;
  private sinceEnd = 99;
  /** A wind-up the stance has all but made already: played this much faster, up to this share of the move. */
  private wind: { until: number; k: number } | null = null;
  /** Counts each move started, so a page can tell a new swing from the last. */
  swing = 0;
  /** How fast moves play (an enemy's are slower than yours, so you can read them). */
  rate = 1;
  /** The way the last move went, for a page's indicator. */
  lastDir: Dir = null;
  private queuedDir: Dir = null;
  /** The click still held (the page says): held into a swing's wind-up it makes the swing a heavy one. */
  holding = false;
  heavy = false;
  /** Blows asked for by `strike` take sides in turn. */
  private turn = 0;
  private struck = false;
  /** Seconds since a dodge ended. */
  sinceDodge = 99;

  /** Switches weapon (put away first). */
  setWeapon(w: MeleeWeapon): void {
    if (w === this.weapon) return;
    this.weapon = w;
    this.drawn = false;
    this.move = null;
    this.queued = null;
    this.setStance('mid', true);
  }

  /** Changes stance: the weapon eases over to it (at once with `snap`); in the middle of a move, when it ends. */
  setStance(s: Stance, snap = false): void {
    if (this.move && !snap) {
      this.stanceNext = s;
      return;
    }
    this.stanceNext = null;
    if (s === this.stance && !snap) return;
    this.stanceFrom = snap ? s : this.stance;
    this.stance = s;
    this.stanceT = snap ? 1 : 0;
  }

  /** A stance higher (+1) or lower (-1), as far as they go. */
  shiftStance(by: 1 | -1): void {
    const i = STANCES.indexOf(this.stanceNext ?? this.stance) + by;
    if (i >= 0 && i < STANCES.length) this.setStance(STANCES[i]);
  }

  /** Where the stance has the weapon now (on its way between two, part way). */
  private rest(w: Armed): SwordKey {
    const to = STANCE_REST[w][this.stance];
    return this.stanceT >= 1 ? to : lerpSword(STANCE_REST[w][this.stanceFrom], to, ease(this.stanceT));
  }

  /** And how it has him standing. */
  private restBody(w: Armed): { twist: number; legs: LegsKey } {
    const to = STANCE_BODY[w][this.stance];
    if (this.stanceT >= 1) return to;
    const from = STANCE_BODY[w][this.stanceFrom];
    const u = ease(this.stanceT);
    return { twist: from.twist + (to.twist - from.twist) * u, legs: lerpLegs(from.legs, to.legs, u) };
  }

  /** How much of a move's damage and shove a blow has now (less in one hand). */
  get power(): number {
    return (this.oneHand && this.weapon !== 'fists' && !this.move?.clip ? ONE_HAND.power : 1) * (this.heavy ? HEAVY.power : 1);
  }

  /** In one hand now: asked for, or the library's swings (which all are). */
  private get single(): boolean {
    return this.weapon !== 'fists' && (this.oneHand || this.style === 'clips');
  }

  /** Puts up the fists, draws the sword or brings the bat up; or puts them away. */
  toggleDrawn(): void {
    if (this.move && this.move.hitter === null) return;
    if (this.weapon === 'fists') this.drawn = !this.drawn;
    else this.start(this.drawn ? AWAY[this.weapon] : OUT[this.weapon]);
  }

  /**
   * A click: with a direction, the stance's swing that way; without, the next of its combo. Now if nothing's
   * under way, queued if a move is far enough along, else nothing.
   */
  attack(dir: Dir = null): void {
    if (!this.drawn) {
      this.toggleDrawn();
      return;
    }
    // From the guard, the sword thrusts and the bat jabs.
    if (this.weapon !== 'fists' && this.guarding && !this.move) {
      this.start(FROM_GUARD[this.weapon]);
      return;
    }
    const lib = this.style === 'clips' ? CLIP_SWINGS[this.weapon] : null;
    const combo = lib ? lib.combo : COMBO[this.weapon][this.stanceNext ?? this.stance];
    const directed = dir ? (lib ? lib.directed[dir] : DIRECTED[this.weapon][this.stanceNext ?? this.stance][dir]) : null;
    if (this.move) {
      // (A clip's recovery is long: the next can be asked for as soon as it's sweeping.)
      if (this.t / this.move.time >= (this.move.clip ? this.move.active[0] : QUEUE_FROM) && SWINGS[this.weapon].has(this.move.id)) {
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

  /**
   * A click, as it's read now (the mouse's way being shelved): the blow the stance has for where you're aiming
   * (`zone`; sides in turn), or the one for what he's doing (`doing`); bare-handed, with the hand the button is
   * (`hand`). Queued if a blow is far enough along.
   */
  strike(o: { zone?: Zone; doing?: Doing; hand?: 'l' | 'r' } = {}): void {
    if (!this.drawn) {
      this.toggleDrawn();
      return;
    }
    if (this.weapon !== 'fists' && this.guarding && !this.move) {
      this.start(FROM_GUARD[this.weapon]);
      return;
    }
    if (this.move) {
      if (this.move.hitter !== null && this.t / this.move.time >= (this.move.clip ? this.move.active[0] : QUEUE_FROM)) {
        this.queued = this.blowFor(o, this.turn + 1);
        this.queuedDir = null;
      }
      return;
    }
    this.turn = this.sinceEnd < COMBO_WINDOW ? this.turn + 1 : 0;
    this.lastDir = null;
    this.start(this.blowFor(o, this.turn));
    this.struck = true;
  }

  /** The blow for a click: what he's doing first, else the stance's for the zone, the `i`th in turn. */
  private blowFor(o: { zone?: Zone; doing?: Doing; hand?: 'l' | 'r' }, i: number): MoveId {
    const w = this.weapon;
    const lib = this.style === 'clips';
    if (w === 'fists' && o.hand) {
      if (o.doing && !(lib && o.doing === 'run')) return FIST_DOING[o.hand][o.doing];
      if (!o.doing) return (lib ? CLIP_HANDS : FIST_HANDS)[o.hand][o.zone ?? 'body'];
    }
    if (o.doing) return lib && o.doing === 'run' ? CLIP_RUN[w] : DOING[w][o.doing];
    const zone = o.zone ?? 'body';
    if (lib || w === 'fists') {
      const list = lib ? CLIP_ZONES[w][zone] : FIST_ZONES[zone];
      return list[i % list.length];
    }
    return `${w === 'katana' ? 'kz' : 'bz'}_${this.stanceNext ?? this.stance}_${zone}_${i % 2 === 0 ? 'r' : 'l'}`;
  }

  /** Stops whatever move is under way (a blow that lands on you, a kill move taking over). */
  cancel(): void {
    this.move = null;
    this.queued = null;
    this.sinceEnd = 99;
    this.endMove();
  }

  kick(): void {
    const id: MoveId = this.style === 'clips' ? 'libKick' : 'kick';
    if (this.move && this.move.id !== id && this.t / this.move.time < QUEUE_FROM) return;
    if (this.move?.id === id) return;
    this.start(id);
  }

  /** A dodge to the left (-1) or the right (1): once whatever's under way has made its sweep. */
  dodge(side: -1 | 1): void {
    if (this.move && (this.move.slide || this.phase < this.move.active[1])) return;
    this.queued = null;
    this.start(side < 0 ? 'dodgeL' : 'dodgeR');
  }

  /** How fast a dodge is carrying you to your right now (m/s), and whether blows miss you. */
  get slideSpeed(): number {
    const s = this.move?.slide;
    if (!s || !this.move) return 0;
    const p = this.phase;
    return p < s.from || p > s.to ? 0 : (s.side / ((s.to - s.from) * this.move.time)) * this.rate;
  }
  get evading(): boolean {
    const s = this.move?.slide;
    return !!s && this.phase >= s.from * 0.5 && this.phase <= s.to;
  }

  /** Plays a move now (scripts and checks), its wind-up whole. */
  play(id: MoveId): void {
    if (id !== 'kick' && MOVES[id].hitter !== null) this.drawn = true;
    this.start(id);
    this.wind = null;
  }

  private start(id: MoveId): void {
    const mv = MOVES[id];
    this.move = mv;
    this.t = 0;
    this.queued = null;
    this.swing++;
    this.heavy = false;
    this.struck = false;
    if (mv.hitter === null && mv.keys[0].sword === 'sheath') this.drawn = true;
    // Already wound up for it (the stance has the weapon where the swing starts from): less of a wind-up.
    this.wind = null;
    const first = mv.keys.find((k) => k.t > 0 && k.sword && k.sword !== 'sheath');
    if (this.weapon !== 'fists' && mv.hitter !== null && first && first.sword && first.sword !== 'sheath') {
      const r = this.rest(this.weapon);
      const far = r.p.distanceTo(first.sword.p) + 0.25 * r.dir.angleTo(first.sword.dir);
      this.wind = { until: first.t, k: 1 / THREE.MathUtils.clamp(far / WIND_FAR, WIND_LEAST, 1) };
    }
  }

  /** A move over or stopped: a stance asked for meanwhile is taken up. */
  private endMove(): void {
    this.wind = null;
    if (this.stanceNext) {
      const s = this.stanceNext;
      this.stanceNext = null;
      this.setStance(s);
    }
  }

  update(dt0: number): void {
    const dt = dt0 * this.rate;
    this.guard += ((this.guarding && this.drawn && !this.move ? 1 : 0) - this.guard) * Math.min(1, dt0 * 14);
    this.sinceDodge += dt;
    if (!this.move) {
      this.sinceEnd += dt;
      this.stanceT = Math.min(1, this.stanceT + dt0 / STANCE_TIME);
      this.heavy = false;
      return;
    }
    // Held into the wind-up, a blow becomes a heavy one: it loads longer, and lands harder.
    const winding = this.move.hitter !== null && !this.move.clip && this.t / this.move.time < this.move.active[0];
    if (this.holding && winding && !this.heavy && this.t > HEAVY.after) this.heavy = true;
    this.t += dt * (this.wind && this.t / this.move.time < this.wind.until ? this.wind.k : 1) * (this.oneHand && this.weapon !== 'fists' && this.move.hitter !== null && !this.move.clip ? ONE_HAND.speed : 1) * (this.heavy && winding ? HEAVY.slow : 1);
    // A clip with the next swing asked for is cut short once its sweep is over (not played out to its rest).
    const cut = !!this.move.clip && !!this.queued && this.t > this.move.active[1] * this.move.time + CLIP_CUT;
    if (this.t >= this.move.time || cut) {
      const done = this.move;
      this.move = null;
      // Only a move of the combo carries it on (not a draw or a kick).
      const comboNow = done.clip ? CLIP_SWINGS[this.weapon].combo : COMBO[this.weapon][this.stance];
      this.sinceEnd = this.struck || comboNow.includes(done.id) ? 0 : 99;
      if (done.slide) this.sinceDodge = 0;
      if (done.hitter === null && done.keys[done.keys.length - 1].sword === 'sheath') this.drawn = false;
      const next = this.queued;
      const nextDir = this.queuedDir;
      this.endMove();
      if (next) {
        const combo = MOVES[next].clip ? CLIP_SWINGS[this.weapon].combo : COMBO[this.weapon][this.stance];
        const i = combo.indexOf(next);
        if (i >= 0) this.comboAt = i;
        this.lastDir = nextDir;
        this.stanceT = 1;
        const byStrike = this.struck;
        if (byStrike) this.turn++;
        this.start(next);
        this.struck = byStrike;
      }
    }
  }

  /** The library's clip playing now (a move made of them): which, how far into it, and how far it has taken over. */
  private clipNow(): MeleePose['clip'] {
    const m = this.move;
    if (!m || !m.clip) return null;
    let at = Math.min(this.t, m.time);
    let part = m.clip[0];
    for (const p of m.clip) {
      part = p;
      if (at <= p.time) break;
      at -= p.time;
    }
    return { name: part.name, time: Math.min(at, part.time), weight: ease(Math.max(0, Math.min(1, this.t / CLIP_IN, (m.time - this.t) / CLIP_OUT))) };
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

  /** The pose now. `sheath` is where the weapon is put away, in the view's frame: the sword in its saya, the bat
   * hanging in his right hand. */
  pose(sheath: SwordKey): MeleePose {
    const w = this.weapon;
    const g = this.guard;
    const fistRest = { r: lerpHand(FIST_GUARD.r, FIST_BLOCK.r, g), l: lerpHand(FIST_GUARD.l, FIST_BLOCK.l, g) };
    const stanceRest = w === 'fists' ? SWORD_GUARD : this.rest(w);
    const swordRest = w === 'fists' || !this.drawn ? sheath : g < 1e-4 ? stanceRest : lerpSword(stanceRest, BLOCK[w], g);
    // How the stance has him standing (out of it, or guarding, square).
    const body = w !== 'fists' && this.drawn ? this.restBody(w) : { twist: 0, legs: NO_LEGS };
    const bodyRest = g < 1e-4 ? body : { twist: body.twist * (1 - g), legs: lerpLegs(body.legs, legsOf(0, body.legs.sink), g) };
    const single = this.single;
    // In one hand: out toward that shoulder, wider and further.
    const held = (s: SwordKey | null): SwordKey | null => (s && single ? { ...s, p: v(s.p.x * ONE_HAND.wide + ONE_HAND.out, s.p.y, s.p.z * ONE_HAND.far) } : s);
    const m = this.move;
    if (!m) {
      if (w !== 'fists') return { r: null, l: null, sword: this.drawn ? held(swordRest) : null, leftOnSaya: single && this.drawn, foot: null, twist: bodyRest.twist, lean: 0, legs: bodyRest.legs, single };
      return { r: this.drawn ? fistRest.r : null, l: this.drawn ? fistRest.l : null, sword: null, leftOnSaya: false, foot: null, twist: 0, lean: 0 };
    }
    const t = this.phase;
    const resolve = (s: SwordKey | 'sheath' | undefined): SwordKey | undefined => (s === 'sheath' ? sheath : s);
    // Getting it out starts from where it's put away, and ends, like any other move, at the stance.
    const out = m.hitter === null && m.keys[0].sword === 'sheath';
    const away = m.hitter === null && m.keys[m.keys.length - 1].sword === 'sheath';
    const sword = w !== 'fists' ? channel<SwordKey>(m.keys, t, (k) => resolve(k.sword), out ? sheath : stanceRest, lerpSword, stanceRest) : null;
    // A kick with the fists down leaves them in the guard; with the weapon out, it stays where the stance has it.
    const r = w !== 'fists' ? null : channel<HandKey>(m.keys, t, (k) => k.r, fistRest.r, lerpHand);
    const l = w !== 'fists' ? null : channel<HandKey>(m.keys, t, (k) => k.l, fistRest.l, lerpHand);
    type Foot = { p: V3 | null; w: number };
    const footC = channel<Foot>(
      m.keys,
      t,
      (k) => (k.foot === undefined ? undefined : { p: k.foot, w: k.foot ? 1 : 0 }),
      { p: null, w: 0 },
      (a, b, u) => ({ p: a.p && b.p ? a.p.clone().lerp(b.p, u) : (a.p ?? b.p), w: a.w + (b.w - a.w) * u }),
    );
    const footV = footC.p && footC.w > 0.001 ? { p: footC.p, w: footC.w } : null;
    const num = (get: (k: Key) => number | undefined, rest = 0): number => channel<number>(m.keys, t, get, rest, (a, b, u) => a + (b - a) * u);
    const kickOnly = m.id === 'kick' || m.id === 'stomp';
    // (Getting it out starts square and ends as the stance stands; putting it away, the other way.)
    const legs = kickOnly ? bodyRest.legs : channel<LegsKey>(m.keys, t, (k) => k.legs, out ? NO_LEGS : bodyRest.legs, lerpLegs, away ? NO_LEGS : bodyRest.legs);
    const twistRest = kickOnly ? 0 : bodyRest.twist;
    return {
      r: kickOnly && !this.drawn && w === 'fists' ? FIST_GUARD.r : r,
      l: kickOnly && !this.drawn && w === 'fists' ? FIST_GUARD.l : l,
      sword: w !== 'fists' ? held(kickOnly ? (this.drawn ? swordRest : null) : sword) : null,
      leftOnSaya: (out ? t < 0.5 : away ? t > 0.55 : false) || single,
      foot: footV,
      twist: w !== 'fists' ? channel<number>(m.keys, t, (k) => k.twist, out ? 0 : twistRest, (a, b, u) => a + (b - a) * u, away ? 0 : twistRest) : num((k) => k.twist),
      lean: num((k) => k.lean),
      legs: w !== 'fists' ? legs : undefined,
      single,
      clip: this.clipNow(),
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
    const s = localStorage.getItem('rainyplace.gore');
    if (s && (GORE_LEVELS as readonly string[]).includes(s)) return s as GoreLevel;
  } catch {
    /* no storage */
  }
  return 'full';
}

export function saveGore(level: GoreLevel): void {
  try {
    localStorage.setItem('rainyplace.gore', level);
  } catch {
    /* no storage */
  }
}
