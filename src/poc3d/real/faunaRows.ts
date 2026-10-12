import type { FaunaKind } from '../district/faunaMix';

/**
 * The animals' candidates (assets/animals/): per city, a row for each animal and in it every model the user has not rejected, with
 * the clip of a rigged one to play. The showrooms (showroom/rooms/fauna.ts, fauna-ph.ts) draw them side by side for review; the city
 * (real/faunaCity.ts, behind `?fauna=1`) draws them in the street. A candidate is `from: 'built'` (the shapes made in code), a file's
 * id in assets/animals/candidates/, or `rig:<name>` in assets/animals/rigged/ (made by scripts/animals/rig.py).
 */
export interface Cand {
  /** Who made it and what it's called. */
  readonly name: string;
  readonly from: string;
  /** The clip of a rigged file to play. */
  readonly clip?: string;
  /** Its length (m) along its longest side, the tail and the wings in. */
  readonly len?: number;
  /** Turns it about (rad) when it comes out facing the wrong way. */
  readonly yaw?: number;
  /** Held up off the ground (m): a flying one. */
  readonly lift?: number;
  /** Which tint of the built one (an index). */
  readonly variant?: number;
}

export interface Row {
  /** The review key (with the file's id it names a verdict). */
  readonly key: string;
  readonly name: string;
  readonly group: 'On the ground' | 'In the air' | 'In and by the water';
  /** The kind the built candidate is. */
  readonly kind?: FaunaKind;
  readonly cands: readonly Cand[];
}

/** Which simulated kind a row's animals are (the herons are egrets; the koi are fish in a pond, not in the street). */
export const ROW_KIND: Readonly<Record<string, FaunaKind | null>> = {
  sparrow: 'sparrow', pigeon: 'pigeon', crow: 'crow', gull: 'gull', egret: 'egret', heron: 'egret', cat: 'cat', dog: 'dog', chicken: 'chicken',
  fox: 'fox', tanuki: 'tanuki', squirrel: 'squirrel', rat: 'rat', duck: 'duck', koi: null, turtle: 'turtle', frog: 'frog', beetle: 'beetle',
  snail: 'snail', goat: 'goat', pig: null, cow: null, horse: null, gecko: 'gecko', lizard: 'lizard', parrot: 'parrot', cockroach: 'cockroach',
  crab: 'crab', monkey: 'monkey', butterfly: 'butterfly', dragonfly: 'dragonfly', moth: 'moth', firefly: 'firefly',
};

