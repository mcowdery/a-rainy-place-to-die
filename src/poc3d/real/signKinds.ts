import type { SignLook } from '../district/plan';
import { ALL_HOTEL_PRICES } from '../district/era';
import { EM, textAdvance } from './letters';
import { EMIT, KIND, lin, type MeshBuilder } from './meshBuilder';
import type { Light } from './lightmap';
import { channelLetters, ICON_NAMES, lookStyle, signBox, type SignBuilder, type SignLayout, type SignText } from './signs';

/**
 * More kinds of sign than the blade and the fascia (real/signs.ts), as the 1992 city has them (the user, 2026-10-15:
 * "more types and variations"); candidates for the showroom (models-buildings.html, Signs) before any goes into the
 * district. Each is built on a wall frame (`p` a point on the wall at the ground, `r` along it to the right as seen from
 * the street, `n` out from it), the lettering in the sign atlas (SignBuilder, the sign material) and the frames, bulbs
 * and lanterns' caps in the city's mesh (MeshBuilder), so a chunk keeps its two draw calls whatever it carries:
 *
 * - tenantBoard: 袖看板, the tall frame standing out from a tenant building with a lit panel for each bar or shop
 *   upstairs; `flush`, flat on the facade, Denkō-chō's full-height banners;
 * - windowLetters: 窓文字, cut-out vinyl letters across an upper floor's windows (英会話, 歯科, 麻雀);
 * - standSign: 電飾スタンド看板, the lit box a bar puts out on the pavement by its door;
 * - lantern: 赤ちょうちん, a red paper lantern lit from inside, hung under the eaves of a yakitori place or an izakaya;
 * - hotelBoards: a love hotel's 空室 lamp and its price board (休憩 / 宿泊);
 * - bulbFrame and bulbArrow: rows of bulbs chasing round a sign or along an arrow to a door (pachinko, a cabaret, a
 *   love hotel), stepping on in the city shader (`aStyle.y`);
 * - ledBoard: 電光掲示板, a red LED board with its message scrolling through (the sign material's style 4);
 * - tubeSign: lettering bent in tubing (each letter's outline) with a pictogram (a cocktail glass, a coffee cup);
 * - crown: a company's name in white channel letters at the top of a tower;
 * - cube: the small lit 24H box over a door.
 *
 * Every text a kind shows has to be in the atlas: `signKindTexts` lists what a set of them needs.
 */

type C3 = [number, number, number];
export interface WallFrame {
  readonly p: C3;
  readonly r: C3;
  readonly n: C3;
}

const DARK = lin(0x1a1b1e);
const STEEL = lin(0x3a3c40);
const RED_LANTERN = 0xd02818;
const LED_RED = 0xff3a20;

const uvOf = (q: { u0: number; v0: number; u1: number; v1: number }): readonly [number, number, number, number] => [q.u0, q.v0, q.u1, q.v1];
const at = (f: WallFrame, u: number, y: number, o: number): C3 => [f.p[0] + f.r[0] * u + f.n[0] * o, y, f.p[2] + f.r[2] * u + f.n[2] * o];

function setLook(sb: SignBuilder, look: SignLook, hex: number, id: number): void {
  const st = lookStyle(look, hex, id);
  sb.ink = st.ink;
  sb.plate = st.plate;
  sb.sign = [id % 1000000, st.style];
}

export interface Panel {
  readonly text: string;
  readonly color: number;
  readonly look: SignLook;
}

/**
 * 袖看板: a board `width` wide standing out from the wall at u (or, `flush`, flat on it), its top at `top`, a lit panel
 * for each tenant down it (vertical text), in a dark frame on two brackets. Returns its foot.
 */
