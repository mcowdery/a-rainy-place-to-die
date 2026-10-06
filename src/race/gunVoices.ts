/**
 * What the pistol's shot is heard as (race/gunSound.ts): one of the recorded sets in assets/audio/guns (cut by
 * scripts/audio/cut_guns.py from the Free Firearm Sound Library, CC0), or the synthesised report.
 * `9mm`, `45` and `380` are pistols of those calibres; `tokarev` is single shots of a submachine gun in the Type 54's
 * own cartridge, 7.62x25.
 */
export const GUN_VOICES = ['9mm', '45', '380', 'tokarev', 'synth'] as const;
export type GunVoice = (typeof GUN_VOICES)[number];
export const DEFAULT_GUN_VOICE: GunVoice = '9mm';
