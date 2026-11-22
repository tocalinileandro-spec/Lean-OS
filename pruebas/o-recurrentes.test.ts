import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AlmacenIndexedDB } from "../src/cliente/almacen-indexeddb.ts";
import { exportarLocalTexto, importarRespaldo } from "../src/cliente/sync/respaldo.ts";
import { montarApp, type AppMontada } from "../src/cliente/ui/app.ts";
import type { Persistencia } from "../src/cliente/ui/logica.ts";
import { AlmacenMemoria } from "../src/compartido/almacen.ts";
import { fijarHoraCambio } from "../src/compartido/dia.ts";
import { idOcurrencia, proximaFecha, validarRepeticion, type Repeticion } from "../src/compartido/recurrencia.ts";
import { validarRegistro } from "../src/compartido/respaldo-formato.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { borrarTarea, crearMetaAnual, crearTarea, desmarcarHecha, detenerRepeticion, editarTarea, marcarHecha } from "../src/compartido/tareas.ts";
import { Entorno, entrar, fila } from "./ayuda-sync.ts";

afterEach(() => fijarHoraCambio());

const HOY = "2026-11-22"; // domingo
const nuevo = () => ({ a: new AlmacenMemoria(), r: new RelojSimulado("2026-11-22T15:00:00.000Z") });
const reloj = (fecha: string) => new RelojSimulado(`${fecha}T15:00:00.000Z`);
const DIARIA: Repeticion = { tipo: "diaria" };

