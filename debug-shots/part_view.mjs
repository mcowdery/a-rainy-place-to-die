// A .glb (under debug-shots/) from chosen places, lit grey (its own colour is ignored): for looking at where parts meet.
//   node debug-shots/part_view.mjs <the .glb> <out prefix> "<name>:<x>,<y>,<z>:<yaw>:<pitch>:<distance>" ...
// The target is in the file's own (glTF, +y up) frame; yaw is the camera's turn round it from +z (0: from the picture's side,
// 1.5708: from +x), pitch up from level, distance in the file's units. SIZE env: the still's side (700); CLIPY env: hide everything above that height (the file's y). Writes <out>_<name>.png.
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, shotServer } from '../scripts/shotServer.mjs';
const [file, out, ...views] = process.argv.slice(2);
const size = Number(process.env.SIZE ?? 700);
const url = `/${file.replace(/\\/g, '/').replace(/^.*?(?=(debug-shots|assets)\/)/, '')}`;
const page_name = `_partview_${process.pid}.html`;
writeFileSync(join(ROOT, 'debug-shots', page_name), `<!doctype html><body style="margin:0;background:#33353b"><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(${size}, ${size});
renderer.localClippingEnabled = true;
${process.env.CLIPY ? `renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), ${Number(process.env.CLIPY)})];` : ''}
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x33353b);
scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.3));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
scene.add(key);
window.__ready = (async () => {
  const model = (await new GLTFLoader().loadAsync(${JSON.stringify(url)})).scene;
  model.traverse((o) => { if (o.isMesh && ${process.env.SMOOTH ? 'true' : 'false'}) { o.geometry.deleteAttribute('normal'); o.geometry.computeVertexNormals(); } if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6, metalness: 0, side: THREE.DoubleSide, flatShading: false }); });
  scene.add(model);
  return true;
})();
window.__shot = (x, y, z, yaw, pitch, dist) => {
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  const at = new THREE.Vector3(x, y, z);
  cam.position.set(x + dist * Math.sin(yaw) * Math.cos(pitch), y + dist * Math.sin(pitch), z + dist * Math.cos(yaw) * Math.cos(pitch));
  cam.lookAt(at);
  key.position.copy(cam.position).add(new THREE.Vector3(0.5, 1, 0.3).multiplyScalar(dist));
  renderer.render(scene, cam);
};
</script></body>`);
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: size, height: size } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}debug-shots/${page_name}`);
await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
await page.evaluate(() => window.__ready);
for (const spec of views) {
  const [name, at, yaw, pitch, dist] = spec.split(':');
  const [x, y, z] = at.split(',').map(Number);
  await page.evaluate((v) => window.__shot(...v), [x, y, z, Number(yaw), Number(pitch), Number(dist)]);
  await page.screenshot({ path: `${out}_${name}.png` });
}
console.log(out);
await browser.close();
await server.close();
try { (await import('node:fs')).unlinkSync(join(ROOT, 'debug-shots', page_name)); } catch {}
process.exit(0);
