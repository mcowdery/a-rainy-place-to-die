import type { Choice, Frame, FrameKey, Hotspot, SceneFile, Target } from '../vn/format';
import { validateScene } from '../vn/format';

/**
 * Uncensored VN overlays: adult/content/vn/<story>/scene.json laid over content/vn/<story>/scene.json.
 *
 *   {
 *     "overlay": 1,
 *     "story": "s12",
 *     "frames": {
 *       "s12.fr05":  { "image": "assets/s12.fr05.jpg", "bubbles": [ ... ], "next": "s12.fr901" },
 *       "s12.fr901": { "image": "assets/s12.fr901.jpg", "bubbles": [ ... ], "next": "s12.fr06" }
 *     }
 *   }
 *
 * A base frame's entry shows it differently: image, video, size, title and bubbles; its choices and hotspots by
 * id, changing only a choice's text and a hotspot's shape, box, points, text and bubble; and, on a frame with no
 * choices or branches, next, to lead into new frames. A new frame (a key the base doesn't have: fr900 and up by
 * convention, so Studio's numbering never meets it) shows pictures and words only (image, video, size, title,
 * bubbles, next), and a run of them must lead back to the base frame's own next. Anything else is an error: the
 * overlay never changes where the story goes, what it sets or needs, or its entry points. Image paths resolve in
 * the overlay's folder first, then the base's.
 *
 * A story whose overlay has any problem plays as standard (the problems are reported), never half-applied.
 */

const SHOWN = ['image', 'video', 'size', 'title', 'bubbles'] as const;
const BASE_FIELDS = new Set<string>([...SHOWN, 'next', 'choices', 'hotspots']);
const NEW_FIELDS = new Set<string>([...SHOWN, 'next']);
const CHOICE_FIELDS = new Set(['id', 'text']);
const HOTSPOT_FIELDS = new Set(['id', 'shape', 'box', 'points', 'text', 'bubble']);

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface OverlaidScenes {
  /** scene.json by story folder, with the overlays applied. */
  readonly scenes: Record<string, unknown>;
  readonly errors: string[];
}

export function applyVnOverlays(base: Readonly<Record<string, unknown>>, overlays: Readonly<Record<string, unknown>>): OverlaidScenes {
  const scenes: Record<string, unknown> = { ...base };
  const errors: string[] = [];
  for (const [folder, raw] of Object.entries(overlays)) {
    const file = `adult/content/vn/${folder}/scene.json`;
    const scene = base[folder] as SceneFile | undefined;
    if (!isObj(scene) || !isObj(scene.frames)) {
      errors.push(`${file}: there's no story content/vn/${folder} to lay it over`);
      continue;
    }
    const merged = overlay(file, scene, raw);
    if (merged.errors.length) errors.push(...merged.errors);
    else scenes[folder] = merged.scene;
  }
  return { scenes, errors };
}

