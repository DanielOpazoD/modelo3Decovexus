const version = document.documentElement.dataset.maquetaVersion;
const status = document.querySelector('#status');
const base = new URL('.', import.meta.url);

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
}

async function decompress(ref) {
  const parts = [];
  for (const part of ref.parts) {
    const response = await fetch(new URL(part.path, base));
    if (!response.ok) throw new Error(`No se pudo cargar ${part.path}: ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== part.bytes || (await sha256(bytes)) !== part.sha256) {
      throw new Error(`Fragmento ausente o alterado: ${part.path}`);
    }
    parts.push(bytes);
  }
  const stream = new Blob(parts).stream().pipeThrough(new DecompressionStream('gzip'));
  const result = await new Response(stream).arrayBuffer();
  if (result.byteLength !== ref.rawBytes) throw new Error('Tamaño de datos inesperado');
  return result;
}

window.__maquetaUnpack = async (payload) => {
  const ref = payload?.$payload;
  if (!ref) throw new Error('Referencia de datos inválida');
  const result = await decompress(ref);
  if (ref.patch) {
    const patch = new DataView(await decompress(ref.patch));
    const target = new DataView(result);
    const count = patch.getUint32(0, true);
    if (patch.byteLength !== 4 + 8 * count) throw new Error('Parche anatómico incompleto');
    let previous = -1;
    for (let i = 0; i < count; i++) {
      const index = patch.getUint32(4 + 8 * i, true);
      if (index <= previous || index * 4 + 4 > target.byteLength) {
        throw new Error('Índice inválido en el parche anatómico');
      }
      target.setUint32(index * 4, patch.getUint32(8 + 8 * i, true), true);
      previous = index;
    }
  }
  return result;
};

try {
  if (!['102', '103'].includes(version)) throw new Error('Versión de maqueta desconocida');
  if (!globalThis.DecompressionStream || !crypto.subtle) {
    throw new Error('Se necesita un navegador reciente y localhost para cargar la maqueta.');
  }
  const response = await fetch(new URL(`metadatos-${version}.json`, base));
  if (!response.ok) throw new Error(`Metadatos no disponibles: ${response.status}`);
  window.DATA = await response.json();
  await import(version === '102' ? './visor-102.js' : './visor-103.js');
} catch (error) {
  if (status) status.textContent = `No se pudo abrir la maqueta: ${error.message}`;
  console.error(error);
}
