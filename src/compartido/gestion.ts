/**
 * Gestión de tarjetas (módulo 1) y papelera (sección 2/5 de la visión). Funciones sobre el Almacén.
 * Toda edición de contenido (incluye área, suspendida y borrado) actualiza `updated_at` y
 * `contenido_updated_at`; el estado de repaso no se toca acá.
 */
import type { Almacen } from "./almacen.ts";
import { diaLogico } from "./dia.ts";
import { DIAS_PAPELERA, EASE_INICIAL, type Apunte, type Id, type Meta, type Tarea, type Tarjeta } from "./esquema.ts";
import { resolverArea } from "./importacion/importar.ts";
import { partirArea } from "./normalizar.ts";
import type { Reloj } from "./reloj.ts";

export interface CambiosTarjeta {
  pregunta?: string;
  respuesta?: string;
  pista?: string | null;
}

export interface DatosTarjeta {
  pregunta: string;
  respuesta: string;
  pista?: string | null;
  /** Área existente... */
  area_id?: Id | null;
  /** ...o texto "Área > Subárea" (si viene, tiene prioridad; se une con el área existente). */
  area_texto?: string | null;
}

/** Crea una tarjeta a mano (por ejemplo, convertida desde un apunte). Nueva: ease 2,5, vence hoy. */
export async function crearTarjeta(almacen: Almacen, reloj: Reloj, datos: DatosTarjeta): Promise<Tarjeta> {
  if (!datos.pregunta.trim()) throw new Error("La pregunta no puede quedar vacía");
  if (!datos.respuesta.trim()) throw new Error("La respuesta no puede quedar vacía");
  const ahora = reloj.ahora().toISOString();
  let areaId: Id | null = datos.area_id ?? null;
  if (datos.area_texto?.trim()) {
    const escrita = partirArea(datos.area_texto);
    if (typeof escrita === "string") throw new Error("El área no puede quedar vacía: escribila como Área o Área > Subárea");
    const raiz = await resolverArea(almacen, escrita.area, null, ahora);
    areaId = (escrita.subarea ? await resolverArea(almacen, escrita.subarea, raiz.id, ahora) : raiz).id;
  }
  if (!areaId) throw new Error("El área no puede quedar vacía: elegí una o escribí una nueva");
  const area = await almacen.areas.obtener(areaId);
  if (!area || area.deleted_at !== null) throw new Error(`Área inexistente: ${areaId}`);
  const t: Tarjeta = {
    id: crypto.randomUUID(), created_at: ahora, updated_at: ahora, deleted_at: null, rev: null,
    area_id: areaId, pregunta: datos.pregunta, respuesta: datos.respuesta, pista: datos.pista?.trim() ? datos.pista.trim() : null,
    suspendida: false, importacion_id: null, ease: EASE_INICIAL, intervalo: 0, reps: 0, lapses: 0, vence: diaLogico(reloj),
    contenido_updated_at: ahora, repaso_updated_at: ahora,
  };
  await almacen.tarjetas.guardar(t);
  return t;
}

async function tarjetaViva(almacen: Almacen, id: Id): Promise<Tarjeta> {
  const t = await almacen.tarjetas.obtener(id);
  if (!t || t.deleted_at !== null) throw new Error(`Tarjeta inexistente: ${id}`);
  return t;
}

async function cambiar(almacen: Almacen, reloj: Reloj, id: Id, cambios: Partial<Tarjeta>): Promise<Tarjeta> {
  const ahora = reloj.ahora().toISOString();
  const t: Tarjeta = { ...(await tarjetaViva(almacen, id)), ...cambios, updated_at: ahora, contenido_updated_at: ahora };
  await almacen.tarjetas.guardar(t);
  return t;
}

export async function editarTarjeta(almacen: Almacen, reloj: Reloj, id: Id, c: CambiosTarjeta): Promise<Tarjeta> {
  const cambios: Partial<Tarjeta> = {};
  if (c.pregunta !== undefined) {
    if (!c.pregunta.trim()) throw new Error("La pregunta no puede quedar vacía");
    cambios.pregunta = c.pregunta;
  }
  if (c.respuesta !== undefined) {
    if (!c.respuesta.trim()) throw new Error("La respuesta no puede quedar vacía");
    cambios.respuesta = c.respuesta;
  }
  if (c.pista !== undefined) cambios.pista = c.pista;
  return cambiar(almacen, reloj, id, cambios);
}

