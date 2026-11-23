import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../src/compartido/almacen.ts";
import { importarRespaldoOriginal, type ArchivoAImportar } from "../src/compartido/migracion-original.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { crc32, leerZip } from "../src/compartido/zip.ts";

const leer = (ruta: string) => new Uint8Array(readFileSync(new URL(ruta, import.meta.url)));
const ZIP_REAL = leer("./fixtures/respaldo-original.zip");
const EJEMPLO = leer("../prototipo/ejemplos/aprendizaje_ejemplo.json");
const enc = (s: string) => new TextEncoder().encode(s);
const json = (nombre: string, valor: unknown): ArchivoAImportar => ({ nombre, bytes: enc(JSON.stringify(valor)) });

// 22/11/2026 12:00 en Buenos Aires (UTC-3): hoy = 2026-11-22
const nuevo = () => ({ a: new AlmacenMemoria(), r: new RelojSimulado("2026-11-22T15:00:00.000Z") });
const zipReal = (): ArchivoAImportar => ({ nombre: "lean-os-2026-11-22.zip", bytes: ZIP_REAL });

function area(nombre: string, temas: unknown[] = []) {
  return { slug: "x", nombre, creada: "2026-11-01", temas };
}
function tema(nombre: string, preguntas: unknown[], extra: Record<string, unknown> = {}) {
  return { id: "t1", tema: nombre, fecha: "2026-11-10", resumen: "Resumen.", preguntas, ...extra };
}
function preg(p: string, nivel: unknown = 0, proxima: unknown = "2026-11-22", extra: Record<string, unknown> = {}) {
  return { id: "q", p, r: `Resp ${p}`, pista: "", nivel, proxima, ultima_vez: null, ...extra };
}
const nombresAreas = async (a: AlmacenMemoria) => (await a.areas.listar()).map((x) => x.nombre).sort();

// ZIP "stored" (método 0) armado a mano, para probar el lector sin depender del fixture.
function zipGuardado(entradas: { nombre: string; datos: Uint8Array }[]): Uint8Array {
  const partes: number[] = [];
  const central: number[] = [];
  const u16 = (n: number) => [n & 255, (n >> 8) & 255];
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const e of entradas) {
    const nombre = [...enc(e.nombre)];
    const crc = crc32(e.datos);
    const inicio = partes.length;
    partes.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(e.datos.length), ...u32(e.datos.length), ...u16(nombre.length), ...u16(0), ...nombre, ...e.datos);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(e.datos.length), ...u32(e.datos.length), ...u16(nombre.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(inicio), ...nombre);
  }
  const fin = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entradas.length), ...u16(entradas.length), ...u32(central.length), ...u32(partes.length), ...u16(0)];
  return new Uint8Array([...partes, ...central, ...fin]);
}

