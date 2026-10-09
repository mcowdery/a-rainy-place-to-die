// The shady shops at street level (real/city.ts, shopAtlas.ts, windowScenes.ts SHOP_KINDS): finds shops of the
// trades that can be one, in the zones with vice enough, near a spawn, and photographs each from across the
// pavement, a little to one side so the door's glimpse shows. With windowVice=4 every such shop is a shady one.
//   node debug-shots/shadyshops.mjs <out dir> [query] [spawn] [how many] [trades: bar,snack,lounge,...] [vite mode]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/windowpeople/shady';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '&clock=23:00&windowVice=4';
const spawn = process.argv[4] ?? 'hotel_rouge.front';
const count = Number(process.argv[5] ?? 6);
const trades = process.argv[6] ? process.argv[6].split(',') : null;
const mode = process.argv[7];
const server = await shotServer({ mode, server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const open = async (query) => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 600)); });
  await page.goto(`${server.resolvedUrls.local[0]}?diag=1&weather=clear&res=100${query}${extra}`);
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 400000, polling: 250 });
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; document.getElementById('hud').style.display = 'none'; });
  return page;
};
const first = await open(`&spawn=${spawn}`);
const found = await first.evaluate(async ([trades]) => {
  const B = await import('/src/poc3d/real/buildings.ts');
  const S = await import('/src/poc3d/real/shops.ts');
  const W = await import('/src/poc3d/real/windowScenes.ts');
  const can = new Set(W.SHADY_TRADES.map((e) => e[0]));
  const cam = window.__camera.position;
  const mx = Math.floor(cam.x / 128), my = Math.floor(cam.z / 128);
  const list = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      for (const b of window.__district.model.buildings(mx + dx, my + dy)) {
        if (!b.zone || Math.round((b.zone.look.vice ?? 0) * 3) < 3 || b.hue !== undefined) continue;
        const st = B.styleFor(b);
        const name = S.TRADE_NAMES[st.trade];
        if (!st.shopOpen || st.home || !can.has(st.trade) || (trades && !trades.includes(name))) continue;
        list.push({ id: b.id, x: b.x, z: b.z, w: b.w, d: b.d, front: b.front, trade: name, zone: b.zone.id, dist: Math.hypot(b.x - cam.x, b.z - cam.z) });
      }
    }
  }
  return list.sort((a, b) => a.dist - b.dist);
}, [trades]);
await first.close();
console.log(`${found.length} shops that can be shady within two cells of ${spawn}:`, [...new Set(found.map((f) => `${f.trade} (${f.zone})`))].join(', '));
// (One of each trade first, then the nearest.)
const picked = [];
for (const f of found) if (!picked.some((p) => p.trade === f.trade)) picked.push(f);
for (const f of found) if (!picked.includes(f)) picked.push(f);
for (const b of picked.slice(0, count)) {
  // From 5.5 m off the front, 1.2 m to one side of its middle, looking back in at it.
  const off = 5.5;
  const [nx, nz, yaw] = b.front === 'south' ? [0, 1, 0] : b.front === 'north' ? [0, -1, 180] : b.front === 'east' ? [1, 0, 90] : [-1, 0, -90];
  const half = Math.abs(nx) > 0 ? b.w / 2 : b.d / 2;
  const cx = b.x + nx * (half + off) + nz * 1.2, cz = b.z + nz * (half + off) - nx * 1.2;
  const page = await open(`&cam=${cx.toFixed(1)},1.7,${cz.toFixed(1)},${yaw + 10},-2`);
  await page.waitForTimeout(8000);
  const name = `${b.trade}_${b.id}`;
  console.log(name, b.zone, `front ${b.front}`, `${Math.round(Math.abs(nx) > 0 ? b.d : b.w)} m wide`);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
}
await browser.close();
await server.close();
