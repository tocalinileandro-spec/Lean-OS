import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../src/compartido/almacen.ts";
import {
  borrarArea, borrarSubarea, borrarTema, colaDeRepaso, contadoresDeRepaso, contextoDeTarjeta, crearArea, detalleArea,
  moverTema, resumenAreas, resumenDeBorrado, restaurarArea, restaurarTema,
} from "../src/compartido/areas.ts";
import type { Area, Tarjeta } from "../src/compartido/esquema.ts";
import { borrarTarjeta, listarPapelera, purgarPapelera } from "../src/compartido/gestion.ts";
import { importar } from "../src/compartido/importacion/importar.ts";
import { calcularEstadisticas } from "../src/compartido/estadisticas.ts";
import { construirCola, calificarYGuardar } from "../src/compartido/repaso.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { itemsPapelera, restaurarItem } from "../src/cliente/ui/logica-tareas.ts";

const HOY = "2026-11-22";
const AHORA = "2026-11-22T15:00:00.000Z"; // 12:00 en Buenos Aires
const nuevo = () => ({ a: new AlmacenMemoria(), r: new RelojSimulado(AHORA) });
const base = { updated_at: "2026-01-01T00:00:00.000Z", deleted_at: null, rev: null };
let n = 0;
const area = (id: string, nombre: string, padre_id: string | null = null): Area => ({
  ...base, created_at: "2026-01-01T00:00:00.000Z", id, nombre, nombre_normalizado: nombre.toLowerCase(), padre_id,
});
const tj = (area_id: string, extra: Partial<Tarjeta> = {}): Tarjeta => {
  const i = ++n;
  const creada = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString();
  return {
    ...base, created_at: creada, id: `t${i}`, area_id, pregunta: `p${i}`, respuesta: "r", pista: null, suspendida: false, importacion_id: null,
    ease: 2.5, intervalo: 0, reps: 0, lapses: 0, vence: HOY, contenido_updated_at: creada, repaso_updated_at: creada, ...extra,
  };
};
const rep = (k: number, extra: Partial<Tarjeta>) => Array.from({ length: k }, () => tj(extra.area_id!, extra));

/** 3 áreas (Programación con CS50 y Python), 71 tarjetas. */
async function datosP1(a: AlmacenMemoria) {
  await a.areas.guardarVarios([
    area("prog", "Programación"), area("cs50", "CS50", "prog"), area("py", "Python", "prog"), area("idi", "Idiomas"), area("his", "Historia"),
  ]);
  const venc = (id: string, k: number, intervalo: number, vence: string, extra: Partial<Tarjeta> = {}) =>
    rep(k, { area_id: id, intervalo, reps: 3, vence, ...extra });
  await a.tarjetas.guardarVarios([
    ...rep(3, { area_id: "prog" }), // nuevas
    ...venc("cs50", 10, 30, "2026-11-20"), ...rep(7, { area_id: "cs50" }),
    ...venc("py", 8, 5, HOY), ...venc("py", 4, 40, "2026-11-01", { suspendida: true }),
    ...venc("idi", 15, 25, "2026-12-10"), ...rep(5, { area_id: "idi" }), ...venc("idi", 3, 2, "2026-11-21"),
    ...venc("his", 14, 22, "2026-11-23"), ...venc("his", 2, 1, "2026-11-21"),
  ]);
}

