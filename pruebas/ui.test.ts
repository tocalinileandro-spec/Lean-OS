import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AlmacenIndexedDB } from "../src/cliente/almacen-indexeddb.ts";
import { montarApp, type AppMontada } from "../src/cliente/ui/app.ts";
import { cargarAjustes, formatearFecha, type Persistencia } from "../src/cliente/ui/logica.ts";
import { fijarHoraCambio } from "../src/compartido/dia.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";

const BLOQUE = JSON.stringify({
  tipo: "aprendizaje", fecha: "2026-11-22", area: "Programación > CS50", tema: "Funciones", resumen: "Resumen de ejemplo.",
  preguntas: [
    { p: "¿Qué hace return?", r: "Devuelve un valor y termina la función.", pista: "Pensá en el código que sigue." },
    { p: "P2", r: "R2" },
  ],
});

class MemoriaPersistente implements Persistencia {
  datos = new Map<string, string>();
  getItem(k: string) { return this.datos.get(k) ?? null; }
  setItem(k: string, v: string) { this.datos.set(k, v); }
}

afterEach(() => fijarHoraCambio());

async function abrir(fabrica: IDBFactory, persistencia: Persistencia, reloj: RelojSimulado) {
  const ventana = new Window({ url: "http://localhost/" });
  const raiz = ventana.document.createElement("div");
  ventana.document.body.append(raiz);
  const almacen = await AlmacenIndexedDB.abrir("lean-os-ui", fabrica);
  const app: AppMontada = montarApp(raiz as unknown as HTMLElement, { almacen, reloj, persistencia });
  await app.esperar();
  const doc = ventana.document;
  const botonPorTexto = (t: string) => [...doc.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(t));
  const clic = async (t: string) => {
    const b = botonPorTexto(t);
    if (!b) throw new Error(`No hay botón "${t}" en: ${raiz.textContent}`);
    b.click();
    await app.esperar();
  };
  const tecla = async (key: string, extra: Record<string, boolean> = {}) => {
    doc.dispatchEvent(new ventana.KeyboardEvent("keydown", { key, bubbles: true, ...extra }));
    await app.esperar();
  };
  const escribir = async (selector: string, valor: string) => {
    const el = doc.querySelector(selector) as unknown as HTMLInputElement;
    el.value = valor;
    el.dispatchEvent(new ventana.Event("input", { bubbles: true }) as unknown as Event);
    await app.esperar();
  };
  return { app, almacen, raiz, doc, clic, tecla, escribir, botonPorTexto, cerrar: () => ventana.close() };
}

async function conTarjetas() {
  const fabrica = new IDBFactory();
  const persistencia = new MemoriaPersistente();
  const reloj = new RelojSimulado("2026-11-22T15:00:00.000Z");
  const ui = await abrir(fabrica, persistencia, reloj);
  ui.app.ir("tarjetas");
  await ui.app.esperar();
  await ui.clic("Importar");
  await ui.escribir("#caja-importar", BLOQUE);
  await ui.clic("Confirmar importación");
  return { fabrica, persistencia, reloj, ui };
}

