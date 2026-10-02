/**
 * The physical sky (level 2 of the dynamic sky): what the clear sky looks like from the city for any height of the
 * sun, computed once at startup and looked up after. Single scattering through a spherical atmosphere over a
 * spherical Earth: air (Rayleigh: the blue, the reddening toward the horizon and at sunset), haze (Mie: the bright
 * glow round the sun) and the ozone layer (which absorbs orange and keeps the twilight sky blue rather than grey),
 * with the Earth's shadow, so the sky after sunset is lit only from high up and darkens from the east. Numbers from
 * Hillaire 2020 / Bruneton 2017.
 *
 * The table is SKY_SUN slices (sun heights from SUN_MIN, below the horizon, to overhead, closer together near the
 * horizon), each SKY_EL x SKY_AZ directions: elevation from EL_MIN to straight up (closer together near the horizon)
 * and azimuth from toward the sun to away from it (the sky is symmetric about the sun's azimuth). Radiance is scaled
 * so the noon zenith matches the atmosphere's day sky, and partly adapted to the light (an eye adjusting at dusk:
 * ADAPT), so sunsets and the blue hour stay readable. Pure: the sky shader (real/sky.ts) gets a slice as a texture,
 * main.ts takes the light's colours from the same slice.
 */

export const SKY_AZ = 32;
export const SKY_EL = 32;
export const SKY_SUN = 48;
/** The lowest sun in the table (radians below the horizon): the sky is black by then. */
export const SUN_MIN = -0.35;
/** The lowest view direction in the table: a little below the horizon (the sea and land fade into it). */
export const EL_MIN = -0.1;
/** How far the sky's brightness is adapted to: 0 none (physical), 1 every sky as bright as noon's. */
export const ADAPT = 0.72;

const R = 6360e3;
const TOP = 6460e3;
const VIEW_H = 200;
const RAY = [5.802e-6, 13.558e-6, 33.1e-6];
const RAY_H = 8000;
// (Haze: a city's, about twice Hillaire's clear-day defaults.)
const MIE_S = 7.2e-6;
const MIE_E = 8e-6;
const MIE_H = 1200;
const MIE_G = 0.76;
const OZONE = [0.65e-6, 1.881e-6, 0.085e-6];
const PRIMARY = 24;
const LIGHT = 8;
/** The ground's albedo for light bounced back up into the air (city and sea). */
const GROUND = 0.15;
/** The multiple-scattering table: heights, and the sun's angle there; directions summed over at each. */
const MS_H = 16;
const MS_MU = 24;
const MS_DIRS = 64;

/** The table's v (0-1) for an elevation, and back. */
export const elToV = (el: number): number => Math.sqrt(Math.max(0, Math.min(1, (el - EL_MIN) / (Math.PI / 2 - EL_MIN))));
const vToEl = (v: number): number => EL_MIN + (Math.PI / 2 - EL_MIN) * v * v;
/** A slice's index (fractional) for a sun height, and back: even steps in the sine, so close together near the horizon. */
const sunToS = (el: number): number => ((Math.sin(Math.max(SUN_MIN, Math.min(Math.PI / 2, el))) - Math.sin(SUN_MIN)) / (1 - Math.sin(SUN_MIN))) * (SKY_SUN - 1);
const sToSun = (s: number): number => Math.asin(Math.sin(SUN_MIN) + (s / (SKY_SUN - 1)) * (1 - Math.sin(SUN_MIN)));

/** Distance along a ray from `o` (|o| from the centre) in direction `d` to a sphere of radius r, or -1. */
function sphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, r: number): number {
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - c;
  if (h < 0) return -1;
  const s = Math.sqrt(h);
  if (-b - s > 0) return -b - s;
  if (-b + s > 0) return -b + s;
  return -1;
}

/** Air, haze and ozone densities at a height (m). */
function densities(h: number, out: number[]): void {
  out[0] = Math.exp(-h / RAY_H);
  out[1] = Math.exp(-h / MIE_H);
  out[2] = Math.max(0, 1 - Math.abs(h - 25e3) / 15e3);
}

/** The sunlight reaching a point (transmittance toward the sun, per channel), or false in the Earth's shadow. */
function sunlight(px: number, py: number, pz: number, sx: number, sy: number, sz: number, n: number, out: number[]): boolean {
  if (sphere(px, py, pz, sx, sy, sz, R) > 0) return false;
  const step = sphere(px, py, pz, sx, sy, sz, TOP) / n;
  let lR = 0;
  let lM = 0;
  let lO = 0;
  const d = [0, 0, 0];
  for (let j = 0; j < n; j++) {
    const t = (j + 0.5) * step;
    densities(Math.hypot(px + sx * t, py + sy * t, pz + sz * t) - R, d);
    lR += d[0] * step;
    lM += d[1] * step;
    lO += d[2] * step;
  }
  for (let c = 0; c < 3; c++) out[c] = Math.exp(-(RAY[c] * lR + MIE_E * lM + OZONE[c] * lO));
  return true;
}

