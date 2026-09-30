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
 */
export const TREE_SPECIES = ['zelkova', 'ginkgo', 'ginkgoGold', 'sakura', 'sakuraBloom', 'pine', 'camphor', 'dogwood', 'dogwoodBloom', 'azalea', 'box'] as const;
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
};

/** Flowering dogwood's bracts: three pinks (a tree is one of them; cream ones read as a pale ball under a lamp). */
const DOGWOOD_BRACTS = [0xd98aa8, 0xe2a2ba, 0xcf7f9f] as const;

/** A lumpy foliage mass: an ellipsoid-ish lathe, radius rx, half-height ry, centred at (x, y, z); 15 quads. */
function mass(mb: MeshBuilder, x: number, y: number, z: number, rx: number, ry: number, hex: number, n = 5): void {
  mb.color = lin(hex);
  y += LIFT;
  // Crowns are tagged with their species (style.x = FOLIAGE_TAG + index), so the city shader can colour them by
  // the season (blossom, summer green, autumn colour, bare in winter) without rebuilding anything.
  const style = mb.style;
  mb.style = [FOLIAGE_TAG + SPECIES, 0, 0, 0];
  mb.lathe(x, z, [[y - ry, rx * 0.15], [y - ry * 0.4, rx * 0.95], [y + ry * 0.35, rx * 0.88], [y + ry, rx * 0.12]], n);
  mb.style = style;
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

export function addTree(mb: MeshBuilder, t: TreeSpec): void {
  const k = t.size ?? 1;
  SPECIES = TREE_SPECIES.indexOf(t.species);
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
  }
  LIFT = 0;
  mb.kind = KIND.plain;
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
