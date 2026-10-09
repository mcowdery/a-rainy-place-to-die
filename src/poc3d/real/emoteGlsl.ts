import * as THREE from 'three';

/**
 * The mob's emotes, the part two shaders share: who is showing what, and when. The marks over a head, the sigh and
 * the breath are billboards drawn after the figures (real/emotes.ts); the marks on a face (a blush, heart or star
 * eyes) are part of the figure's own draw (small quads on the head's bone, real/mobShape.ts, drawn by the mob's
 * material in real/people.ts), so they turn, nod and bob with the head and are hidden when it turns away. Both
 * shaders ask the GLSL here, so they agree. (Nothing here imports the mob or the billboards: both import this.)
 */

/** What a figure can feel. */
export const EMOTES = ['sweat', 'anger', 'blush', 'exclaim', 'question', 'heart', 'note', 'sleep', 'sigh', 'dots', 'sparkle', 'shock', 'gloom', 'fluster'] as const;
export type Emote = (typeof EMOTES)[number];

/**
 * What's drawn: a mark each. The blush, the heart and the sparkle have three looks each (EmoteLooks picks one),
 * side by side here. The billboards' atlas has a cell a mark, in this order (`vapour` is the breath's, not an
 * emote's; the face's marks are drawn on the face instead and leave theirs empty).
 */
export const MARKS = ['sweat', 'anger', 'exclaim', 'question', 'shock', 'blushLines', 'blushFlush', 'blushBoth', 'heartOver', 'heartEyes', 'heartRising', 'starOver', 'starEyes', 'starRound', 'note', 'sleep', 'sigh', 'dots', 'gloom', 'fluster', 'vapour'] as const;
export type Mark = (typeof MARKS)[number];
/** The marks a figure can hold up (every one but the breath's), with a name for a label. */
export const EMOTE_MARKS: readonly { readonly mark: Mark; readonly label: string }[] = [
  { mark: 'sweat', label: 'sweat' },
  { mark: 'anger', label: 'anger' },
  { mark: 'exclaim', label: '!' },
  { mark: 'question', label: '?' },
  { mark: 'shock', label: '!?' },
  { mark: 'blushLines', label: 'blush · lines' },
  { mark: 'blushFlush', label: 'blush · flush' },
  { mark: 'blushBoth', label: 'blush · both' },
  { mark: 'heartOver', label: 'heart · over head' },
  { mark: 'heartEyes', label: 'heart · eyes' },
  { mark: 'heartRising', label: 'heart · rising' },
  { mark: 'starOver', label: 'star · over head' },
  { mark: 'starEyes', label: 'star · eyes' },
  { mark: 'starRound', label: 'star · round head' },
  { mark: 'note', label: 'note' },
  { mark: 'sleep', label: 'zzz' },
  { mark: 'sigh', label: 'sigh' },
  { mark: 'dots', label: '...' },
  { mark: 'gloom', label: 'gloom' },
  { mark: 'fluster', label: 'fluster' },
];
export const idx = (e: Emote): number => EMOTES.indexOf(e);
export const mk = (m: Mark): number => MARKS.indexOf(m);
/** An emote's mark (its first look's). */
const MARK_OF: Record<Emote, Mark> = { sweat: 'sweat', anger: 'anger', blush: 'blushLines', exclaim: 'exclaim', question: 'question', heart: 'heartOver', note: 'note', sleep: 'sleep', sigh: 'sigh', dots: 'dots', sparkle: 'starOver', shock: 'shock', gloom: 'gloom', fluster: 'fluster' };

