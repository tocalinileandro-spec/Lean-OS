/**
 * Migración desde el Lean OS original (prototipo en Python): P10 y P11.
 *
 * Qué lee: (a) el ZIP de "Exportar todo" (`areas/<slug>.json`; `importados.json`, `papelera/` y
 * `respaldos/` se ignoran), (b) archivos de área sueltos (o un arreglo / `{areas:[...]}`) y
 * (c) bloques `"tipo":"aprendizaje"` (se delegan en `importar()`, con las reglas I1-I6).
 *
 * Mapeo:
 * - Área `"A > B"` -> Área A + Subárea B (reutiliza `resolverArea`: mismo nombre normalizado y padre no duplica).
 *   Con 3 o más niveles (`"A > B > C"`) el resto se aplana en el nombre de la subárea con " › " (`"B › C"`) y se avisa.
 *   Un área sin temas se crea igual (vacía).
 * - Cada tema -> una Importación + un Apunte "aprendizaje" con el resumen (si hay) + sus tarjetas, en un solo `guardarLote`.
 * - Estado de repaso: nivel 0 = tarjeta nueva (vence en `proxima` si es válida y no es anterior a hoy; si no, hoy);
 *   nivel n de 1 a 5 = intervalo [1,3,7,21,60][n-1], reps n, ease 2,5, lapses 0, vence en `proxima` (si no es válida, hoy).
 * - Sin duplicar: misma área hoja y misma pregunta normalizada = duplicada, no se toca la tarjeta que ya existe.
 *   Un tema que no aporta tarjetas nuevas no registra importación ni apunte (importar dos veces = 0 creadas).
 *   Excepción: un tema SIN preguntas pero con resumen guarda el apunte (si no hay ya uno igual) para no perder el resumen.
 * - Todo o nada POR ARCHIVO (en un ZIP, cada `areas/*.json` es un archivo): si está dañado o no es del original, se avisa
 *   y no cambia nada de ese archivo; los demás siguen.
 */
import type { Almacen } from "./almacen.ts";
import { diaLogico } from "./dia.ts";
import { EASE_INICIAL, type Apunte, type FechaISO, type Id, type Importacion, type InstanteUTC, type Tarjeta } from "./esquema.ts";
import { resolverArea, importar, type OpcionesImportar } from "./importacion/importar.ts";
import { normalizar } from "./normalizar.ts";
import type { Reloj } from "./reloj.ts";
import { ErrorZip, leerZip, pareceZip } from "./zip.ts";

export interface InformeMigracion {
  /** Áreas de primer nivel leídas del respaldo (distintas). */
  areas: number;
  /** Subáreas leídas del respaldo (distintas). */
  subareas: number;
  /** Temas leídos del respaldo. */
  temas: number;
  /** Tarjetas nuevas creadas. */
  creadas: number;
  /** Tarjetas que ya existían (no se tocaron). */
  duplicadas: number;
  avisos: string[];
  errores: string[];
}

export interface ArchivoAImportar {
  nombre: string;
  bytes: Uint8Array;
}

export const INTERVALOS_POR_NIVEL = [1, 3, 7, 21, 60] as const;
const MAX_BYTES_ARCHIVO = 50 * 1024 * 1024;
const SEPARADOR_APLANADO = " › ";

