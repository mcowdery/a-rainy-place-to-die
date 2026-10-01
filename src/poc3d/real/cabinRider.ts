import * as THREE from 'three';
import type { Blocker, FirstPerson, FloorAt } from '../controls';
import { CAR, carBlocked, carExit, seatNear, type Seat } from '../district/cabin';
import type { TrainSet2 } from './trainCar';

/**
 * Walking inside a moving train. The walker lives in a car's own frame (district/cabin.ts): each frame the
 * camera is taken into the car's frame, the ordinary controls walk it there against the car's layout (benches,
 * poles, walls, the gangways, the doors when open), and it's put back into the world wherever the car now is.
 * So you walk, run, jump and look round while the train runs, cross into the next car through the gangway, sit
 * down (and get up), and step out of an open door (the page then puts you on the platform).
 */

/** What the rider needs of a ride: the set (its cars), the side its doors open on, and how open they are. */
export interface Ridable {
  readonly set: TrainSet2;
  /** The platform's side in the cars' frame (+1 left, -1 right). */
  readonly doorSide: number;
  /** How open the doors are now (0 shut, 1 open). */
  doors(): number;
}

const EYE_SEATED = 1.2;

export class CabinRider {
  private ride: Ridable | null = null;
  private car = 0;
  /** The camera in the car's frame, and the car's yaw when the camera was last put in the world. */
  private readonly local = new THREE.Vector3();
  private carYaw = 0;
  private readonly m = new THREE.Matrix4();
  private readonly inv = new THREE.Matrix4();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private saved: { blocked: Blocker; floorAt: FloorAt | null } | null = null;
  /** Sitting on this seat (the controls are held). */
  seated: Seat | null = null;
  /** Set when the walker stepped out of an open door: where, in the world (the page takes it from there). */
  exited: THREE.Vector3 | null = null;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly controls: FirstPerson,
  ) {}

  get active(): boolean {
    return this.ride !== null;
  }

  /** Which car you're in (0 the back), and where in it. */
  get where(): { car: number; x: number; z: number } {
    return { car: this.car, x: this.local.x, z: this.local.z };
  }

  /** Board: stand in car `car` at (x, z) of its frame, facing local yaw (radians, the camera's convention). */
  board(ride: Ridable, car: number, x: number, z: number, yaw: number): void {
    this.ride = ride;
    this.car = car;
    this.seated = null;
    this.exited = null;
    this.local.set(x, CAR.FLOOR + 1.7, z);
    this.e.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.compose(yaw, this.e.x);
    this.controls.held = false;
  }

  /** Off the train: the controls back to the world's collision, standing at the camera's place. */
  leave(): void {
    if (!this.ride) return;
    this.restore();
    this.controls.held = false;
    this.ride = null;
    this.seated = null;
  }

  private frame(k = this.car): THREE.Matrix4 {
    const obj = this.ride!.set.cars[k].obj;
    obj.updateWorldMatrix(true, false);
    return this.m.copy(obj.matrixWorld);
  }

  private static yawOf(m: THREE.Matrix4): number {
    return Math.atan2(m.elements[8], m.elements[10]);
  }

  /** Before the controls move: the camera into the car's frame, the car's layout as the collision. */
  before(): void {
    if (!this.ride) return;
    const ends = this.ride.set.cars[this.car].ends;
    const side = this.ride.doors() > 0.85 ? this.ride.doorSide : 0;
    this.e.setFromQuaternion(this.camera.quaternion, 'YXZ');
    const yaw = this.e.y - this.carYaw;
    this.camera.position.copy(this.local);
    this.camera.quaternion.setFromEuler(this.e.set(this.e.x, yaw, 0, 'YXZ'));
    if (!this.saved) this.saved = { blocked: this.controls.blocked, floorAt: this.controls.floorAt };
    this.controls.blocked = (x, z, r) => carBlocked(x, z, r, ends, side);
    this.controls.floorAt = () => CAR.FLOOR;
    this.controls.setLevel(CAR.FLOOR);
  }

  /** After the controls moved: on through a gangway or out of a door, and the camera back into the world. */
  after(): void {
    if (!this.ride) return;
    const set = this.ride.set;
    if (!this.seated) this.local.copy(this.camera.position);
    this.e.setFromQuaternion(this.camera.quaternion, 'YXZ');
    let yaw = this.e.y;
    const side = this.ride.doors() > 0.85 ? this.ride.doorSide : 0;
    const exit = carExit(this.local.x, this.local.z, set.cars[this.car].ends, side);
    if (exit === 'front' || exit === 'back') {
      const k = this.car + (exit === 'front' ? 1 : -1);
      if (k >= 0 && k < set.cars.length) {
        // Into the next car: the same place in the world, in its frame.
        const world = this.local.clone().applyMatrix4(this.frame());
        const yawWorld = yaw + CabinRider.yawOf(this.m);
        this.car = k;
        this.local.copy(world.applyMatrix4(this.inv.copy(this.frame()).invert()));
        yaw = yawWorld - CabinRider.yawOf(this.m);
      }
    }
    this.restore();
    this.compose(yaw, this.e.x);
    if (exit === 'door') this.exited = this.camera.position.clone();
  }

  /** The camera into the world from the car's frame as the car stands now (call after the trains have moved). */
  compose(yaw?: number, pitch?: number): void {
    if (!this.ride) return;
    const m = this.frame();
    if (yaw === undefined || pitch === undefined) {
      this.e.setFromQuaternion(this.camera.quaternion, 'YXZ');
      yaw = this.e.y - this.carYaw;
      pitch = this.e.x;
    }
    this.carYaw = CabinRider.yawOf(m);
    this.camera.position.copy(this.local).applyMatrix4(m);
    this.camera.quaternion.setFromEuler(this.e.set(pitch, yaw + this.carYaw, 0, 'YXZ'));
  }

  private restore(): void {
    if (!this.saved) return;
    this.controls.blocked = this.saved.blocked;
    this.controls.floorAt = this.saved.floorAt;
    this.saved = null;
  }

  /** Face a direction in the car's frame (radians, the camera's yaw convention; for checks). */
  look(yaw: number, pitch = 0): void {
    this.compose(yaw, pitch);
  }

  /** The seat within reach (not while sitting). */
  seatNear(): Seat | null {
    if (!this.ride || this.seated) return null;
    return seatNear(this.local.x, this.local.z, this.ride.set.cars[this.car].ends, 0.8);
  }

  /** Sit on the seat within reach: eye at a sitting height over it, facing across the car. */
  sit(): boolean {
    const seat = this.seatNear();
    if (!seat) return false;
    this.seated = seat;
    this.controls.held = true;
    this.local.set(seat.x - seat.side * 0.18, CAR.FLOOR + EYE_SEATED, seat.z);
    // Facing across the car (the camera looks along -z of its own frame: yaw so it looks toward -side x).
    this.compose(seat.side > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
    return true;
  }

  /** Get up: a step out into the aisle. */
  stand(): void {
    if (!this.seated) return;
    const s = this.seated;
    this.seated = null;
    this.controls.held = false;
    this.local.set(s.side * (CAR.SEAT_X - 0.45), CAR.FLOOR + 1.7, s.z);
    this.compose();
  }
}
