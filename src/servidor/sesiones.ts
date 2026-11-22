/** Sesiones de un solo usuario: token firmado con HMAC (SESSION_SECRET) y registro en SQLite para poder invalidarlas. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Reloj } from "../compartido/reloj.ts";

export const VIGENCIA_MS = 30 * 86_400_000;

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
const firmar = (secreto: string, id: string): string => createHmac("sha256", secreto).update(id).digest("base64url");

export class Sesiones {
  readonly #db: DatabaseSync;
  readonly #reloj: Reloj;
  readonly #secreto: string;

  constructor(db: DatabaseSync, reloj: Reloj, secreto: string) {
    this.#db = db;
    this.#reloj = reloj;
    this.#secreto = secreto;
  }

  crear(): { token: string; expiraEn: number } {
    const ahora = this.#reloj.ahora().getTime();
    this.#db.prepare("DELETE FROM sesiones WHERE expira_en <= ?").run(ahora);
    const id = randomBytes(32).toString("base64url");
    const expiraEn = ahora + VIGENCIA_MS;
    this.#db
      .prepare("INSERT INTO sesiones (id_hash, creada_en, expira_en, ultimo_uso) VALUES (?, ?, ?, ?)")
      .run(sha256(id), ahora, expiraEn, ahora);
    return { token: `${id}.${firmar(this.#secreto, id)}`, expiraEn };
  }

  /** Valida el token y, si sirve, renueva la vigencia 30 días desde ahora. */
  validar(token: string): boolean {
    const id = this.#idFirmado(token);
    if (id === null) return false;
    const ahora = this.#reloj.ahora().getTime();
    const fila = this.#db.prepare("SELECT expira_en FROM sesiones WHERE id_hash = ?").get(sha256(id)) as
      | { expira_en: number }
      | undefined;
    if (!fila) return false;
    if (fila.expira_en <= ahora) {
      this.#db.prepare("DELETE FROM sesiones WHERE id_hash = ?").run(sha256(id));
      return false;
    }
    this.#db
      .prepare("UPDATE sesiones SET expira_en = ?, ultimo_uso = ? WHERE id_hash = ?")
      .run(ahora + VIGENCIA_MS, ahora, sha256(id));
    return true;
  }

  invalidar(token: string): void {
    const id = this.#idFirmado(token);
    if (id !== null) this.#db.prepare("DELETE FROM sesiones WHERE id_hash = ?").run(sha256(id));
  }

  #idFirmado(token: string): string | null {
    const partes = token.split(".");
    if (partes.length !== 2) return null;
    const [id, firma] = partes as [string, string];
    const esperada = Buffer.from(firmar(this.#secreto, id));
    const recibida = Buffer.from(firma);
    if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;
    return id;
  }
}
