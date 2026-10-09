import { hash, rng, type Rng } from '../../core/hash';
import { KIND, lin, type MeshBuilder } from '../real/meshBuilder';

/**
 * Tree species for the streets and parks (under review in models.html; the district still uses the one
 * street tree in real/props.ts). Built from the city material's primitives: a tapered trunk, branches as
 * beams, and foliage as clusters of low-poly masses in a few tints, so each reads as a species at street
 * distance rather than a green ball.
 *
 * - zelkova (keyaki 欅): the classic avenue tree; branches fan up from a short trunk into a broad vase.
 * - ginkgo (ichō 銀杏): Tokyo's tree; a tall narrow cone on a straight trunk; 'ginkgoGold' in autumn.
 * - sakura (Somei-Yoshino 染井吉野): low, wide and flat-topped on spreading limbs; 'sakuraBloom' in April.
 * - pine (kuromatsu 黒松): a leaning, bending trunk with flat pads of needles, for shrines and gardens.
 * - camphor (kusunoki 楠): a huge evergreen dome on a thick trunk, the shrine grove tree.
 * - dogwood (hanamizuki 花水木): a small rounded street tree for narrow pavements; 'dogwoodBloom' in May.
 * - azalea (tsutsuji 躑躅) mounds in flower and clipped box balls, for planting beds.
 * The tropical set (Manila). APPENDED: the indexes are baked into vertex styles and the shader's groups (real/city.ts),
 * where these all fall in the evergreen group, coloured by their vertices. Coconut palm (niyog), royal palm (the
 * avenue palm), banana (saging), rain tree (an umbrella crown), mango (mangga) and bougainvillea shrubs.
 */
export const TREE_SPECIES = ['zelkova', 'ginkgo', 'ginkgoGold', 'sakura', 'sakuraBloom', 'pine', 'camphor', 'dogwood', 'dogwoodBloom', 'azalea', 'box', 'coconut', 'royalPalm', 'banana', 'raintree', 'mango', 'bougainvillea'] as const;
export type TreeSpecies = (typeof TREE_SPECIES)[number];

export interface TreeSpec {
  readonly x: number;
  readonly z: number;
  readonly species: TreeSpecies;
  /** Overall scale (1 = a mature tree). */
  readonly size?: number;
  readonly seed?: number;
  /**
   * Street trees: the crown shifted by (dx, dz) (out over the road, off a facade) and raised by lift
   * (clear of buses), on a stem that leans from the foot to the crown's trunk; a grate at the foot.
   */
  readonly lean?: readonly [number, number];
  readonly lift?: number;
  readonly grate?: boolean;
}

/** How far each species' crown reaches from its trunk at size 1 (for fitting trees to pavements). */
export const TREE_REACH: Record<TreeSpecies, number> = {
  zelkova: 4.6, ginkgo: 2.3, ginkgoGold: 2.3, sakura: 5.4, sakuraBloom: 5.4, pine: 3.4, camphor: 5.6, dogwood: 1.7, dogwoodBloom: 1.7, azalea: 0.9, box: 0.6,
  coconut: 3.4, royalPalm: 3.8, banana: 2.4, raintree: 6.2, mango: 3.9, bougainvillea: 1.3,
};

/** Height added to everything above the stem while one tree is built (see TreeSpec.lift). */
let LIFT = 0;

type C3 = [number, number, number];

