/** Limitador de ventana deslizante en memoria: como máximo `maximo` intentos por `ventanaMs` por clave. */
import type { Reloj } from "../compartido/reloj.ts";

export class Limitador {
  readonly #intentos = new Map<string, number[]>();

  readonly #reloj: Reloj;
  readonly #maximo: number;
  readonly #ventanaMs: number;

  constructor(reloj: Reloj, maximo = 5, ventanaMs = 60_000) {
    this.#reloj = reloj;
    this.#maximo = maximo;
    this.#ventanaMs = ventanaMs;
  }

  /** Registra un intento. Devuelve null si pasa o los segundos de espera si está bloqueado (sin registrar). */
  intentar(clave: string): number | null {
    const ahora = this.#reloj.ahora().getTime();
    const vigentes = (this.#intentos.get(clave) ?? []).filter((t) => t > ahora - this.#ventanaMs);
    if (vigentes.length >= this.#maximo) {
      this.#intentos.set(clave, vigentes);
      return Math.max(1, Math.ceil((vigentes[0]! + this.#ventanaMs - ahora) / 1000));
    }
    vigentes.push(ahora);
    this.#intentos.set(clave, vigentes);
    if (this.#intentos.size > 10_000) {
      for (const [k, v] of this.#intentos) if (v.every((t) => t <= ahora - this.#ventanaMs)) this.#intentos.delete(k);
    }
    return null;
  }
}
