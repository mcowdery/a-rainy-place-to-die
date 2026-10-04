import { describe, expect, it } from 'vitest';
import { Footfalls, gaitBob, KNEE_LEAD, legPose, MIN_STRIDE, STRIDE_HZ, strikePhase, type Foot } from '../src/poc3d/models/gait';
import { floorLevel, FOOTWEAR, groundSurface, indoorSurface, SURFACES, underfoot, type Footwear, type Surface } from '../src/poc3d/district/footing';
import { renderSplash, renderStep, STEP_SECONDS, stepStats } from '../src/poc3d/real/stepSynth';
import { availableOutfits, OUTFITS } from '../src/poc3d/models/wardrobe';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { DISTRICTS3 } from '../src/poc3d/district/plan';
import { District } from '../src/poc3d/district/world';

/** A leg as two links of 0.45 m from the hip: the ankle ahead of the hip and below it, at a full stride. */
const ankle = (phase: number, run: number, foot: Foot): { ahead: number; below: number } => {
  const { thigh, knee } = legPose(phase, run, foot);
  return { ahead: 0.45 * (Math.sin(thigh) + Math.sin(thigh - knee)), below: 0.45 * (Math.cos(thigh) + Math.cos(thigh - knee)) };
};
const TAU = Math.PI * 2;

describe('gait', () => {
  it('lands each foot ahead of the body, the leg straight and the foot down', () => {
    for (const run of [0, 0.5, 1]) {
      const strike = strikePhase(run);
      // The lowest the ankle gets through the stride (mid-stance).
      let lowest = 0;
      for (let p = 0; p < TAU; p += 0.01) lowest = Math.max(lowest, ankle(p, run, 'l').below);
      const at = ankle(strike, run, 'l');
      // Within a few centimetres of the ground, still ahead of the hip, the knee straightened, coming down.
      expect(lowest - at.below).toBeLessThan(0.04);
      expect(at.ahead).toBeGreaterThan(0.15);
      expect(strike).toBeGreaterThanOrEqual(Math.PI - KNEE_LEAD);
      expect(legPose(strike, run, 'l').knee).toBeCloseTo(0.15, 5);
      expect(ankle(strike - 0.1, run, 'l').below).toBeLessThan(at.below);
      // The right foot does the same half a cycle later.
      expect(ankle(strike + Math.PI, run, 'r').below).toBeCloseTo(at.below, 9);
    }
    // A run's longer swing brings the foot down later in the cycle than a walk's.
    expect(strikePhase(1)).toBeGreaterThan(strikePhase(0));
  });

  it('reports one footfall a foot a stride, left and right in turn, at the strike', () => {
    for (const run of [0, 1]) {
      const feet = new Footfalls();
      const got: { foot: Foot; phase: number }[] = [];
      const dPhase = (TAU * (STRIDE_HZ[0] + STRIDE_HZ[1] * (run ? 4.2 : 1.5))) / 60;
      const strides = 6;
      for (let phase = 0; phase < TAU * strides; phase += dPhase) for (const foot of feet.step(phase, run, 1)) got.push({ foot, phase });
      expect(got.length).toBe(strides * 2);
      got.forEach((g, i) => {
        if (i > 0) expect(g.foot).not.toBe(got[i - 1].foot);
        // Each within a frame of its strike phase.
        const own = (((g.foot === 'l' ? g.phase : g.phase - Math.PI) % TAU) + TAU) % TAU;
        expect(own - strikePhase(run)).toBeGreaterThanOrEqual(0);
        expect(own - strikePhase(run)).toBeLessThan(dPhase + 1e-9);
      });
    }
  });

  it('is silent standing, and after a stop waits for a fresh swing', () => {
    const feet = new Footfalls();
    let n = 0;
    // Standing: the phase idles on, the stride is nothing.
    for (let phase = 0; phase < TAU * 3; phase += 0.05) n += feet.step(phase, 0, 0).length;
    for (let phase = 0; phase < TAU * 3; phase += 0.05) n += feet.step(phase, 0, MIN_STRIDE - 0.01).length;
    expect(n).toBe(0);
    // Seated and back on foot mid-cycle, past the left's strike: no step until a leg has swung through.
    feet.reset();
    expect(feet.step(strikePhase(0) + 0.3, 0, 1)).toEqual([]);
    feet.reset();
    const first: Foot[] = [];
    for (let phase = strikePhase(0) + 0.3; first.length === 0; phase += 0.05) first.push(...feet.step(phase, 0, 1));
    expect(first).toEqual(['r']);
  });

  it('has the body lowest as each foot lands', () => {
    for (const run of [0, 1]) {
      const strike = strikePhase(run);
      expect(gaitBob(strike, run, 1)).toBeCloseTo(-1, 9);
      expect(gaitBob(strike + Math.PI, run, 1)).toBeCloseTo(-1, 9);
      expect(gaitBob(strike + Math.PI / 2, run, 1)).toBeCloseTo(1, 9);
      expect(gaitBob(strike, run, 0)).toBeCloseTo(0, 9);
    }
  });
});

