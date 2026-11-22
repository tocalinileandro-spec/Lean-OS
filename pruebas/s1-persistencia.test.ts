import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { AlmacenIndexedDB } from "../src/cliente/almacen-indexeddb.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { importar } from "../src/compartido/importacion/importar.ts";
import { calificarYGuardar, construirCola } from "../src/compartido/repaso.ts";
import { borrarTarjeta } from "../src/compartido/gestion.ts";
import { borrarTarea, crearMetaAnual, crearMetaTrimestral, crearTarea, marcarHecha } from "../src/compartido/tareas.ts";
import { crearApunte } from "../src/compartido/apuntes.ts";

const BLOQUE = JSON.stringify({
  tipo: "aprendizaje", fecha: "2026-11-22", area: "Programación > CS50", tema: "Funciones", resumen: "Resumen de ejemplo.",
  preguntas: [{ p: "P1", r: "R1" }, { p: "P2", r: "R2" }, { p: "P3", r: "R3" }, { p: "P4", r: "R4" }],
});

describe("persistencia", () => {
  it("S1: cargar datos, cerrar y reabrir la base devuelve mismas tarjetas, estados de repaso y apuntes", async () => {
    const fabrica = new IDBFactory(); // la "base del navegador": sobrevive al cierre del almacén
    const reloj = new RelojSimulado("2026-11-22T15:00:00.000Z");
    const a1 = await AlmacenIndexedDB.abrir("lean-os", fabrica);
    await importar(a1, reloj, BLOQUE);
    const ids = (await a1.tarjetas.listar()).map((t) => t.id);
    await calificarYGuardar(a1, reloj, ids[0]!, "bien");
    reloj.avanzarMinutos(1);
    await calificarYGuardar(a1, reloj, ids[1]!, "otra_vez");
    await borrarTarjeta(a1, reloj, ids[3]!);

    const anual = await crearMetaAnual(a1, reloj, { anio: 2026, titulo: "Aprender TS" });
    const trim = await crearMetaTrimestral(a1, reloj, { anio: 2026, trimestre: 4, titulo: "Cerrar app", padre_id: anual.id });
    const tarea1 = await crearTarea(a1, reloj, { titulo: "Escribir pruebas", fecha: "2026-11-22", meta_id: trim.id, nota: "n" });
    await marcarHecha(a1, reloj, tarea1.id);
    const tarea2 = await crearTarea(a1, reloj, { titulo: "Sin fecha" });
    await borrarTarea(a1, reloj, tarea2.id);
    await crearApunte(a1, reloj, { texto: "Una idea suelta", etiquetas: ["ts"] });

    const antes = {
      metas: await a1.metas.listar({ incluirBorrados: true }),
      tareas: await a1.tareas.listar({ incluirBorrados: true }),
      apuntesTodos: await a1.apuntes.listar({ incluirBorrados: true }),
      tarjetas: await a1.tarjetas.listar({ incluirBorrados: true }),
      repasos: await a1.repasos.listar(),
      apuntes: await a1.apuntes.listar(),
      areas: await a1.areas.listar(),
      importaciones: await a1.importaciones.listar(),
      cola: (await construirCola(a1, reloj)).map((t) => t.id),
    };
    expect(antes.tarjetas).toHaveLength(4);
    expect(antes.repasos).toHaveLength(2);
    expect(antes.apuntes).toHaveLength(2); // resumen importado + captura
    expect(antes.metas).toHaveLength(2);
    expect(antes.tareas).toHaveLength(2);
    a1.cerrar();

    const a2 = await AlmacenIndexedDB.abrir("lean-os", fabrica);
    expect(await a2.tarjetas.listar({ incluirBorrados: true })).toEqual(antes.tarjetas);
    expect(await a2.repasos.listar()).toEqual(antes.repasos);
    expect(await a2.apuntes.listar()).toEqual(antes.apuntes);
    expect(await a2.metas.listar({ incluirBorrados: true })).toEqual(antes.metas);
    expect(await a2.tareas.listar({ incluirBorrados: true })).toEqual(antes.tareas);
    expect(await a2.apuntes.listar({ incluirBorrados: true })).toEqual(antes.apuntesTodos);
    expect((await a2.tareas.obtener(tarea1.id))).toMatchObject({ estado: "hecha", meta_id: trim.id, nota: "n" });
    expect(await a2.areas.listar()).toEqual(antes.areas);
    expect(await a2.importaciones.listar()).toEqual(antes.importaciones);
    expect((await construirCola(a2, reloj)).map((t) => t.id)).toEqual(antes.cola);
    const t0 = (await a2.tarjetas.obtener(ids[0]!))!;
    expect(t0).toMatchObject({ reps: 1, intervalo: 1, vence: "2026-11-23" });
  });
});
