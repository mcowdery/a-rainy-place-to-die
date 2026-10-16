import { hash, rng } from '../../core/hash';
import { lin } from './meshBuilder';

/**
 * Storefront trades: what a ground-floor shop is, which decides what you see through its glass (city.ts draws
 * each trade's interior: shopShader.ts), its light (on the pavement too: props.ts), its glazing and its fascia.
 * A shop with a sign is what its sign says (蕎麦 is a noodle counter, BANK a banking hall); one without is
 * picked from its zone's mood (look.shops) and the trades its zone's sign words name, so an unsigned shop in
 * Denkō-chō still sells electronics and one on Host Street is a lounge. The building has its say: towers get
 * lobbies, a 3 m front never holds a supermarket-sized shop.
 *
 * Pure (no canvas, no GL): the chunk workers use it through buildings.ts.
 */

type C3 = [number, number, number];

export const TRADE = {
  general: 0, bar: 1, snack: 2, izakaya: 3, noodles: 4, cafe: 5, bakery: 6, grocer: 7,
  konbini: 8, drugstore: 9, fashion: 10, electronics: 11, arcade: 12, pachinko: 13, books: 14, lobby: 15,
  bank: 16, clinic: 17, salon: 18, laundry: 19, estate: 20, hobby: 21, maid: 22, warehouse: 23,
  craft: 24, mahjong: 25, karaoke: 26, gym: 27, lounge: 28, hotel: 29, lovehotel: 30, florist: 31,
} as const;
export type Trade = (typeof TRADE)[keyof typeof TRADE];
export const TRADE_COUNT = 32;
export const TRADE_NAMES = Object.keys(TRADE) as (keyof typeof TRADE)[];

/** The shop moods of zone files (look.shops), in the order of RealStyle.shopPal. */
export const MOODS = ['warm', 'cool', 'colourful', 'bar'] as const;

/** Glazing: 0 aluminium (dark or silver by the building), 1 wood, 2 frameless plate glass, 3 wooden lattice (kōshi). */
export const FRAME = { metal: 0, wood: 1, frameless: 2, lattice: 3 } as const;

export interface TradeDef {
  /** Light colour inside (also its spill on the pavement), and the spill's strength. */
  readonly light: C3;
  readonly spill: number;
  /** Weights by mood (warm, cool, colourful, bar) for shops without a sign of their own. */
  readonly moods: readonly [number, number, number, number];
  /** Narrowest shopfront (m) it fits in. */
  readonly minFront: number;
  /** Weight at the foot of a tower (45 m and up, or curtain-walled); 0 keeps it out. */
  readonly tower: number;
  /** Width of a glass panel between mullions (m), the frame (FRAME), a solid panel up to this height, frosted glass. */
  readonly glass: readonly [bay: number, frame: number, lower: number, frosted: number];
  /** Whether it may have a canvas awning. */
  readonly awning: boolean;
  /** Whether the interior is lit in the shop's own colour (the sign's), not just its light. */
  readonly hued: boolean;
}

const T = (light: C3, spill: number, moods: [number, number, number, number], minFront: number, tower: number, glass: [number, number, number, number], awning = false, hued = false): TradeDef =>
  ({ light, spill, moods, minFront, tower, glass, awning, hued });

const NEUTRAL: C3 = [1.0, 0.92, 0.8];

