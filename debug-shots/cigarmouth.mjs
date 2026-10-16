// Mack smoking in the city (J): lighting up and a first breath, in third person and from his eyes, at night.
//   node debug-shots/cigarmouth.mjs <outdir> [query] [spawn]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/cigarmouth';
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const spawn = process.argv[4] ?? 'kaburo_crossing.view';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 3 });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 1500)); });
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=${spawn}&clock=18:30&weather=rain${extra}`, { timeout: 240000 });
await page.waitForFunction(() => window.__district && window.__perf, null, { timeout: 240000 });
await page.waitForTimeout(9000);
const key = (code, shiftKey = false) => page.evaluate(([code, shiftKey]) => window.dispatchEvent(new KeyboardEvent('keydown', { code, shiftKey, bubbles: true })), [code, shiftKey]);
let n = 0;
const snap = async (name) => page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}_${name}.png` });
await key('KeyQ');
await page.waitForTimeout(800);
await key('KeyJ', true);
await page.waitForTimeout(300);
await key('KeyJ');
await page.waitForTimeout(9000);
await key('Digit1');
await page.waitForTimeout(3500);
for (const a of [0, 45, 45, 45, 45, 45, 45, 45]) {
  await page.evaluate((a) => window.__turn?.(a), a);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}_head.png`, clip: { x: 540, y: 380, width: 260, height: 170 } });
}
await browser.close();
await server.close();
