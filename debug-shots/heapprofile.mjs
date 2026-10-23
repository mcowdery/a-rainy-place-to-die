// Where the city's JavaScript memory goes (Chrome's sampling heap profiler, by the line that allocated it), in two parts:
//   live   - sampling from the start of the boot to a settled city, collected objects left out: what holds the heap at rest
//   churn  - sampling for [seconds] of play with collected objects kept: what's allocated per second, garbage included (the
//            recorder saw ~50 MB/s on the user's PC and a minor collection every half second)
// Each is listed by function (self) and by the nearest frames of our own code above it, so three.js's `clone`s and the
// browser's built-ins are charged to the caller. At the user's canvas (2413x922), on foot at night by default.
//   node debug-shots/heapprofile.mjs <out dir> [seconds=20] [foot|drive] [extra query]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync, writeFileSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/heapprofile';
const secs = Number(process.argv[3] ?? 20);
const mode = process.argv[4] ?? 'foot';
const extra = process.argv[5] ? `&${process.argv[5]}` : '';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 2413, height: 922 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
const cdp = await page.context().newCDPSession(page);
await cdp.send('HeapProfiler.enable');
// Kaburo on foot (a recorder spot), or the garage with the car for the auto-drive.
const where = mode === 'drive' ? 'spawn=city_garage.front&car=home' : 'cam=3842,2,1534,-71,0';
const heap = () => page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576));
const ours = (url) => /\/src\//.test(url) && !/node_modules/.test(url);
const file = (url) => url.replace(/\?.*/, '').split('/').slice(-2).join('/') || '(native)';

// Sums a sampling profile's self sizes by function and by the nearest two of our frames on its stack.
function summarize(profile, label, perSecond) {
  const bySelf = new Map();
  const byOurs = new Map();
  const byFile = new Map();
  let total = 0;
  const walk = (n, stack) => {
    const f = n.callFrame;
    const here = { name: f.functionName || '(anon)', url: f.url, line: f.lineNumber + 1 };
    const st = [...stack, here];
    if (n.selfSize) {
      total += n.selfSize;
      const k = `${here.name} ${file(here.url)}:${here.line}`;
      bySelf.set(k, (bySelf.get(k) ?? 0) + n.selfSize);
      const mine = st.filter((s) => ours(s.url)).slice(-2).map((s) => `${s.name} ${file(s.url)}:${s.line}`).join(' < ');
      byOurs.set(mine || '(no frame of ours)', (byOurs.get(mine || '(no frame of ours)') ?? 0) + n.selfSize);
      const ourFile = st.filter((s) => ours(s.url)).slice(-1)[0];
      const fk = ourFile ? file(ourFile.url) : '(no frame of ours)';
      byFile.set(fk, (byFile.get(fk) ?? 0) + n.selfSize);
    }
    for (const c of n.children ?? []) walk(c, st);
  };
  walk(profile.head, []);
  const mb = (v) => (perSecond ? `${(v / 1048576 / perSecond).toFixed(2).padStart(7)} MB/s` : `${(v / 1048576).toFixed(1).padStart(8)} MB`);
  const lines = [`\n===== ${label}: ${mb(total)} in all`];
  const top = (m, n, head) => {
    lines.push(`-- ${head}`);
    for (const [k, v] of [...m].sort((a, b) => b[1] - a[1]).slice(0, n)) lines.push(`${((v / total) * 100).toFixed(1).padStart(5)}% ${mb(v)}  ${k}`);
  };
  top(byFile, 15, 'by our file nearest the allocation');
  top(byOurs, 30, 'by our nearest two frames');
  top(bySelf, 20, 'by allocating function (self)');
  const text = lines.join('\n');
  console.log(text);
  return text;
}

