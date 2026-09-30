import * as THREE from 'three';
import type { Course } from './course';
import { addSky, type VenueScene } from './scene';

/**
 * A street circuit's scenery (a course of kind circuit; Manila Bay): the city's streets closed for the race.
 * - The track: tarmac, white edge lines, red and white kerbs on the corners, the chequered start line and the
 *   grid's boxes, the start gantry with its five red lights (`startLights`).
 * - Concrete barriers both sides with the sponsors' boards along them (invented brands) and catch fencing above.
 * - The city round it: blocks of buildings (their windows drawn by the shader from where they are: lit warm as
 *   the sun goes down), taller toward the business district inland; jeepneys parked in the side streets.
 * - The boulevard: palms along the promenade, the sea wall and the bay (the sea and the setting sun: scene.ts
 *   addSky), a grandstand facing the pits, the pit garages on the paddock, street lamps.
 */

const TARMAC = new THREE.Color(0x34343a);

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** A canvas texture. */
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** The sponsors along the barriers (invented). */
const SPONSORS: readonly [string, string, string][] = [
  ['BAYSIDE COLA', '#c8102e', '#ffffff'],
  ['MABUHAY TELECOM', '#0a3a8a', '#ffd23a'],
  ['LUZON AIR', '#ffffff', '#0a5ab0'],
  ['KALAYAAN OIL', '#1a7a3a', '#ffffff'],
  ['PASIG MOTORS', '#111111', '#ff8a1a'],
  ['TŌKAI RACING', '#e8e8e8', '#c81818'],
  ['SAMPAGUITA BANK', '#5a1a7a', '#ffffff'],
  ['ISLA TYRES', '#ffd000', '#111111'],
];