function overlay(file: string, scene: SceneFile, raw: unknown): { scene: SceneFile; errors: string[] } {
  const errors: string[] = [];
  const err = (msg: string): void => void errors.push(`${file}: ${msg}`);
  if (!isObj(raw) || raw.overlay !== 1) return { scene, errors: [`${file}: needs "overlay": 1`] };
  if (raw.story !== scene.story.id) err(`story must be "${scene.story.id}" (got ${JSON.stringify(raw.story)})`);
  if (!isObj(raw.frames)) return { scene, errors: [...errors, `${file}: frames missing`] };

  const frames: Record<FrameKey, Frame> = { ...scene.frames };
  const added = new Map<FrameKey, Frame>();
  // Base frames whose next now leads into new frames, with the next they had.
  const leads: [FrameKey, Target][] = [];
  for (const [key, o] of Object.entries(raw.frames)) {
    if (!isObj(o)) {
      err(`${key}: must be an object`);
      continue;
    }
    const b = scene.frames[key];
    for (const k of Object.keys(o))
      if (!(b ? BASE_FIELDS : NEW_FIELDS).has(k)) err(`${key}: ${k} can't change in the uncensored edition${b ? '' : ' (a new frame shows pictures and words only)'}`);
    const shown = Object.fromEntries(SHOWN.filter((k) => k in o).map((k) => [k, o[k]]));
    if (b) {
      let next = b.next;
      if ('next' in o && o.next !== b.next) {
        if (b.choices.length || b.branches?.length) err(`${key}: next can only lead into new frames on a frame with no choices or branches`);
        else {
          next = (o.next ?? null) as Target;
          leads.push([key, b.next]);
        }
      }
      frames[key] = { ...b, ...shown, next, choices: choices(key, b.choices, o.choices, err), hotspots: hotspots(key, b.hotspots, o.hotspots, err) };
    } else {
      if (!('next' in o)) err(`${key}: a new frame needs next`);
      const f = { entry_point: null, image: null, video: null, size: null, title: '', bubbles: [], on_enter: { set: {} }, next: (o.next ?? null) as Target, choices: [], hotspots: [], ...shown } as Frame;
      added.set(key, f);
      frames[key] = f;
    }
  }

  // Every run of new frames leads back to where its base frame went.
  const reached = new Set<FrameKey>();
  for (const [from, back] of leads) {
    let at = frames[from].next;
    const seen = new Set<FrameKey>();
    while (at !== null && added.has(at) && !seen.has(at)) {
      seen.add(at);
      reached.add(at);
      at = added.get(at)?.next ?? null;
    }
    if (at !== null && seen.has(at)) err(`${from}: its new frames go round in a loop`);
    else if (at !== back) err(`${from}: its new frames lead to ${at ?? 'the end'}, not back to ${back ?? 'the end'} (where ${from} went)`);
  }
  for (const key of added.keys()) if (!reached.has(key)) err(`${key}: nothing leads to this new frame (point a base frame's next at it)`);

  const result: SceneFile = { ...scene, frames };
  errors.push(...validateScene(file, result));
  return { scene: result, errors };
}

function choices(key: string, base: readonly Choice[], o: unknown, err: (m: string) => void): readonly Choice[] {
  if (o === undefined) return base;
  if (!Array.isArray(o)) {
    err(`${key}: choices must be a list`);
    return base;
  }
  const text = new Map<string, string>();
  for (const c of o) {
    if (!isObj(c) || !base.some((x) => x.id === c.id)) {
      err(`${key}: choice ${isObj(c) ? String(c.id) : '?'} isn't one of the frame's (only existing choices, by id)`);
      continue;
    }
    for (const k of Object.keys(c)) if (!CHOICE_FIELDS.has(k)) err(`${key}.${String(c.id)}: only a choice's text can change (not ${k})`);
    if (typeof c.text === 'string') text.set(String(c.id), c.text);
  }
  return base.map((c) => (text.has(c.id) ? { ...c, text: text.get(c.id) ?? c.text } : c));
}

function hotspots(key: string, base: readonly Hotspot[], o: unknown, err: (m: string) => void): readonly Hotspot[] {
  if (o === undefined) return base;
  if (!Array.isArray(o)) {
    err(`${key}: hotspots must be a list`);
    return base;
  }
  const shown = new Map<string, Raw>();
  for (const h of o) {
    if (!isObj(h) || !base.some((x) => x.id === h.id)) {
      err(`${key}: hotspot ${isObj(h) ? String(h.id) : '?'} isn't one of the frame's (only existing hotspots, by id)`);
      continue;
    }
    for (const k of Object.keys(h)) if (!HOTSPOT_FIELDS.has(k)) err(`${key}.${String(h.id)}: only a hotspot's shape, box, points, text and bubble can change (not ${k})`);
    shown.set(String(h.id), h);
  }
  return base.map((h) => (shown.has(h.id) ? ({ ...h, ...shown.get(h.id) } as Hotspot) : h));
}
