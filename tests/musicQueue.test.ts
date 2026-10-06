import { describe, expect, it } from 'vitest';
import { clockOf, LIKED, likedPlaylist, PlayQueue, playlistsOf, spanOf } from '../src/poc3d/district/musicQueue';
import { parseStations, type Station } from '../src/poc3d/district/radio';
import text from '../content/radio/stations.yaml?raw';
import durationsText from '../assets/radio/durations.json?raw';

const station = (id: string, n: number): Station => ({ id, name: id.toUpperCase(), jp: '', freq: '80.0', blurb: '', tracks: Array.from({ length: n }, (_, i) => ({ file: `t${i}.ogg`, title: `Track ${i}`, artist: 'Nobody', seconds: 100 + i })) });
const lists = playlistsOf([station('a', 5), station('b', 3)]);
const titles = (q: PlayQueue, n: number): string[] => Array.from({ length: n }, () => q.next(false)!.title);

describe("NAMI's library (district/musicQueue.ts)", () => {
  it('makes a playlist of every station, each song with an id of its own', () => {
    const errors: string[] = [];
    const stations = parseStations('stations.yaml', text, JSON.parse(durationsText) as Record<string, number>, errors);
    const all = playlistsOf(stations);
    expect(all.map((p) => p.id)).toEqual(stations.map((s) => s.id));
    const ids = all.flatMap((p) => p.songs.map((s) => s.id));
    expect(ids.length).toBeGreaterThan(20);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of all) for (const s of p.songs) expect(s.id).toBe(`${p.id}/${s.file}`);
  });

  it('lists the liked songs newest first, leaving out what is no longer there', () => {
    const liked = likedPlaylist(lists, ['a/t1.ogg', 'gone/x.ogg', 'b/t2.ogg']);
    expect(liked.id).toBe(LIKED);
    expect(liked.songs.map((s) => s.id)).toEqual(['b/t2.ogg', 'a/t1.ogg']);
  });

  it('writes times as a player does', () => {
    expect(clockOf(0)).toBe('0:00');
    expect(clockOf(65.9)).toBe('1:05');
    expect(spanOf(47 * 60)).toBe('47 min');
    expect(spanOf(72 * 60)).toBe('1 h 12 min');
  });
});

describe('the play queue', () => {
  it('plays a list in order from the song picked, and round again', () => {
    const q = new PlayQueue();
    q.start('a', lists[0].songs, 3, 1);
    expect(q.current?.title).toBe('Track 3');
    expect(titles(q, 3)).toEqual(['Track 4', 'Track 0', 'Track 1']);
    expect(q.prev()?.title).toBe('Track 0');
  });

  it('stops at the end of the list with no repeat, and plays one song again with repeat-one', () => {
    const q = new PlayQueue();
    q.repeat = 'off';
    q.start('b', lists[1].songs, 2, 1);
    expect(q.next(true)).toBeNull();
    expect(q.current?.title).toBe('Track 0');
    // (A skip of your own still goes round.)
    q.start('b', lists[1].songs, 2, 1);
    expect(q.next(false)?.title).toBe('Track 0');
    q.repeat = 'one';
    expect(q.next(true)?.title).toBe('Track 0');
    expect(q.next(false)?.title).toBe('Track 1');
    q.repeat = 'all';
    q.start('b', lists[1].songs, 2, 1);
    expect(q.next(true)?.title).toBe('Track 0');
  });

  it('shuffles the rest behind the song that is on, every song once a round', () => {
    const q = new PlayQueue();
    q.shuffle = true;
    q.start('a', lists[0].songs, 2, 12345);
    expect(q.current?.title).toBe('Track 2');
    const round = ['Track 2', ...titles(q, 4)];
    expect([...round].sort()).toEqual(['Track 0', 'Track 1', 'Track 2', 'Track 3', 'Track 4']);
    // Another deal is another order (some seed of a few gives one).
    const orders = new Set([1, 2, 3, 4, 5, 6].map((seed) => {
      const o = new PlayQueue();
      o.shuffle = true;
      o.start('a', lists[0].songs, 2, seed);
      return titles(o, 4).join();
    }));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('keeps the song that is on when shuffle is turned on or off', () => {
    const q = new PlayQueue();
    q.start('a', lists[0].songs, 1, 1);
    q.setShuffle(true, 99);
    expect(q.current?.title).toBe('Track 1');
    q.next(false);
    const on = q.current!.title;
    q.setShuffle(false, 99);
    expect(q.current?.title).toBe(on);
    const i = Number(on.slice(6));
    expect(q.next(false)?.title).toBe(`Track ${(i + 1) % 5}`);
  });

  it('says what is up next, and nothing past the end with no repeat', () => {
    const q = new PlayQueue();
    q.start('b', lists[1].songs, 1, 1);
    expect(q.upNext(3).map((s) => s.title)).toEqual(['Track 2', 'Track 0']);
    q.repeat = 'off';
    expect(q.upNext(3).map((s) => s.title)).toEqual(['Track 2']);
    expect(new PlayQueue().current).toBeNull();
    expect(new PlayQueue().next(false)).toBeNull();
  });
});
