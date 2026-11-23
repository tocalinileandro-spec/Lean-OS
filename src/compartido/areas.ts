/**
 * Áreas, temas y su gestión (etapa 7, módulo 1). Lógica pura sobre el Almacén, sin DOM.
 * Un TEMA es una importación viva + su apunte de aprendizaje ligado + sus tarjetas (por `importacion_id`).
 * Sin cambios de esquema: todo se resuelve con los campos que ya existen.
 */
import type { Almacen } from "./almacen.ts";
import { diaLogico } from "./dia.ts";
import type { Apunte, Area, Id, Importacion, Tarjeta } from "./esquema.ts";
import { normalizar } from "./normalizar.ts";
import { construirCola, esNueva, type OpcionesCola } from "./repaso.ts";
import type { Reloj } from "./reloj.ts";

export const LARGO_MAXIMO_AREA = 60;
/** Intervalo (días) desde el que una tarjeta cuenta como dominada. */
export const INTERVALO_DOMINADA = 21;

const vivo = (x: { deleted_at: string | null }) => x.deleted_at === null;

// ---------- Crear áreas ----------

export interface ResultadoCrearArea {
  area: Area;
  /** false si ya existía (no se duplicó). */
  creada: boolean;
  /** Mensaje en castellano cuando ya existía. */
  aviso: string | null;
}

/** Crea un área (o una subárea si viene `padreId`). Vacío, largo o padre inválido lanzan un error en castellano. */
export async function crearArea(almacen: Almacen, reloj: Reloj, nombre: string, padreId: Id | null = null): Promise<ResultadoCrearArea> {
  const limpio = nombre.trim().replace(/\s+/g, " ");
  const esSub = padreId !== null;
  const que = esSub ? "subárea" : "área";
  const del = esSub ? "de la subárea" : "del área";
  const norm = normalizar(limpio);
  if (norm === "") throw new Error(`El nombre ${del} no puede quedar vacío.`);
  if (limpio.includes(">")) throw new Error(`El nombre ${del} no puede llevar “>”: las subáreas se crean desde su área.`);
  if ([...limpio].length > LARGO_MAXIMO_AREA) throw new Error(`El nombre ${del} es demasiado largo: máximo ${LARGO_MAXIMO_AREA} letras.`);
  if (padreId !== null) {
    const padre = await almacen.areas.obtener(padreId);
    if (!padre || !vivo(padre)) throw new Error("El área elegida no existe (o está en la papelera).");
    if (padre.padre_id !== null) throw new Error("Una subárea no puede tener subáreas: solo hay dos niveles (Área > Subárea).");
  }
  const existente = (await almacen.areas.listar()).find((a) => a.nombre_normalizado === norm && a.padre_id === padreId);
  if (existente) {
    return {
      area: existente, creada: false,
      aviso: esSub ? `Ya existe la subárea “${existente.nombre}” en esa área.` : `Ya existe el área “${existente.nombre}”.`,
    };
  }
  const ahora = reloj.ahora().toISOString();
  const area: Area = { id: crypto.randomUUID(), created_at: ahora, updated_at: ahora, deleted_at: null, rev: null, nombre: limpio, nombre_normalizado: norm, padre_id: padreId };
  await almacen.areas.guardar(area);
  return { area, creada: true, aviso: null };
}

// ---------- Utilidades de estructura ----------

interface Estructura {
  /** Todas las áreas (también borradas), por id. */
  porId: Map<Id, Area>;
  /** Raíz (primer nivel) de cada área, por id. */
  raizDe: (id: Id) => Id;
}

async function estructura(almacen: Almacen): Promise<Estructura> {
  const porId = new Map((await almacen.areas.listar({ incluirBorrados: true })).map((a) => [a.id, a]));
  return { porId, raizDe: (id) => porId.get(id)?.padre_id ?? id };
}

/** Ids del área y de sus subáreas vivas. */
function idsConSubareas(vivas: Area[], areaId: Id): Set<Id> {
  return new Set([areaId, ...vivas.filter((a) => a.padre_id === areaId).map((a) => a.id)]);
}

const porNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre, "es");

// ---------- Resumen de áreas (pantalla Áreas) ----------

