/**
 * The words painted into the shop interiors (shopAtlas.ts): dish names on the menu strips, SALE cards, shelf
 * labels, posters, the front desk's sign. A city has its own table, passed to `new ShopAtlas(renderer, text)`
 * (main.ts picks it by `CityConfig.filipino`); Tōto's is the default. Keep the strings about as long as the ones
 * they replace: they're painted at a fixed size into fixed spaces. No real brands.
 */
export interface ShopText {
  /** The izakaya's menu strips (a dozen or so short dishes and drinks) and the noodle bar's menu (the price follows). */
  readonly izakayaDishes: readonly string[];
  readonly noodleDishes: readonly string[];
  /** A supermarket-style SALE band. */
  readonly sale: string;
  /** Names on the bottle-keep tags behind the bar. */
  readonly keepNames: readonly string[];
  /** The line on the bar's karaoke screen. */
  readonly song: string;
  /** Names on sake and spirit bottles. */
  readonly bottleLabels: readonly string[];
  /** Two posters in the izakaya. */
  readonly izakayaPoster1: readonly string[];
  readonly izakayaPoster2: readonly string[];
  /** The izakaya's vertical lantern (one of these). */
  readonly lantern: readonly string[];
  /** The noodle bar's poster, and its ticket machine's label. */
  readonly noodlePoster: readonly string[];
  readonly ticket: string;
  /** The café's menu board (the first line is its title). */
  readonly cafeMenu: readonly string[];
  readonly bakery: string;
  readonly grocer: string;
  readonly coldDrinks: string;
  readonly drugstore: string;
  /** A red price flash on a shelf edge, and the discount store's band and its tags. */
  readonly bargain: string;
  readonly discountBand: string;
  readonly discountTag: string;
  /** The pachinko hall's two posters and the arcade's prize flags. */
  readonly pachinkoPoster1: readonly string[];
  readonly pachinkoPoster2: readonly string[];
  readonly arcadeFlags: readonly string[];
  /** The bookshop's three section signs and its red shelf card. */
  readonly bookSections: readonly [string, string, string];
  readonly bookCard: string;
  /** The clinic's and the hotel's desks, and the hall's reception sign. */
  readonly reception: string;
  readonly frontDesk: string;
  readonly desk: string;
  readonly realtor: string;
  /** The hobby shop's tags. */
  readonly hobbyTags: readonly string[];
  /** The maid café's greeting. */
  readonly maid: string;
  /** The yakitori-style grill's cards. */
  readonly grillCards: readonly string[];
  /** The mahjong parlour's and the karaoke box's posters and sign. */
  readonly mahjongPoster1: readonly string[];
  readonly mahjongPoster2: readonly string[];
  readonly karaokePoster1: readonly string[];
  readonly karaokePoster2: readonly string[];
  readonly karaokeSign: string;
  /** Host club names. */
  readonly hostNames: readonly string[];
  readonly shortStay: string;
  readonly flowers: string;
  /** The loan office (shady rooms). */
  readonly loanTitle: string;
  readonly loanSmall: string;
  readonly loanDay: string;
  readonly vacant: string;
  readonly prizeExchange: string;
}

export const TOTO_TEXT: ShopText = {
  izakayaDishes: ['焼鳥', '枝豆', '冷奴', '刺身', '唐揚', '生ビール', '日本酒', '焼酎', 'おでん', '漬物', '串カツ', '冷酒', 'ホッピー', '煮込み', '塩辛', 'もつ焼'],
  noodleDishes: ['醤油', '味噌', '塩', 'つけ麺', '餃子', 'チャーシュー', '大盛', 'ライス'],
  sale: 'SALE  お買い得  SALE',
  keepNames: ['ひろし', 'ケン', '田中', '社長', 'まさ', '佐藤', 'ゆう'],
  song: '♪ 恋の 東都ブルース',
  bottleLabels: ['獺', '久保', '八海', '菊', '鶴', '月'],
  izakayaPoster1: ['生ビール', 'サワー', '冷酒'],
  izakayaPoster2: ['ハイボール', '焼酎'],
  lantern: ['酒', '焼鳥', '居酒屋'],
  noodlePoster: ['大盛無料', '替玉 100', '本日のおすすめ'],
  ticket: '食券',
  cafeMenu: ['COFFEE', 'ブレンド 450', 'カフェラテ 520', 'ケーキセット 800', 'ホットサンド 680'],
  bakery: 'BOULANGERIE  焼きたて',
  grocer: '新鮮  産地直送  毎日安い',
  coldDrinks: 'COLD DRINKS  つめたい',
  drugstore: 'くすり  化粧品  日用品',
  bargain: '激安!',
  discountBand: '大特価 SALE ポイント10%',
  discountTag: '特価',
  pachinkoPoster1: ['NEW', '新台'],
  pachinkoPoster2: ['PRIZE', '景品'],
  arcadeFlags: ['GET!', 'UFO', 'PRIZE', '100円'],
  bookSections: ['文庫', '新刊', 'コミック'],
  bookCard: '話題の本',
  reception: 'RECEPTION  受付',
  frontDesk: 'FRONT  フロント',
  desk: '受付',
  realtor: '不動産  賃貸・売買',
  hobbyTags: ['新作', '予約受付中', 'NEW!', '限定'],
  maid: 'おかえりなさいませ ♡',
  grillCards: ['名物', '手焼', '本日'],
  mahjongPoster1: ['東風戦', '禁煙席'],
  mahjongPoster2: ['点5', '割引'],
  karaokePoster1: ['30分 ¥100', 'フリータイム'],
  karaokePoster2: ['学割', '飲み放題'],
  karaokeSign: 'KARAOKE  カラオケ',
  hostNames: ['蓮', '輝', '翔', '零', '皇', '凛', '聖', '煌'],
  shortStay: 'ご休憩 ¥4,980〜',
  flowers: 'FLOWER  花',
  loanTitle: '即日融資',
  loanSmall: 'ご利用は計画的に',
  loanDay: '毎週月曜日',
  vacant: '空室',
  prizeExchange: '景品交換所',
};

