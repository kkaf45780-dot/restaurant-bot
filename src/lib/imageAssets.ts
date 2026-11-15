import logoImg from '../assets/images/logo_meshweyat_elhara_1794772425337.jpg';
import heroMixedGrillImg from '../assets/images/hero_mixed_grill_platter_1794773312648.jpg';
import kebabKoftaImg from '../assets/images/dish_kebab_kofta_1794772426751.jpg';
import shishTarabImg from '../assets/images/dish_shish_tarab_1794772427324.jpg';
import lambChopsImg from '../assets/images/dish_lamb_chops_1794772427306.jpg';
import hawawshiImg from '../assets/images/dish_hawawshi_1794772427406.jpg';
import sandwichesImg from '../assets/images/dish_sandwiches_1794772427710.jpg';
import mezzeImg from '../assets/images/dish_mezze_salads_1794772429086.jpg';
import drinksImg from '../assets/images/dish_drinks_oriental_1794772429527.jpg';
import omAliImg from '../assets/images/dish_om_ali_dessert_1794773312294.jpg';

const ASSET_MAP: Record<string, string> = {
  '/src/assets/images/logo_meshweyat_elhara_1794772425337.jpg': logoImg,
  '/src/assets/images/hero_mixed_grill_platter_1794773312648.jpg': heroMixedGrillImg,
  '/src/assets/images/dish_kebab_kofta_1794772426751.jpg': kebabKoftaImg,
  '/src/assets/images/dish_shish_tarab_1794772427324.jpg': shishTarabImg,
  '/src/assets/images/dish_lamb_chops_1794772427306.jpg': lambChopsImg,
  '/src/assets/images/dish_hawawshi_1794772427406.jpg': hawawshiImg,
  '/src/assets/images/dish_sandwiches_1794772427710.jpg': sandwichesImg,
  '/src/assets/images/dish_mezze_salads_1794772429086.jpg': mezzeImg,
  '/src/assets/images/dish_drinks_oriental_1794772429527.jpg': drinksImg,
  '/src/assets/images/dish_om_ali_dessert_1794773312294.jpg': omAliImg,
};

export const HERO_PLATTER_IMAGE_PATH =
  '/src/assets/images/hero_mixed_grill_platter_1794773312648.jpg';

export function resolveAssetUrl(url: string | undefined | null): string {
  if (!url) return '';
  return ASSET_MAP[url] ?? url;
}

export const PRESET_DISH_IMAGES = [
  { label: 'صينية مشويات مشكلة', url: '/src/assets/images/hero_mixed_grill_platter_1794773312648.jpg' },
  { label: 'كباب وكفتة', url: '/src/assets/images/dish_kebab_kofta_1794772426751.jpg' },
  { label: 'شيش وطرب', url: '/src/assets/images/dish_shish_tarab_1794772427324.jpg' },
  { label: 'ريش ضاني', url: '/src/assets/images/dish_lamb_chops_1794772427306.jpg' },
  { label: 'حواوشي', url: '/src/assets/images/dish_hawawshi_1794772427406.jpg' },
  { label: 'سندوتشات', url: '/src/assets/images/dish_sandwiches_1794772427710.jpg' },
  { label: 'مقبلات وسلطات', url: '/src/assets/images/dish_mezze_salads_1794772429086.jpg' },
  { label: 'حلويات شرقية', url: '/src/assets/images/dish_om_ali_dessert_1794773312294.jpg' },
  { label: 'مشروبات', url: '/src/assets/images/dish_drinks_oriental_1794772429527.jpg' },
];
