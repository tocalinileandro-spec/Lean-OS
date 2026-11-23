/**
 * Interfaz de Áreas (inicio) y del detalle de área: P2, parte de interfaz de P3, P6 y P7.
 * La lógica está probada en areas.test.ts; acá se prueba lo que se ve y se toca (DOM simulado, happy-dom).
 */
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../src/compartido/almacen.ts";
import { colaDeRepaso, resumenAreas } from "../src/compartido/areas.ts";
import { fijarHoraCambio } from "../src/compartido/dia.ts";
import type { Area, Tarjeta } from "../src/compartido/esquema.ts";
import { importar } from "../src/compartido/importacion/importar.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { montarApp, type AppMontada } from "../src/cliente/ui/app.ts";
import { cargarAjustes, PantallaRepaso, type Persistencia } from "../src/cliente/ui/logica.ts";

const HOY = "2026-11-22";
const AHORA = "2026-11-22T15:00:00.000Z";

class Memoria implements Persistencia {
  datos = new Map<string, string>();
  getItem(k: string) { return this.datos.get(k) ?? null; }
  setItem(k: string, v: string) { this.datos.set(k, v); }
}
afterEach(() => fijarHoraCambio());

async function abrir(a: AlmacenMemoria = new AlmacenMemoria(), r = new RelojSimulado(AHORA), nuevasPorDia?: number) {
  const ventana = new Window({ url: "http://localhost/" });
  const raiz = ventana.document.createElement("div");
  ventana.document.body.append(raiz);
  const persistencia = new Memoria();
  if (nuevasPorDia !== undefined) persistencia.setItem("lean-os:ajustes", JSON.stringify({ nuevasPorDia }));
  let confirmaciones = 0;
  (ventana as unknown as { confirm: () => boolean }).confirm = () => { confirmaciones++; return true; };
  const app: AppMontada = montarApp(raiz as unknown as HTMLElement, { almacen: a, reloj: r, persistencia });
  await app.esperar();
  const doc = ventana.document;
  const botones = () => [...doc.querySelectorAll("button")];
  const boton = (t: string) => botones().find((b) => (b.textContent ?? "").trim().startsWith(t));
  const clic = async (t: string) => {
    const b = boton(t);
    if (!b) throw new Error(`No hay botón "${t}" en: ${raiz.textContent}`);
    b.click();
    await app.esperar();
  };
  const clicAria = async (etiqueta: string) => {
    const b = botones().find((x) => x.getAttribute("aria-label") === etiqueta);
    if (!b) throw new Error(`No hay botón con etiqueta "${etiqueta}" en: ${raiz.textContent}`);
    b.click();
    await app.esperar();
  };
  const escribir = async (selector: string, valor: string) => {
    const el = doc.querySelector(selector) as unknown as HTMLInputElement;
    el.value = valor;
    el.dispatchEvent(new ventana.Event("input", { bubbles: true }) as unknown as Event);
    await app.esperar();
  };
  const tecla = async (key: string, objetivo?: Element) => {
    const destino = (objetivo ?? doc) as unknown as EventTarget;
    destino.dispatchEvent(new ventana.KeyboardEvent("keydown", { key, bubbles: true }) as unknown as Event);
    await app.esperar();
  };
  const texto = () => raiz.textContent ?? "";
  return { app, a, r, doc, raiz, persistencia, clic, clicAria, escribir, tecla, boton, botones, texto, confirmaciones: () => confirmaciones };
}

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

/** Los datos de ejemplo de P1: 3 áreas (Programación con CS50 y Python), 71 tarjetas, más "Lógica" al día. */
async function datosP1(a: AlmacenMemoria) {
  await a.areas.guardarVarios([
    area("prog", "Programación"), area("cs50", "CS50", "prog"), area("py", "Python", "prog"), area("idi", "Idiomas"), area("his", "Historia"),
  ]);
  const venc = (id: string, k: number, intervalo: number, vence: string, extra: Partial<Tarjeta> = {}) => rep(k, { area_id: id, intervalo, reps: 3, vence, ...extra });
  await a.tarjetas.guardarVarios([
    ...rep(3, { area_id: "prog" }),
    ...venc("cs50", 10, 30, "2026-11-20"), ...rep(7, { area_id: "cs50" }),
    ...venc("py", 8, 5, HOY), ...venc("py", 4, 40, "2026-11-01", { suspendida: true }),
    ...venc("idi", 15, 25, "2026-12-10"), ...rep(5, { area_id: "idi" }), ...venc("idi", 3, 2, "2026-11-21"),
    ...venc("his", 14, 22, "2026-11-23"), ...venc("his", 2, 1, "2026-11-21"),
  ]);
}

