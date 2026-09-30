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
/** Test contacts (content/phone ships only KAIWA's welcome for now), parsed like real ones. */
const contact = (text: string) => {
  const errors: string[] = [];
  const c = parseContact('test.yaml', text, errors, () => true);
  if (!c) throw new Error(errors.join('\n'));
  return c;
};
const friend = contact(`
id: friend
name: Friend
beats:
  - id: rain
    when: met_friend
    after: 45
    messages:
      - text: It's really coming down.
      - photo: media/counter.jpg
        caption: The counter's warm tonight.
    replies:
      - text: Heading your way.
        set: { invited: true }
        then:
          - text: I'll keep the kettle on.
          - sticker: 🍶
      - text: Maybe tomorrow.
        then:
          - text: Suit yourself.
          - sticker: ☂️
  - id: later
    when: knocked
    after: 30
    messages:
      - text: Someone saw you knocking.
      - text: What did I tell you?
`);
const number = contact(`
id: number
name: 090-0000-0000
beats:
  - id: first
    when: got_number
    after: 10
    replies:
      - text: Found your number.
        then: [ { photo: media/door.jpg }, { text: Stop knocking. } ]
      - text: Who is this?
        then: [ { photo: media/door.jpg }, { text: Stop knocking. } ]
  - id: hint
    when: got_number
    after: 20
    messages:
      - text: Ask her about the photo.
    set: { hinted: true }
`);
const watcher = contact(`
id: watcher
name: Watcher
beats:
  - id: tape
    when: asked
    after: 30
    messages:
      - text: Since you're curious.
      - video: media/door_cam.webm
        caption: Every Thursday, 2:14 a.m.
    replies:
      - text: Who goes in?
        then: [ { text: If I knew, I wouldn't be asking you. } ]
    set: { saw_tape: true }
`);
const contacts = [...content.contacts, friend, number, watcher];
/** Run the phone for `s` seconds in 0.1 s steps. */
const run = (p: Phone, s: number): void => {
  for (let t = 0; t < s; t += 0.1) p.update(0.1);
};

describe('Phone content (content/phone)', () => {
  it('loads every contact cleanly, media and all', () => {
    expect(content.errors).toEqual([]);
    expect(content.contacts.map((c) => c.id).sort()).toEqual(['kaiwa']);
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
  it('welcomes you, then a friend texts after you meet them, with a photo and replies', () => {
    const flags = flagStore();
    const p = new Phone(contacts, flags);
    run(p, 15);
    expect(p.contacts().map((c) => c.id)).toEqual(['kaiwa']);
    expect(p.messages('kaiwa').map((m) => m.body.kind)).toEqual(['text', 'text', 'sticker']);
    expect(p.totalUnread).toBe(3);
    flags.set('met_friend', true);
    run(p, 44);
    expect(p.contacts().some((c) => c.id === 'friend')).toBe(false);
    run(p, 3);
    expect(p.typing('friend') || p.messages('friend').length > 0).toBe(true);
    run(p, 10);
    expect(p.messages('friend').map((m) => m.body.kind)).toEqual(['text', 'photo']);
    expect(p.contacts()[0].id).toBe('friend');
    expect(p.replies('friend').map((r) => r.text)).toEqual(['Heading your way.', 'Maybe tomorrow.']);
    expect(p.reply('friend', 0)).toBe(true);
    expect(flags.all.get('invited')).toBe(true);
    expect(p.replies('friend')).toEqual([]);
    run(p, 6);
    const msgs = p.messages('friend');
    expect(msgs.map((m) => `${m.from}:${m.body.kind}`)).toEqual(['them:text', 'them:photo', 'me:text', 'them:text', 'them:sticker']);
    expect(msgs[2].seen).toBe(true);
  });

  it('holds a later beat back until you answer the one before', () => {
    const flags = flagStore({ met_friend: true });
    const p = new Phone(contacts, flags);
    run(p, 60);
    expect(p.messages('friend').length).toBe(2);
    // The later beat comes due, but the rain beat is waiting on your reply.
    flags.set('knocked', true);
    run(p, 60);
    expect(p.messages('friend').length).toBe(2);
    p.reply('friend', 1);
    run(p, 60);
    expect(p.messages('friend').filter((m) => m.from === 'them').length).toBe(6);
  });

  it('lets you write first, and sets flags when a beat ends', () => {
    const flags = flagStore({ got_number: true });
    const p = new Phone(contacts, flags);
    run(p, 11);
    expect(p.contacts().some((c) => c.id === 'number')).toBe(true);
    expect(p.messages('number')).toEqual([]);
    expect(p.replies('number').length).toBe(2);
    expect(p.awaiting).toBe(1);
    p.reply('number', 1);
    run(p, 40);
    expect(p.messages('number').map((m) => `${m.from}:${m.body.kind}`)).toEqual(['me:text', 'them:photo', 'them:text', 'them:text']);
    expect(flags.all.get('hinted')).toBe(true);
  });

  it('sends a video, and sets the beat\'s flags once you reply', () => {
    const flags = flagStore({ asked: true });
    const p = new Phone(contacts, flags);
    run(p, 45);
    const video = p.messages('watcher').find((m) => m.body.kind === 'video');
    expect(video && video.body.kind === 'video' && video.body.media).toBe('media/door_cam.webm');
    p.reply('watcher', 0);
    run(p, 10);
    expect(flags.all.get('saw_tape')).toBe(true);
  });

  it('keeps a clock from the time of day', () => {
    const p = new Phone([], flagStore(), 23 * 60 + 59);
    expect(Phone.time(p.clock)).toBe('23:59');
    run(p, 61);
    expect(Phone.time(p.clock)).toBe('00:00');
  });
});
