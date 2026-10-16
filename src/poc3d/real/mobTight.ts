/**
 * Skin-tight and revealing clothes on the mob's bodies: the garment is painted on the body's own skin (the shade of
 * each point, as a gown's bare shoulders are: `real/mobShape.ts`), so it shows the form under it, the way the cloth
 * clings; what stands off the body (leg warmers, a collar, ears, a short jacket) is lofted over it there.
 *
 * Each garment is a `Painter`: a colour for a point of the body by where it is (or none: the skin stays). `applyPaint`
 * paints a run of the body with one, and where a triangle straddles an edge of the garment it is split (a few levels
 * of midpoints, only along the edge), so a neckline or a leg cut is a clean line though the body's mesh is a couple
 * of centimetres wide there. A woman's with the nude body's form (`NUDE_FORM` in mobShape.ts), where the breasts, the
 * waist and the hips have their full shape; a man's on his own. Heights are the man's metres (`y / ys`), widths
 * `x / xs`. Nothing here is explicit: it is a smooth faceless body in colour, and the explicit detail is the
 * uncensored edition's alone (real/mobBare.ts).
 */

/** The colours (mobShape.ts shade values) a garment is painted in. */
export interface Dye {
  readonly skin: number;
  /** The garment's main colour, and its trim (lace, a hem, a band). */
  readonly cloth: number;
  readonly trim: number;
  /** What the legs are in under it: sheer stockings, or tights. */
  readonly hose?: number;
}

/** The mesh to paint, as `TemplateBuilder` holds it, and how to read the body from it. */
export interface Surface {
  readonly pos: number[];
  readonly b0: number[];
  readonly b1: number[];
  readonly w: number[];
  readonly shade: number[];
  idx: number[];
  readonly ys: number;
  readonly xs: number;
  /** The torso's centre in depth at a height (m): in front of it is the front. */
  readonly centreZ: (y: number) => number;
  /** The skin's shade (a point's darkening, the cleft's, is kept under what is painted over it). */
  readonly skin: number;
}

/** A point of the body, in the man's units: `u` height, `a` across (absolute), `x` across, `front` whether it is in front of the torso's middle. */
export interface P {
  readonly u: number;
  readonly a: number;
  readonly x: number;
  readonly front: boolean;
}
/** A colour for a point, or none (the skin stays). */
export type Painter = (p: P) => number | null;

/** The first of the painters to give a colour (so list a trim before the cloth it sits on). */
export const combine = (...ps: readonly Painter[]): Painter => (p) => {
  for (const f of ps) {
    const c = f(p);
    if (c !== null) return c;
  }
  return null;
};

