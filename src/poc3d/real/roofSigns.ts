import { hash, rng } from '../../core/hash';
import { TRADE } from './shops';

/**
 * What a rooftop sign says (the big neon channel letters on taller buildings: signs.ts `rooftopBillboard`; the user,
 * 2026-10-16: "NEON" and "CABARET" repeat a lot, and a rooftop NEON makes no sense: they want more of those signs and more
 * variety, so each makes sense and they don't repeat). A rooftop sign is its building's: what is in it, named. By its
 * trade, a hotel, a love hotel, a pachinko parlour, a cabaret, a karaoke box, a game centre, a sauna, an electronics shop,
 * a mahjong parlour, an izakaya, a company's building; the ground-floor shop's own name when it has one that fits a roof
 * (the sign over the door and the one on the roof agree), else a name from the trade's pool. Invented, as every brand is
 * (CLAUDE.md): no chain, no real company.
 *
 * Not repeating: the map is cut into 80 m tiles in four classes (a tile's column and row parity, so the eight tiles round
 * it are of the other three) and each class draws from every fourth name of a pool, so the same sign is never within a
 * tile's width of itself, and rarely within two. A function of the building and its place alone, so no chunk order.
 */

export interface RoofSign {
  readonly text: string;
  /** The tube's colour. */
  readonly color: number;
}

const PINK = 0xff5fc8;
const CYAN = 0x4fe3ff;
const GOLD = 0xffe45f;
const GREEN = 0x6bff8a;
const RED = 0xff4f4f;
const VIOLET = 0xb48cff;
const WHITE = 0xe8f0ff;
const AMBER = 0xffb040;

interface Pool {
  /** Names, each with the prefix word of its trade (so the sign says what the building is). */
  readonly names: readonly string[];
  readonly colors: readonly number[];
}

const pool = (prefixes: readonly string[], names: readonly string[], colors: readonly number[]): Pool => ({
  names: prefixes.flatMap((p, i) => names.filter((_, j) => (i + j) % 2 === 0 || prefixes.length === 1).map((n) => (p.endsWith('/') ? p.slice(0, -1) + n : `${p} ${n}`))),
  colors,
});

const LATIN_NIGHT = ['STARLIGHT', 'COSMOS', 'ROYAL', 'ORION', 'NILE', 'ROUGE', 'PEARL', 'DIAMOND', 'VELVET', 'ECLIPSE', 'ZENITH', 'SIRIUS'];
const JP_NIGHT = ['麗', '紫苑', '華', '月影', '星空', '夢幻', '蘭', '白鳥', '銀扇', '朧', '艶', '雅'];

const POOLS: Record<string, Pool> = {
  lovehotel: pool(['HOTEL', 'ホテル'], ['VENUS', 'ECLIPSE', 'MERMAID', 'ORCHID', 'SIRIUS', 'AQUA', 'CHARME', 'EDEN', 'LUNA', 'PEARL', '花園', '夢の宿', '月光', '桜', '紫苑', '銀河'], [PINK, VIOLET, PINK, RED]),
  hotel: pool(['HOTEL', 'ホテル'], ['CENTRAL', 'ASAGIRI', 'TOTO', 'GRAND', 'BAYSIDE', 'ROYAL', 'PARK', '東都', '朝霧', '港', '白峰', '光和'], [WHITE, GOLD, CYAN]),
  night: pool(['CABARET', 'CLUB', 'LOUNGE'], LATIN_NIGHT, [PINK, VIOLET, CYAN, GOLD]),
  nightJp: pool(['キャバレー/', 'クラブ/', 'ラウンジ/'], JP_NIGHT, [PINK, VIOLET, RED, GOLD]),
  sauna: pool(['SAUNA', 'サウナ'], ['BLUE', 'ALOHA', 'ORION', 'NORDIC', '湯の花', '極楽', '月見', '白樺'], [CYAN, GREEN, WHITE]),
  karaoke: pool(['KARAOKE', 'カラオケ'], ['DO RE MI', 'MELODY', 'SONG BIRD', 'ENCORE', 'ドレミ', '歌の森', '熱唱', '音符', '十八番'], [GREEN, CYAN, PINK, GOLD]),
  pachinko: pool(['PACHINKO', 'パチンコ', 'パーラー'], ['GINGA', 'TAIYO', 'JUMBO', 'ROYAL', 'DIAMOND', '大吉', '銀河', '太陽', 'ニュー富士', '金龍', '万両'], [RED, GOLD, RED, PINK]),
  arcade: pool(['GAME', 'ゲーム'], ['PLANET', 'GALAXY', 'ZONE', 'JUMBO', 'WORLD', 'CENTER', 'ギャラクシー', 'プラネット', 'ジャンボ', 'ワールド'], [CYAN, VIOLET, GREEN, PINK]),
  electronics: pool(['電気', 'PC', 'AUDIO', 'ゲーム'], ['白峰', 'ミナト', 'カトウ', 'LAND', 'BIT', 'SQUARE', 'JUNK', '光電', '無線', 'ホビー'], [CYAN, WHITE, GOLD, RED]),
  mahjong: pool(['雀荘', '麻雀', 'MAHJONG'], ['東風', '満貫', '白', '一発', '役満', 'TOKYO', 'DRAGON', 'KING'], [GREEN, GOLD, RED]),
  izakaya: pool(['居酒屋', '酒場', 'BEER HALL'], ['千鳥', '浜っ子', '酒菜', '松の家', 'だるま', '大漁', 'TOKYO', 'BAYSIDE', 'ひょっとこ'], [AMBER, RED, GOLD]),
  company: pool(
    ['/'],
    ['朝霧生命', '朝霧信託銀行', '東都海上', '光和商事', '白峰電機', '曙重工', '環洋汽船', '北辰証券', 'ASAGIRI LIFE', 'KOWA TRUST', 'SHIRAMINE', 'TOTO MARINE', 'AKEBONO', 'KANYO LINES', 'HOKUSHIN', '東和不動産', '朝霧ビル', '光和ビル', '東都ビル', '港ビル'],
    [WHITE, WHITE, CYAN, GOLD],
  ),
};


