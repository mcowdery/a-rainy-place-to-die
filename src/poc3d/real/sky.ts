import * as THREE from 'three';
import { EL_MIN, SKY_AZ, SKY_EL } from './skyModel';

/**
 * The moon's looks (the debug menu's Moon, ?moonShape=): its angular radius (radians; the real moon's is 0.0045, drawn
 * larger as photographs and films do), its phase (degrees from full: 90 a half moon), the edge's softness (a share
 * of the radius), the glow round it and the faint 22-degree ring of thin high cloud, and how much moonlight it gives
 * the city (a crescent lights little). `calendar` follows the lunar calendar (the phase of the story's day); `classic` is
 * the old disc, the sun's with its wide glow.
 */
export const MOON_SHAPES = ['calendar', 'full', 'gibbous', 'half', 'crescent', 'hazy', 'classic'] as const;
export type MoonShape = (typeof MOON_SHAPES)[number];
export const MOON_SHAPE: Record<MoonShape, { r: number; phase: number; soft: number; halo: number; ring: number; light: number }> = {
  // The lunar calendar's moon (clock.ts moonAt): its phase and light are the day's, given to setMoonShape.
  calendar: { r: 0.0095, phase: 0, soft: 0, halo: 0.05, ring: 0, light: 1 },
  full: { r: 0.0095, phase: 0, soft: 0, halo: 0.05, ring: 0, light: 1 },
  gibbous: { r: 0.0095, phase: 50, soft: 0, halo: 0.04, ring: 0, light: 0.8 },
  half: { r: 0.0095, phase: 90, soft: 0, halo: 0.03, ring: 0, light: 0.5 },
  crescent: { r: 0.0095, phase: 128, soft: 0, halo: 0.02, ring: 0, light: 0.22 },
  // 朧月 oborozuki, the spring moon through haze: blurred, in a wide soft glow, a faint ring far out.
  hazy: { r: 0.011, phase: 8, soft: 0.22, halo: 0.12, ring: 0.02, light: 0.8 },
  classic: { r: 0, phase: 0, soft: 0, halo: 0, ring: 0, light: 1 },
};

/**
 * Sky dome: zenith-to-horizon gradient (the horizon carries the city's light-pollution glow at night), a
 * sun or moon disc with a halo, stars on clear nights, and a drifting cloud layer: lit by the sun by day and
 * from below by the city's glow at night, thin and broken when clear, a low overcast in rain. With uMountains, the
 * mountains round the city on the horizon (north and west, the bay open to the south): a near range and a paler
 * one behind, and to the west-south-west a lone snow-capped cone (a Fuji); hazy at their feet, dark against the
 * city's glow at night, in front of the setting sun.
 * Follows the camera; drawn first, no depth.
 */
