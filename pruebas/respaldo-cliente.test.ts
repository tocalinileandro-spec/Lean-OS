import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { AlmacenIndexedDB } from "../src/cliente/almacen-indexeddb.ts";
import { AlmacenSincronizado, ColaMemoria, contarPendientes } from "../src/cliente/sync/cola.ts";
import { exportarLocal, exportarLocalTexto, importarRespaldo, lineasDeInforme } from "../src/cliente/sync/respaldo.ts";
import { AlmacenMemoria } from "../src/compartido/almacen.ts";
import type { Almacen } from "../src/compartido/almacen.ts";
import { TABLAS } from "../src/compartido/esquema.ts";
import { borrarTarjeta, editarTarjeta, suspenderTarjeta } from "../src/compartido/gestion.ts";
import { crearApunte } from "../src/compartido/apuntes.ts";
import { calificarYGuardar, deshacerCalificacion } from "../src/compartido/repaso.ts";
import { crearMetaAnual, crearTarea, editarTarea, marcarHecha } from "../src/compartido/tareas.ts";
import { VERSION_FORMATO } from "../src/compartido/respaldo-formato.ts";
import { contarTodo, restaurarRespaldo } from "../src/servidor/respaldo.ts";
import { cargarTarjetas, Entorno, entrar, MemoriaPersistente } from "./ayuda-sync.ts";

async function conteos(a: Almacen) {
  const r: Record<string, number> = {};
  for (const t of TABLAS) r[t] = t === "repasos" ? (await a.repasos.listar()).length : (await (a as any)[t].listar({ incluirBorrados: true })).length;
  return r;
}

/** Una instalación con un poco de todo: tarjetas con distintos estados de repaso, borrados, tareas, metas y apuntes. */
async function instalacionConDatos(e: Entorno) {
  const c = e.cliente();
  await entrar(c);
  await cargarTarjetas(c.almacen, e.reloj, 4);
  await cargarTarjetas(c.almacen, e.reloj, 2, "Matemática > Álgebra", "Ecuaciones");
  const ts = await c.crudo.tarjetas.listar();
  e.reloj.avanzarMinutos(5);
  await calificarYGuardar(c.almacen, e.reloj, ts[0]!.id, "bien");
  e.reloj.avanzarMinutos(1);
  await calificarYGuardar(c.almacen, e.reloj, ts[1]!.id, "facil");
  e.reloj.avanzarMinutos(1);
  await calificarYGuardar(c.almacen, e.reloj, ts[2]!.id, "otra_vez");
  e.reloj.avanzarMinutos(1);
  const r = await calificarYGuardar(c.almacen, e.reloj, ts[3]!.id, "dificil");
  e.reloj.avanzarMinutos(1);
  await deshacerCalificacion(c.almacen, e.reloj, r);
  await suspenderTarjeta(c.almacen, e.reloj, ts[4]!.id);
  await borrarTarjeta(c.almacen, e.reloj, ts[5]!.id);
  const meta = await crearMetaAnual(c.almacen, e.reloj, { anio: 2026, titulo: "Aprender" });
  const tarea = await crearTarea(c.almacen, e.reloj, { titulo: "Tarea 1", meta_id: meta.id });
  await marcarHecha(c.almacen, e.reloj, tarea.id);
  await crearTarea(c.almacen, e.reloj, { titulo: "Tarea 2", fecha: "2026-03-12" });
  await crearApunte(c.almacen, e.reloj, { texto: "Una idea suelta" });
  await c.motor.sincronizar();
  return c;
}