export function tenantBoard(sb: SignBuilder, mb: MeshBuilder, layout: SignLayout, f: WallFrame, u: number, top: number, panels: readonly Panel[], o: { width?: number; flush?: boolean; id: number }): number {
  const width = o.width ?? (o.flush ? 1.6 : 0.8);
  const gap = 0.1;
  let y = top - gap;
  const blank = layout.blankUv;
  panels.forEach((pn, i) => {
    const q = layout.rect(pn.text, true);
    if (!q) return;
    const h = q.h * (width / q.w);
    setLook(sb, pn.look, pn.color, o.id + i);
    if (o.flush) signBox(sb, f.p, f.r, f.n, u - width / 2, u + width / 2, y - h, y, 0.12, 0.22, blank, { n: uvOf(q) });
    else signBox(sb, f.p, f.r, f.n, u - 0.13, u + 0.13, y - h, y, 0.2, 0.2 + width, blank, { r: uvOf(q), '-r': uvOf(q) });
    y -= h + gap;
  });
  // The frame round it, and its brackets to the wall.
  mb.kind = KIND.plain;
  mb.color = DARK;
  mb.style = [0, 0, 0, 0];
  if (o.flush) {
    mb.frameBox(f.p, f.r, f.n, u - width / 2 - 0.08, u + width / 2 + 0.08, y, top, 0.02, 0.12);
  } else {
    mb.frameBox(f.p, f.r, f.n, u - 0.15, u + 0.15, y, top, 0.16, 0.2);
    mb.frameBox(f.p, f.r, f.n, u - 0.15, u + 0.15, top - 0.04, top + 0.06, 0.16, 0.24 + width);
    mb.frameBox(f.p, f.r, f.n, u - 0.15, u + 0.15, y - 0.06, y + 0.04, 0.16, 0.24 + width);
    mb.color = STEEL;
    for (const yb of [top - 0.3, y + 0.3]) mb.frameBox(f.p, f.r, f.n, u - 0.04, u + 0.04, yb - 0.05, yb + 0.05, 0, 0.2);
  }
  return y;
}

/** 窓文字: cut-out letters `height` tall across the windows of the floor whose sill is at y, centred on u, at most maxW wide. */
export function windowLetters(sb: SignBuilder, layout: SignLayout, f: WallFrame, u: number, y: number, text: string, hex: number, o: { height?: number; maxW: number; id: number }): void {
  const q = layout.rect(text, false);
  if (!q) return;
  let h = o.height ?? 0.75;
  let w = q.w * (h / q.h);
  if (w > o.maxW) {
    h *= o.maxW / w;
    w = o.maxW;
  }
  // (3.25: cut-out letters with the room's light behind them at night.)
  sb.ink = lin(hex);
  sb.plate = [0, 0, 0];
  sb.sign = [o.id % 1000000, 3.25];
  signBox(sb, f.p, f.r, f.n, u - w / 2, u + w / 2, y + 0.25, y + 0.25 + h, 0.025, 0.03, layout.blankUv, { n: uvOf(q) });
}

/** 電飾スタンド看板: a lit box on the pavement `out` metres from the wall at u, its broad faces along the street (vertical text). */
export function standSign(sb: SignBuilder, mb: MeshBuilder, layout: SignLayout, f: WallFrame, u: number, out: number, text: string, hex: number, look: SignLook, id: number): void {
  const q = layout.rect(text, true);
  if (!q) return;
  let w = 0.42;
  let h = q.h * (w / q.w);
  if (h > 1.1) {
    w *= 1.1 / h;
    h = 1.1;
  }
  setLook(sb, look, hex, id);
  signBox(sb, f.p, f.r, f.n, u - 0.14, u + 0.14, 0.22, 0.22 + h, out - w / 2, out + w / 2, layout.blankUv, { r: uvOf(q), '-r': uvOf(q) });
  mb.kind = KIND.plain;
  mb.color = DARK;
  mb.style = [0, 0, 0, 0];
  mb.frameBox(f.p, f.r, f.n, u - 0.18, u + 0.18, 0, 0.22, out - w / 2 - 0.05, out + w / 2 + 0.05);
  mb.frameBox(f.p, f.r, f.n, u - 0.16, u + 0.16, 0.22 + h, 0.27 + h, out - w / 2 - 0.02, out + w / 2 + 0.02);
}

