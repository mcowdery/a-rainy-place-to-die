import * as THREE from 'three';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';

/**
 * What stood on Kaburo Crossing's corner before the mega-sign (the city in another year, district/era.ts): a 1970s
 * cinema palace, the 歌舞路座 (Kaburo-za, invented), as the picture houses round Kabukichō's square were. Five storeys of
 * brown tile with a parapet, a huge hand-painted film billboard (kanban) on each street face under floodlights on arms,
 * a marquee wrapping the corner with rows of bulbs and a lit soffit, a vertical red neon sign down the corner, the
 * entrance's glass doors and a lit ticket window, poster frames either side.
 *
 * **A candidate for review** (the user, 2026-10-14: "Yes go ahead"): `models-buildings.html?era=1977` stands it on the
 * mega-sign's plaza. The billboards are painted here in canvas as placeholders for generated art (propose, then review).
 *
 * Built in the mega-sign's frame: 20 x 20 m about the centre, the street faces south (+z) and west (-x), the corner at
 * (-10, +10). Place and rotate the group as the mega-sign's.
 */

const HALF = 10;
const HEIGHT = 18;
const TILE = 0x6a5a4c;
const STEEL = 0x1c1c1e;
const BOARD = { y0: 7.2, y1: 15.2, w: 16 };
const CANOPY = { y0: 3.7, y1: 4.3, out: 2.4 };

/** The two films on the boards (invented): title, its reading, the stars, the tag. */
const FILMS = [
  { title: '雨の街に死す', sub: 'AME NO MACHI NI SHISU', cast: '主演 三条剛 · 白石京子', tag: '大ヒット上映中', sky: ['#2a0c10', '#8a2a18'] },
  { title: '港の夜叉', sub: 'MINATO NO YASHA', cast: '主演 鬼塚進 · 春日ゆり', tag: '近日公開', sky: ['#0c1a2a', '#2a5a6a'] },
] as const;