describe("exportar e importar en el cliente", () => {
  it("S7: exportar todo y reimportarlo en una instalación limpia da los mismos conteos y el mismo estado de repaso en cada tarjeta", async () => {
    const e = await Entorno.crear();
    const origen = await instalacionConDatos(e);
    const texto = await exportarLocalTexto(origen.crudo, e.reloj);

    // Instalación limpia (IndexedDB nueva), con su cola para sincronizar.
    const idb = await AlmacenIndexedDB.abrir("limpia", new IDBFactory());
    const nuevo = new AlmacenSincronizado(idb, idb.cola);
    const informe = await importarRespaldo(nuevo, texto);
    expect(informe.ok).toBe(true);
    expect(await conteos(idb)).toEqual(await conteos(origen.crudo));
    expect((await conteos(idb))["tarjetas"]).toBe(6); // incluye la borrada y la suspendida

    const a = await origen.crudo.tarjetas.listar({ incluirBorrados: true });
    for (const t of a) {
      const b = await idb.tarjetas.obtener(t.id);
      expect(b).toBeDefined();
      expect({ ease: b!.ease, intervalo: b!.intervalo, reps: b!.reps, lapses: b!.lapses, vence: b!.vence }).toEqual({
        ease: t.ease, intervalo: t.intervalo, reps: t.reps, lapses: t.lapses, vence: t.vence,
      });
      expect(b).toEqual(t); // registro idéntico
    }
    expect((await idb.repasos.listar()).map((r) => r.id).sort()).toEqual((await origen.crudo.repasos.listar()).map((r) => r.id).sort());
    expect(await contarPendientes(idb.cola)).toBeGreaterThan(0); // quedó anotado para sincronizar

    // Idempotente: importar otra vez no cambia nada.
    const otra = await importarRespaldo(nuevo, texto);
    expect(otra).toMatchObject({ ok: true, sinCambios: (informe as any).total });
    expect(Object.values((otra as any).nuevos).reduce((s: number, n) => s + (n as number), 0)).toBe(0);
    expect(Object.values((otra as any).actualizados).reduce((s: number, n) => s + (n as number), 0)).toBe(0);
    expect(lineasDeInforme(otra).join(" ")).toContain("No había nada nuevo");

    // Y lo importado se sincroniza: un servidor limpio recibe lo mismo.
    const e2 = await Entorno.crear();
    const c2 = e2.cliente({ almacenCrudo: idb, cola: idb.cola, persistencia: new MemoriaPersistente() as never });
    await entrar(c2);
    expect(contarTodo(e2.servidor.db)).toEqual(contarTodo(e.servidor.db));
    idb.cerrar();
  });

  it("el export del cliente tiene el mismo formato que GET /export del servidor", async () => {
    const e = await Entorno.crear();
    const c = await instalacionConDatos(e);
    const token = c.persistencia.getItem("lean-os:token")!;
    const delServidor = (await (await e.fetch("/export", { headers: { authorization: `Bearer ${token}` } })).json()) as any;
    const local = await exportarLocal(c.crudo, e.reloj);
    expect(Object.keys(local).sort()).toEqual(Object.keys(delServidor).sort());
    expect(local.formato).toBe(VERSION_FORMATO);
    expect(Object.keys(local.tablas).sort()).toEqual(Object.keys(delServidor.tablas).sort());
    const porId = (xs: any[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
    // Los repasos locales no se reescriben (solo se agregan), así que conservan rev null; el resto coincide registro por registro.
    const sinRevDeRepasos = (t: string, xs: any[]) => (t === "repasos" ? xs.map(({ rev, ...r }) => r) : xs);
    for (const t of TABLAS) expect(sinRevDeRepasos(t, porId(local.tablas[t] as any[]))).toEqual(sinRevDeRepasos(t, porId(delServidor.tablas[t])));
    expect(local.rev).toBe(delServidor.rev);
  });

  it("el export de un cliente (repasos propios, registros sin rev) se restaura en un servidor vacío con los mismos conteos y llega a los demás clientes", async () => {
    const e = await Entorno.crear();
    const origen = new AlmacenMemoria();
    await cargarTarjetas(origen, e.reloj, 3);
    const ts = await origen.tarjetas.listar();
    e.reloj.avanzarMinutos(1);
    await calificarYGuardar(origen, e.reloj, ts[0]!.id, "bien");
    await calificarYGuardar(origen, e.reloj, ts[1]!.id, "facil");
    await crearTarea(origen, e.reloj, { titulo: "sin rev" });
    const texto = await exportarLocalTexto(origen, e.reloj);
    expect(JSON.parse(texto).tablas.repasos[0].rev).toBeNull();
    const vacio = await Entorno.crear();
    const cont = restaurarRespaldo(vacio.servidor.db, JSON.parse(texto));
    expect(cont).toMatchObject({ tarjetas: 3, repasos: 2, tareas: 1 });
    expect(cont).toEqual(await conteos(origen));
    // Los revs asignados son enteros mayores que 0: un pull desde 0 los trae.
    const otro = vacio.cliente();
    await entrar(otro);
    expect(await conteos(otro.crudo)).toEqual(await conteos(origen));
    expect(() => restaurarRespaldo((vacio as any).servidor.db, JSON.parse(texto))).toThrow(/ya tiene datos/);
    const roto = JSON.parse(texto);
    roto.tablas.tareas[0].rev = "x";
    const otroVacio = await Entorno.crear();
    expect(() => restaurarRespaldo(otroVacio.servidor.db, roto)).toThrow(/rev válido/);
  });

  it("importa también el export del servidor (con revs) en una instalación limpia", async () => {
    const e = await Entorno.crear();
    const c = await instalacionConDatos(e);
    const token = c.persistencia.getItem("lean-os:token")!;
    const texto = await (await e.fetch("/export", { headers: { authorization: `Bearer ${token}` } })).text();
    const limpio = new AlmacenMemoria();
    const r = await importarRespaldo(limpio, texto);
    expect(r.ok).toBe(true);
    expect(await conteos(limpio)).toEqual(await conteos(c.crudo));
  });

  it("un archivo inválido no cambia nada y el mensaje está en castellano", async () => {
    const e = await Entorno.crear();
    const alm = new AlmacenMemoria();
    await cargarTarjetas(alm, e.reloj, 2);
    const antes = await conteos(alm);
    const buenos = JSON.parse(await exportarLocalTexto(alm, e.reloj));
    const casos: Record<string, string> = {
      "no es JSON": "esto no es json {",
      "formato desconocido": JSON.stringify({ formato: 99, tablas: {} }),
      "falta una tabla": JSON.stringify({ ...buenos, tablas: { ...buenos.tablas, tareas: undefined } }),
      "registro sin id": JSON.stringify({ ...buenos, tablas: { ...buenos.tablas, tareas: [{ titulo: "x" }] } }),
      "tarjeta sin pregunta": JSON.stringify({
        ...buenos,
        tablas: { ...buenos.tablas, tarjetas: [{ ...buenos.tablas.tarjetas[0], id: "otra", pregunta: undefined }, ...buenos.tablas.tarjetas] },
      }),
    };
    for (const [nombre, texto] of Object.entries(casos)) {
      const r = await importarRespaldo(alm, texto);
      expect(r.ok, nombre).toBe(false);
      expect((r as any).error, nombre).toContain("No se cambió nada");
      expect(await conteos(alm), nombre).toEqual(antes);
    }
    // Un respaldo con un registro malo al final tampoco aplica los buenos que lo preceden.
    const mezcla = JSON.stringify({ ...buenos, tablas: { ...buenos.tablas, tareas: [{ id: "t-ok", created_at: "2026-03-10T12:00:00.000Z", updated_at: "2026-03-10T12:00:00.000Z", deleted_at: null, rev: null, titulo: "ok", fecha: null, meta_id: null, nota: null, estado: "pendiente", hecha_en: null }, { id: "t-mal" }] } });
    expect((await importarRespaldo(alm, mezcla)).ok).toBe(false);
    expect(await alm.tareas.obtener("t-ok")).toBeUndefined();
  });

  it("nunca pisa un registro con otro menos reciente y nada se borra", async () => {
    const e = await Entorno.crear();
    const alm = new AlmacenMemoria();
    await cargarTarjetas(alm, e.reloj, 2);
    const t = await crearTarea(alm, e.reloj, { titulo: "Versión del respaldo" });
    const tarjeta = (await alm.tarjetas.listar())[0]!;
    const texto = await exportarLocalTexto(alm, e.reloj); // respaldo "viejo"

    e.reloj.avanzarMinutos(10);
    await editarTarea(alm, e.reloj, t.id, { titulo: "Editada después del respaldo" });
    await editarTarjeta(alm, e.reloj, tarjeta.id, { pregunta: "Pregunta editada después" });
    await calificarYGuardar(alm, e.reloj, tarjeta.id, "bien");
    const extra = await crearTarea(alm, e.reloj, { titulo: "Creada después del respaldo" });
    const r = await importarRespaldo(alm, texto);
    expect(r.ok).toBe(true);
    expect((await alm.tareas.obtener(t.id))?.titulo).toBe("Editada después del respaldo");
    const tj = (await alm.tarjetas.obtener(tarjeta.id))!;
    expect(tj.pregunta).toBe("Pregunta editada después");
    expect(tj.reps).toBe(1);
    expect((await alm.tareas.obtener(extra.id))?.titulo).toBe("Creada después del respaldo"); // lo que no está en el respaldo se conserva
    expect((r as any).actualizados.tareas).toBe(0);

    // A la inversa: el respaldo trae algo más nuevo y gana.
    const nuevo = JSON.parse(texto);
    nuevo.tablas.tareas[0].titulo = "Del respaldo, más nueva";
    nuevo.tablas.tareas[0].updated_at = new Date(e.reloj.ahora().getTime() + 60_000).toISOString();
    const r2 = await importarRespaldo(alm, JSON.stringify(nuevo));
    expect((r2 as any).actualizados.tareas).toBe(1);
    expect((await alm.tareas.obtener(t.id))?.titulo).toBe("Del respaldo, más nueva");
  });

  it("el informe cuenta registros nuevos y se escribe en castellano", async () => {
    const e = await Entorno.crear();
    const origen = new AlmacenMemoria();
    await cargarTarjetas(origen, e.reloj, 3);
    await crearTarea(origen, e.reloj, { titulo: "x" });
    const r = await importarRespaldo(new AlmacenMemoria(), await exportarLocalTexto(origen, e.reloj));
    expect(r.ok && r.nuevos.tarjetas).toBe(3);
    expect(r.ok && r.nuevos.tareas).toBe(1);
    const lineas = lineasDeInforme(r);
    expect(lineas[0]).toMatch(/^Respaldo importado: \d+ registros nuevos, 0 actualizados y 0 que ya estaban\.$/);
    expect(lineas.join("\n")).toContain("Tarjetas: 3 nuevos, 0 actualizados.");
    expect(lineas.join("\n")).toContain("No se borró nada");
  });

  it("importar en una instalación con sesión encola lo importado para subirlo", async () => {
    const e = await Entorno.crear();
    const origen = new AlmacenMemoria();
    await cargarTarjetas(origen, e.reloj, 3);
    const texto = await exportarLocalTexto(origen, e.reloj);
    const c = e.cliente();
    await entrar(c);
    await importarRespaldo(c.almacen, texto);
    expect(c.motor.estado().pendientes).toBe(0 + (await contarPendientes(c.cola)));
    await c.motor.sincronizar();
    expect(contarTodo(e.servidor.db)).toMatchObject({ tarjetas: 3 });
  });

  it("ColaMemoria sola: el almacén sin sync sigue funcionando igual", async () => {
    const e = await Entorno.crear();
    const cola = new ColaMemoria();
    const alm = new AlmacenSincronizado(new AlmacenMemoria(), cola);
    await cargarTarjetas(alm, e.reloj, 1);
    expect((await alm.tarjetas.listar()).length).toBe(1);
  });
});
