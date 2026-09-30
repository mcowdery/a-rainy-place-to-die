import { edition } from '@edition';
import { applyPhoneOverlays } from '../edition/phoneOverlay';
import { type Contact, parseContact } from './format';

/**
 * The phone's contacts (content/phone/*.yaml) and their media (content/phone/media/), bundled by Vite. The uncensored
 * edition lays its overlays (adult/content/phone/, src/edition/phoneOverlay.ts) over them; its media come first.
 */
const files = import.meta.glob('../../content/phone/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const media = import.meta.glob('../../content/phone/media/*', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const mediaKey = (p: string): string => `../../content/phone/${p}`;

export interface PhoneContent {
  readonly contacts: Contact[];
  readonly errors: string[];
  /** A media path from a contact file ("media/x.jpg") to its URL. */
  url(path: string): string;
}

export function loadPhoneContent(): PhoneContent {
  const errors: string[] = [];
  const contacts: Contact[] = [];
  const ids = new Set<string>();
  for (const [path, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const file = path.replace(/^(\.\.\/)+/, '');
    const c = parseContact(file, text, errors, (p) => mediaKey(p) in media);
    if (!c) continue;
    if (ids.has(c.id)) errors.push(`${file}: contact id ${c.id} is used by another file`);
    ids.add(c.id);
    contacts.push(c);
  }
  const overlaid = applyPhoneOverlays(contacts, edition.phoneFiles, (p) => p in edition.phoneMedia || mediaKey(p) in media);
  errors.push(...overlaid.errors);
  return { contacts: overlaid.contacts, errors, url: (p) => edition.phoneMedia[p] ?? media[mediaKey(p)] ?? '' };
}
