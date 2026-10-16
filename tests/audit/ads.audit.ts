// The ad audit: what the siting rules (real/adSites.ts) made of the city's billboards and posters, for looking over
// after a change to the rules, the roads or the catalogue. Not a test: it asserts nothing and `npm test` doesn't run it.
//   npx vitest run --config tests/audit/vitest.config.ts tests/audit/ads.audit.ts
// It writes into debug-shots/ad-audit/ (git-ignored):
//   summary.txt   counts by district, kind and who each is for; each brand's count and its nearest repeat; timings
//   sites.txt     every ad: where, its size, who it's for, its score, its ad
//   map.svg       the city from above: buildings, the expressway and the lines, every ad (a tick along its panel and
//                 a stroke the way it faces; red for the expressway, blue for the lines, yellow for the street, green
//                 a poster), and in grey the candidates the spacing rule dropped
import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { loadDistrictContent } from '../../src/poc3d/district/content';
import { Expressway, expresswayCoveredFrom, expresswayReservedFrom, parseExpressway } from '../../src/poc3d/district/expressway';
import { DistrictModel } from '../../src/poc3d/district/model';
import { CELL, DISTRICTS3 } from '../../src/poc3d/district/plan';
import { railReserved } from '../../src/poc3d/district/rail';
import { DISTRICT_ADS } from '../../src/poc3d/models/ads';
import { adBrand, AdSites, type AdSite } from '../../src/poc3d/real/adSites';

const SEED = 0x0c179090;
const DIR = 'debug-shots/ad-audit/';
mkdirSync(DIR, { recursive: true });
const content = loadDistrictContent();
const model = new DistrictModel(content.macro, DISTRICTS3, content.placed, SEED, content.zones, content.avenues, content.terrain,
  [...railReserved(content.rails), ...expresswayReservedFrom('expressway.yaml', content.expresswayText)], expresswayCoveredFrom('expressway.yaml', content.expresswayText), content.traffic.buses);
const exDef = parseExpressway('expressway.yaml', content.expresswayText, []);
const roads = exDef ? new Expressway(exDef).roads : [];
const ads = new AdSites(model, { expressway: roads, rails: content.rails });
const r1 = (n: number): number => Math.round(n * 10) / 10;

