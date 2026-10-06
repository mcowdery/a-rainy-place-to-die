/**
 * The three editions, each a separate build (vite.config.ts: `--mode uncensored`, `--mode demo`, else standard),
 * which points the `@edition` alias at standard.ts, uncensored.ts or demo.ts, so a build bundles only its own
 * edition's files:
 *
 * - **standard**: the story, censored (story/style.md, Adult content). Still adult leaning.
 * - **uncensored**: the standard edition plus explicit images and sex scenes, laid over it from `adult/`.
 * - **demo**: the gameplay only, for audiences who want none of it: no story (no scenes, no story chats, no story
 *   nodes to use), and Kaburo's revealing ads left out (demoArt.ts). Driving, racing, the garage, the city.
 *
 * The uncensored edition's files live in `adult/` (git-ignored; its own repository), mirroring the main tree:
 *   adult/content/vn/<story>/scene.json    overlay on content/vn/<story>/ (format in vnOverlay.ts)
 *   adult/content/vn/<story>/assets/*      its stills; a file with a base still's name replaces it
 *   adult/content/phone/<contact>.yaml     overlay on a contact's beats (format in phoneOverlay.ts)
 *   adult/content/phone/media/*            its media; a file with a base file's name replaces it
 *   adult/content/windows/*.json           more scenes for the rooms behind the windows (format in
 *                                          poc3d/real/windowScenes.ts: each file a scene or a list of them)
 * An overlay only changes what's shown, never where the story goes or what it remembers, so both story editions
 * share one story, one set of flags and saves.
 */
export type EditionName = 'standard' | 'uncensored' | 'demo';

/** Story content, by the keys the loaders use. */
export interface StoryFiles {
  /** VN scene.json by story folder. */
  readonly vnScenes: Readonly<Record<string, unknown>>;
  /** VN entry_points.json by story folder. */
  readonly vnEntries: Readonly<Record<string, unknown>>;
  /** VN stills: URL by "<folder>/<path>" ("s12/assets/s12.fr05.jpg"). */
  readonly vnAssets: Readonly<Record<string, string>>;
  /** Phone contacts: YAML text by file name ("mika.yaml"). */
  readonly phoneFiles: Readonly<Record<string, string>>;
  /** Phone media: URL by path as contact files write it ("media/x.jpg"). */
  readonly phoneMedia: Readonly<Record<string, string>>;
}

/** URL by name, from files keyed by path ("…/09_annaijo_girls.jpg" -> "09_annaijo_girls"). */
export const byName = (glob: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(glob).map(([p, url]) => [p.slice(p.lastIndexOf('/') + 1).replace(/\.jpg$/, ''), url]));

/** URL by model name, from glTF files keyed by path ("…/mack_suit_black.glb" -> "mack_suit_black"). */
export const byModel = (glob: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(glob).map(([p, url]) => [p.slice(p.lastIndexOf('/') + 1).replace(/\.glb$/, ''), url]));

export const NO_STORY: StoryFiles = { vnScenes: {}, vnEntries: {}, vnAssets: {}, phoneFiles: {}, phoneMedia: {} };

export interface Edition {
  readonly name: EditionName;
  /** Whether the story is in: its scenes, chats and nodes. False in the demo. */
  readonly narrative: boolean;
  /** Before the district loads: the uncensored edition's age check; the others go straight on. */
  readonly ageGate: () => Promise<void>;
  /** The story content (content/vn, content/phone). */
  readonly story: StoryFiles;
  /** The uncensored overlays on it (empty in the other editions). */
  readonly overlay: StoryFiles;
  /** Kaburo's ad art (assets/ads/kaburo/): URL by name ("09_annaijo_girls"). */
  readonly kaburoArt: Readonly<Record<string, string>>;
  /** The cast's models (assets/characters/*.glb, models/characters.ts): URL by name ("mack_suit_black"). */
  readonly characters: Readonly<Record<string, string>>;
  /**
   * More scenes for the rooms behind the windows (poc3d/real/windowScenes.ts checks and merges them after the
   * built-in ones): each entry one scene object or a list of them. Only the uncensored edition has any.
   */
  readonly windowScenes?: readonly unknown[];
}