export interface ResumenArea {
  id: Id;
  nombre: string;
  inicial: string;
  /** Nombres de las subáreas vivas. */
  subareas: string[];
  /** Tarjetas vivas del área y sus subáreas (las suspendidas cuentan). */
  tarjetas: number;
  /** Temas (importaciones vivas) del área y sus subáreas. */
  temas: number;
  /** Tarjetas de la cola del día que caen en el área o sus subáreas. */
  paraHoy: number;
  /** % de activas (no suspendidas) con intervalo de 21 días o más; 0 sin tarjetas. */
  dominio: number;
}

export interface ResumenDeAreas {
  areas: ResumenArea[];
  /** Largo de la cola del día: es la suma de `paraHoy` de las áreas. */
  totalParaHoy: number;
}

/** Porcentaje entero, mitad hacia arriba. 0 si no hay activas. */
export function porcentajeDominio(activas: Tarjeta[]): number {
  if (activas.length === 0) return 0;
  const dominadas = activas.filter((t) => t.intervalo >= INTERVALO_DOMINADA).length;
  return Math.floor((200 * dominadas + activas.length) / (2 * activas.length));
}

export async function resumenAreas(almacen: Almacen, reloj: Reloj, opciones: OpcionesCola = {}): Promise<ResumenDeAreas> {
  const cola = await construirCola(almacen, reloj, opciones);
  const { raizDe } = await estructura(almacen);
  const vivas = (await almacen.areas.listar()).sort(porNombre);
  const tarjetas = await almacen.tarjetas.listar();
  const importaciones = await almacen.importaciones.listar();
  const areas: ResumenArea[] = vivas.filter((a) => a.padre_id === null).map((a) => {
    const subs = vivas.filter((s) => s.padre_id === a.id);
    const ids = new Set([a.id, ...subs.map((s) => s.id)]);
    const propias = tarjetas.filter((t) => ids.has(t.area_id));
    return {
      id: a.id, nombre: a.nombre, inicial: ([...a.nombre.trim()][0] ?? "?").toUpperCase(),
      subareas: subs.map((s) => s.nombre),
      tarjetas: propias.length,
      temas: importaciones.filter((i) => ids.has(i.area_id)).length,
      paraHoy: cola.filter((t) => raizDe(t.area_id) === a.id).length,
      dominio: porcentajeDominio(propias.filter((t) => !t.suspendida)),
    };
  });
  return { areas, totalParaHoy: cola.length };
}

// ---------- Contadores y filtro del Repaso (parte lógica de P4) ----------

export interface ContadorArea {
  id: Id;
  nombre: string;
  paraHoy: number;
  subareas: { id: Id; nombre: string; paraHoy: number }[];
}

export interface ContadoresDeRepaso {
  /** “Todo lo de hoy” = largo de la cola global. */
  todo: number;
  areas: ContadorArea[];
}

/** Filtra una cola ya construida: el área incluye sus subáreas; la subárea solo la suya. */
export async function filtrarColaPorArea(almacen: Almacen, cola: Tarjeta[], areaId: Id | null | undefined): Promise<Tarjeta[]> {
  if (!areaId) return cola;
  const ids = idsConSubareas(await almacen.areas.listar(), areaId);
  return cola.filter((t) => ids.has(t.area_id));
}

/** Cola del día (con el tope de nuevas aplicado antes del filtro, así los contadores suman). */
export async function colaDeRepaso(almacen: Almacen, reloj: Reloj, opciones: OpcionesCola & { areaId?: Id | null } = {}): Promise<Tarjeta[]> {
  const { areaId, ...paraCola } = opciones;
  return filtrarColaPorArea(almacen, await construirCola(almacen, reloj, paraCola), areaId);
}

export async function contadoresDeRepaso(almacen: Almacen, reloj: Reloj, opciones: OpcionesCola = {}): Promise<ContadoresDeRepaso> {
  const cola = await construirCola(almacen, reloj, opciones);
  const vivas = (await almacen.areas.listar()).sort(porNombre);
  const cuenta = (id: Id) => cola.filter((t) => t.area_id === id).length;
  const areas = vivas.filter((a) => a.padre_id === null).map((a) => {
    const subareas = vivas.filter((s) => s.padre_id === a.id).map((s) => ({ id: s.id, nombre: s.nombre, paraHoy: cuenta(s.id) }));
    return { id: a.id, nombre: a.nombre, subareas, paraHoy: cuenta(a.id) + subareas.reduce((n, s) => n + s.paraHoy, 0) };
  });
  return { todo: cola.length, areas };
}

