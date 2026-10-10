import * as THREE from 'three';
import { KIND, lin, MeshBuilder } from '../../real/meshBuilder';
import { addWheel } from '../../models/vehicles';
import { AdAtlas, adMaterial } from '../../real/adAtlas';
import { trainModel } from '../../real/rail';
import { carGlass, carSet2 } from '../../real/trainCar';
import { buildBus2 } from '../../real/busModel';
import { airliner2, AIRLINES } from '../../real/airliner';
import { airliner } from '../../real/airport';
import { BUS } from '../../district/busCabin';
import { parkedBus } from '../../real/traffic';
import type { BusLine } from '../../district/traffic';
import { CAR } from '../../district/cabin';
import { TAXI_ADS } from '../../models/ads';
import { startRoom } from '../shell';

/**
 * Transit (models-transit.html): the Tōto Line train (the district's, and the new commuter car with walk-in insides and doors
 * that open, with a platform, and a subway car), the city bus (the district's and the new one) and the airliners in each
 * airline's colours. M switches between the new models and the previous ones the district still uses.
 */
startRoom({
  title: 'Transit',
  groups: ['Transit'],
  previous: true,
  camera: { pos: [34, 12, 62], target: [10, 3, 0] },
  shadow: { x: 30, z: 0, half: 60 },
  overview: { at: [30, 3, 0], size: 90, view: [0.3, 0.45, 1] },
  setup(ctx) {
    const { scene, city, cityU, genRoot, genItems, label } = ctx;
    const photoAtlas = new AdAtlas(TAXI_ADS);
    ctx.floor((floor) => {
      floor.kind = KIND.lot;
      floor.color = lin(0x5e5e5c);
      floor.box(50, 0, -0.3, -0.1, 230, 130, KIND.lot);
    });
    // The Toto Line train (three cars) on a short length of track: the district's (previous) and the new commuter car
    // (real/trainCar.ts, under review: walk-in insides, doors that open), with a platform along it; and the new car in
    // a subway line's colours beside it.
    {
      const at = new THREE.Vector3(0, 0, 0);
      const track = new MeshBuilder();
      track.kind = KIND.plain;
      for (const x of [at.x, at.x - 9]) {
        track.color = lin(0x3a3a3c);
        track.box(x, at.z, 0, 0.08, 2.6, 70, KIND.plain);
        track.color = lin(0xb0b0b4);
        for (const s of [-0.53, 0.53]) track.box(x + s, at.z, 0.08, 0.2, 0.07, 70, KIND.plain);
      }
      // A platform along the left of the new train, at its floor (0.9 m over the rail).
      track.kind = KIND.sidewalk;
      track.color = lin(0xb4b0a8);
      track.box(at.x - 4.55, at.z, 0, 1.1, 3.0, 64, KIND.sidewalk);
      track.kind = KIND.plain;
      track.color = lin(0xe8c030);
      track.box(at.x - 3.4, at.z, 1.1, 1.11, 0.3, 64, KIND.plain);
      scene.add(new THREE.Mesh(track.build()!, city));
      const old = trainModel(0x10a060, city);
      old.position.set(at.x, 0.2, at.z);
      genRoot.previous.add(old);
      label('previous', 'Toto Line train', at.x, 6, at.z);
      const mats = { city, glass: carGlass(), ads: adMaterial(cityU, photoAtlas) };
      const set = carSet2(0x10a060, mats, { dest: { jp: '学園坂', en: 'Gakuenzaka' } })();
      set.group.children.forEach((car, i) => (car.position.z = (i - 1) * (CAR.L + CAR.GAP)));
      set.group.position.set(at.x, 0.2, at.z);
      set.setScreens({ jp: '霞町', en: 'Kasumi-chō', code: 'T05' }, { jp: '学園坂', en: 'Gakuenzaka' });
      // The doors on the platform's side open (the cars' right), as at a station.
      set.setDoors(-1, 1);
      genRoot.new.add(set.group);
      const sub = carSet2(0xd8a020, mats, { subway: true, dest: { jp: '夜光線', en: 'Yakō Line' } })();
      sub.group.children.forEach((car, i) => (car.position.z = (i - 1) * (CAR.L + CAR.GAP)));
      sub.group.position.set(at.x - 9, 0.2, at.z);
      genRoot.new.add(sub.group);
      label('new', 'Toto Line commuter car (new)', at.x, 6, at.z);
      label('new', 'subway car (Yakō Line colours)', at.x - 9, 6, at.z);
      for (const g of ['new', 'previous'] as const) {
        genItems[g].push({ name: 'train', group: 'Transit', at: new THREE.Vector3(at.x, 2, at.z), size: 60, view: new THREE.Vector3(1, 0.3, 0.6).normalize() });
        genItems[g].push({ name: 'train (cab)', group: 'Transit', at: new THREE.Vector3(at.x, 2, at.z + 28), size: 8, view: new THREE.Vector3(0.5, 0.15, 1).normalize() });
        genItems[g].push({ name: 'train (inside)', group: 'Transit', at: new THREE.Vector3(at.x, 2.4, at.z + 3), size: 3, view: new THREE.Vector3(0.01, 0.05, 1).normalize() });
      }
      genItems.new.push({ name: 'train (inside, to the cab)', group: 'Transit', at: new THREE.Vector3(at.x, 2.5, at.z + 22), size: 2.5, view: new THREE.Vector3(0.0, 0.02, -1).normalize() });
      genItems.new.push({ name: 'train (doors, platform)', group: 'Transit', at: new THREE.Vector3(at.x - 1, 2.0, at.z + 2.3), size: 4, view: new THREE.Vector3(-1, 0.15, 0.2).normalize() });
      genItems.new.push({ name: 'subway car', group: 'Transit', at: new THREE.Vector3(at.x - 9, 2, at.z), size: 24, view: new THREE.Vector3(-1, 0.25, 0.5).normalize() });
    }
    // The city bus: the district's (previous) and the new one (real/busModel.ts, under review: walk-in, doors that
    // open), at a stop's kerb.
    {
      const at = new THREE.Vector3(26, 0, 0);
      const kerb = new MeshBuilder();
      kerb.kind = KIND.sidewalk;
      kerb.color = lin(0xb4b0a8);
      kerb.box(at.x + 3.6, at.z, 0, 0.15, 3.0, 16, KIND.sidewalk);
      scene.add(new THREE.Mesh(kerb.build()!, city));
      const old = parkedBus('歌舞路循環', city);
      old.position.copy(at);
      genRoot.previous.add(old);
      label('previous', 'city bus', at.x, 4, at.z);
      const line = { id: 'kaburo', name: '歌舞路循環', en: 'KABURO LOOP', rect: [26, 10, 31, 12], buses: 1, stops: ['歌舞路北', '歌舞路東口', '歌舞路二丁目', '歌舞路西口'] } as unknown as BusLine;
      const bus = buildBus2(line, { city, glass: carGlass(), ads: null });
      bus.obj.position.copy(at);
      bus.setDoors(1);
      bus.setNext({ jp: '歌舞路東口', en: 'Kaburo East Exit' }, true);
      genRoot.new.add(bus.obj);
      for (const z of BUS.AXLES) for (const sd of [-1, 1] as const) {
        const w = new MeshBuilder(2048);
        addWheel(w, BUS.WHEEL_R, 0.3, sd, 'steel');
        const m = new THREE.Mesh(w.build()!, city);
        m.position.set(at.x + sd * 1.1, BUS.WHEEL_R, at.z + z);
        genRoot.new.add(m);
      }
      label('new', 'city bus (new)', at.x, 4, at.z);
      for (const g of ['new', 'previous'] as const) genItems[g].push({ name: 'bus', group: 'Transit', at: new THREE.Vector3(at.x, 1.5, at.z), size: 13, view: new THREE.Vector3(1, 0.3, 0.7).normalize() });
      genItems.new.push({ name: 'bus (inside, to the back)', group: 'Transit', at: new THREE.Vector3(at.x, 2.0, at.z + 2.4), size: 1.5, view: new THREE.Vector3(0, 0.05, 1).normalize() });
      genItems.new.push({ name: 'bus (inside, to the front)', group: 'Transit', at: new THREE.Vector3(at.x, 2.4, at.z - 3.5), size: 1.5, view: new THREE.Vector3(0, 0.1, -1).normalize() });
      genItems.new.push({ name: 'bus (doors)', group: 'Transit', at: new THREE.Vector3(at.x + 1.2, 1.4, at.z + 1.5), size: 6, view: new THREE.Vector3(1, 0.15, 0.3).normalize() });
    }
    // The airliner: the airport's (previous) and the new one (real/airliner.ts, under review), in each airline's colours.
    {
      const at = new THREE.Vector3(70, 0, 0);
      const pad = new MeshBuilder();
      pad.kind = KIND.lot;
      pad.color = lin(0x5a5a5c);
      pad.box(at.x + 30, at.z, -0.2, 0.01, 130, 60, KIND.lot);
      scene.add(new THREE.Mesh(pad.build()!, city));
      const old = airliner(0x1a4aa0);
      old.group.position.copy(at);
      old.landing.visible = false;
      genRoot.previous.add(old.group);
      label('previous', 'airliner', at.x, 15, at.z);
      AIRLINES.forEach((a, i) => {
        const p = airliner2(a, city);
        p.group.position.set(at.x + i * 40, 0, at.z);
        p.landing.visible = false;
        genRoot.new.add(p.group);
        label('new', `airliner · ${a.name}`, at.x + i * 40, 15, at.z);
      });
      for (const g of ['new', 'previous'] as const) genItems[g].push({ name: 'airliner', group: 'Transit', at: new THREE.Vector3(at.x, 4, at.z), size: 40, view: new THREE.Vector3(1, 0.35, 0.8).normalize() });
      genItems.new.push({ name: 'airliners (all)', group: 'Transit', at: new THREE.Vector3(at.x + 60, 4, at.z), size: 110, view: new THREE.Vector3(0.2, 0.5, 1).normalize() });
    }
  },
});
