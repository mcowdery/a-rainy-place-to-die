// Runs on the pod: the frame rate the streamed game really gets, read from its Chromium (remote debugging on 127.0.0.1:9222,
// switched on by podPlay.sh). Counts requestAnimationFrame callbacks over a few seconds, which is what the game itself runs at.
//   node scripts/podFps.mjs [seconds]      (through the pod: node scripts/pod.mjs run --no-sync --no-pull -- node scripts/podFps.mjs)
import { chromium } from 'playwright-core';

const seconds = Number(process.argv[2] ?? 8);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => /5173/.test(p.url())) ?? browser.contexts()[0].pages()[0];
const r = await page.evaluate((s) => new Promise((resolve) => {
  let n = 0;
  const t0 = performance.now();
  const gaps = [];
  let last = t0;
  const tick = (now) => { n++; gaps.push(now - last); last = now; if (now - t0 < s * 1000) requestAnimationFrame(tick); else resolve({ fps: +(n / ((now - t0) / 1000)).toFixed(1), worstGapMs: Math.round(Math.max(...gaps)), size: `${innerWidth}x${innerHeight}`, dpr: devicePixelRatio }); };
  requestAnimationFrame(tick);
}), seconds);
console.log(JSON.stringify(r));
await browser.close();
