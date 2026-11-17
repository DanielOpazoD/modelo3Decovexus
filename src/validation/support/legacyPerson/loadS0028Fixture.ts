import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { NORMAL_ADULT } from '../../../cases';
import { setAbdominalAtlas } from './abdominalAtlas';
import { S0028_BUNDLE, installAnatomyBundle } from './anatomyBundle';
import { setAbdominalBody } from './referenceBody';
import { AnatomyScene } from './scene';
import { stage } from './state';
import { setThoracicAtlas } from './thoracicAtlas';

/** Un recurso de s0028 (`src/anatomy/s0028/<name>.gzip.bin`) descomprimido, en un buffer nuevo en cada llamada. */
export const s0028Raw = (name: string): ArrayBuffer =>
  new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;

/**
 * La persona s0028 completa en Node, para las pruebas y las herramientas: su bundle, los atlas abdominal y torácico, la reserva (pared
 * y sólidos), la piel y el perfil del cuerpo, y la escena del adulto sano. Devuelve también los buffers instalados, que algunas
 * pruebas leen o vuelven a instalar después.
 *
 * La persona se construye una sola vez, con la escena, como en la aplicación (`installS0028Cpu`): la reserva y la piel se dejan
 * preparadas sin pasar por `setS0028Wall` ni `setS0028Solids`, que la construyen entera cada uno solo para validar su parte. La
 * misma construcción las valida igual (un recurso corrupto falla al crear la escena) y la carga baja de 2,6 a 1,3 s de CPU (medido
 * el 17-11-2026).
 *
 * Quien la llame desde un `beforeAll` le da 60 s (`60_000`): bajo cobertura cada construcción tarda unos 2,3 s, además de leer y
 * descomprimir los recursos, y con la máquina cargada o un runner lento se agota el tope de 10 s por defecto.
 */
export function loadS0028Fixture(): { scene: AnatomyScene; abdominal: Uint16Array; capacity: ArrayBuffer; skin: ArrayBuffer } {
  installAnatomyBundle(S0028_BUNDLE);
  const abdominal = new Uint16Array(s0028Raw('abdominal-direct'));
  setAbdominalAtlas(abdominal);
  setThoracicAtlas(new Uint16Array(s0028Raw('thoracic-direct')));
  const capacity = s0028Raw('annotation-capacity'),
    skin = s0028Raw('skin-polar');
  stage({ capacity, skin });
  setAbdominalBody(new Float32Array(new Uint8Array(readFileSync('src/anatomy/abdominal-body.bin')).buffer));
  return { scene: new AnatomyScene(NORMAL_ADULT), abdominal, capacity, skin };
}
