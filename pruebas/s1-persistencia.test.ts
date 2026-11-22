import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { AlmacenIndexedDB } from "../src/cliente/almacen-indexeddb.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { importar } from "../src/compartido/importacion/importar.ts";
import { calificarYGuardar, construirCola } from "../src/compartido/repaso.ts";
import { borrarTarjeta } from "../src/compartido/gestion.ts";

const BLOQUE = JSON.stringify({
  tipo: "aprendizaje", fecha: "2026-11-22", area: "Programación > CS50", tema: "Funciones", resumen: "Resumen de ejemplo.",
  preguntas: [{ p: "P1", r: "R1" }, { p: "P2", r: "R2" }, { p: "P3", r: "R3" }, { p: "P4", r: "R4" }],
});

describe("persistencia", () => {
  it("S1: cargar datos, cerrar y reabrir la base devuelve mismas tarjetas, estados de repaso y apuntes", async () => {
    // Nota: las tareas se agregan en la fase 3; S1 se revalida con tareas entonces.
    const fabrica = new IDBFactory(); // la "base del navegador": sobrevive al cierre del almacén
    const reloj = new RelojSimulado("2026-11-22T15:00:00.000Z");
    const a1 = await AlmacenIndexedDB.abrir("lean-os", fabrica);
    await importar(a1, reloj, BLOQUE);
    const ids = (await a1.tarjetas.listar()).map((t) => t.id);
    await calificarYGuardar(a1, reloj, ids[0]!, "bien");
    reloj.avanzarMinutos(1);
    await calificarYGuardar(a1, reloj, ids[1]!, "otra_vez");
    await borrarTarjeta(a1, reloj, ids[3]!);

    const antes = {
      tarjetas: await a1.tarjetas.listar({ incluirBorrados: true }),
      repasos: await a1.repasos.listar(),
      apuntes: await a1.apuntes.listar(),
      areas: await a1.areas.listar(),
      importaciones: await a1.importaciones.listar(),
      cola: (await construirCola(a1, reloj)).map((t) => t.id),
    };
    expect(antes.tarjetas).toHaveLength(4);
    expect(antes.repasos).toHaveLength(2);
    expect(antes.apuntes).toHaveLength(1);
    a1.cerrar();

    const a2 = await AlmacenIndexedDB.abrir("lean-os", fabrica);
    expect(await a2.tarjetas.listar({ incluirBorrados: true })).toEqual(antes.tarjetas);
    expect(await a2.repasos.listar()).toEqual(antes.repasos);
    expect(await a2.apuntes.listar()).toEqual(antes.apuntes);
    expect(await a2.areas.listar()).toEqual(antes.areas);
    expect(await a2.importaciones.listar()).toEqual(antes.importaciones);
    expect((await construirCola(a2, reloj)).map((t) => t.id)).toEqual(antes.cola);
    const t0 = (await a2.tarjetas.obtener(ids[0]!))!;
    expect(t0).toMatchObject({ reps: 1, intervalo: 1, vence: "2026-11-23" });
  });
});
