import * as THREE from 'three';
import { CAR_RAIN_GLSL } from '../real/carRainGlsl';
import { EMIT, KIND, lin, MeshBuilder } from '../real/meshBuilder';
import { glassRows, WIPER_GLSL, wiperLayout } from './wipers';
import { bodyShape, type BodyShape, type CarType } from './vehicles';

/**
 * A car's cabin, fitted inside its body (models/vehicles.ts' `bodyShape`), for the cockpit camera: the inside of
 * the body's own skin (door cards, pillars, roof lining, floor, the firewall and the back), open wherever the body
 * has glass, so you look out through the windscreen, the side windows and the rear glass at the bonnet, the
 * mirrors and the road; the dashboard with the gauge hood over a backlit cluster whose needles move (tach, speedo
 * and a small dial: fuel, or boost on a turbo), the centre stack (radio, vents), the steering wheel on its column
 * (turning with the steering), seats (buckets, sports seats, plain cloth or a bench, white lace covers in taxis and
 * saloons), the rear seats, pedals that press, a gear lever that moves through the gate, the handbrake, sun visors,
 * the rear-view mirror (`mirror`: the page gives its glass a picture, race/driveCam.ts' RearMirror) and an omamori
 * charm hanging from it that swings with the car's accelerations.
 *
 * In the car's frame (+x its left, y up from the ground, +z forward), the frame `buildCar`'s body is in. Right-hand
 * drive: the driver sits on the right (-x). The cabin's surfaces are on the city material (plain, marked INDOOR so
 * the shader leaves leaves and snow off them), one merged mesh; the parts that move are meshes of their own.
 * `cockpitLayout` is the same fitting as numbers (pure): where the driver's eyes, the seat, the wheel, the pedals,
 * the mirror and the bonnet camera are, for the page's cameras and for seating Mack (race/carDriver.ts).
 */

type V3 = [number, number, number];

/** style.x for a cabin's surfaces: the city shader puts no fallen leaves or snow on them. */
export const INDOOR = 10;

export type CabinStyle = 'sport' | 'eighties' | 'rotary' | 'turbo' | 'roadster' | 'saloon' | 'luxury' | 'taxi' | 'kei' | 'van' | 'truck' | 'police';

export const CABIN_STYLE: Record<CarType, CabinStyle> = {
  hardtop: 'luxury',
  sports: 'sport',
  hatch: 'eighties',
  rotary: 'rotary',
  awd: 'turbo',
  roadster: 'roadster',
  sedan: 'saloon',
  minivan: 'saloon',
  luxury: 'luxury',
  taxi: 'taxi',
  taxi2: 'taxi',
  kei: 'kei',
  keivan: 'kei',
  van: 'van',
  keitruck: 'truck',
  boxtruck: 'truck',
  jeepney: 'truck',
  tricycle: 'kei',
  police: 'police',
};

interface GaugeLook {
  /** Dial face, markings, backlight (the markings at night) and needle colours (CSS). */
  readonly face: string;
  readonly ink: string;
  readonly glow: string;
  readonly needle: string;
  /** Where the dials are: two big ones, the tach in the middle with two small, or three in a row. */
  readonly layout: 'two' | 'tach-centre' | 'three';
  /** The speedo's top (km/h: Japan's cars stop at 180, kei cars at 140). */
  readonly speedMax: number;
}

interface StyleDef {
  readonly trim: number;
  /** The dash top and the door tops. */
  readonly upper: number;
  readonly seat: number;
  /** The seat's middle (cloth, or leather in another colour). */
  readonly insert: number;
  readonly liner: number;
  readonly carpet: number;
  /** A strip across the dash and the doors (wood, a coloured stripe), if any. */
  readonly accent?: number;
  readonly seats: 'bucket' | 'sport' | 'plain';
  /** White lace covers over the headrests and the seat backs' tops (taxis, saloons of a certain age). */
  readonly lace: boolean;
  readonly spokes: 2 | 3 | 4;
  /** The wheel's radius and its lean back from upright (rad): a sports car's upright, a van's nearly flat. */
  readonly wheelR: number;
  readonly tilt: number;
  readonly rim: number;
  readonly gauges: GaugeLook;
  /** A manual's gate, an automatic's straight gate, or a column shift (no lever on the floor). */
  readonly shifter: 'manual' | 'auto' | 'column';
  readonly rear: boolean;
  /** The omamori's brocade. */
  readonly charm: number;
  readonly meter?: boolean;
}

const JDM = 180;

const STYLES: Record<CabinStyle, StyleDef> = {
  sport: {
    trim: 0x1d1d21, upper: 0x141417, seat: 0x18181c, insert: 0x3d404a, liner: 0x4c4c52, carpet: 0x0f0f11,
    seats: 'sport', lace: false, spokes: 3, wheelR: 0.18, tilt: 0.32, rim: 0x141416,
    gauges: { face: '#0b0b0d', ink: '#f2efe6', glow: '#ff9a3c', needle: '#ff4a1a', layout: 'two', speedMax: JDM },
    shifter: 'manual', rear: true, charm: 0xb0162a,
  },
  eighties: {
    trim: 0x26262b, upper: 0x1a1a1e, seat: 0x1e1e22, insert: 0x4a4b52, liner: 0x5e5d5a, carpet: 0x121214, accent: 0x8a1c1c,
    seats: 'sport', lace: false, spokes: 4, wheelR: 0.185, tilt: 0.36, rim: 0x18181a,
    gauges: { face: '#0d0d0f', ink: '#f4f0e2', glow: '#ffb347', needle: '#ff6a1a', layout: 'tach-centre', speedMax: JDM },
    shifter: 'manual', rear: true, charm: 0xc8a020,
  },
  rotary: {
    trim: 0x1a1a1d, upper: 0x121214, seat: 0x151518, insert: 0x2b2b31, liner: 0x3c3c42, carpet: 0x0d0d0f, accent: 0x6e1414,
    seats: 'bucket', lace: false, spokes: 3, wheelR: 0.175, tilt: 0.3, rim: 0x101012,
    gauges: { face: '#0a0a0b', ink: '#f2f2f2', glow: '#ff3a2a', needle: '#ff2a1a', layout: 'tach-centre', speedMax: JDM },
    shifter: 'manual', rear: true, charm: 0x5a1e7a,
  },
  turbo: {
    trim: 0x222226, upper: 0x161619, seat: 0x1c1c20, insert: 0x55575f, liner: 0x46464c, carpet: 0x101012,
    seats: 'bucket', lace: false, spokes: 3, wheelR: 0.18, tilt: 0.33, rim: 0x121214,
    gauges: { face: '#0b0b0c', ink: '#eef2ff', glow: '#e8f0ff', needle: '#ff3a24', layout: 'three', speedMax: JDM },
    shifter: 'manual', rear: true, charm: 0xb0162a,
  },
  roadster: {
    trim: 0x1f1f23, upper: 0x161618, seat: 0x1a1a1e, insert: 0x7a1f26, liner: 0x1c1c1f, carpet: 0x101012,
    seats: 'sport', lace: false, spokes: 3, wheelR: 0.17, tilt: 0.34, rim: 0x141416,
    gauges: { face: '#f0eee6', ink: '#111114', glow: '#ffffff', needle: '#e8301c', layout: 'three', speedMax: 140 },
    shifter: 'manual', rear: false, charm: 0xc8a020,
  },
  saloon: {
    trim: 0x3a3b3f, upper: 0x232427, seat: 0x55575d, insert: 0x6c6e75, liner: 0x8c8983, carpet: 0x2a2a2d,
    seats: 'plain', lace: false, spokes: 4, wheelR: 0.19, tilt: 0.45, rim: 0x1c1c1f,
    gauges: { face: '#0c0e0d', ink: '#e8f2ee', glow: '#7dffb0', needle: '#ff6a2a', layout: 'two', speedMax: JDM },
    shifter: 'auto', rear: true, charm: 0xb0162a,
  },
  luxury: {
    trim: 0x2a2724, upper: 0x1d1b19, seat: 0x6e6a62, insert: 0x8a857a, liner: 0x9a958a, carpet: 0x2c2824, accent: 0x4a2814,
    seats: 'plain', lace: true, spokes: 4, wheelR: 0.19, tilt: 0.45, rim: 0x3a2414,
    gauges: { face: '#0e0d0c', ink: '#f2ede2', glow: '#9fd0ff', needle: '#ff7a3a', layout: 'two', speedMax: JDM },
    shifter: 'auto', rear: true, charm: 0xc8a020,
  },
  taxi: {
    trim: 0x3c3e42, upper: 0x26272a, seat: 0x4f535b, insert: 0x666a73, liner: 0x8e8b84, carpet: 0x28282b,
    seats: 'plain', lace: true, spokes: 4, wheelR: 0.19, tilt: 0.5, rim: 0x1a1a1c,
    gauges: { face: '#0c0e0d', ink: '#e8f2ee', glow: '#7dffb0', needle: '#ff6a2a', layout: 'two', speedMax: JDM },
    shifter: 'column', rear: true, charm: 0xb0162a, meter: true,
  },
  kei: {
    trim: 0x8a867e, upper: 0x55534e, seat: 0x45464d, insert: 0x5d5f68, liner: 0xa7a39a, carpet: 0x2e2e31,
    seats: 'plain', lace: false, spokes: 3, wheelR: 0.18, tilt: 0.55, rim: 0x2a2a2c,
    gauges: { face: '#101012', ink: '#eef2f8', glow: '#ffffff', needle: '#ff5a24', layout: 'two', speedMax: 140 },
    shifter: 'auto', rear: true, charm: 0xd06090,
  },
  van: {
    trim: 0x6c6d6c, upper: 0x3c3d3e, seat: 0x3c3e44, insert: 0x50535a, liner: 0x9c9a94, carpet: 0x2a2a2c,
    seats: 'plain', lace: false, spokes: 2, wheelR: 0.19, tilt: 0.85, rim: 0x222224,
    gauges: { face: '#0d0e10', ink: '#eef2f8', glow: '#9cff9c', needle: '#ff5a24', layout: 'two', speedMax: JDM },
    shifter: 'auto', rear: true, charm: 0xb0162a,
  },
  truck: {
    trim: 0x6a6a68, upper: 0x3a3a3a, seat: 0x2a2a2d, insert: 0x34353a, liner: 0x8a8984, carpet: 0x262628,
    seats: 'plain', lace: false, spokes: 2, wheelR: 0.19, tilt: 0.8, rim: 0x222224,
    gauges: { face: '#0d0e10', ink: '#eef2f8', glow: '#ffffff', needle: '#ff5a24', layout: 'two', speedMax: 140 },
    shifter: 'manual', rear: false, charm: 0xb0162a,
  },
  police: {
    trim: 0x2e2f33, upper: 0x1d1e21, seat: 0x3a3c42, insert: 0x494c54, liner: 0x7a7872, carpet: 0x222225,
    seats: 'plain', lace: false, spokes: 4, wheelR: 0.19, tilt: 0.45, rim: 0x18181a,
    gauges: { face: '#0c0e0d', ink: '#e8f2ee', glow: '#9fd0ff', needle: '#ff6a2a', layout: 'two', speedMax: JDM },
    shifter: 'auto', rear: true, charm: 0x1e3a8a,
  },
};

