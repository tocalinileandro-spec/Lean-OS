/**
 * Lógica de pantalla del módulo 1: sin DOM, para poder probarla. Las vistas (vistas.ts)
 * solo dibujan lo que estas funciones devuelven.
 */
import type { Almacen } from "../../compartido/almacen.ts";
import { fijarHoraCambio, diaLogico } from "../../compartido/dia.ts";
import {
  CALIFICACIONES, HORA_CAMBIO_DE_DIA, NUEVAS_POR_DIA,
  type Area, type Calificacion, type FechaISO, type Id, type Tarea, type Tarjeta,
} from "../../compartido/esquema.ts";
import { calcularEstadisticas, type Estadisticas } from "../../compartido/estadisticas.ts";
import { normalizar } from "../../compartido/normalizar.ts";
import { tareasDeHoy } from "../../compartido/tareas.ts";
import { calificar, construirCola, SesionLibre, SesionRepaso } from "../../compartido/repaso.ts";
import type { InformeMigracion } from "../../compartido/migracion-original.ts";
import { colaDeRepaso, colaLibre, contextoDeTarjeta, proximaFechaDeRepaso, type ContextoTarjeta } from "../../compartido/areas.ts";
import type { Reloj } from "../../compartido/reloj.ts";
import type { ControlSync } from "../sync/motor.ts";

export interface Dependencias {
  almacen: Almacen;
  reloj: Reloj;
  persistencia: Persistencia;
  /** Sincronización y cuenta (sin esto la app es solo local y no muestra Cuenta ni el indicador). */
  sync?: ControlSync;
  /** Entrega un archivo al usuario (por defecto, descarga del navegador). Se inyecta en pruebas. */
  descargar?: (nombre: string, texto: string) => void;
  /** Lee el texto del archivo elegido para importar (por defecto, `file.text()`). */
  leerArchivo?: (archivo: File) => Promise<string>;
  /** Lee los bytes del archivo elegido para importar el respaldo del Lean OS original (por defecto, `file.arrayBuffer()`). */
  leerBytes?: (archivo: File) => Promise<Uint8Array>;
}

/** Lo mínimo que se usa de localStorage (se inyecta otra cosa en las pruebas). */
export interface Persistencia {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem?(clave: string): void;
}

// ---------- Formato ----------

/** AAAA-MM-DD -> dd/mm/aaaa. */
export function formatearFecha(iso: FechaISO): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

export function textoIntervalo(dias: number): string {
  if (dias <= 0) return "Hoy";
  if (dias === 1) return "1 día";
  return `${dias} días`;
}

/** Nunca se muestra un error técnico crudo: mensaje en castellano que dice qué hacer. */
export function mensajeDeError(error: unknown): string {
  const t = error instanceof Error ? error.message : "";
  if (MENSAJES_DE_AREAS.test(t)) return t;
  if (/no puede (quedar|estar) (vacía|vacío)/.test(t)) return t.replace(/^Error:\s*/, "") + ". Completalo y volvé a guardar.";
  if (/^(Fecha inválida|El año no es válido)/.test(t)) return "La fecha o el año no son válidos. Revisalos y volvé a guardar.";
  if (/^(Elegí al menos un día|Los días de la semana|Hay días de la semana|El día del mes|La regla de repetición|El tipo de repetición)/.test(t)) return `${t}. Revisalo y volvé a guardar.`;
  return "No se pudo completar la acción. Probá de nuevo; si sigue fallando, recargá la página (tus datos están guardados).";
}

/** Mensajes en castellano de `areas.ts` (crear, mover, borrar y restaurar): ya dicen qué pasó y qué hacer, se muestran tal cual. */
const MENSAJES_DE_AREAS = /^(El nombre (del área|de la subárea)|El área (elegida )?no existe|El área no está|El tema no (existe|está)|El tema ya está|El destino no existe|Una subárea no puede|Esa es (una subárea|un área)|Ya no está en la papelera|Para restaurar (el tema|la subárea))/;

