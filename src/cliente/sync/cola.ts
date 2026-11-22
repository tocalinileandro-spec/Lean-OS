/**
 * Cola de cambios pendientes de subir y el decorador `AlmacenSincronizado`.
 *
 * La cola solo guarda (tabla, id): al subir se lee la versión actual de cada registro, así que anotar de más es
 * seguro (el servidor es idempotente por id) y anotar el mismo registro muchas veces cuesta una sola subida.
 */
import type { Almacen, Lote, OpcionesListar, Repositorio, RepositorioRepasos } from "../../compartido/almacen.ts";
import type { Apunte, Area, Id, Importacion, Meta, Registro, Repaso, Tabla, Tarea, Tarjeta } from "../../compartido/esquema.ts";

export interface CambioPendiente {
  tabla: Tabla;
  id: Id;
}

export interface EntradaCola extends CambioPendiente {
  /** Número de orden de la entrada (crece siempre). Sirve para quitar solo lo que ya se subió. */
  seq: number;
}

export interface ColaCambios {
  anotar(cambios: CambioPendiente[]): Promise<void>;
  /** Todas las entradas, en orden (puede haber repetidos del mismo registro). */
  entradas(): Promise<EntradaCola[]>;
  /** Quita exactamente esas entradas; las anotadas después (otro `seq`) quedan. */
  quitar(entradas: EntradaCola[]): Promise<void>;
}

/** Cantidad de registros distintos pendientes. */
export async function contarPendientes(cola: ColaCambios): Promise<number> {
  return new Set((await cola.entradas()).map((e) => `${e.tabla}|${e.id}`)).size;
}

/** Cola en memoria (pruebas). */
export class ColaMemoria implements ColaCambios {
  #datos: EntradaCola[] = [];
  #seq = 0;
  async anotar(cambios: CambioPendiente[]) {
    for (const c of cambios) this.#datos.push({ seq: ++this.#seq, tabla: c.tabla, id: c.id });
  }
  async entradas() {
    return structuredClone(this.#datos);
  }
  async quitar(entradas: EntradaCola[]) {
    const seqs = new Set(entradas.map((e) => e.seq));
    this.#datos = this.#datos.filter((e) => !seqs.has(e.seq));
  }
}

/** Exclusión mutua asíncrona: el motor aplica lo del servidor (leer, fusionar, escribir) sin que se cuele una edición local en el medio. */
export class Candado {
  #cola: Promise<void> = Promise.resolve();
  ejecutar<T>(f: () => Promise<T>): Promise<T> {
    const r = this.#cola.then(f, f);
    this.#cola = r.then(() => undefined, () => undefined);
    return r;
  }
}

export interface OpcionesSincronizado {
  /** Se comparte con el motor: las escrituras locales esperan a que termine de aplicar una página del servidor. */
  candado?: Candado;
  /** Se llama después de cada guardado (para que el motor programe una sincronización). */
  alCambiar?: () => void;
  /** Se llama si no se pudo anotar en la cola: el guardado igual se hizo, así que conviene una subida completa. */
  alFallarCola?: () => void;
}

type Anotador = (cambios: CambioPendiente[]) => Promise<void>;

/**
 * Anota antes y después de guardar. Antes: si la app se corta entre ambos pasos, el cambio queda anotado.
 * Después: si el motor leyó la cola en el medio, el cambio nuevo igual queda pendiente. Un fallo de la cola nunca
 * impide ni deshace el guardado.
 */
class RepoSincronizado<T extends Registro> implements Repositorio<T> {
  constructor(private interno: Repositorio<T>, private tabla: Tabla, private anotar: Anotador, private avisar: () => void, private bloq: <R>(f: () => Promise<R>) => Promise<R>) {}
  obtener(id: Id) {
    return this.interno.obtener(id);
  }
  listar(opciones?: OpcionesListar) {
    return this.interno.listar(opciones);
  }
  async guardar(item: T) {
    await this.guardarVarios([item]);
  }
  async guardarVarios(items: T[]) {
    const cambios = items.map((x) => ({ tabla: this.tabla, id: x.id }));
    await this.anotar(cambios);
    await this.bloq(() => this.interno.guardarVarios(items));
    await this.anotar(cambios);
    this.avisar();
  }
  /** La purga de la papelera es solo local: no se anota (el registro ya no existe para subirlo). */
  eliminarDefinitivo(ids: Id[]) {
    return this.interno.eliminarDefinitivo(ids);
  }
}

class RepasosSincronizado implements RepositorioRepasos {
  constructor(private interno: RepositorioRepasos, private anotar: Anotador, private avisar: () => void, private bloq: <R>(f: () => Promise<R>) => Promise<R>) {}
  async agregar(r: Repaso) {
    const cambios = [{ tabla: "repasos" as const, id: r.id }];
    await this.anotar(cambios);
    await this.bloq(() => this.interno.agregar(r));
    await this.anotar(cambios);
    this.avisar();
  }
  listar() {
    return this.interno.listar();
  }
  listarPorTarjeta(id: Id) {
    return this.interno.listarPorTarjeta(id);
  }
}

export class AlmacenSincronizado implements Almacen {
  tarjetas: Repositorio<Tarjeta>;
  areas: Repositorio<Area>;
  apuntes: Repositorio<Apunte>;
  importaciones: Repositorio<Importacion>;
  metas: Repositorio<Meta>;
  tareas: Repositorio<Tarea>;
  repasos: RepositorioRepasos;
  /** Cuántas veces falló la cola (para diagnóstico y pruebas). */
  fallosDeCola = 0;

