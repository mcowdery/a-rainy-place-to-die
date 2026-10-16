// Using a payphone (district/payphone.ts): stands at one of each kind, picks it up, dials, and photographs each step,
// logging what the phone says of itself.
//   node debug-shots/payphoneuse.mjs [out dir] [number to dial, default 117] [query]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/payphoneuse';
const number = process.argv[3] ?? '117';
const query = process.argv[4] ?? 'clock=21:30&weather=clear';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 240)); });
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&res=100&${query}&cam=3335,1.7,1300,0,0`, { timeout: 240000 });
  await page.waitForFunction(() => window.__district && window.__phones && window.__phoneUse && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => {
    document.getElementById('overlay').hidden = true;
    for (const el of document.querySelectorAll('#hud, #info')) el.style.display = 'none';
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.evaluate(() => /MAP \+ FAST TRAVEL/.test(document.body.innerText))) await page.keyboard.press('KeyM');
  const list = (await page.evaluate(() => window.__phones.all())).map((s, i) => ({ ...s, i }));
  // One of each kind in Kaburo (the neon district), where all four stand.
  for (const kind of ['payphone', 'payphone_booth', 'payphone_red', 'payphone_pink']) {
    const s = list.find((q) => q.which === kind && q.district === 'neon') ?? list.find((q) => q.which === kind);
    if (!s) continue;
    const name = kind.replace('payphone_', '').replace('payphone', 'hood');
    // Walking up: out in front of it.
    await page.evaluate((i) => window.__phones.go(i, 2.4, 0.9, 1.7), s.i);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${out}/${name}-1-near.png` });
    // At it (inside, for a booth), looking at the phone.
    await page.evaluate(([i, back]) => window.__phones.go(i, back, 0, 1.7), [s.i, kind === 'payphone_booth' ? 0.2 : 1.15]);
    await page.waitForTimeout(1800);
    const can = await page.evaluate(() => ({ engaged: window.__phones.engaged(), can: window.__phoneUse.canUse(window.__camera), hint: [...document.querySelectorAll('div')].find((d) => /Pick up the phone/.test(d.textContent) && d.style.display === 'block')?.textContent ?? null }));
    await page.screenshot({ path: `${out}/${name}-2-at.png` });
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(900);
    const up = await page.evaluate(() => window.__phoneUse.active);
    for (const d of number) {
      await page.keyboard.press(`Digit${d}`);
      await page.waitForTimeout(kind === 'payphone' || kind === 'payphone_booth' ? 350 : 1700);
    }
    await page.screenshot({ path: `${out}/${name}-3-dialled.png` });
    await page.waitForTimeout(8500);
    const said = await page.evaluate(() => [...document.querySelectorAll('div')].filter((d) => /hang up/.test(d.textContent) && d.style.display === 'block').map((d) => d.textContent)[0] ?? null);
    await page.screenshot({ path: `${out}/${name}-4-answered.png` });
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(600);
    const down = await page.evaluate(() => window.__phoneUse.active);
    console.log(name, `${s.x},${s.z}`, JSON.stringify({ ...can, pickedUp: up, said, hungUp: !down }));
  }
} finally {
  await browser.close();
  await server.close();
}