export function buildCircuit(course: Course): VenueScene {
  const group = new THREE.Group();
  const n = course.x.length;
  const half = course.half;
  const rail = course.rail;
  const def = course.def;
  const shore = def.sea?.shore ?? 1e9;
  const L = (i: number, d: number, up = 0): THREE.Vector3 => {
    const k = course.wrap(i);
    return new THREE.Vector3(course.x[k] + course.tz[k] * d, course.y[k] + up, course.z[k] - course.tx[k] * d);
  };
  // The bend at each sample (signed: + left), for kerbs.
  const bend = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = course.wrap(i - 6);
    const b = course.wrap(i + 6);
    bend[i] = course.tz[a] * course.tx[b] - course.tx[a] * course.tz[b];
  }

  // ---- The ground: the city's concrete out to the shore, the paddock a shade darker.
  const b = course.bounds;
  const M = 500;
  const gw = b.maxX - b.minX + 2 * M;
  const gd = Math.min(shore, b.maxZ + M) - (b.minZ - M);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gd).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4a4644, roughness: 0.95 }));
  ground.position.set((b.minX + b.maxX) / 2, -0.04, b.minZ - M + gd / 2);
  ground.receiveShadow = true;
  group.add(ground);
  const lot = def.lot;
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(lot.w, lot.h).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.9 }));
  pad.position.set(lot.x + lot.w / 2, -0.02, lot.z + lot.h / 2);
  pad.receiveShadow = true;
  group.add(pad);

  // ---- The track: a closed ribbon (strips across it at every sample, joined back to the start).
  const ribbon = (offsets: readonly number[], lift: number, color?: (i: number, q: number) => THREE.Color, v?: (i: number) => number): THREE.BufferGeometry => {
    const p: number[] = [];
    const cc: number[] = [];
    const uv: number[] = [];
    const ix: number[] = [];
    const m = offsets.length;
    for (let i = 0; i <= n; i++) {
      for (let q = 0; q < m; q++) {
        const pt = L(i, offsets[q], lift);
        p.push(pt.x, pt.y, pt.z);
        const c = color ? color(i % n, q) : TARMAC;
        cc.push(c.r, c.g, c.b);
        uv.push(q / (m - 1), v ? v(i) : i);
      }
      if (i > 0) for (let q = 0; q + 1 < m; q++) {
        const a = (i - 1) * m + q;
        const d = i * m + q;
        ix.push(a, a + 1, d, a + 1, d + 1, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(ix);
    g.computeVertexNormals();
    return g;
  };
  const road = new THREE.Mesh(ribbon([rail + 0.3, half, -half, -rail - 0.3], 0.01), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
  road.receiveShadow = true;
  group.add(road);
  const paint = (hex: number): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, emissive: hex, emissiveIntensity: 0.05, side: THREE.DoubleSide });
  for (const s of [1, -1]) group.add(new THREE.Mesh(ribbon([s * (half - 0.25), s * (half - 0.45)], 0.02), paint(0xe8e8e0)));
  // Kerbs: red and white in 1.5 m stripes on both edges wherever it bends.
  {
    const p: number[] = [];
    const cc: number[] = [];
    const red = new THREE.Color(0xc81818);
    const wht = new THREE.Color(0xeeeeee);
    for (let i = 0; i < n; i++) {
      if (Math.abs(bend[i]) < 0.1) continue;
      for (const s of [1, -1]) {
        const c = Math.floor(i / 1.5) % 2 ? red : wht;
        const a0 = L(i, s * (half + 0.05), 0.03);
        const a1 = L(i, s * (half + 1.25), 0.05);
        const b0 = L(i + 1, s * (half + 0.05), 0.03);
        const b1 = L(i + 1, s * (half + 1.25), 0.05);
        for (const v of [a0, a1, b0, a1, b1, b0]) {
          p.push(v.x, v.y, v.z);
          cc.push(c.r, c.g, c.b);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide })));
  }
  // The start line (chequered) and the grid's boxes.
  const start = course.wrap(Math.round(def.circuit?.start ?? 0));
  {
    const tex = canvasTex(256, 32, (g) => {
      for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
        g.fillRect(x * 16, y * 16, 16, 16);
      }
    }, false);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 1.2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    const c = L(start, 0, 0.025);
    line.position.copy(c);
    line.rotation.y = Math.atan2(course.tx[start], course.tz[start]) + Math.PI / 2;
    group.add(line);
    const boxMat = paint(0xe8e8e0);
    for (let k = 0; k < 6; k++) {
      const i = course.wrap(start - 10 - Math.floor(k / 2) * 8 - (k % 2) * 4);
      const lane = k % 2 === 0 ? 2.6 : -2.6;
      const bx = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.15).rotateX(-Math.PI / 2), boxMat);
      bx.position.copy(L(i + 3, lane, 0.025));
      bx.rotation.y = Math.atan2(course.tx[i], course.tz[i]) + Math.PI / 2;
      group.add(bx);
    }
  }

  // ---- Concrete barriers (jersey-shaped) both sides, the sponsors' boards on their faces, catch fencing above.
  {
    const p: number[] = [];
    const ix: number[] = [];
    // The profile, from the track side out: (offset out from the rail, height).
    const prof: [number, number][] = [[0, 0], [0.02, 0.28], [0.22, 0.95], [0.38, 0.95], [0.58, 0.28], [0.6, 0]];
    for (const s of [1, -1]) {
      const base = p.length / 3;
      for (let i = 0; i <= n; i += 2) {
        for (const [o, h] of prof) {
          const v = L(i, s * (rail + o), h);
          p.push(v.x, v.y, v.z);
        }
      }
      const m = prof.length;
      const rows = Math.floor(n / 2) + 1;
      for (let r = 1; r < rows; r++) {
        for (let q = 0; q + 1 < m; q++) {
          const a = base + (r - 1) * m + q;
          const d = base + r * m + q;
          if (s > 0) ix.push(a, d, a + 1, a + 1, d, d + 1);
          else ix.push(a, a + 1, d, a + 1, d + 1, d);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setIndex(ix);
    g.computeVertexNormals();
    const wall = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xb8b4ac, roughness: 0.9, side: THREE.DoubleSide }));
    wall.castShadow = wall.receiveShadow = true;
    group.add(wall);
    // The boards: every sponsor's name in turn along a long strip, on the barrier's track face.
    const BOARD = 12;
    const tex = canvasTex(256 * SPONSORS.length, 64, (g) => {
      SPONSORS.forEach(([name, bg, fg], k) => {
        g.fillStyle = bg;
        g.fillRect(k * 256, 0, 256, 64);
        g.fillStyle = fg;
        g.font = 'bold 34px Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(name, k * 256 + 128, 33, 240);
      });
    });
    tex.wrapT = THREE.ClampToEdgeWrapping;
    const boardMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 });
    for (const s of [1, -1]) {
      const q: number[] = [];
      const uv: number[] = [];
      const qi: number[] = [];
      for (let i = 0; i <= n; i += 2) {
        const lo = L(i, s * (rail + 0.015), 0.18);
        const hi = L(i, s * (rail + 0.13), 0.78);
        q.push(lo.x, lo.y, lo.z, hi.x, hi.y, hi.z);
        const u = i / (BOARD * SPONSORS.length);
        uv.push(u, 0, u, 1);
        if (i > 0) {
          const a = (i / 2 - 1) * 2;
          qi.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(q, 3));
      bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      bg.setIndex(qi);
      bg.computeVertexNormals();
      group.add(new THREE.Mesh(bg, boardMat));
    }
    // Catch fencing: a haze of mesh on posts above the barriers.
    const mesh = canvasTex(64, 64, (g) => {
      g.strokeStyle = 'rgba(70,74,78,1)';
      g.lineWidth = 1.2;
      for (let k = -64; k < 128; k += 12) {
        g.beginPath();
        g.moveTo(k, 0);
        g.lineTo(k + 64, 64);
        g.moveTo(k + 64, 0);
        g.lineTo(k, 64);
        g.stroke();
      }
    });
    const fenceMat = new THREE.MeshStandardMaterial({ map: mesh, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 });
    const postGeo = new THREE.BoxGeometry(0.08, 3.4, 0.08).translate(0, 1.7 + 0.95, 0);
    const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x5a5e62, metalness: 0.5, roughness: 0.5 }), Math.ceil(n / 6) * 2 + 2);
    const m4 = new THREE.Matrix4();
    let pc = 0;
    for (const s of [1, -1]) {
      const q: number[] = [];
      const uv: number[] = [];
      const qi: number[] = [];
      for (let i = 0; i <= n; i += 2) {
        const lo = L(i, s * (rail + 0.3), 0.95);
        const hi = L(i, s * (rail + 0.3), 4.2);
        q.push(lo.x, lo.y, lo.z, hi.x, hi.y, hi.z);
        uv.push(i / 1.2, 0, i / 1.2, 4.2);
        if (i > 0) {
          const a = (i / 2 - 1) * 2;
          qi.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
        if (i % 6 === 0 && pc < posts.count) posts.setMatrixAt(pc++, m4.makeTranslation(lo.x, 0, lo.z));
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(q, 3));
      fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      fg.setIndex(qi);
      fg.computeVertexNormals();
      group.add(new THREE.Mesh(fg, fenceMat));
    }
    posts.count = pc;
    group.add(posts);
  }

  // ---- The start gantry: posts beyond the barriers, a beam over the track, five red lights.
  const lights: THREE.MeshStandardMaterial[] = [];
  {
    const i = course.wrap(start - 3);
    const gant = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.5, roughness: 0.5 });
    for (const s of [1, -1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 0.4), steel);
      post.position.set(s * (rail + 1.2), 3.5, 0);
      gant.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * (rail + 1.4), 1.2, 0.8), steel);
    beam.position.set(0, 6.6, 0);
    gant.add(beam);
    for (let k = 0; k < 5; k++) {
      const m = new THREE.MeshStandardMaterial({ color: 0x220404, emissive: 0xff1a10, emissiveIntensity: 0 });
      lights.push(m);
      const pod = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), m);
      pod.position.set((k - 2) * 0.9, 6.6, -0.41);
      pod.rotation.y = Math.PI;
      gant.add(pod);
    }
    const c = L(i, 0);
    gant.position.set(c.x, 0, c.z);
    gant.rotation.y = Math.atan2(course.tx[i], course.tz[i]) + Math.PI;
    group.add(gant);
  }
  const startLights = (lit: number): void => lights.forEach((m, k) => (m.emissiveIntensity = k < lit ? 3.2 : 0));

  // ---- The city: blocks of buildings off the track, taller inland (the business district to the north), their
  // windows from the shader (floors of 3.4 m, bays of 3 m; lit at random, warm, as the sun goes down).
  const nearTrack = (x: number, z: number, m: number): boolean => {
    const nr = course.nearest(x, z);
    return nr.i >= 0 && Math.abs(nr.d) < rail + m;
  };
  {
    const r = rng(11);
    const spots: { x: number; z: number; w: number; d: number; h: number; hue: number }[] = [];
    const G = 26;
    for (let z = b.minZ - M + 20; z < shore - 30; z += G) {
      for (let x = b.minX - M + 20; x < b.maxX + M - 20; x += G) {
        const jx = x + (r() - 0.5) * 6;
        const jz = z + (r() - 0.5) * 6;
        const w = 12 + r() * 10;
        const d = 12 + r() * 10;
        // Off the track (a street's width from its barrier), the paddock and the grandstand's promenade.
        if (nearTrack(jx, jz, 10 + Math.max(w, d) / 2)) continue;
        if (jx > lot.x - 20 && jx < lot.x + lot.w + 20 && jz > lot.z - 20 && jz < lot.z + lot.h + 20) continue;
        if (r() < 0.12) continue;
        // Inland is the business district: towers.
        const inland = Math.max(0, -jz - 250) / 400;
        const h = 9 + r() * 18 + (r() < 0.25 + inland * 0.5 ? 20 + r() * 60 * (0.4 + inland) : 0);
        spots.push({ x: jx, z: jz, w, d, h, hue: r() });
      }
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWP;
          varying vec3 vWN;
          float hsh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          // Windows on the walls (not the roofs): a grid by floor and bay; some lit.
          if (abs(vWN.y) < 0.5 && vWP.y > 3.2) {
            float along = abs(vWN.x) > 0.5 ? vWP.z : vWP.x;
            vec2 cell = vec2(floor(along / 3.0), floor(vWP.y / 3.4));
            vec2 f = vec2(fract(along / 3.0), fract(vWP.y / 3.4));
            float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.3, f.y) * step(f.y, 0.85);
            float lit = step(0.62, hsh(cell + floor(vWP.xz / 40.0) * 7.0));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.1, 0.13), win * 0.85);
            totalEmissiveRadiance += win * lit * vec3(1.0, 0.72, 0.4) * 0.9;
          } else if (vWP.y < 3.2 && abs(vWN.y) < 0.5) {
            // Shopfronts at street level: lit.
            float along = abs(vWN.x) > 0.5 ? vWP.z : vWP.x;
            float shop = step(0.5, fract(along / 5.0)) * step(0.4, vWP.y) * step(vWP.y, 2.8);
            totalEmissiveRadiance += shop * vec3(1.0, 0.85, 0.6) * 0.5;
          }`);
    };
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const blocks = new THREE.InstancedMesh(box, mat, spots.length);
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    const WALLS = [0xd8cfc0, 0xc8b8a0, 0xe0dcd4, 0xa8b0b8, 0xd0a888, 0x9aa0a0, 0xe8d8b8];
    spots.forEach((s, k) => {
      blocks.setMatrixAt(k, m4.compose(new THREE.Vector3(s.x, 0, s.z), new THREE.Quaternion(), new THREE.Vector3(s.w, s.h, s.d)));
      blocks.setColorAt(k, col.setHex(WALLS[Math.floor(s.hue * WALLS.length)]));
    });
    blocks.castShadow = blocks.receiveShadow = true;
    group.add(blocks);
  }

  // ---- The boulevard's promenade: the sea wall, palms, street lamps; a grandstand facing the pits.
  {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(gw, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: 0xa8a49c, roughness: 0.9 }));
    wall.position.set((b.minX + b.maxX) / 2, 0.2, shore - 0.6);
    wall.receiveShadow = true;
    group.add(wall);
    // Palms: a leaning trunk and a crown of drooping fronds (one shape, instanced, turned and sized at random).
    const trunk = new THREE.CylinderGeometry(0.16, 0.24, 9, 7, 6).translate(0, 4.5, 0);
    const tp = trunk.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < tp.count; v++) tp.setX(v, tp.getX(v) + (tp.getY(v) / 9) ** 2 * 0.9);
    trunk.computeVertexNormals();
    const frond = new THREE.BufferGeometry();
    {
      const p: number[] = [];
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        // A frond: a strip out from the top, drooping, narrowing.
        const seg = 5;
        for (let s = 0; s < seg; s++) {
          const t0 = s / seg;
          const t1 = (s + 1) / seg;
          const pt = (t: number, side: number): [number, number, number] => {
            const r = t * 4.2;
            const w = 0.55 * (1 - t) * side;
            return [0.9 + dx * r - dz * w, 9 + 0.6 * t - 2.4 * t * t, dz * r + dx * w];
          };
          const a0 = pt(t0, 1);
          const a1 = pt(t0, -1);
          const b0 = pt(t1, 1);
          const b1 = pt(t1, -1);
          p.push(...a0, ...a1, ...b0, ...a1, ...b1, ...b0);
        }
      }
      frond.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      frond.computeVertexNormals();
    }
    const r = rng(5);
    const palmAt: THREE.Matrix4[] = [];
    const m4 = new THREE.Matrix4();
    // Along the promenade (between the barrier and the sea wall), and on the paddock's edge.
    for (let x = b.minX - M + 10; x < b.maxX + M; x += 14 + r() * 6) {
      const z = shore - 5 - r() * 3;
      if (nearTrack(x, z, 2.5)) continue;
      m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * Math.PI * 2, 0)), new THREE.Vector3().setScalar(0.85 + r() * 0.35));
      palmAt.push(m4.clone());
    }
    for (let x = lot.x + 6; x < lot.x + lot.w; x += 16) {
      m4.compose(new THREE.Vector3(x, 0, lot.z + 3), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * Math.PI * 2, 0)), new THREE.Vector3().setScalar(0.8 + r() * 0.3));
      palmAt.push(m4.clone());
    }
    const trunks = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x7a6248, roughness: 0.95 }), palmAt.length);
    const fronds = new THREE.InstancedMesh(frond, new THREE.MeshStandardMaterial({ color: 0x3e6a2a, roughness: 0.8, side: THREE.DoubleSide }), palmAt.length);
    palmAt.forEach((m, k) => {
      trunks.setMatrixAt(k, m);
      fronds.setMatrixAt(k, m);
    });
    trunks.castShadow = fronds.castShadow = true;
    group.add(trunks, fronds);
    // Street lamps along the promenade, their heads glowing.
    const pole = new THREE.CylinderGeometry(0.08, 0.1, 8, 6).translate(0, 4, 0);
    const lampCount = Math.ceil((gw) / 30);
    const poles = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.4, roughness: 0.6 }), lampCount);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.2, 0.4).translate(0.4, 8, 0), new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffd8a0, emissiveIntensity: 2.2 }), lampCount);
    let lc = 0;
    for (let x = b.minX - M + 20; x < b.maxX + M && lc < lampCount; x += 30) {
      const z = shore - 9;
      if (nearTrack(x, z, 1)) continue;
      m4.makeTranslation(x, 0, z);
      poles.setMatrixAt(lc, m4);
      heads.setMatrixAt(lc, m4);
      lc++;
    }
    poles.count = heads.count = lc;
    group.add(poles, heads);
    // The grandstand: tiers of seats between the boulevard and the sea wall, facing the pits, a roof over it.
    const gi = course.wrap(start - 40);
    const gc = L(gi, -(rail + 7.5));
    const stand = new THREE.Group();
    const conc = new THREE.MeshStandardMaterial({ color: 0x9a968e, roughness: 0.9 });
    const seats = new THREE.MeshStandardMaterial({ color: 0x1a5aa8, roughness: 0.7 });
    for (let t = 0; t < 6; t++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(120, 0.45 * (t + 1), 1.6), t % 2 ? seats : conc);
      step.position.set(0, (0.45 * (t + 1)) / 2, -4 + t * 1.6);
      stand.add(step);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(122, 0.3, 11), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 }));
    roof.position.set(0, 7.5, 0);
    stand.add(roof);
    for (let x = -60; x <= 60; x += 20) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.3, 7.5, 0.3), conc);
      col.position.set(x, 3.75, 4.5);
      stand.add(col);
    }
    stand.position.set(gc.x, 0, gc.z);
    stand.rotation.y = Math.atan2(course.tx[gi], course.tz[gi]) + Math.PI / 2;
    stand.traverse((o) => ((o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true));
    group.add(stand);
  }

  // ---- The paddock: a row of pit garages along its back, shutters up, lit inside.
  {
    const garages = new THREE.Group();
    const shell = new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.8 });
    const inside = new THREE.MeshStandardMaterial({ color: 0x222226, emissive: 0xfff2d8, emissiveIntensity: 0.55 });
    const count = Math.floor(lot.w / 12);
    for (let k = 0; k < count; k++) {
      const x = lot.x + 6 + k * 12;
      const g = new THREE.Mesh(new THREE.BoxGeometry(11, 5, 10), shell);
      g.position.set(x, 2.5, lot.z - 5);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 3.6), inside);
      door.position.set(x, 1.8, lot.z + 0.02);
      garages.add(g, door);
    }
    garages.traverse((o) => ((o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true));
    group.add(garages);
  }

  // ---- Jeepneys parked along the streets behind the barriers: long bodies, a raised roof, a bonnet, chrome, bright
  // paint (one shape, instanced, coloured per jeepney).
  {
    const parts: THREE.BufferGeometry[] = [
      new THREE.BoxGeometry(2.0, 1.3, 5.2).translate(0, 1.15, -0.4),
      new THREE.BoxGeometry(2.1, 0.25, 5.4).translate(0, 1.95, -0.4),
      new THREE.BoxGeometry(1.8, 0.9, 1.6).translate(0, 0.95, 2.9),
      new THREE.BoxGeometry(0.3, 0.9, 0.2).translate(0, 1.6, 3.7),
    ];
    const merged = mergeBoxes(parts);
    const r = rng(23);
    const JEEP = [0xd8d8dc, 0xc81818, 0xe8b820, 0x1a6ac8, 0x2a9a4a, 0xe06a1a, 0x8a2ab8];
    const spots: THREE.Matrix4[] = [];
    const cols: number[] = [];
    for (let k = 0; k < 400 && spots.length < 36; k++) {
      const i = Math.floor(r() * n);
      const s = r() < 0.5 ? 1 : -1;
      const p = L(i, s * (rail + 4 + r() * 3));
      if (nearTrack(p.x, p.z, 2.8) || p.z > shore - 14) continue;
      if (p.x > lot.x - 4 && p.x < lot.x + lot.w + 4 && p.z > lot.z - 12 && p.z < lot.z + lot.h + 4) continue;
      spots.push(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(course.tx[i], course.tz[i]), 0)), new THREE.Vector3(1, 1, 1)));
      cols.push(JEEP[Math.floor(r() * JEEP.length)]);
    }
    const jeeps = new THREE.InstancedMesh(merged, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.3 }), spots.length);
    const c = new THREE.Color();
    spots.forEach((m, k) => {
      jeeps.setMatrixAt(k, m);
      jeeps.setColorAt(k, c.setHex(cols[k]));
    });
    jeeps.castShadow = true;
    group.add(jeeps);
  }

  const stars = addSky(course, group);
  startLights(0);
  return { group, stars, startLights };
}

/** Boxes (non-indexed or indexed) merged into one geometry. */
function mergeBoxes(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const p: number[] = [];
  const nr: number[] = [];
  for (const g0 of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    p.push(...(g.attributes.position.array as Float32Array));
    nr.push(...(g.attributes.normal.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nr, 3));
  return out;
}