/** Manila's: English and Tagalog (a carinderia's dishes, BOTIKA, MURA, LOAD...). */
export const MANILA_TEXT: ShopText = {
  izakayaDishes: ['ADOBO', 'SINIGANG', 'PANCIT', 'LECHON KAWALI', 'SISIG', 'KARE-KARE', 'TINOLA', 'LAING', 'DINUGUAN', 'TOKWA', 'BANGUS', 'KILAWIN', 'BEER', 'TUBA', 'LUGAW', 'TAPSILOG'],
  noodleDishes: ['PANCIT', 'MAMI', 'LOMI', 'BATCHOY', 'SIOMAI', 'LUGAW', 'KANIN', 'EXTRA'],
  sale: 'SALE  MURA  SALE',
  keepNames: ['Boy', 'Ben', 'Dado', 'Boss', 'Mang Tony', 'Jun', 'Ate Lyn'],
  song: '♪ Ulan sa Maynila',
  bottleLabels: ['TUBA', 'GIN', 'RUM', 'BASI', 'LAMBANOG', 'TAPUY'],
  izakayaPoster1: ['BEER', 'COLD', 'MURA'],
  izakayaPoster2: ['GIN TONIC', 'RUM'],
  lantern: ['BAR', 'INASAL', 'KAINAN'],
  noodlePoster: ['EXTRA RICE', 'LUGAW 30', 'ULAM NGAYON'],
  ticket: 'KUPON',
  cafeMenu: ['KAPE', 'Brewed 45', 'Latte 60', 'Cake Set 95', 'Toasted Sandwich 70'],
  bakery: 'PANADERIA  MAINIT PA',
  grocer: 'FRESH  GALING PROBINSYA  MURA',
  coldDrinks: 'COLD DRINKS  MALAMIG',
  drugstore: 'BOTIKA  GAMOT  KALUSUGAN',
  bargain: 'MURA!',
  discountBand: 'SALE  BIG SAVINGS  10% OFF',
  discountTag: 'SALE',
  pachinkoPoster1: ['NEW', 'BAGO'],
  pachinkoPoster2: ['PRIZE', 'PREMYO'],
  arcadeFlags: ['GET!', 'UFO', 'PRIZE', 'P10'],
  bookSections: ['LIBRO', 'BAGO', 'KOMIKS'],
  bookCard: 'BEST SELLER',
  reception: 'RECEPTION  FRONT DESK',
  frontDesk: 'FRONT DESK',
  desk: 'FRONT DESK',
  realtor: 'PROPERTY  UPA  BENTA',
  hobbyTags: ['BAGO', 'PRE-ORDER', 'NEW!', 'LIMITED'],
  maid: 'Welcome po! ♡',
  grillCards: ['SPECIAL', 'MAINIT', 'TODAY'],
  mahjongPoster1: ['MAHJONG', 'NO SMOKING'],
  mahjongPoster2: ['5 PESOS', 'DISKUWENTO'],
  karaokePoster1: ['30 MIN P100', 'OPEN TIME'],
  karaokePoster2: ['STUDENT', 'UNLI DRINKS'],
  karaokeSign: 'VIDEOKE  KARAOKE',
  hostNames: ['RAY', 'JAY', 'KEN', 'ZED', 'BOY', 'RIO', 'LEO', 'ACE'],
  shortStay: 'SHORT TIME P980',
  flowers: 'FLOWERS  BULAKLAK',
  loanTitle: 'LOAN AGAD',
  loanSmall: 'UTANG NANG MATALINO',
  loanDay: 'BAYAD TUWING LUNES',
  vacant: 'VACANT',
  prizeExchange: 'PRIZE EXCHANGE',
};
