import type { PanelApi } from './shell';

/**
 * Approve / reject buttons for a room's candidates (the user's rule: a design is approved in a showroom before it goes into
 * the city). Each candidate has one button that goes round undecided, approved, rejected; the verdicts are kept in the
 * browser (localStorage) and, on the dev server, sent to `/__review` (scripts/devEndpoints.mjs), which writes
 * `debug-shots/review/<room>.json` for whoever builds on the result to read.
 */
export type Verdict = 'undecided' | 'approved' | 'rejected';
const NEXT: Record<Verdict, Verdict> = { undecided: 'approved', approved: 'rejected', rejected: 'undecided' };
const MARK: Record<Verdict, string> = { undecided: '○', approved: '✓', rejected: '✗' };

export interface Review {
  /** Registers a candidate under a heading (a species, a vehicle). */
  add(group: string, id: string, name: string): void;
  /** The panel's section for them. */
  panel(api: PanelApi): void;
  verdict(id: string): Verdict;
}

export function makeReview(room: string, redraw: () => void): Review {
  const key = `rainyplace.review.${room}`;
  let state: Record<string, Verdict> = {};
  try {
    state = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, Verdict>;
  } catch {
    state = {};
  }
  const groups = new Map<string, { id: string; name: string }[]>();
  // The server's copy is the user's word if the browser's is empty (another browser, cleared data).
  void fetch(`/__review?room=${encodeURIComponent(room)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((all: Record<string, { verdict: Verdict }> | null) => {
      if (!all) return;
      let changed = false;
      for (const [id, v] of Object.entries(all)) {
        if (!state[id]) {
          state[id] = v.verdict;
          changed = true;
        }
      }
      if (changed) redraw();
    })
    .catch(() => undefined);
  const save = (id: string, name: string): void => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* private window: the server's copy still gets it */
    }
    void fetch('/__review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room, id, name, verdict: state[id] ?? 'undecided' }) }).catch(() => undefined);
  };
  const verdict = (id: string): Verdict => state[id] ?? 'undecided';
  return {
    verdict,
    add(group, id, name) {
      const list = groups.get(group) ?? [];
      list.push({ id, name });
      groups.set(group, list);
    },
    panel({ section, button }) {
      section('Review: click to approve, again to reject');
      for (const [group, list] of groups) {
        section(group);
        for (const c of list) {
          const v = verdict(c.id);
          button(`${MARK[v]} ${c.name}`, v === 'approved', () => {
            state[c.id] = NEXT[verdict(c.id)];
            save(c.id, c.name);
            redraw();
          });
        }
      }
      const all = [...groups.values()].flat();
      button(`${all.filter((c) => verdict(c.id) === 'approved').length} approved · ${all.filter((c) => verdict(c.id) === 'rejected').length} rejected · ${all.filter((c) => verdict(c.id) === 'undecided').length} undecided`, false, () => undefined);
    },
  };
}