const DIAS_LARGOS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** "Domingo 22 de noviembre" para el encabezado de Áreas. */
export function fechaLarga(iso: FechaISO): string {
  const [a, m, dia] = iso.split("-").map(Number) as [number, number, number];
  const semana = new Date(Date.UTC(a, m - 1, dia)).getUTCDay();
  return `${DIAS_LARGOS[semana]} ${dia} de ${MESES_LARGOS[m - 1]}`;
}
/** Saludo sobrio según la hora de Buenos Aires. */
export function saludoDelDia(ahora: Date): string {
  const hora = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" }).format(ahora)) % 24;
  return hora >= 5 && hora < 12 ? "Buen día" : hora >= 12 && hora < 20 ? "Buenas tardes" : "Buenas noches";
}
export const ETIQUETAS: Record<Calificacion, string> = { otra_vez: "Otra vez", dificil: "Difícil", bien: "Bien", facil: "Fácil" };

// ---------- Ajustes ----------

export interface Ajustes {
  nuevasPorDia: number;
  horaCambio: string;
}

export const AJUSTES_POR_DEFECTO: Ajustes = { nuevasPorDia: NUEVAS_POR_DIA, horaCambio: HORA_CAMBIO_DE_DIA };
const CLAVE_AJUSTES = "lean-os:ajustes";

export function cargarAjustes(p: Persistencia): Ajustes {
  try {
    const crudo = JSON.parse(p.getItem(CLAVE_AJUSTES) ?? "null") as Partial<Ajustes> | null;
    const r = validarAjustes({ ...AJUSTES_POR_DEFECTO, ...(crudo ?? {}) });
    return "ajustes" in r ? r.ajustes : AJUSTES_POR_DEFECTO;
  } catch {
    return AJUSTES_POR_DEFECTO;
  }
}

export function validarAjustes(a: { nuevasPorDia: unknown; horaCambio: unknown }): { ajustes: Ajustes } | { error: string } {
  const n = typeof a.nuevasPorDia === "number" ? a.nuevasPorDia : String(a.nuevasPorDia).trim() === "" ? NaN : Number(a.nuevasPorDia);
  if (!Number.isInteger(n) || n < 0 || n > 999) return { error: "Las tarjetas nuevas por día tienen que ser un número entero entre 0 y 999." };
  const h = /^(\d{1,2}):(\d{2})$/.exec(String(a.horaCambio));
  if (!h || Number(h[1]) > 23 || Number(h[2]) > 59) return { error: "La hora de cambio de día tiene que ser una hora válida, por ejemplo 04:00." };
  return { ajustes: { nuevasPorDia: n, horaCambio: `${h[1]!.padStart(2, "0")}:${h[2]}` } };
}

/** Guarda al instante y aplica la hora de cambio. */
export function guardarAjustes(p: Persistencia, a: Ajustes): void {
  p.setItem(CLAVE_AJUSTES, JSON.stringify(a));
  fijarHoraCambio(a.horaCambio);
}

// ---------- Tema (solo de este dispositivo: no se sincroniza ni toca datos) ----------

export const TEMAS = ["sistema", "claro", "oscuro"] as const;
export type Tema = (typeof TEMAS)[number];
export const TEMA_POR_DEFECTO: Tema = "sistema";
const CLAVE_TEMA = "lean-os:tema";

/** Cualquier valor ausente, roto o desconocido vale "sistema". */
export function cargarTema(p: Persistencia): Tema {
  try {
    const v = p.getItem(CLAVE_TEMA);
    return (TEMAS as readonly string[]).includes(v ?? "") ? (v as Tema) : TEMA_POR_DEFECTO;
  } catch {
    return TEMA_POR_DEFECTO;
  }
}

export function guardarTema(p: Persistencia, t: Tema): void {
  if (!(TEMAS as readonly string[]).includes(t)) return;
  p.setItem(CLAVE_TEMA, t);
}

/** "sistema" quita `data-tema` (manda prefers-color-scheme); "claro" y "oscuro" lo fijan en <html>. */
export function aplicarTema(html: { setAttribute(k: string, v: string): void; removeAttribute(k: string): void }, t: Tema): void {
  if (t === "claro" || t === "oscuro") html.setAttribute("data-tema", t);
  else html.removeAttribute("data-tema");
}

