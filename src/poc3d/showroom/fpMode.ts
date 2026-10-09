import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Bike } from '../models/bikeKit';
import { Crosshair } from '../models/crosshair';
import type { GlassesKind } from '../models/sunglasses';
import { FACE_SHADOW } from '../models/faceShadow';
import { FirstPersonRig } from '../models/firstPerson';
import { BodyFacing, footOffset, THIRD, ThirdPersonCamera, zoomed } from '../models/thirdPerson';
import { withCityMoves } from '../models/cityMoves';
import { GLASSES_LABELS, HELMET_LABELS, helmetLook, loadWardrobe, nextFace, nextGlasses, nextHelmet, nextOutfit, outfitById, saveWardrobe } from '../models/wardrobe';
import { FACE_STYLE_LABELS, type FaceStyle } from '../models/faceShadow';
import { MACK_GUNS, SHOTGUN_KINDS } from '../models/shotgun';
import { MackSmoke } from '../real/smoke';

/**
 * The showroom's first-person mode, for reviewing Mack's body and guns as the player will see them:
 * click to capture the mouse, mouse to look, WASD to walk (Shift faster), right button to raise the gun,
 * left to fire, R reload, G the other gun, H one hand or two, V back to orbiting. `__fp` scripts it for screenshots.
 * E by one of the showroom's bikes gets on (and off): W throttle, S brake (and back, slowly, from a stop),
 * A/D steer; the bike leans into the turn, the view rides with half the lean, the mouse looks about; X draws
 * the shotgun (in the right hand, the left on the bars: raised with the right button, fired with the left).
 * Fighting isn't here: it has a page of its own (fight.html), whose mode (fight/fightMode.ts) is this one with the
 * fight added through the hooks below (`onKey`, `onMouseDown`, `onMouseUp`, `held`, `meleeNow`, `fight`, `notWalls`).
 * O changes his clothes (models/wardrobe.ts), Z his sunglasses (none, wraparounds, aviators, slim), N how his face is
 * hidden (models/faceShadow.ts), K his motorcycle helmet (none, black, red and black). C, for reviewing the face
 * only, puts the camera in front of him: front, three quarter, profile, off (in play nothing ever looks him in the face).
 * Q switches to third person: over his right shoulder, always behind him (his body faces where you look, so
 * the camera never comes round to his face), closer while aiming, pulled in by walls; on a bike, behind it.
 */

/** A bike being ridden: where it is, its heading (0 faces -z), speed (m/s), steering and lean (radians). */
interface Ride {
  readonly bike: Bike;
  x: number;
  z: number;
  yaw: number;
  u: number;
  steer: number;
  lean: number;
}

/** The review mirror's views: none, then the camera's angle round from his front (radians) and distance (metres). */
const MIRRORS: readonly ({ angle: number; dist: number } | null)[] = [null, { angle: 0, dist: 0.5 }, { angle: 0.75, dist: 0.55 }, { angle: 1.5, dist: 0.6 }];

/** How far round a seated rider you can look in third person (radians each way; his head stays ahead). */
const RIDE_LOOK_THIRD = 1.1;

