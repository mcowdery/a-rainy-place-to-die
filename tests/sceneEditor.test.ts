import { describe, expect, it } from 'vitest';
import { addKey, adjustHold, castChoices, clone, copyHoldEverywhere, copyPose, emptyScene, HANDLE_PART, holdCorners, holdTurnAt, holdTurnLead, itemAtDepth, itemBox, itemParams, itemWith, moveKey, nudgeItem, onHold, outfitsFor, PART_BONES, PART_LABEL, poseAt, propBox, removeHoldEverywhere, removeKey, resetHold, ringAngle, ringBasis, ringPoints, ringSlide, sceneKeys, setFigDepth, setSceneKeys, turned, undress, undressed, whoAllowed, withHeels, type SceneDoc } from '../src/poc3d/real/sceneEdit';
import { adultOnly, insideFolder, isBuiltIn, placeFor, SCENE_FOLDERS, SCENE_ID, sceneFileFor, sceneRevertFor, sceneText, strictCast } from '../src/poc3d/real/sceneFiles';
import { HANDLES, handleJoint, HEAD_RANGE, HEAD_TURN, mirrorFig, reach, reachError, swapSides, turnHead } from '../src/poc3d/real/sceneIk';
import { isBare, pickOutfit } from '../src/poc3d/district/peopleMix';
import { JOINTS, placeFigure, placePart, posedMesh } from '../src/poc3d/real/windowAtlas';
import { allScenes, CAST, checkScene, DEPTH_EYE, depthPoint, depthScale, depthUnpoint, itemOf, itemParts, PART_STEPS, PARTS, posesOf, poseValue, poseWith, PROPS, SCENES, TEEN_OUTFITS, tweenFig, windowTables, type Fig, type Hold, type Item, type PartName, type PartStep, type PropName, type Scene } from '../src/poc3d/real/windowScenes';

// The scene editor's rules and tools (scenes.html): where a scene may be saved, taking hold of a figure, and the
// edits the page makes, all apart from the page.

const ok = (s: unknown): string[] => {
  const errors: string[] = [];
  checkScene(s, errors);
  return errors;
};
const home = { id: 'x_home', label: 'a test', cat: 'home', a: [{ who: 'man', x: 0, pose: {} }] };
const lovers = { id: 'x_lovers', label: 'a test', cat: 'v_love', adult: true, when: 'lovers', a: [{ who: 'suit', x: 0, pose: {} }] };

describe('where a scene may be saved', () => {
  it('sends a scene to one file in one of two folders, named by its id', () => {
    expect(sceneFileFor(home, 'content')).toEqual({ folder: 'content/world3d/windows', name: 'x_home.json' });
    expect(sceneFileFor(lovers, 'adult')).toEqual({ folder: 'adult/content/windows', name: 'x_lovers.json' });
    // A built-in scene's edited copy is an override in the repository.
    expect(sceneFileFor(SCENES[0], 'content')).toEqual({ folder: SCENE_FOLDERS.content, name: `${SCENES[0].id}.json` });
  });

  it('refuses any other folder, any id that could be a path, and any scene that fails its checks', () => {
    for (const place of ['src', '', '../adult', 'content/..', null, undefined, 3]) expect(sceneFileFor(home, place)).toHaveProperty('error');
    for (const id of ['../x', 'a/b', 'a\\b', '.hidden', 'x.json', 'X_home', 'x home', '', 'a', '9lives', 'x'.repeat(49), 'con:x', 'x\u0000y', 5, null]) {
      expect(sceneFileFor({ ...home, id }, 'content'), String(id)).toHaveProperty('error');
      expect(sceneRevertFor(id), String(id)).toHaveProperty('error');
      if (typeof id === 'string') expect(SCENE_ID.test(id)).toBe(false);
    }
    expect(sceneFileFor({ ...home, a: [] }, 'content')).toHaveProperty('error');
    expect(sceneFileFor({ ...home, extra: 1 }, 'content')).toHaveProperty('error');
    expect(sceneFileFor('nonsense', 'content')).toHaveProperty('error');
    expect(sceneFileFor(null, 'content')).toHaveProperty('error');
  });

  it('keeps adult scenes, and anyone nude, to adult/, and adult/ to scenes marked adult', () => {
    expect(sceneFileFor(lovers, 'content')).toHaveProperty('error');
    expect(sceneFileFor(home, 'adult')).toHaveProperty('error');
    const nude = { ...lovers, id: 'x_nude', cat: 'g_cabaret', a: [{ who: 'nude', x: 0, pose: {} }] };
    expect(adultOnly(nude as unknown as Scene)).toBe(true);
    expect(sceneFileFor(nude, 'content')).toHaveProperty('error');
    expect(sceneFileFor(nude, 'adult')).toHaveProperty('name', 'x_nude.json');
    // (Not marked adult, the checks themselves refuse the nude outfit.)
    expect(sceneFileFor({ ...nude, adult: undefined }, 'content')).toHaveProperty('error');
    // The cast rule, wherever it's headed: a child or a teen in an adult or vice scene is never written.
    for (const who of ['boy', 'girl', { body: 'woman', outfit: 'school', hair: 'twin' }, { body: 'man', outfit: 'yankee', hair: 'short' }]) {
      expect(sceneFileFor({ ...lovers, a: [{ who, x: 0, pose: {} }] }, 'adult')).toHaveProperty('error');
      expect(sceneFileFor({ ...home, cat: 'v_den', a: [{ who, x: 0, pose: {} }] }, 'content')).toHaveProperty('error');
      expect(sceneFileFor({ ...lovers, a: lovers.a, b: [{ who, x: 0, pose: {} }], anim: [3, 0.5] }, 'adult')).toHaveProperty('error');
    }
    // A built-in scene that is adult (as built, or once someone in it is undressed) is saved to adult/ as the
    // uncensored edition's own version of it, never to the repository; one that isn't stays the repository's.
    const builtAdult = SCENES.find((s) => s.adult)!;
    const builtPlain = SCENES.find((s) => !s.adult && !s.id.startsWith('v_') && !s.id.startsWith('g_'))!;
    expect(sceneFileFor({ ...builtAdult }, 'adult')).toEqual({ folder: 'adult/content/windows', name: `${builtAdult.id}.json` });
    expect(sceneFileFor({ ...builtAdult }, 'content')).toHaveProperty('error');
    expect(sceneFileFor({ ...builtPlain }, 'adult')).toHaveProperty('error');
    expect(isBuiltIn(builtAdult.id)).toBe(true);
    expect(isBuiltIn('x_home')).toBe(false);
    expect(placeFor(builtAdult, 'builtin')).toBe('adult');
    expect(placeFor(builtPlain, 'builtin')).toBe('content');
    expect(placeFor({ ...builtPlain, adult: true }, 'builtin')).toBe('adult');
    expect(placeFor({ ...builtPlain, adult: true }, 'content')).toBe('adult');
    expect(placeFor(builtPlain, 'adult')).toBe('adult');
    expect(placeFor(home as unknown as Scene, 'content')).toBe('content');
    expect(placeFor(lovers as unknown as Scene, 'adult')).toBe('adult');
  });

  it('only reverts an override in the repository, and holds a resolved path inside its folder', () => {
    expect(sceneRevertFor('home_dinner')).toEqual({ folder: 'content/world3d/windows', name: 'home_dinner.json' });
    // In adult/ only an edited copy of a built-in scene is ever deleted: never one of the edition's own scenes.
    expect(sceneRevertFor('home_dinner', 'adult')).toEqual({ folder: 'adult/content/windows', name: 'home_dinner.json' });
    expect(sceneRevertFor('a_love_robe', 'adult')).toHaveProperty('error');
    expect(sceneRevertFor('home_dinner', 'src')).toHaveProperty('error');
    for (const sep of ['/', '\\']) {
      const dir = ['C:', 'proj', 'content', 'world3d', 'windows'].join(sep);
      expect(insideFolder(dir, `${dir}${sep}x_home.json`, sep)).toBe(true);
      expect(insideFolder(dir, `${dir}${sep}sub${sep}x_home.json`, sep)).toBe(false);
      expect(insideFolder(dir, `${dir}${sep}..${sep}x_home.json`, sep)).toBe(false);
      expect(insideFolder(dir, `${dir}_other${sep}x_home.json`, sep)).toBe(false);
      expect(insideFolder(dir, `${dir}${sep}x_home.txt`, sep)).toBe(false);
      expect(insideFolder(dir, dir, sep)).toBe(false);
      expect(insideFolder(dir, ['C:', 'proj', 'x_home.json'].join(sep), sep)).toBe(false);
    }
  });
});

