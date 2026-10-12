// Rain look: node debug-shots/rainsoft.mjs [outdir] [rain amount]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/rainsoft';
const amt = process.argv[3] ?? "0.6";
const spawn = process.argv[4] ?? "city_garage.front";
const extra = process.argv[5] ?? "";
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=${spawn}&weather=${extra.includes("clear") ? "clear" : "rain"}&rain=${amt}${extra.includes("natural") ? "" : "&wet=1"}&clock=22:30${extra}`, { timeout: 240000 });
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; document.getElementById('hud').style.display = 'none'; });
  await page.waitForTimeout(extra.includes("natural") ? 24000 : 4000);
  const hide = process.argv[6]; // comma list of Points indices to hide
  const info = await page.evaluate((h) => { const pts = []; window.__scene.traverse((o) => { if (o.isPoints) pts.push(o); }); const hs = (h ?? "").split(",").filter(Boolean).map(Number); pts.forEach((o, i) => { if (hs.includes(i)) o.onBeforeRender = () => {}, o.layers.disableAll(); }); return pts.map((o, i) => i + ":" + o.geometry.getAttribute("position").count + ":" + Object.keys(o.material.uniforms ?? {}).slice(0, 6).join("/")); }, hide);
  if (process.argv[7]) await page.evaluate((u) => window.__scene.traverse((o) => { if (o.isMesh && o.material?.uniforms?.[u]) o.visible = false; }), process.argv[7]);
  console.log(info.join("; "));
  if (process.argv[8]) await page.evaluate((d) => { const c = window.__camera; const f = new c.position.constructor(0, -Number(d), -1); c.lookAt(c.position.clone().add(f)); }, process.argv[8]);
  for (let i = 0; i < 3; i++) { await page.screenshot({ path: `${out}/rain_${amt}_${i}.png` }); await page.waitForTimeout(900); }
} finally { await browser.close(); await server.close(); }
