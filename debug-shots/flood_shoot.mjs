// Looks at Manila (?city=manila): boots the city and takes shots from views given on the command line.
//   node debug-shots/manila.mjs <out dir> [query] [view ...]      a view is x,y,z,yaw,pitch (world metres, degrees)
// With no views, the shots are the start spawn and one from high over the middle of the map.
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/manila';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const views = process.argv.slice(4).map((v) => v.split(',').map(Number));
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e.stack ?? e).slice(0, 600)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 400)); });
await page.goto(`${server.resolvedUrls.local[0]}?city=${process.env.CITY ?? "manila"}&debug=1&diag=1&clock=${process.env.CLOCK ?? "14:00"}&weather=${process.env.WEATHER ?? "clear"}&season=summer${extra}`, { timeout: 300000 });
for (let i = 0; i < 200; i++) {
  const st = await page.evaluate(() => ({ d: !!window.__district, o: document.getElementById('overlay')?.textContent?.slice(0, 80) }));
  if (st.d && st.o === 'click to walk') break;
  if (i % 4 === 3) console.log('booting:', JSON.stringify(st));
  await page.waitForTimeout(5000);
}
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForTimeout(5000);
const set = ([x, y, z, yaw, pitch]) => page.evaluate(([x, y, z, yaw, pitch]) => {
  const cam = window.__camera;
  cam.position.set(x, y, z);
  const e = new cam.rotation.constructor(); e.set((pitch * Math.PI) / 180, (yaw * Math.PI) / 180, 0, 'YXZ');
  cam.quaternion.setFromEuler(e);
}, [x, y, z, yaw, pitch]);
const shot = async (n, wait = 2500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${n}.png` }); console.log('shot', n); };
await shot('start', 1000);
const list = views.length ? views : [[2700, 900, 1500, 0, -60]];
for (let i = 0; i < list.length; i++) { await set(list[i]); await shot(`v${i}`, 6000); }
await browser.close();
await server.close();
