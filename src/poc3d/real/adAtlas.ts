import * as THREE from 'three';
import type { AdDef } from '../models/ads';
import type { CityUniforms } from './city';

/**
 * Photo ads: one canvas atlas holding, per ad, a roof-panel texture (square photo + brand on the lit plate)
 * and a door-wrap texture (tall photo + tagline and brand on the wrap colour). Text is drawn here with the
 * browser's fonts, so the copy stays editable; the photos (assets/ads/) are drawn in as they load.
 * UVs follow the sign atlas convention (v measured from the top), so ads use the same SignBuilder geometry.
 */

const art = import.meta.glob('../../../assets/ads/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const artUrl = (name: string): string | undefined => Object.entries(art).find(([p]) => p.endsWith(`/${name}.jpg`))?.[1];

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

  /** Fits text in a box: one line if it fits at >= 60% of the size, else two lines split at a space or the middle. */
  private text(t: string, x: number, y: number, w: number, h: number, color: string, weight = 'bold'): void {
    const g = this.g;
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
export function adMaterial(u: CityUniforms, atlas: AdAtlas): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0 });
  const tAds = { value: atlas.texture };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.tAds = tAds;
    shader.uniforms.uNeon = u.uNeon;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aUv;
        attribute vec2 aSign;
        varying vec2 vAUv;
        flat varying float vLit;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vAUv = aUv;
        vLit = aSign.y > 0.5 && aSign.y < 1.5 ? 1.0 : 0.0;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tAds;
        uniform float uNeon;
        varying vec2 vAUv;
        flat varying float vLit;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 ad = texture2D(tAds, vAUv).rgb;
        diffuseColor.rgb = ad;
        totalEmissiveRadiance += ad * 0.9 * uNeon * vLit;`);
  };
  m.customProgramCacheKey = () => 'ads-v1';
  return m;
}
