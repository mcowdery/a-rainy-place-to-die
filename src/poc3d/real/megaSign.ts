import * as THREE from 'three';
import { MEGA_ADS } from '../models/ads';
import { fitText } from './adAtlas';
import { GF, WIN } from './buildings';
import type { CityUniforms } from './city';
import { buildDragon, neonMaterial } from './dragon';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';
import { averageColour, type ScreenLight } from './screenLight';

/**
 * Kaburo's landmark: a corner tower on the central crossing wrapped in giant LED screens, crowned by the
 * neon dragon.
 * - Two 16:9 main screens (16 x 9 m) on the street faces, joined at the rounded corner by a vertical
 *   歌舞路 LED sign; two smaller screens below; an amber LED news ticker wrapping all the way round.
 * - Screens cycle through MEGA_ADS with a crossfade (each screen offset in time), rendered as an LED dot
 *   grid that resolves into pixels up close.
 * The building is 20 x 20 m (corner radius 4 m) and 34 m tall, built in local coordinates with the corner
 * at (-10, +10) from the centre; place and rotate the returned group (quarter turns keep it axis-aligned).
 */

const HALF = 10;
const HEIGHT = 34;
const CR = 4; // corner radius
const MAIN = { y0: 15.5, y1: 24.5, w: 16 };
const LOW = { y0: 6.5, y1: 12.5, w: 10.67 };
const TICK = { y0: 13.3, y1: 14.5 };

