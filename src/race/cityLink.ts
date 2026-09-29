/**
 * The way back to the city from the racing pages (race.html, garage.html). The city is the hub, so the way
 * back is always there, whatever page you're on and however you got there: through the garage door (back to the
 * street outside it, your car in its bay), or through an expressway tunnel (back onto the loop past that
 * exit, driving). How you last left the city is kept in the browser (`citypop.return`), since the links
 * between the passes and the garage don't carry it.
 */

const KEY = 'citypop.return';

/** Note how you came from the city, if this page's address says (?from=city, or ?from=<exit id>). */
export function rememberCityReturn(params: URLSearchParams): void {
  const from = params.get('from');
  if (!from) return;
  try {
    localStorage.setItem(KEY, from);
  } catch {
    /* storage blocked: the garage street is the way back */
  }
}

/** Where 'Back to the city' goes, and what to call it. */
export function cityReturn(): { href: string; label: string; note: string } {
  let from: string | null = null;
  try {
    from = localStorage.getItem(KEY);
  } catch {
    /* none */
  }
  if (from && from !== 'city') return { href: `district.html?from=${encodeURIComponent(from)}&time=night`, label: '◂ Back to the city', note: 'the expressway, where you came off it' };
  return { href: 'district.html?spawn=city_garage.front&car=home', label: '◂ Back to the city', note: 'your garage, your car in its bay' };
}

/** Taking the garage's way back: from now on, the way back is the garage street. */
export function cityReturnViaGarage(): void {
  try {
    localStorage.setItem(KEY, 'city');
  } catch {
    /* none */
  }
}