const nuevoId = (): Id => crypto.randomUUID();
const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function fechaValida(x: unknown): FechaISO | null {
  if (typeof x !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(x.trim());
  if (!m) return null;
  const f = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return f.getUTCFullYear() === Number(m[1]) && f.getUTCMonth() === Number(m[2]) - 1 && f.getUTCDate() === Number(m[3]) ? m[0] : null;
}

function instanteValido(x: unknown): InstanteUTC | null {
  if (typeof x !== "string" || x.trim() === "") return null;
  const ms = new Date(x).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const texto = (x: unknown): string => (typeof x === "string" ? x.replace(/\s+/g, " ").trim() : "");

interface Contexto {
  almacen: Almacen;
  reloj: Reloj;
  hoy: FechaISO;
  ahora: InstanteUTC;
  informe: InformeMigracion;
  /** Preguntas ya conocidas por área hoja (normalizadas), cargadas una sola vez. */
  conocidas: Map<Id, Map<string, Tarjeta>>;
  areasVistas: Set<string>;
  subareasVistas: Set<string>;
}

async function preguntasDe(c: Contexto, areaId: Id): Promise<Map<string, Tarjeta>> {
  let m = c.conocidas.get(areaId);
  if (!m) {
    const vivas = (await c.almacen.tarjetas.listar()).filter((t) => t.area_id === areaId);
    m = new Map(vivas.map((t) => [normalizar(t.pregunta), t]));
    c.conocidas.set(areaId, m);
  }
  return m;
}

interface PreguntaLimpia {
  p: string;
  r: string;
  pista: string | null;
  nivel: number;
  proxima: unknown;
  ultima: unknown;
}

interface TemaLimpio {
  tema: string;
  fecha: FechaISO;
  resumen: string;
  preguntas: PreguntaLimpia[];
}

interface AreaLimpia {
  raiz: string;
  subarea: string | null;
  temas: TemaLimpio[];
}

/** Valida y sanea un área del original. Devuelve el área o un mensaje de error; los avisos se suman a `avisos`. */
function sanearArea(crudo: unknown, hoy: FechaISO, avisos: string[]): AreaLimpia | string {
  if (!esObjeto(crudo)) return "no es un área del Lean OS original (se esperaba un objeto con nombre y temas).";
  if (typeof crudo.nombre !== "string") return 'no es un área del Lean OS original (falta el campo "nombre").';
  const partes = crudo.nombre.split(">").map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => normalizar(p) !== "");
  if (partes.length === 0) return 'el área no tiene nombre (el campo "nombre" está vacío).';
  const temasCrudos = crudo.temas === undefined || crudo.temas === null ? [] : crudo.temas;
  if (!Array.isArray(temasCrudos)) return 'el campo "temas" del área no es una lista.';
  for (const [i, t] of temasCrudos.entries()) {
    if (!esObjeto(t)) return `el tema ${i + 1} no tiene el formato esperado.`;
    if (t.preguntas !== undefined && t.preguntas !== null && !Array.isArray(t.preguntas)) return `el campo "preguntas" del tema ${i + 1} no es una lista.`;
  }
  const nombreCompleto = partes.join(" > ");
  if (partes.length > 2) {
    avisos.push(`Área "${nombreCompleto}": la app tiene dos niveles, así que quedó como subárea "${partes.slice(1).join(SEPARADOR_APLANADO)}" de "${partes[0]}".`);
  }
  const temas: TemaLimpio[] = [];
  for (const [i, t] of (temasCrudos as Record<string, unknown>[]).entries()) {
    let nombreTema = texto(t.tema);
    if (nombreTema === "") {
      nombreTema = "Tema sin nombre";
      avisos.push(`Área "${nombreCompleto}": el tema ${i + 1} no tiene nombre; se importó como "${nombreTema}".`);
    }
    let fecha = fechaValida(t.fecha);
    if (fecha === null) {
      fecha = hoy;
      avisos.push(`Tema "${nombreTema}": la fecha no es válida; se usó la de hoy (${hoy}).`);
    }
    const resumen = typeof t.resumen === "string" ? t.resumen.trim() : "";
    const preguntas: PreguntaLimpia[] = [];
    const lista = Array.isArray(t.preguntas) ? t.preguntas : [];
    for (const [j, q] of lista.entries()) {
      if (!esObjeto(q)) {
        avisos.push(`Tema "${nombreTema}": la pregunta ${j + 1} no tiene el formato esperado y se omitió.`);
        continue;
      }
      const p = typeof q.p === "string" ? q.p.trim() : "";
      const r = typeof q.r === "string" ? q.r.trim() : "";
      if (p === "" || r === "") {
        avisos.push(`Tema "${nombreTema}": la pregunta ${j + 1} tiene la pregunta o la respuesta vacía y se omitió.`);
        continue;
      }
      let nivel = 0;
      if (q.nivel !== undefined && q.nivel !== null) {
        if (typeof q.nivel === "number" && Number.isInteger(q.nivel) && q.nivel >= 0 && q.nivel <= 5) nivel = q.nivel;
        else avisos.push(`Tema "${nombreTema}": la pregunta "${p}" tiene un nivel que no es de 0 a 5; se trató como nueva.`);
      }
      const pista = typeof q.pista === "string" && q.pista.trim() !== "" ? q.pista.trim() : null;
      preguntas.push({ p, r, pista, nivel, proxima: q.proxima, ultima: q.ultima_vez });
    }
    if (lista.length === 0 && resumen === "") {
      avisos.push(`Tema "${nombreTema}": no tiene preguntas ni resumen; no se guardó nada.`);
    } else if (lista.length === 0) {
      avisos.push(`Tema "${nombreTema}": no tiene preguntas; se guardó solo el resumen.`);
    }
    temas.push({ tema: nombreTema, fecha, resumen, preguntas });
  }
  return { raiz: partes[0]!, subarea: partes.length > 1 ? partes.slice(1).join(SEPARADOR_APLANADO) : null, temas };
}

function estadoDeRepaso(q: PreguntaLimpia, c: Contexto): Pick<Tarjeta, "intervalo" | "reps" | "vence" | "repaso_updated_at"> {
  const prox = fechaValida(q.proxima);
  const ultima = instanteValido(q.ultima) ?? c.ahora;
  if (q.nivel === 0) {
    return { intervalo: 0, reps: 0, vence: prox !== null && prox >= c.hoy ? prox : c.hoy, repaso_updated_at: ultima };
  }
  return { intervalo: INTERVALOS_POR_NIVEL[q.nivel - 1]!, reps: q.nivel, vence: prox ?? c.hoy, repaso_updated_at: ultima };
}

async function guardarArea(c: Contexto, area: AreaLimpia): Promise<void> {
  const raiz = await resolverArea(c.almacen, area.raiz, null, c.ahora);
  const hoja = area.subarea ? await resolverArea(c.almacen, area.subarea, raiz.id, c.ahora) : raiz;
  c.areasVistas.add(normalizar(area.raiz));
  if (area.subarea) c.subareasVistas.add(`${normalizar(area.raiz)}|${normalizar(area.subarea)}`);
  const conocidas = await preguntasDe(c, hoja.id);

  for (const t of area.temas) {
    c.informe.temas++;
    const nuevas: Tarjeta[] = [];
    let duplicadas = 0;
    const importacionId = nuevoId();
    for (const q of t.preguntas) {
      const clave = normalizar(q.p);
      const previa = conocidas.get(clave);
      if (previa) {
        duplicadas++;
        if (normalizar(previa.respuesta) !== normalizar(q.r)) {
          c.informe.avisos.push(`Duplicada omitida con otra respuesta: "${q.p}". Se conservó la que ya tenías.`);
        }
        continue;
      }
      const tarjeta: Tarjeta = {
        id: nuevoId(), created_at: c.ahora, updated_at: c.ahora, deleted_at: null, rev: null,
        area_id: hoja.id, pregunta: q.p, respuesta: q.r, pista: q.pista, suspendida: false, importacion_id: importacionId,
        ease: EASE_INICIAL, lapses: 0, ...estadoDeRepaso(q, c),
        contenido_updated_at: c.ahora,
      };
      nuevas.push(tarjeta);
      conocidas.set(clave, tarjeta);
    }
    c.informe.duplicadas += duplicadas;

    const soloResumen = t.preguntas.length === 0 && t.resumen !== "";
    if (nuevas.length === 0 && !soloResumen) continue; // nada nuevo: ni importación ni apunte (idempotente)
    let apunte: Apunte | null = null;
    if (t.resumen !== "") {
      if (soloResumen) {
        const iguales = (await c.almacen.apuntes.listar()).some(
          (a) => a.tipo === "aprendizaje" && a.area_id === hoja.id && normalizar(a.tema ?? "") === normalizar(t.tema) && a.texto === t.resumen,
        );
        if (iguales) continue;
      }
      apunte = {
        id: nuevoId(), created_at: c.ahora, updated_at: c.ahora, deleted_at: null, rev: null,
        titulo: t.tema, texto: t.resumen, tipo: "aprendizaje", etiquetas: [], area_id: hoja.id, tema: t.tema, importacion_id: importacionId,
      };
    }
    const importacion: Importacion = {
      id: importacionId, created_at: c.ahora, updated_at: c.ahora, deleted_at: null, rev: null,
      tema: t.tema, fecha_bloque: t.fecha, area_id: hoja.id,
      tarjetas_creadas: nuevas.map((x) => x.id), duplicadas_omitidas: duplicadas, apunte_id: apunte ? apunte.id : null,
    };
    await c.almacen.guardarLote({ tarjetas: nuevas, apuntes: apunte ? [apunte] : [], importaciones: [importacion] });
    c.informe.creadas += nuevas.length;
  }
}

function esAreaDelOriginal(x: unknown): boolean {
  return esObjeto(x) && typeof x.nombre === "string" && ("temas" in x || "slug" in x);
}

/** Importa un valor JSON ya leído de un archivo (o de una entrada de ZIP). */
async function importarValor(c: Contexto, etiqueta: string, valor: unknown, opciones: OpcionesImportar): Promise<void> {
  const { informe } = c;
  let elementos: unknown[];
  if (Array.isArray(valor)) elementos = valor;
  else if (esObjeto(valor) && Array.isArray(valor.areas)) elementos = valor.areas;
  else elementos = [valor];
  if (elementos.length === 0) {
    informe.errores.push(`"${etiqueta}": no trae ningún área para importar.`);
    return;
  }
  // Todo o nada: se valida cada elemento antes de escribir. Uno inválido frena el archivo entero.
  const avisosPropios: string[] = [];
  const listas: { area?: AreaLimpia; bloque?: Record<string, unknown> }[] = [];
  for (const [i, el] of elementos.entries()) {
    const donde = elementos.length > 1 ? `"${etiqueta}" (elemento ${i + 1})` : `"${etiqueta}"`;
    if (esObjeto(el) && el.tipo === "aprendizaje") {
      listas.push({ bloque: el });
      continue;
    }
    if (!esAreaDelOriginal(el)) {
      informe.errores.push(`${donde}: no es un archivo del Lean OS original (no tiene el formato de un área ni de un bloque de aprendizaje). No se cambió nada.`);
      return;
    }
    const limpia = sanearArea(el, c.hoy, avisosPropios);
    if (typeof limpia === "string") {
      informe.errores.push(`${donde}: ${limpia} No se cambió nada.`);
      return;
    }
    listas.push({ area: limpia });
  }
  informe.avisos.push(...avisosPropios.map((a) => `${etiqueta}: ${a}`));
  try {
    for (const item of listas) {
      if (item.area) {
        await guardarArea(c, item.area);
      } else if (item.bloque) {
        const r = await importar(c.almacen, c.reloj, JSON.stringify(item.bloque), opciones);
        informe.creadas += r.creadas;
        informe.duplicadas += r.duplicadas;
        informe.avisos.push(...r.avisos.map((a) => `${etiqueta}: ${a}`));
        informe.errores.push(...r.errores.map((e) => `"${etiqueta}": ${e}`));
        if (r.errores.length === 0) {
          informe.temas++;
          const partes = typeof item.bloque.area === "string" ? item.bloque.area.split(">").map((p) => normalizar(p)).filter(Boolean) : [];
          if (partes[0]) c.areasVistas.add(partes[0]);
          if (partes[0] && partes[1]) c.subareasVistas.add(`${partes[0]}|${partes[1]}`);
        }
      }
    }
  } catch {
    informe.errores.push(`"${etiqueta}": no se pudo guardar en este dispositivo. Probá de nuevo; lo que ya se guardó no se duplica.`);
  }
}

const esRutaDeArea = (ruta: string): boolean => {
  const partes = ruta.split("/");
  const nombre = partes[partes.length - 1]!;
  if (!nombre.toLowerCase().endsWith(".json") || partes.length < 2) return false;
  if (partes.some((p) => p === "papelera" || p === "respaldos")) return false;
  return partes[partes.length - 2] === "areas";
};

function leerTexto(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return null;
  }
}

