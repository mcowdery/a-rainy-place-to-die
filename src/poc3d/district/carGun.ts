import * as THREE from 'three';
import type { CarDriver } from '../../race/carDriver';
import { driverLine } from '../../race/carDriver';
import { EYE, type Side } from '../../race/shooting';
import type { Crosshair } from '../models/crosshair';
import type { FirstPersonRig } from '../models/firstPerson';
import type { CityGunfire } from '../real/gunfire';
import type { Driving } from './driving';
import type { OwnCar } from './ownCar';

/**
 * Shooting from your car in the city, as on the race page (race/shooting.ts, race/main.ts): Mack's Type 54 from the
 * driver's seat. Japanese cars are right-hand drive, so his window is the right one: his arm goes out of it, a wide
 * arc from just ahead round to behind; to the left he shoots across the car through the passenger window, only
 * what it frames, and worse; the windscreen and the back are no line of fire (`sideFor`, `driverLine`): the
 * crosshair turns to a red cross and he pulls the gun back in. The windows wind down for the gun and back up after
 * (race/carDriver.ts).
 *
 * The right button aims: the view goes to his eyes, along an aim that holds its place in the world while the car
 * turns (district/driving.ts `startAim`), and the world slows to 30% while the focus lasts (2.5 s of it, refilling
 * over 6 s with the gun down; G turns that off). The left button fires: aimed, at what's under the crosshair; not
 * aimed, from the hip, with far more spread and never in slow motion. From the hip in the views on the car (his eyes,
 * the bonnet, the bumper) that's where you look; from the chase cameras (which look at your own car, from wherever
 * you've swung them) it's the way the camera looks past the car, level from his window, and at a car in a chase if
 * one's near that line (a drive-by: you swing the view its way and he shoots at it). R reloads (it reloads itself when it's empty). His shots are the city's
 * (real/gunfire.ts `shot`): they strike the street, the traffic and, in a chase, the other cars. An aimed shot that
 * would just miss a chase car is pulled most of the way onto it, as on the race page.
 */

/** Seconds of focus, and to refill it. */
const FOCUS_SECS = 2.5;
const FOCUS_REFILL = 6;
/** How much the world slows at full focus. */
const SLOW = 0.7;
/** The spread from the hip, and across the car, against an aimed shot out of his own window. */
const HIP = 4;
const ACROSS = 2.5;
/** From the hip, from outside the car: a chase car within this of the way the camera faces (rad, on the map) and this near (m) is what he shoots at. */
const DRIVE_BY = { cone: 0.3, reach: 75 } as const;
/** An aimed shot that misses a chase car by under this (rad) is pulled this much of the way onto it. */
const ASSIST = { cone: 0.035, pull: 0.6 } as const;
const ZERO = new THREE.Vector3();
/** How long the gun stays up after a shot from the hip, and the 'no line of fire' note shows (s). */
const HIP_HOLD = 1.2;
const BLOCKED = 0.9;

export interface CarGunHost {
  readonly camera: THREE.PerspectiveCamera;
  readonly gunfire: CityGunfire;
  readonly driving: Driving;
  readonly own: OwnCar;
  readonly crosshair: Crosshair;
  /** Mack at the wheel of your car (null: he isn't), and his rig. */
  seated(): CarDriver | null;
  rig(): FirstPersonRig | null;
  /** The mouse is the game's (captured), and nothing else has the screen (a scene, a menu). */
  live(): boolean;
}

export class CarGun {
  /** The world's slow motion now (0-1), and what's left of the focus. */
  slow = 0;
  focus = 1;
  /** Slow motion comes with the aim (G). */
  slowAuto = true;
  /** The gun's out of a window (aimed, or just fired from the hip). */
  out = false;
  /** The window the aim's through (null: none: no line of fire). */
  side: Side | null = null;
  private slowOn = false;
  private slowWas = 0;
  /** What the last shot met (for checks). */
  last: { what: string; dist: number; part: string | null } | null = null;
  private pulled = false;
  private hipT = 0;
  private blockedT = 0;
  /** Seconds since the gun was last out (he's still seen, putting it away and winding the window up, for a moment after). */
  private sinceOut = 99;
  private window: Side | null = null;
  private aimAt: THREE.Vector3 | null = null;
  private readonly note: HTMLDivElement;
  private readonly gun: HTMLDivElement;
  private readonly veil: HTMLDivElement;