/** Suma días a una fecha AAAA-MM-DD (calendario UTC puro). */
function masDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * Fecha en que vuelve a tocar repasar algo dentro del filtro (el área incluye sus subáreas), para el estado vacío del Repaso.
 * Mira las tarjetas activas (vivas y no suspendidas): si alguna toca hoy devuelve hoy; si no, el menor vencimiento futuro.
 * Las tarjetas nuevas que quedaron fuera del tope diario cuentan como "mañana". Sin tarjetas activas devuelve null.
 */
export async function proximaFechaDeRepaso(almacen: Almacen, reloj: Reloj, opciones: OpcionesCola & { areaId?: Id | null } = {}): Promise<string | null> {
  const { areaId } = opciones;
  const hoy = diaLogico(reloj);
  const ids = areaId ? idsConSubareas(await almacen.areas.listar(), areaId) : null;
  const activas = (await almacen.tarjetas.listar()).filter((t) => !t.suspendida && (!ids || ids.has(t.area_id)));
  if (activas.length === 0) return null;
  if ((await colaDeRepaso(almacen, reloj, opciones)).length > 0) return hoy;
  const futuras = activas.filter((t) => t.vence > hoy).map((t) => t.vence).sort();
  const sobrantes = activas.some((t) => t.vence <= hoy);
  const manana = masDias(hoy, 1);
  const candidatas = [...futuras.slice(0, 1), ...(sobrantes ? [manana] : [])].sort();
  return candidatas[0] ?? null;
}

// ---------- Detalle de área ----------

export type EstadoTema = "hoy" | "nuevo" | "al_dia";

export interface TemaDeArea {
  /** Id de la importación. */
  id: Id;
  nombre: string;
  /** Tarjetas vivas del tema. */
  tarjetas: number;
  paraHoy: number;
  /**
   * "hoy": alguna tarjeta del tema está en la cola de hoy (texto “N hoy”);
   * "nuevo": ninguna toca hoy y todas las activas son nuevas (nunca repasadas); “Nuevo”;
   * "al_dia": todo lo demás (incluye temas sin tarjetas activas); “Al día”.
   */
  estado: EstadoTema;
  estadoTexto: string;
  apunteId: Id | null;
  /** Texto del resumen (apunte de aprendizaje ligado); null si no hay o está vacío. */
  resumen: string | null;
}

export interface GrupoDeTemas {
  /** Id del área o subárea a la que pertenecen estos temas. */
  areaId: Id;
  nombre: string;
  temas: TemaDeArea[];
  /** Tarjetas vivas del área que no pertenecen a un tema vivo (“Tarjetas sueltas”). */
  tarjetasSueltas: number;
  /** Total de tarjetas vivas del grupo (temas + sueltas). */
  tarjetas: number;
  paraHoy: number;
}

export interface DetalleArea {
  id: Id;
  /** Título con el camino: “Área” o “Área › Subárea”. */
  titulo: string;
  nombre: string;
  padreId: Id | null;
  tarjetas: number;
  temas: number;
  paraHoy: number;
  dominio: number;
  /** Temas y sueltas del área misma. */
  propio: GrupoDeTemas;
  subareas: GrupoDeTemas[];
}

function apunteDeTema(imp: Importacion, apuntes: Apunte[]): Apunte | null {
  const vivos = apuntes.filter(vivo);
  return vivos.find((a) => a.id === imp.apunte_id) ?? vivos.find((a) => a.importacion_id === imp.id && a.tipo === "aprendizaje") ?? null;
}

/** Tarjetas de un tema: vivas, de esa importación y todavía en el área de la importación. */
const tarjetasDeTema = (imp: Importacion, tarjetas: Tarjeta[]) =>
  tarjetas.filter((t) => vivo(t) && t.importacion_id === imp.id && t.area_id === imp.area_id);

