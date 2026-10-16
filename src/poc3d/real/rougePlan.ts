/**
 * Hotel Rouge's floor plan, read from content/world3d/rouge_plan.json (the one place its numbers live: the Blender models,
 * scripts/blender/rouge_xl.py, read the same file). Local frame: u along the front, t inward, y up. A room's own frame is
 * (a, b): a along u from its west wall, b from the wall opposite its door toward the door.
 */
export type R4 = readonly [number, number, number, number];

interface RawRoom {
  readonly no: string;
  readonly name: string;
  readonly floor: number;
  readonly kind: 'guest' | 'service';
  readonly theme: string;
  readonly layout?: string;
  readonly rect: R4;
  readonly door: { readonly wall: 't0' | 't1'; readonly u: number };
  readonly things?: readonly (readonly [string, number, number, number, number, number])[];
}
interface RawPlan {
  readonly footprint: { readonly w: number; readonly d: number };
  readonly keep: { readonly u0: number; readonly u1: number; readonly t0: number; readonly t1: number; readonly h: number };
  readonly in: { readonly u0: number; readonly u1: number; readonly t0: number; readonly t1: number };
  readonly floors: readonly number[];
  readonly ceil: number;
  readonly roomCeil: number;
  readonly tub: { readonly rOut: number; readonly rIn: number; readonly rim: number; readonly water: number; readonly onsen: readonly [number, number] };
  readonly frontDoor: readonly [number, number];
  readonly sideDoor: readonly [number, number];
  readonly corridor: { readonly t0: number; readonly t1: number };
  readonly stair: { readonly u0: number; readonly u1: number; readonly lane1: readonly [number, number]; readonly lane2: readonly [number, number]; readonly rise: number; readonly hall: readonly [number, number] };
  readonly ground: Record<string, unknown>;
  readonly layouts: Record<string, Record<string, unknown>>;
  readonly rooms: readonly RawRoom[];
}

const FILES = import.meta.glob('../../../content/world3d/rouge_plan.json', { eager: true, import: 'default' }) as Record<string, RawPlan>;
const RAW = Object.values(FILES)[0];
if (!RAW) throw new Error('content/world3d/rouge_plan.json is missing');

/** The hotel's name as signed: the neon on the keep, the rate board, the plaque, the lobby's welcome. (The stamp's id, `hotel_rouge`, stays whatever it's called.) */
export const HOTEL = { en: 'Hotel Rouge', jp: 'ホテル ルージュ', short: 'ROUGE', suite: 'Rouge Suite' } as const;

export const FOOTPRINT = RAW.footprint;
export const KEEP = RAW.keep;
export const IN = RAW.in;
export const FLOORS = RAW.floors as readonly [0, 5, 10];
export const CEIL = RAW.ceil;
/** The guest rooms' own (dropped) ceiling, and the tubs' sizes: the models are built to the same numbers. */
export const ROOM_CEIL = RAW.roomCeil;
export const TUB = RAW.tub;
export const FRONT_DOOR = RAW.frontDoor;
export const SIDE_DOOR = RAW.sideDoor;
export const CORRIDOR = RAW.corridor;
export const STAIR = { ...RAW.stair, land: IN.u1 };
export const GROUND = RAW.ground as unknown as {
  lobby: R4; garage: R4; garageDoor: readonly [number, number]; garageGate: readonly [number, number]; staffWall: readonly [number, number]; staffWindow: readonly [number, number];
  panelWall: R4; amenity: R4; costumes: R4; vending: R4; bench: R4; hallBenches: readonly R4[]; payphone: R4; plant: readonly [number, number]; car: readonly [number, number];
};
export const DOOR_HALF = 0.65;
/** The stair's shaft: both lanes and the landing. */
export const SHAFT: R4 = [STAIR.u0, IN.u1, STAIR.lane2[0], STAIR.lane1[1]];

const num = (v: unknown, W: number): number => (typeof v === 'string' ? (v === 'W' ? W : W + parseFloat(v.slice(1))) : (v as number));

export interface PlanRoom {
  readonly no: string;
  readonly name: string;
  readonly floor: number;
  readonly kind: 'guest' | 'service';
  readonly theme: string;
  readonly rect: R4;
  readonly W: number;
  readonly D: number;
  readonly wall: 't0' | 't1';
  readonly doorU: number;
  /** The door's state key (the stamp's node, `hotel_rouge.door_<no>`). */
  readonly key: string;
  /** The door wall's slab (outside the room's rect) and the doorway's rect (what blocks while the door is shut). */
  readonly slab: R4;
  readonly gap: R4;
  /** The room's frame (a, b) as a world-local rect and point. */
  local(a0: number, a1: number, b0: number, b1: number): R4;
  pt(a: number, b: number): readonly [number, number];
  /** The room's walls (structure round it, the door wall with the doorway left open) and its furniture's footprints. */
  readonly walls: readonly R4[];
  readonly solids: readonly R4[];
  /** The tub (guest rooms): its centre in local (u, t), and its theme. */
  readonly tub: { readonly u: number; readonly t: number } | null;
  /** The bath's corner: glass along its west edge and its room side (the other two are the room's walls). */
  readonly bath: R4 | null;
  /**
   * The bath's glass door, in its west glass wall: its state key (the stamp's node, `hotel_rouge.bath_<no>`), the doorway
   * (what blocks while it's shut), the hinge and the way the shut leaf runs from it (local, unit), the leaf's width.
   */
  readonly bathDoor: { readonly key: string; readonly gap: R4; readonly hinge: readonly [number, number]; readonly closed: readonly [number, number]; readonly width: number } | null;
}

