import * as THREE from 'three';
import type { Gore } from './gore';
import { channel, FIST_GUARD, lerpHand, lerpSword, SWORD_GUARD, type HandKey, type MeleePose, type MeleeWeapon, type SwordKey } from './melee';
import type { MeleeSound } from './meleeSound';
import type { Thug } from './thug';

/**
 * Kill moves, Skyrim's way: a killing blow rolls a chance (`KILL_CHANCE`, high by default; the page's setting)
 * and, if it comes up and a move fits (the weapon, whether he's on the floor, a wall behind him, how close),
 * the blow becomes a short scripted kill instead: Mack and the victim posed together (the victim put where the
 * move wants him, eased in), timed events for the blood, sounds, shake and hit-stop, the camera looking at the
 * victim (one move cuts to a cinematic angle), Mack untouchable till it ends. The gore level picks the version:
 * full takes the head off or apart, low and off keep it on.
 *
 * `KillRun` plays one; the page gives it a `KillCtx` (Mack's eyes and frame, the rig's hands and gun, the gore
 * and the sounds) and applies what each step returns.
 */

type V3 = THREE.Vector3;
const v = (x: number, y: number, z: number): V3 => new THREE.Vector3(x, y, z);
const n = (x: number, y: number, z: number): V3 => new THREE.Vector3(x, y, z).normalize();
const UP = new THREE.Vector3(0, 1, 0);

/** The chance a killing blow becomes a kill move, unless the page sets it (`?killmoves=`). */
export const KILL_CHANCE = 0.8;

/** What the page knows when a blow would kill. */
export interface KillQuery {
  readonly weapon: MeleeWeapon | 'shotgun';
  readonly floored: boolean;
  /** A wall behind him (from you through him), within reach of a shove. */
  readonly wall: boolean;
  /** How far he is (horizontally, from your eyes) and whether he faces you. */
  readonly dist: number;
  readonly facing: boolean;
}

/** What a kill move works with while it plays. */
export interface KillCtx {
  readonly victim: Thug;
  readonly gore: Gore;
  readonly sound: MeleeSound;
  /** Your eyes now (world), and your frame as it was when the move began: ahead and to the right, level. */
  eye(): V3;
  readonly fwd: V3;
  readonly right: V3;
  /** A world point and a world direction in your view's frame now. */
  toView(p: V3): V3;
  toViewDir(d: V3): V3;
  /** Your pose when it began (the fighting pose the move starts from). */
  readonly start: MeleePose | null;
  /** Your hands' wrists now (world). */
  hand(side: 'l' | 'r'): V3;
  /** The blade's root and point now (world). */
  blade(): [V3, V3];
  /** Your gun: its muzzle in its own frame, and its place when the move began (world). */
  readonly gunMuzzle: V3;
  readonly gunStart: { pos: V3; quat: THREE.Quaternion } | null;
  fire(): void;
  /** The wall behind him, if the move needs one. */
  readonly wall: { point: V3; normal: V3 } | null;
  shake(amount: number): void;
  hitstop(secs: number): void;
}

export interface KillMove {
  readonly id: string;
  readonly label: string;
  readonly weight: number;
  ok(q: KillQuery): boolean;
  /** Seconds. */
  readonly time: number;
  /** Where he's put (your frame: metres ahead and to the right, facing you), eased in; none leaves him be. */
  readonly place?: { ahead: number; right: number };
  /** Your pose at share `u` (null for the gun moves: the gun's place instead). */
  mack(u: number, c: KillCtx): MeleePose | null;
  gun?(u: number, c: KillCtx): { pos: V3; quat: THREE.Quaternion } | null;
  /** Where your eyes go (world, level), if you're carried (a shove into a wall). */
  mackAt?(u: number, c: KillCtx, start: V3): V3 | null;
  /** His pose at share `u` (his bones reset to rest first), until he's released. */
  victim(u: number, c: KillCtx): void;
  readonly events: readonly { readonly t: number; run(c: KillCtx): void }[];
  /** When he's handed back (he falls or stays as he is), and how. */
  readonly release: number;
  onRelease(c: KillCtx): void;
  /** What you look at. */
  focus(u: number, c: KillCtx): V3;
  /** A cinematic camera for this one (world position and target), when it wants one. */
  cine?(u: number, c: KillCtx): { pos: V3; look: V3 } | null;
}

