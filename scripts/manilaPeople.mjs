// Turns Manila's Filipino outfits on in the zones' `people:` lists, or back off. They are UNDER REVIEW in the mob showroom
// (mob.html, the 'filipino (under review)' stages) and in no zone until the user approves them: see content/manila/PEOPLE-REVIEW.md.
//   node scripts/manilaPeople.mjs            says what it would change (writes nothing)
//   node scripts/manilaPeople.mjs --apply    writes the reviewed mixes into content/manila/zones/*.yaml
//   node scripts/manilaPeople.mjs --off --apply   puts the original mixes back
// Each original line is matched exactly; a line that isn't there (already changed, or edited by hand) is left alone.
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/** [the line as it is now, the reviewed mix]: long coats and skirts cut to a trace (no wool in a tropical city), the school uniform the Filipino one. */
const MIXES = [
  // Barangays (Tundo, Paco, Santa Mesa, Pandacan): vendors, ballplayers, the jeepney's and the tricycle's people, a guard now and then.
  ['{ plain: 8, long: 2, school: 2, suit: 1 }', '{ plain: 6, long: 0.3, pinoy_school: 2, baller: 1.2, vendor: 1.2, jeep_crew: 0.6, trike_driver: 0.6, guard: 0.3, barong: 0.3, suit: 0.5 }'],
  ['{ plain: 10, long: 2, school: 2 }', '{ plain: 7, long: 0.3, pinoy_school: 2, baller: 1.5, vendor: 1.2, jeep_crew: 0.6, trike_driver: 0.8 }'],
  ['{ plain: 6, long: 2, school: 3 }', '{ plain: 5, long: 0.3, pinoy_school: 3, baller: 1.2, vendor: 1, trike_driver: 0.6, jeep_crew: 0.4 }'],
  ['{ plain: 5, suit: 4, long: 2 }', '{ plain: 5, suit: 3, barong: 0.8, long: 0.3, vendor: 0.8, guard: 0.8, pinoy_school: 0.6, trike_driver: 0.4 }'],
  ['{ plain: 6, suit: 3, long: 2 }', '{ plain: 5, suit: 3, barong: 0.6, long: 0.3, vendor: 0.8, guard: 0.6, pinoy_school: 0.6, trike_driver: 0.4 }'],
  // The business districts (Bagumbayan, Fort Centre): offices, barong and guards.
  ['{ suit: 8, plain: 2, long: 2 }', '{ suit: 6, barong: 1.5, plain: 2, guard: 1, vendor: 0.4, long: 0.3 }'],
  ['{ suit: 6, plain: 3, long: 2 }', '{ suit: 5, barong: 1.2, plain: 3, guard: 0.8, vendor: 0.5, long: 0.3 }'],
  // The bazaar, the student quarter, the old walled town, the nightlife, the docks.
  ['{ plain: 8, long: 3, school: 2 }', '{ plain: 6, vendor: 3, pinoy_school: 1.5, jeep_crew: 1, trike_driver: 0.8, baller: 0.6, guard: 0.5, long: 0.3 }'],
  ['{ school: 6, plain: 5, long: 2 }', '{ pinoy_school: 6, plain: 5, vendor: 0.8, baller: 1, trike_driver: 0.5, long: 0.3 }'],
  ['{ plain: 6, long: 2, suit: 1 }', '{ plain: 6, long: 0.3, suit: 1, vendor: 1.5, barong: 0.6, pinoy_school: 0.6, guard: 0.5, trike_driver: 0.6 }'],
  ['{ plain: 5, long: 5, suit: 3 }', '{ plain: 5, long: 0.5, suit: 3, guard: 1.5, barong: 0.4, vendor: 0.5, baller: 0.5 }'],
  ['{ plain: 6, suit: 1 }', '{ plain: 6, suit: 1, vendor: 1, jeep_crew: 1, trike_driver: 0.6, baller: 0.5, guard: 0.4 }'],
];

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'content', 'manila', 'zones');
const off = process.argv.includes('--off');
const apply = process.argv.includes('--apply');
let total = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.yaml'))) {
  const path = join(dir, f);
  let text = readFileSync(path, 'utf8');
  let n = 0;
  for (const [from, to] of MIXES) {
    const [a, b] = off ? [to, from] : [from, to];
    const line = `people: ${a}`;
    const parts = text.split(line);
    // (Exact lines only: `people: { plain: 6, suit: 1 }` must not match the front of a longer one.)
    let out = parts[0];
    for (let i = 1; i < parts.length; i++) {
      const rest = parts[i];
      if (/^[ \t]*(\r?\n|$)/.test(rest)) {
        out += `people: ${b}` + rest;
        n++;
      } else out += line + rest;
    }
    text = out;
  }
  if (n) console.log(`${f}: ${n} line${n > 1 ? 's' : ''}`);
  total += n;
  if (n && apply) writeFileSync(path, text);
}
console.log(`${total} line${total === 1 ? '' : 's'} ${apply ? 'written' : 'would change (add --apply to write)'}${off ? ' back to the original mixes' : ''}`);
