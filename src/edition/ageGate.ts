const KEY = 'citypop.ageConfirmed';

/**
 * The uncensored edition's age check, before the district loads: an adults-only notice with Enter and Leave.
 * Confirming is remembered in this browser (localStorage). Only the uncensored edition (uncensored.ts) imports it.
 */
export function askAge(): Promise<void> {
  try {
    if (localStorage.getItem(KEY) === '1') return Promise.resolve();
  } catch {
    // Storage blocked: ask every time.
  }
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:#07060a;color:#e8e2d8;font:15px/1.5 system-ui,sans-serif;padding:16px';
    box.innerHTML = `
      <div style="max-width:30rem;text-align:center">
        <div style="font-size:12px;letter-spacing:.2em;color:#ff5070;margin-bottom:12px">UNCENSORED EDITION · ADULTS ONLY</div>
        <p style="margin:0 0 12px">This edition contains explicit sexual content, and themes of crime and violence.</p>
        <p style="margin:0 0 24px">Everyone depicted in sexual content is an adult (21 or older). You must be 18 or older, or the age of majority where you live, to continue.</p>
        <button data-go="enter" style="font:inherit;padding:8px 20px;margin:0 6px;border:1px solid #ff5070;background:#ff5070;color:#07060a;border-radius:4px;cursor:pointer">I'm 18 or older: enter</button>
        <button data-go="leave" style="font:inherit;padding:8px 20px;margin:0 6px;border:1px solid #6a6470;background:none;color:#e8e2d8;border-radius:4px;cursor:pointer">Leave</button>
      </div>`;
    box.addEventListener('click', (e) => {
      const go = (e.target as HTMLElement).dataset.go;
      if (go === 'enter') {
        try {
          localStorage.setItem(KEY, '1');
        } catch {
          // Not remembered; fine.
        }
        box.remove();
        resolve();
      } else if (go === 'leave') {
        box.innerHTML = '<p style="text-align:center">You can close this tab.</p>';
      }
    });
    document.body.appendChild(box);
  });
}