async function importarTextoJson(c: Contexto, etiqueta: string, bytes: Uint8Array, opciones: OpcionesImportar): Promise<void> {
  const t = leerTexto(bytes);
  if (t === null) {
    c.informe.errores.push(`"${etiqueta}": no es un archivo de texto legible (ni un ZIP del Lean OS original). No se cambió nada.`);
    return;
  }
  if (t.trim() === "") {
    c.informe.errores.push(`"${etiqueta}": el archivo está vacío. No se cambió nada.`);
    return;
  }
  let valor: unknown;
  try {
    valor = JSON.parse(t);
  } catch {
    // Quizá es un bloque de aprendizaje pegado con cercas o comillas tipográficas: lo lee el importador.
    if (/"tipo"\s*:\s*"aprendizaje"/.test(t)) {
      const r = await importar(c.almacen, c.reloj, t, opciones);
      c.informe.creadas += r.creadas;
      c.informe.duplicadas += r.duplicadas;
      c.informe.avisos.push(...r.avisos.map((a) => `${etiqueta}: ${a}`));
      c.informe.errores.push(...r.errores.map((e) => `"${etiqueta}": ${e}`));
      return;
    }
    c.informe.errores.push(`"${etiqueta}": el archivo está dañado o no es JSON (no se pudo leer). No se cambió nada.`);
    return;
  }
  await importarValor(c, etiqueta, valor, opciones);
}

