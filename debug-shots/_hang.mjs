// Finds where a page that never finishes booting is stuck: pauses its main thread after a while and prints the stack.
//   node debug-shots/_hang.mjs [query] [seconds before pausing]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const q = process.argv[2] ?? 'city=manila';
const wait = Number(process.argv[3] ?? 90);
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e.stack ?? e).slice(0, 500)));
const cdp = await page.context().newCDPSession(page);
await cdp.send('Debugger.enable');
cdp.on('Debugger.paused', (ev) => {
  console.log('PAUSED');
  for (const f of ev.callFrames.slice(0, 12)) console.log('  ', f.functionName || '(anon)', f.url.split('/').slice(-2).join('/'), f.location.lineNumber + 1);
});
page.goto(`${server.resolvedUrls.local[0]}?${q}&debug=1&diag=1&clock=14:00&weather=clear`, { timeout: 300000 }).catch(() => {});
for (let k = 0; k < 3; k++) {
  await new Promise((r) => setTimeout(r, wait * 1000));
  await cdp.send('Debugger.pause');
  await new Promise((r) => setTimeout(r, 2000));
  await cdp.send('Debugger.resume').catch(() => {});
}
await browser.close();
await server.close();
process.exit(0);
