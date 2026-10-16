import { DISTRICT_ADS } from '../models/ads';
import type { AdSite, AdView } from './adSites';
import { EMIT, KIND, lin, type MeshBuilder } from './meshBuilder';
import { signBox, type SignBuilder } from './signs';

/**
 * District photo ads in the world: the atlas layout and the panels themselves (pure, so the chunk workers build
 * them). Where they go, and which ad each carries, is adSites.ts: a billboard only where people really see it.
 * - rooftop billboards: a lit 2:1 panel on a steel frame a metre in from a roof's edge, floodlight arms above it;
 * - wall billboards: a 2:1 panel on a windowless wall, flush on the street face or on a frame off another wall;
 * - street posters: 2:3 lightbox posters on shopfronts at eye level.
 * The texture is DistrictAdAtlas (adAtlas.ts), which follows the layout below.
 */

type C3 = [number, number, number];
type Rect4 = readonly [number, number, number, number];

/** Slots: billboards 640x320 (6 per row, 6 rows = 36), posters 320x480 (12 per row, 4 rows below = 48). */
export const DISTRICT_ATLAS = { W: 4096, H: 4096, billboard: [640, 320], poster: [320, 480], posterTop: 1920, perRow: { billboard: 6, poster: 12 } } as const;

export const BILLBOARDS = DISTRICT_ADS.map((a, i) => ({ a, i })).filter((x) => x.a.format === 'billboard');
export const POSTERS = DISTRICT_ADS.map((a, i) => ({ a, i })).filter((x) => x.a.format === 'poster');

/** Pixel rect of catalogue entry i in the atlas: billboards in rows at the top, posters in rows below. */
export function districtAdRect(i: number): [number, number, number, number] {
  const ad = DISTRICT_ADS[i];
  const list = ad.format === 'billboard' ? BILLBOARDS : POSTERS;
  const k = list.findIndex((x) => x.i === i);
  if (ad.format === 'billboard') {
    const [w, h] = DISTRICT_ATLAS.billboard;
    const n = DISTRICT_ATLAS.perRow.billboard;
    return [(k % n) * w, Math.floor(k / n) * h, w, h];
  }
  const [w, h] = DISTRICT_ATLAS.poster;
  const n = DISTRICT_ATLAS.perRow.poster;
  return [(k % n) * w, DISTRICT_ATLAS.posterTop + Math.floor(k / n) * h, w, h];
}

export function districtAdUv(i: number): Rect4 {
  const [x, y, w, h] = districtAdRect(i);
  const { W, H } = DISTRICT_ATLAS;
  return [(x + 1) / W, (y + 1) / H, (x + w - 1) / W, (y + h - 1) / H];
}

/** A dark spot for the panels' edges (the unused corner below the poster rows). */
export const DISTRICT_BLANK: [number, number] = [4000 / DISTRICT_ATLAS.W, 4050 / DISTRICT_ATLAS.H];

const STEEL = lin(0x2c2e32);

/** How many floodlights a panel of width w gets. */
const lampCount = (w: number): number => Math.max(2, Math.round(w / 3));

/**
 * The ad material's style for a floodlit billboard: 10 + its lamp count (the shader lights the panel from
 * that many lamps along its top edge, each pool fading down the face). Style 1 is a backlit lightbox.
 */
export const floodlit = (w: number): number => 10 + lampCount(w);

/** Floodlight arms reaching out over a panel from its top edge. */
function floodlights(mb: MeshBuilder, p: C3, r: C3, n: C3, u0: number, u1: number, y: number, out: number): void {
  const count = lampCount(u1 - u0);
  for (let k = 0; k < count; k++) {
    const u = u0 + ((k + 0.5) * (u1 - u0)) / count;
    mb.kind = KIND.plain;
    mb.color = STEEL;
    mb.style = [0, 0, 0, 0];
    mb.frameBox(p, r, n, u - 0.03, u + 0.03, y, y + 0.05, out, out + 0.9);
    mb.kind = KIND.emit;
    mb.color = [0.9, 0.85, 0.7];
    mb.style = [EMIT.lamp, 0, 0, 0];
    mb.frameBox(p, r, n, u - 0.14, u + 0.14, y - 0.06, y, out + 0.8, out + 1.0);
  }
  mb.style = [0, 0, 0, 0];
}