/**
 * 赤ちょうちん: a paper lantern (radius R, `height` tall) hung `out` from the wall at u, its middle at y; its text (one to
 * three characters, vertical) down the front, the paper glowing red all round.
 */
export function lantern(sb: SignBuilder, mb: MeshBuilder, layout: SignLayout, f: WallFrame, u: number, out: number, y: number, text: string, o: { radius?: number; height?: number; hex?: number; id: number }): void {
  const q = layout.rect(text, true);
  if (!q) return;
  const R = o.radius ?? 0.27;
  const H = o.height ?? 0.85;
  const c = at(f, u, y, out);
  const SEG = 14;
  const RINGS = 10;
  // (The text across the middle of the front only, so the characters keep their shape.)
  const SPAN = 0.7;
  const rad = (t: number): number => R * (0.72 + 0.28 * Math.sin(Math.PI * t));
  const P = (th: number, t: number): C3 => {
    const k = rad(t);
    return [c[0] + (f.n[0] * Math.cos(th) + f.r[0] * Math.sin(th)) * k, c[1] + (t - 0.5) * H, c[2] + (f.n[2] * Math.cos(th) + f.r[2] * Math.sin(th)) * k];
  };
  // A lightbox of red paper with black letters: the paper glows, the letters stay dark.
  sb.ink = [0.03, 0.02, 0.02];
  sb.plate = lin(o.hex ?? RED_LANTERN);
  sb.sign = [o.id % 1000000, 1];
  const blank = layout.blankUv;
  const V = (t: number): number => q.v1 - (0.1 + 0.8 * t) * (q.v1 - q.v0);
  for (let i = 0; i < SEG; i++) {
    const th0 = -Math.PI + (i / SEG) * Math.PI * 2;
    const th1 = th0 + (Math.PI * 2) / SEG;
    for (let k = 0; k < RINGS; k++) {
      const t0 = k / RINGS;
      const t1 = (k + 1) / RINGS;
      const a = P(th0, t0);
      const b = P(th1, t0);
      const d = P(th0, t1);
      const front = th0 >= -SPAN - 1e-6 && th1 <= SPAN + 1e-6 && t0 >= 0.1 - 1e-6 && t1 <= 0.9 + 1e-6;
      const U = (th: number): number => q.u0 + ((th + SPAN) / (2 * SPAN)) * (q.u1 - q.u0);
      const uv: readonly [number, number, number, number] = front ? [U(th0), V((t1 - 0.1) / 0.8), U(th1), V((t0 - 0.1) / 0.8)] : [blank[0], blank[1], blank[0], blank[1]];
      sb.quad(a, [b[0] - a[0], b[1] - a[1], b[2] - a[2]], [d[0] - a[0], d[1] - a[1], d[2] - a[2]], uv);
    }
  }
  // Black rims top and bottom, and the cord up to its hook.
  mb.kind = KIND.plain;
  mb.color = [0.02, 0.02, 0.02];
  mb.style = [0, 0, 0, 0];
  mb.cylinder(c[0], c[2], c[1] + H / 2 - 0.02, c[1] + H / 2 + 0.06, R * 0.75, 10);
  mb.cylinder(c[0], c[2], c[1] - H / 2 - 0.06, c[1] - H / 2 + 0.02, R * 0.75, 10);
  mb.color = STEEL;
  mb.cylinder(c[0], c[2], c[1] + H / 2 + 0.06, c[1] + H / 2 + 0.3, 0.012, 4);
  mb.frameBox(f.p, f.r, f.n, u - 0.02, u + 0.02, c[1] + H / 2 + 0.28, c[1] + H / 2 + 0.32, 0, out + 0.02);
}

/**
 * A love hotel's boards beside its door at u: the 空室 lamp (vacancies: green neon; `full`, 満室 in red) and the price
 * board under it, a row for each of `prices` (e.g. 休憩 ¥4,500).
 */
