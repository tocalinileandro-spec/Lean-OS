/**
 * Interfaz del Repaso con chips (P4, P5), de la importación con revisión (P8, P9) y de la migración
 * desde Ajustes (P10, P11). La lógica pura está en areas.test.ts, revision-importacion.test.ts y migracion-original.test.ts.
 * DOM simulado (happy-dom).
 */
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../src/compartido/almacen.ts";
import { contadoresDeRepaso } from "../src/compartido/areas.ts";
import { fijarHoraCambio } from "../src/compartido/dia.ts";
import type { Area, Tarjeta } from "../src/compartido/esquema.ts";
import { importar } from "../src/compartido/importacion/importar.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { montarApp, type AppMontada } from "../src/cliente/ui/app.ts";
import { cargarAjustes, type Persistencia } from "../src/cliente/ui/logica.ts";

const HOY = "2026-11-22";
const AHORA = "2026-11-22T15:00:00.000Z";
const CSS = readFileSync(new URL("../src/cliente/estilos.css", import.meta.url), "utf8");
const leerBin = (ruta: string) => new Uint8Array(readFileSync(new URL(ruta, import.meta.url)));
const ZIP_ORIGINAL = leerBin("./fixtures/respaldo-original.zip");
const EJEMPLO = leerBin("../prototipo/ejemplos/aprendizaje_ejemplo.json");

class Memoria implements Persistencia {
  datos = new Map<string, string>();
  getItem(k: string) { return this.datos.get(k) ?? null; }
  setItem(k: string, v: string) { this.datos.set(k, v); }
}
afterEach(() => fijarHoraCambio());

async function abrir(a: AlmacenMemoria = new AlmacenMemoria(), r = new RelojSimulado(AHORA), archivos: Record<string, Uint8Array> = {}) {
  const ventana = new Window({ url: "http://localhost/" });
  const raiz = ventana.document.createElement("div");
  ventana.document.body.append(raiz);
  const persistencia = new Memoria();
  const app: AppMontada = montarApp(raiz as unknown as HTMLElement, {
    almacen: a, reloj: r, persistencia,
    leerBytes: async (f) => { const b = archivos[f.name]; if (!b) throw new Error("no se pudo leer"); return b; },
  });
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
  const escribir = async (selector: string, valor: string) => {
    const el = doc.querySelector(selector) as unknown as HTMLInputElement;
    el.value = valor;
    el.dispatchEvent(new ventana.Event("input", { bubbles: true }) as unknown as Event);
    await app.esperar();
  };
  const tecla = async (key: string, extra: Record<string, boolean> = {}) => {
    (doc as unknown as EventTarget).dispatchEvent(new ventana.KeyboardEvent("keydown", { key, bubbles: true, ...extra }) as unknown as Event);
    await app.esperar();
  };
  const elegirArchivos = async (nombres: string[]) => {
    const input = doc.querySelector("#archivo-original") as unknown as HTMLInputElement;
    Object.defineProperty(input, "files", { value: nombres.map((name) => ({ name })), configurable: true });
    input.dispatchEvent(new ventana.Event("change", { bubbles: true }) as unknown as Event);
    await app.esperar();
  };
  const texto = () => raiz.textContent ?? "";
  const chips = (grupo: string) => [...doc.querySelectorAll(`[role="group"][aria-label="${grupo}"] .chip`)] as unknown as HTMLButtonElement[];
  const chip = (grupo: string, inicio: string) => chips(grupo).find((c) => (c.textContent ?? "").trim().startsWith(inicio));
  const clicChip = async (grupo: string, inicio: string) => {
    const c = chip(grupo, inicio);
    if (!c) throw new Error(`No hay chip "${inicio}" en ${grupo}: ${chips(grupo).map((x) => x.textContent).join(" | ")}`);
    c.click();
    await app.esperar();
  };
  const ir = async (p: Parameters<AppMontada["ir"]>[0]) => { app.ir(p); await app.esperar(); };
  const contexto = () => doc.querySelector(".contexto")?.textContent ?? null;
  return { app, a, r, doc, raiz, ventana, persistencia, clic, escribir, tecla, boton, texto, chips, chip, clicChip, ir, contexto, elegirArchivos };
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
    ...base, created_at: creada, id: `t${i}`, area_id, pregunta: `pregunta ${i}`, respuesta: `respuesta secreta ${i}`, pista: null, suspendida: false, importacion_id: null,
    ease: 2.5, intervalo: 0, reps: 0, lapses: 0, vence: HOY, contenido_updated_at: creada, repaso_updated_at: creada, ...extra,
  };
};
const rep = (k: number, extra: Partial<Tarjeta>) => Array.from({ length: k }, () => tj(extra.area_id!, extra));

/** Datos de P1: Programación (CS50 y Python), Idiomas, Historia, más "Lógica" al día (0 para hoy). */
async function datosP1(a: AlmacenMemoria) {
  await a.areas.guardarVarios([
    area("prog", "Programación"), area("cs50", "CS50", "prog"), area("py", "Python", "prog"), area("idi", "Idiomas"), area("his", "Historia"), area("log", "Lógica"),
  ]);
  const venc = (id: string, k: number, intervalo: number, vence: string, extra: Partial<Tarjeta> = {}) => rep(k, { area_id: id, intervalo, reps: 3, vence, ...extra });
  await a.tarjetas.guardarVarios([
    ...rep(3, { area_id: "prog" }),
    ...venc("cs50", 10, 30, "2026-11-20"), ...rep(7, { area_id: "cs50" }),
    ...venc("py", 8, 5, HOY), ...venc("py", 4, 40, "2026-11-01", { suspendida: true }),
    ...venc("idi", 15, 25, "2026-12-10"), ...rep(5, { area_id: "idi" }), ...venc("idi", 3, 2, "2026-11-21"),
    ...venc("his", 14, 22, "2026-11-23"), ...venc("his", 2, 1, "2026-11-21"),
    ...venc("log", 2, 30, "2026-12-30"),
  ]);
}

const BLOQUE = (areaTexto: string, tema: string, pregs: number, resumen: string | null = "Resumen del tema.") => ({
  tipo: "aprendizaje", fecha: HOY, area: areaTexto, tema, ...(resumen === null ? {} : { resumen }),
  preguntas: Array.from({ length: pregs }, (_, i) => ({ p: `${tema} pregunta ${i}`, r: `respuesta secreta ${tema} ${i}` })),
});

