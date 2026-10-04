/**
 * Kaburo ad art the demo edition leaves out: nudity (even censored) and the most suggestive. The demo's own glob
 * (demo.ts) excludes the same files so they aren't even bundled; tests/edition.test.ts keeps the two in step.
 */
export const DEMO_HIDDEN_ART: ReadonlySet<string> = new Set([
  '09_annaijo_girls',
  '12_hotel_rouge_julie',
  '13_hotel_rouge',
  '14_hotel_venus',
  '22_hotel_venus_poster',
  '39_hotel_aqua',
  '40_hotel_aqua',
  '53_maid_cafe_pure',
  '55_hotel_orient',
  '56_hotel_orient',
  '57_hotel_sakura',
  '58_hotel_sakura',
  '68_hotel_mirage_poster',
  '69_hotel_mirage_poster',
  '70_momogen_esthe',
  '71_momogen_esthe',
  '81_maid_cafe_pure',
]);

/**
 * Cast models the demo leaves out (it has no story): Mack nude, for the arrival (a smooth, censored body, but
 * nudity all the same). The demo's own glob (demo.ts) excludes the same files; tests/edition.test.ts checks.
 */
export const DEMO_HIDDEN_CHARACTERS: ReadonlySet<string> = new Set(['mack_nude']);
