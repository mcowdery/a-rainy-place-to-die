// The street audit: measures what the siting rules made of the city, for looking over after a change to the bus
// lines, the roads or the rules (district/stops.ts, district/sites.ts; docs/street-furniture-plan.md). Not a test:
// it asserts nothing and `npm test` doesn't run it.
//   npm run audit:streets
// It writes text files into debug-shots/street-audit/ (git-ignored):
//   stops.txt      every bus stop: its kind, road, pavement, what is behind it, the next stop's distance
//   maps.txt       each stop drawn as a map, 1 m a character (legend in the code below)
//   kerb.txt       how far the bus's lane is from the kerb at each stop (before it eases over)
//   lines.txt      each line block by block: road widths, slip lanes
//   survey.txt     each line block by block: the zone, the set pieces near, the kind of stop a block would get
//   anchors.txt    each stop's nearest stations and landmarks
//   frontages.txt  per district: buildings, trades, and the clear depth in front of each street face
//   problems.txt   what a line asked for and couldn't have
import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { loadDistrictContent } from '../../src/poc3d/district/content';
import { CELL, DISTRICTS3, frontSpan, junctionSpans, type Building3, type Road3 } from '../../src/poc3d/district/plan';
import { along, routeFor } from '../../src/poc3d/district/traffic';
import { District } from '../../src/poc3d/district/world';
import { railReserved } from '../../src/poc3d/district/rail';
import { expresswayCoveredFrom, expresswayReservedFrom } from '../../src/poc3d/district/expressway';
import { frontFrame, styleFor } from '../../src/poc3d/real/buildings';
import { TRADE_NAMES } from '../../src/poc3d/real/shops';

const SEED = 0x0c179090;
mkdirSync('debug-shots/street-audit', { recursive: true });
const LOG: string[] = [];
const flush = (name: string): void => { writeFileSync('debug-shots/street-audit/' + name, LOG.join(String.fromCharCode(10))); LOG.length = 0; };
const content = loadDistrictContent();
const d = new District(content.macro, DISTRICTS3, content.placed, SEED, content.zones, content.avenues, content.bridges, content.terrain,
  [...railReserved(content.rails), ...expresswayReservedFrom('expressway.yaml', content.expresswayText)], expresswayCoveredFrom('expressway.yaml', content.expresswayText), content.traffic.buses);
const plan = (mx: number, my: number) => d.plan(mx, my);
const near = <T,>(x: number, z: number, f: (mx: number, my: number) => readonly T[]): T[] => {
  const out: T[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push(...f(Math.floor(x / CELL) + dx, Math.floor(z / CELL) + dy));
  return out;
};
const roadsAt = (x: number, z: number): Road3[] => near(x, z, (mx, my) => plan(mx, my)?.roads ?? []).filter((r) => { const q = r.rect; return x >= q.x && x <= q.x + q.w && z >= q.y && z <= q.y + q.h; });
const buildingAt = (x: number, z: number, m = 0): Building3 | undefined => near(x, z, (mx, my) => d.model.buildings(mx, my)).find((b) => Math.abs(x - b.x) < b.w / 2 + m && Math.abs(z - b.z) < b.d / 2 + m);
const openAt = (x: number, z: number): string | undefined => near(x, z, (mx, my) => plan(mx, my)?.open ?? []).find((o) => x > o.rect.x && x < o.rect.x + o.rect.w && z > o.rect.y && z < o.rect.y + o.rect.h)?.kind;
const stampAt = (x: number, z: number, m = 0): string | undefined => content.placed.find((q) => x > q.rect.x - m && x < q.rect.x + q.rect.w + m && z > q.rect.y - m && z < q.rect.y + q.rect.h + m)?.id;
const NORMAL = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] } as const;
const r1 = (n: number): number => Math.round(n * 10) / 10;