const ease = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const span = (u: number, a: number, b: number): number => ease((u - a) / (b - a));

/** The sword through keys (share, key) from where it started. */
function swordAt(keys: readonly [number, SwordKey][], u: number, c: KillCtx): SwordKey {
  const start = c.start?.sword ?? SWORD_GUARD;
  return channel<SwordKey>([{ t: 0, sword: start }, ...keys.map(([t, s]) => ({ t, sword: s })), { t: 1, sword: SWORD_GUARD }], u, (k) => (k.sword === 'sheath' ? undefined : k.sword), start, lerpSword);
}

/** A number through keys (share, value). */
function numAt(keys: readonly [number, number][], u: number): number {
  return channel<number>([{ t: 0, twist: 0 }, ...keys.map(([t, x]) => ({ t, twist: x })), { t: 1, twist: 0 }], u, (k) => k.twist, 0, (a, b, w) => a + (b - a) * w);
}

/** The foot through keys (share, body-frame ankle or null standing). */
function footAt(keys: readonly [number, V3 | null][], u: number): { p: V3; w: number } | null {
  type F = { p: V3 | null; w: number };
  const f = channel<F>(
    [{ t: 0, foot: null }, ...keys.map(([t, p]) => ({ t, foot: p })), { t: 1, foot: null }],
    u,
    (k) => (k.foot === undefined ? undefined : { p: k.foot, w: k.foot ? 1 : 0 }),
    { p: null, w: 0 },
    (a, b, w) => ({ p: a.p && b.p ? a.p.clone().lerp(b.p, w) : (a.p ?? b.p), w: a.w + (b.w - a.w) * w }),
  );
  return f.p && f.w > 0.001 ? { p: f.p, w: f.w } : null;
}

const pose = (o: Partial<MeleePose>): MeleePose => ({ r: null, l: null, sword: null, leftOnSaya: false, foot: null, twist: 0, lean: 0, ...o });

/** A hand key from world places: wrist, forward, palm normal. */
function handFrom(c: KillCtx, p: V3, f: V3, nrm: V3, elbow?: V3): HandKey {
  return { p: c.toView(p), f: c.toViewDir(f).normalize(), n: c.toViewDir(nrm).normalize(), elbow: elbow && c.toViewDir(elbow).normalize() };
}

function boneAt(c: KillCtx, name: string): V3 {
  return c.victim.bone(name).getWorldPosition(new THREE.Vector3());
}

// ---- The moves ----

