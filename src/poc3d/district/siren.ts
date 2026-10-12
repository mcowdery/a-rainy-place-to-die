import * as THREE from 'three';
import type { BeaconHands } from '../../race/carDriver';
import { cockpitLayout } from '../models/carInterior';
import { bodyShape, type CarType } from '../models/vehicles';

/**
 * The siren Mack keeps in his glovebox: a magnetic red police beacon (the kind a plain-clothes detective slaps on the
 * roof) and the wail that goes with it. B at the wheel steps through off, lights and siren, lights only, and off; it
 * stays on when he gets out and leaves the car.
 *
 * Putting it up is acted (`press`, `hands`): his left hand reaches across to the glovebox and takes it out, brings it
 * to the middle of the car and hands it to his right, which carries it out of the driver's window and sets it on the
 * roof by the window; then the hand comes back to the wheel. Taking it down is the same the other way round. The
 * beacon is a single mesh that rides in whichever hand has it (`group`), and the lights and the wail start when it's
 * set on the roof and stop when it's lifted off. Without a driver to act it (or when he gets out part way) it just
 * comes on or goes off (`finish`).
 *
 * `OwnCar` holds one and fits it to the car's roof (`fit`, again when the car is swapped); the page flashes it
 * (`update`), lights the street with it (`uBeacon`), gives the traffic ahead its cue (`TrafficSystem.beacon`), feeds his hands (`CarDriver.hands`) and plays its wail (`AudioFrame.siren`).
 */

/** How often the two halves of the lens trade places (a full flash and its pair each second, in Hz). */
export const FLASH_HZ = 2.4;

/** Off; the flashing lights alone; the lights and the siren. */
export type SirenMode = 'off' | 'lights' | 'siren';
const ORDER: readonly SirenMode[] = ['off', 'siren', 'lights'];

/** The mode a press of B brings after `mode`: off, lights and siren, lights only, off. */
export const nextMode = (mode: SirenMode): SirenMode => ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];

/** Which half of the lens is lit at `t` seconds: 0 the car's left, 1 its right. */
export const litHalf = (t: number): 0 | 1 => (Math.floor(t * FLASH_HZ * 2) % 2) as 0 | 1;

/** How bright the beacon's red is on the street and the cab at `t` seconds: a pulse once a flash, never quite dark. */
export const pulse = (t: number): number => 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(t * FLASH_HZ * Math.PI * 2), 2);

// ---- The choreography (pure, so it's tested) ----

type Key<T> = readonly [t: number, v: T];
const smooth = (k: number): number => k * k * (3 - 2 * k);
const seg = (t: number, a: number, b: number): number => smooth(Math.min(1, Math.max(0, (t - a) / (b - a))));

/** A value along its keys, easing from each to the next; the first before them, the last after. */
export function sample(keys: readonly Key<number>[], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * seg(t, keys[i - 1][0], keys[i][0]);
  }
  return keys[keys.length - 1][1];
}

/** A point along its keys, the same way. */
export function samplePoint(keys: readonly Key<THREE.Vector3>[], t: number, out: THREE.Vector3): THREE.Vector3 {
  if (t <= keys[0][0]) return out.copy(keys[0][1]);
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) return out.copy(keys[i - 1][1]).lerp(keys[i][1], seg(t, keys[i - 1][0], keys[i][0]));
  }
  return out.copy(keys[keys.length - 1][1]);
}

/** The beacon's own size: its dome is this high over its base, and a hand on its side is this far out from its middle. */
const DOME = 0.14;
const GIRTH = 0.14;

/** One hand-over of the beacon: when it's taken and let go, who has it first, and the other's turn. */
interface Plan {
  readonly T: number;
  readonly takeAt: number;
  readonly dropAt: number;
  readonly first: 'left' | 'right';
  readonly handoff: readonly [number, number];
  readonly window: readonly [number, number];
  readonly left: { readonly s: readonly Key<number>[]; readonly at: readonly Key<THREE.Vector3>[] };
  readonly right: { readonly s: readonly Key<number>[]; readonly at: readonly Key<THREE.Vector3>[] };
}

/** Where things are in the car (the car's frame): the glovebox's handle, the place between his hands, the window's opening, and the hand by the beacon on the roof. */
export interface Spots {
  readonly glove: THREE.Vector3;
  readonly mid: THREE.Vector3;
  readonly midRight: THREE.Vector3;
  readonly window: THREE.Vector3;
  /** Over the roof's rail on the way, so the arm doesn't cut through the roof's edge. */
  readonly over: THREE.Vector3;
  readonly roofHand: THREE.Vector3;
}

