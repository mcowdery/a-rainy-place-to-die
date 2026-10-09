import * as THREE from 'three';
import { BLUSH_LOOKS, CRIMSON, DARK, EMOTE_GLSL, EMOTE_LOOKS, EMOTE_RATE, EMOTE_REACH, HEART_LOOKS, IVORY, MARKS, mk, STAR_LOOKS, type EmoteLooks, type Mark } from './emoteGlsl';
import { HEAD, SPINE, THIGH_L } from './mobRig';
import { FIGURE_ATTRS, FIGURE_STRIDE, figureSize, getMobShape, MOB_PLACE_GLSL } from './people';

export { BLUSH_LOOKS, EMOTE_LOOKS, EMOTE_MARKS, EMOTE_RATE, HEART_LOOKS, STAR_LOOKS, type EmoteLooks, type Mark } from './emoteGlsl';

/**
 * The mob's emotes: manga's effect marks (漫符) at a figure's head, since the figures have no faces to show
 * anything with. A sweat drop, the anger mark, a blush, "!" and "?", a heart, a note, "zzz", a sigh, "..." and so
 * on. Now and then, on a few people, for a couple of seconds. And, not an emote, everyone's breath in the cold.
 *
 * Here: the marks over and beside a head, the sigh and the breath. Each is one instanced mesh of billboards (two
 * triangles a figure) for everyone the crowd draws, on the figures' own numbers (people.ts FIGURE_ATTRS) and the mob
 * material's clock: the vertex shader asks who is emoting now and with what (real/emoteGlsl.ts: a hash of the
 * figure and the time, the mark by what the figure is doing), finds the head as the mob's shader poses it
 * (MOB_PLACE_GLSL, the joints texture, `headGlsl` below) and drops everyone else before any of that. The marks are
 * painted once on a canvas, as ink (no emoji: a font's would be a real brand's).
 *
 * The marks on a face (a blush, hearts or stars for eyes) aren't here: they're part of the figure's own draw (quads
 * on the head's bone, real/mobShape.ts, drawn by the mob's material), so they turn, nod and bob with the head. From
 * behind, where a face can't be seen, hearts and stars for eyes are the mark over the head instead.
 */

/** Where a mark is hung: by the head as the viewer sees it, on the face (the figure's own draw, not here), or at the mouth. */
const AT_HEAD = 0, ON_FACE = 1, AT_MOUTH = 2;
/**
 * Each mark's place and size, in head heights (the head's joint to the top of the hair). By the head: [right, up]
 * from the head's centre as the viewer sees it. At the mouth: `up` from the head's centre, on the front of the head. Then the size of its square, how far it's brought toward the viewer (the ones on the head
 * itself: in front of it, not inside it), and where it's hung.
 */
const PLACE: Record<Mark, readonly [number, number, number, number, number]> = {
  // One drop on the side of the head (embarrassed, exasperated); it runs down.
  sweat: [0.46, 0.3, 0.5, 0.6, AT_HEAD],
  // Four ticks on the temple.
  anger: [-0.3, 0.32, 0.54, 0.7, AT_HEAD],
  exclaim: [0.38, 0.98, 0.78, 0.1, AT_HEAD],
  question: [0.38, 0.98, 0.78, 0.1, AT_HEAD],
  shock: [0.4, 0.98, 0.9, 0.1, AT_HEAD],
  // (On the face: the template's own quads and the head's skin, not billboards.)
  blushLines: [0, 0, 0, 0, ON_FACE],
  blushFlush: [0, 0, 0, 0, ON_FACE],
  blushBoth: [0, 0, 0, 0, ON_FACE],
  heartOver: [0.38, 0.92, 0.52, 0.1, AT_HEAD],
  heartEyes: [0, 0, 0, 0, ON_FACE],
  heartRising: [0.3, 1.0, 0.9, 0.1, AT_HEAD],
  starOver: [0.42, 0.78, 0.6, 0.3, AT_HEAD],
  starEyes: [0, 0, 0, 0, ON_FACE],
  // Round the head, the head showing through the middle.
  starRound: [0, 0.12, 1.9, 0.5, AT_HEAD],
  note: [0.42, 0.92, 0.7, 0.1, AT_HEAD],
  sleep: [0.46, 0.95, 0.82, 0.1, AT_HEAD],
  // Breath let out at the mouth, leaving forward and down.
  sigh: [0, -0.36, 0.76, 0.1, AT_MOUTH],
  // "..." over the head: lost for words.
  dots: [0, 0.92, 0.62, 0.1, AT_HEAD],
  // Fine lines hanging down over the brow.
  gloom: [0.06, 0.42, 0.9, 0.7, AT_HEAD],
  // Ticks of sweat flying off the head.
  fluster: [0.5, 0.55, 0.6, 0.5, AT_HEAD],
  vapour: [0, -0.36, 0.5, 0.1, AT_MOUTH],
};

/** How much larger a mark is drawn for each metre it's away (beyond 3 m), so it still reads: an accent, never a sign. */
const EMOTE_GROW = 0.05;
/** A sigh: how long the breath takes to leave (s). */
const SIGH = 1.7;

/**
 * The cold: breath shows by how cold the air is (`cold`, 0 to 1: district/forecast.ts coldBreath), within
 * BREATH_REACH m of the viewer, each puff BREATH_LASTS s from the top of a breath.
 */
export const BREATH_REACH = 25;
const BREATH_LASTS = 1.3;

const COLS = 5;
const ROWS = Math.ceil(MARKS.length / COLS);
// ---- The marks, painted ----

/**
 * Inked, not rendered: flat marks in one ivory ink, with crimson only for anger, hearts and the blush and a slate
 * blue-grey for sweat and gloom. Strokes are filled shapes that swell and taper as a brush's do (`brush`), a little
 * uneven; a thin dark keyline and a hard offset shadow part them from a pale wall. No gradients, no highlights, no
 * glow. Only breath is soft: the sigh, and the cold's vapour.
 */
type G = CanvasRenderingContext2D;
type Path = (g: G) => void;
type Pt = readonly [number, number];
/** A cell's side in pixels; everything is drawn in units of 1/128 of it, the origin at its middle. */
const CELL = 256;
const UNIT = CELL / 128;
const SLATE = '#8fa3bc';
const dark = `rgb(${DARK.join(', ')})`;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Points along a line, and along a cubic curve. */
const line = (a: Pt, b: Pt, n = 10): Pt[] => Array.from({ length: n + 1 }, (_, i): Pt => [lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n)]);
const cubic = (a: Pt, c1: Pt, c2: Pt, b: Pt, n = 18): Pt[] =>
  Array.from({ length: n + 1 }, (_, i): Pt => {
    const t = i / n, s = 1 - t;
    return [s * s * s * a[0] + 3 * s * s * t * c1[0] + 3 * s * t * t * c2[0] + t * t * t * b[0], s * s * s * a[1] + 3 * s * s * t * c1[1] + 3 * s * t * t * c2[1] + t * t * t * b[1]];
  });
