/** Lee la configuración del servidor desde variables de entorno. Nunca imprime valores secretos. */
import { argon2id } from "hash-wasm";
import { randomBytes } from "node:crypto";

export interface Secretos {
  /** Hash argon2id codificado de la contraseña de la app. */
  passwordHash: string;
  /** Clave para firmar los tokens de sesión. */
  sessionSecret: string;
}

/** Claves del respaldo externo opcional: solo hay respaldo si están las cuatro. */
export interface ClavesRespaldo {
  b2KeyId: string;
  b2AppKey: string;
  b2Bucket: string;
  /** Clave de cifrado (RESPALDO_CLAVE). */
  clave: string;
}

export function leerClavesRespaldo(env: Record<string, string | undefined>): ClavesRespaldo | null {
  const b2KeyId = env["B2_KEY_ID"], b2AppKey = env["B2_APP_KEY"], b2Bucket = env["B2_BUCKET"], clave = env["RESPALDO_CLAVE"];
  if (!b2KeyId || !b2AppKey || !b2Bucket || !clave) return null;
  return { b2KeyId, b2AppKey, b2Bucket, clave };
}

export interface Config {
  puerto: number;
  dataDir: string;
  secretos: Secretos;
  produccion: boolean;
  /** Ausente = respaldo externo sin configurar (no es un error). */
  respaldoExterno: ClavesRespaldo | null;
  /** GROQ_API_KEY opcional: ausente = entrada por audio sin configurar (no es un error). */
  groqApiKey: string | null;
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
    respaldoExterno: leerClavesRespaldo(env),
    groqApiKey: env["GROQ_API_KEY"] || null,
  };
}