/** Putting it up (`deploy`) and taking it down (`stow`). */
export function plans(p: Spots): { deploy: Plan; stow: Plan } {
  const k = <T>(...keys: Key<T>[]): readonly Key<T>[] => keys;
  const deploy: Plan = {
    T: 4.1,
    takeAt: 0.9,
    dropAt: 3.0,
    first: 'left',
    handoff: [1.7, 1.95],
    window: [1.6, 3.9],
    left: { s: k([0, 0], [0.7, 1], [1.8, 1], [2.4, 0]), at: k([0, p.glove], [0.9, p.glove], [1.7, p.mid]) },
    right: { s: k([1.2, 0], [1.8, 1], [3.5, 1], [4.1, 0]), at: k([1.2, p.midRight], [1.8, p.midRight], [2.5, p.window], [2.75, p.over], [3.0, p.roofHand], [3.3, p.roofHand], [3.55, p.over], [3.8, p.window]) },
  };
  const stow: Plan = {
    T: 3.9,
    takeAt: 1.2,
    dropAt: 3.3,
    first: 'right',
    handoff: [2.2, 2.4],
    window: [0, 2.0],
    right: { s: k([0, 0], [0.5, 1], [2.6, 1], [3.2, 0]), at: k([0, p.window], [0.5, p.window], [0.75, p.over], [1.0, p.roofHand], [1.2, p.roofHand], [1.45, p.over], [1.75, p.window], [2.3, p.midRight], [2.6, p.midRight]) },
    left: { s: k([1.8, 0], [2.3, 1], [3.3, 1], [3.9, 0]), at: k([1.8, p.mid], [2.4, p.mid], [3.1, p.glove], [3.3, p.glove]) },
  };
  return { deploy, stow };
}

/** What his hands do at `t` into a plan (car frame), and where the beacon's base is if he has it (else null). */
export function acted(plan: Plan, t: number, out: BeaconHands, base: THREE.Vector3): THREE.Vector3 | null {
  out.left = sample(plan.left.s, t);
  out.right = sample(plan.right.s, t);
  samplePoint(plan.left.at, t, out.leftAt);
  samplePoint(plan.right.at, t, out.rightAt);
  out.window = t >= plan.window[0] && t <= plan.window[1];
  if (t < plan.takeAt || t >= plan.dropAt) return null;
  // (In the left hand it hangs from the palm on its dome; in the right it's held from outside, its middle a hand's width in.)
  inLeft.copy(out.leftAt).addScaledVector(UP, -DOME);
  inRight.set(out.rightAt.x + GIRTH, out.rightAt.y - DOME / 2, out.rightAt.z);
  const w = seg(t, plan.handoff[0], plan.handoff[1]);
  return plan.first === 'left' ? base.copy(inLeft).lerp(inRight, w) : base.copy(inRight).lerp(inLeft, w);
}
const UP = new THREE.Vector3(0, 1, 0);
const inLeft = new THREE.Vector3();
const inRight = new THREE.Vector3();

// Bright enough to bloom, as the lamps (race/carView.ts); the dim side still shows as a lens.
const LIT = new THREE.Color(7, 0.35, 0.2);
const DIM = new THREE.Color(0.45, 0.02, 0.02);
let mats: { lit: THREE.MeshBasicMaterial; dim: THREE.MeshBasicMaterial; base: THREE.MeshBasicMaterial } | null = null;
const materials = (): NonNullable<typeof mats> =>
  (mats ??= {
    lit: new THREE.MeshBasicMaterial({ color: LIT, side: THREE.DoubleSide }),
    dim: new THREE.MeshBasicMaterial({ color: DIM, side: THREE.DoubleSide }),
    base: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.02, 0.025) }),
  });

export class Siren {
  mode: SirenMode = 'off';
  readonly group = new THREE.Group();
  private readonly halves: [THREE.Mesh, THREE.Mesh];
  private t = 0;
  private readonly at = new THREE.Vector3();
  /** Where it stands on the roof (the car's frame). */
  private readonly roofAt = new THREE.Vector3();
  private plan: { deploy: Plan; stow: Plan } | null = null;
  /** The hand-over under way, its time, and what it comes to. */
  private stage: { kind: 'deploy' | 'stow'; t: number } | null = null;
  private readonly acting: BeaconHands = { left: 0, right: 0, leftAt: new THREE.Vector3(), rightAt: new THREE.Vector3(), window: false };
  private readonly carried = new THREE.Vector3();
  /** Holds a hand-over where it is (for a script's photographs: debug-shots/siren.mjs), and `seek` moves it. */
  paused = false;

