// A .glb under debug-shots/ from the left, the right, behind and from behind-quarter, large, lit evenly: for finding dark
// or wrongly painted areas of a figure's skin (meshview.mjs's small stills hide them).
//   node debug-shots/body_sides.mjs <the .glb> <out prefix> [SIZE env: the still's side, 900]
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, shotServer } from '../scripts/shotServer.mjs';
const [file, out] = process.argv.slice(2);
const size = Number(process.env.SIZE ?? 900);
const url = `/${file.replace(/\\/g, '/').replace(/^.*?(?=(debug-shots|assets)\/)/, '')}`;
writeFileSync(join(ROOT, 'debug-shots', '_bodysides.html'), `<!doctype html><body style="margin:0;background:#33353b"><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(${size}, ${size});
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x33353b);
// Lit by its own colour only (emissive), so what a texture holds is seen without any shading.
window.__ready = (async () => {
  const model = (await new GLTFLoader().loadAsync(${JSON.stringify(url)})).scene;
  model.traverse((o) => { if (o.isMesh) { const m = o.material; if (m.map) { m.emissiveMap = m.map; m.emissive.set(0xffffff); m.emissiveIntensity = 1; m.color.set(0x000000); } } });
  scene.add(model);
  const box = new THREE.Box3().setFromObject(model);
  window.__box = box;
  return true;
})();
window.__shot = (yaw, up, near) => {
  const box = window.__box, mid = box.getCenter(new THREE.Vector3()), h = box.max.y - box.min.y;
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  const at = new THREE.Vector3(mid.x, box.min.y + h * up, mid.z);
  const d = h * 2.1 * near;
  cam.position.set(at.x + d * Math.sin(yaw), at.y, at.z + d * Math.cos(yaw));
  cam.lookAt(at);
  renderer.render(scene, cam);
};
</script></body>`);
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: size, height: size } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}debug-shots/_bodysides.html`);
await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
await page.evaluate(() => window.__ready);
const views = { left: [Math.PI / 2, 0.5, 0.62], back: [Math.PI, 0.5, 0.62], right: [-Math.PI / 2, 0.5, 0.62], front: [0, 0.5, 0.62] };
for (const [name, v] of Object.entries(views)) {
  await page.evaluate((v) => window.__shot(...v), v);
  await page.screenshot({ path: `${out}_${name}.png` });
}
console.log(out);
await browser.close();
await server.close();
process.exit(0);