const chain = (...parts: Pt[][]): Pt[] => parts.flatMap((p, i) => (i ? p.slice(1) : p));
/** How wide a stroke is along it (t from 0 to 1). */
type Width = (t: number) => number;
/** Set down firmly, then drawn out thin: `w` wide soon after its start, `tail` of that at its end. */
const press = (w: number, tail = 0.15): Width => (t) => w * (t < 0.12 ? 0.6 + (0.4 * t) / 0.12 : lerp(1, tail, ((t - 0.12) / 0.88) ** 1.2));
/** Pointed at both ends, `w` wide in the middle. */
const pointed = (w: number): Width => (t) => w * Math.sin(Math.PI * t) ** 0.7;
/**
 * A brush stroke as a shape: along the points, as wide as `width` says, a little uneven (by `seed`). Its ends are
 * cut square where it has width there, pointed where it has none.
 */
const brush = (pts: readonly Pt[], width: Width, seed = 0): Path => (g) => {
  const n = pts.length;
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, n - 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
    const t = i / (n - 1);
    const w = (width(t) * (1 + 0.07 * Math.sin(t * 13 + seed * 5.1))) / 2;
    left.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
    right.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
  }
  g.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < n; i++) g.lineTo(left[i][0], left[i][1]);
  for (let i = n - 1; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
  g.closePath();
};
/**
 * Marks in one ink: the dark under them (a keyline `key` wide round each, and the same again set off down and to
 * the right, a hard shadow), then the ink, flat.
 */