/**
 * Multiple scattering (Hillaire 2020, 5.5): for a height and the sun's angle there, the light scattered more than
 * once that reaches a point from all round, per unit of scattering there: the second-order light from every
 * direction (and off the ground), summed as a geometric series over all orders (isotropic). It whitens the horizon
 * by day and keeps the twilight sky blue; single scattering alone leaves them olive and magenta.
 */
class MultiScatter {
  readonly table = new Float32Array(MS_H * MS_MU * 3);

  constructor() {
    const dirs: number[][] = [];
    for (let i = 0; i < MS_DIRS; i++) {
      // Even over the sphere (a Fibonacci spiral).
      const y = 1 - (2 * (i + 0.5)) / MS_DIRS;
      const r = Math.sqrt(1 - y * y);
      const a = i * 2.399963;
      dirs.push([Math.cos(a) * r, y, Math.sin(a) * r]);
    }
    const dens = [0, 0, 0];
    const sun = [0, 0, 0];
    for (let hi = 0; hi < MS_H; hi++) {
      const h = (hi / (MS_H - 1)) ** 2 * (TOP - R - 100) + 50;
      const oy = R + h;
      for (let mi = 0; mi < MS_MU; mi++) {
        const mu = -1 + (2 * mi) / (MS_MU - 1);
        const sx = Math.sqrt(1 - mu * mu);
        const sy = mu;
        const L = [0, 0, 0];
        const F = [0, 0, 0];
        for (const [dx, dy, dz] of dirs) {
          const tg = sphere(0, oy, 0, dx, dy, dz, R);
          const tMax = tg > 0 ? tg : sphere(0, oy, 0, dx, dy, dz, TOP);
          const n = 16;
          const dt = tMax / n;
          const thr = [1, 1, 1];
          for (let i = 0; i < n; i++) {
            const t = (i + 0.5) * dt;
            const px = dx * t;
            const py = oy + dy * t;
            const pz = dz * t;
            densities(Math.hypot(px, py, pz) - R, dens);
            const lit = sunlight(px, py, pz, sx, sy, 0, 6, sun);
            for (let c = 0; c < 3; c++) {
              const ss = RAY[c] * dens[0] + MIE_S * dens[1];
              const st = RAY[c] * dens[0] + MIE_E * dens[1] + OZONE[c] * dens[2];
              const tr = Math.exp(-st * dt);
              const k = st > 0 ? (1 - tr) / st : dt;
              if (lit) L[c] += (thr[c] * sun[c] * ss * k) / (4 * Math.PI);
              F[c] += thr[c] * ss * k;
              thr[c] *= tr;
            }
          }
          // Light bounced off the ground below.
          if (tg > 0) {
            const gx = dx * tg;
            const gy = oy + dy * tg;
            const gz = dz * tg;
            const gl = Math.hypot(gx, gy, gz);
            const cos = (gx * sx + gy * sy) / gl;
            if (cos > 0 && sunlight(gx * 1.000001, gy * 1.000001, gz * 1.000001, sx, sy, 0, 6, sun)) for (let c = 0; c < 3; c++) L[c] += (thr[c] * sun[c] * cos * GROUND) / Math.PI;
          }
        }
        // The second order averaged over all directions (the isotropic phase), and the share scattered on again.
        for (let c = 0; c < 3; c++) this.table[(hi * MS_MU + mi) * 3 + c] = L[c] / MS_DIRS / Math.max(0.05, 1 - F[c] / MS_DIRS);
      }
    }
  }

  /** The multiple-scattering light at a height for the sun's angle there (cosine). */
  at(h: number, mu: number, out: number[]): void {
    const hv = Math.sqrt(Math.max(0, Math.min(1, (h - 50) / (TOP - R - 100)))) * (MS_H - 1);
    const mv = ((Math.max(-1, Math.min(1, mu)) + 1) / 2) * (MS_MU - 1);
    const h0 = Math.min(MS_H - 2, Math.floor(hv));
    const m0 = Math.min(MS_MU - 2, Math.floor(mv));
    const fh = hv - h0;
    const fm = mv - m0;
    for (let c = 0; c < 3; c++) {
      const p = (a: number, b: number): number => this.table[(a * MS_MU + b) * 3 + c];
      out[c] = (p(h0, m0) * (1 - fm) + p(h0, m0 + 1) * fm) * (1 - fh) + (p(h0 + 1, m0) * (1 - fm) + p(h0 + 1, m0 + 1) * fm) * fh;
    }
  }
}

