import * as THREE from 'three';

/**
 * Faceless characters: the player's (Mack) is never seen in the face. Third person keeps the camera behind him,
 * and this is the backstop for any angle that comes round (a profile, a cinematic). How the face is hidden is a
 * style, under review (`FaceStyle`; the rig adds what isn't in the skin: the bar, the helmet):
 *
 * - `shadow`: the front of the face one flat dark tone, his hair's colour in shadow, no shading at all, a faint
 *   rim only along the silhouette of the cheeks and jaw where they face sideways;
 * - `brim`: a soft shadow falling from the brow, as under a hat brim: darkest over the eyes, easing toward the
 *   chin;
 * - `none`: his face as modelled (for review: sunglasses on a bare face);
 * - `mosaic`: Japanese censorship's pixel mosaic over the face on the finished image, square blocks on the screen;
 * - `blur`: the face blurred on the finished image (both by models/censorPass.ts, where the body says the face is);
 * - `smooth`: the features smoothed away to a blank, mannequin face (the face's vertices onto an ellipsoid, the
 *   eyes, brows and lashes sunk behind it) in one even skin tone;
 * - `chrome`: the same blank face as a mirrored faceplate;
 * - `bar` and `robo`: the face as modelled under a black censor bar over the eyes, or RoboCop's helmet with its
 *   visor (models/firstPerson.ts `setFaceStyle`).
 *
 * A patch on the skin, eyes, brows and lashes' materials: a mask from where each vertex is at rest (in front of the
 * ears, from under the chin to the hairline), the style a shared uniform (no recompiles when it changes).
 */

/** The characters whose faces stay hidden (file names under assets/characters/), with every outfit of theirs
 * (`mack_suit_black`...: models/wardrobe.ts). */
export const FACELESS: ReadonlySet<string> = new Set(['mack']);

/** Whether a model's face stays hidden: a faceless character's, or one of their outfits. */
export const isFaceless = (model: string): boolean => FACELESS.has(model) || [...FACELESS].some((n) => model.startsWith(`${n}_`));

export type FaceStyle = 'shadow' | 'brim' | 'none' | 'mosaic' | 'blur' | 'smooth' | 'chrome' | 'bar' | 'robo';
export const FACE_STYLES: readonly FaceStyle[] = ['shadow', 'brim', 'none', 'mosaic', 'blur', 'smooth', 'chrome', 'bar', 'robo'];
export const FACE_STYLE_LABELS: Record<FaceStyle, string> = {
  shadow: 'shadow',
  brim: 'brim shadow',
  none: 'bare face',
  mosaic: 'mosaic',
  blur: 'blur',
  smooth: 'smoothed (mannequin)',
  chrome: 'chrome faceplate',
  bar: 'censor bar',
  robo: 'RoboCop helmet',
};

/** The shader's mode for each style (the bar and the helmet show the face as modelled). */
const MODE: Record<FaceStyle, number> = { none: 0, shadow: 1, brim: 2, mosaic: 0, blur: 0, smooth: 5, chrome: 6, bar: 0, robo: 0 };

/** How much of the face is hidden (1 fully, 0 off), and the style's mode, for every faceless model at once. */
export const FACE_SHADOW = { value: 1 };
const FACE_MODE = { value: MODE.shadow };

/** Sets the style in the skin (models/firstPerson.ts `setFaceStyle` also puts on the bar or the helmet). */
export function setFaceMode(style: FaceStyle): void {
  FACE_MODE.value = MODE[style];
}

/** The materials the mask goes on: skin, eyes, brows, lashes (MPFB's names). */
const FACE_MATERIALS = /\.body$|eyebrow|eyelash|high-poly/i;

/**
 * The face's extent from the eyes (metres, at rest): in front of the plane `fwd` behind them, between `chin`
 * below and `brow` above, each edge eased over `soft`.
 */
const FACE = { back: -0.085, chin: -0.155, brow: 0.14, soft: 0.025 };

/** The face's tone (linear): his hair's colour (#16130f) in shadow. */
const FACE_TONE = new THREE.Color(0x16130f).multiplyScalar(0.45);

/** The blank face's ellipsoid round the head's centre (metres: across, up, forward), and that centre from the eyes. */
const BLANK = { radii: [0.074, 0.112, 0.1], back: 0.065, down: 0.01 };

/**
 * The skin's typical colour (linear), for the blank face: the median of the skin texture's mid-toned pixels (not
 * the dark scalp under the hair, not the brightest highlights). A blurred texture won't do there: its smallest
 * mips mix in the neighbouring parts of the atlas, lips and scalp.
 */
