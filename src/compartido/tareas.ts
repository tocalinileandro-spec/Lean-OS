/**
 * Módulo 2: metas y tareas (sección 2 de la visión). Funciones sobre el Almacén; el reloj entra por dependencia.
 * Borrar manda a la papelera; borrar una meta desvincula sus tareas (meta_id null) y las trimestrales hijas (padre_id null).
 */
import type { Almacen } from "./almacen.ts";
import { diaLogico } from "./dia.ts";
import type { EstadoMeta, FechaISO, Id, Meta, Tarea, Trimestre } from "./esquema.ts";
import { construirCola } from "./repaso.ts";
import type { Reloj } from "./reloj.ts";

const nuevoId = (): Id => crypto.randomUUID();
const ahoraDe = (r: Reloj) => r.ahora().toISOString();
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function validarFecha(f: FechaISO | null | undefined): void {
  if (f !== null && f !== undefined && !FECHA.test(f)) throw new Error(`Fecha inválida (usá AAAA-MM-DD): ${f}`);
}
function validarTitulo(t: string): string {
  if (!t.trim()) throw new Error("El título no puede estar vacío");
  return t.trim();
}

// ---------- Metas ----------

export async function crearMetaAnual(almacen: Almacen, reloj: Reloj, datos: { anio: number; titulo: string }): Promise<Meta> {
  if (!Number.isInteger(datos.anio)) throw new Error("El año no es válido");
  const ahora = ahoraDe(reloj);
  const m: Meta = {
    id: nuevoId(), created_at: ahora, updated_at: ahora, deleted_at: null, rev: null,
    tipo: "anual", anio: datos.anio, trimestre: null, titulo: validarTitulo(datos.titulo), estado: "activa", padre_id: null,
  };
  await almacen.metas.guardar(m);
  return m;
}

export async function crearMetaTrimestral(
  almacen: Almacen, reloj: Reloj, datos: { anio: number; trimestre: Trimestre; titulo: string; padre_id?: Id | null },
): Promise<Meta> {
  if (!Number.isInteger(datos.anio)) throw new Error("El año no es válido");
  if (![1, 2, 3, 4].includes(datos.trimestre)) throw new Error("El trimestre debe ser 1, 2, 3 o 4");
  const padre = datos.padre_id ?? null;
  if (padre !== null) {
    const p = await almacen.metas.obtener(padre);
    if (!p || p.deleted_at !== null || p.tipo !== "anual") throw new Error(`Meta anual inexistente: ${padre}`);
  }
  const ahora = ahoraDe(reloj);
  const m: Meta = {
    id: nuevoId(), created_at: ahora, updated_at: ahora, deleted_at: null, rev: null,
    tipo: "trimestral", anio: datos.anio, trimestre: datos.trimestre, titulo: validarTitulo(datos.titulo), estado: "activa", padre_id: padre,
  };
  await almacen.metas.guardar(m);
  return m;
}

async function metaViva(almacen: Almacen, id: Id): Promise<Meta> {
  const m = await almacen.metas.obtener(id);
  if (!m || m.deleted_at !== null) throw new Error(`Meta inexistente: ${id}`);
  return m;
}

export async function editarMeta(almacen: Almacen, reloj: Reloj, id: Id, c: { titulo?: string; padre_id?: Id | null }): Promise<Meta> {
  const m = await metaViva(almacen, id);
  const nueva: Meta = { ...m, updated_at: ahoraDe(reloj) };
  if (c.titulo !== undefined) nueva.titulo = validarTitulo(c.titulo);
  if (c.padre_id !== undefined) {
    if (m.tipo === "anual" && c.padre_id !== null) throw new Error("Una meta anual no tiene padre");
    if (c.padre_id !== null) await metaViva(almacen, c.padre_id);
    nueva.padre_id = c.padre_id;
  }
  await almacen.metas.guardar(nueva);
  return nueva;
}