/** Radiance (unscaled) seen from the city in a direction, with the sun at `sunEl`. */
function radiance(ms: MultiScatter, sunEl: number, el: number, az: number, out: number[]): void {
  const sx = Math.cos(sunEl);
  const sy = Math.sin(sunEl);
  const dx = Math.cos(el) * Math.cos(az);
  const dy = Math.sin(el);
  const dz = Math.cos(el) * Math.sin(az);
  const oy = R + VIEW_H;
  const tTop = sphere(0, oy, 0, dx, dy, dz, TOP);
  const tGround = sphere(0, oy, 0, dx, dy, dz, R);
  const tMax = tGround > 0 ? tGround : tTop;
  const mu = dx * sx + dy * sy;
  const phaseR = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const g2 = MIE_G * MIE_G;
  const phaseM = ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + mu * mu))) / ((2 + g2) * Math.pow(1 + g2 - 2 * MIE_G * mu, 1.5));
  let odR = 0;
  let odM = 0;
  let odO = 0;
  const acc = [0, 0, 0];
  const dens = [0, 0, 0];
  const sun = [0, 0, 0];
  const msl = [0, 0, 0];
  for (let i = 0; i < PRIMARY; i++) {
    // Samples closer together near the viewer, where the air is thickest.
    const f = (i + 0.5) / PRIMARY;
    const t = tMax * f * f;
    const ds = tMax * ((i + 1) / PRIMARY) ** 2 - tMax * (i / PRIMARY) ** 2;
    const px = dx * t;
    const py = oy + dy * t;
    const pz = dz * t;
    const pl = Math.hypot(px, py, pz);
    densities(pl - R, dens);
    odR += dens[0] * ds;
    odM += dens[1] * ds;
    odO += dens[2] * ds;
    // Sunlight scattered once toward us (none in the Earth's shadow), and the light scattered many times, which
    // reaches even the shadowed air.
    const lit = sunlight(px, py, pz, sx, sy, 0, LIGHT, sun);
    ms.at(pl - R, (px * sx + py * sy) / pl, msl);
    for (let c = 0; c < 3; c++) {
      const view = Math.exp(-(RAY[c] * odR + MIE_E * odM + OZONE[c] * odO));
      const single = lit ? sun[c] * (RAY[c] * dens[0] * phaseR + MIE_S * dens[1] * phaseM) : 0;
      const multi = msl[c] * (RAY[c] * dens[0] + MIE_S * dens[1]);
      acc[c] += view * (single + multi) * ds;
    }
  }
  for (let c = 0; c < 3; c++) out[c] = acc[c];
}

/** The sun's colour from the city (what's left of white sunlight through the air toward it). */
function sunTransmittance(sunEl: number, out: number[]): void {
  if (!sunlight(0, R + VIEW_H, 0, Math.cos(sunEl), Math.sin(sunEl), 0, 32, out)) out[0] = out[1] = out[2] = 0;
}

const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** The atmosphere's base day sky at the zenith ('#3f78c0'), linear: what the noon zenith is scaled to. */
const NOON_ZENITH = lum(0.0497, 0.1845, 0.5271);

export interface SkyStats {
  /** Straight up. */
  readonly zenith: [number, number, number];
  /** Along the horizon, averaged all the way round. */
  readonly horizon: [number, number, number];
  /** The whole sky above the horizon, as it lights the ground (cosine-weighted). */
  readonly fill: [number, number, number];
  /** The sun's colour (transmittance; black once it's set). */
  readonly sun: [number, number, number];
}

export class SkyModel {
  /** Radiance per slice, elevation and azimuth (RGB), scaled and adapted. */
  readonly data: Float32Array;
  /** The sun's colour per slice. */
  readonly sun: Float32Array;

