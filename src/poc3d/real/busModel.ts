import * as THREE from 'three';
import { BUS, BUS_POLES, busFloor, busSeats } from '../district/busCabin';
import { busLayout } from '../district/busCabin';
import type { CabinLayout } from '../district/cabin';
import type { BusLine } from '../district/traffic';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';
import { wallRects, type CarMaterials } from './trainCar';

/**
 * The city bus, second generation (review in models.html; `?transit=new` in the district): a Japanese non-step bus
 * (after the Toei and city operators' buses, invented), built to be ridden. Outside: a cream body with the line's
 * colour, a dark window band, LED destination boards front, side and back, plug doors on the kerb side. Inside:
 * the low front half with the driver, the fare box and the seats on the wheel housings, the fold-ups by the
 * wheelchair space and the middle door, two steps up to the back half's forward pairs and the bench across the
 * back; yellow stanchions with stop buttons, straps, the next-stop screen, ads over the windows.
 *
 * The frame is district/busCabin.ts's: x across (+x the left, the kerb), z along (+z the front), y up from the road.
 */

/** A line's colour (the band and the seats' trim). */
export function busColor(line: BusLine): number {
  return line.id === 'asagiri' ? 0x2a62c8 : line.id === 'kaburo' ? 0x10a060 : 0xd06a1a;
}

/** One bus: its frame, the door leaves to open, the inside to hide from afar, its screens and layout. */
export interface Bus2 {
  readonly obj: THREE.Group;
  readonly layout: CabinLayout;
  /** Opens the doors (0 shut, 1 open). */
  setDoors(open: number): void;
  /** Hides the inside beyond a distance. */
  cull(camera: THREE.Vector3, range?: number): void;
  /** The screens: the next stop inside, and whether someone has pressed the stop button. */
  setNext(next: { jp: string; en: string } | null, stopping: boolean): void;
}

const CREAM = 0xf2efe6;
const BLACK = 0x121316;
const LINING = 0xe9e7e0;
const POLE = 0xe8a41c;

/** The screens' canvas: the destination (top half: front, side, back boards), the next stop inside (bottom half). */
class BusScreens {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshBasicMaterial;
  private key = '';

  constructor(
    private readonly line: BusLine,
    private readonly color: number,
  ) {
    this.canvas.width = 512;
    this.canvas.height = 512;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, color: new THREE.Color(1.2, 1.2, 1.2) });
    this.draw(null, false);
  }

  draw(next: { jp: string; en: string } | null, stopping: boolean): void {
    const key = `${next?.jp}|${stopping}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.canvas.getContext('2d')!;
    // The destination board (LED, amber on black): the line's mark, its name, and the English under it.
    g.fillStyle = '#050505';
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = `#${this.color.toString(16).padStart(6, '0')}`;
    g.fillRect(14, 40, 120, 120);
    g.fillStyle = '#ffffff';
    g.font = "bold 64px 'Yu Gothic', 'Meiryo', sans-serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(this.line.name.slice(0, 2), 74, 100, 110);
    g.fillStyle = '#ffb848';
    g.font = "bold 76px 'Yu Gothic', 'Meiryo', sans-serif";
    g.textAlign = 'left';
    g.fillText(this.line.name, 150, 92, 350);
    g.font = "bold 34px 'Arial', sans-serif";
    g.fillText(this.line.en, 150, 170, 350);
    g.fillStyle = '#ffd890';
    g.font = "26px 'Yu Gothic', 'Meiryo', sans-serif";
    // A loop line says so; a terminal's bus where it's going.
    g.fillText(this.line.stops.some((st) => st) ? '循環  ·  LOOP  ·  均一 ¥210' : '行  ·  均一 ¥210', 20, 226, 480);
    // The next-stop screen inside (bottom half): 次は / Next, the stop big, the stop-request lamp.
    g.fillStyle = '#0e1016';
    g.fillRect(0, 256, 512, 256);
    g.fillStyle = `#${this.color.toString(16).padStart(6, '0')}`;
    g.fillRect(0, 256, 512, 22);
    g.fillStyle = '#c8ccd4';
    g.font = "bold 30px 'Yu Gothic', 'Meiryo', sans-serif";
    g.textBaseline = 'top';
    g.fillText(next ? '次は  Next' : this.line.name, 22, 292);
    g.fillStyle = '#ffffff';
    g.font = "bold 84px 'Yu Gothic', 'Meiryo', sans-serif";
    g.fillText(next?.jp ?? '', 22, 330, 470);
    g.fillStyle = '#e8c030';
    g.font = "bold 34px 'Arial', sans-serif";
    g.fillText(next?.en ?? '', 22, 424, 300);
    if (stopping) {
      g.fillStyle = '#e8303a';
      g.fillRect(330, 430, 170, 64);
      g.fillStyle = '#ffffff';
      g.font = "bold 40px 'Yu Gothic', 'Meiryo', sans-serif";
      g.fillText('とまります', 338, 440, 156);
    }
    this.texture.needsUpdate = true;
  }
}

