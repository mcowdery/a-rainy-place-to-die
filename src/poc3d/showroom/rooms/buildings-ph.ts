import * as THREE from 'three';
import { KIND, lin, MeshBuilder } from '../../real/meshBuilder';
import { hash, rng } from '../../../core/hash';
import { addBuilding, styleFor } from '../../real/buildings';
import { addProps, type Prop } from '../../real/props';
import { setTreeSet } from '../../district/cityConfig';
import { DECK_Y, STAIR_LEN } from '../../district/footbridges';
import type { Building3, Zone3 } from '../../district/plan';
import type { C3 } from '../../real/interiorDraw';
import { startRoom } from '../shell';

/**
 * Buildings and street of Manila (models-buildings-ph.html), built with the district's own builders (real/buildings.ts,
 * real/manilaBuilding.ts, real/manilaStreet.ts, real/props.ts) with Manila's state on (`setTreeSet('manila')`):
 * a row of houses (the hollow-block house with its unfinished top, then the corrugated-iron roofs in gable, shed and hip,
 * then two informal-settlement shacks), a wall with the street's clutter against it (sari-sari kiosk, push carts,
 * Santo Nino shrine, garbage, jeepney stop, tricycle terminal sign, parols, a tarpaulin, the barangay hall's porch), two
 * poles with their tangle of wires, a footbridge over an avenue and a basketball court with its hoops.
 */
const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const FRONT = V(0.15, 0.3, 1).normalize();

/** A zone's look, as Manila's zone files give it: only the keys the house styles read (real/buildings.ts `styleFor`). */
const zone = (look: Record<string, unknown>): Zone3 =>
  ({ key: 'x', id: 'showroom', name: 'showroom', style: {}, area: null, ads: {}, look: { windows: null, walls: null, tiled: false, shops: null, open: null, homes: 1, vice: 0, roofs: 0, bikes: 0, block: 0, arch: 0, informal: 0, church: 0, street: 1, ...look } }) as unknown as Zone3;

