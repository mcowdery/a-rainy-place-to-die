import { ATLAS_H, ATLAS_W, BLOCK, BLOCK_COLS, PPM, REGIONS, roomTables } from './shopAtlas';
import { HUES, TRADES } from './shops';

/**
 * The city shader's storefront interiors (city.ts calls shopInterior for the glass of an open shop). Each trade's
 * room is painted in the shop atlas (shopAtlas.ts); here the view ray is traced into a box room (roomHit) of the
 * trade's depth and ceiling, and the face it meets is looked up in the atlas, then the trade's layers standing in
 * the room (counters, people, shelving, lamps) are tried nearest first and the first solid one is what's seen.
 * The mask gives the shop's own colour, what glows and what animates. Small on purpose: per-trade code in the
 * shader made the D3D compiler take minutes.
 *
 * Room coordinates: x along the shop (0..w), y up from the floor, z into the shop (0 at the glass, negative inward).
 */

const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const r3 = (x: number): string => f(Math.round(x * 1000) / 1000);
const v3 = (c: readonly number[]): string => `vec3(${c.map(r3).join(', ')})`;
const reg = (k: keyof typeof REGIONS): string => `vec4(${REGIONS[k].slice(0, 4).map(f).join(', ')})`;

const tables = (): string => {
  const { rooms, layers } = roomTables();
  return /* glsl */ `
  const vec3 SHOP_HUES[${HUES.length}] = vec3[${HUES.length}](${HUES.map(v3).join(', ')});
  // Light colour (w: lit in the shop's own colour too) and glazing (panel width, frame, solid panel height,
  // frosted) per trade (shops.ts); the room (depth, ceiling) and its layers nearest first (depth, region, centred).
  const vec4 SHOP_LIGHTS[${TRADES.length}] = vec4[${TRADES.length}](${TRADES.map((d) => `vec4(${d.light.map(r3).join(', ')}, ${d.hued ? '1.0' : '0.0'})`).join(', ')});
  const vec4 SHOP_GLASS[${TRADES.length}] = vec4[${TRADES.length}](${TRADES.map((d) => `vec4(${d.glass.map(f).join(', ')})`).join(', ')});
  const vec2 SHOP_ROOM[${rooms.length}] = vec2[${rooms.length}](${rooms.map((r) => `vec2(${r.map(f).join(', ')})`).join(', ')});
  const vec3 SHOP_LAYER[${layers.length}] = vec3[${layers.length}](${layers.map((l) => `vec3(${l.map(f).join(', ')})`).join(', ')});
`;
};