/** Katana: straight through the body, held, the blade turned, then kicked off it. */
const RUN_THROUGH: KillMove = {
  id: 'run_through',
  label: 'run through',
  weight: 1,
  ok: (q) => q.weapon === 'katana' && !q.floored && q.dist < 1.9,
  time: 1.5,
  place: { ahead: 0.95, right: 0.02 },
  mack(u, c) {
    const thrust: SwordKey = { p: v(0.02, -0.27, -0.55), dir: n(0, 0.03, -1), edge: n(0, -1, 0) };
    const sword = swordAt(
      [
        [0.16, { p: v(0.06, -0.25, -0.16), dir: n(0, 0.12, -1), edge: n(0, -1, 0.12) }],
        [0.3, thrust],
        [0.6, { ...thrust, edge: n(0.75, -0.65, 0) }],
        [0.84, { p: v(0.08, -0.28, -0.28), dir: n(0.05, 0.25, -1), edge: n(0, -1, 0.25) }],
      ],
      u,
      c,
    );
    return pose({
      sword,
      foot: footAt([[0.6, null], [0.7, v(0.1, 0.7, 0.35)], [0.78, v(0.1, 1.05, 0.8)], [0.9, v(0.1, 0.55, 0.3)]], u),
      twist: numAt([[0.3, 0.25], [0.6, 0.25], [0.78, 0]], u),
      lean: numAt([[0.3, 0.22], [0.6, 0.22], [0.78, -0.28], [0.9, -0.1]], u),
    });
  },
  victim(u, c) {
    const t = c.victim;
    if (u < 0.3) {
      t.fightPose(c.eye());
      return;
    }
    // Run through: folded over the blade, the head down, the knees going, a tremor.
    const k = span(u, 0.3, 0.38);
    const shiver = Math.sin(u * 90) * 0.03 * (1 - span(u, 0.5, 0.76));
    t.turn('spine_01', 0, 0.25 * k);
    t.turn('spine_02', 0, (0.32 + shiver) * k);
    t.turn('neck_01', 0, 0.35 * k);
    t.turn('head', 0, 0.25 * k + shiver);
    t.turn('thigh_l', 0, -0.25 * k);
    t.turn('thigh_r', 0, -0.2 * k);
    t.turn('calf_l', 0, 0.4 * k);
    t.turn('calf_r', 0, 0.35 * k);
    // His hands to the blade in his belly.
    const [a, b] = c.blade();
    const on = a.clone().lerp(b, 0.42);
    t.reach('r', on.clone().addScaledVector(c.right, -0.05), c.right.clone().negate().add(v(0, -1, 0)).normalize());
    t.reach('l', on.clone().addScaledVector(c.right, 0.06).addScaledVector(c.fwd, 0.04), c.right.clone().add(v(0, -1, 0)).normalize());
    t.fist('l', 0.6);
    t.fist('r', 0.6);
  },
  events: [
    {
      t: 0.3,
      run(c) {
        const chest = boneAt(c, 'spine_02');
        c.gore.hit(chest, c.fwd, true, 1, 'torso', c.victim.bone('spine_02'), c.eye());
        const back = chest.clone().addScaledVector(c.fwd, 0.16);
        c.gore.burst(back, c.fwd, 70, 3, 0.35);
        c.gore.spurt(c.victim.bone('spine_02'), back, c.fwd.clone().add(v(0, 0.25, 0)), 1.4, 90);
        c.gore.blade = 1;
        c.sound.cut(c.gore.level !== 'off');
        c.shake(0.5);
        c.hitstop(0.07);
      },
    },
    { t: 0.5, run: (c) => c.gore.burst(c.victim.headCentre().addScaledVector(c.fwd, -0.09).add(v(0, -0.05, 0)), c.fwd.clone().negate().add(v(0, -1, 0)), 14, 0.8, 0.4, 0.004) },
    {
      t: 0.76,
      run(c) {
        c.sound.thud(1);
        c.shake(0.45);
      },
    },
  ],
  release: 0.76,
  onRelease: (c) => c.victim.endScript('fall', c.fwd, 2.4),
  focus: (u, c) => (u < 0.3 ? c.victim.headCentre() : boneAt(c, 'spine_03')),
};

/** Katana: wound up over the right shoulder, one flat cut through the neck; the head goes, the body stands a
 * moment and drops. Seen from the side. */
