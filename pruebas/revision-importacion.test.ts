/**
 * Pruebas puras de "Revisar antes de importar" (P8) y de la fecha de lo próximo del Repaso (P4).
 * La interfaz está en ui-repaso-importar.test.ts.
 */
import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../src/compartido/almacen.ts";
import { proximaFechaDeRepaso } from "../src/compartido/areas.ts";
import type { Area, Tarjeta } from "../src/compartido/esquema.ts";
import { importar } from "../src/compartido/importacion/importar.ts";
import { revisarImportacion } from "../src/compartido/importacion/revision.ts";
import { calificarYGuardar } from "../src/compartido/repaso.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";

const HOY = "2026-11-22";
const AHORA = "2026-11-22T15:00:00.000Z";
const nuevo = () => ({ a: new AlmacenMemoria(), r: new RelojSimulado(AHORA) });
const bloque = (extra: Record<string, unknown> = {}) => ({
  tipo: "aprendizaje", fecha: "2026-11-22", area: "Programación > CS50", tema: "Funciones en Python", resumen: "Resumen de 2 a 4 líneas.",
  preguntas: [{ p: "¿Qué hace return?", r: "Devuelve un valor." }, { p: "¿Qué es una función?", r: "Un bloque con nombre." }, { p: "¿Qué es un argumento?", r: "Un valor de entrada." }], ...extra,
});
const total = async (a: AlmacenMemoria) => ({
  tarjetas: (await a.tarjetas.listar()).length, areas: (await a.areas.listar()).length, importaciones: (await a.importaciones.listar()).length, apuntes: (await a.apuntes.listar()).length,
});

describe("revisarImportacion", () => {
  it("P8: dice área, subárea, tema, fecha, resumen y cuántas serían nuevas y duplicadas, sin crear nada", async () => {
    const { a, r } = nuevo();
    const antes = await total(a);
    const rv = await revisarImportacion(a, r, JSON.stringify(bloque()));
    expect(await total(a)).toEqual(antes);
    expect(rv.errores).toEqual([]);
    expect(rv.puedeConfirmar).toBe(true);
    expect(rv.bloques).toHaveLength(1);
    expect(rv.bloques[0]).toMatchObject({
      area: "Programación", subarea: "CS50", etiquetaArea: "Programación › CS50", tema: "Funciones en Python", fecha: "2026-11-22",
      resumen: "Resumen de 2 a 4 líneas.", nuevas: 3, duplicadas: 0, avisos: [], yaImportado: false,
    });
    expect(rv.bloques[0]!.preguntas.map((q) => q.estado)).toEqual(["nueva", "nueva", "nueva"]);
    expect(rv).toMatchObject({ nuevas: 3, duplicadas: 0 });
  });

  it("P8: coincide con lo que después hace importar (mismas nuevas y duplicadas) y avisa la duplicada con otra respuesta", async () => {
    const { a, r } = nuevo();
    await importar(a, r, JSON.stringify(bloque()));
    const texto = JSON.stringify(bloque({
      area: "programacion > cs50", tema: "Otro tema",
      preguntas: [{ p: "¿QUÉ HACE RETURN?", r: "Otra respuesta distinta." }, { p: "Pregunta nueva", r: "x" }],
    }));
    const antes = await total(a);
    const rv = await revisarImportacion(a, r, texto);
    expect(await total(a)).toEqual(antes);
    const b = rv.bloques[0]!;
    expect(b.etiquetaArea).toBe("Programación › CS50"); // la primera escritura registrada
    expect(b).toMatchObject({ nuevas: 1, duplicadas: 1, yaImportado: false });
    expect(b.avisos).toEqual(['Duplicada omitida con otra respuesta: "¿QUÉ HACE RETURN?". Se conservó la que ya tenías.']);
    const inf = await importar(a, r, texto);
    expect(inf).toMatchObject({ creadas: rv.nuevas, duplicadas: rv.duplicadas, avisos: b.avisos });
  });

  it("P8: un bloque ya importado queda como yaImportado y no se puede confirmar", async () => {
    const { a, r } = nuevo();
    await importar(a, r, JSON.stringify(bloque()));
    const rv = await revisarImportacion(a, r, JSON.stringify(bloque()));
    expect(rv.bloques[0]).toMatchObject({ nuevas: 0, duplicadas: 3, yaImportado: true });
    expect(rv.puedeConfirmar).toBe(false);
  });

  it("P8: varios bloques y repeticiones dentro del mismo texto se evalúan en orden, como al importar", async () => {
    const { a, r } = nuevo();
    const texto = JSON.stringify([bloque(), bloque({ tema: "Repetido" }), bloque({ area: "Idiomas", tema: "Verbos", preguntas: [{ p: "to be", r: "ser" }, { p: "To Be!", r: "estar" }] })]);
    const rv = await revisarImportacion(a, r, texto);
    expect(rv.bloques.map((b) => [b.nuevas, b.duplicadas])).toEqual([[3, 0], [0, 3], [1, 1]]);
    expect(rv.bloques[2]!.subarea).toBeNull();
    expect(rv.bloques[2]!.etiquetaArea).toBe("Idiomas");
    const inf = await importar(a, r, texto);
    expect(inf.creadas).toBe(rv.nuevas);
    expect(inf.duplicadas).toBe(rv.duplicadas);
  });

  it("P8: los errores de lectura y de validación son los mismos mensajes que importar, y un bloque malo no frena a los otros", async () => {
    const { a, r } = nuevo();
    for (const texto of [
      JSON.stringify(bloque()).slice(0, 40),
      JSON.stringify({ ...bloque(), preguntas: undefined }),
      JSON.stringify(bloque({ preguntas: [{ p: "¿Algo?", r: "" }] })),
      JSON.stringify(bloque({ tipo: "otro" })),
      JSON.stringify(bloque({ area: "A > B > C" })),
      "no es json",
      "",
    ]) {
      const rv = await revisarImportacion(a, r, texto);
      const inf = await importar(new AlmacenMemoria(), r, texto);
      expect(rv.errores, texto).toEqual(inf.errores);
      expect(rv.errores.length, texto).toBeGreaterThan(0);
      expect(rv.puedeConfirmar).toBe(false);
      expect(rv.texto_original).toBe(texto);
    }
    const mixto = JSON.stringify([bloque({ preguntas: [] }), bloque({ tema: "Bueno" })]);
    const rv = await revisarImportacion(a, r, mixto);
    expect(rv.errores).toEqual((await importar(new AlmacenMemoria(), r, mixto)).errores);
    expect(rv.errores[0]).toMatch(/^Bloque 1: /);
    expect(rv.bloques.map((b) => b.tema)).toEqual(["Bueno"]);
    expect(rv.puedeConfirmar).toBe(true);
    expect(await total(a)).toEqual({ tarjetas: 0, areas: 0, importaciones: 0, apuntes: 0 });
  });
});

