/**
 * Limpieza y parseo del texto pegado (sección 3). Devuelve cada bloque por separado.
 * La limpieza conserva el largo del texto (reemplaza por espacios), así las posiciones
 * de error coinciden con el texto original pegado.
 */

export interface ErrorLectura {
  mensaje: string;
  /** Posición aproximada (0 = primer carácter) en el texto pegado. */
  posicion: number;
}

export interface ResultadoParseo {
  /** Bloques leídos (cualquier JSON; la validación es aparte). */
  bloques: unknown[];
  errores: ErrorLectura[];
}

const ABRE_DOBLE = "“„«";
const CIERRA_DOBLE = "”»";

/** Quita cercas de código, pasa comillas tipográficas a rectas y borra comas finales. */
export function limpiar(texto: string): string {
  // Cercas: ```json y ``` (se reemplazan por espacios, mismo largo)
  let t = texto.replace(/```[a-zA-Z]*/g, (m) => " ".repeat(m.length));
  const u = t.split(""); // por unidades UTF-16, igual que los índices de string
  let cierre: string | null = null; // delimitador esperado si estamos dentro de un string
  for (let i = 0; i < u.length; i++) {
    const c = u[i]!;
    if (cierre !== null) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === cierre || (cierre === "”" && c === '"')) {
        u[i] = '"';
        cierre = null;
      }
      continue;
    }
    if (c === '"') cierre = '"';
    else if (ABRE_DOBLE.includes(c)) {
      u[i] = '"';
      cierre = "”";
    } else if (CIERRA_DOBLE.includes(c)) {
      u[i] = '"'; // comilla de cierre suelta: tratarla como recta
      cierre = '"';
    } else if (c === ",") {
      let j = i + 1;
      while (j < u.length && /\s/.test(u[j]!)) j++;
      if (j < u.length && (u[j] === "}" || u[j] === "]")) u[i] = " ";
    }
  }
  t = u.join("");
  return t;
}

function lineaColumna(texto: string, pos: number): string {
  const antes = texto.slice(0, pos);
  const linea = antes.split("\n").length;
  const col = pos - (antes.lastIndexOf("\n") + 1) + 1;
  return `línea ${linea}, columna ${col}`;
}

/** Busca el final del valor que empieza en `ini` ({...} o [...]). -1 si está cortado. */
function finDelValor(t: string, ini: number): number {
  let prof = 0;
  let enString = false;
  for (let i = ini; i < t.length; i++) {
    const c = t[i]!;
    if (enString) {
      if (c === "\\") i++;
      else if (c === '"') enString = false;
      continue;
    }
    if (c === '"') enString = true;
    else if (c === "{" || c === "[") prof++;
    else if (c === "}" || c === "]") {
      prof--;
      if (prof === 0) return i;
    }
  }
  return -1;
}

export function parsearTexto(original: string): ResultadoParseo {
  const t = limpiar(original);
  const bloques: unknown[] = [];
  const errores: ErrorLectura[] = [];
  const err = (posicion: number, detalle: string) =>
    errores.push({ posicion, mensaje: `No pude leer el JSON: ${detalle} (cerca de la posición ${posicion}, ${lineaColumna(original, posicion)}). Revisá comillas, comas y llaves.` });

  if (t.trim() === "") {
    errores.push({ posicion: 0, mensaje: "No pegaste nada todavía." });
    return { bloques, errores };
  }

  let i = 0;
  while (i < t.length) {
    if (/\s/.test(t[i]!)) {
      i++;
      continue;
    }
    if (t[i] !== "{" && t[i] !== "[") {
      err(i, `se esperaba "{" o "[" y hay "${t[i]}"`);
      // salteamos hasta el próximo comienzo plausible
      const sig = t.slice(i).search(/[{[]/);
      if (sig <= 0) break;
      i += sig;
      continue;
    }
    const fin = finDelValor(t, i);
    if (fin < 0) {
      err(t.length, "el texto parece cortado: falta cerrar una llave o un corchete");
      break;
    }
    const trozo = t.slice(i, fin + 1);
    try {
      const valor: unknown = JSON.parse(trozo);
      if (Array.isArray(valor)) bloques.push(...valor);
      else bloques.push(valor);
    } catch (e) {
      const m = /position (\d+)/.exec(e instanceof Error ? e.message : "");
      err(i + (m ? Number(m[1]) : 0), "formato inválido");
    }
    i = fin + 1;
  }
  return { bloques, errores };
}