const BARK = [0x4a3a2c, 0x5a4a3a, 0x3e342c];
const GREENS: Record<string, readonly number[]> = {
  zelkova: [0x3e5a2a, 0x4a6a30, 0x36522a, 0x557a36],
  ginkgo: [0x5a7a2a, 0x6a8a30, 0x4e6e26],
  ginkgoGold: [0xe0b21e, 0xeec43a, 0xd49a14, 0xf2d060],
  sakura: [0x4a6a30, 0x3e5a2a, 0x557a36],
  sakuraBloom: [0xf4d4e0, 0xeec0d2, 0xf8e4ec, 0xe8b0c4],
  pine: [0x24381e, 0x2a4222, 0x1e3018],
  camphor: [0x2e4a26, 0x36522a, 0x3e5a2e, 0x2a4422],
  dogwood: [0x3e5a2e, 0x4a6a34],
  dogwoodBloom: [0x3e5a2e, 0x4a6a34],
  azalea: [0x2e4a26, 0x36522a],
  box: [0x2e4a26, 0x3a5a2a],
  coconut: [0x4e8a2a, 0x5c9a32, 0x447a24],
  royalPalm: [0x4e8a2e, 0x5a9636, 0x427a26],
  banana: [0x5c9c2c, 0x6aaa34, 0x4e8e26, 0x7ab03a],
  raintree: [0x3c6e28, 0x487a2e, 0x34622a, 0x548434],
  mango: [0x24441e, 0x2c5024, 0x1e3a1a, 0x32582a],
  bougainvillea: [0x2e5a24, 0x3a6a2a],
};
/** Bougainvillea's bracts: magentas, one orange. */
export const BOUGAINVILLEA = [0xc8286e, 0xd8388a, 0xe05a9c, 0xb81e60, 0xe87a3a] as const;

/** Flowering dogwood's bracts: three pinks (a tree is one of them; cream ones read as a pale ball under a lamp). */
const DOGWOOD_BRACTS = [0xd98aa8, 0xe2a2ba, 0xcf7f9f] as const;

/**
 * How a crown's foliage is built (under review in the showroom; each is kept in the vertices, style.z, so the
 * variants stand side by side). Every species lays its crown out as a few masses (its vase, cone, flat top...);
 * the variant fills each mass:
 * - 0 puffs: one smooth round mass (the district's now).
 * - 1 tufts: many small irregular tufts on twigs, so the outline breaks up and the sky shows between them.
 * - 2 cards: leaf cards (clusters of leaves cut out of two-sided cards by the shader) round a dark core.
 * - 3 airy: leaf cards only, fewer, on twigs you can see through them.
 * The shading (leaf clusters, the season's colours) is the same for all (real/city.ts).
 */
export const FOLIAGE_VARIANTS = ['puffs', 'tufts', 'cards', 'airy'] as const;
let VARIANT = 3;
/** The variant for the foliage built from now on. */
export function setFoliageVariant(v: number): void {
  VARIANT = v;
}
export const foliageVariant = (): number => VARIANT;

/** A smooth mass; part 1 is a leaf-card crown's dark core. */
function blob(mb: MeshBuilder, x: number, y: number, z: number, rx: number, ry: number, n: number, part = 0): void {
  const style = mb.style;
  mb.style = [FOLIAGE_TAG + SPECIES, part, VARIANT, 0];
  mb.latheSmooth(x, y, z, rx, ry, [[y - ry, rx * 0.15], [y - ry * 0.4, rx * 0.95], [y + ry * 0.35, rx * 0.88], [y + ry, rx * 0.12]], n);
  mb.style = style;
}

/** A random point in an ellipsoid's outer shell (from `inner` of the way out), a little more on top. */
function shellPoint(r: Rng, inner: number): [number, number, number] {
  const u = r.float() * 2 - 1;
  const a = r.float() * Math.PI * 2;
  const up = Math.min(1, u + 0.25);
  const s = Math.sqrt(Math.max(0, 1 - up * up));
  const k = inner + (1 - inner) * Math.sqrt(r.float());
  return [Math.cos(a) * s * k, up * k, Math.sin(a) * s * k];
}

/**
 * A foliage mass: radius rx, half-height ry, centred at (x, y, z), built by the variant. Crowns are tagged with
 * their species (style.x = FOLIAGE_TAG + index), so the city shader colours them by the season (blossom, summer
 * green, autumn colour, bare in winter) without rebuilding anything; style.y marks the part (0 foliage, 1 a card
 * crown's core, 2 a leaf card), style.z the variant.
 */
