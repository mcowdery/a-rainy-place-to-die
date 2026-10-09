import * as THREE from 'three';
import { separateCars } from '../../race/battle';
import { CarMarks, hitVolumes, type Part } from '../../race/carView';
import type { BodyHit } from '../../race/shooting';
import type { Walker } from '../real/traffic';
import { ChaseState, SLOTS, TYRE_BURST } from './chase';
import { ChaseCar } from './chaseCar';
import type { ChaseHost } from './cityChase';
import { CELL } from './plan';
import { payFor, StreetRaceState, type Gate, type StreetRaceDef } from './streetRace';
import { StreetRaceHud, type RaceMark } from './streetRaceHud';
import { Polyline } from './taxiDispatch';

/**
 * A street race under way (district/streetRace.ts): you and five or more rivals on the grid, then through the gates
 * by whatever streets each driver chooses. Every rival is a chase car (chaseCar.ts: the racing model driving the
 * city's streets by itself, ploughing through what's soft, shoved by what's solid) in its 'race' role: it routes
 * through its next two gates over the road network, flat out, a little quicker when behind you and a little easier
 * when well ahead so the field stays together. Armed ones carry a gunman who shoots at you from the passenger window
 * (as in a chase); you shoot them with your own gun, ram them, or shoot out their tyres. A rival done for is out of
 * the race. Owned by main.ts, which gives it the city (`ChaseHost`, the one the chases use).
 */

const GRID_ROW = 9;
/** Lanes (m to the left of the road's middle) a grid slot may take, best first: an avenue has a median down its middle and the grid keeps to the left carriageway. */
const GRID_LANES = [3.4, 6.6, 1.8, 5, 0.6, 8.4];
/** Engines running at once (each is an audio context): the nearest few. */
const LOUD = 5;
/** Pace a rival gains per 100 m behind you (and loses ahead), at most. */
const RUBBER = 0.05;
const RUBBER_MAX = 0.1;

export class StreetRace {
  state: StreetRaceState | null = null;
  def: StreetRaceDef | null = null;
  cars: ChaseCar[] = [];
  readonly hud = new StreetRaceHud();
  /** The damage ledger: the rivals' health and tyres, yours (district/chase.ts `ChaseState`, its rules of damage). */
  private ledger: ChaseState | null = null;
  private yours: THREE.Mesh[] | null = null;
  private yourMarks: CarMarks | null = null;
  private paid = false;
  private nextId = 0;
  private readonly beacon: THREE.Group;
  private readonly beaconNear: THREE.Mesh;
  private readonly beaconFar: THREE.Mesh;
  private readonly smoke: THREE.Points;
  private readonly smokePos = new Float32Array(120 * 3);
  private readonly smokeLife = new Float32Array(120);
  private smokeNext = 0;

