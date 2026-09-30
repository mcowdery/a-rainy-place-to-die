import type { TaxiAd } from './vehicles';
import { DEMO_HIDDEN_ART } from '../../edition/demoArt';

/**
 * Taxi ad catalogue (all brands invented; some double as story hooks). `art` names the photo crops in
 * assets/ads/ (NN_name_roof.jpg / NN_name_door.jpg, made by scripts/crop_ads.py from the VN generator's
 * portraits); the copy is composited next to the photo at runtime (real/adAtlas.ts), so it can change
 * without regenerating art.
 */
export interface AdDef extends TaxiAd {
  readonly name: string;
  readonly art: string;
}

export const TAXI_ADS: readonly AdDef[] = [
  { name: 'A · energy drink', art: '01_yakou_drink', roof: '夜光 YAKOU DRINK', side: '今夜も、光れ。', wrap: 0x14143a, plate: 0x14143a, ink: 0x6af0ff },
  { name: 'B · detective agency (hook)', art: '02_kirishima_investigations', roof: '霧島探偵事務所', side: 'KIRISHIMA INVESTIGATIONS', wrap: 0x1f3a2a, plate: 0xf2f0e8, ink: 0x1f3a2a },
  { name: 'C · missing person (hook)', art: '03_missing_person', roof: '探しています MISSING', side: '見かけた方は ☎ 0120-41-4545', wrap: 0xe8c020, plate: 0xe8c020, ink: 0x121212 },
  { name: 'D · record shop', art: '04_sunrise_records', roof: 'SUNRISE RECORDS', side: 'CITY POP 再発盤 入荷', wrap: 0xd8406a, plate: 0xfff0e0, ink: 0xd8406a },
  { name: 'E · life insurance', art: '05_mirai_life', roof: 'ミライ生命 MIRAI LIFE', side: 'あなたの未来に。', wrap: 0x1c4a9a, plate: 0xf2f0e8, ink: 0x1c4a9a },
  { name: 'F · love hotel', art: '06_hotel_paradise', roof: 'ホテル パラダイス', side: '休憩 ¥3,000〜 宿泊 ¥6,800〜', wrap: 0xe070b8, plate: 0x1a0a14, ink: 0xff8ad8 },
  { name: 'G · Bar Kanpai', art: '07_bar_kanpai', roof: 'BAR KANPAI カンパイ', side: '歌舞路 2-7 深夜まで', wrap: 0x121212, plate: 0x121212, ink: 0xffd84a },
  { name: 'H · credit union', art: '08_kabura_credit_union', roof: '歌舞路信用金庫', side: '夢を、貯めよう。', wrap: 0xe07818, plate: 0xf2f0e8, ink: 0xe07818 },
];

/**
 * District ads (Kaburo): approved art in assets/ads/source/, cropped by scripts/crop_district_ads.py into
 * assets/ads/kaburo/. Billboards (2:1) go on rooftops and facades, posters (2:3, photo over a brand band)
 * on shopfronts at street level. `text` says where a billboard's copy goes so it avoids the subject.
 */
export interface DistrictAd {
  readonly art: string;
  readonly format: 'billboard' | 'poster';
  readonly brand: string;
  readonly copy: string;
  /** Accent colour: billboard brand text / poster band. */
  readonly accent: number;
  /** Text colour on the poster band / billboard text panel. */
  readonly ink: number;
  readonly text?: 'left' | 'right' | 'bottom';
  /** What it advertises: zones pick their ads by category (content/world3d/zones/*.yaml). */
  readonly cat: AdCategory;
}

export const AD_CATEGORIES = ['mainstream', 'gaming', 'fun', 'food', 'host', 'hostess', 'adult', 'lovehotel', 'loan', 'street', 'lodging'] as const;
export type AdCategory = (typeof AD_CATEGORIES)[number];

