import * as THREE from 'three';
import { splitByTile } from './tiles';
import { type Expressway, type Road } from '../district/expressway';
import { addVehicle } from '../models/vehicles';
import { SignBuilder } from './signs';
import { taxiPhotos } from './taxiAdLayout';
import type { TrafficSigns } from './traffic';
import { CITY_CARS, pickCar } from '../district/carMix';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';

/**
 * The expressway's look and its traffic (the layout is district/expressway.ts). One merged mesh on the city
 * material (so rain wets it and fog takes it): the deck (asphalt, lane lines), its underside and edges, a
 * parapet with a rail wherever an edge is a wall (not where roads merge), piers with crossbeams, sodium lamps
 * on the parapet every 40 m (their heads glowing, and orange pools of light on the deck), green gantry signs
 * before the ramps and exits, and a tunnel portal at the end of each exit spur. Traffic: cars on the loop in
 * both lanes, each keeping its distance (the Intelligent Driver Model, as in the street's traffic), slowing
 * for the corners and for your car.
 */

type V3 = [number, number, number];

const CONCRETE = 0x8a8a84;
const UNDER = 0x3a3a38;

export interface ExpresswayView {
  readonly group: THREE.Group;
}

export function buildExpressway(ex: Expressway, city: THREE.Material): ExpresswayView {
  const group = new THREE.Group();
  // (A city with no expressway, Manila's: nothing to draw.)
  if (ex.roads.length === 0) return { group };
  const mb = new MeshBuilder(1 << 18);
  mb.style = [0, 0, 0, 0];
  const quad = (a: V3, b: V3, c: V3, d: V3, n: V3): void => mb.quadN(a, b, c, d, n, n, n, n);
  const box = (hex: number, cx: number, cz: number, y0: number, y1: number, w: number, d: number): void => {
    mb.kind = KIND.plain;
    mb.color = lin(hex);
    mb.box(cx, cz, y0, y1, w, d, KIND.plain, true);
  };
  const pools: { x: number; z: number; y: number }[] = [];
  const lampHeads: { x: number; z: number; y: number; ox: number; oz: number }[] = [];
  for (const road of ex.roads) {
    // (Set pieces' decks are drawn by their owners.)
    if (road.kind === 'deck') continue;
    const n = road.x.length;
    const segs = road.closed ? n : n - 1;
    const L = (i: number, lat: number, dy = 0): V3 => [road.x[i] + road.tz[i] * lat, road.y[i] + dy, road.z[i] - road.tx[i] * lat];
    for (let k = 0; k < segs; k++) {
      const i = k;
      const j = (k + 1) % n;
      const h = road.half;
      // The deck: asphalt on top, dark underneath.
      mb.kind = KIND.asphalt;
      mb.color = lin(0x2c2c30);
      quad(L(i, h), L(j, h), L(j, -h), L(i, -h), [0, 1, 0]);
      mb.kind = KIND.plain;
      mb.color = lin(UNDER);
      quad(L(i, h, -1.2), L(i, -h, -1.2), L(j, -h, -1.2), L(j, h, -1.2), [0, -1, 0]);
      // Lane lines: solid at the edges, a dashed divider on the loop.
      mb.kind = KIND.paint;
      mb.color = lin(0xe8e8e0);
      for (const lat of [h - 0.9, -(h - 0.9)]) quad(L(i, lat + 0.08, 0.02), L(j, lat + 0.08, 0.02), L(j, lat - 0.08, 0.02), L(i, lat - 0.08, 0.02), [0, 1, 0]);
      if ((road.kind === 'loop' || road.kind === 'route') && k % 12 < 6) quad(L(i, 0.08, 0.02), L(j, 0.08, 0.02), L(j, -0.08, 0.02), L(i, -0.08, 0.02), [0, 1, 0]);
      // Each edge: a wall (a parapet with a rail) unless another road carries on past it (a merge).
      for (const s of [1, -1]) {
        const lat = s * h;
        const pa = L(i, lat);
        const pb = L(j, lat);
        const merged = ex.insideOther(road, pa[0] + road.tz[i] * s * 0.4, pa[2] - road.tx[i] * s * 0.4, pa[1]);
        const nx = road.tz[i] * s;
        const nz = -road.tx[i] * s;
        if (merged) continue;
        mb.kind = KIND.plain;
        mb.color = lin(CONCRETE);
        const top = 1.05;
        const t = 0.25;
        // Outer face, down to the underside; inner face; top.
        const o = (p: V3, dy: number, off: number): V3 => [p[0] + nx * off, p[1] + dy, p[2] + nz * off];
        quad(o(pa, -1.2, t), o(pb, -1.2, t), o(pb, top, t), o(pa, top, t), [nx, 0, nz]);
        quad(o(pa, 0, 0), o(pa, top, 0), o(pb, top, 0), o(pb, 0, 0), [-nx, 0, -nz]);
        quad(o(pa, top, 0), o(pa, top, t), o(pb, top, t), o(pb, top, 0), [0, 1, 0]);
        // The steel rail on top, and a line of reflectors at wheel height.
        mb.kind = KIND.chrome;
        mb.color = lin(0x9aa0a6);
        quad(o(pa, top + 0.15, 0.05), o(pb, top + 0.15, 0.05), o(pb, top + 0.25, 0.05), o(pa, top + 0.25, 0.05), [-nx, 0, -nz]);
        if (k % 8 === 0) {
          mb.kind = KIND.emit;
          mb.style = [EMIT.lamp, 0, 0, 0];
          mb.color = s > 0 ? [0.35, 0.18, 0.03] : [0.3, 0.3, 0.3];
          const pm: V3 = [(pa[0] + pb[0]) / 2, pa[1], (pa[2] + pb[2]) / 2];
          quad(o(pa, 0.5, -0.02), o(pa, 0.58, -0.02), o(pm, 0.58, -0.02), o(pm, 0.5, -0.02), [-nx, 0, -nz]);
          mb.style = [0, 0, 0, 0];
        }
        // Sodium lamps along the outside (left) parapet every 40 m, the arm reaching over the lanes.
        if (s > 0 && k % 40 === 20) lampHeads.push({ x: pa[0], z: pa[2], y: pa[1], ox: -nx, oz: -nz });
      }
    }
    // The ends of a ramp or spur: close the deck's edge.
    if (!road.closed) {
      for (const i of [0, n - 1]) {
        const s = i === 0 ? -1 : 1;
        mb.kind = KIND.plain;
        mb.color = lin(CONCRETE);
        const h = road.half;
        quad(L(i, h, -1.2), L(i, -h, -1.2), L(i, -h), L(i, h), [road.tx[i] * s, 0, road.tz[i] * s]);
        // A deck that stops short of its route's point (`Road.trim`): an end wall across it, parapet to parapet.
        // Where the traffic comes at it (the route's end), yellow-and-black boards on the wall, amber flashers on
        // top and the last of the lanes hatched off; everything has left by the ramp before it.
        if (!road.trim?.[i === 0 ? 0 : 1] || road.joins?.[i === 0 ? 0 : 1]) continue;
        const ax = Math.abs(road.tx[i]);
        const az = Math.abs(road.tz[i]);
        const y = road.y[i];
        const P = (lat: number, out: number): [number, number] => [road.x[i] + road.tz[i] * lat + road.tx[i] * s * out, road.z[i] - road.tx[i] * lat + road.tz[i] * s * out];
        const [wx, wz] = P(0, 0.125);
        box(CONCRETE, wx, wz, y - 1.2, y + 1.05, az * (2 * h + 0.5) + ax * 0.25, ax * (2 * h + 0.5) + az * 0.25);
        if (i === 0) continue;
        for (let k = 0; k < 13; k++) {
          const [bx, bz] = P((k - 6) * 0.7, -0.03);
          mb.kind = KIND.gloss;
          mb.color = lin(k % 2 ? 0x141414 : 0xe8c020);
          mb.box(bx, bz, y + 0.2, y + 0.95, az * 0.7 + ax * 0.06, ax * 0.7 + az * 0.06, KIND.gloss, true);
        }
        mb.kind = KIND.emit;
        mb.style = [EMIT.lamp, 0, 0, 0];
        mb.color = [2.0, 1.1, 0.1];
        for (const lat of [-3, 0, 3]) {
          const [fx, fz] = P(lat, 0.125);
          mb.box(fx, fz, y + 1.05, y + 1.25, 0.22, 0.22, KIND.emit, true);
        }
        mb.style = [0, 0, 0, 0];
        mb.kind = KIND.paint;
        mb.color = lin(0xe8e8e0);
        for (let k = 3; k <= 36 && i - k - 1 >= 0; k += 3) {
          const w = h - 1.2;
          quad(L(i - k - 1, w, 0.02), L(i - k, w, 0.02), L(i - k, -w, 0.02), L(i - k - 1, -w, 0.02), [0, 1, 0]);
        }
      }
    }
    if (road.kind === 'spur') {
      // A tunnel with a way in and a way out is one portal over both carriageways, drawn with the way in's.
      const mate = road.venue ? ex.roads.find((q) => q !== road && q.kind === 'spur' && q.venue === road.venue && !!q.out !== !!road.out) : undefined;
      if (!(road.out && mate)) portal(mb, road, mate);
    }
    if (road.kind === 'ramp') ramp(mb, road, (road.foot ?? 0) > 8);
  }
  // Piers with crossbeams under the deck (the street's colliders are the same piers, less those in junctions).
  for (const p of ex.piers()) {
    const cell = 128;
    const nearJ = Math.hypot(p.x - Math.round(p.x / cell) * cell, p.z - Math.round(p.z / cell) * cell) < 20;
    if (nearJ) continue;
    // Down below the street (and the water, where a route crosses the bay).
    box(CONCRETE, p.x, p.z, -4, p.top, 1.4, 1.4);
    // The beam across the deck (both decks of a two-way route): its long side across the road here.
    let best = 0;
    let road = ex.loop;
    let bd = Infinity;
    for (const r of ex.roads) {
      if (r.kind === 'ramp') continue;
      for (let i = 0; i < r.x.length; i += 4) {
        const d = Math.hypot(r.x[i] - r.tz[i] * (r.offset ?? 0) - p.x, r.z[i] + r.tx[i] * (r.offset ?? 0) - p.z);
        if (d < bd) [best, bd, road] = [i, d, r];
      }
    }
    const across = Math.abs(road.tx[best]) > 0.7;
    const span = (Math.abs(road.offset ?? 0) + ex.def.half) * 2 + 1;
    box(CONCRETE, p.x, p.z, p.top - 1.2, p.top, across ? 1.6 : span, across ? span : 1.6);
    // A ramp alongside, up off the street: an arm out from this pier under it, to its far edge (the ramps stand
    // on these, not on piers of their own in the lanes).
    for (const r of ex.roads) {
      if (r.kind !== 'ramp') continue;
      if (Math.abs(r.x[0] - p.x) > 400 && Math.abs(r.z[0] - p.z) > 400) continue;
      let ri = -1;
      for (let i = 0; i < r.x.length; i++) {
        const along = (p.x - r.x[i]) * r.tx[i] + (p.z - r.z[i]) * r.tz[i];
        const lateral = (p.x - r.x[i]) * r.tz[i] - (p.z - r.z[i]) * r.tx[i];
        if (Math.abs(along) <= 0.5 && Math.abs(lateral) < 18) ri = i;
      }
      if (ri < 0 || r.y[ri] < 6.8) continue;
      // From the pier's far side to the ramp's outer edge, under its underside.
      const ox = r.x[ri] - p.x;
      const oz = r.z[ri] - p.z;
      const reach = Math.hypot(ox, oz) + r.half + 0.3;
      const ux = ox / Math.hypot(ox, oz);
      const uz = oz / Math.hypot(ox, oz);
      const y1 = r.y[ri] - 1.2;
      const along = Math.abs(r.tx[ri]) > 0.7;
      box(CONCRETE, p.x + (ux * reach) / 2, p.z + (uz * reach) / 2, y1 - 1.0, y1, along ? 1.4 : reach, along ? reach : 1.4);
    }
  }
  // Suspension bridges: two towers, the main cables slung between them and down to anchors beyond, hangers down
  // to the deck, and lamps along the cables (lit at night, like the Rainbow Bridge's).
  for (const sb of ex.def.suspension ?? []) {
    const v = sb.col !== undefined;
    const line = (v ? sb.col! : sb.row!) * 128;
    const a0 = sb.from * 128;
    const a1 = sb.to * 128;
    const D = ex.def.deck;
    const TOP = D + 55;
    const hw = sb.width / 2;
    const at = (a: number, c: number): [number, number] => (v ? [line + c, a] : [a, line + c]);
    // The towers: two legs each side of the decks, cross beams, a cap.
    for (const a of [a0, a1]) {
      for (const c of [-hw - 1.5, hw + 1.5]) {
        const [x, z] = at(a, c);
        box(0xe8ecec, x, z, -4, TOP, 3, 3);
      }
      for (const y of [D - 3, D + 22, TOP - 3]) {
        const [x, z] = at(a, 0);
        box(0xe8ecec, x, z, y, y + 2.5, v ? sb.width + 6 : 3, v ? 3 : sb.width + 6);
      }
    }
    // A cable as a chain of sloped strips from point to point: a vertical ribbon and a flat one along each
    // segment, both faces (so it reads as a round cable from any side, with no steps on the steep runs).
    const cable = (pts: [number, number, number][]): void => {
      mb.kind = KIND.plain;
      mb.color = lin(0xd8dcdc);
      const r = 0.22;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay, az] = pts[i];
        const [bx, by, bz] = pts[i + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const l = Math.hypot(dx, dz) || 1;
        // Across the cable, level.
        const cx = (-dz / l) * r;
        const cz = (dx / l) * r;
        const up: V3 = [0, 1, 0];
        const side: V3 = [-dz / l, 0, dx / l];
        const ribbon = (p0: V3, p1: V3, p2: V3, p3: V3, n: V3): void => {
          quad(p0, p1, p2, p3, n);
          quad(p0, p3, p2, p1, [-n[0], -n[1], -n[2]]);
        };
        ribbon([ax, ay - r, az], [bx, by - r, bz], [bx, by + r, bz], [ax, ay + r, az], side);
        ribbon([ax - cx, ay, az - cz], [ax + cx, ay, az + cz], [bx + cx, by, bz + cz], [bx - cx, by, bz - cz], up);
      }
    };
    const back = 70;
    for (const c of [-hw - 1.5, hw + 1.5]) {
      const pts: [number, number, number][] = [];
      // From the anchor before the first tower, up to its top, the sag across the main span, down to the far anchor.
      const [bx0, bz0] = at(a0 - back, c);
      pts.push([bx0, D + 1, bz0]);
      const main = 24;
      for (let k = 0; k <= main; k++) {
        const t = k / main;
        const a = a0 + (a1 - a0) * t;
        const sag = TOP - 2 - (TOP - 2 - (D + 4)) * (1 - (2 * t - 1) ** 2);
        const [x, z] = at(a, c);
        pts.push([x, sag, z]);
      }
      const [bx1, bz1] = at(a1 + back, c);
      pts.push([bx1, D + 1, bz1]);
      cable(pts);
      // Hangers every 8 m across the main span; lamps along the cable.
      for (let a = a0 + 8; a < a1 - 4; a += 8) {
        const t = (a - a0) / (a1 - a0);
        const sag = TOP - 2 - (TOP - 2 - (D + 4)) * (1 - (2 * t - 1) ** 2);
        const [x, z] = at(a, c);
        box(0xc8cccc, x, z, D + 1, sag, 0.15, 0.15);
        mb.kind = KIND.emit;
        mb.style = [EMIT.lamp, 0, 0, 0];
        mb.color = [2.2, 2.0, 1.6];
        mb.box(x, z, sag + 0.3, sag + 0.7, 0.4, 0.4, KIND.emit, true);
        mb.style = [0, 0, 0, 0];
      }
    }
    // The tower tops' red aircraft lights.
    for (const a of [a0, a1]) {
      const [x, z] = at(a, 0);
      mb.kind = KIND.emit;
      mb.style = [EMIT.always, 0, 0, 0];
      mb.color = [3.0, 0.2, 0.15];
      mb.box(x, z, TOP - 0.5, TOP + 0.6, 1.2, 1.2, KIND.emit, true);
      mb.style = [0, 0, 0, 0];
    }
  }
  for (const L of lampHeads) {
    // The pole on the parapet, the arm, the head (a sodium lamp: orange, on at night).
    box(0x5a5e62, L.x, L.z, L.y + 1.05, L.y + 8, 0.2, 0.2);
    const hx = L.x + L.ox * 2.6;
    const hz = L.z + L.oz * 2.6;
    box(0x5a5e62, (L.x + hx) / 2, (L.z + hz) / 2, L.y + 7.9, L.y + 8.05, Math.abs(L.ox) > 0.5 ? 2.6 : 0.15, Math.abs(L.oz) > 0.5 ? 2.6 : 0.15);
    mb.kind = KIND.emit;
    mb.style = [EMIT.lamp, 0, 0, 0];
    mb.color = [2.4, 1.1, 0.3];
    mb.box(hx, hz, L.y + 7.6, L.y + 7.9, 0.7, 0.7, KIND.emit, true);
    mb.style = [0, 0, 0, 0];
    pools.push({ x: hx, z: hz, y: L.y });
  }
  // Parking areas (`plazas`): a raised apron the decks end on, drawn here (a road of kind 'deck').
  for (const road of ex.roads) {
    if (!road.plaza) continue;
    const { length: LEN, width: W } = road.plaza;
    const D = road.y[0];
    const [sx, sz] = [road.x[0], road.z[0]];
    const [dx, dz] = [road.tx[0], road.tz[0]];
    const [lx, lz] = [road.tz[0], -road.tx[0]];
    const P = (u: number, t: number): [number, number] => [sx + dx * u + lx * t, sz + dz * u + lz * t];
    const V = (u: number, t: number, y: number): V3 => {
      const p = P(u, t);
      return [p[0], y, p[1]];
    };
    const sheet = (u0: number, u1: number, t0: number, t1: number, y: number): void => quad(V(u0, t0, y), V(u1, t0, y), V(u1, t1, y), V(u0, t1, y), [0, 1, 0]);
    const rbox = (hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, kind: number = KIND.plain): void => {
      const [cx, cz] = P((u0 + u1) / 2, (t0 + t1) / 2);
      const [du, dt] = [u1 - u0, t1 - t0];
      mb.kind = kind;
      mb.color = lin(hex);
      mb.box(cx, cz, y0, y1, Math.abs(dx) * du + Math.abs(lx) * dt, Math.abs(dz) * du + Math.abs(lz) * dt, kind, true);
    };
    const glow = (u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, rgb: [number, number, number]): void => {
      const [cx, cz] = P((u0 + u1) / 2, (t0 + t1) / 2);
      const [du, dt] = [u1 - u0, t1 - t0];
      mb.kind = KIND.emit;
      mb.style = [EMIT.lamp, 0, 0, 0];
      mb.color = rgb;
      mb.box(cx, cz, y0, y1, Math.abs(dx) * du + Math.abs(lx) * dt, Math.abs(dz) * du + Math.abs(lz) * dt, KIND.emit, true);
      mb.style = [0, 0, 0, 0];
    };
    const HW = W / 2;
    // The apron: asphalt on top, dark underneath, and a wall round it (the north side is open where the decks run in).
    mb.kind = KIND.asphalt;
    mb.color = lin(0x2c2c30);
    sheet(0, LEN, -HW, HW, D);
    mb.kind = KIND.plain;
    mb.color = lin(UNDER);
    quad(V(0, -HW, D - 1.2), V(0, HW, D - 1.2), V(LEN, HW, D - 1.2), V(LEN, -HW, D - 1.2), [0, -1, 0]);
    rbox(CONCRETE, LEN - 0.4, LEN, -HW, HW, D - 1.2, D + 1.05);
    for (const s of [-1, 1]) {
      rbox(CONCRETE, 0, LEN, s > 0 ? HW - 0.4 : -HW, s > 0 ? HW : -HW + 0.4, D - 1.2, D + 1.05);
      rbox(CONCRETE, 0, 0.4, s > 0 ? 10.4 : -HW, s > 0 ? HW : -10.4, D - 1.2, D + 1.05);
      rbox(0x9aa0a6, 0, LEN, s > 0 ? HW - 0.5 : -HW + 0.1, s > 0 ? HW - 0.1 : -HW + 0.5, D + 1.1, D + 1.2, KIND.chrome);
    }
    // What holds it up: columns in the avenue's median below, and on each side a thin building, with the road between
    // them: stair and lift cores down to the street, offices and shops in the rest, lit windows, a green sign at each
    // door (the people who park go down through them). Nothing is planted under it.
    for (let u = 16; u < LEN; u += 28) rbox(CONCRETE, u - 1.2, u + 1.2, -1.2, 1.2, -4, D - 1.2);
    const WALL = 0xcfcabc;
    for (const w of road.plaza.wings) {
      rbox(WALL, w.u0, w.u1, w.t0, w.t1, 0, D - 1.2);
      const inner = w.t0 > 0 ? w.t0 : w.t1;
      const face = w.t0 > 0 ? -1 : 1;
      // The street face: a glazed ground floor, then bands of windows up to the apron, all lit.
      for (let u = w.u0 + 3; u < w.u1 - 5; u += 6) {
        glow(u, u + 4.4, inner + 0.1 * face - 0.12, inner + 0.1 * face + 0.12, 0.4, 3.0, [1.5, 1.35, 0.9]);
        for (const y of [4.6, 8.0, 11.2]) glow(u, u + 4.4, inner + 0.1 * face - 0.1, inner + 0.1 * face + 0.1, y, y + 1.6, [0.9, 1.0, 1.1]);
      }
      // The door at the middle: a canopy, a bright doorway, a lift core up the face.
      const um = (w.u0 + w.u1) / 2;
      rbox(0x4a4e52, um - 3.5, um + 3.5, w.t0 > 0 ? w.t0 - 1.6 : w.t1, w.t0 > 0 ? w.t0 : w.t1 + 1.6, 3.2, 3.5);
      glow(um - 1.4, um + 1.4, inner + 0.2 * face - 0.1, inner + 0.2 * face + 0.1, 0.1, 2.9, [2.0, 1.9, 1.5]);
      rbox(0x9aa0a6, um - 1.4, um + 1.4, inner + face * 0.4 - 0.4, inner + face * 0.4 + 0.4, 3.5, D - 1.2);
    }
    // Stair towers on the apron over each wing's end: a roof, a door, a green sign at it for people to the street.
    for (const s of [-1, 1]) {
      const [t0, t1] = s > 0 ? [24.5, 31] : [-31, -24.5];
      rbox(0xcfcabc, 112, 120, t0, t1, D, D + 3.4);
      rbox(0x6a6e72, 111.6, 120.4, t0 - 0.4, t1 + 0.4, D + 3.4, D + 3.7);
      glow(112 - 0.1, 112 + 0.1, t0 + 1, t1 - 1, D + 0.1, D + 2.6, [2.0, 1.9, 1.5]);
      glow(112 - 0.12, 112 + 0.12, t0 + 0.8, t1 - 0.8, D + 3.0, D + 3.35, [0.2, 1.4, 0.7]);
    }
    // Paint: bays along the walls and by the island, the aisles' arrows.
    mb.kind = KIND.paint;
    mb.color = lin(0xe8e8e0);
    const BANKS = [[28.4, 33.4], [-33.4, -28.4], [10.4, 15.4], [-15.4, -10.4]] as const;
    for (const [t0, t1] of BANKS) {
      const [ua, ub] = Math.abs(t0) < 20 ? [38, 110] : [18, 110];
      for (let u = ua; u <= ub + 0.01; u += 2.6) sheet(u - 0.06, u + 0.06, t0, t1, D + 0.03);
      sheet(ua, ub, t0 < 0 ? t0 : t1 - 0.12, t0 < 0 ? t0 + 0.12 : t1, D + 0.03);
    }
    for (const [t, dir] of [[21.6, 1], [-21.6, -1]] as const) {
      for (let u = 20; u < 104; u += 18) {
        const [a, b] = dir > 0 ? [u, u + 8] : [u + 8, u];
        sheet(Math.min(a, b), Math.max(a, b), t - 0.2, t + 0.2, D + 0.03);
        // The head: strips narrowing to the point.
        for (let k = 0; k < 5; k++) {
          const w = 1.1 * (1 - k / 5);
          const [h0, h1] = dir > 0 ? [u + 8 + k * 0.3, u + 8.3 + k * 0.3] : [u - k * 0.3 - 0.3, u - k * 0.3];
          sheet(h0, h1, t - w, t + w, D + 0.03);
        }
      }
    }
    // The island between the aisles, with the rest building on it: a glass storey and a flat roof, lit at night.
    rbox(0xb8bab0, 22, 114, -10, 10, D, D + 0.2);
    rbox(0xd6d2c6, 34, 66, -7.5, 7.5, D + 0.2, D + 6.4);
    rbox(0x6a6e72, 33.4, 66.6, -8.1, 8.1, D + 6.4, D + 6.8);
    for (let u = 36; u < 64; u += 6) for (const s of [-1, 1]) glow(u, u + 4, s > 0 ? 7.45 : -7.7, s > 0 ? 7.7 : -7.45, D + 1.2, D + 2.8, [1.5, 1.35, 0.85]);
    glow(41, 59, -2, 2, D + 6.8, D + 7.0, [1.6, 0.35, 0.3]);
    // Vending machines in a row south of it, lit.
    for (let k = 0; k < 6; k++) {
      rbox(0x3a4a8a, 70 + k * 1.2, 70 + k * 1.2 + 1.0, -1.6, 1.6, D + 0.2, D + 2.0);
      glow(70 + k * 1.2 + 0.1, 70 + k * 1.2 + 0.9, -1.65, -1.55, D + 0.7, D + 1.7, [1.8, 1.8, 1.7]);
    }
    // Cars in the bays: most bays, in the paints the regulars favour.
    const PAINTS = [0xc81a1a, 0xe8e8e4, 0x1a1a1c, 0x2a5ad0, 0xe8c020, 0x8a2ac8, 0xd86a1e, 0x2a8a4a, 0xa8b0b8];
    let nCar = 0;
    for (const [t0, t1] of BANKS) {
      for (let u = Math.abs(t0) < 20 ? 38 : 18; u < 108; u += 2.6) {
        nCar++;
        if ((nCar * 7919) % 11 < 4) continue;
        const c = (t0 + t1) / 2;
        rbox(PAINTS[(nCar * 31) % PAINTS.length], u + 0.45, u + 2.15, c - 2.1, c + 2.1, D + 0.1, D + 0.85, KIND.gloss);
        rbox(0x1c2026, u + 0.55, u + 2.05, c - 1.0, c + 1.1, D + 0.85, D + 1.35, KIND.gloss);
      }
    }
    // Floodlights: tall poles in the aisles, glowing heads, a pool of light under each.
    for (const u of [28, 64, 100]) {
      for (const t of [-21.6, 0, 21.6]) {
        if (t === 0 && u === 64) continue;
        rbox(0x5a5e62, u - 0.15, u + 0.15, t - 0.15, t + 0.15, D, D + 11);
        glow(u - 0.8, u + 0.8, t - 0.4, t + 0.4, D + 11, D + 11.4, [2.0, 1.8, 1.4]);
        const [px, pz] = P(u, t);
        pools.push({ x: px, z: pz, y: D });
      }
    }
    // The sign over the throat: the PA's name, the way in over the east deck.
    const words = road.plaza.name.split(' ');
    const mat = face(`pa:${road.plaza.name}`, 1024, 300, (cg) => {
      cg.fillStyle = '#0e6a3a';
      cg.fillRect(0, 0, 1024, 300);
      cg.strokeStyle = '#f0f0f0';
      cg.lineWidth = 8;
      cg.strokeRect(10, 10, 1004, 280);
      cg.fillStyle = '#f4f4f0';
      cg.textAlign = 'center';
      cg.font = "bold 104px 'Yu Gothic', 'Meiryo', sans-serif";
      cg.fillText(words[0], 512, 130);
      cg.font = 'bold 60px Consolas, sans-serif';
      cg.fillText(`${words.slice(1).join(' ')} · P`, 512, 240);
    });
    const sg = new THREE.Group();
    const steelPa = new THREE.MeshStandardMaterial({ color: 0x8a8e94, metalness: 0.5, roughness: 0.5 });
    for (const t of [-12.5, 12.5]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8, 0.4), steelPa);
      post.position.set(t, 4, 0);
      sg.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(25.4, 0.45, 0.45), steelPa);
    beam.position.set(0, 7.8, 0);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.6), mat);
    board.position.set(5.2, 6.1, -0.3);
    board.rotation.y = Math.PI;
    sg.add(beam, board);
    const [gx, gz] = P(12, 0);
    sg.position.set(gx, D, gz);
    sg.rotation.y = Math.atan2(dx, dz);
    group.add(sg);
  }
  // Gantry signs over the deck before each exit (green, white lettering), and at street level a sign before
  // each entrance, on the avenue's median.
  for (const road of ex.roads) {
    if (road.kind === 'loop' || road.kind === 'route' || road.out) continue;
    if (road.rampKind === 'on') {
      group.add(entranceSign(road, road.foot ?? 0, (road.foot ?? 0) > 8), entranceGantry(road, (road.foot ?? 0) > 8));
      continue;
    }
    if (road.rampKind === 'off') group.add(noEntry(road, (road.foot ?? 0) > 8), noseSign(road, ex));
    const text = road.kind === 'spur' ? [`${road.sign}`, 'TUNNEL · 直進'] : [`出口 EXIT`, `${road.sign}`];
    group.add(gantry(road, 0, text, ex));
    // An exit is signed well before it: a second gantry 320 m back, with the distance.
    if (road.rampKind === 'off') group.add(gantry(road, 0, ['出口 EXIT 400 m', `${road.sign}`], ex, 320));
  }
  // In 256 m tiles, so what's off screen isn't drawn (the network as one mesh was ~550k triangles from anywhere).
  for (const g of splitByTile(mb.build()!, 256)) {
    const mesh = new THREE.Mesh(g, city);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  // Pools of sodium light on the deck (additive decals), shown at night with the lamps.
  const pool = poolTexture();
  const pm = new THREE.MeshBasicMaterial({ map: pool, color: new THREE.Color(0.26, 0.12, 0.03), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const pg = new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2);
  const pools3 = new THREE.InstancedMesh(pg, pm, pools.length);
  const m4 = new THREE.Matrix4();
  pools.forEach((p, i) => pools3.setMatrixAt(i, m4.makeTranslation(p.x, p.y + 0.04, p.z)));
  pools3.frustumCulled = false;
  pools3.name = 'sodium';
  group.add(pools3);
  return { group };
}

/**
 * A ramp's solid part: where it's too low to walk or drive under (below 5.2 m), a filled embankment between
 * retaining walls, down to the street; above that, on arms from the deck's piers. Where an exit ramp's embankment
 * starts, facing the street traffic coming along the lane under it, a yellow-and-black crash cushion. On an
 * entrance's foot, arrows painted up the lane.
 */
function ramp(mb: MeshBuilder, road: Road, slip: boolean): void {
  const n = road.x.length;
  const h = road.half;
  const L = (i: number, lat: number, y: number): V3 => [road.x[i] + road.tz[i] * lat, y, road.z[i] - road.tx[i] * lat];
  const LOW = 5.2;
  mb.kind = KIND.plain;
  mb.color = lin(CONCRETE);
  for (let i = 0; i + 1 < n; i++) {
    const ya = road.y[i];
    const yb = road.y[i + 1];
    if (Math.min(ya, yb) >= LOW) continue;
    for (const s of [1, -1]) {
      const nx = road.tz[i] * s;
      const nz = -road.tx[i] * s;
      const n3: V3 = [nx, 0, nz];
      mb.quadN(L(i, s * (h + 0.25), 0), L(i + 1, s * (h + 0.25), 0), L(i + 1, s * (h + 0.25), yb), L(i, s * (h + 0.25), ya), n3, n3, n3, n3);
    }
  }
  // (The high part stands on arms from the deck's piers in the median: buildExpressway.)
  // Arrows painted near the street end the way traffic goes: up an entrance; down an exit, so they point at
  // anyone about to drive up it the wrong way.
  {
    mb.kind = KIND.paint;
    mb.color = lin(0xe8e8e0);
    const flat = (i: number, l0: number, l1: number, a0: number, a1: number): void => {
      const P = (lat: number, a: number): V3 => {
        const p = L(i, lat, 0);
        return [p[0] + road.tx[i] * a, road.y[i] + 0.03 + (road.y[i + 1] - road.y[i]) * a, p[2] + road.tz[i] * a];
      };
      mb.quadN(P(l0, a0), P(l0, a1), P(l1, a1), P(l1, a0), [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]);
    };
    // An entrance's mouth: a hatched gore in front of the wall's nose, so the way on reads from the junction (the lane
    // lines run on into it), and the lane's edges painted back to the junction.
    if (road.rampKind === 'on') {
      const GL = 15;
      // The gore lies between the ramp and the lanes it leaves: toward the median (its right) from a ramp on the kerb side,
      // beside the kerb lane on its left from one in the inner lane.
      const [g0, g1] = slip ? [-(h + 0.3), -(h + 1.6)] : [h + 0.3, h + 2.7];
      const PP = (lat: number, a: number): V3 => {
        const p = L(0, lat, 0);
        return [p[0] + road.tx[0] * a, road.y[0] + 0.03, p[2] + road.tz[0] * a];
      };
      const up: V3 = [0, 1, 0];
      for (let k = 0; k < 8; k++) {
        const a = -GL + k * (GL / 8);
        mb.quadN(PP(g0, a), PP(g1, a + 1.1), PP(g1, a + 1.6), PP(g0, a + 0.5), up, up, up, up);
      }
      for (const lat of [g0, g1]) mb.quadN(PP(lat, -GL), PP(lat, 0), PP(lat + 0.18, 0), PP(lat + 0.18, -GL), up, up, up, up);
    }
    for (const i of road.rampKind === 'on' ? [4, 20] : [n - 30, n - 14]) {
      // The shaft, then the head as strips narrowing to its point.
      flat(i, 0.15, -0.15, 0, 3.2);
      for (let k = 0; k < 6; k++) {
        const w = 0.75 * (1 - k / 6);
        flat(i, w, -w, 3.2 + k * 0.25, 3.45 + k * 0.25);
      }
    }
  }
  // The end of the embankment that faces the street's oncoming traffic (an off-ramp's, where it drops below
  // the clearance): a concrete face and a striped cushion.
  if (road.rampKind === 'off') {
    let i = 0;
    while (i < n - 1 && road.y[i] >= LOW) i++;
    const y = road.y[i];
    mb.kind = KIND.plain;
    mb.color = lin(CONCRETE);
    const back: V3 = [-road.tx[i], 0, -road.tz[i]];
    mb.quadN(L(i, h + 0.25, 0), L(i, -h - 0.25, 0), L(i, -h - 0.25, y), L(i, h + 0.25, y), back, back, back, back);
    const cx = road.x[i] - road.tx[i] * 0.6;
    const cz = road.z[i] - road.tz[i] * 0.6;
    for (let k = 0; k < 5; k++) {
      mb.kind = KIND.gloss;
      mb.color = lin(k % 2 ? 0x141414 : 0xe8c020);
      mb.box(cx, cz, 0.15 + k * 0.22, 0.37 + k * 0.22, Math.abs(road.tz[i]) * (2 * h - 0.4) + Math.abs(road.tx[i]) * 1.0, Math.abs(road.tx[i]) * (2 * h - 0.4) + Math.abs(road.tz[i]) * 1.0, KIND.gloss, true);
    }
    // Amber flashers on top (lamps: bright at night).
    mb.kind = KIND.emit;
    mb.style = [EMIT.lamp, 0, 0, 0];
    mb.color = [2.0, 1.1, 0.1];
    mb.box(cx, cz, 1.3, 1.5, 0.25, 0.25, KIND.emit, true);
    mb.style = [0, 0, 0, 0];
  }
}

/**
 * At street level before an entrance, on the avenue's median: 東都高速 入口 with the district and an arrow up
 * the ramp (the expressway's green, on a post), facing the traffic coming.
 */
function entranceSign(road: Road, foot: number, slip: boolean): THREE.Group {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 384;
  const cg = c.getContext('2d')!;
  cg.fillStyle = '#0e6a3a';
  cg.fillRect(0, 0, 512, 384);
  cg.strokeStyle = '#f0f0f0';
  cg.lineWidth = 7;
  cg.strokeRect(8, 8, 496, 368);
  cg.fillStyle = '#f4f4f0';
  cg.textAlign = 'center';
  cg.font = "bold 68px 'Yu Gothic', 'Meiryo', sans-serif";
  cg.fillText('東都高速 入口', 256, 96);
  cg.font = 'bold 40px Consolas, sans-serif';
  cg.fillText('EXPRESSWAY', 256, 150);
  cg.font = "bold 44px 'Yu Gothic', sans-serif";
  cg.fillText(road.sign ?? '', 256, 216);
  // The arrow: ahead and up (the ramp rises from the lane by the median).
  cg.beginPath();
  cg.moveTo(256, 250);
  cg.lineTo(316, 310);
  cg.lineTo(280, 310);
  cg.lineTo(280, 364);
  cg.lineTo(232, 364);
  cg.lineTo(232, 310);
  cg.lineTo(196, 310);
  cg.closePath();
  cg.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.9, 0.9, 0.9) }));
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8e94, metalness: 0.5, roughness: 0.5 });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.6, 0.16), steel);
  post.position.set(0, 1.8, 0);
  sign.position.set(0, 3.3, -0.1);
  sign.rotation.y = Math.PI;
  g.add(post, sign);
  // On the median's nose by the ramp's foot (the median breaks at the junction before it), so it's in view as
  // you cross the junction toward it.
  const back = -3;
  // (On the pavement by a kerb-side ramp, on the median's nose by an inner one.)
  const lat = slip ? road.half + 0.7 : -foot;
  g.position.set(road.x[0] - road.tx[0] * back + road.tz[0] * lat, 0.18, road.z[0] - road.tz[0] * back - road.tx[0] * lat);
  g.rotation.y = Math.atan2(road.tx[0], road.tz[0]);
  return g;
}