describe("P1: resumen de áreas", () => {
  it("P1: 71 tarjetas en 3 áreas: cantidades, para hoy, dominio y suma igual a la cola", async () => {
    const { a, r } = nuevo();
    await datosP1(a);
    expect(await a.tarjetas.listar()).toHaveLength(71);
    const res = await resumenAreas(a, r, { limiteNuevas: 5 });
    const cola = await construirCola(a, r, { limiteNuevas: 5 });
    expect(cola).toHaveLength(28);
    expect(res.totalParaHoy).toBe(28);
    expect(res.areas.reduce((s, x) => s + x.paraHoy, 0)).toBe(res.totalParaHoy);
    const por = Object.fromEntries(res.areas.map((x) => [x.nombre, x]));
    expect(res.areas.map((x) => x.nombre)).toEqual(["Historia", "Idiomas", "Programación"]);
    expect(por["Programación"]).toMatchObject({ inicial: "P", subareas: ["CS50", "Python"], tarjetas: 32, temas: 0, paraHoy: 23, dominio: 36 });
    expect(por["Idiomas"]).toMatchObject({ subareas: [], tarjetas: 23, paraHoy: 3, dominio: 65 });
    expect(por["Historia"]).toMatchObject({ tarjetas: 16, paraHoy: 2, dominio: 88 }); // 87,5 sube
  });

  it("P1: sin tarjetas el dominio es 0, las borradas no cuentan y las suspendidas cuentan como tarjetas pero no como activas", async () => {
    const { a, r } = nuevo();
    await a.areas.guardarVarios([area("v", "Vacía"), area("s", "Susp")]);
    await a.tarjetas.guardarVarios([
      tj("s", { suspendida: true, intervalo: 50, reps: 3, vence: "2027-01-01" }),
      tj("s", { deleted_at: "2026-11-01T00:00:00.000Z" }),
    ]);
    const res = await resumenAreas(a, r);
    expect(res.areas.find((x) => x.nombre === "Vacía")).toMatchObject({ tarjetas: 0, paraHoy: 0, dominio: 0 });
    expect(res.areas.find((x) => x.nombre === "Susp")).toMatchObject({ tarjetas: 1, paraHoy: 0, dominio: 0 });
    expect(res.totalParaHoy).toBe(0);
  });

  it("P1: un área borrada no aparece y sin áreas el resumen está vacío", async () => {
    const { a, r } = nuevo();
    expect(await resumenAreas(a, r)).toEqual({ areas: [], totalParaHoy: 0 });
    await a.areas.guardar({ ...area("x", "Borrada"), deleted_at: "2026-11-01T00:00:00.000Z" });
    expect((await resumenAreas(a, r)).areas).toEqual([]);
  });
});

describe("P4: contadores y filtro del repaso (parte lógica)", () => {
  it("P4: contadores por todo, área y subárea; el área incluye subáreas y respeta el tope de nuevas", async () => {
    const { a, r } = nuevo();
    await datosP1(a);
    const c = await contadoresDeRepaso(a, r, { limiteNuevas: 5 });
    expect(c.todo).toBe(28);
    const prog = c.areas.find((x) => x.nombre === "Programación")!;
    expect(prog.paraHoy).toBe(23);
    expect(prog.subareas).toEqual([
      { id: "cs50", nombre: "CS50", paraHoy: 12 }, // 10 vencidas + 2 nuevas dentro del tope
      { id: "py", nombre: "Python", paraHoy: 8 },
    ]);
    expect(c.areas.reduce((s, x) => s + x.paraHoy, 0)).toBe(c.todo);
    expect(await colaDeRepaso(a, r, { limiteNuevas: 5 })).toHaveLength(28);
    expect(await colaDeRepaso(a, r, { limiteNuevas: 5, areaId: "prog" })).toHaveLength(23);
    expect(await colaDeRepaso(a, r, { limiteNuevas: 5, areaId: "cs50" })).toHaveLength(12);
    expect((await colaDeRepaso(a, r, { limiteNuevas: 5, areaId: "py" })).every((t) => t.area_id === "py")).toBe(true);
    expect(await colaDeRepaso(a, r, { areaId: "his" })).toHaveLength(2);
  });
});

