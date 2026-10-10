/**
 * The showroom menu: the ` key (Backquote) opens a list of every showroom page, the Japanese side and Manila's apart,
 * and the other review pages; a click (or Enter on the highlighted one, arrows to move) goes there; ` or Esc closes it.
 * Imported by each showroom's entry module (shell.ts for the models-* rooms, mob.ts, scenes.ts, the anims, fight,
 * figures and humans pages), so every one of them has it. It is plain DOM over the page and takes only the one key.
 */

interface Page {
  readonly href: string;
  readonly name: string;
  readonly note: string;
}

const GROUPS: readonly { readonly title: string; readonly pages: readonly Page[] }[] = [
  {
    title: 'Tōto (Japanese)',
    pages: [
      { href: 'models-cars.html', name: 'Cars', note: 'cars, vans, trucks, scooters, taxis, work vehicles' },
      { href: 'models-mack.html', name: 'Mack', note: 'his outfits, guns, katana, bat, bikes, helmets, first person' },
      { href: 'models-plants.html', name: 'Plants', note: 'zelkova, ginkgo, sakura, pine, camphor, dogwood...' },
      { href: 'models-buildings.html', name: 'Buildings and street', note: 'mega-sign, billboards, street and park furniture' },
      { href: 'models-transit.html', name: 'Transit', note: 'trains, buses, airliners' },
      { href: 'mob.html', name: 'People', note: 'the passers-by, outfits, the street' },
      { href: 'characters.html', name: 'Characters', note: 'the named characters' },
    ],
  },
  {
    title: 'Manila',
    pages: [
      { href: 'models-cars-ph.html', name: 'Vehicles', note: 'jeepneys, tricycles' },
      { href: 'models-plants-ph.html', name: 'Plants', note: 'palms and tropical trees' },
      { href: 'models-boats-ph.html', name: 'Boats', note: 'bangkas, launch, barge, ships' },
      { href: 'models-buildings-ph.html', name: 'Buildings and street', note: 'houses, roofs, shanties, kiosks, footbridge, court' },
      { href: 'mob-ph.html', name: 'People', note: 'the Filipino outfits' },
    ],
  },
  {
    title: 'Other review pages',
    pages: [
      { href: 'scenes.html', name: 'Window rooms', note: 'the rooms behind the windows, and their editor' },
      { href: 'anims.html', name: 'Animations', note: 'the clip library on the cast' },
      { href: 'animbatch.html', name: 'Animation batch', note: 'a page of clips at a time' },
      { href: 'fight.html', name: 'Fight test', note: 'the melee yard' },
      { href: 'figures.html', name: 'Figures', note: 'generated, rigged figures' },
      { href: 'humans.html', name: 'MakeHuman', note: 'the MakeHuman test' },
      { href: 'models.html', name: 'Index', note: 'this list as a page' },
    ],
  },
];

const here = (): string => location.pathname.split('/').pop() || 'index.html';

function install(): void {
  if (typeof document === 'undefined' || (window as unknown as { __showroomNav?: boolean }).__showroomNav) return;
  (window as unknown as { __showroomNav?: boolean }).__showroomNav = true;
  const flat = GROUPS.flatMap((g) => g.pages);
  let el: HTMLDivElement | null = null;
  let at = Math.max(0, flat.findIndex((p) => p.href === here()));

  const go = (p: Page): void => {
    // (Keep the query out: another room's parameters mean nothing there.)
    location.href = p.href;
  };
  const paint = (): void => {
    if (!el) return;
    el.querySelectorAll<HTMLElement>('[data-i]').forEach((b) => {
      const i = Number(b.dataset.i);
      b.style.background = i === at ? '#2e3140' : 'transparent';
      b.style.borderColor = i === at ? '#ff5fc8' : 'transparent';
    });
  };
  const close = (): void => {
    el?.remove();
    el = null;
  };
  const open = (): void => {
    document.exitPointerLock?.();
    el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed', inset: '0', zIndex: '1000', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(6, 6, 10, 0.72)', font: "13px/1.4 Consolas, 'Cascadia Mono', 'Yu Gothic', monospace", color: '#d8d8e0',
    });
    let i = 0;
    const cols = GROUPS.map(
      (g) =>
        `<div style="min-width:260px"><div style="color:#9aa0b0;text-transform:uppercase;letter-spacing:1px;font-size:12px;margin-bottom:6px">${g.title}</div>${g.pages
          .map((p) => {
            const here0 = p.href === here();
            return `<div data-i="${i++}" data-href="${p.href}" style="cursor:pointer;padding:4px 8px;margin:2px 0;border:1px solid transparent"><b style="color:${here0 ? '#ffb0e0' : '#e8e8f0'}">${p.name}${here0 ? ' (here)' : ''}</b><div style="color:#8a8e9c;font-size:11px">${p.note}</div></div>`;
          })
          .join('')}</div>`,
    ).join('');
    el.innerHTML = `<div style="background:rgba(14,14,20,0.96);border:1px solid #34343f;padding:16px 20px;max-height:90%;overflow:auto"><div style="display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap">${cols}</div><div style="margin-top:10px;color:#8a8e9c;font-size:11px">click or Enter to go · arrows to choose · \` or Esc to close</div></div>`;
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-href]');
      if (t) go(flat[Number(t.dataset.i)]);
      else if (e.target === el) close();
    });
    document.body.append(el);
    paint();
  };

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.code === 'Backquote' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (el) close();
        else open();
        return;
      }
      if (!el) return;
      // (Open: it takes the arrows, Enter and Esc, and nothing under it hears a key.)
      if (e.code === 'Escape') close();
      else if (e.code === 'ArrowDown' || e.code === 'ArrowRight') at = (at + 1) % flat.length;
      else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') at = (at - 1 + flat.length) % flat.length;
      else if (e.code === 'Enter') go(flat[at]);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
      paint();
    },
    true,
  );
}

install();