/** A sign's face drawn on a canvas, once per kind (shared by every ramp). */
const faces = new Map<string, THREE.MeshBasicMaterial>();
function face(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.MeshBasicMaterial {
  let m = faces.get(key);
  if (!m) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.9, 0.9, 0.9), transparent: true, alphaTest: 0.5 });
    faces.set(key, m);
  }
  return m;
}

/**
 * Over an entrance's foot, a green gantry: 東都高速 入口 ENTRANCE and an arrow up the ramp, facing the street
 * traffic turning in (so it reads as the way on from the whole block).
 */
function entranceGantry(road: Road, slip: boolean): THREE.Group {
  const g = new THREE.Group();
  const i = 10;
  // One post in the median (the ramp's right: -x in the group's frame), its arm out over the ramp.
  const w = road.half + 0.55;
  // The post stands off the lanes: on the pavement by a kerb-side ramp (the ramp's left: +x in the group's frame), in the median by an inner one.
  const pk = slip ? 1 : -1;
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8e94, metalness: 0.5, roughness: 0.5 });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8.6, 0.4), steel);
  post.position.set(pk * w, 4.3, 0);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 5, 0.45, 0.45), steel);
  beam.position.set(pk * (w - (w + 5) / 2), 8.2, 0);
  g.add(post, beam);
  const mat = face(`entrance:${road.sign}`, 1024, 320, (cg) => {
    cg.fillStyle = '#0e6a3a';
    cg.fillRect(0, 0, 1024, 320);
    cg.strokeStyle = '#f0f0f0';
    cg.lineWidth = 8;
    cg.strokeRect(10, 10, 1004, 300);
    cg.fillStyle = '#f4f4f0';
    cg.textAlign = 'center';
    cg.font = "bold 104px 'Yu Gothic', 'Meiryo', sans-serif";
    cg.fillText('東都高速 入口', 450, 140);
    cg.font = 'bold 60px Consolas, sans-serif';
    cg.fillText(`ENTRANCE · ${(road.sign ?? '').replace(/^[^ ]+ /, '')}`, 450, 250);
    // The arrow: straight on, up the ramp.
    cg.beginPath();
    cg.moveTo(900, 50);
    cg.lineTo(980, 140);
    cg.lineTo(930, 140);
    cg.lineTo(930, 280);
    cg.lineTo(870, 280);
    cg.lineTo(870, 140);
    cg.lineTo(820, 140);
    cg.closePath();
    cg.fill();
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 2.63), mat);
  // Traffic travels +z in the group's frame: the sign faces -z, toward it.
  sign.position.set(-pk * 0.8, 6.6, -0.3);
  sign.rotation.y = Math.PI;
  g.add(sign);
  g.position.set(road.x[i], road.y[i], road.z[i]);
  g.rotation.y = Math.atan2(road.tx[i], road.tz[i]);
  return g;
}

