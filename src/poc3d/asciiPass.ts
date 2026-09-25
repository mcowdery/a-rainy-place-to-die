import * as THREE from 'three';
import { FACADE, SURFACE } from './block';
import { buildAtlas, type AtlasLayout } from './glyphAtlas';

/**
 * GPU ASCII pass.
 * 1. Render the scene into a small target: 2x2 texels per character cell (so 3D cost scales with the
 *    number of cells, not screen pixels).
 * 2. Fullscreen quad: per cell, pick a glyph from the atlas (glyphAtlas.ts) and tint it.
 *    - Non-building surfaces: luminance -> measured ground ramp.
 *    - Buildings: the material writes an integer code into alpha (see FACADE): surface (pane / mullion /
 *      slab / storefront), a smooth intensity and a per-floor variant. Panes map a tone onto one ladder:
 *      measured single-cell glyphs (Latin + halfwidth katakana), then dense kanji for the darkest tones,
 *      drawn as left/right halves across screen-aligned cell pairs.
 *    - Sub-cell detail: all four texels of the cell are read; where they disagree (a window edge, a
 *      mullion inside the cell) the cell draws the matching quadrant glyph (▘▝▖▗▚▞▌▐…), doubling the
 *      effective resolution of facade structure without more cells.
 *    - Ordered (4x4 Bayer) dithering between ramp steps smooths tone transitions (toggle with dither).
 * 3. Edges: where depth jumps, box-drawing lines (│ ─ and ┌ ┐ └ ┘ at corners; ╱ ╲ on the ground) that
 *    connect edge-to-edge between cells.
 * 4. Text layer: signs laid out on the CPU into a per-cell texture (glyph, colour, depth, brightness) and
 *    depth-tested against the scene here.
 * 5. Rain: falling streaks in blank cells.
 */

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const F = FACADE;
const S = SURFACE;
/**
 * Dither amplitude in ramp steps. At 1.0 every in-between tone checkerboards two glyphs, which breaks up the
 * per-floor glyph bands; at 0.5 only tones near a step boundary blend.
 */
const DITHER = 0.5;

