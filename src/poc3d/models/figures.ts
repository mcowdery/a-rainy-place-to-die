import * as THREE from 'three';

/**
 * People, second generation (review in models.html before they replace real/people.ts in the district).
 *
 * Each figure is one seamless surface: body parts, clothes, hair and accessories are signed-distance
 * primitives (round cones for limbs, ellipsoids for torso, head and hands, capped cones for skirts,
 * kimono and coats, rounded boxes for bags) combined with smooth unions, so joints blend like a real body,
 * and meshed with surface nets. Normals come from the distance field's gradient. A shape depends only on
 * its FigureShape (body, outfit, hair, hat, accessory, pose, walk phase), so meshes are cached and shared;
 * position, facing and colour are per instance.
 *
 * The world is an alternate Japan, so the outfits lean on it: salaryman suit with tie and briefcase,
 * kimono with obi and bow, a schoolchild's randoseru and yellow cap, an elder's cane, a clear umbrella,
 * and the bow (ojigi).
 */

type V3 = [number, number, number];

export type Body2 = 'man' | 'woman' | 'child' | 'elder';
export type Outfit = 'casual' | 'suit' | 'dress' | 'kimono' | 'coat' | 'school';
export type Hair2 = 'short' | 'bob' | 'long' | 'bun' | 'ponytail' | 'none';
export type Hat = 'none' | 'fedora' | 'cap' | 'schoolhat' | 'sunhat';
export type Accessory = 'none' | 'briefcase' | 'shoulderbag' | 'randoseru' | 'cane' | 'umbrella' | 'phone';
export type Pose2 = 'stand' | 'walk' | 'talk' | 'phone' | 'pockets' | 'wave' | 'hold' | 'bow' | 'carry' | 'umbrella';

export const POSES2: readonly Pose2[] = ['stand', 'walk', 'talk', 'phone', 'pockets', 'wave', 'hold', 'bow'];

export interface FigureShape {
  readonly body: Body2;
  readonly outfit: Outfit;
  readonly hair: Hair2;
  readonly hat: Hat;
  readonly accessory: Accessory;
  readonly pose: Pose2;
  /** Walk phase 0-1 (quantised to eighths for caching). */
  readonly phase: number;
  /** Arm used for gestures / holding: 1 right, -1 left. */
  readonly side: number;
  /** Head turn, radians (quantised). */
  readonly look: number;
}

// ---- Signed distance primitives ----

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3): number => Math.sqrt(dot(a, a));
const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

type Sdf = (x: number, y: number, z: number) => number;

interface Prim {
  readonly f: Sdf;
  /** Bounding box (already including the primitive's radius). */
  readonly lo: V3;
  readonly hi: V3;
  /** Smooth-union radius (0 = hard union). */
  readonly k: number;
}

/** Round cone from a (radius ra) to b (radius rb): Inigo Quilez's exact formulation. */
function roundCone(a: V3, b: V3, ra: number, rb: number, k: number): Prim {
  const ba = sub(b, a);
  const l2 = dot(ba, ba) || 1e-8;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const f: Sdf = (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const yy = pax * ba[0] + pay * ba[1] + paz * ba[2];
    const zz = yy - l2;
    const xvx = pax * l2 - ba[0] * yy, xvy = pay * l2 - ba[1] * yy, xvz = paz * l2 - ba[2] * yy;
    const x2 = xvx * xvx + xvy * xvy + xvz * xvz;
    const y2 = yy * yy * l2;
    const z2 = zz * zz * l2;
    const kk = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > kk) return Math.sqrt(x2 + z2) * il2 - rb;
    if (Math.sign(yy) * a2 * y2 < kk) return Math.sqrt(x2 + y2) * il2 - ra;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
  };
  const r = Math.max(ra, rb);
  return { f, lo: [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r], hi: [Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r], k };
}

