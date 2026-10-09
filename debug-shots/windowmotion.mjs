// How the rooms behind the windows move, as a passer-by sees it (real/city.ts): a street of windows at night stepped
// through for ten seconds, a shot every quarter second, then how much of the picture changes from one shot to the
// next (a pop is a step that changes far more than its neighbours).
//   node debug-shots/windowmotion.mjs <out dir> [query] [spawn] [yaw:pitch] [seconds] [step ms]
// Writes f000.png... and prints the share of pixels that changed by more than a tenth at each step.
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync, writeFileSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/windowpeople/motion';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '&clock=23:00&windowFolk=3';
const spawn = process.argv[4] ?? 'toto_bank.front';
const [yaw, pitch] = (process.argv[5] ?? '270:14').split(':').map(Number);
const seconds = Number(process.argv[6] ?? 10);
const stepMs = Number(process.argv[7] ?? 250);
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 600)); });
await page.goto(`${server.resolvedUrls.local[0]}?diag=1&weather=clear&res=100&spawn=${spawn}${extra}`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 400000, polling: 250 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; document.getElementById('hud').style.display = 'none'; });
const base = await page.evaluate(() => (new window.__camera.rotation.constructor().setFromQuaternion(window.__camera.quaternion, 'YXZ').y * 180) / Math.PI);
await page.evaluate(([y, p]) => window.__look(y, p), [base + yaw, pitch]);
await page.waitForTimeout(12000);
// The frames are read from the game's own canvas in the page, on its clock, so they're evenly apart whatever a
// screenshot costs: the upper half of the picture (the facades), at half size.
const frames = await page.evaluate(async ([n, dt]) => {
  const src = document.querySelector('canvas');
  const cv = document.createElement('canvas');
  cv.width = 800;
  cv.height = 300;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const shots = [];
  const share = [];
  let last = null;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    await new Promise((r) => setTimeout(r, Math.max(0, t0 + i * dt - performance.now())));
    await new Promise((r) => requestAnimationFrame(r));
    g.drawImage(src, 0, 0, src.width, src.height * (2 / 3), 0, 0, 800, 300);
    const px = g.getImageData(0, 0, 800, 300).data;
    if (last) {
      let changed = 0;
      for (let k = 0; k < px.length; k += 4) if (Math.abs(px[k] - last[k]) + Math.abs(px[k + 1] - last[k + 1]) + Math.abs(px[k + 2] - last[k + 2]) > 76) changed++;
      share.push(+((changed / (800 * 300)) * 100).toFixed(3));
    }
    last = px.slice();
    shots.push(cv.toDataURL('image/png'));
  }
  return { shots, share };
}, [Math.round((seconds * 1000) / stepMs), stepMs]);
frames.shots.forEach((u, i) => writeFileSync(`${out}/f${String(i).padStart(3, '0')}.png`, Buffer.from(u.split(',')[1], 'base64')));
const s = [...frames.share].sort((a, b) => a - b);
console.log(`${frames.shots.length} frames ${stepMs} ms apart in ${out}`);
console.log('share of the picture changed at each step (%):', frames.share.join(' '));
console.log(`median ${s[Math.floor(s.length / 2)]} · largest ${s[s.length - 1]} · sum ${s.reduce((a, b) => a + b, 0).toFixed(2)}`);
await browser.close();
await server.close();
