import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { attacksOf, BAT_GUARD, clipAttacksOf, COMBO, DIRECTED, goreSetting, lerpSword, Melee, MOVES, partFactor, segmentDistance, STANCE_REST, STANCES, SWORD_GUARD, sweepHit, type Capsule, type SwordKey } from '../src/poc3d/models/melee';

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const sheath: SwordKey = { p: v(-0.2, -0.75, 0.1), dir: v(0, -0.3, 1).normalize(), edge: v(0, 1, 0.3).normalize() };

/** Runs the state for `secs` in small steps. */
function run(m: Melee, secs: number): void {
  for (let t = 0; t < secs; t += 1 / 120) m.update(1 / 120);
}

describe('melee moves', () => {
  it('every move has keys from 0 to 1 and an active window inside it', () => {
    for (const mv of Object.values(MOVES)) {
      expect(mv.keys[0].t).toBe(0);
      expect(mv.keys[mv.keys.length - 1].t).toBe(1);
      for (let i = 1; i < mv.keys.length; i++) expect(mv.keys[i].t).toBeGreaterThanOrEqual(mv.keys[i - 1].t);
      expect(mv.active[0]).toBeLessThanOrEqual(mv.active[1]);
    }
  });

  it('a click with the fists down puts them up; then the combo runs jab, cross, hook, uppercut', () => {
    const m = new Melee();
    m.attack();
    expect(m.drawn).toBe(true);
    expect(m.move).toBeNull();
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      m.attack();
      seen.push(m.move!.id);
      run(m, m.move!.time + 0.05);
    }
    expect(seen).toEqual(['jab', 'cross', 'hook', 'uppercut']);
  });

  it('a click late in a move queues the next; a pause starts the combo over', () => {
    const m = new Melee();
    m.drawn = true;
    m.attack();
    run(m, MOVES.jab.time * 0.6);
    m.attack();
    run(m, MOVES.jab.time * 0.5);
    expect(m.move?.id).toBe('cross');
    run(m, 2);
    m.attack();
    expect(m.move?.id).toBe('jab');
  });

  it('a click early in a move is ignored', () => {
    const m = new Melee();
    m.drawn = true;
    m.attack();
    run(m, 0.02);
    m.attack();
    run(m, MOVES.jab.time + 0.05);
    expect(m.move).toBeNull();
  });

  it('strikes only in its active window', () => {
    const m = new Melee();
    m.drawn = true;
    m.attack();
    const hits: boolean[] = [];
    for (let t = 0; t < MOVES.jab.time; t += 0.01) {
      hits.push(m.striking === 'fist_l');
      m.update(0.01);
    }
    expect(hits[0]).toBe(false);
    expect(hits.some((h) => h)).toBe(true);
    expect(hits[hits.length - 1]).toBe(false);
  });

  it('the katana draws, cuts in turn, thrusts from the guard and sheathes', () => {
    const m = new Melee();
    m.setWeapon('katana');
    m.toggleDrawn();
    expect(m.move?.id).toBe('draw');
    // Drawing starts from the saya.
    expect(m.pose(sheath).sword!.p.distanceTo(sheath.p)).toBeLessThan(1e-6);
    run(m, MOVES.draw.time + 0.05);
    expect(m.drawn).toBe(true);
    expect(m.pose(sheath).sword!.p.distanceTo(SWORD_GUARD.p)).toBeLessThan(1e-6);
    m.attack();
    expect(m.move?.id).toBe('slashR');
    run(m, MOVES.slashR.time + 0.05);
    m.attack();
    expect(m.move?.id).toBe('slashL');
    run(m, 2);
    m.guarding = true;
    m.attack();
    expect(m.move?.id).toBe('thrust');
    run(m, 2);
    m.guarding = false;
    m.toggleDrawn();
    run(m, MOVES.sheathe.time + 0.05);
    expect(m.drawn).toBe(false);
    expect(m.pose(sheath).sword).toBeNull();
  });

  it('a kick lifts the foot and puts it back', () => {
    const m = new Melee();
    m.drawn = true;
    m.kick();
    expect(m.pose(sheath).foot).toBeNull();
    run(m, MOVES.kick.time * 0.5);
    const f = m.pose(sheath).foot!;
    expect(f.w).toBeCloseTo(1, 1);
    expect(f.p.y).toBeGreaterThan(0.8);
    run(m, MOVES.kick.time);
    expect(m.pose(sheath).foot).toBeNull();
  });

  it('the sword turns on its arc with its edge square to the blade', () => {
    const b: SwordKey = { p: v(0, -0.2, -0.4), dir: v(-1, 0, -0.3).normalize(), edge: v(0, -1, 0) };
    for (let u = 0; u <= 1; u += 0.1) {
      const k = lerpSword(SWORD_GUARD, b, u);
      expect(k.dir.length()).toBeCloseTo(1, 5);
      expect(Math.abs(k.dir.dot(k.edge))).toBeLessThan(1e-5);
    }
  });
});