/** Ellipsoid at c with semi-axes r along the frame (ax, ay, az). */
function ellipsoid(c: V3, r: V3, k: number, ax: V3 = [1, 0, 0], ay: V3 = [0, 1, 0], az: V3 = [0, 0, 1]): Prim {
  const f: Sdf = (x, y, z) => {
    const px = x - c[0], py = y - c[1], pz = z - c[2];
    const lx = (px * ax[0] + py * ax[1] + pz * ax[2]) / r[0];
    const ly = (px * ay[0] + py * ay[1] + pz * ay[2]) / r[1];
    const lz = (px * az[0] + py * az[1] + pz * az[2]) / r[2];
    const k0 = Math.sqrt(lx * lx + ly * ly + lz * lz);
    const k1 = Math.sqrt((lx / r[0]) ** 2 + (ly / r[1]) ** 2 + (lz / r[2]) ** 2);
    return k1 < 1e-9 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
  };
  const m = Math.max(r[0], r[1], r[2]);
  return { f, lo: [c[0] - m, c[1] - m, c[2] - m], hi: [c[0] + m, c[1] + m, c[2] + m], k };
}

/** Rounded box at c with half-size b and rounding rr, in the frame (ax, ay, az). */
function roundBox(c: V3, b: V3, rr: number, k: number, ax: V3 = [1, 0, 0], ay: V3 = [0, 1, 0], az: V3 = [0, 0, 1]): Prim {
  const f: Sdf = (x, y, z) => {
    const px = x - c[0], py = y - c[1], pz = z - c[2];
    const qx = Math.abs(px * ax[0] + py * ax[1] + pz * ax[2]) - (b[0] - rr);
    const qy = Math.abs(px * ay[0] + py * ay[1] + pz * ay[2]) - (b[1] - rr);
    const qz = Math.abs(px * az[0] + py * az[1] + pz * az[2]) - (b[2] - rr);
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - rr;
  };
  const m = Math.hypot(b[0], b[1], b[2]);
  return { f, lo: [c[0] - m, c[1] - m, c[2] - m], hi: [c[0] + m, c[1] + m, c[2] + m], k };
}

/**
 * Vertical capped cone (skirts, kimono, coats) around (cx, cz) from y0 (radius r0) to y1 (radius r1),
 * squashed front-to-back by `depth` (1 = round). Hollow-free; legs inside blend away.
 */
function cappedCone(cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, depth: number, k: number, fwd: V3 = [0, 0, 1]): Prim {
  const h = (y1 - y0) / 2;
  const cy = (y0 + y1) / 2;
  const rt: V3 = [fwd[2], 0, -fwd[0]];
  const f: Sdf = (x, y, z) => {
    const px = x - cx, pz = z - cz;
    const lx = px * rt[0] + pz * rt[2];
    const lz = (px * fwd[0] + pz * fwd[2]) / depth;
    const qx = Math.sqrt(lx * lx + lz * lz);
    const qy = y - cy;
    const k1x = r1, k1y = h;
    const k2x = r1 - r0, k2y = 2 * h;
    const cax = qx - Math.min(qx, qy < 0 ? r0 : r1);
    const cay = Math.abs(qy) - h;
    const t = Math.min(1, Math.max(0, ((k1x - qx) * k2x + (k1y - qy) * k2y) / (k2x * k2x + k2y * k2y)));
    const cbx = qx - k1x + k2x * t;
    const cby = qy - k1y + k2y * t;
    const s = cbx < 0 && cay < 0 ? -1 : 1;
    return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
  };
  const m = Math.max(r0, r1);
  return { f, lo: [cx - m, y0, cz - m], hi: [cx + m, y1, cz + m], k };
}

/** Flat disc (hat brims): radius r, half-thickness h, centred at c. */
function disc(c: V3, r: number, h: number, k: number): Prim {
  const f: Sdf = (x, y, z) => {
    const dx = Math.hypot(x - c[0], z - c[2]) - r;
    const dy = Math.abs(y - c[1]) - h;
    return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  };
  return { f, lo: [c[0] - r, c[1] - h, c[2] - r], hi: [c[0] + r, c[1] + h, c[2] + r], k };
}

/** Umbrella canopy: a thin dome shell (half an ellipsoid, thickness t) opening downward from c. */
function dome(c: V3, r: number, h: number, t: number): Prim {
  const e = ellipsoid(c, [r, h, r], 0);
  const f: Sdf = (x, y, z) => Math.max(Math.abs(e.f(x, y, z)) - t, c[1] - 0.01 - y);
  return { f, lo: [c[0] - r - t, c[1] - 0.02, c[2] - r - t], hi: [c[0] + r + t, c[1] + h + t, c[2] + r + t], k: 0 };
}

