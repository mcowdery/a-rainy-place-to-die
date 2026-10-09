// Every station on the dial plays at the wheel: tunes to each in turn and logs what's on. node debug-shots/radiostations.mjs
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=city_garage.front&car=home`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.mouse.click(550, 320);
await page.waitForTimeout(1000);
await page.evaluate(() => window.__drive());
const dial = await page.evaluate(() => window.__radio.dial());
console.log('dial:', dial.join(' '));
for (const id of dial.filter((d) => d !== 'off' && d !== 'tape')) {
  await page.evaluate((id) => window.__radio.tune(id), id);
  await page.waitForTimeout(3000);
  console.log(await page.evaluate(async () => {
    const r = window.__radio;
    if (!window.__tap) { window.__tap = r.ctx.createAnalyser(); r.gain.connect(window.__tap); }
    await new Promise((res) => setTimeout(res, 400));
    const d = new Float32Array(window.__tap.fftSize);
    window.__tap.getFloatTimeDomainData(d);
    const o = r.readout();
    return `${o.top} | ${o.bottom} | t ${r.el.currentTime.toFixed(0)} / ${Number(r.el.duration).toFixed(0)} · paused ${r.el.paused} · error ${r.el.error?.message ?? 'none'} · rms ${Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length).toFixed(4)}`;
  }));
}
await page.screenshot({ path: 'debug-shots/radio/4_stations.png' });
await browser.close();
await server.close();
