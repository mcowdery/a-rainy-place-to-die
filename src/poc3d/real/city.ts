import * as THREE from 'three';
import { screenLightGlsl, screenUniforms, type ScreenUniforms } from './screenLight';

/** Cars whose headlights light the city (the nearest to the camera). */
export const CAR_LIGHTS = 16;
/** Moving cars near the camera whose wipers clear their windscreens of snow. */
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
  /** Moving cars whose wipers are going: (x, z, heading, ground y), and how many (snow off their windscreens). */
  uWipers: { value: THREE.Vector4[] };
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
  tLight: { value: THREE.Texture | null };
  /** Lightmap placement: (x0, z0, 1 / width, 1 / depth) in metres. */
  uLightRect: { value: THREE.Vector4 };
  /** Fades the lightmap out between these max-norm distances from the camera (m); (0, 0) for none (lightmap.ts). */
  uLightFade: { value: THREE.Vector2 };
  uLightGain: { value: number };
}

export function cityUniforms(): CityUniforms {
  return {
    uTime: { value: 0 },
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
    uWipers: { value: Array.from({ length: WIPERS }, () => new THREE.Vector4()) },
    uWiperCount: { value: 0 },
    tTracks: { value: null },
    uTrackRect: { value: new THREE.Vector4(0, 0, 1, 0) },
    uLitter: { value: Array.from({ length: LITTER }, () => new THREE.Vector4()) },
    uLitterCount: { value: 0 },
    uLitterReach: { value: 60 },
    uZenith: { value: new THREE.Color(0x0a0e18) },
    uHorizon: { value: new THREE.Color(0x2a2230) },
    uRoomAmbient: { value: new THREE.Color(0x000000) },
    tLight: { value: null },
    uLightRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uLightFade: { value: new THREE.Vector2(0, 0) },
    uLightGain: { value: 1 },
    ...screenUniforms(),
  };
}