function skinTone(mat: THREE.MeshStandardMaterial): THREE.Color {
  const out = new THREE.Color(0.55, 0.42, 0.36);
  const img = mat.map?.image as CanvasImageSource | undefined;
  if (!img) return out;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, 48, 48);
    const d = g.getImageData(0, 0, 48, 48).data;
    const px: [number, number, number, number][] = [];
    for (let i = 0; i < d.length; i += 4) {
      const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      if (l > 0.3 && l < 0.85) px.push([l, d[i], d[i + 1], d[i + 2]]);
    }
    if (px.length === 0) return out;
    px.sort((a, b) => a[0] - b[0]);
    const m = px[px.length >> 1];
    return out.setRGB(m[1] / 255, m[2] / 255, m[3] / 255, THREE.SRGBColorSpace);
  } catch {
    return out;
  }
}

/** Patches a freshly loaded model's face materials (once: they're shared by every clone of it). */
export function shadowFace(model: THREE.Object3D): void {
  model.updateMatrixWorld(true);
  let eyes: THREE.Vector3 | null = null;
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (eyes || !m.isMesh || !/high-poly/i.test(m.name)) return;
    m.geometry.computeBoundingBox();
    eyes = m.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(m.matrixWorld);
  });
  if (!eyes) return;
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (!FACE_MATERIALS.test(mat.name) || mat.userData.faceShadow) continue;
      // The figure faces +z with +y up; the mask works in the mesh's own (bind) frame, as `position` is.
      const inv = m.matrixWorld.clone().invert();
      const at = { eye: (eyes as THREE.Vector3).clone().applyMatrix4(inv), fwd: new THREE.Vector3(0, 0, 1).transformDirection(inv), up: new THREE.Vector3(0, 1, 0).transformDirection(inv) };
      // Only the skin takes the rim and stays on the blank face; eyes, brows and lashes sink behind it.
      patch(mat as THREE.MeshStandardMaterial, /\.body$/i.test(mat.name), at);
    }
  });
}

const fx = (x: number): string => x.toFixed(3);

/** GLSL: the face's mask from `position` (float `faceMask`), and where the blank face moves it (vec3 `faceTarget`,
 * float `faceK`), its normal there (vec3 `faceEN`). */
function blankShape(skin: boolean): string {
  const [rx, ry, rz] = BLANK.radii.map(fx);
  return `
    vec3 faceRight = cross(uFaceUp, uFaceFwd);
    vec3 faceTarget = position;
    vec3 faceEN = vec3(0.0, 1.0, 0.0);
    float faceMask, faceY;
    {
      vec3 fd = position - uFaceEye;
      float ff = dot(fd, uFaceFwd);
      faceY = dot(fd, uFaceUp);
      faceMask = smoothstep(${fx(FACE.back - FACE.soft)}, ${fx(FACE.back)}, ff)
        * smoothstep(${fx(FACE.chin - FACE.soft)}, ${fx(FACE.chin)}, faceY)
        * (1.0 - smoothstep(${fx(FACE.brow)}, ${fx(FACE.brow + FACE.soft)}, faceY));
      vec3 c = uFaceEye - uFaceFwd * ${fx(BLANK.back)} - uFaceUp * ${fx(BLANK.down)};
      vec3 r = position - c;
      vec3 q = vec3(dot(r, faceRight), dot(r, uFaceUp), dot(r, uFaceFwd));
      vec3 rad = vec3(${rx}, ${ry}, ${rz});
      vec3 qs = q / max(length(q / rad), 1e-4);
      vec3 en = normalize(q / (rad * rad));
      faceEN = faceRight * en.x + uFaceUp * en.y + uFaceFwd * en.z;
      faceTarget = ${skin ? 'c + faceRight * qs.x + uFaceUp * qs.y + uFaceFwd * qs.z' : 'c + r * 0.85'};
    }
    float faceK = (uFaceMode == 5 || uFaceMode == 6) ? faceMask : 0.0;`;
}

/**
 * The shadow pass's material for the face's meshes, with the blank face's shape: without it the face as modelled casts its
 * shadow (the nose, the brows) onto the smoothed face. A clone loses `customDepthMaterial`, so models/characters.ts
 * gives every copy it (`faceDepth`), found by the skin's material (kept out of `userData`, which clones copy as JSON).
 */
