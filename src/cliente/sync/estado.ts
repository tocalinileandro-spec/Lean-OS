/** Estado de sincronización y sus textos (sin DOM). */

export type FaseSync = "solo_local" | "sincronizando" | "sincronizado" | "sin_conexion" | "sesion_vencida" | "confirmacion_pendiente" | "error";

export interface ConfirmacionPendiente {
  mensaje: string;
  tarjetas_vivas: number;
  tarjetas_a_borrar: number;
}

export interface EstadoSync {
  fase: FaseSync;
  /** Registros distintos que faltan subir. */
  pendientes: number;
  /** Instante (ISO, UTC) de la última sincronización completa, o null. */
  ultimaVez: string | null;
  confirmacion: ConfirmacionPendiente | null;
  /** Mensaje en castellano del último problema (fase "error"). */
  error: string | null;
  /** Sube cada vez que la sincronización cambió datos locales (la pantalla puede redibujarse). */
  versionDatos: number;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Texto corto para el indicador de la cabecera. */
export function textoEstado(e: EstadoSync): string {
  const pend = e.pendientes > 0 ? ` · ${plural(e.pendientes, "cambio pendiente", "cambios pendientes")}` : "";
  switch (e.fase) {
    case "solo_local": return "Solo local";
    case "sincronizando": return `Sincronizando…${pend}`;
    case "sincronizado": return e.pendientes > 0 ? plural(e.pendientes, "cambio pendiente", "cambios pendientes") : "Sincronizado";
    case "sin_conexion": return `Sin conexión${pend}`;
    case "sesion_vencida": return `Sesión vencida${pend}`;
    case "confirmacion_pendiente": return "Falta confirmar un borrado";
    case "error": return `No se pudo sincronizar${pend}`;
  }
}

/** Explicación para la sección Cuenta de Ajustes. */
export function detalleEstado(e: EstadoSync): string {
  switch (e.fase) {
    case "solo_local": return "No iniciaste sesión: tus datos se guardan solo en este dispositivo. Todo funciona igual.";
    case "sincronizando": return "Sincronizando con el servidor…";
    case "sincronizado": return e.pendientes > 0 ? "Hay cambios nuevos que todavía no se subieron; se suben solos en unos segundos." : "Todo está sincronizado con el servidor.";
    case "sin_conexion": return "No hay conexión con el servidor. Seguí usando la app: los cambios se guardan acá y se suben solos cuando vuelva internet.";
    case "sesion_vencida": return "Tu sesión venció. Ingresá la contraseña de nuevo para seguir sincronizando; tus datos de este dispositivo siguen intactos.";
    case "confirmacion_pendiente": return "La sincronización quedó en pausa hasta que confirmes el borrado. No se aplicó nada.";
    case "error": return e.error ?? "No se pudo sincronizar. Se reintenta solo; tus datos están a salvo en este dispositivo.";
  }
}

/** Fecha y hora local (Buenos Aires) como dd/mm/aaaa hh:mm. */
export function formatearInstante(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}`;
}
