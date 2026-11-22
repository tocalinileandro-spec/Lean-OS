/**
 * Restaura un respaldo JSON en la base del servidor. Uso:
 *   node scripts/restaurar.ts <archivo> [--reemplazar]
 * Por defecto solo restaura en un servidor VACÍO. Con --reemplazar pisa los datos (irreversible);
 * antes guarda una copia en DATA_DIR/respaldos/antes-de-restaurar-<ms>.json.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RelojReal } from "../src/compartido/reloj.ts";
import { abrirBase } from "../src/servidor/base.ts";
import { ErrorRestauracion, exportarTodo, restaurarRespaldo } from "../src/servidor/respaldo.ts";

const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith("--"));
const reemplazar = args.includes("--reemplazar");
if (!archivo) {
  console.error("Uso: node scripts/restaurar.ts <archivo> [--reemplazar]");
  process.exit(2);
}
try {
  const reloj = new RelojReal();
  const dataDir = process.env["DATA_DIR"] || "./datos-servidor";
  const base = abrirBase(join(dataDir, "lean-os.sqlite"), reloj);
  const datos: unknown = JSON.parse(readFileSync(archivo, "utf8"));
  if (reemplazar) {
    const carpeta = join(dataDir, "respaldos");
    mkdirSync(carpeta, { recursive: true });
    writeFileSync(join(carpeta, `antes-de-restaurar-${reloj.ahora().getTime()}.json`), JSON.stringify(exportarTodo(base, reloj)), "utf8");
  }
  const conteos = restaurarRespaldo(base, datos, { reemplazarDatos: reemplazar });
  console.log("Restauración lista:", Object.entries(conteos).map(([t, n]) => `${t}=${n}`).join(", "));
} catch (e) {
  console.error(e instanceof ErrorRestauracion ? e.message : "No se pudo restaurar (¿el archivo es un JSON válido?).");
  process.exit(1);
}
