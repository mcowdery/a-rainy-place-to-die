import * as THREE from 'three';
import type { Course } from './course';
import { splat, type TargetHit, type Targets } from './targets';

/**
 * Shooting from the car (the practice lot's test): a pistol and a paintball marker, fired by the driver.
 * Japanese cars are right-hand drive, so the driver's window is on the right: the arm goes out of it, a wide
 * arc from just ahead round to behind. The passenger's window is across the car: the driver stays in the
 * seat and shoots through it (the camera goes to the driver's eye in the cabin: models/carInterior.ts), so only
 * what that window frames will do, and the shots are worse (spread, rate). The windscreen and the back are no
 * line of fire.
 *
 * The pistol (黒星, the Type 54 the yakuza made famous) hits at once, with a flash and a tracer, and has a
 * little aim assist. Paintballs fly: they leave at 88 m/s plus the car's own velocity, drop, and slow, so you
 * lead your shots; they splat in their colour on whatever they hit, targets and ground alike.
 */

export interface Weapon {
  readonly id: 'pistol' | 'paint' | 'shotgun';
  readonly label: string;
  readonly mag: number;
  /** Seconds to reload, between shots; auto fires while the trigger is held. */
  readonly reload: number;
  readonly interval: number;
  readonly auto: boolean;
  /** Spread (rad, the cone's half-angle) at rest; muzzle speed (m/s, 0 hits at once); kick (rad of aim). */
  readonly spread: number;
  readonly speed: number;
  readonly kick: number;
}

export const WEAPONS: readonly Weapon[] = [
  { id: 'pistol', label: '黒星 Type 54', mag: 8, reload: 1.8, interval: 0.14, auto: false, spread: 0.005, speed: 0, kick: 0.02 },
  { id: 'paint', label: 'Paintball', mag: 60, reload: 2.6, interval: 0.11, auto: true, spread: 0.01, speed: 88, kick: 0.003 },
  // Mack's sawn-off: its shells, lever and pose are his rig's (the page fires it: `blast`); the spread is the
  // pellets' cone.
  { id: 'shotgun', label: 'Sawn-off lever-action', mag: 5, reload: 2.2, interval: 0.6, auto: false, spread: 0.04, speed: 0, kick: 0.06 },
];

const DEG = Math.PI / 180;

/** The driver's eye in the car's frame (+x its left, +z forward, metres from its centre on the ground): the coupe's
 * (models/carInterior.ts' `cockpitLayout` fits each car's; the camera and Mack use that). */
export const EYE = { x: -0.35, y: 1.07, z: -0.02 } as const;
/**
 * The passenger window's opening, in the car's frame: the plane x = `x` (the door's inside), between z0 and z1
 * along the car and y0 and y1 up. Shots across the car go through it. (The cabin, models/carInterior.ts, shows the
 * body's own glass, a little longer than this.)
 */
export const WINDOW = { x: 0.82, z0: -0.26, z1: 0.68, y0: 0.78, y1: 1.23 } as const;
/**
 * Where you can shoot, relative to the car's heading (rad, positive to the left): out of the driver's window
 * from just ahead (`ahead`) round to behind (`right`); across the car only through the passenger window.
 */
export const ARC = { right: -165 * DEG, ahead: 8 * DEG };
export type Side = 'driver' | 'across';

export const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Where a look from the driver's eye at (rel, pitch) meets the passenger window's plane (car frame), or null. */
function onWindowPlane(rel: number, pitch: number): { y: number; z: number } | null {
  const dx = Math.sin(rel) * Math.cos(pitch);
  if (dx < 0.05) return null;
  const t = (WINDOW.x - EYE.x) / dx;
  return { y: EYE.y + t * Math.sin(pitch), z: EYE.z + t * Math.cos(rel) * Math.cos(pitch) };
}

/** The passenger window as seen from the driver's eye: its span of angles (rel) and heights (pitch) at its middle. */
export const WINDOW_ARC = (() => {
  const dx = WINDOW.x - EYE.x;
  const zm = (WINDOW.z0 + WINDOW.z1) / 2 - EYE.z;
  const d = Math.hypot(dx, zm);
  return {
    from: Math.atan2(dx, WINDOW.z1 - EYE.z),
    to: Math.atan2(dx, WINDOW.z0 - EYE.z),
    pitch: [Math.atan2(WINDOW.y0 - EYE.y, d), Math.atan2(WINDOW.y1 - EYE.y, d)] as const,
  };
})();