const DECAPITATE: KillMove = {
  id: 'decapitate',
  label: 'decapitation',
  weight: 1.2,
  ok: (q) => q.weapon === 'katana' && !q.floored && q.dist < 1.9,
  time: 1.6,
  place: { ahead: 1.0, right: 0.05 },
  mack(u, c) {
    return pose({
      sword: swordAt(
        [
          [0.22, { p: v(0.26, -0.04, -0.12), dir: n(0.75, 0.45, 0.45), edge: n(-0.45, 0, -0.9) }],
          [0.38, { p: v(0.12, -0.2, -0.44), dir: n(-0.3, -0.04, -0.95), edge: n(-0.95, 0, 0.3) }],
          [0.5, { p: v(-0.2, -0.22, -0.34), dir: n(-0.95, 0, -0.25), edge: n(-0.25, 0, 0.97) }],
          [0.72, { p: v(-0.24, -0.34, -0.26), dir: n(-0.75, -0.45, 0.2), edge: n(0.3, -0.2, 0.93) }],
        ],
        u,
        c,
      ),
      twist: numAt([[0.22, 0.5], [0.38, 0.1], [0.5, -0.45], [0.72, -0.4]], u),
      lean: numAt([[0.22, -0.05], [0.45, 0.15], [0.72, 0.1]], u),
    });
  },
  victim(u, c) {
    const t = c.victim;
    if (u < 0.42) {
      t.fightPose(c.eye());
      return;
    }
    // Standing a beat, the arms dropping, then the knees go.
    const drop = span(u, 0.42, 0.6);
    for (const s of ['l', 'r'] as const) {
      const sh = boneAt(c, `upperarm_${s}`);
      const side = s === 'l' ? -1 : 1;
      t.reach(s, sh.clone().add(v(0, -0.5 * drop - 0.05, 0)).addScaledVector(c.right, side * 0.08 * -1).addScaledVector(c.fwd, -0.25 * (1 - drop)), v(0, 0, 0).sub(c.fwd));
    }
    const knees = span(u, 0.58, 0.72);
    t.turn('thigh_l', 0, -0.5 * knees);
    t.turn('thigh_r', 0, -0.4 * knees);
    t.turn('calf_l', 0, 0.9 * knees);
    t.turn('calf_r', 0, 0.8 * knees);
    t.turn('spine_02', 0, 0.2 * knees);
  },
  events: [
    {
      t: 0.42,
      run(c) {
        const t = c.victim;
        const neck = t.bone('head').getWorldPosition(new THREE.Vector3());
        if (c.gore.level === 'full') {
          const head = t.severHead();
          c.gore.throwPiece(head, c.right.clone().multiplyScalar(-2.2).add(v(0, 2.6, 0)).addScaledVector(c.fwd, 0.6), v(Math.random() * 6 + 4, Math.random() * 4, Math.random() * 8 + 4), 0.11);
          c.gore.spurt(t.bone('neck_01'), neck, UP.clone().addScaledVector(c.right, -0.3), 3.4, 170);
          c.gore.burst(neck, c.right.clone().negate().add(v(0, 0.4, 0)), 45, 3, 0.4);
          c.gore.blade = 1;
        } else c.gore.hit(neck, c.right.clone().negate(), true, 1, 'neck', t.bone('neck_01'), c.eye());
        c.sound.cut(c.gore.level !== 'off');
        c.shake(0.6);
        c.hitstop(0.09);
      },
    },
  ],
  release: 0.72,
  onRelease: (c) => c.victim.endScript('fall', c.fwd.clone().negate().addScaledVector(c.right, -0.4), 0.6),
  focus: (_u, c) => boneAt(c, 'neck_01'),
  cine(u, c) {
    // From your left, a little ahead, low: the cut crosses the frame toward the camera; a slow push in.
    const mid = boneAt(c, 'neck_01');
    const pos = c.eye().addScaledVector(c.right, -1.7 + 0.3 * u).addScaledVector(c.fwd, 0.45).add(v(0, -0.25, 0));
    return { pos, look: mid.add(v(0, -0.1, 0)) };
  },
};

