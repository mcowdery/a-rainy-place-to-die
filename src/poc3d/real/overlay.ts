import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { buildAtlas, type AtlasLayout } from '../glyphAtlas';

/**
 * The ASCII layer over the realistic render. It carries the mood rather than defining the world:
 * - up close, a faint character grain: each cell's glyph (picked from the cell's brightness) lightly
 *   modulates the image, so the realistic picture shows a text texture without losing detail;
 * - with distance (and sooner in fog or rain), cells dissolve into the glyphs themselves, drawn in the
 *   cell's own colour at the same average brightness, so the far city and the sky become characters (it
 *   also hides the simplified far LOD);
 * - rain is drawn as falling streak glyphs over everything.
 * Presets: off, vibe (default), heavy, ascii (everything as characters). Runs before bloom, so bright
 * glyphs glow.
 */

export const OVERLAY_PRESETS = ['vibe', 'heavy', 'ascii', 'off'] as const;
export type OverlayPreset = (typeof OVERLAY_PRESETS)[number];

const fragmentShader = /* glsl */ `
  #include <packing>
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform float uNear;
  uniform float uFar;
  uniform sampler2D tGlyphs;
  uniform float uGlyphCount;
  uniform vec2 uRamp;
  uniform float uCov[24];
  uniform vec2 uRes;
  uniform vec2 uCellPx;
  uniform float uGrain;
  uniform vec2 uDissolve;
  uniform float uSky;
  uniform float uAll;
  uniform vec2 uKeep;   // share of the cell's light kept as a soft backdrop behind glyphs: (far city, sky)
  uniform float uRain;
  uniform float uTime;
  uniform float uRainSlot;
  uniform float uDither;
  uniform vec3 uBg;
  varying vec2 vUv;

  float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
  float bayer(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
  float hh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float glyphMask(float slot, vec2 local) { return texture2D(tGlyphs, vec2((slot + local.x) / uGlyphCount, local.y)).r; }

  void main() {
    vec2 px = vUv * uRes;
    vec2 cell = floor(px / uCellPx);
    vec2 local = fract(px / uCellPx);
    vec2 cc = (cell + 0.5) * uCellPx / uRes;
    vec2 q = uCellPx * 0.25 / uRes;
    vec3 avg = 0.25 * (texture2D(tScene, cc - q).rgb + texture2D(tScene, cc + q).rgb
      + texture2D(tScene, cc + vec2(q.x, -q.y)).rgb + texture2D(tScene, cc + vec2(-q.x, q.y)).rgb);
    vec3 img = texture2D(tScene, vUv).rgb;
    float raw = texture2D(tDepth, cc).x;
    bool sky = raw >= 0.999999;
    float dz = sky ? 1e6 : -perspectiveDepthToViewZ(raw, uNear, uFar);
    float dissolve = max(sky ? uSky : smoothstep(uDissolve.x, uDissolve.y, dz), uAll);

    // Glyph for the cell: brighter cells get denser glyphs.
    float lum = dot(avg, vec3(0.2126, 0.7152, 0.0722));
    // The sky gets the sparse end of the ramp: a light scatter of characters rather than a wall of them.
    float tone = (1.0 - exp(-lum * 3.0)) * (sky ? 0.55 : 1.0);
    float s = clamp(floor(tone * uRamp.y * 1.1 + (bayer(cell) - 0.5) * uDither), 0.0, uRamp.y - 1.0);
    float mask = tone < 0.025 ? 0.0 : glyphMask(uRamp.x + s, local);
    // Glyph ink carries the cell's light (minus a soft backdrop share), so dissolving keeps the average
    // brightness; with no backdrop, empty cell space falls to the dark background.
    float keep = sky ? uKeep.y : uKeep.x;
    vec3 ascii = avg * (keep + (1.0 - keep) * mask / max(uCov[int(s)], 0.18)) + uBg * (1.0 - mask) * (1.0 - keep);
    vec3 grain = img * (1.0 - uGrain + uGrain * (0.6 + 1.3 * mask));
    vec3 col = mix(grain, ascii, dissolve);

    if (uRain > 0.0) {
      float drop = floor(cell.y * 0.35 + uTime * 14.0 + hh(vec2(cell.x, 3.0)) * 97.0);
      if (hh(vec2(cell.x, drop)) < uRain) col += vec3(0.32, 0.4, 0.52) * glyphMask(uRainSlot, local) * (0.06 + 0.3 * lum);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class AsciiOverlayPass extends Pass {
  private readonly quad: FullScreenQuad;
  private readonly material: THREE.ShaderMaterial;
  private atlas: AtlasLayout;
  private presetName: OverlayPreset = 'vibe';
  private fog: [number, number] = [60, 620];

  constructor(
    private readonly cellW: number,
    private readonly cellH: number,
  ) {
    super();
    this.atlas = buildAtlas(cellW, cellH, '');
    const cov = new Array(24).fill(0.2);
    this.atlas.cov.pane.forEach((c, i) => (cov[i] = c));
    this.material = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader,
      uniforms: {
        tScene: { value: null },
        tDepth: { value: null },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        tGlyphs: { value: this.atlas.texture },
        uGlyphCount: { value: this.atlas.count },
        uRamp: { value: new THREE.Vector2(this.atlas.pane.start, this.atlas.pane.length) },
        uCov: { value: cov },
        uRes: { value: new THREE.Vector2(1, 1) },
        uCellPx: { value: new THREE.Vector2(cellW, cellH) },
        uGrain: { value: 0.2 },
        uDissolve: { value: new THREE.Vector2(120, 500) },
        uSky: { value: 0.6 },
        uKeep: { value: new THREE.Vector2(0.3, 0.6) },
        uAll: { value: 0 },
        uRain: { value: 0 },
        uTime: { value: 0 },
        uRainSlot: { value: this.atlas.box.fall },
        uDither: { value: 0.5 },
        uBg: { value: new THREE.Color(0x000000) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.applyPreset();
  }

  get preset(): OverlayPreset {
    return this.presetName;
  }

  set preset(p: OverlayPreset) {
    this.presetName = p;
    this.applyPreset();
  }

  get dither(): boolean {
    return this.material.uniforms.uDither.value > 0;
  }

  set dither(on: boolean) {
    this.material.uniforms.uDither.value = on ? 0.5 : 0;
  }

  /** The dissolve distance follows the fog: characters take over where the air thickens. */
  setFog(near: number, far: number, bg: THREE.Color): void {
    this.fog = [near, far];
    (this.material.uniforms.uBg.value as THREE.Color).copy(bg).multiplyScalar(0.35);
    this.applyPreset();
  }

  setRain(density: number, timeSeconds: number): void {
    this.material.uniforms.uRain.value = density * (this.presetName === 'off' ? 0 : 1.6);
    this.material.uniforms.uTime.value = timeSeconds;
  }

  private applyPreset(): void {
    const u = this.material.uniforms;
    const [near, far] = this.fog;
    const p = this.presetName;
    u.uGrain.value = p === 'vibe' ? 0.15 : p === 'heavy' ? 0.45 : 0;
    u.uSky.value = p === 'off' ? 0 : p === 'vibe' ? 0.7 : 1;
    u.uAll.value = p === 'ascii' ? 1 : 0;
    (u.uKeep.value as THREE.Vector2).set(p === 'vibe' ? 0.3 : p === 'heavy' ? 0.12 : 0, p === 'vibe' ? 0.65 : p === 'heavy' ? 0.35 : 0);
    const d = p === 'off' ? [1e6, 1e6 + 1] : p === 'heavy' ? [Math.max(10, near * 0.4), far * 0.45] : [Math.max(25, near * 1.8), far * 0.8];
    (u.uDissolve.value as THREE.Vector2).set(d[0], d[1]);
  }

  setSize(width: number, height: number): void {
    (this.material.uniforms.uRes.value as THREE.Vector2).set(width, height);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const u = this.material.uniforms;
    const dpr = renderer.getPixelRatio();
    u.tScene.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    (u.uRes.value as THREE.Vector2).set(readBuffer.width, readBuffer.height);
    (u.uCellPx.value as THREE.Vector2).set(this.cellW * dpr, this.cellH * dpr);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.material.uniforms.uNear.value = camera.near;
    this.material.uniforms.uFar.value = camera.far;
  }

  dispose(): void {
    this.material.dispose();
    this.quad.dispose();
    this.atlas.texture.dispose();
  }
}