/**
 * Importa los archivos que eligió la persona (ZIP del original, áreas sueltas o bloques de aprendizaje).
 * Nunca lanza por datos malos: todo problema queda en `errores` / `avisos` del informe, en castellano.
 */
export async function importarRespaldoOriginal(
  almacen: Almacen,
  reloj: Reloj,
  archivos: ArchivoAImportar[],
  opciones: OpcionesImportar = {},
): Promise<InformeMigracion> {
  const informe: InformeMigracion = { areas: 0, subareas: 0, temas: 0, creadas: 0, duplicadas: 0, avisos: [], errores: [] };
  const c: Contexto = {
    almacen, reloj, informe,
    hoy: diaLogico(reloj, opciones.horaCambio),
    ahora: reloj.ahora().toISOString(),
    conocidas: new Map(), areasVistas: new Set(), subareasVistas: new Set(),
  };
  if (archivos.length === 0) informe.errores.push("No elegiste ningún archivo.");
  for (const archivo of archivos) {
    const nombre = archivo.nombre || "(sin nombre)";
    try {
      if (archivo.bytes.length === 0) {
        informe.errores.push(`"${nombre}": el archivo está vacío. No se cambió nada.`);
      } else if (archivo.bytes.length > MAX_BYTES_ARCHIVO) {
        informe.errores.push(`"${nombre}": el archivo es demasiado grande (más de 50 MB). No se cambió nada.`);
      } else if (pareceZip(archivo.bytes)) {
        let entradas;
        try {
          entradas = await leerZip(archivo.bytes, esRutaDeArea);
        } catch (e) {
          informe.errores.push(`"${nombre}": ${e instanceof ErrorZip ? e.message : "no se pudo leer el ZIP."} No se cambió nada.`);
          continue;
        }
        if (entradas.length === 0) {
          informe.errores.push(`"${nombre}": no es un respaldo del Lean OS original (no tiene archivos dentro de la carpeta areas/). No se cambió nada.`);
          continue;
        }
        entradas.sort((a, b) => (a.nombre < b.nombre ? -1 : 1));
        for (const e of entradas) await importarTextoJson(c, `${nombre} › ${e.nombre}`, e.bytes, opciones);
      } else {
        await importarTextoJson(c, nombre, archivo.bytes, opciones);
      }
    } catch {
      informe.errores.push(`"${nombre}": no se pudo importar por un problema inesperado. No se cambió nada de ese archivo.`);
    }
  }
  informe.areas = c.areasVistas.size;
  informe.subareas = c.subareasVistas.size;
  return informe;
}
