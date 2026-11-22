/** Purga de la papelera (30 días) ejecutada por la app: al abrir y como mucho una vez por día lógico. Es local: no se anota en la cola de sync. */
import type { Almacen } from "../compartido/almacen.ts";
import { diaLogico } from "../compartido/dia.ts";
import { purgarPapelera } from "../compartido/gestion.ts";
import type { Reloj } from "../compartido/reloj.ts";

/**
 * Devuelve una función que purga si todavía no se purgó en el día lógico actual.
 * Nunca lanza: un fallo de la purga no debe romper nada (se reintenta en la próxima llamada).
 */
export function crearPurgaDiaria(almacen: Almacen, reloj: Reloj): () => Promise<void> {
  let ultimoDia: string | null = null;
  return async () => {
    try {
      const hoy = diaLogico(reloj);
      if (hoy === ultimoDia) return;
      await purgarPapelera(almacen, reloj);
      ultimoDia = hoy;
    } catch {
      // La purga es de mantenimiento: si falla, la app sigue y se reintenta después.
    }
  };
}

const CADA_HORA_MS = 3_600_000;

/** Purga ahora y vuelve a chequear cada hora (la función de arriba la limita a una por día lógico). */
export async function iniciarPurga(almacen: Almacen, reloj: Reloj): Promise<void> {
  const purgar = crearPurgaDiaria(almacen, reloj);
  await purgar();
  setInterval(() => void purgar(), CADA_HORA_MS);
}
