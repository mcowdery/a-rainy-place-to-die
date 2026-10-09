import * as THREE from 'three';
import { hash, rng, type Rng } from '../../core/hash';
import { addFigure, GHOST_COLORS, GhostBuilder, ghostMaterial, type Body, type FigureSpec, type Hair, type Outfit, type Pose } from './people';
import { TRADE as T, TRADE_COUNT } from './shops';
import { paintWindowAtlas, sceneLayerImage } from './windowAtlas';
import { TOTO_TEXT, type ShopText } from './shopText';
import { SHOP_KINDS, shopScenes, WINDOW_ATLAS, type Scene, type ShopKind } from './windowScenes';

/**
 * The storefront interiors' art: each shop trade's room (shops.ts) painted once on canvas into an atlas, which
 * the city shader samples through the glass (shopShader.ts): the back wall, a side wall, the floor and ceiling
 * (repeating), and up to four cut-out layers standing in the room parallel to the glass (counters with the people
 * behind them, stools and the regulars on them, shelving, tables, lamps), drawn nearest first. Painting it here
 * rather than in the shader keeps the shader small (the D3D compiler took minutes over a shader version) and lets
 * the art have real text: menu strips, price cards, posters.
 *
 * Two textures: colour (RGBA, alpha the layers' cut-out) at 64 px a metre, and a mask at half that: R takes the
 * shop's own colour (its sign's: a café's paint, a clerk's uniform), G glows (screens, lamps, bottles lit from
 * behind), B animates (1: a screen cycling colours, 0.5: twinkling).
 *
 * Each trade has a 512 px block; inside it, in px: the back wall 4 m x the ceiling (256 x 192), the side wall
 * 3 m deep (192 x 192), floor and ceiling tiles 1 x 1.5 m (64 x 96 each), layers a and b 4 x 3 m (256 x 192), c and
 * d 4 x 2 m (256 x 128). Walls and layers repeat every 4 m along the shop, centred on it (or stand once in the
 * middle: `centred`).
 *
 * After the trades' blocks come the shady rooms' (windowScenes.ts SHOP_KINDS: a strip club, a hostess club, a back
 * room...), which some shops of a few trades are instead of their own where the zone has vice enough (the wall
 * shader picks: city.ts). Their people and furniture are scenes of windowScenes.ts, posed and drawn as the rooms
 * behind the upper windows are (windowAtlas.ts), over walls painted here.
 *
 * The mask texture also carries the rooms behind the upper floors' glass (windowAtlas.ts, windowScenes.ts): their
 * cells lie in rows under the storefronts' masks (its alpha theirs too), so the wall shader reads both through one
 * texture unit.
 */

export const ATLAS_W = 4096;
// (Four rows of blocks for the trades' rooms, a fifth for the shady rooms: SHADY, below.)
export const ATLAS_H = 2560;
export const BLOCK = 512;
export const BLOCK_COLS = 8;
/** Atlas pixels per metre (the colour texture). */
export const PPM = 64;

type RegionName = 'back' | 'side' | 'floor' | 'ceil' | 'a' | 'b' | 'c' | 'd';
/** Each region's rectangle in its block (px) and its size in metres (0: the room's ceiling height). */
export const REGIONS: Record<RegionName, readonly [x: number, y: number, w: number, h: number, mw: number, mh: number]> = {
  back: [0, 0, 256, 192, 4, 0],
  side: [256, 0, 192, 192, 3, 0],
  floor: [448, 0, 64, 96, 1, 1.5],
  ceil: [448, 96, 64, 96, 1, 1.5],
  a: [0, 192, 256, 192, 4, 3],
  b: [256, 192, 256, 192, 4, 3],
  c: [0, 384, 256, 128, 4, 2],
  d: [256, 384, 256, 128, 4, 2],
};

export const LAYER_REGIONS = ['a', 'b', 'c', 'd'] as const;
type LayerName = (typeof LAYER_REGIONS)[number];

export interface ShopLayer {
  readonly region: LayerName;
  /** How far in from the glass it stands (m). */
  readonly depth: number;
  /** Stands once, in the middle of the shop, rather than every 4 m. */
  readonly centred?: boolean;
  /** Carries text, so it's never mirrored (the others are, in some 4 m modules, so wide shops don't repeat). */
  readonly text?: boolean;
}

interface Mask {
  hue?: number;
  glow?: number;
  anim?: number;
}

/** Draws in a region's metres (x along, y up from the floor) onto the colour canvas and the mask. */
class Painter {
  private ox = 0;
  private oy = 0;
  private rh = 0;
  private sx = 1;
  private sy = 1;
  private open = false;
  private colStyle = '#000';
  private maskStyle = '#000';

  constructor(
    private readonly col: CanvasRenderingContext2D,
    private readonly mask: CanvasRenderingContext2D,
  ) {}

  begin(trade: number, region: RegionName, ch: number, base?: string): this {
    this.end();
    const [rx, ry, rw, rh, mw, mh] = REGIONS[region];
    this.ox = (trade % BLOCK_COLS) * BLOCK + rx;
    this.oy = Math.floor(trade / BLOCK_COLS) * BLOCK + ry;
    this.rh = rh;
    this.sx = rw / mw;
    this.sy = rh / (mh || ch);
    for (const [g, k] of [[this.col, 1], [this.mask, 0.5]] as const) {
      g.save();
      g.setTransform(k, 0, 0, k, 0, 0);
      g.beginPath();
      g.rect(this.ox, this.oy, rw, rh);
      g.clip();
      g.clearRect(this.ox, this.oy, rw, rh);
    }
    this.mask.fillStyle = '#000';
    this.mask.fillRect(this.ox, this.oy, rw, rh);
    if (base) {
      this.col.fillStyle = base;
      this.col.fillRect(this.ox, this.oy, rw, rh);
    }
    this.open = true;
    return this;
  }

  end(): void {
    if (!this.open) return;
    this.col.restore();
    this.mask.restore();
    this.open = false;
  }

  fill(css: string, m: Mask = {}): this {
    this.colStyle = css;
    const b = (v = 0): number => Math.round(Math.max(0, Math.min(1, v)) * 255);
    this.maskStyle = `rgb(${b(m.hue)},${b(m.glow)},${b(m.anim)})`;
    return this;
  }

  private draw(path: (g: CanvasRenderingContext2D) => void): this {
    for (const [g, k, s] of [[this.col, 1, this.colStyle], [this.mask, 0.5, this.maskStyle]] as const) {
      g.setTransform(k * this.sx, 0, 0, -k * this.sy, k * this.ox, k * (this.oy + this.rh));
      g.fillStyle = s;
      g.beginPath();
      path(g);
      g.fill();
    }
    return this;
  }

  rect(x: number, y: number, w: number, h: number): this {
    return this.draw((g) => g.rect(x, y, w, h));
  }

  ell(cx: number, cy: number, rx: number, ry: number): this {
    return this.draw((g) => g.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2));
  }

  /** A mob figure from the sprite sheet, its cell's bottom-left at (x, floor), 1 x 2 m (times scale). */
  sprite(m: { sheet: HTMLCanvasElement; black: HTMLCanvasElement }, src: readonly [number, number, number, number], x: number, floor: number, scale = 1): this {
    const X = this.ox + x * this.sx;
    const Y = this.oy + this.rh - (floor + 2 * scale) * this.sy;
    for (const [g, k, img] of [[this.col, 1, m.sheet], [this.mask, 0.5, m.black]] as const) {
      g.setTransform(k, 0, 0, k, 0, 0);
      g.drawImage(img, src[0], src[1], src[2], src[3], X, Y, this.sx * scale, 2 * this.sy * scale);
    }
    return this;
  }

  /** An image over the region, its bottom-left at (x, y), w x h metres (colour only: nothing of the mask's). */
  image(img: CanvasImageSource, x: number, y: number, w: number, h: number): this {
    this.col.setTransform(1, 0, 0, 1, 0, 0);
    this.col.drawImage(img, this.ox + x * this.sx, this.oy + this.rh - (y + h) * this.sy, w * this.sx, h * this.sy);
    return this;
  }

  /** The upper half of an ellipse. */
  cap(cx: number, cy: number, rx: number, ry: number): this {
    return this.draw((g) => g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI));
  }

  rrect(x: number, y: number, w: number, h: number, r: number): this {
    return this.draw((g) => g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)));
  }

  poly(pts: readonly number[]): this {
    return this.draw((g) => {
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.closePath();
    });
  }

  /** Text centred on (x, y), size metres tall; vertical runs down from y, one character under another. */
  text(s: string, x: number, y: number, size: number, opts: { align?: CanvasTextAlign; vertical?: boolean; bold?: boolean; maxW?: number } = {}): this {
    for (const [g, k, st] of [[this.col, 1, this.colStyle], [this.mask, 0.5, this.maskStyle]] as const) {
      g.setTransform(k, 0, 0, k, 0, 0);
      g.fillStyle = st;
      const px = size * this.sy;
      g.font = `${opts.bold === false ? '' : 'bold '}${Math.max(4, px)}px 'Yu Gothic', 'Meiryo', 'Arial Narrow', sans-serif`;
      g.textAlign = opts.vertical ? 'center' : (opts.align ?? 'center');
      g.textBaseline = 'middle';
      const X = this.ox + x * this.sx;
      const Y = this.oy + this.rh - y * this.sy;
      if (opts.vertical) {
        [...s].forEach((ch, i) => g.fillText(ch, X, Y + (i + 0.5) * px * 1.02));
      } else {
        const w = g.measureText(s).width;
        const max = (opts.maxW ?? Infinity) * this.sx;
        if (w > max) {
          g.save();
          g.translate(X, Y);
          g.scale(max / w, 1);
          g.fillText(s, 0, 0);
          g.restore();
        } else g.fillText(s, X, Y);
      }
    }
    return this;
  }
}

// ---- colours and pieces ----

const rgb = (r: number, g: number, b: number): string => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
const hsl = (h: number, s: number, l: number): string => `hsl(${Math.round(h * 360)},${Math.round(s * 100)}%,${Math.round(l * 100)}%)`;
/** A packaging colour: bright and varied, a few white. */
const packColor = (r: Rng): string => (r.chance(0.18) ? hsl(0, 0, 0.85 + r.float() * 0.1) : hsl(r.float(), 0.55 + r.float() * 0.35, 0.38 + r.float() * 0.3));
type MobKind = 'standFront' | 'standBack' | 'sitFront' | 'sitBack' | 'maid' | 'run' | 'mannequin';

interface PersonLook {
  back?: boolean;
  /** A particular kind of figure: a maid, someone running (on a treadmill), a shop window's mannequin. */
  kind?: 'maid' | 'run' | 'mannequin';
  /** Drawn smaller (a figure in a photo on the wall). */
  scale?: number;
}

/**
 * The mob's own figures (people.ts), rendered once into a sheet: the same templates, outfits and material as the
 * people on the street, standing and sitting, from the front and behind, so the people in the shops are the
 * city's people. Each cell is 1 x 2 m at SPRITE_PPM, its feet (or, sitting, its seat 0.46 m up) on the cell's floor.
 */
const SPRITE_PPM = 128;
const SPRITE_KINDS: readonly (readonly [MobKind, number])[] = [['standFront', 12], ['standBack', 12], ['sitFront', 8], ['sitBack', 14], ['maid', 3], ['run', 4], ['mannequin', 4]];
const SPRITE_COLS = 16;

class MobSprites {
  /** The sheet (sRGB, alpha the figures) and the same in black, for the mask. */
  readonly sheet: HTMLCanvasElement;
  readonly black: HTMLCanvasElement;
  private readonly cells = new Map<MobKind, number[]>();
  private readonly rows: number;

  constructor(renderer: THREE.WebGLRenderer) {
    const rnd = rng(hash(0x5e0b));
    const specs: FigureSpec[] = [];
    let n = 0;
    for (const [kind, count] of SPRITE_KINDS) {
      const ids: number[] = [];
      for (let i = 0; i < count; i++, n++) {
        ids.push(n);
        specs.push(spriteFigure(kind, rnd, (n % SPRITE_COLS) + 0.5, Math.floor(n / SPRITE_COLS) * 2));
      }
      this.cells.set(kind, ids);
    }
    this.rows = Math.ceil(n / SPRITE_COLS);
    const W = SPRITE_COLS * SPRITE_PPM;
    const H = this.rows * 2 * SPRITE_PPM;
    const gb = new GhostBuilder();
    for (const sp of specs) addFigure(gb, sp);
    const mat = ghostMaterial();
    mat.uniforms.uTime.value = 7.3;
    // (As the crowd outside is by default: all black.)
    mat.uniforms.uBlack.value = 1;
    (mat.uniforms.uFlat.value as THREE.Vector4).set(0.02, 0.02, 0.022, 0);
    const mesh = new THREE.Mesh(gb.build(0, 0)!, mat);
    mesh.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(mesh);
    const cam = new THREE.OrthographicCamera(0, SPRITE_COLS, this.rows * 2, 0, 0.1, 100);
    cam.position.set(0, 0, 30);
    const rt = new THREE.WebGLRenderTarget(W, H);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    const px = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    rt.dispose();
    mesh.geometry.dispose();
    mat.dispose();
    // GL rows run bottom up; the material writes linear colour, the canvas wants sRGB.
    const enc = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      const c = i / 255;
      enc[i] = Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
    }
    this.sheet = document.createElement('canvas');
    this.black = document.createElement('canvas');
    for (const cv of [this.sheet, this.black]) {
      cv.width = W;
      cv.height = H;
    }
    const a = new ImageData(W, H);
    const b = new ImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const src = ((H - 1 - y) * W + x) * 4;
        const dst = (y * W + x) * 4;
        for (let k = 0; k < 3; k++) a.data[dst + k] = enc[px[src + k]];
        a.data[dst + 3] = px[src + 3];
        b.data[dst + 3] = px[src + 3];
      }
    }
    this.sheet.getContext('2d')!.putImageData(a, 0, 0);
    this.black.getContext('2d')!.putImageData(b, 0, 0);
  }

  /** A figure of a kind: its cell in the sheet (px; the sheet's bottom row is world y 0 to 2). */
  pick(kind: MobKind, r: Rng): [number, number, number, number] {
    return this.at(r.pick(this.cells.get(kind)!));
  }

  private at(n: number): [number, number, number, number] {
    return [(n % SPRITE_COLS) * SPRITE_PPM, (this.rows - 1 - Math.floor(n / SPRITE_COLS)) * 2 * SPRITE_PPM, SPRITE_PPM, 2 * SPRITE_PPM];
  }
}

/** One of the mob as a shop has them: staff and customers in everyday clothes and suits, a maid, a runner. */
function spriteFigure(kind: MobKind, r: Rng, x: number, floor: number): FigureSpec {
  const elder = kind !== 'maid' && kind !== 'run' && kind !== 'mannequin' && r.chance(0.12);
  const body: Body = kind === 'maid' ? 'woman' : elder ? 'elder' : r.chance(0.5) ? 'man' : 'woman';
  const outfit: Outfit = kind === 'maid' ? 'maid' : elder ? r.pick(['plain', 'long'] as const) : r.pick(['plain', 'plain', 'suit', 'long', 'suit', 'work', 'otaku'] as const);
  const hair: Hair = kind === 'mannequin' ? 'none' : body === 'woman' ? r.pick(['long', 'bun', 'short'] as const) : body === 'elder' ? r.pick(['none', 'short', 'hat'] as const) : r.pick(['short', 'short', 'cap', 'none'] as const);
  const sit = kind === 'sitFront' || kind === 'sitBack';
  const back = kind === 'standBack' || kind === 'sitBack';
  const pose: Pose = sit ? 'sit' : kind === 'run' ? 'walk' : kind === 'mannequin' ? 'stand' : r.pick(['stand', 'stand', 'pockets', 'phone', 'hold'] as const);
  return {
    x,
    z: 0,
    yaw: back ? Math.PI : 0,
    body,
    pose,
    outfit,
    hair,
    long: outfit === 'long',
    color: r.pick(GHOST_COLORS),
    phase: r.float(),
    side: r.chance(0.5) ? 1 : -1,
    look: 0,
    fade: false,
    // Feet on the cell's floor (the pavement's 0.15 m taken off).
    y: floor - 0.15,
  };
}

