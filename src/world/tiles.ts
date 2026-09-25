/**
 * Palette and tile-type tables. Tiles reference palette entries by name, never by colour, so the
 * atmosphere lookup (atmosphere.ts) can recolour the whole world for (district, time, weather)
 * without touching world data.
 */

export const PALETTE_NAMES = [
  'void', 'water', 'water_hi', 'ground', 'ground_hi', 'grass', 'grass_hi', 'tree', 'sand', 'sand_hi',
  'sidewalk', 'sidewalk_hi', 'asphalt', 'asphalt_hi', 'road_mark', 'alley', 'plaza', 'plaza_hi',
  'roof', 'roof_hi', 'roof_tile', 'roof_tile_hi', 'roof_house', 'roof_house_hi',
  'roof_tower', 'roof_tower_hi', 'roof_metal', 'roof_metal_hi', 'cornice',
  'wall', 'wall_house', 'wall_wood', 'wall_metal', 'glass', 'window', 'window_lit', 'shop',
  'door', 'door_story', 'awning', 'sign_bg',
  'neon_off', 'neon_pink', 'neon_cyan', 'neon_yellow', 'neon_green', 'neon_red',
  'container_red', 'container_blue', 'container_green', 'container_orange',
  'dock', 'dock_hi', 'payphone', 'player', 'npc', 'npc_alt', 'rain',
] as const;

export type PaletteName = (typeof PALETTE_NAMES)[number];

export const PAL = Object.fromEntries(PALETTE_NAMES.map((n, i) => [n, i])) as Record<PaletteName, number>;

export const isPaletteName = (s: string): s is PaletteName => s in PAL;

/** Light sources: exempt from time/weather tints so they read as glowing. */
export const EMISSIVE: ReadonlySet<PaletteName> = new Set<PaletteName>([
  'window_lit', 'shop', 'door_story', 'neon_pink', 'neon_cyan', 'neon_yellow', 'neon_green', 'neon_red',
  'payphone', 'player', 'npc', 'npc_alt',
]);

export type TileTag = 'water' | 'window' | 'neon';

interface TileSrc {
  /** Glyph, or several to pick from per position (for texture). */
  glyphs: string;
  fg: PaletteName;
  bg: PaletteName;
  walk: boolean;
  tags?: readonly TileTag[];
}

const DEFS = {
  void: { glyphs: ' ', fg: 'void', bg: 'void', walk: false },
  water: { glyphs: '~~≈ ', fg: 'water_hi', bg: 'water', walk: false, tags: ['water'] },
  ground: { glyphs: '    .', fg: 'ground_hi', bg: 'ground', walk: true },
  grass: { glyphs: ",' \". ", fg: 'grass_hi', bg: 'grass', walk: true },
  tree: { glyphs: '♣', fg: 'tree', bg: 'grass', walk: false },
  sand: { glyphs: '  .: ', fg: 'sand_hi', bg: 'sand', walk: true },
  sidewalk: { glyphs: '      ·', fg: 'sidewalk_hi', bg: 'sidewalk', walk: true },
  asphalt: { glyphs: ' ', fg: 'asphalt_hi', bg: 'asphalt', walk: true },
  road_mark: { glyphs: '─', fg: 'road_mark', bg: 'asphalt', walk: true },
  road_mark_v: { glyphs: '│', fg: 'road_mark', bg: 'asphalt', walk: true },
  alley: { glyphs: '   .', fg: 'ground_hi', bg: 'alley', walk: true },
  plaza: { glyphs: '  · ', fg: 'plaza_hi', bg: 'plaza', walk: true },
  parking: { glyphs: ' ', fg: 'asphalt_hi', bg: 'asphalt', walk: true },
  parking_line: { glyphs: '│', fg: 'sidewalk_hi', bg: 'asphalt', walk: true },
  dock: { glyphs: '       ▪', fg: 'dock_hi', bg: 'dock', walk: true },
  roof_flat: { glyphs: '   ░', fg: 'roof_hi', bg: 'roof', walk: false },
  roof_tile: { glyphs: '≡', fg: 'roof_tile_hi', bg: 'roof_tile', walk: false },
  roof_house: { glyphs: '^', fg: 'roof_house_hi', bg: 'roof_house', walk: false },
  roof_tower: { glyphs: '    ░', fg: 'roof_tower_hi', bg: 'roof_tower', walk: false },
  roof_metal: { glyphs: '║', fg: 'roof_metal_hi', bg: 'roof_metal', walk: false },
  roof_equip: { glyphs: '▪', fg: 'roof_tower_hi', bg: 'roof_tower', walk: false },
  cornice: { glyphs: ' ', fg: 'cornice', bg: 'cornice', walk: false },
  wall: { glyphs: ' ', fg: 'wall', bg: 'wall', walk: false },
  wall_house: { glyphs: ' ', fg: 'wall_house', bg: 'wall_house', walk: false },
  wall_wood: { glyphs: ' │', fg: 'door', bg: 'wall_wood', walk: false },
  wall_metal: { glyphs: '│', fg: 'roof_metal', bg: 'wall_metal', walk: false },
  wall_glass: { glyphs: ' ', fg: 'glass', bg: 'glass', walk: false },
  window: { glyphs: '▪', fg: 'window', bg: 'wall', walk: false, tags: ['window'] },
  window_house: { glyphs: '▪', fg: 'window', bg: 'wall_house', walk: false, tags: ['window'] },
  window_old: { glyphs: '▒', fg: 'window', bg: 'wall_wood', walk: false, tags: ['window'] },
  window_tower: { glyphs: '▮', fg: 'window', bg: 'glass', walk: false, tags: ['window'] },
  window_metal: { glyphs: '▪', fg: 'window', bg: 'wall_metal', walk: false, tags: ['window'] },
  window_shop: { glyphs: '▓', fg: 'shop', bg: 'wall', walk: false },
  door_facade: { glyphs: ' ', fg: 'door', bg: 'door', walk: false },
  door: { glyphs: '▒', fg: 'door_story', bg: 'door', walk: false },
  awning: { glyphs: '▀', fg: 'awning', bg: 'wall', walk: false },
  sign: { glyphs: ' ', fg: 'neon_pink', bg: 'sign_bg', walk: false, tags: ['neon'] },
  container: { glyphs: '▓', fg: 'container_red', bg: 'dock', walk: false },
  payphone: { glyphs: '☎', fg: 'payphone', bg: 'sidewalk', walk: false },
} as const satisfies Record<string, TileSrc>;

export type TileName = keyof typeof DEFS;

export interface TileDef {
  readonly id: number;
  readonly name: TileName;
  readonly glyphs: readonly number[];
  readonly fg: number;
  readonly bg: number;
  readonly walk: boolean;
  readonly water: boolean;
  readonly window: boolean;
  readonly neon: boolean;
}

export const TILES: readonly TileDef[] = (Object.entries(DEFS) as [TileName, TileSrc][]).map(([name, d], id) => ({
  id,
  name,
  glyphs: Array.from(d.glyphs, (c) => c.codePointAt(0)!),
  fg: PAL[d.fg],
  bg: PAL[d.bg],
  walk: d.walk,
  water: d.tags?.includes('water') ?? false,
  window: d.tags?.includes('window') ?? false,
  neon: d.tags?.includes('neon') ?? false,
}));

/** Tile ids by name. */
export const T = Object.fromEntries(TILES.map((t) => [t.name, t.id])) as Record<TileName, number>;

export const isTileName = (s: string): s is TileName => s in T;
