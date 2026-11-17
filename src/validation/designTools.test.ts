import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  atLateral,
  axisAtZ,
  axisLengthWhere,
  designTubes,
  minWallGap,
  parseNodes,
  parseProposal,
  planeCoordinates,
  resolvePose,
  sampleAxis,
  tubeById,
  type DesignTube,
} from '../../tools/anatomy/tubeDesign';
import { GLYPH_CAPACITY, pairTable, renderTissueMap, tissueGlyph } from '../../tools/fidelity/windowGrid';
import { UsageError, parseCount, parseRange, readJsonArgument, runTool } from '../../tools/toolArgs';
import type { TubeNode } from '../anatomy/primitives';
import { TISSUE_COUNT, Tissue } from '../anatomy/tissues';
import type { DuctDef, VesselDef } from '../anatomy/vesselTree';
import type { StartPoint } from '../app/startPoints';
import type { Vec3 } from '../core/vec3';

/** Tubo recto de radio constante entre dos puntos, con pared de `wall` mm. */
const straight = (id: string, a: Vec3, b: Vec3, r: number, wall: number): DesignTube => ({
  id,
  tube: {
    kind: 'tube',
    apScale: 1,
    nodes: [
      { p: a, r },
      { p: b, r },
    ],
  },
  wallMm: () => wall,
  proposed: false,
});
const axis = (t: DesignTube) => sampleAxis(t.tube.nodes);

