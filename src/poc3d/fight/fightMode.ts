import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Brawl, type BrawlView } from '../models/brawl';
import { DuelHud } from '../models/duelHud';
import type { FirstPersonRig } from '../models/firstPerson';
import { animLibrary, type AnimLibrary } from '../models/characterAnims';
import { attacksOf, clipAttacksOf, GORE_LEVELS, saveGore, STANCES, ZONES, type Dir, type Doing, type GoreLevel, type Melee, type MeleeWeapon, type MoveId, type Stance, type Zone } from '../models/melee';
import type { Thug } from '../models/thug';
import { FpMode } from '../showroom/fpMode';

/**
 * The fight page's first person (fight.html): the showroom's (showroom/fpMode.ts: Mack's body, his guns, the
 * third-person camera, his wardrobe) with the fight (models/brawl.ts) added.
 * 1 guns, 2 fists, 3 katana, 4 the bat; X puts the fists up, draws the sword or brings the bat up (and back);
 * left click attacks, the blow chosen by where you aim (his head, his body or his legs: `readAim`), by the
 * stance (which follows the aim unless R and C have taken it over) and by what he's doing (running, in the air,
 * stepping back, out of a dodge: `doing`), and held, it's a heavier blow; bare-handed the left button is the
 * left hand, the right the right, and both together block (swings picked by the mouse's way,
 * Bannerlord's, are shelved: `mouseSwings`, `?swings=mouse`; so are the kill moves: `Brawl.killMoves`,
 * `?killmoves=0.8`); with a weapon R raises the
 * stance and C lowers it (low, mid, high: the height the swings come from, models/melee.ts); the right button
 * guards (a click from the guard thrusts the sword or jabs with the bat), H swings it in one hand or two, E dodges
 * to the side, F kicks (a stomp on a man on the
 * floor). A group of thugs (models/thug.ts) comes at you when you pick a fighting hand, and the guns hit them
 * too; T brings on a fresh group, B a duel with a swordsman, Y cycles the gore (full, low, off), U the kill-move
 * chance. `__fp` scripts it.
 */

/** What's in hand: the guns, or fists, the katana or the bat. */
export type Hand = 'gun' | MeleeWeapon;

/** The kill-move chances U steps through. */
export const KILL_CHANCES: readonly number[] = [0.25, 0.5, 0.8, 1];

/** The city's walk and run (m/s), and where it remembers the view (district/main.ts). */
const CITY_PACE = { walk: 4.5, run: 9 } as const;
const VIEW_KEYS = { third: 'rainyplace.thirdPerson', zoom: 'rainyplace.thirdZoom' } as const;

/** Reading the aim. The one he'd hit: within `reach` (m) and `cone` (rad) of the way he faces. With him in the
 * view's line (within `line` rad of it), the zone is where that line passes him: above his shoulders (`neck`
 * below his head's middle), below his hips, or between; with nobody there, the view's tilt (rad: above `up`,
 * below `down`). `keep` is how far past a boundary the aim must go to leave the zone it's in. */
const AIM = { reach: 3.2, cone: 1.05, line: 0.5, neck: 0.22, hips: 0.05, up: 0.25, down: -0.5, keep: 0.05, keepTilt: 0.05 } as const;
/** The stance that goes with each zone, when the stance follows the aim. */
const STANCE_FOR: Record<Zone, Stance> = { head: 'high', body: 'mid', legs: 'low' };
/** Running (m/s) is fast enough for the running attack; a dodge's own attack is this soon after it (s). */
const RUN_ATTACK = 6;
const AFTER_DODGE = 0.45;
/** A sidestep is a left or a right key tapped twice within this long (ms): the arrows, or A and D. */
const DOUBLE_TAP = 260;
const SIDE_KEYS: Record<string, -1 | 1> = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };
/** Bare-handed, the second button this soon after the first (s) makes a block of what the first began as a punch. */
const BOTH_WITHIN = 0.12;

