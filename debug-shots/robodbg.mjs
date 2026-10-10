// The RoboCop helmet's fit: profile and front, and where the eyes are in its frame.
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/faces';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}models-mack.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(2000);
await page.addStyleTag({ content: '.label { visibility: hidden !important; }' });
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; __fp.armed(false); __fp.look(Math.PI * 0.8, 0); __fp.face('robo'); });
for (const [m, n] of [[3, 'robo_profile'], [1, 'robo_front']]) {
  await page.evaluate((m) => __fp.mirror(m), m);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${n}.png` });
}
console.log(await page.evaluate(() => {
  const rig = __fp.rig();
  const h = rig.object.getObjectByName('robo-helmet');
  const eyes = rig.object.getObjectByName('first-person');
  const hp = h.getWorldPosition(new h.position.constructor());
  const e = window.__fp.camera().position;
  // The eye mesh's centre in the helmet's frame.
  let eye = null;
  rig.object.traverse((o) => { if (!eye && o.isMesh && /high-poly/.test(o.name)) { o.geometry.computeBoundingBox(); eye = o.geometry.boundingBox.getCenter(new h.position.constructor()).applyMatrix4(o.matrixWorld); } });
  const local = h.worldToLocal(eye.clone());
  return `helmet origin ${hp.toArray().map((v) => v.toFixed(3))} eye(bind bbox centre, world) ${eye.toArray().map((v) => v.toFixed(3))} eye in helmet frame ${local.toArray().map((v) => v.toFixed(3))} helmet scale ${h.getWorldScale(new h.position.constructor()).x.toFixed(3)}`;
}));
await browser.close(); await server.close();
