// Ride a journey that includes the monorail (its own cars: the standing ride) and report where it ends and
// whether the screen came back from the fade: node debug-shots/monoride.mjs [from,to] [out dir]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const leg = process.argv[2] ?? 'airport_station,mono_kasumicho_station';
const out = process.argv[3] ?? 'debug-shots/monoride';
const extra = process.argv[4] ?? '';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: false, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  if (process.env.THIRD) await page.addInitScript(() => localStorage.setItem('rainyplace.thirdPerson', '1'));
  await page.goto(`${base}?debug=1&diag=1&clock=12:00&ride=${leg}${extra ? `&${extra}` : ''}`);
  await page.waitForFunction(() => !!window.__camera && !!window.__trains, null, { timeout: 180000 });
  const state = () =>
    page.evaluate(() => {
      const fade = [...document.body.children].find((d) => d.style.zIndex === '15' && d.style.pointerEvents === 'none' && d.style.position === 'fixed');
      const p = window.__camera.position;
      return {
        fade: fade?.style.opacity ?? '?',
        standing: [...window.__trains.values()].some((t) => t.riding && !t.walkable),
        walking: !!window.__rider?.active,
        mack: window.__mack?.()?.object.visible ?? null, pos: [Math.round(p.x), Math.round(p.y * 10) / 10, Math.round(p.z)],
        hud: document.body.innerText.split('\n').find((l) => /モノレール|MONORAIL|LINE ·/.test(l)) ?? '',
      };
    });
  let rode = false;
  let idle = 0;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(4000);
    const s = await state();
    console.log(i * 4, JSON.stringify(s));
    const riding = s.standing || s.walking;
    if (riding && !rode) await page.screenshot({ path: `${out}/ride_start.png` });
    rode ||= riding;
    if (i === 3) await page.screenshot({ path: `${out}/ride_mid.png` });
    // After a look at the ride in real time: E skips the run (and gets off at the stop in the new cars).
    if (i >= 3 && riding) {
      await page.mouse.click(640, 360);
      await page.keyboard.press('KeyE');
    }
    idle = riding || s.fade !== '0' ? 0 : idle + 1;
    if (rode && idle >= 2) break;
  }
  const end = await state();
  await page.screenshot({ path: `${out}/ride_end.png` });
  console.log(end.fade === '0' && rode && !end.standing && !end.walking ? 'OK: off the train, screen clear' : 'FAIL', JSON.stringify(end));
} finally {
  await browser.close();
  await server.close();
}
