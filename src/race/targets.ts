import * as THREE from 'three';
import type { Course, TargetDef } from './course';

/**
 * The shooting targets of a venue (the course's `targets`): paper bullseye boards on a frame, steel plates
 * hanging from a post, and boards sliding along a rail. Each face has its own canvas, so hits are painted
 * into it (paint splats in the ball's colour, bullet holes) and move with the target. A board struck by a
 * bullet falls back on its hinge and stands up again; paint only rocks it. Plates swing and ring.
 */

/** Points for a hit on a board, by ring: (x, y) metres from the bullseye's centre. */
export function ringPoints(x: number, y: number): number {
  const r = Math.hypot(x, y);
  return r < 0.1 ? 10 : r < 0.25 ? 5 : r < 0.42 ? 2 : 1;
}

const BOARD_W = 1.0;
const BOARD_H = 1.2;
const PLATE_R = 0.25;
/** Board canvases: pixels per metre. */
const PX = 256;

export interface Target {
  readonly def: TargetDef;
  readonly kind: TargetDef['kind'];
  readonly root: THREE.Group;
  /** The hinge: the bottom edge of a board (it falls back about it), the top of a plate's hanger. */
  readonly flap: THREE.Group;
  readonly face: THREE.Mesh;
  readonly ctx: CanvasRenderingContext2D;
  readonly tex: THREE.CanvasTexture;
  /** Board: 0 standing, 1 flat on its back; seconds left down. */
  fall: number;
  downFor: number;
  falling: boolean;
  /** Spring: a plate's swing, a board's rocking (rad) and its rate. */
  swing: number;
  swingV: number;
  /** Mover: seconds along its rail. */
  t: number;
}

export interface TargetHit {
  readonly target: Target;
  readonly point: THREE.Vector3;
  readonly normal: THREE.Vector3;
  /** On the face: metres from its centre (x right, y up as you look at it), and the face's uv. */
  readonly local: THREE.Vector2;
  readonly uv: THREE.Vector2;
  readonly distance: number;
}

export class Targets {
  readonly group = new THREE.Group();
  readonly list: Target[] = [];
  private readonly ray = new THREE.Raycaster();

