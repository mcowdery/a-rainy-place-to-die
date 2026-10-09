import * as THREE from 'three';
import { screenLightGlsl, screenUniforms, type ScreenUniforms } from './screenLight';
import { shopGlsl } from './shopShader';
import { TRADE } from './shops';
import { WINDOW_ATLAS, windowsAt, type WindowWeather } from './windowScenes';
import { WIPER_GLSL } from '../models/wipers';
import { CAR_RAIN_GLSL, WALL_RAIN_GLSL } from './carRainGlsl';
import { WATER_ALPHA, WATER_GLSL } from './waterGlsl';

/** Cars whose headlights light the city (the nearest to the camera). */
export const CAR_LIGHTS = 16;
/** Moving cars near the camera whose wipers clear their windscreens of rain and snow. */
export const WIPERS = 8;
/** Trees near the camera dropping petals or leaves (on the ground under them; weather.ts Drift has them falling). */
export const LITTER = 32;

/**
 * The city material: one MeshStandardMaterial (so sun, sky light, shadows and fog all work) patched to draw
 * every surface kind in meshBuilder.ts KIND from per-vertex attributes, so a whole chunk is one draw call.
 *
 * Walls: a procedural facade in metres. The window grid comes from the building's style (bay width,
 * window ratio and height, type: punched / ribbon / curtain wall / balcony doors / small / blank), laid out
 * symmetrically across each face. Glass is interior-mapped: the view ray is traced into a box-shaped room
 * behind each window (back wall, side walls, floor, ceiling) lit warm or fluorescent when the room is lit,
 * with blinds, curtains and furniture silhouettes, then mixed with a Fresnel sky reflection. The street
 * front's ground floor is a storefront (lit shop interior behind mullioned glass, or a closed shutter)
 * under a fascia. Walls weather with noise, rain streaks and splash dirt; fine detail fades out before it
 * can alias, and at distance the window pattern is prefiltered to its average.
 *
 * Street lighting comes from a baked lightmap (lightmap.ts: lamp pools, shop spill, sign glow) sampled
 * just in front of every surface and fading with height; in rain the ground darkens, turns glossy and
 * reflects that light as streaks stretched toward the viewer.
 */
export interface CityUniforms extends ScreenUniforms {
  uTime: { value: number };
  /** The wind for the trees: x, y the direction it blows toward (world x, z), z its strength (0 calm, ~1 a typhoon). */
  uWind: { value: THREE.Vector3 };
  uWindowLit: { value: number };
  uLamps: { value: number };
  uNeon: { value: number };
  uFlicker: { value: number };
  uWet: { value: number };
  /** The season (district/seasons.ts): 0 spring, 1 summer, 2 autumn, 3 winter: tree crowns and lawns follow it. */
  uSeason: { value: number };
  /** Snow lying on what faces up (0 none, 1 covered). */
  uSnow: { value: number };
  /** 0-1: street light pools under its sources and falls off to black between them. */
  uDark: { value: number };
  /** Toward the sun (or the moon), and its light (colour x intensity): leaves glow with it behind them. */
  uSunDir: { value: THREE.Vector3 };
  uSunCol: { value: THREE.Color };
  /** Moving cars' headlights near the camera: (x, z, dx, dz) per car, and how many; uHeadlights 0-1 switches them. */
  uCars: { value: THREE.Vector4[] };
  uCarCount: { value: number };
  uHeadlights: { value: number };
  /**
   * Your own car's lights (district/ownCar.ts `beam`), brighter and longer than the traffic's and at its own height
   * (the expressway, the hills): uMyCar is its centre on the ground (x, y, z) and how far ahead of that its nose is;
   * uMyDir the way it points (x, z), the road's slope along that, and half the lamps' spacing (a bike's one lamp: 0);
   * uMyLamps the dipped beam, the main beam, the red behind (the tail lamps 1, braking more) and the reversing
   * lamps. uCarSkip is its slot in uCars (its beams are these instead), or -1.
   */
  uMyCar: { value: THREE.Vector4 };
  uMyDir: { value: THREE.Vector4 };
  uMyLamps: { value: THREE.Vector4 };
  uCarSkip: { value: number };
  /** Moving cars whose wipers are going: (x, z, heading, ground y), and how many (rain and snow off their
   * windscreens); each one's glass and pivots (models/wipers.ts `wiperUniforms`), and the beat (in sweeps). */
  uWipers: { value: THREE.Vector4[] };
  uWiperGlass: { value: THREE.Vector4[] };
  uWiperPivots: { value: THREE.Vector4[] };
  uWiperBeat: { value: number };
  uWiperCount: { value: number };
  /**
   * Tyre tracks in the snow (tracks.ts): a texture wrapped round a window about the camera, R the track, G its
   * height / 64 m; uTrackRect is the window (x0, z0, size, on).
   */
  tTracks: { value: THREE.Texture | null };
  uTrackRect: { value: THREE.Vector4 };
  /**
   * Trees dropping petals (spring) or leaves (autumn) near the camera: (x, z, reach, code + 8 * round(2 * ground y)),
   * code 0 zelkova, 1 ginkgo, 2 cherry, 3 dogwood; how many; and the distance their litter fades out by.
   */
  uLitter: { value: THREE.Vector4[] };
  uLitterCount: { value: number };
  uLitterReach: { value: number };
  uZenith: { value: THREE.Color };
  uHorizon: { value: THREE.Color };
  /** Daylight reaching room interiors (unlit rooms read as dim by day, black by night). */
  uRoomAmbient: { value: THREE.Color };
  /**
   * The rooms behind the upper floors' glass (windowScenes.ts), by the hour, the season and the weather (windowHours
   * sets these three; the defaults are an evening's). uLit: how many windows are lit, a factor on uWindowLit by what
   * the building is (offices, homes, hotels, the night's buildings). uFolk: how many of the people of offices, homes
   * and hotels are in while the lamps are on. uNight: how full the bars and clubs are, and how much of each of the
   * night's vices is going on (the evening's, the late ones, lovers).
   * uWindow: how many people (a multiplier), how much vice (a multiplier on the rooms that have it), a scene to
   * stand in every furnished room (its cell; -1 for none: `?vignette=`), and the share of rooms that are furnished.
   */
  uLit: { value: THREE.Vector4 };
  uFolk: { value: THREE.Vector3 };
  uNight: { value: THREE.Vector4 };
  uWindow: { value: THREE.Vector4 };
  tLight: { value: THREE.Texture | null };
  /** The storefront interiors' atlas (shopAtlas.ts): colour and mask; null leaves shops dark inside. */
  tShopCol: { value: THREE.Texture | null };
  tShopMask: { value: THREE.Texture | null };
  /** Lightmap placement: (x0, z0, 1 / width, 1 / depth) in metres. */
  uLightRect: { value: THREE.Vector4 };
  /** Fades the lightmap out between these max-norm distances from the camera (m); (0, 0) for none (lightmap.ts). */
  uLightFade: { value: THREE.Vector2 };
  uLightGain: { value: number };
}

/** Who's in behind the windows at an hour (0-24): offices, homes, hotels (windowScenes.ts windowsAt). */
export function windowFolkAt(hour: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(...windowsAt(hour).folk);
}

/** Sets the hour, the season and the weather for the rooms behind the windows: uLit, uFolk, uNight. */
export function windowHours(hour: number, u: Pick<CityUniforms, 'uLit' | 'uFolk' | 'uNight'>, weather: WindowWeather = {}): void {
  const w = windowsAt(hour, weather);
  u.uLit.value.set(...w.lit);
  u.uFolk.value.set(...w.folk);
  u.uNight.value.set(...w.night);
}

/**
 * The light of a nightlife building's rooms (a tenant building of bars and clubs, a love hotel): how bright against
 * an ordinary lit room's 1, and how much of its tint the tinted minority gets (0 none: plain warm lamplight; 1 the
 * full dull amber or muted rose; about a seventh of such rooms each).
 */
export const DEN_LIGHT = 0.62;
export const DEN_TINT = 0.6;

export function cityUniforms(): CityUniforms {
  return {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3(1, 0, 0) },
    uWindowLit: { value: 0.4 },
    uLamps: { value: 1 },
    uNeon: { value: 1 },
    uFlicker: { value: 0 },
    uWet: { value: 0 },
    uSeason: { value: 0 },
    uSnow: { value: 0 },
    uDark: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(0, 0, 0) },
    uCars: { value: Array.from({ length: CAR_LIGHTS }, () => new THREE.Vector4()) },
    uCarCount: { value: 0 },
    uHeadlights: { value: 0 },
    uMyCar: { value: new THREE.Vector4() },
    uMyDir: { value: new THREE.Vector4(0, 1, 0, 0.62) },
    uMyLamps: { value: new THREE.Vector4() },
    uCarSkip: { value: -1 },
    uWipers: { value: Array.from({ length: WIPERS }, () => new THREE.Vector4()) },
    uWiperGlass: { value: Array.from({ length: WIPERS }, () => new THREE.Vector4()) },
    uWiperPivots: { value: Array.from({ length: WIPERS }, () => new THREE.Vector4()) },
    uWiperBeat: { value: 1 },
    uWiperCount: { value: 0 },
    tTracks: { value: null },
    uTrackRect: { value: new THREE.Vector4(0, 0, 1, 0) },
    uLitter: { value: Array.from({ length: LITTER }, () => new THREE.Vector4()) },
    uLitterCount: { value: 0 },
    uLitterReach: { value: 60 },
    uZenith: { value: new THREE.Color(0x0a0e18) },
    uHorizon: { value: new THREE.Color(0x2a2230) },
    uRoomAmbient: { value: new THREE.Color(0x000000) },
    uLit: { value: new THREE.Vector4(...windowsAt(20.5).lit) },
    uFolk: { value: windowFolkAt(20.5, new THREE.Vector3()) },
    uNight: { value: new THREE.Vector4(...windowsAt(20.5).night) },
    uWindow: { value: new THREE.Vector4(1, 1, -1, 0.8) },
    tLight: { value: null },
    tShopCol: { value: null },
    tShopMask: { value: null },
    uLightRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uLightFade: { value: new THREE.Vector2(0, 0) },
    uLightGain: { value: 1 },
    ...screenUniforms(),
  };
}

/**
 * Trees in the wind (vertex stage; the city material and its shadow caster both run it, so shadows sway with
 * the crowns). models/trees.ts tags every vertex of a tree with its height above the tree's foot (style.w =
 * -(0.01 + height), plain kind). The tree bends like a stem, more the higher up (height²): a lean downwind that
 * grows with the strength squared, gusts sweeping through downwind, a rocking of its own and a little sideways,
 * and the leaves flutter on top. A breeze barely stirs them. In a storm (strength past ~0.7, a typhoon's ~1.2)
 * they're bent hard over and held there, let up and slammed back as each gust front passes, the crowns whipping
 * and the leaves streaming: a couple of metres at a street tree's top. Every pace is fixed and only the amounts
 * follow the strength (a pace that followed it would jump the phase as the wind rose).
 */
const swayVertex = /* glsl */ `
  #ifndef USE_INSTANCING
  if (aStyle.w < 0.0 && mod(aFacade.w, 16.0) < 0.5) {
    float swH = -aStyle.w - 0.01;
    vec3 swP = (modelMatrix * vec4(transformed, 1.0)).xyz;
    float swS = uWind.z;
    vec2 swD = uWind.xy;
    float swBend = swH * swH / 64.0;
    float swAlong = dot(swP.xz, swD);
    // How much of a storm it is: nothing in a breeze, all of it at a typhoon's height.
    float swStorm = smoothstep(0.7, 1.25, swS);
    // A gust: a wave running downwind through the trees, stronger every so often; in a storm, fronts that come
    // through faster and harder on top of it.
    float swGust = (0.55 + 0.45 * sin(uTime * 0.8 - swAlong * 0.07)) * (0.65 + 0.35 * sin(uTime * 0.21 - swAlong * 0.018 + 1.7));
    float swFront = 0.5 + 0.5 * sin(uTime * 1.7 - swAlong * 0.11 + 0.9 * sin(uTime * 0.37 - swAlong * 0.03));
    swGust = mix(swGust, 0.35 + 0.65 * swGust + 0.55 * swFront * swFront, swStorm);
    float swPh = dot(swP.xz, vec2(0.13, 0.09));
    // The lean: with the strength squared, and in a storm bent over and held, more in each gust.
    float swLean = swS * swS * 0.35 * (0.3 + swGust) + swStorm * (0.45 + 0.75 * swGust);
    // Rocking: slow in a breeze, quicker as it blows, and in a storm a hard thrash with a shudder through it.
    float swRock = mix(sin(uTime * 1.2 + swPh), sin(uTime * 2.0 + swPh * 1.3), clamp(swS, 0.0, 1.0)) * (0.015 + 0.08 * swS + 0.14 * swS * swS) * (0.6 + 0.6 * swGust);
    swRock += (sin(uTime * 2.9 + swPh * 2.1) * 0.22 + sin(uTime * 6.3 + swPh * 3.7) * 0.07) * swStorm * (0.4 + swGust);
    float swSide = sin(uTime * 0.85 + swPh * 1.7 + 2.0) * (0.01 + 0.04 * swS + 0.05 * swS * swS) + sin(uTime * 2.3 + swPh * 2.9) * 0.16 * swStorm * (0.3 + swGust);
    vec2 swXZ = (swD * (swLean + swRock) + vec2(-swD.y, swD.x) * swSide) * swBend;
    vec3 swW = vec3(swXZ.x, -0.5 * dot(swXZ, swXZ) / max(swH, 1.0), swXZ.y);
    if (aStyle.x > 19.5) {
      // The leaves flutter, each part of the crown at its own pace: gently, then fast as it blows; in a storm
      // the crown streams downwind and whips.
      float swFp = dot(swP, vec3(1.9, 2.7, 1.3));
      vec3 swFl = mix(vec3(sin(uTime * 5.0 + swFp), 0.6 * sin(uTime * 6.5 + swFp * 1.3 + 1.0), cos(uTime * 4.5 + swFp * 0.9)),
        vec3(sin(uTime * 10.0 + swFp), 0.6 * sin(uTime * 13.0 + swFp * 1.3 + 1.0), cos(uTime * 9.0 + swFp * 0.9)), clamp(swS, 0.0, 1.0));
      float swUp = min(1.0, swH * 0.3);
      swW += swFl * (0.01 + 0.06 * swS + 0.04 * swS * swS + 0.1 * swStorm) * swUp * (0.5 + swGust);
      swW.xz += swD * (0.25 + 0.2 * sin(uTime * 7.3 + swFp * 0.6)) * swStorm * swUp * (0.3 + swGust);
    }
    // World to the mesh's own frame (landmarks are turned and may be scaled).
    mat3 swM = mat3(modelMatrix);
    transformed += transpose(swM) * swW / dot(swM[0], swM[0]);
  }
  #endif
`;

