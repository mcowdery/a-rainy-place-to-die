import * as THREE from 'three';
import type { Building3 } from '../district/plan';
import { GF } from './buildings';
import type { CityUniforms } from './city';
import { localBox, localFrame, localYaw, toWorld, type LocalFrame } from './localFrame';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';
import { addFigure, GhostBuilder, type FigureSpec } from './people';
import type { ScreenLight } from './screenLight';

type C3 = [number, number, number];
export type Facing = 'out' | 'in' | '+u' | '-u';

/**
 * A toolkit for hand-built landmarks, in the building's local frame (u along the street face, t inward,
 * y up): boxes of any surface kind, glass, canvas signs (neon ones follow the city's neon level), people.
 * finish() turns it all into one group: one city-material mesh, one glass mesh, the sign planes, the ghosts.
 */
export class Kit {
  readonly f: LocalFrame;
  readonly mb = new MeshBuilder();
  readonly group = new THREE.Group();
  /** Screens on this landmark that light their surroundings. */
  readonly lights: ScreenLight[] = [];
  private readonly glassB = new MeshBuilder();
  private readonly people = new GhostBuilder();
  private readonly neon: THREE.MeshBasicMaterial[] = [];
  private hasPeople = false;

  constructor(readonly b: Building3) {
    this.f = localFrame(b);
    this.mb.id = b.id;
    this.mb.flags = 0;
    this.mb.style = [0, 0, 0, 0];
  }

  private put(kind: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, bottom: boolean): void {
    localBox(this.mb, this.f, Math.min(u0, u1), Math.max(u0, u1), Math.min(t0, t1), Math.max(t0, t1), y0, y1, kind, bottom);
  }

  /** A plain box (a bottom face when raised off the ground). */
  box(hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, bottom = y0 > 0.3): void {
    this.mb.kind = KIND.plain;
    this.mb.color = lin(hex);
    this.put(KIND.plain, u0, u1, t0, t1, y0, y1, bottom);
  }

