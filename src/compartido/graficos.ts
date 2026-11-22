/**
 * Datos de los gráficos de estadísticas (módulo 1). Funciones puras sobre listas ya leídas:
 * el día lógico llega como parámetro (`hoy`), nunca se lee el reloj acá. Una sola pasada por colección.
 */
import type { Almacen } from "./almacen.ts";
import { diaLogico, diaLogicoDeMs } from "./dia.ts";
import type { Area, FechaISO, Repaso, Tarea, Tarjeta } from "./esquema.ts";
import { totalesPorArea, type TotalPorArea } from "./estadisticas.ts";
import { repasosVigentes, sumarDias } from "./repaso.ts";
import type { Reloj } from "./reloj.ts";

export const DIAS_GRAFICO = 30;
export const SEMANAS_GRAFICO = 8;

export interface PuntoDia { dia: FechaISO; total: number }
export interface Retencion {
  /** Porcentaje entero 0-100 (redondeado) o null si no hubo repasos (se muestra "Sin datos"). */
  porcentaje: number | null;
  aciertos: number;
  total: number;
}
export interface PuntoSemana { inicio: FechaISO; fin: FechaISO; total: number }

const diaDeInstante = (iso: string): FechaISO => diaLogicoDeMs(new Date(iso).getTime());

/** Calificaciones vigentes de cada uno de los últimos `dias` días lógicos (hasta `hoy`), en orden cronológico; cero si no hubo. */
export function repasosPorDia(repasos: Repaso[], hoy: FechaISO, dias: number = DIAS_GRAFICO): PuntoDia[] {
  const lista: PuntoDia[] = [];
  const indice = new Map<FechaISO, PuntoDia>();
  for (let i = dias - 1; i >= 0; i--) {
    const p = { dia: sumarDias(hoy, -i), total: 0 };
    lista.push(p);
    indice.set(p.dia, p);
  }
  for (const r of repasosVigentes(repasos)) {
    const p = indice.get(diaDeInstante(r.repasado_en));
    if (p) p.total++;
  }
  return lista;
}

/**
 * Retención de los últimos `dias` días: acierto = Bien o Fácil; Difícil y Otra vez cuentan en el total
 * pero no como acierto. Sin repasos en el período devuelve porcentaje null (nunca divide por cero).
 */
export function retencion(repasos: Repaso[], hoy: FechaISO, dias: number = DIAS_GRAFICO): Retencion {
  const desde = sumarDias(hoy, -(dias - 1));
  let aciertos = 0;
  let total = 0;
  for (const r of repasosVigentes(repasos)) {
    const d = diaDeInstante(r.repasado_en);
    if (d < desde || d > hoy) continue;
    total++;
    if (r.calificacion === "bien" || r.calificacion === "facil") aciertos++;
  }
  return { porcentaje: total === 0 ? null : Math.round((aciertos * 100) / total), aciertos, total };
}

/** Misma cuenta que las estadísticas mínimas (el Área suma sus subáreas). */
export function tarjetasPorArea(areas: Area[], tarjetas: Tarjeta[]): TotalPorArea[] {
  return totalesPorArea(areas, tarjetas);
}

const lunesDe = (dia: FechaISO): FechaISO => {
  const [a, m, d] = dia.split("-").map(Number) as [number, number, number];
  const diaSemana = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0 = domingo
  return sumarDias(dia, -((diaSemana + 6) % 7));
};

/** Tareas vivas hechas por semana (lunes a domingo, día lógico de `hecha_en`), las últimas `semanas` hasta la de `hoy`. */
export function tareasHechasPorSemana(tareas: Tarea[], hoy: FechaISO, semanas: number = SEMANAS_GRAFICO): PuntoSemana[] {
  const lunesActual = lunesDe(hoy);
  const lista: PuntoSemana[] = [];
  const indice = new Map<FechaISO, PuntoSemana>();
  for (let i = semanas - 1; i >= 0; i--) {
    const inicio = sumarDias(lunesActual, -7 * i);
    const p = { inicio, fin: sumarDias(inicio, 6), total: 0 };
    lista.push(p);
    indice.set(inicio, p);
  }
  for (const t of tareas) {
    if (t.deleted_at !== null || t.estado !== "hecha" || !t.hecha_en) continue;
    const p = indice.get(lunesDe(diaDeInstante(t.hecha_en)));
    if (p) p.total++;
  }
  return lista;
}

export interface DatosGraficos {
  repasosPorDia: PuntoDia[];
  retencion: Retencion;
  porArea: TotalPorArea[];
  tareasPorSemana: PuntoSemana[];
}

export function calcularGraficos(repasos: Repaso[], areas: Area[], tarjetas: Tarjeta[], tareas: Tarea[], hoy: FechaISO): DatosGraficos {
  return {
    repasosPorDia: repasosPorDia(repasos, hoy),
    retencion: retencion(repasos, hoy),
    porArea: tarjetasPorArea(areas, tarjetas),
    tareasPorSemana: tareasHechasPorSemana(tareas, hoy),
  };
}

/** Lee el almacén (solo lectura) y calcula todo con el día lógico del reloj. */
export async function datosGraficos(almacen: Almacen, reloj: Reloj): Promise<DatosGraficos> {
  const [repasos, areas, tarjetas, tareas] = await Promise.all([
    almacen.repasos.listar(), almacen.areas.listar(), almacen.tarjetas.listar(), almacen.tareas.listar(),
  ]);
  return calcularGraficos(repasos, areas, tarjetas, tareas, diaLogico(reloj));
}
