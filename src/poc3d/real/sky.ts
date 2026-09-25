import * as THREE from 'three';

/**
 * Sky dome: zenith-to-horizon gradient (the horizon carries the city's light-pollution glow at night), a
 * sun or moon disc with a halo, and stars on clear nights. Follows the camera; drawn first, no depth.
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
  };

  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
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
        varying vec3 vDir;
        float h3(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
        void main() {
          vec3 d = normalize(vDir);
          vec3 col = d.y >= 0.0 ? mix(uHorizon, uZenith, pow(d.y, 0.45)) : uHorizon * mix(1.0, 0.45, clamp(-d.y * 6.0, 0.0, 1.0));
          float sd = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSunColor * (step(0.99965, sd) * 12.0 * uDisc + pow(sd, 12.0) * 0.35 + pow(sd, 3.0) * 0.08);
          if (uStars > 0.0 && d.y > 0.08) {
            vec3 cell = floor(d * 380.0);
            float s = h3(cell);
            if (s > 0.9975) col += vec3(0.7, 0.75, 0.9) * uStars * (s - 0.9975) * 400.0 * smoothstep(0.08, 0.4, d.y);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }
}