let SPRITES: MobSprites | null = null;

/**
 * Someone at x with their shoulders at height y (standing about 1.42, sitting lower), from the front or behind:
 * one of the mob's figures, its feet on the floor (standing) or its seat 0.6 m under the shoulders (sitting).
 */
function person(p: Painter, r: Rng, x: number, y: number, o: PersonLook = {}): void {
  if (!SPRITES) return;
  const sitting = !o.kind && y < 1.32;
  const kind: MobKind = o.kind ?? (sitting ? (o.back ? 'sitBack' : 'sitFront') : o.back ? 'standBack' : 'standFront');
  const floor = sitting ? y - 0.6 - 0.46 : y - 1.42;
  const k = o.scale ?? 1;
  p.sprite(SPRITES, SPRITES.pick(kind, r), x - 0.5 * k, floor, k);
}

/** A whole figure standing on the floor. */
function standing(p: Painter, r: Rng, x: number, o: PersonLook = {}): void {
  person(p, r, x, 1.42, o);
}

/** Shelves of goods between x0 and x1, y0 to y1: boards every rowH, items cellW wide (about). */
function shelves(p: Painter, r: Rng, x0: number, x1: number, y0: number, y1: number, rowH: number, cellW: number, o: { board?: string; color?: (r: Rng) => string; fill?: number; glow?: number; hue?: number } = {}): void {
  const board = o.board ?? '#d8d8d4';
  for (let y = y0; y < y1 - 0.05; y += rowH) {
    p.fill(board).rect(x0, y, x1 - x0, 0.025);
    let x = x0 + 0.01;
    while (x < x1 - 0.02) {
      const w = cellW * (0.6 + r.float() * 0.8);
      if (r.chance(o.fill ?? 0.9)) {
        const h = (rowH - 0.05) * (0.45 + r.float() * 0.5);
        const c = (o.color ?? packColor)(r);
        const tint = o.hue !== undefined && r.chance(o.hue) ? { hue: 0.7 } : {};
        p.fill(c, { ...tint, glow: o.glow ?? 0 }).rect(x, y + 0.025, Math.min(w * 0.92, x1 - x), h);
        if (h > 0.08 && r.chance(0.5)) p.fill(r.chance(0.5) ? '#f2f0ea' : '#202020', { glow: o.glow ?? 0 }).rect(x, y + 0.025 + h * 0.35, Math.min(w * 0.92, x1 - x), h * 0.18);
      }
      x += w;
    }
  }
  p.fill(board).rect(x0, y1 - 0.025, x1 - x0, 0.025);
}

/** A row of bottles standing on a shelf at y. */
function bottles(p: Painter, r: Rng, x0: number, x1: number, y: number, h: number, glow = 0): void {
  for (let x = x0 + 0.04; x < x1 - 0.04; x += 0.07 + r.float() * 0.05) {
    const c = r.pick(['#c87a20', '#3a8a40', '#e8e4d0', '#6a2a14', '#2a5a2a', '#d8a040', '#4a6a8a']);
    const bh = h * (0.7 + r.float() * 0.3);
    p.fill(c, { glow }).rrect(x - 0.025, y, 0.05, bh * 0.7, 0.012).rect(x - 0.01, y + bh * 0.65, 0.02, bh * 0.35);
    if (r.chance(0.5)) p.fill('#f0ead8', { glow: glow * 0.5 }).rect(x - 0.022, y + bh * 0.25, 0.044, bh * 0.2);
  }
}

/** Stools every pitch metres, someone (from behind) on some. */
function stools(p: Painter, r: Rng, x0: number, x1: number, pitch: number, seat: string, share: number, seatMask: Mask = {}): void {
  for (let x = x0 + pitch / 2; x < x1; x += pitch) {
    p.fill('#888').rect(x - 0.02, 0, 0.04, 0.66).rect(x - 0.14, 0.25, 0.28, 0.025);
    p.fill(seat, seatMask).rrect(x - 0.17, 0.64, 0.34, 0.09, 0.03);
    if (r.chance(share)) person(p, r, x + (r.float() - 0.5) * 0.1, 1.22, { back: true });
  }
}

/** A bench (seat and back) from x0 to x1, people waiting on it seen from behind. */
function bench(p: Painter, r: Rng, x0: number, x1: number, seat: string, share: number, m: Mask = {}): void {
  p.fill('#777').rect(x0 + 0.1, 0, 0.04, 0.44).rect(x1 - 0.14, 0, 0.04, 0.44);
  for (let x = x0 + 0.3; x < x1 - 0.2; x += 0.6) if (r.chance(share)) person(p, r, x, 1.12, { back: true });
  p.fill(seat, m).rect(x0, 0.42, x1 - x0, 0.07).rect(x0, 0.5, x1 - x0, 0.36);
}

function counter(p: Painter, x0: number, x1: number, h: number, front: string, top: string, m: Mask = {}): void {
  p.fill(front, m).rect(x0, 0, x1 - x0, h);
  p.fill(top).rect(x0 - 0.03, h - 0.05, x1 - x0 + 0.06, 0.06);
}

/** A pendant lamp: the cord from the ceiling, the shade at y, glowing under. */
function pendant(p: Painter, x: number, y: number, top: number, r: number, shade: string, light: string): void {
  p.fill('#111').rect(x - 0.006, y, 0.012, top - y);
  p.fill(shade).poly([x - r * 0.3, y, x + r * 0.3, y, x + r, y - r * 0.8, x - r, y - r * 0.8]);
  p.fill(light, { glow: 1 }).ell(x, y - r * 0.8, r * 0.85, r * 0.12);
}

function plant(p: Painter, r: Rng, x: number, h = 1.7): void {
  p.fill('#4a4844').rrect(x - 0.22, 0, 0.44, 0.5, 0.05);
  for (let i = 0; i < 26; i++) {
    const a = r.float() * Math.PI;
    const d = r.float();
    p.fill(hsl(0.27 + r.float() * 0.08, 0.45, 0.16 + r.float() * 0.14)).ell(x + Math.cos(a) * d * 0.45, 0.6 + Math.sin(a) * d * (h - 0.6), 0.12, 0.06);
  }
}

function tiles(p: Painter, s: number, a: string, b: string, grout: string): void {
  for (let y = 0; y < 1.5; y += s) for (let x = 0; x < 1; x += s) p.fill(Math.round(x / s + y / s) % 2 ? a : b).rect(x, y, s, s);
  p.fill(grout);
  for (let y = 0; y <= 1.5; y += s) p.rect(0, y - 0.006, 1, 0.012);
  for (let x = 0; x <= 1; x += s) p.rect(x - 0.006, 0, 0.012, 1.5);
}

function planks(p: Painter, r: Rng, base: [number, number, number], w: number, across = false): void {
  for (let i = 0; i * w < (across ? 1.5 : 1); i++) {
    const k = 0.8 + r.float() * 0.35;
    p.fill(rgb(base[0] * k, base[1] * k, base[2] * k));
    if (across) p.rect(0, i * w, 1, w - 0.008);
    else p.rect(i * w, 0, w - 0.008, 1.5);
  }
}

/** Fluorescent tubes across the ceiling tile. */
function tubes(p: Painter, base: string, light = '#ffffff'): void {
  p.fill(base).rect(0, 0, 1, 1.5);
  p.fill(light, { glow: 1 }).rect(0.45, 0.2, 0.08, 1.1);
}

function downlight(p: Painter, base: string, light = '#fff6e8', size = 0.07): void {
  p.fill(base).rect(0, 0, 1, 1.5);
  p.fill(light, { glow: 1 }).ell(0.5, 0.75, size, size);
}

function poster(p: Painter, r: Rng, x: number, y: number, w: number, h: number, words: readonly string[]): void {
  const c = hsl(r.float(), 0.6, 0.45);
  p.fill('#f0ece4').rect(x, y, w, h);
  p.fill(c).rect(x + 0.03, y + h * 0.35, w - 0.06, h * 0.6);
  p.fill(hsl(r.float(), 0.4, 0.75)).ell(x + w / 2, y + h * 0.62, w * 0.22, h * 0.2);
  p.fill('#202020').text(r.pick(words), x + w / 2, y + h * 0.18, h * 0.16, { maxW: w * 0.9 });
}

/** Vertical paper menu strips (tanzaku), each with a dish and its price. */
function menuStrips(p: Painter, r: Rng, x0: number, x1: number, y0: number, y1: number, dishes: readonly string[]): void {
  for (let x = x0; x < x1 - 0.1; x += 0.15) {
    const special = r.chance(0.15);
    p.fill(special ? (r.chance(0.5) ? '#d02820' : '#f0c830') : '#f2ead8').rect(x, y0, 0.13, y1 - y0);
    const dish = r.pick(dishes);
    p.fill(special ? '#ffffff' : '#1a1a1a').text(dish, x + 0.065, y1 - 0.05, 0.085, { vertical: true });
    p.fill(special ? '#ffffff' : '#c02020').text(String(r.int(3, 9) * 100 - (r.chance(0.5) ? 20 : 0)), x + 0.065, y0 + 0.08, 0.05, { maxW: 0.12 });
  }
}

/** The words painted into the rooms (shopText.ts): the city's, set when the atlas is made. */
let TXT: ShopText = TOTO_TEXT;


// ---- the rooms ----

interface RoomDef {
  /** Depth (m) and ceiling height. */
  readonly depth: number;
  readonly ceiling: number;
  readonly layers: readonly ShopLayer[];
  readonly paint: (p: Painter, r: Rng, tr: number) => void;
}

/** Paints the four room surfaces, each as a callback in its own metres. */
function room(p: Painter, tr: number, ch: number, s: { back: [string, () => void]; side: [string, () => void]; floor: [string, () => void]; ceil: [string, () => void] }): void {
  for (const k of ['back', 'side', 'floor', 'ceil'] as const) {
    p.begin(tr, k, ch, s[k][0]);
    s[k][1]();
  }
}

const L = (region: LayerName, depth: number, centred = false, text = false): ShopLayer => ({ region, depth, centred, text });

