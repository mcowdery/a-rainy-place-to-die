// The city's payphones, photographed from in front (real/phoneSites.ts placed them, real/payphoneField.ts draws them).
//   node debug-shots/payphones.mjs [out dir] [which] [query]
// which: `sample` (default: a spread of forty across the districts and the four kinds), `booths`, `all`, or indices
// (0,3,12). It prints how many there are of each kind. One page load; each phone is a teleport and a wait for its chunks.
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/payphones';
const which = process.argv[3] ?? 'sample';
const query = process.argv[4] ?? 'clock=10:00&weather=clear';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 240)); });
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&fly=1&res=100&${query}&cam=3335,6,1300,0,-10`, { timeout: 240000 });
  await page.waitForFunction(() => window.__district && window.__phones && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => {
    document.getElementById('overlay').hidden = true;
    for (const el of document.querySelectorAll('#hud, #info')) el.style.display = 'none';
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.evaluate(() => /MAP \+ FAST TRAVEL/.test(document.body.innerText))) await page.keyboard.press('KeyM');
  const list = (await page.evaluate(() => window.__phones.all())).map((s, i) => ({ ...s, i }));
  console.log(`${list.length} phones: ${['payphone', 'payphone_booth', 'payphone_red', 'payphone_pink'].map((k) => `${list.filter((s) => s.which === k).length} ${k}`).join(', ')}`);
  let pick;
  if (which === 'all') pick = list;
  else if (which === 'booths') pick = list.filter((s) => s.which === 'payphone_booth');
  else if (which === 'sample') {
    // A few of each kind from each district, spread through the list.
    pick = [];
    for (const d of [...new Set(list.map((s) => s.district))]) {
      for (const k of ['payphone', 'payphone_booth', 'payphone_red', 'payphone_pink']) {
        const of = list.filter((s) => s.district === d && s.which === k);
        for (const j of [0.2, 0.7]) if (of.length) pick.push(of[Math.floor(of.length * j)]);
      }
    }
    pick = [...new Set(pick)];
  } else pick = list.filter((s) => which.split(',').includes(String(s.i)));
  for (const s of pick) {
    await page.evaluate((i) => window.__phones.go(i), s.i);
    await page.waitForTimeout(6000);
    const name = `${String(s.i).padStart(3, '0')}-${s.district}-${s.which.replace('payphone_', '').replace('payphone', 'hood')}`;
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(name, `${s.x},${s.z}`);
  }
} finally {
  await browser.close();
  await server.close();
}
