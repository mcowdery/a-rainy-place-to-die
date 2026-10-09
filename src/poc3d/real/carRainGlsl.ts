/**
 * GLSL for rain on a car's paint, glass and chrome (real/city.ts' car surfaces, up close), in the mesh's own
 * frame so the drops ride with a moving car: beads standing on what faces up, no two alike (a jittered cell each,
 * its own size and a slightly oval shape), and on the sides and the glass drops that run down, a bead at the head
 * and a thin wandering trail behind it. Each returns where the pixel is in its drop, in radii from the drop's
 * middle (xy), and how much of the pixel the drop covers (z), for the caller to shade as a little lens
 * (`rainLens`). And rain on buildings, which are seen from much further off than a car: water sheeting down
 * their glass and trickling down their walls, the drops themselves only up close (`WALL_RAIN_GLSL`). Needs the city
 * shader's `h2`.
 */
export const CAR_RAIN_GLSL = /* glsl */ `
  // A layer of beads: q in cells, keep the share of cells with a bead, seed to tell layers apart.
  vec3 rainBeads(vec2 q, float keep, float seed) {
    vec2 id = floor(q);
    if (h2(id + seed) > keep) return vec3(0.0);
    float r = 0.16 + 0.22 * h2(id + seed + 11.3);
    vec2 c = (vec2(h2(id + seed + 3.1), h2(id + seed + 7.7)) - 0.5) * (0.9 - 2.0 * r);
    vec2 d = fract(q) - 0.5 - c;
    d.x *= 0.8 + 0.5 * h2(id + seed + 5.5);
    d /= r;
    return vec3(d, 1.0 - smoothstep(0.8, 1.0, length(d)));
  }
  // Drops running down a steep surface: p in metres (x across it, y up), t seconds. The surface is in columns,
  // half of them with a run: drops a fifth to three fifths of a metre apart going down at their own pace.
  vec3 rainRuns(vec2 p, float t) {
    const float cw = 0.022;
    float col = floor(p.x / cw);
    float h = h2(vec2(col, 3.0));
    if (h > 0.5) return vec3(0.0);
    float x = (fract(p.x / cw) - 0.5) * cw + 0.005 * sin(p.y * 27.0 + h * 40.0);
    float gap = 0.2 + 0.4 * h2(vec2(col, 5.0));
    float ph = fract((p.y + t * (0.02 + 0.07 * h2(vec2(col, 9.0)))) / gap + h * 7.0);
    // Metres above the drop's head: the head a bead taller than it's wide, the trail thinning out above it.
    float above = ph * gap;
    vec2 d = vec2(x, above - 0.005) / vec2(0.0048, 0.0068);
    float head = 1.0 - smoothstep(0.8, 1.0, length(d));
    if (head > 0.0) return vec3(d, head);
    float trail = (1.0 - smoothstep(0.0012, 0.0026, abs(x))) * smoothstep(0.006, 0.016, above) * pow(1.0 - ph, 2.0);
    return vec3(x / 0.0026, 0.0, trail * 0.85);
  }
  // A drop as a little lens (drop as the two above give it): x how much of the pixel its dark rim takes, y how much
  // of the light round it the drop gathers there: pooled at its far side, a hard glint on the near one, and a
  // little all over (base).
  vec2 rainLens(vec3 drop, float base) {
    float dl = min(length(drop.xy), 1.0);
    float pool = smoothstep(-0.2, 0.9, dot(drop.xy, vec2(0.55, -0.83))) * (1.0 - dl * dl);
    float spark = 1.0 - smoothstep(0.0, 0.3, length(drop.xy - vec2(-0.3, 0.42)));
    return vec2(smoothstep(0.55, 1.0, dl), 0.45 * pool + 1.6 * spark + base) * drop.z;
  }
`;

/**
 * Rain on buildings (real/city.ts' walls; after CAR_RAIN_GLSL, and it needs `vnoise` too): p in metres on the face
 * (x along it, y up), foot a pixel's size there, so each thing fades out before it's too small to draw (nothing
 * here may turn into a pattern of dots).
 */
