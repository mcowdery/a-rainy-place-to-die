// Pooled chase cars (district/cityChase.ts): runs the long run, shoots every car that comes near so cars are put down
// and reused, then checks that each live car on the road is whole (not out, full health in the state, mended glass,
// its hit volumes carry its own id, it's driving and not standing). node debug-shots/pooltest.mjs [seconds]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const secs = Number(process.argv[2] ?? 60);
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=city_garage.front&car=home&clock=22:30&weather=clear`, { timeout: 180000 });
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => (document.getElementById('overlay').hidden = true));
await page.waitForFunction(() => typeof window.__drive === 'function' && window.__chase, null, { timeout: 60000 });
await page.waitForTimeout(3000);
await page.evaluate(() => window.__drive());
await page.evaluate(() => window.__chase.start('long_run'));
await page.evaluate(() => Object.assign(window.__chase.chase.state.def.swarm, { start: 9, max: 9 }));
await page.waitForTimeout(6500);
await page.evaluate(() => window.__auto.set('fast'));
for (let t = 0; t < secs; t += 3) {
  await page.waitForTimeout(3000);
  // (Wreck a car now and then, as the player would: its state says out, and the page clears it away for a new one.)
  await page.evaluate(() => {
    const c = window.__chase.chase;
    const st = c.state;
    const i = c.cars.findIndex((k, j) => !st.cars[j].out);
    if (i >= 0) {
      st.ram(i, 60);
      c.cars[i].finish();
    }
  });
  const r = await page.evaluate(() => {
    const c = window.__chase.chase;
    const st = c.state;
    const you = window.__own.sim;
    const bad = [];
    c.cars.forEach((k, i) => {
      const s = st.cars[i];
      const ids = new Set(k.volumes.map((v) => v.userData.id));
      if (ids.size !== 1 || !ids.has(k.id)) bad.push(`${k.id}: volume ids ${[...ids]}`);
      if (!k.out && (s.out || s.health < k.def.health * 0.2)) bad.push(`${k.id}: running but state ${JSON.stringify(s)}`);
      if (k.out !== !!s.out) bad.push(`${k.id}: out ${k.out} vs ${s.out}`);
      if (st.defs[i] !== k.def) bad.push(`${k.id}: def mismatch`);
    });
    const pool = [...c.pool.values()].map((l) => l.length).join(',');
    return { t: Math.round(st.t), cars: c.cars.length, kills: st.kills, pool, ids: c.nextId, near: c.cars.map((k) => Math.round(Math.hypot(k.sim.x - you.x, k.sim.z - you.z))).sort((a, b) => a - b).slice(0, 4), modes: c.cars.map((k) => k.mode[0]).join(''), bad, over: st.result };
  });
  console.log(JSON.stringify(r));
  if (r.over) break;
}
await browser.close();
await server.close();
