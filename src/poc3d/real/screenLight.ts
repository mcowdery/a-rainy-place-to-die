import * as THREE from 'three';

/**
 * Light from big screens (the mega-sign's LED screens, the idol agency's and the ad agency's): each screen
 * is a rectangular area light whose colour follows what it's showing, updated every frame, so when the ad
 * changes from a red lipstick close-up to a blue soda can, the street, the walls across it and the rain in
 * front change colour with it.
 *
 * The city shader (and the rain) evaluate the SCREEN_LIGHTS screens nearest the camera: the irradiance of
 * a Lambertian rectangle approximated by a disk of the same area seen from its nearest point,
 * E = L * A / (A / pi + d^2), times the screen's own facing (it only lights what's in front of it) and the
 * receiving surface's cosine. Reflections of the screens in wet ground come from ssr.ts.
 */
export const SCREEN_LIGHTS = 8;

export interface ScreenLight {
  /** Centre of the screen (world), its outward normal (horizontal, unit), half width and half height. */
  readonly centre: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly halfW: number;
  readonly halfH: number;
  /** Its current average emitted colour (linear, HDR), written into out. */
  colour(time: number, neon: number, out: THREE.Color): THREE.Color;
}

export interface ScreenUniforms {
  /** Per screen: centre xyz, half width; right.xz, normal.xz; colour rgb, half height. */
  uScreenP: { value: THREE.Vector4[] };
  uScreenA: { value: THREE.Vector4[] };
  uScreenC: { value: THREE.Vector4[] };
  uScreenCount: { value: number };
}

export function screenUniforms(): ScreenUniforms {
  const v = (): THREE.Vector4[] => Array.from({ length: SCREEN_LIGHTS }, () => new THREE.Vector4());
  return { uScreenP: { value: v() }, uScreenA: { value: v() }, uScreenC: { value: v() }, uScreenCount: { value: 0 } };
}

/** GLSL: uniforms and screenLight(p, n, useN): irradiance at p (useN 0 ignores the surface's facing). */
export const screenLightGlsl = /* glsl */ `
  uniform vec4 uScreenP[${SCREEN_LIGHTS}];
  uniform vec4 uScreenA[${SCREEN_LIGHTS}];
  uniform vec4 uScreenC[${SCREEN_LIGHTS}];
  uniform int uScreenCount;
  vec3 screenLight(vec3 p, vec3 n, float useN) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < ${SCREEN_LIGHTS}; i++) {
      if (i >= uScreenCount) break;
      vec4 P = uScreenP[i];
      vec4 A = uScreenA[i];
      vec4 C = uScreenC[i];
      vec3 d = p - P.xyz;
      vec3 nn = vec3(A.z, 0.0, A.w);
      float front = dot(d, nn);
      float d2 = dot(d, d);
      if (front <= 0.02 || d2 > 90000.0) continue;
      vec3 r = vec3(A.x, 0.0, A.y);
      vec3 q = P.xyz + r * clamp(dot(d, r), -P.w, P.w) + vec3(0.0, clamp(d.y, -C.w, C.w), 0.0);
      vec3 L = q - p;
      float dd = max(dot(L, L), 1e-4);
      vec3 l = L * inversesqrt(dd);
      float area = 4.0 * P.w * C.w;
      // The screen's own facing, softened near its plane; the receiver's cosine.
      float fe = clamp(front * inversesqrt(d2) * 1.4, 0.0, 1.0);
      float fr = mix(1.0, clamp(dot(n, l), 0.0, 1.0), useN);
      acc += C.rgb * area / (area * 0.3183 + dd) * fe * fr;
    }
    return acc;
  }
`;

/** Average colour (linear) of a region of an image, by drawing it into a tiny canvas. */
export function averageColour(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): THREE.Color {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 9;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src, sx, sy, sw, sh, 0, 0, 16, 9);
  const d = g.getImageData(0, 0, 16, 9).data;
  // The eye reads a screen's light by its colourful parts, and a plain average washes out to grey: weight
  // the saturated pixels up, then push the saturation of the result, keeping the average brightness.
  const out = new THREE.Color(0, 0, 0);
  const tmp = new THREE.Color();
  let wsum = 0;
  let lum = 0;
  for (let i = 0; i < d.length; i += 4) {
    tmp.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, THREE.SRGBColorSpace);
    const hi = Math.max(tmp.r, tmp.g, tmp.b);
    const w = 1 + 6 * (hi - Math.min(tmp.r, tmp.g, tmp.b)) * hi;
    out.r += tmp.r * w;
    out.g += tmp.g * w;
    out.b += tmp.b * w;
    wsum += w;
    lum += 0.2126 * tmp.r + 0.7152 * tmp.g + 0.0722 * tmp.b;
  }
  out.multiplyScalar(1 / wsum);
  const y = 0.2126 * out.r + 0.7152 * out.g + 0.0722 * out.b;
  const sat = 1.8;
  out.setRGB(Math.max(0, y + (out.r - y) * sat), Math.max(0, y + (out.g - y) * sat), Math.max(0, y + (out.b - y) * sat));
  const y2 = 0.2126 * out.r + 0.7152 * out.g + 0.0722 * out.b;
  return y2 > 1e-4 ? out.multiplyScalar(lum / (16 * 9) / y2) : out;
}

/** Picks the screens nearest the camera each frame and writes them into the uniforms. */
export class ScreenLights {
  private readonly all: ScreenLight[] = [];
  private readonly col = new THREE.Color();

  constructor(
    private readonly u: ScreenUniforms,
    /** Overall strength (tune how much the screens light the street). */
    public gain = 8,
  ) {}

  add(...lights: ScreenLight[]): void {
    this.all.push(...lights);
  }

  update(camera: THREE.Vector3, time: number, neon: number): void {
    const near = this.all
      .map((s) => ({ s, d: s.centre.distanceToSquared(camera) }))
      .filter((x) => x.d < 260 * 260)
      .sort((a, b) => a.d - b.d)
      .slice(0, SCREEN_LIGHTS);
    near.forEach(({ s }, i) => {
      this.u.uScreenP.value[i].set(s.centre.x, s.centre.y, s.centre.z, s.halfW);
      this.u.uScreenA.value[i].set(-s.normal.z, s.normal.x, s.normal.x, s.normal.z);
      s.colour(time, neon, this.col).multiplyScalar(this.gain);
      this.u.uScreenC.value[i].set(this.col.r, this.col.g, this.col.b, s.halfH);
    });
    this.u.uScreenCount.value = near.length;
  }
}
