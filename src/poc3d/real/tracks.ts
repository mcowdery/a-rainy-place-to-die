import * as THREE from 'three';
import type { CityUniforms } from './city';

/**
 * Tyre tracks in the snow: a texture over a square window about the camera (SIZE m at PX px/m), wrapped round
 * (a point's texel is its world position mod SIZE), which wheels draw into as they roll: R the track, G the ground
 * height / 64 m where it was pressed (so a track on the street doesn't show on a deck above it). The city shader
 * (trackAt in city.ts) clears the snow along them and darkens them to slush. Drawn on the GPU: each frame, the
 * wheels' moves as thin quads (max blending: tracks only ever add), the strips of the window newly come into view
 * cleared (they hold tracks from SIZE m away), and while it snows the tracks fill in again (a little taken off R
 * each second). Nothing is drawn without snow; once it has all melted, the map is cleared.
 */
const SIZE = 256;
const PX = 8;
const TILE = 32;
const TILES = SIZE / TILE;
/** Tyre width (m). */
const TYRE = 0.24;
/** Most segments a frame (a wheel's move is one; near the wrap, up to four). */
const MAX = 1024;

export interface Wheel {
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

const vert = /* glsl */ `
  attribute vec4 aSeg;
  attribute vec4 aInfo;
  uniform float uSize;
  varying vec2 vVal;
  void main() {
    // aSeg: from (x, z) to (x, z), world metres; aInfo: width, R, G, and a shift (in units of the window) for
    // copies drawn across the wrap.
    vec2 a = mod(aSeg.xy, uSize);
    vec2 b = a + (aSeg.zw - aSeg.xy);
    vec2 d = b - a;
    float len = length(d);
    vec2 t = len > 1e-4 ? d / len : vec2(1.0, 0.0);
    vec2 n = vec2(-t.y, t.x);
    // position.x 0..1 along (with half a width of cap each end), position.y -0.5..0.5 across.
    vec2 p = mix(a - t * aInfo.x * 0.5, b + t * aInfo.x * 0.5, position.x) + n * position.y * aInfo.x;
    float s = floor(aInfo.w + 0.5);
    p += vec2(mod(s, 3.0) - 1.0, floor(s / 3.0) - 1.0) * uSize;
    vVal = aInfo.yz;
    gl_Position = vec4(p / uSize * 2.0 - 1.0, 0.0, 1.0);
  }`;

function segMesh(blend: Partial<THREE.ShaderMaterial>, max: number): { mesh: THREE.Mesh; seg: THREE.InstancedBufferAttribute; info: THREE.InstancedBufferAttribute; geo: THREE.InstancedBufferGeometry } {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const seg = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  const info = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  seg.setUsage(THREE.DynamicDrawUsage);
  info.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aSeg', seg);
  geo.setAttribute('aInfo', info);
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSize: { value: SIZE } },
    vertexShader: vert,
    fragmentShader: /* glsl */ `
      varying vec2 vVal;
      void main() { gl_FragColor = vec4(vVal, 0.0, 1.0); }`,
    depthTest: false,
    depthWrite: false,
    ...blend,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, seg, info, geo };
}

export class TrackMap {
  private readonly rt: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera();
  /** Strips cleared (no blending), the fill-in (R taken off), the tracks (max). */
  private readonly clear = segMesh({ blending: THREE.NoBlending }, 64);
  private readonly fill = segMesh({ blending: THREE.CustomBlending, blendEquation: THREE.ReverseSubtractEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor }, 1);
  private readonly stamp = segMesh({ blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor }, MAX);
  /** The window's corner tile. */
  private tx = NaN;
  private tz = NaN;
  private empty = true;
  private fillT = 0;
  private readonly last = new Map<unknown, Wheel[]>();
  private seen = new Set<unknown>();
  private n = 0;
  private cleared = 0;