describe("O13-O16: próxima ocurrencia", () => {
  it("O13: diaria con fecha de hoy genera mañana con mismo título, nota, meta y regla", async () => {
    const { a, r } = nuevo();
    const meta = await crearMetaAnual(a, r, { anio: 2026, titulo: "Meta" });
    const t = await crearTarea(a, r, { titulo: "Tomar agua", fecha: HOY, nota: "2 litros", meta_id: meta.id, repeticion: DIARIA });
    const hecha = await marcarHecha(a, r, t.id);
    expect(hecha.estado).toBe("hecha");
    const todas = await a.tareas.listar();
    expect(todas).toHaveLength(2);
    const sig = todas.find((x) => x.id !== t.id)!;
    expect(sig).toMatchObject({ titulo: "Tomar agua", fecha: "2026-11-23", nota: "2 litros", meta_id: meta.id, estado: "pendiente", hecha_en: null, repeticion: DIARIA });
    expect(sig.serie_id).toBe(t.id);
    expect(hecha.serie_id).toBe(t.id);
  });

  it("O14: semanal lunes y jueves, en ambos sentidos", async () => {
    const regla: Repeticion = { tipo: "semanal", dias: [1, 4] };
    expect(proximaFecha(regla, "2026-11-23", "2026-11-23")).toBe("2026-11-26"); // lunes -> jueves
    expect(proximaFecha(regla, "2026-11-26", "2026-11-26")).toBe("2026-11-30"); // jueves -> lunes siguiente
    expect(proximaFecha(regla, "2026-11-22", "2026-11-22")).toBe("2026-11-23"); // domingo -> lunes
    const { a } = nuevo();
    const r = reloj("2026-11-23");
    const t = await crearTarea(a, r, { titulo: "Gimnasio", fecha: "2026-11-23", repeticion: regla });
    await marcarHecha(a, r, t.id);
    expect((await a.tareas.listar()).find((x) => x.id !== t.id)!.fecha).toBe("2026-11-26");
    const r2 = reloj("2026-11-26");
    const t2 = await crearTarea(a, r2, { titulo: "Otra", fecha: "2026-11-26", repeticion: regla });
    await marcarHecha(a, r2, t2.id);
    expect((await a.tareas.listar()).find((x) => x.titulo === "Otra" && x.id !== t2.id)!.fecha).toBe("2026-11-30");
  });

  it("O15: mensual día 31 cae el último día en meses cortos y el 31 en los de 31", () => {
    const m: Repeticion = { tipo: "mensual", dia_mes: 31 };
    expect(proximaFecha(m, "2026-01-31", "2026-01-31")).toBe("2026-02-28");
    expect(proximaFecha(m, "2028-01-31", "2028-01-31")).toBe("2028-02-29"); // bisiesto
    expect(proximaFecha(m, "2026-03-31", "2026-03-31")).toBe("2026-04-30");
    expect(proximaFecha(m, "2026-02-28", "2026-02-28")).toBe("2026-03-31");
    expect(proximaFecha(m, "2026-04-30", "2026-04-30")).toBe("2026-05-31");
    expect(proximaFecha(m, "2026-12-31", "2026-12-31")).toBe("2027-01-31");
    expect(proximaFecha({ tipo: "mensual", dia_mes: 15 }, "2026-11-22", "2026-11-22")).toBe("2026-12-15");
  });

  it("O15: marcada hecha desde enero, la siguiente es el 28 de febrero", async () => {
    const { a } = nuevo();
    const r = reloj("2026-01-31");
    const t = await crearTarea(a, r, { titulo: "Alquiler", fecha: "2026-01-31", repeticion: { tipo: "mensual", dia_mes: 31 } });
    await marcarHecha(a, r, t.id);
    expect((await a.tareas.listar()).find((x) => x.id !== t.id)!.fecha).toBe("2026-02-28");
  });

  it("O16: diaria atrasada 3 días hecha hoy genera una sola, posterior a hoy", async () => {
    const { a, r } = nuevo();
    const t = await crearTarea(a, r, { titulo: "Atrasada", fecha: "2026-11-19", repeticion: DIARIA });
    await marcarHecha(a, r, t.id);
    const todas = await a.tareas.listar();
    expect(todas).toHaveLength(2);
    expect(todas.find((x) => x.id !== t.id)!.fecha).toBe("2026-11-23");
    // tarea sin fecha: la base es hoy
    const s = await crearTarea(a, r, { titulo: "Sin fecha", repeticion: DIARIA });
    await marcarHecha(a, r, s.id);
    expect((await a.tareas.listar()).find((x) => x.titulo === "Sin fecha" && x.id !== s.id)!.fecha).toBe("2026-11-23");
  });

  it("id determinista con forma de UUID v5 y valores de SHA-1 conocidos", () => {
    const id = idOcurrencia("serie-1", "2026-11-23");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(idOcurrencia("serie-1", "2026-11-23")).toBe(id);
    expect(idOcurrencia("serie-1", "2026-11-24")).not.toBe(id);
    expect(idOcurrencia("serie-2", "2026-11-23")).not.toBe(id);
  });

  it("validación estricta de reglas", () => {
    expect(() => validarRepeticion({ tipo: "semanal", dias: [] })).toThrow("al menos un día");
    expect(() => validarRepeticion({ tipo: "semanal", dias: [1, 1] })).toThrow("repetidos");
    expect(() => validarRepeticion({ tipo: "semanal", dias: [4, 1] })).toThrow("ordenados");
    expect(() => validarRepeticion({ tipo: "semanal", dias: [0] })).toThrow("1 (lunes)");
    expect(() => validarRepeticion({ tipo: "mensual", dia_mes: 32 })).toThrow("entre 1 y 31");
    expect(() => validarRepeticion({ tipo: "mensual", dia_mes: 1.5 })).toThrow();
    expect(() => validarRepeticion({ tipo: "anual" })).toThrow("no es válido");
    expect(() => validarRepeticion(null)).toThrow();
  });

  it("crear y editar rechazan reglas inválidas", async () => {
    const { a, r } = nuevo();
    await expect(crearTarea(a, r, { titulo: "x", repeticion: { tipo: "mensual", dia_mes: 0 } })).rejects.toThrow("entre 1 y 31");
    const t = await crearTarea(a, r, { titulo: "x" });
    await expect(editarTarea(a, r, t.id, { repeticion: { tipo: "semanal", dias: [] } })).rejects.toThrow("al menos un día");
  });
});