export async function cambiarEstadoMeta(almacen: Almacen, reloj: Reloj, id: Id, estado: EstadoMeta): Promise<Meta> {
  if (!["activa", "lograda", "descartada"].includes(estado)) throw new Error(`Estado de meta inválido: ${estado}`);
  const nueva = { ...(await metaViva(almacen, id)), estado, updated_at: ahoraDe(reloj) };
  await almacen.metas.guardar(nueva);
  return nueva;
}

/** Papelera. Las tareas quedan sin meta y las trimestrales hijas sin padre, todo en un solo lote. */
export async function borrarMeta(almacen: Almacen, reloj: Reloj, id: Id): Promise<Meta> {
  const m = await metaViva(almacen, id);
  const ahora = ahoraDe(reloj);
  const borrada: Meta = { ...m, deleted_at: ahora, updated_at: ahora };
  const tareas = (await almacen.tareas.listar()).filter((t) => t.meta_id === id).map((t) => ({ ...t, meta_id: null, updated_at: ahora }));
  const hijas = (await almacen.metas.listar()).filter((x) => x.padre_id === id).map((x) => ({ ...x, padre_id: null, updated_at: ahora }));
  await almacen.guardarLote({ metas: [borrada, ...hijas], tareas });
  return borrada;
}

export async function restaurarMeta(almacen: Almacen, reloj: Reloj, id: Id): Promise<Meta> {
  const m = await almacen.metas.obtener(id);
  if (!m || m.deleted_at === null) throw new Error(`La meta no está en la papelera: ${id}`);
  const nueva = { ...m, deleted_at: null, updated_at: ahoraDe(reloj) };
  await almacen.metas.guardar(nueva);
  return nueva;
}

export interface Progreso {
  hechas: number;
  total: number;
  /** 0 a 100, redondeado; sin tareas = 0. Solo informativo. */
  porcentaje: number;
}

/** Hechas sobre vinculadas. Una anual suma las tareas de sus trimestrales vivas además de las propias. */
export async function progresoMeta(almacen: Almacen, id: Id): Promise<Progreso> {
  const metas = await almacen.metas.listar();
  const ids = new Set<Id>([id, ...metas.filter((m) => m.padre_id === id).map((m) => m.id)]);
  const tareas = (await almacen.tareas.listar()).filter((t) => t.meta_id !== null && ids.has(t.meta_id));
  const hechas = tareas.filter((t) => t.estado === "hecha").length;
  return { hechas, total: tareas.length, porcentaje: tareas.length === 0 ? 0 : Math.round((hechas / tareas.length) * 100) };
}

// ---------- Tareas ----------

export interface DatosTarea {
  titulo: string;
  fecha?: FechaISO | null;
  meta_id?: Id | null;
  nota?: string | null;
}

export async function crearTarea(almacen: Almacen, reloj: Reloj, datos: DatosTarea): Promise<Tarea> {
  validarFecha(datos.fecha);
  if (datos.meta_id) await metaViva(almacen, datos.meta_id);
  const ahora = ahoraDe(reloj);
  const t: Tarea = {
    id: nuevoId(), created_at: ahora, updated_at: ahora, deleted_at: null, rev: null,
    titulo: validarTitulo(datos.titulo), fecha: datos.fecha ?? null, meta_id: datos.meta_id ?? null,
    nota: datos.nota ?? null, estado: "pendiente", hecha_en: null,
  };
  await almacen.tareas.guardar(t);
  return t;
}

/** Tarea rápida: solo título; la fecha queda en el día lógico de hoy. */
export const crearTareaRapida = (almacen: Almacen, reloj: Reloj, titulo: string) =>
  crearTarea(almacen, reloj, { titulo, fecha: diaLogico(reloj) });

async function tareaViva(almacen: Almacen, id: Id): Promise<Tarea> {
  const t = await almacen.tareas.obtener(id);
  if (!t || t.deleted_at !== null) throw new Error(`Tarea inexistente: ${id}`);
  return t;
}

