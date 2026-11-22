import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { AlmacenMemoria, type Almacen } from "../src/compartido/almacen.ts";
import { AlmacenIndexedDB } from "../src/cliente/almacen-indexeddb.ts";
import type { Area, Repaso, Tarjeta } from "../src/compartido/esquema.ts";

const T0 = "2026-11-22T15:00:00.000Z";
const base = { created_at: T0, updated_at: T0, deleted_at: null, rev: null };
const tarjeta = (id: string, extra: Partial<Tarjeta> = {}): Tarjeta => ({
  ...base, id, area_id: "a1", pregunta: `p${id}`, respuesta: "r", pista: null, suspendida: false, importacion_id: null,
  ease: 2.5, intervalo: 0, reps: 0, lapses: 0, vence: "2026-11-22", contenido_updated_at: T0, repaso_updated_at: T0, ...extra,
});
const area = (id: string): Area => ({ ...base, id, nombre: id, nombre_normalizado: id, padre_id: null });
const repaso = (id: string, tarjeta_id: string): Repaso => ({
  ...base, id, tarjeta_id, calificacion: "bien", repasado_en: T0, ease_antes: 2.5, ease_despues: 2.5, intervalo_antes: 0, intervalo_despues: 1,
});

const fabricas: [string, () => Promise<Almacen>][] = [
  ["AlmacenMemoria", async () => new AlmacenMemoria()],
  ["AlmacenIndexedDB", () => AlmacenIndexedDB.abrir("contrato", new IDBFactory())],
];

describe.each(fabricas)("contrato del almacén: %s", (_n, crear) => {
  it("guardar, obtener y listar en orden de inserción (ids desordenados)", async () => {
    const a = await crear();
    await a.tarjetas.guardarVarios([tarjeta("z"), tarjeta("b"), tarjeta("m")]);
    await a.tarjetas.guardar(tarjeta("a"));
    expect((await a.tarjetas.listar()).map((t) => t.id)).toEqual(["z", "b", "m", "a"]);
    expect((await a.tarjetas.obtener("b"))?.pregunta).toBe("pb");
    expect(await a.tarjetas.obtener("nada")).toBeUndefined();
  });

  it("reemplazar conserva la posición y no deja campos internos", async () => {
    const a = await crear();
    await a.tarjetas.guardarVarios([tarjeta("z"), tarjeta("b")]);
    await a.tarjetas.guardar(tarjeta("z", { pregunta: "nueva" }));
    const l = await a.tarjetas.listar();
    expect(l.map((t) => t.id)).toEqual(["z", "b"]);
    expect(l[0]).toEqual(tarjeta("z", { pregunta: "nueva" }));
  });

  it("los borrados se ocultan salvo incluirBorrados", async () => {
    const a = await crear();
    await a.tarjetas.guardarVarios([tarjeta("1"), tarjeta("2", { deleted_at: T0 })]);
    expect((await a.tarjetas.listar()).map((t) => t.id)).toEqual(["1"]);
    expect(await a.tarjetas.listar({ incluirBorrados: true })).toHaveLength(2);
  });

  it("los datos devueltos son copias", async () => {
    const a = await crear();
    await a.tarjetas.guardar(tarjeta("1"));
    (await a.tarjetas.obtener("1"))!.pregunta = "mutada";
    expect((await a.tarjetas.obtener("1"))!.pregunta).toBe("p1");
  });

  it("repasos: agregar es idempotente por id y se filtra por tarjeta", async () => {
    const a = await crear();
    await a.repasos.agregar(repaso("r1", "t1"));
    await a.repasos.agregar(repaso("r1", "t1"));
    await a.repasos.agregar(repaso("r2", "t2"));
    expect(await a.repasos.listar()).toHaveLength(2);
    expect((await a.repasos.listarPorTarjeta("t2")).map((r) => r.id)).toEqual(["r2"]);
  });

  it("eliminarDefinitivo quita registros e ignora ids inexistentes", async () => {
    const a = await crear();
    await a.tarjetas.guardarVarios([tarjeta("1"), tarjeta("2")]);
    await a.tarjetas.eliminarDefinitivo(["1", "xx"]);
    expect((await a.tarjetas.listar({ incluirBorrados: true })).map((t) => t.id)).toEqual(["2"]);
  });

  it("guardarLote es todo o nada ante un registro inválido", async () => {
    const a = await crear();
    const malo = { ...tarjeta("2"), id: undefined } as unknown as Tarjeta;
    await expect(a.guardarLote({ areas: [area("a1")], tarjetas: [tarjeta("1"), malo] })).rejects.toBeDefined();
    expect(await a.areas.listar()).toHaveLength(0);
    expect(await a.tarjetas.listar()).toHaveLength(0);
  });

  it("guardarLote escribe varias tablas", async () => {
    const a = await crear();
    await a.guardarLote({ areas: [area("a1")], tarjetas: [tarjeta("1")] });
    expect(await a.areas.listar()).toHaveLength(1);
    expect(await a.tarjetas.listar()).toHaveLength(1);
  });
});

describe("AlmacenIndexedDB: transacción única", () => {
  it("guardarLote es todo o nada: si falla un registro no se guarda ninguno", async () => {
    const a = await AlmacenIndexedDB.abrir("atomico", new IDBFactory());
    const malo = { ...tarjeta("2"), id: undefined } as unknown as Tarjeta; // sin clave: la transacción falla
    await expect(a.guardarLote({ areas: [area("a1")], tarjetas: [tarjeta("1"), malo] })).rejects.toBeDefined();
    expect(await a.areas.listar()).toHaveLength(0);
    expect(await a.tarjetas.listar()).toHaveLength(0);
  });

  it("tiene las stores pedidas, incluida la cola de cambios", async () => {
    const f = new IDBFactory();
    const a = await AlmacenIndexedDB.abrir("stores", f);
    a.cerrar();
    const db = await new Promise<IDBDatabase>((ok) => { const r = f.open("stores"); r.onsuccess = () => ok(r.result); });
    expect([...db.objectStoreNames]).toEqual(expect.arrayContaining(
      ["tarjetas", "repasos", "areas", "metas", "tareas", "apuntes", "importaciones", "cola_cambios"]));
  });
});
