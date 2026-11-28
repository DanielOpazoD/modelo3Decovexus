/** Generado por tools/anatomy/install-s0028-trunks.ts. Nodos x, y, z, r (mm LAS) en el sentido del flujo, en décimas de mm. */
import { s0028Nodes } from './people/s0028/base62';

const tenths = (s: string) => s0028Nodes(s, 10);
/** Troncos de s0028 desde sus máscaras: radio de referencia y nodos. */
export const S0028_TRUNKS = {
  portalSplenic: [3.3, tenths('VE0UyvUnHV0XTJVAV8V1SpV5V5UyTCVAVAUzTrVMUyUzU3VVUoV2RoX7TPV6U8VFUmUyTjUuUuUz')],
  pvTrunk: [5.9, tenths('V0tV2RUlVV0sTsURVcVBUoUwV9V0UYUtVMUzTwUyVvUwTyV5VkV0TuV3VdUwUHUzVMUwTgUrVXUw')],
  pvRight: [3.9, tenths('UtsV1dUpnV0kTpUsVDUzUVUxV6UxUnUzV3UzUsUzV1UzUtV0V2UzUnUzV4UzURUyV9UwTkUyVNUw')],
  pvLeft: [4, tenths('UtsV1dUpnV0fWOWRVkV1V6V8V4V0VDVLVEV0VEVVVJUzV7VQVFUzV8VqVPUxV3VhVHV1V7XQVbV2')],
  aorta: [9.7, tenths('V3OUvEVGAV20UkTnR9UmVGVCPUUoUwVwQ1V5TsWLNZUyVJVoPIUsV3VwQqUiVHXjKkUqUbV4PMV2')],
  ivcInfra: [10.8, tenths('UzOUzmUTdV1dU9VHXEV4VDUkZ8V1VCUHaIV1UIUdaZVDVHV3bMUrUsVEXmUZVCWRZ7VbUNVZZKVG')],
  hvRight: [3.4, tenths('UkXUzFUiXV0KVcTzWhV0WXU3XvV6WFUrXKVAW1V3W1UyXNUxWXV2XVVnX1V0X8VyWlUuXUVYUrUy')],
  hvRightAnterior: [2.2, tenths('Uk3V35UjvV0KVNUDVgV1VWU7VsV0VMUJVfV0VPU0VnV1VRU5VjV3VXUBVqV6VVUWVYV5VbUbVJV2')],
  hvRightPosterior: [2.5, tenths('Up7UxxUlCV0LUPUoVqV2UjUuVPV1UuUyV9V1UwUzV7V1UxUzV3V0UvUxVAV1UmUtVOV2UVUkVrV3')],
  hvLeft: [2.7, tenths('UziVAgUopV0SUoTUX9UwUyUoVGV1UWSfXcV3UyUgVLUzV0UqV9V0V0UuV4V0V7U8VfUyVaRoXDV3')],
  hvMiddle: [2.8, tenths('UkzV6KUmAV0LVuUsVvV3XnUzXDV4WOUpWLV2VcUkVbV6XbT2XSUzX6TfWVUsWOUeVrUzXuUuWEUy')],
  hvMiddleTributary: [2.9, tenths('UqyV8PUohV0NUyU6VnV4UzUhVIV1V0UsV7V1V0UwV4V0UzUxV3V0V0UtV8V1UxUhVKV1UuUEVtV4')],
  hvCommonTrunk: [2.8, tenths('UzfV1zUxGV0SU4TQVZV0')],
  pvRightAnterior: [2.4, tenths('Uq6V1LUqfV0aUCVBVsUzUSUlVtUxUzUhWGUwV1VCW4UwUcVcWBUxUcVcW5V0V3VgW0V0V9VfW5Uy')],
  pvRightPosterior: [2.4, tenths('UsKV1NUpyV0WUzSnTOV0V3U4UkUzUwTmV5UyUjUAVGUzUYURVLUyT3TvW8UuTvUVVIUzTQUBV2V0')],
  pvLeftLateral: [1.8, tenths('Uw3V61UsBV0IYNUIWrV0WGUoVfV0W9UuVYV0VLV0V8V0VPV0V9V0ViV2VDV0XlVEVbV0XeVBVUV0')],
  pvLeftMedial: [1.9, tenths('Uw3V6eUsLV0jTMVRV7UuUUV7V9UuUTV6VJUsSJV0XAUtUfV0VXV1UqUyVhV0V5UyVhV0VnUwWgUz')],
} as const;
/** Ramas portales propias de s0028 además de las de segundo orden: vaso madre (su velocidad y su pared) y nodos, del origen a la punta. */
export const S0028_PORTAL_BRANCHES = [
  ['pvLeftLateral', tenths('V0KV5eUuWV0UVeVoV0UyVAVKVAUzVKVKV0UzVeW8V0Uz')],
  ['pvLeftLateral', tenths('Uw8V8OUsaV0MXkWmVyV0VKVAV0V0VAV0VAV0WmVeVoV0')],
  ['pvLeftLateral', tenths('UxaV92UtiV0LVyUqWIV0VAUqV0V0V0V0VAV0WSUMW8Uz')],
  ['pvLeftLateral', tenths('Uw8V7uUsaV0NVUVAU2V0VUVAUCV0VoV0V0UzVoV0VoUz')],
  ['pvLeftMedial', tenths('UuWV6SUsQV0JVAU2VyV0VUU2WcUzV0UMW8UyUCUgVyUz')],
  ['pvRightPosterior', tenths('UsQUvoUoYV0UWITiWwUuVAV0VKUzV0UqVKUzUgUCXuUv')],
  ['pvRightPosterior', tenths('UrwUy4UnkV0USaTsTYUtUqUqUqV0UqV0V0V0SQUCTOV0')],
  ['pvRightAnterior', tenths('UoiV0UUuCV0SW8SaWIUuVATiV0V0TYSaUMUvTsTEUCV0')],
  ['pvRightAnterior', tenths('UqKUxQUvoV0PVUV0WIUvV0VAVAUzVKVAVUUyVyVyWSUy')],
  ['pvRightAnterior', tenths('UoOUzWUuqV0RTYUgWIUsU2V0WSUzUqVAWIV0VeV0WIUz')],
  ['pvRightAnterior', tenths('UoYV1mUw8V0TVeUgWIUuV0V0VAUzVAV0VAUzVyUWXQUv')],
  ['pvRightAnterior', tenths('UpMV1wUqyV0STiWmTiUtTsVyTsV0UWVAUMV0TiVeSaUy')],
  ['pvRightAnterior', tenths('UoEV1cUsQV0UU2WmVoUuUCVyVeUxUWVUVeV0UWVoWSUy')],
  ['pvRightPosterior', tenths('UrwV1IUq0V0UUgUCTYUzUWUqU2UvTYUqTsUxT4UqUWV0')],
] as const;
/** Tributarias suprahepáticas propias de s0028: vena madre y nodos, de la punta a la unión (sentido del flujo). */
export const S0028_HEPATIC_BRANCHES = [
  ['hvRightAnterior', tenths('UjEUysUqAV0JWmTsUgV4VAV0V0V1V0V0V0V0WwUgUMVA')],
  ['hvMiddle', tenths('Uq0V6mUsuV0UW8TiVAV5VKUgV0V0VAUqV0V0W8UCVAV0')],
  ['hvRight', tenths('UqAUzMV0AV0FWmV0TiV0XQUgTEV0VAV0UqV0W8UqU2V0')],
  ['hvMiddle', tenths('UoEV2aUvAV0ZX6VAVAV0VyV0V0V0WmV0UgV0WIVKUWV0')],
  ['hvRight', tenths('UqAUtOUrSV0NVoVeVeV0VyW8VUV0VUVyVKV0V0WIV0V0')],
] as const;