/** Per trade, in TRADE order. */
export const TRADES: readonly TradeDef[] = [
  /* general     */ T(NEUTRAL, 0.6, [2, 2, 0, 0], 2.5, 0, [1.6, FRAME.metal, 0.28, 0], true),
  /* bar         */ T([1.0, 0.5, 0.22], 0.3, [0, 0, 0, 4], 2.5, 0, [1.6, FRAME.metal, 0.6, 0]),
  /* snack       */ T([1.0, 0.42, 0.45], 0.25, [0, 0, 0, 3], 2.5, 0, [1.2, FRAME.wood, 0.9, 1], false, true),
  /* izakaya     */ T([1.0, 0.68, 0.38], 0.55, [3, 0, 0, 2], 2.5, 0, [0.9, FRAME.wood, 0.75, 0]),
  /* noodles     */ T([1.0, 0.86, 0.66], 0.6, [4, 0, 0, 0], 2.5, 0.3, [1.0, FRAME.wood, 0.5, 0]),
  /* cafe        */ T([1.0, 0.74, 0.46], 0.55, [3, 0, 1, 0], 3, 2, [2.2, FRAME.metal, 0.12, 0], true),
  /* bakery      */ T([1.0, 0.8, 0.55], 0.6, [2, 0, 0, 0], 3, 0.5, [1.8, FRAME.metal, 0.35, 0], true),
  /* grocer      */ T([1.0, 0.9, 0.72], 0.65, [2, 0, 0, 0], 3, 0, [2.4, FRAME.metal, 0.12, 0], true),
  /* konbini     */ T([0.94, 0.98, 1.0], 0.85, [0, 3, 1, 0], 6, 1, [2.6, FRAME.metal, 0.3, 0]),
  /* drugstore   */ T([0.96, 0.98, 1.0], 0.8, [0, 2, 1, 0], 4.5, 0.5, [2.4, FRAME.metal, 0.2, 0]),
  /* fashion     */ T([1.0, 0.93, 0.84], 0.6, [0, 1, 3, 0], 4, 1, [3.2, FRAME.frameless, 0.08, 0], false, true),
  /* electronics */ T([0.9, 0.96, 1.0], 0.8, [0, 1, 2, 0], 4, 0.5, [2.4, FRAME.metal, 0.12, 0]),
  /* arcade      */ T([0.75, 0.6, 1.0], 0.75, [0, 0, 2, 0], 5, 0, [3.0, FRAME.metal, 0.05, 0], false, true),
  /* pachinko    */ T([1.0, 0.88, 0.6], 0.8, [0, 0, 1, 0], 7, 0, [2.8, FRAME.metal, 0.3, 0]),
  /* books       */ T([1.0, 0.94, 0.82], 0.55, [1, 1, 0, 0], 3, 0.5, [2.0, FRAME.metal, 0.3, 0], true),
  /* lobby       */ T([1.0, 0.95, 0.86], 0.6, [0, 0, 0, 0], 6, 14, [3.0, FRAME.frameless, 0.05, 0], false, true),
  /* bank        */ T([0.95, 0.98, 1.0], 0.55, [0, 1, 0, 0], 6, 2, [2.4, FRAME.metal, 0.3, 1]),
  /* clinic      */ T([0.9, 0.98, 1.0], 0.45, [0, 2, 0, 0], 3.5, 0.3, [1.8, FRAME.metal, 0.3, 1]),
  /* salon       */ T([1.0, 0.92, 0.82], 0.55, [1, 1, 0, 0], 3, 0.2, [2.4, FRAME.frameless, 0.15, 0], true),
  /* laundry     */ T([0.9, 0.97, 1.0], 0.7, [0, 2, 0, 0], 3, 0, [2.0, FRAME.metal, 0.3, 0]),
  /* estate      */ T([0.95, 0.98, 1.0], 0.55, [0, 2, 0, 0], 3, 0.3, [1.8, FRAME.metal, 0.3, 0]),
  /* hobby       */ T([1.0, 0.9, 0.95], 0.7, [0, 0, 2, 0], 3, 0, [2.0, FRAME.metal, 0.2, 0], false, true),
  /* maid        */ T([1.0, 0.7, 0.85], 0.6, [0, 0, 1, 0], 3, 0, [1.6, FRAME.wood, 0.6, 1], false, true),
  /* warehouse   */ T([0.85, 0.92, 1.0], 0.5, [0, 0, 0, 0], 8, 0, [3.6, FRAME.metal, 0.4, 0]),
  /* craft       */ T([1.0, 0.76, 0.48], 0.5, [1, 0, 0, 0], 2.5, 0, [0.9, FRAME.lattice, 0.55, 0], true),
  /* mahjong     */ T([0.85, 1.0, 0.8], 0.35, [0, 0, 0, 1], 3.5, 0, [1.4, FRAME.metal, 0.9, 1]),
  /* karaoke     */ T([0.8, 0.55, 1.0], 0.7, [0, 0, 2, 1], 4, 0, [2.6, FRAME.frameless, 0.1, 0], false, true),
  /* gym         */ T([0.92, 0.97, 1.0], 0.65, [0, 1, 0, 0], 5, 1, [3.0, FRAME.frameless, 0.1, 0]),
  /* lounge      */ T([1.0, 0.62, 0.42], 0.4, [0, 0, 0, 1], 4, 0, [1.8, FRAME.frameless, 0.4, 0], false, true),
  /* hotel       */ T([1.0, 0.8, 0.56], 0.55, [0, 0, 0, 0], 5, 2, [2.6, FRAME.frameless, 0.1, 0]),
  /* lovehotel   */ T([1.0, 0.45, 0.7], 0.45, [0, 0, 0, 0], 4, 0, [1.8, FRAME.metal, 0.4, 1], false, true),
  /* florist     */ T([1.0, 0.95, 0.85], 0.6, [1, 0, 0, 0], 3, 0, [2.2, FRAME.metal, 0.12, 0], true),
];

