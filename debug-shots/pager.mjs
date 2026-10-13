// The pager on screen (src/phone/pagerUi.ts): a page comes, it's held up, he steps through its memory, puts it away.
// node debug-shots/pager.mjs [out dir] [extra query]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/pager';
const extra = process.argv[3] ?? '';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('console', m.text().slice(0, 300)); });
  await page.goto(`${base}?debug=1&spawn=kaburo_crossing.view&start=street&clock=22:40&weather=rain${extra ? '&' + extra : ''}`);
  await page.waitForFunction(() => window.__phone && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240_000, polling: 500 });
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
  await page.waitForTimeout(4000);
  const state = () => page.evaluate(() => ({ open: window.__phone.pager.open, pages: window.__phone.phone.pages().map((p) => p.digits), root: !document.querySelector('.pg-root').hidden, dot: !document.querySelector('.pg-dot').hidden }));
  console.log('before', JSON.stringify(await state()));
  await page.evaluate(() => window.__phone.pager.test('03-5550-0199'));
  await page.waitForTimeout(1200);
  console.log('paged', JSON.stringify(await state()));
  await page.screenshot({ path: `${out}/1-paged.png` });
  await page.locator('.pg-root').screenshot({ path: `${out}/1-paged-close.png` });
  // It puts itself away after a few seconds, leaving the red dot.
  await page.waitForTimeout(9500);
  console.log('put away', JSON.stringify(await state()));
  await page.screenshot({ path: `${out}/2-away.png` });
  // A second page, a number code; then P, and back through the memory.
  await page.evaluate(() => window.__phone.pager.test('724106', 'なにしてる'));
  await page.waitForTimeout(800);
  await page.locator('.pg-root').screenshot({ path: `${out}/3-code-close.png` });
  await page.keyboard.press('BracketLeft');
  await page.waitForTimeout(300);
  console.log('stepped', JSON.stringify(await state()));
  await page.locator('.pg-root').screenshot({ path: `${out}/4-memory-close.png` });
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  console.log('erased', JSON.stringify(await state()));
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(200);
  console.log('P', JSON.stringify(await state()));
} finally {
  await browser.close();
  await server.close();
}