describe("O17: sin duplicados", () => {
  it("O17: marcar, desmarcar y volver a marcar deja una sola siguiente; desmarcar no la borra", async () => {
    const { a, r } = nuevo();
    const t = await crearTarea(a, r, { titulo: "Diaria", fecha: HOY, repeticion: DIARIA });
    await marcarHecha(a, r, t.id);
    await desmarcarHecha(a, r, t.id);
    expect(await a.tareas.listar()).toHaveLength(2); // la siguiente sigue
    await marcarHecha(a, r, t.id);
    expect(await a.tareas.listar()).toHaveLength(2);
  });

  it("O17: si la siguiente está en la papelera no se vuelve a crear ni se pisa", async () => {
    const { a, r } = nuevo();
    const t = await crearTarea(a, r, { titulo: "Diaria", fecha: HOY, repeticion: DIARIA });
    await marcarHecha(a, r, t.id);
    const sig = (await a.tareas.listar()).find((x) => x.id !== t.id)!;
    await borrarTarea(a, r, sig.id);
    await desmarcarHecha(a, r, t.id);
    await marcarHecha(a, r, t.id);
    const todas = await a.tareas.listar({ incluirBorrados: true });
    expect(todas).toHaveLength(2);
    expect(todas.find((x) => x.id === sig.id)!.deleted_at).not.toBeNull();
  });

  it("O17: dos clientes sin conexión marcan la misma tarea y al sincronizar hay una sola siguiente", async () => {
    const e = await Entorno.crear();
    const a = e.cliente();
    const b = e.cliente();
    await entrar(a);
    await entrar(b);
    const t = await crearTarea(a.almacen, e.reloj, { titulo: "Compartida", fecha: "2026-03-10", repeticion: DIARIA });
    await a.motor.sincronizar();
    await b.motor.sincronizar();
    e.red = false;
    e.reloj.avanzarMinutos(1);
    await marcarHecha(a.almacen, e.reloj, t.id);
    e.reloj.avanzarMinutos(1);
    await marcarHecha(b.almacen, e.reloj, t.id);
    e.red = true;
    await a.motor.sincronizar();
    await b.motor.sincronizar();
    await a.motor.sincronizar();
    const lista = async (c: typeof a) => (await c.crudo.tareas.listar({ incluirBorrados: true }));
    for (const c of [a, b]) {
      const l = await lista(c);
      expect(l).toHaveLength(2);
      expect(l.filter((x) => x.id !== t.id)).toHaveLength(1);
    }
    const sig = (await lista(a)).find((x) => x.id !== t.id)!;
    expect(sig.id).toBe(idOcurrencia(t.id, "2026-03-11"));
    expect(sig.fecha).toBe("2026-03-11");
    expect(fila(e.servidor.db, "tareas", sig.id)?.["serie_id"]).toBe(t.id);
    const n = (e.servidor.db.prepare("SELECT COUNT(*) AS n FROM tareas").get() as { n: number }).n;
    expect(n).toBe(2);
  });
});

describe("dejar de repetir", () => {
  it("detenerRepeticion quita la regla y al marcar hecha ya no se genera nada; la serie queda", async () => {
    const { a, r } = nuevo();
    const t = await crearTarea(a, r, { titulo: "Diaria", fecha: HOY, repeticion: DIARIA });
    await marcarHecha(a, r, t.id);
    const sig = (await a.tareas.listar()).find((x) => x.id !== t.id)!;
    const cortada = await detenerRepeticion(a, r, sig.id);
    expect(cortada.repeticion).toBeNull();
    expect(cortada.serie_id).toBe(t.id);
    await marcarHecha(a, r, sig.id);
    expect(await a.tareas.listar()).toHaveLength(2);
  });
});

class Memoria implements Persistencia {
  datos = new Map<string, string>();
  getItem(k: string) { return this.datos.get(k) ?? null; }
  setItem(k: string, v: string) { this.datos.set(k, v); }
}

