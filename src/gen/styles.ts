import type { PaletteName, TileName } from '../world/tiles';
import type { DistrictId } from './macro';

export type Range = readonly [min: number, max: number];
export type LotKind = 'building' | 'park' | 'parking' | 'plaza' | 'containers' | 'open';

/** Per-district parameters for L1 (streets) and L2 (lots and facades). All sizes in tiles. */
export interface DistrictStyle {
  /** Tile for leftover ground, and for the strip along a coast. */
  fill: TileName;
  coast: TileName;
  /** Widths to choose from for roads on macro-cell edges inside the district (width >= 3 gets sidewalks). */
  edgeRoads: readonly number[];
  localStreet: Range;
  /** Blocks are split while larger than [1]; no piece smaller than [0]. */
  blockW: Range;
  blockH: Range;
  /** Chance a deep block becomes two rows of buildings with a back alley between them. */
  bandSplit: number;
  lotW: Range;
  /** Chance of a one-tile gap between neighbouring lots. */
  lotGap: number;
  lots: Readonly<Partial<Record<LotKind, number>>>;
  /** Facade rows (on-screen building height) and roof depth rows. */
  facade: Range;
  roofDepth: Range;
  /** Max open rows behind a building; the roof fills the rest of the lot (up to roofDepth[1]). */
  yardMax: number;
  roof: TileName;
  wall: TileName;
  window: TileName;
  windows: 'grid' | 'sparse' | 'curtain';
  /** Ground-floor glazing and door placement. */
  shopfront: number;
  awning: number;
  awningColors: readonly PaletteName[];
  signs: { chance: number; vertical: number; words: readonly string[]; colors: readonly PaletteName[] };
  /** Ground behind a building that doesn't fill its lot's depth. */
  yard: TileName;
}

/** Road width on any boundary between two different districts. */
export const DISTRICT_BOUNDARY_ROAD = 8;
/** Width of the ground strip along water / world edge. */
export const COAST_WIDTH = 3;

const NEON = ['neon_pink', 'neon_cyan', 'neon_yellow', 'neon_green', 'neon_red'] as const;

const BASE_STYLES: Readonly<Record<Exclude<DistrictId, 'electric' | 'campus'>, DistrictStyle>> = {
  residential: {
    fill: 'ground', coast: 'sidewalk',
    edgeRoads: [3, 3, 4], localStreet: [2, 3], blockW: [18, 40], blockH: [12, 22],
    bandSplit: 0.6, lotW: [6, 11], lotGap: 0.5,
    lots: { building: 8, park: 1, parking: 1 },
    facade: [2, 3], roofDepth: [2, 5], yardMax: 12,
    roof: 'roof_house', wall: 'wall_house', window: 'window_house', windows: 'sparse',
    shopfront: 0.05, awning: 0, awningColors: [],
    signs: { chance: 0.04, vertical: 0, words: ['クリーニング', 'TABAKO', '牛乳'], colors: ['neon_cyan'] },
    yard: 'grass',
  },
  tower: {
    fill: 'plaza', coast: 'plaza',
    edgeRoads: [6, 8], localStreet: [4, 6], blockW: [30, 64], blockH: [40, 60],
    bandSplit: 0, lotW: [16, 30], lotGap: 0.35,
    lots: { building: 7, plaza: 2, park: 1 },
    facade: [18, 46], roofDepth: [4, 24], yardMax: 4,
    roof: 'roof_tower', wall: 'wall_glass', window: 'window_tower', windows: 'curtain',
    shopfront: 1, awning: 0, awningColors: [],
    signs: { chance: 0.35, vertical: 0, words: ['KSK BANK', 'MIRAI', '東都生命', 'ASAHI TRUST', '中央ビル', 'NEXUS'], colors: ['neon_cyan', 'neon_red'] },
    yard: 'plaza',
  },
  neon: {
    fill: 'alley', coast: 'sidewalk',
    edgeRoads: [4, 6], localStreet: [2, 4], blockW: [14, 30], blockH: [14, 26],
    bandSplit: 0.4, lotW: [5, 12], lotGap: 0.15,
    lots: { building: 14, parking: 1 },
    facade: [4, 10], roofDepth: [2, 30], yardMax: 1,
    roof: 'roof_flat', wall: 'wall', window: 'window', windows: 'grid',
    shopfront: 0.8, awning: 0.5, awningColors: ['awning', 'neon_pink', 'neon_cyan'],
    signs: {
      chance: 0.85,
      vertical: 0.5,
      words: ['カラオケ', 'スナック', '居酒屋', 'ラーメン', 'パチンコ', '喫茶', '酒場', 'ホテル', 'クラブ', '焼鳥', 'BAR', 'CLUB', 'KARAOKE', 'HOTEL', 'ゲーム'],
      colors: NEON,
    },
    yard: 'alley',
  },
  oldtown: {
    fill: 'ground', coast: 'sidewalk',
    edgeRoads: [2, 3], localStreet: [1, 2], blockW: [10, 22], blockH: [10, 18],
    bandSplit: 0.5, lotW: [4, 9], lotGap: 0.3,
    lots: { building: 10, park: 1, plaza: 1 },
    facade: [2, 4], roofDepth: [2, 12], yardMax: 2,
    roof: 'roof_tile', wall: 'wall_wood', window: 'window_old', windows: 'sparse',
    shopfront: 0.4, awning: 0.25, awningColors: ['awning', 'container_blue'],
    signs: { chance: 0.4, vertical: 0.8, words: ['茶屋', '蕎麦', '古本', '甘味', '酒', '宿', '湯', '薬', '米'], colors: ['neon_red', 'neon_yellow'] },
    yard: 'ground',
  },
  harbor: {
    fill: 'dock', coast: 'dock',
    edgeRoads: [5, 7], localStreet: [3, 5], blockW: [30, 60], blockH: [24, 40],
    bandSplit: 0.2, lotW: [18, 36], lotGap: 0.2,
    lots: { building: 5, containers: 4, parking: 1 },
    facade: [3, 6], roofDepth: [6, 30], yardMax: 3,
    roof: 'roof_metal', wall: 'wall_metal', window: 'window_metal', windows: 'sparse',
    shopfront: 0, awning: 0, awningColors: [],
    signs: { chance: 0.3, vertical: 0, words: ['倉庫', 'PIER 7', '港運', 'DOCK 3', 'COLD STORAGE'], colors: ['neon_yellow', 'neon_cyan'] },
    yard: 'dock',
  },
  beach: {
    fill: 'sand', coast: 'sand',
    edgeRoads: [3, 4], localStreet: [2, 3], blockW: [20, 40], blockH: [14, 24],
    bandSplit: 0.3, lotW: [6, 12], lotGap: 0.6,
    lots: { building: 3, open: 5, park: 1 },
    facade: [2, 3], roofDepth: [2, 4], yardMax: 8,
    roof: 'roof_house', wall: 'wall_house', window: 'window_house', windows: 'sparse',
    shopfront: 0.3, awning: 0.3, awningColors: ['neon_yellow', 'neon_cyan'],
    signs: { chance: 0.2, vertical: 0, words: ['海の家', 'SURF', '氷', 'かき氷'], colors: ['neon_cyan', 'neon_yellow'] },
    yard: 'sand',
  },
};

/** The 3D city's newer kinds borrow the nearest 2D look (the 2D prototype is set aside). */
export const STYLES: Readonly<Record<DistrictId, DistrictStyle>> = { ...BASE_STYLES, electric: BASE_STYLES.neon, campus: BASE_STYLES.residential };

