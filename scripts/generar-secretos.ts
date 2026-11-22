/**
 * Genera los secretos del servidor. Uso:
 *   node scripts/generar-secretos.ts                 (pide la contraseña por stdin, sin mostrarla)
 *   echo "mi clave" | node scripts/generar-secretos.ts
 *   LEAN_OS_PASSWORD="mi clave" node scripts/generar-secretos.ts
 *   node scripts/generar-secretos.ts "mi clave"      (queda en el historial de la terminal; preferí las otras)
 * Imprime SOLO dos líneas NOMBRE=valor (APP_PASSWORD_HASH y SESSION_SECRET), listas para
 *   fly secrets set APP_PASSWORD_HASH='...' SESSION_SECRET='...'
 * Nunca imprime la contraseña. Cambiar la contraseña = volver a correr el script y cargar el hash nuevo.
 */
import { randomBytes } from "node:crypto";
import { hashArgon2 } from "../src/servidor/config.ts";

async function leerStdin(): Promise<string> {
  let texto = "";
  for await (const parte of process.stdin) texto += parte;
  return texto.replace(/\r?\n$/, "");
}

if (process.argv[2] === undefined && !process.env["LEAN_OS_PASSWORD"] && process.stdin.isTTY) {
  console.error("Escribí la contraseña y apretá Enter (no se muestra en la salida):");
}
const contrasena = process.argv[2] ?? process.env["LEAN_OS_PASSWORD"] ?? (await leerStdin());
if (contrasena.length < 8) {
  console.error("La contraseña debe tener al menos 8 caracteres.");
  process.exit(1);
}
console.log(`APP_PASSWORD_HASH=${await hashArgon2(contrasena)}`);
console.log(`SESSION_SECRET=${randomBytes(32).toString("base64url")}`);