const BLOQUE = (areaTexto: string, tema: string, pregs: number, resumen = "Resumen del tema.") => JSON.stringify({
  tipo: "aprendizaje", fecha: HOY, area: areaTexto, tema, resumen,
  preguntas: Array.from({ length: pregs }, (_, i) => ({ p: `${tema} pregunta ${i}`, r: `respuesta secreta ${tema} ${i}` })),
});

async function datosTemas(a: AlmacenMemoria, r: RelojSimulado) {
  await importar(a, r, BLOQUE("Programación > CS50", "Funciones", 3, "Las funciones agrupan código."));
  await importar(a, r, BLOQUE("Programación > CS50", "Bucles", 2));
  await importar(a, r, BLOQUE("Programación > Python", "Listas", 2));
  await importar(a, r, BLOQUE("Idiomas", "Verbos", 2));
}
const idArea = async (a: AlmacenMemoria, nombre: string) => (await a.areas.listar()).find((x) => x.nombre === nombre)!.id;
const tarjetasDe = async (a: AlmacenMemoria, areaId: string) => (await a.tarjetas.listar()).filter((t) => t.area_id === areaId);
const estadoRepaso = (t: Tarjeta) => ({ ease: t.ease, intervalo: t.intervalo, reps: t.reps, lapses: t.lapses, vence: t.vence, repaso_updated_at: t.repaso_updated_at });

