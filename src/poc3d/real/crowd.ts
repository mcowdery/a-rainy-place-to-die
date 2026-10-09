import * as THREE from 'three';
import { Emotes, type EmoteLooks } from './emotes';
import { BODY_LIST, FIGURE_ATTRS, FIGURE_STRIDE, POSE_LIST, mobDepthMaterial, TEMPLATE_COUNT, templateGeometry } from './people';
import { CrowdSmoke } from './smoke';
import { HOURS, MANNERS, outAt } from '../district/peopleHours';
import type { Body } from './mobRig';
import type { Pose } from './people';

interface Batch {
  readonly mesh: THREE.Mesh;
  readonly geo: THREE.InstancedBufferGeometry;
  readonly attrs: THREE.InstancedBufferAttribute[];
  cap: number;
}

/**
 * The streets' crowds, drawn instanced: one draw per template (body, hair, coat; and the umbrellas) for every
 * figure in range, each figure a few numbers (people.ts `packFigures`) that the material poses and animates.
 * Chunks hand over their figures as they're built and drop them when they go; `show` says which chunks'
 * people are drawn (in range and not hidden behind others); the instance buffers are rebuilt only when that
 * changes. Their emotes, and their breath in the cold (real/emotes.ts), are a draw more each, on the same figures;
 * and so are the smokers' cigarettes, embers and smoke (real/smoke.ts).
 */
/** Someone standing about, as the crowd's numbers give them. */
export interface StandingPerson {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** The floor under them. */
  readonly y: number;
  readonly yaw: number;
  readonly body: Body;
  readonly pose: Pose;
  readonly manner: string;
  readonly seed: number;
}

export class Crowd {
  readonly group = new THREE.Group();
  /** People carry their umbrellas (while it rains). */
  umbrellas = false;
  private readonly chunks = new Map<number, Float32Array>();
  private shown = new Set<number>();
  private readonly batches = new Map<number, Batch>();
  private dirty = false;
  private umbrellasShown = false;
  private casts = true;
  /** The marks at their heads and their breath in the cold (null with a material that isn't the mob's). */
  readonly emoteLayer: Emotes | null;
  /** The smokers' cigarettes and cigars, their embers and their smoke (null with a material that isn't the mob's). */
  readonly smokeLayer: CrowdSmoke | null;

  constructor(private readonly material: THREE.Material) {
    this.group.name = 'crowd';
    this.group.matrixAutoUpdate = false;
    const mob = material as THREE.ShaderMaterial;
    this.emoteLayer = mob.uniforms?.tJoints ? new Emotes(mob) : null;
    if (this.emoteLayer) this.group.add(this.emoteLayer.mesh, this.emoteLayer.breath);
    this.smokeLayer = mob.uniforms?.tJoints ? new CrowdSmoke(mob) : null;
    if (this.smokeLayer) this.group.add(this.smokeLayer.mesh);
  }

  /** How many of those who smoke have one lit (0 none to 1: the setting), and the wind their smoke goes with (m/s, world x and z). */
  set smoking(v: number) {
    const u = (this.material as THREE.ShaderMaterial).uniforms?.uSmoking;
    if (u) u.value = v;
  }
  set wind(w: THREE.Vector2) {
    if (this.smokeLayer) this.smokeLayer.wind = w;
  }

  /** Whether people show emotes now and then (manga's marks at the head: real/emotes.ts). */
  get emotes(): boolean {
    return this.emoteLayer?.on ?? false;
  }
  set emotes(on: boolean) {
    if (this.emoteLayer) this.emoteLayer.on = on;
  }

  /** How the blush, the hearts and the stars are drawn (real/emotes.ts EmoteLooks). */
  set emoteLooks(looks: EmoteLooks) {
    if (this.emoteLayer) this.emoteLayer.looks = looks;
  }

  /** How cold it is for people's breath to show (0 to 1: district/forecast.ts coldBreath). */
  get cold(): number {
    return this.emoteLayer?.cold ?? 0;
  }
  set cold(v: number) {
    if (this.emoteLayer && v !== this.emoteLayer.cold) this.emoteLayer.cold = v;
  }

  /** Whether the people cast shadows (those near the viewer: people.ts mobDepthMaterial). */
  get shadows(): boolean {
    return this.casts;
  }
  set shadows(on: boolean) {
    if (on === this.casts) return;
    this.casts = on;
    for (const b of this.batches.values()) b.mesh.castShadow = on;
  }

  /**
   * The people standing about within r metres of (x, z) at `hour`: those in the chunks shown who aren't walking and
   * are out at this hour (a walker's place is the shader's alone). For talking to and looking at.
   */
  standingNear(x: number, z: number, r: number, hour: number): StandingPerson[] {
    const out: StandingPerson[] = [];
    for (const key of this.shown) {
      const f = this.chunks.get(key);
      if (!f) continue;
      for (let k = 0; k < f.length; k += FIGURE_STRIDE) {
        const fx = f[k + 1];
        const fz = f[k + 2];
        if (Math.abs(fx - x) > r || Math.abs(fz - z) > r || Math.hypot(fx - x, fz - z) > r) continue;
        const pose = POSE_LIST[f[k + 6]];
        // (Walking, crossing, running; riding or at a strap is elsewhere.)
        if (f[k + 11] !== 0 || !pose || pose === 'walk' || pose === 'gait' || pose === 'ride' || pose === 'strap' || pose === 'sit') continue;
        const hours = f[k + 20] < 0 ? null : HOURS[f[k + 20]];
        if (hours && outAt(hours, hour) <= f[k + 22]) continue;
        const body = BODY_LIST[f[k + 5]] ?? 'man';
        out.push({ id: `${key}:${k}`, x: fx, z: fz, y: f[k + 13], yaw: f[k + 3], body, pose, manner: MANNERS[f[k + 21]] ?? 'plain', seed: f[k + 4] });
      }
    }
    return out;
  }

