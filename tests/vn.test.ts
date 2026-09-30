import { describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { loadVnLibrary } from '../src/vn/content';
import { hitHotspot, VnEngine, VnLibrary } from '../src/vn/engine';
import { validateScene } from '../src/vn/format';
import { vnKeys } from '../src/vn/keys';

const lib = loadVnLibrary();
const flagStore = (): { get(k: string): unknown; set(k: string, v: boolean): void; all: Map<string, boolean> } => {
  const all = new Map<string, boolean>();
  return { all, get: (k) => all.get(k), set: (k, v) => void all.set(k, v) };
};

/**
 * A test story on real world nodes (content/vn ships none yet): meeting someone at Bar Kanpai (a flag on
 * arrival, a menu whose asked choices hide themselves, a room with inspect and go hotspots) and a knock at
 * Hotel Rouge's Room 303 that only works once.
 */
const bubble = (id: string, text: string, show = 'enter'): object => ({ id, text, kind: 'speech', x: 0.5, y: 0.8, show, duration: 3 });
const fr = (over: object = {}): object => ({
  entry_point: null, image: 'assets/x.jpg', video: null, size: [4, 4], title: '', bubbles: [], on_enter: { set: {} }, next: null, choices: [], hotspots: [], ...over,
});
const rect = (id: string, [x, y, w, h]: number[], over: object = {}): object => ({
  id, shape: 'rect', box: [x, y, w, h], points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], action: 'inspect', target: null, requires: [], set: {}, text: '', bubble: null, ...over,
});
const testStory = {
  schema: 2, story: { id: 's60', name: 'Test' }, start: 's60.fr01', flags_referenced: ['asked', 'heard', 'knocked', 'met', 'saw_bottle'],
  entry_points: { 'bar_kanpai.mama': 's60.fr01', 'hotel_rouge.room_303': 's60.fr20' },
  frames: {
    's60.fr01': fr({ entry_point: 'bar_kanpai.mama', on_enter: { set: { met: true } }, bubbles: [bubble('b01', 'Evening.')], next: 's60.fr02' }),
    's60.fr02': fr({
      choices: [
        { id: 'c01', text: 'Come inside.', target: 's60.fr10', requires: [], set: {} },
        { id: 'c02', text: 'Ask about him.', target: 's60.fr03', requires: ['!asked'], set: { asked: true } },
        { id: 'c03', text: 'Ask about the hotel.', target: 's60.fr03', requires: ['!heard'], set: { heard: true } },
        { id: 'c04', text: 'Goodnight.', target: 'exit:bar_kanpai.out', requires: [], set: {} },
      ],
    }),
    's60.fr03': fr({ bubbles: [bubble('b01', 'Well...')], next: 's60.fr02' }),
    's60.fr10': fr({
      bubbles: [bubble('b01', 'Keep bottles, each with a tag.', 'hotspot')],
      hotspots: [
        rect('h01', [0.1, 0.1, 0.2, 0.2], { set: { saw_bottle: true }, bubble: 'b01' }),
        rect('h02', [0.4, 0.3, 0.2, 0.3], { text: 'An old photo.' }),
        rect('h03', [0.8, 0.1, 0.1, 0.8], { action: 'go', target: 'exit:bar_kanpai.out' }),
      ],
    }),
    's60.fr20': fr({ entry_point: 'hotel_rouge.room_303', next: 's60.fr21' }),
    's60.fr21': fr({
      choices: [
        { id: 'c01', text: 'Knock again.', target: 's60.fr22', requires: ['!knocked'], set: {} },
        { id: 'c02', text: 'Leave it.', target: 'exit:hotel_rouge.floor3', requires: [], set: {} },
      ],
    }),
    's60.fr22': fr({ on_enter: { set: { knocked: true } }, next: 'exit:hotel_rouge.floor3' }),
  },
};
const testLib = new VnLibrary({ s60: testStory }, {
  s60: { schema: 1, entry_points: { 'bar_kanpai.mama': { story_id: 's60', frame: 's60.fr01' }, 'hotel_rouge.room_303': { story_id: 's60', frame: 's60.fr20' } } },
}, (dir, path) => `${dir}/${path}`);

