/**
 * El GLSL de antes de la vesícula en ayunas de s0028 (decisión 413): su dueño y su luz eran el canal vesicular del atlas (la
 * máscara contraída del TAC) y nada cedía dentro de ella. Las pruebas de huellas la aplican para comprobar que la revisión 413
 * solo cambia eso, y solo en los programas de s0028.
 */
const PAIRS: readonly (readonly [string, string])[] = [
  [
    `
// Vesícula en ayunas de esta persona (decisión 413): la pera de uGbNodes con su gradiente exacto, sin el canal del atlas, que
// en su TAC está contraída (gemelo: gallbladderPearSdf; las mismas operaciones que gallbladderSdf sin atlas).
float s28GbPear(vec3 m,out vec3 n){
  vec3 g;
  float d=gbSegment(m,uGbNodes[0],uGbNodes[1],n);
  for(int i=1;i<4;i++){
    float di=gbSegment(m,uGbNodes[i],uGbNodes[i+1],g);
    float h=clamp(0.5+0.5*(di-d)/uGbExtra.x,0.0,1.0);
    n=mix(g,n,h);
    d=smoothMin(d,di,uGbExtra.x);
  }
  return d;
}`,
    '',
  ],
  [
    `// e: la luz de la vesícula (su pera, decisión 413) y el riñón más cercano (su borde O es la cara acústica). El dueño vesicular llega
// a la cara externa de su pared; dentro de él ceden el hígado, el bazo, el páncreas, la vejiga y el tubo digestivo.
int s28POwn(vec3 m,vec4 q,bool valid,out int k,out float d,out vec4 b,out vec2 e){
  int n=0;k=-1;d=16.0;S28_NEAR=nearS28(m);
  vec3 gn;e.x=s28GbPear(m,gn);
  float gb=e.x-1.800;bool soft=gb>=0.0;
  if(soft)s28PAdd(n,k,d,0,s28PA(m,0));
  if(soft)s28PAdd(n,k,d,1,s28PA(m,1));
  if(soft)s28PAdd(n,k,d,2,s28PA(m,2));
  float kr=s28PA(m,3),kl=s28PA(m,4);
  s28PAdd(n,k,d,3,kr);
  s28PAdd(n,k,d,4,kl);
  e.y=min(kr,kl);
  s28PAdd(n,k,d,5,gb);
  if(soft)s28PAdd(n,k,d,6,s28PA(m,6));
  if(soft)s28PAdd(n,k,d,7,s28PA(m,7));`,
    `// e: vesícula y el riñón más cercano (su borde O es la cara acústica).
int s28POwn(vec3 m,vec4 q,bool valid,out int k,out float d,out vec4 b,out vec2 e){
  int n=0;k=-1;d=16.0;S28_NEAR=nearS28(m);
  s28PAdd(n,k,d,0,s28PA(m,0));
  s28PAdd(n,k,d,1,s28PA(m,1));
  s28PAdd(n,k,d,2,s28PA(m,2));
  float kr=s28PA(m,3),kl=s28PA(m,4);
  s28PAdd(n,k,d,3,kr);
  s28PAdd(n,k,d,4,kl);
  e=vec2(s28PA(m,5),min(kr,kl));
  s28PAdd(n,k,d,5,e.x);
  s28PAdd(n,k,d,6,s28PA(m,6));
  s28PAdd(n,k,d,7,s28PA(m,7));`,
  ],
  ['vec3 gn;float dGb=e.x;', 'vec3 gn;float dGb=e.x+1.800;'],
  ['if(dGb<0.0||dGb<uGbExtra.y)s28GbPear(m,gn);', 'if(dGb<0.0||dGb<uGbExtra.y)gn=abdominalAtlasGradient(m,7);'],
];

/** Deshace la revisión 413 en un programa que la contiene; un programa sin la clasificación de s0028 queda igual. */
export function gallbladderBefore413(text: string): string {
  for (const [now, before] of PAIRS) text = text.split(now).join(before);
  return text;
}