  constructor(private readonly host: CarGunHost) {
    const el = (css: Partial<CSSStyleDeclaration>): HTMLDivElement => {
      const d = document.createElement('div');
      Object.assign(d.style, { position: 'fixed', zIndex: '17', display: 'none', pointerEvents: 'none', color: '#f0ecf8', font: "600 12px 'Segoe UI', 'Yu Gothic', sans-serif", textShadow: '0 1px 4px #000', ...css });
      document.body.append(d);
      return d;
    };
    this.note = el({ left: '50%', top: 'calc(50% + 34px)', transform: 'translateX(-50%)', letterSpacing: '0.12em', color: '#ffb0a0' });
    this.gun = el({ right: '18px', bottom: '64px', textAlign: 'right', lineHeight: '1.5' });
    this.veil = el({ inset: '0', zIndex: '15', background: 'radial-gradient(ellipse at center, rgba(120,150,255,0) 50%, rgba(40,60,140,0.55) 100%)', opacity: '0' });
    document.addEventListener('mousedown', (e) => {
      if (!this.ready()) return;
      host.gunfire.resume();
      if (e.button === 2) this.raise();
      if (e.button === 0) this.pulled = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.lower();
    });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement) this.lower();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.ready() || e.repeat) return;
      if (e.code === 'KeyR') host.rig()?.reload();
      if (e.code === 'KeyG') this.slowAuto = !this.slowAuto;
    });
  }

  /** At the wheel of your car, with the mouse: the gun's yours to use. */
  private ready(): boolean {
    return !!this.host.seated() && !!this.host.rig() && this.host.live();
  }

  /** He's to be seen at the wheel for the gun's sake: it's out, or only just put away. */
  get shown(): boolean {
    return this.out || this.sinceOut < 3;
  }

  /** Whether the right button has the gun up. */
  get aiming(): boolean {
    return !!this.host.driving.aim;
  }

  /** How fast the world runs (1, or slower while the focus holds). */
  get timeScale(): number {
    return 1 - SLOW * this.slow;
  }

  /** The gun up (`script`: without the mouse captured, for checks). */
  raise(script = false): void {
    if (this.aiming || !(script ? this.host.seated() && this.host.rig() : this.ready())) return;
    this.host.driving.startAim();
    if (this.slowAuto && this.focus > 0.25) this.slowOn = true;
  }

  lower(): void {
    this.slowOn = false;
    this.host.driving.stopAim();
  }

  /** Pull the trigger (a click; scripts). */
  fire(): void {
    this.pulled = true;
  }

  /** The middles of the chase cars' bodies (world). */
  private cars(): THREE.Vector3[] {
    return this.host.gunfire.bodies.filter((b) => b.userData.part === 'body').map((b) => b.getWorldPosition(new THREE.Vector3()));
  }

  /**
   * The point a shot goes to. `eyes`: the view is from the car (aimed, or a camera on it): what's under the
   * crosshair. Else (the chase cameras, from the hip): the way the camera looks past the car, level from his head,
   * or the chase car nearest that line.
   */
  private target(eyes: boolean): THREE.Vector3 {
    const cam = this.host.camera;
    cam.updateMatrixWorld();
    const look = cam.getWorldDirection(new THREE.Vector3());
    const G = this.host.gunfire;
    if (eyes) {
      const met = G.pick(cam.position, look, 220, G.bodies, true);
      return met ? met.point : cam.position.clone().addScaledVector(look, 160);
    }
    const car = this.host.own.view.obj;
    car.updateMatrixWorld();
    const head = car.localToWorld(new THREE.Vector3(EYE.x, EYE.y, EYE.z));
    // (The chase camera looks at a point by the car's nose, from wherever you've swung it round the car: the line
    // you mean is the way you've swung it, which it's still easing round to.)
    const yaw = this.host.own.sim.h + this.host.driving.look.yaw;
    let best: THREE.Vector3 | null = null;
    let bestOff: number = DRIVE_BY.cone;
    for (const c of this.cars()) {
      const d = Math.hypot(c.x - head.x, c.z - head.z);
      if (d > DRIVE_BY.reach || d < 1.5) continue;
      const off = Math.abs(Math.atan2(Math.sin(Math.atan2(c.x - head.x, c.z - head.z) - yaw), Math.cos(Math.atan2(c.x - head.x, c.z - head.z) - yaw)));
      if (off < bestOff) [best, bestOff] = [c, off];
    }
    if (best) return best;
    const dir = new THREE.Vector3(Math.sin(yaw), -0.012, Math.cos(yaw)).normalize();
    const met = G.pick(head, dir, 220, G.bodies, true);
    return met ? met.point : head.clone().addScaledVector(dir, 160);
  }

  /**
   * Each frame, once the camera's placed: `gdt` the world's step, `dt` real time. `cockpit`: the view is his eyes
   * (the driver's-eye camera, or aiming); `chase`: it's a chase camera, behind the car. `pedals`: as they're
   * pressed, for his feet.
   */
  update(gdt: number, dt: number, cockpit: boolean, chase: boolean, pedals: { throttle: number; brake: number }): void {
    const H = this.host;
    const seated = H.seated();
    const rig = H.rig();
    // The focus: drains while it slows the world, refills with the gun down.
    if (this.aiming && this.slowOn) {
      this.focus = Math.max(0, this.focus - dt / FOCUS_SECS);
      if (this.focus <= 0) this.slowOn = false;
    } else if (!this.aiming) this.focus = Math.min(1, this.focus + dt / FOCUS_REFILL);
    this.slow += ((this.slowOn && this.aiming ? 1 : 0) - this.slow) * Math.min(1, dt * 7);
    if (this.slow < 0.002) this.slow = 0;
    this.veil.style.display = this.slow > 0.01 ? 'block' : 'none';
    this.veil.style.opacity = (this.slow * 0.9).toFixed(3);
    if (this.slow !== this.slowWas) {
      this.slowWas = this.slow;
      H.own.sound.slow = this.slow;
      H.gunfire.setSlow(this.slow);
    }
    this.hipT = Math.max(0, this.hipT - dt);
    this.blockedT = Math.max(0, this.blockedT - dt);
    H.driving.eyeShift.copy(seated?.eyeShift ?? ZERO);
    if (!seated || !rig) {
      if (this.aiming) this.lower();
      this.pulled = false;
      this.out = false;
      this.side = null;
      this.note.style.display = this.gun.style.display = 'none';
      return;
    }
    const aiming = this.aiming;
    const car = H.own.view.obj;
    this.side = null;
    // (A view from the car: aimed, or a camera on it.)
    const eyes = aiming || !chase;
    if (aiming || this.pulled || this.hipT > 0) {
      const aimPoint = this.target(eyes);
      car.updateMatrixWorld();
      // In the car's own frame, lean and all, so the window's opening is exactly what it frames on the screen.
      const head = car.localToWorld(new THREE.Vector3(EYE.x, EYE.y, EYE.z));
      const dl = aimPoint.clone().sub(head).applyQuaternion(car.quaternion.clone().invert()).normalize();
      const rel = Math.atan2(dl.x, dl.z);
      const pitch = Math.asin(THREE.MathUtils.clamp(dl.y, -1, 1));
      // (His arm swings from the shoulder: too near straight ahead and the gun's inside, at the windscreen.)
      const line = driverLine(rel, pitch, seated.outFrom);
      this.side = line.side;
      // Off every window (the windscreen, behind on the left) he looks to the nearest shot he has, the gun pulled
      // back in (race/carDriver.ts `blocked`).
      const n = line.wait;
      const nd = new THREE.Vector3(Math.sin(n.rel) * Math.cos(n.pitch), Math.sin(n.pitch), Math.cos(n.rel) * Math.cos(n.pitch)).applyQuaternion(car.quaternion);
      // From the hip the gun stays where the shot went for its moment: swinging the view round the car with it still
      // up doesn't swing his arm about the cabin, nor wind the other window down (both were gone from the car as
      // soon as you looked round it: the user's 'window not showing').
      if (aiming || this.pulled || !this.window) {
        this.aimAt = this.side ? aimPoint : head.clone().addScaledVector(nd, 20);
        this.window = this.side ?? n.side;
      }
      if (this.pulled) {
        if (!aiming) this.hipT = HIP_HOLD;
        if (this.side && !H.own.totaled) seated.fire();
        else this.blockedT = BLOCKED;
      }
    }
    this.pulled = false;
    this.out = aiming || this.hipT > 0;
    this.sinceOut = this.out ? 0 : this.sinceOut + dt;
    if (!this.out) this.window = null;
    // (From the cameras outside the car with the gun away he isn't drawn, nor posed.)
    if (cockpit || this.shown) seated.update(H.own.sim, { raised: this.out, blocked: this.out && !this.side, window: this.window, aimPoint: this.aimAt, pov: cockpit ? 1 : 0, view: cockpit ? H.camera : null, throttle: pedals.throttle, brake: pedals.brake, calm: true }, gdt, dt);
    // His shots: from the muzzle at what's under the crosshair.
    for (let k = seated.newShots(); k > 0; k--) {
      const muzzle = rig.muzzle();
      const dir = this.target(eyes).sub(muzzle).normalize();
      // Aimed, a shot that would just miss a chase car is pulled most of the way to its middle.
      if (aiming) {
        let pull: THREE.Vector3 | null = null;
        let off: number = ASSIST.cone;
        for (const c of this.cars()) {
          const to = c.sub(muzzle);
          const a = to.angleTo(dir);
          if (a < off) [pull, off] = [to.normalize(), a];
        }
        if (pull && !H.gunfire.pick(muzzle, dir, 220, H.gunfire.bodies, true)?.body) dir.lerp(pull, ASSIST.pull).normalize();
      }
      const s = H.own.sim;
      const spread = (rig.gun.spread ?? 0.006) * (1 + Math.abs(s.slide) * 2.5 + s.speed / 30) * (!aiming ? HIP : this.window === 'across' ? ACROSS : 1);
      const vel = new THREE.Vector3(Math.sin(s.h) * s.u + Math.cos(s.h) * s.w, 0, Math.cos(s.h) * s.u - Math.sin(s.h) * s.w);
      const met = H.gunfire.shot({ muzzle, dir, spread, sound: 'pistol', listener: H.camera.position, skipOwn: true, by: 'you', vel });
      this.last = met ? { what: met.what, dist: +met.distance.toFixed(1), part: (met.body?.object.userData.part as string | undefined) ?? null } : null;
      H.driving.kick(aiming ? 0.035 : 0);
      H.crosshair.fired();
    }
    // (They're this module's to make: the rig's own shots along its bore are for on foot.)
    H.gunfire.sync(rig);
    const blocked = this.out && !this.side;
    H.crosshair.update(this.out, aiming ? 1 : 0.35, dt, blocked);
    const reloading = rig.reloading;
    this.note.style.display = this.out && (blocked || reloading || this.window === 'across') ? 'block' : 'none';
    this.note.textContent = blocked ? 'NO LINE OF FIRE' : reloading ? 'RELOADING' : 'THROUGH THE PASSENGER WINDOW';
    // (No shot: said in red, larger, and it jumps when you pull the trigger anyway.)
    Object.assign(this.note.style, blocked
      ? { color: '#ff2b3a', fontSize: '15px', fontWeight: '800', top: 'calc(50% + 40px)', transform: `translateX(-50%) scale(${(1 + this.blockedT * 0.35).toFixed(3)})` }
      : { color: '#ffb0a0', fontSize: '12px', fontWeight: '600', top: 'calc(50% + 34px)', transform: 'translateX(-50%)' });
    const bars = Math.round(this.focus * 10);
    this.gun.style.display = 'block';
    this.gun.innerHTML = `${rig.gun.label ?? 'Pistol'} · ${reloading ? 'reloading…' : '▮'.repeat(rig.shells) + '▯'.repeat(Math.max(0, rig.gun.shells - rig.shells))}<br><span style="opacity:${aiming || this.focus < 1 ? 1 : 0.45}">${this.slowAuto ? `FOCUS ${'▮'.repeat(bars)}${'▯'.repeat(10 - bars)}` : 'FOCUS off'}</span><br><span style="opacity:.55;font-weight:400">RMB aim · LMB fire · R reload · G focus</span>`;
  }
}
