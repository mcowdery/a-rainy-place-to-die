import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { clipPace, relaxedHand, retarget, rigFrom } from '../src/poc3d/models/characterAnims';

/**
 * A small skeleton: a root, a pelvis, a spine, one arm and one leg. `arm` is the way the upper arm points at rest,
 * `roll` turns every bone about its own length (the two skeletons' bone rolls differ), `size` scales it.
 */
function skeleton(arm: THREE.Vector3, roll: number, size: number, thigh = 0.45): THREE.Object3D {
  const bones = new Map<string, THREE.Object3D>();
  const add = (name: string, parent: string | null, at: [number, number, number], q?: THREE.Quaternion): void => {
    const b = new THREE.Object3D();
    b.name = name;
    b.position.set(at[0] * size, at[1] * size, at[2] * size);
    if (q) b.quaternion.copy(q);
    if (parent) bones.get(parent)!.add(b);
    bones.set(name, b);
  };
  const twist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll);
  add('Root', null, [0, 0, 0]);
  add('pelvis', 'Root', [0, 1, 0], twist);
  add('spine_01', 'pelvis', [0, 0.2, 0]);
  // The arm's bones run along their own y, as a rig's do: the upper arm's rest turns y to `arm`.
  const armQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), arm.clone().normalize()).multiply(twist);
  add('upperarm_l', 'spine_01', [0.2, 0.3, 0], new THREE.Quaternion().copy(twist).invert().multiply(armQ));
  add('lowerarm_l', 'upperarm_l', [0, 0.3, 0]);
  add('hand_l', 'lowerarm_l', [0, 0.3, 0]);
  const down = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI).multiply(twist);
  add('thigh_l', 'pelvis', [0.1, 0, 0], new THREE.Quaternion().copy(twist).invert().multiply(down));
  // (the leg is 0.9 long; `thigh` is how much of it is above the knee)
  add('calf_l', 'thigh_l', [0, thigh, 0]);
  add('foot_l', 'calf_l', [0, 0.9 - thigh, 0]);
  const root = bones.get('Root')!;
  root.updateMatrixWorld(true);
  return root;
}

const rig = (root: THREE.Object3D) => rigFrom(root, (b) => b.matrixWorld);
const find = (root: THREE.Object3D, name: string): THREE.Object3D => root.getObjectByName(name)!;
const pointing = (root: THREE.Object3D, from: string, to: string): THREE.Vector3 =>
  find(root, to).getWorldPosition(new THREE.Vector3()).sub(find(root, from).getWorldPosition(new THREE.Vector3())).normalize();

/** Poses `root` as `clip` has it at `t`. */
function pose(root: THREE.Object3D, clip: THREE.AnimationClip, t: number): void {
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  // Held at its end, not wrapped round to its start.
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(t);
  root.updateMatrixWorld(true);
}

/** A clip on the mannequin: the upper arm swings about the world's z, the thigh about x, the pelvis drops and the root walks off. */
function clipOn(root: THREE.Object3D): THREE.AnimationClip {
  const times = [0, 1];
  const turned = (name: string, axis: THREE.Vector3, angle: number): THREE.QuaternionKeyframeTrack => {
    const b = find(root, name);
    const parent = b.parent!.getWorldQuaternion(new THREE.Quaternion());
    // A turn in the world, written as the bone's local rotation.
    const world = new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(b.getWorldQuaternion(new THREE.Quaternion()));
    const local = parent.invert().multiply(world);
    return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, [...b.quaternion.toArray(), ...local.toArray()]);
  };
  const p = find(root, 'pelvis').position;
  return new THREE.AnimationClip('test', 1, [
    turned('upperarm_l', new THREE.Vector3(0, 0, 1), 0.9),
    turned('thigh_l', new THREE.Vector3(1, 0, 0), -0.6),
    new THREE.VectorKeyframeTrack('pelvis.position', times, [p.x, p.y, p.z, p.x, p.y - 0.2, p.z]),
    new THREE.VectorKeyframeTrack('Root.position', times, [0, 0, 0, 0, 0, 1]),
  ]);
}

