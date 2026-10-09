// Benchmarks the Kaburo district page in the installed Microsoft Edge: warm start, chunk generation, and
// frame times while streaming up and down a street through the district at 30 m/s, then standing still with the ASCII overlay on and off.
//   node scripts/benchDistrict.mjs            headless (GPU flags on; check the reported GPU)
//   node scripts/benchDistrict.mjs --headed   visible window
//   node scripts/benchDistrict.mjs --query "dark=1&shadows=4"   extra settings for both runs
import { chromium } from 'playwright-core';
import { shotServer } from './shotServer.mjs';

const headed = process.argv.includes('--headed');
const qi = process.argv.indexOf('--query');
const extra = qi > 0 ? `&${process.argv[qi + 1]}` : '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  channel: 'msedge',
  headless: !headed,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  for (const q of ['time=night&weather=clear', 'time=night&weather=rain']) {
    await page.goto(`${base}?bench=1&${q}${extra}`);
    const r = await page.waitForFunction(() => window.__bench, null, { timeout: 180_000, polling: 500 }).then((h) => h.jsonValue());
    console.log(`\n## Kaburo (${q})  viewport ${r.viewport}, GPU: ${r.gpu}`);
    console.log(`district: ${r.districtCells} chunks of 128 m · warm start ${r.warmStart.chunks} chunks in ${r.warmStart.ms} ms`);
    console.log(`chunk base: ${r.chunkGen.count} built, avg ${r.chunkGen.avgMs} ms, max ${r.chunkGen.maxMs} ms, ${r.chunkGen.disposed} disposed${r.mainThread ? ' (in workers)' : ''}`);
    console.log(`chunk detail: ${r.detailGen.count} built, avg ${r.detailGen.avgMs} ms, max ${r.detailGen.maxMs} ms${r.mainThread ? ' (in workers)' : ''}`);
    console.log('phase        frames    fps  first-5 max  avg ms  p95 ms  max ms  >16.7  >33  max gap  build frames (avg/max ms)  calls  triangles');
    for (const p of r.phases) {
      const b = p.chunkBuildFrameMs ? `${p.framesWithChunkBuild} (${p.chunkBuildFrameMs.avg}/${p.chunkBuildFrameMs.max})` : '0';
      console.log(`${p.phase.padEnd(12)} ${String(p.frames).padStart(6)} ${String(p.fps).padStart(6)} ${String(p.firstFramesMaxMs).padStart(12)} ${String(p.frameMs.avg).padStart(7)} ${String(p.frameMs.p95).padStart(7)} ${String(p.frameMs.max).padStart(7)} ${String(p.over16).padStart(6)} ${String(p.over33).padStart(4)} ${String(p.intervalMax).padStart(8)} ${b.padStart(26)} ${String(p.avgCalls).padStart(6)} ${String(p.avgTriangles).padStart(10)}`);
    }
    if (r.mainThread) console.log(`main-thread integration: ${r.mainThread.count} results, avg ${r.mainThread.avgMs} ms, max ${r.mainThread.maxMs} ms · worker build ms (base/near/ghosts avg): ${r.mainThread.workerAvg}`);
    console.log(`loaded at end: ${r.loadedAtEnd.chunks} chunks, ${r.loadedAtEnd.buildings} buildings, ${r.loadedAtEnd.triangles} triangles`);
  }
} finally {
  await browser.close();
  await server.close();
}
