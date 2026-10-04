import * as THREE from 'three';
import type { CarView } from '../../race/carView';
import { FOLLOWERS, FollowerWalk, Trail, spotBehind, type FollowWorld, type FollowerDef, type Leader } from '../district/followers';
import { passengerSeats, type PassengerSeat } from '../models/carInterior';
import { bodyShape } from '../models/vehicles';
import { LiveFigure } from './liveFigure';
import { RIDE_HIP } from './people';

/** What Mack is doing this frame, as far as the people with him are concerned. */
export type PartyMode =
  /** On foot: they follow. */
  | { readonly kind: 'foot'; readonly leader: Leader }
  /** At the wheel of his car: they ride in its seats. */
  | { readonly kind: 'car'; readonly view: CarView }
  /** On something they can't ride (a bike, a taxi, a train): out of sight until he's on foot again. */
  | { readonly kind: 'away' }
  /** A scene, or flying about: those on foot stop where they are and wait. */
  | { readonly kind: 'hold' };

/** The place as the party needs it: the walker's collision and floors, and what a figure's feet stand on. */
export interface PartyWorld extends FollowWorld {
  /** The height to draw someone's feet at (x, z) on `floor`: the floor, plus the paving at street level. */
  standAt(x: number, z: number, floor: number): number;
}

type State = 'out' | 'walk' | 'ride' | 'away';

interface Member {
  readonly def: FollowerDef;
  readonly figure: LiveFigure;
  readonly walk: FollowerWalk;
  state: State;
  /** The height its feet are drawn at (eased: a kerb is a step, not a jump). */
  y: number;
  seat: PassengerSeat | null;
}

/**
 * The people following Mack (district/followers.ts), as the mob's figures (real/liveFigure.ts): on foot behind
 * him; in his car's passenger seats while he drives (the front seat, then the back; in a two-seater whoever
 * doesn't fit waits out of sight), sitting in the car's own frame so they ride with its body; out of sight on
 * anything else, and back behind him when he's on foot again. Getting in and out isn't acted: they're in their
 * seats when he takes the wheel, and standing by their doors when he gets out.
 */
export class FollowerParty {
  readonly members: Member[];
  private readonly trail = new Trail();
  private last: { x: number; z: number } | null = null;
  private leaderSpeed = 0;
  /** The car they were last in (to get out beside it). */
  private car: CarView | null = null;

  constructor(
    material: THREE.Material,
    private readonly scene: THREE.Object3D,
    private readonly world: PartyWorld,
  ) {
    this.members = FOLLOWERS.map((def) => ({
      def,
      figure: new LiveFigure({ body: def.body, hair: def.hair, long: def.outfit === 'long', outfit: def.outfit, color: [...def.color], side: 1 }, material),
      walk: new FollowerWalk(def.gap, def.side),
      state: 'out' as State,
      y: 0,
      seat: null,
    }));
  }

  /** Those on foot at the moment (for the traffic, which stops for people in the road). */
  get walkers(): { x: number; z: number; vx: number; vz: number; floor: number }[] {
    return this.members.filter((m) => m.state === 'walk').map((m) => ({ x: m.walk.x, z: m.walk.z, vx: m.walk.vx, vz: m.walk.vz, floor: m.walk.floor }));
  }

  /** Every frame: who's following (`with`), and what Mack's doing. */
  update(dt: number, mode: PartyMode, following: (id: string) => boolean): void {
    for (const m of this.members) {
      const on = following(m.def.id);
      if (!on && m.state !== 'out') this.hide(m, 'out');
      // (Someone new: wherever they were, they turn up behind him.)
      if (on && m.state === 'out') m.state = 'away';
    }
    const here = this.members.filter((m) => m.state !== 'out');
    let jumped = false;
    if (mode.kind === 'foot') {
      const L = mode.leader;
      jumped = this.trail.push(L.x, L.z, L.floor);
      const v = this.last && dt > 0 ? Math.hypot(L.x - this.last.x, L.z - this.last.z) / dt : 0;
      this.leaderSpeed += ((jumped || v > 14 ? 0 : v) - this.leaderSpeed) * Math.min(1, dt * 8);
      this.last = { x: L.x, z: L.z };
    } else if (mode.kind !== 'hold') {
      this.trail.reset();
      this.last = null;
      this.leaderSpeed = 0;
    }
    if (mode.kind === 'car') {
      const seats = passengerSeats(mode.view.type);
      here.forEach((m, i) => {
        const seat = seats[i] ?? null;
        if (!seat) return this.hide(m, 'away');
        if (m.state !== 'ride' || this.car !== mode.view || m.figure.mesh.parent !== mode.view.obj) {
          mode.view.obj.add(m.figure.mesh);
          m.figure.mesh.visible = true;
          m.state = 'ride';
        }
        m.seat = seat;
        // Sunk into the cushion as far as it takes to fit under the roof; the knees up where there's no legroom.
        const sitting = RIDE_HIP + m.figure.size.height - m.figure.size.hip;
        const sink = Math.max(0, sitting + 0.02 - seat.head);
        m.figure.set({ x: seat.at.x, z: seat.at.z, y: seat.at.y - sink, yaw: 0, pose: 'ride', pace: (0.85 - seat.legs) / 0.4, close: true });
      });
      this.car = mode.view;
      return;
    }
    if (mode.kind === 'away') {
      for (const m of here) this.hide(m, 'away');
      this.car = null;
      return;
    }
    const leader = mode.kind === 'foot' ? mode.leader : null;
    for (const m of here) {
      if (m.state === 'ride') {
        // Out of the car (he's on foot again, or a scene began with them aboard: then they stay in their seats).
        if (!leader) continue;
        this.alight(m, leader);
      } else if (m.state === 'away') {
        if (!leader) continue;
        m.walk.join(leader, this.trail, this.world);
        this.show(m);
      } else if (leader && jumped) m.walk.join(leader, this.trail, this.world);
      const w = m.walk;
      const warps = w.warps;
      w.step(dt, leader, this.leaderSpeed, this.trail, this.world);
      const y = this.world.standAt(w.x, w.z, w.floor);
      m.y = w.warps !== warps || Math.abs(y - m.y) > 0.6 ? y : m.y + (y - m.y) * Math.min(1, dt * 14);
      m.figure.set({ x: w.x, z: w.z, y: m.y, yaw: w.yaw, pose: 'gait', pace: w.pace, phase: w.phase });
    }
    if (leader) this.car = null;
  }

