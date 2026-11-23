import "fake-indexeddb/auto";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { montarApp } from "../src/cliente/ui/app.ts";
import { fijarHoraCambio } from "../src/compartido/dia.ts";
import { borrarTarjeta } from "../src/compartido/gestion.ts";
import { crearTarea } from "../src/compartido/tareas.ts";
import { cargarTarjetas, CLAVE, contar, Entorno } from "./ayuda-sync.ts";

afterEach(() => fijarHoraCambio());

async function abrirUI(e: Entorno) {
  const c = e.cliente();
  const ventana = new Window({ url: "http://localhost/" });
  const raiz = ventana.document.createElement("div");
  ventana.document.body.append(raiz);
  const descargas: { nombre: string; texto: string }[] = [];
  let textoArchivo = "";
  const app = montarApp(raiz as unknown as HTMLElement, {
    almacen: c.almacen, reloj: e.reloj, persistencia: c.persistencia, sync: c.motor,
    descargar: (nombre, texto) => { descargas.push({ nombre, texto }); },
    leerArchivo: async () => textoArchivo,
  }, "hoy");
  await app.esperar();
  const doc = ventana.document;
  const quieto = async () => {
    await c.motor.esperar();
    await new Promise((r) => setTimeout(r, 0));
    await app.esperar();
  };
  const boton = (t: string) => [...doc.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(t));
  const clic = async (t: string) => {
    const b = boton(t);
    if (!b) throw new Error(`No hay botón "${t}" en: ${raiz.textContent}`);
    b.click();
    await quieto();
  };
  const indicador = () => doc.querySelector("#estado-sync")?.textContent ?? "";
  const escribir = async (selector: string, valor: string) => {
    const el = doc.querySelector(selector) as unknown as HTMLInputElement;
    el.value = valor;
    el.dispatchEvent(new ventana.Event("input", { bubbles: true }) as unknown as Event);
    await quieto();
  };
  const entrarPorUI = async (clave = CLAVE) => {
    app.ir("ajustes");
    await app.esperar();
    await escribir("#cuenta-clave", clave);
    await clic("Iniciar sesión");
  };
  return {
    e, c, app, raiz, doc, ventana, clic, boton, indicador, escribir, quieto, entrarPorUI, descargas,
    fijarArchivo: (t: string) => { textoArchivo = t; },
    elegirArchivo: async () => {
      const input = doc.querySelector("#archivo-respaldo") as unknown as HTMLInputElement;
      Object.defineProperty(input, "files", { value: [{ name: "respaldo.json" }], configurable: true });
      input.dispatchEvent(new ventana.Event("change", { bubbles: true }) as unknown as Event);
      await quieto();
    },
  };
}

