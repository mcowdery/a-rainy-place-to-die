import * as THREE from 'three';
import { KIND, lin, MeshBuilder } from '../../real/meshBuilder';
import { Character, CHARACTERS } from '../../models/characters';
import { FpMode } from '../fpMode';
import { buildShotgun, SHOTGUN_KINDS } from '../../models/shotgun';
import { buildBosozoku } from '../../models/bosozoku';
import type { Bike } from '../../models/bikeKit';
import { buildCruiser, CRUISER_LOOKS } from '../../models/cruiser';
import { buildSportBike, SPORT_LOOKS } from '../../models/sportbike';
import { buildHelmet, HELMET_LOOKS } from '../../models/helmet';
import { buildKatana } from '../../models/katana';
import { buildBat } from '../../models/bat';
import { FRONT_VIEW, startRoom } from '../shell';

/**
 * Mack's gear (models-mack.html): Mack and his outfits, his guns (shotguns), the katana on its rack and the baseball bat,
 * his three motorcycles (the bōsōzoku, the cruiser, the sports bike, each in its colours) and the helmets, on a pavement
 * with first person as Mack (V, or `?fp=1`: click to capture the mouse, E by a bike gets on it). Weapons and bikes share
 * a room because first person draws the one and rides the other.
 * The others made with MakeHuman (the salaryman, the maid, Julie) have moved to the MakeHuman test page (humans.html).
 */