/** A jump: take-off speed (m/s) and gravity (m/s^2), the city's (controls.ts). */
const JUMP_V = 4.4;
const GRAVITY = 12;
/** The ride's numbers: wheelbase, top speed, throttle, brakes, drag, gravity. */
const RIDE = { wheelbase: 1.64, top: 22, accel: 3.2, brake: 8, drag: 0.35, airDrag: 0.01, g: 9.81, maxLean: (30 * Math.PI) / 180 };
export class FpMode {
  active = false;
  /** Holds the pose and lets the camera go (scripted shots from outside). */
  frozen = false;
  /** The body, for the page's censor pass (models/censorPass.ts). */
  get body(): FirstPersonRig | null {
    return this.active ? this.rig : null;
  }
  protected rig: FirstPersonRig | null = null;
  /** His smoke (J lights a cigarette or, with Shift, a cigar; J again flicks it away). */
  private readonly smoke = new MackSmoke();
  private readonly air = new THREE.Vector2();
  /** Which way he faces in third person, apart from the camera (models/thirdPerson.ts). */
  protected readonly facing = new BodyFacing();
  /** A script's own mirror (for shots: __fp.watch): the camera this far round from in front of his face, this far off. */
  private watch: { angle: number; dist: number } | null = null;
  /** For shots: a pace to show his stride at without his going anywhere (m/s), a point of the stride to hold (rad), and a jump's height and rise to hold. */
  private pace: number | null = null;
  private heldPhase: number | null = null;
  private heldAir: [number, number] | null = null;
  protected yaw = 0;
  protected pitch = 0;
  protected speed = 0;
  /** A jump (Space): how high his feet are off the floor (m), and how fast he's rising. */
  protected airY = 0;
  private airVy = 0;
  protected readonly keys = new Set<string>();
  private savedFov = 50;
  private readonly invertY: boolean;
  /** Bikes you can get on (E by one), and the one you're on. */
  bikes: Bike[] = [];
  protected riding: Ride | null = null;
  private armedOnFoot = true;
  private readonly crosshair = new Crosshair();
  /** A cinematic camera last frame (a kill move's, the mirror's): the eyes to put back before this one. */
  private cineSaved: { p: THREE.Vector3; q: THREE.Quaternion } | null = null;
  /** Third person (Q): the camera behind him for each frame's render. */
  third = false;
  protected readonly thirdCam = new ThirdPersonCamera();
  /** What he's wearing (models/wardrobe.ts), and a change of clothes on its way (the model loading). */
  private wardrobe = loadWardrobe();
  private changing = false;
  /** The review mirror (C): which of MIRRORS, 0 off. */
  mirror = 0;
  private readonly ray = new THREE.Raycaster();