function mass(mb: MeshBuilder, x: number, y: number, z: number, rx: number, ry: number, hex: number, n = 5): void {
  mb.color = lin(hex);
  y += LIFT;
  if (VARIANT === 0) return blob(mb, x, y, z, rx, ry, n);
  const r = rng(hash(Math.round(x * 16), Math.round(y * 16), Math.round(z * 16), 0x7f1a));
  const twig = (px: number, py: number, pz: number, t: number): void => {
    const style = mb.style;
    const col = mb.color;
    mb.style = [0, 0, 0, 0];
    mb.color = lin(0x4a3a2c);
    mb.beam([x, y - ry * 0.55, z], [px, py, pz], t);
    mb.color = col;
    mb.style = style;
  };
  if (VARIANT === 1) {
    // Tufts: small uneven lumps in the mass's shell, each on its twig.
    const count = Math.max(5, Math.min(22, Math.round(5 + 5 * rx * ry)));
    for (let i = 0; i < count; i++) {
      const [px, py, pz] = shellPoint(r, 0.45);
      const tx = x + px * rx * 0.8;
      const ty = y + py * ry * 0.8;
      const tz = z + pz * rx * 0.8;
      const tr = Math.max(0.22, rx * (0.26 + 0.16 * r.float()));
      if (i % 2 === 0) twig(tx, ty, tz, Math.max(0.03, rx * 0.025));
      const style = mb.style;
      mb.style = [FOLIAGE_TAG + SPECIES, 0, VARIANT, 0];
      const j = (): number => 0.75 + 0.5 * r.float();
      mb.latheSmooth(tx, ty, tz, tr, tr * 0.8, [[ty - tr * 0.8, tr * 0.2 * j()], [ty - tr * 0.3, tr * 0.95 * j()], [ty + tr * 0.35, tr * 0.8 * j()], [ty + tr * 0.8, tr * 0.12]], 5);
      mb.style = style;
    }
    return;
  }
  // Leaf cards: clusters of leaves on cards facing out of the mass (lit as the mass's round surface), over a dark
  // core (cards) or on twigs alone (airy).
  const airy = VARIANT === 3;
  if (!airy) blob(mb, x, y, z, rx * 0.72, ry * 0.72, n, 1);
  const count = Math.max(8, Math.min(56, Math.round((airy ? 8 : 9) + (airy ? 11 : 12) * rx * ry)));
  const style = mb.style;
  for (let i = 0; i < count; i++) {
    const [px, py, pz] = shellPoint(r, airy ? 0.3 : 0.6);
    const c: [number, number, number] = [x + px * rx, y + py * ry, z + pz * rx];
    if (airy && i % 3 === 0) twig(c[0], c[1], c[2], Math.max(0.025, rx * 0.02));
    // Outward, tipped at random; the card's plane across it, turned at random in its plane.
    const l = Math.hypot(px, py, pz) || 1;
    let nx = px / l + (r.float() - 0.5) * 0.9;
    let ny = py / l + (r.float() - 0.5) * 0.9 + 0.2;
    let nz = pz / l + (r.float() - 0.5) * 0.9;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const ref: [number, number, number] = Math.abs(ny) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let ax = ref[1] * nz - ref[2] * ny;
    let ay = ref[2] * nx - ref[0] * nz;
    let az = ref[0] * ny - ref[1] * nx;
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al;
    ay /= al;
    az /= al;
    const bx = ny * az - nz * ay;
    const by = nz * ax - nx * az;
    const bz = nx * ay - ny * ax;
    const t = r.float() * Math.PI;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    const size = Math.max(0.5, Math.min(rx, ry * 1.4) * (0.42 + 0.22 * r.float()));
    const R: [number, number, number] = [(ax * ct + bx * st) * size, (ay * ct + by * st) * size, (az * ct + bz * st) * size];
    const U: [number, number, number] = [(bx * ct - ax * st) * size, (by * ct - ay * st) * size, (bz * ct - az * st) * size];
    mb.style = [FOLIAGE_TAG + SPECIES, 2, VARIANT, 0];
    mb.card(c, R, U, [px / l, py / l, pz / l], 1 + r.float());
  }
  mb.style = style;
}

