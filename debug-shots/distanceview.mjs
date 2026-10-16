// Two figures side by side as the game's camera would see them from some way off: for judging whether a model that
// doesn't hold up close holds up in a crowd. Each is stood on the same ground at the same height, in daylight, and
// photographed at 1920x1080 with the district's field of view (68 degrees) from eye height; the sheet shows the
// middle of each frame at its own size, not enlarged, so a figure is as many pixels tall as it would be in play.
//   node debug-shots/distanceview.mjs <out.png> <left .glb> <right .glb> [metres, comma separated: 3,5,10,20]
//   (Paths from the repository's root, no leading slash.)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { ROOT, shotServer } from '../scripts/shotServer.mjs';
const [out, left, right, list] = process.argv.slice(2);
if (!out || !left || !right) {
  console.log('Usage: node debug-shots/distanceview.mjs <out.png> <left .glb> <right .glb> [metres: 3,5,10,20]');
  process.exit(1);
}
const metres = (list ?? '3,5,10,20').split(',').map(Number);
const url = (f) => `/${f.replace(/\\/g, '/').replace(/^.*?(?=(debug-shots|assets)\/)/, '')}`;
writeFileSync(
  join(ROOT, 'debug-shots', '_distanceview.html'),
  `<!doctype html><html><body style="margin:0;background:#000"><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb0d8);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(4, 9, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
scene.add(sun, new THREE.HemisphereLight(0xbcd4f0, 0x5a4e40, 0.9));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x8a867e, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 400);
const TALL = 1.6;
async function stand(file, x) {
  const model = (await new GLTFLoader().loadAsync(file)).scene;
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;
    const m = o.material;
    // (Hair and lash cards: cut out, both sides, as the game draws them.)
    if (m.alphaTest > 0 || m.transparent) { m.side = THREE.DoubleSide; m.transparent = false; m.alphaTest = Math.max(m.alphaTest, 0.4); }
  });
  const box = new THREE.Box3().setFromObject(model);
  const k = TALL / (box.max.y - box.min.y);
  model.scale.setScalar(k);
  model.position.set(x - ((box.min.x + box.max.x) / 2) * k, -box.min.y * k, -((box.min.z + box.max.z) / 2) * k);
  scene.add(model);
}
window.__far = {
  ready: false,
  async load(a, b) { await stand(a, -0.45); await stand(b, 0.45); this.ready = true; },
  // From d metres in front, at eye height, looking at their chests; where their feet and heads fall in the frame.
  view(d) {
    camera.position.set(0, 1.6, d);
    camera.lookAt(0, 0.95, 0);
    renderer.render(scene, camera);
    const px = (y) => { const v = new THREE.Vector3(0, y, 0).project(camera); return (1 - v.y) / 2 * innerHeight; };
    return { top: px(TALL), bottom: px(0) };
  },
};
</script></body></html>`,
);
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const W = 1920;
const H = 1080;
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}debug-shots/_distanceview.html`);
await page.waitForFunction(() => window.__far, null, { timeout: 60000 });
await page.evaluate(([a, b]) => __far.load(a, b), [url(left), url(right)]);
const CELL = 460;
let html = `<body style="margin:0;background:#111;color:#ddd;font:13px Consolas,monospace"><table cellspacing="3" cellpadding="0"><tr><td colspan="${metres.length}">left: ${url(left)} &nbsp; right: ${url(right)} &nbsp; (1920x1080, 68 degrees, each cell the middle ${CELL} px of the frame at its own size)</td></tr><tr>`;
for (const d of metres) {
  const at = await page.evaluate((d) => __far.view(d), d);
  const mid = Math.round((at.top + at.bottom) / 2);
  const y = Math.max(0, Math.min(H - CELL, mid - CELL / 2));
  const png = await page.screenshot({ clip: { x: (W - CELL) / 2, y, width: CELL, height: CELL } });
  html += `<td>${d} m: ${Math.round(at.bottom - at.top)} px tall<br><img width="${CELL}" height="${CELL}" src="data:image/png;base64,${png.toString('base64')}"></td>`;
}
html += '</tr></table></body>';
const sheet = await browser.newPage({ viewport: { width: 100, height: 100 } });
await sheet.setContent(html);
await sheet.waitForTimeout(200);
mkdirSync(dirname(out), { recursive: true });
await (await sheet.$('table')).screenshot({ path: out });
console.log(out);
await browser.close();
await server.close();
process.exit(0);