/** Fists: his head in both hands, a hard twist; he drops. */
const NECK_SNAP: KillMove = {
  id: 'neck_snap',
  label: 'neck snap',
  weight: 1,
  ok: (q) => q.weapon === 'fists' && !q.floored && q.dist < 1.7,
  time: 1.25,
  place: { ahead: 0.55, right: 0 },
  mack(u, c) {
    const h = c.victim.headCentre();
    const R = c.right;
    const F = c.fwd;
    const grip = {
      r: handFrom(c, h.clone().addScaledVector(R, 0.13).addScaledVector(F, -0.03).add(v(0, -0.03, 0)), UP.clone().addScaledVector(F, 0.3), R.clone().negate(), R.clone().add(v(0, -1, 0))),
      l: handFrom(c, h.clone().addScaledVector(R, -0.13).addScaledVector(F, -0.03).add(v(0, -0.03, 0)), UP.clone().addScaledVector(F, 0.3), R.clone(), R.clone().negate().add(v(0, -1, 0))),
    };
    const twisted = {
      r: handFrom(c, h.clone().addScaledVector(R, 0.1).addScaledVector(F, -0.1).add(v(0, 0.05, 0)), UP.clone().addScaledVector(F, -0.4).addScaledVector(R, -0.3), R.clone().negate().addScaledVector(F, 0.6), R.clone().add(v(0, -1, 0))),
      l: handFrom(c, h.clone().addScaledVector(R, -0.08).addScaledVector(F, 0.06).add(v(0, -0.06, 0)), UP.clone().addScaledVector(F, 0.6).addScaledVector(R, 0.3), R.clone().addScaledVector(F, -0.6), R.clone().negate().add(v(0, -1, 0))),
    };
    const s = c.start;
    const r0 = s?.r ?? FIST_GUARD.r;
    const l0 = s?.l ?? FIST_GUARD.l;
    let r: HandKey;
    let l: HandKey;
    if (u < 0.28) {
      r = lerpHand(r0, grip.r, span(u, 0, 0.28));
      l = lerpHand(l0, grip.l, span(u, 0, 0.28));
    } else if (u < 0.46) {
      r = grip.r;
      l = grip.l;
    } else if (u < 0.66) {
      r = lerpHand(grip.r, twisted.r, span(u, 0.46, 0.52));
      l = lerpHand(grip.l, twisted.l, span(u, 0.46, 0.52));
    } else {
      r = lerpHand(twisted.r, FIST_GUARD.r, span(u, 0.66, 1));
      l = lerpHand(twisted.l, FIST_GUARD.l, span(u, 0.66, 1));
    }
    return pose({ r, l, twist: numAt([[0.3, 0.1], [0.52, -0.3], [0.7, -0.2]], u), lean: numAt([[0.3, 0.15], [0.6, 0.15]], u) });
  },
  victim(u, c) {
    const t = c.victim;
    if (u < 0.25) {
      t.fightPose(c.eye());
      return;
    }
    const snapped = span(u, 0.5, 0.54);
    if (snapped < 1) {
      // Struggling: his hands at your forearms.
      t.reach('r', c.hand('l').addScaledVector(c.fwd, 0.12), v(0, -1, 0).addScaledVector(c.right, -0.5));
      t.reach('l', c.hand('r').addScaledVector(c.fwd, 0.12), v(0, -1, 0).addScaledVector(c.right, 0.5));
      t.fist('l', 0.7);
      t.fist('r', 0.7);
      t.turn('head', 1, Math.sin(u * 60) * 0.06);
      t.turn('spine_02', 0, -0.1);
    }
    t.turn('neck_01', 1, 0.6 * snapped);
    t.turn('head', 1, 1.3 * snapped);
    t.turn('head', 0, 0.25 * snapped);
    const knees = span(u, 0.55, 0.72);
    t.turn('thigh_l', 0, -0.6 * knees);
    t.turn('thigh_r', 0, -0.5 * knees);
    t.turn('calf_l', 0, 1.1 * knees);
    t.turn('calf_r', 0, 1.0 * knees);
  },
  events: [
    {
      t: 0.5,
      run(c) {
        c.victim.brokenNeck = true;
        c.sound.crack();
        c.shake(0.45);
        c.hitstop(0.06);
        if (c.gore.level === 'full') c.gore.burst(c.victim.headCentre().addScaledVector(c.fwd, -0.09).add(v(0, -0.05, 0)), v(0, -1, 0).addScaledVector(c.fwd, -0.3), 10, 0.6, 0.4, 0.004);
      },
    },
  ],
  release: 0.72,
  onRelease: (c) => c.victim.endScript('fall', c.right.clone().negate().addScaledVector(c.fwd, 0.4), 0.3),
  focus: (_u, c) => c.victim.headCentre(),
};