const report = [];
// Live: start sampling as the page starts, stop once the city has settled.
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&perflog=0&time=night&weather=clear&${where}${extra}`, { waitUntil: 'commit', timeout: 300000 });
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 65536 });
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 400000, polling: 1000 });
await page.evaluate(() => (document.getElementById('overlay').hidden = true));
if (mode === 'drive') {
  await page.waitForFunction(() => typeof window.__drive === 'function' && window.__auto, null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.__drive());
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__gps('asagiri_station.platform'));
  await page.evaluate(() => window.__auto.set('traffic'));
}
await page.waitForTimeout(8000);
for (let i = 0; i < 30 && (await page.evaluate(() => window.__district.inFlightCount ?? 0)); i++) await page.waitForTimeout(1000);
await page.evaluate(() => window.gc?.());
const atRest = await heap();
const live = (await cdp.send('HeapProfiler.stopSampling')).profile;
report.push(`heap after boot and a full collection: ${atRest} MB (mode ${mode})`);
console.log(report[0]);
// The sampling profile counts objects, not the memory behind typed arrays: V8's own split, and a census of the
// buffers the scene still holds on the CPU (geometry attributes, index buffers, data textures), by top-level group.
const usage = await cdp.send('Runtime.getHeapUsage');
const mbs = (v) => `${(v / 1048576).toFixed(0)} MB`;
report.push(`V8: used ${mbs(usage.usedSize)} of ${mbs(usage.totalSize)}, array buffers ${mbs(usage.backingStorageSize ?? 0)}, embedder ${mbs(usage.embedderHeapUsedSize ?? 0)}`);
console.log(report.at(-1));
const census = await page.evaluate(() => {
  const seen = new Set();
  const groups = new Map();
  let total = 0;
  const add = (g, kind, arr) => {
    if (!arr || !arr.buffer || seen.has(arr.buffer)) return;
    seen.add(arr.buffer);
    const e = groups.get(g) ?? { geo: 0, index: 0, tex: 0, n: 0 };
    e[kind] += arr.buffer.byteLength;
    e.n++;
    groups.set(g, e);
    total += arr.buffer.byteLength;
  };
  for (const top of window.__scene.children) {
    const g = `${top.name || top.type}(${top.children.length})`;
    top.traverse((o) => {
      const geo = o.geometry;
      if (geo) {
        for (const a of Object.values(geo.attributes)) add(g, 'geo', a.array ?? a.data?.array);
        if (geo.index) add(g, 'index', geo.index.array);
        for (const list of Object.values(geo.morphAttributes ?? {})) for (const a of list) add(g, 'geo', a.array);
      }
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) for (const v of Object.values(m)) if (v && v.isDataTexture) add(g, 'tex', v.image?.data);
      if (o.isInstancedMesh) {
        add(g, 'geo', o.instanceMatrix?.array);
        add(g, 'geo', o.instanceColor?.array);
      }
    });
  }
  return { total, groups: [...groups].sort((a, b) => b[1].geo + b[1].index + b[1].tex - (a[1].geo + a[1].index + a[1].tex)).slice(0, 25) };
});
report.push(`buffers the scene holds on the CPU: ${mbs(census.total)}`);
for (const [g, e] of census.groups) report.push(`  ${mbs(e.geo + e.index + e.tex).padStart(7)}  ${g}  (attributes ${mbs(e.geo)}, index ${mbs(e.index)}, data textures ${mbs(e.tex)}, ${e.n} buffers)`);
console.log(report.slice(-1 - census.groups.length).join('\n'));
report.push(summarize(live, 'LIVE after boot (sampled, so roughly)', 0));

// Churn: everything allocated over the window, collected or not.
const h0 = await heap();
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
const t0 = Date.now();
await page.waitForTimeout(secs * 1000);
const churn = (await cdp.send('HeapProfiler.stopSampling')).profile;
const el = (Date.now() - t0) / 1000;
const frames = await page.evaluate(() => {
  const p = window.__perf;
  const mean = (a) => a.slice(-300).reduce((s, x) => s + x, 0) / Math.max(1, Math.min(300, a.length));
  return { cpu: +mean(p.cpu).toFixed(1), gpu: +mean(p.gpu).toFixed(1), frames: p.cpu.length };
});
report.push(`churn window ${el.toFixed(1)} s, heap ${h0} -> ${await heap()} MB, frame ${JSON.stringify(frames)}`);
console.log(report.at(-1));
report.push(summarize(churn, `CHURN over ${el.toFixed(0)} s (${mode})`, el));
writeFileSync(`${out}/heap_${mode}.txt`, report.join('\n'));
await browser.close();
await server.close();
