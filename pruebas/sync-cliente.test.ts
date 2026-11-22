import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { AlmacenIndexedDB } from "../src/cliente/almacen-indexeddb.ts";
import { AlmacenSincronizado, ColaMemoria, contarPendientes } from "../src/cliente/sync/cola.ts";
import { textoEstado } from "../src/cliente/sync/estado.ts";
import { borrarTarjeta, editarTarjeta, purgarPapelera } from "../src/compartido/gestion.ts";
import { calificarYGuardar } from "../src/compartido/repaso.ts";
import { crearTarea, editarTarea } from "../src/compartido/tareas.ts";
import { AlmacenMemoria } from "../src/compartido/almacen.ts";
import { contarTodo } from "../src/servidor/respaldo.ts";
import { TABLAS } from "../src/compartido/esquema.ts";
import { cargarTarjetas, contar, Entorno, entrar, fila, MemoriaPersistente } from "./ayuda-sync.ts";
import type { Cliente } from "./ayuda-sync.ts";

const minutos = (e: Entorno, n: number) => e.reloj.avanzarMinutos(n);

async function conteoLocal(c: Cliente) {
  const r: Record<string, number> = {};
  for (const t of TABLAS) r[t] = t === "repasos" ? (await c.crudo.repasos.listar()).length : (await (c.crudo as any)[t].listar({ incluirBorrados: true })).length;
  return r;
}

