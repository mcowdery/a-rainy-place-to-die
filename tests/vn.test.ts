import { describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { loadVnLibrary } from '../src/vn/content';
import { hitHotspot, VnEngine, VnLibrary } from '../src/vn/engine';
import { validateScene } from '../src/vn/format';

const lib = loadVnLibrary();
const flagStore = (): { get(k: string): unknown; set(k: string, v: boolean): void; all: Map<string, boolean> } => {
  const all = new Map<string, boolean>();
  return { all, get: (k) => all.get(k), set: (k, v) => void all.set(k, v) };
};

describe('VN library (the exports in content/vn)', () => {
  it('loads every export cleanly', () => {
    expect(lib.errors).toEqual([]);
    expect(lib.stories.get('s90')).toBeTruthy();
    expect(lib.imageOf('s90.fr10')).toBeTruthy();
    expect(lib.imageOf('s90.fr01')).toBeNull();
  });

  it('enters from world nodes that exist, and exits to spawns that exist', () => {
    const world = loadDistrictContent();
    const nodes = new Map(world.placed.flatMap((p) => p.nodes).map((n) => [n.id, n]));
    for (const entry of lib.entries.keys()) expect(nodes.has(entry), entry).toBe(true);
    for (const f of lib.frames.values()) {
      const targets = [f.next, ...f.choices.map((c) => c.target), ...f.hotspots.map((h) => h.target)];
      for (const t of targets) if (t?.startsWith('exit:')) expect(nodes.get(t.slice(5))?.kind, t).toBe('spawn');
    }
  });

  it('rejects a broken scene and a key declared twice', () => {
    expect(validateScene('x', { schema: 1, story: { id: 'nope' }, frames: {} }).length).toBeGreaterThan(0);
    const scene = {
      schema: 2, story: { id: 's01', name: 'a' }, start: 's01.fr01', flags_referenced: [], entry_points: { 'a.b': 's01.fr01' },
      frames: { 's01.fr01': { entry_point: 'a.b', image: null, video: null, size: null, title: '', bubbles: [], on_enter: { set: {} }, next: null, choices: [], hotspots: [] } },
    };
    const other = { ...scene, story: { id: 's02', name: 'b' }, start: 's02.fr01', entry_points: { 'a.b': 's02.fr01' }, frames: { 's02.fr01': scene.frames['s01.fr01'] } };
    const two = new VnLibrary({ a: scene, b: other }, {
      a: { schema: 1, entry_points: { 'a.b': { story_id: 's01', frame: 's01.fr01' } } },
      b: { schema: 1, entry_points: { 'a.b': { story_id: 's02', frame: 's02.fr01' } } },
    });
    expect(two.errors.some((e) => e.includes('a.b'))).toBe(true);
  });
});

describe('VN engine: Mama-san and Room 303', () => {
  it('plays the talk, gates the choices on flags, and exits to the bar', () => {
    const flags = flagStore();
    const vn = new VnEngine(lib, flags);
    expect(vn.enter('bar_kanpai.mama')).toEqual({ kind: 'frame', key: 's90.fr01' });
    expect(flags.all.get('met_mama')).toBe(true);
    expect(vn.next()).toEqual({ kind: 'frame', key: 's90.fr02' });
    expect(vn.choices().map((c) => c.id)).toEqual(['c01', 'c02', 'c03', 'c04']);
    // Ask about Hotel Rouge: three lines, then back to the menu without that choice.
    expect(vn.pick('c03')).toEqual({ kind: 'frame', key: 's90.fr05' });
    expect(flags.all.get('heard_room_303')).toBe(true);
    vn.next();
    vn.next();
    expect(vn.next()).toEqual({ kind: 'frame', key: 's90.fr02' });
    expect(vn.choices().map((c) => c.id)).toEqual(['c01', 'c02', 'c04']);
    expect(vn.pick('c04')).toEqual({ kind: 'exit', to: 'bar_kanpai.out' });
  });

  it('lets you look round inside: inspect hotspots set flags, the door is an exit', () => {
    const flags = flagStore();
    const vn = new VnEngine(lib, flags);
    vn.enter('bar_kanpai.mama');
    vn.next();
    vn.pick('c01');
    expect(vn.key).toBe('s90.fr10');
    const bottles = vn.use('h01');
    expect(bottles?.kind).toBe('inspect');
    expect(bottles && 'text' in bottles && bottles.text).toContain('K.');
    expect(flags.all.get('saw_keep_bottle')).toBe(true);
    expect(vn.use('h04')).toEqual({ kind: 'exit', to: 'bar_kanpai.out' });
  });

  it('knocks at 303 once, gets the matchbook, and never twice', () => {
    const flags = flagStore();
    const vn = new VnEngine(lib, flags);
    vn.enter('hotel_rouge.room_303');
    vn.next();
    expect(vn.pick('c01')).toEqual({ kind: 'frame', key: 's90.fr22' });
    expect(flags.all.get('got_matchbook')).toBe(true);
    expect(vn.next()).toEqual({ kind: 'exit', to: 'hotel_rouge.floor3' });
    vn.enter('hotel_rouge.room_303');
    vn.next();
    expect(vn.choices().map((c) => c.id)).toEqual(['c02']);
  });

  it('hit-tests hotspots by shape', () => {
    const f = lib.frames.get('s90.fr10')!;
    const mama = f.hotspots.find((h) => h.id === 'h03')!;
    expect(hitHotspot(mama, 0.62, 0.45)).toBe(true);
    expect(hitHotspot(mama, 0.4, 0.45)).toBe(false);
    const round = { ...mama, shape: 'circle' as const, box: [0.4, 0.4, 0.2, 0.2] as const, points: [] };
    expect(hitHotspot(round, 0.5, 0.5)).toBe(true);
    expect(hitHotspot(round, 0.41, 0.41)).toBe(false);
  });
});