export async function detalleArea(almacen: Almacen, reloj: Reloj, areaId: Id, opciones: OpcionesCola = {}): Promise<DetalleArea> {
  const area = await almacen.areas.obtener(areaId);
  if (!area || !vivo(area)) throw new Error("El área no existe (o está en la papelera).");
  const padre = area.padre_id ? await almacen.areas.obtener(area.padre_id) : undefined;
  const vivas = await almacen.areas.listar();
  const tarjetas = await almacen.tarjetas.listar();
  const importaciones = (await almacen.importaciones.listar());
  const apuntes = await almacen.apuntes.listar();
  const hoy = new Set((await construirCola(almacen, reloj, opciones)).map((t) => t.id));

  const grupo = (a: Area): GrupoDeTemas => {
    const delArea = tarjetas.filter((t) => t.area_id === a.id);
    const temas: TemaDeArea[] = importaciones.filter((i) => i.area_id === a.id).map((imp) => {
      const ts = tarjetasDeTema(imp, tarjetas);
      const paraHoy = ts.filter((t) => hoy.has(t.id)).length;
      const activas = ts.filter((t) => !t.suspendida);
      const estado: EstadoTema = paraHoy > 0 ? "hoy" : activas.length > 0 && activas.every(esNueva) ? "nuevo" : "al_dia";
      const ap = apunteDeTema(imp, apuntes);
      const texto = ap && ap.texto.trim() ? ap.texto : null;
      return {
        id: imp.id, nombre: imp.tema, tarjetas: ts.length, paraHoy, estado,
        estadoTexto: estado === "hoy" ? `${paraHoy} hoy` : estado === "nuevo" ? "Nuevo" : "Al día",
        apunteId: texto ? ap!.id : null, resumen: texto,
      };
    }).sort((x, y) => x.nombre.localeCompare(y.nombre, "es"));
    const enTemas = temas.reduce((n, t) => n + t.tarjetas, 0);
    return {
      areaId: a.id, nombre: a.nombre, temas, tarjetas: delArea.length, tarjetasSueltas: delArea.length - enTemas,
      paraHoy: delArea.filter((t) => hoy.has(t.id)).length,
    };
  };

  const subs = vivas.filter((s) => s.padre_id === area.id).sort(porNombre);
  const propio = grupo(area);
  const grupos = subs.map(grupo);
  const ids = new Set([area.id, ...subs.map((s) => s.id)]);
  return {
    id: area.id, nombre: area.nombre, padreId: area.padre_id,
    titulo: padre ? `${padre.nombre} › ${area.nombre}` : area.nombre,
    tarjetas: propio.tarjetas + grupos.reduce((n, g) => n + g.tarjetas, 0),
    temas: propio.temas.length + grupos.reduce((n, g) => n + g.temas.length, 0),
    paraHoy: propio.paraHoy + grupos.reduce((n, g) => n + g.paraHoy, 0),
    dominio: porcentajeDominio(tarjetas.filter((t) => ids.has(t.area_id) && !t.suspendida)),
    propio, subareas: grupos,
  };
}

// ---------- Contexto de una tarjeta (etiqueta del Repaso) ----------

export interface ContextoTarjeta {
  area: { id: Id; nombre: string };
  subarea: { id: Id; nombre: string } | null;
  tema: { id: Id; nombre: string } | null;
  apunteId: Id | null;
  resumen: string | null;
}

/** Para la etiqueta “Área › Subárea · Tema” y el enlace “Ver el resumen del tema”. */
export async function contextoDeTarjeta(almacen: Almacen, tarjeta: Tarjeta): Promise<ContextoTarjeta> {
  const propia = await almacen.areas.obtener(tarjeta.area_id);
  const padre = propia?.padre_id ? await almacen.areas.obtener(propia.padre_id) : undefined;
  const raiz = padre ?? propia;
  const area = { id: raiz?.id ?? tarjeta.area_id, nombre: raiz?.nombre ?? "Sin área" };
  const subarea = padre && propia ? { id: propia.id, nombre: propia.nombre } : null;
  let tema: ContextoTarjeta["tema"] = null;
  let apunteId: Id | null = null;
  let resumen: string | null = null;
  const imp = tarjeta.importacion_id ? await almacen.importaciones.obtener(tarjeta.importacion_id) : undefined;
  if (imp && vivo(imp)) {
    tema = { id: imp.id, nombre: imp.tema };
    const ap = apunteDeTema(imp, await almacen.apuntes.listar());
    if (ap && ap.texto.trim()) { apunteId = ap.id; resumen = ap.texto; }
  }
  return { area, subarea, tema, apunteId, resumen };
}

// ---------- Conjuntos (tema / subárea / área) ----------

interface Conjunto {
  areas: Area[];
  importaciones: Importacion[];
  apuntes: Apunte[];
  tarjetas: Tarjeta[];
}

export interface ResumenConjunto {
  subareas: number;
  temas: number;
  tarjetas: number;
}

export interface ResumenDeBorrado extends ResumenConjunto {
  /** Texto para la confirmación. */
  texto: string;
}