const common = /* glsl */ `
  uniform float uTime;
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
  uniform vec4 uWipers[${WIPERS}];
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
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uRoomAmbient;
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
  // How much of a windscreen the wipers have cleared: glass facing forward on a moving car near the camera, two
  // fans pivoting at the foot of the screen (the corners and the wedge between them keep their snow).
  float wiped(vec3 wp, vec3 n) {
    float w = 0.0;
    for (int i = 0; i < ${WIPERS}; i++) {
      if (i >= uWiperCount) break;
      vec4 c = uWipers[i];
      vec2 rel = wp.xz - c.xy;
      if (dot(rel, rel) > 9.0) continue;
      vec2 d = vec2(sin(c.z), cos(c.z));
      if (dot(n.xz, d) < 0.12 || dot(rel, d) < 0.0) continue;
      float lat = dot(rel, vec2(-d.y, d.x));
      float h = wp.y - c.w;
      float edge = 0.04 * vnoise(wp.xz * 23.0 + wp.y * 17.0);
      for (int k = -1; k <= 1; k += 2) {
        vec2 q = vec2(lat - float(k) * 0.33, (h - 0.9) * 1.7);
        w = max(w, step(-0.03, q.y) * smoothstep(0.64 + edge, 0.58 + edge, length(q)));
      }
    }
    return w;
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
    return h < 0.55 ? vec3(1.0, 0.62, 0.3) : h < 0.85 ? vec3(1.0, 0.86, 0.66) : h < 0.96 ? vec3(0.8, 0.9, 1.0) : vec3(0.45, 0.55, 1.0);
  }
  float flick(float id) {
    return uFlicker > 0.5 && h2(vec2(id, floor(uTime * 12.0))) > 0.99 ? 0.1 : 1.0;
  }
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
  float sRough = 0.85;
  float sMetal = 0.0;
  vec3 sEmit = vec3(0.0);
  vec3 Vw = normalize(vWPos - cameraPosition);
  vec3 Nw = normalize(vWNor);
  bool groundKind = kindF > 6.5;
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
      float n1 = vnoise3(lp * 2.3);
      float n2 = vnoise3(lp * 6.1 + 17.0);
      float n3 = vnoise3(lp * 0.55 + 5.0);
      // The leaves themselves (or florets), a few centimetres across, only where they're bigger than a pixel.
      float n4 = vnoise3(lp * 17.0 + 3.0);
      float closeL = 1.0 - smoothstep(0.02, 0.07, max(fwW.x, fwW.y));
      float closeF = 1.0 - smoothstep(0.006, 0.025, max(fwW.x, fwW.y));
      float clump = mix(0.55, smoothstep(0.25, 0.8, n1 * 0.6 + n2 * 0.4), 0.25 + 0.75 * closeL);
      float blossom = uSeason < 0.5 && (grp > 1.5 && grp < 2.5 || grp > 3.5) ? 1.0 : 0.0;
      // Petals let the light through: a blossoming crown is lighter underneath and between its clusters.
      float ao = mix(mix(0.42, 0.7, blossom), 1.0, smoothstep(-0.75, 0.55, Nw.y));
      float lightK = mix(mix(0.62, 0.82, blossom), mix(1.18, 1.08, blossom), clump) * ao * mix(1.0, mix(0.78, 1.14, smoothstep(0.3, 0.75, n4)), closeF);
      bool bare = uSeason > 2.5 && !(grp > 2.5 && grp < 3.5);
      float rim = 1.0 - abs(dot(Nw, Vw));
      // The part (models/trees.ts): 0 foliage, 1 a card crown's dark core, 2 a leaf card, whose leaves are cut out
      // of it here: a ragged cluster of leaves, thinning toward its edges, each leaf a shade of its own.
      float part = vStyle.y;
      float leafShade = 1.0;
      float bumpK = 1.2;
      vec3 tint = vec3(1.0);
      if (part > 1.5) {
        vec2 q = vFacade.xy;
        float seed = vFacade.z * 37.0;
        float d = length(q - 0.5) * 2.0;
        vec2 lq = q * 11.0 + seed;
        vec2 cell = floor(lq);
        // A leaf per cell: a pointed ellipse, turned at random, in the cell's middle.
        vec2 f = fract(lq) - 0.5 - (vec2(h2(cell), h2(cell + 3.7)) - 0.5) * 0.35;
        float ang = h2(cell + 9.1) * 6.2832;
        vec2 rq = vec2(cos(ang) * f.x + sin(ang) * f.y, -sin(ang) * f.x + cos(ang) * f.y);
        float leaf = 1.0 - smoothstep(0.85, 1.0, length(rq / vec2(0.46, 0.24)));
        float edgeOn = abs(dot(geoN, Vw));
        float keep = (1.0 - d) * 1.4 + (vnoise(q * 4.0 + seed) - 0.5) * 0.9 - (1.0 - smoothstep(0.12, 0.45, edgeOn)) * 0.9;
        if (bare || keep < 0.25 || (closeL > 0.2 && leaf < 0.5 && h2(cell + 1.3) > 0.25)) discard;
        leafShade = mix(0.72, 1.18, h2(cell + 5.3)) * mix(0.8, 1.0, 1.0 - d * 0.5);
        bumpK = 0.6;
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
    // Wet walls go darker, the splash zone at the foot most.
    float wW = uWet * (0.55 + 0.45 * smoothstep(0.7, 0.0, v));
    wallCol *= 1.0 - 0.32 * wW;
    albedo = wallCol;

    vec3 T = vec3(Nw.z, 0.0, -Nw.x);
    vec3 rd = vec3(dot(Vw, T), Vw.y, dot(Vw, Nw));
    vec3 refl = skyRefl(reflect(Vw, Nw));

    if (isFront && v < GF && home) {
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
      // Storefront: pillars, fascia, then glass (open) or a shutter (closed).
      float pil = 0.35;
      float sw = faceW - 2.0 * pil;
      float sx = u - pil;
      if (sx < 0.0 || sx > sw) {
        albedo = wallCol * 0.9;
      } else if (v > 3.05) {
        albedo = mix(vec3(0.02), wallCol * 0.45, h1(vBid + 3.0));
        sRough = 0.45;
      } else if (shopOpen) {
        float nm = max(1.0, floor(sw / 1.6));
        float mw = sw / nm;
        float mx = sx - floor(sx / mw) * mw;
        if (mx < 0.05 || mx > mw - 0.05 || v < 0.28 || v > 2.95) {
          albedo = vec3(0.05);
          sMetal = 0.7;
          sRough = 0.35;
        } else {
          float face;
          vec3 hp = roomHit(vec3(sx, v, 0.0), rd, sw, 3.0, 6.0, face);
          float hs = h1(vBid + 21.0);
          vec3 L = shopPal < 0.5 ? vec3(1.0, 0.78, 0.5) : shopPal < 1.5 ? vec3(0.92, 0.97, 1.0)
            : shopPal < 2.5 ? (hs < 0.5 ? vec3(1.0, 0.45, 0.8) : vec3(0.4, 0.85, 1.0)) : vec3(1.0, 0.5, 0.22) * 0.7;
          vec3 c;
          bool bar = shopPal > 2.5;
          if (bar) {
            // Bar: a wooden counter across the back, backlit shelves of bottles above it, wood panelling,
            // dark floor and a few warm pendant lights.
            vec3 wood = vec3(0.16, 0.08, 0.035);
            if (face < 0.5) {
              if (hp.y < 1.0) c = wood * (0.8 + 0.4 * step(0.5, fract(hp.x / 0.9)));
              else if (hp.y < 1.08) c = vec3(0.9, 0.6, 0.25);
              else if (hp.y > 1.3 && hp.y < 2.3) {
                float row = floor((hp.y - 1.3) / 0.5);
                float ly = hp.y - 1.3 - row * 0.5;
                float slot = floor(hp.x / 0.11);
                float hb = h3(vec3(vBid, slot, row));
                bool bottle = fract(hp.x / 0.11) < 0.6 && ly > 0.04 && ly < 0.2 + 0.2 * hb;
                vec3 glass = hb < 0.4 ? vec3(1.0, 0.55, 0.15) : hb < 0.7 ? vec3(0.3, 0.8, 0.35) : vec3(0.9, 0.9, 0.8);
                c = ly < 0.04 ? vec3(0.9, 0.7, 0.4) : bottle ? glass * 2.2 : vec3(0.7, 0.4, 0.18) * (0.6 + 0.8 * ly);
              } else c = wood * 0.6;
            } else if (face < 1.5) {
              c = wood * (0.9 + 0.3 * step(0.5, fract(hp.z / 0.8)));
            } else if (face < 2.5) {
              vec2 cp = vec2(fract(hp.x / 1.6) - 0.5, fract(-hp.z / 2.0) - 0.5);
              c = length(cp) < 0.08 ? vec3(4.0) : vec3(0.08);
            } else {
              c = wood * 0.7;
            }
          } else if (face < 0.5) {
            // Back wall: shelves of goods.
            float shelf = floor(hp.y / 0.42);
            vec3 goods = vec3(h3(vec3(vBid, floor(hp.x / 0.3), shelf)), h3(vec3(shelf, vBid, floor(hp.x / 0.3) + 5.0)), h3(vec3(floor(hp.x / 0.3), shelf, vBid + 9.0)));
            c = fract(hp.y / 0.42) < 0.15 || hp.y > 2.2 ? vec3(0.8) : mix(vec3(0.5), goods, 0.8);
          } else if (face < 1.5) {
            c = vec3(0.7, 0.7, 0.68);
          } else if (face < 2.5) {
            // Ceiling: rows of fluorescent tubes.
            bool tube = fract(hp.x / 1.2) < 0.1 && fract(-hp.z / 1.5) < 0.5;
            c = tube ? vec3(3.0) : vec3(0.8);
          } else {
            c = vec3(0.55, 0.55, 0.52) * (0.8 + 0.2 * step(0.5, fract(hp.x / 0.6 + floor(-hp.z / 0.6) * 0.5)));
          }
          float depthT = -hp.z / 6.0;
          vec3 interior = c * L * mix(0.9, 0.5, depthT) * max(uLamps, 0.55);
          float F = fresnel(cosV);
          albedo = vec3(0.02);
          sRough = 0.06;
          sEmit = interior * (1.0 - F) + refl * F;
        }
      } else {
        // Roll-down shutter.
        float rib = fract(v / 0.09);
        float ribFade = 1.0 - smoothstep(0.008, 0.025, fwUV.y);
        albedo = vec3(0.4, 0.41, 0.43) * (1.0 - 0.3 * ribFade * smoothstep(0.3, 0.5, abs(rib - 0.5))) * (0.8 + 0.4 * n1);
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
      bool office = type > 0.5 && type < 2.5;
      if (type < 0.5) { float ww = b * ratio; x0 = (b - ww) * 0.5; x1 = x0 + ww; y1 = min(y1, FH - 0.35); }
      else if (type < 1.5) { y0 = 0.95; y1 = min(0.95 + winH, FH - 0.3); }
      else if (type < 2.5) { y0 = 0.0; y1 = FH; }
      else if (type < 3.5) { float ww = b * 0.86; x0 = (b - ww) * 0.5; x1 = x0 + ww; y0 = 0.05; y1 = 2.25; }
      else { x0 = b * 0.5 - 0.32; x1 = b * 0.5 + 0.32; y0 = 1.45; y1 = 2.05; inGrid = inGrid && h3(vec3(vBid, col, fl)) > 0.45; }

      bool inWin = inGrid && xb > x0 && xb < x1 && yf > y0 && yf < y1;
      // Rooms span 2 bays on ribbon / curtain-wall floors (open-plan offices).
      float pair = office ? 2.0 : 1.0;
      float roomCol = floor(col / pair);
      float rw = b * pair;
      float rx = xb + (col - roomCol * pair) * b;
      float hr = h3(vec3(vBid, roomCol, fl));
      float litFrac = clamp(uWindowLit * (0.35 + 1.3 * litBias), 0.0, 1.0);
      bool lit = hr < litFrac;

      vec3 detailAlbedo = albedo;
      vec3 detailEmit = vec3(0.0);
      float detailRough = sRough;
      float detailMetal = 0.0;
      if (inWin) {
        float fx = min(xb - x0, x1 - xb);
        float fy = min(yf - y0, y1 - yf);
        float fr = type > 1.5 && type < 2.5 ? 0.05 : 0.07;
        bool spandrel = type > 1.5 && type < 2.5 && yf < 0.5;
        bool sash = type < 0.5 && (x1 - x0) > 1.3 && abs(xb - (x0 + x1) * 0.5) < 0.03;
        bool mullion = office && (xb < 0.04 || xb > b - 0.04);
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
          vec3 L = lit ? roomLightColor(h1(hr * 37.0), office) : vec3(0.0);
          vec3 wallA = mix(vec3(0.78, 0.74, 0.68), vec3(0.62, 0.66, 0.7), h1(hr * 13.0));
          vec3 c;
          float depthT = -hp.z / depth;
          if (face < 0.5) {
            c = wallA * 0.85;
            // A dark furniture silhouette against the back wall.
            float fxp = rw * (0.25 + 0.5 * h1(hr * 53.0));
            if (hp.y < 0.55 + 1.4 * h1(hr * 71.0) && abs(hp.x - fxp) < 0.4 + 0.5 * h1(hr * 29.0)) c = vec3(0.09, 0.07, 0.06);
          } else if (face < 1.5) {
            c = wallA * 0.75;
          } else if (face < 2.5) {
            c = vec3(0.9) * (1.0 + 0.9 * exp(-depthT * 4.0) * (office ? 1.2 : 0.6));
          } else {
            c = office ? vec3(0.4, 0.42, 0.45) : mix(vec3(0.36, 0.24, 0.15), vec3(0.5, 0.45, 0.38), h1(hr * 17.0));
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
          vec3 tint = office ? vec3(0.62, 0.78, 0.82) : vec3(1.0);
          if (type > 1.5 && type < 2.5) F = mix(F, 1.0, 0.3);
          detailAlbedo = vec3(0.015);
          detailRough = 0.05;
          detailEmit = (interior * (1.0 - F) + refl * F) * tint;
          // Drops on wet glass, up close: beads catching the sky and the room, a few sliding down.
          if (uWet > 0.0) {
            vec2 dq = vec2(xb, yf) * 8.0;
            vec2 dc = floor(dq);
            float dr = h2(dc + vBid);
            float slide = step(0.85, dr) * fract(uTime * 0.05 + dr * 9.0);
            vec2 dp = fract(dq) - vec2(0.25 + 0.5 * h2(dc * 1.7), 0.75 - 0.5 * h2(dc * 2.3) - slide * 0.6);
            float drop = smoothstep(0.12, 0.05, length(dp * vec2(1.0, 0.8))) * step(0.4, dr);
            float closeG = 1.0 - smoothstep(0.004, 0.02, max(fwUV.x, fwUV.y));
            detailEmit += (refl * 0.7 + interior * 0.9 + vec3(0.02)) * drop * uWet * closeG;
          }
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
      vec3 roomAvg = office ? vec3(0.53, 0.74, 0.82) : vec3(1.0, 0.72, 0.45);
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
      // A wet sheen (sky at grazing angles) and rivulets running down some lanes of the facade, catching
      // the street light and the sky.
      sEmit += refl * fresnel(cosV) * 0.3 * wW;
      float lane = floor(u * 4.0);
      float closeW = 1.0 - smoothstep(0.03, 0.12, max(fwUV.x, fwUV.y));
      float line = step(0.7, h1(lane * 3.7 + vBid)) * smoothstep(0.06, 0.0, abs(fract(u * 4.0) - 0.5 - 0.3 * (h1(lane + vBid) - 0.5)));
      float flow = smoothstep(0.55, 1.0, fract(v * 0.4 + uTime * (0.5 + h1(lane * 1.3)) + h1(lane)));
      sEmit += (refl * 0.6 + lightAt(vWPos.xz + Nw.xz * 0.6) * 0.25) * line * (0.35 + 0.65 * flow) * uWet * closeW * 0.5;
      sRough = mix(sRough, sRough * 0.45, uWet);
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
    // Beads of rain on paint and glass, up close.
    if (uWet > 0.0) {
      vec2 bq = vWPos.xz * 16.0 + vWPos.y * 9.0;
      float bead = step(0.82, h2(floor(bq))) * smoothstep(0.32, 0.1, length(fract(bq) - 0.5));
      float closeC = 1.0 - smoothstep(0.02, 0.06, max(fwW.x, fwW.y));
      sEmit += (refl * 1.4 + 0.02) * bead * uWet * closeC;
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
      // Water: near black, reflecting the sky by Fresnel.
      float F = fresnel(clamp(-Vw.y, 0.0, 1.0));
      albedo = vColor.rgb * 0.3;
      sRough = 0.06;
      sEmit += skyRefl(reflect(Vw, vec3(0.0, 1.0, 0.0))) * mix(0.04, 0.9, F);
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
  sEmit += albedo * Lm * hf;
  // Big screens light what's in front of them in the colour of what they're showing (screenLight.ts).
  if (uScreenCount > 0) sEmit += albedo * screenLight(vWPos + Nw * 0.05, Nw, 1.0) * 0.3183;
  if (uCarCount > 0 && uHeadlights > 0.0) {
    vec3 cl = carLights(vWPos, Nw, groundKind);
    sEmit += albedo * cl;
    // A wet road throws the headlights back at you: a glare stretched toward the viewer.
    if (groundKind && uWet > 0.0) sEmit += cl * 0.05 * fresnel(clamp(-Vw.y, 0.0, 1.0)) * 2.0 * uWet;
  }
  // Fallen leaves (autumn) and petals (spring) on whatever lies flat (the ground, paving, the tops of things), not on
  // glass, paint, lights, water or the crowns themselves; piled along the ground slabs' edges.
  if (Nw.y > 0.7 && (uSeason < 0.5 || (uSeason > 1.5 && uSeason < 2.5)) && kindF < 12.5 && !(kindF > 2.5 && kindF < 6.5) && !(kindF < 0.5 && vStyle.x > 19.5)) {
    vec4 lit = fallenAt(vWPos, 1.0 - smoothstep(0.03, 0.09, max(fwW.x, fwW.y)), groundKind ? slabEdge(vWPos) : 99.0);
    albedo = mix(albedo, lit.rgb, lit.a);
    sRough = mix(sRough, 0.85, lit.a);
  }
  // Snow on what faces up (roofs, pavements, lawns, the tops of things), patchy as it starts; roads keep less of it.
  if (uSnow > 0.0 && !(kindF > 2.5 && kindF < 3.5) && !(kindF > 12.5)) {
    float up = smoothstep(0.55, 0.9, Nw.y);
    float patchy = smoothstep(0.3, 0.7, vnoise(vWPos.xz * 0.45) * 0.55 + uSnow * 0.75);
    float road = kindF > 6.5 && kindF < 7.5 ? 0.8 : 1.0;
    float sn = up * patchy * road * uSnow;
    // Moving cars have their wipers going; tyres press tracks into it (packed snow, a little greyer and smoother).
    if (kindF > 4.5 && kindF < 5.5 && uWiperCount > 0) sn *= 1.0 - wiped(vWPos, Nw);
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

export function cityMaterial(u: CityUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', LIGHTS_BEGIN);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aFacade;
        attribute vec4 aStyle;
        attribute float aFlags;
        attribute float aBuilding;
        varying vec4 vFacade;
        flat varying vec4 vStyle;
        flat varying float vFlags;
        flat varying float vBid;
        varying vec3 vWPos;
        varying vec3 vWNor;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFacade = aFacade;
        vStyle = aStyle;
        vFlags = aFlags;
        vBid = aBuilding;
        // Instanced meshes (traffic wheels) place each copy with instanceMatrix before the model matrix.
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vWNor = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWNor = normalize(mat3(modelMatrix) * objectNormal);
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${common}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${surface}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // normalFoliage: a tree crown's leaf clusters catch the light (city surface: leafBump, world space).
        if (leafy > 0.5) normal = normalize(normal + (viewMatrix * vec4(leafBump, 0.0)).xyz);`)
      .replace('#include <opaque_fragment>', `
        // Never hand the post chain more than a bright highlight's worth of light (or a NaN).
        outgoingLight = clamp(outgoingLight, 0.0, 48.0);
        #include <opaque_fragment>`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        // Floor for the analytic (sun / moon) lights: a near-mirror GGX lobe on a point light peaks in the
        // tens of thousands, overflows the half-float target and blooms into a huge disc. Mirror-like
        // glass and wet-ground reflections come from sEmit instead, so they stay sharp.
        roughnessFactor = max(sRough, 0.22);
        metalnessFactor = sMetal;`);
  };
  m.customProgramCacheKey = () => 'city-v1';
  return m;
}
