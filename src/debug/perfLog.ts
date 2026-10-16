/**
 * The frame-rate recorder (F10 in the district, or `?perflog=1` to start with it on). It keeps the last few
 * seconds of every frame (interval, CPU and GPU time, draw calls, triangles, where you are), and when the rate
 * dips (under `DIP_FPS` for a second) or one frame takes over `HITCH_MS`, it saves an event with that trace, a
 * verdict on what the frame was waiting for, and the context (district, on foot or driving or in a chase, time,
 * weather, the graphics settings). It also keeps per-place totals (cell and mode), so the slow places stand out.
 * Everything goes to the dev server's `/__perf` (scripts/devEndpoints.mjs): `debug-shots/perf/<session>.events.jsonl`,
 * one event a line, and `<session>.summary.json`, rewritten every 20 s and when the page closes. Without the dev
 * server it all stays in `window.__perfLog` (events, summary()).
 *
 * The verdict tells ours from the machine's: GPU time is the timer query round the main render (so it leaves out
 * the mirror and shadow passes' share only if they sit outside it; they don't), CPU time is the frame's JavaScript
 * from the loop's start to its end. If neither explains the interval, the frame waited on something outside the
 * game: vsync, the browser, the driver, or another program using the GPU or the CPU.
 */

const DIP_FPS = 45;
const DIP_COOLDOWN_MS = 8000;
const HITCH_MS = 100;
const HITCH_COOLDOWN_MS = 2000;
const TRACE_MS = 5000;
/** Skip the first seconds after switching on (shader compiles and the first chunks are not what we're after). */
const SETTLE_MS = 6000;
const FIELDS = 11; // t, interval, cpu, gpu, calls, tris, x, z, chunks integrated, JS heap (MB), js
const RING = 720;
/** Events kept in memory (the dev server keeps every one in the session's file). */
const MAX_EVENTS = 50;

export interface PerfFrame {
  /** performance.now() at the loop's start. */
  now: number;
  /** The frame's JavaScript to the end of the render call, ms (the call can block while the GPU is behind). */
  cpu: number;
  /** Just the JavaScript before the render call (the update: no waiting on the GPU), ms. */
  js: number;
  /** The latest GPU time of the main render, ms (0 if the timer isn't available). */
  gpu: number;
  calls: number;
  tris: number;
  x: number;
  z: number;
  /** Render resolution scale (auto resolution moves it). */
  res: number;
  /** Chunks turned into meshes this frame. */
  built: number;
  /** The shader programs compiled so far: a rise in a frame means it compiled one (a stall of a few hundred ms). */
  programs: number;
}

export interface PerfContext {
  cell: string;
  district: string;
  /** foot, driving, chase, rider, vn, ... */
  mode: string;
  /** Anything else worth having beside an event. */
  [k: string]: unknown;
}

interface CellStat {
  district: string;
  frames: number;
  ms: number;
  slow: number;
  worst: number;
  cpu: number;
  gpu: number;
  res: number;
}

export interface PerfLog {
  readonly active: boolean;
  toggle(): void;
  frame(f: PerfFrame): void;
  /** For the HUD: '' when off. */
  label(): string;
}

