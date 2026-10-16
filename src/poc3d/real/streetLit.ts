import * as THREE from 'three';
import type { CityUniforms } from './city';
import { FIXTURE_LIGHTS, FIXTURES } from './fixtureLights';
import { LAMP_LIGHTS_GLSL } from './lampLights';

/**
 * Lets the street's lightmap (the pools of lamps, vending machines and shopfronts, `lightmap.ts`) fall on a loaded
 * model, as the city's own surfaces and the mob already take it: the model's standard materials get the lightmap's
 * light at each fragment's world position added to what the scene's lights give. Mack's body is lit this way in the city.
 * And the lamps of an interior with fixtures (`fixtureLights.ts`) light it too, the eight nearest, from their side:
 * a lamp beside him lights the side of him toward it.
 * Safe to call again on the same model; it chains any `onBeforeCompile` a material has (the faceless face's).
 */
export function streetLit(root: THREE.Object3D, u: Pick<CityUniforms, 'tLight' | 'uLightRect' | 'uLightFade' | 'uLightGain' | 'uCars' | 'uCarCount' | 'uHeadlights' | 'uMyCar' | 'uMyDir' | 'uMyLamps' | 'uCarSkip' | 'uBeacon' | 'uTorch' | 'uTorchDir'>): void {
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
    for (const k of ['uCars', 'uCarCount', 'uHeadlights', 'uMyCar', 'uMyDir', 'uMyLamps', 'uCarSkip', 'uBeacon', 'uTorch', 'uTorchDir'] as const) shader.uniforms[k] = u[k];
    shader.uniforms.uFx = FIXTURES.uFx;
    shader.uniforms.uFxCol = FIXTURES.uFxCol;
    shader.uniforms.uFxCount = FIXTURES.uFxCount;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStreetW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvStreetW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    // Before the face patch's own block, so a blanked face keeps its one dark tone.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vStreetW;\nuniform sampler2D tLight;\nuniform vec4 uLightRect;\nuniform vec2 uLightFade;\nuniform float uLightGain;\nuniform vec4 uFx[${FIXTURE_LIGHTS}];\nuniform vec3 uFxCol[${FIXTURE_LIGHTS}];\nuniform int uFxCount;
${LAMP_LIGHTS_GLSL}`)
      .replace(
        '#include <opaque_fragment>',
        `if (uFxCount > 0) {
          vec3 wnF = inverseTransformDirection(normalize(normal), viewMatrix);
          vec3 FX = vec3(0.0);
          for (int i = 0; i < ${FIXTURE_LIGHTS}; i++) {
            if (i >= uFxCount) break;
            vec3 dl = uFx[i].xyz - vStreetW;
            float d2 = dot(dl, dl);
            float lam = 0.35 + 0.65 * max(dot(wnF, dl * inversesqrt(d2 + 1e-4)), 0.0);
            FX += uFxCol[i] * uFx[i].w * lam / (1.0 + 0.9 * d2);
          }
          outgoingLight += diffuseColor.rgb * min(FX, vec3(1.8));
        }
        {
          // The moving lights, as the city's surfaces take them (a person is no ground: the faces toward the lamps).
          vec3 wnL = inverseTransformDirection(normalize(normal), viewMatrix);
          vec3 ML = vec3(0.0);
          if (uCarCount > 0 && uHeadlights > 0.0) ML += carLights(vStreetW, wnL, false);
          if (uMyLamps.x + uMyLamps.y + uMyLamps.z + uMyLamps.w > 0.0) ML += myLights(vStreetW, wnL, false);
          if (uBeacon.w > 0.0) ML += beaconLight(vStreetW, wnL, false);
          if (uTorch.w > 0.0) ML += torchLight(vStreetW, wnL);
          outgoingLight += diffuseColor.rgb * min(ML, vec3(2.2));
        }
        if (uLightGain > 0.0) {
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
  mat.customProgramCacheKey = () => `${key()}|streetLit3`;
  mat.needsUpdate = true;
}
