import { hash, rng } from '../../core/hash';
import { frontSpan, type Building3, type Sign3 } from '../district/plan';
import { DISTRICT_ADS } from '../models/ads';
import { FH, frontFrame, GF, styleFor, tierFront, tiers, WIN } from './buildings';
import { EMIT, KIND, lin, type MeshBuilder } from './meshBuilder';
import { propDist, type Prop } from './props';
import { ALWAYS_SEEN, type Sightline } from './sightline';
import { hasRooftopLetters, signBox, type SignBuilder } from './signs';

/**
 * District photo ads in the world (pure layout and placement, so the chunk workers build them):
 * - rooftop billboards: a lit 2:1 panel on a steel frame near the front edge of taller buildings, with
 *   floodlight arms above it;
 * - facade billboards: a 2:1 panel on the upper front of mid-rise buildings;
 * - street posters: 2:3 lightbox posters on shopfronts at eye level.
 * Everything is a pure function of the building (id-seeded), like the rest of the city. The texture is
 * DistrictAdAtlas (adAtlas.ts), which follows the layout below.
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
  readonly kind: 'rooftop' | 'wall' | 'poster';
  readonly ad: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly nx: number;
  readonly nz: number;
}

type Entry = (typeof BILLBOARDS)[number];

/**
 * An ad for a building: by its zone's category weights (content/world3d/zones/*.yaml), among the categories
 * that have ads in this format; any ad, uniformly, outside zones.
 */
function pickAd(list: readonly Entry[], b: Building3, salt: number): Entry | undefined {
  if (list.length === 0) return undefined;
  const weights = b.zone ? Object.entries(b.zone.ads) : [];
  const cats = weights.filter(([c]) => list.some((e) => e.a.cat === c));
  if (cats.length === 0) return list[hash(b.id, salt) % list.length];
  const total = cats.reduce((t, [, w]) => t + w, 0);
  let r = (hash(b.id, salt, 0xca7) / 0x100000000) * total;
  let cat = cats[0][0];
  for (const [c, w] of cats) if ((r -= w) < 0) {
    cat = c;
    break;
  }
  const pool = list.filter((e) => e.a.cat === cat);
  return pool[hash(b.id, salt) % pool.length];
}