const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Where things are in a car, in its frame (+x left, +z forward, y up from the ground). */
export interface CockpitLayout {
  readonly type: CarType;
  readonly style: CabinStyle;
  /** The driver's eyes. */
  readonly eye: THREE.Vector3;
  /** The driver's line across the car (x; negative: right-hand drive). */
  readonly side: number;
  /** The driver's cushion, its top under the hips. */
  readonly seat: THREE.Vector3;
  /** The steering wheel: its centre, its axis (forward, down the column), its up (in its plane) and radius. */
  readonly wheel: { readonly c: THREE.Vector3; readonly axis: THREE.Vector3; readonly up: THREE.Vector3; readonly r: number };
  /** The pedals' middle (the brake's pad), and the floor. */
  readonly pedals: THREE.Vector3;
  readonly floor: number;
  /** The dash: its lip (z, toward you), its top (y) and where it meets the windscreen (z). */
  readonly dash: { readonly lip: number; readonly top: number; readonly front: number };
  /** The rear-view mirror's glass (its middle). */
  readonly mirror: THREE.Vector3;
  /** The bonnet camera (on the bonnet ahead of the windscreen). */
  readonly hood: THREE.Vector3;
  /** The gear lever's pivot, and the cabin's back (z: the rear seats' backs, or the bulkhead). */
  readonly shifter: THREE.Vector3;
  readonly back: number;
  /** The cabin's inside: half its width at the driver, and its roof over the driver (y). */
  readonly halfW: number;
  readonly roof: number;
}

/** The interior's numbers for a car (pure). */
export function cockpitLayout(type: CarType): CockpitLayout {
  const B = bodyShape(type);
  return layoutOf(B, STYLES[CABIN_STYLE[type]], CABIN_STYLE[type]);
}

function layoutOf(B: BodyShape, S: StyleDef, style: CabinStyle): CockpitLayout {
  const half = B.L / 2;
  const Z = (x: number): number => x - half;
  const [w0, w1] = B.windscreen;
  // The eyes 40 cm behind the windscreen's top (and 85 cm behind its foot: an upright screen's close), under the
  // roof; no higher than a seated driver's above the belt.
  const ex = Math.max(Math.min(w0 - 0.4, w1 - 0.85), B.x0 + 0.35);
  const ey = Math.max(B.belt(ex) + 0.12, Math.min(B.top(ex) - 0.19, B.belt(ex) + 0.4));
  const side = -B.halfW(ex) * 0.4;
  const eye = v3(side, ey, Z(ex));
  const floor = Math.max(B.clear + 0.08, B.belt(ex) - 0.68);
  const seatY = Math.max(floor + 0.1, ey - 0.8);
  const upright = S.tilt > 0.5;
  // The wheel: ahead of the chest, low enough that the dials show through its top half; lower and flatter in the
  // upright cars.
  const t = S.tilt;
  const wc = v3(side, ey - (upright ? 0.34 : 0.26), Z(ex) + (upright ? 0.5 : 0.44));
  const axis = v3(0, -Math.sin(t), Math.cos(t));
  const up = v3(0, Math.cos(t), Math.sin(t));
  const dashTop = B.top(w1) + 0.005;
  const front = Z(w1);
  const lip = Math.min(eye.z + 0.62, front - 0.2);
  wc.z = Math.min(wc.z, lip - 0.08);
  const pedals = v3(side, floor + 0.1, eye.z + (upright ? 0.72 : 0.87));
  const mirrorX = Math.min(w0 + 0.05, w1 - 0.05);
  const mirror = v3(0, B.top(mirrorX) - 0.1, Z(mirrorX));
  // (A cab-over has no bonnet: its front edge, just ahead of the glass.)
  const hx = Math.min(w1 + 0.35, B.L - 0.06);
  const hood = v3(0, B.top(hx) + 0.12, Z(hx));
  const shifter = v3(0, floor + 0.3, eye.z + 0.3);
  // The back: behind the rear seats (they fit between the rear glass and the front seats) or the bulkhead.
  const back = Z(Math.max(B.x0 + 0.06, S.rear ? Math.min(B.rearGlass[1] - 0.05, ex - 1.3) : ex - 0.55));
  return {
    type: B.type,
    style,
    eye,
    side,
    seat: v3(side, seatY, eye.z - 0.12),
    wheel: { c: wc, axis, up, r: S.wheelR },
    pedals,
    floor,
    dash: { lip, top: dashTop, front },
    mirror,
    hood,
    shifter,
    back,
    halfW: B.halfW(ex) - 0.04,
    roof: B.top(ex) - 0.035,
  };
}

/** The rear seats (a bench, or a 2+2's pair), if the cabin has room for them: where they are in the car's frame. */
function rearSeats(B: BodyShape, S: StyleDef, L: CockpitLayout): { rz: number; iw: number; ry: number; two: boolean } | null {
  if (!S.rear) return null;
  // Against the back of the cabin, under the rear glass or the roof.
  const rz = L.back + 0.2;
  if (L.seat.z - 0.25 - rz < 0.15) return null;
  return { rz, iw: B.halfW(rz + B.L / 2) - B.roofInset * 0.5 - 0.06, ry: Math.max(L.floor + 0.22, L.seat.y + 0.02), two: S.seats !== 'plain' };
}

/** A seat for someone riding with you. */
export interface PassengerSeat {
  /** The cushion's top under the hips, in the car's frame (+x left, +z forward). */
  readonly at: THREE.Vector3;
  /** Headroom: the roof's lining above the cushion (m). */
  readonly head: number;
  /** Legroom: from the hips forward to the footwell's end, or the back of the seat in front (m). */
  readonly legs: number;
}

/**
 * Where passengers sit in a car (pure): the front passenger's seat (the left: right-hand drive), then the rear
 * seats where it has them, the left first.
 */
export function passengerSeats(type: CarType): PassengerSeat[] {
  const B = bodyShape(type);
  const S = STYLES[CABIN_STYLE[type]];
  const L = layoutOf(B, S, CABIN_STYLE[type]);
  const out: PassengerSeat[] = [{ at: v3(-L.side, L.seat.y, L.seat.z), head: L.roof - L.seat.y, legs: L.pedals.z - L.seat.z }];
  const R = rearSeats(B, S, L);
  if (R) {
    const z = R.rz + 0.16;
    const head = B.top(z + B.L / 2) - 0.035 - R.ry;
    for (const sx of [1, -1]) out.push({ at: v3(sx * R.iw * 0.5, R.ry, z), head, legs: L.seat.z - 0.2 - z });
  }
  return out;
}

/** What the cabin shows each frame. */
export interface CabinState {
  /** Road wheel angle (rad, positive left). */
  readonly steer: number;
  /** Accelerations (m/s^2): along the car (forward +) and across it (to the left +). */
  readonly ax: number;
  readonly ay: number;
  readonly kmh: number;
  /** Revs, 0 to the tach's top. */
  readonly rpm: number;
  /** 0 reverse, 1... forward. */
  readonly gear: number;
  readonly throttle: number;
  readonly brake: number;
  readonly handbrake: boolean;
  /** How far it's sliding (rad), and whether this is ordinary driving (`DriverInput.calm`). */
  readonly slide?: number;
  readonly calm?: boolean;
  /** The dials' backlight and the lamps (0 day, 1 night). */
  readonly lamps: number;
  /** A knock this frame (m/s), to jolt the charm. */
  readonly bump?: number;
  /** Turbo boost 0-1 (the small dial on a turbo). */
  readonly boost?: number;
}

/** Steering wheel turns per road-wheel turn (about the straight-ahead). */
export const STEER_RATIO = 4;
/** The most the steering wheel shows either way (rad): his hands stay on the rim at quarter to three, so it stops short of crossing his arms. */
export const WHEEL_MAX = 1.3;
/** The fastest it turns (rad/s): a driver's hands, not the road wheels' own rate (which would spin it in a fifth of a second). */
export const WHEEL_SPEED = 4.2;

/** The steering wheel's angle for a road-wheel angle (both rad, positive left): geared `STEER_RATIO` near the middle, easing off toward `WHEEL_MAX`. */
export const wheelAngleFor = (steer: number): number => WHEEL_MAX * Math.tanh((steer * STEER_RATIO) / WHEEL_MAX);

/** What the driver does to the car, as the cabin and his body show it. */
export interface DriverInput {
  /** Road wheel angle (rad, positive left). */
  readonly steer: number;
  /** The pedals, 0-1. */
  readonly throttle: number;
  readonly brake: number;
  /** 0 reverse, 1... forward. */
  readonly gear: number;
  /** The handbrake's pulled. */
  readonly handbrake?: boolean;
  /** How hard it's being driven: its speed (m/s) and how far it's sliding (rad). */
  readonly speed?: number;
  readonly slide?: number;
  /** Ordinary driving (the city): he may drive one-handed, the other resting on the gear lever. Racing, never. */
  readonly calm?: boolean;
}

/** Which gear lever a car has: a manual's (worked with the clutch at every change), an automatic's on the floor (moved between drive and reverse), or one on the column. */
export const shifterOf = (type: CarType): 'manual' | 'auto' | 'column' => STYLES[CABIN_STYLE[type]].shifter;

/**
 * The controls as they move, at the pace of the hands and feet that move them (the car itself answers the keys at
 * once: this is only what shows). One for a car's cabin, shared with the driver's body (race/carDriver.ts) so his
 * hands and feet stay on what they work; whoever asks first in a frame moves it on.
 * - The steering wheel follows the steering, smoothed and no faster than hands turn it.
 * - The right foot rests over the throttle, and goes across to the brake when he brakes (about a third of a
 *   second each way); a pedal goes down only once the foot is on it.
 * - A gear change (a manual: every change; an automatic on the floor: between drive and reverse): the left hand
 *   leaves the wheel for the lever while the left foot comes off the dead pedal and puts the clutch down; then the
 *   lever moves (`gear` is the gear it shows), the clutch comes up and the hand goes back to the wheel.
 * - The handbrake (a manual's lever between the seats): the left hand goes to it and pulls (`pull`).
 * - His posture follows the driving. Ordinary driving (`calm`), nothing asking much of him: the left hand stays
 *   on the gear lever for a while after a change (and while he's stopped), so through town it mostly lives there,
 *   and the right hand slides up the rim toward the top (`high`). Asked for more (the wheel well over, speed, a
 *   slide, hard braking: `alert`), or racing: both hands on the wheel at quarter to three, off it only to change.
 */