  constructor() {
    const m = materials();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.12, 0.03, 16), m.base);
    base.position.y = 0.015;
    const lens = (start: number): THREE.Mesh => {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.11, 12, 1, false, start, Math.PI), m.dim);
      h.position.y = 0.085;
      return h;
    };
    this.halves = [lens(Math.PI), lens(0)];
    this.group.add(base, ...this.halves);
    this.group.visible = false;
  }

  /** On the roof and flashing (with or without the wail). */
  get on(): boolean {
    return this.mode !== 'off';
  }

  /** Whether his hands are busy with it (a press while they are is ignored). */
  get busy(): boolean {
    return !!this.stage;
  }

  /**
   * Sets it on `parent` (the car's group) on the roof by the driver's window (so his hand can reach it), and works
   * out where his hands go for it.
   */
  fit(parent: THREE.Object3D, type: CarType): void {
    const B = bodyShape(type);
    const L = cockpitLayout(type);
    // Just behind his eyes' place (over the door), on the roof's driver's edge, in from the rail by the beacon's width.
    const xd = THREE.MathUtils.clamp(L.eye.z - 0.1 + B.L / 2, B.rearGlass[1] + 0.2, B.windscreen[0] - 0.1);
    // (The section's last point is the roof's middle; the one before it is its flat top's edge.)
    const roofHalf = B.section(xd).at(-2)?.[1] ?? 0.45;
    const across = -Math.max(0.12, roofHalf - 0.16);
    this.roofAt.set(across, B.top(xd) - 0.005, xd - B.L / 2);
    this.plan = plans({
      // The glovebox's handle, its inner edge, on the face of the dash toward him.
      glove: new THREE.Vector3(-L.side - 0.14, L.dash.top - 0.3, L.dash.lip - 0.03),
      // Between his hands, in front of his chest, under the wheel's hub.
      mid: new THREE.Vector3(L.wheel.c.x + 0.16, L.wheel.c.y - 0.12, L.wheel.c.z - 0.14),
      midRight: new THREE.Vector3(L.wheel.c.x + 0.04, L.wheel.c.y - 0.12, L.wheel.c.z - 0.14),
      // The window's opening, a hand's width past the door's skin.
      window: new THREE.Vector3(-(L.halfW + 0.14), L.eye.y + 0.02, L.eye.z + 0.05),
      // His hand on the beacon's outer side, beside it, up its dome.
      roofHand: new THREE.Vector3(across - GIRTH, this.roofAt.y + DOME / 2, this.roofAt.z),
      over: new THREE.Vector3(across - GIRTH - 0.18, this.roofAt.y + DOME / 2 + 0.1, this.roofAt.z),
    });
    this.group.position.copy(this.roofAt);
    parent.add(this.group);
  }

  /** Sets the mode at once; it starts on the same half each time. */
  set(mode: SirenMode): void {
    this.mode = mode;
    this.t = 0;
    this.stage = null;
    this.group.position.copy(this.roofAt);
    this.group.visible = this.on;
    if (this.on) this.flash();
  }

  /**
   * B: the next mode. With `acted` (a driver at the wheel to do it) putting it up or taking it down is a hand-over
   * (about four seconds), and its lights and wail come on when it's set on the roof and go when it's lifted off;
   * the change between lights and siren is at once. A press while his hands are busy does nothing (null).
   */
  press(acted: boolean): SirenMode | null {
    if (this.stage) return null;
    const next = nextMode(this.mode);
    if (acted && this.plan && (this.mode === 'off' || next === 'off')) {
      this.stage = { kind: this.mode === 'off' ? 'deploy' : 'stow', t: 0 };
      this.group.visible = this.mode !== 'off';
      return next;
    }
    this.set(next);
    return next;
  }

  /** Finishes any hand-over at once (he got out part way, or the page has no hands for it). */
  finish(): void {
    if (!this.stage) return;
    const to = this.stage.kind === 'deploy' ? 'siren' : 'off';
    this.set(to);
  }

  update(dt: number): void {
    const s = this.stage;
    if (s && this.plan) {
      const plan = this.plan[s.kind];
      if (!this.paused) s.t += dt;
      const base = acted(plan, s.t, this.acting, this.carried);
      const held = !!base;
      if (held) {
        this.group.position.copy(base);
        this.group.visible = true;
      }
      // Set on the roof, or lifted off it: the lights and the wail with it.
      if (s.kind === 'deploy' && s.t >= plan.dropAt && this.mode === 'off') {
        this.mode = 'siren';
        this.t = 0;
        this.group.position.copy(this.roofAt);
        this.group.visible = true;
      } else if (s.kind === 'stow' && s.t >= plan.takeAt && this.mode !== 'off') this.mode = 'off';
      if (s.kind === 'stow' && s.t >= plan.dropAt) this.group.visible = false;
      if (s.t >= plan.T) {
        this.stage = null;
        this.group.position.copy(this.roofAt);
        this.group.visible = this.on;
      }
    }
    if (!this.on) return;
    this.t += dt;
    this.flash();
  }

  /** Moves a hand-over under way to `t` seconds in (for a script's photographs). */
  seek(t: number): void {
    if (this.stage) this.stage.t = t;
  }

  /** What his hands do for the beacon now (the car's frame), or null when they're free. */
  hands(): BeaconHands | null {
    return this.stage && this.plan ? this.acting : null;
  }

  /** The beacon in the world (x, y, z) and how bright its red is now (0 off), for the city shader. */
  light(out: THREE.Vector4): void {
    if (!this.on || this.stage) {
      out.set(0, 0, 0, 0);
      return;
    }
    this.group.getWorldPosition(this.at);
    out.set(this.at.x, this.at.y + 0.15, this.at.z, pulse(this.t));
  }

  private flash(): void {
    const m = materials();
    const lit = litHalf(this.t);
    this.halves[0].material = lit === 0 ? m.lit : m.dim;
    this.halves[1].material = lit === 1 ? m.lit : m.dim;
  }
}
