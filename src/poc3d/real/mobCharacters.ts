import type { Outfit } from '../district/peopleMix';
import { buildShaped, setFigureShape, type FigureShape } from './mobShape';
import { registerMobTemplate, type Body, type Hair } from './people';

/**
 * Named characters built on the mob's sculpted bodies (real/mobShape.ts): the main side characters, a kind of
 * person between the crowd and the modelled cast (models/characters.ts). Each starts from a body with a hair and an
 * outfit and says what is its own: its proportions (`FigureShape`: height, bust, hips), and in time more detail than
 * the crowd has (hands, feet, the back) and hair, clothes and textures of its own. Faceless, as the mob is.
 *
 * They are registered as figures of their own beside the crowd's templates (`registerMobTemplate`: a template and a
 * body each in the mob's material, so one material poses and animates them with everyone else) and drawn by name:
 * `FigureSpec.model`. The crowd never picks one. Reviewed in characters.html before they go into the district.
 */
export interface CharacterDef {
  /** Its name as a figure (`FigureSpec.model`). */
  readonly name: string;
  readonly title: string;
  readonly body: Body;
  readonly hair: Hair;
  readonly outfit: Outfit;
  /** The figure's tint (as a crowd figure's colour). */
  readonly color: readonly [number, number, number];
  readonly shape: FigureShape;
}

export const CHARACTERS: readonly CharacterDef[] = [
  // Koharu (the follower's stand-in was a crowd woman in a long skirt): her proportions here are a first guess, to
  // be set by the user.
  { name: 'koharu', title: 'Koharu', body: 'woman', hair: 'long', outfit: 'long', color: [0.05, 0.02, 0.026], shape: { height: 0.96, bust: 0.85, hips: 0.97, detail: true } },
  // (Her body with nothing on: what the detail is worked out on. Only ever for scenes marked adult, as the crowd's bare body is.)
  { name: 'koharu_bare', title: 'Koharu, nothing on', body: 'woman', hair: 'long', outfit: 'nude', color: [0.05, 0.02, 0.026], shape: { height: 0.96, bust: 0.85, hips: 0.97, detail: true } },
  { name: 'koharu_bare_up', title: 'Koharu, nothing on, her hair up (to see her back)', body: 'woman', hair: 'bun', outfit: 'nude', color: [0.05, 0.02, 0.026], shape: { height: 0.96, bust: 0.85, hips: 0.97, detail: true } },
];

/** One of them built another way, as a figure of its own (the characters' page, to choose between ways). */
export function registerVariant(name: string, of: string, shape: FigureShape): void {
  const c = CHARACTERS.find((q) => q.name === of);
  if (!c) throw new Error(`no character ${of}`);
  setFigureShape({ ...c.shape, ...shape });
  try {
    registerMobTemplate(name, buildShaped(c.body, c.hair, c.outfit));
  } finally {
    setFigureShape(null);
  }
}

/** Builds and registers them (once; before any figure names one). */
export function registerCharacters(): void {
  for (const c of CHARACTERS) {
    setFigureShape(c.shape);
    try {
      registerMobTemplate(c.name, buildShaped(c.body, c.hair, c.outfit));
    } finally {
      setFigureShape(null);
    }
  }
}