/** The looks to choose between (the debug menu's People tab): how the blush, the hearts and the stars are drawn. */
export const BLUSH_LOOKS = ['lines', 'flush', 'both'] as const;
export const HEART_LOOKS = ['over', 'eyes', 'rising'] as const;
export const STAR_LOOKS = ['over', 'eyes', 'round'] as const;
export interface EmoteLooks {
  /** Hatch lines on the cheeks, the whole face flushed red, or the flush with the lines over it. */
  readonly blush: (typeof BLUSH_LOOKS)[number];
  /** A heart over the head, hearts for eyes (and one over the head, seen from behind), or small hearts rising off the head. */
  readonly hearts: (typeof HEART_LOOKS)[number];
  /** A sparkle over the head, stars for eyes (and one over the head, seen from behind), or small sparkles round the head. */
  readonly stars: (typeof STAR_LOOKS)[number];
}
export const EMOTE_LOOKS: EmoteLooks = { blush: 'both', hearts: 'eyes', stars: 'over' };

/**
 * What people show, by what they're doing (weights): walking, standing about, talking, on the phone, hands in
 * pockets, waving, holding someone's hand, and standing about late at night (23:00 to 05:00, more often than not).
 * A child's anger, gloom and sighs are a note, a sparkle and a "?" instead.
 */
export const EMOTE_CONTEXTS = ['walk', 'stand', 'talk', 'phone', 'pockets', 'wave', 'hold', 'late'] as const;
export type EmoteContext = (typeof EMOTE_CONTEXTS)[number];
export const EMOTE_MIX: Record<EmoteContext, Partial<Record<Emote, number>>> = {
  walk: { note: 5, dots: 2, sigh: 2, sweat: 2, question: 1.5, exclaim: 1.5, sparkle: 1.5, gloom: 1, anger: 1, fluster: 1, heart: 0.5, blush: 0.5 },
  stand: { dots: 3, sigh: 3.5, sleep: 2, question: 2, sweat: 2, gloom: 1.5, note: 1.5, blush: 1, anger: 1, exclaim: 1 },
  talk: { exclaim: 3, note: 2.5, question: 2.5, sweat: 2, sparkle: 2, anger: 1.5, blush: 1.5, shock: 1.5, heart: 1, dots: 1, fluster: 1 },
  phone: { question: 3, sweat: 2.5, exclaim: 2, dots: 2, anger: 2, heart: 1.5, shock: 1.5, sigh: 1.5, blush: 1, sparkle: 1, fluster: 1 },
  pockets: { sigh: 3.5, dots: 3, sleep: 2.5, gloom: 2, note: 2, question: 1, anger: 0.5 },
  wave: { exclaim: 3, note: 3, sparkle: 3, heart: 2, blush: 1 },
  hold: { heart: 4, blush: 3, note: 2, sparkle: 2, sweat: 0.5 },
  late: { sleep: 6, sigh: 3, dots: 2, gloom: 1.5, sweat: 0.5 },
};

/**
 * How often: each figure's time is cut into slots of SLOT (s, its own length in that range), an emote in a share
 * `rate` of them (EMOTE_RATE), shown for LASTS (s) from the slot's start. About one person in forty at a time.
 */
export const EMOTE_SLOT: readonly [number, number] = [20, 40];
export const EMOTE_RATE = 0.25;
export const EMOTE_LASTS: readonly [number, number] = [2.4, 3.8];
/** How far from the viewer they show (m): they fade out over the last fifth. */
export const EMOTE_REACH = 42;

/** The inks (sRGB): the one ivory, the crimson of anger and hearts, a blush's rouge, and the keyline's dark. */
export const IVORY = '#ece5d3';
export const CRIMSON = '#ad2c35';
export const ROUGE = '#a8323e';
export const DARK: readonly [number, number, number] = [18, 16, 22];
/** A flushed face's red (linear), which the head's skin is turned toward. */
const FLUSH = 'vec3(0.34, 0.035, 0.05)';
/** A colour for a shader: linear, from sRGB. */
const glslColor = (c: string | readonly [number, number, number]): string => {
  const rgb = typeof c === 'string' ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : c;
  return `vec3(${rgb.map((v) => ((v / 255) <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4).toFixed(4)).join(', ')})`;
};

/**
 * The emotes' settings, as uniforms: the mob's material has them (ghostMaterial), and the billboards share its
 * objects. As they start, nobody emotes: the billboards (Emotes) turn them on for the material they're given.
 */
