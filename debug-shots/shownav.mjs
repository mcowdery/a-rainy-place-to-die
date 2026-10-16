// The showroom menu (` opens it): opens a few showroom pages, presses the key, shoots the menu, and goes to another room with Enter.
//   node debug-shots/shownav.mjs <out dir> [page ...]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/shownav';
mkdirSync(out, { recursive: true });
const pages = process.argv.length > 3 ? process.argv.slice(3) : ['models-cars-ph.html', 'mob.html', 'scenes.html', 'fight.html', 'anims.html', 'humans.html'];
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
for (const p of pages) {
  await page.goto(base + p, { timeout: 300000 });
  await page.waitForTimeout(6000);
  await page.keyboard.press('Backquote');
  await page.waitForTimeout(500);
  const open = await page.evaluate(() => document.body.innerText.includes('click or Enter to go'));
  console.log(p, 'menu open:', open);
  await page.screenshot({ path: `${out}/${p.replace('.html', '')}.png` });
  await page.keyboard.press('Backquote');
  const closed = await page.evaluate(() => !document.body.innerText.includes('click or Enter to go'));
  console.log(p, 'closed again:', closed);
}
// And go somewhere: from the first page, open the menu and press Enter on the third entry.
await page.goto(base + pages[0], { timeout: 300000 });
await page.waitForTimeout(4000);
await page.keyboard.press('Backquote');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await page.waitForTimeout(4000);
console.log('went to', page.url().split('/').pop());
await browser.close();
await server.close();
