/**
 * Women's detailed hair (a trial, 2026-10-10; the user: less anime, more detailed cuts on the women): the names of
 * the cuts, and how the classic generation draws each (as one of its three: short, long, bun). Only a name here is
 * needed by the type `Hair` and the template lists (mobRig.ts, people.ts); the geometry is in mobHair.ts.
 */
const KINDS = {
  // Long.
  strands: 'long', long_side: 'long', long_wavy: 'long', long_curly: 'long', long_layered: 'long', hime: 'long', long_bangs: 'long', long_curtain: 'long', long_blunt: 'long', long_feather: 'long', long_shag: 'long',
  // Shoulder length.
  lob: 'long', lob_wave: 'long', flip: 'long', wolf: 'long', mid_curtain: 'long', mid_side: 'long', lob_tuck: 'long', lob_blunt: 'long',
  // Short.
  bob_blunt: 'short', bob_aline: 'short', bob_curl: 'short', bob_side: 'short', pixie: 'short', short_wave: 'short', tomboy: 'short', bob_asym: 'short', crop_curl: 'short', bob_shaggy: 'short',
  // Up.
  sleek: 'bun', bun_messy: 'bun', bun_low: 'bun', topknot: 'bun', twist: 'bun', half_up: 'bun', chignon: 'bun', bun_double: 'bun', bun_high: 'bun', claw: 'bun', updo_loose: 'bun',
  // The old (anime) cuts, in fine strands.
  short_fine: 'short', bob_fine: 'short', long_fine: 'long', ponytail_fine: 'long', twin_fine: 'long', bun_fine: 'bun',
  // Low ponytails.
  lowpony_over_loose: 'long', lowpony_over_sleek: 'long', lowpony_back_center: 'long', lowpony_back_loose: 'long', lowpony_braid_over: 'long', lowpony_wavy_over: 'long', lowpony_tendrils: 'long',
  // The third batch.
  long_hollywood: 'long', long_tousled: 'long', long_beach: 'long', long_ringlets: 'long', long_over_shoulder: 'long', long_wispy: 'long',
  lob_wispy: 'long', lob_beach: 'long', lob_ringlets: 'long', lob_layers: 'long', lob_sidepart: 'long',
  bob_french: 'short', bob_inverted: 'short', bob_curly: 'short', pixie_long: 'short', pixie_wisps: 'short', crop_buzz: 'short', bowl: 'short',
  bun_stick: 'bun', bun_side_high: 'bun', bun_pair_low: 'bun', topknot_messy: 'bun', french_roll: 'bun', updo_pinned: 'bun', bun_odango_tails: 'bun', half_up_buns: 'bun',
  pony_bubble: 'long', pony_half: 'long', pony_bow: 'long', pigtails_curly: 'long', braid_fishtail: 'long', braid_thick: 'long', pony_braided: 'long', braid_milkmaid: 'long', braid_half_up: 'long',
  // Tails and braids.
  pony_high: 'long', pony_low: 'long', pony_side: 'long', twin_low: 'long', twin_high: 'long', braid_back: 'long', braid_side: 'long', braids_twin: 'long', pony_curly: 'long', braids_high: 'long', braid_crown: 'long',
} as const;

export type DetailedHair = keyof typeof KINDS;
export const DETAILED_HAIR = Object.keys(KINDS) as DetailedHair[];
export const isDetailed = (hair: string): hair is DetailedHair => hair in KINDS;
export const detailedClassic = (hair: DetailedHair): 'short' | 'long' | 'bun' => KINDS[hair];

/** The showroom's rows (the hair room, hair.html): a name and the cuts in it. */
export const HAIR_GROUPS: readonly (readonly [string, readonly DetailedHair[]])[] = [
  ['the old cuts, in fine strands', ['short_fine', 'bob_fine', 'long_fine', 'ponytail_fine', 'twin_fine', 'bun_fine']],
  ['long hair', ['strands', 'long_side', 'long_wavy', 'long_curly', 'long_layered', 'hime', 'long_bangs', 'long_curtain', 'long_blunt', 'long_feather', 'long_shag']],
  ['shoulder-length hair', ['lob', 'lob_wave', 'flip', 'wolf', 'mid_curtain', 'mid_side', 'lob_tuck', 'lob_blunt']],
  ['short hair', ['bob_blunt', 'bob_aline', 'bob_curl', 'bob_side', 'pixie', 'short_wave', 'tomboy', 'bob_asym', 'crop_curl', 'bob_shaggy']],
  ['hair up', ['sleek', 'bun_messy', 'bun_low', 'topknot', 'twist', 'half_up', 'chignon', 'bun_double', 'bun_high', 'claw', 'updo_loose']],
  ['tails and braids', ['pony_high', 'pony_low', 'pony_side', 'twin_low', 'twin_high', 'braid_back', 'braid_side', 'braids_twin', 'pony_curly', 'braids_high', 'braid_crown']],
  ['low ponytails', ['lowpony_over_loose', 'lowpony_over_sleek', 'lowpony_back_center', 'lowpony_back_loose', 'lowpony_braid_over', 'lowpony_wavy_over', 'lowpony_tendrils']],
  ['more long hair', ['long_hollywood', 'long_tousled', 'long_beach', 'long_ringlets', 'long_over_shoulder', 'long_wispy']],
  ['more shoulder-length hair', ['lob_wispy', 'lob_beach', 'lob_ringlets', 'lob_layers', 'lob_sidepart']],
  ['more short hair', ['bob_french', 'bob_inverted', 'bob_curly', 'pixie_long', 'pixie_wisps', 'crop_buzz', 'bowl']],
  ['more hair up', ['bun_stick', 'bun_side_high', 'bun_pair_low', 'topknot_messy', 'french_roll', 'updo_pinned', 'bun_odango_tails', 'half_up_buns']],
  ['more tails and braids', ['pony_bubble', 'pony_half', 'pony_bow', 'pigtails_curly', 'braid_fishtail', 'braid_thick', 'pony_braided', 'braid_milkmaid', 'braid_half_up']],
];
