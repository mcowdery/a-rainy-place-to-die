/**
 * L0: the hand-painted macro map. One character = one macro cell of CONFIG.cellW x CONFIG.cellH tiles.
 * Stamps are anchored to macro cells (not raw tile coords), so re-tuning cell size keeps them in place.
 */

/** (electric: an Akihabara-like electric town; campus: a university and its student town. The 3D city's L0.) */
export const DISTRICTS = ['residential', 'tower', 'neon', 'oldtown', 'harbor', 'beach', 'electric', 'campus'] as const;
export type DistrictId = (typeof DISTRICTS)[number];
export type CellKind = DistrictId | 'water' | 'void';

export const CELL_CHARS: Readonly<Record<string, CellKind>> = {
  R: 'residential',
  T: 'tower',
  N: 'neon',
  O: 'oldtown',
  H: 'harbor',
  B: 'beach',
  E: 'electric',
  U: 'campus',
  '~': 'water',
  '.': 'void',
};

export const isLand = (k: CellKind): k is DistrictId => k !== 'water' && k !== 'void';

export class MacroMap {
  constructor(
    readonly cols: number,
    readonly rows: number,
    private readonly cells: readonly CellKind[],
  ) {}

  /** Outside the map is void. */
  kindAt(mx: number, my: number): CellKind {
    if (mx < 0 || my < 0 || mx >= this.cols || my >= this.rows) return 'void';
    return this.cells[my * this.cols + mx];
  }
}

/** Lines starting with '#' are comments. Every map row must be the same width. */
export function parseMacroMap(file: string, text: string, errors: string[]): MacroMap | null {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length === 0) {
    errors.push(`${file}: map is empty`);
    return null;
  }
  const cols = [...lines[0]].length;
  const cells: CellKind[] = [];
  const before = errors.length;
  lines.forEach((line, row) => {
    const chars = [...line];
    if (chars.length !== cols) errors.push(`${file}: map row ${row} is ${chars.length} wide, expected ${cols}`);
    chars.forEach((ch, col) => {
      const kind = CELL_CHARS[ch];
      if (!kind) errors.push(`${file}: map row ${row} col ${col}: unknown cell '${ch}'`);
      cells.push(kind ?? 'void');
    });
  });
  return errors.length > before ? null : new MacroMap(cols, lines.length, cells);
}
