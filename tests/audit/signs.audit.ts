// The sign audit: what the siting rules (real/signSites.ts) made of the city's shop signs, for looking over after a
// change to the rules, the roads or the zones. Not a test: it asserts nothing and `npm test` doesn't run it.
//   npx vitest run --config tests/audit/vitest.config.ts tests/audit/signs.audit.ts
// It writes into debug-shots/sign-audit/ (git-ignored):
//   summary.txt   counts by district: blades, fascias, channel letters, looks, rooftop letters; what the face-on signs
//                 look at across the street; the checks that should be nought (signs on homes, neon facing a wall,
//                 blades in each other's way or down on the fascia, a fascia wider than its shop)
//   signs.txt     every sign: where, which way up, its look, its text, its building
//   map.svg       the city from above, 1 px a metre: buildings, every sign a tick on its wall and a stroke the way it
//                 faces (pink neon, white a lightbox, gold white-on-colour, brown painted, cyan channel letters; a
//                 blade's stroke is long), and rooftop letters as a ring
import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { loadDistrictContent } from '../../src/poc3d/district/content';
import { expresswayCoveredFrom, expresswayReservedFrom } from '../../src/poc3d/district/expressway';
import { CELL, DISTRICTS3, frontSpan, STYLES3, type Building3, type Sign3 } from '../../src/poc3d/district/plan';
import { railReserved } from '../../src/poc3d/district/rail';
import { frontFrame, styleFor } from '../../src/poc3d/real/buildings';
import { sightline } from '../../src/poc3d/real/sightline';
import { bladeLength, hasRooftopLetters, plateWidth, SignLayout, signStyle } from '../../src/poc3d/real/signs';
import { DistrictModel, signTexts } from '../../src/poc3d/district/model';
import { eraSignWords } from '../../src/poc3d/district/era';

const SEED = 0x0c179090;
const DIR = 'debug-shots/sign-audit/';
mkdirSync(DIR, { recursive: true });
const content = loadDistrictContent();
const model = new DistrictModel(content.macro, DISTRICTS3, content.placed, SEED, content.zones, content.avenues, content.terrain,
  [...railReserved(content.rails), ...expresswayReservedFrom('expressway.yaml', content.expresswayText)], expresswayCoveredFrom('expressway.yaml', content.expresswayText), content.traffic.buses);
const r1 = (n: number): number => Math.round(n * 10) / 10;

const formOf = (s: Sign3): string => (s.vertical ? 'blade' : signStyle(s).channel ? 'channel' : 'fascia');
const lookOf = (s: Sign3): string => s.look ?? (signStyle(s).style === 0 ? 'neon*' : 'box*');