// ---------- Migración desde el Lean OS original ----------

const plu = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Resumen en castellano del informe de la migración (lo que se muestra en Ajustes). */
export function lineasDeMigracion(i: InformeMigracion): { resumen: string; avisos: string[]; errores: string[] } {
  const leido = i.areas + i.subareas + i.temas === 0 ? "No se leyó ninguna área ni tema." : `Se leyeron ${plu(i.areas, "área", "áreas")}, ${plu(i.subareas, "subárea", "subáreas")} y ${plu(i.temas, "tema", "temas")}.`;
  return {
    resumen: `${leido} Tarjetas creadas: ${i.creadas}. Duplicadas omitidas: ${i.duplicadas}.`,
    avisos: i.avisos,
    errores: i.errores,
  };
}

// ---------- Áreas ----------

export function nombreDeArea(area: Area, areas: Area[]): string {
  const padre = area.padre_id ? areas.find((x) => x.id === area.padre_id) : undefined;
  return padre ? `${padre.nombre} > ${area.nombre}` : area.nombre;
}

// ---------- Hoy ----------

export interface VistaHoy {
  fecha: string;
  pendientes: number;
  estadisticas: Estadisticas;
  /** Pendientes con fecha anterior a hoy (se muestran destacadas arriba). */
  atrasadas: Tarea[];
  /** Tareas con fecha de hoy (pendientes y hechas). */
  tareas: Tarea[];
}

export async function vistaHoy(d: Dependencias): Promise<VistaHoy> {
  const aj = cargarAjustes(d.persistencia);
  const t = await tareasDeHoy(d.almacen, d.reloj, { limiteNuevas: aj.nuevasPorDia });
  return {
    atrasadas: t.atrasadas,
    tareas: t.hoy,
    fecha: formatearFecha(diaLogico(d.reloj)),
    pendientes: (await construirCola(d.almacen, d.reloj, { limiteNuevas: aj.nuevasPorDia })).length,
    estadisticas: await calcularEstadisticas(d.almacen, d.reloj, { limiteNuevas: aj.nuevasPorDia }),
  };
}

/** Tarjetas que hoy están para repasar (insignia de la barra). */
export async function cantidadParaRepasar(d: Dependencias): Promise<number> {
  const aj = cargarAjustes(d.persistencia);
  return (await construirCola(d.almacen, d.reloj, { limiteNuevas: aj.nuevasPorDia })).length;
}

// ---------- Repaso ----------

export interface BotonRepaso {
  boton: Calificacion;
  etiqueta: string;
  intervalo: string;
  atajo: number;
}

/** "Área › Subárea · Tema", "Área · Tema" (sin subárea) o "Área › Subárea" (tarjeta sin tema). */
export function etiquetaDeContexto(c: ContextoTarjeta): string {
  const lugar = c.subarea ? `${c.area.nombre} › ${c.subarea.nombre}` : c.area.nombre;
  return c.tema ? `${lugar} · ${c.tema.nombre}` : lugar;
}

export interface VistaRepaso {
  hayTarjeta: boolean;
  /** Tarjetas que faltan en la cola de la sesión, contando la actual (el "Otra vez" la vuelve a poner al final). */
  pendientes: number;
  calificadas: number;
  puedeDeshacer: boolean;
  /** Filtro de la sesión: id del área o subárea (null = todo lo de hoy). */
  areaId: Id | null;
  /** Solo presente (true) en el repaso libre: práctica que no guarda nada. */
  libre?: true;
  /** Solo en el repaso libre: cuántas tarjetas tenía la sesión al arrancar (para "Listo: repasaste N tarjetas"). */
  totalInicial?: number;
  /** Con tarjeta: "Tarjeta {numero} de {total}". numero = calificadas + 1; total = calificadas + pendientes (crece con cada "Otra vez"). */
  numero?: number;
  total?: number;
  /** Tarjetas que faltan después de la actual (total - numero). */
  faltan?: number;
  /** Sin tarjeta: fecha (AAAA-MM-DD) de lo próximo dentro del filtro, o null si no hay nada activo. */
  proxima?: string | null;
  /** Etiqueta de contexto de la tarjeta actual. */
  etiqueta?: string;
  /** La tarjeta tiene un resumen de tema para mostrar (el texto se pide aparte con `resumenDelTema`). */
  hayResumen?: boolean;
  area?: string;
  pregunta?: string;
  /** Solo existe si hay pista; el texto va a la vista únicamente cuando se la pidió. */
  hayPista?: boolean;
  pista?: string;
  respuestaVisible?: boolean;
  /** Solo se completa después de "Ver respuesta" (R9). */
  respuesta?: string;
  botones?: BotonRepaso[];
}

