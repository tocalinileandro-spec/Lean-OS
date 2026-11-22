/** Importar bloques JSON de tipo "aprendizaje" (sección 2 y 3 de la visión). */
import type { Almacen } from "../almacen.ts";
import { diaLogico } from "../dia.ts";
import { EASE_INICIAL, type Apunte, type Area, type Id, type Importacion, type Tarjeta } from "../esquema.ts";
import { normalizar, partirArea } from "../normalizar.ts";
import type { Reloj } from "../reloj.ts";
import { parsearTexto } from "./parseo.ts";
import { validarBloque, type BloqueValido } from "./validacion.ts";

export interface InformeImportacion {
  creadas: number;
  duplicadas: number;
  /** Mensajes en castellano; nombran el campo o la posición. */
  errores: string[];
  /** Por ejemplo, duplicadas cuya respuesta es distinta. */
  avisos: string[];
  /** Texto pegado, sin tocar: la pantalla lo deja en la caja si hubo errores. */
  texto_original: string;
}

export interface OpcionesImportar {
  horaCambio?: string;
}

const nuevoId = (): Id => crypto.randomUUID();

/** Busca el área (por nombre normalizado y padre) o la crea con la primera escritura. */
export async function resolverArea(almacen: Almacen, nombre: string, padre: Id | null, ahora: string): Promise<Area> {
  const norm = normalizar(nombre);
  const existentes = await almacen.areas.listar();
  const hallada = existentes.find((a) => a.nombre_normalizado === norm && a.padre_id === padre);
  if (hallada) return hallada;
  const area: Area = { id: nuevoId(), created_at: ahora, updated_at: ahora, deleted_at: null, rev: null, nombre, nombre_normalizado: norm, padre_id: padre };
  await almacen.areas.guardar(area);
  return area;
}

async function importarBloque(almacen: Almacen, reloj: Reloj, b: BloqueValido, informe: InformeImportacion, opciones: OpcionesImportar): Promise<void> {
  const ahora = reloj.ahora().toISOString();
  const hoy = diaLogico(reloj, opciones.horaCambio);
  const escrita = partirArea(b.area);
  if (typeof escrita === "string") {
    informe.errores.push(escrita);
    return;
  }
  const raiz = await resolverArea(almacen, escrita.area, null, ahora);
  const hoja = escrita.subarea ? await resolverArea(almacen, escrita.subarea, raiz.id, ahora) : raiz;

  const vivas = (await almacen.tarjetas.listar()).filter((t) => t.area_id === hoja.id);
  const porPregunta = new Map(vivas.map((t) => [normalizar(t.pregunta), t]));
  const nuevas: Tarjeta[] = [];
  let duplicadas = 0;

  for (const q of b.preguntas) {
    const clave = normalizar(q.p);
    const previa = porPregunta.get(clave);
    if (previa) {
      duplicadas++;
      if (normalizar(previa.respuesta) !== normalizar(q.r)) {
        informe.avisos.push(`Duplicada omitida con otra respuesta: "${q.p}". Se conservó la que ya tenías.`);
      }
      continue;
    }
    const t: Tarjeta = {
      id: nuevoId(), created_at: ahora, updated_at: ahora, deleted_at: null, rev: null,
      area_id: hoja.id, pregunta: q.p, respuesta: q.r, pista: q.pista, suspendida: false, importacion_id: null,
      ease: EASE_INICIAL, intervalo: 0, reps: 0, lapses: 0, vence: hoy,
      contenido_updated_at: ahora, repaso_updated_at: ahora,
    };
    nuevas.push(t);
    porPregunta.set(clave, t);
  }

  informe.duplicadas += duplicadas;
  if (nuevas.length === 0) return; // nada nuevo: no se registra importación ni apunte (idempotente)

  const importacionId = nuevoId();
  let apunteId: Id | null = null;
  for (const t of nuevas) t.importacion_id = importacionId;
  let ap: Apunte | null = null;
  if (b.resumen) {
    ap = {
      id: nuevoId(), created_at: ahora, updated_at: ahora, deleted_at: null, rev: null,
      titulo: b.tema, texto: b.resumen, tipo: "aprendizaje", etiquetas: [], area_id: hoja.id, tema: b.tema, importacion_id: importacionId,
    };
    apunteId = ap.id;
  }
  const imp: Importacion = {
    id: importacionId, created_at: ahora, updated_at: ahora, deleted_at: null, rev: null,
    tema: b.tema, fecha_bloque: b.fecha, area_id: hoja.id,
    tarjetas_creadas: nuevas.map((t) => t.id), duplicadas_omitidas: duplicadas, apunte_id: apunteId,
  };
  // Tarjetas, apunte e importación entran juntos (una transacción): no queda una importación a medias.
  await almacen.guardarLote({ tarjetas: nuevas, apuntes: ap ? [ap] : [], importaciones: [imp] });
  informe.creadas += nuevas.length;
}

/** Importa el texto pegado. Cada bloque se procesa por separado; uno con error no frena a los otros. */
export async function importar(almacen: Almacen, reloj: Reloj, texto: string, opciones: OpcionesImportar = {}): Promise<InformeImportacion> {
  const informe: InformeImportacion = { creadas: 0, duplicadas: 0, errores: [], avisos: [], texto_original: texto };
  const { bloques, errores } = parsearTexto(texto);
  informe.errores.push(...errores.map((e) => e.mensaje));
  let n = 0;
  for (const crudo of bloques) {
    n++;
    const v = validarBloque(crudo);
    if (Array.isArray(v)) {
      const prefijo = bloques.length > 1 ? `Bloque ${n}: ` : "";
      informe.errores.push(...v.map((m) => prefijo + m));
      continue;
    }
    await importarBloque(almacen, reloj, v, informe, opciones);
  }
  return informe;
}

/** I7: la última importación (viva) pasa a la papelera con sus tarjetas y su apunte. Devuelve cuántas tarjetas. */
export async function deshacerUltimaImportacion(almacen: Almacen, reloj: Reloj): Promise<{ tarjetas: number } | null> {
  const imps = await almacen.importaciones.listar();
  if (imps.length === 0) return null;
  const ultima = imps.reduce((a, b) => (b.created_at >= a.created_at ? b : a));
  const ahora = reloj.ahora().toISOString();
  const tarjetas = (await almacen.tarjetas.listar()).filter((t) => ultima.tarjetas_creadas.includes(t.id));
  const ap = ultima.apunte_id ? await almacen.apuntes.obtener(ultima.apunte_id) : undefined;
  await almacen.guardarLote({
    tarjetas: tarjetas.map((t) => ({ ...t, deleted_at: ahora, updated_at: ahora, contenido_updated_at: ahora })),
    apuntes: ap && ap.deleted_at === null ? [{ ...ap, deleted_at: ahora, updated_at: ahora }] : [],
    importaciones: [{ ...ultima, deleted_at: ahora, updated_at: ahora }],
  });
  return { tarjetas: tarjetas.length };
}