export function hotelBoards(sb: SignBuilder, mb: MeshBuilder, layout: SignLayout, f: WallFrame, u: number, y: number, prices: readonly string[], o: { full?: boolean; id: number }): void {
  const word = o.full ? '満室' : '空室';
  const q = layout.rect(word, false);
  if (q) {
    const h = 0.42;
    const w = q.w * (h / q.h);
    setLook(sb, 'neon', o.full ? 0xff4f4f : 0x6bff8a, o.id);
    signBox(sb, f.p, f.r, f.n, u - w / 2, u + w / 2, y, y + h, 0.04, 0.16, layout.blankUv, { n: uvOf(q) });
  }
  const rowH = 0.3;
  const W = 1.2;
  let yy = y - 0.12;
  setLook(sb, 'lightbox', 0xb48cff, o.id + 1);
  for (const row of prices) {
    const r = layout.rect(row, false);
    if (!r) continue;
    const w = Math.min(W - 0.1, r.w * (rowH / r.h));
    signBox(sb, f.p, f.r, f.n, u - w / 2, u + w / 2, yy - rowH, yy, 0.04, 0.08, layout.blankUv, { n: uvOf(r) });
    yy -= rowH + 0.04;
  }
  mb.kind = KIND.plain;
  mb.color = DARK;
  mb.style = [0, 0, 0, 0];
  mb.frameBox(f.p, f.r, f.n, u - W / 2, u + W / 2, yy - 0.04, y - 0.06, 0, 0.04);
}

/** A bulb in the chase (aStyle.y: its place in it, 0 to 1; 0 is a steady bulb). */
function bulb(mb: MeshBuilder, c: C3, f: WallFrame, hex: readonly [number, number, number], phase: number): void {
  mb.kind = KIND.emit;
  mb.color = hex as C3;
  mb.style = [EMIT.neon, phase, 0, 0];
  const s = 0.05;
  mb.frameBox(c, f.r, f.n, -s, s, c[1] - s, c[1] + s, 0, 2 * s);
  mb.style = [0, 0, 0, 0];
}

const BULB: C3 = [1.9, 1.45, 0.75];

/** Bulbs round a rectangle on the wall (u0..u1, y0..y1), `step` apart, `out` from it, chasing round it in threes. */
export function bulbFrame(mb: MeshBuilder, f: WallFrame, u0: number, u1: number, y0: number, y1: number, o: { step?: number; out?: number; color?: C3 } = {}): void {
  const step = o.step ?? 0.3;
  const out = o.out ?? 0.06;
  const pts: [number, number][] = [];
  const nu = Math.max(1, Math.round((u1 - u0) / step));
  const ny = Math.max(1, Math.round((y1 - y0) / step));
  for (let i = 0; i < nu; i++) pts.push([u0 + ((u1 - u0) * i) / nu, y1]);
  for (let i = 0; i < ny; i++) pts.push([u1, y1 - ((y1 - y0) * i) / ny]);
  for (let i = 0; i < nu; i++) pts.push([u1 - ((u1 - u0) * i) / nu, y0]);
  for (let i = 0; i < ny; i++) pts.push([u0, y0 + ((y1 - y0) * i) / ny]);
  pts.forEach(([u, y], k) => bulb(mb, at(f, u, y, out), f, o.color ?? BULB, 0.01 + (k % 3) / 3));
}

/**
 * An arrow of bulbs on the wall pointing along it (dir +1 right, -1 left) from u, at height y, `len` long: the bulbs
 * light in a band that runs to its head, over and over (to the door it points at).
 */
export function bulbArrow(mb: MeshBuilder, f: WallFrame, u: number, y: number, len: number, dir: 1 | -1, o: { out?: number; color?: C3 } = {}): void {
  const out = o.out ?? 0.06;
  const pts: [number, number, number][] = [];
  const n = Math.round(len / 0.22);
  for (let i = 0; i <= n; i++) pts.push([u + dir * (len * i) / n, y, i / n]);
  const head = 0.55;
  for (let i = 1; i <= 3; i++) {
    const k = (i / 3) * head;
    pts.push([u + dir * (len - k), y + k, 1 - k / len], [u + dir * (len - k), y - k, 1 - k / len]);
  }
  for (const [pu, py, t] of pts) bulb(mb, at(f, pu, py, out), f, o.color ?? BULB, 0.01 + 0.98 * (1 - t) * 0.66);
}