const vivo2 = (d: string | null) => d === null;

type Cabeza = { tipo: "tema"; imp: Importacion } | { tipo: "area"; area: Area };

/**
 * Reúne el conjunto de la cabeza. `estaEn` decide qué estado cuenta: al borrar, los vivos;
 * al restaurar, los que tienen el mismo `deleted_at` que la cabeza.
 */
async function reunir(almacen: Almacen, cabeza: Cabeza, estaEn: (deleted_at: string | null) => boolean, alBorrar: boolean): Promise<Conjunto> {
  const todasAreas = await almacen.areas.listar({ incluirBorrados: true });
  const todasImp = await almacen.importaciones.listar({ incluirBorrados: true });
  const todosAp = await almacen.apuntes.listar({ incluirBorrados: true });
  const todasTj = await almacen.tarjetas.listar({ incluirBorrados: true });
  if (cabeza.tipo === "tema") {
    const imp = cabeza.imp;
    return {
      areas: [], importaciones: [imp],
      apuntes: todosAp.filter((a) => estaEn(a.deleted_at) && (a.id === imp.apunte_id || a.importacion_id === imp.id)),
      tarjetas: todasTj.filter((t) => estaEn(t.deleted_at) && t.importacion_id === imp.id && (!alBorrar || t.area_id === imp.area_id)),
    };
  }
  const subs = todasAreas.filter((a) => a.padre_id === cabeza.area.id && estaEn(a.deleted_at));
  const areas = [cabeza.area, ...subs];
  const ids = new Set(areas.map((a) => a.id));
  const importaciones = todasImp.filter((i) => ids.has(i.area_id) && estaEn(i.deleted_at));
  const idsImp = new Set(importaciones.map((i) => i.id));
  return {
    areas, importaciones,
    apuntes: todosAp.filter((a) => estaEn(a.deleted_at) && ((a.importacion_id !== null && idsImp.has(a.importacion_id)) || (a.tipo === "aprendizaje" && a.area_id !== null && ids.has(a.area_id)))),
    tarjetas: todasTj.filter((t) => estaEn(t.deleted_at) && ids.has(t.area_id)),
  };
}

const resumirConjunto = (c: Conjunto): ResumenConjunto => ({
  subareas: c.areas.filter((a) => a.padre_id !== null).length, temas: c.importaciones.length, tarjetas: c.tarjetas.length,
});

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function textoResumen(r: ResumenConjunto): string {
  const partes: string[] = [];
  if (r.subareas > 0) partes.push(plural(r.subareas, "subárea", "subáreas"));
  partes.push(plural(r.temas, "tema", "temas"), plural(r.tarjetas, "tarjeta", "tarjetas"));
  return `Se van a la papelera: ${partes.join(", ")}. Podés restaurarlos durante 30 días.`;
}

async function importacionViva(almacen: Almacen, id: Id): Promise<Importacion> {
  const imp = await almacen.importaciones.obtener(id);
  if (!imp || !vivo(imp)) throw new Error("El tema no existe (o ya está en la papelera).");
  return imp;
}

async function areaViva(almacen: Almacen, id: Id): Promise<Area> {
  const a = await almacen.areas.obtener(id);
  if (!a || !vivo(a)) throw new Error("El área no existe (o ya está en la papelera).");
  return a;
}

export type ObjetivoDeBorrado = { tipo: "tema" | "area"; id: Id };

/** Cuántas subáreas, temas y tarjetas se perderían (para la confirmación). No cambia nada. */
export async function resumenDeBorrado(almacen: Almacen, objetivo: ObjetivoDeBorrado): Promise<ResumenDeBorrado> {
  const cabeza: Cabeza = objetivo.tipo === "tema" ? { tipo: "tema", imp: await importacionViva(almacen, objetivo.id) } : { tipo: "area", area: await areaViva(almacen, objetivo.id) };
  const r = resumirConjunto(await reunir(almacen, cabeza, vivo2, true));
  // Una subárea no se cuenta a sí misma: solo importan sus temas y tarjetas.
  if (cabeza.tipo === "area" && cabeza.area.padre_id !== null) r.subareas = 0;
  return { ...r, texto: textoResumen(r) };
}
/**
 * Instante de borrado que no choca con ningún `deleted_at` ya existente (áreas, importaciones, apuntes, tarjetas):
 * si el reloj no avanzó desde otro borrado, suma 1 ms hasta quedar libre. Así restaurar un conjunto nunca
 * resucita lo que se borró antes.
 */