  /** A chunk's figures (FIGURE_STRIDE floats each), or null when it's dropped. */
  set(key: number, figures: Float32Array | null): void {
    if (figures && figures.length > 0) this.chunks.set(key, figures);
    else if (!this.chunks.delete(key)) return;
    if (this.shown.has(key)) this.dirty = true;
  }

  /** The chunks whose people are drawn this frame. */
  show(keys: ReadonlySet<number>): void {
    if (keys.size === this.shown.size && [...keys].every((k) => this.shown.has(k))) return;
    this.shown = new Set(keys);
    this.dirty = true;
  }

  /** Rebuilds the instance buffers if what's shown changed. */
  update(): void {
    if (this.umbrellas !== this.umbrellasShown) {
      this.umbrellasShown = this.umbrellas;
      this.dirty = true;
      // Those carrying one hold it up (the umbrella hangs off that arm: people.ts buildUmbrella).
      const u = (this.material as THREE.ShaderMaterial).uniforms?.uUmbrella;
      if (u) u.value = this.umbrellas ? 1 : 0;
    }
    if (!this.dirty) return;
    this.dirty = false;
    // Count each template's figures, then fill.
    const counts = new Map<number, number>();
    // (A figure's umbrella is its body's umbrella template: people.ts umbrellaIndex.)
    const umbrella = (f: Float32Array, k: number): number => TEMPLATE_COUNT + f[k + 5];
    for (const key of this.shown) {
      const f = this.chunks.get(key);
      if (!f) continue;
      for (let k = 0; k < f.length; k += FIGURE_STRIDE) {
        counts.set(f[k], (counts.get(f[k]) ?? 0) + 1);
        if (this.umbrellas && f[k + 19] > 0) counts.set(umbrella(f, k), (counts.get(umbrella(f, k)) ?? 0) + 1);
      }
    }
    for (const [t, b] of this.batches) if (!counts.has(t)) b.mesh.visible = false;
    const fill = new Map<number, number>();
    for (const [t, n] of counts) {
      const b = this.batch(t, n);
      b.mesh.visible = true;
      b.geo.instanceCount = n;
      fill.set(t, 0);
    }
    for (const key of this.shown) {
      const f = this.chunks.get(key);
      if (!f) continue;
      for (let k = 0; k < f.length; k += FIGURE_STRIDE) {
        this.write(f[k], f, k, fill);
        if (this.umbrellas && f[k + 19] > 0) this.write(umbrella(f, k), f, k, fill);
      }
    }
    for (const [t, n] of counts) {
      for (const a of this.batches.get(t)!.attrs) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
    }
    // Their emotes and their breath: everyone shown, whatever their template.
    if (this.emoteLayer) {
      const shown = [...this.shown].map((key) => this.chunks.get(key)).filter((f): f is Float32Array => !!f);
      this.emoteLayer.fill(shown, shown.reduce((n, f) => n + f.length / FIGURE_STRIDE, 0));
    }
    this.smokeLayer?.fill([...this.shown].map((key) => this.chunks.get(key)).filter((f): f is Float32Array => !!f));
  }

  private write(t: number, f: Float32Array, k: number, fill: Map<number, number>): void {
    const b = this.batches.get(t)!;
    const i = fill.get(t)!;
    fill.set(t, i + 1);
    FIGURE_ATTRS.forEach((spec, j) => {
      const arr = b.attrs[j].array as Float32Array;
      const m = spec.at.length;
      for (let c = 0; c < m; c++) arr[i * m + c] = f[k + spec.at[c]];
    });
  }

  /** The template's batch, with room for n figures. */
  private batch(t: number, n: number): Batch {
    let b = this.batches.get(t);
    if (b && b.cap >= n) return b;
    const cap = Math.max(16, Math.ceil(n * 1.5));
    if (!b) {
      const base = templateGeometry(t);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = base.index;
      for (const [name, attr] of Object.entries(base.attributes)) geo.setAttribute(name, attr);
      const mesh = new THREE.Mesh(geo, this.material);
      // The figures are everywhere in range (the vertex shader places them): never culled as one box.
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      mesh.matrixAutoUpdate = false;
      mesh.customDepthMaterial = mobDepthMaterial(this.material);
      mesh.castShadow = this.casts && !!mesh.customDepthMaterial;
      this.group.add(mesh);
      b = { mesh, geo, attrs: [], cap: 0 };
      this.batches.set(t, b);
    }
    const attrs = FIGURE_ATTRS.map((spec) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * spec.at.length), spec.at.length);
      a.setUsage(THREE.DynamicDrawUsage);
      b!.geo.setAttribute(spec.name, a);
      return a;
    });
    b.attrs.splice(0, b.attrs.length, ...attrs);
    b.cap = cap;
    return b;
  }
}
