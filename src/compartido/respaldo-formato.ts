/**
 * Formato del respaldo ("Exportar todo" / GET /export), compartido por servidor y cliente para que no diverjan.
 * Solo lógica pura: sin base de datos ni DOM.
 */
import { CALIFICACIONES, TABLAS } from "./esquema.ts";
import type { Tabla } from "./esquema.ts";

export type Fila = Record<string, unknown>;

export const VERSION_FORMATO = 1;

export interface Exportacion {
  formato: number;
  exportado_en: string;
  rev: number;
  tablas: Record<Tabla, Fila[]>;
}

const esFecha = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const esObjeto = (v: unknown): v is Fila => typeof v === "object" && v !== null && !Array.isArray(v);

/** Valida la forma mínima de un registro. Devuelve el motivo (sin eco del contenido) o null. */
export function validarRegistro(tabla: Tabla, r: unknown, exigirRev = false): string | null {
  if (!esObjeto(r)) return "no es un objeto";
  if (typeof r["id"] !== "string" || r["id"] === "" || r["id"].length > 100) return "falta un id válido";
  if (!esFecha(r["created_at"])) return "falta created_at válido";
  if (!esFecha(r["updated_at"])) return "falta updated_at válido";
  if (r["deleted_at"] != null && !esFecha(r["deleted_at"])) return "deleted_at inválido";
  if (tabla === "tarjetas") {
    if (!esFecha(r["contenido_updated_at"])) return "falta contenido_updated_at válido";
    if (!esFecha(r["repaso_updated_at"])) return "falta repaso_updated_at válido";
  }
  if (exigirRev && !(Number.isInteger(r["rev"]) && (r["rev"] as number) >= 0)) return "falta rev válido";
  return null;
}

/** Arma el objeto del respaldo. `rev` es el rev actual del origen. */
export function armarExportacion(tablas: Record<Tabla, Fila[]>, rev: number, exportadoEn: Date): Exportacion {
  return { formato: VERSION_FORMATO, exportado_en: exportadoEn.toISOString(), rev, tablas };
}

/**
 * Valida un respaldo completo antes de tocar nada. Devuelve el mensaje de error en castellano o la exportación.
 * `exigirRev`: el servidor lo exige (restaura conservando revs); el cliente acepta registros sin rev.
 */
export function validarExportacion(datos: unknown, exigirRev: boolean): { error: string } | { exportacion: Exportacion } {
  const d = datos as Partial<Exportacion> | null;
  if (typeof d !== "object" || d === null || d.formato !== VERSION_FORMATO || typeof d.tablas !== "object" || d.tablas === null) {
    return { error: "El archivo no es un respaldo de Lean OS con un formato conocido." };
  }
  for (const t of TABLAS) {
    const lista = d.tablas[t];
    if (!Array.isArray(lista)) return { error: `Al respaldo le falta la tabla ${t}.` };
    for (let i = 0; i < lista.length; i++) {
      const motivo = validarRegistro(t, lista[i], exigirRev);
      if (motivo) return { error: `El registro ${i + 1} de ${t} es inválido: ${motivo}.` };
    }
  }
  return { exportacion: d as Exportacion };
}

const texto = (v: unknown) => typeof v === "string";
const numero = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** Campos propios de cada tabla que la app necesita para no romperse al mostrar el registro (usado al importar en el cliente). */
export function validarForma(tabla: Tabla, r: Fila): string | null {
  const ok = (c: boolean) => (c ? null : "le faltan campos propios del tipo de dato");
  switch (tabla) {
    case "tarjetas":
      return ok(texto(r["area_id"]) && texto(r["pregunta"]) && texto(r["respuesta"]) && typeof r["suspendida"] === "boolean" &&
        numero(r["ease"]) && numero(r["intervalo"]) && numero(r["reps"]) && numero(r["lapses"]) && texto(r["vence"]));
    case "repasos":
      return ok(texto(r["tarjeta_id"]) && (CALIFICACIONES as readonly unknown[]).includes(r["calificacion"]) && esFecha(r["repasado_en"]) &&
        numero(r["ease_antes"]) && numero(r["ease_despues"]) && numero(r["intervalo_antes"]) && numero(r["intervalo_despues"]));
    case "areas":
      return ok(texto(r["nombre"]) && texto(r["nombre_normalizado"]));
    case "metas":
      return ok((r["tipo"] === "anual" || r["tipo"] === "trimestral") && numero(r["anio"]) && texto(r["titulo"]) && texto(r["estado"]));
    case "tareas":
      return ok(texto(r["titulo"]) && (r["estado"] === "pendiente" || r["estado"] === "hecha"));
    case "apuntes":
      return ok(texto(r["texto"]) && texto(r["tipo"]) && Array.isArray(r["etiquetas"]));
    case "importaciones":
      return ok(texto(r["tema"]) && Array.isArray(r["tarjetas_creadas"]));
  }
}
