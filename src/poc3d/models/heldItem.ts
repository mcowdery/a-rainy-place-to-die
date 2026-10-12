import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Hands, SmokeCtx } from './smoking';

/**
 * What Mack holds from his inventory (district/inventory.ts), acted in his right hand like his smoking is in his
 * left (the rig's, models/firstPerson.ts: `held`, posed after the arms, in `poseShadow`):
 *
 * - **the flashlight**: the hand comes up from his side to the chest and holds it out along the view, its head
 *   forward of the fist, a lens that lights up as it comes on;
 * - **the umbrella**: carried furled by its crook, the arm relaxed at his side when it
 *   isn't raining, and in the rain the fist comes up in front of his chest, the umbrella snaps open and stands
 *   upright over him, its rim just clear of his head.
 *
 * Putting one away or taking another lowers the hand first. Nothing here knows the inventory: the page says what's
 * wanted (`set`) and reads where the beam (`out`) and the canopy are.
 *
 * The models are Poly Pizza's, CC BY 3.0 by Poly by Google (the open one) and CC0 by CreativeTrio (the furled one):
 * `assets/props/umbrella/`, credited in CREDITS.md.
 */
export type HeldKind = 'umbrella' | 'flashlight';

export interface HeldOut {
  /** Something is in his hand and up. */
  shown: boolean;
  /** The flashlight's lens (world), the way it points, and how bright (0-1). */
  readonly tip: THREE.Vector3;
  readonly dir: THREE.Vector3;
  lit: number;
  /** The umbrella's canopy: its middle (world), how open it is (0 furled, 1 open) and its radius (m). */
  readonly canopy: THREE.Vector3;
  open: number;
  radius: number;
}

const URLS = import.meta.glob('/assets/props/umbrella/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const url = (name: string): string | undefined => Object.entries(URLS).find(([p]) => p.endsWith(`/${name}.glb`))?.[1];

/** The open umbrella is 8.43 wide and 7.21 tall as stored: scaled to a 1.5 m canopy (a big golf-style one that covers him), 1.28 m from handle to tip. */
const OPEN_DIAMETER = 1.5;
const OPEN_SCALE = OPEN_DIAMETER / 8.43;
/**
 * The open model, measured (its own units, the handle's end at 0): the hook to 0.8 (it curls toward -x), the bare
 * shaft from there, the canopy's rim at 3.98 to 4.17, its crown about 6.6, the tip 7.21. So in metres the rim is
 * 0.72 above the handle's end, and the hand holds the shaft just above the hook: the rim is then 0.54 above the fist,
 * as a real umbrella's is. (The first version took the rim for 0.45 and had the fist up at his face to clear his head.)
 */
const OPEN_CANOPY = 0.72;
const OPEN_GRIP = 0.18;
/** What of the open model is canopy (its units): above this the faces widen as it opens, below it the handle keeps its shape. */
const OPEN_SPLIT = 3.5;
/** The open model's shaft (its units): above the hook, within this of the axis, and how much thinner it's made. */
const OPEN_SHAFT = { from: 0.85, within: 0.25, thin: 0.45 } as const;
/** The furled one is 0.73 m (the tip at the origin, the shaft above its cloth, the crook at the top: its bar at y 0.70 from the shaft out to x 0.07, then down): where the fist closes on the crook. */
const CROOK = { x: 0.035, y: 0.7 } as const;
/** Where the fist closes, from the wrist (m): along the hand, and toward the palm for the torch's body and for a shaft. */
const GRIP = { along: 0.07, torch: 0.02, shaft: 0.045 } as const;
/** Fingers round a torch's body and a shaft (index to little finger: three joints each). */
const CLOSED_FIST = [[0.95, 1.2, 0.8], [1.0, 1.25, 0.85], [1.05, 1.25, 0.85], [1.1, 1.2, 0.8]] as const;

/** The thumb closing over the fingers round what he holds. */
const THUMB_ROUND = [0.9, 0.8] as const;

const ease = (k: number): number => {
  const x = THREE.MathUtils.clamp(k, 0, 1);
  return x * x * (3 - 2 * x);
};
/** Overshoots a little, as a spring-loaded umbrella snapping open does. */
const snap = (k: number): number => {
  const x = THREE.MathUtils.clamp(k, 0, 1) - 1;
  return 1 + 2.2 * x * x * x + 1.2 * x * x;
};
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

function buildFlashlight(): { root: THREE.Group; lens: THREE.Mesh } {
  const root = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a8d96, roughness: 0.35, metalness: 0.9 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x2a2b30, roughness: 0.7 });
  const tube = (r0: number, r1: number, z0: number, z1: number, m: THREE.Material): THREE.Mesh => {
    const g = new THREE.CylinderGeometry(r1, r0, z1 - z0, 14).rotateX(Math.PI / 2).translate(0, 0, (z0 + z1) / 2);
    const mesh = new THREE.Mesh(g, m);
    root.add(mesh);
    return mesh;
  };
  // About 17 cm: the grip's rubber, the body, the head flaring to the bezel, the lens set in it. Origin mid-grip.
  tube(0.0165, 0.0165, -0.075, 0.03, rubber);
  tube(0.0175, 0.0175, 0.03, 0.045, metal);
  tube(0.0175, 0.027, 0.045, 0.092, metal);
  tube(0.0275, 0.0275, 0.092, 0.098, metal);
  tube(0.0165, 0.0165, -0.088, -0.075, metal);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0235, 18), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.4, 3.2) }));
  lens.position.z = 0.0985;
  root.add(lens);
  return { root, lens };
}