function ink(g: G, color: string, paths: readonly Path[], key = 1, cast: Pt | null = [1.3, 1.7]): void {
  const each = (draw: () => void): void => {
    for (const p of paths) {
      g.beginPath();
      p(g);
      draw();
    }
  };
  g.fillStyle = dark;
  g.strokeStyle = dark;
  g.lineWidth = 2 * key;
  for (const [dx, dy] of cast ? [cast, [0, 0] as Pt] : [[0, 0] as Pt]) {
    g.save();
    g.translate(dx, dy);
    each(() => {
      g.fill();
      if (key > 0) g.stroke();
    });
    g.restore();
  }
  g.fillStyle = color;
  each(() => g.fill());
}
/** Something soft: a blot fading out to nothing at `r`. */
function mist(g: G, x: number, y: number, r: number, rgb: string, alpha: number, sy = 1, full = 0.45): void {
  g.save();
  g.translate(x, y);
  g.scale(1, sy);
  // (Full to `full` of the way out, then away to nothing.)
  const fade = g.createRadialGradient(0, 0, 0, 0, 0, r);
  fade.addColorStop(0, `rgba(${rgb}, ${alpha})`);
  fade.addColorStop(full, `rgba(${rgb}, ${alpha * 0.8})`);
  fade.addColorStop(full + 0.65 * (1 - full), `rgba(${rgb}, ${alpha * 0.25})`);
  fade.addColorStop(1, `rgba(${rgb}, 0)`);
  g.fillStyle = fade;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.restore();
}
/** A drop: its point up, `len` long, a long neck into a small round body, turned by `rot` (clockwise) about (x, y). */
const drop = (x: number, y: number, len: number, rot = 0): Path => (g) => {
  const r = 0.2 * len;
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.moveTo(0.02 * len, -0.6 * len);
  g.bezierCurveTo(0.03 * len, -0.3 * len, r, -0.08 * len, r, 0.18 * len);
  g.arc(0, 0.18 * len, r, 0, Math.PI);
  g.bezierCurveTo(-r, -0.06 * len, -0.01 * len, -0.3 * len, 0.02 * len, -0.6 * len);
  g.closePath();
  g.restore();
};
/** A heart, slim, its point drawn long, the left lobe a little the fuller (a hand's): `s` of full size about (x, y). */
const heart = (x: number, y: number, s = 1, rot = 0): Path => (g) => {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(s, s);
  g.moveTo(1, 40);
  g.bezierCurveTo(-9, 23, -36, 7, -36, -14);
  g.bezierCurveTo(-36, -31, -13, -36, -1, -17);
  g.bezierCurveTo(9, -35, 33, -31, 33, -15);
  g.bezierCurveTo(33, 5, 11, 22, 1, 40);
  g.closePath();
  g.restore();
};
/** A four-pointed star: `rv` up and down, `rh` across, its sides drawn in to the middle. */
const star = (x: number, y: number, rv: number, rh: number, k = 0.1): Path => (g) => {
  g.moveTo(x, y - rv);
  g.quadraticCurveTo(x + k * rh, y - k * rv, x + rh, y);
  g.quadraticCurveTo(x + k * rh, y + k * rv, x, y + rv);
  g.quadraticCurveTo(x - k * rh, y + k * rv, x - rh, y);
  g.quadraticCurveTo(x - k * rh, y - k * rv, x, y - rv);
  g.closePath();
};
/** A dab of the brush: a small blot, not quite round. */
const dab = (x: number, y: number, r: number, rot = 0.4): Path => (g) => {
  g.moveTo(x + r * 0.9 * Math.cos(rot), y + r * 0.9 * Math.sin(rot));
  g.ellipse(x, y, r * 0.9, r * 1.1, rot, 0, Math.PI * 2);
};
/** "!" and "?" as a brush writes them (upright here: the cell leans them), about x. */
const bang = (x: number): Path[] => [brush(line([x + 1, -44], [x - 1, 12], 12), press(11, 0.2), x), dab(x - 1.2, 30, 5.4)];
const hook = (x: number): Path[] => [
  brush(
    chain(cubic([x - 15, -25], [x - 14, -41], [x + 3, -46], [x + 12, -38], 10), cubic([x + 12, -38], [x + 21, -29], [x + 10, -17], [x + 3, -9], 10), cubic([x + 3, -9], [x + 0.5, -5], [x, 2], [x, 12], 6)),
    (t) => (t < 0.5 ? lerp(5, 11, Math.sin((t / 0.5) * (Math.PI / 2))) : lerp(11, 2.4, ((t - 0.5) / 0.5) ** 0.9)),
    x + 2,
  ),
  dab(x - 0.6, 30, 5.4),
];
/** A Z in three strokes, `s` tall, about (x, y). */
const zed = (x: number, y: number, s: number): Path[] => {
  const w = 0.36 * s, h = 0.4 * s, b = 0.16 * s;
  return [
    brush(line([x - w, y - h], [x + w, y - h], 6), (t) => 0.75 * b * (0.5 + 0.5 * Math.min(1, t * 4)), s),
    brush(line([x + w, y - h], [x - w, y + h], 8), press(1.25 * b, 0.55), s + 1),
    brush(line([x - w, y + h], [x + 1.1 * w, y + h], 6), (t) => 0.95 * b * (1 - t ** 2.2), s + 2),
  ];
};
/** Lean what's drawn after to the right, as a hand writing fast does. */
const italic = (g: G, k = 0.2): void => g.transform(1, 0, -k, 1, 0, 0);
/** Each mark in a cell of 128 units, the origin at its middle (kept within about 50 of it). The face's have none: they're drawn on the face. */
const ART: Partial<Record<Mark, (g: G) => void>> = {
  sweat: (g) => ink(g, SLATE, [drop(0, 4, 78, 0.06)]),
  anger: (g) => {
    ink(g, CRIMSON, [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sy], i): Path => brush(cubic([sx * 39, sy * 10], [sx * 18, sy * 11], [sx * 11, sy * 18], [sx * 10, sy * 39], 14), pointed(7.5), i)));
  },
  exclaim: (g) => {
    italic(g);
    ink(g, IVORY, bang(0));
  },
  question: (g) => {
    italic(g);
    ink(g, IVORY, hook(0));
  },
  shock: (g) => {
    g.scale(0.86, 0.86);
    italic(g);
    ink(g, IVORY, [...bang(-17), ...hook(13)]);
  },
  heartOver: (g) => ink(g, CRIMSON, [heart(0, 0, 1, -0.1)]),
  heartRising: (g) => ink(g, CRIMSON, [heart(-10, 33, 0.42, -0.18), heart(13, 0, 0.32, 0.2), heart(-3, -31, 0.22, -0.1)], 0.9, [1, 1.4]),
  starOver: (g) => ink(g, IVORY, [star(-6, 6, 42, 25), star(27, -27, 14, 9)]),
  starRound: (g) => {
    // Five small ones round the head, each in its own fifth of the circle (the shader makes each twinkle in turn).
    const round: readonly [number, number, number][] = [[36, 46, 13], [108, 50, 8], [180, 44, 10], [252, 49, 7], [324, 45, 11]];
    ink(g, IVORY, round.map(([deg, r, s]): Path => star(r * Math.cos((deg * Math.PI) / 180), 0.92 * r * Math.sin((deg * Math.PI) / 180), s, 0.62 * s)), 0.8, [0.9, 1.2]);
  },
  note: (g) => {
    ink(g, IVORY, [
      // The head, a hair of a stem, the flag as one stroke falling away to nothing.
      (g) => {
        g.save();
        g.translate(-9, 29);
        g.rotate(-0.42);
        g.moveTo(9.5, 0);
        g.ellipse(0, 0, 9.5, 6.2, 0, 0, Math.PI * 2);
        g.restore();
      },
      brush(line([-1.2, 27], [1.8, -42], 8), (t) => lerp(3.3, 2.4, t), 1),
      brush(cubic([2.4, -41], [7, -28], [25, -24], [19, -1]), (t) => (t < 0.18 ? lerp(2.4, 7, t / 0.18) : lerp(7, 0.4, ((t - 0.18) / 0.82) ** 0.8)), 2),
    ]);
  },
  sleep: (g) => {
    italic(g, 0.22);
    ink(g, IVORY, [...zed(-27, 28, 14), ...zed(-6, 8, 20), ...zed(22, -18, 28)], 0.9, [1.1, 1.5]);
  },
  sigh: (g) => {
    // Breath, leaving to the right: billowing where it leads, drawn out thin behind (the mouth's end).
    const BREATH = '240, 235, 224';
    mist(g, -38, 0, 9, BREATH, 0.5);
    mist(g, -22, 0, 14, BREATH, 0.62);
    mist(g, -2, 1, 20, BREATH, 0.72);
    mist(g, 20, -7, 19, BREATH, 0.8);
    mist(g, 24, 9, 17, BREATH, 0.8);
    mist(g, 34, 0, 14, BREATH, 0.7);
  },
  dots: (g) => ink(g, IVORY, [dab(-21, 2, 5.6, 0.3), dab(0, 3, 6, 0.9), dab(21, 1.5, 5.4, 0.5)]),
  gloom: (g) => {
    const ends = [4, 26, -8, 34, 12, -2];
    ink(g, SLATE, ends.map((end, i): Path => brush(line([-30 + 12 * i, -44], [-30 + 12 * i + (i % 2 ? 0.6 : -0.4), end], 8), (t) => 2.9 * (1 - 0.88 * t ** 1.5), i)), 0.8, null);
  },
  fluster: (g) => {
    // Three ticks of sweat flying off: fine where they leave the head, full at their far ends.
    const from: Pt = [-30, 38];
    const ticks: readonly [number, number, number][] = [[0.3, 30, 53], [0.82, 33, 59], [1.34, 30, 51]];
    ink(g, SLATE, ticks.map(([a, r0, r1], i): Path => brush(line([from[0] + r0 * Math.sin(a), from[1] - r0 * Math.cos(a)], [from[0] + r1 * Math.sin(a), from[1] - r1 * Math.cos(a)], 10), (t) => 5.6 * t ** 0.8 * (t > 0.82 ? Math.cos(((t - 0.82) / 0.18) * (Math.PI / 2)) ** 0.5 : 1), i)), 0.9);
  },
  vapour: (g) => {
    const AIR = '255, 255, 255';
    mist(g, 0, 0, 44, AIR, 0.7, 1, 0.25);
    mist(g, 14, -10, 26, AIR, 0.25);
    mist(g, -12, 12, 24, AIR, 0.22);
  },
};

/**
 * Gives the transparent texels round each mark the colour of what they're next to (their alpha stays 0), and the
 * rest the keyline's: the texture's colour isn't weighted by its alpha, so a filtered edge (and every mip) would blend
 * toward whatever colour the empty texels hold, a dark or a light fringe. (A canvas keeps none there, which is why
 * the texture is made from the pixels, not the canvas.)
 */