it('audits the bus stops', () => {
  const rows: Record<string, unknown>[] = [];
  for (const line of content.traffic.buses) {
    const route = routeFor(line.rect, false, plan, content.rails.flatMap((l) => l.segments), d.model.busStops(line.id));
    const mids = route.stops.map((e) => e.s).sort((a, b) => a - b);
    for (const e of route.stops) {
      const p = along(route, e.s);
      const kl = Math.hypot(e.kerb[0], e.kerb[1]) || 1;
      const o = [e.kerb[0] / kl, e.kerb[1] / kl];
      const cx = p.x + e.kerb[0];
      const cz = p.z + e.kerb[1];
      const vertical = e.dir[0] === 0;
      const at = (t: number, out: number): [number, number] => [cx + e.dir[0] * t + o[0] * out, cz + e.dir[1] * t + o[1] * out];
      // The road it stands on (the one running the bus's way under the lane point).
      const road = roadsAt(p.x, p.z).find((r) => r.vertical === vertical && r.kind !== 'coast');
      const width = road ? (vertical ? road.rect.w : road.rect.h) : 0;
      const s = road?.sidewalk ?? 0;
      // A crossing street (any road across this one) under the shelter and pole, -3 m to +4 m.
      const mouth = [-3, -2, -1, 0, 1, 2, 3, 4].filter((t) => roadsAt(...at(t, 0)).some((r) => r.vertical !== vertical && r.kind !== 'coast'));
      const mouthRoad = roadsAt(...at(0, 0)).find((r) => r.vertical !== vertical && r.kind !== 'coast');
      // What is behind the pavement along the shelter (-2..2), 0.5 m past the pavement's back edge and 4 m past it.
      const back = s / 2;
      const behind = [-2, -1, 0, 1, 2].map((t) => {
        for (const depth of [back + 0.6, back + 2.5, back + 5]) {
          const [x, z] = at(t, depth);
          const b = buildingAt(x, z);
          if (b) return b.hue !== undefined ? 'stamp' : (NORMAL[b.front][0] === -o[0] && NORMAL[b.front][1] === -o[1] ? 'front' : 'flank');
          const op = openAt(x, z);
          if (op) return `open:${op}`;
          if (stampAt(x, z)) return 'stampground';
          if (roadsAt(x, z).some((r) => r.kind !== 'coast')) return 'road';
        }
        return 'gap';
      });
      // The stop's place along its block: metres from the nearest junction box (any cross street), and from the cell's middle.
      const t0 = vertical ? cz : cx;
      const boxes = road ? junctionSpans(road, plan(Math.floor(p.x / CELL), Math.floor(p.z / CELL))?.roads ?? []) : [];
      const toBox = Math.min(...boxes.map(([a, b]) => (t0 < a ? a - t0 : t0 > b ? t0 - b : 0)), 999);
      const fromCellMid = (((t0 % CELL) + CELL) % CELL) - CELL / 2;
      // Street furniture standing in the shelter's footprint (2.3 m back to 3.3 m on, 1 m either side of the kerb point).
      const hits = d.propsNear(cx, cz, 8).filter((q) => {
        const dx = q.x - cx;
        const dz = q.z - cz;
        const a = dx * e.dir[0] + dz * e.dir[1];
        const out = dx * o[0] + dz * o[1];
        const h = q.half ?? 0;
        return a > -2.3 - h - q.radius && a < 3.3 + h + q.radius && out > -1.0 - q.radius && out < 0.9 + q.radius;
      }).map((q) => q.kind);
      const next = mids[(mids.indexOf(e.s) + 1) % mids.length];
      const gapAhead = (((next - e.s) % route.length) + route.length) % route.length;
      rows.push({
        line: line.id, side: e.side + ' ' + e.kind, name: e.name, x: Math.round(cx), z: Math.round(cz),
        cell: `${Math.floor(cx / CELL)},${Math.floor(cz / CELL)}`, kind: plan(Math.floor(cx / CELL), Math.floor(cz / CELL))?.kind ?? '-',
        roadW: r1(width), pavement: r1(s), walkLeft: r1(Math.max(0, s - 1.5)), mouth: mouth.length ? `${mouth.length}/8 pts in a ${r1(mouthRoad ? (mouthRoad.vertical ? mouthRoad.rect.w : mouthRoad.rect.h) : 0)} m street` : '',
        behind: behind.join(','), toJunction: r1(toBox), fromCellMid: r1(fromCellMid), props: hits.join(','), nextStop: Math.round(gapAhead), loop: Math.round(route.length),
      });
    }
  }
  writeFileSync('debug-shots/street-audit/stops.json', JSON.stringify(rows, null, 1));
  const pad = (v: unknown, n: number): string => String(v).padEnd(n).slice(0, n);
  LOG.push(['line', 'side', 'at', 'district', 'road', 'pave', 'left', 'toJct', 'offMid', 'next', 'behind', 'in the way'].map((h, i) => pad(h, [10, 13, 11, 12, 5, 5, 5, 6, 7, 6, 34, 30][i])).join(' '));
  for (const r of rows) LOG.push([pad(r.line, 10), pad(r.side, 13), pad(`${r.x},${r.z}`, 11), pad(r.kind, 12), pad(r.roadW, 5), pad(r.pavement, 5), pad(r.walkLeft, 5), pad(r.toJunction, 6), pad(r.fromCellMid, 7), pad(r.nextStop, 6), pad(r.behind, 34), `${r.props}${r.mouth ? ` MOUTH ${r.mouth}` : ''}`].join(' '));
  const n = rows.length;
  const count = (f: (r: Record<string, unknown>) => boolean): string => `${rows.filter(f).length}/${n}`;
  LOG.push('\nSUMMARY');
  LOG.push('stops standing across a street mouth: ' + count((r) => r.mouth !== ''));
  LOG.push('pavement under 2 m (shelter fills it): ' + count((r) => (r.pavement as number) < 2));
  LOG.push('pavement 0 (no raised pavement): ' + count((r) => r.pavement === 0));
  LOG.push('no building front behind any of the 5 points: ' + count((r) => !String(r.behind).includes('front')));
  LOG.push('behind is all gap/open/road: ' + count((r) => String(r.behind).split(',').every((b) => b === 'gap' || b === 'road' || b.startsWith('open'))));
  LOG.push('some gap/road behind the shelter: ' + count((r) => /gap|road/.test(String(r.behind))));
  LOG.push('street furniture in the shelter: ' + count((r) => r.props !== ''));
  LOG.push('more than 7 m from the cell middle (outside the window props keep clear): ' + count((r) => Math.abs(r.fromCellMid as number) > 7));
  LOG.push('next stop more than 600 m on: ' + count((r) => (r.nextStop as number) > 600));
  LOG.push('next stop under 200 m on: ' + count((r) => (r.nextStop as number) < 200));
  flush('stops.txt');
});