describe('footing', () => {
  it('gives every outfit its footwear', () => {
    for (const o of OUTFITS) expect(FOOTWEAR).toContain(o.feet);
    expect(OUTFITS.find((o) => o.id === 'leathers')!.feet).toBe('boots');
    expect(OUTFITS.find((o) => o.id === 'suit_black')!.feet).toBe('shoes');
    expect(OUTFITS.find((o) => o.id === 'nude')!.feet).toBe('bare');
    expect(availableOutfits().length).toBeGreaterThan(0);
  });

  it('knows a set piece\'s floors by level', () => {
    expect(floorLevel(0.1)).toBe('street');
    expect(floorLevel(6)).toBe('above');
    expect(floorLevel(-5)).toBe('below');
    expect(indoorSurface('apato', 'above')).toBe('tatami');
    expect(indoorSurface('residence', 'street')).toBe('tile');
    expect(indoorSurface('residence', 'above')).toBe('wood');
    expect(indoorSurface('konbini', 'street')).toBe('tile');
    expect(indoorSurface('subway', 'below')).toBe('tile');
    expect(indoorSurface('live_house', 'below')).toBe('paving');
    expect(indoorSurface(null, 'above')).toBe('paving');
    expect(groundSurface('shrine')).toBe('gravel');
    expect(groundSurface('konbini')).toBeNull();
    for (const k of ['apato', 'station', 'lookout', 'nothing']) for (const l of ['street', 'above', 'below'] as const) expect(SURFACES).toContain(indoorSurface(k, l));
  });

  it('puts settled snow over open ground only', () => {
    expect(underfoot('asphalt', 0.8, true)).toBe('snow');
    expect(underfoot('grass', 0.8, true)).toBe('snow');
    expect(underfoot('asphalt', 0.1, true)).toBe('asphalt');
    expect(underfoot('asphalt', 0.8, false)).toBe('asphalt');
    expect(underfoot('tile', 0.8, true)).toBe('tile');
    expect(underfoot('metal', 0.8, true)).toBe('metal');
  });
});

describe('what is underfoot in the district', () => {
  const content = loadDistrictContent();
  const district = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);
  const inPlaced = (x: number, z: number): boolean => district.placed.some(({ rect: q }) => x >= q.x && x <= q.x + q.w && z >= q.y && z <= q.y + q.h);

  it('tells the carriageway from the pavement beside it', () => {
    // Along every road with pavements in a few cells: the middle is asphalt, the pavement paving.
    let roads = 0;
    for (const [mx, my] of district.cells.slice(0, 40)) {
      const plan = district.plan(mx, my)!;
      for (const r of plan.roads) {
        if (r.sidewalk < 2 || r.kind === 'coast' || r.median > 0) continue;
        const along = r.vertical ? r.rect.y + r.rect.h / 2 : r.rect.x + r.rect.w / 2;
        const across = r.vertical ? r.rect.x : r.rect.y;
        const width = r.vertical ? r.rect.w : r.rect.h;
        const at = (d: number): [number, number] => (r.vertical ? [across + d, along] : [along, across + d]);
        const mid = at(width / 2);
        const walk = at(r.sidewalk / 2);
        // (Mid-block only: clear of crossings, plazas and open lots.)
        if (district.pavingAt(...mid) !== 0.02 || district.pavingAt(...walk) !== 0.15) continue;
        if (inPlaced(...mid) || inPlaced(...walk)) continue;
        expect(district.surfaceAt(...mid)).toBe('asphalt');
        expect(district.surfaceAt(...walk)).toBe('paving');
        roads++;
      }
    }
    expect(roads).toBeGreaterThan(20);
  });

  it('finds lawns, paths and playgrounds in the open lots', () => {
    const seen = new Set<string>();
    for (const [mx, my] of district.cells) {
      for (const o of district.model.detail(mx, my)?.open ?? []) {
        for (const g of o.ground) {
          const x = g.rect.x + g.rect.w / 2;
          const z = g.rect.y + g.rect.h / 2;
          if (district.pavingAt(x, z) !== g.top) continue;
          if (inPlaced(x, z)) continue;
          seen.add(district.surfaceAt(x, z));
        }
      }
      if (seen.size >= 5) break;
    }
    for (const s of ['asphalt', 'paving', 'grass', 'gravel', 'earth']) expect(seen).toContain(s);
  });

  it('knows the set pieces\' floors and grounds', () => {
    // The shrine's precinct is gravel, Yoru Mart tiled, a subway platform tiled.
    const shrine = district.placed.find((p) => p.stamp.landmark === 'shrine')!;
    expect(district.surfaceAt(shrine.rect.x + shrine.rect.w / 2, shrine.rect.y + 1)).toBe('gravel');
    const konbini = district.placed.find((p) => p.stamp.landmark === 'konbini')!;
    expect(district.surfaceAt(konbini.building.x, konbini.building.z)).toBe('tile');
    const subway = district.placed.find((p) => p.stamp.landmark === 'subway')!;
    expect(district.surfaceAt(subway.building.x, subway.building.z, -11)).toBe('tile');
    // Off the street outside any set piece: a deck above, a passage below.
    const [mx, my] = district.cells[0];
    let open: [number, number] | null = null;
    for (let i = 0; i < 64 && !open; i++) if (!inPlaced(mx * 128 + i * 2, my * 128 + 1)) open = [mx * 128 + i * 2, my * 128 + 1];
    expect(district.surfaceAt(...open!, 15)).toBe('asphalt');
    expect(district.surfaceAt(...open!, -5)).toBe('tile');
  });
});

