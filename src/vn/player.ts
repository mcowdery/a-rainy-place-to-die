import type { HandoffNode, VnBridge, VnReturn } from '../game/bridge';
import { type Flags, type Step, VnEngine, type VnLibrary } from './engine';
import type { Frame } from './format';

/**
 * VN mode: plays exported VN stories (format.ts) as the world's VnBridge. A world node's id is the entry key
 * (`bar_kanpai.mama`): the story that declares it as an entry point plays from that frame. An `exit:<a>.<b>`
 * target returns to the world at the spawn node `<a>.<b>` (if there is one; else where you were). Nodes no
 * story knows fall back to the given bridge (the placeholder).
 *
 * A frame shows its still (letterboxed, over the dimmed city) or, with no image, plays over the paused city
 * between cinematic bars. Bubbles type out; click, Space or Enter finishes the line, then continues. Choices
 * are buttons (1-6); hotspots light up under the mouse. Esc leaves the scene.
 */
export class VnPlayer implements VnBridge {
  private readonly root: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly img: HTMLImageElement;
  private readonly layer: HTMLDivElement;
  private readonly hot: SVGSVGElement;
  private readonly menu: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly tag: HTMLDivElement;
  private readonly engine: VnEngine;
  private typing: { el: HTMLElement; text: string; shown: number }[] = [];
  private timer = 0;
  private finish: ((r: VnReturn) => void) | null = null;
  private waitingInspect = false;