describe('taking hold of a figure', () => {
  const stand = (yaw: number, extra: Partial<Fig> = {}): Fig => ({ who: 'suit', x: 0.2, pose: { yaw }, ...extra });
  const SEATED: Fig = { who: 'clerk', x: -0.4, pose: { yaw: 90, lL: [88, 0, 88], lR: [88, 0, 88] }, seat: 0.45 };

  it('places joints where the body is: a standing figure head over hips over feet', () => {
    const p = placeFigure(stand(0)).joints;
    expect(p.pelvis[0]).toBeCloseTo(0.2, 2);
    expect(p.head[1]).toBeGreaterThan(p.chest[1]);
    expect(p.chest[1]).toBeGreaterThan(p.pelvis[1]);
    expect(p.pelvis[1]).toBeGreaterThan(p.kneeL[1]);
    expect(p.kneeL[1]).toBeGreaterThan(p.footL[1]);
    expect(p.footL[1]).toBeGreaterThan(-0.01);
    expect(p.footL[1]).toBeLessThan(0.15);
    // L is the viewer's left when the figure faces the window.
    expect(p.handL[0]).toBeLessThan(p.handR[0]);
    // Seated, the hips rest on the seat.
    expect(placeFigure(SEATED).joints.hipL[1]).toBeCloseTo(0.45 + 0.085, 2);
  });

  it('brings a hand, a foot, an elbow or a knee to a point it can reach, within a few millimetres', () => {
    const cases: [Fig, (typeof HANDLES)[number], Fig][] = [
      // (The figure, the handle, and the same figure posed so the handle's joint is somewhere it can go.)
      [stand(90), 'handR', stand(90, { pose: { yaw: 90, aR: [80, 0, 40] } })],
      [stand(90), 'handL', stand(90, { pose: { yaw: 90, aL: [140, 0, 20] } })],
      [stand(-90), 'handR', stand(-90, { pose: { yaw: -90, aR: [50, 0, 100] } })],
      [stand(0), 'handR', stand(0, { pose: { yaw: 0, aR: [90, 90, 20] } })],
      [stand(0), 'handL', stand(0, { pose: { yaw: 0, aL: [150, 60, 40] } })],
      [stand(40), 'handR', stand(40, { pose: { yaw: 40, aR: [70, 30, 60] } })],
      [stand(180), 'handL', stand(180, { pose: { yaw: 180, aL: [100, 80, 30] } })],
      [stand(90), 'footR', stand(90, { pose: { yaw: 90, lR: [50, 0, 30] } })],
      [stand(90), 'kneeL', stand(90, { pose: { yaw: 90, lL: [70, 0, 0] } })],
      [stand(90), 'elbowR', stand(90, { pose: { yaw: 90, aR: [100, 0, 8] } })],
      [SEATED, 'handR', { ...SEATED, pose: { ...SEATED.pose, aR: [60, 0, 50] } }],
      [SEATED, 'footL', { ...SEATED, pose: { ...SEATED.pose, lL: [60, 0, 40] } }],
    ];
    for (const [from, handle, posed] of cases) {
      const target = placeFigure(posed).joints[handleJoint(handle)];
      const got = reach(from, handle, target);
      expect(reachError(got, handle, target), `${handle} at yaw ${from.pose.yaw}`).toBeLessThan(0.005);
      // What comes back is the scene's own format, to a tenth of a degree, and nothing else of the figure has moved.
      expect(got.x).toBe(from.x);
      expect(got.seat).toBe(from.seat);
      for (const v of Object.values(got.pose).flat()) expect(Math.abs((v as number) * 10 - Math.round((v as number) * 10))).toBeLessThan(1e-6);
      expect(ok({ ...home, a: [got] })).toEqual([]);
    }
  });

  it('follows a hand dragged through the room a step at a time', () => {
    // From hanging at the side, out in front and up over the head, in 2 cm steps: never more than a few mm behind.
    let f = stand(90);
    const start = placeFigure(f).joints.handR;
    const shoulder = placeFigure(f).joints.shoulderR;
    for (let i = 1; i <= 40; i++) {
      const a = -Math.PI / 2 + (i / 40) * Math.PI * 0.9;
      const target: [number, number] = [shoulder[0] + Math.cos(a) * 0.5, shoulder[1] + Math.sin(a) * 0.5];
      f = reach(f, 'handR', target);
      expect(reachError(f, 'handR', target), `step ${i}`).toBeLessThan(0.006);
    }
    expect(placeFigure(f).joints.handR[1]).toBeGreaterThan(start[1] + 0.5);
  });

  it('straightens toward a point out of reach, and stays inside the joints\' ranges', () => {
    const f = stand(90);
    const shoulder = placeFigure(f).joints.shoulderR;
    for (const target of [[shoulder[0] + 3, shoulder[1] + 0.2], [shoulder[0] + 1.5, shoulder[1] + 1.5], [shoulder[0] - 2, shoulder[1] - 0.2]] as [number, number][]) {
      const got = reach(f, 'handR', target);
      const p = placeFigure(got).joints;
      const armLength = Math.hypot(p.elbowR[0] - p.shoulderR[0], p.elbowR[1] - p.shoulderR[1]) + Math.hypot(p.handR[0] - p.elbowR[0], p.handR[1] - p.elbowR[1]);
      const far = Math.hypot(target[0] - p.shoulderR[0], target[1] - p.shoulderR[1]);
      // As near as the arm gets: within 6 cm of the best a straight arm could do.
      expect(reachError(got, 'handR', target)).toBeLessThan(far - armLength + 0.06);
      const [raise, swing, elbow] = got.pose.aR!;
      expect(raise).toBeGreaterThanOrEqual(-120);
      expect(raise).toBeLessThanOrEqual(220);
      expect(swing!).toBeGreaterThanOrEqual(-100);
      expect(swing!).toBeLessThanOrEqual(190);
      expect(elbow!).toBeGreaterThanOrEqual(0);
      expect(elbow!).toBeLessThanOrEqual(155);
      expect(ok({ ...home, a: [got] })).toEqual([]);
    }
    // The head and the chest too: toward the point, within their ranges.
    const head = reach(f, 'head', [5, 0]);
    expect(Math.abs(head.pose.nod ?? 0)).toBeLessThanOrEqual(80);
    expect(ok({ ...home, a: [reach(f, 'chest', [0.8, 0.9])] })).toEqual([]);
  });

  it('mirrors a figure across the room and back, and swaps its sides', () => {
    const f: Fig = { who: 'hostess', x: 0.42, pose: { yaw: -70, lean: 26, bend: 5, nod: 10, aL: [84, 0, 30], lR: [88, 0, 88] }, seat: 0.42, hold: [['L', 'bottle', 20]] };
    const m = mirrorFig(f);
    expect(m.x).toBe(-0.42);
    expect(m.pose.yaw).toBe(70);
    expect(m.pose.aR).toEqual([84, 0, 30]);
    expect(m.pose.aL).toBeUndefined();
    expect(m.pose.lL).toEqual([88, 0, 88]);
    expect(m.hold).toEqual([['R', 'bottle', 160]]);
    expect(mirrorFig(m)).toEqual(f);
    // The mirrored figure is the mirror image: every joint's x negated, sides exchanged.
    const a = placeFigure(f).joints, b = placeFigure(m).joints;
    expect(b.handR[0]).toBeCloseTo(-a.handL[0], 3);
    expect(b.handR[1]).toBeCloseTo(a.handL[1], 3);
    expect(b.head[0]).toBeCloseTo(-a.head[0], 3);
    expect(swapSides(f).pose.aR).toEqual([84, 0, 30]);
    expect(swapSides(swapSides(f))).toEqual(f);
    expect(ok({ ...home, cat: 'v_den', a: [m] })).toEqual([]);
  });
});

