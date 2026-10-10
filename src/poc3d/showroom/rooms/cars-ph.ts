import * as THREE from 'three';
import { KIND, lin } from '../../real/meshBuilder';
import { addVehicleLow, JEEPNEY_LIVERIES, PAINTS, setWorkLiveries } from '../../models/vehicles';
import { CITIES, setTreeSet } from '../../district/cityConfig';
import { setSkinTone } from '../../real/people';
import { startRoom } from '../shell';
import { carKit, NAMES, PAINT_A, PAINT_B } from './carKit';

/**
 * Manila's vehicles (models-cars-ph.html): the jeepney in each of its paint jobs (front row facing you, the second row
 * facing away), the tricycle in its six paints parked and driving, both as the middle-distance models, and beside them a
 * regular sedan, a kei truck and a minivan to judge their size. In no traffic mix of Tōto's.
 */
startRoom({
  title: 'Vehicles (Manila)',
  groups: ['Vehicles', 'Size'],
  summer: true,
  camera: { pos: [5, 8, 26], target: [5, 1, 0] },
  shadow: { x: 5, z: -2, half: 32 },
  overview: { at: [5, 1, -4], size: 26, view: [0.3, 0.6, 0.75] },
  setup(ctx) {
    // Manila's state, as the district page sets it for ?city=manila (module-level, set before anything is built).
    setTreeSet('manila');
    setWorkLiveries(true);
    setSkinTone(CITIES.manila.skin);
    const { genItems, label } = ctx;
    ctx.floor((floor) => {
      floor.kind = KIND.lot;
      floor.color = lin(0x5e5e5c);
      floor.box(5, -2, -0.2, 0, 80, 64, KIND.lot);
      floor.kind = KIND.asphalt;
      floor.box(5, -4, 0, 0.02, 60, 40, KIND.asphalt);
    });
    const { newCars, vehicle, finish } = carKit(ctx, 'Vehicles');
    // Manila's vehicles (new, under review; in no traffic mix): the jeepney in each of its paint jobs (JEEPNEY_LIVERIES), the second
    // row facing away, and the tricycle (a static model, not a vehicle type) beside them.
    JEEPNEY_LIVERIES.forEach((liv, i) => {
      const x = -10 + i * 5.4;
      vehicle({ x, z: 0, fx: 0, fz: 1, type: 'jeepney', paint: PAINT_A.jeepney, company: i, marks: 1 }, `${NAMES.jeepney}: ${liv.name}`, 7, 3.2);
      vehicle({ x, z: -10, fx: 0, fz: -1, type: 'jeepney', paint: PAINT_B.jeepney, company: i, marks: 1 }, `${NAMES.jeepney}: ${liv.name} (rear)`, 7, 3.2);
    });
    addVehicleLow(newCars, { x: 17, z: -16, fx: 0, fz: 1, type: 'jeepney', paint: PAINT_A.jeepney });
    label('new', 'jeepney, middle-distance model', 17, 3, -16);
    // The tricycle (a motorcycle with a sidecar) in its six paints, a column of three facing the camera and a column facing away.
    PAINTS.tricycle.forEach((paint, i) => {
      const x = 13 + (i % 3) * 3.2;
      vehicle({ x, z: 0 - Math.floor(i / 3) * 5, fx: 0, fz: 1, type: 'tricycle', paint, marks: i + 3 }, `${NAMES.tricycle}${i ? ` ${i + 1}` : ''}`, 3.6, 2.1);
      vehicle({ x, z: -10 - Math.floor(i / 3) * 5, fx: 0, fz: -1, type: 'tricycle', paint, marks: i + 3, lamps: false }, `${NAMES.tricycle} ${i + 1} (parked)`, 3.6, 2.1);
    });
    addVehicleLow(newCars, { x: 24, z: -16, fx: 0, fz: 1, type: 'tricycle', paint: PAINT_A.tricycle });
    label('new', 'tricycle, middle-distance model', 24, 3, -16);
    // The size of them: a sedan, the jeepney, the tricycle, a kei truck and a minivan, side by side facing you.
    {
      const z = 12;
      const row: [Parameters<typeof vehicle>[0]['type'], number, number][] = [['sedan', -9, PAINT_A.sedan], ['jeepney', -3.5, PAINT_A.jeepney], ['tricycle', 2, PAINT_A.tricycle], ['keitruck', 6.5, PAINT_A.keitruck], ['minivan', 11, PAINT_A.minivan]];
      for (const [type, x, paint] of row) vehicle({ x, z, fx: 0, fz: 1, type, paint, company: type === 'jeepney' ? 0 : undefined, marks: 3 }, `size: ${NAMES[type]}`, 6, 3.2, 'Size');
      genItems.new.push({ name: 'size comparison', group: 'Size', at: new THREE.Vector3(1, 1, z), size: 26, view: new THREE.Vector3(0.1, 0.35, 1).normalize() });
    }
    genItems.new.push(
      { name: 'jeepneys (all)', group: 'Vehicles', at: new THREE.Vector3(1, 1.5, 0), size: 26, view: new THREE.Vector3(0.1, 0.4, 1).normalize() },
      { name: 'jeepneys (rear)', group: 'Vehicles', at: new THREE.Vector3(1, 1.5, -10), size: 26, view: new THREE.Vector3(0.1, 0.4, -1).normalize() },
      { name: 'tricycles (all six)', group: 'Vehicles', at: new THREE.Vector3(16, 1, -5), size: 14, view: new THREE.Vector3(0.1, 0.5, 1).normalize() },
    );
    finish();
  },
});
