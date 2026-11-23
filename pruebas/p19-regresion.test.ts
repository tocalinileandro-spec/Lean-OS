/**
 * P19 (sin regresión): lo que ya existía antes de la etapa 7 sigue funcionando.
 * (a) datos con el formato anterior se ven bien en las pantallas nuevas (memoria e IndexedDB);
 * (b) el esquema no cambió (prueba "golden");
 * (c) tras usar las funciones nuevas, los datos exportan, reimportan y sincronizan sin errores ni duplicados.
 */
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { AlmacenIndexedDB } from "../src/cliente/almacen-indexeddb.ts";
import { montarApp, type Pantalla } from "../src/cliente/ui/app.ts";
import type { Persistencia } from "../src/cliente/ui/logica.ts";
import { AlmacenSincronizado } from "../src/cliente/sync/cola.ts";
import { exportarLocal, exportarLocalTexto, importarRespaldo } from "../src/cliente/sync/respaldo.ts";
import { AlmacenMemoria, type Almacen } from "../src/compartido/almacen.ts";
import { borrarArea, borrarSubarea, borrarTema, crearArea, moverTema, restaurarArea, restaurarTema } from "../src/compartido/areas.ts";
import { fijarHoraCambio } from "../src/compartido/dia.ts";
import { TABLAS } from "../src/compartido/esquema.ts";
import type { Apunte, Area, Importacion, Meta, Repaso, Tarea, Tarjeta } from "../src/compartido/esquema.ts";
import { importarRespaldoOriginal } from "../src/compartido/migracion-original.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { contarTodo } from "../src/servidor/respaldo.ts";
import { Entorno, entrar, fila } from "./ayuda-sync.ts";

afterEach(() => fijarHoraCambio());

const AHORA = "2026-11-22T15:00:00.000Z"; // 22/11/2026 12:00 en Buenos Aires
const HOY = "2026-11-22";
const T = "2026-01-01T00:00:00.000Z";
const base = { created_at: T, updated_at: T, deleted_at: null, rev: null };

// ---------------------------------------------------------------- datos "de antes" (formato anterior a la etapa 7)

function datosDeAntes() {
  const areas: Area[] = [
    { ...base, id: "ar-prog", nombre: "Programación", nombre_normalizado: "programacion", padre_id: null },
    { ...base, id: "ar-cs50", nombre: "CS50", nombre_normalizado: "cs50", padre_id: "ar-prog" },
    { ...base, id: "ar-ing", nombre: "Inglés", nombre_normalizado: "ingles", padre_id: null },
  ];
  const tj = (id: string, area_id: string, extra: Partial<Tarjeta> = {}): Tarjeta => ({
    ...base, id, area_id, pregunta: `Pregunta ${id}`, respuesta: "Respuesta", pista: null, suspendida: false, importacion_id: null,
    ease: 2.5, intervalo: 0, reps: 0, lapses: 0, vence: HOY, contenido_updated_at: T, repaso_updated_at: T, ...extra,
  });
  const tarjetas: Tarjeta[] = [
    tj("k1", "ar-cs50", { importacion_id: "im1" }),
    tj("k2", "ar-cs50", { importacion_id: "im1" }),
    tj("k3", "ar-prog", { intervalo: 25, reps: 4, vence: "2026-12-20", ease: 2.6 }),
    tj("k4", "ar-ing", { importacion_id: "im2" }),
  ];
  const importaciones: Importacion[] = [
    { ...base, id: "im1", tema: "Funciones", fecha_bloque: "2026-11-10", area_id: "ar-cs50", tarjetas_creadas: ["k1", "k2"], duplicadas_omitidas: 0, apunte_id: "ap1" },
    { ...base, id: "im2", tema: "Verbos", fecha_bloque: "2026-11-11", area_id: "ar-ing", tarjetas_creadas: ["k4"], duplicadas_omitidas: 0, apunte_id: null },
  ];
  const apuntes: Apunte[] = [
    { ...base, id: "ap1", titulo: "Funciones", texto: "Las funciones agrupan código.", tipo: "aprendizaje", etiquetas: [], area_id: "ar-cs50", tema: "Funciones", importacion_id: "im1" },
    { ...base, id: "ap2", titulo: null, texto: "Una idea suelta", tipo: "idea", etiquetas: ["x"], area_id: null, tema: null, importacion_id: null },
  ];
  const repasos: Repaso[] = [
    { ...base, id: "rp1", tarjeta_id: "k3", calificacion: "bien", repasado_en: "2026-11-01T15:00:00.000Z", ease_antes: 2.5, ease_despues: 2.6, intervalo_antes: 7, intervalo_despues: 25 },
  ];
  const metas: Meta[] = [
    { ...base, id: "m1", tipo: "anual", anio: 2026, trimestre: null, titulo: "Aprender TS", estado: "activa", padre_id: null },
    { ...base, id: "m2", tipo: "trimestral", anio: 2026, trimestre: 4, titulo: "Cerrar la app", estado: "activa", padre_id: "m1" },
  ];
  // Tareas del formato anterior: sin `repeticion` ni `serie_id`.
  const tareas: Tarea[] = [
    { ...base, id: "ts1", titulo: "Estudiar funciones", fecha: HOY, meta_id: "m2", nota: null, estado: "pendiente", hecha_en: null },
    { ...base, id: "ts2", titulo: "Tarea vieja hecha", fecha: null, meta_id: null, nota: "n", estado: "hecha", hecha_en: "2026-11-05T15:00:00.000Z" },
  ];
  return { areas, tarjetas, importaciones, apuntes, repasos, metas, tareas };
}