export class PantallaRepaso {
  /** Tarjeta para la que se pidió la respuesta / la pista: solo vale para esa tarjeta (R9). */
  #idRespuesta: Id | undefined;
  #idPista: Id | undefined;
  #calificadas = 0;
  #totalInicial = 0;

  private constructor(private d: Dependencias, private sesion: SesionRepaso | SesionLibre, private filtro: Id | null, private modoLibre = false) {}

  /** true en el repaso libre (no escribe nada en el almacén). */
  get libre(): boolean { return this.modoLibre; }

  /** Repaso libre: todas las tarjetas activas del filtro, sin tope de nuevas. Califica solo en memoria. */
  static async iniciarLibre(d: Dependencias, filtro: { areaId?: Id | null } = {}): Promise<PantallaRepaso> {
    const cola = await colaLibre(d.almacen, filtro.areaId ?? null);
    const p = new PantallaRepaso(d, new SesionLibre(d.almacen, cola), filtro.areaId ?? null, true);
    p.#totalInicial = cola.length;
    return p;
  }

  /** Filtro con el que arrancó la sesión (se mantiene mientras se califica). */
  get areaId(): Id | null { return this.filtro; }

  /** `areaId` filtra la cola por esa área (incluye sus subáreas; una subárea solo lo suyo); el tope de nuevas se aplica antes. */
  static async iniciar(d: Dependencias, filtro: { areaId?: Id | null } = {}): Promise<PantallaRepaso> {
    const aj = cargarAjustes(d.persistencia);
    const cola = await colaDeRepaso(d.almacen, d.reloj, { limiteNuevas: aj.nuevasPorDia, areaId: filtro.areaId ?? null });
    return new PantallaRepaso(d, new SesionRepaso(d.almacen, d.reloj, cola), filtro.areaId ?? null);
  }

  /** Sin tarjeta actual (por ejemplo, la borraron desde otra pestaña) no hace nada. */
  async verRespuesta(): Promise<void> {
    this.#idRespuesta = await this.sesion.siguiente();
  }
  async verPista(): Promise<void> {
    this.#idPista = await this.sesion.siguiente();
  }

