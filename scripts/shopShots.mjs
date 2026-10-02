// Photographs a storefront of each shop trade (real/shops.ts) in the district, for reviewing the shop interiors.
//   node scripts/shopShots.mjs                       every trade, at night, into debug-shots/shops/
//   node scripts/shopShots.mjs --trades cafe,bank    only these
//   node scripts/shopShots.mjs --query "clock=12:00"  extra settings (daytime, rain...)
//   node scripts/shopShots.mjs --out debug-shots/x   another folder
//   node scripts/shopShots.mjs --headed
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};
const headed = process.argv.includes('--headed');
const only = arg('--trades')?.split(',');
const extra = arg('--query') ? `&${arg('--query')}` : '';
const out = arg('--out') ?? 'debug-shots/shops';
mkdirSync(out, { recursive: true });

const server = await createServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'msedge', headless: !headed, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 2000));
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  const ready = async () => {
    await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 180_000, polling: 500 });
    await page.evaluate(() => {
      document.getElementById('overlay').hidden = true;
      document.getElementById('hud').style.display = 'none';
    });
    await page.waitForTimeout(3500);
  };
  await page.goto(`${base}district.html?debug=1&diag=1&time=night${extra}`);
  await ready();
  // One shop of each trade, open, with a decent front, from the generated cells.
  const sites = await page.evaluate(async (only) => {
    const { styleFor, frontFrame } = await import('/src/poc3d/real/buildings.ts');
    const { TRADE_NAMES } = await import('/src/poc3d/real/shops.ts');
    const { frontSpan } = await import('/src/poc3d/district/plan.ts');
    const d = window.__district;
    const found = new Map();
    for (const [mx, my] of d.cells) {
      const plan = d.plan(mx, my);
      if (!plan) continue;
      for (const b of plan.buildings) {
        const s = styleFor(b);
        if (!s.shopOpen || s.home) continue;
        const name = TRADE_NAMES[s.trade];
        if (only && !only.includes(name)) continue;
        const [s0, s1] = frontSpan(b);
        const sw = s1 - s0;
        const prev = found.get(name);
        // A typical front, about 8 m.
        if (sw < 4 || (prev && Math.abs(prev.sw - 8) <= Math.abs(sw - 8))) continue;
        const f = frontFrame(b);
        const u = (s0 + s1) / 2;
        const x = f.p[0] + f.r[0] * u + f.n[0] * 5.5;
        const z = f.p[2] + f.r[2] * u + f.n[2] * 5.5;
        const y = d.floorAt(x, z, 0) + 1.6;
        const yaw = (Math.atan2(f.n[0], f.n[2]) * 180) / Math.PI;
        found.set(name, { name, sw, x, y, z, yaw, sign: b.sign?.text ?? '', zone: b.zone?.id ?? '' });
      }
    }
    return [...found.values()];
  }, only);
  console.log(`${sites.length} trades found`);
  // Hop the camera from shop to shop in the one page, letting the city stream in round each.
  for (const s of sites) {
    await page.evaluate((s) => {
      window.__camera.position.set(s.x, s.y, s.z);
      window.__look(s.yaw, 2);
    }, s);
    await page.waitForFunction(() => window.__district.inFlightCount === 0, null, { timeout: 120_000, polling: 250 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.evaluate((s) => window.__look(s.yaw, 2), s);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${s.name}.png` });
    console.log(`${s.name.padEnd(12)} ${s.zone.padEnd(16)} ${s.sign.padEnd(12)} front ${s.sw.toFixed(1)} m  cam=${s.x.toFixed(1)},${s.y.toFixed(1)},${s.z.toFixed(1)},${s.yaw.toFixed(0)},2`);
  }
} finally {
  if (errors.length) console.log(`\nconsole errors:\n${errors.slice(0, 5).join('\n---\n')}`);
  await browser.close();
  await server.close();
}
