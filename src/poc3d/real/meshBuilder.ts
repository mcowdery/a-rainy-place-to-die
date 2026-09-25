import * as THREE from 'three';

/**
 * Surface kinds for the city material (city.ts). Stored in aFacade.w (+16 marks a building's street front).
 */
export const KIND = {
  /** Albedo only (parapets, rooftop gear, poles, balconies). */
  plain: 0,
  /** Building wall with the window/storefront pattern (aStyle, aFlags). */
  wall: 1,
  roof: 2,
  /** Emissive: colour is emission; aStyle.x = channel (EMIT). */
  emit: 3,
  asphalt: 7,
  sidewalk: 8,
  paint: 9,
  lot: 10,
} as const;

/** Emission channels for KIND.emit: always on, street lamps (atmosphere 'lamps'), neon (flickers, off by day). */
export const EMIT = { always: 0, lamp: 1, neon: 2 } as const;

export const FRONT = 16;

type V3 = readonly [number, number, number];

const UP: V3 = [0, 1, 0];
const cross = (a: V3, b: V3): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Append-only builder for one merged mesh with the city material's attributes, written straight into
 * growable typed arrays (much faster than BoxGeometry + mergeGeometries for thousands of small parts).
 *
 * Per vertex: position, normal, color (linear albedo, or emission for KIND.emit), aFacade (u, v, face width,
 * kind), aStyle (window style, see buildings.ts), aFlags, aBuilding (id). Set the "brush" (kind, colour,
 * style, id) with the fields below, then add shapes.
 *
 * Wall faces get facade coordinates: u in metres from the face's left edge as seen from outside (the right
 * direction is cross(up, normal)), v = world height, so window grids line up across a building's parts.
 */
export class MeshBuilder {
  /** Vertex capacity; every attribute array is sized from it. */
  private cap = 0;
  private pos = new Float32Array(0);
  private nor = new Float32Array(0);
  private col = new Float32Array(0);
  private fac = new Float32Array(0);
  private sty = new Float32Array(0);
  private flg = new Float32Array(0);
  private bid = new Float32Array(0);
  private idx = new Uint32Array(0);
  private nv = 0;
  private ni = 0;

  kind: number = KIND.plain;
  color: V3 = [0.5, 0.5, 0.5];
  style: readonly [number, number, number, number] = [0, 0, 0, 0];
  flags = 0;
  id = 0;
  /** Adds FRONT to the kind of wall faces facing this normal (set per building). */
  frontNormal: V3 | null = null;

  constructor(initialVertices = 8192) {
    this.resize(initialVertices);
    this.idx = new Uint32Array(initialVertices * 2);
  }

  get vertexCount(): number {
    return this.nv;
  }

  /** Empties the builder, keeping its buffers (reuse one builder for many meshes to avoid reallocating). */
  reset(): this {
    this.nv = 0;
    this.ni = 0;
    this.kind = KIND.plain;
    this.color = [0.5, 0.5, 0.5];
    this.style = [0, 0, 0, 0];
    this.flags = 0;
    this.id = 0;
    this.frontNormal = null;
    return this;
  }

  private resize(cap: number): void {
    const re = (a: Float32Array<ArrayBuffer>, k: number): Float32Array<ArrayBuffer> => {
      const b = new Float32Array(cap * k);
      b.set(a.subarray(0, Math.min(a.length, this.nv * k)));
      return b;
    };
    this.pos = re(this.pos, 3);
    this.nor = re(this.nor, 3);
    this.col = re(this.col, 3);
    this.fac = re(this.fac, 4);
    this.sty = re(this.sty, 4);
    this.flg = re(this.flg, 1);
    this.bid = re(this.bid, 1);
    this.cap = cap;
  }

  private grow(nv: number, ni: number): void {
    if (this.nv + nv > this.cap) this.resize(Math.max(this.nv + nv, this.cap * 2));
    if (this.ni + ni > this.idx.length) {
      const b = new Uint32Array(Math.max(this.ni + ni, this.idx.length * 2));
      b.set(this.idx.subarray(0, this.ni));
      this.idx = b;
    }
  }

  private vert(x: number, y: number, z: number, n: V3, u: number, v: number, faceW: number, kind: number): void {
    const i = this.nv++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.nor[i * 3] = n[0];
    this.nor[i * 3 + 1] = n[1];
    this.nor[i * 3 + 2] = n[2];
    this.col[i * 3] = this.color[0];
    this.col[i * 3 + 1] = this.color[1];
    this.col[i * 3 + 2] = this.color[2];
    this.fac[i * 4] = u;
    this.fac[i * 4 + 1] = v;
    this.fac[i * 4 + 2] = faceW;
    this.fac[i * 4 + 3] = kind;
    this.sty[i * 4] = this.style[0];
    this.sty[i * 4 + 1] = this.style[1];
    this.sty[i * 4 + 2] = this.style[2];
    this.sty[i * 4 + 3] = this.style[3];
    this.flg[i] = this.flags;
    this.bid[i] = this.id;
  }