describe("P2: la primera pantalla es Áreas", () => {
  it("P2: con los datos de ejemplo de P1 abre Áreas con tarjetas de área, contadores, barra de dominio y 'Repasar hoy · N'", async () => {
    const a = new AlmacenMemoria();
    await datosP1(a);
    await a.areas.guardar(area("log", "Lógica"));
    await a.tarjetas.guardarVarios(rep(2, { area_id: "log", intervalo: 30, reps: 4, vence: "2026-12-30" }));
    const ui = await abrir(a);
    const res = await resumenAreas(a, ui.r, { limiteNuevas: cargarAjustes(ui.persistencia).nuevasPorDia });
    expect(res.areas).toHaveLength(4);
    expect(ui.doc.querySelector("h1")!.textContent).toBe("Tus áreas");
    expect(ui.texto()).toContain("Domingo 22 de noviembre");
    expect(ui.texto()).toContain("73 tarjetas en 4 áreas. Elegí una para estudiarla o repasá todo lo de hoy.");
    const tarjetas = [...ui.doc.querySelectorAll(".area-tarjeta")];
    expect(tarjetas).toHaveLength(4);
    for (const r of res.areas) {
      const t = tarjetas.find((x) => x.querySelector(".area-abrir")!.textContent === r.nombre)!;
      expect(t, r.nombre).toBeTruthy();
      expect(t.textContent).toContain(`${r.tarjetas} ${r.tarjetas === 1 ? "tarjeta" : "tarjetas"} · ${r.subareas.length} ${r.subareas.length === 1 ? "subárea" : "subáreas"}`);
      expect(t.querySelector(".insignia-estado")!.textContent).toBe(r.paraHoy > 0 ? `${r.paraHoy} para hoy` : "Al día");
      const barra = t.querySelector('[role="progressbar"]')!;
      expect(barra.getAttribute("aria-valuenow")).toBe(String(r.dominio));
      expect(t.textContent).toContain(`Dominadas${r.dominio}%`);
      expect([...t.querySelectorAll(".etiquetas-sub li")].map((x) => x.textContent)).toEqual(r.subareas);
    }
    expect(tarjetas.some((t) => t.querySelector(".insignia-estado")!.textContent === "Al día")).toBe(true);
    expect(tarjetas.some((t) => /^\d+ para hoy$/.test(t.querySelector(".insignia-estado")!.textContent!))).toBe(true);
    expect(ui.boton("Repasar hoy")!.textContent!.trim()).toBe(`Repasar hoy · ${res.totalParaHoy}`);
    // La pestaña Áreas es la activa y la barra marca los pendientes de Repaso.
    expect([...ui.doc.querySelectorAll('.nav-item[aria-current="page"] .nav-texto')].map((x) => x.textContent)).toEqual(["Áreas"]);
    expect(ui.doc.querySelector(".nav .insignia")!.textContent).toBe(String(res.totalParaHoy));
    expect(ui.doc.querySelectorAll("[style]")).toHaveLength(0);
    // Cada tarjeta se abre con un botón con el nombre del área (accesible por teclado).
    expect(ui.boton("Programación")!.tagName).toBe("BUTTON");
  });

  it("P2: 'Repasar hoy · N' lleva al Repaso general", async () => {
    const a = new AlmacenMemoria();
    await datosP1(a);
    const ui = await abrir(a);
    await ui.clic("Repasar hoy");
    expect([...ui.doc.querySelectorAll('.nav-item[aria-current="page"] .nav-texto')].map((x) => x.textContent)).toEqual(["Repaso"]);
    const res = await resumenAreas(a, ui.r, { limiteNuevas: cargarAjustes(ui.persistencia).nuevasPorDia });
    expect(res.totalParaHoy).toBeGreaterThan(0);
    expect(ui.texto()).toContain(`Tarjeta 1 de ${res.totalParaHoy}`);
  });

  it("P2: sin áreas muestra un estado vacío con 'Crear área' e 'Importar' (que abre la caja de importar)", async () => {
    const ui = await abrir();
    expect(ui.doc.querySelector("h1")!.textContent).toBe("Tus áreas");
    expect(ui.texto()).toContain("Todavía no tenés áreas.");
    expect(ui.boton("Crear área")).toBeTruthy();
    expect(ui.boton("Importar")).toBeTruthy();
    expect(ui.boton("Repasar hoy")).toBeUndefined();
    await ui.clic("Importar");
    expect(ui.doc.querySelector("h1")!.textContent).toBe("Tarjetas");
    expect(ui.doc.querySelector("#caja-importar")).toBeTruthy();
  });

  it("P2: con 0 pendientes el botón 'Repasar hoy' no aparece", async () => {
    const a = new AlmacenMemoria();
    await a.areas.guardar(area("x", "Idiomas"));
    await a.tarjetas.guardarVarios(rep(3, { area_id: "x", intervalo: 30, reps: 3, vence: "2026-12-30" }));
    const ui = await abrir(a);
    expect(ui.boton("Repasar hoy")).toBeUndefined();
    expect(ui.doc.querySelector(".area-tarjeta .insignia-estado")!.textContent).toBe("Al día");
    expect(ui.texto()).toContain("3 tarjetas en 1 área.");
  });

  it("P2: 'Ver todas las tarjetas' abre la gestión de Tarjetas, que se conserva (y la pestaña Áreas sigue activa)", async () => {
    const a = new AlmacenMemoria();
    await datosP1(a);
    const ui = await abrir(a);
    await ui.clic("Ver todas las tarjetas");
    expect(ui.doc.querySelector("h1")!.textContent).toBe("Tarjetas");
    expect(ui.doc.querySelector("#busqueda")).toBeTruthy();
    expect([...ui.doc.querySelectorAll('.nav-item[aria-current="page"] .nav-texto')].map((x) => x.textContent)).toEqual(["Áreas"]);
    await ui.clic("Áreas");
    expect(ui.doc.querySelector("h1")!.textContent).toBe("Tus áreas");
  });
});