async function abrir() {
  const ventana = new Window({ url: "http://localhost/" });
  const raiz = ventana.document.createElement("div");
  ventana.document.body.append(raiz);
  const almacen = await AlmacenIndexedDB.abrir("lean-os-ui-rec", new IDBFactory());
  const app: AppMontada = montarApp(raiz as unknown as HTMLElement, { almacen, reloj: new RelojSimulado("2026-11-22T15:00:00.000Z"), persistencia: new Memoria() });
  await app.esperar();
  const doc = ventana.document;
  const q = <T extends Element>(sel: string) => doc.querySelector(sel) as unknown as T;
  const clic = async (texto: string) => {
    const b = [...doc.querySelectorAll("button")].find((x) => x.textContent?.trim().startsWith(texto));
    if (!b) throw new Error(`No hay botón "${texto}" en: ${raiz.textContent}`);
    b.click();
    await app.esperar();
  };
  const evento = (n: string) => new ventana.Event(n, { bubbles: true }) as unknown as Event;
  const escribir = async (sel: string, valor: string, tipo = "input") => {
    const el = q<HTMLInputElement>(sel);
    if (!el) throw new Error(`No hay ${sel} en: ${raiz.textContent}`);
    el.value = valor;
    el.dispatchEvent(evento(tipo));
    await app.esperar();
  };
  const tildar = async (sel: string) => {
    const el = q<HTMLInputElement>(sel);
    el.checked = !el.checked;
    el.dispatchEvent(evento("change"));
    await app.esperar();
  };
  return { app, almacen, raiz, q, clic, escribir, tildar, ir: async (p: Parameters<AppMontada["ir"]>[0]) => { app.ir(p); await app.esperar(); } };
}

describe("O18: interfaz", () => {
  it("O18: crear con repetición, editar la regla, dejar de repetir y borrar una ocurrencia", async () => {
    const ui = await abrir();
    await ui.ir("tareas");
    await ui.clic("Nueva tarea");
    await ui.escribir("#tarea-titulo", "Regar plantas");
    await ui.escribir("#tarea-fecha", HOY, "change");
    await ui.escribir("#tarea-repetir", "semanal", "change");
    await ui.tildar("#tarea-repetir-dia-1");
    await ui.tildar("#tarea-repetir-dia-4");
    // el formulario conserva lo escrito aunque se redibuje
    expect(ui.q<HTMLInputElement>("#tarea-repetir-dia-4").checked).toBe(true);
    await ui.clic("Guardar tarea");
    let ts = await ui.almacen.tareas.listar();
    expect(ts).toHaveLength(1);
    expect(ts[0]!.repeticion).toEqual({ tipo: "semanal", dias: [1, 4] });
    expect(ui.raiz.textContent).toContain("↻");
    expect(ui.raiz.textContent).toContain("Se repite los lunes y jueves");

    // editar la regla a mensual
    await ui.clic("Editar");
    expect(ui.q<HTMLSelectElement>("#tarea-repetir").value).toBe("semanal");
    await ui.escribir("#tarea-repetir", "mensual", "change");
    await ui.escribir("#tarea-repetir-dia-mes", "31");
    await ui.clic("Guardar tarea");
    ts = await ui.almacen.tareas.listar();
    expect(ts[0]!.repeticion).toEqual({ tipo: "mensual", dia_mes: 31 });
    expect(ui.raiz.textContent).toContain("Se repite el día 31 de cada mes");

    // regla inválida: mensaje claro y la regla anterior queda
    await ui.clic("Editar");
    await ui.escribir("#tarea-repetir-dia-mes", "40");
    await ui.clic("Guardar tarea");
    expect(ui.raiz.textContent).toContain("entre 1 y 31");
    expect((await ui.almacen.tareas.listar())[0]!.repeticion).toEqual({ tipo: "mensual", dia_mes: 31 });
    await ui.clic("Cancelar");

    // Hoy muestra la vigente; al tildar aparece la siguiente, sin duplicar
    await ui.ir("hoy");
    expect(ui.raiz.textContent).toContain("Regar plantas");
    ui.q<HTMLElement>('input[type="checkbox"]').click();
    await ui.app.esperar();
    ts = await ui.almacen.tareas.listar();
    expect(ts).toHaveLength(2);
    const sig = ts.find((x) => x.estado === "pendiente")!;
    expect(sig.fecha).toBe("2026-11-30");
    await ui.ir("tareas");
    expect(ui.raiz.textContent).toContain("30/11/2026");

    // dejar de repetir la vigente
    await ui.clic("Editar");
    await ui.clic("Dejar de repetir");
    expect((await ui.almacen.tareas.listar()).find((x) => x.id === sig.id)!.repeticion).toBeNull();
    expect(ui.q("#tarea-titulo")).toBeNull();

    // borrar una ocurrencia solo borra esa
    const otra = await crearTarea(ui.almacen, new RelojSimulado("2026-11-22T15:00:00.000Z"), { titulo: "Serie B", fecha: HOY, repeticion: DIARIA });
    await marcarHecha(ui.almacen, new RelojSimulado("2026-11-22T15:00:00.000Z"), otra.id);
    await ui.ir("hoy");
    await ui.ir("tareas");
    const antes = await ui.almacen.tareas.listar();
    const vigente = antes.find((x) => x.titulo === "Serie B" && x.estado === "pendiente")!;
    const botones = [...ui.raiz.querySelectorAll("li")].find((li) => li.textContent?.includes("Serie B") && li.textContent.includes("Editar") && !li.className.includes("hecha"));
    expect(botones).toBeTruthy();
    ([...botones!.querySelectorAll("button")].find((b) => b.textContent === "Borrar") as unknown as HTMLElement).click();
    await ui.app.esperar();
    const despues = await ui.almacen.tareas.listar({ incluirBorrados: true });
    expect(despues.find((x) => x.id === vigente.id)!.deleted_at).not.toBeNull();
    expect(despues.find((x) => x.id === otra.id)!.deleted_at).toBeNull();
    expect(despues).toHaveLength(antes.length);
  });
});

