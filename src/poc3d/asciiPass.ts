import * as THREE from 'three';
import { isWide } from '../core/wide';
import { FACADE, SIGN_LETTERS, SURFACE } from './block';

/**
 * GPU ASCII pass, for comparison with three's CPU/DOM AsciiEffect.
 * 1. Render the scene into a small target: 2x2 texels per character cell (so 3D cost scales with
 *    the number of cells, not screen pixels).
 * 2. Fullscreen quad: per cell, pick a glyph and draw it from a glyph atlas texture, tinted by the
 *    scene colour (or mono).
 *    - Non-building surfaces: luminance -> RAMP.
 *    - Buildings: their material writes an integer code into alpha (see FACADE): surface type (pane /
 *      mullion / slab), a smooth 0-15 intensity (light, ground AO, distance) and a per-window variant.
 *      Each surface has its own ramp, so facades are near-fully filled but structured: panes are blocks
 *      of one dense glyph, mullions are blank columns, slabs are rows. Lit windows step denser/brighter.
 *      The storefront band (SHOP codes) draws sign letters, frames and glass in their own colours.
 * 3. Edges: where depth jumps between neighbouring cells, draw | - / \ oriented along the
 *    silhouette instead. Background (sky) cells are left blank. This is what makes shapes read.
 * 4. Text layer: signs are laid out on the CPU straight into a per-cell texture (glyph, colour, depth,
 *    brightness) at one cell per character, CJK as two cells, and depth-tested against the scene here, so
 *    signage stays legible at any distance and is hidden behind nearer buildings.
 * 5. Rain: falling streaks in blank cells when the atmosphere asks for it.
 */
const RAMP = ' .,:;-=+*xo#%&@';
const EDGES = '|-/\\';
/** Facade ramps, sparse -> dense. Letters/numbers carry the mass, like image-to-ASCII conversion. */
const PANE_RAMP = '.:+*xXZ08&';
const SLAB_RAMP = ':00';
/** Mullions are blank gap columns: the facade's structure comes from wide filled panes between them. */
const MULLION_RAMP = ' ';
/** Storefront band: frame, glass, alternate glass row, then sign letters (see FACADE.shop). */
const SHOP_GLYPHS = '8#:' + SIGN_LETTERS;
const GLYPHS = RAMP + EDGES + PANE_RAMP + SLAB_RAMP + MULLION_RAMP + SHOP_GLYPHS;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const F = FACADE;
const S = SURFACE;

