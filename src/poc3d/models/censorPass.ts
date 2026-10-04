import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Censoring Mack's face on the finished image (models/faceShadow.ts styles `mosaic` and `blur`): the body says where
 * his face is on the screen (models/firstPerson.ts `faceOnScreen`: an ellipse, turned with his head) and this pass
 * pixelates that region into square blocks, as Japanese television does, or blurs it. Last in the composer, after
 * the output and grade, so the blocks show the colours you see. Off (and skipped) whenever his face isn't to be
 * censored or isn't turned toward the camera.
 */

/** Where the face is on the screen, in pixels of the render: its centre and the ellipse's two half-axes. */
export interface FaceOnScreen {
  readonly centre: THREE.Vector2;
  readonly across: THREE.Vector2;
  readonly up: THREE.Vector2;
}

/** What tracks the face: the body (models/firstPerson.ts). */
export interface CensoredFace {
  readonly faceStyle: string;
  faceOnScreen(camera: THREE.Camera, width: number, height: number): FaceOnScreen | null;
}

const MODES: Record<string, number> = { mosaic: 1, blur: 2 };

export class CensorPass extends Pass {
  private readonly quad: FullScreenQuad;
  private readonly material: THREE.ShaderMaterial;
  private readonly size = new THREE.Vector2(1, 1);

  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uC: { value: new THREE.Vector2() },
        uA: { value: new THREE.Vector2(1, 0) },
        uB: { value: new THREE.Vector2(0, 1) },
        uMode: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 uRes, uC, uA, uB;
        uniform int uMode;
        varying vec2 vUv;
        // Where a point is in the face's ellipse (length < 1 inside).
        vec2 inFace(vec2 p) { return inverse(mat2(uA, uB)) * (p - uC); }
        void main() {
          vec2 frag = vUv * uRes;
          vec4 col = texture2D(tDiffuse, vUv);
          if (uMode == 1) {
            // Square blocks on the screen, about seven to the face's height; a block is in if its centre is, so
            // the edge goes in steps, as a broadcast mosaic's does.
            float b = max(4.0, length(uB) * 2.0 / 7.0);
            vec2 blk = (floor(frag / b) + 0.5) * b;
            if (length(inFace(blk)) < 1.0) col = texture2D(tDiffuse, blk / uRes);
          } else if (uMode == 2) {
            float r = length(inFace(frag));
            if (r < 1.15) {
              // A wide blur: rings of taps round the pixel, a fifth of the face's height across.
              float rad = length(uB) * 0.2;
              vec4 sum = col;
              float n = 1.0;
              for (int i = 0; i < 3; i++) {
                float rr = rad * (float(i) + 1.0) / 3.0;
                for (int j = 0; j < 12; j++) {
                  float a = 6.2831853 * (float(j) + 0.5 * float(i)) / 12.0;
                  sum += texture2D(tDiffuse, (frag + rr * vec2(cos(a), sin(a))) / uRes);
                  n += 1.0;
                }
              }
              col = mix(col, sum / n, smoothstep(1.15, 0.9, r));
            }
          }
          gl_FragColor = col;
        }`,
    });
    this.quad = new FullScreenQuad(this.material);
    this.enabled = false;
  }

  setSize(width: number, height: number): void {
    this.size.set(width, height);
  }

  /** Each frame, after the camera is placed for the render: whether and where to censor. */
  track(face: CensoredFace | null, camera: THREE.Camera): void {
    const mode = face ? (MODES[face.faceStyle] ?? 0) : 0;
    const at = mode && face ? face.faceOnScreen(camera, this.size.x, this.size.y) : null;
    this.enabled = !!at;
    if (!at) return;
    const u = this.material.uniforms;
    u.uMode.value = mode;
    u.uRes.value.copy(this.size);
    u.uC.value.copy(at.centre);
    u.uA.value.copy(at.across);
    u.uB.value.copy(at.up);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}
