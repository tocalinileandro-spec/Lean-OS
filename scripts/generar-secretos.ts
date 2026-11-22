/**
 * Genera los secretos del servidor. Uso:
 *   node scripts/generar-secretos.ts                 (pide la contraseña por stdin, sin mostrarla)
 *   echo "mi clave" | node scripts/generar-secretos.ts
 *   LEAN_OS_PASSWORD="mi clave" node scripts/generar-secretos.ts
 *   node scripts/generar-secretos.ts "mi clave"      (queda en el historial de la terminal; preferí las otras)
 * Imprime SOLO dos líneas NOMBRE=valor (APP_PASSWORD_HASH y SESSION_SECRET), listas para
 *   fly secrets set APP_PASSWORD_HASH='...' SESSION_SECRET='...'
 * Con --con-respaldo agrega una tercera línea RESPALDO_CLAVE=... (32 bytes aleatorios en base64) para el respaldo externo
 * opcional. Guardá esa clave también fuera de Fly: sin ella el respaldo externo no se puede abrir.
 * Nunca imprime la contraseña. Cambiar la contraseña = volver a correr el script y cargar el hash nuevo.
 */
import { randomBytes } from "node:crypto";
import { hashArgon2 } from "../src/servidor/config.ts";

async function leerStdin(): Promise<string> {
  let texto = "";
  for await (const parte of process.stdin) texto += parte;
  return texto.replace(/\r?\n$/, "");
}

const conRespaldo = process.argv.includes("--con-respaldo");
const argumentos = process.argv.slice(2).filter((a) => a !== "--con-respaldo");

if (argumentos[0] === undefined && !process.env["LEAN_OS_PASSWORD"] && process.stdin.isTTY) {
  console.error("Escribí la contraseña y apretá Enter (no se muestra en la salida):");
}
const contrasena = argumentos[0] ?? process.env["LEAN_OS_PASSWORD"] ?? (await leerStdin());
if (contrasena.length < 8) {
  console.error("La contraseña debe tener al menos 8 caracteres.");
  process.exit(1);
}
console.log(`APP_PASSWORD_HASH=${await hashArgon2(contrasena)}`);
console.log(`SESSION_SECRET=${randomBytes(32).toString("base64url")}`);
if (conRespaldo) console.log(`RESPALDO_CLAVE=${randomBytes(32).toString("base64")}`);
