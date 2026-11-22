import { HORA_CAMBIO_DE_DIA, ZONA_HORARIA, type FechaISO } from "./esquema.ts";
import type { Reloj } from "./reloj.ts";

/**
 * Día lógico (AAAA-MM-DD) del reloj: el día cambia a `horaCambio` (HH:MM) en la zona dada.
 * Se resta la hora de cambio al instante y se toma la fecha local de la zona (Intl, sin dependencias).
 */
export function diaLogico(reloj: Reloj, horaCambio: string = HORA_CAMBIO_DE_DIA, zona: string = ZONA_HORARIA): FechaISO {
  const m = /^(\d{1,2}):(\d{2})$/.exec(horaCambio);
  if (!m) throw new Error(`Hora de cambio inválida: ${horaCambio}`);
  const minutos = Number(m[1]) * 60 + Number(m[2]);
  const desplazado = new Date(reloj.ahora().getTime() - minutos * 60_000);
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(desplazado);
  const g = (t: string) => partes.find((p) => p.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}
