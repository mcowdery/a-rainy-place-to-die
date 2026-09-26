import * as THREE from 'three';
import { hash, rng } from '../../core/hash';
import { cellWidth, isWide } from '../../core/wide';
import type { Building3, Sign3 } from '../district/plan';
import { styleFor, frontFrame, tiers } from './buildings';
import type { CityUniforms } from './city';
import { EM, glyph, textAdvance } from './letters';
import type { Light } from './lightmap';
import { EMIT, KIND, lin, scale3, type MeshBuilder } from './meshBuilder';
import { ALWAYS_SEEN, type Sightline } from './sightline';
import { sphereOf, toGeometry, type RawGeometry } from './rawGeometry';

/**
 * Signs as geometry at real scale, in perspective, lit and fogged like everything else:
 * - blades (vertical, perpendicular to the facade) and fascia plates (horizontal, over the shopfront) as
 *   boxes whose faces show text from a pre-rendered atlas: neon tubes on a dark plate, or a lit lightbox;
 * - channel letters: extruded 3D letters built from glyph rasters (letters.ts) with glowing faces, for
 *   some all-Latin fascia signs and for rooftop billboards on taller buildings.
 */

type C3 = [number, number, number];

/** Rooftop billboard words (invented names only). */
const ROOF_WORDS = ['KABURO', 'HOTEL', 'SAUNA', 'CABARET', 'PARADISE', 'NEON', 'CLUB', 'LIVE', '大吉', '夢', '銀河', '酒', 'ゲーム', 'カラオケ', 'ホテル'];
const NEON = [0xff5fc8, 0x4fe3ff, 0xffe45f, 0x6bff8a, 0xff4f4f, 0xb48cff];

/** Atlas pixels per metre of sign face (text 64 px = 0.72 m tall). */
const PX_PER_M = 32 / 0.36;
const CELL_PX = 32;
const H_SLOT = 80;
const V_CHAR = 72;

interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where each sign text sits in the atlas: pure layout (no canvas), so the chunk worker can compute sign UVs
 * and the main thread renders the matching texture (SignAtlas).
 */
export class SignLayout {
  protected readonly slots = new Map<string, Slot>();
  protected readonly want = new Map<string, { text: string; vertical: boolean; w: number; h: number }>();
  readonly width: number;
  readonly height: number;

  constructor(texts: readonly { text: string; vertical: boolean }[]) {
    const W = 2048;
    const want = this.want;
    for (const t of texts) {
      const key = `${t.vertical ? 'v' : 'h'}:${t.text}`;
      if (want.has(key)) continue;
      const n = [...t.text].filter((c) => c !== ' ').length;
      want.set(key, t.vertical ? { ...t, w: 80, h: n * V_CHAR + 24 } : { ...t, w: (cellWidth(t.text) + 1) * CELL_PX, h: H_SLOT });
    }
    // Shelf packing, tallest first; the first 8x8 pixels stay black (blank sides/backs sample there).
    const items = [...want.entries()].sort((a, b) => b[1].h - a[1].h);
    let x = 16;
    let y = 0;
    let shelf = 16;
    const PAD = 8;
    for (const [key, it] of items) {
      if (x + it.w + PAD > W) {
        x = 0;
        y += shelf + PAD;
        shelf = 0;
      }
      this.slots.set(key, { x, y, w: it.w, h: it.h });
      x += it.w + PAD;
      shelf = Math.max(shelf, it.h);
    }
    this.width = W;
    this.height = 2 ** Math.ceil(Math.log2(Math.max(64, y + shelf + PAD)));
  }

  /** UV rect (u0, v0 top, u1, v1 bottom) and size in metres of a text's slot. */
  rect(text: string, vertical: boolean): { u0: number; v0: number; u1: number; v1: number; w: number; h: number } | null {
    const s = this.slots.get(`${vertical ? 'v' : 'h'}:${text}`);
    if (!s) return null;
    return { u0: s.x / this.width, v0: s.y / this.height, u1: (s.x + s.w) / this.width, v1: (s.y + s.h) / this.height, w: s.w / PX_PER_M, h: s.h / PX_PER_M };
  }

