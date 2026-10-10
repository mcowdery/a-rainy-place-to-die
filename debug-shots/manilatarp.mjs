// Finds tarpaulins, parol strings and stop signs near a point in Manila and looks at each. node debug-shots/manilatarp.mjs <out> [x,z] [kinds]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/manila_more/tarp';
mkdirSync(out, { recursive: true });
const [cx, cz] = (process.argv[3] ?? '800,1300').split(',').map(Number);
const kinds = (process.argv[4] ?? 'tarp,parolline,jeepstop').split(',');
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e.stack ?? e).slice(0, 600)));
await page.goto(`${server.resolvedUrls.local[0]}?city=manila&debug=1&diag=1&clock=${process.env.CLOCK ?? '15:00'}&weather=clear&season=summer&cam=${cx},1.7,${cz},0,0`, { timeout: 300000 });
for (let i = 0; i < 200; i++) {
  const st = await page.evaluate(() => ({ d: !!window.__district, o: document.getElementById('overlay')?.textContent?.slice(0, 80) }));
  if (st.d && st.o === 'click to walk') break;
  await page.waitForTimeout(5000);
}
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForTimeout(8000);
const found = await page.evaluate(([cx, cz, kinds]) => {
  const d = window.__district;
  const out = [];
  for (const k of kinds) {
    const ps = d.propsNear(cx, cz, 260).filter((p) => p.kind === k);
    for (const p of ps.slice(0, 2)) out.push({ kind: k, x: p.x, z: p.z, nx: p.nx, nz: p.nz, half: p.half });
  }
  return out;
}, [cx, cz, kinds]);
console.log(JSON.stringify(found));
let i = 0;
for (const f of found) {
  // 7 m out along the facing, looking back at it (kerb tarps and signs face the road: stand on the road side).
  const d = f.kind === 'parolline' ? 12 : 6;
  const x = f.x + f.nx * d * (f.kind === 'parolline' ? 0 : 1) + (f.kind === 'parolline' ? -f.nz * d : 0);
  const z = f.z + f.nz * d * (f.kind === 'parolline' ? 0 : 1) + (f.kind === 'parolline' ? f.nx * d : 0);
  const yaw = (Math.atan2(-(f.x - x), -(f.z - z)) * 180) / Math.PI;
  await page.evaluate(([x, y, z, yaw]) => { const cam = window.__camera; cam.position.set(x, y, z); const e = new cam.rotation.constructor(); e.set(0.08, (yaw * Math.PI) / 180, 0, 'YXZ'); cam.quaternion.setFromEuler(e); }, [x, f.kind === 'tarp' ? 3.5 : 2, z, yaw]);
  await page.waitForTimeout(7000);
  await page.screenshot({ path: `${out}/${f.kind}${i++}.png` });
  console.log('shot', f.kind);
}
await browser.close();
await server.close();