async function sembrar(a: Almacen) {
  const d = datosDeAntes();
  await a.guardarLote({ areas: d.areas, tarjetas: d.tarjetas, importaciones: d.importaciones, apuntes: d.apuntes, metas: d.metas, tareas: d.tareas });
  for (const r of d.repasos) await a.repasos.agregar(r);
}

async function conteos(a: Almacen) {
  const r: Record<string, number> = {};
  for (const t of TABLAS) r[t] = t === "repasos" ? (await a.repasos.listar()).length : (await (a as any)[t].listar({ incluirBorrados: true })).length;
  return r;
}

class Memoria implements Persistencia {
  datos = new Map<string, string>();
  getItem(k: string) { return this.datos.get(k) ?? null; }
  setItem(k: string, v: string) { this.datos.set(k, v); }
}

async function abrir(almacen: Almacen, inicial: Pantalla) {
  const ventana = new Window({ url: "http://localhost/" });
  const raiz = ventana.document.createElement("div");
  ventana.document.body.append(raiz);
  const errores: unknown[] = [];
  ventana.addEventListener("error", (e: unknown) => errores.push(e));
  const app = montarApp(raiz as unknown as HTMLElement, { almacen, reloj: new RelojSimulado(AHORA), persistencia: new Memoria() }, inicial);
  await app.esperar();
  const clic = async (t: string) => {
    const b = [...ventana.document.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim().startsWith(t));
    if (!b) throw new Error(`No hay botón "${t}" en: ${raiz.textContent}`);
    b.click();
    await app.esperar();
  };
  return { texto: () => raiz.textContent ?? "", contexto: () => ventana.document.querySelector(".contexto")?.textContent ?? "", clic, errores };
}

function sinErrores(ui: { texto(): string; errores: unknown[] }) {
  expect(ui.errores).toEqual([]);
  expect(ui.texto()).not.toContain("No se pudo completar");
  expect(ui.texto()).not.toContain("undefined");
  expect(ui.texto()).not.toContain("NaN");
}

