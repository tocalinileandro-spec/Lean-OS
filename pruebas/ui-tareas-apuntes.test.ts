/** Recorridos de punta a punta de las pantallas de tareas, metas, apuntes y papelera (happy-dom, reloj simulado). */
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AlmacenIndexedDB } from "../src/cliente/almacen-indexeddb.ts";
import { montarApp, type AppMontada } from "../src/cliente/ui/app.ts";
import type { Persistencia } from "../src/cliente/ui/logica.ts";
import { renderizarMarkdown } from "../src/cliente/ui/markdown.ts";
import { fijarHoraCambio } from "../src/compartido/dia.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { crearTarea } from "../src/compartido/tareas.ts";

class Memoria implements Persistencia {
  datos = new Map<string, string>();
  getItem(k: string) { return this.datos.get(k) ?? null; }
  setItem(k: string, v: string) { this.datos.set(k, v); }
}

afterEach(() => fijarHoraCambio());

async function abrir(fabrica: IDBFactory, reloj: RelojSimulado) {
  const ventana = new Window({ url: "http://localhost/" });
  const raiz = ventana.document.createElement("div");
  ventana.document.body.append(raiz);
  const almacen = await AlmacenIndexedDB.abrir("lean-os-ui-ta", fabrica);
  const app: AppMontada = montarApp(raiz as unknown as HTMLElement, { almacen, reloj, persistencia: new Memoria() });
  await app.esperar();
  const doc = ventana.document;
  const q = <T extends Element>(sel: string) => doc.querySelector(sel) as unknown as T;
  const clic = async (texto: string) => {
    const b = [...doc.querySelectorAll("button")].find((x) => x.textContent?.trim().startsWith(texto));
    if (!b) throw new Error(`No hay botón "${texto}" en: ${raiz.textContent}`);
    b.click();
    await app.esperar();
  };
  const evento = (nombre: string) => new ventana.Event(nombre, { bubbles: true }) as unknown as Event;
  const escribir = async (sel: string, valor: string, tipo = "input") => {
    const el = q<HTMLInputElement>(sel);
    if (!el) throw new Error(`No hay ${sel} en: ${raiz.textContent}`);
    el.value = valor;
    el.dispatchEvent(evento(tipo));
    await app.esperar();
  };
  const teclaEn = async (el: Element | null, key: string, extra: Record<string, boolean> = {}) => {
    ((el ?? doc) as unknown as EventTarget).dispatchEvent(new ventana.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }) as unknown as Event);
    await app.esperar();
  };
  const ir = async (p: Parameters<AppMontada["ir"]>[0]) => { app.ir(p); await app.esperar(); };
  return { app, almacen, raiz, doc, q, clic, escribir, teclaEn, ir, evento, cerrar: () => ventana.close() };
}

const nuevo = async () => {
  const fabrica = new IDBFactory();
  const reloj = new RelojSimulado("2026-11-22T15:00:00.000Z");
  return { fabrica, reloj, ui: await abrir(fabrica, reloj) };
};