/**
 * 電光掲示板: a red LED board w wide, h tall, centred on u with its foot at y, its text scrolling through it at `speed`
 * metres a second; the message loops (a slot's width of it at a time).
 */
export function ledBoard(sb: SignBuilder, mb: MeshBuilder, layout: SignLayout, f: WallFrame, u: number, y: number, text: string, o: { w: number; h?: number; speed?: number; id: number }): void {
  const q = layout.rect(text, false);
  if (!q) return;
  const h = o.h ?? 0.5;
  const scale = h / q.h;
  const slotW = q.w * scale;
  // The window: as much of the slot as the board is wide (all of it if the message is shorter).
  const frac = Math.min(1, o.w / slotW);
  const uw = q.u1 - q.u0;
  sb.ink = lin(LED_RED);
  sb.plate = [q.u0, uw, (o.speed ?? 1.2) / slotW];
  sb.sign = [o.id % 1000000, 4];
  const w = Math.min(o.w, slotW);
  signBox(sb, f.p, f.r, f.n, u - w / 2, u + w / 2, y, y + h, 0.06, 0.1, layout.blankUv, { n: [q.u0, q.v0, q.u0 + uw * frac, q.v1] });
  mb.kind = KIND.plain;
  mb.color = DARK;
  mb.style = [0, 0, 0, 0];
  mb.frameBox(f.p, f.r, f.n, u - w / 2 - 0.06, u + w / 2 + 0.06, y - 0.06, y + h + 0.06, 0, 0.08);
}

/** Lettering in tubing (outlines) on a dark plate with a pictogram before it (ICON_NAMES), centred on u, h tall, its foot at y. */
export function tubeSign(sb: SignBuilder, mb: MeshBuilder, layout: SignLayout, f: WallFrame, u: number, y: number, text: string, icon: string | null, hex: number, o: { h?: number; iconHex?: number; id: number }): number {
  const q = layout.rect(text, false, 'tube');
  const ic = icon ? layout.rect(icon, false, 'icon') : null;
  if (!q) return 0;
  const h = o.h ?? 0.6;
  const w = q.w * (h / q.h);
  const iw = ic ? h : 0;
  const total = w + iw;
  const left = u - total / 2;
  if (ic) {
    setLook(sb, 'neon', o.iconHex ?? hex, o.id + 1);
    signBox(sb, f.p, f.r, f.n, left, left + iw, y, y + h, 0.04, 0.12, layout.blankUv, { n: uvOf(ic) });
  }
  setLook(sb, 'neon', hex, o.id);
  signBox(sb, f.p, f.r, f.n, left + iw, left + total, y, y + h, 0.04, 0.12, layout.blankUv, { n: uvOf(q) });
  mb.kind = KIND.plain;
  mb.color = DARK;
  mb.style = [0, 0, 0, 0];
  mb.frameBox(f.p, f.r, f.n, left - 0.05, left + total + 0.05, y - 0.05, y + h + 0.05, 0, 0.04);
  return total;
}

/** A company's name in white channel letters along the top of a tower's face (its top at `top`), at most maxW wide. */
export function crown(mb: MeshBuilder, f: WallFrame, u: number, top: number, text: string, o: { height?: number; maxW: number; hex?: number; id: number }): void {
  const hgt = o.height ?? 2.2;
  const s = Math.min(hgt / EM, o.maxW / textAdvance(text));
  channelLetters(mb, text, at(f, u, 0, 0), f.r, f.n, top - 0.6 - (EM * s) / 2, EM * s, o.maxW, lin(o.hex ?? 0x8f98ac), o.id, 0.05);
}

