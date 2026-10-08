/**
 * The animation library's clips proposed for the city, for the user to judge one by one on the animation review page
 * (anims.html's "For the city" list: main.ts). In the city only Mack has a skeleton a clip can play on (the crowd is
 * posed in its shader, real/people.ts: a clip can't be played on it), so every candidate is his: what he'd do with
 * it, what he does there today, and what stands against it. A candidate that would replace something is shown beside
 * the rig doing that thing as the city has it (`now`: models/firstPerson.ts). Nothing here is used by the game: a
 * verdict (scripts/anims/verdicts.json, written by the page) is what a later change goes by.
 */

/** What Mack's rig does beside the clip, as the city drives it: his gait (0 standing, 1.5 the city's walk, 4.2 its
 * run), a squat, a gun in hand. */
export interface NowState {
  gait?: number;
  squat?: boolean;
  gun?: 'pistol' | 'lever';
  aim?: boolean;
  /** A shot, or a reload, as the part begins. */
  fire?: boolean;
  reload?: boolean;
}

/** One clip of a candidate's run of clips. */
export interface Part {
  clip: string;
  /** How long it's held (s): a loop twice round and anything else once through, unless given. */
  seconds?: number;
  /** Where in the clip it starts (s). */
  from?: number;
  /** In the air: both figures are carried up and down by the city's jump while it plays, and it ends as they land. */
  lift?: boolean;
  /** Played with the hands at ease, not as the clip has them (the library's walks and its idle close them into fists). */
  openHands?: boolean;
  /** What the rig beside it does meanwhile, over the candidate's own `now`. */
  now?: NowState;
  /** So long into the part (s), the rig beside it jumps its own jump (a clip that leaves the ground by itself). */
  nowHop?: number;
}

/** Something to stand the figure by: a box, by its size and where its middle is from the figure's feet (m; +z ahead). */
export interface Prop {
  size: readonly [number, number, number];
  at: readonly [number, number, number];
}

export interface Candidate {
  /** Stable: verdicts are kept by it. `[a-z0-9_]+`. */
  id: string;
  title: string;
  /** Would take the place of something he does today, or is something he can't do yet. */
  kind: 'replace' | 'add';
  parts: readonly Part[];
  /** What it would be in the city. */
  use: string;
  /** What he does there today. */
  today: string;
  /** What stands against it, or what it would need. */
  notes: string;
  /** Claude's own view, for what it's worth: the user decides. */
  advice: string;
  now?: NowState;
  props?: readonly Prop[];
}

/** The city's jump (showroom/fpMode.ts, controls.ts): the speed he leaves the ground at and what brings him down. */
export const HOP = { v: 4.4, g: 12 } as const;

export const VERDICTS = ['use', 'keep', 'no', 'later'] as const;
export type Verdict = (typeof VERDICTS)[number];
export interface Review {
  verdict: Verdict | null;
  note: string;
  /** The day it was given (yyyy-mm-dd). */
  at: string;
}

/** What each verdict's button says, for a candidate of each kind (a kind without the verdict has no such button). */
export const VERDICT_LABELS: Record<Candidate['kind'], Partial<Record<Verdict, string>>> = {
  replace: { use: 'Replace with this', keep: "Keep what he does now", later: 'Later' },
  add: { use: 'Add it', no: 'No', later: 'Later' },
};

const STAND: NowState = { gait: 0 };
const WALK: NowState = { gait: 1.5 };
const RUN: NowState = { gait: 4.2 };