  /** A box of another surface kind (gloss paint, chrome, glass...). */
  kind(kind: number, hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void {
    this.mb.kind = kind;
    this.mb.color = lin(hex);
    this.put(kind, u0, u1, t0, t1, y0, y1, y0 > 0.3);
  }

  /** An emissive box: rgb is linear light; ch always, lamp (night) or neon. */
  glow(rgb: C3, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, ch: number = EMIT.always): void {
    this.mb.kind = KIND.emit;
    this.mb.style = [ch, 0, 0, 0];
    this.mb.color = rgb;
    this.put(KIND.emit, u0, u1, t0, t1, y0, y1, true);
    this.mb.style = [0, 0, 0, 0];
  }

  /** A surface under its own lights (lobbies, canopies): lit at night, or always (interior). */
  lit(hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, always = false): void {
    this.mb.kind = KIND.emit;
    this.mb.style = [always ? EMIT.interior : EMIT.lit, 0, 0, 0];
    this.mb.color = lin(hex);
    this.put(KIND.emit, u0, u1, t0, t1, y0, y1, y0 > 0.3);
    this.mb.style = [0, 0, 0, 0];
  }

  /**
   * A block of facade with the city shader's windows: style [bay, window share, window height, type]
   * (buildings.ts WIN); flags as in buildings.ts (bit 0 shop open, 1-2 shop palette, 3 dark frames,
   * 4-6 lit bias, 7 tiled). front: the street face gets the storefront under GF.
   */
  facade(hex: number, style: readonly [number, number, number, number], flags: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, front = false): void {
    const floors = Math.max(0, Math.floor((y1 - GF - 0.5) / 3));
    this.mb.kind = KIND.wall;
    this.mb.color = lin(hex);
    this.mb.flags = flags;
    this.mb.style = [style[0], style[1], style[2], style[3] + 8 * floors];
    this.mb.frontNormal = front ? this.f.n : null;
    this.put(KIND.roof, u0, u1, t0, t1, y0, y1, y0 > 0.3);
    this.mb.kind = KIND.wall;
    this.mb.frontNormal = null;
    this.mb.flags = 0;
    this.mb.style = [0, 0, 0, 0];
  }

  post(hex: number, u: number, t: number, y0: number, y1: number, r: number, n = 10): void {
    this.mb.kind = KIND.plain;
    this.mb.color = lin(hex);
    const [x, z] = toWorld(this.f, u, t);
    this.mb.cylinder(x, z, y0, y1, r, n);
  }

  /** A round form: rings of [y, radius]. */
  lathe(hex: number, u: number, t: number, rings: readonly (readonly [number, number])[], n = 16): void {
    this.mb.kind = KIND.plain;
    this.mb.color = lin(hex);
    const [x, z] = toWorld(this.f, u, t);
    this.mb.lathe(x, z, rings, n);
  }

  /** A glass pane along u at depth t. */
  pane(u0: number, u1: number, y0: number, y1: number, t: number): void {
    const [ax, az] = toWorld(this.f, u0, t);
    const [bx, bz] = toWorld(this.f, u1, t);
    this.glassB.quad([ax, y0, az], [bx - ax, 0, bz - az], [0, y1 - y0, 0]);
  }

  /** A glass pane along t at u. */
  paneT(u: number, t0: number, t1: number, y0: number, y1: number): void {
    const [ax, az] = toWorld(this.f, u, t0);
    const [bx, bz] = toWorld(this.f, u, t1);
    this.glassB.quad([ax, y0, az], [bx - ax, 0, bz - az], [0, y1 - y0, 0]);
  }

  canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  image(url: string): THREE.Texture {
    const tex = new THREE.TextureLoader().load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /** A sign plane facing out of the street face (or in, or along ±u). neon: brightens at night. */
  plane(tex: THREE.Texture, w: number, h: number, u: number, t: number, y: number, facing: Facing = 'out', bright = 1.0, neon = false): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(bright, bright, bright) });
    if (neon) {
      mat.userData.bright = bright;
      this.neon.push(mat);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const [x, z] = toWorld(this.f, u, t);
    m.position.set(x, y, z);
    const n = facing === 'out' ? this.f.n : facing === 'in' ? [-this.f.n[0], 0, -this.f.n[2]] : facing === '+u' ? this.f.r : [-this.f.r[0], 0, -this.f.r[2]];
    m.rotation.y = Math.atan2(n[0], n[2]);
    this.group.add(m);
    return m;
  }

  /** A person (ghost) at local (u, t) facing local direction (du, dt). */
  person(u: number, t: number, du: number, dt: number, spec: Partial<FigureSpec> = {}): void {
    const [x, z] = toWorld(this.f, u, t);
    this.hasPeople = true;
    addFigure(this.people, {
      x,
      z,
      yaw: localYaw(this.f, du, dt),
      body: 'man',
      pose: 'stand',
      color: [0.78, 0.84, 1.0],
      hair: 'short',
      long: false,
      phase: 0,
      side: 1,
      look: 0,
      ...spec,
    });
  }

  finish(city: THREE.Material, ghost: THREE.Material): THREE.Group {
    const geo = this.mb.build();
    if (geo) {
      const m = new THREE.Mesh(geo, city);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }
    const g = this.glassB.build();
    if (g) {
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x9ab8c4, transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = 3;
      this.group.add(m);
    }
    if (this.hasPeople) {
      const m = new THREE.Mesh(this.people.build(0, 0)!, ghost);
      m.renderOrder = 2;
      this.group.add(m);
    }
    return this.group;
  }

  /** Neon planes follow the city's neon level (dim by day). */
  update(u: CityUniforms): void {
    for (const m of this.neon) m.color.setScalar(m.userData.bright * (0.45 + 0.55 * u.uNeon.value));
  }
}

/** Text helper for canvas signs. */
export function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, fill: string, align: CanvasTextAlign = 'center'): void {
  g.font = font;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillStyle = fill;
  g.fillText(s, x, y);
}

/** Neon-style text: a coloured glow under a pale core. */
export function neonText(g: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string): void {
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  for (const blur of [26, 10]) {
    g.shadowBlur = blur;
    g.fillStyle = color;
    g.fillText(s, x, y);
  }
  g.shadowBlur = 0;
  g.fillStyle = '#fff6fa';
  g.fillText(s, x, y);
}

export type { LocalFrame };
export { localFrame, toWorld };
