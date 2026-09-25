import type { WorldNode } from '../content/nodes';

/** Station fast-travel menu. Resolves with the chosen station node, or null if cancelled. */
export function chooseStation(panel: HTMLElement, from: WorldNode, stations: readonly WorldNode[]): Promise<WorldNode | null> {
  const options = stations.filter((s) => s.id !== from.id);
  let sel = 0;
  const render = (): void => {
    panel.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = `地下鉄 Metro — ${from.placementName ?? from.id}`;
    const ul = document.createElement('ul');
    options.forEach((s, i) => {
      const li = document.createElement('li');
      li.textContent = `${i + 1}. ${s.placementName ?? s.id}`;
      if (i === sel) li.className = 'sel';
      ul.append(li);
    });
    const hint = document.createElement('p');
    hint.textContent = '[↑↓] choose  [Enter] ride  [Esc] cancel';
    panel.append(h, ul, hint);
  };
  render();
  panel.hidden = false;
  return new Promise((resolve) => {
    const done = (v: WorldNode | null): void => {
      window.removeEventListener('keydown', onKey, true);
      panel.hidden = true;
      resolve(v);
    };
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      if (e.key === 'Escape') done(null);
      else if (e.key === 'Enter' || e.key === ' ') done(options[sel] ?? null);
      else if (e.key === 'ArrowUp' || e.key === 'w') sel = (sel + options.length - 1) % options.length;
      else if (e.key === 'ArrowDown' || e.key === 's') sel = (sel + 1) % options.length;
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= options.length) return done(options[Number(e.key) - 1]);
      render();
    };
    window.addEventListener('keydown', onKey, true);
  });
}