  constructor(
    protected readonly scene: THREE.Scene,
    protected readonly camera: THREE.PerspectiveCamera,
    protected readonly dom: HTMLElement,
    private readonly controls: OrbitControls,
    private readonly env: THREE.Texture | null,
    protected readonly floorAt: (x: number, z: number) => number,
  ) {
    this.scene.add(this.smoke.mesh);
    let inv = false;
    try {
      inv = localStorage.getItem('rainyplace.invertY') === '1';
    } catch {
      /* no storage */
    }
    this.invertY = inv;
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      this.keys.add(e.code);
      if (e.code === 'Space') {
        e.preventDefault();
        if (!this.riding && !this.held && this.airY === 0 && this.rig && !this.rig.squatting) this.airVy = JUMP_V;
      }
      if (this.onKey(e)) return;
      if (e.code === 'KeyG' && this.rig) this.rig.setKind(MACK_GUNS[(MACK_GUNS.indexOf(this.rig.kind) + 1) % MACK_GUNS.length]);
      if (e.code === 'KeyR') this.rig?.reload();
      if (e.code === 'KeyH' && this.rig) this.rig.oneHand = !this.rig.oneHand;
      if (e.code === 'KeyV') this.exit();
      if (e.code === 'KeyQ') this.third = !this.third;
      if (e.code === 'KeyO') void this.wear(nextOutfit(this.wardrobe.outfit).id, this.wardrobe.glasses);
      if (e.code === 'KeyZ') void this.wear(this.wardrobe.outfit, nextGlasses(this.wardrobe.glasses));
      if (e.code === 'KeyN') this.setFace(nextFace(this.wardrobe.face));
      if (e.code === 'KeyK') this.setHelmet(nextHelmet(this.wardrobe.helmet));
      if (e.code === 'KeyC') this.mirror = (this.mirror + 1) % MIRRORS.length;
      if (e.code === 'KeyP' && this.rig) this.rig.squatting = !this.rig.squatting;
      if (e.code === 'KeyJ' && this.rig) {
        if (this.rig.smoking.what) this.rig.smoking.flick();
        else this.rig.smoking.light(e.shiftKey ? 'cigar' : 'cigarette');
      }
      if (e.code === 'KeyE') this.toggleRide();
      if (e.code === 'KeyX' && this.rig) {
        this.rig.armed = !this.rig.armed;
        if (!this.rig.armed) this.rig.aiming = false;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('mousedown', (e) => {
      if (!this.active || !this.rig) return;
      if (document.pointerLockElement !== dom) {
        void dom.requestPointerLock();
        return;
      }
      if (this.onMouseDown(e, this.rig)) return;
      if (e.button === 2 && this.rig.armed) this.rig.aiming = true;
      if (e.button === 0 && this.rig.armed && this.rig.fire()) this.crosshair.fired();
    });
    dom.addEventListener('mouseup', (e) => {
      if (e.button === 2 && this.rig) this.rig.aiming = false;
      this.onMouseUp(e);
    });
    dom.addEventListener('contextmenu', (e) => {
      if (this.active) e.preventDefault();
    });
    // The wheel in third person: the camera nearer or further.
    dom.addEventListener(
      'wheel',
      (e) => {
        if (this.active && this.third && document.pointerLockElement === dom) this.thirdCam.wheel(e);
      },
      { passive: true },
    );
    document.addEventListener('mousemove', (e) => {
      if (!this.active || document.pointerLockElement !== dom) return;
      if (this.held) return;
      this.look(e.movementX * 0.0022, e.movementY * 0.0022 * (this.invertY ? -1 : 1));
    });
  }

  // What a page's own mode adds to first person (fight/fightMode.ts, the fight): nothing, here.
  /** A key going down; true takes it from the keys below. */
  protected onKey(_e: KeyboardEvent): boolean {
    return false;
  }

  /** A button going down with the mouse captured; true takes it from the gun. */
  protected onMouseDown(_e: MouseEvent, _rig: FirstPersonRig): boolean {
    return false;
  }

  protected onMouseUp(_e: MouseEvent): void {}

  /** Look and move held still (a kill move playing, or you're down). */
  protected get held(): boolean {
    return false;
  }

  /** What he fights with on foot instead of the guns (models/melee.ts), if anything. */
  protected meleeNow(): FirstPersonRig['melee'] {
    return null;
  }

  /** The fight's step on foot, before the rig is posed: it may move you and turn your head (`yaw`, `pitch`), and
   * gives the dt to pose him with, a shake for the view and, for a cinematic angle, where to render from. */
  protected fight(_dt: number, _rig: FirstPersonRig): { dt: number; shake: number; cine: { pos: THREE.Vector3; look: THREE.Vector3 } | null } | null {
    return null;
  }

  /** How fast he goes, walking and running (m/s), and the pace his legs show at a speed: here a walk at walking
   * pace, for looking at him (the fight room has the city's: fight/fightMode.ts). */
  protected paceOf(running: boolean): number {
    return running ? 4.2 : 1.5;
  }
  protected gaitOf(speed: number): number {
    return speed;
  }

  /** What `probe` sees through besides him: the people. */
  protected notWalls(): THREE.Object3D[] {
    return [];
  }

  /** Your view: the eyes, yaw and pitch. */
  protected view(): { eye: THREE.Vector3; yaw: number; pitch: number } {
    // Between frames in third person the camera is behind him: the eyes are the ones saved.
    return { eye: this.cineSaved?.p ?? this.thirdCam.eyes ?? this.camera.position, yaw: this.yaw, pitch: this.pitch };
  }

  /** A wall within `max` of `from` along `dir`: the page's solid things, not people, gore or you. */
  protected probe(from: THREE.Vector3, dir: THREE.Vector3, max: number): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    this.ray.set(from, dir.clone().normalize());
    this.ray.far = max;
    this.ray.camera = this.camera;
    const skip = new Set<THREE.Object3D>();
    if (this.rig) skip.add(this.rig.object);
    for (const o of this.notWalls()) skip.add(o);
    const hits = this.ray.intersectObjects(this.scene.children, true);
    for (const h of hits) {
      const o = h.object as THREE.Mesh;
      if (!o.isMesh || (o as unknown as THREE.InstancedMesh).isInstancedMesh || !h.face || o.name.startsWith('gore')) continue;
      let anc: THREE.Object3D | null = o;
      let skipIt = false;
      while (anc) {
        if (skip.has(anc)) skipIt = true;
        anc = anc.parent;
      }
      if (skipIt) continue;
      const normal = h.face.normal.clone().transformDirection(o.matrixWorld);
      return { point: h.point.clone(), normal };
    }
    return null;
  }

