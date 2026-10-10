// Where Mack's body is relative to the city camera, looking down, and what's close to the camera.
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&time=night`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const cam = window.__camera;
  const e = new cam.rotation.constructor().setFromQuaternion(cam.quaternion, 'YXZ');
  e.x = -1.05;
  e.z = 0;
  cam.quaternion.setFromEuler(e);
});
await page.waitForTimeout(800);
const lines = await page.evaluate(() => {
  const r = window.__scene.children.find((o) => o.name === 'first-person');
  const cam = window.__camera;
  const V = cam.position.constructor;
  const out = [];
  const bones = {};
  r.traverse((o) => { if (o.isBone && !bones[o.name]) bones[o.name] = o; });
  const f = (v) => v.toArray().map((x) => x.toFixed(2)).join(',');
  const fwd = cam.getWorldDirection(new V());
  out.push('cam fwd ' + f(fwd) + ' cam ' + f(cam.position) + ' body ' + f(r.children[0].position) + ' rotY ' + r.children[0].rotation.y.toFixed(2));
  for (const n of ['spine_03', 'pelvis', 'foot_l', 'foot_r', 'hand_l']) {
    const p = bones[n].getWorldPosition(new V());
    const d = p.clone().sub(cam.position);
    out.push(`${n} rel ${f(d)} angle-from-view ${((Math.acos(d.clone().normalize().dot(fwd)) * 180) / Math.PI).toFixed(0)}deg`);
  }
  const meshes = [];
  r.children[0].traverse((o) => o.isSkinnedMesh && meshes.push(o));
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    let near = 0;
    let minD = 9;
    const v = new V();
    for (let i = 0; i < pos.count; i += 2) {
      m.getVertexPosition(i, v);
      v.applyMatrix4(m.matrixWorld);
      const d = v.distanceTo(cam.position);
      minD = Math.min(minD, d);
      if (d < 0.12) near++;
    }
    out.push(`${m.name}: ${near} verts within 12 cm, nearest ${minD.toFixed(3)} m`);
  }
  return out;
});
console.log(lines.join('\n'));
await browser.close();
await server.close();
