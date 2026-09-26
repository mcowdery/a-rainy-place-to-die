import * as THREE from 'three';
import { screenLightGlsl, screenUniforms, type ScreenUniforms } from './screenLight';

/** Cars whose headlights light the city (the nearest to the camera). */
export const CAR_LIGHTS = 16;

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
  /** 0-1: street light pools under its sources and falls off to black between them. */
  uDark: { value: number };
  /** Moving cars' headlights near the camera: (x, z, dx, dz) per car, and how many; uHeadlights 0-1 switches them. */
  uCars: { value: THREE.Vector4[] };
  uCarCount: { value: number };
  uHeadlights: { value: number };
  uZenith: { value: THREE.Color };
  uHorizon: { value: THREE.Color };
  /** Daylight reaching room interiors (unlit rooms read as dim by day, black by night). */
  uRoomAmbient: { value: THREE.Color };
  tLight: { value: THREE.Texture | null };
  /** Lightmap placement: (x0, z0, 1 / width, 1 / depth) in metres. */
  uLightRect: { value: THREE.Vector4 };
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
    uDark: { value: 0 },
    uCars: { value: Array.from({ length: CAR_LIGHTS }, () => new THREE.Vector4()) },
    uCarCount: { value: 0 },
    uHeadlights: { value: 0 },
    uZenith: { value: new THREE.Color(0x0a0e18) },
    uHorizon: { value: new THREE.Color(0x2a2230) },
    uRoomAmbient: { value: new THREE.Color(0x000000) },
    tLight: { value: null },
    uLightRect: { value: new THREE.Vector4(0, 0, 1, 1) },
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
  uniform float uDark;
  uniform vec4 uCars[${CAR_LIGHTS}];
  uniform int uCarCount;
  uniform float uHeadlights;
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
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  vec3 lightAt(vec2 p) {
    vec3 L = texture2D(tLight, (p - uLightRect.xy) * uLightRect.zw).rgb * uLightGain;
    // Darkness: square the falloff, so light pools under its source and the gaps between go black.
    return mix(L, L * L * 1.5, uDark);
  }
  vec3 skyRefl(vec3 r) {
    return r.y > 0.0 ? mix(uHorizon, uZenith, sqrt(r.y)) : uHorizon * 0.3;
  }
  float fresnel(float cosT) { return 0.04 + 0.96 * pow(1.0 - cosT, 5.0); }

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
  float kindF = mod(floor(vFacade.w + 0.5), 16.0);
  bool isFront = vFacade.w > 15.5;
  vec3 albedo = vColor.rgb;
  float sRough = 0.85;
  float sMetal = 0.0;
  vec3 sEmit = vec3(0.0);
  vec3 Vw = normalize(vWPos - cameraPosition);
  vec3 Nw = normalize(vWNor);
  bool groundKind = kindF > 6.5;
  float cosV = clamp(-dot(Vw, Nw), 0.0, 1.0);

  if (kindF < 0.5) {
    albedo *= 0.88 + 0.24 * vnoise(vWPos.xz * 1.3 + vWPos.y * 0.7);
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
    const float GF = 4.2;
    const float FH = 3.0;

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

    if (isFront && v < GF) {
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
    } else {
      albedo = vColor.rgb * (0.78 + 0.4 * gn);
      sRough = 0.9;
    }
    if (uWet > 0.0) {
      // Puddles form once the ground is wet through (the same noise as ssr.ts, which reflects in them).
      float pn = vnoise(p * 0.22) + 0.12 * vnoise(p * 1.9);
      float puddle = smoothstep(0.62, 0.68, pn) * smoothstep(0.35, 0.9, uWet);
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
  diffuseColor.rgb = albedo;
  totalEmissiveRadiance += sEmit;
`;

export function cityMaterial(u: CityUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
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
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNor = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${common}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${surface}`)
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