export async function moverTarjetaDeArea(almacen: Almacen, reloj: Reloj, id: Id, areaId: Id): Promise<Tarjeta> {
  const area = await almacen.areas.obtener(areaId);
  if (!area || area.deleted_at !== null) throw new Error(`Área inexistente: ${areaId}`);
  return cambiar(almacen, reloj, id, { area_id: areaId });
}

export const suspenderTarjeta = (a: Almacen, r: Reloj, id: Id) => cambiar(a, r, id, { suspendida: true });
export const reanudarTarjeta = (a: Almacen, r: Reloj, id: Id) => cambiar(a, r, id, { suspendida: false });

/** Borrado lógico: va a la papelera. Los repasos no se tocan. */
export const borrarTarjeta = (a: Almacen, r: Reloj, id: Id) => cambiar(a, r, id, { deleted_at: r.ahora().toISOString() });

export async function borrarApunte(almacen: Almacen, reloj: Reloj, id: Id): Promise<Apunte> {
  const ap = await almacen.apuntes.obtener(id);
  if (!ap || ap.deleted_at !== null) throw new Error(`Apunte inexistente: ${id}`);
  const ahora = reloj.ahora().toISOString();
  const nuevo = { ...ap, deleted_at: ahora, updated_at: ahora };
  await almacen.apuntes.guardar(nuevo);
  return nuevo;
}

export interface Papelera {
  tarjetas: Tarjeta[];
  apuntes: Apunte[];
  metas: Meta[];
  tareas: Tarea[];
}

/** Lo borrado y todavía no purgado. */
export async function listarPapelera(almacen: Almacen): Promise<Papelera> {
  const borrado = <T extends { deleted_at: string | null }>(x: T) => x.deleted_at !== null;
  return {
    tarjetas: (await almacen.tarjetas.listar({ incluirBorrados: true })).filter(borrado),
    apuntes: (await almacen.apuntes.listar({ incluirBorrados: true })).filter(borrado),
    metas: (await almacen.metas.listar({ incluirBorrados: true })).filter(borrado),
    tareas: (await almacen.tareas.listar({ incluirBorrados: true })).filter(borrado),
  };
}

export async function restaurarTarjeta(almacen: Almacen, reloj: Reloj, id: Id): Promise<Tarjeta> {
  const t = await almacen.tarjetas.obtener(id);
  if (!t || t.deleted_at === null) throw new Error(`La tarjeta no está en la papelera: ${id}`);
  const ahora = reloj.ahora().toISOString();
  const nueva = { ...t, deleted_at: null, updated_at: ahora, contenido_updated_at: ahora };
  await almacen.tarjetas.guardar(nueva);
  return nueva;
}

export async function restaurarApunte(almacen: Almacen, reloj: Reloj, id: Id): Promise<Apunte> {
  const ap = await almacen.apuntes.obtener(id);
  if (!ap || ap.deleted_at === null) throw new Error(`El apunte no está en la papelera: ${id}`);
  const nuevo = { ...ap, deleted_at: null, updated_at: reloj.ahora().toISOString() };
  await almacen.apuntes.guardar(nuevo);
  return nuevo;
}

/**
 * Elimina para siempre lo que lleva 30 días o más en la papelera. Los repasos se conservan
 * (el historial no se pierde). Devuelve cuántos registros se purgaron.
 */
export async function purgarPapelera(almacen: Almacen, reloj: Reloj): Promise<number> {
  const limite = reloj.ahora().getTime() - DIAS_PAPELERA * 86_400_000;
  const vencido = (x: { deleted_at: string | null }) => x.deleted_at !== null && new Date(x.deleted_at).getTime() <= limite;
  let total = 0;
  for (const repo of [almacen.tarjetas, almacen.apuntes, almacen.importaciones, almacen.metas, almacen.tareas]) {
    const ids = (await repo.listar({ incluirBorrados: true })).filter(vencido).map((x) => x.id);
    await repo.eliminarDefinitivo(ids);
    total += ids.length;
  }
  return total;
}