/**
 * Foliage for shrubs and hedges (real/dressing.ts), the same as a tree's: a mass of the species' tag (box for
 * clipped evergreens, azalea for flowering shrubs, camphor for the rest).
 */
export function shrubMass(mb: MeshBuilder, x: number, y: number, z: number, rx: number, ry: number, hex: number, species: TreeSpecies, n = 5): void {
  const was = SPECIES;
  SPECIES = TREE_SPECIES.indexOf(species);
  // (Bougainvillea hedges and pots flower magenta whatever green the caller gave.)
  if (species === 'bougainvillea') hex = BOUGAINVILLEA[hash(Math.round(x * 8), Math.round(z * 8), 0xb06a) % BOUGAINVILLEA.length];
  const lift = LIFT;
  LIFT = 0;
  const kind = mb.kind;
  mb.kind = KIND.plain;
  const v0 = mb.vertexCount;
  mass(mb, x, y, z, rx, ry, hex, n);
  // (Stirring in the wind, from the ground up.)
  mb.sway(v0);
  mb.kind = kind;
  LIFT = lift;
  SPECIES = was;
}

/** A crown's style tag: FOLIAGE_TAG plus its species' index in TREE_SPECIES (real/city.ts reads it). */
export const FOLIAGE_TAG = 20;
/** The species of the tree being built (for its crowns' tag). */
let SPECIES = 0;

/** A tapered trunk from y0 to y1. */
function trunk(mb: MeshBuilder, x: number, z: number, y0: number, y1: number, r0: number, r1: number, hex: number): void {
  mb.color = lin(hex);
  mb.lathe(x, z, [[y0 + LIFT, r0], [y1 + LIFT, r1]], 5);
}

/** A branch as a beam from a to b. */
function limb(mb: MeshBuilder, a: C3, b: C3, t: number, hex: number): void {
  mb.color = lin(hex);
  mb.beam([a[0], a[1] + LIFT, a[2]], [b[0], b[1] + LIFT, b[2]], t);
}

/**
 * A palm frond or banana leaf: a strip from (ox, oy, oz) outward along `ang`, rising by `up` and drooping by
 * `droop` (fractions of its length), notched along both edges so it reads as pinnate or torn. Two-sided (poly4 in
 * both windings: the city material culls back faces), tagged as foliage of the tree being built.
 */
function frond(mb: MeshBuilder, ox: number, oy: number, oz: number, ang: number, len: number, up: number, droop: number, wid: number, hex: number, notch = 0.4): void {
  mb.color = lin(hex);
  const style = mb.style;
  mb.style = [FOLIAGE_TAG + SPECIES, 0, VARIANT, 0];
  const dx = Math.cos(ang);
  const dz = Math.sin(ang);
  const px = -dz;
  const pz = dx;
  const N = 5;
  const prof = [0.35, 1, notch + 0.1, 0.95, notch, 0.55];
  let prev: [C3, C3] | null = null;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const w = i === N ? 0.04 * wid : wid * prof[i] * (1 - s * 0.45);
    const cx = ox + dx * len * s;
    const cz = oz + dz * len * s;
    const cy = oy + len * (up * s - droop * s * s) + LIFT;
    const lift = 0.14 * w;
    const L: C3 = [cx + px * w, cy + lift, cz + pz * w];
    const R: C3 = [cx - px * w, cy + lift, cz - pz * w];
    if (prev) {
      mb.poly4(prev[0], prev[1], R, L);
      mb.poly4(L, R, prev[1], prev[0]);
    }
    prev = [L, R];
  }
  mb.style = style;
}

