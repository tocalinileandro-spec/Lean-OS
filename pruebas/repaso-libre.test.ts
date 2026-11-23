/**
 * Repaso libre (P20, P21, P22): práctica que no cambia el calendario. Lógica pura, prueba de "antes y después"
 * sobre el almacén completo y la interfaz (happy-dom).
 */
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AlmacenMemoria, type Almacen } from "../src/compartido/almacen.ts";
import { colaDeRepaso, colaLibre, contadoresDeRepaso, contadoresDeRepasoLibre } from "../src/compartido/areas.ts";
import { fijarHoraCambio } from "../src/compartido/dia.ts";
import type { Area, Tarjeta } from "../src/compartido/esquema.ts";
import { calcularEstadisticas } from "../src/compartido/estadisticas.ts";
import { construirCola, SesionLibre } from "../src/compartido/repaso.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { montarApp, type AppMontada } from "../src/cliente/ui/app.ts";
import { PantallaRepaso, type Persistencia } from "../src/cliente/ui/logica.ts";
import { AlmacenSincronizado, ColaMemoria } from "../src/cliente/sync/cola.ts";

const HOY = "2026-11-22";
const AHORA = "2026-11-22T15:00:00.000Z";
const CSS = readFileSync(new URL("../src/cliente/estilos.css", import.meta.url), "utf8");
const base = { updated_at: "2026-01-01T00:00:00.000Z", deleted_at: null, rev: null };
let n = 0;
const area = (id: string, nombre: string, padre_id: string | null = null): Area => ({
  ...base, created_at: "2026-01-01T00:00:00.000Z", id, nombre, nombre_normalizado: nombre.toLowerCase(), padre_id,
});
const tj = (area_id: string, extra: Partial<Tarjeta> = {}): Tarjeta => {
  const i = ++n;
  const creada = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString();
  return {
    ...base, created_at: creada, id: `t${String(i).padStart(3, "0")}`, area_id, pregunta: `pregunta ${i}`, respuesta: `respuesta secreta ${i}`, pista: null,
    suspendida: false, importacion_id: null, ease: 2.5, intervalo: 0, reps: 0, lapses: 0, vence: HOY, contenido_updated_at: creada, repaso_updated_at: creada, ...extra,
  };
};
const rep = (k: number, extra: Partial<Tarjeta>) => Array.from({ length: k }, () => tj(extra.area_id!, extra));
const maduras = (id: string, k: number, vence: string, extra: Partial<Tarjeta> = {}) => rep(k, { area_id: id, intervalo: 10, reps: 3, vence, ...extra });

/** Datos al estilo P1: vencidas, que vencen mañana, nuevas por encima del tope, suspendidas y borradas. */
async function datos(a: Almacen) {
  await a.areas.guardarVarios([area("prog", "Programación"), area("cs50", "CS50", "prog"), area("py", "Python", "prog"), area("idi", "Idiomas")]);
  await a.tarjetas.guardarVarios([
    ...maduras("cs50", 3, "2026-11-20"), ...maduras("py", 2, HOY), ...maduras("py", 2, "2026-11-23"),
    ...rep(9, { area_id: "py" }), // nuevas: más que cualquier tope
    ...maduras("idi", 4, "2026-12-10"), ...maduras("idi", 2, "2026-11-01", { suspendida: true }),
    tj("idi", { deleted_at: "2026-11-01T00:00:00.000Z" }),
    ...rep(2, { area_id: "prog" }),
  ]);
}