describe("interfaz web", () => {
  it("R9: la respuesta no está en el DOM hasta tocar 'Ver respuesta', y sí después", async () => {
    const { ui } = await conTarjetas();
    ui.app.ir("repaso");
    await ui.app.esperar();
    const respuesta = "Devuelve un valor y termina la función.";
    const pista = "Pensá en el código que sigue.";
    expect(ui.raiz.textContent).toContain("¿Qué hace return?");
    expect(ui.raiz.textContent).not.toContain(respuesta);
    expect(ui.raiz.innerHTML).not.toContain(respuesta);
    expect(ui.raiz.innerHTML).not.toContain(pista);
    expect(ui.botonPorTexto("Bien")).toBeUndefined();

    await ui.clic("Ver respuesta");
    expect(ui.raiz.textContent).toContain(respuesta);
    // Los cuatro botones muestran el próximo intervalo de cada uno.
    const botones = [...ui.doc.querySelectorAll(".calificar")].map((b) => b.textContent);
    expect(botones).toEqual(["Otra vez" + "Hoy" + "1", "Difícil" + "1 día" + "2", "Bien" + "1 día" + "3", "Fácil" + "4 días" + "4"]);
  });

  it("R9: la pista tampoco está hasta pedirla, y Espacio muestra la respuesta", async () => {
    const { ui } = await conTarjetas();
    ui.app.ir("repaso");
    await ui.app.esperar();
    await ui.clic("Ver pista");
    expect(ui.raiz.textContent).toContain("Pensá en el código que sigue.");
    expect(ui.raiz.textContent).not.toContain("termina la función");
    await ui.tecla(" ");
    expect(ui.raiz.textContent).toContain("termina la función");
  });

  it("recorrido de punta a punta: importar, repasar (teclado y Ctrl+Z) y estado persistido tras recargar", async () => {
    const { fabrica, persistencia, reloj, ui } = await conTarjetas();
    expect(ui.raiz.textContent).toContain("Creadas: 2");
    // Informe de duplicadas al reimportar
    await ui.escribir("#caja-importar", BLOQUE);
    await ui.clic("Confirmar importación");
    expect(ui.raiz.textContent).toContain("Creadas: 0 · Duplicadas omitidas: 2");

    ui.app.ir("hoy");
    await ui.app.esperar();
    expect(ui.raiz.textContent).toContain("Repasar 2 tarjetas");
    expect(ui.raiz.textContent).toContain("22/11/2026");
    await ui.clic("Repasar 2 tarjetas");

    await ui.tecla(" ");
    await ui.tecla("3"); // Bien
    expect(ui.raiz.textContent).toContain("quedan 1");
    await ui.tecla("z", { ctrlKey: true }); // deshace
    expect(ui.raiz.textContent).toContain("quedan 2");
    await ui.tecla(" ");
    await ui.tecla("3");
    await ui.tecla(" ");
    await ui.tecla("4"); // Fácil
    expect(ui.raiz.textContent).toContain("Listo: repasaste 2 tarjetas.");
    const antes = (await ui.almacen.tarjetas.listar()).map((t) => ({ p: t.pregunta, i: t.intervalo, v: t.vence, r: t.reps }));
    expect(antes).toEqual([{ p: "¿Qué hace return?", i: 1, v: "2026-11-23", r: 1 }, { p: "P2", i: 4, v: "2026-11-26", r: 1 }]);
    ui.almacen.cerrar();
    ui.cerrar();

    // "Recargar": mismo IDBFactory, ventana y almacén nuevos.
    const ui2 = await abrir(fabrica, persistencia, reloj);
    const despues = (await ui2.almacen.tarjetas.listar()).map((t) => ({ p: t.pregunta, i: t.intervalo, v: t.vence, r: t.reps }));
    expect(despues).toEqual(antes);
    expect(ui2.raiz.textContent).toContain("No tenés tarjetas pendientes");
    expect(ui2.raiz.textContent).toContain("Repasadas hoy");
  });

  it("importar con error deja el texto en la caja; ajustes se guardan al instante y se aplican", async () => {
    const fabrica = new IDBFactory();
    const persistencia = new MemoriaPersistente();
    const reloj = new RelojSimulado("2026-11-22T15:00:00.000Z");
    const ui = await abrir(fabrica, persistencia, reloj);
    ui.app.ir("tarjetas");
    await ui.app.esperar();
    await ui.clic("Importar");
    const cortado = BLOQUE.slice(0, 40);
    await ui.escribir("#caja-importar", cortado);
    await ui.clic("Confirmar importación");
    expect((ui.doc.querySelector("#caja-importar") as unknown as HTMLTextAreaElement).value).toBe(cortado);
    expect(ui.raiz.textContent).toContain("Creadas: 0");
    expect(ui.raiz.querySelector(".errores")).not.toBeNull();

    ui.app.ir("ajustes");
    await ui.app.esperar();
    const nuevas = ui.doc.querySelector("#ajuste-nuevas") as unknown as HTMLInputElement;
    nuevas.value = "5";
    nuevas.dispatchEvent(new (ui.doc.defaultView!.Event)("change") as unknown as Event);
    await ui.app.esperar();
    expect(cargarAjustes(persistencia)).toEqual({ nuevasPorDia: 5, horaCambio: "04:00" });
    const otra = ui.doc.querySelector("#ajuste-nuevas") as unknown as HTMLInputElement;
    otra.value = ""; // un campo numérico con texto inválido queda vacío
    otra.dispatchEvent(new (ui.doc.defaultView!.Event)("change") as unknown as Event);
    await ui.app.esperar();
    expect(ui.raiz.textContent).toContain("número entero");
    expect(cargarAjustes(persistencia).nuevasPorDia).toBe(5);
  });

  it("gestión desde la lista: suspender, borrar a papelera y restaurar", async () => {
    const { ui } = await conTarjetas();
    await ui.escribir("#busqueda", "return");
    expect(ui.raiz.textContent).toContain("¿Qué hace return?");
    expect(ui.raiz.textContent).not.toContain("P2");
    await ui.clic("Suspender");
    expect(ui.raiz.textContent).toContain("(suspendida)");
    await ui.clic("Borrar");
    expect(ui.raiz.textContent).toContain("papelera");
    await ui.clic("Ver papelera (1)");
    await ui.clic("Restaurar");
    expect(ui.raiz.textContent).toContain("Tarjeta restaurada.");
  });

  it("formatearFecha usa dd/mm/aaaa", () => {
    expect(formatearFecha("2026-11-22")).toBe("22/11/2026");
  });
});