const smin = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

// ---- Skeleton and body ----

interface Limb {
  swing: number;
  raise: number;
  bend: number;
}

interface Posed {
  lean: number;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
  headTilt: number;
}

function posed(s: FigureShape): Posed {
  const relaxed = (): Limb => ({ swing: 0.04, raise: 0.1, bend: 0.22 });
  const legs = (): Limb => ({ swing: 0, raise: 0.035, bend: 0.03 });
  const p: Posed = { lean: s.body === 'elder' ? 0.22 : 0.03, armL: relaxed(), armR: relaxed(), legL: legs(), legR: legs(), headTilt: s.body === 'elder' ? 0.15 : 0 };
  const act = s.side > 0 ? p.armR : p.armL;
  const other = s.side > 0 ? p.armL : p.armR;
  const set = (l: Limb, swing: number, raise: number, bend: number): void => {
    l.swing = swing;
    l.raise = raise;
    l.bend = bend;
  };
  switch (s.pose) {
    case 'stand':
      // Weight on one leg, the other knee softened.
      set(p.legR, 0.06, 0.08, 0.14);
      set(p.legL, -0.02, 0.02, 0.0);
      break;
    case 'walk': {
      const a = Math.sin(s.phase * Math.PI * 2);
      const sw = a * 0.42;
      set(p.legL, sw, 0.03, sw < 0 ? 0.08 : 0.18 + 0.25 * (1 - Math.abs(a)));
      set(p.legR, -sw, 0.03, -sw < 0 ? 0.08 : 0.18 + 0.25 * (1 - Math.abs(a)));
      set(p.armL, -sw * 0.75, 0.1, 0.3);
      set(p.armR, sw * 0.75, 0.1, 0.3);
      p.lean += 0.05;
      break;
    }
    case 'talk':
      set(act, 0.45, 0.18, 1.35);
      set(p.legR, 0.05, 0.08, 0.1);
      break;
    case 'phone':
      set(act, 0.15, 0.32, 2.55);
      set(other, 0.35, -0.05, 1.4);
      p.headTilt = 0.12;
      break;
    case 'pockets':
      set(p.armL, -0.18, 0.22, 0.65);
      set(p.armR, -0.18, 0.22, 0.65);
      set(p.legL, 0.0, 0.1, 0.02);
      set(p.legR, 0.0, 0.1, 0.02);
      break;
    case 'wave':
      set(act, 0.15, 1.25, 0.55);
      break;
    case 'hold':
      set(act, 0.08, s.body === 'child' ? 0.7 : 0.3, 0.08);
      break;
    case 'bow':
      // Ojigi: bend from the hips, arms straight down, hands at the thighs.
      p.lean = 0.62;
      set(p.armL, 0.6, 0.02, 0.05);
      set(p.armR, 0.6, 0.02, 0.05);
      p.headTilt = 0.15;
      break;
    case 'carry':
      set(act, 0.0, 0.1, 0.05);
      break;
    case 'umbrella':
      set(act, 0.55, 0.12, 1.25);
      break;
  }
  return p;
}