  constructor(private readonly host: ChaseHost) {
    const mat = (o: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.5, 0.5), transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
    this.beaconNear = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 90, 20, 1, true).translate(0, 45, 0), mat(0.32));
    this.beaconFar = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 60, 12, 1, true).translate(0, 30, 0), mat(0.18));
    this.beacon = new THREE.Group();
    this.beacon.name = 'streetrace:beacon';
    this.beacon.add(this.beaconNear, this.beaconFar);
    this.beacon.visible = false;
    host.scene.add(this.beacon);
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
    this.smoke.visible = false;
    host.scene.add(this.smoke);
  }

  get active(): boolean {
    return this.state !== null;
  }

  /** Every rival on the road, for the others' eyes (the traffic, the chases). */
  all(): ChaseCar[] {
    return this.cars;
  }

  /** The gates in world metres (L0 grid points are cell corners), the start first. */
  static gates(def: StreetRaceDef): Gate[] {
    return def.points.map(([c, r]) => ({ x: c * CELL, z: r * CELL }));
  }

  /** A clear spot `d` metres along a route, `lane` metres to the left of its direction. */
  private spot(line: Polyline, d: number, lane: number): { x: number; z: number; h: number } | null {
    const p = line.at(d);
    const x = p.x + p.dz * lane;
    const z = p.z - p.dx * lane;
    const clear = [-2, 0, 2].every((f) => !this.host.probe(x + p.dx * f, z + p.dz * f, 1.1));
    return clear ? { x, z, h: Math.atan2(p.dx, p.dz) } : null;
  }

  /**
   * Sets a race up: the grid on the road out of the start (you at the back), the rivals built and set down, your
   * guns' targets. False, with a word why, if it can't be (no road, no room).
   */
  start(def: StreetRaceDef): boolean {
    const H = this.host;
    if (this.active) this.end();
    if (!H.driving()) return H.toast('A race: get in your car first.'), false;
    if (H.own.totaled) return H.toast('Your car is wrecked: the garage first.'), false;
    const gates = StreetRace.gates(def);
    const goals: Gate[] = [];
    for (let lap = 0; lap < def.laps; lap++) goals.push(...gates.slice(1));
    const r = H.route(gates[0].x, gates[0].z, gates[1].x, gates[1].z);
    const line = r && new Polyline(r);
    if (!line || line.length < 60) return H.toast('No road from the start to the first gate.'), false;
    // The grid: two abreast, the front row furthest along; you in the last place. Start 4 m in so the first row clears the junction.
    const n = def.field.length + 1;
    const slots: { x: number; z: number; h: number }[] = [];
    for (let k = 0; k < n; k++) {
      const row = Math.floor(k / 2);
      const d = 4 + ((n - 1) >> 1) * GRID_ROW - row * GRID_ROW;
      // (The first of a row takes the best clear lane, the second the next best.)
      const used = k % 2 === 1 ? slots[k - 1] : null;
      let at: { x: number; z: number; h: number } | null = null;
      for (const dd of [0, 3, -3]) {
        for (const lane of GRID_LANES) {
          const s = this.spot(line, d + dd, lane);
          if (s && (!used || Math.hypot(s.x - used.x, s.z - used.z) > 2.6)) {
            at = s;
            break;
          }
        }
        if (at) break;
      }
      if (!at) return H.toast('No room for the grid at the start: try another race.'), false;
      slots.push(at);
    }
    // Slot order: the first rival on pole; you the last.
    const you = slots[n - 1];
    H.place(you.x, you.z, you.h);
    const cars: ChaseCar[] = [];
    def.field.forEach((cd, i) => {
      const c = new ChaseCar(cd, `race${this.nextId++}`, H.material, H);
      c.place(slots[i].x, slots[i].z, slots[i].h);
      H.scene.add(c.view.obj);
      cars.push(c);
    });
    cars.slice(0, LOUD).forEach((c) => {
      c.sound.start();
      c.loud = true;
    });
    this.cars = cars;
    this.def = def;
    this.state = new StreetRaceState(goals, ['You', ...def.field.map((f) => f.name)], gates[0]);
    // (The ledger runs from the start: a race has no countdown of its own to it.)
    this.ledger = new ChaseState({ id: def.id, name: def.name, blurb: def.blurb, kind: 'hunted', cars: def.field, pay: 0 });
    this.ledger.phase = 'running';
    this.paid = false;
    H.gunfire.bodies.length = 0;
    for (const c of cars) H.gunfire.bodies.push(...c.volumes);
    if (!this.yours) {
      this.yours = hitVolumes(H.own.view.obj, 'you', false, H.own.view.type);
      this.yourMarks = new CarMarks(H.own.view.obj);
    }
    this.yourMarks!.clear();
    this.beacon.visible = true;
    H.hold(true);
    H.warm();
    H.toast(`${def.name}: ${def.field.length + 1} cars, ${goals.length} gates. Find your own way through them. ${def.field.some((f) => f.gunman) ? 'Some of the others carry guns.' : ''}`, 6);
    return true;
  }

  /** Ends the race as it stands: the cars off the street, the screens away. */
  end(): void {
    if (!this.state) return;
    for (const c of this.cars) c.dispose();
    this.cars = [];
    this.host.gunfire.bodies.length = 0;
    this.host.gpsAt?.(null);
    this.host.hold(false);
    this.state = null;
    this.def = null;
    this.ledger = null;
    this.beacon.visible = false;
    this.hud.clear();
  }

  /** A round struck a car (real/gunfire.ts `onBody`): one of yours on a rival, or one of theirs on you. */
  struck(h: BodyHit, by: string | undefined): void {
    const st = this.state;
    const led = this.ledger;
    if (!st || !led || !st.running) return;
    const part = h.object.userData.part as Part;
    if (h.id === 'you') {
      if (!by?.startsWith('race')) return;
      if (st.outBecause[0] !== null) return;
      if (part === 'tyre' && Math.random() < TYRE_BURST) {
        const p = this.host.own.view.obj.worldToLocal(h.point.clone());
        this.host.own.burst(`${p.z > 0 ? 'f' : 'r'}${p.x > 0 ? 'l' : 'r'}`);
        this.hud.flash('YOUR TYRE IS SHOT OUT', '#ff8a8a', 2);
        this.hud.hit();
        this.host.shake(1);
        return;
      }
      led.shot(part === 'tyre' ? 'body' : part);
      this.hud.hit();
      this.host.shake(part === 'glass' || part === 'head' ? 0.8 : 0.4);
      return;
    }
    const i = this.cars.findIndex((c) => c.id === h.id);
    if (i < 0) return;
    const tyres = led.cars[i].tyres;
    const note = led.shoot(i, part, h.object.userData.who as 'driver' | 'gunman' | undefined);
    if (note) this.hud.flash(note, led.cars[i].out ? '#7cffb0' : '#ffe9a8', led.cars[i].out ? 2.2 : 1.2);
    if (led.cars[i].tyres > tyres) this.cars[i].blowTyre();
    if (led.cars[i].out) this.knockOut(i, led.cars[i].out!);
  }

  /** Rival i is done for. */
  private knockOut(i: number, why: string): void {
    const c = this.cars[i];
    if (!c.out) c.finish();
    this.state?.retire(i + 1, why.toUpperCase());
  }

  /** The race's cars as things in the road for the traffic (it brakes for them, and sounds its horn). */
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

  /** Each frame. `gdt`: the world's step (slow motion slows it); `dt`: real time, for the screens. */
  update(gdt: number, dt: number): void {
    const H = this.host;
    const st = this.state;
    const led = this.ledger;
    const def = this.def;
    this.fade(gdt);
    if (!st || !led || !def) {
      this.hud.update(dt, null, null, [], H.camera, null);
      return;
    }
    const own = H.own;
    const you = own.sim;
    const held = st.phase === 'countdown';
    const lamps = H.lamps();
    const standings = st.standings();
    const place = new Map(standings.map((s) => [s.who, s.place] as const));
    // The rivals: each drives to its next two gates, harder when behind you and easier when well ahead.
    this.cars.forEach((c, i) => {
      const who = i + 1;
      const ahead = st.ahead(who, 3);
      const g1 = ahead[0];
      if (st.finishedAt[who] !== null && !c.out) c.finish();
      if (g1 && !c.out) {
        const behind = st.progress(0) - st.progress(who);
        const k = THREE.MathUtils.clamp((behind / 100) * RUBBER, -RUBBER_MAX, RUBBER_MAX);
        c.race = { goals: ahead.map((g) => [g.x, g.z] as const), pace: c.def.pace * (1 + k), base: st.passed[who] };
      }
      c.update(gdt, 'race', you, SLOTS[0], held, H.camera.position, lamps);
      if (c.knock > 0 && st.running && led.ram(i, c.knock * 0.7) > 0 && led.cars[i].out) this.knockOut(i, led.cars[i].out!);
      if (!c.out && (st.outBecause[who] !== null)) c.finish();
    });
    // Knocks: you and each rival, and the rivals each other.
    this.cars.forEach((c, i) => {
      const closing = H.driving() || you.speed > 0.5 ? separateCars(you, c.sim) : 0;
      if (closing > 0) {
        const nx = c.sim.x - you.x;
        const nz = c.sim.z - you.z;
        const n = Math.hypot(nx, nz) || 1;
        own.struck(((nx * Math.sin(you.h) + nz * Math.cos(you.h)) / n) * 2.1, ((nx * Math.cos(you.h) - nz * Math.sin(you.h)) / n) * 0.85, Math.max(0, closing - 4) * 1.6);
        if (closing > 2) H.shake(Math.min(1, closing / 12));
        if (st.running) {
          const d = led.ram(i, closing);
          if (d > 0 && led.cars[i].out) this.knockOut(i, led.cars[i].out!);
        }
      }
      for (let j = i + 1; j < this.cars.length; j++) separateCars(c.sim, this.cars[j].sim);
    });
    // Their gunmen.
    if (st.running && this.yours) this.cars.forEach((c, i) => c.shoot(gdt, led.cars[i].gunman && st.outBecause[i + 1] === null && st.finishedAt[i + 1] === null, own.view.obj, you.speed, this.yours!, H.camera.position));
    // You: out if the car is wrecked or you are shot.
    if (st.running && st.outBecause[0] === null && st.finishedAt[0] === null) {
      if (own.totaled) st.retire(0, 'WRECKED');
      else if (led.health <= 0) st.retire(0, 'SHOT');
    }
    // Engines on for the nearest few (each is an audio context).
    const near = this.cars.map((c, i) => ({ c, i, d: Math.hypot(c.sim.x - you.x, c.sim.z - you.z) })).sort((a, b) => a.d - b.d);
    near.forEach(({ c }, k) => {
      if (k < LOUD && !c.loud && !c.out) {
        c.sound.start();
        c.loud = true;
      } else if (k >= LOUD && c.loud) {
        c.sound.setVolume(0);
        c.loud = false;
      }
    });
    // The shot-up ones smoke.
    this.cars.forEach((c, i) => {
      const k = 1 - led.cars[i].health / c.def.health;
      if ((k > 0.45 || c.out) && Math.random() < (c.out ? 0.5 : (k - 0.45) * 1.2) * gdt * 60) this.puff(c.sim.x + Math.sin(c.sim.h) * 1.5, c.sim.y + 0.95, c.sim.z + Math.cos(c.sim.h) * 1.5);
    });
    const events = st.update(gdt, [{ x: you.x, z: you.z }, ...this.cars.map((c) => ({ x: c.sim.x, z: c.sim.z }))]);
    for (const e of events) {
      if (e.who !== 0) {
        if (e.place !== null && e.place <= 3 && st.finishedAt[0] === null) this.hud.flash(`${st.names[e.who].toUpperCase()} FINISHES ${e.place === 1 ? 'FIRST' : e.place === 2 ? 'SECOND' : 'THIRD'}`, '#ffe9a8', 2);
        continue;
      }
      if (e.place !== null) this.hud.flash(`FINISH · ${e.place === 1 ? '1ST' : e.place === 2 ? '2ND' : e.place === 3 ? '3RD' : `${e.place}TH`}`, e.place === 1 ? '#7cffb0' : '#ffe9a8', 3);
      else this.hud.flash(`GATE ${e.gate}/${st.goals.length} · ${place.get(0) ?? 0}${(place.get(0) ?? 0) === 1 ? 'ST' : (place.get(0) ?? 0) === 2 ? 'ND' : (place.get(0) ?? 0) === 3 ? 'RD' : 'TH'}`, '#ffffff', 1.4);
    }
    H.hold(st.phase === 'countdown');
    // Where the next gate is: the beacon, and the GPS's route to it.
    const next = st.next(0);
    const after = st.after(0);
    this.beacon.visible = !!next && st.phase !== 'over';
    if (next) {
      this.beaconNear.position.set(next.x, H.height(next.x, next.z), next.z);
      const f = after ?? next;
      this.beaconFar.position.set(f.x, H.height(f.x, f.z), f.z);
      this.beaconFar.visible = !!after;
      const key = `${next.x},${next.z}`;
      if (key !== this.gpsKey) {
        this.gpsKey = key;
        H.gpsAt?.({ x: next.x, z: next.z, label: `Gate ${st.passed[0] + 1}` });
      }
    }
    if (st.phase === 'over' && !this.paid) {
      this.paid = true;
      // (Racers still running when it ends are placed as they stand.)
      const mine = st.standings().find((s) => s.who === 0)!;
      const pay = mine.out ? 0 : payFor(def, mine.place);
      if (pay > 0) H.pay(pay);
      this.host.gpsAt?.(null);
      this.hud.result(st, def, pay, () => void (this.end(), this.start(def)), () => this.end());
    }
    const marks: RaceMark[] = this.cars.map((c, i) => ({ name: c.def.name, at: new THREE.Vector3(c.sim.x, c.sim.y + 1.9, c.sim.z), dist: Math.hypot(c.sim.x - you.x, c.sim.z - you.z), place: place.get(i + 1) ?? 0, armed: led.cars[i].gunman, out: st.outBecause[i + 1] }));
    this.hud.update(dt, st, def, marks, H.camera, next ? Math.hypot(next.x - you.x, next.z - you.z) : null);
  }

  private gpsKey = '';

  private puff(x: number, y: number, z: number): void {
    const k = this.smokeNext++ % 120;
    this.smokePos.set([x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.5], k * 3);
    this.smokeLife[k] = 1;
  }

  private fade(dt: number): void {
    let any = false;
    for (let k = 0; k < 120; k++) {
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
