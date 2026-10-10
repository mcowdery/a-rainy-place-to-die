import { MeshBuilder } from '../../real/meshBuilder';
import * as THREE from 'three';
import { addVehicle, vehicleLights, vehicleTexts, type VehicleSpec, type VehicleType } from '../../models/vehicles';
import { Lightmap, paintLights, type Light } from '../../real/lightmap';
import { AdAtlas, adMaterial } from '../../real/adAtlas';
import { TAXI_ADS } from '../../models/ads';
import { SignAtlas, SignBuilder, signMaterial } from '../../real/signs';
import type { RoomCtx } from '../shell';

/** What the two car rooms (the Japanese cars, Manila's jeepneys and tricycles) share: the names and paints, the taxi ads' lettering and photos, the merged mesh, the night lightmap. */
// Taxi ads (models/ads.ts): photo + printed copy, one option per taxi in row 4.
export const ADS = TAXI_ADS.map((ad, i) => ({ ...ad, photo: i }));
export const NAMES: Record<VehicleType, string> = {
  sedan: 'sedan', luxury: 'luxury sedan', sports: 'sports coupe', taxi: 'taxi (classic)', taxi2: 'taxi (modern)', kei: 'kei tall-wagon',
  minivan: 'minivan', keitruck: 'kei truck', scooter: 'scooter', motorcycle: 'motorcycle', delivery: 'delivery scooter',
  hatch: 'hatchback (80s)', rotary: 'rotary coupe', awd: 'turbo AWD coupe', roadster: 'kei roadster',
  van: 'work van', keivan: 'kei van', boxtruck: 'box truck (2 t)', police: 'patrol car', hardtop: 'hardtop saloon (70s, noir)', jeepney: 'jeepney (Manila)', tricycle: 'tricycle (Manila)',
};
export const PAINT_A: Record<VehicleType, number> = {
  sedan: 0xe8e8e4, luxury: 0x07070a, sports: 0xc01818, taxi: 0x121316, taxi2: 0x1c2240, kei: 0xa8d4bc, minivan: 0xb4b6ba, keitruck: 0xe8e8e4,
  scooter: 0xe8e0c8, motorcycle: 0xb81818, delivery: 0xc81818,
  hatch: 0xf0f0ec, rotary: 0xe8c020, awd: 0x5a5e66, roadster: 0xe8c020,
  van: 0xf0f0ec, keivan: 0xf0f0ec, boxtruck: 0xf0f0ec, police: 0xf2f2ee, hardtop: 0x0a0a0c, jeepney: 0xe6e2d2, tricycle: 0xc81818,
};
export const PAINT_B: Record<VehicleType, number> = {
  sedan: 0x1c2a44, luxury: 0xf0efe8, sports: 0xf0f0ec, taxi: 0xe0a818, taxi2: 0x121316, kei: 0xd8c09a, minivan: 0x121316, keitruck: 0xb4b6ba,
  scooter: 0x8ab0d0, motorcycle: 0x121316, delivery: 0x1c4a9a,
  hatch: 0xc01818, rotary: 0xc01818, awd: 0x1a2c5a, roadster: 0xc01818,
  van: 0x1c2a44, keivan: 0x8ab0d0, boxtruck: 0x2a5a9a, police: 0xf2f2ee, hardtop: 0x3a3428, jeepney: 0xc4c8cc, tricycle: 0x1c5aa8,
};

export function carKit(ctx: RoomCtx, defaultGroup = 'Cars') {
  const { renderer, city, cityU, genRoot, genItems, label } = ctx;
  const adAtlas = new SignAtlas(vehicleTexts(ADS));
  const signsMat = signMaterial(cityU, adAtlas);
  const photoAtlas = new AdAtlas(TAXI_ADS);
  const adSigns = {
    sb: new SignBuilder(),
    layout: adAtlas,
    photos: { sb: new SignBuilder(), uv: (i: number, part: 'roof' | 'door') => photoAtlas.uv(i, part), blankUv: photoAtlas.blankUv, roofAspect: AdAtlas.ROOF_ASPECT, doorAspect: AdAtlas.DOOR_ASPECT },
  };
  const newCars = new MeshBuilder(1 << 17);
  const nightLights: Light[] = [];
  /** One vehicle: its model, its night light, its focus item and label. */
  const vehicle = (spec: VehicleSpec, name: string, size: number, labelY = 2.4, group = defaultGroup): void => {
    addVehicle(newCars, spec, adSigns);
    nightLights.push(...vehicleLights(spec));
    genItems.new.push({ name, group, at: new THREE.Vector3(spec.x, 0.8, spec.z), size });
    label('new', name, spec.x, labelY, spec.z);
  };
  /** Builds the merged meshes (the cars, their lettering, their photo ads) and paints the headlights into a lightmap. */
  const finish = (): void => {
    const newCarMesh = new THREE.Mesh(newCars.build()!, city);
    newCarMesh.castShadow = newCarMesh.receiveShadow = true;
    genRoot.new.add(newCarMesh);
    const signGeo = adSigns.sb.build(0, 0);
    if (signGeo) genRoot.new.add(new THREE.Mesh(signGeo, signsMat));
    const photoGeo = adSigns.photos.sb.build(0, 0);
    if (photoGeo) genRoot.new.add(new THREE.Mesh(photoGeo, adMaterial(cityU, photoAtlas)));
    // Headlight and brake-light spill on the ground, painted into a lightmap tile like the district's.
    const showLightmap = new Lightmap(renderer, { x: -64, y: -64, w: 128, h: 128 }, 128);
    showLightmap.upload(-64, -64, paintLights(new OffscreenCanvas(128, 128).getContext('2d', { willReadFrequently: true })!, -64, -64, 128, nightLights));
    cityU.tLight.value = showLightmap.texture;
    cityU.uLightRect.value = showLightmap.uniformRect;
  };
  return { newCars, vehicle, finish, adSigns };
}
