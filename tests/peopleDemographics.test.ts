import { describe, expect, it } from 'vitest';
import { hash } from '../src/core/hash';
import { ageOf, buildFor, hairTone, menCutFor, nightTradeHere } from '../src/poc3d/district/peopleDemoPick';
import { outAt } from '../src/poc3d/district/peopleHours';
import { baseBody } from '../src/poc3d/real/mobRig';

const N = 4000;
const share = (n: (seed: number) => boolean): number => {
  let c = 0;
  for (let s = 1; s <= N; s++) if (n(s * 7919)) c++;
  return c / N;
};

describe('who is where', () => {
  it('bosses are mostly fat, and an ordinary man at the office much less so', () => {
    const boss = share((s) => ['stout', 'portly'].includes(buildFor('man', 'boss', 'middle', 'tower', s, hash)));
    const salaryman = share((s) => ['stout', 'portly'].includes(buildFor('man', 'suit', 'middle', 'tower', s, hash)));
    const young = share((s) => ['stout', 'portly'].includes(buildFor('man', 'suit', 'young', 'tower', s, hash)));
    expect(boss).toBeGreaterThan(0.8);
    expect(salaryman).toBeGreaterThan(0.15);
    expect(salaryman).toBeLessThan(0.45);
    expect(young).toBeLessThan(0.08);
  });

  it('fat is rare on the campus, and nobody wearing a school uniform is a build', () => {
    expect(share((s) => ['stout', 'portly', 'w_plump', 'w_heavy'].includes(buildFor('woman', 'plain', 'young', 'campus', s, hash)))).toBeLessThan(0.06);
    for (let s = 1; s < 500; s++) {
      expect(buildFor('woman', 'school', 'teen', 'campus', s * 31, hash)).toBe('woman');
      expect(buildFor('man', 'school', 'teen', 'campus', s * 31, hash)).toBe('man');
    }
  });

  it('the port has big men, the night trade is curvy, the old are old builds of the right sex', () => {
    const port = share((s) => buildFor('man', 'work', 'adult', 'harbor', s, hash) === 'bulky');
    const elsewhere = share((s) => buildFor('man', 'work', 'adult', 'residential', s, hash) === 'bulky');
    expect(port).toBeGreaterThan(elsewhere * 1.5);
    expect(share((s) => ['w_curvy', 'w_busty'].includes(buildFor('woman', 'streetwalker', 'young', 'neon', s, hash)))).toBeGreaterThan(0.2);
    for (let s = 1; s < 300; s++) {
      expect(baseBody(buildFor('woman', 'plain', 'old', 'oldtown', s * 13, hash))).toBe('woman');
      expect(['elder', 'e_frail', 'e_stout', 'e_tall']).toContain(buildFor('man', 'plain', 'old', 'oldtown', s * 13, hash));
    }
  });

  it('the old town is older than the campus', () => {
    const old = (d: string): number => share((s) => ageOf('plain', d, s, hash) === 'old');
    expect(old('oldtown')).toBeGreaterThan(old('campus') * 3);
  });

  it('the night trade works in Kaburo and hardly elsewhere, and after midnight', () => {
    expect(share((s) => nightTradeHere('streetwalker', 'neon', s, hash))).toBe(1);
    expect(share((s) => nightTradeHere('streetwalker', 'campus', s, hash))).toBe(0);
    expect(share((s) => nightTradeHere('streetwalker', 'residential', s, hash))).toBeLessThan(0.05);
    expect(nightTradeHere('plain', 'campus', 5, hash)).toBe(true);
    expect(outAt('deep', 12)).toBe(0);
    expect(outAt('deep', 2)).toBeGreaterThan(0.9);
    expect(outAt('deep', 2)).toBeGreaterThan(outAt('deep', 21));
    expect(outAt('deep', 21)).toBeGreaterThan(outAt('deep', 18.5));
  });

  it('hair: the old are grey or white, uniforms never dye, the gangs and the night trade do, a boss covers his grey', () => {
    const tones = (sex: 'man' | 'woman', age: 'teen' | 'young' | 'adult' | 'middle' | 'old', outfit: string, d: string): number[] => Array.from({ length: N }, (_, s) => hairTone(sex, age, outfit, d, (s + 1) * 7919, hash));
    const grey = (t: number[]): number => t.filter((x) => x === 3 || x === 4).length / t.length;
    const dyed = (t: number[]): number => t.filter((x) => x === 5 || x === 6).length / t.length;
    expect(grey(tones('man', 'old', 'plain', 'oldtown'))).toBeGreaterThan(0.7);
    expect(dyed(tones('woman', 'teen', 'school', 'campus'))).toBe(0);
    expect(dyed(tones('man', 'adult', 'police', 'neon'))).toBe(0);
    expect(dyed(tones('woman', 'young', 'bodycon', 'neon'))).toBeGreaterThan(0.2);
    expect(dyed(tones('man', 'middle', 'plain', 'oldtown'))).toBe(0);
    expect(dyed(tones('woman', 'young', 'bodycon', 'neon'))).toBeGreaterThan(dyed(tones('woman', 'young', 'bodycon', 'tower')) * 2);
    expect(grey(tones('man', 'middle', 'boss', 'tower'))).toBeLessThan(grey(tones('man', 'middle', 'plain', 'tower')));
    expect(tones('woman', 'young', 'plain', 'neon').filter((x) => x === 6).length / N).toBeLessThan(0.02);
  });

  it('men have their own cuts by who they are, never the left-out ones', () => {
    const cuts = Array.from({ length: N }, (_, s) => menCutFor('plain', 'young', 'neon', (s + 1) * 7919, hash));
    expect(cuts.filter((c) => c === null).length / N).toBeGreaterThan(0.35);
    expect(cuts.filter((c) => c === 'm_bun' || c === 'm_ponytail').length).toBe(0);
    expect(new Set(cuts).size).toBeGreaterThan(6);
  });
});