describe("migración del Lean OS original", () => {
  it("P10: el ZIP real de 'Exportar todo' crea áreas, subáreas, importaciones, apuntes y tarjetas con su pista", async () => {
    const { a, r } = nuevo();
    const inf = await importarRespaldoOriginal(a, r, [zipReal()]);
    expect(inf.errores).toEqual([]);
    expect(inf).toMatchObject({ areas: 3, subareas: 4, temas: 4, creadas: 11, duplicadas: 0 });
    expect(await nombresAreas(a)).toEqual(["CS50", "Historia", "Idiomas", "Inglés", "Programación", "Python", "Python › Decoradores"]);
    const areas = await a.areas.listar();
    const prog = areas.find((x) => x.nombre === "Programación")!;
    const cs50 = areas.find((x) => x.nombre === "CS50")!;
    expect(prog.padre_id).toBeNull();
    expect(cs50.padre_id).toBe(prog.id);
    expect(areas.find((x) => x.nombre === "Historia")!.padre_id).toBeNull(); // área vacía, creada igual
    const imps = await a.importaciones.listar();
    expect(imps).toHaveLength(4);
    const punteros = imps.find((i) => i.tema === "Punteros en C")!;
    expect(punteros).toMatchObject({ fecha_bloque: "2026-11-14", area_id: cs50.id, duplicadas_omitidas: 0 });
    expect(punteros.tarjetas_creadas).toHaveLength(3);
    const apuntes = await a.apuntes.listar();
    expect(apuntes).toHaveLength(4);
    const ap = apuntes.find((x) => x.id === punteros.apunte_id)!;
    expect(ap).toMatchObject({ tipo: "aprendizaje", tema: "Punteros en C", importacion_id: punteros.id, area_id: cs50.id });
    const ts = await a.tarjetas.listar();
    expect(ts.find((t) => t.pregunta === "¿Qué guarda un puntero?")!.pista).toBe("Una dirección postal.");
    expect(ts.find((t) => t.pregunta === "¿Qué operador devuelve la dirección?")!.pista).toBeNull();
    // Ignoró papelera/ e importados.json
    expect(areas.some((x) => x.nombre === "Vieja")).toBe(false);
  });

  it("P10: traduce el nivel 0 a 5 del original a intervalo, reps, ease y vencimiento", async () => {
    const { a, r } = nuevo();
    await importarRespaldoOriginal(a, r, [zipReal()]);
    const ts = (await a.tarjetas.listar()).filter((t) => t.pregunta.startsWith("¿Cómo se dice"));
    expect(ts).toHaveLength(6);
    const esperado = [
      { reps: 0, intervalo: 0, vence: "2026-11-22" },
      { reps: 1, intervalo: 1, vence: "2026-11-23" },
      { reps: 2, intervalo: 3, vence: "2026-11-25" },
      { reps: 3, intervalo: 7, vence: "2026-12-13" },
      { reps: 4, intervalo: 21, vence: "2027-01-21" },
      { reps: 5, intervalo: 60, vence: "2027-01-22" },
    ];
    for (const [n, e] of esperado.entries()) {
      expect(ts[n], `nivel ${n}`).toMatchObject({ ...e, ease: 2.5, lapses: 0, suspendida: false });
    }
    expect(ts[3]!.repaso_updated_at).toBe("2026-11-23T12:00:00.000Z"); // ultima_vez del original
    expect(ts[0]!.repaso_updated_at).toBe("2026-11-22T15:00:00.000Z"); // sin ultima_vez: ahora
    expect(ts[0]!.contenido_updated_at).toBe("2026-11-22T15:00:00.000Z");
  });

  it("P10: nivel 0 con proxima anterior a hoy vence hoy; con nivel 1 a 5 se respeta la proxima aunque haya pasado", async () => {
    const { a, r } = nuevo();
    await importarRespaldoOriginal(a, r, [json("a.json", area("Mate", [tema("T", [preg("uno", 0, "2026-01-01"), preg("dos", 2, "2026-01-05"), preg("tres", 0, "2026-12-30")])]))]);
    const ts = await a.tarjetas.listar();
    expect(ts.find((t) => t.pregunta === "uno")!.vence).toBe("2026-11-22");
    expect(ts.find((t) => t.pregunta === "dos")).toMatchObject({ vence: "2026-01-05", intervalo: 3, reps: 2 });
    expect(ts.find((t) => t.pregunta === "tres")!.vence).toBe("2026-12-30");
  });

  it("P10: un archivo de área suelto, con tildes y subárea, se importa", async () => {
    const { a, r } = nuevo();
    const inf = await importarRespaldoOriginal(a, r, [json("areas/matematica.json", area("Matemática > Álgebra", [tema("Ecuaciones", [preg("¿x + 1 = 2?")])]))]);
    expect(inf).toMatchObject({ areas: 1, subareas: 1, temas: 1, creadas: 1, duplicadas: 0, errores: [] });
    expect(await nombresAreas(a)).toEqual(["Matemática", "Álgebra"]);
  });

  it("P10: acepta varias áreas en un arreglo o en { areas: [...] }", async () => {
    const { a, r } = nuevo();
    const inf = await importarRespaldoOriginal(a, r, [
      json("todo.json", { areas: [area("Uno", [tema("T", [preg("p1")])]), area("Dos", [tema("T", [preg("p2")])])] }),
      json("lista.json", [area("Tres", [tema("T", [preg("p3")])])]),
    ]);
    expect(inf).toMatchObject({ areas: 3, creadas: 3, errores: [] });
  });

  it("P10: prototipo/ejemplos/aprendizaje_ejemplo.json da 3 tarjetas en CS50", async () => {
    const { a, r } = nuevo();
    const inf = await importarRespaldoOriginal(a, r, [{ nombre: "aprendizaje_ejemplo.json", bytes: EJEMPLO }]);
    expect(inf).toMatchObject({ creadas: 3, duplicadas: 0, errores: [] });
    const cs50 = (await a.areas.listar()).find((x) => x.nombre === "CS50")!;
    const ts = await a.tarjetas.listar();
    expect(ts).toHaveLength(3);
    expect(ts.every((t) => t.area_id === cs50.id)).toBe(true);
    expect(ts.every((t) => t.intervalo === 0 && t.reps === 0 && t.ease === 2.5)).toBe(true);
    expect(await a.apuntes.listar()).toHaveLength(1);
  });

  it("P10: un área de 3 niveles se aplana en la subárea con ' › ' y se avisa", async () => {
    const { a, r } = nuevo();
    const inf = await importarRespaldoOriginal(a, r, [json("a.json", area("A > B > C", [tema("T", [preg("p")])]))]);
    expect(inf.errores).toEqual([]);
    expect(inf.avisos.some((m) => m.includes("A > B > C") && m.includes("B › C"))).toBe(true);
    const areas = await a.areas.listar();
    const raiz = areas.find((x) => x.nombre === "A")!;
    const sub = areas.find((x) => x.nombre === "B › C")!;
    expect(sub.padre_id).toBe(raiz.id);
    expect((await a.tarjetas.listar())[0]!.area_id).toBe(sub.id);
  });

  it("P10: nombres con otras mayúsculas o tildes se unen con el área que ya existe", async () => {
    const { a, r } = nuevo();
    await importarRespaldoOriginal(a, r, [json("1.json", area("Programación > CS50", [tema("T1", [preg("p1")])]))]);
    const inf = await importarRespaldoOriginal(a, r, [json("2.json", area("programacion > cs50", [tema("T2", [preg("p2")])]))]);
    expect(inf.errores).toEqual([]);
    expect(await nombresAreas(a)).toEqual(["CS50", "Programación"]);
    const cs50 = (await a.areas.listar()).find((x) => x.nombre === "CS50")!;
    expect((await a.tarjetas.listar()).every((t) => t.area_id === cs50.id)).toBe(true);
  });

  it("P10: un tema sin preguntas guarda solo el resumen, y uno sin nada se avisa", async () => {
    const { a, r } = nuevo();
    const inf = await importarRespaldoOriginal(a, r, [json("a.json", area("Hist", [tema("Solo resumen", []), tema("Nada", [], { resumen: "" })]))]);
    expect(inf).toMatchObject({ temas: 2, creadas: 0, errores: [] });
    expect(inf.avisos.length).toBe(2);
    expect(await a.apuntes.listar()).toHaveLength(1);
    expect(await a.importaciones.listar()).toHaveLength(1);
    // idempotente también para el resumen solo
    await importarRespaldoOriginal(a, r, [json("a.json", area("Hist", [tema("Solo resumen", [])]))]);
    expect(await a.apuntes.listar()).toHaveLength(1);
  });

  it("P10: niveles y fechas inválidos se sanean con aviso y no lanzan", async () => {
    const { a, r } = nuevo();
    const inf = await importarRespaldoOriginal(a, r, [
      json("a.json", area("Raro", [
        tema("T", [
          preg("nivel 9", 9, "2026-12-01"),
          preg("nivel texto", "alto", "2026-12-01"),
          preg("nivel decimal", 2.5, "2026-12-01"),
          preg("fecha mala", 3, "31/12/2026"),
          preg("fecha imposible", 1, "2026-02-31"),
          preg("ultima mala", 0, "2026-11-22", { ultima_vez: "ayer" }),
          preg("", 0),
          { p: "sin respuesta", r: "" },
          "no soy una pregunta",
        ], { fecha: "no-es-fecha" }),
      ])),
    ]);
    expect(inf.errores).toEqual([]);
    expect(inf.creadas).toBe(6);
    const ts = await a.tarjetas.listar();
    for (const n of ["nivel 9", "nivel texto", "nivel decimal"]) expect(ts.find((t) => t.pregunta === n)).toMatchObject({ reps: 0, intervalo: 0 });
    expect(ts.find((t) => t.pregunta === "fecha mala")).toMatchObject({ reps: 3, intervalo: 7, vence: "2026-11-22" });
    expect(ts.find((t) => t.pregunta === "fecha imposible")!.vence).toBe("2026-11-22");
    expect(ts.find((t) => t.pregunta === "ultima mala")!.repaso_updated_at).toBe("2026-11-22T15:00:00.000Z");
    expect((await a.importaciones.listar())[0]!.fecha_bloque).toBe("2026-11-22");
    expect(inf.avisos.filter((m) => m.includes("nivel")).length).toBe(3);
    expect(inf.avisos.some((m) => m.includes("fecha"))).toBe(true);
    expect(inf.avisos.filter((m) => m.includes("omitió")).length).toBe(3);
  });

  it("P11: importar el mismo respaldo dos veces crea 0 la segunda y no suma importaciones ni apuntes", async () => {
    const { a, r } = nuevo();
    const primera = await importarRespaldoOriginal(a, r, [zipReal()]);
    const antes = { t: (await a.tarjetas.listar()).length, i: (await a.importaciones.listar()).length, ap: (await a.apuntes.listar()).length, ar: (await a.areas.listar()).length };
    r.avanzarDias(1);
    const segunda = await importarRespaldoOriginal(a, r, [zipReal()]);
    expect(primera.creadas).toBe(11);
    expect(segunda).toMatchObject({ creadas: 0, duplicadas: 11, errores: [] });
    expect({ t: (await a.tarjetas.listar()).length, i: (await a.importaciones.listar()).length, ap: (await a.apuntes.listar()).length, ar: (await a.areas.listar()).length }).toEqual(antes);
  });

  it("P11: una tarjeta ya existente y calificada no se pisa", async () => {
    const { a, r } = nuevo();
    await importarRespaldoOriginal(a, r, [json("a.json", area("Mate", [tema("T1", [preg("¿Cuánto es 2+2?", 0)])]))]);
    const t0 = (await a.tarjetas.listar())[0]!;
    await a.tarjetas.guardar({ ...t0, ease: 2.1, intervalo: 9, reps: 4, lapses: 1, vence: "2026-12-05", respuesta: "Cuatro (editada)" });
    const inf = await importarRespaldoOriginal(a, r, [json("b.json", area("MATE", [tema("T2", [preg("¿cuanto es 2+2?", 5, "2027-03-01"), preg("Otra nueva", 3, "2026-12-01")])]))]);
    expect(inf).toMatchObject({ creadas: 1, duplicadas: 1, errores: [] });
    expect(inf.avisos.some((m) => m.includes("otra respuesta"))).toBe(true);
    const ts = await a.tarjetas.listar();
    expect(ts).toHaveLength(2);
    expect(ts.find((t) => t.id === t0.id)).toMatchObject({ ease: 2.1, intervalo: 9, reps: 4, lapses: 1, vence: "2026-12-05", respuesta: "Cuatro (editada)" });
    // el tema nuevo registra solo la tarjeta nueva
    const imp = (await a.importaciones.listar()).find((i) => i.tema === "T2")!;
    expect(imp.tarjetas_creadas).toHaveLength(1);
    expect(imp.duplicadas_omitidas).toBe(1);
  });

  it("P11: un archivo dañado, uno ajeno, uno vacío y un ZIP truncado dan mensaje claro y no cambian nada; los demás siguen", async () => {
    const { a, r } = nuevo();
    const ok = json("bueno.json", area("Bien", [tema("T", [preg("p")])]));
    const inf = await importarRespaldoOriginal(a, r, [
      { nombre: "roto.json", bytes: enc('{"slug": "x", "nombre": "Roto", "temas": [') },
      json("ajeno.json", { hola: "mundo" }),
      json("config.json", { tema: "oscuro", version: 3 }),
      { nombre: "texto.json", bytes: enc("esto no es json") },
      { nombre: "vacio.json", bytes: new Uint8Array(0) },
      { nombre: "binario.json", bytes: new Uint8Array([0xff, 0xfe, 0x00, 0xc3, 0x28]) },
      { nombre: "truncado.zip", bytes: ZIP_REAL.slice(0, ZIP_REAL.length - 40) },
      { nombre: "mitad.zip", bytes: ZIP_REAL.slice(0, 1000) },
      { nombre: "sin-areas.zip", bytes: zipGuardado([{ nombre: "otra/cosa.txt", datos: enc("hola") }]) },
      ok,
    ]);
    expect(inf.errores).toHaveLength(9);
    for (const nombre of ["roto.json", "ajeno.json", "config.json", "texto.json", "vacio.json", "binario.json", "truncado.zip", "mitad.zip", "sin-areas.zip"]) {
      expect(inf.errores.some((e) => e.includes(`"${nombre}"`) && e.includes("No se cambió nada")), nombre).toBe(true);
    }
    expect(inf.errores.every((e) => !/SyntaxError|undefined|\bat \w+/.test(e))).toBe(true);
    expect(inf.creadas).toBe(1);
    expect(await nombresAreas(a)).toEqual(["Bien"]);
  });

  it("P11: un área con formato inválido dentro de un arreglo no cambia nada de ese archivo", async () => {
    const { a, r } = nuevo();
    const inf = await importarRespaldoOriginal(a, r, [json("mezcla.json", [area("Buena", [tema("T", [preg("p")])]), { nombre: "Mala", temas: "no" }])]);
    expect(inf.errores).toHaveLength(1);
    expect(inf.errores[0]).toContain("mezcla.json");
    expect(await a.areas.listar()).toHaveLength(0);
    expect(await a.tarjetas.listar()).toHaveLength(0);
  });

  it("P11: nada de lanzar con valores raros (null, números, arreglos vacíos)", async () => {
    const { a, r } = nuevo();
    const inf = await importarRespaldoOriginal(a, r, [json("n.json", null), json("x.json", 42), json("v.json", []), json("o.json", {}), json("t.json", { nombre: 5 })]);
    expect(inf.errores).toHaveLength(5);
    expect(await a.areas.listar()).toHaveLength(0);
    const sin = await importarRespaldoOriginal(a, r, []);
    expect(sin.errores).toEqual(["No elegiste ningún archivo."]);
  });

  it("P11: en un ZIP se ignoran importados.json, papelera/, respaldos/ y rutas con '..'", async () => {
    const { a, r } = nuevo();
    const mala = enc(JSON.stringify(area("Mala", [tema("T", [preg("m")])])));
    const buena = enc(JSON.stringify(area("Buena", [tema("T", [preg("b")])])));
    const zip = zipGuardado([
      { nombre: "importados.json", datos: enc("{}") },
      { nombre: "papelera/areas/mala.json", datos: mala },
      { nombre: "papelera/vieja.json", datos: mala },
      { nombre: "respaldos/areas/mala.json", datos: mala },
      { nombre: "../areas/escape.json", datos: mala },
      { nombre: "areas/../../areas/escape2.json", datos: mala },
      { nombre: "areas/buena.json", datos: buena },
    ]);
    const inf = await importarRespaldoOriginal(a, r, [{ nombre: "r.zip", bytes: zip }]);
    expect(inf).toMatchObject({ creadas: 1, errores: [] });
    expect(await nombresAreas(a)).toEqual(["Buena"]);
  });

  it("P11: el lector ZIP rechaza bombas, demasiados archivos, cifrado y ZIP64 con mensajes en castellano", async () => {
    const grande = zipGuardado([{ nombre: "areas/a.json", datos: new Uint8Array(200) }]);
    await expect(leerZip(grande, () => true, { maxArchivos: 2000, maxBytes: 100 })).rejects.toThrow(/demasiado grande/);
    const varios = zipGuardado([1, 2, 3].map((n) => ({ nombre: `areas/${n}.json`, datos: enc("{}") })));
    await expect(leerZip(varios, () => true, { maxArchivos: 2, maxBytes: 1000 })).rejects.toThrow(/demasiados archivos/);
    const cifrado = grande.slice(); // el flag de cifrado va en el directorio central
    const dv = new DataView(cifrado.buffer);
    const central = dv.getUint32(cifrado.length - 6, true);
    cifrado[central + 8]! |= 1;
    await expect(leerZip(cifrado)).rejects.toThrow(/cifrado/);
    const zip64 = grande.slice();
    new DataView(zip64.buffer).setUint16(zip64.length - 22 + 10, 0xffff, true);
    await expect(leerZip(zip64)).rejects.toThrow(/ZIP64/);
    // contenido alterado: no coincide el CRC
    const alterado = grande.slice();
    alterado[100] = 0x41;
    await expect(leerZip(alterado)).rejects.toThrow(/dañado/);
  });

  it("P11: una bomba de descompresión (deflate que declara poco y expande mucho) se corta", async () => {
    const { a, r } = nuevo();
    const { deflateRawSync } = await import("node:zlib");
    const real = new Uint8Array(60 * 1024 * 1024);
    const comprimido = new Uint8Array(deflateRawSync(real));
    expect(comprimido.length).toBeLessThan(200_000);
    // Armamos un ZIP con método 8 cuyo tamaño declarado es mentira (10) y el CRC es el del contenido real chico.
    const nombre = [...enc("areas/bomba.json")];
    const u16 = (n: number) => [n & 255, (n >> 8) & 255];
    const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    const local = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0), ...u32(0), ...u32(comprimido.length), ...u32(10), ...u16(nombre.length), ...u16(0), ...nombre];
    const central = [...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0), ...u32(0), ...u32(comprimido.length), ...u32(10), ...u16(nombre.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...nombre];
    const fin = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(1), ...u16(1), ...u32(central.length), ...u32(local.length + comprimido.length), ...u16(0)];
    const zip = new Uint8Array([...local, ...comprimido, ...central, ...fin]);
    const inf = await importarRespaldoOriginal(a, r, [{ nombre: "bomba.zip", bytes: zip }]);
    expect(inf.errores).toHaveLength(1);
    expect(inf.errores[0]).toMatch(/bomba\.zip.*(demasiado grande|dañado)/);
    expect(await a.areas.listar()).toHaveLength(0);
  });

  it("P10: lo importado queda listo para sincronizar (ids, created/updated, rev null, sin borrar)", async () => {
    const { a, r } = nuevo();
    await importarRespaldoOriginal(a, r, [zipReal()]);
    const todos = [
      ...(await a.areas.listar()), ...(await a.tarjetas.listar()), ...(await a.apuntes.listar()), ...(await a.importaciones.listar()),
    ];
    const ids = new Set(todos.map((x) => x.id));
    expect(ids.size).toBe(todos.length);
    for (const x of todos) {
      expect(x.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(x.rev).toBeNull();
      expect(x.deleted_at).toBeNull();
      expect(x.created_at).toBe("2026-11-22T15:00:00.000Z");
      expect(x.updated_at).toBe("2026-11-22T15:00:00.000Z");
    }
    // Cada tarjeta apunta a un área y a una importación que existen.
    const idsAreas = new Set((await a.areas.listar()).map((x) => x.id));
    const idsImp = new Set((await a.importaciones.listar()).map((x) => x.id));
    for (const t of await a.tarjetas.listar()) {
      expect(idsAreas.has(t.area_id)).toBe(true);
      expect(idsImp.has(t.importacion_id!)).toBe(true);
    }
  });
});
