import { describe, expect, it } from 'vitest';
import { edition } from '@edition';
import { kaburoArt } from '../src/edition/art';
import { edition as demo } from '../src/edition/demo';
import { characters } from '../src/edition/characters';
import { DEMO_HIDDEN_ART, DEMO_HIDDEN_CHARACTERS } from '../src/edition/demoArt';
import { applyPhoneOverlays } from '../src/edition/phoneOverlay';
import { edition as uncensored } from '../src/edition/uncensored';
import { applyVnOverlays } from '../src/edition/vnOverlay';
import { parseContact } from '../src/phone/format';
import { loadPhoneContent } from '../src/phone/content';
import { ALL_DISTRICT_ADS, DISTRICT_ADS, districtAdsFor } from '../src/poc3d/models/ads';
import { VnEngine, VnLibrary } from '../src/vn/engine';

const frame = (over: object = {}): object => ({ entry_point: null, image: null, video: null, size: null, title: '', bubbles: [], on_enter: { set: {} }, next: null, choices: [], hotspots: [], ...over });
const bubble = (id: string, text: string): object => ({ id, text, kind: 'speech', x: 0.5, y: 0.8, show: 'enter', duration: 3 });

/** A base story: arrive (sets met), a fade, the morning after, a choice. */
const base = (): Record<string, unknown> => ({
  s50: {
    schema: 2, story: { id: 's50', name: 'Test' }, start: 's50.fr01', flags_referenced: ['met', 'stayed'], entry_points: { 'a.b': 's50.fr01' },
    frames: {
      's50.fr01': frame({ entry_point: 'a.b', on_enter: { set: { met: true } }, bubbles: [bubble('b01', 'Hi.')], next: 's50.fr02' }),
      's50.fr02': frame({ bubbles: [bubble('b01', '(The lights go down.)')], next: 's50.fr03' }),
      's50.fr03': frame({
        bubbles: [bubble('b01', 'Morning.')],
        choices: [{ id: 'c01', text: 'Stay', target: 'exit:a.c', requires: [], set: { stayed: true } }, { id: 'c02', text: 'Go', target: 'exit:a.c', requires: [], set: {} }],
      }),
    },
  },
});

describe('editions', () => {
  it('tests and the dev server run the standard edition: the story, all the art, nothing from adult/', () => {
    expect(edition.name).toBe('standard');
    expect(edition.narrative).toBe(true);
    expect(edition.overlay.vnScenes).toEqual({});
    expect(edition.overlay.phoneFiles).toEqual({});
    expect(Object.keys(edition.story.phoneFiles)).toContain('kaiwa.yaml');
    expect(DISTRICT_ADS).toBe(ALL_DISTRICT_ADS);
  });

  it("the uncensored edition's own overlays (adult/, if checked out) apply cleanly", () => {
    const { story, overlay } = uncensored;
    expect(applyVnOverlays(story.vnScenes, overlay.vnScenes).errors).toEqual([]);
    const media = (p: string): boolean => p in overlay.phoneMedia || p in story.phoneMedia;
    expect(applyPhoneOverlays(loadPhoneContent().contacts, overlay.phoneFiles, media).errors).toEqual([]);
  });

  it("the demo has no story: no scenes, and only KAIWA's welcome on the phone", () => {
    expect(demo.narrative).toBe(false);
    expect(demo.story.vnScenes).toEqual({});
    expect(demo.story.vnAssets).toEqual({});
    expect(Object.keys(demo.story.phoneFiles)).toEqual(['kaiwa.yaml']);
    expect(demo.overlay.vnScenes).toEqual({});
  });

  it('the demo leaves out exactly the revealing ads, from its art and from the ad list', () => {
    for (const name of DEMO_HIDDEN_ART) expect(kaburoArt[name], `${name} is a real file`).toBeTruthy();
    const kept = Object.keys(kaburoArt).filter((n) => !DEMO_HIDDEN_ART.has(n)).sort();
    expect(Object.keys(demo.kaburoArt).sort()).toEqual(kept);
    const ads = districtAdsFor('demo');
    expect(ads.some((a) => DEMO_HIDDEN_ART.has(a.art))).toBe(false);
    expect(ads.length).toBe(ALL_DISTRICT_ADS.filter((a) => !DEMO_HIDDEN_ART.has(a.art)).length);
    for (const a of ads) expect(demo.kaburoArt[a.art], a.art).toBeTruthy();
  });
  it('the demo leaves out exactly the hidden cast models (Mack nude)', () => {
    for (const name of DEMO_HIDDEN_CHARACTERS) expect(characters[name], `${name} is a real file`).toBeTruthy();
    const kept = Object.keys(characters).filter((n) => !DEMO_HIDDEN_CHARACTERS.has(n)).sort();
    expect(Object.keys(demo.characters).sort()).toEqual(kept);
    expect(Object.keys(edition.characters).sort()).toEqual(Object.keys(characters).sort());
  });
});

