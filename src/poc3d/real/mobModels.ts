import type { Body, Template, V3 } from './mobRig';

/**
 * Mob figures that were modelled, not lofted: a template worked backwards from a model made to be looked at
 * (scripts/blender/mob_from_vrm.py: a VRoid VRM with its face's features taken off, cut down to a few thousand
 * triangles and carried onto the mob's own bones), as `assets/mob/<name>.json`. Each has its own joints (longer
 * legs, a higher waist), so the mob's material keeps a set of joints for every model as it does for every body
 * (real/people.ts: `registerMobModel`, `FigureSpec.model`).
 */
export interface MobModelDoc {
  readonly name: string;
  /** Which of the mob's bodies it stands for (how it's dressed, picked and posed by default). */
  readonly body: Body;
  readonly source: string;
  /** To the top of the skull, m. */
  readonly height: number;
  readonly triangles: number;
  /** The arms' angle away from the body in the bind pose, rad. */
  readonly armOut: number;
  /** One joint per bone (real/mobRig.ts), the mob's frame: x across, y up, z forward, feet at y 0. */
  readonly pivot: readonly V3[];
  readonly pos: readonly number[];
  readonly nor: readonly number[];
  readonly b0: readonly number[];
  readonly b1: readonly number[];
  readonly w: readonly number[];
  readonly shade: readonly number[];
  readonly idx: readonly number[];
}

/** A model's document as a template the mob draws. */
export function modelTemplate(doc: MobModelDoc): Template {
  return {
    pos: new Float32Array(doc.pos),
    nor: new Float32Array(doc.nor),
    mirror: 0,
    b0: new Uint8Array(doc.b0),
    b1: new Uint8Array(doc.b1),
    w: new Float32Array(doc.w),
    shade: new Float32Array(doc.shade),
    idx: new Uint32Array(doc.idx),
    pivot: doc.pivot.map((p) => [p[0], p[1], p[2]] as V3),
    armOut: doc.armOut,
  };
}
