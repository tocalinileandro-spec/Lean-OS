/** Lógica pura de verificar.ts: pasa resultados de pruebas a resultado por ID. */

export type EstadoTest = "passed" | "failed" | "skipped" | "todo" | "pending" | string;

export interface ResultadoTest {
  nombre: string;
  estado: EstadoTest;
}

export type EstadoId = "ok" | "rojo" | "salteado" | "falta" | "pendiente";

export interface ResultadoId {
  id: string;
  estado: EstadoId;
  exigible: boolean;
  fase: number;
  pruebas: number;
  detalle: string;
}

export interface Evaluacion {
  resultados: ResultadoId[];
  /** Pruebas en rojo sin ID reconocido (también hacen fallar). */
  rojasSinId: string[];
  ok: boolean;
}

/** El nombre de cada prueba empieza con su ID: "I1: importar un bloque válido". */
export function idDeNombre(nombre: string, ids: readonly string[]): string | null {
  const m = /^([A-Z]\d+)\s*:/.exec(nombre.trim());
  if (!m || !m[1]) return null;
  return ids.includes(m[1]) ? m[1] : null;
}

export function evaluar(
  tests: readonly ResultadoTest[],
  todos: readonly string[],
  exigibles: readonly string[],
  faseDe: Readonly<Record<string, number>>,
  /** Si el proceso de vitest terminó con error aunque no haya tests individuales en rojo. */
  vitestFallo = false,
): Evaluacion {
  const porId = new Map<string, ResultadoTest[]>();
  const rojasSinId: string[] = [];
  for (const t of tests) {
    const id = idDeNombre(t.nombre, todos);
    if (id) {
      const lista = porId.get(id) ?? [];
      lista.push(t);
      porId.set(id, lista);
    } else if (t.estado === "failed") {
      rojasSinId.push(t.nombre);
    }
  }

  const resultados: ResultadoId[] = todos.map((id) => {
    const lista = porId.get(id) ?? [];
    const exigible = exigibles.includes(id);
    const fase = faseDe[id] ?? 0;
    const rojas = lista.filter((t) => t.estado === "failed");
    const salteadas = lista.filter((t) => t.estado !== "passed" && t.estado !== "failed");
    const base = { id, exigible, fase, pruebas: lista.length };
    if (rojas.length > 0) return { ...base, estado: "rojo", detalle: `${rojas.length} en rojo` };
    if (!exigible && lista.length === 0) return { ...base, estado: "pendiente", detalle: `pendiente (fase ${fase})` };
    if (salteadas.length > 0) return { ...base, estado: "salteado", detalle: `${salteadas.length} salteada(s)` };
    if (lista.length === 0) return { ...base, estado: "falta", detalle: "no hay ninguna prueba con este ID" };
    return { ...base, estado: "ok", detalle: `${lista.length} prueba(s) verde(s)` };
  });

  const ok =
    !vitestFallo &&
    rojasSinId.length === 0 &&
    resultados.every((r) => r.estado === "ok" || (r.estado === "pendiente" && !r.exigible));
  return { resultados, rojasSinId, ok };
}

export function armarReporte(ev: Evaluacion, fecha: string, nota = ""): string {
  const marca: Record<EstadoId, string> = {
    ok: "OK",
    rojo: "ROJO",
    salteado: "SALTEADO",
    falta: "FALTA",
    pendiente: "pendiente",
  };
  const filas = ev.resultados.map((r) => {
    const texto = r.estado === "pendiente" ? `pendiente (fase ${r.fase})` : marca[r.estado];
    return `| ${r.id} | ${r.exigible ? "sí" : "no"} | ${texto} | ${r.detalle} |`;
  });
  const lineas = [
    "# REPORTE de verificación",
    "",
    `Generado: ${fecha}`,
    `Resultado general: **${ev.ok ? "APROBADO" : "FALLA"}**`,
    "",
    "| ID | Exigible en esta fase | Resultado | Detalle |",
    "| --- | --- | --- | --- |",
    ...filas,
    "",
  ];
  if (ev.rojasSinId.length > 0) {
    lineas.push("## Pruebas en rojo sin ID", "", ...ev.rojasSinId.map((n) => `- ${n}`), "");
  }
  if (nota) lineas.push(nota, "");
  return lineas.join("\n");
}