  constructor(private readonly u: CityUniforms) {
    this.rt = new THREE.WebGLRenderTarget(SIZE * PX, SIZE * PX, { format: THREE.RGFormat, type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
    this.clear.mesh.renderOrder = 0;
    this.fill.mesh.renderOrder = 1;
    this.stamp.mesh.renderOrder = 2;
    this.scene.add(this.clear.mesh, this.fill.mesh, this.stamp.mesh);
    u.tTracks.value = this.rt.texture;
  }

  /** A strip to clear: an axis-aligned rectangle in window (wrapped) metres. */
  private clearRect(x0: number, z0: number, x1: number, z1: number): void {
    if (this.cleared >= 64) return;
    const i = this.cleared++;
    const zm = (z0 + z1) / 2;
    this.clear.seg.setXYZW(i, x0, zm, x1, zm);
    this.clear.info.setXYZW(i, z1 - z0, 0, 0, 4);
    // (The quad's caps reach half a width past each end: pull the ends in by that.)
    const w = z1 - z0;
    if (x1 - x0 > w) this.clear.seg.setXYZW(i, x0 + w / 2, zm, x1 - w / 2, zm);
    else {
      const xm = (x0 + x1) / 2;
      this.clear.seg.setXYZW(i, xm, z0 + (x1 - x0) / 2, xm, z1 - (x1 - x0) / 2);
      this.clear.info.setXYZW(i, x1 - x0, 0, 0, 4);
    }
  }

  private seg(a: Wheel, b: Wheel): void {
    const h = Math.max(0, Math.min(1, Math.max(a.y, b.y) / 64));
    const add = (shift: number): void => {
      if (this.n >= MAX) return;
      this.stamp.seg.setXYZW(this.n, a.x, a.z, b.x, b.z);
      this.stamp.info.setXYZW(this.n, TYRE, 1, h, shift);
      this.n++;
    };
    // Copies across the wrap where the segment nears the window's edge.
    const mx = ((a.x % SIZE) + SIZE) % SIZE;
    const mz = ((a.z % SIZE) + SIZE) % SIZE;
    const sx = mx < 3 ? 1 : mx > SIZE - 3 ? -1 : 0;
    const sz = mz < 3 ? 1 : mz > SIZE - 3 ? -1 : 0;
    add(4);
    if (sx) add(4 + sx);
    if (sz) add(4 + sz * 3);
    if (sx && sz) add(4 + sx + sz * 3);
  }

  /**
   * Each frame: the camera, how much snow lies (0-1), whether it's snowing, and the wheels on the ground by owner
   * (their previous places are kept by owner, so a wheel draws from where it was last frame).
   */
  update(renderer: THREE.WebGLRenderer, dt: number, camera: THREE.Vector3, snow: number, snowing: boolean, wheels: Map<unknown, Wheel[]>): void {
    const on = snow > 0.02;
    this.u.uTrackRect.value.w = on && !this.empty ? 1 : 0;
    this.n = 0;
    this.cleared = 0;
    // All melted: forget the tracks.
    if (!on) {
      this.last.clear();
      if (!this.empty) {
        this.clearRect(0, 0, SIZE, SIZE);
        this.empty = true;
        this.draw(renderer, 0);
      }
      return;
    }
    // The window follows the camera by whole tiles; the strips that come into view are cleared first.
    const tx = Math.floor(camera.x / TILE) - TILES / 2;
    const tz = Math.floor(camera.z / TILE) - TILES / 2;
    if (tx !== this.tx || tz !== this.tz) {
      const far = !Number.isFinite(this.tx) || Math.abs(tx - this.tx) >= TILES || Math.abs(tz - this.tz) >= TILES;
      if (far) this.clearRect(0, 0, SIZE, SIZE);
      else {
        const wrap = (t: number): number => (((t % TILES) + TILES) % TILES) * TILE;
        for (let c = Math.min(tx, this.tx + TILES); c < Math.max(tx + TILES, this.tx); c++) {
          if (c >= this.tx && c < this.tx + TILES) continue;
          if (c < tx || c >= tx + TILES) continue;
          const x0 = wrap(c);
          this.clearRect(x0, 0, x0 + TILE, SIZE);
        }
        for (let r = Math.min(tz, this.tz + TILES); r < Math.max(tz + TILES, this.tz); r++) {
          if (r >= this.tz && r < this.tz + TILES) continue;
          if (r < tz || r >= tz + TILES) continue;
          const z0 = wrap(r);
          this.clearRect(0, z0, SIZE, z0 + TILE);
        }
      }
      this.tx = tx;
      this.tz = tz;
      this.u.uTrackRect.value.set(tx * TILE, tz * TILE, SIZE, this.u.uTrackRect.value.w);
    }
    // The wheels' moves since last frame (not a jump: a teleport or a respawn).
    this.seen.clear();
    for (const [owner, ws] of wheels) {
      this.seen.add(owner);
      const prev = this.last.get(owner);
      if (prev && prev.length === ws.length) {
        for (let i = 0; i < ws.length; i++) {
          const d = Math.hypot(ws[i].x - prev[i].x, ws[i].z - prev[i].z);
          if (d > 0.02 && d < 4) this.seg(prev[i], ws[i]);
        }
      }
      this.last.set(owner, ws.map((w) => ({ x: w.x, z: w.z, y: w.y })));
    }
    for (const k of [...this.last.keys()]) if (!this.seen.has(k)) this.last.delete(k);
    // Fresh snow fills the tracks in over a minute or so.
    let fill = 0;
    if (snowing) {
      this.fillT += dt;
      if (this.fillT > 0.5) {
        fill = Math.min(1, (this.fillT / 70) * 1.0);
        this.fillT = 0;
      }
    }
    if (fill > 0) {
      this.fill.seg.setXYZW(0, 0.5, SIZE / 2, SIZE - 0.5, SIZE / 2);
      this.fill.info.setXYZW(0, SIZE + 1, Math.max(fill, 1.5 / 255), 0, 4);
    }
    if (this.n > 0) this.empty = false;
    this.u.uTrackRect.value.w = this.empty ? 0 : 1;
    this.draw(renderer, fill > 0 ? 1 : 0);
  }

  private draw(renderer: THREE.WebGLRenderer, fill: number): void {
    if (!this.cleared && !fill && !this.n) return;
    this.clear.geo.instanceCount = this.cleared;
    this.fill.geo.instanceCount = fill;
    this.stamp.geo.instanceCount = this.n;
    this.clear.mesh.visible = this.cleared > 0;
    this.fill.mesh.visible = fill > 0;
    this.stamp.mesh.visible = this.n > 0;
    for (const m of [this.clear, this.fill, this.stamp]) {
      m.seg.needsUpdate = true;
      m.info.needsUpdate = true;
      m.seg.clearUpdateRanges();
      m.info.clearUpdateRanges();
    }
    const n = Math.max(1, this.n);
    this.stamp.seg.addUpdateRange(0, n * 4);
    this.stamp.info.addUpdateRange(0, n * 4);
    this.clear.seg.addUpdateRange(0, Math.max(1, this.cleared) * 4);
    this.clear.info.addUpdateRange(0, Math.max(1, this.cleared) * 4);
    this.fill.seg.addUpdateRange(0, 4);
    this.fill.info.addUpdateRange(0, 4);
    const target = renderer.getRenderTarget();
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(target);
    renderer.autoClear = auto;
  }
}
