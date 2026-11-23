/**
 * Íconos SVG propios (trazo redondeado, como la maqueta). Se crean con createElementNS: sin innerHTML, sin fuentes de íconos.
 * Siempre decorativos (`aria-hidden`): el texto o la etiqueta accesible va en el control que los contiene.
 */
export type NombreIcono = "hoy" | "repaso" | "areas" | "tareas" | "apuntes" | "ajustes";

const SVG_NS = "http://www.w3.org/2000/svg";

const TRAZOS: Record<NombreIcono, string[]> = {
  hoy: ["M3 11l9-8 9 8", "M5 10v10h14V10"],
  repaso: ["M4 5h16v14H4z", "M4 10h16"],
  areas: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
  tareas: ["M5 12l4 4 10-10"],
  apuntes: ["M6 3h9l4 4v14H6z", "M9 12h7", "M9 16h7"],
  // Controles deslizantes: ajustes sin la rueda dentada.
  ajustes: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 4v6", "M9 14v6"],
};

export function crearIcono(doc: Document, nombre: NombreIcono): SVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({
    viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor",
    "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false",
  })) svg.setAttribute(k, v);
  for (const d of TRAZOS[nombre]) {
    const p = doc.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg as SVGElement;
}
