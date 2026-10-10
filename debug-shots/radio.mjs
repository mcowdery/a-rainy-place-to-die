// The car's radio: at the wheel it comes on at the station's place on the clock, the dial turns, off stops the
// stream, getting out stops it. Logs the element's state and the level after the radio's gain.
// node debug-shots/radio.mjs [out dir]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/radio';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300));
});
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=city_garage.front&car=home`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.mouse.click(550, 320);
await page.waitForTimeout(1500);
const key = async (code, shift = false) => page.evaluate(([c, s]) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c, shiftKey: s })), [code, shift]);
const state = (label) =>
  page.evaluate(async (label) => {
    const r = window.__radio;
    if (!window.__tap && r.ctx) {
      window.__tap = r.ctx.createAnalyser();
      r.gain.connect(window.__tap);
    }
    await new Promise((res) => setTimeout(res, 300));
    let rms = 0;
    if (window.__tap) {
      const d = new Float32Array(window.__tap.fftSize);
      window.__tap.getFloatTimeDomainData(d);
      rms = Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length);
    }
    const hud = [...document.querySelectorAll('div')].find((e) => e.style.textShadow && e.style.bottom === '26px');
    return `${label}: tuned ${r.tuned} · attached ${r.attached} · playing '${r.playing}' · paused ${r.el.paused} · t ${r.el.currentTime.toFixed(1)} / ${Number(r.el.duration).toFixed(1)} · error ${r.el.error?.message ?? 'none'} · rms ${rms.toFixed(4)} · hud [${hud?.style.opacity}] ${hud?.innerText.replace(/\n/g, ' | ')}`;
  }, label);
console.log(await state('on foot'));
console.log(await page.evaluate(() => window.__drive()));
await page.waitForTimeout(2500);
console.log(await state('at the wheel'));
await page.screenshot({ path: `${out}/1_on.png` });
await page.waitForTimeout(3000);
console.log(await state('3 s on'));
await key('Period');
await page.waitForTimeout(2500);
console.log(await state('next station'));
await page.screenshot({ path: `${out}/2_next.png` });
await key('Period');
await page.waitForTimeout(1500);
console.log(await state('tape'));
await page.screenshot({ path: `${out}/3_tape.png` });
await key('Period');
await page.waitForTimeout(1500);
console.log(await state('off'));
await key('Period');
await page.waitForTimeout(2500);
console.log(await state('first station again'));
await key('KeyE');
await page.waitForTimeout(1500);
console.log(await state('got out'));
await browser.close();
await server.close();
