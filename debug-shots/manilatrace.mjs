// Samples rival 0's speed through a Manila street race: node debug-shots/manilatrace.mjs [race id] [seconds] [car index]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const id = process.argv[2] ?? 'baywalk_sprint';
const seconds = Number(process.argv[3] ?? 60);
const k = Number(process.argv[4] ?? 0);
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?city=manila&debug=1&diag=1&clock=14:00&weather=clear&season=summer`, { timeout: 300000 });
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 400000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForTimeout(3000);
await page.evaluate(([id, k]) => {
  window.__samples = [];
  window.__streetRace.start(id);
  setInterval(() => {
    const r = window.__streetRace.race;
    if (!r.state || r.state.phase !== 'running') return;
    const c = r.cars[k];
    window.__samples.push([+r.state.t.toFixed(1), Math.round(c.sim.x), Math.round(c.sim.z), Math.round(c.sim.u * 3.6), c.status.split(',')[0], r.state.passed[k + 1]]);
  }, 250);
}, [id, k]);
await page.waitForTimeout(seconds * 1000);
const s = await page.evaluate(() => window.__samples);
for (const row of s) console.log(row.join('\t'));
await browser.close();
await server.close();
