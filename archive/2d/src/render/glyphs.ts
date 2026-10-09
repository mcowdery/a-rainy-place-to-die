/**
 * Glyph atlas: each (codepoint, colour) is rasterised once into a fixed-size slot on a page canvas,
 * then blitted. Slots are two cells wide so wide (CJK) glyphs fit. Block and line characters are drawn
 * as rectangles rather than font glyphs so they tile seamlessly whatever the font.
 */
const PAGE = 1024;
const MAX_PAGES = 8;

export class GlyphCache {
  private pages: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }[] = [];
  private slots = new Map<string, number>();
  private next = 0;
  private readonly slotW: number;
  private readonly perRow: number;
  private readonly perPage: number;

  /** cw/ch are the cell size in device pixels. */
  constructor(
    private readonly cw: number,
    private readonly ch: number,
    private readonly font: string,
  ) {
    this.slotW = cw * 2;
    this.perRow = Math.floor(PAGE / this.slotW);
    this.perPage = this.perRow * Math.floor(PAGE / ch);
  }

  draw(ctx: CanvasRenderingContext2D, cp: number, wide: boolean, color: string, dx: number, dy: number): void {
    const key = color + cp;
    let slot = this.slots.get(key);
    if (slot === undefined) slot = this.render(key, cp, wide, color);
    const page = this.pages[Math.floor(slot / this.perPage)];
    const local = slot % this.perPage;
    const w = wide ? this.cw * 2 : this.cw;
    ctx.drawImage(page.canvas, (local % this.perRow) * this.slotW, Math.floor(local / this.perRow) * this.ch, w, this.ch, dx, dy, w, this.ch);
  }

  private render(key: string, cp: number, wide: boolean, color: string): number {
    if (this.next >= this.perPage * MAX_PAGES) {
      // Colours change with atmosphere; rather than track usage, start over when full.
      this.slots.clear();
      this.next = 0;
    }
    const slot = this.next++;
    const pi = Math.floor(slot / this.perPage);
    if (!this.pages[pi]) {
      const canvas = document.createElement('canvas');
      canvas.width = PAGE;
      canvas.height = PAGE;
      this.pages[pi] = { canvas, ctx: canvas.getContext('2d')! };
    }
    const c = this.pages[pi].ctx;
    const local = slot % this.perPage;
    const x = (local % this.perRow) * this.slotW;
    const y = Math.floor(local / this.perRow) * this.ch;
    const w = wide ? this.cw * 2 : this.cw;
    c.clearRect(x, y, this.slotW, this.ch);
    c.save();
    c.beginPath();
    c.rect(x, y, w, this.ch);
    c.clip();
    c.fillStyle = color;
    if (!drawBlock(c, cp, x, y, w, this.ch)) {
      c.font = this.font;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String.fromCodePoint(cp), x + w / 2, y + this.ch / 2 + 1);
    }
    c.restore();
    this.slots.set(key, slot);
    return slot;
  }
}

function drawBlock(c: CanvasRenderingContext2D, cp: number, x: number, y: number, w: number, h: number): boolean {
  const t = Math.max(1, Math.round(w / 8));
  const shade = (a: number): void => {
    c.globalAlpha = a;
    c.fillRect(x, y, w, h);
    c.globalAlpha = 1;
  };
  switch (cp) {
    case 0x2588: c.fillRect(x, y, w, h); return true; // █
    case 0x2580: c.fillRect(x, y, w, Math.round(h / 2)); return true; // ▀
    case 0x2584: c.fillRect(x, y + Math.round(h / 2), w, h - Math.round(h / 2)); return true; // ▄
    case 0x258c: c.fillRect(x, y, Math.round(w / 2), h); return true; // ▌
    case 0x2590: c.fillRect(x + Math.round(w / 2), y, w - Math.round(w / 2), h); return true; // ▐
    case 0x2591: shade(0.25); return true; // ░
    case 0x2592: shade(0.5); return true; // ▒
    case 0x2593: shade(0.75); return true; // ▓
    case 0x2500: c.fillRect(x, y + Math.round(h / 2 - t / 2), w, t); return true; // ─
    case 0x2502: c.fillRect(x + Math.round(w / 2 - t / 2), y, t, h); return true; // │
    case 0x2550: // ═
      c.fillRect(x, y + Math.round(h * 0.4 - t / 2), w, t);
      c.fillRect(x, y + Math.round(h * 0.6 - t / 2), w, t);
      return true;
    case 0x2551: // ║
      c.fillRect(x + Math.round(w * 0.3 - t / 2), y, t, h);
      c.fillRect(x + Math.round(w * 0.7 - t / 2), y, t, h);
      return true;
    case 0x25aa: { // ▪
      const s = Math.round(w * 0.5);
      c.fillRect(x + Math.round((w - s) / 2), y + Math.round((h - s) / 2), s, s);
      return true;
    }
    case 0x25ae: { // ▮
      const sw = Math.round(w * 0.5);
      const sh = Math.round(h * 0.6);
      c.fillRect(x + Math.round((w - sw) / 2), y + Math.round((h - sh) / 2), sw, sh);
      return true;
    }
    default:
      return false;
  }
}