export class CabinMotion {
  /** The steering wheel's turn (rad, positive left). */
  wheel = 0;
  /** The pedals as far as they're down (0-1). */
  throttle = 0;
  brake = 0;
  clutch = 0;
  /** The right foot, 0 over the throttle to 1 over the brake; the left, 0 on the dead pedal to 1 on the clutch. */
  rightFoot = 0;
  leftFoot = 0;
  /** The gear the lever shows, and the left hand: 0 on the wheel to 1 on the lever. */
  gear = 1;
  hand = 0;
  /** The left hand over to the handbrake (0-1, from wherever `hand` has it), and the lever up once it's there. */
  pull = 0;
  pulled = false;
  /** The right hand up the rim from three o'clock (0) toward the top (1), and how far up this time (rad). */
  high = 0;
  spot = HIGH_SPOT;
  private settle = 0;
  private linger = 0;
  private alert = 0;
  private spots = 0;
  private last = -1;

  constructor(readonly shifter: 'manual' | 'auto' | 'column') {}

  advance(s: DriverInput, dt: number): void {
    // (Asked again within the frame: the cabin, and the driver sitting in it.)
    if (FRAMES && frame === this.last) return;
    this.last = frame;
    dt = Math.min(dt, 0.05);
    const toward = (cur: number, to: number, rate: number): number => cur + Math.max(-rate * dt, Math.min(rate * dt, to - cur));
    const ease = (cur: number, to: number, rate: number): number => cur + (to - cur) * (1 - Math.exp(-dt * rate));
    // The wheel.
    this.wheel = toward(this.wheel, ease(this.wheel, wheelAngleFor(s.steer), 12), WHEEL_SPEED);
    // The right foot, and the pedal under it.
    this.rightFoot = toward(this.rightFoot, s.brake > 0.02 ? 1 : 0, FOOT_ACROSS);
    this.throttle = ease(this.throttle, this.rightFoot < 0.15 ? s.throttle : 0, 6);
    this.brake = ease(this.brake, this.rightFoot > 0.85 ? s.brake : 0, 8);
    // How much the driving asks of him: both hands, for a moment after anything that does.
    const speed = Math.abs(s.speed ?? 0);
    const asks = !s.calm || Math.abs(wheelAngleFor(s.steer)) > 0.6 || speed > 24 || Math.abs(s.slide ?? 0) > 0.1 || (s.brake > 0.7 && speed > 12);
    this.alert = asks ? 1.2 : Math.max(0, this.alert - dt);
    const relaxed = this.alert <= 0;
    // The gears.
    const slot = (g: number): number => (this.shifter === 'manual' ? g : g === 0 ? 0 : 1);
    if (this.shifter === 'column') this.gear = s.gear;
    const changing = slot(s.gear) !== slot(this.gear);
    const manual = this.shifter === 'manual';
    let clutchDown = false;
    if (changing) {
      this.hand = toward(this.hand, 1, HAND_OVER);
      if (manual) this.leftFoot = toward(this.leftFoot, 1, 3.8);
      clutchDown = manual && this.leftFoot > 0.6;
      if (this.hand >= 1 && (!manual || this.clutch > 0.75)) {
        this.gear = s.gear;
        this.settle = 0.42;
        this.linger = LINGER;
      }
    } else {
      // (An automatic's own changes move nothing.)
      this.gear = s.gear;
      // Stopped, the hand that's on the lever waits there.
      if (speed > 0.5) this.linger = Math.max(0, this.linger - dt);
      if (this.settle > 0) {
        this.settle -= dt;
        clutchDown = manual;
      } else {
        // Resting on the lever while there's likely another change coming, else back to the wheel.
        const rest = relaxed && this.linger > 0 && manual;
        this.hand = toward(this.hand, rest ? 1 : 0, HAND_BACK);
        if (this.clutch < 0.25) this.leftFoot = toward(this.leftFoot, 0, 3);
      }
    }
    this.clutch = ease(this.clutch, clutchDown ? 1 : 0, clutchDown ? 12 : 7);
    // The handbrake: a manual's lever, the left hand to it and up.
    const yank = !!s.handbrake && manual;
    this.pull = toward(this.pull, yank ? 1 : 0, yank ? 6 : 3.2);
    this.pulled = yank && this.pull > 0.8;
    // The right hand: up the rim while the left is away and nothing asks for both (a little differently each time).
    const away = this.hand > 0.5 && !changing && this.settle <= 0;
    const up = relaxed && away && !yank;
    if (up && this.high === 0) this.spot = HIGH_SPOT * (0.8 + 0.35 * (((this.spots++ * 0.618) % 1) as number));
    this.high = toward(this.high, up ? 1 : 0, up ? 1.3 : 2.4);
  }
}
/** The frame being drawn (counted off the browser's own; none to count in a test, where every call moves it on). */
const FRAMES = typeof requestAnimationFrame !== 'undefined';
let frame = 0;
if (FRAMES) {
  const tick = (): void => {
    frame++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
/** How long the left hand rests on the lever after a change before going back to the wheel (s, of driving). */
const LINGER = 9;
/** How far up the rim from three o'clock the right hand goes, driving one-handed (rad: about one o'clock). */
const HIGH_SPOT = 1.05;
/** How fast the right foot goes between the throttle and the brake, and the left hand to the lever and back (a second each, inverted). */
const FOOT_ACROSS = 3;
const HAND_OVER = 3.6;
const HAND_BACK = 2.8;

/** A pedal: which, where it hinges (the car's frame) and its pad's middle from the hinge at rest. */
export interface Pedal {
  readonly kind: 'clutch' | 'brake' | 'throttle';
  readonly hinge: THREE.Vector3;
  readonly pad: THREE.Vector3;
  /** The pad's half width and half height. */
  readonly half: readonly [number, number];
}
/** How far a pedal swings pressed right down (rad about the car's x at its hinge). */
export const PEDAL_SWING = 0.32;

/** A car's pedals (two with an automatic or a column shift, three with a manual): pure, for the cabin and the driver's feet. */
export function pedalsOf(type: CarType): Pedal[] {
  const S = STYLES[CABIN_STYLE[type]];
  const L = cockpitLayout(type);
  const manual = S.shifter === 'manual';
  const kinds: Pedal['kind'][] = manual ? ['clutch', 'brake', 'throttle'] : ['brake', 'throttle'];
  return kinds.map((kind) => ({
    kind,
    hinge: v3(L.side + (kind === 'clutch' ? 0.14 : kind === 'brake' ? (manual ? 0.01 : 0.05) : -0.12), L.pedals.y + 0.24, L.pedals.z + 0.06),
    pad: v3(0, -0.22, -0.06),
    half: [kind === 'brake' && !manual ? 0.06 : kind === 'throttle' ? 0.03 : 0.04, kind === 'throttle' ? 0.065 : 0.04],
  }));
}

/** Where a pedal's pad is (its middle, the car's frame) pressed `press` (0-1). */
export function padAt(p: Pedal, press: number): THREE.Vector3 {
  return p.pad.clone().applyAxisAngle(X_AXIS, -press * PEDAL_SWING).add(p.hinge);
}
const X_AXIS = new THREE.Vector3(1, 0, 0);

/** Where the left foot rests (the dead pedal's face, the car's frame). */
export function deadPedal(type: CarType): THREE.Vector3 {
  const L = cockpitLayout(type);
  return v3(L.side + 0.25, L.floor + 0.09, L.pedals.z + 0.02);
}

// ---- geometry in the car's frame ----

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const vec = (v: THREE.Vector3): V3 => [v.x, v.y, v.z];
/** v turned by a about the unit axis k (Rodrigues). */
const turn = (v: V3, k: V3, a: number): V3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const d = v[0] * k[0] + v[1] * k[1] + v[2] * k[2];
  const x: V3 = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)];
};

/** A builder with the cabin's brush (plain, INDOOR). */
class Cab {
  readonly mb = new MeshBuilder(1 << 13);

  constructor() {
    this.mb.kind = KIND.plain;
    this.mb.style = [INDOOR, 0, 0, 0];
  }

  color(hex: number, k = 1): this {
    this.mb.kind = KIND.plain;
    this.mb.style = [INDOOR, 0, 0, 0];
    // (A little lighter than the swatch: a cabin's dark trim otherwise goes to black in the shade of its roof.)
    const c = lin(hex);
    const f = k * 1.3;
    this.mb.color = [Math.min(1, c[0] * f), Math.min(1, c[1] * f), Math.min(1, c[2] * f)];
    return this;
  }

  /** Polished (a mirror's glass): the city material's chrome, reflecting the sky's colours. */
  chrome(hex: number): this {
    this.mb.kind = KIND.chrome;
    this.mb.style = [INDOOR, 0, 0, 0];
    this.mb.color = lin(hex);
    return this;
  }

  /** Lit by itself (a display): colour is light. */
  glow(rgb: V3): this {
    this.mb.kind = KIND.emit;
    this.mb.style = [EMIT.always, 0, 0, 0];
    this.mb.color = rgb;
    return this;
  }

  quad(a: V3, b: V3, c: V3, d: V3, n: V3): void {
    const m = norm(n);
    this.mb.quadN(a, b, c, d, m, m, m, m);
  }

