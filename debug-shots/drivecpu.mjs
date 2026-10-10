// A CPU profile (Chrome's sampling profiler) of driving your own car through the city on the auto-pilot: the functions
// and files with the most self time, and the frame's own CPU/GPU times (the recorder found driving ~10-15 ms of CPU a
// frame dearer than walking in the same place). Runs exclusive (it times frames).
//   node debug-shots/drivecpu.mjs [seconds] [mode] [node id] [query]
//   node debug-shots/drivecpu.mjs 30 traffic asagiri_station.platform "weather=clear"
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const secs = Number(process.argv[2] ?? 30);
const mode = process.argv[3] ?? 'traffic';
const dest = process.argv[4] ?? 'asagiri_station.platform';
const extra = process.argv[5] ? `&${process.argv[5]}` : '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=city_garage.front&car=home&clock=22:30&res=100&perflog=0${extra}`, { timeout: 180000 });
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => (document.getElementById('overlay').hidden = true));
await page.waitForFunction(() => typeof window.__drive === 'function' && window.__auto, null, { timeout: 60000 });
await page.waitForTimeout(3000);
console.log(await page.evaluate(() => window.__drive()));
await page.waitForTimeout(1500);
console.log('gps', await page.evaluate((d) => window.__gps(d), dest));
await page.evaluate((m) => window.__auto.set(m), mode);
await page.waitForTimeout(8000);
const frames = await page.evaluate(() => {
  const p = window.__perf;
  const mean = (a) => a.slice(-120).reduce((s, x) => s + x, 0) / Math.max(1, Math.min(120, a.length));
  const o = window.__own;
  return { cpu: mean(p.cpu).toFixed(1), gpu: mean(p.gpu).toFixed(1), at: [Math.round(o.sim.x), Math.round(o.sim.z)], kmh: Math.round(o.sim.u * 3.6) };
});
console.log('before profile', JSON.stringify(frames));
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
await page.waitForTimeout(secs * 1000);
const { profile } = await cdp.send('Profiler.stop');
const after = await page.evaluate(() => {
  const p = window.__perf;
  const mean = (a) => a.slice(-120).reduce((s, x) => s + x, 0) / Math.max(1, Math.min(120, a.length));
  return { cpu: mean(p.cpu).toFixed(1), gpu: mean(p.gpu).toFixed(1) };
});
console.log('after (profiler on)', JSON.stringify(after));
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas;
const self = new Map();
const files = new Map();
profile.samples.forEach((id, i) => {
  const f = byId.get(id).callFrame;
  const file = f.url.split('/').slice(-2).join('/').replace(/\?.*/, '') || '(native)';
  const key = `${f.functionName || '(anon)'} ${file}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
  files.set(file, (files.get(file) ?? 0) + (dt[i] ?? 0));
});
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log(`total ${(total / 1000).toFixed(0)} ms sampled over ${secs}s`);
console.log('\nby function (self time)');
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`${((v / total) * 100).toFixed(1).padStart(5)}%  ${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`);
console.log('\nby file');
for (const [k, v] of [...files].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`${((v / total) * 100).toFixed(1).padStart(5)}%  ${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`);
await browser.close();
await server.close();
