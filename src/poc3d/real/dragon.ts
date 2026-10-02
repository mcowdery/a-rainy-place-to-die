import * as THREE from 'three';
import type { CityUniforms } from './city';
import { KIND, lin, type MeshBuilder } from './meshBuilder';

/**
 * The Kaburo dragon: a giant neon-tube sculpture coiled one and a half times around the mega-sign's roof,
 * rising into a neck that leans out over the crossing, the head chasing a glowing pearl.
 *
 * Built like a real neon sculpture: the body is a wireframe of glass tubes (scarlet side rails, crimson
 * dorsal and belly lines, lighter red hoops every couple of metres, gold dorsal spikes), with legs, a head drawn in
 * outline (jaws, brow, glowing eyes, forked horns, mane, long whiskers) and a pearl. Dark steel pylons hold
 * it off the roof. A pulse travels along the tubes from tail to head; by day the tubes are dim glass.
 *
 * Coordinates are local to the roof: origin at the roof centre, y up, the corner the dragon faces along
 * `corner` (a unit vector in x/z).
 */

type V3 = [number, number, number];

// The great red dragon of Revelation 12: red all over, its rails a bright scarlet, its dorsal and belly lines,
// legs and whiskers a deeper crimson, the hoops a lighter red; gold stays for the spikes, horns and claws.
const RED: V3 = [1.0, 0.0, 0.02];
const RED_LIGHT: V3 = [1.0, 0.1, 0.08];
const CRIMSON: V3 = [0.7, 0.0, 0.05];
const GOLD: V3 = [1.0, 0.68, 0.22];
const EYE: V3 = [1.0, 0.95, 0.7];
const PEARL: V3 = [1.0, 0.88, 0.95];

class Tubes {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  s: number[] = [];
  idx: number[] = [];

  private vert(p: THREE.Vector3, n: THREE.Vector3, c: V3, s: number, gain: number): void {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(c[0] * gain, c[1] * gain, c[2] * gain);
    this.s.push(s);
  }

