import { edition } from '@edition';
import { isBare, OUTFITS, type Outfit } from '../district/peopleMix';
import type { Body, Hair } from './mobRig';
import { TRADE, TRADE_COUNT } from './shops';

/**
 * The rooms behind the windows: what goes on behind the upper floors' glass, as data. This module is pure (no DOM):
 * the scenes' format, the built-in scenes, the checks every scene must pass, and the tables the wall shader reads.
 * windowAtlas.ts poses the mob's own figures for them and paints them; city.ts stands them in the rooms.
 *
 * ADDING A SCENE IS ADDING DATA. A scene is one plain JSON object. The built-in ones are the SCENES list below. A file
 * content/world3d/windows/<id>.json (in the repository, for every edition) replaces the built-in scene of that id (an
 * edited copy: delete the file and the built-in one is back) or, with a new id, adds a scene. An edition can add more (src/edition/types.ts `windowScenes`): the uncensored edition loads every
 * `adult/content/windows/*.json` (each file one scene object, or an array of them). They are checked by
 * `checkScene` (errors go to the console and the scene is left out; nothing breaks), painted after the built-in
 * ones, shown on the contact sheets (`node debug-shots/windowsheet.mjs <dir> all uncensored`) and can be stood in
 * every room with `?vignette=<id>`. Room: MAX_SCENES cells in all (WINDOW_ATLAS.rows x cols: 136, as many rows as
 * keep the texture within 4096 px). A window scene takes a cell; its poses beyond the first two (`tween`, `frames`)
 * take a quarter of a cell each (a frame slot: four to a cell, shared between scenes). The built-in scenes take 84
 * cells and 26 slots (7 cells), so an edition has 45 cells; what doesn't fit is dropped with a console warning
 * (windowLayout). (Ground-floor rooms take no cell.)
 *
 * THE SCENE EDITOR (scenes.html on the dev server, showroom/scenes.ts) edits these same objects by hand: figures
 * dragged about, a hand or a foot put where it should be (sceneIk.ts turns the drag into the pose's own angles),
 * the poses on a timeline, the checks below as you go. It saves one scene a file, <id>.json, into one of those two
 * folders (sceneFiles.ts has the rules; the dev server's /__scene writes it). Nothing here is written by it.
 *
 * THE ROOM. A scene is a room seen from the street through its window: 4 m wide and 2.5 m high. x is metres
 * across from the room's middle (-2 at the viewer's left to 2), y is metres up from the floor. Keep what matters
 * within x -1.3 to 1.3 (rooms narrower than the scene show its middle; a hotel room only -0.8 to 0.8), and above
 * 0.95 m if it should show over an ordinary window's sill. Everything is drawn as a dark shape against the room's
 * light: there is no colour, no face and no detail inside an outline, so a scene has to read as silhouettes.
 * The shader mirrors half the rooms left to right, so never rely on a side.
 *
 * A SCENE'S FIELDS (only id, label, cat and a are required):
 *   id      "v_den_mahjong": letters, digits and _ only, unique. Edition scenes should start with their own prefix.
 *   label   a line saying what it is, for the contact sheet.
 *   cat     which rooms it goes in: one of CATS, or a list of them. "home" a flat or house; "home_tv" one with
 *           the television on (blue flickering light); "office"; "hotel" (also a love hotel's ordinary rooms);
 *           "den" a bar or club upstairs in a nightlife tenant building; and the rooms where the city's vice
 *           shows: "v_home", "v_office", "v_hotel", "v_love" (a love hotel's), "v_den". A zone's `vice` level
 *           (content/world3d/zones/*.yaml, look.vice) sets how many of its rooms are vice rooms. Or a ground-floor
 *           room ("g_...": GROUND-FLOOR ROOMS, below).
 *   weight  1 to 4 (default 1): how many chances it gets among its kind's scenes.
 *   adult   true for anything sexual or nude: left out of the demo edition. (Standard-edition scenes stop at
 *           implication: an embrace, a kiss, a top coming off as a silhouette.)
 *   when    for vice scenes, which of the night's hours its people keep (WHEN): "evening" from about six on
 *           (drinking, gambling, the clubs), "late" from about ten, most from midnight to three (deals, beatings,
 *           loan sharks; the default), "lovers" from about nine to two. Ordinary scenes follow their building's
 *           hours instead (offices by day, homes in the evening).
 *   low     true if it only reads through glass that reaches the floor (someone lying down, a bed): it's then
 *           shown only behind curtain walls and balcony doors, never behind a window with a sill.
 *   back    furniture against the back wall, drawn greyer: a list of items (below).
 *   near    true to stand `back` close behind the people instead (the sofa they sit on).
 *   front   furniture the people are at, drawn just in front of them (it hides their legs): desks, tables, a bed.
 *   a       the people: a list of figures (below). The room's furniture stays whoever is in; the people are
 *           there only at the scene's hours.
 *   aItems  items drawn with the people (what moves or comes and goes with them: the bottle on the table).
 *   b, bItems, anim   a second pose of the people and how it plays: anim is [period, hold] or [period, hold, go]: the
 *           cycle's length in seconds (0.3 to 20; anything under 2.4 s plays at 2.4 s unless the people walk: a
 *           street of windows twitching is worse than one standing still), the share of it spent in the first
 *           pose (0.05 to 0.95), and how many seconds the move from one pose to the next takes (0.1 to 2.5;
 *           default 0.45, more with in-betweens). b lists every figure again in its second pose (and bItems every
 *           item), in the same order. The people rest in the first pose, move to the second, rest there and move
 *           back; the move is never a cut (the shader blends one outline into the next).
 *   tween   0 to 3: how many in-between poses to make between each pose and the next (the figures' angles and
 *           places interpolated, so an arm swings through the space between rather than fading across it). Worth
 *           it for what really moves (a blow, a dancer, pouring, a walk); each one takes a frame slot (below).
 *   frames  more poses after `b`: a list of { "a": [figures], "aItems": [items] }. The people go through them all
 *           in order and come back the same way (a, b, frames..., ...frames, b, a), at most 10 with the in-betweens.
 *   setBack metres further from the window than a room's people stand by themselves (0 to 2.5; DISTANCE, below).
 *   slide   metres a second (0.1 to 2): the people walk to and fro across the room, mirrored on the way back. Draw
 *           them facing the viewer's right (yaw 90) at x about 0, with a and b the two halves of a stride (and
 *           `tween: 1` for the legs passing between them).
 *   deep    more figures, standing at the back of the room. Only in a still scene (no anim).
 *
 * AN ITEM is [name, x, ...numbers]: a piece of furniture from ITEMS at x, with that item's own extra numbers
 * (mostly a width or a height; things that stand on a table take the table top's height as y). See ITEMS for each.
 * It may end with options, { "depth": metres }: that much further back in the room than its layer (DISTANCE, below).
 *
 * A FIGURE is { who, x, pose, seat?, floor?, hold?, depth? }:
 *   who     a name from CAST ("suit", "hostess", "yakuza"...), or { "body", "outfit", "hair" } with a body of
 *           man, woman, elder or child, any outfit of district/peopleMix.ts OUTFITS and any hair of mobRig.ts Hair
 *           (the mob's own figures: what a body can't wear falls back to plain clothes).
 *   x       where their hips are across the room.
 *   seat    the height of what they sit on (a chair 0.45, a sofa 0.42, a bar stool 0.75, a bed 0.5, the floor
 *           0.02): the hips rest there. Without it the figure's lowest point rests on `floor` (default 0: standing,
 *           kneeling or lying on the floor; 0.5 lying on a bed; 0.28 standing on the little stage).
 *   hold    what the hands hold: a list of [hand, prop, angle?, dx?, dy?, scale?]: hand "L" or "R", prop a name
 *           from PROPS, drawn at the hand along the forearm unless an angle in degrees from level is given (90
 *           upright; null: along the forearm, where a later number follows). dx and dy move it from there, in
 *           metres across and up the picture (-0.6 to 0.6); scale draws it that many times its size about that
 *           point (0.4 to 2.5). All optional: ["R", "glass"] is a glass in the right hand. `cock` is the
 *           exception: placed at the pelvis along the body's front rather than at the hand (dx, dy and scale
 *           from there), and only in a scene marked adult.
 *   depth   metres further back in the room than the people's layer (0 to 2.5; DISTANCE, below).
 *   pose    the body, in DEGREES, every part optional (0 is standing straight, arms hanging):
 *             yaw    which way they face: 0 the window (the viewer), 90 the viewer's right, -90 the left, 180 the
 *                    room. Two people talking face 90 and -90. Profiles read best.
 *             pitch  the whole body tipped forward (+) or back (-): -90 lies on the back, 90 on the front, the head
 *                    toward where they were facing's back or front. roll: tipped sideways (90 lies on a side).
 *             lean   the spine bent forward (a bow 50; leaning back -20); bend: sideways; twist: turned.
 *             nod    the head down (+) or back (-); tilt: to a shoulder; turn: looking round.
 *             aL, aR an arm: [raise, swing, elbow, twist, side, turn]. raise: forward and up from hanging (90
 *                    level in front, 180 overhead, negative behind); swing: that direction turned outward round the
 *                    body's upright (90: out to the side); elbow: its bend (0 straight, 140 hand to the face);
 *                    twist: the upper arm turned inward, so a bent forearm crosses the body (85: arms folded);
 *                    side: the forearm bent outward at the elbow (a little: an arm isn't hinged that way); turn:
 *                    the forearm turned inward about its own length (it turns the hand: the hand is the forearm's).
 *             lL, lR a leg: [raise, swing, knee, twist, turn]. raise: the thigh forward (88 sitting); swing:
 *                    outward; knee: its bend (88 sitting on a chair, 96 with raise 6 kneeling); twist: the thigh
 *                    turned outward about its own length (a bent knee falls out to the side); turn: the shin
 *                    turned outward about its length (it turns the foot out).
 *             fL, fR a foot at its ankle: [pitch, turn, roll]. pitch: toes pointed down (+: on tiptoe, kneeling
 *                    with the instep on the floor; to 70) or pulled up (to -45); turn: toes outward (+) or in
 *                    (45 either way); roll: tipped, its outer edge lifted (30 either way). Left out, a foot stays
 *                    square to its shin (in heels, as the heel holds it: the ankle's numbers are added to that).
 *             hL, hR a hand at its wrist: [bend, side, twist]. bend: the palm toward the inner forearm (+) or
 *                    the hand bent back (80 either way); side: toward the thumb (+) or the little finger (35);
 *                    twist: turned inward about the forearm's line (90). Left out, the hand is straight with its
 *                    forearm. What a hand holds goes with the hand: a glass tips when the wrist bends.
 *           Every list may stop early: what's left out is at rest (an arm hangs: raise 3, elbow 8).
 *           EVERY PART HAS ITS TURNS in one place (PART_STEPS, in the order the painter applies them): the body
 *           yaw, pitch, roll; the chest lean, bend, twist; the head nod, tilt, turn; an upper arm swing, raise,
 *           twist; a forearm elbow, side, turn; a hand twist, bend, side; a thigh swing, raise, twist; a shin
 *           knee, turn (a knee doesn't bend sideways); a foot pitch, turn, roll. (The street's crowd has no
 *           wrist: the hand's joint is the painter's own, windowAtlas.ts, for these rooms only. Fingers don't move.)
 *           L is the limb on the viewer's left when the figure faces the window. Sitting on a chair is
 *           lL and lR [88, 0, 88] with a seat; a stride is one leg [26, 0, 6] and the other [-18, 0, 30].
 *
 * THE RULES every scene is checked against, from any source (checkScene; tests/shops.test.ts):
 *   - A scene that is `adult`, in a vice room ("v_...") or on the ground floor ("g_...") has only adults in adult
 *     clothes: no "child" body, and none of the teen-sized outfits (school, track, gym, yankee). No exceptions.
 *   - The "nude" outfit only on a "woman" or a "man" body (never an elder's or a child's), and "nude_heels" only on
 *     a "woman", in a scene marked `adult`.
 *   - A wrist's and an ankle's numbers within what the joint can do (PART_STEPS has each one's range).
 *   - Unknown fields, items, props, bodies, outfits and hair, and numbers out of range, are errors.
 * And by hand: no sexual violence, nothing involving self-harm; the standard edition shows nothing explicit.
 *
 * GROUND-FLOOR ROOMS. A scene can also be what's inside a shady shop at street level, seen past the curtain of its
 * door (the rest of such a front is blacked out or frosted): its `cat` is then one of SHOP_KINDS:
 *   "g_cabaret"  a strip club (some bars, snack bars and clubs);  "g_hostess"  a hostess club (snack bars, clubs);
 *   "g_host"     a host club (clubs);                              "g_cards"    a back-room card game (mahjong parlours, izakaya);
 *   "g_loan"     a loan office (estate and loan agents);           "g_lobby"    a love hotel's lobby;
 *   "g_slumped"  a bar late at night (bars, snack bars, izakaya);  "g_exchange" a pachinko hall's exchange window.
 * These shops are only in the zones with the most vice (look.vice 0.84 and up: Kaburo's Love District, host
 * street and back alleys, the port's nightlife), and busiest at night. Each kind has ONE room: the last scene of
 * that kind in the list is the one painted, so an edition's scene replaces the built-in one. They count as vice
 * scenes (adults only) and take no cell of the windows' atlas. A ground-floor room is still and is 4 m of a shop
 * that repeats along its front: only `a`, `aItems`, `front`, `back`, `deep` and `near` are drawn (no second
 * frame, no walking); `back` is drawn on the far wall, or with `near` close behind the people along with `deep`.
 * Spread the people across the 4 m: the door shows about 1.5 m of it, anywhere. Rooms are 2.6 m high.
 *
 * DISTANCE. How far into the room a thing stands is first of all its layer: `front` just in front of the people,
 * the people, `back` (and `deep`) against the far wall or, with `near`, close behind them. The wall shader stands
 * those layers at their depths and they part as the viewer moves. Within a layer everything is one flat outline,
 * so who overlaps whom there doesn't matter; but a figure or an item can be given a `depth`: metres further back
 * than its layer. It is then drawn as that looks from the street's side at eye level: smaller, about a horizon
 * DEPTH_EYE.y (1.5 m) up from the floor, by DEPTH_EYE.d / (DEPTH_EYE.d + depth), so it stands higher in the frame
 * and nearer the middle (x and heights stay its real ones in the room: depthPoint). It still moves with its layer
 * as you walk past (the parallax is the layer's). In-betweens carry it across. A whole scene can stand further
 * from its window with `setBack` (metres added to how far in a room's people stand, 0 to 2.5; the room's own
 * depth limits it; window scenes only): the layers then really are further in, so they look smaller from the
 * street and the window's frame hides more of them.
 *
 * NUDITY. The outfit "nude" (a woman's or a man's body with nothing over it: a mannequin's, smooth, no anatomical
 * detail but a bare woman's breasts' own shape and her navel (the uncensored edition adds more: real/mobBare.ts), and a scene may add none; barefoot) is allowed only in a scene marked `adult` (so never in the demo), on the
 * "woman" and "man" bodies only; "nude_heels" is the same woman in high heels (a cabaret's dancer). CAST: "nude",
 * "nude_heels", "nude_man". Nobody in the street's crowd can wear either.
 *
 * HOW IT'S DRAWN. A scene is a cell of four layers, one to a channel of the atlas: R `back`, G the people's first
 * pose, B `front`, A their second pose or, in a still scene, `deep`; further poses are in the frame slots. The
 * people's layers are stored as distance fields, which the shader blends between poses. The shader stands the layers at
 * three depths in the room (interior mapping), so they part as you move.
 */

// ---- who ----

/** One of the mob: a body, what it wears and its hair (people.ts: the street's own templates). */
export interface Who {
  readonly body: Body;
  readonly outfit: Outfit;
  readonly hair: Hair;
}
const who = (body: Body, outfit: Outfit, hair: Hair): Who => ({ body, outfit, hair });
export const CAST = {
  // At home.
  man: who('man', 'plain', 'short'),
  man2: who('man', 'hoodie', 'short'),
  woman: who('woman', 'plain', 'bob'),
  woman2: who('woman', 'plain', 'long'),
  mom: who('woman', 'apron', 'bun'),
  dress: who('woman', 'dress', 'long'),
  elder: who('elder', 'plain', 'short'),
  elder2: who('elder', 'plain', 'none'),
  boy: who('child', 'plain', 'short'),
  girl: who('child', 'plain', 'twin'),
  // At work.
  suit: who('man', 'suit', 'short'),
  suit2: who('man', 'suit', 'none'),
  clerk: who('woman', 'office', 'bob'),
  clerk2: who('woman', 'office', 'ponytail'),
  wsuit: who('woman', 'suit', 'bun'),
  boss: who('elder', 'suit', 'short'),
  fatcat: who('man', 'boss', 'none'),
  worker: who('man', 'work', 'cap'),
  shirt: who('man', 'office', 'short'),
  // A hotel's own robes.
  robe: who('man', 'yukata', 'short'),
  robe2: who('woman', 'yukata', 'bun'),
  // The night.
  yakuza: who('man', 'yakuza', 'none'),
  yakuza2: who('man', 'yakuza', 'cap'),
  oyabun: who('elder', 'yakuza', 'short'),
  chinpira: who('man', 'chinpira', 'short'),
  tattoo: who('man', 'irezumi', 'none'),
  drunk: who('man', 'drunk', 'short'),
  hood: who('man', 'hood', 'cap'),
  hostess: who('woman', 'gown', 'long'),
  hostess2: who('woman', 'gown', 'bun'),
  dancer: who('woman', 'mini', 'long'),
  dancer2: who('woman', 'mini', 'ponytail'),
  mama: who('woman', 'kimono', 'bun'),
  host: who('man', 'suit', 'long'),
  // A cabaret's dancer (only in a scene marked adult).
  nude: who('woman', 'nude', 'long'),
  // A man with nothing on (only in a scene marked adult).
  nude_man: who('man', 'nude', 'short'),
  // The dancer in her high heels and nothing else (the same rule).
  nude_heels: who('woman', 'nude_heels', 'long'),
} as const;
export type CastName = keyof typeof CAST;

/** The outfits cut to a teen's size (mobShape.ts): never in a vice scene. */
export const TEEN_OUTFITS: readonly Outfit[] = ['school', 'pinoy_school', 'track', 'gym', 'yankee'];
export const whoOf = (w: CastName | Who): Who => (typeof w === 'string' ? CAST[w] : w);
export const isAdult = (w: CastName | Who): boolean => whoOf(w)?.body !== 'child' && !TEEN_OUTFITS.includes(whoOf(w)?.outfit);

// ---- how they hold themselves ----

/**
 * An arm: raised forward, swung out round the body's upright, the elbow's bend, the upper arm turned in; then the
 * forearm bent outward at the elbow, and turned inward about its own length (degrees).
 */
export type Arm = readonly [raise: number, swing?: number, elbow?: number, twist?: number, side?: number, turn?: number];
/** A leg: the thigh raised forward, swung out, the knee's bend; then the thigh turned out about its length, and the shin (degrees). */
export type Leg = readonly [raise: number, swing?: number, knee?: number, twist?: number, turn?: number];
/** A foot at its ankle: toes pointed down (+) or pulled up, turned out, tipped with its outer edge lifted (degrees). */
export type Foot = readonly [pitch: number, turn?: number, roll?: number];
/** A hand at its wrist: the palm bent toward the inner forearm (+) or back, toward the thumb (+) or the little finger, turned inward about the forearm's line (degrees). */
export type Hand = readonly [bend: number, side?: number, twist?: number];
/**
 * A pose, in degrees, every part optional. `yaw`: which way they face (0 the window, 90 the viewer's right, 180 the
 * room); `pitch` and `roll` tip the whole body (pitch -90 lies it on its back, 90 on its front, head toward where it
 * faced; roll 90 on its side). The spine leans forward (`lean`), to the side (`bend`) and turns (`twist`); the head
 * nods, tilts and turns. L is the limb on the viewer's left when they face the window.
 */
export interface Pose {
  readonly yaw?: number;
  readonly pitch?: number;
  readonly roll?: number;
  readonly lean?: number;
  readonly bend?: number;
  readonly twist?: number;
  readonly nod?: number;
  readonly tilt?: number;
  readonly turn?: number;
  readonly aL?: Arm;
  readonly aR?: Arm;
  readonly lL?: Leg;
  readonly lR?: Leg;
  readonly fL?: Foot;
  readonly fR?: Foot;
  readonly hL?: Hand;
  readonly hR?: Hand;
}

// ---- the body's parts, and what turns each ----

