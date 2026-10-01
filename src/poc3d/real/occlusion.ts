import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

/** A box to test: an id (a chunk's key) and its bounds in world space. */
export interface OcclusionBox {
  readonly key: number;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly z0: number;
  readonly z1: number;
}

/**
 * Occlusion culling for the streamed chunks: at street level most of a block's neighbours are behind the first
 * row of buildings. Each frame the scene's depth (the overlay pass hands it over) is reduced to a quarter size,
 * each texel keeping the farthest depth of its 4x4 block (so the reduction can only err towards "visible"), and
 * every candidate's bounding box is drawn against it inside a GPU occlusion query (no depth writes). Results come back a frame or two later; a box hidden in two results in a row is reported occluded,
 * any sample passing clears it at once, and a box the camera is in, or with no result yet, is never occluded.
 * Callers swap occluded chunks to their building masses rather than hiding them, so a late answer shows plain
 * masses for a frame, never a hole.
 */
export class Occlusion {
  /** Keys of the boxes currently judged hidden. */
  readonly occluded = new Set<number>();
  private readonly target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, type: THREE.UnsignedByteType });
  private readonly down: FullScreenQuad;
  private readonly downMat: THREE.ShaderMaterial;
  private readonly proxies = new THREE.Scene();
  private readonly geo = new THREE.BoxGeometry(1, 1, 1);
  // Colour is written (into this throwaway target): a draw that writes nothing can be skipped by the driver, and
  // then its query counts no samples at all.
  private readonly mat = new THREE.MeshBasicMaterial({ depthWrite: false });
  private readonly state = new Map<number, { mesh: THREE.Mesh; query: WebGLQuery | null; misses: number }>();
  enabled = true;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.downMat = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform highp sampler2D tDepth;
        void main() {
          ivec2 size = textureSize(tDepth, 0);
          ivec2 base = ivec2(gl_FragCoord.xy) * 4;
          float d = 0.0;
          // Texel centres through texture2D (texelFetch on a depth texture reads 0 under ANGLE / D3D11).
          vec2 inv = 1.0 / vec2(size);
          for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) d = max(d, texture2D(tDepth, (vec2(min(base + ivec2(x, y), size - 1)) + 0.5) * inv).r);
          gl_FragDepth = d;
          gl_FragColor = vec4(0.0);
        }`,
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
      colorWrite: false,
    });
    this.down = new FullScreenQuad(this.downMat);
  }

  /**
   * A composer pass that takes the scene's depth down to the test target while it's valid (after the ASCII
   * overlay, which hands it over; once the frame is done, three's multisampled target no longer holds it).
   */
  readonly pass: Pass = (() => {
    const self = this;
    const p = new (class extends Pass {
      render(renderer: THREE.WebGLRenderer): void {
        self.reduced = false;
        const depth = self.depthSource();
        if (!self.enabled || !depth) return;
        const img = depth.image as { width: number; height: number };
        const w = Math.max(1, Math.ceil(img.width / 4));
        const h = Math.max(1, Math.ceil(img.height / 4));
        if (self.target.width !== w || self.target.height !== h) self.target.setSize(w, h);
        const prev = renderer.getRenderTarget();
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.setRenderTarget(self.target);
        self.downMat.uniforms.tDepth.value = depth;
        self.down.render(renderer);
        renderer.setRenderTarget(prev);
        renderer.autoClear = autoClear;
        self.reduced = true;
      }
    })();
    p.needsSwap = false;
    return p;
  })();
  private reduced = false;
  /** Where the pass gets the scene's depth from (set by the page). */
  depthSource: () => THREE.Texture | null = () => null;

  /**
   * Tests the boxes against this frame's reduced depth (call after the frame is rendered) and updates `occluded`
   * from whatever earlier results have come back. `active` false (below ground) clears it.
   */
  update(active: boolean, camera: THREE.Camera, boxes: readonly OcclusionBox[]): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    this.collect(gl);
    if (!this.enabled || !active || !this.reduced) {
      this.occluded.clear();
      return;
    }
    const cam = camera.position;
    const keep = new Set<number>();
    for (const b of boxes) {
      keep.add(b.key);
      let s = this.state.get(b.key);
      if (!s) {
        const mesh = new THREE.Mesh(this.geo, this.mat);
        mesh.matrixAutoUpdate = false;
        // One query round each box's draw (a box three culls, off screen, starts none).
        mesh.onBeforeRender = () => {
          s!.query = gl.createQuery();
          gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, s!.query);
        };
        mesh.onAfterRender = () => gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
        s = { mesh, query: null, misses: 0 };
        this.state.set(b.key, s);
        this.proxies.add(mesh);
      }
      const inside = cam.x > b.x0 - 2 && cam.x < b.x1 + 2 && cam.z > b.z0 - 2 && cam.z < b.z1 + 2 && cam.y < b.y1 + 2;
      // Only boxes without a query in flight are drawn (a query can't be restarted before its result is read).
      s.mesh.visible = !inside && s.query === null;
      if (inside) {
        s.misses = 0;
        this.occluded.delete(b.key);
      }
      s.mesh.matrix.makeScale(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0).setPosition((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
      s.mesh.matrixWorld.copy(s.mesh.matrix);
    }
    // Forget boxes no longer offered (their chunks unloaded or out of the detail range).
    for (const [key, s] of this.state) {
      if (keep.has(key)) continue;
      if (s.query) gl.deleteQuery(s.query);
      this.proxies.remove(s.mesh);
      this.state.delete(key);
      this.occluded.delete(key);
    }
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const autoClear = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.target);
    r.render(this.proxies, camera);
    r.setRenderTarget(prev);
    r.autoClear = autoClear;
  }

  /** Reads back finished queries: any sample visible clears a box; two hidden results in a row hide it. */
  private collect(gl: WebGL2RenderingContext): void {
    for (const [key, s] of this.state) {
      if (!s.query || !gl.getQueryParameter(s.query, gl.QUERY_RESULT_AVAILABLE)) continue;
      const seen = gl.getQueryParameter(s.query, gl.QUERY_RESULT) as number;
      gl.deleteQuery(s.query);
      s.query = null;
      if (seen) {
        s.misses = 0;
        this.occluded.delete(key);
      } else if (++s.misses >= 2) this.occluded.add(key);
    }
  }

  dispose(): void {
    this.target.dispose();
    this.geo.dispose();
    this.mat.dispose();
    this.downMat.dispose();
  }
}