const fragmentShader = /* glsl */ `
  #include <packing>
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform float uNear;
  uniform float uFar;
  uniform float uEdges;
  uniform float uRampCount;
  uniform sampler2D tGlyphs;
  uniform vec2 uCellPx;
  uniform vec2 uCells;
  uniform float uGlyphCount;
  uniform float uColor;
  uniform vec3 uBg;
  uniform vec2 uPane;    // (start index in atlas, length)
  uniform vec2 uSlab;
  uniform vec2 uMullion;
  uniform float uShopStart;
  uniform float uGlyphRoofLine;
  uniform sampler2D tText;
  uniform float uRain;
  uniform float uTime;
  uniform float uRainGlyph;
  float rawDepth(vec2 cell) { return texture2D(tDepth, (cell + 0.5) / uCells).x; }
  float viewDepth(vec2 cell) { return -perspectiveDepthToViewZ(rawDepth(cell), uNear, uFar); }
  float glyphFor(float l) { return floor(clamp(pow(l, 0.45) * 1.15, 0.0, 0.999) * uRampCount); }
  float pick(vec2 ramp, float x) { return ramp.x + clamp(floor(x), 0.0, ramp.y - 1.0); }
  void main() {
    vec2 cell = floor(gl_FragCoord.xy / uCellPx);
    vec2 local = fract(gl_FragCoord.xy / uCellPx);
    // Colour: average of the cell's 2x2 texels. Facade code: one exact texel (alpha can't be averaged).
    vec3 c = texture2D(tScene, (cell + 0.5) / uCells).rgb;
    vec4 t = texture2D(tScene, (cell * 2.0 + 1.5) / (uCells * 2.0));
    float code = floor(t.a * 255.0 + 0.5);
    // Scene target is linear; pow(l, 0.45) ~ perceptual lightness for picking glyph density.
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float idx = glyphFor(l);
    float level = mix(0.45, 1.0, sqrt(l));
    vec3 src = c;
    bool building = code < ${F.other}.0;
    if (code >= ${F.shop}.0 && building) {
      // Storefront band: fixed glyph per code, colour straight from the material.
      src = t.rgb;
      idx = uShopStart + code - ${F.shop}.0;
      level = code >= ${F.shop + 3}.0 ? 1.0 : code == ${F.shop}.0 ? 0.75 : 0.45;
    } else if (code >= ${F.base}.0 && building) {
      src = t.rgb;
      float k = code - ${F.base}.0;
      float it = mod(k, ${F.levels}.0) / ${F.levels - 1}.0;       // smooth intensity 0-1
      float sv = floor(k / ${F.levels}.0);
      float surf = floor(sv / ${F.variants}.0);
      float variant = mod(sv, ${F.variants}.0) - 1.0;               // -1, 0, +1 ramp steps per window
      if (surf == ${S.mullion}.0) {
        idx = pick(uMullion, it * uMullion.y);
        level = mix(0.2, 0.5, it);
      } else if (surf == ${S.slab}.0) {
        idx = pick(uSlab, it * uSlab.y);
        level = mix(0.25, 0.65, it);
      } else {
        bool lit = surf == ${S.paneLit}.0;
        idx = pick(uPane, it * (uPane.y - 2.0) + variant + (lit ? 2.0 : 0.0));
        level = lit ? 1.0 : mix(0.3, 0.8, it);
      }
    }
    // Ground and props sit back so buildings carry the image (the reference's street is mostly dark).
    if (!building) level *= 0.6;
    float sky = step(0.99999, rawDepth(cell));
    if (sky > 0.5) idx = 0.0;
    if (uEdges > 0.5) {
      // 1/depth is linear across any flat surface in screen space, so its second difference is ~0 on
      // walls, roads and roofs (even at grazing angles) and spikes only at silhouettes and creases.
      float ic = 1.0 / viewDepth(cell);
      float il = 1.0 / viewDepth(cell - vec2(1.0, 0.0));
      float ir = 1.0 / viewDepth(cell + vec2(1.0, 0.0));
      float id = 1.0 / viewDepth(cell - vec2(0.0, 1.0));
      float iu = 1.0 / viewDepth(cell + vec2(0.0, 1.0));
      float ax = abs(il + ir - 2.0 * ic) / ic;
      float ay = abs(id + iu - 2.0 * ic) / ic;
      float gx = ir - il;
      float gy = iu - id;
      if (max(ax, ay) > 0.12 && sky < 0.5) {
        // Buildings: only | and - (clean verticals like the reference). Ground: diagonals too, for perspective.
        // Buildings: '|' sides and '=' roof lines, like the reference.
        if (building) idx = ax >= ay ? uRampCount : uGlyphRoofLine;
        else if (ax > ay * 2.0) idx = uRampCount + 0.0;       // |
        else if (ay > ax * 2.0) idx = uRampCount + 1.0;       // -
        else idx = uRampCount + (gx * gy > 0.0 ? 3.0 : 2.0);  // backslash or slash
        level = building ? 0.8 : max(level, 0.5);
      }
    }
    // Text layer (signs): glyph+1, packed sRGB colour, view depth, brightness. Drawn unless the scene is
    // clearly nearer (the sign hangs just off its facade, so allow a little slack).
    vec4 tx = texture2D(tText, (cell + 0.5) / uCells);
    bool text = false;
    if (tx.r > 0.5) {
      float sceneDepth = sky > 0.5 ? 1e9 : viewDepth(cell);
      if (tx.b <= sceneDepth * 1.03 + 1.5) {
        text = true;
        idx = tx.r - 1.0;
        vec3 srgb = vec3(floor(tx.g / 65536.0), mod(floor(tx.g / 256.0), 256.0), mod(tx.g, 256.0)) / 255.0;
        src = pow(srgb, vec3(2.2));
        level = tx.a;
      }
    }
    // Rain: streaks falling through blank cells.
    if (!text && idx == 0.0 && uRain > 0.0) {
      float colSeed = fract(sin(cell.x * 12.9898) * 43758.5453);
      float drop = floor(cell.y * 0.5 + uTime * 9.0 + colSeed * 97.0);
      if (fract(sin(dot(vec2(cell.x, drop), vec2(12.9898, 78.233))) * 43758.5453) < uRain) {
        idx = uRainGlyph;
        src = vec3(0.3, 0.42, 0.6);
        level = 0.6;
      }
    }
    float mask = texture2D(tGlyphs, vec2((idx + local.x) / uGlyphCount, local.y)).r;
    float peak = max(src.r, max(src.g, src.b));
    vec3 hue = text ? src : src / max(peak, 0.02);
    // Buildings: boost saturation (linear -> sRGB encoding lifts the weak channels and washes hues out),
    // so each building reads as one strong colour band like the reference.
    if (building && !text) hue = pow(hue, vec3(1.8));
    hue *= level;
    vec3 ink = mix(vec3(0.55, 0.95, 0.75) * level, hue, uColor);
    gl_FragColor = vec4(mix(uBg, ink, mask), 1.0);
    #include <colorspace_fragment>
  }
`;