const common = /* glsl */ `
  uniform float uTime;
  uniform vec3 uWind;
  uniform float uWindowLit;
  uniform float uLamps;
  uniform float uNeon;
  uniform float uFlicker;
  uniform float uWet;
  uniform float uSeason;
  uniform float uSnow;
  uniform float uDark;
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform vec4 uCars[${CAR_LIGHTS}];
  uniform int uCarCount;
  uniform float uHeadlights;
  uniform vec4 uMyCar;
  uniform vec4 uMyDir;
  uniform vec4 uMyLamps;
  uniform int uCarSkip;
  uniform vec4 uWipers[${WIPERS}];
  uniform vec4 uWiperGlass[${WIPERS}];
  uniform vec4 uWiperPivots[${WIPERS}];
  uniform float uWiperBeat;
  uniform int uWiperCount;
  uniform sampler2D tTracks;
  uniform vec4 uTrackRect;
  uniform vec4 uLitter[${LITTER}];
  uniform int uLitterCount;
  uniform float uLitterReach;
  ${screenLightGlsl}

  // Headlights and tail lights of the cars near the camera, as light on the surfaces round them (no
  // volumes): two beams ahead that spread and fade over ~35 m, low down; a short red glow behind.
  vec3 carLights(vec3 wp, vec3 n, bool ground) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < ${CAR_LIGHTS}; i++) {
      if (i >= uCarCount) break;
      if (i == uCarSkip) continue;
      vec4 c = uCars[i];
      vec2 rel = wp.xz - c.xy;
      if (dot(rel, rel) > 1600.0) continue;
      vec2 d = c.zw;
      vec2 sd = vec2(-d.y, d.x);
      float along = dot(rel, d) - 2.2;
      float side = dot(rel, sd);
      // Facing: ground always; walls and people only on the side toward the car.
      float face = ground ? 1.0 : clamp(dot(n.xz, -normalize(rel + d * 0.5)), 0.0, 1.0);
      // Height: the beams sit low (0.7 m) and dip toward the road.
      float hgt = exp(-max(wp.y - 0.4 - along * 0.02, 0.0) / 1.6);
      if (along > 0.0) {
        float beam = 0.0;
        for (int k = -1; k <= 1; k += 2) {
          float o = side - float(k) * 0.75;
          float spread = 0.45 + along * 0.14;
          beam += exp(-o * o / (spread * spread));
        }
        // Fades in off the bumper and out to nothing by 34 m (no edge where the list's reach ends).
        float fall = smoothstep(0.0, 2.0, along) * smoothstep(34.0, 14.0, along) / (1.0 + along * along * 0.01);
        acc += vec3(1.0, 0.9, 0.72) * beam * fall * hgt * face * 5.0;
      } else if (along > -7.5) {
        float back = -along - 2.4;
        if (back > 0.0) acc += vec3(1.0, 0.05, 0.03) * exp(-side * side / 1.6) * exp(-back * 0.7) * hgt * face * 2.0;
      }
    }
    return acc * uHeadlights;
  }

  // Your own car's lights: two beams well down the road (dipped: low and wide, to ~60 m; the main beam on to ~140 m
  // and up the walls), a red glow behind it (more under braking) and a white one reversing. Heights are from the
  // road's line through the car, so it works up on the expressway and on the hills, and the street a storey under a
  // deck stays dark.
  vec3 myLights(vec3 wp, vec3 n, bool ground) {
    vec2 rel = wp.xz - uMyCar.xz;
    if (dot(rel, rel) > 25600.0) return vec3(0.0);
    vec2 d = uMyDir.xy;
    float fwd = dot(rel, d);
    float side = dot(rel, vec2(-d.y, d.x));
    float h = wp.y - uMyCar.y - fwd * uMyDir.z;
    float above = smoothstep(-4.0, -1.5, h);
    // What lies flat is lit; walls only where they face the lamps.
    float lies = ground ? 1.0 : smoothstep(0.5, 0.9, n.y);
    vec3 acc = vec3(0.0);
    float along = fwd - uMyCar.w;
    if (along > 0.0) {
      float face = mix(clamp(dot(n.xz, -normalize(rel - d * uMyCar.w)), 0.0, 1.0), 1.0, lies);
      float spread = 0.7 + along * 0.2;
      float beam = 0.0;
      for (int k = -1; k <= 1; k += 2) {
        float o = side - float(k) * uMyDir.w;
        beam += exp(-o * o / (spread * spread));
      }
      // (The road just off the bumper is under the beams, not in them: they land a few metres on.)
      float off = smoothstep(0.0, 7.0, along);
      float dip = smoothstep(65.0, 25.0, along) / (1.0 + along * along * 0.004) * exp(-max(h - 0.7 - along * 0.012, 0.0) / 1.3);
      float mainBeam = smoothstep(4.0, 30.0, along) * smoothstep(150.0, 60.0, along) / (1.0 + along * along * 0.0015) * exp(-max(h - 1.2 - along * 0.06, 0.0) / 3.0);
      acc += vec3(1.0, 0.92, 0.76) * beam * off * face * (uMyLamps.x * dip * 6.0 + uMyLamps.y * mainBeam * 9.0);
    }
    float back = -fwd - uMyCar.w;
    if (back > 0.0 && back < 16.0) {
      float face = mix(clamp(dot(n.xz, -normalize(rel)), 0.0, 1.0), 1.0, lies);
      float low = exp(-max(h - 0.5, 0.0) / 1.2) * face * smoothstep(0.0, 0.9, back);
      acc += vec3(1.0, 0.05, 0.03) * exp(-side * side / 2.2) * exp(-back * 0.6) * low * 1.1 * uMyLamps.z;
      acc += vec3(0.95, 0.95, 1.0) * exp(-side * side / 6.0) * exp(-back * 0.28) * low * 2.5 * uMyLamps.w;
    }
    return acc * above;
  }
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uRoomAmbient;
  uniform vec3 uFolk;
  uniform vec4 uNight;
  uniform vec4 uLit;
  uniform vec4 uWindow;
  uniform sampler2D tLight;
  uniform vec4 uLightRect;
  uniform vec2 uLightFade;
  uniform float uLightGain;
  varying vec4 vFacade;
  flat varying vec4 vStyle;
  flat varying float vFlags;
  flat varying float vBid;
  varying vec3 vWPos;
  varying vec3 vWNor;
  varying vec3 vLPos;

  // Sin-free hashes (Dave Hoskins): stable for large ids.
  float h1(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float h2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float h3(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
  float vnoise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y);
    float b = mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y);
    return mix(a, b, f.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  vec3 lightAt(vec2 p) {
    vec3 L = texture2D(tLight, (p - uLightRect.xy) * uLightRect.zw).rgb * uLightGain;
    if (uLightFade.y > 0.0) {
      vec2 dc = abs(p - cameraPosition.xz);
      L *= 1.0 - smoothstep(uLightFade.x, uLightFade.y, max(dc.x, dc.y));
    }
    // Darkness: square the falloff, so light pools under its source and the gaps between go black.
    return mix(L, L * L * 1.5, uDark);
  }
  vec3 skyRefl(vec3 r) {
    return r.y > 0.0 ? mix(uHorizon, uZenith, sqrt(r.y)) : uHorizon * 0.3;
  }
  float fresnel(float cosT) { return 0.04 + 0.96 * pow(1.0 - cosT, 5.0); }
  // What the wipers have cleared of a windscreen (models/wipers.ts: the same fans the blades sweep): glass facing
  // forward on a moving car near the camera. x: in a blade's fan (the corners and the wedge between the fans keep
  // what's on them); y: how long ago the blade passed, in sweeps.
  vec2 wiped(vec3 wp, vec3 n) {
    for (int i = 0; i < ${WIPERS}; i++) {
      if (i >= uWiperCount) break;
      vec4 c = uWipers[i];
      vec2 rel = wp.xz - c.xy;
      if (dot(rel, rel) > 9.0) continue;
      vec2 d = vec2(sin(c.z), cos(c.z));
      if (dot(n.xz, d) < 0.12 || dot(rel, d) < 0.0) continue;
      // Across the glass (the car's left positive) and up the blades' plane from its foot.
      vec4 g = uWiperGlass[i];
      float s = dot(rel, vec2(d.y, -d.x));
      float t = (dot(rel, d) - g.x) * cos(g.z) + (wp.y - c.w - g.y) * sin(g.z);
      return wiperFan(vec2(s, t), uWiperPivots[i].xyz, g.w, uWiperBeat);
    }
    return vec2(0.0, 9.0);
  }
  // Tyre tracks under a point on the ground (0 none, 1 a fresh track), at about that height.
  float trackAt(vec3 wp) {
    if (uTrackRect.w < 0.5) return 0.0;
    vec2 q = wp.xz - uTrackRect.xy;
    if (q.x < 0.0 || q.y < 0.0 || q.x > uTrackRect.z || q.y > uTrackRect.z) return 0.0;
    vec4 t = texture2D(tTracks, fract(wp.xz / uTrackRect.z));
    return t.r * (1.0 - smoothstep(0.8, 1.6, abs(wp.y - t.g * 64.0)));
  }
  // The trees dropping petals (spring) or leaves (autumn) near the camera: the colour of the nearest one's
  // (linear) and how thick they lie there (0 away from them).
  vec4 treeLitter(vec3 wp) {
    if (uLitterCount == 0) return vec4(0.0);
    vec4 best = vec4(0.0);
    for (int i = 0; i < ${LITTER}; i++) {
      if (i >= uLitterCount) break;
      vec4 t = uLitter[i];
      vec2 rel = wp.xz - t.xy;
      float r = t.z;
      float d2 = dot(rel, rel);
      if (r <= 0.0 || d2 > r * r * 2.2) continue;
      float gy = floor(t.w / 8.0) * 0.5;
      if (abs(wp.y - gy) > 1.5) continue;
      float dens = 1.0 - smoothstep(r * 0.3, r * 1.45, sqrt(d2));
      if (dens <= best.a) continue;
      float code = mod(t.w, 8.0);
      vec3 c;
      if (uSeason < 0.5) c = code > 2.5 ? vec3(0.97, 0.9, 0.9) : vec3(0.96, 0.68, 0.8);
      else c = code < 0.5 ? vec3(0.62, 0.34, 0.13) : code < 1.5 ? vec3(0.93, 0.74, 0.12) : code < 2.5 ? vec3(0.76, 0.28, 0.12) : vec3(0.62, 0.12, 0.12);
      best = vec4(c, dens);
    }
    float camD = length(wp.xz - cameraPosition.xz);
    return vec4(best.rgb, best.a * (1.0 - smoothstep(uLitterReach * 0.75, uLitterReach, camD)));
  }
  // How far a point on a ground slab's top is from the slab's edges (ground.ts addGround: the pavement's kerb
  // and building line, a plaza's border, a lawn's), or on a road from its kerbs; far (99) if it isn't a slab.
  float slabEdge(vec3 wp) {
    if (vFlags < 4095.5) return 99.0;
    float f = vFlags - 4096.0;
    float kc = mod(f, 128.0);
    float d = floor(f / 128.0) / 8.0;
    vec2 q = wp.xz - vStyle.yz;
    float w = vStyle.w;
    float ex = min(q.x, w - q.x);
    float ez = min(q.y, d - q.y);
    if (kc > 0.5) {
      // A road: its kerbs a pavement's width in from its sides.
      float kerbS = mod(kc, 64.0) * 0.5;
      return abs((kc > 63.5 ? ex : ez) - kerbS);
    }
    return min(ex, ez);
  }
  // A leaf (or a petal) lying in a cell: q from the cell's centre, turned by ang; length L, width W (cell units).
  // Returns (inside 0-1, across the midrib -1..1).
  vec2 leafShape(vec2 q, float ang, float L, float W, float notch) {
    float ca = cos(ang), sa = sin(ang);
    vec2 r = vec2(ca * q.x + sa * q.y, -sa * q.x + ca * q.y);
    float t = r.x / L;
    if (abs(t) > 1.0) return vec2(0.0);
    // Broad toward the stalk end, pointed at the tip; a petal has a notch at its tip.
    float w = W * sqrt(max(0.0, 1.0 - t * t)) * (1.0 - 0.35 * t) + 1e-4;
    float inside = 1.0 - smoothstep(w * 0.75, w, abs(r.y));
    if (notch > 0.0) inside *= smoothstep(notch * 0.6, notch, length(vec2(r.x - L, r.y)));
    return vec2(inside, r.y / w);
  }
  // Fallen leaves (autumn) or cherry petals (spring): a thin scatter everywhere, drifts in streaks where the wind
  // left them, piled along the edges (kerbs, the foot of walls, a plaza's rim) and thick under the trees that
  // dropped them. Leaves up close (two offset layers of cells, each maybe holding one, turned and sized at random,
  // with a midrib), a wash of their colour further off. Returns the colour (linear) and the cover.
  vec4 fallenAt(vec3 wp, float fine, float edge) {
    bool spring = uSeason < 0.5;
    vec4 tree = treeLitter(wp);
    vec2 sp = vec2(wp.x * 0.8 + wp.z * 0.6, -wp.x * 0.6 + wp.z * 0.8);
    float streak = vnoise(sp * vec2(0.07, 0.45));
    float pile = exp(-edge / (spring ? 0.35 : 0.5)) * (0.6 + 0.4 * vnoise(wp.xz * 0.9));
    float dens = (spring ? 0.03 : 0.08) + (spring ? 0.08 : 0.2) * smoothstep(0.5, 0.85, streak) + (spring ? 0.5 : 0.75) * pile + (spring ? 0.75 : 0.85) * tree.a;
    dens = clamp(dens, 0.0, 0.92);
    float scale = spring ? 9.0 : 4.2;
    vec3 col = vec3(0.0);
    float cover = 0.0;
    for (int k = 0; k < 2; k++) {
      vec2 g = wp.xz * scale + float(k) * vec2(0.37, 0.61);
      vec2 cellP = floor(g) + float(k) * 71.0;
      float h = h2(cellP);
      if (h > dens) continue;
      vec2 q = fract(g) - 0.5 - (vec2(h2(cellP + 3.1), h2(cellP + 5.7)) - 0.5) * 0.25;
      float ang = h2(cellP + 9.3) * 6.2832;
      float sz = 0.75 + 0.5 * h2(cellP + 1.7);
      vec2 lf = spring ? leafShape(q, ang, 0.3 * sz, 0.2 * sz, 0.07 * sz) : leafShape(q, ang, 0.42 * sz, 0.2 * sz, 0.0);
      if (lf.x <= cover) continue;
      float pick = h2(cellP + 13.9);
      vec3 c;
      if (spring) c = pick < 0.75 ? vec3(0.96, 0.7, 0.8) : vec3(0.98, 0.88, 0.9);
      else c = pick < 0.22 ? vec3(0.9, 0.68, 0.14) : pick < 0.44 ? vec3(0.84, 0.42, 0.12) : pick < 0.6 ? vec3(0.62, 0.17, 0.1) : pick < 0.82 ? vec3(0.46, 0.28, 0.12) : vec3(0.64, 0.52, 0.3);
      // Near a tree, mostly its own.
      if (h2(cellP + 21.3) < tree.a) c = tree.rgb;
      c = pow(c * (0.85 + 0.3 * h2(cellP + 17.1)), vec3(2.2));
      // The midrib, and the leaf a touch darker at its edges.
      if (!spring) c *= (1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.12, abs(lf.y)))) * (1.0 - 0.2 * abs(lf.y));
      col = c;
      cover = lf.x;
    }
    // Further off: a wash of the average colour.
    vec3 avg = spring ? pow(vec3(0.96, 0.74, 0.83), vec3(2.2)) : mix(pow(vec3(0.7, 0.42, 0.14), vec3(2.2)), pow(tree.rgb, vec3(2.2)), tree.a);
    float wash = dens * (spring ? 0.3 : 0.45);
    return vec4(mix(avg, col, fine), mix(wash, cover, fine));
  }

  // Interior mapping: trace a ray into an axis-aligned room [0, rw] x [0, ch] x [-depth, 0] (x along the
  // facade, y up, z out of the wall) from ro on the glass. Returns the hit point; face: 0 back, 1 side,
  // 2 ceiling, 3 floor.
  vec3 roomHit(vec3 ro, vec3 rd, float rw, float ch, float depth, out float face) {
    // The glass can extend past the room (a curtain wall runs floor to floor, the ceiling sits lower): start
    // inside the room, or the hit lands in front of the glass and the depth falloff explodes.
    ro = vec3(clamp(ro.x, 0.001, rw - 0.001), clamp(ro.y, 0.001, ch - 0.001), 0.0);
    float rdx = abs(rd.x) < 1e-5 ? 1e-5 : rd.x;
    float rdy = abs(rd.y) < 1e-5 ? 1e-5 : rd.y;
    float tx = (rdx > 0.0 ? rw - ro.x : -ro.x) / rdx;
    float ty = (rdy > 0.0 ? ch - ro.y : -ro.y) / rdy;
    float tz = -depth / min(rd.z, -1e-3);
    float t = max(min(tx, min(ty, tz)), 0.0);
    face = t == tz ? 0.0 : t == tx ? 1.0 : rdy > 0.0 ? 2.0 : 3.0;
    return ro + rd * t;
  }
  vec3 roomLightColor(float h, bool office) {
    if (office) return h < 0.8 ? vec3(0.85, 0.95, 1.0) : vec3(1.0, 0.86, 0.66);
    // (The last: a room lit by its television, a pale cool grey-blue.)
    return h < 0.55 ? vec3(1.0, 0.62, 0.3) : h < 0.85 ? vec3(1.0, 0.86, 0.66) : h < 0.94 ? vec3(0.8, 0.9, 1.0) : vec3(0.64, 0.72, 0.9);
  }
  // The rooms as they were before the scenes (uWindow.w < 0, the debug menu's window scenes switch off): every lit room
  // a plain full-strength light, with the old odd one out lit blue.
  vec3 roomLightColorOld(float h, bool office) {
    if (office) return h < 0.8 ? vec3(0.85, 0.95, 1.0) : vec3(1.0, 0.86, 0.66);
    return h < 0.55 ? vec3(1.0, 0.62, 0.3) : h < 0.85 ? vec3(1.0, 0.86, 0.66) : h < 0.96 ? vec3(0.8, 0.9, 1.0) : vec3(0.45, 0.55, 1.0);
  }
  float flick(float id) {
    return uFlicker > 0.5 && h2(vec2(id, floor(uTime * 12.0))) > 0.99 ? 0.1 : 1.0;
  }
  ${shopGlsl()}
`;