/** The small lit box over a door (24H, OPEN), standing out from the wall at u, its foot at y, lettered on its three faces. */
export function cube(sb: SignBuilder, mb: MeshBuilder, layout: SignLayout, f: WallFrame, u: number, y: number, text: string, hex: number, id: number): void {
  const q = layout.rect(text, false);
  if (!q) return;
  const s = 0.42;
  const w = Math.max(s, q.w * (s / q.h) * 0.8);
  setLook(sb, 'inverse', hex, id);
  signBox(sb, f.p, f.r, f.n, u - w / 2, u + w / 2, y, y + s, 0.3, 0.3 + s, layout.blankUv, { n: uvOf(q), r: uvOf(q), '-r': uvOf(q) });
  mb.kind = KIND.plain;
  mb.color = STEEL;
  mb.style = [0, 0, 0, 0];
  mb.frameBox(f.p, f.r, f.n, u - 0.04, u + 0.04, y + s / 2 - 0.04, y + s / 2 + 0.04, 0, 0.3);
}

/**
 * サインポール: a barber's pole on a bracket by the door at u, its foot at y: a lit glass column of red, white and blue
 * stripes winding up and turning (the sign material's style 5, drawn without the atlas), chrome caps top and bottom.
 */
export function barberPole(sb: SignBuilder, mb: MeshBuilder, f: WallFrame, u: number, y: number, id: number): void {
  const R = 0.09;
  const H = 0.78;
  const out = 0.26;
  const c = at(f, u, y, out);
  const SEG = 14;
  sb.ink = [1, 1, 1];
  sb.plate = [0, 0, 0];
  sb.sign = [id % 1000000, 5];
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2;
    const a1 = ((i + 1) / SEG) * Math.PI * 2;
    const p0: C3 = [c[0] + (f.n[0] * Math.cos(a0) + f.r[0] * Math.sin(a0)) * R, y, c[2] + (f.n[2] * Math.cos(a0) + f.r[2] * Math.sin(a0)) * R];
    const p1: C3 = [c[0] + (f.n[0] * Math.cos(a1) + f.r[0] * Math.sin(a1)) * R, y, c[2] + (f.n[2] * Math.cos(a1) + f.r[2] * Math.sin(a1)) * R];
    sb.quad(p0, [p1[0] - p0[0], 0, p1[2] - p0[2]], [0, H, 0], [i / SEG, 1, (i + 1) / SEG, 0]);
  }
  mb.kind = KIND.chrome;
  mb.color = lin(0xc8ccd0);
  mb.style = [0, 0, 0, 0];
  mb.cylinder(c[0], c[2], y + H, y + H + 0.08, R * 1.25, 10);
  mb.cylinder(c[0], c[2], y + H + 0.08, y + H + 0.16, R * 0.8, 10);
  mb.cylinder(c[0], c[2], y - 0.08, y, R * 1.25, 10);
  mb.cylinder(c[0], c[2], y - 0.14, y - 0.08, R * 0.6, 10);
  mb.kind = KIND.plain;
  mb.color = STEEL;
  for (const yb of [y + H + 0.04, y - 0.04]) mb.frameBox(f.p, f.r, f.n, u - 0.025, u + 0.025, yb - 0.025, yb + 0.025, 0, out);
}

/** The atlas texts a set of signs needs (each kind's own: tenants' panels and lanterns vertical, the rest across). */
export function signKindTexts(o: { vertical?: readonly string[]; horizontal?: readonly string[]; tube?: readonly string[]; icons?: readonly string[] }): SignText[] {
  return [
    ...(o.vertical ?? []).map((text) => ({ text, vertical: true })),
    ...(o.horizontal ?? []).map((text) => ({ text, vertical: false })),
    ...(o.tube ?? []).map((text) => ({ text, vertical: false, form: 'tube' as const })),
    ...(o.icons ?? []).map((text) => ({ text, vertical: false, form: 'icon' as const })),
  ];
}

// ---- In the city: what the siting (signSites.ts) places, and the texts the atlas needs for it. ----

/** Characters down a red lantern, by the words of the place's own sign (and 酒 on the other). */
export const LANTERN_TEXTS = ['焼鳥', 'やきとり', 'もつ焼', 'ホルモン', '串焼', 'おでん', '居酒屋', '酒'] as const;

