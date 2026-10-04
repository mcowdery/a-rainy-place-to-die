import { describe, expect, it } from 'vitest';
import { GAP, cycleLength, nowPlaying, onAir, parseStations, playOrder, type Station } from '../src/poc3d/district/radio';
import text from '../content/radio/stations.yaml?raw';
import durationsText from '../assets/radio/durations.json?raw';
import credits from '../assets/radio/CREDITS.md?raw';

const durations = JSON.parse(durationsText) as Record<string, number>;
/** The music files there are (not loaded: only their paths). */
const files = Object.keys(import.meta.glob('../assets/radio/*/*.{ogg,opus,mp3}', { query: '?url' })).map((k) => k.replace('../assets/radio/', ''));

const station = (id: string, lengths: number[]): Station => ({ id, name: id, jp: '', freq: '80.0', blurb: '', tracks: lengths.map((seconds, i) => ({ file: `t${i}.ogg`, title: `Track ${i}`, artist: 'Nobody', seconds })) });

describe('the radio stations (content/radio/stations.yaml)', () => {
  const errors: string[] = [];
  const stations = parseStations('content/radio/stations.yaml', text, durations, errors);

  it('loads without errors, every track with a length', () => {
    expect(errors).toEqual([]);
    expect(stations.length).toBeGreaterThan(0);
    for (const s of stations) {
      expect(s.tracks.length, s.id).toBeGreaterThan(2);
      for (const t of s.tracks) expect(t.seconds, `${s.id}/${t.file}`).toBeGreaterThan(20);
    }
  });

  it('lists every indexed file, and credits every artist', () => {
    const listed = new Set(stations.flatMap((s) => s.tracks.map((t) => `${s.id}/${t.file}`)));
    for (const key of Object.keys(durations)) expect(listed.has(key), `${key} is in durations.json but not in stations.yaml`).toBe(true);
    for (const s of stations) for (const t of s.tracks) expect(credits, `${t.artist} (${s.id}/${t.file}) isn't in assets/radio/CREDITS.md`).toContain(t.artist);
  });

  it('has a length for every music file on disk (npm run radio:index)', () => {
    for (const f of files) expect(durations[f], f).toBeGreaterThan(1);
  });

  it('reports a track without a length, a bad id and a track listed twice', () => {
    const bad: string[] = [];
    parseStations('x.yaml', 'stations:\n  - id: Bad Id\n    tracks: []\n  - id: ok\n    tracks:\n      - { file: a.ogg, title: A }\n      - { file: b.ogg, title: B }\n      - { file: b.ogg, title: B again }\n', { 'ok/b.ogg': 100 }, bad);
    expect(bad.some((e) => e.includes('id must match'))).toBe(true);
    expect(bad.some((e) => e.includes("'a.ogg' has no length"))).toBe(true);
    expect(bad.some((e) => e.includes('listed twice'))).toBe(true);
  });
});

describe('a station on the clock', () => {
  const s = station('test', [100, 200, 150, 90, 240]);

  it('plays every track once a round, in an order that changes', () => {
    const orders = new Set<string>();
    for (let c = 0; c < 20; c++) {
      const order = playOrder(s, c);
      expect([...order].sort()).toEqual([0, 1, 2, 3, 4]);
      orders.add(order.join());
    }
    expect(orders.size).toBeGreaterThan(5);
  });

  it('never plays a track twice running across rounds', () => {
    for (let c = -3; c < 200; c++) {
      const before = playOrder(s, c);
      expect(playOrder(s, c + 1)[0]).not.toBe(before[before.length - 1]);
    }
  });

  it('is the same for everyone at the same time, and runs on in real time', () => {
    const t0 = 1_790_000_000;
    const a = nowPlaying(s, t0);
    expect(nowPlaying(s, t0)).toEqual(a);
    expect(a.offset).toBeGreaterThanOrEqual(0);
    expect(a.offset).toBeLessThan(a.track.seconds + GAP);
    if (a.left > 2) {
      const b = nowPlaying(s, t0 + 1);
      expect(b.index).toBe(a.index);
      expect(b.offset).toBeCloseTo(a.offset + 1, 6);
    }
    // The next track starts when this one's gap is over.
    const next = nowPlaying(s, t0 + a.left + 0.01);
    expect(next.index).not.toBe(a.index);
    expect(next.offset).toBeLessThan(0.05);
  });

  it('plays each track whole, a gap after it, and all of them equally often', () => {
    expect(cycleLength(s)).toBeCloseTo(100 + 200 + 150 + 90 + 240 + 5 * GAP, 6);
    let t = 5_000_000;
    t += nowPlaying(s, t).left + 1e-6;
    const plays = new Map<number, number>();
    let last = -1;
    for (let n = 0; n < 5 * 40; n++) {
      const np = nowPlaying(s, t);
      expect(np.offset).toBeLessThan(0.001);
      expect(np.left).toBeCloseTo(np.track.seconds + GAP, 3);
      expect(np.gap).toBe(false);
      expect(nowPlaying(s, t + np.track.seconds - 0.01).gap).toBe(false);
      expect(nowPlaying(s, t + np.track.seconds + 0.01).gap).toBe(true);
      expect(np.index).not.toBe(last);
      last = np.index;
      plays.set(np.index, (plays.get(np.index) ?? 0) + 1);
      t += np.left + 1e-6;
    }
    for (const i of s.tracks.keys()) expect(Math.abs((plays.get(i) ?? 0) - 40), `track ${i}`).toBeLessThanOrEqual(1);
  });

  it('gives different stations different places in their rounds', () => {
    const a = station('alpha', [100, 200, 150]);
    const b = station('beta', [100, 200, 150]);
    let differ = 0;
    for (let t = 0; t < 50; t++) if (nowPlaying(a, 1e9 + t * 97).track.file !== nowPlaying(b, 1e9 + t * 97).track.file || Math.abs(nowPlaying(a, 1e9 + t * 97).offset - nowPlaying(b, 1e9 + t * 97).offset) > 1) differ++;
    expect(differ).toBeGreaterThan(40);
  });

  it('drops tracks and stations whose files are missing', () => {
    const all = [station('one', [100, 100]), station('two', [100])];
    const left = onAir(all, (st, f) => st === 'one' && f === 't1.ogg');
    expect(left.map((o) => o.id)).toEqual(['one']);
    expect(left[0].tracks.map((t) => t.file)).toEqual(['t1.ogg']);
    expect(nowPlaying(left[0], 12345).track.file).toBe('t1.ogg');
  });
});
