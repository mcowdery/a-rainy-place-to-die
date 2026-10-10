// Where does the district page's load time go? Loads index.html in the installed Edge and reports the boot
// phases (performance marks in district/main.ts), the slowest and biggest requests, and main-thread long tasks.
//   node scripts/loadProfile.mjs                  dev server of its own (cold Vite transforms included)
//   node scripts/loadProfile.mjs --runs 2         load twice in one server: run 2 shows the warm-cache cost
//   node scripts/loadProfile.mjs --url http://localhost:4173/   an already-running server, e.g. `vite preview` of a build
//   node scripts/loadProfile.mjs --query "quality=low"          extra URL settings
// Run 1 on a dev server is a cold start; the browser profile is fresh each run, so HTTP caching isn't what differs.
import { launchBrowser } from './launchBrowser.mjs';
import { shotServer } from './shotServer.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const runs = Number(arg('--runs') ?? 1);
const extra = arg('--query') ? `&${arg('--query')}` : '';
const given = arg('--url');
let server = null;
let base = given;
if (!base) {
  server = await shotServer({ server: { port: 0 }, logLevel: 'silent' }, { gpu: 'exclusive' });
  await server.listen();
  base = server.resolvedUrls.local[0];
}
const browser = await launchBrowser({
  channel: 'msedge',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const fmt = (n) => `${Math.round(n)}`.padStart(7);
try {
  for (let run = 1; run <= runs; run++) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      window.__long = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
    });
    const cdp = process.argv.includes('--cpu') ? await ctx.newCDPSession(page) : null;
    if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start'); }
    const t0 = Date.now();
    await page.goto(`${base}?time=night${process.argv.includes('--programs') ? '&bootdiag=1' : ''}${extra}`, { waitUntil: 'commit' });
    await page.waitForFunction(() => performance.getEntriesByName('boot:first-frame').length > 0, null, { timeout: 300_000, polling: 250 });
    const wall = Date.now() - t0;
    const r = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const marks = performance.getEntriesByType('mark').filter((m) => m.name.startsWith('boot:')).map((m) => [m.name + (m.detail?.programs != null ? ` (${m.detail.programs} programs)` : ''), m.startTime]);
      const res = performance.getEntriesByType('resource').map((e) => ({
        name: e.name.replace(location.origin, ''), type: e.initiatorType, start: e.startTime, dur: e.duration,
        kb: (e.transferSize || e.encodedBodySize || 0) / 1024,
      }));
      const names = Object.fromEntries(performance.getEntriesByType('mark').filter((m) => m.detail?.names).map((m) => [m.name, m.detail.names]));
      return { names, nav: { dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, ttfb: nav.responseStart }, marks, res, long: window.__long };
    });
    console.log(`\n## Run ${run}: first frame ${wall} ms wall · ${r.res.length} requests · ${(r.res.reduce((a, e) => a + e.kb, 0) / 1024).toFixed(1)} MB`);
    console.log(`document: first byte ${fmt(r.nav.ttfb)} ms · DOMContentLoaded ${fmt(r.nav.dcl)} ms`);
    console.log('boot phases (ms since navigation start, and the step since the previous mark):');
    let prev = r.nav.ttfb;
    for (const [name, t] of r.marks) { console.log(`  ${name.padEnd(20)} ${fmt(t)}   +${fmt(t - prev)}`); prev = t; }
    if (process.argv.includes('--programs')) {
      const at = (n) => new Set(r.names[n] ?? []);
      const first = at('boot:compile-end');
      const count = (set) => [...set].map((s) => s.replace(/#\d+$/, '')).reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map());
      const pre = (s) => s.replace(/#\d+$/, '').split(',').slice(0, 2).join(',');
      const lateKeys = [...at('boot:render-end')].filter((s) => !first.has(s));
      const early = [...first].find((s) => s.startsWith('2,3,'));
      const lateP = lateKeys.find((s) => s.startsWith('2,3,'));
      if (early && lateP) {
        const a = early.split(','), b = lateP.split(',');
        const diffs = [];
        for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diffs.push(`[${i}] ${a[i]} -> ${b[i]}`);
        console.log('cache key differences, program 2,3 early vs late:', diffs.join(' | '));
      }
      console.log('programs compiled by compileAsync:', [...count(first)].map(([k, n]) => `${k}×${n}`).join(', '));
      const late = new Set([...at('boot:render-end')].filter((s) => !first.has(s)));
      console.log('programs first compiled by the render (not covered by compileAsync):', [...count(late)].map(([k, n]) => `${k}×${n}`).join(', '));
    }
    const scripts = r.res.filter((e) => e.type === 'script' || e.type === 'link' || e.type === 'css');
    console.log(`modules/styles: ${scripts.length} requests, last one finished at ${fmt(Math.max(0, ...scripts.map((e) => e.start + e.dur)))} ms`);
    console.log('slowest requests:');
    for (const e of [...r.res].sort((a, b) => b.dur - a.dur).slice(0, 10)) console.log(`  ${fmt(e.dur)} ms  ${String(Math.round(e.kb)).padStart(6)} KB  ${e.type.padEnd(8)} ${e.name.slice(0, 90)}`);
    console.log('biggest requests:');
    for (const e of [...r.res].sort((a, b) => b.kb - a.kb).slice(0, 10)) console.log(`  ${String(Math.round(e.kb)).padStart(6)} KB  ${fmt(e.dur)} ms  ${e.type.padEnd(8)} ${e.name.slice(0, 90)}`);
    const total = r.long.reduce((a, [, d]) => a + d, 0);
    console.log(`main-thread long tasks (>50 ms): ${r.long.length}, ${Math.round(total)} ms in all; longest:`);
    for (const [s, d] of [...r.long].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${fmt(d)} ms at ${fmt(s)}`);
    if (cdp) {
      // Self time per function (main thread), and per source file, over the whole load.
      const { profile } = await cdp.send('Profiler.stop');
      const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      const self = new Map();
      profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
      const fn = new Map(), file = new Map();
      for (const [id, us] of self) {
        const cf = byId.get(id).callFrame;
        const f = (cf.url || '(native)').replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
        const key = `${cf.functionName || '(anon)'}  ${f}:${cf.lineNumber + 1}`;
        fn.set(key, (fn.get(key) ?? 0) + us / 1000);
        file.set(f, (file.get(f) ?? 0) + us / 1000);
      }
      const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
      console.log('CPU self time by function (ms):');
      for (const [k, ms] of top(fn, 18)) console.log(`  ${fmt(ms)}  ${k.slice(0, 120)}`);
      console.log('CPU self time by file (ms):');
      for (const [k, ms] of top(file, 12)) console.log(`  ${fmt(ms)}  ${k.slice(0, 100)}`);
    }
    if (errors.length) console.log(`page errors: ${errors.slice(0, 5).join(' | ')}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  if (server) await server.close();
}
