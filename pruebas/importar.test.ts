import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../src/compartido/almacen.ts";
import { diaLogico } from "../src/compartido/dia.ts";
import { normalizar } from "../src/compartido/normalizar.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { deshacerUltimaImportacion, importar } from "../src/compartido/importacion/importar.ts";

const BLOQUE = {
  tipo: "aprendizaje", fecha: "2026-11-22", area: "Programación > CS50", tema: "Funciones en Python",
  resumen: "Resumen de 2 a 4 líneas.",
  preguntas: [
    { p: "¿Qué hace return?", r: "Devuelve un valor y termina la función.", pista: "Pensá en el código que sigue." },
    { p: "¿Qué es un parámetro?", r: "Una variable de la definición." },
    { p: "¿Qué es un argumento?", r: "El valor que se pasa al llamar." },
  ],
};
const JSON_OK = JSON.stringify(BLOQUE);
// 22/11/2026 12:00 en Buenos Aires (UTC-3)
const nuevo = () => ({ a: new AlmacenMemoria(), r: new RelojSimulado("2026-11-22T15:00:00.000Z") });

describe("importación", () => {
  it("I1: bloque válido con 3 preguntas crea 3 tarjetas, área con subárea y el resumen como apunte", async () => {
    const { a, r } = nuevo();
    const inf = await importar(a, r, JSON_OK);
    expect(inf).toMatchObject({ creadas: 3, duplicadas: 0, errores: [], avisos: [] });
    const ts = await a.tarjetas.listar();
    expect(ts).toHaveLength(3);
    for (const t of ts) expect(t).toMatchObject({ ease: 2.5, intervalo: 0, reps: 0, lapses: 0, vence: "2026-11-22" });
    const areas = await a.areas.listar();
    const prog = areas.find((x) => x.nombre === "Programación")!;
    const cs50 = areas.find((x) => x.nombre === "CS50")!;
    expect(prog.padre_id).toBeNull();
    expect(cs50.padre_id).toBe(prog.id);
    expect(ts.every((t) => t.area_id === cs50.id)).toBe(true);
    const aps = await a.apuntes.listar();
    expect(aps).toHaveLength(1);
    expect(aps[0]).toMatchObject({ tipo: "aprendizaje", tema: "Funciones en Python", texto: "Resumen de 2 a 4 líneas." });
    const imps = await a.importaciones.listar();
    expect(imps[0]!.tarjetas_creadas.sort()).toEqual(ts.map((t) => t.id).sort());
  });

  it("I2: importar el mismo bloque otra vez crea 0 y omite 3 duplicadas; el total sigue en 3", async () => {
    const { a, r } = nuevo();
    await importar(a, r, JSON_OK);
    const inf = await importar(a, r, JSON_OK);
    expect(inf.creadas).toBe(0);
    expect(inf.duplicadas).toBe(3);
    expect(await a.tarjetas.listar()).toHaveLength(3);
    expect(await a.apuntes.listar()).toHaveLength(1);
  });

  it("I2: reimportar tras editar una tarjeta no pisa la edición y avisa si la respuesta difiere", async () => {
    const { a, r } = nuevo();
    await importar(a, r, JSON_OK);
    const t = (await a.tarjetas.listar())[0]!;
    await a.tarjetas.guardar({ ...t, respuesta: "Editada por mí" });
    const inf = await importar(a, r, JSON_OK);
    expect(inf.duplicadas).toBe(3);
    expect(inf.avisos).toHaveLength(1);
    expect((await a.tarjetas.obtener(t.id))!.respuesta).toBe("Editada por mí");
  });

  it("I3: cercas de código, comillas tipográficas y coma final se importan igual que en I1", async () => {
    const { a, r } = nuevo();
    const sucio = "```json\n" + JSON.stringify(BLOQUE, null, 1).replace(/\}\s*\]/, "},\n ]").replace('"tema": "Funciones en Python"', "“tema”: “Funciones en Python”") + "\n```";
    expect(sucio).toContain(",\n ]");
    const inf = await importar(a, r, sucio);
    expect(inf).toMatchObject({ creadas: 3, duplicadas: 0, errores: [] });
    expect((await a.apuntes.listar())[0]!.tema).toBe("Funciones en Python");
    const b = nuevo();
    const inf2 = await importar(b.a, b.r, '```\n{"tipo":"aprendizaje","fecha":"2026-11-22","area":"X","tema":"T","preguntas":[{"p":"a","r":"b",},],}\n```');
    expect(inf2).toMatchObject({ creadas: 1, errores: [] });
  });

  it("I4: JSON cortado a la mitad crea 0, informa la posición y conserva el texto original", async () => {
    const { a, r } = nuevo();
    const cortado = JSON_OK.slice(0, Math.floor(JSON_OK.length / 2));
    const inf = await importar(a, r, cortado);
    expect(inf.creadas).toBe(0);
    expect(await a.tarjetas.listar()).toHaveLength(0);
    expect(inf.errores).toHaveLength(1);
    expect(inf.errores[0]).toMatch(/posición \d+/);
    expect(inf.texto_original).toBe(cortado);
    const mal = await importar(a, r, '{"tipo": aprendizaje}');
    expect(mal.creadas).toBe(0);
    expect(mal.errores[0]).toMatch(/posición \d+/);
  });

  it("I5: sin 'preguntas' y con 'r' vacía se rechazan nombrando el campo", async () => {
    const { a, r } = nuevo();
    const { preguntas: _p, ...sinPreguntas } = BLOQUE;
    const i1 = await importar(a, r, JSON.stringify(sinPreguntas));
    expect(i1.creadas).toBe(0);
    expect(i1.errores.join(" ")).toContain('"preguntas"');
    const rVacia = { ...BLOQUE, preguntas: [{ p: "¿Algo?", r: "" }, BLOQUE.preguntas[0]] };
    const i2 = await importar(a, r, JSON.stringify(rVacia));
    expect(i2.creadas).toBe(0);
    expect(i2.errores.join(" ")).toContain('"r"');
    expect(await a.tarjetas.listar()).toHaveLength(0);
    const ft = await importar(a, r, JSON.stringify({ ...BLOQUE, fecha: "2026-02-30" }));
    expect(ft.errores.join(" ")).toContain('"fecha"');
    const tp = await importar(a, r, JSON.stringify({ ...BLOQUE, tipo: "tareas" }));
    expect(tp.errores).toEqual(["Tipo no soportado: tareas"]);
  });

  it("I6: 'programacion > cs50' con 'Programación > CS50' existente no crea un área nueva", async () => {
    const { a, r } = nuevo();
    await importar(a, r, JSON_OK);
    const antes = (await a.areas.listar()).length;
    const inf = await importar(a, r, JSON.stringify({ ...BLOQUE, area: " programacion  >  cs50 ", preguntas: [{ p: "Nueva", r: "x" }] }));
    expect(inf.creadas).toBe(1);
    const areas = await a.areas.listar();
    expect(areas).toHaveLength(antes);
    expect(areas.map((x) => x.nombre).sort()).toEqual(["CS50", "Programación"]);
  });

  it("I6: área sin subárea se acepta y la tarjeta queda en el nivel Área", async () => {
    const { a, r } = nuevo();
    await importar(a, r, JSON.stringify({ ...BLOQUE, area: "Historia" }));
    const areas = await a.areas.listar();
    expect(areas).toHaveLength(1);
    expect((await a.tarjetas.listar())[0]!.area_id).toBe(areas[0]!.id);
  });

  it("I7: deshacer la última importación manda sus tarjetas y el apunte a la papelera", async () => {
    const { a, r } = nuevo();
    await importar(a, r, JSON_OK);
    await importar(a, r, JSON.stringify({ ...BLOQUE, tema: "Otro", area: "Mate", preguntas: [{ p: "2+2", r: "4" }] }));
    r.avanzarMinutos(1);
    const res = await deshacerUltimaImportacion(a, r);
    expect(res).toEqual({ tarjetas: 1 });
    const hoy = diaLogico(r);
    const cola = (await a.tarjetas.listar()).filter((t) => !t.suspendida && t.vence <= hoy);
    expect(cola).toHaveLength(3);
    const todas = await a.tarjetas.listar({ incluirBorrados: true });
    expect(todas.filter((t) => t.deleted_at !== null)).toHaveLength(1);
    expect((await a.apuntes.listar()).map((x) => x.tema)).toEqual(["Funciones en Python"]);
    // deshacer de nuevo retrocede a la anterior
    await deshacerUltimaImportacion(a, r);
    expect(await a.tarjetas.listar()).toHaveLength(0);
    expect(await a.apuntes.listar()).toHaveLength(0);
    // y reimportar crea de nuevo
    expect((await importar(a, r, JSON_OK)).creadas).toBe(3);
  });
});

