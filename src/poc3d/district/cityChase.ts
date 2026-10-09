import * as THREE from 'three';
import { separateCars } from '../../race/battle';
import { CarMarks, hitVolumes, type Part } from '../../race/carView';
import type { BodyHit } from '../../race/shooting';
import type { Walker } from '../real/traffic';
import { Blocker, ChaseState, pickAttacker, RAM_SLOTS, SLOTS, Spawner, swarmTarget, TYRE_BURST, type ChaseCarDef, type ChaseDef, type SwarmDef } from './chase';
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
  /** Set your car down (a gauntlet's start), at (x, z) facing h. */
  place(x: number, z: number, h: number): void;
  /** Compile the shaders of what's in the scene now (the page's own warm start does it for the HDR target). */
  warm(): void;
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
/** A gauntlet: engines running at once (each is an audio context), the furthest a car is let fall behind (m), how long a wreck lies about (s). */
const LOUD = 5;
const LEFT_BEHIND = 420;
const WRECK_LIFE = 14;

/** A roadblock standing across the route: its cars and where. */
interface Block {
  readonly cars: ChaseCar[];
  readonly x: number;
  readonly z: number;
}

const shuffled = <T,>(a: readonly T[]): T[] => {
  const o = [...a];
  for (let i = o.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [o[i], o[j]] = [o[j], o[i]];
  }
  return o;
};

export class CityChase {
  state: ChaseState | null = null;
  cars: ChaseCar[] = [];
  readonly hud = new ChaseHud();
  /** Your car's own hit volumes (their rounds strike them) and the holes they leave, made the first time they're wanted. */
  private yours: THREE.Mesh[] | null = null;
  private yourMarks: CarMarks | null = null;
  private goal: { x: number; z: number; label: string } | null = null;
  private paid = false;
  /** A gauntlet: the roadblocks standing, what puts cars on the road and when, the ids given out. */
  private blocks: Block[] = [];
  private spawner = new Spawner();
  private blocker: Blocker | null = null;
  private nextId = 0;
  /** Cars taken off the road, kept by `ChaseCar.key` to put back to work (building one is 25-40 ms). */
  private readonly pool = new Map<string, ChaseCar[]>();
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

  /** Every car of the job on the road: the cars after you and a gauntlet's roadblocks. */
  all(): ChaseCar[] {
    return this.blocks.length ? [...this.cars, ...this.blocks.flatMap((k) => k.cars)] : this.cars;
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
    // (A gauntlet sets you down at its own start: where you are now doesn't matter.)
    if (def.kind === 'gauntlet') return this.startGauntlet(def);
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
    for (const c of this.cars) this.retire(c);
    this.cars = [];
    this.clearBlocks();
    this.host.gunfire.bodies.length = 0;
    if (this.state.def.reach) this.host.gps(null);
    this.host.hold(false);
    this.state = null;
    this.goal = null;
    this.hud.clear();
  }

  /**
   * A gauntlet: you set down at its start node, on the road toward its far end; the swarm begins when the countdown
   * ends (cars are put on the road as they're wanted, never all at once).
   */
  private startGauntlet(def: ChaseDef): boolean {
    const H = this.host;
    const from = def.from ? H.node(def.from) : null;
    const to = def.reach ? H.node(def.reach) : null;
    if (!from || !to || !def.swarm) return H.toast('This run has no start or end here.'), false;
    const r = H.route(from.x, from.z, to.x, to.z);
    const line = r && new Polyline(r);
    if (!line || line.length < 600) return H.toast('No road from the start to the end of this run.'), false;
    let at: { x: number; z: number; h: number } | null = null;
    for (const d of [30, 60, 90]) if ((at = this.spot(line, d, 1))) break;
    if (!at) return H.toast('No room to start the run at the road end.'), false;
    H.place(at.x, at.z, at.h);
    this.state = new ChaseState(def);
    this.state.span = Math.hypot(to.x - from.x, to.z - from.z);
    this.cars = [];
    this.blocks = [];
    this.spawner = new Spawner();
    this.blocker = new Blocker(def.swarm.blockEvery, def.swarm.blocksMax);
    this.paid = false;
    H.gunfire.bodies.length = 0;
    if (!this.yours) {
      this.yours = hitVolumes(H.own.view.obj, 'you', false, H.own.view.type);
      this.yourMarks = new CarMarks(H.own.view.obj);
    }
    this.yourMarks!.clear();
    this.goal = to;
    this.warmUp(def.swarm);
    H.gps(def.reach!);
    H.hold(true);
    H.toast(`${def.name}: ${to.label}, across the whole city. They are everywhere, and more come as you go. Right button aims, left fires.`, 7);
    return true;
  }