describe("P20: cola del repaso libre", () => {
  it("P20: trae todas las tarjetas activas, sin tope de nuevas, sin suspendidas ni borradas, y ordenadas", async () => {
    const a = new AlmacenMemoria(); const r = new RelojSimulado(AHORA);
    await datos(a);
    const todo = await colaLibre(a);
    expect(todo).toHaveLength(3 + 2 + 2 + 9 + 4 + 2); // 22
    expect(todo.some((t) => t.suspendida || t.deleted_at !== null)).toBe(false);
    expect((await construirCola(a, r, { limiteNuevas: 5 })).length).toBeLessThan(todo.length); // la cola del día sí tiene tope
    // Vencidas primero (más atrasadas antes), después el resto por vencimiento; a igual vencimiento, created_at.
    const venc = todo.map((t) => t.vence);
    expect([...venc].sort()).toEqual(venc);
    expect(venc[0]).toBe("2026-11-20");
    expect(venc.at(-1)).toBe("2026-12-10");
    const mismoDia = todo.filter((t) => t.vence === HOY).map((t) => t.created_at);
    expect([...mismoDia].sort()).toEqual(mismoDia);
    expect(await colaLibre(a)).toEqual(todo); // estable
  });

  it("P20: el área incluye sus subáreas, la subárea solo lo suyo, y un filtro vacío da cola vacía", async () => {
    const a = new AlmacenMemoria();
    await datos(a);
    await a.areas.guardar(area("vacia", "Vacía"));
    expect(await colaLibre(a, "prog")).toHaveLength(3 + 2 + 2 + 9 + 2);
    expect(await colaLibre(a, "cs50")).toHaveLength(3);
    expect(await colaLibre(a, "py")).toHaveLength(13);
    expect(await colaLibre(a, "idi")).toHaveLength(4);
    expect(await colaLibre(a, "vacia")).toEqual([]);
  });

  it("P20: un área borrada deja fuera sus tarjetas; los contadores libres suman el total de cada área y subárea", async () => {
    const a = new AlmacenMemoria(); const r = new RelojSimulado(AHORA);
    await datos(a);
    const c = await contadoresDeRepasoLibre(a);
    expect(c.todo).toBe(22);
    const prog = c.areas.find((x) => x.nombre === "Programación")!;
    expect(prog.paraHoy).toBe(18);
    expect(prog.subareas.map((s) => [s.nombre, s.paraHoy])).toEqual([["CS50", 3], ["Python", 13]]);
    expect(c.areas.find((x) => x.nombre === "Idiomas")!.paraHoy).toBe(4);
    // Los contadores del día no cambian por existir el modo libre.
    expect((await contadoresDeRepaso(a, r, { limiteNuevas: 5 })).todo).toBe((await colaDeRepaso(a, r, { limiteNuevas: 5 })).length);
    const idi = (await a.areas.obtener("idi"))!;
    await a.areas.guardar({ ...idi, deleted_at: "2026-11-21T00:00:00.000Z" });
    expect(await colaLibre(a, "idi")).toEqual([]);
    expect((await colaLibre(a)).every((t) => t.area_id !== "idi")).toBe(true);
  });

  it("P20: “Otra vez” reencola al final y las otras tres pasan la tarjeta", async () => {
    const a = new AlmacenMemoria();
    await a.areas.guardar(area("x", "X"));
    await a.tarjetas.guardarVarios(rep(3, { area_id: "x" }));
    const cola = await colaLibre(a, "x");
    const s = new SesionLibre(a, cola);
    const [t1, t2, t3] = cola.map((t) => t.id);
    await s.calificar("otra_vez");
    expect(s.actualId).toBe(t2);
    expect(s.pendientes).toBe(3);
    await s.calificar("bien"); await s.calificar("facil");
    expect(s.actualId).toBe(t1);
    await s.calificar("dificil");
    expect(s.pendientes).toBe(0);
    expect(await s.siguiente()).toBeUndefined();
    expect(t3).toBeDefined();
  });
});

/** Todo lo observable del almacén (con papelera) y de la cola de sincronización. */
async function foto(a: Almacen, cola: ColaMemoria, r: RelojSimulado) {
  return JSON.stringify({
    tarjetas: await a.tarjetas.listar({ incluirBorrados: true }),
    areas: await a.areas.listar({ incluirBorrados: true }),
    repasos: await a.repasos.listar(),
    cola: await cola.entradas(),
    estadisticas: await calcularEstadisticas(a, r, { limiteNuevas: 5 }),
    contadores: await contadoresDeRepaso(a, r, { limiteNuevas: 5 }),
    colaDelDia: (await construirCola(a, r, { limiteNuevas: 5 })).map((t) => t.id),
  });
}

