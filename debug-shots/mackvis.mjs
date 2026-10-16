// Is Mack drawn on foot, in third person, and after a ride? node debug-shots/mackvis.mjs [out dir]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/mackvis';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: false, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console.error', m.text().slice(0, 300)); });
  await page.goto(`${base}?debug=1&diag=1&clock=12:00&spawn=city_garage.front`);
  await page.waitForFunction(() => !!window.__mack && !!window.__camera, null, { timeout: 180000 });
  await page.waitForFunction(() => !/COMPILING|UPLOADING|LOADING/i.test(document.body.innerText), null, { timeout: 240000 });
  await page.waitForTimeout(45000);
  const st = () => page.evaluate(() => { const m = window.__mack(); return { has: !!m, visible: m?.object.visible, riderActive: window.__rider?.active, third: localStorage.getItem('rainyplace.thirdPerson') }; });
  console.log('on foot', JSON.stringify(await st()));
  await page.mouse.click(640, 360);
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(1500);
  console.log('after V', JSON.stringify(await st()));
  await page.screenshot({ path: `${out}/third.png` });
} finally {
  await browser.close();
  await server.close();
}