function bleed(px: Uint8ClampedArray, w: number, h: number, reach: number): void {
  // (A texel this faint has lost its colour to the canvas's premultiplied 8 bits: it takes its neighbours' too.)
  const SURE = 24;
  const n = w * h;
  // 0: no colour yet; 1: has one; 2: gets one this pass.
  const known = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (px[i * 4 + 3] >= SURE) known[i] = 1;
  // The texel beside i on side s (left, right, up, down), or -1 off the edge.
  const beside = (i: number, s: number): number => {
    const x = i % w;
    if (s === 0) return x > 0 ? i - 1 : -1;
    if (s === 1) return x < w - 1 ? i + 1 : -1;
    if (s === 2) return i >= w ? i - w : -1;
    return i < n - w ? i + w : -1;
  };
  // Outward a ring at a time: the texels without a colour next to ones with, each the average of those.
  let ring = new Int32Array(n);
  let next = new Int32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (known[i]) continue;
    for (let s = 0; s < 4; s++) {
      const j = beside(i, s);
      if (j >= 0 && known[j] === 1) {
        known[i] = 2;
        ring[count++] = i;
        break;
      }
    }
  }
  for (let pass = 0; pass < reach && count > 0; pass++) {
    for (let k = 0; k < count; k++) {
      const i = ring[k];
      let r = 0, g = 0, b = 0, m = 0;
      for (let s = 0; s < 4; s++) {
        const j = beside(i, s);
        if (j < 0 || known[j] !== 1) continue;
        r += px[j * 4];
        g += px[j * 4 + 1];
        b += px[j * 4 + 2];
        m++;
      }
      px[i * 4] = r / m;
      px[i * 4 + 1] = g / m;
      px[i * 4 + 2] = b / m;
    }
    let more = 0;
    for (let k = 0; k < count; k++) known[ring[k]] = 1;
    for (let k = 0; k < count; k++) {
      for (let s = 0; s < 4; s++) {
        const j = beside(ring[k], s);
        if (j >= 0 && known[j] === 0) {
          known[j] = 2;
          next[more++] = j;
        }
      }
    }
    [ring, next] = [next, ring];
    count = more;
  }
  for (let i = 0; i < n; i++) if (known[i] !== 1) px.set(DARK, i * 4);
}

let atlas: THREE.DataTexture | null = null;
/**
 * The marks' atlas (a cell each, COLS across, the first row at the top), painted the first time it's wanted. Its
 * alpha is straight (not premultiplied) and its colours sRGB; its canvas is kept in `userData.canvas` for a look at it.
 */