const fragmentShader = /* glsl */ `
  #include <packing>
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform float uNear;
  uniform float uFar;
  uniform float uEdges;
  uniform sampler2D tGlyphs;
  uniform vec2 uCellPx;
  uniform vec2 uCells;
  uniform float uGlyphCount;
  uniform float uColor;
  uniform vec3 uBg;
  uniform vec2 uGround;   // (start slot, length)
  uniform vec2 uPane;
  uniform vec2 uKanji;    // (start slot, number of kanji; each takes 2 slots)
  uniform vec2 uSlab;
  uniform float uShopStart;
  uniform float uQuad;
  uniform vec4 uBoxA;     // │ ─ ┌ ┐
  uniform vec4 uBoxB;     // └ ┘ ╱ ╲
  uniform sampler2D tText;
  uniform float uRain;
  uniform float uTime;
  uniform float uDither;

  float rawDepth(vec2 cell) { return texture2D(tDepth, (cell + 0.5) / uCells).x; }
  float viewDepth(vec2 cell) { return -perspectiveDepthToViewZ(rawDepth(cell), uNear, uFar); }
  vec4 texel(vec2 cell, vec2 q) { return texture2D(tScene, (cell * 2.0 + q + 0.5) / (uCells * 2.0)); }
  float codeOf(vec4 t) { return floor(t.a * 255.0 + 0.5); }
  float pick(vec2 ramp, float x) { return ramp.x + clamp(floor(x), 0.0, ramp.y - 1.0); }

  // 4x4 Bayer threshold in [0, 1): the recursive 2x2 construction.
  float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
  float bayer(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
  float dither(vec2 cell) { return (bayer(cell) - 0.5) * uDither; }

  // Facade code decoding (see FACADE in block.ts).
  bool isFacade(float c) { return c >= ${F.base}.0 && c < ${F.shop}.0; }
  float surfOf(float c) { return floor(floor((c - ${F.base}.0) / ${F.levels}.0) / ${F.variants}.0); }
  float levelOf(float c) { return mod(c - ${F.base}.0, ${F.levels}.0) / ${F.levels - 1}.0; }
  float variantOf(float c) { return mod(floor((c - ${F.base}.0) / ${F.levels}.0), ${F.variants}.0) - 1.0; }
  bool isPane(float c) { return isFacade(c) && surfOf(c) >= ${S.pane}.0; }
  // "Ink" for sub-cell masks: any building surface except the gap between window columns.
  bool inkOf(float c) { return c < ${F.other}.0 && !(isFacade(c) && surfOf(c) == ${S.mullion}.0); }
  // Pane tone on [0, 1] across the whole ladder (single-cell glyphs, then kanji).
  float paneTone(float c) {
    bool lit = surfOf(c) == ${S.paneLit}.0;
    return clamp(levelOf(c) * 0.85 + variantOf(c) * 0.07 + (lit ? 0.22 : 0.0), 0.0, 1.0);
  }
  float ladderStep(float c, vec2 cell) {
    return floor(paneTone(c) * (uPane.y + uKanji.y - 1.0) + 0.5 + dither(cell));
  }

  void main() {
    vec2 cell = floor(gl_FragCoord.xy / uCellPx);
    vec2 local = fract(gl_FragCoord.xy / uCellPx);
    // Colour: average of the cell's 2x2 texels. Codes: the four texels individually.
    vec3 c = texture2D(tScene, (cell + 0.5) / uCells).rgb;
    vec4 t00 = texel(cell, vec2(0.0, 0.0));
    vec4 t10 = texel(cell, vec2(1.0, 0.0));
    vec4 t01 = texel(cell, vec2(0.0, 1.0));
    vec4 t11 = texel(cell, vec2(1.0, 1.0));
    float k00 = codeOf(t00), k10 = codeOf(t10), k01 = codeOf(t01), k11 = codeOf(t11);
    vec4 t = t11;
    float code = k11;

    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float idx = pick(uGround, clamp(pow(l, 0.45) * 1.15, 0.0, 0.999) * uGround.y + dither(cell));
    float level = mix(0.45, 1.0, sqrt(l));
    vec3 src = c;
    bool building = min(min(k00, k10), min(k01, k11)) < ${F.other}.0;

    bool i00 = inkOf(k00), i10 = inkOf(k10), i01 = inkOf(k01), i11 = inkOf(k11);
    float inkCount = float(i00) + float(i10) + float(i01) + float(i11);
    bool allBuilding = max(max(k00, k10), max(k01, k11)) < ${F.other}.0;
    if (allBuilding && inkCount > 0.0 && inkCount < 4.0) {
      // Sub-cell detail inside a facade: quadrant glyph matching which quarters of the cell are pane/slab
      // versus the gap between window columns. (Silhouettes against sky/ground get box-drawing edges.)
      float mask = (i01 ? 1.0 : 0.0) + (i11 ? 2.0 : 0.0) + (i00 ? 4.0 : 0.0) + (i10 ? 8.0 : 0.0);
      idx = uQuad + mask;
      vec4 it = i11 ? t11 : i01 ? t01 : i10 ? t10 : t00;
      float ic = codeOf(it);
      src = it.rgb;
      // Solid quarter-blocks carry far more ink than a letter, so they sit darker to keep the same weight.
      level = isFacade(ic) ? mix(0.16, 0.34, levelOf(ic)) : 0.28;
    } else if (code >= ${F.shop}.0 && code < ${F.other}.0) {
      // Storefront band: fixed glyph per code, colour straight from the material.
      src = t.rgb;
      idx = uShopStart + code - ${F.shop}.0;
      level = code >= ${F.shop + 3}.0 ? 1.0 : code == ${F.shop}.0 ? 0.75 : 0.45;
    } else if (isFacade(code)) {
      src = t.rgb;
      float surf = surfOf(code);
      float it = levelOf(code);
      if (surf == ${S.mullion}.0) {
        idx = 0.0;
        level = 0.3;
      } else if (surf == ${S.slab}.0) {
        idx = pick(uSlab, it * uSlab.y + dither(cell));
        level = mix(0.25, 0.65, it);
      } else {
        bool lit = surf == ${S.paneLit}.0;
        float s = ladderStep(code, cell);
        if (s >= uPane.y) {
          // Kanji tier: both cells of the screen-aligned pair must be pane; both halves take the kanji
          // from the pair's left cell so they always agree.
          vec2 pl = vec2(floor(cell.x / 2.0) * 2.0, cell.y);
          vec2 pr = pl + vec2(1.0, 0.0);
          float cl = codeOf(texel(pl, vec2(1.0)));
          float cr = codeOf(texel(pr, vec2(1.0)));
          if (isPane(cl) && isPane(codeOf(texel(pl, vec2(0.0)))) && isPane(cr) && isPane(codeOf(texel(pr, vec2(0.0))))) {
            float kk = clamp(ladderStep(cl, pl) - uPane.y, 0.0, uKanji.y - 1.0);
            idx = uKanji.x + kk * 2.0 + (cell.x - pl.x);
          } else {
            idx = uPane.x + uPane.y - 1.0;
          }
        } else {
          idx = pick(uPane, s);
        }
        level = lit ? 1.0 : mix(0.3, 0.85, it);
      }
    }
    // Ground and props sit back so buildings carry the image.
    if (!building) level *= 0.6;
    float sky = step(0.99999, rawDepth(cell));
    if (sky > 0.5 && !building) idx = 0.0;

    if (uEdges > 0.5 && sky < 0.5) {
      // 1/depth is linear across any flat surface in screen space, so its second difference is ~0 on
      // walls, roads and roofs (even at grazing angles) and spikes only at silhouettes and creases.
      float dc = viewDepth(cell);
      float dl = viewDepth(cell - vec2(1.0, 0.0));
      float dr = viewDepth(cell + vec2(1.0, 0.0));
      float dd = viewDepth(cell - vec2(0.0, 1.0));
      float du = viewDepth(cell + vec2(0.0, 1.0));
      float ic = 1.0 / dc;
      float ax = abs(1.0 / dl + 1.0 / dr - 2.0 * ic) / ic;
      float ay = abs(1.0 / dd + 1.0 / du - 2.0 * ic) / ic;
      float gx = 1.0 / dr - 1.0 / dl;
      float gy = 1.0 / du - 1.0 / dd;
      if (max(ax, ay) > 0.12) {
        if (building) {
          if (ax > ay * 2.0) idx = uBoxA.x;          // │
          else if (ay > ax * 2.0) idx = uBoxA.y;     // ─
          else {
            // Corner: the building occupies the side away from the farther neighbours.
            bool farL = dl > dc * 1.1, farR = dr > dc * 1.1, farU = du > dc * 1.1, farD = dd > dc * 1.1;
            if (farL && farU) idx = uBoxA.z;          // ┌
            else if (farR && farU) idx = uBoxA.w;     // ┐
            else if (farL && farD) idx = uBoxB.x;     // └
            else if (farR && farD) idx = uBoxB.y;     // ┘
            else idx = uBoxA.x;
          }
          level = 0.8;
        } else {
          if (ax > ay * 2.0) idx = uBoxA.x;
          else if (ay > ax * 2.0) idx = uBoxA.y;
          else idx = gx * gy > 0.0 ? uBoxB.w : uBoxB.z; // ╲ or ╱
          level = max(level, 0.5);
        }
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
        idx = uBoxB.w;
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

const v2 = (r: { start: number; length: number }): THREE.Vector2 => new THREE.Vector2(r.start, r.length);

export class AsciiShaderPass {
  private target: THREE.WebGLRenderTarget;
  private material: THREE.ShaderMaterial;
  private quad: THREE.Scene;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private atlas: AtlasLayout;
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
    private readonly signText = '',
  ) {
    this.atlas = buildAtlas(cellW, cellH, signText);
    this.textTex = new THREE.DataTexture(this.text, 1, 1, THREE.RGBAFormat, THREE.FloatType);
    this.target = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.target.depthTexture = new THREE.DepthTexture(1, 1);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        tScene: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        uNear: { value: 0.1 },
        uFar: { value: 2000 },
        uEdges: { value: 1 },
        tGlyphs: { value: null },
        uCellPx: { value: new THREE.Vector2() },
        uCells: { value: new THREE.Vector2() },
        uGlyphCount: { value: 1 },
        uColor: { value: 1 },
        uBg: { value: bg },
        uGround: { value: new THREE.Vector2() },
        uPane: { value: new THREE.Vector2() },
        uKanji: { value: new THREE.Vector2() },
        uSlab: { value: new THREE.Vector2() },
        uShopStart: { value: 0 },
        uQuad: { value: 0 },
        uBoxA: { value: new THREE.Vector4() },
        uBoxB: { value: new THREE.Vector4() },
        tText: { value: this.textTex },
        uRain: { value: 0 },
        uTime: { value: 0 },
        uDither: { value: DITHER },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.applyAtlas();
    this.quad = new THREE.Scene();
    this.quad.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
    this.resize();
  }

  private applyAtlas(): void {
    const a = this.atlas;
    const u = this.material.uniforms;
    u.tGlyphs.value = a.texture;
    u.uGlyphCount.value = a.count;
    u.uGround.value = v2(a.ground);
    u.uPane.value = v2(a.pane);
    u.uKanji.value = v2(a.kanji);
    u.uSlab.value = v2(a.slab);
    u.uShopStart.value = a.shop;
    u.uQuad.value = a.quad;
    u.uBoxA.value.set(a.box.v, a.box.h, a.box.tl, a.box.tr);
    u.uBoxB.value.set(a.box.bl, a.box.br, a.box.rise, a.box.fall);
  }

  /** The measured ramps, for the HUD / reports. */
  get ramps(): AtlasLayout['report'] {
    return this.atlas.report;
  }

  set edges(on: boolean) {
    this.material.uniforms.uEdges.value = on ? 1 : 0;
  }

  set color(on: boolean) {
    this.material.uniforms.uColor.value = on ? 1 : 0;
  }

  get dither(): boolean {
    return this.material.uniforms.uDither.value > 0;
  }

  set dither(on: boolean) {
    this.material.uniforms.uDither.value = on ? DITHER : 0;
  }

  setCell(cellW: number, cellH: number): void {
    this.cellW = cellW;
    this.cellH = cellH;
    this.atlas.texture.dispose();
    this.atlas = buildAtlas(cellW, cellH, this.signText);
    this.applyAtlas();
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
    return this.atlas.text.get(ch);
  }

  /** Atlas slot of a quadrant glyph (mask bits: 1 top-left, 2 top-right, 4 bottom-left, 8 bottom-right). */
  quadSlot(mask: number): number {
    return this.atlas.quad + (mask & 15);
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