export function installPerfLog(opts: {
  page: string;
  /** Anything that explains the machine: GPU name, canvas size... */
  machine: () => Record<string, unknown>;
  /** Called about once a second and at each event, not every frame. */
  context: () => PerfContext;
  /** True while frames don't count (the VN, the loading screen). */
  paused?: () => boolean;
  onToggle?: (on: boolean) => void;
}): PerfLog {
  const ring = new Float32Array(RING * FIELDS);
  let head = 0; // next slot
  let count = 0;
  // On by default on the dev server (F10 or ?perflog=0 turns it off); in a build only with ?perflog=1.
  const flag = new URLSearchParams(location.search).get('perflog');
  // (Not in a benchmark run, which must not write into the user's sessions: it keeps its events in memory, and is off unless ?perflog=1.)
  const dev = import.meta.env.DEV && !new URLSearchParams(location.search).has('bench');
  let on = flag === '1' || (dev && flag !== '0');
  let startedAt = 0;
  let session = '';
  let last = 0;
  let nextCheck = 0;
  let dipUntil = 0;
  let hitchUntil = 0;
  let ctx: PerfContext = { cell: '?', district: '?', mode: '?' };
  let ctxAt = 0;
  let dips = 0;
  let hitches = 0;
  let frames = 0;
  let seconds = 0;
  let sentSummaryAt = 0;
  const hist = new Uint32Array(201); // interval in ms, 0..200+
  const cells = new Map<string, CellStat>();
  const events: unknown[] = [];
  let cur: CellStat | null = null;
  // What changed lately, for an event to carry: a shader compiled, the weather or time of day or mode switched.
  const markers: { t: number; what: string }[] = [];
  let programs = -1;
  const mark = (t: number, what: string): void => {
    markers.push({ t, what });
    if (markers.length > 40) markers.shift();
  };

  const stamp = (): string => {
    const d = new Date();
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}_${opts.page}`;
  };

  const post = (kind: 'event' | 'summary', data: unknown, beacon = false): void => {
    // (Only the dev server has the endpoint: a build keeps its events in window.__perfLog.)
    if (!dev) return;
    const body = JSON.stringify({ session, kind, data });
    try {
      if (beacon && navigator.sendBeacon) navigator.sendBeacon('/__perf', new Blob([body], { type: 'application/json' }));
      else void fetch('/__perf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
    } catch {
      /* no dev server: it stays in window.__perfLog */
    }
  };

  const quantile = (q: number): number => {
    let total = 0;
    for (const n of hist) total += n;
    let acc = 0;
    for (let i = 0; i < hist.length; i++) {
      acc += hist[i];
      if (acc >= total * q) return i;
    }
    return hist.length - 1;
  };

  const summary = (): unknown => {
    const worst = [...cells.entries()]
      .filter(([, c]) => c.frames >= 60)
      .map(([k, c]) => ({
        place: k,
        district: c.district,
        frames: c.frames,
        avgFps: +((c.frames * 1000) / c.ms).toFixed(1),
        slowShare: +(c.slow / c.frames).toFixed(3),
        worstMs: +c.worst.toFixed(0),
        avgCpuMs: +(c.cpu / c.frames).toFixed(1),
        avgGpuMs: +(c.gpu / c.frames).toFixed(1),
        avgRes: +(c.res / c.frames).toFixed(2),
      }))
      .sort((a, b) => b.slowShare - a.slowShare);
    return {
      session,
      page: opts.page,
      url: location.href,
      machine: opts.machine(),
      seconds: +seconds.toFixed(0),
      frames,
      avgFps: seconds > 0 ? +(frames / seconds).toFixed(1) : 0,
      intervalMs: { p50: quantile(0.5), p95: quantile(0.95), p99: quantile(0.99) },
      dips,
      hitches,
      // Worst places first (slowShare = frames over 25 ms). Place is "cell x,z|mode".
      places: worst,
    };
  };

  const flush = (now: number, beacon = false): void => {
    sentSummaryAt = now;
    if (frames > 0) post('summary', summary(), beacon);
  };

  const avgOver = (ms: number, now: number): { n: number; interval: number; js: number; cpu: number; gpu: number; calls: number; tris: number; res: number } => {
    let n = 0;
    let interval = 0;
    let cpu = 0;
    let js = 0;
    let gpu = 0;
    let calls = 0;
    let tris = 0;
    for (let k = 1; k <= count; k++) {
      const o = ((head - k + RING) % RING) * FIELDS;
      if (now - ring[o] > ms) break;
      n++;
      interval += ring[o + 1];
      cpu += ring[o + 2];
      js += ring[o + 10];
      gpu += ring[o + 3];
      calls += ring[o + 4];
      tris += ring[o + 5];
    }
    const d = Math.max(1, n);
    return { n, interval: interval / d, js: js / d, cpu: cpu / d, gpu: gpu / d, calls: calls / d, tris: tris / d, res: 0 };
  };

  const verdict = (interval: number, cpu: number, gpu: number): string => {
    const work = Math.max(cpu, gpu);
    if (gpu <= 0) return cpu > interval * 0.75 ? 'cpu-bound (no GPU timer)' : 'unknown (no GPU timer); CPU does not fill the frame';
    if (gpu > interval * 0.75) return 'gpu-bound: the render itself is taking the frame';
    if (cpu > interval * 0.75) return 'cpu-bound: the frame\'s JavaScript is taking the frame';
    if (interval > 27 && interval < 40 && work > 10) return 'vsync step: CPU/GPU work is near the 16.7 ms budget, so frames land every second refresh (30 fps)';
    return 'outside the frame: neither CPU nor GPU time explains it (other programs, the browser, the driver, a throttled tab)';
  };

  const trace = (ms: number, now: number): number[][] => {
    const out: number[][] = [];
    for (let k = Math.min(count, RING); k >= 1; k--) {
      const o = ((head - k + RING) % RING) * FIELDS;
      if (now - ring[o] > ms) continue;
      out.push([Math.round(ring[o] - now), +ring[o + 1].toFixed(1), +ring[o + 2].toFixed(1), +ring[o + 3].toFixed(1), ring[o + 4], ring[o + 5], Math.round(ring[o + 6]), Math.round(ring[o + 7]), ring[o + 8], +ring[o + 9].toFixed(1), +ring[o + 10].toFixed(1)]);
    }
    return out;
  };

  const event = (kind: 'dip' | 'hitch', now: number, ms: number): void => {
    try {
      ctx = opts.context();
    } catch (err) {
      ctx = { cell: '?', district: '?', mode: `contextError: ${String(err)}` };
    }
    const a = avgOver(kind === 'dip' ? 1000 : 250, now);
    const e = {
      kind,
      when: new Date().toISOString(),
      secondsIn: +((now - startedAt) / 1000).toFixed(1),
      fps: +(1000 / a.interval).toFixed(1),
      avgIntervalMs: +a.interval.toFixed(1),
      avgCpuMs: +a.cpu.toFixed(1),
      // (cpu runs to the end of the render call, which blocks while the GPU is behind; js is the update before it)
      avgJsBeforeRenderMs: +a.js.toFixed(1),
      avgGpuMs: +a.gpu.toFixed(1),
      avgCalls: Math.round(a.calls),
      avgTriangles: Math.round(a.tris),
      verdict: verdict(a.interval, a.cpu, a.gpu),
      context: ctx,
      // [msBeforeNow, interval, cpu, gpu, calls, tris, x, z] per frame
      traceFields: ['t', 'interval', 'cpu', 'gpu', 'calls', 'tris', 'x', 'z', 'chunksIntegrated', 'heapMB', 'jsBeforeRender'],
      trace: trace(ms, now),
      // [msBeforeNow, what] in the trace's span, plus anything in the 2 s before it: a stall can follow a change.
      changes: markers.filter((m) => now - m.t <= ms + 2000).map((m) => [Math.round(m.t - now), m.what]),
    };
    events.push(e);
    if (events.length > MAX_EVENTS) events.shift();
    post('event', e);
  };

  const reset = (): void => {
    head = 0;
    count = 0;
    last = 0;
    frames = 0;
    seconds = 0;
    dips = 0;
    hitches = 0;
    hist.fill(0);
    cells.clear();
    cur = null;
    markers.length = 0;
    programs = -1;
    events.length = 0;
  };

  const setOn = (v: boolean): void => {
    if (v === on && session) return;
    on = v;
    if (on) {
      reset();
      session = stamp();
      startedAt = performance.now();
      dipUntil = hitchUntil = startedAt + SETTLE_MS;
      nextCheck = startedAt + SETTLE_MS;
      sentSummaryAt = startedAt;
    } else {
      flush(performance.now());
    }
    opts.onToggle?.(on);
  };

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'F10') return;
    e.preventDefault();
    e.stopPropagation();
    setOn(!on);
  }, true);
  window.addEventListener('pagehide', () => {
    if (on) flush(performance.now(), true);
  });
  if (on) setOn(true);
  Object.assign(window, { __perfLog: { events, summary } });

  return {
    get active(): boolean {
      return on;
    },
    toggle(): void {
      setOn(!on);
    },
    label(): string {
      return on ? `REC ${dips} dip${dips === 1 ? '' : 's'} · ${hitches} hitch${hitches === 1 ? '' : 'es'}` : '';
    },
    frame(f: PerfFrame): void {
      if (!on) return;
      const interval = last ? f.now - last : 0;
      last = f.now;
      // A hidden tab, a pause or a stall of seconds isn't a frame rate.
      if (!interval || interval > 1500 || document.visibilityState !== 'visible' || opts.paused?.()) return;
      const o = head * FIELDS;
      ring[o] = f.now;
      ring[o + 1] = interval;
      ring[o + 2] = f.cpu;
      ring[o + 3] = f.gpu;
      ring[o + 4] = f.calls;
      ring[o + 5] = f.tris;
      ring[o + 6] = f.x;
      ring[o + 7] = f.z;
      ring[o + 8] = f.built;
      ring[o + 10] = f.js;
      ring[o + 9] = ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1e6;
      // (A heap that drops between frames is a garbage collection; compiles show in the programs count.)
      if (programs >= 0 && f.programs !== programs) mark(f.now, `shader programs ${programs} → ${f.programs}`);
      programs = f.programs;
      head = (head + 1) % RING;
      count = Math.min(count + 1, RING);
      if (f.now < startedAt + SETTLE_MS) return;

      frames++;
      seconds += interval / 1000;
      hist[Math.min(200, Math.round(interval))]++;
      // The place is looked up once a second, not every frame.
      if (!cur || f.now - ctxAt > 1000) {
        ctxAt = f.now;
        const before = ctx;
        try {
          ctx = opts.context();
        } catch {
          /* keep the last */
        }
        for (const k of ['weather', 'time', 'mode', 'season'] as const) {
          if (before !== ctx && before[k] !== undefined && before[k] !== ctx[k]) mark(f.now, `${k} ${String(before[k])} → ${String(ctx[k])}`);
        }
        const key = `${ctx.cell}|${ctx.mode}`;
        cur = cells.get(key) ?? null;
        if (!cur) cells.set(key, (cur = { district: ctx.district, frames: 0, ms: 0, slow: 0, worst: 0, cpu: 0, gpu: 0, res: 0 }));
      }
      const c = cur;
      c.frames++;
      c.ms += interval;
      if (interval > 25) c.slow++;
      if (interval > c.worst) c.worst = interval;
      c.cpu += f.cpu;
      c.gpu += f.gpu;
      c.res += f.res;

      if (interval > HITCH_MS && f.now > hitchUntil) {
        hitchUntil = f.now + HITCH_COOLDOWN_MS;
        hitches++;
        event('hitch', f.now, 1500);
      }
      if (f.now > nextCheck) {
        nextCheck = f.now + 250;
        const a = avgOver(1000, f.now);
        if (a.n >= 8 && a.interval > 1000 / DIP_FPS && f.now > dipUntil) {
          dipUntil = f.now + DIP_COOLDOWN_MS;
          dips++;
          event('dip', f.now, TRACE_MS);
        }
      }
      if (f.now - sentSummaryAt > 20000) flush(f.now);
    },
  };
}
