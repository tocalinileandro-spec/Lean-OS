/**
 * Markdown simple (negrita, listas, enlaces) dibujado con nodos del DOM: nunca se usa innerHTML,
 * así el texto del usuario siempre queda escapado. Solo se permiten enlaces http(s).
 */

const INLINE = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/gi;

function esEnlaceSeguro(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function agregarInline(doc: Document, padre: Node, texto: string): void {
  let ultimo = 0;
  for (const m of texto.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > ultimo) padre.appendChild(doc.createTextNode(texto.slice(ultimo, i)));
    if (m[1] !== undefined) {
      const b = doc.createElement("strong");
      b.textContent = m[1];
      padre.appendChild(b);
    } else if (esEnlaceSeguro(m[3]!)) {
      const a = doc.createElement("a");
      a.textContent = m[2]!;
      a.setAttribute("href", m[3]!);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
      padre.appendChild(a);
    } else {
      padre.appendChild(doc.createTextNode(m[0]));
    }
    ultimo = i + m[0].length;
  }
  if (ultimo < texto.length) padre.appendChild(doc.createTextNode(texto.slice(ultimo)));
}

const VINETA = /^\s*[-*]\s+(.*)$/;
const NUMERADA = /^\s*\d+[.)]\s+(.*)$/;

/** Devuelve un contenedor con el texto ya dibujado. */
export function renderizarMarkdown(doc: Document, texto: string): HTMLElement {
  const raiz = doc.createElement("div");
  raiz.setAttribute("class", "markdown");
  const lineas = texto.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lineas.length) {
    const linea = lineas[i]!;
    if (!linea.trim()) { i++; continue; }
    const regex = VINETA.test(linea) ? VINETA : NUMERADA.test(linea) ? NUMERADA : null;
    if (regex) {
      const lista = doc.createElement(regex === VINETA ? "ul" : "ol");
      while (i < lineas.length && regex.test(lineas[i]!)) {
        const li = doc.createElement("li");
        agregarInline(doc, li, regex.exec(lineas[i]!)![1]!);
        lista.appendChild(li);
        i++;
      }
      raiz.appendChild(lista);
      continue;
    }
    const p = doc.createElement("p");
    let primera = true;
    while (i < lineas.length && lineas[i]!.trim() && !VINETA.test(lineas[i]!) && !NUMERADA.test(lineas[i]!)) {
      if (!primera) p.appendChild(doc.createElement("br"));
      agregarInline(doc, p, lineas[i]!);
      primera = false;
      i++;
    }
    raiz.appendChild(p);
  }
  return raiz;
}
