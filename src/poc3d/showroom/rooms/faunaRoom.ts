import * as THREE from 'three';
import { KIND, lin, MeshBuilder } from '../../real/meshBuilder';
import { Fauna, type FaunaWorld } from '../../real/fauna';
import { loadStatic, type StaticModel } from '../../real/faunaStatic';
import type { Row } from '../../real/faunaRows';
import { makeReview } from '../review';
import { startRoom } from '../shell';

/**
 * An animals room (models-fauna.html: Tōto's, models-fauna-ph.html: Manila's). A row for each animal, and along it every
 * candidate for that animal, lettered A, B, C...: a model built in code (`from: 'built'`) or someone's model file from
 * poly.pizza (assets/animals/candidates/<id>.glb; credits in assets/animals/CREDITS.md; none of them is in the city). The
 * panel's Review section is the user's word on each: click to approve, again to reject (showroom/review.ts). Where a species
 * has no model of its own, the nearest one stands in and its label says so.
 */
const FILES = import.meta.glob('../../../../assets/animals/candidates/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const RIGGED = import.meta.glob('../../../../assets/animals/rigged/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const fileUrl = (id: string): string => {
  const rigged = id.startsWith('rig:');
  const hit = Object.entries(rigged ? RIGGED : FILES).find(([k]) => k.endsWith(`/${rigged ? id.slice(4) : id}.glb`));
  if (!hit) throw new Error(`no candidate ${id}`);
  return hit[1];
};

export interface FaunaRoomConfig {
  readonly title: string;
  /** The room's name for its review file. */
  readonly room: string;
  readonly rows: readonly Row[];
}

const COL = 3.0;
const ROW = 2.6;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const letter = (j: number): string => (j < LETTERS.length ? LETTERS[j] : `${LETTERS[Math.floor(j / LETTERS.length) - 1]}${LETTERS[j % LETTERS.length]}`);

export function startFaunaRoom(cfg: FaunaRoomConfig): void {
  const maxCols = Math.max(...cfg.rows.map((r) => r.cands.length));
  const width = maxCols * COL;
  const mid = (width - COL) / 2;
  const depth = (cfg.rows.length - 1) * ROW;
  const GROUPS = ['On the ground', 'In the air', 'In and by the water'] as const;
  startRoom({
    title: cfg.title,
    groups: GROUPS,
    summer: true,
    camera: { pos: [mid, 9, depth + 12], target: [mid, 0.3, depth / 2] },
    shadow: { x: mid, z: depth / 2, half: Math.max(40, width / 2 + 10) },
    overview: { at: [mid, 0.4, depth / 2], size: Math.max(width, depth) * 0.8, view: [0.1, 0.9, 1] },
    setup(ctx) {
      const { genRoot, genItems, label, city, camera, onFrame, renderPanel } = ctx;
      ctx.floor((floor) => {
        floor.kind = KIND.lot;
        floor.color = lin(0x5e5e5c);
        floor.box(mid, depth / 2, -0.4, -0.2, width + 80, depth + 80, KIND.lot);
      });
      const pad = new MeshBuilder();
      pad.kind = KIND.plain;
      pad.color = lin(0x8a867e);
      pad.box(mid, depth / 2, -0.2, 0.0, width + 6, depth + ROW + 2, KIND.sidewalk);
      genRoot.new.add(new THREE.Mesh(pad.build()!, city));
      const world: FaunaWorld = { groundY: () => 0, standY: () => 0, water: () => 0, density: () => 0, areas: () => ({ parks: [], ponds: [] }), props: () => [] };
      const fauna = new Fauna(world, 1);
      fauna.light = 1;
      genRoot.new.add(fauna.group);
      const review = makeReview(cfg.room, renderPanel);
      ctx.panelExtra((api) => review.panel(api));
      const statics: StaticModel[] = [];
      const only = new URLSearchParams(location.search).get('files');
      const view = new THREE.Vector3(0.0, 0.3, 1).normalize();
      cfg.rows.forEach((row, i) => {
        // (The first row is at the back, so the list reads from the top down the room.)
        const z = depth - i * ROW;
        row.cands.forEach((c, j) => {
          const x = j * COL;
          const air = row.group === 'In the air' || (c.lift ?? 0) > 0;
          if (c.from === 'built') {
            if (row.kind) fauna.display(row.kind, x, air ? 1.3 : 0, z, 0.6, air ? 'fly' : 'stand', c.variant ?? 0, 1);
          } else if (only !== '0' && (!only || only.split(',').includes(c.from))) {
            // (`?files=0` loads none of the candidates' files, `?files=id,id` only those: for finding one that breaks a room.)
            void loadStatic(fileUrl(c.from), fauna.sharedUniforms, { len: c.len ?? 0.5, yaw: c.yaw, lift: c.lift ?? (air ? 1.3 : 0), clip: c.clip })
              .then((m) => {
                m.group.position.set(x, 0, z);
                m.group.rotation.y = 0.6;
                genRoot.new.add(m.group);
                statics.push(m);
              })
              .catch((e) => console.warn('candidate', c.name, e));
          }
          label('new', `${letter(j)} ${c.name}`, x, 1.0 + (c.lift ?? (air ? 1.3 : 0)) + Math.min(1, (c.len ?? 0.5) * 0.8), z);
          review.add(row.name, `${row.key}:${c.from}${c.clip ? `#${c.clip}` : ''}`, `${letter(j)}: ${c.name}`);
        });
        genItems.new.push({ name: row.name, group: row.group, at: new THREE.Vector3(((row.cands.length - 1) * COL) / 2, 0.5, z), size: Math.max(6, row.cands.length * 2.4), view });
      });
      genItems.new.push({ name: 'all of them', group: 'On the ground', at: new THREE.Vector3(mid, 0.3, depth / 2), size: Math.max(width, depth) * 0.8, view: new THREE.Vector3(0.1, 0.9, 1).normalize() });
      let t = 0;
      onFrame((dt) => {
        t += dt;
        fauna.update(dt, camera.position, t);
        for (const s of statics) s.update(dt);
      });
    },
  });
}
