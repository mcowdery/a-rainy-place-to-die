import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * The colour grade: the last pass, on the tone-mapped display image. It desaturates the city while letting
 * bright, saturated light (neon, signs, screens) keep its colour, split-tones shadows and highlights, lifts
 * the blacks (the milky blacks of film and 80s anime), adds contrast, a vignette, film grain, a little lens
 * fringing toward the edges and a red halation round bright lights. In rain, drops run down the lens.
 */
export interface GradePreset {
  /** Overall saturation (0 grey, 1 as rendered). */
  readonly sat: number;
  /** How much bright, saturated light keeps its colour regardless (0-1). */
  readonly neonKeep: number;
  /** Tints multiplied into the shadows and highlights, and how strongly. */
  readonly shadow: readonly [number, number, number];
  readonly highlight: readonly [number, number, number];
  readonly tone: number;
  /** Black level (a coloured lift). */
  readonly lift: readonly [number, number, number];
  readonly contrast: number;
  readonly vignette: number;
  readonly grain: number;
  /** Lens fringing at the frame edge, in UV. */
  readonly fringe: number;
  /** Halation round highlights, and its colour. */
  readonly halation: number;
  readonly halColor: readonly [number, number, number];
}

export const GRADES = {
  neutral: { sat: 1, neonKeep: 0, shadow: [1, 1, 1], highlight: [1, 1, 1], tone: 0, lift: [0, 0, 0], contrast: 1, vignette: 0, grain: 0, fringe: 0, halation: 0, halColor: [1, 0.4, 0.2] },
  nocturne: { sat: 0.42, neonKeep: 0.75, shadow: [0.8, 0.95, 1.15], highlight: [1.08, 1.0, 0.9], tone: 0.65, lift: [0.012, 0.017, 0.03], contrast: 1.1, vignette: 0.4, grain: 0.05, fringe: 0.0018, halation: 0.3, halColor: [1, 0.35, 0.18] },
  noir: { sat: 0.06, neonKeep: 0.3, shadow: [0.9, 0.96, 1.08], highlight: [1.06, 1.02, 0.95], tone: 0.5, lift: [0.008, 0.009, 0.012], contrast: 1.28, vignette: 0.6, grain: 0.085, fringe: 0.001, halation: 0.18, halColor: [1, 0.9, 0.8] },
  citypop: { sat: 0.85, neonKeep: 0.6, shadow: [0.88, 0.8, 1.18], highlight: [1.12, 0.96, 0.9], tone: 0.7, lift: [0.045, 0.022, 0.065], contrast: 0.9, vignette: 0.28, grain: 0.035, fringe: 0.0024, halation: 0.45, halColor: [1, 0.35, 0.55] },
} as const satisfies Record<string, GradePreset>;
export type GradeName = keyof typeof GRADES;
export const GRADE_NAMES = Object.keys(GRADES) as GradeName[];

