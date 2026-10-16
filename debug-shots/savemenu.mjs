// Saving from the pause menu (Esc): open it, go to Save and load, save into slot 1, check the browser kept it.
// node debug-shots/savemenu.mjs [out dir]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/savemenu';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(`${base}?debug=1&spawn=kaburo_crossing.view&start=street&clock=22:40&weather=clear`);
  await page.waitForFunction(() => window.__pause && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240_000, polling: 500 });
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
  await page.waitForTimeout(3000);
  console.log('phone apps', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.ph-app, .ph-home button')].map((b) => b.textContent?.trim().slice(0, 12)))));
  await page.evaluate(() => window.__pause.show());
  console.log('buttons', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.pause button')].map((b) => b.textContent))));
  await page.click('.pause button:has-text("Save and load")');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/1-slots.png` });
  await page.click('.sv-slot:nth-of-type(2) .sv-btn:has-text("Save")');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/2-saved.png` });
  console.log('slot 1 kept', await page.evaluate(() => { const v = localStorage.getItem('rainyplace.save.1'); return v ? JSON.parse(v).place : null; }));
  await page.click('.pause button:has-text("Back")');
  console.log('back to', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.pause button')].map((b) => b.textContent))));
} finally {
  await browser.close();
  await server.close();
}
