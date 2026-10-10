// The phone's wallpapers (src/phone/wallpapers.ts): the home screen with the one a phone starts with, the 壁紙 app's
// grid, then the home screen with each of the others and with none.
//   node debug-shots/phonewallpaper.mjs [out dir]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/phonewallpaper';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 400)); });
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&clock=21:00&weather=clear`);
await page.waitForFunction(() => document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 400000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.keyboard.press('Tab');
await page.waitForTimeout(800);
const phone = page.locator('.ph-device');
await phone.screenshot({ path: `${out}/home_default.png` });
const openApp = async () => {
  await page.locator('.ph-app', { hasText: '壁紙' }).click();
  await page.waitForTimeout(600);
};
await openApp();
const tiles = await page.locator('.wp-tile').count();
console.log('tiles:', tiles, 'chosen:', await page.evaluate(() => [...document.querySelectorAll('.wp-tile')].findIndex((t) => t.classList.contains('wp-on'))));
await phone.screenshot({ path: `${out}/app.png` });
for (let i = 0; i < tiles; i++) {
  await page.locator('.wp-tile').nth(i).click();
  await page.locator('.ph-home').click();
  await page.waitForTimeout(500);
  const id = await page.evaluate(() => localStorage.getItem('citypop.phone.wallpaper'));
  await phone.screenshot({ path: `${out}/home_${id}.png` });
  await openApp();
}
await browser.close();
await server.close();
