/**
 * Los campos fuente de s0028 que lee la clasificación GPU (`s28PA` y `s28PT`), en el orden de sus bits en el mapa de ocupación
 * (decisión 400): los abdominales y después los torácicos. El mismo orden que las tablas `S28A_*` y `S28T_*` del GLSL.
 */
export const S0028_ABDOMINAL_FIELDS = [
  'liver',
  'spleen',
  'pancreas',
  'kidneyRight',
  'kidneyLeft',
  'gallbladder',
  'bladder',
  'digestiveTract',
  'posteriorMuscle',
  'lumbarSacralBone',
  'sacrum',
  'renalCysts',
  'aorta',
  'inferior_vena_cava',
  'portal_vein_and_splenic_vein',
] as const;
export const S0028_THORACIC_FIELDS = ['thoracicBone', 'cartilage', 'lung', 'heart'] as const;
export const S0028_MASK_FIELDS = [...S0028_ABDOMINAL_FIELDS, ...S0028_THORACIC_FIELDS] as const;
