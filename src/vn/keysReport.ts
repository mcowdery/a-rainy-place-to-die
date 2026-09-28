import { loadDistrictContent } from '../poc3d/district/content';
import { loadVnLibrary } from './content';
import { vnKeys, type VnKeys } from './keys';

/** The world's VN keys with the shipped stories' scenes (loaded through Vite by scripts/vn/keys.mjs). */
export function report(): VnKeys {
  return vnKeys(loadDistrictContent().placed, loadVnLibrary());
}
