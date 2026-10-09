import * as THREE from 'three';

/**
 * Muzzle flashes, from footage of one (the user's word, 2026-10-05, on two drawn ones, a spiked star and then a
 * ball of noise: "cartoony", "still not satisfied"): assets/vfx/muzzle_side.webp and muzzle_front.webp are a
 * simulated flash's frames, 5 x 4 each, seen from the side and from the front (CGHEVEN's "Muzzle Flash 01", CC0;
 * the folder's CREDITS.md; cut down by scripts/vfx/flash_atlas.py). A shot plays through them in a few hundredths
 * of a second (longer in slow motion, where you see it bloom and break up): from the side as a card along the bore
 * turned to face you, the fire reaching forward from the muzzle; from in front or behind as one facing you at the
 * muzzle; between, both. Each shot starts a frame or two in or out, a little bigger or smaller, the card either way
 * up. By day it's thin (`dark`: 0 broad day, 1 night); at night it has a faint halo. A flash rides with its shooter
 * (`vel`: from a moving car it would otherwise be left behind the gun within a frame). No light of its own (a new
 * light recompiles every city shader): where the page has one to lend, `strength` and `at` say how bright and where
 * (the city: real/gunfire.ts, through the screens' lights).
 */

const maps = import.meta.glob('../../../assets/vfx/muzzle_*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const urlOf = (name: string): string => Object.entries(maps).find(([p]) => p.endsWith(`muzzle_${name}.webp`))?.[1] ?? '';

/** The flipbooks' grid, the frames a shot plays from and to, and how long that takes (s). */
const COLS = 5;
const ROWS = 4;
const FIRST = 2;
const LAST = 17;
const LIFE = 0.06;
const GLOW_LIFE = 0.08;
/** Where the muzzle is in a frame of each (u from the left, v from the bottom), and a frame's width for a pistol (m). */
const SIDE_AT = [0.19, 0.58] as const;
const FRONT_AT = [0.47, 0.57] as const;
const CELL = 0.44;

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,205,150,0.6)');
  gr.addColorStop(0.3, 'rgba(255,170,100,0.2)');
  gr.addColorStop(1, 'rgba(255,140,70,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Flash {
  readonly side: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly front: THREE.Sprite;
  readonly glow: THREE.Sprite;
  readonly at: THREE.Vector3;
  readonly dir: THREE.Vector3;
  readonly vel: THREE.Vector3;
  t: number;
  size: number;
  from: number;
  flip: number;
}

const _up = new THREE.Vector3();
const _n = new THREE.Vector3();
const _to = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();

export class MuzzleFlashes {
  readonly group = new THREE.Group();
  private readonly list: Flash[] = [];
  private next = 0;
  /** How dark it is round the gun (0 broad day, 1 night): by day a flash is thin and has no halo. */
  dark = 1;
  /** The newest flash, for whoever lends it a light: where it is, the way the gun points, and how bright it still is (0-1). */
  readonly at = new THREE.Vector3();
  readonly dir = new THREE.Vector3(0, 0, 1);
  strength = 0;
  private newest: Flash | null = null;
  private readonly eye = new THREE.Vector3();