  /**
   * Every shader the job will need, compiled now, in the countdown: what a car only shows in time (the gunman's arm,
   * a bullet hole, its mark in the mirrors), the smoke, the tracers and the flashes were each a program that compiled the first time it was
   * drawn, a stall of half a second in the middle of the run.
   */
  private warmUp(sw: SwarmDef): void {
    const you = this.host.own.sim;
    // (One of each model, for its shaders: a body of another type can have shaders of its own. And the pool filled:
    // two of each kind of attacker and one of each roadblock car, so the first cars sent aren't built mid-run.)
    const want = new Map<string, { cd: ChaseCarDef; n: number }>();
    for (const [cd, n] of [...sw.roster.map((r) => [r.def, 2] as const), ...sw.blocks.map((b) => [b, 1] as const)]) {
      const k = ChaseCar.key(cd);
      const w = want.get(k);
      if (w) w.n = Math.max(w.n, n);
      else want.set(k, { cd, n });
    }
    const cars: ChaseCar[] = [];
    for (const { cd, n } of want.values()) for (let i = 0; i < n; i++) cars.push(this.makeCar(cd, { x: you.x, z: you.z, h: you.h }, 0, false));
    for (const c of cars) c.warm(true);
    this.smoke.visible = true;
    this.host.gunfire.warm(true);
    this.host.warm();
    this.host.gunfire.warm(false);
    this.smoke.visible = false;
    for (const c of cars) {
      c.warm(false);
      this.retire(c);
    }
  }

  /** A car for a gauntlet, set down at `at`, rolling at `speed` (m/s): one from the pool if there is one of its kind, else built. */
  private makeCar(cd: ChaseCarDef, at: { x: number; z: number; h: number }, speed: number, loud: boolean): ChaseCar {
    const H = this.host;
    const id = `chase${this.nextId++}`;
    const c = this.pool.get(ChaseCar.key(cd))?.pop() ?? new ChaseCar(cd, id, H.material, H);
    if (c.id !== id) c.rebind(cd, id);
    c.place(at.x, at.z, at.h);
    c.sim.u = speed;
    H.scene.add(c.view.obj);
    if (loud) {
      c.sound.start();
      c.loud = true;
    }
    return c;
  }

  /** Takes a gauntlet's car off the road, to the pool (a few of each kind; the rest are thrown away). */
  private retire(c: ChaseCar): void {
    const key = ChaseCar.key(c.def);
    const list = this.pool.get(key) ?? [];
    if (list.length >= 3) return c.dispose();
    c.retire();
    list.push(c);
    this.pool.set(key, list);
  }

  /** What your rounds strike: every car on the road. */
  private syncBodies(): void {
    const b = this.host.gunfire.bodies;
    b.length = 0;
    for (const c of this.cars) b.push(...c.volumes);
    for (const k of this.blocks) for (const c of k.cars) b.push(...c.volumes);
  }

  /** A route from you out toward `a` radians off `base` (your heading, or behind it): the line, or null if the road doesn't go that way. */
  private way(base: number, a: number, ahead: boolean): Polyline | null {
    const H = this.host;
    const you = H.own.sim;
    const ang = base + a;
    const gx = you.x + Math.sin(ang) * 360;
    const gz = you.z + Math.cos(ang) * 360;
    const r = H.route(you.x, you.z, gx, gz, ahead ? [Math.sin(you.h), Math.cos(you.h)] : undefined);
    const l = r && new Polyline(r);
    return l && l.length > 170 ? l : null;
  }

