import { edition } from '@edition';
import { applyPhoneOverlays } from '../edition/phoneOverlay';
import { type Contact, parseContact } from './format';

/**
 * The phone's contacts (content/phone/*.yaml) and their media (content/phone/media/), which the edition provides
 * (src/edition/: only KAIWA's welcome in the demo). The uncensored edition lays its overlays
 * (adult/content/phone/, src/edition/phoneOverlay.ts) over them; its media come first.
 */
export interface PhoneContent {
  readonly contacts: Contact[];
  readonly errors: string[];
  /** A media path from a contact file ("media/x.jpg") to its URL. */
  url(path: string): string;
}

export function loadPhoneContent(): PhoneContent {
  const { story, overlay } = edition;
  const errors: string[] = [];
  const contacts: Contact[] = [];
  const ids = new Set<string>();
  for (const [name, text] of Object.entries(story.phoneFiles).sort(([a], [b]) => a.localeCompare(b))) {
    const c = parseContact(`content/phone/${name}`, text, errors, (p) => p in story.phoneMedia);
    if (!c) continue;
    if (ids.has(c.id)) errors.push(`content/phone/${name}: contact id ${c.id} is used by another file`);
    ids.add(c.id);
    contacts.push(c);
  }
  const overlaid = applyPhoneOverlays(contacts, overlay.phoneFiles, (p) => p in overlay.phoneMedia || p in story.phoneMedia);
  errors.push(...overlaid.errors);
  return { contacts: overlaid.contacts, errors, url: (p) => overlay.phoneMedia[p] ?? story.phoneMedia[p] ?? '' };
}