export const CANDIDATES: readonly Candidate[] = [
  // What he already does, keyed in the rig.
  {
    id: 'stand',
    title: 'Standing still',
    kind: 'replace',
    parts: [{ clip: 'Idle_Loop', seconds: 7.5, openHands: true }],
    use: 'How he stands whenever you stop, in third person and looking down at yourself.',
    today: 'The rig stands him square with his arms hanging; nothing moves until he lights up or squats.',
    notes: "The library's stance has one foot well ahead of the other, weight ready. Its fists are closed, so it's shown with the hands at ease. A clip can't follow the view up and down the way his chest does now, and his cigarette hand is placed over whatever the body does.",
    advice: 'Worth a look: it breathes, which he doesn\'t. Whether the stance is his is yours to say.',
    now: STAND,
  },
  {
    id: 'walk',
    title: 'Walking',
    kind: 'replace',
    parts: [{ clip: 'Walk_Loop', seconds: 7.8, openHands: true }],
    use: 'His walk on foot.',
    today: 'The keyed walk (thighs swung, knees bent), narrowed on 2026-10-06 and settled then: "the old walking animation was much better, just his gait was too wide".',
    notes: 'This is the walk you called "angry walking stomping the ground with closed fists" on the crowd: the knee to 88°, the ankle 25 cm up at each step. Shown with the hands at ease.',
    advice: 'Keep his own. Here so the list is whole.',
    now: WALK,
  },
  {
    id: 'run_jog',
    title: 'Running: the jog',
    kind: 'replace',
    parts: [{ clip: 'Jog_Fwd_Loop', seconds: 5.4 }],
    use: 'His run (Shift).',
    today: 'The keyed run: longer strides, the body leaning in, the arms pumping.',
    notes: 'An easy jog, where his run covers 9 m/s. He already covers more ground than his strides ("not completely human"), and this would more so.',
    advice: 'Compare the arms and the lean; the legs are a matter of taste.',
    now: RUN,
  },
  {
    id: 'run_sprint',
    title: 'Running: the sprint',
    kind: 'replace',
    parts: [{ clip: 'Sprint_Loop', seconds: 4.2 }],
    use: 'His run (Shift), as a flat-out sprint.',
    today: 'The keyed run.',
    notes: 'Nearer his speed than the jog. A hard forward lean: in first person the view would have to stay level while the body under it leans.',
    advice: 'The better of the two for a man moving at 9 m/s.',
    now: RUN,
  },
  {
    id: 'sprint_edges',
    title: 'Breaking into a run, and pulling up',
    kind: 'add',
    parts: [
      { clip: 'Idle_Loop', seconds: 1.2, openHands: true, now: STAND },
      { clip: 'Sprint_Enter', now: RUN },
      { clip: 'Sprint_Loop', seconds: 2.1, now: RUN },
      { clip: 'Sprint_Exit', now: STAND },
    ],
    use: 'The first step of a run and the stop at its end.',
    today: 'The rig eases from one gait to the other: no push off, no braking steps.',
    notes: 'Only makes sense with the sprint (above). The stop is 1.7 s long, during which you would already be standing: it has to be cut short or it slides.',
    advice: 'Decide the sprint first.',
  },
  {
    id: 'jump',
    title: 'A jump',
    kind: 'replace',
    // (Jump_Start is a crouch for its first eighth of a second, then the push off and the pose in the air.)
    parts: [{ clip: 'Idle_Loop', seconds: 1, openHands: true }, { clip: 'Jump_Start', seconds: 0.13 }, { clip: 'Jump_Start', from: 0.13, lift: true }, { clip: 'Jump_Land' }],
    use: 'Space: the push off, in the air (arms out, knees drawn up), landing.',
    today: 'Keyed: legs straight leaving the ground, drawn up at the top, the arms up and out a little, the knees giving 7 cm on a spring as he lands.',
    notes: "It starts from a crouch, an eighth of a second in which Space wouldn't have lifted you yet: in play it would start at the push off. The landing goes right down, a hand to the ground, and takes 1.3 s to stand up from; a step taken meanwhile would have to cut it. (The pack's Jump_Loop, for a longer fall, isn't shown: the city's jump is over before it would start.)",
    advice: 'The pose in the air has more to it than his. The landing is heavy for a hop: perhaps only for a real drop.',
    now: STAND,
  },
  {
    id: 'pistol',
    title: 'The pistol',
    kind: 'replace',
    parts: [
      { clip: 'Pistol_Idle_Loop', seconds: 2.4, now: { gun: 'pistol' } },
      { clip: 'Pistol_Aim_Neutral', seconds: 1.2, now: { gun: 'pistol', aim: true } },
      { clip: 'Pistol_Shoot', now: { gun: 'pistol', aim: true, fire: true } },
      { clip: 'Pistol_Shoot', now: { gun: 'pistol', aim: true, fire: true } },
      { clip: 'Pistol_Reload', now: { gun: 'pistol', aim: true, reload: true } },
    ],
    use: 'Holding, aiming, firing and reloading the Type 54, seen in third person.',
    today: 'His hands are put on the gun itself, finger by finger, and the gun is held on the crosshair; the reload is acted with the magazine.',
    notes: "A clip knows nothing of the gun: the hands are where the mannequin's were, the muzzle isn't on your aim, and the reload mimes a magazine. The clip is shown without a gun here.",
    advice: 'Keep his own: "acted, not conjured" is already met by what he has.',
    now: { gun: 'pistol' },
  },
  {
    id: 'ground_sit',
    title: 'Sitting on the ground',
    kind: 'add',
    parts: [{ clip: 'GroundSit_Enter', now: STAND }, { clip: 'GroundSit_Idle_Loop', seconds: 5.2, now: { squat: true } }, { clip: 'GroundSit_Exit', now: STAND }],
    use: 'A second way of resting when left standing: down on the kerb or the river wall, beside the squat he does now (shown next to it).',
    today: 'C, or 22 s of standing about, puts him in the Japanese squat.',
    notes: 'Not a replacement for the squat, which is the look you asked for. His cigarette would need a place for the hand, as the squat has.',
    advice: 'Only if it reads as him; a 192 cm enforcer sitting cross-legged on a pavement may not.',
  },
  // Captured from real people (the Carnegie Mellon database: scripts/anims/cmu.mjs), on him: the walks the MakeHuman
  // test page's crowd walks with, and runs cut the same way.
  {
    id: 'walk_cmu_35',
    title: 'Walking: captured, 35',
    kind: 'replace',
    parts: [{ clip: 'Walk_35_Loop', seconds: 8 }],
    use: "His walk on foot, from a real person: a man in the database's film of it; the quickest of the plain walks, 1.30 m/s as captured.",
    today: 'The keyed walk (thighs swung, knees bent), narrowed on 2026-10-06 and settled then.',
    notes: "Captured without fingers, so the hands are at ease. A stride of a real walk covers far less ground than he does at the city's 4.5 m/s, so his feet would slide under him more than they do now, or the walk would have to be played faster than it was walked. It is fitted to a body far bigger than the one it was captured from.",
    advice: 'Judge the carriage: the shoulders, the arm swing, how heavy he lands. That is what a capture has and the keys have not.',
    now: WALK,
  },
  {
    id: 'walk_cmu_38',
    title: 'Walking: captured, 38',
    kind: 'replace',
    parts: [{ clip: 'Walk_38_Loop', seconds: 8 }],
    use: "His walk on foot, from a real person: 1.30 m/s as captured.",
    today: 'The keyed walk (thighs swung, knees bent), narrowed on 2026-10-06 and settled then.',
    notes: "Captured without fingers, so the hands are at ease. A stride of a real walk covers far less ground than he does at the city's 4.5 m/s, so his feet would slide under him more than they do now, or the walk would have to be played faster than it was walked. It is fitted to a body far bigger than the one it was captured from.",
    advice: 'Judge the carriage: the shoulders, the arm swing, how heavy he lands. That is what a capture has and the keys have not.',
    now: WALK,
  },
  {
    id: 'walk_cmu_16',
    title: 'Walking: captured, 16',
    kind: 'replace',
    parts: [{ clip: 'Walk_16_Loop', seconds: 8 }],
    use: "His walk on foot, from a real person: 1.11 m/s as captured.",
    today: 'The keyed walk (thighs swung, knees bent), narrowed on 2026-10-06 and settled then.',
    notes: "Captured without fingers, so the hands are at ease. A stride of a real walk covers far less ground than he does at the city's 4.5 m/s, so his feet would slide under him more than they do now, or the walk would have to be played faster than it was walked. It is fitted to a body far bigger than the one it was captured from.",
    advice: 'Judge the carriage: the shoulders, the arm swing, how heavy he lands. That is what a capture has and the keys have not.',
    now: WALK,
  },
  {
    id: 'walk_cmu_69',
    title: 'Walking: captured, 69',
    kind: 'replace',
    parts: [{ clip: 'Walk_69_Loop', seconds: 8 }],
    use: "His walk on foot, from a real person: 0.97 m/s as captured.",
    today: 'The keyed walk (thighs swung, knees bent), narrowed on 2026-10-06 and settled then.',
    notes: "Captured without fingers, so the hands are at ease. A stride of a real walk covers far less ground than he does at the city's 4.5 m/s, so his feet would slide under him more than they do now, or the walk would have to be played faster than it was walked. It is fitted to a body far bigger than the one it was captured from.",
    advice: 'Judge the carriage: the shoulders, the arm swing, how heavy he lands. That is what a capture has and the keys have not.',
    now: WALK,
  },
  {
    id: 'walk_cmu_12',
    title: 'Walking: captured, 12',
    kind: 'replace',
    parts: [{ clip: 'Walk_12_Loop', seconds: 8 }],
    use: "His walk on foot, from a real person: 0.91 m/s as captured.",
    today: 'The keyed walk (thighs swung, knees bent), narrowed on 2026-10-06 and settled then.',
    notes: "Captured without fingers, so the hands are at ease. A stride of a real walk covers far less ground than he does at the city's 4.5 m/s, so his feet would slide under him more than they do now, or the walk would have to be played faster than it was walked. It is fitted to a body far bigger than the one it was captured from.",
    advice: 'Judge the carriage: the shoulders, the arm swing, how heavy he lands. That is what a capture has and the keys have not.',
    now: WALK,
  },
  {
    id: 'walk_cmu_105_quick',
    title: 'Walking: captured, 105 quick',
    kind: 'replace',
    parts: [{ clip: 'Walk_CasualQuick_105_Loop', seconds: 8 }],
    use: "His walk on foot, from a real person: a woman's casual quick walk, 0.99 m/s as captured.",
    today: 'The keyed walk (thighs swung, knees bent), narrowed on 2026-10-06 and settled then.',
    notes: "Captured without fingers, so the hands are at ease. A stride of a real walk covers far less ground than he does at the city's 4.5 m/s, so his feet would slide under him more than they do now, or the walk would have to be played faster than it was walked. It is fitted to a body far bigger than the one it was captured from.",
    advice: 'Judge the carriage: the shoulders, the arm swing, how heavy he lands. That is what a capture has and the keys have not.',
    now: WALK,
  },
  {
    id: 'walk_cmu_105',
    title: 'Walking: captured, 105',
    kind: 'replace',
    parts: [{ clip: 'Walk_Normal_105_Loop', seconds: 8 }],
    use: "His walk on foot, from a real person: a woman's normal walk, 0.87 m/s as captured.",
    today: 'The keyed walk (thighs swung, knees bent), narrowed on 2026-10-06 and settled then.',
    notes: "Captured without fingers, so the hands are at ease. A stride of a real walk covers far less ground than he does at the city's 4.5 m/s, so his feet would slide under him more than they do now, or the walk would have to be played faster than it was walked. It is fitted to a body far bigger than the one it was captured from.",
    advice: 'Judge the carriage: the shoulders, the arm swing, how heavy he lands. That is what a capture has and the keys have not.',
    now: WALK,
  },
  {
    id: 'walk_cmu_105_slow',
    title: 'Walking: captured, 105 slow',
    kind: 'replace',
    parts: [{ clip: 'Walk_Slow_105_Loop', seconds: 8 }],
    use: "His walk on foot, from a real person: a woman's slow walk, 0.47 m/s as captured.",
    today: 'The keyed walk (thighs swung, knees bent), narrowed on 2026-10-06 and settled then.',
    notes: "Captured without fingers, so the hands are at ease. A stride of a real walk covers far less ground than he does at the city's 4.5 m/s, so his feet would slide under him more than they do now, or the walk would have to be played faster than it was walked. It is fitted to a body far bigger than the one it was captured from.",
    advice: 'Judge the carriage: the shoulders, the arm swing, how heavy he lands. That is what a capture has and the keys have not.',
    now: WALK,
  },
  {
    id: 'run_cmu_09',
    title: 'Running: captured, 09',
    kind: 'replace',
    parts: [{ clip: 'Run_09_Loop', seconds: 6 }],
    use: "His run (Shift), from a real person: the database's running subject, the fastest of the four: 3.6 m/s as captured.",
    today: 'The keyed run: longer strides, the body leaning in, the arms pumping.',
    notes: 'One stride, looped, of someone crossing a small floor: a steady run, not a sprint, and no faster than 3.6 m/s where his covers 9. Captured without fingers, so the hands are at ease, not fists.',
    advice: "The arms and the rise and fall of a real run are what to look for against his keyed one.",
    now: RUN,
  },
  {
    id: 'run_cmu_35',
    title: 'Running: captured, 35',
    kind: 'replace',
    parts: [{ clip: 'Jog_35_Loop', seconds: 6 }],
    use: "His run (Shift), from a real person: the man whose walk is Walk_35, at a run/jog: 3.2 m/s as captured.",
    today: 'The keyed run: longer strides, the body leaning in, the arms pumping.',
    notes: 'One stride, looped, of someone crossing a small floor: a steady run, not a sprint, and no faster than 3.6 m/s where his covers 9. Captured without fingers, so the hands are at ease, not fists.',
    advice: "The arms and the rise and fall of a real run are what to look for against his keyed one.",
    now: RUN,
  },
  {
    id: 'run_cmu_16',
    title: 'Running: captured, 16',
    kind: 'replace',
    parts: [{ clip: 'Run_16_Loop', seconds: 6 }],
    use: "His run (Shift), from a real person: a run, 2.75 m/s as captured; its stride's end is the least like its start of the four, so look for a hitch where it repeats.",
    today: 'The keyed run: longer strides, the body leaning in, the arms pumping.',
    notes: 'One stride, looped, of someone crossing a small floor: a steady run, not a sprint, and no faster than 3.6 m/s where his covers 9. Captured without fingers, so the hands are at ease, not fists.',
    advice: "The arms and the rise and fall of a real run are what to look for against his keyed one.",
    now: RUN,
  },
  {
    id: 'run_cmu_02',
    title: 'Running: captured, 02',
    kind: 'replace',
    parts: [{ clip: 'Jog_02_Loop', seconds: 6 }],
    use: "His run (Shift), from a real person: a run/jog, 2.7 m/s as captured.",
    today: 'The keyed run: longer strides, the body leaning in, the arms pumping.',
    notes: 'One stride, looped, of someone crossing a small floor: a steady run, not a sprint, and no faster than 3.6 m/s where his covers 9. Captured without fingers, so the hands are at ease, not fists.',
    advice: "The arms and the rise and fall of a real run are what to look for against his keyed one.",
    now: RUN,
  },
  // Runs acted in a manner (the 100STYLE dataset, CC BY 4.0: scripts/anims/style100.mjs), on him.
  {
    id: 'run_style_neutral',
    title: 'Running: 100STYLE, Neutral',
    kind: 'replace',
    parts: [{ clip: 'Run_Neutral_Loop', seconds: 6 }],
    use: "His run (Shift), from an actor running in the manner the dataset calls 'Neutral'.",
    today: 'The keyed run: longer strides, the body leaning in, the arms pumping.',
    notes: 'Acted in a studio a few strides across, so it is a run in manner and a jog in pace: 1.9 m/s as captured, where his covers 9. Using it means a credit on the credits screen (CC BY 4.0: "The 100STYLE Dataset - Ian Mason"). Captured without fingers, so the hands are at ease.',
    advice: 'Look at the manner, not the pace: the dataset has 100 of them, each also walked, and run and walked backwards and sideways, so a manner you like can be cut for all of those.',
    now: RUN,
  },
  {
    id: 'run_style_proud',
    title: 'Running: 100STYLE, Proud',
    kind: 'replace',
    parts: [{ clip: 'Run_Proud_Loop', seconds: 6 }],
    use: "His run (Shift), from an actor running in the manner the dataset calls 'Proud'.",
    today: 'The keyed run: longer strides, the body leaning in, the arms pumping.',
    notes: 'Acted in a studio a few strides across, so it is a run in manner and a jog in pace: 1.9 m/s as captured, where his covers 9. Using it means a credit on the credits screen (CC BY 4.0: "The 100STYLE Dataset - Ian Mason"). Captured without fingers, so the hands are at ease.',
    advice: 'Look at the manner, not the pace: the dataset has 100 of them, each also walked, and run and walked backwards and sideways, so a manner you like can be cut for all of those.',
    now: RUN,
  },
  {
    id: 'run_style_strutting',
    title: 'Running: 100STYLE, Strutting',
    kind: 'replace',
    parts: [{ clip: 'Run_Strutting_Loop', seconds: 6 }],
    use: "His run (Shift), from an actor running in the manner the dataset calls 'Strutting'.",
    today: 'The keyed run: longer strides, the body leaning in, the arms pumping.',
    notes: 'Acted in a studio a few strides across, so it is a run in manner and a jog in pace: 1.4 m/s as captured, where his covers 9. Using it means a credit on the credits screen (CC BY 4.0: "The 100STYLE Dataset - Ian Mason"). Captured without fingers, so the hands are at ease.',
    advice: 'Look at the manner, not the pace: the dataset has 100 of them, each also walked, and run and walked backwards and sideways, so a manner you like can be cut for all of those.',
    now: RUN,
  },
  {
    id: 'run_style_heavyset',
    title: 'Running: 100STYLE, Heavyset',
    kind: 'replace',
    parts: [{ clip: 'Run_Heavyset_Loop', seconds: 6 }],
    use: "His run (Shift), from an actor running in the manner the dataset calls 'Heavyset'.",
    today: 'The keyed run: longer strides, the body leaning in, the arms pumping.',
    notes: 'Acted in a studio a few strides across, so it is a run in manner and a jog in pace: 1.5 m/s as captured, where his covers 9. Using it means a credit on the credits screen (CC BY 4.0: "The 100STYLE Dataset - Ian Mason"). Captured without fingers, so the hands are at ease.',
    advice: 'Look at the manner, not the pace: the dataset has 100 of them, each also walked, and run and walked backwards and sideways, so a manner you like can be cut for all of those.',
    now: RUN,
  },
  {
    id: 'run_style_stiff',
    title: 'Running: 100STYLE, Stiff',
    kind: 'replace',
    parts: [{ clip: 'Run_Stiff_Loop', seconds: 6 }],
    use: "His run (Shift), from an actor running in the manner the dataset calls 'Stiff'.",
    today: 'The keyed run: longer strides, the body leaning in, the arms pumping.',
    notes: 'Acted in a studio a few strides across, so it is a run in manner and a jog in pace: 1.4 m/s as captured, where his covers 9. Using it means a credit on the credits screen (CC BY 4.0: "The 100STYLE Dataset - Ian Mason"). Captured without fingers, so the hands are at ease.',
    advice: 'Look at the manner, not the pace: the dataset has 100 of them, each also walked, and run and walked backwards and sideways, so a manner you like can be cut for all of those.',
    now: RUN,
  },
  {
    id: 'run_style_rushed',
    title: 'Running: 100STYLE, Rushed',
    kind: 'replace',
    parts: [{ clip: 'Run_Rushed_Loop', seconds: 6 }],
    use: "His run (Shift), from an actor running in the manner the dataset calls 'Rushed'.",
    today: 'The keyed run: longer strides, the body leaning in, the arms pumping.',
    notes: 'Acted in a studio a few strides across, so it is a run in manner and a jog in pace: 2.7 m/s as captured, where his covers 9. Using it means a credit on the credits screen (CC BY 4.0: "The 100STYLE Dataset - Ian Mason"). Captured without fingers, so the hands are at ease.',
    advice: 'Look at the manner, not the pace: the dataset has 100 of them, each also walked, and run and walked backwards and sideways, so a manner you like can be cut for all of those.',
    now: RUN,
  },
  {
    id: 'run_style_robot',
    title: 'Running: 100STYLE, Robot',
    kind: 'replace',
    parts: [{ clip: 'Run_Robot_Loop', seconds: 6 }],
    use: "His run (Shift), from an actor running in the manner the dataset calls 'Robot'.",
    today: 'The keyed run: longer strides, the body leaning in, the arms pumping.',
    notes: 'Acted in a studio a few strides across, so it is a run in manner and a jog in pace: 1.0 m/s as captured, where his covers 9. Using it means a credit on the credits screen (CC BY 4.0: "The 100STYLE Dataset - Ian Mason"). Captured without fingers, so the hands are at ease.',
    advice: 'Look at the manner, not the pace: the dataset has 100 of them, each also walked, and run and walked backwards and sideways, so a manner you like can be cut for all of those.',
    now: RUN,
  },
  {
    id: 'run_style_leanback',
    title: 'Running: 100STYLE, LeanBack',
    kind: 'replace',
    parts: [{ clip: 'Run_LeanBack_Loop', seconds: 6 }],
    use: "His run (Shift), from an actor running in the manner the dataset calls 'LeanBack'.",
    today: 'The keyed run: longer strides, the body leaning in, the arms pumping.',
    notes: 'Acted in a studio a few strides across, so it is a run in manner and a jog in pace: 1.4 m/s as captured, where his covers 9. Using it means a credit on the credits screen (CC BY 4.0: "The 100STYLE Dataset - Ian Mason"). Captured without fingers, so the hands are at ease.',
    advice: 'Look at the manner, not the pace: the dataset has 100 of them, each also walked, and run and walked backwards and sideways, so a manner you like can be cut for all of those.',
    now: RUN,
  },
  // Looked for after the pack's jump, the captured run and the pack's start and stop of a run were played in the city
  // and taken out again (2026-10-06): more of the Carnegie Mellon database, cut by scripts/anims/cmu.mjs.
  {
    id: 'run_cmu_127',
    title: 'Running: captured, 127',
    kind: 'replace',
    parts: [{ clip: 'Run_127_Loop', seconds: 6 }],
    use: "His run (Shift), from a real person: a subject captured for action-game moves ('Action Adventure Obstacles, running, jumping, ducking, rolling'): the quickest stride of any here, 0.57 s, at 3.6 m/s as captured.",
    today: 'The keyed run, which you went back to after playing the captured run 09.',
    notes: 'A steady run across a capture floor, as run 09 was, and under half the speed he covers the ground at: if what was wrong with 09 was that it looked like a jog at 9 m/s, these will too. Captured without fingers, so the hands are at ease.',
    advice: 'Worth a look only for the carriage. A real sprint would have to come from elsewhere: nothing free that I could read the licence of has one.',
    now: RUN,
  },
  {
    id: 'run_cmu_143',
    title: 'Running: captured, 143',
    kind: 'replace',
    parts: [{ clip: 'Run_143_Loop', seconds: 6 }],
    use: "His run (Shift), from a real person: 3.0 m/s as captured, a 0.72 s stride.",
    today: 'The keyed run, which you went back to after playing the captured run 09.',
    notes: 'A steady run across a capture floor, as run 09 was, and under half the speed he covers the ground at: if what was wrong with 09 was that it looked like a jog at 9 m/s, these will too. Captured without fingers, so the hands are at ease.',
    advice: 'Worth a look only for the carriage. A real sprint would have to come from elsewhere: nothing free that I could read the licence of has one.',
    now: RUN,
  },
  {
    id: 'run_cmu_141',
    title: 'Running: captured, 141',
    kind: 'replace',
    parts: [{ clip: 'Run_141_Loop', seconds: 6 }],
    use: "His run (Shift), from a real person: 2.9 m/s as captured; its stride's end is the least like its start of these, so look for a hitch where it repeats.",
    today: 'The keyed run, which you went back to after playing the captured run 09.',
    notes: 'A steady run across a capture floor, as run 09 was, and under half the speed he covers the ground at: if what was wrong with 09 was that it looked like a jog at 9 m/s, these will too. Captured without fingers, so the hands are at ease.',
    advice: 'Worth a look only for the carriage. A real sprint would have to come from elsewhere: nothing free that I could read the licence of has one.',
    now: RUN,
  },
  {
    id: 'run_start_127',
    title: 'Breaking into a run: captured, 127',
    kind: 'add',
    parts: [{ clip: 'RunStart_127', from: 1.07, seconds: 0.8, now: STAND }, { clip: 'RunStart_127', from: 1.87, now: RUN }],
    use: "The first steps of a run, from a real person: the database's 'Walk to Run': a few walking steps, then the run.",
    today: 'The rig eases into its run, which you went back to after playing the pack\'s push off.',
    notes: 'It runs into the keyed run where it ends, and the two would have to be brought into step there. Shown on the spot, from a little before he sets off.',
    advice: 'Plainer than the pack\'s lunge: a few quickening steps.',
  },
  {
    id: 'run_start_143',
    title: 'Breaking into a run: captured, 143',
    kind: 'add',
    parts: [{ clip: 'RunStart_143', from: 1.63, seconds: 0.8, now: STAND }, { clip: 'RunStart_143', from: 2.43, now: RUN }],
    use: "The first steps of a run, from a real person: the database's 'Start to Run': from standing.",
    today: 'The rig eases into its run, which you went back to after playing the pack\'s push off.',
    notes: 'It runs into the keyed run where it ends, and the two would have to be brought into step there. Shown on the spot, from a little before he sets off.',
    advice: 'Plainer than the pack\'s lunge: a few quickening steps.',
  },
  {
    id: 'run_stop_127',
    title: 'Pulling up out of a run: captured, 127',
    kind: 'add',
    parts: [{ clip: 'RunStop_127', seconds: 2.37, now: RUN }, { clip: 'RunStop_127', from: 2.37, now: STAND }],
    use: "Stopping out of a run, from a real person: the database's 'Run to Quick Stop'.",
    today: 'The rig eases to a stop, which you went back to after playing the pack\'s skid.',
    notes: 'He takes his last steps while you would already be standing: in play it would start part way in, or his feet would slide. Shown on the spot, the run-in first.',
    advice: 'The hard one of the three: thrown forward over his feet, an arm up, before he straightens. The other two pull up more quietly.',
  },
  {
    id: 'run_stop_143',
    title: 'Pulling up out of a run: captured, 143',
    kind: 'add',
    parts: [{ clip: 'RunStop_143', seconds: 1.67, now: RUN }, { clip: 'RunStop_143', from: 1.67, now: STAND }],
    use: "Stopping out of a run, from a real person: the database's 'Run to Stop'.",
    today: 'The rig eases to a stop, which you went back to after playing the pack\'s skid.',
    notes: 'He takes his last steps while you would already be standing: in play it would start part way in, or his feet would slide. Shown on the spot, the run-in first.',
    advice: 'Short braking steps and upright, where the pack\'s went down into a wide crouch.',
  },
  {
    id: 'run_stop_16',
    title: 'Pulling up out of a run: captured, 16',
    kind: 'add',
    parts: [{ clip: 'RunStop_16', seconds: 1.37, now: RUN }, { clip: 'RunStop_16', from: 1.37, now: STAND }],
    use: "Stopping out of a run, from a real person: the database's 'run/jog, sudden stop'.",
    today: 'The rig eases to a stop, which you went back to after playing the pack\'s skid.',
    notes: 'He takes his last steps while you would already be standing: in play it would start part way in, or his feet would slide. Shown on the spot, the run-in first.',
    advice: 'Short braking steps and upright, where the pack\'s went down into a wide crouch.',
  },
  {
    id: 'jump_cmu_16',
    title: 'A jump: captured, 16',
    kind: 'replace',
    parts: [{ clip: 'Jump_16', from: 0.30, nowHop: 0.80 }],
    use: "Space, from a real person: a standing jump, 26 cm up, 0.37 s in the air.",
    today: 'The keyed jump, which you went back to after playing the pack\'s: beside it here, leaving the ground when the capture does.',
    notes: 'A real jump starts with a dip of the knees, about a third of a second in which Space would not have lifted you yet: in play it would start at the push off. The city\'s jump is higher and longer in the air (0.8 m, 0.73 s) than anyone jumps from standing, so the clip would be stretched over it.',
    advice: 'Look at the landing: a real one gives at the knees and is up again, without the pack\'s hand to the ground.',
    now: STAND,
  },
  {
    id: 'jump_cmu_16_high',
    title: 'A jump: captured, 16 high',
    kind: 'replace',
    parts: [{ clip: 'JumpHigh_16', from: 0.73, nowHop: 0.80 }],
    use: "Space, from a real person: a high jump from standing, the hips 51 cm up, 0.57 s in the air.",
    today: 'The keyed jump, which you went back to after playing the pack\'s: beside it here, leaving the ground when the capture does.',
    notes: 'A real jump starts with a dip of the knees, about a third of a second in which Space would not have lifted you yet: in play it would start at the push off. The city\'s jump is higher and longer in the air (0.8 m, 0.73 s) than anyone jumps from standing, so the clip would be stretched over it.',
    advice: 'Look at the landing: a real one gives at the knees and is up again, without the pack\'s hand to the ground.',
    now: STAND,
  },
  {
    id: 'jump_cmu_16_forward',
    title: 'A jump: captured, 16 forward',
    kind: 'replace',
    parts: [{ clip: 'JumpForward_16', from: 0.33, nowHop: 0.80 }],
    use: "Space, from a real person: a standing jump forwards, a metre on (here on the spot), 0.44 s in the air.",
    today: 'The keyed jump, which you went back to after playing the pack\'s: beside it here, leaving the ground when the capture does.',
    notes: 'A real jump starts with a dip of the knees, about a third of a second in which Space would not have lifted you yet: in play it would start at the push off. The city\'s jump is higher and longer in the air (0.8 m, 0.73 s) than anyone jumps from standing, so the clip would be stretched over it.',
    advice: 'Look at the landing: a real one gives at the knees and is up again, without the pack\'s hand to the ground.',
    now: STAND,
  },
  {
    id: 'jump_cmu_13',
    title: 'A jump: captured, 13',
    kind: 'replace',
    parts: [{ clip: 'Jump_13', from: 0.57, nowHop: 0.80 }],
    use: "Space, from a real person: a standing jump, the hips 43 cm up, 0.50 s in the air.",
    today: 'The keyed jump, which you went back to after playing the pack\'s: beside it here, leaving the ground when the capture does.',
    notes: 'A real jump starts with a dip of the knees, about a third of a second in which Space would not have lifted you yet: in play it would start at the push off. The city\'s jump is higher and longer in the air (0.8 m, 0.73 s) than anyone jumps from standing, so the clip would be stretched over it.',
    advice: 'Look at the landing: a real one gives at the knees and is up again, without the pack\'s hand to the ground.',
    now: STAND,
  },
  {
    id: 'jump_cmu_118',
    title: 'A jump: captured, 118',
    kind: 'replace',
    parts: [{ clip: 'Jump_118', from: 2.70, nowHop: 0.80 }],
    use: "Space, from a real person: a jump by the database's jumping subject, 26 cm up, 0.40 s in the air.",
    today: 'The keyed jump, which you went back to after playing the pack\'s: beside it here, leaving the ground when the capture does.',
    notes: 'A real jump starts with a dip of the knees, about a third of a second in which Space would not have lifted you yet: in play it would start at the push off. The city\'s jump is higher and longer in the air (0.8 m, 0.73 s) than anyone jumps from standing, so the clip would be stretched over it.',
    advice: 'Look at the landing: a real one gives at the knees and is up again, without the pack\'s hand to the ground.',
    now: STAND,
  },
  // What he can't do yet.
  {
    id: 'look_around',
    title: 'Standing: a look around',
    kind: 'add',
    parts: [{ clip: 'Idle_LookAround_Loop', seconds: 9.2, openHands: true }],
    use: 'Now and then while standing, in third person: he looks over each shoulder.',
    today: 'He stands as he was.',
    notes: "In first person the head isn't drawn, so it would be seen from outside only. It turns his head on its own: never with a camera on his face.",
    advice: 'A cheap bit of life for third person.',
    now: STAND,
  },
  {
    id: 'fold_arms',
    title: 'Standing: arms folded',
    kind: 'add',
    parts: [{ clip: 'Idle_FoldArms_Loop', seconds: 7.5 }],
    use: 'Waiting: at a crossing, on a platform, standing in a train.',
    today: 'Arms hanging.',
    notes: "Made for the mannequin's chest: on his, far broader, the forearms may sink in or miss each other (no IK). Nothing would trigger it yet.",
    advice: 'Check the arms against his chest before anything else.',
    now: STAND,
  },
  {
    id: 'directions',
    title: 'Sideways and backwards',
    kind: 'add',
    parts: ['Jog_Fwd_Loop', 'Jog_Fwd_R_Loop', 'Jog_Right_Loop', 'Jog_Bwd_R_Loop', 'Jog_Bwd_Loop', 'Jog_Bwd_L_Loop', 'Jog_Left_Loop', 'Jog_Fwd_L_Loop'].map((clip) => ({ clip, seconds: 1.8 })),
    use: 'His legs going the way you go: stepping sideways and backing away, seen looking down in first person and in third with a gun up.',
    today: 'The rig is told only how fast he goes, so his legs stride forward whichever way you move.',
    notes: 'Eight directions of a jog; the pack has no sideways walk (pack 2\'s paid tier has walks in eight directions). The rig would need the direction as well as the speed.',
    advice: 'The gap is real, most of all with a gun raised. Would want the walks too.',
    now: RUN,
  },
  {
    id: 'turn',
    title: 'Turning on the spot',
    kind: 'add',
    parts: [{ clip: 'Turn90_L' }, { clip: 'Turn90_R' }],
    use: 'In third person, when he turns to a new heading or to the view (a gun raised).',
    today: 'His body swings round without his feet moving.',
    notes: 'Two seconds for a quarter turn, where he turns to a raised gun almost at once: it could only play behind the turn, or much faster.',
    advice: 'Too slow as made for anything but a turn while standing idle.',
    now: STAND,
  },
  {
    id: 'seated',
    title: 'Sitting: trains, buses, benches',
    kind: 'add',
    parts: [
      { clip: 'Sitting_Enter' },
      { clip: 'Sitting_Idle_Loop', seconds: 3.4 },
      { clip: 'Sitting_Idle02_Loop', seconds: 5 },
      { clip: 'Sitting_Idle03_Loop', seconds: 4.2 },
      { clip: 'Sitting_Exit' },
    ],
    use: 'His body when you sit: a train or bus seat (E sits you today), a taxi\'s back seat, and the benches along the river and in the parks, which you can\'t sit on yet.',
    today: 'On a train, a bus or in a taxi his body isn\'t drawn at all; the view just lowers.',
    notes: "Three seated idles to vary between. The seat's height is the mannequin's chair (the box here); a bench seat's differs and the feet aren't planted.",
    advice: 'The clearest gain in the list: there is a seat under you already and no body on it.',
    props: [{ size: [0.6, 0.46, 0.5], at: [0, 0.23, -0.3] }],
  },
  {
    id: 'doze',
    title: 'Sitting: nodding off',
    kind: 'add',
    parts: [{ clip: 'Sitting_Idle_Loop', seconds: 1.7 }, { clip: 'Sitting_Nodding_Loop', seconds: 8.7 }],
    use: 'Dozing on a late train, as everyone does.',
    today: 'Nothing.',
    notes: "Needs the seat (above) first. He's built as a machine that doesn't tire: whether Mack dozes is a story question, not an animation one.",
    advice: 'Better kept for the cast and the salaryman than for him.',
    props: [{ size: [0.6, 0.46, 0.5], at: [0, 0.23, -0.3] }],
  },
  {
    id: 'rail',
    title: 'Leaning on a railing',
    kind: 'add',
    parts: [{ clip: 'Idle_Rail_Loop', seconds: 7.5 }, { clip: 'Idle_Rail_Call' }, { clip: 'Idle_Rail_Loop', seconds: 2.5 }],
    use: 'At the waterfront\'s flood walls, the bridges and the lookout deck (`lookout.rail`): E leans him on the rail to watch the water. The second clip calls out to someone below.',
    today: 'Nothing: you stand at the rail.',
    notes: "The rail's height is the mannequin's (the bar here); the city's walls and rails are several heights, and without IK his hands rest where the clip has them.",
    advice: 'Suits the game\'s mood, and pairs with smoking. Worth it if the heights can be matched.',
    props: [{ size: [1.6, 0.06, 0.06], at: [0, 1.05, 0.38] }],
  },
  {
    id: 'interact',
    title: 'Using something',
    kind: 'add',
    parts: [{ clip: 'Interact' }, { clip: 'Idle_Loop', seconds: 1.2, openHands: true }],
    use: 'E at a door, a ticket gate, a lift button, a vending machine: a hand goes out to it.',
    today: 'E acts at once, or the screen fades; no hand moves.',
    notes: 'Two seconds, and the hand goes to where the mannequin reached, not to the thing. In first person it would be the hand coming into view.',
    advice: 'Good as a quick gesture cut to half a second; too long whole.',
    now: STAND,
  },
  {
    id: 'pickup',
    title: 'Picking something up',
    kind: 'add',
    parts: [{ clip: 'PickUp_Table' }, { clip: 'Idle_Loop', seconds: 1, openHands: true }, { clip: 'PickUp_Kneeling' }],
    use: 'Taking something off a counter, or up off the ground.',
    today: 'There is nothing to pick up in the city yet.',
    notes: 'Nothing to hang it on until there are things to take.',
    advice: 'Later, with whatever brings items in.',
  },
  {
    id: 'drink',
    title: 'A drink',
    kind: 'add',
    parts: [{ clip: 'Drink' }, { clip: 'Idle_Loop', seconds: 1, openHands: true }, { clip: 'Consume' }],
    use: 'A can from a vending machine, a glass at a bar. The second clip is something eaten or swallowed.',
    today: 'Nothing: the machines and bars are scenery or scenes.',
    notes: 'No can or glass in the hand: one would have to be modelled and held, as his cigarette is.',
    advice: 'Later; his smoking already fills this place.',
  },
  {
    id: 'phone_call',
    title: 'A phone call',
    kind: 'add',
    parts: [{ clip: 'Idle_TalkingPhone_Loop', seconds: 8.7 }],
    use: 'Standing with the phone at his ear, in third person.',
    today: 'The phone is a screen over the view; it has a messenger and no calls, and no phone in his hand.',
    notes: 'Needs calls to exist, and a handset modelled for his hand.',
    advice: 'Later, if the story gets phone calls.',
    now: STAND,
  },
  {
    id: 'crouch',
    title: 'Crouching and creeping',
    kind: 'add',
    parts: [{ clip: 'Crouch_Enter' }, { clip: 'Crouch_Idle_Loop', seconds: 2.9 }, { clip: 'Crouch_Fwd_Loop', seconds: 4 }, { clip: 'Crouch_Left_Loop', seconds: 2 }, { clip: 'Crouch_Exit' }],
    use: 'Keeping low: behind a parked car in a shoot-out, or a sneak if the game gets one.',
    today: 'C is the squat, which is for resting, not for cover.',
    notes: 'A new move, not a new look for an old one: it needs a key, a lower collision height and a reason. The pack has it in eight directions.',
    advice: 'Only when there is something to hide from.',
    now: { squat: true },
  },
  {
    id: 'roll',
    title: 'A roll',
    kind: 'add',
    parts: [{ clip: 'Roll_RM' }, { clip: 'Idle_Loop', seconds: 0.8, openHands: true }],
    use: 'A dive out of the way: of a car, or of a gun.',
    today: 'Nothing on foot in the city (the fight page dodges with a side hop).',
    notes: 'A new move. In first person the view would have to roll with him or cut to third.',
    advice: 'Belongs with fighting coming to the city, not before.',
  },
  {
    id: 'slide',
    title: 'A slide',
    kind: 'add',
    parts: [{ clip: 'Sprint_Loop', seconds: 1.4 }, { clip: 'Slide_Start' }, { clip: 'Slide_Loop', seconds: 1 }, { clip: 'Slide_Exit' }],
    use: 'Dropping into a slide from a run.',
    today: 'Nothing.',
    notes: 'A new move with no use yet: nothing in the city is low enough to slide under.',
    advice: 'No, unless a chase wants it.',
  },
  {
    id: 'climb_up',
    title: 'Climbing onto something',
    kind: 'add',
    parts: [{ clip: 'Sprint_Loop', seconds: 0.7 }, { clip: 'ClimbUp_1m_RM' }, { clip: 'Idle_Loop', seconds: 1.5, openHands: true }],
    use: 'Up onto what is too high to jump: a wall, a container at the port, a platform from the track.',
    today: 'The jump takes him 0.8 m up and no more.',
    notes: "A running vault onto a ledge one metre up for the mannequin; scaled to Mack's legs it is 1.17 m up and 2 m on (the box here). The city's ledges are any height, and the walker would have to find one and stand him on it.",
    advice: 'Useful traversal, but a mechanic to build, not a clip to drop in.',
    // (Where the clip leaves him, on Mack: 1.17 m up, 1.97 m ahead.)
    props: [{ size: [1.4, 1.17, 1.6], at: [0, 0.585, 2.1] }],
  },
];