/**
 * At the nose where an exit ramp parts from the deck (its inner edge clear of the deck's), on a post by the dividing wall
 * and facing the traffic: a green board with the way off, an arrow up and to the left, and the ramp's name, lit by
 * the headlights' reflection like the gantries (the exit has to be seen coming).
 */
function noseSign(road: Road, ex: Expressway): THREE.Group {
  const g = new THREE.Group();
  // The deck it leaves: the nearest route or loop sample to the ramp's first.
  let deck = ex.loop;
  let dk = 0;
  let bd = Infinity;
  for (const q of ex.roads) {
    if (q.kind !== 'loop' && q.kind !== 'route') continue;
    for (let k = 0; k < q.x.length; k++) {
      const d = Math.hypot(q.x[k] - road.x[0], q.z[k] - road.z[0]) + Math.abs(q.y[k] - road.y[0]) * 0.5;
      if (d < bd) [deck, dk, bd] = [q, k, d];
    }
  }
  // Where the wall between them starts: the first ramp sample more than a metre below the deck (while it's level with it
  // the two are one open surface), and the deck's sample beside it.
  let i = 0;
  while (i < road.x.length - 1 && road.y[i] > deck.y[dk] - 1.0) i++;
  let kd = dk;
  let dd = Infinity;
  for (let k = Math.max(0, dk - 60); k < Math.min(deck.x.length, dk + 500); k++) {
    const d = Math.hypot(deck.x[k] - road.x[i], deck.z[k] - road.z[i]);
    if (d < dd) [kd, dd] = [k, d];
  }
  const mat = face(`nose:${road.sign}`, 640, 420, (cg) => {
    cg.fillStyle = '#0e6a3a';
    cg.fillRect(0, 0, 640, 420);
    cg.strokeStyle = '#f0f0f0';
    cg.lineWidth = 10;
    cg.strokeRect(12, 12, 616, 396);
    cg.fillStyle = '#f4f4f0';
    cg.textAlign = 'center';
    cg.font = "bold 110px 'Yu Gothic', 'Meiryo', sans-serif";
    cg.fillText('出口', 330, 120);
    cg.font = 'bold 70px Consolas, sans-serif';
    cg.fillText('EXIT', 330, 200);
    cg.font = "bold 56px 'Yu Gothic', 'Meiryo', sans-serif";
    cg.fillText((road.sign ?? '').slice(0, 14), 330, 290);
    // The arrow, up and to the left (the ramp leaves on the left).
    cg.save();
    cg.translate(100, 330);
    cg.rotate(-Math.PI / 4);
    cg.beginPath();
    cg.moveTo(0, -80);
    cg.lineTo(50, -20);
    cg.lineTo(18, -20);
    cg.lineTo(18, 60);
    cg.lineTo(-18, 60);
    cg.lineTo(-18, -20);
    cg.lineTo(-50, -20);
    cg.closePath();
    cg.fill();
    cg.restore();
  });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8e94, metalness: 0.5, roughness: 0.5 });
  // On the deck's edge (its left side, where the ramp leaves), just outside the lane, facing the traffic along the deck.
  const x = deck.half + 0.35;
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4.4, 0.22), steel);
  post.position.set(x, 2.2, 0);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.36), mat);
  sign.position.set(x, 4.6, -0.2);
  sign.rotation.y = Math.PI;
  g.add(post, sign);
  g.position.set(deck.x[kd], deck.y[kd], deck.z[kd]);
  g.rotation.y = Math.atan2(deck.tx[kd], deck.tz[kd]);
  return g;
}