const ease = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Paints the points `from` to `to` with `paint`, and cuts the triangles that straddle one of its edges `levels` times
 * into four (at the edges' midpoints, the new points on the body's own triangles), so the edge is crisp. Points the
 * painter leaves alone keep their shade; a painted one takes its colour less what the body had darkened its skin by
 * (the cleft's line).
 */
export function applyPaint(m: Surface, from: number, to: number, paint: Painter, levels = 3, minEdge = MIN_EDGE): void {
  const colours: (number | null | undefined)[] = [];
  const read = (i: number): P => {
    const x = m.pos[i * 3] / m.xs;
    const y = m.pos[i * 3 + 1];
    return { u: y / m.ys, a: Math.abs(x), x, front: m.pos[i * 3 + 2] > m.centreZ(y) };
  };
  const colourAt = (i: number): number | null => {
    let c = colours[i];
    if (c === undefined) c = colours[i] = paint(read(i));
    return c;
  };
  const put = (i: number, c: number): void => {
    const old = m.shade[i];
    const dark = old <= m.skin + 1e-6 && old > m.skin - 1 ? m.skin - old : 0;
    m.shade[i] = c - dark;
  };
  for (let i = from; i < to; i++) {
    const c = colourAt(i);
    if (c !== null) put(i, c);
  }
  const made = new Map<number, number>();
  const keyOf = (a0: number, b0: number): number => Math.min(a0, b0) * 4294967 + Math.max(a0, b0);
  /** The point half way along an edge, made once for both the triangles that share it. */
  const mid = (a0: number, b0: number): number => {
    const a = Math.min(a0, b0), b = Math.max(a0, b0);
    const key = keyOf(a, b);
    let v = made.get(key);
    if (v !== undefined) return v;
    v = m.pos.length / 3;
    made.set(key, v);
    for (let k = 0; k < 3; k++) m.pos.push((m.pos[a * 3 + k] + m.pos[b * 3 + k]) / 2);
    const same = m.b0[a] === m.b0[b] && m.b1[a] === m.b1[b];
    m.b0.push(m.b0[a]);
    m.b1.push(m.b1[a]);
    m.w.push(same ? (m.w[a] + m.w[b]) / 2 : m.w[a]);
    // (Between a painted point and a bare one, not the average of two tags: the bare one's shade.)
    const ca = colourAt(a), cb = colourAt(b);
    m.shade.push(ca === null && cb === null ? (m.shade[a] + m.shade[b]) / 2 : ca === null ? m.shade[a] : cb === null ? m.shade[b] : m.shade[a]);
    const c = colourAt(v);
    if (c !== null) put(v, c);
    return v;
  };
  // (The points made here, past the end of the mesh, are the garment's too.)
  const made0 = m.pos.length / 3;
  const inRange = (i: number): boolean => (i >= from && i < to) || i >= made0;
  /** The garment's colour at a point that is not a vertex (the middle of an edge, of a triangle). */
  const probe = (x: number, y: number, z: number): number | null => paint({ u: y / m.ys, a: Math.abs(x / m.xs), x: x / m.xs, front: z > m.centreZ(y) });
  const at = (i: number, k: number): number => m.pos[i * 3 + k];
  // Level by level: the edges of every triangle that straddles the garment's edge are cut at their middles, and every
  // triangle (that one or its neighbour) is cut by whichever of its edges were, so what is cut stays whole. An edge
  // is the garment's where its ends differ or the colour half way along it differs from them (a strap that crosses it
  // between two points of one colour).
  for (let level = 0; level < levels; level++) {
    const split = new Set<number>();
    const verdict = new Map<number, boolean>();
    const edge = (a: number, b: number): boolean => {
      const key = keyOf(a, b);
      let v = verdict.get(key);
      if (v === undefined) {
        const ca = colourAt(a), cb = colourAt(b);
        // (Not an edge already as short as the garment's line needs: the triangles would only multiply.)
        v = Math.hypot(at(a, 0) - at(b, 0), at(a, 1) - at(b, 1), at(a, 2) - at(b, 2)) > minEdge && (ca !== cb || probe((at(a, 0) + at(b, 0)) / 2, (at(a, 1) + at(b, 1)) / 2, (at(a, 2) + at(b, 2)) / 2) !== ca);
        verdict.set(key, v);
      }
      return v;
    };
    for (let t = 0; t + 2 < m.idx.length; t += 3) {
      const a = m.idx[t], b = m.idx[t + 1], c = m.idx[t + 2];
      if (!inRange(a) || !inRange(b) || !inRange(c)) continue;
      const eab = edge(a, b), ebc = edge(b, c), eca = edge(c, a);
      // (A patch inside a triangle, not reaching its edges: cut the whole.)
      const whole = !eab && !ebc && !eca && probe((at(a, 0) + at(b, 0) + at(c, 0)) / 3, (at(a, 1) + at(b, 1) + at(c, 1)) / 3, (at(a, 2) + at(b, 2) + at(c, 2)) / 3) !== colourAt(a);
      if (eab || whole) split.add(keyOf(a, b));
      if (ebc || whole) split.add(keyOf(b, c));
      if (eca || whole) split.add(keyOf(c, a));
    }
    if (!split.size) break;
    const out: number[] = [];
    for (let t = 0; t + 2 < m.idx.length; t += 3) {
      const a = m.idx[t], b = m.idx[t + 1], c = m.idx[t + 2];
      if (!inRange(a) || !inRange(b) || !inRange(c)) {
        out.push(a, b, c);
        continue;
      }
      const sab = split.has(keyOf(a, b)), sbc = split.has(keyOf(b, c)), sca = split.has(keyOf(c, a));
      const n = +sab + +sbc + +sca;
      if (n === 0) out.push(a, b, c);
      else if (n === 3) {
        const ab = mid(a, b), bc = mid(b, c), ca2 = mid(c, a);
        out.push(a, ab, ca2, ab, b, bc, ca2, bc, c, ab, bc, ca2);
      } else if (n === 1) {
        // (Rotated so the cut edge is the first: the triangle's order is kept.)
        const [p, q, r] = sab ? [a, b, c] : sbc ? [b, c, a] : [c, a, b];
        const pq = mid(p, q);
        out.push(p, pq, r, pq, q, r);
      } else {
        // Two cut: rotated so they are the edges either side of the point `q`, the one between them left whole.
        const [p, q, r] = !sca ? [a, b, c] : !sab ? [b, c, a] : [c, a, b];
        const pq = mid(p, q), qr = mid(q, r);
        out.push(pq, q, qr, p, pq, qr, p, qr, r);
      }
    }
    m.idx = out;
  }
}

/** The shortest edge `applyPaint` still cuts (m): a garment's line is straight to within about this. */
const MIN_EDGE = 0.008;

/** Where a woman's breasts are (the man's metres, on the +x side). */
export const BUST_AT = { x: 0.07, y: 1.262 } as const;
const CROTCH = 0.825;

/** Whether a point is on a breast's cup of `r` (man's metres across), a little flattened. */
const onCup = (p: P, r: number, up = 1): boolean => p.front && ((p.a - BUST_AT.x) / r) ** 2 + ((p.u - BUST_AT.y) / (r * up)) ** 2 < 1;

/**
 * The line a pair of briefs' legs are cut along: a height at a distance across from the middle. Low and level the
 * whole way for a boy-short (`cut` 0); rising to `cut` (m) at the hip's side for a high-cut brief or a leotard.
 */
// (At the middle it runs lower, under where the legs part, so what is between the legs is covered: the garment goes
// under her, as a leotard or briefs do, and no form pokes out of it.)
const hole = (a: number, cut: number): number => CROTCH + cut * ease(0.03, 0.17, a) - 0.09 * (1 - ease(0.015, 0.06, a));

/** A woman's top: its cups, band and straps (the shapes by `style`). */
export type TopStyle = 'bra' | 'bandeau' | 'halter' | 'racer' | 'tube';

/**
 * The top: two cups over the breasts, a band under them and round the back, and what holds it up. `bra` straps over
 * the shoulders, `halter` a strap each from the cups to the neck and a tie across the back, `racer` straps that meet
 * between the shoulder blades, `bandeau` and `tube` none (a band across).
 */
export function topPainter(d: Dye, style: TopStyle, trim = false): Painter {
  const r = style === 'tube' ? 0.085 : style === 'bandeau' ? 0.075 : 0.072;
  return (p) => {
    const cup = onCup(p, r, style === 'tube' ? 1.25 : 1);
    // The band under the cups, all the way round (a tube's covers the whole chest from the underband up to just over the cups).
    const band = p.u > 1.168 && p.u < (style === 'tube' ? 1.33 : style === 'bandeau' ? 1.215 : 1.195);
    if (cup || band) return trim && p.u > 1.168 && p.u < 1.178 ? d.trim : d.cloth;
    const strap = p.a > 0.045 && p.a < 0.085;
    if (style === 'bra' && p.u > 1.27 && p.u < 1.45 && strap && p.a > 0.052 + (1.45 - p.u) * 0.05) return d.cloth;
    if (style === 'halter' && p.u > 1.27 && p.u < 1.465 && p.front && p.a < 0.07 - (p.u - 1.27) * 0.28 && p.a > 0.035 - (p.u - 1.27) * 0.1) return d.cloth;
    if (style === 'halter' && !p.front && p.u > 1.26 && p.u < 1.285) return d.cloth;
    // Straps that meet in a Y between the blades: out at the top, in at the middle of the back.
    if (style === 'racer' && p.u > 1.27 && p.u < 1.45 && strap) return !p.front || p.u > 1.34 ? d.cloth : null;
    return null;
  };
}

/** A pair of briefs or a bikini bottom: how high it rises at the middle and the sides (the man's height), and how high its legs are cut (m). */
export interface Briefs {
  readonly front: number;
  readonly side: number;
  readonly back: number;
  readonly cut: number;
  /** A band of trim round its top, this deep (m). */
  readonly edge?: number;
}

export function briefsPainter(d: Dye, b: Briefs): Painter {
  return (p) => {
    if (p.u < hole(p.a, b.cut) || p.u > 1.0) return null;
    // Its top edge: across the front it dips toward the middle, behind it is higher.
    const top = p.front ? b.front + (b.side - b.front) * ease(0, 0.14, p.a) : b.back + (b.side - b.back) * ease(0.05, 0.16, p.a) * 0.6;
    if (p.u > top) return null;
    return b.edge && p.u > top - b.edge ? d.trim : d.cloth;
  };
}

/**
 * A one-piece (a leotard, a bunny's costume, a swimsuit): from the leg cut up to a neckline over the chest and
 * back, its straps over the shoulders. `neck` the front's height at the middle and `back` the back's; `strap`
 * whether it has any (else it ends in a line across).
 */
export interface OnePiece {
  readonly cut: number;
  readonly neck: number;
  readonly back: number;
  readonly strap: boolean;
  /** How wide the straps are apart across (m, the man's units): the scoop's width. */
  readonly scoop?: number;
}

export function onePiecePainter(d: Dye, o: OnePiece): Painter {
  const scoop = o.scoop ?? 0.1;
  return (p) => {
    if (p.u < hole(p.a, o.cut)) return null;
    // The neckline: a scoop in front (lower at the middle, rising to the straps), higher behind.
    const line = p.front ? o.neck - 0.11 * (1 - ease(0, scoop, p.a)) * (o.neck > 1.3 ? 1 : 0.6) : o.back - 0.05 * (1 - ease(0, scoop, p.a));
    if (p.u <= line) return d.cloth;
    if (o.strap && p.u < 1.455 && p.a > scoop - 0.03 && p.a < scoop + 0.02) return d.cloth;
    return null;
  };
}

/** Legs: everything between two heights (the man's), from the ankle: stockings, tights, leggings. */
export const legPainter = (shade: number, top: number, bottom = 0): Painter => (p) => (p.u <= top && p.u >= bottom ? shade : null);

/** A band round a body or a leg between two heights: a stocking's top, a waistband. */
export const bandPainter = (shade: number, lo: number, hi: number): Painter => (p) => (p.u >= lo && p.u <= hi ? shade : null);

/**
 * A tight dress on the body: from a neckline to a hem, over the chest, waist and hips (the legs are painted with
 * `legPainter`). Without `strap` it ends in a line across the chest; with, a strap over each shoulder.
 */
export function dressPainter(d: Dye, o: { readonly neck: number; readonly strap: boolean }): Painter {
  return (p) => {
    const line = p.front ? o.neck : o.neck + 0.03;
    if (p.u <= line) return d.cloth;
    if (o.strap && p.u < 1.455 && p.a > 0.05 && p.a < 0.085) return d.cloth;
    return null;
  };
}

/** A man's singlet: his torso covered from `below` up to the neck, the armholes cut wide (skin at the shoulders and sides). */
export const singletPainter = (d: Dye, below: number): Painter => (p) => {
  if (p.u < below) return null;
  if (p.u > 1.2 && p.a > 0.155) return d.skin;
  if (p.u > 1.4 && p.a > 0.1) return d.skin;
  return d.cloth;
};

/** A loincloth: a band round the hips at `top`, a panel down the front, a narrow strip behind (the rest of the seat bare). */
export const loinclothPainter = (d: Dye, top: number): Painter => (p) => {
  if (p.u > top || p.u < 0.8) return d.skin;
  if (p.u > top - 0.045) return d.cloth;
  if (p.front && p.a < 0.07) return d.cloth;
  if (!p.front && p.a < 0.018) return d.cloth;
  return d.skin;
};

/** A man's trousers or trunks seen over the hips where nothing covers them: his torso painted `shade` below a height, with a belt of `belt` just under it. */
export const waistPainter = (shade: number, top: number, belt?: number): Painter => (p) => {
  if (p.u > top) return null;
  return belt !== undefined && p.u > top - 0.03 ? belt : shade;
};
