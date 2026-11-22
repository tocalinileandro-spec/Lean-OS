/**
 * Almacén sobre IndexedDB (navegador). Sin dependencias. Cada método es una transacción; `guardarLote`
 * escribe varias tablas en una sola. Los registros se guardan con un número de secuencia interno (`_seq`)
 * para devolver `listar` en orden de inserción (IndexedDB ordena por clave, que acá es un UUID).
 * La store `cola_cambios` queda creada para la sincronización futura (fase 4); no tiene lógica todavía.
 */
import type { Almacen, Lote, OpcionesListar, Repositorio, RepositorioRepasos } from "../compartido/almacen.ts";
import type { Apunte, Area, Id, Importacion, Meta, Registro, Repaso, Tarea, Tarjeta } from "../compartido/esquema.ts";

export const VERSION_BASE = 1;
const STORES = ["tarjetas", "repasos", "areas", "metas", "tareas", "apuntes", "importaciones"] as const;
const COLA = "cola_cambios";
const CONTADOR = "contador";

type Guardado<T> = T & { _seq: number };

const pedir = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((ok, mal) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });

const terminar = (tx: IDBTransaction): Promise<void> =>
  new Promise((ok, mal) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => mal(tx.error);
    tx.onabort = () => mal(tx.error ?? new Error("Transacción abortada"));
  });

function limpiar<T>(x: Guardado<T>): T {
  const { _seq, ...resto } = x;
  void _seq;
  return resto as unknown as T;
}

/** Inserta o reemplaza dentro de una transacción ya abierta, conservando la secuencia si el id ya existía. */
async function poner<T extends { id: Id }>(tx: IDBTransaction, tabla: string, items: T[]): Promise<void> {
  const store = tx.objectStore(tabla);
  const cont = tx.objectStore(CONTADOR);
  for (const item of items) {
    const previo = (await pedir(store.get(item.id))) as Guardado<T> | undefined;
    let seq = previo?._seq;
    if (seq === undefined) {
      seq = ((await pedir(cont.get(tabla))) as number | undefined ?? 0) + 1;
      await pedir(cont.put(seq, tabla));
    }
    await pedir(store.put({ ...structuredClone(item), _seq: seq }));
  }
}

async function leerTodo<T>(db: IDBDatabase, tabla: string): Promise<T[]> {
  const tx = db.transaction(tabla, "readonly");
  const filas = (await pedir(tx.objectStore(tabla).getAll())) as Guardado<T>[];
  return filas.sort((a, b) => a._seq - b._seq).map(limpiar);
}

class RepoIDB<T extends Registro> implements Repositorio<T> {
  constructor(protected db: IDBDatabase, protected tabla: string) {}
  async obtener(id: Id) {
    const fila = (await pedir(this.db.transaction(this.tabla, "readonly").objectStore(this.tabla).get(id))) as Guardado<T> | undefined;
    return fila ? limpiar(fila) : undefined;
  }
  async listar(opciones: OpcionesListar = {}) {
    const todos = await leerTodo<T>(this.db, this.tabla);
    return opciones.incluirBorrados ? todos : todos.filter((x) => x.deleted_at === null);
  }
  async guardar(item: T) {
    await this.guardarVarios([item]);
  }
  async guardarVarios(items: T[]) {
    const tx = this.db.transaction([this.tabla, CONTADOR], "readwrite");
    const fin = terminar(tx);
    try {
      await poner(tx, this.tabla, items);
    } catch (e) {
      tx.abort();
      await fin.catch(() => {});
      throw e;
    }
    await fin;
  }
  async eliminarDefinitivo(ids: Id[]) {
    const tx = this.db.transaction(this.tabla, "readwrite");
    for (const id of ids) tx.objectStore(this.tabla).delete(id);
    await terminar(tx);
  }
}

class RepasosIDB implements RepositorioRepasos {
  constructor(private db: IDBDatabase) {}
  async agregar(r: Repaso) {
    const tx = this.db.transaction(["repasos", CONTADOR], "readwrite");
    const fin = terminar(tx);
    const existe = await pedir(tx.objectStore("repasos").getKey(r.id));
    if (existe === undefined) await poner(tx, "repasos", [r]); // idempotente por id
    await fin;
  }
  listar() {
    return leerTodo<Repaso>(this.db, "repasos");
  }
  async listarPorTarjeta(id: Id) {
    return (await this.listar()).filter((r) => r.tarjeta_id === id);
  }
}

export class AlmacenIndexedDB implements Almacen {
  tarjetas: Repositorio<Tarjeta>;
  areas: Repositorio<Area>;
  apuntes: Repositorio<Apunte>;
  importaciones: Repositorio<Importacion>;
  repasos: RepositorioRepasos;
  metas: Repositorio<Meta>;
  tareas: Repositorio<Tarea>;

  private constructor(private db: IDBDatabase) {
    this.tarjetas = new RepoIDB<Tarjeta>(db, "tarjetas");
    this.areas = new RepoIDB<Area>(db, "areas");
    this.apuntes = new RepoIDB<Apunte>(db, "apuntes");
    this.importaciones = new RepoIDB<Importacion>(db, "importaciones");
    this.repasos = new RepasosIDB(db);
    this.metas = new RepoIDB<Meta>(db, "metas");
    this.tareas = new RepoIDB<Tarea>(db, "tareas");
  }

  /** Abre (o crea) la base. `fabrica` permite inyectar otra implementación de IndexedDB (pruebas). */
  static async abrir(nombre = "lean-os", fabrica: IDBFactory = globalThis.indexedDB): Promise<AlmacenIndexedDB> {
    const req = fabrica.open(nombre, VERSION_BASE);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
      if (!db.objectStoreNames.contains(CONTADOR)) db.createObjectStore(CONTADOR);
      if (!db.objectStoreNames.contains(COLA)) db.createObjectStore(COLA, { keyPath: "seq", autoIncrement: true });
    };
    return new AlmacenIndexedDB(await pedir(req));
  }

  async guardarLote(lote: Lote) {
    const partes: [string, { id: Id }[]][] = [
      ["areas", lote.areas ?? []], ["tarjetas", lote.tarjetas ?? []],
      ["apuntes", lote.apuntes ?? []], ["importaciones", lote.importaciones ?? []],
      ["metas", lote.metas ?? []], ["tareas", lote.tareas ?? []],
    ];
    const tx = this.db.transaction([...partes.map(([t]) => t), CONTADOR], "readwrite");
    const fin = terminar(tx);
    try {
      for (const [tabla, items] of partes) await poner(tx, tabla, items);
    } catch (e) {
      tx.abort();
      await fin.catch(() => {});
      throw e;
    }
    await fin;
  }

  cerrar(): void {
    this.db.close();
  }
}
