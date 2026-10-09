import type { FlagValue } from '../core/flags';
import type { PhoneSave } from '../phone/engine';
import type { Profile } from '../race/profile';

/**
 * Saved games, in the browser (localStorage `rainyplace.save.<slot>`): the autosave and three manual slots.
 *
 * A save is the shared world (story flags, which hold the time of day and the weather too) and each
 * point-of-view character's own state: where they are (and whether they were driving), their phone, their
 * money and cars. The story will jump between characters (a detective, a salaryman, the CEO...), each with a
 * home; for now there is one, the MC. Loading reopens the city from the save (`district.html?load=<slot>`).
 */

export const SAVE_VERSION = 1;
export const SLOTS = ['auto', '1', '2', '3'] as const;
export type Slot = (typeof SLOTS)[number];

export interface CharacterSave {
  readonly id: string;
  readonly name: string;
  /** Where they stand (the walker's eye) and look (degrees), and on which floor level. */
  readonly at: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly pitch: number };
  /** Behind the wheel of their own car when saved (it's put back where it was, and they're back in it). */
  readonly driving: boolean;
  /** Their car in the city: where it stands (district/ownCar.ts's own record). */
  readonly car: { readonly x: number; readonly z: number; readonly h: number; readonly y?: number } | null;
  readonly phone: PhoneSave | null;
  /** Money and cars (race/profile.ts). */
  readonly profile: Profile | null;
}

export interface SaveGame {
  readonly v: typeof SAVE_VERSION;
  readonly savedAt: string;
  /** Where it was saved, for the list (the district and place name). */
  readonly place: string;
  /** Seconds played. */
  readonly played: number;
  /** Whose story it was when saved. */
  readonly current: string;
  readonly world: { readonly flags: Readonly<Record<string, FlagValue>> };
  readonly characters: Readonly<Record<string, CharacterSave>>;
}

const key = (slot: Slot): string => `rainyplace.save.${slot}`;

/** A save read back, or null if there's none or it isn't one this version can load. */
export function parseSave(text: string | null): SaveGame | null {
  if (!text) return null;
  try {
    const s = JSON.parse(text) as SaveGame;
    if (s?.v !== SAVE_VERSION || typeof s.current !== 'string' || !s.characters?.[s.current] || typeof s.world?.flags !== 'object') return null;
    const at = s.characters[s.current].at;
    if (![at?.x, at?.y, at?.z, at?.yaw, at?.pitch].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    return s;
  } catch {
    return null;
  }
}

export function readSave(slot: Slot): SaveGame | null {
  try {
    return parseSave(localStorage.getItem(key(slot)));
  } catch {
    return null;
  }
}

/** Writes a save; false if the browser won't keep it (storage blocked or full). */
export function writeSave(slot: Slot, s: SaveGame): boolean {
  try {
    localStorage.setItem(key(slot), JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function deleteSave(slot: Slot): void {
  try {
    localStorage.removeItem(key(slot));
  } catch {
    /* nothing to delete */
  }
}

/** Every slot and what's in it. */
export const listSaves = (): { slot: Slot; save: SaveGame | null }[] => SLOTS.map((slot) => ({ slot, save: readSave(slot) }));