export const shopGlsl = (): string => /* glsl */ `
  // ---- storefront interiors (shopShader.ts, shopAtlas.ts) ----
  uniform sampler2D tShopCol;
  uniform sampler2D tShopMask;
  ${tables()}
  vec3 shopRainbow(float h) { return 0.5 + 0.5 * cos(6.2832 * (h + vec3(0.0, 0.33, 0.67))); }
  // A shop's light: its trade's, tinted by its own colour where the trade is lit that way (shops.ts shopLight);
  // trade 0 keeps the old palettes for set pieces that only give one.
  vec3 shopLightOf(int tr, vec3 hue, float pal, float hs) {
    if (tr == 0) return pal < 0.5 ? vec3(1.0, 0.78, 0.5) : pal < 1.5 ? vec3(0.92, 0.97, 1.0) : pal < 2.5 ? (hs < 0.5 ? vec3(1.0, 0.45, 0.8) : vec3(0.4, 0.85, 1.0)) : vec3(0.7, 0.35, 0.15);
    vec4 sl = SHOP_LIGHTS[tr];
    return sl.w > 0.5 ? sl.rgb * 0.6 + hue / max(max(hue.r, hue.g), max(hue.b, 1e-3)) * 0.4 : sl.rgb;
  }
  // The atlas at a region of a trade's block, t in [0, 1] (y up), at a mip level from how big a texel looks.
  vec4 shopTex(int tr, vec4 rg, vec2 t, float lod, out vec3 mask) {
    vec2 px = vec2(float(tr % ${BLOCK_COLS}), float(tr / ${BLOCK_COLS})) * ${f(BLOCK)} + rg.xy + vec2(t.x, 1.0 - t.y) * rg.zw;
    vec2 uv = px / vec2(${f(ATLAS_W)}, ${f(ATLAS_H)});
    mask = textureLod(tShopMask, uv, max(lod - 1.0, 0.0)).rgb;
    return textureLod(tShopCol, uv, lod);
  }

  // What's seen through a shop's glass at (x along the front, y up) looking along rd (in the facade's frame, z out
  // of the wall), lit by its light L, plus what glows. w: the shop's width; dist: from the camera to the glass;
  // pxAng: a pixel's angle (how big a texel looks).
  vec3 shopInterior(vec2 at, vec3 rd, float w, int tr, float seed, vec3 hue, vec3 L, float dist, float pxAng) {
    vec2 rm = SHOP_ROOM[tr];
    float D = rm.x * (0.9 + 0.2 * h1(seed + 41.0));
    float ch = rm.y;
    vec3 ro = vec3(at, 0.0);
    float face;
    vec3 P = roomHit(ro, rd, w, ch, D, face);
    // Walls and layers repeat every 4 m, centred on the shop.
    float off = w * 0.5 - 2.0;
    vec4 rg;
    vec2 t;
    if (face < 0.5) { rg = ${reg('back')}; t = vec2(fract((P.x - off) / 4.0), P.y / ch); }
    else if (face < 1.5) { rg = ${reg('side')}; t = vec2(fract(-P.z / 3.0), P.y / ch); }
    else if (face < 2.5) { rg = ${reg('ceil')}; t = vec2(fract(P.x - off), fract(-P.z / 1.5)); }
    else { rg = ${reg('floor')}; t = vec2(fract(P.x - off), fract(-P.z / 1.5)); }
    float k = pxAng * ${f(PPM)};
    vec3 m;
    vec4 s = shopTex(tr, rg, t, log2(max((dist + length(P - ro)) * k, 1.0)), m);
    vec3 col = s.rgb / max(s.a, 1e-3);
    float zSeen = P.z;
    vec3 seen = P;
    // The layers, nearest first: the first solid one is what's seen.
    for (int i = 0; i < 4; i++) {
      vec3 ly = SHOP_LAYER[tr * 4 + i];
      if (ly.x > -0.01) break;
      if (ly.x <= P.z) continue;
      vec3 q = ro + rd * (ly.x / min(rd.z, -1e-3));
      float lh = ly.y < 1.5 ? 3.0 : 2.0;
      float lx = q.x - off;
      if (q.y < 0.0 || q.y > lh || q.x < 0.0 || q.x > w || (ly.z > 0.5 && (lx < 0.0 || lx > 4.0))) continue;
      vec4 lrg = ly.y < 0.5 ? ${reg('a')} : ly.y < 1.5 ? ${reg('b')} : ly.y < 2.5 ? ${reg('c')} : ${reg('d')};
      vec3 lm;
      float tx = fract(lx / 4.0);
      // Mirrored in some modules (not where there's text), so a wide shop doesn't repeat.
      if (ly.z > 1.5 && h1(floor(lx / 4.0) * 7.31 + seed + float(i) * 3.7) < 0.5) tx = 1.0 - tx;
      vec4 ls = shopTex(tr, lrg, vec2(tx, q.y / lh), log2(max((dist + length(q - ro)) * k, 1.0)), lm);
      if (ls.a > 0.5) { col = ls.rgb / ls.a; m = lm; zSeen = ly.x; seen = q; break; }
    }
    // The shop's own colour where the art asks for it; then what glows: screens cycle colours, specks twinkle.
    vec3 hn = hue / max(max(hue.r, hue.g), max(hue.b, 1e-3));
    col *= mix(vec3(1.0), hn, m.r);
    vec3 glow = col * m.g * 2.5;
    if (m.b > 0.75) glow = shopRainbow(uTime * 0.06 + seed * 0.37 + seen.x * 0.05 + floor(uTime * 0.25 + seed) * 0.31) * dot(col, vec3(0.3, 0.5, 0.2)) * m.g * 3.0;
    else if (m.b > 0.25) glow *= step(0.45, h2(floor(seen.xy * 23.0 + seen.z * 7.0) + floor(uTime * 3.0 + seed)));
    float dt = clamp(-zSeen / D, 0.0, 1.0);
    return col * L * mix(1.0, 0.55, dt) + glow;
  }
`;
