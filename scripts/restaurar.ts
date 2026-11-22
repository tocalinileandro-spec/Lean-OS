/**
 * Restaura un respaldo JSON en la base del servidor. Uso:
 *   node scripts/restaurar.ts <archivo> [--reemplazar]
 * El archivo puede ser .json o .enc (respaldo externo cifrado; la clave va en la variable de entorno RESPALDO_CLAVE).
 * Por defecto solo restaura en un servidor VACÍO. Con --reemplazar pisa los datos (irreversible);
 * antes guarda una copia en DATA_DIR/respaldos/antes-de-restaurar-<ms>.json.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RelojReal } from "../src/compartido/reloj.ts";
import { abrirBase } from "../src/servidor/base.ts";
import { ErrorRestauracion, exportarTodo } from "../src/servidor/respaldo.ts";
import { ErrorDescifrado } from "../src/servidor/cifrado.ts";
import { restaurarDesdeBytes } from "../src/servidor/respaldo-externo.ts";

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
  const bytes = new Uint8Array(readFileSync(archivo));
  const clave = process.env["RESPALDO_CLAVE"] ?? "";
  const base = abrirBase(join(dataDir, "lean-os.sqlite"), reloj);
  if (reemplazar) {
    const carpeta = join(dataDir, "respaldos");
    mkdirSync(carpeta, { recursive: true });
    writeFileSync(join(carpeta, `antes-de-restaurar-${reloj.ahora().getTime()}.json`), JSON.stringify(exportarTodo(base, reloj)), "utf8");
  }
  const conteos = await restaurarDesdeBytes(base, bytes, { reemplazarDatos: reemplazar, clave });
  console.log("Restauración lista:", Object.entries(conteos).map(([t, n]) => `${t}=${n}`).join(", "));
} catch (e) {
  console.error(e instanceof ErrorRestauracion || e instanceof ErrorDescifrado ? e.message : "No se pudo restaurar (¿el archivo es un JSON válido?).");
  process.exit(1);
}
