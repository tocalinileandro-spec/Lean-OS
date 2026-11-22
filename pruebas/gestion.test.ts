import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../src/compartido/almacen.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { importar } from "../src/compartido/importacion/importar.ts";
import { calificarYGuardar } from "../src/compartido/repaso.ts";
import {
  borrarApunte, borrarTarjeta, editarTarjeta, listarPapelera, moverTarjetaDeArea, purgarPapelera,
  reanudarTarjeta, restaurarApunte, restaurarTarjeta, suspenderTarjeta,
} from "../src/compartido/gestion.ts";
import { calcularEstadisticas } from "../src/compartido/estadisticas.ts";
import { construirCola } from "../src/compartido/repaso.ts";

const BLOQUE = JSON.stringify({
  tipo: "aprendizaje", fecha: "2026-11-22", area: "Programación > CS50", tema: "Funciones", resumen: "Resumen.",
  preguntas: [{ p: "P1", r: "R1" }, { p: "P2", r: "R2" }, { p: "P3", r: "R3" }],
});
async function nuevo() {
  const a = new AlmacenMemoria();
  const r = new RelojSimulado("2026-11-22T15:00:00.000Z");
  await importar(a, r, BLOQUE);
  return { a, r, ts: await a.tarjetas.listar() };
}

describe("gestión de tarjetas", () => {
  it("editar cambia contenido y marca de contenido, no el estado de repaso", async () => {
    const { a, r, ts } = await nuevo();
    const antes = ts[0]!;
    r.avanzarMinutos(5);
    const t = await editarTarjeta(a, r, antes.id, { pregunta: "Nueva", pista: "pista" });
    expect(t).toMatchObject({ pregunta: "Nueva", respuesta: "R1", pista: "pista" });
    expect(t.contenido_updated_at).toBe(r.ahora().toISOString());
    expect(t.updated_at).toBe(r.ahora().toISOString());
    expect(t.repaso_updated_at).toBe(antes.repaso_updated_at);
    await expect(editarTarjeta(a, r, antes.id, { pregunta: "  " })).rejects.toThrow();
  });

  it("mover de área exige un área existente", async () => {
    const { a, r, ts } = await nuevo();
    const raiz = (await a.areas.listar()).find((x) => x.padre_id === null)!;
    const t = await moverTarjetaDeArea(a, r, ts[0]!.id, raiz.id);
    expect(t.area_id).toBe(raiz.id);
    await expect(moverTarjetaDeArea(a, r, ts[0]!.id, "no-existe")).rejects.toThrow();
  });

  it("suspender saca la tarjeta de la cola y reanudar la devuelve", async () => {
    const { a, r, ts } = await nuevo();
    const s = await suspenderTarjeta(a, r, ts[0]!.id);
    expect(s.suspendida).toBe(true);
    expect(await construirCola(a, r)).toHaveLength(2);
    await reanudarTarjeta(a, r, ts[0]!.id);
    expect(await construirCola(a, r)).toHaveLength(3);
  });
});

describe("papelera", () => {
  it("borrar oculta, listar la muestra y restaurar la devuelve", async () => {
    const { a, r, ts } = await nuevo();
    r.avanzarMinutos(1);
    await borrarTarjeta(a, r, ts[0]!.id);
    expect(await a.tarjetas.listar()).toHaveLength(2);
    const p = await listarPapelera(a);
    expect(p.tarjetas.map((t) => t.id)).toEqual([ts[0]!.id]);
    const t = await restaurarTarjeta(a, r, ts[0]!.id);
    expect(t.deleted_at).toBeNull();
    expect(t.contenido_updated_at).toBe(r.ahora().toISOString());
    expect((await listarPapelera(a)).tarjetas).toHaveLength(0);
    await expect(restaurarTarjeta(a, r, ts[0]!.id)).rejects.toThrow();
  });

  it("apuntes: borrar y restaurar", async () => {
    const { a, r } = await nuevo();
    const ap = (await a.apuntes.listar())[0]!;
    await borrarApunte(a, r, ap.id);
    expect((await listarPapelera(a)).apuntes).toHaveLength(1);
    await restaurarApunte(a, r, ap.id);
    expect(await a.apuntes.listar()).toHaveLength(1);
  });

  it("la purga a los 30 días elimina lo borrado y conserva el historial de repasos", async () => {
    const { a, r, ts } = await nuevo();
    await calificarYGuardar(a, r, ts[0]!.id, "bien");
    await borrarTarjeta(a, r, ts[0]!.id); // se borra hoy
    r.avanzarMs(15 * 86_400_000);
    await borrarTarjeta(a, r, ts[1]!.id); // se borra 15 días después
    r.avanzarMs(15 * 86_400_000 - 1);
    expect(await purgarPapelera(a, r)).toBe(0); // la primera lleva 30 días menos 1 ms
    r.avanzarMs(1);
    expect(await purgarPapelera(a, r)).toBe(1);
    expect(await a.tarjetas.obtener(ts[0]!.id)).toBeUndefined();
    expect(await a.tarjetas.obtener(ts[1]!.id)).toBeDefined(); // sigue en la papelera
    expect(await a.repasos.listarPorTarjeta(ts[0]!.id)).toHaveLength(1);
  });
});

describe("estadísticas mínimas", () => {
  it("pendientes, repasadas, racha y total por área", async () => {
    const { a, r, ts } = await nuevo();
    let e = await calcularEstadisticas(a, r);
    expect(e).toMatchObject({ pendientesHoy: 3, repasadasHoy: 0, racha: 0 });
    expect(e.porArea.find((x) => x.nombre === "CS50")!.total).toBe(3);
    expect(e.porArea.find((x) => x.nombre === "Programación")!.total).toBe(3); // el Área suma sus subáreas

    await calificarYGuardar(a, r, ts[0]!.id, "bien");
    e = await calcularEstadisticas(a, r);
    expect(e).toMatchObject({ pendientesHoy: 2, repasadasHoy: 1, racha: 1 });

    r.avanzarDias(1); // 23/11
    await calificarYGuardar(a, r, ts[1]!.id, "bien");
    r.avanzarDias(1); // 24/11: todavía sin repasar, la racha sigue viva desde ayer
    expect((await calcularEstadisticas(a, r)).racha).toBe(2);
    r.avanzarDias(1); // 25/11 sin repasar 24: se cortó
    expect((await calcularEstadisticas(a, r)).racha).toBe(0);
  });

  it("el día cambia a las 04:00: un repaso a las 02:00 cuenta para el día anterior", async () => {
    const { a, r, ts } = await nuevo();
    r.fijar("2026-11-23T05:00:00.000Z"); // 23/11 02:00 en Buenos Aires = día lógico 22/11
    await calificarYGuardar(a, r, ts[0]!.id, "bien");
    r.fijar("2026-11-23T08:00:00.000Z"); // 05:00: ya es 23/11
    expect(await calcularEstadisticas(a, r)).toMatchObject({ repasadasHoy: 0, racha: 1 });
  });

  it("un repaso deshecho no cuenta", async () => {
    const { a, r, ts } = await nuevo();
    const res = await calificarYGuardar(a, r, ts[0]!.id, "bien");
    const { deshacerCalificacion } = await import("../src/compartido/repaso.ts");
    await deshacerCalificacion(a, r, res);
    expect(await calcularEstadisticas(a, r)).toMatchObject({ repasadasHoy: 0, racha: 0, pendientesHoy: 3 });
  });
});