it('audits the signs', () => {
  const tally = new Map<string, Map<string, number>>();
  const bump = (k: string, f: string, n = 1): void => {
    const m = tally.get(k) ?? new Map<string, number>();
    m.set(f, (m.get(f) ?? 0) + n);
    tally.set(k, m);
  };
  const rows: string[] = [];
  const marks: { s: Sign3; roof?: Building3 }[] = [];
  const t0 = performance.now();
  for (const [mx, my] of model.cells) model.signs(mx, my);
  const ms = performance.now() - t0;
  for (const [mx, my] of model.cells) {
    const plan = model.plan(mx, my)!;
    const k = plan.kind;
    const around: Building3[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) around.push(...model.buildings(mx + dx, my + dy));
    const seen = sightline(around);
    bump(k, 'cells');
    for (const b of plan.buildings) {
      bump(k, 'buildings');
      if (b.sign) bump(k, 'shop signs planned');
      if (hasRooftopLetters(b, seen)) {
        bump(k, 'rooftop letters');
        marks.push({ s: { text: '', vertical: false, color: 0, x: b.x, y: b.h, z: b.z, nx: 0, nz: 0 }, roof: b });
      }
    }
    for (const e of model.signExtras(mx, my)) bump(k, `extra ${e.kind}`);
    bump(k, 'stand-sign solids', model.signPlacement(mx, my)?.solids.length ?? 0);
    const signs = model.signs(mx, my);
    const blades = signs.filter((s) => s.vertical);
    for (const s of signs) {
      const form = formOf(s);
      bump(k, 'signs');
      bump(k, form);
      bump(k, `look ${lookOf(s)}`);
      // Its building: the one whose wall it's on.
      const b = plan.buildings.find((q) => Math.abs(q.x - s.x) <= q.w / 2 + 0.5 && Math.abs(q.z - s.z) <= q.d / 2 + 0.5);
      if (b && styleFor(b).home) bump(k, 'CHECK on a home');
      if (b && b.sign && s.text !== b.sign.text) bump(k, 'upstairs tenant blades');
      if (b && s.vertical && (frontFrame(b).n[0] !== s.nx || frontFrame(b).n[2] !== s.nz)) bump(k, 'corner blades (side street)');
      if (s.vertical) {
        const y0 = s.y - bladeLength(s.text);
        if (y0 < 4.3) bump(k, 'CHECK blade down on the fascia');
        if (blades.some((o) => o !== s && Math.hypot(o.x - s.x, o.z - s.z) < 1.05 && o.y - bladeLength(o.text) < s.y && y0 < o.y)) bump(k, 'CHECK blades in each other\'s way');
      } else if (b) {
        const [s0, s1] = frontSpan(b);
        const w = Math.min(plateWidth(s.text), 5.4, s.maxW ?? 99);
        if (w > s1 - s0) bump(k, 'CHECK fascia wider than its shop');
      }
      // What a face-on sign looks at: the first building straight across (towers too) within 25 m.
      if (!s.vertical) {
        const wx = s.x - s.nx * 0.4;
        const wz = s.z - s.nz * 0.4;
        let hit: Building3 | null = null;
        let hd = 25;
        for (const o of around) {
          if (o === b) continue;
          const [x0, x1, z0, z1] = [o.x - o.w / 2, o.x + o.w / 2, o.z - o.d / 2, o.z + o.d / 2];
          let t: number;
          if (s.nx !== 0) {
            if (wz < z0 || wz > z1) continue;
            t = s.nx > 0 ? x0 - wx : wx - x1;
          } else {
            if (wx < x0 || wx > x1) continue;
            t = s.nz > 0 ? z0 - wz : wz - z1;
          }
          if (t >= 0 && t < hd) [hd, hit] = [t, o];
        }
        const face = !hit ? 'open' : (() => { const n = frontFrame(hit).n; const dot = n[0] * s.nx + n[2] * s.nz; return dot < -0.5 ? 'a front' : dot > 0.5 ? 'a back' : 'a side'; })();
        bump(k, `face-on sign looks at ${face}${hit && face !== 'a front' ? (hd < 8 ? ' under 8 m' : ' 8 m+') : ''}`);
        if (hit && face !== 'a front' && hd < 8 && s.look === 'neon') bump(k, 'CHECK neon facing a wall');
      }
      rows.push([form.padEnd(8), lookOf(s).padEnd(9), `x ${r1(s.x)} z ${r1(s.z)} y ${r1(s.y)}`.padEnd(30), `faces ${s.nx},${s.nz}`.padEnd(12), k.padEnd(12), (b?.zone?.id ?? '-').padEnd(18), s.text].join(' '));
      marks.push({ s });
    }
  }

  const out: string[] = [];
  const total = new Map<string, number>();
  for (const m of tally.values()) for (const [f, n] of m) total.set(f, (total.get(f) ?? 0) + n);
  const show = (name: string, m: Map<string, number>): void => {
    out.push(`${name}:`);
    for (const [f, n] of [...m].sort((a, b) => a[0].localeCompare(b[0]))) out.push(`  ${f.padEnd(44)} ${n}`);
  };
  out.push(`siting: ${Math.round(ms)} ms for ${model.cells.length} cells (${r1(ms / model.cells.length)} ms a cell, plans included)`);
  const layout = new SignLayout(signTexts(eraSignWords(content.zones.words([...new Set(DISTRICTS3.flatMap((k) => STYLES3[k]!.signWords))])), content.placed));
  out.push(`sign atlas: ${layout.width} x ${layout.height}`);
  out.push('(neon* and box*: a sign with no look of its own, its look from its hash as before)', '');
  show('ALL', total);
  for (const [k, m] of tally) {
    out.push('');
    show(k, m);
  }
  writeFileSync(DIR + 'summary.txt', out.join('\n'));
  console.log(out.join('\n'));
  writeFileSync(DIR + 'signs.txt', rows.join('\n'));

  // The map, 1 px a metre.
  const W = content.macro.cols * CELL;
  const H = content.macro.rows * CELL;
  const svg: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="background:#101216">`];
  for (const [mx, my] of model.cells) {
    for (const r of model.plan(mx, my)!.roads) if (r.kind !== 'coast') svg.push(`<rect x="${r1(r.rect.x)}" y="${r1(r.rect.y)}" width="${r1(r.rect.w)}" height="${r1(r.rect.h)}" fill="#1c1e24"/>`);
    for (const b of model.buildings(mx, my)) svg.push(`<rect x="${r1(b.x - b.w / 2)}" y="${r1(b.z - b.d / 2)}" width="${r1(b.w)}" height="${r1(b.d)}" fill="${b.hue !== undefined ? '#3a4a5a' : styleFor(b).home ? '#26282c' : b.h >= 30 ? '#4a4c52' : '#36383e'}"/>`);
  }
  const COLOUR: Record<string, string> = { neon: '#ff5fc8', lightbox: '#f0f0f0', inverse: '#ffc840', print: '#a07850', channel: '#40e0ff' };
  for (const { s, roof } of marks) {
    if (roof) {
      svg.push(`<circle cx="${r1(roof.x)}" cy="${r1(roof.z)}" r="4" fill="none" stroke="#40e0ff" stroke-width="1.5"/>`);
      continue;
    }
    const c = COLOUR[s.look ?? ''] ?? '#909090';
    const [rx, rz] = [s.nz, -s.nx];
    const half = s.vertical ? 0.4 : 1.4;
    const reach = s.vertical ? 3 : 1.5;
    svg.push(`<g stroke="${c}" stroke-linecap="round"><line x1="${r1(s.x - rx * half)}" y1="${r1(s.z - rz * half)}" x2="${r1(s.x + rx * half)}" y2="${r1(s.z + rz * half)}" stroke-width="1.6"/><line x1="${r1(s.x)}" y1="${r1(s.z)}" x2="${r1(s.x + s.nx * reach)}" y2="${r1(s.z + s.nz * reach)}" stroke-width="${s.vertical ? 1.2 : 0.6}"/></g>`);
  }
  svg.push('</svg>');
  writeFileSync(DIR + 'map.svg', svg.join('\n'));
});