async function verPantallasNuevas(almacen: Almacen) {
  const areas = await abrir(almacen, "areas");
  sinErrores(areas);
  expect(areas.texto()).toContain("4 tarjetas en 2 áreas.");
  expect(areas.texto()).toContain("Programación");
  expect(areas.texto()).toContain("Inglés");
  expect(areas.texto()).toContain("3 tarjetas · 1 subárea");
  expect(areas.texto()).toMatch(/\d+ para hoy/);
  await areas.clic("Programación");
  sinErrores(areas);
  expect(areas.texto()).toContain("CS50");
  expect(areas.texto()).toContain("Funciones");

  const repaso = await abrir(almacen, "repaso");
  sinErrores(repaso);
  expect(repaso.texto()).toContain("Tarjeta 1 de 3"); // k1, k2, k4 vencen hoy; k3 no
  expect(repaso.contexto()).toMatch(/^(Programación › CS50 · Funciones|Inglés · Verbos)/);

  const tarjetas = await abrir(almacen, "tarjetas");
  sinErrores(tarjetas);
  expect(tarjetas.texto()).toContain("Pregunta k3");

  const hoy = await abrir(almacen, "hoy");
  sinErrores(hoy);
  expect(hoy.texto()).toContain("Estudiar funciones");
}

describe("P19: sin regresión", () => {
  it("P19: datos de antes de la etapa 7 se ven bien en las pantallas nuevas (memoria)", async () => {
    const a = new AlmacenMemoria();
    await sembrar(a);
    await verPantallasNuevas(a);
    expect(await conteos(a)).toEqual({ tarjetas: 4, repasos: 1, areas: 3, metas: 2, tareas: 2, apuntes: 2, importaciones: 2 });
  });

  it("P19: datos de antes de la etapa 7 se ven bien en las pantallas nuevas (IndexedDB)", async () => {
    const idb = await AlmacenIndexedDB.abrir("p19", new IDBFactory());
    await sembrar(idb);
    await verPantallasNuevas(idb);
    expect(await conteos(idb)).toEqual({ tarjetas: 4, repasos: 1, areas: 3, metas: 2, tareas: 2, apuntes: 2, importaciones: 2 });
  });

  it("P19: el esquema no cambió (campos de cada registro y lista de tablas)", () => {
    // `Record<keyof X, true>` obliga a listar TODOS los campos de la interfaz: agregar o quitar uno rompe `npm run tipos`.
    const comunes = { id: true, created_at: true, updated_at: true, deleted_at: true, rev: true } as const;
    const area = { ...comunes, nombre: true, nombre_normalizado: true, padre_id: true } satisfies Record<keyof Area, true>;
    const tarjeta = {
      ...comunes, area_id: true, pregunta: true, respuesta: true, pista: true, suspendida: true, importacion_id: true,
      ease: true, intervalo: true, reps: true, lapses: true, vence: true, contenido_updated_at: true, repaso_updated_at: true,
    } satisfies Record<keyof Tarjeta, true>;
    const repaso = {
      ...comunes, tarjeta_id: true, calificacion: true, repasado_en: true, ease_antes: true, ease_despues: true,
      intervalo_antes: true, intervalo_despues: true, anula_a: true,
    } satisfies Record<keyof Repaso, true>;
    const meta = { ...comunes, tipo: true, anio: true, trimestre: true, titulo: true, estado: true, padre_id: true } satisfies Record<keyof Meta, true>;
    const tarea = {
      ...comunes, titulo: true, fecha: true, meta_id: true, nota: true, estado: true, hecha_en: true, repeticion: true, serie_id: true,
    } satisfies Record<keyof Tarea, true>;
    const apunte = { ...comunes, titulo: true, texto: true, tipo: true, etiquetas: true, area_id: true, tema: true, importacion_id: true } satisfies Record<keyof Apunte, true>;
    const importacion = {
      ...comunes, tema: true, fecha_bloque: true, area_id: true, tarjetas_creadas: true, duplicadas_omitidas: true, apunte_id: true,
    } satisfies Record<keyof Importacion, true>;
    const claves = (o: object) => Object.keys(o).sort();
    const registro = ["created_at", "deleted_at", "id", "rev", "updated_at"];

    expect(claves(area)).toEqual([...registro, "nombre", "nombre_normalizado", "padre_id"].sort());
    expect(claves(tarjeta)).toEqual([...registro, "area_id", "contenido_updated_at", "ease", "importacion_id", "intervalo", "lapses", "pista", "pregunta", "repaso_updated_at", "reps", "respuesta", "suspendida", "vence"].sort());
    expect(claves(repaso)).toEqual([...registro, "anula_a", "calificacion", "ease_antes", "ease_despues", "intervalo_antes", "intervalo_despues", "repasado_en", "tarjeta_id"].sort());
    expect(claves(meta)).toEqual([...registro, "anio", "estado", "padre_id", "tipo", "titulo", "trimestre"].sort());
    expect(claves(tarea)).toEqual([...registro, "estado", "fecha", "hecha_en", "meta_id", "nota", "repeticion", "serie_id", "titulo"].sort());
    expect(claves(apunte)).toEqual([...registro, "area_id", "etiquetas", "importacion_id", "tema", "texto", "tipo", "titulo"].sort());
    expect(claves(importacion)).toEqual([...registro, "area_id", "apunte_id", "duplicadas_omitidas", "fecha_bloque", "tarjetas_creadas", "tema"].sort());

    // Los obligatorios son los de los datos de antes (sin los opcionales de Repaso y Tarea): si se exige uno nuevo, `sembrar` deja de compilar.
    const d = datosDeAntes();
    expect(Object.keys(d.repasos[0]!)).not.toContain("anula_a");
    expect(Object.keys(d.tareas[0]!)).not.toContain("repeticion");
    expect(Object.keys(d.tareas[0]!)).not.toContain("serie_id");
    expect(claves(d.areas[0]!)).toEqual(claves(area));
    expect(claves(d.tarjetas[0]!)).toEqual(claves(tarjeta));
    expect(claves(d.metas[0]!)).toEqual(claves(meta));
    expect(claves(d.apuntes[0]!)).toEqual(claves(apunte));
    expect(claves(d.importaciones[0]!)).toEqual(claves(importacion));

    expect([...TABLAS]).toEqual(["tarjetas", "repasos", "areas", "metas", "tareas", "apuntes", "importaciones"]);
  });

  it("P19: tras usar lo nuevo, los datos exportan, reimportan y sincronizan sin errores ni duplicados", async () => {
    const e = await Entorno.crear();
    const c1 = e.cliente();
    const c2 = e.cliente();
    await entrar(c1);
    await entrar(c2);
    const min = () => e.reloj.avanzarMinutos(1);

    // Datos de antes + funciones nuevas, todo por el almacén sincronizado (queda en la cola).
    await sembrar(c1.almacen);
    min();
    const nueva = await crearArea(c1.almacen, e.reloj, "Matemática");
    expect(nueva.creada).toBe(true);
    const mate = (await c1.crudo.areas.listar()).find((x) => x.nombre === "Matemática")!;
    min();
    const sub = await crearArea(c1.almacen, e.reloj, "Álgebra", mate.id);
    expect(sub.creada).toBe(true);
    const algebra = (await c1.crudo.areas.listar()).find((x) => x.nombre === "Álgebra")!;
    expect(algebra.padre_id).toBe(mate.id);
    min();
    const mov = await moverTema(c1.almacen, e.reloj, "im2", algebra.id);
    expect(mov.tarjetas).toBe(1);
    min();
    const inf = await importarRespaldoOriginal(c1.almacen, e.reloj, [{ nombre: "lean-os.zip", bytes: new Uint8Array(readFileSync(new URL("./fixtures/respaldo-original.zip", import.meta.url))) }]);
    expect(inf.errores).toEqual([]);
    expect(inf.creadas).toBe(11);
    min();
    await borrarTema(c1.almacen, e.reloj, "im1");
    min();
    await restaurarTema(c1.almacen, e.reloj, "im1");
    min();
    await borrarSubarea(c1.almacen, e.reloj, "ar-cs50");
    min();
    await restaurarArea(c1.almacen, e.reloj, "ar-cs50");
    min();
    await borrarArea(c1.almacen, e.reloj, "ar-prog"); // en cascada: subárea, temas, tarjetas y apuntes

    // Sincronizar: el servidor acepta todo, sin errores.
    await c1.motor.sincronizar();
    expect(c1.motor.estado().fase).toBe("sincronizado");
    expect(c1.motor.estado().pendientes).toBe(0);
    const local = await conteos(c1.crudo);
    expect(contarTodo(e.servidor.db)).toEqual(local); // mismos conteos: nada de más, nada duplicado (S3)

    // Idempotente: volver a sincronizar (también con subida completa) no duplica.
    c1.motor.pedirSubidaCompleta();
    await c1.motor.sincronizar();
    await c1.motor.sincronizar();
    expect(contarTodo(e.servidor.db)).toEqual(local);

    // El borrado en cascada viaja como borrado lógico y llega al segundo cliente.
    const borrados = (await c1.crudo.areas.listar({ incluirBorrados: true })).filter((x) => x.deleted_at !== null).map((x) => x.id);
    expect(borrados).toEqual(expect.arrayContaining(["ar-prog", "ar-cs50"]));
    const tarjetasBorradas = (await c1.crudo.tarjetas.listar({ incluirBorrados: true })).filter((t) => t.deleted_at !== null);
    expect(tarjetasBorradas.map((t) => t.id)).toEqual(expect.arrayContaining(["k1", "k2", "k3"]));
    for (const id of borrados) expect(fila(e.servidor.db, "areas", id)?.["deleted_at"]).not.toBeNull();
    for (const t of tarjetasBorradas) expect(fila(e.servidor.db, "tarjetas", t.id)?.["deleted_at"]).not.toBeNull();
    expect(fila(e.servidor.db, "tarjetas", "k4")?.["deleted_at"]).toBeNull(); // lo movido a Matemática sigue vivo

    await c2.motor.sincronizar();
    expect(c2.motor.estado().fase).toBe("sincronizado");
    expect(await conteos(c2.crudo)).toEqual(local);
    for (const id of borrados) expect((await c2.crudo.areas.obtener(id))?.deleted_at).not.toBeNull();
    for (const t of tarjetasBorradas) expect((await c2.crudo.tarjetas.obtener(t.id))?.deleted_at).not.toBeNull();
    expect((await c2.crudo.importaciones.obtener("im2"))?.area_id).toBe(algebra.id);
    // Segundo cliente: otra sincronización no cambia nada.
    await c2.motor.sincronizar();
    expect(await conteos(c2.crudo)).toEqual(local);
    expect(contarTodo(e.servidor.db)).toEqual(local);

    // S7: exportar todo y reimportar en una instalación limpia: mismos conteos y mismo estado de repaso.
    const texto = await exportarLocalTexto(c1.crudo, e.reloj);
    const idb = await AlmacenIndexedDB.abrir("p19-limpia", new IDBFactory());
    const informe = await importarRespaldo(new AlmacenSincronizado(idb, idb.cola), texto);
    expect(informe.ok).toBe(true);
    expect(await conteos(idb)).toEqual(local);
    for (const t of await c1.crudo.tarjetas.listar({ incluirBorrados: true })) {
      expect(await idb.tarjetas.obtener(t.id)).toEqual(t);
    }
    expect((await idb.repasos.listar()).map((r) => r.id).sort()).toEqual((await c1.crudo.repasos.listar()).map((r) => r.id).sort());
    expect((await exportarLocal(idb, e.reloj)).tablas).toEqual((await exportarLocal(c1.crudo, e.reloj)).tablas);
    // Reimportar otra vez no cambia nada.
    await importarRespaldo(idb, texto);
    expect(await conteos(idb)).toEqual(local);
  });
});