/** What an LED board says, by the trade it's over. */
export const LED_MESSAGES: Readonly<Record<string, readonly string[]>> = {
  pachinko: ['本日新台入替 ★ 朝十時開店 ★ 全台開放中 ★ ', '新装開店 ★ 出玉大放出 ★ 本日も元気に営業中 ★ '],
  arcade: ['ゲーム新作入荷 ★ 一回五十円 ★ 両替機あります ★ '],
  electronics: ['免税 TAX FREE ★ 本日特価 ★ パソコン大安売り ★ '],
  karaoke: ['カラオケ一時間五百円 ★ 飲み放題 ★ 団体様歓迎 ★ '],
};
/** The offices and schools whose names are on an upstairs floor's windows, by district. */
export const WINDOW_WORDS: Readonly<Record<string, readonly string[]>> = {
  neon: ['雀荘', '金融', '興信所', '不動産', '英会話', 'ローン', '探偵'],
  tower: ['英会話', '税理士', '司法書士', '法律事務所', '会計事務所', '歯科', '貸会議室', '人材派遣'],
  electric: ['パソコン教室', '英会話', '歯科', '中古ゲーム', '修理', '買取'],
  campus: ['学習塾', '予備校', '英会話', '歯科', '書道教室'],
  residential: ['学習塾', '歯科', '整骨院', 'そろばん', '書道教室', 'ピアノ教室'],
  oldtown: ['三味線', '書道教室', '整骨院', '歯科', '囲碁'],
  harbor: ['海運', '通関', '船舶代理店', '運送'],
};
/** Companies (invented) whose names crown towers. */
export const CROWN_NAMES = ['朝霧生命', '朝霧信託銀行', '東都海上火災', '光和商事', '白峰電機', '曙重工', '環洋汽船', '北辰証券'] as const;
export const CUBE_TEXTS = ['24H', 'OPEN'] as const;

/** One of the kinds above, where the siting put it (on a building's wall frame). */
export type SignExtra =
  | { readonly kind: 'tenants'; readonly f: WallFrame; readonly u: number; readonly top: number; readonly panels: readonly Panel[]; readonly flush: boolean; readonly width: number; readonly id: number }
  | { readonly kind: 'stand'; readonly f: WallFrame; readonly u: number; readonly out: number; readonly text: string; readonly color: number; readonly look: SignLook; readonly id: number }
  | { readonly kind: 'lantern'; readonly f: WallFrame; readonly u: number; readonly y: number; readonly text: string; readonly id: number }
  | { readonly kind: 'hotel'; readonly f: WallFrame; readonly u: number; readonly y: number; readonly prices: readonly string[]; readonly full: boolean; readonly id: number }
  | { readonly kind: 'bulbs'; readonly f: WallFrame; readonly u0: number; readonly u1: number; readonly y0: number; readonly y1: number }
  | { readonly kind: 'arrow'; readonly f: WallFrame; readonly u: number; readonly y: number; readonly len: number; readonly dir: 1 | -1 }
  | { readonly kind: 'led'; readonly f: WallFrame; readonly u: number; readonly y: number; readonly text: string; readonly w: number; readonly id: number }
  | { readonly kind: 'window'; readonly f: WallFrame; readonly u: number; readonly y: number; readonly text: string; readonly color: number; readonly maxW: number; readonly id: number }
  | { readonly kind: 'crown'; readonly f: WallFrame; readonly u: number; readonly top: number; readonly text: string; readonly maxW: number; readonly id: number }
  | { readonly kind: 'cube'; readonly f: WallFrame; readonly u: number; readonly y: number; readonly text: string; readonly color: number; readonly id: number }
  | { readonly kind: 'pole'; readonly f: WallFrame; readonly u: number; readonly y: number; readonly id: number };

/** How far a lantern hangs from its wall. */
export const LANTERN_OUT = 0.45;