  constructor(private interno: Almacen, cola: ColaCambios, private opciones: OpcionesSincronizado = {}) {
    const candado = this.opciones.candado ?? new Candado();
    const bloq = <T>(f: () => Promise<T>) => candado.ejecutar(f);
    const anotar: Anotador = async (cambios) => {
      try {
        await cola.anotar(cambios);
      } catch {
        this.fallosDeCola++;
        try {
          this.opciones.alFallarCola?.();
        } catch {
          /* nada: el guardado no se toca */
        }
      }
    };
    const avisar = () => this.#cambio();
    const envolver = <T extends Registro>(r: Repositorio<T>, tabla: Tabla) => new RepoSincronizado<T>(r, tabla, anotar, avisar, bloq);
    this.tarjetas = envolver(interno.tarjetas, "tarjetas");
    this.areas = envolver(interno.areas, "areas");
    this.apuntes = envolver(interno.apuntes, "apuntes");
    this.importaciones = envolver(interno.importaciones, "importaciones");
    this.metas = envolver(interno.metas, "metas");
    this.tareas = envolver(interno.tareas, "tareas");
    this.repasos = new RepasosSincronizado(interno.repasos, anotar, avisar, bloq);
    this.#anotar = anotar;
    this.#bloq = bloq;
  }

  #anotar: Anotador;
  #bloq: <R>(f: () => Promise<R>) => Promise<R>;

  #cambio(): void {
    try {
      this.opciones.alCambiar?.();
    } catch {
      /* nada */
    }
  }

  async guardarLote(lote: Lote) {
    const cambios: CambioPendiente[] = [];
    const partes: [Tabla, { id: Id }[] | undefined][] = [
      ["areas", lote.areas], ["tarjetas", lote.tarjetas], ["apuntes", lote.apuntes],
      ["importaciones", lote.importaciones], ["metas", lote.metas], ["tareas", lote.tareas],
    ];
    for (const [tabla, items] of partes) for (const x of items ?? []) cambios.push({ tabla, id: x.id });
    await this.#anotar(cambios);
    await this.#bloq(() => this.interno.guardarLote(lote));
    await this.#anotar(cambios);
    this.#cambio();
  }
}