describe('step sounds', () => {
  const SR = 48000;
  const step = (surface: Surface, footwear: Footwear, o: Partial<{ run: boolean; land: boolean; seed: number }> = {}): Float32Array =>
    renderStep(surface, footwear, { run: false, land: false, seed: 7, sampleRate: SR, ...o });
  const stats = (surface: Surface, footwear: Footwear) => stepStats(step(surface, footwear), SR);

  it('renders every surface in every footwear, walking, running and landing: heard, in range, and over by the end', () => {
    for (const surface of SURFACES) {
      for (const footwear of FOOTWEAR) {
        for (const o of [{}, { run: true }, { land: true }]) {
          const x = step(surface, footwear, o);
          expect(x.length).toBe(Math.ceil(SR * STEP_SECONDS));
          let peak = 0;
          for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
          // (A NaN anywhere would leave the peak NaN.)
          expect(Number.isFinite(peak)).toBe(true);
          expect(peak).toBeGreaterThan(0.1);
          expect(peak).toBeLessThanOrEqual(0.96);
          let tail = 0;
          for (let i = x.length - SR * 0.01; i < x.length; i++) tail = Math.max(tail, Math.abs(x[i]));
          expect(tail).toBeLessThan(peak * 0.03);
        }
      }
    }
  });

  it('is the same for a seed and different for another', () => {
    expect(Array.from(step('gravel', 'boots', { seed: 3 }))).toEqual(Array.from(step('gravel', 'boots', { seed: 3 })));
    const a = step('paving', 'shoes', { seed: 3 });
    const b = step('paving', 'shoes', { seed: 4 });
    expect(a.some((v, i) => Math.abs(v - b[i]) > 0.01)).toBe(true);
  });

  it('sounds like what it is', () => {
    // A boot on concrete is a knock, not a thump or a hiss: most of it between 250 Hz and 4 kHz.
    const boot = stats('paving', 'boots');
    expect(boot.bands[1] + boot.bands[2]).toBeGreaterThan(0.55);
    expect(boot.bands[3]).toBeLessThan(0.1);
    // Dress shoes are crisper than boots, bare feet duller and quieter, on any hard dead floor (boards have
    // their own say: the knock is the floor's).
    for (const s of ['paving', 'tile', 'asphalt'] as const) {
      expect(stats(s, 'shoes').centroid).toBeGreaterThan(stats(s, 'boots').centroid);
      expect(stats(s, 'bare').centroid).toBeLessThan(stats(s, 'boots').centroid);
      expect(stats(s, 'bare').peak).toBeLessThan(stats(s, 'boots').peak);
    }
    // Paving is brighter than asphalt; carpet and tatami are quieter than either and duller than a hard floor.
    expect(stats('paving', 'shoes').centroid).toBeGreaterThan(stats('asphalt', 'shoes').centroid);
    expect(stats('carpet', 'boots').peak).toBeLessThan(stats('paving', 'boots').peak);
    expect(stats('tatami', 'boots').peak).toBeLessThan(stats('paving', 'boots').peak);
    expect(stats('carpet', 'shoes').centroid).toBeLessThan(stats('paving', 'shoes').centroid);
    // Gravel and snow are crunch: most of their energy above 1 kHz, where a boot on boards is mostly below.
    expect(stats('gravel', 'boots').bands[2] + stats('gravel', 'boots').bands[3]).toBeGreaterThan(0.5);
    expect(stats('wood', 'boots').bands[0] + stats('wood', 'boots').bands[1]).toBeGreaterThan(0.8);
  });

  it('splashes more the deeper the puddle', () => {
    const splash = (depth: number, run = false) => renderSplash({ depth, run, seed: 7, sampleRate: SR });
    const energy = (x: Float32Array): number => x.reduce((a, v) => a + v * v, 0);
    for (const d of [0, 0.45, 1]) {
      for (const run of [false, true]) {
        const st = stepStats(splash(d, run), SR);
        expect(Number.isFinite(st.peak)).toBe(true);
        expect(st.peak).toBeGreaterThan(0.05);
        expect(st.peak).toBeLessThanOrEqual(0.96);
      }
    }
    // Wet ground is a tsk; a puddle is more, and longer, the deeper.
    expect(energy(splash(0.45))).toBeGreaterThan(energy(splash(0)) * 2);
    expect(energy(splash(1))).toBeGreaterThan(energy(splash(0.45)));
    expect(stepStats(splash(1), SR).seconds).toBeGreaterThan(stepStats(splash(0), SR).seconds + 0.1);
  });
});
