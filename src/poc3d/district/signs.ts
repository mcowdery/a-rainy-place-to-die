import * as THREE from 'three';
import { hash } from '../../core/hash';
import { GLYPH_CONT, GLYPH_NONE, textToCells } from '../../core/wide';
import type { AsciiShaderPass } from '../asciiPass';
import type { Atmosphere3 } from './atmosphere';
import type { Sign3 } from './plan';

/** Signs further than this aren't drawn. */
export const SIGN_RANGE = 320;
/**
 * Beyond this, a sign is drawn as a compact strip of sub-cell (quadrant) glyphs half its text length:
 * it still reads as a glowing sign but no longer outgrows its building the way full-size text would.
 */
export const SIGN_TEXT_RANGE = 110;
/** Quadrant masks for far signs: ▚ ▞ alternating reads as fine glowing detail. */
const FAR_MASKS = [9, 6];
const NEON_OFF = 0x6a6470;
/** Atlas slot 0 is the blank glyph. */
const BLANK = 0;

const v = new THREE.Vector3();

/**
 * Lays signs out into the ASCII pass's text layer: project each sign's anchor, snap to a cell, and write
 * its characters at one cell each (CJK two cells, via the same [cp, GLYPH_CONT] encoding as the 2D
 * prototype), horizontally or top-to-bottom. Far signs are written first so near ones win; the shader
 * hides any that nearer geometry covers. Neon mode from the atmosphere dims or flickers them. Far signs
 * (beyond SIGN_TEXT_RANGE) become half-length strips of quadrant glyphs.
 * Returns the number of signs drawn.
 */
export function drawSigns(pass: AsciiShaderPass, camera: THREE.PerspectiveCamera, signs: readonly Sign3[], atm: Atmosphere3, now: number): number {
  pass.clearText();
  const cam = camera.position;
  const visible = signs
    .map((s) => ({ s, d: Math.hypot(s.x - cam.x, s.y - cam.y, s.z - cam.z) }))
    .filter(({ s, d }) => d < SIGN_RANGE && (cam.x - s.x) * s.nx + (cam.z - s.z) * s.nz > 0.3)
    .sort((a, b) => b.d - a.d);
  const flickerFrame = Math.floor(now / 90);
  let drawn = 0;
  for (const { s, d } of visible) {
    v.set(s.x, s.y, s.z).applyMatrix4(camera.matrixWorldInverse);
    const depth = -v.z;
    if (depth < 0.5) continue;
    v.applyMatrix4(camera.projectionMatrix);
    const col = Math.floor((v.x * 0.5 + 0.5) * pass.cols);
    const row = Math.floor((v.y * 0.5 + 0.5) * pass.rows);
    const signId = hash(Math.round(s.x * 10), Math.round(s.z * 10), Math.round(s.y * 10));
    const off = atm.neon === 'off' || (atm.neon === 'flicker' && hash(signId, flickerFrame) % 140 === 0);
    const color = off ? NEON_OFF : s.color;
    const level = off ? 0.45 : 1.0 - 0.45 * (d / SIGN_RANGE);
    const cells = textToCells(s.text);
    let slot = -1;
    if (d > SIGN_TEXT_RANGE) {
      const n = Math.max(1, Math.ceil(cells.length / 2));
      const farLevel = level * 0.85;
      for (let i = 0; i < n; i++) {
        const q = pass.quadSlot(FAR_MASKS[(i + (signId & 1)) % 2]);
        if (s.vertical) pass.putText(col, row - i, q, color, depth, farLevel);
        else pass.putText(col - Math.floor(n / 2) + i, row, q, color, depth, farLevel);
      }
    } else if (s.vertical) {
      let r = row;
      for (let i = 0; i < cells.length; i++) {
        const cp = cells[i];
        if (cp === GLYPH_CONT) continue;
        if (cp === GLYPH_NONE) {
          pass.putText(col, r, BLANK, color, depth, level);
        } else {
          slot = pass.textSlot(String.fromCodePoint(cp)) ?? -1;
          if (slot >= 0) {
            pass.putText(col, r, slot, color, depth, level);
            if (cells[i + 1] === GLYPH_CONT) pass.putText(col + 1, r, slot + 1, color, depth, level);
          }
        }
        r--;
      }
    } else {
      const start = col - Math.floor(cells.length / 2);
      cells.forEach((cp, i) => {
        // Spaces inside a sign are part of its plate: blank, not see-through.
        if (cp === GLYPH_NONE) return pass.putText(start + i, row, BLANK, color, depth, level);
        if (cp === GLYPH_CONT) {
          if (slot >= 0) pass.putText(start + i, row, slot + 1, color, depth, level);
          return;
        }
        slot = pass.textSlot(String.fromCodePoint(cp)) ?? -1;
        if (slot >= 0) pass.putText(start + i, row, slot, color, depth, level);
      });
    }
    drawn++;
  }
  pass.commitText();
  return drawn;
}