  /**
   * Another attacker, set down on a road ahead of you (a side street as often as yours: the routes that fan out from
   * you part at the turns) or behind, out of sight, facing you and already rolling.
   */
  private spawnAttacker(where: 'ahead' | 'behind', cd: ChaseCarDef): boolean {
    const st = this.state!;
    const you = this.host.own.sim;
    const base = where === 'ahead' ? you.h : you.h + Math.PI;
    for (const a of shuffled([0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]).slice(0, 4)) {
      const line = this.way(base, a, where === 'ahead');
      if (!line) continue;
      for (const d of shuffled(where === 'ahead' ? [300, 260, 220, 180, 150] : [110, 150, 200, 240])) {
        if (d > line.length - 20) continue;
        const p = line.at(d);
        if (Math.hypot(p.x - you.x, p.z - you.z) < 120 || this.host.seen(p.x, p.z)) continue;
        if (this.cars.some((o) => Math.hypot(o.sim.x - p.x, o.sim.z - p.z) < 24) || this.blocks.some((k) => Math.hypot(k.x - p.x, k.z - p.z) < 40)) continue;
        const at = this.spot(line, d, -1);
        if (!at) continue;
        const loud = this.cars.filter((o) => o.loud).length < LOUD;
        this.cars.push(this.makeCar(cd, at, 9, loud));
        st.add(cd);
        this.syncBodies();
        return true;
      }
    }
    return false;
  }

  /**
   * A roadblock across the way to the end, out of sight on a straight stretch: cars stood across the carriageway
   * from kerb to kerb, slanted this way and that, and often a gap you can just get a car through.
   */
  private placeBlock(): boolean {
    const H = this.host;
    const sw = this.state!.def.swarm!;
    const you = H.own.sim;
    if (!this.goal) return false;
    const r = H.route(you.x, you.z, this.goal.x, this.goal.z, [Math.sin(you.h), Math.cos(you.h)]);
    const line = r && new Polyline(r);
    if (!line) return false;
    for (const d of shuffled([330, 370, 300, 410])) {
      if (d > line.length - 80 || line.turnAhead(d - 30, 60) > 0.2) continue;
      const p = line.at(d);
      if (H.seen(p.x, p.z) || this.blocks.some((k) => Math.hypot(k.x - p.x, k.z - p.z) < 160)) continue;
      const vertical = Math.abs(p.dz) >= Math.abs(p.dx);
      const road = H.roads(p.x, p.z, vertical);
      if (!road) continue;
      const half = road.width / 2 - road.sidewalk;
      if (half < 2.2) continue;
      const n = Math.max(2, Math.floor((half * 2) / 4));
      const gap = n >= 3 && Math.random() < 0.65 ? 1 + Math.floor(Math.random() * (n - 2)) : -1;
      const cars: ChaseCar[] = [];
      for (let k = 0; k < n; k++) {
        if (k === gap) continue;
        const cross = road.centre + (k - (n - 1) / 2) * 4;
        const along = (vertical ? p.z : p.x) + (k % 2 ? 1.6 : -1.6);
        const x = vertical ? cross : along;
        const z = vertical ? along : cross;
        if (H.probe(x, z, 1.5)) continue;
        // (Across the road, the noses slanting this way and that.)
        const h = (vertical ? Math.PI / 2 : 0) + (k % 2 ? 0.45 : -0.45) + (Math.random() < 0.5 ? Math.PI : 0);
        cars.push(this.makeCar(sw.blocks[Math.floor(Math.random() * sw.blocks.length)], { x, z, h }, 0, false));
      }
      if (cars.length < 2) {
        for (const c of cars) this.retire(c);
        continue;
      }
      this.blocks.push({ cars, x: p.x, z: p.z });
      this.syncBodies();
      return true;
    }
    return false;
  }

  private clearBlocks(): void {
    for (const k of this.blocks) for (const c of k.cars) this.retire(c);
    this.blocks = [];
  }

