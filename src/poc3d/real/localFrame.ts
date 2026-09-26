import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { frontFrame } from './buildings';
import type { MeshBuilder } from './meshBuilder';

type C3 = [number, number, number];

/**
 * A building's local frame for hand-built interiors and set pieces: u runs along the street face from its
 * left end (seen from the street), t runs inward from the face, y is height. Axis-aligned local boxes map
 * to axis-aligned world boxes, so layouts double as collision rects.
 */
export interface LocalFrame {
  readonly p: C3;
  readonly r: C3;
  readonly n: C3;
  /** Face width (along u) and depth (along t). */
  readonly fw: number;
  readonly depth: number;
}

export function localFrame(b: Building3): LocalFrame {
  const f = frontFrame(b);
  return { ...f, depth: b.front === 'north' || b.front === 'south' ? b.d : b.w };
}

/** World (x, z) of a local point. */
export function toWorld(f: LocalFrame, u: number, t: number): [number, number] {
  return [f.p[0] + f.r[0] * u - f.n[0] * t, f.p[2] + f.r[2] * u - f.n[2] * t];
}

/** World yaw (FigureSpec convention: 0 faces +z) of a local direction (du along u, dt inward). */
export function localYaw(f: LocalFrame, du: number, dt: number): number {
  const x = f.r[0] * du - f.n[0] * dt;
  const z = f.r[2] * du - f.n[2] * dt;
  return Math.atan2(x, z);
}

/** World rect of a local rect. */
export function localRect(f: LocalFrame, u0: number, u1: number, t0: number, t1: number): Rect {
  const [ax, az] = toWorld(f, u0, t0);
  const [bx, bz] = toWorld(f, u1, t1);
  return { x: Math.min(ax, bx), y: Math.min(az, bz), w: Math.abs(bx - ax), h: Math.abs(bz - az) };
}

/** An axis-aligned local box into the builder (with the builder's current kind and colour). */
export function localBox(mb: MeshBuilder, f: LocalFrame, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, topKind?: number): void {
  mb.frameBox(f.p, f.r, f.n, u0, u1, y0, y1, -t1, -t0, topKind);
}

/** A solid part of a layout: a local box that also blocks walking. */
export interface Part {
  readonly u0: number;
  readonly u1: number;
  readonly t0: number;
  readonly t1: number;
  readonly y0: number;
  readonly y1: number;
  readonly color: number;
  /** Blocks walking (collision). */
  readonly solid: boolean;
  /** Collision only: the geometry is built separately (e.g. an open shelf unit with its stock). */
  readonly hidden?: boolean;
}
