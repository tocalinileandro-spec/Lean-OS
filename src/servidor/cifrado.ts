/**
 * Cifrado del respaldo externo: AES-256-GCM con clave derivada de RESPALDO_CLAVE (scrypt, sal aleatoria por archivo).
 * Formato: "LEANOS1" (7 bytes) | sal (16) | iv (12) | tag (16) | texto cifrado.
 */
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";

export const MAGIC = "LEANOS1";
const LARGO_SAL = 16;
const LARGO_IV = 12;
const LARGO_TAG = 16;
const CABECERA = MAGIC.length + LARGO_SAL + LARGO_IV + LARGO_TAG;

export class ErrorDescifrado extends Error {}

function derivar(clave: string, sal: Uint8Array): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    scrypt(clave, sal, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rechazar(e) : resolver(k)));
  });
}

/** ¿Los bytes empiezan con la marca de un respaldo cifrado de Lean OS? */
export function esRespaldoCifrado(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, MAGIC.length)).toString("latin1") === MAGIC;
}

export async function cifrarRespaldo(json: string, clave: string): Promise<Uint8Array> {
  if (!clave) throw new ErrorDescifrado("Falta la clave de cifrado (RESPALDO_CLAVE).");
  const sal = randomBytes(LARGO_SAL);
  const iv = randomBytes(LARGO_IV);
  const cifrador = createCipheriv("aes-256-gcm", await derivar(clave, sal), iv);
  const cuerpo = Buffer.concat([cifrador.update(json, "utf8"), cifrador.final()]);
  return new Uint8Array(Buffer.concat([Buffer.from(MAGIC, "latin1"), sal, iv, cifrador.getAuthTag(), cuerpo]));
}

/** Devuelve el JSON original. Con clave equivocada o archivo dañado lanza ErrorDescifrado y no devuelve nada. */
export async function descifrarRespaldo(bytes: Uint8Array, clave: string): Promise<string> {
  if (!clave) throw new ErrorDescifrado("Falta la clave de cifrado: definí RESPALDO_CLAVE.");
  if (bytes.length < CABECERA || !esRespaldoCifrado(bytes)) {
    throw new ErrorDescifrado("El archivo no es un respaldo cifrado de Lean OS.");
  }
  const b = Buffer.from(bytes);
  let o = MAGIC.length;
  const sal = b.subarray(o, (o += LARGO_SAL));
  const iv = b.subarray(o, (o += LARGO_IV));
  const tag = b.subarray(o, (o += LARGO_TAG));
  try {
    const d = createDecipheriv("aes-256-gcm", await derivar(clave, sal), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(b.subarray(o)), d.final()]).toString("utf8");
  } catch {
    throw new ErrorDescifrado("No se pudo descifrar: la clave (RESPALDO_CLAVE) es incorrecta o el archivo está dañado. No se restauró nada.");
  }
}