  /** A gauntlet's swarm, each frame: wrecks and the left-behind cleared away, new cars sent, roadblocks laid. */
  private swarm(gdt: number): void {
    const H = this.host;
    const st = this.state!;
    const sw = st.def.swarm!;
    const you = H.own.sim;
    const fx = Math.sin(you.h);
    const fz = Math.cos(you.h);
    const toGoal = this.goal ? Math.hypot(this.goal.x - you.x, this.goal.z - you.z) : st.span;
    const progress = st.progress(toGoal);
    let changed = false;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      const dx = c.sim.x - you.x;
      const dz = c.sim.z - you.z;
      const d = Math.hypot(dx, dz);
      const unseen = !H.seen(c.sim.x, c.sim.z);
      const behind = dx * fx + dz * fz < 0;
      const gone = c.out ? c.outFor > WRECK_LIFE || (c.outFor > 5 && behind && d > 60 && unseen) : d > LEFT_BEHIND || (behind && d > 240 && unseen) || (c.stalled > 6 && d > 90 && unseen);
      if (!gone) continue;
      this.retire(c);
      this.cars.splice(i, 1);
      st.drop(i);
      changed = true;
    }
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const k = this.blocks[i];
      const dx = k.x - you.x;
      const dz = k.z - you.z;
      const d = Math.hypot(dx, dz);
      if (!((dx * fx + dz * fz < -30 && d > 90 && !H.seen(k.x, k.z)) || d > 700)) continue;
      for (const c of k.cars) this.retire(c);
      this.blocks.splice(i, 1);
      changed = true;
    }
    const send = this.spawner.step(gdt, st.live, swarmTarget(sw, progress));
    if (send) {
      // (Harder driven and better shot the further you have come.)
      const base = pickAttacker(sw, progress, Math.random);
      const cd: ChaseCarDef = { ...base, pace: base.pace * (1 + 0.06 * progress), aim: base.aim * (1 + 0.2 * progress) };
      if (!this.spawnAttacker(send, cd)) this.spawner.failed();
    }
    if (this.blocker?.step(gdt, this.blocks.length) && !this.placeBlock()) this.blocker.failed();
    if (changed) this.syncBodies();
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
    for (const c of [...this.cars, ...this.blocks.flatMap((k) => k.cars)]) {
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
    if (st.running && st.def.swarm) this.swarm(gdt);
    let slot = 0;
    let rams = 0;
    this.cars.forEach((c, i) => {
      if (st.cars[i].out || st.phase === 'over') c.finish();
      const place = c.out ? SLOTS[0] : c.def.ram ? RAM_SLOTS[rams++ % RAM_SLOTS.length] : SLOTS[slot++ % SLOTS.length];
      c.update(gdt, hunt ? 'run' : 'hunt', you, place, held, H.camera.position, lamps);
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
    // A gauntlet's roadblocks: cars stood across the road, in the way of you and of the cars after you, their gunmen
    // firing as you pass.
    for (const k of this.blocks) {
      for (const c of k.cars) {
        c.update(gdt, 'block', you, SLOTS[0], held, H.camera.position, lamps);
        const closing = separateCars(you, c.sim);
        if (closing > 0) {
          const nx = c.sim.x - you.x;
          const nz = c.sim.z - you.z;
          const n = Math.hypot(nx, nz) || 1;
          own.struck(((nx * Math.sin(you.h) + nz * Math.cos(you.h)) / n) * 2.1, ((nx * Math.cos(you.h) - nz * Math.sin(you.h)) / n) * 0.85, Math.max(0, closing - 4) * 1.6);
          if (closing > 2) H.shake(Math.min(1, closing / 12));
        }
        for (const o of this.cars) separateCars(o.sim, c.sim);
        if (st.running && this.yours) c.shoot(gdt, c.def.gunman, own.view.obj, you.speed, this.yours, H.camera.position);
      }
    }
    // Their gunmen.
    if (st.running && this.yours) this.cars.forEach((c, i) => c.shoot(gdt, st.cars[i].gunman, own.view.obj, you.speed, this.yours!, H.camera.position));
    // A pursuer that's got nowhere for a while, out of sight: back on your trail.
    if (st.running && !hunt && !st.def.swarm) for (const c of this.cars) if (!c.out && c.stalled > 7 && !H.seen(c.sim.x, c.sim.z)) this.rejoin(c);
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
      const pay = st.result!.won ? st.def.pay + st.kills * (st.def.swarm?.killPay ?? 0) : 0;
      if (pay > 0) H.pay(pay);
      const def = st.def;
      this.hud.result(st, pay, () => void (this.end(), this.start(def)), () => this.end());
    }
    let marks: ChaseMark[] = this.cars.map((c, i) => ({ name: c.def.name, at: new THREE.Vector3(c.sim.x, c.sim.y + 1.9, c.sim.z), dist: dist[i], health: st.cars[i].health, max: c.def.health, out: st.cars[i].out, gunman: st.cars[i].gunman, armed: c.def.gunman, tyres: st.cars[i].tyres }));
    if (st.def.swarm) {
      // (A swarm is too many for the list: the nearest few that are running, and the roadblocks.)
      for (const k of this.blocks) {
        const d = Math.hypot(k.x - you.x, k.z - you.z);
        marks.push({ name: 'ROADBLOCK', at: new THREE.Vector3(k.x, k.cars[0].sim.y + 2.6, k.z), dist: d, health: 1, max: 1, out: null, gunman: false, armed: false, tyres: 0 });
      }
      marks = marks.filter((m) => !m.out).sort((a, b) => a.dist - b.dist).slice(0, 7);
    }
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