/**
 * At an exit's foot, facing the street (anyone about to drive up it): a 進入禁止 no-entry sign on a post in the
 * median, a red 逆走 WRONG WAY panel under it.
 */
function noEntry(road: Road, slip: boolean): THREE.Group {
  const g = new THREE.Group();
  const n = road.x.length - 1;
  const round = face('noentry', 256, 256, (cg) => {
    cg.fillStyle = '#d81e1e';
    cg.beginPath();
    cg.arc(128, 128, 122, 0, Math.PI * 2);
    cg.fill();
    cg.strokeStyle = '#f4f4f0';
    cg.lineWidth = 6;
    cg.stroke();
    cg.fillStyle = '#f4f4f0';
    cg.fillRect(40, 108, 176, 40);
  });
  const panel = face('wrongway', 512, 192, (cg) => {
    cg.fillStyle = '#c81818';
    cg.fillRect(0, 0, 512, 192);
    cg.strokeStyle = '#f4f4f0';
    cg.lineWidth = 6;
    cg.strokeRect(6, 6, 500, 180);
    cg.fillStyle = '#f4f4f0';
    cg.textAlign = 'center';
    cg.font = "bold 72px 'Yu Gothic', 'Meiryo', sans-serif";
    cg.fillText('逆走 出口', 256, 88);
    cg.font = 'bold 54px Consolas, sans-serif';
    cg.fillText('WRONG WAY', 256, 160);
  });
  // On a post in the median beside the foot (the ramp's right: -x in the group's frame), clear of the lanes.
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.5, roughness: 0.5 });
  const x = (slip ? 1 : -1) * (road.half + 0.55);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.1, 0.1), steel);
  post.position.set(x, 1.55, 0);
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), round);
  disc.position.set(x, 2.6, 0.07);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.49), panel);
  sign.position.set(x, 1.75, 0.07);
  g.add(post, disc, sign);
  // The exit's traffic travels +z in the group's frame, toward the street: the signs face +z, at the street.
  g.position.set(road.x[n], road.y[n], road.z[n]);
  g.rotation.y = Math.atan2(road.tx[n], road.tz[n]);
  return g;
}