export const emoteUniforms = (): Record<'uEmoteRate' | 'uEmoteForce' | 'uEmoteLooks' | 'uEmoteRow', THREE.IUniform> => ({
  // The share of a figure's slots with an emote in them (0: none).
  uEmoteRate: { value: 0 },
  // -1: by the clock. -2: everyone holds a mark up (along a row, uEmoteRow, each the next; in a crowd, any). 0 and up: everyone that mark.
  uEmoteForce: { value: -1 },
  // Which look the blush, the hearts and the stars have (EmoteLooks: 0 to 2 each).
  uEmoteLooks: { value: new THREE.Vector3(BLUSH_LOOKS.indexOf(EMOTE_LOOKS.blush), HEART_LOOKS.indexOf(EMOTE_LOOKS.hearts), STAR_LOOKS.indexOf(EMOTE_LOOKS.stars)) },
  // A row of figures holding the marks up in order (the showroom's): its first figure's x, the step between them,
  // its z, and how deep it is. With no depth (the city), who emotes is the crowd: the figures that come and go.
  uEmoteRow: { value: new THREE.Vector4(0, 1, 0, 0) },
});

/** GLSL: a context's emote for a hash h in [0, 1). */
function mixGlsl(mix: Partial<Record<Emote, number>>): string {
  const entries = Object.entries(mix) as [Emote, number][];
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let acc = 0;
  return entries
    .map(([e, w], i) => {
      acc += w / total;
      return i === entries.length - 1 ? `${idx(e)}` : `h < ${acc.toFixed(4)} ? ${idx(e)} : `;
    })
    .join('');
}

/**
 * GLSL (vertex): who is emoting, and with what. `emoteSlot` is cheap (a figure's slot now, and whether there's an
 * emote in it); `emoteMark` its mark (MARKS), by what the figure is doing. Needs `uHour` declared.
 */