  get blankUv(): [number, number] {
    return [4 / this.width, 4 / this.height];
  }
}

/** The sign atlas texture: every text of the layout rendered sharp (red) and blurred for the neon halo (green). */
export class SignAtlas extends SignLayout {
  readonly texture: THREE.DataTexture;

  constructor(texts: readonly { text: string; vertical: boolean }[]) {
    super(texts);
    const W = this.width;
    const H = this.height;
    const want = this.want;
    const sharp = document.createElement('canvas');
    sharp.width = W;
    sharp.height = H;
    const blur = document.createElement('canvas');
    blur.width = W;
    blur.height = H;
    const gs = sharp.getContext('2d', { willReadFrequently: true })!;
    const gb = blur.getContext('2d', { willReadFrequently: true })!;
    for (const g of [gs, gb]) {
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
    }
    gb.filter = 'blur(7px)';
    for (const [key, it] of want) {
      const s = this.slots.get(key)!;
      for (const g of [gs, gb]) {
        g.fillStyle = '#fff';
        g.save();
        if (it.vertical) drawVertical(g, it.text, s);
        else drawHorizontal(g, it.text, s);
        g.restore();
      }
    }
    const a = gs.getImageData(0, 0, W, H).data;
    const b = gb.getImageData(0, 0, W, H).data;
    const data = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      data[i * 4] = a[i * 4];
      data[i * 4 + 1] = Math.min(255, b[i * 4] * 1.6);
      data[i * 4 + 3] = 255;
    }
    this.texture = new THREE.DataTexture(data, W, H);
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.anisotropy = 8;
    this.texture.needsUpdate = true;
  }
}

function drawHorizontal(g: CanvasRenderingContext2D, text: string, s: Slot): void {
  g.font = `bold 60px 'Arial Narrow', 'Arial', 'Yu Gothic', 'Meiryo', sans-serif`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const target = s.w - CELL_PX;
  const w = g.measureText(text).width;
  const k = Math.min(1.3, target / Math.max(1, w));
  g.translate(s.x + CELL_PX / 2 + (target - w * k) / 2, s.y + s.h / 2 + 2);
  g.scale(k, 1);
  g.fillText(text, 0, 0);
}

function drawVertical(g: CanvasRenderingContext2D, text: string, s: Slot): void {
  g.font = `bold 60px 'Yu Gothic', 'Meiryo', 'MS Gothic', sans-serif`;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  let y = s.y + 12 + V_CHAR / 2;
  for (const ch of text) {
    if (ch === ' ') continue;
    const cx = s.x + s.w / 2;
    if (ch === 'ー' || ch === '〜') {
      // Long vowel marks turn 90 degrees in vertical writing.
      g.save();
      g.translate(cx, y);
      g.rotate(Math.PI / 2);
      g.fillText(ch, 0, 0);
      g.restore();
    } else {
      g.fillText(ch, cx, y + 2);
    }
    y += V_CHAR;
  }
}