  constructor(course: Course) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.9 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.6, roughness: 0.5 });
    const rail = new THREE.MeshStandardMaterial({ color: 0x8a8e94, metalness: 0.5, roughness: 0.4 });
    for (const def of course.def.targets ?? []) {
      const plate = def.kind === 'plate';
      const h = def.h ?? (plate ? 1.2 : 1.4);
      const root = new THREE.Group();
      root.position.set(def.at[0], 0, def.at[1]);
      root.rotation.y = (def.face * Math.PI) / 180;
      const flap = new THREE.Group();
      root.add(flap);
      const canvas = document.createElement('canvas');
      canvas.width = plate ? 128 : BOARD_W * PX;
      canvas.height = plate ? 128 : BOARD_H * PX;
      const ctx = canvas.getContext('2d')!;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      // Lit by the floodlights, and a little self-lit so they read at night (like a range's reflective paper).
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: plate ? 0.05 : 0.18, roughness: 0.85 });
      let face: THREE.Mesh;
      if (plate) {
        // A post with an arm; the plate hangs from the arm's end on a hinge.
        const top = h + PLATE_R + 0.12;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, top + 0.1, 0.08).translate(0, (top + 0.1) / 2, -0.35), steel);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.4).translate(0, top + 0.07, -0.17), steel);
        root.add(post, arm);
        flap.position.set(0, top, 0);
        face = new THREE.Mesh(new THREE.CircleGeometry(PLATE_R, 40).translate(0, -(PLATE_R + 0.12), 0.02), mat);
        const back = new THREE.Mesh(new THREE.CylinderGeometry(PLATE_R, PLATE_R, 0.02, 40).rotateX(Math.PI / 2).translate(0, -(PLATE_R + 0.12), 0), steel);
        const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.02).translate(0, -0.07, 0), steel);
        flap.add(back, hanger, face);
      } else {
        // Two legs up to the board's bottom edge, the hinge; the board stands on it.
        const base = h - BOARD_H / 2;
        for (const s of [-1, 1]) root.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, base + 0.1, 0.06).translate(s * 0.42, (base + 0.1) / 2, -0.04), wood));
        flap.position.set(0, base, 0);
        face = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_H).translate(0, BOARD_H / 2, 0.012), mat);
        const back = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W + 0.04, BOARD_H + 0.04, 0.02).translate(0, BOARD_H / 2, 0), wood);
        flap.add(back, face);
        if (def.kind === 'mover') {
          // Its rail: a low track between the two ends (in world space, so it doesn't ride along).
          const [ax, az] = def.at;
          const [bx, bz] = def.to!;
          const len = Math.hypot(bx - ax, bz - az);
          const track = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, len + 1.2), rail);
          track.position.set((ax + bx) / 2, 0.04, (az + bz) / 2);
          track.rotation.y = Math.atan2(bx - ax, bz - az);
          this.group.add(track);
          const sled = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.5).translate(0, 0.1, 0), steel);
          root.add(sled);
        }
      }
      const t: Target = { def, kind: def.kind, root, flap, face, ctx, tex, fall: 0, downFor: 0, falling: false, swing: 0, swingV: 0, t: 0 };
      this.clean(t);
      this.list.push(t);
      this.group.add(root);
    }
    this.update(0);
  }

  /** Fresh paper (or paint) on a target. */
  clean(t: Target): void {
    const g = t.ctx;
    const W = g.canvas.width;
    const H = g.canvas.height;
    if (t.kind === 'plate') {
      g.fillStyle = '#2a2c30';
      g.fillRect(0, 0, W, H);
      // Painted steel, orange as on a steel-challenge range, with a lighter centre spot.
      g.fillStyle = '#a24c22';
      g.beginPath();
      g.arc(W / 2, H / 2, W / 2 - 3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#c08058';
      g.beginPath();
      g.arc(W / 2, H / 2, W / 7, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = '#e9e4d4';
      g.fillRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      const m = PX;
      // The scoring rings: 2 (to 0.42 m), 5 (black, to 0.25 m), 10 (the white centre, to 0.1 m).
      g.strokeStyle = '#1a1a1a';
      g.lineWidth = 2;
      for (const r of [0.42, 0.34]) {
        g.beginPath();
        g.arc(cx, cy, r * m, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = '#161616';
      g.beginPath();
      g.arc(cx, cy, 0.25 * m, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#e9e4d4';
      g.beginPath();
      g.arc(cx, cy, 0.175 * m, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#e9e4d4';
      g.beginPath();
      g.arc(cx, cy, 0.1 * m, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#161616';
      g.beginPath();
      g.moveTo(cx - 8, cy);
      g.lineTo(cx + 8, cy);
      g.moveTo(cx, cy - 8);
      g.lineTo(cx, cy + 8);
      g.stroke();
      g.fillStyle = '#8a2a20';
      g.font = 'bold 20px sans-serif';
      g.textAlign = 'center';
      g.fillText('10', cx, cy - 0.12 * m);
      g.fillText('5', cx, cy - 0.28 * m);
      g.fillText('2', cx, cy - 0.37 * m);
      // Range marks in the corners.
      g.font = '15px sans-serif';
      g.fillStyle = '#6a6458';
      g.fillText('黒神射撃場', cx, H - 14);
    }
    t.tex.needsUpdate = true;
  }

  cleanAll(): void {
    for (const t of this.list) {
      this.clean(t);
      t.fall = 0;
      t.falling = false;
      t.downFor = 0;
    }
  }

  /** Animate: movers slide, boards fall and stand again, plates and boards swing on their springs. */
  update(dt: number): void {
    for (const t of this.list) {
      if (t.kind === 'mover') {
        const [ax, az] = t.def.at;
        const [bx, bz] = t.def.to!;
        const len = Math.hypot(bx - ax, bz - az);
        t.t += dt;
        const s = (t.t * t.def.speed!) / len;
        const k = s % 2 < 1 ? s % 1 : 1 - (s % 1);
        const e = k * k * (3 - 2 * k) * 0.3 + k * 0.7;
        t.root.position.set(ax + (bx - ax) * e, 0, az + (bz - az) * e);
      }
      if (t.falling) {
        t.fall = Math.min(1, t.fall + dt * (1.5 + t.fall * 8));
        if (t.fall >= 1) {
          t.falling = false;
          t.downFor = 3;
          t.swingV = -1.5;
        }
      } else if (t.downFor > 0) {
        t.downFor -= dt;
      } else if (t.fall > 0) {
        t.fall = Math.max(0, t.fall - dt * 1.8);
      }
      const plate = t.kind === 'plate';
      const k = plate ? 30 : 140;
      const c = plate ? 1.1 : 9;
      t.swingV += (-k * t.swing - c * t.swingV) * dt;
      t.swing += t.swingV * dt;
      if (!plate) t.swing = Math.max(-0.08, Math.min(0.3, t.swing));
      t.flap.rotation.x = -(t.fall * t.fall * Math.PI) / 2 - t.swing;
      if (plate) t.flap.rotation.x = t.swing;
    }
    this.group.updateMatrixWorld(true);
  }

  /** The nearest standing target face along a ray (within far), or null. */
  cast(origin: THREE.Vector3, dir: THREE.Vector3, far: number): TargetHit | null {
    this.ray.set(origin, dir);
    this.ray.far = far;
    const faces = this.list.filter((t) => t.fall < 0.5).map((t) => t.face);
    const hit = this.ray.intersectObjects(faces, false)[0];
    if (!hit || !hit.uv) return null;
    const target = this.list.find((t) => t.face === hit.object)!;
    const local = hit.object.worldToLocal(hit.point.clone());
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(hit.object.matrixWorld);
    // Boards: from the bullseye (the plane's centre is BOARD_H / 2 above its hinge); plates: from their centre.
    const centreY = target.kind === 'plate' ? -(PLATE_R + 0.12) : BOARD_H / 2;
    return { target, point: hit.point.clone(), normal, local: new THREE.Vector2(local.x, local.y - centreY), uv: hit.uv.clone(), distance: hit.distance };
  }

  /** Where a target's face centre is now (for aim assist). */
  centre(t: Target, out: THREE.Vector3): THREE.Vector3 {
    const y = t.kind === 'plate' ? -(PLATE_R + 0.12) : BOARD_H / 2;
    return t.face.localToWorld(out.set(0, y, 0));
  }

  /**
   * A hit lands: paint or a hole on the face, and the target reacts (a bullet knocks a board down and swings a
   * plate hard; paint rocks a board and nudges a plate). Returns the points it scores (before multipliers).
   */
  hit(h: TargetHit, kind: 'bullet' | 'paint', color?: THREE.Color): number {
    const t = h.target;
    const g = t.ctx;
    const W = g.canvas.width;
    const H = g.canvas.height;
    const px = h.uv.x * W;
    const py = (1 - h.uv.y) * H;
    const perM = t.kind === 'plate' ? W / (PLATE_R * 2) : PX;
    if (kind === 'paint') {
      splat(g, px, py, perM, color ?? new THREE.Color(1, 0.2, 0.6));
      if (t.kind === 'plate') t.swingV += 1.2;
      else t.swingV += 1.6;
    } else if (t.kind === 'plate') {
      // Lead splashed on the paint.
      g.fillStyle = '#8a8c90';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const r = (i % 2 ? 0.012 : 0.03) * perM;
        g.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r);
      }
      g.fill();
      t.swingV += 4;
    } else {
      // A hole through the paper, torn a little.
      g.fillStyle = '#c8c0ac';
      g.beginPath();
      g.arc(px, py, 0.012 * perM, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#0a0a0a';
      g.beginPath();
      g.arc(px, py, 0.007 * perM, 0, Math.PI * 2);
      g.fill();
      t.falling = true;
    }
    t.tex.needsUpdate = true;
    return t.kind === 'plate' ? 5 : ringPoints(h.local.x, h.local.y);
  }
}

/** A paintball's splat: a blob, droplets thrown round it, and a few runs. */
export function splat(g: CanvasRenderingContext2D, x: number, y: number, perM: number, c: THREE.Color): void {
  const css = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
  g.fillStyle = css;
  const R = 0.05 * perM * (0.8 + Math.random() * 0.4);
  g.beginPath();
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = R * (0.75 + Math.random() * 0.5);
    if (i === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.fill();
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = R * (1.2 + Math.random() * 1.6);
    g.beginPath();
    g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, R * (0.08 + Math.random() * 0.16), 0, Math.PI * 2);
    g.fill();
  }
  // Runs, dripping down.
  for (let i = 0; i < 3; i++) {
    const dx = (Math.random() - 0.5) * R * 1.2;
    const len = R * (0.6 + Math.random() * 1.8);
    g.fillRect(x + dx - R * 0.07, y, R * 0.14, len);
  }
}
