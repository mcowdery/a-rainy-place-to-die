import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Bike } from '../poc3d/models/bikeKit';
import { setCharacterEnvironment } from '../poc3d/models/characters';
import type { FirstPersonRig } from '../poc3d/models/firstPerson';
import { loadDressed } from '../poc3d/models/wardrobe';
import { CabinMotion, cockpitLayout, deadPedal, padAt, pedalsOf, shifterOf, type CarInterior, type CockpitLayout, type Pedal } from '../poc3d/models/carInterior';
import { rollWindows, type CarView } from './carView';
import { nearestShot, sideFor, type Side } from './shooting';

/**
 * Mack at the wheel of your car (models/firstPerson.ts), on the race page and in the city: seated with his eyes at
 * the driver's eyes of that car's cabin (models/carInterior.ts' `cockpitLayout`, right-hand drive), feet to the
 * pedals, both hands on its steering wheel. He moves as the cabin's controls move (models/carInterior.ts'
 * `CabinMotion`, the cabin's own when the page shares it: `cabin`): the wheel turning at a hand's pace and stopping
 * short of crossing his arms; his right foot over the throttle, across to the brake when he brakes and back; and
 * through a gear change (a manual's every change, a floor automatic's drive and reverse) his left hand off the rim
 * to the lever's knob and back, his left foot off the dead pedal onto the clutch in a manual; the same hand to the
 * handbrake when it's pulled. In ordinary driving (`DriveView.calm`: the city) he drives as people do: the left
 * hand resting on the lever between changes, the right up the rim toward the top; both hands back at quarter to
 * three whenever the driving asks for them. Raising his gun takes the right hand off the wheel: down to his belt
 * for it (it's drawn, and put back there after: models/firstPerson.ts), then his whole arm straight from the
 * shoulder at what you aim at, as on a bike: out of the driver's window to that side, or across the car at the
 * passenger window, the gun inside. He leans to his window to shoot from it, and right out of it to shoot nearly
 * ahead (`eyeShift`: the cameras at his eyes go with him). Aimed nearer straight ahead than that allows, his arm
 * would be inside the car with the gun at the windscreen: that's no line of fire (`outFrom`, `driverLine`), and he
 * pulls the gun back in and holds it by his chest (`DriveView.blocked`).
 * The window rolls down first and back up after. The other
 * weapons' arm (shooting.ts) still rolls the windows. Shown with his head except in the driver's-eye view.
 */

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** The car's frame to the seat's (the car's turned half round, so -z is forward and +x the driver's right, as a bike's). */
const toSeat = (p: THREE.Vector3): THREE.Vector3 => v(-p.x, p.y, -p.z);
/** How fast a window winds (fraction a second), and how long after the gun's down it waits to wind up (s). */
const WIND = 3;
const WIND_UP_AFTER = 1.5;
/** Shooting out of his window he leans to it: his eyes (and all above the seat) this far toward the door and forward (right-hand drive: -x). */
const LEAN = new THREE.Vector3(-0.17, -0.01, 0.09);
/**
 * Aiming near straight ahead out of it he leans right out, his head and shoulder in the window's opening, so his
 * straight arm is past the door nearer to ahead: right out within the first of `OUT_WITHIN` (rad from ahead), only
 * to `LEAN` past the second.
 */
const LEAN_OUT = new THREE.Vector3(-0.3, 0.02, 0.15);
const OUT_WITHIN = [0.5, 0.95] as const;
/** How far outside the cabin's inside width his gun hand has to be to be clear of the door's skin and glass (m). */
const SKIN = 0.08;

/**
 * Where a shot at (rel, pitch) from the driver's seat goes (race/shooting.ts `sideFor`, right-hand drive: rel
 * positive to the left), for a driver whose arm swings from his shoulder: out of his own window only from `outFrom`
 * to its side of straight ahead (nearer ahead than that the gun's inside the car, pointing through the windscreen:
 * no line of fire); and where the gun waits while there's no shot (the nearest it has).
 */
export function driverLine(rel: number, pitch: number, outFrom: number): { side: Side | null; wait: { rel: number; pitch: number; side: Side } } {
  const r = Math.atan2(Math.sin(rel), Math.cos(rel));
  const open = sideFor(r, pitch);
  const n = nearestShot(r, pitch);
  return { side: open === 'driver' && r > -outFrom ? null : open, wait: n.side === 'driver' && n.rel > -outFrom ? { rel: -outFrom, pitch, side: 'driver' } : n };
}
const ENV_GAIN = 0.35;

export interface DriveView {
  /** The gun's up (aimed or fired from the hip) and Mack's to hold (the shotgun). */
  readonly raised: boolean;
  /** Raised, but there's no line of fire where he aims (the windscreen): he pulls the gun back in and holds it by his shoulder. */
  readonly blocked?: boolean;
  /** Any weapon out of a window (for the windows): which. */
  readonly window: 'driver' | 'across' | null;
  /** What he aims at. */
  readonly aimPoint: THREE.Vector3 | null;
  /** 0 outside, 1 the driver's-eye view (his head folded away). */
  readonly pov: number;
  /** The pedals as they're pressed (0-1), for his feet. */
  readonly throttle?: number;
  readonly brake?: number;
  /** Ordinary driving, not racing: he may drive one-handed (models/carInterior.ts `DriverInput.calm`). */
  readonly calm?: boolean;
  /**
   * The page's camera while the view is from his eyes (the cab): what's at his face (a cigarette between his lips,
   * the hand that brings it there: models/smoking.ts) goes where his head is turned, not where the seat faces.
   */
  readonly view?: THREE.Camera | null;
}

const smooth = (k: number): number => k * k * (3 - 2 * k);
/** How far round the rim's section from its near face the palm lies (rad): on its near, outer quarter. */
const GRIP = 0.85;

/** What the driver needs of the car: its road wheels' angle (rad, positive left), its heading and its gear. */
export interface Steered {
  readonly steer: number;
  readonly h: number;
  readonly gear?: number;
  /** Its forward speed (m/s), how far it's sliding (rad) and whether the handbrake's on: for how he sits to it. */
  readonly u?: number;
  readonly slide?: number;
  readonly handbrake?: boolean;
}

export class CarDriver {
  rig: FirstPersonRig | null = null;
  readonly mount: Bike;
  readonly layout: CockpitLayout;
  private readonly seat = new THREE.Group();
  private readonly wheelAxis: THREE.Vector3;
  private readonly eye = new THREE.PerspectiveCamera();
  private shots = 0;
  private winL = 0;
  private winR = 0;
  private sinceL = 99;
  private sinceR = 99;
  private wasRaised = false;
  /** The car's cabin, when the page has one: he moves as its controls do, and works its gear lever. */
  cabin: CarInterior | null = null;
  /** The controls' motion without a cabin to share it with. */
  private readonly own: CabinMotion;
  private readonly pedals: Pedal[];
  private readonly rest: THREE.Vector3;
  private readonly knob = new THREE.Vector3();
  private readonly lever = new THREE.Vector3();
  /** The right hand's grip for where it is up the rim (the steering's frame): set by `rightGrip`. */
  private readonly rim: { c: THREE.Vector3; r: number; up: THREE.Vector3; across: THREE.Vector3; away: THREE.Vector3 };
  /**
   * How far to his window's side of straight ahead he must aim for his gun to be out of it (rad). His arm swings
   * whole from the shoulder at what he aims at; nearer ahead than this the gun would be inside the car, pointing
   * through the windscreen, so there's no shot (`driverLine`).
   */
  outFrom = 0.33;
  /** How far he's leaning to that window (0-1), and where that puts his eyes from the seat's (the car's frame: for the camera). */
  private lean = 0;
  /** Seconds since his gun was last up (it takes a moment to put away). */
  private gunAway = 99;
  private leanOut = 0;
  readonly eyeShift = new THREE.Vector3();

  private constructor(private readonly view: CarView) {
    const L = (this.layout = cockpitLayout(view.type));
    const WHEEL_C = toSeat(L.wheel.c);
    const WHEEL_N = (this.wheelAxis = toSeat(L.wheel.axis));
    const WHEEL_UP = toSeat(L.wheel.up);
    const WHEEL_R = L.wheel.r;
    this.seat.rotation.y = Math.PI;
    view.obj.add(this.seat);
    const steer = new THREE.Group();
    steer.position.copy(WHEEL_C);
    const inner = new THREE.Group();
    inner.position.copy(WHEEL_C).negate();
    steer.add(inner);
    this.seat.add(steer);
    const across = new THREE.Vector3().crossVectors(WHEEL_UP, WHEEL_N).normalize();
    // Into the dash, down the column (whichever way the layout's axis points).
    const away = WHEEL_N.clone().multiplyScalar(Math.sign(WHEEL_N.dot(WHEEL_C.clone().sub(toSeat(L.eye)))) || 1);
    // Each hand on the rim from the driver's side: the palm on its near, outer quarter (facing into the dash and in
    // toward the hub), the fingers out over its edge and round behind it, the thumb hooked round its inside.
    const palmOf = (out: THREE.Vector3): THREE.Vector3 => away.clone().multiplyScalar(Math.cos(GRIP)).addScaledVector(out, -Math.sin(GRIP)).normalize();
    const fwdOf = (out: THREE.Vector3): THREE.Vector3 => away.clone().multiplyScalar(Math.sin(GRIP)).addScaledVector(out, Math.cos(GRIP)).normalize();
    const outL = across.clone();
    const outR = across.clone().negate();
    this.rim = { c: WHEEL_C.clone(), r: WHEEL_R, up: WHEEL_UP.clone().normalize(), across: across.clone(), away: away.clone() };
    const dummy = new THREE.MeshStandardMaterial();
    this.pedals = pedalsOf(view.type);
    this.rest = deadPedal(view.type);
    this.own = new CabinMotion(shifterOf(view.type));
    this.mount = {
      root: this.seat,
      steer,
      steerAxis: WHEEL_N.clone(),
      frontWheel: new THREE.Group(),
      rearWheel: new THREE.Group(),
      wheelRadius: { front: 0.3, rear: 0.3 },
      rider: {
        seat: v(-L.side, L.seat.y + 0.06, -L.seat.z),
        // Quarter to three: the rim either side of the hub (`across` points to his left), its tangent up the wheel,
        // each palm toward the hub.
        gripL: WHEEL_C.clone().addScaledVector(across, WHEEL_R),
        gripR: WHEEL_C.clone().addScaledVector(across, -WHEEL_R),
        gripAxisL: WHEEL_UP.clone(),
        gripAxisR: WHEEL_UP.clone(),
        palmL: palmOf(outL),
        palmR: palmOf(outR),
        fwdL: fwdOf(outL),
        fwdR: fwdOf(outR),
        thumb: 0.5,
        gripThick: 0.018,
        gripSeat: [0.088, 0.026],
        // Each thumb hooked round the rim from its near face, on the hub's side.
        thumbL: away.clone().multiplyScalar(-0.024).addScaledVector(outL, -0.016),
        thumbR: away.clone().multiplyScalar(-0.024).addScaledVector(outR, -0.016),
        thumbRoundL: outL.clone().negate(),
        thumbRoundR: outR.clone().negate(),
        pegL: v(-L.side - 0.14, L.floor - 0.02, -L.pedals.z),
        pegR: v(-L.side + 0.12, L.floor - 0.02, -L.pedals.z),
        eye: toSeat(L.eye),
        pedals: { l: toSeat(this.rest), r: toSeat(padAt(this.pedals[this.pedals.length - 1], 0)), floor: L.floor },
        // (The handbrake lies along the car: held from above, the fingers across it toward the passenger's side.)
        shift: { at: new THREE.Vector3(), k: 0, turn: 0, fwd: new THREE.Vector3(-1, -0.15, 0).normalize(), rod: new THREE.Vector3(0, 0.1, -1).normalize() },
      },
      lamps: { head: dummy, tail: dummy },
    };
  }

  static create(view: CarView, scene: THREE.Scene, renderer: THREE.WebGLRenderer): CarDriver {
    const d = new CarDriver(view);
    const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    setCharacterEnvironment(env);
    void loadDressed(env).then((rig) => {
      rig.object.remove(rig.flashLight);
      rig.armed = false;
      rig.mounted = d.mount;
      rig.object.traverse((c) => {
        const m = (c as THREE.Mesh).material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
          const s = mat as THREE.MeshStandardMaterial;
          if (s.envMap && !s.userData.dimmed) {
            s.envMapIntensity *= ENV_GAIN;
            s.userData.dimmed = true;
          }
        }
      });
      scene.add(rig.object);
      d.rig = rig;
      d.shots = rig.shotsFired;
    });
    return d;
  }

  /**
   * Over a rig made elsewhere (the city's Mack, already in the scene): seats him at the wheel, his gun put away.
   * `release` gets him up again.
   */
  static seatIn(view: CarView, rig: FirstPersonRig): CarDriver {
    const d = new CarDriver(view);
    d.rig = rig;
    d.shots = rig.shotsFired;
    rig.mounted = d.mount;
    rig.armed = false;
    rig.aiming = false;
    return d;
  }

  /** Out of the seat (the rig free to stand again), and the seat gone from the car. */
  release(): void {
    if (this.rig && this.rig.mounted === this.mount) this.rig.mounted = null;
    this.view.obj.remove(this.seat);
  }

  /** Shots his gun fired since the last call. */
  newShots(): number {
    if (!this.rig) return 0;
    const n = this.rig.shotsFired - this.shots;
    this.shots = this.rig.shotsFired;
    return n;
  }

  /** The trigger: fires if the gun's up and ready (it's raised at once when you fire from the hip). */
  fire(): void {
    if (!this.rig) return;
    if (!this.rig.armed) this.rig.raise();
    this.rig.fire();
  }

  /** His feet at the pedals, and his left hand between the wheel and the gear lever, as the controls move. */
  private limbs(M: CabinMotion): void {
    const R = this.mount.rider;
    const pedal = (kind: Pedal['kind']): Pedal | undefined => this.pedals.find((p) => p.kind === kind);
    // The right foot: on the throttle, across to the brake (lifted clear of the pads on the way), and back.
    const k = smooth(M.rightFoot);
    const right = padAt(pedal('throttle')!, M.throttle).lerp(padAt(pedal('brake')!, M.brake), k);
    right.y += 0.022 * Math.sin(Math.PI * k);
    right.z -= 0.04 * Math.sin(Math.PI * k);
    R.pedals!.r.copy(toSeat(right));
    // The left: on the dead pedal, or over on the clutch through a change.
    const clutch = pedal('clutch');
    const c = smooth(M.leftFoot);
    const left = clutch ? this.rest.clone().lerp(padAt(clutch, M.clutch), c) : this.rest.clone();
    left.y += 0.02 * Math.sin(Math.PI * c);
    left.z -= 0.035 * Math.sin(Math.PI * c);
    R.pedals!.l.copy(toSeat(left));
    // The left hand: to the gear lever's knob, and from wherever that has it to the handbrake when it's pulled.
    const knob = this.cabin?.knob(this.knob) ?? null;
    const lever = this.cabin?.brakeGrip(this.lever) ?? null;
    const pull = lever ? smooth(M.pull) : 0;
    const hand = knob ? M.hand : 0;
    R.shift!.k = Math.max(hand, lever ? M.pull : 0);
    R.shift!.turn = pull;
    if (knob && lever) R.shift!.at.copy(toSeat(knob.lerp(lever, hand < 0.02 ? 1 : pull)));
    else if (knob) R.shift!.at.copy(toSeat(knob));
    else if (lever) R.shift!.at.copy(toSeat(lever));
    this.rightGrip(M.high * M.spot);
  }

  /**
   * The right hand's grip `a` radians up the rim from three o'clock (toward the top): where it is, the rim's line
   * there, and the same hold turned with it (the palm on the rim's near, outer quarter, the thumb round its inside).
   */
  private rightGrip(a: number): void {
    const R = this.mount.rider;
    const W = this.rim;
    const out = W.across.clone().multiplyScalar(-Math.cos(a)).addScaledVector(W.up, Math.sin(a));
    R.gripR.copy(W.c).addScaledVector(out, W.r);
    R.gripAxisR.copy(W.across).multiplyScalar(Math.sin(a)).addScaledVector(W.up, Math.cos(a));
    R.palmR!.copy(W.away).multiplyScalar(Math.cos(GRIP)).addScaledVector(out, -Math.sin(GRIP)).normalize();
    R.fwdR!.copy(W.away).multiplyScalar(Math.sin(GRIP)).addScaledVector(out, Math.cos(GRIP)).normalize();
    R.thumbR!.copy(W.away).multiplyScalar(-0.024).addScaledVector(out, -0.016);
    R.thumbRoundR!.copy(out).negate();
  }

  update(car: Steered, dv: DriveView, dt: number, realDt: number): void {
    // The windows: down while a weapon is out of one, wound up a moment after.
    this.sinceL = dv.window === 'across' ? 0 : this.sinceL + realDt;
    this.sinceR = dv.window === 'driver' ? 0 : this.sinceR + realDt;
    const wind = (cur: number, since: number): number => {
      const want = since < WIND_UP_AFTER ? 1 : 0;
      return cur + Math.max(-WIND * realDt, Math.min(WIND * realDt, want - cur));
    };
    this.winL = wind(this.winL, this.sinceL);
    this.winR = wind(this.winR, this.sinceR);
    rollWindows(this.view, this.winL, this.winR);
    const rig = this.rig;
    if (!rig) return;
    this.view.obj.updateMatrixWorld(true);
    // The steering wheel turns with the road wheels (a left turn winds it anticlockwise, as the driver sees it).
    const M = this.cabin?.motion ?? this.own;
    M.advance({ steer: car.steer, throttle: dv.throttle ?? 0, brake: dv.brake ?? 0, gear: car.gear ?? 1, handbrake: car.handbrake, speed: car.u, slide: car.slide, calm: dv.calm }, dt);
    this.mount.steer.quaternion.setFromAxisAngle(this.wheelAxis, -M.wheel);
    this.limbs(M);
    // Raised: the gun up at once (no upright hold in a car), the right hand off the wheel: to his belt for it (in
    // real time, whatever the world's doing), then his whole arm straight from the shoulder at what he aims at:
    // out of his own window to that side, across the car at the passenger window.
    if (dv.raised && !this.wasRaised) rig.raise();
    rig.drawDt = realDt;
    // He leans to the window he's shooting from: his shoulder nearer it, so the arm's out of it nearer to ahead.
    const leaning = dv.raised && dv.window === 'driver' ? 1 : 0;
    this.lean += Math.max(-realDt * 4, Math.min(realDt * 4, leaning - this.lean));
    // (Right out of it to shoot nearly ahead: the nearer ahead, the further out.)
    const to = leaning && dv.aimPoint ? this.view.obj.worldToLocal(dv.aimPoint.clone()).sub(this.layout.eye) : null;
    const far = to ? 1 - THREE.MathUtils.smoothstep(Math.abs(Math.atan2(to.x, to.z)), OUT_WITHIN[0], OUT_WITHIN[1]) : 0;
    this.leanOut += Math.max(-realDt * 3, Math.min(realDt * 3, far - this.leanOut));
    this.eyeShift.copy(LEAN).multiplyScalar(smooth(this.lean)).addScaledVector(LEAN_OUT.clone().sub(LEAN), smooth(this.leanOut));
    if (this.layout.side > 0) this.eyeShift.x *= -1;
    this.mount.rider.eye!.copy(toSeat(this.layout.eye.clone().add(this.eyeShift)));
    rig.armed = dv.raised;
    rig.aiming = dv.raised;
    rig.pulledBack = dv.raised && !!dv.blocked;
    this.wasRaised = dv.raised;
    // His eyes: the driver's, looking at what he aims at, else ahead.
    this.eye.position.copy(this.view.obj.localToWorld(this.layout.eye.clone().add(this.eyeShift)));
    const ahead = this.eye.position.clone().add(v(Math.sin(car.h), -0.08, Math.cos(car.h)));
    this.eye.lookAt(dv.raised && dv.aimPoint ? dv.aimPoint : ahead);
    // (Looking about from the cab with the gun away: his head is where the view is, and turned as it is.)
    this.gunAway = dv.raised ? 0 : this.gunAway + realDt;
    if (dv.view && dv.pov > 0.5 && this.gunAway > 0.6) {
      dv.view.updateMatrixWorld();
      dv.view.getWorldPosition(this.eye.position);
      dv.view.getWorldQuaternion(this.eye.quaternion);
    }
    this.eye.updateMatrixWorld();
    rig.setHeadless(dv.pov > 0.5);
    rig.update(dt, this.eye, 0, 0);
    // How far to the window's side of ahead he has to aim for the gun to be out of it: his straight arm's hand
    // past the door's skin, from where his shoulder is with him leant right over.
    const arm = rig.gunArm();
    const sx = Math.abs(this.view.obj.worldToLocal(arm.shoulder).x - this.eyeShift.x + (this.layout.side > 0 ? -LEAN_OUT.x : LEAN_OUT.x));
    this.outFrom = Math.asin(THREE.MathUtils.clamp((this.layout.halfW + SKIN - sx) / arm.reach, 0.05, 0.95));
  }
}
