// Mack smoking in the city (J): lighting up and a first breath, in third person and from his eyes, at night.
//   node debug-shots/macksmokecity.mjs <outdir> [query] [spawn]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/macksmokecity';
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const spawn = process.argv[4] ?? 'kaburo_crossing.view';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 1500)); });
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=${spawn}&clock=21:30&weather=clear${extra}`, { timeout: 240000 });
await page.waitForFunction(() => window.__district && window.__perf, null, { timeout: 240000 });
await page.waitForTimeout(9000);
const key = (code, shiftKey = false) => page.evaluate(([code, shiftKey]) => window.dispatchEvent(new KeyboardEvent('keydown', { code, shiftKey, bubbles: true })), [code, shiftKey]);
let n = 0;
const snap = async (name) => page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}_${name}.png` });
const frame = () => page.evaluate(() => { const p = window.__perf; const t = p?.cpu?.slice?.(-120) ?? []; return t.length ? +(t.reduce((a, b) => a + b, 0) / t.length).toFixed(2) : null; });
await key('KeyQ');
await page.waitForTimeout(800);
await snap('third_before');
console.log('cpu ms before', await frame());
await key('KeyJ');
for (const ms of [600, 500, 500, 500, 600, 800, 1500]) {
  await page.waitForTimeout(ms);
  await snap('third_lighting');
}
console.log('cpu ms smoking', await frame());
await key('KeyQ');
await page.waitForTimeout(6000);
await snap('eyes_held');
await page.waitForTimeout(5000);
await snap('eyes_later');
await key('KeyX');
await page.waitForTimeout(1500);
await snap('eyes_gun_out');
await key('KeyX');
await key('KeyQ');
await page.waitForTimeout(900);
await key('KeyJ');
for (const ms of [450, 400, 900]) {
  await page.waitForTimeout(ms);
  await snap('third_flick');
}
await browser.close();
await server.close();
writeGallery(out);