/** Which window a shot at `rel` and `pitch` (from the driver's eye) goes out of, or null (the windscreen, the back, the roof). */
export function sideFor(rel: number, pitch = 0): Side | null {
  const r = wrap(rel);
  if (r >= ARC.right && r <= ARC.ahead) return 'driver';
  const p = onWindowPlane(r, pitch);
  const m = 0.02;
  if (p && p.z > WINDOW.z0 + m && p.z < WINDOW.z1 - m && p.y > WINDOW.y0 + m && p.y < WINDOW.y1 - m) return 'across';
  return null;
}

/** The nearest aim (rel, pitch) you could shoot at: where the weapon points while the aim is off every window. */
export function nearestShot(rel: number, pitch: number): { rel: number; pitch: number; side: Side } {
  const r = wrap(rel);
  const side = sideFor(r, pitch);
  if (side) return { rel: r, pitch, side };
  const W = WINDOW_ARC;
  const inWindow = { rel: Math.max(W.from + 0.03, Math.min(W.to - 0.03, r)), pitch: Math.max(W.pitch[0] + 0.03, Math.min(W.pitch[1] - 0.03, pitch)), side: 'across' as const };
  // The driver's arc's nearer end, the short way round (behind the car wraps through 180 degrees).
  const toAhead = Math.abs(wrap(r - ARC.ahead));
  const toRight = Math.abs(wrap(r - ARC.right));
  const toWindow = Math.abs(r - inWindow.rel) + Math.abs(pitch - inWindow.pitch);
  if (toWindow < Math.min(toAhead, toRight)) return inWindow;
  return { rel: toAhead < toRight ? ARC.ahead : ARC.right, pitch, side: 'driver' };
}

const PAINTS = [0xff3fa4, 0x3ff0ff, 0xffe03f, 0x7dff4a, 0xff8a2a].map((h) => new THREE.Color(h));

/** Something for the sound to play: shots, clicks, hits (with where, for distance). */
export interface ShotEvent {
  readonly kind: 'pistol' | 'paint' | 'dry' | 'reload' | 'ding' | 'paper' | 'splat' | 'ground' | 'clang';
  readonly at: THREE.Vector3;
}

/** A scored hit, for the HUD. */
export interface ScoreEvent {
  readonly points: number;
  readonly base: number;
  readonly mult: number;
  readonly why: string;
}

interface Ball {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  color: THREE.Color;
  life: number;
  mult: number;
  why: string;
}

/** A shot striking a car (a hit volume in `Shooting.bodies`): which, where, the surface's outward normal. */
export interface BodyHit {
  readonly id: string;
  readonly object: THREE.Object3D;
  readonly point: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly distance: number;
}

export interface FireContext {
  /** Where the crosshair points (from the camera). */
  readonly aimPoint: THREE.Vector3;
  /** The car's velocity (m/s, world), for paintballs. */
  readonly carVel: THREE.Vector3;
  /** Shooting through the passenger window from the driver's seat; the car's slide (rad) and speed, which open the spread. */
  readonly across: boolean;
  /** From the hip (not aiming): twice the spread, no assist. */
  readonly hip: boolean;
  readonly slide: number;
  readonly speed: number;
  /** Score multiplier for hits from this shot, and why (drifting...). */
  readonly mult: number;
  readonly why: string;
}

export class Shooting {
  /** In world space: balls, decals, particles, the tracer, the flash. */
  readonly group = new THREE.Group();
  /** The driver's arm and the weapon in hand (a child of the car, posed out of a window while aiming). */
  readonly arm = new THREE.Group();
  weaponIndex = 0;
  readonly ammo: number[] = WEAPONS.map((w) => w.mag);
  /** Seconds left reloading (0 when not), until the next shot. */
  reloading = 0;
  private cooldown = 0;
  score = 0;
  shots = 0;
  hits = 0;
  streak = 0;
  bestStreak = 0;
  readonly events: ShotEvent[] = [];
  readonly scored: ScoreEvent[] = [];
  /** A hit this frame (for the hit marker). */
  hitMark = 0;

