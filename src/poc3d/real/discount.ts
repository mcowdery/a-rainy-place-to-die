import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import { hash } from '../../core/hash';
import type { Building3 } from '../district/plan';
import { WIN } from './buildings';
import type { CityUniforms } from './city';
import type { Light } from './lightmap';
import { localBox, localFrame, localRect, toWorld } from './localFrame';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';

/**
 * 激安の殿堂 ヤスイチ YASUICHI: the discount megastore on the crossing's north-west corner (Kaburo's answer to
 * the Don Quijote on every big Japanese crossing). Yellow and red and covered in signs: a huge name board
 * with its mascot, stacked department banners down the side that faces the mega-sign, a vertical LED column
 * on the corner, a rooftop billboard, and at street level an open arcade where the goods spill out onto the
 * pavement under a canopy. Along the east side, two chain shops: 牛丼 たつ屋 and ミドリ薬局.
 * Local frame (localFrame.ts): the front faces south; u runs west to east over 22 m, t north over 20 m.
 */
export const DISCOUNT = { fw: 22, depth: 20 } as const;

const ARCADE = 3.0;
const RACKS: readonly (readonly [number, number])[] = [[2.0, 4.6], [6.4, 9.0], [13.0, 15.6], [17.4, 20.0]];

/** Collision: the store behind its arcade, the racks out on the pavement, the arcade's columns. */
export function discountColliders(b: Building3): Rect[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(f, u0, u1, t0, t1);
  return [
    R(0, DISCOUNT.fw, ARCADE, DISCOUNT.depth),
    ...RACKS.map(([u0, u1]) => R(u0, u1, -0.9, -0.1)),
    ...[0.3, 11, DISCOUNT.fw - 0.3].map((u) => R(u - 0.3, u + 0.3, 0, 0.6)),
  ];
}

/** Lightmap lights: the arcade's glare over the pavement and the shops on the east side. */
export function discountLights(b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: [number, number, number], i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  return [
    L(5, 0, 7, [1.0, 0.9, 0.55], 0.9),
    L(17, 0, 7, [1.0, 0.9, 0.55], 0.9),
    L(11, -4, 9, [1.0, 0.75, 0.3], 0.5),
    L(DISCOUNT.fw + 2, 6, 5, [1.0, 0.6, 0.25], 0.6),
    L(DISCOUNT.fw + 2, 14, 5, [0.5, 1.0, 0.6], 0.5),
  ];
}

export interface Discount {
  readonly group: THREE.Group;
  update(camera: THREE.Vector3, dt: number): void;
}

const GOODS = [0xe83a2a, 0xf0c020, 0x2a6ad0, 0x30a050, 0xf08030, 0xffffff, 0xd060a0, 0x60c0e0, 0x8a3a8a, 0x202020];

