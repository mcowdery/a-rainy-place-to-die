import YAML from 'yaml';
import { type Beat, type Contact, parseContact } from '../phone/format';

/**
 * Uncensored phone overlays: adult/content/phone/<contact>.yaml laid over the contact with that id.
 *
 *   id: mika                       # the base contact's id
 *   avatar: media/mika_avatar.jpg  # optional: another avatar
 *   beats:
 *     - id: late                   # a beat the base contact has
 *       messages: [ ... ]          # optional: what they send instead (same message syntax)
 *       replies:                   # optional: one per base reply, in order; text and then only
 *         - text: ...
 *           then: [ ... ]
 *
 * Only what's shown changes: a beat's when, after and set, and a reply's set, stay the base's (giving them is
 * an error), so both editions share the story's flags. Media paths look in adult/content/phone/ first, then
 * content/phone/. A contact whose overlay has any problem plays as standard (the problems are reported).
 */

const TOP = new Set(['id', 'avatar', 'beats']);
const BEAT = new Set(['id', 'messages', 'replies']);
const REPLY = new Set(['text', 'then']);

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

export function applyPhoneOverlays(
  contacts: readonly Contact[],
  files: Readonly<Record<string, string>>,
  hasMedia: (path: string) => boolean,
): { contacts: Contact[]; errors: string[] } {
  const out = [...contacts];
  const errors: string[] = [];
  for (const [name, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const file = `adult/content/phone/${name}`;
    const errs: string[] = [];
    const err = (msg: string): void => void errs.push(`${file}: ${msg}`);
    const o = parseContact(file, text, errs, hasMedia, true);
    const raw = (() => {
      try {
        return YAML.parse(text) as unknown;
      } catch {
        return null;
      }
    })();
    const at = o ? out.findIndex((c) => c.id === o.id) : -1;
    if (o && at < 0) err(`there's no contact ${o.id} to lay it over`);
    if (!o || at < 0 || !isObj(raw)) {
      errors.push(...errs);
      continue;
    }
    for (const k of Object.keys(raw)) if (!TOP.has(k)) err(`${k} can't change in the uncensored edition`);
    const base = out[at];
    const rawBeats = (Array.isArray(raw.beats) ? raw.beats : []) as unknown[];
    const beats = new Map<string, Beat>();
    for (const [i, ob] of o.beats.entries()) {
      const rb = isObj(rawBeats[i]) ? rawBeats[i] : {};
      const b = base.beats.find((x) => x.id === ob.id);
      if (!b) {
        err(`beat ${ob.id}: the contact has no such beat`);
        continue;
      }
      for (const k of Object.keys(rb)) if (!BEAT.has(k)) err(`beat ${ob.id}: ${k} can't change in the uncensored edition`);
      let replies = b.replies;
      if ('replies' in rb) {
        const rr = (Array.isArray(rb.replies) ? rb.replies : []) as unknown[];
        if (ob.replies.length !== b.replies.length) err(`beat ${ob.id}: give all ${b.replies.length} replies, in the base's order`);
        for (const [j, r] of rr.entries()) for (const k of Object.keys(isObj(r) ? r : {})) if (!REPLY.has(k)) err(`beat ${ob.id} replies[${j}]: only text and then can change (not ${k})`);
        replies = b.replies.map((r, j) => {
          const or = ob.replies[j];
          const has = isObj(rr[j]) && 'then' in (rr[j] as Raw);
          return or ? { ...r, text: or.text, then: has ? or.then : r.then } : r;
        });
      }
      beats.set(b.id, { ...b, messages: 'messages' in rb ? ob.messages : b.messages, replies });
    }
    if (errs.length) {
      errors.push(...errs);
      continue;
    }
    out[at] = { ...base, avatar: 'avatar' in raw ? o.avatar : base.avatar, beats: base.beats.map((b) => beats.get(b.id) ?? b) };
  }
  return { contacts: out, errors };
}
