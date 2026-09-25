import * as THREE from 'three';
import { FACADE_CODE } from './block';

/**
 * GPU ASCII pass, for comparison with three's CPU/DOM AsciiEffect.
 * 1. Render the scene into a small target: 2x2 texels per character cell (so 3D cost scales with
 *    the number of cells, not screen pixels).
 * 2. Fullscreen quad: per cell, average the colour, map luminance to a glyph in a density ramp,
 *    and draw that glyph from a glyph atlas texture, tinted by the scene colour (or mono).
 * 3. Buildings don't use the brightness ramp: their material writes an integer code into alpha (see
 *    FACADE_CODE). Walls map a smooth light value (angle, lamps, ground AO, distance) onto a density
 *    ramp; windows are 'o' (lit) / '.' (unlit), or +-| outlines when large; at distance, extra dim
 *    detail points stand in for windows the LOD merged away.
 * 4. Edges: where depth jumps between neighbouring cells, draw | - / \ oriented along the
 *    silhouette instead. Background (sky) cells are left blank. This is what makes shapes read.
 */
const RAMP = ' .,:;-=+*xo#%&@';
const EDGES = '|-/\\';
/**
 * Wall density ramp: light marks only, so walls never compete with window glyphs in weight. No
 * horizontal strokes (- =), which read as siding stripes and blur into edges.
 */
const WALL_RAMP = ',:;';
/** Distance detail point (see FACADE_CODE.detailLit): smaller and dimmer than a real window's 'o'. */
const DETAIL = '\u00b7';
const GLYPHS = RAMP + EDGES + WALL_RAMP + DETAIL;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const C = FACADE_CODE;

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
  uniform float uGlyphLit;
  uniform float uGlyphUnlit;
  uniform float uGlyphH;
  uniform float uGlyphV;
  uniform float uGlyphCorner;
  uniform float uWallRampStart;
  uniform float uGlyphDetail;
  uniform float uWallRampLen;
  float rawDepth(vec2 cell) { return texture2D(tDepth, (cell + 0.5) / uCells).x; }
  float viewDepth(vec2 cell) { return -perspectiveDepthToViewZ(rawDepth(cell), uNear, uFar); }
  float codeAt(vec2 cell) { return floor(texture2D(tScene, (cell * 2.0 + 1.5) / (uCells * 2.0)).a * 255.0 + 0.5); }
  bool isLitWindow(float code) { return code >= ${C.lit}.0 && code < ${C.lit + 10}.0; }
  float glyphFor(float l) { return floor(clamp(pow(l, 0.45) * 1.15, 0.0, 0.999) * uRampCount); }
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
    bool building = code < ${C.other}.0;
    if (building) {
      // Buildings: explicit window grid from the material (see FACADE_CODE), not brightness texture.
      src = t.rgb;
      if (code >= ${C.wall}.0) {
        // Wall: smooth wall light from the material -> a light density ramp in the building's hue.
        // Visual hierarchy: lit window (1.0) > detail point (0.6) > unlit window (0.4) > wall (0.12-0.28).
        // Near walls: cells right next to a lit window stay blank so it keeps clean gaps and reads at full
        // size. Far walls (LOD-merged) skip that, so distant towers stay busy.
        bool isFar = code >= ${C.wallFar}.0;
        float wl = (code - (isFar ? ${C.wallFar}.0 : ${C.wall}.0)) / ${C.wallSteps}.0;
        idx = uWallRampStart + floor(clamp(wl, 0.0, 0.999) * uWallRampLen);
        level = mix(0.12, 0.28, wl);
        if (!isFar && (isLitWindow(codeAt(cell + vec2(1.0, 0.0))) || isLitWindow(codeAt(cell - vec2(1.0, 0.0))))) idx = 0.0;
      }
      else if (code == ${C.detailLit}.0) {
        idx = uGlyphDetail;
        level = 0.6;
      }
      else if (code >= ${C.unlit}.0) {
        bool lit = code >= ${C.lit}.0;
        float shape = code - (lit ? ${C.lit}.0 : ${C.unlit}.0);
        level = lit ? 1.0 : 0.4;
        if (shape == ${C.point}.0) idx = lit ? uGlyphLit : uGlyphUnlit;
        else if (shape == ${C.h}.0) idx = uGlyphH;
        else if (shape == ${C.v}.0) idx = uGlyphV;
        else idx = uGlyphCorner;
      }
    }
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
        if (building) idx = uRampCount + (ax >= ay ? 0.0 : 1.0);
        else if (ax > ay * 2.0) idx = uRampCount + 0.0;       // |
        else if (ay > ax * 2.0) idx = uRampCount + 1.0;       // -
        else idx = uRampCount + (gx * gy > 0.0 ? 3.0 : 2.0);  // backslash or slash
        level = building ? 0.8 : max(level, 0.5);
      }
    }
    float mask = texture2D(tGlyphs, vec2((idx + local.x) / uGlyphCount, local.y)).r;
    float peak = max(src.r, max(src.g, src.b));
    vec3 hue = src / max(peak, 0.02) * level;
    vec3 ink = mix(vec3(0.55, 0.95, 0.75) * level, hue, uColor);
    gl_FragColor = vec4(mix(uBg, ink, mask), 1.0);
    #include <colorspace_fragment>
  }
`;

function glyphAtlas(cellW: number, cellH: number): THREE.Texture {
  const scale = 3;
  const w = cellW * scale;
  const h = cellH * scale;
  const c = document.createElement('canvas');
  c.width = w * GLYPHS.length;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.font = `bold ${Math.round(h * 0.82)}px Consolas, 'Cascadia Mono', monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  [...GLYPHS].forEach((ch, i) => g.fillText(ch, i * w + w / 2, h / 2 + scale));
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

export class AsciiShaderPass {
  private target: THREE.WebGLRenderTarget;
  private material: THREE.ShaderMaterial;
  private quad: THREE.Scene;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  cols = 0;
  rows = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private cellW: number,
    private cellH: number,
    bg: THREE.Color,
  ) {
    this.target = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.target.depthTexture = new THREE.DepthTexture(1, 1);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        tScene: { value: this.target.texture },
        tGlyphs: { value: glyphAtlas(cellW, cellH) },
        uCellPx: { value: new THREE.Vector2() },
        uCells: { value: new THREE.Vector2() },
        tDepth: { value: this.target.depthTexture },
        uNear: { value: 0.1 },
        uFar: { value: 2000 },
        uEdges: { value: 1 },
        uRampCount: { value: RAMP.length },
        uGlyphCount: { value: GLYPHS.length },
        uGlyphLit: { value: GLYPHS.indexOf('o') },
        uGlyphUnlit: { value: GLYPHS.indexOf('.') },
        uGlyphH: { value: GLYPHS.indexOf('-') },
        uGlyphV: { value: GLYPHS.indexOf('|') },
        uGlyphCorner: { value: GLYPHS.indexOf('+') },
        uWallRampStart: { value: RAMP.length + EDGES.length },
        uWallRampLen: { value: WALL_RAMP.length },
        uGlyphDetail: { value: GLYPHS.indexOf(DETAIL) },
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
    this.material.uniforms.tGlyphs.value = glyphAtlas(cellW, cellH);
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
