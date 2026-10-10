// A sheet of stills of one or more .glb files (a mesh from scripts/props/image_to_3d.py, a material test): each
// from the front, the front quarter, the side, the back and above, lit and then as bare grey form, a row a file.
// For judging a mesh without opening Blender.
//   node debug-shots/meshview.mjs <out.png> <a .glb under this folder> [more .glb ...]
//   (Paths from the repository's root, no leading slash: Git Bash turns an argument that starts with one into a Windows path.)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { ROOT, shotServer } from '../scripts/shotServer.mjs';
const [out, ...files] = process.argv.slice(2);
if (!out || files.length === 0) {
  console.log('Usage: node debug-shots/meshview.mjs <out.png> <a .glb> [more .glb ...]');
  process.exit(1);
}
// The page that shows a mesh: made here, in the git-ignored shots folder, served by the shot server.
const page_ = join(ROOT, 'debug-shots', '_meshview.html');
writeFileSync(
  page_,
  `<!doctype html><html><body style="margin:0;background:#2a2c31"><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2c31);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(2, 4, 3);
scene.add(key, new THREE.HemisphereLight(0xdde4ee, 0x4a4640, 0.6));
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.01, 100);
const clay = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.85, flatShading: true });
let model = null, own = new Map(), size = 1, mid = new THREE.Vector3(), low = 0, tall = 1;
window.__mesh = {
  ready: false,
  async load(url) {
    if (model) scene.remove(model);
    model = (await new GLTFLoader().loadAsync(url)).scene;
    own = new Map();
    let tris = 0;
    model.traverse((o) => { if (o.isMesh) { own.set(o, o.material); tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
    const box = new THREE.Box3().setFromObject(model);
    size = box.getSize(new THREE.Vector3()).length();
    box.getCenter(mid);
    low = box.min.y;
    tall = box.max.y - box.min.y;
    // (DOUBLE=1 in the environment: both sides drawn, which tells a hole from a surface turned inside out.)
    if (${JSON.stringify(!!process.env.DOUBLE)}) for (const m of own.values()) m.side = THREE.DoubleSide;
    scene.add(model);
    return { triangles: tris, size: box.getSize(new THREE.Vector3()).toArray() };
  },
  // up (0 the foot, 1 the top) and near (1 the whole thing in frame) look closely at a part of it.
  view(yaw, pitch, bare, up = 0.5, near = 1) {
    for (const [o, m] of own) o.material = bare ? clay : m;
    const d = size * 1.9 * near;
    const at = new THREE.Vector3(mid.x, low + tall * up, mid.z);
    camera.position.set(at.x + d * Math.sin(yaw) * Math.cos(pitch), at.y + d * Math.sin(pitch), at.z + d * Math.cos(yaw) * Math.cos(pitch));
    camera.lookAt(at);
    renderer.render(scene, camera);
  },
};
window.__mesh.ready = true;
</script></body></html>`,
);
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
// (SIZE in the environment: each still's side in pixels, for a closer look.)
const W = Number(process.env.SIZE ?? 300);
const page = await browser.newPage({ viewport: { width: W, height: W } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}debug-shots/_meshview.html`);
await page.waitForFunction(() => window.__mesh && window.__mesh.ready, null, { timeout: 60000 });
// Round the vertical, then up: front, front quarter, side, back, above.
// (CLOSE=1 in the environment: the top fifth from the front, the quarter and behind, and the middle, close to.
// LIT=1: without the rows of bare form, for setting several versions of one thing one above another.)
const VIEWS = process.env.CLOSE
  ? [['head', 0, 0.02, 0.9, 0.22], ['head quarter', 0.6, 0.05, 0.9, 0.22], ['head back', Math.PI, 0.05, 0.9, 0.22], ['chest', 0, 0.02, 0.72, 0.32], ['hips and hands', 0, 0.02, 0.5, 0.42]]
  : [['front', 0, 0.1], ['quarter', 0.7, 0.2], ['side', Math.PI / 2, 0.1], ['back', Math.PI, 0.1], ['above', 0.4, 1.1]];
let html = `<body style="margin:0;background:#111;color:#ddd;font:12px Consolas,monospace"><table cellspacing="2" cellpadding="0">`;
for (const file of files) {
  const url = `/${file.replace(/\\/g, '/').replace(/^.*?(?=(debug-shots|assets)\/)/, '')}`;
  const info = await page.evaluate((u) => __mesh.load(u), url);
  html += `<tr><td colspan="${VIEWS.length}">${url}: ${Math.round(info.triangles).toLocaleString('en')} triangles, ${info.size.map((v) => v.toFixed(2)).join(' x ')}</td></tr>`;
  for (const bare of process.env.LIT ? [false] : [false, true]) {
    html += '<tr>';
    for (const [, yaw, pitch, up, near] of VIEWS) {
      await page.evaluate(([y, p, b, u, n]) => __mesh.view(y, p, b, u ?? 0.5, n ?? 1), [yaw, pitch, bare, up ?? null, near ?? null]);
      html += `<td><img width="${W}" height="${W}" src="data:image/png;base64,${(await page.screenshot()).toString('base64')}"></td>`;
    }
    html += '</tr>';
  }
}
html += '</table></body>';
const sheet = await browser.newPage({ viewport: { width: 100, height: 100 } });
await sheet.setContent(html);
await sheet.waitForTimeout(200);
mkdirSync(dirname(out), { recursive: true });
await (await sheet.$('table')).screenshot({ path: out });
console.log(out);
await browser.close();
await server.close();
process.exit(0);
