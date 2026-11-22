/**
 * Almacén (repositorio) asíncrono. Cada método es una operación atómica (una transacción en
 * IndexedDB), así que la implementación real es directa. La de memoria sirve para pruebas.
 */
import type { Apunte, Area, Id, Importacion, Registro, Repaso, Tarjeta } from "./esquema.ts";

export interface OpcionesListar {
  /** Por defecto los borrados (papelera) no se devuelven. */
  incluirBorrados?: boolean;
}

export interface Repositorio<T extends Registro> {
  obtener(id: Id): Promise<T | undefined>;
  /** En orden de inserción. */
  listar(opciones?: OpcionesListar): Promise<T[]>;
  /** Inserta o reemplaza por id. */
  guardar(item: T): Promise<void>;
  /** Inserta o reemplaza varios en una sola transacción (todo o nada). */
  guardarVarios(items: T[]): Promise<void>;
  /** Elimina para siempre (solo la purga de la papelera). Ids inexistentes se ignoran. */
  eliminarDefinitivo(ids: Id[]): Promise<void>;
}

/** Los repasos solo se agregan (registro que no se edita ni se borra). */
export interface RepositorioRepasos {
  agregar(repaso: Repaso): Promise<void>;
  listar(): Promise<Repaso[]>;
  listarPorTarjeta(tarjetaId: Id): Promise<Repaso[]>;
}

/** Registros que se guardan juntos, todo o nada (operaciones multi-tabla). */
export interface Lote {
  areas?: Area[];
  tarjetas?: Tarjeta[];
  apuntes?: Apunte[];
  importaciones?: Importacion[];
}

export interface Almacen {
  tarjetas: Repositorio<Tarjeta>;
  areas: Repositorio<Area>;
  apuntes: Repositorio<Apunte>;
  importaciones: Repositorio<Importacion>;
  repasos: RepositorioRepasos;
  /** Guarda varias tablas en una sola transacción (todo o nada). */
  guardarLote(lote: Lote): Promise<void>;
}

class RepoMemoria<T extends Registro> implements Repositorio<T> {
  protected datos = new Map<Id, T>();
  async obtener(id: Id) {
    const x = this.datos.get(id);
    return x ? structuredClone(x) : undefined;
  }
  async listar(opciones: OpcionesListar = {}) {
    const todos = [...this.datos.values()];
    return structuredClone(opciones.incluirBorrados ? todos : todos.filter((x) => x.deleted_at === null));
  }
  async guardar(item: T) {
    this.datos.set(item.id, structuredClone(item));
  }
  async guardarVarios(items: T[]) {
    const copia = structuredClone(items);
    for (const x of copia) this.datos.set(x.id, x);
  }
  async eliminarDefinitivo(ids: Id[]) {
    for (const id of ids) this.datos.delete(id);
  }
}

class RepasosMemoria implements RepositorioRepasos {
  #datos: Repaso[] = [];
  async agregar(r: Repaso) {
    if (this.#datos.some((x) => x.id === r.id)) return; // idempotente por id
    this.#datos.push(structuredClone(r));
  }
  async listar() {
    return structuredClone(this.#datos);
  }
  async listarPorTarjeta(id: Id) {
    return structuredClone(this.#datos.filter((r) => r.tarjeta_id === id));
  }
}

export class AlmacenMemoria implements Almacen {
  tarjetas = new RepoMemoria<Tarjeta>();
  areas = new RepoMemoria<Area>();
  apuntes = new RepoMemoria<Apunte>();
  importaciones = new RepoMemoria<Importacion>();
  repasos = new RepasosMemoria();
  /** Síncrono por dentro (sin esperas entre tablas), así que es atómico. */
  async guardarLote(lote: Lote) {
    await Promise.all([
      this.areas.guardarVarios(lote.areas ?? []),
      this.tarjetas.guardarVarios(lote.tarjetas ?? []),
      this.apuntes.guardarVarios(lote.apuntes ?? []),
      this.importaciones.guardarVarios(lote.importaciones ?? []),
    ]);
  }
}
