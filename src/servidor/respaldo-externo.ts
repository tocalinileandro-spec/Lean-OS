/**
 * Respaldo externo opcional (O1-O6): copia CIFRADA del export completo a un destino de terceros (Backblaze B2).
 * Viene desactivado: sin activarlo en Ajustes y sin las cuatro claves no se hace ninguna llamada de red.
 * Nunca lanza hacia afuera ni registra claves, contenido o respuestas del proveedor.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Reloj } from "../compartido/reloj.ts";
import type { ClavesRespaldo } from "./config.ts";
import { cifrarRespaldo, descifrarRespaldo, esRespaldoCifrado } from "./cifrado.ts";
import { DestinoB2, ErrorDestino } from "./destino-b2.ts";
import { exportarTodo, fechaDeRespaldo, respaldarAhora, restaurarRespaldo, ErrorRestauracion, RESPALDOS_A_CONSERVAR } from "./respaldo.ts";
import type { OpcionesRestauracion } from "./respaldo.ts";
import type { Tabla } from "../compartido/esquema.ts";

export interface DestinoRespaldo {
  subir(nombre: string, bytes: Uint8Array): Promise<void>;
  /** Nombres de los respaldos de Lean OS que hay en el destino. */
  listar(): Promise<string[]>;
  borrar(nombre: string): Promise<void>;
}

export interface UltimoResultado {
  cuando: string;
  ok: boolean;
  mensaje: string;
}

const CLAVE_ACTIVO = "respaldo_externo_activo";
const CLAVE_ULTIMO = "respaldo_externo_ultimo";
const PATRON_NOMBRE = /^lean-os-\d{4}-\d{2}-\d{2}\.json\.enc$/;
export const nombreRespaldoExterno = (instante: Date) => `lean-os-${fechaDeRespaldo(instante)}.json.enc`;

export function leerAjuste(db: DatabaseSync, clave: string): unknown {
  const f = db.prepare("SELECT valor FROM ajustes_servidor WHERE clave = ?").get(clave) as { valor: string } | undefined;
  if (!f) return undefined;
  try {
    return JSON.parse(f.valor);
  } catch {
    return undefined;
  }
}

export function guardarAjuste(db: DatabaseSync, clave: string, valor: unknown): void {
  db.prepare("INSERT INTO ajustes_servidor (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor").run(clave, JSON.stringify(valor));
}

export interface OpcionesServicio {
  db: DatabaseSync;
  reloj: Reloj;
  /** Claves del entorno; null = falta configurar. */
  claves: ClavesRespaldo | null;
  /** Fábrica del destino (por defecto B2 real). Solo se llama cuando de verdad hay que subir. */
  crearDestino?: (c: ClavesRespaldo) => DestinoRespaldo;
  registrar?: (linea: string) => void;
  /** Tiempo máximo de todo el respaldo externo. */
  tiempoMaximoMs?: number;
}

export class ServicioRespaldoExterno {
  private o: OpcionesServicio;
  constructor(opciones: OpcionesServicio) {
    this.o = opciones;
  }

  activo(): boolean {
    return leerAjuste(this.o.db, CLAVE_ACTIVO) === true;
  }
  fijarActivo(valor: boolean): void {
    guardarAjuste(this.o.db, CLAVE_ACTIVO, valor);
  }
  configurado(): boolean {
    return this.o.claves !== null;
  }
  ultimoResultado(): UltimoResultado | null {
    const v = leerAjuste(this.o.db, CLAVE_ULTIMO) as Partial<UltimoResultado> | undefined;
    if (!v || typeof v.cuando !== "string" || typeof v.ok !== "boolean" || typeof v.mensaje !== "string") return null;
    return { cuando: v.cuando, ok: v.ok, mensaje: v.mensaje };
  }

  #anotar(ok: boolean, mensaje: string): UltimoResultado {
    const r = { cuando: this.o.reloj.ahora().toISOString(), ok, mensaje };
    try {
      guardarAjuste(this.o.db, CLAVE_ULTIMO, r);
    } catch {
      /* no puede romper nada */
    }
    (this.o.registrar ?? ((l: string) => console.log(l)))(`Respaldo externo: ${ok ? "listo" : "falló"}.`);
    return r;
  }

  /** Sube una copia cifrada ahora y aplica la retención. No mira el interruptor (lo mira quien llama). Nunca lanza. */
  async subirAhora(): Promise<UltimoResultado> {
    const claves = this.o.claves;
    if (!claves) return this.#anotar(false, "Falta configurar el respaldo externo: faltan claves en el servidor (B2_KEY_ID, B2_APP_KEY, B2_BUCKET y RESPALDO_CLAVE).");
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    try {
      const destino = (this.o.crearDestino ?? ((c) => new DestinoB2({ keyId: c.b2KeyId, appKey: c.b2AppKey, bucket: c.b2Bucket })))(claves);
      const trabajo = (async () => {
        const bytes = await cifrarRespaldo(JSON.stringify(exportarTodo(this.o.db, this.o.reloj)), claves.clave);
        await destino.subir(nombreRespaldoExterno(this.o.reloj.ahora()), bytes);
        const nombres = (await destino.listar()).filter((n) => PATRON_NOMBRE.test(n)).sort();
        for (const n of nombres.slice(0, Math.max(0, nombres.length - RESPALDOS_A_CONSERVAR))) await destino.borrar(n);
      })();
      const limite = new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(() => rechazar(new ErrorDestino("El destino no respondió a tiempo.")), this.o.tiempoMaximoMs ?? 120_000);
        temporizador.unref?.();
      });
      trabajo.catch(() => {}); // si gana el límite, el rechazo tardío no queda sin atender
      await Promise.race([trabajo, limite]);
      return this.#anotar(true, "Se subió el respaldo externo cifrado.");
    } catch (e) {
      const detalle = e instanceof ErrorDestino ? ` ${e.message}` : "";
      return this.#anotar(false, `No se pudo subir el respaldo externo.${detalle} El respaldo local sí se hizo; se reintenta en la próxima corrida.`);
    } finally {
      if (temporizador) clearTimeout(temporizador);
    }
  }

  /** Respaldo nocturno: siempre el local; el externo solo si está activado. Nunca lanza. */
  async nocturno(carpeta: string): Promise<void> {
    try {
      respaldarAhora(this.o.db, carpeta, this.o.reloj);
      (this.o.registrar ?? ((l: string) => console.log(l)))("Respaldo nocturno escrito.");
    } catch {
      console.error("Falló el respaldo nocturno local.");
    }
    if (!this.activo()) return; // O1: desactivado = ninguna llamada a terceros
    await this.subirAhora();
  }
}

/** Restaura desde bytes de un `.json` o de un `.enc` (con la clave). Con clave mala no toca la base. */
export async function restaurarDesdeBytes(
  db: DatabaseSync,
  bytes: Uint8Array,
  opciones: OpcionesRestauracion & { clave?: string } = {},
): Promise<Record<Tabla, number>> {
  let texto: string;
  if (esRespaldoCifrado(bytes)) texto = await descifrarRespaldo(bytes, opciones.clave ?? "");
  else texto = Buffer.from(bytes).toString("utf8");
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new ErrorRestauracion("El archivo no es un respaldo válido (no es JSON).");
  }
  return restaurarRespaldo(db, datos, { reemplazarDatos: opciones.reemplazarDatos === true });
}