/** A hand-painted billboard: a dark sky, two figures in silhouette, a gun, the title in heavy brush strokes, the cast. */
function boardCanvas(f: (typeof FILMS)[number]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1600;
  c.height = 800;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 800);
  sky.addColorStop(0, f.sky[0]);
  sky.addColorStop(1, f.sky[1]);
  g.fillStyle = sky;
  g.fillRect(0, 0, 1600, 800);
  // Brush texture: streaks across the sky.
  for (let i = 0; i < 260; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.02 + (i % 7) * 0.006})`;
    g.lineWidth = 2 + (i % 5) * 3;
    const y = (i * 97) % 800;
    g.beginPath();
    g.moveTo(-20, y);
    g.bezierCurveTo(400, y + ((i * 13) % 40) - 20, 1100, y - ((i * 17) % 40) + 20, 1620, y + ((i * 7) % 30) - 15);
    g.stroke();
  }
  // Two figures in silhouette against the sky, as the noir posters painted them: a man in a hat and coat, big on the
  // left, his head turned; a woman's profile behind him, her hair up. (Placeholders for generated art.)
  g.fillStyle = 'rgba(8,4,4,0.94)';
  g.beginPath();
  // His shoulders and coat collar.
  g.moveTo(120, 800);
  g.bezierCurveTo(150, 600, 260, 560, 360, 540);
  g.lineTo(440, 470);
  g.lineTo(560, 540);
  g.bezierCurveTo(660, 560, 760, 620, 790, 800);
  g.closePath();
  g.fill();
  // His head and neck, the hat's crown and its wide brim tipped down.
  g.beginPath();
  g.ellipse(450, 380, 92, 118, -0.08, 0, Math.PI * 2);
  g.fill();
  g.fillRect(410, 440, 80, 90);
  g.beginPath();
  g.ellipse(452, 286, 175, 34, -0.12, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(370, 290);
  g.bezierCurveTo(372, 170, 530, 160, 535, 280);
  g.closePath();
  g.fill();
  // Her profile behind: forehead, nose, lips, chin, the neck, hair piled up.
  g.fillStyle = 'rgba(14,6,6,0.88)';
  g.beginPath();
  g.moveTo(980, 800);
  g.lineTo(990, 640);
  g.bezierCurveTo(985, 600, 950, 590, 945, 560);
  g.lineTo(925, 548);
  g.lineTo(938, 530);
  g.lineTo(924, 512);
  g.lineTo(940, 498);
  g.bezierCurveTo(930, 470, 905, 455, 930, 420);
  g.bezierCurveTo(950, 380, 1000, 350, 1060, 352);
  g.bezierCurveTo(1150, 330, 1190, 420, 1160, 500);
  g.bezierCurveTo(1140, 560, 1110, 600, 1120, 800);
  g.closePath();
  g.fill();
  g.beginPath();
  g.ellipse(1085, 340, 85, 60, 0.3, 0, Math.PI * 2);
  g.fill();
  // A rim of light on each, from the sky behind.
  g.strokeStyle = 'rgba(255,190,140,0.35)';
  g.lineWidth = 5;
  g.beginPath();
  g.ellipse(450, 380, 92, 118, -0.08, -1.2, 0.4);
  g.stroke();
  g.beginPath();
  g.moveTo(945, 560);
  g.lineTo(925, 548);
  g.lineTo(938, 530);
  g.lineTo(924, 512);
  g.lineTo(940, 498);
  g.stroke();
  // A pistol in the corner, painted flat.
  g.fillStyle = '#0a0a0c';
  g.fillRect(1270, 560, 240, 46);
  g.fillRect(1440, 560, 60, 130);
  g.fillRect(1250, 548, 40, 20);
  // The title: heavy brush characters in white with a red shadow, the reading under it.
  g.font = "900 168px 'Yu Mincho', 'MS Mincho', serif";
  g.textAlign = 'right';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#a01818';
  g.fillText(f.title, 1572, 232);
  g.fillStyle = '#f4ecd8';
  g.fillText(f.title, 1560, 220);
  g.font = "bold 40px 'Arial', sans-serif";
  g.fillStyle = '#e8d8b0';
  g.fillText(f.sub, 1560, 280);
  g.font = "bold 52px 'Yu Gothic', 'Meiryo', sans-serif";
  g.fillStyle = '#f0e6cc';
  g.fillText(f.cast, 1560, 740);
  // The tag in a red box, top left.
  g.fillStyle = '#c81e1e';
  g.fillRect(40, 40, 360, 96);
  g.fillStyle = '#fff4dc';
  g.textAlign = 'center';
  g.font = "900 60px 'Yu Gothic', 'Meiryo', sans-serif";
  g.fillText(f.tag, 220, 110);
  // Weathering: a darker band along the foot and a few drips.
  const foot = g.createLinearGradient(0, 600, 0, 800);
  foot.addColorStop(0, 'rgba(0,0,0,0)');
  foot.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = foot;
  g.fillRect(0, 600, 1600, 200);
  return c;
}

/** The corner's vertical neon: 歌舞路座 in red on black. */
function neonCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 720;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a0606';
  g.fillRect(0, 0, 160, 720);
  g.font = "900 128px 'Yu Mincho', 'MS Mincho', serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#ff2a1a';
  g.shadowBlur = 18;
  g.fillStyle = '#ffd8c8';
  ['歌', '舞', '路', '座'].forEach((ch, i) => g.fillText(ch, 80, 95 + i * 175));
  return c;
}

function canvasMaterial(canvas: HTMLCanvasElement, brightness: number): THREE.MeshBasicMaterial {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(brightness, brightness, brightness), fog: true });
}

export interface Cinema70 {
  readonly group: THREE.Group;
  /** Where the camera looks for the top (the showroom's focus). */
  readonly headAt: THREE.Vector3;
}

export function buildCinema70(city: THREE.Material): Cinema70 {
  const group = new THREE.Group();
  const mb = new MeshBuilder();
  mb.id = 90021;
  mb.flags = 0;
  mb.style = [0, 0, 0, 0];
  // The block: brown tile, a darker plinth, a parapet with a coping.
  mb.kind = KIND.plain;
  mb.color = lin(TILE);
  mb.box(0, 0, 0.6, HEIGHT, 2 * HALF, 2 * HALF);
  mb.color = lin(0x3a322c);
  mb.box(0, 0, 0, 0.6, 2 * HALF + 0.1, 2 * HALF + 0.1);
  mb.color = lin(0x5a4c40);
  mb.box(0, 0, HEIGHT, HEIGHT + 0.9, 2 * HALF + 0.2, 2 * HALF + 0.2);
  mb.color = lin(0x8a8a86);
  mb.box(0, 0, HEIGHT + 0.9, HEIGHT + 1.0, 2 * HALF + 0.3, 2 * HALF + 0.3);
  // A water tank and the projection-room vents on the roof.
  mb.color = lin(0x6a6c6e);
  mb.box(4, -5, HEIGHT + 0.9, HEIGHT + 4.2, 3.2, 3.2);
  mb.color = lin(0x3a3c3e);
  for (const x of [-4, -1.5]) mb.box(x, -6, HEIGHT + 0.9, HEIGHT + 2.0, 1.2, 1.2);
  // Pilasters on the street faces, between the billboard and the canopy: tile a shade darker.
  mb.color = lin(0x5c4e42);
  for (const x of [-9.6, 9.6]) mb.box(x, HALF + 0.15, 0.6, HEIGHT, 0.8, 0.3);
  for (const z of [-9.6, 9.6]) mb.box(-HALF - 0.15, z, 0.6, HEIGHT, 0.3, 0.8);

  // The billboards: a steel frame standing off each face, the painted board on it (its own mesh), floodlights on arms.
  const boards: THREE.Mesh[] = [];
  const board = (face: 'south' | 'west', film: number): void => {
    const geo = new THREE.PlaneGeometry(BOARD.w, BOARD.y1 - BOARD.y0);
    const m = new THREE.Mesh(geo, canvasMaterial(boardCanvas(FILMS[film]), 0.92));
    const yc = (BOARD.y0 + BOARD.y1) / 2;
    if (face === 'south') m.position.set(0, yc, HALF + 0.42);
    else {
      m.position.set(-HALF - 0.42, yc, 0);
      m.rotation.y = -Math.PI / 2;
    }
    boards.push(m);
    mb.kind = KIND.plain;
    mb.color = lin(STEEL);
    const [bx, bz, bw, bd] = face === 'south' ? [0, HALF + 0.25, BOARD.w + 0.6, 0.3] : [-HALF - 0.25, 0, 0.3, BOARD.w + 0.6];
    mb.box(bx, bz, BOARD.y0 - 0.3, BOARD.y1 + 0.3, bw, bd);
    // Four floodlights on arms over the board, their heads lit at night.
    for (let k = 0; k < 4; k++) {
      const t = -BOARD.w / 2 + 2 + k * ((BOARD.w - 4) / 3);
      const [ax, az] = face === 'south' ? [t, HALF + 0.4] : [-HALF - 0.4, t];
      const [ox, oz] = face === 'south' ? [0, 1.4] : [-1.4, 0];
      mb.kind = KIND.plain;
      mb.color = lin(STEEL);
      mb.beam([ax, BOARD.y1 + 0.35, az], [ax + ox, BOARD.y1 + 0.9, az + oz], 0.06);
      mb.kind = KIND.emit;
      mb.style = [EMIT.lamp, 0, 0, 0];
      mb.color = [1.6, 1.4, 1.1];
      mb.box(ax + ox, az + oz, BOARD.y1 + 0.75, BOARD.y1 + 1.0, 0.35, 0.35, KIND.emit, true);
      mb.style = [0, 0, 0, 0];
    }
  };
  board('south', 0);
  board('west', 1);

  // The marquee: a canopy wrapping the corner, bulbs along its fascia, a lit soffit, the corner rounded off in steps.
  const canopy = (x0: number, x1: number, z0: number, z1: number): void => {
    mb.kind = KIND.plain;
    mb.color = lin(0xd8d0c0);
    mb.box((x0 + x1) / 2, (z0 + z1) / 2, CANOPY.y0, CANOPY.y1, x1 - x0, z1 - z0);
    mb.kind = KIND.emit;
    mb.style = [EMIT.lit, 0, 0, 0];
    mb.color = [1.0, 0.86, 0.6];
    mb.box((x0 + x1) / 2, (z0 + z1) / 2, CANOPY.y0 - 0.02, CANOPY.y0, x1 - x0 - 0.1, z1 - z0 - 0.1, KIND.emit, true);
    mb.style = [0, 0, 0, 0];
  };
  canopy(-HALF - CANOPY.out, 6, HALF, HALF + CANOPY.out);
  canopy(-HALF - CANOPY.out, -HALF, -6, HALF);
  // Bulbs: two rows along the canopies' outer edges.
  mb.kind = KIND.emit;
  mb.style = [EMIT.neon, 0, 0, 0];
  mb.color = [1.8, 1.5, 0.9];
  const edge = HALF + CANOPY.out + 0.02;
  for (const y of [CANOPY.y0 + 0.15, CANOPY.y1 - 0.15]) {
    for (let x = -HALF - CANOPY.out + 0.2; x < 6; x += 0.45) mb.box(x, edge, y - 0.05, y + 0.05, 0.1, 0.04, KIND.emit, true);
    for (let z = -6 + 0.2; z < HALF + CANOPY.out; z += 0.45) mb.box(-edge, z, y - 0.05, y + 0.05, 0.04, 0.1, KIND.emit, true);
  }
  mb.style = [0, 0, 0, 0];

  // The entrance under the marquee: glass doors in steel frames, the ticket window lit, poster frames either side.
  mb.kind = KIND.glass;
  mb.color = lin(0x0c0e10);
  mb.box(-3, HALF + 0.03, 0.6, 3.3, 9, 0.06);
  mb.kind = KIND.plain;
  mb.color = lin(0x2a2a2c);
  for (let x = -7.5; x <= 1.5; x += 1.5) mb.box(x, HALF + 0.08, 0.6, 3.3, 0.08, 0.1);
  mb.box(-3, HALF + 0.08, 3.25, 3.4, 9.1, 0.12);
  mb.kind = KIND.emit;
  mb.style = [EMIT.interior, 0, 0, 0];
  mb.color = lin(0xe8d0a0);
  mb.box(-HALF - 0.04, 6.5, 1.0, 2.0, 0.06, 1.6, KIND.emit, true);
  mb.style = [EMIT.lit, 0, 0, 0];
  const posters = [0xc8302a, 0xe8c040, 0x2a4a8a, 0xd06a2a];
  posters.forEach((c, i) => {
    mb.color = lin(c);
    mb.box(3.5 + i * 1.4, HALF + 0.05, 1.0, 2.8, 1.1, 0.06, KIND.emit, true);
  });
  posters.forEach((_c, i) => {
    mb.color = lin(posters[(i + 2) % 4]);
    mb.box(-HALF - 0.05, -5 + i * 1.4, 1.0, 2.8, 0.06, 1.1, KIND.emit, true);
  });
  mb.style = [0, 0, 0, 0];

  // The corner's neon: a blade on the diagonal, from over the canopy to the parapet.
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 9.5), canvasMaterial(neonCanvas(), 1.4));
  neon.position.set(-HALF - 0.9, CANOPY.y1 + 0.6 + 9.5 / 2, HALF + 0.9);
  neon.rotation.y = -Math.PI / 4;
  const neonBack = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 9.5), canvasMaterial(neonCanvas(), 1.4));
  neonBack.position.copy(neon.position);
  neonBack.rotation.y = (3 * Math.PI) / 4;
  mb.kind = KIND.plain;
  mb.color = lin(STEEL);
  mb.beam([-HALF - 0.2, CANOPY.y1 + 1.2, HALF + 0.2], [-HALF - 0.75, CANOPY.y1 + 1.2, HALF + 0.75], 0.08);
  mb.beam([-HALF - 0.2, CANOPY.y1 + 9.5, HALF + 0.2], [-HALF - 0.75, CANOPY.y1 + 9.5, HALF + 0.75], 0.08);

  const body = new THREE.Mesh(mb.build()!, city);
  body.castShadow = body.receiveShadow = true;
  group.add(body, ...boards, neon, neonBack);
  return { group, headAt: new THREE.Vector3(-HALF, HEIGHT, HALF) };
}
