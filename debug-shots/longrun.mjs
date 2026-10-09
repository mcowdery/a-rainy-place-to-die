// The long run (district/chase.ts, the 'gauntlet' kind): starts it, lets the auto drive take your car toward the end
// (fast, no shooting back) and logs the swarm: cars on you, kills, roadblocks, your health and the car's damage.
// node debug-shots/longrun.mjs <out dir> [seconds to run] [spawn]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/longrun';
const secs = Number(process.argv[3] ?? 120);
const spawn = process.argv[4] ?? 'city_garage.front';
// 'block': once a roadblock stands, put your car 100 m short of it facing it and photograph it (then the auto drive tries it).
const mode = process.argv[5] ?? 'run';
const ram = mode === 'ram';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('crash', () => console.log('PAGE CRASHED'));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300));
});
await page.addInitScript(() => localStorage.setItem('citypop.driveView', 'chase'));
await page.goto(`${server.resolvedUrls.local[0]}district.html?debug=1&diag=1&spawn=${spawn}&car=home&clock=22:30&weather=clear`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
});
await page.waitForFunction(() => typeof window.__drive === 'function' && window.__chase, null, { timeout: 60000 });
await page.waitForTimeout(3000);
let n = 0;
const shot = async (name) => page.screenshot({ path: `${out}/${String(n++).padStart(2, '0')}_${name}.png` });
const info = () =>
  page.evaluate(() => {
    const s = window.__own.sim;
    const c = window.__chase.chase;
    const st = c.state;
    return {
      at: [Math.round(s.x), Math.round(s.z)],
      kmh: Math.round(s.u * 3.6),
      damage: Math.round(window.__own.condition),
      phase: st?.phase,
      t: st && +st.t.toFixed(0),
      hp: st && Math.round(st.health),
      kills: st?.kills,
      live: st?.live,
      cars: c.cars.length,
      blocks: c.blocks.map((k) => [Math.round(k.x), Math.round(k.z), k.cars.length, Math.round(Math.hypot(k.x - s.x, k.z - s.z))]),
      nearest: c.cars.map((k) => Math.round(Math.hypot(k.sim.x - s.x, k.sim.z - s.z))).sort((a, b) => a - b).slice(0, 5),
      modes: c.cars.map((k) => k.mode).join(','),
      result: st?.result,
    };
  });
console.log(await page.evaluate(() => window.__drive()));
await page.waitForTimeout(1500);
console.log('start', await page.evaluate(() => window.__chase.start('long_run')));
await page.waitForTimeout(1000);
console.log('placed', JSON.stringify(await info()));
await shot('grid');
await page.waitForTimeout(5500);
if (ram) await page.evaluate(() => (window.__ram = true));
if (mode === 'block' || ram) {
  for (let k = 0; k < 40 && !(await page.evaluate(() => window.__chase.chase.blocks.length)); k++) await page.waitForTimeout(1000);
  console.log('block', await page.evaluate(() => {
    const k = window.__chase.chase.blocks[0];
    const s = window.__own.sim;
    // (mode 'ram': straight at the first car of it, 60 m off, under your own throttle.)
    const t = window.__ram ? k.cars[0].sim : k;
    const h = Math.atan2(t.x - s.x, t.z - s.z);
    const back = window.__ram ? 60 : 100;
    window.__own.place(t.x - Math.sin(h) * back, t.z - Math.cos(h) * back, h, s.y);
    return { x: Math.round(k.x), z: Math.round(k.z), cars: k.cars.map((c) => [c.def.type, Math.round(c.sim.x), Math.round(c.sim.z), Math.round((c.sim.h * 180) / Math.PI)]) };
  }));
  await page.waitForTimeout(1500);
  await shot('block_far');
  if (ram) await page.keyboard.down('KeyW');
  else await page.evaluate(() => window.__auto.set('fast'));
  for (let k = 0; k < 24; k++) {
    await page.waitForTimeout(450);
    if (k % 3 === 0) await shot(`block_${k}`);
    console.log(
      JSON.stringify(
        await page.evaluate(() => {
          const s = window.__own.sim;
          const b = window.__chase.chase.blocks[0];
          return { you: [+s.x.toFixed(1), +s.z.toFixed(1), Math.round(s.u * 3.6)], dmg: Math.round(window.__own.condition), block: b?.cars.map((c) => [+c.sim.x.toFixed(1), +c.sim.z.toFixed(1), +c.sim.u.toFixed(1)]) };
        }),
      ),
    );
  }
  if (ram) await page.keyboard.up('KeyW');
} else await page.evaluate(() => window.__auto.set('fast'));
for (let t = 0; t < secs; t += 3) {
  await page.waitForTimeout(3000);
  const i = await info();
  console.log(t + 3, JSON.stringify(i));
  if (i.blocks.some((b) => b[3] < 140) || t % 15 === 0) await shot(`t${t + 3}`);
  if (i.result) break;
}
await shot('end');
await browser.close();
await server.close();