export const ROOMS: Record<number, RoomDef> = {
  [T.general]: {
    depth: 6, ceiling: 3, layers: [L('d', 1.6), L('c', 3.3)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#e8e6e0', () => { shelves(p, r, 0, 4, 0.1, 2.1, 0.42, 0.2, { hue: 0.15 }); p.fill('#ffffff', { hue: 1 }).rect(0, 2.3, 4, 0.22); p.fill('#ffffff').text(TXT.sale, 2, 2.41, 0.13); }],
        side: ['#e0ded8', () => shelves(p, r, 0.8, 3, 0.1, 2.1, 0.42, 0.22)],
        floor: ['#a8a8a2', () => tiles(p, 0.3, '#b0b0aa', '#9a9a94', '#808080')],
        ceil: ['#d8d8d4', () => tubes(p, '#d8d8d4')],
      });
      p.begin(tr, 'c', 3);
      shelves(p, r, 0.3, 3.7, 0.05, 1.35, 0.42, 0.18);
      p.begin(tr, 'd', 3);
      person(p, r, 2.6, 1.38);
      counter(p, 1.9, 3.3, 0.95, '#e8e6e0', '#c8c6c0', { hue: 0.3 });
      p.fill('#202428').rect(2.5, 0.95, 0.35, 0.22);
    },
  },

  [T.bar]: {
    depth: 4.6, ceiling: 3, layers: [L('a', 0.8), L('d', 2.4), L('b', 3.3)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#2a160a', () => {
          p.fill('#3a2010').rect(0, 0, 4, 1.0);
          for (let x = 0; x < 4; x += 0.9) p.fill('#24120a').rect(x, 0.05, 0.02, 0.9);
          p.fill('#e8b060', { glow: 0.7 }).rect(0, 1.3, 4, 1.0);
          for (const y of [1.3, 1.8]) { p.fill('#c8a060').rect(0, y, 4, 0.03); bottles(p, r, 0, 4, y + 0.03, 0.42, 0.6); }
          p.fill('#1a0e06').rect(0, 2.32, 4, 0.7);
        }],
        side: ['#3a1e0c', () => { for (let x = 0; x < 3; x += 0.8) p.fill('#2a1408').rect(x, 0, 0.02, 3); }],
        floor: ['#2a1a10', () => planks(p, r, [0.18, 0.1, 0.05], 0.15)],
        ceil: ['#141010', () => p.fill('#ffd8a0', { glow: 1 }).ell(0.5, 0.75, 0.06, 0.06)],
      });
      p.begin(tr, 'b', 3);
      person(p, r, 1.4, 1.42);
      person(p, r, 3.2, 1.42);
      counter(p, 0, 4, 1.08, '#3a1e0c', '#c88a40');
      p.begin(tr, 'd', 3);
      stools(p, r, 0, 4, 0.65, '#4a1810', 0.4);
      p.begin(tr, 'a', 3);
      for (const x of [0.7, 2.7]) pendant(p, x, 2.25, 3, 0.12, '#1a1008', '#ffcc80');
    },
  },

  [T.snack]: {
    depth: 4.6, ceiling: 3, layers: [L('a', 1.2, true), L('d', 2.8), L('b', 3.3)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#4a0c1a', () => {
          for (let x = -3; x < 4; x += 0.32) { p.fill('#38081a', { hue: 0.4 }).poly([x, 0, x + 0.02, 0, x + 3.02, 3, x + 3, 3]).poly([x + 3, 0, x + 3.02, 0, x + 0.02, 3, x, 3]); }
          for (let x = 0; x < 4; x += 0.32) for (let y = 0; y < 3; y += 0.32) p.fill('#c89a60').ell(x, y, 0.012, 0.012);
          p.fill('#20060c').rect(0, 1.33, 4, 0.6);
          p.fill('#c8a060').rect(0, 1.33, 4, 0.025);
          for (let x = 0.08; x < 3.9; x += 0.16) {
            p.fill(r.pick(['#1a3a1a', '#2a1a08', '#203018']), { glow: 0.15 }).rrect(x - 0.045, 1.36, 0.09, 0.32 + r.float() * 0.1, 0.02);
            p.fill('#f4f0e8').rect(x - 0.04, 1.47, 0.08, 0.06);
            p.fill('#202020').text(r.pick(TXT.keepNames), x, 1.5, 0.025, { maxW: 0.075 });
          }
        }],
        side: ['#40101c', () => {
          p.fill('#0a0a14').rect(0.8, 1.35, 1.2, 0.72);
          p.fill('#6080ff', { glow: 0.9, anim: 1 }).rect(0.84, 1.39, 1.12, 0.64);
          p.fill('#ffffff', { glow: 1 }).text(TXT.song, 1.4, 1.5, 0.07, { maxW: 1.0 });
        }],
        floor: ['#3a0a14', () => { for (let i = 0; i < 6; i++) p.fill('#4a1420', { hue: 0.3 }).ell(r.float(), r.float() * 1.5, 0.08, 0.08); }],
        ceil: ['#0a0808', () => { for (let i = 0; i < 14; i++) p.fill('#fff0e0', { glow: 1, anim: 0.5 }).ell(r.float(), r.float() * 1.5, 0.012, 0.012); }],
      });
      p.begin(tr, 'b', 3);
      person(p, r, 2.0, 1.38);
      counter(p, 0, 4, 1.02, '#5a1020', '#e0b060', { hue: 0.4 });
      for (let x = 0.25; x < 4; x += 0.5) p.fill('#3a0814', { hue: 0.4 }).rect(x, 0.05, 0.015, 0.92);
      p.begin(tr, 'd', 3);
      stools(p, r, 0, 4, 0.62, '#8a1830', 0.35, { hue: 0.5 });
      p.begin(tr, 'a', 3);
      p.fill('#222').rect(1.995, 2.6, 0.01, 0.4);
      p.fill('#c0c0c8', { glow: 0.6, anim: 0.5 }).ell(2, 2.5, 0.12, 0.12);
    },
  },

  [T.izakaya]: {
    depth: 6, ceiling: 3, layers: [L('a', 0.7), L('d', 4.2), L('b', 4.7)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#3a2210', () => {
          p.fill('#2a180a').rect(0, 0, 4, 1.0);
          p.fill('#4a2c14').rect(0, 1.0, 4, 0.05);
          for (let x = 0.15; x < 3.9; x += 0.24) {
            p.fill(r.pick(['#1a3018', '#3a2410', '#1e2a14', '#5a3a14'])).rrect(x - 0.08, 1.06, 0.16, 0.34, 0.04).rect(x - 0.025, 1.38, 0.05, 0.1);
            p.fill('#f2ecdc').rect(x - 0.06, 1.15, 0.12, 0.14);
            p.fill('#101010').text(r.pick(TXT.bottleLabels), x, 1.22, 0.07);
          }
          menuStrips(p, r, 0.02, 4, 1.6, 2.42, TXT.izakayaDishes);
          p.fill('#20120a').rect(0, 2.45, 4, 0.6);
        }],
        side: ['#5a3818', () => {
          for (let x = 0; x < 3; x += 0.25) p.fill('#4a2c12').rect(x, 0, 0.012, 3);
          poster(p, r, 0.6, 1.35, 0.5, 0.7, TXT.izakayaPoster1);
          poster(p, r, 2.0, 1.35, 0.5, 0.7, TXT.izakayaPoster2);
        }],
        floor: ['#2e2c2a', () => { for (let i = 0; i < 20; i++) p.fill(r.chance(0.5) ? '#363432' : '#282624').ell(r.float(), r.float() * 1.5, 0.1, 0.07); }],
        ceil: ['#3a2410', () => p.fill('#20140a').rect(0, 0.6, 1, 0.14)],
      });
      p.begin(tr, 'b', 3);
      person(p, r, 1.1, 1.42);
      person(p, r, 3.0, 1.42);
      counter(p, 0, 4, 1.05, '#4a2a12', '#a87040');
      for (let x = 0.3; x < 4; x += 0.6) p.fill('#e8e0d0').ell(x, 1.1, 0.07, 0.03);
      p.begin(tr, 'd', 3);
      stools(p, r, 0, 4, 0.7, '#6a1810', 0.55);
      p.begin(tr, 'a', 3);
      for (const x of [0.9, 3.0]) {
        p.fill('#111').rect(x - 0.006, 2.55, 0.012, 0.45);
        p.fill('#ff5a20', { glow: 1 }).ell(x, 2.32, 0.15, 0.23);
        for (let y = 2.12; y < 2.54; y += 0.06) p.fill('#c03010', { glow: 0.8 }).rect(x - 0.14, y, 0.28, 0.008);
        p.fill('#111').rect(x - 0.1, 2.53, 0.2, 0.04).rect(x - 0.1, 2.08, 0.2, 0.04);
        p.fill('#1a0a04').text(r.pick(TXT.lantern), x, 2.43, 0.11, { vertical: true });
      }
    },
  },

  [T.noodles]: {
    depth: 4.6, ceiling: 3, layers: [L('c', 0.45, true), L('d', 2.65), L('b', 3.1)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#d8d4cc', () => {
          p.fill('#8a8c90').rect(0, 0, 4, 0.95);
          p.fill('#b4b8bc').rect(0, 0.95, 4, 1.0);
          for (let x = 0.4; x < 4; x += 0.7) if (r.chance(0.7)) { p.fill('#d0d2d6').rrect(x - 0.2, 0.98, 0.4, 0.38, 0.04); p.fill('#f8f8f8', { glow: 0.2 }).ell(x, 1.5, 0.15, 0.08); }
          for (let x = 0.05, i = 0; x < 3.9; x += 0.5, i++) for (const y of [1.98, 2.27]) {
            p.fill('#ffffff', { hue: 0.6, glow: 0.15 }).rect(x, y, 0.44, 0.26);
            p.fill('#f8f4ec', { glow: 0.2 }).ell(x + 0.22, y + 0.15, 0.15, 0.08);
            p.fill(r.pick(['#c88a3a', '#a85a20', '#d8b060', '#8a4a1a']), { glow: 0.2 }).ell(x + 0.22, y + 0.16, 0.11, 0.05);
            p.fill('#202020').text(`${r.pick(TXT.noodleDishes)} ${r.int(6, 12)}50`, x + 0.22, y + 0.04, 0.045, { maxW: 0.4 });
          }
        }],
        side: ['#e8e2d0', () => { p.fill('#c0b8a0').rect(0, 0, 3, 1.0); poster(p, r, 1.2, 1.3, 0.55, 0.75, TXT.noodlePoster); }],
        floor: ['#6a2a1a', () => tiles(p, 0.25, '#6a2a1a', '#5a2416', '#3a1a10')],
        ceil: ['#e8e8e4', () => tubes(p, '#e8e8e4')],
      });
      p.begin(tr, 'b', 3);
      person(p, r, 1.2, 1.42);
      person(p, r, 3.0, 1.42);
      counter(p, 0, 4, 1.06, '#c8c0b0', '#c02818', { hue: 0.6 });
      for (let x = 0.35; x < 4; x += 0.6) { p.fill('#f0ece4').ell(x, 1.13, 0.1, 0.05); p.fill('#8a4a1a').ell(x, 1.15, 0.07, 0.02); }
      p.begin(tr, 'd', 3);
      stools(p, r, 0, 4, 0.6, '#c81e14', 0.5);
      p.begin(tr, 'c', 3);
      p.fill('#c8c8c4').rrect(3.2, 0, 0.62, 1.75, 0.03);
      p.fill('#1a1a1a').rect(3.26, 1.5, 0.5, 0.18);
      p.fill('#40ff80', { glow: 1 }).text(TXT.ticket, 3.51, 1.59, 0.1);
      for (let y = 1.0; y < 1.45; y += 0.08) for (let x = 3.25; x < 3.75; x += 0.1) p.fill(r.chance(0.5) ? '#fff2a0' : '#a0e0ff', { glow: 0.7 }).rect(x, y, 0.08, 0.06);
    },
  },

  [T.cafe]: {
    depth: 6, ceiling: 3, layers: [L('a', 2.5), L('c', 2.7), L('b', 4.7)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#c8b8a0', () => {
          p.fill('#d0c0a8', { hue: 0.35 }).rect(0, 0, 4, 3);
          p.fill('#6a4424').rect(0, 0, 4, 0.95);
          for (let x = 0; x < 4; x += 0.12) p.fill('#5a381c').rect(x, 0.02, 0.01, 0.9);
          p.fill('#e8e2d4').rect(0, 0.95, 4, 0.05);
          p.fill('#c0c4c8').rrect(0.5, 1.0, 0.6, 0.45, 0.04);
          p.fill('#202020').rect(0.55, 1.3, 0.5, 0.08);
          p.fill('#14181a').rect(1.25, 1.5, 1.5, 0.9);
          p.fill('#a07040').rect(1.22, 1.47, 1.56, 0.03).rect(1.22, 2.4, 1.56, 0.03);
          const menu = TXT.cafeMenu;
          menu.forEach((m, i) => p.fill(i ? '#e8e4dc' : '#f0d070').text(m, 2, 2.27 - i * 0.16, i ? 0.08 : 0.11, { maxW: 1.35 }));
          for (const y of [1.65, 2.05]) {
            p.fill('#6a4424').rect(2.95, y, 0.95, 0.03);
            for (let x = 3.0; x < 3.85; x += 0.13) p.fill(r.chance(0.6) ? '#f4f2ec' : '#3a5a6a', { hue: r.chance(0.3) ? 0.6 : 0 }).rrect(x, y + 0.03, 0.09, 0.1, 0.02);
          }
        }],
        side: ['#c8b8a0', () => {
          p.fill('#d0c0a8', { hue: 0.35 }).rect(0, 0, 3, 3);
          for (const x of [0.5, 1.9]) { p.fill('#1a1a1a').rect(x, 1.4, 0.6, 0.55); p.fill(hsl(r.float(), 0.3, 0.6)).rect(x + 0.04, 1.44, 0.52, 0.47); }
        }],
        floor: ['#7a5030', () => planks(p, r, [0.48, 0.3, 0.16], 0.12, true)],
        ceil: ['#24201c', () => p.fill('#1a1612').rect(0.3, 0, 0.12, 1.5)],
      });
      p.begin(tr, 'b', 3);
      person(p, r, 2.6, 1.4);
      counter(p, 0.3, 3.7, 1.0, '#6a4424', '#e8e2d4');
      p.fill('#f6e8c8', { glow: 0.35 }).rect(0.6, 0.55, 1.2, 0.4);
      for (let x = 0.7; x < 1.75; x += 0.2) p.fill(r.pick(['#c88a50', '#f0e0d0', '#8a4a2a', '#f0b0b8'])).ell(x, 0.68, 0.06, 0.04);
      p.begin(tr, 'c', 3);
      for (const tx of [1.0, 3.0]) {
        p.fill('#1a1a1a').rect(tx - 0.62, 0, 0.03, 0.9).rect(tx - 0.65, 0.43, 0.25, 0.04);
        if (r.chance(0.6)) person(p, r, tx - 0.42, 1.15, { back: r.chance(0.5) });
        p.fill('#1a1a1a').rect(tx - 0.02, 0, 0.04, 0.72).rect(tx - 0.2, 0, 0.4, 0.03);
        p.fill('#e8e4dc').rect(tx - 0.32, 0.71, 0.64, 0.04);
        p.fill('#ffffff').rrect(tx - 0.05, 0.75, 0.08, 0.07, 0.01);
      }
      p.begin(tr, 'a', 3);
      for (const x of [1.0, 3.0]) pendant(p, x, 2.15, 3, 0.17, '#1a1a1a', '#ffd090');
    },
  },

  [T.bakery]: {
    depth: 6, ceiling: 3, layers: [L('c', 1.6), L('b', 2.1)],
    paint: (p, r, tr) => {
      const racks = (w: number): void => {
        p.fill('#e8e0d0').rect(0, 0, w, 3);
        p.fill('#8a5a2a').rect(0, 0, w, 0.6);
        for (let y = 0.6; y < 2.0; y += 0.38) {
          p.fill('#6a4420').rect(0, y, w, 0.03);
          p.fill('#3a3a3a').rect(0, y + 0.03, w, 0.02);
          for (let x = 0.1; x < w - 0.05; x += 0.17) if (r.chance(0.85)) p.fill(rgb(0.62 + r.float() * 0.25, 0.36 + r.float() * 0.25, 0.12 + r.float() * 0.15)).ell(x, y + 0.11, 0.07, 0.055);
        }
        p.fill('#ffffff', { hue: 0.7 }).rect(0, 2.25, w, 0.2);
      };
      room(p, tr, 3, {
        back: ['#e8e0d0', () => { racks(4); p.fill('#ffffff').text(TXT.bakery, 2, 2.35, 0.12); }],
        side: ['#e8e0d0', () => racks(3)],
        floor: ['#9a5a3a', () => tiles(p, 0.3, '#9a5a3a', '#8a5034', '#6a3a24')],
        ceil: ['#e8e2d8', () => downlight(p, '#e8e2d8')],
      });
      p.begin(tr, 'b', 3);
      person(p, r, 1.3, 1.4);
      person(p, r, 3.1, 1.4);
      p.begin(tr, 'c', 3);
      p.fill('#f0ece4', { hue: 0.5 }).rect(0.2, 0, 3.6, 0.35);
      p.fill('#d8e4e8', { glow: 0.3 }).rect(0.2, 0.35, 3.6, 0.75);
      p.fill('#c0c0c0').rect(0.2, 1.08, 3.6, 0.03).rect(0.2, 0.7, 3.6, 0.015);
      for (const y of [0.37, 0.72]) for (let x = 0.35; x < 3.7; x += 0.22) {
        p.fill(r.pick(['#f6e8e0', '#f4c0c8', '#6a3a20', '#f0e0a0', '#fff8f0']), { glow: 0.25 }).rrect(x - 0.08, y, 0.16, 0.12, 0.03);
        if (r.chance(0.5)) p.fill('#e02030', { glow: 0.25 }).ell(x, y + 0.13, 0.02, 0.02);
      }
    },
  },

  [T.grocer]: {
    depth: 6, ceiling: 3, layers: [L('c', 0.6), L('a', 1.1), L('d', 1.6), L('b', 2.8)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#5a4430', () => {
          for (let y = 0; y < 2.0; y += 0.45) for (let x = 0; x < 4; x += 0.55) { p.fill(r.pick(['#a8845a', '#9a7a50', '#b89468'])).rect(x + 0.02, y + 0.02, 0.51, 0.41); p.fill(packColor(r)).rect(x + 0.12, y + 0.15, 0.3, 0.12); }
          p.fill('#ffffff', { hue: 0.9 }).rect(0, 2.15, 4, 0.35);
          p.fill('#ffffff').text(TXT.grocer, 2, 2.32, 0.18);
        }],
        side: ['#5a4430', () => { for (let y = 0; y < 2.0; y += 0.45) for (let x = 0.8; x < 3; x += 0.55) p.fill(r.pick(['#a8845a', '#9a7a50'])).rect(x + 0.02, y + 0.02, 0.51, 0.41); }],
        floor: ['#4a4a46', () => { for (let i = 0; i < 12; i++) p.fill('#3a3a36').ell(r.float(), r.float() * 1.5, 0.15, 0.1); }],
        ceil: ['#1a1a1a', () => {}],
      });
      const PRODUCE = ['#c01810', '#f07a10', '#f0d030', '#4a8a20', '#5a1a5a', '#f0ece0', '#8ab030', '#e04a30'];
      const tier = (top: number): void => {
        for (let x = 0; x < 4; x += 0.55) {
          const c = r.pick(PRODUCE);
          p.fill('#6a4a2a').rect(x + 0.02, top - 0.55, 0.51, 0.22);
          for (let i = 0; i < 16; i++) p.fill(c).ell(x + 0.06 + r.float() * 0.43, top - 0.32 + r.float() * 0.26, 0.045, 0.04);
          p.fill(r.chance(0.5) ? '#f8e030' : '#f8f6f0').rect(x + 0.17, top, 0.2, 0.15);
          p.fill('#c01818').text(`${r.int(1, 4)}98`, x + 0.27, top + 0.075, 0.07);
        }
        p.fill('#5a3a1c').rect(0, 0, 4, top - 0.55);
      };
      p.begin(tr, 'd', 3);
      tier(1.35);
      p.begin(tr, 'c', 3);
      tier(1.0);
      p.begin(tr, 'b', 3);
      person(p, r, 2.4, 1.42);
      p.begin(tr, 'a', 3);
      for (const x of [0.7, 2.1, 3.4]) { p.fill('#111').rect(x - 0.005, 2.35, 0.01, 0.65); p.fill('#fff0c0', { glow: 1 }).ell(x, 2.3, 0.05, 0.065); }
    },
  },

  [T.konbini]: {
    depth: 9, ceiling: 3, layers: [L('b', 0.4), L('d', 1.6, true), L('c', 3.2), L('a', 5.6)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#f0f0ee', () => {
          p.fill('#606468').rect(0, 0, 4, 2.08);
          for (let x = 0; x < 4; x += 0.75) {
            p.fill('#d8eef8', { glow: 0.35 }).rect(x + 0.04, 0.12, 0.67, 1.92);
            for (let y = 0.15; y < 2.0; y += 0.33) {
              p.fill('#c8c8c8').rect(x + 0.04, y, 0.67, 0.02);
              for (let bx = x + 0.07; bx < x + 0.68; bx += 0.085) p.fill(packColor(r), { glow: 0.35 }).rrect(bx, y + 0.02, 0.065, 0.2 + r.float() * 0.06, 0.015);
            }
            p.fill('#909498').rect(x + 0.66, 0.12, 0.04, 1.92);
          }
          p.fill('#ffffff', { hue: 1 }).rect(0, 2.25, 4, 0.2);
          p.fill('#ffffff').text(TXT.coldDrinks, 2, 2.35, 0.12);
        }],
        side: ['#f0f0ee', () => shelves(p, r, 0, 3, 0.1, 2.0, 0.36, 0.14)],
        floor: ['#d8d8d4', () => tiles(p, 0.5, '#dcdcd8', '#d0d0cc', '#b8b8b4')],
        ceil: ['#f4f4f2', () => { p.fill('#f4f4f2').rect(0, 0, 1, 1.5); p.fill('#ffffff', { glow: 1 }).rect(0, 0.6, 1, 0.25); }],
      });
      const gondola = (h: number): void => {
        p.fill('#e8e8e6').rect(0.5, 0, 3.0, 0.1);
        shelves(p, r, 0.5, 3.5, 0.1, h, 0.34, 0.12);
        p.fill('#ffe030').rect(0.5, h - 0.02, 3.0, 0.05);
      };
      p.begin(tr, 'a', 3);
      gondola(1.45);
      p.begin(tr, 'c', 3);
      gondola(1.4);
      p.begin(tr, 'd', 3);
      person(p, r, 1.4, 1.4);
      counter(p, 0.4, 3.0, 0.98, '#f0f0ee', '#d0d0cc');
      p.fill('#ffffff', { hue: 1 }).rect(0.4, 0.7, 2.6, 0.1);
      p.fill('#c8c8c4').rect(2.1, 0.98, 0.5, 0.35);
      p.fill('#202020').rect(1.0, 0.98, 0.3, 0.2);
      p.begin(tr, 'b', 3);
      p.fill('#c8c8c8').rect(0, 0.28, 4, 0.04);
      for (let row = 0; row < 3; row++) for (let x = 0.02; x < 3.9; x += 0.24) {
        const c = hsl(r.float(), 0.55, 0.5);
        p.fill(c).rect(x, 0.32 + row * 0.27, 0.21, 0.25);
        p.fill('#ffffff').rect(x, 0.32 + row * 0.27 + 0.18, 0.21, 0.05);
      }
    },
  },

  [T.drugstore]: {
    depth: 7.5, ceiling: 3, layers: [L('d', 1.4, false, true), L('c', 2.6), L('a', 4.6)],
    paint: (p, r, tr) => {
      const pop = (x: number, y: number): void => {
        p.fill('#ffe020').rect(x, y, 0.16, 0.08);
        p.fill('#d01818').text(`${r.int(1, 9)}98`, x + 0.08, y + 0.04, 0.05);
      };
      const wall = (x0: number, x1: number): void => {
        shelves(p, r, x0, x1, 0.05, 2.1, 0.3, 0.07);
        for (let y = 0.05; y < 2.0; y += 0.3) for (let x = x0 + 0.1; x < x1 - 0.2; x += 0.5 + r.float() * 0.3) if (r.chance(0.6)) pop(x, y);
      };
      room(p, tr, 3, {
        back: ['#f4f4f2', () => { wall(0, 4); p.fill('#ffffff', { hue: 1 }).rect(0, 2.2, 4, 0.3); p.fill('#ffffff').text(TXT.drugstore, 2, 2.35, 0.14); }],
        side: ['#f4f4f2', () => wall(0, 3)],
        floor: ['#e0e0dc', () => tiles(p, 0.5, '#e4e4e0', '#d8d8d4', '#c0c0bc')],
        ceil: ['#f4f4f2', () => { p.fill('#ffffff', { glow: 1 }).rect(0, 0.6, 1, 0.25); }],
      });
      for (const [k, h] of [['a', 1.5], ['c', 1.4]] as const) {
        p.begin(tr, k, 3);
        shelves(p, r, 0.4, 3.6, 0.1, h, 0.3, 0.08);
        for (let y = 0.1; y < h - 0.2; y += 0.3) for (let x = 0.5; x < 3.4; x += 0.6) if (r.chance(0.5)) pop(x, y);
        p.fill('#ffffff', { hue: 1 }).rect(0.4, h, 3.2, 0.12);
      }
      p.begin(tr, 'd', 3);
      for (const x of [0.2, 1.5, 2.8]) {
        p.fill('#c01818').rect(x, 0.5, 1.0, 0.05);
        p.fill('#909090').rect(x + 0.1, 0, 0.03, 0.5).rect(x + 0.87, 0, 0.03, 0.5);
        for (let i = 0; i < 18; i++) p.fill(packColor(r)).rect(x + 0.05 + r.float() * 0.85, 0.55 + r.float() * 0.2, 0.08, 0.1);
        p.fill('#ffe020').rect(x + 0.3, 0.85, 0.4, 0.22);
        p.fill('#d01818').text(TXT.bargain, x + 0.5, 0.96, 0.12);
      }
    },
  },

  [T.fashion]: {
    depth: 6, ceiling: 3, layers: [L('a', 1.0, true), L('c', 3.0)],
    paint: (p, r, tr) => {
      const pale = r.chance(0.6);
      const wallC = pale ? '#e8e4dc' : '#7a7874';
      const rail = (w: number): void => {
        for (let x = 0.75; x < w; x += 1.5) {
          const g = 'rgba(255,240,220,0.35)';
          p.fill(g).ell(x, 2.2, 0.55, 0.8);
        }
        p.fill('#a0a0a0').rect(0, 1.94, w, 0.02);
        for (let x = 0.05; x < w - 0.05; x += 0.07 + r.float() * 0.03) {
          if (r.chance(0.12)) { x += 0.2; continue; }
          const c = r.pick(['#141414', '#e8e4dc', '#b0a080', '#304060', '#8a2a2a', '#ffffff', '#6a7a5a']);
          const len = 0.55 + r.float() * 0.55;
          p.fill(c, { hue: r.chance(0.25) ? 0.8 : 0 }).rect(x, 1.94 - len, 0.065, len);
        }
      };
      room(p, tr, 3, {
        back: [wallC, () => rail(4)],
        side: [wallC, () => rail(3)],
        floor: [pale ? '#a08060' : '#6a6a68', () => (pale ? planks(p, r, [0.6, 0.48, 0.36], 0.18, true) : undefined)],
        ceil: ['#141414', () => downlight(p, '#141414', '#fff4e0', 0.05)],
      });
      p.begin(tr, 'a', 3);
      for (const x of [1.1, 2.9]) {
        person(p, r, x, 1.42 + 0.1, { kind: 'mannequin' });
        p.fill('#d8d4cc', { hue: 0.4 }).rect(x - 0.3, 0, 0.6, 0.1);
      }
      p.begin(tr, 'c', 3);
      p.fill('#5a4030').rect(0.8, 0, 0.05, 0.72).rect(2.15, 0, 0.05, 0.72);
      p.fill('#c8b8a0').rect(0.7, 0.72, 1.6, 0.05);
      for (let x = 0.8; x < 2.2; x += 0.3) for (let k = 0; k < 3; k++) p.fill(r.pick(['#e8e4dc', '#304060', '#b0a080', '#141414'])).rect(x, 0.77 + k * 0.035, 0.26, 0.033);
      if (r.chance(0.7)) standing(p, r, 3.2, { back: true });
    },
  },

  [T.electronics]: {
    depth: 6, ceiling: 3, layers: [L('c', 2.5)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#e8e8e8', () => {
          for (let y = 0; y < 0.95; y += 0.47) for (let x = 0; x < 4; x += 0.45) { p.fill(packColor(r)).rect(x + 0.02, y + 0.02, 0.41, 0.43); p.fill('#ffffff', { hue: 0.8 }).rect(x + 0.02, y + 0.3, 0.41, 0.06); }
          for (let y = 0.95; y < 2.55; y += 0.55) for (let x = 0; x < 4; x += 0.95) {
            p.fill('#0a0a0a').rect(x + 0.02, y + 0.03, 0.91, 0.5);
            p.fill('#b0b0b0', { glow: 1, anim: 1 }).rect(x + 0.06, y + 0.07, 0.83, 0.42);
            p.fill('#ffffff', { glow: 1, anim: 1 }).ell(x + 0.35, y + 0.3, 0.12, 0.1);
            p.fill('#606060', { glow: 1, anim: 1 }).rect(x + 0.06, y + 0.07, 0.83, 0.1);
          }
          p.fill('#ffffff', { hue: 1 }).rect(0, 2.6, 4, 0.3);
          p.fill('#ffe020').text(TXT.discountBand, 2, 2.75, 0.16);
        }],
        side: ['#f0f0f0', () => {
          shelves(p, r, 0, 3, 0.1, 2.1, 0.35, 0.25);
          for (let y = 0.1; y < 2.0; y += 0.35) for (let x = 0.1; x < 2.8; x += 0.6) if (r.chance(0.6)) { p.fill(r.chance(0.5) ? '#ffe020' : '#e01818').rect(x, y, 0.2, 0.08); p.fill(r.chance(0.5) ? '#d01818' : '#ffffff').text(`¥${r.int(1, 99)},800`, x + 0.1, y + 0.04, 0.04, { maxW: 0.19 }); }
        }],
        floor: ['#b8b8bc', () => tiles(p, 0.5, '#bcbcc0', '#b0b0b4', '#9a9a9e')],
        ceil: ['#ececec', () => tubes(p, '#ececec')],
      });
      p.begin(tr, 'c', 3);
      person(p, r, 3.2, 1.4);
      p.fill('#f0f0f0').rect(0.3, 0, 3.4, 0.9);
      p.fill('#d0d0d0').rect(0.3, 0.86, 3.4, 0.04);
      for (let x = 0.45; x < 3.6; x += 0.3) {
        p.fill('#0a0a0a').rect(x, 0.9, 0.14, 0.09);
        p.fill('#80b0ff', { glow: 0.8 }).rect(x + 0.01, 0.91, 0.12, 0.07);
        if (r.chance(0.5)) { p.fill('#ffe020').rect(x + 0.16, 0.9, 0.12, 0.2); p.fill('#d01818').text(TXT.discountTag, x + 0.22, 1.02, 0.05); }
      }
    },
  },

  [T.arcade]: {
    depth: 9, ceiling: 3, layers: [L('d', 0.9, false, true), L('b', 4.0), L('a', 6.5)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#0a0a10', () => { p.fill('#ffffff', { hue: 1, glow: 1 }).rect(0, 2.48, 4, 0.04); poster(p, r, 0.5, 1.6, 0.6, 0.8, TXT.pachinkoPoster1); poster(p, r, 2.8, 1.6, 0.6, 0.8, TXT.pachinkoPoster2); }],
        side: ['#0a0a10', () => p.fill('#ffffff', { hue: 1, glow: 1 }).rect(0, 2.48, 3, 0.04)],
        floor: ['#140c20', () => { for (let i = 0; i < 30; i++) p.fill(hsl(r.float(), 0.9, 0.6), { glow: 0.4 }).ell(r.float(), r.float() * 1.5, 0.015, 0.015); }],
        ceil: ['#080808', () => {}],
      });
      const cabinets = (players: boolean): void => {
        for (let x = 0.05; x < 3.9; x += 0.82) {
          p.fill('#141418').rect(x, 0, 0.76, 1.85);
          p.fill(hsl(r.float(), 0.9, 0.55), { glow: 1 }).rect(x + 0.04, 1.63, 0.68, 0.18);
          p.fill('#c0c0c0', { glow: 1, anim: 1 }).rect(x + 0.08, 0.98, 0.6, 0.56);
          p.fill('#ffffff', { glow: 1, anim: 1 }).ell(x + 0.3 + r.float() * 0.2, 1.25, 0.08, 0.1);
          p.fill('#8a8a8a').rect(x + 0.04, 0.84, 0.68, 0.1);
          if (players && r.chance(0.45)) standing(p, r, x + 0.38, { back: true });
        }
      };
      p.begin(tr, 'a', 3);
      cabinets(false);
      p.begin(tr, 'b', 3);
      cabinets(true);
      p.begin(tr, 'd', 3);
      for (let x = 0.03; x < 3.9; x += 0.95) {
        const fr = r.chance(0.5) ? '#ff60c0' : '#ffffff';
        p.fill(fr, { glow: 0.7, hue: fr === '#ffffff' ? 1 : 0 }).rect(x, 0, 0.9, 1.95);
        p.fill('#e8e8f0', { glow: 0.3 }).rect(x + 0.05, 0.84, 0.8, 0.94);
        for (let i = 0; i < 30; i++) p.fill(hsl(r.float(), 0.7, 0.6), { glow: 0.3 }).ell(x + 0.1 + r.float() * 0.7, 0.88 + r.float() * 0.35, 0.06, 0.05);
        p.fill('#888').rect(x + 0.44, 1.45, 0.015, 0.3).rect(x + 0.4, 1.4, 0.1, 0.05);
        p.fill(fr === '#ffffff' ? '#5a5a66' : '#7a2050', { glow: 0.15, hue: fr === '#ffffff' ? 0.6 : 0 }).rect(x + 0.05, 0.05, 0.8, 0.72);
        p.fill('#ffffff', { glow: 0.6 }).text(r.pick(TXT.arcadeFlags), x + 0.45, 0.4, 0.14, { maxW: 0.7 });
      }
    },
  },

  [T.pachinko]: {
    depth: 9, ceiling: 3, layers: [L('b', 3.6), L('a', 6.0)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#3a2a14', () => { for (let x = 0.05; x < 4; x += 0.2) p.fill('#ffd060', { glow: 1, anim: 0.5 }).ell(x, 2.4, 0.04, 0.04); }],
        side: ['#3a2a14', () => { for (let x = 0.05; x < 3; x += 0.2) p.fill('#ffd060', { glow: 1, anim: 0.5 }).ell(x, 2.4, 0.04, 0.04); }],
        floor: ['#4a1018', () => { for (let i = 0; i < 10; i++) p.fill('#5a2028').ell(r.float(), r.float() * 1.5, 0.1, 0.1); }],
        ceil: ['#80683c', () => downlight(p, '#80683c', '#fff8e0', 0.08)],
      });
      const row = (players: boolean): void => {
        for (let x = 0.03; x < 3.95; x += 0.55) {
          p.fill('#c8a040').rect(x, 0, 0.52, 2.0);
          p.fill('#8a8a90').rect(x + 0.03, 0.2, 0.46, 0.7);
          p.fill('#101010').ell(x + 0.26, 1.38, 0.2, 0.36);
          p.fill('#fff0c0', { glow: 1, anim: 0.5 }).ell(x + 0.26, 1.38, 0.18, 0.33);
          p.fill(hsl(r.float(), 0.9, 0.55), { glow: 1, anim: 1 }).rect(x + 0.16, 1.3, 0.2, 0.16);
          p.fill(hsl(r.float(), 0.9, 0.6), { glow: 1 }).rect(x + 0.03, 1.8, 0.46, 0.15);
          if (players && r.chance(0.5)) { p.fill('#777').rect(x + 0.24, 0, 0.04, 0.55); p.fill('#8a1a1a').rrect(x + 0.1, 0.52, 0.32, 0.08, 0.03); person(p, r, x + 0.26, 1.18, { back: true }); }
        }
      };
      p.begin(tr, 'a', 3);
      row(false);
      p.begin(tr, 'b', 3);
      row(true);
    },
  },

  [T.books]: {
    depth: 6, ceiling: 3, layers: [L('c', 2.4, false, true)],
    paint: (p, r, tr) => {
      const books = (w: number): void => {
        p.fill('#6a4a2a').rect(0, 0, w, 2.15);
        for (let y = 0.1; y < 2.05; y += 0.32) {
          p.fill('#3a2814').rect(0, y + 0.02, w, 0.28);
          for (let x = 0.01; x < w - 0.02; x += 0.025 + r.float() * 0.02) {
            const h = 0.2 + r.float() * 0.07;
            p.fill(r.chance(0.5) ? hsl(r.float(), 0.4, 0.3 + r.float() * 0.3) : hsl(0.1, 0.15, 0.7 + r.float() * 0.2)).rect(x, y + 0.02, 0.022, h);
          }
          p.fill('#7a5a34').rect(0, y, w, 0.02);
        }
        for (let x = 0; x < w; x += 1) p.fill('#5a3a1c').rect(x, 0, 0.03, 2.15);
      };
      room(p, tr, 3, {
        back: ['#e8e4dc', () => { books(4); for (const [x, s] of [[0.6, TXT.bookSections[0]], [1.8, TXT.bookSections[1]], [3.2, TXT.bookSections[2]]] as const) { p.fill('#ffffff', { hue: 1 }).rect(x - 0.35, 2.25, 0.7, 0.18); p.fill('#ffffff').text(s, x, 2.34, 0.12); } }],
        side: ['#e8e4dc', () => books(3)],
        floor: ['#3a4a3a', () => { for (let i = 0; i < 20; i++) p.fill('#344434').ell(r.float(), r.float() * 1.5, 0.08, 0.08); }],
        ceil: ['#e8e8e4', () => tubes(p, '#e8e8e4')],
      });
      p.begin(tr, 'c', 3);
      if (r.chance(0.8)) standing(p, r, 3.3, { back: true });
      for (const x0 of [0.4, 2.1]) {
        p.fill('#6a4a2a').rect(x0, 0, 1.4, 0.78);
        for (let x = x0 + 0.03; x < x0 + 1.35; x += 0.23) { const n = r.int(1, 5); for (let k = 0; k < n; k++) p.fill(hsl(r.float(), 0.5, 0.5)).rect(x, 0.78 + k * 0.035, 0.2, 0.033); }
        p.fill('#ffe020').rect(x0 + 0.5, 0.95, 0.35, 0.18);
        p.fill('#d01818').text(TXT.bookCard, x0 + 0.675, 1.04, 0.06, { maxW: 0.33 });
      }
    },
  },

  [T.lobby]: {
    depth: 9, ceiling: 4, layers: [L('c', 1.0), L('b', 5.4, true, true), L('a', 7.8, true, true)],
    paint: (p, r, tr) => {
      const dark = r.chance(0.4);
      const stone = dark ? '#4a4a4e' : '#c8c0b0';
      room(p, tr, 4, {
        back: [stone, () => {
          for (let y = 0; y < 4; y += 0.9) p.fill(dark ? '#3a3a3e' : '#a8a090').rect(0, y, 4, 0.012);
          for (let x = 0; x < 4; x += 1.2) p.fill(dark ? '#3a3a3e' : '#a8a090').rect(x, 0, 0.01, 4);
          for (let i = 0; i < 30; i++) p.fill(dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)').ell(r.float() * 4, r.float() * 4, 0.3, 0.05);
        }],
        side: ['#6a5038', () => { for (let x = 0; x < 3; x += 1.2) p.fill('#5a4230').rect(x, 0, 0.015, 4); }],
        floor: [dark ? '#3a3a3c' : '#bab2a2', () => { p.fill('rgba(255,250,240,0.5)').ell(0.5, 0.75, 0.25, 0.3); }],
        ceil: ['#e8e6e0', () => downlight(p, '#e8e6e0', '#fff8ec', 0.09)],
      });
      p.begin(tr, 'b', 4);
      person(p, r, 1.5, 1.4);
      person(p, r, 2.5, 1.4);
      counter(p, 0.6, 3.4, 1.08, dark ? '#e8e4dc' : '#f4f2ee', stone);
      p.fill('#ffffff', { hue: 1, glow: 0.7 }).rect(0.6, 0.94, 2.8, 0.03);
      p.fill('#202020').text(TXT.reception, 2, 0.6, 0.1);
      p.begin(tr, 'c', 4);
      plant(p, r, 0.5);
      p.begin(tr, 'a', 4);
      p.fill('#ffffff', { hue: 1, glow: 0.8 }).ell(0.9, 2.55, 0.16, 0.16);
      p.fill('#ffffff', { hue: 1, glow: 0.8 }).text('TŌTO  HOLDINGS', 2.2, 2.55, 0.2, { maxW: 2.2 });
    },
  },

  [T.hotel]: {
    depth: 9, ceiling: 4, layers: [L('c', 1.2), L('a', 3.0, true), L('b', 5.4, true, true)],
    paint: (p, r, tr) => {
      room(p, tr, 4, {
        back: ['#5a3a20', () => {
          for (let x = 0; x < 4; x += 0.6) p.fill('#4a2e18').rect(x, 0, 0.015, 4);
          for (let x = 0.3; x < 4; x += 2) { p.fill('#c8a060').rect(x, 1.9, 1.4, 0.04); p.fill('#c8a060').rect(x, 1.5, 1.4, 0.04); }
        }],
        side: ['#6a4428', () => { for (let x = 0.75; x < 3; x += 1.5) { p.fill('#ffd8a0', { glow: 0.8 }).rect(x - 0.08, 1.9, 0.16, 0.25); p.fill('#c89048').rect(x - 0.02, 1.7, 0.04, 0.2); } }],
        floor: ['#5a1a1a', () => { for (let y = 0; y < 1.5; y += 0.25) for (let x = 0; x < 1; x += 0.25) p.fill('#6a2a20').ell(x + 0.125, y + 0.125, 0.06, 0.06); }],
        ceil: ['#e8dcc8', () => downlight(p, '#e8dcc8', '#ffe8c0')],
      });
      p.begin(tr, 'b', 4);
      person(p, r, 1.4, 1.4);
      person(p, r, 2.6, 1.4);
      counter(p, 0.5, 3.5, 1.1, '#3a2010', '#c8a060');
      p.fill('#c8a060', { glow: 0.3 }).rect(1.0, 2.45, 2.0, 0.42);
      p.fill('#2a1a0c').text(TXT.frontDesk, 2, 2.66, 0.18, { maxW: 1.9 });
      for (let y = 1.55; y < 2.25; y += 0.14) for (let x = 3.1; x < 3.9; x += 0.12) p.fill('#c8a040').rect(x, y, 0.03, 0.08);
      p.begin(tr, 'a', 4);
      p.fill('#c8a040').rect(1.99, 2.6, 0.02, 0.4);
      for (let i = 0; i < 40; i++) { const a = r.float() * Math.PI * 2; const d = Math.sqrt(r.float()); p.fill('#fff0c8', { glow: 1, anim: 0.5 }).ell(2 + Math.cos(a) * d * 0.5, 2.35 + Math.sin(a) * d * 0.28, 0.03, 0.04); }
      p.begin(tr, 'c', 4);
      p.fill('#7a2a20').rrect(0.3, 0.3, 1.6, 0.5, 0.08).rect(0.3, 0, 0.1, 0.35).rect(1.8, 0, 0.1, 0.35);
      p.fill('#6a2018').rrect(0.25, 0.3, 1.7, 0.18, 0.06);
      if (r.chance(0.6)) person(p, r, 1.0, 1.1, { back: true });
      plant(p, r, 3.6, 1.5);
    },
  },

  [T.bank]: {
    depth: 6, ceiling: 3, layers: [L('c', 2.7), L('b', 5.0)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#e8e8e4', () => {
          p.fill('#101010').rect(0.4, 2.1, 1.0, 0.3);
          p.fill('#ff3010', { glow: 1 }).text(`${r.int(100, 999)}`, 0.9, 2.25, 0.2);
          p.fill('#ffffff', { hue: 1 }).ell(2.7, 2.25, 0.13, 0.13);
          p.fill('#ffffff', { hue: 1 }).text('BANK', 3.3, 2.25, 0.18);
        }],
        side: ['#e4e4e0', () => {
          for (let x = 0.2; x < 2.6; x += 0.9) {
            p.fill('#8a8c90').rect(x, 0, 0.75, 1.6);
            p.fill('#1a2a4a', { glow: 0.2 }).rect(x + 0.12, 1.05, 0.5, 0.32);
            p.fill('#4a90ff', { glow: 1 }).rect(x + 0.15, 1.08, 0.44, 0.26);
            p.fill('#2a2a2a').rect(x + 0.1, 0.85, 0.55, 0.1);
          }
          p.fill('#ffffff', { hue: 1 }).rect(0.2, 1.75, 2.6, 0.18);
          p.fill('#ffffff').text('ATM', 1.5, 1.84, 0.12);
        }],
        floor: ['#5a6070', () => { for (let i = 0; i < 20; i++) p.fill('#545a6a').ell(r.float(), r.float() * 1.5, 0.08, 0.08); }],
        ceil: ['#ececea', () => { p.fill('#ffffff', { glow: 1 }).rect(0.2, 0.4, 0.6, 0.6); }],
      });
      p.begin(tr, 'b', 3);
      for (let x = 0.8; x < 4; x += 1.6) if (r.chance(0.8)) person(p, r, x, 1.25);
      counter(p, 0, 4, 1.05, '#f0f0ec', '#c8c8c4', { hue: 0.2 });
      p.fill('#ffffff', { hue: 1 }).rect(0, 0.8, 4, 0.08);
      for (let x = 0; x <= 4; x += 1.6) p.fill('#909090').rect(x - 0.015, 1.05, 0.03, 0.58);
      p.fill('rgba(200,225,235,0.35)').rect(0, 1.05, 4, 0.55);
      p.fill('#909090').rect(0, 1.6, 4, 0.025);
      p.begin(tr, 'c', 3);
      bench(p, r, 0.3, 1.9, '#6a7080', 0.4, { hue: 0.5 });
      bench(p, r, 2.1, 3.7, '#6a7080', 0.4, { hue: 0.5 });
    },
  },

  [T.clinic]: {
    depth: 6, ceiling: 3, layers: [L('d', 0.8), L('c', 2.4), L('b', 4.8)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#e8eeea', () => {
          for (let x = 0.3; x < 3.8; x += 0.5) if (r.chance(0.6)) { p.fill('#ffffff').rect(x, 1.4, 0.21, 0.3); p.fill(hsl(r.float(), 0.4, 0.6)).rect(x + 0.02, 1.6, 0.17, 0.06); for (let y = 1.45; y < 1.58; y += 0.03) p.fill('#909090').rect(x + 0.03, y, 0.15, 0.008); }
          p.fill('#ffffff').ell(3.4, 2.4, 0.15, 0.15);
          p.fill('#303030').rect(3.39, 2.4, 0.015, 0.11).rect(3.4, 2.39, 0.08, 0.015);
        }],
        side: ['#e4ece8', () => { p.fill('#d0dcd6').rect(0, 0, 3, 0.9); p.fill('#c8d0cc').rect(1.2, 0, 0.85, 2.0); }],
        floor: ['#b8c4bc', () => tiles(p, 0.5, '#bcc8c0', '#b0bcb4', '#a0aca4')],
        ceil: ['#f0f2f0', () => p.fill('#ffffff', { glow: 1 }).rect(0.2, 0.4, 0.6, 0.6)],
      });
      p.begin(tr, 'b', 3);
      person(p, r, 1.6, 1.38);
      counter(p, 0.4, 2.8, 1.05, '#f2f2f0', '#b89a70');
      p.fill('#ffffff', { hue: 1 }).rect(0.9, 2.2, 1.0, 0.25);
      p.fill('#ffffff').text(TXT.desk, 1.4, 2.32, 0.15);
      p.begin(tr, 'c', 3);
      bench(p, r, 0.3, 3.7, '#7aa090', 0.4);
      p.begin(tr, 'd', 3);
      plant(p, r, 0.35, 1.3);
    },
  },

  [T.salon]: {
    depth: 4.6, ceiling: 3, layers: [L('a', 3.3), L('b', 3.85)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#ece8e2', () => {
          p.fill('#e8e2da', { hue: 0.15 }).rect(0, 0, 4, 3);
          for (let x = 0.65; x < 4; x += 1.3) {
            for (let y = 1.0; y < 2.0; y += 0.13) { p.fill('#fff4e0', { glow: 1 }).ell(x - 0.41, y, 0.025, 0.025).ell(x + 0.41, y, 0.025, 0.025); }
            p.fill('#202020').rect(x - 0.36, 0.95, 0.72, 1.06);
            p.fill('#8a9098', { glow: 0.15 }).rect(x - 0.33, 0.98, 0.66, 1.0);
            p.fill('#a8b0b8', { glow: 0.15 }).poly([x - 0.33, 1.6, x + 0.1, 1.98, x + 0.33, 1.98, x - 0.33, 1.3]);
            p.fill('#f4f4f4').rect(x - 0.36, 0.8, 0.72, 0.05);
            for (let k = 0; k < 4; k++) p.fill(packColor(r)).rrect(x - 0.3 + k * 0.15, 0.85, 0.06, 0.12, 0.01);
          }
        }],
        side: ['#ece8e2', () => shelves(p, r, 0.4, 2.8, 1.3, 1.95, 0.32, 0.07)],
        floor: ['#a08468', () => planks(p, r, [0.6, 0.48, 0.36], 0.15, true)],
        ceil: ['#f0ece6', () => downlight(p, '#f0ece6')],
      });
      p.begin(tr, 'b', 3);
      for (let x = 0.65; x < 4; x += 1.3) {
        p.fill('#a0a0a0').rect(x - 0.04, 0, 0.08, 0.45).rect(x - 0.22, 0, 0.44, 0.03);
        p.fill('#141414').rrect(x - 0.26, 0.42, 0.52, 0.2, 0.04).rrect(x - 0.24, 0.6, 0.48, 0.62, 0.06);
        if (r.chance(0.65)) { p.fill('#2a2a2c').poly([x - 0.3, 0.6, x + 0.3, 0.6, x + 0.18, 1.26, x - 0.18, 1.26]); person(p, r, x, 1.22, { back: true }); }
      }
      p.begin(tr, 'a', 3);
      for (let x = 1.3; x < 4; x += 2.6) if (r.chance(0.7)) standing(p, r, x + 0.15, { back: true });
    },
  },

  [T.laundry]: {
    depth: 6, ceiling: 3, layers: [L('c', 1.3)],
    paint: (p, r, tr) => {
      const machines = (x0: number, w: number): void => {
        for (let x = x0; x < w - 0.6; x += 0.72) for (const upper of [false, true]) {
          const y0 = upper ? 1.0 : 0.05;
          p.fill(upper ? '#b8bcc0' : '#f0f0ee').rect(x + 0.02, y0, 0.68, 0.92);
          p.fill('#2a2a2a').rect(x + 0.02, y0 + 0.82, 0.68, 0.04);
          p.fill('#d0d4d8').ell(x + 0.36, y0 + 0.42, 0.25, 0.25);
          p.fill('#1a1c20').ell(x + 0.36, y0 + 0.42, 0.2, 0.2);
          if (r.chance(0.45)) for (let i = 0; i < 6; i++) p.fill(hsl(r.float(), 0.5, 0.5), { glow: 0.15 }).ell(x + 0.36 + (r.float() - 0.5) * 0.25, y0 + 0.32 + r.float() * 0.08, 0.06, 0.04);
          p.fill('#ff4020', { glow: 1 }).rect(x + 0.55, y0 + 0.86, 0.06, 0.03);
        }
      };
      room(p, tr, 3, {
        back: ['#e4e6e4', () => { machines(0, 4); p.fill('#ffffff', { hue: 1 }).rect(0, 2.2, 4, 0.25); p.fill('#ffffff').text('COIN LAUNDRY  24H', 2, 2.32, 0.15); }],
        side: ['#e4e6e4', () => { machines(1.0, 3.6); p.fill('#2050a0').rect(0.1, 0, 0.7, 1.8); p.fill('#c0e0ff', { glow: 0.8 }).rect(0.18, 1.0, 0.54, 0.6); }],
        floor: ['#cfd2d0', () => tiles(p, 0.3, '#d4d6d4', '#c4c8c6', '#a8acaa')],
        ceil: ['#f0f0f0', () => tubes(p, '#f0f0f0')],
      });
      p.begin(tr, 'c', 3);
      for (let x = 0.6; x < 3.6; x += 0.5) { p.fill('#e87a20', { hue: 0.6 }).rrect(x - 0.2, 0.42, 0.4, 0.06, 0.02).rrect(x - 0.18, 0.48, 0.36, 0.38, 0.05); p.fill('#888').rect(x - 0.15, 0, 0.03, 0.43).rect(x + 0.12, 0, 0.03, 0.43); }
      if (r.chance(0.7)) person(p, r, 1.6, 1.12, { back: true });
    },
  },

  [T.estate]: {
    depth: 4.6, ceiling: 3, layers: [L('c', 2.5)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#e4e4e2', () => {
          for (let y = 1.0; y < 2.15; y += 0.4) { p.fill('#9a9a9a').rect(0, y, 4, 0.03); for (let x = 0.02; x < 3.95; x += 0.075) p.fill(r.chance(0.5) ? '#ffffff' : r.pick(['#3060a0', '#a03030', '#30804a', '#e8c040']), { hue: r.chance(0.3) ? 0.8 : 0 }).rect(x, y + 0.03, 0.065, 0.3); }
          p.fill('#ffffff', { hue: 1 }).rect(1.2, 2.35, 1.6, 0.28);
          p.fill('#ffffff').text(TXT.realtor, 2, 2.49, 0.15, { maxW: 1.5 });
        }],
        side: ['#e2e2e0', () => { p.fill('#d8d4c0').rect(0.4, 1.0, 1.8, 1.2); for (let i = 0; i < 12; i++) p.fill(r.pick(['#c8c0a0', '#a8b8a0', '#b0b8c8'])).rect(0.45 + r.float() * 1.5, 1.05 + r.float() * 0.9, 0.3, 0.2); }],
        floor: ['#686c74', () => {}],
        ceil: ['#ececea', () => tubes(p, '#ececea')],
      });
      p.begin(tr, 'c', 3);
      for (let x = 0.7; x < 4; x += 1.4) {
        if (r.chance(0.7)) person(p, r, x, 1.2);
        p.fill('#0a0a0a').rect(x - 0.26, 0.8, 0.52, 0.36).rect(x - 0.03, 0.74, 0.06, 0.08);
        p.fill('#a0c0e8', { glow: 0.8 }).rect(x - 0.23, 0.83, 0.46, 0.3);
        p.fill('#8a8c90').rect(x - 0.6, 0, 1.2, 0.72);
        p.fill('#d8d8d4').rect(x - 0.62, 0.72, 1.24, 0.04);
      }
    },
  },

  [T.hobby]: {
    depth: 6, ceiling: 3, layers: [L('c', 1.0), L('a', 2.4)],
    paint: (p, r, tr) => {
      const wall = (w: number): void => {
        shelves(p, r, 0, w, 0.05, 1.6, 0.32, 0.18);
        for (let x = 0; x < w - 0.3; x += 0.62) for (let y = 1.62; y < 3; y += 0.86) {
          p.fill('#ffffff').rect(x + 0.02, y, 0.58, 0.82);
          p.fill(hsl(r.float(), 0.7, 0.6)).rect(x + 0.05, y + 0.03, 0.52, 0.76);
          const hair = hsl(r.float(), 0.8, 0.55);
          p.fill(hair).ell(x + 0.31, y + 0.5, 0.17, 0.2);
          p.fill('#f8e4d8').ell(x + 0.31, y + 0.42, 0.12, 0.14);
          p.fill(hair).ell(x + 0.31, y + 0.53, 0.14, 0.07);
          p.fill('#3a5aff').ell(x + 0.27, y + 0.41, 0.025, 0.03).ell(x + 0.35, y + 0.41, 0.025, 0.03);
          p.fill('#ffffff').text(r.pick(TXT.hobbyTags), x + 0.31, y + 0.12, 0.08, { maxW: 0.5 });
        }
      };
      room(p, tr, 3, {
        back: ['#f0eef0', () => wall(4)],
        side: ['#f0eef0', () => wall(3)],
        floor: ['#c0c0c8', () => tiles(p, 0.5, '#c4c4cc', '#b8b8c0', '#a0a0a8')],
        ceil: ['#f0f0f0', () => tubes(p, '#f0f0f0')],
      });
      p.begin(tr, 'a', 3);
      for (const x0 of [0.3, 2.2]) {
        p.fill('#d0d0d0').rect(x0, 0, 1.5, 0.3).rect(x0, 1.86, 1.5, 0.05).rect(x0, 0, 0.04, 1.9).rect(x0 + 1.46, 0, 0.04, 1.9);
        p.fill('#f4f4f8', { glow: 0.3 }).rect(x0 + 0.04, 0.3, 1.42, 1.56);
        for (let y = 0.3; y < 1.8; y += 0.38) {
          p.fill('#e0e0e8').rect(x0 + 0.04, y, 1.42, 0.02);
          for (let x = x0 + 0.12; x < x0 + 1.4; x += 0.15) if (r.chance(0.75)) {
            const c = hsl(r.float(), 0.7, 0.55);
            p.fill(c, { glow: 0.3 }).poly([x - 0.05, y + 0.02, x + 0.05, y + 0.02, x + 0.03, y + 0.2, x - 0.03, y + 0.2]);
            p.fill('#f8e4d8', { glow: 0.3 }).ell(x, y + 0.24, 0.035, 0.04);
            p.fill(hsl(r.float(), 0.8, 0.55), { glow: 0.3 }).ell(x, y + 0.27, 0.04, 0.03);
          }
        }
      }
      p.begin(tr, 'c', 3);
      if (r.chance(0.8)) standing(p, r, 2.0, { back: true });
    },
  },

  [T.maid]: {
    depth: 6, ceiling: 3, layers: [L('c', 2.3), L('b', 3.8)],
    paint: (p, r, tr) => {
      const heartWall = (w: number): void => {
        p.fill('#f8b8d0').rect(0, 0, w, 3);
        for (let x = 0.17; x < w; x += 0.35) for (let y = 1.2; y < 3; y += 0.35) {
          p.fill('#ff7aa8').ell(x - 0.035, y + 0.02, 0.045, 0.045).ell(x + 0.035, y + 0.02, 0.045, 0.045).poly([x - 0.078, y + 0.01, x + 0.078, y + 0.01, x, y - 0.08]);
        }
        p.fill('#ffffff').rect(0, 0.92, w, 0.1);
        for (let x = 0; x < w; x += 0.1) p.fill('#ffffff').ell(x + 0.05, 0.92, 0.05, 0.035);
        p.fill('#f0a0c0').rect(0, 0, w, 0.9);
      };
      room(p, tr, 3, {
        back: ['#f8b8d0', () => { heartWall(4); p.fill('#ffffff').text(TXT.maid, 2, 2.55, 0.17, { maxW: 3.6 }); }],
        side: ['#f8b8d0', () => heartWall(3)],
        floor: ['#f4f0f0', () => tiles(p, 0.25, '#f8f4f4', '#f0a8c4', '#e8e0e0')],
        ceil: ['#f8d8e4', () => downlight(p, '#f8d8e4', '#fff0f8', 0.08)],
      });
      p.begin(tr, 'b', 3);
      for (const x of [1.2, 3.0]) {
        standing(p, r, x, { kind: 'maid' });
        p.fill('#ffffff').rect(x - 0.18, 0.45, 0.36, 0.08);
        p.fill('#ffffff').rect(x - 0.1, 1.76, 0.2, 0.03);
      }
      p.begin(tr, 'c', 3);
      for (const tx of [0.9, 2.9]) {
        p.fill('#ff8ab0').rect(tx - 0.62, 0, 0.03, 0.9).rrect(tx - 0.66, 0.42, 0.26, 0.05, 0.02).rrect(tx - 0.66, 0.47, 0.06, 0.45, 0.02);
        if (r.chance(0.6)) person(p, r, tx - 0.45, 1.15, { back: true });
        p.fill('#ffffff').rect(tx - 0.02, 0, 0.04, 0.72).rect(tx - 0.34, 0.71, 0.68, 0.04);
        p.fill('#ffd0e0').ell(tx, 0.79, 0.07, 0.035);
      }
    },
  },

  [T.warehouse]: {
    depth: 14, ceiling: 4, layers: [L('d', 2.0), L('b', 5.0), L('a', 9.5)],
    paint: (p, r, tr) => {
      room(p, tr, 4, {
        back: ['#80868a', () => { for (let x = 0; x < 4; x += 0.2) p.fill('#6a7074').rect(x, 0, 0.06, 4); }],
        side: ['#80868a', () => { for (let x = 0; x < 3; x += 0.2) p.fill('#6a7074').rect(x, 0, 0.06, 4); }],
        floor: ['#7a7a76', () => p.fill('#e8c020').rect(0.45, 0, 0.08, 1.5)],
        ceil: ['#2a2a2a', () => downlight(p, '#2a2a2a', '#ffffff', 0.12)],
      });
      const racks = (): void => {
        for (let x = 0; x < 4; x += 2.7) p.fill('#e86a10').rect(x, 0, 0.07, 3);
        for (const y of [1.25, 2.5]) p.fill('#1a4aa0').rect(0, y, 4, 0.1);
        for (const y0 of [0, 1.35, 2.6]) for (let x = 0.12; x < 3.9; x += 1.35) {
          if (!r.chance(0.8)) continue;
          p.fill('#8a6a40').rect(x, y0, 1.2, 0.12);
          const h = 0.5 + r.float() * 0.4;
          p.fill(r.pick(['#a88050', '#b89060', '#9a7448'])).rect(x + 0.05, y0 + 0.12, 1.1, h);
          p.fill('rgba(255,255,255,0.25)').rect(x + 0.05, y0 + 0.12 + h * 0.6, 1.1, 0.04);
          p.fill('#ffffff').rect(x + 0.45, y0 + 0.12 + h * 0.3, 0.2, 0.12);
        }
      };
      p.begin(tr, 'a', 4);
      racks();
      p.begin(tr, 'b', 4);
      racks();
      p.begin(tr, 'd', 4);
      p.fill('#f0a020').rect(1.0, 0.15, 1.2, 0.9).rect(1.2, 1.05, 0.06, 0.95).rect(2.0, 1.05, 0.06, 0.95).rect(1.2, 1.95, 0.86, 0.06);
      p.fill('#1a1a1a').ell(1.25, 0.2, 0.2, 0.2).ell(1.95, 0.2, 0.2, 0.2).rect(2.2, 0.0, 0.08, 1.8);
      p.fill('#8a6a40').rect(2.4, 0, 1.2, 0.12).rect(2.4, 0.12, 1.1, 0.6);
      person(p, r, 1.6, 1.5);
    },
  },

  [T.craft]: {
    depth: 4.6, ceiling: 3, layers: [L('d', 0.7, false, true), L('c', 1.4), L('b', 2.2)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#4a2a12', () => {
          for (let x = 0; x < 4; x += 0.4) p.fill('#3a200c').rect(x, 0, 0.015, 3);
          for (let y = 1.0; y < 2.2; y += 0.4) {
            p.fill('#6a4020').rect(0, y, 4, 0.03);
            for (let x = 0.08; x < 3.9; x += 0.3) if (r.chance(0.8)) p.fill(r.pick(['#8a5a2a', '#e8e0cc', '#2a3a5a', '#c84a2a', '#e8d8b0', '#4a6a3a'])).rrect(x, y + 0.03, 0.18, 0.12 + r.float() * 0.18, 0.03);
          }
          p.fill('#1a2a5a', { hue: 0.5 }).rect(1.55, 1.35, 0.9, 0.9);
          p.fill('#0a0a0a').rect(1.55, 0.45, 0.9, 0.9);
          for (const x of [1.85, 2.15]) p.fill('#0a0a0a').rect(x - 0.01, 1.35, 0.02, 0.9);
          p.fill('#f4f0e4').ell(2, 1.9, 0.13, 0.13);
          p.fill('#1a2a5a', { hue: 0.5 }).ell(2, 1.9, 0.09, 0.09);
        }],
        side: ['#f0eadc', () => {
          p.fill('#f6f0e0', { glow: 0.2 }).rect(0, 0.45, 3, 2.55);
          for (let x = 0; x < 3; x += 0.3) p.fill('#4a2a12').rect(x, 0.45, 0.025, 2.55);
          for (let y = 0.45; y < 3; y += 0.4) p.fill('#4a2a12').rect(0, y, 3, 0.02);
          p.fill('#4a2a12').rect(0, 0, 3, 0.45);
        }],
        floor: ['#a89a5c', () => { p.fill('#2a1a0c').rect(0, 0, 1, 0.03).rect(0, 0, 0.03, 1.5); for (let x = 0; x < 1; x += 0.02) p.fill('rgba(0,0,0,0.06)').rect(x, 0, 0.008, 1.5); }],
        ceil: ['#3a2410', () => p.fill('#24160a').rect(0, 0.6, 1, 0.15)],
      });
      p.begin(tr, 'b', 3);
      person(p, r, 2.6, 1.28);
      p.begin(tr, 'c', 3);
      p.fill('#5a3418').rect(0, 0, 4, 0.45);
      p.fill('#8a5a30').rect(0, 0.4, 4, 0.05);
      p.begin(tr, 'd', 3);
      for (const x0 of [0.3, 2.1]) {
        p.fill('#5a3418').rect(x0, 0, 0.05, 0.66).rect(x0 + 1.55, 0, 0.05, 0.66).rect(x0 - 0.02, 0.64, 1.64, 0.06);
        for (let x = x0 + 0.08; x < x0 + 1.55; x += 0.16) {
          const k = r.float();
          if (k < 0.4) p.fill('#b0702a').ell(x + 0.06, 0.74, 0.065, 0.03);
          else if (k < 0.7) p.fill(r.pick(['#f4d8e0', '#e8f0d8', '#f0e4c0'])).rrect(x, 0.7, 0.12, 0.08, 0.03);
          else p.fill('#e8e0cc', { hue: 0.5 }).rect(x, 0.7, 0.12, 0.12);
        }
        p.fill('#f4f0e4').rect(x0 + 0.6, 0.72, 0.3, 0.16);
        p.fill('#1a1a1a').text(r.pick(TXT.grillCards), x0 + 0.75, 0.8, 0.07);
      }
    },
  },

  [T.mahjong]: {
    depth: 6, ceiling: 3, layers: [L('b', 2.0), L('a', 4.0)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#3a2414', () => { for (let x = 0; x < 4; x += 0.5) p.fill('#2e1c10').rect(x, 0, 0.015, 3); poster(p, r, 0.5, 1.5, 0.5, 0.6, TXT.mahjongPoster1); poster(p, r, 2.6, 1.5, 0.5, 0.6, TXT.mahjongPoster2); }],
        side: ['#3a2414', () => {}],
        floor: ['#3a1410', () => { for (let i = 0; i < 12; i++) p.fill('#4a1c14').ell(r.float(), r.float() * 1.5, 0.08, 0.08); }],
        ceil: ['#2a2622', () => {}],
      });
      const tables = (offset: number): void => {
        for (let tx = offset; tx < 4; tx += 1.9) {
          for (const s of [-1, 1]) person(p, r, tx + s * 0.62, 1.18);
          p.fill('#1a1a1a').rect(tx - 0.05, 0, 0.1, 0.7);
          p.fill('#0a5a2a').rect(tx - 0.45, 0.7, 0.9, 0.06);
          for (let x = tx - 0.4; x < tx + 0.38; x += 0.03) p.fill('#f4f0e0').rect(x, 0.76, 0.026, 0.04);
          p.fill('#111').rect(tx - 0.005, 1.8, 0.01, 1.2);
          p.fill('#0a4a20').poly([tx - 0.1, 1.8, tx + 0.1, 1.8, tx + 0.3, 1.6, tx - 0.3, 1.6]);
          p.fill('#c0ffc0', { glow: 1 }).ell(tx, 1.6, 0.26, 0.03);
        }
      };
      p.begin(tr, 'a', 3);
      tables(0.95);
      p.begin(tr, 'b', 3);
      tables(0.0);
    },
  },

  [T.karaoke]: {
    depth: 6, ceiling: 3, layers: [L('c', 3.3, true)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#0e0e14', () => {
          p.fill('#c0c0c0', { glow: 1, anim: 1 }).rect(0.9, 1.3, 2.2, 1.1);
          p.fill('#ffffff', { glow: 1, anim: 1 }).ell(1.6, 1.85, 0.3, 0.35);
          p.fill('#ffffff', { glow: 1 }).text('♪ NEW HITS', 2.3, 1.45, 0.12);
          poster(p, r, 0.1, 1.2, 0.6, 0.9, TXT.karaokePoster1);
          poster(p, r, 3.3, 1.2, 0.6, 0.9, TXT.karaokePoster2);
        }],
        side: ['#121218', () => {
          for (let x = 0.3; x < 3; x += 1.6) {
            p.fill('#2a2a34').rect(x, 0, 0.7, 2.0);
            p.fill(hsl(r.float(), 0.8, 0.6), { glow: 0.9 }).rect(x + 0.2, 1.3, 0.3, 0.4);
          }
        }],
        floor: ['#0a0a0a', () => p.fill('#ffffff', { hue: 1, glow: 0.6 }).rect(0, 0.7, 1, 0.03)],
        ceil: ['#0a0a0e', () => p.fill('#ffffff', { hue: 1, glow: 1 }).rect(0, 0.7, 1, 0.04)],
      });
      p.begin(tr, 'c', 3);
      person(p, r, 2.0, 1.4);
      p.fill('#ffffff', { hue: 1, glow: 0.9 }).rect(0.8, 0, 2.4, 1.02);
      p.fill('#141414').rect(0.75, 1.0, 2.5, 0.05);
      p.fill('#ffffff', { glow: 1 }).text(TXT.karaokeSign, 2, 0.55, 0.16, { maxW: 2.2 });
    },
  },

  [T.gym]: {
    depth: 9, ceiling: 3, layers: [L('b', 1.1), L('c', 4.5)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#2a2a2c', () => { p.fill('#8a9098', { glow: 0.12 }).rect(0, 0.3, 4, 2.1); p.fill('#ffffff', { hue: 1 }).rect(0, 2.5, 4, 0.22); p.fill('#ffffff').text('FITNESS 24', 2, 2.61, 0.15); }],
        side: ['#d8d8d8', () => { for (let x = 0.9; x < 2.4; x += 0.35) for (let y = 0.25; y < 1.4; y += 0.45) p.fill('#141414').ell(x, y, 0.15, 0.15); p.fill('#888').rect(0.7, 0, 0.05, 1.5).rect(2.4, 0, 0.05, 1.5); }],
        floor: ['#1a1a1a', () => { for (let i = 0; i < 20; i++) p.fill('#242424').ell(r.float(), r.float() * 1.5, 0.02, 0.02); }],
        ceil: ['#1a1a1c', () => p.fill('#ffffff', { glow: 1 }).rect(0.45, 0, 0.08, 1.5)],
      });
      p.begin(tr, 'b', 3);
      for (let x = 0.5; x < 4; x += 1.0) {
        const run = r.chance(0.6);
        if (run) person(p, r, x, 1.62, { kind: 'run' });
        p.fill('#2a2a2a').rect(x - 0.36, 0, 0.72, 0.2);
        p.fill('#606060').rect(x - 0.35, 0.2, 0.03, 1.0).rect(x + 0.32, 0.2, 0.03, 1.0);
        p.fill('#0a0a0a').rect(x - 0.3, 1.15, 0.6, 0.17);
        p.fill('#40a0ff', { glow: 0.8 }).rect(x - 0.26, 1.18, 0.52, 0.11);
      }
      p.begin(tr, 'c', 3);
      for (let x = 0.6; x < 4; x += 1.4) {
        p.fill('#3a3a3a').rect(x - 0.03, 0, 0.06, 1.1).rect(x - 0.4, 0, 0.8, 0.05);
        p.fill('#141414').rrect(x - 0.2, 0.5, 0.4, 0.08, 0.03);
        if (r.chance(0.5)) person(p, r, x, 1.2, { back: false });
      }
    },
  },

  [T.lounge]: {
    depth: 6, ceiling: 3, layers: [L('a', 2.0), L('d', 2.3), L('c', 3.0)],
    paint: (p, r, tr) => {
      const mirror = (w: number): void => {
        p.fill('#0a080c').rect(0, 0, w, 3);
        for (let x = 0; x < w; x += 0.9) p.fill('#d8a040', { glow: 0.4 }).rect(x, 0, 0.025, 3);
        for (let y = 0; y < 3; y += 0.7) p.fill('#d8a040', { glow: 0.4 }).rect(0, y, w, 0.02);
      };
      room(p, tr, 3, {
        back: ['#0a080c', () => {
          mirror(4);
          // The house's hosts, framed in gold, lit from behind: each one of the mob, posed for his photo.
          for (let x = 0.5; x < 4; x += 1.0) {
            p.fill('#d8a040', { glow: 0.5 }).rect(x - 0.27, 1.32, 0.54, 0.98);
            p.fill(r.pick(['#5a6a8a', '#7a5a7a', '#4a6a6a', '#6a5a4a']), { glow: 0.45 }).rect(x - 0.24, 1.35, 0.48, 0.92);
            person(p, r, x, 1.49 + 1.42, { scale: 0.42 });
            p.fill('#141010').rect(x - 0.24, 1.35, 0.48, 0.14);
            p.fill('#f8e8c0', { glow: 0.6 }).text(r.pick(TXT.hostNames), x, 1.42, 0.09);
          }
        }],
        side: ['#0a080c', () => mirror(3)],
        floor: ['#0c0a0c', () => { p.fill('rgba(255,210,140,0.15)').ell(0.5, 0.75, 0.2, 0.4); }],
        ceil: ['#0a0808', () => { for (let i = 0; i < 12; i++) p.fill('#fff0d0', { glow: 1, anim: 0.5 }).ell(r.float(), r.float() * 1.5, 0.012, 0.012); }],
      });
      p.begin(tr, 'c', 3);
      for (const sx of [1.0, 3.0]) {
        if (r.chance(0.7)) person(p, r, sx - 0.3, 1.15);
        if (r.chance(0.7)) person(p, r, sx + 0.35, 1.12);
        p.fill('#7a1030', { hue: 0.7 }).rrect(sx - 0.9, 0, 1.8, 0.44, 0.08);
        p.fill('#6a0c28', { hue: 0.7 }).rrect(sx - 0.95, 0.42, 1.9, 0.45, 0.12);
        for (let x = sx - 0.75; x < sx + 0.8; x += 0.3) p.fill('#c8a040').ell(x, 0.65, 0.015, 0.015);
      }
      p.begin(tr, 'd', 3);
      for (const tx of [1.0, 3.0]) {
        p.fill('#c8a040').rect(tx - 0.5, 0.4, 1.0, 0.05).rect(tx - 0.03, 0, 0.06, 0.4);
        p.fill('#0a2a14').rrect(tx + 0.1, 0.45, 0.08, 0.28, 0.02).rect(tx + 0.125, 0.72, 0.03, 0.1);
        p.fill('#f0c040', { glow: 0.8 }).rect(tx + 0.12, 0.76, 0.04, 0.05);
        for (const gx of [-0.25, -0.12, 0.3]) p.fill('#f8e8b0', { glow: 0.5 }).poly([tx + gx - 0.03, 0.62, tx + gx + 0.03, 0.62, tx + gx + 0.005, 0.5, tx + gx - 0.005, 0.5]).rect(tx + gx - 0.004, 0.45, 0.008, 0.06);
      }
      p.begin(tr, 'a', 3);
      for (const cx of [1.0, 3.0]) {
        p.fill('#c8a040').rect(cx - 0.006, 2.7, 0.012, 0.3);
        for (let i = 0; i < 30; i++) { const a = r.float() * Math.PI * 2; const d = Math.sqrt(r.float()); p.fill('#fff4d8', { glow: 1, anim: 0.5 }).ell(cx + Math.cos(a) * d * 0.4, 2.45 + Math.sin(a) * d * 0.25, 0.025, 0.035); }
      }
    },
  },

  [T.lovehotel]: {
    depth: 4.6, ceiling: 3, layers: [L('c', 1.0)],
    paint: (p, r, tr) => {
      room(p, tr, 3, {
        back: ['#1a0c14', () => {
          p.fill('#0a0408').rect(1.05, 0.95, 1.9, 1.32);
          for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
            const x = 1.1 + col * 0.45;
            const y = 1.0 + row * 0.42;
            const free = r.chance(0.55);
            p.fill(free ? hsl(r.float(), 0.4, 0.55) : '#1a1418', { glow: free ? 0.9 : 0 }).rect(x, y, 0.4, 0.3);
            if (free) p.fill('#f4e8d8', { glow: 0.9 }).rect(x + 0.05, y + 0.04, 0.3, 0.1);
            p.fill(free ? '#ffffff' : '#555', { glow: free ? 0.8 : 0 }).text(`${2 + row}0${col + 1}`, x + 0.2, y + 0.36, 0.05);
          }
          p.fill('#ffffff', { hue: 1, glow: 0.8 }).text(TXT.shortStay, 2, 2.5, 0.14, { maxW: 1.9 });
        }],
        side: ['#24101a', () => p.fill('#ffffff', { hue: 1, glow: 0.8 }).rect(0, 1.1, 3, 0.03)],
        floor: ['#200c14', () => { for (let i = 0; i < 8; i++) p.fill('#2a1018').ell(r.float(), r.float() * 1.5, 0.1, 0.1); }],
        ceil: ['#100810', () => p.fill('#ffffff', { hue: 1, glow: 1 }).ell(0.5, 0.75, 0.07, 0.07)],
      });
      p.begin(tr, 'c', 3);
      plant(p, r, 0.4, 1.5);
      p.fill('#e8d8e0', { glow: 0.2 }).rect(3.0, 0, 0.9, 1.9);
      p.fill('#c8b0c0').rect(3.0, 0, 0.03, 1.9).rect(3.87, 0, 0.03, 1.9);
    },
  },

  [T.florist]: {
    depth: 6, ceiling: 3, layers: [L('c', 0.5), L('d', 1.4)],
    paint: (p, r, tr) => {
      const BLOOMS = ['#e8203a', '#ffffff', '#ffc020', '#a050d0', '#ff8aa8', '#ff7020', '#f8e8f0', '#d02060'];
      room(p, tr, 3, {
        back: ['#d8dcd8', () => {
          p.fill('#505a54').rect(0, 0, 4, 2.0);
          for (let x = 0; x < 4; x += 0.9) {
            p.fill('#d8e8e0', { glow: 0.25 }).rect(x + 0.04, 0.05, 0.82, 1.9);
            for (let y = 0.1; y < 1.9; y += 0.5) { p.fill('#6a7a84').rect(x + 0.08, y, 0.74, 0.2); for (let i = 0; i < 14; i++) p.fill(r.pick(BLOOMS), { glow: 0.25 }).ell(x + 0.12 + r.float() * 0.66, y + 0.25 + r.float() * 0.18, 0.04, 0.04); }
          }
          p.fill('#ffffff', { hue: 1 }).rect(0, 2.15, 4, 0.22);
          p.fill('#ffffff').text(TXT.flowers, 2, 2.26, 0.14);
        }],
        side: ['#d8dcd8', () => { for (let i = 0; i < 40; i++) p.fill(hsl(0.28 + r.float() * 0.06, 0.5, 0.2 + r.float() * 0.15)).ell(r.float() * 3, 1.3 + r.float() * 0.9, 0.12, 0.08); p.fill('#8a6a4a').rect(0, 1.25, 3, 0.04); }],
        floor: ['#5a5a58', () => { for (let i = 0; i < 10; i++) p.fill('#505050').ell(r.float(), r.float() * 1.5, 0.12, 0.08); }],
        ceil: ['#ececec', () => downlight(p, '#ececec')],
      });
      const tier = (top: number): void => {
        for (let x = 0.05; x < 3.95; x += 0.4) {
          p.fill('#3a4a5a').rect(x + 0.02, 0, 0.34, top - 0.55);
          const c = r.pick(BLOOMS);
          for (let i = 0; i < 10; i++) p.fill(hsl(0.3, 0.5, 0.25)).rect(x + 0.05 + r.float() * 0.3, top - 0.6, 0.012, 0.4);
          for (let i = 0; i < 16; i++) p.fill(c).ell(x + 0.04 + r.float() * 0.32, top - 0.3 + r.float() * 0.28, 0.045, 0.04);
          for (let i = 0; i < 5; i++) p.fill('#2a5a20').ell(x + 0.04 + r.float() * 0.32, top - 0.32 + r.float() * 0.2, 0.05, 0.025);
        }
      };
      p.begin(tr, 'd', 3);
      tier(1.4);
      p.begin(tr, 'c', 3);
      tier(1.0);
    },
  },
};