/** Which pools a trade's building draws from (the first is its own; some trades have two forms, Latin and Japanese). */
const OF_TRADE: Readonly<Record<number, readonly string[]>> = {
  [TRADE.lovehotel]: ['lovehotel'],
  [TRADE.hotel]: ['hotel'],
  [TRADE.lounge]: ['night', 'nightJp'],
  [TRADE.bar]: ['night', 'nightJp'],
  [TRADE.snack]: ['nightJp', 'night'],
  [TRADE.karaoke]: ['karaoke'],
  [TRADE.pachinko]: ['pachinko'],
  [TRADE.arcade]: ['arcade'],
  [TRADE.electronics]: ['electronics'],
  [TRADE.hobby]: ['electronics', 'arcade'],
  [TRADE.mahjong]: ['mahjong'],
  [TRADE.izakaya]: ['izakaya'],
  [TRADE.noodles]: ['izakaya'],
  [TRADE.gym]: ['sauna'],
  [TRADE.maid]: ['nightJp'],
};
/** The trades whose own shop name goes on the roof (a short one: a sign over the door that reads from a street away). */
const OWN_NAME = new Set<number>([TRADE.lovehotel, TRADE.hotel, TRADE.lounge, TRADE.karaoke, TRADE.pachinko, TRADE.arcade, TRADE.electronics, TRADE.mahjong, TRADE.bar, TRADE.snack]);

/** The tile classes (0-3): its column's and row's parity, so the eight tiles round a tile are of the other three. */
export const roofClass = (x: number, z: number): number => (Math.floor(x / 80) & 1) + 2 * (Math.floor(z / 80) & 1);

/** The rooftop sign of a building: its trade, where it stands, its own shop's name (if it has one), its id (the dice). */
export function roofSign(id: number, x: number, z: number, trade: number, shopName: string | null): RoofSign {
  const rnd = rng(hash(id, 0x0f51));
  const cls = roofClass(x, z);
  // The trade's own pool (or one of its two); a building with no such trade is a company's or a landlord's.
  const P = rnd.pick(OF_TRADE[trade] ? OF_TRADE[trade].map((k) => POOLS[k]) : [POOLS.company]);
  const color = rnd.pick(P.colors);
  // The shop's own name, where it fits a roof: one that is short.
  if (shopName && OWN_NAME.has(trade) && [...shopName].length <= 11 && !/[0-9¥★]/.test(shopName) && rnd.chance(0.55)) return { text: shopName, color };
  // This tile's share of the pool: every fourth name.
  const mine = P.names.filter((_, i) => i % 4 === cls);
  const names = mine.length ? mine : P.names;
  return { text: rnd.pick(names), color };
}
