import * as THREE from 'three';
import type { FirstPersonRig } from './firstPerson';
import { Gore } from './gore';
import { KILL_CHANCE, KILL_MOVES, KillRun, pickKill, type KillCtx, type KillMove, type KillQuery } from './killMoves';
import { goreSetting, Melee, partFactor, segmentDistance, sweepHit, type Capsule, type Dir, type Doing, type MeleeWeapon, type Zone } from './melee';
import { MeleeSound } from './meleeSound';
import { ELITE, HEALTH, sideOf, Thug, type GuardSide, type Side } from './thug';

/**
 * A fight against a group (models/thug.ts), from Mack's first-person body (models/firstPerson.ts), for any page
 * that has one (the fight page now, fight.html; the city later). Ordinary fighters die in a few blows and hit
 * as hard; several come at once and work round behind you, so the danger is being surrounded. A killing blow
 * rolls the kill-move chance (`killChance`; models/killMoves.ts) and, if it comes up and a move fits, plays it:
 * you're untouchable through it, the others keep coming.
 *
 * A duel (`spawnDuel`: an elite, models/thug.ts) is the other way round: he guards a side and you get through on
 * the others; your guard tapped just as his blow lands deflects it (`DEFLECT`), held it only blocks and costs
 * your posture (`posture`: full, your guard breaks and you reel); his posture fills from blocks and deflects
 * and, broken, he's open: your next blow is a deathblow (a kill move, whatever the odds).
 *
 * The page owns the camera: it hands `step` its view (eyes, yaw, pitch), which the fight may move (a lunge, a
 * kill move's look and carry), then poses the rig with the `dt` it returns (slowed in hit-stop), shakes the
 * view by `shake` and, when `cine` is set, renders from there instead (showing Mack's head).
 */

type V3 = THREE.Vector3;

/** Your health; how much of his blow's damage you take (they hit as hard as you). */
const YOUR_HEALTH = 100;
const ENEMY_DAMAGE = 1.0;
/** At most this many winding up or striking at once, and this long between one starting and the next. */
const MAX_ATTACKING = 3;
const ATTACK_GAP = 0.22;
/** How long before his blow lands a tap of your guard deflects it; your posture, and how fast it drains. */
const DEFLECT = 0.2;
const MY_POSTURE = 100;
const MY_DRAIN = 20;
/** A blow at a man whose guard is broken, without kill moves: more than he has. */
const OPEN_BLOW = 1e4;
/** Damage of a pellet or a bullet. */
const PELLET = 16;
const BULLET = 45;

export interface BrawlView {
  /** Your eyes (world); yaw (0 looks along -z) and pitch (radians, up positive). */
  readonly eye: V3;
  yaw: number;
  pitch: number;
}

export interface BrawlOut {
  /** The world's dt this frame (slowed in hit-stop): pose the rig with it. */
  readonly dt: number;
  readonly shake: number;
  /** Look and move locked (a kill move playing, or you're down). */
  readonly locked: boolean;
  readonly cine: { pos: V3; look: V3 } | null;
}

