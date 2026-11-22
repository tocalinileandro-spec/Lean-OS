/**
 * Entrada por audio opcional (O7-O12): el servidor reenvía el audio a Groq (Whisper) para transcribirlo y lo descarta.
 * Viene desactivado. El audio vive solo en memoria durante la petición: no se escribe en disco, base ni registros.
 * La clave (GROQ_API_KEY) solo existe acá: nunca se devuelve ni se registra.
 */
import type { DatabaseSync } from "node:sqlite";
import { guardarAjuste, leerAjuste } from "./respaldo-externo.ts";

export const TIPOS_AUDIO = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"] as const;
export const AUDIO_MAXIMO_BYTES = 10 * 1024 * 1024;
export const URL_GROQ = "https://api.groq.com/openai/v1/audio/transcriptions";
export const MODELO_GROQ = "whisper-large-v3-turbo";

export type MotivoFallo = "cuota" | "tiempo" | "fallo";

/** Fallo del proveedor. El mensaje nunca lleva el cuerpo de la respuesta ni claves. */
export class ErrorProveedor extends Error {
  motivo: MotivoFallo;
  constructor(motivo: MotivoFallo) {
    super(motivo);
    this.name = "ErrorProveedor";
    this.motivo = motivo;
  }
}

export interface ProveedorTranscripcion {
  transcribir(audio: Uint8Array, tipo: string): Promise<string>;
}

const EXTENSION: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav" };

/**
 * Implementación real. Detalles de la API de Groq escritos de memoria (endpoint compatible con OpenAI:
 * multipart con file, model, language, response_format; respuesta {text}). No verificado contra el servicio real.
 */
export class ProveedorGroq implements ProveedorTranscripcion {
  #clave: string;
  #fetch: typeof fetch;
  #tiempoMs: number;
  constructor(clave: string, opciones: { fetch?: typeof fetch; tiempoMs?: number } = {}) {
    this.#clave = clave;
    this.#fetch = opciones.fetch ?? ((...a) => fetch(...a));
    this.#tiempoMs = opciones.tiempoMs ?? 30_000;
  }

  async transcribir(audio: Uint8Array, tipo: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([audio as BlobPart], { type: tipo }), `audio.${EXTENSION[tipo] ?? "webm"}`);
    form.append("model", MODELO_GROQ);
    form.append("language", "es");
    form.append("response_format", "json");
    let res: Response;
    try {
      res = await this.#fetch(URL_GROQ, {
        method: "POST",
        headers: { authorization: `Bearer ${this.#clave}` },
        body: form,
        signal: AbortSignal.timeout(this.#tiempoMs),
      });
    } catch (e) {
      const nombre = e instanceof Error ? e.name : "";
      throw new ErrorProveedor(nombre === "TimeoutError" || nombre === "AbortError" ? "tiempo" : "fallo");
    }
    if (res.status === 429) throw new ErrorProveedor("cuota");
    if (!res.ok) throw new ErrorProveedor("fallo");
    try {
      const datos = (await res.json()) as { text?: unknown };
      if (typeof datos.text !== "string") throw new Error("forma");
      return datos.text.trim();
    } catch {
      throw new ErrorProveedor("fallo");
    }
  }
}

const CLAVE_ACTIVO = "audio_activo";

export interface OpcionesAudio {
  db: DatabaseSync;
  /** GROQ_API_KEY; null = falta configurar. Solo se usa para saber si está; el proveedor la lleva aparte. */
  hayClave: boolean;
  proveedor: ProveedorTranscripcion | null;
}

export class ServicioAudio {
  #o: OpcionesAudio;
  constructor(opciones: OpcionesAudio) {
    this.#o = opciones;
  }
  activo(): boolean {
    return leerAjuste(this.#o.db, CLAVE_ACTIVO) === true;
  }
  fijarActivo(valor: boolean): void {
    guardarAjuste(this.#o.db, CLAVE_ACTIVO, valor);
  }
  configurado(): boolean {
    return this.#o.hayClave && this.#o.proveedor !== null;
  }
  async transcribir(audio: Uint8Array, tipo: string): Promise<string> {
    if (!this.#o.proveedor) throw new ErrorProveedor("fallo");
    return this.#o.proveedor.transcribir(audio, tipo);
  }
}
