import { describe, expect, it } from 'vitest';
import { FlagStore, type FlagValue } from '../src/core/flags';
import { loadPhoneContent } from '../src/phone/content';
import { Phone } from '../src/phone/engine';
import { parseSave, SAVE_VERSION, type SaveGame } from '../src/save/save';

const content = loadPhoneContent();
const run = (p: Phone, s: number): void => {
  for (let t = 0; t < s; t += 0.1) p.update(0.1);
};
const flagsOf = (init: Record<string, FlagValue> = {}): { get(k: string): FlagValue | undefined; set(k: string, v: boolean): void } => {
  const all = new Map<string, FlagValue>(Object.entries(init));
  return { get: (k) => all.get(k), set: (k, v) => void all.set(k, v) };
};

describe('saves', () => {
  it('keeps and restores every story flag, and tells listeners what changed', () => {
    const a = new FlagStore({ 'world.time': 'dusk', met_mama: true, count: 3 });
    const kept = a.entries();
    expect(kept).toEqual({ 'world.time': 'dusk', met_mama: true, count: 3 });
    const b = new FlagStore({ 'world.time': 'night', stale: true });
    const heard: string[] = [];
    b.subscribe((k) => heard.push(k));
    b.load(JSON.parse(JSON.stringify(kept)));
    expect(b.entries()).toEqual(kept);
    expect(b.get('stale')).toBeUndefined();
    expect(new Set(heard)).toEqual(new Set(['world.time', 'stale', 'met_mama', 'count']));
  });

  it('puts the phone back mid-conversation: the messages so far, the unread count, and what comes next', () => {
    const flags = flagsOf({ met_mama: true });
    const a = new Phone(content.contacts, flags, 600);
    run(a, 40);
    const snap = a.snapshot();
    const b = new Phone(content.contacts, flags, 0);
    b.restore(JSON.parse(JSON.stringify(snap)));
    for (const c of content.contacts) {
      expect(b.messages(c.id)).toEqual(a.messages(c.id));
      expect(b.replies(c.id)).toEqual(a.replies(c.id));
    }
    expect(b.clock).toBe(a.clock);
    // And they carry on the same from there.
    run(a, 60);
    run(b, 60);
    for (const c of content.contacts) expect(b.messages(c.id)).toEqual(a.messages(c.id));
  });

  it('reads a save back, and refuses one it cannot load', () => {
    const good: SaveGame = {
      v: SAVE_VERSION,
      savedAt: '2026-09-29T20:00:00.000Z',
      place: 'Kaburo · Kaburo Crossing',
      played: 1234,
      current: 'mc',
      world: { flags: { 'world.time': 'night' } },
      characters: { mc: { id: 'mc', name: 'MC', at: { x: 3816, y: 1.7, z: 1562, yaw: 30, pitch: 4 }, driving: false, car: null, phone: null, profile: null } },
    };
    expect(parseSave(JSON.stringify(good))).toEqual(good);
    expect(parseSave(null)).toBeNull();
    expect(parseSave('not json')).toBeNull();
    expect(parseSave(JSON.stringify({ ...good, v: 99 }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...good, current: 'nobody' }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...good, characters: { mc: { ...good.characters.mc, at: { x: 1 } } } }))).toBeNull();
  });
});