/** Adds a chunk's district ads: panels into sb (ad atlas material), frames and lamps into mb. */
export function addDistrictAds(
  sb: SignBuilder,
  mb: MeshBuilder,
  buildings: readonly Building3[],
  signs: readonly Sign3[],
  props: readonly Prop[],
  out?: AdPlacement[],
  seen: Sightline = ALWAYS_SEEN,
): void {
  if (BILLBOARDS.length === 0 && POSTERS.length === 0) return;
  for (const b of buildings) {
    if (b.hue !== undefined) continue; // stamps are hand-dressed
    const rnd = rng(hash(b.id, 0xad5));
    const f = frontFrame(b);
    // The part of the street face clear of a corner cut.
    const [s0, s1] = frontSpan(b);
    const billboard = pickAd(BILLBOARDS, b, 1);
    const poster = pickAd(POSTERS, b, 2);
    // Billboards only where they can be seen from the street (a junction, a square, a street running away
    // from them, lower roofs across the way); where they can, they're more likely than before.
    const rooftop = b.h >= 15 && !hasRooftopLetters(b, seen) && rnd.chance(0.45) && seen(b, b.h + 4);
    // Not on balcony fronts (the slabs stick out 1.15 m, through the panel).
    const wall = !rooftop && b.h >= 15 && rnd.chance(0.3) && styleFor(b).type !== WIN.balcony && seen(b, GF + FH * 1.2 + 3);
    const street = rnd.chance(0.35);

    if (rooftop && billboard) {
      const ts = tiers(b);
      const tt = ts[ts.length - 1];
      const top = tt[3] + styleFor(b).parapet;
      const tf = tierFront(b, tt);
      const inset = tf.inset + 1.0;
      // Centred on the face, clear of a corner cut when the top is the cut tier.
      const mid = ts.length === 1 ? (s0 + s1) / 2 : f.fw / 2;
      const W = Math.min(14, (ts.length === 1 ? s1 - s0 : tf.fw) * 0.85);
      const H = W / 2;
      if (W > 3) {
        const centre: C3 = [f.p[0] + f.r[0] * mid - f.n[0] * inset, 0, f.p[2] + f.r[2] * mid - f.n[2] * inset];
        const base = top + 1.2;
        mb.kind = KIND.plain;
        mb.color = STEEL;
        mb.style = [0, 0, 0, 0];
        // Backing box, two rails and posts down to the roof.
        mb.frameBox(centre, f.r, f.n, -W / 2, W / 2, base, base + H, -0.25, -0.1);
        mb.frameBox(centre, f.r, f.n, -W / 2, W / 2, base - 0.2, base - 0.05, -0.5, -0.3);
        for (let u = -W / 2 + 0.3; u <= W / 2 - 0.29; u += Math.max(1.6, (W - 0.6) / 4)) mb.frameBox(centre, f.r, f.n, u - 0.08, u + 0.08, top - 1, base + H * 0.8, -0.5, -0.3);
        sb.ink = [1, 1, 1];
        sb.plate = [0, 0, 0];
        sb.sign = [b.id % 100000, floodlit(W)];
        signBox(sb, centre, f.r, f.n, -W / 2, W / 2, base, base + H, -0.1, 0.05, DISTRICT_BLANK, { n: districtAdUv(billboard.i) });
        floodlights(mb, centre, f.r, f.n, -W / 2, W / 2, base + H + 0.35, 0.05);
        out?.push({ kind: 'rooftop', ad: billboard.i, x: centre[0], y: base + H / 2, z: centre[2], nx: f.n[0], nz: f.n[2] });
      }
    } else if (wall && billboard) {
      // Upper front, clear of blade signs on this facade and below the parapet.
      const hasBlade = signs.some((s) => s.vertical && Math.abs(s.x - (f.p[0] + f.r[0] * (f.fw / 2))) < f.fw / 2 + 1 && Math.abs(s.z - (f.p[2] + f.r[2] * (f.fw / 2))) < f.fw / 2 + 1);
      const W = Math.min(12, (s1 - s0) * 0.8);
      const H = W / 2;
      const y0 = GF + FH * 1.2;
      // Stand clear of curtain-wall fins (0.3 m) and ribbon-window lips.
      const off = styleFor(b).type === WIN.curtain ? 0.34 : 0.02;
      if (!hasBlade && W > 3 && y0 + H < b.h - 1) {
        const centre: C3 = [f.p[0] + f.r[0] * ((s0 + s1) / 2), 0, f.p[2] + f.r[2] * ((s0 + s1) / 2)];
        mb.kind = KIND.plain;
        mb.color = STEEL;
        mb.style = [0, 0, 0, 0];
        mb.frameBox(centre, f.r, f.n, -W / 2 - 0.1, W / 2 + 0.1, y0 - 0.1, y0 + H + 0.1, off, off + 0.18);
        sb.ink = [1, 1, 1];
        sb.plate = [0, 0, 0];
        sb.sign = [b.id % 100000, floodlit(W)];
        signBox(sb, centre, f.r, f.n, -W / 2, W / 2, y0, y0 + H, off + 0.18, off + 0.26, DISTRICT_BLANK, { n: districtAdUv(billboard.i) });
        floodlights(mb, centre, f.r, f.n, -W / 2, W / 2, y0 + H + 0.4, off + 0.26);
        out?.push({ kind: 'wall', ad: billboard.i, x: centre[0], y: y0 + H / 2, z: centre[2], nx: f.n[0], nz: f.n[2] });
      }
    }

    if (street && poster && s1 - s0 > 3.5) {
      // Just inside one of the storefront's pillars, on the side away from any vending machines or pots.
      const pw = 0.92;
      const at = (u: number): [number, number] => [f.p[0] + f.r[0] * u, f.p[2] + f.r[2] * u];
      const blocked = (u: number): boolean => props.some((q) => (q.kind === 'vending' || q.kind === 'pots') && propDist(q, at(u)[0], at(u)[1]) < 1.3);
      const options = rnd.chance(0.5) ? [s1 - 0.4 - pw / 2, s0 + 0.4 + pw / 2] : [s0 + 0.4 + pw / 2, s1 - 0.4 - pw / 2];
      const u = options.find((x) => !blocked(x));
      if (u !== undefined) {
        const centre: C3 = [at(u)[0], 0, at(u)[1]];
        mb.kind = KIND.plain;
        mb.color = lin(0xb8b8b8);
        mb.style = [0, 0, 0, 0];
        mb.frameBox(centre, f.r, f.n, -pw / 2 - 0.04, pw / 2 + 0.04, 0.46, 1.84 + 0.04, 0.01, 0.08);
        sb.ink = [1, 1, 1];
        sb.plate = [0, 0, 0];
        sb.sign = [b.id % 100000, 1];
        signBox(sb, centre, f.r, f.n, -pw / 2, pw / 2, 0.5, 0.5 + pw * 1.5, 0.08, 0.1, DISTRICT_BLANK, { n: districtAdUv(poster.i) });
        out?.push({ kind: 'poster', ad: poster.i, x: centre[0], y: 1.2, z: centre[2], nx: f.n[0], nz: f.n[2] });
      }
    }
  }
}