/** Builds a bus for a line (each bus its own: the doors and screens are per bus). */
export function buildBus2(line: BusLine, mats: CarMaterials): Bus2 {
  const { H, W, INNER, FLOOR, REAR, SILL, HEAD, CEIL, TOP, FRONT_DOOR, MID_DOOR, DASH_Z, BACK_Z } = BUS;
  const color = busColor(line);
  const mb = new MeshBuilder(1 << 14);
  const ib = new MeshBuilder(1 << 14);
  const gb = new MeshBuilder(1024);
  const sb = new MeshBuilder(256);
  const uvs: number[] = [];
  for (const b of [mb, ib, gb]) {
    b.flags = 0;
    b.style = [0, 0, 0, 0];
  }
  const boxIn = (to: MeshBuilder, hex: number | [number, number, number], kind: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, style = 0): void => {
    to.kind = kind;
    to.color = typeof hex === 'number' ? lin(hex) : hex;
    to.style = [style, 0, 0, 0];
    to.box((x0 + x1) / 2, (z0 + z1) / 2, Math.min(y0, y1), Math.max(y0, y1), Math.abs(x1 - x0), Math.abs(z1 - z0), kind, true);
    to.style = [0, 0, 0, 0];
  };
  const box = (hex: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, kind: number = KIND.plain): void => boxIn(mb, hex, kind, x0, x1, y0, y1, z0, z1);
  const inner = (hex: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, to: MeshBuilder = ib): void =>
    boxIn(to, hex, KIND.emit, x0, x1, y0, y1, z0, z1, EMIT.interior);
  const glow = (rgb: [number, number, number], x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, to: MeshBuilder = mb, ch: number = EMIT.always): void =>
    boxIn(to, rgb, KIND.emit, x0, x1, y0, y1, z0, z1, ch);
  const sx = (s: number, a: number, b: number): [number, number] => [Math.min(s * a, s * b), Math.max(s * a, s * b)];
  const quadUv = (u0: number, vb: number, u1: number, vt: number): number[] => [u0, vb, u1, vb, u1, vt, u0, vt];
  /** A screen quad (into the screens' mesh) at (x, y, z) running along `a`, facing out of a x b. */
  const screen = (c: [number, number, number], a: [number, number, number], h: number, uv: number[]): void => {
    sb.quad(c, a, [0, h, 0]);
    uvs.push(...uv);
  };

  // ---- Underneath: the wheel arches (the wheels themselves turn: drawn apart), the floor.
  box(0x2a2c30, -W + 0.02, W - 0.02, 0.22, FLOOR - 0.02, -H + 0.2, H - 0.2);
  // ---- The sides: skins with the windows and (left) the doors, the window band, the line's colour.
  const wins: [number, number][] = [];
  const winEdges = [BACK_Z + 0.15, MID_DOOR[0] - 0.12, MID_DOOR[1] + 0.12, FRONT_DOOR[0] - 0.12];
  for (let i = 0; i + 1 < winEdges.length; i += 2) {
    const a = winEdges[i];
    const b = winEdges[i + 1];
    const n = Math.max(1, Math.round((b - a) / 1.25));
    for (let k = 0; k < n; k++) wins.push([a + ((b - a) * k) / n + (k ? 0.05 : 0), a + ((b - a) * (k + 1)) / n - (k < n - 1 ? 0.05 : 0)]);
  }
  // The right side has no doors: windows the whole way.
  const winsRight: [number, number][] = [];
  {
    const a = BACK_Z + 0.15;
    const b = DASH_Z - 0.2;
    const n = Math.round((b - a) / 1.25);
    for (let k = 0; k < n; k++) winsRight.push([a + ((b - a) * k) / n + (k ? 0.05 : 0), a + ((b - a) * (k + 1)) / n - (k < n - 1 ? 0.05 : 0)]);
  }
  const arches = BUS.AXLES.map((z) => [z - 0.62, z + 0.62, 0, BUS.WHEEL_R + 0.45] as [number, number, number, number]);
  for (const s of [-1, 1] as const) {
    const ws = s > 0 ? wins : winsRight;
    const doorHoles: [number, number, number, number][] = s > 0 ? [FRONT_DOOR, MID_DOOR].map(([a, b]) => [a, b, 0.2, HEAD + 0.05]) : [];
    const holes = [...doorHoles, ...ws.map(([a, b]) => [a, b, SILL, HEAD] as [number, number, number, number]), ...arches];
    for (const [za, zb, ya, yb] of wallRects(-H, H, 0.22, TOP - 0.1, holes)) box(CREAM, ...sx(s, W - 0.012, W), ya, yb, za, zb, KIND.gloss);
    for (const [za, zb, ya, yb] of wallRects(BACK_Z, DASH_Z, 0.3, CEIL, holes)) inner(LINING, ...sx(s, INNER, INNER + 0.012), ya, yb, za, zb, mb);
    // The dark band round the windows (the pillars between them dark too), the line's colour low and a stripe.
    for (const [za, zb, ya, yb] of wallRects(-H, H, SILL - 0.05, HEAD + 0.08, [...doorHoles, ...ws.map(([a, b]) => [a, b, SILL, HEAD] as [number, number, number, number])]))
      box(BLACK, ...sx(s, W, W + 0.004), ya, yb, za, zb, KIND.gloss);
    for (const [za, zb, ya, yb] of wallRects(-H, H, 0.24, 0.62, [...doorHoles, ...arches])) box(color, ...sx(s, W, W + 0.005), ya, yb, za, zb, KIND.gloss);
    for (const [za, zb, ya, yb] of wallRects(-H, H, SILL - 0.2, SILL - 0.13, doorHoles)) box(color, ...sx(s, W, W + 0.005), ya, yb, za, zb, KIND.gloss);
    for (const [a, b] of ws) {
      gb.quad([s * (W - 0.006), SILL, s > 0 ? b : a], [0, 0, s > 0 ? a - b : b - a], [0, HEAD - SILL, 0]);
      // Reveals inside.
      inner(0x3a3e44, ...sx(s, INNER, W), SILL - 0.02, SILL, a, b, mb);
    }
    // The arches: dark wells.
    for (const [a, b] of arches.map(([a, b]) => [a, b])) box(0x0a0a0b, ...sx(s, W - 0.3, W - 0.01), 0.2, BUS.WHEEL_R + 0.45, a, b);
  }
  // The side destination board (left, behind the front door) and the line's name on the right side.
  // (Reads front to back from outside on the left: along -z.)
  screen([W + 0.006, HEAD + 0.12, FRONT_DOOR[0] - 0.3], [0, 0, -1.1], 0.3, quadUv(0, 0.5, 1, 1));

  // ---- Front: the windscreen (big, raked a little), the destination board over it, lamps, bumper, wipers.
  const F = H;
  box(CREAM, -W, W, 0.22, 1.02, F - 0.05, F, KIND.gloss);
  box(color, -W, W, 0.62, 0.92, F, F + 0.006, KIND.gloss);
  box(BLACK, -W, W, 0.22, 0.5, F, F + 0.08);
  for (const s of [-1, 1]) {
    glow([1.6, 1.55, 1.35], ...sx(s, 0.82, 1.12), 0.56, 0.72, F + 0.006, F + 0.014, mb, EMIT.lamp);
    glow([0.3, 0.12, 0.02], ...sx(s, 1.12, 1.2), 0.56, 0.72, F + 0.006, F + 0.014);
  }
  gb.quad([-W + 0.06, 1.02, F - 0.02], [2 * (W - 0.06), 0, 0], [0, 1.42, -0.12]);
  // The corner pillars either side of the windscreen.
  for (const s of [-1, 1]) box(CREAM, ...sx(s, W - 0.07, W), 1.02, TOP, F - 0.16, F, KIND.gloss);
  box(BLACK, -W, W, 2.44, TOP - 0.06, F - 0.16, F - 0.1);
  screen([-0.95, 2.48, F - 0.095], [1.9, 0, 0], 0.36, quadUv(0, 0.5, 1, 1));
  box(CREAM, -W, W, TOP - 0.1, TOP, -H, F - 0.1, KIND.gloss);
  box(0x2a2c30, -0.05, 0.8, 1.06, 1.1, F - 0.04, F - 0.02);
  // ---- Back: the rear window, its board, the engine grille, tail lamps up the corners.
  const B = -H;
  const backHoles: [number, number, number, number][] = [[-0.95, 0.95, 1.55, 2.3]];
  for (const [xa, xb, ya, yb] of wallRects(-W, W, 0.22, TOP, backHoles)) box(CREAM, xa, xb, ya, yb, B, B + 0.05, KIND.gloss);
  box(color, -W, W, 0.24, 0.62, B - 0.006, B, KIND.gloss);
  box(BLACK, -0.95, 0.95, 1.55, 2.3, B + 0.02, B + 0.03);
  gb.quad([0.95, 1.55, B - 0.002], [-1.9, 0, 0], [0, 0.75, 0]);
  box(0x3a3c40, -0.8, 0.8, 0.7, 1.35, B - 0.01, B);
  for (let y = 0.75; y < 1.32; y += 0.08) box(0x1a1a1c, -0.75, 0.75, y, y + 0.03, B - 0.012, B - 0.01);
  for (const s of [-1, 1]) {
    glow([0.32, 0.01, 0.01], ...sx(s, 1.0, 1.22), 0.62, 1.32, B - 0.012, B - 0.006);
    glow([0.25, 0.1, 0.0], ...sx(s, 1.0, 1.22), 1.36, 1.5, B - 0.012, B - 0.006);
  }
  screen([0.6, 2.36, B - 0.008], [-1.2, 0, 0], 0.18, quadUv(0, 0.5, 1, 1));
  // ---- Roof: the AC unit.
  box(0xd4d6d8, -0.95, 0.95, TOP, TOP + 0.26, -3.4, 0.4);

  // ---- Inside: floors (the step up), the ceiling and its lights, the driver, the fare box, seats, poles, straps.
  inner(0x4a4c50, -INNER, INNER, FLOOR - 0.01, FLOOR, BUS.STEP_Z[0], DASH_Z, mb);
  inner(0x4a4c50, -INNER, INNER, BUS.STEP - 0.01, BUS.STEP, BUS.STEP_Z[1], BUS.STEP_Z[0], mb);
  inner(0x4a4c50, -INNER, INNER, REAR - 0.01, REAR, BACK_Z, BUS.STEP_Z[1], mb);
  // The steps' risers and their yellow nosing.
  for (const [z, y0, y1] of [[BUS.STEP_Z[0], FLOOR, BUS.STEP], [BUS.STEP_Z[1], BUS.STEP, REAR]] as const) {
    inner(0x5a5c60, -INNER, INNER, y0, y1, z - 0.01, z, mb);
    inner(0xe8c030, -INNER, INNER, y1 - 0.004, y1 + 0.002, z - 0.06, z, mb);
  }
  inner(0xf2f2ee, -INNER, INNER, CEIL, CEIL + 0.02, BACK_Z, DASH_Z, mb);
  for (const s of [-1, 1]) glow([1.6, 1.6, 1.55], ...sx(s, 0.35, 0.5), CEIL - 0.015, CEIL, BACK_Z + 0.3, DASH_Z - 0.6, ib);
  // The back wall's lining and the dashboard.
  inner(LINING, -INNER, INNER, REAR, CEIL, BACK_Z - 0.02, BACK_Z, mb);
  inner(0x26282c, -INNER, INNER, FLOOR, 1.25, DASH_Z, DASH_Z + 0.18, mb);
  // The driver: the seat, the wheel, the partition with its rail.
  inner(0x2a2c30, -1.05, -0.45, FLOOR + 0.35, FLOOR + 0.5, 3.75, 4.3);
  inner(0x2a2c30, -1.05, -0.45, FLOOR + 0.5, FLOOR + 1.2, 3.65, 3.75);
  ib.kind = KIND.emit;
  ib.style = [EMIT.interior, 0, 0, 0];
  ib.color = lin(0x1a1a1c);
  ib.beam([-0.75, 1.15, 4.45], [-0.75, 1.32, 4.62], 0.38);
  ib.style = [0, 0, 0, 0];
  inner(0xb0b4b8, -0.3, -0.27, FLOOR, 1.5, BUS.DRIVER_Z, DASH_Z);
  // The fare box (lit display) and the IC reader beside the driver.
  const [fx0, fx1, fz0, fz1] = BUS.FARE;
  inner(0x5a6068, fx0, fx1, FLOOR, 1.25, fz0, fz1);
  glow([0.15, 0.6, 0.35], fx0 + 0.05, fx1 - 0.05, 1.1, 1.2, fz0 - 0.005, fz0, ib);
  glow([0.6, 0.6, 0.65], fx0 + 0.06, fx0 + 0.18, 1.25, 1.27, fz0 + 0.05, fz0 + 0.18, ib);
  // Seats: frames, moquette (the priority seats' colour), headrests on the forward ones.
  const moquette = 0x2c4a8c;
  const priority = 0x8a3858;
  for (const st of busSeats()) {
    const base = st.cushion - 0.06;
    const floor = busFloor(st.z);
    const c = st.priority ? priority : moquette;
    if (st.high) inner(0x6a6c70, st.x - st.hw, st.x + st.hw, floor, base, st.z - st.hd, st.z + st.hd);
    else inner(0x8a8e94, st.x - st.hw + 0.04, st.x + st.hw - 0.04, floor, base, st.z - 0.05, st.z + 0.05);
    inner(c, st.x - st.hw, st.x + st.hw, base, st.cushion, st.z - st.hd, st.z + st.hd);
    if (st.face === 'fwd') {
      inner(c, st.x - st.hw, st.x + st.hw, st.cushion, st.cushion + 0.62, st.z - st.hd - 0.06, st.z - st.hd);
      inner(0xc8ccd0, st.x - st.hw + 0.02, st.x + st.hw - 0.02, st.cushion + 0.62, st.cushion + 0.66, st.z - st.hd - 0.07, st.z - st.hd + 0.01);
    } else inner(c, -INNER, -INNER + 0.06, st.cushion, st.cushion + 0.55, st.z - st.hd, st.z + st.hd);
  }
  // Poles (yellow), with stop buttons on some; straps on rails along the front half.
  ib.kind = KIND.emit;
  ib.style = [EMIT.interior, 0, 0, 0];
  for (const [px, pz] of BUS_POLES) {
    ib.color = lin(POLE);
    ib.cylinder(px, pz, busFloor(pz), CEIL, 0.02, 8, false);
    ib.color = lin(0x6a3a9a);
    ib.box(px, pz, 1.35, 1.43, 0.05, 0.05, KIND.emit, true);
  }
  for (const s of [-1, 1]) {
    ib.color = lin(POLE);
    ib.box(s * 0.62, 0.9, CEIL - 0.2, CEIL - 0.17, 0.03, 4.4, KIND.emit, true);
    for (let z = -1.0; z < 3.0; z += 0.45) {
      ib.color = lin(0x6a6e74);
      ib.box(s * 0.62, z, CEIL - 0.48, CEIL - 0.18, 0.024, 0.006, KIND.emit, true);
      ib.color = lin(0xf0f0ec);
      ib.beam([s * 0.62, CEIL - 0.48, z], [s * 0.62, CEIL - 0.6, z - 0.055], 0.018);
      ib.beam([s * 0.62, CEIL - 0.48, z], [s * 0.62, CEIL - 0.6, z + 0.055], 0.018);
      ib.beam([s * 0.62, CEIL - 0.6, z - 0.06], [s * 0.62, CEIL - 0.6, z + 0.06], 0.02);
    }
  }
  ib.style = [0, 0, 0, 0];
  // Stop buttons on the walls by the seats (purple, a lamp on top).
  for (const st of busSeats()) {
    if (st.face !== 'fwd') continue;
    const s = st.x > 0 ? 1 : -1;
    if (Math.abs(st.x) < 0.7) continue;
    inner(0x6a3a9a, ...sx(s, INNER - 0.03, INNER), st.cushion + 0.35, st.cushion + 0.45, st.z + 0.05, st.z + 0.13);
  }
  // Ads over the windows (plain coloured cards), the next-stop screen at the front facing back.
  for (const s of [-1, 1]) {
    for (let z = BACK_Z + 0.4; z < 2.8; z += 1.1) inner([0xd83a2a, 0xf0c020, 0x2a6ad0, 0xffffff, 0x30a050][Math.abs(Math.round(z * 3 + s * 5)) % 5], ...sx(s, INNER - 0.006, INNER), HEAD + 0.04, CEIL - 0.04, z, z + 0.8);
  }
  inner(0x1a1c20, -0.55, 0.55, 2.2, 2.56, 3.18, 3.24);
  screen([0.5, 2.23, 3.175], [-1.0, 0, 0], 0.3, quadUv(0, 0, 1, 0.5));

  // ---- The doors: two leaves each, plug doors that come out and slide apart along the side.
  const leaves: { group: THREE.Group; dir: number }[] = [];
  for (const dir of [-1, 1]) {
    const lb = new MeshBuilder(1024);
    const lg = new MeshBuilder(128);
    lb.flags = 0;
    for (const [z0, z1] of [FRONT_DOOR, MID_DOOR]) {
      const zm = (z0 + z1) / 2;
      const [a, b] = dir < 0 ? [z0, zm] : [zm, z1];
      for (const [za, zb, ya, yb] of wallRects(a, b, 0.24, HEAD + 0.04, [[a + 0.07, b - 0.07, 0.5, HEAD - 0.08]])) boxIn(lb, 0xb8bcc0, KIND.gloss, W - 0.03, W - 0.005, ya, yb, za, zb);
      boxIn(lb, 0x1a1a1a, KIND.plain, W - 0.035, W, 0.24, HEAD + 0.04, dir < 0 ? zm - 0.02 : zm, dir < 0 ? zm : zm + 0.02);
      lg.quad([W - 0.018, 0.5, b - 0.07], [0, 0, a - b + 0.14], [0, HEAD - 0.58, 0]);
    }
    const group = new THREE.Group();
    const leaf = new THREE.Mesh(lb.build()!, mats.city);
    const glass = new THREE.Mesh(lg.build()!, mats.glass);
    glass.renderOrder = 3;
    group.add(leaf, glass);
    leaves.push({ group, dir });
  }

  const screens = new BusScreens(line, color);
  const obj = new THREE.Group();
  const body = new THREE.Mesh(mb.build()!, mats.city);
  body.castShadow = true;
  const glassMesh = new THREE.Mesh(gb.build()!, mats.glass);
  glassMesh.renderOrder = 3;
  const sgeo = sb.build()!;
  sgeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const inside = new THREE.Group();
  inside.add(new THREE.Mesh(ib.build()!, mats.city));
  obj.add(body, glassMesh, new THREE.Mesh(sgeo, screens.material), inside, ...leaves.map((l) => l.group));
  const layout = busLayout();
  const p = new THREE.Vector3();
  return {
    obj,
    layout,
    setDoors(open: number): void {
      const k = Math.max(0, Math.min(1, open));
      // Out first, then along.
      const out = Math.min(1, k * 3) * 0.06;
      const along = Math.max(0, k * 1.2 - 0.2) * 0.48;
      for (const l of leaves) {
        l.group.position.x = out;
        l.group.position.z = l.dir * along;
      }
    },
    cull(camera: THREE.Vector3, range = 120): void {
      obj.getWorldPosition(p);
      inside.visible = p.distanceToSquared(camera) < range * range;
    },
    setNext(next, stopping): void {
      screens.draw(next, stopping);
    },
  };
}