/** Every district ad, in every edition's art. */
export const ALL_DISTRICT_ADS: readonly DistrictAd[] = [
  { art: '10_club_adonis_hosts', format: 'billboard', cat: 'host', brand: 'CLUB ADONIS', copy: 'No.1 ホスト 今夜も君を待つ', accent: 0xe8c060, ink: 0xffffff, text: 'bottom' },
  { art: '12_hotel_rouge_julie', format: 'billboard', cat: 'lovehotel', brand: 'HOTEL ROUGE ホテル ルージュ', copy: '休憩 ¥3,800〜 / 宿泊 ¥7,500〜', accent: 0xff5070, ink: 0xffffff, text: 'left' },
  { art: '13_hotel_rouge', format: 'billboard', cat: 'lovehotel', brand: 'HOTEL ROUGE', copy: '休憩 ¥3,800〜 / 宿泊 ¥7,500〜', accent: 0xff5070, ink: 0xffffff, text: 'right' },
  { art: '14_hotel_venus', format: 'billboard', cat: 'lovehotel', brand: 'HOTEL VENUS', copy: 'ご休憩 60分 ¥2,900', accent: 0x3a0a2c, ink: 0xffd0f0 },
  { art: '17_parlor_ginga', format: 'billboard', cat: 'gaming', brand: 'パーラー銀河', copy: '新台入替! 朝10時オープン', accent: 0xffd040, ink: 0xffffff, text: 'left' },
  { art: '19_yakou_drink_billboard', format: 'billboard', cat: 'mainstream', brand: '夜光 YAKOU', copy: '今夜も、光れ。', accent: 0xff4040, ink: 0xffffff, text: 'bottom' },
  { art: '21_club_moonlight', format: 'billboard', cat: 'hostess', brand: 'CLUB MOONLIGHT', copy: '朝まで、あなたの隣に。', accent: 0xa8c8ff, ink: 0xffffff, text: 'left' },
  { art: '09_annaijo_girls', format: 'poster', cat: 'adult', brand: '無料案内所', copy: 'かわいい子、ご案内します', accent: 0xffd400, ink: 0x141414 },
  { art: '11_hikari_loan', format: 'poster', cat: 'loan', brand: 'ヒカリ ローン', copy: '即日融資 審査かんたん!', accent: 0xd01818, ink: 0xffffff },
  { art: '15_karaoke_dream', format: 'poster', cat: 'fun', brand: 'カラオケ DREAM', copy: '全室 朝まで ¥1,500', accent: 0xd83090, ink: 0xffffff },
  { art: '16_kirishima_poster', format: 'poster', cat: 'street', brand: '霧島探偵事務所', copy: '人探し・浮気調査・秘密厳守', accent: 0x101418, ink: 0xe8d8a0 },
  { art: '18_tsukuyomi_fortune', format: 'poster', cat: 'street', brand: '占いの館 月詠', copy: 'あなたの運命、視えます。', accent: 0x2a1440, ink: 0xd8b8ff },
  { art: '20_yonaki_ramen', format: 'poster', cat: 'food', brand: 'ラーメン 夜鳴き', copy: '深夜3時まで', accent: 0x201008, ink: 0xffc070 },
  { art: '22_hotel_venus_poster', format: 'poster', cat: 'lovehotel', brand: 'HOTEL VENUS', copy: 'ご休憩 60分 ¥2,900 空室あり', accent: 0xe070b8, ink: 0xffffff },
  // Round 2.
  { art: '23_gabunomi_izakaya', format: 'poster', cat: 'food', brand: '居酒屋 がぶ飲み屋', copy: '生ビール 一杯 ¥190', accent: 0xe8a020, ink: 0x201008 },
  { art: '31_gabunomi_izakaya', format: 'poster', cat: 'food', brand: '居酒屋 がぶ飲み屋', copy: '生ビール 一杯 ¥190', accent: 0xe8a020, ink: 0x201008 },
  { art: '36_gabunomi_izakaya', format: 'poster', cat: 'food', brand: '居酒屋 がぶ飲み屋', copy: '生ビール 一杯 ¥190', accent: 0xe8a020, ink: 0x201008 },
  { art: '24_cash_one_poster', format: 'poster', cat: 'loan', brand: 'キャッシュ・ワン', copy: 'ブラックOK 即日', accent: 0x0a3a8a, ink: 0xffe040 },
  { art: '25_julie_album', format: 'poster', cat: 'mainstream', brand: 'JULIE『MIDNIGHT PLASTIC』', copy: 'NEW ALBUM 11.11 ON SALE', accent: 0xf0a0c8, ink: 0x2a1040 },
  { art: '26_julie_album', format: 'poster', cat: 'mainstream', brand: 'JULIE『MIDNIGHT PLASTIC』', copy: 'NEW ALBUM 11.11 ON SALE', accent: 0xf0a0c8, ink: 0x2a1040 },
  { art: '27_election_tadokoro', format: 'poster', cat: 'street', brand: '田所 誠一郎', copy: '明日の歌舞路を、もう一度。', accent: 0xffffff, ink: 0x0a2a6a },
  { art: '28_election_tadokoro', format: 'poster', cat: 'street', brand: '田所 誠一郎', copy: '明日の歌舞路を、もう一度。', accent: 0xffffff, ink: 0x0a2a6a },
  { art: '29_wanted_notice', format: 'poster', cat: 'street', brand: '指名手配', copy: 'この顔にピンときたら110番', accent: 0xf4f2ea, ink: 0xc01010 },
  { art: '30_wanted_notice', format: 'poster', cat: 'street', brand: '指名手配', copy: 'この顔にピンときたら110番', accent: 0xf4f2ea, ink: 0xc01010 },
  { art: '32_yorumart_poster', format: 'poster', cat: 'food', brand: 'ヨルマート', copy: 'ホットスナック 全品20円引き', accent: 0x10804a, ink: 0xffffff },
  { art: '33_yorumart_poster', format: 'poster', cat: 'food', brand: 'ヨルマート', copy: 'ホットスナック 全品20円引き', accent: 0x10804a, ink: 0xffffff },
  { art: '34_live_singer_poster', format: 'poster', cat: 'fun', brand: 'LIVE HOUSE 地下室', copy: 'YUKO MIDNIGHT ONE MAN LIVE', accent: 0x101030, ink: 0x80d0ff },
  { art: '35_live_singer_poster', format: 'poster', cat: 'fun', brand: 'LIVE HOUSE 地下室', copy: 'YUKO MIDNIGHT ONE MAN LIVE', accent: 0x101030, ink: 0x80d0ff },
  { art: '37_live_nightdrive', format: 'billboard', cat: 'fun', brand: 'LIVE HOUSE 地下室', copy: 'NIGHT DRIVE 今夜 23:00', accent: 0x80d0ff, ink: 0xffffff, text: 'bottom' },
  { art: '38_yorumart_food', format: 'billboard', cat: 'food', brand: 'ヨルマート YORU MART', copy: '24時間、あなたの夜に。', accent: 0x40e090, ink: 0xffffff, text: 'bottom' },
  { art: '39_hotel_aqua', format: 'billboard', cat: 'lovehotel', brand: 'HOTEL AQUA', copy: 'ジャグジー全室完備 休憩 ¥3,500〜', accent: 0x60e8ff, ink: 0xffffff, text: 'right' },
  { art: '40_hotel_aqua', format: 'billboard', cat: 'lovehotel', brand: 'HOTEL AQUA', copy: 'ジャグジー全室完備 休憩 ¥3,500〜', accent: 0x60e8ff, ink: 0xffffff, text: 'right' },
  { art: '41_gekko_whisky', format: 'billboard', cat: 'mainstream', brand: 'WHISKY 月光 GEKKO', copy: '夜は、琥珀色。', accent: 0xe8b060, ink: 0xffffff, text: 'left' },
  { art: '42_gekko_whisky', format: 'billboard', cat: 'mainstream', brand: 'WHISKY 月光 GEKKO', copy: '夜は、琥珀色。', accent: 0xe8b060, ink: 0xffffff, text: 'left' },
  { art: '43_gzone_arcade', format: 'billboard', cat: 'gaming', brand: 'GAME CENTER G-ZONE', copy: 'UFOキャッチャー 新景品!', accent: 0xffe040, ink: 0xffffff, text: 'bottom' },
  { art: '44_midnight_sisters', format: 'billboard', cat: 'mainstream', brand: 'ミッドナイト☆シスターズ', copy: 'NEW SINGLE「真夜中サイダー」', accent: 0xff80d0, ink: 0xffffff, text: 'bottom' },
  { art: '45_tokyo_noir_film', format: 'billboard', cat: 'mainstream', brand: '映画『東京ノワール』', copy: '今夜、この街で誰かが消える。', accent: 0xff4050, ink: 0xffffff, text: 'bottom' },
  { art: '46_tokyo_noir_film', format: 'billboard', cat: 'mainstream', brand: '映画『東京ノワール』', copy: '今夜、この街で誰かが消える。', accent: 0xff4050, ink: 0xffffff, text: 'left' },
  { art: '47_ryujin_kogyo', format: 'billboard', cat: 'mainstream', brand: '竜神興業', copy: '街の未来を、築く。', accent: 0xd8b060, ink: 0xffffff, text: 'left' },
  { art: '48_ryujin_kogyo', format: 'billboard', cat: 'mainstream', brand: '竜神興業', copy: '街の未来を、築く。', accent: 0xd8b060, ink: 0xffffff, text: 'left' },
  // Round 3.
  { art: '53_maid_cafe_pure', format: 'billboard', cat: 'fun', brand: 'めいどかふぇ ♡ぴゅあ♡', copy: 'おかえりなさいませ、ご主人様♡', accent: 0xff90c8, ink: 0xffffff, text: 'right' },
  { art: '81_maid_cafe_pure', format: 'billboard', cat: 'fun', brand: 'めいどかふぇ ♡ぴゅあ♡', copy: 'おかえりなさいませ、ご主人様♡', accent: 0xff90c8, ink: 0xffffff, text: 'right' },
  { art: '54_cash_one', format: 'billboard', cat: 'loan', brand: 'キャッシュ・ワン', copy: 'ご融資 最短30分', accent: 0x1060d0, ink: 0xffffff, text: 'bottom' },
  { art: '55_hotel_orient', format: 'billboard', cat: 'lovehotel', brand: 'HOTEL ORIENT EXPRESS', copy: '寝台列車ルーム 新登場', accent: 0xe8c070, ink: 0xffffff, text: 'left' },
  { art: '56_hotel_orient', format: 'billboard', cat: 'lovehotel', brand: 'HOTEL ORIENT EXPRESS', copy: '寝台列車ルーム 新登場', accent: 0xe8c070, ink: 0xffffff, text: 'left' },
  { art: '57_hotel_sakura', format: 'billboard', cat: 'lovehotel', brand: 'ホテル 桜 SAKURA', copy: '和室あります 宿泊 ¥6,800〜', accent: 0xffa0c8, ink: 0xffffff, text: 'right' },
  { art: '58_hotel_sakura', format: 'billboard', cat: 'lovehotel', brand: 'ホテル 桜 SAKURA', copy: '和室あります 宿泊 ¥6,800〜', accent: 0xffa0c8, ink: 0xffffff, text: 'left' },
  { art: '59_club_prince', format: 'billboard', cat: 'host', brand: 'CLUB PRINCE', copy: '指名No.1 レン', accent: 0xe8c060, ink: 0xffffff, text: 'bottom' },
  { art: '60_club_prince', format: 'billboard', cat: 'host', brand: 'CLUB PRINCE', copy: '指名No.1 レン', accent: 0xe8c060, ink: 0xffffff, text: 'bottom' },
  { art: '62_tokyo_noir_film_jp', format: 'billboard', cat: 'mainstream', brand: '映画『東京ノワール』', copy: '今夜、この街で誰かが消える。', accent: 0xff4050, ink: 0xffffff, text: 'bottom' },
  { art: '63_gzone_arcade_dirty', format: 'billboard', cat: 'gaming', brand: 'GAME CENTER G-ZONE', copy: '24時間営業 新台入荷', accent: 0xff3030, ink: 0xffffff, text: 'bottom' },
  { art: '66_maid_cafe_pure_poster', format: 'poster', cat: 'fun', brand: 'めいどかふぇ ♡ぴゅあ♡', copy: 'チェキ撮影 ¥500', accent: 0x1a1a1a, ink: 0xff9ad0 },
  { art: '67_maid_cafe_pure_poster', format: 'poster', cat: 'fun', brand: 'めいどかふぇ ♡ぴゅあ♡', copy: 'チェキ撮影 ¥500', accent: 0x1a1a1a, ink: 0xff9ad0 },
  { art: '68_hotel_mirage_poster', format: 'poster', cat: 'lovehotel', brand: 'HOTEL MIRAGE', copy: 'メイドルーム 空室あり', accent: 0x0a3a3a, ink: 0xf0d080 },
  { art: '69_hotel_mirage_poster', format: 'poster', cat: 'lovehotel', brand: 'HOTEL MIRAGE', copy: 'メイドルーム 空室あり', accent: 0x0a3a3a, ink: 0xf0d080 },
  { art: '70_momogen_esthe', format: 'poster', cat: 'adult', brand: '癒しのエステ 桃源郷', copy: '60分 ¥6,000 深夜営業', accent: 0x6a3a18, ink: 0xffe0b0 },
  { art: '71_momogen_esthe', format: 'poster', cat: 'adult', brand: '癒しのエステ 桃源郷', copy: '60分 ¥6,000 深夜営業', accent: 0x6a3a18, ink: 0xffe0b0 },
  { art: '72_snack_yasoukyoku', format: 'poster', cat: 'hostess', brand: 'スナック 夜想曲', copy: 'ママがお待ちしております', accent: 0x4a1830, ink: 0xffd8e8 },
  { art: '73_netcafe_yobune', format: 'poster', cat: 'lodging', brand: 'ネットカフェ 夜舟', copy: 'ナイトパック 8時間 ¥1,480', accent: 0x1a4a8a, ink: 0xffffff },
  { art: '79_netcafe_yobune', format: 'poster', cat: 'lodging', brand: 'ネットカフェ 夜舟', copy: 'ナイトパック 8時間 ¥1,480', accent: 0x1a4a8a, ink: 0xffffff },
  { art: '74_capsule_hotel', format: 'poster', cat: 'lodging', brand: 'カプセルホテル 蜂の巣', copy: '1泊 ¥2,900 サウナ付', accent: 0xe8a030, ink: 0x201008 },
  { art: '75_mahjong_tonpu', format: 'poster', cat: 'gaming', brand: '雀荘 東風', copy: 'フリー 1卓より 24H', accent: 0x0a4020, ink: 0xffffff },
  { art: '76_cash_one_poster', format: 'poster', cat: 'loan', brand: 'キャッシュ・ワン', copy: 'ブラックOK 即日', accent: 0x101010, ink: 0xffd040 },
  { art: '78_maruyoshi_pawn', format: 'poster', cat: 'loan', brand: '質 まるよし', copy: 'ブランド品・貴金属 高価買取', accent: 0x101010, ink: 0xe8c060 },
];

