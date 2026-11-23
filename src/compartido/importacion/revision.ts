/**
 * Revisar antes de importar (P8): dice qué pasaría con el texto pegado SIN crear ni cambiar nada.
 * Sigue las mismas reglas que `importar`: mismas lecturas y validaciones (mismos mensajes), área y pregunta
 * normalizadas para decidir qué es duplicada, y los bloques se evalúan en orden (un bloque repetido dentro del
 * mismo texto cuenta como duplicado del anterior, igual que al importar).
 */
import type { Almacen } from "../almacen.ts";
import { normalizar, partirArea } from "../normalizar.ts";
import type { Reloj } from "../reloj.ts";
import { parsearTexto } from "./parseo.ts";
import { validarBloque } from "./validacion.ts";

export interface PreguntaRevisada {
  p: string;
  /** "nueva" se crearía; "duplicada" ya existe en esa área (o se repite en el texto) y se omite. */
  estado: "nueva" | "duplicada";
}

export interface BloqueRevisado {
  /** Posición del bloque dentro del texto (desde 1). */
  numero: number;
  /** Nombre del área como quedaría (la primera escritura registrada si el área ya existe). */
  area: string;
  subarea: string | null;
  /** "Área › Subárea" o "Área". */
  etiquetaArea: string;
  tema: string;
  fecha: string;
  resumen: string | null;
  preguntas: PreguntaRevisada[];
  nuevas: number;
  duplicadas: number;
  /** Duplicadas cuya respuesta es distinta (mismo texto que el informe de `importar`). */
  avisos: string[];
  /** Ninguna pregunta sería nueva: confirmar no crearía nada. */
  yaImportado: boolean;
}

export interface RevisionImportacion {
  bloques: BloqueRevisado[];
  /** Errores de lectura y de validación, con los mismos mensajes que `importar`. */
  errores: string[];
  nuevas: number;
  duplicadas: number;
  /** Hay algo para crear: solo entonces tiene sentido ofrecer "Confirmar importación". */
  puedeConfirmar: boolean;
  /** Texto pegado, sin tocar. */
  texto_original: string;
}

export async function revisarImportacion(almacen: Almacen, _reloj: Reloj, texto: string): Promise<RevisionImportacion> {
  const revision: RevisionImportacion = { bloques: [], errores: [], nuevas: 0, duplicadas: 0, puedeConfirmar: false, texto_original: texto };
  const { bloques, errores } = parsearTexto(texto);
  revision.errores.push(...errores.map((e) => e.mensaje));
  const areas = await almacen.areas.listar();
  const tarjetas = await almacen.tarjetas.listar();
  /** Preguntas ya conocidas por área hoja (clave = áreas normalizadas): las que existen y las que crearían los bloques anteriores. */
  const conocidas = new Map<string, Map<string, string>>();
  let n = 0;
  for (const crudo of bloques) {
    n++;
    const v = validarBloque(crudo);
    if (Array.isArray(v)) {
      const prefijo = bloques.length > 1 ? `Bloque ${n}: ` : "";
      revision.errores.push(...v.map((m) => prefijo + m));
      continue;
    }
    const escrita = partirArea(v.area);
    if (typeof escrita === "string") {
      revision.errores.push(escrita);
      continue;
    }
    const raiz = areas.find((a) => a.nombre_normalizado === normalizar(escrita.area) && a.padre_id === null);
    const hoja = escrita.subarea && raiz ? areas.find((a) => a.nombre_normalizado === normalizar(escrita.subarea!) && a.padre_id === raiz.id) : escrita.subarea ? undefined : raiz;
    const nombreArea = raiz?.nombre ?? escrita.area;
    const nombreSub = escrita.subarea ? (hoja?.nombre ?? escrita.subarea) : null;
    const clave = `${normalizar(escrita.area)}|${normalizar(escrita.subarea ?? "")}`;
    let vistas = conocidas.get(clave);
    if (!vistas) {
      vistas = new Map(tarjetas.filter((t) => hoja && t.area_id === hoja.id).map((t) => [normalizar(t.pregunta), t.respuesta]));
      conocidas.set(clave, vistas);
    }
    const bloque: BloqueRevisado = {
      numero: n, area: nombreArea, subarea: nombreSub, etiquetaArea: nombreSub ? `${nombreArea} › ${nombreSub}` : nombreArea,
      tema: v.tema, fecha: v.fecha, resumen: v.resumen, preguntas: [], nuevas: 0, duplicadas: 0, avisos: [], yaImportado: false,
    };
    for (const q of v.preguntas) {
      const k = normalizar(q.p);
      const previa = vistas.get(k);
      if (previa !== undefined) {
        bloque.duplicadas++;
        bloque.preguntas.push({ p: q.p, estado: "duplicada" });
        if (normalizar(previa) !== normalizar(q.r)) bloque.avisos.push(`Duplicada omitida con otra respuesta: "${q.p}". Se conservó la que ya tenías.`);
      } else {
        bloque.nuevas++;
        bloque.preguntas.push({ p: q.p, estado: "nueva" });
        vistas.set(k, q.r);
      }
    }
    bloque.yaImportado = bloque.nuevas === 0;
    revision.nuevas += bloque.nuevas;
    revision.duplicadas += bloque.duplicadas;
    revision.bloques.push(bloque);
  }
  revision.puedeConfirmar = revision.nuevas > 0;
  return revision;
}
