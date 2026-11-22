/**
 * Dibujo de los gráficos de estadísticas: SVG propio, sin librerías ni recursos externos.
 * Todo se arma con createElementNS y textContent (los datos nunca se interpretan como HTML). Los colores salen de
 * clases de estilos.css (variables del tema); la información no depende del color: cada gráfico
 * trae sus valores como texto (etiquetas visibles y una lista accesible).
 */
import type { PuntoDia, PuntoSemana, Retencion } from "../../compartido/graficos.ts";
import type { TotalPorArea } from "../../compartido/estadisticas.ts";
import { formatearFecha } from "./logica.ts";

const NS = "http://www.w3.org/2000/svg";
let contador = 0;

type Attrs = Record<string, string | number>;

function nodo(doc: Document, tag: string, attrs: Attrs = {}, texto?: string): SVGElement {
  const el = doc.createElementNS(NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (texto !== undefined) el.textContent = texto;
  return el;
}

const ddmm = (iso: string) => formatearFecha(iso).slice(0, 5);
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Base común: <figure> con título visible, el SVG (rol de imagen, title y desc) y la lista de valores como texto. */
function armar(doc: Document, titulo: string, resumen: string, ancho: number, alto: number, dibujo: SVGElement[], valores: string[]): HTMLElement {
  const id = `grafico-${++contador}`;
  const svg = nodo(doc, "svg", { viewBox: `0 0 ${ancho} ${alto}`, role: "img", "aria-labelledby": `${id}-t ${id}-d`, class: "grafico-svg", focusable: "false" });
  svg.append(nodo(doc, "title", { id: `${id}-t` }, titulo), nodo(doc, "desc", { id: `${id}-d` }, resumen), ...dibujo);
  const lista = doc.createElement("ul");
  lista.className = "solo-lectores";
  for (const v of valores) {
    const li = doc.createElement("li");
    li.textContent = v;
    lista.append(li);
  }
  const fig = doc.createElement("figure");
  fig.className = "grafico";
  const cap = doc.createElement("figcaption");
  cap.textContent = titulo;
  fig.append(cap, svg, lista);
  return fig;
}

function vacio(doc: Document, titulo: string, mensaje: string): HTMLElement {
  const fig = doc.createElement("figure");
  fig.className = "grafico";
  const cap = doc.createElement("figcaption");
  cap.textContent = titulo;
  const p = doc.createElement("p");
  p.className = "vacio suave";
  p.textContent = mensaje;
  fig.append(cap, p);
  return fig;
}

/** Barras verticales con valor sobre cada barra distinta de cero y etiquetas de fecha en los extremos. */
function barrasVerticales(doc: Document, valores: number[], etiquetas: string[], marcas: number[]): SVGElement[] {
  const ancho = 300, base = 100, tope = 14;
  const max = Math.max(...valores, 1);
  const paso = ancho / valores.length;
  const ancha = Math.min(paso * 0.7, 28);
  const out: SVGElement[] = [nodo(doc, "line", { x1: 0, y1: base, x2: ancho, y2: base, class: "g-eje" })];
  valores.forEach((v, i) => {
    const alto = v === 0 ? 0 : Math.max(2, ((base - tope) * v) / max);
    const x = i * paso + (paso - ancha) / 2;
    if (v > 0) {
      out.push(nodo(doc, "rect", { x: x.toFixed(2), y: (base - alto).toFixed(2), width: ancha.toFixed(2), height: alto.toFixed(2), rx: 1.5, class: "g-barra" }));
      if (valores.length <= 12 || v === max) out.push(nodo(doc, "text", { x: (x + ancha / 2).toFixed(2), y: (base - alto - 3).toFixed(2), "text-anchor": "middle", class: "g-texto" }, String(v)));
    }
  });
  for (const i of marcas) {
    const anchor = i === 0 ? "start" : i === valores.length - 1 ? "end" : "middle";
    const x = anchor === "start" ? 0 : anchor === "end" ? ancho : i * paso + paso / 2;
    out.push(nodo(doc, "text", { x: x.toFixed(2), y: base + 14, "text-anchor": anchor, class: "g-texto" }, etiquetas[i]!));
  }
  return out;
}

/** Repasos por día (cantidad vigente de cada día lógico). */
export function graficoRepasosPorDia(doc: Document, puntos: PuntoDia[]): HTMLElement {
  const titulo = "Repasos por día";
  const total = puntos.reduce((n, p) => n + p.total, 0);
  if (total === 0) return vacio(doc, titulo, "Todavía no hay repasos para mostrar");
  const mejor = puntos.reduce((m, p) => (p.total > m.total ? p : m), puntos[0]!);
  const resumen = `Últimos ${puntos.length} días: ${plural(total, "repaso", "repasos")} en total. El día con más repasos fue el ${ddmm(mejor.dia)}, con ${mejor.total}.`;
  const marcas = [0, Math.floor((puntos.length - 1) / 2), puntos.length - 1];
  return armar(doc, titulo, resumen, 300, 118,
    barrasVerticales(doc, puntos.map((p) => p.total), puntos.map((p) => ddmm(p.dia)), marcas),
    puntos.map((p) => `${ddmm(p.dia)}: ${plural(p.total, "repaso", "repasos")}`));
}

/** Retención: número grande y barra de progreso. */
export function graficoRetencion(doc: Document, r: Retencion): HTMLElement {
  const titulo = "Retención";
  if (r.porcentaje === null) return vacio(doc, titulo, "Sin datos: todavía no hay repasos en los últimos 30 días");
  const resumen = `Retención de los últimos 30 días: ${r.porcentaje} por ciento. ${r.aciertos} de ${plural(r.total, "respuesta", "respuestas")} fueron Bien o Fácil.`;
  const dibujo = [
    nodo(doc, "text", { x: 0, y: 36, class: "g-grande" }, `${r.porcentaje} %`),
    nodo(doc, "text", { x: 300, y: 36, "text-anchor": "end", class: "g-texto" }, `${r.aciertos} de ${r.total} en Bien o Fácil`),
    nodo(doc, "rect", { x: 0, y: 48, width: 300, height: 14, rx: 7, class: "g-pista" }),
    nodo(doc, "rect", { x: 0, y: 48, width: ((300 * r.porcentaje) / 100).toFixed(2), height: 14, rx: 7, class: "g-barra" }),
  ];
  return armar(doc, titulo, resumen, 300, 70, dibujo, [`Retención: ${r.porcentaje} %`, `Respuestas Bien o Fácil: ${r.aciertos}`, `Respuestas en total: ${r.total}`]);
}

const recortar = (s: string, max = 34) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Barras horizontales: tarjetas por área (el Área ya incluye sus subáreas). */
export function graficoTarjetasPorArea(doc: Document, filas: TotalPorArea[]): HTMLElement {
  const titulo = "Tarjetas por área";
  if (filas.length === 0 || filas.every((f) => f.total === 0)) return vacio(doc, titulo, "Todavía no hay tarjetas para mostrar");
  const max = Math.max(...filas.map((f) => f.total), 1);
  const dibujo: SVGElement[] = [];
  filas.forEach((f, i) => {
    const y = i * 32;
    dibujo.push(nodo(doc, "text", { x: 0, y: y + 11, class: "g-texto" }, recortar(f.nombre)));
    dibujo.push(nodo(doc, "text", { x: 300, y: y + 11, "text-anchor": "end", class: "g-texto g-valor" }, String(f.total)));
    dibujo.push(nodo(doc, "rect", { x: 0, y: y + 16, width: 300, height: 9, rx: 4.5, class: "g-pista" }));
    if (f.total > 0) dibujo.push(nodo(doc, "rect", { x: 0, y: y + 16, width: Math.max(4, (300 * f.total) / max).toFixed(2), height: 9, rx: 4.5, class: "g-barra" }));
  });
  const resumen = `${plural(filas.length, "área", "áreas")} con tarjetas: ${filas.map((f) => `${f.nombre} ${f.total}`).join(", ")}.`;
  return armar(doc, titulo, resumen, 300, filas.length * 32, dibujo, filas.map((f) => `${f.nombre}: ${plural(f.total, "tarjeta", "tarjetas")}`));
}

/** Tareas hechas por semana (lunes a domingo). */
export function graficoTareasPorSemana(doc: Document, puntos: PuntoSemana[]): HTMLElement {
  const titulo = "Tareas hechas por semana";
  const total = puntos.reduce((n, p) => n + p.total, 0);
  if (total === 0) return vacio(doc, titulo, "Todavía no hay tareas hechas para mostrar");
  const resumen = `Últimas ${puntos.length} semanas: ${plural(total, "tarea hecha", "tareas hechas")}. Cada barra es una semana de lunes a domingo.`;
  const todas = puntos.map((_, i) => i);
  return armar(doc, titulo, resumen, 300, 118,
    barrasVerticales(doc, puntos.map((p) => p.total), puntos.map((p) => ddmm(p.inicio)), todas),
    puntos.map((p) => `Semana del ${ddmm(p.inicio)} al ${ddmm(p.fin)}: ${plural(p.total, "tarea hecha", "tareas hechas")}`));
}