/** How long after a click the mouse's motion is read for the swing's way (ms): a short wind-up. */
const SWING_READ = 100;

export class FightMode extends FpMode {
  readonly brawl: Brawl;
  hand: Hand = 'gun';
  /** The mouse's recent motion (for the way an attack goes), and the arrow that shows it. */
  private readonly motion: { t: number; dx: number; dy: number }[] = [];
  private readonly dirEl: HTMLDivElement;
  private dirT = 0;
  private swingPending = false;
  /** Swings by the mouse's way (Bannerlord's): shelved since 2026-10-06 (the user: not enjoying it as much as
   * hoped, kept to come back to), so off unless the URL asks (`?swings=mouse`). Off, a click is the next of the
   * stance's combo, at once. */
  readonly mouseSwings = new URLSearchParams(location.search).get('swings') === 'mouse';
  private duelHud: DuelHud | null = null;
  /** The stance, under the crosshair (in first person a high or a low stance has the weapon out of view). */
  private readonly stanceEl: HTMLDivElement;
  /** The animation library, once it's been asked for (the library's swings: `setStyle`). */
  private anims: AnimLibrary | null = null;
  /** The view as last remembered (third person or not, the wheel's zoom): the city's own settings. */
  private remembered = '';
  /** Where a blow is aimed now (read from the view each frame: `readAim`). The stance is the keys' (R and C): the
   * user, 2026-10-06, chose to keep the two apart (the stance the kind of swing, the aim where it lands). It can
   * be made to follow the aim instead (looking at his head raises the weapon, at his legs lowers it), from the
   * panel, to try. */
  zone: Zone = 'body';
  autoStance = false;
  /** In third person, the heading he's turning to as a blow winds up: toward the one he's hitting. */
  private turnTo: number | null = null;
  /** The mouse buttons down now. Bare-handed a button is a hand (the left the left, the right the right: the
   * user's, from Skyrim), and both together block; with a weapon the left strikes and the right guards. */
  private readonly buttons = new Set<number>();
  /** The last left or right key tapped, and when: twice running is a sidestep. */
  private tapped: { code: string; t: number } | null = null;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, dom: HTMLElement, controls: OrbitControls, env: THREE.Texture | null, floorAt: (x: number, z: number) => number) {
    super(scene, camera, dom, controls, env, floorAt);
    this.brawl = new Brawl(scene, floorAt, (from, dir, max) => this.probe(from, dir, max), document.body);
    this.dirEl = document.createElement('div');
    Object.assign(this.dirEl.style, { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', opacity: '0', zIndex: '6', color: 'rgba(255,255,255,0.85)', font: 'bold 34px sans-serif', textShadow: '0 0 6px #000' });
    document.body.appendChild(this.dirEl);
    // The view as the city has it: third person or first, and how far back the wheel left the camera.
    try {
      this.third = localStorage.getItem(VIEW_KEYS.third) === '1';
      this.thirdCam.setZoom(Number(localStorage.getItem(VIEW_KEYS.zoom)) || 1);
    } catch {
      /* no storage */
    }
    this.remembered = this.viewNow();
    // (The library is fetched as the page opens: a dodge is its clip whichever moves are on.)
    void animLibrary().then((lib) => (this.anims = lib));
    this.stanceEl = document.createElement('div');
    Object.assign(this.stanceEl.style, { position: 'fixed', left: '50%', top: 'calc(50% + 64px)', transform: 'translateX(-50%)', pointerEvents: 'none', opacity: '0', zIndex: '6', color: 'rgba(255,255,255,0.8)', font: '12px Consolas, monospace', letterSpacing: '2px', textShadow: '0 0 4px #000', whiteSpace: 'pre' });
    document.body.appendChild(this.stanceEl);
    document.addEventListener('mousemove', (e) => {
      if (!this.active || document.pointerLockElement !== dom) return;
      const now = performance.now();
      this.motion.push({ t: now, dx: e.movementX, dy: e.movementY });
      while (this.motion.length > 0 && now - this.motion[0].t > 400) this.motion.shift();
    });
  }

  /** Guns, fists or the katana in hand; picking a fighting one brings on a group if there's none. */
  pick(h: Hand): void {
    this.hand = h;
    const b = this.brawl;
    b.hand = h;
    if (!this.rig) return;
    if (h === 'gun') {
      this.rig.melee = null;
      return;
    }
    this.rig.armed = false;
    this.rig.aiming = false;
    b.melee.setWeapon(h);
    this.rig.melee = b.melee;
    if (b.thugs.length === 0) b.spawn(4, this.view());
  }

  /** A fresh group of `n` round you. */
  spawn(n = 4): void {
    this.brawl.spawn(n, this.view());
  }

  /**
   * His frame for the fight: in first person the view's; in third person his own (where he stands, the way his
   * body faces and is tipped), not the way the camera looks: the camera goes round him, and a blow, a guard or a
   * kill move goes where he's facing.
   */
  private frame(): BrawlView {
    const v = this.view();
    if (!this.third) return v;
    const yaw = this.facing.yaw - Math.PI;
    return { eye: v.eye, yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)), pitch: this.facing.pitch };
  }

  private viewNow(): string {
    return `${this.third ? 1 : 0}|${this.thirdCam.zoom.toFixed(2)}`;
  }

  /** The city's pace (controls.ts: a brisk game-walk and a run), and its legs for it (district/main.ts: his walk at
   * the walk, his run at the run), so a fight here moves as one there will. */
  protected override paceOf(running: boolean): number {
    return running ? CITY_PACE.run : CITY_PACE.walk;
  }
  protected override gaitOf(speed: number): number {
    return speed <= CITY_PACE.walk ? speed / 3 : 1.5 + ((speed - CITY_PACE.walk) / (CITY_PACE.run - CITY_PACE.walk)) * 2.7;
  }

  /** The stance with a weapon (low, mid, high), by hand: it stops following the aim. */
  setStance(s: Stance): void {
    this.autoStance = false;
    this.brawl.melee.setStance(s);
  }

  /** The one a blow would be at: the nearest up or on the floor, within reach, in front of the way he faces. */
  private target(): Thug | null {
    const f = this.frame();
    let best: Thug | null = null;
    let bestD: number = AIM.reach;
    for (const t of this.brawl.thugs) {
      if (!t.root.visible || t.state === 'dead' || t.state === 'scripted') continue;
      const dx = t.root.position.x - f.eye.x;
      const dz = t.root.position.z - f.eye.z;
      const d = Math.hypot(dx, dz);
      const off = Math.atan2(-dx, -dz) - f.yaw;
      if (d < bestD && Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) < AIM.cone) {
        best = t;
        bestD = d;
      }
    }
    return best;
  }

  /** Reads the aim (see `AIM`), and has the stance follow it if it does. */
  private readAim(): void {
    const v = this.view();
    const t = this.target();
    const was = this.zone;
    let zone: Zone | null = null;
    if (t) {
      const dx = t.root.position.x - v.eye.x;
      const dz = t.root.position.z - v.eye.z;
      const off = Math.atan2(-dx, -dz) - v.yaw;
      if (t.floored) zone = 'legs';
      else if (Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) < AIM.line) {
        // Where the view's line is, at his distance, against his shoulders and his hips.
        const y = v.eye.y + Math.tan(v.pitch) * Math.hypot(dx, dz);
        const neck = t.headCentre().y - AIM.neck + (was === 'head' ? -AIM.keep : AIM.keep);
        const hips = t.bone('pelvis').getWorldPosition(new THREE.Vector3()).y - AIM.hips + (was === 'legs' ? AIM.keep : -AIM.keep);
        zone = y > neck ? 'head' : y < hips ? 'legs' : 'body';
      }
    }
    if (!zone) zone = v.pitch > AIM.up + (was === 'head' ? -AIM.keepTilt : AIM.keepTilt) ? 'head' : v.pitch < AIM.down + (was === 'legs' ? AIM.keepTilt : -AIM.keepTilt) ? 'legs' : 'body';
    this.zone = zone;
    const m = this.brawl.melee;
    if (this.autoStance && this.hand !== 'gun' && this.hand !== 'fists' && m.drawn && (m.stance !== STANCE_FOR[zone] || !!m.move)) m.setStance(STANCE_FOR[zone]);
  }

  /** What he's doing that has an attack of its own: in the air, just out of a dodge, running, stepping back. */
  private doing(): Doing {
    if (this.airY > 0.08) return 'air';
    if (this.brawl.melee.sinceDodge < AFTER_DODGE) return 'dodge';
    const fwd = this.keys.has('KeyW');
    if (fwd && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && this.speed > RUN_ATTACK) return 'run';
    if (this.keys.has('KeyS') && !fwd) return 'back';
    return null;
  }

  /** A click: a man on the floor at his feet gets the heel; else the blow for the aim and what he's doing. In
   * third person he turns to the one he's hitting as it winds up (the camera needn't be behind him). */
  private strikeNow(hand?: 'l' | 'r'): void {
    const b = this.brawl;
    const t = this.target();
    const eye = this.view().eye;
    if (t && t.floored && Math.hypot(t.root.position.x - eye.x, t.root.position.z - eye.z) < 1.7) {
      b.kick();
      return;
    }
    this.turnTo = this.third && t ? Math.atan2(t.root.position.x - eye.x, t.root.position.z - eye.z) : null;
    b.strike({ zone: this.zone, doing: this.doing(), hand });
  }

  /** Where a weapon's swings come from: the keys (models/melee.ts), or the animation library's sword clips (fetched
   * the first time; till it's in, a library swing shows as the stance it starts from). */
  async setStyle(style: Melee['style']): Promise<void> {
    this.brawl.melee.style = style;
    if (style === 'clips' && !this.anims) this.anims = await animLibrary();
  }

  /** A duel with a swordsman (the katana to hand, if it was the guns). */
  duel(): void {
    if (this.hand === 'gun') this.pick('katana');
    this.brawl.spawnDuel(this.view());
  }

  /** The gore level, remembered. */
  setGore(level: GoreLevel): void {
    this.brawl.gore.level = level;
    saveGore(level);
  }

  /** The way the mouse moved between two moments (ms, performance.now), if it clearly did. */
  private swingDir(from: number, to: number): Dir {
    let dx = 0;
    let dy = 0;
    for (const m of this.motion)
      if (m.t >= from && m.t <= to) {
        dx += m.dx;
        dy += m.dy;
      }
    if (Math.hypot(dx, dy) < 12) return null;
    if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
    return dy > 0 ? 'down' : 'up';
  }

  private showDir(d: Exclude<Dir, null>): void {
    this.dirEl.textContent = { left: '←', right: '→', up: '↑', down: '↓' }[d];
    this.dirT = 0.35;
  }

  protected override onKey(e: KeyboardEvent): boolean {
    const b = this.brawl;
    b.sound.resume();
    if (e.code === 'Digit1') this.pick('gun');
    if (e.code === 'Digit2') this.pick('fists');
    if (e.code === 'Digit3') this.pick('katana');
    if (e.code === 'Digit4') this.pick('bat');
    // With a weapon in hand R and C are the stance's (not the gun's reload and the review mirror), and H is its
    // one hand or two, as it is the gun's.
    if ((e.code === 'KeyR' || e.code === 'KeyC' || e.code === 'KeyH') && this.hand !== 'gun' && this.hand !== 'fists' && !this.riding) {
      if (e.code === 'KeyH') b.melee.oneHand = !b.melee.oneHand;
      else {
        // (By hand: the stance stops following the aim, till the panel gives it back.)
        this.autoStance = false;
        b.melee.shiftStance(e.code === 'KeyR' ? 1 : -1);
      }
      return true;
    }
    if (e.code === 'KeyL' && this.hand !== 'gun') void this.setStyle(b.melee.style === 'clips' ? 'keys' : 'clips');
    // A sidestep: a left or a right key tapped twice (not held: a repeat isn't a tap).
    const side = SIDE_KEYS[e.code];
    if (side && !e.repeat && this.hand !== 'gun' && !this.riding) {
      const now = performance.now();
      if (this.tapped && this.tapped.code === e.code && now - this.tapped.t < DOUBLE_TAP) {
        this.tapped = null;
        b.dodge(side);
      } else this.tapped = { code: e.code, t: now };
    }
    // A dodge, to the side you're stepping (the right, standing still): the library's, whichever moves are on.
    if (e.code === 'KeyE' && this.hand !== 'gun' && !this.riding) {
      b.dodge(this.keys.has('KeyA') ? -1 : 1);
      return true;
    }
    if (e.code === 'KeyF' && this.hand !== 'gun' && !this.riding) b.kick();
    if (e.code === 'KeyT') this.spawn();
    if (e.code === 'KeyB') this.duel();
    if (e.code === 'KeyY') this.setGore(GORE_LEVELS[(GORE_LEVELS.indexOf(b.gore.level) + 1) % GORE_LEVELS.length]);
    if (e.code === 'KeyU' && b.killMoves) b.killChance = KILL_CHANCES[(KILL_CHANCES.findIndex((x) => x >= b.killChance - 1e-3) + 1) % KILL_CHANCES.length];
    // X with fists or the sword: up or drawn, and back (with the guns it's the showroom's, the gun to hand).
    if (e.code === 'KeyX' && this.rig && this.hand !== 'gun' && !this.riding) {
      const was = b.melee.drawn;
      b.melee.toggleDrawn();
      if (this.hand === 'katana') b.sound.draw(!was);
      return true;
    }
    return false;
  }

  protected override onMouseDown(e: MouseEvent, rig: FirstPersonRig): boolean {
    const b = this.brawl;
    b.sound.resume();
    if (this.hand !== 'gun' && !this.riding) {
      this.buttons.add(e.button);
      if (this.hand === 'fists' && !this.mouseSwings) {
        if (e.button !== 0 && e.button !== 2) return true;
        if (this.buttons.has(0) && this.buttons.has(2)) {
          // Both hands up: a block (a punch the first button had only just started is taken back).
          const m = b.melee;
          if (m.move && m.move.hitter !== null && m.t < BOTH_WITHIN) m.cancel();
          m.holding = false;
          b.guard(true);
        } else {
          b.melee.holding = true;
          this.strikeNow(e.button === 0 ? 'l' : 'r');
        }
        return true;
      }
      if (e.button === 2) b.guard(true);
      if (e.button === 0 && !this.mouseSwings) {
        b.melee.holding = true;
        this.strikeNow();
      }
      else if (e.button === 0 && !this.swingPending) {
        // The swing's way is read from the mouse just after the click (you click and swing; what came before
        // is the wind-up, the other way), or, if it hardly moved, from just before (you moved, then clicked).
        const at = performance.now();
        this.swingPending = true;
        setTimeout(() => {
          this.swingPending = false;
          const dir = this.swingDir(at, at + SWING_READ) ?? this.swingDir(at - 140, at);
          b.attack(dir);
          if (dir) this.showDir(dir);
        }, SWING_READ);
      }
      return true;
    }
    // The shotgun close up: a kill move instead of the shot, if it comes up.
    return e.button === 0 && rig.armed && !this.riding && b.tryGunKill(rig, this.frame());
  }

  protected override onMouseUp(e: MouseEvent): void {
    this.buttons.delete(e.button);
    if (this.hand === 'fists' && !this.mouseSwings) {
      // (Either hand let go ends the block.)
      if (e.button === 0 || e.button === 2) this.brawl.guard(false);
      if (!this.buttons.has(0) && !this.buttons.has(2)) this.brawl.melee.holding = false;
      return;
    }
    if (e.button === 2) this.brawl.guard(false);
    if (e.button === 0) this.brawl.melee.holding = false;
  }

  protected override get held(): boolean {
    return !!this.brawl.run || this.brawl.down > 0;
  }

  protected override meleeNow(): Melee | null {
    return this.hand !== 'gun' ? this.brawl.melee : null;
  }

  protected override fight(dt: number, rig: FirstPersonRig): { dt: number; shake: number; cine: { pos: THREE.Vector3; look: THREE.Vector3 } | null } {
    const b = this.brawl;
    const v = this.frame();
    const out = b.step(dt, rig, v);
    // In third person, turning to the one he's hitting while the blow winds up.
    const mv = b.melee.move;
    if (this.turnTo !== null && this.third && mv && b.melee.phase < mv.active[0]) {
      const d = this.turnTo - this.facing.yaw;
      this.facing.yaw += Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, dt * 14);
    } else if (!mv) this.turnTo = null;
    if (this.third) {
      // A kill move turns him to the one he's killing and tips his frame to him; nothing else in a fight does.
      if (b.run) this.facing.yaw = v.yaw + Math.PI;
      this.facing.pitchOverride = b.run ? v.pitch : null;
    } else {
      this.yaw = v.yaw;
      this.pitch = v.pitch;
      this.facing.pitchOverride = null;
    }
    this.duelHud ??= new DuelHud(document.body);
    this.duelHud.update(dt, b.duel(v), b.posture / 100, b.stun > 0);
    return out;
  }

  protected override notWalls(): THREE.Object3D[] {
    return this.brawl.thugs.map((t) => t.root);
  }

  override update(dt: number): void {
    if (this.active && !this.frozen) {
      this.dirT -= dt;
      this.dirEl.style.opacity = String(Math.max(0, Math.min(1, this.dirT * 4)));
      // Third person and its zoom are remembered where the city keeps them.
      if (this.viewNow() !== this.remembered) {
        this.remembered = this.viewNow();
        try {
          localStorage.setItem(VIEW_KEYS.third, this.third ? '1' : '0');
          localStorage.setItem(VIEW_KEYS.zoom, this.thirdCam.zoom.toFixed(2));
        } catch {
          /* no storage */
        }
      }
      // (The rig he's in now has the library: a change of clothes is another rig.)
      if (this.rig && this.rig.anims !== this.anims) this.rig.anims = this.anims;
      const m = this.brawl.melee;
      if (this.hand !== 'gun' && !this.riding) this.readAim();
      const shown = this.hand !== 'gun' && m.drawn && !this.riding && !this.brawl.run;
      this.stanceEl.style.opacity = shown ? '1' : '0';
      // The stance (a weapon's, the keyed swings') and where the blow is aimed.
      const stance = this.hand !== 'fists' && m.style === 'keys' ? `${{ high: '\u25B2 HIGH', mid: '\u25C6 MID', low: '\u25BC LOW' }[m.stance]} \u00B7 ` : '';
      if (shown) this.stanceEl.textContent = `${stance}${this.zone}`;
    }
    super.update(dt);
  }

  override exit(): void {
    if (this.active) this.duelHud?.update(0, null, 0, false);
    this.stanceEl.style.opacity = '0';
    super.exit();
  }

  /** The fight in a line (the keys are the page's to show: `keyHelp`, so the duel's bars keep the top of the screen). */
  override hud(): string {
    if (!this.rig || this.riding) return super.hud();
    return `${this.brawl.hud()}${document.pointerLockElement === this.dom ? '' : '\nclick to capture the mouse (Esc frees it, for the panel)'}`;
  }

  /** The keys for what's in hand, a line each. */
  keyHelp(): string[] {
    const inHand =
      this.hand === 'gun'
        ? ['X gun / hands free', 'right button aim · left fire', '(the shotgun close up: a kill move)', 'R reload · G other gun']
        : [
            `X ${this.hand === 'katana' ? 'draw / sheathe' : this.hand === 'bat' ? 'bat up / down' : 'fists up / down'}`,
            this.mouseSwings ? 'left click attack: move the mouse as you click, it goes that way' : 'left click attack: where you aim (his head, his body, his legs) is where it lands; hold it for a heavier blow',
            'running, in the air, stepping back, out of a dodge: an attack of its own',
            ...(this.hand === 'fists' ? [] : [this.autoStance ? 'the stance follows your aim (R / C take it over)' : 'R stance up · C stance down (high: swings come down; low: they rise)', 'H one hand / two (one: wider, quicker, weaker)']),
            'L keyed moves / the library\'s clips',
            this.hand === 'fists' && !this.mouseSwings ? 'left button: the left hand · right button: the right · both together: block' : `right button guard${this.hand === 'katana' ? ' (a click from it: thrust)' : this.hand === 'bat' ? ' (a click from it: jab)' : ''}`,
            'F kick (a stomp on a man down)',
          ];
    return [
      '1 guns · 2 fists · 3 katana · 4 bat',
      ...inHand,
      'sidestep: tap left or right twice (the arrows, or A / D) · E dodges too',
      'T fresh group · B a duel',
      this.brawl.killMoves ? 'Y gore · U kill-move chance' : 'Y gore',
      'WASD move (Shift runs) · Space jump',
      'Q third person (wheel zooms; the camera goes round him, he strikes the way he faces)',
      'F9 a snapshot for a report',
      'V orbit the yard',
      "A duel: swing from the side he isn't guarding; tap the guard as his blow lands to deflect; break his posture for a deathblow",
    ];
  }

  /** For scripted screenshots: the showroom's, and the fight's. */
  override script(): Record<string, unknown> {
    const b = this.brawl;
    return {
      ...super.script(),
      hand: (h: Hand) => this.pick(h),
      attack: (dir: Dir = null) => b.attack(dir),
      strike: (o: { zone?: Zone; doing?: Doing; hand?: 'l' | 'r' } = {}) => b.strike(o),
      aim: () => ({ zone: this.zone, stance: b.melee.stance, auto: this.autoStance, doing: this.doing() }),
      autoStance: (on: boolean) => (this.autoStance = on),
      /** A weapon's swings by stance and zone (from the right), for a sheet of them. */
      zoneMoves: () => (this.hand === 'gun' || this.hand === 'fists' ? [] : STANCES.flatMap((s) => ZONES.map((z) => `${this.hand === 'katana' ? 'kz' : 'bz'}_${s}_${z}_r`))),
      kick: () => b.kick(),
      dodge: (side: -1 | 1) => b.dodge(side),
      move: (id: MoveId) => b.melee.play(id),
      stance: (s: Stance) => b.melee.setStance(s),
      style: (s: Melee['style']) => this.setStyle(s),
      clipMoves: () => (this.hand === 'gun' ? [] : clipAttacksOf(this.hand)),
      /** The attacks of what's in hand, the stances, and the stance a move belongs to (for a sheet of them). */
      moves: () => (this.hand === 'gun' ? [] : attacksOf(this.hand).map((a) => a.id)),
      stances: () => (this.hand === 'gun' || this.hand === 'fists' ? ['mid'] : [...STANCES]),
      stanceOf: (id: MoveId) => (this.hand === 'gun' ? null : (attacksOf(this.hand).find((a) => a.id === id)?.stance ?? null)),
      guard: (on: boolean) => b.guard(on),
      duel: () => b.spawnDuel(this.view()),
      draw: () => b.melee.toggleDrawn(),
      melee: () => b.melee,
      brawl: () => b,
      thug: () => b.thugs[0] ?? null,
      thugs: () => b.thugs,
      spawn: (n = 4) => this.spawn(n),
      gore: (level: GoreLevel) => (b.gore.level = level),
      killChance: (k: number) => (b.killChance = k),
      gunKill: () => this.rig && b.tryGunKill(this.rig, this.frame()),
      forceKill: (id: string) => this.rig && b.forceKill(id, this.rig, this.frame()),
      state: () => b.state(),
    };
  }
}