  private look(dx: number, dy: number): void {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -1.35, 1.2);
  }

  /** Into first person at (x, z), facing `yaw` (0 looks along -z). */
  async enter(x: number, z: number, yaw: number): Promise<void> {
    if (!this.rig) {
      this.rig = await FirstPersonRig.load(outfitById(this.wardrobe.outfit).model, this.env);
      this.rig.setGlasses(this.wardrobe.glasses);
      this.rig.setFaceStyle(this.wardrobe.face);
      this.rig.wearHelmet(helmetLook(this.wardrobe.helmet));
      this.scene.add(this.rig.object);
      // What of the animation library is his own (models/cityMoves.ts: his walk, the pistol's stance), as in the city.
      void withCityMoves(this.rig);
    }
    this.rig.object.visible = true;
    this.active = true;
    this.controls.enabled = false;
    this.savedFov = this.camera.fov;
    this.camera.fov = 72;
    this.camera.updateProjectionMatrix();
    this.camera.rotation.order = 'YXZ';
    this.yaw = yaw;
    this.pitch = 0;
    this.camera.position.set(x, this.floorAt(x, z) + this.rig.eyeHeight, z);
  }

  /** Into other clothes or sunglasses: a new model loads and takes over from the one he's in. */
  /** His motorcycle helmet on foot (models/helmet.ts), or none. */
  private setHelmet(helmet: (typeof this.wardrobe)['helmet']): void {
    this.wardrobe = { ...this.wardrobe, helmet };
    saveWardrobe(this.wardrobe);
    this.rig?.wearHelmet(helmetLook(helmet));
  }

  /** How his face is hidden (models/faceShadow.ts). */
  private setFace(face: FaceStyle): void {
    this.wardrobe = { ...this.wardrobe, face };
    saveWardrobe(this.wardrobe);
    this.rig?.setFaceStyle(face);
  }

  private async wear(outfit: string, glasses: GlassesKind | null): Promise<void> {
    if (!this.rig || this.changing) return;
    this.wardrobe = { ...this.wardrobe, outfit: outfitById(outfit).id, glasses };
    saveWardrobe(this.wardrobe);
    const model = outfitById(outfit).model;
    if (model === this.rig.model) {
      this.rig.setGlasses(glasses);
      return;
    }
    this.changing = true;
    try {
      const next = await FirstPersonRig.load(model, this.env);
      const old = this.rig;
      next.takeOver(old);
      next.setGlasses(glasses);
      this.scene.remove(old.object);
      this.scene.add(next.object);
      this.rig = next;
    } finally {
      this.changing = false;
    }
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.restoreEyes();
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
    if (this.rig) this.rig.object.visible = false;
    this.crosshair.update(false, 0, 0);
    this.controls.enabled = true;
    this.camera.fov = this.savedFov;
    this.camera.updateProjectionMatrix();
    const f = this.camera.getWorldDirection(new THREE.Vector3());
    this.controls.target.copy(this.camera.position).addScaledVector(f, 3);
    this.camera.rotation.order = 'XYZ';
    this.controls.update();
  }

  /** Gets on the nearest bike within reach, or off the one you're on (stepping off on its left). */
  private toggleRide(): void {
    this.restoreEyes();
    if (this.riding) {
      const r = this.riding;
      const left = new THREE.Vector3(-Math.cos(r.yaw), 0, Math.sin(r.yaw));
      this.camera.position.set(r.x + left.x * 0.9, 0, r.z + left.z * 0.9);
      this.camera.position.y = this.floorAt(this.camera.position.x, this.camera.position.z) + (this.rig?.eyeHeight ?? 1.8);
      // Parked: upright, the bars turned a little.
      r.bike.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.yaw);
      r.bike.steer.quaternion.setFromAxisAngle(r.bike.steerAxis, 0.25);
      this.yaw += r.yaw;
      this.riding = null;
      if (this.rig) {
        this.rig.mounted = null;
        this.rig.armed = this.armedOnFoot;
        this.rig.setHelmet(this.rig.wornHelmet ?? false);
      }
      return;
    }
    const p = this.camera.position;
    let best: Bike | null = null;
    let bestD = 2.8;
    for (const b of this.bikes) {
      const w = b.root.getWorldPosition(new THREE.Vector3());
      const d = Math.hypot(w.x - p.x, w.z - p.z);
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    if (!best) return;
    const w = best.root.getWorldPosition(new THREE.Vector3());
    const yaw = new THREE.Euler().setFromQuaternion(best.root.quaternion, 'YXZ').y;
    this.riding = { bike: best, x: w.x, z: w.z, yaw, u: 0, steer: 0, lean: 0 };
    // On the bike with both hands on the bars; X draws the shotgun.
    if (this.rig) {
      this.armedOnFoot = this.rig.armed;
      this.rig.armed = false;
      this.rig.aiming = false;
      this.rig.mounted = best;
      // A sports bike: a helmet on, his pistol to hand; the others his shotgun.
      this.rig.setHelmet(best.rider.helmet ?? this.rig.wornHelmet ?? false);
      this.rig.setKind(best.rider.helmet ? 'pistol' : 'lever');
    }
    // The view: ahead along the bike.
    this.yaw = 0;
    this.pitch = -0.12;
  }

  /** The ride's step: throttle, brakes, steering that winds in less at speed, the lean the turn wants. */
  private rideStep(r: Ride, dt: number): void {
    const k = this.keys;
    const throttle = k.has('KeyW');
    const brake = k.has('KeyS');
    if (throttle) r.u += RIDE.accel * (r.u < 3 ? 1.2 : 1) * dt;
    if (brake) r.u = r.u > 0.05 ? Math.max(0, r.u - RIDE.brake * dt) : Math.max(-1, r.u - 1.5 * dt);
    if (!brake && r.u < 0) r.u = Math.min(0, r.u + 2 * dt);
    r.u -= Math.sign(r.u) * Math.min(Math.abs(r.u), (RIDE.drag + RIDE.airDrag * r.u * r.u) * dt);
    r.u = Math.min(RIDE.top, r.u);
    const input = Number(k.has('KeyD')) - Number(k.has('KeyA'));
    const most = 0.55 / (1 + 0.35 * Math.abs(r.u));
    r.steer += (input * most - r.steer) * Math.min(1, dt * 6);
    // Turning right (steer > 0) turns the heading clockwise from above; no tighter than the lean a cruiser
    // has before its floorboards touch down.
    let turn = (r.u * Math.tan(r.steer)) / RIDE.wheelbase;
    const most2 = (RIDE.g * Math.tan(RIDE.maxLean)) / Math.max(0.1, Math.abs(r.u));
    turn = THREE.MathUtils.clamp(turn, -most2, most2);
    r.yaw -= turn * dt;
    const want = Math.atan((r.u * turn) / RIDE.g);
    r.lean += (want - r.lean) * Math.min(1, dt * 4);
    r.x -= Math.sin(r.yaw) * r.u * dt;
    r.z -= Math.cos(r.yaw) * r.u * dt;
    const b = r.bike;
    b.root.position.set(r.x, this.floorAt(r.x, r.z), r.z);
    // Leaning right tips the top toward the rider's right (+x in the bike's frame): a turn about -z.
    b.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -r.lean));
    b.steer.quaternion.setFromAxisAngle(b.steerAxis, -r.steer);
    b.frontWheel.rotation.x -= (r.u * dt) / b.wheelRadius.front;
    b.rearWheel.rotation.x -= (r.u * dt) / b.wheelRadius.rear;
  }

  update(dt: number): void {
    const rig = this.rig;
    if (!this.active || !rig || this.frozen) return;
    // Last frame's cinematic or third-person camera: back to the eyes.
    this.restoreEyes();
    rig.setHeadless(!this.third && !(this.watch ?? MIRRORS[this.mirror]));
    // On a bike the guns only.
    rig.melee = this.riding ? null : this.meleeNow();
    this.crosshair.update(rig.armed && !rig.melee, rig.aim, dt);
    if (this.riding) {
      const r = this.riding;
      this.rideStep(r, dt);
      const eye = rig.seatBody(r.bike);
      this.camera.position.copy(eye);
      // The view: the bike's heading with half its lean, then where you look (the head turns only so far).
      const most = this.third ? RIDE_LOOK_THIRD : 1.7;
      this.yaw = THREE.MathUtils.clamp(this.yaw, -most, most);
      this.camera.quaternion
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.yaw)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -r.lean * 0.5))
        .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')));
      this.camera.updateMatrixWorld();
      rig.update(dt, this.camera, 0, 0);
      this.smoke.update(dt, rig.smoking.out, this.air);
      if (this.third) this.thirdCam.place(this.camera, zoomed(THIRD.ride, this.thirdCam.zoom), dt, this.clear);
      return;
    }
    const move = new THREE.Vector3();
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    if (this.keys.has('KeyW')) move.add(new THREE.Vector3(fx, 0, fz));
    if (this.keys.has('KeyS')) move.sub(new THREE.Vector3(fx, 0, fz));
    if (this.keys.has('KeyD')) move.add(new THREE.Vector3(-fz, 0, fx));
    if (this.keys.has('KeyA')) move.sub(new THREE.Vector3(-fz, 0, fx));
    const locked = this.held;
    const want = move.lengthSq() > 0 && !locked ? this.paceOf(this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) * (rig.aiming || (rig.melee?.guard ?? 0) > 0.5 ? 0.6 : 1) : 0;
    this.speed += (want - this.speed) * Math.min(1, dt * 8);
    if (move.lengthSq() > 0) this.camera.position.addScaledVector(move.normalize(), this.speed * dt);
    const floor = this.floorAt(this.camera.position.x, this.camera.position.z);
    // (Any step and he's up off his heels.)
    if (want > 0) rig.squatting = false;
    // A jump: a ballistic hop over the floor below.
    if (this.airVy !== 0 || this.airY > 0) {
      this.airVy -= GRAVITY * dt;
      this.airY += this.airVy * dt;
      if (this.airY <= 0) this.airY = this.airVy = 0;
    }
    const standing = floor + rig.eyeHeight - rig.eyeDrop;
    if (this.airY > 0) this.camera.position.y = standing + this.airY;
    else this.camera.position.y += (standing - this.camera.position.y) * Math.min(1, dt * 12);
    // A fight: it may move you (a lunge, a kill move carrying you) and turn your head (a kill move's look).
    const fought = this.fight(dt, rig);
    const dtW = fought?.dt ?? dt;
    const shake = fought?.shake ?? 0;
    const cine = fought?.cine ?? null;
    // The view shakes with a blow, given or taken.
    const sh = shake * shake * 0.03;
    this.camera.rotation.set(this.pitch + (Math.random() - 0.5) * sh, this.yaw + (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh * 0.5, 'YXZ');
    this.camera.updateMatrixWorld();
    // In third person he faces the way he goes, not where the camera looks, unless he has a weapon up.
    const going = move.lengthSq() > 0 && !locked ? this.speed : 0;
    const eyes = this.facing.update(dtW, this.camera, this.facing.modeFor(this.third, rig, dtW), move.x * going, move.z * going);
    if (this.heldPhase !== null) (rig as unknown as { walk: number }).walk = this.heldPhase;
    if (this.heldAir) [rig.air, rig.airV] = this.heldAir;
    else [rig.air, rig.airV] = [this.airY, this.airVy];
    // (In a jump, or one held for a shot, his feet are that far off the floor.)
    rig.update(dtW, eyes, this.pace ?? (locked ? 0 : this.gaitOf(this.speed)), floor + (this.heldAir?.[0] ?? this.airY));
    this.smoke.update(dtW, rig.smoking.out, this.air);
    // A kill move's cinematic angle: rendered from there this frame (his head shown), the eyes put back next.
    if (cine) {
      this.cineSaved = { p: this.camera.position.clone(), q: this.camera.quaternion.clone() };
      rig.setHeadless(false);
      this.camera.position.copy(cine.pos);
      this.camera.lookAt(cine.look);
      this.camera.updateMatrixWorld();
    } else if ((this.watch ?? MIRRORS[this.mirror])) {
      this.mirrorView((this.watch ?? MIRRORS[this.mirror])!);
    } else if (this.third) {
      this.thirdCam.place(this.camera, footOffset(rig.aim, this.thirdCam.zoom), dt, this.clear);
    }
  }

  /** The review mirror: the camera in front of his face (round by `angle`), looking at it; the eyes put back next
   * frame. Never in play. */
  private mirrorView(m: { angle: number; dist: number }): void {
    const eye = this.camera.position.clone();
    this.cineSaved = { p: eye, q: this.camera.quaternion.clone() };
    const yaw = this.yaw + m.angle;
    this.camera.position.set(eye.x - Math.sin(yaw) * m.dist, eye.y, eye.z - Math.cos(yaw) * m.dist);
    this.camera.lookAt(eye.x, eye.y - 0.03, eye.z);
    this.camera.updateMatrixWorld();
  }

  /** Puts the camera back at the eyes after a frame rendered from elsewhere (a cinematic, third person). */
  private restoreEyes(): void {
    this.thirdCam.restore(this.camera);
    if (!this.cineSaved) return;
    this.camera.position.copy(this.cineSaved.p);
    this.camera.quaternion.copy(this.cineSaved.q);
    this.camera.updateMatrixWorld();
    this.cineSaved = null;
  }

  /** How far the way is clear for the third-person camera: the showroom's solid things. */
  private readonly clear = (from: THREE.Vector3, dir: THREE.Vector3, max: number): number => {
    const hit = this.probe(from, dir, max);
    return hit ? hit.point.distanceTo(from) : max;
  };

  hud(): string {
    const r = this.rig;
    if (r && this.riding) {
      return `RIDING · ${Math.round(Math.abs(this.riding.u) * 3.6)} km/h · lean ${Math.round((this.riding.lean * 180) / Math.PI)}° · ${r.armed ? `shotgun, ${r.shells} in` : 'hands on the bars'}\nW throttle · S brake (and back from a stop) · A/D steer · mouse look · X shotgun · right button aim · left fire · E get off · Q third person (wheel zooms) ·V back to orbiting`;
    }
    return r
      ? `FIRST PERSON · ${r.kind} · ${r.oneHand ? 'one hand' : 'two hands'} · ${r.shells} in · ${outfitById(this.wardrobe.outfit).label}${this.wardrobe.glasses ? `, ${GLASSES_LABELS[this.wardrobe.glasses]}` : ''}, face: ${FACE_STYLE_LABELS[this.wardrobe.face]}${this.wardrobe.helmet ? `, ${HELMET_LABELS[this.wardrobe.helmet]}` : ''} · ${document.pointerLockElement === this.dom ? 'mouse look' : 'click to capture the mouse'}\nWASD walk (Shift faster) · E get on a bike · X shotgun / hands free · right button aim · left fire · R reload · G other gun · H one hand / two · Esc frees the mouse · Q third person (wheel zooms) ·O clothes · Z sunglasses · N face · K helmet · C mirror (review) · L labels · V back to orbiting`
      : 'FIRST PERSON · loading Mack...';
  }

  /** For scripted screenshots: set the view, aim, fire, switch guns. */
  script(): Record<string, unknown> {
    return {
      enter: (x: number, z: number, yaw: number) => this.enter(x, z, yaw),
      look: (yaw: number, pitch: number) => {
        this.yaw = yaw;
        this.pitch = pitch;
      },
      aim: (on: boolean) => this.rig && (this.rig.aiming = on),
      fire: () => this.rig?.fire(),
      kind: (k: (typeof SHOTGUN_KINDS)[number]) => this.rig?.setKind(k),
      oneHand: (on: boolean) => this.rig && (this.rig.oneHand = on),
      walk: (on: boolean) => (on ? this.keys.add('KeyW') : this.keys.delete('KeyW')),
      run: (on: boolean) => (on ? this.keys.add('ShiftLeft') : this.keys.delete('ShiftLeft')),
      exit: () => this.exit(),
      freeze: (on: boolean) => (this.frozen = on),
      rig: () => this.rig,
      ride: () => this.toggleRide(),
      riding: () => this.riding,
      key: (code: string, on: boolean) => (on ? this.keys.add(code) : this.keys.delete(code)),
      armed: (on: boolean) => this.rig && (this.rig.armed = on),
      smoke: (kind: 'cigarette' | 'cigar' = 'cigarette') => this.rig?.smoking.light(kind),
      flick: () => this.rig?.smoking.flick(),
      squat: (on: boolean) => this.rig && (this.rig.squatting = on),
      pace: (v: number | null) => (this.pace = v),
      stridePhase: (p: number | null) => (this.heldPhase = p),
      air: (height: number, v: number) => (this.heldAir = height > 0 ? [height, v] : ((this.rig!.air = 0), (this.rig!.airV = 0), null)),
      autoSmoke: (kind: 'cigarette' | 'cigar' | null) => this.rig && (this.rig.smoking.auto = kind),
      wind: (x: number, z: number) => this.air.set(x, z),
      watch: (angle: number | null, dist = 1.2) => (this.watch = angle === null ? null : { angle, dist }),
      headless: (on: boolean) => this.rig?.setHeadless(on),
      third: (on: boolean) => (this.third = on),
      wear: (outfit: string, glasses: GlassesKind | null = this.wardrobe.glasses) => this.wear(outfit, glasses),
      face: (f: FaceStyle) => this.setFace(f),
      helmet: (h: (typeof this.wardrobe)['helmet']) => this.setHelmet(h),
      mirror: (i: number) => (this.mirror = i),
      faceShadow: (k: number) => (FACE_SHADOW.value = k),
      camera: () => this.camera,
      probe: (from: THREE.Vector3, dir: THREE.Vector3, max: number) => this.probe(from, dir, max),
    };
  }
}