/** Fists: a hand over his face, driven back into the wall behind him; he slides down it. */
const WALL_SLAM: KillMove = {
  id: 'wall_slam',
  label: 'wall slam',
  weight: 1.4,
  ok: (q) => q.weapon === 'fists' && !q.floored && q.wall && q.dist < 1.7,
  time: 1.45,
  mack(u, c) {
    const t = c.victim;
    const h = t.headCentre();
    const toHim = c.fwd;
    const face: HandKey = handFrom(c, h.clone().addScaledVector(toHim, -0.17).add(v(0, -0.02, 0)), UP.clone().addScaledVector(toHim, 0.4), toHim.clone(), c.right.clone().add(v(0, -1, 0)));
    const chest: HandKey = handFrom(c, boneAt(c, 'spine_03').addScaledVector(toHim, -0.22).addScaledVector(c.right, -0.05), UP.clone().addScaledVector(c.right, 0.5), toHim.clone(), c.right.clone().negate().add(v(0, -1, 0)));
    const r0 = c.start?.r ?? FIST_GUARD.r;
    const l0 = c.start?.l ?? FIST_GUARD.l;
    const grab = span(u, 0, 0.22);
    const back = span(u, 0.62, 1);
    const r = u < 0.62 ? lerpHand(r0, face, grab) : lerpHand(face, FIST_GUARD.r, back);
    const l = u < 0.62 ? lerpHand(l0, chest, grab) : lerpHand(chest, FIST_GUARD.l, back);
    return pose({ r, l, twist: numAt([[0.22, 0.2], [0.45, 0.35], [0.62, 0.2]], u), lean: numAt([[0.22, 0.15], [0.45, 0.4], [0.62, 0.3]], u) });
  },
  mackAt(u, c, start) {
    const w = c.wall!;
    // Carried after him toward the wall, stopping arm's length short.
    const flat = (p: V3): V3 => v(p.x, start.y, p.z);
    const stopAt = flat(w.point).addScaledVector(c.fwd, -0.85);
    const travel = Math.max(0, stopAt.clone().sub(start).dot(c.fwd));
    return start.clone().addScaledVector(c.fwd, travel * span(u, 0.2, 0.45));
  },
  victim(u, c) {
    const t = c.victim;
    const w = c.wall!;
    if (u < 0.22) {
      t.fightPose(c.eye());
      return;
    }
    // Driven back to stand against the wall, his head hits it at the slam, then he slides down.
    const against = v(w.point.x, t.root.position.y, w.point.z).addScaledVector(w.normal, 0.3);
    const drive = span(u, 0.22, 0.45);
    const from = (t as unknown as { slamFrom?: V3 }).slamFrom ?? ((t as unknown as { slamFrom?: V3 }).slamFrom = t.root.position.clone());
    const pos = from.clone().lerp(against, drive);
    const slide = span(u, 0.7, 1);
    t.root.position.set(pos.x, from.y - 0.42 * slide, pos.z);
    t.yaw = Math.atan2(w.normal.x, w.normal.z);
    t.resetPose();
    t.turn('spine_02', 0, -0.15 * drive + 0.4 * slide);
    t.turn('neck_01', 0, -0.35 * span(u, 0.42, 0.46) + 0.5 * slide);
    t.turn('head', 0, -0.3 * span(u, 0.42, 0.46) * (1 - slide) + 0.3 * slide);
    t.turn('thigh_l', 0, -1.3 * slide);
    t.turn('thigh_r', 0, -1.2 * slide);
    t.turn('calf_l', 0, 1.9 * slide);
    t.turn('calf_r', 0, 1.8 * slide);
    if (slide < 0.2) {
      t.reach('r', c.hand('r').addScaledVector(c.fwd, 0.1).add(v(0, -0.12, 0)), v(0, -1, 0));
      t.reach('l', c.hand('r').addScaledVector(c.fwd, 0.1).add(v(0, -0.18, 0)), v(0, -1, 0));
    } else {
      for (const s of ['l', 'r'] as const) t.reach(s, t.root.position.clone().addScaledVector(c.right, s === 'l' ? 0.38 : -0.38).add(v(0, 0.05, 0)).addScaledVector(w.normal, 0.25), v(0, 1, 0));
    }
  },
  events: [
    {
      t: 0.44,
      run(c) {
        const w = c.wall!;
        const h = c.victim.headCentre();
        const onWall = h.clone().addScaledVector(w.normal, -h.clone().sub(w.point).dot(w.normal));
        c.gore.wallSplat(onWall, w.normal, 0.32);
        c.gore.burst(h, w.normal, 26, 1.5, 0.7, 0.005);
        c.sound.crunch();
        c.shake(0.85);
        c.hitstop(0.09);
      },
    },
    ...[0.75, 0.86, 0.97].map((t) => ({
      t,
      run(c: KillCtx) {
        if (c.gore.level !== 'full') return;
        const w = c.wall!;
        const h = c.victim.headCentre();
        c.gore.wallSplat(h.addScaledVector(w.normal, -h.clone().sub(w.point).dot(w.normal)), w.normal, 0.12);
      },
    })),
  ],
  release: 1,
  onRelease: (c) => {
    delete (c.victim as unknown as { slamFrom?: V3 }).slamFrom;
    c.victim.endScript('hold');
  },
  focus: (_u, c) => c.victim.headCentre(),
};

