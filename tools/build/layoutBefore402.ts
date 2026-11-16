/**
 * Las constantes de disposición de la textura de escena de antes de la decisión 402 (128 tubos y 640 nodos): todas las bases tras
 * las cabeceras se mueven 320 téxeles (32 cabeceras de 5 y 160 nodos).
 */
export function layoutBefore402(text: string): string {
  return text
    .replace(/#define MAX_TUBES 160\b/, '#define MAX_TUBES 128')
    .replace(/#define MAX_NODES 800\b/, '#define MAX_NODES 640')
    .replace(/#define NODE_BASE 800\b/, '#define NODE_BASE 640')
    .replace(/#define COMP_BASE 1600\b/, '#define COMP_BASE 1280')
    .replace(/#define BOWEL_BASE 2578\b/, '#define BOWEL_BASE 2258')
    .replace(/sceneTexel\(2526 \+/g, 'sceneTexel(2206 +')
    .replace(/sceneTexel\(2562 \+/g, 'sceneTexel(2242 +')
    .replace(/sceneTexel\(2687\+/g, 'sceneTexel(2367+');
}
