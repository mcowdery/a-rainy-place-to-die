import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Depth of field from the scene's depth buffer (no extra scene render). Each pixel's blur (circle of
 * confusion) grows with how far its depth is from the focus distance; the blur is a disk gather that only
 * takes samples whose own blur reaches the pixel, so sharp foreground doesn't smear over a blurred
 * background. Focus is either a fixed distance or auto: the nearest thing in a small patch at the centre of
 * the view, eased over time in a 1x1 target (like a camera hunting focus).
 *
 * The scene's depth comes from depthSource() each frame: the composer alternates its two targets, so the one
 * holding the scene's depth isn't fixed. The pass reads the colour from wherever the previous pass wrote,
 * blurs into its own target and copies back (never sampling the depth of the framebuffer it draws into).
 */
const common = /* glsl */ `
  #include <packing>
  uniform sampler2D tDepth;
  uniform float uNear;
  uniform float uFar;
  float viewZ(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    return d >= 0.999999 ? uFar : -perspectiveDepthToViewZ(d, uNear, uFar);
  }
`;

const vertex = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class DofPass extends Pass {
  /** 0 off, 1 strong. */
  strength = 0;
  /** Focus distance in metres, or null for auto focus. */
  focus: number | null = null;
  private readonly blur: THREE.ShaderMaterial;
  private readonly copy: THREE.ShaderMaterial;
  private readonly focusMat: THREE.ShaderMaterial;
  private readonly quad = new FullScreenQuad();
  private target: THREE.WebGLRenderTarget;
  private focusRT: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private flip = 0;
  private last = performance.now();

  private readonly tDepth: { value: THREE.Texture | null } = { value: null };

  constructor(
    private readonly depthSource: () => THREE.Texture | null,
    camera: THREE.PerspectiveCamera,
  ) {
    super();
    const shared = { tDepth: this.tDepth, uNear: { value: camera.near }, uFar: { value: camera.far } };
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false } as const;
    this.focusRT = [new THREE.WebGLRenderTarget(1, 1, opts), new THREE.WebGLRenderTarget(1, 1, opts)];
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.focusMat = new THREE.ShaderMaterial({
      uniforms: { ...shared, tPrev: { value: null }, uRate: { value: 0.1 }, uFixed: { value: -1 } },
      vertexShader: vertex,
      fragmentShader: /* glsl */ `
        ${common}
        uniform sampler2D tPrev;
        uniform float uRate;
        uniform float uFixed;
        varying vec2 vUv;
        void main() {
          // The nearest surface in a small patch at the centre of the view.
          float z = uFar;
          for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) z = min(z, viewZ(vec2(0.5) + vec2(float(i), float(j)) * 0.012));
          if (uFixed > 0.0) z = uFixed;
          float prev = texture2D(tPrev, vec2(0.5)).r;
          // Ease in log space (refocusing from 3 m to 300 m and back takes the same time).
          float f = prev <= 0.0 ? z : exp(mix(log(prev), log(z), uRate));
          gl_FragColor = vec4(f, 0.0, 0.0, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.blur = new THREE.ShaderMaterial({
      uniforms: { ...shared, tColor: { value: null }, tFocus: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uMaxR: { value: 0 } },
      vertexShader: vertex,
      fragmentShader: /* glsl */ `
        ${common}
        uniform sampler2D tColor;
        uniform sampler2D tFocus;
        uniform vec2 uRes;
        uniform float uMaxR;
        varying vec2 vUv;
        float focusZ;
        // Blur radius in pixels: 0 at the focus distance, uMaxR far behind it or close in front.
        float coc(vec2 uv) {
          float z = viewZ(uv);
          return uMaxR * clamp(abs(1.0 / focusZ - 1.0 / z) * focusZ, 0.0, 1.0);
        }
        void main() {
          focusZ = max(texture2D(tFocus, vec2(0.5)).r, 0.3);
          float c0 = coc(vUv);
          vec3 acc = texture2D(tColor, vUv).rgb;
          float w = 1.0;
          if (c0 > 0.5) {
            // A disk of samples (golden-angle spiral) sized by this pixel's blur.
            const int N = 32;
            for (int i = 0; i < N; i++) {
              float r = sqrt((float(i) + 0.5) / float(N)) * c0;
              float a = float(i) * 2.39996;
              vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uRes;
              float cs = coc(uv);
              // Only samples blurred enough to reach this pixel (no sharp edges smeared outward).
              float k = smoothstep(r - 1.0, r + 1.0, cs + 0.5);
              acc += texture2D(tColor, uv).rgb * k;
              w += k;
            }
          }
          gl_FragColor = vec4(acc / w, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.copy = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null } },
      vertexShader: vertex,
      fragmentShader: 'uniform sampler2D tColor; varying vec2 vUv; void main() { gl_FragColor = texture2D(tColor, vUv); }',
      depthTest: false,
      depthWrite: false,
    });
    this.needsSwap = false;
  }

  /** The current focus distance (debug: reads back the 1x1 target). */
  readFocus(renderer: THREE.WebGLRenderer): number {
    const out = new Uint16Array(4);
    renderer.readRenderTargetPixels(this.focusRT[this.flip ? 0 : 1], 0, 0, 1, 1, out);
    return THREE.DataUtils.fromHalfFloat(out[0]);
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this.needsSwap = false;
    this.tDepth.value = this.depthSource();
    if (this.strength <= 0.001 || !this.tDepth.value) return;
    if (this.target.width !== readBuffer.width || this.target.height !== readBuffer.height) this.target.setSize(readBuffer.width, readBuffer.height);
    // Focus: ease toward the new distance (about half a second).
    const [prev, next] = this.flip ? [this.focusRT[1], this.focusRT[0]] : [this.focusRT[0], this.focusRT[1]];
    this.flip ^= 1;
    this.focusMat.uniforms.tPrev.value = prev.texture;
    this.focusMat.uniforms.uRate.value = 1 - Math.exp(-dt * 6);
    this.focusMat.uniforms.uFixed.value = this.focus ?? -1;
    this.quad.material = this.focusMat;
    renderer.setRenderTarget(next);
    this.quad.render(renderer);
    // Blur into our target, then copy back into the read buffer for the next pass.
    const u = this.blur.uniforms;
    u.tColor.value = readBuffer.texture;
    u.tFocus.value = next.texture;
    (u.uRes.value as THREE.Vector2).set(readBuffer.width, readBuffer.height);
    u.uMaxR.value = this.strength * 16 * (readBuffer.height / 1000);
    this.quad.material = this.blur;
    // Reading from the target that owns the depth texture: write straight to the other one and swap.
    if (readBuffer.depthTexture === this.tDepth.value) {
      renderer.setRenderTarget(writeBuffer);
      this.quad.render(renderer);
      this.needsSwap = true;
      return;
    }
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
    this.copy.uniforms.tColor.value = this.target.texture;
    this.quad.material = this.copy;
    renderer.setRenderTarget(readBuffer);
    this.quad.render(renderer);
  }
}
