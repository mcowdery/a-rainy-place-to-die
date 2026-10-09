import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DWELL, Investigator, Stance } from '../src/poc3d/district/investigate';

const bird = { id: 'bird', radius: 1, lines: ['one', 'two'], at: (o: THREE.Vector3) => o.set(0, 30, 40) };
const eye = new THREE.Vector3(0, 1.7, 0);
const at = new THREE.Vector3(0, 28.3, 40).normalize();

describe('Investigator', () => {
  it('says a line only after the view settles on a thing, and not when it is not looking', () => {
    const said: string[] = [];
    const inv = new Investigator((t) => said.push(t));
    inv.add(bird);
    inv.update(false, eye, at, 5);
    expect(said).toEqual([]);
    for (let t = 0; t < DWELL - 0.1; t += 0.1) inv.update(true, eye, at, 0.1);
    expect(said).toEqual([]);
    inv.update(true, eye, at, 0.3);
    expect(said).toEqual(['one']);
    inv.update(true, eye, at, 0.5);
    expect(said).toEqual(['one']);
  });
  it('ignores things off the view and things behind a wall', () => {
    const said: string[] = [];
    const inv = new Investigator((t) => said.push(t));
    inv.add(bird);
    inv.update(true, eye, new THREE.Vector3(1, 0, 0), 2);
    expect(said).toEqual([]);
    inv.update(true, eye, at, 0.1, () => true);
    inv.update(true, eye, at, 2, () => true);
    expect(said).toEqual([]);
  });
});

describe('Investigator sources and hands', () => {
  it('finds things from a source, speaks for others, and uses the hand only when near', () => {
    const said: [string, string | null][] = [];
    const inv = new Investigator((t, _id, who) => said.push([t, who]));
    const person = { id: 'p', radius: 0.5, label: 'person', lines: ['hm'], interact: { label: 'Talk', lines: [{ who: 'Stranger', text: 'Go away.' }], range: 2.5 }, at: (o: THREE.Vector3) => o.set(0, 1.7, 2) };
    inv.source(() => [person]);
    const ahead = new THREE.Vector3(0, 0, 1);
    const st = inv.update(true, eye, ahead, 0.1);
    expect(st.target?.id).toBe('p');
    expect(st.canUse).toBe(true);
    expect(inv.use()).toBe(true);
    expect(said).toEqual([['Go away.', 'Stranger']]);
    person.at = (o: THREE.Vector3) => o.set(0, 1.7, 10);
    expect(inv.update(true, eye, ahead, 0.1).canUse).toBe(false);
    expect(inv.use()).toBe(false);
  });
});

describe('Stance', () => {
  it('is a fight while any threat stands', () => {
    const s = new Stance();
    s.threat('a', true);
    s.threat('b', true);
    s.threat('a', false);
    expect(s.fight).toBe(true);
    s.threat('b', false);
    expect(s.fight).toBe(false);
  });
});
