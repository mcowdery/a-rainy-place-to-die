import * as THREE from 'three';
import { DISTRICT_ADS } from '../models/ads';
import { AdSites, type AdSite } from '../real/adSites';
import { Expressway, parseExpressway } from './expressway';
import type { DistrictModel } from './model';
import type { RailLine3 } from './rail';

/**
 * Looking the ads' siting over in the game (`?debug=1`; real/adSites.ts places them, in the chunk workers: this is the
 * same placement worked out again on the page). `window.__ads`:
 * - `all()` lists every billboard and poster: what, who it's for, where, its score, its brand, its district;
 * - `go(i)` stands the camera at the nearest place ad i is well seen from, looking at it (with `?fly=1`: a driver's or a passenger's
 *   place is in the air);
 * - `marks(true)` outlines every ad through the buildings, a line up into the sky over each (red for the expressway,
 *   blue for the lines, yellow for the street, green a poster), and in grey the candidates that were seen well
 *   enough but stood too near a better one. `?adsites=1` starts with them on.
 * debug-shots/adsites.mjs photographs a sample.
 */
export function installAdDebug(o: {
  readonly model: DistrictModel;
  readonly expresswayText: string;
  readonly rails: readonly RailLine3[];
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly controls: { setLevel(y: number): void; setView(yaw: number, pitch: number): void };
  readonly groundAt: (x: number, z: number) => number;
  readonly marks: boolean;
}): void {
  const { model } = o;
  let cache: { sites: AdSite[]; dropped: AdSite[] } | null = null;
  const work = (): { sites: AdSite[]; dropped: AdSite[] } => {
    if (cache) return cache;
    const def = o.expresswayText.trim() ? parseExpressway('expressway.yaml', o.expresswayText, []) : null;
    const ads = new AdSites(model, { expressway: def ? new Expressway(def).roads : [], rails: o.rails });
    const sites: AdSite[] = [];
    const dropped: AdSite[] = [];
    for (const [mx, my] of model.cells) {
      const placed = ads.sites(mx, my);
      sites.push(...placed);
      for (const c of ads.candidates(mx, my)) if (!placed.some((s) => s.b === c.b && s.kind !== 'poster')) dropped.push(c);
    }
    return (cache = { sites, dropped });
  };
  const footing = (s: AdSite): number => model.terrain.footing(s.b.x, s.b.z, s.b.w, s.b.d);
  const COLOUR: Record<AdSite['view'], number> = { expressway: 0xff4040, rail: 0x50a0ff, street: 0xffd030, wait: 0x40e070 };
  let lines: THREE.LineSegments | null = null;
  const marks = (on: boolean): void => {
    if (!lines) {
      const pos: number[] = [];
      const col: number[] = [];
      const c = new THREE.Color();
      const add = (s: AdSite, colour: number, beam: boolean): void => {
        c.set(colour);
        const y = footing(s) + s.y0;
        const at = (u: number, v: number): [number, number, number] => [s.c[0] + s.r[0] * u + s.n[0] * 0.3, y + v, s.c[2] + s.r[2] * u + s.n[2] * 0.3];
        const quad = [at(-s.w / 2, 0), at(s.w / 2, 0), at(s.w / 2, s.h), at(-s.w / 2, s.h)];
        const seg = (a: readonly number[], b: readonly number[]): void => {
          pos.push(...a, ...b);
          col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        };
        for (let i = 0; i < 4; i++) seg(quad[i], quad[(i + 1) % 4]);
        seg(quad[0], quad[2]);
        // The way it faces, and (the ones that were built) a line up into the sky to find it by.
        seg(at(0, s.h / 2), [s.c[0] + s.n[0] * 6, y + s.h / 2, s.c[2] + s.n[2] * 6]);
        if (beam) seg(at(0, s.h), [s.c[0], y + s.h + (s.kind === 'poster' ? 12 : 60), s.c[2]]);
      };
      const { sites, dropped } = work();
      for (const s of dropped) add(s, 0x909090, false);
      for (const s of sites) add(s, COLOUR[s.view], true);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, fog: false, toneMapped: false }));
      lines.frustumCulled = false;
      lines.renderOrder = 999;
      o.scene.add(lines);
    }
    lines.visible = on;
  };
  (window as unknown as { __ads: unknown }).__ads = {
    all: () =>
      work().sites.map((s, i) => ({
        i, kind: s.kind, view: s.view, x: Math.round(s.c[0]), z: Math.round(s.c[2]), y: Math.round(footing(s) + s.y0), w: Math.round(s.w * 10) / 10,
        score: Math.round(s.score * 10) / 10, brand: DISTRICT_ADS[s.ad].brand, district: model.plan(Math.floor(s.b.x / 128), Math.floor(s.b.z / 128))?.kind ?? '',
      })),
    dropped: () => work().dropped.length,
    go: (i: number): boolean => {
      const s = work().sites[i];
      if (!s) return false;
      const y = footing(s) + s.y0 + s.h / 2;
      const g = o.groundAt(s.from[0], s.from[2]);
      // A poster's and a street viewer's eye is over the ground there; a driver's and a passenger's is where it is.
      const eye = s.view === 'wait' ? g + s.from[1] : s.from[1];
      o.camera.position.set(s.from[0], eye, s.from[2]);
      o.controls.setLevel(g);
      const [dx, dz] = [s.c[0] - s.from[0], s.c[2] - s.from[2]];
      o.controls.setView((Math.atan2(dx, dz) * 180) / Math.PI + 180, (Math.atan2(y - eye, Math.hypot(dx, dz)) * 180) / Math.PI);
      return true;
    },
    marks,
  };
  if (o.marks) marks(true);
}
