import type { TaxiAd } from './vehicles';

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
}

export const DISTRICT_ADS: readonly DistrictAd[] = [
  { art: '10_club_adonis_hosts', format: 'billboard', brand: 'CLUB ADONIS', copy: 'No.1 ホスト 今夜も君を待つ', accent: 0xe8c060, ink: 0xffffff, text: 'bottom' },
  { art: '12_hotel_rouge_julie', format: 'billboard', brand: 'HOTEL ROUGE ホテル ルージュ', copy: '休憩 ¥3,800〜 / 宿泊 ¥7,500〜', accent: 0xff5070, ink: 0xffffff, text: 'left' },
  { art: '13_hotel_rouge', format: 'billboard', brand: 'HOTEL ROUGE', copy: '休憩 ¥3,800〜 / 宿泊 ¥7,500〜', accent: 0xff5070, ink: 0xffffff, text: 'right' },
  { art: '14_hotel_venus', format: 'billboard', brand: 'HOTEL VENUS', copy: 'ご休憩 60分 ¥2,900', accent: 0x3a0a2c, ink: 0xffd0f0 },
  { art: '17_parlor_ginga', format: 'billboard', brand: 'パーラー銀河', copy: '新台入替! 朝10時オープン', accent: 0xffd040, ink: 0xffffff, text: 'left' },
  { art: '19_yakou_drink_billboard', format: 'billboard', brand: '夜光 YAKOU', copy: '今夜も、光れ。', accent: 0xff4040, ink: 0xffffff, text: 'bottom' },
  { art: '21_club_moonlight', format: 'billboard', brand: 'CLUB MOONLIGHT', copy: '朝まで、あなたの隣に。', accent: 0xa8c8ff, ink: 0xffffff, text: 'left' },
  { art: '09_annaijo_girls', format: 'poster', brand: '無料案内所', copy: 'かわいい子、ご案内します', accent: 0xffd400, ink: 0x141414 },
  { art: '11_hikari_loan', format: 'poster', brand: 'ヒカリ ローン', copy: '即日融資 審査かんたん!', accent: 0xd01818, ink: 0xffffff },
  { art: '15_karaoke_dream', format: 'poster', brand: 'カラオケ DREAM', copy: '全室 朝まで ¥1,500', accent: 0xd83090, ink: 0xffffff },
  { art: '16_kirishima_poster', format: 'poster', brand: '霧島探偵事務所', copy: '人探し・浮気調査・秘密厳守', accent: 0x101418, ink: 0xe8d8a0 },
  { art: '18_tsukuyomi_fortune', format: 'poster', brand: '占いの館 月詠', copy: 'あなたの運命、視えます。', accent: 0x2a1440, ink: 0xd8b8ff },
  { art: '20_yonaki_ramen', format: 'poster', brand: 'ラーメン 夜鳴き', copy: '深夜3時まで', accent: 0x201008, ink: 0xffc070 },
  { art: '22_hotel_venus_poster', format: 'poster', brand: 'HOTEL VENUS', copy: 'ご休憩 60分 ¥2,900 空室あり', accent: 0xe070b8, ink: 0xffffff },
  // Round 2.
  { art: '23_gabunomi_izakaya', format: 'poster', brand: '居酒屋 がぶ飲み屋', copy: '生ビール 一杯 ¥190', accent: 0xe8a020, ink: 0x201008 },
  { art: '31_gabunomi_izakaya', format: 'poster', brand: '居酒屋 がぶ飲み屋', copy: '生ビール 一杯 ¥190', accent: 0xe8a020, ink: 0x201008 },
  { art: '36_gabunomi_izakaya', format: 'poster', brand: '居酒屋 がぶ飲み屋', copy: '生ビール 一杯 ¥190', accent: 0xe8a020, ink: 0x201008 },
  { art: '24_cash_one_poster', format: 'poster', brand: 'キャッシュ・ワン', copy: 'ブラックOK 即日', accent: 0x0a3a8a, ink: 0xffe040 },
  { art: '25_julie_album', format: 'poster', brand: 'JULIE『MIDNIGHT PLASTIC』', copy: 'NEW ALBUM 11.11 ON SALE', accent: 0xf0a0c8, ink: 0x2a1040 },
  { art: '26_julie_album', format: 'poster', brand: 'JULIE『MIDNIGHT PLASTIC』', copy: 'NEW ALBUM 11.11 ON SALE', accent: 0xf0a0c8, ink: 0x2a1040 },
  { art: '27_election_tadokoro', format: 'poster', brand: '田所 誠一郎', copy: '明日の歌舞路を、もう一度。', accent: 0xffffff, ink: 0x0a2a6a },
  { art: '28_election_tadokoro', format: 'poster', brand: '田所 誠一郎', copy: '明日の歌舞路を、もう一度。', accent: 0xffffff, ink: 0x0a2a6a },
  { art: '29_wanted_notice', format: 'poster', brand: '指名手配', copy: 'この顔にピンときたら110番', accent: 0xf4f2ea, ink: 0xc01010 },
  { art: '30_wanted_notice', format: 'poster', brand: '指名手配', copy: 'この顔にピンときたら110番', accent: 0xf4f2ea, ink: 0xc01010 },
  { art: '32_yorumart_poster', format: 'poster', brand: 'ヨルマート', copy: 'ホットスナック 全品20円引き', accent: 0x10804a, ink: 0xffffff },
  { art: '33_yorumart_poster', format: 'poster', brand: 'ヨルマート', copy: 'ホットスナック 全品20円引き', accent: 0x10804a, ink: 0xffffff },
  { art: '34_live_singer_poster', format: 'poster', brand: 'LIVE HOUSE 地下室', copy: 'YUKO MIDNIGHT ONE MAN LIVE', accent: 0x101030, ink: 0x80d0ff },
  { art: '35_live_singer_poster', format: 'poster', brand: 'LIVE HOUSE 地下室', copy: 'YUKO MIDNIGHT ONE MAN LIVE', accent: 0x101030, ink: 0x80d0ff },
  { art: '37_live_nightdrive', format: 'billboard', brand: 'LIVE HOUSE 地下室', copy: 'NIGHT DRIVE 今夜 23:00', accent: 0x80d0ff, ink: 0xffffff, text: 'bottom' },
  { art: '38_yorumart_food', format: 'billboard', brand: 'ヨルマート YORU MART', copy: '24時間、あなたの夜に。', accent: 0x40e090, ink: 0xffffff, text: 'bottom' },
  { art: '39_hotel_aqua', format: 'billboard', brand: 'HOTEL AQUA', copy: 'ジャグジー全室完備 休憩 ¥3,500〜', accent: 0x60e8ff, ink: 0xffffff, text: 'right' },
  { art: '40_hotel_aqua', format: 'billboard', brand: 'HOTEL AQUA', copy: 'ジャグジー全室完備 休憩 ¥3,500〜', accent: 0x60e8ff, ink: 0xffffff, text: 'right' },
  { art: '41_gekko_whisky', format: 'billboard', brand: 'WHISKY 月光 GEKKO', copy: '夜は、琥珀色。', accent: 0xe8b060, ink: 0xffffff, text: 'left' },
  { art: '42_gekko_whisky', format: 'billboard', brand: 'WHISKY 月光 GEKKO', copy: '夜は、琥珀色。', accent: 0xe8b060, ink: 0xffffff, text: 'left' },
  { art: '43_gzone_arcade', format: 'billboard', brand: 'GAME CENTER G-ZONE', copy: 'UFOキャッチャー 新景品!', accent: 0xffe040, ink: 0xffffff, text: 'bottom' },
  { art: '44_midnight_sisters', format: 'billboard', brand: 'ミッドナイト☆シスターズ', copy: 'NEW SINGLE「真夜中サイダー」', accent: 0xff80d0, ink: 0xffffff, text: 'bottom' },
  { art: '45_tokyo_noir_film', format: 'billboard', brand: '映画『東京ノワール』', copy: '今夜、この街で誰かが消える。', accent: 0xff4050, ink: 0xffffff, text: 'bottom' },
  { art: '46_tokyo_noir_film', format: 'billboard', brand: '映画『東京ノワール』', copy: '今夜、この街で誰かが消える。', accent: 0xff4050, ink: 0xffffff, text: 'left' },
  { art: '47_ryujin_kogyo', format: 'billboard', brand: '竜神興業', copy: '街の未来を、築く。', accent: 0xd8b060, ink: 0xffffff, text: 'left' },
  { art: '48_ryujin_kogyo', format: 'billboard', brand: '竜神興業', copy: '街の未来を、築く。', accent: 0xd8b060, ink: 0xffffff, text: 'left' },
];
