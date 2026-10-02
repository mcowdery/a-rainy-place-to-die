import { describe, expect, it } from 'vitest';
import { HOME_FLAG } from '../src/poc3d/real/buildings';
import { ROOMS, roomTables } from '../src/poc3d/real/shopAtlas';
import { HUES, hueOfColor, pickTrade, shopFlags, TRADE, TRADE_COUNT, TRADES, tradeOfWord } from '../src/poc3d/real/shops';
import { STYLES3 } from '../src/poc3d/district/plan';

describe('shop trades', () => {
  it('reads a trade from a sign, the particular words before the general', () => {
    expect(tradeOfWord('蕎麦')).toBe(TRADE.noodles);
    expect(tradeOfWord('立ち食いそば')).toBe(TRADE.noodles);
    expect(tradeOfWord('酒店')).toBe(TRADE.grocer);
    expect(tradeOfWord('酒')).toBe(TRADE.izakaya);
    expect(tradeOfWord('レトロゲーム')).toBe(TRADE.hobby);
    expect(tradeOfWord('GAME CENTER')).toBe(TRADE.arcade);
    expect(tradeOfWord('シャンパン')).toBe(TRADE.lounge);
    expect(tradeOfWord('BARBER')).toBe(TRADE.salon);
    expect(tradeOfWord('KSK BANK')).toBe(TRADE.bank);
    expect(tradeOfWord('メイドカフェ')).toBe(TRADE.maid);
    expect(tradeOfWord('ネットカフェ')).toBe(TRADE.books);
    expect(tradeOfWord('ヨルマート')).toBe(TRADE.konbini);
    expect(tradeOfWord('LIVE')).toBeNull();
  });

  it('names a trade for most of the districts\' sign words', () => {
    const words = [...new Set(Object.values(STYLES3).flatMap((s) => s!.signWords))];
    const named = words.filter((w) => tradeOfWord(w) !== null);
    expect(named.length / words.length).toBeGreaterThan(0.75);
  });

  it('keys a sign colour to the nearest hue', () => {
    expect(hueOfColor(0xff5fc8)).toBe(0);
    expect(hueOfColor(0xffffff)).toBe(6);
    expect(hueOfColor(0xff9a2a)).toBe(7);
  });

  it('makes a shop what its sign says, and fits it to the building', () => {
    const site = { id: 7, mood: 0, front: 8, tower: false };
    expect(pickTrade({ ...site, sign: { text: '蕎麦', color: 0xffffff } }).trade).toBe(TRADE.noodles);
    expect(pickTrade({ ...site, sign: { text: '蕎麦', color: 0xffffff } }).hue).toBe(6);
    // A plain HOTEL among love hotels is one.
    const love = { ...site, words: ['休憩', '宿泊', 'HOTEL'], sign: { text: 'HOTEL', color: 0xff5fc8 } };
    expect(pickTrade(love).trade).toBe(TRADE.lovehotel);
    // Narrow fronts never hold a convenience store; tower feet are mostly lobbies.
    let lobbies = 0;
    for (let id = 0; id < 400; id++) {
      const narrow = pickTrade({ id, mood: 1, front: 3.5, tower: false }).trade;
      expect(TRADES[narrow].minFront).toBeLessThanOrEqual(3.5);
      if (pickTrade({ id, mood: 1, front: 20, tower: true }).trade === TRADE.lobby) lobbies++;
    }
    expect(lobbies).toBeGreaterThan(150);
  });

  it('follows the zone: an unsigned shop in the electric town sells electronics or games', () => {
    const words = STYLES3.electric!.signWords;
    const counts = new Map<number, number>();
    for (let id = 0; id < 300; id++) {
      const t = pickTrade({ id, mood: 2, front: 6, tower: false, words }).trade;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const themed = (counts.get(TRADE.electronics) ?? 0) + (counts.get(TRADE.hobby) ?? 0) + (counts.get(TRADE.arcade) ?? 0) + (counts.get(TRADE.maid) ?? 0);
    expect(themed / 300).toBeGreaterThan(0.6);
  });

  it('packs trade and hue above the other flag bits', () => {
    const f = shopFlags(TRADE_COUNT - 1, HUES.length - 1) + 255 + HOME_FLAG;
    expect(Math.floor(f / 512) % 32).toBe(TRADE_COUNT - 1);
    expect(Math.floor(f / 16384) % 8).toBe(HUES.length - 1);
    expect(f).toBeLessThan(2 ** 24);
  });
});

describe('shop rooms', () => {
  it('has a room for every trade, its layers inside it, each layer region once', () => {
    for (let t = 0; t < TRADE_COUNT; t++) {
      const r = ROOMS[t];
      expect(r, `trade ${t}`).toBeDefined();
      expect(r.layers.length).toBeLessThanOrEqual(4);
      expect(new Set(r.layers.map((l) => l.region)).size).toBe(r.layers.length);
      for (const l of r.layers) {
        expect(l.depth).toBeGreaterThan(0);
        // Inside the shortest the room gets (its depth varies by 10% either way).
        expect(l.depth).toBeLessThan(r.depth * 0.9 - 0.1);
      }
    }
  });

  it('gives the shader its layers nearest first', () => {
    const { layers } = roomTables();
    expect(layers.length).toBe(TRADE_COUNT * 4);
    for (let t = 0; t < TRADE_COUNT; t++) {
      const used = layers.slice(t * 4, t * 4 + 4).map((l) => l[0]).filter((d) => d < 0);
      expect([...used].sort((a, b) => b - a)).toEqual(used);
    }
  });
});