/** A tropical tree's trunk as a run of beams along a bend: lateral offset (y/H)^2 * bend toward `ang`. Returns the top. */
function bentTrunk(mb: MeshBuilder, x: number, z: number, H: number, ang: number, bend: number, r0: number, r1: number, hex: number, segs = 7): C3 {
  mb.color = lin(hex);
  let prev: C3 = [x, 0, z];
  for (let i = 1; i <= segs; i++) {
    const f = i / segs;
    const off = f * f * bend;
    const p: C3 = [x + Math.cos(ang) * off, f * H, z + Math.sin(ang) * off];
    mb.beam([prev[0], prev[1] + LIFT, prev[2]], [p[0], p[1] + LIFT, p[2]], r0 + (r1 - r0) * f);
    prev = p;
  }
  return prev;
}

/**
 * Where trees are built, for whoever's listening (the district collects the landmarks' trees this way, for the
 * petals and leaves that fall under them): a tree's foot, its species and how far its crown reaches.
 */
export type TreeSink = (t: { x: number; z: number; species: TreeSpecies; reach: number }) => void;
let sink: TreeSink | null = null;
export function setTreeSink(s: TreeSink | null): void {
  sink = s;
}

export function addTree(mb: MeshBuilder, t: TreeSpec): void {
  const k = t.size ?? 1;
  sink?.({ x: t.x + (t.lean?.[0] ?? 0), z: t.z + (t.lean?.[1] ?? 0), species: t.species, reach: TREE_REACH[t.species] * k });
  SPECIES = TREE_SPECIES.indexOf(t.species);
  const v0 = mb.vertexCount;
  const rnd = rng(hash(t.seed ?? 0, Math.round(t.x * 8), Math.round(t.z * 8), 0x7ee5));
  // The crown's trunk stands at (x, z), lifted; a stem leans to it from the foot.
  const [lx, lz] = t.lean ?? [0, 0];
  const x = t.x + lx;
  const z = t.z + lz;
  const bark = rnd.pick(BARK);
  const greens = GREENS[t.species];
  const g = (): number => rnd.pick(greens);
  mb.kind = KIND.plain;
  mb.style = [0, 0, 0, 0];
  if (t.grate) {
    mb.color = lin(0x2a2a2a);
    mb.box(t.x, t.z, 0.15, 0.17, 1.2, 1.2);
  }
  const lift = Math.max(t.lift ?? 0, Math.hypot(lx, lz) > 0.3 ? 1.2 : 0);
  if (lift > 0) {
    mb.color = lin(bark);
    mb.beam([t.x, 0, t.z], [x, lift + 0.2, z], 0.22 * Math.max(0.6, k));
  }
  LIFT = lift;
  const around = (n: number, f: (a: number, i: number) => void): void => {
    const a0 = rnd.float() * Math.PI * 2;
    for (let i = 0; i < n; i++) f(a0 + (i / n) * Math.PI * 2 + (rnd.float() - 0.5) * 0.5, i);
  };
  switch (t.species) {
    case 'zelkova': {
      // Short trunk; four or five limbs fanning up and out; a broad vase of masses along and over them.
      const fork = 2.4 * k;
      trunk(mb, x, z, 0, fork + 0.4 * k, 0.26 * k, 0.18 * k, bark);
      around(5, (a) => {
        const reach = (2.2 + rnd.float() * 0.8) * k;
        const top: C3 = [x + Math.cos(a) * reach, (6.2 + rnd.float() * 1.2) * k, z + Math.sin(a) * reach];
        limb(mb, [x, fork, z], top, 0.13 * k, bark);
        mass(mb, top[0], top[1] - 0.4 * k, top[2], (2.0 + rnd.float() * 0.5) * k, 1.7 * k, g());
      });
      mass(mb, x, 7.6 * k, z, 2.3 * k, 1.3 * k, g());
      break;
    }
    case 'ginkgo':
    case 'ginkgoGold': {
      // Straight trunk through a tall narrowing cone of masses.
      trunk(mb, x, z, 0, 8.5 * k, 0.24 * k, 0.07 * k, bark);
      const tiers = 4;
      for (let i = 0; i < tiers; i++) {
        const f = i / (tiers - 1);
        const y = (3.1 + f * 5.8) * k;
        const r = (2.1 - f * 1.35) * k;
        around(i === tiers - 1 ? 1 : 2, (a) => {
          const off = i === tiers - 1 ? 0 : r * 0.4;
          mass(mb, x + Math.cos(a) * off, y, z + Math.sin(a) * off, r * 0.85, 1.05 * k, g(), 5);
        });
      }
      if (t.species === 'ginkgoGold') {
        // Fallen leaves round the foot.
        mb.color = lin(0xe8c030);
        mb.lathe(t.x, t.z, [[0.01, 0.2], [0.03, 2.2 * k]], 9);
      }
      break;
    }
    case 'sakura':
    case 'sakuraBloom': {
      // Short dark trunk, limbs spreading low and wide, a flat-topped spreading crown.
      const fork = 1.6 * k;
      trunk(mb, x, z, 0, fork + 0.3 * k, 0.28 * k, 0.2 * k, 0x3a2e28);
      around(5, (a) => {
        const reach = (3.0 + rnd.float() * 0.8) * k;
        const end: C3 = [x + Math.cos(a) * reach, (3.4 + rnd.float() * 0.8) * k, z + Math.sin(a) * reach];
        limb(mb, [x, fork, z], end, 0.11 * k, 0x3a2e28);
        mass(mb, end[0] - Math.cos(a) * 0.4 * k, end[1] + 0.4 * k, end[2] - Math.sin(a) * 0.4 * k, 2.1 * k, 1.05 * k, g());
      });
      mass(mb, x, 4.9 * k, z, 2.4 * k, 0.9 * k, g());
      if (t.species === 'sakuraBloom') {
        // Petals on the ground.
        mb.color = lin(0xf2d8e2);
        mb.lathe(t.x, t.z, [[0.01, 0.2], [0.03, 3.2 * k]], 10);
      }
      break;
    }
    case 'pine': {
      // A leaning trunk that bends back on itself, flat pads of needles at the limb ends.
      const lean = rnd.float() * Math.PI * 2;
      const pts: C3[] = [[x, 0, z]];
      let [px, pz] = [x, z];
      for (let i = 1; i <= 4; i++) {
        const bend = lean + (i % 2 ? 0.6 : -0.5);
        px += Math.cos(bend) * 0.55 * k;
        pz += Math.sin(bend) * 0.55 * k;
        pts.push([px, i * 1.35 * k, pz]);
      }
      for (let i = 0; i + 1 < pts.length; i++) limb(mb, pts[i], pts[i + 1], (0.26 - i * 0.04) * k, 0x4a3a30);
      const top = pts[pts.length - 1];
      mass(mb, top[0], top[1] + 0.3 * k, top[2], 1.5 * k, 0.45 * k, g());
      for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i];
        const a = lean + Math.PI + (rnd.float() - 0.5) * 1.6 + (i % 2) * 1.4;
        const reach = (1.6 + rnd.float()) * k;
        const end: C3 = [p[0] + Math.cos(a) * reach, p[1] + 0.4 * k, p[2] + Math.sin(a) * reach];
        limb(mb, p, end, 0.08 * k, 0x4a3a30);
        mass(mb, end[0], end[1], end[2], (1.1 + rnd.float() * 0.4) * k, 0.35 * k, g());
      }
      break;
    }
    case 'camphor': {
      // Thick trunk, big rounded dome of dense masses.
      trunk(mb, x, z, 0, 4 * k, 0.5 * k, 0.32 * k, bark);
      around(5, (a) => {
        const reach = 3.2 * k;
        limb(mb, [x, 3.2 * k, z], [x + Math.cos(a) * reach * 0.7, 6 * k, z + Math.sin(a) * reach * 0.7], 0.16 * k, bark);
        mass(mb, x + Math.cos(a) * reach, (5.6 + rnd.float()) * k, z + Math.sin(a) * reach, 2.7 * k, 1.9 * k, g());
      });
      around(2, (a) => mass(mb, x + Math.cos(a) * 1.4 * k, 8.2 * k, z + Math.sin(a) * 1.4 * k, 2.9 * k, 1.9 * k, g()));
      mass(mb, x, 9.4 * k, z, 2.2 * k, 1.4 * k, g());
      break;
    }
    case 'dogwood':
    case 'dogwoodBloom': {
      // A small round crown on a slim trunk: fits a 2 m pavement. In flower, each tree is one colour (pink or
      // cream bracts, as hanamizuki are) over green, so it reads as blossom rather than a pale ball under a lamp.
      trunk(mb, x, z, 0, 2.6 * k, 0.1 * k, 0.07 * k, bark);
      const bloom = t.species === 'dogwoodBloom' ? rnd.pick(DOGWOOD_BRACTS) : null;
      const leaf = (): number => rnd.pick(GREENS.dogwood);
      let n = 0;
      around(3, (a) => mass(mb, x + Math.cos(a) * 0.6 * k, (3.4 + rnd.float() * 0.4) * k, z + Math.sin(a) * 0.6 * k, 1.1 * k, 0.85 * k, bloom && n++ !== 1 ? bloom : leaf(), 5));
      mass(mb, x, 4.2 * k, z, 0.9 * k, 0.6 * k, bloom ?? leaf(), 5);
      break;
    }
    case 'azalea': {
      // A low mound, flowers dotted over it.
      mass(mb, x, 0.45 * k, z, 0.9 * k, 0.45 * k, g());
      flowers(mb, rnd, x, z, 0.8 * k, 0.45 * k, rnd.pick([0xd04a8a, 0xe06aa0, 0xe8e0e8, 0xc83a5a]));
      break;
    }
    case 'box': {
      // A clipped ball on a short stem.
      mass(mb, x, 0.6 * k, z, 0.6 * k, 0.55 * k, g(), 6);
      break;
    }
    case 'coconut': {
      // A tall slender trunk leaning and curving (bend (y/H)^2), a collar of drooping pinnate fronds, a few nuts.
      const H = (8.5 + rnd.float() * 2.5) * k;
      const lean = rnd.float() * Math.PI * 2;
      const top = bentTrunk(mb, x, z, H, lean, (1.4 + rnd.float() * 1.4) * k, 0.2 * k, 0.11 * k, 0x8c7c66, 7);
      around(10, (a, i) => {
        const high = i % 3 === 0;
        frond(mb, top[0], top[1], top[2], a, (high ? 2.6 : 3.5) * k, high ? 1.5 : 0.7, high ? 1.0 : 1.5, 0.55 * k, g());
      });
      mb.color = lin(0x5a6a2a);
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + rnd.float();
        mb.lathe(top[0] + Math.cos(a) * 0.22 * k, top[2] + Math.sin(a) * 0.22 * k, [[top[1] + LIFT - 0.5 * k, 0.04], [top[1] + LIFT - 0.3 * k, 0.17 * k], [top[1] + LIFT - 0.05, 0.12 * k]], 5);
      }
      break;
    }
    case 'royalPalm': {
      // A straight pale smooth column swelling a little low down, a green crownshaft, an upright-spreading crown.
      const H = (11 + rnd.float() * 2.5) * k;
      mb.color = lin(0xb8b0a2);
      mb.lathe(x, z, [[LIFT, 0.42 * k], [LIFT + H * 0.25, 0.4 * k], [LIFT + H * 0.5, 0.3 * k], [LIFT + H, 0.26 * k]], 6);
      mb.color = lin(0x6f9a46);
      mb.lathe(x, z, [[LIFT + H, 0.27 * k], [LIFT + H + 1.5 * k, 0.24 * k], [LIFT + H + 1.7 * k, 0.12 * k]], 6);
      const top = H + 1.5 * k;
      around(12, (a, i) => {
        const high = i % 3 === 0;
        frond(mb, x, top, z, a, (high ? 3.2 : 4.0) * k, high ? 2.4 : 1.2, high ? 0.9 : 1.6, 0.6 * k, g());
      });
      break;
    }
    case 'banana': {
      // A short pale pseudo-stem and broad paddle leaves, torn, arching out; a green hand of fruit.
      const H = (2.2 + rnd.float() * 0.8) * k;
      mb.color = lin(0x9ab05a);
      mb.lathe(x, z, [[LIFT, 0.2 * k], [LIFT + H, 0.13 * k]], 6);
      around(8, (a, i) => {
        const high = i % 2 === 0;
        frond(mb, x, H, z, a, (high ? 2.0 : 2.8) * k, high ? 1.7 : 0.9, high ? 0.9 : 1.5, 0.78 * k, g(), 0.55);
      });
      mb.color = lin(0x7a9a38);
      mb.lathe(x + 0.25 * k, z, [[LIFT + H - 0.7 * k, 0.03], [LIFT + H - 0.4 * k, 0.16 * k], [LIFT + H - 0.05, 0.06]], 5);
      break;
    }
    case 'raintree': {
      // A thick short trunk, limbs sweeping out and up, a wide flat-topped umbrella of shallow masses.
      const fork = 3.0 * k;
      trunk(mb, x, z, 0, fork + 0.4 * k, 0.5 * k, 0.38 * k, 0x4e4034);
      around(5, (a) => {
        const reach = (3.4 + rnd.float() * 0.6) * k;
        const top: C3 = [x + Math.cos(a) * reach, (6.6 + rnd.float() * 0.8) * k, z + Math.sin(a) * reach];
        limb(mb, [x, fork, z], top, 0.17 * k, 0x4e4034);
        mass(mb, top[0], top[1] + 0.5 * k, top[2], 2.9 * k, 1.0 * k, g());
      });
      mass(mb, x, 7.9 * k, z, 3.0 * k, 1.0 * k, g());
      break;
    }
    case 'mango': {
      // A dense, round, dark crown on a stout trunk.
      trunk(mb, x, z, 0, 2.4 * k, 0.4 * k, 0.3 * k, 0x3e3228);
      around(4, (a) => mass(mb, x + Math.cos(a) * 1.5 * k, (4.2 + rnd.float() * 0.6) * k, z + Math.sin(a) * 1.5 * k, 2.3 * k, 1.9 * k, g()));
      mass(mb, x, 6.0 * k, z, 2.4 * k, 1.8 * k, g());
      break;
    }
    case 'bougainvillea': {
      // A sprawling shrub: a green core under heaps of magenta bracts.
      mass(mb, x, 0.7 * k, z, 0.9 * k, 0.65 * k, g());
      around(3, (a) => mass(mb, x + Math.cos(a) * 0.55 * k, (0.8 + rnd.float() * 0.4) * k, z + Math.sin(a) * 0.55 * k, 0.65 * k, 0.5 * k, rnd.pick(BOUGAINVILLEA)));
      mass(mb, x, 1.3 * k, z, 0.6 * k, 0.4 * k, rnd.pick(BOUGAINVILLEA));
      break;
    }
  }
  LIFT = 0;
  mb.kind = KIND.plain;
  // Everything but the grate and the fallen leaves sways in the wind (real/city.ts), the more the higher up.
  mb.sway(v0);
}

/** Small flower blobs over a mound of radius r, height h. */
function flowers(mb: MeshBuilder, rnd: Rng, x: number, z: number, r: number, h: number, hex: number): void {
  mb.color = lin(hex);
  for (let i = 0; i < 12; i++) {
    const a = rnd.float() * Math.PI * 2;
    const d = Math.sqrt(rnd.float()) * r;
    const y = LIFT + h + Math.sqrt(Math.max(0, 1 - (d / r) ** 2)) * h * 0.9;
    mb.box(x + Math.cos(a) * d, z + Math.sin(a) * d, y - 0.04, y + 0.05, 0.12, 0.12);
  }
}
