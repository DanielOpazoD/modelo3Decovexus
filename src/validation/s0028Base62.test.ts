import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { encodeS0028Nodes } from '../../tools/anatomy/s0028Base62';
import { s0028Nodes } from '../anatomy/people/s0028/base62';
import { S0028_RENAL_NETWORK } from '../anatomy/s0028RenalNetworkData';
import { S0028_HEPATIC_BRANCHES, S0028_PORTAL_BRANCHES, S0028_TRUNKS } from '../anatomy/s0028TrunksData';

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

it('troncos, ramas propias y red interlobar de s0028 en base 62: los mismos nodos que las tablas decimales, y los que escribe la herramienta', () => {
  // SHA-256 del JSON de las tablas decimales anteriores (main 70e3691): compactarlas no cambió ningún nodo ni su orden.
  expect(sha(S0028_TRUNKS)).toBe('e328ea94f563d3f415a2637797bc3d5d3e14291da63b309fd35707677ead1933');
  expect(sha(S0028_PORTAL_BRANCHES)).toBe('64e892f3a2c1a539d2fa2644f238cd61779d5e4aedb316286acbb7171a600f86');
  expect(sha(S0028_HEPATIC_BRANCHES)).toBe('cac8847434f0dc0ac0d1a5667b710058248a5fdc9755eb44f9fcf134325fba7b');
  expect(sha(S0028_RENAL_NETWORK)).toBe('1895ecfbb036bd4da18b4bc1183681b8697dd1fa017541364726c3356f3d88bf');
  const modules = ['src/anatomy/s0028TrunksData.ts', 'src/anatomy/s0028RenalNetworkData.ts'].map((f) => readFileSync(f, 'utf8')).join('');
  const strings = [...modules.matchAll(/(tenths|hundredths)\('([^']*)'\)/g)];
  // 17 troncos, 14 ramas portales y 5 tributarias; 16 pares interlobares
  expect(strings).toHaveLength(17 + 14 + 5 + 2 * 16);
  for (const [, unit, s] of strings) {
    const scale = unit === 'tenths' ? 10 : 100;
    expect(encodeS0028Nodes(s0028Nodes(s, scale), scale)).toBe(s);
    // Una sola palabra de cifras y letras: con otros signos, o con una cifra delante, reservaría nombres cortos del GLSL en el build.
    expect(s).toMatch(/^[A-Za-z][0-9A-Za-z]*$/);
  }
});

it('nodos en base 62: límites de cada forma, valores fuera de la rejilla y cadenas truncadas', () => {
  // Primer nodo con tres cifras por valor (±62³/2 décimas) y los demás con incrementos de dos (−62²/2 a 62²/2 − 1).
  const edges = [
    [-11916.4, 11916.3, 0, 0.1],
    [-11724.3, 11724.1, -192.2, 192.2],
  ];
  expect(s0028Nodes(encodeS0028Nodes(edges, 10), 10)).toEqual(edges);
  expect(() => encodeS0028Nodes([[-11916.5, 0, 0, 0]], 10)).toThrow(RangeError);
  expect(() =>
    encodeS0028Nodes(
      [
        [0, 0, 0, 0],
        [192.2, 0, 0, 0],
      ],
      10,
    ),
  ).toThrow(RangeError);
  expect(() => encodeS0028Nodes([[0, 0, 0, 0.05]], 10)).toThrow('fuera de la rejilla');
  expect(() => encodeS0028Nodes([[0, 0, 0]], 10)).toThrow('sin x, y, z y r');
  expect(() => s0028Nodes(encodeS0028Nodes(edges, 10).slice(0, -1), 10)).toThrow('Nodos s0028 truncados');
});
