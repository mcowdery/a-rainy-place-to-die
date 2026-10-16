/**
 * F8: a trace of a few seconds of play for a fault in how something moves (the car shaking in a chase camera),
 * taken on the user's own machine, where the fault shows: one row a frame of whatever the page samples (the
 * camera, the car, the frame's time), saved as JSON into debug-shots/ through the dev server's `/__shot`
 * endpoint (scripts/devEndpoints.mjs; a 1x1 PNG goes with it, since the endpoint writes both). Without the dev
 * server the JSON downloads. `node debug-shots/tracestats.mjs <file>` reads one.
 */
const FRAMES = 300;
const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export class Trace {
  private rows: Record<string, number | string>[] | null = null;
  private onDone: ((file: string) => void) | null = null;

  constructor(private readonly page: string) {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F8' && !this.rows) {
        e.preventDefault();
        this.rows = [];
      }
    });
  }

  /** Whether a trace is being taken. */
  get recording(): boolean {
    return !!this.rows;
  }

  /** A line for the HUD while it records (null when not). */
  get status(): string | null {
    return this.rows ? `TRACE ${this.rows.length}/${FRAMES}` : null;
  }

  /** Each frame: the page's sample is taken only while a trace is on (`sample` is called then). */
  frame(sample: () => Record<string, number | string>, done?: (file: string) => void): void {
    if (!this.rows) return;
    this.rows.push({ t: performance.now(), ...sample() });
    if (this.rows.length < FRAMES) return;
    const rows = this.rows;
    this.rows = null;
    this.onDone = done ?? null;
    void this.save(rows);
  }

  private async save(rows: Record<string, number | string>[]): Promise<void> {
    const body = JSON.stringify({ page: `${this.page}-trace`, png: BLANK, info: { url: location.href, when: new Date().toISOString(), rows } });
    try {
      const r = await fetch('/__shot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (r.ok) {
        const { file } = (await r.json()) as { file: string };
        this.onDone?.(file.replace(/\.png$/, '.json'));
        return;
      }
    } catch {
      /* no dev server */
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(rows)], { type: 'application/json' }));
    a.download = `${this.page}-trace.json`;
    a.click();
    this.onDone?.(a.download);
  }
}