function build(r: RawRoom): PlanRoom {
  const [u0, u1, t0, t1] = r.rect;
  const W = u1 - u0;
  const D = t1 - t0;
  const fwd = r.door.wall === 't1';
  const T = (b: number): number => (fwd ? t0 + b : t1 - b);
  const local = (a0: number, a1: number, b0: number, b1: number): R4 => {
    const ta = T(b0);
    const tb = T(b1);
    return [u0 + a0, u0 + a1, Math.min(ta, tb), Math.max(ta, tb)];
  };
  const slab: R4 = fwd ? [u0 - 0.1, u1 + 0.1, t1, t1 + 0.1] : [u0 - 0.1, u1 + 0.1, t0 - 0.1, t0];
  const gap: R4 = [r.door.u - DOOR_HALF, r.door.u + DOOR_HALF, slab[2] - 0.1, slab[3] + 0.1];
  const lay = r.layout ? (RAW.layouts[r.layout] as Record<string, unknown>) : null;
  const solids: R4[] = [];
  let tub: PlanRoom['tub'] = null;
  let bath: R4 | null = null;
  let bathDoor: PlanRoom['bathDoor'] = null;
  if (lay) {
    for (const name of ['bed', 'sofa', 'table', 'tv', 'dining', 'vanity', 'massage', 'bar', 'desk']) {
      const v = lay[name] as unknown[] | undefined;
      if (!v) continue;
      solids.push(local(num(v[0], W), num(v[1], W), num(v[2], W), num(v[3], W)));
    }
    // The bath is a corner you walk into: its two glass walls block (the west one but for its door), and the tub.
    const bv = lay.bath as unknown[] | undefined;
    if (bv) {
      const [a0, a1, b0, b1] = [num(bv[0], W), num(bv[1], W), num(bv[2], W), num(bv[3], W)];
      bath = local(a0, a1, b0, b1);
      const G = 0.05;
      const bd = lay.bathDoor as readonly [number, number] | undefined;
      if (bd) {
        solids.push(local(a0 - G, a0 + G, b0, bd[0]), local(a0 - G, a0 + G, bd[1], b1));
        const ht = T(bd[0]);
        bathDoor = { key: `hotel_rouge.bath_${r.no}`, gap: local(a0 - 0.1, a0 + 0.1, bd[0], bd[1]), hinge: [u0 + a0, ht], closed: [0, Math.sign(T(bd[1]) - ht)], width: bd[1] - bd[0] };
      } else solids.push(local(a0 - G, a0 + G, b0, b1));
      solids.push(local(a0, a1, b1 - G, b1 + G));
    }
    const tb = lay.tub as { a: unknown; b: number } | undefined;
    if (tb) {
      const ta = num(tb.a, W);
      tub = { u: u0 + ta, t: T(tb.b) };
      // (the round tubs with the step on their room side; the onsen's box)
      const [hw, hd] = r.theme === 'onsen' ? [(RAW.tub.onsen[0] + 0.25) / 2, (RAW.tub.onsen[1] + 0.25) / 2] : [RAW.tub.rOut, RAW.tub.rOut];
      solids.push(local(ta - hw - (r.theme === 'onsen' ? 0 : 0.45), ta + hw, tb.b - hd, tb.b + hd));
    }
  }
  for (const th of r.things ?? []) solids.push(local(th[1], th[2], th[3], th[4]));
  // Walls: the side partitions and the door wall's two halves (the perimeter is the keep's own ring).
  const walls: R4[] = [
    [u0 - 0.1, u0, Math.min(slab[2], t0), Math.max(slab[3], t1)],
    [u1, u1 + 0.1, Math.min(slab[2], t0), Math.max(slab[3], t1)],
    [slab[0], gap[0], slab[2], slab[3]],
    [gap[1], slab[1], slab[2], slab[3]],
  ];
  return {
    no: r.no, name: r.name, floor: r.floor, kind: r.kind, theme: r.theme, rect: r.rect, W, D, wall: r.door.wall, doorU: r.door.u,
    key: `hotel_rouge.door_${r.no}`, slab, gap, local, pt: (a, b) => [u0 + a, T(b)], walls, solids, tub, bath, bathDoor,
  };
}

export const ROOMS: readonly PlanRoom[] = RAW.rooms.map(build);
export const roomsOn = (floor: number): PlanRoom[] => ROOMS.filter((r) => r.floor === floor);
