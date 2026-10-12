import * as THREE from 'three';
import type { CityUniforms } from './city';

/**
 * Lets the street's lightmap (the pools of lamps, vending machines and shopfronts, `lightmap.ts`) fall on a loaded
 * model, as the city's own surfaces and the mob already take it: the model's standard materials get the lightmap's
 * light at each fragment's world position added to what the scene's lights give. Mack's body is lit this way in the city.
 * Safe to call again on the same model; it chains any `onBeforeCompile` a material has (the faceless face's).
 */
export function streetLit(root: THREE.Object3D, u: Pick<CityUniforms, 'tLight' | 'uLightRect' | 'uLightFade' | 'uLightGain'>): void {
  const done = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (done.has(mat) || mat.userData.streetLit || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;
      done.add(mat);
      patch(mat as THREE.MeshStandardMaterial, u);
    }
  });
}

function patch(mat: THREE.MeshStandardMaterial, u: Parameters<typeof streetLit>[1]): void {
  mat.userData.streetLit = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    shader.uniforms.tLight = u.tLight;
    shader.uniforms.uLightRect = u.uLightRect;
    shader.uniforms.uLightFade = u.uLightFade;
    shader.uniforms.uLightGain = u.uLightGain;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStreetW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvStreetW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    // Before the face patch's own block, so a blanked face keeps its one dark tone.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStreetW;\nuniform sampler2D tLight;\nuniform vec4 uLightRect;\nuniform vec2 uLightFade;\nuniform float uLightGain;')
      .replace(
        '#include <opaque_fragment>',
        `if (uLightGain > 0.0) {
          vec3 L = texture2D(tLight, (vStreetW.xz - uLightRect.xy) * uLightRect.zw).rgb * uLightGain;
          if (uLightFade.y > 0.0) {
            vec2 dc = abs(vStreetW.xz - cameraPosition.xz);
            L *= 1.0 - smoothstep(uLightFade.x, uLightFade.y, max(dc.x, dc.y));
          }
          // As the mob takes it: capped, so under the brightest pools he's lit, not pale.
          vec3 wn = inverseTransformDirection(normalize(normal), viewMatrix);
          outgoingLight += diffuseColor.rgb * min(L, vec3(2.2)) * (0.5 + 0.5 * max(wn.y, 0.0));
        }
        #include <opaque_fragment>`,
      );
    prev.call(mat, shader, renderer);
  };
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${key()}|streetLit`;
  mat.needsUpdate = true;
}