  async vista(): Promise<VistaRepaso> {
    const id = await this.sesion.siguiente();
    const base = { pendientes: this.sesion.pendientes, calificadas: this.#calificadas, puedeDeshacer: this.#calificadas > 0, areaId: this.filtro, ...(this.modoLibre ? { libre: true as const, totalInicial: this.#totalInicial } : {}) };
    if (id === undefined && this.modoLibre) return { hayTarjeta: false, ...base, proxima: null };
    if (id === undefined) {
      const aj = cargarAjustes(this.d.persistencia);
      return { hayTarjeta: false, ...base, proxima: await proximaFechaDeRepaso(this.d.almacen, this.d.reloj, { limiteNuevas: aj.nuevasPorDia, areaId: this.filtro }) };
    }
    const t = (await this.d.almacen.tarjetas.obtener(id))!;
    const respuestaVisible = this.#idRespuesta === id;
    const pistaVisible = this.#idPista === id;
    const areas = await this.d.almacen.areas.listar();
    const area = areas.find((a) => a.id === t.area_id);
    const contexto = await contextoDeTarjeta(this.d.almacen, t);
    const v: VistaRepaso = {
      hayTarjeta: true, ...base,
      numero: this.#calificadas + 1, total: this.#calificadas + base.pendientes, faltan: base.pendientes - 1,
      etiqueta: etiquetaDeContexto(contexto), hayResumen: contexto.resumen !== null,
      area: area ? nombreDeArea(area, areas) : "",
      pregunta: t.pregunta,
      hayPista: !!t.pista,
      respuestaVisible,
    };
    if (t.pista && pistaVisible) v.pista = t.pista;
    if (respuestaVisible) {
      v.respuesta = t.respuesta;
      const hoy = diaLogico(this.d.reloj);
      v.botones = CALIFICACIONES.map((b, i) => ({
        boton: b, etiqueta: ETIQUETAS[b], atajo: i + 1,
        intervalo: this.modoLibre ? "" : textoIntervalo(calificar(t, b, hoy).intervalo),
      }));
    }
    return v;
  }

  /**
   * Resumen del tema de la tarjeta actual (el apunte de aprendizaje). Es solo lectura: no toca la sesión,
   * no revela la respuesta de la tarjeta ni cambia nada guardado. null si no hay tarjeta o el tema no tiene resumen.
   */
  async resumenDelTema(): Promise<{ tema: string; etiqueta: string; texto: string } | null> {
    const id = await this.sesion.siguiente();
    if (id === undefined) return null;
    const t = await this.d.almacen.tarjetas.obtener(id);
    if (!t) return null;
    const c = await contextoDeTarjeta(this.d.almacen, t);
    return c.resumen === null ? null : { tema: c.tema?.nombre ?? "", etiqueta: etiquetaDeContexto(c), texto: c.resumen };
  }

  /** Solo califica si ya se vio la respuesta. */
  async calificar(boton: Calificacion): Promise<void> {
    const id = await this.sesion.siguiente();
    if (id === undefined || this.#idRespuesta !== id) return;
    await this.sesion.calificar(boton);
    this.#calificadas++;
    this.#idRespuesta = undefined;
    this.#idPista = undefined;
  }

  async deshacer(): Promise<void> {
    if (await this.sesion.deshacer()) {
      this.#calificadas = Math.max(0, this.#calificadas - 1);
      this.#idRespuesta = undefined;
      this.#idPista = undefined;
    }
  }
}

// ---------- Tarjetas (lista por Área > Subárea) ----------

export interface GrupoTarjetas {
  area: Area;
  nombre: string;
  tarjetas: Tarjeta[];
}

/** Grupos ordenados: cada Área seguida de sus Subáreas. Se omiten los grupos sin tarjetas. */
export async function agruparTarjetas(almacen: Almacen, busqueda: string): Promise<GrupoTarjetas[]> {
  const areas = await almacen.areas.listar();
  const tarjetas = await almacen.tarjetas.listar();
  const q = normalizar(busqueda);
  const coincide = (t: Tarjeta) => !q || normalizar(`${t.pregunta} ${t.respuesta} ${t.pista ?? ""}`).includes(q);
  const porNombre = (a: Area, b: Area) => a.nombre.localeCompare(b.nombre, "es");
  const orden: Area[] = [];
  for (const raiz of areas.filter((a) => a.padre_id === null).sort(porNombre)) {
    orden.push(raiz, ...areas.filter((a) => a.padre_id === raiz.id).sort(porNombre));
  }
  // Subáreas cuyo padre falta (no debería pasar): se muestran igual.
  for (const a of areas) if (!orden.includes(a)) orden.push(a);
  return orden
    .map((area) => ({ area, nombre: nombreDeArea(area, areas), tarjetas: tarjetas.filter((t) => t.area_id === area.id && coincide(t)) }))
    .filter((g) => g.tarjetas.length > 0);
}

export async function opcionesDeArea(almacen: Almacen): Promise<{ id: Id; nombre: string }[]> {
  const areas = await almacen.areas.listar();
  return areas.map((a) => ({ id: a.id, nombre: nombreDeArea(a, areas) })).sort((x, y) => x.nombre.localeCompare(y.nombre, "es"));
}