  /** On foot in the scene, where its walk says. */
  private show(m: Member): void {
    this.scene.add(m.figure.mesh);
    // (Its matrix never changes, so nothing tells three its world matrix is now the scene's, not the car's.)
    m.figure.mesh.matrixWorldNeedsUpdate = true;
    m.figure.mesh.visible = true;
    m.state = 'walk';
    m.seat = null;
    m.y = this.world.standAt(m.walk.x, m.walk.z, m.walk.floor);
  }

  private hide(m: Member, state: 'out' | 'away'): void {
    this.scene.add(m.figure.mesh);
    m.figure.mesh.matrixWorldNeedsUpdate = true;
    m.figure.mesh.visible = false;
    m.state = state;
    m.seat = null;
  }

  /** Out of the car by its own door (else the other side, else behind the car, else by Mack), facing him. */
  private alight(m: Member, leader: Leader): void {
    const car = this.car;
    const seat = m.seat;
    let spot: { x: number; z: number; y: number } | null = null;
    let round: { x: number; z: number }[] = [];
    if (car && seat) {
      const o = car.obj;
      const h = o.rotation.y;
      // The car's frame: +z forward (sin h, cos h), +x its left (cos h, -sin h).
      const at = (lx: number, lz: number): { x: number; z: number } => ({ x: o.position.x + Math.cos(h) * lx + Math.sin(h) * lz, z: o.position.z - Math.sin(h) * lx + Math.cos(h) * lz });
      const B = bodyShape(car.type);
      const out = B.halfW(B.L / 2) + 0.75;
      const s = Math.sign(seat.at.x) || 1;
      const free = (p: { x: number; z: number }): boolean => !this.world.blocked(p.x, p.z, 0.35, this.world.floorAt(p.x, p.z, o.position.y));
      for (const [lx, lz] of [[s * out, seat.at.z], [-s * out, seat.at.z], [s * out, seat.at.z - 1.2], [s * 0.5, -B.L / 2 - 1]] as const) {
        const p = at(lx, lz);
        const y = this.world.floorAt(p.x, p.z, o.position.y);
        if (Math.abs(y - o.position.y) > 0.6 || !free(p) || Math.hypot(p.x - leader.x, p.z - leader.z) < 0.6) continue;
        spot = { ...p, y };
        // The car between them and him: round its nearer end (its corners, clear of the body), where there's room.
        const lead = { x: Math.cos(h) * (leader.x - o.position.x) - Math.sin(h) * (leader.z - o.position.z), z: Math.sin(h) * (leader.x - o.position.x) + Math.cos(h) * (leader.z - o.position.z) };
        if (Math.sign(lead.x) === -Math.sign(lx) && Math.abs(lz) < B.L / 2 && Math.abs(lead.z) < B.L / 2 + 0.9) {
          const end = (lz + lead.z < 0 ? -1 : 1) * (B.L / 2 + 0.9);
          const corners = [at(lx, end), at(-lx, end)];
          if (corners.every(free)) round = corners;
        }
        break;
      }
    }
    spot ??= spotBehind(leader, m.def.gap, m.def.side, this.world);
    m.walk.place(spot.x, spot.z, spot.y, Math.atan2(leader.x - spot.x, leader.z - spot.z), this.trail.end);
    m.walk.via(round);
    this.show(m);
  }
}
