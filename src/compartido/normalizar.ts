/** Normalización de texto (sección 3): sin mayúsculas, tildes ni signos; espacios colapsados. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface AreaEscrita {
  area: string;
  /** null si se escribió sin subárea. */
  subarea: string | null;
}

/** 'A > B' -> área y subárea. Devuelve un texto de error si no se puede interpretar. */
export function partirArea(texto: string): AreaEscrita | string {
  const partes = texto.split(">").map((p) => p.trim().replace(/\s+/g, " "));
  if (partes.length > 2) return 'El campo "area" admite como máximo Área > Subárea.';
  if (partes.some((p) => normalizar(p) === "")) return 'El campo "area" está vacío o tiene un nivel sin nombre.';
  return { area: partes[0]!, subarea: partes[1] ?? null };
}
