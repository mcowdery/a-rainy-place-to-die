import { describe, expect, it } from 'vitest';
import type { FlagValue } from '../src/core/flags';
import { loadPhoneContent } from '../src/phone/content';
import { Phone } from '../src/phone/engine';
import { parseContact } from '../src/phone/format';

const content = loadPhoneContent();
const flagStore = (init: Record<string, boolean> = {}): { get(k: string): FlagValue | undefined; set(k: string, v: boolean): void; all: Map<string, FlagValue> } => {
  const all = new Map<string, FlagValue>(Object.entries(init));
  return { all, get: (k) => all.get(k), set: (k, v) => void all.set(k, v) };
};
/** Run the phone for `s` seconds in 0.1 s steps. */
const run = (p: Phone, s: number): void => {
  for (let t = 0; t < s; t += 0.1) p.update(0.1);
};

describe('Phone content (content/phone)', () => {
  it('loads every contact cleanly, media and all', () => {
    expect(content.errors).toEqual([]);
    expect(content.contacts.map((c) => c.id).sort()).toEqual(['kaiwa', 'kirishima', 'mama', 'matchbook']);
    expect(content.url('media/rouge_cam.webm')).toBeTruthy();
  });

  it('reports every problem in a bad file', () => {
    const errors: string[] = [];
    const c = parseContact('x.yaml', 'id: Bad Id\nbeats:\n  - id: a\n    when: "(("\n    messages: [{ photo: media/nope.jpg }, { text: hi, sticker: x }]\n  - id: a\n    replies: [{ text: "" }]\n', errors, () => false);
    expect(c).toBeNull();
    const all = errors.join('\n');
    for (const want of ['id must match', 'name is required', 'when:', 'no such file', 'exactly one of', 'id used twice', 'needs text']) expect(all).toContain(want);
  });
});

describe('Phone engine', () => {
  it('welcomes you, then Mama-san texts after you meet her, with a photo and replies', () => {
    const flags = flagStore();
    const p = new Phone(content.contacts, flags);
    run(p, 15);
    expect(p.contacts().map((c) => c.id)).toEqual(['kaiwa']);
    expect(p.messages('kaiwa').map((m) => m.body.kind)).toEqual(['text', 'text', 'sticker']);
    expect(p.totalUnread).toBe(3);
    flags.set('met_mama', true);
    run(p, 44);
    expect(p.contacts().some((c) => c.id === 'mama')).toBe(false);
    run(p, 3);
    expect(p.typing('mama') || p.messages('mama').length > 0).toBe(true);
    run(p, 10);
    expect(p.messages('mama').map((m) => m.body.kind)).toEqual(['text', 'photo']);
    expect(p.contacts()[0].id).toBe('mama');
    expect(p.replies('mama').map((r) => r.text)).toEqual(['Heading your way.', 'Maybe tomorrow.']);
    expect(p.reply('mama', 0)).toBe(true);
    expect(flags.all.get('mama_invited')).toBe(true);
    expect(p.replies('mama')).toEqual([]);
    run(p, 6);
    const msgs = p.messages('mama');
    expect(msgs.map((m) => `${m.from}:${m.body.kind}`)).toEqual(['them:text', 'them:photo', 'me:text', 'them:text', 'them:sticker']);
    expect(msgs[2].seen).toBe(true);
  });

  it('holds a later beat back until you answer the one before', () => {
    const flags = flagStore({ met_mama: true });
    const p = new Phone(content.contacts, flags);
    run(p, 60);
    expect(p.messages('mama').length).toBe(2);
    // The castle beat comes due, but the rain beat is waiting on your reply.
    flags.set('got_matchbook', true);
    run(p, 60);
    expect(p.messages('mama').length).toBe(2);
    p.reply('mama', 1);
    run(p, 60);
    expect(p.messages('mama').filter((m) => m.from === 'them').length).toBe(6);
  });

  it('lets you write first to the matchbook number, and sets flags when a beat ends', () => {
    const flags = flagStore({ got_matchbook: true });
    const p = new Phone(content.contacts, flags);
    run(p, 11);
    expect(p.contacts().some((c) => c.id === 'matchbook')).toBe(true);
    expect(p.messages('matchbook')).toEqual([]);
    expect(p.replies('matchbook').length).toBe(2);
    expect(p.awaiting).toBe(1);
    p.reply('matchbook', 1);
    run(p, 40);
    expect(p.messages('matchbook').map((m) => `${m.from}:${m.body.kind}`)).toEqual(['me:text', 'them:photo', 'them:text', 'them:text']);
    expect(flags.all.get('matchbook_hint')).toBe(true);
  });

  it('sends Kirishima\'s video once you ask about him', () => {
    const flags = flagStore({ asked_detective: true });
    const p = new Phone(content.contacts, flags);
    run(p, 45);
    const video = p.messages('kirishima').find((m) => m.body.kind === 'video');
    expect(video && video.body.kind === 'video' && video.body.media).toBe('media/rouge_cam.webm');
    p.reply('kirishima', 0);
    run(p, 10);
    expect(flags.all.get('saw_rouge_tape')).toBe(true);
  });

  it('keeps a clock from the time of day', () => {
    const p = new Phone([], flagStore(), 23 * 60 + 59);
    expect(Phone.time(p.clock)).toBe('23:59');
    run(p, 61);
    expect(Phone.time(p.clock)).toBe('00:00');
  });
});
