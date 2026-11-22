import type { FechaISO } from "../esquema.ts";

export interface PreguntaValida {
  p: string;
  r: string;
  pista: string | null;
}

export interface BloqueValido {
  tipo: "aprendizaje";
  fecha: FechaISO;
  area: string;
  tema: string;
  resumen: string | null;
  preguntas: PreguntaValida[];
}

export function esFechaReal(f: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f);
  if (!m) return false;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const x = new Date(Date.UTC(a, mes - 1, d));
  return x.getUTCFullYear() === a && x.getUTCMonth() === mes - 1 && x.getUTCDate() === d;
}

const vacio = (v: unknown) => typeof v !== "string" || v.trim() === "";

/** Valida un bloque. Devuelve el bloque limpio o la lista de errores (nombrando el campo). */
export function validarBloque(b: unknown): BloqueValido | string[] {
  if (typeof b !== "object" || b === null || Array.isArray(b)) return ["Cada bloque tiene que ser un objeto entre llaves { ... }."];
  const o = b as Record<string, unknown>;

  if (vacio(o.tipo)) return ['Falta el campo "tipo" (tiene que ser "aprendizaje").'];
  if (String(o.tipo).trim() !== "aprendizaje") return [`Tipo no soportado: ${String(o.tipo)}`];

  const errores: string[] = [];
  if (vacio(o.fecha)) errores.push('Falta el campo "fecha" (formato AAAA-MM-DD).');
  else if (!esFechaReal((o.fecha as string).trim())) errores.push(`El campo "fecha" no es una fecha válida AAAA-MM-DD: ${String(o.fecha)}.`);
  if (vacio(o.area)) errores.push('Falta el campo "area".');
  if (vacio(o.tema)) errores.push('Falta el campo "tema".');
  if (o.resumen !== undefined && o.resumen !== null && typeof o.resumen !== "string") errores.push('El campo "resumen" tiene que ser texto.');

  const preguntas: PreguntaValida[] = [];
  if (!Array.isArray(o.preguntas) || o.preguntas.length === 0) {
    errores.push('Falta el campo "preguntas" (una lista con al menos una pregunta).');
  } else {
    o.preguntas.forEach((q: unknown, i: number) => {
      const n = i + 1;
      if (typeof q !== "object" || q === null || Array.isArray(q)) {
        errores.push(`La pregunta ${n} tiene que ser un objeto con "p" y "r".`);
        return;
      }
      const qq = q as Record<string, unknown>;
      let ok = true;
      if (vacio(qq.p)) {
        errores.push(`En la pregunta ${n}, el campo "p" falta o está vacío.`);
        ok = false;
      }
      if (vacio(qq.r)) {
        errores.push(`En la pregunta ${n}, el campo "r" falta o está vacío.`);
        ok = false;
      }
      if (ok) {
        const pista = typeof qq.pista === "string" && qq.pista.trim() !== "" ? qq.pista.trim() : null;
        preguntas.push({ p: (qq.p as string).trim(), r: (qq.r as string).trim(), pista });
      }
    });
  }
  if (errores.length > 0) return errores;
  return {
    tipo: "aprendizaje",
    fecha: (o.fecha as string).trim(),
    area: (o.area as string).trim(),
    tema: (o.tema as string).trim(),
    resumen: typeof o.resumen === "string" && o.resumen.trim() !== "" ? o.resumen.trim() : null,
    preguntas,
  };
}