describe('what the editor does to a scene', () => {
  const doc = (s: unknown): SceneDoc => clone(s) as SceneDoc;

  it('saves a scene it has not changed as the same bytes, built in or from a file', () => {
    for (const s of SCENES) {
      const text = sceneText(s);
      expect(sceneText(JSON.parse(text)), s.id).toBe(text);
      expect(ok(JSON.parse(text)), s.id).toEqual([]);
      // (Opened and closed by the editor's own helpers: the poses read and written back.)
      const d = doc(s);
      setSceneKeys(d, sceneKeys(d));
      expect(JSON.parse(sceneText(d)), s.id).toEqual(JSON.parse(text));
    }
    // The repository's own scene files are exactly what the editor would write.
    const files = import.meta.glob('../content/world3d/windows/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
    for (const [path, text] of Object.entries(files)) {
      const s = JSON.parse(text) as { id: string };
      expect(sceneText(s).replace(/\r\n/g, '\n'), path).toBe(text.replace(/\r\n/g, '\n'));
      expect(path.endsWith(`/${s.id}.json`), path).toBe(true);
      expect(ok(s), path).toEqual([]);
      expect(sceneFileFor(s, 'content'), path).toHaveProperty('name', `${s.id}.json`);
    }
    // The edition's, whatever it holds: read and written back by the editor, the same scene.
    const adult = import.meta.glob('../adult/content/windows/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
    for (const [path, text] of Object.entries(adult)) {
      const raw = JSON.parse(text) as unknown;
      for (const s of Array.isArray(raw) ? raw : [raw]) expect(JSON.parse(sceneText(s)), path).toEqual(s);
    }
  });

  it('keeps an edited scene one the checks accept: a hand moved, poses added, moved and removed', () => {
    for (const s of allScenes('standard', [], [])) {
      const d = doc(s);
      const f = d.a[0];
      const hand = placeFigure(f).joints.handR;
      d.a[0] = reach(f, 'handR', [hand[0] + 0.12, hand[1] + 0.1]);
      expect(ok(d), `${s.id} after a drag`).toEqual([]);
      const poses = sceneKeys(d).length;
      addKey(d, 0);
      expect(sceneKeys(d).length).toBe(poses + 1);
      expect(ok(d), `${s.id} with a pose more`).toEqual([]);
      expect(moveKey(d, 0, 1)).toBe(1);
      expect(ok(d), `${s.id} reordered`).toEqual([]);
      removeKey(d, 1);
      expect(sceneKeys(d).length).toBe(poses);
      expect(ok(d), `${s.id} with it removed`).toEqual([]);
      // What's saved loads back as it was saved.
      expect(JSON.parse(sceneText(d))).toEqual(d);
      expect(sceneText(JSON.parse(sceneText(d)))).toBe(sceneText(d));
    }
  });

  it('writes the poses as a, b and frames, and a scene with one pose as a still one', () => {
    const d = emptyScene('x_new', 'home');
    expect(ok(d)).toEqual([]);
    expect(sceneKeys(d).length).toBe(1);
    addKey(d, 0);
    expect(d.b).toEqual(d.a);
    expect(d.anim).toEqual([4, 0.6]);
    addKey(d, 1);
    addKey(d, 2);
    expect((d.frames as unknown[]).length).toBe(2);
    expect(ok(d)).toEqual([]);
    (sceneKeys(d)[3].a[0] as { x: number }).x = 0.5;
    expect(moveKey(d, 3, -1)).toBe(2);
    expect((d.frames as { a: Fig[] }[])[0].a[0].x).toBe(0.5);
    expect(moveKey(d, 0, -1)).toBe(0);
    removeKey(d, 1);
    removeKey(d, 1);
    expect(d.frames).toBeUndefined();
    d.tween = 2;
    d.slide = 0.5;
    removeKey(d, 1);
    // Still again: nothing of its play is left behind.
    for (const k of ['b', 'bItems', 'frames', 'anim', 'tween', 'slide']) expect(d[k], k).toBeUndefined();
    removeKey(d, 0);
    expect(sceneKeys(d).length).toBe(1);
    expect(ok(d)).toEqual([]);
    // A vice scene starts with an adult in it.
    expect(ok(emptyScene('x_vice', 'v_den'))).toEqual([]);
    expect(ok(emptyScene('x_shop', 'g_cabaret', true))).toEqual([]);
  });

  it('offers only the cast the checks allow: adults in adult clothes in adult and vice scenes, nude only in adult ones', () => {
    const open = castChoices(home);
    expect(open.bodies).toContain('child');
    expect(open.cast).toContain('boy');
    expect(open.outfits).toContain('school');
    expect(open.outfits).not.toContain('nude');
    expect(open.cast).not.toContain('nude');
    for (const scene of [{ cat: 'v_den' }, { cat: ['home', 'v_love'] }, { cat: 'g_cabaret' }, { cat: 'home', adult: true }]) {
      expect(strictCast(scene)).toBe(true);
      const c = castChoices(scene);
      expect(c.bodies).toEqual(['man', 'woman', 'elder']);
      for (const o of TEEN_OUTFITS) expect(c.outfits).not.toContain(o);
      expect(c.cast).not.toContain('boy');
      expect(c.cast).not.toContain('girl');
      expect(c.outfits.includes('nude')).toBe(scene.adult === true);
      expect(c.cast.includes('nude')).toBe(scene.adult === true);
      // Whatever it offers, the checks accept in that scene, body by outfit and by name.
      const base = { id: 'x_pick', label: 'a test', ...scene };
      for (const who of c.cast) expect(ok({ ...base, a: [{ who, x: 0, pose: {} }] }), who).toEqual([]);
      for (const body of c.bodies) {
        // (Per body: nothing on only for a woman or a man.)
        const wear = outfitsFor(scene, body);
        expect(wear.includes('nude')).toBe(scene.adult === true && body !== 'elder');
        for (const outfit of c.outfits) expect(ok({ ...base, a: [{ who: { body, outfit, hair: 'short' }, x: 0, pose: {} }] }).length === 0, `${body} ${outfit}`).toBe(wear.includes(outfit));
      }
      expect(c.cast.includes('nude_man')).toBe(scene.adult === true);
      for (const prop of c.props) expect(ok({ ...base, a: [{ who: c.cast[0], x: 0, pose: {}, hold: [['R', prop]] }] }), prop).toEqual([]);
    }
    expect(strictCast(home)).toBe(false);
    // And what a plain scene offers to hold, the checks accept there.
    for (const prop of open.props) expect(ok({ ...home, a: [{ who: 'man', x: 0, pose: {}, hold: [['R', prop]] }] }), prop).toEqual([]);
  });

  it('undresses a figure only in a scene marked adult, keeping its body and hair, in one pose or all', () => {
    const adult = { cat: 'v_love', adult: true };
    expect(undressed(adult, 'suit')).toEqual({ body: 'man', outfit: 'nude', hair: 'short' });
    expect(undressed(adult, 'hostess2')).toEqual({ body: 'woman', outfit: 'nude', hair: 'bun' });
    expect(undressed(adult, { body: 'man', outfit: 'yukata', hair: 'none' })).toEqual({ body: 'man', outfit: 'nude', hair: 'none' });
    // Not an elder (there is no such body), not twice, and nowhere that isn't marked adult.
    expect(undressed(adult, 'boss')).toBeNull();
    expect(undressed(adult, 'oyabun')).toBeNull();
    expect(undressed(adult, 'nude')).toBeNull();
    expect(undressed(adult, 'nude_man')).toBeNull();
    for (const scene of [{ cat: 'v_love' }, { cat: 'home' }, { cat: 'g_cabaret' }, { cat: 'home', adult: false }]) for (const who of ['suit', 'hostess', 'man', 'woman'] as const) expect(undressed(scene, who)).toBeNull();
    expect(undressed({ cat: 'home' }, 'boy')).toBeNull();
    expect(whoAllowed(adult, { body: 'man', outfit: 'nude', hair: 'short' })).toBe(true);
    expect(whoAllowed(adult, { body: 'elder', outfit: 'nude', hair: 'short' })).toBe(false);
    expect(whoAllowed({ cat: 'v_love' }, 'nude_man')).toBe(false);
    expect(whoAllowed({ cat: 'home' }, 'boy')).toBe(true);
    expect(whoAllowed(adult, 'boy')).toBe(false);

    const d = emptyScene('x_two', 'v_love', true);
    d.a = [{ who: 'suit', x: -0.3, pose: { yaw: 90 } }, { who: 'hostess', x: 0.3, pose: { yaw: -90 }, hold: [['R', 'glass', 90]] }];
    addKey(d, 0);
    addKey(d, 1);
    expect(sceneKeys(d).length).toBe(3);
    // One pose: only that pose's figure, and only its clothes.
    expect(undress(d, 1, 1)).toBe(1);
    expect(sceneKeys(d).map((k) => k.a[1].who)).toEqual(['hostess', { body: 'woman', outfit: 'nude', hair: 'long' }, 'hostess']);
    expect(sceneKeys(d)[1].a[1]).toEqual({ who: { body: 'woman', outfit: 'nude', hair: 'long' }, x: 0.3, pose: { yaw: -90 }, hold: [['R', 'glass', 90]] });
    expect(ok(d)).toEqual([]);
    // Every pose: the rest of them (the one already bare isn't counted).
    expect(undress(d, 1)).toBe(2);
    expect(undress(d, 0)).toBe(3);
    for (const k of sceneKeys(d)) expect(k.a.map((f) => (f.who as { outfit: string }).outfit)).toEqual(['nude', 'nude']);
    expect(undress(d, 0)).toBe(0);
    expect(undress(d, 7)).toBe(0);
    expect(ok(d)).toEqual([]);
    // It can only be saved where such scenes go.
    expect(sceneFileFor(d, 'content')).toHaveProperty('error');
    expect(sceneFileFor(d, 'adult')).toHaveProperty('name', 'x_two.json');
    // Not marked adult: nothing happens.
    const plain = emptyScene('x_plain', 'v_den');
    expect(undress(plain, 0)).toBe(0);
    expect(plain.a[0].who).toBe('suit');
  });

  it('moves, turns and sizes what a hand holds, in range, and puts it back', () => {
    const h: Hold = ['R', 'glass', 90];
    expect(adjustHold(h, { dx: 0.123, dy: -0.0449 })).toEqual(['R', 'glass', 90, 0.12, -0.04]);
    expect(adjustHold(h, { dx: 5, dy: -5 })).toEqual(['R', 'glass', 90, 0.6, -0.6]);
    expect(adjustHold(h, { scale: 1.234 })).toEqual(['R', 'glass', 90, 0, 0, 1.23]);
    expect(adjustHold(h, { scale: 9 })).toEqual(['R', 'glass', 90, 0, 0, 2.5]);
    expect(adjustHold(h, { scale: 0.1 })).toEqual(['R', 'glass', 90, 0, 0, 0.4]);
    expect(adjustHold(h, { rot: undefined })).toEqual(['R', 'glass']);
    expect(adjustHold(['R', 'glass'], { rot: 33.33 })).toEqual(['R', 'glass', 33.3]);
    expect(adjustHold(['R', 'glass'], { dx: 0.1 })).toEqual(['R', 'glass', null, 0.1]);
    expect(adjustHold(['R', 'glass', null, 0.1], { dx: 0 })).toEqual(['R', 'glass']);
    expect(adjustHold(h, { hand: 'L', prop: 'bottle' })).toEqual(['L', 'bottle', 90]);
    expect(adjustHold(h, {})).toEqual(h);
    expect(resetHold(['L', 'bottle', 30, 0.2, 0.1, 2])).toEqual(['L', 'bottle']);
    // Whatever it's set to, the checks accept.
    for (const patch of [{ dx: 3 }, { dy: -3 }, { scale: 0 }, { scale: 100 }, { rot: 1000 }, { rot: -1000 }, { dx: 0.333333, dy: 0.111111, scale: 1.111111, rot: 12.3456 }]) expect(ok({ ...home, a: [{ who: 'man', x: 0, pose: {}, hold: [adjustHold(h, patch)] }] }), JSON.stringify(patch)).toEqual([]);
  });

  it('draws a held thing where it was, and where it is put: at the hand, then by its dx, dy, angle and size', () => {
    const f: Fig = { who: 'suit', x: 0.3, pose: { yaw: 90, aR: [60, 0, 40] }, hold: [['R', 'glass'], ['L', 'bottle', 90]] };
    const p = placeFigure(f);
    expect(p.holds.length).toBe(2);
    // Nothing set: at the hand (its anchor), along the forearm, its own size; an angle given is the angle.
    expect(p.holds[0].at).toEqual(p.holds[0].anchor);
    expect(p.holds[0].angle).toBe(p.holds[0].auto);
    expect(p.holds[0].scale).toBe(1);
    expect(Math.hypot(p.holds[0].at[0] - p.joints.handR[0], p.holds[0].at[1] - p.joints.handR[1])).toBeLessThan(1e-9);
    const fore = Math.atan2(p.joints.handR[1] - p.joints.elbowR[1], p.joints.handR[0] - p.joints.elbowR[0]);
    expect(p.holds[0].auto).toBeCloseTo(fore, 6);
    expect(p.holds[1].angle).toBeCloseTo(Math.PI / 2, 9);
    expect(Math.hypot(p.holds[1].at[0] - p.joints.handL[0], p.holds[1].at[1] - p.joints.handL[1])).toBeLessThan(1e-9);
    // Moved, turned and sized: from the same anchor, the figure itself untouched.
    const q = placeFigure({ ...f, hold: [['R', 'glass', 30, 0.1, -0.2, 1.5], ['L', 'bottle', 90]] });
    expect(q.joints).toEqual(p.joints);
    expect(q.box).toEqual(p.box);
    expect(q.holds[0].anchor).toEqual(p.holds[0].anchor);
    expect(q.holds[0].at[0]).toBeCloseTo(p.holds[0].at[0] + 0.1, 9);
    expect(q.holds[0].at[1]).toBeCloseTo(p.holds[0].at[1] - 0.2, 9);
    expect(q.holds[0].angle).toBeCloseTo(Math.PI / 6, 9);
    expect(q.holds[0].auto).toBe(p.holds[0].auto);
    expect(q.holds[0].scale).toBe(1.5);
    expect(q.holds[1]).toEqual(p.holds[1]);
    // The same for the thing anchored at the pelvis instead of a hand: its anchor is the body's, not the hand's, and
    // an unadjusted one is drawn exactly there.
    const m = placeFigure({ who: 'suit', x: 0, pose: { yaw: 90 }, hold: [['R', 'cock']] });
    expect(m.holds[0].at).toEqual(m.holds[0].anchor);
    expect(Math.hypot(m.holds[0].anchor[0] - m.joints.pelvis[0], m.holds[0].anchor[1] - m.joints.pelvis[1])).toBeLessThan(0.3);
    expect(Math.hypot(m.holds[0].anchor[0] - m.joints.handR[0], m.holds[0].anchor[1] - m.joints.handR[1])).toBeGreaterThan(0.05);
    const m2 = placeFigure({ who: 'suit', x: 0, pose: { yaw: 90 }, hold: [['R', 'cock', null, 0.05, 0.02, 0.8]] });
    expect(m2.holds[0].anchor).toEqual(m.holds[0].anchor);
    expect(m2.holds[0].angle).toBe(m.holds[0].angle);
    expect(m2.holds[0].at[0]).toBeCloseTo(m.holds[0].at[0] + 0.05, 9);
    expect(m2.holds[0].scale).toBe(0.8);

    // What it covers in the room, and its handles: the box turned and sized about where it's drawn.
    for (const prop of Object.keys(PROPS) as PropName[]) {
      const b = propBox(prop);
      expect(b[2] > b[0] && b[3] > b[1], prop).toBe(true);
    }
    const at = { at: [1, 1] as [number, number], angle: Math.PI / 2, scale: 2, anchor: [1, 1] as [number, number], auto: 0 };
    const [x0, y0, x1, y1] = propBox('bat');
    const c = holdCorners('bat', at);
    // (Turned a quarter anticlockwise and doubled: local +x goes up the picture.)
    expect(c[0][0]).toBeCloseTo(1 - 2 * y0, 9);
    expect(c[0][1]).toBeCloseTo(1 + 2 * x0, 9);
    expect(c[2][0]).toBeCloseTo(1 - 2 * y1, 9);
    expect(c[2][1]).toBeCloseTo(1 + 2 * x1, 9);
    expect(onHold('bat', at, 1, 1 + x1)).toBe(true);
    expect(onHold('bat', at, 1, 1 + 2 * x1 + 0.1)).toBe(false);
    expect(onHold('bat', at, 1.3, 1.5)).toBe(false);
    const t = holdTurnAt('bat', at);
    expect(t[0]).toBeCloseTo(1, 9);
    expect(t[1]).toBeGreaterThan(1 + 2 * x1);
    // The turning handle stands past the thing's far end, whichever way it's drawn: a bat along x, a bottle along y.
    expect(holdTurnLead('bat').lead).toBe(0);
    expect(holdTurnLead('bottle').lead).toBeCloseTo(Math.PI / 2, 9);
    const b2 = holdTurnAt('bottle', { ...at, angle: 0, scale: 1 });
    expect(b2[0]).toBeCloseTo(1, 9);
    expect(b2[1]).toBeGreaterThan(1 + propBox('bottle')[3]);
    for (const prop of Object.keys(PROPS) as PropName[]) expect(onHold(prop, at, ...holdTurnAt(prop, at), 0.02), prop).toBe(false);
    // Mirrored with its figure: the other hand, the other way across.
    const mir = mirrorFig({ who: 'suit', x: 0.2, pose: { yaw: 90 }, hold: [['R', 'glass', 30, 0.1, -0.2, 1.5], ['L', 'cig', null, -0.05]] });
    expect(mir.hold).toEqual([['L', 'glass', 150, -0.1, -0.2, 1.5], ['R', 'cig', null, 0.05]]);
    expect(mirrorFig(mir).hold).toEqual([['R', 'glass', 30, 0.1, -0.2, 1.5], ['L', 'cig', null, -0.05]]);
  });

  it('takes a held thing out of every pose, or puts it in every pose as it is here', () => {
    const d = emptyScene('x_holds', 'den');
    d.a = [{ who: 'suit', x: 0, pose: {}, hold: [['R', 'glass', 90], ['L', 'cig']] }, { who: 'hostess', x: 0.5, pose: {} }];
    addKey(d, 0);
    addKey(d, 1);
    const keys = sceneKeys(d);
    (keys[1].a[0] as { hold?: Hold[] }).hold = [['R', 'glass', 120]];
    delete (keys[2].a[0] as { hold?: Hold[] }).hold;
    // As it is here, everywhere: replaced where a pose has it, added where it hasn't; the rest of each pose's holds stay.
    const mine: Hold = ['R', 'glass', 90, 0.05, 0.02, 1.2];
    expect(copyHoldEverywhere(d, 0, mine)).toBe(3);
    expect(sceneKeys(d).map((k) => k.a[0].hold)).toEqual([[mine, ['L', 'cig']], [mine], [mine]]);
    expect(copyHoldEverywhere(d, 0, mine)).toBe(0);
    // (Each pose has its own copy: changing one leaves the others.)
    expect(sceneKeys(d)[1].a[0].hold![0]).not.toBe(sceneKeys(d)[0].a[0].hold![0]);
    expect(sceneKeys(d)[1].a[1].hold).toBeUndefined();
    expect(ok(d)).toEqual([]);
    // Out of every pose: that hand's thing only; a figure left holding nothing has no list.
    expect(removeHoldEverywhere(d, 0, ['R', 'glass'])).toBe(3);
    expect(sceneKeys(d).map((k) => k.a[0].hold)).toEqual([[['L', 'cig']], undefined, undefined]);
    expect('hold' in sceneKeys(d)[1].a[0]).toBe(false);
    expect(removeHoldEverywhere(d, 0, ['R', 'glass'])).toBe(0);
    expect(removeHoldEverywhere(d, 0, ['R', 'cig'])).toBe(0);
    expect(removeHoldEverywhere(d, 5, ['L', 'cig'])).toBe(0);
    expect(ok(d)).toEqual([]);
    expect(sceneText(JSON.parse(sceneText(d)))).toBe(sceneText(d));
  });

  it('knows a piece of furniture\'s numbers by name, what it covers, and how it moves', () => {
    expect(itemParams('glass').map((p) => p.name)).toEqual(['y']);
    expect(itemParams('glass')[0].def).toBeCloseTo(0.705);
    expect(itemParams('picture').map((p) => p.name)).toEqual(['y', 'w', 'h']);
    expect(itemParams('pole')).toEqual([]);
    const b = itemBox(['table', 0.5, 1.0, 0.7]);
    expect(b[0]).toBeCloseTo(0);
    expect(b[2]).toBeCloseTo(1);
    expect(b[1]).toBeCloseTo(0);
    expect(b[3]).toBeGreaterThan(0.69);
    // Across always; up and down only where it has a height of its own (its earlier numbers filled in).
    expect(nudgeItem(['sofa', 0.2, 1.8], 0.3, 0.5)).toEqual(['sofa', 0.5, 1.8]);
    expect(nudgeItem(['glass', 0.2], 0.1, 0.25)).toEqual(['glass', 0.3, 0.96]);
    expect(nudgeItem(['picture', 0, 1.5, 0.5, 0.4], 0, -0.1)).toEqual(['picture', 0, 1.4, 0.5, 0.4]);
  });

  it('plays as the shader does: resting in the first pose, through the rest and back, never a jump', () => {
    // Two poses, half the cycle held, a tenth of it a move.
    expect(poseAt(0.2, 2, 0.5, 0.1)).toEqual({ p0: 0, p1: 1, t: 0 });
    expect(poseAt(0.45, 2, 0.5, 0.1).t).toBeCloseTo(0.5);
    expect(poseAt(0.7, 2, 0.5, 0.1).t).toBeCloseTo(1);
    expect(poseAt(0.95, 2, 0.5, 0.1).t).toBeCloseTo(0.5);
    expect(poseAt(0.3, 1, 0.5, 0.1)).toEqual({ p0: 0, p1: 0, t: 0 });
    // Four poses: all of them on the way there, and no step larger than the phase's own.
    const seen = new Set<number>();
    let last = 0;
    for (let ph = 0; ph <= 1.0001; ph += 0.002) {
      const { p0, p1, t } = poseAt(Math.min(ph, 1), 4, 0.5, 0.2);
      expect(p1 - p0 === 1 || (p1 === p0 && t === 0)).toBe(true);
      const at = p0 + t;
      expect(Math.abs(at - last)).toBeLessThan(0.08);
      last = at;
      seen.add(Math.round(at));
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    // (A move longer than its rests is cut to them.)
    expect(poseAt(0.25, 2, 0.5, 5).t).toBeCloseTo(0.5);
  });
});

// Distance, every part's three turns, and copying a pose over another: the format's later additions and the tools
// the editor has for them.

const figOf = (who: string, x: number, pose: Fig['pose'] = {}, more: Partial<Fig> = {}): Fig => ({ who, x, pose, ...more }) as Fig;

describe('distance: how far back a figure or a piece stands', () => {
  it('checks it: a figure\'s depth, an item\'s options, a scene\'s setBack', () => {
    const scene = (extra: object): unknown => ({ ...home, ...extra });
    for (const depth of [0, 0.5, 2.5]) expect(ok(scene({ a: [{ who: 'man', x: 0, pose: {}, depth }] }))).toEqual([]);
    for (const depth of [-0.1, 2.6, '1', null]) expect(ok(scene({ a: [{ who: 'man', x: 0, pose: {}, depth }] })).join(' ')).toMatch(/depth is 0 to 2.5/);
    for (const it of [['sofa', 0, 2, { depth: 1 }], ['lamp', 1, 1.5, { depth: 0.5 }], ['sofa', 0.2, 2, {}], ['sofa', 0.2, 2]]) expect(ok(scene({ back: [it], front: [it], aItems: [it] })), JSON.stringify(it)).toEqual([]);
    for (const it of [['sofa', 0, 2, { depth: 3 }], ['sofa', 0, 2, { depth: -1 }], ['sofa', 0, 2, { deep: 1 }], ['sofa', 0, { depth: 1 }, 2], ['sofa', { depth: 1 }], ['sofa', 0, 2, { depth: '1' }]]) expect(ok(scene({ back: [it] })).length, JSON.stringify(it)).toBeGreaterThan(0);
    for (const setBack of [0, 1.25, 2.5]) expect(ok(scene({ setBack }))).toEqual([]);
    for (const setBack of [-1, 2.6, '1']) expect(ok(scene({ setBack })).join(' ')).toMatch(/setBack is 0 to 2.5/);
  });

  it('draws a figure further back smaller about the horizon, exactly as depthPoint says, joints, outline and what it holds', () => {
    expect(depthScale(undefined)).toBe(1);
    expect(depthScale(0)).toBe(1);
    expect(depthScale(DEPTH_EYE.d)).toBe(0.5);
    for (const [x, y, d] of [[1.2, 0, 2], [-0.4, 1.9, 0.7], [0, DEPTH_EYE.y, 2.5]]) {
      const [px, py] = depthPoint(x, y, d);
      const [bx, by] = depthUnpoint(px, py, d);
      expect(bx).toBeCloseTo(x, 12);
      expect(by).toBeCloseTo(y, 12);
      // Toward the middle and the horizon, never past them.
      expect(Math.abs(px)).toBeLessThanOrEqual(Math.abs(x));
      expect(Math.abs(py - DEPTH_EYE.y)).toBeLessThanOrEqual(Math.abs(y - DEPTH_EYE.y) + 1e-12);
    }
    expect(depthPoint(1, 0, 0)).toEqual([1, 0]);
    for (const f of [figOf('suit', 0.8, { yaw: 90, aR: [60, 0, 40] }, { hold: [['R', 'glass', 90, 0.05, 0.1, 1.5]] }), figOf('hostess', -1.1, { yaw: -50, lL: [88, 0, 88], lR: [88, 0, 88] }, { seat: 0.42 }), figOf('man', 0.3, { pitch: -90 }, { floor: 0.5 })]) {
      const near = placeFigure(f);
      for (const depth of [0.5, 2]) {
        const far = placeFigure({ ...f, depth });
        expect(far.scale).toBe(depthScale(depth));
        for (const j of JOINTS) {
          const want = depthPoint(near.joints[j][0], near.joints[j][1], depth);
          expect(far.joints[j][0]).toBeCloseTo(want[0], 9);
          expect(far.joints[j][1]).toBeCloseTo(want[1], 9);
        }
        const [x0, y0] = depthPoint(near.box[0], near.box[1], depth), [x1, y1] = depthPoint(near.box[2], near.box[3], depth);
        expect(far.box[0]).toBeCloseTo(x0, 6);
        expect(far.box[1]).toBeCloseTo(y0, 6);
        expect(far.box[2]).toBeCloseTo(x1, 6);
        expect(far.box[3]).toBeCloseTo(y1, 6);
        near.holds.forEach((h, n) => {
          const want = depthPoint(h.at[0], h.at[1], depth);
          expect(far.holds[n].at[0]).toBeCloseTo(want[0], 9);
          expect(far.holds[n].at[1]).toBeCloseTo(want[1], 9);
          expect(far.holds[n].scale).toBeCloseTo(h.scale * depthScale(depth), 12);
          expect(far.holds[n].angle).toBe(h.angle);
        });
      }
      // (In its layer, nothing is changed at all.)
      expect(placeFigure({ ...f, depth: 0 })).toEqual(near);
    }
    // Feet rise and the figure shrinks; its head, about the horizon's height, hardly moves.
    const a = placeFigure(figOf('suit', 0, {})), b = placeFigure(figOf('suit', 0, {}, { depth: 2 }));
    expect(b.box[1]).toBeGreaterThan(a.box[1] + 0.3);
    expect(b.box[3] - b.box[1]).toBeCloseTo((a.box[3] - a.box[1]) * depthScale(2), 6);
    expect(Math.abs(b.joints.head[1] - a.joints.head[1])).toBeLessThan(0.08);
  });

  it('still puts a dragged hand under the pointer on a figure further back', () => {
    for (const depth of [0.6, 1.5, 2.5]) {
      const f = figOf('suit', 0.5, { yaw: 90 }, { depth });
      const target = placeFigure({ ...f, pose: { yaw: 90, aR: [80, 0, 40] } }).joints.handR;
      const got = reach(f, 'handR', target);
      expect(reachError(got, 'handR', target)).toBeLessThan(0.004);
      expect(got.depth).toBe(depth);
      expect(ok({ ...home, a: [got] })).toEqual([]);
    }
  });

  it('carries distance through in-betweens, and through an item\'s moves', () => {
    const a = figOf('man', 0, {}), b = figOf('man', 0, {}, { depth: 2 });
    expect(tweenFig(a, b, 0.25).depth).toBeCloseTo(0.5, 12);
    expect(tweenFig(b, b, 0.5).depth).toBe(2);
    expect('depth' in tweenFig(a, a, 0.5)).toBe(false);
    const s = { ...home, id: 'x_far', a: [a], b: [b], anim: [4, 0.5], tween: 1, aItems: [['glass', 0.2, 0.7]], bItems: [['glass', 0.4, 0.7, { depth: 1 }]] } as unknown as Scene;
    expect(ok(s)).toEqual([]);
    const poses = posesOf(s);
    expect(poses.length).toBe(3);
    expect(poses[1].a[0].depth).toBeCloseTo(1, 12);
    const mid = itemParts(poses[1].aItems![0]);
    expect(mid.kind).toBe('glass');
    expect(mid.x).toBeCloseTo(0.3, 12);
    expect(mid.args).toEqual([0.7]);
    expect(mid.depth).toBeCloseTo(0.5, 12);
    // An item's parts, there and back; where it stands in its layer nothing is written.
    for (const it of [['sofa', 0.2, 2], ['sofa', 0.2, 2, { depth: 1.2 }], ['lamp', 1.8], ['picture', 0, 1.5, 0.5, 0.4, { depth: 0.3 }]] as Item[]) {
      const p = itemParts(it);
      expect(itemOf(p.kind, p.x, p.args, p.depth)).toEqual(it);
    }
    expect(itemOf('sofa', 0.2, [2], 0)).toEqual(['sofa', 0.2, 2]);
    expect(itemAtDepth(['sofa', 0.2, 2], 1.234)).toEqual(['sofa', 0.2, 2, { depth: 1.23 }]);
    expect(itemAtDepth(['sofa', 0.2, 2, { depth: 1 }], 0)).toEqual(['sofa', 0.2, 2]);
    expect(itemAtDepth(['sofa', 0.2, 2], 9)).toEqual(['sofa', 0.2, 2, { depth: 2.5 }]);
    expect(nudgeItem(['glass', 0.2, 0.7, { depth: 1 }], 0.1, 0.05)).toEqual(['glass', 0.3, 0.75, { depth: 1 }]);
    expect(itemWith(['picture', 0, 1.5, 0.5, 0.4, { depth: 1 }], 2, 0.8)).toEqual(['picture', 0, 1.5, 0.8, 0.4, { depth: 1 }]);
    expect(itemWith(['picture', 0, 1.5, 0.5, 0.4, { depth: 1 }], 0, -0.5)).toEqual(['picture', -0.5, 1.5, 0.5, 0.4, { depth: 1 }]);
    expect(itemWith(['picture', 0, 1.5, 0.5, 0.4, { depth: 1 }], 2, undefined)).toEqual(['picture', 0, 1.5, { depth: 1 }]);
    expect(itemWith(['glass', 0.2], 1, 0.9)).toEqual(['glass', 0.2, 0.9]);
    // What it covers in the picture: its box, further back.
    const near = itemBox(['table', 0.5, 1.0, 0.7]), far = itemBox(['table', 0.5, 1.0, 0.7, { depth: 2 }]);
    expect(far[0]).toBeCloseTo(depthPoint(near[0], near[1], 2)[0], 9);
    expect(far[1]).toBeCloseTo(depthPoint(near[0], near[1], 2)[1], 9);
    expect(far[3]).toBeCloseTo(depthPoint(near[2], near[3], 2)[1], 9);
    for (const it of [['sofa', 0.2, 2, { depth: 1.2 }], nudgeItem(['glass', 0.2, 0.7, { depth: 1 }], 0.1, 0.05)]) expect(ok({ ...home, back: [it] })).toEqual([]);
    // A figure's: set, kept in range, left out at nothing.
    const f = figOf('man', 0, {});
    setFigDepth(f, 1.237);
    expect(f.depth).toBe(1.24);
    setFigDepth(f, 7);
    expect(f.depth).toBe(2.5);
    setFigDepth(f, 0);
    expect('depth' in f).toBe(false);
  });

  it('tells the shader how far a scene is set back, in a number its table already had', () => {
    const scenes = [{ ...home, id: 'x_a' }, { ...home, id: 'x_b', setBack: 1.5 }, { ...home, id: 'x_c', setBack: 2.5 }] as unknown as Scene[];
    expect(windowTables(scenes).more.map((m) => m[3])).toEqual([0, 150, 250]);
    // (Nothing built in is set back: the city is as it was.)
    for (const sc of SCENES) expect(sc.setBack, sc.id).toBeUndefined();
  });
});

describe('every part and its turns', () => {
  const steps = PARTS.flatMap((p) => PART_STEPS[p].filter((st) => st.fixed === undefined).map((st) => ({ part: p, st })));

  it('reads and writes a turn in the pose itself, writing nothing that needn\'t be', () => {
    const at = (part: PartName, name: string): PartStep => PART_STEPS[part].find((st) => st.name === name)!;
    expect(poseValue({}, at('armR', 'raise'))).toBe(3);
    expect(poseValue({}, at('foreR', 'elbow'))).toBe(8);
    expect(poseValue({ aR: [40] }, at('foreR', 'elbow'))).toBe(8);
    expect(poseValue({ aR: [40, 0, 70, 0, 12] }, at('foreR', 'side'))).toBe(12);
    expect(poseValue({ nod: 20 }, at('head', 'nod'))).toBe(20);
    expect(poseWith({}, at('head', 'tilt'), 12)).toEqual({ tilt: 12 });
    expect(poseWith({ tilt: 12, nod: 3 }, at('head', 'tilt'), 0)).toEqual({ nod: 3 });
    // A limb's list: filled up to the number set with what it is at rest, and stopping after the last that isn't.
    expect(poseWith({}, at('foreR', 'turn'), 30)).toEqual({ aR: [3, 0, 8, 0, 0, 30] });
    expect(poseWith({ aR: [40, 10, 70] }, at('armR', 'twist'), 25)).toEqual({ aR: [40, 10, 70, 25] });
    expect(poseWith({ aR: [40, 10, 70, 25] }, at('armR', 'twist'), 0)).toEqual({ aR: [40, 10, 70] });
    expect(poseWith({ aR: [40, 0, 8, 0, 0, 30] }, at('foreR', 'turn'), 0)).toEqual({ aR: [40] });
    expect(poseWith({ lL: [88, 0, 88] }, at('thighL', 'twist'), 20)).toEqual({ lL: [88, 0, 88, 20] });
    expect(poseWith({ lL: [88, 0, 88] }, at('shinL', 'turn'), -15)).toEqual({ lL: [88, 0, 88, 0, -15] });
    expect(poseWith({}, at('footL', 'pitch'), 40)).toEqual({ fL: [40] });
    expect(poseWith({ fL: [40] }, at('footL', 'roll'), 10)).toEqual({ fL: [40, 0, 10] });
    // (A limb wholly at rest isn't mentioned.)
    expect(poseWith({}, at('footL', 'pitch'), 0)).toEqual({});
    expect(poseWith({}, at('armL', 'raise'), 3)).toEqual({});
    expect(poseWith({ fL: [40] }, at('footL', 'pitch'), 0)).toEqual({});
    expect(poseWith({ aR: [3, 0, 8, 20], nod: 4 }, at('armR', 'twist'), 0)).toEqual({ nod: 4 });
    for (const { st } of steps) for (const v of [st.range[0], st.range[1], st.def]) {
      const p = poseWith({ yaw: 30, aL: [50, 0, 50], lR: [88, 0, 88] }, st, v);
      expect(poseValue(p, st)).toBe(v);
      expect(ok({ ...home, a: [{ who: 'man', x: 0, pose: p }] })).toEqual([]);
    }
    for (const { st } of steps) {
      expect(st.range[0]).toBeLessThanOrEqual(st.def);
      expect(st.range[1]).toBeGreaterThanOrEqual(st.def);
    }
    // Every number of a pose is some part's turn, once.
    const where = steps.map(({ st }) => `${String(st.key)}${st.at === undefined ? '' : `.${st.at}`}`);
    expect(new Set(where).size).toBe(where.length);
    // The checks hold a limb's list to its length.
    const bad = (pose: object): string => ok({ ...home, a: [{ who: 'man', x: 0, pose }] }).join(' ');
    expect(bad({ aL: [1, 2, 3, 4, 5, 6] })).toBe('');
    expect(bad({ aL: [1, 2, 3, 4, 5, 6, 7] })).toMatch(/pose.aL/);
    expect(bad({ lL: [1, 2, 3, 4, 5] })).toBe('');
    expect(bad({ lL: [1, 2, 3, 4, 5, 6] })).toMatch(/pose.lL/);
    expect(bad({ fR: [10, 5, 5] })).toBe('');
    expect(bad({ fR: [10, 5, 5, 5] })).toMatch(/pose.fR/);
    expect(bad({ fR: 10 })).toMatch(/pose.fR/);
    expect(bad({ fX: [10] })).toMatch(/unknown pose part/);
  });

  it('poses a figure as before where the new turns are left out or at rest', () => {
    const base: Fig['pose'] = { yaw: 40, lean: 10, aL: [84, 20, 30, 15], aR: [50], lL: [88, 0, 88], lR: [26, 0, 6] };
    const full: Fig['pose'] = { ...base, aL: [84, 20, 30, 15, 0, 0], aR: [50, 0, 8, 0, 0, 0], lL: [88, 0, 88, 0, 0], lR: [26, 0, 6, 0, 0], fL: [0, 0, 0], fR: [0] };
    expect(placeFigure(figOf('suit', 0.2, full)).joints).toEqual(placeFigure(figOf('suit', 0.2, base)).joints);
    expect(placeFigure(figOf('suit', 0.2, {})).joints).toEqual(placeFigure(figOf('suit', 0.2, { aL: [3, 0, 8], aR: [3], lL: [0], fL: [0] })).joints);
    // The scenes corrected by hand with the old posing still have their hands where they were put (the editor's
    // own files: a hand on a shoulder).
    const files = import.meta.glob('../content/world3d/windows/*.json', { eager: true, import: 'default' }) as Record<string, Scene>;
    const close = Object.values(files).find((sc) => sc.id === 'v_den_close');
    if (close) {
      const [man, woman] = close.b!.map((f) => placeFigure(f).joints);
      expect(Math.hypot(woman.handL[0] - man.shoulderR[0], woman.handL[1] - (man.shoulderR[1] + 0.03))).toBeLessThan(0.006);
    }
    const table = Object.values(files).find((sc) => sc.id === 'g_hostess_table');
    if (table) {
      const j = table.a.map((f) => placeFigure(f).joints);
      expect(Math.hypot(j[2].handL[0] - j[1].shoulderR[0], j[2].handL[1] - (j[1].shoulderR[1] + 0.03))).toBeLessThan(0.006);
    }
  });

  it('turns only what a turn should: a thigh\'s twist the shin, a shin\'s turn the foot, a foot\'s pitch the toes, a forearm\'s the hand', () => {
    const moved = (a: Fig, b: Fig, j: (typeof JOINTS)[number]): number => {
      const p = placeFigure(a).joints[j], q = placeFigure(b).joints[j];
      return Math.hypot(p[0] - q[0], p[1] - q[1]);
    };
    // (Seated so the figure is placed by its seat, not by its lowest point: nothing else moves.)
    const sit: Fig = figOf('suit', 0, { lL: [88, 0, 88], lR: [88, 0, 88], aR: [40, 0, 90] }, { seat: 0.45 });
    const withPose = (pose: Fig['pose']): Fig => ({ ...sit, pose: { ...sit.pose, ...pose } });
    // The thigh turned out: the knee stays (but for the little its joint stands off the thigh's line), the foot
    // swings out to the side.
    const twist = withPose({ lR: [88, 0, 88, 40] });
    expect(moved(sit, twist, 'kneeR')).toBeLessThan(0.01);
    expect(moved(sit, twist, 'footR')).toBeGreaterThan(0.15);
    expect(moved(sit, twist, 'footL')).toBeLessThan(1e-9);
    // The shin turned: knee and ankle stay, the toes swing.
    const turn = withPose({ lR: [88, 0, 88, 0, 40] });
    expect(moved(sit, turn, 'kneeR')).toBeLessThan(1e-9);
    expect(moved(sit, turn, 'footR')).toBeLessThan(0.01);
    expect(moved(sit, turn, 'toeR')).toBeGreaterThan(0.05);
    // The foot at its ankle: toes pointed go down; flexed, up.
    const point = withPose({ fR: [50] });
    expect(moved(sit, point, 'footR')).toBeLessThan(1e-9);
    expect(placeFigure(point).joints.toeR[1]).toBeLessThan(placeFigure(sit).joints.toeR[1] - 0.05);
    expect(placeFigure(withPose({ fR: [-30] })).joints.toeR[1]).toBeGreaterThan(placeFigure(sit).joints.toeR[1] + 0.03);
    expect(moved(sit, withPose({ fR: [0, 40] }), 'toeR')).toBeGreaterThan(0.05);
    expect(moved(sit, withPose({ fR: [0, 0, 30] }), 'footR')).toBeLessThan(1e-9);
    // The forearm bent to the side: the elbow stays, the hand goes out.
    const side = withPose({ aR: [40, 0, 90, 0, 30] });
    expect(moved(sit, side, 'elbowR')).toBeLessThan(1e-9);
    expect(moved(sit, side, 'handR')).toBeGreaterThan(0.08);
    expect(placeFigure(side).joints.handR[0]).toBeGreaterThan(placeFigure(sit).joints.handR[0]);
    // Turned about its own length, its end hardly moves.
    expect(moved(sit, withPose({ aR: [40, 0, 90, 0, 0, 60] }), 'handR')).toBeLessThan(0.03);
    expect(moved(sit, withPose({ aR: [40, 0, 90, 0, 0, 60] }), 'elbowR')).toBeLessThan(1e-9);
    // Outward is outward on both sides: the mirror image has every joint mirrored, the new numbers too.
    const odd: Fig = figOf('hostess', 0.4, { yaw: 30, tilt: 10, aL: [60, 20, 70, 15, 20, 40], aR: [20, 0, 40], lL: [70, 10, 80, 25, -20], lR: [10, 0, 5], fL: [30, 10, 5], fR: [-10] }, { seat: 0.5 });
    const mir = mirrorFig(odd);
    expect(mir.pose.aR).toEqual([60, 20, 70, 15, 20, 40]);
    expect(mir.pose.lR).toEqual([70, 10, 80, 25, -20]);
    expect(mir.pose.fR).toEqual([30, 10, 5]);
    expect(mir.pose.fL).toEqual([-10]);
    expect(mirrorFig(mir)).toEqual(odd);
    const A = placeFigure(odd).joints, B = placeFigure(mir).joints;
    for (const j of JOINTS) {
      const other = (j.endsWith('L') ? `${j.slice(0, -1)}R` : j.endsWith('R') ? `${j.slice(0, -1)}L` : j) as (typeof JOINTS)[number];
      expect(B[other][0], j).toBeCloseTo(-A[j][0], 6);
      expect(B[other][1], j).toBeCloseTo(A[j][1], 6);
    }
    expect(swapSides(odd).pose.fR).toEqual([30, 10, 5]);
    expect(swapSides(swapSides(odd))).toEqual(odd);
    expect(ok({ ...home, a: [odd, mir] })).toEqual([]);
    // In-betweens carry them.
    const half = tweenFig(sit, withPose({ lR: [88, 0, 88, 40, 20], aR: [40, 0, 90, 0, 30, 60], fR: [50, 0, 10] }), 0.5);
    expect(half.pose.lR).toEqual([88, 0, 88, 20, 10]);
    expect(half.pose.aR).toEqual([40, 0, 90, 0, 15, 30]);
    expect(half.pose.fR).toEqual([25, 0, 5]);
    expect(half.pose.aL).toBeUndefined();
  });

  it('leaves the turns a drag doesn\'t solve as they were set', () => {
    const f = figOf('suit', 0, { yaw: 90, aR: [40, 0, 60, 30, 10, 20], lR: [20, 0, 30, 15, -10], fR: [25, 5] });
    const hand = placeFigure({ ...f, pose: { ...f.pose, aR: [80, 0, 30, 30, 10, 20] } }).joints.handR;
    const got = reach(f, 'handR', hand);
    expect(reachError(got, 'handR', hand)).toBeLessThan(0.005);
    expect(got.pose.aR!.slice(3)).toEqual([30, 10, 20]);
    const foot = placeFigure({ ...f, pose: { ...f.pose, lR: [50, 0, 40, 15, -10] } }).joints.footR;
    const leg = reach(f, 'footR', foot);
    expect(reachError(leg, 'footR', foot)).toBeLessThan(0.005);
    expect(leg.pose.lR!.slice(3)).toEqual([15, -10]);
    // (A foot dragged keeps its ankle as it was set.)
    expect(leg.pose.fR).toEqual([25, 5]);
    // A limb with only its first numbers gets no more than the drag solves.
    expect(reach(figOf('suit', 0, { yaw: 90 }), 'handR', hand).pose.aR!.length).toBe(3);
    expect(reach(figOf('suit', 0, { yaw: 90, aR: [30] }), 'elbowR', [0.3, 1.2]).pose.aR!.length).toBe(2);
  });

  it('nods the head in profile and tilts it facing you, the head\'s top under the pointer; and turns it within the neck', () => {
    // In profile the drag is the nod: nothing is written for a tilt the picture can't show.
    const side = figOf('suit', 0, { yaw: 90 });
    const top = placeFigure(side).joints.head;
    const nodded = reach(side, 'head', [top[0] + 0.08, top[1] - 0.03]);
    expect(nodded.pose.nod!).toBeGreaterThan(15);
    expect('tilt' in nodded.pose).toBe(false);
    // Facing the window a sideways drag is the tilt, and the top of the head follows.
    const front = figOf('suit', 0, {});
    const t0 = placeFigure(front).joints.head;
    const target: [number, number] = [t0[0] + 0.07, t0[1] - 0.015];
    const tilted = reach(front, 'head', target);
    expect(Math.abs(tilted.pose.tilt!)).toBeGreaterThan(10);
    expect(reachError(tilted, 'head', target)).toBeLessThan(0.02);
    // Between the two, both: the head's top goes to the pointer.
    const angled = figOf('suit', 0, { yaw: 45 });
    const a0 = placeFigure(angled).joints.head;
    const both = reach(angled, 'head', [a0[0] + 0.06, a0[1] - 0.02]);
    expect(reachError(both, 'head', [a0[0] + 0.06, a0[1] - 0.02])).toBeLessThan(0.004);
    expect(Math.abs(both.pose.nod ?? 0) + Math.abs(both.pose.tilt ?? 0)).toBeGreaterThan(10);
    expect(Math.abs(both.pose.nod ?? 0)).toBeGreaterThan(1);
    expect(Math.abs(both.pose.tilt ?? 0)).toBeGreaterThan(1);
    // Out of reach it stops at the neck's limits.
    const far = reach(front, 'head', [3, 0]);
    expect(Math.abs(far.pose.tilt ?? 0)).toBeLessThanOrEqual(HEAD_RANGE[1][1]);
    expect(far.pose.nod ?? 0).toBeLessThanOrEqual(HEAD_RANGE[0][1]);
    expect(ok({ ...home, a: [far, both, tilted, nodded] })).toEqual([]);
    expect(turnHead(front, 40).pose).toEqual({ turn: 40 });
    expect(turnHead(front, 400).pose).toEqual({ turn: HEAD_TURN });
    expect(turnHead(front, -400).pose).toEqual({ turn: -HEAD_TURN });
    expect(turnHead(front, 0).pose).toEqual({});
    expect(turnHead(figOf('suit', 0, { turn: 30, nod: 5 }), 0).pose).toEqual({ turn: 0, nod: 5 });
  });

  it('stands each ring where its turn\'s axis is now, so turning it does what it looks like it will', () => {
    const n = (f: Fig, p: PartName, name: string): readonly number[] => placePart(f, p).axes.find((a) => a.step.name === name)!.n;
    const near3 = (got: readonly number[], want: readonly number[]): void => want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, 6));
    // The axes ride on the turns before them: the whole body's yaw is about the room's upright; facing right, the
    // head nods about the line toward the room.
    near3(n(figOf('suit', 0, { yaw: 70, pitch: 20 }), 'body', 'yaw'), [0, 1, 0]);
    near3(n(figOf('suit', 0, {}), 'head', 'nod'), [1, 0, 0]);
    near3(n(figOf('suit', 0, { yaw: 90 }), 'head', 'nod'), [0, 0, -1]);
    near3(n(figOf('suit', 0, {}), 'head', 'tilt'), [0, 0, 1]);
    near3(n(figOf('suit', 0, { nod: 90 }), 'head', 'tilt'), [0, -1, 0]);
    // An arm's raise is about the line through the shoulders until it's swung; swung out to the side, about the line to the front.
    near3(n(figOf('suit', 0, {}), 'armR', 'raise'), [-1, 0, 0]);
    near3(n(figOf('suit', 0, { aR: [3, 90] }), 'armR', 'raise'), [0, 0, 1]);
    for (const p of PARTS) {
      const pp = placePart(figOf('hostess', 0.3, { yaw: 35, lean: 10, aL: [60, 20, 70, 15, 20, 40], lR: [70, 10, 80, 25, -20], fR: [20, 5, 5] }, { seat: 0.45 }), p);
      expect(pp.axes.length, p).toBe(PART_STEPS[p].filter((st) => st.fixed === undefined).length);
      for (const a of pp.axes) expect(Math.hypot(a.n[0], a.n[1], a.n[2])).toBeCloseTo(1, 9);
      for (const a of pp.frame) expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(1, 9);
    }
    // Seen face on, a positive turn carries the part's end anticlockwise round a ring whose axis points at the
    // street, clockwise round one pointing away: on a figure in profile and one facing the window.
    let seen = 0;
    for (const f of [figOf('suit', 0, { yaw: 90, lL: [40, 0, 50], lR: [40, 0, 50], aL: [40, 0, 60], aR: [40, 0, 60] }, { seat: 0.6 }), figOf('suit', 0, { aL: [20, 60, 30], aR: [20, 60, 30], lL: [10, 30, 20], lR: [10, 30, 20] }, { seat: 0.9 })]) {
      for (const p of PARTS) {
        const pp = placePart(f, p);
        for (const a of pp.axes) {
          if (Math.abs(a.n[2]) < 0.92 || a.value + 12 > a.step.range[1]) continue;
          const after = placePart({ ...f, pose: poseWith(f.pose, a.step, a.value + 12) }, p);
          const ex = pp.end[0] - pp.joint[0], ey = pp.end[1] - pp.joint[1];
          const mx = after.end[0] - pp.end[0], my = after.end[1] - pp.end[1];
          if (Math.hypot(mx, my) < 0.004) continue;
          // (The joint stays; the body's own, at the hips, but for how the figure is set back on its seat.)
          expect(Math.abs(after.joint[0] - pp.joint[0]) + Math.abs(after.joint[1] - pp.joint[1]), `${p} ${a.step.name}`).toBeLessThan(p === 'body' ? 0.03 : 1e-9);
          expect(Math.sign(ex * my - ey * mx), `${p} ${a.step.name}`).toBe(Math.sign(a.n[2]));
          seen++;
        }
      }
    }
    expect(seen).toBeGreaterThan(8);
  });

  it('follows the pointer round a ring, and along one seen edge on', () => {
    const J: [number, number] = [0.5, 1];
    // A ring facing the street: a circle; anticlockwise is positive about an axis pointing at the street.
    const flat = ringPoints(J, [0, 0, 1], 0.2);
    expect(flat.length).toBe(48);
    for (const p of flat) {
      expect(Math.hypot(p.x - J[0], p.y - J[1])).toBeCloseTo(0.2, 9);
      // (The way a positive turn carries each point: square to its radius, anticlockwise.)
      expect((p.x - J[0]) * p.tx + (p.y - J[1]) * p.ty).toBeCloseTo(0, 9);
      expect((p.x - J[0]) * p.ty - (p.y - J[1]) * p.tx).toBeGreaterThan(0);
    }
    const a0 = ringAngle(J, [0, 0, 1], J[0] + 0.2, J[1])!, a1 = ringAngle(J, [0, 0, 1], J[0], J[1] + 0.2)!;
    expect((((a1 - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).toBeCloseTo(Math.PI / 2, 9);
    const b0 = ringAngle(J, [0, 0, -1], J[0] + 0.2, J[1])!, b1 = ringAngle(J, [0, 0, -1], J[0], J[1] + 0.2)!;
    expect((((b1 - b0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).toBeCloseTo((3 * Math.PI) / 2, 9);
    // Tilted, the pointer is read on the ring's own plane: a point of the ring gives its own angle, every point.
    for (const n of [[0.3, 0.4, 0.866], [-0.5, 0.2, -0.842], [0, 0.6, 0.8]] as const) {
      const [u, v] = ringBasis(n);
      expect(u[0] * n[0] + u[1] * n[1] + u[2] * n[2]).toBeCloseTo(0, 9);
      expect(v[0] * u[0] + v[1] * u[1] + v[2] * u[2]).toBeCloseTo(0, 9);
      const pts = ringPoints(J, n, 0.25);
      pts.forEach((p, i) => {
        const want = (i / pts.length) * Math.PI * 2;
        const got = ringAngle(J, n, p.x, p.y)!;
        expect(Math.cos(got - want)).toBeCloseTo(1, 3);
        // And a little further along its own way is a little more of a turn.
        const next = ringAngle(J, n, p.x + p.tx * 0.01, p.y + p.ty * 0.01)!;
        expect(Math.sin(next - got)).toBeGreaterThan(0);
      });
      const front = pts.filter((p) => p.front).length;
      expect(front).toBeGreaterThanOrEqual(23);
      expect(front).toBeLessThanOrEqual(25);
    }
    // Edge on there is no plane to read: the ring is a line, and a move along it turns it, its near side one way
    // and its far side the other; a radius of travel is a radian.
    expect(ringAngle(J, [0, 1, 0], 0.6, 1.1)).toBeNull();
    expect(ringAngle(J, [0.96, 0, 0.28], 0.6, 1.1)).toBeNull();
    const edge = ringPoints(J, [0, 1, 0], 0.2);
    for (const p of edge) {
      expect(p.y).toBeCloseTo(1, 9);
      if (Math.hypot(p.tx, p.ty) < 0.01) continue;
      expect(Math.sign(ringSlide([0, 1, 0], p.front, 0.2, p.tx, p.ty))).toBe(1);
    }
    expect(Math.abs(ringSlide([0, 1, 0], true, 0.2, 0.2, 0))).toBeCloseTo(1, 9);
    expect(ringSlide([0, 1, 0], false, 0.2, 0.2, 0)).toBeCloseTo(-ringSlide([0, 1, 0], true, 0.2, 0.2, 0), 9);
    expect(ringSlide([0, 1, 0], true, 0.2, 0, 0.5)).toBeCloseTo(0, 9);
    // A turn set from a ring stays in its joint's range, to the degree.
    const elbow = PART_STEPS.foreR.find((st) => st.name === 'elbow')!;
    expect(turned({}, elbow, 400)).toEqual({ aR: [3, 0, 155] });
    expect(turned({}, elbow, -20)).toEqual({ aR: [3, 0, 0] });
    expect(turned({}, elbow, 33.4)).toEqual({ aR: [3, 0, 33] });
    expect(turned({ aR: [3, 0, 33] }, elbow, 8)).toEqual({});
    expect(turned({ aR: [40, 0, 33] }, elbow, 8)).toEqual({ aR: [40] });
    // Every part has a name, every dot a part, and every part a bone to pick it by.
    for (const p of PARTS) expect(PART_LABEL[p]).toBeTruthy();
    for (const h of HANDLES) expect(PARTS).toContain(HANDLE_PART[h]);
    for (const [a, b] of PART_BONES) expect(JOINTS.includes(a) && JOINTS.includes(b)).toBe(true);
  });
});

describe('copying a pose over another', () => {
  const three = (): SceneDoc => {
    const d = emptyScene('x_copy', 'den');
    d.a = [figOf('suit', -0.4, { yaw: 90, aR: [60, 0, 40] }, { hold: [['R', 'glass', 90, 0.02]] }), figOf('hostess', 0.4, { yaw: -90 }, { seat: 0.42, depth: 0.5 })];
    d.aItems = [['glass', 0, 0.7]];
    addKey(d, 0);
    addKey(d, 1);
    const k = sceneKeys(d);
    (k[1].a[0] as { pose: Fig['pose'] }).pose = { yaw: 80, aR: [10, 0, 20], aL: [30, 0, 30], nod: 15 };
    (k[1].a[1] as { x: number }).x = 0.6;
    k[1].aItems = [['bottle', 0.1, 0.7]];
    (k[2].a[0] as { pose: Fig['pose'] }).pose = { yaw: 100, lean: 20 };
    setSceneKeys(d, k);
    return d;
  };

  it('replaces the next pose with the whole of this one, each pose keeping its own copy', () => {
    const d = three();
    expect(copyPose(d, 0, [1])).toEqual({ poses: 1, unmatched: 0 });
    const k = sceneKeys(d);
    expect(k[1].a).toEqual(k[0].a);
    expect(k[1].a[0]).not.toBe(k[0].a[0]);
    expect(k[1].aItems).toEqual([['glass', 0, 0.7]]);
    expect(k[1].a[1].depth).toBe(0.5);
    expect(k[1].a[0].hold).toEqual([['R', 'glass', 90, 0.02]]);
    expect(k[2].a[0].pose).toEqual({ yaw: 100, lean: 20 });
    expect(ok(d)).toEqual([]);
    // Again: nothing to do. To all: the rest.
    expect(copyPose(d, 0, [1])).toEqual({ poses: 0, unmatched: 0 });
    expect(copyPose(d, 0, [0, 1, 2, 7, -1])).toEqual({ poses: 1, unmatched: 0 });
    expect(sceneKeys(d)[2].a).toEqual(sceneKeys(d)[0].a);
    // From the previous one, seen from the pose after: the same thing the other way.
    const e = three();
    copyPose(e, 1, [2]);
    expect(sceneKeys(e)[2].a).toEqual(sceneKeys(e)[1].a);
    expect(sceneKeys(e)[2].aItems).toEqual([['bottle', 0.1, 0.7]]);
    // (A pose with nothing beside its people takes that too.)
    const k2 = sceneKeys(e);
    delete k2[1].aItems;
    setSceneKeys(e, k2);
    copyPose(e, 1, [0]);
    expect(e.aItems).toBeUndefined();
    expect(ok(e)).toEqual([]);
    expect(sceneText(JSON.parse(sceneText(e)))).toBe(sceneText(e));
  });

  it('copies one figure, or one part of it, and leaves the rest of the other pose alone', () => {
    const d = three();
    const before = clone(sceneKeys(d)[1]);
    expect(copyPose(d, 0, [1], { fig: 0 })).toEqual({ poses: 1, unmatched: 0 });
    expect(sceneKeys(d)[1].a[0]).toEqual(sceneKeys(d)[0].a[0]);
    expect(sceneKeys(d)[1].a[1]).toEqual(before.a[1]);
    expect(sceneKeys(d)[1].aItems).toEqual(before.aItems);
    // One arm carried across: its turns only (an upper arm's raise, swing and twist; not the forearm's elbow).
    const e = three();
    const was = clone(sceneKeys(e)[1].a[0]);
    expect(copyPose(e, 0, [1, 2], { fig: 0, part: 'armR' })).toEqual({ poses: 2, unmatched: 0 });
    expect(sceneKeys(e)[1].a[0].pose).toEqual({ ...was.pose, aR: [60, 0, 20] });
    expect(sceneKeys(e)[1].a[0].x).toBe(was.x);
    expect(sceneKeys(e)[2].a[0].pose).toEqual({ yaw: 100, lean: 20, aR: [60] });
    copyPose(e, 0, [1], { fig: 0, part: 'foreR' });
    expect(sceneKeys(e)[1].a[0].pose.aR).toEqual([60, 0, 40]);
    // The body's turn is its facing, not its place.
    copyPose(e, 0, [2], { fig: 0, part: 'body' });
    expect(sceneKeys(e)[2].a[0].pose.yaw).toBe(90);
    expect(sceneKeys(e)[2].a[0].pose.lean).toBe(20);
    // The head's back to nothing where this pose has none.
    copyPose(e, 0, [1], { fig: 0, part: 'head' });
    expect('nod' in sceneKeys(e)[1].a[0].pose).toBe(false);
    expect(ok(e)).toEqual([]);
  });

  it('copies what matches where poses have different numbers of figures, and says how many had no match', () => {
    const d = three();
    const k = sceneKeys(d);
    k[1].a.pop();
    setSceneKeys(d, k);
    // From the fuller pose: the figure the other hasn't is not added.
    expect(copyPose(d, 0, [1])).toEqual({ poses: 1, unmatched: 1 });
    expect(sceneKeys(d)[1].a.length).toBe(1);
    expect(sceneKeys(d)[1].a[0]).toEqual(sceneKeys(d)[0].a[0]);
    // From the lesser: the figure it hasn't is left as it was.
    const second = clone(sceneKeys(d)[2].a[1]);
    expect(copyPose(d, 1, [2])).toEqual({ poses: 1, unmatched: 1 });
    expect(sceneKeys(d)[2].a[1]).toEqual(second);
    expect(copyPose(d, 0, [1], { fig: 1 })).toEqual({ poses: 0, unmatched: 1 });
    expect(copyPose(d, 0, [1], { fig: 9 })).toEqual({ poses: 0, unmatched: 0 });
    expect(copyPose(d, 9, [1])).toEqual({ poses: 0, unmatched: 0 });
  });
});

describe('wrists and ankles, bare feet and heels', () => {
  const far = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
  /** The vertices a change of pose moves, by what each is (its shade's tag: 1 skin, 4 whites, 19 hair, 20 footwear...). */
  const movedTags = (a: Fig, b: Fig): Map<number, number> => {
    const p = posedMesh(a), q = posedMesh(b);
    const tags = new Map<number, number>();
    for (let v = 0; v < p.shade.length; v++) {
      if (Math.hypot(p.position[v * 3] - q.position[v * 3], p.position[v * 3 + 1] - q.position[v * 3 + 1], p.position[v * 3 + 2] - q.position[v * 3 + 2]) < 1e-7) continue;
      const tag = Math.floor(p.shade[v] / 100);
      tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }
    return tags;
  };

  it('leaves a hand its forearm\'s where no wrist is turned, and turns only the hand where one is', () => {
    const f = figOf('suit', 0, { aR: [20, 0, 30] }, { hold: [['R', 'glass'], ['L', 'bottle', 90]] });
    const base = placeFigure(f);
    // Nothing set, or set to nothing: exactly as it was, the held things too.
    expect(placeFigure({ ...f, pose: { ...f.pose, hR: [0, 0, 0], hL: [0] } })).toEqual(base);
    expect(posedMesh({ ...f, pose: { ...f.pose, hR: [0, 0, 0] } }).position).toEqual(posedMesh(f).position);
    // Bent toward the palm (the palm faces the thigh): the hand goes in toward the body; the wrist and all above stay.
    const bent = placeFigure({ ...f, pose: { ...f.pose, hR: [60] } });
    for (const j of ['shoulderR', 'elbowR', 'wristR', 'handL', 'wristL', 'head', 'footR'] as const) expect(far(bent.joints[j], base.joints[j]), j).toBeLessThan(1e-9);
    expect(bent.joints.handR[0]).toBeLessThan(base.joints.handR[0] - 0.02);
    expect(far(bent.joints.handR, base.joints.handR)).toBeLessThan(0.1);
    // Bent back, the other way; toward the thumb, forward (seen from the side); turned about the forearm, hardly at all.
    expect(placeFigure({ ...f, pose: { ...f.pose, hR: [-60] } }).joints.handR[0]).toBeGreaterThan(base.joints.handR[0] + 0.02);
    const side = figOf('suit', 0, { yaw: 90, aR: [20, 0, 30] });
    expect(placeFigure({ ...side, pose: { ...side.pose, hR: [0, 30] } }).joints.handR[0]).toBeGreaterThan(placeFigure(side).joints.handR[0] + 0.01);
    expect(far(placeFigure({ ...f, pose: { ...f.pose, hR: [0, 0, 80] } }).joints.handR, base.joints.handR)).toBeLessThan(0.02);
    // What the hand holds goes with the hand: where it is, and lying as it lies (a glass tips with the wrist).
    expect(far(bent.holds[0].at, bent.joints.handR)).toBeLessThan(1e-9);
    const tipped = Math.abs(((bent.holds[0].auto - base.holds[0].auto + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    expect(tipped).toBeGreaterThan(0.8);
    expect(tipped).toBeLessThan(1.5);
    expect(bent.holds[1]).toEqual(base.holds[1]);
    // A hand dragged into place leaves its wrist as it was set.
    const posedHand = figOf('suit', 0, { yaw: 90, hR: [40, 10, 20] });
    const target = placeFigure({ ...posedHand, pose: { ...posedHand.pose, aR: [80, 0, 40] } }).joints.handR;
    const got = reach(posedHand, 'handR', target);
    expect(reachError(got, 'handR', target)).toBeLessThan(0.005);
    expect(got.pose.hR).toEqual([40, 10, 20]);
    // Mirrored, the sides change places; in-betweens carry it; the turns are the hand's own part.
    const odd = figOf('hostess', 0.3, { yaw: 30, hL: [50, -20, 30], hR: [-30], aL: [60, 20, 70] }, { seat: 0.5 });
    const mir = mirrorFig(odd);
    expect(mir.pose.hR).toEqual([50, -20, 30]);
    expect(mir.pose.hL).toEqual([-30]);
    expect(mirrorFig(mir)).toEqual(odd);
    const A = placeFigure(odd).joints, B = placeFigure(mir).joints;
    for (const [l, r] of [['handL', 'handR'], ['wristL', 'wristR'], ['handR', 'handL']] as const) {
      expect(B[r][0]).toBeCloseTo(-A[l][0], 6);
      expect(B[r][1]).toBeCloseTo(A[l][1], 6);
    }
    expect(swapSides(odd).pose.hR).toEqual([50, -20, 30]);
    expect(tweenFig(f, { ...f, pose: { ...f.pose, hR: [60, 0, 40] } }, 0.5).pose.hR).toEqual([30, 0, 20]);
    expect(PART_STEPS.handR.map((st) => st.name)).toEqual(['twist', 'bend', 'side']);
    expect(placePart(odd, 'handL').axes.map((a) => a.value)).toEqual([30, 50, -20]);
    const wrist = placePart(odd, 'handL');
    expect(far(wrist.joint, A.wristL)).toBeLessThan(1e-9);
    // The checks keep a wrist and an ankle to what a joint does.
    const bad = (pose: object): string => ok({ ...home, a: [{ who: 'man', x: 0, pose }] }).join(' ');
    for (const pose of [{ hR: [80, 35, 90] }, { hL: [-80, -35, -90] }, { hR: [10] }, { fL: [70, 45, 30] }, { fR: [-45, -45, -30] }]) expect(bad(pose), JSON.stringify(pose)).toBe('');
    for (const pose of [{ hR: [81] }, { hR: [0, 36] }, { hR: [0, 0, -91] }, { hR: [0, 0, 0, 0] }, { hR: 30 }, { fL: [71] }, { fL: [-46] }, { fR: [0, 46] }, { fR: [0, 0, 31] }]) expect(bad(pose), JSON.stringify(pose)).not.toBe('');
  });

  it('turns the hand past the cuff and nothing else: a sleeve, a kimono\'s hanging sleeve and a bare forearm stay', () => {
    for (const who of ['suit', 'mama', 'robe', 'hostess', 'nude_man', 'worker', 'fatcat', { body: 'woman', outfit: 'school', hair: 'twin' }, { body: 'man', outfit: 'boss', hair: 'hat' }] as Fig['who'][]) {
      const f: Fig = { who, x: 0, pose: { aL: [40, 20, 50], aR: [40, 20, 50] } };
      const tags = movedTags(f, { ...f, pose: { ...f.pose, hR: [60, 20, 40] } });
      const n = [...tags.values()].reduce((a, b) => a + b, 0);
      // Only skin moves (a politician's white gloves are his hands), and only a hand's worth of it.
      const gloves = typeof who === 'object' && who.outfit === 'boss';
      expect([...tags.keys()].filter((t) => t !== 1 && !(gloves && t === 4)), JSON.stringify(who)).toEqual([]);
      expect(n, JSON.stringify(who)).toBeGreaterThan(20);
      expect(n, JSON.stringify(who)).toBeLessThan(260);
      // One hand only: the other side moves when its own wrist does.
      const both = movedTags(f, { ...f, pose: { ...f.pose, hR: [60, 20, 40], hL: [60, 20, 40] } });
      expect([...both.values()].reduce((a, b) => a + b, 0), JSON.stringify(who)).toBe(2 * n);
    }
    // A teen's joints are a teen's: the adult's scaled down with the template.
    const girl = placeFigure({ who: { body: 'woman', outfit: 'school', hair: 'twin' }, x: 0, pose: {} }).joints, woman = placeFigure(figOf('woman', 0, {})).joints;
    expect(girl.elbowL[1]).toBeLessThan(woman.elbowL[1] - 0.05);
    expect(girl.wristL[1]).toBeLessThan(woman.wristL[1] - 0.04);
    expect(girl.elbowL[1]).toBeGreaterThan(girl.wristL[1] + 0.15);
  });

  it('undresses to bare feet, with high heels a choice: a woman\'s, under the same rule', () => {
    const adult = { cat: 'v_love', adult: true };
    const scene = (who: unknown, more: object = {}): unknown => ({ id: 'x_feet', label: 'a test', cat: 'v_love', adult: true, a: [{ who, x: 0, pose: {} }], ...more });
    expect(ok(scene('nude_heels'))).toEqual([]);
    expect(ok(scene({ body: 'woman', outfit: 'nude_heels', hair: 'bun' }))).toEqual([]);
    for (const body of ['man', 'elder', 'child']) expect(ok(scene({ body, outfit: 'nude_heels', hair: 'short' })).length, body).toBeGreaterThan(0);
    expect(ok(scene('nude_heels', { adult: undefined })).join(' ')).toMatch(/nude outfit/);
    expect(ok(scene('nude_heels', { adult: undefined, cat: 'home' })).join(' ')).toMatch(/nude outfit/);
    expect(isBare('nude') && isBare('nude_heels')).toBe(true);
    expect(isBare('gown')).toBe(false);
    // It can only be saved where such scenes go, and no crowd can wear it.
    expect(adultOnly({ ...(scene('nude_heels', { adult: undefined }) as Scene) })).toBe(true);
    expect(sceneFileFor(scene('nude_heels'), 'content')).toHaveProperty('error');
    expect(sceneFileFor(scene('nude_heels'), 'adult')).toHaveProperty('name', 'x_feet.json');
    for (let seed = 0; seed < 200; seed++) expect(pickOutfit({ nude_heels: 50, nude: 50, plain: 1 }, seed, () => true)).toBe('plain');
    // Undressing gives bare feet, whoever it is; heels are then chosen, and unchosen.
    expect(undressed(adult, 'hostess')).toEqual({ body: 'woman', outfit: 'nude', hair: 'long' });
    expect(undressed(adult, 'nude_heels')).toBeNull();
    expect(withHeels(adult, 'nude', true)).toEqual({ body: 'woman', outfit: 'nude_heels', hair: 'long' });
    expect(withHeels(adult, 'nude_heels', false)).toEqual({ body: 'woman', outfit: 'nude', hair: 'long' });
    expect(withHeels(adult, 'nude_man', true)).toBeNull();
    expect(withHeels(adult, 'nude_man', false)).toEqual({ body: 'man', outfit: 'nude', hair: 'short' });
    expect(withHeels(adult, 'hostess', true)).toBeNull();
    expect(withHeels({ cat: 'v_love' }, 'nude', true)).toBeNull();
    expect(castChoices(adult).outfits).toContain('nude_heels');
    expect(castChoices({ cat: 'v_love' }).outfits).not.toContain('nude_heels');
    expect(outfitsFor(adult, 'woman')).toContain('nude_heels');
    expect(outfitsFor(adult, 'man')).not.toContain('nude_heels');
    expect(outfitsFor(adult, 'man')).toContain('nude');
    // The strip club's dancer keeps her heels; nobody built in is barefoot by accident.
    const pole = SCENES.find((sc) => sc.id === 'g_cabaret_pole')!;
    expect(pole.a[0].who).toBe('nude_heels');
    for (const sc of SCENES) for (const f of [...sc.a, ...(sc.b ?? [])]) if (isBare((typeof f.who === 'string' ? CAST[f.who] : f.who).outfit)) expect(sc.adult, sc.id).toBe(true);
    // Barefoot is a bare foot (skin, no shoe), flat on the floor; in heels there is a shoe and the ankle stands higher.
    const tagsOf = (who: Fig['who']): Set<number> => new Set([...posedMesh({ who, x: 0, pose: {} }).shade].map((v) => Math.floor(v / 100)));
    expect(tagsOf('nude').has(20)).toBe(false);
    expect(tagsOf('nude_man').has(20)).toBe(false);
    expect(tagsOf('nude_heels').has(20)).toBe(true);
    for (const who of ['nude', 'nude_man', 'nude_heels'] as const) for (const t of tagsOf(who)) expect(who === 'nude_man' ? [1, 19, 20, 21] : [1, 15, 19, 20, 21], `${who} ${t}`).toContain(t);
    const bare = placeFigure(figOf('nude', 0, {})), heeled = placeFigure(figOf('nude_heels', 0, {}));
    expect(bare.box[1]).toBeCloseTo(0, 6);
    expect(heeled.box[1]).toBeCloseTo(0, 6);
    // (The same woman, the same height: the heel is under a raised ankle, not under the whole of her.)
    expect(heeled.box[3]).toBeCloseTo(bare.box[3], 2);
  });

  it('points, flexes and turns a foot at its ankle, kneeling and lying too, and stands it as before where none is set', () => {
    const kneel = figOf('nude', 0, { yaw: 90, lL: [6, 0, 96], lR: [6, 0, 96] });
    const lying = figOf('nude_man', 0, { yaw: 90, pitch: -90 }, { floor: 0.5 });
    for (const f of [kneel, lying, figOf('nude_heels', 0, { yaw: 90 })]) {
      const base = placeFigure(f);
      expect(placeFigure({ ...f, pose: { ...f.pose, fL: [0, 0, 0], fR: [0] } }).joints).toEqual(base.joints);
      const point = placePart({ ...f, pose: { ...f.pose, fR: [50] } }, 'footR'), rest = placePart(f, 'footR');
      // The toes go round the ankle: the foot's length kept, its direction turned by what was asked (in profile, in the picture).
      const len = (p: typeof rest): number => far(p.end, p.joint);
      expect(len(point)).toBeCloseTo(len(rest), 2);
      const ang = (p: typeof rest): number => Math.atan2(p.end[1] - p.joint[1], p.end[0] - p.joint[0]);
      const turnedBy = Math.abs(((ang(point) - ang(rest) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      expect((turnedBy * 180) / Math.PI).toBeCloseTo(50, 0);
      const flex = placePart({ ...f, pose: { ...f.pose, fR: [-30] } }, 'footR');
      expect(Math.sign(((ang(flex) - ang(rest) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)).toBe(-Math.sign(((ang(point) - ang(rest) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI));
      // Turned out, the toes swing toward or away from the eye: the foot's line in the picture shortens.
      expect(len(placePart({ ...f, pose: { ...f.pose, fR: [0, 45] } }, 'footR'))).toBeLessThan(len(rest) - 0.02);
      expect(ok({ id: 'x_ankle', label: 'a test', cat: 'v_love', adult: true, a: [{ ...f, pose: { ...f.pose, fR: [50, 20, -10], fL: [-30] } }] })).toEqual([]);
    }
    // Kneeling with the toes pointed, the instep lies along the floor: the toes no lower than the knee rests.
    const k = placeFigure({ ...kneel, pose: { ...kneel.pose, fL: [60], fR: [60] } });
    expect(k.joints.toeR[1]).toBeLessThan(k.joints.footR[1] + 0.06);
    expect(k.box[1]).toBeCloseTo(0, 6);
  });
});

describe("an edition's own version of a built-in scene", () => {
  it('takes the built-in scene\'s place in that edition only, when it is marked adult', () => {
    const at = SCENES.findIndex((s) => !s.adult && s.cat === 'home');
    const built = SCENES[at];
    const mine = { ...built, label: 'the edition\'s version', adult: true };
    const warn = console.warn;
    const said: string[] = [];
    console.warn = (m: string) => void said.push(m);
    try {
      const got = allScenes('uncensored', [mine], []);
      expect(got.length).toBe(SCENES.length);
      expect(got[at].label).toBe('the edition\'s version');
      // It wins over the repository's edited copy there; the standard edition keeps that copy, the demo too.
      const repo = { ...built, label: 'edited in the repository' };
      expect(allScenes('uncensored', [mine], [repo])[at].label).toBe('the edition\'s version');
      expect(allScenes('standard', [], [repo])[at].label).toBe('edited in the repository');
      expect(allScenes('demo', [mine], [])[at]).toBe(built);
      expect(said).toEqual([]);
      // Not marked adult, or a second file of the id: the id is taken, as before.
      expect(allScenes('uncensored', [{ ...built, label: 'x' }], [])[at]).toBe(built);
      expect(allScenes('uncensored', [mine, { ...mine, label: 'again' }], [])[at].label).toBe('the edition\'s version');
      expect(said.filter((m) => /that id is taken/.test(m)).length).toBe(2);
    } finally {
      console.warn = warn;
    }
  });
});
