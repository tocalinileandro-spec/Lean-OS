/**
 * Destino real del respaldo externo: API nativa de Backblaze B2 (v3) con `fetch`, sin dependencias.
 * Escrito de memoria: no se pudo verificar contra el servicio real (ver DECISIONES.md). Todo lo específico de B2 está acá.
 * Los errores llevan solo mensajes propios: nunca el cuerpo de la respuesta del proveedor ni las claves.
 */
import { createHash } from "node:crypto";
import type { DestinoRespaldo } from "./respaldo-externo.ts";

export class ErrorDestino extends Error {}

export interface ClavesB2 {
  keyId: string;
  appKey: string;
  /** Nombre del bucket. */
  bucket: string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const URL_AUTORIZAR = "https://api.backblazeb2.com/b2api/v3/b2_authorize_account";
const TIEMPO_MAXIMO_MS = 30_000;

interface Sesion {
  token: string;
  apiUrl: string;
  bucketId: string;
}

export class DestinoB2 implements DestinoRespaldo {
  private claves: ClavesB2;
  private pedir: Fetch;
  private prefijo: string;
  #sesion: Sesion | null = null;
  constructor(claves: ClavesB2, fetchInyectado: Fetch = (u, i) => fetch(u, i), prefijo = "lean-os-") {
    this.claves = claves;
    this.pedir = fetchInyectado;
    this.prefijo = prefijo;
  }

  async #llamar(url: string, init: RequestInit, que: string): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.pedir(url, { ...init, signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS) });
    } catch {
      throw new ErrorDestino(`No se pudo conectar con Backblaze B2 (${que}).`);
    }
    if (!res.ok) throw new ErrorDestino(`Backblaze B2 rechazó el pedido (${que}, código ${res.status}).`);
    try {
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  async #iniciar(): Promise<Sesion> {
    if (this.#sesion) return this.#sesion;
    const basico = Buffer.from(`${this.claves.keyId}:${this.claves.appKey}`).toString("base64");
    const r = await this.#llamar(URL_AUTORIZAR, { headers: { authorization: `Basic ${basico}` } }, "autorizar");
    const api = ((r["apiInfo"] as Record<string, unknown> | undefined)?.["storageApi"] ?? {}) as Record<string, unknown>;
    const token = r["authorizationToken"];
    const apiUrl = api["apiUrl"];
    if (typeof token !== "string" || typeof apiUrl !== "string") throw new ErrorDestino("Backblaze B2 respondió algo inesperado (autorizar).");
    let bucketId = typeof api["bucketId"] === "string" && api["bucketName"] === this.claves.bucket ? (api["bucketId"] as string) : "";
    if (!bucketId) {
      const lb = await this.#llamar(`${apiUrl}/b2api/v3/b2_list_buckets`, {
        method: "POST", headers: { authorization: token },
        body: JSON.stringify({ accountId: api["accountId"] ?? r["accountId"], bucketName: this.claves.bucket }),
      }, "buscar el bucket");
      const b = (lb["buckets"] as { bucketId?: unknown }[] | undefined)?.[0];
      if (typeof b?.bucketId !== "string") throw new ErrorDestino("No se encontró el bucket indicado en B2_BUCKET.");
      bucketId = b.bucketId;
    }
    this.#sesion = { token, apiUrl, bucketId };
    return this.#sesion;
  }

  /** Si algo falla se descarta la sesión: la próxima vez se autoriza de nuevo (los tokens de B2 vencen). */
  async #conSesion<T>(f: (s: Sesion) => Promise<T>): Promise<T> {
    try {
      return await f(await this.#iniciar());
    } catch (e) {
      this.#sesion = null;
      throw e;
    }
  }

  async subir(nombre: string, bytes: Uint8Array): Promise<void> {
    await this.#conSesion(async (s) => {
      const u = await this.#llamar(`${s.apiUrl}/b2api/v3/b2_get_upload_url`, {
        method: "POST", headers: { authorization: s.token }, body: JSON.stringify({ bucketId: s.bucketId }),
      }, "pedir dónde subir");
      if (typeof u["uploadUrl"] !== "string" || typeof u["authorizationToken"] !== "string") {
        throw new ErrorDestino("Backblaze B2 respondió algo inesperado (pedir dónde subir).");
      }
      await this.#llamar(u["uploadUrl"], {
        method: "POST",
        headers: {
          authorization: u["authorizationToken"],
          "x-bz-file-name": encodeURIComponent(nombre),
          "content-type": "application/octet-stream",
          "x-bz-content-sha1": createHash("sha1").update(bytes).digest("hex"),
          "content-length": String(bytes.length),
        },
        body: bytes as unknown as BodyInit,
      }, "subir");
    });
  }

  async #archivos(s: Sesion, prefijo: string): Promise<{ fileName: string; fileId: string }[]> {
    const salida: { fileName: string; fileId: string }[] = [];
    let siguiente: string | null = null;
    do {
      const r: Record<string, unknown> = await this.#llamar(`${s.apiUrl}/b2api/v3/b2_list_file_names`, {
        method: "POST", headers: { authorization: s.token },
        body: JSON.stringify({ bucketId: s.bucketId, prefix: prefijo, maxFileCount: 1000, ...(siguiente ? { startFileName: siguiente } : {}) }),
      }, "listar");
      for (const f of (r["files"] as { fileName?: unknown; fileId?: unknown }[] | undefined) ?? []) {
        if (typeof f.fileName === "string" && typeof f.fileId === "string") salida.push({ fileName: f.fileName, fileId: f.fileId });
      }
      siguiente = typeof r["nextFileName"] === "string" ? r["nextFileName"] : null;
    } while (siguiente);
    return salida;
  }

  async listar(): Promise<string[]> {
    return this.#conSesion(async (s) => (await this.#archivos(s, this.prefijo)).map((f) => f.fileName));
  }

  async borrar(nombre: string): Promise<void> {
    await this.#conSesion(async (s) => {
      for (const f of (await this.#archivos(s, nombre)).filter((x) => x.fileName === nombre)) {
        await this.#llamar(`${s.apiUrl}/b2api/v3/b2_delete_file_version`, {
          method: "POST", headers: { authorization: s.token }, body: JSON.stringify({ fileName: f.fileName, fileId: f.fileId }),
        }, "borrar");
      }
    });
  }
}