  /** A box with chamfered edges: centre, unit axes (across, up, along), half sizes, chamfer. */
  rbox(c: V3, ax: V3, ay: V3, az: V3, h: V3, r = 0.012): void {
    r = Math.min(r, h[0] * 0.9, h[1] * 0.9, h[2] * 0.9);
    const P = (l: V3): V3 => add(add(add(c, ax, l[0]), ay, l[1]), az, l[2]);
    const N = (l: V3): V3 => norm(add(add(add([0, 0, 0], ax, l[0]), ay, l[1]), az, l[2]));
    const at = (i: number, s: number, j: number, sj: number, k: number, sk: number, inI: boolean, inJ: boolean): V3 => {
      const l: V3 = [0, 0, 0];
      l[i] = s * (inI ? h[i] - r : h[i]);
      l[j] = sj * (inJ ? h[j] - r : h[j]);
      l[k] = sk * (h[k] - r);
      return l;
    };
    // The six faces.
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const k = (i + 2) % 3;
      for (const s of [-1, 1]) {
        const ls: V3[] = [];
        for (const [sj, sk] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const l: V3 = [0, 0, 0];
          l[i] = s * h[i];
          l[j] = sj * (h[j] - r);
          l[k] = sk * (h[k] - r);
          ls.push(l);
        }
        const n: V3 = [0, 0, 0];
        n[i] = s;
        const nw = N(n);
        this.mb.quadN(P(ls[0]), P(ls[1]), P(ls[2]), P(ls[3]), nw, nw, nw, nw);
      }
    }
    if (r <= 0.0005) return;
    // The twelve edges.
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const k = (i + 2) % 3;
      for (const si of [-1, 1]) {
        for (const sj of [-1, 1]) {
          const a0 = at(i, si, j, sj, k, -1, false, true);
          const a1 = at(i, si, j, sj, k, 1, false, true);
          const b1 = at(i, si, j, sj, k, 1, true, false);
          const b0 = at(i, si, j, sj, k, -1, true, false);
          const n: V3 = [0, 0, 0];
          n[i] = si;
          n[j] = sj;
          const nw = N(n);
          this.mb.quadN(P(a0), P(a1), P(b1), P(b0), nw, nw, nw, nw);
        }
      }
    }
    // The eight corners.
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const s: V3 = [sx, sy, sz];
          const pts = [0, 1, 2].map((i) => {
            const l: V3 = [0, 0, 0];
            for (let q = 0; q < 3; q++) l[q] = s[q] * (q === i ? h[q] : h[q] - r);
            return P(l);
          });
          const nw = N(s);
          this.mb.quadN(pts[0], pts[1], pts[2], pts[2], nw, nw, nw, nw);
        }
      }
    }
  }

  /** An axis-aligned rounded box (car frame). */
  abox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r = 0.01): void {
    this.rbox([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], r);
  }

  /** A box tipped about x by `tilt` (rad; positive tips its top back), its centre at c. */
  tbox(c: V3, h: V3, tilt: number, r = 0.012): void {
    this.rbox(c, [1, 0, 0], [0, Math.cos(tilt), -Math.sin(tilt)], [0, Math.sin(tilt), Math.cos(tilt)], h, r);
  }

  /** A flat disc facing n. */
  disc(c: V3, n: V3, r: number, seg = 14): void {
    const nn = norm(n);
    const ref: V3 = Math.abs(nn[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = norm([nn[1] * ref[2] - nn[2] * ref[1], nn[2] * ref[0] - nn[0] * ref[2], nn[0] * ref[1] - nn[1] * ref[0]]);
    const w: V3 = [nn[1] * u[2] - nn[2] * u[1], nn[2] * u[0] - nn[0] * u[2], nn[0] * u[1] - nn[1] * u[0]];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0 = add(add(c, u, Math.cos(a0) * r), w, Math.sin(a0) * r);
      const p1 = add(add(c, u, Math.cos(a1) * r), w, Math.sin(a1) * r);
      this.mb.quadN(c, p0, p1, p1, nn, nn, nn, nn);
    }
  }

  /** A ring of tube (a steering wheel's rim) in the plane of u and w about c. */
  torus(c: V3, u: V3, w: V3, R: number, r: number, seg = 32, sides = 6): void {
    const n = norm([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]);
    const at = (i: number, j: number): [V3, V3] => {
      const a = (i / seg) * Math.PI * 2;
      const b = (j / sides) * Math.PI * 2;
      const radial = add([0, 0, 0], add(u.map((x) => x * Math.cos(a)) as V3, w, Math.sin(a)));
      const dir = norm(add(radial.map((x) => x * Math.cos(b)) as V3, n, Math.sin(b)));
      return [add(add(c, radial, R), dir, r), dir];
    };
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < sides; j++) {
        const [p0, n0] = at(i, j);
        const [p1, n1] = at(i + 1, j);
        const [p2, n2] = at(i + 1, j + 1);
        const [p3, n3] = at(i, j + 1);
        this.mb.quadN(p0, p1, p2, p3, n0, n1, n2, n3);
      }
    }
  }

  build(material: THREE.Material): THREE.Mesh {
    const g = this.mb.build();
    const m = new THREE.Mesh(g ?? new THREE.BufferGeometry(), material);
    return m;
  }
}

// ---- the gauges ----

interface Dial {
  readonly kind: 'tach' | 'speed' | 'fuel' | 'boost' | 'temp';
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

const FACE_W = 0.4;
/** Half the cluster's opening in the dash (m). */
const CLUSTER_HALF = 0.215;
const FACE_H = 0.14;
/** A needle's angle at t (0-1) round the dial: from lower left, clockwise over the top, to lower right. */
const dialAngle = (t: number, small = false): number => (small ? (150 - 120 * t) : 225 - 270 * t) * (Math.PI / 180);

function dialsFor(layout: GaugeLook['layout'], turbo: boolean): Dial[] {
  const small: Dial['kind'] = turbo ? 'boost' : 'fuel';
  if (layout === 'tach-centre') return [
    { kind: 'tach', x: 0, y: 0, r: 0.064 },
    { kind: 'speed', x: 0.128, y: -0.008, r: 0.05 },
    { kind: small, x: -0.128, y: -0.008, r: 0.05 },
  ];
  if (layout === 'three') return [
    { kind: 'speed', x: -0.124, y: -0.004, r: 0.054 },
    { kind: 'tach', x: 0, y: 0, r: 0.062 },
    { kind: small, x: 0.124, y: -0.004, r: 0.046 },
  ];
  return [
    { kind: 'tach', x: -0.092, y: 0, r: 0.062 },
    { kind: 'speed', x: 0.092, y: 0, r: 0.062 },
    { kind: small, x: 0, y: -0.04, r: 0.026 },
  ];
}

const gaugeCache = new Map<string, THREE.CanvasTexture>();

/** The cluster's face, painted once per look: rings, ticks, numbers, the redline, the labels. */
function gaugeTexture(look: GaugeLook, dials: readonly Dial[], rpmMax: number, redline: number): THREE.CanvasTexture {
  const key = `${look.face}${look.ink}${look.layout}${look.speedMax}${rpmMax}${redline}${dials.map((d) => d.kind).join()}`;
  const hit = gaugeCache.get(key);
  if (hit) return hit;
  const W = 1024;
  const H = Math.round((W * FACE_H) / FACE_W);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const px = (x: number): number => (x / FACE_W + 0.5) * W;
  const py = (y: number): number => (0.5 - y / FACE_H) * H;
  const pr = (r: number): number => (r / FACE_W) * W;
  g.fillStyle = '#050506';
  g.fillRect(0, 0, W, H);
  for (const d of dials) {
    const cx = px(d.x);
    const cy = py(d.y);
    const R = pr(d.r);
    const small = d.kind === 'fuel' || d.kind === 'boost' || d.kind === 'temp';
    // The face, and a chrome-ish bezel.
    g.fillStyle = look.face;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#3a3a40';
    g.lineWidth = R * 0.06;
    g.stroke();
    const a = (t: number): number => -dialAngle(t, small && R < pr(0.04));
    const tick = (t: number, r0: number, r1: number, w: number, col: string): void => {
      g.strokeStyle = col;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(cx + Math.cos(a(t)) * R * r0, cy + Math.sin(a(t)) * R * r0);
      g.lineTo(cx + Math.cos(a(t)) * R * r1, cy + Math.sin(a(t)) * R * r1);
      g.stroke();
    };
    const label = (t: number, text: string, r: number, size: number, col = look.ink): void => {
      g.fillStyle = col;
      g.font = `bold ${size}px "Arial Narrow", Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, cx + Math.cos(a(t)) * R * r, cy + Math.sin(a(t)) * R * r);
    };
    const words = (text: string, dy: number, size: number, col = look.ink): void => {
      g.fillStyle = col;
      g.font = `${size}px "Arial Narrow", Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, cx, cy + dy * R);
    };
    if (d.kind === 'tach') {
      const top = rpmMax / 1000;
      // The redline band.
      g.strokeStyle = '#e02018';
      g.lineWidth = R * 0.1;
      g.beginPath();
      g.arc(cx, cy, R * 0.86, a(redline / rpmMax), a(1));
      g.stroke();
      for (let k = 0; k <= top * 2; k++) {
        const t = k / (top * 2);
        const major = k % 2 === 0;
        const red = t * rpmMax >= redline;
        tick(t, major ? 0.72 : 0.8, 0.92, major ? R * 0.045 : R * 0.025, red ? '#ff4030' : look.ink);
        if (major) label(t, String(k / 2), 0.56, R * 0.2, red ? '#ff4030' : look.ink);
      }
      words('×1000r/min', 0.42, R * 0.11);
    } else if (d.kind === 'speed') {
      const step = look.speedMax > 150 ? 20 : 20;
      for (let s = 0; s <= look.speedMax; s += 10) {
        const t = s / look.speedMax;
        const major = s % step === 0;
        tick(t, major ? 0.74 : 0.82, 0.92, major ? R * 0.04 : R * 0.022, look.ink);
        if (major) label(t, String(s), 0.56, R * (s >= 100 ? 0.15 : 0.17));
      }
      words('km/h', 0.42, R * 0.13);
    } else if (d.kind === 'boost') {
      for (let k = 0; k <= 8; k++) tick(k / 8, k % 2 ? 0.74 : 0.62, 0.92, R * 0.05, k >= 6 ? '#ff4030' : look.ink);
      label(0, '-1', 0.4, R * 0.24);
      label(1, '+1', 0.4, R * 0.24);
      words('TURBO', 0.5, R * 0.17);
    } else {
      for (let k = 0; k <= 4; k++) tick(k / 4, k % 2 ? 0.72 : 0.6, 0.92, R * 0.06, k === 0 ? '#ff4030' : look.ink);
      label(0, 'E', 0.42, R * 0.28);
      label(1, 'F', 0.42, R * 0.28);
      words('FUEL', 0.55, R * 0.16);
    }
  }
  // Warning lamps along the bottom, unlit, and the odometer.
  for (let k = 0; k < 6; k++) {
    g.fillStyle = ['#3a1a10', '#3a3010', '#102a12', '#10203a', '#3a1010', '#2a2a2a'][k];
    g.fillRect(W * (0.36 + k * 0.05), H * 0.86, W * 0.03, H * 0.05);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  gaugeCache.set(key, tex);
  return tex;
}

let meterTex: THREE.CanvasTexture | null = null;
/** The taxi's meter: 空車 (for hire) lit red, the fare under it. */
function taxiMeter(): THREE.CanvasTexture {
  if (meterTex) return meterTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a0a0b';
  g.fillRect(0, 0, 256, 96);
  g.fillStyle = '#ff2a1a';
  g.font = 'bold 44px "Yu Gothic", "Meiryo", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('空車', 70, 48);
  g.fillStyle = '#ff7a2a';
  g.font = 'bold 40px "Courier New", monospace';
  g.fillText('500', 186, 50);
  meterTex = new THREE.CanvasTexture(c);
  meterTex.colorSpace = THREE.SRGBColorSpace;
  return meterTex;
}

// ---- the interior ----

export interface InteriorOptions {
  /** The tach's top and its redline (rpm): the car's own engine (race/catalog.ts' sound profile). */
  readonly rpmMax?: number;
  /** A turbo: the small dial reads boost. */
  readonly turbo?: boolean;
}

export class CarInterior {
  readonly group = new THREE.Group();
  readonly layout: CockpitLayout;
  /** The rear-view mirror's picture (a plane facing the driver), shown once a page gives it one (`showMirror`);
   * until then the glass is polished and reflects the sky's colours. */
  readonly mirror: THREE.Mesh;
  /** The windscreen from inside (the body's own glass faces out, so from the seat there's none): rain on it, cleared
   * by the wipers (`setRain`); shown only while it's wet. */
  readonly glass: THREE.Mesh;
  private readonly glassU = {
    uRun: { value: 0 },
    uWet: { value: 0 },
    uBeat: { value: 1 },
    uLen: { value: 0.5 },
    uPivots: { value: new THREE.Vector3() },
    uTint: { value: new THREE.Color(1, 1, 1) },
  };
  /** The steering wheel, turned with the steering. */
  readonly wheel = new THREE.Group();
  /** The controls as they move (shared with the driver sitting here: race/carDriver.ts). */
  readonly motion: CabinMotion;
  /** How far up the lever its knob is (0: no lever to hold, on the column). */
  private readonly knobUp: number;
  /** The tach's top and the engine's redline (rpm). */
  readonly rpmMax: number;
  readonly redline: number;
  private readonly needles: { pivot: THREE.Group; dial: Dial }[] = [];
  private readonly faceMat: THREE.MeshBasicMaterial;
  private readonly needleMat: THREE.MeshBasicMaterial;
  private readonly lever = new THREE.Group();
  private readonly handbrake = new THREE.Group();
  private readonly pedals: { pivot: THREE.Group; kind: 'clutch' | 'brake' | 'throttle' }[] = [];
  private readonly charm = new THREE.Group();
  private readonly S: StyleDef;
  private readonly speedMax: number;
  private shown = { tach: 0, speed: 0, small: 0.6 };
  private gate = { x: 0, z: 0 };
  private swing = { a: 0, va: 0, b: 0, vb: 0 };