it('audits the frontages (room for a payphone)', () => {
  // Per district: buildings, what they are, and the clear depth in front of each street face (to the kerb).
  const by = new Map<string, { n: number; shopOpen: number; home: number; trades: Map<string, number>; depth: number[]; noPave: number; vending: number; corner: number; cells: number }>();
  let stamps = 0;
  for (const [mx, my] of d.model.cells) {
    const p = plan(mx, my)!;
    const k = p.kind;
    const g = by.get(k) ?? { n: 0, shopOpen: 0, home: 0, trades: new Map<string, number>(), depth: [] as number[], noPave: 0, vending: 0, corner: 0, cells: 0 };
    by.set(k, g);
    g.cells++;
    g.vending += d.model.detail(mx, my)!.props.filter((q) => q.kind === 'vending').length;
    stamps += d.model.stamps(mx, my).length;
    for (const b of p.buildings) {
      g.n++;
      const st = styleFor(b);
      if (st.home) g.home++;
      else if (st.shopOpen) {
        g.shopOpen++;
        const t = TRADE_NAMES[st.trade];
        g.trades.set(t, (g.trades.get(t) ?? 0) + 1);
      }
      if (b.cut) g.corner++;
      // From the middle of the clear face straight out: how far to a carriageway (a road less its pavements), up to 12 m.
      const f = frontFrame(b);
      const [s0, s1] = frontSpan(b);
      const u = (s0 + s1) / 2;
      let depth = -1;
      let paved = false;
      for (let out = 0.1; out <= 12; out += 0.1) {
        const x = f.p[0] + f.r[0] * u + f.n[0] * out;
        const z = f.p[2] + f.r[2] * u + f.n[2] * out;
        const hit = roadsAt(x, z).find((r) => {
          if (r.kind === 'coast') return false;
          const q = r.rect;
          return r.vertical ? x > q.x + r.sidewalk && x < q.x + q.w - r.sidewalk : z > q.y + r.sidewalk && z < q.y + q.h - r.sidewalk;
        });
        if (hit) {
          depth = out;
          paved = hit.sidewalk > 0;
          break;
        }
      }
      if (depth >= 0) {
        g.depth.push(depth);
        if (!paved) g.noPave++;
      }
    }
  }
  const q = (a: number[], f: number): number => (a.length ? r1([...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))]) : 0);
  LOG.push('\nFRONTAGES by district (clear depth = wall to carriageway edge in front of the face)');
  for (const [k, g] of by) {
    const top = [...g.trades].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, c]) => `${t} ${c}`).join(', ');
    const pick = (names: string[]): number => names.reduce((s, t) => s + (g.trades.get(t) ?? 0), 0);
    LOG.push(`${k}: ${g.cells} cells, ${g.n} buildings (${g.home} homes, ${g.shopOpen} open shops, ${g.corner} cut corners), ${g.vending} vending machines`);
    LOG.push(`   clear depth m: p10 ${q(g.depth, 0.1)}  p25 ${q(g.depth, 0.25)}  median ${q(g.depth, 0.5)}  p75 ${q(g.depth, 0.75)}  p90 ${q(g.depth, 0.9)};  faces on a street with no raised pavement: ${g.noPave}/${g.depth.length};  under 1.2 m: ${g.depth.filter((v) => v < 1.2).length}, 1.2-2.2: ${g.depth.filter((v) => v >= 1.2 && v < 2.2).length}, 2.2+: ${g.depth.filter((v) => v >= 2.2).length}`);
    LOG.push(`   konbini ${pick(['konbini'])}, bars/snack/izakaya/lounge/mahjong/karaoke ${pick(['bar', 'snack', 'izakaya', 'lounge', 'mahjong', 'karaoke'])}, noodles/cafe ${pick(['noodles', 'cafe'])}, pachinko/arcade ${pick(['pachinko', 'arcade'])}, hotel/lovehotel ${pick(['hotel', 'lovehotel'])}, laundry ${pick(['laundry'])}, drugstore ${pick(['drugstore'])}, bank ${pick(['bank'])}, lobby ${pick(['lobby'])};  top: ${top}`);
  }
  LOG.push(`stamps placed: ${content.placed.length} (${stamps} counted by cell); stations: ${content.placed.filter((p) => p.stamp.landmark === 'station').map((p) => p.id).join(' ')}; subway: ${content.placed.filter((p) => p.stamp.landmark === 'subway').length}`);
  flush('frontages.txt');
});