// ---- the shady rooms ----

/**
 * The shady rooms (windowScenes.ts SHOP_KINDS), rooms TRADE_COUNT and on: each 5 m deep under a low dark ceiling,
 * its walls painted here by kind, its furniture and people a scene's (the first two layers 3 m high, the third 2):
 * the furniture in front of the people, the people, and what stands close behind them. None is mirrored, so the
 * people keep to their chairs.
 */
export const SHADY = { depth: 5, ceiling: 2.6, front: 1.5, people: 1.9, behind: 2.4 } as const;
const INK: readonly [number, number, number] = [5, 5, 6];

/**
 * A back wall lit low and from the front of the room, the way a dim club's is: the wall tinted and glowing in bands,
 * most at sitting to standing height, fading to the ceiling and the floor. The people and furniture of a shady room
 * are ink (INK), so without a lit wall behind them they are black on black and nothing shows through the door: this
 * is what makes them outlines. Drawn over the wall's own paint (the tint lets it through) and under what's lit on it.
 */
function wallWash(p: Painter, rgb: readonly [number, number, number], tint: number, glow: number): void {
  const N = 12;
  for (let i = 0; i < N; i++) {
    // (Nested bands, each a little brighter than the one round it.)
    const k = (i + 1) / N;
    const y0 = 1.15 - 1.15 * (1 - k * 0.72), y1 = 1.15 + 1.45 * (1 - k * 0.6);
    p.fill(`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(tint * (0.35 + 0.65 * k)).toFixed(3)})`, { glow: glow * k * k }).rect(0, y0, 4, y1 - y0);
  }
}

