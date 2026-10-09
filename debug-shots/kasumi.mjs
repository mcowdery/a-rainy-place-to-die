// Kasumi-cho's open-air set pieces: the cemetery avenue (reien) and the redevelopment site (kasumi_site).
//   node debug-shots/kasumi.mjs <out dir> [query]      ONLY=r,s picks the groups (r reien, s site)
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/kasumi';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const only = process.env.ONLY?.split(',');
const want = (g) => !only || only.includes(g);
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.addInitScript(() => { try { localStorage.setItem('citypop.thirdPerson', '0'); } catch {} });
const open = async (q) => {
  await page.goto(`${server.resolvedUrls.local[0]}district.html?debug=1&diag=1${q}${extra}`, { timeout: 300000 });
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 500000, polling: 500 });
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
  await page.waitForTimeout(6000);
};
const look = (pitchDeg, yawDeg) => page.evaluate(([p, y]) => {
  const cam = window.__camera;
  const e = new cam.rotation.constructor().setFromQuaternion(cam.quaternion, 'YXZ');
  e.x = (p * Math.PI) / 180;
  if (y !== undefined) e.y = (y * Math.PI) / 180;
  e.z = 0;
  cam.quaternion.setFromEuler(e);
}, [pitchDeg, yawDeg]);
const place = (x, y, z) => page.evaluate(([a, b, c]) => window.__camera.position.set(a, b, c), [x, y, z]);
const pos = () => page.evaluate(() => [window.__camera.position.x, window.__camera.position.y, window.__camera.position.z]);
const shot = async (n, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${n}.png` }); };
// Both face south onto Kasumi-dori: yaw 0 looks north into them, 90 west, -90 east. Local u is east (+x), t north (-z).
if (want('r')) {
  await open('&spawn=reien.front&clock=14:00');
  await shot('r1_gate_day', 200);
  const f = await pos();
  // (The spawn is 4 m out from the gate at u 42: t = -(z - f.z) - 4.)
  await place(f[0], f[1] + 14, f[2] + 10); await look(-22, 0); await shot('r2_overview');
  await place(f[0], f[1], f[2] - 10); await look(-2, 60); await shot('r3_shop');
  await look(-4, -60); await shot('r4_water_jizo');
  await place(f[0], f[1], f[2] - 24); await look(2, 0); await shot('r5_avenue');
  await place(f[0] - 3, f[1], f[2] - 45); await look(-10, 80); await shot('r6_graves');
  await place(f[0] - 22, f[1], f[2] - 42.2); await look(-8, 90); await shot('r7_aisle');
  await place(f[0], f[1], f[2] - 92); await look(-2, 0); await shot('r8_family_plot');
  await place(f[0] + 30, f[1], f[2] - 87); await look(4, 0); await shot('r9_muenzuka');
  await open('&spawn=reien.avenue&clock=17:10&season=autumn');
  await shot('r10_autumn_dusk', 200);
  await open('&spawn=reien.front&clock=22:30');
  const g = await pos();
  await place(g[0], g[1], g[2] - 20); await look(2, 0); await shot('r11_avenue_night');
}
if (want('s')) {
  await open('&spawn=kasumi_site.front&clock=14:00');
  await shot('s1_front_day', 200);
  const f = await pos();
  await place(f[0] - 26, f[1], f[2] + 3); await look(6, -30); await shot('s2_hoarding');
  await place(f[0], f[1], f[2] - 12); await look(0, 0); await shot('s3_inside');
  await look(0, 80); await shot('s4_office');
  await place(f[0], f[1], f[2] - 29.4); await look(-28, 0); await shot('s5_pit');
  await look(-24, -40); await shot('s6_sealed');
  await look(8, 60); await shot('s7_crane');
  await place(f[0] - 6, f[1] + 30, f[2] + 16); await look(-32, -8); await shot('s8_overview');
  await open('&spawn=kasumi_site.rim&clock=22:30');
  await shot('s9_pit_night', 200);
  const g = await pos();
  await place(g[0], g[1], g[2] + 30); await look(12, 0); await shot('s10_front_night');
}
await browser.close(); await server.close();
writeGallery(out);