describe("proximaFechaDeRepaso", () => {
  const base = { updated_at: "2026-01-01T00:00:00.000Z", deleted_at: null, rev: null };
  const area = (id: string, nombre: string, padre_id: string | null = null): Area => ({ ...base, created_at: base.updated_at, id, nombre, nombre_normalizado: nombre.toLowerCase(), padre_id });
  let n = 0;
  const tj = (area_id: string, extra: Partial<Tarjeta> = {}): Tarjeta => ({
    ...base, created_at: base.updated_at, id: `t${++n}`, area_id, pregunta: `p${n}`, respuesta: "r", pista: null, suspendida: false, importacion_id: null,
    ease: 2.5, intervalo: 3, reps: 2, lapses: 0, vence: "2026-12-01", contenido_updated_at: base.updated_at, repaso_updated_at: base.updated_at, ...extra,
  });

  it("P4: devuelve el menor vencimiento futuro de las tarjetas activas dentro del filtro (el área incluye sus subáreas)", async () => {
    const { a, r } = nuevo();
    await a.areas.guardarVarios([area("prog", "Programación"), area("cs50", "CS50", "prog"), area("idi", "Idiomas")]);
    await a.tarjetas.guardarVarios([
      tj("prog", { vence: "2026-12-20" }), tj("cs50", { vence: "2026-11-27" }), tj("cs50", { vence: "2026-11-25", suspendida: true }),
      tj("idi", { vence: "2026-11-24" }), tj("idi", { vence: "2026-11-23", deleted_at: "2026-11-01T00:00:00.000Z" }),
    ]);
    expect(await proximaFechaDeRepaso(a, r)).toBe("2026-11-24");
    expect(await proximaFechaDeRepaso(a, r, { areaId: "prog" })).toBe("2026-11-27");
    expect(await proximaFechaDeRepaso(a, r, { areaId: "cs50" })).toBe("2026-11-27");
    expect(await proximaFechaDeRepaso(a, r, { areaId: "idi" })).toBe("2026-11-24");
  });

  it("P4: sin tarjetas activas es null; si algo toca hoy devuelve hoy; las nuevas sobre el tope cuentan como mañana", async () => {
    const { a, r } = nuevo();
    await a.areas.guardarVarios([area("x", "X"), area("y", "Y")]);
    expect(await proximaFechaDeRepaso(a, r)).toBeNull();
    await a.tarjetas.guardarVarios([tj("x", { vence: "2026-12-05", suspendida: true })]);
    expect(await proximaFechaDeRepaso(a, r, { areaId: "x" })).toBeNull();
    await a.tarjetas.guardarVarios([tj("y", { vence: HOY })]);
    expect(await proximaFechaDeRepaso(a, r, { areaId: "y" })).toBe(HOY);
    // 3 nuevas con tope 1: queda una en la cola (hoy); tras calificarla, las otras caen "mañana".
    const nuevas = [1, 2, 3].map(() => tj("x", { intervalo: 0, reps: 0, vence: HOY }));
    await a.tarjetas.guardarVarios(nuevas);
    expect(await proximaFechaDeRepaso(a, r, { areaId: "x", limiteNuevas: 1 })).toBe(HOY);
    await calificarYGuardar(a, r, (await import("../src/compartido/repaso.ts").then((m) => m.construirCola(a, r, { limiteNuevas: 1 })))[0]!.id, "facil");
    expect(await proximaFechaDeRepaso(a, r, { areaId: "x", limiteNuevas: 1 })).toBe("2026-11-23");
  });
});
