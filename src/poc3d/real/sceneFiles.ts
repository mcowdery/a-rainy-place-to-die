import { isBare } from '../district/peopleMix';
import { checkScene, isVice, SCENES, whoOf, type Fig, type Scene } from './windowScenes';

/**
 * Where the scene editor (showroom/scenes.ts) may write a scene, decided here and nowhere else: the dev server's
 * `/__scene` handler (scripts/debugShots.mjs) asks this before it writes or deletes anything, and the tests hold it
 * to it. Pure: no file system.
 *
 * Two folders, one file a scene, named by the scene's id:
 *   content/world3d/windows/<id>.json   in the repository, for every edition: an edited copy of a built-in scene
 *                                       (it replaces the one of that id) or a new standard-edition scene;
 *   adult/content/windows/<id>.json     the uncensored edition's own (git-ignored): only scenes marked `adult`,
 *                                       its own or its version of a built-in scene (it replaces the one of that
 *                                       id in that edition only; the others keep the built-in scene).
 * A scene that is `adult`, or has anyone nude in it, may only go to adult/. Nothing else is ever written, and the
 * only thing ever deleted is an override (an edited copy of a built-in scene, in either folder), on an explicit
 * revert: never a scene that is a folder's own.
 */
export const SCENE_FOLDERS = { content: 'content/world3d/windows', adult: 'adult/content/windows' } as const;
export type ScenePlace = keyof typeof SCENE_FOLDERS;
/** A scene id that can be a file name: lower-case letters, digits and _, starting with a letter, 2 to 48 long. */
export const SCENE_ID = /^[a-z][a-z0-9_]{1,47}$/;

export interface SceneFilePlan {
  readonly folder: (typeof SCENE_FOLDERS)[ScenePlace];
  /** The file's name in that folder: `<id>.json`, nothing else. */
  readonly name: string;
}

const figsOf = (s: Scene): Fig[] => [...s.a, ...(s.b ?? []), ...(s.deep ?? []), ...(s.frames ?? []).flatMap((f) => f.a)];
/** Whether a scene can only live in the uncensored edition's folder. */
export const adultOnly = (s: Scene): boolean => s.adult === true || figsOf(s).some((f) => isBare(whoOf(f.who)?.outfit));

/** Where a scene would be saved, or why it can't be. */
export function sceneFileFor(scene: unknown, place: unknown): SceneFilePlan | { readonly error: string } {
  if (place !== 'content' && place !== 'adult') return { error: 'a scene is saved to content or adult' };
  const id = (scene as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || !SCENE_ID.test(id)) return { error: 'the id must be lower-case letters, digits and _, starting with a letter (2 to 48 characters)' };
  const errors: string[] = [];
  if (!checkScene(scene, errors)) return { error: errors.join('; ') };
  if (place === 'content' && adultOnly(scene)) return { error: 'an adult scene (or one with anyone nude) is saved to adult/, not to the repository' };
  if (place === 'adult' && scene.adult !== true) return { error: 'a scene saved to adult/ must be marked adult' };
  return { folder: SCENE_FOLDERS[place], name: `${id}.json` };
}

/** Whether an id is a built-in scene's (so a file of that id is an edited copy of it, not a scene of its own). */
export const isBuiltIn = (id: unknown): boolean => SCENES.some((s) => s.id === id);

/**
 * Where a scene in hand is saved: a built-in scene's edited copy to the repository, or, once it's adult (marked so,
 * or anyone in it nude), to adult/ as the uncensored edition's own version of it. `from` is where it is now: one
 * already in adult/ stays there, and a scene that is a folder's own keeps its folder.
 */
export function placeFor(scene: Scene, from: 'builtin' | ScenePlace): ScenePlace {
  if (from === 'adult') return 'adult';
  if (!isBuiltIn(scene.id)) return from === 'builtin' ? 'content' : from;
  return adultOnly(scene) ? 'adult' : 'content';
}

/** Which override a revert would delete, or why not: content/'s, or (place 'adult') adult/'s copy of a built-in scene. */
export function sceneRevertFor(id: unknown, place: unknown = 'content'): SceneFilePlan | { readonly error: string } {
  if (typeof id !== 'string' || !SCENE_ID.test(id)) return { error: 'the id must be lower-case letters, digits and _' };
  if (place !== 'content' && place !== 'adult') return { error: 'an override is in content or adult' };
  // (adult/ also holds the edition's own scenes: only an edited copy of a built-in scene is ever deleted there.)
  if (place === 'adult' && !isBuiltIn(id)) return { error: `'${id}' is not a built-in scene: its file in adult/ is the scene itself, not an edited copy` };
  return { folder: SCENE_FOLDERS[place], name: `${id}.json` };
}

/**
 * Whether `file` (an absolute path, already resolved) is a .json directly inside `dir` (an absolute path): the last
 * check before a write, after the plan's name has been joined on.
 */
export function insideFolder(dir: string, file: string, sep: string): boolean {
  if (!file.startsWith(dir + sep)) return false;
  const rest = file.slice(dir.length + sep.length);
  return /^[a-z][a-z0-9_]{1,47}\.json$/.test(rest);
}

/** A scene as its file holds it: two-space JSON and a final newline (so a scene loaded and saved unchanged is the same bytes). */
export const sceneText = (scene: unknown): string => `${JSON.stringify(scene, null, 2)}\n`;

/** Whether a scene is in a vice room or adult: the cast it may have is adults in adult clothes only. */
export const strictCast = (s: { adult?: unknown; cat?: unknown }): boolean => s.adult === true || (typeof s.cat === 'string' ? [s.cat] : Array.isArray(s.cat) ? s.cat : []).some((c) => typeof c === 'string' && isVice(c));