/** Fists: the heel down on the head of a man on the floor. */
const STOMP: KillMove = {
  id: 'stomp',
  label: 'stomp',
  weight: 1,
  ok: (q) => q.floored && q.dist < 2.2,
  time: 1.0,
  mack(u, c) {
    const h = c.victim.headCentre();
    const toward = c.fwd.clone();
    const raised = h.clone().add(v(0, 0.5, 0)).addScaledVector(toward, -0.05);
    const down = h.clone().add(v(0, 0.07, 0));
    let p: V3;
    let w = 1;
    if (u < 0.3) {
      p = raised;
      w = span(u, 0, 0.3);
    } else if (u < 0.5) p = raised.clone().lerp(down, span(u, 0.42, 0.5));
    else if (u < 0.65) p = down;
    else {
      p = down.clone().lerp(raised, span(u, 0.65, 0.85));
      w = 1 - span(u, 0.8, 1);
    }
    return pose({ r: FIST_GUARD.r, l: FIST_GUARD.l, footWorld: { p, w }, lean: numAt([[0.3, 0.05], [0.5, 0.3], [0.7, 0.2]], u) });
  },
  mackAt(u, c, start) {
    // Up to him: his head half a metre ahead of you.
    const h = c.victim.headCentre();
    const to = v(h.x - start.x, 0, h.z - start.z);
    const d = to.length();
    const want = start.clone().addScaledVector(to.normalize(), Math.max(0, d - 0.55));
    return start.clone().lerp(want, span(u, 0, 0.3));
  },
  victim(_u, c) {
    c.victim.holdFallen();
  },
  events: [
    {
      t: 0.5,
      run(c) {
        const h = c.victim.headCentre();
        if (c.gore.level === 'full') {
          c.victim.crushHead();
          c.gore.burst(h, UP, 45, 2.2, 1, 0.006);
          c.gore.bleedOut(h, 0.7);
        } else c.gore.hit(h, v(0, -1, 0), false, 1, 'head', c.victim.bone('head'), c.eye());
        c.sound.crunch();
        c.shake(0.6);
        c.hitstop(0.07);
      },
    },
  ],
  release: 0.55,
  onRelease: (c) => c.victim.endScript('fall'),
  focus: (_u, c) => c.victim.headCentre(),
};

/** Shotgun: the muzzle jammed up under his jaw, and the trigger. */
const SHOTGUN_JAW: KillMove = {
  id: 'shotgun_jaw',
  label: 'under the jaw',
  weight: 1,
  ok: (q) => q.weapon === 'shotgun' && !q.floored && q.dist < 1.9 && q.facing,
  time: 1.15,
  place: { ahead: 0.62, right: 0.02 },
  mack: () => null,
  gun(u, c) {
    const t = c.victim;
    const chin = t.headCentre().add(v(0, -0.12, 0)).addScaledVector(c.fwd, -0.05);
    const hip = c.eye().add(v(0, -0.78, 0)).addScaledVector(c.fwd, 0.18).addScaledVector(c.right, 0.12);
    const dir = chin.clone().sub(hip).normalize();
    const z = dir.clone().negate();
    const y = UP.clone().addScaledVector(z, -UP.dot(z)).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    const jaw = { pos: chin.clone().sub(c.gunMuzzle.clone().applyQuaternion(quat)), quat };
    const s = c.gunStart ?? jaw;
    if (u < 0.3) {
      const k = span(u, 0, 0.3);
      return { pos: s.pos.clone().lerp(jaw.pos, k), quat: s.quat.clone().slerp(jaw.quat, k) };
    }
    if (u < 0.5) return jaw;
    if (u < 0.66) {
      // The kick: back and up.
      const k = Math.sin(Math.PI * span(u, 0.5, 0.66));
      return { pos: jaw.pos.clone().addScaledVector(dir, -0.09 * k).add(v(0, 0.04 * k, 0)), quat: jaw.quat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(v(1, 0, 0), 0.25 * k)) };
    }
    if (u > 0.95) return null;
    const k = span(u, 0.66, 0.95);
    return { pos: jaw.pos.clone().lerp(s.pos, k), quat: jaw.quat.clone().slerp(s.quat, k) };
  },
  victim(u, c) {
    const t = c.victim;
    if (u < 0.28) {
      t.fightPose(c.eye());
      return;
    }
    // The chin forced up by the barrel, his hands on it.
    const k = span(u, 0.28, 0.36);
    t.turn('neck_01', 0, -0.3 * k);
    t.turn('head', 0, -0.35 * k);
    t.turn('spine_03', 0, -0.1 * k);
    const chin = t.headCentre().add(v(0, -0.25, 0)).addScaledVector(c.fwd, -0.18);
    t.reach('r', chin.clone().addScaledVector(c.right, 0.06), v(0, -1, 0).addScaledVector(c.right, -0.5));
    t.reach('l', chin.clone().addScaledVector(c.right, -0.03).add(v(0, -0.08, 0)), v(0, -1, 0).addScaledVector(c.right, 0.5));
    t.fist('l', 0.7);
    t.fist('r', 0.7);
  },
  events: [
    {
      t: 0.5,
      run(c) {
        const t = c.victim;
        const h = t.headCentre();
        c.fire();
        c.sound.blast();
        c.shake(1);
        c.hitstop(0.09);
        if (c.gore.level === 'full') {
          t.destroyHead();
          c.gore.burst(h, UP.clone().addScaledVector(c.fwd, 0.6), 160, 5, 0.45, 0.008);
          c.gore.chunks(h, UP.clone().addScaledVector(c.fwd, 0.5), 10);
          c.gore.spurt(t.bone('neck_01'), t.bone('head').getWorldPosition(new THREE.Vector3()), UP, 2.6, 120);
        } else c.gore.hit(h, UP, true, 1, 'head', t.bone('head'), c.eye());
      },
    },
  ],
  release: 0.55,
  onRelease: (c) => c.victim.endScript('fall', c.fwd, 2.6),
  focus: (_u, c) => c.victim.headCentre().add(v(0, -0.1, 0)),
};