it('draws each stop as a map', () => {
  // 1 m a character, north up: = carriageway, : raised pavement, ~ a street with no pavement (shared surface), M median,
  // # building (generated), @ a set piece's building, P/y/v/z/k/Y open ground (parking, playground, vacant, plaza, park, yard),
  // blank: nothing planned there (a yard behind a row, a gap between lots, reserved ground). S shelter, i its pole, B where the bus stands.
  // Furniture: l lamp, t tree, h hedge, V vending, p pots, b bike, c parked car, s signal, o utility pole.
  const OPEN: Record<string, string> = { parking: 'P', playground: 'y', vacant: 'v', plaza: 'z', park: 'k', yard: 'Y', court: 'C' };
  const PROP: Record<string, string> = { lamp: 'l', tree: 't', hedge: 'h', vending: 'V', pots: 'p', bike: 'b', car: 'c', signal: 's', pole: 'o', bench: 'n', fence: 'f' };
  const W = 72;
  const H = 44;
  for (const line of content.traffic.buses) {
    const route = routeFor(line.rect, false, plan, content.rails.flatMap((l) => l.segments), d.model.busStops(line.id));
    for (const e of route.stops) {
      const p = along(route, e.s);
      const kl = Math.hypot(e.kerb[0], e.kerb[1]) || 1;
      const o = [e.kerb[0] / kl, e.kerb[1] / kl];
      const cx = p.x + e.kerb[0];
      const cz = p.z + e.kerb[1];
      const x0 = Math.round(cx) - W / 2;
      const z0 = Math.round(cz) - H / 2;
      const grid: string[][] = [];
      for (let j = 0; j < H; j++) {
        const row: string[] = [];
        for (let i = 0; i < W; i++) {
          const x = x0 + i + 0.5;
          const z = z0 + j + 0.5;
          let ch = ' ';
          const b = buildingAt(x, z);
          const op = openAt(x, z);
          if (op) ch = OPEN[op] ?? '?';
          if (b) ch = b.hue !== undefined ? '@' : '#';
          for (const r of roadsAt(x, z)) {
            if (r.kind === 'coast') { ch = r.water ? 'w' : ','; continue; }
            const q = r.rect;
            const s = r.sidewalk;
            const inCarriage = r.vertical ? x > q.x + s && x < q.x + q.w - s : z > q.y + s && z < q.y + q.h - s;
            const c = s === 0 ? '~' : inCarriage ? '=' : ':';
            // A carriageway wins over another road's pavement.
            if (ch !== '=' && ch !== '~') ch = c;
            if (c === '=' || c === '~') ch = c;
          }
          if (near(x, z, (mx, my) => plan(mx, my)?.medians ?? []).some((m) => x > m.x && x < m.x + m.w && z > m.y && z < m.y + m.h)) ch = 'M';
          row.push(ch);
        }
        grid.push(row);
      }
      const put = (x: number, z: number, ch: string): void => {
        const i = Math.floor(x - x0);
        const j = Math.floor(z - z0);
        if (i >= 0 && i < W && j >= 0 && j < H) grid[j][i] = ch;
      };
      for (const q of d.propsNear(cx, cz, 50)) {
        const ch = PROP[q.kind];
        if (!ch) continue;
        const h = q.half ?? 0;
        for (let a = -h; a <= h + 0.01; a += 0.9) put(q.x + q.nz * a, q.z - q.nx * a, ch);
      }
      for (let a = -5; a <= 5; a += 1) put(p.x + e.dir[0] * a, p.z + e.dir[1] * a, 'B');
      for (let a = -2; a <= 2; a += 1) if (e.kind === 'shelter') put(cx + e.dir[0] * a + o[0] * (0.95 - e.pavement / 2), cz + e.dir[1] * a + o[1] * (0.95 - e.pavement / 2), 'S'); if (e.kind === 'bench') put(cx + o[0] * (e.depth - e.pavement / 2 - 0.4), cz + o[1] * (e.depth - e.pavement / 2 - 0.4), 'N');
      put(cx + e.dir[0] * 3 + o[0] * (0.45 - e.pavement / 2), cz + e.dir[1] * 3 + o[1] * (0.45 - e.pavement / 2), 'i');
      LOG.push(`\n=== ${line.id} ${e.side} ${e.kind} "${e.name}" at ${Math.round(cx)},${Math.round(cz)} (${plan(Math.floor(cx / CELL), Math.floor(cz / CELL))?.kind}); window x ${x0}..${x0 + W}, z ${z0}..${z0 + H}`);
      for (const row of grid) LOG.push(row.join(''));
    }
  }
  flush('maps.txt');
});