describe("P3: crear áreas", () => {
  it("P3: crea un área y una subárea que cuelga de su área", async () => {
    const { a, r } = nuevo();
    const p = await crearArea(a, r, "  Programación ");
    expect(p).toMatchObject({ creada: true, aviso: null });
    expect(p.area).toMatchObject({ nombre: "Programación", nombre_normalizado: "programacion", padre_id: null });
    const s = await crearArea(a, r, "CS50", p.area.id);
    expect(s.area.padre_id).toBe(p.area.id);
    expect(await a.areas.listar()).toHaveLength(2);
  });

  it("P3: “programacion” con “Programación” existente no duplica y avisa en castellano", async () => {
    const { a, r } = nuevo();
    const p = await crearArea(a, r, "Programación");
    const otra = await crearArea(a, r, "programacion");
    expect(otra.creada).toBe(false);
    expect(otra.area.id).toBe(p.area.id);
    expect(otra.aviso).toMatch(/Ya existe/);
    expect(await a.areas.listar()).toHaveLength(1);
    const s1 = await crearArea(a, r, "CS50", p.area.id);
    const s2 = await crearArea(a, r, "cs50", p.area.id);
    expect(s2.creada).toBe(false);
    expect(s2.area.id).toBe(s1.area.id);
    // el mismo nombre en otra área padre sí es otra subárea
    const q = await crearArea(a, r, "Matemática");
    expect((await crearArea(a, r, "CS50", q.area.id)).creada).toBe(true);
  });

  it("P3: vacío, solo signos, de más de 60 letras, con “>” y padre inválido se rechazan sin crear nada", async () => {
    const { a, r } = nuevo();
    const p = await crearArea(a, r, "Programación");
    await expect(crearArea(a, r, "   ")).rejects.toThrow(/vacío/);
    await expect(crearArea(a, r, "¿?!")).rejects.toThrow(/vacío/);
    await expect(crearArea(a, r, "x".repeat(61))).rejects.toThrow(/demasiado largo/);
    expect((await crearArea(a, r, "x".repeat(60))).creada).toBe(true);
    await expect(crearArea(a, r, "A > B")).rejects.toThrow(/“>”/);
    const s = await crearArea(a, r, "CS50", p.area.id);
    await expect(crearArea(a, r, "Hoja", s.area.id)).rejects.toThrow(/dos niveles/);
    await expect(crearArea(a, r, "Hoja", "no-existe")).rejects.toThrow(/no existe/);
    expect(await a.areas.listar()).toHaveLength(3);
  });

  it("P3: si el repetido está en la papelera crea uno nuevo (no resucita)", async () => {
    const { a, r } = nuevo();
    const p = await crearArea(a, r, "Historia");
    await borrarArea(a, r, p.area.id);
    const nueva = await crearArea(a, r, "historia");
    expect(nueva.creada).toBe(true);
    expect(nueva.area.id).not.toBe(p.area.id);
    expect((await a.areas.obtener(p.area.id))!.deleted_at).not.toBeNull();
  });
});

const BLOQUE = (area: string, tema: string, pregs: number, resumen = "Resumen del tema.") => JSON.stringify({
  tipo: "aprendizaje", fecha: "2026-11-22", area, tema, resumen,
  preguntas: Array.from({ length: pregs }, (_, i) => ({ p: `${tema} pregunta ${i}`, r: `r${i}` })),
});

async function sembrarTemas(a: AlmacenMemoria, r: RelojSimulado) {
  await importar(a, r, BLOQUE("Programación > CS50", "Funciones", 3));
  await importar(a, r, BLOQUE("Programación > CS50", "Bucles", 2));
  await importar(a, r, BLOQUE("Programación > Python", "Listas", 2));
  await importar(a, r, BLOQUE("Idiomas", "Verbos", 2));
  const areas = await a.areas.listar();
  const id = (nombre: string) => areas.find((x) => x.nombre === nombre)!.id;
  const imps = await a.importaciones.listar();
  const imp = (tema: string) => imps.find((x) => x.tema === tema)!;
  return { prog: id("Programación"), cs50: id("CS50"), py: id("Python"), idi: id("Idiomas"), imp };
}