export function emoteAtlas(): THREE.DataTexture {
  if (atlas) return atlas;
  const t0 = performance.now();
  const canvas = document.createElement('canvas');
  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  MARKS.forEach((name, i) => {
    g.save();
    g.translate(((i % COLS) + 0.5) * CELL, (Math.floor(i / COLS) + 0.5) * CELL);
    g.scale(UNIT, UNIT);
    ART[name]?.(g);
    g.restore();
  });
  const image = g.getImageData(0, 0, canvas.width, canvas.height);
  bleed(image.data, canvas.width, canvas.height, 12);
  atlas = new THREE.DataTexture(new Uint8Array(image.data.buffer), canvas.width, canvas.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.magFilter = THREE.LinearFilter;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.generateMipmaps = true;
  atlas.anisotropy = 4;
  atlas.userData.canvas = canvas;
  // (How long the painting took, ms: once, at the start.)
  atlas.userData.ms = performance.now() - t0;
  atlas.needsUpdate = true;
  return atlas;
}

// ---- The meshes ----

/** The mob material's uniforms these run on (shared objects, so one clock, one set of joints, one street light). */
const SHARED = ['uTime', 'uStay', 'uHour', 'uRain', 'uSeason', 'uUmbrella', 'uStill', 'tJoints', 'uHemiSky', 'tLight', 'uLightRect', 'uLightFade', 'uLightGain', 'uEmoteRate', 'uEmoteForce', 'uEmoteLooks', 'uEmoteRow'] as const;
/** The head's height over its joint for a body without a measured one (the modelled figures). */
const HEAD_DEFAULT = 0.27;
/** The joints' rows with a measured head: the four bodies, then the shaped generation's teens (a girl, a boy). */
const HEAD_ROWS: readonly Parameters<typeof figureSize>[0][] = [
  { body: 'man', hair: 'short', long: false },
  { body: 'woman', hair: 'short', long: false },
  { body: 'child', hair: 'short', long: false },
  { body: 'elder', hair: 'short', long: false },
  { body: 'woman', hair: 'short', long: false, outfit: 'school' },
  { body: 'man', hair: 'short', long: false, outfit: 'school' },
];

/**
 * GLSL (vertex): a figure's head. Where its joint is, which way it faces and how tall it is, as the mob's shader
 * poses it; then a point of the head in the figure's frame, and a point of the figure in the world.
 * (It mirrors people.ts `ghostMaterial`: the lean, the walk's bob, a seat, the head's turn as it looks about and
 * goes through a standing figure's routine, `pickAct` and `act` there. Keep it in step with that.)
 */
const headGlsl = (cols: number, rows: number): string => /* glsl */ `
      uniform float uTime;
      uniform float uStay;
      uniform float uHour;
      uniform float uRain;
      uniform float uSeason;
      uniform float uUmbrella;
      uniform float uStill;
      uniform sampler2D tJoints;
      uniform float uHead[${HEAD_ROWS.length}];
      attribute vec4 aFig;
      attribute vec4 aPose;
      attribute vec4 aWalk;
      attribute vec3 aGround;
      attribute vec4 aWhen;
      float jointRow;
      vec3 pv(int i) { return texture2D(tJoints, vec2((float(i) + 0.5) / ${cols}.0, (jointRow + 0.5) / ${rows}.0)).xyz; }
      float hh(float k, float r) { return fract(sin(k * 12.9898 + r * 78.233) * 43758.5453); }
      ${MOB_PLACE_GLSL}
      // Which thing a standing figure does in its k-th stretch (the mob's pickAct).
      int headAct(int P, float k, float r, bool bag, bool umb) {
        float h = hh(k, r);
        int a = 0;
        if (uStill < 0.5) {
          if (P == 3) a = h < 0.4 ? 2 : h < 0.6 ? 3 : h < 0.72 ? 6 : h < 0.85 ? 1 : 0;
          else if (P == 2) a = h < 0.5 ? 8 : h < 0.62 ? 4 : h < 0.7 ? 5 : h < 0.8 ? 1 : h < 0.85 ? 6 : 0;
          else if (P == 5) a = h < 0.15 ? 9 : h < 0.45 ? 6 : h < 0.65 ? 1 : 0;
          else a = h < 0.27 ? 0 : h < 0.41 ? 1 : h < 0.51 ? 2 : h < 0.6 ? 4 : h < 0.67 ? 5 : h < 0.84 ? 6 : h < 0.89 ? 7 : h < 0.94 ? 3 : 0;
          if (bag && (a == 2 || a == 4 || a == 5)) a = a == 2 ? 3 : 0;
          if (umb) {
            if (a == 2 || a == 3 || a == 8 || a == 9) a = 6;
            else if (a == 4 || a == 5 || (bag && a == 7)) a = 0;
          }
        }
        return a;
      }
      // How the head turns and nods in it (the mob's act: its yaw and pitch).
      vec2 headLook(int a, float u, float k, float r, float side) {
        vec2 l = vec2(0.0);
        if (a == 2) l.y = 0.35;
        else if (a == 3) l.x = 0.25 * sin(u * 0.4 + r * 5.0);
        else if (a == 6) l = vec2(0.75 * sin(u * 0.8 + k * 2.1) + 0.2 * sin(u * 2.3 + r * 6.0), 0.08 * sin(u * 0.5 + k));
        else if (a == 7) {
          float w = smoothstep(0.2, 0.8, u) * (1.0 - smoothstep(2.4, 3.2, u));
          l = vec2(-0.25 * side * w, 0.3 * w);
        }
        return l;
      }
      // The head: its joint in the figure's frame, its turn and its nod (down positive), its height.
      struct Head { vec3 joint; float yaw; float pitch; float H; };
      Head headOf(float t, int body, float r, int P, bool moving, float phase) {
        jointRow = float(body);
        vec3 p1 = pv(${SPINE});
        vec3 p2 = pv(${HEAD});
        float hip = pv(${THIGH_L}).y;
        float lean = body == 3 ? 0.2 : 0.02;
        float drop = 0.0;
        float yaw = aPose.w;
        float pitch = 0.0;
        if (P == 1) {
          lean += 0.04;
          drop = hip * (1.0 - cos(sin(phase * 6.2832) * 0.36));
          if (moving) yaw = aPose.w * 0.4 + 0.12 * sin(t * 0.4 + r * 9.0);
        } else {
          lean += 0.012 * sin(t * 1.4 + r * 20.0);
          yaw += 0.12 * sin(t * 0.23 + r * 17.0) + 0.06 * sin(t * 0.61 + r * 5.0);
          pitch = 0.04 * sin(t * 0.31 + r * 11.0);
          if (P == 7) {
            lean = -0.05;
            drop = hip - 0.46;
          } else if (P != 6 && P != 8 && P != 10) {
            float side = sign(aPose.z);
            float carry = floor(abs(aPose.z) + 0.5);
            // (Less what it smokes, +8 or +16, and the straps' +4.)
            carry -= 8.0 * floor((carry - 1.0) / 8.0 + 0.01);
            if (carry > 4.5) carry -= 4.0;
            bool umb = carry > 2.5 && uUmbrella > 0.5;
            bool bag = carry - (carry > 2.5 ? 2.0 : 0.0) > 1.5;
            float dur = 5.0 + 6.0 * r;
            float tt = t / dur + r * 37.0;
            float k = floor(tt);
            float u = fract(tt) * dur;
            vec2 l = mix(headLook(headAct(P, k, r, bag, umb), u, k, r, side), headLook(headAct(P, k + 1.0, r, bag, umb), u - dur, k + 1.0, r, side), smoothstep(dur - 1.2, dur, u));
            yaw += l.x;
            pitch += l.y;
          }
        }
        vec3 up = p2 - p1;
        float H = body < ${HEAD_ROWS.length} ? uHead[min(body, ${HEAD_ROWS.length - 1})] : ${HEAD_DEFAULT.toFixed(2)};
        return Head(vec3(0.0, p1.y + cos(lean) * up.y - sin(lean) * up.z - drop, p1.z + sin(lean) * up.y + cos(lean) * up.z), yaw, pitch + 0.3 * lean, H);
      }
      // A point of the head (from its joint, in head heights: x right, y up, z out of the face), in the figure's frame.
      vec3 headPoint(Head h, vec3 p) {
        p *= h.H;
        float cy = cos(h.yaw), sy = sin(h.yaw);
        vec3 q = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
        float cp = cos(h.pitch), sp = sin(h.pitch);
        return h.joint + vec3(q.x, cp * q.y - sp * q.z, sp * q.y + cp * q.z);
      }
      // A point of the figure's frame in the world.
      vec3 inWorld(vec3 p, MobPlace place) {
        float a = aFig.z + place.turn;
        float fx = sin(a), fz = cos(a);
        return (modelMatrix * vec4(place.org.x + fz * p.x + fx * p.z, place.ground + p.y, place.org.y - fx * p.x + fz * p.z, 1.0)).xyz;
      }
`;

export class Emotes {
  /** The marks, and people's breath in the cold: a mesh each, on the same figures. */
  readonly mesh: THREE.Mesh;
  readonly breath: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly breathMaterial: THREE.ShaderMaterial;
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly breathGeo = new THREE.InstancedBufferGeometry();
  private attrs: THREE.InstancedBufferAttribute[] = [];
  private cap = 0;
  private count = 0;
  private held: Mark | 'each' | null = null;
  private shown = true;
  private share = EMOTE_RATE;
  private chosen: EmoteLooks = EMOTE_LOOKS;

  /** `mob`: the mob's material (people.ts ghostMaterial), whose clock, joints and settings these follow. */
  constructor(mob: THREE.ShaderMaterial) {
    const joints = mob.uniforms.tJoints.value as THREE.DataTexture;
    const shared: Record<string, THREE.IUniform> = {};
    // (One the mob's material doesn't have gets a value of its own: noon, dry, spring, a day's light, no lamps.)
    const own: Record<(typeof SHARED)[number], unknown> = { uTime: 0, uStay: 0, uHour: 12, uRain: 0, uSeason: 0, uUmbrella: 0, uStill: 0, tJoints: joints, uHemiSky: new THREE.Color(1, 1, 1), tLight: null, uLightRect: new THREE.Vector4(0, 0, 1, 1), uLightFade: new THREE.Vector2(0, 0), uLightGain: 0, uEmoteRate: 0, uEmoteForce: -1, uEmoteLooks: new THREE.Vector3(), uEmoteRow: new THREE.Vector4(0, 1, 0, 0) };
    for (const name of SHARED) shared[name] = mob.uniforms[name] ?? { value: own[name] };
    const uHead = { value: HEAD_ROWS.map(() => HEAD_DEFAULT) };
    const tEmotes = { value: emoteAtlas() };
    const head = headGlsl(joints.image.width, joints.image.height);
    const cell = (m: string): string => `(vec2(float(${m} - (${m} / ${COLS}) * ${COLS}), float(${m} / ${COLS})) + vec2(vCell.x, 1.0 - vCell.y)) / vec2(${COLS}.0, ${ROWS}.0)`;
    const blend = {
      transparent: true,
      depthWrite: false,
      // (The scene's alpha is left as it is: water marks its pixels there for the reflections, real/ssr.ts.)
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    } as const;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        ...shared,
        tEmotes,
        uHead,
        uReach: { value: EMOTE_REACH },
      },
      fog: true,
      ...blend,
      vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      uniform vec3 uHemiSky;
      uniform float uReach;
      varying vec2 vUv;
      varying vec2 vCell;
      varying vec3 vReveal;
      varying float vAlpha;
      varying float vGain;
      varying float vTwinkle;
      ${head}
      ${EMOTE_GLSL}
      // right, up, size, toward the viewer (head heights); and where it's hung.
      const vec4 PLACE[${MARKS.length}] = vec4[${MARKS.length}](${MARKS.map((m) => `vec4(${PLACE[m].slice(0, 4).map((v) => v.toFixed(3)).join(', ')})`).join(', ')});
      const int HUNG[${MARKS.length}] = int[${MARKS.length}](${MARKS.map((m) => PLACE[m][4]).join(', ')});
      void main() {
        // (Nothing to show: every corner at one point outside the view.)
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        vAlpha = 0.0;
        vGain = 1.0;
        vUv = vec2(0.0);
        vCell = vec2(0.0);
        vReveal = vec3(2.0);
        vTwinkle = -1.0;
        float t = uTime;
        int body = int(aPose.x + 0.5);
        float seed = aFig.w;
        float r = fract(sin(dot(aFig.xy, vec2(12.9898, 78.233))) * 43758.5453);
        // Whether this figure is emoting now (real/emoteGlsl.ts), u seconds into it of D.
        EmoteSlot slot = emoteSlot(t, r, seed, aFig.y);
        if (!slot.on) return;
        float u = slot.u;
        float D = slot.D;
        bool forced = slot.forced;
        float env = forced ? 1.0 : smoothstep(0.0, 0.14, u) * (1.0 - smoothstep(D - 0.4, D, u));

        MobPlace place = mobPlace(t, body, seed);
        if (place.fade < 0.02) return;
        int P = int(aPose.y + 0.5);
        if (place.crosser && !place.moving) P = 0;
        if (P == 1 && !place.moving && seed >= 0.0) P = 0;

        // The head, its middle in the world, and how it's turned to the viewer.
        Head h = headOf(t, body, r, P, place.moving, place.phase);
        float H = h.H;
        vec3 wp = inWorld(headPoint(h, vec3(0.0, 0.5, 0.08)), place);
        float d = distance(wp, cameraPosition);
        // Near the viewer only, and gone as you walk into someone (as they are).
        float alpha = env * place.fade * (seed < -1.5 ? 1.0 : smoothstep(0.6, 1.4, d)) * (1.0 - smoothstep(0.8 * uReach, uReach, d));
        if (alpha < 0.01) return;
        vec3 face = normalize(inWorld(headPoint(h, vec3(0.0, 0.5, 1.08)), place) - wp);
        float facing = dot(normalize(cameraPosition - wp), face);

        // Which mark. One on the face is the figure's own (the mob's material draws it): only from behind, where a face
        // can't be seen, hearts and stars for eyes are the mark over the head instead.
        int m = emoteMark(slot, r, body, P, place.moving, aFig.x);
        if (HUNG[m] == ${ON_FACE}) {
          if (forced || facing > 0.0 || (m != ${mk('heartEyes')} && m != ${mk('starEyes')})) return;
          alpha *= 1.0 - smoothstep(-0.3, 0.0, facing);
          m = m == ${mk('heartEyes')} ? ${mk('heartOver')} : ${mk('starOver')};
        }

        // How it moves. life: 0 to 1 through its time; pop: it springs up a little over size and settles.
        float life = clamp(u / D, 0.0, 1.0);
        float q = clamp(u / 0.3, 0.0, 1.0);
        float pop = q * (1.0 + 2.4 * (1.0 - q));
        vec2 off = PLACE[m].xy;
        vec2 size = vec2(PLACE[m].z * pop);
        float rot = 0.0;
        float grow = 1.0 + ${EMOTE_GROW.toFixed(3)} * max(d - 3.0, 0.0);
        // (Half of them on the other side of the head.)
        float flip = hh(r, 4.3) < 0.5 ? -1.0 : 1.0;
        if (HUNG[m] == ${AT_MOUTH}) {
          // A sigh: let out at the mouth, forward and down, spreading and thinning as it goes; drawn along its way.
          float su = forced ? mod(t + r * 3.0, ${(SIGH + 0.5).toFixed(2)}) : u;
          float go = clamp(su / ${SIGH.toFixed(2)}, 0.0, 1.0);
          float eased = 1.0 - (1.0 - go) * (1.0 - go);
          vec3 mouth = headPoint(h, vec3(0.0, 0.5 + off.y, 0.36));
          vec3 way = headPoint(h, vec3(0.0, 0.5 + off.y - 0.55, 1.26)) - mouth;
          wp = inWorld(mouth + way * (0.22 + 0.85 * eased), place);
          vec2 seen = (viewMatrix * vec4(inWorld(mouth + way, place) - inWorld(mouth, place), 0.0)).xy;
          rot = atan(seen.y, seen.x);
          off = vec2(0.0);
          size = PLACE[m].z * vec2(0.55 + 0.75 * eased, 0.45 + 0.5 * eased);
          alpha *= smoothstep(0.0, 0.12, go) * (1.0 - smoothstep(0.5, 1.0, go)) * 0.9;
          grow = mix(1.0, grow, 0.5);
        } else if (m == ${mk('sweat')}) {
          // Running down the side of the head.
          off.y -= 0.34 * smoothstep(0.08, 1.0, life);
          size = vec2(PLACE[m].z * mix(1.0, pop, 0.5));
        } else if (m == ${mk('anger')}) {
          // Throbbing.
          size *= 1.0 + 0.16 * pow(abs(sin(u * 7.0)), 3.0);
        } else if (m == ${mk('exclaim')} || m == ${mk('shock')}) {
          // A start: it jumps.
          off.y += 0.3 * abs(sin(u * 9.0)) * exp(-u * 2.6);
        } else if (m == ${mk('question')}) {
          rot = 0.2 * sin(u * 3.2);
        } else if (m == ${mk('heartOver')}) {
          // Beating, drifting up.
          size *= 1.0 + 0.16 * pow(abs(sin(u * 4.4)), 6.0);
          off.y += 0.22 * life;
        } else if (m == ${mk('heartRising')}) {
          // One after another from the head, floating up.
          size = vec2(PLACE[m].z);
          off += vec2(0.06 * sin(u * 2.4), 0.3 * life);
          vReveal.z = 0.25 + 1.1 * smoothstep(0.0, 0.5, life);
        } else if (m == ${mk('starOver')}) {
          // Twinkling.
          size *= 0.88 + 0.16 * sin(u * 9.0);
          rot = 0.2 * sin(u * 5.0);
        } else if (m == ${mk('starRound')}) {
          // Each in turn (the fragment shader), the ring turning a little.
          size = vec2(PLACE[m].z);
          rot = 0.25 * sin(u * 1.3);
          vTwinkle = u;
          flip = 1.0;
        } else if (m == ${mk('note')}) {
          // Humming: it sways as it rises.
          off += vec2(0.12 * sin(u * 4.0), 0.3 * life);
          rot = 0.25 * sin(u * 4.0 + 1.0);
        } else if (m == ${mk('sleep')}) {
          // One Z after another, floating off.
          off += vec2(0.12, 0.2) * life;
          size = vec2(PLACE[m].z * (0.85 + 0.25 * life));
          vReveal.x = u < 0.5 ? 0.33 : u < 1.0 ? 0.56 : 2.0;
        } else if (m == ${mk('dots')}) {
          // A dot at a time.
          size = vec2(PLACE[m].z);
          vReveal.x = u < 0.45 ? 0.42 : u < 0.9 ? 0.58 : 2.0;
        } else if (m == ${mk('gloom')}) {
          // The lines come down over the brow.
          size = vec2(PLACE[m].z);
          vReveal.y = 0.2 + 1.6 * smoothstep(0.0, 0.45, life);
          flip = 1.0;
        } else if (m == ${mk('fluster')}) {
          size *= 1.0 + 0.1 * sin(u * 18.0);
          off += 0.03 * vec2(sin(u * 23.0), cos(u * 19.0));
        }
        off.x *= flip;

        // A billboard there, brought toward the viewer (the ones on the head stand in front of it), larger with
        // distance so it still reads (and further out from the head by as much; the ones on the head grow half as
        // much).
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        mvPosition.xyz -= normalize(mvPosition.xyz) * PLACE[m].w * H;
        if (PLACE[m].w > 0.45) grow = mix(1.0, grow, 0.5);
        float cr = cos(rot), sr = sin(rot);
        vec2 corner = position.xy * size;
        mvPosition.xy += (off + vec2(cr * corner.x - sr * corner.y, sr * corner.x + cr * corner.y)) * grow * H;
        gl_Position = projectionMatrix * mvPosition;
        vCell = position.xy + 0.5;
        vUv = ${cell('m')};
        vAlpha = alpha;
        // Dimmer at night (by the sky's light on the mob), so they don't glow in a dark street.
        vGain = mix(0.7, 0.95, smoothstep(0.02, 0.5, dot(uHemiSky, vec3(0.2126, 0.7152, 0.0722))));
        #include <fog_vertex>
      }`,
      fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform sampler2D tEmotes;
      varying vec2 vUv;
      varying vec2 vCell;
      varying vec3 vReveal;
      varying float vAlpha;
      varying float vGain;
      varying float vTwinkle;
      void main() {
        vec4 c = texture2D(tEmotes, vUv);
        // (What's shown of it so far: from the left, from the top, from the bottom.)
        float a = c.a * vAlpha * (1.0 - smoothstep(vReveal.x - 0.02, vReveal.x + 0.02, vCell.x)) * (1.0 - smoothstep(vReveal.y - 0.04, vReveal.y + 0.04, 1.0 - vCell.y)) * (1.0 - smoothstep(vReveal.z - 0.04, vReveal.z + 0.04, vCell.y));
        // (Sparkles round a head: each fifth of the circle in its turn.)
        if (vTwinkle >= 0.0) {
          vec2 q = vCell - 0.5;
          a *= 0.35 + 0.65 * abs(sin(vTwinkle * 2.4 + floor(atan(q.y, q.x) / 1.2566 + 5.0) * 2.2));
        }
        if (a < 0.004) discard;
        gl_FragColor = vec4(c.rgb * vGain, a);
        #include <fog_fragment>
      }`,
    });
    this.breathMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        ...shared,
        tEmotes,
        uHead,
        // How cold (0 to 1: district/forecast.ts coldBreath).
        uCold: { value: 0 },
      },
      fog: true,
      ...blend,
      vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      uniform vec3 uHemiSky;
      uniform float uCold;
      uniform sampler2D tLight;
      uniform vec4 uLightRect;
      uniform vec2 uLightFade;
      uniform float uLightGain;
      varying vec2 vUv;
      varying vec2 vCell;
      varying float vAlpha;
      varying vec3 vColor;
      ${head}
      void main() {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        vAlpha = 0.0;
        vUv = vec2(0.0);
        vCell = vec2(0.0);
        vColor = vec3(0.0);
        float t = uTime;
        int body = int(aPose.x + 0.5);
        float seed = aFig.w;
        float r = fract(sin(dot(aFig.xy, vec2(12.9898, 78.233))) * 43758.5453);
        // A puff from the top of each breath (the mob's chest: sin(t * 1.4 + r * 20)); someone walking breathes a little
        // faster and harder, by how fast they go.
        float pace = aWalk.z > 0.0 ? 1.0 + 0.22 * min(aWalk.z, 3.0) : 1.0;
        float w = 1.4 * pace;
        float go = fract((t * w + r * 20.0 - 1.5708) / 6.2832) * 6.2832 / w / ${BREATH_LASTS.toFixed(2)};
        if (go >= 1.0 || uCold < 0.01) return;

        MobPlace place = mobPlace(t, body, seed);
        if (place.fade < 0.02) return;
        int P = int(aPose.y + 0.5);
        if (place.crosser && !place.moving) P = 0;
        if (P == 1 && !place.moving && seed >= 0.0) P = 0;
        Head h = headOf(t, body, r, P, place.moving, place.phase);

        // From the mouth forward and a little up, slowing, spreading and thinning.
        float eased = 1.0 - (1.0 - go) * (1.0 - go);
        vec3 mouth = headPoint(h, vec3(0.0, 0.5 + ${PLACE.vapour[1].toFixed(2)}, 0.36));
        vec3 way = headPoint(h, vec3(0.0, 0.5 + ${PLACE.vapour[1].toFixed(2)} - 0.1, 1.36)) - mouth;
        vec3 wp = inWorld(mouth + way * (0.25 + 0.95 * eased * pace) + vec3(0.0, 0.3 * h.H * go * go, 0.0), place);
        float d = distance(wp, cameraPosition);
        float alpha = uCold * place.fade * (seed < -1.5 ? 1.0 : smoothstep(0.5, 1.2, d)) * (1.0 - smoothstep(${(0.7 * BREATH_REACH).toFixed(1)}, ${BREATH_REACH.toFixed(1)}, d));
        alpha *= 0.6 * min(pace, 1.5) * smoothstep(0.0, 0.1, go) * (1.0 - smoothstep(0.3, 1.0, go));
        if (alpha < 0.004) return;

        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        float rot = r * 6.2832 + 0.5 * go;
        float cr = cos(rot), sr = sin(rot);
        vec2 corner = position.xy * ${PLACE.vapour[2].toFixed(2)} * (0.5 + 1.3 * eased) * h.H;
        mvPosition.xy += vec2(cr * corner.x - sr * corner.y, sr * corner.x + cr * corner.y);
        gl_Position = projectionMatrix * mvPosition;
        vCell = position.xy + 0.5;
        vUv = ${cell(String(mk('vapour')))};
        vAlpha = alpha;
        // Lit by the sky, and at night by the street (the lightmap), so it shows against the dark under a lamp.
        vec3 lamp = texture2D(tLight, (wp.xz - uLightRect.xy) * uLightRect.zw).rgb * uLightGain;
        if (uLightFade.y > 0.0) {
          vec2 dc = abs(wp.xz - cameraPosition.xz);
          lamp *= 1.0 - smoothstep(uLightFade.x, uLightFade.y, max(dc.x, dc.y));
        }
        // (Brighter than what's behind it: vapour scatters the light on through.)
        vColor = min(uHemiSky * 1.3 + lamp * 1.8 + 0.04, vec3(2.2));
        #include <fog_vertex>
      }`,
      fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform sampler2D tEmotes;
      varying vec2 vUv;
      varying vec2 vCell;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        float a = texture2D(tEmotes, vUv).a * vAlpha;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vColor, a);
        #include <fog_fragment>
      }`,
    });
    const quads = (geo: THREE.InstancedBufferGeometry, material: THREE.Material, name: string): THREE.Mesh => {
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      geo.instanceCount = 0;
      const m = new THREE.Mesh(geo, material);
      m.name = name;
      // The figures are everywhere in range (the vertex shader places them): never culled as one box.
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.renderOrder = 3;
      m.visible = false;
      return m;
    };
    this.mesh = quads(this.geo, this.material, 'emotes');
    this.breath = quads(this.breathGeo, this.breathMaterial, 'emotes.breath');
    this.looks = EMOTE_LOOKS;
    this.measure();
    this.show();
  }

  /**
   * Measures each body's head (its joint to the top of its hair) as the generation now set builds it (people.ts
   * setMobShape). Again after a change of generation or of the heads' size.
   */
  measure(): void {
    const joints = this.material.uniforms.tJoints.value as THREE.DataTexture;
    const data = joints.image.data as Float32Array;
    const head = this.material.uniforms.uHead.value as number[];
    HEAD_ROWS.forEach((spec, row) => {
      // (The classic generation has no teens: their rows aren't used.)
      if (spec.outfit && getMobShape() !== 'shaped') return;
      head[row] = figureSize(spec).height - data[(row * joints.image.width + HEAD) * 4 + 1];
    });
  }

  /** Whether the marks are drawn (the breath has its own say: `cold`). */
  get on(): boolean {
    return this.shown;
  }
  set on(v: boolean) {
    this.shown = v;
    this.show();
  }

  /**
   * A row of figures holding the marks up in order (the showroom's): its first figure's x, the step between them,
   * its z and how deep it is; with it, they're the ones that emote, not the figures that come and go. null: the crowd.
   */
  set row(row: { readonly x0: number; readonly step: number; readonly z: number; readonly depth: number } | null) {
    (this.material.uniforms.uEmoteRow.value as THREE.Vector4).set(row?.x0 ?? 0, row?.step ?? 1, row?.z ?? 0, row?.depth ?? 0);
  }

  /** How cold it is for people's breath to show: 0 none (it isn't drawn), 1 all of it (coldBreath). */
  get cold(): number {
    return this.breathMaterial.uniforms.uCold.value as number;
  }
  set cold(v: number) {
    this.breathMaterial.uniforms.uCold.value = v;
    this.show();
  }

  /** Which look the blush, the hearts and the stars have. */
  get looks(): EmoteLooks {
    return this.chosen;
  }
  set looks(l: EmoteLooks) {
    this.chosen = l;
    (this.material.uniforms.uEmoteLooks.value as THREE.Vector3).set(BLUSH_LOOKS.indexOf(l.blush), HEART_LOOKS.indexOf(l.hearts), STAR_LOOKS.indexOf(l.stars));
  }

  /**
   * Everyone holding a mark up all the time, for a look at them: that one, or 'each' by where they stand (along a
   * row, in the marks' order); null: by the clock.
   */
  get force(): Mark | 'each' | null {
    return this.held;
  }
  set force(m: Mark | 'each' | null) {
    this.held = m;
    this.show();
  }

  /** The share of a figure's slots with an emote in them (EMOTE_RATE). */
  get rate(): number {
    return this.share;
  }
  set rate(v: number) {
    this.share = v;
    this.show();
  }

  /** The figures they're drawn for: arrays of figures' numbers (FIGURE_STRIDE each), `count` figures in all. */
  fill(chunks: Iterable<Float32Array>, count: number): void {
    this.count = count;
    this.geo.instanceCount = count;
    this.breathGeo.instanceCount = count;
    this.show();
    if (count === 0) return;
    if (count > this.cap) {
      this.cap = Math.max(64, Math.ceil(count * 1.5));
      // (One set of buffers for both meshes.)
      this.attrs = FIGURE_ATTRS.map((spec) => {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * spec.at.length), spec.at.length);
        a.setUsage(THREE.DynamicDrawUsage);
        this.geo.setAttribute(spec.name, a);
        this.breathGeo.setAttribute(spec.name, a);
        return a;
      });
    }
    let i = 0;
    for (const f of chunks) {
      for (let k = 0; k < f.length && i < count; k += FIGURE_STRIDE, i++) {
        FIGURE_ATTRS.forEach((spec, j) => {
          const arr = this.attrs[j].array as Float32Array;
          const m = spec.at.length;
          for (let c = 0; c < m; c++) arr[i * m + c] = f[k + spec.at[c]];
        });
      }
    }
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, count * a.itemSize);
      a.needsUpdate = true;
    }
  }

  private show(): void {
    this.mesh.visible = this.shown && this.count > 0;
    this.breath.visible = this.cold > 0.01 && this.count > 0;
    // (The marks on faces are the mob material's to draw: off with the rest, through the uniforms they share.)
    const m = this.held;
    this.material.uniforms.uEmoteRate.value = this.shown ? this.share : 0;
    this.material.uniforms.uEmoteForce.value = !this.shown || m === null ? -1 : m === 'each' ? -2 : mk(m);
  }
}