it('lists each bus line block by block', () => {
  for (const line of content.traffic.buses) {
    const [c0, r0, c1, r1] = line.rect;
    const blocks: { where: string; w: number; s: number; slip: number; med: number }[] = [];
    const roadOn = (vertical: boolean, lineAt: number, cellX: number, cellY: number): Road3 | undefined =>
      [plan(cellX, cellY), plan(vertical ? cellX - 1 : cellX, vertical ? cellY : cellY - 1)].flatMap((p) => p?.roads ?? []).find((r) => r.vertical === vertical && r.kind !== 'coast' && (vertical ? r.rect.x < lineAt && r.rect.x + r.rect.w > lineAt : r.rect.y < lineAt && r.rect.y + r.rect.h > lineAt));
    const add = (vertical: boolean, gridLine: number, k: number, side: string): void => {
      const r = vertical ? roadOn(true, gridLine * CELL, gridLine, k) : roadOn(false, gridLine * CELL, k, gridLine);
      blocks.push({ where: `${side} ${vertical ? `col ${gridLine} row ${k}` : `row ${gridLine} col ${k}`}`, w: r ? (vertical ? r.rect.w : r.rect.h) : 0, s: r?.sidewalk ?? 0, slip: r?.slip ?? 0, med: r?.median ?? 0 });
    };
    for (let c = c0; c < c1; c++) add(false, r0, c, 'north');
    for (let r = r0; r < r1; r++) add(true, c1, r, 'east');
    for (let c = c0; c < c1; c++) add(false, r1, c, 'south');
    for (let r = r0; r < r1; r++) add(true, c0, r, 'west');
    const n = blocks.length;
    const narrow = blocks.filter((b) => b.w < 12);
    LOG.push(`${line.id} (${line.en}): ${n} blocks, ${(n * CELL / 1000).toFixed(2)} km; widths ${[...new Set(blocks.map((b) => b.w))].sort((a, b) => a - b).join('/')} m; stops now 4, at one every 3 blocks ${Math.round(n / 3)}, every 2 blocks ${Math.round(n / 2)}`);
    LOG.push(`   under 12 m (${narrow.length}): ${narrow.map((b) => `${b.where} ${b.w} m/${Math.round(b.s * 10) / 10} m pavement`).join('; ') || 'none'}`);
    LOG.push(`   with a slip lane (${blocks.filter((b) => b.slip).length}): ${blocks.filter((b) => b.slip).map((b) => b.where).join('; ') || 'none'}`);
  }
  flush('lines.txt');
});

