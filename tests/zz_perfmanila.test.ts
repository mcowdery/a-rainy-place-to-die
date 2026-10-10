import { it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { CITIES, setTreeSet, type CityId } from '../src/poc3d/district/cityConfig';
import { DISTRICTS3 } from '../src/poc3d/district/plan';
import { DistrictModel } from '../src/poc3d/district/model';
import { MeshBuilder } from '../src/poc3d/real/meshBuilder';
import { addBuilding } from '../src/poc3d/real/buildings';
import { addProps } from '../src/poc3d/real/props';
import { setWorkLiveries } from '../src/poc3d/models/vehicles';
import { writeFileSync } from 'fs';

// TEMPORARY perf harness (not kept): triangles and build ms per cell, near stage pieces, Manila vs Toto.
const tris = (mb: MeshBuilder): number => (mb.raw(0, 0)?.index.length ?? 0) / 3;
function run(city: CityId, cells: [number, number][]) {
  setTreeSet(city);
  setWorkLiveries(CITIES[city].tropical);
  const c = loadDistrictContent(city);
  const model = new DistrictModel(c.macro, [...DISTRICTS3], c.placed, CITIES[city].seed, c.zones, c.avenues, c.terrain, [], []);
  const rows: Record<string, number>[] = [];
  const mb = new MeshBuilder(1 << 16);
  for (const [mx, my] of cells) {
    const plan = model.plan(mx, my);
    if (!plan) continue;
    const detail = model.detail(mx, my)!;
    const t0 = performance.now();
    const bl = model.massed(mx, my);
    mb.reset();
    for (const b of bl) addBuilding(mb, b, true);
    const bTris = tris(mb);
    const t1 = performance.now();
    mb.reset();
    addProps(mb, detail, undefined, 'fixed');
    const fTris = tris(mb);
    const t2 = performance.now();
    mb.reset();
    addProps(mb, detail, undefined, 'swap');
    const sTris = tris(mb);
    mb.reset();
    addProps(mb, detail, undefined, 'swap', true);
    const mTris = tris(mb);
    const wires = detail.wires.reduce((s, w) => s + Math.max(0, w.length - 1), 0);
    const kinds: Record<string, number> = {};
    for (const p of detail.props) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
    rows.push({ mx, my, buildings: bl.length, bTris, bMs: t1 - t0, fixedTris: fTris, fixedMs: t2 - t1, swapTris: sTris, midTris: mTris, wireSegs: wires, wireTris: wires * 8, props: detail.props.length });
    (rows[rows.length - 1] as unknown as { kinds: unknown }).kinds = kinds;
  }
  return rows;
}
it('perf', () => {
  const out: Record<string, unknown> = {};
  const sample = (x0: number, y0: number, x1: number, y1: number): [number, number][] => {
    const a: [number, number][] = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a.push([x, y]);
    return a;
  };
  out.manila_barangay = run('manila', sample(9, 2, 15, 6));
  out.manila_shanty = run('manila', sample(3, 1, 8, 6));
  out.manila_cbd = run('manila', sample(9, 8, 15, 13));
  out.manila_poblacion = run('manila', sample(27, 11, 33, 14));
  out.toto_res = run('toto', sample(10, 6, 16, 10));
  out.toto_cbd = run('toto', sample(20, 9, 26, 14));
  out.toto_neon = run('toto', sample(26, 9, 32, 14));
  const sum = (rows: Record<string, number>[], k: string): number => Math.round(rows.reduce((s, r) => s + (r[k] ?? 0), 0) / Math.max(1, rows.length));
  for (const [k, rows] of Object.entries(out) as [string, Record<string, number>[]][]) {
    console.log(k.padEnd(18), `cells ${rows.length}`, ['bTris', 'bMs', 'fixedTris', 'fixedMs', 'swapTris', 'midTris', 'wireTris', 'props'].map((f) => `${f} ${sum(rows, f)}`).join('  '));
  }
  writeFileSync('debug-shots/perf_manila/cells_' + (process.env.TAG ?? 'x') + '.json', JSON.stringify(out));
}, 600000);

it('by kind', () => {
  const rep: Record<string, Record<string, number>> = {};
  for (const [city, cells] of [['manila', [[9, 2, 15, 6], [3, 1, 8, 6], [27, 11, 33, 14]]], ['toto', [[10, 6, 16, 10]]]] as [CityId, number[][]][]) {
    setTreeSet(city);
    setWorkLiveries(CITIES[city].tropical);
    const c = loadDistrictContent(city);
    const model = new DistrictModel(c.macro, [...DISTRICTS3], c.placed, CITIES[city].seed, c.zones, c.avenues, c.terrain, [], []);
    const mb = new MeshBuilder(1 << 16);
    const acc: Record<string, number> = {};
    const cnt: Record<string, number> = {};
    let n = 0;
    for (const [x0, y0, x1, y1] of cells) for (let my = y0; my < y1; my++) for (let mx = x0; mx < x1; mx++) {
      const d = model.detail(mx, my);
      if (!d || !model.plan(mx, my)) continue;
      n++;
      const kinds = new Set(d.props.map((p) => p.kind));
      for (const k of kinds) {
        mb.reset();
        addProps(mb, { ...d, wires: [], props: d.props.filter((p) => p.kind === k) }, undefined, 'all');
        acc[k] = (acc[k] ?? 0) + tris(mb);
        cnt[k] = (cnt[k] ?? 0) + d.props.filter((p) => p.kind === k).length;
      }
    }
    for (const k of Object.keys(acc)) rep[city + ':' + k] = { perCell: Math.round(acc[k] / n), countPerCell: +(cnt[k] / n).toFixed(1), perItem: Math.round(acc[k] / cnt[k]) };
  }
  const rows = Object.entries(rep).sort((a, b) => b[1].perCell - a[1].perCell);
  writeFileSync('debug-shots/perf_manila/kinds_' + (process.env.TAG ?? 'x') + '.txt', rows.map(([k, v]) => `${k.padEnd(24)} ${String(v.perCell).padStart(7)} tris/cell  ${String(v.countPerCell).padStart(6)} items  ${String(v.perItem).padStart(6)} tris each`).join('\n'));
}, 600000);

it('per building', () => {
  const lines: string[] = [];
  for (const [city, cells] of [['manila', [[9, 2, 15, 6]]], ['toto', [[10, 6, 16, 10]]]] as [CityId, number[][]][]) {
    setTreeSet(city);
    setWorkLiveries(CITIES[city].tropical);
    const c = loadDistrictContent(city);
    const model = new DistrictModel(c.macro, [...DISTRICTS3], c.placed, CITIES[city].seed, c.zones, c.avenues, c.terrain, [], []);
    const mb = new MeshBuilder(1 << 16);
    const rows: { t: number; tf: number; h: number; w: number; d: number }[] = [];
    for (const [x0, y0, x1, y1] of cells) for (let my = y0; my < y1; my++) for (let mx = x0; mx < x1; mx++) {
      if (!model.plan(mx, my)) continue;
      for (const b of model.massed(mx, my)) {
        mb.reset(); addBuilding(mb, b, true); const t = tris(mb);
        mb.reset(); addBuilding(mb, b, false); const tf = tris(mb);
        rows.push({ t, tf, h: b.h, w: b.w, d: b.d });
      }
    }
    rows.sort((a, b) => b.t - a.t);
    const tot = rows.reduce((s, r) => s + r.t, 0);
    const totf = rows.reduce((s, r) => s + r.tf, 0);
    lines.push(`${city}: ${rows.length} buildings, near ${tot} far ${totf}; median ${rows[rows.length >> 1].t}; top: ` + rows.slice(0, 12).map((r) => `${r.t}(${r.h.toFixed(0)}m ${r.w.toFixed(0)}x${r.d.toFixed(0)})`).join(' '));
    const buckets: Record<string, number[]> = {};
    for (const r of rows) (buckets[r.h <= 9.5 ? 'low<=9.5' : r.h <= 16 ? 'mid<=16' : r.h <= 30 ? '<=30' : 'tall'] ??= []).push(r.t);
    for (const [k, v] of Object.entries(buckets)) lines.push(`   ${k}: n ${v.length} avg ${Math.round(v.reduce((a, b) => a + b, 0) / v.length)}`);
  }
  writeFileSync('debug-shots/perf_manila/bldg_' + (process.env.TAG ?? 'x') + '.txt', lines.join('\n'));
}, 600000);

it('attribute building tris', () => {
  const acc: Record<string, number> = {};
  const proto = MeshBuilder.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  let depth = 0;
  for (const name of ['box', 'beam', 'cylinder', 'lathe', 'quad', 'frameBox', 'cone', 'prism', 'gable']) {
    const orig = proto[name];
    if (typeof orig !== 'function') continue;
    proto[name] = function (this: MeshBuilder, ...args: unknown[]) {
      const before = (this as unknown as { ni: number }).ni;
      let site = '';
      if (depth === 0) {
        const st = new Error().stack!.split('\n').slice(2, 12).find((l) => !l.includes('meshBuilder.ts')) ?? '';
        site = st.trim().replace(/.*src[\/]poc3d[\/]/, '').replace(/\)$/, '');
      }
      depth++;
      const r = orig.apply(this, args);
      depth--;
      if (depth === 0) acc[site] = (acc[site] ?? 0) + ((this as unknown as { ni: number }).ni - before) / 3;
      return r;
    };
  }
  const city: CityId = 'manila';
  setTreeSet(city);
  setWorkLiveries(CITIES[city].tropical);
  const c = loadDistrictContent(city);
  const model = new DistrictModel(c.macro, [...DISTRICTS3], c.placed, CITIES[city].seed, c.zones, c.avenues, c.terrain, [], []);
  const mb = new MeshBuilder(1 << 16);
  let n = 0;
  for (let my = 2; my < 6; my++) for (let mx = 9; mx < 15; mx++) {
    if (!model.plan(mx, my)) continue;
    n++;
    mb.reset();
    for (const b of model.massed(mx, my)) addBuilding(mb, b, true);
  }
  const rows = Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 30);
  writeFileSync('debug-shots/perf_manila/attrib_' + (process.env.TAG ?? 'x') + '.txt', `cells ${n}\n` + rows.map(([k, v]) => `${String(Math.round(v / n)).padStart(7)}/cell  ${k}`).join('\n'));
}, 600000);