  constructor(type: CarType, material: THREE.Material, opts: InteriorOptions = {}) {
    const style = CABIN_STYLE[type];
    const S = (this.S = STYLES[style]);
    this.motion = new CabinMotion(S.shifter);
    this.knobUp = S.shifter === 'manual' ? 0.178 : S.shifter === 'auto' ? 0.15 : 0;
    const B = bodyShape(type);
    const L = (this.layout = layoutOf(B, S, style));
    this.rpmMax = Math.ceil(((opts.rpmMax ?? 7500) + 500) / 1000) * 1000;
    const redline = (this.redline = opts.rpmMax ?? 7500);
    this.speedMax = S.gauges.speedMax;
    this.group.name = 'interior';
    const cab = new Cab();
    shell(cab, B, S, L);
    seats(cab, B, S, L);
    dashboard(cab, B, S, L);
    doors(cab, B, S, L);
    roof(cab, B, S, L);
    this.group.add(cab.build(material));

    this.glass = insideGlass(type, this.glassU);
    this.group.add(this.glass);

    // The wheel: its rim, spokes and hub, in its own frame (z down the column, y up its face).
    const W = new Cab();
    const r = S.wheelR;
    W.color(S.rim);
    W.torus([0, 0, 0], [1, 0, 0], [0, 1, 0], r, S.seats === 'plain' ? 0.015 : 0.019, 36, 7);
    W.color(S.trim, 0.8);
    const spokes = S.spokes === 2 ? [-12, 192] : S.spokes === 3 ? [0, 180, 270] : [-25, 205, 250, 290];
    for (const deg of spokes) {
      const a = (deg * Math.PI) / 180;
      const dir: V3 = [Math.cos(a), Math.sin(a), 0];
      const mid = (r + 0.04) / 2;
      W.rbox([dir[0] * mid, dir[1] * mid, 0.008], dir, [-dir[1], dir[0], 0], [0, 0, 1], [(r - 0.04) / 2, S.spokes === 2 ? 0.022 : 0.014, 0.008], 0.004);
    }
    W.color(S.trim, 0.7);
    W.rbox([0, -0.004, -0.008], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.062, 0.05, 0.022], 0.018);
    W.color(0x9a9aa0);
    W.disc([0, -0.004, -0.031], [0, 0, -1], 0.014, 12);
    this.wheel.add(W.build(material));
    this.wheel.position.copy(L.wheel.c);
    this.wheel.quaternion.copy(frameQuat(L.wheel.axis, L.wheel.up));
    const steerPivot = new THREE.Group();
    steerPivot.add(this.wheel);
    this.group.add(steerPivot);

    // The cluster: its face, backlit, and the needles.
    const dials = dialsFor(S.gauges.layout, !!opts.turbo);
    this.faceMat = new THREE.MeshBasicMaterial({ map: gaugeTexture(S.gauges, dials, this.rpmMax, redline), toneMapped: true });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(FACE_W, FACE_H), this.faceMat);
    const fc = v3(L.side, L.dash.top - 0.035, L.dash.lip + 0.075);
    face.position.copy(fc);
    face.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(L.eye.clone().setX(L.side), fc, v3(0, 1, 0)));
    this.group.add(face);
    this.needleMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(S.gauges.needle) });
    for (const d of dials) {
      const len = d.r * 0.82;
      const ng = new THREE.BufferGeometry();
      const w = d.r * 0.05;
      ng.setAttribute('position', new THREE.Float32BufferAttribute([-d.r * 0.14, -w, 0, len, -w * 0.3, 0, len, w * 0.3, 0, -d.r * 0.14, w, 0], 3));
      ng.setIndex([0, 1, 2, 0, 2, 3]);
      const pivot = new THREE.Group();
      pivot.position.set(d.x, d.y, 0.003);
      pivot.add(new THREE.Mesh(ng, this.needleMat));
      const cap = new THREE.Mesh(new THREE.CircleGeometry(d.r * 0.11, 12), new THREE.MeshBasicMaterial({ color: 0x18181a }));
      cap.position.z = 0.001;
      pivot.add(cap);
      face.add(pivot);
      this.needles.push({ pivot, dial: d });
    }
    if (S.meter) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.056), new THREE.MeshBasicMaterial({ map: taxiMeter() }));
      const mc = v3(0.16, L.dash.top + 0.06, L.dash.lip + 0.12);
      m.position.copy(mc);
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(L.eye, mc, v3(0, 1, 0)));
      this.group.add(m);
    }

    // The mirror's glass, angled so the driver sees out of the rear glass.
    const mg = new THREE.Mesh(new THREE.PlaneGeometry(0.235, 0.062), new THREE.MeshBasicMaterial({ color: 0x0c0e12 }));
    mg.visible = false;
    mg.position.copy(L.mirror);
    const toEye = L.eye.clone().sub(L.mirror).normalize();
    const toBack = v3(0, L.mirror.y - 0.05, L.back).sub(L.mirror).normalize();
    const n = toEye.add(toBack).normalize();
    mg.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(L.mirror.clone().add(n), L.mirror, v3(0, 1, 0)));
    mg.name = 'mirror';
    this.mirror = mg;
    this.group.add(mg);
    const MH = new Cab();
    MH.color(0x1a1a1c);
    const q = mg.quaternion;
    const ax = vec(v3(1, 0, 0).applyQuaternion(q));
    const ay = vec(v3(0, 1, 0).applyQuaternion(q));
    const az = vec(v3(0, 0, 1).applyQuaternion(q));
    MH.rbox(add(vec(L.mirror), az, -0.014), ax, ay, az, [0.128, 0.039, 0.013], 0.012);
    MH.chrome(0x9aa0a8);
    const gc = add(vec(L.mirror), az, -0.0005);
    const gx = (k: number, l: number): V3 => add(add(gc, ax, k * 0.1175), ay, l * 0.031);
    MH.quad(gx(-1, -1), gx(1, -1), gx(1, 1), gx(-1, 1), az);
    MH.mb.beam(add(vec(L.mirror), az, -0.02), [0, L.mirror.y + 0.075, L.mirror.z + 0.02], 0.012);
    this.group.add(MH.build(material));

    // The omamori under the mirror.
    const C = new Cab();
    C.color(0xd8c8a0);
    C.mb.beam([0, 0, 0], [0, -0.092, 0], 0.002);
    C.color(S.charm);
    C.rbox([0, -0.112, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.013, 0.02, 0.0035], 0.003);
    C.color(0xc8a040);
    C.rbox([0, -0.112, 0.004], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.007, 0.011, 0.0006], 0.0005);
    this.charm.add(C.build(material));
    this.charm.position.set(0, L.mirror.y - 0.04, L.mirror.z - 0.01);
    this.group.add(this.charm);

    // Pedals (`pedalsOf`): hinged at the top, the pads toward the driver: bright metal with rubber ribs, so they
    // show in the dark of the footwell.
    for (const p of pedalsOf(type)) {
      const P = new Cab();
      P.color(0x3a3a3e);
      P.mb.beam([0, 0, 0], [p.pad.x, p.pad.y + 0.02, p.pad.z + 0.01], 0.011);
      const [w, h] = p.half;
      P.color(0xb4b6bc);
      P.tbox([p.pad.x, p.pad.y, p.pad.z], [w, h, 0.007], 0.35, 0.004);
      // Ribs across the pad, standing just proud of its face (the face looks back and up at the driver).
      P.color(0x1c1c1f);
      const n = p.kind === 'throttle' ? 5 : 3;
      for (let i = 0; i < n; i++) {
        const t = ((i + 0.5) / n - 0.5) * 2 * (h - 0.008);
        P.tbox([p.pad.x, p.pad.y + t * Math.cos(0.35), p.pad.z - 0.009 + t * Math.sin(0.35)], [w - 0.006, 0.0035, 0.003], 0.35, 0.001);
      }
      const pivot = new THREE.Group();
      pivot.position.copy(p.hinge);
      pivot.add(P.build(material));
      this.group.add(pivot);
      this.pedals.push({ pivot, kind: p.kind });
    }

    // The gear lever and the handbrake.
    if (S.shifter !== 'column') {
      const G = new Cab();
      G.color(0x2a2a2e);
      G.mb.beam([0, 0, 0], [0, S.shifter === 'manual' ? 0.16 : 0.13, 0], 0.008);
      G.color(S.shifter === 'manual' ? 0x1a1a1c : 0x3a3a3e);
      if (S.shifter === 'manual') G.mb.latheSmooth(0, 0.175, 0, 0.026, 0.024, [[0.152, 0.008], [0.16, 0.02], [0.175, 0.027], [0.19, 0.02], [0.198, 0.004]], 10);
      else G.rbox([0, 0.15, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.02, 0.035, 0.028], 0.012);
      this.lever.add(G.build(material));
      this.lever.position.copy(L.shifter);
      this.group.add(this.lever);
    }
    if (S.shifter === 'manual') {
      const H = new Cab();
      H.color(0x1c1c1f);
      H.mb.beam([0, 0, 0], [0, 0.02, 0.2], 0.014);
      H.color(0x9a9aa0);
      H.mb.beam([0, 0.02, 0.2], [0, 0.022, 0.235], 0.006);
      this.handbrake.add(H.build(material));
      this.handbrake.position.set(L.side * 0.2, L.shifter.y - 0.02, L.seat.z - 0.12);
      this.group.add(this.handbrake);
    }
    this.group.visible = false;
  }

  /** Puts a picture in the rear-view mirror (race/driveCam.ts' RearMirror), or takes it away (null). */
  showMirror(material: THREE.Material | null): void {
    if (material) this.mirror.material = material;
    this.mirror.visible = !!material;
  }

  /**
   * Rain on the windscreen, seen from the seat: how wet (0-1), the wipers' phase and beat (models/wipers.ts), how
   * far the drops have run (m: down the glass standing, up it at speed) and the light they catch.
   */
  setRain(wet: number, phase: number, beat: number, run: number, tint: THREE.Color): void {
    const u = this.glassU;
    this.glass.visible = wet > 0.02;
    u.uWet.value = wet;
    u.uPivots.value.z = phase;
    u.uBeat.value = beat;
    u.uRun.value = run;
    u.uTint.value.copy(tint);
  }

  /** Where the handbrake's grip is now (this group's frame), for the hand that pulls it; null with no lever (an automatic's is a pedal). */
  brakeGrip(out: THREE.Vector3): THREE.Vector3 | null {
    if (this.S.shifter !== 'manual') return null;
    this.handbrake.updateMatrix();
    return out.set(0, 0.021, 0.215).applyMatrix4(this.handbrake.matrix);
  }

  /** Where the gear lever's knob is now (this group's frame: the car's), for the hand that works it; null with none to hold. */
  knob(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.knobUp) return null;
    this.lever.updateMatrix();
    return out.set(0, this.knobUp, 0).applyMatrix4(this.lever.matrix);
  }

  /** Each frame while shown: the wheel, needles, pedals, lever, handbrake, charm and the backlight. */
  update(s: CabinState, dt: number): void {
    if (!this.group.visible) return;
    dt = Math.min(dt, 0.05);
    const M = this.motion;
    M.advance({ ...s, speed: s.kmh / 3.6 }, dt);
    this.wheel.parent!.quaternion.setFromAxisAngle(this.layout.wheel.axis, -M.wheel);
    this.wheel.parent!.position.copy(this.layout.wheel.c).sub(this.layout.wheel.c.clone().applyQuaternion(this.wheel.parent!.quaternion));
    // Needles chase their readings (a little lag, as real ones have).
    const k = Math.min(1, dt * 14);
    this.shown.tach += (THREE.MathUtils.clamp(s.rpm / this.rpmMax, 0, 1.02) - this.shown.tach) * k;
    this.shown.speed += (THREE.MathUtils.clamp(s.kmh / this.speedMax, 0, 1.02) - this.shown.speed) * k;
    this.shown.small += ((s.boost !== undefined ? 0.25 + 0.75 * s.boost : 0.62) - this.shown.small) * Math.min(1, dt * 5);
    for (const n of this.needles) {
      const t = n.dial.kind === 'tach' ? this.shown.tach : n.dial.kind === 'speed' ? this.shown.speed : this.shown.small;
      n.pivot.rotation.z = dialAngle(t, n.dial.r < 0.04 && n.dial.kind !== 'tach' && n.dial.kind !== 'speed');
    }
    const lit = 0.55 + 0.75 * s.lamps;
    this.faceMat.color.setScalar(lit);
    this.needleMat.color.set(this.S.gauges.needle).multiplyScalar(0.8 + 1.2 * s.lamps);
    // The pedals, as far down as the feet have them.
    for (const p of this.pedals) p.pivot.rotation.x = -(p.kind === 'clutch' ? M.clutch : p.kind === 'brake' ? M.brake : M.throttle) * PEDAL_SWING;
    // The lever through the gate: across first at neutral, then along.
    let gx = 0;
    let gz = 0;
    if (this.S.shifter === 'manual') {
      const g = M.gear;
      const lane = g === 0 ? -1 : g <= 2 ? 1 : g <= 4 ? 0 : -1;
      gx = lane * 0.16;
      gz = g === 0 ? -0.22 : g % 2 === 1 ? 0.22 : -0.22;
    } else gz = M.gear === 0 ? 0.1 : -0.18;
    const cur = this.gate;
    const step = dt * 3.2;
    if (Math.abs(cur.x - gx) > 0.01 && Math.abs(cur.z) > 0.02) cur.z -= Math.sign(cur.z) * Math.min(Math.abs(cur.z), step);
    else if (Math.abs(cur.x - gx) > 0.005) cur.x += Math.sign(gx - cur.x) * Math.min(Math.abs(gx - cur.x), step * 0.8);
    else cur.z += Math.sign(gz - cur.z) * Math.min(Math.abs(gz - cur.z), step);
    // (+z tips the knob forward, +x to the car's left.)
    this.lever.rotation.set(cur.z, 0, -cur.x, 'XYZ');
    // (The lever comes up in his hand, where the cabin has one to pull.)
    this.handbrake.rotation.x += (((this.S.shifter === 'manual' ? M.pulled : s.handbrake) ? -0.42 : 0) - this.handbrake.rotation.x) * Math.min(1, dt * 16);
    // The charm: a pendulum in the car's accelerating frame (forward and across), knocked by bumps.
    const G = 9.81;
    const len = 0.13;
    const sw = this.swing;
    if (s.bump && s.bump > 1) {
      sw.va += (Math.random() - 0.5) * s.bump * 1.2;
      sw.vb += (Math.random() - 0.5) * s.bump * 1.2;
    }
    const aEq = Math.atan2(s.ax, G);
    const bEq = Math.atan2(-s.ay, G);
    sw.va += ((G / len) * Math.sin(aEq - sw.a) - 3.2 * sw.va) * dt;
    sw.vb += ((G / len) * Math.sin(bEq - sw.b) - 3.2 * sw.vb) * dt;
    sw.a = THREE.MathUtils.clamp(sw.a + sw.va * dt, -0.75, 0.75);
    sw.b = THREE.MathUtils.clamp(sw.b + sw.vb * dt, -0.75, 0.75);
    this.charm.rotation.set(sw.a, 0, sw.b, 'XYZ');
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}

