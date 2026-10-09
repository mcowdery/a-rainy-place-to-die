import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANDIDATES, VERDICT_LABELS, VERDICTS } from '../src/poc3d/anims/candidates';

/** The names of a .glb's clips, from its JSON chunk (the first: its length is at byte 12, its text from byte 20). */
function clipsOf(file: string): string[] {
  const glb = readFileSync(file);
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as { animations?: { name: string }[] };
  return (json.animations ?? []).map((a) => a.name);
}

// (The library, and beside it what's under review and not taken by the game.)
const dirs = [resolve(__dirname, '..', 'assets', 'anims'), resolve(__dirname, '..', 'assets', 'anims', 'review')];
const library = new Set(dirs.flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.glb')).flatMap((f) => clipsOf(resolve(dir, f)))));

describe('the clips proposed for the city', () => {
  it('the library is there to check them against', () => {
    expect(library.size).toBeGreaterThan(100);
  });

  it('each has an id of its own that a verdict can be kept by', () => {
    const ids = CANDIDATES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]+$/);
  });

  it('each names clips the library has', () => {
    const missing = CANDIDATES.flatMap((c) => c.parts.filter((p) => !library.has(p.clip)).map((p) => `${c.id}: ${p.clip}`));
    expect(missing).toEqual([]);
  });

  it('each says what it is for, what is there today and what stands against it', () => {
    for (const c of CANDIDATES) {
      expect(c.parts.length, c.id).toBeGreaterThan(0);
      for (const text of [c.title, c.use, c.today, c.notes, c.advice]) expect(text.length, c.id).toBeGreaterThan(5);
    }
  });

  it('a part in the air is ended by the landing, not by a length of its own', () => {
    for (const c of CANDIDATES) for (const p of c.parts) if (p.lift) expect(p.seconds, c.id).toBeUndefined();
  });

  it("each kind's buttons are verdicts, three of them", () => {
    for (const labels of Object.values(VERDICT_LABELS)) {
      expect(Object.keys(labels).length).toBe(3);
      for (const v of Object.keys(labels)) expect(VERDICTS).toContain(v);
    }
  });
});