describe("interfaz de tareas, metas y apuntes", () => {
  it("tarea rápida con Enter aparece en Hoy con fecha de hoy y se puede tildar y destildar", async () => {
    const { ui } = await nuevo();
    await ui.teclaEn(ui.q("#tarea-rapida"), "Enter"); // vacío: no hace nada
    expect(await ui.almacen.tareas.listar()).toHaveLength(0);
    await ui.escribir("#tarea-rapida", "Comprar yerba");
    await ui.teclaEn(ui.q("#tarea-rapida"), "Enter");
    expect(ui.raiz.textContent).toContain("Comprar yerba");
    expect((await ui.almacen.tareas.listar())[0]!.fecha).toBe("2026-11-22");
    expect(ui.q<HTMLInputElement>("#tarea-rapida").value).toBe("");

    ui.q<HTMLElement>('input[type="checkbox"]').click();
    await ui.app.esperar();
    expect((await ui.almacen.tareas.listar())[0]!.estado).toBe("hecha");
    expect(ui.raiz.textContent).toContain("Comprar yerba"); // sigue en Hoy, hecha
    expect(ui.q<HTMLInputElement>('input[type="checkbox"]').hasAttribute("checked")).toBe(true);
    ui.q<HTMLElement>('input[type="checkbox"]').click();
    await ui.app.esperar();
    expect((await ui.almacen.tareas.listar())[0]!.estado).toBe("pendiente");
  });

  it("Hoy destaca las atrasadas arriba y muestra el acceso 'Repasar N tarjetas'", async () => {
    const { ui, reloj } = await nuevo();
    await crearTarea(ui.almacen, reloj, { titulo: "Pagar la luz", fecha: "2026-11-20" });
    await crearTarea(ui.almacen, reloj, { titulo: "Llamar al médico", fecha: "2026-11-22" });
    await ui.ir("hoy");
    const atrasadas = ui.q<HTMLElement>(".atrasadas");
    expect(atrasadas.textContent).toContain("Pagar la luz");
    expect(atrasadas.textContent).toContain("20/11/2026");
    expect(atrasadas.textContent).not.toContain("Llamar al médico");
    expect(ui.raiz.textContent).toContain("Llamar al médico");
    expect(ui.raiz.innerHTML.indexOf("Pagar la luz")).toBeLessThan(ui.raiz.innerHTML.indexOf("Llamar al médico"));

    await ui.ir("tarjetas");
    await ui.clic("Importar");
    await ui.escribir("#caja-importar", JSON.stringify({ tipo: "aprendizaje", fecha: "2026-11-22", area: "Mate", tema: "T", preguntas: [{ p: "a", r: "b" }, { p: "c", r: "d" }] }));
    await ui.clic("Confirmar importación");
    await ui.ir("hoy");
    expect(ui.raiz.textContent).toContain("Repasar 2 tarjetas");
  });

  it("Tareas: crear con fecha y meta, editar, bandeja, borrar; metas con progreso, estado y borrado que desvincula", async () => {
    const { ui } = await nuevo();
    await ui.ir("tareas");
    // Metas
    await ui.clic("Nueva meta anual");
    await ui.escribir("#meta-titulo", "Terminar CS50");
    await ui.clic("Guardar meta");
    await ui.clic("Nueva meta trimestral");
    await ui.escribir("#meta-titulo", "Semanas 1 a 4");
    await ui.escribir("#meta-padre", (await ui.almacen.metas.listar())[0]!.id, "change");
    await ui.clic("Guardar meta");
    const metas = await ui.almacen.metas.listar();
    expect(metas.map((m) => [m.tipo, m.anio, m.titulo])).toEqual([["anual", 2026, "Terminar CS50"], ["trimestral", 2026, "Semanas 1 a 4"]]);
    expect(metas[1]!.trimestre).toBe(4);

    // Tarea a la bandeja (sin fecha) y otra con fecha y meta
    await ui.clic("Nueva tarea");
    await ui.escribir("#tarea-titulo", "Ver la clase 0");
    await ui.clic("Guardar tarea");
    expect(ui.raiz.textContent).toContain("Bandeja");
    expect(ui.raiz.textContent).toContain("Ver la clase 0");
    expect((await ui.almacen.tareas.listar())[0]!.fecha).toBeNull();

    await ui.clic("Nueva tarea");
    await ui.escribir("#tarea-titulo", "Pset 1");
    await ui.escribir("#tarea-fecha", "2026-12-01");
    await ui.escribir("#tarea-meta", metas[1]!.id, "change");
    await ui.escribir("#tarea-nota", "Entregar antes del lunes");
    await ui.clic("Guardar tarea");
    const pset = (await ui.almacen.tareas.listar()).find((t) => t.titulo === "Pset 1")!;
    expect(pset).toMatchObject({ fecha: "2026-12-01", meta_id: metas[1]!.id, nota: "Entregar antes del lunes" });
    expect(ui.raiz.textContent).toContain("01/12/2026");

    // Editar el título
    const editar = [...ui.doc.querySelectorAll("button")].filter((b) => b.textContent === "Editar").at(-1)!;
    editar.click();
    await ui.app.esperar();
    await ui.escribir("#tarea-titulo", "Pset 1 (final)");
    await ui.clic("Guardar tarea");
    expect(ui.raiz.textContent).toContain("Pset 1 (final)");

    // Progreso: tildar la tarea vinculada llega a 100 % en ambas metas (informativo)
    ui.q<HTMLElement>('input[aria-label^="Marcar como hecha: Pset"]').click();
    await ui.app.esperar();
    expect(ui.raiz.textContent?.match(/100 %/g)).toHaveLength(2);

    // Estado de la meta
    const estado = ui.q<HTMLSelectElement>(".estado-meta");
    await ui.escribir(".estado-meta", "lograda", "change");
    expect(estado.value).toBeDefined();
    expect((await ui.almacen.metas.listar()).find((m) => m.id === metas[0]!.id)!.estado).toBe("lograda");

    // Borrar la meta trimestral: la tarea sigue, sin meta
    const borrarMeta = [...ui.doc.querySelectorAll("button")].filter((b) => b.textContent === "Borrar meta")[1]!;
    borrarMeta.click();
    await ui.app.esperar();
    const despues = (await ui.almacen.tareas.listar()).find((t) => t.titulo === "Pset 1 (final)")!;
    expect(despues.meta_id).toBeNull();
    expect(ui.raiz.textContent).toContain("Pset 1 (final)");

    // Borrar una tarea
    const borrar = [...ui.doc.querySelectorAll("button")].find((b) => b.textContent === "Borrar")!;
    borrar.click();
    await ui.app.esperar();
    expect(ui.raiz.textContent).toContain("papelera");
    expect((await ui.almacen.tareas.listar())).toHaveLength(1);
  });

  it("captura rápida de apunte: tecla n, texto, Ctrl+Enter; título de 60 caracteres y sin errores técnicos", async () => {
    const { ui } = await nuevo();
    await ui.teclaEn(null, "n");
    expect(ui.q("#captura-texto")).not.toBeNull();
    // Guardar vacío: mensaje en castellano, la caja queda
    await ui.clic("Guardar apunte");
    expect(ui.raiz.textContent).toContain("no puede estar vacío");
    expect(ui.raiz.textContent).not.toMatch(/Error|undefined|\[object/);
    const largo = "Una idea larga ".repeat(8);
    await ui.escribir("#captura-texto", largo);
    await ui.teclaEn(ui.q("#captura-texto"), "Enter", { ctrlKey: true });
    const [a] = await ui.almacen.apuntes.listar();
    expect(a).toMatchObject({ titulo: null, texto: largo, tipo: "apunte" });
    expect(ui.raiz.textContent).toContain("Apunte guardado.");
    expect(ui.raiz.textContent).toContain(largo.trim().slice(0, 60));
    // El título mostrado (tituloApunte) son los primeros 60 caracteres.
    expect(ui.q<HTMLElement>("li.apunte strong").textContent).toBe(largo.trim().slice(0, 60));
    // "n" dentro de un campo de texto no abre nada
    await ui.teclaEn(ui.q("#busqueda-apuntes"), "n");
    expect(ui.q("#captura-texto")).toBeNull();
  });

  it("buscar con filtros, editar, convertir a tarea y a tarjeta", async () => {
    const { ui } = await nuevo();
    await ui.ir("apuntes");
    const capturar = async (texto: string) => {
      await ui.clic("Nuevo apunte");
      await ui.escribir("#captura-texto", texto);
      await ui.clic("Guardar apunte");
    };
    await capturar("Recursión: una función que se llama a sí misma");
    await capturar("Comprar café para la oficina");
    // Etiquetar y tipar el primero desde la edición
    await ui.escribir("#busqueda-apuntes", "recursion"); // sin tildes
    expect(ui.raiz.textContent).toContain("Recursión");
    expect(ui.raiz.textContent).not.toContain("café");
    await ui.clic("Editar");
    await ui.escribir("#apunte-etiquetas", "cs50, funciones");
    await ui.escribir("#apunte-tipo", "aprendizaje", "change");
    await ui.clic("Guardar apunte");
    expect(ui.raiz.textContent).toContain("#cs50");
    expect(ui.raiz.textContent).toContain("Aprendizaje");

    await ui.escribir("#busqueda-apuntes", "");
    expect(ui.raiz.textContent).toContain("café");
    await ui.escribir("#filtro-tipo", "aprendizaje", "change");
    expect(ui.raiz.textContent).toContain("Recursión");
    expect(ui.raiz.textContent).not.toContain("café");
    await ui.escribir("#filtro-tipo", "", "change");
    await ui.escribir("#filtro-etiqueta", "funciones", "change");
    expect(ui.raiz.textContent).toContain("Recursión");
    expect(ui.raiz.textContent).not.toContain("café");
    await ui.escribir("#filtro-etiqueta", "", "change");
    await ui.escribir("#busqueda-apuntes", "zzz");
    expect(ui.raiz.textContent).toContain("No hay apuntes que coincidan");
    await ui.escribir("#busqueda-apuntes", "");

    // A tarea
    await ui.escribir("#busqueda-apuntes", "café");
    await ui.clic("Pasar a tarea");
    expect(ui.raiz.textContent).toContain("Tarea creada");
    const tareas = await ui.almacen.tareas.listar();
    expect(tareas).toHaveLength(1);
    expect(tareas[0]!.titulo).toBe("Comprar café para la oficina");
    expect(await ui.almacen.apuntes.listar()).toHaveLength(2); // el apunte no se toca

    // A tarjeta: formulario con texto precargado; guardar crea la tarjeta
    await ui.escribir("#busqueda-apuntes", "recursion");
    await ui.clic("Pasar a tarjeta");
    expect(ui.q<HTMLTextAreaElement>("#tarjeta-pregunta").value).toBe("Recursión: una función que se llama a sí misma");
    expect(ui.q<HTMLTextAreaElement>("#tarjeta-respuesta").value).toBe("Recursión: una función que se llama a sí misma");
    expect(await ui.almacen.tarjetas.listar()).toHaveLength(0); // abrir el formulario no guarda
    await ui.escribir("#tarjeta-pregunta", "¿Qué es la recursión?");
    await ui.clic("Guardar tarjeta"); // sin área: avisa y conserva el formulario
    expect(ui.raiz.textContent).toContain("área");
    expect(await ui.almacen.tarjetas.listar()).toHaveLength(0);
    await ui.escribir("#tarjeta-area-nueva", "Programación > CS50");
    await ui.clic("Guardar tarjeta");
    const [t] = await ui.almacen.tarjetas.listar();
    expect(t).toMatchObject({ pregunta: "¿Qué es la recursión?", reps: 0, vence: "2026-11-22" });
    expect(ui.q("#tarjeta-pregunta")).toBeNull();
    expect((await ui.almacen.areas.listar()).map((a) => a.nombre).sort()).toEqual(["CS50", "Programación"]);
  });

  it("la papelera lista tarjetas, tareas, metas y apuntes y restaura cada uno", async () => {
    const { ui, reloj } = await nuevo();
    await ui.ir("tarjetas");
    await ui.clic("Importar");
    await ui.escribir("#caja-importar", JSON.stringify({ tipo: "aprendizaje", fecha: "2026-11-22", area: "Mate", tema: "T", preguntas: [{ p: "Pregunta uno", r: "r" }] }));
    await ui.clic("Confirmar importación");
    await crearTarea(ui.almacen, reloj, { titulo: "Tarea para borrar" });
    const { crearMetaAnual } = await import("../src/compartido/tareas.ts");
    const { crearApunte } = await import("../src/compartido/apuntes.ts");
    const { borrarApunte, borrarTarjeta } = await import("../src/compartido/gestion.ts");
    const { borrarTarea, borrarMeta } = await import("../src/compartido/tareas.ts");
    const meta = await crearMetaAnual(ui.almacen, reloj, { anio: 2026, titulo: "Meta para borrar" });
    const ap = await crearApunte(ui.almacen, reloj, { texto: "Apunte para borrar" });
    await borrarTarjeta(ui.almacen, reloj, (await ui.almacen.tarjetas.listar())[0]!.id);
    await borrarTarea(ui.almacen, reloj, (await ui.almacen.tareas.listar())[0]!.id);
    await borrarMeta(ui.almacen, reloj, meta.id);
    await borrarApunte(ui.almacen, reloj, ap.id);

    await ui.ir("tarjetas");
    await ui.clic("Ver papelera (4)");
    for (const t of ["Tarjeta: Pregunta uno", "Tarea: Tarea para borrar", "Meta: 2026 · Meta para borrar", "Apunte: Apunte para borrar"]) {
      expect(ui.raiz.textContent).toContain(t);
    }
    const avisos: string[] = [];
    for (let i = 0; i < 4; i++) {
      await ui.clic("Restaurar");
      avisos.push(ui.q<HTMLElement>(".aviso").textContent!);
    }
    expect(avisos.sort()).toEqual(["Apunte restaurado.", "Meta restaurada.", "Tarea restaurada.", "Tarjeta restaurada."]);
    expect((await ui.almacen.tarjetas.listar()).length + (await ui.almacen.tareas.listar()).length
      + (await ui.almacen.metas.listar()).length + (await ui.almacen.apuntes.listar()).length).toBe(4);
    expect(ui.raiz.textContent).toContain("La papelera está vacía.");
  });

  it("recargar con el mismo almacén conserva tareas, metas y apuntes y los muestra", async () => {
    const { fabrica, reloj, ui } = await nuevo();
    await ui.escribir("#tarea-rapida", "Tarea que sobrevive");
    await ui.teclaEn(ui.q("#tarea-rapida"), "Enter");
    await ui.ir("apuntes");
    await ui.clic("Nuevo apunte");
    await ui.escribir("#captura-texto", "Apunte que sobrevive");
    await ui.clic("Guardar apunte");
    await ui.ir("tareas");
    await ui.clic("Nueva meta anual");
    await ui.escribir("#meta-titulo", "Meta que sobrevive");
    await ui.clic("Guardar meta");
    ui.almacen.cerrar();
    ui.cerrar();

    const ui2 = await abrir(fabrica, reloj);
    expect(ui2.raiz.textContent).toContain("Tarea que sobrevive");
    await ui2.ir("tareas");
    expect(ui2.raiz.textContent).toContain("2026 · Meta que sobrevive");
    await ui2.ir("apuntes");
    expect(ui2.raiz.textContent).toContain("Apunte que sobrevive");
  });

  it("el Markdown escapa el HTML: <script> queda como texto, solo hay enlaces http(s) y se ve negrita y listas", async () => {
    const ventana = new Window({ url: "http://localhost/" });
    const nodo = renderizarMarkdown(
      ventana.document as unknown as Document,
      "<script>alert(1)</script> **negrita** <img src=x onerror=alert(2)>\n- uno\n- dos\n[malo](javascript:alert(3)) [bueno](https://ejemplo.com/a?b=1)",
    );
    const html = nodo.innerHTML;
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain("<strong>negrita</strong>");
    expect(html).toContain("<li>uno</li>");
    expect(nodo.querySelectorAll("a")).toHaveLength(1);
    expect(nodo.querySelector("a")!.getAttribute("href")).toBe("https://ejemplo.com/a?b=1");
    expect(html).not.toMatch(/href="javascript/i);
    expect(nodo.textContent).toContain("[malo](javascript:alert(3))");
  });

  it("un apunte con <script> se muestra como texto en la pantalla", async () => {
    const { ui } = await nuevo();
    await ui.ir("apuntes");
    await ui.clic("Nuevo apunte");
    await ui.escribir("#captura-texto", "<script>window.hackeado = 1</script> hola");
    await ui.clic("Guardar apunte");
    expect(ui.raiz.querySelector("script")).toBeNull();
    expect(ui.raiz.textContent).toContain("<script>window.hackeado = 1</script> hola");
  });
});
