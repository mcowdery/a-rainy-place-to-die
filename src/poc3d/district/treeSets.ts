/**
 * Which trees a city plants where (CityConfig.trees; real/props.ts, real/openLots.ts and real/dressing.ts read it
 * through cityConfig.ts `treeSet()`). Tōto's is the Japanese set (zelkova, ginkgo, cherry, pine, camphor, dogwood,
 * azalea, box), Manila's the tropical one (royal and coconut palms, rain tree, mango, banana, bougainvillea).
 */
import type { TreeSpecies } from '../models/trees';

/** A street's species by a roll of 0-99 (per line of street): the first cut the roll is under, else `rest`. `homey` cuts move down in the residential quarters. */
export type TreeCuts = { readonly cuts: readonly (readonly [TreeSpecies, number, boolean])[]; readonly rest: TreeSpecies };

export interface TreeSet {
  /** Boulevards (pavements from 14 m of street) and ordinary streets. */
  readonly boulevard: TreeCuts;
  readonly street: TreeCuts;
  /** Along the bay promenade and the river walk, picked by position along it (every third bay tree is left out). */
  readonly bay: readonly TreeSpecies[];
  readonly riverWalk: readonly TreeSpecies[];
  /** The row along the city's edge, and the trees dotted through small closed grounds. */
  readonly verge: TreeSpecies;
  readonly grove: TreeSpecies;
  /** Weights for plazas and parks, the park's pond and path-side picks, and the pocket playgrounds' trees (those in `playgroundFull` at full size). */
  readonly plaza: Readonly<Record<string, number>>;
  readonly park: Readonly<Record<string, number>>;
  readonly parkPond: TreeSpecies;
  readonly parkPath: TreeSpecies;
  readonly playground: readonly TreeSpecies[];
  readonly playgroundFull: readonly TreeSpecies[];
  /** Planting beds and shopfront greenery. */
  readonly shrubs: {
    readonly hub: TreeSpecies;
    readonly gate: TreeSpecies;
    readonly hedgeFlower: TreeSpecies;
    readonly hedgePlain: TreeSpecies;
    readonly potTall: TreeSpecies;
    readonly potRound: TreeSpecies;
    readonly potRoundAlt: TreeSpecies;
    readonly planterFirst: TreeSpecies;
    readonly planterRest: TreeSpecies;
  };
}

export const TOTO_TREES: TreeSet = {
  boulevard: { cuts: [['ginkgo', 45, false], ['zelkova', 78, true]], rest: 'sakura' },
  street: { cuts: [['ginkgo', 32, true], ['dogwood', 70, true]], rest: 'sakura' },
  bay: ['pine'],
  riverWalk: ['sakura'],
  verge: 'camphor',
  grove: 'zelkova',
  plaza: { zelkova: 40, camphor: 25, ginkgo: 20, sakura: 15 },
  park: { zelkova: 18, camphor: 16, sakura: 34, ginkgo: 10, pine: 8, dogwood: 10, dogwoodBloom: 4 },
  parkPond: 'pine',
  parkPath: 'sakura',
  playground: ['sakura', 'dogwood', 'zelkova'],
  playgroundFull: ['dogwood'],
  shrubs: { hub: 'azalea', gate: 'box', hedgeFlower: 'azalea', hedgePlain: 'box', potTall: 'camphor', potRound: 'azalea', potRoundAlt: 'box', planterFirst: 'azalea', planterRest: 'box' },
};

export const MANILA_TREES: TreeSet = {
  // Palms dominate (the user's brief): royal and coconut palms on the boulevards with flame trees, rain trees the few.
  boulevard: { cuts: [['royalPalm', 44, false], ['coconut', 80, true], ['flametree', 92, true]], rest: 'raintree' },
  street: { cuts: [['coconut', 40, true], ['banana', 52, true], ['mango', 64, true], ['flametree', 72, true], ['royalPalm', 82, true]], rest: 'raintree' },
  bay: ['coconut', 'coconut', 'royalPalm'],
  riverWalk: ['coconut', 'coconut', 'flametree'],
  verge: 'mango',
  grove: 'mango',
  plaza: { coconut: 32, royalPalm: 20, banyan: 14, raintree: 14, flametree: 12, mango: 8 },
  park: { coconut: 32, royalPalm: 10, banana: 12, banyan: 8, raintree: 10, flametree: 8, mango: 10, bougainvillea: 10 },
  parkPond: 'coconut',
  parkPath: 'royalPalm',
  playground: ['mango', 'banana', 'bougainvillea'],
  playgroundFull: ['banana', 'bougainvillea'],
  shrubs: { hub: 'bougainvillea', gate: 'bougainvillea', hedgeFlower: 'bougainvillea', hedgePlain: 'camphor', potTall: 'banana', potRound: 'bougainvillea', potRoundAlt: 'camphor', planterFirst: 'bougainvillea', planterRest: 'camphor' },
};