describe("P6: detalle de área y mover temas", () => {
  it("P6: detalle con subáreas, temas (nombre, tarjetas, estado, resumen) y tarjetas sueltas", async () => {
    const { a, r } = nuevo();
    const s = await sembrarTemas(a, r);
    // una tarjeta suelta en CS50 y una calificada en Bucles para variar el estado
    await a.tarjetas.guardar(tj(s.cs50));
    const bucles = (await a.tarjetas.listar()).filter((t) => t.importacion_id === s.imp("Bucles").id);
    for (const t of bucles) await calificarYGuardar(a, r, t.id, "bien");
    const d = await detalleArea(a, r, s.prog);
    expect(d).toMatchObject({ titulo: "Programación", tarjetas: 8, temas: 3 });
    expect(d.subareas.map((g) => g.nombre)).toEqual(["CS50", "Python"]);
    const cs = d.subareas[0]!;
    expect(cs).toMatchObject({ areaId: s.cs50, tarjetas: 6, tarjetasSueltas: 1 });
    const funciones = cs.temas.find((t) => t.nombre === "Funciones")!;
    expect(funciones).toMatchObject({ id: s.imp("Funciones").id, tarjetas: 3, paraHoy: 3, estado: "hoy", estadoTexto: "3 hoy", resumen: "Resumen del tema." });
    expect(funciones.apunteId).toBe(s.imp("Funciones").apunte_id);
    expect(cs.temas.find((t) => t.nombre === "Bucles")).toMatchObject({ estado: "al_dia", estadoTexto: "Al día", paraHoy: 0 });
    expect(d.propio.temas).toEqual([]);
    const idi = await detalleArea(a, r, s.idi);
    expect(idi.propio.temas[0]).toMatchObject({ nombre: "Verbos", tarjetas: 2 });
    // “Nuevo”: nuevas que quedaron fuera del tope diario
    const dTope = await detalleArea(a, r, s.idi, { limiteNuevas: 0 });
    expect(dTope.propio.temas[0]).toMatchObject({ estado: "nuevo", estadoTexto: "Nuevo", paraHoy: 0 });
    const t = await detalleArea(a, r, s.cs50);
    expect(t.titulo).toBe("Programación › CS50");
    await expect(detalleArea(a, r, "x")).rejects.toThrow(/no existe/);
  });

  it("P6: área sin tarjetas ni temas da un detalle vacío; tema sin resumen no tiene apunte", async () => {
    const { a, r } = nuevo();
    const v = (await crearArea(a, r, "Vacía")).area;
    expect(await detalleArea(a, r, v.id)).toMatchObject({ tarjetas: 0, temas: 0, paraHoy: 0, dominio: 0, subareas: [] });
    await importar(a, r, JSON.stringify({ tipo: "aprendizaje", fecha: "2026-11-22", area: "Vacía", tema: "Sin resumen", preguntas: [{ p: "a", r: "b" }] }));
    const d = await detalleArea(a, r, v.id);
    expect(d.propio.temas[0]).toMatchObject({ nombre: "Sin resumen", apunteId: null, resumen: null });
  });

  it("P6: mover un tema a otra subárea y a otra área conserva el repaso y no pierde ni duplica nada", async () => {
    const { a, r } = nuevo();
    const s = await sembrarTemas(a, r);
    const f = s.imp("Funciones");
    const [t0] = (await a.tarjetas.listar()).filter((t) => t.importacion_id === f.id);
    await calificarYGuardar(a, r, t0!.id, "facil");
    const antes = await a.tarjetas.listar();
    const repasoAntes = (await a.tarjetas.obtener(t0!.id))!;
    r.avanzarMinutos(5);

    expect(await moverTema(a, r, f.id, s.py)).toEqual({ tarjetas: 3 });
    let despues = await a.tarjetas.listar();
    expect(despues).toHaveLength(antes.length);
    expect(new Set(despues.map((t) => t.id)).size).toBe(despues.length);
    const movidas = despues.filter((t) => t.importacion_id === f.id);
    expect(movidas.every((t) => t.area_id === s.py)).toBe(true);
    const t0d = despues.find((t) => t.id === t0!.id)!;
    expect(t0d).toMatchObject({ ease: repasoAntes.ease, intervalo: repasoAntes.intervalo, reps: repasoAntes.reps, lapses: repasoAntes.lapses, vence: repasoAntes.vence, repaso_updated_at: repasoAntes.repaso_updated_at });
    expect(t0d.contenido_updated_at).toBe(r.ahora().toISOString());
    expect((await a.importaciones.obtener(f.id))!.area_id).toBe(s.py);
    const ap = (await a.apuntes.obtener(f.apunte_id!))!;
    expect(ap.area_id).toBe(s.py);
    expect(ap.updated_at).toBe(r.ahora().toISOString());
    expect((await detalleArea(a, r, s.py)).temas).toBe(2);

    // a otra área de primer nivel
    await moverTema(a, r, f.id, s.idi);
    despues = await a.tarjetas.listar();
    expect(despues.filter((t) => t.importacion_id === f.id).every((t) => t.area_id === s.idi)).toBe(true);
    expect((await detalleArea(a, r, s.idi)).propio.temas.map((t) => t.nombre).sort()).toEqual(["Funciones", "Verbos"]);
    expect(despues).toHaveLength(antes.length);
    expect(await a.repasos.listar()).toHaveLength(1);
  });

  it("P6: mover al mismo lugar o a un destino borrado o inexistente avisa y no cambia nada", async () => {
    const { a, r } = nuevo();
    const s = await sembrarTemas(a, r);
    const f = s.imp("Funciones");
    const foto = async () => JSON.stringify([await a.tarjetas.listar({ incluirBorrados: true }), await a.importaciones.listar({ incluirBorrados: true }), await a.apuntes.listar({ incluirBorrados: true })]);
    const f0 = await foto();
    await expect(moverTema(a, r, f.id, s.cs50)).rejects.toThrow(/ya está en/);
    await borrarSubarea(a, r, s.py);
    const f1 = await foto();
    await expect(moverTema(a, r, f.id, s.py)).rejects.toThrow(/destino/);
    await expect(moverTema(a, r, f.id, "no-existe")).rejects.toThrow(/destino/);
    await expect(moverTema(a, r, "no-existe", s.idi)).rejects.toThrow(/tema/);
    expect(await foto()).toBe(f1);
    expect(f0).not.toBe(""); // la foto previa se tomó antes del borrado de Python
  });

  it("P6: dos temas con el mismo nombre se mueven por separado; las tarjetas borradas del tema no se mueven", async () => {
    const { a, r } = nuevo();
    await importar(a, r, BLOQUE("Idiomas", "Verbos", 2));
    await importar(a, r, BLOQUE("Historia", "Verbos", 2));
    const imps = await a.importaciones.listar();
    expect(imps).toHaveLength(2);
    const [uno, dos] = imps as [typeof imps[0], typeof imps[0]];
    const hist = (await a.areas.listar()).find((x) => x.nombre === "Historia")!;
    const tUno = (await a.tarjetas.listar()).filter((t) => t.importacion_id === uno.id);
    await borrarTarjeta(a, r, tUno[0]!.id);
    const otra = (await crearArea(a, r, "Otra")).area;
    expect(await moverTema(a, r, uno.id, otra.id)).toEqual({ tarjetas: 1 });
    expect((await a.tarjetas.obtener(tUno[0]!.id))!.area_id).toBe(uno.area_id); // la borrada se queda
    expect((await a.importaciones.obtener(dos.id))!.area_id).toBe(hist.id);
    expect((await detalleArea(a, r, otra.id)).propio.temas[0]).toMatchObject({ nombre: "Verbos", tarjetas: 1 });
  });
});

