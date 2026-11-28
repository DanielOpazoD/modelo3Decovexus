import { describe, expect, it } from 'vitest';
import { Simulator } from '../app/simulator';
import { NORMAL_ADULT } from '../cases';
import { clonePatient } from '../physiology/patientState';
import { FRAG_PERSIST } from '../ultrasound/shaders/passes.glsl';
import { fixtureInstalled } from './support/legacyPerson/state';
import { recordingGl } from './support/recordingGl';

/**
 * Renderizador real sobre el WebGL falso: el peso de la historia (`uPersist`) que recibe la pasada P en cada
 * cuadro. La historia está en píxeles del lienzo con el abanico de su profundidad: si es de otra geometría (otra
 * profundidad u otro lienzo) o se acaba de crear o limpiar (negro), mezclarla duplicaría el abanico u oscurecería
 * el cuadro, así que ese cuadro no la pesa.
 */
function rig() {
  const rec = recordingGl({ width: 320, height: 240 });
  const sim = new Simulator(clonePatient(NORMAL_ADULT), rec.canvas, undefined, undefined, fixtureInstalled());
  sim.equipment = { ...sim.equipment, bmode: { ...sim.equipment.bmode, compound: false, persistence: 0.8 } };
  const frame = (): number => {
    rec.draws.length = 0;
    sim.advance(0.06);
    sim.render();
    const p = rec.draws.filter((d) => d.frag === FRAG_PERSIST);
    expect(p).toHaveLength(1);
    return p[0].uniforms.uPersist[0];
  };
  return { ...rec, sim, frame };
}

describe('persistencia: la historia solo se mezcla con su misma geometría', () => {
  it('el primer cuadro no mezcla la historia recién creada (negra); los siguientes sí', () => {
    const { frame } = rig();
    expect(frame()).toBe(0);
    expect(frame()).toBeCloseTo(0.8, 6);
    expect(frame()).toBeCloseTo(0.8, 6);
  });

  it('otra profundidad corta la historia en ese cuadro', () => {
    const { sim, frame } = rig();
    frame();
    frame();
    sim.equipment = { ...sim.equipment, bmode: { ...sim.bmode, depthMm: sim.bmode.depthMm - 30 } };
    expect(frame()).toBe(0);
    expect(frame()).toBeCloseTo(0.8, 6);
  });

  it('otro tamaño del lienzo corta la historia y su época: el cine no mezcla a través del cambio', () => {
    const { sim, canvas, frame } = rig();
    frame();
    frame();
    const before = sim.renderer.cineFrame(sim.renderer.cineCount - 1).persistenceEpoch;
    canvas.width -= 16;
    expect(frame()).toBe(0);
    expect(sim.renderer.cineFrame(sim.renderer.cineCount - 1).persistenceEpoch).not.toBe(before);
    expect(frame()).toBeCloseTo(0.8, 6);
  });

  it('tras cambiar de escena (historia limpiada a negro) el primer cuadro no la mezcla', () => {
    const { sim, frame } = rig();
    frame();
    frame();
    sim.renderer.setScene(sim.scene);
    expect(frame()).toBe(0);
    expect(frame()).toBeCloseTo(0.8, 6);
  });

  it('decisión 80: si el lienzo cambia con la imagen congelada, la historia es el cuadro mostrado y al descongelar sigue', () => {
    const { sim, canvas, frame } = rig();
    frame();
    frame();
    sim.frozen = true;
    sim.renderer.cineSeal();
    canvas.width -= 16;
    sim.renderer.showCine(sim.renderer.cineCount - 1);
    sim.renderer.cineExit();
    sim.frozen = false;
    expect(frame()).toBeCloseTo(0.8, 6);
    // y si además cambió la profundidad, el primer cuadro en vivo la corta
    sim.frozen = true;
    sim.renderer.cineSeal();
    canvas.width += 16;
    sim.renderer.showCine(sim.renderer.cineCount - 1);
    sim.renderer.cineExit();
    sim.equipment = { ...sim.equipment, bmode: { ...sim.bmode, depthMm: sim.bmode.depthMm - 30 } };
    sim.frozen = false;
    expect(frame()).toBe(0);
  });
});