  /**
   * A tube along a smooth curve through pts. radius may vary along it (t = 0..1); s0..s1 is the pulse
   * position (0 tail .. 1 head; >= 1 means steady, no pulse).
   */
  tube(pts: readonly V3[], radius: number | ((t: number) => number), color: V3, gain: number, s0: number, s1: number, closed = false, radial = 6): void {
    if (pts.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), closed, 'centripetal');
    const n = Math.max(6, Math.round(curve.getLength() / 0.35));
    const frames = curve.computeFrenetFrames(n, closed);
    const base = this.pos.length / 3;
    const p = new THREE.Vector3();
    const nv = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      curve.getPointAt(t, p);
      const r = typeof radius === 'number' ? radius : radius(t);
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        nv.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
        this.vert(p.clone().addScaledVector(nv, r), nv, color, s0 + (s1 - s0) * t, gain);
      }
    }
    const row = radial + 1;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < radial; j++) {
        const a = base + i * row + j;
        const b = a + row;
        this.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  sphere(c: V3, r: number, color: V3, gain: number): void {
    const g = new THREE.SphereGeometry(r, 14, 10);
    const base = this.pos.length / 3;
    const pa = g.getAttribute('position');
    const na = g.getAttribute('normal');
    const p = new THREE.Vector3();
    const nv = new THREE.Vector3();
    for (let i = 0; i < pa.count; i++) {
      p.fromBufferAttribute(pa, i).add(new THREE.Vector3(...c));
      nv.fromBufferAttribute(na, i);
      this.vert(p, nv, color, 1.0, gain);
    }
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i++) this.idx.push(base + ix.getX(i));
    g.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(this.s, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Neon-tube material: HDR colour with a pulse travelling along aS, brighter where the tube faces the eye. */
export function neonMaterial(u: CityUniforms): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uNeon: { value: 1 } }]),
    fog: true,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute vec3 aCol;
      attribute float aS;
      varying vec3 vCol;
      varying float vS;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vCol = aCol;
        vS = aS;
        vN = normalize(normalMatrix * normal);
        vV = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform float uNeon;
      varying vec3 vCol;
      varying float vS;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float wave = pow(0.5 + 0.5 * sin(vS * 60.0 - uTime * 3.2), 10.0);
        float glow = vS < 0.999 ? 0.6 + 1.0 * wave : 1.1;
        float ndv = abs(dot(normalize(vN), normalize(vV)));
        float core = 0.45 + 0.55 * pow(ndv, 0.6);
        vec3 lit = vCol * glow * core;
        vec3 day = vCol * 0.1 * (0.5 + 0.5 * ndv) + 0.04;
        gl_FragColor = vec4(mix(day, lit, uNeon), 1.0);
        #include <fog_fragment>
      }`,
  });
  // merge() clones uniforms: re-attach the city's shared ones so time and day/night reach the tubes.
  m.uniforms.uTime = u.uTime;
  m.uniforms.uNeon = u.uNeon;
  return m;
}

/**
 * Builds the dragon for a roof with half-size `half`, returning the neon geometry; steel pylons go into mb
 * (city material). corner: unit x/z direction of the corner the head overhangs.
 */
export function buildDragon(mb: MeshBuilder, half: number, corner: readonly [number, number]): { geometry: THREE.BufferGeometry; head: THREE.Vector3 } {
  const T = new Tubes();
  const cornerA = Math.atan2(corner[1], corner[0]);
  const R = half * 0.82;

  // Spine: 1.5 turns around the roof, rising and undulating, ending at the corner; then the neck.
  const spine: THREE.Vector3[] = [];
  const turns = 36;
  const start = cornerA - Math.PI * 3;
  for (let k = 0; k <= turns; k++) {
    const u = k / turns;
    const a = start + u * Math.PI * 3;
    const rad = R + half * 0.09 * Math.sin(u * Math.PI * 6);
    const y = 1.3 + u * 7.5 + 1.3 * Math.sin(u * Math.PI * 9);
    spine.push(new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad));
  }
  const dc = new THREE.Vector3(corner[0], 0, corner[1]);
  const neckEnd = spine[spine.length - 1].clone();
  // The neck rises in an S: back over the roof, then out over the corner, turning so the head
  // looks along one street and shows its profile to the crossing on the diagonal.
  const dt = new THREE.Vector3(-corner[1], 0, corner[0]);
  for (const [r, t, y] of [[R + 0.8, 0, neckEnd.y + 2.8], [R - 1.6, -0.6, neckEnd.y + 6.2], [R + 0.6, -0.4, neckEnd.y + 9.0], [R + 3.8, 1.2, neckEnd.y + 10.2], [R + 5.6, 3.4, neckEnd.y + 9.8]] as const) {
    spine.push(dc.clone().multiplyScalar(r).addScaledVector(dt, t).setY(y));
  }
  const curve = new THREE.CatmullRomCurve3(spine, false, 'centripetal');
  const bodyR = (t: number): number => (t < 0.2 ? 0.22 + (t / 0.2) * 1.1 : t > 0.9 ? 1.32 - ((t - 0.9) / 0.1) * 0.32 : 1.32);

  // Sample the spine with a horizontal side vector (stable, unlike Frenet frames on a coil).
  const N = 480;
  const up = new THREE.Vector3(0, 1, 0);
  const samples = Array.from({ length: N + 1 }, (_, i) => {
    const t = i / N;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const side = new THREE.Vector3().crossVectors(up, tan).normalize();
    const u = new THREE.Vector3().crossVectors(tan, side).normalize();
    return { t, p, tan, side, u, r: bodyR(t) };
  });
  const rail = (f: (s: (typeof samples)[number]) => THREE.Vector3): V3[] => samples.filter((_, i) => i % 4 === 0).map((s) => f(s).toArray() as V3);
  T.tube(rail((s) => s.p.clone().addScaledVector(s.side, s.r)), 0.15, RED, 3.2, 0, 1);
  T.tube(rail((s) => s.p.clone().addScaledVector(s.side, -s.r)), 0.15, RED, 3.2, 0, 1);
  T.tube(rail((s) => s.p.clone().addScaledVector(s.u, s.r * 0.9)), 0.1, CRIMSON, 3.0, 0, 1);
  T.tube(rail((s) => s.p.clone().addScaledVector(s.u, -s.r * 0.8)), 0.1, CRIMSON, 2.6, 0, 1);

  // Hoops every ~1.8 m, dorsal spikes, pylons.
  const len = curve.getLength();
  const hoops = Math.floor(len / 1.8);
  for (let h = 1; h < hoops; h++) {
    const s = samples[Math.round((h / hoops) * N)];
    const ring: V3[] = [];
    for (let j = 0; j < 12; j++) {
      const a = (j / 12) * Math.PI * 2;
      ring.push(s.p.clone().addScaledVector(s.side, Math.cos(a) * s.r).addScaledVector(s.u, Math.sin(a) * s.r * 0.88).toArray() as V3);
    }
    T.tube(ring, 0.06, RED_LIGHT, 2.4, s.t, s.t, true, 5);
    if (h % 2 === 0 && s.t > 0.08) {
      const base = s.p.clone().addScaledVector(s.u, s.r * 0.9);
      const tip = base.clone().addScaledVector(s.u, s.r * 0.9).addScaledVector(s.tan, -0.6);
      const back = base.clone().addScaledVector(s.tan, -1.4);
      T.tube([base.toArray() as V3, tip.toArray() as V3, back.toArray() as V3], 0.07, GOLD, 3.0, s.t, s.t);
    }
    if (h % 3 === 0 && s.t < 0.86) {
      const belly = s.p.clone().addScaledVector(s.u, -s.r * 0.8);
      mb.kind = KIND.plain;
      mb.color = lin(0x1c1e22);
      mb.style = [0, 0, 0, 0];
      mb.beam([belly.x, -0.2, belly.z], [belly.x, belly.y, belly.z], 0.18);
    }
  }

  // Legs, each with three claws, reaching out and down from the outer side.
  for (const t of [0.28, 0.44, 0.6, 0.74]) {
    const s = samples[Math.round(t * N)];
    const out = s.side.clone().multiplyScalar(Math.sign(s.side.dot(new THREE.Vector3(s.p.x, 0, s.p.z))) || 1);
    const hip = s.p.clone().addScaledVector(out, s.r);
    const knee = hip.clone().addScaledVector(out, 1.1).add(new THREE.Vector3(0, 0.7, 0)).addScaledVector(s.tan, 0.6);
    const foot = hip.clone().addScaledVector(out, 2.1).add(new THREE.Vector3(0, -Math.min(hip.y - 0.5, 1.8), 0)).addScaledVector(s.tan, 1.0);
    T.tube([hip, knee, foot].map((v) => v.toArray() as V3), 0.11, CRIMSON, 3.0, t, t);
    for (const k of [-1, 0, 1]) {
      const toe = foot.clone().addScaledVector(s.tan, 0.7).addScaledVector(out, 0.35 * k).add(new THREE.Vector3(0, -0.25, 0));
      const tip = toe.clone().addScaledVector(s.tan, 0.35).add(new THREE.Vector3(0, -0.3, 0));
      T.tube([foot, toe, tip].map((v) => v.toArray() as V3), 0.07, GOLD, 3.0, t, t);
    }
  }

  // Head: outline drawn in a head frame at the neck's end, leaning forward and down over the crossing.
  const end = samples[N];
  const F = end.tan.clone().setY(end.tan.y * 0.2 - 0.18).normalize();
  const S = new THREE.Vector3().crossVectors(up, F).normalize();
  const U = new THREE.Vector3().crossVectors(F, S).normalize();
  // Head outline in head units, scaled up so it reads from the street (the body is ~2.6 m thick).
  const HS = 1.7;
  const H = (f: number, u: number, s: number): V3 => end.p.clone().addScaledVector(F, f * HS).addScaledVector(U, u * HS).addScaledVector(S, s * HS).toArray() as V3;
  const head = (pts: [number, number, number][], r: number, c: V3, gain = 3.4): void => T.tube(pts.map(([f, u, s]) => H(f, u, s)), r * 1.4, c, gain, 1, 1);
  for (const sd of [-1, 1]) {
    head([[0, 0.9, 0.75 * sd], [1.5, 1.05, 0.65 * sd], [3.0, 0.75, 0.48 * sd], [4.2, 0.55, 0.3 * sd], [4.6, 0.35, 0]], 0.13, RED);
    head([[0, -0.55, 0.65 * sd], [1.8, -0.95, 0.52 * sd], [3.5, -1.35, 0.3 * sd], [3.9, -1.45, 0]], 0.12, RED);
    head([[0.4, 1.2, 0.85 * sd], [1.5, 1.5, 0.75 * sd], [2.4, 1.15, 0.58 * sd]], 0.1, GOLD);
    head([[4.0, 0.7, 0.3 * sd], [4.3, 0.95, 0.42 * sd], [4.1, 1.05, 0.25 * sd]], 0.07, CRIMSON);
    // Teeth.
    for (const f of [1.6, 2.4, 3.2]) head([[f, 0.6, 0.5 * sd], [f + 0.2, 0.25, 0.45 * sd], [f + 0.4, 0.6, 0.42 * sd]], 0.05, [1, 1, 1], 2.6);
    // Forked horns sweeping back.
    head([[0.3, 1.3, 0.55 * sd], [-0.8, 2.2, 0.85 * sd], [-2.2, 3.0, 1.05 * sd], [-3.4, 3.25, 1.25 * sd]], 0.11, GOLD);
    head([[-1.4, 2.6, 0.95 * sd], [-1.7, 3.3, 0.95 * sd], [-2.1, 3.7, 0.9 * sd]], 0.08, GOLD);
    // Long flowing whiskers.
    head([[4.0, 0.35, 0.4 * sd], [3.4, 0.1, 1.2 * sd], [2.0, -0.7, 2.4 * sd], [0.2, -0.4, 3.2 * sd], [-1.8, -1.4, 3.8 * sd], [-3.2, -0.7, 4.4 * sd]], 0.07, CRIMSON, 3.2);
    // Mane.
    for (let m = 0; m < 4; m++) head([[-0.2 - m * 0.5, 0.9 - m * 0.3, 0.45 * sd], [-1.2 - m * 0.5, 1.7 - m * 0.4, 1.0 * sd], [-1.9 - m * 0.5, 1.4 - m * 0.4, 1.3 * sd]], 0.07, CRIMSON, 3.0);
    T.sphere(H(1.55, 1.0, 0.72 * sd), 0.36, EYE, 7);
  }
  // The pearl the dragon chases, with swirling flames.
  const pearl = H(6.4, -0.3, 0);
  T.sphere(pearl, 1.0, PEARL, 5);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    head(
      [0, 0.25, 0.5, 0.75, 1].map((q) => [6.4 + Math.cos(a + q * 4) * (0.9 - q * 0.3), -0.3 + q * 1.4, Math.sin(a + q * 4) * (0.9 - q * 0.3)] as [number, number, number]),
      0.05,
      GOLD,
      3.2,
    );
  }
  return { geometry: T.build(), head: new THREE.Vector3(...H(2.2, 0.4, 0)) };
}
