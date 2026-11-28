import { S0028_BUNDLE as B } from './descriptor';

export const S0028_DEPTH_TEXTURE_WIDTH = 1024;

/** Cuatro nodos XY contiguos de la EDT por texel. Conserva los bits half del campo CPU y duplica el borde de la caja. */
export function packS0028DepthQuads(atlas: Uint16Array | undefined) {
  if (!atlas || atlas.length * 2 !== B.abdominal.rawBytes) throw new Error('EDT s0028 sin atlas abdominal completo');
  const [nx, ny, nz] = B.depth.dimensions;
  const [ox, oy, oz] = B.depth.offset;
  const [atlasWidth, atlasHeight] = B.abdominal.textureDimensions;
  const rowWords = 2 * atlasWidth;
  const sliceWords = rowWords * atlasHeight;
  const width = S0028_DEPTH_TEXTURE_WIDTH;
  const height = Math.ceil((nx * ny * nz) / width);
  const data = new Uint16Array(width * height * 4);
  let target = 0;
  for (let z = 0; z < nz; z++) {
    const slice = (oz + z) * sliceWords + 2 * ox;
    for (let y = 0; y < ny; y++) {
      const row = slice + (oy + y) * rowWords;
      const nextRow = y + 1 < ny ? row + rowWords : row;
      for (let x = 0; x < nx; x++) {
        const column = 2 * x;
        const nextColumn = x + 1 < nx ? column + 2 : column;
        data[target++] = atlas[row + column];
        data[target++] = atlas[row + nextColumn];
        data[target++] = atlas[nextRow + column];
        data[target++] = atlas[nextRow + nextColumn];
      }
    }
  }
  return { width, height, data };
}
