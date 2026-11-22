/** Estadísticas mínimas (módulo 1). Funciones puras sobre el Almacén y el reloj. */
import type { Almacen } from "./almacen.ts";
import { diaLogico } from "./dia.ts";
import type { Area, FechaISO, Id, Tarjeta } from "./esquema.ts";
import { construirCola, repasosVigentes, sumarDias, type OpcionesCola } from "./repaso.ts";
import type { Reloj } from "./reloj.ts";

export interface TotalPorArea {
  area_id: Id;
  nombre: string;
  total: number;
}

export interface Estadisticas {
  /** Tarjetas en la cola de hoy (vencidas más nuevas dentro del cupo). */
  pendientesHoy: number;
  /** Repasos vigentes cuyo día lógico es hoy. */
  repasadasHoy: number;
  /** Días lógicos seguidos con al menos un repaso vigente. */
  racha: number;
  /** Tarjetas vivas por área (incluye las de sus subáreas) y por subárea (solo las suyas); sin tarjetas = 0. */
  porArea: TotalPorArea[];
}

/** Tarjetas por área: el Área suma las suyas (sin subárea) más las de sus subáreas; la subárea muestra solo las suyas. */
export function totalesPorArea(areas: Area[], tarjetas: Tarjeta[]): TotalPorArea[] {
  const directas = new Map<Id, number>();
  for (const t of tarjetas) directas.set(t.area_id, (directas.get(t.area_id) ?? 0) + 1);
  const deHijas = new Map<Id, number>();
  for (const a of areas) if (a.padre_id) deHijas.set(a.padre_id, (deHijas.get(a.padre_id) ?? 0) + (directas.get(a.id) ?? 0));
  return areas.map((a) => ({ area_id: a.id, nombre: a.nombre, total: (directas.get(a.id) ?? 0) + (deHijas.get(a.id) ?? 0) }));
}

const diaDe = (iso: string): FechaISO => diaLogico({ ahora: () => new Date(iso) });

export async function calcularEstadisticas(almacen: Almacen, reloj: Reloj, opcionesCola: OpcionesCola = {}): Promise<Estadisticas> {
  const hoy = diaLogico(reloj);
  const vigentes = repasosVigentes(await almacen.repasos.listar());
  const dias = new Set(vigentes.map((r) => diaDe(r.repasado_en)));
  const repasadasHoy = vigentes.filter((r) => diaDe(r.repasado_en) === hoy).length;
  // Si hoy todavía no repasó, la racha sigue viva desde ayer (no se corta hasta que termina el día).
  let dia = dias.has(hoy) ? hoy : sumarDias(hoy, -1);
  let racha = 0;
  while (dias.has(dia)) {
    racha++;
    dia = sumarDias(dia, -1);
  }
  const tarjetas = await almacen.tarjetas.listar();
  const areas = await almacen.areas.listar();
  const porArea = totalesPorArea(areas, tarjetas);
  return { pendientesHoy: (await construirCola(almacen, reloj, opcionesCola)).length, repasadasHoy, racha, porArea };
}