const DEPTH = new WeakMap<THREE.Material, THREE.MeshDepthMaterial>();
function depthMaterial(at: { eye: THREE.Vector3; fwd: THREE.Vector3; up: THREE.Vector3 }, skin: boolean): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFaceEye = { value: at.eye };
    shader.uniforms.uFaceFwd = { value: at.fwd };
    shader.uniforms.uFaceUp = { value: at.up };
    shader.uniforms.uFaceMode = FACE_MODE;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uFaceEye;\nuniform vec3 uFaceFwd;\nuniform vec3 uFaceUp;\nuniform int uFaceMode;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${blankShape(skin)}\ntransformed = mix(transformed, faceTarget, faceK);`);
  };
  m.customProgramCacheKey = () => `faceDepth${skin ? 'Skin' : ''}`;
  return m;
}

/** Gives a copy of a faceless model its skin's shadow-pass material (a clone doesn't keep it). */
export function faceDepth(model: THREE.Object3D): void {
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const d = DEPTH.get(m.material as THREE.Material);
    if (d) m.customDepthMaterial = d;
  });
}

function patch(mat: THREE.MeshStandardMaterial, skin: boolean, at: { eye: THREE.Vector3; fwd: THREE.Vector3; up: THREE.Vector3 }): void {
  DEPTH.set(mat, depthMaterial(at, skin));
  mat.userData.faceShadow = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uFaceEye = { value: at.eye };
    shader.uniforms.uFaceFwd = { value: at.fwd };
    shader.uniforms.uFaceUp = { value: at.up };
    shader.uniforms.uFaceShadow = FACE_SHADOW;
    shader.uniforms.uFaceMode = FACE_MODE;
    shader.uniforms.uFaceTone = { value: FACE_TONE };
    shader.uniforms.uFaceSkin = { value: skin ? skinTone(mat) : new THREE.Color(0, 0, 0) };
    const decl = 'uniform int uFaceMode;\nvarying float vFace;\nvarying float vFaceSide;\nvarying float vFaceY;';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uFaceEye;\nuniform vec3 uFaceFwd;\nuniform vec3 uFaceUp;\n${decl}`)
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        // The blank face: onto an ellipsoid round the head's centre (the eyes, brows and lashes sunk behind it),
        // its normals the ellipsoid's.
        ${blankShape(skin)}
        vFace = faceMask;
        vFaceY = faceY;
        // Where the rim may show: surfaces facing sideways (the cheeks and jaw), not the features or under them.
        vFaceSide = ${skin ? '1.0' : '0.0'} * smoothstep(0.6, 0.92, abs(dot(normalize(objectNormal), faceRight)));
        objectNormal = normalize(mix(objectNormal, faceEN, faceK));`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = mix(transformed, faceTarget, faceK);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uFaceShadow;\nuniform vec3 uFaceTone;\nuniform vec3 uFaceSkin;\n${decl}`)
      .replace(
        '#include <clipping_planes_fragment>',
        // The blank face: the inside of the mouth and the eye sockets land on it too, turned inside out; drop them.
        '#include <clipping_planes_fragment>\nif ((uFaceMode == 5 || uFaceMode == 6) && vFace > 0.3 && !gl_FrontFacing) discard;',
      )
      .replace(
        '#include <map_fragment>',
        THREE.ShaderChunk.map_fragment
          // The blank face (and the chrome under its mirror): one even skin tone.
          .replace('diffuseColor *= sampledDiffuseColor;', 'if (uFaceMode == 5 || uFaceMode == 6) sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, uFaceSkin, vFace);\n\tdiffuseColor *= sampledDiffuseColor;'),
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          float faceRim = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 5.0) * vFaceSide;
          if (uFaceMode == 1) {
            // One flat tone (no shading, so no features); a trace of the light grazing the cheeks and jaw.
            outgoingLight = mix(outgoingLight, uFaceTone + outgoingLight * 0.25 * faceRim, vFace * uFaceShadow);
          } else if (uFaceMode == 2) {
            // Under a brim: darkest over the eyes and brow, easing off toward the chin.
            float k = mix(0.42, 0.04, smoothstep(-0.13, -0.025, vFaceY));
            outgoingLight *= mix(1.0, k, vFace * uFaceShadow);
          } else if (uFaceMode == 6) {
            // Chrome: what the blank face mirrors, a dark sky, a bright horizon, dark ground; brighter at the edges.
            vec3 rv = inverseTransformDirection(reflect(-normalize(vViewPosition), normalize(normal)), viewMatrix);
            float y = rv.y;
            vec3 env = mix(vec3(0.02, 0.02, 0.025), vec3(0.18, 0.21, 0.26), smoothstep(-0.05, 0.7, y));
            env += vec3(0.9, 0.93, 1.0) * exp(-pow((y - 0.03) / 0.05, 2.0));
            float fres = 0.55 + 0.45 * pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 3.0);
            outgoingLight = mix(outgoingLight, env * fres + outgoingLight * 0.15, vFace * uFaceShadow);
          }
        }
        #include <opaque_fragment>`,
      );
  };
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${key()}|faceStyle${skin ? 'Skin' : ''}`;
  mat.needsUpdate = true;
}
