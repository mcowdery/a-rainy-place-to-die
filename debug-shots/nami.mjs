// NAMI, the phone's music app, and the noise-cancelling headphones: opens the app, plays a playlist, and logs what
// is heard at each step (the element, the level out of the headphones and out of the phone's speaker, how much of
// the city gets past the ears), with a shot of each screen.
//   node debug-shots/nami.mjs [out dir]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/nami';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300));
});
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&clock=21:00&weather=rain`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 400000, polling: 500 });
await page.mouse.click(400, 400);
await page.waitForTimeout(1500);
await page.evaluate(() => localStorage.removeItem('citypop.music'));
const state = (label) =>
  page.evaluate(async (label) => {
    const m = window.__music;
    const a = window.__audio;
    if (!window.__taps && m.ctx) {
      window.__taps = [m.phones, m.speaker].map((g) => {
        const tap = m.ctx.createAnalyser();
        g.connect(tap);
        return tap;
      });
    }
    await new Promise((res) => setTimeout(res, 700));
    const rms = (window.__taps ?? []).map((tap) => {
      const d = new Float32Array(tap.fftSize);
      tap.getFloatTimeDomainData(d);
      return Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length).toFixed(4);
    });
    const ears = a.ears ? a.ears.gains.map((g) => g.gain.value.toFixed(2)).join(' / ') : '?';
    const hud = [...document.querySelectorAll('div')].find((e) => e.style.textShadow && e.style.bottom === '26px');
    return `${label}: ${document.body.classList.contains('vn-on') ? 'SCENE · ' : ''}playing ${m.playing} · '${m.current?.title ?? ''}' (${m.queue.playlist}) · paused ${m.el.paused} · t ${m.el.currentTime.toFixed(1)} / ${Number(m.el.duration).toFixed(1)} · phones ${rms[0]} · speaker ${rms[1]} · ears ${m.ears} · city bare / cups / nc ${ears} · hud [${hud?.style.opacity}] ${hud?.innerText.replace(/\n/g, ' | ')}`;
  }, label);
const phone = page.locator('.ph-device');
const shot = (name) => phone.screenshot({ path: `${out}/${name}.png` });
await page.keyboard.press('Tab');
await page.waitForTimeout(600);
await shot('0_home_screen');
await page.locator('.ph-app', { hasText: 'NAMI' }).click();
await page.waitForTimeout(500);
await shot('1_library');
console.log(await state('opened'));
await page.locator('.nm-row').nth(1).click();
await page.waitForTimeout(400);
await page.locator('.nm-play').click();
await page.waitForTimeout(2500);
await shot('2_playlist');
console.log(await state('playing, headphones + NC'));
await page.locator('.nm-heart').nth(2).click();
await page.locator('.nm-minimain').click();
await page.waitForTimeout(500);
await shot('3_now_playing');
await page.locator('.nm-pill', { hasText: 'NC' }).click();
console.log(await state('NC off'));
await page.locator('.nm-pill').first().click();
await page.waitForTimeout(300);
await shot('4_speaker');
console.log(await state('headphones off (speaker)'));
await page.locator('.nm-pill').first().click();
await page.locator('.nm-pill', { hasText: 'NC' }).click();
await page.locator('.nm-seek').click({ position: { x: 150, y: 3 } });
console.log(await state('headphones + NC again, moved on in the song'));
await page.locator('.nm-big').nth(2).click();
console.log(await state('next'));
await page.locator('.nm-main').click();
console.log(await state('paused'));
await page.locator('.nm-main').click();
// Away from the app and the phone: it carries on.
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.locator('.nm-row').first().click();
await page.waitForTimeout(300);
await shot('5_liked');
await page.keyboard.press('Tab');
console.log(await state('phone put away'));
await page.screenshot({ path: `${out}/6_city.png` });
// A scene holds it.
await page.evaluate(() => window.__vn?.('bar_kanpai.mama'));
await page.waitForTimeout(1200);
console.log(await state('in a scene'));
await browser.close();
await server.close();
