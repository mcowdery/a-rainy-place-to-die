import * as THREE from 'three';
import { buildCigarette, buildLighter, LIGHTER_WICK, STICKS, type Cigarette, type StickKind } from './cigarette';

/**
 * Mack smoking (the first-person rig's, models/firstPerson.ts; real/smoke.ts draws the smoke): acted, not conjured.
 *
 * Lighting up takes both hands, so only with them free: the left goes into his jacket for a cigarette (or a cigar)
 * while the right goes to his pocket for the lighter; the left puts it to his lips, the right brings the flame to
 * its end, it catches as he draws on it, the lighter goes back to the pocket and the left hand takes the cigarette
 * down as he breathes the first of it out.
 *
 * Lit, it's in his left hand, held low at his side; every so often the hand brings it up for a drag and takes it
 * down again, and then the smoke comes out. When the left hand is wanted for something else (a gun drawn, the
 * fists up, a bike's bars, a wheel), it goes up to his mouth once more and stays between his lips, where he puffs
 * at it now and then without his hands; the hand takes it back when it's free again. It burns down as it's smoked.
 * Done with it (or asked to), he takes it and flicks it away: it flies, lands and goes out.
 */

export interface ArmBones {
  readonly upper: THREE.Bone;
  readonly lower: THREE.Bone;
  readonly hand: THREE.Bone;
  /** Index, middle, ring, little: each from the knuckle to the last joint. */
  readonly fingers: THREE.Bone[][];
  readonly thumb: THREE.Bone[];
}

/** The rig's hands, lent for this (its own posing: two-bone reach, the hand turned, the fingers closed). */
export interface Hands {
  arm(side: 'l' | 'r'): ArmBones;
  /** The arm back to rest, to pose it afresh this frame. */
  reset(side: 'l' | 'r'): void;
  reach(side: 'l' | 'r', wrist: THREE.Vector3, pole: THREE.Vector3): void;
  orient(side: 'l' | 'r', fwd: THREE.Vector3, palm: THREE.Vector3): void;
  relax(side: 'l' | 'r', amount: number, table?: readonly (readonly number[])[]): void;
  /** The hand's frame now (world): wrist to knuckles, and the way its palm faces. */
  frame(side: 'l' | 'r'): { fwd: THREE.Vector3; palm: THREE.Vector3 };
}

/** A frame of the rig, as this needs it. */
export interface SmokeCtx {
  readonly dt: number;
  /** His eyes (the camera), the view's turn (three's camera frame: -z forward), and the heading's sine and cosine. */
  readonly eye: THREE.Vector3;
  readonly viewQ: THREE.Quaternion;
  readonly fx: number;
  readonly fz: number;
  readonly floor: number;
  /** His size against the model's. */
  readonly sc: number;
  /** Both hands free: on foot, nothing drawn, no fists up. */
  readonly free: boolean;
  /** Standing still. */
  readonly idle: boolean;
  /** Running: he throws away what he's smoking, and doesn't light up. */
  readonly running: boolean;
  /** How far down he is on his heels (0-1): the rig's own arms are then across his knees. */
  readonly squat: number;
  /** The face's frame when the head is shown (third person); null in first person, where the camera is his eyes. */
  readonly face: { readonly eye: THREE.Vector3; readonly fwd: THREE.Vector3; readonly up: THREE.Vector3 } | null;
}

/** What the smoke needs to know each frame (real/smoke.ts MackSmoke). */
export interface SmokeOut {
  /** Something's burning, and what. */
  lit: boolean;
  kind: StickKind;
  /** The lit end (world), and how hot the ember is (0 out, ~0.3 idling, 1 on a drag). */
  readonly tip: THREE.Vector3;
  heat: number;
  /** His mouth (world), the way his breath goes, and how hard smoke is coming out of it (0-1). */
  readonly mouth: THREE.Vector3;
  readonly way: THREE.Vector3;
  breath: number;
  /** The lighter's flame (0-1) and where it stands. */
  flame: number;
  readonly flameAt: THREE.Vector3;
}