const fragment = /* glsl */ `
  #include <packing>
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform float uNear;
  uniform float uFar;
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uSat;
  uniform float uNeonKeep;
  uniform vec3 uShadow;
  uniform vec3 uHighlight;
  uniform float uTone;
  uniform vec3 uLift;
  uniform float uContrast;
  uniform float uVignette;
  uniform float uGrain;
  uniform float uFringe;
  uniform float uHalation;
  uniform vec3 uHalColor;
  uniform float uRain;
  uniform float uHeat;
  uniform float uHorizonY;
  uniform float uGlare;
  uniform vec2 uSunPos;
  varying vec2 vUv;

  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  vec2 h22(vec2 p) { float n = h21(p); return vec2(n, h21(p + n)); }

  // Drops on the lens: a grid of cells, each with a drop that appears, sits and slides; plus a few trails.
  // Returns the UV offset (refraction) in xy and how much of a drop is here in z.
  vec3 drops(vec2 uv, float t) {
    vec2 aspect = vec2(uRes.x / uRes.y, 1.0);
    vec3 acc = vec3(0.0);
    for (int layer = 0; layer < 2; layer++) {
      float scale = layer == 0 ? 7.0 : 13.0;
      vec2 p = uv * aspect * scale;
      vec2 id = floor(p);
      vec2 r = h22(id + float(layer) * 17.0);
      float life = fract(t * (0.05 + r.x * 0.08) + r.y);
      // Slides down during the last third of its life.
      float slide = smoothstep(0.66, 1.0, life);
      vec2 c = id + vec2(0.2 + 0.6 * r.x, 0.8 - 0.6 * r.y - slide * 0.7);
      vec2 d = (p - c) / aspect.yx;
      d.x *= 1.0;
      float size = (0.12 + 0.18 * r.y) * (layer == 0 ? 1.0 : 0.6) * smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.92, 1.0, life));
      float dist = length(d);
      float m = smoothstep(size, size * 0.6, dist);
      if (r.x > 0.3) m = 0.0;
      acc.xy += d / max(size, 1e-3) * m * 0.007;
      acc.z = max(acc.z, m);
      // The trail left behind by a slide.
      float trail = slide * smoothstep(0.02, 0.0, abs(d.x)) * smoothstep(0.0, 0.05, d.y) * smoothstep(0.5, 0.0, d.y) * step(r.x, 0.3);
      acc.z = max(acc.z, trail * 0.3);
    }
    return acc;
  }

  void main() {
    vec2 uv = vUv;
    vec3 lens = uRain > 0.0 ? drops(uv, uTime) * uRain : vec3(0.0);
    uv += lens.xy;
    // Heat shimmer (a heat wave by day): the air over the hot ground wavers, strongest in a band along the horizon
    // (the distant road and what stands on it), rising, in patches.
    if (uHeat > 0.0) {
      // Only what's far off (the scene's depth): the near buildings stay still.
      float dz = texture2D(tDepth, uv).x;
      float far = dz >= 0.999999 ? 1.0 : smoothstep(80.0, 220.0, -perspectiveDepthToViewZ(dz, uNear, uFar));
      float band = exp(-pow((uv.y - uHorizonY + 0.03) / 0.09, 2.0)) * far;
      float patch_ = 0.5 + 0.5 * sin(uv.x * 7.0 + uTime * 0.7) * sin(uv.x * 13.0 - uTime * 0.4 + 1.3);
      float px = uHeat * band * (0.4 + 0.6 * patch_) * 1.8;
      float ph = uv.y * uRes.y * 0.23 - uTime * 7.0 + sin(uv.x * uRes.x * 0.04 + uTime * 1.7) * 1.5;
      uv += vec2(sin(ph), 0.4 * cos(ph * 1.3)) * px / uRes;
    }
    // Lens fringing grows toward the edges.
    vec2 off = (uv - 0.5) * uFringe * length(uv - 0.5) * 2.0;
    vec3 c = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
    // A heat wave: a touch warmer.
    if (uHeat > 0.0) c = mix(c, c * vec3(1.05, 1.0, 0.9), uHeat * 0.6);
    // The sun's glare: a halo and a horizontal streak round it and a few faint ghosts across the lens, as much as
    // the sun itself shows (its disc's brightness in the image, so buildings in front put it out).
    if (uGlare > 0.0) {
      float lum = 0.0;
      for (int i = 0; i < 5; i++) {
        vec2 o = vec2(float(i - 2) * 0.004, float((i * 3) % 5 - 2) * 0.004);
        lum += dot(texture2D(tDiffuse, clamp(uSunPos + o, 0.001, 0.999)).rgb, vec3(0.3, 0.55, 0.15));
      }
      float vis = smoothstep(0.82, 0.97, lum / 5.0) * uGlare * step(-0.2, uSunPos.x) * step(uSunPos.x, 1.2) * step(-0.2, uSunPos.y) * step(uSunPos.y, 1.2);
      if (vis > 0.0) {
        vec2 asp = vec2(uRes.x / uRes.y, 1.0);
        vec2 dv = (uv - uSunPos) * asp;
        float r = length(dv);
        float glow = exp(-r * 7.0) * 0.45 + exp(-r * 2.2) * 0.14;
        float streak = exp(-abs(dv.y) * 70.0) * exp(-abs(dv.x) * 2.2) * 0.3;
        vec3 g = vec3(1.0, 0.93, 0.8) * (glow + streak);
        for (int k = 1; k <= 3; k++) {
          vec2 gp = uSunPos + (vec2(0.5) - uSunPos) * (0.55 + 0.45 * float(k));
          float gr = length((uv - gp) * asp);
          float size = 0.025 + 0.02 * float(k);
          g += vec3(0.5 + 0.2 * float(k), 0.8, 1.0 - 0.15 * float(k)) * smoothstep(size, size * 0.6, gr) * 0.035;
        }
        c += g * vis;
      }
    }
    // A drop is a little blurred and brighter at its rim.
    if (lens.z > 0.0) {
      vec3 b = vec3(0.0);
      for (int i = 0; i < 4; i++) {
        vec2 o = vec2(cos(float(i) * 1.57), sin(float(i) * 1.57)) * 3.0 / uRes;
        b += texture2D(tDiffuse, uv + o).rgb;
      }
      c = mix(c, b * 0.25, lens.z * 0.5) * (1.0 + lens.z * 0.08);
    }
    // Halation: bright light bleeds a red-orange fringe round itself.
    if (uHalation > 0.0) {
      vec3 hal = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785;
        vec3 s = texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * 7.0 / uRes).rgb;
        hal += max(s - 0.75, 0.0);
      }
      c += uHalColor * dot(hal, vec3(0.3, 0.5, 0.2)) * 0.25 * uHalation;
    }
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float hi = max(c.r, max(c.g, c.b));
    float chroma = hi - min(c.r, min(c.g, c.b));
    // Saturation, except for bright saturated light.
    float keep = uNeonKeep * smoothstep(0.5, 0.9, hi) * smoothstep(0.25, 0.6, chroma);
    c = mix(vec3(l), c, mix(uSat, 1.0, keep));
    // Split toning.
    float sh = 1.0 - smoothstep(0.0, 0.45, l);
    float hl = smoothstep(0.55, 1.0, l);
    c *= mix(vec3(1.0), uShadow, sh * uTone);
    c *= mix(vec3(1.0), uHighlight, hl * uTone);
    // Contrast round mid grey, then the coloured black lift.
    c = clamp((c - 0.45) * uContrast + 0.45, 0.0, 1.0);
    c = uLift + c * (1.0 - uLift);
    // Vignette and grain (grain is stronger in the dark, like film).
    vec2 v = vUv - 0.5;
    c *= 1.0 - uVignette * pow(length(v * vec2(1.1, 1.0)) * 1.35, 2.4);
    float g = h21(vUv * uRes + fract(uTime * 13.7) * 100.0) - 0.5;
    c += g * uGrain * (1.0 - 0.6 * l);
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }
`;

