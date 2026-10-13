import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FlagValue } from '../src/core/flags';
import { PAGER_MEMORY, Phone, type PhoneEvent } from '../src/phone/engine';
import { parseContact } from '../src/phone/format';
import { digitsSvg, PAGER_AREAS, PAGER_COLS, segmentsOf } from '../src/phone/pagerUi';

const flagStore = (init: Record<string, boolean> = {}): { get(k: string): FlagValue | undefined; set(k: string, v: boolean): void; all: Map<string, FlagValue> } => {
  const all = new Map<string, FlagValue>(Object.entries(init));
  return { all, get: (k) => all.get(k), set: (k, v) => void all.set(k, v) };
};
const parse = (text: string): { contact: ReturnType<typeof parseContact>; errors: string[] } => {
  const errors: string[] = [];
  return { contact: parseContact('test.yaml', text, errors, () => true), errors };
};
const CASH = `
id: cash
name: キャッシュ・ワン
number: 03-5550-0117
card: true
beats:
  - id: monday
    channel: pager
    when: owes_monday
    messages: [{ text: Monday. Same as always. }, { text: Be on time. }]
    set: { cash_called: true }
  - id: code
    channel: pager
    when: cash_called
    page: '724106'
    reads: なにしてる
    messages: [{ text: Well? }]
`;
const run = (p: Phone, seconds: number): PhoneEvent[] => {
  const out: PhoneEvent[] = [];
  for (let t = 0; t < seconds; t += 0.1) out.push(...p.update(0.1));
  return out;
};

describe('A pager beat in a contact file', () => {
  it('takes a number, a card, a code and its reading', () => {
    const { contact, errors } = parse(CASH);
    expect(errors).toEqual([]);
    expect(contact?.number).toBe('03-5550-0117');
    expect(contact?.card).toBe(true);
    expect(contact?.beats.map((b) => [b.channel, b.page, b.reads])).toEqual([['pager', null, null], ['pager', '724106', 'なにしてる']]);
  });

  it('refuses a pager beat with no number to ring back, with replies, or with digits a pager can\'t show', () => {
    const noNumber = parse('id: x\nname: X\nbeats:\n  - id: a\n    channel: pager\n    messages: [{ text: hi }]\n');
    expect(noNumber.contact).toBeNull();
    expect(noNumber.errors.join('\n')).toContain('needs the contact\'s number');
    const replies = parse('id: x\nname: X\nnumber: 03-1\nbeats:\n  - id: a\n    channel: pager\n    messages: [{ text: hi }]\n    replies: [{ text: yes }]\n');
    expect(replies.errors.join('\n')).toContain('can\'t have replies yet');
    const digits = parse('id: x\nname: X\nnumber: 03-ABC\nbeats:\n  - id: a\n    messages: [{ text: hi }]\n');
    expect(digits.errors.join('\n')).toContain('digits and dashes');
    const stray = parse('id: x\nname: X\nbeats:\n  - id: a\n    page: \'0840\'\n    messages: [{ text: hi }]\n');
    expect(stray.errors.join('\n')).toContain('for a pager beat');
  });
});

describe('The pager', () => {
  it('pages him with the number alone, and says what it was about only when he rings back', () => {
    const flags = flagStore();
    const p = new Phone([parse(CASH).contact!], flags);
    expect(run(p, 2).filter((e) => e.kind === 'page')).toEqual([]);
    flags.set('owes_monday', true);
    const pages = run(p, 2).filter((e) => e.kind === 'page');
    expect(pages.length).toBe(1);
    expect(p.pages().map((x) => x.digits)).toEqual(['03-5550-0117']);
    // Nothing has been said yet: no message in the thread, no flag set, however long he leaves it.
    run(p, 30);
    expect(p.messages('cash')).toEqual([]);
    expect(flags.get('cash_called')).toBeUndefined();
    expect(p.pages().length).toBe(1);
    // He has their card, so the game can name them; the pager itself only has the digits.
    expect(p.pagedBy(p.pages()[0])?.name).toBe('キャッシュ・ワン');
    // A wrong number rings nobody; theirs, with or without the dashes, is answered.
    expect(p.callBack('0355500199')).toBeNull();
    const call = p.callBack('0355500117');
    expect(call?.lines).toEqual(['Monday. Same as always.', 'Be on time.']);
    // Hung up before the end: they still wait, and he can ring again.
    expect(flags.get('cash_called')).toBeUndefined();
    expect(p.callBack('03-5550-0117')?.lines.length).toBe(2);
    call!.then();
    expect(flags.get('cash_called')).toBe(true);
    expect(p.callBack('0355500117')).toBeNull();
    // The next beat pages a number code, with what it says.
    const next = run(p, 2).filter((e) => e.kind === 'page');
    expect(next.length).toBe(1);
    expect(p.pages().map((x) => [x.digits, x.reads])).toEqual([['03-5550-0117', null], ['724106', 'なにしてる']]);
    expect(p.callBack('0355500117')?.lines).toEqual(['Well?']);
  });

  it('keeps the last few pages, forgets the oldest, and erases one', () => {
    const p = new Phone([], flagStore());
    for (let i = 0; i < PAGER_MEMORY + 2; i++) p.page(`03-5550-01${String(i).padStart(2, '0')}`);
    expect(p.pages().length).toBe(PAGER_MEMORY);
    expect(p.pages()[0].digits).toBe('03-5550-0102');
    expect(p.pagedBy(p.pages()[0])).toBeNull();
    p.erasePage(0);
    expect(p.pages().map((x) => x.digits)).toEqual(['03-5550-0103', '03-5550-0104', '03-5550-0105']);
  });

  it('comes back from a save with its memory and whoever is still waiting', () => {
    const flags = flagStore({ owes_monday: true });
    const p = new Phone([parse(CASH).contact!], flags);
    run(p, 2);
    const save = p.snapshot();
    const q = new Phone([parse(CASH).contact!], flags);
    q.restore(save);
    expect(q.pages().map((x) => x.digits)).toEqual(['03-5550-0117']);
    expect(q.callBack('0355500117')?.lines.length).toBe(2);
    // (A save from before the pager has no memory to restore.)
    const old = new Phone([parse(CASH).contact!], flagStore());
    old.restore({ ...save, pager: undefined });
    expect(old.pages()).toEqual([]);
  });
});

describe('The pager\'s window', () => {
  it('lights seven-segment figures, a ghost of every segment behind them', () => {
    expect(segmentsOf('8').length).toBe(7);
    expect(segmentsOf('1')).toBe('bc');
    expect(segmentsOf('-')).toBe('g');
    expect(segmentsOf('x')).toBe('');
    const svg = digitsSvg('18');
    expect(svg.match(/<polygon/g)?.length).toBe(PAGER_COLS * 7);
    expect(svg.match(/opacity="0.88"/g)?.length).toBe(2 + 7);
  });

  it('draws where the approved picture has its window and lamp (assets/phone/carry/layout.json)', () => {
    const layout = JSON.parse(readFileSync('assets/phone/carry/layout.json', 'utf8')) as Record<string, { width: number; height: number; areas: Record<string, number[]> }>;
    expect([layout.pager.width, layout.pager.height]).toEqual([PAGER_AREAS.width, PAGER_AREAS.height]);
    for (const k of ['digits', 'lamp', 'maker'] as const) expect(layout.pager.areas[k]).toEqual([...PAGER_AREAS[k]]);
  });
});