/**
 * Sign words to trades: a sign naming any of these (as part of it) is that trade. Checked in order, so the
 * longer, more particular words come first (レトロゲーム before ゲーム, 酒店 before 酒, シャンパン before パン).
 * Words that name no trade (LIVE, ネオン, 公園...) leave the shop to its zone's mood.
 */
const WORDS: readonly (readonly [string, Trade])[] = [
  // Manilaya's signs (content/manila zones), first so they name their trades before the Japanese words can match inside them.
  ['SARI-SARI', TRADE.grocer], ['WATER REFILL', TRADE.grocer], ['FRESH BANGUS', TRADE.grocer], ['TIANGGE', TRADE.grocer], ['FISH PORT', TRADE.grocer],
  ['CARINDERIA', TRADE.noodles], ['KAINAN', TRADE.noodles], ['DIM SUM', TRADE.noodles], ['NOODLES', TRADE.noodles], ['LECHON', TRADE.izakaya],
  ['SISIG', TRADE.izakaya], ['RESTAURANT', TRADE.noodles], ['GRILL', TRADE.izakaya], ['BEER GARDEN', TRADE.bar], ['COCKTAILS', TRADE.bar],
  ['VIDEOKE', TRADE.karaoke], ['LIVE BAND', TRADE.lounge], ['GO-GO', TRADE.lounge], ['MILKTEA', TRADE.cafe], ['HOPIA', TRADE.bakery], ['PANDESAL', TRADE.bakery],
  ['BOTIKA', TRADE.drugstore], ['PHARMACY', TRADE.drugstore], ['HERBAL', TRADE.drugstore], ['7 DAYS', TRADE.konbini],
  ['CELLPHONE', TRADE.electronics], ['ELECTRONICS', TRADE.electronics], ['LOAD', TRADE.electronics], ['TOYS', TRADE.hobby], ['BARATILYO', TRADE.hobby],
  ['PAWN', TRADE.estate], ['FOR RENT', TRADE.estate], ['FOR SALE', TRADE.estate], ['COPY CENTER', TRADE.estate], ['PRINTING', TRADE.estate], ['TUTORIAL', TRADE.estate],
  ['VULCANIZING', TRADE.warehouse], ['WHOLESALE', TRADE.warehouse], ['WAREHOUSE', TRADE.warehouse], ['CONTAINER', TRADE.warehouse], ['BONDED', TRADE.warehouse],
  ['FABRIC', TRADE.craft], ['GOLD', TRADE.craft], ['JEWELRY', TRADE.craft], ['HERITAGE', TRADE.craft],
  ['CONDO', TRADE.lobby], ['DORM', TRADE.lobby], ['CHURCH', TRADE.lobby], ['MUSEUM', TRADE.lobby], ['PLAZA', TRADE.lobby], ['CUSTOMS', TRADE.lobby], ['STOCK EXCHANGE', TRADE.bank], ['INSURANCE', TRADE.lobby], ['CALL CENTER', TRADE.lobby],
  ['BARBERSHOP', TRADE.salon], ['LAUNDRY', TRADE.laundry], ['BOOKS', TRADE.books], ['SKY DECK', TRADE.lobby],
  ['レトロゲーム', TRADE.hobby], ['ゲームセンター', TRADE.arcade], ['GAME', TRADE.arcade], ['ゲーム', TRADE.arcade],
  ['メイド', TRADE.maid], ['おかえりなさいませ', TRADE.maid], ['萌え', TRADE.maid], ['耳かき', TRADE.maid],
  ['ネットカフェ', TRADE.books], ['漫画喫茶', TRADE.books], ['カプセル', TRADE.hotel],
  ['パチンコ', TRADE.pachinko], ['PACHINKO', TRADE.pachinko], ['スロット', TRADE.pachinko],
  ['カラオケ', TRADE.karaoke], ['KARAOKE', TRADE.karaoke], ['映画館', TRADE.karaoke], ['CINEMA', TRADE.karaoke],
  ['シャンパン', TRADE.lounge], ['ホストクラブ', TRADE.lounge], ['キャバクラ', TRADE.lounge], ['HOST', TRADE.lounge], ['LOUNGE', TRADE.lounge],
  ['指名', TRADE.lounge], ['姫', TRADE.lounge], ['王子', TRADE.lounge], ['初回', TRADE.lounge], ['クラブ', TRADE.lounge], ['CLUB', TRADE.lounge],
  ['CABARET', TRADE.lounge], ['DISCO', TRADE.lounge], ['ダンスホール', TRADE.lounge], ['DJ', TRADE.lounge], ['NIGHT', TRADE.lounge],
  ['BARBER', TRADE.salon], ['スナック', TRADE.snack], ['二次会', TRADE.snack],
  ['酒店', TRADE.grocer], ['酒屋', TRADE.grocer], ['BAR', TRADE.bar], ['バー', TRADE.bar],
  ['酒場', TRADE.izakaya], ['立ち飲み', TRADE.izakaya], ['居酒屋', TRADE.izakaya], ['焼鳥', TRADE.izakaya], ['焼き鳥', TRADE.izakaya],
  ['もつ焼', TRADE.izakaya], ['ホルモン', TRADE.izakaya], ['串焼', TRADE.izakaya], ['煮込み', TRADE.izakaya], ['もんじゃ', TRADE.izakaya],
  ['料亭', TRADE.izakaya], ['鰻', TRADE.izakaya], ['酒', TRADE.izakaya],
  ['餃子', TRADE.noodles], ['中華', TRADE.noodles], ['天ぷら', TRADE.noodles], ['寿司', TRADE.noodles], ['海鮮丼', TRADE.noodles],
  ['食堂', TRADE.noodles], ['定食', TRADE.noodles], ['牛丼', TRADE.noodles], ['カレー', TRADE.noodles], ['ラーメン', TRADE.noodles],
  ['蕎麦', TRADE.noodles], ['そば', TRADE.noodles], ['うどん', TRADE.noodles],
  ['甘味', TRADE.cafe], ['喫茶', TRADE.cafe], ['CAFE', TRADE.cafe], ['カフェ', TRADE.cafe], ['COFFEE', TRADE.cafe],
  ['レストラン', TRADE.cafe], ['FOOD COURT', TRADE.cafe],
  ['BAKERY', TRADE.bakery], ['パン', TRADE.bakery], ['ケーキ', TRADE.bakery],
  ['和菓子', TRADE.craft], ['団子', TRADE.craft], ['煎餅', TRADE.craft], ['人形焼', TRADE.craft], ['雷おこし', TRADE.craft], ['駄菓子', TRADE.craft],
  ['八百屋', TRADE.grocer], ['魚屋', TRADE.grocer], ['鮮魚', TRADE.grocer], ['肉屋', TRADE.grocer], ['精肉', TRADE.grocer],
  ['豆腐', TRADE.grocer], ['佃煮', TRADE.grocer], ['乾物', TRADE.grocer], ['鰹節', TRADE.grocer], ['仲卸', TRADE.grocer],
  ['惣菜', TRADE.grocer], ['コロッケ', TRADE.grocer], ['米', TRADE.grocer], ['牛乳', TRADE.grocer], ['氷', TRADE.grocer],
  ['水産', TRADE.grocer], ['市場', TRADE.grocer],
  ['花屋', TRADE.florist],
  ['ヨルマート', TRADE.konbini], ['コンビニ', TRADE.konbini], ['24H', TRADE.konbini], ['生協', TRADE.konbini], ['MART', TRADE.konbini],
  ['ドラッグ', TRADE.drugstore], ['薬', TRADE.drugstore],
  ['眼鏡', TRADE.fashion], ['メガネ', TRADE.fashion], ['SHOES', TRADE.fashion], ['百貨店', TRADE.fashion], ['スポーツ用品', TRADE.fashion],
  ['BOUTIQUE', TRADE.fashion], ['FASHION', TRADE.fashion],
  ['呉服', TRADE.craft], ['着物', TRADE.craft], ['刃物', TRADE.craft], ['仏具', TRADE.craft], ['数珠', TRADE.craft], ['土産', TRADE.craft],
  ['扇子', TRADE.craft], ['手拭', TRADE.craft], ['簪', TRADE.craft], ['和傘', TRADE.craft], ['提灯', TRADE.craft], ['下駄', TRADE.craft],
  ['骨董', TRADE.craft], ['質', TRADE.craft], ['船宿', TRADE.craft], ['屋形船', TRADE.craft], ['銭湯', TRADE.craft],
  ['家電', TRADE.electronics], ['カメラ', TRADE.electronics], ['電気', TRADE.electronics], ['免税', TRADE.electronics],
  ['DUTY FREE', TRADE.electronics], ['PC', TRADE.electronics], ['パーツ', TRADE.electronics], ['ケーブル', TRADE.electronics],
  ['真空管', TRADE.electronics], ['無線', TRADE.electronics], ['基板', TRADE.electronics], ['ネジ', TRADE.electronics],
  ['ラジオ', TRADE.electronics], ['修理', TRADE.electronics], ['電子部品', TRADE.electronics], ['ジャンク', TRADE.electronics],
  ['中古', TRADE.electronics], ['買取', TRADE.electronics], ['スマホ', TRADE.electronics], ['オーディオ', TRADE.electronics],
  ['アニメ', TRADE.hobby], ['フィギュア', TRADE.hobby], ['カード', TRADE.hobby], ['ホビー', TRADE.hobby], ['ガチャ', TRADE.hobby],
  ['コスプレ', TRADE.hobby], ['同人誌', TRADE.hobby], ['玩具', TRADE.hobby], ['GOODS', TRADE.hobby], ['グッズ', TRADE.hobby],
  ['書店', TRADE.books], ['本屋', TRADE.books], ['古本', TRADE.books], ['図書館', TRADE.books], ['文具', TRADE.books],
  ['レコード', TRADE.books], ['BOOK', TRADE.books],
  ['レジャーホテル', TRADE.lovehotel], ['休憩', TRADE.lovehotel], ['宿泊', TRADE.lovehotel], ['空室', TRADE.lovehotel], ['満室', TRADE.lovehotel],
  ['VENUS', TRADE.lovehotel], ['AQUA', TRADE.lovehotel],
  ['HOTEL', TRADE.hotel], ['ホテル', TRADE.hotel], ['ビジネス', TRADE.hotel], ['宿', TRADE.hotel],
  ['BANK', TRADE.bank], ['銀行', TRADE.bank], ['郵便局', TRADE.bank], ['証券', TRADE.bank], ['両替', TRADE.bank],
  ['チケット', TRADE.bank], ['TICKETS', TRADE.bank],
  ['案内所', TRADE.estate], ['不動産', TRADE.estate], ['探偵', TRADE.estate], ['金融', TRADE.estate], ['金貸し', TRADE.estate],
  ['ローン', TRADE.estate], ['学習塾', TRADE.estate], ['レンタカー', TRADE.estate], ['RENT A CAR', TRADE.estate], ['コピー', TRADE.estate],
  ['倉庫', TRADE.warehouse], ['物流', TRADE.warehouse], ['LOGISTICS', TRADE.warehouse], ['CARGO', TRADE.warehouse],
  ['航空貨物', TRADE.warehouse], ['港運', TRADE.warehouse], ['TRUCK', TRADE.warehouse], ['運送', TRADE.warehouse], ['STORAGE', TRADE.warehouse],
  ['保険', TRADE.lobby], ['OFFICE', TRADE.lobby], ['TOWER', TRADE.lobby], ['タワー', TRADE.lobby], ['RESIDENCE', TRADE.lobby],
  ['展望台', TRADE.lobby], ['学生会館', TRADE.lobby], ['研究棟', TRADE.lobby], ['講義棟', TRADE.lobby], ['国際会議場', TRADE.lobby],
  ['学部', TRADE.lobby], ['大学', TRADE.lobby], ['EVENT HALL', TRADE.lobby], ['展示場', TRADE.lobby], ['税関', TRADE.lobby],
  ['検疫', TRADE.lobby], ['空港', TRADE.lobby], ['SHIPPING', TRADE.lobby], ['海運', TRADE.lobby], ['港湾', TRADE.lobby],
  ['貸会議室', TRADE.lobby], ['館', TRADE.lobby], ['殿堂', TRADE.lobby],
  ['CLINIC', TRADE.clinic], ['クリニック', TRADE.clinic], ['歯科', TRADE.clinic], ['整骨院', TRADE.clinic], ['医院', TRADE.clinic],
  ['理容', TRADE.salon], ['美容', TRADE.salon], ['SALON', TRADE.salon],
  ['コインランドリー', TRADE.laundry], ['クリーニング', TRADE.laundry],
  ['GYM', TRADE.gym], ['ジム', TRADE.gym], ['FITNESS', TRADE.gym],
  ['麻雀', TRADE.mahjong], ['雀荘', TRADE.mahjong],
];

