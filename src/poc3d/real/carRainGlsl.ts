/**
 * GLSL for rain on a car's paint, glass and chrome (real/city.ts' car surfaces, up close), in the mesh's own
 * frame so the drops ride with a moving car: beads standing on what faces up, no two alike (a jittered cell each,
 * its own size and a slightly oval shape), and on the sides and the glass drops that run down, a bead at the head
 * and a thin wandering trail behind it. Each returns where the pixel is in its drop, in radii from the drop's
 * middle (xy), and how much of the pixel the drop covers (z), for the caller to shade as a little lens. Needs the
 * city shader's `h2`.
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
`;