const sinEstilosEnLinea = (ui: { doc: { querySelectorAll(s: string): ArrayLike<unknown> } }) => expect(ui.doc.querySelectorAll("[style]")).toHaveLength(0);

describe("P4 (UI): Repaso con chips", () => {
  it("P4: los chips 'Qué repasar' muestran 'Todo lo de hoy' y cada área con su contador; las áreas suman el total", async () => {
    const a = new AlmacenMemoria();
    await datosP1(a);
    const ui = await abrir(a);
    await ui.ir("repaso");
    const cont = await contadoresDeRepaso(a, ui.r, { limiteNuevas: cargarAjustes(ui.persistencia).nuevasPorDia });
    const grupo = ui.doc.querySelector('[role="group"][aria-label="Qué repasar"]')!;
    expect(grupo).not.toBeNull();
    const chips = ui.chips("Qué repasar");
    expect(chips.map((c) => c.textContent!.trim())).toEqual(["Todo lo de hoy " + cont.todo, ...cont.areas.map((x) => `${x.nombre} ${x.paraHoy}`)]);
    expect(cont.areas.reduce((s, x) => s + x.paraHoy, 0)).toBe(cont.todo);
    expect(cont.todo).toBeGreaterThan(0);
    expect(chips.every((c) => c.tagName === "BUTTON" && c.hasAttribute("aria-pressed"))).toBe(true);
    expect(chips.map((c) => c.getAttribute("aria-pressed"))).toEqual(["true", ...cont.areas.map(() => "false")]);
    // Sin área elegida no hay segunda fila.
    expect(ui.doc.querySelector('[aria-label="Subárea"]')).toBeNull();
    expect(ui.texto()).toContain(`Tarjeta 1 de ${cont.todo}`);
    sinEstilosEnLinea(ui);
  });

  it("P4: elegir un área filtra (incluye sus subáreas) y muestra la fila 'Subárea'; elegir una subárea solo lo suyo", async () => {
    const a = new AlmacenMemoria();
    await datosP1(a);
    const ui = await abrir(a);
    await ui.ir("repaso");
    const cont = await contadoresDeRepaso(a, ui.r, { limiteNuevas: cargarAjustes(ui.persistencia).nuevasPorDia });
    const prog = cont.areas.find((x) => x.nombre === "Programación")!;
    await ui.clicChip("Qué repasar", "Programación");
    expect(ui.chip("Qué repasar", "Programación")!.getAttribute("aria-pressed")).toBe("true");
    expect(ui.chip("Qué repasar", "Todo lo de hoy")!.getAttribute("aria-pressed")).toBe("false");
    expect(ui.texto()).toContain(`Tarjeta 1 de ${prog.paraHoy}`);
    expect(ui.chips("Subárea").map((c) => c.textContent!.trim())).toEqual([
      `Toda el área ${prog.paraHoy}`, ...prog.subareas.map((s) => `${s.nombre} ${s.paraHoy}`),
    ]);
    expect(ui.chip("Subárea", "Toda el área")!.getAttribute("aria-pressed")).toBe("true");
    const cs50 = prog.subareas.find((s) => s.nombre === "CS50")!;
    await ui.clicChip("Subárea", "CS50");
    expect(ui.texto()).toContain(`Tarjeta 1 de ${cs50.paraHoy}`);
    expect(ui.chip("Subárea", "CS50")!.getAttribute("aria-pressed")).toBe("true");
    expect(ui.chip("Subárea", "Toda el área")!.getAttribute("aria-pressed")).toBe("false");
    expect(ui.chip("Qué repasar", "Programación")!.getAttribute("aria-pressed")).toBe("true");
    expect(ui.contexto()).toMatch(/^Programación › CS50/);
    // Volver a "Todo lo de hoy" quita la segunda fila.
    await ui.clicChip("Qué repasar", "Todo lo de hoy");
    expect(ui.doc.querySelector('[aria-label="Subárea"]')).toBeNull();
    expect(ui.texto()).toContain(`Tarjeta 1 de ${cont.todo}`);
    // Un área sin subáreas no muestra la fila.
    await ui.clicChip("Qué repasar", "Idiomas");
    expect(ui.doc.querySelector('[aria-label="Subárea"]')).toBeNull();
  });

  it("P4: el filtro se mantiene mientras se califica; 'Otra vez' reencola y el total crece; el tope de nuevas se respeta", async () => {
    const a = new AlmacenMemoria();
    await datosP1(a);
    const ui = await abrir(a, new RelojSimulado(AHORA));
    ui.persistencia.setItem("lean-os:ajustes", JSON.stringify({ nuevasPorDia: 2 }));
    await ui.ir("repaso");
    const cont = await contadoresDeRepaso(a, ui.r, { limiteNuevas: 2 });
    const cs50 = cont.areas.find((x) => x.nombre === "Programación")!.subareas.find((s) => s.nombre === "CS50")!;
    expect(cont.todo).toBe(23 + 2); // 23 vencidas y solo 2 de las 15 nuevas (R7): el tope se aplica antes del filtro
    expect(cont.areas.reduce((s, x) => s + x.paraHoy, 0)).toBe(cont.todo);
    const m = cs50.paraHoy;
    expect(m).toBeGreaterThanOrEqual(10);
    await ui.ir("repaso"); // recarga la sesión con el tope nuevo
    await ui.clicChip("Qué repasar", "Programación");
    await ui.clicChip("Subárea", "CS50");
    expect(ui.texto()).toContain(`Tarjeta 1 de ${m}`);
    expect(ui.texto()).toContain(`Faltan ${m - 1}`);
    await ui.tecla(" ");
    await ui.tecla("3"); // Bien
    expect(ui.texto()).toContain(`Tarjeta 2 de ${m}`);
    expect(ui.texto()).toContain(`Faltan ${m - 2}`);
    expect(ui.chip("Subárea", "CS50")!.getAttribute("aria-pressed")).toBe("true");
    const progreso = ui.doc.querySelector("progress")!;
    expect(progreso.getAttribute("max")).toBe(String(m));
    expect(Number(progreso.getAttribute("value") ?? (progreso as unknown as HTMLProgressElement).value)).toBe(1);
    // "Otra vez" vuelve la tarjeta al final: se califica una más (N sube) y el total crece en uno.
    await ui.tecla(" ");
    await ui.tecla("1");
    expect(ui.texto()).toContain(`Tarjeta 3 de ${m + 1}`);
    expect(ui.texto()).toContain(`Faltan ${m - 2}`);
    // Ctrl+Z deshace y vuelve a lo anterior.
    await ui.tecla("z", { ctrlKey: true });
    expect(ui.texto()).toContain(`Tarjeta 2 de ${m}`);
    expect(ui.chip("Subárea", "CS50")!.getAttribute("aria-pressed")).toBe("true");
    sinEstilosEnLinea(ui);
  });

  it("P4: un chip con 0 es válido y muestra el estado vacío con la fecha de lo próximo; 'Ver áreas' y 'Volver a Hoy' están", async () => {
    const a = new AlmacenMemoria();
    await datosP1(a);
    const ui = await abrir(a);
    await ui.ir("repaso");
    expect(ui.chip("Qué repasar", "Lógica")!.textContent!.trim()).toBe("Lógica 0");
    await ui.clicChip("Qué repasar", "Lógica");
    expect(ui.doc.querySelector("h1")!.textContent).toBe("No hay nada para repasar en esta área");
    expect(ui.texto()).toContain("Lo próximo toca el 30/12/2026.");
    expect(ui.texto()).not.toContain("Listo: repasaste");
    expect(ui.chip("Qué repasar", "Lógica")!.getAttribute("aria-pressed")).toBe("true"); // se puede elegir otro desde ahí
    expect(ui.boton("Ver áreas")).toBeTruthy();
    expect(ui.boton("Volver a Hoy")).toBeTruthy();
    await ui.clic("Ver áreas");
    expect(ui.doc.querySelector("h1")!.textContent).toBe("Tus áreas");
    // Elegir otra cosa desde el vacío vuelve a mostrar tarjetas.
    await ui.ir("repaso");
    await ui.clicChip("Qué repasar", "Lógica");
    await ui.clicChip("Qué repasar", "Idiomas");
    expect(ui.doc.querySelector(".tarjeta-repaso .pregunta")!.textContent).toMatch(/^pregunta/);
  });

  it("P4: al terminar la sesión dice 'Listo: repasaste N' y cuándo toca lo próximo (la fecha de las tarjetas activas del filtro)", async () => {
    const a = new AlmacenMemoria();
    await a.areas.guardarVarios([area("x", "Ciencias"), area("y", "Arte")]);
    await a.tarjetas.guardarVarios([tj("x"), tj("x"), tj("y", { intervalo: 9, reps: 3, vence: "2027-01-15" })]);
    const ui = await abrir(a);
    await ui.ir("repaso");
    await ui.clicChip("Qué repasar", "Ciencias");
    await ui.tecla(" "); await ui.tecla("3");
    await ui.tecla(" "); await ui.tecla("4"); // Bien (1 día) y Fácil (4 días)
    expect(ui.doc.querySelector("h1")!.textContent).toBe("No hay nada para repasar en esta área");
    expect(ui.texto()).toContain("Listo: repasaste 2 tarjetas.");
    expect(ui.texto()).toContain("Lo próximo toca el 23/11/2026.");
    // Con "Todo lo de hoy" vacío también.
    await ui.clicChip("Qué repasar", "Todo lo de hoy");
    expect(ui.doc.querySelector("h1")!.textContent).toBe("No hay nada para repasar hoy");
    expect(ui.texto()).toContain("Lo próximo toca el 23/11/2026.");
    expect(ui.boton("Deshacer")).toBeUndefined(); // sesión nueva: nada que deshacer
  });

  it("P4: 'Repasar esta área' del detalle abre el Repaso con ese filtro marcado", async () => {
    const a = new AlmacenMemoria();
    const r = new RelojSimulado(AHORA);
    await importar(a, r, JSON.stringify(BLOQUE("Programación > CS50", "Funciones", 3)));
    await importar(a, r, JSON.stringify(BLOQUE("Programación > Python", "Listas", 2)));
    await importar(a, r, JSON.stringify(BLOQUE("Idiomas", "Verbos", 2)));
    const ui = await abrir(a, r);
    await ui.clic("Programación");
    await ui.clic("Repasar esta área");
    expect(ui.chip("Qué repasar", "Programación")!.getAttribute("aria-pressed")).toBe("true");
    expect(ui.chip("Qué repasar", "Todo lo de hoy")!.getAttribute("aria-pressed")).toBe("false");
    expect(ui.texto()).toContain("Tarjeta 1 de 5");
    expect(ui.chip("Subárea", "Toda el área")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("P4: en el celular los chips se deslizan dentro de su fila y las reglas del Repaso no usan estilos en línea", () => {
    const movil = CSS.slice(CSS.indexOf("@media (max-width: 640px) {\n  .repaso { gap"));
    expect(movil).toMatch(/\.chips-fila\.chips \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto/);
    expect(movil).toMatch(/\.chips-fila \.chip \{[^}]*white-space: nowrap/);
    expect(CSS).toMatch(/\.chips-fila \.chip \{[^}]*flex: none/);
    expect(CSS).toMatch(/\.chip \{[^}]*min-height: var\(--toque\)/);
  });
});

describe("P5 (UI): la tarjeta con su contexto, el progreso y el resumen del tema", () => {
  async function tresTarjetas() {
    const a = new AlmacenMemoria();
    const r = new RelojSimulado(AHORA);
    await importar(a, r, JSON.stringify(BLOQUE("Programación > CS50", "Funciones", 2, "Las funciones agrupan código y se llaman por su nombre.")));
    await importar(a, r, JSON.stringify(BLOQUE("Idiomas", "Verbos", 1, "Los verbos irregulares se estudian aparte.")));
    await importar(a, r, JSON.stringify(BLOQUE("Programación > CS50", "Sin resumen", 1, null)));
    await a.areas.guardarVarios([area("man", "Manuales", (await a.areas.listar()).find((x) => x.nombre === "Programación")!.id)]);
    await a.tarjetas.guardarVarios([tj("man", { pregunta: "Creada a mano", respuesta: "respuesta de mano secreta" })]);
    const ui = await abrir(a, r);
    await ui.ir("repaso");
    return { a, r, ui };
  }

  it("P5: la etiqueta dice 'Área › Subárea · Tema', 'Área · Tema' o 'Área › Subárea' según la tarjeta", async () => {
    const { ui } = await tresTarjetas();
    await ui.clicChip("Qué repasar", "Programación");
    await ui.clicChip("Subárea", "CS50");
    const etiquetas = new Set<string>();
    for (let i = 0; i < 3; i++) { etiquetas.add(ui.contexto()!); await ui.tecla(" "); await ui.tecla("3"); }
    expect([...etiquetas].sort()).toEqual(["Programación › CS50 · Funciones", "Programación › CS50 · Sin resumen"]);
    await ui.clicChip("Qué repasar", "Idiomas");
    expect(ui.contexto()).toBe("Idiomas · Verbos");
    await ui.clicChip("Qué repasar", "Programación");
    await ui.clicChip("Subárea", "Manuales");
    expect(ui.contexto()).toBe("Programación › Manuales");
    expect(ui.doc.querySelector(".tarjeta-repaso h1.pregunta")!.textContent).toBe("Creada a mano");
  });

  it("P5: los cuatro botones muestran el intervalo siguiente (R1 a R4) y se ve 'Tarjeta N de M'", async () => {
    const { ui } = await tresTarjetas();
    await ui.clicChip("Qué repasar", "Idiomas");
    expect(ui.texto()).toContain("Tarjeta 1 de 1");
    await ui.clic("Ver respuesta");
    expect([...ui.doc.querySelectorAll(".calificar")].map((b) => b.textContent)).toEqual(["Otra vez" + "Hoy" + "1", "Difícil" + "1 día" + "2", "Bien" + "1 día" + "3", "Fácil" + "4 días" + "4"]);
    expect(ui.texto()).toContain("¿Qué tan bien te acordabas?");
    expect(ui.doc.querySelector(".respuesta")!.textContent).toContain("respuesta secreta Verbos 0");
    expect(ui.doc.querySelector('.botones-respuesta[role="group"]')!.getAttribute("aria-labelledby")).toBe("r-calif-titulo");
    // R4: "Otra vez" la reencola en la misma sesión (N sube y M también).
    await ui.tecla("1");
    expect(ui.texto()).toContain("Tarjeta 2 de 2");
    expect(ui.texto()).toContain("Faltan 0");
  });

  it("P5: 'Ver el resumen del tema' abre el resumen sin revelar la respuesta ni cambiar la sesión (R9 intacto)", async () => {
    const { a, ui } = await tresTarjetas();
    await ui.clicChip("Qué repasar", "Idiomas");
    const respuesta = "respuesta secreta Verbos 0";
    const enlace = ui.doc.querySelector("#r-ver-resumen") as unknown as HTMLButtonElement;
    expect(enlace.textContent).toBe("Ver el resumen del tema");
    expect(ui.doc.querySelector('[role="dialog"]')).toBeNull();
    enlace.click();
    await ui.app.esperar();
    const dialogo = ui.doc.querySelector('[role="dialog"]')!;
    expect(dialogo).not.toBeNull();
    expect(dialogo.getAttribute("aria-modal")).toBe("true");
    expect(dialogo.textContent).toContain("Los verbos irregulares se estudian aparte.");
    expect(dialogo.querySelector("h2")!.textContent).toBe("Resumen de Verbos");
    expect(ui.doc.getElementById(dialogo.getAttribute("aria-labelledby")!)).not.toBeNull();
    // R9: la respuesta no está en la página, ni con el panel abierto.
    expect(ui.raiz.textContent).not.toContain(respuesta);
    expect(ui.raiz.innerHTML).not.toContain(respuesta);
    // El foco está en el diálogo, y los atajos no califican ni muestran la respuesta mientras está abierto.
    expect(ui.doc.activeElement!.id).toBe("r-resumen");
    await ui.tecla(" ");
    await ui.tecla("3");
    expect(ui.raiz.textContent).not.toContain(respuesta);
    expect(await a.repasos.listar()).toHaveLength(0);
    expect(ui.texto()).toContain("Tarjeta 1 de 1");
    // Tab no saca el foco del diálogo.
    for (let i = 0; i < 3; i++) { await ui.tecla("Tab"); expect(dialogo.contains(ui.doc.activeElement)).toBe(true); }
    await ui.tecla("Tab", { shiftKey: true });
    expect(dialogo.contains(ui.doc.activeElement)).toBe(true);
    // Escape lo cierra y el foco vuelve al enlace; la sesión sigue en el mismo punto y la respuesta sigue oculta.
    await ui.tecla("Escape");
    expect(ui.doc.querySelector('[role="dialog"]')).toBeNull();
    expect(ui.doc.activeElement!.id).toBe("r-ver-resumen");
    expect(ui.raiz.textContent).not.toContain(respuesta);
    expect(ui.boton("Ver respuesta")).toBeTruthy();
    expect(ui.texto()).toContain("Tarjeta 1 de 1");
    // También se cierra con el botón, y se puede abrir con la respuesta ya visible sin cambiar nada.
    await ui.clic("Ver respuesta");
    await ui.clic("Ver el resumen del tema");
    expect(ui.doc.querySelector('[role="dialog"]')!.textContent).not.toContain(respuesta);
    await ui.clic("Cerrar");
    expect(ui.doc.querySelector('[role="dialog"]')).toBeNull();
    expect(ui.doc.querySelector(".respuesta")!.textContent).toContain(respuesta);
    expect(await a.repasos.listar()).toHaveLength(0);
    sinEstilosEnLinea(ui);
  });

  it("P5: sin resumen (o tarjeta creada a mano) el enlace no aparece", async () => {
    const { ui } = await tresTarjetas();
    await ui.clicChip("Qué repasar", "Programación");
    await ui.clicChip("Subárea", "Manuales");
    expect(ui.doc.querySelector("#r-ver-resumen")).toBeNull();
    expect(ui.texto()).not.toContain("Ver el resumen del tema");
    await ui.clicChip("Subárea", "CS50");
    const vistas: Record<string, boolean> = {};
    for (let i = 0; i < 3; i++) { vistas[ui.contexto()!] = !!ui.doc.querySelector("#r-ver-resumen"); await ui.tecla(" "); await ui.tecla("3"); }
    expect(vistas).toEqual({ "Programación › CS50 · Funciones": true, "Programación › CS50 · Sin resumen": false });
  });

  it("P5: R9 con filtros: la respuesta no está hasta 'Ver respuesta' en ningún chip; la ayuda de atajos está, y el CSS la oculta en el celular", async () => {
    const { ui } = await tresTarjetas();
    for (const c of ["Todo lo de hoy", "Programación", "Idiomas"]) {
      await ui.clicChip("Qué repasar", c);
      expect(ui.raiz.innerHTML).not.toContain("respuesta secreta");
      expect(ui.raiz.innerHTML).not.toContain("respuesta de mano secreta");
    }
    expect(ui.texto()).toContain("Atajos: espacio para mostrar la respuesta · 1 a 4 para calificar");
    expect(CSS).toMatch(/@media \(max-width: 640px\) \{\n  \.repaso \{ gap[\s\S]*\.atajos \{ display: none; \}/);
    expect(CSS).toMatch(/\.botones-respuesta \{[^}]*repeat\(4/);
  });
});

describe("P8: importar con revisión", () => {
  const JSON_OK = JSON.stringify(BLOQUE("Programación > CS50", "Funciones en Python", 3, "Las funciones agrupan código."));
  async function abrirImportar(a = new AlmacenMemoria()) {
    const ui = await abrir(a);
    await ui.ir("tarjetas");
    await ui.clic("Importar");
    return ui;
  }
  const cuentas = async (a: AlmacenMemoria) => ({ t: (await a.tarjetas.listar()).length, ar: (await a.areas.listar()).length, im: (await a.importaciones.listar()).length, ap: (await a.apuntes.listar()).length });
  const caja = (ui: { doc: { querySelector(s: string): unknown } }) => ui.doc.querySelector("#caja-importar") as unknown as HTMLTextAreaElement;

  it("P8: 'Revisar' muestra área › subárea, tema, fecha, cantidades, resumen y las preguntas, sin crear nada", async () => {
    const a = new AlmacenMemoria();
    const ui = await abrirImportar(a);
    await ui.escribir("#caja-importar", JSON_OK);
    await ui.clic("Revisar");
    const previa = ui.doc.querySelector(".vista-previa")!;
    expect(previa).not.toBeNull();
    expect(previa.querySelector(".contexto")!.textContent).toBe("Programación › CS50");
    expect(previa.querySelector("h3")!.textContent).toBe("Funciones en Python");
    expect(previa.textContent).toContain("22/11/2026");
    expect(previa.textContent).toContain("3 preguntas: 3 nuevas, 0 duplicadas");
    expect(previa.textContent).toContain("Las funciones agrupan código.");
    expect([...previa.querySelectorAll(".preguntas-previas li")].map((li) => li.querySelector(".pregunta-previa")!.textContent)).toEqual([
      "Funciones en Python pregunta 0", "Funciones en Python pregunta 1", "Funciones en Python pregunta 2",
    ]);
    expect(ui.boton("Confirmar importación")).toBeTruthy();
    expect(ui.boton("Cancelar")).toBeTruthy();
    expect(ui.texto()).not.toContain("Creadas:");
    expect(await cuentas(a)).toEqual({ t: 0, ar: 0, im: 0, ap: 0 });
    expect(caja(ui).value).toBe(JSON_OK);
    sinEstilosEnLinea(ui);
  });

  it("P8: 'Confirmar importación' da el resultado de I1 (3 tarjetas, área, subárea, apunte) y el informe; repetir da 0 creadas (I2)", async () => {
    const a = new AlmacenMemoria();
    const ui = await abrirImportar(a);
    await ui.escribir("#caja-importar", JSON_OK);
    await ui.clic("Revisar");
    await ui.clic("Confirmar importación");
    expect(ui.texto()).toContain("Creadas: 3 · Duplicadas omitidas: 0 · Errores: 0");
    expect(ui.doc.activeElement!.id).toBe("importar-informe"); // el informe recibe el foco (queda a la vista)
    const ts = await a.tarjetas.listar();
    expect(ts).toHaveLength(3);
    expect(ts.every((t) => t.ease === 2.5 && t.vence === HOY)).toBe(true);
    const areas = await a.areas.listar();
    const prog = areas.find((x) => x.nombre === "Programación")!;
    expect(areas.find((x) => x.nombre === "CS50")!.padre_id).toBe(prog.id);
    const ap = await a.apuntes.listar();
    expect(ap).toHaveLength(1);
    expect(ap[0]).toMatchObject({ tipo: "aprendizaje", texto: "Las funciones agrupan código." });
    expect(caja(ui).value).toBe("");
    expect(ui.boton("Confirmar importación")).toBeUndefined();
    // Otra vez el mismo bloque: la revisión avisa que ya estaba y no ofrece confirmar (0 nuevas).
    await ui.escribir("#caja-importar", JSON_OK);
    await ui.clic("Revisar");
    expect(ui.texto()).toContain("3 preguntas: 0 nuevas, 3 duplicadas");
    expect(ui.texto()).toContain("Este bloque ya estaba importado");
    expect(ui.boton("Confirmar importación")).toBeUndefined();
    expect(await cuentas(a)).toEqual({ t: 3, ar: 2, im: 1, ap: 1 });
  });

  it("P8: con cercas de código y coma final se importa igual (I3), y confirmar informa las duplicadas con otra respuesta", async () => {
    const a = new AlmacenMemoria();
    const ui = await abrirImportar(a);
    const conCercas = "```json\n" + JSON_OK.replace(/}\]}$/, "},]}") + "\n```";
    await ui.escribir("#caja-importar", conCercas);
    await ui.clic("Revisar");
    expect(ui.raiz.querySelector(".errores")).toBeNull();
    expect(ui.doc.querySelector(".vista-previa")!.textContent).toContain("3 preguntas: 3 nuevas, 0 duplicadas");
    await ui.clic("Confirmar importación");
    expect(ui.texto()).toContain("Creadas: 3");
    expect((await a.tarjetas.listar()).map((t) => t.pregunta).sort()).toEqual(["Funciones en Python pregunta 0", "Funciones en Python pregunta 1", "Funciones en Python pregunta 2"]);
    const otra = JSON.stringify({ ...BLOQUE("programacion > cs50", "Otro", 1), preguntas: [{ p: "funciones en python PREGUNTA 0", r: "Distinta" }, { p: "Nueva", r: "x" }] });
    await ui.escribir("#caja-importar", otra);
    await ui.clic("Revisar");
    expect(ui.doc.querySelector(".vista-previa .contexto")!.textContent).toBe("Programación › CS50");
    expect(ui.doc.querySelector(".vista-previa")!.textContent).toContain("2 preguntas: 1 nueva, 1 duplicada");
    expect(ui.doc.querySelector(".avisos")!.textContent).toContain("otra respuesta");
    await ui.clic("Confirmar importación");
    expect(ui.texto()).toContain("Creadas: 1 · Duplicadas omitidas: 1");
    expect(ui.doc.querySelector(".informe .avisos")!.textContent).toContain("otra respuesta");
  });

  it("P8: 'Cancelar' no crea nada, deja el texto en la caja y quita la vista previa", async () => {
    const a = new AlmacenMemoria();
    const ui = await abrirImportar(a);
    await ui.escribir("#caja-importar", JSON_OK);
    await ui.clic("Revisar");
    await ui.clic("Cancelar");
    expect(ui.doc.querySelector(".vista-previa")).toBeNull();
    expect(ui.boton("Confirmar importación")).toBeUndefined();
    expect(caja(ui).value).toBe(JSON_OK);
    expect(await cuentas(a)).toEqual({ t: 0, ar: 0, im: 0, ap: 0 });
    // Se puede volver a revisar con el mismo texto.
    await ui.clic("Revisar");
    expect(ui.doc.querySelector(".vista-previa")).not.toBeNull();
  });

  it("P8: un JSON cortado (I4) muestra su error con la posición al revisar, deja el texto y no ofrece confirmar", async () => {
    const a = new AlmacenMemoria();
    const ui = await abrirImportar(a);
    const cortado = JSON_OK.slice(0, JSON_OK.length / 2);
    await ui.escribir("#caja-importar", cortado);
    await ui.clic("Revisar");
    const errores = ui.doc.querySelector(".errores")!;
    expect(errores.textContent).toContain("posición");
    expect(caja(ui).value).toBe(cortado);
    expect(ui.boton("Confirmar importación")).toBeUndefined();
    expect(ui.doc.querySelector(".vista-previa")).toBeNull();
    expect(await cuentas(a)).toEqual({ t: 0, ar: 0, im: 0, ap: 0 });
    expect(ui.texto()).not.toMatch(/SyntaxError|undefined|\[object/);
  });

  it("P8: un bloque sin 'preguntas' y otro con una 'r' vacía (I5) se rechazan al revisar nombrando el campo", async () => {
    const a = new AlmacenMemoria();
    const ui = await abrirImportar(a);
    const sinPreguntas = JSON.stringify({ tipo: "aprendizaje", fecha: HOY, area: "X", tema: "T" });
    await ui.escribir("#caja-importar", sinPreguntas);
    await ui.clic("Revisar");
    expect(ui.doc.querySelector(".errores")!.textContent).toContain("preguntas");
    expect(ui.boton("Confirmar importación")).toBeUndefined();
    const rVacia = JSON.stringify({ tipo: "aprendizaje", fecha: HOY, area: "X", tema: "T", preguntas: [{ p: "¿Algo?", r: "" }] });
    await ui.escribir("#caja-importar", rVacia);
    await ui.clic("Revisar");
    expect(ui.doc.querySelector(".errores")!.textContent).toMatch(/"r"|respuesta/);
    expect(caja(ui).value).toBe(rVacia);
    expect(await cuentas(a)).toEqual({ t: 0, ar: 0, im: 0, ap: 0 });
  });

  it("P8: con un bloque bueno y otro malo la revisión muestra los dos y confirmar importa solo el bueno, con los errores en el informe", async () => {
    const a = new AlmacenMemoria();
    const ui = await abrirImportar(a);
    const mixto = JSON.stringify([BLOQUE("Idiomas", "Verbos", 2), { tipo: "aprendizaje", fecha: HOY, area: "Y", tema: "Roto" }]);
    await ui.escribir("#caja-importar", mixto);
    await ui.clic("Revisar");
    expect(ui.doc.querySelector(".errores")!.textContent).toContain("Bloque 2");
    expect(ui.doc.querySelectorAll(".bloque-previo")).toHaveLength(1);
    await ui.clic("Confirmar importación");
    expect(ui.texto()).toContain("Creadas: 2 · Duplicadas omitidas: 0 · Errores: 1");
    expect(caja(ui).value).toBe(mixto); // con errores el texto queda para corregirlo
  });

  it("P8: editar el texto después de revisar descarta la vista previa (no se puede confirmar algo ya cambiado)", async () => {
    const a = new AlmacenMemoria();
    const ui = await abrirImportar(a);
    await ui.escribir("#caja-importar", JSON_OK);
    await ui.clic("Revisar");
    expect(ui.boton("Confirmar importación")).toBeTruthy();
    await ui.escribir("#caja-importar", JSON_OK + " ");
    expect(ui.boton("Confirmar importación")).toBeUndefined();
    expect(ui.doc.querySelector(".vista-previa")).toBeNull();
  });

  it("P8: 'Tus áreas' aparece como ayuda cuando ya hay áreas (y no antes)", async () => {
    const a = new AlmacenMemoria();
    let ui = await abrirImportar(a);
    expect(ui.texto()).not.toContain("Tus áreas");
    await importar(a, new RelojSimulado(AHORA), JSON.stringify(BLOQUE("Programación > CS50", "T", 1)));
    await importar(a, new RelojSimulado(AHORA), JSON.stringify(BLOQUE("Idiomas", "T", 1)));
    ui = await abrirImportar(a);
    expect(ui.doc.querySelector(".ayuda-areas")!.textContent).toBe("Tus áreas: Idiomas, Programación.");
  });
});

describe("P9: la caja de importar no muestra nada que no corresponda", () => {
  const JSON_OK = JSON.stringify(BLOQUE("Programación > CS50", "Funciones", 2));
  const visibleAlAbrir = (ui: { doc: { querySelector(s: string): unknown }; texto: () => string; boton: (t: string) => unknown }) => {
    expect(ui.doc.querySelector(".importar")).not.toBeNull();
    expect(ui.doc.querySelector(".importar .informe")).toBeNull();
    expect(ui.doc.querySelector(".importar .errores")).toBeNull();
    expect(ui.doc.querySelector(".importar .vista-previa")).toBeNull();
    expect(ui.doc.querySelector('.importar [role="alert"]')).toBeNull();
    expect(ui.doc.querySelector(".importar .recordatorio")).toBeNull();
    expect(ui.texto()).not.toMatch(/Creadas:|Duplicadas omitidas|Errores:|No pude leer|nuevas,/);
    expect(ui.boton("Confirmar importación")).toBeUndefined();
    expect((ui.doc.querySelector("#caja-importar") as unknown as HTMLTextAreaElement).value).toBe("");
  };

  it("P9: al abrir la caja por primera vez no hay errores, informes ni conteos, ni botón de confirmar", async () => {
    const ui = await abrir();
    await ui.ir("tarjetas");
    await ui.clic("Importar");
    visibleAlAbrir(ui);
  });

  it("P9: después de una importación con errores, al cerrar y abrir la caja (o volver a la pantalla) no queda nada", async () => {
    const a = new AlmacenMemoria();
    const ui = await abrir(a);
    await ui.ir("tarjetas");
    await ui.clic("Importar");
    const roto = JSON.stringify([BLOQUE("Idiomas", "Verbos", 1), { tipo: "aprendizaje", fecha: HOY, area: "Y", tema: "Roto" }]);
    await ui.escribir("#caja-importar", roto);
    await ui.clic("Revisar");
    expect(ui.doc.querySelector(".errores")).not.toBeNull();
    await ui.clic("Confirmar importación");
    expect(ui.doc.querySelector(".informe .errores")).not.toBeNull();
    expect(ui.texto()).toContain("Errores: 1");
    await ui.clic("Cerrar importación");
    await ui.clic("Importar");
    visibleAlAbrir(ui);
    // Otra vez con errores, y ahora se navega a otra pantalla y se vuelve.
    await ui.escribir("#caja-importar", "{ roto");
    await ui.clic("Revisar");
    expect(ui.doc.querySelector(".errores")).not.toBeNull();
    await ui.ir("hoy");
    await ui.ir("tarjetas");
    expect(ui.doc.querySelector(".importar .errores")).toBeNull();
    expect(ui.doc.querySelector(".importar .informe")).toBeNull();
    expect(ui.boton("Confirmar importación")).toBeUndefined();
  });

  it("P9: después de una importación exitosa, el informe no reaparece al reabrir la caja ni al deshacer", async () => {
    const a = new AlmacenMemoria();
    const ui = await abrir(a);
    await ui.ir("tarjetas");
    await ui.clic("Importar");
    await ui.escribir("#caja-importar", JSON_OK);
    await ui.clic("Revisar");
    await ui.clic("Confirmar importación");
    expect(ui.texto()).toContain("Creadas: 2");
    await ui.clic("Cerrar importación");
    await ui.clic("Importar");
    visibleAlAbrir(ui);
    await ui.escribir("#caja-importar", JSON_OK);
    await ui.clic("Revisar"); // todo duplicado: avisa y no confirma
    await ui.clic("Cancelar");
    await ui.clic("Deshacer última importación");
    expect(ui.texto()).toContain("Se deshizo la última importación");
    expect(ui.doc.querySelector(".importar .informe")).toBeNull();
    expect(ui.doc.querySelector(".importar .vista-previa")).toBeNull();
    // Y desde "Importar tarjetas" del detalle de un área, la caja abre limpia.
    await ui.ir("areas");
    await ui.clic("Programación");
    await ui.clic("Importar tarjetas");
    visibleAlAbrir(ui);
  });

  it("P9: 'Revisar' con la caja vacía muestra un recordatorio amable y no crea nada (tampoco con solo espacios)", async () => {
    const a = new AlmacenMemoria();
    const ui = await abrir(a);
    await ui.ir("tarjetas");
    await ui.clic("Importar");
    await ui.clic("Revisar");
    expect(ui.doc.querySelector(".recordatorio")!.textContent).toBe("Pegá primero el JSON que generó Claude.");
    expect(ui.doc.querySelector(".importar .errores")).toBeNull();
    expect(ui.doc.querySelector('.importar [role="alert"]')).toBeNull();
    expect(ui.boton("Confirmar importación")).toBeUndefined();
    expect(ui.texto()).not.toContain("No pegaste nada");
    await ui.escribir("#caja-importar", "   \n  ");
    await ui.clic("Revisar");
    expect(ui.doc.querySelector(".recordatorio")).not.toBeNull();
    expect((await a.tarjetas.listar()).length + (await a.areas.listar()).length + (await a.importaciones.listar()).length).toBe(0);
    // Al escribir algo, el recordatorio desaparece.
    await ui.escribir("#caja-importar", "{");
    expect(ui.doc.querySelector(".recordatorio")).toBeNull();
  });
});

describe("P10 (UI) y P11 (UI): importar el respaldo del Lean OS original desde Ajustes", () => {
  const archivos = { "lean-os-2026-11-22.zip": ZIP_ORIGINAL, "aprendizaje_ejemplo.json": EJEMPLO };
  const mala = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const totales = async (a: AlmacenMemoria) => ({ t: (await a.tarjetas.listar()).length, ar: (await a.areas.listar()).length, im: (await a.importaciones.listar()).length, ap: (await a.apuntes.listar()).length });

  it("P10: la sección existe en Ajustes con explicación y un campo de archivos múltiple para .zip y .json", async () => {
    const ui = await abrir(new AlmacenMemoria(), new RelojSimulado(AHORA), archivos);
    await ui.ir("ajustes");
    expect(ui.doc.querySelector("#migracion h2")!.textContent).toBe("Importar respaldo del Lean OS original");
    const input = ui.doc.querySelector("#archivo-original")!;
    expect(input.getAttribute("type")).toBe("file");
    expect(input.hasAttribute("multiple")).toBe(true);
    expect(input.getAttribute("accept")).toBe(".zip,.json,application/zip,application/json");
    expect(ui.doc.querySelector("#migracion")!.textContent).toMatch(/ZIP[\s\S]*Exportar todo[\s\S]*sin duplicar/);
    expect(ui.doc.querySelector("#migracion .informe")).toBeNull();
    sinEstilosEnLinea(ui);
  });

  it("P10: el ZIP del original crea áreas, subáreas, temas y tarjetas, y el informe lo cuenta en castellano", async () => {
    const a = new AlmacenMemoria();
    const ui = await abrir(a, new RelojSimulado(AHORA), archivos);
    await ui.ir("ajustes");
    await ui.elegirArchivos(["lean-os-2026-11-22.zip"]);
    const informe = ui.doc.querySelector("#migracion .informe")!;
    expect(informe.textContent).toContain("Se leyeron 3 áreas, 4 subáreas y 4 temas.");
    expect(informe.textContent).toContain("Tarjetas creadas: 11.");
    expect(informe.textContent).toContain("Duplicadas omitidas: 0.");
    expect(informe.querySelector(".errores")).toBeNull();
    expect(await totales(a)).toMatchObject({ t: 11, im: 4, ap: 4 });
    expect((await a.areas.listar()).find((x) => x.nombre === "CS50")!.padre_id).not.toBeNull();
    expect(ui.texto()).not.toMatch(/undefined|Error:|\[object/);
  });

  it("P10: el ejemplo del prototipo da 3 tarjetas en CS50 con su pista", async () => {
    const a = new AlmacenMemoria();
    const ui = await abrir(a, new RelojSimulado(AHORA), archivos);
    await ui.ir("ajustes");
    await ui.elegirArchivos(["aprendizaje_ejemplo.json"]);
    expect(ui.doc.querySelector("#migracion .informe")!.textContent).toContain("Tarjetas creadas: 3.");
    const ts = await a.tarjetas.listar();
    expect(ts).toHaveLength(3);
    const cs50 = (await a.areas.listar()).find((x) => x.nombre === "CS50")!;
    expect(ts.every((t) => t.area_id === cs50.id)).toBe(true);
    expect(ts.find((t) => t.pregunta === "¿Qué guarda un puntero?")!.pista).toBe("Piensa en una dirección postal, no en la casa.");
  });

  it("P11: repetir la importación crea 0 y todas son duplicadas; elegir varios archivos a la vez funciona; lo calificado se conserva", async () => {
    const a = new AlmacenMemoria();
    const ui = await abrir(a, new RelojSimulado(AHORA), archivos);
    await ui.ir("ajustes");
    await ui.elegirArchivos(["lean-os-2026-11-22.zip"]);
    const antes = await a.tarjetas.listar();
    expect(antes).toHaveLength(11);
    // Una tarjeta ya calificada en la app nueva: la segunda importación no la toca.
    const t0 = { ...antes[0]!, intervalo: 20, reps: 4, ease: 2.2, vence: "2026-12-12" };
    await a.tarjetas.guardar(t0);
    await ui.elegirArchivos(["lean-os-2026-11-22.zip"]);
    const informe = ui.doc.querySelector("#migracion .informe")!;
    expect(informe.textContent).toContain("Tarjetas creadas: 0.");
    expect(informe.textContent).toContain("Duplicadas omitidas: 11.");
    expect(await a.tarjetas.listar()).toHaveLength(11);
    expect(await a.tarjetas.obtener(t0.id)).toMatchObject({ intervalo: 20, reps: 4, ease: 2.2, vence: "2026-12-12" });
    // El ejemplo (3 tarjetas de CS50 que ya vinieron en el ZIP o no): varios archivos juntos, sin errores.
    await ui.elegirArchivos(["lean-os-2026-11-22.zip", "aprendizaje_ejemplo.json"]);
    expect(ui.doc.querySelector("#migracion .informe .errores")).toBeNull();
    expect((await a.tarjetas.listar()).length).toBeGreaterThanOrEqual(11);
  });

  it("P11: un archivo dañado o ajeno da un mensaje en castellano y no cambia nada; los buenos del mismo grupo se importan", async () => {
    const a = new AlmacenMemoria();
    const ui = await abrir(a, new RelojSimulado(AHORA), {
      ...archivos, "roto.zip": mala, "ajeno.json": new TextEncoder().encode(JSON.stringify({ hola: "mundo" })), "texto.json": new TextEncoder().encode("esto no es json"),
    });
    await ui.ir("ajustes");
    await ui.elegirArchivos(["roto.zip", "ajeno.json", "texto.json"]);
    const informe = ui.doc.querySelector("#migracion .informe")!;
    const errores = [...informe.querySelectorAll(".errores li")].map((l) => l.textContent!);
    expect(errores).toHaveLength(3);
    expect(errores.every((e) => e.includes("No se cambió nada"))).toBe(true);
    expect(errores.join(" ")).toContain("roto.zip");
    expect(informe.textContent).toContain("Tarjetas creadas: 0.");
    expect(await totales(a)).toEqual({ t: 0, ar: 0, im: 0, ap: 0 });
    expect(ui.texto()).not.toMatch(/TypeError|RangeError|stack|undefined|\[object/);
    // Con uno bueno al lado: el bueno entra, el malo se informa.
    await ui.elegirArchivos(["roto.zip", "aprendizaje_ejemplo.json"]);
    expect(await a.tarjetas.listar()).toHaveLength(3);
    expect(ui.doc.querySelectorAll("#migracion .informe .errores li")).toHaveLength(1);
  });

  it("P11: si no se puede leer un archivo, se avisa en castellano y el campo queda listo para elegir de nuevo", async () => {
    const a = new AlmacenMemoria();
    const ui = await abrir(a, new RelojSimulado(AHORA), archivos);
    await ui.ir("ajustes");
    await ui.elegirArchivos(["no-existe.zip"]);
    expect(ui.doc.querySelector("#migracion .informe .errores")!.textContent).toContain("no se pudo leer el archivo. No se cambió nada.");
    expect(await totales(a)).toEqual({ t: 0, ar: 0, im: 0, ap: 0 });
    const input = ui.doc.querySelector("#archivo-original") as unknown as HTMLInputElement;
    expect(input.value).toBe("");
    await ui.elegirArchivos(["aprendizaje_ejemplo.json"]); // reelegir sin recargar
    expect((await a.tarjetas.listar()).length).toBe(3);
  });

  it("P10: sin dependencia inyectada lee los bytes del archivo con File.arrayBuffer()", async () => {
    const a = new AlmacenMemoria();
    const ventana = new Window({ url: "http://localhost/" });
    const raiz = ventana.document.createElement("div");
    ventana.document.body.append(raiz);
    const app = montarApp(raiz as unknown as HTMLElement, { almacen: a, reloj: new RelojSimulado(AHORA), persistencia: new Memoria() }, "ajustes");
    await app.esperar();
    const input = ventana.document.querySelector("#archivo-original") as unknown as HTMLInputElement;
    const archivo = new ventana.File([EJEMPLO], "aprendizaje_ejemplo.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [archivo], configurable: true });
    input.dispatchEvent(new ventana.Event("change", { bubbles: true }) as unknown as Event);
    await app.esperar();
    expect((await a.tarjetas.listar()).length).toBe(3);
  });
});

describe("P8: textos largos sin desborde", () => {
  it("P8: el CSS corta los textos largos sin espacios en preguntas, respuestas, pistas, títulos, listas, informes y vista previa", () => {
    const regla = CSS.match(/h1, h2, h3, p, li,[^{]*\{[^}]*\}/)![0];
    for (const sel of [".pregunta", ".pista", ".respuesta p", ".informe", ".grupo", ".lista .texto", ".contexto"]) expect(regla).toContain(sel);
    expect(regla).toContain("overflow-wrap: anywhere");
    expect(regla).toContain("min-width: 0");
  });
});