export function buildDiscount(b: Building3, city: THREE.Material, u: CityUniforms): Discount {
  const f = localFrame(b);
  const group = new THREE.Group();
  const mb = new MeshBuilder();
  mb.id = b.id;
  mb.flags = 0;
  mb.style = [0, 0, 0, 0];
  const box = (hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void => {
    mb.kind = KIND.plain;
    mb.color = lin(hex);
    localBox(mb, f, u0, u1, t0, t1, y0, y1);
  };
  const glow = (rgb: [number, number, number], u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void => {
    mb.kind = KIND.emit;
    mb.style = [EMIT.always, 0, 0, 0];
    mb.color = rgb;
    localBox(mb, f, u0, u1, t0, t1, y0, y1, KIND.emit, true);
    mb.style = [0, 0, 0, 0];
  };
  const { fw, depth } = DISCOUNT;
  const H = b.h;

  // The block: ribbon windows on the upper floors (mostly hidden by signs), a yellow ground-floor frame.
  mb.kind = KIND.wall;
  mb.color = lin(0x3a3a3e);
  mb.flags = 1 + 2 * 2 + 8 + 5 * 16;
  mb.style = [2.0, 0.6, 1.3, WIN.ribbon + 8 * Math.floor((H - 4.7) / 3)];
  mb.frontNormal = f.n;
  localBox(mb, f, 0, fw, ARCADE, depth, 4.5, H, KIND.roof);
  localBox(mb, f, 0, fw, 0, ARCADE, 4.5, H, KIND.roof);
  mb.frontNormal = null;
  mb.flags = 0;
  mb.style = [0, 0, 0, 0];
  box(0x2a2a2e, 0, fw, 0, depth, H, H + 0.6);
  // The ground floor behind the arcade: blank walls on the west and back, the east side's shops set into it,
  // a service door and a steel shutter at the back.
  box(0x34343a, 0, fw, ARCADE + 0.02, depth, 0, 4.5);
  box(0x55575c, 5, 6.2, depth, depth + 0.05, 0, 2.2);
  box(0x6a6c70, 10, 14, depth, depth + 0.05, 0, 3.2);
  for (let y = 0.2; y < 3.2; y += 0.25) box(0x4a4c50, 10, 14, depth + 0.05, depth + 0.07, y, y + 0.06);
  // The arcade: a lit, packed store interior behind open fronts, columns, the canopy.
  glow([0.5, 0.47, 0.4], 0.2, fw - 0.2, ARCADE - 0.02, ARCADE, 0, 4.4);
  box(0xd8d4c8, 0.2, fw - 0.2, 0, ARCADE, -0.01, 0.02);
  for (let y = 0.3; y < 3.9; y += 0.5) {
    for (let uu = 0.4; uu < fw - 0.4; uu += 0.32) {
      const c = GOODS[hash(b.id, Math.round(uu * 10), Math.round(y * 10)) % GOODS.length];
      box(c, uu, uu + 0.26, ARCADE - 0.35, ARCADE - 0.05, y, y + 0.28 + (hash(b.id, Math.round(y * 7), Math.round(uu * 3)) % 10) / 60);
    }
  }
  for (const cu of [0.3, 11, fw - 0.3]) box(0xf0c020, cu - 0.3, cu + 0.3, 0, 0.6, 0, 4.5);
  box(0xf0c020, 0, fw, -1.6, ARCADE, 4.1, 4.5);
  box(0xd02020, 0, fw, -1.62, -1.5, 3.6, 4.5);
  glow([0.9, 0.88, 0.8], 0.4, fw - 0.4, -1.4, 2.6, 4.07, 4.1);
  // Racks spilling onto the pavement.
  for (const [u0, u1] of RACKS) {
    box(0x8a8a8a, u0, u1, -0.9, -0.1, 0, 0.1);
    for (let y = 0.15; y < 1.6; y += 0.38) {
      box(0xc8c8c8, u0, u1, -0.9, -0.1, y - 0.03, y);
      for (let uu = u0 + 0.05; uu < u1 - 0.2; uu += 0.24) box(GOODS[hash(b.id, Math.round(uu * 10), Math.round(y * 10), 5) % GOODS.length], uu, uu + 0.2, -0.8, -0.2, y, y + 0.26);
    }
  }
  // East side at street level: two shopfronts (lit interiors) under their own fascias.
  const east = fw;
  const sideShop = (t0: number, t1: number, rgb: [number, number, number]): void => {
    glow(rgb, east + 0.01, east + 0.02, t0 + 0.3, t1 - 0.3, 0.3, 3.2);
    for (let t = t0 + 0.3; t < t1 - 0.3; t += 2) box(0x2a2a2e, east, east + 0.08, t, t + 0.08, 0, 3.4);
  };
  sideShop(3.5, 10.5, [0.95, 0.75, 0.5]);
  sideShop(11.5, 19.5, [0.85, 0.95, 0.9]);
  // The corner LED column's steel.
  box(0x1a1a1c, fw - 0.2, fw + 0.6, -0.6, 0.2, 5, H - 1);

  const mesh = new THREE.Mesh(mb.build()!, city);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);

  // Signs: canvas planes, brighter at night.
  const signMats: THREE.MeshBasicMaterial[] = [];
  const canvas = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  };
  const plane = (tex: THREE.Texture, w: number, h: number, uu: number, t: number, y: number, side: 'south' | 'east'): THREE.Mesh => {
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 1, 1) });
    signMats.push(mat);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const [x, z] = toWorld(f, uu, t);
    m.position.set(x, y, z);
    const n = side === 'south' ? f.n : f.r;
    m.rotation.y = Math.atan2(n[0], n[2]);
    group.add(m);
    return m;
  };
  const text = (g: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, fill: string, stroke?: string, sw = 0): void => {
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (stroke) {
      g.lineWidth = sw;
      g.strokeStyle = stroke;
      g.lineJoin = 'round';
      g.strokeText(s, x, y);
    }
    g.fillStyle = fill;
    g.fillText(s, x, y);
  };
  // The name board across the front, with the mascot: Yasu-kuma, a round, grinning bear.
  plane(canvas(1400, 520, (g) => {
    g.fillStyle = '#ffd400';
    g.fillRect(0, 0, 1400, 520);
    g.fillStyle = '#e01010';
    g.fillRect(0, 0, 1400, 110);
    g.fillRect(0, 460, 1400, 60);
    text(g, '激安の殿堂', 700, 58, "bold 84px 'Yu Gothic', 'Meiryo', sans-serif", '#ffffff');
    text(g, 'ヤスイチ', 820, 250, "900 200px 'Yu Gothic', 'Meiryo', sans-serif", '#e01010', '#ffffff', 22);
    text(g, 'YASUICHI', 820, 400, "900 96px 'Arial Black', 'Arial', sans-serif", '#1a1a1a');
    text(g, '24時間営業 · 免税 TAX FREE', 700, 490, "bold 40px 'Yu Gothic', 'Meiryo', sans-serif", '#ffffff');
    // Mascot.
    const cx = 200;
    const cy = 290;
    g.fillStyle = '#7a4a28';
    g.beginPath();
    g.arc(cx, cy, 130, 0, Math.PI * 2);
    g.fill();
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(cx + s * 95, cy - 105, 38, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#f0dcc0';
    g.beginPath();
    g.ellipse(cx, cy + 30, 90, 75, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a1a10';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + s * 50, cy - 20, 34, 26, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#ffffff';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(cx + s * 50, cy - 22, 11, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#1a1a1a';
    g.beginPath();
    g.ellipse(cx, cy + 20, 18, 13, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#1a1a1a';
    g.lineWidth = 7;
    g.beginPath();
    g.arc(cx, cy + 40, 40, 0.2, Math.PI - 0.2);
    g.stroke();
    g.fillStyle = '#e01010';
    g.fillRect(cx - 120, cy + 110, 240, 40);
    text(g, '安', cx, cy + 131, "900 34px 'Yu Gothic', sans-serif", '#ffd400');
  }), 16, 5.94, 11, -0.05, 8.3, 'south');
  // Stacked department banners on the upper front.
  const banners: [string, string, string][] = [['ドラッグ', '#1a8a3a', '#ffffff'], ['コスメ', '#e050a0', '#ffffff'], ['お酒', '#1a3a8a', '#ffd400'], ['家電', '#1a1a1a', '#ffd400'], ['食品', '#e01010', '#ffffff']];
  banners.forEach(([s, bg, ink], i) => {
    plane(canvas(600, 150, (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, 600, 150);
      g.strokeStyle = '#ffd400';
      g.lineWidth = 10;
      g.strokeRect(5, 5, 590, 140);
      text(g, s, 300, 80, "900 100px 'Yu Gothic', 'Meiryo', sans-serif", ink);
    }), 4.4, 1.1, i % 2 === 0 ? 3.2 : 18.8, -0.04, 12.3 + Math.floor(i / 2) * 1.5, 'south');
  });
  // Down the east side (toward the mega-sign): a tall board and the two shops' signs.
  plane(canvas(360, 1600, (g) => {
    g.fillStyle = '#ffd400';
    g.fillRect(0, 0, 360, 1600);
    g.fillStyle = '#e01010';
    g.fillRect(0, 0, 360, 200);
    text(g, '激安', 180, 100, "900 130px 'Yu Gothic', sans-serif", '#ffffff');
    ['ヤ', 'ス', 'イ', 'チ'].forEach((ch, i) => text(g, ch, 180, 360 + i * 270, "900 230px 'Yu Gothic', 'Meiryo', sans-serif", '#e01010', '#ffffff', 16));
  }), 3.2, 14.2, fw + 0.04, 9.5, 12.2, 'east');
  plane(canvas(900, 150, (g) => {
    g.fillStyle = '#f07010';
    g.fillRect(0, 0, 900, 150);
    text(g, '牛丼 たつ屋', 450, 78, "900 100px 'Yu Gothic', 'Meiryo', sans-serif", '#ffffff');
  }), 6.4, 1.05, fw + 0.04, 7, 3.9, 'east');
  plane(canvas(900, 150, (g) => {
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, 900, 150);
    g.fillStyle = '#1a9a4a';
    g.fillRect(0, 118, 900, 32);
    text(g, 'ミドリ薬局 MIDORI', 450, 64, "900 86px 'Yu Gothic', 'Meiryo', sans-serif", '#1a9a4a');
  }), 7.4, 1.2, fw + 0.04, 15.5, 3.9, 'east');
  // Rooftop billboard: SALE.
  box(0x3a3a3c, 4, 18, 6, 6.4, H + 0.6, H + 1.2);
  plane(canvas(1000, 300, (g) => {
    g.fillStyle = '#e01010';
    g.fillRect(0, 0, 1000, 300);
    text(g, '驚安 SALE 開催中!', 500, 155, "900 130px 'Yu Gothic', 'Meiryo', sans-serif", '#ffd400', '#1a1a1a', 10);
  }), 13, 3.9, 11, 6.0, H + 3.2, 'south');
  // The corner LED column: scrolling price flashes (a texture that scrolls).
  const led = canvas(128, 1024, (g) => {
    g.fillStyle = '#08080a';
    g.fillRect(0, 0, 128, 1024);
    ['¥98', '¥198', '半額', '¥980', '激安', '¥1980', '免税'].forEach((s, i) => text(g, s, 64, 70 + i * 145, "900 56px 'Arial Black', 'Yu Gothic', sans-serif", i % 2 ? '#ffd400' : '#ff3a30'));
  });
  led.wrapS = led.wrapT = THREE.RepeatWrapping;
  led.repeat.set(1, 0.5);
  plane(led, 0.8, H - 7, fw + 0.2, -0.61, 5 + (H - 6) / 2, 'south');

  return {
    group,
    update(_camera, dt) {
      const k = 0.62 + 0.55 * u.uNeon.value;
      for (const m of signMats) m.color.setScalar(k);
      led.offset.y = (led.offset.y + dt * 0.05) % 1;
    },
  };
}
