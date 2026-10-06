import * as THREE from 'three';
import { separateCars } from '../../race/battle';
import { CarMarks, hitVolumes, type Part } from '../../race/carView';
import type { BodyHit } from '../../race/shooting';
import type { Walker } from '../real/traffic';
import { ChaseState, SLOTS, TYRE_BURST, type ChaseDef } from './chase';
import { ChaseCar, type ChaseWorld } from './chaseCar';
import { ChaseHud, type ChaseMark } from './chaseHud';
import type { OwnCar } from './ownCar';
import { Polyline } from './taxiDispatch';

/**
 * A chase under way in the city (district/chase.ts): its cars (chaseCar.ts) set down on the road round you, the
 * job's state, the knocks between the cars, whose rounds struck whom, the smoke of the ones shot up, and its screens
 * (chaseHud.ts). main.ts owns one of these and gives it the city (`ChaseHost`).
 */
export interface ChaseHost extends ChaseWorld {
  readonly scene: THREE.Scene;
  /** The city's material (the cars are built on it). */
  readonly material: THREE.Material;
  readonly camera: THREE.PerspectiveCamera;
  readonly own: OwnCar;
  /** You're at the wheel of your car. */
  driving(): boolean;
  /** Hold your car at the line (the countdown). */
  hold(on: boolean): void;
  /** Whether (x, z) is in view (a car put back on your trail is put where it isn't). */
  seen(x: number, z: number): boolean;
  /** A node's place, for a getaway's goal; and the GPS set to it (null: cleared). */
  node(id: string): { x: number; z: number; label: string } | null;
  gps(id: string | null): void;
  /** The street lamps (0 day, 1 night): the cars' lights. */
  lamps(): number;
  toast(text: string, seconds?: number): void;
  pay(yen: number): void;
  /** A shake of the view (a hit on you). */
  shake(amount: number): void;
}

const SMOKE = 220;

export class CityChase {
  state: ChaseState | null = null;
  cars: ChaseCar[] = [];
  readonly hud = new ChaseHud();
  /** Your car's own hit volumes (their rounds strike them) and the holes they leave, made the first time they're wanted. */
  private yours: THREE.Mesh[] | null = null;
  private yourMarks: CarMarks | null = null;
  private goal: { x: number; z: number; label: string } | null = null;
  private paid = false;
  /** Smoke from the cars that have been shot up. */
  readonly smoke: THREE.Points;
  private readonly smokePos = new Float32Array(SMOKE * 3);
  private readonly smokeLife = new Float32Array(SMOKE);
  private smokeNext = 0;

