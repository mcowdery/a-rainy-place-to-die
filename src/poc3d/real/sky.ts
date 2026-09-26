import * as THREE from 'three';

/**
 * Sky dome: zenith-to-horizon gradient (the horizon carries the city's light-pollution glow at night), a
 * sun or moon disc with a halo, stars on clear nights, and a drifting cloud layer: lit by the sun by day and
 * from below by the city's glow at night, thin and broken when clear, a low overcast in rain.
 * Follows the camera; drawn first, no depth.
 */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3).normalize() },
    uSunColor: { value: new THREE.Color() },
    uDisc: { value: 1 },
    uStars: { value: 0 },
    uTime: { value: 0 },
    /** Cloud cover 0-1, the lit underside colour, the colour of the cloud tops / unlit parts. */
    uCover: { value: 0.3 },
    uCloudLit: { value: new THREE.Color() },
    uCloudDark: { value: new THREE.Color() },
  };

  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      // Drawn after the opaque city with the depth test on, so it only shades where sky actually shows
      // (the clouds are the most expensive pixels on screen). Depth stays clear there for the overlay.
      depthTest: true,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uDisc;
        uniform float uStars;
        uniform float uTime;
        uniform float uCover;
        uniform vec3 uCloudLit;
        uniform vec3 uCloudDark;
        varying vec3 vDir;
        float h3(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
        float h2(vec2 p) { return h3(vec3(p, 1.7)); }
        float vn(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float s = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; }
          return s;
        }
        void main() {
          vec3 d = normalize(vDir);
          vec3 col = d.y >= 0.0 ? mix(uHorizon, uZenith, pow(d.y, 0.45)) : uHorizon * mix(1.0, 0.45, clamp(-d.y * 6.0, 0.0, 1.0));
          float sd = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSunColor * (step(0.99965, sd) * 12.0 * uDisc + pow(sd, 12.0) * 0.35 + pow(sd, 3.0) * 0.08);
          if (uStars > 0.0 && d.y > 0.08) {
            vec3 cell = floor(d * 380.0);
            float s = h3(cell);
            if (s > 0.9975) col += vec3(0.7, 0.75, 0.9) * uStars * (s - 0.9975) * 400.0 * smoothstep(0.08, 0.4, d.y) * (1.0 - smoothstep(0.3, 0.7, uCover));
          }
          // Clouds on a plane overhead, seen through the dome; they thin toward the horizon's haze.
          if (d.y > 0.0 && uCover > 0.0) {
            vec2 q = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
            float n = fbm(q);
            float dens = smoothstep(1.0 - uCover - 0.1, 1.0 - uCover + 0.35, n);
            // Underside lit where the cloud is thick (city glow from below at night), darker where thin.
            float under = smoothstep(0.3, 0.85, vn(q * 3.4 + 3.0) * 0.6 + vn(q * 7.1) * 0.4);
            vec3 cloud = mix(uCloudDark, uCloudLit, 0.35 + 0.65 * under);
            float fade = smoothstep(0.0, 0.18, d.y);
            col = mix(col, cloud, dens * fade * 0.92);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1150, 32, 16), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1000;
  }

  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }
}