startRoom({
  title: 'Buildings and street (Manila)',
  groups: ['Houses', 'Street', 'Footbridge', 'Court'],
  summer: true,
  camera: { pos: [27, 9, 42], target: [27, 3, 6] },
  shadow: { x: 30, z: 6, half: 60 },
  overview: { at: [27, 3, 8], size: 50, view: [0.1, 0.4, 1] },
  setup(ctx) {
    // Manila's state (as the district page sets it for ?city=manila): the Filipino looks of the builders and its poles.
    setTreeSet('manila');
    ctx.cityU.uFil.value = 1;
    const { genRoot, genItems, label, city } = ctx;
    ctx.floor((floor) => {
      floor.kind = KIND.lot;
      floor.color = lin(0x5e5e5c);
      floor.box(50, -10, -0.3, -0.05, 170, 130, KIND.lot);
    });

    // ---- The houses (row z = 0, facing +z) ----
    const mb = new MeshBuilder(1 << 17);
    const find = (base: number, ok: (id: number) => boolean): number => {
      for (let id = base; ; id++) if (ok(id)) return id;
    };
    const roll = (id: number): number => rng(hash(id, 0x600f)).float();
    const houses: { b: Building3; name: string; size: number }[] = [];
    const house = (id: number, x: number, w: number, d: number, h: number, look: Record<string, unknown>, name: string): void => {
      houses.push({ b: { id, x, z: 0, w, d, h, front: 'south', zone: zone(look) }, name, size: Math.max(w, h) * 1.1 });
    };
    // (Styles are cached by building id: each category has its own range of ids and one size.)
    house(find(110000, (id) => id > 0), 0, 7, 8, 7.5, { block: 1, roofs: 0 }, 'hollow-block house (unfinished top)');
    const roofOf = (id: number, lo: number, hi: number): boolean => roll(id) >= lo && roll(id) < hi;
    house(find(120000, (id) => roofOf(id, 0, 0.45)), 10, 8, 7, 6, { roofs: 1 }, 'corrugated roof: gable');
    house(find(130000, (id) => roofOf(id, 0.45, 0.8)), 20, 8, 7, 6, { roofs: 1 }, 'corrugated roof: shed (mono-pitch)');
    house(find(140000, (id) => roofOf(id, 0.8, 1)), 30, 8, 7, 6, { roofs: 1 }, 'corrugated roof: hip');
    house(find(150000, (id) => id > 0), 40, 4, 5, 4.5, { informal: 1 }, 'shanty (patchwork walls, scrap roof)');
    house(find(150100, (id) => id > 0), 46, 3.5, 5, 6, { informal: 1 }, 'shanty (two storeys)');
    houses.forEach(({ b, name, size }, i) => {
      void styleFor(b);
      addBuilding(mb, b, true);
      label('new', name, b.x, b.h + 1.6 + (i % 2) * 1.0, b.z);
      genItems.new.push({ name, group: 'Houses', at: V(b.x, b.h * 0.5, b.z), size, view: FRONT });
    });
    genItems.new.push(
      { name: 'unfinished top (rebar, tyres)', group: 'Houses', at: V(0, 7.5, 0), size: 9, view: V(0.2, 0.6, 1).normalize() },
      { name: 'the roofs, from above', group: 'Houses', at: V(25, 6, 0), size: 36, view: V(0, 1.3, 0.6).normalize() },
      { name: 'all the houses', group: 'Houses', at: V(24, 3.5, 0), size: 50, view: FRONT },
    );
    const houseMesh = new THREE.Mesh(mb.build()!, city);
    houseMesh.castShadow = houseMesh.receiveShadow = true;
    genRoot.new.add(houseMesh);

    // ---- The street's clutter, against a blank wall (row z = 22, facing +z) ----
    {
      const WZ = 22;
      const wall = new MeshBuilder();
      wall.kind = KIND.plain;
      wall.color = lin(0xb4b4ac);
      wall.box(33, WZ - 0.2, 0, 3.4, 70, 0.4, KIND.plain);
      wall.kind = KIND.sidewalk;
      wall.color = lin(0x8a867e);
      wall.box(33, WZ + 2.5, -0.1, 0.15, 70, 5.5, KIND.sidewalk);
      const wallMesh = new THREE.Mesh(wall.build()!, city);
      wallMesh.castShadow = wallMesh.receiveShadow = true;
      genRoot.new.add(wallMesh);
      const P = (kind: Prop['kind'], x: number, extra: Partial<Prop> = {}): Prop => ({ kind, x, z: WZ, nx: 0, nz: 1, radius: 0.3, variant: 0, ...extra });
      const sample: [string, string, Prop, number][] = [
        ['sari-sari kiosk', 'Street', P('sarisari', 4, { half: 1.0, radius: 0.5, variant: 1 }), 4],
        ['sari-sari kiosk (another paint)', 'Street', P('sarisari', 9, { half: 1.0, radius: 0.5, variant: 4 }), 4],
        ['push cart: fruit', 'Street', P('cart', 15, { half: 0.8, variant: 0 }), 3.4],
        ['push cart: barbecue grill', 'Street', P('cart', 18.5, { half: 0.8, variant: 1 }), 3.4],
        ['push cart: fishball wok', 'Street', P('cart', 22, { half: 0.8, variant: 2 }), 3.4],
        ['Santo Nino shrine', 'Street', P('shrine', 26, { solid: false }), 2.4],
        ['garbage pile', 'Street', P('garbage', 29.5, { solid: false, size: 1.1 }), 3.4],
        ['jeepney stop', 'Street', P('jeepstop', 33, { half: 0.9, variant: 0 }), 3.4],
        ['tricycle terminal sign', 'Street', P('jeepstop', 37, { half: 0.9, variant: 1 }), 3.4],
        ['parol (star lantern)', 'Street', P('parol', 41, { solid: false, arm: 3.0, variant: 0, size: 0.8 }), 2.4],
        ['parol (another)', 'Street', P('parol', 43.5, { solid: false, arm: 3.0, variant: 3, size: 0.8 }), 2.4],
        ['tarpaulin banner', 'Street', P('tarp', 49, { half: 2.2, solid: false, arm: 1.2, variant: 1234 }), 4.2],
        ['barangay hall porch', 'Street', P('barangay', 58, { half: 2.7, radius: 0.5 }), 8],
      ];
      const props = new MeshBuilder(1 << 16);
      addProps(props, { props: sample.map(([, , p]) => p), wires: [], lights: [], open: [], solids: [] });
      sample.forEach(([name, group, p, size], i) => {
        label('new', name, p.x, (name === 'barangay hall porch' ? 7.3 : name.startsWith('parol') ? 4.2 : 3.4) + (i % 3) * 0.55, p.z + 0.5);
        genItems.new.push({ name, group, at: V(p.x, name === 'barangay hall porch' ? 2.5 : 1.4, p.z + 0.8), size: Math.min(size, 7), view: V(0.15, 0.3, 1).normalize() });
      });
      // Two poles 20 m apart in front of them with the tangle of wires Manila's poles carry (props.ts `poleRun`).
      const poles: Prop[] = [10, 30].map((x, i) => ({ kind: 'pole', x, z: WZ + 4.5, nx: 0, nz: 1, radius: 0.25, variant: [7, 4][i] }));
      const wires: C3[][] = [];
      const wr = rng(hash(10, 30, 0x71a9));
      const lines: [number, number, number][] = [[-0.9, 8.9, 0], [-0.45, 8.9, 0], [0, 8.9, 0], [0.45, 8.9, 0], [0.9, 8.9, 0], [-0.6, 7.5, 0.1], [0, 7.5, 0.1], [0.6, 7.5, 0.1]];
      for (let k = 0; k < 5; k++) lines.push([(wr.float() - 0.5) * 2.0, 5.4 + wr.float() * 3.2, 0.5 + wr.float() * 1.0]);
      for (const [off, y, slack] of lines) {
        const a: C3 = [poles[0].x, y + (slack > 0 ? (wr.float() - 0.5) * 0.4 : 0), poles[0].z + off];
        const b: C3 = [poles[1].x, y + (slack > 0 ? (wr.float() - 0.5) * 0.4 : 0), poles[1].z + off];
        const sag = 0.35 + Math.hypot(b[0] - a[0], b[2] - a[2]) * 0.012 + slack;
        const line: C3[] = [];
        for (let k = 0; k <= 3; k++) {
          const f = k / 3;
          line.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f - sag * 4 * f * (1 - f), a[2] + (b[2] - a[2]) * f]);
        }
        wires.push(line);
      }
      addProps(props, { props: poles, wires, lights: [], open: [], solids: [] });
      label('new', 'pole with its tangle of wires', 20, 10.5, WZ + 4.5);
      genItems.new.push({ name: 'pole with tangled wires', group: 'Street', at: V(20, 7, WZ + 4.5), size: 22, view: V(0.1, 0.2, 1).normalize() });
      genItems.new.push({ name: 'the street (all)', group: 'Street', at: V(32, 2, WZ + 1), size: 40, view: V(0.05, 0.3, 1).normalize() });
      const propMesh = new THREE.Mesh(props.build()!, city);
      propMesh.castShadow = propMesh.receiveShadow = true;
      genRoot.new.add(propMesh);
    }

    // ---- The footbridge (over an avenue running along x, at z = -45) ----
    {
      const FX = 30;
      const FZ = -45;
      const HALF = 12;
      const road = new MeshBuilder();
      road.kind = KIND.asphalt;
      road.color = lin(0x44464a);
      road.box(FX, FZ, 0, 0.02, 44, HALF * 2 - 6, KIND.asphalt);
      road.kind = KIND.sidewalk;
      road.color = lin(0x9a968c);
      for (const s of [-1, 1]) road.box(FX, FZ + s * (HALF - 1.5), 0, 0.15, 44, 3, KIND.sidewalk);
      genRoot.new.add(new THREE.Mesh(road.build()!, city));
      const bridge = new MeshBuilder(1 << 16);
      addProps(bridge, { props: [{ kind: 'footbridge', x: FX, z: FZ, nx: 0, nz: 1, radius: 0, variant: 3, half: HALF, size: 2, solid: false }], wires: [], lights: [], open: [], solids: [] });
      const bm = new THREE.Mesh(bridge.build()!, city);
      bm.castShadow = bm.receiveShadow = true;
      genRoot.new.add(bm);
      label('new', 'footbridge (covered deck, 34-step stairs both ways)', FX, DECK_Y + 4, FZ);
      genItems.new.push(
        { name: 'footbridge', group: 'Footbridge', at: V(FX, 3, FZ), size: 40, view: V(0.2, 0.35, 1).normalize() },
        { name: 'the deck (inside the roof)', group: 'Footbridge', at: V(FX, DECK_Y + 1.2, FZ + 4), size: 5, view: V(0.4, 0.1, 0.9).normalize() },
        { name: 'the stairs', group: 'Footbridge', at: V(FX + STAIR_LEN * 0.6, 3, FZ + HALF - 1.5), size: 14, view: V(0.7, 0.3, 1).normalize() },
        { name: 'from above', group: 'Footbridge', at: V(FX, 3, FZ), size: 36, view: V(0.1, 1.4, 0.7).normalize() },
      );
    }

    // ---- The basketball court (open lot, hoops at each end) ----
    {
      const CX = 85;
      const CZ = -45;
      const W = 28;
      const D = 15;
      const court = new MeshBuilder();
      court.kind = KIND.asphalt;
      court.color = lin(0x3a5a52);
      court.box(CX, CZ, 0, 0.02, W + 6, D + 6, KIND.asphalt);
      court.kind = KIND.paint;
      court.color = lin(0xd8d8d0);
      // (A painted line: a strip 16 cm wide, facing up whichever way it runs.)
      const line = (ax: number, az: number, bx: number, bz: number): void => {
        const w = 0.08;
        const [lx, hx, lz, hz] = [Math.min(ax, bx), Math.max(ax, bx), Math.min(az, bz), Math.max(az, bz)];
        if (hx - lx > hz - lz) court.quad([lx, 0.035, lz + w], [hx - lx, 0, 0], [0, 0, -2 * w]);
        else court.quad([lx - w, 0.035, hz], [0, 0, lz - hz], [2 * w, 0, 0]);
      };
      const x0 = CX - W / 2;
      const x1 = CX + W / 2;
      const z0 = CZ - D / 2;
      const z1 = CZ + D / 2;
      line(x0, z0, x1, z0);
      line(x0, z1, x1, z1);
      line(x0, z0, x0, z1);
      line(x1, z0, x1, z1);
      line(CX, z0, CX, z1);
      for (const [a, dir] of [[x0, 1], [x1, -1]] as const) {
        line(a, CZ - 2.4, a + dir * 5.8, CZ - 2.4);
        line(a, CZ + 2.4, a + dir * 5.8, CZ + 2.4);
        line(a + dir * 5.8, CZ - 2.4, a + dir * 5.8, CZ + 2.4);
      }
      genRoot.new.add(new THREE.Mesh(court.build()!, city));
      const furn = new MeshBuilder(1 << 15);
      addProps(furn, {
        props: [
          { kind: 'hoop', x: x0 - 0.1, z: CZ, nx: 1, nz: 0, radius: 0.2, variant: 0, half: 0.4 },
          { kind: 'hoop', x: x1 + 0.1, z: CZ, nx: -1, nz: 0, radius: 0.2, variant: 0, half: 0.4 },
          { kind: 'bench', x: CX - 3, z: z1 + 1.5, nx: 0, nz: -1, radius: 0.35, variant: 0, half: 0.8 },
          { kind: 'postlamp', x: x0 + 3, z: z1 + 1.2, nx: 0, nz: -1, radius: 0.15, variant: 0 },
          { kind: 'postlamp', x: x1 - 3, z: z0 - 1.2, nx: 0, nz: 1, radius: 0.15, variant: 0 },
        ],
        wires: [], lights: [], open: [], solids: [],
      });
      const fm = new THREE.Mesh(furn.build()!, city);
      fm.castShadow = fm.receiveShadow = true;
      genRoot.new.add(fm);
      label('new', 'basketball court with hoops', CX, 6, CZ);
      genItems.new.push(
        { name: 'basketball court', group: 'Court', at: V(CX, 1, CZ), size: 34, view: V(0.2, 0.7, 1).normalize() },
        { name: 'hoop', group: 'Court', at: V(x0, 3.2, CZ), size: 7, view: V(1, 0.15, 0.7).normalize() },
      );
    }
  },
});