async function instanteLibre(almacen: Almacen, reloj: Reloj): Promise<string> {
  const usados = new Set<string>();
  for (const repo of [almacen.areas, almacen.importaciones, almacen.apuntes, almacen.tarjetas] as const) {
    for (const x of await repo.listar({ incluirBorrados: true })) if (x.deleted_at !== null) usados.add(x.deleted_at);
  }
  let ms = reloj.ahora().getTime();
  while (usados.has(new Date(ms).toISOString())) ms++;
  return new Date(ms).toISOString();
}

async function borrarConjunto(almacen: Almacen, reloj: Reloj, cabeza: Cabeza): Promise<ResumenConjunto> {
  const c = await reunir(almacen, cabeza, vivo2, true);
  const ahora = await instanteLibre(almacen, reloj); // UN solo instante para todo el conjunto
  await almacen.guardarLote({
    areas: c.areas.map((x) => ({ ...x, deleted_at: ahora, updated_at: ahora })),
    importaciones: c.importaciones.map((x) => ({ ...x, deleted_at: ahora, updated_at: ahora })),
    apuntes: c.apuntes.map((x) => ({ ...x, deleted_at: ahora, updated_at: ahora })),
    tarjetas: c.tarjetas.map((x) => ({ ...x, deleted_at: ahora, updated_at: ahora, contenido_updated_at: ahora })),
  });
  return resumirConjunto(c);
}

export async function borrarTema(almacen: Almacen, reloj: Reloj, importacionId: Id): Promise<ResumenConjunto> {
  return borrarConjunto(almacen, reloj, { tipo: "tema", imp: await importacionViva(almacen, importacionId) });
}

export async function borrarArea(almacen: Almacen, reloj: Reloj, areaId: Id): Promise<ResumenConjunto> {
  const area = await areaViva(almacen, areaId);
  if (area.padre_id !== null) throw new Error("Esa es una subárea: borrala con “borrar subárea”.");
  return borrarConjunto(almacen, reloj, { tipo: "area", area });
}

export async function borrarSubarea(almacen: Almacen, reloj: Reloj, subareaId: Id): Promise<ResumenConjunto> {
  const area = await areaViva(almacen, subareaId);
  if (area.padre_id === null) throw new Error("Esa es un área de primer nivel: borrala con “borrar área”.");
  return borrarConjunto(almacen, reloj, { tipo: "area", area });
}

// ---------- Restaurar el conjunto ----------

async function restaurarConjunto(almacen: Almacen, reloj: Reloj, cabeza: Cabeza): Promise<ResumenConjunto> {
  const instante = (cabeza.tipo === "tema" ? cabeza.imp : cabeza.area).deleted_at;
  if (instante === null) throw new Error("Ya no está en la papelera (¿ya lo restauraste?).");
  const c = await reunir(almacen, cabeza, (d) => d === instante, false);
  const ahora = reloj.ahora().toISOString();
  await almacen.guardarLote({
    areas: c.areas.map((x) => ({ ...x, deleted_at: null, updated_at: ahora })),
    importaciones: c.importaciones.map((x) => ({ ...x, deleted_at: null, updated_at: ahora })),
    apuntes: c.apuntes.map((x) => ({ ...x, deleted_at: null, updated_at: ahora })),
    tarjetas: c.tarjetas.map((x) => ({ ...x, deleted_at: null, updated_at: ahora, contenido_updated_at: ahora })),
  });
  return resumirConjunto(c);
}

export async function restaurarTema(almacen: Almacen, reloj: Reloj, importacionId: Id): Promise<ResumenConjunto> {
  const imp = await almacen.importaciones.obtener(importacionId);
  if (!imp || imp.deleted_at === null) throw new Error("El tema no está en la papelera (¿ya lo restauraste?).");
  const area = await almacen.areas.obtener(imp.area_id);
  if (!area || !vivo(area)) throw new Error(`Para restaurar el tema, primero restaurá su área${area ? ` “${area.nombre}”` : ""}.`);
  return restaurarConjunto(almacen, reloj, { tipo: "tema", imp });
}

