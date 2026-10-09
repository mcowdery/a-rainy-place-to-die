import { CHUNK } from '../config';

/**
 * A CHUNK x CHUNK square of world tiles, struct-of-arrays, indexed [ly * CHUNK + lx].
 *  - tile:  tile type id (tiles.ts)
 *  - glyph: glyph override codepoint; GLYPH_NONE = use the tile's glyph, GLYPH_CONT = right half of a wide char
 *  - fg:    foreground palette override, stored as palette index + 1 (0 = use the tile's fg)
 */
export class Chunk {
  readonly tile = new Uint16Array(CHUNK * CHUNK);
  readonly glyph = new Uint32Array(CHUNK * CHUNK);
  readonly fg = new Uint8Array(CHUNK * CHUNK);

  constructor(
    readonly cx: number,
    readonly cy: number,
  ) {}

  put(i: number, tile: number, glyph = 0, fg = 0): void {
    this.tile[i] = tile;
    this.glyph[i] = glyph;
    this.fg[i] = fg;
  }
}
