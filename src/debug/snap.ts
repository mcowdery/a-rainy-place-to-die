/**
 * F9: a snapshot of what you're looking at, for reporting an issue without a screen-clipping tool. It grabs
 * the game's canvas right after the next frame renders, asks for an optional note (Enter saves, Esc saves
 * without one), and hands it to the dev server (the `/__shot` middleware in vite.config.ts), which writes
 * `debug-shots/<date>_<time>_<page>.png` and a `.json` beside it: the page's URL, the note, the text on the
 * HUD (the canvas holds only the 3D view) and whatever state the page adds (where you are, your car's
 * damage...). Without the dev server (a build) the PNG downloads instead.
 */

export interface Snap {
  /** Call right after the frame renders (the canvas is only readable then). */
  afterRender(): void;
}

export function installSnap(canvas: HTMLCanvasElement, page: string, state: () => Record<string, unknown> = () => ({})): Snap {
  let want = false;
  let busy = false;
  const toast = document.createElement('div');
  Object.assign(toast.style, {
    position: 'fixed',
    top: '14px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '1000',
    padding: '8px 14px',
    background: 'rgba(8,8,14,0.9)',
    border: '1px solid #ff8ad0',
    color: '#e8e6f0',
    font: "13px 'Consolas', monospace",
    display: 'none',
    borderRadius: '4px',
    boxShadow: '0 0 18px rgba(255,90,180,0.35)',
  });
  document.body.append(toast);
  let hideT = 0;
  const say = (html: string, secs: number): void => {
    toast.innerHTML = html;
    toast.style.display = 'block';
    clearTimeout(hideT);
    if (secs > 0) hideT = window.setTimeout(() => (toast.style.display = 'none'), secs * 1000);
  };

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.code !== 'F9' || busy) return;
      e.preventDefault();
      e.stopPropagation();
      want = true;
    },
    true,
  );

  /** The visible text of the fixed HUD elements (speedo, damage panel, toasts...). */
  const hudText = (): string[] => {
    const out: string[] = [];
    for (const el of document.body.querySelectorAll<HTMLElement>('body > div')) {
      if (el === toast || el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
      const t = el.innerText.trim().replace(/\s+\n/g, '\n');
      if (t) out.push(t.length > 600 ? `${t.slice(0, 600)}…` : t);
    }
    return out;
  };

  const send = async (png: string, info: Record<string, unknown>, note: string): Promise<void> => {
    const body = JSON.stringify({ page, png, info: { ...info, note } });
    try {
      const r = await fetch('/__shot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (!r.ok) throw new Error(String(r.status));
      const { file } = (await r.json()) as { file: string };
      say(`📸 Saved <b>${file}</b>`, 3.5);
    } catch {
      // No dev server: download it.
      const a = document.createElement('a');
      a.href = png;
      a.download = `${page}-${Date.now()}.png`;
      a.click();
      say('📸 Downloaded (no dev server to save it to debug-shots/)', 4);
    }
  };

  const ask = (png: string, info: Record<string, unknown>): void => {
    busy = true;
    if (document.pointerLockElement) document.exitPointerLock();
    say(
      `📸 Snapshot · note (optional): <input style="width:340px;margin-left:6px;background:#14141c;color:#fff;border:1px solid #555;padding:4px 6px;font:inherit" placeholder="what's wrong here?"> <span style="color:#8a90a8">Enter saves · Esc no note</span>`,
      0,
    );
    const input = toast.querySelector('input')!;
    toast.style.pointerEvents = 'auto';
    const done = (note: string): void => {
      busy = false;
      toast.style.pointerEvents = 'none';
      say('📸 Saving…', 0);
      void send(png, info, note);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done(input.value.trim());
      else if (e.key === 'Escape') done('');
    });
    // Keep the game's keys out of the note.
    for (const t of ['keyup', 'keypress'] as const) input.addEventListener(t, (e) => e.stopPropagation());
    setTimeout(() => input.focus(), 0);
  };

  return {
    afterRender(): void {
      if (!want) return;
      want = false;
      let info: Record<string, unknown> = {};
      try {
        info = state();
      } catch (err) {
        info = { stateError: String(err) };
      }
      const png = canvas.toDataURL('image/png');
      ask(png, { url: location.href, when: new Date().toISOString(), size: [canvas.width, canvas.height], hud: hudText(), ...info });
    },
  };
}