export async function marcarHecha(almacen: Almacen, reloj: Reloj, id: Id): Promise<Tarea> {
  const t = await tareaViva(almacen, id);
  if (t.estado === "hecha") return t;
  const ahora = ahoraDe(reloj);
  const nueva: Tarea = { ...t, estado: "hecha", hecha_en: ahora, updated_at: ahora };
  await almacen.tareas.guardar(nueva);
  return nueva;
}

export async function desmarcarHecha(almacen: Almacen, reloj: Reloj, id: Id): Promise<Tarea> {
  const t = await tareaViva(almacen, id);
  const nueva: Tarea = { ...t, estado: "pendiente", hecha_en: null, updated_at: ahoraDe(reloj) };
  await almacen.tareas.guardar(nueva);
  return nueva;
}

export async function editarTarea(almacen: Almacen, reloj: Reloj, id: Id, c: Partial<DatosTarea>): Promise<Tarea> {
  const t = await tareaViva(almacen, id);
  const nueva: Tarea = { ...t, updated_at: ahoraDe(reloj) };
  if (c.titulo !== undefined) nueva.titulo = validarTitulo(c.titulo);
  if (c.fecha !== undefined) {
    validarFecha(c.fecha);
    nueva.fecha = c.fecha;
  }
  if (c.meta_id !== undefined) {
    if (c.meta_id !== null) await metaViva(almacen, c.meta_id);
    nueva.meta_id = c.meta_id;
  }
  if (c.nota !== undefined) nueva.nota = c.nota;
  await almacen.tareas.guardar(nueva);
  return nueva;
}

export async function borrarTarea(almacen: Almacen, reloj: Reloj, id: Id): Promise<Tarea> {
  const t = await tareaViva(almacen, id);
  const ahora = ahoraDe(reloj);
  const nueva = { ...t, deleted_at: ahora, updated_at: ahora };
  await almacen.tareas.guardar(nueva);
  return nueva;
}

export async function restaurarTarea(almacen: Almacen, reloj: Reloj, id: Id): Promise<Tarea> {
  const t = await almacen.tareas.obtener(id);
  if (!t || t.deleted_at === null) throw new Error(`La tarea no está en la papelera: ${id}`);
  const nueva = { ...t, deleted_at: null, updated_at: ahoraDe(reloj) };
  await almacen.tareas.guardar(nueva);
  return nueva;
}

// ---------- Hoy y Bandeja ----------

export interface TareasDeHoy {
  /** Pendientes con fecha anterior a hoy, la más vieja primero. */
  atrasadas: Tarea[];
  /** Con fecha de hoy (pendientes y hechas hoy, para poder desmarcar), en orden de creación. */
  hoy: Tarea[];
  /** Tarjetas a repasar hoy (cola del día). */
  tarjetasARepasar: number;
}

export async function tareasDeHoy(almacen: Almacen, reloj: Reloj, opciones: { limiteNuevas?: number } = {}): Promise<TareasDeHoy> {
  const hoy = diaLogico(reloj);
  const tareas = await almacen.tareas.listar();
  const atrasadas = tareas
    .filter((t) => t.estado === "pendiente" && t.fecha !== null && t.fecha < hoy)
    .sort((a, b) => (a.fecha! < b.fecha! ? -1 : a.fecha! > b.fecha! ? 1 : 0));
  return {
    atrasadas,
    hoy: tareas.filter((t) => t.fecha === hoy),
    tarjetasARepasar: (await construirCola(almacen, reloj, opciones)).length,
  };
}

/** Bandeja: tareas pendientes sin fecha. */
export async function bandeja(almacen: Almacen): Promise<Tarea[]> {
  return (await almacen.tareas.listar()).filter((t) => t.estado === "pendiente" && t.fecha === null);
}