describe("varios bloques y utilidades", () => {
  it("bloques pegados juntos o en arreglo se procesan por separado; uno con error no frena a los otros", async () => {
    const { a, r } = nuevo();
    const malo = { ...BLOQUE, tipo: "x", tema: "Malo" };
    const otro = { ...BLOQUE, tema: "Otro", area: "Mate", preguntas: [{ p: "2+2", r: "4" }] };
    const inf = await importar(a, r, [JSON_OK, JSON.stringify(malo), JSON.stringify(otro)].join("\n\n"));
    expect(inf.creadas).toBe(4);
    expect(inf.errores).toEqual(["Bloque 2: Tipo no soportado: x"]);
    const b = nuevo();
    expect((await importar(b.a, b.r, JSON.stringify([BLOQUE, otro]))).creadas).toBe(4);
  });

  it("normalizar quita mayúsculas, tildes y signos", () => {
    expect(normalizar("  ¿Qué HACE Return?! ")).toBe("que hace return");
    expect(normalizar("Programación")).toBe(normalizar("programacion"));
  });

  it("diaLogico cambia a las 04:00 de Buenos Aires", () => {
    const r = new RelojSimulado("2026-11-22T06:59:00.000Z"); // 03:59 ART
    expect(diaLogico(r)).toBe("2026-11-21");
    r.fijar("2026-11-22T07:00:00.000Z"); // 04:00 ART
    expect(diaLogico(r)).toBe("2026-11-22");
  });
});