/** A kind's walls, floor and ceiling: [back wall, side wall, floor, ceiling] colours and what's on the back wall. */
const SHADY_WALLS: Record<ShopKind, { c: readonly [string, string, string, string]; back: (p: Painter, r: Rng) => void; ceil?: (p: Painter, r: Rng) => void; side?: readonly [number, number, number] }> = {
  g_cabaret: {
    c: ['#2e0e16', '#240b11', '#160a0c', '#0a0608'],
    back: (p, r) => {
      // A curtain of dark red velvet in folds under the stage's wash, a strip of dusty pink neon over it, the bar's
      // bottles lit at one end.
      for (let x = 0; x < 4; x += 0.16) p.fill(x % 0.32 < 0.16 ? '#3c1019' : '#2a0b13').rect(x, 0, 0.16, 2.6);
      wallWash(p, [150, 84, 78], 0.42, 0.36);
      p.fill('#e07a90', { glow: 1, anim: 0.5 }).rect(0, 2.34, 4, 0.03);
      p.fill('#e8a050', { glow: 0.6 }).rect(2.9, 1.0, 1.1, 1.1);
      for (const y of [1.05, 1.42, 1.78]) { p.fill('#3a1a10').rect(2.9, y - 0.03, 1.1, 0.03); bottles(p, r, 2.9, 4, y, 0.3, 0.5); }
    },
    ceil: (p) => { p.fill('#e88aa0', { glow: 1 }).ell(0.5, 0.75, 0.05, 0.05); },
    side: [150, 84, 78],
  },
  g_hostess: {
    c: ['#2a1a16', '#22140f', '#1a100c', '#0e0a08'],
    back: (p, r) => {
      // Padded panels in lamplight, gilt, a lit alcove of bottles.
      for (let x = 0; x < 4; x += 0.8) p.fill('#38221a').rrect(x + 0.05, 0.3, 0.7, 1.9, 0.06);
      wallWash(p, [178, 126, 66], 0.4, 0.4);
      p.fill('#d8a040', { glow: 0.4 }).rect(0, 2.3, 4, 0.02);
      p.fill('#f0c070', { glow: 0.7 }).rect(1.4, 1.2, 1.2, 0.8);
      for (const y of [1.24, 1.62]) { p.fill('#5a3a18').rect(1.4, y - 0.03, 1.2, 0.03); bottles(p, r, 1.4, 2.6, y, 0.3, 0.6); }
    },
    ceil: (p, r) => { for (let i = 0; i < 8; i++) p.fill('#fff0d0', { glow: 1, anim: 0.5 }).ell(r.float(), r.float() * 1.5, 0.012, 0.012); },
    side: [178, 126, 66],
  },
  g_host: {
    c: ['#1c1814', '#18140f', '#12100e', '#0a0908'],
    back: (p) => {
      // Smoked mirror catching the room's light, in gold strips, and a tower of champagne glasses lit from under.
      wallWash(p, [160, 130, 80], 0.4, 0.4);
      for (let x = 0; x < 4; x += 0.9) p.fill('#d8a040', { glow: 0.4 }).rect(x, 0, 0.025, 2.6);
      for (let y = 0.5; y < 2.6; y += 0.7) p.fill('#d8a040', { glow: 0.4 }).rect(0, y, 4, 0.02);
      for (let k = 0; k < 5; k++) for (let i = 0; i <= k; i++) p.fill('#f8e8b0', { glow: 0.9, anim: 0.5 }).poly([3.2 + (i - k / 2) * 0.12 - 0.04, 2.0 - k * 0.16, 3.2 + (i - k / 2) * 0.12 + 0.04, 2.0 - k * 0.16, 3.2 + (i - k / 2) * 0.12 + 0.012, 1.88 - k * 0.16, 3.2 + (i - k / 2) * 0.12 - 0.012, 1.88 - k * 0.16]);
    },
    ceil: (p, r) => { for (let i = 0; i < 12; i++) p.fill('#fff0d0', { glow: 1, anim: 0.5 }).ell(r.float(), r.float() * 1.5, 0.012, 0.012); },
    side: [160, 130, 80],
  },
  g_cards: {
    c: ['#2a2620', '#262218', '#1a1612', '#141210'],
    back: (p) => {
      // Stained plaster under a strip light's pool, a calendar.
      p.fill('#322c24').rect(0, 0, 4, 0.9);
      wallWash(p, [150, 140, 104], 0.4, 0.4);
      p.fill('#d8d0b8').rect(2.2, 1.5, 0.4, 0.55);
      p.fill('#a02018').rect(2.2, 1.9, 0.4, 0.15);
      p.fill('#e8f0e0', { glow: 0.8 }).rect(0.8, 2.3, 1.2, 0.05);
    },
    side: [150, 140, 104],
  },
  g_loan: {
    c: ['#c8c4b4', '#b8b4a4', '#6a6a64', '#c8c8c0'],
    back: (p) => {
      // An office's wall: the licence in its frame, the rates on a board, the month's calendar.
      p.fill('#f0ece0').rect(0.5, 1.5, 0.5, 0.36);
      p.fill('#b89040').rect(0.48, 1.48, 0.54, 0.03).rect(0.48, 1.85, 0.54, 0.03);
      p.fill('#f4f0e0').rect(1.6, 1.25, 1.0, 0.8);
      p.fill('#c02018').text(TXT.loanTitle, 2.1, 1.85, 0.15);
      p.fill('#202020').text(TXT.loanSmall, 2.1, 1.6, 0.075).text(TXT.loanDay, 2.1, 1.42, 0.1);
      p.fill('#e8e4d4').rect(3.2, 1.4, 0.45, 0.6);
      p.fill('#3a5a9a').rect(3.2, 1.85, 0.45, 0.15);
    },
    ceil: (p) => tubes(p, '#c8c8c0'),
  },
  g_lobby: {
    c: ['#2a1420', '#24101c', '#3a1a2a', '#140a10'],
    back: (p, r) => {
      // The panel of rooms: lit photographs of the free ones, the taken ones dark, a button under each; its light
      // spilt on the wall round it.
      wallWash(p, [150, 92, 100], 0.38, 0.4);
      p.fill('#120810').rect(0.7, 0.9, 2.6, 1.25);
      for (const y of [1.12, 1.57]) {
        for (let i = 0; i < 4; i++) {
          const x = 0.85 + i * 0.6, free = r.chance(0.6);
          p.fill(free ? r.pick(['#e87aa8', '#7ab0e8', '#e8c070', '#b07ae8']) : '#241420', free ? { glow: 0.8 } : {}).rect(x, y, 0.5, 0.36);
          p.fill(free ? '#60e080' : '#802020', { glow: 0.9 }).rect(x + 0.2, y - 0.07, 0.1, 0.04);
        }
      }
      p.fill('#ff70b0', { glow: 1 }).text(TXT.vacant, 2, 2.3, 0.13);
    },
    ceil: (p) => { p.fill('#ffb0d0', { glow: 1 }).ell(0.5, 0.75, 0.06, 0.06); },
    side: [150, 92, 100],
  },
  g_slumped: {
    c: ['#2a160a', '#3a1e0c', '#2a1a10', '#141010'],
    back: (p, r) => {
      p.fill('#3a2010').rect(0, 0, 4, 1.0);
      p.fill('#e8b060', { glow: 0.55 }).rect(0, 1.25, 4, 0.95);
      for (const y of [1.28, 1.74]) { p.fill('#c8a060').rect(0, y - 0.03, 4, 0.03); bottles(p, r, 0, 4, y, 0.38, 0.5); }
      p.fill('#1a0e06').rect(0, 2.2, 4, 0.4);
    },
    ceil: (p) => { p.fill('#ffd8a0', { glow: 1 }).ell(0.5, 0.75, 0.05, 0.05); },
    side: [176, 124, 64],
  },
  g_exchange: {
    c: ['#b8b8b0', '#a8a8a0', '#5a5a58', '#c0c0b8'],
    back: (p) => {
      // The window in its wall, a grille across it, the notice over it.
      p.fill('#f0f0e8', { glow: 0.7 }).rect(1.7, 1.1, 1.2, 0.7);
      for (let x = 1.7; x < 2.9; x += 0.12) p.fill('#505050').rect(x, 1.1, 0.015, 0.7);
      p.fill('#f8f0d0').rect(1.5, 1.95, 1.6, 0.26);
      p.fill('#c02018').text(TXT.prizeExchange, 2.3, 2.08, 0.15);
    },
    ceil: (p) => tubes(p, '#c0c0b8'),
  },
};