it('audits the ads', () => {
  const all: { s: AdSite; kind: string; zone: string }[] = [];
  const dropped: AdSite[] = [];
  let slowest = 0;
  // (The plans and the street furniture first, so the time below is the siting's own.)
  for (const [mx, my] of model.cells) model.detail(mx, my);
  const t0 = performance.now();
  for (const [mx, my] of model.cells) {
    const t = performance.now();
    const placed = ads.sites(mx, my);
    slowest = Math.max(slowest, performance.now() - t);
    const plan = model.plan(mx, my)!;
    for (const s of placed) all.push({ s, kind: plan.kind, zone: s.b.zone?.id ?? '-' });
    for (const c of ads.candidates(mx, my)) if (!placed.some((s) => s.b === c.b && s.kind !== 'poster')) dropped.push(c);
  }
  const total = performance.now() - t0;

  const count = <T,>(list: readonly T[], key: (t: T) => string): string =>
    [...list.reduce((m, t) => m.set(key(t), (m.get(key(t)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
  const out: string[] = [];
  out.push(`${all.length} ads in ${model.cells.length} cells; ${dropped.length} candidates seen well enough but dropped (spacing, or no ad left for them)`);
  out.push(`time: ${Math.round(total)} ms in all, ${r1(total / model.cells.length)} ms a cell, the slowest ${r1(slowest)} ms (the first call for a cell scores its eight neighbours too)`);
  out.push('', 'by kind: ' + count(all, (a) => a.s.kind), 'by viewer: ' + count(all, (a) => a.s.view), '');
  for (const kind of new Set(all.map((a) => a.kind))) {
    const here = all.filter((a) => a.kind === kind);
    const cells = model.cells.filter(([mx, my]) => model.plan(mx, my)!.kind === kind).length;
    out.push(`${kind} (${cells} cells): ${here.length}, ${r1(here.length / cells)} a cell; ${count(here, (a) => `${a.s.kind}/${a.s.view}`)}`);
  }
  out.push('', 'brands (count, nearest two of the same brand):');
  const byBrand = new Map<string, AdSite[]>();
  for (const { s } of all) {
    const key = `${DISTRICT_ADS[s.ad].format} ${adBrand(s.ad)} ${DISTRICT_ADS[s.ad].brand}`;
    byBrand.set(key, [...(byBrand.get(key) ?? []), s]);
  }
  for (const [key, list] of [...byBrand].sort((a, b) => b[1].length - a[1].length)) {
    let near = Infinity;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) near = Math.min(near, Math.hypot(list[i].c[0] - list[j].c[0], list[i].c[2] - list[j].c[2]));
    out.push(`  ${String(list.length).padStart(4)}  ${near === Infinity ? '   -' : String(Math.round(near)).padStart(4)} m  ${key}`);
  }
  writeFileSync(DIR + 'summary.txt', out.join('\n'));
  console.log(out.join('\n'));

  writeFileSync(DIR + 'sites.txt', all.map(({ s, kind, zone }) =>
    [s.kind.padEnd(8), s.view.padEnd(10), `x ${r1(s.c[0])} z ${r1(s.c[2])}`.padEnd(24), `faces ${s.n[0]},${s.n[2]}`.padEnd(12), `${r1(s.w)}x${r1(s.h)} at ${r1(s.y0)}`.padEnd(18), `score ${r1(s.score)}`.padEnd(11), kind.padEnd(12), zone.padEnd(18), DISTRICT_ADS[s.ad].brand].join(' ')).join('\n'));

  // The map, 1 px a metre.
  const W = content.macro.cols * CELL;
  const H = content.macro.rows * CELL;
  const svg: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="background:#101216">`];
  for (const [mx, my] of model.cells) for (const b of model.buildings(mx, my)) svg.push(`<rect x="${r1(b.x - b.w / 2)}" y="${r1(b.z - b.d / 2)}" width="${r1(b.w)}" height="${r1(b.d)}" fill="${b.hue !== undefined ? '#3a4a5a' : b.h >= 30 ? '#4a4c52' : b.h >= 15 ? '#3a3c42' : '#2a2c30'}"/>`);
  const line = (xs: ArrayLike<number>, zs: ArrayLike<number>, colour: string, width: number): void => {
    const pts: string[] = [];
    for (let i = 0; i < xs.length; i += 4) pts.push(`${r1(xs[i])},${r1(zs[i])}`);
    svg.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${colour}" stroke-width="${width}" opacity="0.55"/>`);
  };
  for (const road of roads) if (road.kind === 'loop' || road.kind === 'route') line(road.x, road.z, '#c05050', 9);
  for (const l of content.rails) line(l.path.xs, l.path.zs, '#5080d0', 8);
  const COLOUR = { expressway: '#ff5050', rail: '#60a0ff', street: '#ffd040', wait: '#50e080' };
  const tick = (s: AdSite, colour: string, o: number): void => {
    const [x, z] = [s.c[0], s.c[2]];
    const half = Math.max(1.5, s.w / 2);
    svg.push(`<g stroke="${colour}" opacity="${o}" stroke-linecap="round"><line x1="${r1(x - s.r[0] * half)}" y1="${r1(z - s.r[2] * half)}" x2="${r1(x + s.r[0] * half)}" y2="${r1(z + s.r[2] * half)}" stroke-width="2.5"/><line x1="${r1(x)}" y1="${r1(z)}" x2="${r1(x + s.n[0] * (s.kind === 'poster' ? 3 : 9))}" y2="${r1(z + s.n[2] * (s.kind === 'poster' ? 3 : 9))}" stroke-width="1"/></g>`);
  };
  for (const c of dropped) tick(c, '#909090', 0.6);
  for (const { s } of all) tick(s, COLOUR[s.view], 1);
  svg.push('</svg>');
  writeFileSync(DIR + 'map.svg', svg.join('\n'));
});