describe("P21: el repaso libre no cambia nada", () => {
  it("P21: calificar con los cuatro botones deja idéntico el almacén, la cola de sync, las estadísticas y los contadores", async () => {
    const cola = new ColaMemoria();
    const a = new AlmacenSincronizado(new AlmacenMemoria(), cola);
    const r = new RelojSimulado(AHORA);
    await datos(a);
    await cola.quitar(await cola.entradas()); // lo sembrado ya "se subió"
    const d = { almacen: a, reloj: r, persistencia: { getItem: () => null, setItem: () => undefined } as Persistencia } as never;
    const antes = await foto(a, cola, r);
    const colaNormalAntes = (await construirCola(a, r, { limiteNuevas: 5 })).map((t) => t.id);
    const p = await PantallaRepaso.iniciarLibre(d);
    expect(p.libre).toBe(true);
    for (const b of ["otra_vez", "dificil", "bien", "facil", "otra_vez", "bien"] as const) {
      await p.verRespuesta();
      const v = await p.vista();
      expect(v.botones!.map((x) => x.intervalo)).toEqual(["", "", "", ""]);
      await p.calificar(b);
    }
    expect(await foto(a, cola, r)).toBe(antes);
    expect((await cola.entradas())).toEqual([]);
    expect((await construirCola(a, r, { limiteNuevas: 5 })).map((t) => t.id)).toEqual(colaNormalAntes); // R7 intacta
    // Ctrl+Z solo en memoria.
    await p.deshacer();
    expect(await foto(a, cola, r)).toBe(antes);
    expect((await p.vista()).numero).toBe(6);
  });

  it("P21: la respuesta no está en la vista hasta “Ver respuesta” (R9) y no se califica sin verla", async () => {
    const a = new AlmacenMemoria(); const r = new RelojSimulado(AHORA);
    await datos(a);
    const d = { almacen: a, reloj: r, persistencia: { getItem: () => null, setItem: () => undefined } as Persistencia } as never;
    const p = await PantallaRepaso.iniciarLibre(d);
    const v0 = await p.vista();
    expect(JSON.stringify(v0)).not.toContain("respuesta secreta");
    expect(v0.respuestaVisible).toBe(false);
    await p.calificar("bien"); // sin ver la respuesta: no hace nada
    expect((await p.vista()).calificadas).toBe(0);
    await p.verRespuesta();
    expect((await p.vista()).respuesta).toContain("respuesta secreta");
  });
});

// ---------- P22: interfaz ----------
class Memoria implements Persistencia {
  datos = new Map<string, string>();
  getItem(k: string) { return this.datos.get(k) ?? null; }
  setItem(k: string, v: string) { this.datos.set(k, v); }
}
afterEach(() => fijarHoraCambio());

async function abrir(a: Almacen, r = new RelojSimulado(AHORA)) {
  const ventana = new Window({ url: "http://localhost/" });
  const raiz = ventana.document.createElement("div");
  ventana.document.body.append(raiz);
  const app: AppMontada = montarApp(raiz as unknown as HTMLElement, { almacen: a, reloj: r, persistencia: new Memoria() });
  await app.esperar();
  const doc = ventana.document;
  const boton = (t: string) => [...doc.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith(t));
  const clic = async (t: string) => {
    const b = boton(t);
    if (!b) throw new Error(`No hay botón "${t}" en: ${raiz.textContent}`);
    b.click(); await app.esperar();
  };
  const tecla = async (key: string, extra: Record<string, boolean> = {}) => {
    (doc as unknown as EventTarget).dispatchEvent(new ventana.KeyboardEvent("keydown", { key, bubbles: true, ...extra }) as unknown as Event);
    await app.esperar();
  };
  const chips = () => [...doc.querySelectorAll('[role="group"][aria-label="Qué repasar"] .chip')].map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim());
  const clicChip = async (inicio: string) => {
    const c = [...doc.querySelectorAll(".chip")].find((x) => (x.textContent ?? "").trim().startsWith(inicio));
    if (!c) throw new Error(`No hay chip ${inicio}`);
    (c as unknown as HTMLElement).click(); await app.esperar();
  };
  return { app, doc, raiz, boton, clic, tecla, chips, clicChip, texto: () => raiz.textContent ?? "" };
}

/** La cola del día queda vacía: todo vence en el futuro. */
async function sinPendientes(a: Almacen) {
  await a.areas.guardarVarios([area("prog", "Programación"), area("cs50", "CS50", "prog"), area("idi", "Idiomas")]);
  await a.tarjetas.guardarVarios([...maduras("cs50", 2, "2026-12-01"), ...maduras("idi", 1, "2026-12-05"), ...maduras("prog", 1, "2026-12-09")]);
}

