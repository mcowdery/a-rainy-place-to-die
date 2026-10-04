import * as THREE from 'three';

/**
 * The GPS in the world (district/gps.ts routes): chevrons lying on the street along the next stretch of the
 * route, a pulse running along them toward the destination, and a thin line of light standing on the
 * destination, tall enough to see over the rooftops.
 */
const MAX = 24;
const COLOR = new THREE.Color(0.35, 1.5, 1.9);

/** The beacon's radius up close (m), and its least radius as a share of the distance (about a pixel either side). */
const BEAM_R = 0.05;
const BEAM_PX = 0.0012;

export class GpsMarks {
  readonly group = new THREE.Group();
  private readonly chevrons: THREE.InstancedMesh;
  private readonly beacon: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly c = new THREE.Color();
  private time = 0;

  constructor() {
    // A flat chevron pointing along +z (drawn pointing -y, then laid down).
    const s = new THREE.Shape();
    s.moveTo(0, -0.75);
    s.lineTo(0.95, 0.2);
    s.lineTo(0.95, 0.68);
    s.lineTo(0, -0.22);
    s.lineTo(-0.95, 0.68);
    s.lineTo(-0.95, 0.2);
    s.closePath();
    const geo = new THREE.ShapeGeometry(s);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, blending: THREE.AdditiveBlending });
    this.chevrons = new THREE.InstancedMesh(geo, mat, MAX);
    this.chevrons.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.chevrons.count = 0;
    this.chevrons.frustumCulled = false;
    this.chevrons.renderOrder = 4;
    // The beacon: a thin line of light, bright at the foot fading out upward. 10 cm across up close, widened with
    // distance only enough to stay a couple of pixels wide (`BEAM_PX`), so it reads as a hairline from anywhere.
    const cv = document.createElement('canvas');
    cv.width = 4;
    cv.height = 256;
    const g = cv.getContext('2d')!;
    const grad = g.createLinearGradient(0, 256, 0, 0);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.15, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(cv);
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(BEAM_R, BEAM_R, 220, 6, 1, true).translate(0, 110, 0),
      new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.5, 1.2, 1.6), transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, blending: THREE.AdditiveBlending, fog: false }),
    );
    this.beacon.renderOrder = 4;
    this.beacon.onBeforeRender = (_r, _s, camera) => {
      const d = camera.position.distanceTo(this.beacon.position);
      const k = Math.max(1, (d * BEAM_PX) / BEAM_R);
      this.beacon.scale.set(k, 1, k);
      this.beacon.updateMatrixWorld();
    };
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.05, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, blending: THREE.AdditiveBlending }),
    );
    this.ring.renderOrder = 4;
    this.group.add(this.chevrons, this.beacon, this.ring);
    this.group.visible = false;
  }

  /**
   * Per frame: the chevrons at `ahead` (points along the route, with its heading), the beacon at the
   * destination, the floor they lie on. `dt` runs the pulse.
   */
  update(dt: number, ahead: readonly { x: number; z: number; dx: number; dz: number; y?: number }[], dest: { x: number; z: number; y?: number } | null, floor = 0): void {
    this.time += dt;
    this.group.visible = dest !== null;
    if (!dest) return;
    const n = Math.min(MAX, ahead.length);
    for (let i = 0; i < n; i++) {
      const p = ahead[i];
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(p.dx, p.dz));
      this.m.compose(new THREE.Vector3(p.x, (p.y ?? floor) + 0.06, p.z), this.q, new THREE.Vector3(1, 1, 1));
      this.chevrons.setMatrixAt(i, this.m);
      // A pulse running away from you toward the destination; the far ones fade.
      const wave = 0.55 + 0.45 * Math.max(0, Math.cos((i * 0.9 - this.time * 5) % (Math.PI * 2)));
      const fade = 1 - (i / Math.max(n, 1)) * 0.6;
      this.c.copy(COLOR).multiplyScalar(wave * fade);
      this.chevrons.setColorAt(i, this.c);
    }
    this.chevrons.count = n;
    this.chevrons.instanceMatrix.needsUpdate = true;
    if (this.chevrons.instanceColor) this.chevrons.instanceColor.needsUpdate = true;
    this.beacon.position.set(dest.x, dest.y ?? floor, dest.z);
    this.ring.position.set(dest.x, (dest.y ?? floor) + 0.07, dest.z);
    const s = 1 + 0.12 * Math.sin(this.time * 3);
    this.ring.scale.set(s, 1, s);
  }
}
