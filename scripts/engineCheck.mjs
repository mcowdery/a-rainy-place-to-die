// Does CarSound load and decode its recorded engine loops (race/engineSamples.ts)? node scripts/engineCheck.mjs
// For each voice, starts a CarSound, sweeps the revs and prints how many loops are running and the pitch they play at.
import { launchBrowser } from './launchBrowser.mjs';
import { shotServer } from './shotServer.mjs';

const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' }, { gpu: 'off' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
for (const voice of ['real', 'loops', 'honda', 'synth']) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  page.on('console', (m) => m.type() === 'error' && console.log('console.error', m.text()));
  await page.goto(`${server.resolvedUrls.local[0]}mob.html?engine=${voice}`, { waitUntil: 'domcontentloaded' });
  const r = await page.evaluate(async () => {
    const { CarSound } = await import('/src/race/sound.ts');
    const s = new CarSound();
    s.configure({ maxRpm: 4200, fire: 3, buzz: 0.04 });
    s.start();
    await new Promise((r) => setTimeout(r, 1500));
    const out = [];
    for (const rev of [0, 0.5, 1]) {
      s.update(0.016, { rev, gear: 1, throttle: 1, speed: 10, slide: 0, spin: 0, bump: 0 });
      await new Promise((r) => setTimeout(r, 300));
      out.push(s.samples.map((x) => `${x.src.playbackRate.value.toFixed(2)}x${x.gain.gain.value.toFixed(2)}`).join(' '));
    }
    return { loaded: s.samples.length, sweep: out };
  });
  console.log(voice, JSON.stringify(r));
  await page.close();
}
await browser.close();
await server.close();
process.exit(0);