/**
 * The headland a spur's tunnel bores into: a mound round a centre 203 m back of the tunnel's end wall (where its slope
 * comes down to the deck's height, so the tube is all in front of the hill), as lathe rings (height, radius) and the
 * height of its surface at a point (null beyond its foot). Only a spur with a `hill`.
 */
export function hillOf(road: Road): { cx: number; cz: number; rings: [number, number][]; at: (x: number, z: number) => number | null } | null {
  if (!road.hill) return null;
  const i = road.out ? 0 : road.x.length - 1;
  const s = road.out ? -1 : 1;
  const cx = road.x[i] + road.tx[i] * s * 203;
  const cz = road.z[i] + road.tz[i] * s * 203;
  const H = road.hill;
  const rings: [number, number][] = [[-3, 230], [H * 0.35, 190], [H * 0.7, 120], [H, 50], [H + 6, 8]];
  return {
    cx,
    cz,
    rings,
    at: (x, z) => {
      const r = Math.hypot(x - cx, z - cz);
      if (r > rings[0][1]) return null;
      for (let k = 0; k + 1 < rings.length; k++) {
        const [y0, r0] = rings[k];
        const [y1, r1] = rings[k + 1];
        if (r <= r0 && r >= r1) return y0 + ((y1 - y0) * (r0 - r)) / (r0 - r1);
      }
      return rings[rings.length - 1][0];
    },
  };
}

