import { hash, u01 } from '../../core/hash';
import { tradeOfWord } from './shops';

/**
 * Shops' own names (the user, 2026-10-15, phase 3 of the sign proposal: "more types and variations"): a shop's sign
 * says what it is and who, スナック 由美, 喫茶 白鳥, 焼鳥 鳥よし, 光和銀行, rather than the bare word of its trade.
 * Invented, like every brand in the game (CLAUDE.md): nothing here is a chain or a famous shop (カラオケ館, 王将, 大黒屋,
 * 竹葉亭, Club Ai and the like are left out on purpose; family names and the common names of small places are fine).
 *
 * Each entry names the shops whose sign word holds `match`: `pattern` with `{}` for the name. A name always keeps the
 * word of its trade, so the shop is still what its sign says (shops.ts `tradeOfWord`): one that would read as another
 * trade is dropped from its list when the table is read (`NAMES`). Checked in order, the particular before the general
 * (回転寿司 before 寿司, レトロゲーム, which keeps its word, before ゲーム). A fifth of shops keep the bare word, as some
 * signs do (just 焼鳥, just 麻雀).
 */
const TABLE: readonly (readonly [match: string, pattern: string, names: readonly string[]])[] = [
  // Night
  ['スナック', 'スナック {}', ['由美', '和子', '恵', '蘭', '夕子', '明美', '紫', '千草', 'ルージュ', 'かおり']],
  ['二次会', 'スナック {}', ['由美', '和子', '恵', '蘭', '夕子', '明美']],
  ['バー', 'バー {}', ['月光', '黒猫', '灯', '夜想', '港']],
  ['BAR', 'BAR {}', ['Lune', 'Noir', 'Mistral', 'Velvet', 'Orchid', 'Sirius', 'Calvados', 'Nocturne']],
  ['ラウンジ', 'ラウンジ {}', ['麗', '紫苑', '華', '雅', '月影']],
  ['ホストクラブ', 'ホストクラブ {}', ['夢幻', '皇帝', '星華']],
  ['HOST', 'HOST {}', ['Apollo', 'Zero', 'Eden', 'Orion']],
  ['キャバクラ', 'キャバクラ {}', ['姫', '蝶', '華恋']],
  ['クラブ', 'クラブ {}', ['麗', '紫', '華', '月影', '銀扇']],
  ['CLUB', 'CLUB {}', ['Rouge', 'Nile', 'Pearl', 'Diamond', 'Orion']],
  ['CABARET', 'CABARET {}', ['Starlight', 'Cosmos', 'Ginga']],
  ['雀荘', '雀荘 {}', ['東風', '白', '一発', '満貫']],
  ['麻雀', '麻雀 {}', ['東風', '白', '一発', '満貫', '中']],
  ['カラオケ', 'カラオケ {}', ['ドレミ', '歌の森', '熱唱', '音符']],
  ['KARAOKE', 'KARAOKE {}', ['Do Re Mi', 'Melody']],
  ['レトロゲーム', 'レトロゲーム', []],
  ['GAME', 'GAME {}', ['Planet', 'Galaxy', 'Zone']],
  ['ゲーム', 'ゲーム {}', ['ギャラクシー', 'ジャンボ', 'プラネット']],
  ['パチンコ', 'パチンコ {}', ['大吉', '銀河', '太陽', 'ダイヤ', 'ニュー富士']],
  ['PACHINKO', 'PACHINKO {}', ['Ginga', 'Taiyo']],
  ['レジャーホテル', 'レジャーホテル {}', ['花園', '夢']],
  ['HOTEL', 'HOTEL {}', ['Central', 'Sirius', 'Eden', 'Charme', 'Mermaid']],
  ['ビジネス', 'ビジネスホテル {}', ['東都', '朝霧', '港']],
  ['ホテル', 'ホテル {}', ['花園', '桜', '東都', '朝霧', '港']],
  // Eating and drinking
  ['居酒屋', '居酒屋 {}', ['千鳥', '浜っ子', '酒菜', '竹', '松の家', 'だるま', 'ひょっとこ']],
  ['焼き鳥', '焼き鳥 {}', ['鳥よし', '鳥正', '鳥八', '文吉']],
  ['焼鳥', '焼鳥 {}', ['鳥よし', '鳥正', '鳥八', '文吉']],
  ['もつ焼', 'もつ焼 {}', ['のんき', '大番', 'とん平']],
  ['立ち飲み', '立ち飲み {}', ['角', '一番']],
  ['酒場', '大衆酒場 {}', ['千代', '富士']],
  ['ラーメン', 'ラーメン {}', ['北斗', '月見', '丸八', '龍王']],
  ['中華', '中華 {}', ['萬福', '栄華', '桃園']],
  ['餃子', '餃子 {}', ['満月', '百番']],
  ['蕎麦', '蕎麦 {}', ['松月庵', '藪仙', '更科屋']],
  ['うどん', 'うどん {}', ['讃岐屋', 'かめや']],
  ['定食', '定食 {}', ['ことぶき', 'あおば']],
  ['食堂', '{}食堂', ['あおば', '港', '富士']],
  ['回転寿司', '回転寿司 {}', ['宝', '魚がし']],
  ['寿司', '寿司 {}', ['勘六', '宝', '魚がし']],
  ['天ぷら', '天ぷら {}', ['天政', '天吉']],
  ['鰻', '鰻 {}', ['川松', 'うな善']],
  ['甘味', '甘味処 {}', ['みつ', '若竹']],
  ['喫茶', '喫茶 {}', ['ルナ', '白鳥', '琥珀', '銀河', '青い鳥', '時計台', '灯台', 'ミモザ']],
  ['CAFE', 'CAFE {}', ['Lumiere', 'Moka', 'Blue Bird', 'Jardin']],
  ['COFFEE', 'COFFEE {}', ['Bean', 'Aroma']],
  ['ケーキ', 'ケーキ {}', ['ミモザ', 'ことり']],
  ['パン', 'パン {}', ['ことり', '麦の穂']],
  // Daily
  ['銀行', '{}銀行', ['朝霧', '光和', '白峰', '東都']],
  ['BANK', '{} BANK', ['ASAGIRI', 'KOWA', 'SHIRAMINE']],
  ['証券', '{}証券', ['北辰', '光和']],
  ['保険', '{}生命保険', ['朝霧', '東都']],
  ['クリニック', '{}クリニック', ['中村', 'さくら', '朝霧']],
  ['CLINIC', '{} CLINIC', ['NAKAMURA', 'SAKURA']],
  ['歯科', '{}歯科', ['佐藤', '高橋', 'さくら', 'ひまわり']],
  ['医院', '{}医院', ['高橋', '山口']],
  ['整骨院', '{}整骨院', ['鈴木', 'みどり']],
  ['理容', '理容 {}', ['タナカ', 'ヤマモト']],
  ['美容', '美容室 {}', ['ルミ', 'アン', '花']],
  ['クリーニング', '{}クリーニング', ['白鳥', '東都', 'ホワイト']],
  ['コインランドリー', 'コインランドリー {}', ['ママ', '白鳥']],
  ['不動産', '{}不動産', ['朝霧', '光和', '東和']],
  ['金融', '{}金融', ['ことぶき', '日の出', '富士']],
  ['探偵', '{}探偵社', ['東都', '朝霧']],
  ['酒店', '{}酒店', ['山本', '丸八', '松本']],
  ['鮮魚', '鮮魚 {}', ['魚辰', '魚清']],
  ['豆腐', '{}豆腐店', ['小林', '中村']],
  ['精肉', '{}精肉店', ['石井', '肉の山田']],
  ['ドラッグ', 'ドラッグ {}', ['光和', 'ひかり']],
  ['薬', '{}薬局', ['朝霧', 'ヤマモト', 'ひかり']],
  ['書店', '{}書店', ['文華堂', '朝霧', '青柳']],
  ['古本', '古本 {}', ['青柳', '鶴屋']],
  // Denkō-chō
  ['家電', '家電の{}', ['ミナト', '白峰']],
  ['電気', '{}電気', ['白峰', 'ミナト', 'カトウ']],
  ['カメラ', '{}カメラ', ['朝霧', 'ミナト']],
  ['免税', '{}免税店', ['光電', '東都']],
  ['PC', 'PC {}', ['Land', 'Bit', 'Square']],
  ['アニメ', 'アニメ {}', ['星屋', 'ポップ']],
  ['フィギュア', 'フィギュア {}', ['天狗堂']],
  ['ホビー', 'ホビー {}', ['天狗堂', 'ミナト']],
  ['カード', 'カード {}', ['キング', 'エース']],
  // The old town
  ['煎餅', '{}煎餅', ['菊屋', '松風']],
  ['団子', '団子 {}', ['竹', '花月']],
  ['呉服', '呉服 {}', ['丸八', 'よしの']],
  ['骨董', '骨董 {}', ['青山', '古賀']],
  ['質', '質 {}', ['丸八', '松葉']],
  ['銭湯', '銭湯 {}湯', ['松の', '梅の', '富士見']],
  ['佃煮', '{}佃煮', ['丸久']],
];