describe('herramientas de diseño: geometría de tubos (tools/anatomy/tubeDesign.ts)', () => {
  const bent: TubeNode[] = [
    { p: [0, 0, 0], r: 2 },
    { p: [0, 0, 10], r: 4 },
    { p: [6, 0, 18], r: 4 },
  ];

  it('el eje muestreado pasa por los nodos, no deja tramos de más de 0,5 mm y lleva el radio lineal y la longitud de arco', () => {
    const samples = sampleAxis(bent);
    for (const node of bent) expect(samples.some((s) => s.p.every((x, k) => x === node.p[k]) && s.r === node.r)).toBe(true);
    for (let i = 1; i < samples.length; i++) {
      const step = samples[i].arcMm - samples[i - 1].arcMm;
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThanOrEqual(0.5 + 1e-9);
    }
    // 10 mm rectos y después la hipotenusa de 6 y 8: 20 mm de eje.
    expect(samples.at(-1)!.arcMm).toBeCloseTo(20, 9);
    const mid = samples.find((s) => Math.abs(s.p[2] - 5) < 1e-9)!;
    expect(mid.r).toBeCloseTo(3, 9);
    expect(mid.arcMm).toBeCloseTo(5, 9);
  });

  it('la longitud dentro de una región es la del eje que cae en ella', () => {
    const samples = sampleAxis(bent);
    expect(axisLengthWhere(samples, () => true)).toBeCloseTo(20, 9);
    expect(axisLengthWhere(samples, () => false)).toBe(0);
    // El tramo recto por debajo de z = 4: 4 mm, con el error de media muestra en el borde.
    expect(axisLengthWhere(samples, (p) => p[2] < 4)).toBeCloseTo(4, 0);
  });

  it('el cruce de una altura se interpola y se cuenta una vez, también si cae justo en una muestra', () => {
    const samples = sampleAxis(bent);
    const [between] = axisAtZ(samples, 14);
    expect(axisAtZ(samples, 14)).toHaveLength(1);
    expect(between.p).toEqual([expect.closeTo(3, 9), 0, expect.closeTo(14, 9)]);
    expect(between.r).toBe(4);
    expect(between.arcMm).toBeCloseTo(15, 9);
    expect(axisAtZ(samples, 5)).toHaveLength(1);
    expect(axisAtZ(samples, 30)).toEqual([]);
    // Un eje que baja y vuelve a subir cruza la altura dos veces.
    const loop = sampleAxis([
      { p: [0, 0, 0], r: 1 },
      { p: [0, 0, -10], r: 1 },
      { p: [5, 0, 0], r: 1 },
    ]);
    expect(axisAtZ(loop, -4)).toHaveLength(2);
  });

  it('el hueco de pared entre dos tubos paralelos descuenta los dos radios y las dos paredes', () => {
    const a = straight('a', [0, 0, 0], [0, 0, 40], 2, 1);
    const b = straight('b', [10, 0, 0], [10, 0, 40], 3, 0.5);
    // 10 mm entre ejes − radios 2 y 3 − paredes 1 y 0,5.
    expect(minWallGap(a, axis(a), b, axis(b))!.gapMm).toBeCloseTo(3.5, 6);
    expect(minWallGap(b, axis(b), a, axis(a))!.gapMm).toBeCloseTo(3.5, 6);
    const crossing = straight('c', [-10, 0, 20], [10, 0, 20], 2, 1);
    const hit = minWallGap(a, axis(a), crossing, axis(crossing))!;
    expect(hit.gapMm).toBeLessThan(0);
    expect(hit.at[2]).toBeCloseTo(20, 0);
  });

  it('una unión no cuenta como solape: lo que queda a menos del radio pedido de ella se ignora', () => {
    const trunk = straight('trunk', [0, 0, 0], [0, 0, 40], 3, 1);
    const branch = straight('branch', [0, 0, 20], [30, 0, 20], 2, 1);
    // La rama nace en el eje del tronco: su primer extremo es la unión.
    const far = minWallGap(branch, axis(branch), trunk, axis(trunk), 8)!;
    expect(far.at[0]).toBeGreaterThanOrEqual(8);
    expect(far.gapMm).toBeCloseTo(far.at[0] - 3 - 2 - 1 - 1, 6);
    expect(minWallGap(branch, axis(branch), trunk, axis(trunk), 0)!.gapMm).toBeLessThan(0);
    expect(minWallGap(branch, axis(branch), trunk, axis(trunk), 50)).toBeNull();
  });

  it('las coordenadas de ventana son las proyecciones sobre el marco de la sonda y la lectura lateral interpola', () => {
    const frame = { face: [10, 20, 30] as Vec3, lateral: [0, 0, 1] as Vec3, axial: [0, -1, 0] as Vec3, elevation: [1, 0, 0] as Vec3 };
    expect(planeCoordinates([12, 15, 37], frame)).toEqual({ lateralMm: 7, depthMm: 5, elevationMm: 2 });
    const line = [
      { lateralMm: 10, depthMm: 60, elevationMm: 2 },
      { lateralMm: 0, depthMm: 50, elevationMm: 0 },
      { lateralMm: 20, depthMm: 80, elevationMm: -2 },
    ];
    expect(atLateral(line, 5)).toEqual({ lateralMm: 5, depthMm: 55, elevationMm: 1 });
    expect(atLateral(line, 15)).toEqual({ lateralMm: 15, depthMm: 70, elevationMm: 0 });
    expect(atLateral(line, -1)).toBeNull();
    expect(atLateral(line, 21)).toBeNull();
  });

  it('una propuesta sustituye los nodos del tubo que nombra, admite abreviaturas y rechaza lo que no entiende', () => {
    const tube = (nodes: TubeNode[]) => ({ kind: 'tube' as const, apScale: 1, nodes });
    const scene = {
      vessels: [
        { id: 'hepaticArtery', tube: tube(bent), wallTissue: Tissue.ArteryWall, wallMm: 0.8 },
        // rama procedural: comparte id con su madre y no es un tubo de diseño
        { id: 'hepaticArtery', tube: tube(bent), wallTissue: Tissue.ArteryWall, wallMm: 0.8, flowFactor: 0.85 },
      ] as VesselDef[],
      ducts: [{ id: 'cbd', tube: tube(bent), wallMm: 1.2 }] as DuctDef[],
    };
    const proposal = parseProposal({
      ha: [
        [1, 2, 3, 2],
        [4, 5, 6, 1.5],
      ],
    });
    const tubes = designTubes(scene, proposal);
    expect(tubes.map((t) => [t.id, t.proposed])).toEqual([
      ['hepaticArtery', true],
      ['cbd', false],
    ]);
    expect(tubeById(tubes, 'ha').tube.nodes).toEqual([
      { p: [1, 2, 3], r: 2 },
      { p: [4, 5, 6], r: 1.5 },
    ]);
    expect(tubeById(tubes, 'cbd').wallMm(3)).toBe(1.2);
    expect(scene.vessels[0].tube.nodes).toBe(bent);
    expect(() => tubeById(tubes, 'aorta')).toThrow(UsageError);
    expect(() => designTubes(scene, parseProposal({ aorta: [bent[0], bent[1]].map((n) => [...n.p, n.r]) }))).toThrow(
      /Tubo desconocido: aorta/,
    );
    expect(() => parseProposal({ ha: [[1, 2, 3, 2]] })).toThrow(/al menos dos nodos/);
    expect(() =>
      parseProposal({
        ha: [
          [1, 2, 3, 2],
          [4, 5, 6],
        ],
      }),
    ).toThrow(/nodo 1/);
    expect(() =>
      parseNodes(
        [
          [1, 2, 3, 0],
          [4, 5, 6, 1],
        ],
        'nodos',
      ),
    ).toThrow(/radio 0/);
    const two = [
      [1, 2, 3, 2],
      [4, 5, 6, 1.5],
    ];
    expect(() => parseProposal({ ha: two, hepaticArtery: two })).toThrow(/dos veces el tubo hepaticArtery/);
    expect(() => parseProposal([])).toThrow(UsageError);
  });

  it('la pose sale de una ventana de inicio o de un JSON, con lo opcional en cero', () => {
    const points = [{ id: 'renal', phi: 3.25, z: -130, yaw: -0.378, rock: 0.199 }] as StartPoint[];
    expect(resolvePose('renal', points)).toEqual({
      label: 'renal',
      pose: { phi: 3.25, z: -130, yaw: -0.378, rock: 0.199, tilt: 0, lift: 0 },
    });
    expect(resolvePose('{"phi":1.6,"z":-100,"yaw":-1.2,"tilt":0.15}', points).pose).toEqual({
      phi: 1.6,
      z: -100,
      yaw: -1.2,
      rock: 0,
      tilt: 0.15,
      lift: 0,
    });
    expect(() => resolvePose('portal', points)).toThrow(/no es una ventana \(renal\)/);
    expect(() => resolvePose('{"phi":1.6,"z":-100}', points)).toThrow(/«yaw» debe ser un número/);
  });
});

