import * as THREE from 'three';
import { edition } from '@edition';
import { DISTRICT_ADS, type AdDef, type DistrictAd } from '../models/ads';
import { DISTRICT_ATLAS, districtAdRect } from './districtAds';
import type { CityUniforms } from './city';

/**
 * Photo ads: one canvas atlas holding, per ad, a roof-panel texture (square photo + brand on the lit plate)
 * and a door-wrap texture (tall photo + tagline and brand on the wrap colour). Text is drawn here with the
 * browser's fonts, so the copy stays editable; the photos (assets/ads/) are drawn in as they load.
 * UVs follow the sign atlas convention (v measured from the top), so ads use the same SignBuilder geometry.
 */

const art = import.meta.glob('../../../assets/ads/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const artUrl = (name: string): string | undefined => Object.entries(art).find(([p]) => p.endsWith(`/${name}.jpg`))?.[1];
// Kaburo's ad art comes from the edition: the demo's leaves out the revealing ads (src/edition/demoArt.ts).
const kaburoUrl = (name: string): string | undefined => edition.kaburoArt[name];

const ROOF_W = 768;
const ROOF_H = 256;
const DOOR_W = 832;
const DOOR_H = 480;
const DOOR_PHOTO_W = 360;
const W = ROOF_W + DOOR_W * 2;
const H = 2048;

type Rect4 = readonly [number, number, number, number];

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
const luma = (c: number): number => (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;

/** Fits text in a box: one line if it fits at >= 60% of the size, else two lines split at a space or the middle. */
export function fitText(g: CanvasRenderingContext2D, t: string, x: number, y: number, w: number, h: number, color: string, weight = 'bold'): void {
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const font = (px: number): string => `${weight} ${px}px 'Yu Gothic', 'Meiryo', 'Arial', sans-serif`;
  g.font = font(h * 0.8);
  const one = g.measureText(t).width;
  if (one <= w || (w / one) * h * 0.8 >= h * 0.48) {
    const k = Math.min(1, w / one);
    g.save();
    g.translate(x + w / 2, y + h / 2);
    g.scale(k, 1);
    g.fillText(t, 0, 0);
    g.restore();
    return;
  }
  // Break at the space or Japanese comma / full stop nearest the middle (after the punctuation).
  let cut = Math.ceil(t.length / 2);
  let best = Infinity;
  [...t].forEach((ch, k) => {
    if ((ch === ' ' || ch === '、' || ch === '。') && k > 0 && k < t.length - 1 && Math.abs(k + 1 - t.length / 2) < best) {
      best = Math.abs(k + 1 - t.length / 2);
      cut = ch === ' ' ? k : k + 1;
    }
  });
  const lines = [t.slice(0, cut).trim(), t.slice(cut).trim()];
  g.font = font(h * 0.4);
  lines.forEach((ln, k) => {
    const lw = g.measureText(ln).width;
    const s = Math.min(1, w / lw);
    g.save();
    g.translate(x + w / 2, y + h * (0.27 + k * 0.48));
    g.scale(s, 1);
    g.fillText(ln, 0, 0);
    g.restore();
  });
}

export class AdAtlas {
  readonly texture: THREE.CanvasTexture;
  private readonly g: CanvasRenderingContext2D;

  constructor(ads: readonly AdDef[]) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    this.g = c.getContext('2d')!;
    const g = this.g;
    g.fillStyle = '#d8d8d4';
    g.fillRect(0, 0, W, H);
    this.texture = new THREE.CanvasTexture(c);
    this.texture.flipY = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    ads.forEach((ad, i) => {
      this.drawRoof(ad, i);
      this.drawDoor(ad, i);
      for (const part of ['roof', 'door'] as const) {
        const url = artUrl(`${ad.art}_${part}`);
        if (!url) continue;
        const img = new Image();
        img.onload = () => {
          const [x, y] = part === 'roof' ? this.roofAt(i) : this.doorAt(i);
          if (part === 'roof') g.drawImage(img, x, y, ROOF_H, ROOF_H);
          else g.drawImage(img, x, y, DOOR_PHOTO_W, DOOR_H);
          this.texture.needsUpdate = true;
        };
        img.src = url;
      }
    });
  }

  private roofAt(i: number): [number, number] {
    return [0, i * ROOF_H];
  }

  private doorAt(i: number): [number, number] {
    return [ROOF_W + (i % 2) * DOOR_W, Math.floor(i / 2) * 512];
  }

  /** UV rect (u0, v0 top, u1, v1 bottom) of an ad's roof panel or door wrap. */
  uv(i: number, part: 'roof' | 'door'): Rect4 {
    const [x, y] = part === 'roof' ? this.roofAt(i) : this.doorAt(i);
    const [w, h] = part === 'roof' ? [ROOF_W, ROOF_H] : [DOOR_W, DOOR_H];
    return [(x + 1) / W, (y + 1) / H, (x + w - 1) / W, (y + h - 1) / H];
  }

  /** Aspect (width / height) of each part. */
  static readonly ROOF_ASPECT = ROOF_W / ROOF_H;
  static readonly DOOR_ASPECT = DOOR_W / DOOR_H;

  /** A plain spot for the panels' edges and backs (the gap under the first door row). */
  get blankUv(): [number, number] {
    return [(ROOF_W + 40) / W, 496 / H];
  }

  private text(t: string, x: number, y: number, w: number, h: number, color: string, weight = 'bold'): void {
    fitText(this.g, t, x, y, w, h, color, weight);
  }

  private drawRoof(ad: AdDef, i: number): void {
    const g = this.g;
    const [x, y] = this.roofAt(i);
    const plate = ad.plate ?? 0xf2f0e8;
    const ink = hex(ad.ink ?? 0x141418);
    g.fillStyle = hex(plate);
    g.fillRect(x, y, ROOF_W, ROOF_H);
    // Photo placeholder until the image loads.
    g.fillStyle = hex(ad.wrap ?? plate);
    g.fillRect(x, y, ROOF_H, ROOF_H);
    // Brand (large) and tagline (small) beside the photo, with an accent rule between.
    const tx = x + ROOF_H + 18;
    const tw = ROOF_W - ROOF_H - 36;
    this.text(ad.roof ?? '', tx, y + 22, tw, 130, ink);
    g.fillStyle = ink;
    g.fillRect(tx + tw * 0.2, y + 162, tw * 0.6, 4);
    this.text(ad.side ?? '', tx, y + 176, tw, 60, ink, '600');
  }

  private drawDoor(ad: AdDef, i: number): void {
    const g = this.g;
    const [x, y] = this.doorAt(i);
    const wrap = ad.wrap ?? 0x333333;
    const ink = luma(wrap) > 0.55 ? '#141414' : '#f6f4ee';
    g.fillStyle = hex(wrap);
    g.fillRect(x, y, DOOR_W, DOOR_H);
    const tx = x + DOOR_PHOTO_W + 24;
    const tw = DOOR_W - DOOR_PHOTO_W - 48;
    // Tagline / call to action (large), then the brand in the ad's accent colour on a small plate.
    this.text(ad.side ?? '', tx, y + 60, tw, 210, ink);
    const plate = ad.plate ?? 0xf2f0e8;
    g.fillStyle = hex(plate === wrap ? (luma(wrap) > 0.55 ? 0x141414 : 0xf6f4ee) : plate);
    g.fillRect(tx, y + 320, tw, 104);
    const brandInk = plate === wrap ? hex(wrap) : hex(ad.ink ?? 0x141414);
    this.text(ad.roof ?? '', tx + 12, y + 330, tw - 24, 84, brandInk);
  }
}

/**
 * Material for photo ads: the atlas colour as albedo; lightboxes (sign style 1) also glow with it when the
 * neon is on. Uses the SignBuilder attributes (aUv, aSign).
 */
export function adMaterial(u: CityUniforms, atlas: { readonly texture: THREE.Texture }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0 });
  const tAds = { value: atlas.texture };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.tAds = tAds;
    shader.uniforms.uNeon = u.uNeon;
    // Atlas size over the billboard slot size: fract(uv * this) is where on the panel a pixel is.
    shader.uniforms.uSlot = { value: new THREE.Vector4(DISTRICT_ATLAS.W / DISTRICT_ATLAS.billboard[0], DISTRICT_ATLAS.H / DISTRICT_ATLAS.billboard[1], 0, 0) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aUv;
        attribute vec2 aSign;
        varying vec2 vAUv;
        flat varying float vLit;
        flat varying float vLamps;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vAUv = aUv;
        vLit = aSign.y > 0.5 && aSign.y < 1.5 ? 1.0 : 0.0;
        vLamps = aSign.y > 9.5 ? aSign.y - 10.0 : 0.0;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tAds;
        uniform float uNeon;
        varying vec2 vAUv;
        flat varying float vLit;
        flat varying float vLamps;
        uniform vec4 uSlot;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 ad = texture2D(tAds, vAUv).rgb;
        diffuseColor.rgb = ad;
        // Lightboxes (posters, taxi roofs) glow from behind, evenly.
        totalEmissiveRadiance += ad * 0.9 * uNeon * vLit;
        if (vLamps > 0.5) {
          // Floodlit billboards: lit only by their lamps on the top edge. Where on the panel we are, from the
          // atlas slot (x across, y down from the top), in metres (the panel is ~3 m per lamp, 2:1).
          vec2 local = fract(vAUv * uSlot.xy);
          float W = vLamps * 3.0;
          vec2 m = vec2(local.x * W, local.y * W * 0.5);
          float light = 0.0;
          for (int k = 0; k < 8; k++) {
            if (float(k) >= vLamps) break;
            float lx = (float(k) + 0.5) / vLamps * W;
            // Each lamp throws a pool that widens and fades down the face: a scalloped hot spot just under the
            // lamp, then the pools overlapping into an even wash that dims toward the bottom edge (lit to read,
            // never glowing like a screen).
            float spread = 0.5 + 0.55 * m.y;
            float dx = m.x - lx;
            float pool = exp(-dx * dx / (2.0 * spread * spread)) * 1.5 * exp(-0.25 * m.y);
            light += pool * smoothstep(0.0, 0.12, m.y);
          }
          // Some stray light everywhere (the lamps' spill, the street's glow).
          light = light + 0.12;
          totalEmissiveRadiance += ad * min(light, 1.6) * 0.7 * uNeon;
        }`);
  };
  m.customProgramCacheKey = () => 'ads-v3';
  return m;
}

/**
 * District ad atlas (layout in districtAds.ts): each ad's photo with its brand and copy composited on top.
 * Billboards: a full 2:1 photo with a dark gradient behind the text on the side away from the subject
 * (a narrower photo sits beside a solid text panel); posters: photo over a coloured brand band.
 */
export class DistrictAdAtlas {
  readonly texture: THREE.CanvasTexture;
  private readonly g: CanvasRenderingContext2D;

  constructor() {
    const { W, H } = DISTRICT_ATLAS;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = (this.g = c.getContext('2d')!);
    g.fillStyle = '#151518';
    g.fillRect(0, 0, W, H);
    this.texture = new THREE.CanvasTexture(c);
    this.texture.flipY = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    // Placeholders first; the photos are drawn as they arrive but the (32 MB) texture is uploaded once, when
    // all have loaded (or failed), rather than once per image.
    let left = DISTRICT_ADS.length;
    const settle = (): void => {
      if (--left === 0) this.texture.needsUpdate = true;
    };
    DISTRICT_ADS.forEach((ad, i) => {
      this.draw(ad, i, null);
      const url = kaburoUrl(ad.art);
      if (!url) return settle();
      const img = new Image();
      img.onload = () => {
        this.draw(ad, i, img);
        settle();
      };
      img.onerror = settle;
      img.src = url;
    });
  }

  /** Draws one ad into its slot: laid out in reference units (billboard 1024x512, poster 512x768) and scaled to fit. */
  private draw(ad: DistrictAd, i: number, img: HTMLImageElement | null): void {
    const g = this.g;
    const [sx, sy, sw, sh] = districtAdRect(i);
    const [w, h] = ad.format === 'poster' ? [512, 768] : [1024, 512];
    g.save();
    g.beginPath();
    g.rect(sx, sy, sw, sh);
    g.clip();
    g.translate(sx, sy);
    g.scale(sw / w, sh / h);
    const x = 0;
    const y = 0;
    g.fillStyle = hex(ad.accent);
    g.fillRect(x, y, w, h);
    const ink = hex(ad.ink);
    if (ad.format === 'poster') {
      const ph = 620;
      if (img) g.drawImage(img, x, y, w, ph);
      g.fillStyle = hex(ad.accent);
      g.fillRect(x, y + ph, w, h - ph);
      fitText(g, ad.brand, x + 16, y + ph + 8, w - 32, 80, ink);
      fitText(g, ad.copy, x + 16, y + ph + 88, w - 32, 52, ink, '600');
      g.restore();
      return;
    }
    const aspect = img ? img.width / img.height : 2;
    if (img && aspect < 1.8) {
      // Narrow photo: photo on the left, text panel on the right.
      const pw = Math.round(h * aspect);
      g.drawImage(img, x, y, pw, h);
      fitText(g, ad.brand, x + pw + 24, y + 110, w - pw - 48, 150, ink);
      g.fillStyle = ink;
      g.fillRect(x + pw + 60, y + 280, w - pw - 120, 5);
      fitText(g, ad.copy, x + pw + 24, y + 310, w - pw - 48, 90, ink, '600');
      g.restore();
      return;
    }
    if (img) g.drawImage(img, x, y, w, h);
    const side = ad.text ?? 'left';
    // Gradient scrim behind the text so it reads over any photo.
    const grad = side === 'left' ? g.createLinearGradient(x, 0, x + w * 0.5, 0) : side === 'right' ? g.createLinearGradient(x + w, 0, x + w * 0.5, 0) : g.createLinearGradient(0, y + h, 0, y + h * 0.55);
    grad.addColorStop(0, 'rgba(0,0,0,0.78)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    g.shadowColor = 'rgba(0,0,0,0.8)';
    g.shadowBlur = 12;
    if (side === 'bottom') {
      fitText(g, ad.brand, x + 40, y + h - 170, w - 80, 110, hex(ad.accent));
      fitText(g, ad.copy, x + 40, y + h - 70, w - 80, 56, ink, '600');
    } else {
      const tx = side === 'left' ? x + 30 : x + w * 0.6;
      const tw = w * 0.38;
      fitText(g, ad.brand, tx, y + 150, tw, 130, hex(ad.accent));
      fitText(g, ad.copy, tx, y + 300, tw, 70, ink, '600');
    }
    g.restore();
  }
}