/**
 * A tunnel portal at a spur's end: a concrete headwall round a dark mouth, lamps inside, the name over it. An entry
 * (`Road.out`) has it at its start, the same seen from the other way: the tube is its first `tube` metres, closed at
 * sample 0 by the black wall, and it comes out at the mouth.
 */
function portal(mb: MeshBuilder, road: Road, mate?: Road): void {
  const n = road.x.length;
  const out = !!road.out;
  const i = out ? 0 : n - 1;
  // Which way the hill is from the road's end: ahead of an exit spur, behind an entry.
  const s = out ? -1 : 1;
  const tube = road.tube ?? 14;
  // The headland it bores into: a grassy mound over the far end of the tunnel (`hillOf`).
  const mound = hillOf(road);
  if (mound) {
    mb.kind = KIND.grass;
    mb.color = lin(0x4a6e36);
    mb.lathe(mound.cx, mound.cz, mound.rings, 48);
  }
  const fx = road.tx[i] * s;
  const fz = road.tz[i] * s;
  const lx = fz;
  const lz = -fx;
  const y = road.y[i];
  const at = (along: number, lat: number): [number, number] => [road.x[i] + fx * along + lx * lat, road.z[i] + fz * along + lz * lat];
  const put = (hex: number, a0: number, a1: number, l0: number, l1: number, y0: number, y1: number, kind: number = KIND.plain): void => {
    const [x0, z0] = at(a0, l0);
    const [x1, z1] = at(a1, l1);
    mb.kind = kind;
    mb.color = lin(hex);
    mb.box((x0 + x1) / 2, (z0 + z1) / 2, y0, y1, Math.abs(x1 - x0), Math.abs(z1 - z0), kind, true);
  };
  const h = road.half + 1.5;
  // With a mate (the way out beside the way in) the one hall spans both carriageways: lat is measured from this road's
  // line, and the mate's end is where its own anchor lies in this frame.
  let lm = 0;
  if (mate) {
    const j = mate.out ? 0 : mate.x.length - 1;
    lm = (mate.x[j] - road.x[i]) * lx + (mate.z[j] - road.z[i]) * lz;
  }
  const lo = Math.min(0, lm) - h;
  const hi = Math.max(0, lm) + h;
  // The headwall and the tube behind (a long box: the mountain it bores into is far away).
  put(0x6a6a66, -tube, 0, lo, hi, y + 6.5, y + 9);
  put(0x6a6a66, -tube, 0, lo - 1.2, lo, y - 1.2, y + 9);
  put(0x6a6a66, -tube, 0, hi, hi + 1.2, y - 1.2, y + 9);
  // An earth bank over the tube's roof, the hill's colour: a flat top just over the slab, sloping down at 1:1.5 to the land on
  // both sides and running back into the hill, so the tunnel reads as bored into it. Its front is a vertical face just behind the
  // headwall's lintel, wings of earth at each side of it. (Each face is turned to the side its normal is on.)
  {
    mb.kind = KIND.grass;
    mb.color = lin(0x4a6e36);
    const yTop = y + 9.6;
    const yG = y - 1.4;
    const H = yTop - yG;
    const run = H * 1.5;
    const a0 = 0.4 - tube;
    const a1 = 14;
    const P = (along: number, lat: number, yy: number): V3 => {
      const [x, z] = at(along, lat);
      return [x, yy, z];
    };
    const face = (a: V3, b: V3, c: V3, d: V3, n: V3): void => {
      const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const dot = (u[1] * v[2] - u[2] * v[1]) * n[0] + (u[2] * v[0] - u[0] * v[2]) * n[1] + (u[0] * v[1] - u[1] * v[0]) * n[2];
      if (dot >= 0) mb.quadN(a, b, c, d, n, n, n, n);
      else mb.quadN(a, d, c, b, n, n, n, n);
    };
    const tl = lo - 1.2;
    const th = hi + 1.2;
    face(P(a0, tl, yTop), P(a1, tl, yTop), P(a1, th, yTop), P(a0, th, yTop), [0, 1, 0]);
    const nl = Math.hypot(H, run);
    for (const side of [-1, 1]) {
      const edge = side < 0 ? tl : th;
      const foot = edge + side * run;
      const n: V3 = [(side * lx * H) / nl, run / nl, (side * lz * H) / nl];
      face(P(a0, edge, yTop), P(a1, edge, yTop), P(a1, foot, yG), P(a0, foot, yG), n);
      // The wing: the slope's profile standing at the front, facing the road.
      const nf: V3 = [-fx, 0, -fz];
      face(P(a0, edge, yG), P(a0, foot, yG), P(a0, edge, yTop), P(a0, edge, yTop), nf);
    }
    face(P(a0, tl, y + 9), P(a0, th, y + 9), P(a0, th, yTop), P(a0, tl, yTop), [-fx, 0, -fz]);
  }
  // The mouth: a black back wall deep inside, and lights along the tube's walls fading into it.
  put(0x050506, 0.2, 1.2, lo, hi, y - 1.2, y + 6.5);
  for (let a = 2 - tube; a < 0; a += 3) {
    mb.kind = KIND.emit;
    mb.style = [EMIT.always, 0, 0, 0];
    for (const lat of mate ? [lo + 0.1, (lo + hi) / 2, hi - 0.1] : [lo + 0.1, hi - 0.1]) {
      const [x, z] = at(a, lat);
      mb.color = [1.6, 1.2, 0.5];
      mb.box(x, z, y + 4.6, y + 4.8, 0.6, 0.6, KIND.emit, true);
    }
    mb.style = [0, 0, 0, 0];
  }
}