describe("P3 (UI): crear áreas y subáreas desde la interfaz", () => {
  it("P3 (UI): crear un área con el botón y con Enter abre su detalle", async () => {
    const ui = await abrir();
    await ui.escribir("#a-nueva-area", "Programación");
    await ui.clic("Crear área");
    expect((await ui.a.areas.listar()).map((x) => x.nombre)).toEqual(["Programación"]);
    expect(ui.doc.querySelector("h1")!.textContent).toBe("Programación");
    expect(ui.texto()).toContain("Área “Programación” creada.");
    expect(ui.doc.activeElement?.id).toBe("titulo-pantalla");
    await ui.clic("Todas las áreas");
    expect(ui.doc.querySelectorAll(".area-tarjeta")).toHaveLength(1);
    await ui.escribir("#a-nueva-area", "Idiomas");
    await ui.tecla("Enter", ui.doc.querySelector("#a-nueva-area") as unknown as Element);
    expect((await ui.a.areas.listar()).map((x) => x.nombre).sort()).toEqual(["Idiomas", "Programación"]);
    expect(ui.doc.querySelector("h1")!.textContent).toBe("Idiomas");
  });

  it("P3 (UI): crear una subárea cuelga del área; repetida (otras tildes y mayúsculas) avisa y no duplica", async () => {
    const ui = await abrir();
    await ui.escribir("#a-nueva-area", "Programación");
    await ui.clic("Crear área");
    await ui.escribir("#a-nueva-subarea", "CS50");
    await ui.clic("Crear");
    const prog = await idArea(ui.a, "Programación");
    const cs50 = (await ui.a.areas.listar()).find((x) => x.nombre === "CS50")!;
    expect(cs50.padre_id).toBe(prog);
    expect(ui.texto()).toContain("Subárea “CS50” creada.");
    expect(ui.doc.querySelector("h2#a-seccion-" + cs50.id)!.textContent).toBe("CS50");
    // Otra subárea repetida con otra capitalización.
    await ui.escribir("#a-nueva-subarea", "cs50");
    await ui.clic("Crear");
    expect((await ui.a.areas.listar()).filter((x) => x.padre_id === prog)).toHaveLength(1);
    expect(ui.texto()).toMatch(/Ya existe/);
    expect((ui.doc.querySelector("#a-nueva-subarea") as unknown as HTMLInputElement).value).toBe("cs50");
    // El área repetida, con otras tildes y mayúsculas, avisa y no duplica.
    await ui.clic("Todas las áreas");
    await ui.escribir("#a-nueva-area", "programacion");
    await ui.clic("Crear área");
    expect((await ui.a.areas.listar()).filter((x) => x.padre_id === null)).toHaveLength(1);
    expect(ui.texto()).toMatch(/Ya existe/);
    expect((ui.doc.querySelector("#a-nueva-area") as unknown as HTMLInputElement).value).toBe("programacion");
    expect(ui.doc.querySelector("h1")!.textContent).toBe("Tus áreas");
  });

  it("P3 (UI): nombre vacío o de más de 60 letras se rechaza con un mensaje y lo escrito queda", async () => {
    const ui = await abrir();
    await ui.escribir("#a-nueva-area", "   ");
    await ui.clic("Crear área");
    expect(ui.texto()).toContain("no puede quedar vacío");
    expect(await ui.a.areas.listar()).toHaveLength(0);
    const largo = "x".repeat(61);
    await ui.escribir("#a-nueva-area", largo);
    await ui.clic("Crear área");
    expect(ui.texto()).toContain("demasiado largo");
    expect((ui.doc.querySelector("#a-nueva-area") as unknown as HTMLInputElement).value).toBe(largo);
    expect(await ui.a.areas.listar()).toHaveLength(0);
    expect(ui.texto()).not.toContain("No se pudo completar");
  });
});

