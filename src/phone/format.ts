import YAML from 'yaml';
import { compileCondition, type Condition } from '../core/condition';

/**
 * Phone conversations (the KAIWA messenger), one file per contact in content/phone/<contact>.yaml:
 *
 *   id: mama                          # [a-z0-9_], stable (the phone's state is keyed by it)
 *   name: Mama-san                    # shown in the chat list and the thread header
 *   avatar: media/mama_avatar.jpg     # optional (else the name's initial); media/ is content/phone/media/
 *   status: スナックかんぱい 18:00-02:00  # optional, under the name
 *   beats:                            # bits of conversation, each arriving when its condition first holds
 *     - id: rain                      # [a-z0-9_], unique in the file, stable
 *       when: met_mama                # a condition on story flags (node condition syntax); omitted = from the start
 *       after: 40                     # seconds after `when` first holds (default 0)
 *       messages:                     # from the contact, one at a time with typing; `from: me` for yours
 *         - text: It's coming down harder.
 *         - photo: media/bar.jpg      # or video: media/clip.webm (poster: optional still); caption: optional
 *         - sticker: 🍶               # a big emoji
 *       replies:                      # optional: you pick one (1-4 in the phone); it's sent as your message
 *         - text: On my way.
 *           set: { mama_invited: true }   # story flags (true/false)
 *           then: [ { text: I'll keep the kettle on. } ]
 *       set: { mama_texted: true }    # flags set when the beat's done (after a reply, if it has replies)
 *
 * A beat with only replies is you writing first. A contact's beats play one at a time, in file order among
 * those ready; a beat waiting for your reply holds back the ones after it. Validation collects every problem.
 */

export type MsgBody =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'photo'; readonly media: string; readonly caption: string | null }
  | { readonly kind: 'video'; readonly media: string; readonly poster: string | null; readonly caption: string | null }
  | { readonly kind: 'sticker'; readonly text: string };

export interface ScriptMsg {
  readonly from: 'them' | 'me';
  readonly body: MsgBody;
}

export interface Reply {
  readonly text: string;
  readonly set: Readonly<Record<string, boolean>>;
  readonly then: readonly ScriptMsg[];
}

export interface Beat {
  readonly id: string;
  readonly when: Condition | null;
  readonly after: number;
  readonly messages: readonly ScriptMsg[];
  readonly replies: readonly Reply[];
  readonly set: Readonly<Record<string, boolean>>;
}

export interface Contact {
  readonly id: string;
  readonly name: string;
  readonly avatar: string | null;
  readonly status: string | null;
  readonly beats: readonly Beat[];
}

const ID = /^[a-z0-9_]+$/;
const FLAG = /^[a-z0-9_.]{1,64}$/;
type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parse one contact file; problems go to `errors` (file: message). hasMedia checks a media path exists. An
 * uncensored overlay (src/edition/phoneOverlay.ts) is parsed the same way but needs no name.
 */
export function parseContact(file: string, text: string, errors: string[], hasMedia: (path: string) => boolean, overlay = false): Contact | null {
  const before = errors.length;
  const err = (msg: string): void => void errors.push(`${file}: ${msg}`);
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return null;
  }
  if (!isObj(doc)) {
    err('expected a mapping');
    return null;
  }
  const id = String(doc.id ?? '');
  if (!ID.test(id)) err(`id must match [a-z0-9_]+ (got "${id}")`);
  if (!overlay && (typeof doc.name !== 'string' || !doc.name)) err('name is required');
  const media = (where: string, v: unknown): string | null => {
    if (v === undefined || v === null) return null;
    const p = String(v);
    if (!hasMedia(p)) err(`${where}: no such file content/phone/${p}`);
    return p;
  };
  const flags = (where: string, v: unknown): Record<string, boolean> => {
    if (v === undefined) return {};
    if (!isObj(v)) {
      err(`${where}: set must be a mapping of flag: true/false`);
      return {};
    }
    for (const [k, b] of Object.entries(v)) {
      if (!FLAG.test(k)) err(`${where}: bad flag name ${k}`);
      if (typeof b !== 'boolean') err(`${where}: flag ${k} must be true or false`);
    }
    return v as Record<string, boolean>;
  };
  const msgs = (where: string, v: unknown): ScriptMsg[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      err(`${where}: must be a list of messages`);
      return [];
    }
    return v.flatMap((m, i): ScriptMsg[] => {
      const at = `${where}[${i}]`;
      if (!isObj(m)) {
        err(`${at}: a message is a mapping (text / photo / video / sticker)`);
        return [];
      }
      const from = m.from === undefined || m.from === 'them' ? 'them' : m.from === 'me' ? 'me' : null;
      if (!from) err(`${at}: from must be them or me`);
      const kinds = ['text', 'photo', 'video', 'sticker'].filter((k) => m[k] !== undefined);
      if (kinds.length !== 1) {
        err(`${at}: needs exactly one of text, photo, video, sticker`);
        return [];
      }
      const caption = m.caption === undefined ? null : String(m.caption);
      let body: MsgBody;
      switch (kinds[0]) {
        case 'text':
          body = { kind: 'text', text: String(m.text) };
          break;
        case 'sticker':
          body = { kind: 'sticker', text: String(m.sticker) };
          break;
        case 'photo':
          body = { kind: 'photo', media: media(at, m.photo) ?? '', caption };
          break;
        default:
          body = { kind: 'video', media: media(at, m.video) ?? '', poster: media(`${at} poster`, m.poster), caption };
      }
      return [{ from: from ?? 'them', body }];
    });
  };
  const beats: Beat[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(doc.beats) || doc.beats.length === 0) err('beats: needs at least one');
  for (const [i, rb] of (Array.isArray(doc.beats) ? doc.beats : []).entries()) {
    if (!isObj(rb)) {
      err(`beats[${i}]: must be a mapping`);
      continue;
    }
    const bid = String(rb.id ?? '');
    const at = `beat ${bid || i}`;
    if (!ID.test(bid)) err(`beats[${i}]: id must match [a-z0-9_]+`);
    else if (seen.has(bid)) err(`${at}: id used twice`);
    seen.add(bid);
    let when: Condition | null = null;
    if (rb.when !== undefined) {
      try {
        when = compileCondition(String(rb.when));
      } catch (e) {
        err(`${at}: when: ${(e as Error).message}`);
      }
    }
    const after = rb.after === undefined ? 0 : Number(rb.after);
    if (!Number.isFinite(after) || after < 0) err(`${at}: after must be seconds >= 0`);
    const replies: Reply[] = [];
    if (rb.replies !== undefined) {
      if (!Array.isArray(rb.replies) || rb.replies.length === 0 || rb.replies.length > 4) err(`${at}: replies must be a list of 1-4`);
      else
        for (const [j, rr] of rb.replies.entries()) {
          if (!isObj(rr) || typeof rr.text !== 'string' || !rr.text) {
            err(`${at}: replies[${j}] needs text`);
            continue;
          }
          replies.push({ text: rr.text, set: flags(`${at} replies[${j}]`, rr.set), then: msgs(`${at} replies[${j}].then`, rr.then) });
        }
    }
    const messages = msgs(`${at} messages`, rb.messages);
    if (messages.length === 0 && replies.length === 0) err(`${at}: needs messages or replies`);
    beats.push({ id: bid, when, after: Number.isFinite(after) ? after : 0, messages, replies, set: flags(`${at}`, rb.set) });
  }
  if (errors.length > before) return null;
  return {
    id,
    name: String(doc.name ?? ''),
    avatar: media('avatar', doc.avatar),
    status: doc.status === undefined ? null : String(doc.status),
    beats,
  };
}
