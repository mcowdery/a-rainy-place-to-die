import type { Bulge } from './mobMesh';
import type { Row, TemplateBuilder, V3, Weight } from './mobRig';

/**
 * What a bare woman's figure carries besides her smooth body: nipples and areolas, pubic hair, the marks at the foot
 * of the cleft. Those are drawn by the hooks the uncensored edition registers from adult/src/mobBare.ts (its own
 * repository; src/edition/bare/uncensored.ts loads it, every other edition has `none.ts`), so this repository has
 * the body only. Each hook is given the part of `buildShaped`'s state it works on, at the point it used to run.
 */

/** The breast's tip: a nub, built with the torso (`buildShaped`'s state at that point). */
export interface NippleCtx {
  readonly tb: TemplateBuilder;
  readonly xs: number;
  readonly ys: number;
  /** The torso's rows, and the field that shaped it (the nub is carried out with the skin there). */
  readonly T: readonly Row[];
  readonly bodyField: readonly Bulge[];
  readonly bareBreast: Bulge;
}

/** The mark at the foot of the cleft behind: the path up the middle of the seat and the helpers that draw on it. */
export interface AnusCtx {
  readonly tb: TemplateBuilder;
  readonly bareWoman: boolean;
  readonly pts: readonly V3[];
  readonly idx: readonly number[];
  readonly dist: readonly number[];
  readonly outAt: (n: number) => [number, number];
  readonly put: (x: number, y: number, z: number, shade: number) => number;
  readonly face: (a: number, b: number, c: number, n: [number, number]) => void;
  readonly scaled: (b: Bulge) => Bulge;
}

/** The hair and the cleft stroke on the front of the hips, laid on the hips' own points. */
export interface PubicCtx {
  readonly tb: TemplateBuilder;
  readonly mark: () => number;
  readonly frontLook: { readonly tall: number };
  readonly hipAngles: readonly number[];
  readonly hipRing: number;
  readonly hipFront: number;
  readonly hipSide: number;
  readonly baseRing: readonly number[];
  readonly underMid: number;
}

/** The colour round each nipple: a patch lying on the breast, carried out with the skin. */
export interface AreolaCtx {
  readonly tb: TemplateBuilder;
  readonly mark: () => number;
  readonly xs: number;
  readonly ys: number;
  readonly T: readonly Row[];
  readonly bareBreast: Bulge;
  readonly disc: (y: number, t: number, r: number, g: number, shade: number, n?: number, rows?: readonly Row[], weight?: (r: Row, i: number, x: number) => Weight) => void;
}

export interface BareDetail {
  nipples(c: NippleCtx): void;
  anus(c: AnusCtx): void;
  pubic(c: PubicCtx): void;
  areola(c: AreolaCtx): void;
}

let hooks: BareDetail | null = null;

/** Registered once, by adult/src/mobBare.ts when it loads. */
export const setBareDetail = (h: BareDetail | null): void => {
  hooks = h;
};
export const bareDetail = (): BareDetail | null => hooks;