/** All the primitives for one figure, in its local frame (feet at y = 0, facing +z; +x is the side = 1 arm). */
function figurePrims(s: FigureShape): Prim[] {
  const P: Prim[] = [];
  const child = s.body === 'child';
  const woman = s.body === 'woman';
  const elder = s.body === 'elder';
  const k = child ? 0.7 : woman ? 0.94 : elder ? 0.95 : 1;
  const headK = child ? 1.2 : 1;
  const pose = posed(s);
  const walking = s.pose === 'walk';
  const legLen = 0.88 * k * (child ? 0.9 : 1);
  const pelvisY = legLen * (walking ? 0.975 : 1) + 0.055 * k;
  const hipW = (woman ? 0.095 : 0.09) * k;
  const shoulderW = (woman ? 0.165 : elder ? 0.18 : 0.195) * k;
  const torsoLen = 0.5 * k;
  const up: V3 = [0, Math.cos(pose.lean), Math.sin(pose.lean)];
  const pelvis: V3 = [0, pelvisY, 0];
  const waist = add(pelvis, mul(up, torsoLen * 0.35));
  const chest = add(pelvis, mul(up, torsoLen * 0.72));
  const neckBase = add(pelvis, mul(up, torsoLen));
  const lookF: V3 = [Math.sin(s.look), 0, Math.cos(s.look)];
  const headUp: V3 = norm(add(up, mul(lookF, pose.headTilt)));
  const headC = add(neckBase, mul(headUp, 0.155 * k * headK));
  const hr: V3 = [lookF[2], 0, -lookF[0]];
  const hf = norm(sub(lookF, mul(headUp, dot(lookF, headUp))));
  const BK = 0.045; // body blend
  const limbDir = (l: Limb, sgn: number, extra = 0): V3 => {
    const a = l.swing + extra;
    return [sgn * Math.sin(l.raise), -Math.cos(a) * Math.cos(l.raise), Math.sin(a) * Math.cos(l.raise)];
  };
  // Torso: pelvis, belly and chest ellipsoids tilted with the spine.
  const side: V3 = [1, 0, 0];
  const fwdT = cross(side, up);
  P.push(ellipsoid(pelvis, [hipW + 0.075 * k, 0.11 * k, 0.1 * k], BK, side, up, fwdT));
  P.push(ellipsoid(waist, [(woman ? 0.12 : 0.135) * k, 0.12 * k, 0.095 * k], BK, side, up, fwdT));
  P.push(ellipsoid(add(chest, mul(fwdT, 0.01)), [shoulderW * 0.82, 0.155 * k, (woman ? 0.108 : 0.112) * k], BK, side, up, fwdT));
  // Neck and head: skull, jaw, nose and ears.
  P.push(roundCone(neckBase, add(neckBase, mul(headUp, 0.09 * k)), 0.052 * k, 0.045 * k, BK));
  const hk = k * headK;
  P.push(ellipsoid(headC, [0.08 * hk, 0.102 * hk, 0.094 * hk], 0.03, hr, headUp, hf));
  P.push(ellipsoid(add(headC, add(mul(headUp, -0.055 * hk), mul(hf, 0.022 * hk))), [0.058 * hk, 0.05 * hk, 0.065 * hk], 0.035, hr, headUp, hf));
  P.push(ellipsoid(add(headC, add(mul(headUp, -0.01 * hk), mul(hf, 0.094 * hk))), [0.012 * hk, 0.022 * hk, 0.02 * hk], 0.012, hr, headUp, hf));
  for (const sg of [-1, 1]) P.push(ellipsoid(add(headC, add(mul(hr, sg * 0.08 * hk), mul(headUp, -0.01 * hk))), [0.012 * hk, 0.028 * hk, 0.02 * hk], 0.01, hr, headUp, hf));

  // Legs and shoes.
  for (const [sg, leg] of [[1, pose.legR], [-1, pose.legL]] as const) {
    const hip: V3 = [sg * hipW, pelvisY - 0.03 * k, 0];
    const knee = add(hip, mul(limbDir(leg, sg), legLen * 0.5));
    const shinDir = limbDir(leg, sg, -leg.bend);
    const ankle = add(knee, mul(shinDir, legLen * 0.47));
    P.push(roundCone(hip, knee, 0.085 * k, 0.056 * k, BK));
    P.push(roundCone(knee, ankle, 0.052 * k, 0.034 * k, BK));
    // Calf.
    P.push(ellipsoid(add(add(knee, mul(shinDir, legLen * 0.14)), [0, 0, -0.012 * k]), [0.052 * k, 0.09 * k, 0.05 * k], BK));
    // Shoe, pointing forward.
    const toe: V3 = [0, 0, 1];
    P.push(ellipsoid(add(ankle, [0, -0.028 * k, 0.055 * k]), [0.045 * k, 0.04 * k, 0.12 * k], 0.03, [1, 0, 0], [0, 1, 0], toe));
  }

  // Arms and hands.
  const hands: V3[] = [];
  const handDirs: V3[] = [];
  for (const [sg, arm] of [[1, pose.armR], [-1, pose.armL]] as const) {
    const sh = add(chest, add(mul(side, sg * shoulderW), mul(up, 0.1 * k)));
    const d1 = limbDir(arm, sg);
    const elbow = add(sh, mul(d1, 0.29 * k));
    const d2 = norm(limbDir(arm, sg * 0.6, arm.bend));
    const wrist = add(elbow, mul(d2, 0.25 * k));
    // Deltoid: tucked inside the chest's outline so it rounds the shoulder instead of padding it.
    P.push(ellipsoid(add(sh, mul(side, -sg * 0.012 * k)), [0.05 * k, 0.05 * k, 0.052 * k], 0.06));
    P.push(roundCone(sh, elbow, (woman ? 0.043 : 0.048) * k, 0.037 * k, BK));
    P.push(roundCone(elbow, wrist, 0.035 * k, 0.026 * k, BK));
    // Hand: a flattened ellipsoid along the forearm, and a thumb.
    const hc = add(wrist, mul(d2, 0.055 * k));
    const hx = norm(cross(d2, [0, 0, 1]));
    const hz = cross(hx, d2);
    P.push(ellipsoid(hc, [0.038 * k, 0.07 * k, 0.018 * k], 0.02, hx, d2, hz));
    P.push(roundCone(add(wrist, mul(hx, -sg * 0.025 * k)), add(add(wrist, mul(d2, 0.05 * k)), mul(hx, -sg * 0.045 * k)), 0.014 * k, 0.011 * k, 0.012));
    hands[sg > 0 ? 0 : 1] = add(wrist, mul(d2, 0.09 * k));
    handDirs[sg > 0 ? 0 : 1] = d2;
  }
  const actHand = hands[s.side > 0 ? 0 : 1];

  // Clothing.
  const CK = 0.025;
  const waistY = waist[1];
  const kneeY = pelvisY - legLen * 0.5;
  switch (s.outfit) {
    case 'suit': {
      // Jacket skirt over the hips, and a tie.
      P.push(roundCone(add(waist, mul(up, 0.04)), add(pelvis, mul(up, -0.12 * k)), 0.15 * k, 0.16 * k, CK));
      P.push(roundBox(add(chest, add(mul(fwdT, 0.112 * k), mul(up, -0.02 * k))), [0.018 * k, 0.12 * k, 0.006], 0.004, 0.01, side, up, fwdT));
      break;
    }
    case 'dress':
      P.push(cappedCone(0, 0, kneeY - 0.02, waistY, 0.25 * k, 0.13 * k, 0.8, CK));
      break;
    case 'kimono': {
      // Straight robe to the ankles, obi sash with a taiko bow on the back, long hanging sleeves.
      P.push(cappedCone(0, 0, 0.08, neckBase[1] - 0.05, 0.16 * k, 0.17 * k, 0.78, CK));
      P.push(cappedCone(0, 0, waistY - 0.08 * k, waistY + 0.1 * k, 0.16 * k, 0.16 * k, 0.8, 0.01));
      P.push(roundBox(add(waist, add(mul(fwdT, -0.14 * k), mul(up, 0.02))), [0.13 * k, 0.1 * k, 0.05 * k], 0.03, 0.015, side, up, fwdT));
      for (const i of [0, 1]) {
        const el = add(hands[i], mul(handDirs[i], -0.2 * k));
        P.push(roundBox(add(el, [0, -0.12 * k, 0]), [0.03 * k, 0.16 * k, 0.1 * k], 0.025, CK));
      }
      break;
    }
    case 'coat':
      // Trench coat: flares from the chest to below the knee, with a collar.
      P.push(cappedCone(0, 0, kneeY - 0.12 * k, chest[1], 0.26 * k, 0.19 * k, 0.72, CK));
      P.push(roundCone(add(neckBase, mul(up, -0.04)), add(neckBase, mul(up, 0.03)), 0.085 * k, 0.07 * k, CK));
      break;
    case 'school':
      // Randoseru: the hard leather school backpack.
      P.push(roundBox(add(chest, add(mul(fwdT, -0.16 * k), mul(up, -0.02))), [0.13 * k, 0.16 * k, 0.08 * k], 0.035, 0.02, side, up, fwdT));
      break;
    case 'casual':
      break;
  }

  // Hair.
  const HK = 0.03;
  const top = add(headC, mul(headUp, 0.02 * hk));
  const back = mul(hf, -1);
  switch (s.hair) {
    case 'short':
      P.push(ellipsoid(add(top, mul(back, 0.012 * hk)), [0.086 * hk, 0.1 * hk, 0.098 * hk], HK, hr, headUp, hf));
      break;
    case 'bob':
      P.push(ellipsoid(add(top, add(mul(back, 0.018 * hk), mul(headUp, -0.03 * hk))), [0.098 * hk, 0.12 * hk, 0.105 * hk], HK, hr, headUp, hf));
      break;
    case 'long':
      P.push(ellipsoid(add(top, mul(back, 0.018 * hk)), [0.094 * hk, 0.106 * hk, 0.102 * hk], HK, hr, headUp, hf));
      P.push(ellipsoid(add(headC, add(mul(back, 0.06 * hk), mul(headUp, -0.16 * hk))), [0.1 * hk, 0.18 * hk, 0.045 * hk], HK, hr, headUp, hf));
      break;
    case 'bun':
      P.push(ellipsoid(add(top, mul(back, 0.01 * hk)), [0.086 * hk, 0.1 * hk, 0.098 * hk], HK, hr, headUp, hf));
      P.push(ellipsoid(add(headC, add(mul(back, 0.085 * hk), mul(headUp, 0.07 * hk))), [0.05 * hk, 0.045 * hk, 0.045 * hk], 0.02));
      break;
    case 'ponytail':
      P.push(ellipsoid(add(top, mul(back, 0.012 * hk)), [0.088 * hk, 0.102 * hk, 0.1 * hk], HK, hr, headUp, hf));
      P.push(roundCone(add(headC, add(mul(back, 0.1 * hk), mul(headUp, 0.04 * hk))), add(headC, add(mul(back, 0.13 * hk), mul(headUp, -0.18 * hk))), 0.035 * hk, 0.018 * hk, 0.02));
      break;
    case 'none':
      break;
  }
  // Hats.
  const crown = add(headC, mul(headUp, 0.08 * hk));
  switch (s.hat) {
    case 'fedora':
      P.push(disc(crown, 0.17 * hk, 0.008, 0));
      P.push(roundCone(crown, add(crown, mul(headUp, 0.1 * hk)), 0.098 * hk, 0.085 * hk, 0.01));
      break;
    case 'cap':
      P.push(ellipsoid(add(crown, mul(headUp, -0.02 * hk)), [0.095 * hk, 0.06 * hk, 0.102 * hk], 0.01, hr, headUp, hf));
      P.push(ellipsoid(add(crown, add(mul(hf, 0.11 * hk), mul(headUp, -0.035 * hk))), [0.075 * hk, 0.01, 0.065 * hk], 0.01, hr, headUp, hf));
      break;
    case 'schoolhat':
      // The round yellow safety hat of Japanese schoolchildren.
      P.push(ellipsoid(add(crown, mul(headUp, -0.01 * hk)), [0.1 * hk, 0.07 * hk, 0.105 * hk], 0.01, hr, headUp, hf));
      P.push(disc(add(crown, mul(headUp, -0.045 * hk)), 0.13 * hk, 0.008, 0.01));
      break;
    case 'sunhat':
      P.push(disc(crown, 0.22 * hk, 0.008, 0.005));
      P.push(ellipsoid(add(crown, mul(headUp, 0.02 * hk)), [0.095 * hk, 0.06 * hk, 0.095 * hk], 0.01));
      break;
    case 'none':
      break;
  }
  // Accessories.
  switch (s.accessory) {
    case 'briefcase':
      P.push(roundBox(add(actHand, [0, -0.17 * k, 0]), [0.05 * k, 0.15 * k, 0.21 * k], 0.02, 0, [1, 0, 0], [0, 1, 0], [0, 0, 1]));
      break;
    case 'shoulderbag': {
      const bag = add(pelvis, add(mul(side, -s.side * (hipW + 0.13 * k)), mul(up, 0.04)));
      P.push(roundBox(bag, [0.04 * k, 0.1 * k, 0.12 * k], 0.02, 0.01));
      P.push(roundCone(add(chest, add(mul(side, s.side * shoulderW * 0.8), mul(up, 0.12 * k))), add(bag, [0, 0.08 * k, 0]), 0.012, 0.012, 0.01));
      break;
    }
    case 'randoseru':
      P.push(roundBox(add(chest, add(mul(fwdT, -0.16 * k), mul(up, -0.02))), [0.13 * k, 0.16 * k, 0.08 * k], 0.035, 0.02, side, up, fwdT));
      break;
    case 'cane':
      P.push(roundCone(actHand, [actHand[0] + 0.02, 0.0, actHand[2] + 0.08], 0.017, 0.017, 0.01));
      P.push(roundCone(actHand, add(actHand, [0, 0.03, -0.07]), 0.018, 0.018, 0.01));
      break;
    case 'umbrella': {
      // Clear vinyl umbrella (the convenience-store kind), held overhead.
      const shaftTop = add(actHand, [0, 0.72, 0]);
      P.push(roundCone(add(actHand, [0, -0.1, 0]), add(shaftTop, [0, 0.06, 0]), 0.016, 0.014, 0));
      P.push(dome(add(shaftTop, [0, -0.2, 0]), 0.5, 0.26, 0.022));
      break;
    }
    case 'phone':
      P.push(roundBox(actHand, [0.01, 0.07, 0.035], 0.008, 0, [1, 0, 0], [0, 1, 0], [0, 0, 1]));
      break;
    case 'none':
      break;
  }
  return P;
}