const surface = /* glsl */ `
  // ---- city surface (see city.ts) ----
  // Derivatives first, in uniform control flow.
  vec2 fwUV = max(fwidth(vFacade.xy), vec2(1e-4));
  vec2 fwW = max(fwidth(vWPos.xz), vec2(1e-4));
  // The surface's true facing (leaf cards are lit as their crown's round surface, but fade when seen edge-on).
  vec3 geoN = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
  float kindF = mod(floor(vFacade.w + 0.5), 16.0);
  bool isFront = vFacade.w > 15.5;
  vec3 albedo = vColor.rgb;
  // (Foliage: its leaf bump, applied to the lighting normal after three works it out: normalFoliage.)
  float leafy = 0.0;
  vec3 leafBump = vec3(0.0);
  // (Water: its rippled normal, world space, given to the lighting the same way: the sun's glitter.)
  vec3 waterN = vec3(0.0);
  float sRough = 0.85;
  float sMetal = 0.0;
  vec3 sEmit = vec3(0.0);
  vec3 Vw = normalize(vWPos - cameraPosition);
  // A pixel's angle (for the shop interiors' texture detail), while the derivatives are still defined.
  float pxAng = max(length(fwidth(Vw)), 1e-5);
  vec3 Nw = normalize(vWNor);
  bool groundKind = kindF > 6.5;
  // A car's cabin (models/carInterior.ts: plain, or a mirror's chrome, style.x INDOOR): no fallen leaves, snow or
  // rain on its seats.
  bool indoor = (kindF < 0.5 || (kindF > 5.5 && kindF < 6.5)) && vStyle.x > 9.5 && vStyle.x < 10.5;
  float cosV = clamp(-dot(Vw, Nw), 0.0, 1.0);

  if (kindF < 0.5) {
    albedo *= 0.88 + 0.24 * vnoise(vWPos.xz * 1.3 + vWPos.y * 0.7);
    // Tree crowns (models/trees.ts tags them FOLIAGE_TAG + species): coloured by the season. Groups: zelkova,
    // ginkgo, cherry, the evergreens (pine, camphor, azalea, box: their own colours) and dogwood. Each crown is a
    // few smooth masses; here they get their leaves: clusters (two octaves of noise over the surface), darker
    // under and between them, a bumpy normal so the light catches the clusters (normalFoliage), a ragged leafy
    // edge instead of a polygon (up close), colour in patches (blossom and autumn mixed, not one flat tone), and
    // the sun glowing through when you look toward it.
    if (vStyle.x > 19.5) {
      float sp = vStyle.x - 20.0;
      float grp = sp < 0.5 ? 0.0 : sp < 2.5 ? 1.0 : sp < 4.5 ? 2.0 : (sp > 6.5 && sp < 8.5) ? 4.0 : 3.0;
      float shade = 0.85 + 0.3 * h1(floor(vWPos.x * 0.8) * 7.0 + floor(vWPos.y * 0.8) * 13.0 + floor(vWPos.z * 0.8) * 3.0);
      vec3 lp = vWPos;
      float closeL = 1.0 - smoothstep(0.02, 0.07, max(fwW.x, fwW.y));
      bool bare = uSeason > 2.5 && !(grp > 2.5 && grp < 3.5);
      // The part (models/trees.ts): 0 foliage, 1 a card crown's dark core, 2 a leaf card, whose leaves are cut out
      // of it first (before any of the shading below, which the cut-away pixels never pay for): a ragged cluster of
      // leaves, thinning toward its edges, each leaf a shade of its own.
      float part = vStyle.y;
      float leafShade = 1.0;
      float bumpK = 1.2;
      vec3 tint = vec3(1.0);
      float n1, n2, n4;
      float n3 = vnoise3(lp * 0.55 + 5.0);
      if (part > 1.5) {
        if (bare) discard;
        vec2 q = vFacade.xy;
        float seed = vFacade.z * 37.0;
        float d = length(q - 0.5) * 2.0;
        float edgeOn = abs(dot(geoN, Vw));
        float keep = (1.0 - d) * 1.4 + (vnoise(q * 4.0 + seed) - 0.5) * 0.9 - (1.0 - smoothstep(0.12, 0.45, edgeOn)) * 0.9;
        if (keep < 0.25) discard;
        vec2 lq = q * 11.0 + seed;
        vec2 cell = floor(lq);
        // A leaf per cell: a pointed ellipse, turned at random, in the cell's middle.
        vec2 f = fract(lq) - 0.5 - (vec2(h2(cell), h2(cell + 3.7)) - 0.5) * 0.35;
        float ang = h2(cell + 9.1) * 6.2832;
        vec2 rq = vec2(cos(ang) * f.x + sin(ang) * f.y, -sin(ang) * f.x + cos(ang) * f.y);
        float leaf = 1.0 - smoothstep(0.85, 1.0, length(rq / vec2(0.54, 0.3)));
        if (closeL > 0.2 && leaf < 0.5) discard;
        leafShade = mix(0.72, 1.18, h2(cell + 5.3)) * mix(0.8, 1.0, 1.0 - d * 0.5);
        bumpK = 0.6;
        // (A card's clusters and leaves come from its cells, not the 3D noise.)
        n1 = h2(cell + 7.7);
        n2 = h2(cell + 2.9);
        n4 = h2(cell + 4.1);
      } else {
        n1 = vnoise3(lp * 2.3);
        n2 = vnoise3(lp * 6.1 + 17.0);
        // The leaves themselves (or florets), a few centimetres across, only where they're bigger than a pixel.
        n4 = vnoise3(lp * 17.0 + 3.0);
      }
      float closeF = 1.0 - smoothstep(0.006, 0.025, max(fwW.x, fwW.y));
      float clump = mix(0.55, smoothstep(0.25, 0.8, n1 * 0.6 + n2 * 0.4), 0.25 + 0.75 * closeL);
      float blossom = uSeason < 0.5 && (grp > 1.5 && grp < 2.5 || grp > 3.5) ? 1.0 : 0.0;
      // Petals let the light through: a blossoming crown is lighter underneath and between its clusters.
      float ao = mix(mix(0.42, 0.7, blossom), 1.0, smoothstep(-0.75, 0.55, Nw.y));
      float lightK = mix(mix(0.62, 0.82, blossom), mix(1.18, 1.08, blossom), clump) * ao * mix(1.0, mix(0.78, 1.14, smoothstep(0.3, 0.75, n4)), closeF);
      float rim = 1.0 - abs(dot(Nw, Vw));
      if (part > 1.5) {
        // (Cut out above.)
      } else if (part > 0.5) {
        // The core behind the cards: dark, in their shade.
        leafShade = mix(0.38, 0.7, blossom);
        bumpK = 0.4;
      } else if (!bare && closeL > 0.3 && rim > 0.55 && mix(n2, n4, 0.55) < (rim - 0.55) * 2.4) {
        // A ragged edge, leaves against the sky (only up close, where a leaf is bigger than a pixel).
        discard;
      }
      vec3 c;
      if (uSeason < 0.5) {
        if (grp < 0.5) c = mix(vec3(0.46, 0.63, 0.28), vec3(0.64, 0.76, 0.3), n3);
        else if (grp < 1.5) c = mix(vec3(0.56, 0.7, 0.26), vec3(0.72, 0.8, 0.32), n3);
        else if (grp < 2.5) {
          // Cherry blossom: pale pink and white florets (bright specks up close), deeper pink patches.
          c = mix(vec3(0.97, 0.8, 0.87), vec3(0.99, 0.94, 0.95), smoothstep(0.35, 0.7, n2));
          c = mix(c, vec3(0.93, 0.6, 0.73), smoothstep(0.55, 0.85, n3) * 0.65);
          c = mix(c, vec3(1.0, 0.97, 0.97), smoothstep(0.62, 0.8, n4) * closeF * 0.7);
        } else c = mix(vec3(0.97, 0.94, 0.9), vec3(0.95, 0.7, 0.8), smoothstep(0.4, 0.8, n3));
      } else if (uSeason < 1.5) {
        vec3 g = grp < 0.5 ? vec3(0.22, 0.36, 0.14) : grp < 1.5 ? vec3(0.3, 0.45, 0.15) : grp < 2.5 ? vec3(0.26, 0.4, 0.16) : vec3(0.24, 0.38, 0.16);
        c = mix(g, g * vec3(1.3, 1.22, 0.85), n3);
      } else {
        // Autumn in patches: some of the crown further on than the rest.
        if (grp < 0.5) c = mix(mix(vec3(0.64, 0.36, 0.14), vec3(0.8, 0.54, 0.16), n3), vec3(0.45, 0.26, 0.1), smoothstep(0.6, 0.9, n1) * 0.5);
        else if (grp < 1.5) c = mix(vec3(0.95, 0.76, 0.14), vec3(0.72, 0.74, 0.22), smoothstep(0.62, 0.9, n3) * 0.6);
        else if (grp < 2.5) c = mix(vec3(0.74, 0.3, 0.14), vec3(0.9, 0.54, 0.16), n3);
        else c = mix(vec3(0.6, 0.13, 0.12), vec3(0.48, 0.1, 0.24), n3);
      }
      if (grp > 2.5 && grp < 3.5) {
        // Evergreens keep their own greens (azaleas flower in spring); duller in winter.
        c = vColor.rgb * mix(0.85, 1.15, n3) * (uSeason > 2.5 ? 0.78 : 1.0);
        if (sp > 8.5 && sp < 9.5 && uSeason < 0.5) c = pow(mix(vec3(0.85, 0.35, 0.6), vec3(0.95, 0.55, 0.75), n2), vec3(2.2));
        albedo = c * shade * lightK * leafShade * tint;
        leafy = 1.0;
      } else if (bare) {
        // Bare in winter: a sparse lace of twigs where the crown was.
        if (vnoise(vWPos.xz * 2.7 + vWPos.y * 1.9) < 0.72) discard;
        albedo = vec3(0.07, 0.055, 0.045);
      } else {
        albedo = pow(c, vec3(2.2)) * shade * lightK * leafShade * tint;
        leafy = 1.0;
      }
      if (leafy > 0.5) {
        leafBump = vec3(n2 - 0.5, 0.35 * (n1 - 0.5), vnoise3(lp * 3.1 + 9.0) - 0.5) * bumpK * closeL;
        // The sun through the leaves: a glow looking toward it through a crown.
        sEmit += albedo * uSunCol * pow(max(dot(Vw, uSunDir), 0.0), 5.0) * 0.3 * (0.3 + 0.7 * clump);
      }
    }
  } else if (kindF < 1.5) {
    float u = vFacade.x, v = vFacade.y, faceW = vFacade.z;
    float bay = vStyle.x, ratio = vStyle.y, winH = vStyle.z;
    float type = mod(vStyle.w, 8.0);
    float floors = floor(vStyle.w / 8.0 + 0.001);
    bool shopOpen = mod(vFlags, 2.0) > 0.5;
    float shopPal = mod(floor(vFlags / 2.0), 4.0);
    bool darkFrame = mod(floor(vFlags / 8.0), 2.0) > 0.5;
    float litBias = mod(floor(vFlags / 16.0), 8.0) / 7.0;
    bool tiled = mod(floor(vFlags / 128.0), 2.0) > 0.5;
    // A home (buildings.ts HOME_FLAG): a door and a window on a lower ground floor instead of a shop.
    bool home = mod(floor(vFlags / 256.0), 2.0) > 0.5;
    // An informal settlement's shack (buildings.ts INFORMAL_FLAG): patchwork walls.
    bool informal = mod(floor(vFlags / 4194304.0), 2.0) > 0.5;
    const float FH = 3.0;
    float GF = home ? 3.0 : 4.2;

    // Weathering: broad blotches, vertical rain streaks, splash dirt at the base; tile grout close up.
    vec3 wallCol = vColor.rgb;
    float n1 = vnoise(vec2(u, v) * 0.35 + vBid);
    float n2 = vnoise(vec2(u * 1.3, v * 0.07) + vBid * 1.7);
    wallCol *= 0.86 + 0.24 * n1;
    wallCol *= 1.0 - 0.14 * smoothstep(0.55, 0.9, n2);
    wallCol *= 1.0 - 0.3 * exp(-v / 1.1);
    float tileFade = tiled ? 1.0 - smoothstep(0.012, 0.03, max(fwUV.x, fwUV.y)) : 0.0;
    float row = floor(v / 0.1);
    float grout = max(step(fract(v / 0.1), 0.12), step(fract(u / 0.3 + 0.5 * mod(row, 2.0)), 0.035));
    wallCol *= 1.0 - 0.12 * grout * tileFade;
    // Unplastered hollow block (buildings.ts BLOCK_FLAG, Manila's houses): 0.4 x 0.2 m blocks in running bond, each its own tone, the joints dark.
    if (mod(floor(vFlags / 2097152.0), 2.0) > 0.5) {
      float bFade = 1.0 - smoothstep(0.02, 0.06, max(fwUV.x, fwUV.y));
      float brow = floor(v / 0.2);
      float bu = u / 0.4 + 0.5 * mod(brow, 2.0);
      float bj = max(step(fract(v / 0.2), 0.12), step(fract(bu), 0.06));
      wallCol *= mix(1.0, 0.82 + 0.3 * h3(vec3(vBid, floor(bu), brow)), bFade);
      wallCol *= 1.0 - 0.32 * bj * bFade;
    }
    // Wet walls go darker, and unevenly: the rain soaks in in tall runs down the face (broad ones, narrower ones
    // within them), the gaps between filling in as it goes on; the splash zone at the foot is wet through.
    float wetFoot = max(fwUV.x, fwUV.y);
    float wetAt = h1(vBid + 3.0) * 37.0;
    float soak = 0.7 * vnoise(vec2(u * 2.3 + wetAt, v * 0.09 + wetAt * 0.3))
      + 0.3 * mix(0.5, vnoise(vec2(u * 11.0 + wetAt, v * 0.4)), 1.0 - smoothstep(0.03, 0.09, wetFoot));
    soak = smoothstep(0.3, 0.75, soak + (uWet - 0.55) * 0.6);
    float wW = uWet * mix(0.4, 1.0, max(soak, smoothstep(0.7, 0.0, v)));
    wallCol *= 1.0 - 0.4 * wW;
    albedo = wallCol;
    // What the water on the face has to catch besides the sky: the street's lamps and signs, less higher up.
    vec3 wetStreet = uWet > 0.0 ? lightAt(vWPos.xz + Nw.xz * 0.6) * exp(-max(vWPos.y - 0.2, 0.0) / 6.0) : vec3(0.0);

    vec3 T = vec3(Nw.z, 0.0, -Nw.x);
    vec3 rd = vec3(dot(Vw, T), Vw.y, dot(Vw, Nw));
    vec3 refl = skyRefl(reflect(Vw, Nw));

    if (informal) {
      // A shack: a patchwork of mismatched panels (corrugated sheet with vertical ribs, plywood, painted planks, blue
      // tarpaulin, rusted sheet) in patches of about 0.8 x 1.2 m, uneven (each column's rows start at their own
      // height, each row's columns are shifted), the seams dark, rust and stain running down in streaks. One hash per
      // patch, two value noises for the streaks; ribs, seams and grain fade out where they're smaller than a pixel.
      float fine = 1.0 - smoothstep(0.03, 0.09, wetFoot);
      float col0 = floor(u / 0.8);
      float vv = v + (h1(col0 * 2.3 + vBid * 0.13) - 0.5) * 0.7;
      float prow = floor(vv / 1.2);
      float uu = u + h1(prow * 4.1 + vBid * 0.29) * 0.8;
      float pcol = floor(uu / 0.8);
      float pid = h1(pcol * 1.7 + prow * 17.3 + vBid * 0.37);
      float pid2 = h1(pcol * 5.1 + prow * 3.9 + vBid * 0.11);
      float lu = (uu / 0.8 - pcol) * 0.8;
      float lv = (vv / 1.2 - prow) * 1.2;
      vec3 pc;
      float pm = 0.0;
      float pr = 0.8;
      if (pid < 0.3) {
        float rib = mix(1.0, 0.7 + 0.3 * abs(fract(u / 0.1) * 2.0 - 1.0), fine);
        bool rusted = pid2 < 0.45;
        pc = (rusted ? mix(vec3(0.46, 0.25, 0.12), vec3(0.3, 0.17, 0.1), pid2 * 2.2) : mix(vec3(0.54, 0.57, 0.57), vec3(0.4, 0.43, 0.44), pid2)) * rib;
        pm = rusted ? 0.1 : 0.55;
        pr = rusted ? 0.8 : 0.45;
      } else if (pid < 0.5) {
        pc = mix(vec3(0.5, 0.36, 0.22), vec3(0.64, 0.5, 0.32), pid2);
        pc *= mix(1.0, 0.86 + 0.14 * h1(floor(lv * 22.0) + pcol * 3.0 + prow * 7.0 + vBid), fine);
      } else if (pid < 0.68) {
        pc = pid2 < 0.25 ? vec3(0.45, 0.62, 0.5) : pid2 < 0.5 ? vec3(0.4, 0.52, 0.66) : pid2 < 0.75 ? vec3(0.74, 0.55, 0.55) : vec3(0.74, 0.64, 0.3);
        pc *= mix(1.0, 0.55 + 0.45 * smoothstep(0.0, 0.07, fract(uu / 0.14)), fine);
        pc = mix(pc, vec3(0.46, 0.4, 0.32), smoothstep(0.55, 0.9, vnoise(vec2(u * 5.0 + vBid, v * 2.5))) * 0.6);
      } else if (pid < 0.8) {
        float fold = abs(fract((uu + vv * 0.6) / 0.35) * 2.0 - 1.0);
        pc = mix(vec3(0.08, 0.27, 0.62), vec3(0.15, 0.4, 0.8), mix(0.5, fold, fine));
        pr = 0.35;
      } else {
        pc = mix(vec3(0.42, 0.22, 0.12), vec3(0.58, 0.36, 0.2), vnoise(vec2(u * 3.0, v * 3.0) + vBid));
      }
      // Seams, nails' rust, long streaks of rust and stain, grime at the foot.
      float seam = min(min(lu, 0.8 - lu), min(lv, 1.2 - lv));
      pc *= mix(1.0, 0.45 + 0.55 * smoothstep(0.0, 0.035, seam), fine);
      float streak = smoothstep(0.55, 0.85, vnoise(vec2(uu * 3.5 + vBid * 3.1, vv * 0.12)));
      pc = mix(pc, vec3(0.34, 0.15, 0.07), streak * 0.5 * (1.0 - 0.5 * lv / 1.2));
      pc *= 1.0 - 0.4 * smoothstep(0.5, 0.85, vnoise(vec2(u * 0.9 + vBid, v * 0.05)));
      pc *= 1.0 - 0.45 * exp(-v / 0.8);
      albedo = pow(pc, vec3(2.2)) * (1.0 - 0.3 * uWet);
      sMetal = pm;
      sRough = pr;
      if (isFront) {
        // A plank door and a small lit window.
        float ihs = h1(vBid + 5.0);
        float idx = faceW * (ihs < 0.5 ? 0.26 : 0.74);
        float iwx = faceW * (ihs < 0.5 ? 0.66 : 0.34);
        float inLitI = step(h1(vBid + 11.0), clamp(uWindowLit * 1.2, 0.0, 1.0));
        if (abs(u - idx) < 0.38 && v < 1.95) {
          bool frameI = abs(u - idx) > 0.33 || v > 1.89;
          albedo = pow(frameI ? vec3(0.2, 0.16, 0.12) : mix(vec3(0.3, 0.22, 0.15), vec3(0.38, 0.3, 0.2), step(0.5, fract((u - idx) / 0.1))), vec3(2.2));
          sMetal = 0.0;
          sRough = 0.8;
        } else if (abs(u - iwx) < 0.3 && v > 1.15 && v < 1.7 && faceW > 3.0) {
          bool frameW = abs(u - iwx) > 0.26 || v < 1.2 || v > 1.65;
          albedo = frameW ? pow(vec3(0.3, 0.24, 0.18), vec3(2.2)) : vec3(0.02);
          if (!frameW) sEmit = vec3(1.0, 0.78, 0.5) * 0.4 * inLitI;
        }
      }
    } else if (isFront && v < GF && home) {
      // A house front: the door near one end under a little lamp, a window beside it, the wall.
      float hs = h1(vBid + 5.0);
      float dx = faceW * (hs < 0.5 ? 0.24 : 0.76);
      float wx = faceW * (hs < 0.5 ? 0.66 : 0.34);
      float inLit = step(h1(vBid + 11.0), clamp(uWindowLit * 1.2, 0.0, 1.0));
      float du = abs(u - dx);
      if (du < 0.5 && v < 2.15) {
        bool frame = du > 0.44 || v > 2.09;
        bool pane = du < 0.14 && v > 0.9 && v < 1.95;
        albedo = frame ? vec3(0.06) : pane ? vec3(0.05) : mix(vec3(0.22, 0.15, 0.1), vec3(0.42, 0.43, 0.45), step(0.5, h1(vBid + 7.0)));
        if (pane) sEmit = vec3(1.0, 0.8, 0.55) * 0.45 * inLit;
        sRough = 0.5;
      } else if (du < 0.12 && v > 2.3 && v < 2.45) {
        albedo = vec3(0.1);
        sEmit = vec3(1.0, 0.85, 0.6) * 2.0 * uLamps;
      } else if (abs(u - wx) < 0.8 && v > 0.95 && v < 2.1 && faceW > 3.2) {
        float dw = abs(u - wx);
        bool frame = dw > 0.74 || v < 1.01 || v > 2.04 || dw < 0.03;
        albedo = frame ? vec3(0.42, 0.44, 0.47) : vec3(0.02);
        sMetal = frame ? 0.6 : 0.0;
        sRough = frame ? 0.4 : 0.06;
        // Glass: the sky by day; at night some are lit behind their curtains.
        if (!frame) sEmit = mix(refl * fresnel(cosV), vec3(1.0, 0.82, 0.55) * 0.35, inLit);
      }
    } else if (isFront && v < GF) {
      // Storefront (shops.ts, shopShader.ts): pillars, a fascia, then the shop's glazing with what's inside it
      // (its trade's room), or a shutter. At a tower's foot a lobby, bank or showroom runs its glass up to the
      // first floor.
      int tr = int(mod(floor(vFlags / 512.0), 32.0) + 0.5);
      if (tr == 0 && shopPal > 2.5) tr = ${TRADE.bar};
      vec3 hue = SHOP_HUES[int(mod(floor(vFlags / 16384.0), 8.0) + 0.5)];
      vec4 gz = SHOP_GLASS[tr];
      bool towerFoot = (type > 1.5 && type < 2.5) || floors >= 12.0;
      bool tallFront = towerFoot && (tr == ${TRADE.lobby} || tr == ${TRADE.bank} || tr == ${TRADE.hotel} || tr == ${TRADE.fashion} || tr == ${TRADE.gym} || tr == ${TRADE.cafe});
      float gTop = tallFront ? 3.95 : 2.95;
      float fasc = tallFront ? 4.1 : 3.05;
      float pil = tallFront ? 0.25 : 0.35;
      float sw = faceW - 2.0 * pil;
      float sx = u - pil;
      bool woodF = (gz.y > 0.5 && gz.y < 1.5) || gz.y > 2.5;
      vec3 woodC = vec3(0.2, 0.11, 0.05) * (0.85 + 0.3 * h1(vBid + 13.0));
      vec3 frameC = woodF ? woodC : darkFrame ? vec3(0.05) : vec3(0.42, 0.44, 0.47);
      float hb = h1(vBid + 57.0);
      vec3 L = shopLightOf(tr, hue, shopPal, h1(vBid + 21.0));
      // A shady house (windowScenes.ts SHOP_KINDS, shopAtlas.ts): where the zone has the most vice, some shops of
      // a few trades are a strip club, a hostess club, a back-room card game, a loan office... instead (which, and
      // how many, are a texel of numbers by the trade: shadyTable). Such a place doesn't show itself to the
      // street: its glass is blacked out (or frosted, as the trade's is) and only the door, under a short curtain,
      // gives a glimpse in; by day it's all but dark.
      vec4 sv = windowData(float(tr), 3);
      bool shady = shopOpen && mod(floor(vFlags / 131072.0), 4.0) > 2.5 && h1(vBid + 77.0) * 255.0 < sv.a * uWindow.y;
      float hsv = h1(vBid + 83.0);
      int roomN = shady ? int((hsv < 0.34 ? sv.r : hsv < 0.67 ? sv.g : sv.b) + 0.5) : tr;
      if (sx < 0.0 || sx > sw) {
        albedo = tallFront ? wallCol * 0.7 : wallCol * 0.9;
        // A barber's pole turning on the pillar by the door.
        float pu = u - 0.17;
        if (tr == ${TRADE.salon} && hb < 0.4 && abs(pu) < 0.09 && v > 1.2 && v < 2.4) {
          float band = fract((pu / 0.09) * 0.25 + v * 2.2 - uTime * 0.6);
          vec3 pc = band < 0.33 ? vec3(0.85, 0.08, 0.06) : band < 0.5 ? vec3(0.95) : band < 0.83 ? vec3(0.08, 0.2, 0.7) : vec3(0.95);
          bool cap = v < 1.28 || v > 2.32;
          albedo = cap ? vec3(0.7) : pc * (0.7 + 0.3 * (1.0 - abs(pu) / 0.09));
          sRough = 0.2;
          sMetal = cap ? 0.8 : 0.0;
          if (!cap) sEmit = pc * 0.5 * uLamps;
        }
      } else if (v > fasc) {
        // The fascia: the brand's stripes in a lightbox (convenience stores, drugstores), a lit panel in the shop's
        // colour (electronics, games), dark wood (the old shops and counters), the shop's colour painted (cafés,
        // boutiques), stone (lobbies, banks), or plain dark.
        if (tr == ${TRADE.konbini} || tr == ${TRADE.drugstore}) {
          float fy = (v - fasc) / (GF - fasc);
          albedo = fy > 0.18 && fy < 0.34 ? hue : fy > 0.34 && fy < 0.42 ? mix(hue, vec3(1.0), 0.55) : vec3(0.92);
          sEmit = albedo * (0.12 + 0.7 * uLamps);
          sRough = 0.3;
        } else if (tr == ${TRADE.electronics} || tr == ${TRADE.arcade} || tr == ${TRADE.pachinko} || tr == ${TRADE.karaoke} || tr == ${TRADE.hobby} || tr == ${TRADE.maid}) {
          bool rim = v < fasc + 0.05 || v > GF - 0.05;
          albedo = rim ? vec3(0.08) : hue * 0.7;
          if (!rim) sEmit = hue * (0.08 + 0.9 * uLamps);
          sRough = 0.3;
        } else if (woodF || tr == ${TRADE.snack}) {
          albedo = woodC * (0.85 + 0.3 * step(0.5, fract(v / 0.19))) * (0.9 + 0.2 * vnoise(vec2(u * 3.0, v * 40.0)));
          sRough = 0.7;
        } else if (tr == ${TRADE.cafe} || tr == ${TRADE.bakery} || tr == ${TRADE.florist} || tr == ${TRADE.salon} || tr == ${TRADE.books} || tr == ${TRADE.fashion}) {
          albedo = mix(hue, wallCol, 0.45) * 0.55;
          sRough = 0.5;
        } else if (tallFront || tr == ${TRADE.lobby} || tr == ${TRADE.bank}) {
          albedo = wallCol * 0.6;
          sRough = 0.4;
        } else {
          albedo = mix(vec3(0.02), wallCol * 0.45, h1(vBid + 3.0));
          sRough = 0.45;
        }
      } else if (v > gTop) {
        // The head rail under the fascia.
        albedo = frameC;
        sMetal = woodF ? 0.0 : 0.6;
        sRough = woodF ? 0.7 : 0.4;
      } else if (shopOpen) {
        float nm = max(1.0, floor(sw / gz.x + 0.5));
        float mw = sw / nm;
        float bi = floor(sx / mw);
        float mx = sx - bi * mw;
        bool door = bi == floor(h1(vBid + 31.0) * nm);
        float ft = gz.y > 1.5 && gz.y < 2.5 ? 0.02 : woodF ? 0.07 : 0.05;
        bool frame = mx < ft || mx > mw - ft || v > gTop - ft;
        // Old shops have a transom bar; the solid lower panel stops at the door, which runs down to a kick plate.
        bool transom = woodF && abs(v - 2.2) < 0.035;
        float lowTop = door ? 0.1 : gz.z;
        if (frame || transom) {
          albedo = frameC;
          sMetal = woodF ? 0.0 : 0.7;
          sRough = woodF ? 0.7 : 0.35;
        } else if (v < lowTop) {
          albedo = woodF ? woodC * (0.85 + 0.3 * step(0.5, fract(mx / 0.15))) : tr == ${TRADE.bar} || tr == ${TRADE.snack} || tr == ${TRADE.lounge} ? vec3(0.06) : mix(frameC, wallCol, 0.5) * 0.8;
          sMetal = woodF ? 0.0 : 0.3;
          sRough = 0.5;
        } else {
          float F = fresnel(cosV);
          float cw = mw - 2.0 * ft;
          float cx = mx - ft;
          bool covered = true;
          if (door && v > 2.05 && (shady || tr == ${TRADE.noodles} || tr == ${TRADE.izakaya} || (tr == ${TRADE.craft} && hb < 0.6))) {
            // Noren over the door of a noodle shop, an izakaya or an old shop: cloth in the shop's colour (deep
            // indigo in most), split in three, the shop's mark in white. A shady house's is dark red.
            vec3 cloth = shady ? vec3(0.2, 0.015, 0.04) : mix(hue, vec3(0.04, 0.06, 0.2), hb < 0.5 ? 0.75 : 0.25);
            float slit = fract(cx / (cw / 3.0));
            float ring = abs(length(vec2(cx - cw * 0.5, v - 2.48)) - 0.12);
            albedo = slit < 0.02 ? vec3(0.02) : ring < 0.022 && cw > 0.5 ? vec3(0.92) : cloth * (0.85 + 0.15 * sin(cx * 25.0));
            sRough = 0.9;
            sEmit = albedo * L * 0.12 * uLamps;
          } else if (gz.y > 2.5 && !door && v < 2.2 && fract(cx / 0.06) < 0.48) {
            // Wooden lattice (kōshi) across an old shop's panels.
            albedo = woodC * 1.15;
            sRough = 0.7;
          } else if (tr == ${TRADE.estate} && !door && v > 0.85 && v < 2.45 && fract(cx / 0.26) > 0.08 && fract((v - 0.85) / 0.34) > 0.06 && h2(floor(vec2(cx / 0.26, (v - 0.85) / 0.34)) + vBid) < 0.88) {
            // An estate agent's listings taped over the glass: a plan and a price on each.
            vec2 sf = fract(vec2(cx / 0.26, (v - 0.85) / 0.34));
            albedo = vec3(0.92, 0.92, 0.88);
            if (sf.y > 0.82) albedo = h2(floor(vec2(cx / 0.26, (v - 0.85) / 0.34)) + 3.0) < 0.5 ? vec3(0.8, 0.1, 0.08) : hue;
            else if (sf.y > 0.25 && sf.y < 0.75 && sf.x > 0.18 && sf.x < 0.92 && (fract(sf.x * 3.0) < 0.12 || fract(sf.y * 3.0) < 0.12)) albedo = vec3(0.35);
            else if (sf.y < 0.2 && fract(sf.x * 9.0) < 0.6) albedo = vec3(0.4);
            sRough = 0.8;
            // Paper on the glass, the shop's light shining through it.
            sEmit = albedo * L * 0.55 * max(uLamps, 0.3);
          } else if ((tr == ${TRADE.konbini} || tr == ${TRADE.drugstore} || tr == ${TRADE.electronics} || tr == ${TRADE.hobby} || tr == ${TRADE.karaoke} || tr == ${TRADE.pachinko}) && !door && h3(vec3(vBid, bi, 3.0)) < 0.4 && v > 1.0 && v < 1.75 && cx > 0.15 && cx < cw - 0.15) {
            // Posters and sale bills on the glass.
            float ph = h3(vec3(vBid, bi, 5.0));
            albedo = ph < 0.3 ? vec3(1.0, 0.85, 0.1) : ph < 0.55 ? vec3(0.85, 0.1, 0.08) : ph < 0.8 ? hue : vec3(0.95);
            if (abs(v - 1.38) < 0.12 && fract(cx * 5.0) < 0.6) albedo = ph < 0.3 ? vec3(0.85, 0.1, 0.08) : vec3(0.95);
            sRough = 0.6;
            sEmit = albedo * L * 0.6 * max(uLamps, 0.3);
          } else covered = false;
          if (!covered) {
            // Frosted film: a band at eye height with a stripe in the shop's colour (clinic, bank, maid café), or
            // most of the glass (a snack bar, the mahjong parlour; a love hotel's, all but its door): milky,
            // glowing with the light behind it.
            bool fullFrost = tr == ${TRADE.snack} || tr == ${TRADE.mahjong} || tr == ${TRADE.lovehotel};
            bool frost = gz.w > 0.5 && (fullFrost ? v < 2.15 && !(door && (shady || tr == ${TRADE.lovehotel})) : !door && v > 1.05 && v < 1.5);
            if (frost) {
              float stripe = fullFrost ? step(abs(v - 1.9), 0.015) : step(abs(v - 1.27), 0.03);
              albedo = mix(fullFrost ? vec3(0.32, 0.33, 0.34) : vec3(0.55, 0.57, 0.58), hue, stripe);
              sRough = 0.35;
              sEmit = mix(L * (fullFrost ? 0.14 : 0.25) * max(uLamps, 0.45), hue * 0.5 * max(uLamps, 0.3), stripe) + refl * F * 0.5;
            } else if (shady && !door) {
              // Blacked-out glass: the street in it, and a thread of the house's colour along the bottom.
              albedo = vec3(0.012);
              sRough = 0.1;
              sEmit = refl * F * 0.8 + hue * step(v, lowTop + 0.04) * 0.5 * uLamps;
            } else {
              vec3 interior = shopInterior(vec2(sx, v), rd, sw, roomN, vBid, hue, L, length(vWPos - cameraPosition), pxAng) * max(uLamps, shady ? 0.2 : 0.55);
              // At a tower's foot the glass is tinted like the curtain wall above it.
              if (towerFoot) interior *= vec3(0.75, 0.85, 0.88);
              albedo = vec3(0.02);
              sRough = 0.06;
              sEmit = interior * (1.0 - F) + refl * F;
              if (uWet > 0.0) sEmit = wetPane(sEmit, interior, refl * 1.2 + wetStreet * 0.6 + 0.02, vec2(u + wetAt, v), wetFoot, uWet, uTime);
              // The door's pull handle, and the opening hours on it.
              if (door && !woodF && v > 0.85 && v < 1.35 && abs(mx - (mw - 0.14)) < 0.015) { albedo = vec3(0.7); sMetal = 0.9; sRough = 0.25; sEmit = vec3(0.0); }
              else if (door && v > 1.45 && v < 1.58 && abs(cx - cw * 0.5) < 0.09) { albedo = abs(v - 1.55) < 0.02 ? hue : vec3(0.92); sRough = 0.7; sEmit = L * 0.08; }
            }
          }
        }
      } else {
        // Roll-down shutter; some painted in the shop's colour.
        float rib = fract(v / 0.09);
        float ribFade = 1.0 - smoothstep(0.008, 0.025, fwUV.y);
        vec3 sc = hb < 0.25 ? mix(hue, vec3(0.5), 0.5) : vec3(0.4, 0.41, 0.43);
        albedo = sc * (1.0 - 0.3 * ribFade * smoothstep(0.3, 0.5, abs(rib - 0.5))) * (0.8 + 0.4 * n1);
        sMetal = 0.4;
        sRough = 0.5;
      }
    } else if (type < 4.5 && faceW > 1.5) {
      float margin = 0.5;
      float span = faceW - 2.0 * margin;
      float nb = max(1.0, floor(span / bay));
      float b = span / nb;
      float ux = u - margin;
      float col = floor(ux / b);
      float xb = ux - col * b;
      float fv = v - GF;
      float fl = floor(fv / FH);
      float yf = fv - fl * FH;
      bool inGrid = ux >= 0.0 && ux < span && fv >= 0.0 && fl < floors;

      // How much of a room shows past the window reveal (recess ~0.25 m): little when seen side-on.
      float reveal = smoothstep(0.06, 0.4, cosV);
      // Window rectangle within the bay (x) and floor (y), by type.
      float x0 = 0.0, x1 = b, y0 = 0.9, y1 = 0.9 + winH;
      // Whose rooms these are. Ribbon and curtain-wall floors are offices, unless the building is a home
      // (HOME_FLAG), a hotel (its sign's trade: a hotel or a love hotel) or a tenant building of bars and clubs
      // (buildings.ts DEN_FLAG), whose rooms are a bay each and lit like any flat's; behind punched windows and
      // balcony doors, flats. viceLv: how much of the city's vice its zone has (buildings.ts VICE_SHIFT: 0 to 3).
      bool wide = type > 0.5 && type < 2.5;
      float trade = mod(floor(vFlags / 512.0), 32.0);
      bool hotel = !home && trade > ${TRADE.hotel - 0.5} && trade < ${TRADE.lovehotel + 0.5};
      bool love = hotel && trade > ${TRADE.lovehotel - 0.5};
      bool den = !home && !hotel && mod(floor(vFlags / 524288.0), 2.0) > 0.5;
      float viceLv = mod(floor(vFlags / 131072.0), 4.0);
      bool office = wide && !home && !hotel && !den;
      vec3 glassTint = wide && !home ? vec3(0.62, 0.78, 0.82) : vec3(1.0);
      if (type < 0.5) { float ww = b * ratio; x0 = (b - ww) * 0.5; x1 = x0 + ww; y1 = min(y1, FH - 0.35); }
      else if (type < 1.5) { y0 = 0.95; y1 = min(0.95 + winH, FH - 0.3); }
      else if (type < 2.5) { y0 = 0.0; y1 = FH; }
      else if (type < 3.5) { float ww = b * 0.86; x0 = (b - ww) * 0.5; x1 = x0 + ww; y0 = 0.05; y1 = 2.25; }
      else { x0 = b * 0.5 - 0.32; x1 = b * 0.5 + 0.32; y0 = 1.45; y1 = 2.05; inGrid = inGrid && h3(vec3(vBid, col, fl)) > 0.45; }

      // Arched windows (buildings.ts ARCH_FLAG, Manila): taller, with a round head.
      float archD = 9.0;
      if (type < 0.5 && mod(floor(vFlags / 1048576.0), 2.0) > 0.5) {
        y1 = FH - 0.3;
        float rad = (x1 - x0) * 0.5;
        float cy = y1 - rad;
        if (yf > cy) {
          archD = rad - length(vec2(xb - (x0 + x1) * 0.5, yf - cy));
          if (archD < 0.0) { x1 = x0; }
        }
      }
      bool inWin = inGrid && xb > x0 && xb < x1 && yf > y0 && yf < y1;
      // Rooms span 2 bays on ribbon / curtain-wall floors (open-plan offices; the bays are narrow, so a flat or a
      // bar behind them takes two as well, a hotel room one).
      float pair = wide && !hotel ? 2.0 : 1.0;
      float roomCol = floor(col / pair);
      float rw = b * pair;
      float rx = xb + (col - roomCol * pair) * b;
      float hr = h3(vec3(vBid, roomCol, fl));
      // How many rooms are lit: the atmosphere's share, the building's own bias, and what the building is at this
      // hour (uLit). A room's hash against it is its bedtime, so the lights go out one by one (each eased over a
      // couple of seconds); an office's hash is mostly its floor's, so floors are lit or dark together.
      float litFrac = clamp(uWindowLit * (0.35 + 1.3 * litBias) * (office ? uLit.x : den || love ? uLit.w : hotel ? uLit.z : uLit.y), 0.0, 1.0);
      float glow = clamp((litFrac - (office ? 0.65 * h3(vec3(vBid, 7.0, fl)) + 0.35 * hr : hr)) / 0.012, 0.0, 1.0);
      bool legacy = uWindow.w < 0.0;
      if (legacy) {
        glow = step(hr, clamp(uWindowLit * (0.35 + 1.3 * litBias), 0.0, 1.0));
      }
      bool lit = glow > 0.0;

      vec3 detailAlbedo = albedo;
      vec3 detailEmit = vec3(0.0);
      float detailRough = sRough;
      float detailMetal = 0.0;
      if (inWin) {
        float fx = min(xb - x0, x1 - xb);
        float fy = min(min(yf - y0, y1 - yf), archD);
        float fr = type > 1.5 && type < 2.5 ? 0.05 : 0.07;
        bool spandrel = type > 1.5 && type < 2.5 && yf < 0.5;
        bool sash = type < 0.5 && (x1 - x0) > 1.3 && abs(xb - (x0 + x1) * 0.5) < 0.03;
        bool mullion = wide && (xb < 0.04 || xb > b - 0.04);
        if (spandrel) {
          detailAlbedo = mix(wallCol * 0.3, vec3(0.03, 0.04, 0.05), 0.6);
          detailRough = 0.25;
          detailEmit = refl * fresnel(cosV) * 0.6;
        } else if (fx < fr || fy < fr || sash || mullion) {
          detailAlbedo = darkFrame ? vec3(0.035) : vec3(0.42, 0.44, 0.47);
          detailMetal = 0.7;
          detailRough = 0.35;
        } else {
          float face;
          float depth = 3.5 + 3.0 * h1(hr * 91.0);
          vec3 hp = roomHit(vec3(rx, yf, 0.0), rd, rw, FH - 0.25, depth, face);
          float hl = h1(hr * 37.0);
          vec3 L = (legacy ? roomLightColorOld(hl, office) : roomLightColor(hl, office)) * glow;
          // The rooms lit by a television: its light drifts, gently (between scenes, not frame to frame: eased from
          // one level to the next about once a second, within a fifth of its brightness).
          bool tvRoom = !legacy && !office && !den && hl >= 0.94;
          float tvT = uTime * 0.9 + hr * 57.0;
          L *= tvRoom ? 0.86 + 0.2 * mix(h1(floor(tvT)), h1(floor(tvT) + 1.0), smoothstep(0.0, 1.0, fract(tvT))) : 1.0;
          // A tenant building's bars and clubs and a love hotel's rooms are lit like any room, only lower and
          // warmer: dim lamplight. A minority have a faint tint to it, a dull amber or a muted rose (DEN_TINT: how
          // much of the tint; nothing saturated).
          float hc = h1(hr * 41.0);
          vec3 lampL = mix(vec3(1.0, 0.8, 0.58), hc < 0.14 ? vec3(1.0, 0.72, 0.46) : hc < 0.28 ? vec3(1.0, 0.72, 0.62) : vec3(1.0, 0.8, 0.58), ${DEN_TINT});
          if ((den || love) && !legacy) L = lampL * (${DEN_LIGHT} * glow);
          // A room that's a place (most are): its furniture and whoever is in it come from the scenes' atlas, below.
          float forced = step(0.0, uWindow.z);
          bool furnished = !legacy && type < 3.5 && (h1(hr * 101.0) < uWindow.w || forced > 0.5);
          vec3 wallA = mix(vec3(0.78, 0.74, 0.68), vec3(0.62, 0.66, 0.7), h1(hr * 13.0));
          vec3 c;
          float depthT = -hp.z / depth;
          if (face < 0.5) {
            c = wallA * 0.85;
            // A dark furniture silhouette against the back wall (the rooms without a scene).
            float fxp = rw * (0.25 + 0.5 * h1(hr * 53.0));
            if (!furnished && hp.y < 0.55 + 1.4 * h1(hr * 71.0) && abs(hp.x - fxp) < 0.4 + 0.5 * h1(hr * 29.0)) c = vec3(0.09, 0.07, 0.06);
          } else if (face < 1.5) {
            c = wallA * 0.75;
          } else if (face < 2.5) {
            c = vec3(0.9) * (1.0 + 0.9 * exp(-depthT * 4.0) * (office ? 1.2 : 0.6));
          } else {
            c = office ? vec3(0.4, 0.42, 0.45) : mix(vec3(0.36, 0.24, 0.15), vec3(0.5, 0.45, 0.38), h1(hr * 17.0));
          }
          // What's in the room (windowScenes.ts: the scenes; windowAtlas.ts paints them, the mob's own figures posed,
          // under the storefronts' masks): dark shapes against its light, in three layers that part as you move.
          // Against the back wall its furniture (and in a still scene anyone back there); some way in from the
          // glass the people, in one of two frames, or walking to and fro; just in front of them the furniture
          // they're at. The furniture is there whoever is in; the people come by the hour.
          // Which scene goes with the building: a home's, an office's, a hotel's, a bar's or club's; and in a
          // share of rooms that grows with the zone's vice (most of a love hotel's), one where the city's vice
          // shows, peopled at its own hours of the night (uNight). Glass to the floor (curtain walls, balcony
          // doors) also gets the scenes that lie low. Stable by the room's hash; straight-line code: four reads
          // of the cells and four texels of numbers, so a new scene is new data and never new shader.
          if (furnished && (lit || uLamps < 0.97)) {
            float hw = h1(hr * 113.0);
            float hk = h1(hr * 127.0);
            float hm = h1(hr * 139.0);
            float vshare = love ? 0.8 : den ? 0.3 + 0.1 * viceLv : viceLv < 0.5 ? 0.012 : viceLv < 1.5 ? 0.06 : viceLv < 2.5 ? 0.15 : 0.3;
            bool vice = h1(hr * 163.0) < vshare * uWindow.y;
            // The kind of room (windowScenes.ts CATS, in that order), its pick list for this glass, the scene
            // picked from it, and how that scene plays: all numbers in the atlas (windowTables), a texel each.
            float kind = vice ? (love ? 8.0 : hotel ? 7.0 : den ? 9.0 : office ? 6.0 : 5.0) : (hotel ? 3.0 : den ? 4.0 : office ? 2.0 : tvRoom ? 1.0 : 0.0);
            vec4 list = windowData(kind * 2.0 + step(1.5, type), 1);
            float fn = mix(windowData(list.r + 256.0 * list.g + floor(hm * list.b), 2).r, uWindow.z, forced);
            vec4 pd = windowData(fn, 0);
            vec4 pe = windowData(fn, 4);
            // Its play: cycles a second, the first pose's share of one, the walk's speed; its hours, whether its
            // back furniture stands close, how many poses it has.
            vec3 play = vec3(pd.r * ${4 / 255}, pd.g / 255.0, pd.b * ${2 / 255});
            float bits = floor(pd.a + 0.5);
            float when = mod(bits, 4.0);
            float near = mod(floor(bits * 0.25), 2.0);
            float nposes = floor(bits * 0.125) + 1.0;
            // Who's in: by day the offices are at work and few are at home; with the lamps on, by the hour, and
            // never in a dark room.
            vec3 folk3 = mix(vec3(1.0, 0.3, 0.25), uFolk, uLamps);
            float folk = vice ? (when < 0.5 ? uNight.y : when < 1.5 ? uNight.z : uNight.w) : hotel ? folk3.z : den ? uNight.x : office ? folk3.x : folk3.y;
            float here = max(step(hw, (lit ? (vice ? 1.0 : 0.6) : 0.4 * (1.0 - uLamps)) * folk * uWindow.x), forced);
            // Where the scene stands: across the room (mirrored in half of them), the people 0.7 to 1.8 m in, and
            // as much further as the scene asks (its setBack, cm: a number it already has), short of the far wall.
            float dm = min(0.7 + 1.1 * h1(hr * 151.0) + pe.a * 0.01, depth - 0.8);
            // (What's behind them: against the back wall, or in some scenes close behind: the sofa they sit on.)
            float db = mix(depth - 0.3, dm + 0.45, near);
            float flipS = h1(hr * 173.0) < 0.5 ? -1.0 : 1.0;
            float cx0 = rw * 0.5 + (h1(hr * 181.0) - 0.5) * max(rw - 3.4, 0.0);
            // Walkers cross the room and come back, facing the way they go.
            float sl = step(0.001, play.z);
            float span = rw + 1.2;
            float pp = fract(uTime * play.z / (2.0 * span) + hk) * 2.0;
            float cxm = mix(cx0, rw * 0.5 + (0.5 - abs(pp - 1.0)) * span, sl);
            float flipM = mix(flipS, pp < 1.0 ? 1.0 : -1.0, sl);
            vec3 ro2 = vec3(rx, min(yf, FH - 0.26), 0.0);
            float iz = 1.0 / max(-rd.z, 1e-3);
            // Too small to make out, it all fades (and the atlas's neighbours would bleed in at coarser levels).
            float flod = log2(max((length(vWPos - cameraPosition) + dm * iz) * pxAng * ${WINDOW_ATLAS.ppm}.0, 1.0));
            float lodS = min(flod, 4.0);
            vec3 qb = ro2 + rd * (db * iz);
            vec3 qm = ro2 + rd * (dm * iz);
            vec3 qf = ro2 + rd * ((dm - 0.3) * iz);
            // (Each layer only in front of what the ray meets, and inside the room.)
            vec4 sb = windowScene(fn, vec2((qb.x - cx0) * flipS, qb.y), lodS) * (step(db, -hp.z) * step(0.0, qb.x) * step(qb.x, rw));
            vec4 sf = windowScene(fn, vec2((qf.x - cx0) * flipS, qf.y), lodS) * (step(dm - 0.3, -hp.z) * step(0.0, qf.x) * step(qf.x, rw));
            // The people's poses play there and back, never cut: they rest in the first, move through the others
            // to the last over the scene's go seconds (eased), rest there and come back; where they are between
            // two poses the two outlines (distance fields) are blended, so the shape moves across. Each room on
            // its own phase and at its own pace (a tenth either way), so no two windows move in step.
            float still = step(nposes, 1.5);
            float rate = play.x * (0.9 + 0.2 * hm);
            float ph = fract(uTime * rate + hk * 7.0);
            float go = max(min(pe.b * 0.01 * rate, min(play.y, 1.0 - play.y)), 1e-4);
            float at = (nposes - 1.0) * (smoothstep(play.y - go, play.y, ph) - smoothstep(1.0 - go, 1.0, ph));
            float p0 = min(floor(at), max(nposes - 2.0, 0.0));
            float p1 = min(p0 + 1.0, nposes - 1.0);
            // (Where a pose is: the first two in the scene's own cell, G and A; the rest in the frame slots.)
            vec2 w0 = p0 < 1.5 ? vec2(fn, 1.0 + 2.0 * p0) : vec2(pe.r + floor((pe.g + p0 - 2.0) * 0.25), mod(pe.g + p0 - 2.0, 4.0));
            vec2 w1 = p1 < 1.5 ? vec2(fn, 1.0 + 2.0 * p1) : vec2(pe.r + floor((pe.g + p1 - 2.0) * 0.25), mod(pe.g + p1 - 2.0, 4.0));
            vec2 qp = vec2((qm.x - cxm) * flipM, qm.y);
            float inM = step(dm, -hp.z) * step(0.0, qm.x) * step(qm.x, rw);
            float v0 = dot(windowScene(w0.x, qp, lodS), step(abs(vec4(0.0, 1.0, 2.0, 3.0) - w0.y), vec4(0.5)));
            float v1 = dot(windowScene(w1.x, qp, lodS), step(abs(vec4(0.0, 1.0, 2.0, 3.0) - w1.y), vec4(0.5)));
            // (The outline's softness: half a texel up close, wider as the texels shrink on screen.)
            float sw = min(0.035 * exp2(lodS), 0.3);
            float people = smoothstep(0.5 - sw, 0.5 + sw, mix(v0, v1, at - p0)) * inM * here;
            float vis = 1.0 - smoothstep(3.0, 4.0, flod);
            // Further in, a little of the room's light on them.
            vec3 ink = vec3(0.028, 0.027, 0.03);
            c = mix(c, ink + wallA * 0.2, max(smoothstep(0.3, 0.6, sb.r), smoothstep(0.5 - sw, 0.5 + sw, sb.a) * still * here) * vis);
            c = mix(c, ink + wallA * 0.05, people * vis);
            c = mix(c, ink, smoothstep(0.3, 0.6, sf.b) * vis);
          }
          vec3 interior = c * mix(1.0, 0.45, depthT) * (L * 0.55 + uRoomAmbient);
          // Blinds (lowered from the top) or curtains (drawn in from the sides).
          float hb = h1(hr * 43.0);
          if (hb < 0.3) {
            float blindY = mix(y1, y0, 0.2 + 0.8 * h1(hr * 61.0));
            if (yf > blindY) {
              float slat = 1.0 - smoothstep(0.004, 0.012, fwUV.y);
              vec3 blindC = mix(vec3(0.75, 0.73, 0.68), vec3(0.85), h1(hr * 7.0));
              interior = blindC * (L * 0.4 + uRoomAmbient * 0.8 + 0.01) * (1.0 - 0.35 * slat * step(0.75, fract(yf / 0.05)));
            }
          } else if (hb < 0.55) {
            float cw = (x1 - x0) * (0.15 + 0.3 * h1(hr * 67.0));
            if (xb < x0 + cw || xb > x1 - cw) {
              vec3 fabric = h1(hr * 83.0) < 0.5 ? vec3(0.8, 0.7, 0.55) : h1(hr * 89.0) < 0.5 ? vec3(0.55, 0.65, 0.55) : vec3(0.5, 0.15, 0.15);
              float fold = 0.8 + 0.2 * sin(xb * 40.0) * (1.0 - smoothstep(0.004, 0.015, fwUV.x));
              interior = fabric * fold * (L * 0.5 + uRoomAmbient + 0.005);
            }
          }
          // Windows sit back in the wall: seen from a steep angle the reveal hides the room, so a wall seen
          // side-on doesn't turn into one flat sheet of lit interiors.
          interior *= reveal;
          float F = fresnel(cosV);
          vec3 tint = glassTint;
          if (type > 1.5 && type < 2.5) F = mix(F, 1.0, 0.3);
          detailAlbedo = vec3(0.015);
          detailRough = 0.05;
          detailEmit = (interior * (1.0 - F) + refl * F) * tint;
          // Rain on the glass (carRainGlsl.ts): water sheeting down it, and up close the drops.
          if (uWet > 0.0) detailEmit = wetPane(detailEmit, interior * tint, refl * 1.2 + wetStreet * 0.6 + 0.02, vec2(u + wetAt, v), wetFoot, uWet, uTime);
        }
      } else if (inGrid) {
        // Floor-slab bands and window sills.
        if (type < 0.5 && yf < 0.22 && h1(vBid + 9.0) > 0.5) detailAlbedo = wallCol * 0.78;
        if (xb > x0 && xb < x1 && yf < y0 && yf > y0 - 0.07) detailAlbedo = wallCol * 0.6;
      }
      // Prefilter per axis: when bays get under a few pixels (walls seen at grazing angles) the window
      // rows blur into horizontal bands; when floors do too, the facade fades to its average.
      float detailX = smoothstep(1.5, 4.0, b / fwUV.x);
      float detailY = smoothstep(1.5, 4.0, FH / fwUV.y);
      float xFrac = type < 0.5 ? ratio : type < 2.5 ? 0.95 : type < 3.5 ? 0.86 : 0.1;
      float yFrac = (y1 - y0) / FH;
      // The glass's average look where windows are too small to draw. It needs the same Fresnel as the windows
      // up close: at a grazing angle glass mostly reflects the (dark) sky, and only a sliver of each lit room
      // shows past its frame. Without it, walls seen edge-on glowed a flat gold.
      float Fa = fresnel(cosV);
      // The lit share averages what the rooms look like up close: offices cool white behind tinted glass, homes
      // warm; each room about 0.3 of its light (wall colour, depth falloff). It was a flat warm gold at 0.4,
      // so distant towers glowed gold until you came close enough to see their windows.
      vec3 roomAvg = office ? vec3(0.53, 0.74, 0.82) : vec3(1.0, 0.72, 0.45) * (den || love ? ${DEN_LIGHT} : 1.0) * glassTint;
      vec3 glassAvg = (litFrac * roomAvg * 0.28 + uRoomAmbient * 0.3) * reveal * (1.0 - Fa) + refl * mix(0.2, 0.9, Fa);
      bool rowY = ux >= 0.0 && ux < span && fv >= 0.0 && fl < floors && yf > y0 && yf < y1;
      vec3 bandAlbedo = rowY ? mix(wallCol, vec3(0.02), xFrac) : detailAlbedo;
      vec3 bandEmit = rowY ? glassAvg * xFrac : vec3(0.0);
      vec3 avgAlbedo = mix(wallCol, vec3(0.02), xFrac * yFrac);
      vec3 avgEmit = glassAvg * xFrac * yFrac;
      albedo = mix(avgAlbedo, mix(bandAlbedo, detailAlbedo, detailX), detailY);
      sEmit = mix(avgEmit, mix(bandEmit, detailEmit, detailX), detailY);
      float dd = detailX * detailY;
      sRough = mix(0.6, detailRough, dd);
      sMetal = detailMetal * dd;
    }
    if (uWet > 0.0) {
      // The film of water on the face: the sky in it, and the street's light, most at grazing angles and where the
      // wall is wettest; and threads of water trickling down it (carRainGlsl.ts), catching the same.
      float Fw = fresnel(cosV);
      sEmit += (refl * Fw * 0.3 + wetStreet * (0.02 + 0.3 * Fw)) * wW;
      sEmit += (refl * 0.35 + wetStreet * 0.3 + 0.004) * wallRuns(vec2(u, v), wetAt, wetFoot, uTime) * (0.4 + 0.6 * soak) * uWet * 0.6;
      sRough = mix(sRough, sRough * 0.4, wW);
    }
  } else if (kindF < 2.5) {
    albedo *= 0.75 + 0.4 * vnoise(vWPos.xz * 0.6) * (0.8 + 0.4 * vnoise(vWPos.xz * 4.0));
    sRough = 0.95;
    // Wet roofs: darker, and glossy enough for the reflections (ssr.ts) to read.
    albedo *= 1.0 - 0.35 * uWet;
    sRough = mix(0.95, 0.25, uWet);
  } else if (kindF > 3.5 && kindF < 6.5) {
    // Car paint, glass and chrome: glossy, reflecting the sky (and the street light below).
    bool isGlass = kindF > 4.5 && kindF < 5.5;
    bool isChrome = kindF > 5.5;
    float F = fresnel(cosV);
    vec3 refl = skyRefl(reflect(Vw, Nw));
    albedo = isGlass ? vec3(0.01) : isChrome ? vColor.rgb * 0.35 : vColor.rgb;
    sRough = isGlass ? 0.05 : isChrome ? 0.15 : 0.28;
    sMetal = isGlass ? 0.0 : isChrome ? 1.0 : 0.25;
    sEmit = refl * (isGlass ? vec3(mix(0.06, 1.0, F)) : isChrome ? vColor.rgb * mix(0.55, 1.0, F) : vec3(mix(0.02, 0.7, F)));
    // Rain on paint, glass and chrome (carRainGlsl.ts): a wet film, and up close the drops themselves, stuck to
    // the body (vLPos): beads in two sizes standing on what faces up, and on the sides and the glass drops
    // running down with a trail and small ones clinging. Each is shaded as a lens: dark where it meets the
    // paint, the light pooled at its far side, a hard glint on the near one (the sky, and the street's lamps).
    if (uWet > 0.0 && !indoor) {
      sEmit += refl * F * 0.25 * uWet;
      // A pixel's size on the body (m): drops smaller than it fade out.
      float foot = max(length(fwidth(vLPos)), 1e-5);
      if (foot < 0.009) {
        // Which way the body faces here, in its own frame (the facet's: it only picks how the drops lie).
        vec3 fn = abs(normalize(cross(dFdx(vLPos), dFdy(vLPos))));
        float seen = 1.0 - smoothstep(0.003, 0.009, foot);
        float fine = 1.0 - smoothstep(0.0012, 0.0035, foot);
        vec3 drop;
        if (fn.y > 0.72) {
          drop = rainBeads(vLPos.xz / 0.021, 0.42 * uWet, 0.0) * vec3(1.0, 1.0, seen);
          if (drop.z <= 0.0) drop = rainBeads(vLPos.xz / 0.008 + 17.0, 0.5 * uWet, 31.0) * vec3(1.0, 1.0, fine);
        } else {
          vec2 sp = fn.x > fn.z ? vLPos.zy : vLPos.xy;
          drop = rainRuns(sp, uTime) * vec3(1.0, 1.0, seen * uWet);
          if (drop.z <= 0.0) drop = rainBeads(sp / vec2(0.011, 0.015) + 5.0, 0.45 * uWet, 53.0) * vec3(1.0, 1.0, 1.0 - smoothstep(0.002, 0.006, foot));
        }
        // The wipers' fans are clear behind the blade, the drops coming back until it's round again.
        if (isGlass && drop.z > 0.0 && uWiperCount > 0) {
          vec2 wf = wiped(vWPos, Nw);
          drop.z *= 1.0 - wf.x * (1.0 - smoothstep(0.15, 1.7, wf.y));
        }
        if (drop.z > 0.0) {
          vec3 glint = refl * 1.2 + lightAt(vWPos.xz) * 0.6 + skyRefl(vec3(0.0, 1.0, 0.0)) * 0.5 + 0.02;
          // (On glass and dark paint there's little under a drop to darken: the light in it carries it.)
          vec2 lens = rainLens(drop, isGlass ? 0.12 : 0.04);
          albedo *= 1.0 - 0.45 * lens.x;
          sEmit *= 1.0 - 0.5 * lens.x;
          sEmit += glint * lens.y;
        }
      }
    }
  } else if (kindF < 3.5) {
    float ch = vStyle.x;
    if (ch > 2.5) {
      // Surfaces lit by their own fixtures (platforms, concourses, train interiors): full albedo, plus a
      // share of their colour as light, at night only (lit) or always (interior).
      albedo = vColor.rgb;
      sEmit = vColor.rgb * (ch > 3.5 ? 0.42 : uLamps * 0.3);
    } else {
      float gain = ch < 0.5 ? 1.6 : ch < 1.5 ? uLamps * 6.0 : uNeon * 3.5 * flick(vBid);
      sEmit = vColor.rgb * gain;
      albedo = vColor.rgb * 0.3;
    }
  } else {
    vec2 p = vWPos.xz;
    float gn = vnoise(p * 0.35);
    float gn2 = vnoise(p * 2.7);
    float fine = 1.0 - smoothstep(0.02, 0.06, max(fwW.x, fwW.y));
    if (kindF < 7.5) {
      albedo = vec3(0.045, 0.045, 0.05) * (0.8 + 0.4 * gn) * (0.9 + 0.2 * mix(0.5, gn2, fine));
      if (vnoise(p * 0.07) > 0.68) albedo *= 0.75;
      sRough = 0.92;
    } else if (kindF < 8.5) {
      vec2 q = abs(fract(p / 0.3) - 0.5);
      float groutS = step(0.44, max(q.x, q.y)) * fine;
      albedo = vColor.rgb * (0.85 + 0.3 * mix(0.5, h2(floor(p / 0.3)), fine)) * (1.0 - 0.35 * groutS) * (0.85 + 0.3 * gn);
      sRough = 0.85;
    } else if (kindF < 9.5) {
      albedo = vColor.rgb * (0.65 + 0.35 * smoothstep(0.15, 0.7, mix(0.5, gn2, fine)));
      sRough = 0.7;
    } else if (kindF < 10.5) {
      albedo = vColor.rgb * (0.78 + 0.4 * gn);
      sRough = 0.9;
    } else if (kindF < 11.5) {
      // Grass: patchy lawn, blades up close.
      float blades = mix(0.5, h2(floor(p * 9.0)), fine);
      albedo = vColor.rgb * (0.7 + 0.45 * gn) * (0.8 + 0.4 * blades) * mix(vec3(1.0), vec3(1.15, 1.05, 0.7), smoothstep(0.55, 0.8, vnoise(p * 0.12)));
      // The season: fresh in spring, deep in summer, going gold in autumn, straw in winter.
      if (uSeason < 0.5) albedo *= vec3(1.08, 1.12, 0.9);
      else if (uSeason < 1.5) albedo *= vec3(0.88, 1.02, 0.78);
      else if (uSeason < 2.5) albedo = mix(albedo * vec3(1.2, 1.05, 0.6), vec3(0.2, 0.15, 0.05) * (0.8 + 0.4 * gn), 0.35);
      else albedo = mix(albedo, vec3(0.2, 0.16, 0.09) * (0.75 + 0.5 * gn), 0.65);
      sRough = 0.97;
    } else if (kindF < 12.5) {
      // Earth and gravel: speckled stones on packed ground.
      float stones = step(0.72, h2(floor(p * 14.0))) * fine;
      albedo = vColor.rgb * (0.8 + 0.3 * gn) * (1.0 + 0.35 * stones);
      sRough = 0.95;
    } else {
      // Water (waterGlsl.ts): its own dark colour, rippled by the wind; the sky in the ripples by Fresnel, the
      // sun and moon glittering off them (waterN), and what stands round it reflected by the reflection pass
      // (ssr.ts, which finds water by the alpha written below).
      waterN = waterNormal(waterSlope(vWPos.xz, uTime, uWind, waterFoot(vWPos, cameraPosition)));
      float F = waterFresnel(clamp(-dot(Vw, waterN), 0.0, 1.0));
      albedo = vColor.rgb * 0.45;
      sRough = 0.2;
      sEmit += waterSky(reflect(Vw, waterN), uHorizon, uZenith) * F;
    }
    if (uWet > 0.0 && kindF < 12.5) {
      // Puddles form once the ground is wet through (the same noise as ssr.ts, which reflects in them);
      // lawns soak most of it up.
      float pn = vnoise(p * 0.22) + 0.12 * vnoise(p * 1.9);
      float puddle = smoothstep(0.62, 0.68, pn) * smoothstep(0.35, 0.9, uWet) * (kindF > 10.5 && kindF < 11.5 ? 0.25 : 1.0);
      float wet = uWet * mix(0.6, 1.0, puddle);
      albedo *= mix(1.0, 0.4, wet) * mix(1.0, 0.25, puddle);
      sRough = mix(mix(sRough, 0.14, wet), 0.02, puddle);
      // Reflections: the light pools further along the view direction, stretched toward the viewer
      // (strongest in puddles), plus the sky.
      vec2 away = normalize(p - cameraPosition.xz + vec2(1e-4));
      vec3 acc = vec3(0.0);
      for (int i = 1; i <= 5; i++) acc += lightAt(p + away * float(i) * 2.2) * (1.2 - float(i) * 0.18);
      float F = fresnel(clamp(-Vw.y, 0.0, 1.0));
      sEmit += (acc * 0.09 * mix(0.4, 1.0, puddle) + uHorizon * 0.6) * mix(0.2, 1.0, F) * wet;
    }
  }
  // Street light from the lightmap, sampled in front of the surface and fading with height.
  vec3 Lm = lightAt(vWPos.xz + Nw.xz * 0.6);
  float hf = groundKind ? 1.0 : exp(-max(vWPos.y - 0.2, 0.0) / 4.5) * 0.8;
  // (A car's cabin is in the shade of its roof: a little of the street's light, through the windows.)
  if (indoor) hf *= 0.35;
  sEmit += albedo * Lm * hf;
  // Big screens light what's in front of them in the colour of what they're showing (screenLight.ts).
  if (uScreenCount > 0) sEmit += albedo * screenLight(vWPos + Nw * 0.05, Nw, 1.0) * 0.3183;
  if (uCarCount > 0 && uHeadlights > 0.0 && !indoor) {
    vec3 cl = carLights(vWPos, Nw, groundKind);
    sEmit += albedo * cl;
    // A wet road throws the headlights back at you: a glare stretched toward the viewer.
    if (groundKind && uWet > 0.0) sEmit += cl * 0.05 * fresnel(clamp(-Vw.y, 0.0, 1.0)) * 2.0 * uWet;
  }
  // Your own car's lights (headlamps, the red behind, reversing lamps).
  if (uMyLamps.x + uMyLamps.y + uMyLamps.z + uMyLamps.w > 0.0 && !indoor) {
    vec3 ml = myLights(vWPos, Nw, groundKind);
    sEmit += albedo * ml;
    if (groundKind && uWet > 0.0) sEmit += ml * 0.1 * fresnel(clamp(-Vw.y, 0.0, 1.0)) * uWet;
  }
  // Fallen leaves (autumn) and petals (spring) on whatever lies flat (the ground, paving, the tops of things), not on
  // glass, paint, lights, water or the crowns themselves; piled along the ground slabs' edges.
  if (!indoor && Nw.y > 0.7 && (uSeason < 0.5 || (uSeason > 1.5 && uSeason < 2.5)) && kindF < 12.5 && !(kindF > 2.5 && kindF < 6.5) && !(kindF < 0.5 && vStyle.x > 19.5)) {
    vec4 lit = fallenAt(vWPos, 1.0 - smoothstep(0.03, 0.09, max(fwW.x, fwW.y)), groundKind ? slabEdge(vWPos) : 99.0);
    albedo = mix(albedo, lit.rgb, lit.a);
    sRough = mix(sRough, 0.85, lit.a);
  }
  // Snow on what faces up (roofs, pavements, lawns, the tops of things), patchy as it starts; roads keep less of it.
  if (uSnow > 0.0 && !indoor && !(kindF > 2.5 && kindF < 3.5) && !(kindF > 12.5)) {
    float up = smoothstep(0.55, 0.9, Nw.y);
    float patchy = smoothstep(0.3, 0.7, vnoise(vWPos.xz * 0.45) * 0.55 + uSnow * 0.75);
    float road = kindF > 6.5 && kindF < 7.5 ? 0.8 : 1.0;
    float sn = up * patchy * road * uSnow;
    // Moving cars have their wipers going; tyres press tracks into it (packed snow, a little greyer and smoother).
    if (kindF > 4.5 && kindF < 5.5 && uWiperCount > 0) sn *= 1.0 - wiped(vWPos, Nw).x;
    float trk = groundKind ? trackAt(vWPos) * uSnow : 0.0;
    sn = max(sn, trk * up * 0.85);
    albedo = mix(albedo, vec3(0.62, 0.64, 0.68), sn);
    sRough = mix(sRough, 0.92, sn);
    if (trk > 0.0) {
      // The tread: faint ribs across the track up close.
      float tread = 0.9 + 0.1 * step(0.5, fract(dot(vWPos.xz, vec2(0.7071)) * 9.0)) * (1.0 - smoothstep(0.02, 0.06, max(fwW.x, fwW.y)));
      // Pressed, grey, half-melted snow (between clean snow and the dark slush of a busy road), and the snow
      // pushed up along its edges a shade brighter.
      float ridge = clamp(trk * (1.0 - trk) * 4.0, 0.0, 1.0) * (1.0 - smoothstep(0.7, 1.0, trk));
      albedo = mix(albedo, vec3(0.24, 0.26, 0.3) * tread, smoothstep(0.3, 1.0, trk) * 0.85);
      albedo = mix(albedo, vec3(0.7, 0.72, 0.76), ridge * 0.5 * uSnow);
      sRough = mix(sRough, 0.7, trk);
    }
  }
  diffuseColor.rgb = albedo;
  totalEmissiveRadiance += sEmit;
`;

