/**
 * Módulo 3: apuntes e ideas (sección 2 de la visión). Funciones sobre el Almacén.
 */
import type { Almacen } from "./almacen.ts";
import { TIPOS_APUNTE, type Apunte, type Id, type Tarea, type TipoApunte } from "./esquema.ts";
import { normalizar } from "./normalizar.ts";
import type { Reloj } from "./reloj.ts";
import { crearTarea } from "./tareas.ts";

const nuevoId = (): Id => crypto.randomUUID();
const LARGO_TITULO = 60;

/** Título para mostrar: el propio o, si falta, los primeros 60 caracteres del texto (una sola línea). */
export function tituloApunte(a: Pick<Apunte, "titulo" | "texto">): string {
  if (a.titulo !== null && a.titulo.trim()) return a.titulo;
  return a.texto.trim().replace(/\s+/g, " ").slice(0, LARGO_TITULO);
}

export interface DatosApunte {
  texto: string;
  titulo?: string | null;
  tipo?: TipoApunte;
  etiquetas?: string[];
  area_id?: Id | null;
}

function limpiarEtiquetas(e: string[]): string[] {
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const x of e) {
    const t = x.trim();
    const n = normalizar(t);
    if (!n || vistas.has(n)) continue;
    vistas.add(n);
    salida.push(t);
  }
  return salida;
}

async function validarAreaId(almacen: Almacen, id: Id | null | undefined): Promise<void> {
  if (!id) return;
  const a = await almacen.areas.obtener(id);
  if (!a || a.deleted_at !== null) throw new Error(`Área inexistente: ${id}`);
}

function validarTipo(t: string): void {
  if (!(TIPOS_APUNTE as readonly string[]).includes(t)) throw new Error(`Tipo de apunte inválido: ${t}`);
}

/** Captura rápida: alcanza con el texto (tipo "apunte", sin título, etiquetas ni área). */
export async function crearApunte(almacen: Almacen, reloj: Reloj, datos: DatosApunte): Promise<Apunte> {
  if (!datos.texto.trim()) throw new Error("El apunte no puede estar vacío");
  const tipo = datos.tipo ?? "apunte";
  validarTipo(tipo);
  await validarAreaId(almacen, datos.area_id);
  const ahora = reloj.ahora().toISOString();
  const a: Apunte = {
    id: nuevoId(), created_at: ahora, updated_at: ahora, deleted_at: null, rev: null,
    titulo: datos.titulo?.trim() ? datos.titulo.trim() : null, texto: datos.texto, tipo,
    etiquetas: limpiarEtiquetas(datos.etiquetas ?? []), area_id: datos.area_id ?? null, tema: null, importacion_id: null,
  };
  await almacen.apuntes.guardar(a);
  return a;
}

async function apunteVivo(almacen: Almacen, id: Id): Promise<Apunte> {
  const a = await almacen.apuntes.obtener(id);
  if (!a || a.deleted_at !== null) throw new Error(`Apunte inexistente: ${id}`);
  return a;
}

export async function editarApunte(almacen: Almacen, reloj: Reloj, id: Id, c: Partial<DatosApunte>): Promise<Apunte> {
  const a = await apunteVivo(almacen, id);
  const nuevo: Apunte = { ...a, updated_at: reloj.ahora().toISOString() };
  if (c.texto !== undefined) {
    if (!c.texto.trim()) throw new Error("El apunte no puede estar vacío");
    nuevo.texto = c.texto;
  }
  if (c.titulo !== undefined) nuevo.titulo = c.titulo?.trim() ? c.titulo.trim() : null;
  if (c.tipo !== undefined) {
    validarTipo(c.tipo);
    nuevo.tipo = c.tipo;
  }
  if (c.etiquetas !== undefined) nuevo.etiquetas = limpiarEtiquetas(c.etiquetas);
  if (c.area_id !== undefined) {
    await validarAreaId(almacen, c.area_id);
    nuevo.area_id = c.area_id;
  }
  await almacen.apuntes.guardar(nuevo);
  return nuevo;
}

// Borrar y restaurar apuntes: ver borrarApunte y restaurarApunte en gestion.ts.

export interface FiltrosApuntes {
  /** Texto libre: cada palabra debe aparecer (en título, texto o etiquetas). */
  texto?: string;
  tipo?: TipoApunte;
  etiqueta?: string;
  area_id?: Id;
}

/** Búsqueda sin tildes ni mayúsculas. Sin texto devuelve todo lo que cumpla los filtros. Más nuevos primero. */
export async function buscarApuntes(almacen: Almacen, filtros: FiltrosApuntes = {}): Promise<Apunte[]> {
  const palabras = normalizar(filtros.texto ?? "").split(" ").filter(Boolean);
  const etiqueta = filtros.etiqueta === undefined ? null : normalizar(filtros.etiqueta);
  const todos = await almacen.apuntes.listar();
  return todos
    .filter((a) => {
      if (filtros.tipo !== undefined && a.tipo !== filtros.tipo) return false;
      if (filtros.area_id !== undefined && a.area_id !== filtros.area_id) return false;
      if (etiqueta !== null && !a.etiquetas.some((e) => normalizar(e) === etiqueta)) return false;
      if (palabras.length === 0) return true;
      const pajar = normalizar([a.titulo ?? "", a.texto, ...a.etiquetas].join(" "));
      return palabras.every((p) => pajar.includes(p));
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/** Crea una tarea con el texto del apunte (título = título mostrado; nota = texto si difiere). El apunte no se toca. */
export async function convertirApunteATarea(almacen: Almacen, reloj: Reloj, id: Id): Promise<Tarea> {
  const a = await apunteVivo(almacen, id);
  const titulo = tituloApunte(a);
  const texto = a.texto.trim();
  return crearTarea(almacen, reloj, { titulo, nota: texto === titulo ? null : texto });
}

export interface BorradorTarjeta {
  pregunta: string;
  respuesta: string;
  pista: string | null;
  area_id: Id | null;
}

/** Borrador del formulario de tarjeta con el texto precargado (la pregunta, el título; la respuesta, el texto). No guarda nada. */
export async function convertirApunteATarjeta(almacen: Almacen, id: Id): Promise<BorradorTarjeta> {
  const a = await apunteVivo(almacen, id);
  return { pregunta: tituloApunte(a), respuesta: a.texto, pista: null, area_id: a.area_id };
}
