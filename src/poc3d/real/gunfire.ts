import * as THREE from 'three';
import type { FirstPersonRig } from '../models/firstPerson';
import { MeleeSound } from '../models/meleeSound';
import { GunSound } from '../../race/gunSound';

/**
 * Mack's shots in the city: each pellet (or the pistol's bullet) is marched along the bore from the muzzle
 * against the district (`District.shotProbe`, gathered once a shot along its line: walls to each building's
 * height, the ground and floors, parked cars, poles and hedges) and the traffic, and where it lands it leaves a mark (a hole on a wall or the ground),
 * kicks up dust and chips, or throws sparks off metal. The blast (models/meleeSound.ts) or the pistol's crack
 * (race/gunSound.ts) and the impacts are heard from where they are. Nobody reacts yet: the mob and the traffic
 * carry on.
 */

/** What a shot meets at a point (world): see District.shotAt; 'car' also for traffic. */
export type ShotProbe = (x: number, y: number, z: number) => 'ground' | 'wall' | 'car' | 'pole' | 'soft' | null;
/** A probe for points near the line from (ax, az) to (bx, bz), within `pad` of it (District.shotProbe). */
export type ShotProbes = (ax: number, az: number, bx: number, bz: number, pad: number) => ShotProbe;

/** How far a pellet and a bullet carry (m), and the march's step. */
const PELLET_RANGE = 90;
const BULLET_RANGE = 220;
const STEP = 0.5;
const MAX_PARTICLES = 600;
const MAX_MARKS = 240;

interface Particle {
  p: THREE.Vector3;
  v: THREE.Vector3;
  t: number;
  life: number;
  size: number;
  r: number;
  g: number;
  b: number;
  /** Falls under gravity (chips, sparks) or drifts and slows (dust). */
  heavy: boolean;
}

const pointsVert = /* glsl */ `
  attribute vec4 aColor;
  attribute float aSize;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * 900.0 / max(0.3, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const pointsFrag = /* glsl */ `
  varying vec4 vColor;
  uniform float uSoft;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float a = mix(1.0, 1.0 - d * d, uSoft);
    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  }
