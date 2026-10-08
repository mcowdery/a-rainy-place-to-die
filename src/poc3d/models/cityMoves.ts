import type { AnimLibrary } from './characterAnims';

/**
 * What of the animation library (models/characterAnims.ts) is Mack's own on foot: which clips play over his keyed
 * pose this frame, at what time and weight. The rig lays them on (models/firstPerson.ts `layMoves`); this only
 * decides, from what he's doing, and knows nothing of three.js, so it can be tested.
 *
 * Two things, and no more (the user, 2026-10-06, after playing a whole round of the library's clips on him in the
 * city: "for the character the animations don't fit his vibe and style. They are more of a 'hulk' type character
 * while Mack is more chill"; "pistol animations are fine, everything else take off", and the captured walk kept):
 *
 * - **His walk** is a captured one (Walk_35_Loop, a real man's from the Carnegie Mellon database, not the pack's),
 *   kept in step with the rig's own stride, so his footfalls and the view's bob are where they were. It gives way to
 *   the rig's keyed run as he speeds up: his run, its start and its stop are the rig's own.
 * - **The pistol**: standing with it out, his body is the pack's (its ready stance, its aim, a shot's jolt, the
 *   reload's lean), and the rig then puts his hands on the gun as it always has, the gun on the crosshair and the
 *   magazine changed by hand ("i want the pistol clips but also want to keep the magazine change and crosshair").
 *   Walking or running with it he moves as he's keyed.
 *
 * Built, played and taken off again that day, all of the pack's: its jump, the push off into a run and the skid out
 * of one, a look around and folded arms standing, jogs sideways and backwards, feet stepping round a turn, a hand out
 * on E, picking up, a drink, a bite, a phone call, sitting on the ground, a crouch, a slide, a roll, his body on a
 * train's seat; and a captured run (Run_09_Loop). In the air nothing of the library plays.
 *
 * What may be given him from here on (the user, the day after: "there's a lot more here that I like than dislike"):
 * any clip scripts/anims/exclusions.json doesn't exclude for `mack`, when a situation calls for it and as its note
 * there says (.claude/rules/cast.md). Not what was taken off, put back; and anything that changes how he carries
 * himself is shown to the user moving first.
 */

/** A clip over his pose this frame. */
export interface MoveLayer {
  readonly name: string;
  /** Where in the clip (s). */
  readonly time: number;
  /** How much of it (0-1) over what's under it. */
  readonly weight: number;
  /** In first person it doesn't move the eyes: the body takes up what the clip does to his neck (his stride). */
  readonly steady: boolean;
}

/** What he's doing, as the rig knows it. */
export interface MoveState {
  dt: number;
  /** The gait he's shown at: 0 standing, about 1.5 walking, 4.2 running. */
  gait: number;
  /** His feet above the ground (m). */
  air: number;
  /** His pistol, while it's out or on its way: how far out of his belt (0-1), how far raised (0-1), the shots fired
   * so far (a change is a shot), and how far through a reload (0-1; under 0 for none). */
  gun?: { out: number; aim: number; shots: number; reload: number } | null;
  /** His stride: where in it he is (0-1, 0 as the left foot lands), how much of a stride it is (0 standing, 1
   * walking or running) and how much of a run (0-1). */
  stride?: { at: number; k: number; run: number };
}

/** His walk: the clip, and where in it the left foot lands (0-1): Walk_35 was cut left heel to left heel. (A clip cut
 * right heel to right heel, as some runs were, lands the left at 0.5: scripts/anims/cmu.mjs.) */
const WALK = { clip: 'Walk_35_Loop', left: 0 } as const;
/** The gait below which he has stopped. */
const STOPPED = 0.4;
const frac = (v: number): number => v - Math.floor(v);
const unit = (v: number): number => Math.max(0, Math.min(1, v));

export class CityMoves {
  /** The pistol's clips: how much of them he's in (standing with it out), the ready stance's time, the last shot
   * counted and how long ago it was. */
  private gunK = 0;
  private gunT = 0;
  private shots = -1;
  private sinceShot = 99;
  private readonly out: MoveLayer[] = [];

  /** `lengthOf`: a clip's length in seconds (0 for one the library hasn't got: it's then never played). */
  constructor(private readonly lengthOf: (clip: string) => number) {}

  private layer(name: string, time: number, weight: number, steady = false): void {
    if (weight > 0.001 && this.lengthOf(name) > 0) this.out.push({ name, time, weight: Math.min(1, weight), steady });
  }

  /** How much of the pistol's stance he's in (0-1): the rig bends him to the view over it by as much. */
  get gunWeight(): number {
    return this.gunK;
  }

  /** The pistol's clips for this frame: the ready stance, the aim over it by how far the gun is raised, a shot's
   * jolt, the reload's lean at the reload's own pace. */
  private gun(s: MoveState, standing: boolean): void {
    const g = s.gun ?? null;
    this.gunK = unit(this.gunK + ((g && standing ? 1 : -1) * s.dt) / 0.2);
    if (!g) {
      this.shots = -1;
      return;
    }
    if (this.shots >= 0 && g.shots !== this.shots) this.sinceShot = 0;
    else this.sinceShot += s.dt;
    this.shots = g.shots;
    const w = this.gunK * unit(g.out);
    if (w <= 0) return;
    const idle = this.lengthOf('Pistol_Idle_Loop');
    this.gunT = idle > 0 ? (this.gunT + s.dt) % idle : 0;
    this.layer('Pistol_Idle_Loop', this.gunT, w);
    this.layer('Pistol_Aim_Neutral', this.lengthOf('Pistol_Aim_Neutral'), w * unit(g.aim));
    const shot = this.lengthOf('Pistol_Shoot');
    if (this.sinceShot < shot) this.layer('Pistol_Shoot', this.sinceShot, w * Math.min(1, this.sinceShot / 0.03, (shot - this.sinceShot) / 0.15));
    if (g.reload >= 0) this.layer('Pistol_Reload', g.reload * this.lengthOf('Pistol_Reload'), w * Math.min(1, g.reload / 0.12, (1 - g.reload) / 0.12));
  }

  /** The clips over his pose this frame, in the order to lay them on: his walk, then the pistol's stance. */
  update(s: MoveState): readonly MoveLayer[] {
    const standing = s.gait < STOPPED && s.air <= 0.02;
    this.out.length = 0;
    // The walk, less of it the more of a run it is (his run is the rig's own, under it).
    const st = s.stride;
    if (st && st.k > 0) this.layer(WALK.clip, frac(st.at + WALK.left) * this.lengthOf(WALK.clip), st.k * (1 - st.run), true);
    this.gun(s, standing);
    return this.out;
  }
}

/**
 * Gives a rig the animation library and these moves, once the library is in (it's fetched the first time anyone
 * asks: about 4.9 MB); until then, and if it can't be had, he moves as he's keyed.
 */
export async function withCityMoves(rig: { anims: AnimLibrary | null; moves: CityMoves | null }): Promise<void> {
  const { animLibrary } = await import('./characterAnims');
  const library = await animLibrary();
  const lengths = new Map(library.clips.map((c) => [c.name, c.seconds]));
  rig.anims = library;
  rig.moves = new CityMoves((name) => lengths.get(name) ?? 0);
}
