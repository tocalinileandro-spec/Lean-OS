import { describe, expect, it } from "vitest";
import { evaluar } from "../src/verificacion/evaluar.ts";

const todos = ["A1", "B1", "C1"];
const fase = { A1: 1, B1: 1, C1: 2 };

describe("evaluar (lógica de verificar.ts)", () => {
  it("aprueba si lo exigible está verde y lo demás queda pendiente", () => {
    const ev = evaluar([{ nombre: "A1: x", estado: "passed" }], todos, ["A1"], fase);
    expect(ev.ok).toBe(true);
    expect(ev.resultados.find((r) => r.id === "C1")?.estado).toBe("pendiente");
  });
  it("falla si falta un ID exigible", () => {
    expect(evaluar([], todos, ["A1"], fase).ok).toBe(false);
  });
  it("falla si un ID exigible está salteado", () => {
    expect(evaluar([{ nombre: "A1: x", estado: "skipped" }], todos, ["A1"], fase).ok).toBe(false);
  });
  it("falla si cualquier ID está en rojo, aunque no sea exigible", () => {
    const ev = evaluar([{ nombre: "A1: x", estado: "passed" }, { nombre: "C1: y", estado: "failed" }], todos, ["A1"], fase);
    expect(ev.ok).toBe(false);
  });
  it("falla si hay una prueba en rojo sin ID o si vitest falló", () => {
    const base = [{ nombre: "A1: x", estado: "passed" }];
    expect(evaluar([...base, { nombre: "otra", estado: "failed" }], todos, ["A1"], fase).ok).toBe(false);
    expect(evaluar(base, todos, ["A1"], fase, true).ok).toBe(false);
  });
});
