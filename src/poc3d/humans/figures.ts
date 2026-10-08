import { byModel } from '../../edition/types';
import { CHARACTERS, registerCharacters } from '../models/characters';
import type { MobModelDoc } from '../real/mobModels';
import type { Body } from '../real/mobRig';

/**
 * The MakeHuman figures of the test page (humans.html), by family. Each can exist two ways:
 *
 * - **textured**, as it was built: a skinned glTF on the cast's rig, the look of the salaryman and the maid. The
 *   cast's own are assets/characters/ (models/characters.ts); the crowd's are assets/humans/<name>.glb, built by
 *   scripts/blender/human_figures.py from the list in scripts/blender/mob_figures.json and registered here so
 *   `Character.load(name)` and `Thug.load(name)` find them. Five more there are made by hand
 *   (scripts/blender/human_bijin.py): women to judge MakeHuman by as side characters.
 * - **converted** for the mob's material (assets/mob/<name>.json, scripts/blender/mob_figures.py: the face blanked,
 *   ~3,200 triangles, the mob's skeleton), drawn in the mob's colours or all black. Loaded only when asked for.
 */

interface Listed {
  readonly name: string;
  readonly mob: Body;
  readonly body: { readonly gender?: number; readonly years?: number };
  readonly clothes?: readonly string[];
}

export interface Human {
  readonly name: string;
  /** What its label says (the name without its family's prefix). */
  readonly label: string;
  readonly male: boolean;
  readonly years: number;
  /** Which of the mob's bodies it stands for. */
  readonly body: Body;
  /** A textured model of it exists. */
  readonly textured: boolean;
  /** A conversion for the mob's material exists. */
  readonly converted: boolean;
  /** Standing height in metres, where a close-up of the face needs it. */
  readonly height?: number;
}

export interface Family {
  readonly key: string;
  readonly title: string;
  readonly humans: readonly Human[];
}

const LIST = Object.values(import.meta.glob('/scripts/blender/mob_figures.json', { eager: true, import: 'default' }) as Record<string, { figures: Listed[] }>)[0]?.figures ?? [];
const TEXTURED = byModel(import.meta.glob('/assets/humans/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>);
registerCharacters(TEXTURED);
const CONVERTED = import.meta.glob('/assets/mob/*.json', { import: 'default' }) as Record<string, () => Promise<MobModelDoc>>;
const convertedPath = (name: string): string => `/assets/mob/${name}.json`;

/** The story characters that are here to be tried as passers-by and enemies (Mack is the player: he stays in the model showroom). */
const CAST: readonly [string, boolean, number][] = [['salaryman', true, 38], ['maid', false, 21], ['julie', false, 22]];

/** The women made by hand (scripts/blender/human_bijin.py): name, age, height in metres. */
const BIJIN: readonly [string, number, number][] = [['bijin_office', 26, 1.6], ['bijin_club', 28, 1.64], ['bijin_casual', 21, 1.57], ['bijin_elegant', 33, 1.66], ['bijin_ponytail', 23, 1.62]];

const TITLES: Record<string, string> = { mw: 'women', mm: 'men', ms: 'students', mk: 'children', mhbody: "body types (the mob's looks only)" };

function listed(prefix: string): Human[] {
  return LIST.filter((f) => f.name.split('_')[0] === prefix)
    .map((f) => ({
      name: f.name,
      label: f.name.slice(prefix.length + 1),
      male: (f.body.gender ?? 1) >= 0.5,
      years: f.body.years ?? 30,
      body: f.mob,
      textured: f.name in TEXTURED,
      converted: convertedPath(f.name) in CONVERTED,
    }))
    .filter((h) => h.textured || h.converted);
}

export const FAMILIES: readonly Family[] = [
  {
    key: 'cast',
    title: 'the cast',
    humans: CAST.filter(([name]) => CHARACTERS.includes(name)).map(([name, male, years]): Human => ({ name, label: name, male, years, body: male ? 'man' : 'woman', textured: true, converted: false })),
  },
  {
    key: 'bijin',
    title: 'women made by hand',
    humans: BIJIN.filter(([name]) => name in TEXTURED).map(([name, years, height]): Human => ({ name, label: name.slice('bijin_'.length), male: false, years, body: 'woman', textured: true, converted: false, height })),
  },
  ...Object.keys(TITLES).map((key) => ({ key, title: TITLES[key], humans: listed(key) })),
].filter((f) => f.humans.length > 0);

/** Everyone dressed for the street: the generated crowd. */
export const CROWD: readonly Human[] = FAMILIES.filter((f) => ['mw', 'mm', 'ms', 'mk'].includes(f.key)).flatMap((f) => f.humans);

/** The converted figures, loaded (once) for the mob's material. */
let docs: Promise<MobModelDoc[]> | null = null;
export function convertedDocs(): Promise<MobModelDoc[]> {
  docs ??= Promise.all(
    FAMILIES.flatMap((f) => f.humans)
      .filter((h) => h.converted)
      .map((h) => CONVERTED[convertedPath(h.name)]()),
  );
  return docs;
}

/** A list in another order, the same for the same seed. */
export function shuffled<T>(list: readonly T[], seed: number): T[] {
  const out = [...list];
  let s = (seed * 9301 + 49297) % 233280;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
