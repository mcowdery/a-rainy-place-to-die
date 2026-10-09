// A figure as the camera a Pixal3D job returned sees it: the .glb drawn in a picture of the cut-out's own size, from that
// camera, on a transparent background. For finding a shape's joints from the shape itself (scripts/props/figure_landmarks.py
// on this picture, then scripts/blender/rig_figure.py), when its pose isn't the one in the picture it was made from.
//   node debug-shots/camera_render.mjs <the .glb> <its camera.json> <out.png>
//   (Paths from the repository's root, no leading slash.)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT, shotServer } from '../scripts/shotServer.mjs';
const [glb, cameraFile, out] = process.argv.slice(2);
if (!glb || !cameraFile || !out) {
  console.log('Usage: node debug-shots/camera_render.mjs <the .glb> <its camera.json> <out.png>');
  process.exit(1);
}
const camera = JSON.parse(readFileSync(cameraFile, 'utf8'));
const url = (f) => `/${f.replace(/\\/g, '/').replace(/^.*?(?=(debug-shots|assets)\/)/, '')}`;
writeFileSync(
  join(ROOT, 'debug-shots', '_camerarender.html'),
  `<!doctype html><html><body style="margin:0;background:transparent"><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(${camera.width}, ${camera.height});
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x887766, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(0.5, 1, 2);
scene.add(sun);
const cam = new THREE.PerspectiveCamera(${camera.fov_degrees}, ${camera.width} / ${camera.height}, 0.05, 20);
cam.position.set(0, 0, ${camera.distance});
cam.lookAt(0, 0, 0);
window.__ready = (async () => {
  const model = (await new GLTFLoader().loadAsync(${JSON.stringify(url(glb))})).scene;
  scene.add(model);
  renderer.render(scene, cam);
  return true;
})();
</script></body></html>`,
);
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: camera.width, height: camera.height } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}debug-shots/_camerarender.html`);
await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
await page.evaluate(() => window.__ready);
await page.waitForTimeout(300);
mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out, omitBackground: true });
console.log(out);
await browser.close();
await server.close();
process.exit(0);
