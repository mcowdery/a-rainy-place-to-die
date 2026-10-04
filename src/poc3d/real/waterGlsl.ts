/**
 * GLSL shared by the water's shaders (the ponds in real/city.ts, the river and the bay in real/sea.ts) and the
 * reflections in it (real/ssr.ts), so the ripples, the sky in them and their Fresnel are the same in all three:
 * the reflection pass replaces the sky a ripple shows with what's really there (a bank, a bridge, a sign), and
 * that only works if both worked out the same ripple.
 *
 * Water marks its pixels for the reflection pass by writing `WATER_ALPHA` into the scene's alpha (everything
 * else opaque writes 1; nothing after the reflections reads it).
 */
export const WATER_ALPHA = 0;

export const WATER_GLSL = /* glsl */ `
  float wtrHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float wtrNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(wtrHash(i), wtrHash(i + vec2(1.0, 0.0)), f.x), mix(wtrHash(i + vec2(0.0, 1.0)), wtrHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // A pixel's size on the water (m) at wp seen from cam: what a ripple must be bigger than to show.
  float waterFoot(vec3 wp, vec3 cam) {
    vec3 v = wp - cam;
    float dist = length(v);
    return dist * 0.0015 / max(abs(v.y) / max(dist, 1e-3), 0.06);
  }
  // The surface's slope (dh/dx, dh/dz) at p (m): five trains of wind ripples from 5 m down to 25 cm, fanned
  // about the wind's direction and drifting with it, their paths bent by slow noise so no pattern repeats;
  // patches of calmer and rougher water (cat's paws) drift across. wind: the direction (xy, unit) and strength
  // (z: 0 still air to ~1.4 a gale). Ripples smaller than a pixel (foot, m) fade out, so far water doesn't
  // shimmer.
  vec2 waterSlope(vec2 p, float t, vec3 wind, float foot) {
    vec2 d0 = wind.xy;
    float amp = 0.28 + 1.0 * min(wind.z, 1.4);
    vec2 q = p + vec2(wtrNoise(p * 0.11 + t * 0.03), wtrNoise(p * 0.11 + 7.3 - t * 0.02)) * 2.6;
    amp *= 0.55 + 0.9 * wtrNoise(p * 0.035 - d0 * t * 0.25);
    vec2 s = vec2(0.0);
    float lam = 5.2;
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float ang = (fi - 2.0) * 0.62 + sin(fi * 2.4) * 0.4;
      vec2 d = vec2(d0.x * cos(ang) - d0.y * sin(ang), d0.x * sin(ang) + d0.y * cos(ang));
      float k = 6.2832 / lam;
      float keep = 1.0 - smoothstep(0.2 * lam, 0.55 * lam, foot);
      s += d * ((0.03 + 0.011 * fi) * amp * keep * cos(dot(q, d) * k - sqrt(9.81 * k) * 0.6 * t + fi * 1.7));
      lam *= 0.47;
    }
    return s;
  }
  vec3 waterNormal(vec2 slope) { return normalize(vec3(-slope.x, 1.0, -slope.y)); }
  // How much water reflects, by the angle you look across it (a little more than glass does: it reads better).
  float waterFresnel(float cosT) { return 0.03 + 0.97 * pow(1.0 - cosT, 4.5); }
  // The sky in the water along a reflected ray (as city.ts' skyRefl; a ray a steep ripple throws down is the
  // ray it would throw up).
  vec3 waterSky(vec3 r, vec3 horizon, vec3 zenith) { return mix(horizon, zenith, sqrt(abs(r.y))); }
`;