export class Brawl {
  readonly melee = new Melee();
  readonly thugs: Thug[] = [];
  readonly gore: Gore;
  readonly sound = new MeleeSound();
  hand: 'gun' | MeleeWeapon = 'gun';
  health = YOUR_HEALTH;
  /** Seconds you've been down for (knocked out: the group stands back, then it starts again). */
  down = 0;
  /** Kill moves (models/killMoves.ts): shelved since 2026-10-06 (the user: not a fan of them so far, kept to
   * come back to), so off unless the page's URL asks for them (`?killmoves=<chance>`). Off, a killing blow just
   * kills, and a blow at a man whose guard is broken finishes him. */
  killMoves = false;
  killChance = KILL_CHANCE;
  run: KillRun | null = null;
  lastKill: string | null = null;
  lastHit = '';
  kills = 0;
  /** Your posture (blocking fills it), and how long you're reeling (a guard broken, a blow deflected). */
  posture = 0;
  stun = 0;
  private sincePosture = 99;
  private clock = 0;
  private guardAt = -99;
  private loading = 0;
  private lastRig: FirstPersonRig | null = null;
  private lastView: BrawlView | null = null;
  /** Each spawn's number: a swordsman still loading from an older one stays put away when he arrives. */
  private gen = 0;
  /** The group the last spawn asked for: fighters still loading (from this spawn or an older one) take their
   * places in it as they arrive, the ones past its number put away. */
  private group: { n: number; place: (t: Thug, i: number) => void } = { n: 0, place: () => {} };
  /** Whose models the ordinary fighters are, in turn, and the elite's (models/characters.ts names); `setCast`. */
  private cast: readonly string[] = ['salaryman'];
  private eliteModel = 'salaryman';
  private castGen = 0;
  private sinceHurt = 99;
  private hitstop = 0;
  private shakeV = 0;
  private swingSeen = 0;
  private swingHits = new Set<Thug>();
  private prevStrike: [V3, V3] | null = null;
  private readonly enemyPrev = new Map<Thug, { swing: number; seg: [V3, V3] | null; hit: boolean }>();
  private lastAttack = 99;
  private shotsSeen = 0;
  private focus: V3 | null = null;
  private bleed: { t: number; who: Thug }[] = [];
  private readonly hurtEl: HTMLDivElement;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly floorAt: (x: number, z: number) => number,
    /** A wall within `max` of `from` along `dir` (world), with its normal toward `from`. */
    private readonly probe: (from: V3, dir: V3, max: number) => { point: V3; normal: V3 } | null,
    overlay: HTMLElement,
  ) {
    this.gore = new Gore(scene, floorAt, goreSetting(), overlay);
    this.hurtEl = document.createElement('div');
    Object.assign(this.hurtEl.style, { position: 'fixed', inset: '0', pointerEvents: 'none', opacity: '0', zIndex: '6', background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(150,0,0,0.8) 100%)' });
    overlay.appendChild(this.hurtEl);
    const q = new URLSearchParams(location.search).get('killmoves');
    if (q !== null && Number.isFinite(Number(q))) {
      this.killChance = THREE.MathUtils.clamp(Number(q), 0, 1);
      this.killMoves = this.killChance > 0;
    }
  }

  /** Other people to fight: the ordinary fighters take `mooks`' models in turn, the elite `elite`'s. Those here
   * (and any still loading) are put away for good; the next `spawn` or `spawnDuel` brings on the new ones. */
  setCast(mooks: readonly string[], elite = mooks[0]): void {
    if (mooks.length === 0) return;
    this.cast = [...mooks];
    this.eliteModel = elite;
    this.castGen++;
    this.loading = 0;
    this.gore.clear();
    this.bleed = [];
    this.run = null;
    this.enemyPrev.clear();
    for (const t of this.thugs) this.scene.remove(t.root);
    this.thugs.length = 0;
    this.group = { n: 0, place: () => {} };
  }

  /** Brings on a group of `n` round you (from ahead and the sides), fresh; the blood cleared away. */
  spawn(n: number, view: BrawlView): void {
    this.gore.clear();
    this.bleed = [];
    this.run = null;
    for (const t of this.thugs) if (t.tier === 'elite') t.root.visible = false;
    const mooks = this.thugs.filter((t) => t.tier === 'mook');
    this.gen++;
    const place = (t: Thug, i: number): void => {
      // Spread over an arc ahead of you, a couple of them further round.
      const a = view.yaw + (n > 1 ? (i - (n - 1) / 2) * (2.4 / (n - 1)) : 0);
      const d = 3.2 + (i % 2) * 1.3;
      const x = view.eye.x - Math.sin(a) * d;
      const z = view.eye.z - Math.cos(a) * d;
      t.place(x, this.floorAt(x, z), z, Math.atan2(view.eye.x - x, view.eye.z - z));
    };
    this.group = { n, place };
    mooks.slice(0, n).forEach(place);
    for (const t of mooks.slice(n)) t.root.visible = false;
    for (let i = mooks.length + this.loading; i < n; i++) {
      this.loading++;
      const cast = this.castGen;
      void Thug.load(this.cast[i % this.cast.length], i + 1).then((t) => {
        if (cast !== this.castGen) return;
        this.loading--;
        this.thugs.push(t);
        this.scene.add(t.root);
        const k = this.thugs.filter((x) => x.tier === 'mook').length - 1;
        if (k < this.group.n) this.group.place(t, k);
        else t.root.visible = false;
      });
    }
  }

  /** A duel: one elite (a swordsman) 3 m ahead, the rest put away. */
  spawnDuel(view: BrawlView): void {
    this.gore.clear();
    this.bleed = [];
    this.run = null;
    for (const t of this.thugs) t.root.visible = false;
    this.group = { n: 0, place: () => {} };
    const gen = ++this.gen;
    const place = (t: Thug): void => {
      const x = view.eye.x - Math.sin(view.yaw) * 3.2;
      const z = view.eye.z - Math.cos(view.yaw) * 3.2;
      t.place(x, this.floorAt(x, z), z, Math.atan2(view.eye.x - x, view.eye.z - z));
    };
    const elite = this.thugs.find((t) => t.tier === 'elite');
    if (elite) {
      place(elite);
      return;
    }
    this.loading++;
    const cast = this.castGen;
    void Thug.load(this.eliteModel, 99, { tier: 'elite', weapon: 'katana', name: '剣客 Swordsman' }).then((t) => {
      if (cast !== this.castGen) return;
      this.loading--;
      this.thugs.push(t);
      this.scene.add(t.root);
      if (gen === this.gen) place(t);
      else t.root.visible = false;
    });
  }

  /** Your guard up (the right button) or down; up, a tap deflects for a moment. */
  guard(on: boolean): void {
    if (on && !this.melee.guarding) this.guardAt = this.clock;
    this.melee.guarding = on && this.stun <= 0;
  }

  private addMyPosture(x: number): void {
    this.posture += x;
    this.sincePosture = 0;
    if (this.posture >= MY_POSTURE) {
      // Your guard breaks: reeling, open, for a moment.
      this.posture = 0;
      this.stun = 1.1;
      this.melee.guarding = false;
      this.melee.cancel();
      this.sound.guardBreak();
      this.shakeV = Math.max(this.shakeV, 0.8);
      this.lastHit = 'your guard broke';
    }
  }

  /** The elite you're facing (nearest, up, within 6 m), for the duel's bars and indicator. */
  duel(view: BrawlView): { name: string; health: number; max: number; posture: number; broken: boolean; guard: GuardSide; incoming: Side | null } | null {
    let best: Thug | null = null;
    let bd = 6;
    for (const t of this.thugs) {
      if (t.tier !== 'elite' || !t.root.visible || !t.alive) continue;
      const d = Math.hypot(t.root.position.x - view.eye.x, t.root.position.z - view.eye.z);
      if (d < bd) {
        best = t;
        bd = d;
      }
    }
    if (!best) return null;
    return { name: best.name, health: Math.max(0, best.health), max: best.maxHealth, posture: best.posture / ELITE.posture, broken: best.broken, guard: best.guard, incoming: best.incoming };
  }

  /** The ones still in it. */
  get standing(): number {
    return this.thugs.filter((t) => t.root.visible && t.state !== 'dead').length;
  }

  /** A click to attack, the way the mouse was going. */
  attack(dir: Dir): void {
    if (this.run || this.down > 0 || this.stun > 0) return;
    // An elite open in front of you: the deathblow, whatever you swing.
    if (this.killMoves && this.lastRig && this.lastView && this.melee.drawn) {
      const v = this.lastView;
      const ahead = new THREE.Vector3(-Math.sin(v.yaw), 0, -Math.cos(v.yaw));
      for (const t of this.thugs) {
        if (!t.broken || !t.root.visible) continue;
        const to = t.root.position.clone().sub(v.eye).setY(0);
        if (to.length() < 2.3 && to.normalize().dot(ahead) > 0.7 && this.startKill(t, this.killWeapon, this.lastRig, v)) return;
      }
    }
    const was = this.melee.drawn;
    this.melee.attack(dir);
    if (!was && this.melee.drawn && this.hand === 'katana') this.sound.draw(true);
  }

  /** A click to attack, as it's read now: aimed at a zone, or the attack for what you're doing (`Melee.strike`). */
  strike(o: { zone?: Zone; doing?: Doing; hand?: 'l' | 'r' }): void {
    if (this.run || this.down > 0 || this.stun > 0) return;
    const was = this.melee.drawn;
    this.melee.strike(o);
    if (!was && this.melee.drawn && this.hand === 'katana') this.sound.draw(true);
  }

  /** What a kill move is made with: what's in hand (the guns' own is the shotgun's, asked for apart). */
  private get killWeapon(): MeleeWeapon {
    return this.hand === 'gun' ? 'fists' : this.hand;
  }

  /** A dodge to your left (-1) or right (1). */
  dodge(side: -1 | 1): void {
    if (this.run || this.down > 0 || this.stun > 0 || this.hand === 'gun') return;
    this.melee.dodge(side);
  }

  kick(): void {
    if (this.run || this.down > 0 || this.stun > 0) return;
    // At a man on the floor, it's a stomp.
    const floored = this.thugs.find((t) => t.floored && t.root.visible && this.distTo(t) < 1.6);
    if (floored) this.melee.play('stomp');
    else this.melee.kick();
  }

  private eyeNow = new THREE.Vector3();
  private distTo(t: Thug): number {
    return Math.hypot(t.root.position.x - this.eyeNow.x, t.root.position.z - this.eyeNow.z);
  }

  /** With the shotgun up close: the kill move instead of the shot, if it comes up. */
  tryGunKill(rig: FirstPersonRig, view: BrawlView): boolean {
    if (!this.killMoves || this.run || rig.shells <= 0 || (rig.kind !== 'lever' && rig.kind !== 'double')) return false;
    const fwd = new THREE.Vector3(-Math.sin(view.yaw), 0, -Math.cos(view.yaw));
    let best: Thug | null = null;
    for (const t of this.thugs) {
      if (!t.alive || !t.root.visible || t.floored) continue;
      const to = new THREE.Vector3(t.root.position.x - view.eye.x, 0, t.root.position.z - view.eye.z);
      const d = to.length();
      if (d < 1.9 && to.normalize().dot(fwd) > 0.85 && (!best || d < this.distTo(best))) best = t;
    }
    if (!best || Math.random() >= this.killChance) return false;
    return this.startKill(best, 'shotgun', rig, view);
  }

  /** For checks: kill move `id` on the nearest one up (or on the floor, for a stomp), whatever the odds. */
  forceKill(id: string, rig: FirstPersonRig, view: BrawlView): boolean {
    const def = KILL_MOVES.find((k) => k.id === id);
    if (!def) return false;
    this.eyeNow.copy(view.eye);
    const pool = this.thugs.filter((t) => t.root.visible && (id === 'stomp' ? t.floored : t.alive && !t.floored));
    pool.sort((a, b) => this.distTo(a) - this.distTo(b));
    if (!pool[0]) return false;
    const weapon: KillQuery['weapon'] = id === 'shotgun_jaw' ? 'shotgun' : id === 'run_through' || id === 'decapitate' ? 'katana' : id.startsWith('bat_') ? 'bat' : 'fists';
    return this.startKill(pool[0], weapon, rig, view, def);
  }

  /** Rolls nothing: starts a kill move on `t` if one fits (or `forced`). */
  // (A broken elite's deathblow comes here too, whatever the odds.)
  private startKill(t: Thug, weapon: KillQuery['weapon'], rig: FirstPersonRig, view: BrawlView, forced?: KillMove): boolean {
    const to = new THREE.Vector3(t.root.position.x - view.eye.x, 0, t.root.position.z - view.eye.z);
    const dist = to.length();
    const away = to.clone().normalize();
    const facing = new THREE.Vector3(Math.sin(t.yaw), 0, Math.cos(t.yaw)).dot(away.clone().negate()) > 0.35;
    let wall: { point: V3; normal: V3 } | null = null;
    if (weapon === 'fists' && !t.floored) {
      wall = this.probe(t.bone('spine_02').getWorldPosition(new THREE.Vector3()), away, 1.7);
      if (wall && wall.normal.dot(away) > 0) wall.normal.negate();
      if (wall && Math.abs(wall.normal.y) > 0.5) wall = null;
    }
    const q: KillQuery = { weapon, floored: t.floored, wall: !!wall, dist, facing };
    const def = forced ?? pickKill(q, this.lastKill);
    if (!def || (def.id === 'wall_slam' && !wall)) return false;
    const fwd = new THREE.Vector3(-Math.sin(view.yaw), 0, -Math.cos(view.yaw));
    const right = new THREE.Vector3(Math.cos(view.yaw), 0, -Math.sin(view.yaw));
    const gun = rig.gun;
    gun.root.updateMatrixWorld(true);
    const viewQ = (): THREE.Quaternion => new THREE.Quaternion().setFromEuler(new THREE.Euler(view.pitch, view.yaw, 0, 'YXZ'));
    const ctx: KillCtx = {
      victim: t,
      gore: this.gore,
      sound: this.sound,
      eye: () => view.eye.clone(),
      fwd,
      right,
      toView: (p) => p.clone().sub(view.eye).applyQuaternion(viewQ().invert()),
      toViewDir: (d) => d.clone().applyQuaternion(viewQ().invert()),
      start: rig.lastPose,
      hand: (s) => rig.handWorld(s),
      blade: () => {
        const s = rig.strike('blade');
        return [s.a, s.b];
      },
      gunMuzzle: gun.muzzles[0].clone(),
      gunStart: weapon === 'shotgun' ? { pos: gun.root.position.clone(), quat: gun.root.quaternion.clone() } : null,
      fire: () => {
        rig.aiming = true;
        rig.fire();
        this.shotsSeen = rig.shotsFired;
      },
      wall,
      shake: (k) => (this.shakeV = Math.max(this.shakeV, k)),
      hitstop: (s) => (this.hitstop = Math.max(this.hitstop, s)),
    };
    this.melee.cancel();
    // (A kill move ends at the weapon's guard: the mid stance.)
    this.melee.setStance('mid', true);
    this.run = new KillRun(def, ctx);
    this.lastKill = def.id;
    this.lastHit = `kill move: ${def.label}`;
    this.kills++;
    this.focus = null;
    return true;
  }

  /** Your capsules (head and body, from your eyes). */
  private yourParts(eye: V3, yaw: number): Capsule[] {
    const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(0.08);
    return [
      { name: 'head', a: eye.clone().add(new THREE.Vector3(0, -0.06, 0)).add(back), b: eye.clone().add(new THREE.Vector3(0, 0.08, 0)).add(back), r: 0.13 },
      { name: 'torso', a: eye.clone().add(new THREE.Vector3(0, -0.32, 0)).add(back), b: eye.clone().add(new THREE.Vector3(0, -0.95, 0)).add(back), r: 0.22 },
    ];
  }

  step(realDt: number, rig: FirstPersonRig, view: BrawlView): BrawlOut {
    this.eyeNow.copy(view.eye);
    this.lastRig = rig;
    this.lastView = view;
    this.clock += realDt;
    this.stun = Math.max(0, this.stun - realDt);
    if (this.stun > 0) this.melee.guarding = false;
    this.sincePosture += realDt;
    if (this.sincePosture > 1) this.posture = Math.max(0, this.posture - MY_DRAIN * realDt);
    this.hitstop -= realDt;
    const dt = this.hitstop > 0 ? realDt * 0.08 : realDt;
    this.shakeV = Math.max(0, this.shakeV - realDt * 3.5);
    let cine: BrawlOut['cine'] = null;
    const g = this.gore;
    // A kill move playing: it has you (and him).
    if (this.run) {
      if (this.focus) {
        const to = this.focus.clone().sub(view.eye);
        const yaw = Math.atan2(-to.x, -to.z);
        const pitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
        let dy = yaw - view.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        const k = Math.min(1, realDt * 9);
        view.yaw += dy * k;
        view.pitch += (THREE.MathUtils.clamp(pitch, -1.2, 0.8) - view.pitch) * k;
      }
      const r = this.run.step(dt);
      this.focus = r.focus;
      if (r.mackAt) view.eye.set(r.mackAt.x, view.eye.y, r.mackAt.z);
      rig.poseOverride = r.pose;
      rig.gunOverride = r.gun;
      cine = r.cine;
      if (this.run.done) {
        const victim = this.run.c.victim;
        if (this.run.def.bleeds) this.bleed.push({ t: 0.9, who: victim });
        this.run = null;
        rig.poseOverride = null;
        rig.gunOverride = null;
        this.focus = null;
      }
    } else {
      rig.poseOverride = null;
      rig.gunOverride = null;
    }
    if (this.hand !== 'gun') this.melee.update(dt);
    // A new swing of yours: its whoosh, and it's hit no one yet.
    const m = this.melee;
    if (m.swing !== this.swingSeen) {
      this.swingSeen = m.swing;
      this.swingHits.clear();
      this.prevStrike = null;
      const mv = m.move;
      if (mv && mv.hitter) {
        setTimeout(() => this.sound.whoosh(mv.hitter === 'blade', mv.id === 'kick' ? 1.3 : mv.hitter === 'bat' ? 1.6 : 1), (mv.time * mv.active[0] * 600) / Math.max(0.05, m.rate));
        // An elite near you reads it (by his skill) and moves his guard to meet it.
        for (const t of this.thugs) if (t.tier === 'elite' && t.root.visible && this.distTo(t) < 3) t.noticeSwing(sideOf(mv.id));
      }
    }
    const lunge = m.lungeSpeed;
    if (lunge > 0 && !this.run) {
      view.eye.x += -Math.sin(view.yaw) * lunge * dt;
      view.eye.z += -Math.cos(view.yaw) * lunge * dt;
    }
    // A dodge carries you sideways.
    const slide = m.slideSpeed;
    if (slide !== 0 && !this.run) {
      view.eye.x += Math.cos(view.yaw) * slide * dt;
      view.eye.z += -Math.sin(view.yaw) * slide * dt;
    }
    // Not through them while they're up.
    for (const t of this.thugs) {
      if (!t.alive || !t.root.visible || t.floored) continue;
      const dx = view.eye.x - t.root.position.x;
      const dz = view.eye.z - t.root.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.45 && d > 1e-3) {
        view.eye.x = t.root.position.x + (dx / d) * 0.45;
        view.eye.z = t.root.position.z + (dz / d) * 0.45;
      }
    }
    // Your blows.
    const h = m.striking;
    if (h && m.move && !this.run) {
      const seg = rig.strike(h);
      if (this.prevStrike) {
        const mv = m.move;
        // A blade or a bat can catch two in one swing.
        const most = mv.hitter === 'blade' || mv.hitter === 'bat' ? 2 : 1;
        for (const t of this.thugs) {
          if (this.swingHits.size >= most) break;
          if (this.swingHits.has(t) || !t.root.visible || t.state === 'dead' || t.state === 'scripted') continue;
          const hit = sweepHit(this.prevStrike, [seg.a, seg.b], seg.r, t.parts());
          if (!hit) continue;
          this.swingHits.add(t);
          const dir = seg.b.clone().sub(this.prevStrike[1]);
          if (dir.lengthSq() < 1e-6) dir.set(-Math.sin(view.yaw), 0, -Math.cos(view.yaw));
          dir.normalize();
          // (Without kill moves, a blow at an elite whose guard is broken finishes him.)
          const open = t.tier === 'elite' && t.broken && !this.killMoves;
          const info = { point: hit.point, dir, part: hit.part.name, damage: open ? OPEN_BLOW : mv.damage * m.power, force: mv.force * m.power, cut: mv.cut, move: mv.id, hitter: h };
          const weaponNow = this.killWeapon;
          if (t.tier === 'elite') {
            // Guard broken: the deathblow.
            if (t.broken && this.killMoves && this.startKill(t, weaponNow, rig, view)) break;
            const res = t.defend(sideOf(mv.id));
            if (res !== 'none') {
              this.gore.sparks(hit.point, res === 'deflect' ? 16 : 8);
              this.melee.cancel();
              this.hitstop = Math.max(this.hitstop, 0.06);
              this.shakeV = Math.max(this.shakeV, 0.3);
              if (res === 'block') {
                this.sound.block(t.weapon === 'katana');
                t.addPosture(mv.damage * 0.45);
                this.lastHit = 'he blocked it';
              } else {
                this.sound.deflect(t.weapon === 'katana');
                this.addMyPosture(30);
                this.stun = Math.max(this.stun, 0.5);
                t.addPosture(4);
                this.lastHit = 'he deflected you';
              }
              break;
            }
          }
          // A killing blow rolls for a kill move.
          if (this.killMoves && t.healthAfter(info) <= 0 && Math.random() < this.killChance && this.startKill(t, weaponNow, rig, view)) break;
          t.hit(info);
          t.addPosture(mv.damage * 0.25);
          const strength = Math.min(1, mv.damage / 45);
          g.hit(hit.point, dir, mv.cut, strength, hit.part.name, t.boneOf(hit.part.name), view.eye);
          const byBat = mv.hitter === 'bat';
          if (mv.cut) this.sound.cut(g.level !== 'off');
          else if (byBat) this.sound.knock(strength);
          else this.sound.thud(mv.id === 'kick' || mv.id === 'stomp' ? 1 : strength);
          // The bat comes away bloody from a head.
          if (byBat && g.level !== 'off' && (hit.part.name === 'head' || hit.part.name === 'neck')) g.blade = Math.min(g.level === 'full' ? 1 : 0.35, g.blade + (g.level === 'full' ? 0.4 : 0.12));
          this.hitstop = Math.max(this.hitstop, mv.cut ? 0.075 : byBat ? 0.085 : mv.id === 'kick' ? 0.07 : 0.05);
          this.shakeV = Math.max(this.shakeV, mv.cut || byBat ? 0.5 : 0.35);
          this.lastHit = `${mv.id} → ${hit.part.name}`;
          if ((t.state as string) === 'dead') {
            this.kills++;
            if (mv.cut) this.bleed.push({ t: 1.1, who: t });
          }
        }
      }
      this.prevStrike = [seg.a, seg.b];
    } else this.prevStrike = null;
    // Shots (the gun in hand): pellets or a bullet along the bore from the muzzle.
    if (this.hand === 'gun' && rig.shotsFired !== this.shotsSeen) {
      this.shotsSeen = rig.shotsFired;
      this.shoot(rig, view.eye);
    }
    // Theirs.
    const ctx = {
      you: view.eye,
      youYaw: view.yaw,
      others: this.thugs,
      floorAt: this.floorAt,
      mayAttack: () => this.down <= 0 && this.lastAttack > ATTACK_GAP && this.thugs.filter((x) => x.tell > 0 || x.melee.move).length < MAX_ATTACKING,
      attacked: () => (this.lastAttack = 0),
    };
    this.lastAttack += dt;
    const right = new THREE.Vector3(Math.cos(view.yaw), 0, -Math.sin(view.yaw));
    const ahead = new THREE.Vector3(-Math.sin(view.yaw), 0, -Math.cos(view.yaw));
    for (const t of this.thugs) {
      if (!t.root.visible) continue;
      const ev = t.update(dt, ctx);
      if (ev.tell) {
        const to = t.root.position.clone().sub(view.eye).setY(0);
        const d = to.length();
        this.sound.tell(to.normalize().dot(right), 1 / (1 + d * 0.35));
      }
      // His blow, swept against you.
      const hs = t.melee.striking;
      let rec = this.enemyPrev.get(t);
      if (!rec || rec.swing !== t.melee.swing) {
        rec = { swing: t.melee.swing, seg: null, hit: false };
        this.enemyPrev.set(t, rec);
      }
      if (hs && t.alive) {
        const s = t.strike(hs);
        if (rec.seg && !rec.hit && !this.run && this.down <= 0) {
          const hit = sweepHit(rec.seg, [s.a, s.b], s.r, this.yourParts(view.eye, view.yaw));
          if (hit) {
            rec.hit = true;
            const from = t.root.position.clone().sub(view.eye).setY(0).normalize();
            const mv = t.melee.move!;
            const dmg = mv.damage * (t.tier === 'elite' ? ELITE.damage[t.weapon] : ENEMY_DAMAGE) * (hit.part.name === 'head' ? 1.2 : 1);
            const guarding = this.hand !== 'gun' && m.guarding && !m.move && this.stun <= 0 && from.dot(ahead) > 0.42;
            const steel = this.hand === 'katana' || t.weapon === 'katana';
            if (this.hand !== 'gun' && m.evading) {
              // Dodged: it goes past.
              this.lastHit = 'dodged';
            } else if (guarding && this.clock - this.guardAt < DEFLECT) {
              // Deflected: turned aside at the last moment; he reels, his posture takes it.
              t.blocked();
              t.addPosture(t.tier === 'elite' ? 34 : 0);
              this.gore.sparks(s.b, steel ? 18 : 4);
              this.sound.deflect(steel);
              this.hitstop = Math.max(this.hitstop, 0.07);
              this.shakeV = Math.max(this.shakeV, 0.3);
              this.lastHit = 'deflected';
            } else if (guarding) {
              t.blocked();
              this.sound.block(steel);
              if (steel) this.gore.sparks(s.b, 6);
              this.shakeV = Math.max(this.shakeV, 0.2);
              this.lastHit = 'blocked';
              this.addMyPosture(dmg * 0.8);
            } else {
              this.health -= dmg;
              this.sinceHurt = 0;
              this.sound.hurt();
              this.shakeV = Math.max(this.shakeV, mv.id === 'kick' ? 0.9 : 0.65);
              this.hurtEl.style.opacity = '1';
              this.lastHit = `hit by a ${mv.id}${from.dot(ahead) < 0 ? ' from behind' : ''}`;
              // A kick knocks you out of your own move.
              if (mv.id === 'kick') this.melee.cancel();
              // A shove the way the blow went.
              const push = s.b.clone().sub(rec.seg[1]).setY(0);
              if (push.lengthSq() > 1e-6) view.eye.addScaledVector(push.normalize(), mv.id === 'kick' ? 0.35 : 0.08);
              if (this.health <= 0) {
                this.health = 0;
                this.down = 3;
                this.melee.cancel();
                this.lastHit = 'you went down';
              }
            }
          }
        }
        rec.seg = [s.a, s.b];
      } else rec.seg = null;
    }
    // The dead bleed out.
    for (let i = this.bleed.length - 1; i >= 0; i--) {
      const b = this.bleed[i];
      b.t -= dt;
      if (b.t <= 0) {
        g.bleedOut(b.who.bone('spine_02').getWorldPosition(new THREE.Vector3()), 0.9 + Math.random() * 0.4);
        this.bleed.splice(i, 1);
      }
    }
    // You: getting your breath back; down, then up to a fresh group.
    this.sinceHurt += dt;
    if (this.sinceHurt > 4 && this.down <= 0) this.health = Math.min(YOUR_HEALTH, this.health + 5 * dt);
    if (this.down > 0) {
      this.down -= realDt;
      this.hurtEl.style.opacity = '1';
      if (this.down <= 0) {
        this.health = YOUR_HEALTH;
        this.spawn(Math.max(3, this.thugs.length), view);
      }
    } else this.hurtEl.style.opacity = String(Math.max(0, Number(this.hurtEl.style.opacity) - realDt * 1.6));
    g.viewer.copy(view.eye);
    g.update(dt);
    rig.katana.setBlood(g.blade);
    rig.bat.setBlood(g.blade);
    return { dt, shake: this.shakeV, locked: !!this.run || this.down > 0, cine };
  }

  /** A shot: each pellet (or the bullet) along the bore, spread, against everyone's capsules; the nearest it
   * meets takes it. */
  private shoot(rig: FirstPersonRig, eye: V3): void {
    const gun = rig.gun;
    const muzzle = rig.muzzle();
    const bore = rig.boreDir();
    const n = gun.pellets ?? 1;
    const spread = gun.spread ?? 0.01;
    const per = n > 1 ? PELLET : BULLET;
    const took = new Map<Thug, { dmg: number; point: V3; part: string; hits: number }>();
    const c1 = new THREE.Vector3();
    const c2 = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const dir = bore.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2).multiplyScalar(spread)).normalize();
      const end = muzzle.clone().addScaledVector(dir, 40);
      let best: { t: Thug; part: Capsule; d: number; p: V3 } | null = null;
      for (const t of this.thugs) {
        if (!t.root.visible || t.state === 'dead' || t.state === 'scripted') continue;
        for (const p of t.parts()) {
          if (segmentDistance(muzzle, end, p.a, p.b, c1, c2) > p.r) continue;
          const d = c1.distanceTo(muzzle);
          if (!best || d < best.d) best = { t, part: p, d, p: c1.clone() };
        }
      }
      if (!best) continue;
      const rec = took.get(best.t) ?? { dmg: 0, point: best.p, part: best.part.name, hits: 0 };
      rec.dmg += per * partFactor(best.part.name);
      rec.hits++;
      took.set(best.t, rec);
    }
    for (const [t, r] of took) {
      t.hit({ point: r.point, dir: bore, part: r.part, damage: r.dmg, force: n > 1 ? 3 : 1, cut: true, move: 'jab', hitter: 'fist_r' });
      this.gore.hit(r.point, bore, true, Math.min(1, r.hits / 5 + 0.3), r.part, t.boneOf(r.part), eye);
      if (t.state === 'dead') {
        this.kills++;
        this.bleed.push({ t: 1, who: t });
      }
      this.lastHit = `${n > 1 ? 'shotgun' : 'pistol'} → ${r.part}`;
    }
  }

  hud(): string {
    const m = this.melee;
    const what = this.hand === 'gun' ? 'gun' : this.hand === 'katana' ? (m.drawn ? 'katana drawn' : 'katana sheathed') : this.hand === 'bat' ? (m.drawn ? 'bat up' : 'bat down') : m.drawn ? 'fists up' : 'hands down';
    const stance = (this.hand === 'gun' || !m.drawn ? '' : m.style === 'clips' ? ' · library swings' : this.hand === 'fists' ? '' : ` · ${m.stance} stance${m.oneHand ? ' · one hand' : ''}`) + (m.heavy ? ' · HEAVY' : '');
    return `FIGHTING · ${what}${stance}${m.move ? ` · ${m.move.id}` : ''}${this.stun > 0 ? ' · REELING' : ''}${m.guard > 0.5 ? ' · guarding' : ''} · you ${Math.round(this.health)}${this.down > 0 ? ' (DOWN)' : ''} · ${this.standing} standing · ${this.kills} down${this.killMoves ? ` · kill moves ${Math.round(this.killChance * 100)}%` : ''} · gore ${this.gore.level}${this.lastHit ? ` · ${this.lastHit}` : ''}`;
  }

  /** For checks: the state in brief. */
  state(): Record<string, unknown> {
    return { health: Math.round(this.health), lastHit: this.lastHit, kills: this.kills, run: this.run?.def.id ?? null, thugs: this.thugs.map((t) => ({ state: t.state, health: Math.round(t.health) })) };
  }
}

export { HEALTH as THUG_HEALTH };
