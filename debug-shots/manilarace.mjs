// Runs a Manila street race with your car parked on the grid, and reports how the rivals get on.
//   node debug-shots/manilarace.mjs <out dir> [race id] [seconds]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/manilarace';
const id = process.argv[3] ?? 'baywalk_sprint';
const seconds = Number(process.argv[4] ?? 60);
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 400)); });
await page.goto(`${server.resolvedUrls.local[0]}?city=manila&debug=1&diag=1&clock=14:00&weather=clear&season=summer`, { timeout: 300000 });
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 400000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForTimeout(3000);
await page.evaluate((id) => window.__streetRace.start(id), id);
await page.waitForTimeout(2500);
const report = () => page.evaluate(() => {
  const r = window.__streetRace.race;
  const st = r.state;
  if (!st) return 'no race';
  return JSON.stringify({ phase: st.phase, t: +st.t.toFixed(1), standings: st.standings().map((s) => `${s.place}:${st.names[s.who]} ${s.gates}/${st.goals.length}${s.out ? ' ' + s.out : ''}`), cars: r.cars.map((c) => `${c.mode} ${Math.round(c.sim.u * 3.6)}kmh @${Math.round(c.sim.x)},${Math.round(c.sim.z)} ${c.status}`) });
});
console.log(await report());
console.log('PAGE:', (await page.evaluate(() => document.body.innerText)).slice(0, 400).split('\n').join(' | '));
await page.screenshot({ path: `${out}/grid.png` });
for (let t = 5; t <= seconds; t += 5) {
  await page.waitForTimeout(5000);
  console.log(await report());
  if (t % 15 === 0) await page.screenshot({ path: `${out}/t${t}.png` });
}
if (process.env.RETIRE) { await page.evaluate(() => window.__streetRace.race.state.retire(0, 'TEST')); await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/result.png` }); }
await browser.close();
await server.close();