export const WALL_RAIN_GLSL = /* glsl */ `
  // Water sheeting down a pane, from too far off to see a drop: x how much is running here (0 to 1 about a half:
  // broad sheets sliding slowly down), y the threads it gathers into where it runs most (a centimetre or so across,
  // a few to a pane, wavering).
  vec2 paneStreaks(vec2 p, float foot, float t) {
    float broad = vnoise(vec2(p.x * 7.0, p.y * 0.6 + t * 0.03));
    float fine = vnoise(vec2((p.x + 0.012 * sin(p.y * 5.0 + broad * 6.0)) * 52.0, p.y * 2.6 + t * 0.12));
    float threads = smoothstep(0.62, 0.92, fine) * smoothstep(0.3, 0.6, broad) * (1.0 - smoothstep(0.006, 0.02, foot));
    return vec2(mix(0.5, broad, 1.0 - smoothstep(0.035, 0.11, foot)), threads);
  }
  // A pane in the rain (a window, a shopfront). emit is the pane dry (the room through the glass and what the
  // glass reflects), through the room's own light and glint what a drop has to catch (the sky, the street's
  // lamps). The room swims a little in the water running down the glass, and its threads catch the light; up close the
  // drops themselves, as on a car's glass but half as large again: running down with their trails, small ones
  // clinging between them.
  vec3 wetPane(vec3 emit, vec3 through, vec3 glint, vec2 p, float foot, float wet, float t) {
    vec2 run = paneStreaks(p, foot, t);
    emit *= 1.0 + ((run.x - 0.5) * 0.36 - run.y * 0.2) * wet;
    emit += glint * (0.04 * run.x + 0.18 * run.y) * wet;
    float df = foot / 1.5;
    if (df < 0.009) {
      vec2 dp = p / 1.5;
      vec3 drop = rainRuns(dp, t / 1.5) * vec3(1.0, 1.0, (1.0 - smoothstep(0.003, 0.009, df)) * wet);
      // (A pane is big and flat enough to show the beads' cells as a grid: fewer of them than on a car, in
      // clusters where less water is running, on a lattice askew to the pane.)
      if (drop.z <= 0.0) drop = rainBeads(vec2(dp.x + dp.y * 0.37, dp.y - dp.x * 0.23) / vec2(0.012, 0.016) + 5.0, (0.1 + 0.3 * (1.0 - run.x)) * wet, 53.0) * vec3(1.0, 1.0, 1.0 - smoothstep(0.002, 0.006, df));
      if (drop.z > 0.0) {
        vec2 lens = rainLens(drop, 0.1);
        emit = emit * (1.0 - 0.5 * lens.x) + (glint + through * 0.8) * lens.y;
      }
    }
    return emit;
  }
  // Water trickling down a wet wall: threads a centimetre or so across in some of its lanes, wandering as they
  // go, starting and giving out, with slow swells sliding down them. id tells walls apart. How much of the pixel
  // a thread covers, times how full it runs just there.
  float wallRuns(vec2 p, float id, float foot, float t) {
    if (foot > 0.06) return 0.0;
    const float lw = 0.31;
    float lane = floor(p.x / lw);
    float h = h2(vec2(lane, id));
    if (h > 0.32) return 0.0;
    float x = (fract(p.x / lw) - 0.5) * lw - (h2(vec2(lane, id + 3.0)) - 0.5) * 0.12
      - 0.1 * (vnoise(vec2(lane * 3.3 + id, p.y * 0.8)) - 0.5) - 0.005 * sin(p.y * 7.3 + h * 90.0);
    float w = 0.005 + 0.007 * h2(vec2(lane, id + 7.0));
    float line = (1.0 - smoothstep(w, w + max(foot, 0.002), abs(x))) * min(1.0, 2.5 * w / foot);
    float reach = smoothstep(0.42, 0.62, vnoise(vec2(lane * 1.7 + id, p.y * 0.13)));
    float fall = p.y + t * (0.25 + 0.4 * h2(vec2(lane, id + 9.0)));
    float swell = (0.5 + 0.5 * sin(fall * (3.0 + 4.0 * h) + h * 30.0)) * (0.6 + 0.4 * sin(fall * 0.9 + h * 11.0));
    return line * reach * (0.3 + 0.7 * swell * swell) * (1.0 - smoothstep(0.02, 0.06, foot));
  }
`;