/**
 * three's lighting loop with the spot lights (the shadow-casting street lamps, weather.ts LampShadows) skipped where
 * they don't reach: out of a lamp's cone or range a pixel neither samples its shadow map nor runs the BRDF (three
 * picks the shadow with a ternary, which the GPU runs both sides of, so every pixel paid for every lamp).
 */
function lightsSkippingSpots(): string {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const a = chunk.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )');
  const b = chunk.indexOf('#if ( NUM_SUN_LIGHTS > 0 )', a);
  if (a < 0 || b < 0) return chunk;
  let spot = chunk.slice(a, b);
  const shadow = /directLight\.color \*= \( directLight\.visible && receiveShadow \) \? (getShadow\([^;]*\)) : 1\.0;/;
  const direct = /(\n\s*)(RE_Direct\( directLight[^;]*;)/;
  if (!shadow.test(spot) || !direct.test(spot)) return chunk;
  spot = spot.replace(shadow, 'if ( directLight.visible && receiveShadow ) directLight.color *= $1;').replace(direct, '$1if ( directLight.visible ) $2');
  return chunk.slice(0, a) + spot + chunk.slice(b);
}
const LIGHTS_BEGIN = lightsSkippingSpots();

/**
 * The city material's shadow caster (a mesh's customDepthMaterial): plain depth, except that leaf cards (tree
 * crowns, models/trees.ts) cast only their leaves, as the city shader cuts them out, and none when their tree is
 * bare in winter. For the sun's and the lamps' shadow maps.
 */
