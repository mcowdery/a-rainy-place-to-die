/**
 * The two editions (story/style.md, Adult content): **standard** (censored) and **uncensored** (explicit
 * images and sex scenes). They're separate builds: `vite --mode uncensored` / `vite build --mode uncensored`
 * point the `@edition` alias (vite.config.ts) at uncensored.ts, everything else at standard.ts, so the standard
 * build never reads the explicit files at all.
 *
 * The uncensored edition's files live in `adult/` (git-ignored; its own repository), mirroring the main tree:
 *   adult/content/vn/<story>/scene.json    overlay on content/vn/<story>/ (format in vnOverlay.ts)
 *   adult/content/vn/<story>/assets/*      its stills; a file with a base still's name replaces it
 *   adult/content/phone/<contact>.yaml     overlay on a contact's beats (format in phoneOverlay.ts)
 *   adult/content/phone/media/*            its media; a file with a base file's name replaces it
 * An overlay only changes what's shown, never where the story goes or what it remembers, so both editions share
 * one story, one set of flags and saves.
 */
export type EditionName = 'standard' | 'uncensored';

export interface Edition {
  readonly name: EditionName;
  /** Before the district loads: the uncensored edition's age check; the standard edition goes straight on. */
  readonly ageGate: () => Promise<void>;
  /** VN overlays: scene.json by story folder. */
  readonly vnScenes: Readonly<Record<string, unknown>>;
  /** VN overlay assets: URL by "<folder>/<path>" ("s12/assets/s12.fr05.jpg"). */
  readonly vnAssets: Readonly<Record<string, string>>;
  /** Phone overlays: YAML text by file name ("mika.yaml"). */
  readonly phoneFiles: Readonly<Record<string, string>>;
  /** Phone overlay media: URL by path as contact files write it ("media/x.jpg"). */
  readonly phoneMedia: Readonly<Record<string, string>>;
}
