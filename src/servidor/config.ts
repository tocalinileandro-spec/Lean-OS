/** Lee la configuración del servidor desde variables de entorno. Nunca imprime valores secretos. */
import { argon2id } from "hash-wasm";
import { randomBytes } from "node:crypto";

export interface Secretos {
  /** Hash argon2id codificado de la contraseña de la app. */
  passwordHash: string;
  /** Clave para firmar los tokens de sesión. */
  sessionSecret: string;
}

export interface Config {
  puerto: number;
  dataDir: string;
  secretos: Secretos;
  produccion: boolean;
}

export const CONTRASENA_DE_DESARROLLO = "desarrollo";

export async function hashArgon2(contrasena: string): Promise<string> {
  return argon2id({
    password: contrasena,
    salt: randomBytes(16),
    parallelism: 1,
    iterations: 3,
    memorySize: 19456, // 19 MiB (recomendación OWASP)
    hashLength: 32,
    outputType: "encoded",
  });
}

export async function leerConfig(
  env: Record<string, string | undefined>,
  avisar: (mensaje: string) => void = console.warn,
): Promise<Config> {
  const produccion = env["NODE_ENV"] === "production";
  let passwordHash = env["APP_PASSWORD_HASH"] || undefined;
  let sessionSecret = env["SESSION_SECRET"] || undefined;

  if (produccion) {
    const faltan = [!passwordHash && "APP_PASSWORD_HASH", !sessionSecret && "SESSION_SECRET"].filter(Boolean);
    if (faltan.length > 0) {
      throw new Error(
        `Falta configurar ${faltan.join(" y ")}. Corré "node scripts/generar-secretos.ts" y cargá el resultado con "fly secrets set".`,
      );
    }
  } else {
    if (!passwordHash) {
      passwordHash = await hashArgon2(CONTRASENA_DE_DESARROLLO);
      avisar(`APP_PASSWORD_HASH no está definido: se usa una contraseña local de desarrollo ("${CONTRASENA_DE_DESARROLLO}").`);
    }
    if (!sessionSecret) {
      sessionSecret = "secreto-local-de-desarrollo-no-usar-en-produccion";
      avisar("SESSION_SECRET no está definido: se usa un valor local de desarrollo.");
    }
  }

  const puerto = Number(env["PORT"] ?? 8080);
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
    throw new Error("PORT debe ser un número de puerto válido (1 a 65535).");
  }
  return {
    puerto,
    dataDir: env["DATA_DIR"] || "./datos-servidor",
    secretos: { passwordHash: passwordHash as string, sessionSecret: sessionSecret as string },
    produccion,
  };
}