  /**
   * A planar quad: corner c, spanning edge vectors a (the face's "right") and b (its "up"), normal a x b.
   * u/v: facade coordinates at c (u runs along a; v is world height). kind overrides the brush kind.
   */
  quad(c: V3, a: V3, b: V3, kind = this.kind, u0 = 0, faceW = -1): void {
    this.grow(4, 6);
    // Hot path: no allocations or spread calls.
    let nx = a[1] * b[2] - a[2] * b[1];
    let ny = a[2] * b[0] - a[0] * b[2];
    let nz = a[0] * b[1] - a[1] * b[0];
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const n = this.n3;
    n[0] = nx;
    n[1] = ny;
    n[2] = nz;
    let k: number = kind;
    const f = this.frontNormal;
    if (kind === KIND.wall && ny < 0.5 && ny > -0.5 && f && nx * f[0] + nz * f[2] > 0.9) k += FRONT;
    const aw = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
    const fw = faceW < 0 ? aw : faceW;
    const s = this.nv;
    this.vert(c[0], c[1], c[2], n, u0, c[1], fw, k);
    this.vert(c[0] + a[0], c[1] + a[1], c[2] + a[2], n, u0 + aw, c[1] + a[1], fw, k);
    this.vert(c[0] + a[0] + b[0], c[1] + a[1] + b[1], c[2] + a[2] + b[2], n, u0 + aw, c[1] + a[1] + b[1], fw, k);
    this.vert(c[0] + b[0], c[1] + b[1], c[2] + b[2], n, u0, c[1] + b[1], fw, k);
    const I = this.idx;
    const i = this.ni;
    I[i] = s;
    I[i + 1] = s + 1;
    I[i + 2] = s + 2;
    I[i + 3] = s;
    I[i + 4] = s + 2;
    I[i + 5] = s + 3;
    this.ni += 6;
  }

  private readonly n3: [number, number, number] = [0, 1, 0];

  /**
   * Axis-aligned box: centre (cx, cz), from y0 to y1, size w (x) by d (z). Walls use the brush kind and
   * get facade coordinates; the top uses topKind (roof by default); no bottom unless bottom = true.
   */
  box(cx: number, cz: number, y0: number, y1: number, w: number, d: number, topKind: number = this.kind === KIND.wall ? KIND.roof : this.kind, bottom = false): void {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    const h = y1 - y0;
    // Each wall starts at its left corner seen from outside; right = cross(up, n).
    this.quad([x0, y0, z1], [w, 0, 0], [0, h, 0]); // +z (south)
    this.quad([x1, y0, z0], [-w, 0, 0], [0, h, 0]); // -z (north)
    this.quad([x1, y0, z1], [0, 0, -d], [0, h, 0]); // +x (east)
    this.quad([x0, y0, z0], [0, 0, d], [0, h, 0]); // -x (west)
    this.quad([x0, y1, z1], [w, 0, 0], [0, 0, -d], topKind);
    if (bottom) this.quad([x0, y0, z0], [w, 0, 0], [0, 0, d], this.kind);
  }

  /** A box oriented by a facade frame: origin p on the face, right r, outward n (unit, horizontal). */
  frameBox(p: V3, r: V3, n: V3, u0: number, u1: number, y0: number, y1: number, out0: number, out1: number, topKind: number = this.kind): void {
    const cx = p[0] + r[0] * (u0 + u1) / 2 + n[0] * (out0 + out1) / 2;
    const cz = p[2] + r[2] * (u0 + u1) / 2 + n[2] * (out0 + out1) / 2;
    const along = Math.abs(u1 - u0);
    const depth = Math.abs(out1 - out0);
    const w = Math.abs(r[0]) > 0.5 ? along : depth;
    const d = Math.abs(r[0]) > 0.5 ? depth : along;
    this.box(cx, cz, y0, y1, w, d, topKind, y0 > 0.3);
  }