export class GradePass extends Pass {
  private readonly quad: FullScreenQuad;
  readonly material: THREE.ShaderMaterial;
  private current: GradeName = 'nocturne';

  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uSat: { value: 1 },
        uNeonKeep: { value: 0 },
        uShadow: { value: new THREE.Vector3(1, 1, 1) },
        uHighlight: { value: new THREE.Vector3(1, 1, 1) },
        uTone: { value: 0 },
        uLift: { value: new THREE.Vector3() },
        uContrast: { value: 1 },
        uVignette: { value: 0 },
        uGrain: { value: 0 },
        uFringe: { value: 0 },
        uHalation: { value: 0 },
        uHalColor: { value: new THREE.Vector3(1, 0.4, 0.2) },
        uRain: { value: 0 },
        uHeat: { value: 0 },
        uHorizonY: { value: 0.5 },
        uGlare: { value: 0 },
        tDepth: { value: null },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: fragment,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.grade = 'neutral';
  }

  get grade(): GradeName {
    return this.current;
  }

  set grade(name: GradeName) {
    this.current = name;
    const p: GradePreset = GRADES[name];
    const u = this.material.uniforms;
    u.uSat.value = p.sat;
    u.uNeonKeep.value = p.neonKeep;
    (u.uShadow.value as THREE.Vector3).set(...p.shadow);
    (u.uHighlight.value as THREE.Vector3).set(...p.highlight);
    u.uTone.value = p.tone;
    (u.uLift.value as THREE.Vector3).set(...p.lift);
    u.uContrast.value = p.contrast;
    u.uVignette.value = p.vignette;
    u.uGrain.value = p.grain;
    u.uFringe.value = p.fringe;
    u.uHalation.value = p.halation;
    (u.uHalColor.value as THREE.Vector3).set(...p.halColor);
  }

  /** A heat wave's shimmer (0-1), and where the horizon is on the screen (0 bottom, 1 top); the scene's depth (and
   * the camera's range) so it bends only what's far off. */
  heat(amount: number, horizonY: number, depth?: THREE.Texture | null, near = 0.1, far = 1000): void {
    this.material.uniforms.tDepth.value = depth ?? null;
    this.material.uniforms.uNear.value = near;
    this.material.uniforms.uFar.value = far;
    if (!depth) amount = 0;
    this.material.uniforms.uHeat.value = amount;
    this.material.uniforms.uHorizonY.value = horizonY;
  }

  /** The sun's glare (0-1) and where the sun is on the screen (0-1 both ways; off screen is fine). */
  glare(amount: number, x: number, y: number): void {
    this.material.uniforms.uGlare.value = amount;
    (this.material.uniforms.uSunPos.value as THREE.Vector2).set(x, y);
  }

  /** time: seconds (grain and drops move); rain: 0-1, drops on the lens. */
  tick(time: number, rain: number): void {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uRain.value = rain;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    (u.uRes.value as THREE.Vector2).set(readBuffer.width, readBuffer.height);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}
