/// <reference lib="webworker" />
import type { DistrictId } from '../../gen/macro';
import { rawTransfer } from '../real/rawGeometry';
import { SignLayout } from '../real/signs';
import { ChunkBuilder, type Stage } from './chunkBuild';
import { loadDistrictContent } from './content';
import { DistrictModel, signTexts } from './model';

/**
 * Chunk worker: builds chunk geometry off the main thread. Loads the district content itself (the same
 * files the page loads), so plans are generated here too and only finished arrays cross over, transferred
 * without copying.
 *
 *   -> { type: 'init', kinds, seed, words }           <- { type: 'ready' }
 *   -> { type: 'build', id, mx, my, stage }           <- { type: 'built', id, result }
 */
export type WorkerIn =
  | { type: 'init'; kinds: DistrictId[]; seed: number; words: readonly string[] }
  | { type: 'build'; id: number; mx: number; my: number; stage: Stage };

let builder: ChunkBuilder | null = null;

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  if (m.type === 'init') {
    const content = loadDistrictContent();
    const model = new DistrictModel(content.macro, m.kinds, content.placed, m.seed, content.zones);
    builder = new ChunkBuilder(model, new SignLayout(signTexts(m.words, content.placed)));
    self.postMessage({ type: 'ready' });
    return;
  }
  const result = builder!.build(m.mx, m.my, m.stage);
  const transfer: Transferable[] = rawTransfer(Object.values(result.meshes));
  if (result.lightmap) transfer.push(result.lightmap.buffer as ArrayBuffer);
  self.postMessage({ type: 'built', id: m.id, result }, { transfer });
};