it('measures each stop to the nearest named set pieces', () => {
  for (const line of content.traffic.buses) {
    const route = routeFor(line.rect, false, plan, content.rails.flatMap((l) => l.segments), d.model.busStops(line.id));
    for (const e of route.stops) {
      const p = along(route, e.s);
      const cx = p.x + e.kerb[0];
      const cz = p.z + e.kerb[1];
      const nearest = content.placed
        .filter((q) => ['station', 'subway', 'dome', 'fish_market', 'tv_tower', 'rotary', 'hospital', 'ferry_terminal', 'university', 'school', 'dept_store', 'koban', 'konbini', 'temple', 'shrine'].includes(q.stamp.landmark ?? ''))
        .map((q) => ({ id: q.id, lm: q.stamp.landmark, d: Math.round(Math.hypot(Math.max(q.rect.x - cx, 0, cx - q.rect.x - q.rect.w), Math.max(q.rect.y - cz, 0, cz - q.rect.y - q.rect.h))) }))
        .sort((a, b) => a.d - b.d).slice(0, 3);
      LOG.push(`${line.id} ${e.side} ${e.name}: ${nearest.map((n) => `${n.id} (${n.lm}) ${n.d} m`).join(', ')}`);
    }
  }
  flush('anchors.txt');
});

it('measures the bus to the kerb at each stop', () => {
  for (const line of content.traffic.buses) {
    const route = routeFor(line.rect, false, plan, content.rails.flatMap((l) => l.segments), d.model.busStops(line.id));
    for (const e of route.stops) {
      const p = along(route, e.s);
      const vertical = e.dir[0] === 0;
      const road = roadsAt(p.x, p.z).find((r) => r.vertical === vertical && r.kind !== 'coast');
      const s = road?.sidewalk ?? 0;
      const toKerbEdge = Math.hypot(e.kerb[0], e.kerb[1]) - s / 2;
      LOG.push(`${line.id} ${e.side} ${e.name}: lane centre to kerb ${toKerbEdge.toFixed(1)} m, bus side to kerb ${(toKerbEdge - 1.25).toFixed(1)} m`);
    }
  }
  flush('kerb.txt');
});

