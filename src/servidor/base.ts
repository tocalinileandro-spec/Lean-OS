/**
 * SQLite del servidor (node:sqlite) con migraciones versionadas.
 * Antes de migrar una base existente se copia el archivo; si la migración falla,
 * se restaura la copia y se lanza el error (el servidor no arranca).
 */
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Reloj } from "../compartido/reloj.ts";

export interface Migracion {
  version: number;
  /** SQL (puede traer varias sentencias) o función que usa la base abierta. */
  aplicar: string | ((db: DatabaseSync) => void);
}

/** Tablas de datos del servidor (versión 2). Se repite acá a propósito: una migración nunca cambia después de publicada. */
const TABLAS_V2 = ["tarjetas", "repasos", "areas", "metas", "tareas", "apuntes", "importaciones"];

/** Migraciones del servidor. */
export const MIGRACIONES: readonly Migracion[] = [
  {
    version: 1,
    aplicar: `
      CREATE TABLE sesiones (
        id_hash TEXT PRIMARY KEY,
        creada_en INTEGER NOT NULL,
        expira_en INTEGER NOT NULL,
        ultimo_uso INTEGER NOT NULL
      );
    `,
  },
  {
    version: 2,
    aplicar: (db) => {
      for (const t of TABLAS_V2) {
        const extra = t === "tarjetas" ? ", contenido_updated_at TEXT NOT NULL, repaso_updated_at TEXT NOT NULL" : "";
        db.exec(`
          CREATE TABLE ${t} (
            id TEXT PRIMARY KEY,
            rev INTEGER NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT${extra},
            datos TEXT NOT NULL
          );
          CREATE INDEX ${t}_rev ON ${t} (rev);
        `);
      }
      db.exec(`
        CREATE TABLE contador_rev (id INTEGER PRIMARY KEY CHECK (id = 1), valor INTEGER NOT NULL);
        INSERT INTO contador_rev (id, valor) VALUES (1, 0);
        CREATE TABLE registro_sync (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tabla TEXT NOT NULL,
          registro_id TEXT NOT NULL,
          version_perdedora TEXT NOT NULL,
          cuando TEXT NOT NULL,
          motivo TEXT NOT NULL
        );
      `);
    },
  },
];

export function versionActual(db: DatabaseSync): number {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const fila = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null } | undefined;
  return fila?.v ?? 0;
}

export function abrirBase(
  ruta: string,
  reloj: Reloj,
  migraciones: readonly Migracion[] = MIGRACIONES,
): DatabaseSync {
  const enMemoria = ruta === ":memory:";
  if (!enMemoria) mkdirSync(dirname(ruta), { recursive: true });
  const existia = !enMemoria && existsSync(ruta);
  let db = new DatabaseSync(ruta);
  const actual = versionActual(db);
  const pendientes = migraciones.filter((m) => m.version > actual).sort((a, b) => a.version - b.version);
  if (pendientes.length === 0) return db;

  let respaldo: string | null = null;
  if (existia && actual > 0) {
    db.close();
    respaldo = join(dirname(ruta), "respaldos-migracion", `v${actual}-${reloj.ahora().getTime()}.sqlite`);
    mkdirSync(dirname(respaldo), { recursive: true });
    copyFileSync(ruta, respaldo);
    db = new DatabaseSync(ruta);
  }

  try {
    for (const m of pendientes) {
      db.exec("BEGIN");
      try {
        if (typeof m.aplicar === "string") db.exec(m.aplicar);
        else m.aplicar(db);
        db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(m.version);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
  } catch (e) {
    db.close();
    if (respaldo) copyFileSync(respaldo, ruta);
    const motivo = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Falló la migración de la base de datos (${motivo}). ${respaldo ? "Se restauró el respaldo previo y " : ""}el servidor no arranca.`,
    );
  }
  return db;
}