export function cityDepthMaterial(u: CityUniforms): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSeason = u.uSeason;
    shader.uniforms.uTime = u.uTime;
    shader.uniforms.uWind = u.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform vec3 uWind;
        attribute vec4 aFacade;
        attribute vec4 aStyle;
        varying vec4 vFacade;
        flat varying vec4 vStyle;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${swayVertex}
        vFacade = aFacade;
        vStyle = aStyle;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uSeason;
        varying vec4 vFacade;
        flat varying vec4 vStyle;
        float h2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
        }`)
      .replace('void main() {', `void main() {
        if (vStyle.x > 19.5 && vStyle.y > 1.5) {
          float sp = vStyle.x - 20.0;
          bool evergreen = !(sp < 4.5 || (sp > 6.5 && sp < 8.5));
          if (uSeason > 2.5 && !evergreen) discard;
          vec2 q = vFacade.xy;
          float seed = vFacade.z * 37.0;
          float d = length(q - 0.5) * 2.0;
          float keep = (1.0 - d) * 1.4 + (vnoise(q * 4.0 + seed) - 0.5) * 0.9;
          if (keep < 0.35) discard;
          // (Dappled: some of the leaves let the light through.)
          if (h2(floor(q * 11.0 + seed) + 1.3) > 0.72) discard;
        }`);
  };
  return m;
}

export function cityMaterial(u: CityUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', LIGHTS_BEGIN);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform vec3 uWind;
        attribute vec4 aFacade;
        attribute vec4 aStyle;
        attribute float aFlags;
        attribute float aBuilding;
        varying vec4 vFacade;
        flat varying vec4 vStyle;
        flat varying float vFlags;
        flat varying float vBid;
        varying vec3 vWPos;
        varying vec3 vWNor;
        // (The mesh's own frame: rain on a car stays on the car.)
        varying vec3 vLPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${swayVertex}
        vFacade = aFacade;
        vStyle = aStyle;
        vFlags = aFlags;
        vBid = aBuilding;
        vLPos = position;
        // Instanced meshes (traffic wheels) place each copy with instanceMatrix before the model matrix.
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vWNor = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWNor = normalize(mat3(modelMatrix) * objectNormal);
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WIPER_GLSL}\n${common}\n${WATER_GLSL}\n${CAR_RAIN_GLSL}\n${WALL_RAIN_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${surface}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // normalFoliage: a tree crown's leaf clusters catch the light (city surface: leafBump, world space).
        if (leafy > 0.5) normal = normalize(normal + (viewMatrix * vec4(leafBump, 0.0)).xyz);
        if (waterN.y > 0.0) normal = normalize((viewMatrix * vec4(waterN, 0.0)).xyz);`)
      .replace('#include <opaque_fragment>', `
        // Never hand the post chain more than a bright highlight's worth of light (or a NaN).
        outgoingLight = clamp(outgoingLight, 0.0, 48.0);
        #include <opaque_fragment>
        if (waterN.y > 0.0) gl_FragColor.a = ${WATER_ALPHA.toFixed(1)};`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        // Floor for the analytic (sun / moon) lights: a near-mirror GGX lobe on a point light peaks in the
        // tens of thousands, overflows the half-float target and blooms into a huge disc. Mirror-like
        // glass and wet-ground reflections come from sEmit instead, so they stay sharp.
        roughnessFactor = max(sRough, 0.22);
        metalnessFactor = sMetal;`);
  };
  m.customProgramCacheKey = () => 'city-v2';
  return m;
}