// ---- Meshing: surface nets ----

/** Field value at a point from the primitives whose boxes are close enough to matter. */
function field(prims: readonly Prim[], x: number, y: number, z: number): number {
  let d = 1e9;
  for (const p of prims) {
    // Lower bound from the bounding box: skip primitives that can't affect the result.
    const bx = Math.max(p.lo[0] - x, 0, x - p.hi[0]);
    const by = Math.max(p.lo[1] - y, 0, y - p.hi[1]);
    const bz = Math.max(p.lo[2] - z, 0, z - p.hi[2]);
    const lb = Math.sqrt(bx * bx + by * by + bz * bz);
    if (lb > d + p.k) continue;
    const v = p.f(x, y, z);
    d = p.k > 0 ? smin(d, v, p.k) : Math.min(d, v);
  }
  return d;
}

/** Meshes the zero level set of the figure's field with naive surface nets; smooth normals from the gradient. */
function mesh(prims: readonly Prim[], h: number): THREE.BufferGeometry {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) for (let i = 0; i < 3; i++) {
    lo[i] = Math.min(lo[i], p.lo[i]);
    hi[i] = Math.max(hi[i], p.hi[i]);
  }
  for (let i = 0; i < 3; i++) {
    lo[i] -= 2 * h;
    hi[i] += 2 * h;
  }
  lo[1] = Math.max(lo[1], -h * 2);
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1;
  const ny = Math.ceil((hi[1] - lo[1]) / h) + 1;
  const nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  // Per y-slab candidate lists keep the field evaluation local.
  const slabPrims: Prim[][] = [];
  for (let j = 0; j < ny; j++) {
    const y = lo[1] + j * h;
    slabPrims.push(prims.filter((p) => y >= p.lo[1] - 0.08 && y <= p.hi[1] + 0.08));
  }
  const vals = new Float32Array(nx * ny * nz);
  const at = (i: number, j: number, kk: number): number => i + nx * (j + ny * kk);
  for (let kk = 0; kk < nz; kk++) {
    const z = lo[2] + kk * h;
    for (let j = 0; j < ny; j++) {
      const y = lo[1] + j * h;
      const ps = slabPrims[j];
      for (let i = 0; i < nx; i++) vals[at(i, j, kk)] = ps.length ? field(ps, lo[0] + i * h, y, z) : 1;
    }
  }
  const pos: number[] = [];
  const idx: number[] = [];
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cell = (i: number, j: number, kk: number): number => i + (nx - 1) * (j + (ny - 1) * kk);
  const corner = new Float32Array(8);
  // Edges of a cube as corner pairs (corner bit 0 = x, 1 = y, 2 = z).
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let kk = 0; kk < nz - 1; kk++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = vals[at(i + (c & 1), j + ((c >> 1) & 1), kk + ((c >> 2) & 1))];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a];
          const vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += (a & 1) + ((b & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          n++;
        }
        cellVert[cell(i, j, kk)] = pos.length / 3;
        pos.push(lo[0] + (i + sx / n) * h, lo[1] + (j + sy / n) * h, lo[2] + (kk + sz / n) * h);
        // A face for every sign-changing edge leaving corner 0 along each axis.
        const coords = [i, j, kk];
        for (let axis = 0; axis < 3; axis++) {
          const e = 1 << axis;
          if (((mask & 1) !== 0) === ((mask & (1 << e)) !== 0)) continue;
          const u = (axis + 1) % 3;
          const v = (axis + 2) % 3;
          if (coords[u] === 0 || coords[v] === 0) continue;
          const c0 = [...coords];
          const c1 = [...coords];
          c1[u]--;
          const c2 = [...coords];
          c2[u]--;
          c2[v]--;
          const c3 = [...coords];
          c3[v]--;
          const q = [c0, c1, c2, c3].map((c) => cellVert[cell(c[0], c[1], c[2])]);
          if (q.some((x) => x < 0)) continue;
          if (mask & 1) idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
          else idx.push(q[0], q[2], q[1], q[0], q[3], q[2]);
        }
      }
    }
  }
  // Normals from the field gradient.
  const nor = new Float32Array(pos.length);
  const e = h * 0.5;
  for (let v = 0; v < pos.length; v += 3) {
    const x = pos[v], y = pos[v + 1], z = pos[v + 2];
    const gx = field(prims, x + e, y, z) - field(prims, x - e, y, z);
    const gy = field(prims, x, y + e, z) - field(prims, x, y - e, z);
    const gz = field(prims, x, y, z + e) - field(prims, x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    nor[v] = gx / l;
    nor[v + 1] = gy / l;
    nor[v + 2] = gz / l;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const cache = new Map<string, THREE.BufferGeometry>();

/** Cached ghost geometry for a figure shape, in the figure's local frame (feet at the origin, facing +z). */
export function figureGeometry(s: FigureShape, resolution = 0.02): THREE.BufferGeometry {
  const phase = s.pose === 'walk' ? Math.round(s.phase * 8) / 8 : 0;
  const look = Math.round(s.look * 5) / 5;
  const key = [s.body, s.outfit, s.hair, s.hat, s.accessory, s.pose, phase, s.side, look, resolution].join('|');
  let g = cache.get(key);
  if (!g) {
    g = mesh(figurePrims({ ...s, phase, look }), resolution);
    cache.set(key, g);
  }
  return g;
}

/**
 * Ghost materials: a depth-only pre-pass (so each ghost reads as one clean translucent shell rather than
 * overlapping limbs) and the colour pass: a soft body tone, a bright Fresnel rim, faint horizontal
 * shimmer lines, and a fade towards the feet (a nod to yurei, the footless ghosts of Japanese tradition).
 */
export function ghostMaterials2(color: THREE.ColorRepresentation): { depth: THREE.Material; color: THREE.ShaderMaterial } {
  // Double-sided so the surface's winding never matters; the depth pre-pass keeps only the nearest layer.
  const depth = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, depthWrite: true, side: THREE.DoubleSide });
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(color) }, uGlow: { value: 1 } }]),
    transparent: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    side: THREE.DoubleSide,
    fog: true,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vN;
      varying vec3 vV;
      varying float vH;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mvPosition.xyz;
        vH = position.y;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 uColor;
      uniform float uGlow;
      varying vec3 vN;
      varying vec3 vV;
      varying float vH;
      void main() {
        vec3 n = normalize(vN);
        float f = 1.0 - abs(dot(n, normalize(vV)));
        float rim = pow(f, 2.2);
        float shade = 0.55 + 0.45 * n.y;
        float lines = 0.92 + 0.08 * sin(vH * 180.0);
        float feet = mix(0.3, 1.0, smoothstep(0.02, 0.45, vH));
        vec3 col = uColor * (0.12 + 0.2 * shade + 1.5 * rim) * lines * uGlow;
        gl_FragColor = vec4(col, (0.14 + 0.62 * rim) * feet);
        #include <fog_fragment>
      }`,
  });
  return { depth, color: mat };
}
