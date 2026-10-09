// The tape deck with a stand-in cassette (two of the stations' own files as the player's): plays, skips, keeps
// its place when the dial moves away and back. node debug-shots/radiotape.mjs
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=city_garage.front&car=home`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.mouse.click(550, 320);
await page.waitForTimeout(1000);
await page.evaluate(() => window.__drive());
await page.evaluate(() => {
  const r = window.__radio;
  const mk = (title, url) => ({ title, file: () => fetch(url).then((x) => x.blob()).then((b) => new File([b], `${title}.ogg`, { type: 'audio/ogg' })) });
  r.tape.tracks = [mk('one', '/assets/radio/jazz/bass_walker.ogg'), mk('two', '/assets/radio/bay/funkorama.ogg')];
  r.tape.label = 'My tape';
  r.tune('tape');
});
const state = (label) => page.evaluate((label) => { const r = window.__radio; return `${label}: playing '${r.playing}' · paused ${r.el.paused} · t ${r.el.currentTime.toFixed(1)} · tape ${r.tape.index} @ ${r.tape.position.toFixed(1)} · ${JSON.stringify(r.readout())}`; }, label);
await page.waitForTimeout(3000);
console.log(await state('tape in'));
await page.evaluate(() => window.__radio.tapeButton(false));
await page.waitForTimeout(3000);
console.log(await state('skipped'));
await page.evaluate(() => window.__radio.tune('jazz'));
await page.waitForTimeout(2000);
console.log(await state('to jazz'));
await page.evaluate(() => window.__radio.tune('tape'));
await page.waitForTimeout(2000);
console.log(await state('back to tape'));
await page.evaluate(() => { window.__radio.el.currentTime = window.__radio.el.duration - 1.5; });
await page.waitForTimeout(4000);
console.log(await state('after the end'));
await browser.close();
await server.close();