  constructor(count = 5) {
    this.group.name = 'muzzle flashes';
    const glowMap = glowTexture();
    const additive = { blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false } as const;
    const quad = new THREE.PlaneGeometry(1, 1);
    // One picture each, a view of it per flash (its own frame of the grid).
    const views: Record<'side' | 'front', THREE.Texture[]> = { side: [], front: [] };
    const view = (which: 'side' | 'front'): THREE.Texture => {
      const t = new THREE.Texture();
      t.colorSpace = THREE.SRGBColorSpace;
      t.repeat.set(1 / COLS, 1 / ROWS);
      views[which].push(t);
      return t;
    };
    for (let i = 0; i < count; i++) {
      const side = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({ map: view('side'), side: THREE.DoubleSide, forceSinglePass: true, ...additive }));
      side.matrixAutoUpdate = false;
      side.frustumCulled = false;
      const front = new THREE.Sprite(new THREE.SpriteMaterial({ map: view('front'), ...additive }));
      front.center.set(FRONT_AT[0], FRONT_AT[1]);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: new THREE.Color(1, 0.7, 0.42), ...additive }));
      side.visible = front.visible = glow.visible = false;
      side.renderOrder = front.renderOrder = glow.renderOrder = 7;
      this.group.add(glow, side, front);
      this.list.push({ side, front, glow, at: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), vel: new THREE.Vector3(), t: 99, size: 1, from: FIRST, flip: 1 });
    }
    for (const which of ['side', 'front'] as const) {
      const url = urlOf(which);
      if (!url) continue;
      new THREE.ImageLoader().load(url, (image) => {
        for (const t of views[which]) {
          t.image = image;
          t.needsUpdate = true;
        }
      });
    }
  }

  /** A shot at `at` along `dir`: `size` 1 a pistol's, more for a shotgun; `vel` the shooter's own velocity (m/s). */
  fire(at: THREE.Vector3, dir: THREE.Vector3, size = 1, vel?: THREE.Vector3): void {
    const f = this.list[this.next];
    this.next = (this.next + 1) % this.list.length;
    f.t = 0;
    // (No two alike: the powder never burns the same twice.)
    f.size = size * (0.75 + Math.random() * 0.5);
    f.from = FIRST + Math.floor(Math.random() * 3);
    f.flip = Math.random() < 0.3 ? -1 : 1;
    f.front.material.rotation = (Math.random() - 0.5) * 1.2;
    if (vel) f.vel.copy(vel);
    else f.vel.set(0, 0, 0);
    f.at.copy(at);
    f.dir.copy(dir).normalize();
    this.newest = f;
    this.dir.copy(f.dir);
    this.pose(f);
  }

  /** `eye`: where it's seen from (the cards turn to it). */
  update(dt: number, eye?: THREE.Vector3): void {
    if (eye) this.eye.copy(eye);
    for (const f of this.list) {
      if (f.t > GLOW_LIFE) continue;
      f.t += dt;
      f.at.addScaledVector(f.vel, dt);
      this.pose(f);
    }
    const n = this.newest;
    this.strength = n && n.t < GLOW_LIFE ? (1 - n.t / GLOW_LIFE) ** 2 * this.dark * Math.min(1.3, n.size) : 0;
    if (n) this.at.copy(n.at).addScaledVector(n.dir, 0.1);
  }

  /** For a shader warm-up: every flash's parts shown (a flash that's over isn't drawn, so its programs wouldn't compile), or put away. */
  warm(on: boolean): void {
    for (const f of this.list) if (f.t > GLOW_LIFE) f.side.visible = f.front.visible = f.glow.visible = on;
  }

  private pose(f: Flash): void {
    const hot = f.t < LIFE;
    f.side.visible = f.front.visible = hot;
    const g = Math.min(1, f.t / GLOW_LIFE);
    f.glow.visible = f.t < GLOW_LIFE && this.dark > 0.2;
    f.glow.position.copy(f.at).addScaledVector(f.dir, 0.1);
    f.glow.scale.setScalar(0.6 * f.size * (1 + 0.5 * g));
    f.glow.material.opacity = 0.3 * this.dark * (1 - g) * (1 - g);
    if (!hot) return;
    // Its frame of the footage.
    const frame = Math.min(LAST, Math.floor(f.from + (f.t / LIFE) * (LAST + 1 - f.from)));
    const u = (frame % COLS) / COLS;
    const v = 1 - (Math.floor(frame / COLS) + 1) / ROWS;
    f.side.material.map!.offset.set(u, v);
    f.front.material.map!.offset.set(u, v);
    // How much it's seen end on: the side card from the side, the front one from ahead or behind.
    _to.copy(this.eye).sub(f.at).normalize();
    const along = Math.abs(_to.dot(f.dir));
    const lit = (0.45 + 0.55 * this.dark) * 1.5;
    const ws = 1 - THREE.MathUtils.smoothstep(along, 0.8, 0.98);
    const wf = THREE.MathUtils.smoothstep(along, 0.55, 0.92);
    _up.crossVectors(_to, f.dir);
    f.side.visible = ws > 0.01 && _up.lengthSq() > 1e-4;
    if (f.side.visible) {
      // The card: along the bore, across your line of sight, the footage's top upward (or, some shots, down).
      _up.normalize();
      if (_up.y < 0) _up.negate();
      _up.multiplyScalar(f.flip);
      _n.crossVectors(f.dir, _up);
      const w = CELL * f.size;
      _x.copy(f.dir).multiplyScalar(w);
      _y.copy(_up).multiplyScalar(w);
      f.side.matrix.makeBasis(_x, _y, _n);
      f.side.matrix.setPosition(f.at.x + _x.x * (0.5 - SIDE_AT[0]) + _y.x * (0.5 - SIDE_AT[1]), f.at.y + _x.y * (0.5 - SIDE_AT[0]) + _y.y * (0.5 - SIDE_AT[1]), f.at.z + _x.z * (0.5 - SIDE_AT[0]) + _y.z * (0.5 - SIDE_AT[1]));
      f.side.matrixWorldNeedsUpdate = true;
      f.side.material.color.setScalar(lit * ws);
    }
    f.front.visible = wf > 0.01;
    f.front.position.copy(f.at).addScaledVector(f.dir, 0.03);
    f.front.scale.setScalar(CELL * 0.85 * f.size);
    f.front.material.color.setScalar(lit * wf);
  }
}
