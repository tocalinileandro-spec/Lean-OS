/**
 * Gestión de tarjetas (módulo 1) y papelera (sección 2/5 de la visión). Funciones sobre el Almacén.
 * Toda edición de contenido (incluye área, suspendida y borrado) actualiza `updated_at` y
 * `contenido_updated_at`; el estado de repaso no se toca acá.
 */
import type { Almacen } from "./almacen.ts";
import { DIAS_PAPELERA, type Apunte, type Id, type Tarjeta } from "./esquema.ts";
import type { Reloj } from "./reloj.ts";

export interface CambiosTarjeta {
  pregunta?: string;
  respuesta?: string;
  pista?: string | null;
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
}

/** Lo borrado y todavía no purgado. (Tareas y metas se suman en la fase 3.) */
export async function listarPapelera(almacen: Almacen): Promise<Papelera> {
  const borrado = <T extends { deleted_at: string | null }>(x: T) => x.deleted_at !== null;
  return {
    tarjetas: (await almacen.tarjetas.listar({ incluirBorrados: true })).filter(borrado),
    apuntes: (await almacen.apuntes.listar({ incluirBorrados: true })).filter(borrado),
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
  for (const repo of [almacen.tarjetas, almacen.apuntes, almacen.importaciones]) {
    const ids = (await repo.listar({ incluirBorrados: true })).filter(vencido).map((x) => x.id);
    await repo.eliminarDefinitivo(ids);
    total += ids.length;
  }
  return total;
}
