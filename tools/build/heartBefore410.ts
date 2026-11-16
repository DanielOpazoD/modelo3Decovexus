/**
 * El GLSL de antes del latido de los ventrículos (decisión 410): la ranura de `uMotion` era la velocidad del diafragma sola
 * (`uRespVel`) y las cavidades no latían. Las pruebas de huellas la aplican para comprobar que la revisión 410 solo cambia eso.
 */
const PAIRS: readonly (readonly [string, string])[] = [
  ['uniform vec3 uMotion;', 'uniform float uRespVel;'],
  ['uResp.yzw * (uMotion.x * respWeight(m))', 'uResp.yzw * (uRespVel * respWeight(m))'],
  ['\nconst vec4 HEART_SHORTENING = vec4(0.1000,0.3300,0.1500,0.2000);\nconst float RA_SHORTENING = 0.1500;', ''],
  [
    `vec4 heartChambersAt(vec3 m, vec4 b, float s) {
  vec3 q = heartFrame(m);
  float lv0 = sdEllipsoidLocal(q, HV[4]);
  float lv = sdEllipsoidLocal(q, HV[4] * b.xyy);
  float la = sdEllipsoidLocal(m - heartShift() - HV[9], HV[10]);
  float ra = sdEllipsoidLocal(raFrame(m) + vec3(0.0, 0.0, (1.0 - s) * HV[8].z), HV[8] * vec3(1.0, 1.0, s));
  return vec4(lv, max(sdEllipsoidLocal(q - HV[5], HV[6] * b.zww), HW[1].x - lv0), max(ra, max(HW[1].y - la, HW[1].z - lv0)), la);
}
vec4 heartChambers(vec3 m) { return heartChambersAt(m, vec4(1.0), 1.0); }`,
    `vec4 heartChambers(vec3 m) {
  vec3 q = heartFrame(m);
  float lv = sdEllipsoidLocal(q, HV[4]);
  float la = sdEllipsoidLocal(m - heartShift() - HV[9], HV[10]);
  return vec4(lv, max(sdEllipsoidLocal(q - HV[5], HV[6]), HW[1].x - lv), max(raSdf(m), max(HW[1].y - la, HW[1].z - lv)), la);
}`,
  ],
  [
    `  vec4 c0 = heartChambers(m);
  vec4 c = heartChambersAt(m, vec4(1.0) - HEART_SHORTENING * uMotion.yyzz, 1.0 - RA_SHORTENING * (1.0 - uMotion.y));
  float p = HW[1].w;
  vec4 cc = max(c, vec4(hF + p) + HW[0]);
  float cav = min(min(cc.x, cc.y), min(cc.z, cc.w));
  vec4 e = c0 - HW[0];`,
    `  vec4 c = heartChambers(m);
  float p = HW[1].w;
  vec4 cc = max(c, vec4(hF + p) + HW[0]);
  float cav = min(min(cc.x, cc.y), min(cc.z, cc.w));
  vec4 e = c - HW[0];`,
  ],
];

/** Deshace la revisión 410 en un programa que la contiene; un programa sin corazón ni uniforms queda igual. */
export function heartBefore410(text: string): string {
  for (const [now, before] of PAIRS) text = text.split(now).join(before);
  return text;
}