export const EMOTE_GLSL = /* glsl */ `
      uniform float uEmoteRate;
      uniform float uEmoteForce;
      uniform vec3 uEmoteLooks;
      uniform vec4 uEmoteRow;
      float emoteHash(float k, float r) { return fract(sin(k * 12.9898 + r * 78.233) * 43758.5453); }
      // A context's emote (EMOTE_MIX) for a hash.
      int pickEmote(int c, float h) {
        int e = ${idx('dots')};
        ${EMOTE_CONTEXTS.map((c, i) => `${i ? 'else ' : ''}if (c == ${i}) e = ${mixGlsl(EMOTE_MIX[c])};`).join('\n        ')}
        return e;
      }
      // A figure's slot now: whether it's emoting (held up for a look, or by the clock), which slot it is (k), how
      // far into it (u, seconds) and how long the emote lasts (D). r: the figure's own number; seed: under 0, a
      // figure that never comes and goes (a set piece's, a story's: not the crowd); z: where it stands.
      struct EmoteSlot { bool on; bool forced; float k; float u; float D; };
      EmoteSlot emoteSlot(float t, float r, float seed, float z) {
        float S = ${EMOTE_SLOT[0].toFixed(1)} + ${(EMOTE_SLOT[1] - EMOTE_SLOT[0]).toFixed(1)} * emoteHash(r, 1.7);
        float tt = t / S + r * 53.0;
        float k = floor(tt);
        float u = fract(tt) * S;
        float D = ${EMOTE_LASTS[0].toFixed(2)} + ${(EMOTE_LASTS[1] - EMOTE_LASTS[0]).toFixed(2)} * emoteHash(k, r + 0.31);
        bool forced = uEmoteForce < -1.5 || uEmoteForce > -0.5;
        bool on = uEmoteRow.w > 0.0 ? abs(z - uEmoteRow.z) < uEmoteRow.w : seed >= 0.0;
        if (forced) {
          // Its motion over and over.
          D = 3.0;
          u = 1.0 + mod(t + r * 3.0, 2.0);
        } else on = on && emoteHash(k, r) < uEmoteRate && u < D;
        return EmoteSlot(on, forced, k, u, D);
      }
      // Its mark: by what the figure is doing (P: its pose as the mob's shader settles it), in the looks chosen.
      // x: where it stands along a row holding them up.
      int emoteMark(EmoteSlot s, float r, int body, int P, bool moving, float x) {
        int m = 0;
        if (uEmoteForce > -0.5) m = int(uEmoteForce + 0.5);
        else if (s.forced) m = uEmoteRow.w > 0.0 ? int(mod(floor((x - uEmoteRow.x) / uEmoteRow.y + 0.5), ${EMOTE_MARKS.length}.0)) : int(emoteHash(r, 9.1) * ${EMOTE_MARKS.length - 0.01});
        else {
          int c = P == 6 ? 6 : moving || P == 1 ? 0 : P == 0 ? 1 : P == 2 ? 2 : P == 3 ? 3 : P == 5 ? 5 : 4;
          bool late = uHour >= 23.0 || uHour < 5.0;
          if ((c == 1 || c == 4) && late && emoteHash(s.k, r + 0.77) < 0.6) c = 7;
          int e = pickEmote(c, emoteHash(s.k, r + 0.53));
          if (body == 2) e = e == ${idx('anger')} ? ${idx('note')} : e == ${idx('gloom')} ? ${idx('sparkle')} : e == ${idx('sigh')} ? ${idx('question')} : e;
          const int MARK[${EMOTES.length}] = int[${EMOTES.length}](${EMOTES.map((e) => mk(MARK_OF[e])).join(', ')});
          m = MARK[e];
          if (e == ${idx('blush')}) m += int(uEmoteLooks.x + 0.5);
          else if (e == ${idx('heart')}) m += int(uEmoteLooks.y + 0.5);
          else if (e == ${idx('sparkle')}) m += int(uEmoteLooks.z + 0.5);
        }
        return m;
      }
      // How much of a face's mark shows (it comes on slowly and goes as the emote ends).
      float emoteFace(EmoteSlot s) { return s.forced ? 1.0 : smoothstep(0.0, 0.6, s.u) * (1.0 - smoothstep(s.D - 0.4, s.D, s.u)); }
`;

/** A face mark's quad in a template (real/mobShape.ts): its shade is FACE_MARK plus which it is, its normal (u, v, which). */
export const FACE_MARK = 2100;
export const FACE_EYE = 1, FACE_CHEEK = 2;

/**
 * GLSL (the mob's vertex shader, in main once the pose P is settled): a face mark's quad shows its mark while the
 * figure's emote is one of the face's and is folded away otherwise, and the head's skin flushes. It sets vMark (uv
 * across the quad, the mark: 1 a heart, 2 a star, 3 hatching, 0 none; how much of it), vMarkFx (its beat, its light),
 * `folded` and `flushing`. Needs t, r, seed, body, P, moving, aShade, aBone, aFig, normal, uBlack, uHemiSky.
 */
