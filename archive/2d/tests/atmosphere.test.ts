import { describe, expect, it } from 'vitest';
import { parseAtmosphere } from '../src/atmosphere/atmosphere';
import { loadContent } from '../src/content/load';
import { PAL, PALETTE_NAMES } from '../src/world/tiles';

const base = PALETTE_NAMES.map((n) => `      ${n}: '#000000'`).join('\n');
const table = (extra: string) => {
  const errors: string[] = [];
  const t = parseAtmosphere('a.yaml', `rules:\n  - match: {}\n    windowLit: 0\n    palette:\n${base}\n${extra}`, errors);
  return { t, errors };
};

describe('atmosphere lookup', () => {
  it('layers rules by specificity, then file order', () => {
    const { t, errors } = table(`
  - match: { district: neon, time: night }
    windowLit: 0.5
  - match: { time: night }
    windowLit: 0.3
    neon: 'on'
  - match: { district: neon, time: night, weather: rain }
    palette: { asphalt: '#ff0000' }
`);
    expect(errors).toEqual([]);
    expect(t!.resolve('tower', 'day', 'clear').windowLit).toBe(0);
    expect(t!.resolve('tower', 'night', 'clear').windowLit).toBe(0.3);
    // Specific rule wins even though the general one comes later in the file.
    expect(t!.resolve('neon', 'night', 'clear').windowLit).toBe(0.5);
    expect(t!.resolve('neon', 'night', 'clear').neon).toBe('on');
    expect(t!.resolve('neon', 'night', 'rain').colors[PAL.asphalt]).toBe('rgb(255,0,0)');
    expect(t!.resolve('neon', 'night', 'clear').colors[PAL.asphalt]).toBe('rgb(0,0,0)');
  });

  it('does not tint emissive colours', () => {
    const { t } = table(`
  - match: { weather: fog }
    tint: { color: '#ffffff', amount: 0.5 }
`);
    const a = t!.resolve('tower', 'day', 'fog');
    expect(a.colors[PAL.asphalt]).toBe('rgb(128,128,128)');
    expect(a.colors[PAL.neon_pink]).toBe('rgb(0,0,0)');
  });

  it('reports bad rules', () => {
    const { errors } = table(`
  - match: { district: moon, time: noon }
    palette: { nope: '#fff' }
`);
    expect(errors.join('\n')).toMatch(/unknown district 'moon'/);
    expect(errors.join('\n')).toMatch(/unknown time 'noon'/);
    expect(errors.join('\n')).toMatch(/unknown palette colour 'nope'/);
  });

  it('the shipped table resolves every combination', () => {
    const { atmosphere } = loadContent();
    for (const d of ['residential', 'tower', 'neon', 'oldtown', 'harbor', 'beach', 'water', 'void'] as const)
      for (const time of ['dawn', 'day', 'dusk', 'night'] as const)
        for (const w of ['clear', 'rain', 'fog'] as const) expect(atmosphere.resolve(d, time, w).colors).toHaveLength(PALETTE_NAMES.length);
  });
});