it('lists what the lines asked for and could not have', () => {
  LOG.push(...d.model.stopProblems(), `(${d.model.stopProblems().length} problems)`);
  flush('problems.txt');
});

it('surveys each line block by block, for writing its stops', async () => {
  const { lineStops } = await import('../../src/poc3d/district/stops');
  const env = { plan, buildings: (mx: number, my: number) => d.model.buildings(mx, my), placed: content.placed };
  for (const line of content.traffic.buses) {
    const [c0, r0, c1, r1] = line.rect;
    LOG.push(`\n## ${line.id} ${line.name} [${line.rect.join(', ')}] now: ${line.stops.join(' / ')}`);
    // Anticlockwise: west side going south, south going east, east going north, north going west (the kerb is the loop's inside).
    const blocks: { side: string; cell: [number, number] }[] = [];
    for (let r = r0; r < r1; r++) blocks.push({ side: 'west', cell: [c0, r] });
    for (let c = c0; c < c1; c++) blocks.push({ side: 'south', cell: [c, r1 - 1] });
    for (let r = r1 - 1; r >= r0; r--) blocks.push({ side: 'east', cell: [c1 - 1, r] });
    for (let c = c1 - 1; c >= c0; c--) blocks.push({ side: 'north', cell: [c, r0] });
    blocks.forEach((b, i) => {
      const one = lineStops({ ...line, serves: [{ name: 'x', cell: b.cell, side: b.side as never }] }, env);
      const s = one.sites[0];
      const zone = content.zones.at(b.cell[0], b.cell[1]);
      const near = content.placed
        .map((q) => ({ id: q.id, lm: q.stamp.landmark, dx: Math.abs(q.rect.x + q.rect.w / 2 - (b.cell[0] + 0.5) * CELL), dz: Math.abs(q.rect.y + q.rect.h / 2 - (b.cell[1] + 0.5) * CELL) }))
        .filter((q) => q.dx < CELL * 0.9 && q.dz < CELL * 0.9).map((q) => `${q.id}${q.lm ? `(${q.lm})` : ''}`).join(' ');
      const moved = s && (Math.floor(s.x / CELL) !== b.cell[0] || Math.floor(s.z / CELL) !== b.cell[1]) ? ' MOVED' : '';
      LOG.push(`${String(i).padStart(2)} ${b.side.padEnd(5)} [${b.cell.join(',')}] ${(plan(b.cell[0], b.cell[1])?.kind ?? '-').padEnd(11)} ${(zone?.name ?? '').padEnd(34).slice(0, 34)} ${s ? `${s.kind.padEnd(7)} depth ${s.depth.toFixed(1)}${moved}` : 'NO SPOT        '} | ${near}`);
    });
  }
  flush('survey.txt');
});

