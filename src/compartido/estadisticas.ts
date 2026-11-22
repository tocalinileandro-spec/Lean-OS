/** Estadísticas mínimas (módulo 1). Funciones puras sobre el Almacén y el reloj. */
import type { Almacen } from "./almacen.ts";
import { diaLogico } from "./dia.ts";
import type { FechaISO, Id } from "./esquema.ts";
import { construirCola, repasosVigentes, sumarDias } from "./repaso.ts";
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

const diaDe = (iso: string): FechaISO => diaLogico({ ahora: () => new Date(iso) });

export async function calcularEstadisticas(almacen: Almacen, reloj: Reloj): Promise<Estadisticas> {
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
  const directas = new Map<Id, number>();
  for (const t of tarjetas) directas.set(t.area_id, (directas.get(t.area_id) ?? 0) + 1);
  // El Área suma las suyas (sin subárea) más las de sus subáreas; la subárea muestra solo las suyas.
  const porArea = areas.map((a) => ({
    area_id: a.id, nombre: a.nombre,
    total: (directas.get(a.id) ?? 0) + areas.filter((h) => h.padre_id === a.id).reduce((n, h) => n + (directas.get(h.id) ?? 0), 0),
  }));
  return { pendientesHoy: (await construirCola(almacen, reloj)).length, repasadasHoy, racha, porArea };
}