/** A green gantry sign over a road near sample i: two posts, a beam, the sign (canvas) facing the traffic. */
function gantry(road: Road, i: number, lines: string[], ex: Expressway, back = 120): THREE.Group {
  const g = new THREE.Group();
  // Stand it on the deck the ramp leaves (the nearest route or loop), `back` m before the fork, facing the traffic coming.
  let loop = ex.loop;
  let best = 0;
  let bd = Infinity;
  for (const q of ex.roads) {
    if (q.kind !== 'loop' && q.kind !== 'route') continue;
    for (let k = 0; k < q.x.length; k++) {
      const d = Math.hypot(q.x[k] - road.x[i], q.z[k] - road.z[i]) + Math.abs(q.y[k] - road.y[i]) * 0.5;
      if (d < bd) [loop, best, bd] = [q, k, d];
    }
  }
  const k = loop.closed ? (best - back + loop.x.length) % loop.x.length : Math.max(0, best - back);
  const x = loop.x[k];
  const z = loop.z[k];
  const y = loop.y[k];
  const heading = Math.atan2(loop.tx[k], loop.tz[k]);
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 300;
  const cg = c.getContext('2d')!;
  cg.fillStyle = '#0e6a3a';
  cg.fillRect(0, 0, 1024, 300);
  cg.strokeStyle = '#f0f0f0';
  cg.lineWidth = 8;
  cg.strokeRect(10, 10, 1004, 280);
  cg.fillStyle = '#f4f4f0';
  cg.textAlign = 'center';
  cg.font = "bold 96px 'Yu Gothic', 'Meiryo', sans-serif";
  cg.fillText(lines[0], 512, 130);
  cg.font = 'bold 64px Consolas, sans-serif';
  cg.fillText(lines[1], 512, 240);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 2.1), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.9, 0.9, 0.9) }));
  const w = ex.def.half + 0.6;
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8e94, metalness: 0.5, roughness: 0.5 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 7.5, 0.3), steel);
    post.position.set(s * w, 3.75, 0);
    g.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 0.3, 0.4, 0.4), steel);
  beam.position.set(0, 7.4, 0);
  g.add(beam);
  // The sign over the outside (left) lane; the car travels +z in the group's frame, so it faces -z.
  sign.position.set(1.8, 6.1, -0.25);
  sign.rotation.y = Math.PI;
  g.add(sign);
  g.position.set(x, y, z);
  g.rotation.y = heading;
  return g;
}

