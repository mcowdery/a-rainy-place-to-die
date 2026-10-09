import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import exText from '../content/world3d/expressway.yaml?raw';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { RacePath, RaceState } from '../src/poc3d/district/cityRace';
import { Expressway, parseExpressway } from '../src/poc3d/district/expressway';
import { RaceRival } from '../src/poc3d/district/raceRival';

const content = loadDistrictContent();
const ex = new Expressway(parseExpressway('expressway.yaml', exText, [])!);
const mat = new THREE.MeshBasicMaterial();

/** The rival alone: the time to the line and how often it touched a wall. */
function runAlone(id: string, limit: number): { t: number; s: number; walls: number; avg: number } {
  const def = content.races.find((r) => r.id === id)!;
  const path = new RacePath(def, ex);
  const rival = new RaceRival(path, ex, mat, def.rival.skill, def.rival);
  rival.place(4, -1.8);
  const cam = new THREE.Vector3(1e6, 0, 0);
  let t = 0;
  let walls = 0;
  const dt = 1 / 60;
  while (t < limit && rival.s < path.length - 1) {
    rival.update(dt, [], 0, false, cam);
    if (rival.car.bump > 1) walls++;
    t += dt;
  }
  return { t, s: rival.s, walls, avg: path.length / t };
}

describe('races in the city', () => {
  it('loads the races, each with its host at the PA', () => {
    expect(content.races.map((r) => r.id)).toEqual(['c1_lap', 'wangan_sprint']);
    for (const r of content.races) expect(new RacePath(r, ex).length).toBeGreaterThan(1500);
  });

  it('has the rival drive each race to the line cleanly, at a racing pace', () => {
    const c1 = runAlone('c1_lap', 400);
    const wangan = runAlone('wangan_sprint', 200);
    // To the line, off no walls, quick but beatable: C1 at 90-130 km/h on average, the Wangan flat out.
    expect(c1.s).toBeGreaterThan(3200);
    expect(c1.walls).toBeLessThanOrEqual(2);
    expect(c1.avg * 3.6).toBeGreaterThan(90);
    expect(c1.avg * 3.6).toBeLessThan(135);
    expect(wangan.walls).toBe(0);
    expect(wangan.avg * 3.6).toBeGreaterThan(150);
  });

  it('keeps score: the countdown, splits, and the first to the line wins', () => {
    const def = content.races.find((r) => r.id === 'wangan_sprint')!;
    const st = new RaceState(new RacePath(def, ex));
    st.update(4, 0, 0);
    expect(st.phase).toBe('racing');
    let split = null;
    for (let i = 0; i < 100 && st.phase === 'racing'; i++) split = st.update(1, i * 25, i * 24) ?? split;
    expect(st.result?.won).toBe(true);
    expect(st.youSplits).toHaveLength(4);
  });
});