  private readonly balls: Ball[] = [];
  private readonly ballMesh: THREE.InstancedMesh;
  private readonly splats: THREE.InstancedMesh;
  private readonly holes: THREE.InstancedMesh;
  private nSplat = 0;
  private nHole = 0;
  private readonly particles: THREE.Points;
  private readonly pPos: Float32Array;
  private readonly pVel: Float32Array;
  private readonly pCol: Float32Array;
  private readonly pLife: Float32Array;
  private pNext = 0;
  private readonly tracer: THREE.Line;
  private tracerT = 0;
  private readonly flash: THREE.PointLight;
  private readonly flashSprite: THREE.Sprite;
  private flashT = 0;
  private readonly guns: Record<Weapon['id'], THREE.Group>;
  private readonly muzzleZ: Record<Weapon['id'], number> = { pistol: 0.2, paint: 0.52, shotgun: 0.6 };
  private paintNext = 0;
  /**
   * Cars that can be shot (invisible hit volumes with `userData.id`; never the shooter's own), and what to do
   * when one is struck. `assist` pulls the pistol's aimed shots onto a target or car near the crosshair (the
   * player's; a rival's accuracy is its own).
   */
  readonly bodies: THREE.Object3D[] = [];
  onBody: ((h: BodyHit, kind: 'bullet' | 'paint', color?: THREE.Color) => void) | null = null;
  assist = true;
  /**
   * Who's shooting: the driver in the right-hand seat (you), or a gunman in the left seat (a rival car's
   * passenger). `sideFor`'s 'driver' is then the shooter's own window, 'across' the far one.
   */
  seat: 'right' | 'left' = 'right';
  private readonly ray = new THREE.Raycaster();
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();