const moonArt = import.meta.glob('../../../assets/sky/moon_*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** The physical sky's table as a texture (half floats, filtered), filled by Sky.setPhysical. */
function physTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint16Array(SKY_AZ * SKY_EL * 4), SKY_AZ, SKY_EL, THREE.RGBAFormat, THREE.HalfFloatType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** A 1x1 grey texture for the moon's samplers until its maps load (so the shader compiles once, with them). */
function placeholder(): THREE.Texture {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3).normalize() },
    uSunColor: { value: new THREE.Color() },
    uDisc: { value: 1 },
    uStars: { value: 0 },
    /** How much of the field shows (1 a dark sky's; a city's light leaves only the brightest, high up). */
    uStarField: { value: 1 },
    uTime: { value: 0 },
    /** Cloud cover 0-1, the lit underside colour, the colour of the cloud tops / unlit parts. */
    uCover: { value: 0.3 },
    /** Lightning: the flash 0-1 and the direction toward the strike. */
    uFlash: { value: 0 },
    uFlashDir: { value: new THREE.Vector3(1, 0.3, 0).normalize() },
    uCloudLit: { value: new THREE.Color() },
    uCloudDark: { value: new THREE.Color() },
    /** The mountains on the horizon (the city's page; 0 elsewhere). */
    uMountains: { value: 0 },
    /** Winter: snow on the ranges' tops as well as the cone (0-1). */
    uWinter: { value: 0 },
    /** How far the disc is the moon (0 the sun, 1 the moon; clock.ts moonnessAt), and the moon's look (MOON_SHAPE). */
    uMoon: { value: 0 },
    /** Where the sun's disc really is and how far it's up (clock.ts sunAt; the key light, uSunDir, hands over to the moon). */
    uSunPos: { value: new THREE.Vector3(0.4, 0.6, 0.3).normalize() },
    uSunUp: { value: 1 },
    /** The glow round the sun low on the horizon (linear; the atmosphere's sunGlow): sunrise and sunset colour. */
    uSunGlow: { value: new THREE.Color(0, 0, 0) },
    /**
     * The physical sky (real/skyModel.ts) for the sun's height now, a table of directions (setPhysical), how much of
     * the sky is it (the atmosphere's phys) and its brightness (the darkness setting dims it as it dims the rest).
     */
    uSkyLut: { value: physTexture() },
    uPhys: { value: 0 },
    uPhysGain: { value: 1 },
    /**
     * The painted palette over the physical sky (the Sky colours setting's tinted and mixed): per-channel factors that
     * turn the physical horizon's hue to the painted horizon's and the zenith's to the painted zenith's (main.ts
     * works them out each minute; brightness stays the physical sky's), and how much of them applies.
     */
    uTintH: { value: new THREE.Vector3(1, 1, 1) },
    uTintZ: { value: new THREE.Vector3(1, 1, 1) },
    uTint: { value: 0 },
    /** Where the moon is (clock.ts moonAt: it rises and sets on the lunar calendar) and how far it's up (0 set, 1 risen). */
    uMoonDir: { value: new THREE.Vector3(-0.35, 0.7, -0.55).normalize() },
    uMoonUp: { value: 1 },
    uMoonClassic: { value: 0 },
    uMoonR: { value: 0.0095 },
    uMoonPhase: { value: 0 },
    uMoonSoft: { value: 0 },
    uMoonHalo: { value: 0.05 },
    uMoonRing: { value: 0 },
    uMoonCol: { value: new THREE.Color(0.86, 0.88, 0.9) },
    /** The real moon (assets/sky, from NASA's CGI Moon Kit: scripts/sky/moon_maps.py) once its maps load; until then the drawn one. */
    uMoonTex: { value: 0 },
    uMoonAlb: { value: placeholder() },
    uMoonNrm: { value: placeholder() },
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
        uniform float uStarField;
        uniform float uTime;
        uniform float uCover;
        uniform float uFlash;
        uniform vec3 uFlashDir;
        uniform vec3 uCloudLit;
        uniform vec3 uCloudDark;
        uniform float uMountains;
        uniform float uWinter;
        uniform float uMoon;
        uniform vec3 uSunPos;
        uniform float uSunUp;
        uniform vec3 uSunGlow;
        uniform sampler2D uSkyLut;
        uniform float uPhys;
        uniform float uPhysGain;
        uniform vec3 uTintH;
        uniform vec3 uTintZ;
        uniform float uTint;
        uniform vec3 uMoonDir;
        uniform float uMoonUp;
        uniform float uMoonClassic;
        uniform float uMoonR;
        uniform float uMoonPhase;
        uniform float uMoonSoft;
        uniform float uMoonHalo;
        uniform float uMoonRing;
        uniform vec3 uMoonCol;
        uniform float uMoonTex;
        uniform sampler2D uMoonAlb;
        uniform sampler2D uMoonNrm;
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
        // The near side's maria (x across the face, y up, the unit disc), the dark seas that read as the rabbit pounding
        // mochi (月の兎): each an ellipse with a ragged edge; dark where they overlap no further.
        float mare(vec2 q, vec2 c, vec2 r) { vec2 e = (q - c) / (r * 1.6); return 1.0 - smoothstep(0.5, 1.15, length(e)); }
        float maria(vec2 q) {
          // Bent a little so they aren't ellipses (a gentle warp: a strong one folds them up).
          vec2 w = q + 0.07 * vec2(vn(q * 2.5) - 0.5, vn(q * 2.5 + 9.0) - 0.5);
          float m = 0.0;
          m = max(m, 0.8 * mare(w, vec2(-0.58, 0.1), vec2(0.3, 0.56)));    // Oceanus Procellarum
          m = max(m, mare(w, vec2(-0.3, 0.42), vec2(0.33, 0.29)));         // Imbrium
          m = max(m, mare(w, vec2(0.15, 0.42), vec2(0.2, 0.19)));          // Serenitatis
          m = max(m, mare(w, vec2(0.33, 0.12), vec2(0.25, 0.21)));         // Tranquillitatis
          m = max(m, mare(w, vec2(0.71, 0.3), vec2(0.13, 0.15)));          // Crisium
          m = max(m, 0.9 * mare(w, vec2(0.56, -0.12), vec2(0.15, 0.22)));  // Fecunditatis
          m = max(m, 0.9 * mare(w, vec2(0.38, -0.3), vec2(0.12, 0.12)));   // Nectaris
          m = max(m, 0.8 * mare(w, vec2(-0.22, -0.36), vec2(0.24, 0.18))); // Nubium
          m = max(m, 0.9 * mare(w, vec2(-0.55, -0.4), vec2(0.12, 0.12)));  // Humorum
          m = max(m, 0.75 * mare(w, vec2(-0.05, 0.74), vec2(0.5, 0.08)));  // Frigoris
          m = max(m, 0.85 * mare(w, vec2(0.0, 0.22), vec2(0.13, 0.1)));    // Vaporum
          // Ragged shores: noise on where the sea gives way to highland.
          return smoothstep(0.25, 0.65, m + 0.16 * (fbm(q * 6.0) - 0.47)) * mix(0.75, 1.0, m);
        }
        // The physical sky in a direction: its table by elevation (closer together near the horizon) and azimuth from
        // the sun's (0 toward it, π away), between the texels' centres.
        vec3 physSky(vec3 d) {
          vec2 sxz = normalize(uSunPos.xz + vec2(1e-4, 0.0));
          float az = acos(clamp(dot(normalize(d.xz + vec2(1e-4, 0.0)), sxz), -1.0, 1.0));
          float el = asin(clamp(d.y, -1.0, 1.0));
          float v = sqrt(clamp((el - (${EL_MIN.toFixed(4)})) / (1.5707963 - (${EL_MIN.toFixed(4)})), 0.0, 1.0));
          vec2 n = vec2(${SKY_AZ.toFixed(1)}, ${SKY_EL.toFixed(1)});
          vec2 uv = (vec2(az / 3.1415927, v) * (n - 1.0) + 0.5) / n;
          vec3 c = texture2D(uSkyLut, uv).rgb * uPhysGain;
          // In the painted palette: the horizon's tint low down, the zenith's overhead, along the painted gradient.
          vec3 tint = mix(uTintH, uTintZ, pow(clamp(d.y, 0.0, 1.0), 0.45));
          return c * mix(vec3(1.0), tint, uTint);
        }
        void main() {
          vec3 d = normalize(vDir);
          // The horizon and zenith where the sky meets the land and the mountains: the authored ones, toward the
          // physical sky's in this direction as much as the sky is physical.
          vec3 hz = mix(uHorizon, physSky(normalize(vec3(d.x, 0.0, d.z) + vec3(0.0, 1e-3, 0.0))), uPhys);
          vec3 zn = mix(uZenith, physSky(vec3(0.0, 1.0, 0.0)), uPhys);
          // Below the horizon: the horizon colour (the land and sea round the city fade into it, real/sea.ts).
          vec3 col = d.y >= 0.0 ? mix(mix(uHorizon, uZenith, pow(d.y, 0.45)), physSky(d), uPhys) : hz;
          // Sunrise and sunset: the glow low on the horizon round where the sun is (or just went: it follows the sun
          // below the horizon through the twilight), broad and faint across that half of the sky, strong toward the
          // sun; and opposite, a faint band of it a little way up (the Belt of Venus over the Earth's shadow).
          vec2 sxz = normalize(uSunPos.xz + vec2(1e-4, 0.0));
          float toward = dot(normalize(d.xz + vec2(1e-4, 0.0)), sxz) * 0.5 + 0.5;
          float low = exp(-max(d.y, 0.0) / 0.13);
          float sunGlow = (pow(toward, 8.0) * 0.9 + pow(toward, 2.0) * 0.18) * low;
          float belt = pow(1.0 - toward, 3.0) * exp(-abs(d.y - 0.07) / 0.05) * 0.12;
          // (The physical sky has its own glow round the sun; the authored one only where the sky isn't physical.)
          col += uSunGlow * (sunGlow + belt) * smoothstep(-0.04, 0.0, d.y) * (1.0 - uPhys);
          // The sun's disc where the sun is, while it's up; the classic moon is the old disc at the key light, all night.
          float sd = max(dot(d, normalize(mix(uSunPos, uSunDir, uMoonClassic))), 0.0);
          col += mix(uSunUp * (1.0 - uMoon), 1.0, uMoonClassic) * uSunColor * (step(0.99965, sd) * 12.0 * uDisc + pow(sd, 12.0) * 0.35 + pow(sd, 3.0) * 0.08);
          // The moon in its own place, while it's up (it sinks below the horizon as it sets).
          float moonW = uMoon * uMoonUp * (1.0 - uMoonClassic) * smoothstep(-0.004, 0.004, d.y);
          float md = dot(d, normalize(uMoonDir));
          // The moon: a lit sphere seen in a frame round its direction (x across, y up the sky), its phase lighting it
          // from the side, its maria and craters fixed on its face, earthshine on the dark part; a glow round it as
          // bright as the lit share, and for a hazy moon the soft edge and the faint ring.
          float moonDisc = 0.0;
          vec3 moonSurf = vec3(0.0);
          if (moonW > 0.0 && uDisc > 0.0 && md > 0.0) {
            vec3 m = normalize(uMoonDir);
            vec3 rt = normalize(cross(m, vec3(0.0, 1.0, 0.0)));
            vec3 up = cross(rt, m);
            float a = acos(clamp(dot(d, m), -1.0, 1.0));
            vec2 p = vec2(dot(d, rt), dot(d, up)) / uMoonR;
            float r = length(p);
            float ph = radians(uMoonPhase);
            float litShare = 0.5 + 0.5 * cos(ph);
            col += moonW * uMoonCol * litShare * (uMoonHalo * (0.6 * exp(-a / (uMoonR * 2.5)) + 0.4 * exp(-a / 0.1)) + uMoonRing * exp(-pow((a - 0.384) / 0.014, 2.0)));
            float edge = max(fwidth(r) * 1.2, uMoonSoft);
            moonDisc = moonW * (1.0 - smoothstep(1.0 - edge, 1.0 + edge * 0.4, r));
            if (moonDisc > 0.0 && uMoonTex > 0.5) {
              // The real moon: each point of the disc is a latitude and longitude on its near side (north up, longitude
              // 0 facing us, east to the right as seen from the northern hemisphere), its colour from the LRO mosaic,
              // mostly drained of its slight warmth for the night's grey, and its relief from the altimeter's normals.
              // Lit by the Lommel-Seeliger law the moon follows (brightness by the light's angle against the view's, so
              // a full moon is a flat disc with no darkening at the edge, and slopes catch the light at the terminator).
              vec2 q = p / max(r, 1.0);
              vec3 n = vec3(q, sqrt(max(0.0, 1.0 - dot(q, q))));
              vec3 l = normalize(vec3(sin(ph), -0.2 * sin(ph), cos(ph)));
              float lat = asin(clamp(n.y, -1.0, 1.0));
              float lon = atan(n.x, n.z);
              vec2 uv = vec2(0.5 + lon / 6.2831853, 0.5 + lat / 3.1415927);
              vec3 alb = texture2D(uMoonAlb, uv).rgb;
              alb = mix(vec3(dot(alb, vec3(0.2126, 0.7152, 0.0722))), alb, 0.3);
              // (Haze washes the face out.)
              alb = mix(alb, vec3(0.45), clamp(uMoonSoft * 2.5, 0.0, 0.8));
              vec3 east = normalize(vec3(n.z, 0.0, -n.x) + vec3(1e-5, 0.0, 0.0));
              vec3 north = cross(n, east);
              vec3 t = texture2D(uMoonNrm, uv).xyz * 2.0 - 1.0;
              // (The relief fades out toward the rim, where the surface is seen edge-on and its light would spike.)
              vec3 b = normalize(mix(n, east * t.x + north * t.y + n * t.z, smoothstep(0.02, 0.3, n.z)));
              float mu0 = max(dot(b, l), 0.0);
              float ls = 2.0 * mu0 / (mu0 + max(n.z, 0.05));
              // The smooth sphere's terminator, a little soft, so its edge doesn't alias.
              float lit = smoothstep(-0.03, 0.05, dot(n, l));
              moonSurf = uMoonCol * alb * (1.4 * ls * lit + 0.012);
            } else if (moonDisc > 0.0) {
              vec2 q = p / max(r, 1.0);
              vec3 n = vec3(q, sqrt(max(0.0, 1.0 - dot(q, q))));
              // Waxing: lit from the right and a little below (the sun under the western horizon).
              vec3 l = normalize(vec3(sin(ph), -0.2 * sin(ph), cos(ph)));
              float lit = smoothstep(-0.04, 0.08, dot(n, l));
              float sea = maria(q) * (0.9 + 0.1 * vn(q * 6.0));
              // The highlands' mottle, and the bright young craters: Tycho with its rays, Copernicus, Kepler, Aristarchus.
              // (Haze washes the face out.)
              float alb = 1.0 - (0.62 - 1.5 * uMoonSoft) * sea - 0.1 * (fbm(q * 9.0 + 5.0) - 0.5);
              vec2 ty = q - vec2(-0.14, -0.72);
              float ray = pow(abs(sin(atan(ty.y, ty.x) * 9.0 + 1.3 * vn(q * 5.0))), 6.0) * exp(-length(ty) * 2.6);
              alb += 0.25 * exp(-dot(ty, ty) * 900.0) + 0.1 * ray * (1.0 - 0.6 * sea);
              alb += 0.18 * exp(-dot(q - vec2(-0.3, 0.17), q - vec2(-0.3, 0.17)) * 1400.0);
              alb += 0.14 * exp(-dot(q - vec2(-0.5, 0.15), q - vec2(-0.5, 0.15)) * 1800.0);
              alb += 0.2 * exp(-dot(q - vec2(-0.68, 0.38), q - vec2(-0.68, 0.38)) * 2200.0);
              alb *= mix(0.86, 1.0, n.z);
              moonSurf = uMoonCol * alb * (lit * 0.95 + 0.012);
            }
          }
          if (uStars > 0.0 && d.y > 0.08) {
            vec3 cell = floor(d * 380.0);
            float s = h3(cell);
            // The brightest share of the field shows; those that survive a city's glow are its brightest stars, so
            // they keep some strength, and the glow swallows them further up from the horizon.
            float share = 0.0025 * uStarField;
            float city = 1.0 - uStarField;
            if (s > 1.0 - share) {
              float b = mix((s - 1.0 + share) / share, 0.35 + 0.4 * (s - 1.0 + share) / share, city);
              col += vec3(0.7, 0.75, 0.9) * uStars * b * smoothstep(0.08 + 0.17 * city, 0.4 + 0.25 * city, d.y) * (1.0 - smoothstep(0.3, 0.7, uCover));
            }
          }
          // The moon's face over the sky and stars behind it; the clouds and mountains come in front.
          if (moonDisc > 0.0) col = mix(col, moonSurf + col * 0.3, moonDisc);
          // Clouds on a plane overhead, seen through the dome; they thin toward the horizon's haze.
          if (d.y > 0.0 && uCover > 0.0) {
            vec2 q = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
            float n = fbm(q);
            float dens = smoothstep(1.0 - uCover - 0.1, 1.0 - uCover + 0.35, n);
            // Underside lit where the cloud is thick (city glow from below at night), darker where thin.
            float under = smoothstep(0.3, 0.85, vn(q * 3.4 + 3.0) * 0.6 + vn(q * 7.1) * 0.4);
            vec3 cloud = mix(uCloudDark, uCloudLit, 0.35 + 0.65 * under);
            // At sunrise and sunset the clouds take the glow, their undersides most and toward the sun most.
            cloud += uSunGlow * (0.3 + 0.7 * under) * (pow(toward, 3.0) * 0.75 + 0.05) * (0.4 + 0.6 * low);
            // Lightning lights the clouds round the strike from inside, thick parts most.
            cloud += vec3(0.8, 0.84, 1.0) * uFlash * (0.25 + 3.5 * pow(max(dot(d, uFlashDir), 0.0), 5.0)) * (0.3 + 0.7 * under);
            float fade = smoothstep(0.0, 0.18, d.y);
            col = mix(col, cloud, dens * fade * 0.92);
          }
          // The mountains: ridges by azimuth (0 north, east +), the height of each in radians above the horizon.
          if (uMountains > 0.5 && d.y < 0.12) {
            float az = atan(d.x, -d.z);
            float e = asin(clamp(d.y, -1.0, 1.0));
            float sector = smoothstep(-2.6, -2.25, az) * (1.0 - smoothstep(0.85, 1.25, az));
            // (Above the wooded hills round the city, which stand about a degree up from the streets.)
            float near = sector * (0.022 + 0.026 * fbm(vec2(az * 7.0, 3.1)) + 0.006 * vn(vec2(az * 40.0, 7.7)));
            float far = sector * (0.034 + 0.034 * fbm(vec2(az * 3.3 + 11.0, 1.3)));
            float df = abs(az + 1.95) / 0.3;
            float cone = 0.092 * pow(max(0.0, 1.0 - df), 1.7);
            cone = min(cone, 0.083);
            float skyLum = dot(zn, vec3(0.3, 0.55, 0.15));
            vec3 hazeCol = mix(hz, zn, 0.5) * 0.82;
            vec3 nearCol = mix(hz, zn, 0.72) * 0.6;
            float feet = smoothstep(-0.03, 0.012, e);
            if (e < max(far, cone)) {
              vec3 m = mix(hz, hazeCol, 0.8 * feet);
              if (cone > far && e < cone) {
                m = mix(hz, mix(hazeCol, nearCol, 0.35), feet);
                // The snow cap, catching the sky's light.
                float snow = smoothstep(0.052 - 0.02 * uWinter, 0.06 - 0.02 * uWinter, e) * smoothstep(0.0, 0.02, cone);
                vec3 snowCol = hz * 1.25 + vec3(0.05) * clamp(skyLum * 12.0 + 0.25, 0.0, 1.0) + vec3(0.35) * clamp(skyLum * 3.0, 0.0, 1.0);
                m = mix(m, snowCol, snow * 0.75);
              }
              col = m;
            }
            if (e < near) col = mix(hz, nearCol, 0.25 + 0.75 * feet);
            // Winter: snow along the ranges' tops.
            if (uWinter > 0.0 && e < max(near, far) && e > max(near, far) * 0.72) col = mix(col, hz * 1.2 + (vec3(0.06) + vec3(0.3) * clamp(skyLum * 3.0, 0.0, 1.0)) * clamp(skyLum * 12.0, 0.0, 1.0), 0.55 * uWinter);
          }
          // And the sky itself glows toward the strike.
          col += vec3(0.55, 0.6, 0.85) * uFlash * (0.04 + 0.6 * pow(max(dot(d, uFlashDir), 0.0), 8.0)) * smoothstep(-0.05, 0.1, d.y);
          // A trace of dither, so the faint glows round the moon don't band into rings.
          col += (h2(gl_FragCoord.xy + fract(uTime * 7.0) * 61.0) - 0.5) * 0.0012;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1150, 32, 16), mat);
    this.loadMoon();
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1000;
  }

  /** The real moon's maps: the colour mosaic (sRGB) and the normals (linear); the drawn moon until both are in. */
  private loadMoon(): void {
    const url = (name: string): string | undefined => Object.entries(moonArt).find(([k]) => k.endsWith(name))?.[1];
    const alb = url('moon_albedo.jpg');
    const nrm = url('moon_normal.jpg');
    if (!alb || !nrm) return;
    const loader = new THREE.TextureLoader();
    let left = 2;
    const done = (): void => void (--left === 0 && (this.uniforms.uMoonTex.value = 1));
    const setup = (t: THREE.Texture, srgb: boolean): THREE.Texture => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      // Round the moon east-west; clamped at the poles.
      t.wrapS = THREE.RepeatWrapping;
      t.anisotropy = 4;
      return t;
    };
    loader.load(alb, (t) => ((this.uniforms.uMoonAlb.value = setup(t, true)), done()));
    loader.load(nrm, (t) => ((this.uniforms.uMoonNrm.value = setup(t, false)), done()));
  }

  /** The physical sky for the sun's height now (a slice of real/skyModel.ts's table, RGBA rows). */
  setPhysical(slice: Float32Array): void {
    const t = this.uniforms.uSkyLut.value;
    const out = t.image.data as Uint16Array;
    for (let i = 0; i < out.length; i++) out[i] = THREE.DataUtils.toHalfFloat(Math.min(60000, slice[i]));
    t.needsUpdate = true;
  }

  /** Scales on the shape's size and on its glow (the glow round it and the ring), for trying looks (the debug menu). */
  moonSize = 3.55;
  moonGlow = 0;

  /** The moon's look (MOON_SHAPE), with the size and glow scales; `phase` is the calendar's (degrees from full, signed). */
  setMoonShape(shape: MoonShape, phase = 0): void {
    const m = MOON_SHAPE[shape];
    const u = this.uniforms;
    u.uMoonClassic.value = shape === 'classic' ? 1 : 0;
    u.uMoonR.value = (m.r || 0.0095) * this.moonSize;
    u.uMoonPhase.value = shape === 'calendar' ? phase : m.phase;
    u.uMoonSoft.value = m.soft;
    u.uMoonHalo.value = m.halo * this.moonGlow;
    u.uMoonRing.value = m.ring * this.moonGlow;
  }

  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }
}