/** The parts of a figure that turn: the whole body (at its hips), the chest (the spine), the head, and each limb's. */
export const PARTS = ['body', 'chest', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'] as const;
export type PartName = (typeof PARTS)[number];
/**
 * One turn of a part about one of its own axes (x across the body, y up along it or along a limb, z toward the
 * front). A part's turns are applied in their list's order, outermost first, so a later turn's axis rides on the
 * earlier ones (an arm is swung round the body, then raised, then turned about its own length). Most are a number
 * of the pose (`key`, and for a limb's list its place `at`), with what it is when left out and how far a joint
 * goes; a few are fixed (how an arm hangs).
 */
export interface PartStep {
  readonly axis: 'x' | 'y' | 'z';
  /** Which way a positive number turns it about that axis (right-handed: 1 or -1). */
  readonly sign: 1 | -1;
  /** The pose's number it is (a fixed turn has none). */
  readonly name?: string;
  readonly key?: keyof Pose;
  readonly at?: number;
  readonly def: number;
  readonly range: readonly [number, number];
  /** A fixed turn in degrees instead, or the body's own angle between a hanging arm and upright. */
  readonly fixed?: number | 'armOut';
}
const step = (name: string, axis: PartStep['axis'], sign: number, key: keyof Pose, at: number | undefined, def: number, lo: number, hi: number): PartStep => ({ axis, sign: sign < 0 ? -1 : 1, name, key, ...(at === undefined ? {} : { at }), def, range: [lo, hi] });
const fixedStep = (axis: PartStep['axis'], sign: number, fixed: number | 'armOut'): PartStep => ({ axis, sign: sign < 0 ? -1 : 1, def: 0, range: [0, 0], fixed });
const limbSteps = <S extends 'L' | 'R'>(side: S): Record<`${'arm' | 'fore' | 'hand' | 'thigh' | 'shin' | 'foot'}${S}`, readonly PartStep[]> => {
  // (L is the limb at the figure's -x: outward is the other way round for each side.)
  const sg = side === 'L' ? -1 : 1;
  const a = `a${side}` as const, l = `l${side}` as const, f = `f${side}` as const, h = `h${side}` as const;
  return {
    // Hanging straight first (the bind pose holds the arms a little out), turned about its own length, a touch out
    // from the body, raised forward, then swung round the body's upright.
    [`arm${side}`]: [step('swing', 'y', sg, a, 1, 0, -100, 190), step('raise', 'x', -1, a, 0, 3, -120, 220), fixedStep('z', sg, 5), step('twist', 'y', -sg, a, 3, 0, -120, 120), fixedStep('z', -sg, 'armOut')],
    [`fore${side}`]: [step('elbow', 'x', -1, a, 2, 8, 0, 155), step('side', 'z', sg, a, 4, 0, -40, 40), step('turn', 'y', -sg, a, 5, 0, -90, 90)],
    // The hand at its wrist (it hangs palm to the thigh, thumb forward): turned about the forearm's line first, then
    // bent toward its palm or back, then toward the thumb or the little finger.
    [`hand${side}`]: [step('twist', 'y', -sg, h, 2, 0, -90, 90), step('bend', 'z', -sg, h, 0, 0, -80, 80), step('side', 'x', -1, h, 1, 0, -35, 35)],
    [`thigh${side}`]: [step('swing', 'y', sg, l, 1, 0, -50, 100), step('raise', 'x', -1, l, 0, 0, -70, 150), step('twist', 'y', sg, l, 3, 0, -60, 60)],
    [`shin${side}`]: [step('knee', 'x', 1, l, 2, 0, 0, 155), step('turn', 'y', sg, l, 4, 0, -45, 45)],
    [`foot${side}`]: [step('pitch', 'x', 1, f, 0, 0, -45, 70), step('turn', 'y', sg, f, 1, 0, -45, 45), step('roll', 'z', sg, f, 2, 0, -30, 30)],
  } as unknown as Record<`${'arm' | 'fore' | 'hand' | 'thigh' | 'shin' | 'foot'}${S}`, readonly PartStep[]>;
};
/** Every part's turns, in the order the painter applies them (windowAtlas.ts poseBones reads this very list). */
export const PART_STEPS: Record<PartName, readonly PartStep[]> = {
  body: [step('yaw', 'y', 1, 'yaw', undefined, 0, -180, 180), step('pitch', 'x', 1, 'pitch', undefined, 0, -180, 180), step('roll', 'z', 1, 'roll', undefined, 0, -180, 180)],
  chest: [step('lean', 'x', 1, 'lean', undefined, 0, -50, 100), step('bend', 'z', 1, 'bend', undefined, 0, -50, 50), step('twist', 'y', 1, 'twist', undefined, 0, -60, 60)],
  head: [step('nod', 'x', 1, 'nod', undefined, 0, -70, 80), step('tilt', 'z', 1, 'tilt', undefined, 0, -50, 50), step('turn', 'y', 1, 'turn', undefined, 0, -90, 90)],
  ...limbSteps('L'),
  ...limbSteps('R'),
};
/** What a limb's list holds where it stops early: an arm hanging, a leg straight, a foot square to its shin. */
export const LIMB_REST = { a: [3, 0, 8, 0, 0, 0], l: [0, 0, 0, 0, 0], f: [0, 0, 0], h: [0, 0, 0] } as const;
const restOf = (key: string): readonly number[] => LIMB_REST[key[0] as 'a' | 'l' | 'f' | 'h'];
/** How far each of a wrist's and an ankle's numbers may go (the checks hold a scene to these). */
const JOINT_RANGE: Record<string, (readonly [number, number])[]> = {};
for (const st of Object.values(PART_STEPS).flat()) if (st.key !== undefined && st.at !== undefined && /^[fh]/.test(st.key)) (JOINT_RANGE[st.key] ??= [])[st.at] = st.range;
/** A turn's number in a pose (what it is at rest where the pose leaves it out). */
export function poseValue(p: Pose, st: PartStep): number {
  if (st.key === undefined) return 0;
  const v = p[st.key];
  return (st.at === undefined ? (v as number | undefined) : (v as readonly number[] | undefined)?.[st.at]) ?? st.def;
}
/**
 * A pose with one turn set. Nothing is written that needn't be: a body's, chest's or head's turn at rest is left
 * out, a limb's list stops after its last number that isn't at rest, and a limb wholly at rest isn't mentioned.
 */
export function poseWith(p: Pose, st: PartStep, value: number): Pose {
  if (st.key === undefined) return p;
  const next: Record<string, unknown> = { ...p };
  if (st.at === undefined) {
    if (value === st.def) delete next[st.key];
    else next[st.key] = value;
    return next as Pose;
  }
  const rest = restOf(st.key);
  const now = (p[st.key] as readonly number[] | undefined) ?? [];
  const list = rest.map((r, i) => now[i] ?? r);
  list[st.at] = value;
  let n = list.length;
  while (n > 1 && list[n - 1] === rest[n - 1]) n--;
  // (A limb wholly at rest is as good as unmentioned: an arm hangs, a foot is square to its shin.)
  if (n === 1 && list[0] === rest[0]) delete next[st.key];
  else next[st.key] = list.slice(0, n);
  return next as Pose;
}

/**
 * What a hand holds (PROPS): drawn at the hand along the forearm, or at `rot` degrees from level (null: along the
 * forearm); moved dx, dy metres in the picture from there, and drawn `scale` times its size about that point.
 */
export type Hold = readonly [hand: 'L' | 'R', prop: PropName, rot?: number | null, dx?: number, dy?: number, scale?: number];
/** A hold's numbers, what's left out filled in (rot undefined: along the forearm). */
export interface HoldAt {
  readonly hand: 'L' | 'R';
  readonly prop: PropName;
  readonly rot: number | undefined;
  readonly dx: number;
  readonly dy: number;
  readonly scale: number;
}
/** How far a held thing may be moved from its hand (m), and how much larger or smaller it may be drawn. */
export const HOLD_REACH = 0.6;
export const HOLD_SCALE = [0.4, 2.5] as const;
export const holdAt = (h: Hold): HoldAt => ({ hand: h[0], prop: h[1], rot: h[2] ?? undefined, dx: h[3] ?? 0, dy: h[4] ?? 0, scale: h[5] ?? 1 });
/** A hold as a scene keeps it: only the numbers that are set, nothing trailing at its default. */
export function holdOf(a: HoldAt): Hold {
  const out: unknown[] = [a.hand, a.prop, a.rot ?? null, a.dx || 0, a.dy || 0, a.scale];
  if (a.scale === 1) {
    out.pop();
    if (!a.dy) {
      out.pop();
      if (!a.dx) {
        out.pop();
        if (a.rot === undefined) out.pop();
      }
    }
  }
  return out as unknown as Hold;
}
export interface Fig {
  readonly who: CastName | Who;
  /** Where their hips are across the room (m from its middle). */
  readonly x: number;
  readonly pose: Pose;
  /** Sitting: the seat's height (their hips rest on it); otherwise they stand (or lie) on `floor` (default 0). */
  readonly seat?: number;
  readonly floor?: number;
  readonly hold?: readonly Hold[];
  /** Metres further back in the room than its layer: drawn smaller and higher (depthPoint). */
  readonly depth?: number;
}

/** The eye a thing further back is drawn for: its height above the room's floor (the horizon), and how far it is in front of the layer. */
export const DEPTH_EYE = { y: 1.5, d: 5 } as const;
/** As far back as a figure or an item may be put behind its layer, and a scene behind its window (m). */
export const MAX_DEPTH = 2.5;
/** How much smaller a thing `depth` metres further back than its layer is drawn. */
export const depthScale = (depth: number | undefined): number => DEPTH_EYE.d / (DEPTH_EYE.d + (depth ?? 0));
/** Where a point of the room that far back comes out in its layer's picture: toward the middle and the horizon. */
export const depthPoint = (x: number, y: number, depth: number | undefined): [number, number] => {
  const k = depthScale(depth);
  return [x * k, DEPTH_EYE.y + (y - DEPTH_EYE.y) * k];
};
/** And back: the point of the room a point of the picture is, for a thing that far back. */
export const depthUnpoint = (px: number, py: number, depth: number | undefined): [number, number] => {
  const k = depthScale(depth);
  return [px / k, DEPTH_EYE.y + (py - DEPTH_EYE.y) / k];
};

const fig = (name: CastName, x: number, pose: Pose = {}, o: Omit<Fig, 'who' | 'x' | 'pose'> = {}): Fig => ({ who: name, x, pose, ...o });

// Facing: the viewer's right, the viewer's left, the room.
const R = 90, L = -90, B = 180;
const SIT: Pose = { lL: [88, 0, 88], lR: [88, 0, 88] };
const FLOOR_SIT: Pose = { lL: [78, 38, 125], lR: [78, 38, 125] };
/** A stride and its other half. */
const STEP_A: Pose = { lL: [26, 0, 6], lR: [-18, 0, 30], aL: [-20, 0, 16], aR: [24, 0, 26] };
const STEP_B: Pose = { lL: [-18, 0, 30], lR: [26, 0, 6], aL: [24, 0, 26], aR: [-20, 0, 16] };
const CROSSED: Pose = { aL: [38, 0, 105, 85], aR: [36, 0, 100, 85] };
const TYPING: Pose = { ...SIT, aL: [38, 0, 72], aR: [36, 0, 76], lean: 6 };

// ---- the furniture ----

/** What the furniture and the props are drawn with: filled dark shapes, in the room's metres (y up). */
export interface Pen {
  rect(x: number, y: number, w: number, h: number): void;
  rr(x: number, y: number, w: number, h: number, r: number): void;
  ell(cx: number, cy: number, rx: number, ry: number): void;
  poly(pts: readonly number[]): void;
  /** A stroke `t` thick with round ends. */
  line(x0: number, y0: number, x1: number, y1: number, t: number): void;
}

const outline = (p: Pen, x: number, y: number, w: number, h: number, t: number): void => {
  p.rect(x, y, w, t);
  p.rect(x, y + h - t, w, t);
  p.rect(x, y, t, h);
  p.rect(x + w - t, y, t, h);
};
const bottle = (p: Pen, x: number, y: number, k = 1): void => {
  p.rr(x - 0.035 * k, y, 0.07 * k, 0.19 * k, 0.015);
  p.rect(x - 0.014 * k, y + 0.18 * k, 0.028 * k, 0.09 * k);
};

/** Furniture, each drawn about x (the scene's metres), standing on the floor unless it says otherwise. */
export const ITEMS = {
  // Against the back wall.
  shelf: (p: Pen, x: number, w = 1, h = 1.8) => {
    outline(p, x - w / 2, 0, w, h, 0.04);
    for (let y = 0.36; y < h - 0.1; y += 0.36) {
      p.rect(x - w / 2, y, w, 0.03);
      // Books and boxes along each board, in runs with gaps.
      for (let i = 0, bx = x - w / 2 + 0.06; bx < x + w / 2 - 0.1; i++) {
        const bw = 0.05 + 0.04 * ((i * 7 + Math.round(y * 10)) % 3);
        if ((i + Math.round(y * 3)) % 5 !== 3) p.rect(bx, y + 0.03, bw, 0.17 + 0.05 * ((i * 5 + Math.round(y * 7)) % 3));
        bx += bw + 0.012;
      }
    }
  },
  cabinets: (p: Pen, x: number, n = 2, h = 1.32) => {
    for (let i = 0; i < n; i++) p.rect(x + (i - n / 2) * 0.47, 0, 0.45, h);
  },
  lockers: (p: Pen, x: number, n = 3) => {
    for (let i = 0; i < n; i++) p.rect(x + (i - n / 2) * 0.34, 0, 0.32, 1.8);
  },
  door: (p: Pen, x: number) => {
    outline(p, x - 0.5, 0, 1, 2.1, 0.06);
    p.rect(x + 0.3, 0.98, 0.1, 0.04);
  },
  picture: (p: Pen, x: number, y = 1.5, w = 0.5, h = 0.4) => outline(p, x - w / 2, y - h / 2, w, h, 0.035),
  board: (p: Pen, x: number, w = 1.6) => {
    outline(p, x - w / 2, 0.95, w, 1.0, 0.04);
    p.rect(x - w / 2, 0.9, w, 0.04);
  },
  bottles: (p: Pen, x: number, w = 2.4) => {
    for (const y of [1.05, 1.45, 1.85]) {
      p.rect(x - w / 2, y, w, 0.035);
      for (let i = 0, bx = x - w / 2 + 0.1; bx < x + w / 2 - 0.08; i++, bx += 0.115 + 0.03 * (i % 2)) if ((i * 3 + Math.round(y * 4)) % 7 !== 2) bottle(p, bx, y + 0.035, 0.85 + 0.2 * ((i + Math.round(y * 2)) % 3) * 0.5);
    }
    p.rect(x - w / 2, 0, w, 0.9);
  },
  wardrobe: (p: Pen, x: number) => {
    p.rect(x - 0.52, 0, 0.5, 1.95);
    p.rect(x + 0.02, 0, 0.5, 1.95);
    p.rect(x - 0.56, 1.95, 1.12, 0.05);
  },
  tv: (p: Pen, x: number) => {
    p.rect(x - 0.55, 0, 1.1, 0.42);
    p.rect(x - 0.06, 0.42, 0.12, 0.08);
    p.rr(x - 0.5, 0.5, 1.0, 0.6, 0.03);
  },
  kitchen: (p: Pen, x: number, w = 2.2) => {
    p.rect(x - w / 2, 0, w, 0.86);
    p.rect(x - w / 2, 1.5, w * 0.62, 0.6);
    // A kettle, a pan with its handle, a pot, the tap.
    p.rr(x - w / 2 + 0.2, 0.86, 0.2, 0.18, 0.06);
    p.line(x - w / 2 + 0.4, 0.98, x - w / 2 + 0.48, 1.04, 0.025);
    p.rect(x - 0.1, 0.86, 0.3, 0.07);
    p.line(x + 0.2, 0.9, x + 0.42, 0.92, 0.025);
    p.rr(x + w / 2 - 0.55, 0.86, 0.26, 0.2, 0.03);
    p.poly([x + w / 2 - 0.2, 1.5, x + w / 2 - 0.9, 1.5, x + w / 2 - 0.75, 1.72, x + w / 2 - 0.35, 1.72]);
  },
  fridge: (p: Pen, x: number) => {
    p.rr(x - 0.32, 0, 0.64, 1.1, 0.02);
    p.rr(x - 0.32, 1.12, 0.64, 0.6, 0.02);
  },
  hanger: (p: Pen, x: number) => {
    p.rect(x - 0.02, 0, 0.04, 1.75);
    p.rect(x - 0.22, 0, 0.44, 0.04);
    p.line(x - 0.18, 1.7, x + 0.18, 1.7, 0.03);
    p.poly([x - 0.2, 1.66, x + 0.06, 1.66, x + 0.1, 0.8, x - 0.24, 0.8]);
  },
  stage: (p: Pen, x: number, w = 1.6) => {
    p.rect(x - w / 2, 0, w, 0.28);
    p.rect(x + w / 2 + 0.08, 0, 0.36, 0.7);
  },
  pole: (p: Pen, x: number) => p.rect(x - 0.022, 0, 0.044, 2.5),
  safe: (p: Pen, x: number) => {
    p.rr(x - 0.34, 0, 0.68, 0.86, 0.03);
    p.ell(x + 0.36, 0.5, 0.06, 0.06);
  },
  copier: (p: Pen, x: number) => {
    p.rect(x - 0.36, 0, 0.72, 0.98);
    p.rect(x - 0.4, 0.98, 0.8, 0.09);
    p.poly([x + 0.36, 0.62, x + 0.62, 0.56, x + 0.62, 0.6, x + 0.36, 0.7]);
  },
  karaoke: (p: Pen, x: number) => {
    p.rect(x - 0.3, 0, 0.6, 0.95);
    p.rr(x - 0.45, 1.0, 0.9, 0.6, 0.03);
    p.rect(x + 0.6, 0, 0.3, 0.8);
  },
  // On the floor about the room.
  plant: (p: Pen, x: number, h = 1.3) => {
    p.poly([x - 0.15, 0.3, x + 0.15, 0.3, x + 0.11, 0, x - 0.11, 0]);
    for (let i = 0; i < 7; i++) {
      const a = -1.2 + i * 0.4;
      p.line(x, 0.3, x + Math.sin(a) * (0.25 + 0.06 * (i % 2)), 0.3 + Math.cos(a) * (h - 0.4) * (0.75 + 0.25 * ((i * 3) % 2)), 0.06);
      p.ell(x + Math.sin(a) * 0.27, 0.3 + Math.cos(a) * (h - 0.45), 0.09, 0.14);
    }
  },
  lamp: (p: Pen, x: number, h = 1.6) => {
    p.rect(x - 0.012, 0, 0.024, h - 0.2);
    p.ell(x, 0.015, 0.14, 0.02);
    p.poly([x - 0.11, h - 0.02, x + 0.11, h - 0.02, x + 0.2, h - 0.34, x - 0.2, h - 0.34]);
  },
  pendant: (p: Pen, x: number, y = 1.85) => {
    p.rect(x - 0.008, y, 0.016, 2.5 - y);
    p.poly([x - 0.07, y, x + 0.07, y, x + 0.24, y - 0.16, x - 0.24, y - 0.16]);
  },
  desk: (p: Pen, x: number, w = 1.4) => {
    p.rect(x - w / 2, 0.69, w, 0.045);
    p.rect(x - w / 2 + 0.03, 0, 0.045, 0.7);
    p.rect(x + w / 2 - 0.075, 0, 0.045, 0.7);
    p.rect(x - w / 2 + 0.03, 0.42, w - 0.06, 0.03);
  },
  bigdesk: (p: Pen, x: number, w = 1.8) => {
    p.rect(x - w / 2 - 0.05, 0.72, w + 0.1, 0.06);
    p.rect(x - w / 2, 0, w, 0.74);
  },
  monitor: (p: Pen, x: number, y = 0.735) => {
    p.rect(x - 0.1, y, 0.2, 0.02);
    p.rect(x - 0.025, y, 0.05, 0.1);
    p.rr(x - 0.24, y + 0.09, 0.48, 0.32, 0.02);
  },
  dlamp: (p: Pen, x: number, y = 0.735, dir = 1) => {
    p.ell(x, y + 0.012, 0.08, 0.014);
    p.line(x, y, x - 0.05 * dir, y + 0.26, 0.022);
    p.line(x - 0.05 * dir, y + 0.26, x + 0.16 * dir, y + 0.4, 0.022);
    p.poly([x + 0.1 * dir, y + 0.42, x + 0.26 * dir, y + 0.44, x + 0.27 * dir, y + 0.3, x + 0.14 * dir, y + 0.31]);
  },
  papers: (p: Pen, x: number, y = 0.735, n = 3) => {
    for (let i = 0; i < n; i++) p.rect(x - 0.15 + (i % 2) * 0.03, y + i * 0.035, 0.3, 0.028);
  },
  phone: (p: Pen, x: number, y = 0.735) => {
    p.rr(x - 0.1, y, 0.2, 0.06, 0.015);
    p.rr(x - 0.12, y + 0.06, 0.24, 0.04, 0.02);
  },
  chair: (p: Pen, x: number, dir = 1, seat = 0.45) => {
    p.rr(x - 0.22, seat - 0.04, 0.44, 0.07, 0.02);
    p.rr(x - (dir > 0 ? 0.25 : -0.2), seat, 0.05, 0.52, 0.02);
    p.rect(x - 0.02, 0.06, 0.04, seat - 0.08);
    p.rect(x - 0.24, 0.02, 0.48, 0.04);
  },
  stool: (p: Pen, x: number, seat = 0.75) => {
    p.rr(x - 0.17, seat - 0.03, 0.34, 0.07, 0.03);
    p.rect(x - 0.02, 0.04, 0.04, seat - 0.05);
    p.ell(x, 0.03, 0.19, 0.03);
    p.rect(x - 0.15, 0.3, 0.3, 0.025);
  },
  sofa: (p: Pen, x: number, w = 1.8) => {
    p.rr(x - w / 2, 0.1, w, 0.36, 0.06);
    p.rr(x - w / 2 + 0.1, 0.3, w - 0.2, 0.56, 0.1);
    p.rr(x - w / 2 - 0.06, 0.1, 0.24, 0.56, 0.08);
    p.rr(x + w / 2 - 0.18, 0.1, 0.24, 0.56, 0.08);
    p.rect(x - w / 2 + 0.05, 0, 0.07, 0.1);
    p.rect(x + w / 2 - 0.12, 0, 0.07, 0.1);
  },
  /** An armchair or a sofa end on: its back on the side away from `dir`. */
  armchair: (p: Pen, x: number, dir = 1) => {
    p.rr(x - 0.42, 0.1, 0.84, 0.34, 0.07);
    p.poly([x - 0.46 * dir, 0.12, x - 0.26 * dir, 0.12, x - 0.34 * dir, 0.92, x - 0.52 * dir, 0.9]);
    p.rr(x - 0.36, 0.38, 0.72, 0.2, 0.08);
    p.rect(x - 0.36, 0, 0.07, 0.1);
    p.rect(x + 0.29, 0, 0.07, 0.1);
  },
  table: (p: Pen, x: number, w = 1.0, h = 0.7) => {
    p.rect(x - w / 2, h - 0.04, w, 0.045);
    p.rect(x - w / 2 + 0.05, 0, 0.045, h);
    p.rect(x + w / 2 - 0.095, 0, 0.045, h);
  },
  roundtable: (p: Pen, x: number, w = 0.8, h = 0.7) => {
    p.rr(x - w / 2, h - 0.04, w, 0.045, 0.02);
    p.rect(x - 0.03, 0.03, 0.06, h - 0.06);
    p.ell(x, 0.025, w * 0.3, 0.025);
  },
  kotatsu: (p: Pen, x: number) => {
    p.rect(x - 0.55, 0.34, 1.1, 0.04);
    p.poly([x - 0.5, 0.34, x + 0.5, 0.34, x + 0.72, 0, x - 0.72, 0]);
  },
  bed: (p: Pen, x: number, w = 2.0, dir = -1) => {
    p.rr(x - w / 2, 0.16, w, 0.36, 0.06);
    p.rect(x - w / 2 + 0.04, 0, w - 0.08, 0.2);
    p.rr(x + (dir * w) / 2 - 0.06, 0.1, 0.12, 0.9, 0.04);
    p.rr(x + dir * (w / 2 - 0.36) - 0.22, 0.5, 0.44, 0.13, 0.06);
  },
  /** A bed end on (a narrow hotel room's), its headboard behind it. */
  bedend: (p: Pen, x: number, w = 1.4) => {
    p.rr(x - w / 2, 0.14, w, 0.4, 0.07);
    p.rect(x - w / 2 + 0.05, 0, 0.08, 0.16);
    p.rect(x + w / 2 - 0.13, 0, 0.08, 0.16);
    p.rr(x - w / 2 - 0.04, 0.3, w + 0.08, 0.72, 0.05);
  },
  futon: (p: Pen, x: number, w = 1.9) => {
    p.rr(x - w / 2, 0, w, 0.14, 0.06);
    p.rr(x - w / 2 + 0.05, 0.1, 0.42, 0.12, 0.05);
  },
  nightstand: (p: Pen, x: number) => {
    p.rect(x - 0.22, 0, 0.44, 0.52);
    p.rect(x - 0.012, 0.52, 0.024, 0.2);
    p.poly([x - 0.08, 0.92, x + 0.08, 0.92, x + 0.15, 0.7, x - 0.15, 0.7]);
  },
  counter: (p: Pen, x: number, w = 3.0) => {
    p.rect(x - w / 2, 0, w, 1.02);
    p.rect(x - w / 2 - 0.06, 1.02, w + 0.12, 0.05);
  },
  mahjong: (p: Pen, x: number) => {
    p.rect(x - 0.5, 0.68, 1.0, 0.06);
    p.rect(x - 0.06, 0.05, 0.12, 0.64);
    p.rect(x - 0.3, 0, 0.6, 0.05);
    for (let i = 0; i < 9; i++) p.rect(x - 0.3 + i * 0.066, 0.74, 0.055, 0.075);
  },
  pool: (p: Pen, x: number) => {
    p.rect(x - 1.15, 0.66, 2.3, 0.16);
    p.rect(x - 1.0, 0, 0.14, 0.68);
    p.rect(x + 0.86, 0, 0.14, 0.68);
  },
  suitcase: (p: Pen, x: number, y = 0) => {
    p.rr(x - 0.3, y, 0.6, 0.42, 0.05);
    p.rr(x - 0.1, y + 0.42, 0.2, 0.07, 0.03);
  },
  bag: (p: Pen, x: number, y = 0) => {
    p.rr(x - 0.32, y, 0.64, 0.3, 0.12);
    p.line(x - 0.14, y + 0.28, x + 0.14, y + 0.28, 0.05);
  },
  boxes: (p: Pen, x: number) => {
    p.rect(x - 0.4, 0, 0.5, 0.42);
    p.rect(x + 0.12, 0, 0.4, 0.34);
    p.rect(x - 0.3, 0.42, 0.42, 0.36);
  },
  shredder: (p: Pen, x: number) => {
    p.rect(x - 0.22, 0, 0.44, 0.62);
    p.rect(x - 0.25, 0.62, 0.5, 0.08);
  },
  // On a table (y: its top).
  bottle: (p: Pen, x: number, y = 0.705) => bottle(p, x, y),
  bottles3: (p: Pen, x: number, y = 0.705) => {
    bottle(p, x - 0.16, y);
    bottle(p, x, y, 0.8);
    p.rr(x + 0.1, y, 0.24, 0.07, 0.03);
  },
  glass: (p: Pen, x: number, y = 0.705) => p.poly([x - 0.035, y + 0.1, x + 0.035, y + 0.1, x + 0.027, y, x - 0.027, y]),
  stacks: (p: Pen, x: number, y = 0.705, n = 3) => {
    for (let i = 0; i < n; i++) p.rect(x + i * 0.15 - (n * 0.15) / 2, y, 0.13, 0.05 + 0.045 * ((i * 2 + 1) % 3));
  },
  case: (p: Pen, x: number, y = 0.705) => {
    p.rect(x - 0.24, y, 0.48, 0.09);
    p.poly([x - 0.24, y + 0.09, x - 0.2, y + 0.09, x - 0.3, y + 0.42, x - 0.34, y + 0.42]);
    p.rect(x - 0.18, y + 0.09, 0.36, 0.035);
  },
  envelope: (p: Pen, x: number, y = 0.74) => p.rr(x - 0.11, y, 0.22, 0.035, 0.01),
  packets: (p: Pen, x: number, y = 0.705) => {
    p.rr(x - 0.14, y, 0.12, 0.05, 0.02);
    p.rr(x + 0.0, y, 0.12, 0.05, 0.02);
    p.rr(x - 0.07, y + 0.05, 0.12, 0.05, 0.02);
  },
  ashtray: (p: Pen, x: number, y = 0.705) => p.rr(x - 0.07, y, 0.14, 0.035, 0.015),
  tiles: (p: Pen, x: number, y = 0.74) => {
    for (let i = 0; i < 5; i++) p.rect(x - 0.16 + i * 0.066, y, 0.055, 0.075);
  },
  flying: (p: Pen, x: number, y = 0.9) => {
    p.poly([x, y, x + 0.24, y + 0.1, x + 0.22, y + 0.14, x - 0.02, y + 0.04]);
    p.poly([x + 0.34, y + 0.3, x + 0.56, y + 0.26, x + 0.57, y + 0.3, x + 0.35, y + 0.34]);
    p.rr(x + 0.5, y - 0.12, 0.2, 0.06, 0.02);
    p.poly([x + 0.7, y + 0.12, x + 0.9, y + 0.02, x + 0.92, y + 0.06, x + 0.72, y + 0.16]);
  },
  /** Something long and heavy, rolled up, carried level between two men. */
  bundle: (p: Pen, x: number, y = 0.86, w = 1.9) => {
    p.line(x - w / 2, y, x + w / 2, y + 0.04, 0.3);
    p.line(x - w / 2 + 0.3, y - 0.16, x - w / 2 + 0.3, y + 0.16, 0.035);
    p.line(x + w / 2 - 0.35, y - 0.13, x + w / 2 - 0.35, y + 0.2, 0.035);
  },
  /** Manila: an electric stand fan (the guard a disc, a pole and a round base). */
  fan: (p: Pen, x: number, h = 1.05) => {
    p.ell(x, 0.03, 0.2, 0.035);
    p.rect(x - 0.018, 0.04, 0.036, h - 0.06);
    p.ell(x, h + 0.14, 0.24, 0.24);
    p.rect(x - 0.05, h + 0.02, 0.1, 0.12);
  },
  /** Manila: a wall shelf with a Santo Nino in his robe and crown, two candles and a vase, a framed print above. */
  altar: (p: Pen, x: number) => {
    p.rect(x - 0.45, 1.1, 0.9, 0.04);
    p.rect(x - 0.4, 0.98, 0.04, 0.12);
    p.rect(x + 0.36, 0.98, 0.04, 0.12);
    p.rr(x - 0.06, 1.14, 0.12, 0.2, 0.04);
    p.poly([x - 0.085, 1.14, x + 0.085, 1.14, x + 0.05, 1.3, x - 0.05, 1.3]);
    p.ell(x, 1.38, 0.04, 0.045);
    p.poly([x - 0.04, 1.42, x - 0.025, 1.47, x, 1.44, x + 0.025, 1.47, x + 0.04, 1.42]);
    for (const d of [-0.22, 0.24]) p.rect(x + d - 0.012, 1.14, 0.024, 0.14);
    p.rr(x - 0.36, 1.14, 0.06, 0.12, 0.02);
    p.rr(x + 0.06, 1.55, 0.3, 0.4, 0.02);
    p.rr(x - 0.36, 1.5, 0.3, 0.46, 0.02);
  },
  /** Manila: laundry on a line across the room: shirts and a towel hung by their shoulders. */
  laundry: (p: Pen, x: number, y = 1.9) => {
    p.line(x - 1.3, y, x + 1.3, y - 0.06, 0.012);
    for (const [d, w, h] of [[-1.0, 0.34, 0.5], [-0.45, 0.4, 0.56], [0.1, 0.3, 0.42], [0.55, 0.36, 0.5], [1.0, 0.32, 0.46]] as const) {
      const yy = y - 0.03 * (d / 1.3 + 1);
      p.poly([x + d - w / 2, yy - 0.05, x + d + w / 2, yy - 0.05, x + d + w * 0.62, yy - 0.2, x + d + w / 2, yy - 0.2, x + d + w * 0.34, yy - h, x + d - w * 0.34, yy - h, x + d - w / 2, yy - 0.2, x + d - w * 0.62, yy - 0.2]);
    }
  },
  /** Manila: a woven sleeping mat (a banig) on the floor, with a pillow. */
  mat: (p: Pen, x: number, w = 1.9) => {
    p.rr(x - w / 2, 0, w, 0.05, 0.02);
    p.rr(x - w / 2 + 0.05, 0.04, 0.4, 0.1, 0.05);
  },
  /** Manila: a mosquito net hung over the mat: a ring above, cords down to the corners and the sides. */
  net: (p: Pen, x: number, w = 1.9) => {
    p.line(x - 0.12, 2.2, x + 0.12, 2.2, 0.03);
    for (const [dx, y] of [[-w / 2, 0.02], [w / 2, 0.02], [-w / 2, 0.9], [w / 2, 0.9]] as const) p.line(x + dx * 0.1, 2.2, x + dx, y, 0.01);
    p.line(x - w / 2, 0.02, x - w / 2, 0.9, 0.008);
    p.line(x + w / 2, 0.02, x + w / 2, 0.9, 0.008);
    p.line(x - w / 2, 0.9, x + w / 2, 0.9, 0.008);
  },
} as const;
export type ItemName = keyof typeof ITEMS;
/** What an item may end with: how far back than its layer it stands. */
export interface ItemOpts {
  readonly depth?: number;
}
export type Item = readonly [kind: ItemName, x: number, ...rest: (number | ItemOpts)[]];
/** An item's parts: its own numbers, and what its options say. */
export function itemParts(it: Item): { kind: ItemName; x: number; args: number[]; depth: number } {
  const last = it[it.length - 1];
  const opts = typeof last === 'object' && last !== null ? last : undefined;
  return { kind: it[0], x: it[1], args: (opts ? it.slice(2, -1) : it.slice(2)) as number[], depth: opts?.depth ?? 0 };
}
/** An item from its parts (no options where it stands in its layer). */
export const itemOf = (kind: ItemName, x: number, args: readonly number[], depth = 0): Item => (depth > 0 ? [kind, x, ...args, { depth }] : [kind, x, ...args]);

/** What a hand holds: drawn from the hand (the origin), +x along the forearm. */
export const PROPS = {
  gun: (p: Pen) => {
    p.rect(-0.02, -0.02, 0.21, 0.05);
    p.poly([-0.03, 0.02, 0.035, 0.02, 0.015, -0.12, -0.05, -0.11]);
  },
  bottle: (p: Pen) => {
    p.rr(-0.035, -0.07, 0.07, 0.19, 0.015);
    p.rect(-0.014, 0.11, 0.028, 0.09);
  },
  glass: (p: Pen) => p.poly([-0.035, 0.07, 0.035, 0.07, 0.027, -0.03, -0.027, -0.03]),
  cig: (p: Pen) => p.rect(0.02, -0.008, 0.09, 0.016),
  bat: (p: Pen) => p.line(-0.06, 0, 0.72, 0, 0.055),
  cue: (p: Pen) => p.line(-0.45, 0, 0.95, 0, 0.025),
  mop: (p: Pen) => {
    p.line(-0.25, 0, 1.15, 0, 0.03);
    p.rr(1.1, -0.17, 0.09, 0.34, 0.03);
  },
  wad: (p: Pen) => p.rr(-0.05, -0.035, 0.15, 0.07, 0.015),
  envelope: (p: Pen) => p.rr(-0.02, -0.02, 0.22, 0.04, 0.01),
  cards: (p: Pen) => p.poly([0, 0, 0.14, 0.03, 0.12, 0.12, 0.04, 0.15, -0.03, 0.12]),
  mic: (p: Pen) => {
    p.line(0, 0, 0.1, 0, 0.03);
    p.ell(0.13, 0, 0.04, 0.04);
  },
  files: (p: Pen) => p.rr(-0.06, -0.15, 0.1, 0.32, 0.01),
  paper: (p: Pen) => p.poly([0, -0.02, 0.3, -0.06, 0.3, 0.17, 0, 0.21]),
  case: (p: Pen) => {
    p.rr(-0.2, -0.36, 0.42, 0.3, 0.03);
    p.rr(-0.06, -0.08, 0.12, 0.06, 0.02);
  },
  bag: (p: Pen) => p.rr(-0.2, -0.42, 0.42, 0.36, 0.1),
  /** A top coming off over the head: the cloth bunched between the raised hands. */
  top: (p: Pen) => {
    p.ell(0.0, -0.1, 0.19, 0.14);
    p.poly([-0.18, -0.12, 0.18, -0.12, 0.13, -0.3, -0.12, -0.32]);
  },
  shaker: (p: Pen) => p.rr(-0.04, -0.06, 0.08, 0.2, 0.03),
  ladle: (p: Pen) => p.line(0, 0, 0.26, 0, 0.022),
  binoculars: (p: Pen) => p.rr(-0.02, -0.04, 0.16, 0.09, 0.03),
  torch: (p: Pen) => p.rect(0, -0.02, 0.16, 0.045),
  tile: (p: Pen) => p.rect(0.0, -0.03, 0.055, 0.075),
  /**
   * A man's cock. The hand in `hold` only names it: windowAtlas draws this at the pelvis, along the body's front
   * (up when he is on his back, forward in profile). Adult scenes only.
   */
  cock: (p: Pen) => {
    p.ell(0.02, -0.06, 0.078, 0.055);
    p.rr(0.04, -0.032, 0.24, 0.064, 0.028);
    p.ell(0.29, -0.004, 0.055, 0.052);
  },
} as const;
export type PropName = keyof typeof PROPS;

// ---- the scenes ----

/** The kinds of room, in the atlas's order (and the shader's: city.ts picks one by the building and the room). */
export const CATS = ['home', 'home_tv', 'office', 'hotel', 'den', 'v_home', 'v_office', 'v_hotel', 'v_love', 'v_den'] as const;
export type Cat = (typeof CATS)[number];
/**
 * The shady rooms at street level (GROUND-FLOOR ROOMS in the header), in their rooms' order in the shop atlas
 * (shopAtlas.ts: after the trades' own).
 */
export const SHOP_KINDS = ['g_cabaret', 'g_hostess', 'g_host', 'g_cards', 'g_loan', 'g_lobby', 'g_slumped', 'g_exchange'] as const;
export type ShopKind = (typeof SHOP_KINDS)[number];
export const isShopKind = (c: unknown): c is ShopKind => (SHOP_KINDS as readonly unknown[]).includes(c);
export const isVice = (c: string): boolean => c.startsWith('v_') || c.startsWith('g_');
/**
 * Which trades (shops.ts) can be which shady rooms instead of their own, where the zone has vice enough, and the
 * share of such shops that are.
 */
export const SHADY_TRADES: readonly (readonly [trade: number, share: number, kinds: readonly ShopKind[]])[] = [
  [TRADE.bar, 0.55, ['g_slumped', 'g_cabaret', 'g_slumped']],
  [TRADE.snack, 0.7, ['g_hostess', 'g_slumped', 'g_cabaret']],
  [TRADE.lounge, 0.8, ['g_cabaret', 'g_hostess', 'g_host']],
  [TRADE.izakaya, 0.3, ['g_slumped', 'g_cards', 'g_slumped']],
  [TRADE.mahjong, 0.7, ['g_cards']],
  [TRADE.estate, 0.6, ['g_loan']],
  [TRADE.lovehotel, 0.8, ['g_lobby']],
  [TRADE.pachinko, 0.5, ['g_exchange']],
];

/** One pose of a scene's people (and the things that go with them). */
export interface SceneFrame {
  readonly a: readonly Fig[];
  readonly aItems?: readonly Item[];
}

export interface Scene {
  readonly id: string;
  /** What it is, for the contact sheet. */
  readonly label: string;
  readonly cat: Cat | ShopKind | readonly (Cat | ShopKind)[];
  /** How many chances it gets among its kind's scenes (1 to 4; default 1). */
  readonly weight?: number;
  /** Sexual or nude: left out of the demo edition. */
  readonly adult?: boolean;
  readonly back?: readonly Item[];
  readonly front?: readonly Item[];
  /** The people (and the things that move with them). */
  readonly a: readonly Fig[];
  readonly aItems?: readonly Item[];
  /** The second pose, and how it plays: the cycle's length in seconds, the share of it spent in the first pose, and (optionally) the seconds a move between poses takes. */
  readonly b?: readonly Fig[];
  readonly bItems?: readonly Item[];
  readonly anim?: readonly [period: number, hold: number, go?: number];
  /** Metres further from the window than a room's people stand by themselves (window scenes). */
  readonly setBack?: number;
  /** More poses after `b` (played there and back), and how many in-betweens to make between each pose and the next. */
  readonly frames?: readonly SceneFrame[];
  readonly tween?: number;
  /** People at the back of the room (a still scene). */
  readonly deep?: readonly Fig[];
  /** The people walk to and fro at this speed (m/s). */
  readonly slide?: number;
  /** Only seen through glass to the floor. */
  readonly low?: boolean;
  /** The `back` furniture stands close behind the people (a sofa they're on), not against the far wall. */
  readonly near?: boolean;
  /**
   * A vice scene's hours (WHEN; nightAt): `evening` from early on through the night (drinking, gambling, the clubs),
   * `late` the small hours' (deals, beatings, the loan sharks, money counted: the default), `lovers` late evening
   * into the night.
   */
  readonly when?: When;
}
export const WHEN = ['evening', 'late', 'lovers'] as const;
export type When = (typeof WHEN)[number];
export const whenOf = (s: Scene): When => s.when ?? 'late';
export const catsOf = (s: Scene): readonly (Cat | ShopKind)[] => (typeof s.cat === 'string' ? [s.cat] : s.cat);
/** Whether a scene goes behind the upper floors' windows (it takes a cell of their atlas). */
export const isWindowScene = (s: Scene): boolean => catsOf(s).some((c) => (CATS as readonly string[]).includes(c));

// (Tempos: a quick to and fro, an easy one, and a moment now and then.)
const QUICK = [2.8, 0.5] as const;
const EASY = [3.6, 0.5] as const;
const NOW_AND_THEN = [4.5, 0.82] as const;

export const SCENES: readonly Scene[] = [
  // ---- homes ----
  {
    id: 'home_window', label: 'at the window, the room behind', cat: 'home',
    back: [['shelf', -1.2, 1, 1.8], ['picture', 0.9, 1.5]], front: [['armchair', 1.2, -1], ['lamp', 1.85]],
    a: [fig('man', -0.2, { aR: [8, 0, 20] })],
  },
  {
    id: 'home_cooking', label: 'cooking: stirring a pot', cat: 'home',
    back: [['kitchen', 0, 2.4], ['fridge', 1.65]],
    a: [fig('mom', 0.1, { yaw: B, aR: [48, 0, 66], aL: [20, 0, 50] }, { hold: [['R', 'ladle', -70]] })],
    b: [fig('mom', 0.1, { yaw: B, aR: [42, 14, 78], aL: [20, 0, 50] }, { hold: [['R', 'ladle', -95]] })], anim: QUICK,
  },
  {
    id: 'home_dinner', label: 'dinner: a family at the table', cat: 'home',
    back: [['shelf', 1.5, 0.8, 1.6]], front: [['table', 0, 1.3], ['pendant', 0, 1.8], ['chair', -0.85, 1], ['chair', 0.85, -1]],
    a: [fig('man', -0.82, { yaw: R, ...SIT, aR: [22, 0, 84], aL: [30, 0, 70] }, { seat: 0.45, hold: [['R', 'glass', 90]] }), fig('mom', 0.82, { yaw: L, ...SIT, aL: [30, 0, 76], aR: [30, 0, 70] }, { seat: 0.45 }), fig('boy', 0.05, { ...SIT, aL: [30, 0, 70], aR: [30, 0, 70] }, { seat: 0.5 })],
    b: [fig('man', -0.82, { yaw: R, ...SIT, aR: [50, 0, 130], aL: [30, 0, 70], nod: -8 }, { seat: 0.45, hold: [['R', 'glass', 100]] }), fig('mom', 0.82, { yaw: L, ...SIT, aL: [30, 0, 76], aR: [30, 0, 70] }, { seat: 0.45 }), fig('boy', 0.05, { ...SIT, aL: [30, 0, 70], aR: [30, 0, 70] }, { seat: 0.5 })], anim: NOW_AND_THEN,
    aItems: [['bottle', -0.3], ['glass', 0.4]], bItems: [['bottle', -0.3], ['glass', 0.4]],
  },
  {
    id: 'home_homework', label: 'homework: a parent looking over a shoulder', cat: 'home',
    back: [['shelf', -1.4, 0.9, 1.7], ['picture', 0.2, 1.6]], front: [['desk', 0.5, 1.2], ['dlamp', 0.95, 0.735, -1], ['chair', -0.05, 1]],
    a: [fig('girl', -0.02, { yaw: R, ...SIT, aR: [40, 0, 70], aL: [36, 0, 74], lean: 14, nod: 14 }, { seat: 0.5 }), fig('woman2', -0.62, { yaw: R, lean: 20, nod: 12, aR: [30, 0, 40] })],
  },
  {
    id: 'home_phone', tween: 1, label: 'pacing on the phone', cat: 'home',
    back: [['shelf', -1.3, 1, 1.5], ['picture', 0.8, 1.55, 0.6, 0.45]], front: [['armchair', -1.3, 1], ['roundtable', 1.3, 0.6, 0.55]],
    a: [fig('woman', 0, { yaw: R, ...STEP_A, aR: [42, 0, 142, 10] })], b: [fig('woman', 0, { yaw: R, ...STEP_B, aR: [42, 0, 142, 10] })], anim: [1.1, 0.5], slide: 0.7,
  },
  {
    id: 'home_tea', label: 'two old people over tea', cat: 'home',
    back: [['wardrobe', -1.3], ['picture', 0.9, 1.5, 0.4, 0.5]], front: [['table', 0, 1.0], ['chair', -0.72, 1], ['chair', 0.72, -1]],
    a: [fig('elder', -0.7, { yaw: R, ...SIT, aR: [26, 0, 82], aL: [24, 0, 60], lean: 8 }, { seat: 0.45, hold: [['R', 'glass', 90]] }), fig('elder2', 0.7, { yaw: L, ...SIT, aL: [26, 0, 80], aR: [24, 0, 64], lean: 10 }, { seat: 0.45 })],
    aItems: [['ashtray', 0.1]],
  },
  {
    id: 'home_reading', label: 'reading the paper under a lamp', cat: 'home',
    back: [['shelf', 1.2, 1.2, 1.9]], front: [['armchair', -0.3, 1], ['lamp', -1.05, 1.7], ['roundtable', 0.75, 0.5, 0.5]],
    a: [fig('elder', -0.32, { yaw: R, ...SIT, lL: [80, 0, 80], lean: -12, aL: [42, 0, 96], aR: [40, 0, 100] }, { seat: 0.42, hold: [['R', 'paper', 80]] })],
  },
  {
    id: 'home_taiso', label: 'morning exercises', cat: 'home',
    back: [['tv', -1.2], ['picture', 1.0, 1.5]], front: [['plant', 1.7, 1.2]],
    a: [fig('elder2', 0, { aL: [165, 20, 5], aR: [165, 20, 5] })], b: [fig('elder2', 0, { aL: [90, 90, 5], aR: [90, 90, 5], lL: [0, 12, 0], lR: [0, 12, 0] })], anim: [3.6, 0.5],
  },
  {
    id: 'home_child', near: true, label: 'a child jumping about, a parent watching', cat: 'home',
    back: [['sofa', 1.0, 1.6], ['shelf', -1.5, 0.8, 1.2], ['picture', -0.3, 1.6]],
    a: [fig('boy', -0.6, { aL: [150, 40, 10], aR: [150, 40, 10], lL: [10, 14, 20], lR: [10, 14, 20] }, { floor: 0.14 }), fig('man2', 0.9, { yaw: -30, ...SIT, aL: [20, 0, 50], aR: [24, 0, 60] }, { seat: 0.42 })],
    b: [fig('boy', -0.6, { aL: [30, 40, 20], aR: [30, 40, 20], lL: [24, 8, 50], lR: [24, 8, 50] }), fig('man2', 0.9, { yaw: -30, ...SIT, aL: [20, 0, 50], aR: [24, 0, 60] }, { seat: 0.42 })], anim: QUICK,
  },
  {
    id: 'home_cleaning', tween: 1, label: 'sweeping the floor', cat: 'home',
    back: [['wardrobe', 1.3], ['picture', -0.9, 1.5]], front: [['table', -1.3, 0.8]],
    a: [fig('mom', 0, { yaw: R, ...STEP_A, lean: 16, aL: [40, 0, 30], aR: [30, 0, 46] }, { hold: [['R', 'mop', -52]] })], b: [fig('mom', 0, { yaw: R, ...STEP_B, lean: 18, aL: [46, 0, 26], aR: [36, 0, 40] }, { hold: [['R', 'mop', -46]] })], anim: [1.4, 0.5], slide: 0.3,
  },
  {
    id: 'home_couple', label: 'a couple at the window', cat: 'home',
    back: [['shelf', 1.4, 0.9, 1.8], ['door', -1.3]], front: [['plant', -1.8, 1.4]],
    a: [fig('man', -0.24, { yaw: 20 }), fig('dress', 0.2, { yaw: -25, tilt: -8 })],
  },
  {
    id: 'home_kotatsu', label: 'round the kotatsu', cat: 'home', low: true,
    back: [['tv', 1.3], ['wardrobe', -1.3]], front: [['kotatsu', 0]],
    a: [fig('man2', -0.75, { yaw: R, ...FLOOR_SIT, lean: 10, aR: [30, 0, 70] }, { seat: 0.02 }), fig('woman2', 0.75, { yaw: L, ...FLOOR_SIT, lean: 8, aL: [30, 0, 70] }, { seat: 0.02 }), fig('girl', 0, { ...FLOOR_SIT }, { seat: 0.02 })],
    aItems: [['bottle', -0.2, 0.38], ['glass', 0.25, 0.38]],
  },
  {
    id: 'home_futon', label: 'someone asleep, someone sitting up', cat: 'home', low: true,
    back: [['wardrobe', 1.3], ['picture', -0.8, 1.5]], front: [['futon', -0.2, 2.0]],
    a: [fig('woman2', 0.1, { yaw: R, pitch: -90, aL: [10, 0, 10], aR: [10, 0, 10] }, { floor: 0.1 }), fig('man', -0.7, { yaw: R, ...FLOOR_SIT, lean: 20, nod: 20 }, { seat: 0.1 })],
  },
  // ---- homes with the television on ----
  {
    id: 'tv_alone', label: 'a beer in front of the television', cat: 'home_tv',
    back: [['shelf', 1.5, 0.8, 1.7]], front: [['armchair', 0.5, -1], ['tv', -1.25], ['roundtable', -0.3, 0.5, 0.45]],
    a: [fig('man2', 0.48, { yaw: L, ...SIT, lean: -14, aL: [24, 0, 80], aR: [10, 0, 30] }, { seat: 0.42, hold: [['L', 'glass', 90]] })],
    b: [fig('man2', 0.48, { yaw: L, ...SIT, lean: -14, nod: -10, aL: [50, 0, 132], aR: [10, 0, 30] }, { seat: 0.42, hold: [['L', 'glass', 80]] })], anim: NOW_AND_THEN,
    aItems: [['bottle', -0.3, 0.455]], bItems: [['bottle', -0.3, 0.455]],
  },
  {
    id: 'tv_couple', near: true, label: 'a couple on the sofa, the television on', cat: 'home_tv',
    back: [['sofa', 0.55, 1.7], ['picture', 0.6, 1.6, 0.7, 0.45]], front: [['tv', -1.35], ['lamp', 1.75, 1.6]],
    a: [fig('man', 0.25, { yaw: -40, ...SIT, lean: -10, aR: [80, 80, 30] }, { seat: 0.42 }), fig('woman2', 0.72, { yaw: -40, ...SIT, lean: -8, bend: 12, tilt: 14 }, { seat: 0.42 })],
  },
  {
    id: 'tv_family', near: true, label: 'a parent and child watching', cat: 'home_tv',
    back: [['sofa', 0.5, 1.6], ['shelf', 1.6, 0.7, 1.3]], front: [['tv', -1.35]],
    a: [fig('mom', 0.2, { yaw: -40, ...SIT, lean: -8 }, { seat: 0.42 }), fig('boy', 0.75, { yaw: -40, ...SIT, lean: 10, aL: [30, 0, 60], aR: [30, 0, 60] }, { seat: 0.46 })],
  },
  {
    id: 'tv_floor', label: 'lying on the floor in front of the television', cat: 'home_tv', low: true,
    back: [['shelf', 1.5, 0.8, 1.6]], front: [['tv', -1.35], ['sofa', 1.0, 1.6]],
    a: [fig('man2', 0.1, { yaw: L, pitch: 90, lean: -28, nod: -30, aL: [150, 0, 100], aR: [150, 0, 100], lL: [0, 0, 60] })],
    b: [fig('man2', 0.1, { yaw: L, pitch: 90, lean: -28, nod: -30, aL: [150, 0, 100], aR: [150, 0, 100], lR: [0, 0, 70] })], anim: EASY,
  },
  // ---- offices ----
  {
    id: 'office_desks', label: 'two at their desks, typing', cat: 'office',
    back: [['cabinets', -1.4, 2], ['board', 0.9, 1.4]], front: [['desk', -0.75, 1.3], ['desk', 0.95, 1.3], ['monitor', -0.45], ['monitor', 1.25], ['chair', -1.15, 1], ['chair', 0.5, 1]],
    a: [fig('suit', -1.12, { yaw: R, ...TYPING }, { seat: 0.45 }), fig('clerk', 0.53, { yaw: R, ...TYPING }, { seat: 0.45 })],
    b: [fig('suit', -1.12, { yaw: R, ...TYPING, aR: [40, 0, 68], nod: 6 }, { seat: 0.45 }), fig('clerk', 0.53, { yaw: R, ...TYPING, aL: [41, 0, 66] }, { seat: 0.45 })], anim: [4.2, 0.6],
  },
  {
    id: 'office_meeting', label: 'a meeting: one at the board', cat: 'office',
    back: [['board', -0.6, 1.8], ['cabinets', 1.6, 1]], front: [['table', 0.5, 2.2, 0.72], ['chair', -0.2, 1], ['chair', 1.2, -1]],
    a: [fig('wsuit', -1.25, { yaw: 50, aL: [95, 60, 10] }), fig('suit', -0.18, { yaw: 150, ...SIT, lean: 6 }, { seat: 0.45 }), fig('suit2', 0.55, { yaw: 160, ...SIT, lean: -8, ...CROSSED }, { seat: 0.45 }), fig('clerk2', 1.22, { yaw: -150, ...SIT, lean: 10, aL: [34, 0, 70] }, { seat: 0.45 })],
    b: [fig('wsuit', -1.25, { yaw: 50, aL: [120, 70, 20] }), fig('suit', -0.18, { yaw: 150, ...SIT, lean: 6 }, { seat: 0.45 }), fig('suit2', 0.55, { yaw: 160, ...SIT, lean: -8, ...CROSSED }, { seat: 0.45 }), fig('clerk2', 1.22, { yaw: -150, ...SIT, lean: 14, nod: 10, aL: [34, 0, 70] }, { seat: 0.45 })], anim: EASY,
  },
  {
    id: 'office_files', tween: 1, label: 'carrying files through', cat: 'office',
    back: [['cabinets', -1.2, 3], ['copier', 1.4]], front: [['desk', -1.1, 1.3], ['monitor', -0.9], ['desk', 1.2, 1.3], ['dlamp', 1.5]],
    a: [fig('clerk2', 0, { yaw: R, ...STEP_A, aL: [36, 0, 80], aR: [36, 0, 80] }, { hold: [['R', 'files', 80]] })], b: [fig('clerk2', 0, { yaw: R, ...STEP_B, aL: [36, 0, 80], aR: [36, 0, 80] }, { hold: [['R', 'files', 80]] })], anim: [1.0, 0.5], slide: 1.0,
  },
  {
    id: 'office_boss', label: 'the chief at the glass, his secretary behind', cat: 'office',
    back: [['shelf', 1.3, 1.2, 1.9], ['picture', -1.2, 1.6, 0.8, 0.5]], front: [['bigdesk', -0.9, 1.6], ['plant', 1.85, 1.5]],
    a: [fig('boss', 0.5, { aL: [-22, 0, 30, 60], aR: [-22, 0, 30, 60], lean: -3 })],
    deep: [fig('clerk', -0.9, { ...SIT, aL: [34, 0, 70], aR: [34, 0, 74] }, { seat: 0.45 })],
  },
  {
    id: 'office_phone', tween: 1, label: 'pacing on a call', cat: 'office',
    back: [['cabinets', 1.3, 2], ['board', -0.8, 1.5]], front: [['desk', -1.2, 1.3], ['monitor', -1.0], ['chair', -1.5, 1]],
    a: [fig('suit', 0, { yaw: R, ...STEP_A, aR: [42, 0, 142, 10], aL: [-8, 0, 30] })], b: [fig('suit', 0, { yaw: R, ...STEP_B, aR: [42, 0, 142, 10], aL: [10, 0, 60] })], anim: [1.2, 0.5], slide: 0.6,
  },
  {
    id: 'office_overtime', label: 'working late, alone', cat: 'office',
    back: [['cabinets', 1.2, 3]], front: [['desk', -0.2, 1.5], ['dlamp', 0.35], ['papers', -0.1, 0.735, 5], ['chair', -0.75, 1]],
    a: [fig('suit', -0.72, { yaw: R, ...SIT, lean: 30, nod: 24, aL: [70, 0, 130], aR: [68, 0, 128] }, { seat: 0.45 })],
    b: [fig('suit', -0.72, { yaw: R, ...SIT, lean: -12, nod: -22, aL: [150, 0, 80], aR: [148, 0, 84] }, { seat: 0.45 })], anim: [9, 0.78],
  },
  {
    id: 'office_scolding', tween: 2, label: 'a dressing down: bowing to the chief', cat: 'office',
    back: [['shelf', 1.5, 0.9, 1.9], ['picture', 0, 1.7, 0.8, 0.4]], front: [['bigdesk', 0.95, 1.5], ['plant', -1.8, 1.4]],
    a: [fig('suit', -0.55, { yaw: R, lean: 14, nod: 20, aL: [4, 0, 6], aR: [4, 0, 6] }), fig('boss', 1.0, { yaw: L, ...SIT, lean: 12, aL: [70, 0, 30] }, { seat: 0.5 })],
    b: [fig('suit', -0.55, { yaw: R, lean: 56, nod: 16, aL: [10, 0, 6], aR: [10, 0, 6] }), fig('boss', 1.0, { yaw: L, ...SIT, lean: 4, aL: [52, 0, 80] }, { seat: 0.5 })], anim: [3.2, 0.45],
  },
  {
    id: 'office_plans', label: 'two over the plans', cat: 'office',
    back: [['board', 0.9, 1.5], ['cabinets', -1.4, 2]], front: [['table', 0, 1.6, 0.9], ['papers', 0.2, 0.905, 2]],
    a: [fig('suit2', -0.72, { yaw: R, lean: 30, nod: 14, aR: [64, 0, 24], aL: [40, 0, 40] }), fig('wsuit', 0.72, { yaw: L, lean: 22, nod: 14, aL: [50, 0, 50] })],
  },
  {
    id: 'office_cleaner', tween: 1, label: 'the night cleaner', cat: 'office',
    back: [['cabinets', -1.3, 3]], front: [['desk', 1.2, 1.4], ['monitor', 1.0], ['chair', 0.7, 1]],
    a: [fig('worker', 0, { yaw: R, ...STEP_A, lean: 18, aL: [44, 0, 28], aR: [32, 0, 46] }, { hold: [['R', 'mop', -50]] })], b: [fig('worker', 0, { yaw: R, ...STEP_B, lean: 20, aL: [50, 0, 24], aR: [38, 0, 40] }, { hold: [['R', 'mop', -44]] })], anim: [1.5, 0.5], slide: 0.3,
  },
  {
    id: 'office_stretch', label: 'leaning back from the screen', cat: 'office',
    back: [['cabinets', 1.4, 2], ['picture', -1.0, 1.6]], front: [['desk', 0.3, 1.4], ['monitor', 0.55], ['chair', -0.3, 1], ['plant', -1.7, 1.3]],
    a: [fig('clerk', -0.28, { yaw: R, ...TYPING }, { seat: 0.45 })],
    b: [fig('clerk', -0.28, { yaw: R, ...SIT, lean: -18, nod: -16, aL: [165, 0, 30], aR: [160, 0, 40] }, { seat: 0.45 })], anim: [8, 0.75],
  },
  {
    id: 'office_copier', label: 'at the copier', cat: 'office',
    back: [['copier', -0.9], ['cabinets', 1.0, 3]], front: [['plant', 1.8, 1.4]],
    a: [fig('shirt', -0.9, { yaw: B, aL: [40, 0, 60], aR: [40, 0, 66], nod: 12 })],
    deep: [fig('clerk2', 1.0, { yaw: B, aR: [70, 0, 40] })],
  },
  // ---- hotels ----
  {
    id: 'hotel_guest', label: 'a guest at the window with a drink', cat: 'hotel',
    back: [['bedend', 0, 1.4], ['picture', 0, 1.6, 0.7, 0.45]],
    a: [fig('suit', 0.05, { aR: [26, 30, 96, 30] }, { hold: [['R', 'glass', 90]] })],
  },
  {
    id: 'hotel_unpack', label: 'unpacking a case on the bed', cat: 'hotel',
    back: [['suitcase', -0.3, 0.54], ['bedend', -0.3, 1.3], ['wardrobe', 0.75]],
    a: [fig('man', -0.3, { yaw: B, lean: 26, aL: [50, 0, 40], aR: [46, 0, 46] })],
    b: [fig('man', -0.3, { yaw: B, lean: 12, aL: [40, 0, 80], aR: [70, 30, 50] })], anim: EASY,
  },
  {
    id: 'hotel_bedside', label: 'sitting on the bed, loosening a tie', cat: 'hotel',
    back: [['picture', -0.2, 1.65, 0.6, 0.4]], front: [['bed', -0.1, 1.8, -1], ['nightstand', 0.95]],
    a: [fig('suit2', 0.15, { yaw: R, ...SIT, lean: 24, nod: 20, aL: [50, 0, 60], aR: [48, 0, 64] }, { seat: 0.5 })],
    b: [fig('suit2', 0.15, { yaw: R, ...SIT, lean: 6, aL: [20, 0, 40], aR: [60, 0, 132] }, { seat: 0.5 })], anim: [7, 0.6],
  },
  {
    id: 'hotel_pair', label: 'two guests at the window', cat: 'hotel',
    back: [['bedend', 0, 1.4], ['picture', 0, 1.6, 0.6, 0.4]],
    a: [fig('man', -0.22, { yaw: 15 }), fig('dress', 0.2, { yaw: -20, tilt: -6 })],
  },
  {
    id: 'hotel_call', tween: 1, label: 'a call home, pacing', cat: 'hotel',
    back: [['wardrobe', 0.2]], front: [['nightstand', -0.85]],
    a: [fig('suit', 0, { yaw: R, ...STEP_A, aR: [42, 0, 142, 10], aL: [-6, 0, 20] })], b: [fig('suit', 0, { yaw: R, ...STEP_B, aR: [42, 0, 142, 10], aL: [6, 0, 30] })], anim: [1.2, 0.5], slide: 0.5,
  },
  {
    id: 'hotel_robe', label: 'out of the bath, in the hotel yukata', cat: 'hotel',
    back: [['bedend', 0.1, 1.4], ['picture', 0.3, 1.6]],
    a: [fig('robe', -0.05, { yaw: 30, aR: [24, 20, 90, 20] }, { hold: [['R', 'bottle', 90]] })],
    b: [fig('robe', -0.05, { yaw: 30, nod: -22, aR: [56, 20, 136, 20] }, { hold: [['R', 'bottle', 120]] })], anim: NOW_AND_THEN,
  },
  {
    id: 'hotel_desk', label: 'still working, at the little desk', cat: 'hotel',
    back: [['picture', -0.4, 1.6]], front: [['desk', 0.25, 1.0], ['dlamp', 0.55, 0.735, -1], ['chair', -0.35, 1]],
    a: [fig('wsuit', -0.33, { yaw: R, ...TYPING }, { seat: 0.45 })], b: [fig('wsuit', -0.33, { yaw: R, ...TYPING, aR: [40, 0, 68] }, { seat: 0.45 })], anim: [4.6, 0.6],
  },
  // ---- nightlife (a tenant building's bars) ----
  {
    id: 'den_bar', label: 'a bar: the bartender shaking a drink', cat: 'den',
    back: [['bottles', 0, 3.0]], front: [['counter', 0.2, 3.0], ['stool', -0.9], ['stool', 0.0], ['stool', 0.9]],
    a: [fig('shirt', 0.5, { aL: [70, 30, 120, 40], aR: [60, 30, 120, 40] }, { floor: 0, hold: [['R', 'shaker', 70]] }), fig('suit', -0.9, { yaw: B, ...SIT, lean: 12, aL: [40, 0, 70], aR: [40, 0, 70] }, { seat: 0.75 }), fig('dress', 0.0, { yaw: B, ...SIT, lean: 6, aR: [40, 0, 80] }, { seat: 0.75 })],
    b: [fig('shirt', 0.5, { aL: [96, 30, 110, 40], aR: [88, 30, 112, 40] }, { floor: 0, hold: [['R', 'shaker', 110]] }), fig('suit', -0.9, { yaw: B, ...SIT, lean: 12, aL: [40, 0, 70], aR: [40, 0, 70] }, { seat: 0.75 }), fig('dress', 0.0, { yaw: B, ...SIT, lean: 6, aR: [40, 0, 80] }, { seat: 0.75 })], anim: [3.2, 0.6],
  },
  {
    id: 'den_karaoke', near: true, label: 'karaoke: one singing, two clapping', cat: 'den',
    back: [['sofa', 0.9, 1.7], ['karaoke', -1.3]], front: [['table', 0.9, 1.0, 0.45]],
    a: [fig('suit', -0.4, { yaw: 50, aR: [60, 10, 128], aL: [100, 60, 20], bend: 8 }, { hold: [['R', 'mic', 60]] }), fig('clerk', 0.55, { yaw: -40, ...SIT, aL: [56, 0, 82], aR: [56, 0, 82] }, { seat: 0.42 }), fig('suit2', 1.2, { yaw: -40, ...SIT, aL: [56, 0, 82], aR: [56, 0, 82] }, { seat: 0.42 })],
    b: [fig('suit', -0.4, { yaw: 50, aR: [64, 10, 128], aL: [150, 40, 20], bend: -8 }, { hold: [['R', 'mic', 60]] }), fig('clerk', 0.55, { yaw: -40, ...SIT, aL: [56, 20, 82], aR: [56, 20, 82] }, { seat: 0.42 }), fig('suit2', 1.2, { yaw: -40, ...SIT, aL: [56, 20, 82], aR: [56, 20, 82] }, { seat: 0.42 })], anim: QUICK,
    aItems: [['bottles3', 0.9, 0.455]], bItems: [['bottles3', 0.9, 0.455]],
  },
  {
    id: 'den_snack', label: 'a snack bar: the mama and a regular', cat: 'den',
    back: [['bottles', 0.4, 2.2], ['picture', -1.4, 1.6]], front: [['counter', 0.3, 2.2], ['stool', -0.2], ['stool', 0.6]],
    a: [fig('mama', 0.75, { yaw: -30, aL: [50, 0, 60] }), fig('elder', -0.2, { yaw: B, ...SIT, lean: 16, aR: [44, 0, 76], aL: [40, 0, 70] }, { seat: 0.75 })],
    aItems: [['bottle', 0.2, 1.07], ['glass', -0.05, 1.07]],
  },
  {
    id: 'den_kanpai', label: 'an izakaya table: kanpai', cat: 'den',
    back: [['picture', -1.0, 1.6, 0.9, 0.35], ['picture', 0.9, 1.6, 0.9, 0.35]], front: [['table', 0, 1.5], ['pendant', 0, 1.75], ['chair', -0.95, 1], ['chair', 0.95, -1]],
    a: [fig('suit', -0.92, { yaw: R, ...SIT, aR: [30, 0, 84] }, { seat: 0.45, hold: [['R', 'glass', 90]] }), fig('suit2', 0.92, { yaw: L, ...SIT, aL: [30, 0, 84] }, { seat: 0.45, hold: [['L', 'glass', 90]] }), fig('clerk2', 0, { ...SIT, aL: [30, 30, 100, 40] }, { seat: 0.45 })],
    b: [fig('suit', -0.92, { yaw: R, ...SIT, aR: [86, 0, 30], lean: 12 }, { seat: 0.45, hold: [['R', 'glass', 90]] }), fig('suit2', 0.92, { yaw: L, ...SIT, aL: [86, 0, 30], lean: 12 }, { seat: 0.45, hold: [['L', 'glass', 90]] }), fig('clerk2', 0, { ...SIT, aL: [130, 40, 40] }, { seat: 0.45 })], anim: NOW_AND_THEN,
    aItems: [['bottles3', -0.1]], bItems: [['bottles3', -0.1]],
  },
  {
    id: 'den_pool', label: 'a pool hall: lining up a shot', cat: 'den',
    back: [['bottles', 1.2, 1.4], ['picture', -1.0, 1.7, 0.9, 0.3]], front: [['pool', 0.3], ['pendant', 0.3, 1.6]],
    a: [fig('man2', -1.05, { yaw: R, lean: 58, nod: -30, aL: [96, 0, 4], aR: [10, 0, 96], lL: [20, 0, 10], lR: [-24, 0, 14] }, { hold: [['L', 'cue', 2]] }), fig('chinpira', 1.7, { yaw: -30, aR: [20, 0, 40] }, { hold: [['R', 'cue', 86]] })],
    b: [fig('man2', -1.05, { yaw: R, lean: 58, nod: -30, aL: [96, 0, 4], aR: [34, 0, 80], lL: [20, 0, 10], lR: [-24, 0, 14] }, { hold: [['L', 'cue', 2]] }), fig('chinpira', 1.7, { yaw: -30, aR: [20, 0, 40] }, { hold: [['R', 'cue', 86]] })], anim: [2.2, 0.8],
  },
  {
    id: 'den_last_order', label: 'one too many: asleep on the counter', cat: 'den',
    back: [['bottles', 0, 3.0]], front: [['counter', 0, 3.0], ['stool', -0.4], ['stool', 0.5]],
    a: [fig('drunk', -0.4, { yaw: B, ...SIT, lean: 62, nod: 30, aL: [100, 30, 60], aR: [100, 30, 60] }, { seat: 0.75 }), fig('shirt', 0.9, { aR: [50, 0, 90], yaw: -20 })],
    aItems: [['bottles3', 0.1, 1.07]],
  },
  // ---- vice at home ----
  {
    when: 'evening', id: 'v_home_drink', label: 'drinking alone, the bottle on the table', cat: 'v_home',
    back: [['shelf', -1.4, 0.9, 1.6]], front: [['table', 0.2, 1.1], ['chair', -0.5, 1], ['pendant', 0.2, 1.8]],
    a: [fig('drunk', -0.48, { yaw: R, ...SIT, lean: 22, nod: 22, aR: [26, 0, 80], aL: [30, 0, 70] }, { seat: 0.45, hold: [['R', 'glass', 90]] })],
    b: [fig('drunk', -0.48, { yaw: R, ...SIT, lean: -6, nod: -26, aR: [52, 0, 134], aL: [30, 0, 70] }, { seat: 0.45, hold: [['R', 'glass', 130]] })], anim: [6, 0.74],
    aItems: [['bottles3', 0.35]], bItems: [['bottles3', 0.35]],
  },
  {
    when: 'evening', id: 'v_home_argue', label: 'a quarrel: arms and voices', cat: 'v_home',
    back: [['wardrobe', -1.4], ['picture', 1.2, 1.5]], front: [['table', 1.4, 0.8], ['lamp', -1.9, 1.6]],
    a: [fig('man', -0.5, { yaw: R, lean: 12, aR: [88, 0, 20], aL: [40, 0, 80] }), fig('woman2', 0.5, { yaw: L, lean: 8, aL: [110, 30, 60], aR: [110, 30, 60] })],
    b: [fig('man', -0.5, { yaw: R, lean: 4, aR: [130, 20, 40], aL: [120, 20, 50] }), fig('woman2', 0.5, { yaw: L, lean: 14, aL: [80, 0, 14], aR: [30, 0, 60] })], anim: [3.2, 0.5],
  },
  {
    id: 'v_home_embrace', label: 'lovers: an embrace at the window', cat: 'v_home', adult: true, when: 'lovers',
    back: [['shelf', 1.4, 0.9, 1.7], ['door', -1.3]],
    a: [fig('man', -0.17, { yaw: R, lean: 6, nod: 10, aL: [70, 0, 40], aR: [56, 0, 50] }), fig('dress', 0.17, { yaw: L, lean: 4, nod: -12, aL: [120, 0, 60], aR: [112, 0, 66] })],
  },
  {
    when: 'evening', id: 'v_home_cards', label: 'gambling: cards and cash on the table', cat: 'v_home',
    back: [['wardrobe', 1.4], ['picture', -1.2, 1.5]], front: [['table', 0, 1.3], ['pendant', 0, 1.6], ['chair', -0.88, 1], ['chair', 0.88, -1]],
    a: [fig('chinpira', -0.86, { yaw: R, ...SIT, lean: 16, aR: [50, 0, 60], aL: [36, 0, 76] }, { seat: 0.45, hold: [['R', 'cards', 60]] }), fig('man2', 0.86, { yaw: L, ...SIT, lean: 14, aL: [40, 0, 90], aR: [30, 0, 70] }, { seat: 0.45, hold: [['L', 'cards', 100]] }), fig('tattoo', 0.05, { ...SIT, lean: 10, ...CROSSED }, { seat: 0.45 })],
    b: [fig('chinpira', -0.86, { yaw: R, ...SIT, lean: 26, aR: [72, 0, 20], aL: [36, 0, 76] }, { seat: 0.45 }), fig('man2', 0.86, { yaw: L, ...SIT, lean: 14, aL: [40, 0, 90], aR: [30, 0, 70] }, { seat: 0.45, hold: [['L', 'cards', 100]] }), fig('tattoo', 0.05, { ...SIT, lean: 10, ...CROSSED }, { seat: 0.45 })], anim: [2.6, 0.7],
    aItems: [['stacks', 0.1, 0.705, 3]], bItems: [['stacks', 0.1, 0.705, 3]],
  },
  {
    id: 'v_home_packing', label: 'packing a bag in a hurry', cat: 'v_home',
    back: [['wardrobe', -0.9], ['door', 1.2]], front: [['table', 0.3, 1.0], ['bag', 0.3, 0.705]],
    a: [fig('hood', -0.42, { yaw: R, lean: 30, nod: 14, aR: [56, 0, 30], aL: [44, 0, 50] })],
    b: [fig('hood', -0.42, { yaw: R, lean: 16, turn: -70, aR: [74, 0, 16], aL: [30, 0, 70] }, { hold: [['L', 'wad', 0]] })], anim: [3, 0.55],
  },
  {
    id: 'v_home_watcher', label: 'a stakeout: watching the street through glasses', cat: 'v_home',
    back: [['door', 1.2]], front: [['chair', 0.9, -1], ['table', 1.5, 0.7]],
    a: [fig('suit2', -0.3, { yaw: 35, lean: 8, aL: [70, 20, 140, 30], aR: [70, 20, 140, 30] }, { hold: [['R', 'binoculars', 150]] })],
    aItems: [['bottle', 1.5], ['ashtray', 1.3]],
  },
  {
    id: 'v_home_collector', tween: 2, label: 'a collector at the door: a man shoved to the wall, struck', cat: 'v_home',
    back: [['door', -1.3], ['shelf', 1.5, 0.8, 1.5]],
    a: [fig('yakuza', -0.3, { yaw: R, lean: 10, aL: [78, 0, 20], aR: [-34, 0, 112] }), fig('man', 0.32, { yaw: L, lean: -14, nod: -10, aL: [60, 0, 110], aR: [60, 0, 110] })],
    b: [fig('yakuza', -0.26, { yaw: R, lean: 22, twist: -20, aL: [60, 0, 60], aR: [86, 0, 8] }), fig('man', 0.36, { yaw: L, lean: -24, nod: -24, bend: 6, aL: [30, 0, 40], aR: [100, 0, 60] })], anim: [5.5, 0.84, 0.3],
  },
  {
    when: 'evening', id: 'v_home_slumped', label: 'passed out among the empties', cat: 'v_home', low: true,
    back: [['tv', -1.3], ['shelf', 1.4, 0.9, 1.5]], front: [['kotatsu', 0.5]],
    a: [fig('drunk', -0.5, { yaw: R, pitch: -90, aL: [60, 60, 20], aR: [-10, 0, 10], lL: [14, 0, 30] })],
    aItems: [['bottles3', 0.5, 0.38], ['bottle', 0.9, 0.38]],
  },
  // ---- vice at the office ----
  {
    id: 'v_office_bribe', label: 'a bribe: an envelope across the desk', cat: 'v_office',
    back: [['shelf', -1.5, 0.8, 1.9], ['picture', 0.6, 1.7, 0.8, 0.4]], front: [['bigdesk', 0, 1.7], ['chair', -1.15, 1], ['chair', 1.15, -1]],
    a: [fig('suit', -1.12, { yaw: R, ...SIT, lean: 14, aR: [58, 0, 34], aL: [30, 0, 70] }, { seat: 0.45 }), fig('fatcat', 1.12, { yaw: L, ...SIT, lean: -10, ...CROSSED }, { seat: 0.5 })],
    b: [fig('suit', -1.12, { yaw: R, ...SIT, lean: 2, aR: [30, 0, 80], aL: [30, 0, 70] }, { seat: 0.45 }), fig('fatcat', 1.12, { yaw: L, ...SIT, lean: 16, aL: [60, 0, 30], aR: [30, 0, 70] }, { seat: 0.5 })], anim: [5, 0.5],
    aItems: [['envelope', -0.5, 0.78]], bItems: [['envelope', 0.45, 0.78]],
  },
  {
    id: 'v_office_fatcat', label: 'the fat cat, feet up, and a case of money', cat: 'v_office',
    back: [['shelf', 1.5, 0.8, 1.9], ['safe', -1.5]], front: [['bigdesk', 0.3, 1.6], ['chair', 1.45, -1]],
    a: [fig('fatcat', 1.42, { yaw: L, lean: -26, lL: [100, 0, 8], lR: [96, 0, 12], aR: [44, 0, 132], aL: [20, 0, 50] }, { seat: 0.5, hold: [['R', 'cig', 160]] }), fig('suit2', -0.95, { yaw: R, lean: 26, nod: 10, aL: [50, 0, 40], aR: [54, 0, 36] })],
    aItems: [['case', -0.15, 0.78], ['stacks', 0.45, 0.78, 3]],
  },
  {
    id: 'v_office_safe', label: 'emptying the safe into a bag', cat: 'v_office',
    back: [['safe', 0.9], ['cabinets', -1.3, 2]], front: [['bag', 0.1], ['desk', -1.3, 1.2]],
    a: [fig('suit', 0.35, { yaw: R, lean: 44, nod: 10, lL: [70, 0, 100], lR: [20, 0, 80], aR: [70, 0, 20], aL: [60, 0, 30] }, { hold: [['R', 'wad', 0]] })],
    b: [fig('suit', 0.35, { yaw: R, lean: 40, twist: 40, turn: -80, lL: [70, 0, 100], lR: [20, 0, 80], aR: [10, 0, 50], aL: [20, 0, 60] }, { hold: [['R', 'wad', -90]] })], anim: [3, 0.5],
  },
  {
    id: 'v_office_lean', label: 'the loan sharks call at the office: a hand slammed on the desk', cat: 'v_office',
    back: [['cabinets', 1.5, 2], ['board', -0.9, 1.3]], front: [['desk', 0.2, 1.4], ['chair', 0.9, -1], ['papers', 0.3, 0.735, 3]],
    a: [fig('yakuza2', -0.6, { yaw: R, lean: 24, aR: [120, 0, 40], aL: [50, 0, 30] }), fig('shirt', 0.9, { yaw: L, ...SIT, lean: -16, nod: 12, aL: [50, 0, 110], aR: [50, 0, 110] }, { seat: 0.45 }), fig('chinpira', -1.5, { yaw: 40, ...CROSSED })],
    b: [fig('yakuza2', -0.6, { yaw: R, lean: 38, aR: [56, 0, 16], aL: [50, 0, 30] }), fig('shirt', 0.9, { yaw: L, ...SIT, lean: -22, nod: 16, aL: [70, 0, 120], aR: [70, 0, 120] }, { seat: 0.45 }), fig('chinpira', -1.5, { yaw: 40, ...CROSSED })], anim: [2.8, 0.8],
  },
  {
    when: 'evening', id: 'v_office_bottle', label: 'the bottle in the bottom drawer', cat: 'v_office',
    back: [['shelf', -1.4, 1.0, 1.9], ['picture', 0.9, 1.7, 0.7, 0.4]], front: [['bigdesk', 0.2, 1.6], ['dlamp', 0.75, 0.78, -1]],
    a: [fig('boss', -0.1, { ...SIT, lean: 16, nod: 16, aR: [30, 40, 100, 30], aL: [24, 30, 90, 30] }, { seat: 0.5, hold: [['R', 'glass', 90]] })],
    b: [fig('boss', -0.1, { ...SIT, lean: -6, nod: -20, aR: [50, 40, 140, 40], aL: [24, 30, 90, 30] }, { seat: 0.5, hold: [['R', 'glass', 110]] })], anim: [6, 0.72],
    aItems: [['bottle', -0.55, 0.78]], bItems: [['bottle', -0.55, 0.78]],
  },
  {
    id: 'v_office_affair', label: 'lovers: after hours, by the desk', cat: 'v_office', adult: true, when: 'lovers',
    back: [['cabinets', -1.4, 2], ['board', 1.0, 1.3]], front: [['desk', 1.2, 1.3], ['monitor', 1.4]],
    a: [fig('suit', -0.36, { yaw: R, lean: 8, nod: 12, aL: [72, 0, 40], aR: [58, 0, 50] }), fig('clerk', -0.02, { yaw: L, lean: 2, nod: -14, aL: [124, 0, 60], aR: [116, 0, 64] })],
  },
  {
    id: 'v_office_search', label: 'going through the files by torchlight', cat: 'v_office',
    back: [['cabinets', 0.6, 4, 1.4]], front: [['desk', -1.3, 1.2], ['chair', -1.0, 1]],
    a: [fig('hood', 0.4, { yaw: 160, lean: 20, nod: 16, aL: [60, 0, 40], aR: [50, 0, 100] }, { hold: [['R', 'torch', 20]] })],
    b: [fig('hood', 0.4, { yaw: 160, lean: 8, turn: 120, aL: [40, 0, 80], aR: [50, 0, 100] }, { hold: [['L', 'files', 80]] })], anim: [2.2, 0.6],
  },
  {
    id: 'v_office_count', label: 'counting the take', cat: 'v_office',
    back: [['safe', 1.5], ['cabinets', -1.4, 2]], front: [['desk', 0.1, 1.5], ['chair', -0.6, 1]],
    a: [fig('oyabun', -0.58, { yaw: R, ...SIT, lean: 16, nod: 16, aL: [40, 0, 76], aR: [46, 0, 70] }, { seat: 0.45, hold: [['R', 'wad', 10]] }), fig('yakuza', 1.0, { yaw: -40, ...CROSSED })],
    b: [fig('oyabun', -0.58, { yaw: R, ...SIT, lean: 16, nod: 16, aL: [40, 0, 76], aR: [38, 0, 92] }, { seat: 0.45, hold: [['R', 'wad', 40]] }), fig('yakuza', 1.0, { yaw: -40, ...CROSSED })], anim: [3.4, 0.55],
    aItems: [['stacks', 0.25, 0.735, 4]], bItems: [['stacks', 0.25, 0.735, 4]],
  },
  // ---- vice in a hotel room ----
  {
    id: 'v_hotel_embrace', label: 'lovers: an embrace', cat: ['v_hotel', 'v_love'], adult: true, when: 'lovers',
    back: [['bedend', 0, 1.4], ['picture', 0, 1.65, 0.6, 0.4]],
    a: [fig('suit', -0.17, { yaw: R, lean: 6, nod: 10, aL: [72, 0, 40], aR: [58, 0, 50] }), fig('hostess', 0.17, { yaw: L, lean: 4, nod: -12, aL: [122, 0, 60], aR: [114, 0, 66] })],
  },
  {
    id: 'v_hotel_kiss', label: 'lovers: a kiss, one foot off the floor', cat: ['v_hotel', 'v_love'], adult: true, when: 'lovers',
    back: [['picture', 0.2, 1.65]], front: [['nightstand', -0.8]],
    a: [fig('man', -0.14, { yaw: R, lean: 10, nod: 16, aL: [60, 0, 60], aR: [50, 0, 70] }), fig('dress', 0.14, { yaw: L, lean: -6, nod: -20, aL: [130, 0, 70], aR: [124, 0, 74], lR: [-10, 0, 80] })],
  },
  {
    id: 'v_hotel_lead', tween: 1, label: 'lovers: led from the window by the hand', cat: ['v_hotel', 'v_love'], adult: true, when: 'lovers',
    back: [['bedend', 0, 1.4], ['picture', 0, 1.65, 0.6, 0.4]],
    a: [fig('hostess2', 0.3, { yaw: R, ...STEP_A, turn: -120, aL: [-50, 0, 10], aR: [20, 0, 20] }), fig('suit', -0.3, { yaw: R, ...STEP_B, aR: [60, 0, 10], aL: [-10, 0, 20] })],
    b: [fig('hostess2', 0.3, { yaw: R, ...STEP_B, turn: -120, aL: [-50, 0, 10], aR: [-10, 0, 20] }), fig('suit', -0.3, { yaw: R, ...STEP_A, aR: [60, 0, 10], aL: [10, 0, 20] })], anim: [1.4, 0.5], slide: 0.35,
  },
  {
    id: 'v_hotel_undress', tween: 2, label: 'lovers: a top pulled over the head, one waiting on the bed', cat: ['v_hotel', 'v_love'], adult: true, when: 'lovers',
    back: [['picture', -0.3, 1.65]], front: [['bed', 0.35, 1.5, 1]],
    a: [fig('dancer', -0.5, { yaw: 20, aL: [60, 30, 120, 60], aR: [60, 30, 120, 60], lean: 6 }), fig('man', 0.45, { yaw: L, ...SIT, lean: -14, aL: [-30, 0, 10], aR: [-30, 0, 10] }, { seat: 0.5 })],
    b: [fig('dancer', -0.5, { yaw: 20, aL: [168, 14, 50], aR: [168, 14, 50], lean: -4, bend: 6 }, { hold: [['R', 'top', 90]] }), fig('man', 0.45, { yaw: L, ...SIT, lean: -14, aL: [-30, 0, 10], aR: [-30, 0, 10] }, { seat: 0.5 })], anim: [5, 0.5],
  },
  {
    id: 'v_hotel_deal', label: 'a deal: packets and a case of cash', cat: ['v_hotel', 'v_love'],
    back: [['picture', 0, 1.65]], front: [['roundtable', 0, 0.8, 0.7], ['chair', -0.62, 1], ['chair', 0.62, -1]],
    a: [fig('hood', -0.6, { yaw: R, ...SIT, lean: 18, aR: [56, 0, 40], aL: [30, 0, 70] }, { seat: 0.45 }), fig('yakuza', 0.6, { yaw: L, ...SIT, lean: 4, ...CROSSED }, { seat: 0.45 })],
    b: [fig('hood', -0.6, { yaw: R, ...SIT, lean: 6, aR: [30, 0, 80], aL: [30, 0, 70] }, { seat: 0.45 }), fig('yakuza', 0.6, { yaw: L, ...SIT, lean: 20, aL: [58, 0, 36], aR: [30, 0, 70] }, { seat: 0.45, hold: [['L', 'wad', 180]] })], anim: [4.4, 0.5],
    aItems: [['packets', -0.12]], bItems: [['packets', 0.14]],
  },
  {
    id: 'v_hotel_gun', label: 'a gun held on a man with his hands up', cat: 'v_hotel',
    back: [['bedend', 0.45, 1.2], ['picture', 0.3, 1.65]],
    a: [fig('yakuza2', -0.6, { yaw: R, lean: 4, aR: [86, 0, 3], aL: [8, 0, 20] }, { hold: [['R', 'gun']] }), fig('suit2', 0.55, { yaw: L, lean: -6, aL: [150, 30, 50], aR: [150, 30, 50] })],
  },
  {
    when: 'evening', id: 'v_hotel_bottle', label: 'drinking alone on the edge of the bed', cat: ['v_hotel', 'v_love'],
    back: [['picture', 0, 1.65]], front: [['bed', -0.1, 1.7, -1], ['nightstand', 0.95]],
    a: [fig('suit', 0.2, { yaw: R, ...SIT, lean: 30, nod: 24, aR: [40, 0, 50], aL: [40, 0, 50] }, { seat: 0.5, hold: [['R', 'bottle', 90]] })],
    b: [fig('suit', 0.2, { yaw: R, ...SIT, lean: -8, nod: -28, aR: [58, 0, 136], aL: [10, 0, 20] }, { seat: 0.5, hold: [['R', 'bottle', 130]] })], anim: [6, 0.72],
  },
  {
    id: 'v_hotel_take', label: 'counting money on the bed, a gun beside it', cat: ['v_hotel', 'v_love'],
    back: [['picture', -0.3, 1.65]], front: [['bed', 0.15, 1.7, 1]],
    a: [fig('chinpira', -0.3, { yaw: R, ...SIT, lean: 22, nod: 18, aL: [44, 0, 70], aR: [48, 0, 64] }, { seat: 0.5, hold: [['R', 'wad', 10]] })],
    b: [fig('chinpira', -0.3, { yaw: R, ...SIT, lean: 22, nod: 18, aL: [44, 0, 70], aR: [40, 0, 88] }, { seat: 0.5, hold: [['R', 'wad', 40]] })], anim: [3.8, 0.55],
    aItems: [['stacks', 0.4, 0.52, 3]], bItems: [['stacks', 0.4, 0.52, 3]],
  },
  {
    id: 'v_hotel_after', label: 'lovers: she smokes at the window, he puts his jacket on', cat: ['v_hotel', 'v_love'], adult: true, when: 'lovers',
    back: [['bedend', 0.1, 1.4], ['picture', 0, 1.65]],
    a: [fig('hostess', -0.45, { yaw: -20, aR: [40, 30, 140, 30], aL: [30, 0, 100, 80] }, { hold: [['R', 'cig', 150]] })],
    deep: [fig('suit2', 0.5, { yaw: B, aL: [110, 40, 80], aR: [-30, 0, 60] })],
  },
  {
    id: 'v_hotel_bed', label: 'lovers: side by side on the bed, one propped on an elbow', cat: ['v_hotel', 'v_love'], adult: true, when: 'lovers', low: true,
    back: [['picture', 0, 1.65, 0.7, 0.4]], front: [['bed', 0, 2.0, -1], ['nightstand', 1.3]],
    a: [fig('woman2', 0.25, { yaw: R, pitch: -90, aL: [10, 0, 10], aR: [10, 0, 10], lL: [20, 0, 40] }, { floor: 0.5 }), fig('man', -0.2, { yaw: R, pitch: -72, lean: 30, nod: 10, aL: [-30, 0, 100], aR: [40, 0, 120] }, { floor: 0.5, hold: [['R', 'cig', 120]] })],
  },
  {
    id: 'v_hotel_slumped', label: 'someone out cold on the bed, someone going through his bag', cat: 'v_hotel', low: true,
    back: [['picture', 0, 1.65]], front: [['bed', -0.2, 1.9, -1], ['bag', 1.3]],
    a: [fig('drunk', -0.2, { yaw: R, pitch: -90, aL: [80, 80, 10], aR: [-10, 0, 10] }, { floor: 0.5 }), fig('dancer2', 1.25, { yaw: R, lean: 50, nod: 10, lL: [80, 0, 110], lR: [30, 0, 90], aL: [60, 0, 20], aR: [56, 0, 26] })],
  },
  // ---- vice in the tenant buildings ----
  {
    when: 'evening', id: 'v_den_pour', tween: 2, near: true, label: 'a hostess club: pouring his drink', cat: 'v_den',
    back: [['sofa', -0.2, 2.0], ['bottles', 1.4, 1.2], ['picture', -1.0, 1.7, 0.8, 0.35]], front: [['table', -0.2, 1.1, 0.45]],
    a: [fig('suit', -0.65, { yaw: 40, ...SIT, lean: -8, aL: [20, 0, 60], aR: [30, 0, 80] }, { seat: 0.42, hold: [['R', 'glass', 90]] }), fig('hostess', 0.15, { yaw: -50, ...SIT, lean: 16, aL: [50, 0, 60], aR: [40, 0, 70] }, { seat: 0.42, hold: [['L', 'bottle', 90]] })],
    b: [fig('suit', -0.65, { yaw: 40, ...SIT, lean: -8, aL: [20, 0, 60], aR: [44, 0, 70] }, { seat: 0.42, hold: [['R', 'glass', 90]] }), fig('hostess', 0.15, { yaw: -50, ...SIT, lean: 24, aL: [70, 0, 40], aR: [40, 0, 70] }, { seat: 0.42, hold: [['L', 'bottle', 200]] })], anim: [6, 0.55, 0.9],
  },
  {
    when: 'evening', id: 'v_den_close', near: true, label: 'a hostess club: leaning close, a hand on his shoulder', cat: 'v_den',
    back: [['sofa', 0.2, 2.0], ['bottles', -1.4, 1.2]], front: [['table', 0.2, 1.1, 0.45], ['lamp', 1.8, 1.5]],
    a: [fig('fatcat', -0.2, { yaw: 20, ...SIT, lean: -12, aR: [36, 30, 110, 30] }, { seat: 0.42, hold: [['R', 'cig', 150]] }), fig('hostess2', 0.42, { yaw: -70, ...SIT, lean: 10, bend: 0, aL: [50, 0, 50], aR: [20, 0, 60] }, { seat: 0.42 })],
    b: [fig('fatcat', -0.2, { yaw: 20, ...SIT, lean: -12, aR: [36, 30, 110, 30] }, { seat: 0.42, hold: [['R', 'cig', 150]] }), fig('hostess2', 0.32, { yaw: -70, ...SIT, lean: 28, nod: 10, aL: [84, 0, 30], aR: [20, 0, 60] }, { seat: 0.42 })], anim: [5, 0.5],
    aItems: [['bottles3', 0.4, 0.455]], bItems: [['bottles3', 0.4, 0.455]],
  },
  {
    when: 'evening', id: 'v_den_mahjong', label: 'gambling: a mahjong table', cat: 'v_den',
    back: [['picture', 0, 1.75, 1.2, 0.3], ['hanger', 1.7]], front: [['mahjong', 0], ['pendant', 0, 1.6], ['chair', -0.85, 1], ['chair', 0.85, -1]],
    a: [fig('oyabun', -0.84, { yaw: R, ...SIT, lean: 12, aR: [44, 0, 60], aL: [36, 0, 74] }, { seat: 0.45 }), fig('yakuza2', 0.84, { yaw: L, ...SIT, lean: 10, aL: [44, 0, 64], aR: [36, 0, 74] }, { seat: 0.45 }), fig('tattoo', 0, { ...SIT, lean: 8, aL: [30, 30, 100, 40], aR: [30, 30, 100, 40] }, { seat: 0.45 })],
    b: [fig('oyabun', -0.84, { yaw: R, ...SIT, lean: 22, aR: [70, 0, 16], aL: [36, 0, 74] }, { seat: 0.45, hold: [['R', 'tile', 0]] }), fig('yakuza2', 0.84, { yaw: L, ...SIT, lean: 10, aL: [44, 0, 64], aR: [36, 0, 74] }, { seat: 0.45 }), fig('tattoo', 0, { ...SIT, lean: 8, aL: [30, 30, 100, 40], aR: [30, 30, 100, 40] }, { seat: 0.45 })], anim: [2.4, 0.72],
  },
  {
    when: 'evening', id: 'v_den_cards', label: 'gambling: a dealer and a pile of cash', cat: 'v_den',
    back: [['lockers', -1.4, 3], ['door', 1.3]], front: [['table', 0, 1.5], ['pendant', 0, 1.6], ['chair', -0.95, 1], ['chair', 0.95, -1]],
    a: [fig('yakuza', -0.92, { yaw: R, ...SIT, lean: 14, aR: [50, 0, 60], aL: [40, 0, 70] }, { seat: 0.45, hold: [['R', 'cards', 60]] }), fig('suit2', 0.92, { yaw: L, ...SIT, lean: 22, nod: 16, aL: [60, 0, 120], aR: [60, 0, 120] }, { seat: 0.45 })],
    b: [fig('yakuza', -0.92, { yaw: R, ...SIT, lean: 22, aR: [74, 0, 18], aL: [40, 0, 70] }, { seat: 0.45 }), fig('suit2', 0.92, { yaw: L, ...SIT, lean: 22, nod: 16, aL: [60, 0, 120], aR: [60, 0, 120] }, { seat: 0.45 })], anim: [5, 0.7],
    aItems: [['stacks', 0.1, 0.705, 4]], bItems: [['stacks', 0.1, 0.705, 4]],
  },
  {
    id: 'v_den_count', label: 'the back office: the mama counting the night\'s money', cat: 'v_den',
    back: [['safe', -1.5], ['door', 1.3]], front: [['desk', -0.2, 1.4], ['chair', -0.85, 1], ['dlamp', 0.3, 0.735, -1]],
    a: [fig('mama', -0.83, { yaw: R, ...SIT, lean: 14, nod: 14, aL: [40, 0, 76], aR: [46, 0, 70] }, { seat: 0.45, hold: [['R', 'wad', 10]] })],
    b: [fig('mama', -0.83, { yaw: R, ...SIT, lean: 14, nod: 14, aL: [40, 0, 76], aR: [38, 0, 92] }, { seat: 0.45, hold: [['R', 'wad', 40]] })], anim: [3.6, 0.55],
    aItems: [['stacks', -0.2, 0.735, 4]], bItems: [['stacks', -0.2, 0.735, 4]],
  },
  {
    id: 'v_den_shark', label: 'loan sharks: a man standing over a debtor, the finger jabbed', cat: 'v_den',
    back: [['cabinets', -1.4, 2], ['picture', 1.0, 1.7, 0.9, 0.3]], front: [['chair', 0.5, -1], ['desk', 1.5, 0.9]],
    a: [fig('yakuza', -0.25, { yaw: R, lean: 20, nod: 14, aR: [62, 0, 70], aL: [-10, 0, 40] }), fig('man', 0.5, { yaw: L, ...SIT, lean: 20, nod: 30, aL: [40, 0, 60], aR: [40, 0, 60] }, { seat: 0.45 })],
    b: [fig('yakuza', -0.25, { yaw: R, lean: 30, nod: 14, aR: [70, 0, 10], aL: [-10, 0, 40] }), fig('man', 0.5, { yaw: L, ...SIT, lean: 12, nod: 34, aL: [40, 0, 60], aR: [40, 0, 60] }, { seat: 0.45 })], anim: [3.2, 0.6],
  },
  {
    id: 'v_den_swept', tween: 2, label: 'loan sharks: the desk swept clear', cat: 'v_den',
    back: [['cabinets', 1.5, 2], ['door', -1.4]], front: [['desk', 0.3, 1.5], ['chair', 1.1, -1]],
    a: [fig('chinpira', -0.6, { yaw: R, lean: 16, aR: [50, 0, 50], aL: [20, 0, 40] }), fig('elder', 1.08, { yaw: L, ...SIT, lean: -10, aL: [50, 0, 100], aR: [50, 0, 100] }, { seat: 0.45 })],
    b: [fig('chinpira', -0.55, { yaw: R, lean: 26, twist: -30, aR: [104, 0, 10], aL: [20, 0, 40] }), fig('elder', 1.08, { yaw: L, ...SIT, lean: -22, nod: 10, aL: [90, 0, 120], aR: [90, 0, 120] }, { seat: 0.45 })], anim: [6, 0.8, 0.35],
    aItems: [['papers', 0.2, 0.735, 3], ['phone', 0.65, 0.735]], bItems: [['flying', 0.1, 0.95]],
  },
  {
    id: 'v_den_blow', tween: 2, label: 'violence: held by the collar and struck', cat: 'v_den',
    back: [['lockers', 1.4, 3], ['door', -1.4]], front: [['boxes', -1.6]],
    a: [fig('tattoo', -0.3, { yaw: R, lean: 8, aL: [78, 0, 20], aR: [-36, 0, 114] }), fig('suit', 0.3, { yaw: L, lean: -10, nod: 6, aL: [50, 0, 100], aR: [20, 0, 30] })],
    b: [fig('tattoo', -0.24, { yaw: R, lean: 24, twist: -20, aL: [60, 0, 60], aR: [88, 0, 8] }), fig('suit', 0.38, { yaw: L, lean: -28, nod: -30, aL: [80, 0, 40], aR: [60, 0, 30] })], anim: [4.4, 0.8, 0.3],
  },
  {
    id: 'v_den_chair', label: 'violence: a man tied to a chair, another standing over him with a bat', cat: 'v_den',
    back: [['door', 1.4], ['boxes', -1.5]], front: [['chair', 0.35, -1], ['pendant', 0.2, 1.9]],
    a: [fig('suit2', 0.35, { yaw: L, ...SIT, lean: 16, nod: 40, aL: [-40, 0, 30], aR: [-40, 0, 30] }, { seat: 0.45 }), fig('yakuza', -0.55, { yaw: R, aR: [20, 0, 60], aL: [6, 0, 10] }, { hold: [['R', 'bat', -100]] })],
    b: [fig('suit2', 0.35, { yaw: L, ...SIT, lean: 16, nod: 40, aL: [-40, 0, 30], aR: [-40, 0, 30] }, { seat: 0.45 }), fig('yakuza', -0.55, { yaw: R, lean: 10, aR: [40, 0, 110], aL: [6, 0, 10] }, { hold: [['R', 'bat', 60]] })], anim: [5, 0.6],
  },
  {
    id: 'v_den_gun', label: 'violence: a gun on a man on his knees', cat: 'v_den',
    back: [['lockers', -1.4, 3], ['door', 1.4]], front: [['boxes', 1.7]],
    a: [fig('yakuza2', -0.55, { yaw: R, aR: [72, 0, 4], aL: [4, 0, 20], nod: 12 }, { hold: [['R', 'gun']] }), fig('man2', 0.5, { yaw: L, lL: [6, 0, 96], lR: [6, 0, 96], lean: 6, nod: 16, aL: [160, 20, 70], aR: [160, 20, 70] })],
  },
  {
    id: 'v_den_carry', tween: 1, label: 'two men carrying something long and heavy', cat: 'v_den',
    back: [['door', -1.4], ['lockers', 1.3, 3]],
    a: [fig('yakuza', -0.85, { yaw: R, ...STEP_A, lean: 8, aL: [16, 0, 30], aR: [16, 0, 30] }), fig('chinpira', 0.85, { yaw: R, ...STEP_B, lean: 12, aL: [-14, 0, 30], aR: [-14, 0, 30] })],
    b: [fig('yakuza', -0.85, { yaw: R, ...STEP_B, lean: 8, aL: [16, 0, 30], aR: [16, 0, 30] }), fig('chinpira', 0.85, { yaw: R, ...STEP_A, lean: 12, aL: [-14, 0, 30], aR: [-14, 0, 30] })], anim: [1.6, 0.5], slide: 0.4,
    aItems: [['bundle', 0, 0.84, 2.0]], bItems: [['bundle', 0, 0.86, 2.0]],
  },
  {
    id: 'v_den_deal', label: 'drugs: a deal over the table, a lookout at the door', cat: 'v_den',
    back: [['door', 1.4], ['boxes', -1.6]], front: [['table', -0.2, 1.2], ['chair', -1.0, 1], ['chair', 0.6, -1], ['pendant', -0.2, 1.7]],
    a: [fig('hood', -0.98, { yaw: R, ...SIT, lean: 18, aR: [56, 0, 40], aL: [30, 0, 70] }, { seat: 0.45 }), fig('chinpira', 0.58, { yaw: L, ...SIT, lean: 6, aL: [30, 0, 70], aR: [30, 0, 70] }, { seat: 0.45 })],
    b: [fig('hood', -0.98, { yaw: R, ...SIT, lean: 6, aR: [30, 0, 80], aL: [30, 0, 70] }, { seat: 0.45 }), fig('chinpira', 0.58, { yaw: L, ...SIT, lean: 22, aL: [58, 0, 36], aR: [30, 0, 70] }, { seat: 0.45, hold: [['L', 'wad', 180]] })], anim: [4.4, 0.5],
    aItems: [['packets', -0.35]], bItems: [['packets', -0.05]],
  },
  {
    id: 'v_den_nod', label: 'drugs: slumped in a chair, far away', cat: 'v_den',
    back: [['picture', -1.0, 1.6], ['boxes', 1.5]], front: [['armchair', -0.2, 1], ['roundtable', 0.75, 0.6, 0.5]],
    a: [fig('hood', -0.22, { yaw: R, ...SIT, lL: [70, 0, 50], lR: [60, 0, 30], lean: -24, nod: -34, aL: [-30, 0, 6], aR: [-24, 0, 4] }, { seat: 0.42 })],
    aItems: [['packets', 0.75, 0.505], ['ashtray', 0.55, 0.505]],
  },
  {
    id: 'v_den_floor', tween: 2, label: 'violence: a man on the floor, kicked', cat: 'v_den', low: true,
    back: [['lockers', -1.4, 3], ['door', 1.4]],
    a: [fig('man', 0.5, { yaw: L, pitch: -90, lean: 40, nod: 30, lL: [70, 0, 100], lR: [60, 0, 90], aL: [100, 0, 130], aR: [100, 0, 130] }), fig('chinpira', -0.55, { yaw: R, lean: -8, lR: [-26, 0, 60], aL: [30, 0, 40], aR: [-20, 0, 40] })],
    b: [fig('man', 0.5, { yaw: L, pitch: -90, lean: 50, nod: 30, lL: [80, 0, 110], lR: [70, 0, 100], aL: [100, 0, 130], aR: [100, 0, 130] }), fig('chinpira', -0.5, { yaw: R, lean: -16, lR: [58, 0, 16], aL: [-20, 0, 30], aR: [40, 0, 40] })], anim: [3, 0.6, 0.35],
  },
  {
    id: 'v_den_pole', tween: 2, label: 'a dancer at the pole, men watching', cat: 'v_den', adult: true, when: 'evening',
    back: [['stage', -0.6, 1.6], ['pole', -0.6]], front: [['roundtable', 1.0, 0.6, 0.7], ['stool', 0.6, 0.5], ['stool', 1.5, 0.5]],
    a: [fig('dancer', -0.38, { yaw: 60, lean: -14, bend: -8, aR: [150, 0, 30], aL: [60, 0, 80], lL: [60, 0, 96] }, { floor: 0.28 }), fig('suit', 0.6, { yaw: -140, ...SIT, lean: -6, aR: [30, 0, 80] }, { seat: 0.5, hold: [['R', 'glass', 90]] }), fig('fatcat', 1.5, { yaw: -150, ...SIT, lean: -10 }, { seat: 0.5 })],
    b: [fig('dancer', -0.82, { yaw: -60, lean: -22, bend: 8, aL: [156, 0, 20], aR: [140, 0, 40], lR: [50, 0, 70] }, { floor: 0.28 }), fig('suit', 0.6, { yaw: -140, ...SIT, lean: -6, aR: [50, 0, 130] }, { seat: 0.5, hold: [['R', 'glass', 110]] }), fig('fatcat', 1.5, { yaw: -150, ...SIT, lean: -10 }, { seat: 0.5 })], anim: [5, 0.5, 1.2],
  },
  {
    id: 'v_den_stage', tween: 2, label: 'a dancer on a little stage, a table of drinkers', cat: 'v_den', adult: true, when: 'evening',
    back: [['stage', -0.7, 1.8]], front: [['table', 1.1, 0.9, 0.6], ['stool', 0.55, 0.5], ['stool', 1.65, 0.5]],
    a: [fig('dancer2', -0.7, { bend: 12, aL: [160, 30, 25], aR: [95, 80, 40], lL: [26, 20, 36] }, { floor: 0.28 }), fig('suit2', 0.55, { yaw: -130, ...SIT, lean: 8, aL: [56, 0, 80], aR: [56, 0, 80] }, { seat: 0.5 }), fig('yakuza2', 1.65, { yaw: -150, ...SIT, lean: -10, aL: [36, 0, 110] }, { seat: 0.5, hold: [['L', 'cig', 160]] })],
    b: [fig('dancer2', -0.7, { bend: -12, aR: [160, 30, 25], aL: [95, 80, 40], lR: [26, 20, 36] }, { floor: 0.28 }), fig('suit2', 0.55, { yaw: -130, ...SIT, lean: 8, aL: [56, 20, 80], aR: [56, 20, 80] }, { seat: 0.5 }), fig('yakuza2', 1.65, { yaw: -150, ...SIT, lean: -10, aL: [36, 0, 110] }, { seat: 0.5, hold: [['L', 'cig', 160]] })], anim: [3.6, 0.5, 0.9],
    aItems: [['bottles3', 1.1, 0.605]], bItems: [['bottles3', 1.1, 0.605]],
  },
  // ---- behind the doors of the shady shops at street level (one room a kind; still) ----
  {
    id: 'g_cabaret_pole', label: 'a strip club: a dancer at the pole, men watching, the barman', cat: 'g_cabaret', adult: true,
    front: [['stage', -1.0, 1.7], ['pole', -1.0], ['roundtable', 0.75, 0.6, 0.7], ['stool', 0.3, 0.5], ['stool', 1.2, 0.5]],
    a: [fig('nude_heels', -0.8, { yaw: 60, lean: -14, bend: -8, aR: [150, 0, 30], aL: [60, 0, 80], lL: [60, 0, 96] }, { floor: 0.28 }), fig('suit', 0.3, { yaw: -140, ...SIT, lean: -6, aR: [30, 0, 80] }, { seat: 0.5, hold: [['R', 'glass', 90]] }), fig('fatcat', 1.2, { yaw: -150, ...SIT, lean: -10, aL: [36, 0, 110] }, { seat: 0.5, hold: [['L', 'cig', 160]] })],
    aItems: [['bottles3', 0.75, 0.705]],
    deep: [fig('shirt', 1.75, { yaw: -20, aL: [50, 0, 80], aR: [46, 0, 86] })],
  },
  {
    id: 'g_hostess_table', label: 'a hostess club: pouring, leaning close, a hand on his shoulder', cat: 'g_hostess', near: true,
    back: [['sofa', -0.2, 2.6], ['lamp', 1.75, 1.5]], front: [['table', -0.2, 1.3, 0.45]],
    a: [fig('hostess', -0.95, { yaw: 60, ...SIT, lean: 22, aR: [70, 0, 40], aL: [40, 0, 70] }, { seat: 0.42, hold: [['R', 'bottle', -20]] }), fig('fatcat', -0.2, { yaw: 10, ...SIT, lean: -12, aR: [36, 30, 110, 30] }, { seat: 0.42, hold: [['R', 'cig', 150]] }), fig('hostess2', 0.42, { yaw: -70, ...SIT, lean: 26, nod: 10, aL: [84, 0, 30], aR: [20, 0, 60] }, { seat: 0.42 })],
    aItems: [['bottles3', -0.1, 0.455], ['glass', -0.5, 0.455]],
    deep: [fig('mama', 1.4, { yaw: -40, aL: [40, 0, 80, 60], aR: [36, 0, 84, 60] })],
  },
  {
    id: 'g_host_champagne', label: 'a host club: a champagne call for a customer', cat: 'g_host', near: true,
    back: [['sofa', 0.1, 2.4]], front: [['table', 0.1, 1.2, 0.45]],
    a: [fig('dress', 0.1, { ...SIT, lean: -8, aL: [40, 20, 110, 30] }, { seat: 0.42, hold: [['L', 'glass', 90]] }), fig('host', -0.65, { yaw: 60, ...SIT, lean: 24, aR: [70, 0, 30] }, { seat: 0.42 }), fig('host', 0.9, { yaw: -50, lL: [6, 0, 96], lR: [80, 0, 96], lean: 10, aL: [60, 0, 60] }), fig('suit2', -1.55, { yaw: 40, aR: [160, 20, 30], aL: [140, 30, 60] }, { hold: [['R', 'bottle', 60]] })],
    aItems: [['bottles3', 0.2, 0.455]],
  },
  {
    id: 'g_cards_backroom', label: 'a back room: cards, cash on the table, a man at the door', cat: 'g_cards',
    back: [['lockers', -1.5, 2], ['door', 1.45]], front: [['table', -0.2, 1.5], ['chair', -1.15, 1], ['chair', 0.75, -1]],
    a: [fig('yakuza', -1.12, { yaw: R, ...SIT, lean: 14, aR: [50, 0, 60], aL: [40, 0, 70] }, { seat: 0.45, hold: [['R', 'cards', 60]] }), fig('suit2', 0.72, { yaw: L, ...SIT, lean: 22, nod: 16, aL: [60, 0, 120], aR: [60, 0, 120] }, { seat: 0.45 }), fig('tattoo', -0.2, { ...SIT, lean: 8, aL: [30, 30, 100, 40], aR: [30, 30, 100, 40] }, { seat: 0.45 })],
    aItems: [['stacks', -0.1, 0.705, 4], ['bottle', 0.35], ['ashtray', -0.5]],
    deep: [fig('chinpira', 1.5, { yaw: -30, ...CROSSED })],
  },
  {
    id: 'g_loan_counter', label: 'a loan office: a man leaning over the counter at a debtor', cat: 'g_loan',
    back: [['safe', 1.55], ['cabinets', -1.5, 2, 1.4]], front: [['counter', 0.55, 1.7]],
    a: [fig('yakuza2', 0.3, { yaw: L, lean: 34, nod: 6, aL: [84, 0, 12], aR: [40, 0, 50] }), fig('man', -0.95, { yaw: R, lean: 14, nod: 30, aL: [10, 0, 20], aR: [14, 0, 30] }), fig('clerk', 1.2, { yaw: -20, nod: 20, aL: [40, 0, 80], aR: [44, 0, 76] }, { hold: [['R', 'wad', 10]] })],
    aItems: [['papers', -0.1, 1.07, 3], ['stacks', 0.9, 1.07, 2]],
    deep: [fig('chinpira', -1.75, { yaw: 40, ...CROSSED })],
  },
  {
    id: 'g_lobby_panel', label: 'a love hotel lobby: a couple choosing a room at the panel', cat: 'g_lobby', adult: true,
    back: [['picture', -0.9, 1.75, 0.5, 0.36], ['picture', -0.3, 1.75, 0.5, 0.36], ['picture', 0.3, 1.75, 0.5, 0.36], ['picture', 0.9, 1.75, 0.5, 0.36], ['picture', -0.9, 1.3, 0.5, 0.36], ['picture', -0.3, 1.3, 0.5, 0.36], ['picture', 0.3, 1.3, 0.5, 0.36], ['picture', 0.9, 1.3, 0.5, 0.36]],
    front: [['plant', -1.75, 1.5], ['counter', 1.6, 0.7]],
    a: [fig('suit', -0.2, { yaw: 165, aR: [110, 70, 24] }), fig('dress', 0.14, { yaw: 195, tilt: 12, bend: 8, aL: [40, 0, 110, 60] })],
  },
  {
    id: 'g_slumped_bar', label: 'a bar late: one asleep on the counter, one nursing a drink', cat: 'g_slumped', near: true,
    back: [['counter', 0, 3.9]], front: [['stool', -1.1], ['stool', 0.2], ['stool', 1.3]],
    a: [fig('drunk', -1.1, { yaw: B, ...SIT, lean: 62, nod: 30, aL: [100, 30, 60], aR: [100, 30, 60] }, { seat: 0.75 }), fig('yakuza', 1.3, { yaw: 150, ...SIT, lean: 14, aR: [44, 0, 120], aL: [40, 0, 70] }, { seat: 0.75, hold: [['R', 'cig', 30]] })],
    aItems: [['bottles3', -0.5, 1.07], ['glass', 1.0, 1.07]],
    deep: [fig('shirt', 0.35, { yaw: 10, aL: [50, 0, 86, 30], aR: [46, 0, 90, 30] }, { hold: [['R', 'glass', 90]] })],
  },
  {
    id: 'g_exchange_window', label: 'a pachinko hall\'s exchange window: prizes for cash', cat: 'g_exchange',
    back: [['lockers', -1.4, 3], ['door', 1.5]], front: [['counter', 0.2, 1.3]],
    a: [fig('man2', -0.9, { yaw: R, lean: 12, aR: [70, 0, 30], aL: [20, 0, 50] }, { hold: [['L', 'bag', 0]] }), fig('elder', -1.6, { yaw: R, aL: [10, 0, 30] })],
    aItems: [['stacks', 0.1, 1.07, 2]],
    deep: [fig('clerk2', 0.5, { yaw: L, lean: 10, aL: [60, 0, 40] }, { hold: [['L', 'wad', 180]] })],
  },
];

/**
 * Manila's own rooms (setSceneCity): each takes the place of the Japanese built-in scene of its key's id, in its cell
 * (a futon, a kotatsu, the morning exercises on the radio, a mahjong table, the izakaya's kanpai), the same sort of room
 * with a Filipino household in it: the plastic table and chairs, an electric fan, the laundry on a line, a sleeping mat
 * under a net, the Santo Nino's altar, a drinking session on plastic stools with the videoke machine behind.
 */
export const MANILA_SWAP: Readonly<Record<string, Scene>> = {
  home_kotatsu: {
    id: 'm_home_fan', label: 'at the plastic table with the electric fan on, the laundry behind', cat: 'home',
    back: [['laundry', 0, 1.95], ['cabinets', -1.4, 2]], front: [['table', 0.05, 1.1], ['chair', -0.78, 1], ['chair', 0.88, -1], ['fan', 1.5]],
    a: [fig('man2', -0.78, { yaw: R, ...SIT, lean: 6, aR: [30, 0, 70], aL: [26, 0, 70] }, { seat: 0.45, hold: [['R', 'glass', 90]] }), fig('mom', 0.88, { yaw: L, ...SIT, aL: [30, 0, 76], aR: [30, 0, 70] }, { seat: 0.45 })],
    b: [fig('man2', -0.78, { yaw: R, ...SIT, lean: 8, aR: [58, 0, 118], aL: [26, 0, 70], nod: -10 }, { seat: 0.45, hold: [['R', 'glass', 100]] }), fig('mom', 0.88, { yaw: L, ...SIT, aL: [48, 0, 90], aR: [30, 0, 70] }, { seat: 0.45 })], anim: NOW_AND_THEN,
    aItems: [['bottle', -0.2], ['glass', 0.3]], bItems: [['bottle', -0.2], ['glass', 0.3]],
  },
  home_futon: {
    id: 'm_home_mat', label: 'someone asleep on a mat under a net, someone sitting up', cat: 'home', low: true,
    back: [['cabinets', 1.4, 2], ['picture', -1.3, 1.5]], front: [['mat', -0.2, 2.0], ['net', -0.2, 2.0]],
    a: [fig('woman2', 0.1, { yaw: R, pitch: -90, aL: [10, 0, 10], aR: [10, 0, 10] }, { floor: 0.06 }), fig('man', -0.7, { yaw: R, ...FLOOR_SIT, lean: 20, nod: 20 }, { seat: 0.06 })],
  },
  home_taiso: {
    id: 'm_home_altar', label: 'praying at the Santo Nino altar', cat: 'home',
    back: [['altar', -0.2], ['fan', 1.45]], front: [['plant', 1.8, 1.0]],
    a: [fig('elder2', -0.2, { yaw: B, aL: [52, 14, 118], aR: [52, -14, 118] })], b: [fig('elder2', -0.2, { yaw: B, lean: 16, nod: 18, aL: [52, 14, 118], aR: [52, -14, 118] })], anim: [3.4, 0.55],
  },
  den_kanpai: {
    id: 'm_den_inuman', label: 'a drinking session on plastic stools, the videoke machine behind', cat: 'den',
    back: [['karaoke', 1.35], ['picture', -1.0, 1.6, 0.9, 0.35]], front: [['table', 0, 1.5], ['pendant', 0, 1.75], ['stool', -0.95, 0.45], ['stool', 0.95, 0.45]],
    a: [fig('worker', -0.92, { yaw: R, ...SIT, aR: [30, 0, 84] }, { seat: 0.45, hold: [['R', 'glass', 90]] }), fig('shirt', 0.92, { yaw: L, ...SIT, aL: [30, 0, 84] }, { seat: 0.45, hold: [['L', 'glass', 90]] }), fig('clerk2', 0, { ...SIT, aL: [30, 30, 100, 40] }, { seat: 0.45 })],
    b: [fig('worker', -0.92, { yaw: R, ...SIT, aR: [86, 0, 30], lean: 12 }, { seat: 0.45, hold: [['R', 'glass', 90]] }), fig('shirt', 0.92, { yaw: L, ...SIT, aL: [86, 0, 30], lean: 12 }, { seat: 0.45, hold: [['L', 'glass', 90]] }), fig('clerk2', 0, { ...SIT, aL: [130, 40, 40] }, { seat: 0.45 })], anim: NOW_AND_THEN,
    aItems: [['bottles3', -0.1]], bItems: [['bottles3', -0.1]],
  },
  v_den_mahjong: {
    when: 'evening', id: 'm_den_tongits', label: 'gambling: a game of tong-its, cards and bills on the table', cat: 'v_den',
    back: [['picture', 0, 1.75, 1.2, 0.3], ['hanger', 1.7]], front: [['table', 0, 1.3], ['pendant', 0, 1.6], ['chair', -0.85, 1], ['chair', 0.85, -1]],
    a: [fig('fatcat', -0.84, { yaw: R, ...SIT, lean: 12, aR: [44, 0, 60], aL: [36, 0, 74] }, { seat: 0.45 }), fig('hood', 0.84, { yaw: L, ...SIT, lean: 10, aL: [44, 0, 64], aR: [36, 0, 74] }, { seat: 0.45 }), fig('tattoo', 0, { ...SIT, lean: 8, aL: [30, 30, 100, 40], aR: [30, 30, 100, 40] }, { seat: 0.45 })],
    b: [fig('fatcat', -0.84, { yaw: R, ...SIT, lean: 22, aR: [70, 0, 16], aL: [36, 0, 74] }, { seat: 0.45, hold: [['R', 'cards', 0]] }), fig('hood', 0.84, { yaw: L, ...SIT, lean: 10, aL: [44, 0, 64], aR: [36, 0, 74] }, { seat: 0.45 }), fig('tattoo', 0, { ...SIT, lean: 8, aL: [30, 30, 100, 40], aR: [30, 30, 100, 40] }, { seat: 0.45 })], anim: [2.4, 0.72],
    aItems: [['stacks', 0.1, 0.705, 2]], bItems: [['stacks', 0.1, 0.705, 2]],
  },
};

/** The clothes of Tōto's people that Manila's wouldn't wear: the yukata, the kimono, the yakuza's, mapped to its own. */
const MANILA_WHO: Partial<Record<CastName, CastName>> = {
  robe: 'man2', robe2: 'woman2', mama: 'dress', yakuza: 'hood', yakuza2: 'hood', oyabun: 'fatcat', chinpira: 'man2',
};
const whoFor = (f: Fig): Fig => (typeof f.who === 'string' && MANILA_WHO[f.who] ? { ...f, who: MANILA_WHO[f.who]! } : f);
function localise(s: Scene): Scene {
  const map = (l?: readonly Fig[]): Fig[] | undefined => l?.map(whoFor);
  return { ...s, a: map(s.a)!, ...(s.b ? { b: map(s.b)! } : {}), ...(s.deep ? { deep: map(s.deep)! } : {}), ...(s.frames ? { frames: s.frames.map((fr) => ({ ...fr, a: map(fr.a)! })) } : {}) };
}
let MANILA = false;
/** Manila (CityConfig.filipino): the rooms behind its windows are its own (MANILA_SWAP) and its people dress as it does. Before the atlas is built. */
export function setSceneCity(manila: boolean): void {
  MANILA = manila;
}

// ---- a scene's poses in order ----

/** As many poses as a scene can play (the first two in its cell, the rest in frame slots). */
export const MAX_POSES = 10;
const ARM0 = LIMB_REST.a;
const LEG0 = LIMB_REST.l;
const FOOT0 = LIMB_REST.f;
const mixN = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Between two angles the short way round (degrees). */
const mixDeg = (a: number, b: number, t: number): number => a + ((((b - a + 540) % 360) + 360) % 360 - 180) * t;
// (As many numbers as the longer of the two has, and no fewer than `least`: the turns neither pose sets stay left out.)
const mixList = (a: readonly (number | undefined)[] | undefined, b: readonly (number | undefined)[] | undefined, zero: readonly number[], t: number, least: number): number[] =>
  zero.slice(0, Math.max(least, a?.length ?? 0, b?.length ?? 0)).map((z, i) => mixN(a?.[i] ?? z, b?.[i] ?? z, t));

/** A figure part of the way from one pose to another: its place, every angle and what it holds. */
export function tweenFig(a: Fig, b: Fig, t: number): Fig {
  if (JSON.stringify(a.who) !== JSON.stringify(b.who)) return t < 0.5 ? a : b;
  const p = a.pose, q = b.pose;
  const pose: Record<string, number | number[]> = {};
  for (const k of ['yaw', 'pitch', 'roll', 'lean', 'bend', 'twist', 'nod', 'tilt', 'turn'] as const) if (p[k] !== undefined || q[k] !== undefined) pose[k] = mixDeg(p[k] ?? 0, q[k] ?? 0, t);
  for (const k of ['aL', 'aR'] as const) if (p[k] || q[k]) pose[k] = mixList(p[k], q[k], ARM0, t, 4);
  for (const k of ['lL', 'lR'] as const) if (p[k] || q[k]) pose[k] = mixList(p[k], q[k], LEG0, t, 3);
  for (const k of ['fL', 'fR', 'hL', 'hR'] as const) if (p[k] || q[k]) pose[k] = mixList(p[k], q[k], FOOT0, t, 1);
  // What a hand holds stays in it (its angle turning with the move where both poses set one; where it's been put
  // and its size going from the one pose's to the other's).
  const from = t < 0.5 ? a : b;
  const hold = from.hold?.map((h): Hold => {
    const o = (t < 0.5 ? b : a).hold?.find((x) => x[0] === h[0] && x[1] === h[1]);
    if (!o) return h;
    const me = holdAt(h);
    const h0 = holdAt(t < 0.5 ? h : o), h1 = holdAt(t < 0.5 ? o : h);
    return holdOf({ hand: me.hand, prop: me.prop, rot: h0.rot !== undefined && h1.rot !== undefined ? mixDeg(h0.rot, h1.rot, t) : me.rot, dx: mixN(h0.dx, h1.dx, t), dy: mixN(h0.dy, h1.dy, t), scale: mixN(h0.scale, h1.scale, t) });
  });
  const seat = a.seat !== undefined && b.seat !== undefined ? mixN(a.seat, b.seat, t) : from.seat;
  const floor = a.floor !== undefined || b.floor !== undefined ? mixN(a.floor ?? 0, b.floor ?? 0, t) : undefined;
  const depth = a.depth !== undefined || b.depth !== undefined ? mixN(a.depth ?? 0, b.depth ?? 0, t) : undefined;
  return { who: a.who, x: mixN(a.x, b.x, t), pose: pose as Pose, ...(seat !== undefined ? { seat } : {}), ...(floor !== undefined && seat === undefined ? { floor } : {}), ...(hold ? { hold } : {}), ...(depth !== undefined ? { depth } : {}) };
}

/** A pose part of the way to the next: the figures in step (by their order), the items moved where both have the same ones. */
function tweenFrame(a: SceneFrame, b: SceneFrame, t: number): SceneFrame {
  const figs = a.a.map((f, i) => (b.a[i] ? tweenFig(f, b.a[i], t) : f));
  const pa = a.aItems?.map(itemParts), pb = b.aItems?.map(itemParts);
  const same = pa && pb && pa.length === pb.length && pa.every((it, i) => it.kind === pb[i].kind && it.args.length === pb[i].args.length);
  const items = same ? pa.map((it, i): Item => itemOf(it.kind, mixN(it.x, pb[i].x, t), it.args.map((v, k) => mixN(v, pb[i].args[k], t)), mixN(it.depth, pb[i].depth, t))) : (t < 0.5 ? a : b).aItems;
  return { a: figs, ...(items ? { aItems: items } : {}) };
}

/**
 * A scene's poses in the order they play (there, then back the same way): `a`, `b`, `frames`, with `tween`
 * in-betweens made between each and the next, MAX_POSES at most (fewer in-betweens if it comes to more).
 */
export function posesOf(s: Scene): SceneFrame[] {
  const keys: SceneFrame[] = [{ a: s.a, aItems: s.aItems }, ...(s.b ? [{ a: s.b, aItems: s.bItems }] : []), ...(s.frames ?? [])].slice(0, MAX_POSES);
  if (!s.anim) return [keys[0]];
  let n = s.tween ?? 0;
  while (n > 0 && keys.length + (keys.length - 1) * n > MAX_POSES) n--;
  const out: SceneFrame[] = [];
  keys.forEach((k, i) => {
    out.push(k);
    if (i < keys.length - 1) for (let j = 1; j <= n; j++) out.push(tweenFrame(k, keys[i + 1], j / (n + 1)));
  });
  return out;
}

// ---- checking a scene ----

const BODIES: readonly Body[] = ['man', 'woman', 'child', 'elder'];
const HAIRS: readonly Hair[] = ['short', 'long', 'bun', 'hat', 'cap', 'none', 'bob', 'ponytail', 'twin'];
const SCENE_KEYS = ['id', 'label', 'cat', 'weight', 'adult', 'when', 'low', 'near', 'back', 'front', 'a', 'aItems', 'b', 'bItems', 'anim', 'frames', 'tween', 'deep', 'slide', 'setBack'];
const POSE_KEYS = ['yaw', 'pitch', 'roll', 'lean', 'bend', 'twist', 'nod', 'tilt', 'turn', 'aL', 'aR', 'lL', 'lR', 'fL', 'fR', 'hL', 'hR'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/**
 * Checks a scene from any source (the built-in ones and an edition's): `errors` gets a line for everything wrong
 * with it, and it is good only if none were added. Besides the format, the rule that has no exceptions: an adult
 * scene or one in a vice room has only adult bodies in adult clothes.
 */
export function checkScene(raw: unknown, errors: string[], from = 'scene'): raw is Scene {
  const before = errors.length;
  const err = (m: string): void => void errors.push(`${from}: ${m}`);
  if (!isObj(raw)) return err('a scene is an object'), false;
  const at = typeof raw.id === 'string' ? `${from} '${raw.id}'` : from;
  const bad = (m: string): void => void errors.push(`${at}: ${m}`);
  for (const k of Object.keys(raw)) if (!SCENE_KEYS.includes(k)) bad(`unknown field '${k}'`);
  if (typeof raw.id !== 'string' || !/^[a-z0-9_]+$/.test(raw.id)) bad('id must be letters, digits and _');
  if (typeof raw.label !== 'string' || !raw.label) bad('label is missing');
  const cats = typeof raw.cat === 'string' ? [raw.cat] : Array.isArray(raw.cat) ? (raw.cat as unknown[]) : [];
  if (cats.length === 0 || !cats.every((c) => (CATS as readonly unknown[]).includes(c) || isShopKind(c))) bad(`cat must be one or more of ${[...CATS, ...SHOP_KINDS].join(', ')}`);
  if (raw.weight !== undefined && !(num(raw.weight, 1, 4) && Number.isInteger(raw.weight))) bad('weight is 1 to 4');
  for (const k of ['adult', 'low', 'near']) if (raw[k] !== undefined && typeof raw[k] !== 'boolean') bad(`${k} is true or false`);
  if (raw.when !== undefined && !(WHEN as readonly unknown[]).includes(raw.when)) bad(`when is one of ${WHEN.join(', ')}`);
  if (raw.setBack !== undefined && !num(raw.setBack, 0, MAX_DEPTH)) bad(`setBack is 0 to ${MAX_DEPTH}`);
  const strict = raw.adult === true || cats.some((c) => typeof c === 'string' && isVice(c));
  const items = (key: string, from: Record<string, unknown> = raw, name = key): void => {
    const list = from[key];
    key = name;
    if (list === undefined) return;
    if (!Array.isArray(list)) return bad(`${key} is a list of items`);
    for (const it of list as unknown[]) {
      if (!Array.isArray(it) || typeof it[0] !== 'string' || !(it[0] in ITEMS)) bad(`${key}: no item '${Array.isArray(it) ? String(it[0]) : String(it)}'`);
      else {
        // (Its numbers, then perhaps its options.)
        const opts = it.length > 2 && isObj(it[it.length - 1]) ? (it[it.length - 1] as Record<string, unknown>) : undefined;
        if (!(opts ? it.slice(1, -1) : it.slice(1)).every((v) => num(v, -10, 10)) || !num(it[1], -2.5, 2.5)) bad(`${key}: '${it[0]}' takes an x from -2.5 to 2.5 and numbers`);
        if (opts && (Object.keys(opts).some((k) => k !== 'depth') || (opts.depth !== undefined && !num(opts.depth, 0, MAX_DEPTH)))) bad(`${key}: '${it[0]}': its options are { depth: 0 to ${MAX_DEPTH} }`);
      }
    }
  };
  const figures = (key: string, needed = false, from: Record<string, unknown> = raw, name = key): void => {
    const list = from[key];
    key = name;
    if (list === undefined) return needed ? bad(`${key} is missing`) : undefined;
    if (!Array.isArray(list) || list.length > 6 || (needed && list.length === 0)) return bad(`${key} is a list of one to six figures`);
    (list as unknown[]).forEach((fg, i) => {
      const where = `${key}[${i}]`;
      if (!isObj(fg)) return bad(`${where} is a figure`);
      for (const k of Object.keys(fg)) if (!['who', 'x', 'pose', 'seat', 'floor', 'hold', 'depth'].includes(k)) bad(`${where}: unknown field '${k}'`);
      const w = typeof fg.who === 'string' ? (CAST as Record<string, Who | undefined>)[fg.who] : isObj(fg.who) ? (fg.who as unknown as Who) : undefined;
      if (!w) bad(`${where}: who is a name from CAST or { body, outfit, hair }`);
      else {
        if (!BODIES.includes(w.body)) bad(`${where}: no body '${String(w.body)}'`);
        if (!(OUTFITS as readonly unknown[]).includes(w.outfit)) bad(`${where}: no outfit '${String(w.outfit)}'`);
        if (!HAIRS.includes(w.hair)) bad(`${where}: no hair '${String(w.hair)}'`);
        // The rule without exceptions.
        if (strict && w.body === 'child') bad(`${where}: a child's body in an adult or vice scene`);
        if (strict && TEEN_OUTFITS.includes(w.outfit)) bad(`${where}: a teen's outfit ('${w.outfit}') in an adult or vice scene`);
        // Nothing nude outside a scene the demo leaves out, and only the bodies it's made for.
        if (isBare(w.outfit) && (raw.adult !== true || (w.body !== 'woman' && (w.body !== 'man' || w.outfit !== 'nude')))) bad(`${where}: the nude outfit is a woman's or a man's (in heels, a woman's), in a scene marked adult`);
      }
      if (!num(fg.x, -2, 2)) bad(`${where}: x is -2 to 2`);
      if (fg.seat !== undefined && !num(fg.seat, 0, 1.5)) bad(`${where}: seat is 0 to 1.5`);
      if (fg.floor !== undefined && !num(fg.floor, 0, 1.5)) bad(`${where}: floor is 0 to 1.5`);
      if (fg.depth !== undefined && !num(fg.depth, 0, MAX_DEPTH)) bad(`${where}: depth is 0 to ${MAX_DEPTH}`);
      const pose = fg.pose ?? {};
      if (!isObj(pose)) bad(`${where}: pose is an object`);
      else {
        for (const [k, v] of Object.entries(pose)) {
          if (!POSE_KEYS.includes(k)) bad(`${where}: unknown pose part '${k}'`);
          else if (/^[alfh][LR]$/.test(k) ? !(Array.isArray(v) && v.length >= 1 && v.length <= restOf(k).length && v.every((d) => num(d, -360, 360))) : !num(v, -360, 360)) bad(`${where}: pose.${k} is degrees${/^[alfh][LR]$/.test(k) ? ` (1 to ${restOf(k).length} of them)` : ''}`);
          // (A wrist and an ankle only go so far.)
          else if (JOINT_RANGE[k] && !(v as number[]).every((d, i) => d >= JOINT_RANGE[k][i][0] && d <= JOINT_RANGE[k][i][1])) bad(`${where}: pose.${k} is ${JOINT_RANGE[k].map((r) => `${r[0]} to ${r[1]}`).join(', ')}`);
        }
      }
      if (fg.hold !== undefined) {
        if (!Array.isArray(fg.hold)) bad(`${where}: hold is a list of [hand, prop, angle?, dx?, dy?, scale?]`);
        else for (const h of fg.hold as unknown[]) {
          if (!Array.isArray(h) || h.length > 6 || (h[0] !== 'L' && h[0] !== 'R') || typeof h[1] !== 'string' || !(h[1] in PROPS) || (h[2] !== undefined && h[2] !== null && !num(h[2], -360, 360))) bad(`${where}: hold is ["L" or "R", a prop of PROPS, an angle?, dx?, dy?, scale?]`);
          else {
            if ((h[3] !== undefined && !num(h[3], -HOLD_REACH, HOLD_REACH)) || (h[4] !== undefined && !num(h[4], -HOLD_REACH, HOLD_REACH))) bad(`${where}: a hold's dx and dy are -${HOLD_REACH} to ${HOLD_REACH} m`);
            if (h[5] !== undefined && !num(h[5], HOLD_SCALE[0], HOLD_SCALE[1])) bad(`${where}: a hold's scale is ${HOLD_SCALE[0]} to ${HOLD_SCALE[1]}`);
            if (h[1] === 'cock' && raw.adult !== true) bad(`${where}: 'cock' is only for an adult scene`);
          }
        }
      }
    });
  };
  items('back');
  items('front');
  items('aItems');
  items('bItems');
  figures('a', true);
  figures('b');
  figures('deep');
  // Every pose's figures are held to the same rules as the first's.
  let poses = 1 + (raw.b !== undefined ? 1 : 0);
  if (raw.frames !== undefined) {
    if (!Array.isArray(raw.frames) || raw.frames.length < 1 || raw.frames.length > 8) bad('frames is a list of one to eight { a, aItems? }');
    else {
      (raw.frames as unknown[]).forEach((fr, i) => {
        if (!isObj(fr)) return bad(`frames[${i}] is { a, aItems? }`);
        for (const k of Object.keys(fr)) if (k !== 'a' && k !== 'aItems') bad(`frames[${i}]: unknown field '${k}'`);
        figures('a', true, fr, `frames[${i}].a`);
        items('aItems', fr, `frames[${i}].aItems`);
      });
      poses += raw.frames.length;
    }
  }
  if (raw.tween !== undefined && !(num(raw.tween, 0, 3) && Number.isInteger(raw.tween))) bad('tween is 0 to 3');
  if (typeof raw.tween === 'number' && poses + (poses - 1) * raw.tween > MAX_POSES) bad(`${poses} poses with ${raw.tween} in-betweens each is more than ${MAX_POSES}`);
  const anim = raw.anim;
  if (anim !== undefined && !(Array.isArray(anim) && (anim.length === 2 || anim.length === 3) && num(anim[0], 0.3, 20) && num(anim[1], 0.05, 0.95) && (anim[2] === undefined || num(anim[2], 0.1, 2.5)))) bad('anim is [period 0.3 to 20 s, the first pose\'s share 0.05 to 0.95, the move\'s seconds 0.1 to 2.5 (optional)]');
  if ((poses > 1) !== (anim !== undefined)) bad('b or frames (more poses) and anim go together');
  if (raw.bItems !== undefined && raw.b === undefined) bad('bItems without b');
  if (raw.slide !== undefined && (!num(raw.slide, 0.1, 2) || anim === undefined)) bad('slide is 0.1 to 2 m/s, with the two poses of a stride (b, anim)');
  if (raw.deep !== undefined && anim !== undefined) bad('deep (people at the back) only in a still scene');
  return errors.length === before;
}

// ---- the scenes an edition paints ----

/** The scenes an edition adds: plain objects from its own files (src/edition: the uncensored edition's adult/content/windows/*.json), each one scene or a list of them. */
const editionScenes = (): unknown[] => (edition.windowScenes ?? []).flatMap((s) => (Array.isArray(s) ? (s as unknown[]) : [s]));

/**
 * Scenes kept as files in the repository, for every edition: content/world3d/windows/<id>.json (each a scene or a
 * list of them). One with a built-in scene's id replaces it (an edited copy: the built-in stays in this file, and
 * deleting the override brings it back); any other is a new scene, after the built-in ones. A bad file is reported
 * and passed over (the built-in scene, if it was an override, stays).
 */
const overrideFiles = import.meta.glob('../../../content/world3d/windows/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
export const sceneOverrides = (): unknown[] => Object.keys(overrideFiles).sort().flatMap((k) => (Array.isArray(overrideFiles[k]) ? (overrideFiles[k] as unknown[]) : [overrideFiles[k]]));

const sceneLists = new Map<string, readonly Scene[]>();
// (A number for each scene object handed in, so a list is known by which objects it was made from: an edition's
// version of a built-in scene has the same id as another file's, and an edit can leave a file's length as it was.)
const sceneMarks = new WeakMap<object, number>();
let sceneMark = 0;
const markOf = (raw: unknown): string => {
  if (typeof raw !== 'object' || raw === null) return String(raw);
  let n = sceneMarks.get(raw);
  if (n === undefined) sceneMarks.set(raw, (n = ++sceneMark));
  return `#${n}`;
};
/**
 * Every scene an edition has: the built-in ones with the repository's overrides and additions (sceneOverrides),
 * without the adult ones in the demo, and then the edition's own. Each is checked: a bad one is reported on the
 * console and left out; so are an edition's whose id is taken, and a window scene past the last cell. An edition's
 * scene marked `adult` with a built-in scene's id is that edition's version of it: it takes the built-in one's
 * place (and cell), over the repository's override if there is one; the other editions keep theirs.
 */
export function allScenes(name: string = typeof __EDITION__ === 'undefined' ? 'standard' : __EDITION__, extra: readonly unknown[] = name === edition.name ? editionScenes() : [], over: readonly unknown[] = sceneOverrides()): readonly Scene[] {
  // (By what it's made from: the very objects of the edition's scenes and of the overrides.)
  const key = `${name}|${MANILA}|${extra.map(markOf).join(',')}|${over.map(markOf).join(',')}`;
  const made = sceneLists.get(key);
  if (made) return made;
  const overErrors: string[] = [];
  const good = over.filter((raw): raw is Scene => checkScene(raw, overErrors, 'content/world3d/windows'));
  for (const m of overErrors) console.warn(m);
  // (The last file of an id wins; ids keep their places, so an override never moves a scene's cell.)
  const byId = new Map(good.map((s) => [s.id, s]));
  const merged = [...SCENES.map((s) => (MANILA ? localise(MANILA_SWAP[s.id] ?? byId.get(s.id) ?? s) : byId.get(s.id) ?? s)), ...[...byId.values()].filter((s) => !SCENES.some((b) => b.id === s.id))];
  const out: Scene[] = merged.filter((s) => name !== 'demo' || !s.adult);
  // (A window scene takes a cell, and a quarter of one for each pose after its first two.)
  let cells = out.filter(isWindowScene).length;
  let slots = out.filter(isWindowScene).reduce((n, s) => n + Math.max(0, posesOf(s).length - 2), 0);
  const errors: string[] = [];
  const room = (): boolean => cells + Math.ceil(slots / 4) <= MAX_SCENES;
  const taken = new Set<string>();
  for (const raw of extra) {
    if (!checkScene(raw, errors, 'window scene')) continue;
    if (name === 'demo' && raw.adult) continue;
    const at = out.findIndex((s) => s.id === raw.id);
    if (at >= 0 && raw.adult === true && !taken.has(raw.id) && SCENES.some((b) => b.id === raw.id)) {
      // The edition's own version of a built-in scene, in its place.
      const was = out[at];
      const count = (s: Scene, k: 1 | -1): void => {
        if (!isWindowScene(s)) return;
        cells += k;
        slots += k * Math.max(0, posesOf(s).length - 2);
      };
      count(was, -1);
      count(raw, 1);
      if (room()) {
        out[at] = raw;
        taken.add(raw.id);
      } else {
        count(raw, -1);
        count(was, 1);
        errors.push(`window scene '${raw.id}': no cell left for its poses (${MAX_SCENES} cells): the built-in scene is kept`);
      }
    } else if (at >= 0) errors.push(`window scene '${raw.id}': that id is taken`);
    else if (isWindowScene(raw) && cells + 1 + Math.ceil((slots + Math.max(0, posesOf(raw).length - 2)) / 4) > MAX_SCENES) errors.push(`window scene '${raw.id}': no cell left (${MAX_SCENES} cells): dropped`);
    else {
      out.push(raw);
      if (isWindowScene(raw)) {
        cells++;
        slots += Math.max(0, posesOf(raw).length - 2);
      }
    }
  }
  for (const m of errors) console.warn(m);
  sceneLists.set(key, out);
  return out;
}

const windowLists = new Map<readonly Scene[], readonly Scene[]>();
/** The scenes behind the upper floors' windows, in the atlas's cells' order (as many as there are cells). */
export function windowScenes(name?: string, extra?: readonly unknown[], over?: readonly unknown[]): readonly Scene[] {
  const all = allScenes(name, extra, over);
  let mine = windowLists.get(all);
  if (!mine) windowLists.set(all, (mine = all.filter(isWindowScene)));
  return mine;
}

/** The room of each kind of shady shop at street level: the last scene of that kind (an edition's replaces the built-in one), or none. */
export function shopScenes(name?: string, extra?: readonly unknown[], over?: readonly unknown[]): Partial<Record<ShopKind, Scene>> {
  const out: Partial<Record<ShopKind, Scene>> = {};
  for (const s of allScenes(name, extra, over)) for (const c of catsOf(s)) if (isShopKind(c)) out[c] = s;
  return out;
}

/**
 * For the wall shader (city.ts), a texel a trade (row 3 of the scenes' numbers): the rooms a shop of that trade
 * can be instead of its own, where there's vice enough (three, in R, G and B: rooms of the shop atlas, the kinds'
 * after the trades' own), and the share of such shops that are (A, x 255; 0: none). Only the kinds that have a
 * scene (the demo has no adult ones).
 */
export function shadyTable(rooms: Partial<Record<ShopKind, Scene>>): number[][] {
  const out = Array.from({ length: TRADE_COUNT }, (_, t) => [t, t, t, 0]);
  for (const [trade, share, kinds] of SHADY_TRADES) {
    const have = kinds.filter((k) => rooms[k]);
    if (have.length === 0) continue;
    // (Fewer of them where some of the trade's rooms are missing.)
    out[trade] = [0, 1, 2].map((i) => TRADE_COUNT + SHOP_KINDS.indexOf(have[i % have.length])).concat(Math.round((255 * share * new Set(have).size) / new Set(kinds).size));
  }
  return out;
}

/** A scene's cell (for `?vignette=`: an id or a cell number), or -1. */
export const windowSceneIndex = (id: string | null, scenes: readonly Scene[] = windowScenes()): number => (id === null ? -1 : /^\d+$/.test(id) ? Math.min(Number(id), scenes.length - 1) : scenes.findIndex((s) => s.id === id));

// ---- the atlas, and the shader's side of it ----

/**
 * The scenes' cells: `cols` across and `rows` down, each `cellW` x `cellH` px for `w` x `h` metres. They lie under
 * the storefronts' masks in the same texture (shopAtlas.ts: tShopMask is `maskW` wide, the masks its first `maskH`
 * rows), so the wall shader needs no texture unit for them (it has one to spare of the GPU's sixteen). Between the
 * two, `dataRows` rows of numbers the shader reads a texel at a time (windowTables): so adding a scene changes the
 * texture and never the shader. `top`: how much of a cell's height is read (the cell above bleeds in at coarse mip
 * levels).
 */
export const WINDOW_ATLAS = { cols: 8, rows: 17, cellW: 256, cellH: 160, w: 4, h: 2.5, ppm: 64, top: 0.94, maskW: 2048, maskH: 1280, dataRows: 16 } as const;
/** How many cells there are: one a window scene, and one for every four poses beyond scenes' first two. */
export const MAX_SCENES = WINDOW_ATLAS.cols * WINDOW_ATLAS.rows;
/** The rows under the masks: the numbers, then the cells. */
export const WINDOW_ROWS = WINDOW_ATLAS.dataRows + WINDOW_ATLAS.rows * WINDOW_ATLAS.cellH;

/**
 * Where everything of the window scenes is in the atlas: scene n in cell n (R back, G its first pose, B front, A its
 * second pose or the people at the back); the poses after those in frame slots, four to a cell, in the cells after
 * the scenes' (`pool`), each scene's in a row from `slot[n]`.
 */
export function windowLayout(scenes: readonly Scene[]): { poses: SceneFrame[][]; slot: number[]; pool: number; cells: number } {
  const poses = scenes.map(posesOf);
  const slot: number[] = [];
  let slots = 0;
  for (const p of poses) {
    slot.push(slots);
    slots += Math.max(0, p.length - 2);
  }
  return { poses, slot, pool: scenes.length, cells: scenes.length + Math.ceil(slots / 4) };
}

/** How fast a scene really plays: nothing but a walk cycles in under MIN_PERIOD seconds. */
export const MIN_PERIOD = 2.4;
export const periodOf = (s: Scene): number => (s.anim ? Math.max(s.anim[0], s.slide ? 0.8 : MIN_PERIOD) : 0);
/** The seconds a move between two poses takes: the scene's own, or 0.45 and a little more for each in-between. */
export const goOf = (s: Scene, poses: number): number => (s.anim ? (s.anim[2] ?? 0.45 + 0.2 * Math.max(0, poses - 2)) : 0);

/**
 * The numbers the shader reads (bytes; windowAtlas.ts writes them into the first rows under the masks, one texel
 * each):
 *   row 0, texel n: scene n's play: R how often it cycles (cycles a second x 255 / 4), G the first pose's share of a
 *     cycle, B the walk's speed (m/s / 2), A its hours (WHEN's index) + 4 where `near` + 8 x (its poses - 1);
 *   row 1, texel 2 x kind + glass (glass 1: to the floor): where that kind's pick list starts in row 2 (R + 256 G)
 *     and how long it is (B);
 *   row 2: the pick lists: a scene's cell in R, once for each of its `weight`; behind a sill only the scenes that
 *     aren't `low`;
 *   row 3, texel a trade: the shady rooms a shop of that trade can be (shadyTable);
 *   row 4, texel n: where scene n's poses after the second are: R the cell of the first, G its channel (they run
 *     on from there, four to a cell), B the seconds a move between poses takes x 100, A its `setBack` in cm.
 */
export function windowTables(scenes: readonly Scene[]): { play: number[][]; more: number[][]; ranges: number[][]; picks: number[] } {
  const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  const W = windowLayout(scenes);
  const play = scenes.map((s, n) => [byte(s.anim ? (255 / 4) / periodOf(s) : 0), byte(s.anim ? s.anim[1] * 255 : 255), byte(((s.slide ?? 0) / 2) * 255), WHEN.indexOf(whenOf(s)) + (s.near ? 4 : 0) + 8 * (W.poses[n].length - 1)]);
  const more = scenes.map((s, n) => [W.pool + Math.floor(W.slot[n] / 4), W.slot[n] % 4, byte(goOf(s, W.poses[n].length) * 100), byte((s.setBack ?? 0) * 100)]);
  const ranges: number[][] = [];
  const picks: number[] = [];
  for (const cat of CATS) {
    for (const glass of [0, 1]) {
      const start = picks.length;
      scenes.forEach((s, n) => {
        if (catsOf(s).includes(cat) && (glass === 1 || !s.low)) for (let k = 0; k < (s.weight ?? 1); k++) picks.push(n);
      });
      ranges.push([start % 256, Math.floor(start / 256), Math.min(255, picks.length - start)]);
    }
  }
  return { play, more, ranges, picks };
}

const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${Math.round(n * 10000) / 10000}`);

/**
 * GLSL for the wall shader (city.ts): the atlas read, and the numbers' (windowTables). The same for every edition
 * and however many scenes there are. Straight-line on purpose: it's inlined where every branch costs the D3D
 * compiler.
 */
export function windowGlsl(): string {
  const A = WINDOW_ATLAS;
  const H = A.maskH + WINDOW_ROWS;
  return /* glsl */ `
  // ---- the rooms behind the upper floors' glass (windowScenes.ts, windowAtlas.ts) ----
  // Cell n at q (metres from the middle of the scene's floor). A scene's own cell: R the back furniture, G the
  // people's first pose, B the furniture they're at, A their second pose (or, in a still scene, people at the
  // back); a cell of frame slots: four more poses. The people's are distance fields (the edge at 0.5).
  vec4 windowScene(float n, vec2 q, float lod) {
    vec2 t = vec2(q.x / ${f(A.w)} + 0.5, q.y / ${f(A.h)});
    float inside = step(0.004, t.x) * step(t.x, 0.996) * step(0.0, t.y) * step(t.y, ${f(A.top)});
    vec2 px = vec2(0.0, ${f(A.maskH + A.dataRows)}) + (vec2(mod(n, ${f(A.cols)}), floor(n / ${f(A.cols)})) + vec2(t.x, 1.0 - t.y)) * vec2(${f(A.cellW)}, ${f(A.cellH)});
    return textureLod(tShopMask, px / vec2(${f(A.maskW)}, ${f(H)}), lod) * inside;
  }
  // A texel of the scenes' numbers (windowTables: row 0 a scene's play, 1 a kind's pick list, 2 the lists), as bytes.
  vec4 windowData(float x, int row) {
    return texelFetch(tShopMask, ivec2(int(x + 0.5), ${A.maskH} + row), 0) * 255.0;
  }
`;
}

/** How much of the mask texture's height the storefronts' masks take (shopShader.ts scales its reads by it). */
export const maskShare = (): number => WINDOW_ATLAS.maskH / (WINDOW_ATLAS.maskH + WINDOW_ROWS);

// ---- by the hour ----

type Keys = readonly (readonly number[])[];
const along = (keys: Keys, hour: number): number[] => {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] <= h) i++;
  const a = keys[i], b = keys[i + 1];
  const k = (h - a[0]) / (b[0] - a[0]);
  return a.slice(1).map((v, j) => v + (b[j + 1] - v) * k);
};
/**
 * Who's in, by the hour (0-24), linear between the hours given: offices full through the working day, thinning out
 * over the evening to the odd one working late; homes in the morning and from the evening on, most of them asleep
 * after one; hotels from check-in through the night.
 */
const FOLK_HOURS: Keys = [
  [0, 0.15, 0.8, 0.9], [1.5, 0.08, 0.3, 0.5], [5, 0.08, 0.25, 0.4], [6.5, 0.2, 0.7, 0.6], [8.5, 1, 0.6, 0.5], [10, 1, 0.3, 0.2],
  [16, 1, 0.3, 0.3], [18.5, 1, 0.9, 0.7], [20, 0.6, 1, 1], [22, 0.3, 1, 1], [24, 0.15, 0.8, 0.9],
];
/**
 * The night's own hours: how full the bars and clubs of the tenant buildings are (opening at five, full from nine
 * until the small hours), and how much of each of the city's vices is going on behind its windows (WHEN): the
 * evening's from early on, the late ones little before ten and most from midnight to three, lovers from nine to two;
 * next to none of it by day, almost none at breakfast.
 */
const NIGHT_HOURS: Keys = [
  [0, 1, 1, 1, 1], [1, 1, 1, 1, 1], [2.5, 0.8, 0.8, 1, 0.6], [3.5, 0.6, 0.6, 0.9, 0.35], [5, 0.2, 0.2, 0.4, 0.15], [6.5, 0.05, 0.03, 0.03, 0.03],
  [16.5, 0.05, 0.03, 0.02, 0.03], [18, 0.4, 0.25, 0.03, 0.05], [19.5, 0.7, 0.6, 0.06, 0.15], [21, 1, 1, 0.3, 0.6], [22.5, 1, 1, 0.7, 0.9], [23.5, 1, 1, 1, 1], [24, 1, 1, 1, 1],
];
/**
 * How many windows are lit, by what the building is, as a factor on the atmosphere's share (which follows the sun,
 * so winter evenings start early by themselves): offices, homes, hotels, and the night's buildings (tenant
 * buildings of bars and clubs, love hotels). A window's own hash against it is its bedtime, so the lights go out one
 * by one as the factor falls. Homes: most lit through the evening, a quarter at midnight, under a tenth from two to
 * five, a few more as people get up before it's light. Offices: lit through the working day, thinning from seven,
 * a scatter of overtime until eleven, then the odd floor. Hotels: a scatter all night. The night's buildings: from
 * nine until three.
 */
const LIT_HOURS: Keys = [
  [0, 0.42, 0.62, 1.3, 1.9], [1, 0.4, 0.38, 1.0, 1.9], [2, 0.38, 0.2, 0.7, 1.8], [3.5, 0.38, 0.15, 0.5, 1.3], [5, 0.38, 0.2, 0.5, 0.7], [6.5, 0.9, 0.5, 0.7, 0.4],
  [8.5, 2.1, 0.5, 0.6, 0.3], [17.5, 2.1, 0.9, 0.9, 0.5], [18.5, 1.9, 1.8, 1.2, 0.9], [19.5, 1.45, 1.9, 1.4, 1.3], [21, 0.9, 1.9, 1.5, 1.9], [22.5, 0.6, 1.7, 1.5, 1.9], [23.3, 0.45, 1.2, 1.4, 1.9], [24, 0.42, 0.62, 1.3, 1.9],
];

/** What the rooms behind the windows go by besides the hour. */
export interface WindowWeather {
  /** 0 spring, 1 summer, 2 autumn, 3 winter (district/seasons.ts seasonIndex). */
  readonly season?: number;
  /** The rainy season. */
  readonly tsuyu?: boolean;
  /** How wet it is out, 0 to 1 (rain; snow counts for some; a typhoon is 1). */
  readonly wet?: number;
}
export interface WindowHours {
  /** The lit windows' factor: offices, homes, hotels, the night's buildings. */
  readonly lit: [number, number, number, number];
  /** Who's in while the lamps are on: offices, homes, hotels (1: the usual full house). */
  readonly folk: [number, number, number];
  /** The bars and clubs, and each of the night's vices (WHEN): evening, late, lovers. */
  readonly night: [number, number, number, number];
}
/**
 * The rooms behind the windows at an hour (0-24), in a season and a weather. Winter and the rainy season keep more
 * people home of an evening (more windows lit, more people in them); in summer homes stay up some forty minutes
 * later; rain, snow and a typhoon bring people in as the streets empty, and a dark wet day brings the offices'
 * lights on.
 */
export function windowsAt(hour: number, o: WindowWeather = {}): WindowHours {
  const h = ((hour % 24) + 24) % 24;
  const wet = Math.max(0, Math.min(1, o.wet ?? 0));
  // (Summer's later night: the homes' evening read a little earlier than the clock, from eight until five.)
  const hh = o.season === 1 && (h >= 20 || h < 5) ? h - 0.7 : h;
  const indoors = o.season === 3 || o.tsuyu ? 1 : 0;
  const lit = along(LIT_HOURS, h) as [number, number, number, number];
  lit[1] = along(LIT_HOURS, hh)[1] * (1 + 0.1 * indoors + 0.25 * wet);
  lit[0] *= 1 + 1.5 * wet * (h > 7 && h < 19 ? 1 : 0.2);
  const folk = along(FOLK_HOURS, h) as [number, number, number];
  folk[1] = along(FOLK_HOURS, hh)[1] * (1 + 0.15 * indoors + 0.5 * wet);
  folk[2] *= 1 + 0.25 * wet;
  return { lit, folk, night: along(NIGHT_HOURS, h) as [number, number, number, number] };
}
