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
