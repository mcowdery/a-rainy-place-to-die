// The debug menu (` backquote, district/debugMenu.ts) open in the city, a shot of each tab, to see they fit the
// window; then without the testing tools (as a build off the dev server has it), and the window people switched off.
//   node debug-shots/debugmenu.mjs [out dir]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/debugmenu';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 400)); });
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&clock=21:00&weather=clear`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 400000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForTimeout(3000);
await page.keyboard.press('Backquote');
await page.waitForTimeout(400);
const tabs = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent).filter((t) => /^\d \S/.test(t)));
console.log('tabs:', JSON.stringify(tabs));
for (let i = 0; i < tabs.length; i++) {
  await page.keyboard.press(`Digit${i + 1}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${i + 1}_${tabs[i].slice(2).replace(/\W+/g, '_').toLowerCase()}.png` });
}
// The people in the windows, off and on (the People tab's switch), seen in the city's uniform.
await page.evaluate(() => window.__menu.show('People'));
const folk = () => page.evaluate(() => +window.__city.uWindow.value.x.toFixed(2));
console.log('window people:', await folk());
const pick = (label, option) => page.evaluate(([label, option]) => {
  const row = [...document.querySelectorAll('span')].find((e) => e.textContent === label).parentElement.parentElement;
  [...row.querySelectorAll('button')].find((b) => b.textContent === option).click();
}, [label, option]);
await pick('People in windows', 'off');
await page.waitForTimeout(600);
console.log('window people, off:', await folk());
await page.screenshot({ path: `${out}/people_windows_off.png` });
await pick('People in windows', 'on');
await page.waitForTimeout(600);
console.log('window people, on again:', await folk());
await page.keyboard.press('Backquote');
console.log('closed with the key:', await page.evaluate(() => !window.__menu.open));
// Nothing in the menu has a hotkey of its own any more: the old keys leave things as they were, and the menu's
// buttons still work them.
const look = () => page.evaluate(() => JSON.stringify({ grade: window.__mood.grade, ascii: window.__passes.overlay.preset, dither: window.__passes.overlay.dither, bloom: window.__passes.bloom.enabled, strength: window.__passes.bloom.strength, threshold: window.__passes.bloom.threshold }));
const was = await look();
for (const k of ['KeyR', 'KeyK', 'KeyO', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyP', 'Digit3', 'BracketRight', 'Quote']) await page.keyboard.press(k);
await page.waitForTimeout(500);
console.log('old keys change nothing:', was === (await look()), was);
await page.evaluate(() => window.__menu.show('Graphics'));
for (const name of ['vibe', 'dither', 'bloom']) await page.getByRole('button', { name, exact: true }).click();
await page.evaluate(() => window.__menu.show('Light & sky'));
await page.getByRole('button', { name: 'noir', exact: true }).last().click();
await page.waitForTimeout(500);
console.log('from the menu:', await look());
await page.screenshot({ path: `${out}/graphics_from_menu.png` });
await browser.close();
await server.close();
