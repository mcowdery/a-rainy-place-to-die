/// <reference lib="webworker" />
import { railReserved } from './rail';
import { expresswayCoveredFrom, expresswayReservedFrom } from './expressway';
import type { DistrictId } from '../../gen/macro';
import { rawTransfer } from '../real/rawGeometry';
import { SignLayout, setRooftopSigns } from '../real/signs';
import { ChunkBuilder, type Stage } from './chunkBuild';
import { loadDistrictContent } from './content';
import { CITIES, setTreeSet, type CityId } from './cityConfig';
import { setWorkLiveries } from '../models/vehicles';
import { DistrictModel, signTexts } from './model';

/**
 * Chunk worker: builds chunk geometry off the main thread. Loads the district content itself (the same
 * files the page loads), so plans are generated here too and only finished arrays cross over, transferred
 * without copying.
 *
 *   -> { type: 'init', kinds, seed, words, city }           <- { type: 'ready' }
 *   -> { type: 'build', id, mx, my, stage }           <- { type: 'built', id, result }
 */
export type WorkerIn =
  | { type: 'init'; kinds: DistrictId[]; seed: number; words: readonly string[]; city: CityId }
  | { type: 'build'; id: number; mx: number; my: number; stage: Stage };

let builder: ChunkBuilder | null = null;

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  if (m.type === 'init') {
    setTreeSet(m.city);
    setWorkLiveries(CITIES[m.city].tropical);
    const content = loadDistrictContent(m.city);
    const model = new DistrictModel(content.macro, m.kinds, content.placed, m.seed, content.zones, content.avenues, content.terrain, [...railReserved(content.rails), ...expresswayReservedFrom('expressway.yaml', content.expresswayText)], expresswayCoveredFrom('expressway.yaml', content.expresswayText));
    setRooftopSigns(CITIES[m.city].rooftopSigns);
    builder = new ChunkBuilder(model, new SignLayout(signTexts(m.words, content.placed)), CITIES[m.city].ads);
    self.postMessage({ type: 'ready' });
    return;
  }
  const result = builder!.build(m.mx, m.my, m.stage);
  const transfer: Transferable[] = rawTransfer(Object.values(result.meshes));
  if (result.lightmap) transfer.push(result.lightmap.buffer as ArrayBuffer);
  if (result.crowd) transfer.push(result.crowd.buffer as ArrayBuffer);
  self.postMessage({ type: 'built', id: m.id, result }, { transfer });
};
