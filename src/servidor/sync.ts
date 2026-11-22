/**
 * Sincronización del lado servidor: push idempotente con reglas de conflicto, pull por rev
 * y protección contra borrado masivo. Todo síncrono sobre SQLite y dentro de una transacción.
 *
 * Diseño S5: el protocolo no tiene ninguna orden de "borrá esto" salvo registros con
 * deleted_at (borrado lógico, que el cliente aplica como cualquier otro dato). Un pull vacío
 * (servidor vacío) devuelve listas vacías y no implica nada para el cliente.
 */
import type { DatabaseSync } from "node:sqlite";
import { TABLAS } from "../compartido/esquema.ts";
import type { Tabla } from "../compartido/esquema.ts";
import type { Reloj } from "../compartido/reloj.ts";

import { validarRegistro } from "../compartido/respaldo-formato.ts";
import type { Fila } from "../compartido/respaldo-formato.ts";

export type { Fila };
export { validarRegistro };

export const TOLERANCIA_FUTURO_MS = 5 * 60_000;
/** Si el push dejaría borradas más de esta fracción de las tarjetas vivas, se pide confirmación. */
export const UMBRAL_BORRADO_MASIVO = 0.2;
export const MAX_CAMBIOS_POR_PUSH = 20_000;

const GRUPO_CONTENIDO = ["pregunta", "respuesta", "pista", "area_id", "suspendida", "deleted_at"] as const;
const GRUPO_REPASO = ["ease", "intervalo", "reps", "lapses", "vence"] as const;
const GRUPOS = [
  { nombre: "contenido", marca: "contenido_updated_at", campos: GRUPO_CONTENIDO },
  { nombre: "repaso", marca: "repaso_updated_at", campos: GRUPO_REPASO },
] as const;

export interface Cambio {
  tabla: Tabla;
  registro: Fila;
}

export interface Conflicto {
  tabla: Tabla;
  id: string;
  motivo: string;
}

export interface ResultadoPush {
  /** Cambios que modificaron el servidor (reenviar algo ya aplicado da 0). */
  aceptados: number;
  rev: number;
  conflictos: Conflicto[];
}

export interface PedidoConfirmacion {
  requiere_confirmacion: true;
  tarjetas_vivas: number;
  tarjetas_a_borrar: number;
  mensaje: string;
}

const ms = (v: unknown): number => Date.parse(String(v));
const esFecha = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const esObjeto = (v: unknown): v is Fila => typeof v === "object" && v !== null && !Array.isArray(v);

/** Valida el cuerpo de push. Devuelve los cambios tipados o un mensaje de error en castellano. */
export function validarPush(cuerpo: unknown): { cambios: Cambio[]; confirmar: boolean } | { error: string } {
  if (!esObjeto(cuerpo)) return { error: "El cuerpo debe ser un objeto JSON." };
  const lista = cuerpo["cambios"];
  if (!Array.isArray(lista)) return { error: "Falta la lista de cambios." };
  if (lista.length > MAX_CAMBIOS_POR_PUSH) return { error: "Son demasiados cambios en una sola sincronización." };
  const conf = cuerpo["confirmar_borrado_masivo"];
  if (conf !== undefined && typeof conf !== "boolean") return { error: "confirmar_borrado_masivo debe ser verdadero o falso." };
  const cambios: Cambio[] = [];
  for (let i = 0; i < lista.length; i++) {
    const c: unknown = lista[i];
    if (!esObjeto(c) || !(TABLAS as readonly unknown[]).includes(c["tabla"])) {
      return { error: `El cambio ${i + 1} tiene una tabla desconocida.` };
    }
    const tabla = c["tabla"] as Tabla;
    const motivo = validarRegistro(tabla, c["registro"]);
    if (motivo) return { error: `El cambio ${i + 1} es inválido: ${motivo}.` };
    cambios.push({ tabla, registro: c["registro"] as Fila });
  }
  return { cambios, confirmar: conf === true };
}

// ---------- acceso a filas ----------

export function revActual(db: DatabaseSync): number {
  return (db.prepare("SELECT valor FROM contador_rev WHERE id = 1").get() as { valor: number }).valor;
}

function siguienteRev(db: DatabaseSync): number {
  db.prepare("UPDATE contador_rev SET valor = valor + 1 WHERE id = 1").run();
  return revActual(db);
}

export function fijarRev(db: DatabaseSync, valor: number): void {
  db.prepare("UPDATE contador_rev SET valor = ? WHERE id = 1").run(valor);
}

