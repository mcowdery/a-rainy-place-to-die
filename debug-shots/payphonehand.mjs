// His hand on a payphone's handset (models/heldItem.ts `phone`, district/payphone.ts): reach, grip, up to the ear, back.
// Stills in order, in first person and third (Q), for the green phone, a booth and the red phone.
//   node debug-shots/payphonehand.mjs [out dir] [kinds, comma separated: payphone,payphone_booth,payphone_red,payphone_pink]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/payphonehand';
const kinds = (process.argv[3] ?? 'payphone,payphone_booth,payphone_red').split(',');
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 240)); });
  await page.addInitScript(() => { try { localStorage.setItem('citypop.thirdPerson', '0'); } catch {} });
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&res=100&clock=14:00&weather=clear&cam=3335,1.7,1300,0,0`, { timeout: 240000 });
  await page.waitForFunction(() => window.__district && window.__phones && window.__phoneUse && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => {
    document.getElementById('overlay').hidden = true;
    for (const el of document.querySelectorAll('#hud, #info')) el.style.display = 'none';
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.evaluate(() => /MAP \+ FAST TRAVEL/.test(document.body.innerText))) await page.keyboard.press('KeyM');
  const list = (await page.evaluate(() => window.__phones.all())).map((s, i) => ({ ...s, i }));
  let third = false;
  for (const view of ['first', 'third']) {
    if (view === 'third') {
      await page.keyboard.press('KeyQ');
      third = true;
    }
    for (const kind of kinds) {
      const s = list.find((q) => q.which === kind && q.district === 'neon') ?? list.find((q) => q.which === kind);
      if (!s) continue;
      const name = `${view}-${kind.replace('payphone_', '').replace('payphone', 'hood')}`;
      // At it (inside, for a booth); in third person the camera stands off to the side so his arm is seen.
      await page.evaluate(([i, back, side, up]) => window.__phones.go(i, back, side, up), [s.i, kind === 'payphone_booth' ? 0.25 : 1.15, 0, 1.7]);
      await page.waitForTimeout(2500);
      if (third) {
        // (His body is under the camera: step the camera back and to the side of where he stands.)
        await page.evaluate(([i]) => window.__phones.go(i, 1.15, 0, 1.7), [s.i]);
        await page.waitForTimeout(800);
      }
      const frames = [];
      const grab = async (tag) => {
        const f = `${out}/${name}-${String(frames.length).padStart(2, '0')}-${tag}.png`;
        await page.screenshot({ path: f });
        frames.push(f);
      };
      await grab('stand');
      await page.keyboard.press('KeyE');
      for (let k = 0; k < 9; k++) {
        await page.waitForTimeout(170);
        await grab('up');
      }
      await page.waitForTimeout(1200);
      await grab('onthephone');
      await page.keyboard.press('KeyE');
      for (let k = 0; k < 7; k++) {
        await page.waitForTimeout(170);
        await grab('down');
      }
      await page.waitForTimeout(800);
      await grab('done');
      console.log(name, frames.length);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
