import kaiwa from '../../content/phone/kaiwa.yaml?raw';
import { byModel, byName, type Edition, NO_STORY } from './types';

/**
 * The gameplay demo (see types.ts): no story, only KAIWA's welcome on the phone, and Kaburo's ad art without the
 * files in demoArt.ts's DEMO_HIDDEN_ART (excluded here by the glob itself, so the build never bundles them; the
 * ads' list drops them too, models/ads.ts). Keep the two lists in step (tests/edition.test.ts checks).
 */
const art = import.meta.glob(
  [
    '../../assets/ads/kaburo/*.jpg',
    '!**/09_annaijo_girls.jpg',
    '!**/12_hotel_rouge_julie.jpg',
    '!**/13_hotel_rouge.jpg',
    '!**/14_hotel_venus.jpg',
    '!**/22_hotel_venus_poster.jpg',
    '!**/39_hotel_aqua.jpg',
    '!**/40_hotel_aqua.jpg',
    '!**/53_maid_cafe_pure.jpg',
    '!**/55_hotel_orient.jpg',
    '!**/56_hotel_orient.jpg',
    '!**/57_hotel_sakura.jpg',
    '!**/58_hotel_sakura.jpg',
    '!**/68_hotel_mirage_poster.jpg',
    '!**/69_hotel_mirage_poster.jpg',
    '!**/70_momogen_esthe.jpg',
    '!**/71_momogen_esthe.jpg',
    '!**/81_maid_cafe_pure.jpg',
  ],
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

/** The cast's models without DEMO_HIDDEN_CHARACTERS (demoArt.ts): Mack nude, for the arrival. */
const models = import.meta.glob(['../../assets/characters/*.glb', '!**/mack_nude.glb'], { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>;

export const edition: Edition = {
  name: 'demo',
  narrative: false,
  ageGate: () => Promise.resolve(),
  story: { ...NO_STORY, phoneFiles: { 'kaiwa.yaml': kaiwa } },
  overlay: NO_STORY,
  kaburoArt: byName(art),
  characters: byModel(models),
};
