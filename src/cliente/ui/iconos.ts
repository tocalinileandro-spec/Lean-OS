/**
 * Íconos SVG propios (trazo redondeado, como la maqueta). Se crean con createElementNS: sin innerHTML, sin fuentes de íconos.
 * Siempre decorativos (`aria-hidden`): el texto o la etiqueta accesible va en el control que los contiene.
 */
export type NombreIcono = "hoy" | "repaso" | "areas" | "tareas" | "apuntes" | "ajustes" | "volver" | "siguiente" | "mas" | "tres-puntos" | "papelera";

const SVG_NS = "http://www.w3.org/2000/svg";

const TRAZOS: Record<NombreIcono, string[]> = {
  hoy: ["M3 11l9-8 9 8", "M5 10v10h14V10"],
  repaso: ["M4 5h16v14H4z", "M4 10h16"],
  areas: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
  tareas: ["M5 12l4 4 10-10"],
  apuntes: ["M6 3h9l4 4v14H6z", "M9 12h7", "M9 16h7"],
  // Controles deslizantes: ajustes sin la rueda dentada.
  ajustes: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 4v6", "M9 14v6"],
  volver: ["M19 12H5", "M11 6l-6 6 6 6"],
  siguiente: ["M5 12h14", "M13 6l6 6-6 6"],
  mas: ["M12 5v14", "M5 12h14"],
  // Tres puntos verticales: segmentos de largo casi cero con trazo grueso y puntas redondas.
  "tres-puntos": ["M12 5h.01", "M12 12h.01", "M12 19h.01"],
  papelera: ["M3 6h18", "M8 6V4h8v2", "M6 6l1 14h10l1-14"],
};
const TRAZO_GRUESO: Partial<Record<NombreIcono, string>> = { "tres-puntos": "4" };

export function crearIcono(doc: Document, nombre: NombreIcono): SVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({
    viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor",
    "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false",
  })) svg.setAttribute(k, v);
  const grueso = TRAZO_GRUESO[nombre];
  if (grueso) svg.setAttribute("stroke-width", grueso);
  for (const d of TRAZOS[nombre]) {
    const p = doc.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg as SVGElement;
}
