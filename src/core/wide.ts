/**
 * Double-width (CJK) cell support. A wide character occupies two grid cells: the left cell holds
 * the codepoint, the right cell holds GLYPH_CONT. Every layer that stores glyphs (stamps, generated
 * signs, chunks, renderer) uses this same encoding.
 */

/** No glyph override: the tile type's own glyph is used. */
export const GLYPH_NONE = 0;
/** Right half of a wide character; drawn by its left neighbour. */
export const GLYPH_CONT = 1;

// East Asian Wide / Fullwidth ranges relevant to this game. Ambiguous-width characters are treated as
// narrow: the renderer draws each glyph into its own cell, so font disagreement can't shift the grid.
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, Kangxi, CJK symbols & punctuation (incl. ideographic space)
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, CJK compatibility
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe30, 0xfe4f], // CJK compatibility forms
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x20000, 0x3fffd], // CJK Extension B+
];

export function isWide(cp: number): boolean {
  if (cp < 0x1100) return false;
  for (const [lo, hi] of WIDE_RANGES) {
    if (cp < lo) return false;
    if (cp <= hi) return true;
  }
  return false;
}

/** Splits text into grid cells: narrow chars take one cell, wide chars become [cp, GLYPH_CONT]. */
export function textToCells(text: string): number[] {
  const cells: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    cells.push(cp === 0x20 ? GLYPH_NONE : cp);
    if (isWide(cp)) cells.push(GLYPH_CONT);
  }
  return cells;
}

/** Width of text in grid cells. */
export function cellWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += isWide(ch.codePointAt(0)!) ? 2 : 1;
  return w;
}
