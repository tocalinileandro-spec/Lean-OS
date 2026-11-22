/** Exportación completa, restauración (G4), respaldo nocturno con retención y su planificador. */
import type { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TABLAS } from "../compartido/esquema.ts";
import type { Tabla } from "../compartido/esquema.ts";
import type { Reloj } from "../compartido/reloj.ts";
import { armarExportacion, validarExportacion, VERSION_FORMATO } from "../compartido/respaldo-formato.ts";
import type { Exportacion, Fila } from "../compartido/respaldo-formato.ts";
import { contarFilas, filasDesde, fijarRev, guardarFila, revActual } from "./sync.ts";

export { VERSION_FORMATO };
export type { Exportacion };
export const RESPALDOS_A_CONSERVAR = 30;

export function exportarTodo(db: DatabaseSync, reloj: Reloj): Exportacion {
  const tablas = {} as Record<Tabla, Fila[]>;
  for (const t of TABLAS) tablas[t] = filasDesde(db, t, -1, Number.MAX_SAFE_INTEGER);
  return armarExportacion(tablas, revActual(db), reloj.ahora());
}

export function contarTodo(db: DatabaseSync): Record<Tabla, number> {
  const c = {} as Record<Tabla, number>;
  for (const t of TABLAS) c[t] = contarFilas(db, t);
  return c;
}

export class ErrorRestauracion extends Error {}

export interface OpcionesRestauracion {
  /** Permite restaurar aunque el servidor tenga datos: los REEMPLAZA (irreversible). Por defecto se niega. */
  reemplazarDatos?: boolean;
}

/** Restaura un export a un servidor vacío (conserva ids y revs). Todo o nada. */
export function restaurarRespaldo(db: DatabaseSync, datos: unknown, opciones: OpcionesRestauracion = {}): Record<Tabla, number> {
  const v = validarExportacion(datos, true);
  if ("error" in v) throw new ErrorRestauracion(v.error);
  const d = v.exportacion;
  const hayDatos = TABLAS.some((t) => contarFilas(db, t) > 0);
  if (hayDatos && !opciones.reemplazarDatos) {
    throw new ErrorRestauracion("El servidor ya tiene datos: no se restaura encima. Restaurá en un servidor vacío o pedí el reemplazo explícito.");
  }
  db.exec("BEGIN");
  try {
    let maxRev = typeof d.rev === "number" ? d.rev : 0;
    for (const t of TABLAS) {
      db.exec(`DELETE FROM ${t}`);
      for (const r of d.tablas[t]) {
        guardarFila(db, t, r);
        maxRev = Math.max(maxRev, r["rev"] as number);
      }
    }
    fijarRev(db, maxRev);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return contarTodo(db);
}

// ---------- respaldo nocturno ----------

/** Fecha AAAA-MM-DD en Buenos Aires (UTC-3 todo el año, sin horario de verano). */
export function fechaDeRespaldo(instante: Date): string {
  return new Date(instante.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

const PATRON = /^respaldo-\d{4}-\d{2}-\d{2}\.json$/;

/** Escribe el JSON completo del día y conserva solo los últimos 30. Devuelve la ruta. */
export function respaldarAhora(db: DatabaseSync, carpeta: string, reloj: Reloj): string {
  mkdirSync(carpeta, { recursive: true });
  const ruta = join(carpeta, `respaldo-${fechaDeRespaldo(reloj.ahora())}.json`);
  const tmp = `${ruta}.tmp`;
  writeFileSync(tmp, JSON.stringify(exportarTodo(db, reloj)), "utf8");
  renameSync(tmp, ruta);
  const viejos = readdirSync(carpeta).filter((f) => PATRON.test(f)).sort();
  for (const f of viejos.slice(0, Math.max(0, viejos.length - RESPALDOS_A_CONSERVAR))) rmSync(join(carpeta, f), { force: true });
  return ruta;
}

/** Próxima 03:00 de Buenos Aires (06:00 UTC) estrictamente posterior a `ahora`. */
export function proximoRespaldo(ahora: Date): Date {
  const dia = Math.floor(ahora.getTime() / 86_400_000) * 86_400_000;
  let t = dia + 6 * 3_600_000;
  if (t <= ahora.getTime()) t += 86_400_000;
  return new Date(t);
}

export type Programar = (accion: () => void, ms: number) => unknown;

/** Corre `accion` una vez por día a las 03:00 (Buenos Aires), con reloj y temporizador inyectados. */
export class PlanificadorDiario {
  #timer: unknown = null;
  #activo = false;
  constructor(
    private reloj: Reloj,
    private accion: () => void,
    private programar: Programar = (f, ms) => {
      const t = setTimeout(f, ms);
      t.unref();
      return t;
    },
    private cancelar: (t: unknown) => void = (t) => clearTimeout(t as NodeJS.Timeout),
    private alFallar: (e: unknown) => void = () => {},
  ) {}

  iniciar(): void {
    this.#activo = true;
    this.#armar();
  }

  detener(): void {
    this.#activo = false;
    if (this.#timer !== null) this.cancelar(this.#timer);
    this.#timer = null;
  }

  #armar(): void {
    if (!this.#activo) return;
    const espera = proximoRespaldo(this.reloj.ahora()).getTime() - this.reloj.ahora().getTime();
    this.#timer = this.programar(() => {
      try {
        this.accion();
      } catch (e) {
        this.alFallar(e);
      }
      this.#armar();
    }, espera);
  }
}
