import * as THREE from 'three';
import { KIND, lin } from '../../real/meshBuilder';
import { addVehicleLow, BIKE_TYPES, CAR_TYPES2, FILIPINO_TYPES, WORK_TYPES, type VehicleType } from '../../models/vehicles';
import { startRoom } from '../shell';
import { ADS, carKit, NAMES, PAINT_A, PAINT_B } from './carKit';

/**
 * Cars (models-cars.html): every car, van, truck, scooter and patrol car of Tōto (models/vehicles.ts), in two paints, with the
 * taxi ads on their roofs and doors, the middle-distance models and the working vehicles in their companies' lettering.
 * Manila's jeepneys and tricycles are in models-cars-ph.html.
 */
startRoom({
  title: 'Cars',
  groups: ['Cars'],
  camera: { pos: [14, 15, 34], target: [14, 0, -6] },
  overview: { at: [0, 1, 8], size: 20, view: [0.3, 0.6, 0.75] },
  setup(ctx) {
    const { genItems, label } = ctx;
  ctx.floor((floor) => {
    floor.kind = KIND.lot;
    floor.color = lin(0x5e5e5c);
    floor.box(0, 6, -0.2, 0, 110, 80, KIND.lot);
    floor.kind = KIND.asphalt;
    floor.box(0, -10.5, 0, 0.02, 32, 26, KIND.asphalt);
    floor.box(0, -30, 0, 0.02, 32, 11, KIND.asphalt);
    floor.kind = KIND.lot;
    floor.box(0, -36, -0.2, 0, 110, 6, KIND.lot);
  });
    const { newCars, vehicle, finish } = carKit(ctx);
    CAR_TYPES2.filter((t) => !WORK_TYPES.includes(t) && !FILIPINO_TYPES.includes(t)).forEach((type, i) => {
      const x = -13 + i * 3.7;
      vehicle({ x, z: -1.5, fx: 0, fz: 1, type, paint: PAINT_A[type] }, NAMES[type], 4.5);
      // Second row: other paints, facing away; the taxis carry ads.
      const ad = type === 'taxi' ? ADS[1] : type === 'taxi2' ? ADS[0] : undefined;
      vehicle({ x, z: -8.5, fx: 0, fz: -1, type, paint: PAINT_B[type], ad }, `${NAMES[type]} (alt${ad ? ' + ad' : ''})`, 4.5);
    });
    // The middle-distance versions (addVehicleLow: parked cars beyond ~140 m, traffic beyond 80 m), in front of row 1.
    CAR_TYPES2.filter((t) => !WORK_TYPES.includes(t) && !FILIPINO_TYPES.includes(t)).forEach((type, i) => addVehicleLow(newCars, { x: -13 + i * 3.7, z: 3, fx: 0, fz: 1, type, paint: PAINT_A[type] }));
    WORK_TYPES.forEach((type, i) => addVehicleLow(newCars, { x: 30 + i * 6.5, z: 3, fx: 0, fz: 1, type, paint: PAINT_A[type] }));
    label('new', 'middle-distance models (parked beyond ~140 m, traffic beyond 80 m)', 4, 2.6, 3);
    genItems.new.push({ name: 'middle-distance cars', group: 'Cars', at: new THREE.Vector3(4, 0.8, 3), size: 16 });
    // Working vehicles and the patrol car (new, under review): a row of their own behind the taxi ads, the second
    // paint facing away.
    // Each in two companies' lettering (WORK_LIVERIES), the patrol cars two units.
    const COMPANY: Partial<Record<VehicleType, [number, number]>> = { van: [0, 4], keivan: [1, 6], boxtruck: [2, 3] };
    WORK_TYPES.forEach((type, i) => {
      const x = -10 + i * 6.5;
      const [ca, cb] = COMPANY[type] ?? [undefined, undefined];
      vehicle({ x, z: -27, fx: 0, fz: 1, type, paint: PAINT_A[type], company: ca, marks: 1 }, NAMES[type], 5.5, 3.4);
      vehicle({ x, z: -33, fx: 0, fz: -1, type, paint: PAINT_B[type], company: cb, marks: 7 }, `${NAMES[type]} (alt)`, 5.5, 3.4);
    });
    BIKE_TYPES.forEach((type, i) => {
      for (const [j, paints] of [PAINT_A, PAINT_B].entries()) {
        const x = -9 + i * 6 + j * 2.2;
        vehicle({ x, z: -13.5, fx: 0, fz: 1, type, paint: paints[type], paint2: type === 'delivery' && j === 1 ? 0xe8c020 : undefined }, `${NAMES[type]}${j ? ' (alt)' : ''}`, 2.4, 1.7);
      }
    });
    // Ad options, parked side-on so the roof panel and door wrap face the camera.
    ADS.forEach((ad, i) => {
      // Two staggered rows so the back row's doors aren't hidden.
      const x = -13.5 + (i % 4) * 9 + (i < 4 ? 0 : 4.5);
      const z = i < 4 ? -18 : -21.5;
      const type = i % 2 ? 'taxi2' : 'taxi';
      vehicle({ x, z, fx: 1, fz: 0, type, paint: type === 'taxi' ? [0x121316, 0xe0a818, 0x1f5a36][i % 3] : 0x1c2240, ad }, `ad ${ad.name}`, 5);
    });
    finish();
  },
});
