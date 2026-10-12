// Mack smoking in the city (J): lighting up and a first breath, in third person and from his eyes, at night.
//   node debug-shots/cigarmouth.mjs <outdir> [query] [spawn]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/cigarmouth2';
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const spawn = process.argv[4] ?? 'kaburo_crossing.view';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 1500)); });
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=${spawn}&clock=15:00&weather=clear${extra}`, { timeout: 240000 });
await page.waitForFunction(() => window.__district && window.__perf, null, { timeout: 240000 });
await page.waitForTimeout(9000);
const key = (code, shiftKey = false) => page.evaluate(([code, shiftKey]) => window.dispatchEvent(new KeyboardEvent('keydown', { code, shiftKey, bubbles: true })), [code, shiftKey]);
let n = 0;
const snap = async (name) => page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}_${name}.png` });
await key('KeyQ');
await page.waitForTimeout(800);

await page.waitForTimeout(300);
await key('KeyJ');
await page.waitForTimeout(6000);
await page.evaluate(async () => {
  const T = await import('/node_modules/three/build/three.module.js');
  const sm = window.__mack().smoking;
  for (const [color, key] of [[0xff0000, 'mouth'], [0x00ff00, 'tip']]) {
    const m = new T.Mesh(new T.SphereGeometry(0.0025, 8, 6), new T.MeshBasicMaterial({ color, depthTest: false }));
    m.renderOrder = 9999; m.frustumCulled = false;
    m.onBeforeRender = () => { m.position.copy(sm.out[key]); m.updateMatrixWorld(); };
    window.__scene.add(m);
  }
});
const probe = async () => ({ lift: await page.evaluate(() => window.__mack().smoking.lift) });
for (const a of [60, 30, 30, 30, 30, 30]) {
  await page.evaluate((a) => window.__turn?.(a), a);
  await page.waitForTimeout(600);
  for (let i = 0; i < 80; i++) { const p = await probe(); if (p.lift > 0.95) break; await page.waitForTimeout(250); }
  await page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}_mark.png`, clip: { x: 540, y: 300, width: 520, height: 380 } });
}
await browser.close();
await server.close();