it('checks every traffic lane with the city own seed', async () => {
  const { carLoops } = await import('../../src/poc3d/district/traffic');
  const piers = content.rails.flatMap((l) => l.segments);
  const loops = [...carLoops(content.macro, content.traffic, plan).map((c) => ({ id: `cars ${c.rect.join(',')}`, rect: c.rect, cw: true, sites: [] as never[] })), ...content.traffic.buses.map((b) => ({ id: `bus ${b.id}`, rect: b.rect, cw: false, sites: d.model.busStops(b.id) as never[] }))];
  let blocked = 0;
  let metres = 0;
  let far = 0;
  let worst = 0;
  for (const l of loops) {
    const route = routeFor(l.rect, l.cw, plan, piers, l.sites);
    let prev = along(route, 0);
    for (let s = 2; s < route.length; s += 2) {
      const p = along(route, s);
      metres += 2;
      if (d.blocked(p.x, p.z, 0.8)) {
        blocked++;
        if (blocked <= 12) LOG.push(`BLOCKED ${l.id} at s ${s}: ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
      }
      // How far the lane is from the kerb on its left: the road under it, its carriageway's edge on that side.
      const vertical = Math.abs(p.dz) > Math.abs(p.dx);
      const road = roadsAt(p.x, p.z).filter((r) => r.vertical === vertical && r.kind !== 'coast').sort((a, b) => (b.vertical ? b.rect.w : b.rect.h) - (a.vertical ? a.rect.w : a.rect.h))[0];
      const turning = Math.abs(p.k) > 0 || Math.abs(prev.k) > 0;
      if (road && !turning) {
        const q = road.rect;
        const lx = p.dz;
        const lz = -p.dx;
        const edge = vertical ? (lx > 0 ? q.x + q.w - road.sidewalk - (road.slip ?? 0) / 2 - p.x : p.x - q.x - road.sidewalk - (road.slip ?? 0) / 2) : lz > 0 ? q.y + q.h - road.sidewalk - (road.slip ?? 0) / 2 - p.z : p.z - q.y - road.sidewalk - (road.slip ?? 0) / 2;
        if (edge > 4.6) far += 2;
        worst = Math.max(worst, edge);
      }
      prev = p;
    }
  }
  LOG.push(`${loops.length} loops, ${(metres / 1000).toFixed(1)} km of lane; blocked samples: ${blocked}; lane more than 4.6 m from its kerb (clear of turns): ${(far / 1000).toFixed(2)} km; furthest ${worst.toFixed(1)} m`);
  flush('lanes.txt');
});

it('counts the payphones', () => {
  const NAMES = ['hood', 'booth', 'red', 'pink'];
  const by = new Map<string, number[]>();
  const all: { x: number; z: number; v: number; kind: string }[] = [];
  let bad = 0;
  for (const [mx, my] of d.model.cells) {
    const k = plan(mx, my)!.kind;
    const row = by.get(k) ?? [0, 0, 0, 0, 0];
    by.set(k, row);
    row[4]++;
    for (const p of d.model.phones(mx, my)?.props ?? []) {
      row[p.variant]++;
      all.push({ x: p.x, z: p.z, v: p.variant, kind: k });
      // On a carriageway with pavements, or inside a building: wrong.
      const inRoad = roadsAt(p.x, p.z).some((r) => r.kind !== 'coast' && r.sidewalk > 0 && (r.vertical ? p.x > r.rect.x + r.sidewalk && p.x < r.rect.x + r.rect.w - r.sidewalk : p.z > r.rect.y + r.sidewalk && p.z < r.rect.y + r.rect.h - r.sidewalk));
      if (inRoad || buildingAt(p.x, p.z)) {
        bad++;
        if (bad <= 10) LOG.push(`BAD ${NAMES[p.variant]} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} (${inRoad ? 'in a carriageway' : 'in a building'})`);
      }
    }
  }
  LOG.push('district     cells  hood booth   red  pink  total  per cell');
  let total = 0;
  for (const [k, r] of by) {
    const n = r[0] + r[1] + r[2] + r[3];
    total += n;
    LOG.push(`${k.padEnd(12)} ${String(r[4]).padStart(5)} ${r.slice(0, 4).map((v) => String(v).padStart(5)).join(' ')} ${String(n).padStart(6)}  ${(n / r[4]).toFixed(2)}`);
  }
  // The nearest other phone to each: how spread they are.
  const nearest = all.map((a) => Math.min(...all.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.z - b.z)))).sort((p, q) => p - q);
  LOG.push(`total ${total}; wrongly placed ${bad}; nearest other phone: least ${nearest[0]?.toFixed(0)} m, median ${nearest[nearest.length >> 1]?.toFixed(0)} m, most ${nearest[nearest.length - 1]?.toFixed(0)} m; under 10 m apart: ${nearest.filter((v) => v < 10).length}`);
  // The set pieces' own.
  for (const q of content.placed) {
    const near = all.filter((a) => Math.hypot(Math.max(q.rect.x - a.x, 0, a.x - q.rect.x - q.rect.w), Math.max(q.rect.y - a.z, 0, a.z - q.rect.y - q.rect.h)) < 2.5);
    if (near.length) LOG.push(`  ${q.id} (${q.stamp.landmark}): ${near.map((a) => NAMES[a.v]).join(', ')}`);
  }
  flush('phones.txt');
});