describe('a hand at ease', () => {
  // A left hand at the origin, its fingers along +y and fanned out across x, each with a slight curl towards -z (the
  // palm's side), as a model's rest pose has them.
  const hand = new THREE.Object3D();
  hand.name = 'hand_l';
  const fan: Record<string, number> = { index: 0.03, middle: 0.01, ring: -0.01, pinky: -0.03 };
  for (const [f, x] of Object.entries(fan)) {
    let parent: THREE.Object3D = hand;
    for (let n = 1; n <= 3; n++) {
      const b = new THREE.Object3D();
      b.name = `${f}_0${n}_l`;
      // The knuckle out along the hand; each joint after it 3 cm on, the finger leaning 12 degrees out to its side.
      if (n === 1) {
        b.position.set(x, 0.1, 0);
        b.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -x * 7).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.1));
      } else {
        b.position.set(0, 0.03, 0);
        b.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.1);
      }
      parent.add(b);
      parent = b;
    }
  }
  hand.updateMatrixWorld(true);
  const tip = (f: string): THREE.Vector3 => hand.getObjectByName(`${f}_03_l`)!.getWorldPosition(new THREE.Vector3());

  it('brings the fingers together and curls them towards the palm', () => {
    const before = { spread: tip('index').distanceTo(tip('pinky')), z: tip('middle').z, little: tip('pinky').z };
    const pose = relaxedHand(rigFrom(hand, (b) => b.matrixWorld));
    expect(pose.size).toBe(12);
    for (const [name, q] of pose) hand.getObjectByName(name)!.quaternion.copy(q);
    hand.updateMatrixWorld(true);
    expect(tip('index').distanceTo(tip('pinky'))).toBeLessThan(before.spread * 0.9);
    // Towards the side the rest pose already leaned to, and the little finger further than the middle one.
    expect(tip('middle').z).toBeLessThan(before.z - 0.005);
    expect(tip('pinky').z - before.little).toBeLessThan(tip('middle').z - before.z);
  });
});