describe('VN overlays', () => {
  it('replaces what a frame shows and adds frames that lead back, keeping the story the same', () => {
    const { scenes, errors } = applyVnOverlays(base(), {
      s50: {
        overlay: 1, story: 's50',
        frames: {
          's50.fr02': { image: 'assets/s50.fr02.jpg', bubbles: [bubble('b01', 'Uncensored.')], next: 's50.fr901' },
          's50.fr901': { image: 'assets/s50.fr901.jpg', bubbles: [], next: 's50.fr902' },
          's50.fr902': { bubbles: [bubble('b01', 'Later.')], next: 's50.fr03' },
          's50.fr03': { choices: [{ id: 'c01', text: 'Stay a while' }] },
        },
      },
    });
    expect(errors).toEqual([]);
    const lib = new VnLibrary(scenes, { s50: { schema: 1, entry_points: { 'a.b': { story_id: 's50', frame: 's50.fr01' } } } });
    expect(lib.errors).toEqual([]);
    const flags = new Map<string, boolean>();
    const vn = new VnEngine(lib, { get: (k) => flags.get(k), set: (k, v) => void flags.set(k, v) });
    const path = [vn.enter('a.b')];
    while (vn.frame && vn.frame.choices.length === 0) path.push(vn.next());
    expect(path.map((s) => (s?.kind === 'frame' ? s.key : s?.kind))).toEqual(['s50.fr01', 's50.fr02', 's50.fr901', 's50.fr902', 's50.fr03']);
    expect(vn.frame?.bubbles[0].text).toBe('Morning.');
    const stay = vn.choices()[0];
    expect(stay.text).toBe('Stay a while');
    expect(stay.set).toEqual({ stayed: true });
    expect(vn.pick('c01')).toEqual({ kind: 'exit', to: 'a.c' });
    expect([...flags]).toEqual([['met', true], ['stayed', true]]);
  });

  it('refuses to change where the story goes or what it remembers, and falls back to standard', () => {
    const cases: [object, RegExp][] = [
      [{ 's50.fr01': { on_enter: { set: { met: false } } } }, /on_enter can't change/],
      [{ 's50.fr01': { entry_point: 'x.y' } }, /entry_point can't change/],
      [{ 's50.fr03': { choices: [{ id: 'c01', target: 's50.fr01' }] } }, /only a choice's text/],
      [{ 's50.fr03': { choices: [{ id: 'c09', text: 'New' }] } }, /isn't one of the frame's/],
      [{ 's50.fr03': { next: 's50.fr901' }, 's50.fr901': { next: 's50.fr03' } }, /no choices or branches/],
      [{ 's50.fr02': { next: 's50.fr901' }, 's50.fr901': { next: 'exit:a.c' } }, /not back to s50.fr03/],
      [{ 's50.fr02': { next: 's50.fr901' }, 's50.fr901': { next: 's50.fr902' }, 's50.fr902': { next: 's50.fr901' } }, /loop/],
      [{ 's50.fr901': { next: 's50.fr03' } }, /nothing leads to this new frame/],
      [{ 's50.fr02': { next: 's50.fr901' }, 's50.fr901': { next: 's50.fr03', choices: [] } }, /pictures and words only/],
    ];
    for (const [frames, why] of cases) {
      const { scenes, errors } = applyVnOverlays(base(), { s50: { overlay: 1, story: 's50', frames } });
      expect(errors.join('\n'), JSON.stringify(frames)).toMatch(why);
      expect(scenes.s50).toEqual(base().s50);
    }
    expect(applyVnOverlays(base(), { s77: { overlay: 1, story: 's77', frames: {} } }).errors[0]).toMatch(/no story content\/vn\/s77/);
  });
});

describe('phone overlays', () => {
  const contact = (): ReturnType<typeof parseContact> =>
    parseContact('x.yaml', `
id: mika
name: Mika
beats:
  - id: late
    when: met_mika
    after: 30
    messages: [ { text: "Still up?" } ]
    replies:
      - text: Yeah.
        set: { replied_mika: true }
        then: [ { text: "Good." } ]
    set: { mika_late: true }
`, [], () => true);

  it('replaces what a beat shows and keeps its flags', () => {
    const base = contact();
    expect(base).not.toBeNull();
    const { contacts, errors } = applyPhoneOverlays([base!], {
      'mika.yaml': `
id: mika
beats:
  - id: late
    messages: [ { photo: media/mika_late.jpg }, { text: "Still up? ;)" } ]
    replies:
      - text: Very.
        then: [ { text: "Come over." } ]
`,
    }, () => true);
    expect(errors).toEqual([]);
    const beat = contacts[0].beats[0];
    expect(beat.messages.map((m) => m.body.kind)).toEqual(['photo', 'text']);
    expect(beat.replies[0].text).toBe('Very.');
    expect(beat.replies[0].set).toEqual({ replied_mika: true });
    expect(beat.set).toEqual({ mika_late: true });
    expect(beat.when).toBe(base!.beats[0].when);
    expect(beat.after).toBe(30);
  });

  it('refuses flags, conditions, unknown beats and a different number of replies', () => {
    const cases: [string, RegExp][] = [
      ['id: mika\nbeats:\n  - id: late\n    when: other\n    messages: [ { text: x } ]', /when can't change/],
      ['id: mika\nbeats:\n  - id: late\n    set: { x: true }\n    messages: [ { text: x } ]', /set can't change/],
      ['id: mika\nbeats:\n  - id: late\n    replies:\n      - text: a\n        set: { x: true }', /only text and then/],
      ['id: mika\nbeats:\n  - id: late\n    replies: [ { text: a }, { text: b } ]', /give all 1 replies/],
      ['id: mika\nbeats:\n  - id: early\n    messages: [ { text: x } ]', /no such beat/],
      ['id: nobody\nbeats:\n  - id: late\n    messages: [ { text: x } ]', /no contact nobody/],
      ['id: mika\nname: Other\nbeats:\n  - id: late\n    messages: [ { text: x } ]', /name can't change/],
    ];
    for (const [text, why] of cases) {
      const base = contact()!;
      const { contacts, errors } = applyPhoneOverlays([base], { 'mika.yaml': text }, () => true);
      expect(errors.join('\n'), text).toMatch(why);
      expect(contacts[0]).toBe(base);
    }
  });
});