  constructor(
    private readonly course: Course,
    readonly targets: Targets,
  ) {
    const ballGeo = new THREE.SphereGeometry(0.035, 8, 6);
    this.ballMesh = new THREE.InstancedMesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), 160);
    this.ballMesh.count = 0;
    this.ballMesh.frustumCulled = false;
    this.ballMesh.setColorAt(0, PAINTS[0]);
    // Decals on the ground: paint splats (tinted per splat) and bullet marks.
    const decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const splatMat = new THREE.MeshStandardMaterial({ map: decalTexture('splat'), transparent: true, depthWrite: false, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -4 });
    this.splats = new THREE.InstancedMesh(decalGeo, splatMat, 400);
    this.splats.count = 0;
    this.splats.frustumCulled = false;
    this.splats.setColorAt(0, PAINTS[0]);
    const holeMat = new THREE.MeshStandardMaterial({ map: decalTexture('hole'), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4 });
    this.holes = new THREE.InstancedMesh(decalGeo, holeMat, 200);
    this.holes.count = 0;
    this.holes.frustumCulled = false;
    // Particles: droplets, dust, paper, sparks.
    const N = 700;
    this.pPos = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3);
    this.pCol = new Float32Array(N * 3);
    this.pLife = new Float32Array(N);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    pg.setAttribute('life', new THREE.BufferAttribute(this.pLife, 1));
    this.particles = new THREE.Points(
      pg,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uScale: { value: 800 } },
        vertexShader: /* glsl */ `
          attribute float life;
          attribute vec3 color;
          varying float vLife;
          varying vec3 vColor;
          uniform float uScale;
          void main() {
            vLife = life;
            vColor = color;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = life > 0.0 ? 0.05 * uScale / -mv.z : 0.0;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying float vLife;
          varying vec3 vColor;
          void main() {
            if (vLife <= 0.0) discard;
            float d = length(gl_PointCoord - 0.5);
            if (d > 0.5) discard;
            gl_FragColor = vec4(vColor, min(1.0, vLife * 2.0));
          }`,
      }),
    );
    this.particles.frustumCulled = false;
    // The pistol's tracer and muzzle flash (the light is always there, just dark: adding lights recompiles).
    const tg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
    this.tracer = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: new THREE.Color(4, 3, 1.6), transparent: true, opacity: 0 }));
    this.tracer.frustumCulled = false;
    this.flash = new THREE.PointLight(0xffb060, 0, 12, 2);
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: decalTexture('flash'), color: new THREE.Color(3, 2.2, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flashSprite.scale.setScalar(0.4);
    this.flashSprite.visible = false;
    this.group.add(this.ballMesh, this.splats, this.holes, this.particles, this.tracer, this.flash, this.flashSprite);
    // The arm: a dark suit sleeve from inside the car to the hand, and the weapon in it (+z along the aim).
    const suit = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc89878, roughness: 0.7 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, metalness: 0.6, roughness: 0.35 });
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.056, 0.62, 10).rotateX(Math.PI / 2).translate(0, -0.02, -0.33), suit);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.03, 10).rotateX(Math.PI / 2).translate(0, -0.02, -0.02), new THREE.MeshStandardMaterial({ color: 0xe8e4dc }));
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.075, 0.09).translate(0, -0.02, 0.03), skin);
    this.arm.add(sleeve, cuff, hand);
    const pistol = new THREE.Group();
    pistol.add(
      new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.19).translate(0, 0.035, 0.08), black),
      new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.09, 0.04).rotateX(-0.25).translate(0, -0.015, 0.01), black),
    );
    const paint = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x2a2e38, metalness: 0.4, roughness: 0.4 });
    const hopper = new THREE.MeshStandardMaterial({ color: 0xff3fa4, roughness: 0.3, transparent: true, opacity: 0.85 });
    paint.add(
      new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, 0.26).translate(0, 0.04, 0.08), body),
      new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.3, 8).rotateX(Math.PI / 2).translate(0, 0.05, 0.36), body),
      new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 12).translate(0, 0.14, 0.06), hopper),
      new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.09, 0.04).rotateX(-0.25).translate(0, -0.03, 0.0), body),
    );
    // (The shotgun is in Mack's hand, not on this arm.)
    const shotgun = new THREE.Group();
    this.arm.add(pistol, paint, shotgun);
    this.guns = { pistol, paint, shotgun };
    this.arm.visible = false;
    this.pickWeapon(0);
  }

  get weapon(): Weapon {
    return WEAPONS[this.weaponIndex];
  }

  pickWeapon(i: number): void {
    this.weaponIndex = ((i % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
    for (const w of WEAPONS) this.guns[w.id].visible = w === this.weapon;
    this.reloading = 0;
    this.cooldown = 0.25;
  }

  reload(): void {
    if (this.reloading > 0 || this.ammo[this.weaponIndex] === this.weapon.mag) return;
    this.reloading = this.weapon.reload;
    this.events.push({ kind: 'reload', at: this.muzzle(this.v2.clone()) });
  }

  /** Where the muzzle is now (world). */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    return this.arm.localToWorld(out.set(0, 0.04, this.muzzleZ[this.weapon.id]));
  }

  /**
   * Hold the weapon toward the aim point: the arm out of the driver's (right) window, or, across the car, held
   * inside from the driver's seat toward the passenger window (the muzzle stays in the car). `car` is the car's
   * object (+z forward, +x its left).
   */
  pose(car: THREE.Object3D, aimPoint: THREE.Vector3, side: Side): void {
    this.arm.visible = true;
    const m = this.seat === 'right' ? 1 : -1;
    if (side === 'driver') {
      const w = this.v.set(-0.95 * m, 1.02, 0.1);
      const d = car.worldToLocal(this.v2.copy(aimPoint)).sub(w).normalize();
      this.arm.position.copy(w).addScaledVector(d, 0.32);
    } else {
      // Across the car the view is the driver's own: the weapon held out low and to the right of the eye,
      // pointing at the crosshair, as in a first-person view.
      const eye = car.localToWorld(this.v.set(EYE.x * m, EYE.y, EYE.z));
      const d = this.v2.copy(aimPoint).sub(eye).normalize();
      const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
      eye.addScaledVector(d, 0.6).addScaledVector(right, 0.2).add(new THREE.Vector3(0, -0.24, 0));
      this.arm.position.copy(car.worldToLocal(eye));
    }
    this.arm.lookAt(aimPoint);
  }

  /** Nearest thing along a ray: a target face, the ground, or (none) far along it. */
  pick(origin: THREE.Vector3, dir: THREE.Vector3, far = 320): { point: THREE.Vector3; target: TargetHit | null; body: BodyHit | null; ground: boolean } {
    const t = this.targets.cast(origin, dir, far);
    const b = this.castBodies(origin, dir, far);
    const g = this.groundCast(origin, dir, Math.min(t?.distance ?? far, b?.distance ?? far));
    if (g !== null) return { point: origin.clone().addScaledVector(dir, g), target: null, body: null, ground: true };
    if (b && (!t || b.distance < t.distance)) return { point: b.point, target: null, body: b, ground: false };
    if (t) return { point: t.point, target: t, body: null, ground: false };
    return { point: origin.clone().addScaledVector(dir, far), target: null, body: null, ground: false };
  }

  /** The nearest car hit volume along a ray, within far. */
  castBodies(origin: THREE.Vector3, dir: THREE.Vector3, far: number): BodyHit | null {
    if (!this.bodies.length) return null;
    this.ray.set(origin, dir);
    this.ray.far = far;
    const hits = this.ray.intersectObjects(this.bodies, false);
    if (!hits.length) return null;
    // Through a window (not the roof: steel) to a head behind it; into the side of the body at a wheel, the tyre.
    let h = hits[0];
    const part = (x: THREE.Intersection): string => x.object.userData.part as string;
    const window = !!h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y < 0.5;
    for (const k of hits.slice(1)) {
      if ((part(h) === 'glass' && window && part(k) === 'head' && k.distance - h.distance < 2.2) || (part(h) === 'body' && part(k) === 'tyre' && k.distance - h.distance < 0.35)) {
        h = k;
        break;
      }
    }
    const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : dir.clone().negate();
    return { id: h.object.userData.id as string, object: h.object, point: h.point.clone(), normal, distance: h.distance };
  }

  /** Distance along a ray to the ground (marching, then bisecting), or null within far. */
  groundCast(o: THREE.Vector3, d: THREE.Vector3, far: number): number | null {
    const below = (s: number): boolean => o.y + d.y * s < this.course.height(o.x + d.x * s, o.z + d.z * s);
    let a = 0;
    let s = 0.4;
    while (s <= far) {
      if (below(s)) {
        let lo = a;
        let hi = s;
        for (let i = 0; i < 10; i++) {
          const m = (lo + hi) / 2;
          if (below(m)) hi = m;
          else lo = m;
        }
        return hi;
      }
      a = s;
      s += Math.min(3, 0.4 + s * 0.05);
    }
    return null;
  }

  /**
   * Pull the trigger (a press, or held for automatic fire). Returns the kick to add to the aim (rad), 0 if no
   * shot went off.
   */
  fire(ctx: FireContext, held: boolean): number {
    const W = this.weapon;
    if (held && !W.auto) return 0;
    // The shotgun is Mack's to fire (his rig's shells and lever; the page calls `blast`).
    if (W.id === 'shotgun') return 0;
    if (this.reloading > 0 || this.cooldown > 0) return 0;
    const muzzle = this.muzzle(new THREE.Vector3());
    if (this.ammo[this.weaponIndex] <= 0) {
      if (!held) this.events.push({ kind: 'dry', at: muzzle });
      this.cooldown = 0.25;
      if (!held) this.reload();
      return 0;
    }
    this.ammo[this.weaponIndex]--;
    this.cooldown = W.interval * (ctx.across ? 1.6 : 1);
    this.shots++;
    const dir = ctx.aimPoint.clone().sub(muzzle).normalize();
    // The pistol's assist (aiming only): a target within a couple of degrees pulls the shot most of the way to its centre.
    // Only when the shot would miss (a precise shot at a tyre or a head stays where it's aimed), and only toward
    // a car's body, never a tyre or a head.
    if (W.id === 'pistol' && !ctx.hip && this.assist && !this.castBodies(muzzle, dir, 400)) {
      let best = 0.035;
      let pull: THREE.Vector3 | null = null;
      const centres = [
        ...this.targets.list.filter((t) => t.fall <= 0.3).map((t) => this.targets.centre(t, new THREE.Vector3())),
        ...this.bodies.filter((b) => b.userData.part === 'body').map((b) => b.getWorldPosition(new THREE.Vector3())),
      ];
      for (const at of centres) {
        const c = at.sub(muzzle);
        const ang = c.angleTo(dir);
        if (ang < best) {
          best = ang;
          pull = c.normalize();
        }
      }
      if (pull) dir.lerp(pull, 0.6).normalize();
    }
    jitter(dir, spreadOf(W, ctx));
    this.events.push({ kind: W.id, at: muzzle });
    if (W.id === 'pistol') {
      const p = this.pick(muzzle, dir, 400);
      this.showTracer(muzzle, p.point);
      this.flashAt(muzzle);
      if (p.target) this.land(p.target, 'bullet', ctx.mult, ctx.why);
      else if (p.body) this.strike(p.body, 'bullet');
      else {
        this.miss();
        if (p.ground) {
          this.mark(p.point, 'hole');
          this.burst(p.point, [0.55, 0.5, 0.45], 10, 2.5);
          this.events.push({ kind: 'ground', at: p.point });
        }
      }
    } else {
      const c = PAINTS[this.paintNext++ % PAINTS.length];
      this.balls.push({ pos: muzzle.clone(), vel: dir.multiplyScalar(W.speed).add(ctx.carVel), color: c, life: 4, mult: ctx.mult, why: ctx.why });
      if (this.balls.length > 150) this.balls.shift();
    }
    // The last round: reload straight away.
    if (this.ammo[this.weaponIndex] === 0) this.reload();
    return W.kick * (0.7 + Math.random() * 0.6);
  }

  private land(h: TargetHit, kind: 'bullet' | 'paint', mult: number, why: string, color?: THREE.Color): void {
    const base = this.targets.hit(h, kind, color);
    const points = Math.round(base * mult);
    this.score += points;
    this.hits++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.hitMark = 0.25;
    this.scored.push({ points, base, mult, why });
    const plate = h.target.kind === 'plate';
    if (kind === 'paint') {
      this.burst(h.point, [color!.r, color!.g, color!.b], 14, 2.2, h.normal);
      this.events.push({ kind: plate ? 'ding' : 'splat', at: h.point });
    } else {
      this.burst(h.point, plate ? [3, 1.6, 0.5] : [0.92, 0.9, 0.84], plate ? 16 : 10, plate ? 4 : 2, h.normal);
      this.events.push({ kind: plate ? 'ding' : 'paper', at: h.point });
    }
  }

  /** A shot strikes a car: sparks or paint, a sound, and the page's say (damage, penalties, marks on it). */
  private strike(h: BodyHit, kind: 'bullet' | 'paint', color?: THREE.Color): void {
    this.hits++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.hitMark = 0.25;
    if (kind === 'paint') {
      this.burst(h.point, [color!.r, color!.g, color!.b], 14, 2.2, h.normal);
      this.events.push({ kind: 'splat', at: h.point });
    } else {
      this.burst(h.point, [3, 1.8, 0.7], 14, 4, h.normal);
      this.events.push({ kind: 'clang', at: h.point });
    }
    this.onBody?.(h, kind, color);
  }

  private miss(): void {
    this.streak = 0;
  }

  /**
   * A shotgun's blast from `muzzle` along `dir`: `pellets` hitscan rays in a cone of half-angle `spread`, each
   * striking a target, a car or the ground; one shot and (if any pellet struck) one hit in the tally, each
   * pellet's points scored. Out of the page's own gun (Mack's, models/firstPerson.ts), so no ammo here.
   */
  blast(muzzle: THREE.Vector3, dir: THREE.Vector3, pellets: number, spread: number, mult: number, why: string): void {
    this.shots++;
    this.events.push({ kind: 'pistol', at: muzzle.clone() });
    this.flashAt(muzzle);
    let struck = false;
    let points = 0;
    let base = 0;
    for (let i = 0; i < pellets; i++) {
      const d = dir.clone().normalize();
      jitter(d, spread);
      const p = this.pick(muzzle, d, 220);
      if (i === 0) this.showTracer(muzzle, p.point);
      if (p.target) {
        const b = this.targets.hit(p.target, 'bullet');
        base += b;
        points += Math.round(b * mult);
        struck = true;
        const plate = p.target.target.kind === 'plate';
        this.burst(p.point, plate ? [3, 1.6, 0.5] : [0.92, 0.9, 0.84], plate ? 8 : 5, plate ? 4 : 2, p.target.normal);
        if (i % 3 === 0) this.events.push({ kind: plate ? 'ding' : 'paper', at: p.point });
      } else if (p.body) {
        struck = true;
        this.burst(p.point, [3, 1.8, 0.7], 6, 4, p.body.normal);
        this.onBody?.(p.body, 'bullet');
      } else if (p.ground) {
        this.mark(p.point, 'hole');
        if (i % 2 === 0) this.burst(p.point, [0.55, 0.5, 0.45], 5, 2.5);
      }
    }
    if (struck) {
      this.hits++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.hitMark = 0.25;
      if (points > 0) {
        this.score += points;
        this.scored.push({ points, base, mult, why });
      }
    } else this.miss();
  }

  /** Clean the targets and the ground, and start the score again. */
  reset(): void {
    this.targets.cleanAll();
    this.nSplat = this.nHole = 0;
    this.splats.count = this.holes.count = 0;
    this.balls.length = 0;
    this.score = this.shots = this.hits = this.streak = this.bestStreak = 0;
    this.ammo.forEach((_, i) => (this.ammo[i] = WEAPONS[i].mag));
    this.reloading = 0;
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.hitMark = Math.max(0, this.hitMark - dt);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        this.ammo[this.weaponIndex] = this.weapon.mag;
      }
    }
    // Paintballs: gravity and drag, then what they struck on the way.
    const dir = new THREE.Vector3();
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      const prev = b.pos.clone();
      const sp = b.vel.length();
      b.vel.y -= 9.81 * dt;
      b.vel.multiplyScalar(Math.max(0, 1 - 0.0045 * sp * dt));
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      dir.copy(b.pos).sub(prev);
      const len = dir.length();
      dir.divideScalar(len || 1);
      const t = this.targets.cast(prev, dir, len);
      const bh = this.castBodies(prev, dir, len);
      const g = this.groundCast(prev, dir, len);
      if (bh && (g === null || bh.distance < g) && (!t || bh.distance < t.distance)) {
        this.strike(bh, 'paint', b.color);
        this.balls.splice(i, 1);
      } else if (t && (g === null || t.distance < g)) {
        this.land(t, 'paint', b.mult, b.why, b.color);
        this.balls.splice(i, 1);
      } else if (g !== null) {
        const p = prev.addScaledVector(dir, g);
        this.mark(p, 'splat', b.color);
        this.burst(p, [b.color.r, b.color.g, b.color.b], 8, 1.6);
        this.events.push({ kind: 'ground', at: p });
        this.miss();
        this.balls.splice(i, 1);
      } else if (b.life <= 0) {
        this.miss();
        this.balls.splice(i, 1);
      }
    }
    this.balls.forEach((b, i) => {
      this.ballMesh.setMatrixAt(i, this.m4.makeTranslation(b.pos.x, b.pos.y, b.pos.z));
      this.ballMesh.setColorAt(i, b.color);
    });
    this.ballMesh.count = this.balls.length;
    this.ballMesh.instanceMatrix.needsUpdate = true;
    if (this.ballMesh.instanceColor) this.ballMesh.instanceColor.needsUpdate = true;
    // Particles.
    for (let k = 0; k < this.pLife.length; k++) {
      if (this.pLife[k] <= 0) continue;
      this.pLife[k] -= dt * 1.4;
      this.pVel[k * 3 + 1] -= 9.81 * dt;
      for (let a = 0; a < 3; a++) this.pPos[k * 3 + a] += this.pVel[k * 3 + a] * dt;
    }
    const pg = this.particles.geometry;
    pg.attributes.position.needsUpdate = true;
    pg.attributes.color.needsUpdate = true;
    pg.attributes.life.needsUpdate = true;
    // Tracer and flash fade.
    this.tracerT = Math.max(0, this.tracerT - dt);
    (this.tracer.material as THREE.LineBasicMaterial).opacity = this.tracerT / 0.07;
    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.intensity = this.flashT > 0 ? 40 * (this.flashT / 0.05) : 0;
    this.flashSprite.visible = this.flashT > 0.02;
  }

  set pointScale(v: number) {
    (this.particles.material as THREE.ShaderMaterial).uniforms.uScale.value = v;
  }

  private showTracer(a: THREE.Vector3, b: THREE.Vector3): void {
    const p = this.tracer.geometry.attributes.position as THREE.BufferAttribute;
    p.setXYZ(0, a.x, a.y, a.z);
    p.setXYZ(1, b.x, b.y, b.z);
    p.needsUpdate = true;
    this.tracerT = 0.07;
  }

  private flashAt(p: THREE.Vector3): void {
    this.flash.position.copy(p);
    this.flashSprite.position.copy(p);
    this.flashSprite.material.rotation = Math.random() * Math.PI;
    this.flashT = 0.05;
  }

  /** A decal on the ground: a paint splat or a bullet's mark. */
  private mark(p: THREE.Vector3, kind: 'splat' | 'hole', color?: THREE.Color): void {
    const [nx, ny, nz] = this.course.normal(p.x, p.z);
    this.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, ny, nz));
    this.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2));
    const y = this.course.height(p.x, p.z) + 0.015;
    if (kind === 'splat') {
      const s = 0.3 + Math.random() * 0.25;
      this.m4.compose(this.v.set(p.x, y, p.z), this.q, this.v2.set(s, 1, s));
      const i = this.nSplat++ % this.splats.instanceMatrix.count;
      this.splats.setMatrixAt(i, this.m4);
      this.splats.setColorAt(i, color!);
      this.splats.count = Math.min(this.nSplat, this.splats.instanceMatrix.count);
      this.splats.instanceMatrix.needsUpdate = true;
      this.splats.instanceColor!.needsUpdate = true;
    } else {
      const s = 0.1 + Math.random() * 0.04;
      this.m4.compose(this.v.set(p.x, y, p.z), this.q, this.v2.set(s, 1, s));
      const i = this.nHole++ % this.holes.instanceMatrix.count;
      this.holes.setMatrixAt(i, this.m4);
      this.holes.count = Math.min(this.nHole, this.holes.instanceMatrix.count);
      this.holes.instanceMatrix.needsUpdate = true;
    }
  }

  /** A burst of particles from p (off a surface along its normal, or up). */
  private burst(p: THREE.Vector3, rgb: readonly number[], n: number, speed: number, normal?: THREE.Vector3): void {
    for (let i = 0; i < n; i++) {
      const k = this.pNext++ % this.pLife.length;
      this.pPos.set([p.x, p.y, p.z], k * 3);
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      if (normal) d.addScaledVector(normal, 1.2).normalize();
      const s = speed * (0.4 + Math.random() * 0.8);
      this.pVel.set([d.x * s, d.y * s + 0.5, d.z * s], k * 3);
      this.pCol.set(rgb, k * 3);
      this.pLife[k] = 0.6 + Math.random() * 0.4;
    }
  }
}

