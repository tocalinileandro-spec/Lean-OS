/**
 * Regla de fusión del cliente: la misma que aplica el servidor (src/servidor/sync.ts).
 * Gana el más reciente por grupo de campos; en tarjetas, por grupo contenido y grupo de repaso.
 * Nunca se borra nada: solo se elige entre dos versiones de un registro.
 */
import type { Tabla } from "../../compartido/esquema.ts";
import type { Fila } from "../../compartido/respaldo-formato.ts";

const GRUPOS = [
  { marca: "contenido_updated_at", campos: ["pregunta", "respuesta", "pista", "area_id", "suspendida", "deleted_at"] },
  { marca: "repaso_updated_at", campos: ["ease", "intervalo", "reps", "lapses", "vence"] },
] as const;

export interface Fusion {
  /** Versión resultante (con el `rev` del entrante si trae uno). */
  registro: Fila;
  /** La versión resultante difiere de la local (incluido el rev): hay que escribirla. */
  cambio: boolean;
  /** Difiere de la local en algo que no es el rev. */
  cambioContenido: boolean;
  /** La versión resultante tiene algo más reciente que el entrante: hay que subirla al servidor. */
  subir: boolean;
}

const ms = (v: unknown): number => Date.parse(String(v));
const esObjeto = (v: unknown): v is Fila => typeof v === "object" && v !== null && !Array.isArray(v);

function estable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(estable).join(",")}]`;
  if (esObjeto(v)) {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${estable(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

const iguales = (a: Fila, b: Fila, campos: readonly string[]): boolean => campos.every((k) => estable(a[k] ?? null) === estable(b[k] ?? null));

function sinMarcas(r: Fila): Fila {
  const c = { ...r };
  delete c["rev"];
  delete c["updated_at"];
  return c;
}

function sinRev(r: Fila): Fila {
  const c = { ...r };
  delete c["rev"];
  return c;
}

/**
 * Fusiona `entrante` (del servidor o de un respaldo) con `local`.
 * `empate`: quién gana si las marcas de tiempo son iguales pero el contenido difiere. Con el servidor gana el
 * servidor (así ambos lados convergen); al importar un respaldo gana lo local (no se pisa nada).
 * No se usa con repasos (solo se agregan).
 */
export function fusionar(tabla: Tabla, local: Fila | undefined, entrante: Fila, empate: "entrante" | "local"): Fusion {
  if (!local) return { registro: { ...entrante }, cambio: true, cambioContenido: true, subir: false };
  const rev = entrante["rev"] ?? local["rev"] ?? null;
  let registro: Fila;
  let subir = false;

  if (tabla === "tarjetas") {
    registro = { ...local };
    for (const g of GRUPOS) {
      if (iguales(local, entrante, g.campos)) continue;
      const dif = ms(entrante[g.marca]) - ms(local[g.marca]);
      if (dif > 0 || (dif === 0 && empate === "entrante")) {
        for (const k of g.campos) registro[k] = entrante[k] ?? null;
        registro[g.marca] = entrante[g.marca];
      }
    }
    registro["updated_at"] = ms(entrante["updated_at"]) > ms(local["updated_at"]) ? entrante["updated_at"] : local["updated_at"];
    subir = GRUPOS.some((g) => !iguales(registro, entrante, g.campos));
  } else if (estable(sinMarcas(local)) === estable(sinMarcas(entrante))) {
    registro = { ...local };
  } else {
    const dif = ms(entrante["updated_at"]) - ms(local["updated_at"]);
    if (dif > 0 || (dif === 0 && empate === "entrante")) registro = { ...entrante };
    else {
      registro = { ...local };
      subir = true;
    }
  }
  registro["rev"] = rev;
  return {
    registro,
    cambio: estable(registro) !== estable(local),
    cambioContenido: estable(sinRev(registro)) !== estable(sinRev(local)),
    subir,
  };
}
