// Records a short clip from the game for the phone: the render canvas (no HUD) through MediaRecorder, as webm.
//
//   node scripts/phone/record_clip.mjs <out.webm> "<district query>" [seconds]
//   e.g. node scripts/phone/record_clip.mjs content/phone/media/clip.webm "time=night&weather=rain&cam=3900,5,1412,0,-12" 8
//
// Uses the installed Edge (like the benchmarks). The camera holds still; the city (rain, traffic, neon) moves.
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from '../launchBrowser.mjs';
import { shotServer } from '../shotServer.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const [out, query, secs = '8'] = process.argv.slice(2);
if (!out || !query) {
  console.log('Usage: node scripts/phone/record_clip.mjs <out.webm> "<district query>" [seconds]');
  process.exit(1);
}
const server = await shotServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto(`${server.resolvedUrls.local[0]}?${query}`);
  await page.waitForFunction(() => !/building/.test(document.getElementById('overlay')?.textContent ?? ''), null, { timeout: 180_000, polling: 500 });
  await page.waitForTimeout(8000);
  const b64 = await page.evaluate(async (ms) => {
    const canvas = document.querySelector('canvas');
    const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 3_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    rec.start(250);
    await new Promise((r) => setTimeout(r, ms));
    rec.stop();
    await done;
    const buf = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, Number(secs) * 1000);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log(`wrote ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${secs} s)`);
} finally {
  await browser.close();
  await server.close();
}