let poolTex: THREE.CanvasTexture | null = null;
export function poolTexture(): THREE.CanvasTexture {
  if (poolTex) return poolTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  poolTex = new THREE.CanvasTexture(c);
  return poolTex;
}

/**
 * Traffic on the loop: cars in both lanes (left +1.8 m, right -1.8 m of the centre), each following the car
 * ahead in its lane with the Intelligent Driver Model, slowing for the corners ahead, and for your car when
 * it's on the deck in their lane.
 */
export class ExpresswayTraffic {
  readonly group = new THREE.Group();
  private readonly cars: { mesh: THREE.Mesh; s: number; v: number; lane: number; v0: number }[] = [];
  private readonly L: number;
  /** Curvature (rad per m) of the loop at each sample, smoothed over 30 m ahead (for slowing down). */
  private readonly bend: Float32Array;
  /**
   * How the weather has the drivers drive (main.ts from district/roadGrip.ts): their speed (1 dry; less in rain,
   * fog and snow), their gaps (longer), and the grip they trust for braking and corners.
   */
  conditions = { speed: 1, gap: 1, grip: 1 };


  constructor(
    private readonly ex: Expressway,
    city: THREE.Material,
    // (None in a city with no expressway: the stub road standing in for its loop carries nothing.)
    count = ex.roads.length === 0 ? 0 : 22,
    /** Lettering and taxi ads (none in tests). */
    signs: TrafficSigns | null = null,
  ) {
    const loop = ex.loop;
    this.L = loop.x.length;
    this.bend = new Float32Array(this.L);
    for (let i = 0; i < this.L; i++) {
      let t = 0;
      for (let k = 0; k < 40; k += 5) {
        const a = (i + k) % this.L;
        const b = (i + k + 5) % this.L;
        t = Math.max(t, Math.acos(Math.min(1, loop.tx[a] * loop.tx[b] + loop.tz[a] * loop.tz[b])) / 5);
      }
      this.bend[i] = t;
    }
    // Eight models from the city's mix (models/vehicles.ts at street detail, their lamps lit at night: the
    // loop after dark is a river of tail lights), shared round the loop.
    const models = Array.from({ length: 8 }, (_, k) => {
      const mb = new MeshBuilder();
      const sb = new SignBuilder();
      const pb = new SignBuilder();
      const { type, paint } = pickCar(CITY_CARS, 700 + k);
      addVehicle(mb, { x: 0, z: 0, fx: 0, fz: 1, type, paint, detail: 0.2, marks: 700 + k }, signs ? { sb, layout: signs.layout, photos: taxiPhotos(pb) } : undefined);
      return { body: mb.build()!, text: sb.build(0, 0), photo: pb.build(0, 0) };
    });
    for (let k = 0; k < count; k++) {
      const m = models[k % models.length];
      const mesh = new THREE.Mesh(m.body, city);
      if (signs && m.text) mesh.add(new THREE.Mesh(m.text, signs.signs));
      if (signs && m.photo) mesh.add(new THREE.Mesh(m.photo, signs.taxiAds));
      this.group.add(mesh);
      this.cars.push({ mesh, s: (this.L * k) / count, v: 18, lane: k % 2 ? -1.8 : 1.8, v0: 17 + ((k * 37) % 10) });
    }
  }

  /** Where each car is (for your car's collisions): centre, heading, half length and width. */
  get obstacles(): { x: number; z: number; dx: number; dz: number; half: number; hw: number; vx: number; vz: number }[] {
    const loop = this.ex.loop;
    return this.cars.map((c) => {
      const i = Math.floor(c.s) % this.L;
      return { x: c.mesh.position.x, z: c.mesh.position.z, dx: loop.tx[i], dz: loop.tz[i], half: 2.3, hw: 0.9, vx: loop.tx[i] * c.v, vz: loop.tz[i] * c.v };
    });
  }

  /** Clears the loop round sample i (a race's grid): the cars there move on half a lap. */
  clearAround(i: number, range = 90): void {
    const L = this.L;
    for (const c of this.cars) {
      const d = Math.abs(((c.s - i + L / 2) % L) - L / 2);
      if (d < range) c.s = (c.s + L / 2) % L;
    }
  }

  /** You on the loop: your place along it (samples), your lane offset and speed; null off it. Others: more cars they must mind (a race's rival). */
  update(dt: number, you: { i: number; lateral: number; v: number } | null, others: readonly { i: number; lateral: number; v: number }[] = []): void {
    const loop = this.ex.loop;
    const L = this.L;
    const ahead = (a: number, b: number): number => (((b - a) % L) + L) % L;
    for (const c of this.cars) {
      // The nearest thing ahead in this lane: another car, or you.
      let gap = Infinity;
      let lead = 0;
      for (const o of this.cars) {
        if (o === c || o.lane !== c.lane) continue;
        const d = ahead(c.s, o.s);
        if (d > 0 && d < gap) [gap, lead] = [d, o.v];
      }
      for (const y of you ? [you, ...others] : others) {
        if (Math.abs(y.lateral - c.lane) >= 2.2) continue;
        const d = ahead(c.s, y.i);
        if (d > 0 && d < gap) [gap, lead] = [d, Math.max(0, y.v)];
      }
      gap -= 4.6;
      // A comfortable speed for the bend ahead, and the IDM toward it and the leader.
      const b = this.bend[Math.floor(c.s) % L];
      const k = this.conditions;
      const vBend = b > 0.004 ? Math.sqrt((4.5 * k.grip) / b) : 99;
      const v0 = Math.min(c.v0 * k.speed, vBend);
      const a = 2.0;
      const bb = 3.0 * k.grip;
      const sStar = 2.5 * k.gap + Math.max(0, c.v * 1.3 * k.gap + (c.v * (c.v - lead)) / (2 * Math.sqrt(a * bb)));
      const acc = a * (1 - (c.v / Math.max(v0, 1)) ** 4 - (gap === Infinity - 4.6 ? 0 : (sStar / Math.max(gap, 0.3)) ** 2));
      c.v = Math.max(0, c.v + Math.max(-9, acc) * dt);
      c.s = (c.s + c.v * dt) % L;
      const i = Math.floor(c.s) % L;
      const j = (i + 1) % L;
      const f = c.s - Math.floor(c.s);
      const x = loop.x[i] + (loop.x[j] - loop.x[i]) * f + loop.tz[i] * c.lane;
      const z = loop.z[i] + (loop.z[j] - loop.z[i]) * f - loop.tx[i] * c.lane;
      c.mesh.position.set(x, loop.y[i], z);
      c.mesh.rotation.y = Math.atan2(loop.tx[i], loop.tz[i]);
    }
  }
}