/** Lighting up (s): hands at the pockets, the cigarette up at the lips, the flame, when it catches, the lighter away, the cigarette down. */
const LIGHT = { pocket: 0.55, up: 1.2, flame: [1.35, 2.2], catches: 1.6, away: 2.85, done: 3.25, lower: [2.35, 2.95] } as const;
/** A drag (s): the hand up, the drag, the hand down, a moment's hold, the breath out. */
const ROUND = { rise: 0.6, drag: 1.25, fall: 0.6, hold: 0.3, out: 1.6 } as const;
const ROUND_ALL = ROUND.rise + ROUND.drag + ROUND.fall + ROUND.hold + ROUND.out;
/** Seconds between drags (between the two), and how long one lasts before it's down to the stub. */
const EVERY: Record<StickKind, readonly [number, number]> = { cigarette: [8, 13], cigar: [15, 22] };
const BURNS: Record<StickKind, number> = { cigarette: 300, cigar: 900 };
/** The fingers round a cigarette: the first two nearly straight with it between them, the others curled away. */
const TWO_FINGERS = [[0.2, 0.34, 0.16], [0.26, 0.4, 0.2], [0.5, 0.72, 0.36], [0.6, 0.82, 0.42]] as const;
/** Left to himself, how long before he lights one (s of standing about; walking counts a quarter): the first, and between one and the next. */
const AUTO = { first: 6, again: [35, 110] } as const;
/** The mouth from the eyes (m at the model's size): down, and out of the face. */
const MOUTH = { down: 0.068, out: 0.026 } as const;