const signCommon = /* glsl */ `
  uniform sampler2D tSigns;
  uniform float uTime;
  uniform float uNeon;
  uniform float uFlicker;
  varying vec2 vSUv;
  varying vec3 vInk;
  varying vec3 vPlate;
  flat varying vec2 vSign;
  float sh2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

/** Material for textured signs: neon text on a dark plate (style 0), a lit lightbox (1), or print (2). */
export function signMaterial(u: CityUniforms, atlas: SignAtlas): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1 });
  const tSigns = { value: atlas.texture };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.tSigns = tSigns;
    shader.uniforms.uTime = u.uTime;
    shader.uniforms.uNeon = u.uNeon;
    shader.uniforms.uFlicker = u.uFlicker;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aUv;
        attribute vec3 aInk;
        attribute vec3 aPlate;
        attribute vec2 aSign;
        varying vec2 vSUv;
        varying vec3 vInk;
        varying vec3 vPlate;
        flat varying vec2 vSign;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSUv = aUv; vInk = aInk; vPlate = aPlate; vSign = aSign;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${signCommon}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 st = texture2D(tSigns, vSUv).rg;
        float flk = uFlicker > 0.5 && sh2(vec2(vSign.x, floor(uTime * 12.0))) > 0.992 ? 0.08 : 1.0;
        float on = uNeon * flk;
        if (vSign.y < 0.5) {
          diffuseColor.rgb = mix(vPlate, vInk * 0.6, st.r);
          totalEmissiveRadiance += vInk * (st.r * 3.0 + st.g * 0.35) * on;
        } else if (vSign.y > 1.5) {
          // Print (vinyl wraps, stickers): lit by the scene, no glow.
          diffuseColor.rgb = mix(vPlate, vInk, st.r);
        } else {
          diffuseColor.rgb = mix(vPlate, vInk, st.r);
          // Dark lettering on a lit plate stays dark; white lettering on a coloured plate outshines it.
          float inkGlow = dot(vInk, vec3(0.333)) > 0.5 ? 1.4 : 0.3;
          totalEmissiveRadiance += mix(vPlate * 0.9, vInk * inkGlow, st.r) * on;
        }`);
  };
  m.customProgramCacheKey = () => 'signs-v1';
  return m;
}

/** Growable builder for sign geometry (position, normal, aUv, aInk, aPlate, aSign). */
export class SignBuilder {
  private f = new Float32Array(16 * 256);
  private idx: number[] = [];
  private n = 0;
  ink: C3 = [1, 1, 1];
  plate: C3 = [0, 0, 0];
  sign: [number, number] = [0, 0];

  reset(): this {
    this.n = 0;
    this.idx = [];
    return this;
  }