describe('herramientas de diseño: argumentos (tools/toolArgs.ts)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('un rango exige sus partes, números finitos, orden y paso positivo', () => {
    expect(parseRange('-10:60:5', '--lateral', 3)).toEqual([-10, 60, 5]);
    expect(parseRange('-0.25:0.1', '--theta', 2)).toEqual([-0.25, 0.1]);
    for (const bad of ['10:60', '60:10:5', '0:10:0', 'a:b:c', '0::5']) expect(() => parseRange(bad, '--lateral', 3)).toThrow(UsageError);
    expect(() => parseRange('0:10:1', '--theta', 2)).toThrow(/--theta=-10:60/);
  });

  it('un recuento es un entero desde su mínimo', () => {
    expect(parseCount('192', '--lines')).toBe(192);
    expect(parseCount('0', '--rows', 0)).toBe(0);
    for (const bad of ['0', '-3', '2.5', 'ocho']) expect(() => parseCount(bad, '--lines')).toThrow(UsageError);
  });

  it('un argumento JSON es el propio texto o un archivo, y dice cuál falla', () => {
    expect(readJsonArgument('[[1,2,3,4]]', 'nodos')).toEqual([[1, 2, 3, 4]]);
    const file = join(mkdtempSync(join(tmpdir(), 'vexus-tool-args-')), 'propuesta.json');
    writeFileSync(file, '{"cbd":[[0,0,0,2],[0,0,9,2]]}');
    expect(readJsonArgument(file, 'propuesta')).toEqual({
      cbd: [
        [0, 0, 0, 2],
        [0, 0, 9, 2],
      ],
    });
    expect(() => readJsonArgument(`${file}.no`, 'propuesta')).toThrow(/no es JSON ni un archivo que exista/);
    expect(() => readJsonArgument('[1,', 'nodos')).toThrow(/nodos: JSON inválido en el argumento/);
  });

  it('un error de uso imprime el mensaje y el uso y sale con 2; los demás errores no se tragan', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runTool(
      'USO',
      () => {
        throw new UsageError('falta la ventana');
      },
      [],
    );
    expect(error).toHaveBeenCalledWith('falta la ventana\n\nUSO');
    expect(process.exitCode).toBe(2);
    process.exitCode = undefined;

    const main = vi.fn();
    await runTool('USO', main, ['renal', '--help']);
    expect(main).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('USO');
    expect(process.exitCode).toBeUndefined();

    await expect(
      runTool(
        'USO',
        () => {
          throw new Error('fallo de la herramienta');
        },
        [],
      ),
    ).rejects.toThrow('fallo de la herramienta');
  });
});

describe('herramientas de ventana: mapa de tejidos y pares (tools/fidelity/windowGrid.ts)', () => {
  it('cada tejido tiene su carácter, distinto de los demás, y los 36 primeros son los de siempre', () => {
    expect(GLYPH_CAPACITY).toBeGreaterThanOrEqual(TISSUE_COUNT);
    const glyphs = Array.from({ length: TISSUE_COUNT }, (_, t) => tissueGlyph(t));
    expect(new Set(glyphs).size).toBe(TISSUE_COUNT);
    expect(glyphs.every((g) => /^[0-9a-zA-Z]$/.test(g))).toBe(true);
    expect([tissueGlyph(Tissue.Liver), tissueGlyph(Tissue.Lung), tissueGlyph(Tissue.GutSubmucosa)]).toEqual(['4', 'a', 'z']);
    expect(tissueGlyph(TISSUE_COUNT + 100)).toBe('?');
  });

  it('el mapa conserva filas y columnas y su leyenda nombra solo lo que aparece, con sus notas', () => {
    const lines = renderTissueMap(
      [
        [Tissue.Liver, Tissue.Liver, Tissue.Blood],
        [Tissue.Fat, Tissue.GastricContents, Tissue.Blood],
      ],
      { [Tissue.Fat]: ['fat-D/E'] },
    );
    expect(lines).toEqual(['446', '2F6', '2 Fat [fat-D/E] · 4 Liver · 6 Blood · F GastricContents']);
  });

  it('la tabla de pares nombra los tejidos y va de más a menos', () => {
    expect(pairTable({ [`${Tissue.Skin}>${Tissue.Fat}`]: 2, [`${Tissue.Fat}>${Tissue.Muscle}`]: 8, '4>99': 1 })).toEqual([
      { cpu: 'Fat', gpu: 'Muscle', count: 8 },
      { cpu: 'Skin', gpu: 'Fat', count: 2 },
      { cpu: 'Liver', gpu: 'tejido 99', count: 1 },
    ]);
  });
});
