// Lists the scene's direct-child meshes with a MeshBasicMaterial (what they are, where, their state).
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&res=100&perflog=0`, { timeout: 180000 });
await page.waitForFunction(() => window.__own && window.__district, null, { timeout: 240000, polling: 200 });
await page.waitForTimeout(3000);
console.log(await page.evaluate(() => window.__scene.children.filter((o) => o.material && !Array.isArray(o.material) && o.material.type === 'MeshBasicMaterial').map((o) => `${o.name || '(unnamed)'} ${o.geometry.type} vis=${o.visible} cull=${o.frustumCulled} pos=${o.position.x.toFixed(0)},${o.position.y.toFixed(0)},${o.position.z.toFixed(0)} col=${o.material.color.getHexString()} tr=${o.material.transparent} blend=${o.material.blending} verts=${o.geometry.attributes.position?.count} prog=${!!window.__renderer.properties.get(o.material).currentProgram}`).join('\n')));
await browser.close(); await server.close();