/** Extra glyphs for sign text, appended after GLYPHS. Wide (CJK) characters take two slots: left, right half. */
interface ExtraGlyphs {
  readonly slots: ReadonlyMap<string, number>;
  readonly list: readonly { ch: string; slot: number; wide: boolean }[];
  readonly count: number;
}

function layoutExtra(text: string): ExtraGlyphs {
  const slots = new Map<string, number>();
  const list: { ch: string; slot: number; wide: boolean }[] = [];
  let next = GLYPHS.length;
  for (const ch of new Set(text)) {
    if (ch === ' ') continue;
    const wide = isWide(ch.codePointAt(0)!);
    slots.set(ch, next);
    list.push({ ch, slot: next, wide });
    next += wide ? 2 : 1;
  }
  return { slots, list, count: next };
}

function glyphAtlas(cellW: number, cellH: number, extra: ExtraGlyphs): THREE.Texture {
  const scale = 3;
  const w = cellW * scale;
  const h = cellH * scale;
  const c = document.createElement('canvas');
  c.width = w * extra.count;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.font = `bold ${Math.round(h * 0.82)}px Consolas, 'Cascadia Mono', monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // '*' sits in the top of the cell in most monospace fonts and reads as '"'; centre it.
  [...GLYPHS].forEach((ch, i) => g.fillText(ch, i * w + w / 2, h / 2 + scale + (ch === '*' ? h * 0.2 : 0)));
  // Sign glyphs; CJK drawn across two slots so each half lands in its own cell.
  g.font = `bold ${Math.round(h * 0.82)}px Consolas, 'Cascadia Mono', 'Yu Gothic', 'Meiryo', 'MS Gothic', sans-serif`;
  for (const { ch, slot, wide } of extra.list) g.fillText(ch, slot * w + (wide ? w : w / 2), h / 2 + scale);
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/** Atlas (start, length) of a sub-ramp. */
const range = (ramp: string): THREE.Vector2 => new THREE.Vector2(GLYPHS.indexOf(ramp), ramp.length);

export class AsciiShaderPass {
  private target: THREE.WebGLRenderTarget;
  private material: THREE.ShaderMaterial;
  private quad: THREE.Scene;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly extra: ExtraGlyphs;
  private text = new Float32Array(4);
  private textTex: THREE.DataTexture;
  cols = 0;
  rows = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private cellW: number,
    private cellH: number,
    bg: THREE.Color,
    /** Every character signs may use (CJK included); gets atlas slots. */
    extraText = '',
  ) {
    this.extra = layoutExtra(extraText);
    this.textTex = new THREE.DataTexture(this.text, 1, 1, THREE.RGBAFormat, THREE.FloatType);
    this.target = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.target.depthTexture = new THREE.DepthTexture(1, 1);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        tScene: { value: this.target.texture },
        tGlyphs: { value: glyphAtlas(cellW, cellH, this.extra) },
        uCellPx: { value: new THREE.Vector2() },
        uCells: { value: new THREE.Vector2() },
        tDepth: { value: this.target.depthTexture },
        uNear: { value: 0.1 },
        uFar: { value: 2000 },
        uEdges: { value: 1 },
        uRampCount: { value: RAMP.length },
        uGlyphCount: { value: this.extra.count },
        tText: { value: this.textTex },
        uRain: { value: 0 },
        uTime: { value: 0 },
        uRainGlyph: { value: GLYPHS.indexOf('\\') },
        uPane: { value: range(PANE_RAMP) },
        uSlab: { value: range(SLAB_RAMP) },
        uMullion: { value: range(MULLION_RAMP) },
        uShopStart: { value: GLYPHS.indexOf(SHOP_GLYPHS) },
        uGlyphRoofLine: { value: RAMP.indexOf('=') },
        uColor: { value: 1 },
        uBg: { value: bg },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Scene();
    this.quad.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
    this.resize();
  }

  set edges(on: boolean) {
    this.material.uniforms.uEdges.value = on ? 1 : 0;
  }

  set color(on: boolean) {
    this.material.uniforms.uColor.value = on ? 1 : 0;
  }

  setCell(cellW: number, cellH: number): void {
    this.cellW = cellW;
    this.cellH = cellH;
    this.material.uniforms.tGlyphs.value.dispose();
    this.material.uniforms.tGlyphs.value = glyphAtlas(cellW, cellH, this.extra);
    this.resize();
  }

  resize(): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const dpr = this.renderer.getPixelRatio();
    const cw = this.cellW * dpr;
    const ch = this.cellH * dpr;
    this.cols = Math.ceil(size.x / cw);
    this.rows = Math.ceil(size.y / ch);
    this.target.setSize(this.cols * 2, this.rows * 2);
    this.material.uniforms.uCellPx.value.set(cw, ch);
    this.material.uniforms.uCells.value.set(this.cols, this.rows);
    this.text = new Float32Array(this.cols * this.rows * 4);
    this.textTex.dispose();
    this.textTex = new THREE.DataTexture(this.text, this.cols, this.rows, THREE.RGBAFormat, THREE.FloatType);
    this.textTex.needsUpdate = true;
    this.material.uniforms.tText.value = this.textTex;
  }

  /** Atlas slot of a sign character (left half for wide ones), or undefined if it wasn't registered. */
  textSlot(ch: string): number | undefined {
    return this.extra.slots.get(ch);
  }

  clearText(): void {
    this.text.fill(0);
  }

  /** Writes one text cell. col/row count from the bottom-left; rgb is 0xRRGGBB (sRGB); depth in metres. */
  putText(col: number, row: number, slot: number, rgb: number, depth: number, level: number): void {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return;
    const i = (row * this.cols + col) * 4;
    this.text[i] = slot + 1;
    this.text[i + 1] = rgb;
    this.text[i + 2] = depth;
    this.text[i + 3] = level;
  }

  commitText(): void {
    this.textTex.needsUpdate = true;
  }

  setBackground(color: number): void {
    (this.material.uniforms.uBg.value as THREE.Color).setHex(color);
  }

  setRain(density: number, timeSeconds: number): void {
    this.material.uniforms.uRain.value = density;
    this.material.uniforms.uTime.value = timeSeconds;
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.material.uniforms.uNear.value = camera.near;
    this.material.uniforms.uFar.value = camera.far;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quad, this.cam);
  }
}