/** Restaura un área de primer nivel o una subárea con todo lo que se borró junto con ella. */
export async function restaurarArea(almacen: Almacen, reloj: Reloj, areaId: Id): Promise<ResumenConjunto> {
  const area = await almacen.areas.obtener(areaId);
  if (!area || area.deleted_at === null) throw new Error("El área no está en la papelera (¿ya la restauraste?).");
  if (area.padre_id !== null) {
    const padre = await almacen.areas.obtener(area.padre_id);
    if (!padre || !vivo(padre)) throw new Error(`Para restaurar la subárea, primero restaurá su área${padre ? ` “${padre.nombre}”` : ""}.`);
  }
  return restaurarConjunto(almacen, reloj, { tipo: "area", area });
}
export const restaurarSubarea = restaurarArea;

// ---------- Mover un tema ----------

export interface ResultadoMover {
  tarjetas: number;
}

/** Mueve el tema (importación + apunte + tarjetas vivas) a otra área o subárea viva. Conserva el estado de repaso. */
export async function moverTema(almacen: Almacen, reloj: Reloj, importacionId: Id, destinoAreaId: Id): Promise<ResultadoMover> {
  const imp = await importacionViva(almacen, importacionId);
  const destino = await almacen.areas.obtener(destinoAreaId);
  if (!destino || !vivo(destino)) throw new Error("El destino no existe (o está en la papelera).");
  if (imp.area_id === destino.id) throw new Error(`El tema ya está en “${destino.nombre}”: no se movió nada.`);
  const c = await reunir(almacen, { tipo: "tema", imp }, vivo2, true);
  const ahora = reloj.ahora().toISOString();
  await almacen.guardarLote({
    importaciones: [{ ...imp, area_id: destino.id, updated_at: ahora }],
    apuntes: c.apuntes.map((x) => ({ ...x, area_id: destino.id, updated_at: ahora })),
    tarjetas: c.tarjetas.map((x) => ({ ...x, area_id: destino.id, updated_at: ahora, contenido_updated_at: ahora })),
  });
  return { tarjetas: c.tarjetas.length };
}

// ---------- Papelera: un item por conjunto ----------

export interface ConjuntoPapelera extends ResumenConjunto {
  tipo: "tema" | "area";
  /** Id de la importación (tema) o del área/subárea. */
  id: Id;
  titulo: string;
  borrado: string;
  /** Ids de todo lo que lleva el conjunto (para no listarlo suelto). */
  idsTarjetas: Id[];
  idsApuntes: Id[];
}

/** Conjuntos borrados: cabezas de tema/subárea/área, con lo que cayó en el mismo instante. */
export async function conjuntosEnPapelera(almacen: Almacen): Promise<ConjuntoPapelera[]> {
  const areas = await almacen.areas.listar({ incluirBorrados: true });
  const porId = new Map(areas.map((a) => [a.id, a]));
  const importaciones = await almacen.importaciones.listar({ incluirBorrados: true });
  const salida: ConjuntoPapelera[] = [];
  const armar = (tipo: "tema" | "area", id: Id, titulo: string, borrado: string, c: Conjunto): ConjuntoPapelera => ({
    tipo, id, titulo, borrado, ...resumirConjunto(c), idsTarjetas: c.tarjetas.map((t) => t.id), idsApuntes: c.apuntes.map((a) => a.id),
  });
  for (const a of areas) {
    if (a.deleted_at === null) continue;
    const padre = a.padre_id ? porId.get(a.padre_id) : undefined;
    if (padre && padre.deleted_at === a.deleted_at) continue; // viaja con su área
    const d = a.deleted_at;
    const c = await reunir(almacen, { tipo: "area", area: a }, (x) => x === d, false);
    const item = armar("area", a.id, padre ? `${padre.nombre} › ${a.nombre}` : a.nombre, d, c);
    if (a.padre_id !== null) item.subareas = 0; // una subárea no se cuenta a sí misma
    salida.push(item);
  }
  for (const imp of importaciones) {
    if (imp.deleted_at === null) continue;
    const area = porId.get(imp.area_id);
    if (area && area.deleted_at === imp.deleted_at) continue; // viaja con su área
    const padre = area?.padre_id ? porId.get(area.padre_id) : undefined;
    if (area && padre && padre.deleted_at === imp.deleted_at) continue; // viaja con el área de la subárea
    const d = imp.deleted_at;
    const c = await reunir(almacen, { tipo: "tema", imp }, (x) => x === d, false);
    salida.push(armar("tema", imp.id, imp.tema, d, c));
  }
  return salida;
}