`;

/** A pool of points (dust or sparks) drawn in one go. */
class Particles {
  readonly points: THREE.Points;
  private readonly list: Particle[] = [];
  private readonly pos = new Float32Array(MAX_PARTICLES * 3);
  private readonly col = new Float32Array(MAX_PARTICLES * 4);
  private readonly size = new Float32Array(MAX_PARTICLES);
  private readonly geo = new THREE.BufferGeometry();

  constructor(additive: boolean) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: pointsVert,
      fragmentShader: pointsFrag,
      uniforms: { uSoft: { value: additive ? 1 : 0.8 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.name = additive ? 'gunfire:sparks' : 'gunfire:dust';
  }

  add(p: Particle): void {
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    this.list.push(p);
  }

  update(dt: number): void {
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const q = this.list[i];
      q.t += dt;
      if (q.t >= q.life) {
        this.list.splice(i, 1);
        continue;
      }
      if (q.heavy) q.v.y -= 9.8 * dt;
      else q.v.multiplyScalar(Math.max(0, 1 - dt * 3)).add(new THREE.Vector3(0, 0.25 * dt, 0));
      q.p.addScaledVector(q.v, dt);
    }
    for (const q of this.list) {
      const k = q.t / q.life;
      this.pos.set([q.p.x, q.p.y, q.p.z], n * 3);
      // Dust grows as it thins; sparks shrink as they cool.
      const a = q.heavy ? 1 - k : (1 - k) * (1 - k) * 0.55;
      this.col.set([q.r, q.g, q.b, a], n * 4);
      this.size[n] = q.heavy ? q.size * (1 - k * 0.6) : q.size * (1 + k * 2.5);
      n++;
    }
    this.geo.setDrawRange(0, n);
    for (const name of ['position', 'aColor', 'aSize']) {
      const at = this.geo.getAttribute(name) as THREE.BufferAttribute;
      at.clearUpdateRanges();
      at.addUpdateRange(0, n * at.itemSize);
      at.needsUpdate = true;
    }
  }
}

/** A hole's look: a dark centre with chipped, lighter edges, cut out round. */
function holeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(8,7,6,1)');
  grad.addColorStop(0.32, 'rgba(18,16,14,0.95)');
  grad.addColorStop(0.45, 'rgba(120,112,100,0.55)');
  grad.addColorStop(1, 'rgba(120,112,100,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // Chips round the rim.
  g.fillStyle = 'rgba(30,27,24,0.8)';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + Math.random() * 0.6;
    g.beginPath();
    g.ellipse(32 + Math.cos(a) * 9, 32 + Math.sin(a) * 9, 4, 1.6, a, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class CityGunfire {
  readonly group = new THREE.Group();
  private readonly dust = new Particles(false);
  private readonly sparks = new Particles(true);
  private readonly marks: THREE.InstancedMesh;
  private nextMark = 0;
  private readonly blastSound = new MeleeSound();
  private readonly gunSound = new GunSound();
  private seen = 0;

  /** The probe for the shot being made. */
  private probe: ShotProbe = () => null;

  constructor(
    private readonly probes: ShotProbes,
    /** A vehicle in traffic at (x, y, z), if any. */
    private readonly vehicleAt: (x: number, y: number, z: number) => boolean,
  ) {
    this.group.name = 'gunfire';
    const mat = new THREE.MeshStandardMaterial({ map: holeTexture(), transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.marks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, MAX_MARKS);
    this.marks.count = 0;
    this.marks.frustumCulled = false;
    this.marks.name = 'gunfire:marks';
    this.group.add(this.dust.points, this.sparks.points, this.marks);
  }

  /** Start the sounds (from a click or a key). */
  resume(): void {
    this.blastSound.resume();
    this.gunSound.start();
  }

  /** Per frame: makes any shots the rig fired since the last call (it can fire inside its update, swinging
   * down first), and moves the dust and sparks. The camera is where you hear from and where you look. */
  update(rig: FirstPersonRig | null, camera: THREE.Camera, dt: number): void {
    if (rig && rig.shotsFired !== this.seen) {
      const n = rig.shotsFired - this.seen;
      this.seen = rig.shotsFired;
      if (n > 0) this.shoot(rig, camera.position, camera.getWorldDirection(new THREE.Vector3()));
    }
    this.dust.update(dt);
    this.sparks.update(dt);
  }

  /** Forget shots fired before now (a new rig took over: its count starts again). */
  sync(rig: FirstPersonRig): void {
    this.seen = rig.shotsFired;
  }

  private shoot(rig: FirstPersonRig, listener: THREE.Vector3, view: THREE.Vector3): void {
    const gun = rig.gun;
    const muzzle = rig.muzzle();
    const out = rig.boreDir();
    // Raised, the gun points at what's under the crosshair: along the bore. From the hip (carried muzzle down) the
    // shot goes where you look, as on the race page, with twice the spread.
    const raised = rig.aim > 0.9;
    const bore = raised ? out : view;
    const pellets = gun.pellets ?? 1;
    const spread = (gun.spread ?? 0.01) * (raised ? 1 : 2);
    if (gun.kind === 'pistol') this.gunSound.play([{ kind: 'pistol', at: muzzle }], listener);
    else this.blastSound.blast();
    // Smoke at the muzzle.
    for (let i = 0; i < 4; i++)
      this.dust.add({ p: muzzle.clone().addScaledVector(out, 0.15 + i * 0.12), v: out.clone().multiplyScalar(2 + Math.random() * 3).add(rand(0.6)), t: 0, life: 0.6 + Math.random() * 0.5, size: 0.016, r: 0.62, g: 0.6, b: 0.58, heavy: false });
    const range = pellets > 1 ? PELLET_RANGE : BULLET_RANGE;
    this.probe = this.probes(muzzle.x, muzzle.z, muzzle.x + bore.x * range, muzzle.z + bore.z * range, range * spread * 2.5 + 1);
    const heard: THREE.Vector3[] = [];
    for (let i = 0; i < pellets; i++) {
      const dir = bore.clone().add(rand(2 * spread)).normalize();
      const hit = this.march(muzzle, dir, range);
      if (!hit) continue;
      this.impact(hit.point, hit.normal, hit.what, dir);
      // One impact sound per spot, not one per pellet.
      if (!heard.some((h) => h.distanceTo(hit.point) < 1.2)) {
        heard.push(hit.point);
        this.gunSound.play([{ kind: hit.what === 'car' || hit.what === 'pole' ? 'clang' : 'ground', at: hit.point }], listener);
      }
    }
  }

  /** Along the ray to the first thing it meets, bisected to its surface, with the surface's normal. */
  private march(o: THREE.Vector3, d: THREE.Vector3, range: number): { point: THREE.Vector3; normal: THREE.Vector3; what: 'ground' | 'wall' | 'car' | 'pole' | 'soft' } | null {
    const at = (s: number): ReturnType<ShotProbe> => {
      const x = o.x + d.x * s;
      const y = o.y + d.y * s;
      const z = o.z + d.z * s;
      return this.probe(x, y, z) ?? (this.vehicleAt(x, y, z) ? 'car' : null);
    };
    let prev = 0;
    for (let s = STEP; s <= range; s += STEP) {
      const what = at(s);
      if (!what) {
        prev = s;
        continue;
      }
      let a = prev;
      let b = s;
      for (let k = 0; k < 6; k++) {
        const m = (a + b) / 2;
        if (at(m)) b = m;
        else a = m;
      }
      const point = o.clone().addScaledVector(d, a);
      return { point, normal: this.normalAt(point, d, what), what };
    }
    return null;
  }

  /** The way out of the surface at p (just outside it): the ground's up, a wall's open side along x or z. */
  private normalAt(p: THREE.Vector3, d: THREE.Vector3, what: string): THREE.Vector3 {
    if (what === 'ground') return new THREE.Vector3(0, 1, 0);
    const e = 0.12;
    const tries = [
      new THREE.Vector3(-Math.sign(d.x) || 1, 0, 0),
      new THREE.Vector3(0, 0, -Math.sign(d.z) || 1),
      new THREE.Vector3(0, 1, 0),
    ].sort((u, v) => Math.abs(v.dot(d)) - Math.abs(u.dot(d)));
    for (const n of tries) {
      const q = p.clone().addScaledVector(d, e).addScaledVector(n, e * 2);
      if (!this.probe(q.x, q.y, q.z) && !this.vehicleAt(q.x, q.y, q.z)) return n;
    }
    return d.clone().negate();
  }

  private impact(p: THREE.Vector3, n: THREE.Vector3, what: 'ground' | 'wall' | 'car' | 'pole' | 'soft', dir: THREE.Vector3): void {
    const metal = what === 'car' || what === 'pole';
    if (metal) {
      for (let i = 0; i < 6; i++) {
        const v = n.clone().multiplyScalar(2 + Math.random() * 3).add(rand(3)).addScaledVector(dir, -1);
        this.sparks.add({ p: p.clone(), v, t: 0, life: 0.2 + Math.random() * 0.25, size: 0.012 + Math.random() * 0.01, r: 3, g: 2.1, b: 0.8, heavy: true });
      }
    }
    if (what !== 'soft') {
      // Chips and a puff of dust off the surface (leaves off a hedge).
      for (let i = 0; i < (metal ? 1 : 4); i++)
        this.dust.add({ p: p.clone().addScaledVector(n, 0.05), v: n.clone().multiplyScalar(0.8 + Math.random() * 1.2).add(rand(0.6)), t: 0, life: 0.8 + Math.random() * 0.8, size: 0.08 + Math.random() * 0.06, r: 0.36, g: 0.34, b: 0.32, heavy: false });
      for (let i = 0; i < (metal ? 0 : 3); i++)
        this.dust.add({ p: p.clone().addScaledVector(n, 0.02), v: n.clone().multiplyScalar(2 + Math.random() * 2).add(rand(2)), t: 0, life: 0.5 + Math.random() * 0.4, size: 0.02, r: 0.25, g: 0.23, b: 0.21, heavy: true });
    } else {
      for (let i = 0; i < 4; i++)
        this.dust.add({ p: p.clone(), v: rand(1.5).add(new THREE.Vector3(0, 0.6, 0)), t: 0, life: 0.9 + Math.random() * 0.6, size: 0.014, r: 0.12, g: 0.2, b: 0.08, heavy: true });
      return;
    }
    // A hole (not on cars in traffic: they drive off with it).
    if (what === 'car' && this.vehicleAt(p.x - n.x * 0.05, p.y - n.y * 0.05, p.z - n.z * 0.05)) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * Math.PI * 2));
    const s = 0.05 + Math.random() * 0.03;
    m.compose(p.clone().addScaledVector(n, 0.012), q, new THREE.Vector3(s, s, s));
    this.marks.setMatrixAt(this.nextMark, m);
    this.nextMark = (this.nextMark + 1) % MAX_MARKS;
    this.marks.count = Math.min(MAX_MARKS, this.marks.count + 1);
    this.marks.instanceMatrix.needsUpdate = true;
  }
}

function rand(k: number): THREE.Vector3 {
  return new THREE.Vector3((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
}