/** The table, each list cut to the names that keep their word's trade. */
const NAMES: readonly (readonly [string, readonly string[]])[] = TABLE.map(([match, pattern, names]) => {
  const trade = tradeOfWord(match);
  return [match, names.map((n) => pattern.replace('{}', n)).filter((t) => tradeOfWord(t) === trade)] as const;
});

/** A word's names: its entry's, those that keep the word's own trade (シャンパン holds パン, but isn't a bakery). */
const byWord = new Map<string, readonly string[]>();
function entryOf(word: string): readonly string[] {
  let names = byWord.get(word);
  if (!names) {
    const trade = tradeOfWord(word);
    names = (NAMES.find(([m]) => word.includes(m))?.[1] ?? []).filter((t) => tradeOfWord(t) === trade);
    byWord.set(word, names);
  }
  return names;
}

/** The share of shops that keep the bare word of their trade. */
const BARE = 0.2;

/** A shop's sign in 1992: its own name for its word (the same every time for the same seed), or the word as it is. */
export function shopName(word: string, seed: number): string {
  const names = entryOf(word);
  if (!names.length || u01(hash(seed, 0x5a3e)) < BARE) return word;
  return names[Math.floor(u01(hash(seed, 0x5a3f)) * names.length)];
}

/** Every text a sign with one of these words can say (the words and all their shops' names), for the sign atlas. */
export function withShopNames(words: readonly string[]): string[] {
  return [...new Set(words.flatMap((w) => [w, ...entryOf(w)]))];
}