describe('VN library (the exports in content/vn)', () => {
  it('loads every export cleanly', () => {
    expect(lib.errors).toEqual([]);
  });

  it('loads a story, its entry points and its stills', () => {
    expect(testLib.errors).toEqual([]);
    expect(testLib.stories.get('s60')).toBe('Test');
    expect(testLib.entries.get('hotel_rouge.room_303')).toBe('s60.fr20');
    expect(testLib.imageOf('s60.fr01')).toBe('s60/assets/x.jpg');
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

describe('VN branch frames (schema 3)', () => {
  const frame = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    entry_point: null, image: 'assets/x.png', video: null, size: [4, 4], title: '', bubbles: [], on_enter: { set: {} },
    next: null, choices: [], hotspots: [], branches: [], ...over,
  });
  const scene = (frames: Record<string, unknown>, entry: Record<string, string> = {}, flags: string[] = []): Record<string, unknown> => ({
    schema: 3, story: { id: 's70', name: 'branches' }, start: Object.keys(frames)[0], flags_referenced: flags, entry_points: entry, frames,
  });
  const router = frame({
    entry_point: 'bar.mama', image: null, size: null, title: 'By flags', next: 's70.fr02', on_enter: { set: { visited: true } },
    branches: [
      { id: 'r01', requires: ['julie', '!angry'], target: 's70.fr03' },
      { id: 'r02', requires: ['angry'], target: 'exit:bar.out' },
    ],
  });
  const branching = scene({ 's70.fr01': router, 's70.fr02': frame(), 's70.fr03': frame() }, { 'bar.mama': 's70.fr01' }, ['angry', 'julie', 'visited']);
  const library = (sc: Record<string, unknown>): VnLibrary =>
    new VnLibrary({ a: sc }, { a: { schema: 1, entry_points: { 'bar.mama': { story_id: 's70', frame: 's70.fr01' } } } });

  it('goes to the first row whose flags hold, else to next, and never stops on the branch frame', () => {
    const lib3 = library(branching);
    expect(lib3.errors).toEqual([]);
    const flags = flagStore();
    const vn = new VnEngine(lib3, flags);
    expect(vn.enter('bar.mama')).toEqual({ kind: 'frame', key: 's70.fr02' });
    expect(flags.all.get('visited')).toBe(true);
    flags.set('julie', true);
    expect(vn.enter('bar.mama')).toEqual({ kind: 'frame', key: 's70.fr03' });
    flags.set('angry', true);
    expect(vn.enter('bar.mama')).toEqual({ kind: 'exit', to: 'bar.out' });
  });

  it('stops a loop of branch frames instead of hanging', () => {
    const loop = scene(
      {
        's70.fr01': frame({ entry_point: 'bar.mama', image: null, size: null, next: 's70.fr02', branches: [{ id: 'r01', requires: [], target: 's70.fr02' }] }),
        's70.fr02': frame({ image: null, size: null, branches: [{ id: 'r01', requires: [], target: 's70.fr01' }] }),
      },
      { 'bar.mama': 's70.fr01' },
    );
    const vn = new VnEngine(library(loop), flagStore());
    expect(vn.enter('bar.mama')).toEqual({ kind: 'end' });
    expect(vn.key).toBe(null);
  });

  it('validates branches: targets, flags, and flags_referenced', () => {
    expect(validateScene('ok', branching)).toEqual([]);
    const bad = scene({ 's70.fr01': frame({ branches: [{ id: 'r01', requires: ['Not A Flag'], target: null }] }) });
    const problems = validateScene('bad', bad);
    expect(problems.some((p) => p.includes('needs a target'))).toBe(true);
    expect(problems.some((p) => p.includes('bad flag'))).toBe(true);
    const unlisted = scene({ 's70.fr01': frame({ branches: [{ id: 'r01', requires: ['julie'], target: 's70.fr01' }] }) });
    expect(validateScene('unlisted', unlisted).some((p) => p.includes('flags_referenced'))).toBe(true);
  });
});

describe('VN engine (the test story)', () => {
  it('plays the talk, gates the choices on flags, and exits to the bar', () => {
    const flags = flagStore();
    const vn = new VnEngine(testLib, flags);
    expect(vn.enter('bar_kanpai.mama')).toEqual({ kind: 'frame', key: 's60.fr01' });
    expect(flags.all.get('met')).toBe(true);
    expect(vn.next()).toEqual({ kind: 'frame', key: 's60.fr02' });
    expect(vn.choices().map((c) => c.id)).toEqual(['c01', 'c02', 'c03', 'c04']);
    // Ask about the hotel, then back to the menu without that choice.
    expect(vn.pick('c03')).toEqual({ kind: 'frame', key: 's60.fr03' });
    expect(flags.all.get('heard')).toBe(true);
    expect(vn.next()).toEqual({ kind: 'frame', key: 's60.fr02' });
    expect(vn.choices().map((c) => c.id)).toEqual(['c01', 'c02', 'c04']);
    expect(vn.pick('c04')).toEqual({ kind: 'exit', to: 'bar_kanpai.out' });
  });

  it('lets you look round inside: inspect hotspots set flags, the door is an exit', () => {
    const flags = flagStore();
    const vn = new VnEngine(testLib, flags);
    vn.enter('bar_kanpai.mama');
    vn.next();
    vn.pick('c01');
    expect(vn.key).toBe('s60.fr10');
    const bottles = vn.use('h01');
    expect(bottles?.kind).toBe('inspect');
    expect(bottles && 'text' in bottles && bottles.text).toContain('tag');
    expect(flags.all.get('saw_bottle')).toBe(true);
    const photo = vn.use('h02');
    expect(photo && 'text' in photo && photo.text).toBe('An old photo.');
    expect(vn.use('h03')).toEqual({ kind: 'exit', to: 'bar_kanpai.out' });
  });

  it('knocks once, and never twice', () => {
    const flags = flagStore();
    const vn = new VnEngine(testLib, flags);
    vn.enter('hotel_rouge.room_303');
    vn.next();
    expect(vn.pick('c01')).toEqual({ kind: 'frame', key: 's60.fr22' });
    expect(flags.all.get('knocked')).toBe(true);
    expect(vn.next()).toEqual({ kind: 'exit', to: 'hotel_rouge.floor3' });
    vn.enter('hotel_rouge.room_303');
    vn.next();
    expect(vn.choices().map((c) => c.id)).toEqual(['c02']);
  });

  it('hit-tests hotspots by shape', () => {
    const f = testLib.frames.get('s60.fr10')!;
    const photo = f.hotspots.find((h) => h.id === 'h02')!;
    expect(hitHotspot(photo, 0.5, 0.45)).toBe(true);
    expect(hitHotspot(photo, 0.62, 0.45)).toBe(false);
    const round = { ...photo, shape: 'circle' as const, box: [0.4, 0.4, 0.2, 0.2] as const, points: [] };
    expect(hitHotspot(round, 0.5, 0.5)).toBe(true);
    expect(hitHotspot(round, 0.41, 0.41)).toBe(false);
  });
});

describe('VN keys (npm run vn:keys)', () => {
  const keys = vnKeys(loadDistrictContent().placed, testLib);

  it('lists npcs and story doors as entry keys, with their scenes, and spawns as exits', () => {
    expect(keys.entries['bar_kanpai.mama']).toMatchObject({ kind: 'npc', scene: 's60.fr01' });
    expect(keys.entries['hotel_rouge.room_303']).toMatchObject({ kind: 'door', floor: 10, scene: 's60.fr20' });
    expect(keys.entries['yoru_mart.clerk']?.scene).toBeNull();
    expect(keys.exits['bar_kanpai.out']).toBeTruthy();
  });

  it('leaves out plain doorways, rides and spawns from the entries', () => {
    expect(keys.entries['hotel_rouge.entrance']).toBeUndefined();
    expect(keys.entries['sakura_yu.door']).toBeUndefined();
    expect(keys.entries['the_peak.penthouse']).toBeUndefined();
    expect(keys.entries['bar_kanpai.out']).toBeUndefined();
  });
});
