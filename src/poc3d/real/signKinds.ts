import type { SignLook } from '../district/plan';
import { EM, textAdvance } from './letters';
import { EMIT, KIND, lin, type MeshBuilder } from './meshBuilder';
import { channelLetters, lookStyle, signBox, type SignBuilder, type SignLayout, type SignText } from './signs';

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
  sb.sign = [id % 100000, st.style];
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
  sb.sign = [o.id % 100000, 3.25];
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
  sb.sign = [o.id % 100000, 1];
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
  sb.sign = [o.id % 100000, 4];
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

/** The atlas texts a set of signs needs (each kind's own: tenants' panels and lanterns vertical, the rest across). */
export function signKindTexts(o: { vertical?: readonly string[]; horizontal?: readonly string[]; tube?: readonly string[]; icons?: readonly string[] }): SignText[] {
  return [
    ...(o.vertical ?? []).map((text) => ({ text, vertical: true })),
    ...(o.horizontal ?? []).map((text) => ({ text, vertical: false })),
    ...(o.tube ?? []).map((text) => ({ text, vertical: false, form: 'tube' as const })),
    ...(o.icons ?? []).map((text) => ({ text, vertical: false, form: 'icon' as const })),
  ];
}
