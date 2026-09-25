// Benchmarks the Kaburo district page in the installed Microsoft Edge: warm start, chunk generation, and
// frame times while streaming along a boulevard at 30 m/s, then standing still in ASCII and plain WebGL.
//   node scripts/benchDistrict.mjs            headless (GPU flags on; check the reported GPU)
//   node scripts/benchDistrict.mjs --headed   visible window
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const headed = process.argv.includes('--headed');
const server = await createServer({ server: { port: 0 }, logLevel: 'silent' });
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
    await page.goto(`${base}district.html?bench=1&${q}`);
    const r = await page.waitForFunction(() => window.__bench, null, { timeout: 180_000, polling: 500 }).then((h) => h.jsonValue());
    console.log(`\n## Kaburo (${q})  viewport ${r.viewport}, ascii ${r.cells} cells, GPU: ${r.gpu}`);
    console.log(`district: ${r.districtCells} chunks of 128 m · warm start ${r.warmStart.chunks} chunks in ${r.warmStart.ms} ms`);
    console.log(`chunk build: ${r.chunkGen.count} built, avg ${r.chunkGen.avgMs} ms, max ${r.chunkGen.maxMs} ms, ${r.chunkGen.disposed} disposed`);
    console.log('phase        frames  first-5 max  avg ms  p95 ms  max ms  build frames (avg/max ms)  calls  triangles');
    for (const p of r.phases) {
      const b = p.chunkBuildFrameMs ? `${p.framesWithChunkBuild} (${p.chunkBuildFrameMs.avg}/${p.chunkBuildFrameMs.max})` : '0';
      console.log(`${p.phase.padEnd(12)} ${String(p.frames).padStart(6)} ${String(p.firstFramesMaxMs).padStart(12)} ${String(p.frameMs.avg).padStart(7)} ${String(p.frameMs.p95).padStart(7)} ${String(p.frameMs.max).padStart(7)} ${b.padStart(26)} ${String(p.avgCalls).padStart(6)} ${String(p.avgTriangles).padStart(10)}`);
    }
    console.log(`loaded at end: ${r.loadedAtEnd.chunks} chunks, ${r.loadedAtEnd.buildings} buildings, ${r.loadedAtEnd.triangles} triangles`);
  }
} finally {
  await browser.close();
  await server.close();
}
