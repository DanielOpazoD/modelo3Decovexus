import { ABDOMINAL_FIELDS } from '../abdominalAtlasData';
import type { PersonDescriptors } from '../anatomyBundle';
import { gastricGlsl, GASTRIC_WALL } from '../organs/abdomen';
import { HEART_SHAPE, heartShapeGlsl } from '../organs/heart';
import { GASTRIC_312, S0028_HEART } from '../people/s0028/cpu';
import { S0028_DEPTH_TEXTURE_WIDTH } from '../people/s0028/depthTexture';
import { S0028_READER_GLSL } from './s0028Solids.glsl';
import { s0028WallShader } from './s0028Wall.glsl';

/**
 * Una fuente por persona: la de la persona por defecto, intacta, o la de s0028 con sus lectores P1 (atlas abdominal y
 * torácico, gas, piel), la pared P2 y los sólidos P3 (`s0028WallShader`).
 * @twin tronco-primitivas
 * @twin atlas-abdominal
 * @twin atlas-toracico
 * @twin s0028-digestivo
 * @twin s0028-lector
 * @twin eco-interfaz
 */
export function personShader(source: string, selection: { person: 'current' } | { person: 's0028'; bundle: PersonDescriptors }): string {
  if (selection.person === 'current' || !/vec2\s+abdominalAtlasValue\s*\(/.test(source)) return source;
  const { fields, depth } = selection.bundle;
  const field = (name: string, asset: 'abdominal' | 'thoracic') => {
    const found = fields.find((f) => f.name === name);
    if (!found || found.asset !== asset || found.pitchMm !== 1.5) throw new Error('Falta campo B o procedencia: ' + name);
    return found;
  };
  const unknown = { originMm: [0, 0, 0], dimensions: [0, 0, 0], offset: [0, 0, 0] };
  const abdominal = ABDOMINAL_FIELDS.map((f) => (['psoas', 'lumbarDiscs'].includes(f.name) ? unknown : field(f.name, 'abdominal')));
  const bone = field('thoracicBone', 'thoracic');
  field('digestiveTract', 'abdominal');
  if (depth.pitchMm !== 3) throw new Error('Pitch de profundidad distinto');
  const vec = (v: readonly number[]): string => `vec3(${v.map((n) => n.toFixed(15)).join(',')})`;
  const tables = (['originMm', 'dimensions', 'offset'] as const)
    .map(
      (key, i) => `const vec3 S28_${['LO', 'DIM', 'OFF'][i]}[${abdominal.length}]=vec3[](${abdominal.map((f) => vec(f[key])).join(',')});`,
    )
    .join('\n');
  const reader = `
${tables}
vec2 abdominalAtlasValue(vec3 p,int k){
  if(uAbdominalAtlasEnabled==0||k<0||k>=${abdominal.length})return vec2(16.0,0.0);
  vec3 dim=S28_DIM[k],off=S28_OFF[k],q=(p-S28_LO[k])/1.5;
  if(any(lessThan(q,vec3(0.0)))||any(greaterThan(q,dim-1.0)))return vec2(16.0,0.0);
  float d=textureLod(uAbdominalAtlas,(off+q+0.5)/vec3(textureSize(uAbdominalAtlas,0)),0.0).r;
  if(k==8&&abs(d)<1.5)d=sourceDistancePrecise(uAbdominalAtlas,q,ivec3(dim),ivec3(off));
  float label=texelFetch(uAbdominalAtlas,ivec3(off+floor(q+0.5)),0).g;
  return vec2(d,mod(label,128.0));
}
float s28Gas(vec3 p){
  vec3 q=(p-S28_LO[1])/1.5;
  if(any(lessThan(q,vec3(0.0)))||any(greaterThan(q,S28_DIM[1]-1.0)))return 0.0;
  // Sin la burbuja del estómago (rótulo 1): gemelo de sourceGas (decisión 363).
  float v=texelFetch(uAbdominalAtlas,ivec3(S28_OFF[1]+floor(q+0.5)),0).g;
  return v>=128.0&&mod(v,128.0)!=1.0?1.0:0.0;
}
vec2 thoracicValue(vec3 p){
  if(uAbdominalAtlasEnabled==0)return vec2(16.0,0.0);
  vec3 q=(p-${vec(bone.originMm)})/1.5;
  if(any(lessThan(q,vec3(0.0)))||any(greaterThan(q,${vec(bone.dimensions.map((n) => n - 1))})))return vec2(16.0,0.0);
  float d=textureLod(uThoracicAtlas,(${vec(bone.offset)}+q+0.5)/vec3(textureSize(uThoracicAtlas,0)),0.0).r;
  if(abs(d)<1.5)d=sourceDistancePrecise(uThoracicAtlas,q,ivec3(${bone.dimensions.join(',')}),ivec3(${bone.offset.join(',')}));
  return vec2(d,texelFetch(uThoracicAtlas,ivec3(${vec(bone.offset)}+floor(q+0.5)),0).g);
}
`;
  let changed = source.replace(/const\s+vec3\s+ATLAS_(LO|DIM|OFF)\[\d+\]\s*=\s*vec3\[\]\([^;]+;/g, '');
  changed = replaceFunction(changed, 'vec2', 'abdominalAtlasValue', '');
  changed = replaceFunction(changed, 'vec2', 'thoracicValue', reader);
  changed = replaceFunction(changed, 'vec4', 'registeredDomeSample', 'vec4 registeredDomeSample(vec2 p){return vec4(0.0);}');
  changed = replaceFunction(changed, 'vec2', 'hepaticDomeValue', 'vec2 hepaticDomeValue(vec2 p){return vec2(0.0);}');
  changed = replaceFunction(
    changed,
    'float',
    'torsoDepth',
    /* glsl */ `// En s0028 la unidad del perfil corporal contiene los cuatro nodos XY de la EDT, en el orden 00,10,01,11.
  vec4 s28DepthQuad(ivec3 i){
    int k=(i.z*${depth.dimensions[1]}+i.y)*${depth.dimensions[0]}+i.x;
    return texelFetch(uBodyCoefficients,ivec2(k%${S0028_DEPTH_TEXTURE_WIDTH},k/${S0028_DEPTH_TEXTURE_WIDTH}),0);
  }
  float torsoDepth(vec3 p){
    const ivec3 last=ivec3(${depth.dimensions.map((n) => n - 1).join(',')});
    vec3 q=(p-${vec(depth.originMm)})/3.0;
    vec3 at = clamp(q, vec3(0.0), vec3(last));
    ivec3 cell = min(ivec3(at), last - 1);
    vec3 f = at - vec3(cell);
    vec4 lo = s28DepthQuad(cell), hi = s28DepthQuad(cell + ivec3(0, 0, 1));
    vec2 l = mix(lo.xz, lo.yw, f.x), h = mix(hi.xz, hi.yw, f.x);
    return mix(mix(l.x, l.y, f.y), mix(h.x, h.y, f.y), f.z) + 3.0 * length(q - at);
  }`,
  );
  changed = replaceFunction(
    changed,
    'vec3',
    'torsoNormal',
    /* glsl */ `// La trilineal de la EDT y su diferencia central a medio vóxel comparten la celda (gemela de s0028DepthGradient).
  // Dos lecturas de la celda, dos por la cara vecina X e Y y una por Z.
  float s28DepthAndGradient(vec3 p,out vec3 g){
    const ivec3 last=ivec3(${depth.dimensions.map((n) => n - 1).join(',')});
    vec3 q=(p-${vec(depth.originMm)})/3.0;
    vec3 at = clamp(q, vec3(0.0), vec3(last));
    ivec3 cell = min(ivec3(at), last - 1);
    vec3 f = at - vec3(cell), side = step(vec3(0.5), f);
    ivec3 e = clamp(cell + ivec3(3.0 * side - 1.0), ivec3(0), last) - cell;
    vec4 lo = s28DepthQuad(cell), hi = s28DepthQuad(cell + ivec3(0, 0, 1));
    vec4 xy = mix(lo, hi, f.z);
    vec2 x = mix(xy.xy, xy.zw, f.y), y = mix(xy.xz, xy.yw, f.x);
    vec2 z = mix(mix(vec2(lo.x, hi.x), vec2(lo.y, hi.y), f.x), mix(vec2(lo.z, hi.z), vec2(lo.w, hi.w), f.x), f.y);
    vec2 yz = mix(s28DepthQuad(cell + ivec3(e.x, 0, 0)).xz, s28DepthQuad(cell + ivec3(e.x, 0, 1)).xz, f.z);
    vec2 xz = mix(s28DepthQuad(cell + ivec3(0, e.y, 0)).xy, s28DepthQuad(cell + ivec3(0, e.y, 1)).xy, f.z);
    vec4 crossZ = s28DepthQuad(cell + ivec3(0, 0, e.z));
    vec3 outer = vec3(mix(yz.x, yz.y, f.y), mix(xz.x, xz.y, f.x), mix(mix(crossZ.x, crossZ.y, f.x), mix(crossZ.z, crossZ.w, f.x), f.y));
    vec3 a = clamp(q - 0.5, vec3(0.0), vec3(last)), b = clamp(q + 0.5, vec3(0.0), vec3(last));
    vec3 l = a - vec3(cell), r = b - vec3(cell);
    vec3 innerSpan = clamp(r, 0.0, 1.0) - clamp(l, 0.0, 1.0), outerSpan = max(-l, r - 1.0);
    vec3 low = vec3(x.x, y.x, z.x), high = vec3(x.y, y.y, z.y);
    g = (innerSpan * (high - low) + outerSpan * (outer - mix(low, high, side)) * (2.0 * side - 1.0)) / 3.0;
    // La extensión euclídea de la CPU fuera de la caja, a los dos extremos de cada eje.
    vec3 d = q - at;
    float dd = dot(d, d);
    vec3 rest = max(vec3(0.0), dd - d * d), da = q - 0.5 - a, db = q + 0.5 - b;
    g += sqrt(rest + db * db) - sqrt(rest + da * da);
    return mix(z.x, z.y, f.z) + 3.0 * sqrt(dd);
  }
  vec3 s28DepthGradient(vec3 p){vec3 g;s28DepthAndGradient(p,g);return g;}
  vec3 torsoNormal(vec3 p){return normalize(s28DepthGradient(p));}`,
  );
  changed = replaceFunction(changed, 'vec3', 'torsoDepthGrad', 'vec3 torsoDepthGrad(vec3 p){return s28DepthGradient(p);}');
  changed = changed.replace(
    /bool\s+gas\s*=\s*inner\s*<\s*0\.0\s*&&\s*digestiveGasPlane\(m,label\)\s*>\s*0\.0;/,
    'bool gas=inner<0.0&&s28Gas(m)>0.5;',
  );
  changed = changed.replace(
    /const int THORACIC_MATERIALS\[\d+\]\s*=\s*int\[\d+\]\([^;]+;/,
    `const int THORACIC_MATERIALS[38]=int[38](${Array.from({ length: 38 }, (_, i) => (i >= 25 && i <= 36 ? 2 : 0)).join(',')});`,
  );
  changed = replaceFunction(
    changed,
    'int',
    'thoracicMaterial',
    'int thoracicMaterial(float label){return THORACIC_MATERIALS[clamp(int(label+.5),0,37)];}',
  );
  changed = replaceFunction(
    changed,
    'float',
    'digestiveWallMm',
    'float digestiveWallMm(float label){return label==1.0?3.0:label==4.0?2.5:2.0;}',
  );
  changed = replaceFunction(
    changed,
    'float',
    'digestiveGasPlane',
    'float digestiveGasPlane(vec3 m,float label){return s28Gas(m)>0.5?1.0:-1.0;}',
  );
  changed = changed.replace(/label\s*>=\s*5\.0\s*&&\s*label\s*<=\s*9\.0/g, 'label==4.0');
  // La luz del duodeno y del delgado de s0028 lleva contenido, no líquido anecoico (decisión 384; par de `smallBowelContents`).
  // La sentencia se reconoce por su forma, no por los nombres de los tejidos, que el build renombra: el último brazo (líquido)
  // toma el identificador del brazo del estómago.
  changed = changed.replace(/(\?\s*(\w+)\s*:\s*label\s*==\s*4\.0\s*\?\s*\w+\s*:\s*)\w+(\s*;)/g, '$1$2$3');
  // Lectores P1 de P3 (r3), antes de la pared y de la clasificación que los usan.
  changed = changed.replace('float respWeight(vec3 m)', S0028_READER_GLSL + '\nfloat respWeight(vec3 m)');
  // s0028 está en pausa (decisión 332): su estómago conserva las capas de la 312 y su contenido, sin dispersores fuertes
  changed = changed.replace(gastricGlsl(GASTRIC_WALL), gastricGlsl(GASTRIC_312)).replace(/\n *if \(t == T_GASTRIC_CONTENTS\)[^;]*;/, '');
  // s0028 está en pausa (decisión 327): su pared conserva la difusa de Lambert
  if (/float\s+wallDiffuseLobe\s*\(/.test(changed))
    changed = replaceFunction(changed, 'float', 'wallDiffuseLobe', 'float wallDiffuseLobe(float c){return 1.0;}');
  // Corazón de s0028 (decisión 356): las mismas funciones con sus cavidades; sólo cambian las constantes de forma.
  const schematic = heartShapeGlsl(HEART_SHAPE),
    own = heartShapeGlsl(S0028_HEART);
  if (changed.includes(schematic.vectors)) {
    if (!changed.includes(schematic.approachTop)) throw new Error('Falta el labio de la AD en el shader');
    changed = changed.replace(schematic.vectors, own.vectors).replace(schematic.approachTop, own.approachTop);
  }
  return s0028WallShader(changed, replaceFunction);
}

function replaceFunction(source: string, type: string, name: string, replacement: string): string {
  const at = source.search(new RegExp('\\b' + type + '\\s+' + name + '\\s*\\('));
  if (at < 0) throw new Error('Falta función GLSL ' + name);
  // Las declaraciones adelantadas pueden preceder a la definición.
  const brace = source.indexOf('{', at);
  const semicolon = source.indexOf(';', at);
  if (semicolon >= 0 && semicolon < brace) {
    const prefix = source.slice(0, semicolon + 1);
    return prefix + replaceFunction(source.slice(semicolon + 1), type, name, replacement);
  }
  let i = brace + 1,
    depth = 1;
  for (; depth && i < source.length; i++) depth += source[i] === '{' ? 1 : source[i] === '}' ? -1 : 0;
  if (brace < 0 || depth) throw new Error('Función GLSL sin cerrar: ' + name);
  return source.slice(0, at) + replacement + source.slice(i);
}
