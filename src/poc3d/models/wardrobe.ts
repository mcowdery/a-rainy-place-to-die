import type * as THREE from 'three';
import { CHARACTERS } from './characters';
import { FirstPersonRig } from './firstPerson';
import { FACE_STYLES, type FaceStyle } from './faceShadow';
import { HELMET_LOOKS, type HelmetLook } from './helmet';
import { GLASSES_KINDS, type GlassesKind } from './sunglasses';
import type { Footwear } from '../district/footing';

/**
 * Mack's wardrobe: what he's wearing (an outfit is a model of its own, built from his definition with other clothes:
 * scripts/blender/characters/mack_*.json, `base: mack.json`) and his sunglasses (models/sunglasses.ts, worn on the
 * head bone, any outfit). Kept in the browser for now (localStorage `rainyplace.wardrobe`); how he gets clothes in
 * play (shops, homes, the story) is still to come.
 */

export interface Outfit {
  readonly id: string;
  /** Its model (assets/characters/<model>.glb). */
  readonly model: string;
  readonly label: string;
  readonly about: string;
  /** Worn only when the story puts him in it (not a choice in play). */
  readonly story?: boolean;
  /** What's on his feet (district/footing.ts): how his steps sound. */
  readonly feet: Footwear;
}

export const OUTFITS: readonly Outfit[] = [
  { id: 'leathers', model: 'mack', label: 'Leathers', about: "The bōsōzoku leader's rider jacket, a black tee, dark jeans and boots: what he took the night he arrived.", feet: 'boots' },
  { id: 'leathers_hapa', model: 'mack_hapa', label: 'Leathers · half-Japanese (trial)', about: 'A trial of his look: half Japanese (scripts/blender/characters/mack_hapa.json), in his leathers.', feet: 'boots' },
  { id: 'suit_black', model: 'mack_suit_black', label: 'Black suit', about: 'Black suit, white shirt, black tie: funerals, yakuza meetings.', feet: 'shoes' },
  { id: 'suit_charcoal', model: 'mack_suit_charcoal', label: 'Charcoal suit', about: "Charcoal, white shirt, a dark wine tie: the everyday detective, lost in Asagiri's office crowds.", feet: 'shoes' },
  { id: 'suit_navy', model: 'mack_suit_navy', label: 'Navy suit', about: 'Navy, pale blue shirt, a mustard tie: the city-pop businessman.', feet: 'shoes' },
  { id: 'suit_cream', model: 'mack_suit_cream', label: 'Cream suit', about: 'Cream, black shirt, a red tie: bubble-era money, for Host Street and Club Shirasagi.', feet: 'shoes' },
  { id: 'nude', model: 'mack_nude', label: 'Nothing', about: 'The arrival (The Terminator): naked in the rain at a konbini car park.', story: true, feet: 'bare' },
];

/** The outfits this edition has (the demo has no nude: src/edition). */
export const availableOutfits = (): Outfit[] => OUTFITS.filter((o) => CHARACTERS.includes(o.model));

export const outfitById = (id: string): Outfit => availableOutfits().find((o) => o.id === id) ?? OUTFITS[0];

/** The next outfit round (the story-only ones included when `all`). */
export function nextOutfit(id: string, all = true): Outfit {
  const list = availableOutfits().filter((o) => all || !o.story);
  return list[(list.findIndex((o) => o.id === id) + 1) % list.length] ?? OUTFITS[0];
}

/** No glasses, then each kind in turn. */
export function nextGlasses(kind: GlassesKind | null): GlassesKind | null {
  const all: (GlassesKind | null)[] = [null, ...GLASSES_KINDS];
  return all[(all.indexOf(kind) + 1) % all.length];
}

export const GLASSES_LABELS: Record<GlassesKind, string> = { wrap: 'wraparounds', aviator: 'aviators', slim: 'slim 90s' };

export interface WardrobeState {
  outfit: string;
  glasses: GlassesKind | null;
  /** How his face is hidden (models/faceShadow.ts), under review. */
  face: FaceStyle;
  /** His motorcycle helmet worn on foot too (models/helmet.ts), or none. */
  helmet: HelmetName | null;
}

export type HelmetName = keyof typeof HELMET_LOOKS;
export const HELMET_NAMES = Object.keys(HELMET_LOOKS) as HelmetName[];
export const HELMET_LABELS: Record<HelmetName, string> = { black: 'black helmet', redblack: 'red and black helmet' };
export const helmetLook = (h: HelmetName | null): HelmetLook | null => (h ? HELMET_LOOKS[h] : null);

/** No helmet, then each in turn. */
export function nextHelmet(h: HelmetName | null): HelmetName | null {
  const all: (HelmetName | null)[] = [null, ...HELMET_NAMES];
  return all[(all.indexOf(h) + 1) % all.length];
}

/** The next face style round. */
export const nextFace = (f: FaceStyle): FaceStyle => FACE_STYLES[(FACE_STYLES.indexOf(f) + 1) % FACE_STYLES.length];

const KEY = 'rainyplace.wardrobe';

export function loadWardrobe(): WardrobeState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<WardrobeState> | null;
    const glasses = s?.glasses && (GLASSES_KINDS as readonly string[]).includes(s.glasses) ? s.glasses : null;
    const face = s?.face && FACE_STYLES.includes(s.face) ? s.face : 'shadow';
    const helmet = s?.helmet && (HELMET_NAMES as string[]).includes(s.helmet) ? s.helmet : null;
    return { outfit: outfitById(s?.outfit ?? 'leathers').id, glasses, face, helmet };
  } catch {
    return { outfit: 'leathers', glasses: null, face: 'shadow', helmet: null };
  }
}

/** Mack's body (models/firstPerson.ts) in what he's wearing: the outfit's model, his sunglasses on, his face hidden
 * as chosen. */
export async function loadDressed(env: THREE.Texture | null = null, w: WardrobeState = loadWardrobe()): Promise<FirstPersonRig> {
  const rig = await FirstPersonRig.load(outfitById(w.outfit).model, env);
  rig.setGlasses(w.glasses);
  rig.setFaceStyle(w.face);
  rig.wearHelmet(helmetLook(w.helmet));
  return rig;
}

export function saveWardrobe(s: WardrobeState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* no storage */
  }
}
