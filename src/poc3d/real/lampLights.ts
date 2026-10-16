export const CAR_LIGHTS = 16;

/**
 * The city shader's moving lights as GLSL, shared with models that take them (`streetLit.ts`): traffic headlights
 * (`carLights`), your own car's (`myLights`), the police beacon (`beaconLight`) and Mack's flashlight (`torchLight`), with
 * the uniforms they read. A new light of this kind goes here, so every material that takes the city's light gets it.
 */
export const LAMP_LIGHTS_GLSL = `
  uniform vec4 uCars[${CAR_LIGHTS}];
  uniform int uCarCount;
  uniform float uHeadlights;
  uniform vec4 uMyCar;
  uniform vec4 uMyDir;
  uniform vec4 uMyLamps;
  uniform int uCarSkip;
  uniform vec4 uBeacon;
  uniform vec4 uTorch;
  uniform vec3 uTorchDir;

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
  // The police beacon on the roof: a red wash on what's within ~26 m of it, brighter the nearer, on the ground and on
  // the faces that look toward it (the lit half flashes; uBeacon.w is how bright now).
  vec3 beaconLight(vec3 wp, vec3 n, bool ground) {
    vec3 rel = wp - uBeacon.xyz;
    float d2 = dot(rel, rel);
    if (d2 > 700.0) return vec3(0.0);
    float face = ground ? 1.0 : clamp(dot(n, -normalize(rel)), 0.0, 1.0);
    return vec3(1.0, 0.04, 0.03) * uBeacon.w * face * 5.0 / (3.0 + d2 * 0.12) * smoothstep(700.0, 250.0, d2);
  }
  // Mack's flashlight: a warm cone (a bright core, a soft edge) out to ~28 m, on the ground and on the faces turned
  // toward it; no light volume, as the headlights have none.
  vec3 torchLight(vec3 wp, vec3 n) {
    vec3 rel = wp - uTorch.xyz;
    float d = length(rel);
    if (d > 28.0 || d < 0.05) return vec3(0.0);
    vec3 dir = rel / d;
    float cone = smoothstep(0.90, 0.985, dot(dir, uTorchDir));
    float face = clamp(dot(n, -dir) * 0.8 + 0.2, 0.0, 1.0);
    float fall = smoothstep(28.0, 8.0, d) / (1.0 + d * d * 0.04);
    return vec3(1.0, 0.93, 0.78) * uTorch.w * cone * face * fall * 6.0;
  }
`;
