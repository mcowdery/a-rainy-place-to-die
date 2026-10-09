import { afterEach, describe, expect, it } from 'vitest';
import { bareDetail, setBareDetail, type BareDetail } from '../src/poc3d/real/mobBare';
import { buildShaped } from '../src/poc3d/real/mobShape';

// The bare woman's detail is drawn by hooks the uncensored edition registers from adult/ (src/poc3d/real/mobBare.ts);
// the other editions have none. These check the seam, not what the hooks draw.
const spy = (): { hooks: BareDetail; calls: string[] } => {
  const calls: string[] = [];
  const hooks: BareDetail = {
    nipples: () => void calls.push('nipples'),
    anus: () => void calls.push('anus'),
    pubic: () => void calls.push('pubic'),
    areola: () => void calls.push('areola'),
  };
  return { hooks, calls };
};

describe('the bare-body hooks', () => {
  afterEach(() => setBareDetail(null));

  it('are none in this edition, and a bare woman is still built (the smooth body)', () => {
    expect(bareDetail()).toBeNull();
    const t = buildShaped('woman', 'long', 'nude');
    expect(t.pos.length).toBeGreaterThan(3000);
  });

  it('are called, once each, for a woman with nothing on', () => {
    const { hooks, calls } = spy();
    setBareDetail(hooks);
    buildShaped('woman', 'long', 'nude');
    expect(calls.sort()).toEqual(['anus', 'areola', 'nipples', 'pubic']);
  });

  it('leave a clothed woman and a man alone', () => {
    const { hooks, calls } = spy();
    setBareDetail(hooks);
    buildShaped('woman', 'long', 'dress');
    buildShaped('man', 'short', 'plain');
    buildShaped('man', 'short', 'nude');
    expect(calls.filter((c) => c !== 'anus')).toEqual([]);
  });
});
