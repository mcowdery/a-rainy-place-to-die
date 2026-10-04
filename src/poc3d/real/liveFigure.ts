import * as THREE from 'three';
import { FIGURE_ATTRS, PAVEMENT, figureSize, packFigures, templateGeometry, templateIndex, type FigureSpec } from './people';

/** Who a live figure is: the mob's body, hair, clothes and shade. */
export type FigureLook = Pick<FigureSpec, 'body' | 'hair' | 'long' | 'outfit' | 'color' | 'side'>;

/** Where a live figure is this frame, and what it's doing. */
export interface LivePose {
  readonly x: number;
  readonly z: number;
  /** What it stands on (the feet), or a seat's cushion (the hips sit RIDE_HIP above it). */
  readonly y: number;
  readonly yaw: number;
  /** On foot (standing, walking or running by `pace`, the stride at `phase`), or sitting in a car. */
  readonly pose: 'gait' | 'ride';
  /** 'gait': 0 standing, 1 walking, 2 running. 'ride': the knees tucked up, 0-1. */
  readonly pace: number;
  readonly phase?: number;
  /** The head's turn (rad). */
  readonly look?: number;
  /** Whole right up to the camera (a passenger beside you); else it fades as you walk into it, like the mob. */
  readonly close?: boolean;
}

/**
 * One of the mob's figures moved by the game rather than by its own numbers (someone following you:
 * real/followerParty.ts): the crowd's template drawn as a single instance, its numbers rewritten each frame, so
 * the mob's material poses and animates it like everyone else (poses 'gait' and 'ride', real/people.ts). Its place
 * is in its parent's frame: in the scene the world's, on a car the car's (it rides along, leaning with the body).
 */
export class LiveFigure {
  readonly mesh: THREE.Mesh;
  /** Its standing height and its hips' (m), for fitting it under a roof. */
  readonly size: { height: number; hip: number };
  private readonly attrs: THREE.InstancedBufferAttribute[];

  constructor(private readonly who: FigureLook, material: THREE.Material) {
    const base = templateGeometry(templateIndex(who));
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    for (const [name, attr] of Object.entries(base.attributes)) geo.setAttribute(name, attr);
    geo.instanceCount = 1;
    this.attrs = FIGURE_ATTRS.map((spec) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(spec.at.length), spec.at.length);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(spec.name, a);
      return a;
    });
    this.mesh = new THREE.Mesh(geo, material);
    // (The vertex shader places it: its bind pose at the origin says nothing of where it is.)
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.size = figureSize(who);
  }

  set(p: LivePose): void {
    // (Never an umbrella: nothing draws one for it.)
    const f = packFigures([{ ...this.who, x: p.x, z: p.z, yaw: p.yaw, pose: p.pose, pace: p.pace, phase: p.phase ?? 0, look: p.look ?? 0, y: p.y - PAVEMENT, fade: false, close: p.close }], null, false);
    FIGURE_ATTRS.forEach((spec, j) => {
      const a = this.attrs[j];
      const arr = a.array as Float32Array;
      for (let c = 0; c < spec.at.length; c++) arr[c] = f[spec.at[c]];
      a.needsUpdate = true;
    });
  }
}