/** The district ads an edition shows: the demo leaves out the revealing ones (src/edition/demoArt.ts). */
export const districtAdsFor = (edition: string): readonly DistrictAd[] =>
  edition === 'demo' ? ALL_DISTRICT_ADS.filter((a) => !DEMO_HIDDEN_ART.has(a.art)) : ALL_DISTRICT_ADS;

/** This build's district ads (the chunk workers place them, the atlas draws them; indexes agree). */
export const DISTRICT_ADS: readonly DistrictAd[] = districtAdsFor(__EDITION__);

/** The Kaburo mega-sign's screen content (16:9, assets/ads/kaburo/mega/), cycled across its screens. */
export interface MegaAd {
  readonly art: string;
  readonly brand: string;
  readonly copy: string;
  readonly accent: number;
  readonly ink: number;
}

export const MEGA_ADS: readonly MegaAd[] = [
  { art: '80_mega_kaburo', brand: 'WELCOME TO KABURO 歌舞路', copy: '眠らない街へ、ようこそ。', accent: 0xff70c8, ink: 0xffffff },
  { art: '49_mega_cosmetics', brand: 'SHISEIKA ルージュ', copy: '夜に、咲く。', accent: 0xff3040, ink: 0xffffff },
  { art: '64_mega_soda', brand: 'ネオンサイダー NEON CIDER', copy: 'シュワっと、夜更かし。', accent: 0x40f0ff, ink: 0xffffff },
  { art: '51_mega_whisky', brand: 'WHISKY 月光 GEKKO', copy: '夜は、琥珀色。', accent: 0xe8b060, ink: 0xffffff },
  { art: '65_mega_idol', brand: 'ミッドナイト☆シスターズ', copy: '真夜中サイダー MV 解禁', accent: 0xff80d0, ink: 0xffffff },
  { art: '50_mega_cosmetics', brand: 'SHISEIKA ルージュ', copy: '夜に、咲く。', accent: 0xff3040, ink: 0xffffff },
  { art: '52_mega_whisky', brand: 'WHISKY 月光 GEKKO', copy: '夜は、琥珀色。', accent: 0xe8b060, ink: 0xffffff },
];