describe("P22: Repaso libre en la interfaz", () => {
  it("P22: con la cola del día vacía, el vacío ofrece “Repasar todo” y arma la sesión sin tocar nada", async () => {
    const cola = new ColaMemoria();
    const a = new AlmacenSincronizado(new AlmacenMemoria(), cola);
    await sinPendientes(a);
    await cola.quitar(await cola.entradas());
    const antes = JSON.stringify([await a.tarjetas.listar(), await a.repasos.listar()]);
    const u = await abrir(a);
    await u.app.ir("repaso"); await u.app.esperar();
    expect(u.texto()).toContain("No hay nada para repasar hoy");
    await u.clic("Repasar todo");
    expect(u.texto()).toContain("Modo libre: no cambia tus fechas de repaso");
    expect(u.texto()).toContain("Tarjeta 1 de 4");
    const toggle = u.doc.querySelector("#r-modo-libre")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(u.chips()).toEqual(["Todo 4", "Idiomas 1", "Programación 3"]);
    // Sin intervalos; atajos Espacio y 1-4; la respuesta no está antes.
    expect(u.texto()).not.toContain("respuesta secreta");
    await u.tecla(" ");
    expect(u.texto()).toContain("respuesta secreta");
    expect(u.doc.querySelector(".intervalo")).toBeNull();
    expect(u.doc.querySelectorAll(".calificar")).toHaveLength(4);
    await u.tecla("1");
    expect(u.texto()).toContain("Tarjeta 2 de 5");
    await u.tecla(" "); await u.tecla("3");
    expect(u.texto()).toContain("Tarjeta 3 de 5");
    expect(JSON.stringify([await a.tarjetas.listar(), await a.repasos.listar()])).toBe(antes);
    expect(await cola.entradas()).toEqual([]);
  });

  it("P22: el interruptor sin filtro y con filtro, elegir un chip arranca una sesión libre nueva, salir vuelve a la cola normal", async () => {
    const a = new AlmacenMemoria();
    await datos(a);
    const u = await abrir(a);
    await u.app.ir("repaso"); await u.app.esperar();
    const toggle = () => u.doc.querySelector("#r-modo-libre")!;
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(u.texto()).not.toContain("Modo libre");
    const normales = u.chips();
    await u.clicChip("Programación");
    await u.clic("Repasar todo");
    expect(u.chips()[0]).toBe("Todo 22");
    expect(u.chips()).toContain("Programación 18");
    await u.clicChip("Programación");
    expect(u.texto()).toContain("Tarjeta 1 de 18");
    await u.clicChip("CS50");
    expect(u.texto()).toContain("Tarjeta 1 de 3");
    expect(u.doc.querySelector("#r-franja-libre")).not.toBeNull();
    await u.clic("Salir del modo libre");
    expect(u.doc.querySelector("#r-franja-libre")).toBeNull();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(u.chips()[0]).toMatch(/^Todo lo de hoy \d+$/);
    expect(normales[0]).toMatch(/^Todo lo de hoy/);
  });

  it("P22: al terminar ofrece volver al repaso del día y repasar todo de nuevo; un filtro sin tarjetas muestra el vacío", async () => {
    const a = new AlmacenMemoria();
    await a.areas.guardarVarios([area("x", "X"), area("v", "Vacía")]);
    await a.tarjetas.guardarVarios(rep(2, { area_id: "x", intervalo: 5, reps: 2, vence: "2026-12-01" }));
    const u = await abrir(a);
    await u.app.ir("repaso"); await u.app.esperar();
    await u.clic("Repasar todo");
    await u.tecla(" "); await u.tecla("1"); // la primera vuelve al final: se repasan 2 tarjetas distintas
    for (let i = 0; i < 3; i++) { await u.tecla(" "); await u.tecla("3"); }
    expect(u.texto()).toContain("Listo: repasaste 2 tarjetas en modo libre");
    expect(u.boton("Volver al repaso del día")).toBeDefined();
    await u.clic("Repasar todo de nuevo");
    expect(u.texto()).toContain("Tarjeta 1 de 2");
    await u.clicChip("Vacía");
    expect(u.texto()).toContain("No hay tarjetas para repasar acá");
    await u.clic("Volver al repaso del día");
    expect(u.doc.querySelector("#r-franja-libre")).toBeNull();
    expect(u.texto()).toContain("No hay nada para repasar en esta área");
  });

  it("P22: el detalle de área ofrece “Repasar todo el área” (modo libre)", async () => {
    const a = new AlmacenMemoria();
    await sinPendientes(a);
    const u = await abrir(a);
    await u.app.ir("areas"); await u.app.esperar();
    (u.doc.querySelector("button, a") as unknown as HTMLElement | null);
    const fila = [...u.doc.querySelectorAll("button, a")].find((e) => (e.textContent ?? "").includes("Programación")) as unknown as HTMLElement;
    fila.click(); await u.app.esperar();
    await u.clic("Repasar todo el área");
    expect(u.texto()).toContain("Modo libre");
    expect(u.texto()).toContain("Tarjeta 1 de 3");
  });

  it("P22: la franja usa el token de aviso, sin estilos en línea, y el interruptor mide 44 px o más", () => {
    expect(CSS).toMatch(/\.franja-libre\b/);
    expect(CSS).toMatch(/\.aviso\s*\{[^}]*var\(--aviso-fondo\)[^}]*var\(--aviso-texto\)/);
    expect(CSS).toMatch(/\.chip\s*\{[^}]*min-height:\s*var\(--toque\)/);
  });
});
