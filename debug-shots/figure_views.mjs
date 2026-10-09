// A rigged figure in figures.html, lit, as the game sees it: idle and walking at 2 m, the face close, a quarter view of it, from behind.
//   node debug-shots/figure_views.mjs <figure under debug-shots/props/, e.g. tpose/wrap_rigged3.glb> <out prefix>
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const [fig, out] = process.argv.slice(2);
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('ERROR', m.text().slice(0, 300)); });
const shots = [['full', 'Idle_Loop', [0, 1.2, 2.6, 0, 0.9, 0]], ['walk', 'Walk_Normal_105_Loop', [0, 1.2, 2.6, 0, 0.9, 0]], ['face', 'Idle_Loop', [0, 1.62, 0.6, 0, 1.55, 0]], ['faceq', 'Idle_Loop', [0.45, 1.62, 0.5, 0, 1.55, 0]], ['back', 'Idle_Loop', [0, 1.3, -1.8, 0, 1.0, 0]]];
await page.goto(`${server.resolvedUrls.local[0]}figures.html?figure=${fig}&light=studio&dist=2&clip=Idle_Loop`);
await page.waitForFunction(() => window.__figures && window.__figures.ready(), null, { timeout: 120000, polling: 500 });
await page.waitForTimeout(2500);
for (const [name, clip, v] of shots) {
  await page.evaluate(async (c) => { await window.__figures.setClip(c); }, clip);
  await page.evaluate((v) => window.__view(...v), v);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}_${name}.png` });
}
await browser.close(); await server.close(); process.exit(0);