/** Where an ad went (for tests and camera placement). */
export interface AdPlacement {
  /** side: a wall that isn't the street face. */
  readonly kind: 'rooftop' | 'wall' | 'poster' | 'side';
  readonly ad: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly nx: number;
  readonly nz: number;
  /** Who it was put up for (adSites.ts). */
  readonly view: AdView;
}

/** Adds a chunk's district ads (the sites adSites.ts chose): panels into sb (ad atlas material), frames and lamps into mb. */
export function addDistrictAds(sb: SignBuilder, mb: MeshBuilder, sites: readonly AdSite[], out?: AdPlacement[]): void {
  for (const s of sites) {
    if (s.ad < 0) continue;
    const { b, c, r, n, w: W, h: H, y0 } = s;
    const uv = { n: districtAdUv(s.ad) };
    mb.kind = KIND.plain;
    mb.style = [0, 0, 0, 0];
    sb.ink = [1, 1, 1];
    sb.plate = [0, 0, 0];
    if (s.kind === 'poster') {
      // A B1 lightbox poster: about 0.6 x 0.9 m, its middle at eye level.
      mb.color = lin(0xb8b8b8);
      mb.frameBox(c, r, n, -W / 2 - 0.04, W / 2 + 0.04, y0 - 0.04, y0 + H + 0.04, 0.01, 0.08);
      sb.sign = [b.id % 100000, 1];
      signBox(sb, c, r, n, -W / 2, W / 2, y0, y0 + H, 0.08, 0.1, DISTRICT_BLANK, uv);
    } else if (s.kind === 'rooftop') {
      mb.color = STEEL;
      // Backing box, two rails and posts down to the roof.
      mb.frameBox(c, r, n, -W / 2, W / 2, y0, y0 + H, -0.25, -0.1);
      mb.frameBox(c, r, n, -W / 2, W / 2, y0 - 0.2, y0 - 0.05, -0.5, -0.3);
      for (let u = -W / 2 + 0.3; u <= W / 2 - 0.29; u += Math.max(1.6, (W - 0.6) / 4)) mb.frameBox(c, r, n, u - 0.08, u + 0.08, s.top - 1, y0 + H * 0.8, -0.5, -0.3);
      sb.sign = [b.id % 100000, floodlit(W)];
      signBox(sb, c, r, n, -W / 2, W / 2, y0, y0 + H, -0.1, 0.05, DISTRICT_BLANK, uv);
      floodlights(mb, c, r, n, -W / 2, W / 2, y0 + H + 0.35, 0.05);
    } else {
      // On the street face, flush; on another wall, on a frame standing 0.4 m off it (clear of wall-hung AC units
      // and pipes), with brackets back to the wall.
      const off = s.front ? 0.02 : 0.4;
      mb.color = STEEL;
      mb.frameBox(c, r, n, -W / 2 - 0.1, W / 2 + 0.1, y0 - 0.1, y0 + H + 0.1, off, off + 0.18);
      if (!s.front) for (const bu of [-W / 2 + 0.4, 0, W / 2 - 0.4]) for (const by of [y0 + 0.3, y0 + H - 0.3]) mb.frameBox(c, r, n, bu - 0.06, bu + 0.06, by - 0.06, by + 0.06, 0, off);
      sb.sign = [b.id % 100000, floodlit(W)];
      signBox(sb, c, r, n, -W / 2, W / 2, y0, y0 + H, off + 0.18, off + 0.26, DISTRICT_BLANK, uv);
      floodlights(mb, c, r, n, -W / 2, W / 2, y0 + H + 0.4, off + 0.26);
    }
    out?.push({ kind: s.kind === 'wall' && !s.front ? 'side' : s.kind, ad: s.ad, x: c[0], y: y0 + H / 2, z: c[2], nx: n[0], nz: n[2], view: s.view });
  }
}