const P = 'Poly by Google';
export const TOTO_ROWS: readonly Row[] = [
  { key: 'sparrow', name: 'sparrow (suzume)', group: 'On the ground', cands: [{ name: `${P}: Sparrow`, from: '3rTjKefT184', len: 0.15 }, { name: `${P}: Sparrow, animated: Walk`, from: 'rig:sparrow', clip: 'Walk', len: 0.15  }, { name: `${P}: Sparrow, animated: Run`, from: 'rig:sparrow', clip: 'Run', len: 0.15  }, { name: `${P}: Sparrow, animated: Peck`, from: 'rig:sparrow', clip: 'Peck', len: 0.15  }, { name: `${P}: Sparrow (2)`, from: '4uL9XFDcdQK', len: 0.15 }] },
  { key: 'pigeon', name: 'pigeon and dove (hato)', group: 'On the ground', cands: [{ name: `${P}: Mourning dove`, from: '1cF8DTp2sAi', len: 0.32 }, { name: `${P}: Mourning dove, animated: Walk`, from: 'rig:dove', clip: 'Walk', len: 0.32  }, { name: `${P}: Mourning dove, animated: Run`, from: 'rig:dove', clip: 'Run', len: 0.32  }, { name: `${P}: Mourning dove, animated: Peck`, from: 'rig:dove', clip: 'Peck', len: 0.32  }] },
  { key: 'crow', name: 'crow (karasu)', group: 'On the ground', cands: [{ name: `${P}: Crow`, from: '1MIvWQ5Q3R9', len: 0.5 }, { name: `${P}: Crow, animated: Walk`, from: 'rig:crow', clip: 'Walk', len: 0.5  }, { name: `${P}: Crow, animated: Run`, from: 'rig:crow', clip: 'Run', len: 0.5  }, { name: `${P}: Crow, animated: Peck`, from: 'rig:crow', clip: 'Peck', len: 0.5  }] },
  {
    key: 'gull',
    name: 'black-tailed gull (umineko)',
    group: 'On the ground',
    cands: [
      { name: `${P}: Seagull`, from: '0WRzrtCIIRp', len: 0.55 }, { name: `${P}: Seagull, animated: Walk`, from: 'rig:seagull', clip: 'Walk', len: 0.55  }, { name: `${P}: Seagull, animated: Run`, from: 'rig:seagull', clip: 'Run', len: 0.55  }, { name: `${P}: Seagull, animated: Peck`, from: 'rig:seagull', clip: 'Peck', len: 0.55  },
      { name: `${P}: Gull`, from: '7sQHkW0ylJy', len: 0.55 }, { name: `${P}: Gull, animated: Walk`, from: 'rig:gull2', clip: 'Walk', len: 0.55  }, { name: `${P}: Gull, animated: Run`, from: 'rig:gull2', clip: 'Run', len: 0.55  }, { name: `${P}: Gull, animated: Peck`, from: 'rig:gull2', clip: 'Peck', len: 0.55  },
      { name: `${P}: Seagull (2)`, from: 'dUFuQoM-k3s', len: 0.55 }, { name: `${P}: Seagull (2), animated: Walk`, from: 'rig:gull3', clip: 'Walk', len: 0.55  }, { name: `${P}: Seagull (2), animated: Run`, from: 'rig:gull3', clip: 'Run', len: 0.55  }, { name: `${P}: Seagull (2), animated: Peck`, from: 'rig:gull3', clip: 'Peck', len: 0.55  },
      { name: `${P}: Flying seagull`, from: '6Tpj_vcWP3f', len: 1.2, lift: 1.5 },
      { name: `${P}: Flying gull`, from: 'eMNhHDZakYp', len: 1.2, lift: 1.5 }, { name: `${P}: Flying gull, animated: Flap`, from: 'rig:gullfly2', clip: 'Flap', len: 1.2, lift: 1.5  }, { name: `${P}: Flying gull, animated: Hover`, from: 'rig:gullfly2', clip: 'Hover', len: 1.2, lift: 1.5  },
      { name: `${P}: Flying seagull, animated: Flap`, from: 'rig:gull_fly', clip: 'Flap', len: 1.2, lift: 1.5, yaw: -Math.PI / 2 },
      { name: `${P}: Flying seagull, animated: Glide`, from: 'rig:gull_fly', clip: 'Glide', len: 1.2, lift: 1.5, yaw: -Math.PI / 2 },
    ],
  },
  {
    key: 'cat',
    name: 'cat (neko)',
    group: 'On the ground',
    cands: [
      { name: `${P}: Cat`, from: '6dM1J6f6pm9', len: 0.55 },
      { name: `${P}: Kitten`, from: 'dBJgGEu5bHW', len: 0.4 }, { name: `${P}: Kitten, animated: Walk`, from: 'rig:kitten', clip: 'Walk', len: 0.4  }, { name: `${P}: Kitten, animated: Run`, from: 'rig:kitten', clip: 'Run', len: 0.4  }, { name: `${P}: Kitten, animated: Sniff`, from: 'rig:kitten', clip: 'Sniff', len: 0.4  },
              { name: 'madtrollstudio: Cat', from: 'YvVobPlTlQ', len: 0.55 }, { name: 'madtrollstudio: Cat, animated: Walk', from: 'rig:cat2', clip: 'Walk', len: 0.55  }, { name: 'madtrollstudio: Cat, animated: Run', from: 'rig:cat2', clip: 'Run', len: 0.55  }, { name: 'madtrollstudio: Cat, animated: Sniff', from: 'rig:cat2', clip: 'Sniff', len: 0.55  },
      { name: 'elkiotbear: Cat', from: 'ovFy5UldDq', len: 0.55 },
              { name: 'Hiroyuki Kajiwara: Cat loaf', from: '5qGO_C5GvAB', len: 0.5 },
      { name: `${P}: Cat, animated: Walk`, from: 'rig:cat', clip: 'Walk', len: 0.55 },
      { name: `${P}: Cat, animated: Run`, from: 'rig:cat', clip: 'Run', len: 0.55 },
      { name: `${P}: Cat, animated: Idle`, from: 'rig:cat', clip: 'Idle', len: 0.55 },
      { name: `${P}: Cat, animated: Sit`, from: 'rig:cat', clip: 'Sit', len: 0.55 },
      { name: `${P}: Cat, animated: Loaf`, from: 'rig:cat', clip: 'Loaf', len: 0.55 },
    ],
  },
  {
    key: 'dog',
    name: 'dog (Shiba, inu)',
    group: 'On the ground',
    cands: [
      { name: 'Pat Siefring: Shiba Inu', from: '1sr1MDt9db5', len: 0.85 }, { name: 'Pat Siefring: Shiba Inu, animated: Walk', from: 'rig:shiba', clip: 'Walk', len: 0.85  }, { name: 'Pat Siefring: Shiba Inu, animated: Run', from: 'rig:shiba', clip: 'Run', len: 0.85  }, { name: 'Pat Siefring: Shiba Inu, animated: Sniff', from: 'rig:shiba', clip: 'Sniff', len: 0.85  },
      { name: 'elkiotbear: Black Shiba Inu (animated)', from: 'aT17TtLWOL', len: 0.85 },
      { name: 'elkiotbear: Brown Shiba Inu', from: 'ieGuPyxGTr', len: 0.85 },
            ],
  },
  { key: 'fox', name: 'fox (kitsune)', group: 'On the ground', cands: [{ name: `${P}: Fox`, from: '10u8FYPC5Br', len: 0.9 }, { name: `${P}: Fox, animated: Walk`, from: 'rig:fox', clip: 'Walk', len: 0.9  }, { name: `${P}: Fox, animated: Run`, from: 'rig:fox', clip: 'Run', len: 0.9  }, { name: `${P}: Fox, animated: Sniff`, from: 'rig:fox', clip: 'Sniff', len: 0.9  }] },
  { key: 'tanuki', name: 'tanuki (stand-in: a raccoon)', group: 'On the ground', cands: [{ name: `${P}: Raccoon`, from: '2iYORwFng3_', len: 0.7 }, { name: `${P}: Raccoon, animated: Walk`, from: 'rig:raccoon', clip: 'Walk', len: 0.7  }, { name: `${P}: Raccoon, animated: Run`, from: 'rig:raccoon', clip: 'Run', len: 0.7  }, { name: `${P}: Raccoon, animated: Sniff`, from: 'rig:raccoon', clip: 'Sniff', len: 0.7  }] },
  { key: 'monkey', name: 'macaque stand-in (saru): a capuchin', group: 'On the ground', cands: [{ name: 'Poly by Google: Capuchin', from: '29hG1_J1Uiq', len: 0.9 }, { name: 'Poly by Google: Capuchin, animated: Idle', from: 'rig:monkey', clip: 'Idle', len: 0.9 }, { name: 'Poly by Google: Capuchin, animated: Walk', from: 'rig:monkey', clip: 'Walk', len: 0.9 }, { name: 'Poly by Google: Capuchin, animated: Run', from: 'rig:monkey', clip: 'Run', len: 0.9 }, { name: 'Poly by Google: Capuchin, animated: Sniff', from: 'rig:monkey', clip: 'Sniff', len: 0.9 }] },
  { key: 'squirrel', name: 'squirrel (risu)', group: 'On the ground', cands: [{ name: `${P}: Squirrel`, from: 'caxos24uWC9', len: 0.28 }, { name: `${P}: Squirrel, animated: Walk`, from: 'rig:squirrel', clip: 'Walk', len: 0.28  }, { name: `${P}: Squirrel, animated: Run`, from: 'rig:squirrel', clip: 'Run', len: 0.28  }, { name: `${P}: Squirrel, animated: Sniff`, from: 'rig:squirrel', clip: 'Sniff', len: 0.28  }] },
  { key: 'rat', name: 'rat (nezumi)', group: 'On the ground', cands: [{ name: `${P}: Rat`, from: '6hsesZHvcPI', len: 0.25 }, { name: `${P}: Rat, animated: Walk`, from: 'rig:rat', clip: 'Walk', len: 0.25  }, { name: `${P}: Rat, animated: Run`, from: 'rig:rat', clip: 'Run', len: 0.25  }, { name: `${P}: Rat, animated: Sniff`, from: 'rig:rat', clip: 'Sniff', len: 0.25  }, ] },
  { key: 'duck', name: 'mallard (kamo)', group: 'In and by the water', cands: [{ name: `${P}: Mallard duck`, from: 'frSLi6b6Vid', len: 0.55 }, { name: `${P}: Mallard duck, animated: Walk`, from: 'rig:duck1', clip: 'Walk', len: 0.55  }, { name: `${P}: Mallard duck, animated: Run`, from: 'rig:duck1', clip: 'Run', len: 0.55  }, { name: `${P}: Mallard duck, animated: Peck`, from: 'rig:duck1', clip: 'Peck', len: 0.55  }, { name: `${P}: Duck`, from: '6HpauUCfIAb', len: 0.5 }, { name: `${P}: Duck, animated: Walk`, from: 'rig:duck2', clip: 'Walk', len: 0.5  }, { name: `${P}: Duck, animated: Run`, from: 'rig:duck2', clip: 'Run', len: 0.5  }, { name: `${P}: Duck, animated: Peck`, from: 'rig:duck2', clip: 'Peck', len: 0.5  }] },
  {
    key: 'heron',
    name: 'heron and egret (sagi)',
    group: 'In and by the water',
    cands: [
      { name: `${P}: Heron`, from: '74guNhJR5Ij', len: 0.9 }, { name: `${P}: Heron, animated: Walk`, from: 'rig:heron', clip: 'Walk', len: 0.9  }, { name: `${P}: Heron, animated: Run`, from: 'rig:heron', clip: 'Run', len: 0.9  }, { name: `${P}: Heron, animated: Peck`, from: 'rig:heron', clip: 'Peck', len: 0.9  },
      { name: `${P}: Blue heron`, from: 'dMR6NWzjlYT', len: 0.9 }, { name: `${P}: Blue heron, animated: Walk`, from: 'rig:blueheron', clip: 'Walk', len: 0.9  }, { name: `${P}: Blue heron, animated: Run`, from: 'rig:blueheron', clip: 'Run', len: 0.9  }, { name: `${P}: Blue heron, animated: Peck`, from: 'rig:blueheron', clip: 'Peck', len: 0.9  },
      { name: `${P}: Great egret`, from: '4GacWAa1lit', len: 0.9 }, { name: `${P}: Great egret, animated: Walk`, from: 'rig:egret', clip: 'Walk', len: 0.9  }, { name: `${P}: Great egret, animated: Run`, from: 'rig:egret', clip: 'Run', len: 0.9  }, { name: `${P}: Great egret, animated: Peck`, from: 'rig:egret', clip: 'Peck', len: 0.9  },
      { name: `${P}: Snowy egret`, from: '8VTUh9niy9k', len: 0.6 }, { name: `${P}: Snowy egret, animated: Walk`, from: 'rig:snowyegret', clip: 'Walk', len: 0.6  }, { name: `${P}: Snowy egret, animated: Run`, from: 'rig:snowyegret', clip: 'Run', len: 0.6  }, { name: `${P}: Snowy egret, animated: Peck`, from: 'rig:snowyegret', clip: 'Peck', len: 0.6  },
    ],
  },
  { key: 'koi', name: 'koi (goldfish stand-ins)', group: 'In and by the water', cands: [{ name: `${P}: Goldfish`, from: '3GPUntjwqCa', len: 0.3, lift: 0.4 }, { name: `${P}: Goldfish, animated: Swim`, from: 'rig:koi1', clip: 'Swim', len: 0.3, lift: 0.4  }, { name: `${P}: Goldfish (2)`, from: '0bOZGc8ONrx', len: 0.3, lift: 0.4 }] },
  { key: 'turtle', name: 'pond turtle (kame)', group: 'In and by the water', cands: [{ name: `${P}: Turtle`, from: '2LCcq8vhqJ3', len: 0.3 }, { name: `${P}: Turtle, animated: Walk`, from: 'rig:turtle1', clip: 'Walk', len: 0.3  }, { name: `${P}: Turtle, animated: Idle`, from: 'rig:turtle1', clip: 'Idle', len: 0.3  }, { name: `${P}: Turtle (2)`, from: 'c6n73UnGEP4', len: 0.3 }, { name: `${P}: Turtle (2), animated: Walk`, from: 'rig:turtle2', clip: 'Walk', len: 0.3  }, { name: `${P}: Turtle (2), animated: Idle`, from: 'rig:turtle2', clip: 'Idle', len: 0.3  }] },
  {
    key: 'frog',
    name: 'frog (kaeru)',
    group: 'In and by the water',
    cands: [{ name: `${P}: Tree frog`, from: 'cwyNyIba6WE', len: 0.05 }, { name: `${P}: Tree frog, animated: Hop`, from: 'rig:frog', clip: 'Hop', len: 0.05  }, ],
  },
  { key: 'beetle', name: 'beetle (kabutomushi stand-in)', group: 'On the ground', cands: [{ name: `${P}: Beetle`, from: '4yufxgZ1QQ2', len: 0.05 }, { name: `${P}: Beetle, animated: Walk`, from: 'rig:beetle', clip: 'Walk', len: 0.05  }, { name: `${P}: Beetle, animated: Idle`, from: 'rig:beetle', clip: 'Idle', len: 0.05  }] },
  { key: 'snail', name: 'snail (katatsumuri)', group: 'On the ground', cands: [{ name: `${P}: Snail`, from: 'aZ_cT-AIu2y', len: 0.05 }, { name: `${P}: Snail, animated: Glide`, from: 'rig:snail', clip: 'Glide', len: 0.05  }] },
  {
    key: 'butterfly',
    name: 'butterfly (chō)',
    group: 'In the air',
    kind: 'butterfly',
    cands: [{ name: 'built in code', from: 'built', variant: 0 }, { name: `${P}: Butterfly`, from: '2ZwYwkTVnfG', len: 0.07 }, { name: `${P}: Butterfly (2)`, from: '814CINpG3H1', len: 0.07 }, { name: `${P}: Butterfly (2), animated: Flap`, from: 'rig:butterfly1', clip: 'Flap', len: 0.07 , yaw: Math.PI }, { name: `${P}: Butterfly (2), animated: Hover`, from: 'rig:butterfly1', clip: 'Hover', len: 0.07 , yaw: Math.PI }],
  },
  {
    key: 'dragonfly',
    name: 'dragonfly (tonbo)',
    group: 'In the air',
    kind: 'dragonfly',
    cands: [
      { name: 'built in code', from: 'built', variant: 2 },
      { name: `${P}: Dragonfly`, from: '0myA_BOcZrD', len: 0.08 }, { name: `${P}: Dragonfly, animated: Flap`, from: 'rig:dragonfly1', clip: 'Flap', len: 0.08, yaw: Math.PI }, { name: `${P}: Dragonfly, animated: Hover`, from: 'rig:dragonfly1', clip: 'Hover', len: 0.08, yaw: Math.PI },
      { name: 'AssetQuest: Dragonfly', from: 'de6jep5Fq5', len: 0.08 }, { name: 'AssetQuest: Dragonfly, animated: Flap', from: 'rig:dragonfly2', clip: 'Flap', len: 0.08, yaw: Math.PI }, { name: 'AssetQuest: Dragonfly, animated: Hover', from: 'rig:dragonfly2', clip: 'Hover', len: 0.08, yaw: Math.PI },
      { name: 'AssetQuest: Red dragonfly (akatonbo)', from: 'UIxtFAD1ve', len: 0.08 }, { name: 'AssetQuest: Red dragonfly (akatonbo), animated: Flap', from: 'rig:dragonfly3', clip: 'Flap', len: 0.08, yaw: Math.PI }, { name: 'AssetQuest: Red dragonfly (akatonbo), animated: Hover', from: 'rig:dragonfly3', clip: 'Hover', len: 0.08, yaw: Math.PI },
            ],
  },
  { key: 'moth', name: 'moth (ga)', group: 'In the air', kind: 'moth', cands: [{ name: 'built in code', from: 'built', variant: 0 }, { name: "Lee Mason: Lil' Moth", from: '8ojwMQpu6DK', len: 0.05 }, { name: "Lee Mason: Lil' Moth, animated: Flap", from: 'rig:moth', clip: 'Flap', len: 0.05, yaw: Math.PI }, { name: "Lee Mason: Lil' Moth, animated: Hover", from: 'rig:moth', clip: 'Hover', len: 0.05, yaw: Math.PI }] },
  { key: 'firefly', name: 'firefly (hotaru)', group: 'In the air', kind: 'firefly', cands: [{ name: 'built in code', from: 'built', variant: 0 }] },
];