/** Paints a shady room: its kind's walls, the scene's wall furniture over the back one, and its three layers. */
function paintShady(p: Painter, r: Rng, n: number, kind: ShopKind, s: Scene): void {
  const W = SHADY_WALLS[kind];
  const ch = SHADY.ceiling;
  room(p, n, ch, {
    back: [W.c[0], () => {
      W.back(p, r);
      p.image(sceneLayerImage(s, 'wall', 3, [14, 10, 10]), 0, 0, 4, 3);
    }],
    // (The side walls catch a little of the same light, so a door seen from along the street isn't a black hole.)
    side: [W.c[1], () => W.side && wallWash(p, W.side, 0.34, 0.15)],
    floor: [W.c[2], () => undefined],
    ceil: [W.c[3], () => W.ceil?.(p, r)],
  });
  p.begin(n, 'b', ch).image(sceneLayerImage(s, 'front', 3, INK), 0, 0, 4, 3);
  p.begin(n, 'a', ch).image(sceneLayerImage(s, 'people', 3, INK), 0, 0, 4, 3);
  p.begin(n, 'c', ch).image(sceneLayerImage(s, 'behind', 2, INK), 0, 0, 4, 2);
}

/** The room per trade and then per shady room (D, ceiling) and its layers nearest first (depth, region index, mode: 0 repeat, 1 centred, 2 repeat mirrored at random), for the shader. */
export function roomTables(): { rooms: [number, number][]; layers: [number, number, number][] } {
  const rooms: [number, number][] = [];
  const layers: [number, number, number][] = [];
  for (let t = 0; t < TRADE_COUNT; t++) {
    const d = ROOMS[t] ?? ROOMS[T.general];
    rooms.push([d.depth, d.ceiling]);
    const ls = [...d.layers].sort((a, b) => a.depth - b.depth);
    for (let i = 0; i < 4; i++) {
      const l = ls[i];
      layers.push(l ? [-l.depth, LAYER_REGIONS.indexOf(l.region), l.centred ? 1 : l.text ? 0 : 2] : [0, 0, 0]);
    }
  }
  // The shady rooms after them: all one shape (SHADY), whatever their scenes.
  for (let k = 0; k < SHOP_KINDS.length; k++) {
    rooms.push([SHADY.depth, SHADY.ceiling]);
    layers.push([-SHADY.front, LAYER_REGIONS.indexOf('b'), 0], [-SHADY.people, LAYER_REGIONS.indexOf('a'), 0], [-SHADY.behind, LAYER_REGIONS.indexOf('c'), 0], [0, 0, 0]);
  }
  return { rooms, layers };
}

