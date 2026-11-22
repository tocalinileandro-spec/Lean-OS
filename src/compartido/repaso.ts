/**
 * Repaso espaciado (sección 2 de la visión, estilo SM-2). Lógica pura (`calificar`) y operaciones
 * sobre el Almacén (`calificarYGuardar`, `deshacerCalificacion`, `construirCola`) con reloj inyectado.
 */
import type { Almacen } from "./almacen.ts";
import { diaLogico, diaLogicoDeInstante } from "./dia.ts";
import {
  EASE_MINIMO, INTERVALO_MAXIMO_DIAS, NUEVAS_POR_DIA,
  type Calificacion, type FechaISO, type Id, type Repaso, type Tarjeta,
} from "./esquema.ts";
import type { Reloj } from "./reloj.ts";

export type EstadoRepaso = Pick<Tarjeta, "ease" | "intervalo" | "reps" | "lapses" | "vence">;

const redondear2 = (x: number) => Math.round(x * 100) / 100;
/** Mitad hacia arriba; el redondeo previo a 6 decimales absorbe el error de coma flotante. */
const redondearEntero = (x: number) => Math.round(Math.round(x * 1e6) / 1e6);
const tope = (d: number) => Math.min(INTERVALO_MAXIMO_DIAS, d);

/** Suma días a una fecha local AAAA-MM-DD (aritmética de calendario, sin husos). */
export function sumarDias(fecha: FechaISO, dias: number): FechaISO {
  const [a, m, d] = fecha.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Calcula el nuevo estado de repaso. `hoy` es el día lógico actual. No muta la tarjeta. */
export function calificar(t: EstadoRepaso, boton: Calificacion, hoy: FechaISO): EstadoRepaso {
  let { ease, intervalo, reps, lapses } = t;
  switch (boton) {
    case "otra_vez":
      intervalo = 0; reps = 0; lapses += 1; ease = Math.max(EASE_MINIMO, redondear2(ease - 0.2));
      break;
    case "dificil":
      intervalo = tope(Math.max(1, redondearEntero(intervalo * 1.2)));
      ease = Math.max(EASE_MINIMO, redondear2(ease - 0.15));
      reps += 1;
      break;
    case "bien":
      intervalo = tope(reps === 0 ? 1 : reps === 1 ? 3 : Math.max(1, redondearEntero(intervalo * ease)));
      reps += 1;
      break;
    case "facil":
      intervalo = tope(reps === 0 ? 4 : Math.max(1, redondearEntero(intervalo * ease * 1.3)));
      ease = redondear2(ease + 0.15);
      reps += 1;
      break;
  }
  return { ease, intervalo, reps, lapses, vence: sumarDias(hoy, intervalo) };
}

const nuevoId = (): Id => crypto.randomUUID();

export interface ResultadoCalificacion {
  /** Tarjeta ya guardada con el estado nuevo. */
  tarjeta: Tarjeta;
  /** Estado previo, para deshacer. */
  anterior: Tarjeta;
  repaso: Repaso;
}

/** Califica, guarda la tarjeta y agrega el repaso, en el momento (una sola transacción lógica por tabla). */
export async function calificarYGuardar(almacen: Almacen, reloj: Reloj, tarjetaId: Id, boton: Calificacion): Promise<ResultadoCalificacion> {
  const anterior = await almacen.tarjetas.obtener(tarjetaId);
  if (!anterior || anterior.deleted_at !== null) throw new Error(`Tarjeta inexistente: ${tarjetaId}`);
  const ahora = reloj.ahora().toISOString();
  const estado = calificar(anterior, boton, diaLogico(reloj));
  const tarjeta: Tarjeta = { ...anterior, ...estado, updated_at: ahora, repaso_updated_at: ahora };
  const repaso: Repaso = {
    id: nuevoId(), created_at: ahora, updated_at: ahora, deleted_at: null, rev: null,
    tarjeta_id: tarjetaId, calificacion: boton, repasado_en: ahora,
    ease_antes: anterior.ease, ease_despues: tarjeta.ease,
    intervalo_antes: anterior.intervalo, intervalo_despues: tarjeta.intervalo,
    anula_a: null,
  };
  // El repaso primero: si se corta en el medio, queda registro y la tarjeta sigue vencida (no se pierde nada).
  await almacen.repasos.agregar(repaso);
  await almacen.tarjetas.guardar(tarjeta);
  return { tarjeta, anterior, repaso };
}

/**
 * Deshace una calificación: restaura el estado de repaso anterior de la tarjeta y agrega un repaso
 * compensatorio (`anula_a`) con los valores invertidos. El registro de repasos solo agrega.
 */
export async function deshacerCalificacion(almacen: Almacen, reloj: Reloj, r: ResultadoCalificacion): Promise<Tarjeta> {
  const ahora = reloj.ahora().toISOString();
  const { ease, intervalo, reps, lapses, vence } = r.anterior;
  const actual = await almacen.tarjetas.obtener(r.anterior.id);
  if (!actual) throw new Error(`Tarjeta inexistente: ${r.anterior.id}`);
  const tarjeta: Tarjeta = { ...actual, ease, intervalo, reps, lapses, vence, updated_at: ahora, repaso_updated_at: ahora };
  await almacen.repasos.agregar({
    id: nuevoId(), created_at: ahora, updated_at: ahora, deleted_at: null, rev: null,
    tarjeta_id: r.anterior.id, calificacion: r.repaso.calificacion, repasado_en: ahora,
    ease_antes: r.repaso.ease_despues, ease_despues: r.repaso.ease_antes,
    intervalo_antes: r.repaso.intervalo_despues, intervalo_despues: r.repaso.intervalo_antes,
    anula_a: r.repaso.id,
  });
  await almacen.tarjetas.guardar(tarjeta);
  return tarjeta;
}

/** Repasos que cuentan: sin los compensatorios ni los anulados. */
export function repasosVigentes(repasos: Repaso[]): Repaso[] {
  const anulados = new Set(repasos.map((r) => r.anula_a).filter((x): x is Id => !!x));
  return repasos.filter((r) => !r.anula_a && !anulados.has(r.id));
}

export const esNueva = (t: Tarjeta) => t.intervalo === 0 && t.reps === 0 && t.lapses === 0;

export interface OpcionesCola {
  limiteNuevas?: number;
}

/**
 * Cola del día: vencidas (más atrasadas primero) y después nuevas hasta el límite diario.
 * Las nuevas ya repasadas hoy (su primer repaso vigente cayó hoy) descuentan del límite.
 * Excluye suspendidas y borradas; lo que vence mañana no entra.
 */
export async function construirCola(almacen: Almacen, reloj: Reloj, opciones: OpcionesCola = {}): Promise<Tarjeta[]> {
  const limite = opciones.limiteNuevas ?? NUEVAS_POR_DIA;
  const hoy = diaLogico(reloj);
  const tarjetas = (await almacen.tarjetas.listar()).filter((t) => !t.suspendida);
  const vigentes = repasosVigentes(await almacen.repasos.listar());
  const primero = new Map<Id, string>();
  for (const r of vigentes) {
    const p = primero.get(r.tarjeta_id);
    if (p === undefined || r.repasado_en < p) primero.set(r.tarjeta_id, r.repasado_en);
  }
  const nuevasHoy = tarjetas.filter((t) => {
    const p = primero.get(t.id);
    return p !== undefined && diaLogicoDeInstante(p) === hoy;
  }).length;
  const vencidas = tarjetas
    .filter((t) => !esNueva(t) && t.vence <= hoy)
    .sort((a, b) => (a.vence < b.vence ? -1 : a.vence > b.vence ? 1 : 0));
  const cupo = Math.max(0, limite - nuevasHoy);
  // Calificación a medias (corte entre guardar el repaso y la tarjeta): estado de nueva pero con repaso vigente.
  // La tarjeta en curso vuelve a la cola como pendiente de hoy, sin gastar cupo.
  const interrumpidas = tarjetas.filter((t) => esNueva(t) && primero.has(t.id));
  const nuevas = tarjetas
    .filter((t) => esNueva(t) && !primero.has(t.id))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
    .slice(0, cupo);
  return [...vencidas, ...interrumpidas, ...nuevas];
}

/** Sesión de repaso: cola en memoria; "Otra vez" reencola al final. Cada calificación se guarda al instante. */
export class SesionRepaso {
  #cola: Id[];
  #historial: { res: ResultadoCalificacion; colaAntes: Id[] }[] = [];

  private almacen: Almacen;
  private reloj: Reloj;

  constructor(almacen: Almacen, reloj: Reloj, cola: Tarjeta[]) {
    this.almacen = almacen;
    this.reloj = reloj;
    this.#cola = cola.map((t) => t.id);
  }

  get pendientes(): number { return this.#cola.length; }
  get actualId(): Id | undefined { return this.#cola[0]; }

  /** Descarta del frente las tarjetas borradas o suspendidas durante la sesión y devuelve la actual. */
  async siguiente(): Promise<Id | undefined> {
    while (this.#cola.length > 0) {
      const t = await this.almacen.tarjetas.obtener(this.#cola[0]!);
      if (t && t.deleted_at === null && !t.suspendida) return t.id;
      this.#cola.shift();
    }
    return undefined;
  }

  async calificar(boton: Calificacion): Promise<ResultadoCalificacion> {
    const id = await this.siguiente();
    if (id === undefined) throw new Error("La cola está vacía");
    const colaAntes = [...this.#cola];
    const res = await calificarYGuardar(this.almacen, this.reloj, id, boton);
    this.#cola.shift();
    if (boton === "otra_vez") this.#cola.push(id);
    this.#historial.push({ res, colaAntes });
    return res;
  }

  /** Ctrl+Z: deshace la última calificación de la sesión. Devuelve false si no hay nada para deshacer. */
  async deshacer(): Promise<boolean> {
    const h = this.#historial.pop();
    if (!h) return false;
    await deshacerCalificacion(this.almacen, this.reloj, h.res);
    this.#cola = h.colaAntes;
    return true;
  }
}
