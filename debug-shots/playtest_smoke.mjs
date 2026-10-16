// Smoke test of the shared build (npm run build:share): serves dist-share/ as a plain static site, loads the city in
// a fresh browser profile, and checks the console, the things-to-try panel and "Take me there".
//   node debug-shots/playtest_smoke.mjs [out dir]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { ROOT, gpuQueue } from '../scripts/shotServer.mjs';
await gpuQueue('shared');
const out = process.argv[2] ?? join(ROOT, 'debug-shots', 'playtest');
mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.ogg': 'audio/ogg', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
const dist = join(ROOT, 'dist-share');
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = join(dist, p);
  if (!f.startsWith(dist) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' });
  createReadStream(f).pipe(res);
}).listen(0);
const base = `http://localhost:${server.address().port}`;
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const problems = [];
page.on('pageerror', (e) => problems.push('PAGEERROR ' + e));
page.on('console', (m) => { if (m.type() === 'error') problems.push('console.error ' + m.text()); });
page.on('requestfailed', (r) => problems.push('requestfailed ' + r.url()));
page.on('response', (r) => { if (r.status() >= 400) problems.push(r.status() + ' ' + r.url()); });
const t0 = Date.now();
await page.goto(`${base}/`);
await page.waitForFunction(() => document.body.innerText.includes('THINGS TO TRY'), null, { timeout: 120000 });
console.log('first load to panel', ((Date.now() - t0) / 1000).toFixed(1), 's');
await page.waitForTimeout(8000);
await page.screenshot({ path: join(out, '1_first_run.png') });
const count = await page.evaluate(() => [...document.querySelectorAll('input[type=checkbox]')].length);
console.log('tasks', count);
// Press every "Take me there" in turn, noting what toasts appear.
const buttons = await page.$$('button');
let n = 0;
for (let i = 0; i < 60; i++) {
  await page.keyboard.press('F1').catch(() => {});
  break;
}
console.log('F1 toggled');
await page.keyboard.press('F1');
const labels = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.textContent === 'Take me there').length);
console.log('take-me buttons', labels);
for (const idx of [0, 6, 12, 20]) {
  const b = (await page.$$('button')).filter(async () => true);
  const handle = await page.evaluateHandle((i) => [...document.querySelectorAll('button')].filter((x) => x.textContent === 'Take me there')[i], idx);
  await handle.asElement()?.click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: join(out, `2_go_${idx}.png`) });
  await page.keyboard.press('F1');
}
// Debug menu opens for everyone.
await page.keyboard.press('Backquote');
await page.waitForTimeout(800);
await page.screenshot({ path: join(out, '3_debug_menu.png') });
console.log('problems:', problems.length ? '\n' + [...new Set(problems)].slice(0, 30).join('\n') : 'none');
await browser.close();
server.close();
process.exit(0);
