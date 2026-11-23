/**
 * P15 (medición real) y P18 (capturas). Leen los archivos que deja `npm run capturas` en docs/capturas/;
 * no corren Playwright. Si cambia la interfaz, hay que volver a correr `npm run capturas` y commitear el resultado.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "capturas");
const ANCHOS = [390, 768, 1440];
const TEMAS = ["claro", "oscuro"];
const PANTALLAS_CAPTURA = ["areas", "repaso", "area"];
const PANTALLAS_MEDIDAS = ["hoy", "repaso", "areas", "area", "tarjetas", "tareas", "apuntes", "ajustes"];

describe("P18: capturas de pantalla", () => {
  it("P18: existen los 18 PNG docs/capturas/<pantalla>-<ancho>-<tema>.png, válidos y a escala 2", () => {
    let total = 0;
    for (const pantalla of PANTALLAS_CAPTURA) for (const ancho of ANCHOS) for (const tema of TEMAS) {
      const ruta = join(DIR, `${pantalla}-${ancho}-${tema}.png`);
      expect(existsSync(ruta), `falta ${pantalla}-${ancho}-${tema}.png`).toBe(true);
      const b = readFileSync(ruta);
      expect(b.length).toBeGreaterThan(10_000);
      expect(b.length).toBeLessThan(2_000_000);
      expect([...b.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]); // firma PNG
      expect(b.subarray(12, 16).toString("latin1")).toBe("IHDR");
      expect(b.readUInt32BE(16), `ancho de ${pantalla}-${ancho}-${tema}`).toBe(ancho * 2);
      expect(b.readUInt32BE(20)).toBeGreaterThan(0);
      expect(b.subarray(b.length - 8, b.length - 4).toString("latin1")).toBe("IEND");
      total += b.length;
    }
    expect(total).toBeLessThan(8_000_000);
  });
});

describe("P15: medición real de la interfaz", () => {
  const ruta = join(DIR, "medicion.json");
  it("P15: medicion.json cubre 3 anchos, 2 temas y todas las pantallas, con cero incumplimientos", () => {
    expect(existsSync(ruta) && statSync(ruta).size > 0).toBe(true);
    const m = JSON.parse(readFileSync(ruta, "utf8"));
    expect(m.generado).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(m.anchos).toEqual(ANCHOS);
    expect(m.temas).toEqual(TEMAS);
    for (const p of PANTALLAS_MEDIDAS) expect(m.pantallas).toContain(p);
    expect(Array.isArray(m.incumplimientos)).toBe(true);
    expect(m.incumplimientos).toEqual([]);
    expect(m.resumen.controlesMedidos).toBeGreaterThan(100);
    expect(m.resumen.incumplimientos).toBe(0);
    expect(m.resumen.scrollHorizontal).toBe(0);
    expect(m.resumen.navegacionCorrecta).toBe(true);
  });
});
