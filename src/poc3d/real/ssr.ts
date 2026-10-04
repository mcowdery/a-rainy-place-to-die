import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { WaterSky } from './sea';
import { WATER_GLSL } from './waterGlsl';

/**
 * Screen-space reflections for wet ground and roofs, right after the scene render. For each pixel facing
 * up (normal reconstructed from depth and turned toward the camera, so undersides overhead are left out), a ray
 * is marched along the reflection through the depth buffer at half resolution; where it hits, that part of the image (neon, signs, windows, cars) is reflected, with
 * water's Fresnel, stronger in puddles and weaker on merely damp ground, and distorted by rain ripples in
 * the puddles. Misses add nothing (the city shader's lightmap streaks stay as the fallback). The result is
 * added onto the scene image in place, so the scene target (and its depth) stays where later passes
 * expect it. Puddles use the same noise as the ground shader in city.ts, so they line up.
 *
 * Open water (a pond, the river, the bay) reflects whatever the weather: its shaders mark their pixels in the
 * scene's alpha and already show the sky in their ripples (waterGlsl.ts); here the same ripple's ray is marched,
 * and where it hits, what's there takes the sky's place (so a hit adds the difference, which may darken: a tree
 * in the water is darker than the sky it hides). Rain rings break the reflections up.
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
  uniform float uWater;
  uniform float uWaterTime;
  uniform vec3 uWaterWind;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  varying vec2 vUv;
  ${WATER_GLSL}

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

  // Water's rays: long (the far bank, across the bay) and after small bright things (a sign, a row of lit
  // windows), which steps that grow with distance stride over. So the ray is walked evenly across the screen
  // instead, from p along rV (view space) to the screen's edge or 640 m, its depth interpolated as 1/w is,
  // each pixel starting a little apart so the steps show as grain, not bands. Returns where it struck (uv, or
  // -1) and how far it had gone.
  vec2 marchWater(vec3 p, vec3 rV, out float gone) {
    float len = 640.0;
    if (p.z + rV.z * len > -uNear) len = (-uNear - p.z) / rV.z * 0.98;
    vec3 p1 = p + rV * len;
    vec4 h0 = uProj * vec4(p, 1.0);
    vec4 h1 = uProj * vec4(p1, 1.0);
    float k0 = 1.0 / h0.w;
    float k1 = 1.0 / h1.w;
    vec2 s0 = h0.xy * k0 * 0.5 + 0.5;
    vec2 ds = h1.xy * k1 * 0.5 + 0.5 - s0;
    float m = 1.0;
    if (ds.x > 0.0) m = min(m, (1.0 - s0.x) / ds.x); else if (ds.x < 0.0) m = min(m, -s0.x / ds.x);
    if (ds.y > 0.0) m = min(m, (1.0 - s0.y) / ds.y); else if (ds.y < 0.0) m = min(m, -s0.y / ds.y);
    vec3 q0 = p * k0;
    vec3 q1 = p1 * k1;
    float jit = h2(gl_FragCoord.xy);
    float prevA = 0.0;
    float prevZ = -p.z;
    gone = 0.0;
    for (int i = 1; i <= 48; i++) {
      float a = m * (float(i) - 0.5 * jit) / 48.0;
      float k = mix(k0, k1, a);
      float rz = -mix(q0.z, q1.z, a) / k;
      vec2 uv = s0 + ds * a;
      float sz = sceneDepth(uv);
      if (rz > sz + 0.08 && rz - sz < max(1.5, (rz - prevZ) * 1.5 + 0.02 * rz)) {
        // Between the last step in front and this one behind.
        float lo = prevA, hi = a;
        for (int j = 0; j < 5; j++) {
          float mid = 0.5 * (lo + hi);
          float km = mix(k0, k1, mid);
          if (-mix(q0.z, q1.z, mid) / km > sceneDepth(s0 + ds * mid)) hi = mid; else lo = mid;
        }
        gone = distance(mix(q0, q1, hi) / mix(k0, k1, hi), p);
        return s0 + ds * hi;
      }
      prevA = a;
      prevZ = rz;
    }
    return vec2(-1.0);
  }

  void main() {
    float d = texture2D(tDepth, vUv).x;
    // Open water marks itself in the scene's alpha (waterGlsl.ts); it reflects wet or dry.
    bool water = uWater > 0.5 && texture2D(tColor, vUv).a < 0.5;
    if (d >= 0.999999 || (uWet <= 0.0 && !water)) { gl_FragColor = vec4(0.0); return; }
    vec3 p = viewPos(vUv);
    vec3 px = viewPos(vUv + vec2(uTexel.x, 0.0)) - p;
    vec3 py = viewPos(vUv + vec2(0.0, uTexel.y)) - p;
    vec3 nV = normalize(cross(px, py));
    // Turned toward the camera, so only faces that really face up pass: a ceiling seen from below (an
    // expressway deck's or a viaduct's underside) faces down and reflects nothing.
    if (dot(nV, p) > 0.0) nV = -nV;
    vec3 nW = normalize(mat3(uInvView) * nV);
    if (nW.y < 0.9) { gl_FragColor = vec4(0.0); return; }
    vec3 wp = (uInvView * vec4(p, 1.0)).xyz;
    // Same puddles as the ground shader.
    float pn = vnoise(wp.xz * 0.22) + 0.12 * vnoise(wp.xz * 1.9);
    float puddle = smoothstep(0.62, 0.68, pn) * smoothstep(0.35, 0.9, uWet);
    float wet = uWet * (0.22 + 0.78 * puddle);
    // Flat water, rippled by the rain in the puddles.
    vec3 n = vec3(0.0, 1.0, 0.0);
    vec3 cam = uInvView[3].xyz;
    if (water) {
      // The water's own ripples (the same as its shader's), and the rain's rings on them.
      // (Half their slope: a ripple scatters a far reflection into noise long before it looks rough itself.)
      float foot = waterFoot(wp, cam);
      vec2 s = waterSlope(wp.xz, uWaterTime, uWaterWind, foot) * 0.5;
      // Ripples too small to see from here still tilt the mirror toward you and away: they draw a reflection
      // out down the water (a light's long streak), by a slope along the line of sight that differs from one
      // wavelet to the next, more the less of them a pixel resolves.
      vec2 toCam = normalize(cam.xz - wp.xz);
      float wavelet = wtrNoise(wp.xz * 7.0 + uWaterTime * 1.1) + wtrNoise(wp.xz * 19.0 - uWaterTime * 1.7) - 1.0;
      s += toCam * wavelet * (0.018 + 0.04 * smoothstep(0.05, 0.6, foot)) * (0.6 + 0.4 * min(uWaterWind.z, 1.4));
      if (uRain > 0.0) s += ripples(wp.xz) * 0.6;
      n = waterNormal(s);
    } else if (uRain > 0.0 && puddle > 0.0) {
      vec2 s = ripples(wp.xz) * puddle;
      n = normalize(vec3(-s.x, 1.0, -s.y));
    }
    vec3 vd = normalize(wp - cam);
    vec3 rW = reflect(vd, n);
    // (A ray a steep ripple throws down into the water is the ray it would throw up.)
    if (water) rW.y = abs(rW.y);
    vec3 rV = normalize(mat3(uView) * rW);
    float cosT = clamp(-dot(vd, n), 0.0, 1.0);
    float F = water ? waterFresnel(cosT) : 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
    // March: steps growing with distance, then refine the crossing (water: its own, even across the screen).
    float t = 0.4;
    float prevT = 0.0;
    vec2 hitUv = vec2(-1.0);
    if (water) hitUv = marchWater(p, rV, t);
    else for (int i = 0; i < 44; i++) {
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
    // (Water carries a reflection much further than a wet street: the far bank's lights, a tower across the bay.)
    float fade = e.x * e.y * (1.0 - (water ? smoothstep(320.0, 640.0, t) : smoothstep(60.0, 160.0, t)));
    vec3 col = min(texture2D(tColor, hitUv).rgb, vec3(12.0));
    // Water already shows the sky along this ray: what the ray hit takes its place.
    if (water) gl_FragColor = vec4((col - waterSky(rW, uHorizon, uZenith)) * F * fade, 1.0);
    else gl_FragColor = vec4(col * F * wet * fade * 1.4, 1.0);
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
  private water = false;

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
        uWater: { value: 0 },
        uWaterTime: { value: 0 },
        uWaterWind: { value: new THREE.Vector3(1, 0, 0) },
        uHorizon: { value: new THREE.Color() },
        uZenith: { value: new THREE.Color() },
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

  /**
   * Open water in the scene (real/sea.ts, the ponds): the pass then runs dry too, reflecting in whatever marks
   * itself as water, with the city's sky, clock and wind (the uniforms the water's shaders use: shared, not copied).
   */
  setWater(sky: WaterSky): void {
    const u = this.mat.uniforms;
    u.uWater.value = 1;
    u.uWaterTime = sky.uTime;
    u.uWaterWind = sky.uWind;
    u.uHorizon = sky.uHorizon;
    u.uZenith = sky.uZenith;
    this.water = true;
  }

  render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const now = performance.now();
    this.time += Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if ((this.wet <= 0.01 && !this.water) || !readBuffer.depthTexture) return;
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