const kaburoArt = import.meta.glob('../../../assets/ads/kaburo/mega/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const artUrl = (name: string): string | undefined => Object.entries(kaburoArt).find(([p]) => p.endsWith(`/${name}.jpg`))?.[1];

const SLOT = [1024, 576] as const;
const ATLAS = [4096, 2048] as const;
const slotRect = (i: number): [number, number, number, number] => [(i % 4) * SLOT[0], Math.floor(i / 4) * SLOT[1], SLOT[0], SLOT[1]];

/** The screens' content: each mega ad with its brand and copy over a bottom scrim; avg: each slot's average colour. */
function megaAtlas(avg: THREE.Color[]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = ATLAS[0];
  c.height = ATLAS[1];
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  let left = MEGA_ADS.length;
  const settle = (): void => {
    if (--left === 0) tex.needsUpdate = true;
  };
  MEGA_ADS.forEach((ad, i) => {
    const url = artUrl(ad.art);
    if (!url) return settle();
    const img = new Image();
    img.onload = () => {
      const [x, y, w, h] = slotRect(i);
      g.save();
      g.beginPath();
      g.rect(x, y, w, h);
      g.clip();
      g.drawImage(img, x, y, w, h);
      const grad = g.createLinearGradient(0, y + h, 0, y + h * 0.6);
      grad.addColorStop(0, 'rgba(0,0,0,0.8)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x, y, w, h);
      g.shadowColor = 'rgba(0,0,0,0.8)';
      g.shadowBlur = 14;
      fitText(g, ad.brand, x + 40, y + h - 170, w * 0.7, 100, `#${ad.accent.toString(16).padStart(6, '0')}`);
      fitText(g, ad.copy, x + 40, y + h - 72, w * 0.7, 54, `#${ad.ink.toString(16).padStart(6, '0')}`, '600');
      g.restore();
      avg[i] = averageColour(c, x, y, w, h);
      settle();
    };
    img.onerror = settle;
    img.src = url;
  });
  return tex;
}

/** LED screen material: cycles slots with a crossfade; LED dot grid up close. */
function screenMaterial(u: CityUniforms, atlas: THREE.Texture): THREE.ShaderMaterial {
  return shared(u, screenMaterialRaw(atlas));
}

/** UniformsUtils.merge clones uniforms; re-attach the city's shared time and neon ones. */
function shared(u: CityUniforms, m: THREE.ShaderMaterial): THREE.ShaderMaterial {
  m.uniforms.uTime = u.uTime;
  m.uniforms.uNeon = u.uNeon;
  return m;
}

function screenMaterialRaw(atlas: THREE.Texture): THREE.ShaderMaterial {
  const slots = Array.from({ length: 12 }, (_, i) => {
    const [x, y, w, h] = slotRect(i);
    return new THREE.Vector4((x + 1) / ATLAS[0], (y + 1) / ATLAS[1], (x + w - 1) / ATLAS[0], (y + h - 1) / ATLAS[1]);
  });
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tAtlas: { value: atlas }, uSlots: { value: slots }, uCount: { value: MEGA_ADS.length } }]),
    fog: true,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute float aScreen;
      varying vec2 vUv;
      varying float vScreen;
      void main() {
        vUv = uv;
        vScreen = aScreen;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform sampler2D tAtlas;
      uniform vec4 uSlots[12];
      uniform float uCount;
      uniform float uTime;
      uniform float uNeon;
      varying vec2 vUv;
      varying float vScreen;
      vec3 slot(int i, vec2 uv) {
        vec4 r = uSlots[i];
        return texture2D(tAtlas, vec2(mix(r.x, r.z, uv.x), mix(r.w, r.y, uv.y))).rgb;
      }
      void main() {
        vec2 res = vec2(480.0, 270.0);
        vec2 px = vUv * res;
        float fw = max(fwidth(px.x), fwidth(px.y));
        // Up close the image snaps to the LED grid; far away it's smooth.
        vec2 uvq = mix((floor(px) + 0.5) / res, vUv, smoothstep(0.4, 1.2, fw));
        float ph = uTime / 7.0 + vScreen * 0.37;
        float i0 = floor(ph);
        float k = smoothstep(0.9, 1.0, fract(ph));
        int a = int(mod(i0 + vScreen * 2.0, uCount));
        int b = int(mod(i0 + 1.0 + vScreen * 2.0, uCount));
        vec3 col = mix(slot(a, uvq), slot(b, uvq), k);
        // Transition sweep.
        col += vec3(0.6) * k * (1.0 - k) * 4.0 * smoothstep(0.08, 0.0, abs(vUv.y - (1.0 - k)));
        vec2 g = abs(fract(px) - 0.5);
        float led = smoothstep(0.5, 0.36, max(g.x, g.y));
        col *= mix(led * 1.25, 0.85, smoothstep(0.3, 1.0, fw));
        gl_FragColor = vec4(col * mix(1.3, 2.2, uNeon), 1.0);
        #include <fog_fragment>
      }`,
  });
}

/** LED dot-matrix text panel (ticker / vertical sign): canvas text sampled per dot, optionally scrolling. */
function ledMaterial(u: CityUniforms, canvas: HTMLCanvasElement, dots: [number, number], color: THREE.Color, scroll: number): THREE.ShaderMaterial {
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.wrapS = THREE.RepeatWrapping;
  return shared(u, new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tText: { value: tex }, uDots: { value: new THREE.Vector2(...dots) }, uColor: { value: color }, uScroll: { value: scroll } }]),
    fog: true,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform sampler2D tText;
      uniform vec2 uDots;
      uniform vec3 uColor;
      uniform float uScroll;
      uniform float uTime;
      uniform float uNeon;
      varying vec2 vUv;
      void main() {
        vec2 px = vec2(vUv.x + uTime * uScroll, 1.0 - vUv.y) * uDots;
        vec2 cell = floor(px);
        float on = texture2D(tText, (cell + 0.5) / uDots).r;
        float d = length(fract(px) - 0.5);
        float fw = fwidth(px.x);
        float dotm = mix(smoothstep(0.45, 0.3, d), 0.6, smoothstep(0.4, 1.2, fw));
        vec3 col = uColor * (0.05 + on * dotm * mix(1.6, 3.2, uNeon));
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  }));
}

function textCanvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff';
  draw(g);
  return c;
}

const TICKER_TEXT = '歌舞路ニュース ◆ 今夜の天気 雨のち晴れ ◆ 竜神興業 新ビル着工へ ◆ 行方不明の女性 情報求む ☎0120-41-4545 ◆ 映画『東京ノワール』大ヒット上映中 ◆ ミッドナイト☆シスターズ 新曲 真夜中サイダー ◆ ';

/** Path around the screen wrap: face A (x = -HALF, running from z = -HALF+... toward the corner), the arc, face B. */
interface Wrap {
  /** Point and outward normal at arc-length s along the wrap. */
  at(s: number): { p: THREE.Vector3; n: THREE.Vector3 };
  readonly faceA: [number, number];
  readonly arc: [number, number];
  readonly faceB: [number, number];
  readonly length: number;
}

function wrapPath(): Wrap {
  // Face A: x = -HALF, from z = -HALF (back) to z = HALF - CR; arc centre (-HALF+CR, HALF-CR); face B: z = HALF,
  // from x = -HALF + CR to x = HALF. Walking left to right as seen from the crossing.
  const la = 2 * HALF - CR;
  const lc = (Math.PI / 2) * CR;
  const lb = 2 * HALF - CR;
  const at = (s: number): { p: THREE.Vector3; n: THREE.Vector3 } => {
    if (s <= la) return { p: new THREE.Vector3(-HALF, 0, -HALF + s), n: new THREE.Vector3(-1, 0, 0) };
    if (s <= la + lc) {
      const a = Math.PI + ((s - la) / lc) * (Math.PI / 2) * -1; // from facing -x (pi) to facing +z (pi/2)
      const n = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      return { p: new THREE.Vector3(-HALF + CR, 0, HALF - CR).addScaledVector(n, CR), n };
    }
    return { p: new THREE.Vector3(-HALF + CR + (s - la - lc), 0, HALF), n: new THREE.Vector3(0, 0, 1) };
  };
  return { at, faceA: [0, la], arc: [la, la + lc], faceB: [la + lc, la + lc + lb], length: la + lc + lb };
}

/** A strip of the wrap between arc lengths s0..s1 and heights y0..y1, offset out by `out`, uv 0..1. */
function strip(wrap: Wrap, s0: number, s1: number, y0: number, y1: number, out: number, screen: number, uScale = 1): THREE.BufferGeometry {
  const n = Math.max(2, Math.ceil((s1 - s0) / 0.5));
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const scr: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const { p, n: nv } = wrap.at(s);
    p.addScaledVector(nv, out);
    for (const [y, v] of [[y0, 0], [y1, 1]] as const) {
      pos.push(p.x, y, p.z);
      nor.push(nv.x, 0, nv.z);
      uv.push(((s - s0) / (s1 - s0)) * uScale, v);
      scr.push(screen);
    }
  }
  for (let i = 0; i < n; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aScreen', new THREE.Float32BufferAttribute(scr, 1));
  g.setIndex(idx);
  return g;
}

export interface MegaSign {
  readonly group: THREE.Group;
  /** Local position of the dragon's head (for camera framing). */
  readonly headAt: THREE.Vector3;
  /** The screens and the corner sign as area lights, in local coordinates (add the group's position). */
  readonly lights: ScreenLight[];
}

/** Builds the mega-sign. Local origin: the building's centre at ground level; corner at (-HALF, +HALF). */
export function buildMegaSign(u: CityUniforms, city: THREE.Material): MegaSign {
  const group = new THREE.Group();
  const mb = new MeshBuilder();
  // Tower: two boxes and a corner cylinder, dark curtain wall.
  mb.id = 90001;
  mb.kind = KIND.wall;
  mb.color = lin(0x22262c);
  mb.flags = 1 + 8 + 5 * 16;
  mb.style = [1.8, 0.6, 1.4, WIN.curtain + 8 * 9];
  // Both street faces get shopfronts at ground level (south: box A, west: box B).
  mb.frontNormal = [0, 0, 1];
  mb.box(CR / 2, 0, 0, HEIGHT, 2 * HALF - CR, 2 * HALF);
  mb.frontNormal = [-1, 0, 0];
  mb.box(-HALF + CR / 2, -CR / 2, 0, HEIGHT, CR, 2 * HALF - CR);
  mb.frontNormal = null;
  mb.kind = KIND.plain;
  const [ccx, ccz] = [-HALF + CR, HALF - CR];
  mb.cylinder(ccx, ccz, GF, HEIGHT, CR, 16);
  // The corner at street level: a glass lobby (lit drum behind mullions) under a round canopy.
  mb.kind = KIND.emit;
  mb.style = [EMIT.always, 0, 0, 0];
  mb.color = [0.5, 0.44, 0.36];
  mb.lathe(ccx, ccz, [[0, CR - 0.3], [GF, CR - 0.3]], 20);
  mb.color = [1.1, 1.0, 0.9];
  mb.lathe(ccx, ccz, [[GF - 0.22, CR + 1.3], [GF - 0.2, CR + 1.3]], 24);
  mb.style = [0, 0, 0, 0];
  mb.kind = KIND.plain;
  mb.color = lin(0x1a1c20);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    mb.cylinder(ccx + Math.cos(a) * (CR - 0.05), ccz + Math.sin(a) * (CR - 0.05), 0, GF, 0.07, 5);
  }
  mb.color = lin(0x2c2e32);
  for (const rings of [[[GF, CR], [GF, CR + 1.4]], [[GF, CR + 1.4], [GF, CR]], [[GF - 0.2, CR + 1.4], [GF - 0.2, CR]], [[GF - 0.2, CR], [GF - 0.2, CR + 1.4]], [[GF - 0.2, CR + 1.4], [GF, CR + 1.4]]] as [number, number][][]) {
    mb.lathe(ccx, ccz, rings, 24);
  }
  // Parapet and a roof deck.
  mb.color = lin(0x2c2e32);
  mb.box(0, 0, HEIGHT, HEIGHT + 0.6, 2 * HALF, 2 * HALF, KIND.roof);

  // Screen bezels (dark frames just behind each screen), then the screens and LED panels.
  const wrap = wrapPath();
  const mid = (r: [number, number]): number => (r[0] + r[1]) / 2;
  const screens: THREE.BufferGeometry[] = [];
  const main: [number, number, number][] = [
    [mid(wrap.faceA) - MAIN.w / 2, mid(wrap.faceA) + MAIN.w / 2, 0],
    [mid(wrap.faceB) - MAIN.w / 2, mid(wrap.faceB) + MAIN.w / 2, 1],
  ];
  const low: [number, number, number][] = [
    [mid(wrap.faceA) - LOW.w / 2, mid(wrap.faceA) + LOW.w / 2, 2],
    [mid(wrap.faceB) - LOW.w / 2, mid(wrap.faceB) + LOW.w / 2, 3],
  ];
  const bezel = (s0: number, s1: number, y0: number, y1: number): void => {
    mb.kind = KIND.plain;
    mb.color = lin(0x0c0c0e);
    const steps = Math.max(1, Math.ceil((s1 - s0) / 1));
    for (let i = 0; i < steps; i++) {
      const a = wrap.at(s0 + ((s1 - s0) * i) / steps);
      const b = wrap.at(s0 + ((s1 - s0) * (i + 1)) / steps);
      const pa = a.p.clone().addScaledVector(a.n, 0.25);
      const pb = b.p.clone().addScaledVector(b.n, 0.25);
      mb.quad([pa.x, y0, pa.z], [pb.x - pa.x, 0, pb.z - pa.z], [0, y1 - y0, 0]);
    }
  };
  for (const [s0, s1, k] of main) {
    bezel(s0 - 0.4, s1 + 0.4, MAIN.y0 - 0.4, MAIN.y1 + 0.4);
    screens.push(strip(wrap, s0, s1, MAIN.y0, MAIN.y1, 0.3, k));
  }
  for (const [s0, s1, k] of low) {
    bezel(s0 - 0.3, s1 + 0.3, LOW.y0 - 0.3, LOW.y1 + 0.3);
    screens.push(strip(wrap, s0, s1, LOW.y0, LOW.y1, 0.3, k));
  }
  const screenGeo = mergeAll(screens);
  const avg: THREE.Color[] = MEGA_ADS.map(() => new THREE.Color(0.05, 0.05, 0.06));
  group.add(new THREE.Mesh(screenGeo, screenMaterial(u, megaAtlas(avg))));
  // The screens as lights, following the same crossfade as the screen shader.
  const lights: ScreenLight[] = [];
  const screenLight = (s: number, y0: number, y1: number, w: number, k: number): ScreenLight => {
    const { p, n } = wrap.at(s);
    return {
      centre: p.clone().addScaledVector(n, 0.35).setY((y0 + y1) / 2),
      normal: n.clone(),
      halfW: w / 2,
      halfH: (y1 - y0) / 2,
      colour(time, neon, out) {
        const ph = time / 7 + k * 0.37;
        const i0 = Math.floor(ph);
        const f = ph - i0;
        const t = Math.min(1, Math.max(0, (f - 0.9) / 0.1));
        const mix = t * t * (3 - 2 * t);
        const n = MEGA_ADS.length;
        const a = avg[((i0 + k * 2) % n + n) % n];
        const b = avg[((i0 + 1 + k * 2) % n + n) % n];
        return out.copy(a).lerp(b, mix).multiplyScalar((1.3 + 0.9 * neon) * 0.95);
      },
    };
  };
  lights.push(
    screenLight(mid(wrap.faceA), MAIN.y0, MAIN.y1, MAIN.w, 0),
    screenLight(mid(wrap.faceB), MAIN.y0, MAIN.y1, MAIN.w, 1),
    screenLight(mid(wrap.faceA), LOW.y0, LOW.y1, LOW.w, 2),
    screenLight(mid(wrap.faceB), LOW.y0, LOW.y1, LOW.w, 3),
  );
  // The corner sign: pink text on black, about a third lit.
  const corner = wrap.at(mid(wrap.arc));
  lights.push({
    centre: corner.p.clone().addScaledVector(corner.n, 0.35).setY((MAIN.y0 + MAIN.y1) / 2),
    normal: corner.n.clone(),
    halfW: 3,
    halfH: (MAIN.y1 - MAIN.y0) / 2,
    colour: (_t, neon, out) => out.setRGB(1.0, 0.25, 0.7).multiplyScalar(0.3 * (1.6 + 1.6 * neon)),
  });

  // Vertical 歌舞路 LED sign on the corner, between the two main screens.
  // Canvas aspect matches the strip (~6.9 x 9 m) so the characters aren't stretched.
  const sign = textCanvas(310, 400, (g) => {
    g.font = "bold 124px 'Yu Gothic', 'Meiryo', sans-serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    ['歌', '舞', '路'].forEach((ch, i) => g.fillText(ch, 155, 70 + i * 130));
  });
  bezel(wrap.arc[0] - 0.4, wrap.arc[1] + 0.4, MAIN.y0 - 0.4, MAIN.y1 + 0.4);
  const cornerMesh = new THREE.Mesh(strip(wrap, wrap.arc[0] - 0.3, wrap.arc[1] + 0.3, MAIN.y0, MAIN.y1, 0.3, 0), ledMaterial(u, sign, [62, 80], new THREE.Color(1.0, 0.25, 0.7), 0));
  // Ticker: amber news crawl all the way round (one canvas width per ~40 m).
  const ticker = textCanvas(4096, 128, (g) => {
    g.font = "bold 104px 'Yu Gothic', 'Meiryo', sans-serif";
    g.textBaseline = 'middle';
    g.fillText(TICKER_TEXT + TICKER_TEXT, 0, 68);
  });
  bezel(wrap.faceA[0] + 1, wrap.faceB[1] - 1, TICK.y0 - 0.15, TICK.y1 + 0.15);
  const tickerMesh = new THREE.Mesh(strip(wrap, wrap.faceA[0] + 1, wrap.faceB[1] - 1, TICK.y0, TICK.y1, 0.3, 0, (wrap.length - 2) / 40), ledMaterial(u, ticker, [1400, 44], new THREE.Color(1.0, 0.55, 0.1), 0.012));
  group.add(cornerMesh, tickerMesh);

  // The dragon on the roof, facing the corner; its steel pylons are built in roof-local coordinates too.
  const pylons = new MeshBuilder();
  const built = buildDragon(pylons, HALF, [-Math.SQRT1_2, Math.SQRT1_2]);
  const dragon = new THREE.Mesh(built.geometry, neonMaterial(u));
  const steel = new THREE.Mesh(pylons.build()!, city);
  dragon.position.y = steel.position.y = HEIGHT + 0.6;
  steel.castShadow = true;
  const tower = new THREE.Mesh(mb.build()!, city);
  tower.castShadow = tower.receiveShadow = true;
  group.add(tower, steel, dragon);
  return { group, headAt: built.head.clone().setY(built.head.y + HEIGHT + 0.6), lights };
}

function mergeAll(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const scr: number[] = [];
  const idx: number[] = [];
  for (const g of gs) {
    const base = pos.length / 3;
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nor.push(...(g.getAttribute('normal').array as Float32Array));
    uv.push(...(g.getAttribute('uv').array as Float32Array));
    scr.push(...(g.getAttribute('aScreen').array as Float32Array));
    for (const i of g.getIndex()!.array) idx.push(base + i);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('aScreen', new THREE.Float32BufferAttribute(scr, 1));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}
