/**
 * Lógica de pantalla de los módulos 2 y 3 (tareas, metas, apuntes, papelera): sin DOM, para poder probarla.
 */
import { restaurarArea, restaurarTema } from "../../compartido/areas.ts";
import { listarPapelera, restaurarApunte, restaurarTarjeta } from "../../compartido/gestion.ts";
import { tituloApunte, buscarApuntes, type FiltrosApuntes } from "../../compartido/apuntes.ts";
import type { Apunte, EstadoMeta, Id, Meta, Tarea } from "../../compartido/esquema.ts";
import { normalizar } from "../../compartido/normalizar.ts";
import { bandeja, progresoMeta, restaurarMeta, restaurarTarea, type Progreso } from "../../compartido/tareas.ts";
import { opcionesDeArea, type Dependencias } from "./logica.ts";

export const ESTADOS_META: { id: EstadoMeta; nombre: string }[] = [
  { id: "activa", nombre: "Activa" }, { id: "lograda", nombre: "Lograda" }, { id: "descartada", nombre: "Descartada" },
];

export function etiquetaMeta(m: Pick<Meta, "tipo" | "anio" | "trimestre" | "titulo">): string {
  return m.tipo === "anual" ? `${m.anio} · ${m.titulo}` : `${m.anio} T${m.trimestre} · ${m.titulo}`;
}

export function textoProgreso(p: Progreso): string {
  if (p.total === 0) return "Sin tareas vinculadas";
  return `${p.hechas} de ${p.total} ${p.total === 1 ? "tarea hecha" : "tareas hechas"} (${p.porcentaje} %)`;
}

/** "ideas, trabajo" -> ["ideas", "trabajo"]. */
export function separarEtiquetas(texto: string): string[] {
  return texto.split(",").map((e) => e.trim()).filter(Boolean);
}

// ---------- Tareas y metas ----------

export interface MetaConProgreso {
  meta: Meta;
  etiqueta: string;
  progreso: Progreso;
}

export interface VistaTareas {
  bandeja: Tarea[];
  /** Pendientes con fecha, la más próxima primero. */
  conFecha: Tarea[];
  hechas: Tarea[];
  metas: MetaConProgreso[];
}

export async function vistaTareas(d: Dependencias): Promise<VistaTareas> {
  const todas = await d.almacen.tareas.listar();
  const metas = (await d.almacen.metas.listar()).sort((a, b) => b.anio - a.anio || (a.trimestre ?? 0) - (b.trimestre ?? 0) || (a.tipo === "anual" ? -1 : 1));
  return {
    bandeja: await bandeja(d.almacen),
    conFecha: todas.filter((t) => t.estado === "pendiente" && t.fecha !== null).sort((a, b) => (a.fecha! < b.fecha! ? -1 : a.fecha! > b.fecha! ? 1 : 0)),
    hechas: todas.filter((t) => t.estado === "hecha").sort((a, b) => ((a.hecha_en ?? "") < (b.hecha_en ?? "") ? 1 : -1)).slice(0, 20),
    metas: await Promise.all(metas.map(async (meta) => ({ meta, etiqueta: etiquetaMeta(meta), progreso: await progresoMeta(d.almacen, meta.id) }))),
  };
}

// ---------- Apuntes ----------

export interface VistaApuntes {
  apuntes: Apunte[];
  etiquetas: string[];
  areas: { id: Id; nombre: string }[];
}

export async function vistaApuntes(d: Dependencias, filtros: FiltrosApuntes): Promise<VistaApuntes> {
  const todos = await d.almacen.apuntes.listar();
  const vistas = new Map<string, string>();
  for (const a of todos) for (const e of a.etiquetas) if (!vistas.has(normalizar(e))) vistas.set(normalizar(e), e);
  return {
    apuntes: await buscarApuntes(d.almacen, filtros),
    etiquetas: [...vistas.values()].sort((x, y) => x.localeCompare(y, "es")),
    areas: await opcionesDeArea(d.almacen),
  };
}

// ---------- Papelera ----------

export type TipoPapelera = "tarjeta" | "tarea" | "meta" | "apunte" | "tema" | "area";

export interface ItemPapelera {
  tipo: TipoPapelera;
  id: Id;
  titulo: string;
  borrado: string;
  /** Solo en temas y áreas: qué lleva el conjunto, por ejemplo "2 subáreas, 3 temas, 40 tarjetas". */
  detalle?: string;
}

const NOMBRE_TIPO: Record<TipoPapelera, string> = { tarjeta: "Tarjeta", tarea: "Tarea", meta: "Meta", apunte: "Apunte", tema: "Tema", area: "Área" };
export const nombreTipoPapelera = (t: TipoPapelera) => NOMBRE_TIPO[t];

/** Todo lo borrado (tarjetas, tareas, metas y apuntes), lo más reciente primero. */
export async function itemsPapelera(d: Dependencias): Promise<ItemPapelera[]> {
  const p = await listarPapelera(d.almacen);
  const items: ItemPapelera[] = [
    ...p.conjuntos.map((c) => ({
      tipo: c.tipo, id: c.id, titulo: c.titulo, borrado: c.borrado,
      detalle: [c.subareas > 0 ? `${c.subareas} ${c.subareas === 1 ? "subárea" : "subáreas"}` : "", c.tipo === "area" ? `${c.temas} ${c.temas === 1 ? "tema" : "temas"}` : "", `${c.tarjetas} ${c.tarjetas === 1 ? "tarjeta" : "tarjetas"}`].filter(Boolean).join(", "),
    })),
    ...p.tarjetas.map((x) => ({ tipo: "tarjeta" as const, id: x.id, titulo: x.pregunta, borrado: x.deleted_at! })),
    ...p.tareas.map((x) => ({ tipo: "tarea" as const, id: x.id, titulo: x.titulo, borrado: x.deleted_at! })),
    ...p.metas.map((x) => ({ tipo: "meta" as const, id: x.id, titulo: etiquetaMeta(x), borrado: x.deleted_at! })),
    ...p.apuntes.map((x) => ({ tipo: "apunte" as const, id: x.id, titulo: tituloApunte(x), borrado: x.deleted_at! })),
  ];
  return items.sort((a, b) => (a.borrado < b.borrado ? 1 : a.borrado > b.borrado ? -1 : 0));
}

export async function restaurarItem(d: Dependencias, tipo: TipoPapelera, id: Id): Promise<string> {
  if (tipo === "tema") { await restaurarTema(d.almacen, d.reloj, id); return "Tema restaurado con sus tarjetas y su resumen."; }
  if (tipo === "area") { await restaurarArea(d.almacen, d.reloj, id); return "Área restaurada con todo lo que se borró junto con ella."; }
  if (tipo === "tarjeta") await restaurarTarjeta(d.almacen, d.reloj, id);
  else if (tipo === "tarea") await restaurarTarea(d.almacen, d.reloj, id);
  else if (tipo === "meta") await restaurarMeta(d.almacen, d.reloj, id);
  else await restaurarApunte(d.almacen, d.reloj, id);
  return `${NOMBRE_TIPO[tipo]} restaurad${tipo === "apunte" ? "o" : "a"}.`;
}
