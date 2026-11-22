/** Esquema de datos (sección 5 de la visión). Solo tipos y constantes. */

/** UUID generado en el cliente. */
export type Id = string;
/** Fecha local AAAA-MM-DD, sin hora. */
export type FechaISO = string;
/** Instante en UTC, ISO 8601 (por ejemplo 2026-11-22T07:00:00.000Z). */
export type InstanteUTC = string;

/** Campos comunes a todo registro. */
export interface Registro {
  id: Id;
  created_at: InstanteUTC;
  updated_at: InstanteUTC;
  /** Borrado lógico (papelera de 30 días). null = vivo. */
  deleted_at: InstanteUTC | null;
  /** Contador que asigna el servidor; null hasta sincronizar por primera vez. */
  rev: number | null;
}

export const EASE_INICIAL = 2.5;
export const EASE_MINIMO = 1.3;
export const INTERVALO_MAXIMO_DIAS = 365;
export const NUEVAS_POR_DIA = 20;
export const HORA_CAMBIO_DE_DIA = "04:00";
export const ZONA_HORARIA = "America/Argentina/Buenos_Aires";
export const DIAS_PAPELERA = 30;

export const CALIFICACIONES = ["otra_vez", "dificil", "bien", "facil"] as const;
export type Calificacion = (typeof CALIFICACIONES)[number];

export interface Area extends Registro {
  /** Primera escritura registrada del nombre. */
  nombre: string;
  /** Nombre sin tildes, mayúsculas ni signos: sirve para unir áreas. */
  nombre_normalizado: string;
  /** Área padre (null = Área de primer nivel; si no, es una Subárea). */
  padre_id: Id | null;
}

export interface Tarjeta extends Registro {
  area_id: Id;
  pregunta: string;
  respuesta: string;
  pista: string | null;
  suspendida: boolean;
  importacion_id: Id | null;
  /** Estado de repaso (SM-2). */
  ease: number;
  intervalo: number;
  reps: number;
  lapses: number;
  vence: FechaISO;
  /** Marca de tiempo del grupo "contenido" (pregunta, respuesta, pista, área, suspendida). */
  contenido_updated_at: InstanteUTC;
  /** Marca de tiempo del grupo "estado de repaso" (ease, intervalo, reps, lapses, vence). */
  repaso_updated_at: InstanteUTC;
}

/** Registro que solo se agrega: permite reconstruir el estado de una tarjeta. */
export interface Repaso extends Registro {
  tarjeta_id: Id;
  calificacion: Calificacion;
  repasado_en: InstanteUTC;
  ease_antes: number;
  ease_despues: number;
  intervalo_antes: number;
  intervalo_despues: number;
  /** Si es una compensación por "deshacer": id del repaso que anula (el registro original no se toca). */
  anula_a?: Id | null;
}

export type TipoMeta = "anual" | "trimestral";
export type EstadoMeta = "activa" | "lograda" | "descartada";
export type Trimestre = 1 | 2 | 3 | 4;

export interface Meta extends Registro {
  tipo: TipoMeta;
  anio: number;
  /** Solo en metas trimestrales. */
  trimestre: Trimestre | null;
  titulo: string;
  estado: EstadoMeta;
  /** Meta anual de la que cuelga una trimestral. */
  padre_id: Id | null;
}

import type { Repeticion } from "./recurrencia.ts";
export type { Repeticion };

export type EstadoTarea = "pendiente" | "hecha";

export interface Tarea extends Registro {
  titulo: string;
  fecha: FechaISO | null;
  meta_id: Id | null;
  nota: string | null;
  estado: EstadoTarea;
  hecha_en: InstanteUTC | null;
  /** Regla de repetición (opcional; ausente o null = no se repite). */
  repeticion?: Repeticion | null;
  /** Serie a la que pertenece la ocurrencia (opcional). */
  serie_id?: Id | null;
}

export const TIPOS_APUNTE = ["idea", "apunte", "aprendizaje"] as const;
export type TipoApunte = (typeof TIPOS_APUNTE)[number];

export interface Apunte extends Registro {
  titulo: string | null;
  /** Markdown simple. */
  texto: string;
  tipo: TipoApunte;
  etiquetas: string[];
  area_id: Id | null;
  /** Tema del bloque importado al que está ligado (resúmenes importados). */
  tema: string | null;
  importacion_id: Id | null;
}

export interface Importacion extends Registro {
  tema: string;
  /** Fecha informativa del bloque. */
  fecha_bloque: FechaISO;
  area_id: Id;
  tarjetas_creadas: Id[];
  duplicadas_omitidas: number;
  apunte_id: Id | null;
}

/** Nombres de las tablas. */
export const TABLAS = ["tarjetas", "repasos", "areas", "metas", "tareas", "apuntes", "importaciones"] as const;
export type Tabla = (typeof TABLAS)[number];