describe("P5: contexto de la tarjeta (lógica)", () => {
  it("P5: área, subárea, tema y resumen; la tarjeta a mano no tiene tema y sin resumen da null", async () => {
    const { a, r } = nuevo();
    const s = await sembrarTemas(a, r);
    const t = (await a.tarjetas.listar()).find((x) => x.importacion_id === s.imp("Funciones").id)!;
    const c = await contextoDeTarjeta(a, t);
    expect(c).toMatchObject({ area: { nombre: "Programación" }, subarea: { nombre: "CS50" }, tema: { nombre: "Funciones" }, resumen: "Resumen del tema." });
    const verbo = (await a.tarjetas.listar()).find((x) => x.importacion_id === s.imp("Verbos").id)!;
    expect(await contextoDeTarjeta(a, verbo)).toMatchObject({ area: { nombre: "Idiomas" }, subarea: null, tema: { nombre: "Verbos" } });
    const mano = tj(s.cs50);
    expect(await contextoDeTarjeta(a, mano)).toMatchObject({ area: { nombre: "Programación" }, subarea: { nombre: "CS50" }, tema: null, apunteId: null, resumen: null });
  });
});

const estado = async (a: AlmacenMemoria) => JSON.stringify([
  await a.areas.listar({ incluirBorrados: true }), await a.importaciones.listar({ incluirBorrados: true }),
  await a.apuntes.listar({ incluirBorrados: true }), await a.tarjetas.listar({ incluirBorrados: true }),
]);

