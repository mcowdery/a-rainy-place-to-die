import { describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { DISTRICTS3, STYLES3 } from '../src/poc3d/district/plan';
import { shopName, withShopNames } from '../src/poc3d/real/shopNames';
import { tradeOfWord } from '../src/poc3d/real/shops';

const content = loadDistrictContent();
const words = content.zones.words([...new Set(DISTRICTS3.flatMap((k) => STYLES3[k]!.signWords))]);

/** Chains and famous shops that must never be a shop's name (the game's brands are invented: CLAUDE.md). */
const REAL = ['カラオケ館', '王将', '大黒屋', '竹葉亭', '鳥貴族', '大勝軒', '喜楽', '一休', '魚民', 'ヤマダ', '石丸', 'Blue Note', 'Club Ai', 'クラブ 愛', 'マルハン', 'Sunroute'];

describe('shops’ own names', () => {
  it('keep the trade of their word, so every shop is what it was', () => {
    for (const w of words) for (let id = 0; id < 40; id++) expect(tradeOfWord(shopName(w, id)), `${w} -> ${shopName(w, id)}`).toBe(tradeOfWord(w));
  });

  it('are the same every time for a shop, and most shops have one', () => {
    let named = 0;
    let all = 0;
    for (const w of words) {
      for (let id = 0; id < 50; id++) {
        expect(shopName(w, id)).toBe(shopName(w, id));
        if (withShopNames([w]).length > 1) {
          all++;
          if (shopName(w, id) !== w) named++;
        }
      }
    }
    expect(named / all).toBeGreaterThan(0.7);
    expect(named / all).toBeLessThan(0.9);
  });

  it('are none of them a real chain or a famous shop', () => {
    for (const t of withShopNames(words)) for (const r of REAL) expect(t.includes(r) && !words.includes(t), `${t} has ${r}`).toBe(false);
  });

  it('are all in the list the sign atlas is made from', () => {
    const list = new Set(withShopNames(words));
    for (const w of words) for (let id = 0; id < 30; id++) expect(list.has(shopName(w, id))).toBe(true);
  });
});