/** Builds a chunk's sign extras: lettering into sb (the sign material), frames, bulbs and caps into mb (the city's). */
export function addSignExtras(extras: readonly SignExtra[], layout: SignLayout, sb: SignBuilder, mb: MeshBuilder): void {
  for (const e of extras) {
    switch (e.kind) {
      case 'tenants': tenantBoard(sb, mb, layout, e.f, e.u, e.top, e.panels, { width: e.width, flush: e.flush, id: e.id }); break;
      case 'stand': standSign(sb, mb, layout, e.f, e.u, e.out, e.text, e.color, e.look, e.id); break;
      case 'lantern': lantern(sb, mb, layout, e.f, e.u, LANTERN_OUT, e.y, e.text, { id: e.id }); break;
      case 'hotel': hotelBoards(sb, mb, layout, e.f, e.u, e.y, e.prices, { full: e.full, id: e.id }); break;
      case 'bulbs': bulbFrame(mb, e.f, e.u0, e.u1, e.y0, e.y1, { out: 0.1 }); break;
      case 'arrow': bulbArrow(mb, e.f, e.u, e.y, e.len, e.dir, { color: [1.9, 0.5, 1.2] }); break;
      case 'led': ledBoard(sb, mb, layout, e.f, e.u, e.y, e.text, { w: e.w, id: e.id }); break;
      case 'window': windowLetters(sb, layout, e.f, e.u, e.y, e.text, e.color, { maxW: e.maxW, id: e.id }); break;
      case 'crown': crown(mb, e.f, e.u, e.top, e.text, { maxW: e.maxW, id: e.id }); break;
      case 'cube': cube(sb, mb, layout, e.f, e.u, e.y, e.text, e.color, e.id); break;
      case 'pole': barberPole(sb, mb, e.f, e.u, e.y, e.id); break;
    }
  }
}

/** Their light on the street, for the lightmap (window letters and crowns give none). */
export function extraLights(extras: readonly SignExtra[]): Light[] {
  const out: Light[] = [];
  const put = (f: WallFrame, u: number, o: number, r: number, color: C3, i: number): void => {
    const p = at(f, u, 0, o);
    out.push({ x: p[0], z: p[2], r, color, i });
  };
  for (const e of extras) {
    switch (e.kind) {
      case 'tenants': put(e.f, e.u, e.flush ? 0.5 : 0.8, 4.5, lin(e.panels[0]?.color ?? 0xffffff), 0.32); break;
      case 'stand': put(e.f, e.u, e.out, 2.2, lin(e.color), 0.28); break;
      case 'lantern': put(e.f, e.u, LANTERN_OUT, 2.6, [1, 0.25, 0.1], 0.3); break;
      case 'hotel': put(e.f, e.u, 0.4, 2, e.full ? [1, 0.3, 0.3] : [0.4, 1, 0.5], 0.2); break;
      case 'bulbs': put(e.f, (e.u0 + e.u1) / 2, 1, 5, [1, 0.8, 0.5], 0.35); break;
      case 'arrow': put(e.f, e.u, 0.6, 3, [1, 0.4, 0.8], 0.2); break;
      case 'led': put(e.f, e.u, 0.6, 3.5, [1, 0.2, 0.1], 0.25); break;
      case 'cube': put(e.f, e.u, 0.5, 2, lin(e.color), 0.2); break;
      case 'pole': put(e.f, e.u, 0.4, 1.8, [0.9, 0.6, 0.7], 0.15); break;
      default: break;
    }
  }
  return out;
}

/**
 * The atlas texts the extras can show anywhere in the city (the tenants' and stand signs' are the sign words, already
 * there): lantern characters, prices, the vacancy lamps, LED messages, window names, cubes, tubing for the Latin sign
 * words, the pictograms.
 */
export function signKindAtlasTexts(words: readonly string[]): SignText[] {
  return signKindTexts({
    vertical: LANTERN_TEXTS,
    horizontal: [...ALL_HOTEL_PRICES, '空室', '満室', ...Object.values(LED_MESSAGES).flat(), ...Object.values(WINDOW_WORDS).flat(), ...CUBE_TEXTS],
    tube: words.filter((w) => [...w].every((c) => c.charCodeAt(0) < 0x2e80)),
    icons: ICON_NAMES,
  });
}