/** The trade a sign's text names, or null when it names none. */
export function tradeOfWord(text: string): Trade | null {
  const t = text.toUpperCase();
  for (const [w, trade] of WORDS) if (t.includes(w)) return trade;
  return null;
}

/**
 * A shop's own colour, as an index into HUES: its sign's colour where it has one (so the fascia, the brand band
 * and whatever is coloured inside match the sign), else picked from the district's sign colours.
 */
const HUE_KEYS = [0xff5fc8, 0x4fe3ff, 0xffe45f, 0x6bff8a, 0xff4f4f, 0xb48cff, 0xffffff, 0xff9a2a];
/** The shops' brand colours (linear), deeper than the neon they're keyed to; a white sign's brand is navy. */
export const HUES: readonly C3[] = [0xd8358f, 0x1597cc, 0xf0b814, 0x239a48, 0xc8242a, 0x6e44c4, 0x1d3f8a, 0xe86f14].map(lin);

export function hueOfColor(hex: number): number {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  let best = 0;
  let bd = Infinity;
  HUE_KEYS.forEach((k, i) => {
    const d = (((k >> 16) & 255) - r) ** 2 + (((k >> 8) & 255) - g) ** 2 + ((k & 255) - b) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

export interface ShopSite {
  /** Seeds the pick. */
  readonly id: number;
  /** The building's sign (text and colour), if it has one. */
  readonly sign?: { readonly text: string; readonly color: number };
  /** Its zone's (or district's) sign words and colours. */
  readonly words?: readonly string[];
  readonly colors?: readonly number[];
  /** Mood: RealStyle.shopPal. */
  readonly mood: number;
  /** Width of its shopfront (m). */
  readonly front: number;
  /** A tower's foot: 45 m and up, or curtain-walled. */
  readonly tower: boolean;
}

const zoneTrades = new Map<readonly string[], Map<Trade, number>>();

/** How many of a zone's sign words name each trade. */
function tradesOf(words: readonly string[]): Map<Trade, number> {
  let m = zoneTrades.get(words);
  if (m) return m;
  m = new Map();
  for (const w of words) {
    const t = tradeOfWord(w);
    if (t !== null) m.set(t, (m.get(t) ?? 0) + 1);
  }
  zoneTrades.set(words, m);
  return m;
}

/** A shop's trade and hue (deterministic in the site). */
export function pickTrade(site: ShopSite): { trade: Trade; hue: number } {
  const rnd = rng(hash(site.id, 0x7ade));
  const implied = site.words ? tradesOf(site.words) : new Map<Trade, number>();
  const hue = site.sign ? hueOfColor(site.sign.color) : site.colors?.length ? hueOfColor(rnd.pick(site.colors)) : rnd.int(0, HUES.length - 1);
  let trade = site.sign ? tradeOfWord(site.sign.text) : null;
  // In a quarter of love hotels, a plain HOTEL is one of them.
  if (trade === TRADE.hotel && implied.has(TRADE.lovehotel)) trade = TRADE.lovehotel;
  if (trade !== null && TRADES[trade].minFront <= site.front + 0.5) return { trade, hue };
  const mood = Math.max(0, Math.min(3, site.mood));
  const weights = TRADES.map((d, t) => {
    if (d.minFront > site.front) return 0;
    const moodW = d.moods[mood];
    let w = moodW + (implied.get(t as Trade) ?? 0) * (moodW > 0 ? 2.5 : 1);
    if (site.tower) w = w * 0.25 + d.tower;
    return w;
  });
  let total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return { trade: TRADE.general, hue };
  let r = rnd.float() * total;
  for (let t = 0; t < weights.length; t++) if ((r -= weights[t]) < 0) return { trade: t as Trade, hue };
  return { trade: TRADE.general, hue };
}

/** The flag bits a trade and hue take (buildings.ts flags; city.ts reads them). */
export const TRADE_BIT = 512;
export const HUE_BIT = 16384;
export const shopFlags = (trade: number, hue: number): number => trade * TRADE_BIT + hue * HUE_BIT;

/** A shop's light colour (its spill on the pavement): the trade's, tinted by its own colour where it's hued. */
export function shopLight(trade: number, hue: number): C3 {
  const d = TRADES[trade];
  if (!d.hued) return d.light;
  const h = HUES[hue];
  const m = Math.max(h[0], h[1], h[2], 1e-3);
  return [0, 1, 2].map((i) => d.light[i] * 0.6 + (h[i] / m) * 0.4) as C3;
}
