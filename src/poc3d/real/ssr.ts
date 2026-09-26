import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Screen-space reflections for wet ground and roofs, right after the scene render. For each pixel facing
 * up (normal reconstructed from depth), a ray is marched along the reflection through the depth buffer at
 * half resolution; where it hits, that part of the image (neon, signs, windows, cars) is reflected, with
 * water's Fresnel, stronger in puddles and weaker on merely damp ground, and distorted by rain ripples in
 * the puddles. Misses add nothing (the city shader's lightmap streaks stay as the fallback). The result is
 * added onto the scene image in place, so the scene target (and its depth) stays where later passes
 * expect it. Puddles use the same noise as the ground shader in city.ts, so they line up.
 */
const vertex = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const fragment = /* glsl */ `
  #include <packing>
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform mat4 uProj;
  uniform mat4 uInvProj;
  uniform mat4 uView;
  uniform mat4 uInvView;
  uniform vec2 uTexel;
  uniform float uNear;
  uniform float uFar;
  uniform float uWet;
  uniform float uRain;
  uniform float uTime;
  varying vec2 vUv;

  float h2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  vec3 viewPos(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }
  float sceneDepth(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    return -perspectiveDepthToViewZ(d, uNear, uFar);
  }
  // Rain rings in the puddles: each cell drops a ring now and then; returns the slope it adds.
  vec2 ripples(vec2 p) {
    vec2 acc = vec2(0.0);
    for (int layer = 0; layer < 2; layer++) {
      float s = layer == 0 ? 2.3 : 3.7;
      vec2 q = p * s + float(layer) * 13.1;
      vec2 cell = floor(q);
      float h = h2(cell);
      vec2 local = fract(q) - 0.5 - (vec2(h, h2(cell + 5.3)) - 0.5) * 0.5;
      float phase = fract(uTime * (0.7 + 0.6 * h) + h * 9.0);
      float r = length(local);
      float R = phase * 0.5;
      float ring = (r - R) * exp(-(r - R) * (r - R) * 900.0) * (1.0 - phase) * step(h, uRain);
      acc += local / max(r, 1e-3) * ring * 6.0;
    }
    return acc;
  }

  void main() {
    float d = texture2D(tDepth, vUv).x;
    if (d >= 0.999999 || uWet <= 0.0) { gl_FragColor = vec4(0.0); return; }
    vec3 p = viewPos(vUv);
    vec3 px = viewPos(vUv + vec2(uTexel.x, 0.0)) - p;
    vec3 py = viewPos(vUv + vec2(0.0, uTexel.y)) - p;
    vec3 nV = normalize(cross(px, py));
    vec3 nW = normalize(mat3(uInvView) * nV);
    if (nW.y < 0.0) nW = -nW;
    if (nW.y < 0.9) { gl_FragColor = vec4(0.0); return; }
    vec3 wp = (uInvView * vec4(p, 1.0)).xyz;
    // Same puddles as the ground shader.
    float pn = vnoise(wp.xz * 0.22) + 0.12 * vnoise(wp.xz * 1.9);
    float puddle = smoothstep(0.62, 0.68, pn) * smoothstep(0.35, 0.9, uWet);
    float wet = uWet * (0.22 + 0.78 * puddle);
    // Flat water, rippled by the rain in the puddles.
    vec3 n = vec3(0.0, 1.0, 0.0);
    if (uRain > 0.0 && puddle > 0.0) {
      vec2 s = ripples(wp.xz) * puddle;
      n = normalize(vec3(-s.x, 1.0, -s.y));
    }
    vec3 cam = uInvView[3].xyz;
    vec3 vd = normalize(wp - cam);
    vec3 rW = reflect(vd, n);
    vec3 rV = normalize(mat3(uView) * rW);
    float cosT = clamp(-dot(vd, n), 0.0, 1.0);
    float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
    // March: steps growing with distance, then refine the crossing.
    float t = 0.4;
    float prevT = 0.0;
    vec2 hitUv = vec2(-1.0);
    for (int i = 0; i < 44; i++) {
      vec3 q = p + rV * t;
      if (q.z > -uNear) break;
      vec4 c = uProj * vec4(q, 1.0);
      vec2 uv = c.xy / c.w * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
      float sz = sceneDepth(uv);
      float rz = -q.z;
      if (rz > sz + 0.05 && rz - sz < max(0.8, t * 0.12)) {
        // Binary search between the last step in front and this one behind.
        float a = prevT, b = t;
        for (int k = 0; k < 5; k++) {
          float m = 0.5 * (a + b);
          vec3 qm = p + rV * m;
          vec4 cm = uProj * vec4(qm, 1.0);
          vec2 um = cm.xy / cm.w * 0.5 + 0.5;
          if (-qm.z > sceneDepth(um)) { b = m; hitUv = um; } else a = m;
        }
        if (hitUv.x < 0.0) hitUv = uv;
        break;
      }
      prevT = t;
      t = t * 1.13 + 0.35;
    }
    if (hitUv.x < 0.0) { gl_FragColor = vec4(0.0); return; }
    // Fade toward the screen edges and with distance travelled.
    vec2 e = smoothstep(0.0, 0.08, hitUv) * smoothstep(0.0, 0.08, 1.0 - hitUv);
    float fade = e.x * e.y * (1.0 - smoothstep(60.0, 160.0, t));
    vec3 col = min(texture2D(tColor, hitUv).rgb, vec3(12.0));
    gl_FragColor = vec4(col * F * wet * fade * 1.4, 1.0);
  }
`;

export class SsrPass extends Pass {
  /** Ground wetness 0-1 and rain 0-1 (ripples). */
  wet = 0;
  rain = 0;
  private readonly mat: THREE.ShaderMaterial;
  private readonly add: THREE.ShaderMaterial;
  private readonly quad = new FullScreenQuad();
  private readonly target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private time = 0;
  private last = performance.now();

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    super();
    this.needsSwap = false;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uProj: { value: new THREE.Matrix4() },
        uInvProj: { value: new THREE.Matrix4() },
        uView: { value: new THREE.Matrix4() },
        uInvView: { value: new THREE.Matrix4() },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: camera.near },
        uFar: { value: camera.far },
        uWet: { value: 0 },
        uRain: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
      depthTest: false,
      depthWrite: false,
    });
    this.add = new THREE.ShaderMaterial({
      uniforms: { tRefl: { value: this.target.texture } },
      vertexShader: vertex,
      fragmentShader: 'uniform sampler2D tRefl; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tRefl, vUv).rgb, 1.0); }',
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
  }

  render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const now = performance.now();
    this.time += Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (this.wet <= 0.01 || !readBuffer.depthTexture) return;
    const w = Math.max(1, Math.floor(readBuffer.width / 2));
    const h = Math.max(1, Math.floor(readBuffer.height / 2));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    const u = this.mat.uniforms;
    const cam = this.camera;
    u.tColor.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    (u.uProj.value as THREE.Matrix4).copy(cam.projectionMatrix);
    (u.uInvProj.value as THREE.Matrix4).copy(cam.projectionMatrix).invert();
    (u.uView.value as THREE.Matrix4).copy(cam.matrixWorldInverse);
    (u.uInvView.value as THREE.Matrix4).copy(cam.matrixWorld);
    (u.uTexel.value as THREE.Vector2).set(1 / readBuffer.width, 1 / readBuffer.height);
    u.uWet.value = this.wet;
    u.uRain.value = this.rain;
    u.uTime.value = this.time;
    this.quad.material = this.mat;
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
    // Add the reflections onto the scene image in place (no clear).
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.quad.material = this.add;
    renderer.setRenderTarget(readBuffer);
    this.quad.render(renderer);
    renderer.autoClear = autoClear;
  }
}
