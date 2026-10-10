import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
await page.goto(`${server.resolvedUrls.local[0]}models.html`);
const r = await page.evaluate(async () => {
  const THREE = await import('/node_modules/.vite/deps/three.js').catch(() => import('three'));
  const { loadCharacterModel } = await import('/src/poc3d/models/characters.ts');
  const m = await loadCharacterModel('mack');
  m.updateMatrixWorld(true);
  const b = {}; m.traverse((o) => { if (o.isBone) b[o.name] = o; });
  const P = (n) => b[n].getWorldPosition(new b[n].position.constructor());
  const out = {};
  for (const s of ['l', 'r']) {
    const f = P(`middle_01_${s}`).sub(P(`hand_${s}`)).normalize();
    const a = P(`pinky_01_${s}`).sub(P(`index_01_${s}`)).normalize();
    const c = f.clone().cross(a).normalize();
    const thumb = P(`thumb_03_${s}`).sub(P(`hand_${s}`));
    const v1 = P(`middle_02_${s}`).sub(P(`middle_01_${s}`)).normalize();
    const v2 = P(`middle_03_${s}`).sub(P(`middle_02_${s}`)).normalize();
    out[s] = { cross: c.toArray().map((x) => +x.toFixed(2)), thumbDot: +thumb.dot(c).toFixed(3), curlDot: +v2.clone().sub(v1).dot(c).toFixed(3), handX: +P(`hand_${s}`).x.toFixed(2) };
  }
  return out;
});
console.log(JSON.stringify(r));
await browser.close(); await server.close();