describe("cliente de sincronización", () => {
  it("S2: sin red se califican 5 tarjetas y se crea 1 tarea; al volver la red el servidor tiene los 5 repasos y la tarea", async () => {
    const e = await Entorno.crear();
    const c = e.cliente();
    await entrar(c);
    await cargarTarjetas(c.almacen, e.reloj, 5);
    await c.motor.sincronizar();
    expect(contar(e.servidor.db, "tarjetas")).toBe(5);

    e.red = false; // sin red
    minutos(e, 5);
    const tarjetas = await c.crudo.tarjetas.listar();
    for (const t of tarjetas) await calificarYGuardar(c.almacen, e.reloj, t.id, "bien");
    const tarea = await crearTarea(c.almacen, e.reloj, { titulo: "Estudiar sin red" });
    await c.motor.sincronizar();
    expect(c.motor.estado().fase).toBe("sin_conexion");
    expect(c.motor.estado().pendientes).toBe(11); // 5 repasos + 5 tarjetas + 1 tarea
    expect(contar(e.servidor.db, "repasos")).toBe(0);
    expect(textoEstado(c.motor.estado())).toContain("Sin conexión");

    e.red = true; // vuelve la red
    await c.motor.sincronizar();
    expect(c.motor.estado().fase).toBe("sincronizado");
    expect(c.motor.estado().pendientes).toBe(0);
    expect(contar(e.servidor.db, "repasos")).toBe(5);
    expect(fila(e.servidor.db, "tareas", tarea.id)?.["titulo"]).toBe("Estudiar sin red");
    for (const t of tarjetas) expect(fila(e.servidor.db, "tarjetas", t.id)?.["reps"]).toBe(1);
  });

  async function dosClientesConTarea() {
    const e = await Entorno.crear();
    const a = e.cliente();
    const b = e.cliente();
    await entrar(a);
    await entrar(b);
    const t = await crearTarea(a.almacen, e.reloj, { titulo: "Original" });
    await a.motor.sincronizar();
    await b.motor.sincronizar();
    expect((await b.crudo.tareas.obtener(t.id))?.titulo).toBe("Original");
    e.red = false;
    minutos(e, 1);
    await editarTarea(b.almacen, e.reloj, t.id, { titulo: "Edición de B (más vieja)" });
    minutos(e, 1);
    await editarTarea(a.almacen, e.reloj, t.id, { titulo: "Edición de A (más nueva)" });
    e.red = true;
    return { e, a, b, id: t.id };
  }

  it("S4: dos clientes editan la misma tarea sin red; sube primero el más viejo: gana la más reciente, la otra queda en registro_sync y ambos convergen", async () => {
    const { e, a, b, id } = await dosClientesConTarea();
    await b.motor.sincronizar(); // la vieja llega primero y se acepta
    await a.motor.sincronizar(); // la nueva la reemplaza
    await b.motor.sincronizar(); // B se entera
    await a.motor.sincronizar();
    for (const c of [a, b]) expect((await c.crudo.tareas.obtener(id))?.titulo).toBe("Edición de A (más nueva)");
    expect(fila(e.servidor.db, "tareas", id)?.["titulo"]).toBe("Edición de A (más nueva)");
    const reg = e.servidor.db.prepare("SELECT version_perdedora FROM registro_sync WHERE tabla = 'tareas' AND registro_id = ?").all(id) as { version_perdedora: string }[];
    // El historial es una cadena: queda la versión original y la de B (la que perdió frente a la de A).
    expect(reg.some((r) => r.version_perdedora.includes("Edición de B"))).toBe(true);
    expect(a.motor.estado().pendientes).toBe(0);
    expect(b.motor.estado().pendientes).toBe(0);
  });

  it("S4: sube primero el más nuevo: el viejo pierde, queda en registro_sync y B converge a la edición más reciente", async () => {
    const { e, a, b, id } = await dosClientesConTarea();
    await a.motor.sincronizar();
    await b.motor.sincronizar(); // B pierde; el servidor no cambia, pero B baja lo ganador
    await a.motor.sincronizar();
    for (const c of [a, b]) expect((await c.crudo.tareas.obtener(id))?.titulo).toBe("Edición de A (más nueva)");
    expect(fila(e.servidor.db, "tareas", id)?.["titulo"]).toBe("Edición de A (más nueva)");
    const reg = e.servidor.db.prepare("SELECT version_perdedora FROM registro_sync WHERE tabla = 'tareas' AND registro_id = ?").all(id) as { version_perdedora: string }[];
    // El historial es una cadena: queda la versión original y la de B (la que perdió frente a la de A).
    expect(reg.some((r) => r.version_perdedora.includes("Edición de B"))).toBe(true);
    expect(b.motor.estado().pendientes).toBe(0);
  });

  it("S5: servidor vacío y cliente con datos: el cliente conserva todo (borrados y repasos incluidos) y lo sube", async () => {
    const e = await Entorno.crear();
    const c = e.cliente();
    await cargarTarjetas(c.almacen, e.reloj, 4);
    const tarjetas = await c.crudo.tarjetas.listar();
    await calificarYGuardar(c.almacen, e.reloj, tarjetas[0]!.id, "bien");
    await calificarYGuardar(c.almacen, e.reloj, tarjetas[1]!.id, "otra_vez");
    await borrarTarjeta(c.almacen, e.reloj, tarjetas[3]!.id);
    const t = await crearTarea(c.almacen, e.reloj, { titulo: "Local" });
    const antes = await conteoLocal(c);
    // Aunque el cliente ya "vio" una sincronización vieja, el servidor está vacío.
    await entrar(c);
    expect(c.motor.estado().fase).toBe("sincronizado");
    expect(await conteoLocal(c)).toEqual(antes); // no se borró nada
    expect(contarTodo(e.servidor.db)).toMatchObject({
      tarjetas: 4, repasos: 2, tareas: 1, areas: antes["areas"], apuntes: antes["apuntes"], importaciones: antes["importaciones"],
    });
    expect(fila(e.servidor.db, "tarjetas", tarjetas[3]!.id)?.["deleted_at"]).not.toBeNull(); // el borrado también subió
    expect(fila(e.servidor.db, "tareas", t.id)?.["titulo"]).toBe("Local");
  });

  it("S5: servidor restaurado con un rev menor: el cliente no pierde nada y vuelve a subir todo", async () => {
    const e = await Entorno.crear();
    const c = e.cliente();
    await entrar(c);
    await cargarTarjetas(c.almacen, e.reloj, 3);
    await c.motor.sincronizar();
    const respaldoViejo = (await (await e.fetch("/export", { headers: { authorization: `Bearer ${[...c.persistencia.datos.entries()].find(([k]) => k.endsWith("token"))![1]}` } })).json()) as any;
    // Sigue trabajando: el cursor local pasa al rev del respaldo.
    await cargarTarjetas(c.almacen, e.reloj, 4, "Matemática", "Álgebra");
    const tarea = await crearTarea(c.almacen, e.reloj, { titulo: "Posterior al respaldo" });
    await c.motor.sincronizar();
    const revNuevo = (e.servidor.db.prepare("SELECT valor FROM contador_rev WHERE id = 1").get() as { valor: number }).valor;
    expect(revNuevo).toBeGreaterThan(respaldoViejo.rev);
    const antes = await conteoLocal(c);

    // Se restaura el servidor desde el respaldo viejo (rev menor). La sesión se vuelve a abrir en el servidor nuevo.
    const { crearServidor } = await import("./ayuda-sync.ts");
    const { restaurarRespaldo } = await import("../src/servidor/respaldo.ts");
    e.servidor = await crearServidor(e.reloj);
    restaurarRespaldo(e.servidor.db, respaldoViejo);
    expect(contar(e.servidor.db, "tarjetas")).toBe(3);
    await c.motor.cerrarSesion();
    await entrar(c);

    expect(await conteoLocal(c)).toEqual(antes); // el cliente conserva todo
    expect(contar(e.servidor.db, "tarjetas")).toBe(7);
    expect(fila(e.servidor.db, "tareas", tarea.id)?.["titulo"]).toBe("Posterior al respaldo");
    expect(contar(e.servidor.db, "repasos")).toBe(0);
  });

  it("S5: si el servidor se vacía a mitad de camino (cursor mayor que su rev) el cliente no borra y sube todo de nuevo", async () => {
    const e = await Entorno.crear();
    const c = e.cliente();
    await entrar(c);
    await cargarTarjetas(c.almacen, e.reloj, 3);
    const tarjetas = await c.crudo.tarjetas.listar();
    await calificarYGuardar(c.almacen, e.reloj, tarjetas[0]!.id, "facil");
    await c.motor.sincronizar();
    const antes = await conteoLocal(c);
    const { crearServidor } = await import("./ayuda-sync.ts");
    e.servidor = await crearServidor(e.reloj); // servidor vacío nuevo
    const token = (await (await e.fetch("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "clave-de-prueba-123" }) })).json()) as any;
    c.persistencia.setItem("lean-os:token", token.token); // la sesión nueva en el servidor nuevo
    await c.motor.sincronizar();
    expect(c.motor.estado().fase).toBe("sincronizado");
    expect(await conteoLocal(c)).toEqual(antes);
    expect(contar(e.servidor.db, "tarjetas")).toBe(3);
    expect(contar(e.servidor.db, "repasos")).toBe(1);
  });

  it("S3: sincronizar dos veces seguidas no duplica nada ni vuelve a subir lo ya subido", async () => {
    const e = await Entorno.crear();
    const c = e.cliente();
    await entrar(c);
    await cargarTarjetas(c.almacen, e.reloj, 3);
    await c.motor.sincronizar();
    const despuesDeLaPrimera = contarTodo(e.servidor.db);
    const pushes = e.llamadas.filter((l) => l === "POST /sync/push").length;
    await c.motor.sincronizar();
    expect(contarTodo(e.servidor.db)).toEqual(despuesDeLaPrimera);
    expect(e.llamadas.filter((l) => l === "POST /sync/push").length).toBe(pushes); // la cola vacía no sube nada
  });

  it("lo que llega del servidor no se anota en la cola y el cursor se guarda", async () => {
    const e = await Entorno.crear();
    const a = e.cliente();
    const b = e.cliente();
    await entrar(a);
    await entrar(b);
    await cargarTarjetas(a.almacen, e.reloj, 3);
    await a.motor.sincronizar();
    await b.motor.sincronizar();
    expect(await conteoLocal(b)).toEqual(await conteoLocal(a));
    expect(await contarPendientes(b.cola)).toBe(0);
    const estado = JSON.parse(b.persistencia.getItem("lean-os:sync")!);
    expect(estado.cursor).toBeGreaterThan(0);
    e.llamadas.length = 0;
    await b.motor.sincronizar();
    expect(e.llamadas).toEqual(["GET /sync/pull"]); // solo pregunta por lo nuevo
  });

  it("pull paginado: baja todo en varias páginas y deja el cursor en el rev del servidor", async () => {
    const e = await Entorno.crear();
    const a = e.cliente();
    const b = e.cliente({ limitePagina: 5, tamanoLote: 4 });
    await entrar(a);
    await entrar(b);
    await cargarTarjetas(a.almacen, e.reloj, 12);
    await a.motor.sincronizar();
    e.llamadas.length = 0;
    await b.motor.sincronizar();
    expect(e.llamadas.filter((l) => l === "GET /sync/pull").length).toBeGreaterThanOrEqual(4);
    expect(await conteoLocal(b)).toEqual(await conteoLocal(a));
    const rev = (e.servidor.db.prepare("SELECT valor FROM contador_rev WHERE id = 1").get() as { valor: number }).valor;
    expect(JSON.parse(b.persistencia.getItem("lean-os:sync")!).cursor).toBe(rev);
  });

  it("la subida va en lotes", async () => {
    const e = await Entorno.crear();
    const c = e.cliente({ tamanoLote: 3 });
    await entrar(c);
    await cargarTarjetas(c.almacen, e.reloj, 8);
    e.llamadas.length = 0;
    await c.motor.sincronizar();
    expect(e.llamadas.filter((l) => l === "POST /sync/push").length).toBeGreaterThanOrEqual(4);
    expect(contar(e.servidor.db, "tarjetas")).toBe(8);
  });

  it("dos clientes editan grupos distintos de la misma tarjeta: se conservan ambos cambios y convergen", async () => {
    const e = await Entorno.crear();
    const a = e.cliente();
    const b = e.cliente();
    await entrar(a);
    await entrar(b);
    await cargarTarjetas(a.almacen, e.reloj, 1);
    await a.motor.sincronizar();
    await b.motor.sincronizar();
    const id = (await a.crudo.tarjetas.listar())[0]!.id;
    e.red = false;
    minutos(e, 1);
    await editarTarjeta(a.almacen, e.reloj, id, { pregunta: "Pregunta editada en A" });
    minutos(e, 1);
    await calificarYGuardar(b.almacen, e.reloj, id, "bien");
    e.red = true;
    await a.motor.sincronizar();
    await b.motor.sincronizar();
    await a.motor.sincronizar();
    const ta = (await a.crudo.tarjetas.obtener(id))!;
    const tb = (await b.crudo.tarjetas.obtener(id))!;
    for (const t of [ta, tb]) {
      expect(t.pregunta).toBe("Pregunta editada en A");
      expect(t.reps).toBe(1);
    }
    expect(ta).toEqual(tb);
    const s = fila(e.servidor.db, "tarjetas", id)!;
    expect(s["pregunta"]).toBe("Pregunta editada en A");
    expect(s["reps"]).toBe(1);
  });

  it("un borrado masivo (409) no aplica nada, queda pendiente de confirmar y al confirmar se aplica", async () => {
    const e = await Entorno.crear();
    const c = e.cliente();
    await entrar(c);
    await cargarTarjetas(c.almacen, e.reloj, 5);
    await c.motor.sincronizar();
    const ids = (await c.crudo.tarjetas.listar()).map((t) => t.id);
    minutos(e, 1);
    await borrarTarjeta(c.almacen, e.reloj, ids[0]!);
    await borrarTarjeta(c.almacen, e.reloj, ids[1]!);
    await c.motor.sincronizar();
    const est = c.motor.estado();
    expect(est.fase).toBe("confirmacion_pendiente");
    expect(est.confirmacion).toMatchObject({ tarjetas_vivas: 5, tarjetas_a_borrar: 2 });
    expect(est.confirmacion!.mensaje).toContain("2 de 5 tarjetas");
    expect(contar(e.servidor.db, "tarjetas", "WHERE deleted_at IS NULL")).toBe(5); // no se aplicó nada
    expect(est.pendientes).toBeGreaterThan(0); // nada se perdió de la cola
    expect((await c.crudo.tarjetas.listar({ incluirBorrados: true })).length).toBe(5);
    await c.motor.confirmarBorradoMasivo();
    expect(c.motor.estado().fase).toBe("sincronizado");
    expect(c.motor.estado().confirmacion).toBeNull();
    expect(contar(e.servidor.db, "tarjetas", "WHERE deleted_at IS NULL")).toBe(3);
  });

  it("un 401 marca la sesión como vencida sin perder nada", async () => {
    const e = await Entorno.crear();
    const c = e.cliente();
    await entrar(c);
    const token = c.persistencia.getItem("lean-os:token")!;
    await e.servidor.app.request("/auth/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } }); // el servidor invalida la sesión
    await cargarTarjetas(c.almacen, e.reloj, 2);
    await c.motor.sincronizar();
    expect(c.motor.estado().fase).toBe("sesion_vencida");
    expect(textoEstado(c.motor.estado())).toContain("Sesión vencida");
    expect(c.motor.hayCuenta()).toBe(false);
    expect((await c.crudo.tarjetas.listar()).length).toBe(2);
    expect(c.motor.estado().pendientes).toBeGreaterThan(0);
    await entrar(c); // vuelve a entrar y se sube lo pendiente
    expect(contar(e.servidor.db, "tarjetas")).toBe(2);
  });

  it("sin sesión el estado es 'Solo local' y sincronizar no hace nada ni llama al servidor", async () => {
    const e = await Entorno.crear();
    const c = e.cliente();
    await cargarTarjetas(c.almacen, e.reloj, 2);
    await c.motor.sincronizar();
    expect(c.motor.estado().fase).toBe("solo_local");
    expect(textoEstado(c.motor.estado())).toBe("Solo local");
    expect(c.motor.estado().pendientes).toBeGreaterThanOrEqual(3); // las tarjetas y lo demás quedan pendientes
    expect(e.llamadas).toHaveLength(0);
  });

  it("login: contraseña incorrecta, demasiados intentos y sin conexión dan mensajes en castellano; cerrar sesión no borra datos", async () => {
    const e = await Entorno.crear();
    const c = e.cliente();
    await cargarTarjetas(c.almacen, e.reloj, 2);
    const mal = await c.motor.iniciarSesion("equivocada");
    expect(mal).toEqual({ ok: false, mensaje: expect.stringContaining("Contraseña incorrecta") });
    expect(c.motor.hayCuenta()).toBe(false);
    for (let i = 0; i < 3; i++) await c.motor.iniciarSesion("equivocada");
    const bloqueo = await c.motor.iniciarSesion("equivocada"); // 5.º intento (el 1.º fue arriba)
    expect(bloqueo.ok).toBe(false);
    const sexto = await c.motor.iniciarSesion("equivocada");
    expect(sexto).toEqual({ ok: false, mensaje: expect.stringMatching(/Demasiados intentos\. Esperá \d+ segundos/) });
    e.red = false;
    const sin = await c.motor.iniciarSesion("x");
    expect(sin).toEqual({ ok: false, mensaje: expect.stringContaining("No hay conexión") });
    expect(await c.motor.iniciarSesion("")).toEqual({ ok: false, mensaje: "Escribí la contraseña." });
    e.red = true;
    e.reloj.avanzarMinutos(2); // pasa la ventana del limitador
    const bien = await c.motor.iniciarSesion("clave-de-prueba-123");
    expect(bien.ok).toBe(true);
    await c.motor.esperar();
    expect(c.motor.hayCuenta()).toBe(true);
    const token = c.persistencia.getItem("lean-os:token")!;
    await c.motor.cerrarSesion();
    expect(c.motor.hayCuenta()).toBe(false);
    expect(c.motor.estado().fase).toBe("solo_local");
    expect((await c.crudo.tarjetas.listar()).length).toBe(2); // los datos locales siguen
    const r = await e.servidor.app.request("/auth/yo", { headers: { authorization: `Bearer ${token}` } });
    expect(r.status).toBe(401); // el servidor invalidó el token
  });

  it("reintentos con espera creciente cuando no hay conexión, y se reinician al volver la red", async () => {
    const e = await Entorno.crear();
    const c = e.cliente();
    await entrar(c);
    e.red = false;
    c.programador.esperas.length = 0;
    for (let i = 0; i < 4; i++) await c.motor.sincronizar();
    expect(c.programador.esperas.filter((x) => x >= 5000)).toEqual([5000, 10000, 20000, 40000]);
    e.red = true;
    await c.motor.sincronizar();
    expect(c.motor.estado().fase).toBe("sincronizado");
    expect(c.programador.esperas.at(-1)).toBe(60_000);
  });

  it("disparadores: al abrir con sesión, al volver la red (online), tras cambios (agrupados) y cada ~60 s", async () => {
    const e = await Entorno.crear();
    const primero = e.cliente();
    await entrar(primero);
    let online: (() => void) | undefined;
    const c = e.cliente({
      persistencia: primero.persistencia as never,
      eventos: { addEventListener: (_t, f) => { online = f; } },
    });
    e.llamadas.length = 0;
    c.motor.iniciar(); // al abrir
    await c.motor.esperar();
    expect(e.llamadas).toContain("GET /sync/pull");
    expect(c.programador.activas().some((t) => t.ms === 60_000)).toBe(true); // cada ~60 s

    e.llamadas.length = 0;
    online!(); // vuelve la red
    await c.motor.esperar();
    expect(e.llamadas).toContain("GET /sync/pull");

    // tras cambios: tres guardados seguidos dejan un solo temporizador activo de 2 s
    const antes = c.programador.activas().length;
    await crearTarea(c.almacen, e.reloj, { titulo: "uno" });
    await crearTarea(c.almacen, e.reloj, { titulo: "dos" });
    await crearTarea(c.almacen, e.reloj, { titulo: "tres" });
    const cortos = c.programador.activas().filter((t) => t.ms === 2_000);
    expect(cortos).toHaveLength(1);
    expect(c.programador.activas().length).toBe(antes + 1);
    cortos[0]!.f();
    await c.motor.esperar();
    expect(contar(e.servidor.db, "tareas")).toBe(3);
  });

  it("un solo sincronizar a la vez", async () => {
    const e = await Entorno.crear();
    const c = e.cliente();
    await entrar(c);
    await cargarTarjetas(c.almacen, e.reloj, 3);
    e.maxEnVuelo = 0;
    await Promise.all([c.motor.sincronizar(), c.motor.sincronizar(), c.motor.sincronizarAhora()]);
    expect(e.maxEnVuelo).toBe(1);
    expect(contar(e.servidor.db, "tarjetas")).toBe(3);
  });

  it("purga local de la papelera: no se anota, no se baja de nuevo con el pull incremental y, si vuelve en un pull completo, queda como borrada y se vuelve a purgar", async () => {
    const e = await Entorno.crear();
    const c = e.cliente();
    await entrar(c);
    await cargarTarjetas(c.almacen, e.reloj, 2);
    const id = (await c.crudo.tarjetas.listar())[0]!.id;
    await borrarTarjeta(c.almacen, e.reloj, id);
    await c.motor.sincronizar();
    e.reloj.avanzarDias(31); // la sesión también vence: se vuelve a entrar
    expect(await purgarPapelera(c.almacen, e.reloj)).toBe(1);
    expect(await c.crudo.tarjetas.obtener(id)).toBeUndefined();
    expect(c.motor.estado().pendientes).toBe(0); // la purga no se encola
    await entrar(c);
    expect(await c.crudo.tarjetas.obtener(id)).toBeUndefined();
    expect(fila(e.servidor.db, "tarjetas", id)).toBeDefined(); // el servidor la conserva (no hay orden de borrar)
    c.persistencia.setItem("lean-os:sync", JSON.stringify({ cursor: 0, subidaCompleta: false, ultimaVez: null }));
    await c.motor.sincronizar();
    const vuelta = await c.crudo.tarjetas.obtener(id);
    expect(vuelta).toBeDefined();
    expect(vuelta!.deleted_at).not.toBeNull(); // vuelve como borrada, nunca como viva
    expect(await purgarPapelera(c.almacen, e.reloj)).toBe(1);
  });

  it("el cursor sobrevive a un localStorage intacto pero a una copia local vacía: no se saltea nada", async () => {
    const e = await Entorno.crear();
    const a = e.cliente();
    await entrar(a);
    await cargarTarjetas(a.almacen, e.reloj, 3);
    await a.motor.sincronizar();
    const b = e.cliente({ persistencia: a.persistencia as never }); // mismo localStorage, base local vacía
    await b.motor.sincronizar();
    expect((await b.crudo.tarjetas.listar()).length).toBe(3);
  });
});

describe("cola y almacén sincronizado", () => {
  it("el decorador anota cada guardado en la cola (también lotes y repasos) y deduplica al contar", async () => {
    const cola = new ColaMemoria();
    const alm = new AlmacenSincronizado(new AlmacenMemoria(), cola);
    const e = await Entorno.crear();
    await crearTarea(alm, e.reloj, { titulo: "x" });
    const t = (await alm.tareas.listar())[0]!;
    await editarTarea(alm, e.reloj, t.id, { titulo: "y" });
    expect((await cola.entradas()).length).toBeGreaterThan(2); // anota de más: es seguro
    expect(await contarPendientes(cola)).toBe(1); // pero es un solo registro
    await cargarTarjetas(alm, e.reloj, 2);
    expect(await contarPendientes(cola)).toBeGreaterThan(3);
    const todas = await cola.entradas();
    await cola.quitar(todas.slice(0, 1));
    expect((await cola.entradas()).length).toBe(todas.length - 1);
  });

  it("si la cola falla, el guardado igual se hace y se pide una subida completa", async () => {
    const rota = { anotar: async () => { throw new Error("cola rota"); }, entradas: async () => [], quitar: async () => {} };
    let pedida = 0;
    const alm = new AlmacenSincronizado(new AlmacenMemoria(), rota, { alFallarCola: () => { pedida++; } });
    const e = await Entorno.crear();
    await crearTarea(alm, e.reloj, { titulo: "no se pierde" });
    expect((await alm.tareas.listar())[0]?.titulo).toBe("no se pierde");
    expect(alm.fallosDeCola).toBeGreaterThan(0);
    expect(pedida).toBeGreaterThan(0);
  });

  it("subida completa pedida: sube todo aunque la cola esté vacía", async () => {
    const e = await Entorno.crear();
    const c = e.cliente({ cola: { anotar: async () => { throw new Error("rota"); }, entradas: async () => [], quitar: async () => {} } });
    await entrar(c);
    await crearTarea(c.almacen, e.reloj, { titulo: "con la cola rota" });
    await c.motor.sincronizar();
    expect(contar(e.servidor.db, "tareas")).toBe(1);
  });

  it("la cola en IndexedDB persiste, deduplica y quita solo lo ya subido", async () => {
    const fabrica = new IDBFactory();
    const idb = await AlmacenIndexedDB.abrir("sync-cola", fabrica);
    const cola = idb.cola;
    const alm = new AlmacenSincronizado(idb, cola);
    const e = await Entorno.crear();
    const t = await crearTarea(alm, e.reloj, { titulo: "en idb" });
    const instantanea = await cola.entradas();
    await editarTarea(alm, e.reloj, t.id, { titulo: "editada" }); // se anota otra vez después de la "instantánea"
    await cola.quitar(instantanea);
    expect((await cola.entradas()).length).toBeGreaterThan(0); // lo anotado después queda
    expect(await contarPendientes(cola)).toBe(1);
    idb.cerrar();
    const reabierto = await AlmacenIndexedDB.abrir("sync-cola", fabrica);
    expect(await contarPendientes(reabierto.cola)).toBe(1); // sobrevive al cierre
    reabierto.cerrar();
  });

  it("sincroniza con IndexedDB real (fake) como copia local", async () => {
    const e = await Entorno.crear();
    const idb = await AlmacenIndexedDB.abrir("sync-idb", new IDBFactory());
    const c = e.cliente({ almacenCrudo: idb, cola: idb.cola, persistencia: new MemoriaPersistente() as never });
    await entrar(c);
    await cargarTarjetas(c.almacen, e.reloj, 3);
    await c.motor.sincronizar();
    expect(contar(e.servidor.db, "tarjetas")).toBe(3);
    expect(c.motor.estado().pendientes).toBe(0);
    const otro = e.cliente();
    await entrar(otro);
    expect((await otro.crudo.tarjetas.listar()).length).toBe(3);
    idb.cerrar();
  });
});
