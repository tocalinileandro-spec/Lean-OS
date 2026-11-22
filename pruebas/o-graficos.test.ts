import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AlmacenIndexedDB } from "../src/cliente/almacen-indexeddb.ts";
import { montarApp, type AppMontada } from "../src/cliente/ui/app.ts";
import {
  graficoRepasosPorDia, graficoRetencion, graficoTareasPorSemana, graficoTarjetasPorArea,
} from "../src/cliente/ui/graficos-svg.ts";
import type { Persistencia } from "../src/cliente/ui/logica.ts";
import { AlmacenMemoria } from "../src/compartido/almacen.ts";
import { diaLogico, fijarHoraCambio } from "../src/compartido/dia.ts";
import type { Area, Calificacion, Repaso, Tarea, Tarjeta } from "../src/compartido/esquema.ts";
import { calcularEstadisticas } from "../src/compartido/estadisticas.ts";
import { crearTarjeta } from "../src/compartido/gestion.ts";
import { calcularGraficos, repasosPorDia, retencion, tareasHechasPorSemana, tarjetasPorArea } from "../src/compartido/graficos.ts";
import { calificarYGuardar, deshacerCalificacion, repasosVigentes, sumarDias } from "../src/compartido/repaso.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { crearTarea, marcarHecha } from "../src/compartido/tareas.ts";

afterEach(() => fijarHoraCambio());

const HOY = "2026-11-22"; // domingo
const base = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", deleted_at: null, rev: null };
let n = 0;
const rep = (calificacion: Calificacion, repasado_en: string, extra: Partial<Repaso> = {}): Repaso => ({
  ...base, id: `r${++n}`, tarjeta_id: "t1", calificacion, repasado_en, ease_antes: 2.5, ease_despues: 2.5, intervalo_antes: 0, intervalo_despues: 1, anula_a: null, ...extra,
});
const area = (id: string, nombre: string, padre_id: string | null = null): Area => ({ ...base, id, nombre, nombre_normalizado: nombre.toLowerCase(), padre_id });
const tarjeta = (id: string, area_id: string): Tarjeta => ({
  ...base, id, area_id, pregunta: "p", respuesta: "r", pista: null, suspendida: false, importacion_id: null,
  ease: 2.5, intervalo: 0, reps: 0, lapses: 0, vence: HOY, contenido_updated_at: base.created_at, repaso_updated_at: base.created_at,
});
const hecha = (hecha_en: string | null, extra: Partial<Tarea> = {}): Tarea => ({
  ...base, id: `x${++n}`, titulo: "t", fecha: null, meta_id: null, nota: null, estado: "hecha", hecha_en, ...extra,
});

describe("O20: repasos por día", () => {
  it("O20: 30 días simulados con un deshacer: cuentas exactas por día y ceros", async () => {
    const a = new AlmacenMemoria();
    const reloj = new RelojSimulado("2026-10-24T15:00:00.000Z");
    const t = await crearTarjeta(a, reloj, { pregunta: "p", respuesta: "r", area_texto: "Historia" });
    const esperado: number[] = [];
    for (let i = 0; i < 30; i++) {
      const cant = i % 4; // 0,1,2,3: cada cuarto día queda en cero
      esperado.push(cant);
      for (let k = 0; k < cant; k++) await calificarYGuardar(a, reloj, t.id, k % 2 ? "bien" : "dificil");
      if (i === 10) {
        // Un repaso de más y su deshacer el mismo día: ninguno de los dos cuenta.
        const r = await calificarYGuardar(a, reloj, t.id, "facil");
        await deshacerCalificacion(a, reloj, r);
      }
      if (i < 29) reloj.avanzarDias(1);
    }
    const hoy = diaLogico(reloj);
    const puntos = repasosPorDia(await a.repasos.listar(), hoy);
    expect(puntos).toHaveLength(30);
    expect(puntos.map((p) => p.total)).toEqual(esperado);
    expect(puntos[29]!.dia).toBe(hoy);
    expect(puntos[0]!.dia).toBe(sumarDias(hoy, -29));
    for (let i = 1; i < 30; i++) expect(puntos[i]!.dia > puntos[i - 1]!.dia).toBe(true);
    expect(puntos.filter((p) => p.total === 0).length).toBeGreaterThanOrEqual(7);
    expect((await a.repasos.listar()).length).toBe(esperado.reduce((s, x) => s + x, 0) + 2);
  });

  it("O20: el cambio de día a las 04:00 y los repasos fuera de la ventana", () => {
    const r = [
      rep("bien", "2026-11-22T06:59:00.000Z"), // 03:59 en Buenos Aires: sigue siendo el 21
      rep("bien", "2026-11-22T07:00:00.000Z"), // 04:00: ya es el 22
      rep("bien", "2026-10-23T15:00:00.000Z"), // fuera de los 30 días
    ];
    const p = repasosPorDia(r, HOY);
    expect(p.find((x) => x.dia === "2026-11-21")!.total).toBe(1);
    expect(p.find((x) => x.dia === HOY)!.total).toBe(1);
    expect(p.reduce((s, x) => s + x.total, 0)).toBe(2);
  });
});

