import { describe, expect, it } from "vitest";
import { RelojReal, RelojSimulado } from "../src/compartido/reloj.ts";

describe("reloj", () => {
  it("el simulado se fija y avanza a mano", () => {
    const r = new RelojSimulado("2026-11-22T06:59:00.000Z");
    r.avanzarMinutos(1);
    expect(r.ahora().toISOString()).toBe("2026-11-22T07:00:00.000Z");
    r.avanzarDias(1);
    expect(r.ahora().toISOString()).toBe("2026-11-23T07:00:00.000Z");
  });
  it("el real devuelve un instante cercano al actual", () => {
    expect(Math.abs(new RelojReal().ahora().getTime() - Date.now())).toBeLessThan(1000);
  });
});
