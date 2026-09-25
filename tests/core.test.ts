import { describe, expect, it } from 'vitest';
import { compileCondition } from '../src/core/condition';
import { hash, rng } from '../src/core/hash';
import { GLYPH_CONT, GLYPH_NONE, cellWidth, isWide, textToCells } from '../src/core/wide';

describe('hash / rng', () => {
  it('is deterministic', () => {
    expect(hash(1, 2, 3)).toBe(hash(1, 2, 3));
    expect(hash(1, 2, 3)).not.toBe(hash(3, 2, 1));
    const a = rng(42);
    const b = rng(42);
    expect([a.u32(), a.u32(), a.int(0, 9)]).toEqual([b.u32(), b.u32(), b.int(0, 9)]);
  });
});

describe('wide cells', () => {
  it('classifies CJK as wide and ASCII/box drawing as narrow', () => {
    for (const c of 'カ居ー　Ａ') expect(isWide(c.codePointAt(0)!)).toBe(true);
    for (const c of 'A~█░│☎▪ｶ') expect(isWide(c.codePointAt(0)!)).toBe(false);
  });

  it('encodes wide chars as head + CONT', () => {
    expect(textToCells('A 酒')).toEqual([0x41, GLYPH_NONE, 0x9152, GLYPH_CONT]);
    expect(cellWidth('地下鉄 METRO')).toBe(12);
  });
});

describe('conditions', () => {
  const flags: Record<string, string | boolean | number> = { 'world.time': 'night', met: true, count: 2 };
  const read = (k: string) => flags[k];
  const ev = (src: string) => compileCondition(src)(read);

  it('evaluates flags, literals and operators', () => {
    expect(ev('met')).toBe(true);
    expect(ev('!met')).toBe(false);
    expect(ev('unset')).toBe(false);
    expect(ev('world.time == "night"')).toBe(true);
    expect(ev("world.time != 'night'")).toBe(false);
    expect(ev('flags.met && count == 2')).toBe(true);
    expect(ev('unset || (met && !unset)')).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(() => compileCondition('met &&')).toThrow();
    expect(() => compileCondition('met $ x')).toThrow();
    expect(() => compileCondition('(met')).toThrow();
  });
});