describe("O21: retención", () => {
  it("O21: porcentaje exacto con Otra vez, Difícil, Bien y Fácil mezclados", () => {
    const dia = "2026-11-20T15:00:00.000Z";
    const r = [
      rep("otra_vez", dia), rep("otra_vez", dia), rep("dificil", dia),
      rep("bien", dia), rep("bien", "2026-11-01T15:00:00.000Z"), rep("bien", dia), rep("facil", dia), rep("facil", "2026-10-24T15:00:00.000Z"),
      rep("otra_vez", "2026-09-01T15:00:00.000Z"), // fuera de los 30 días: no cuenta
    ];
    expect(retencion(r, HOY)).toEqual({ porcentaje: 63, aciertos: 5, total: 8 });
    // Difícil y Otra vez cuentan en el total pero no como acierto.
    expect(retencion([rep("dificil", dia), rep("otra_vez", dia), rep("bien", dia), rep("facil", dia)], HOY).porcentaje).toBe(50);
    expect(retencion([rep("bien", dia), rep("bien", dia), rep("otra_vez", dia)], HOY).porcentaje).toBe(67);
  });

  it("O21: lo deshecho no cuenta y sin repasos da null (Sin datos), sin dividir por cero", () => {
    expect(retencion([], HOY)).toEqual({ porcentaje: null, aciertos: 0, total: 0 });
    const dia = "2026-11-20T15:00:00.000Z";
    const original = rep("bien", dia);
    const comp = rep("bien", dia, { anula_a: original.id });
    expect(retencion([original, comp], HOY).porcentaje).toBeNull();
    const doc = new Window().document as unknown as Document;
    expect(graficoRetencion(doc, retencion([], HOY)).textContent).toContain("Sin datos");
  });
});

describe("O22: tarjetas por área y tareas por semana", () => {
  it("O22: el Área suma sus subáreas igual que las estadísticas mínimas", async () => {
    const a = new AlmacenMemoria();
    const reloj = new RelojSimulado("2026-11-22T15:00:00.000Z");
    for (const [txt, cant] of [["Historia", 2], ["Historia > Roma", 3], ["Historia > Grecia", 1], ["Física", 4], ["Química > Orgánica", 2]] as const) {
      for (let i = 0; i < cant; i++) await crearTarjeta(a, reloj, { pregunta: `p${i}`, respuesta: "r", area_texto: txt });
    }
    const areas = await a.areas.listar();
    const g = tarjetasPorArea(areas, await a.tarjetas.listar());
    const minimas = (await calcularEstadisticas(a, reloj)).porArea;
    expect(g).toEqual(minimas);
    const por = Object.fromEntries(g.map((x) => [x.nombre, x.total]));
    expect(por).toMatchObject({ Historia: 6, Roma: 3, Grecia: 1, "Física": 4, "Química": 2, "Orgánica": 2 });
  });

  it("O22: tareas hechas por semana (lunes a domingo, día lógico) en los bordes", () => {
    const t = [
      hecha("2026-11-16T07:00:00.000Z"),  // lunes 04:00 BA: semana del 16
      hecha("2026-11-16T06:59:00.000Z"),  // lunes 03:59 BA: todavía domingo 15, semana del 09
      hecha("2026-11-23T06:59:00.000Z"),  // lunes 03:59 BA: domingo 22 lógico, semana del 16
      hecha("2026-11-23T07:00:00.000Z"),  // semana que viene: no entra
      hecha("2026-09-21T15:00:00.000Z"),  // lunes de hace 8 semanas: fuera
      hecha("2026-09-28T15:00:00.000Z"),  // lunes de hace 7 semanas: primera barra
      hecha("2026-10-05T15:00:00.000Z"),  // segunda barra
      hecha("2026-11-18T15:00:00.000Z", { deleted_at: "2026-11-19T00:00:00.000Z" }), // borrada
      hecha(null),                          // sin fecha de hecha
      hecha("2026-11-18T15:00:00.000Z", { estado: "pendiente" }),
    ];
    const s = tareasHechasPorSemana(t, HOY);
    expect(s).toHaveLength(8);
    expect(s[0]).toEqual({ inicio: "2026-09-28", fin: "2026-10-04", total: 1 });
    expect(s[1]).toEqual({ inicio: "2026-10-05", fin: "2026-10-11", total: 1 });
    expect(s[7]).toEqual({ inicio: "2026-11-16", fin: "2026-11-22", total: 2 });
    expect(s[6]!.total).toBe(1);
    expect(s.reduce((x, p) => x + p.total, 0)).toBe(5);
    for (const p of s) expect(new Date(`${p.inicio}T00:00:00Z`).getUTCDay()).toBe(1);
    // Un lunes como "hoy": su semana es la última.
    expect(tareasHechasPorSemana([hecha("2026-11-16T15:00:00.000Z")], "2026-11-16")[7]!.total).toBe(1);
  });
});

