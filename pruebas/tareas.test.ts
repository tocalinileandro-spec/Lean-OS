import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../src/compartido/almacen.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { importar } from "../src/compartido/importacion/importar.ts";
import { listarPapelera, purgarPapelera } from "../src/compartido/gestion.ts";
import {
  bandeja, borrarMeta, borrarTarea, cambiarEstadoMeta, crearMetaAnual, crearMetaTrimestral, crearTarea, crearTareaRapida,
  desmarcarHecha, editarMeta, editarTarea, marcarHecha, progresoMeta, restaurarMeta, restaurarTarea, tareasDeHoy,
} from "../src/compartido/tareas.ts";

// 2026-11-22 15:00 UTC = 12:00 en Buenos Aires: el día lógico es 2026-11-22.
const nuevo = () => ({ a: new AlmacenMemoria(), r: new RelojSimulado("2026-11-22T15:00:00.000Z") });

describe("tareas y metas", () => {
  it("T1: meta anual, trimestral T4 colgada y tarea de hoy; al marcarla hecha Hoy la muestra y ambos progresos llegan a 100 %", async () => {
    const { a, r } = nuevo();
    const anual = await crearMetaAnual(a, r, { anio: 2026, titulo: "Aprender TypeScript" });
    const trim = await crearMetaTrimestral(a, r, { anio: 2026, trimestre: 4, titulo: "Terminar la app", padre_id: anual.id });
    expect(trim).toMatchObject({ tipo: "trimestral", trimestre: 4, padre_id: anual.id, estado: "activa" });
    const t = await crearTarea(a, r, { titulo: "Escribir pruebas", fecha: "2026-11-22", meta_id: trim.id });
    expect((await progresoMeta(a, trim.id)).porcentaje).toBe(0);
    r.avanzarMinutos(5);
    const hecha = await marcarHecha(a, r, t.id);
    expect(hecha).toMatchObject({ estado: "hecha", hecha_en: r.ahora().toISOString() });
    expect((await tareasDeHoy(a, r)).hoy.map((x) => x.id)).toEqual([t.id]);
    expect(await progresoMeta(a, trim.id)).toEqual({ hechas: 1, total: 1, porcentaje: 100 });
    expect(await progresoMeta(a, anual.id)).toEqual({ hechas: 1, total: 1, porcentaje: 100 });
  });

  it("T2: borrar la meta trimestral deja la tarea existiendo, sin meta", async () => {
    const { a, r } = nuevo();
    const anual = await crearMetaAnual(a, r, { anio: 2026, titulo: "A" });
    const trim = await crearMetaTrimestral(a, r, { anio: 2026, trimestre: 4, titulo: "T", padre_id: anual.id });
    const t = await crearTarea(a, r, { titulo: "x", fecha: "2026-11-22", meta_id: trim.id });
    await borrarMeta(a, r, trim.id);
    const despues = await a.tareas.obtener(t.id);
    expect(despues).toMatchObject({ meta_id: null, deleted_at: null });
    expect((await a.tareas.listar()).map((x) => x.id)).toEqual([t.id]);
    expect(await a.metas.listar()).toHaveLength(1);
    expect((await listarPapelera(a)).metas.map((m) => m.id)).toEqual([trim.id]);
  });

  it("borrar una anual deja sus trimestrales sin padre y sus tareas sin meta; restaurar vuelve la meta", async () => {
    const { a, r } = nuevo();
    const anual = await crearMetaAnual(a, r, { anio: 2026, titulo: "A" });
    const trim = await crearMetaTrimestral(a, r, { anio: 2026, trimestre: 1, titulo: "T", padre_id: anual.id });
    const t = await crearTarea(a, r, { titulo: "x", meta_id: anual.id });
    await borrarMeta(a, r, anual.id);
    expect((await a.metas.obtener(trim.id))!.padre_id).toBeNull();
    expect((await a.tareas.obtener(t.id))!.meta_id).toBeNull();
    expect((await restaurarMeta(a, r, anual.id)).deleted_at).toBeNull();
    await expect(restaurarMeta(a, r, anual.id)).rejects.toThrow();
  });

  it("progreso: sin tareas es 0; la anual suma propias y de trimestrales; las borradas no cuentan", async () => {
    const { a, r } = nuevo();
    const anual = await crearMetaAnual(a, r, { anio: 2026, titulo: "A" });
    const trim = await crearMetaTrimestral(a, r, { anio: 2026, trimestre: 4, titulo: "T", padre_id: anual.id });
    expect(await progresoMeta(a, anual.id)).toEqual({ hechas: 0, total: 0, porcentaje: 0 });
    const t1 = await crearTarea(a, r, { titulo: "1", meta_id: anual.id });
    await crearTarea(a, r, { titulo: "2", meta_id: trim.id });
    const t3 = await crearTarea(a, r, { titulo: "3", meta_id: trim.id });
    await marcarHecha(a, r, t1.id);
    expect(await progresoMeta(a, anual.id)).toEqual({ hechas: 1, total: 3, porcentaje: 33 });
    expect(await progresoMeta(a, trim.id)).toEqual({ hechas: 0, total: 2, porcentaje: 0 });
    await borrarTarea(a, r, t3.id);
    expect((await progresoMeta(a, anual.id)).total).toBe(2);
  });

  it("tarea rápida: fecha = hoy lógico (antes de las 04:00 sigue siendo ayer)", async () => {
    const { a, r } = nuevo();
    expect((await crearTareaRapida(a, r, "Llamar")).fecha).toBe("2026-11-22");
    r.fijar("2026-11-23T05:00:00.000Z"); // 02:00 en Buenos Aires
    expect((await crearTareaRapida(a, r, "Tarde")).fecha).toBe("2026-11-22");
    await expect(crearTareaRapida(a, r, "  ")).rejects.toThrow();
  });

  it("Hoy: atrasadas primero (más vieja antes), futuras y bandeja afuera, y conteo de tarjetas a repasar", async () => {
    const { a, r } = nuevo();
    const hoy = await crearTarea(a, r, { titulo: "hoy", fecha: "2026-11-22" });
    const vieja = await crearTarea(a, r, { titulo: "vieja", fecha: "2026-11-10" });
    const ayer = await crearTarea(a, r, { titulo: "ayer", fecha: "2026-11-21" });
    await crearTarea(a, r, { titulo: "mañana", fecha: "2026-11-23" });
    const sin = await crearTarea(a, r, { titulo: "sin fecha" });
    const hechaVieja = await crearTarea(a, r, { titulo: "hecha vieja", fecha: "2026-11-01" });
    await marcarHecha(a, r, hechaVieja.id);
    await importar(a, r, JSON.stringify({
      tipo: "aprendizaje", fecha: "2026-11-22", area: "X", tema: "T", resumen: "R", preguntas: [{ p: "a", r: "b" }, { p: "c", r: "d" }],
    }));
    const v = await tareasDeHoy(a, r);
    expect(v.atrasadas.map((t) => t.id)).toEqual([vieja.id, ayer.id]);
    expect(v.hoy.map((t) => t.id)).toEqual([hoy.id]);
    expect(v.tarjetasARepasar).toBe(2);
    expect((await bandeja(a)).map((t) => t.id)).toEqual([sin.id]);
  });

  it("marcar y desmarcar hecha; editar; borrar y restaurar tarea", async () => {
    const { a, r } = nuevo();
    const m = await crearMetaAnual(a, r, { anio: 2026, titulo: "A" });
    const t = await crearTarea(a, r, { titulo: "x" });
    expect((await marcarHecha(a, r, t.id)).hecha_en).not.toBeNull();
    expect(await desmarcarHecha(a, r, t.id)).toMatchObject({ estado: "pendiente", hecha_en: null });
    r.avanzarMinutos(1);
    const e = await editarTarea(a, r, t.id, { titulo: "y", fecha: "2026-12-01", meta_id: m.id, nota: "nota" });
    expect(e).toMatchObject({ titulo: "y", fecha: "2026-12-01", meta_id: m.id, nota: "nota" });
    expect(e.updated_at).toBe(r.ahora().toISOString());
    await expect(editarTarea(a, r, t.id, { titulo: "" })).rejects.toThrow();
    await expect(editarTarea(a, r, t.id, { fecha: "1/2/2026" })).rejects.toThrow();
    await borrarTarea(a, r, t.id);
    await expect(marcarHecha(a, r, t.id)).rejects.toThrow();
    expect((await listarPapelera(a)).tareas).toHaveLength(1);
    expect((await restaurarTarea(a, r, t.id)).deleted_at).toBeNull();
    await expect(restaurarTarea(a, r, t.id)).rejects.toThrow();
  });

  it("metas: estados, edición y validaciones", async () => {
    const { a, r } = nuevo();
    const an = await crearMetaAnual(a, r, { anio: 2026, titulo: "A" });
    expect((await cambiarEstadoMeta(a, r, an.id, "lograda")).estado).toBe("lograda");
    expect((await cambiarEstadoMeta(a, r, an.id, "descartada")).estado).toBe("descartada");
    expect((await editarMeta(a, r, an.id, { titulo: "B" })).titulo).toBe("B");
    await expect(crearMetaTrimestral(a, r, { anio: 2026, trimestre: 5 as never, titulo: "x" })).rejects.toThrow();
    await expect(crearMetaTrimestral(a, r, { anio: 2026, trimestre: 1, titulo: "x", padre_id: "nada" })).rejects.toThrow();
    await expect(crearMetaAnual(a, r, { anio: 2026, titulo: " " })).rejects.toThrow();
    await expect(crearTarea(a, r, { titulo: "x", meta_id: "nada" })).rejects.toThrow();
    const sola = await crearMetaTrimestral(a, r, { anio: 2026, trimestre: 2, titulo: "sola" });
    expect(sola.padre_id).toBeNull();
  });

  it("rechaza fechas inexistentes al crear y editar tareas", async () => {
    const { a, r } = nuevo();
    await expect(crearTarea(a, r, { titulo: "x", fecha: "2026-13-45" })).rejects.toThrow();
    await expect(crearTarea(a, r, { titulo: "x", fecha: "2026-02-31" })).rejects.toThrow();
    const t = await crearTarea(a, r, { titulo: "x", fecha: "2028-02-29" });
    await expect(editarTarea(a, r, t.id, { fecha: "2026-02-31" })).rejects.toThrow();
    expect((await a.tareas.obtener(t.id))!.fecha).toBe("2028-02-29");
  });

  it("editarMeta: el padre debe ser una anual viva, distinta de la propia; las anuales no tienen padre", async () => {
    const { a, r } = nuevo();
    const an = await crearMetaAnual(a, r, { anio: 2026, titulo: "A" });
    const an2 = await crearMetaAnual(a, r, { anio: 2027, titulo: "B" });
    const tr = await crearMetaTrimestral(a, r, { anio: 2026, trimestre: 1, titulo: "T" });
    const tr2 = await crearMetaTrimestral(a, r, { anio: 2026, trimestre: 2, titulo: "T2" });
    expect((await editarMeta(a, r, tr.id, { padre_id: an.id })).padre_id).toBe(an.id);
    expect((await editarMeta(a, r, tr.id, { padre_id: null })).padre_id).toBeNull();
    await expect(editarMeta(a, r, tr.id, { padre_id: tr.id })).rejects.toThrow();
    await expect(editarMeta(a, r, tr.id, { padre_id: tr2.id })).rejects.toThrow();
    await expect(editarMeta(a, r, tr.id, { padre_id: "nada" })).rejects.toThrow();
    await expect(editarMeta(a, r, an.id, { padre_id: an2.id })).rejects.toThrow();
    await borrarMeta(a, r, an2.id);
    await expect(editarMeta(a, r, tr.id, { padre_id: an2.id })).rejects.toThrow();
  });

  it("desmarcar una tarea pendiente no cambia updated_at", async () => {
    const { a, r } = nuevo();
    const t = await crearTarea(a, r, { titulo: "x" });
    r.avanzarMinutos(5);
    expect(await desmarcarHecha(a, r, t.id)).toEqual(t);
  });

  it("la purga elimina metas y tareas con 30 días o más en la papelera", async () => {
    const { a, r } = nuevo();
    const m = await crearMetaAnual(a, r, { anio: 2026, titulo: "A" });
    const t = await crearTarea(a, r, { titulo: "x" });
    const viva = await crearTarea(a, r, { titulo: "viva" });
    await borrarMeta(a, r, m.id);
    await borrarTarea(a, r, t.id);
    r.avanzarDias(29);
    expect(await purgarPapelera(a, r)).toBe(0);
    r.avanzarDias(1);
    expect(await purgarPapelera(a, r)).toBe(2);
    expect(await a.metas.listar({ incluirBorrados: true })).toHaveLength(0);
    expect((await a.tareas.listar({ incluirBorrados: true })).map((x) => x.id)).toEqual([viva.id]);
  });
});