/** A shot's spread (rad, the cone's half-angle): it opens with the slide and the speed, across the car and from the hip. */
export function spreadOf(W: Weapon, c: { slide: number; speed: number; across: boolean; hip: boolean }): number {
  return W.spread * (1 + Math.abs(c.slide) * 2.5 + c.speed / 30) * (c.across ? 2.5 : 1) * (c.hip ? 2 : 1);
}

/** Turn a unit vector by a random angle within a cone of half-angle a. */
function jitter(d: THREE.Vector3, a: number): void {
  const up = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(d, up).normalize();
  const v = new THREE.Vector3().crossVectors(d, u);
  const r = a * Math.sqrt(Math.random());
  const t = Math.random() * Math.PI * 2;
  d.addScaledVector(u, Math.cos(t) * r).addScaledVector(v, Math.sin(t) * r).normalize();
}

/** Textures drawn once: a white splat (tinted per instance), a bullet's mark, a muzzle flash. */
export function decalTexture(kind: 'splat' | 'hole' | 'flash'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  if (kind === 'splat') splat(g, 64, 64, 380, new THREE.Color(1, 1, 1));
  else if (kind === 'hole') {
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 60);
    gr.addColorStop(0, 'rgba(10,10,10,0.95)');
    gr.addColorStop(0.25, 'rgba(40,38,36,0.7)');
    gr.addColorStop(1, 'rgba(90,86,80,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  } else {
    g.translate(64, 64);
    for (let i = 0; i < 6; i++) {
      g.rotate(Math.PI / 3);
      const gr = g.createLinearGradient(0, 0, 60, 0);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, -6);
      g.lineTo(60, 0);
      g.lineTo(0, 6);
      g.fill();
    }
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 30);
    gr.addColorStop(0, 'rgba(255,255,240,1)');
    gr.addColorStop(1, 'rgba(255,180,90,0)');
    g.fillStyle = gr;
    g.fillRect(-64, -64, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