  /**
   * Computes the table (about a second: real/skyWorker.ts does it off the main thread), or takes one already
   * computed (the worker's).
   */
  constructor(built?: { data: Float32Array; sun: Float32Array }) {
    const n = SKY_AZ * SKY_EL;
    if (built) {
      this.data = built.data;
      this.sun = built.sun;
      return;
    }
    this.data = new Float32Array(SKY_SUN * n * 3);
    this.sun = new Float32Array(SKY_SUN * 3);
    const rgb = [0, 0, 0];
    const avg = new Float64Array(SKY_SUN);
    const ms = new MultiScatter();
    for (let s = 0; s < SKY_SUN; s++) {
      const sunEl = sToSun(s);
      let sum = 0;
      let w = 0;
      for (let e = 0; e < SKY_EL; e++) {
        const el = vToEl(e / (SKY_EL - 1));
        for (let a = 0; a < SKY_AZ; a++) {
          radiance(ms, sunEl, el, (a / (SKY_AZ - 1)) * Math.PI, rgb);
          const i = (s * n + e * SKY_AZ + a) * 3;
          this.data[i] = rgb[0];
          this.data[i + 1] = rgb[1];
          this.data[i + 2] = rgb[2];
          if (el > 0) {
            const k = Math.cos(el);
            sum += lum(rgb[0], rgb[1], rgb[2]) * k;
            w += k;
          }
        }
      }
      avg[s] = sum / w;
      sunTransmittance(sunEl, rgb);
      this.sun.set(rgb, s * 3);
    }
    // Scale: the noon zenith to the day sky's; then each slice brought part of the way toward noon's brightness.
    const top = SKY_SUN - 1;
    const zi = (top * n + (SKY_EL - 1) * SKY_AZ) * 3;
    const k = NOON_ZENITH / lum(this.data[zi], this.data[zi + 1], this.data[zi + 2]);
    for (let s = 0; s < SKY_SUN; s++) {
      const adapt = Math.min(400, Math.pow(Math.max(avg[s], 1e-12) / avg[top], -ADAPT));
      const m = k * adapt;
      for (let i = s * n * 3; i < (s + 1) * n * 3; i++) this.data[i] *= m;
    }
  }

  /** A slice for a sun height, interpolated between the two nearest, as RGBA rows (SKY_EL rows of SKY_AZ). */
  slice(sunEl: number, out: Float32Array = new Float32Array(SKY_AZ * SKY_EL * 4)): Float32Array {
    const f = sunToS(sunEl);
    const s0 = Math.min(SKY_SUN - 2, Math.floor(f));
    const t = Math.min(1, f - s0);
    const n = SKY_AZ * SKY_EL;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) out[i * 4 + c] = this.data[(s0 * n + i) * 3 + c] * (1 - t) + this.data[((s0 + 1) * n + i) * 3 + c] * t;
      out[i * 4 + 3] = 1;
    }
    return out;
  }

  /** The sky in one direction (elevation, and azimuth from the sun's: 0 toward it, π away), from a slice. */
  static at(slice: Float32Array, el: number, az: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
    const v = elToV(el) * (SKY_EL - 1);
    const u = (Math.min(Math.PI, Math.abs(az)) / Math.PI) * (SKY_AZ - 1);
    const e0 = Math.min(SKY_EL - 2, Math.floor(v));
    const a0 = Math.min(SKY_AZ - 2, Math.floor(u));
    const fe = v - e0;
    const fa = u - a0;
    for (let c = 0; c < 3; c++) {
      const p = (e: number, a: number): number => slice[(e * SKY_AZ + a) * 4 + c];
      out[c] = (p(e0, a0) * (1 - fa) + p(e0, a0 + 1) * fa) * (1 - fe) + (p(e0 + 1, a0) * (1 - fa) + p(e0 + 1, a0 + 1) * fa) * fe;
    }
    return out;
  }

  /** The colours the light takes from a slice: zenith, horizon, the fill over the ground, and the sun's. */
  stats(sunEl: number, slice: Float32Array): SkyStats {
    const zenith = SkyModel.at(slice, Math.PI / 2, 0);
    const horizon: [number, number, number] = [0, 0, 0];
    const fill: [number, number, number] = [0, 0, 0];
    const tmp: [number, number, number] = [0, 0, 0];
    for (let a = 0; a < SKY_AZ; a++) {
      SkyModel.at(slice, 0.03, (a / (SKY_AZ - 1)) * Math.PI, tmp);
      for (let c = 0; c < 3; c++) horizon[c] += tmp[c] / SKY_AZ;
    }
    let w = 0;
    for (let e = 1; e <= 8; e++) {
      const el = (e / 8) * (Math.PI / 2) * 0.95;
      const k = Math.sin(el) * Math.cos(el);
      for (let a = 0; a < 8; a++) {
        SkyModel.at(slice, el, (a / 7) * Math.PI, tmp);
        for (let c = 0; c < 3; c++) fill[c] += tmp[c] * k;
        w += k;
      }
    }
    for (let c = 0; c < 3; c++) fill[c] /= w;
    const f = sunToS(sunEl);
    const s0 = Math.min(SKY_SUN - 2, Math.floor(f));
    const t = Math.min(1, f - s0);
    const sun: [number, number, number] = [0, 1, 2].map((c) => this.sun[s0 * 3 + c] * (1 - t) + this.sun[(s0 + 1) * 3 + c] * t) as [number, number, number];
    return { zenith, horizon, fill, sun };
  }
}