describe('retargeting a library clip', () => {
  const T_POSE = new THREE.Vector3(1, 0, 0);
  const A_POSE = new THREE.Vector3(1, -1, 0);

  it('leaves a clip as it was on the skeleton it was made for', () => {
    const src = skeleton(T_POSE, 0, 1);
    const dst = skeleton(T_POSE, 0, 1);
    const clip = clipOn(src);
    const fitted = retarget(clip, rig(src), rig(dst));
    pose(src, clip, 1);
    pose(dst, fitted, 1);
    for (const [a, b] of [['upperarm_l', 'lowerarm_l'], ['lowerarm_l', 'hand_l'], ['thigh_l', 'calf_l']]) {
      expect(pointing(dst, a, b).distanceTo(pointing(src, a, b))).toBeLessThan(1e-4);
    }
    expect(find(dst, 'hand_l').getWorldPosition(new THREE.Vector3()).distanceTo(find(src, 'hand_l').getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-4);
  });

  it('puts a different skeleton in the same pose: another rest pose, other bone rolls, another size', () => {
    const src = skeleton(T_POSE, 0, 1);
    const dst = skeleton(A_POSE, 0.7, 1.2);
    const clip = clipOn(src);
    const fitted = retarget(clip, rig(src), rig(dst));
    for (const t of [0, 0.5, 1]) {
      pose(src, clip, t);
      pose(dst, fitted, t);
      for (const [a, b] of [['upperarm_l', 'lowerarm_l'], ['lowerarm_l', 'hand_l'], ['thigh_l', 'calf_l'], ['calf_l', 'foot_l']]) {
        expect(pointing(dst, a, b).distanceTo(pointing(src, a, b))).toBeLessThan(1e-3);
      }
    }
  });

  it('scales the travel of the root and the pelvis by leg length', () => {
    const src = skeleton(T_POSE, 0, 1);
    const dst = skeleton(A_POSE, 0.7, 1.2);
    const clip = clipOn(src);
    const fitted = retarget(clip, rig(src), rig(dst));
    pose(dst, fitted, 1);
    const pelvis = find(dst, 'pelvis').getWorldPosition(new THREE.Vector3());
    // The root went 1 m forward and the pelvis 0.2 m down on the mannequin; 1.2 times that on a figure 1.2 times the size.
    expect(pelvis.z).toBeCloseTo(1.2, 3);
    expect(pelvis.y).toBeCloseTo(1.2 - 0.24, 3);
    expect(pelvis.x).toBeCloseTo(0, 3);
  });

  it('keeps the feet on the floor on legs of other proportions', () => {
    // A crouch on the mannequin: the thigh swung a radian forward, the shin kept upright, the pelvis lowered so the
    // foot stays where it was. The same angles on a long thigh and a short shin (the same leg length, so nothing is
    // scaled) reach less far down: without planting, that foot would hang 17 cm off the floor.
    const src = skeleton(T_POSE, 0, 1);
    const dst = skeleton(T_POSE, 0, 1, 0.6);
    const times = [0, 1];
    const pelvisW = find(src, 'pelvis').getWorldQuaternion(new THREE.Quaternion());
    const thighRest = find(src, 'thigh_l').getWorldQuaternion(new THREE.Quaternion());
    const calfRest = find(src, 'calf_l').getWorldQuaternion(new THREE.Quaternion());
    const thighNow = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -1).multiply(thighRest);
    const local = (parent: THREE.Quaternion, world: THREE.Quaternion) => parent.clone().invert().multiply(world).toArray();
    const drop = 0.45 * (1 - Math.cos(1));
    const p = find(src, 'pelvis').position;
    const crouch = new THREE.AnimationClip('crouch', 1, [
      new THREE.QuaternionKeyframeTrack('thigh_l.quaternion', times, [...local(pelvisW, thighRest), ...local(pelvisW, thighNow)]),
      new THREE.QuaternionKeyframeTrack('calf_l.quaternion', times, [...local(thighRest, calfRest), ...local(thighNow, calfRest)]),
      new THREE.VectorKeyframeTrack('pelvis.position', times, [p.x, p.y, p.z, p.x, p.y - drop, p.z]),
    ]);
    const footY = (root: THREE.Object3D) => find(root, 'foot_l').getWorldPosition(new THREE.Vector3()).y;
    pose(src, crouch, 1);
    expect(footY(src)).toBeCloseTo(0.1, 4);
    const fitted = retarget(crouch, rig(src), rig(dst));
    // (the foot at the mannequin's height all through: halfway, this clip's straight-line drop has it 5 cm down)
    for (const t of [0, 0.25, 0.5, 1]) {
      pose(src, crouch, t);
      pose(dst, fitted, t);
      expect(Math.abs(footY(dst) - footY(src))).toBeLessThan(0.002);
    }
    // and the knee still bends as the mannequin's does
    expect(pointing(dst, 'thigh_l', 'calf_l').distanceTo(pointing(src, 'thigh_l', 'calf_l'))).toBeLessThan(1e-3);
  });

  it('says how fast a walk covers the ground, by the length of the leg', () => {
    const src = skeleton(T_POSE, 0, 1);
    // A foot that goes back under the body at 1.5 m/s for two thirds of a second, then comes forward in a third.
    const thigh = find(src, 'thigh_l');
    const times: number[] = [];
    const values: number[] = [];
    const parent = thigh.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    const rest = thigh.getWorldQuaternion(new THREE.Quaternion());
    for (let f = 0; f <= 30; f++) {
      const t = f / 30;
      const z = t < 2 / 3 ? 0.5 - 1.5 * t : -0.5 + 3 * (t - 2 / 3);
      // The leg is 0.9 long, hanging: swung about x so the foot is z ahead.
      const swing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.asin(z / 0.9));
      times.push(t);
      values.push(...parent.clone().multiply(swing).multiply(rest).toArray());
    }
    const walk = new THREE.AnimationClip('walk', 1, [new THREE.QuaternionKeyframeTrack('thigh_l.quaternion', times, values)]);
    expect(clipPace(retarget(walk, rig(src), rig(skeleton(T_POSE, 0, 1))))).toBeCloseTo(1.5, 1);
    expect(clipPace(retarget(walk, rig(src), rig(skeleton(A_POSE, 0.7, 1.2))))).toBeCloseTo(1.8, 1);
    expect(clipPace(retarget(clipOn(src), rig(src), rig(src)))).toBe(0);
  });

  it('keeps each rotation track on one side, so frames blend the short way', () => {
    const src = skeleton(T_POSE, 0, 1);
    const fitted = retarget(clipOn(src), rig(src), rig(skeleton(A_POSE, 0.7, 1.2)));
    for (const track of fitted.tracks) {
      if (!track.name.endsWith('.quaternion')) continue;
      const v = track.values;
      for (let i = 4; i < v.length; i += 4) expect(v[i] * v[i - 4] + v[i + 1] * v[i - 3] + v[i + 2] * v[i - 2] + v[i + 3] * v[i - 1]).toBeGreaterThanOrEqual(0);
    }
  });
});