describe("O23: dibujo con SVG propio", () => {
  const docNuevo = () => new Window({ url: "http://localhost/" }).document as unknown as Document;
  const datos = () => {
    const r = [rep("bien", "2026-11-20T15:00:00.000Z"), rep("otra_vez", "2026-11-22T15:00:00.000Z")];
    const areas = [area("a1", "Historia"), area("a2", "Roma", "a1")];
    return calcularGraficos(r, areas, [tarjeta("c1", "a1"), tarjeta("c2", "a2")], [hecha("2026-11-18T15:00:00.000Z")], HOY);
  };

  it("O23: cada gráfico es un SVG con role img, title, desc y los valores como texto", () => {
    const doc = docNuevo();
    const g = datos();
    const figuras = [
      graficoRepasosPorDia(doc, g.repasosPorDia), graficoRetencion(doc, g.retencion),
      graficoTarjetasPorArea(doc, g.porArea), graficoTareasPorSemana(doc, g.tareasPorSemana),
    ];
    for (const f of figuras) {
      const svg = f.querySelector("svg")!;
      expect(svg.getAttribute("role")).toBe("img");
      expect(svg.getAttribute("viewBox")).toMatch(/^0 0 \d+ \d+$/);
      expect(svg.querySelector("title")!.textContent!.length).toBeGreaterThan(3);
      expect(svg.querySelector("desc")!.textContent!.length).toBeGreaterThan(10);
      expect(f.querySelectorAll("ul.solo-lectores li").length).toBeGreaterThan(0);
      const html = f.outerHTML.replace(/xmlns="[^"]*"/g, "");
      expect(html).not.toMatch(/http|<script|<link|<image|<use|href|<foreignObject/i);
    }
    expect(figuras[0]!.textContent).toContain("22/11: 1 repaso");
    expect(figuras[0]!.textContent).toContain("20/11: 1 repaso");
    expect(figuras[1]!.textContent).toContain("50 %");
    expect(figuras[2]!.textContent).toContain("Historia: 2 tarjetas");
    expect(figuras[3]!.textContent).toContain("Semana del 16/11 al 22/11: 1 tarea hecha");
  });

  it("O23: estados vacíos en castellano", () => {
    const doc = docNuevo();
    const g = calcularGraficos([], [], [], [], HOY);
    expect(graficoRepasosPorDia(doc, g.repasosPorDia).textContent).toContain("Todavía no hay repasos para mostrar");
    expect(graficoRetencion(doc, g.retencion).textContent).toContain("Sin datos");
    expect(graficoTarjetasPorArea(doc, g.porArea).textContent).toContain("Todavía no hay tarjetas para mostrar");
    expect(graficoTareasPorSemana(doc, g.tareasPorSemana).textContent).toContain("Todavía no hay tareas hechas para mostrar");
    expect(graficoRepasosPorDia(doc, g.repasosPorDia).querySelector("svg")).toBeNull();
  });

  it("O23: un nombre de área con <script> queda como texto", () => {
    const doc = docNuevo();
    const malo = "<script>alert(1)</script><img src=x onerror=alert(2)>";
    const f = graficoTarjetasPorArea(doc, [{ area_id: "a", nombre: malo, total: 3 }]);
    expect(f.querySelector("script")).toBeNull();
    expect(f.querySelector("img")).toBeNull();
    expect(f.querySelector("ul.solo-lectores li")!.textContent).toBe(`${malo}: 3 tarjetas`);
    expect(f.querySelector("desc")!.textContent).toContain(malo);
  });

  it("O23: colores del tema por clases y variables CSS; sin colores fijos ni recursos externos; la CSP no cambia", () => {
    const css = readFileSync(new URL("../src/cliente/estilos.css", import.meta.url), "utf8");
    for (const clase of ["g-barra", "g-pista", "g-eje", "g-texto", "g-grande"]) expect(css).toMatch(new RegExp(`\\.${clase}\\s*\\{[^}]*var\\(--`));
    const tema = css.slice(css.indexOf("/* Gráficos"));
    expect(tema).not.toMatch(/#[0-9a-f]{3,8}\b|url\(|@import/i);
    const fuente = readFileSync(new URL("../src/cliente/ui/graficos-svg.ts", import.meta.url), "utf8");
    expect(fuente).not.toMatch(/innerHTML|#[0-9a-fA-F]{6}\b|fetch\(|XMLHttpRequest/);
    const html = readFileSync(new URL("../src/cliente/index.html", import.meta.url), "utf8");
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'">`);
  });

  class Memoria implements Persistencia {
    datos = new Map<string, string>();
    getItem(k: string) { return this.datos.get(k) ?? null; }
    setItem(k: string, v: string) { this.datos.set(k, v); }
  }

  async function abrir(conDatos: boolean) {
    const ventana = new Window({ url: "http://localhost/" });
    const raiz = ventana.document.createElement("div");
    ventana.document.body.append(raiz);
    const almacen = await AlmacenIndexedDB.abrir(`lean-os-ui-graf-${++n}`, new IDBFactory());
    const reloj = new RelojSimulado("2026-11-22T15:00:00.000Z");
    if (conDatos) {
      const t = await crearTarjeta(almacen, reloj, { pregunta: "p", respuesta: "r", area_texto: "<script x=1 / Sub" });
      await calificarYGuardar(almacen, reloj, t.id, "bien");
      await marcarHecha(almacen, reloj, (await crearTarea(almacen, reloj, { titulo: "Hecha" })).id);
    }
    const app: AppMontada = montarApp(raiz as unknown as HTMLElement, { almacen, reloj, persistencia: new Memoria() });
    await app.esperar();
    const doc = ventana.document;
    const boton = () => doc.querySelector("#ver-estadisticas") as unknown as HTMLButtonElement;
    const antes = async () => { const c = (await almacen.repasos.listar()).length + (await almacen.tarjetas.listar()).length + (await almacen.tareas.listar()).length; return c; };
    return { ventana, doc, app, raiz, boton, antes };
  }

  it("O23: el panel de Hoy se abre y cierra con el botón o Escape, y solo lee", async () => {
    const { ventana, doc, app, boton, antes } = await abrir(true);
    expect(doc.querySelector("#panel-estadisticas")).toBeNull();
    expect(boton().getAttribute("aria-expanded")).toBe("false");
    const cuenta = await antes();
    boton().click();
    await app.esperar();
    const panel = doc.querySelector("#panel-estadisticas")!;
    expect(panel).not.toBeNull();
    expect(boton().getAttribute("aria-expanded")).toBe("true");
    expect(panel.querySelectorAll("svg[role='img']").length).toBe(4);
    expect(panel.textContent).toContain("Pendientes hoy");
    expect(panel.querySelector("script")).toBeNull();
    expect(panel.textContent).toContain("<script x=1 /");
    boton().click();
    await app.esperar();
    expect(doc.querySelector("#panel-estadisticas")).toBeNull();
    boton().click();
    await app.esperar();
    expect(doc.querySelector("#panel-estadisticas")).not.toBeNull();
    doc.dispatchEvent(new ventana.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as never);
    await app.esperar();
    expect(doc.querySelector("#panel-estadisticas")).toBeNull();
    expect(await antes()).toBe(cuenta);
    // La navegación no ganó pantallas.
    expect([...doc.querySelectorAll(".nav-item")].map((b) => b.textContent)).toEqual(["Hoy", "Repaso", "Tareas", "Apuntes", "Tarjetas", "Ajustes"]);
  });

  it("O23: el panel sin datos muestra estados vacíos", async () => {
    const { doc, app, boton } = await abrir(false);
    boton().click();
    await app.esperar();
    const panel = doc.querySelector("#panel-estadisticas")!;
    expect(panel.textContent).toContain("Todavía no hay repasos para mostrar");
    expect(panel.textContent).toContain("Sin datos");
    expect(panel.querySelectorAll("svg").length).toBe(0);
  });
});

describe("O24: rendimiento y estadísticas mínimas intactas", () => {
  it("O24: 20.000 repasos y 5.000 tarjetas: cálculo < 500 ms y estadísticas mínimas iguales a las de antes", async () => {
    const areas: Area[] = [];
    for (let i = 0; i < 40; i++) areas.push(area(`A${i}`, `Área ${i}`, i % 5 === 0 || i < 5 ? null : `A${i % 5}`));
    const tarjetas: Tarjeta[] = [];
    for (let i = 0; i < 5000; i++) tarjetas.push(tarjeta(`T${i}`, `A${i % 40}`));
    const califs: Calificacion[] = ["otra_vez", "dificil", "bien", "facil"];
    const repasos: Repaso[] = [];
    for (let i = 0; i < 20_000; i++) {
      const ms = Date.UTC(2026, 9, 24, 8) + (i % 30) * 86_400_000 + (i % 600) * 60_000;
      repasos.push(rep(califs[i % 4]!, new Date(ms).toISOString(), { tarjeta_id: `T${i % 5000}` }));
    }
    for (let i = 0; i < 300; i++) repasos.push(rep("bien", repasos[i]!.repasado_en, { anula_a: repasos[i]!.id, tarjeta_id: repasos[i]!.tarjeta_id }));
    const tareas = Array.from({ length: 600 }, (_, i) => hecha(new Date(Date.UTC(2026, 9, 1) + i * 3_600_000 * 24).toISOString()));

    const t0 = performance.now();
    const g = calcularGraficos(repasos, areas, tarjetas, tareas, HOY);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(500);
    expect(g.repasosPorDia.reduce((s, p) => s + p.total, 0)).toBe(19_700);
    expect(g.retencion.total).toBe(19_700);
    expect(g.retencion.porcentaje).toBe(50);

    // Estadísticas mínimas: mismo resultado que la cuenta de referencia (la implementación anterior, escrita aparte).
    const a = new AlmacenMemoria();
    for (const x of areas) await a.areas.guardar(x);
    await a.guardarLote({ tarjetas });
    for (const r of repasos) await a.repasos.agregar(r);
    const reloj = new RelojSimulado("2026-11-22T15:00:00.000Z");
    const est = await calcularEstadisticas(a, reloj);
    const directas = new Map<string, number>();
    for (const t of tarjetas) directas.set(t.area_id, (directas.get(t.area_id) ?? 0) + 1);
    const referencia = areas.map((x) => ({
      area_id: x.id, nombre: x.nombre,
      total: (directas.get(x.id) ?? 0) + areas.filter((h) => h.padre_id === x.id).reduce((s, h) => s + (directas.get(h.id) ?? 0), 0),
    }));
    expect(est.porArea).toEqual(referencia);
    expect(est.porArea).toEqual(g.porArea);
    const vig = repasosVigentes(repasos);
    const dia = (iso: string) => diaLogico({ ahora: () => new Date(iso) });
    expect(est.repasadasHoy).toBe(vig.filter((r) => dia(r.repasado_en) === HOY).length);
    const dias = new Set(vig.map((r) => dia(r.repasado_en)));
    let racha = 0;
    for (let d = dias.has(HOY) ? HOY : sumarDias(HOY, -1); dias.has(d); d = sumarDias(d, -1)) racha++;
    expect(est.racha).toBe(racha);
    expect(est.pendientesHoy).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