describe("O19: compatibilidad", () => {
  const base = { id: "t1", created_at: "2026-03-10T12:00:00.000Z", updated_at: "2026-03-10T12:00:00.000Z", deleted_at: null, rev: 1 };

  it("O19: datos viejos sin campos de repetición siguen siendo válidos y se tratan como sin repetición", async () => {
    expect(validarRegistro("tareas", { ...base, titulo: "Vieja", fecha: null, meta_id: null, nota: null, estado: "pendiente", hecha_en: null }, true)).toBeNull();
    expect(validarRegistro("tareas", { ...base, titulo: "Nueva", repeticion: { tipo: "diaria" }, serie_id: "s" }, true)).toBeNull();
    const { a, r } = nuevo();
    const t = await crearTarea(a, r, { titulo: "Común", fecha: HOY });
    expect("repeticion" in t).toBe(false);
    await marcarHecha(a, r, t.id);
    expect(await a.tareas.listar()).toHaveLength(1); // sin regla: nada se genera
  });

  it("O19: export e import conservan la regla y la serie", async () => {
    const { a, r } = nuevo();
    const t = await crearTarea(a, r, { titulo: "Con regla", fecha: HOY, repeticion: { tipo: "semanal", dias: [2, 5] } });
    await marcarHecha(a, r, t.id);
    const texto = await exportarLocalTexto(a, r);
    const destino = new AlmacenMemoria();
    const inf = await importarRespaldo(destino, texto);
    expect(inf).toBeTruthy();
    const ts = await destino.tareas.listar();
    expect(ts).toHaveLength(2);
    expect(ts.every((x) => x.serie_id === t.id)).toBe(true);
    expect(ts.find((x) => x.estado === "pendiente")!.repeticion).toEqual({ tipo: "semanal", dias: [2, 5] });
  });

  it("O19: el servidor acepta y conserva tareas con y sin regla", async () => {
    const e = await Entorno.crear();
    const c = e.cliente();
    await entrar(c);
    const vieja = await crearTarea(c.almacen, e.reloj, { titulo: "Sin regla" });
    const nueva = await crearTarea(c.almacen, e.reloj, { titulo: "Con regla", repeticion: { tipo: "mensual", dia_mes: 5 } });
    await c.motor.sincronizar();
    expect(fila(e.servidor.db, "tareas", vieja.id)?.["titulo"]).toBe("Sin regla");
    expect(fila(e.servidor.db, "tareas", nueva.id)?.["repeticion"]).toEqual({ tipo: "mensual", dia_mes: 5 });
    const otro = e.cliente();
    await entrar(otro);
    await otro.motor.sincronizar();
    expect((await otro.crudo.tareas.listar()).find((x) => x.id === nueva.id)!.repeticion).toEqual({ tipo: "mensual", dia_mes: 5 });
  });
});
