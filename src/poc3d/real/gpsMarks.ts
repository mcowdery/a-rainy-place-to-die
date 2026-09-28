import * as THREE from 'three';

/**
 * The GPS in the world (district/gps.ts routes): chevrons lying on the street along the next stretch of the
 * route, a pulse running along them toward the destination, and a column of light standing on the
 * destination, tall enough to see over the rooftops.
 */
const MAX = 24;
const COLOR = new THREE.Color(0.35, 1.5, 1.9);

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
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.chevrons = new THREE.InstancedMesh(geo, mat, MAX);
    this.chevrons.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.chevrons.count = 0;
    this.chevrons.frustumCulled = false;
    this.chevrons.renderOrder = 4;
    // The beacon: an open cylinder, bright at the foot fading out upward.
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
      new THREE.CylinderGeometry(1.1, 1.1, 220, 20, 1, true).translate(0, 110, 0),
      new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.5, 1.2, 1.6), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }),
    );
    this.beacon.renderOrder = 4;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 2.7, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    this.ring.renderOrder = 4;
    this.group.add(this.chevrons, this.beacon, this.ring);
    this.group.visible = false;
  }

  /**
   * Per frame: the chevrons at `ahead` (points along the route, with its heading), the beacon at the
   * destination, the floor they lie on. `dt` runs the pulse.
   */
  update(dt: number, ahead: readonly { x: number; z: number; dx: number; dz: number }[], dest: { x: number; z: number } | null, floor = 0): void {
    this.time += dt;
    this.group.visible = dest !== null;
    if (!dest) return;
    const n = Math.min(MAX, ahead.length);
    for (let i = 0; i < n; i++) {
      const p = ahead[i];
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(p.dx, p.dz));
      this.m.compose(new THREE.Vector3(p.x, floor + 0.06, p.z), this.q, new THREE.Vector3(1, 1, 1));
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
    this.beacon.position.set(dest.x, floor, dest.z);
    this.ring.position.set(dest.x, floor + 0.07, dest.z);
    const s = 1 + 0.12 * Math.sin(this.time * 3);
    this.ring.scale.set(s, 1, s);
  }
}