startRoom({
  title: "Mack's gear",
  groups: ['Characters', 'Weapons', 'Bikes'],
  camera: { pos: [12, 5, 56], target: [12, 1, 38] },
  overview: { at: [8, 1, 38], size: 22, view: [0.1, 0.5, 1] },
  setup(ctx) {
    const { scene, camera, controls, renderer, genRoot, genItems, label, city } = ctx;
    ctx.floor((floor) => {
      floor.kind = KIND.lot;
      floor.color = lin(0x5e5e5c);
      floor.box(0, 6, -0.2, 0, 80, 80, KIND.lot);
      floor.kind = KIND.plain;
      floor.color = lin(0x8a867e);
      floor.box(9, 20, 0, 0.15, 38, 28, KIND.sidewalk);
    });
    // The cast as modelled characters (models/characters.ts), on a pad of their own past the mob, idling.
    const CAST_Z = 38;
    const castPad = new MeshBuilder();
    castPad.kind = KIND.plain;
    castPad.color = lin(0x8a867e);
    castPad.box(0, CAST_Z, 0, 0.15, Math.max(6, CHARACTERS.length * 2.2 + 2), 5, KIND.sidewalk);
    genRoot.new.add(new THREE.Mesh(castPad.build()!, city));
    const charEnv = ctx.env();
    const cast: Character[] = [];
    CHARACTERS.forEach((name, i) => {
      const x = (i - (CHARACTERS.length - 1) / 2) * 2.2;
      // Mack and his outfits stand here, each where it always did. The others made with MakeHuman (the salaryman, the
      // maid, Julie) have moved to the MakeHuman test page (humans.html, src/poc3d/humans/).
      if (!name.startsWith('mack')) return;
      label('new', name, x, 2.15, CAST_Z);
      genItems.new.push({ name, group: 'Characters', at: new THREE.Vector3(x, 1.1, CAST_Z), size: 2.2, view: new THREE.Vector3(0.25, 0.2, 1).normalize() });
      genItems.new.push({ name: `${name}: face`, group: 'Characters', at: new THREE.Vector3(x, 1.55, CAST_Z), size: 0.45, view: new THREE.Vector3(0.2, 0.05, 1).normalize() });
      Character.load(name, i)
        .then((c) => {
          c.root.position.set(x, 0.15, CAST_Z);
          genRoot.new.add(c.root);
          cast.push(c);
        })
        .catch((e: unknown) => console.warn(`character ${name}:`, e));
    });
    if (CHARACTERS.length > 0) genItems.new.push({ name: 'the cast', group: 'Characters', at: new THREE.Vector3(0, 1, CAST_Z), size: 3 + CHARACTERS.length, view: FRONT_VIEW });
    // Mack's shotguns (models/shotgun.ts), side by side on a stand at the end of the cast's pad.
    {
      const gx = Math.max(6, CHARACTERS.length * 2.2 + 2) / 2 + 1.4;
      const stand = new MeshBuilder();
      stand.kind = KIND.plain;
      stand.color = lin(0x2c2a28);
      stand.box(gx, CAST_Z, 0.15, 0.95, 1.2, 0.8, KIND.plain);
      genRoot.new.add(new THREE.Mesh(stand.build()!, city));
      SHOTGUN_KINDS.forEach((k, i) => {
        const gun = buildShotgun(k, charEnv);
        gun.root.userData.shotgun = k;
        // Lying on its right side across the stand, muzzle to the left, as on a gun dealer's table.
        gun.root.rotation.set(0, -Math.PI / 2, Math.PI / 2);
        gun.root.position.set(gx + 0.06, 1.2, CAST_Z - 0.18 + i * 0.36);
        genRoot.new.add(gun.root);
        label('new', `shotgun: ${k}`, gx, 1.42, CAST_Z - 0.18 + i * 0.36);
        genItems.new.push({ name: `shotgun: ${k}`, group: 'Weapons', at: new THREE.Vector3(gx + 0.1, 1.2, CAST_Z - 0.18 + i * 0.36), size: 0.42, view: new THREE.Vector3(0.05, 0.75, 0.66).normalize() });
      });
    }
    // Bikes you can ride in first person (E by one).
    const rideable: Bike[] = [];
    // Mack's bike (models/bosozoku.ts), on the pad beyond the guns, turned three-quarters to the front.
    {
      const bx = Math.max(6, CHARACTERS.length * 2.2 + 2) / 2 + 4.2;
      const bike = buildBosozoku(charEnv);
      bike.root.position.set(bx, 0.15, CAST_Z);
      bike.root.rotation.y = -0.6;
      bike.steer.quaternion.setFromAxisAngle(bike.steerAxis, 0.25);
      genRoot.new.add(bike.root);
      rideable.push(bike);
      label('new', 'bike: Seika Shiden 400F (bōsōzoku)', bx, 2.0, CAST_Z);
      genItems.new.push({ name: 'bike: bōsōzoku', group: 'Bikes', at: new THREE.Vector3(bx, 0.8, CAST_Z), size: 1.6, view: new THREE.Vector3(-0.6, 0.25, 0.75).normalize() });
    }
    // The sports bike (models/sportbike.ts) at the end, in each of its colours.
    (Object.keys(SPORT_LOOKS) as (keyof typeof SPORT_LOOKS)[]).forEach((name, i) => {
      const bx = Math.max(6, CHARACTERS.length * 2.2 + 2) / 2 + 12.0 + i * 2.6;
      const bike = buildSportBike(charEnv, SPORT_LOOKS[name]);
      bike.root.position.set(bx, 0.15, CAST_Z);
      bike.root.rotation.y = -0.6;
      bike.steer.quaternion.setFromAxisAngle(bike.steerAxis, 0.25);
      genRoot.new.add(bike.root);
      rideable.push(bike);
      label('new', `bike: Ōmi Hayate 900RR (${name})`, bx, 1.6, CAST_Z);
      genItems.new.push({ name: `bike: sports (${name})`, group: 'Bikes', at: new THREE.Vector3(bx, 0.7, CAST_Z), size: 1.6, view: new THREE.Vector3(-0.6, 0.25, 0.75).normalize() });
    });
    // The helmets (models/helmet.ts), on the stand by the guns, one of each look.
    (Object.keys(HELMET_LOOKS) as (keyof typeof HELMET_LOOKS)[]).forEach((name, i) => {
      const helmet = buildHelmet(charEnv, HELMET_LOOKS[name]);
      helmet.position.set(Math.max(6, CHARACTERS.length * 2.2 + 2) / 2 + 1.4 - 0.2 + i * 0.4, 1.32, CAST_Z + 0.75);
      helmet.rotation.y = -0.5;
      genRoot.new.add(helmet);
      label('new', `helmet: ${name}`, helmet.position.x, 1.62 + i * 0.08, helmet.position.z);
      genItems.new.push({ name: `helmet: ${name}`, group: 'Bikes', at: helmet.position.clone(), size: 0.5, view: new THREE.Vector3(0.4, 0.2, 1).normalize() });
    });
    // Mack's katana (models/katana.ts) on a black lacquered rack in front of the guns: the drawn sword above, its
    // saya below, edge up as swords are shown, the handles to the left.
    {
      const kx = Math.max(6, CHARACTERS.length * 2.2 + 2) / 2 + 1.6;
      const kz = CAST_Z + 1.7;
      const rack = new THREE.Group();
      rack.position.set(kx, 0.15, kz);
      genRoot.new.add(rack);
      const black = new THREE.MeshPhysicalMaterial({ color: 0x080708, roughness: 0.25, clearcoat: 1, envMap: charEnv, envMapIntensity: 0.6 });
      const box = (w: number, h: number, d: number, x: number, y: number, z: number): void => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), black);
        m.position.set(x, y, z);
        m.castShadow = true;
        rack.add(m);
      };
      box(1.1, 0.04, 0.26, 0, 0.02, 0);
      for (const x of [-0.3, 0.3]) {
        box(0.05, 0.62, 0.07, x, 0.33, 0);
        for (const y of [0.42, 0.62]) box(0.05, 0.03, 0.14, x, y, 0.035);
      }
      const k = buildKatana(charEnv);
      // The sword's frame: -z along the blade; turned so the blade runs to +x, edge up.
      k.root.rotation.set(0, -Math.PI / 2, Math.PI);
      k.root.position.set(-0.08, 0, 0.06);
      rack.add(k.root);
      // Sword on the top arms, saya on the lower (the frame's y is down here, edge up).
      k.sword.position.y = -0.65;
      k.saya.position.y = -0.45;
      label('new', 'katana', kx, 1.0, kz);
      genItems.new.push({ name: 'katana', group: 'Weapons', at: new THREE.Vector3(kx, 0.72, kz), size: 1.1, view: new THREE.Vector3(0, 0.15, 1).normalize() });
      genItems.new.push({ name: 'katana: tsuba and tsuka', group: 'Weapons', at: new THREE.Vector3(kx - 0.35, 0.8, kz + 0.06), size: 0.35, view: new THREE.Vector3(0.2, 0.15, 1).normalize() });
    }
    // The baseball bat (models/bat.ts), under review: on two pegs beside the katana's rack, the barrel to the right.
    {
      const bx = Math.max(6, CHARACTERS.length * 2.2 + 2) / 2 + 3.0;
      const bz = CAST_Z + 1.7;
      const pegs = new THREE.Group();
      pegs.position.set(bx, 0.15, bz);
      genRoot.new.add(pegs);
      const black = new THREE.MeshPhysicalMaterial({ color: 0x080708, roughness: 0.25, clearcoat: 1, envMap: charEnv, envMapIntensity: 0.6 });
      for (const [w, h, d, x, y] of [[1.0, 0.04, 0.22, 0, 0.02], [0.05, 0.5, 0.07, -0.28, 0.27], [0.05, 0.5, 0.07, 0.24, 0.27]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), black);
        m.position.set(x, y, 0);
        m.castShadow = true;
        pegs.add(m);
      }
      const bat = buildBat(charEnv);
      // The bat's frame: -z along the barrel; turned so it runs to +x, its maker's mark up and to the front.
      bat.root.rotation.set(0, -Math.PI / 2, 0.6, 'YXZ');
      bat.root.position.set(-0.2, 0.555, 0);
      pegs.add(bat.root);
      label('new', 'baseball bat', bx, 1.0, bz);
      genItems.new.push({ name: 'baseball bat', group: 'Weapons', at: new THREE.Vector3(bx + 0.1, 0.72, bz), size: 1.1, view: new THREE.Vector3(0, 0.2, 1).normalize() });
      genItems.new.push({ name: 'baseball bat: the mark', group: 'Weapons', at: new THREE.Vector3(bx + 0.14, 0.72, bz), size: 0.3, view: new THREE.Vector3(0, 0.5, 1).normalize() });
    }
    // The cruiser (models/cruiser.ts) beside it, in each of its colours.
    (Object.keys(CRUISER_LOOKS) as (keyof typeof CRUISER_LOOKS)[]).forEach((name, i) => {
      const bx = Math.max(6, CHARACTERS.length * 2.2 + 2) / 2 + 6.8 + i * 2.6;
      const bike = buildCruiser(charEnv, CRUISER_LOOKS[name]);
      bike.root.position.set(bx, 0.15, CAST_Z);
      bike.root.rotation.y = -0.6;
      bike.steer.quaternion.setFromAxisAngle(bike.steerAxis, 0.25);
      genRoot.new.add(bike.root);
      rideable.push(bike);
      label('new', `bike: Kaiun Raijin 1600 (${name})`, bx, 1.7, CAST_Z);
      genItems.new.push({ name: `bike: cruiser (${name})`, group: 'Bikes', at: new THREE.Vector3(bx, 0.7, CAST_Z), size: 1.7, view: new THREE.Vector3(-0.6, 0.25, 0.75).normalize() });
    });
    // First person as Mack (models/firstPerson.ts), on the cast's pad facing them. The floors: the cast pad and
    // the people's pavement are 0.15 m up.
    const castHalfW = Math.max(6, CHARACTERS.length * 2.2 + 2) / 2;
    const fpFloor = (x: number, z: number): number =>
      (Math.abs(x) < castHalfW && Math.abs(z - CAST_Z) < 2.5) || (x > -10 && x < 28 && z > 6 && z < 34) ? 0.15 : 0;
    const fp = new FpMode(scene, camera, renderer.domElement, controls, charEnv, fpFloor);
    fp.bikes = rideable;
    const enterFp = (): void => void fp.enter(0.6, CAST_Z + 2.2, 0);
    (window as unknown as { __fp: unknown }).__fp = fp.script();
    // For scripted shots of a model on its own: three, the showroom's scene, the gun builder and the characters' light.
    (window as unknown as { __lab: unknown }).__lab = { THREE, scene, buildShotgun, buildBosozoku, buildCruiser, CRUISER_LOOKS, buildSportBike, SPORT_LOOKS, buildHelmet, HELMET_LOOKS, buildKatana, buildBat, env: charEnv };
    if (new URLSearchParams(location.search).has('fp')) enterFp();
    ctx.setFirstPerson(fp, enterFp);
    ctx.onFrame((dt) => {
      for (const c of cast) c.update(dt);
    });
    ctx.panelExtra(({ section, button }) => {
      section('People');
      button('→ the mob showroom (mob.html)', false, () => (location.href = 'mob.html'));
      button('→ the MakeHuman test: salaryman, maid, the crowd (humans.html)', false, () => (location.href = 'humans.html'));
      section('Fighting');
      button('→ the fight test (fight.html)', false, () => (location.href = 'fight.html'));
      section('First person');
      button(fp.active ? 'back to orbiting (V)' : 'Mack, first person (V)', fp.active, () => (fp.active ? fp.exit() : enterFp(), setTimeout(ctx.renderPanel, 50)));
    });
  },
});
