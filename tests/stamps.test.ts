import { describe, expect, it } from 'vitest';
import { parseStamp } from '../src/content/stamps';
import { GLYPH_CONT, GLYPH_NONE } from '../src/core/wide';
import { T } from '../src/world/tiles';

const stamp = (art: string, extra = '') => `
id: test
legend:
  '#': wall
  '_': sidewalk
  '[': { tile: sign, fg: neon_pink }
  's': { tile: sidewalk, node: out }
${extra}
art: |
${art
  .trim()
  .split('\n')
  .map((l) => '  ' + l.trim())
  .join('\n')}
`;

const parse = (text: string) => {
  const errors: string[] = [];
  return { s: parseStamp('test.yaml', text, errors), errors };
};

describe('stamp parsing', () => {
  it('lays out CJK signs across two cells', () => {
    const { s, errors } = parse(stamp(`#[酒場]#\n__s_____`, 'nodes:\n  out: { kind: spawn }'));
    expect(errors).toEqual([]);
    expect(s!.w).toBe(8);
    // # [ 酒 CONT 場 CONT ] #
    expect(Array.from(s!.glyph.slice(0, 8))).toEqual([GLYPH_NONE, GLYPH_NONE, 0x9152, GLYPH_CONT, 0x5834, GLYPH_CONT, GLYPH_NONE, GLYPH_NONE]);
    expect(s!.tile[2]).toBe(T.sign);
    expect(s!.nodes[0].at).toEqual([2, 1]);
  });

  it('rejects rows of different cell width (CJK miscount)', () => {
    const { s, errors } = parse(stamp(`#[酒場]#\n__s____`, 'nodes:\n  out: { kind: spawn }'));
    expect(s).toBeNull();
    expect(errors.join()).toMatch(/row 1 is 7 cells wide, expected 8/);
  });

  it('rejects CJK outside a sign, unknown chars and spaces', () => {
    const { errors } = parse(stamp(`#酒#x\n__s _`, 'nodes:\n  out: { kind: spawn }'));
    const all = errors.join('\n');
    expect(all).toMatch(/wide character '酒' outside \[ \]/);
    expect(all).toMatch(/'x' is not in the legend/);
    expect(all).toMatch(/'space' is not in the legend/);
  });

  it('requires each node marker exactly once and valid references', () => {
    expect(parse(stamp(`#__#`, 'nodes:\n  out: { kind: spawn }')).errors.join()).toMatch(/exactly one marker.*found 0/);
    expect(parse(stamp(`#ss#`, 'nodes:\n  out: { kind: spawn }')).errors.join()).toMatch(/exactly one marker.*found 2/);
    expect(parse(stamp(`#s_#`)).errors.join()).toMatch(/nodes: has no 'out'/);
    expect(parse(stamp(`#s_#`, 'nodes:\n  out: { kind: door }')).errors.join()).toMatch(/door needs returnSpawn/);
    expect(parse(stamp(`#s_#`, 'nodes:\n  out: { kind: spawn, condition: "a &&" }')).errors.join()).toMatch(/condition/);
  });
});