  /** Quad c, c+a, c+a+b, c+b (normal a x b) with uv rect (u0, v0 at the top edge, u1, v1 at the bottom). */
  quad(c: C3, a: C3, b: C3, uv: readonly [number, number, number, number]): void {
    const nx = a[1] * b[2] - a[2] * b[1];
    const ny = a[2] * b[0] - a[0] * b[2];
    const nz = a[0] * b[1] - a[1] * b[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    const [u0, v0, u1, v1] = uv;
    const pts: [C3, number, number][] = [
      [c, u0, v1],
      [[c[0] + a[0], c[1] + a[1], c[2] + a[2]], u1, v1],
      [[c[0] + a[0] + b[0], c[1] + a[1] + b[1], c[2] + a[2] + b[2]], u1, v0],
      [[c[0] + b[0], c[1] + b[1], c[2] + b[2]], u0, v0],
    ];
    if ((this.n + 4) * 16 > this.f.length) {
      const g = new Float32Array(this.f.length * 2);
      g.set(this.f);
      this.f = g;
    }
    let o = this.n * 16;
    const F = this.f;
    for (const [p, u, v] of pts) {
      F[o] = p[0];
      F[o + 1] = p[1];
      F[o + 2] = p[2];
      F[o + 3] = nx / l;
      F[o + 4] = ny / l;
      F[o + 5] = nz / l;
      F[o + 6] = u;
      F[o + 7] = v;
      F[o + 8] = this.ink[0];
      F[o + 9] = this.ink[1];
      F[o + 10] = this.ink[2];
      F[o + 11] = this.plate[0];
      F[o + 12] = this.plate[1];
      F[o + 13] = this.plate[2];
      F[o + 14] = this.sign[0];
      F[o + 15] = this.sign[1];
      o += 16;
    }
    const s = this.n;
    this.idx.push(s, s + 1, s + 2, s, s + 2, s + 3);
    this.n += 4;
  }

  build(ox: number, oz: number): THREE.BufferGeometry | null {
    const r = this.raw(ox, oz);
    return r ? toGeometry(r) : null;
  }

  raw(ox: number, oz: number): RawGeometry | null {
    if (this.n === 0) return null;
    const F = 16;
    const a = this.f;
    const pos = new Float32Array(this.n * 3);
    for (let i = 0; i < this.n; i++) {
      pos[i * 3] = a[i * F] - ox;
      pos[i * 3 + 1] = a[i * F + 1];
      pos[i * 3 + 2] = a[i * F + 2] - oz;
    }
    const take = (off: number, k: number): Float32Array => {
      const out = new Float32Array(this.n * k);
      for (let i = 0; i < this.n; i++) for (let j = 0; j < k; j++) out[i * k + j] = a[i * F + off + j];
      return out;
    };
    return {
      attrs: {
        position: { array: pos, size: 3 },
        normal: { array: take(3, 3), size: 3 },
        aUv: { array: take(6, 2), size: 2 },
        aInk: { array: take(8, 3), size: 3 },
        aPlate: { array: take(11, 3), size: 3 },
        aSign: { array: take(14, 2), size: 2 },
      },
      index: new Uint32Array(this.idx),
      sphere: sphereOf(pos),
    };
  }
}

/**
 * A box in a facade frame (origin p, right r, outward n): along [u0, u1], height [y0, y1], out [o0, o1].
 * faceUv maps a face (by outward direction: 'n' front, 'r' right side, '-r' left side) to atlas UVs; other
 * faces show the blank plate.
 */
export function signBox(sb: SignBuilder, p: C3, r: C3, n: C3, u0: number, u1: number, y0: number, y1: number, o0: number, o1: number,
  blank: [number, number], faceUv: Partial<Record<'n' | 'r' | '-r', readonly [number, number, number, number]>>): void {
  const P = (u: number, y: number, o: number): C3 => [p[0] + r[0] * u + n[0] * o, y, p[2] + r[2] * u + n[2] * o];
  const B = [blank[0], blank[1], blank[0], blank[1]] as const;
  const du = u1 - u0;
  const dy = y1 - y0;
  const dO = o1 - o0;
  const R: C3 = [r[0] * du, 0, r[2] * du];
  const Nn: C3 = [n[0] * dO, 0, n[2] * dO];
  const UP: C3 = [0, dy, 0];
  // Front (+n): right = r.
  sb.quad(P(u0, y0, o1), R, UP, faceUv.n ?? B);
  // Right side (+r): its right = cross(up, r) = -n, so start at the outer edge.
  sb.quad(P(u1, y0, o1), [-Nn[0], 0, -Nn[2]], UP, faceUv.r ?? B);
  // Left side (-r): right = +n.
  sb.quad(P(u0, y0, o0), Nn, UP, faceUv['-r'] ?? B);
  // Top and bottom.
  sb.quad(P(u0, y1, o1), R, [-Nn[0], 0, -Nn[2]], B);
  sb.quad(P(u0, y0, o0), R, Nn, B);
}

export interface SignStyle {
  /** 0 neon on dark plate, 1 lightbox. */
  readonly style: number;
  readonly ink: C3;
  readonly plate: C3;
  readonly channel: boolean;
}

export function signStyle(s: Sign3): SignStyle {
  const rnd = rng(hash(Math.round(s.x * 10), Math.round(s.z * 10), Math.round(s.y * 10), 0x5160));
  const color = lin(s.color);
  const latin = [...s.text].every((c) => !isWide(c.codePointAt(0)!));
  const channel = !s.vertical && latin && rnd.chance(0.45);
  const roll = rnd.float();
  if (channel || roll < 0.35) return { style: 0, ink: color, plate: lin(0x141418), channel };
  if (roll < 0.7) return { style: 1, ink: scale3(color, 0.35), plate: lin(0xe8e6de), channel };
  return { style: 1, ink: lin(0xfaf8f0), plate: scale3(color, 0.8), channel };
}

const RETURN: C3 = [0.05, 0.05, 0.06];

const signId = (s: Sign3): number => hash(Math.round(s.x * 10), Math.round(s.z * 10), Math.round(s.y * 10)) % 100000;

/** Each sign's glow on the street below it, for the lightmap. */
export function signLights(signs: readonly Sign3[]): Light[] {
  return signs.map((s) => {
    const st = signStyle(s);
    const glow = st.style === 0 ? st.ink : st.plate;
    const out = s.vertical ? 0.4 : 1.2;
    return { x: s.x + s.nx * out, z: s.z + s.nz * out, r: s.vertical ? 4.5 : 4, color: glow, i: st.style === 0 ? 0.3 : 0.42 };
  });
}

/**
 * Adds a chunk's signs: textured blades and plates into sb, channel letters (and rooftop billboards for
 * the given buildings) into mb.
 */
export function addSigns(signs: readonly Sign3[], buildings: readonly Building3[], atlas: SignLayout, sb: SignBuilder, mb: MeshBuilder, seen: Sightline = ALWAYS_SEEN): void {
  for (const s of signs) {
    const st = signStyle(s);
    const n: C3 = [s.nx, 0, s.nz];
    const r: C3 = [s.nz, 0, -s.nx];
    if (st.channel) {
      const p: C3 = [s.x - s.nx * 0.4, 0, s.z - s.nz * 0.4];
      channelLetters(mb, s.text, p, r, n, 3.62, 0.62, 5.2, st.ink, signId(s), 0.02);
      continue;
    }
    const rect = atlas.rect(s.text, s.vertical);
    if (!rect) continue;
    sb.ink = st.ink;
    sb.plate = st.plate;
    sb.sign = [signId(s), st.style];
    const uv = [rect.u0, rect.v0, rect.u1, rect.v1] as const;
    // The anchor sits 0.4 m off the facade; build from the facade point.
    const p: C3 = [s.x - s.nx * 0.4, 0, s.z - s.nz * 0.4];
    if (s.vertical) {
      // Blade: 0.24 m thick along r, rect.w (0.9 m) out from the wall, hanging down from the anchor. Both
      // broad faces carry the text, each unmirrored for its own viewer.
      signBox(sb, p, r, n, -0.12, 0.12, s.y - rect.h, s.y, 0.12, 0.12 + rect.w, atlas.blankUv, { r: uv, '-r': uv });
      // Bracket arms to the wall.
      signBox(sb, p, r, n, -0.03, 0.03, s.y - 0.12, s.y - 0.04, 0, 0.14, atlas.blankUv, {});
      signBox(sb, p, r, n, -0.03, 0.03, s.y - rect.h + 0.04, s.y - rect.h + 0.12, 0, 0.14, atlas.blankUv, {});
    } else {
      const w = Math.min(rect.w, 5.4);
      const h = rect.h * (w / rect.w);
      signBox(sb, p, r, n, -w / 2, w / 2, 3.62 - h / 2, 3.62 + h / 2, 0.02, 0.2, atlas.blankUv, { n: uv });
    }
  }
  for (const b of buildings) rooftopBillboard(mb, b, seen);
}

/**
 * Extruded letters centred at p (a facade point) along r, facing n: letter height hgt metres centred on
 * height yc, scaled to fit maxW, standing off the wall by `off`. Faces glow (neon channel); returns dark.
 */
function channelLetters(mb: MeshBuilder, text: string, p: C3, r: C3, n: C3, yc: number, hgt: number, maxW: number, color: C3, id: number, off: number): void {
  let s = hgt / EM;
  const adv = textAdvance(text);
  if (adv * s > maxW) s = maxW / adv;
  let u = (-adv * s) / 2;
  const depth = Math.max(0.08, s * 3);
  const top = yc + (EM / 2) * s;
  mb.id = id;
  for (const ch of text) {
    const g = glyph(ch);
    for (const [x, y, w, h] of g.rects) {
      const u0 = u + x * s;
      const u1 = u0 + w * s;
      const y1 = top - y * s;
      const y0 = y1 - h * s;
      // Five faces: the glowing face plus dark returns (the back against the wall is never seen).
      const o1 = off + depth;
      const P = (u: number, y: number, o: number): C3 => [p[0] + r[0] * u + n[0] * o, y, p[2] + r[2] * u + n[2] * o];
      const R: C3 = [r[0] * (u1 - u0), 0, r[2] * (u1 - u0)];
      const Nd: C3 = [n[0] * depth, 0, n[2] * depth];
      const Nm: C3 = [-Nd[0], 0, -Nd[2]];
      const U: C3 = [0, y1 - y0, 0];
      mb.kind = KIND.emit;
      mb.color = color;
      mb.style = [EMIT.neon, 0, 0, 0];
      mb.quad(P(u0, y0, o1), R, U);
      mb.kind = KIND.plain;
      mb.color = RETURN;
      mb.style = [0, 0, 0, 0];
      mb.quad(P(u0, y1, o1), R, Nm);
      mb.quad(P(u0, y0, off), R, Nd);
      mb.quad(P(u1, y0, o1), Nm, U);
      mb.quad(P(u0, y0, off), Nd, U);
    }
    u += g.advance * s;
  }
  mb.style = [0, 0, 0, 0];
}

/**
 * Whether a building carries the channel-letter rooftop billboard (so photo billboards go elsewhere): only
 * where the letters can be seen from the street (see sightline.ts).
 */
export function hasRooftopLetters(b: Building3, seen: Sightline = ALWAYS_SEEN): boolean {
  return b.h >= 18 && b.hue === undefined && rng(hash(b.id, 0xb111)).chance(0.3) && seen(b, b.h + 3);
}

/** Rooftop billboard: big channel letters on a steel frame near the front edge of some taller buildings. */
function rooftopBillboard(mb: MeshBuilder, b: Building3, seen: Sightline): void {
  if (!hasRooftopLetters(b, seen)) return;
  const rnd = rng(hash(b.id, 0xb111));
  rnd.chance(0.3);
  const ts = tiers(b);
  const top = ts[ts.length - 1][3] + styleFor(b).parapet;
  const f = frontFrame(b);
  const inset = (b.front === 'north' || b.front === 'south' ? b.d - ts[ts.length - 1][1] : b.w - ts[ts.length - 1][0]) / 2 + 1.2;
  const word = rnd.pick(ROOF_WORDS);
  const color = lin(rnd.pick(NEON));
  const fwTop = f.fw * (ts.length > 1 ? ts[ts.length - 1][0] / b.w : 1);
  const hgt = Math.min(4, Math.max(1.8, fwTop * 0.2));
  const centre: C3 = [f.p[0] + f.r[0] * (f.fw / 2) - f.n[0] * inset, 0, f.p[2] + f.r[2] * (f.fw / 2) - f.n[2] * inset];
  const base = top + 0.9;
  const s = Math.min(hgt / EM, (fwTop * 0.9) / textAdvance(word));
  const width = textAdvance(word) * s;
  // Frame: two rails behind the letters and posts down to the roof.
  mb.kind = KIND.plain;
  mb.color = lin(0x3a3c40);
  mb.style = [0, 0, 0, 0];
  mb.frameBox(centre, f.r, f.n, -width / 2, width / 2, base - 0.25, base - 0.05, -0.35, -0.15);
  mb.frameBox(centre, f.r, f.n, -width / 2, width / 2, base + EM * s * 0.55, base + EM * s * 0.55 + 0.15, -0.35, -0.15);
  for (let u = -width / 2; u <= width / 2 + 0.01; u += Math.max(1.5, width / 4)) mb.frameBox(centre, f.r, f.n, u - 0.07, u + 0.07, top - 0.9, base + EM * s * 0.6, -0.35, -0.2);
  channelLetters(mb, word, centre, f.r, f.n, base + (EM * s) / 2, EM * s, fwTop * 0.9, color, b.id, -0.1);
}