describe('hits', () => {
  it('measures segments', () => {
    expect(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(0.5, 1, -1), v(0.5, 1, 1))).toBeCloseTo(1, 6);
    expect(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(2, 0, 0), v(3, 0, 0))).toBeCloseTo(1, 6);
    expect(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(0, 2, 0), v(1, 2, 0))).toBeCloseTo(2, 6);
  });

  const body: Capsule[] = [
    { name: 'torso', a: v(0, 0.9, 0), b: v(0, 1.4, 0), r: 0.17 },
    { name: 'head', a: v(0, 1.55, 0), b: v(0, 1.68, 0), r: 0.1 },
  ];

  it('a blade swept through a body cuts it, though both ends of the sweep are clear of it', () => {
    // From right of him to left of him at chest height, in one frame.
    const hit = sweepHit([v(0.6, 1.2, -0.3), v(1.3, 1.2, -0.3)], [v(-0.6, 1.2, 0.2), v(-1.3, 1.2, 0.2)], 0.012, body);
    expect(hit?.part.name).toBe('torso');
  });

  it('a swing over his head misses', () => {
    expect(sweepHit([v(0.6, 2.0, 0), v(1.3, 2.0, 0)], [v(-0.6, 2.0, 0), v(-1.3, 2.0, 0)], 0.012, body)).toBeNull();
  });

  it('a jab to the face finds the head', () => {
    const hit = sweepHit([v(0, 1.62, -0.6), v(0, 1.62, -0.5)], [v(0, 1.62, -0.25), v(0, 1.62, -0.12)], 0.045, body);
    expect(hit?.part.name).toBe('head');
  });

  it('the head and neck take more, the limbs less', () => {
    expect(partFactor('head')).toBeGreaterThan(1);
    expect(partFactor('neck')).toBeGreaterThan(1);
    expect(partFactor('torso')).toBe(1);
    expect(partFactor('lowerarm_l')).toBeLessThan(1);
  });

  it('gore follows the URL first', () => {
    expect(goreSetting('?gore=low')).toBe('low');
    expect(goreSetting('?gore=off')).toBe('off');
    expect(['full', 'low', 'off']).toContain(goreSetting('?gore=nonsense'));
  });
});

describe('directions and enemies', () => {
  it('a swing goes the way the mouse moved', () => {
    const fists = new Melee();
    fists.drawn = true;
    fists.attack('left');
    expect(fists.move?.id).toBe('hookR');
    const sword = new Melee();
    sword.setWeapon('katana');
    sword.drawn = true;
    sword.attack('down');
    expect(sword.move?.id).toBe('overhead');
    sword.cancel();
    sword.attack('up');
    expect(sword.move?.id).toBe('thrust');
  });
});