describe("P7: borrar y restaurar en cascada", () => {
  it("P7: borrar un tema: confirmación con conteos, sale de la cola y de las estadísticas, un solo instante", async () => {
    const { a, r } = nuevo();
    const s = await sembrarTemas(a, r);
    const f = s.imp("Funciones");
    expect(await resumenDeBorrado(a, { tipo: "tema", id: f.id })).toMatchObject({ subareas: 0, temas: 1, tarjetas: 3 });
    expect((await resumenDeBorrado(a, { tipo: "tema", id: f.id })).texto).toBe("Se van a la papelera: 1 tema, 3 tarjetas. Podés restaurarlos durante 30 días.");
    const antesCola = (await construirCola(a, r)).length;
    const estAntes = await calcularEstadisticas(a, r);
    const totalArea = (e: Awaited<ReturnType<typeof calcularEstadisticas>>, id: string) => e.porArea.find((x) => x.area_id === id)!.total;
    r.avanzarMinutos(1);
    expect(await borrarTema(a, r, f.id)).toEqual({ subareas: 0, temas: 1, tarjetas: 3 });
    expect((await construirCola(a, r)).length).toBe(antesCola - 3);
    const estDespues = await calcularEstadisticas(a, r);
    expect(estDespues.pendientesHoy).toBe(estAntes.pendientesHoy - 3);
    expect(totalArea(estDespues, s.cs50)).toBe(totalArea(estAntes, s.cs50) - 3);
    const instante = r.ahora().toISOString();
    const borrados = [
      await a.importaciones.obtener(f.id), await a.apuntes.obtener(f.apunte_id!),
      ...(await a.tarjetas.listar({ incluirBorrados: true })).filter((t) => t.importacion_id === f.id),
    ];
    expect(borrados).toHaveLength(5);
    expect(borrados.every((x) => x!.deleted_at === instante)).toBe(true);
    expect((await detalleArea(a, r, s.cs50)).temas).toBe(1);
    await expect(borrarTema(a, r, f.id)).rejects.toThrow(/tema/);
  });

  it("P7: borrar una subárea y un área con subáreas; la confirmación cuenta todo y el área sale de Áreas, Repaso y estadísticas", async () => {
    const { a, r } = nuevo();
    const s = await sembrarTemas(a, r);
    expect(await resumenDeBorrado(a, { tipo: "area", id: s.prog })).toMatchObject({ subareas: 2, temas: 3, tarjetas: 7 });
    expect((await resumenDeBorrado(a, { tipo: "area", id: s.prog })).texto).toBe("Se van a la papelera: 2 subáreas, 3 temas, 7 tarjetas. Podés restaurarlos durante 30 días.");
    await expect(borrarArea(a, r, s.cs50)).rejects.toThrow(/subárea/);
    await expect(borrarSubarea(a, r, s.prog)).rejects.toThrow(/primer nivel/);
    expect(await borrarSubarea(a, r, s.py)).toEqual({ subareas: 1, temas: 1, tarjetas: 2 });
    r.avanzarMinutos(1);
    expect(await borrarArea(a, r, s.prog)).toEqual({ subareas: 1, temas: 2, tarjetas: 5 }); // Python ya estaba borrada
    const res = await resumenAreas(a, r);
    expect(res.areas.map((x) => x.nombre)).toEqual(["Idiomas"]);
    expect(res.totalParaHoy).toBe(2);
    expect((await construirCola(a, r)).length).toBe(2);
    const est = await calcularEstadisticas(a, r);
    expect(est.pendientesHoy).toBe(2);
    expect(est.porArea.map((x) => x.nombre)).toEqual(["Idiomas"]);
    const p = await listarPapelera(a);
    expect(p.conjuntos.map((c) => [c.tipo, c.titulo, c.tarjetas]).sort()).toEqual([["area", "Programación › Python", 2], ["area", "Programación", 5]]);
    expect(p.tarjetas).toEqual([]);
    expect(p.apuntes).toEqual([]);
  });

  it("P7: restaurar devuelve el conjunto con el repaso intacto y sin resucitar lo borrado antes", async () => {
    const { a, r } = nuevo();
    const s = await sembrarTemas(a, r);
    const cola0 = (await construirCola(a, r)).length;
    const [uno] = (await a.tarjetas.listar()).filter((t) => t.importacion_id === s.imp("Funciones").id);
    await calificarYGuardar(a, r, uno!.id, "bien");
    const calificada = (await a.tarjetas.obtener(uno!.id))!;
    const sueltaAntes = (await a.tarjetas.listar()).find((t) => t.importacion_id === s.imp("Bucles").id)!;
    await borrarTarjeta(a, r, sueltaAntes.id); // borrada antes que el conjunto
    const viejo = (await a.tarjetas.obtener(sueltaAntes.id))!.deleted_at;
    await borrarSubarea(a, r, s.py); // también antes (otro instante)
    r.avanzarMinutos(10);
    await borrarArea(a, r, s.prog);
    // restaurar el área: vuelve CS50 completa menos lo anterior; Python sigue en la papelera
    r.avanzarMinutos(10);
    const res = await restaurarArea(a, r, s.prog);
    expect(res).toMatchObject({ subareas: 1, temas: 2 });
    expect((await a.areas.obtener(s.cs50))!.deleted_at).toBeNull();
    expect((await a.areas.obtener(s.py))!.deleted_at).not.toBeNull();
    expect((await a.tarjetas.obtener(sueltaAntes.id))!.deleted_at).toBe(viejo);
    expect(await a.tarjetas.obtener(uno!.id)).toMatchObject({ deleted_at: null, ease: calificada.ease, intervalo: calificada.intervalo, vence: calificada.vence, reps: calificada.reps, repaso_updated_at: calificada.repaso_updated_at });
    // Python se restaura aparte (su padre ya está vivo)
    await restaurarArea(a, r, s.py);
    expect(await resumenAreas(a, r)).toMatchObject({ totalParaHoy: cola0 - 2 });
    // restaurar dos veces avisa y no cambia nada
    const foto = await estado(a);
    await expect(restaurarArea(a, r, s.prog)).rejects.toThrow(/ya la restauraste/);
    await expect(restaurarTema(a, r, s.imp("Funciones").id)).rejects.toThrow(/ya lo restauraste/);
    expect(await estado(a)).toBe(foto);
  });

  it("P7: restaurar un tema, y los casos de padre borrado piden restaurar primero el área", async () => {
    const { a, r } = nuevo();
    const s = await sembrarTemas(a, r);
    const f = s.imp("Funciones");
    await borrarTema(a, r, f.id);
    r.avanzarMinutos(1);
    await borrarSubarea(a, r, s.cs50); // CS50 con Bucles; Funciones ya estaba borrado
    r.avanzarMinutos(1);
    await borrarArea(a, r, s.prog); // solo cae Programación (Python y su tema)
    await expect(restaurarArea(a, r, s.cs50)).rejects.toThrow(/primero restaurá su área/);
    await expect(restaurarTema(a, r, f.id)).rejects.toThrow(/primero restaurá su área/);
    await restaurarArea(a, r, s.prog);
    await restaurarArea(a, r, s.cs50);
    expect((await a.tarjetas.listar()).filter((t) => t.importacion_id === f.id)).toHaveLength(0);
    expect(await restaurarTema(a, r, f.id)).toEqual({ subareas: 0, temas: 1, tarjetas: 3 });
    expect((await a.apuntes.obtener(f.apunte_id!))!.deleted_at).toBeNull();
  });

  it("P7: la papelera muestra UN item por tema o área y restaurarlo restaura el conjunto; lo suelto sigue igual", async () => {
    const { a, r } = nuevo();
    const s = await sembrarTemas(a, r);
    const d = { almacen: a, reloj: r } as never;
    const suelta = (await a.tarjetas.listar()).find((t) => t.importacion_id === s.imp("Verbos").id)!;
    await borrarTarjeta(a, r, suelta.id);
    r.avanzarMinutos(1);
    await borrarTema(a, r, s.imp("Funciones").id);
    r.avanzarMinutos(1);
    await borrarArea(a, r, s.prog);
    const items = await itemsPapelera(d);
    expect(items.map((i) => [i.tipo, i.titulo]).sort()).toEqual([["area", "Programación"], ["tarjeta", suelta.pregunta], ["tema", "Funciones"]].sort());
    const area = items.find((i) => i.tipo === "area")!;
    expect(area.detalle).toBe("2 subáreas, 2 temas, 4 tarjetas");
    expect(items.find((i) => i.tipo === "tema")!.detalle).toBe("3 tarjetas");
    expect(await restaurarItem(d, "area", area.id)).toMatch(/Área restaurada/);
    expect((await itemsPapelera(d)).map((i) => i.tipo).sort()).toEqual(["tarjeta", "tema"]);
    expect(await restaurarItem(d, "tema", s.imp("Funciones").id)).toMatch(/Tema restaurado/);
    expect((await detalleArea(a, r, s.cs50)).temas).toBe(2);
    expect(await restaurarItem(d, "tarjeta", suelta.id)).toMatch(/Tarjeta restaurada/);
    expect(await itemsPapelera(d)).toEqual([]);
  });

  it("P7: a los 30 días se eliminan áreas, subáreas, temas y tarjetas, y los repasos se conservan", async () => {
    const { a, r } = nuevo();
    const s = await sembrarTemas(a, r);
    const [uno] = (await a.tarjetas.listar()).filter((t) => t.importacion_id === s.imp("Funciones").id);
    await calificarYGuardar(a, r, uno!.id, "bien");
    r.avanzarMinutos(1);
    await borrarArea(a, r, s.prog);
    r.avanzarDias(29);
    expect(await purgarPapelera(a, r)).toBe(0);
    expect((await a.areas.listar({ incluirBorrados: true })).length).toBe(4);
    r.avanzarDias(1);
    // 3 áreas (Programación, CS50, Python) + 3 importaciones + 3 apuntes + 7 tarjetas
    expect(await purgarPapelera(a, r)).toBe(16);
    expect((await a.areas.listar({ incluirBorrados: true })).map((x) => x.nombre)).toEqual(["Idiomas"]);
    expect(await a.tarjetas.listar({ incluirBorrados: true })).toHaveLength(2);
    expect(await a.repasos.listar()).toHaveLength(1);
    expect((await a.importaciones.listar({ incluirBorrados: true })).map((i) => i.tema)).toEqual(["Verbos"]);
  });
});