/** The atlas textures (made once, on the main thread). */
export class ShopAtlas {
  readonly color: THREE.CanvasTexture;
  /** The storefronts' masks, and under them the rooms behind the upper floors' glass (windowAtlas.ts). */
  readonly mask: THREE.DataTexture;

  constructor(renderer: THREE.WebGLRenderer, text: ShopText = TOTO_TEXT) {
    TXT = text;
    const t0 = performance.now();
    SPRITES = new MobSprites(renderer);
    const tSprites = performance.now();
    const col = document.createElement('canvas');
    col.width = ATLAS_W;
    col.height = ATLAS_H;
    const mask = document.createElement('canvas');
    mask.width = ATLAS_W / 2;
    mask.height = ATLAS_H / 2;
    const gc = col.getContext('2d')!;
    const gm = mask.getContext('2d', { willReadFrequently: true })!;
    gm.fillStyle = '#000';
    gm.fillRect(0, 0, mask.width, mask.height);
    const p = new Painter(gc, gm);
    for (let t = 0; t < TRADE_COUNT; t++) {
      const d = ROOMS[t];
      if (!d) continue;
      d.paint(p, rng(hash(t, 0x5409)), t);
      p.end();
    }
    const tTrades = performance.now();
    // The shady rooms this edition has (the demo none of the adult ones: their blocks stay empty and are never read).
    const shady = shopScenes();
    SHOP_KINDS.forEach((kind, k) => {
      const s = shady[kind];
      if (!s) return;
      paintShady(p, rng(hash(k, 0x5ad1)), TRADE_COUNT + k, kind, s);
      p.end();
    });
    this.color = new THREE.CanvasTexture(col);
    this.color.colorSpace = THREE.SRGBColorSpace;
    this.color.premultiplyAlpha = true;
    const tShady = performance.now();
    // The masks' bytes with the window scenes' rows under them: one texture (canvas pixels are premultiplied, which
    // the scenes' four independent channels can't be, so it's a plain byte array).
    const rooms = paintWindowAtlas();
    if (rooms.width !== mask.width || WINDOW_ATLAS.maskH !== mask.height) throw new Error('shop atlas: the window scenes are laid out for a mask of another size');
    const bytes = new Uint8Array(mask.width * (mask.height + rooms.height) * 4);
    bytes.set(gm.getImageData(0, 0, mask.width, mask.height).data);
    bytes.set(rooms.data, mask.width * mask.height * 4);
    this.mask = new THREE.DataTexture(bytes, mask.width, mask.height + rooms.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.mask.userData = { windowMs: rooms.ms, scenes: rooms.scenes.map((s) => s.id), rows: rooms.height };
    this.mask.needsUpdate = true;
    // (How long each part took, for debug-shots/windowheadroom.mjs: the mob's sprites, the trades' rooms, the shady rooms.)
    this.color.userData = { ms: Math.round(performance.now() - t0) - rooms.ms, sprites: Math.round(tSprites - t0), trades: Math.round(tTrades - tSprites), shady: Math.round(tShady - tTrades) };
    for (const tex of [this.color, this.mask]) {
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 4;
      tex.flipY = false;
    }
  }
}