export const MANILA_ROWS: readonly Row[] = [
  { key: 'sparrow', name: 'tree sparrow (maya)', group: 'On the ground', cands: [{ name: `${P}: Sparrow`, from: '3rTjKefT184', len: 0.15 }, { name: `${P}: Sparrow, animated: Walk`, from: 'rig:sparrow', clip: 'Walk', len: 0.15  }, { name: `${P}: Sparrow, animated: Run`, from: 'rig:sparrow', clip: 'Run', len: 0.15  }, { name: `${P}: Sparrow, animated: Peck`, from: 'rig:sparrow', clip: 'Peck', len: 0.15  }, { name: `${P}: Sparrow (2)`, from: '4uL9XFDcdQK', len: 0.15 }] },
  { key: 'pigeon', name: 'pigeon (kalapati)', group: 'On the ground', cands: [{ name: `${P}: Mourning dove`, from: '1cF8DTp2sAi', len: 0.32 }, { name: `${P}: Mourning dove, animated: Walk`, from: 'rig:dove', clip: 'Walk', len: 0.32  }, { name: `${P}: Mourning dove, animated: Run`, from: 'rig:dove', clip: 'Run', len: 0.32  }, { name: `${P}: Mourning dove, animated: Peck`, from: 'rig:dove', clip: 'Peck', len: 0.32  }] },
  {
    key: 'egret',
    name: 'egret (tagak)',
    group: 'In and by the water',
    kind: 'egret',
    cands: [
              { name: `${P}: Great egret`, from: '4GacWAa1lit', len: 0.9 }, { name: `${P}: Great egret, animated: Walk`, from: 'rig:egret', clip: 'Walk', len: 0.9  }, { name: `${P}: Great egret, animated: Run`, from: 'rig:egret', clip: 'Run', len: 0.9  }, { name: `${P}: Great egret, animated: Peck`, from: 'rig:egret', clip: 'Peck', len: 0.9  },
      { name: `${P}: Snowy egret`, from: '8VTUh9niy9k', len: 0.6 }, { name: `${P}: Snowy egret, animated: Walk`, from: 'rig:snowyegret', clip: 'Walk', len: 0.6  }, { name: `${P}: Snowy egret, animated: Run`, from: 'rig:snowyegret', clip: 'Run', len: 0.6  }, { name: `${P}: Snowy egret, animated: Peck`, from: 'rig:snowyegret', clip: 'Peck', len: 0.6  },
      { name: `${P}: Heron`, from: '74guNhJR5Ij', len: 0.9 }, { name: `${P}: Heron, animated: Walk`, from: 'rig:heron', clip: 'Walk', len: 0.9  }, { name: `${P}: Heron, animated: Run`, from: 'rig:heron', clip: 'Run', len: 0.9  }, { name: `${P}: Heron, animated: Peck`, from: 'rig:heron', clip: 'Peck', len: 0.9  },
      { name: `${P}: Blue heron`, from: 'dMR6NWzjlYT', len: 0.9 }, { name: `${P}: Blue heron, animated: Walk`, from: 'rig:blueheron', clip: 'Walk', len: 0.9  }, { name: `${P}: Blue heron, animated: Run`, from: 'rig:blueheron', clip: 'Run', len: 0.9  }, { name: `${P}: Blue heron, animated: Peck`, from: 'rig:blueheron', clip: 'Peck', len: 0.9  },
    ],
  },
  {
    key: 'gull',
    name: 'tern (sterna)',
    group: 'In and by the water',
    cands: [
      { name: `${P}: Seagull`, from: '0WRzrtCIIRp', len: 0.5 }, { name: `${P}: Seagull, animated: Walk`, from: 'rig:seagull', clip: 'Walk', len: 0.5  }, { name: `${P}: Seagull, animated: Run`, from: 'rig:seagull', clip: 'Run', len: 0.5  }, { name: `${P}: Seagull, animated: Peck`, from: 'rig:seagull', clip: 'Peck', len: 0.5  },
      { name: `${P}: Gull`, from: '7sQHkW0ylJy', len: 0.5 }, { name: `${P}: Gull, animated: Walk`, from: 'rig:gull2', clip: 'Walk', len: 0.5  }, { name: `${P}: Gull, animated: Run`, from: 'rig:gull2', clip: 'Run', len: 0.5  }, { name: `${P}: Gull, animated: Peck`, from: 'rig:gull2', clip: 'Peck', len: 0.5  },
      { name: `${P}: Seagull (2)`, from: 'dUFuQoM-k3s', len: 0.5 }, { name: `${P}: Seagull (2), animated: Walk`, from: 'rig:gull3', clip: 'Walk', len: 0.5  }, { name: `${P}: Seagull (2), animated: Run`, from: 'rig:gull3', clip: 'Run', len: 0.5  }, { name: `${P}: Seagull (2), animated: Peck`, from: 'rig:gull3', clip: 'Peck', len: 0.5  },
      { name: `${P}: Flying seagull`, from: '6Tpj_vcWP3f', len: 1.1, lift: 1.5 },
      { name: `${P}: Flying gull`, from: 'eMNhHDZakYp', len: 1.1, lift: 1.5 }, { name: `${P}: Flying gull, animated: Flap`, from: 'rig:gullfly2', clip: 'Flap', len: 1.1, lift: 1.5  }, { name: `${P}: Flying gull, animated: Hover`, from: 'rig:gullfly2', clip: 'Hover', len: 1.1, lift: 1.5  },
    ],
  },
  {
    key: 'cat',
    name: 'stray cat (pusa)',
    group: 'On the ground',
    cands: [
      { name: `${P}: Cat`, from: '6dM1J6f6pm9', len: 0.55 },
      { name: `${P}: Kitten`, from: 'dBJgGEu5bHW', len: 0.4 }, { name: `${P}: Kitten, animated: Walk`, from: 'rig:kitten', clip: 'Walk', len: 0.4  }, { name: `${P}: Kitten, animated: Run`, from: 'rig:kitten', clip: 'Run', len: 0.4  }, { name: `${P}: Kitten, animated: Sniff`, from: 'rig:kitten', clip: 'Sniff', len: 0.4  },
              { name: 'madtrollstudio: Cat', from: 'YvVobPlTlQ', len: 0.55 }, { name: 'madtrollstudio: Cat, animated: Walk', from: 'rig:cat2', clip: 'Walk', len: 0.55  }, { name: 'madtrollstudio: Cat, animated: Run', from: 'rig:cat2', clip: 'Run', len: 0.55  }, { name: 'madtrollstudio: Cat, animated: Sniff', from: 'rig:cat2', clip: 'Sniff', len: 0.55  },
      { name: 'elkiotbear: Cat', from: 'ovFy5UldDq', len: 0.55 },
              { name: 'Hiroyuki Kajiwara: Cat loaf', from: '5qGO_C5GvAB', len: 0.5 },
    ],
  },
  {
    key: 'dog',
    name: 'street dog (aspin)',
    group: 'On the ground',
    cands: [
      { name: `${P}: Dog (a)`, from: 'eDmSVe4TKwF', len: 0.8 }, { name: `${P}: Dog (a), animated: Walk`, from: 'rig:dog_c', clip: 'Walk', len: 0.8  }, { name: `${P}: Dog (a), animated: Run`, from: 'rig:dog_c', clip: 'Run', len: 0.8  }, { name: `${P}: Dog (a), animated: Sniff`, from: 'rig:dog_c', clip: 'Sniff', len: 0.8  },
      { name: `${P}: Dog (b)`, from: '5ttSZIlA0t6', len: 0.8 }, { name: `${P}: Dog (b), animated: Walk`, from: 'rig:dog5', clip: 'Walk', len: 0.8  }, { name: `${P}: Dog (b), animated: Run`, from: 'rig:dog5', clip: 'Run', len: 0.8  }, { name: `${P}: Dog (b), animated: Sniff`, from: 'rig:dog5', clip: 'Sniff', len: 0.8  }, { name: `${P}: Dog (b), animated: Sit`, from: 'rig:dog5', clip: 'Sit', len: 0.8  },
      { name: `${P}: Dog (c)`, from: 'baWJfMjFFC2', len: 0.8 }, { name: `${P}: Dog (c), animated: Walk`, from: 'rig:dog_a', clip: 'Walk', len: 0.8 , yaw: Math.PI }, { name: `${P}: Dog (c), animated: Run`, from: 'rig:dog_a', clip: 'Run', len: 0.8 , yaw: Math.PI }, { name: `${P}: Dog (c), animated: Sniff`, from: 'rig:dog_a', clip: 'Sniff', len: 0.8 , yaw: Math.PI },
      { name: `${P}: Dog (d)`, from: '24WsfFi7Q8s', len: 0.8 },
      { name: `${P}: Dog (e)`, from: '83Ha6EKTaOv', len: 0.8 }, { name: `${P}: Dog (e), animated: Walk`, from: 'rig:dog_b', clip: 'Walk', len: 0.8  }, { name: `${P}: Dog (e), animated: Run`, from: 'rig:dog_b', clip: 'Run', len: 0.8  }, { name: `${P}: Dog (e), animated: Sniff`, from: 'rig:dog_b', clip: 'Sniff', len: 0.8  },
                            ],
  },
  {
    key: 'chicken',
    name: 'hen and rooster (manok)',
    group: 'On the ground',
    kind: 'chicken',
    cands: [
              { name: `${P}: Rooster`, from: '6NTegstc5Jy', len: 0.5 }, { name: `${P}: Rooster, animated: Walk`, from: 'rig:rooster', clip: 'Walk', len: 0.5  }, { name: `${P}: Rooster, animated: Run`, from: 'rig:rooster', clip: 'Run', len: 0.5  }, { name: `${P}: Rooster, animated: Peck`, from: 'rig:rooster', clip: 'Peck', len: 0.5  },
      { name: `${P}: Hen`, from: '8Unya0rw9tR', len: 0.4 }, { name: `${P}: Hen, animated: Walk`, from: 'rig:hen', clip: 'Walk', len: 0.4  }, { name: `${P}: Hen, animated: Run`, from: 'rig:hen', clip: 'Run', len: 0.4  }, { name: `${P}: Hen, animated: Peck`, from: 'rig:hen', clip: 'Peck', len: 0.4  },
      { name: `${P}: Baby chick`, from: 'fozJTmMX5yv', len: 0.1 }, { name: `${P}: Baby chick, animated: Walk`, from: 'rig:chick', clip: 'Walk', len: 0.1  }, { name: `${P}: Baby chick, animated: Run`, from: 'rig:chick', clip: 'Run', len: 0.1  }, { name: `${P}: Baby chick, animated: Peck`, from: 'rig:chick', clip: 'Peck', len: 0.1  },
    ],
  },
  { key: 'goat', name: 'goat (kambing)', group: 'On the ground', cands: [{ name: `${P}: Goat`, from: 'd7dImmjtF8E', len: 1.0 }, { name: `${P}: Goat, animated: Walk`, from: 'rig:goat1', clip: 'Walk', len: 1.0  }, { name: `${P}: Goat, animated: Run`, from: 'rig:goat1', clip: 'Run', len: 1.0  }, { name: `${P}: Goat, animated: Sniff`, from: 'rig:goat1', clip: 'Sniff', len: 1.0  }, { name: `${P}: Goat (2)`, from: 'bNYS7ETDNCt', len: 1.0 }, { name: `${P}: Goat (2), animated: Walk`, from: 'rig:goat2', clip: 'Walk', len: 1.0  }, { name: `${P}: Goat (2), animated: Run`, from: 'rig:goat2', clip: 'Run', len: 1.0  }, { name: `${P}: Goat (2), animated: Sniff`, from: 'rig:goat2', clip: 'Sniff', len: 1.0  }] },
  { key: 'monkey', name: 'monkey (unggoy, a capuchin stands in)', group: 'On the ground', cands: [{ name: 'Poly by Google: Capuchin', from: '29hG1_J1Uiq', len: 0.9 }, { name: 'Poly by Google: Capuchin, animated: Idle', from: 'rig:monkey', clip: 'Idle', len: 0.9 }, { name: 'Poly by Google: Capuchin, animated: Walk', from: 'rig:monkey', clip: 'Walk', len: 0.9 }, { name: 'Poly by Google: Capuchin, animated: Run', from: 'rig:monkey', clip: 'Run', len: 0.9 }, { name: 'Poly by Google: Capuchin, animated: Sniff', from: 'rig:monkey', clip: 'Sniff', len: 0.9 }] },
  { key: 'gecko', name: 'gecko (butiki)', group: 'On the ground', cands: [{ name: 'jeremy: Gecko', from: '3FxwLOrGiNL', len: 0.15 }, { name: 'jeremy: Gecko, animated: Walk', from: 'rig:gecko1', clip: 'Walk', len: 0.15  }, { name: 'jeremy: Gecko, animated: Idle', from: 'rig:gecko1', clip: 'Idle', len: 0.15  }, { name: 'Jeff Larson: Spotted gecko', from: '65Yj7059c2K', len: 0.15 }, { name: 'Jeff Larson: Spotted gecko, animated: Walk', from: 'rig:gecko2', clip: 'Walk', len: 0.15  }, { name: 'Jeff Larson: Spotted gecko, animated: Idle', from: 'rig:gecko2', clip: 'Idle', len: 0.15  }] },
  { key: 'lizard', name: 'monitor lizard (bayawak, a lizard stands in)', group: 'On the ground', cands: [{ name: 'madtrollstudio: Lizard', from: '0z3NJc5zAE', len: 0.6 }, { name: 'madtrollstudio: Lizard, animated: Walk', from: 'rig:lizard', clip: 'Walk', len: 0.6  }, { name: 'madtrollstudio: Lizard, animated: Idle', from: 'rig:lizard', clip: 'Idle', len: 0.6  }] },
  { key: 'parrot', name: 'parrot (loro)', group: 'On the ground', cands: [{ name: 'jeremy: Parrot', from: '3zS1cxISN0E', len: 0.1 }, { name: 'jeremy: Parrot, animated: Idle', from: 'rig:parrot', clip: 'Idle', len: 0.1 }, { name: 'jeremy: Parrot, animated: Peck', from: 'rig:parrot', clip: 'Peck', len: 0.1 }, { name: 'jeremy: Parrot, animated: Walk', from: 'rig:parrot', clip: 'Walk', len: 0.1 }] },
  { key: 'rat', name: 'rat (daga)', group: 'On the ground', cands: [{ name: `${P}: Rat`, from: '6hsesZHvcPI', len: 0.25 }, { name: `${P}: Rat, animated: Walk`, from: 'rig:rat', clip: 'Walk', len: 0.25  }, { name: `${P}: Rat, animated: Run`, from: 'rig:rat', clip: 'Run', len: 0.25  }, { name: `${P}: Rat, animated: Sniff`, from: 'rig:rat', clip: 'Sniff', len: 0.25  }, ] },
  { key: 'cockroach', name: 'cockroach (ipis)', group: 'On the ground', cands: [{ name: `${P}: Cockroach`, from: 'eSCFQN_47V4', len: 0.05 }, { name: `${P}: Cockroach, animated: Walk`, from: 'rig:cockroach', clip: 'Walk', len: 0.05 , yaw: Math.PI }, { name: `${P}: Cockroach, animated: Idle`, from: 'rig:cockroach', clip: 'Idle', len: 0.05 , yaw: Math.PI }] },
  { key: 'duck', name: 'duck (bibe)', group: 'In and by the water', cands: [{ name: `${P}: Duck`, from: '6HpauUCfIAb', len: 0.5 }, { name: `${P}: Duck, animated: Walk`, from: 'rig:duck2', clip: 'Walk', len: 0.5  }, { name: `${P}: Duck, animated: Run`, from: 'rig:duck2', clip: 'Run', len: 0.5  }, { name: `${P}: Duck, animated: Peck`, from: 'rig:duck2', clip: 'Peck', len: 0.5  }, ] },
  { key: 'crab', name: 'crab (alimango)', group: 'In and by the water', cands: [{ name: `${P}: Crab`, from: '2DgM36qZW2u', len: 0.15 }, { name: `${P}: Crab, animated: Walk`, from: 'rig:crab1', clip: 'Walk', len: 0.15  }, { name: `${P}: Crab, animated: Idle`, from: 'rig:crab1', clip: 'Idle', len: 0.15  }, { name: 'jeremy: Crab', from: 'bmZ6-LnPmp0', len: 0.15 }, { name: 'jeremy: Crab, animated: Walk', from: 'rig:crab2', clip: 'Walk', len: 0.15  }, { name: 'jeremy: Crab, animated: Idle', from: 'rig:crab2', clip: 'Idle', len: 0.15  }] },
  { key: 'turtle', name: 'turtle (pawikan, a pond turtle stands in)', group: 'In and by the water', cands: [{ name: `${P}: Turtle`, from: '2LCcq8vhqJ3', len: 0.3 }, { name: `${P}: Turtle, animated: Walk`, from: 'rig:turtle1', clip: 'Walk', len: 0.3  }, { name: `${P}: Turtle, animated: Idle`, from: 'rig:turtle1', clip: 'Idle', len: 0.3  }, { name: `${P}: Turtle (2)`, from: 'c6n73UnGEP4', len: 0.3 }, { name: `${P}: Turtle (2), animated: Walk`, from: 'rig:turtle2', clip: 'Walk', len: 0.3  }, { name: `${P}: Turtle (2), animated: Idle`, from: 'rig:turtle2', clip: 'Idle', len: 0.3  }] },
  {
    key: 'frog',
    name: 'frog (palaka)',
    group: 'In and by the water',
    cands: [{ name: `${P}: Tree frog`, from: 'cwyNyIba6WE', len: 0.05 }, { name: `${P}: Tree frog, animated: Hop`, from: 'rig:frog', clip: 'Hop', len: 0.05  }, ],
  },
  { key: 'snail', name: 'snail (suso)', group: 'On the ground', cands: [{ name: `${P}: Snail`, from: 'aZ_cT-AIu2y', len: 0.05 }, { name: `${P}: Snail, animated: Glide`, from: 'rig:snail', clip: 'Glide', len: 0.05  }] },
  {
    key: 'butterfly',
    name: 'butterfly (paruparo)',
    group: 'In the air',
    kind: 'butterfly',
    cands: [{ name: 'built in code', from: 'built', variant: 3 }, { name: `${P}: Butterfly`, from: '2ZwYwkTVnfG', len: 0.07 }, { name: `${P}: Butterfly (2)`, from: '814CINpG3H1', len: 0.07 }, { name: `${P}: Butterfly (2), animated: Flap`, from: 'rig:butterfly1', clip: 'Flap', len: 0.07 , yaw: Math.PI }, { name: `${P}: Butterfly (2), animated: Hover`, from: 'rig:butterfly1', clip: 'Hover', len: 0.07 , yaw: Math.PI }],
  },
  {
    key: 'dragonfly',
    name: 'dragonfly (tutubi)',
    group: 'In the air',
    kind: 'dragonfly',
    cands: [
      { name: 'built in code', from: 'built', variant: 1 },
      { name: `${P}: Dragonfly`, from: '0myA_BOcZrD', len: 0.08 }, { name: `${P}: Dragonfly, animated: Flap`, from: 'rig:dragonfly1', clip: 'Flap', len: 0.08, yaw: Math.PI }, { name: `${P}: Dragonfly, animated: Hover`, from: 'rig:dragonfly1', clip: 'Hover', len: 0.08, yaw: Math.PI },
      { name: 'AssetQuest: Dragonfly', from: 'de6jep5Fq5', len: 0.08 }, { name: 'AssetQuest: Dragonfly, animated: Flap', from: 'rig:dragonfly2', clip: 'Flap', len: 0.08, yaw: Math.PI }, { name: 'AssetQuest: Dragonfly, animated: Hover', from: 'rig:dragonfly2', clip: 'Hover', len: 0.08, yaw: Math.PI },
            ],
  },
  { key: 'moth', name: 'moth (gamu-gamo)', group: 'In the air', kind: 'moth', cands: [{ name: 'built in code', from: 'built', variant: 0 }, { name: "Lee Mason: Lil' Moth", from: '8ojwMQpu6DK', len: 0.05 }, { name: "Lee Mason: Lil' Moth, animated: Flap", from: 'rig:moth', clip: 'Flap', len: 0.05, yaw: Math.PI }, { name: "Lee Mason: Lil' Moth, animated: Hover", from: 'rig:moth', clip: 'Hover', len: 0.05, yaw: Math.PI }] },
  { key: 'firefly', name: 'firefly (alitaptap)', group: 'In the air', kind: 'firefly', cands: [{ name: 'built in code', from: 'built', variant: 0 }] },
];