describe("indicador de sincronización, cuenta y respaldo en la interfaz", () => {
  it("sin sesión el indicador dice 'Solo local' y la app funciona completa", async () => {
    const e = await Entorno.crear();
    const ui = await abrirUI(e);
    expect(ui.indicador()).toBe("Solo local");
    await ui.escribir("#tarea-rapida", "Tarea local");
    const campo = ui.doc.querySelector("#tarea-rapida") as unknown as HTMLInputElement;
    campo.dispatchEvent(new ui.ventana.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event);
    await ui.quieto();
    expect((await ui.c.crudo.tareas.listar()).length).toBe(1);
    expect(ui.raiz.textContent).toContain("Tarea local");
    expect(e.llamadas).toHaveLength(0); // sin sesión no se habla con el servidor
    ui.app.ir("ajustes");
    await ui.app.esperar();
    expect(ui.raiz.textContent).toContain("Cuenta");
    expect(ui.raiz.textContent).toContain("solo en este dispositivo");
    expect(ui.boton("Sincronizar ahora")).toBeUndefined();
  });

  it("login por la interfaz: contraseña incorrecta muestra el error; la correcta sincroniza y el indicador pasa a 'Sincronizado'", async () => {
    const e = await Entorno.crear();
    const ui = await abrirUI(e);
    await cargarTarjetas(ui.c.almacen, e.reloj, 2);
    await ui.entrarPorUI("equivocada");
    expect(ui.raiz.textContent).toContain("Contraseña incorrecta");
    expect(ui.indicador()).toBe("Solo local");
    await ui.escribir("#cuenta-clave", CLAVE);
    await ui.clic("Iniciar sesión");
    expect(ui.indicador()).toBe("Sincronizado");
    expect(contar(e.servidor.db, "tarjetas")).toBe(2);
    expect(ui.raiz.textContent).toContain("Sesión iniciada");
    expect(ui.raiz.textContent).toContain("Última sincronización");
    expect(ui.boton("Sincronizar ahora")).toBeDefined();
    expect(JSON.stringify([...ui.c.persistencia.datos.keys()])).toContain("lean-os:token"); // el token queda en el almacenamiento local
  });

  it("el indicador cuenta los cambios pendientes, muestra 'Sin conexión' y 'Sincronizar ahora' los sube", async () => {
    const e = await Entorno.crear();
    const ui = await abrirUI(e);
    await ui.entrarPorUI();
    e.red = false;
    await crearTarea(ui.c.almacen, e.reloj, { titulo: "A" });
    await crearTarea(ui.c.almacen, e.reloj, { titulo: "B" });
    await ui.quieto();
    expect(ui.indicador()).toBe("2 cambios pendientes");
    await ui.clic("Sincronizar ahora");
    expect(ui.indicador()).toBe("Sin conexión · 2 cambios pendientes");
    expect(ui.raiz.textContent).toContain("No hay conexión con el servidor");
    e.red = true;
    await ui.clic("Sincronizar ahora");
    expect(ui.indicador()).toBe("Sincronizado");
    expect(contar(e.servidor.db, "tareas")).toBe(2);
  });

  it("un borrado masivo muestra el pedido de confirmación con su botón y no aplica nada hasta confirmar", async () => {
    const e = await Entorno.crear();
    const ui = await abrirUI(e);
    await ui.entrarPorUI();
    await cargarTarjetas(ui.c.almacen, e.reloj, 5);
    await ui.c.motor.sincronizarAhora();
    e.reloj.avanzarMinutos(1);
    const ids = (await ui.c.crudo.tarjetas.listar()).map((t) => t.id);
    await borrarTarjeta(ui.c.almacen, e.reloj, ids[0]!);
    await borrarTarjeta(ui.c.almacen, e.reloj, ids[1]!);
    await ui.c.motor.sincronizarAhora();
    await ui.quieto();
    expect(ui.indicador()).toBe("Falta confirmar un borrado");
    expect(ui.raiz.textContent).toContain("borraría 2 de 5 tarjetas");
    expect(contar(e.servidor.db, "tarjetas", "WHERE deleted_at IS NULL")).toBe(5);
    await ui.clic("Confirmar y sincronizar");
    expect(ui.indicador()).toBe("Sincronizado");
    expect(ui.doc.querySelector(".confirmar-borrado")).toBeNull();
    expect(contar(e.servidor.db, "tarjetas", "WHERE deleted_at IS NULL")).toBe(3);
  });

  it("cerrar sesión vuelve a 'Solo local' y no borra los datos locales", async () => {
    const e = await Entorno.crear();
    const ui = await abrirUI(e);
    await cargarTarjetas(ui.c.almacen, e.reloj, 2);
    await ui.entrarPorUI();
    await ui.clic("Cerrar sesión");
    expect(ui.indicador()).toBe("Solo local");
    expect((await ui.c.crudo.tarjetas.listar()).length).toBe(2);
    expect(ui.raiz.textContent).toContain("Sesión cerrada");
    expect(ui.doc.querySelector("#cuenta-clave")).not.toBeNull(); // vuelve el formulario de ingreso
    expect(ui.c.persistencia.getItem("lean-os:token")).toBeNull();
  });

  it("una sesión vencida se muestra en el indicador y en Ajustes sin perder datos", async () => {
    const e = await Entorno.crear();
    const ui = await abrirUI(e);
    await ui.entrarPorUI();
    const token = ui.c.persistencia.getItem("lean-os:token")!;
    await e.servidor.app.request("/auth/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } });
    await cargarTarjetas(ui.c.almacen, e.reloj, 1);
    await ui.c.motor.sincronizarAhora();
    await ui.quieto();
    expect(ui.indicador()).toContain("Sesión vencida");
    expect(ui.raiz.textContent).toContain("Tu sesión venció");
    expect((await ui.c.crudo.tarjetas.listar()).length).toBe(1);
  });

  it("Exportar todo descarga un JSON con el formato del servidor, borrados incluidos; Importar suma un respaldo e informa los conteos", async () => {
    const e = await Entorno.crear();
    const ui = await abrirUI(e);
    await cargarTarjetas(ui.c.almacen, e.reloj, 3);
    const ids = (await ui.c.crudo.tarjetas.listar()).map((t) => t.id);
    await borrarTarjeta(ui.c.almacen, e.reloj, ids[0]!);
    ui.app.ir("ajustes");
    await ui.app.esperar();
    await ui.clic("Exportar todo");
    expect(ui.descargas).toHaveLength(1);
    expect(ui.descargas[0]!.nombre).toMatch(/^lean-os-respaldo-\d{4}-\d{2}-\d{2}\.json$/);
    const exp = JSON.parse(ui.descargas[0]!.texto);
    expect(exp.formato).toBe(1);
    expect(exp.tablas.tarjetas).toHaveLength(3); // incluye la borrada
    expect(ui.raiz.textContent).toContain("Se descargó el respaldo");

    // Importar en otra instalación limpia (otra ventana con su propio almacén).
    const e2 = await Entorno.crear();
    const ui2 = await abrirUI(e2);
    ui2.app.ir("ajustes");
    await ui2.app.esperar();
    ui2.fijarArchivo(ui.descargas[0]!.texto);
    await ui2.elegirArchivo();
    expect((await ui2.c.crudo.tarjetas.listar({ incluirBorrados: true })).length).toBe(3);
    expect(ui2.raiz.textContent).toContain("Respaldo importado");
    expect(ui2.raiz.textContent).toContain("Tarjetas: 3 nuevos");
    expect(ui2.indicador()).toBe("Solo local");
    // Un archivo inválido no cambia nada.
    ui2.fijarArchivo("{ no es un respaldo");
    await ui2.elegirArchivo();
    expect(ui2.raiz.textContent).toContain("No se cambió nada");
    expect((await ui2.c.crudo.tarjetas.listar({ incluirBorrados: true })).length).toBe(3);
  });
});
