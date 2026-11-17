import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { NORMAL_ADULT } from '../../../cases';
import { setAbdominalAtlas } from './abdominalAtlas';
import { S0028_BUNDLE, installAnatomyBundle } from './anatomyBundle';
import { setAbdominalBody } from './referenceBody';
import { setS0028Solids } from './s0028Solids';
import { setS0028Wall } from './s0028Wall';
import { AnatomyScene } from './scene';
import { setThoracicAtlas } from './thoracicAtlas';

/** Un recurso de s0028 (`src/anatomy/s0028/<name>.gzip.bin`) descomprimido, en un buffer nuevo en cada llamada. */
export const s0028Raw = (name: string): ArrayBuffer =>
  new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;

/**
 * La persona s0028 completa en Node, para las pruebas y las herramientas: su bundle, los atlas abdominal y torácico, la pared, los
 * sólidos y el perfil del cuerpo, y la escena del adulto sano. Devuelve también los buffers instalados, que algunas pruebas leen o
 * vuelven a instalar después.
 *
 * Quien la llame desde un `beforeAll` le da 60 s (`60_000`): cargar la persona tarda 2 s y unos 7 s bajo cobertura (pared, sólidos y
 * escena, 2,3 s cada uno), y con la máquina cargada o un runner lento se agota el tope de 10 s por defecto.
 */
export function loadS0028Fixture(): { scene: AnatomyScene; abdominal: Uint16Array; capacity: ArrayBuffer; skin: ArrayBuffer } {
  installAnatomyBundle(S0028_BUNDLE);
  const abdominal = new Uint16Array(s0028Raw('abdominal-direct'));
  setAbdominalAtlas(abdominal);
  setThoracicAtlas(new Uint16Array(s0028Raw('thoracic-direct')));
  const capacity = s0028Raw('annotation-capacity'),
    skin = s0028Raw('skin-polar');
  setS0028Wall(capacity, skin);
  setS0028Solids(capacity);
  setAbdominalBody(new Float32Array(new Uint8Array(readFileSync('src/anatomy/abdominal-body.bin')).buffer));
  return { scene: new AnatomyScene(NORMAL_ADULT), abdominal, capacity, skin };
}