  constructor(
    lib: VnLibrary,
    flags: Flags,
    private readonly fallback: VnBridge,
    private readonly isSpawn: (id: string) => boolean,
    private readonly debug = false,
  ) {
    this.engine = new VnEngine(lib, flags);
    injectStyle();
    this.root = el('div', 'vn-root');
    this.stage = el('div', 'vn-stage');
    this.img = document.createElement('img');
    this.img.className = 'vn-img';
    this.layer = el('div', 'vn-layer');
    this.hot = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.hot.setAttribute('class', 'vn-hot');
    this.hot.setAttribute('viewBox', '0 0 1 1');
    this.hot.setAttribute('preserveAspectRatio', 'none');
    this.menu = el('div', 'vn-menu');
    this.hint = el('div', 'vn-hint');
    this.hint.textContent = '▼';
    this.tag = el('div', 'vn-tag');
    this.stage.append(this.img, this.hot, this.layer);
    this.root.append(el('div', 'vn-bar vn-top'), el('div', 'vn-bar vn-bottom'), this.stage, this.menu, this.hint, this.tag);
    this.root.hidden = true;
    document.body.append(this.root);
    this.root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.vn-choice, .vn-hot path, .vn-hot ellipse')) return;
      this.advance();
    });
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden) return;
      if (e.key === ' ' || e.key === 'Enter') this.advance();
      else if (e.key === 'Escape') this.leave({ kind: 'end' });
      else if (/^[1-6]$/.test(e.key)) {
        if (!this.menu.hidden) (this.menu.children[Number(e.key) - 1] as HTMLButtonElement | undefined)?.click();
      }
      else return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
    window.addEventListener('resize', () => this.layout());
  }

  enter(node: HandoffNode): Promise<VnReturn> {
    const step = this.engine.enter(node.id);
    if (!step) return this.fallback.enter(node);
    this.root.hidden = false;
    document.body.classList.add('vn-on');
    return new Promise((resolve) => {
      this.finish = resolve;
      this.show(step);
    });
  }

  private show(step: Step): void {
    if (step.kind !== 'frame') return this.leave(step);
    const f = this.engine.frame!;
    const url = this.engine.lib.imageOf(step.key);
    this.root.classList.toggle('vn-still', !!url);
    if (url) this.img.src = url;
    this.img.hidden = !url;
    this.tag.textContent = this.debug ? `${step.key}${f.title ? ` · ${f.title}` : ''}` : f.title;
    this.layout();
    this.draw(f);
  }

  /** The stage rect: the still, contained in the window; or the whole window. */
  private layout(): void {
    const f = this.engine.frame;
    const W = window.innerWidth;
    const H = window.innerHeight;
    let w = W;
    let h = H;
    if (f?.size && !this.img.hidden) {
      const k = Math.min(W / f.size[0], (H * 0.86) / f.size[1]);
      w = f.size[0] * k;
      h = f.size[1] * k;
    }
    Object.assign(this.stage.style, { width: `${w}px`, height: `${h}px`, left: `${(W - w) / 2}px`, top: `${(H - h) / 2}px` });
  }

  private draw(f: Frame): void {
    this.layer.innerHTML = '';
    this.menu.innerHTML = '';
    this.hot.innerHTML = '';
    this.typing = [];
    this.waitingInspect = false;
    for (const b of f.bubbles) if (b.show === 'enter') this.bubble(b.text, b.kind, b.x, b.y);
    // Hotspots: outlined only under the mouse.
    for (const h of this.engine.hotspots()) {
      const ns = 'http://www.w3.org/2000/svg';
      const [bx, by, bw, bh] = h.box;
      const shape = h.shape === 'circle' ? document.createElementNS(ns, 'ellipse') : document.createElementNS(ns, 'path');
      if (h.shape === 'circle') {
        shape.setAttribute('cx', String(bx + bw / 2));
        shape.setAttribute('cy', String(by + bh / 2));
        shape.setAttribute('rx', String(bw / 2));
        shape.setAttribute('ry', String(bh / 2));
      } else {
        const pts = h.points.length >= 3 ? h.points : [[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh]];
        shape.setAttribute('d', `M${pts.map((p) => p.join(' ')).join('L')}Z`);
      }
      shape.setAttribute('vector-effect', 'non-scaling-stroke');
      shape.addEventListener('click', (e) => {
        e.stopPropagation();
        const use = this.engine.use(h.id);
        if (!use) return;
        if (use.kind === 'inspect') {
          this.layer.querySelectorAll('.vn-inspect').forEach((n) => n.remove());
          const [ix, iy, iw] = use.box;
          this.typing = this.typing.filter((t) => t.el.isConnected);
          this.bubble(use.text, 'caption', Math.min(0.85, Math.max(0.15, ix + iw / 2)), Math.min(0.9, iy + 0.02), 'vn-inspect');
          this.waitingInspect = true;
          this.tick();
        } else this.show(use);
      });
      this.hot.append(shape);
    }
    const choices = this.engine.choices();
    choices.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.className = 'vn-choice';
      btn.textContent = `${i + 1}. ${c.text}`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const step = this.engine.pick(c.id);
        if (step) this.show(step);
      });
      this.menu.append(btn);
    });
    this.menu.hidden = true;
    this.tick();
  }

  /** A bubble at (x, y) (fractions of the stage), its text typed out. */
  private bubble(text: string, kind: string, x: number, y: number, extra = ''): void {
    const d = el('div', `vn-bubble vn-${['speech', 'thought', 'shout', 'caption'].includes(kind) ? kind : 'speech'} ${extra}`);
    d.style.left = `${x * 100}%`;
    d.style.top = `${y * 100}%`;
    const t = el('span', 'vn-text');
    d.append(t);
    this.layer.append(d);
    this.typing.push({ el: t, text, shown: 0 });
    // Keep bubbles on the stage.
    requestAnimationFrame(() => {
      const r = d.getBoundingClientRect();
      const s = this.stage.getBoundingClientRect();
      if (r.right > s.right - 8) d.style.left = `${((s.width - r.width / 2 - 8) / s.width) * 100}%`;
      if (r.left < s.left + 8) d.style.left = `${((r.width / 2 + 8) / s.width) * 100}%`;
    });
  }

  private tick(): void {
    cancelAnimationFrame(this.timer);
    const step = (): void => {
      let busy = false;
      for (const t of this.typing) {
        if (t.shown < t.text.length) {
          t.shown = Math.min(t.text.length, t.shown + 1.2);
          t.el.textContent = t.text.slice(0, Math.floor(t.shown));
          busy = true;
        }
      }
      if (busy) this.timer = requestAnimationFrame(step);
      else this.settle();
    };
    this.hint.hidden = true;
    this.timer = requestAnimationFrame(step);
  }

  /** The lines are out: offer the choices, or show that there's more. */
  private settle(): void {
    const f = this.engine.frame;
    if (!f) return;
    const choices = this.menu.children.length > 0;
    this.menu.hidden = !choices;
    this.hint.hidden = choices || (f.next === null && this.engine.hotspots().length > 0);
  }

  private get typingDone(): boolean {
    return this.typing.every((t) => t.shown >= t.text.length);
  }

  /** Click / Space / Enter: finish the typing, dismiss an inspect note, or continue. */
  private advance(): void {
    if (!this.engine.frame) return;
    if (!this.typingDone) {
      for (const t of this.typing) {
        t.shown = t.text.length;
        t.el.textContent = t.text;
      }
      return;
    }
    if (this.waitingInspect) {
      this.layer.querySelectorAll('.vn-inspect').forEach((n) => n.remove());
      this.waitingInspect = false;
      return;
    }
    const f = this.engine.frame;
    if (this.menu.children.length > 0) return;
    if (f.next === null && this.engine.hotspots().length > 0) return;
    this.show(this.engine.next());
  }

  private leave(step: Step): void {
    cancelAnimationFrame(this.timer);
    this.root.hidden = true;
    document.body.classList.remove('vn-on');
    const done = this.finish;
    this.finish = null;
    if (!done) return;
    if (step.kind === 'exit') done({ returnSpawn: this.isSpawn(step.to) ? step.to : null });
    else done({});
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

let styled = false;
function injectStyle(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
  .vn-on #hud, .vn-on #overlay { visibility: hidden; }
  .vn-root { position: fixed; inset: 0; z-index: 30; font-family: 'Yu Gothic', 'Meiryo', 'Segoe UI', sans-serif; user-select: none; cursor: pointer;
    background: radial-gradient(ellipse at 50% 40%, rgba(10,4,16,0.05), rgba(10,4,16,0.55)); }
  .vn-root.vn-still { background: rgba(6,3,10,0.88); }
  .vn-bar { position: absolute; left: 0; right: 0; height: 9vh; background: #000; }
  .vn-top { top: 0; } .vn-bottom { bottom: 0; }
  .vn-still .vn-bar { opacity: 0; }
  .vn-stage { position: absolute; }
  .vn-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; box-shadow: 0 0 60px rgba(255,80,160,0.18); animation: vn-in 0.35s ease-out; }
  .vn-img[hidden] { display: none; }
  @keyframes vn-in { from { opacity: 0; filter: brightness(1.6); } to { opacity: 1; filter: none; } }
  .vn-layer { position: absolute; inset: 0; pointer-events: none; }
  .vn-hot { position: absolute; inset: 0; width: 100%; height: 100%; }
  .vn-hot path, .vn-hot ellipse { fill: rgba(255,95,168,0); stroke: rgba(255,120,190,0); stroke-width: 2; cursor: pointer; transition: fill 0.15s, stroke 0.15s; }
  .vn-hot path:hover, .vn-hot ellipse:hover { fill: rgba(255,95,168,0.14); stroke: rgba(255,150,210,0.9); }
  .vn-bubble { position: absolute; transform: translate(-50%, -50%); max-width: min(46vw, 620px); padding: 14px 20px; font-size: clamp(15px, 1.7vw, 22px); line-height: 1.5;
    animation: vn-pop 0.18s ease-out; }
  @keyframes vn-pop { from { opacity: 0; transform: translate(-50%, -40%); } to { opacity: 1; transform: translate(-50%, -50%); } }
  .vn-speech { background: rgba(252,244,248,0.95); color: #1a0e18; border-radius: 16px; box-shadow: 0 6px 24px rgba(0,0,0,0.5), 0 0 0 2px rgba(255,95,168,0.55); }
  .vn-thought { background: rgba(236,232,255,0.9); color: #221a3a; border-radius: 28px; font-style: italic; border: 2px dashed rgba(140,120,255,0.7); }
  .vn-shout { background: #ffe45f; color: #1a0e00; font-weight: 800; border-radius: 4px; transform: translate(-50%, -50%) rotate(-2deg); box-shadow: 0 0 0 3px #1a0e00; }
  .vn-caption { background: rgba(12,6,18,0.82); color: #f4dcea; border-radius: 4px; font-style: italic; border-left: 3px solid #ff5fa8; }
  .vn-menu { position: absolute; left: 50%; bottom: 12vh; transform: translateX(-50%); display: flex; flex-direction: column; gap: 10px; min-width: min(560px, 80vw); }
  .vn-menu[hidden] { display: none; }
  .vn-still .vn-menu { left: auto; right: 4vw; transform: none; min-width: 0; width: min(440px, 34vw); bottom: 14vh; }
  .vn-choice { font: inherit; font-size: clamp(15px, 1.5vw, 20px); text-align: left; padding: 12px 20px; color: #fbe8f2; background: rgba(20,8,24,0.86);
    border: 1px solid rgba(255,95,168,0.55); border-radius: 6px; cursor: pointer; transition: background 0.12s, transform 0.12s; }
  .vn-choice:hover { background: rgba(120,20,70,0.9); transform: translateX(6px); }
  .vn-hint { position: absolute; right: 4vw; bottom: 11vh; color: #ff8fc8; font-size: 22px; animation: vn-blink 1s steps(2) infinite; }
  .vn-hint[hidden] { display: none; }
  @keyframes vn-blink { 50% { opacity: 0; } }
  .vn-tag { position: absolute; left: 3vw; top: calc(9vh + 12px); color: rgba(255,200,230,0.75); font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; }
  `;
  document.head.append(s);
}