function leer(db: DatabaseSync, tabla: Tabla, id: string): Fila | null {
  const f = db.prepare(`SELECT datos FROM ${tabla} WHERE id = ?`).get(id) as { datos: string } | undefined;
  return f ? (JSON.parse(f.datos) as Fila) : null;
}

/** Inserta o reemplaza una fila. El registro ya trae su rev. */
export function guardarFila(db: DatabaseSync, tabla: Tabla, r: Fila): void {
  const esTarjeta = tabla === "tarjetas";
  const cols = ["id", "rev", "updated_at", "deleted_at", ...(esTarjeta ? ["contenido_updated_at", "repaso_updated_at"] : []), "datos"];
  const valores = [
    r["id"] as string,
    r["rev"] as number,
    r["updated_at"] as string,
    (r["deleted_at"] as string | null | undefined) ?? null,
    ...(esTarjeta ? [r["contenido_updated_at"] as string, r["repaso_updated_at"] as string] : []),
    JSON.stringify(r),
  ];
  db.prepare(`INSERT OR REPLACE INTO ${tabla} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...valores);
}

export function filasDesde(db: DatabaseSync, tabla: Tabla, desde: number, limite: number): Fila[] {
  const filas = db.prepare(`SELECT datos FROM ${tabla} WHERE rev > ? ORDER BY rev LIMIT ?`).all(desde, limite) as { datos: string }[];
  return filas.map((f) => JSON.parse(f.datos) as Fila);
}

export function contarFilas(db: DatabaseSync, tabla: Tabla): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number }).n;
}

// ---------- comparación ----------

function estable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(estable).join(",")}]`;
  if (esObjeto(v)) {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${estable(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

function sinMarcas(r: Fila): Fila {
  const c = { ...r };
  delete c["rev"];
  delete c["updated_at"];
  return c;
}

function iguales(a: Fila, b: Fila, campos: readonly string[]): boolean {
  return campos.every((k) => estable(a[k] ?? null) === estable(b[k] ?? null));
}

// ---------- push ----------

class Aplicador {
  aceptados = 0;
  conflictos: Conflicto[] = [];
  private db: DatabaseSync;
  private ahoraMs: number;
  constructor(db: DatabaseSync, ahoraMs: number) {
    this.db = db;
    this.ahoraMs = ahoraMs;
  }

  private acotar(r: Fila): Fila {
    const c = { ...r };
    for (const k of ["updated_at", "deleted_at", "contenido_updated_at", "repaso_updated_at"]) {
      if (typeof c[k] === "string" && ms(c[k]) > this.ahoraMs + TOLERANCIA_FUTURO_MS) c[k] = new Date(this.ahoraMs).toISOString();
    }
    return c;
  }

  /** Toda versión perdedora distinta de la ganadora queda guardada (el llamador ya comprobó que difiere). */
  private perdio(tabla: Tabla, id: string, version: unknown, motivo: string): void {
    this.db
      .prepare("INSERT INTO registro_sync (tabla, registro_id, version_perdedora, cuando, motivo) VALUES (?, ?, ?, ?, ?)")
      .run(tabla, id, JSON.stringify(version), new Date(this.ahoraMs).toISOString(), motivo);
    this.conflictos.push({ tabla, id, motivo });
  }

  private escribir(tabla: Tabla, r: Fila): void {
    guardarFila(this.db, tabla, { ...r, rev: siguienteRev(this.db) });
    this.aceptados++;
  }

  aplicar({ tabla, registro }: Cambio): void {
    const n = this.acotar(registro);
    const id = n["id"] as string;
    const e = leer(this.db, tabla, id);
    if (!e) return this.escribir(tabla, n);
    if (tabla === "repasos") {
      // Solo se agregan: idéntico = reenvío (se ignora); distinto = se conserva el del servidor y el otro queda registrado.
      if (estable(sinMarcas(e)) !== estable(sinMarcas(n))) this.perdio(tabla, id, n, "repaso repetido con contenido distinto; se conservó el del servidor");
      return;
    }
    if (tabla === "tarjetas") return this.fusionarTarjeta(e, n);

    if (estable(sinMarcas(e)) === estable(sinMarcas(n))) return; // mismo contenido: reenvío
    if (ms(n["updated_at"]) > ms(e["updated_at"])) {
      this.perdio(tabla, id, e, "ganó la edición más reciente; se guardó la versión anterior del servidor");
      this.escribir(tabla, n);
    } else {
      this.perdio(tabla, id, n, "se conservó la versión del servidor (más reciente o empate)");
    }
  }

  private fusionarTarjeta(e: Fila, n: Fila): void {
    const r: Fila = { ...e };
    let cambio = false;
    for (const g of GRUPOS) {
      if (iguales(e, n, g.campos)) continue; // mismo contenido: nada que fusionar
      const grupo = (x: Fila) => ({ grupo: g.nombre, [g.marca]: x[g.marca], ...Object.fromEntries(g.campos.map((k) => [k, x[k] ?? null])) });
      if (ms(n[g.marca]) > ms(e[g.marca])) {
        this.perdio("tarjetas", e["id"] as string, grupo(e), `ganó el grupo ${g.nombre} más reciente; se guardó el anterior del servidor`);
        for (const k of g.campos) r[k] = n[k] ?? null;
        r[g.marca] = n[g.marca];
        cambio = true;
      } else {
        this.perdio("tarjetas", e["id"] as string, grupo(n), `se conservó el grupo ${g.nombre} del servidor (más reciente o empate)`);
      }
    }
    if (!cambio) return;
    r["updated_at"] = ms(n["updated_at"]) > ms(e["updated_at"]) ? n["updated_at"] : e["updated_at"];
    this.escribir("tarjetas", r);
  }
}

function vivas(db: DatabaseSync): Set<string> {
  const filas = db.prepare("SELECT id FROM tarjetas WHERE deleted_at IS NULL").all() as { id: string }[];
  return new Set(filas.map((f) => f.id));
}

/** Aplica todo o nada. Devuelve el resultado o un pedido de confirmación (sin haber aplicado nada). */
export function aplicarPush(
  db: DatabaseSync,
  reloj: Reloj,
  cambios: Cambio[],
  confirmarBorradoMasivo: boolean,
): { ok: true; resultado: ResultadoPush } | { ok: false; pedido: PedidoConfirmacion } {
  db.exec("BEGIN");
  try {
    const antes = vivas(db);
    const ap = new Aplicador(db, reloj.ahora().getTime());
    for (const c of cambios) ap.aplicar(c);
    if (!confirmarBorradoMasivo && antes.size > 0) {
      const despues = vivas(db);
      let aBorrar = 0;
      for (const id of antes) if (!despues.has(id)) aBorrar++;
      // Se rechaza si se borra al menos 1 y más del 20 % de las vivas (con pocas tarjetas el porcentaje cuenta igual).
      if (aBorrar >= 1 && aBorrar / antes.size > UMBRAL_BORRADO_MASIVO) {
        db.exec("ROLLBACK");
        return {
          ok: false,
          pedido: {
            requiere_confirmacion: true,
            tarjetas_vivas: antes.size,
            tarjetas_a_borrar: aBorrar,
            mensaje: `Esta sincronización borraría ${aBorrar} de ${antes.size} tarjetas. No se aplicó nada: confirmala a mano si es lo que querés.`,
          },
        };
      }
    }
    const resultado = { aceptados: ap.aceptados, rev: revActual(db), conflictos: ap.conflictos };
    db.exec("COMMIT");
    return { ok: true, resultado };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// ---------- pull ----------

export const LIMITE_PULL = 500;
export const LIMITE_PULL_MAXIMO = 5000;

export type RespuestaPull = { rev: number; hay_mas: boolean } & Record<Tabla, Fila[]>;

/** Todo lo que tenga rev > since (incluidos borrados). Si hay más que `limite`, `rev` es el cursor para seguir. */
export function leerPull(db: DatabaseSync, since: number, limite: number): RespuestaPull {
  const todas: { tabla: Tabla; r: Fila }[] = [];
  for (const tabla of TABLAS) for (const r of filasDesde(db, tabla, since, limite + 1)) todas.push({ tabla, r });
  todas.sort((a, b) => (a.r["rev"] as number) - (b.r["rev"] as number));
  const hayMas = todas.length > limite;
  const pagina = todas.slice(0, limite);
  const salida = { rev: hayMas ? (pagina[pagina.length - 1]?.r["rev"] as number) : revActual(db), hay_mas: hayMas } as RespuestaPull;
  for (const t of TABLAS) salida[t] = [];
  for (const { tabla, r } of pagina) salida[tabla].push(r);
  return salida;
}