/**
 * The windscreen's inside: a strip along the glass's own profile, a centimetre in from it, its uv the wipers'
 * coordinates (s across, t up their plane: models/wipers.ts), drawn over the view: drops that run and beads
 * that cling (real/carRainGlsl.ts), each a little lens catching the light at its foot, wiped away by the blades'
 * fans and coming back until they're round again; a faint film where the blades don't reach.
 */
function insideGlass(type: CarType, uniforms: Record<string, THREE.IUniform>): THREE.Mesh {
  const W = wiperLayout(type);
  const rows = glassRows(type, 10);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  rows.forEach((r, i) => {
    for (const s of [-1, 1]) {
      // (In from the glass along its inward normal, (z: -up.y, y: up.z).)
      pos.push(s * r.half, r.y + 0.012 * W.up[0], r.z - 0.012 * W.up[1]);
      uv.push(s * r.half, r.t);
    }
    if (i > 0) idx.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2 - 1, i * 2 + 1, i * 2);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  (uniforms.uLen as THREE.IUniform<number>).value = W.length;
  (uniforms.uPivots as THREE.IUniform<THREE.Vector3>).value.set(W.pivots[0], W.pivots[1], 9);
  const m = new THREE.Mesh(
    g,
    new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vG; void main() { vG = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        varying vec2 vG;
        uniform float uRun;
        uniform float uWet;
        uniform float uBeat;
        uniform float uLen;
        uniform vec3 uPivots;
        uniform vec3 uTint;
        float h2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        ${CAR_RAIN_GLSL}
        ${WIPER_GLSL}
        void main() {
          vec2 wf = wiperFan(vG, uPivots, uLen, uBeat);
          float keep = 1.0 - wf.x * (1.0 - smoothstep(0.15, 1.7, wf.y));
          vec3 drop = rainRuns(vG, uRun) * vec3(1.0, 1.0, uWet);
          if (drop.z <= 0.0) drop = rainBeads(vG / 0.026, 0.3 * uWet, 7.0);
          if (drop.z <= 0.0) drop = rainBeads(vG / vec2(0.011, 0.014) + 5.0, 0.5 * uWet, 53.0);
          drop.z *= keep;
          // A drop is a lens: seen from behind it's dark round its edge and bright at its foot (the sky, upside down).
          float dl = min(length(drop.xy), 1.0);
          float pool = smoothstep(-0.3, 0.9, dot(drop.xy, vec2(0.2, -0.98))) * (1.0 - dl * dl);
          float spark = 1.0 - smoothstep(0.0, 0.32, length(drop.xy - vec2(0.15, -0.45)));
          float rim = smoothstep(0.5, 1.0, dl);
          float light = 0.03 + 0.9 * pool + 2.4 * spark;
          float a = drop.z * clamp(0.62 * rim + 0.6 * pool + spark, 0.0, 0.95);
          // The film of water where the blades haven't been.
          float film = 0.05 * uWet * keep * (1.0 - drop.z);
          gl_FragColor = vec4(uTint * mix(0.25, light, step(0.001, drop.z)), max(a, film));
        }`,
    }),
  );
  m.visible = false;
  m.renderOrder = 3;
  return m;
}

/** The rotation that takes z to `axis` and y to `up`. */
function frameQuat(axis: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  const x = new THREE.Vector3().crossVectors(up, axis).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, axis));
}

// ---- the parts of the cabin ----

/**
 * The inside of the body's skin: its cross-sections between the back and the windscreen's foot, moved in by a few
 * centimetres and facing in, open where the body has glass; the floor flat (over the wheel arches, their tubs);
 * the firewall closing the front.
 */
function shell(cab: Cab, B: BodyShape, S: StyleDef, L: CockpitLayout): void {
  const half = B.L / 2;
  const xr = B.x0 + 0.03;
  const xf = B.windscreen[1] + 0.03;
  const within = (x: number, r: readonly [number, number]): boolean => x >= r[0] && x <= r[1];
  const keys = [B.windscreen[0], B.windscreen[1], B.rearGlass[0], B.rearGlass[1], B.sideGlass[0], B.sideGlass[1], ...B.pillars.flat()].filter((x) => x > xr && x < xf);
  const xs: number[] = [];
  for (let x = xr; x < xf; x += 0.06) xs.push(x);
  xs.push(xf, ...keys);
  xs.sort((a, b) => a - b);
  const st = xs.filter((x, i) => i === 0 || x - xs[i - 1] > 0.004);
  const INSET = 0.03;
  // Each station's inner ring (half: the 11 points from the floor's middle up the side to the roof's middle).
  const ring = (x: number): { p: [number, number][]; n: [number, number][] } => {
    const h = B.section(x);
    const p: [number, number][] = [];
    const n: [number, number][] = [];
    for (let k = 0; k < h.length; k++) {
      const a = h[Math.max(0, k - 1)];
      const b = h[Math.min(h.length - 1, k + 1)];
      // The section's tangent (dy, dz), and its inward normal.
      let ty = b[0] - a[0];
      let tz = b[1] - a[1];
      if (k === 0) [ty, tz] = [0, 1];
      if (k === h.length - 1) [ty, tz] = [0, -1];
      const l = Math.hypot(ty, tz) || 1;
      let ny = tz / l;
      let nz = -ty / l;
      if (nz > 0.01 || (Math.abs(nz) <= 0.01 && h[k][0] < (h[0][0] + h[h.length - 1][0]) / 2 && ny < 0)) {
        ny = -ny;
        nz = -nz;
      }
      let y = h[k][0] + ny * INSET;
      const z = Math.max(0, h[k][1] + nz * INSET);
      let nyy = ny;
      let nzz = nz;
      if (y < L.floor) {
        y = L.floor;
        nyy = 1;
        nzz = 0;
      }
      p.push([y, z]);
      n.push([nyy, nzz]);
    }
    return { p, n };
  };
  const rings = st.map(ring);
  const open = (xm: number, k: number): boolean => {
    if (k === 6) return within(xm, B.sideGlass) && !B.pillars.some((p) => within(xm, p));
    if (k >= 8) return !(B.softTop && xm < B.windscreen[0]) && (within(xm, B.windscreen) || within(xm, B.rearGlass));
    return false;
  };
  const colourOf = (k: number): void => {
    if (k === 0) cab.color(S.carpet);
    else if (k <= 4) cab.color(S.trim);
    else if (k === 5) cab.color(S.upper);
    else if (k <= 7) cab.color(S.liner, 0.85);
    else cab.color(S.liner);
  };
  for (let i = 0; i + 1 < st.length; i++) {
    const xm = (st[i] + st[i + 1]) / 2;
    const A = rings[i];
    const Bn = rings[i + 1];
    for (let k = 0; k < 10; k++) {
      if (open(xm, k)) continue;
      colourOf(k);
      for (const s of [1, -1]) {
        const P = (r: typeof A, j: number, x: number): V3 => [s * r.p[j][1], r.p[j][0], x - half];
        const N = (r: typeof A, j: number): V3 => [s * r.n[j][1], r.n[j][0], 0];
        cab.mb.quadN(P(A, k, st[i]), P(Bn, k, st[i + 1]), P(Bn, k + 1, st[i + 1]), P(A, k + 1, st[i]), N(A, k), N(Bn, k), N(Bn, k + 1), N(A, k + 1));
      }
    }
  }
  // The firewall and the back, closing the ends.
  for (const [r, x, dir] of [[rings[rings.length - 1], xf, -1], [rings[0], xr, 1]] as const) {
    cab.color(dir < 0 ? S.trim : S.trim, 0.6);
    const cy = (r.p[0][0] + r.p[r.p.length - 1][0]) / 2;
    for (const s of [1, -1]) {
      for (let k = 0; k + 1 < r.p.length; k++) {
        cab.quad([0, cy, x - half], [s * r.p[k][1], r.p[k][0], x - half], [s * r.p[k + 1][1], r.p[k + 1][0], x - half], [s * r.p[k + 1][1], r.p[k + 1][0], x - half], [0, 0, dir]);
      }
    }
  }
  void L;
}

/** The front seats, and the rear ones (a bench, or a 2+2's pair). */
function seats(cab: Cab, B: BodyShape, S: StyleDef, L: CockpitLayout): void {
  const recline = S.seats === 'bucket' ? 0.3 : S.tilt > 0.5 ? 0.14 : 0.24;
  const front = (sx: number): void => {
    const y = L.seat.y;
    const hz = L.seat.z;
    const w = Math.min(0.27, L.halfW * 0.36);
    // Rails and the cushion, its front edge raised.
    cab.color(0x1a1a1c);
    cab.abox(sx - w * 0.8, sx + w * 0.8, L.floor, y - 0.09, hz - 0.12, hz + 0.32, 0.01);
    cab.color(S.seat);
    cab.tbox([sx, y - 0.05, hz + 0.14], [w, 0.055, 0.25], -0.12, 0.03);
    cab.color(S.insert);
    cab.tbox([sx, y - 0.0, hz + 0.14], [w * 0.62, 0.012, 0.22], -0.12, 0.008);
    // The back, leaning back from the hips.
    const up: V3 = [0, Math.cos(recline), -Math.sin(recline)];
    const fwd: V3 = [0, Math.sin(recline), Math.cos(recline)];
    const base: V3 = [sx, y - 0.02, hz - 0.13];
    const tall = S.seats === 'bucket' ? 0.4 : 0.32;
    cab.color(S.seat);
    cab.rbox(add(base, up, tall), [1, 0, 0], up, fwd, [w, tall, 0.07], 0.035);
    cab.color(S.insert);
    cab.rbox(add(add(base, up, tall * 0.9), fwd, 0.07), [1, 0, 0], up, fwd, [w * 0.6, tall * 0.8, 0.01], 0.008);
    if (S.seats !== 'plain') {
      // Bolsters: wings on the back, rolls on the cushion.
      cab.color(S.seat, 0.9);
      for (const s of [-1, 1]) {
        // Turned in toward the middle about the back's own up.
        const a = -s * 0.45;
        const across = turn([1, 0, 0], up, a);
        const along = turn(fwd, up, a);
        cab.rbox(add(add(base, up, tall * 0.85), [s * (w - 0.01), 0, 0], 1), across, up, along, [0.03, tall * 0.72, 0.085], 0.025);
        cab.tbox([sx + s * (w - 0.02), y - 0.0, hz + 0.12], [0.035, 0.055, 0.22], -0.12, 0.025);
      }
    }
    if (S.seats === 'bucket') {
      // The harness slots up top.
      cab.color(0x060607);
      for (const s of [-1, 1]) cab.rbox(add(add(add(base, up, tall * 1.72), fwd, 0.072), [s * 0.075, 0, 0]), [1, 0, 0], up, fwd, [0.025, 0.035, 0.002], 0.002);
    } else {
      // A headrest on two posts.
      const hr = add(base, up, tall * 2 + 0.13);
      cab.color(0x2a2a2e);
      for (const s of [-1, 1]) cab.mb.beam(add(add(base, up, tall * 2 - 0.02), [s * 0.06, 0, 0]), add(hr, [s * 0.06, 0, 0]), 0.007);
      cab.color(S.lace ? 0xeeeeea : S.seat);
      cab.rbox(add(hr, up, 0.05), [1, 0, 0], up, fwd, [0.13, 0.09, 0.055], 0.04);
    }
    if (S.lace) {
      // The lace cover over the back's top.
      cab.color(0xf2f2ee);
      cab.rbox(add(add(base, up, tall * 1.72), fwd, 0.004), [1, 0, 0], up, fwd, [w + 0.006, tall * 0.3, 0.074], 0.036);
    }
  };
  front(L.side);
  front(-L.side);
  const half = B.L / 2;
  // The rear wheels' tubs, where the cabin reaches over them.
  const rw = B.wheelX[0] - half;
  if (rw + 0.3 > L.back) {
    cab.color(S.trim, 0.8);
    for (const s of [-1, 1]) {
      const x = s * (B.halfW(B.wheelX[0]) - 0.16);
      cab.abox(x - 0.13, x + 0.13, L.floor, B.wheelR * 2 + 0.06, Math.max(L.back, rw - 0.36), rw + 0.36, 0.06);
    }
  }
  if (!S.rear) {
    // A bulkhead behind the seats (the roadster's engine, the truck's cab's back).
    cab.color(S.trim, 0.6);
    const w = B.halfW(L.back + half) - 0.03;
    cab.abox(-w, w, L.floor, B.top(L.back + half) - 0.03, L.back - 0.02, L.back, 0.005);
    return;
  }
  // The rear seats: a bench across, its back against the back of the cabin, under the rear glass or the roof.
  const R = rearSeats(B, S, L);
  if (!R) return;
  const { rz, iw, ry, two } = R;
  cab.color(S.seat);
  for (const sx of two ? [-iw * 0.5, iw * 0.5] : [0]) {
    const w = two ? iw * 0.42 : iw;
    cab.tbox([sx, ry - 0.06, rz + 0.18], [w, 0.06, 0.2], -0.1, 0.03);
    cab.color(S.insert);
    cab.tbox([sx, ry, rz + 0.18], [w * 0.8, 0.01, 0.17], -0.1, 0.006);
    cab.color(S.seat);
    cab.tbox([sx, ry + 0.26, rz - 0.04], [w, 0.28, 0.06], 0.28, 0.03);
  }
  // The parcel shelf to the rear glass's foot (saloons and coupes with a boot).
  const glassFoot = B.rearGlass[0] - half;
  const shelf = Math.min(ry + 0.56, B.top(B.rearGlass[0]) - 0.04);
  if (glassFoot < rz - 0.1) {
    cab.color(S.upper);
    cab.abox(-iw, iw, shelf - 0.02, shelf, glassFoot, rz - 0.08, 0.005);
  }
}

/** The dash: its top to the windscreen, the face toward you, the gauge hood, the centre stack, the console. */
function dashboard(cab: Cab, B: BodyShape, S: StyleDef, L: CockpitLayout): void {
  const half = B.L / 2;
  const { lip, top, front } = L.dash;
  const hw = (z: number): number => B.halfW(z + half) - 0.035;
  const w0 = hw(lip);
  const w1 = hw(front);
  const knee = top - 0.24;
  const low = Math.max(L.floor + 0.25, top - 0.42);
  // The cluster's opening under its hood, in front of the driver: the dash is cut away there down to the face's foot.
  const hx = L.side;
  const ox0 = hx - CLUSTER_HALF;
  const ox1 = hx + CLUSTER_HALF;
  const oy = top - 0.105;
  const back = lip + 0.135;
  // The top, from the lip to the glass, round the opening.
  cab.color(S.upper);
  const wAt = (z: number): number => w0 + ((w1 - w0) * (z - lip)) / (front - lip);
  const topPiece = (xa: (z: number) => number, xb: (z: number) => number, za: number): void =>
    cab.quad([xa(za), top, za], [xb(za), top, za], [xb(front), top, front], [xa(front), top, front], [0, 1, 0]);
  topPiece((z) => -wAt(z), () => ox0, lip);
  topPiece(() => ox1, (z) => wAt(z), lip);
  topPiece(() => ox0, () => ox1, back);
  // The face's profile: the rolled lip, down to the knees, then sloping away to the firewall.
  const prof: [number, number][] = [[top, lip], [top - 0.035, lip - 0.02], [knee, lip + 0.02], [low, lip + 0.18]];
  const face = (xa: number, xb: number, cut: number): void => {
    for (let i = 0; i + 1 < prof.length; i++) {
      let [ya, za] = prof[i];
      const [yb, zb] = prof[i + 1];
      if (yb >= cut) continue;
      if (ya > cut) {
        za += ((zb - za) * (ya - cut)) / (ya - yb);
        ya = cut;
      }
      cab.color(i === 0 ? S.upper : S.trim, i === 0 ? 1.1 : 1);
      cab.quad([xa, ya, za], [xb, ya, za], [xb, yb, zb], [xa, yb, zb], [0, (za - zb) / Math.max(0.01, ya - yb) * -1 + 0.3, -1]);
    }
  };
  face(-w0, ox0, 9);
  face(ox1, w0, 9);
  face(ox0, ox1, oy);
  // The opening's floor, back to the recess.
  cab.color(S.upper, 0.8);
  const zOy = lip - 0.02 + (0.04 * 0.07) / 0.205;
  cab.quad([ox0, oy, zOy], [ox1, oy, zOy], [ox1, oy, back], [ox0, oy, back], [0, 1, 0]);
  // The dash's ends against the doors.
  for (const s of [-1, 1]) {
    cab.color(S.trim);
    cab.quad([s * w0, top, lip], [s * w1, top, front], [s * w1, low, front], [s * w0, low, lip + 0.18], [-s, 0, 0]);
  }
  // The knee panel under it, down to just over the pedals: the footwell's behind it, out of sight.
  cab.color(S.trim, 0.85);
  const kneeLow = L.pedals.y + 0.2;
  if (kneeLow < low) cab.quad([-w0, low, lip + 0.18], [w0, low, lip + 0.18], [w0, kneeLow, lip + 0.2], [-w0, kneeLow, lip + 0.2], [0, 0, -1]);
  if (S.accent !== undefined) {
    // A strip across the face (wood, or a colour).
    cab.color(S.accent);
    cab.abox(-w0 + 0.02, L.side - 0.25, knee + 0.05, knee + 0.085, lip, lip + 0.03, 0.006);
    cab.abox(L.side + 0.25, w0 - 0.02, knee + 0.05, knee + 0.085, lip, lip + 0.03, 0.006);
  }
  // A demister slot along the glass.
  cab.color(0x050506);
  cab.abox(-w1 * 0.7, w1 * 0.7, top, top + 0.003, front - 0.08, front - 0.05, 0.001);
  // The gauge hood over the cluster: its roof, its cheeks down to the opening's floor, the visor's lip.
  cab.color(S.upper, 0.9);
  cab.rbox([hx, top + 0.045, lip + 0.07], [1, 0, 0], [0, 1, 0], [0, 0, 1], [CLUSTER_HALF + 0.01, 0.007, 0.085], 0.006);
  for (const s of [-1, 1]) cab.rbox([hx + s * CLUSTER_HALF, (oy + top + 0.045) / 2, lip + 0.06], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.008, (top + 0.045 - oy) / 2, 0.08], 0.004);
  cab.tbox([hx, top + 0.036, lip - 0.02], [CLUSTER_HALF + 0.01, 0.008, 0.028], -0.5, 0.004);
  // Behind the cluster's face: the recess.
  cab.color(0x050506);
  cab.quad([ox0, oy, back], [ox1, oy, back], [ox1, top + 0.04, back], [ox0, top + 0.04, back], [0, 0, -1]);
  // Vents: at either end and two in the middle.
  for (const vx of [-w0 + 0.1, w0 - 0.1, -0.07, 0.07]) {
    cab.color(0x0a0a0c);
    cab.abox(vx - 0.05, vx + 0.05, top - 0.09, top - 0.04, lip - 0.03, lip - 0.01, 0.006);
    cab.color(0x2a2a2e);
    for (let k = 0; k < 3; k++) cab.abox(vx - 0.048, vx + 0.048, top - 0.083 + k * 0.016, top - 0.079 + k * 0.016, lip - 0.034, lip - 0.024, 0.001);
  }
  // The centre stack: the radio (its display lit), the heater's knobs.
  cab.color(S.trim, 0.8);
  cab.abox(-0.13, 0.13, low + 0.02, knee - 0.01, lip + 0.02, lip + 0.12, 0.01);
  cab.color(0x0c0c0e);
  cab.abox(-0.1, 0.1, knee - 0.075, knee - 0.035, lip + 0.008, lip + 0.03, 0.004);
  const gl = new THREE.Color(S.gauges.glow);
  cab.glow([gl.r * 0.3, gl.g * 0.3, gl.b * 0.3]);
  cab.abox(-0.045, 0.045, knee - 0.064, knee - 0.048, lip + 0.006, lip + 0.008, 0.001);
  cab.color(0x2a2a2e);
  for (const kx of [-0.07, 0, 0.07]) cab.disc([kx, knee - 0.11, lip + 0.05], [0, 0.2, -1], 0.017, 12);
  // The glovebox's outline.
  cab.color(S.trim, 0.85);
  cab.abox(-L.side - 0.17, -L.side + 0.17, knee - 0.12, knee - 0.01, lip + 0.02, lip + 0.035, 0.006);
  // The column's shroud and its stalks.
  const c = vec(L.wheel.c);
  const ax = vec(L.wheel.axis);
  const up = vec(L.wheel.up);
  cab.color(S.upper);
  cab.rbox(add(c, ax, 0.16), [1, 0, 0], up, ax, [0.05, 0.045, 0.12], 0.02);
  cab.color(0x1a1a1c);
  for (const s of [-1, 1]) cab.mb.beam(add(add(c, ax, 0.08), up, -0.01), add(add(add(c, ax, 0.06), up, -0.005), [s * 0.14, 0, 0]), 0.006);
  // The console: the tunnel from the dash back between the seats, the lever's boot, an armrest (not the sports cars').
  const cz0 = L.seat.z - (S.seats === 'plain' ? 0.25 : 0.1);
  cab.color(S.trim, 0.9);
  cab.abox(-0.1, 0.1, L.floor, L.shifter.y - 0.01, cz0, lip + 0.12, 0.02);
  if (S.shifter !== 'column') {
    cab.color(0x0c0c0e);
    cab.abox(-0.045, 0.045, L.shifter.y - 0.012, L.shifter.y + 0.005, L.shifter.z - 0.05, L.shifter.z + 0.05, 0.01);
  }
  if (S.shifter === 'auto') {
    cab.color(S.seat);
    cab.abox(-0.09, 0.09, L.shifter.y, L.shifter.y + 0.08, cz0, L.seat.z + 0.05, 0.03);
  }
  // A dead pedal for the left foot, and the column shift's lever.
  cab.color(0x1a1a1c);
  cab.tbox([L.side + 0.24, L.floor + 0.08, L.pedals.z + 0.04], [0.03, 0.07, 0.01], 0.6, 0.004);
  if (S.shifter === 'column') {
    cab.mb.beam(add(add(c, ax, 0.1), [-0.04, 0, 0]), add(add(add(c, ax, 0.04), up, -0.04), [-0.2, 0, 0]), 0.007);
    cab.color(0x3a3a3e);
    cab.rbox(add(add(add(c, ax, 0.04), up, -0.04), [-0.21, 0, 0]), [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.022, 0.014, 0.014], 0.008);
  }
}

/** The cars old or plain enough to wind their windows by hand. */
const WINDERS: readonly CabinStyle[] = ['eighties', 'roadster', 'taxi', 'kei', 'van', 'truck'];

/** The doors' furniture on both sides: armrests, pulls, handles, speakers, the window switches or winders. */
function doors(cab: Cab, B: BodyShape, S: StyleDef, L: CockpitLayout): void {
  const half = B.L / 2;
  for (const s of [-1, 1]) {
    const z0 = L.seat.z - 0.3;
    const z1 = L.dash.lip - 0.02;
    const zm = (z0 + z1) / 2;
    const x = s * (B.halfW(zm + half) - 0.035);
    const arm = L.seat.y + 0.22;
    cab.color(S.seat, 0.9);
    cab.abox(x - s * 0.08, x, arm - 0.03, arm, z0 + 0.05, zm + 0.12, 0.015);
    if (S.accent !== undefined) {
      cab.color(S.accent);
      cab.abox(x - s * 0.012, x, arm + 0.05, arm + 0.075, z0 + 0.02, z1 - 0.05, 0.004);
    }
    // The handle, in the light grey of the old ones.
    cab.color(0x9a9aa0);
    cab.abox(x - s * 0.02, x, arm + 0.1, arm + 0.12, zm + 0.12, zm + 0.2, 0.005);
    cab.color(0x060607);
    cab.disc([x - s * 0.003, L.floor + 0.16, z1 - 0.12], [-s, 0, 0], 0.065, 16);
    if (WINDERS.includes(L.style)) {
      // A window winder (older, plainer cars).
      cab.color(0x1a1a1c);
      cab.disc([x - s * 0.01, arm - 0.08, zm + 0.05], [-s, 0, 0], 0.028, 10);
      cab.mb.beam([x - s * 0.012, arm - 0.08, zm + 0.05], [x - s * 0.03, arm - 0.06, zm + 0.1], 0.006);
    } else {
      cab.color(0x18181a);
      cab.abox(x - s * 0.07, x - s * 0.01, arm + 0.001, arm + 0.006, zm - 0.04, zm + 0.06, 0.003);
    }
    // The B-pillar's seat belt hanging down it (the passenger's; the driver's is on him).
    if (s > 0) {
      cab.color(0x1c1c20);
      cab.mb.beam([x - s * 0.04, L.eye.y + 0.06, L.seat.z - 0.28], [x - s * 0.05, L.seat.y + 0.05, L.seat.z - 0.24], 0.012);
    }
  }
}

/** Under the roof: the sun visors, the dome lamp, the grab handles. */
function roof(cab: Cab, B: BodyShape, S: StyleDef, L: CockpitLayout): void {
  if (B.softTop && L.roof < 1.0) {
    // A soft top's bows across.
    cab.color(0x18181a);
    for (const dz of [-0.2, 0.15]) cab.abox(-L.halfW + 0.05, L.halfW - 0.05, L.roof - 0.02, L.roof, L.eye.z + dz - 0.012, L.eye.z + dz + 0.012, 0.005);
  }
  const half = B.L / 2;
  const vz = B.windscreen[0] - half - 0.1;
  const vy = B.top(vz + half) - 0.045;
  cab.color(S.liner, 0.92);
  for (const s of [-1, 1]) cab.rbox([s * 0.3, vy, vz], [1, 0, 0], [0, 0.97, 0.25], [0, -0.25, 0.97], [0.17, 0.009, 0.075], 0.006);
  cab.color(0xdad6c8);
  cab.abox(-0.06, 0.06, L.roof - 0.012, L.roof + 0.01, L.eye.z - 0.1, L.eye.z - 0.02, 0.006);
  cab.color(S.liner, 0.75);
  cab.abox(L.halfW - 0.03, L.halfW, L.roof - 0.09, L.roof - 0.04, L.eye.z - 0.12, L.eye.z + 0.12, 0.008);
}