describe('stances and swings', () => {
  it('each stance has its own swings: they come down from high, across from mid, and rise from low', () => {
    const m = new Melee();
    m.setWeapon('katana');
    m.drawn = true;
    const from = (stance: (typeof STANCES)[number], dir: 'left' | 'right' | 'up' | 'down'): string => {
      m.cancel();
      m.setStance(stance, true);
      m.attack(dir);
      return m.move!.id;
    };
    expect(from('high', 'left')).toBe('slashR');
    expect(from('high', 'down')).toBe('overhead');
    expect(from('mid', 'left')).toBe('sideR');
    expect(from('mid', 'right')).toBe('sideL');
    expect(from('low', 'left')).toBe('rising');
    expect(from('low', 'up')).toBe('upcut');
    expect(from('low', 'down')).toBe('legCut');
    // Every stance's every direction and combo is a move that strikes with that weapon.
    for (const w of ['katana', 'bat'] as const)
      for (const s of STANCES)
        for (const id of [...COMBO[w][s], ...Object.values(DIRECTED[w][s])]) expect(MOVES[id].hitter).toBe(w === 'katana' ? 'blade' : 'bat');
    expect(attacksOf('katana').length).toBeGreaterThanOrEqual(11);
    expect(attacksOf('bat').length).toBeGreaterThanOrEqual(10);
  });

  it('a change of stance eases the weapon over, and waits for a move to end', () => {
    const m = new Melee();
    m.setWeapon('katana');
    m.drawn = true;
    m.setStance('high');
    const part = m.pose(sheath).sword!.p;
    expect(part.distanceTo(SWORD_GUARD.p)).toBeLessThan(1e-6);
    run(m, 0.5);
    expect(m.pose(sheath).sword!.p.distanceTo(STANCE_REST.katana.high.p)).toBeLessThan(1e-6);
    m.attack();
    m.shiftStance(-1);
    expect(m.stance).toBe('high');
    run(m, 2);
    expect(m.stance).toBe('mid');
    m.shiftStance(-1);
    m.shiftStance(-1);
    expect(m.stance).toBe('low');
  });

  it('a swing is a whole arm: the hands go from over the head to the hips, out to arm\'s length between', () => {
    const k = MOVES.overhead.keys.map((key) => key.sword).filter((s): s is SwordKey => !!s && s !== 'sheath');
    const ys = k.map((s) => s.p.y);
    expect(Math.max(...ys)).toBeGreaterThan(0.1);
    expect(Math.min(...ys)).toBeLessThan(-0.5);
    expect(Math.min(...k.map((s) => s.p.z))).toBeLessThan(-0.45);
    // Wound up, the blade lies right back behind his head; at the end, forward and down.
    expect(k[0].dir.y).toBeGreaterThan(0);
    expect(k[0].dir.z).toBeGreaterThan(0.9);
    expect(k[k.length - 1].dir.y).toBeLessThan(-0.3);
    // A level swing from the right starts on the right and ends on the left, the blade square to its travel.
    const side = MOVES.sideR.keys.map((key) => key.sword).filter((s): s is SwordKey => !!s && s !== 'sheath');
    expect(side[0].p.x).toBeGreaterThan(0.2);
    expect(side[side.length - 1].p.x).toBeLessThan(-0.15);
    for (const s of side) expect(Math.abs(s.dir.dot(s.edge))).toBeLessThan(1e-6);
    // And its mirror is its mirror.
    expect(MOVES.sideL.keys[1].sword).toMatchObject({ p: { x: -side[0].p.x } });
  });

  it('a swing the stance is already wound up for is quicker', () => {
    const time = (stance: 'mid' | 'high'): number => {
      const m = new Melee();
      m.setWeapon('katana');
      m.drawn = true;
      m.setStance(stance, true);
      m.attack('down');
      let t = 0;
      while (m.move && t < 3) {
        m.update(1 / 240);
        t += 1 / 240;
      }
      return t;
    };
    expect(time('mid')).toBeCloseTo(MOVES.overhead.time, 1);
    expect(time('high')).toBeLessThan(MOVES.overhead.time * 0.85);
  });

  it('the bat comes up from his side, swings, jabs from the guard and goes back down', () => {
    const m = new Melee();
    m.setWeapon('bat');
    expect(m.pose(sheath).sword).toBeNull();
    m.attack();
    expect(m.move?.id).toBe('batReady');
    expect(m.pose(sheath).sword!.p.distanceTo(sheath.p)).toBeLessThan(1e-6);
    expect(m.pose(sheath).leftOnSaya).toBe(true);
    run(m, MOVES.batReady.time + 0.05);
    expect(m.drawn).toBe(true);
    expect(m.pose(sheath).sword!.p.distanceTo(BAT_GUARD.p)).toBeLessThan(1e-6);
    m.attack();
    expect(m.move?.id).toBe('batR');
    expect(MOVES.batR.cut).toBe(false);
    run(m, 2);
    m.guarding = true;
    m.attack();
    expect(m.move?.id).toBe('batJab');
    run(m, 2);
    m.guarding = false;
    m.toggleDrawn();
    expect(m.move?.id).toBe('batLower');
    run(m, MOVES.batLower.time + 0.05);
    expect(m.drawn).toBe(false);
    expect(m.pose(sheath).sword).toBeNull();
  });

  it('a swing is the whole body: the hips load back and lead it through, he sinks, a foot steps in', () => {
    const k = MOVES.batR.keys.filter((key) => key.legs);
    const hips = k.map((key) => key.legs!.hips);
    expect(Math.min(...hips)).toBeLessThan(-0.6);
    expect(Math.max(...hips)).toBeGreaterThan(0.7);
    // The hips are ahead of the chest on the way through (the chest's turn is on top of theirs).
    const through = k[2];
    expect(through.legs!.hips).toBeGreaterThan(0);
    expect(through.twist!).toBeLessThan(0);
    // From the right, the left foot steps in and the right is left behind; he's lowest as it lands.
    expect(Math.max(...k.map((key) => key.legs!.l.z))).toBeGreaterThan(0.25);
    expect(Math.min(...k.map((key) => key.legs!.r.z))).toBeLessThan(-0.08);
    expect(Math.max(...k.map((key) => key.legs!.sink))).toBeGreaterThan(0.12);
    // Its mirror steps with the other foot, the hips the other way.
    const m = MOVES.batL.keys.filter((key) => key.legs);
    expect(m[0].legs!.hips).toBeCloseTo(-k[0].legs!.hips);
    expect(Math.max(...m.map((key) => key.legs!.r.z))).toBeGreaterThan(0.25);
    // A cut straight down doesn't turn the hips; it steps in and sinks.
    expect(MOVES.overhead.keys.filter((key) => key.legs).every((key) => Math.abs(key.legs!.hips) < 1e-9)).toBe(true);
  });

  it('a swing loads further back than its stance holds the weapon: the bat behind his head', () => {
    const wound = MOVES.batR.keys[1].sword as SwordKey;
    // Level from the right: the barrel points back and across behind him, his hands back by the shoulder.
    expect(wound.dir.z).toBeGreaterThan(0.7);
    expect(wound.dir.x).toBeLessThan(-0.2);
    expect(wound.p.z).toBeGreaterThan(-0.05);
    expect(wound.p.y).toBeGreaterThan(-0.25);
    // And it comes round the long way: no step between keys turns it half a circle or more.
    for (const id of ['batR', 'batDown', 'slashR', 'overhead', 'rising'] as const) {
      const s = MOVES[id].keys.map((key) => key.sword).filter((x): x is SwordKey => !!x && x !== 'sheath');
      for (let i = 1; i < s.length; i++) expect(s[i].dir.angleTo(s[i - 1].dir)).toBeLessThan(2.6);
    }
  });

  it('in one hand the same swings are wider, quicker and weaker, the left hand off the weapon', () => {
    const two = new Melee();
    two.setWeapon('bat');
    two.drawn = true;
    const one = new Melee();
    one.setWeapon('bat');
    one.drawn = true;
    one.oneHand = true;
    expect(one.power).toBeLessThan(1);
    expect(two.power).toBe(1);
    expect(one.pose(sheath).leftOnSaya).toBe(true);
    expect(one.pose(sheath).single).toBe(true);
    expect(one.pose(sheath).sword!.p.x).toBeGreaterThan(two.pose(sheath).sword!.p.x);
    two.attack('left');
    one.attack('left');
    expect(one.move?.id).toBe(two.move?.id);
    run(two, 0.3);
    run(one, 0.3);
    expect(one.phase).toBeGreaterThan(two.phase);
  });

  it("the library's swings: a click plays a clip by the mouse's way, the pose says which and when", () => {
    const m = new Melee();
    m.setWeapon('katana');
    m.drawn = true;
    m.style = 'clips';
    expect(m.pose(sheath).single).toBe(true);
    m.attack('left');
    expect(m.move?.id).toBe('swAttack');
    expect(m.move?.clip?.[0].name).toBe('Sword_Attack');
    expect(m.pose(sheath).clip).toMatchObject({ name: 'Sword_Attack', time: 0, weight: 0 });
    run(m, 0.5);
    const c = m.pose(sheath).clip!;
    expect(c.weight).toBe(1);
    expect(c.time).toBeCloseTo(0.5, 1);
    expect(m.striking).toBe('blade');
    run(m, 2);
    expect(m.move).toBeNull();
    expect(m.pose(sheath).clip).toBeFalsy();
    // A move of two clips goes on to the second, counting its time from that clip's start.
    m.attack('right');
    expect(m.move?.id).toBe('swRise');
    run(m, 0.7);
    expect(m.pose(sheath).clip).toMatchObject({ name: 'Sword_Regular_A_Rec' });
    expect(m.pose(sheath).clip!.time).toBeLessThan(0.4);
    run(m, 2);
    // The bat's are the same clips, as blows.
    m.setWeapon('bat');
    m.drawn = true;
    m.attack('left');
    expect(m.move?.id).toBe('btAttack');
    expect(m.move?.cut).toBe(false);
    expect(clipAttacksOf('katana')).toHaveLength(5);
    // And the fists have the library's punches.
    m.setWeapon('fists');
    m.drawn = true;
    m.attack();
    expect(m.move?.id).toBe('fsJab');
    expect(m.move?.hitter).toBe('fist_l');
    expect(m.pose(sheath).clip).toMatchObject({ name: 'Punch_Jab' });
    expect(m.pose(sheath).single).toBe(false);
    expect(clipAttacksOf('fists')).toEqual(['fsJab', 'fsCross', 'fsHook']);
  });

  it('a dodge carries you to the side and lets blows past; the library kicks when its moves are on', () => {
    const m = new Melee();
    m.drawn = true;
    m.dodge(-1);
    expect(m.move?.id).toBe('dodgeL');
    expect(m.pose(sheath).clip).toMatchObject({ name: 'Dodge_Left' });
    let moved = 0;
    let evaded = false;
    for (let t = 0; t < 1.4; t += 1 / 120) {
      moved += m.slideSpeed / 120;
      evaded ||= m.evading;
      m.update(1 / 120);
    }
    expect(moved).toBeLessThan(-1.5);
    expect(moved).toBeGreaterThan(-1.9);
    expect(evaded).toBe(true);
    expect(m.move).toBeNull();
    expect(m.evading).toBe(false);
    // Not in the middle of a swing's wind-up.
    m.attack();
    m.dodge(1);
    expect(m.move?.id).toBe('jab');
    run(m, 2);
    m.kick();
    expect(m.move?.id).toBe('kick');
    run(m, 2);
    m.style = 'clips';
    m.kick();
    expect(m.move?.id).toBe('libKick');
    expect(m.move?.hitter).toBe('foot_r');
  });

  it('a click strikes by the stance and where you aim, sides in turn; what he is doing has its own attack', () => {
    const m = new Melee();
    m.setWeapon('katana');
    m.drawn = true;
    m.strike({ zone: 'head' });
    expect(m.move?.id).toBe('kz_mid_head_r');
    run(m, MOVES.kz_mid_head_r.time + 0.05);
    m.strike({ zone: 'head' });
    expect(m.move?.id).toBe('kz_mid_head_l');
    run(m, 2);
    m.setStance('low', true);
    m.strike({ zone: 'legs' });
    expect(m.move?.id).toBe('kz_low_legs_r');
    expect(m.move?.low).toBe(true);
    run(m, 2);
    m.strike({ zone: 'body', doing: 'run' });
    expect(m.move?.id).toBe('thrust');
    run(m, 2);
    m.strike({ doing: 'air' });
    expect(m.move?.id).toBe('overhead');
    run(m, 2);
    // Each stance's swings are its own kind: down from high, level from mid, rising from low; lower for the legs.
    const sword = (id: keyof typeof MOVES, k: number): SwordKey => MOVES[id].keys[k].sword as SwordKey;
    expect(sword('kz_high_head_r', 1).p.y).toBeGreaterThan(sword('kz_mid_head_r', 1).p.y);
    expect(sword('kz_mid_head_r', 1).p.y).toBeGreaterThan(sword('kz_low_head_r', 1).p.y);
    expect(sword('kz_mid_legs_r', 4).p.y).toBeLessThan(sword('kz_mid_head_r', 4).p.y - 0.25);
    expect(sword('kz_mid_legs_r', 4).dir.y).toBeLessThan(sword('kz_mid_head_r', 4).dir.y - 0.3);
    expect(MOVES.bz_mid_body_r.hitter).toBe('bat');
    expect(MOVES.kz_mid_legs_r.damage).toBeLessThan(MOVES.kz_mid_head_r.damage);
    // The fists by zone, and the library's when its moves are on.
    const f = new Melee();
    f.drawn = true;
    f.strike({ zone: 'legs' });
    expect(f.move?.id).toBe('kick');
    run(f, 2);
    f.strike({ zone: 'body' });
    expect(f.move?.id).toBe('hook');
    run(f, 2);
    f.style = 'clips';
    f.strike({ zone: 'head' });
    expect(f.move?.id).toBe('fsJab');
    // Bare-handed, a button a hand: the left jabs and hooks, the right crosses and comes up under the ribs.
    const h = new Melee();
    h.drawn = true;
    const blow = (o: Parameters<Melee['strike']>[0]): string => {
      h.cancel();
      h.strike(o);
      return h.move!.id;
    };
    expect(blow({ zone: 'head', hand: 'l' })).toBe('jab');
    expect(blow({ zone: 'head', hand: 'r' })).toBe('cross');
    expect(blow({ zone: 'head', hand: 'r' })).toBe('cross');
    expect(blow({ zone: 'body', hand: 'l' })).toBe('hook');
    expect(blow({ zone: 'body', hand: 'r' })).toBe('uppercut');
    expect(blow({ zone: 'legs', hand: 'l' })).toBe('kick');
    expect(blow({ doing: 'dodge', hand: 'r' })).toBe('hookR');
    expect(MOVES.jab.hitter).toBe('fist_l');
    expect(MOVES.cross.hitter).toBe('fist_r');
  });

  it('a click held into the wind-up makes a heavier, slower blow', () => {
    const time = (hold: boolean): { t: number; power: number } => {
      const m = new Melee();
      m.setWeapon('bat');
      m.drawn = true;
      m.holding = hold;
      m.strike({ zone: 'body' });
      let t = 0;
      let power = 0;
      while (m.move && t < 4) {
        m.update(1 / 240);
        if (m.striking) power = m.power;
        t += 1 / 240;
      }
      return { t, power };
    };
    const light = time(false);
    const heavy = time(true);
    expect(light.power).toBe(1);
    expect(heavy.power).toBeGreaterThan(1.4);
    expect(heavy.t).toBeGreaterThan(light.t * 1.15);
  });

  it("a clip's recovery is cut short by the next click, once its sweep is over", () => {
    const m = new Melee();
    m.setWeapon('katana');
    m.drawn = true;
    m.style = 'clips';
    m.attack();
    expect(m.move?.id).toBe('swRise');
    run(m, 0.3);
    m.attack();
    run(m, 0.35);
    // (swRise sweeps until 0.4 s of its 1.4: by 0.65 s the next is under way.)
    expect(m.move?.id).toBe('swChop');
  });

  it('drawing ends at the guard, not back at the saya', () => {
    const m = new Melee();
    m.setWeapon('katana');
    m.toggleDrawn();
    run(m, MOVES.draw.time * 0.95);
    expect(m.pose(sheath).sword!.p.distanceTo(SWORD_GUARD.p)).toBeLessThan(0.05);
  });

  it("the right hook is the left's mirror, thrown with the right hand", () => {
    expect(MOVES.hookR.hitter).toBe('fist_r');
    const k = MOVES.hook.keys[2].l!;
    const m = MOVES.hookR.keys[2].r!;
    expect(m.p.x).toBeCloseTo(-k.p.x);
    expect(m.p.z).toBeCloseTo(k.p.z);
    expect(MOVES.hookR.keys[2].twist).toBeCloseTo(-MOVES.hook.keys[2].twist!);
  });

  it("an enemy's slower rate stretches his moves", () => {
    const m = new Melee();
    m.drawn = true;
    m.rate = 0.5;
    m.attack();
    run(m, MOVES.jab.time * 1.2);
    expect(m.move?.id).toBe('jab');
    run(m, MOVES.jab.time);
    expect(m.move).toBeNull();
  });
});
