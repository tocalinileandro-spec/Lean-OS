/** Ayudas de las pruebas del cliente de sincronización: servidor real (crearApp + SQLite en memoria) y clientes con fetch inyectado. */
import type { DatabaseSync } from "node:sqlite";
import { AlmacenMemoria } from "../src/compartido/almacen.ts";
import type { Almacen } from "../src/compartido/almacen.ts";
import { importar } from "../src/compartido/importacion/importar.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { AlmacenSincronizado, Candado, ColaMemoria } from "../src/cliente/sync/cola.ts";
import type { ColaCambios } from "../src/cliente/sync/cola.ts";
import { MotorSync } from "../src/cliente/sync/motor.ts";
import type { OpcionesMotor, Programador } from "../src/cliente/sync/motor.ts";
import { crearApp } from "../src/servidor/app.ts";
import { abrirBase } from "../src/servidor/base.ts";
import { hashArgon2 } from "../src/servidor/config.ts";

export const CLAVE = "clave-de-prueba-123";
export const T0 = "2026-03-10T12:00:00.000Z";

let hashCache = "";
export async function hashDePrueba(): Promise<string> {
  if (!hashCache) hashCache = await hashArgon2(CLAVE);
  return hashCache;
}

export class MemoriaPersistente {
  datos = new Map<string, string>();
  getItem(k: string) { return this.datos.get(k) ?? null; }
  setItem(k: string, v: string) { this.datos.set(k, v); }
  removeItem(k: string) { this.datos.delete(k); }
}

/** Programador falso: guarda las tareas y las corre a mano. */
export class ProgramadorFalso implements Programador {
  tareas: { f: () => void; ms: number; manija: number; cancelada: boolean }[] = [];
  esperas: number[] = [];
  #n = 0;
  programar(f: () => void, ms: number) {
    const t = { f, ms, manija: ++this.#n, cancelada: false };
    this.tareas.push(t);
    this.esperas.push(ms);
    return t.manija;
  }
  cancelar(m: unknown) {
    const t = this.tareas.find((x) => x.manija === m);
    if (t) t.cancelada = true;
  }
  activas() { return this.tareas.filter((t) => !t.cancelada); }
}

export interface Servidor {
  app: ReturnType<typeof crearApp>;
  db: DatabaseSync;
}

export async function crearServidor(reloj: RelojSimulado): Promise<Servidor> {
  const db = abrirBase(":memory:", reloj);
  const app = crearApp({ reloj, base: db, secretos: { passwordHash: await hashDePrueba(), sessionSecret: "s" }, registrar: () => {} });
  return { app, db };
}

export function contar(db: DatabaseSync, tabla: string, where = ""): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${tabla} ${where}`).get() as { n: number }).n;
}

export function fila(db: DatabaseSync, tabla: string, id: string): Record<string, any> | undefined {
  const f = db.prepare(`SELECT datos FROM ${tabla} WHERE id = ?`).get(id) as { datos: string } | undefined;
  return f ? JSON.parse(f.datos) : undefined;
}

/** El "mundo" de una prueba: un reloj, un servidor que se puede cambiar y la red que se puede cortar. */
export class Entorno {
  reloj = new RelojSimulado(T0);
  servidor!: Servidor;
  red = true;
  llamadas: string[] = [];
  enVuelo = 0;
  maxEnVuelo = 0;

  static async crear(): Promise<Entorno> {
    const e = new Entorno();
    e.servidor = await crearServidor(e.reloj);
    return e;
  }

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (!this.red) throw new TypeError("fetch failed");
    this.llamadas.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
    this.enVuelo++;
    this.maxEnVuelo = Math.max(this.maxEnVuelo, this.enVuelo);
    try {
      return await this.servidor.app.request(url, init);
    } finally {
      this.enVuelo--;
    }
  };

  cliente(opciones: Partial<OpcionesMotor> & { almacenCrudo?: Almacen; cola?: ColaCambios } = {}) {
    const crudo = opciones.almacenCrudo ?? new AlmacenMemoria();
    const cola = opciones.cola ?? new ColaMemoria();
    const persistencia = (opciones.persistencia as MemoriaPersistente | undefined) ?? new MemoriaPersistente();
    const programador = new ProgramadorFalso();
    let motor: MotorSync | undefined;
    const candado = new Candado();
    const almacen = new AlmacenSincronizado(crudo, cola, {
      candado,
      alCambiar: () => motor?.cambioLocal(),
      alFallarCola: () => motor?.pedirSubidaCompleta(),
    });
    motor = new MotorSync({
      almacen: crudo, cola, fetch: this.fetch, reloj: this.reloj, persistencia, programador, candado, ...opciones,
    });
    return { motor, almacen, crudo, cola, persistencia, programador };
  }
}

export type Cliente = ReturnType<Entorno["cliente"]>;

export async function entrar(c: Cliente): Promise<void> {
  const r = await c.motor.iniciarSesion(CLAVE);
  if (!r.ok) throw new Error(r.mensaje);
  await c.motor.esperar();
}

export function bloque(n: number, area = "Programación > CS50", tema = "Funciones"): string {
  return JSON.stringify({
    tipo: "aprendizaje", fecha: "2026-03-10", area, tema, resumen: "Resumen de ejemplo.",
    preguntas: Array.from({ length: n }, (_, i) => ({ p: `Pregunta ${tema} ${i + 1}`, r: `Respuesta ${i + 1}` })),
  });
}

export async function cargarTarjetas(almacen: Almacen, reloj: RelojSimulado, n: number, area?: string, tema?: string) {
  const inf = await importar(almacen, reloj, bloque(n, area, tema));
  if (inf.creadas !== n) throw new Error(`Se esperaban ${n} tarjetas creadas y fueron ${inf.creadas}`);
}