export const KILL_MOVES: readonly KillMove[] = [RUN_THROUGH, DECAPITATE, NECK_SNAP, WALL_SLAM, STOMP, SHOTGUN_JAW];

/** A kill move that fits, weighted, not the last one played if there's another. */
export function pickKill(q: KillQuery, last: string | null, rand: () => number = Math.random): KillMove | null {
  let fit = KILL_MOVES.filter((k) => k.ok(q));
  if (fit.length > 1 && last) fit = fit.filter((k) => k.id !== last);
  if (fit.length === 0) return null;
  const total = fit.reduce((a, k) => a + k.weight, 0);
  let r = rand() * total;
  for (const k of fit) {
    r -= k.weight;
    if (r <= 0) return k;
  }
  return fit[fit.length - 1];
}

/** One kill move playing. */
export class KillRun {
  /** Share done. */
  u = 0;
  done = false;
  private fired = 0;
  private released = false;
  private readonly from: V3;
  private readonly fromYaw: number;
  private readonly to: V3 | null;
  private readonly toYaw: number;
  private readonly mackStart: V3;

  constructor(
    readonly def: KillMove,
    readonly c: KillCtx,
  ) {
    const t = c.victim;
    t.beginScript();
    this.from = t.root.position.clone();
    this.fromYaw = t.yaw;
    const eye = c.eye();
    this.mackStart = eye.clone();
    if (def.place) {
      const p = eye.clone().addScaledVector(c.fwd, def.place.ahead).addScaledVector(c.right, def.place.right);
      this.to = v(p.x, this.from.y, p.z);
    } else this.to = null;
    // Facing you.
    const at = this.to ?? this.from;
    this.toYaw = Math.atan2(eye.x - at.x, eye.z - at.z);
  }

  /** Advances it; returns your pose (or the gun's place), where to look, where your eyes are carried, and the
   * cinematic camera if any. */
  step(dt: number): { pose: MeleePose | null; gun: { pos: V3; quat: THREE.Quaternion } | null; focus: V3; mackAt: V3 | null; cine: { pos: V3; look: V3 } | null } {
    const d = this.def;
    this.u = Math.min(1, this.u + dt / d.time);
    const u = this.u;
    const t = this.c.victim;
    if (!this.released) {
      if (this.to) {
        const k = span(u, 0, 0.15);
        t.root.position.copy(this.from).lerp(this.to, k);
        let dy = this.toYaw - this.fromYaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        t.yaw = this.fromYaw + dy * k;
      } else if (!(d.id === 'stomp')) {
        let dy = this.toYaw - this.fromYaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        t.yaw = this.fromYaw + dy * span(u, 0, 0.15);
      }
      if (d.id !== 'stomp') t.resetPose();
      d.victim(u, this.c);
    }
    while (this.fired < d.events.length && d.events[this.fired].t <= u) {
      d.events[this.fired].run(this.c);
      this.fired++;
    }
    if (!this.released && u >= d.release) {
      this.released = true;
      d.onRelease(this.c);
    }
    if (u >= 1) this.done = true;
    return {
      pose: d.mack(u, this.c),
      gun: d.gun ? d.gun(u, this.c) : null,
      focus: d.focus(u, this.c),
      mackAt: d.mackAt ? d.mackAt(u, this.c, this.mackStart) : null,
      cine: d.cine ? d.cine(u, this.c) : null,
    };
  }
}