  constructor(private readonly host: ChaseHost) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3));
    g.setAttribute('life', new THREE.BufferAttribute(this.smokeLife, 1));
    this.smoke = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */ `
          attribute float life;
          varying float vLife;
          void main() {
            vLife = life;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = life > 0.0 ? (1.0 + (1.0 - life) * 2.5) * 500.0 / -mv.z : 0.0;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying float vLife;
          void main() {
            if (vLife <= 0.0) discard;
            float d = length(gl_PointCoord - 0.5);
            gl_FragColor = vec4(vec3(0.2, 0.2, 0.22), smoothstep(0.5, 0.0, d) * vLife * 0.4);
          }`,
      }),
    );
    this.smoke.frustumCulled = false;
    this.smoke.name = 'chase:smoke';
    host.scene.add(this.smoke);
  }

  /** A job's on (through its countdown and until its result is put away). */
  get active(): boolean {
    return this.state !== null;
  }

  /** A clear spot on the carriageway `d` metres along a route, in the lane left of the way `dir` (1 along it, -1 back) goes. */
  private spot(line: Polyline, d: number, dir: 1 | -1): { x: number; z: number; h: number } | null {
    for (let k = 0; k < 6; k++) {
      const p = line.at(d + k * 7);
      const dx = p.dx * dir;
      const dz = p.dz * dir;
      for (const lane of [1.8, 0.6, 3]) {
        const x = p.x + dz * lane;
        const z = p.z - dx * lane;
        const clear = [-1.6, 0, 1.6].every((f) => !this.host.probe(x + dx * f, z + dz * f, 1));
        if (clear) return { x, z, h: Math.atan2(dx, dz) };
      }
    }
    return null;
  }

  /**
   * Starts a job: you at the wheel on the street; a runner set down ahead of you on the road you're on, or pursuers
   * behind you on the way you came. False (with a word why) if it can't be set up here.
   */
  start(def: ChaseDef): boolean {
    const H = this.host;
    const own = H.own;
    if (this.active) this.end();
    if (!H.driving()) return H.toast('A chase: get in your car first.'), false;
    if (own.totaled) return H.toast('Your car is wrecked: the garage first.'), false;
    if (own.aloft() || own.onExpressway()) return H.toast('A chase keeps to the streets: come down off the expressway first.'), false;
    const s = own.sim;
    const fx = Math.sin(s.h);
    const fz = Math.cos(s.h);
    const hunt = def.kind === 'hunt';
    // The road ahead of you (a hunt) or behind you (hunted): a route to a point far that way, the nearest that has one.
    let line: Polyline | null = null;
    for (const a of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, Math.PI]) {
      const dir = hunt ? 1 : -1;
      const gx = s.x + (fx * Math.cos(a) + fz * Math.sin(a)) * 420 * dir;
      const gz = s.z + (fz * Math.cos(a) - fx * Math.sin(a)) * 420 * dir;
      const r = H.route(s.x, s.z, gx, gz, hunt ? [fx, fz] : undefined);
      const l = r && new Polyline(r);
      if (l && l.length > 190) {
        line = l;
        break;
      }
    }
    if (!line) return H.toast('No road for a chase here: try from a street.'), false;
    const cars: ChaseCar[] = [];
    def.cars.forEach((cd, i) => {
      const at = this.spot(line!, hunt ? 34 + i * 16 : 62 + i * 26, hunt ? 1 : -1);
      if (!at) return;
      const c = new ChaseCar(cd, `chase${i}`, H.material, H);
      c.place(at.x, at.z, at.h);
      H.scene.add(c.view.obj);
      c.sound.start();
      cars.push(c);
    });
    if (cars.length < def.cars.length) {
      for (const c of cars) c.dispose();
      return H.toast('No room for a chase here: try from a wider street.'), false;
    }
    this.cars = cars;
    this.state = new ChaseState(def);
    this.paid = false;
    H.gunfire.bodies.length = 0;
    for (const c of cars) H.gunfire.bodies.push(...c.volumes);
    if (!this.yours) {
      this.yours = hitVolumes(own.view.obj, 'you', false, own.view.type);
      this.yourMarks = new CarMarks(own.view.obj);
    }
    this.yourMarks!.clear();
    this.goal = def.reach ? H.node(def.reach) : null;
    if (def.reach) H.gps(def.reach);
    H.hold(true);
    H.toast(hunt ? `${def.name}: he's ahead of you. Right button aims, left fires; a tyre, the glass, or put him in a wall.` : `${def.name}: they're behind you. Their gunmen shoot from the left window.`, 6);
    return true;
  }

  /** Ends the job as it stands: the cars off the street, the screens away. */
  end(): void {
    if (!this.state) return;
    for (const c of this.cars) c.dispose();
    this.cars = [];
    this.host.gunfire.bodies.length = 0;
    if (this.state.def.reach) this.host.gps(null);
    this.host.hold(false);
    this.state = null;
    this.goal = null;
    this.hud.clear();
  }

  /** A round struck a car (real/gunfire.ts `onBody`): one of yours on a chase car, or one of theirs on you. */
  struck(h: BodyHit, by: string | undefined): void {
    const st = this.state;
    if (!st) return;
    const part = h.object.userData.part as Part;
    if (h.id === 'you') {
      if (!by?.startsWith('chase')) return;
      if (!st.running) return;
      if (part === 'tyre' && Math.random() < TYRE_BURST) {
        // Which tyre: by where it is on your car.
        const p = this.host.own.view.obj.worldToLocal(h.point.clone());
        this.host.own.burst(`${p.z > 0 ? 'f' : 'r'}${p.x > 0 ? 'l' : 'r'}`);
        this.hud.pop('YOUR TYRE IS SHOT OUT', '#ff8a8a', 2.2);
        this.host.shake(1);
        return;
      }
      const d = st.shot(part === 'tyre' ? 'body' : part);
      this.hud.hit(part === 'glass' || part === 'head');
      this.host.shake(part === 'glass' || part === 'head' ? 0.8 : 0.4);
      if (part === 'head' && d > 0) this.hud.pop('YOU’RE HIT', '#ff8a8a', 1.8);
      return;
    }
    const i = this.cars.findIndex((c) => c.id === h.id);
    if (i < 0) return;
    const tyres = st.cars[i].tyres;
    const note = st.shoot(i, part, h.object.userData.who as 'driver' | 'gunman' | undefined);
    if (note) this.hud.pop(note, st.cars[i].out ? '#7cffb0' : '#ffe9a8', st.cars[i].out ? 2.4 : 1.4);
    if (st.cars[i].tyres > tyres) this.cars[i].blowTyre();
    if (st.cars[i].out) this.cars[i].finish();
  }

  /** The chase cars as things in the road for the traffic (it brakes for them, and sounds its horn). */
  walkers(): Walker[] {
    const out: Walker[] = [];
    for (const c of this.cars) {
      const s = c.sim;
      const fx = Math.sin(s.h);
      const fz = Math.cos(s.h);
      for (const f of [-1.2, 1.2]) out.push({ x: s.x + fx * f, z: s.z + fz * f, vx: fx * s.u, vz: fz * s.u, r: 1 });
    }
    return out;
  }

  /**
   * Each frame. `gdt`: the world's step (slow motion slows it); `dt`: real time, for the screens.
   */
  update(gdt: number, dt: number): void {
    const H = this.host;
    const st = this.state;
    this.fade(gdt);
    if (!st) {
      this.hud.update(dt, null, [], H.camera, null);
      return;
    }
    const own = H.own;
    const you = own.sim;
    const held = st.phase === 'countdown';
    const hunt = st.def.kind === 'hunt';
    const lamps = H.lamps();
    let slot = 0;
    this.cars.forEach((c, i) => {
      if (st.cars[i].out || st.phase === 'over') c.finish();
      c.update(gdt, hunt ? 'run' : 'hunt', you, SLOTS[c.out ? 0 : slot++ % SLOTS.length], held, H.camera.position, lamps);
      // A wall at speed, or ploughing into the traffic, costs it.
      if (c.knock > 0 && st.ram(i, c.knock * 0.7) > 0 && st.cars[i].out) {
        c.finish();
        this.hud.pop(`${c.def.name.toUpperCase()} WRECKED`, '#7cffb0', 2.4);
      }
    });
    // Knocks: you and each of them, and they each other. A ram costs them health and your car its bodywork.
    this.cars.forEach((c, i) => {
      const closing = H.driving() || you.speed > 0.5 ? separateCars(you, c.sim) : 0;
      if (closing > 0) {
        const nx = c.sim.x - you.x;
        const nz = c.sim.z - you.z;
        const fx = Math.sin(you.h);
        const fz = Math.cos(you.h);
        // (Where on your car: toward them.)
        const n = Math.hypot(nx, nz) || 1;
        own.struck(((nx * fx + nz * fz) / n) * 2.1, ((nx * fz - nz * fx) / n) * 0.85, Math.max(0, closing - 4) * 1.6);
        if (closing > 2) H.shake(Math.min(1, closing / 12));
        const d = st.ram(i, closing);
        if (d > 3) this.hud.pop(`RAM −${Math.round(d)}`, '#ffe9a8', 1.2);
        if (st.cars[i].out && !c.out) {
          c.finish();
          this.hud.pop(`${c.def.name.toUpperCase()} WRECKED`, '#7cffb0', 2.4);
        }
      }
      for (let j = i + 1; j < this.cars.length; j++) separateCars(c.sim, this.cars[j].sim);
    });
    // Their gunmen.
    if (st.running && this.yours) this.cars.forEach((c, i) => c.shoot(gdt, st.cars[i].gunman, own.view.obj, you.speed, this.yours!, H.camera.position));
    // A pursuer that's got nowhere for a while, out of sight: back on your trail.
    if (st.running && !hunt) for (const c of this.cars) if (!c.out && c.stalled > 7 && !H.seen(c.sim.x, c.sim.z)) this.rejoin(c);
    // The shot-up ones smoke.
    this.cars.forEach((c, i) => {
      const k = 1 - st.cars[i].health / c.def.health;
      if ((k > 0.45 || c.out) && Math.random() < (c.out ? 0.7 : (k - 0.45) * 1.2) * gdt * 60) this.puff(c.sim.x + Math.sin(c.sim.h) * 1.5, c.sim.y + 0.95, c.sim.z + Math.cos(c.sim.h) * 1.5);
    });
    const dist = this.cars.map((c) => Math.hypot(c.sim.x - you.x, c.sim.z - you.z));
    const toGoal = this.goal ? Math.hypot(this.goal.x - you.x, this.goal.z - you.z) : undefined;
    st.update(gdt, { driving: H.driving(), wrecked: own.totaled, dist, seen: this.cars.map((c) => H.seen(c.sim.x, c.sim.z)), toGoal });
    H.hold(st.phase === 'countdown');
    if (st.phase === 'over' && !this.paid) {
      this.paid = true;
      const pay = st.result!.won ? st.def.pay : 0;
      if (pay > 0) H.pay(pay);
      const def = st.def;
      this.hud.result(st, pay, () => void (this.end(), this.start(def)), () => this.end());
    }
    const marks: ChaseMark[] = this.cars.map((c, i) => ({ name: c.def.name, at: new THREE.Vector3(c.sim.x, c.sim.y + 1.9, c.sim.z), dist: dist[i], health: st.cars[i].health, max: c.def.health, out: st.cars[i].out, gunman: st.cars[i].gunman, armed: c.def.gunman, tyres: st.cars[i].tyres }));
    this.hud.update(dt, st, marks, H.camera, this.goal && toGoal !== undefined ? { label: this.goal.label, dist: toGoal } : null);
  }

  /** Puts a pursuer back on the road behind you, out of sight, heading for you. */
  private rejoin(c: ChaseCar): void {
    const H = this.host;
    const you = H.own.sim;
    for (const a of [Math.PI, 2.4, -2.4, 1.6, -1.6]) {
      const gx = you.x + Math.sin(you.h + a) * 300;
      const gz = you.z + Math.cos(you.h + a) * 300;
      const r = H.route(you.x, you.z, gx, gz);
      if (!r) continue;
      const line = new Polyline(r);
      for (let d = 90; d < Math.min(line.length, 240); d += 20) {
        const p = line.at(d);
        if (H.seen(p.x, p.z)) continue;
        const at = this.spot(line, d, -1);
        if (!at) continue;
        c.place(at.x, at.z, at.h);
        return;
      }
    }
    c.stalled = 0;
  }

  private puff(x: number, y: number, z: number): void {
    const k = this.smokeNext++ % SMOKE;
    this.smokePos.set([x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.5], k * 3);
    this.smokeLife[k] = 1;
  }

  private fade(dt: number): void {
    let any = false;
    for (let k = 0; k < SMOKE; k++) {
      if (this.smokeLife[k] <= 0) continue;
      this.smokeLife[k] -= dt / 2.4;
      this.smokePos[k * 3 + 1] += dt * 1.2;
      any = true;
    }
    this.smoke.visible = any;
    if (!any) return;
    this.smoke.geometry.attributes.position.needsUpdate = true;
    this.smoke.geometry.attributes.life.needsUpdate = true;
  }
}