export const FACE_VERTEX_GLSL = /* glsl */ `
        vMark = vec4(0.0);
        vMarkFx = vec2(1.0);
        float flushing = 0.0;
        bool folded = false;
        {
          float mtag = floor(aShade / 100.0 + 0.001);
          bool quad = mtag > 20.5;
          if (quad || (mtag > 0.5 && mtag < 1.5 && aBone.x > 1.5 && aBone.x < 2.5)) {
            EmoteSlot es = emoteSlot(t, r, seed, aFig.y);
            int em = -1;
            float amount = 0.0;
            if (es.on) {
              em = emoteMark(es, r, body, P, moving, aFig.x);
              amount = emoteFace(es);
            }
            if (quad) {
              float kind = 0.0;
              if (aShade - ${FACE_MARK}.0 < 1.5) kind = em == ${mk('heartEyes')} ? 1.0 : em == ${mk('starEyes')} ? 2.0 : 0.0;
              // (All black, there's no skin to redden: a flush is its lines.)
              else kind = em == ${mk('blushLines')} || em == ${mk('blushBoth')} || (em == ${mk('blushFlush')} && uBlack > 0.5) ? 3.0 : 0.0;
              folded = kind < 0.5;
              vMark = vec4(normal.xy, kind, amount);
              // A heart beats, a star twinkles; and they're dimmer at night (by the sky's light on the mob).
              vMarkFx = vec2(kind < 1.5 ? 1.0 + 0.14 * pow(abs(sin(es.u * 4.4)), 6.0) : kind < 2.5 ? 0.92 + 0.1 * sin(es.u * 9.0) : 1.0, mix(0.7, 0.95, smoothstep(0.02, 0.5, dot(uHemiSky, vec3(0.2126, 0.7152, 0.0722)))));
            } else if (em == ${mk('blushFlush')} || em == ${mk('blushBoth')}) flushing = amount;
          }
        }
`;
/** GLSL: a head's skin colour `c` flushed (hp: the vertex from the head's joint, in its bind pose; sh: its shade). */
export const flushGlsl = (c: string, hp: string, sh: string): string => `mix(${c}, ${FLUSH} * ${sh}, 0.72 * flushing * smoothstep(0.02, 0.065, ${hp}.z) * (1.0 - smoothstep(0.1, 0.15, ${hp}.y)))`;

/**
 * GLSL (fragment): a mark painted on a face, inked like the billboards' (flat, a thin dark keyline): `faceMark(uv,
 * kind, beat)` gives its colour and how much of the quad it covers. kind: 1 a heart, 2 a four-pointed star, 3 a
 * cheek's hatching.
 */
export const FACE_MARK_GLSL = /* glsl */ `
      float markHeart(vec2 p) {
        p.x = abs(p.x);
        vec2 a = p - vec2(0.25, 0.75);
        vec2 b = p - vec2(0.0, 1.0);
        vec2 c = p - 0.5 * max(p.x + p.y, 0.0);
        return p.y + p.x > 1.0 ? length(a) - 0.3535534 : sqrt(min(dot(b, b), dot(c, c))) * sign(p.x - p.y);
      }
      vec4 faceMark(vec2 uv, float kind, float beat) {
        vec2 p = (uv * 2.0 - 1.0) / beat;
        float f = 1.0;
        vec3 ink = ${glslColor(IVORY)};
        float key = 0.07;
        if (kind < 1.5) {
          // A heart, its point down, slim.
          f = markHeart(vec2(p.x * 0.78, (p.y + 0.95) * 0.58));
          ink = ${glslColor(CRIMSON)};
        } else if (kind < 2.5) {
          // A four-pointed star, taller than wide, its sides drawn in.
          vec2 a = abs(p) / vec2(0.74, 0.97);
          f = (a.x + 0.24) * (a.y + 0.24) - 0.24 * 1.24;
        } else {
          // Four thin slanted strokes, pointed at their ends.
          float s = p.x - 0.42 * p.y;
          float c = floor(clamp(s, -0.999, 0.999) / 0.5) * 0.5 + 0.25;
          float y = p.y / 0.84;
          f = abs(s - c) - 0.105 * pow(max(1.0 - y * y, 0.0), 0.7);
          ink = ${glslColor(ROUGE)};
          key = 0.0;
        }
        // (In pixels from its edge: the edge a pixel wide, the keyline a share of the mark but never more than a pixel and a half.)
        float px = f / max(length(vec2(dFdx(f), dFdy(f))), 1e-5);
        float unit = 1.0 / max(length(vec2(dFdx(p.x), dFdy(p.x))), 1e-5);
        float line = min(key * unit, 1.5);
        return vec4(mix(${glslColor(DARK)}, ink, clamp(0.5 - px, 0.0, 1.0)), clamp(0.5 - (px - line), 0.0, 1.0));
      }
`;