describe("P6 (UI): detalle de área", () => {
  async function conTemas(nuevasPorDia?: number) {
    const a = new AlmacenMemoria();
    const r = new RelojSimulado(AHORA);
    await datosTemas(a, r);
    const ui = await abrir(a, r, nuevasPorDia);
    return { a, r, ui };
  }

  it("P6 (UI): el detalle lista subáreas con sus temas, 'N hoy', 'Al día' y 'Nuevo', y 'Repasar esta área · N'", async () => {
    // Tope de 3 nuevas por día: "Funciones" las usa todas, "Bucles" queda "Nuevo" (fuera del tope) y "Listas" (ya repasada, vence más adelante) "Al día".
    const { a, r, ui } = await conTemas(3);
    const lis = (await a.importaciones.listar()).find((x) => x.tema === "Listas")!;
    for (const t of (await a.tarjetas.listar()).filter((x) => x.importacion_id === lis.id)) await a.tarjetas.guardar({ ...t, reps: 3, intervalo: 10, vence: "2026-12-10" });
    await ui.clic("Programación");
    expect(ui.doc.querySelector("h1")!.textContent).toBe("Programación");
    expect(ui.doc.activeElement?.id).toBe("titulo-pantalla");
    expect(ui.doc.querySelector("#a-volver")!.textContent).toBe("Todas las áreas");
    const enHoy = (await colaDeRepaso(a, r, { areaId: await idArea(a, "Programación"), limiteNuevas: 3 })).length;
    expect(enHoy).toBe(3);
    expect(ui.texto()).toContain(`7 tarjetas · 2 subáreas · ${enHoy} para repasar hoy`);
    expect(ui.boton("Repasar esta área")!.textContent!.trim()).toBe(`Repasar esta área · ${enHoy}`);
    const secciones = [...ui.doc.querySelectorAll(".seccion-area")];
    expect(secciones.map((s) => s.querySelector("h2")!.textContent)).toEqual(["CS50", "Python"]);
    const cs = secciones[0]!;
    expect(cs.textContent).toContain("5 tarjetas · 2 temas");
    const fila = (nombre: string) => [...ui.doc.querySelectorAll(".fila-tema")].find((f) => f.querySelector(".fila-tema-nombre")!.textContent === nombre)!;
    expect(fila("Funciones").textContent).toContain("3 tarjetas");
    expect(fila("Funciones").querySelector(".insignia-estado")!.textContent).toBe("3 hoy");
    expect(fila("Bucles").querySelector(".insignia-estado")!.textContent).toBe("Nuevo");
    expect(fila("Listas").querySelector(".insignia-estado")!.textContent).toBe("Al día");
    expect(cs.textContent).toContain("Repasar · 3");
    // Menú: botón de 44 px con aria-label y aria-expanded.
    const menu = ui.doc.querySelector('[aria-label="Más opciones de Funciones"]')!;
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(menu.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    await ui.clicAria("Más opciones de Funciones");
    expect(ui.doc.querySelector('[aria-label="Más opciones de Funciones"]')!.getAttribute("aria-expanded")).toBe("true");
    for (const t of ["Ver el resumen", "Mover…", "Borrar tema"]) expect(ui.boton(t), t).toBeTruthy();
    expect(ui.doc.querySelector("#nueva-subarea, #a-nueva-subarea")).toBeTruthy();
    expect(ui.texto()).toContain("Papelera:");
    expect(ui.boton("Borrar área")).toBeTruthy();
    expect(ui.boton("Importar tarjetas")).toBeTruthy();
  });

  it("P6 (UI): 'Ver el resumen' muestra el resumen y no revela respuestas; Escape cierra el menú", async () => {
    const { ui } = await conTemas();
    await ui.clic("Programación");
    await ui.clicAria("Más opciones de Funciones");
    await ui.tecla("Escape");
    expect(ui.boton("Ver el resumen")).toBeUndefined();
    expect(ui.doc.activeElement?.getAttribute("aria-label")).toBe("Más opciones de Funciones");
    await ui.clicAria("Más opciones de Funciones");
    await ui.clic("Ver el resumen");
    expect(ui.texto()).toContain("Resumen de Funciones");
    expect(ui.texto()).toContain("Las funciones agrupan código.");
    expect(ui.texto()).not.toContain("respuesta secreta");
    await ui.clic("Cerrar resumen");
    expect(ui.texto()).not.toContain("Las funciones agrupan código.");
  });

  it("P6 (UI): mover un tema a otra subárea y a otra área conserva el estado de repaso; el mismo lugar avisa y no cambia nada", async () => {
    const { a, ui } = await conTemas();
    const imp = (await a.importaciones.listar()).find((x) => x.tema === "Funciones")!;
    const tj3 = (await a.tarjetas.listar()).filter((x) => x.importacion_id === imp.id);
    await a.tarjetas.guardar({ ...tj3[0]!, reps: 4, intervalo: 12, ease: 2.2, lapses: 1, vence: "2026-12-04" });
    const antes = new Map((await a.tarjetas.listar()).filter((x) => x.importacion_id === imp.id).map((x) => [x.id, estadoRepaso(x)]));
    const cs50 = await idArea(a, "CS50");
    const py = await idArea(a, "Python");
    const idi = await idArea(a, "Idiomas");
    const total = (await a.tarjetas.listar()).length;
    await ui.clic("Programación");
    // Mismo lugar: avisa y no cambia nada.
    await ui.clicAria("Más opciones de Funciones");
    await ui.clic("Mover…");
    const sel = ui.doc.querySelector(`#a-mover-destino-${imp.id}`) as unknown as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(["Idiomas", "Programación", "Programación › CS50 (está acá)", "Programación › Python"]);
    sel.value = cs50;
    sel.dispatchEvent(new (ui.doc.defaultView as unknown as { Event: typeof Event }).Event("change", { bubbles: true }));
    await ui.clic("Mover");
    expect(ui.texto()).toContain("ya está en “CS50”");
    expect((await a.importaciones.obtener(imp.id))!.area_id).toBe(cs50);
    expect(ui.doc.querySelector(`#a-mover-destino-${imp.id}`)).toBeTruthy(); // el formulario sigue abierto
    // A otra subárea.
    const poner = async (id: string) => {
      const s = ui.doc.querySelector(`#a-mover-destino-${imp.id}`) as unknown as HTMLSelectElement;
      s.value = id;
      s.dispatchEvent(new (ui.doc.defaultView as unknown as { Event: typeof Event }).Event("change", { bubbles: true }));
      await ui.clic("Mover");
    };
    await poner(py);
    expect(ui.texto()).toContain("Se movió “Funciones” a “Programación › Python” con 3 tarjetas");
    expect((await a.importaciones.obtener(imp.id))!.area_id).toBe(py);
    const enPy = [...ui.doc.querySelectorAll(".seccion-area")].find((s) => s.querySelector("h2")!.textContent === "Python")!;
    expect(enPy.textContent).toContain("Funciones");
    // A otra área.
    await ui.clicAria("Más opciones de Funciones");
    await ui.clic("Mover…");
    await poner(idi);
    expect(ui.texto()).toContain("a “Idiomas”");
    for (const t of await a.tarjetas.listar()) if (antes.has(t.id)) { expect(t.area_id).toBe(idi); expect(estadoRepaso(t)).toEqual(antes.get(t.id)); }
    expect((await a.tarjetas.listar())).toHaveLength(total);
    expect((await a.apuntes.listar()).find((x) => x.importacion_id === imp.id)!.area_id).toBe(idi);
    await ui.clic("Todas las áreas");
    expect(ui.doc.querySelector("h1")!.textContent).toBe("Tus áreas");
  });

  it("P6 (UI): 'Repasar esta área' y 'Repasar · N' de una subárea abren el Repaso solo con esas tarjetas", async () => {
    const { a, r, ui } = await conTemas();
    await ui.clic("Programación");
    await ui.clic("Repasar esta área");
    expect(ui.texto()).toContain("Tarjeta 1 de 7");
    await ui.clic("Áreas");
    await ui.clic("Programación");
    const cs = [...ui.doc.querySelectorAll(".seccion-area")][0]!;
    (cs.querySelector("button")! as unknown as HTMLButtonElement).click();
    await ui.app.esperar();
    expect(ui.texto()).toContain("Tarjeta 1 de 5");
    // La lógica: el filtro por área también lo acepta la pantalla de Repaso.
    const p = await PantallaRepaso.iniciar({ almacen: a, reloj: r, persistencia: new Memoria() }, { areaId: await idArea(a, "Idiomas") });
    expect((await p.vista()).pendientes).toBe(2);
    const todo = await PantallaRepaso.iniciar({ almacen: a, reloj: r, persistencia: new Memoria() });
    expect((await todo.vista()).pendientes).toBe(9);
  });

  it("P6 (UI): una tarjeta suelta se lista aparte, sin mover ni borrar", async () => {
    const a = new AlmacenMemoria();
    await a.areas.guardar(area("x", "Cocina"));
    await a.tarjetas.guardarVarios(rep(2, { area_id: "x" }));
    const ui = await abrir(a);
    await ui.clic("Cocina");
    expect(ui.texto()).toContain("Tarjetas sueltas");
    expect(ui.texto()).toContain("2 tarjetas");
    expect(ui.doc.querySelectorAll('[aria-label^="Más opciones de"]')).toHaveLength(0);
  });
});

describe("P7 (UI): borrar con confirmación, deshacer y papelera", () => {
  async function conTemas() {
    const a = new AlmacenMemoria();
    const r = new RelojSimulado(AHORA);
    await datosTemas(a, r);
    const ui = await abrir(a, r);
    return { a, r, ui };
  }
  const vivas = async (a: AlmacenMemoria) => (await a.tarjetas.listar()).length;

  it("P7 (UI): borrar un tema muestra la confirmación con los conteos; cancelar no cambia nada; confirmar lo manda a la papelera y Deshacer lo restaura", async () => {
    const { a, ui } = await conTemas();
    const total = await vivas(a);
    await ui.clic("Programación");
    await ui.clicAria("Más opciones de Funciones");
    await ui.clic("Borrar tema");
    expect(ui.doc.querySelector(".confirmacion")!.textContent).toContain("¿Borrar el tema “Funciones”?");
    expect(ui.doc.querySelector(".confirmacion")!.textContent).toContain("1 tema, 3 tarjetas");
    expect(ui.doc.activeElement?.textContent).toBe("Cancelar");
    expect(ui.confirmaciones()).toBe(0);
    await ui.clic("Cancelar");
    expect(ui.doc.querySelector(".confirmacion")).toBeNull();
    expect(await vivas(a)).toBe(total);
    expect((await a.importaciones.listar())).toHaveLength(4);
    // Escape también cierra la confirmación.
    await ui.clicAria("Más opciones de Funciones");
    await ui.clic("Borrar tema");
    await ui.tecla("Escape");
    expect(ui.doc.querySelector(".confirmacion")).toBeNull();
    expect(await vivas(a)).toBe(total);
    // Confirmar.
    await ui.clicAria("Más opciones de Funciones");
    await ui.clic("Borrar tema");
    await ui.clic("Mover a la papelera");
    expect(ui.texto()).toContain("Tema “Funciones” quedó en la papelera 30 días.");
    expect(await vivas(a)).toBe(total - 3);
    expect([...ui.doc.querySelectorAll(".fila-tema-nombre")].map((x) => x.textContent)).not.toContain("Funciones");
    await ui.clic("Deshacer");
    expect(await vivas(a)).toBe(total);
    expect(ui.texto()).toContain("Tema “Funciones” restaurado");
    expect([...ui.doc.querySelectorAll(".fila-tema-nombre")].map((x) => x.textContent)).toContain("Funciones");
    expect(ui.confirmaciones()).toBe(0);
  });

  it("P7 (UI): borrar una subárea y un área con subáreas; salen de Áreas y del Repaso; Deshacer vuelve al detalle", async () => {
    const { a, ui } = await conTemas();
    await ui.clic("Programación");
    await ui.clic("Borrar subárea");
    const texto = ui.doc.querySelector(".confirmacion")!.textContent!;
    expect(texto).toContain("¿Borrar la subárea “CS50”?");
    expect(texto).toContain("Se van a la papelera: 2 temas, 5 tarjetas.");
    await ui.clic("Mover a la papelera");
    expect(ui.texto()).toContain("Subárea “CS50” quedó en la papelera 30 días.");
    expect([...ui.doc.querySelectorAll(".seccion-area h2")].map((x) => x.textContent)).toEqual(["Python"]);
    // El área entera.
    await ui.clic("Borrar área");
    const t2 = ui.doc.querySelector(".confirmacion")!.textContent!;
    expect(t2).toContain("¿Borrar el área “Programación”?");
    expect(t2).toContain("1 subárea, 1 tema, 2 tarjetas"); // CS50 ya estaba borrada antes: no se cuenta
    await ui.clic("Mover a la papelera");
    expect(ui.doc.querySelector("h1")!.textContent).toBe("Tus áreas"); // vuelve a Áreas
    expect(ui.texto()).toContain("Área “Programación” quedó en la papelera 30 días.");
    expect([...ui.doc.querySelectorAll(".area-abrir")].map((x) => x.textContent)).toEqual(["Idiomas"]);
    expect(ui.boton("Repasar hoy")!.textContent!.trim()).toBe("Repasar hoy · 2");
    expect(ui.doc.activeElement?.id).toBe("titulo-pantalla");
    await ui.clic("Deshacer");
    expect(ui.doc.querySelector("h1")!.textContent).toBe("Programación"); // vuelve al detalle del área restaurada
    expect([...ui.doc.querySelectorAll(".seccion-area h2")].map((x) => x.textContent)).toEqual(["Python"]); // la subárea borrada antes sigue en la papelera
    expect((await a.areas.listar()).map((x) => x.nombre).sort()).toEqual(["Idiomas", "Programación", "Python"]);
  });

  it("P7 (UI): la papelera de Tarjetas muestra el detalle del conjunto y restaurar pide primero el área si hace falta", async () => {
    const { a, ui } = await conTemas();
    await ui.clic("Programación");
    await ui.clic("Borrar subárea");
    await ui.clic("Mover a la papelera");
    await ui.clic("Borrar área");
    await ui.clic("Mover a la papelera");
    await ui.clic("Ver todas las tarjetas");
    await ui.clic("Ver papelera");
    expect(ui.texto()).toContain("Área: Programación (1 subárea, 1 tema, 2 tarjetas)");
    expect(ui.texto()).toContain("Área: Programación › CS50 (2 temas, 5 tarjetas)");
    const filas = [...ui.doc.querySelectorAll(".lista li")].filter((li) => li.textContent!.includes("Área:"));
    const filaCs = filas.find((li) => li.textContent!.includes("CS50"))!;
    (filaCs.querySelector("button") as unknown as HTMLButtonElement).click();
    await ui.app.esperar();
    expect(ui.texto()).toContain("primero restaurá su área");
    expect(ui.texto()).not.toContain("No se pudo completar");
    expect((await a.areas.listar()).map((x) => x.nombre)).toEqual(["Idiomas"]);
    const filaProg = [...ui.doc.querySelectorAll(".lista li")].find((li) => li.textContent!.includes("Área: Programación (1 subárea"))!;
    (filaProg.querySelector("button") as unknown as HTMLButtonElement).click();
    await ui.app.esperar();
    expect(ui.texto()).toContain("Área restaurada");
    expect((await a.areas.listar()).map((x) => x.nombre).sort()).toEqual(["Idiomas", "Programación", "Python"]);
  });
});

describe("P2/P6 (CSS): nombres largos y objetivos táctiles", () => {
  const css = readFileSync(new URL("../src/cliente/estilos.css", import.meta.url), "utf8");
  const regla = (sel: string) => css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((b) => b.split("{")).filter((p) => p.length === 2 && p[0]!.split(",").map((x) => x.trim()).includes(sel)).map((p) => p[1]!).join(";");

  it("P2 (CSS): los nombres largos sin espacios se cortan y los items de grilla y flex pueden encogerse", () => {
    for (const sel of [".area-nombre", ".area-abrir", ".etiquetas-sub li", ".encabezado-pantalla h1", ".fila-tema-nombre", ".confirmacion p", ".aviso"]) {
      expect(regla(sel), sel).toMatch(/overflow-wrap:\s*anywhere/);
    }
    for (const sel of [".area-tarjeta", ".seccion-area", ".fila-tema-linea > *", ".confirmacion"]) expect(regla(sel), sel).toMatch(/min-width:\s*0/);
    expect(regla(".mover-tema select")).toMatch(/max-width:\s*100%/);
  });

  it("P2 (CSS): el botón que abre el área mide 44 px o más", () => {
    expect(regla(".area-abrir")).toMatch(/min-height:\s*var\(--toque\)/);
    expect(regla(".area-abrir")).toMatch(/min-width:\s*var\(--toque\)/);
  });

  it("P7 (UI): borrar una subárea dice solo temas y tarjetas; un área con subáreas dice 2 subáreas, 3 temas, 4 tarjetas", async () => {
    const a = new AlmacenMemoria();
    const r = new RelojSimulado(AHORA);
    await importar(a, r, BLOQUE("Programación > CS50", "Funciones", 2));
    await importar(a, r, BLOQUE("Programación > Python", "Listas", 1));
    await importar(a, r, BLOQUE("Programación > Python", "Dicts", 1));
    const ui = await abrir(a, r);
    await ui.clic("Programación");
    await ui.clic("Borrar subárea");
    expect(ui.doc.querySelector(".confirmacion")!.textContent).toContain("Se van a la papelera: 1 tema, 2 tarjetas.");
    expect(ui.doc.querySelector(".confirmacion")!.textContent).not.toContain("subárea,");
    await ui.clic("Cancelar");
    await ui.clic("Borrar área");
    expect(ui.doc.querySelector(".confirmacion")!.textContent).toContain("Se van a la papelera: 2 subáreas, 3 temas, 4 tarjetas.");
  });

  it("P3 (UI): el mensaje de nombre vacío dice 'del área' y 'de la subárea'", async () => {
    const ui = await abrir();
    await ui.clic("Crear área");
    expect(ui.texto()).toContain("El nombre del área no puede quedar vacío.");
  });
});
