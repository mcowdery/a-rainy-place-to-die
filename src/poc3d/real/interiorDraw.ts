import * as THREE from 'three';
import { Kit, text } from './kit';
import { toWorld, type LocalFrame } from './localFrame';
import { EMIT, KIND, lin } from './meshBuilder';

export type C3 = [number, number, number];

/** Drawing helpers over a Kit for interiors: surfaces under their own light (self-lit, so they work below ground too), people on the floor being furnished. */
export class Draw {
  readonly f: LocalFrame;
  /** The floor being furnished (people stand on it). */
  level = 0;
  private seed = 0x2f6e2b1;
  constructor(readonly k: Kit) {
    this.f = k.f;
  }
  rnd(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rnd() * xs.length)];
  }
  W(hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, bottom = false): void {
    this.k.lit(hex, u0, u1, t0, t1, y0, y1, true, bottom);
  }
  glow(rgb: C3, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, ch: number = EMIT.always): void {
    this.k.glow(rgb, u0, u1, t0, t1, y0, y1, ch);
  }
  P(u: number, t: number, y: number): [number, number, number] {
    const [x, z] = toWorld(this.f, u, t);
    return [x, y, z];
  }
  /** A self-lit quad, both sides. */
  quad(hex: number, a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number]): void {
    const mb = this.k.mb;
    mb.kind = KIND.emit;
    mb.style = [EMIT.interior, 0, 0, 0];
    mb.color = lin(hex);
    mb.poly4(a, b, c, d);
    mb.poly4(b, a, d, c);
    mb.style = [0, 0, 0, 0];
  }
  /** A self-lit round form (rings of [y, radius]); ch EMIT.always makes it glow. */
  lathe(hex: number, u: number, t: number, rings: readonly (readonly [number, number])[], n = 10, ch: number = EMIT.interior, rgb?: C3): void {
    const mb = this.k.mb;
    mb.kind = KIND.emit;
    mb.style = [ch, 0, 0, 0];
    mb.color = rgb ?? lin(hex);
    const [x, z] = toWorld(this.f, u, t);
    mb.lathe(x, z, rings, n);
    mb.style = [0, 0, 0, 0];
  }
  ball(hex: number, u: number, t: number, y: number, r: number, n = 8): void {
    this.lathe(hex, u, t, [[y, 0.001], [y + r * 0.3, r * 0.75], [y + r, r], [y + r * 1.7, r * 0.75], [y + r * 2, 0.001]], n);
  }
  /** A sign canvas: a main line and a smaller one under it. */
  sign(main: string, sub: string, bg: string, fg: string, pw = 512, ph = 160, serif = true): THREE.Texture {
    return this.k.canvas(pw, ph, (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, pw, ph);
      const fam = serif ? "'Yu Mincho', 'MS Mincho', 'Times New Roman', serif" : "'Yu Gothic', 'Meiryo', 'Segoe UI', sans-serif";
      const big = Math.round(ph * (sub ? 0.44 : 0.56));
      g.font = `bold ${big}px ${fam}`;
      const scale = Math.min(1, (pw * 0.9) / Math.max(1, g.measureText(main).width));
      text(g, main, pw / 2, sub ? ph * 0.4 : ph * 0.52, `bold ${Math.floor(big * scale)}px ${fam}`, fg);
      if (sub) text(g, sub, pw / 2, ph * 0.8, `${Math.round(ph * 0.16)}px ${fam}`, fg);
    });
  }
  /** A ghost shopper (or staff) at local (u, t) facing (du, dt). */
  person(u: number, t: number, du: number, dt: number, spec: Parameters<Kit['person']>[4] = {}): void {
    this.k.person(u, t, du, dt, { y: this.level, ...spec });
  }
}