export class HeldItem {
  /** World space like the smoking's: the rig adds it to its own object, which stays at the origin. */
  readonly group = new THREE.Group();
  readonly out: HeldOut = { shown: false, tip: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), lit: 0, canopy: new THREE.Vector3(), open: 0, radius: 0.5 };
  private item: HeldKind | null = null;
  private want: HeldKind | null = null;
  private wantOpen = false;
  /** How far the hand is up (0 at his side). */
  private k = 0;
  private openK = 0;
  /** The umbrella's hand: 0 at the hip with it furled, 1 up at the chest to open it. */
  private upK = 0;
  private time = 0;
  private readonly torch = buildFlashlight();
  private open: THREE.Group | null = null;
  /** The open umbrella's canopy alone (its width is what opens). */
  private canopy: THREE.Object3D | null = null;
  private closed: THREE.Group | null = null;
  private loading = false;

  constructor(private readonly hands: Hands) {
    this.group.name = 'held';
    this.torch.root.visible = false;
    this.group.add(this.torch.root);
  }

  /** What he should have in his hand, and whether the umbrella is to be open (it rains). */
  set(item: HeldKind | null, open = false): void {
    this.want = item;
    this.wantOpen = open;
    if (item === 'umbrella') this.load();
  }

  /** The right arm is this act's (so it's not free for lighting up). */
  get active(): boolean {
    return this.item !== null || this.want !== null;
  }

  takeOver(old: HeldItem): void {
    this.item = old.item;
    this.want = old.want;
    this.wantOpen = old.wantOpen;
    this.k = old.k;
    this.openK = old.openK;
    this.upK = old.upK;
    if (this.want === 'umbrella' || this.item === 'umbrella') this.load();
  }

  private load(): void {
    if (this.loading || (this.open && this.closed)) return;
    this.loading = true;
    const loader = new GLTFLoader();
    const get = (name: string): Promise<THREE.Group | null> => {
      const u = url(name);
      return u ? loader.loadAsync(u).then((g) => g.scene, () => null) : Promise.resolve(null);
    };
    void Promise.all([get('umbrella_open'), get('umbrella_closed')]).then(([open, closed]) => {
      for (const m of [open, closed]) {
        if (!m) continue;
        m.visible = false;
        m.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = false;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          mat.side = THREE.DoubleSide;
          mat.metalness = Math.min(mat.metalness, 0.2);
        });
      }
      if (open) {
        // The open one is the navy of the model's picture, darkened: the black umbrella of a noir city.
        open.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) (mesh.material as THREE.MeshStandardMaterial).color.setScalar(0.62);
        });
        // The canopy apart from the handle, so opening widens the one and leaves the other its shape.
        const whole: THREE.Mesh[] = [];
        open.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) whole.push(o as THREE.Mesh);
        });
        for (const mesh of whole) {
          const g = mesh.geometry;
          const y = g.getAttribute('position');
          const index = g.index ? Array.from(g.index.array) : Array.from({ length: y.count }, (_, i) => i);
          const low: number[] = [];
          const high: number[] = [];
          for (let i = 0; i < index.length; i += 3) {
            const tri = index.slice(i, i + 3);
            (tri.every((v) => y.getY(v) > OPEN_SPLIT) ? high : low).push(...tri);
          }
          const top = g.clone();
          top.setIndex(high);
          g.setIndex(low);
          // The shaft, thinned: scaled up to this canopy it was 3 cm through, a black bar across a first-person
          // view. (The hook below keeps its thickness, as a wooden crook is thicker than the steel it's on.)
          const pos = g.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            if (pos.getY(i) > OPEN_SHAFT.from && Math.hypot(pos.getX(i), pos.getZ(i)) < OPEN_SHAFT.within) pos.setXYZ(i, pos.getX(i) * OPEN_SHAFT.thin, pos.getY(i), pos.getZ(i) * OPEN_SHAFT.thin);
          }
          pos.needsUpdate = true;
          const cap = new THREE.Mesh(top, mesh.material);
          cap.castShadow = false;
          mesh.add(cap);
          this.canopy = cap;
        }
        this.open = open;
        this.group.add(open);
      }
      if (closed) {
        this.closed = closed;
        this.group.add(closed);
      }
      this.loading = false;
    });
  }

  /** Raises, lowers and poses the right arm (after the rig's own arms). */
  pose(c: SmokeCtx): void {
    this.time += c.dt;
    // Up or down: a change of item brings the hand down first.
    if (!c.free) this.want = null;
    // The umbrella: up from the hip to the chest and then open; shut, and then down.
    const opening = this.item === 'umbrella' && this.want === 'umbrella' && this.wantOpen && this.k >= 0.98 && this.open !== null;
    if (opening) {
      this.upK = Math.min(1, this.upK + c.dt / 0.4);
      if (this.upK >= 0.98) this.openK = Math.min(1, this.openK + c.dt / 0.4);
    } else {
      this.openK = Math.max(0, this.openK - c.dt / 0.2);
      if (this.openK <= 0.02) this.upK = Math.max(0, this.upK - c.dt / 0.4);
    }
    if (this.item !== this.want) {
      // (An open umbrella is shut before the hand goes down.)
      if (this.openK <= 0.02) this.k -= c.dt / 0.3;
      if (this.k <= 0) {
        this.k = 0;
        this.item = this.want;
        this.upK = this.openK = 0;
      }
    } else if (this.item) this.k = Math.min(1, this.k + c.dt / 0.5);
    if (!this.item || this.k <= 0.001) {
      this.out.shown = false;
      return;
    }
    const H = this.hands;
    const arm = H.arm('r');
    const usual = arm.hand.getWorldPosition(new THREE.Vector3());
    const usualF = H.frame('r');
    const fwdH = new THREE.Vector3(c.fx, 0, c.fz);
    const rightH = new THREE.Vector3(-c.fz, 0, c.fx);
    const behind = fwdH.clone().negate();
    const viewF = new THREE.Vector3(0, 0, -1).applyQuaternion(c.viewQ);
    const viewU = new THREE.Vector3(0, 1, 0).applyQuaternion(c.viewQ);
    const viewR = new THREE.Vector3(1, 0, 0).applyQuaternion(c.viewQ);
    H.reset('r');
    const S = arm.upper.getWorldPosition(new THREE.Vector3());
    const sc = c.sc;
    const at = (o: THREE.Vector3, r: THREE.Vector3, f: THREE.Vector3, u: THREE.Vector3, dr: number, df: number, du: number): THREE.Vector3 => o.clone().addScaledVector(r, dr * sc).addScaledVector(f, df * sc).addScaledVector(u, du * sc);
    const bob = c.idle ? Math.sin(this.time * 1.4) * 0.003 : Math.sin(this.time * 8.5) * 0.01;
    let wrist: THREE.Vector3;
    let frame: { fwd: THREE.Vector3; palm: THREE.Vector3 };
    let pole: THREE.Vector3;
    if (this.item === 'flashlight') {
      // Out along the view, in front of the chest: the forearm up, the palm to his left, the torch across the fist.
      wrist = at(S, viewR, viewF, viewU, -0.05, 0.4, 0.0 + bob);
      frame = { fwd: viewU.clone().addScaledVector(viewF, 0.15).normalize(), palm: viewR.clone().negate() };
      pole = new THREE.Vector3().addScaledVector(viewU, -1).addScaledVector(viewR, 0.2).addScaledVector(behind, 0.5).normalize();
    } else {
      // Furled, carried like a cane: the hand in front of the hip, the tip forward and down.
      // Furled, carried by its crook with his arm relaxed at his side (the user, 2026-10-12: "he holds umbrella
      // awkwardly when it's not raining", then "his elbow shouldn't be bent at all. he should have it relaxed at his
      // side"): the arm is the rig's own hanging, swinging arm, the umbrella hanging plumb from the fist.
      const lowW = usual.clone();
      const lowF = { fwd: usualF.fwd.clone(), palm: usualF.palm.clone() };
      const lowP = new THREE.Vector3().addScaledVector(UP, -1).addScaledVector(rightH, 0.3).addScaledVector(behind, 0.6).normalize();
      // Open in the rain, as a man holds one (the user's reference, 2026-10-12): the fist in front of his chest, a
      // hand's length under his chin and a little to his right, the arm folded with the elbow at his side, the shaft
      // upright and leaning back a little: the canopy's rim is then just over his head and he is under its middle.
      // It's the fist that is placed (the wrist follows from the hand's frame), and from his eyes, not his shoulder:
      // the shoulder drops and goes back as he looks up, and the canopy must stay over his head. In first person
      // the fist is further out to his right, so the shaft stands at the side of the view and not across it.
      const side = c.face ? 0.14 : 0.21;
      const fist = at(c.eye, rightH, fwdH, UP, side, 0.27, -0.31 + bob * 0.5);
      const want = UP.clone().multiplyScalar(0.97).addScaledVector(fwdH, -0.2).addScaledVector(rightH, c.face ? -0.1 : -0.22).normalize();
      const raw = UP.clone().multiplyScalar(0.8).addScaledVector(fwdH, 0.5);
      const along = raw.sub(want.clone().multiplyScalar(raw.dot(want))).normalize();
      const upF = { fwd: along, palm: new THREE.Vector3().crossVectors(want, along) };
      const upW = fist.addScaledVector(upF.fwd, -GRIP.along * sc).addScaledVector(upF.palm, -GRIP.shaft * sc);
      const upP = new THREE.Vector3().addScaledVector(UP, -1).addScaledVector(rightH, 0.4).addScaledVector(behind, 0.3).normalize();
      const u = ease(this.upK);
      wrist = lowW.lerp(upW, u);
      frame = { fwd: lowF.fwd.lerp(upF.fwd, u).normalize(), palm: lowF.palm.lerp(upF.palm, u).normalize() };
      pole = lowP.lerp(upP, u).normalize();
    }
    // Up from his side by an arc (the hand rises past the hip as it comes), the grip closing near the end.
    const k = ease(this.k);
    const arc = Math.sin(Math.PI * k) * 0.08 * sc;
    const to = wrist.clone().addScaledVector(UP, arc);
    const at1 = usual.clone().lerp(to, k);
    const f = { fwd: usualF.fwd.clone().lerp(frame.fwd, k).normalize(), palm: usualF.palm.clone().lerp(frame.palm, k).normalize() };
    H.reach('r', at1, pole);
    H.orient('r', f.fwd, f.palm);
    H.relax('r', 0.3 + 0.7 * ease((this.k - 0.4) / 0.5), CLOSED_FIST, THUMB_ROUND);
    this.out.shown = true;
  }

  /** Puts the thing in the hand where it now is (after the arms are posed). */
  place(c: SmokeCtx): void {
    const o = this.out;
    o.lit = 0;
    o.open = 0;
    this.torch.root.visible = false;
    if (this.open) this.open.visible = false;
    if (this.closed) this.closed.visible = false;
    if (!o.shown || !this.item) return;
    const H = this.hands;
    const hand = H.arm('r').hand.getWorldPosition(new THREE.Vector3());
    const { fwd, palm } = H.frame('r');
    const sc = c.sc;
    // Where the fingers close: past the wrist, on the palm's side; the thing's axis through the fist is the hand's
    // 'across' (index to little finger).
    const grip = hand.clone().addScaledVector(fwd, GRIP.along * sc).addScaledVector(palm, (this.item === 'flashlight' ? GRIP.torch : GRIP.shaft) * sc);
    const across = new THREE.Vector3().crossVectors(palm, fwd).normalize();
    if (this.item === 'flashlight') {
      const t = this.torch.root;
      t.visible = true;
      t.position.copy(grip);
      t.quaternion.setFromUnitVectors(Z, across);
      t.scale.setScalar(sc);
      o.lit = ease((this.k - 0.6) / 0.35);
      o.dir.copy(across);
      o.tip.copy(grip).addScaledVector(across, 0.1 * sc);
      this.torch.lens.visible = o.lit > 0.05;
      return;
    }
    const up = across.clone().negate();
    const openNow = this.openK > 0.02 && this.open;
    const model = openNow ? this.open : this.closed;
    if (!model) return;
    model.visible = true;
    const s = openNow ? OPEN_SCALE * sc : sc;
    const gripAt = OPEN_GRIP;
    model.scale.setScalar(s);
    if (!openNow) {
      // Hanging from his fist by its crook: the crook's bar (the model's +x, from the shaft out to the hook's end)
      // lies along the fist's axis, its end forward, the shaft plumb.
      const down = UP.clone().addScaledVector(new THREE.Vector3(c.fx, 0, c.fz), -0.08).normalize();
      const bar = across.clone();
      if (bar.dot(new THREE.Vector3(c.fx, 0, c.fz)) < 0) bar.negate();
      bar.addScaledVector(down, -bar.dot(down)).normalize();
      model.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(bar, down, new THREE.Vector3().crossVectors(bar, down)));
      model.position.copy(grip).addScaledVector(bar, -CROOK.x * sc).addScaledVector(down, -CROOK.y * sc);
      return;
    }
    model.position.copy(grip).addScaledVector(up, -gripAt * sc);
    if (openNow) {
      // (Its hook curls back toward him: the model's is toward -x, so its +x goes the way he faces.)
      const ahead = new THREE.Vector3(c.fx, 0, c.fz);
      ahead.addScaledVector(up, -ahead.dot(up)).normalize();
      model.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ahead, up, new THREE.Vector3().crossVectors(ahead, up)));
      // Snapping open: the canopy's width from furled to full, a little past it; the shaft and handle as they are.
      const w = THREE.MathUtils.lerp(0.14, 1, snap(this.openK));
      this.canopy?.scale.set(w, 1, w);
      o.open = ease(this.openK);
      o.canopy.copy(model.position).addScaledVector(up, OPEN_CANOPY * sc);
      o.radius = (OPEN_DIAMETER / 2) * sc * w;
    }
  }
}