const ease = (a: number, b: number, v: number): number => {
  const k = THREE.MathUtils.clamp((v - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

export class Smoking {
  /** The cigarette and the lighter (world space: the rig adds it to its own object, which stays at the origin). */
  readonly group = new THREE.Group();
  readonly out: SmokeOut = { lit: false, kind: 'cigarette', tip: new THREE.Vector3(), heat: 0, mouth: new THREE.Vector3(), way: new THREE.Vector3(0, 0, 1), breath: 0, flame: 0, flameAt: new THREE.Vector3() };
  /** Whether both hands were free last frame (lighting up needs them). */
  free = false;
  /** What he lights by himself when he's left standing about with his hands free (null: only when asked). */
  auto: StickKind | null = null;
  private autoWait: number = AUTO.first;
  private readonly sticks: Partial<Record<StickKind, Cigarette>> = {};
  private readonly lighter = buildLighter();
  private kind: StickKind = 'cigarette';
  private stage: 'none' | 'light' | 'lit' | 'flick' = 'none';
  private t = 0;
  private inHand = false;
  /** How much the left arm is this act's (0: the rig's own pose), and the right (lighting). */
  private oursL = 0;
  private oursR = 0;
  /** The left hand: how far up at the mouth, and at the pocket. */
  private lift = 0;
  private pocket = 0;
  /** The right hand: from the pocket (0) to the cigarette's end with the flame (1). */
  private flameUp = 0;
  private toLips = 0;
  private round = -1;
  private wait = 0;
  /** What's to be lit once the one just flicked has left his hand, and whether he's running (from the last pose). */
  private next: StickKind | null = null;
  private running = false;
  /** Still lighting up (the page says so when it's asked for another). */
  get lighting(): boolean {
    return this.stage === 'light';
  }
  private burnt = 0;
  private heat = 0;
  private breath = 0;
  private flame = 0;
  private stickShown = false;
  private lighterShown = false;
  /** Flicked away: where it is, how it's moving and how long it has left. */
  private butt: { readonly pos: THREE.Vector3; readonly vel: THREE.Vector3; readonly axis: THREE.Vector3; life: number } | null = null;
  private flickFrom = 0;
  private seed = 0.37;

  constructor(private readonly hands: Hands) {
    this.group.name = 'smoking';
    this.lighter.visible = false;
    this.group.add(this.lighter);
  }

  /** What he has lit (or is lighting), if anything. */
  get what(): StickKind | null {
    return this.stage === 'none' ? null : this.kind;
  }

  /** Where it is: in his left hand, or between his lips. */
  get held(): 'hand' | 'lips' | null {
    return this.stage === 'none' ? null : this.inHand ? 'hand' : 'lips';
  }

  /**
   * Lights one up, if he has nothing lit and both hands are free (and he isn't running: he'd throw it away). With
   * the last one only just flicked away (it lies glowing for some seconds, and until it was out a press did
   * nothing: the user had to keep hitting the key), the next is lit as soon as that one has left his hand.
   */
  light(kind: StickKind): boolean {
    if (this.stage === 'flick') {
      this.next = kind;
      return true;
    }
    if (this.stage !== 'none' || !this.free || this.running) return false;
    this.next = null;
    this.kind = kind;
    this.stage = 'light';
    this.t = 0;
    this.burnt = 0;
    this.heat = 0;
    this.inHand = true;
    this.round = -1;
    this.butt = null;
    return true;
  }

  /** Flicks it away. */
  flick(): boolean {
    if (this.stage !== 'lit') return false;
    this.stage = 'flick';
    this.t = 0;
    this.flickFrom = this.inHand ? 0 : 0.45;
    return true;
  }

  /** A change of clothes (the rig's takeOver): what he was smoking, as far as it had burnt, in the hand or the lips. */
  takeOver(old: Smoking): void {
    if (old.stage !== 'lit') return;
    this.kind = old.kind;
    this.stage = 'lit';
    this.inHand = old.inHand;
    this.burnt = old.burnt;
    this.round = -1;
    this.wait = old.wait;
    this.heat = 0.3;
  }

  private stick(): Cigarette {
    let s = this.sticks[this.kind];
    if (!s) {
      s = this.sticks[this.kind] = buildCigarette(this.kind);
      this.group.add(s.root);
    }
    return s;
  }

  private every(): number {
    const [a, b] = EVERY[this.kind];
    this.seed = (this.seed * 7.13 + 0.31) % 1;
    return a + (b - a) * this.seed;
  }

  /** His mouth (world): from the face when the head is shown, else from the camera, which is his eyes. */
  private mouthOf(c: SmokeCtx, out: THREE.Vector3): THREE.Vector3 {
    if (c.face) return out.copy(c.face.eye).addScaledVector(c.face.up, -MOUTH.down * c.sc).addScaledVector(c.face.fwd, MOUTH.out * c.sc);
    return out.set(0, -MOUTH.down * c.sc, -MOUTH.out * c.sc).applyQuaternion(c.viewQ).add(c.eye);
  }

  /** The act moves on, and the arms it needs are posed (before the rig's shadow copies them). */
  pose(c: SmokeCtx): void {
    this.free = c.free;
    this.running = c.running;
    if (this.stage === 'none') {
      // Left to himself he lights one before long: sooner standing about than on the move.
      if (this.auto && c.free && !c.running) {
        this.autoWait -= c.dt * (c.idle ? 1 : 0.25);
        if (this.autoWait <= 0) this.light(this.auto);
      }
      return;
    }
    const dt = c.dt;
    // Breaking into a run, he throws it away (the user, 2026-10-06); one he was still lighting goes back unlit.
    if (c.running) {
      if (this.stage === 'light' && this.t < LIGHT.catches) {
        this.stage = 'none';
        this.oursL = this.oursR = 0;
        this.autoWait = Math.max(this.autoWait, 8);
        return;
      }
      if (this.stage === 'light') this.stage = 'lit';
      this.flick();
    }
    this.t += dt;
    let wantL = 0;
    let wantR = 0;
    let lift = 0;
    let pocket = 0;
    let flameUp = 0;
    let drag = 0;
    this.breath = 0;
    this.flame = 0;
    this.lighterShown = false;
    this.stickShown = true;
    if (this.stage === 'light') {
      const t = this.t;
      wantL = 1;
      pocket = 1 - ease(LIGHT.pocket, LIGHT.up, t);
      lift = ease(LIGHT.pocket, LIGHT.up, t) * (1 - ease(LIGHT.lower[0], LIGHT.lower[1], t));
      this.stickShown = t >= LIGHT.pocket * 0.85;
      wantR = t < LIGHT.away ? 1 : 0;
      flameUp = ease(LIGHT.pocket + 0.1, LIGHT.up + 0.12, t) * (1 - ease(LIGHT.flame[1], LIGHT.away - 0.1, t));
      this.lighterShown = t > LIGHT.pocket * 0.85 && t < LIGHT.away - 0.05;
      this.flame = ease(LIGHT.flame[0], LIGHT.flame[0] + 0.1, t) * (1 - ease(LIGHT.flame[1] - 0.08, LIGHT.flame[1], t));
      drag = ease(LIGHT.catches, LIGHT.catches + 0.3, t) * (1 - ease(LIGHT.lower[0] - 0.1, LIGHT.lower[0] + 0.6, t));
      this.heat = t < LIGHT.catches ? 0 : 0.3 + 0.7 * drag;
      this.breath = ease(LIGHT.lower[0] + 0.3, LIGHT.lower[0] + 0.6, t) * (1 - ease(LIGHT.lower[0] + 1.5, LIGHT.lower[0] + 1.9, t));
      if (t >= LIGHT.lower[0] + 1.9) {
        this.stage = 'lit';
        this.wait = this.every();
      }
    } else if (this.stage === 'lit') {
      this.burnt += dt / BURNS[this.kind];
      if (this.round >= 0) this.round += dt;
      else {
        // (His hand free again with it in his lips: it's taken at the next drag, and that comes soon.)
        if (!this.inHand && c.free) this.wait = Math.min(this.wait, 1.2);
        this.wait -= dt;
        if (this.wait <= 0) this.round = 0;
      }
      const r = this.round;
      if (r >= 0) {
        drag = ease(ROUND.rise - 0.1, ROUND.rise + 0.3, r) * (1 - ease(ROUND.rise + ROUND.drag - 0.2, ROUND.rise + ROUND.drag + 0.7, r));
        const o = ROUND.rise + ROUND.drag + ROUND.fall + ROUND.hold;
        this.breath = ease(o - 0.1, o + 0.2, r) * (1 - ease(o + ROUND.out - 0.4, o + ROUND.out, r));
        if (r >= ROUND_ALL) {
          this.round = -1;
          this.wait = this.every();
        }
      }
      const up = r >= 0 ? ease(0, ROUND.rise, r) * (1 - ease(ROUND.rise + ROUND.drag, ROUND.rise + ROUND.drag + ROUND.fall, r)) : 0;
      if (this.inHand) {
        wantL = 1;
        lift = up;
        if (c.free) this.toLips = Math.max(0, this.toLips - dt / 0.35);
        else {
          // The hand's wanted: up to his lips with it, and it stays there.
          this.toLips = Math.min(1, this.toLips + dt / 0.38);
          lift = Math.max(lift, ease(0, 1, this.toLips));
          if (this.toLips >= 1) {
            this.inHand = false;
            this.toLips = 0;
          }
        }
      } else if (c.free && r >= 0 && r < ROUND.rise + ROUND.drag) {
        // The hand comes up for it as the drag begins, and has it from then.
        wantL = 1;
        lift = 1;
        if (r >= ROUND.rise && this.oursL > 0.95) this.inHand = true;
      }
      this.heat = 0.3 + 0.7 * drag;
      if (this.burnt >= 1) this.flick();
    } else {
      // Flicked away: taken from the lips if it's there, the hand out low, a snap of the fingers, and it's gone.
      const t = this.t;
      const T = this.flickFrom;
      if (!this.butt) {
        wantL = 1;
        lift = t < T ? 1 : 1 - ease(T, T + 0.3, t);
        if (t >= T && this.oursL > 0.9) this.inHand = true;
        if (t >= T + 0.34 && this.inHand) {
          const s = this.stick();
          const axis = Z.clone().applyQuaternion(s.root.quaternion);
          // (Forward and to the left of where he faces, a little up.)
          this.butt = { pos: s.root.position.clone(), vel: new THREE.Vector3(c.fx * 2.6 + c.fz * 0.9, 1.5, c.fz * 2.6 - c.fx * 0.9), axis, life: 6 };
          this.inHand = false;
        }
        this.heat = 0.3;
      } else {
        wantL = t < T + 0.5 ? 1 : 0;
        this.butt.life -= dt;
        // (Another asked for meanwhile: once the hand's back, the stub's forgotten and the next is lit.)
        if (this.next && this.oursL < 0.25 && c.free && !c.running) {
          const kind = this.next;
          this.stage = 'none';
          this.butt = null;
          this.heat = 0;
          this.light(kind);
          return;
        }
        this.heat = 0.3 * THREE.MathUtils.clamp(this.butt.life / 2.5, 0, 1);
        if (this.butt.life <= 0 && this.oursL < 0.02) {
          this.seed = (this.seed * 7.13 + 0.31) % 1;
          this.autoWait = AUTO.again[0] + (AUTO.again[1] - AUTO.again[0]) * this.seed;
          this.stage = 'none';
          this.butt = null;
          this.heat = 0;
        }
      }
    }
    this.oursL += (wantL - this.oursL) * Math.min(1, dt * (wantL > this.oursL ? 9 : 7));
    this.oursR += (wantR - this.oursR) * Math.min(1, dt * 8);
    this.lift = lift;
    this.pocket = pocket;
    this.flameUp = flameUp;
    if (this.oursL > 0.004) this.poseLeft(c);
    if (this.oursR > 0.004) this.poseRight(c);
  }

  private poseLeft(c: SmokeCtx): void {
    const H = this.hands;
    const arm = H.arm('l');
    // Where the rig had the hand this frame (its own pose), to ease out of and back into.
    const usual = arm.hand.getWorldPosition(new THREE.Vector3());
    const usualF = H.frame('l');
    const fwdH = new THREE.Vector3(c.fx, 0, c.fz);
    const right = new THREE.Vector3(-c.fz, 0, c.fx);
    const behind = fwdH.clone().negate();
    // His mouth as the head has it when the head's shown (third person, where the camera's eyes and his own part
    // company: squatting, his back leant over his knees; the head nodding): the hand went to where the view put his
    // mouth while the cigarette went to his lips, and at each drag the two were apart (the user's report).
    const mouth = this.mouthOf(c, new THREE.Vector3());
    const viewF = c.face ? c.face.fwd.clone() : new THREE.Vector3(0, 0, -1).applyQuaternion(c.viewQ);
    H.reset('l');
    const S = arm.upper.getWorldPosition(new THREE.Vector3());
    // Held low: the arm hanging at his side as it does anyway (going with its swing as he walks), only a little
    // more bent and the hand a little forward of the thigh, or across his knee when he squats; at his lips (the
    // wrist below and in front of them, the fingers up); in his jacket (the hand across to the left of his chest).
    const low = S.clone().addScaledVector(UP, -0.535 * c.sc).addScaledVector(right, -0.075).addScaledVector(fwdH, 0.075).lerp(usual, 0.45).lerp(usual.clone().addScaledVector(UP, 0.02), c.squat);
    const flick = this.stage === 'flick' ? ease(this.flickFrom, this.flickFrom + 0.3, this.t) : 0;
    low.addScaledVector(fwdH, 0.14 * flick).addScaledVector(UP, 0.1 * flick);
    const atMouth = mouth.clone().addScaledVector(UP, -0.1 * c.sc).addScaledVector(right, -0.03).addScaledVector(viewF, 0.07);
    const inJacket = S.clone().addScaledVector(UP, -0.18 * c.sc).addScaledVector(right, 0.12).addScaledVector(fwdH, 0.13);
    const f = (fwd: THREE.Vector3, palm: THREE.Vector3): { fwd: THREE.Vector3; palm: THREE.Vector3 } => ({ fwd: fwd.normalize(), palm: palm.normalize() });
    const mix = (a: { fwd: THREE.Vector3; palm: THREE.Vector3 }, b: { fwd: THREE.Vector3; palm: THREE.Vector3 }, k: number): { fwd: THREE.Vector3; palm: THREE.Vector3 } => f(a.fwd.clone().lerp(b.fwd, k), a.palm.clone().lerp(b.palm, k));
    // (The fingers down, the palm to the back and in toward the thigh: the lit end out ahead, away from his leg.)
    const lowF = mix(f(new THREE.Vector3().addScaledVector(UP, -1).addScaledVector(fwdH, 0.14), new THREE.Vector3().addScaledVector(behind, 0.8).addScaledVector(right, 0.55)), usualF, c.squat);
    const mouthF = f(new THREE.Vector3().addScaledVector(UP, 0.85).addScaledVector(right, 0.4), behind.clone().addScaledVector(UP, 0.15));
    const jacketF = f(new THREE.Vector3().addScaledVector(right, 0.85).addScaledVector(UP, -0.4), behind.clone());
    const wrist = low.clone().lerp(atMouth, this.lift).lerp(inJacket, this.pocket).lerp(usual, 1 - this.oursL);
    const frame = mix(usualF, mix(mix(lowF, mouthF, this.lift), jacketF, this.pocket), this.oursL);
    // The elbow: back, as a hanging arm's is; up at his mouth, down and out to the side.
    const poleUp = Math.max(this.lift, this.pocket);
    const pole = new THREE.Vector3().addScaledVector(behind, 1).addScaledVector(right, -0.3).normalize().lerp(new THREE.Vector3().addScaledVector(UP, -1).addScaledVector(right, -0.85).addScaledVector(behind, 0.15).normalize(), poleUp).normalize();
    const put = (at: THREE.Vector3): void => {
      H.reset('l');
      H.reach('l', at, pole);
      H.orient('l', frame.fwd, frame.palm);
      H.relax('l', 1, this.oursL > 0.5 ? TWO_FINGERS : undefined);
    };
    put(wrist);
    // At the lips, its mouth end is brought exactly to them: the hand moved by however far it was off.
    const k = this.lift * (1 - this.pocket) * this.oursL;
    if (k > 0.02) {
      const g = this.gripPoint(c);
      put(wrist.addScaledVector(mouth.clone().sub(g.foot), k));
    }
  }

  /** Where the fingers have it (between the first two, past their last joints), and its mouth end from there. */
  private gripPoint(c: SmokeCtx): { foot: THREE.Vector3; axis: THREE.Vector3 } {
    const arm = this.hands.arm('l');
    arm.hand.updateWorldMatrix(true, true);
    // (Between the first two fingers' middle bones, not out at their tips.)
    const p = (f: number, i: number): THREE.Vector3 => arm.fingers[f][i].getWorldPosition(new THREE.Vector3());
    const { palm } = this.hands.frame('l');
    const g = p(0, 1).add(p(0, 2)).add(p(1, 1)).add(p(1, 2)).multiplyScalar(0.25);
    // (Its mouth end on the palm's side, the lit end out past the back of the hand.)
    return { foot: g.addScaledVector(palm, STICKS[this.kind].grip * c.sc), axis: palm.clone().negate() };
  }

  private poseRight(c: SmokeCtx): void {
    const H = this.hands;
    const arm = H.arm('r');
    const usual = arm.hand.getWorldPosition(new THREE.Vector3());
    const usualF = H.frame('r');
    const fwdH = new THREE.Vector3(c.fx, 0, c.fz);
    const right = new THREE.Vector3(-c.fz, 0, c.fx);
    const behind = fwdH.clone().negate();
    const mouth = this.mouthOf(c, new THREE.Vector3());
    const viewF = c.face ? c.face.fwd.clone() : new THREE.Vector3(0, 0, -1).applyQuaternion(c.viewQ);
    H.reset('r');
    const S = arm.upper.getWorldPosition(new THREE.Vector3());
    // In his pocket, by the hip; and with the flame at the cigarette's end: the fist under it, the thumb on the wheel.
    const inPocket = S.clone().addScaledVector(UP, -0.5 * c.sc).addScaledVector(right, 0.1).addScaledVector(fwdH, 0.03);
    const end = mouth.clone().addScaledVector(viewF, STICKS[this.kind].len * c.sc + 0.012);
    const fwd = new THREE.Vector3().addScaledVector(UP, 0.9).addScaledVector(fwdH, 0.2).addScaledVector(right, -0.2).normalize();
    const palm = new THREE.Vector3().addScaledVector(right, -0.8).addScaledVector(behind, 0.55).normalize();
    const atEnd = end.clone().addScaledVector(UP, -0.064 * c.sc).addScaledVector(fwd, -0.08 * c.sc).addScaledVector(palm, -0.03 * c.sc);
    const pocketF = { fwd: new THREE.Vector3(0, -1, 0).addScaledVector(fwdH, 0.15).normalize(), palm: right.clone().negate() };
    const k = this.flameUp;
    const wrist = inPocket.clone().lerp(atEnd, k).lerp(usual, 1 - this.oursR);
    const to = { fwd: pocketF.fwd.clone().lerp(fwd, k).normalize(), palm: pocketF.palm.clone().lerp(palm, k).normalize() };
    const frame = { fwd: usualF.fwd.clone().lerp(to.fwd, this.oursR).normalize(), palm: usualF.palm.clone().lerp(to.palm, this.oursR).normalize() };
    const pole = new THREE.Vector3().addScaledVector(UP, -1).addScaledVector(right, 0.75).addScaledVector(behind, 0.3).normalize();
    H.reach('r', wrist, pole);
    H.orient('r', frame.fwd, frame.palm);
    // (Closed round the lighter.)
    H.relax('r', 1 + 0.9 * this.oursR);
  }

  /** The cigarette and the lighter put where the hands (or his lips) have them, and what the smoke needs (after the head is posed). */
  place(c: SmokeCtx): void {
    const o = this.out;
    o.lit = false;
    o.flame = 0;
    o.breath = 0;
    if (this.stage === 'none') {
      for (const s of Object.values(this.sticks)) s.root.visible = false;
      this.lighter.visible = false;
      return;
    }
    const s = this.stick();
    for (const other of Object.values(this.sticks)) other.root.visible = other === s && this.stickShown;
    const mouth = this.mouthOf(c, o.mouth);
    const faceF = c.face ? c.face.fwd.clone() : new THREE.Vector3(0, 0, -1).applyQuaternion(c.viewQ);
    const faceUp = c.face ? c.face.up.clone() : new THREE.Vector3(0, 1, 0).applyQuaternion(c.viewQ);
    o.way.copy(faceF).addScaledVector(faceUp, -0.14).normalize();
    let foot: THREE.Vector3;
    let axis: THREE.Vector3;
    if (this.butt) {
      // Flying, then lying where it fell.
      const b = this.butt;
      const ground = c.floor + 0.006;
      if (b.pos.y > ground || b.vel.y > 0) {
        b.vel.y -= 9.8 * c.dt;
        b.pos.addScaledVector(b.vel, c.dt);
        b.axis.applyAxisAngle(new THREE.Vector3(c.fz, 0, -c.fx), -9 * c.dt).normalize();
        if (b.pos.y <= ground) {
          b.pos.y = ground;
          b.vel.set(b.vel.x * 0.35, Math.abs(b.vel.y) > 1.2 ? -b.vel.y * 0.25 : 0, b.vel.z * 0.35);
          if (b.vel.y === 0) b.axis.setY(0).normalize();
        }
      } else b.pos.addScaledVector(b.vel.multiplyScalar(Math.max(0, 1 - 6 * c.dt)), c.dt);
      foot = b.pos;
      axis = b.axis;
    } else if (this.inHand) {
      const g = this.gripPoint(c);
      // (At his lips, it's in them: its mouth end on the mouth as the head has it, pointing out of the face.)
      const at = this.lift * (1 - this.pocket);
      foot = g.foot.lerp(mouth, at);
      axis = g.axis.lerp(o.way, at).normalize();
    } else {
      // Between his lips, drooping a little, toward the left of his mouth.
      foot = mouth.clone();
      axis = o.way.clone().addScaledVector(faceUp, -0.1).normalize();
    }
    s.set(this.burnt, this.heat);
    s.root.position.copy(foot);
    s.root.quaternion.setFromUnitVectors(Z, axis);
    s.root.scale.setScalar(c.sc);
    o.kind = this.kind;
    o.lit = this.heat > 0.02 && this.stickShown;
    o.heat = this.heat;
    o.tip.copy(foot).addScaledVector(axis, s.length() * c.sc);
    o.breath = this.breath;
    // The lighter in his right fist, upright, its flame at the cigarette's end.
    this.lighter.visible = this.lighterShown;
    if (this.lighterShown) {
      const arm = this.hands.arm('r');
      const { fwd, palm } = this.hands.frame('r');
      const at = arm.hand.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 0.08 * c.sc).addScaledVector(palm, 0.03 * c.sc);
      const x = new THREE.Vector3().crossVectors(UP, palm).normalize();
      this.lighter.position.copy(at);
      this.lighter.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, UP, new THREE.Vector3().crossVectors(x, UP)));
      this.lighter.scale.setScalar(c.sc);
      o.flame = this.flame;
      o.flameAt.copy(LIGHTER_WICK).multiplyScalar(c.sc).applyQuaternion(this.lighter.quaternion).add(at);
    }
  }
}