  /** Vertical cylinder (open bottom), n segments; wall kind uses the brush. */
  cylinder(cx: number, cz: number, y0: number, y1: number, r: number, n = 8, cap = true): void {
    const h = y1 - y0;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const p0: V3 = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r];
      const p1: V3 = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
      // Winding: edge p1 -> p0 then up gives an outward normal.
      this.quad(p1, [p0[0] - p1[0], 0, p0[2] - p1[2]], [0, h, 0]);
    }
    if (cap) {
      this.grow(n + 1, n * 3);
      const s = this.nv;
      const k = this.kind === KIND.wall ? KIND.roof : this.kind;
      this.vert(cx, y1, cz, UP, 0, y1, 0, k);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        this.vert(cx + Math.cos(a) * r, y1, cz + Math.sin(a) * r, UP, 0, y1, 0, k);
      }
      for (let i = 0; i < n; i++) {
        this.idx[this.ni + i * 3] = s;
        this.idx[this.ni + i * 3 + 1] = s + 1 + ((i + 1) % n);
        this.idx[this.ni + i * 3 + 2] = s + 1 + i;
      }
      this.ni += n * 3;
    }
  }

  /** A general quad p0 -> p1 -> p2 -> p3 (counter-clockwise seen from the front). */
  poly4(p0: V3, p1: V3, p2: V3, p3: V3): void {
    this.grow(4, 6);
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const n = this.n3;
    n[0] = nx;
    n[1] = ny;
    n[2] = nz;
    const s = this.nv;
    this.vert(p0[0], p0[1], p0[2], n, 0, p0[1], 0, this.kind);
    this.vert(p1[0], p1[1], p1[2], n, 0, p1[1], 0, this.kind);
    this.vert(p2[0], p2[1], p2[2], n, 0, p2[1], 0, this.kind);
    this.vert(p3[0], p3[1], p3[2], n, 0, p3[1], 0, this.kind);
    const I = this.idx;
    const i = this.ni;
    I[i] = s;
    I[i + 1] = s + 1;
    I[i + 2] = s + 2;
    I[i + 3] = s;
    I[i + 4] = s + 2;
    I[i + 5] = s + 3;
    this.ni += 6;
  }

  /** A solid of revolution around a vertical axis from (y, radius) rings, bottom to top; flat-shaded. */
  lathe(cx: number, cz: number, rings: readonly (readonly [number, number])[], n = 7): void {
    const P = (a: number, y: number, r: number): V3 => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    for (let k = 0; k + 1 < rings.length; k++) {
      const [y0, r0] = rings[k];
      const [y1, r1] = rings[k + 1];
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        this.poly4(P(a1, y0, r0), P(a0, y0, r0), P(a0, y1, r1), P(a1, y1, r1));
      }
    }
  }

  /** A thin square prism between two arbitrary points (wires, cables, diagonal braces). No end caps. */
  beam(a: V3, b: V3, t: number): void {
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    if (len < 1e-4) return;
    const dir: V3 = [d[0] / len, d[1] / len, d[2] / len];
    const ref: V3 = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : UP;
    const s1 = cross(dir, ref);
    const l1 = Math.sqrt(s1[0] * s1[0] + s1[1] * s1[1] + s1[2] * s1[2]);
    const e1: V3 = [(s1[0] / l1) * t, (s1[1] / l1) * t, (s1[2] / l1) * t];
    const s2 = cross(dir, e1);
    const l2 = Math.sqrt(s2[0] * s2[0] + s2[1] * s2[1] + s2[2] * s2[2]);
    const e2: V3 = [(s2[0] / l2) * t, (s2[1] / l2) * t, (s2[2] / l2) * t];
    const o: V3 = [a[0] - (e1[0] + e2[0]) / 2, a[1] - (e1[1] + e2[1]) / 2, a[2] - (e1[2] + e2[2]) / 2];
    const add = (p: V3, q: V3): V3 => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
    // (edge, d) ordering makes each face's normal point away from the prism's axis.
    this.quad(o, e1, d);
    this.quad(add(o, e1), e2, d);
    this.quad(add(add(o, e1), e2), [-e1[0], -e1[1], -e1[2]], d);
    this.quad(add(o, e2), [-e2[0], -e2[1], -e2[2]], d);
  }

  /** The finished geometry, translated by (-ox, 0, -oz), or null if nothing was added. */
  build(ox = 0, oz = 0): THREE.BufferGeometry | null {
    if (this.nv === 0) return null;
    const g = new THREE.BufferGeometry();
    const p = this.pos.slice(0, this.nv * 3);
    for (let i = 0; i < this.nv; i++) {
      p[i * 3] -= ox;
      p[i * 3 + 2] -= oz;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, this.nv * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.nv * 3), 3));
    g.setAttribute('aFacade', new THREE.BufferAttribute(this.fac.slice(0, this.nv * 4), 4));
    g.setAttribute('aStyle', new THREE.BufferAttribute(this.sty.slice(0, this.nv * 4), 4));
    g.setAttribute('aFlags', new THREE.BufferAttribute(this.flg.slice(0, this.nv), 1));
    g.setAttribute('aBuilding', new THREE.BufferAttribute(this.bid.slice(0, this.nv), 1));
    g.setIndex(new THREE.BufferAttribute(this.idx.slice(0, this.ni), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  get triangles(): number {
    return this.ni / 3;
  }
}

const linCache = new Map<number, [number, number, number]>();

/** sRGB hex -> linear [r, g, b] (cached; treat the result as read-only). */
export function lin(hex: number): [number, number, number] {
  let v = linCache.get(hex);
  if (!v) {
    const c = new THREE.Color().setHex(hex);
    v = [c.r, c.g, c.b];
    linCache.set(hex, v);
  }
  return v;
}

export const scale3 = (c: V3, k: number): [number, number, number] => [c[0] * k, c[1] * k, c[2] * k];
