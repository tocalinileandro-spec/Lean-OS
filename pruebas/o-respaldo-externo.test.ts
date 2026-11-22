import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { montarApp } from "../src/cliente/ui/app.ts";
import { fijarHoraCambio } from "../src/compartido/dia.ts";
import { crearApunte } from "../src/compartido/apuntes.ts";
import { crearTarea } from "../src/compartido/tareas.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { crearApp } from "../src/servidor/app.ts";
import { abrirBase } from "../src/servidor/base.ts";
import { cifrarRespaldo, descifrarRespaldo, ErrorDescifrado, MAGIC } from "../src/servidor/cifrado.ts";
import { leerClavesRespaldo } from "../src/servidor/config.ts";
import type { ClavesRespaldo } from "../src/servidor/config.ts";
import { DestinoB2, ErrorDestino } from "../src/servidor/destino-b2.ts";
import { contarTodo, exportarTodo } from "../src/servidor/respaldo.ts";
import { restaurarDesdeBytes, ServicioRespaldoExterno } from "../src/servidor/respaldo-externo.ts";
import type { DestinoRespaldo } from "../src/servidor/respaldo-externo.ts";
import { cargarTarjetas, CLAVE, Entorno, entrar, hashDePrueba } from "./ayuda-sync.ts";

afterEach(() => {
  fijarHoraCambio();
  vi.restoreAllMocks();
});

const CLAVES: ClavesRespaldo = { b2KeyId: "id-b2-de-prueba-111", b2AppKey: "app-key-b2-de-prueba-222", b2Bucket: "bucket-de-prueba", clave: "clave-de-cifrado-de-prueba-333" };
const TAREA = "Comprar yerba especial ZQX";
const APUNTE = "Idea rara sobre pingüinos voladores QWV";
const TARJETA = "Pregunta Funciones 1";

class DestinoMemoria implements DestinoRespaldo {
  archivos = new Map<string, Uint8Array>();
  llamadas = 0;
  async subir(n: string, b: Uint8Array) { this.llamadas++; this.archivos.set(n, b); }
  async listar() { this.llamadas++; return [...this.archivos.keys()]; }
  async borrar(n: string) { this.llamadas++; this.archivos.delete(n); }
}

/** Servidor real en memoria con datos sembrados desde un cliente real. */
async function montar(claves: ClavesRespaldo | null = CLAVES, destino: DestinoRespaldo = new DestinoMemoria(), extra: { tiempoMaximoMs?: number; registrar?: (l: string) => void } = {}) {
  const e = await Entorno.crear();
  const c = e.cliente();
  await entrar(c);
  await cargarTarjetas(c.almacen, e.reloj, 3);
  await crearTarea(c.almacen, e.reloj, { titulo: TAREA });
  await crearApunte(c.almacen, e.reloj, { texto: APUNTE });
  await c.motor.sincronizarAhora();
  const db = e.servidor.db;
  const servicio = new ServicioRespaldoExterno({ db, reloj: e.reloj, claves, crearDestino: () => destino, registrar: extra.registrar ?? (() => {}), ...(extra.tiempoMaximoMs ? { tiempoMaximoMs: extra.tiempoMaximoMs } : {}) });
  const app = crearApp({ reloj: e.reloj, base: db, secretos: { passwordHash: await hashDePrueba(), sessionSecret: "s" }, registrar: extra.registrar ?? (() => {}), respaldoExterno: servicio });
  e.servidor = { app, db };
  return { e, c, db, servicio, app, destino, carpeta: mkdtempSync(join(tmpdir(), "resp-ext-")) };
}

const legible = (b: Uint8Array) => Buffer.from(b).toString("latin1") + Buffer.from(b).toString("utf8") + Buffer.from(b).toString("base64");
const CADENAS = [TAREA, APUNTE, TARJETA, "Respuesta 1", "Resumen de ejemplo", "tarjetas", "titulo"];

async function token(app: ReturnType<typeof crearApp>): Promise<Record<string, string>> {
  const r = await app.request("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: CLAVE }) });
  return { authorization: `Bearer ${((await r.json()) as { token: string }).token}`, "content-type": "application/json" };
}

describe("O1: desactivado no hay llamadas a terceros", () => {
  it("O1: con el ajuste por defecto el nocturno hace el local y no toca el destino ni la red", async () => {
    const espia = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("O1: se usó la red"); });
    const m = await montar(CLAVES, new DestinoMemoria());
    const crear = vi.fn(() => { throw new Error("O1: se creó el destino"); });
    const servicio = new ServicioRespaldoExterno({ db: m.db, reloj: m.e.reloj, claves: CLAVES, crearDestino: crear, registrar: () => {} });
    expect(servicio.activo()).toBe(false);
    await servicio.nocturno(m.carpeta);
    expect(readdirSync(m.carpeta).filter((f) => f.endsWith(".json"))).toHaveLength(1);
    expect(crear).not.toHaveBeenCalled();
    expect(espia).not.toHaveBeenCalled();
    expect(servicio.ultimoResultado()).toBeNull();
    // Activado y desactivado de nuevo: vuelve a no tocar nada.
    servicio.fijarActivo(true);
    servicio.fijarActivo(false);
    await servicio.nocturno(m.carpeta);
    expect(crear).not.toHaveBeenCalled();
  });
});

describe("O2: se sube un archivo cifrado", () => {
  it("O2: activado y con claves, el nocturno sube lean-os-AAAA-MM-DD.json.enc sin texto legible", async () => {
    const m = await montar();
    m.servicio.fijarActivo(true);
    await m.servicio.nocturno(m.carpeta);
    expect([...(m.destino as DestinoMemoria).archivos.keys()]).toEqual(["lean-os-2026-03-10.json.enc"]);
    const bytes = (m.destino as DestinoMemoria).archivos.get("lean-os-2026-03-10.json.enc")!;
    expect(Buffer.from(bytes.subarray(0, MAGIC.length)).toString("latin1")).toBe("LEANOS1");
    const todo = legible(bytes);
    for (const c of CADENAS) expect(todo.includes(c), c).toBe(false);
    // Control: el export sin cifrar sí las contiene (la prueba detecta algo real).
    const plano = JSON.stringify(exportarTodo(m.db, m.e.reloj));
    for (const c of [TAREA, APUNTE, TARJETA]) expect(plano.includes(c)).toBe(true);
    expect(m.servicio.ultimoResultado()).toMatchObject({ ok: true });
    expect(readdirSync(m.carpeta).filter((f) => f.endsWith(".json"))).toHaveLength(1);
  });

  it("O2: cada archivo usa sal e iv propios (dos cifrados del mismo texto difieren)", async () => {
    const a = await cifrarRespaldo("{}", "k");
    const b = await cifrarRespaldo("{}", "k");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("O2: DestinoB2 usa la API de B2 con autorización básica, SHA-1 y prefijo, y no filtra respuestas en los errores", async () => {
    const pedidos: { url: string; init: RequestInit }[] = [];
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    const fetchFalso = async (url: string, init: RequestInit = {}) => {
      pedidos.push({ url, init });
      if (url.endsWith("b2_authorize_account")) return json({ authorizationToken: "tok", apiInfo: { storageApi: { apiUrl: "https://api001.example", bucketId: "bid", bucketName: "bucket-de-prueba" } } });
      if (url.endsWith("b2_get_upload_url")) return json({ uploadUrl: "https://up.example/x", authorizationToken: "uptok" });
      if (url === "https://up.example/x") return json({});
      if (url.endsWith("b2_list_file_names")) return json({ files: [{ fileName: "lean-os-2026-03-10.json.enc", fileId: "f1" }] });
      if (url.endsWith("b2_delete_file_version")) return json({});
      return json({ secreto: "cuerpo-del-proveedor" }, 500);
    };
    const d = new DestinoB2({ keyId: "kid", appKey: "kapp", bucket: "bucket-de-prueba" }, fetchFalso);
    const bytes = new Uint8Array([1, 2, 3]);
    await d.subir("lean-os-2026-03-10.json.enc", bytes);
    expect(await d.listar()).toEqual(["lean-os-2026-03-10.json.enc"]);
    await d.borrar("lean-os-2026-03-10.json.enc");
    const h = (i: number) => new Headers(pedidos[i]!.init.headers);
    expect(pedidos[0]!.url).toBe("https://api.backblazeb2.com/b2api/v3/b2_authorize_account");
    expect(h(0).get("authorization")).toBe(`Basic ${Buffer.from("kid:kapp").toString("base64")}`);
    const subida = pedidos.find((p) => p.url === "https://up.example/x")!;
    expect(new Headers(subida.init.headers).get("x-bz-content-sha1")).toBe(createHash("sha1").update(bytes).digest("hex"));
    expect(new Headers(subida.init.headers).get("x-bz-file-name")).toBe("lean-os-2026-03-10.json.enc");
    expect(JSON.parse(pedidos.find((p) => p.url.endsWith("b2_list_file_names"))!.init.body as string)).toMatchObject({ bucketId: "bid", prefix: "lean-os-" });
    expect(pedidos.some((p) => p.url.endsWith("b2_delete_file_version"))).toBe(true);
    // Un error del proveedor no deja su cuerpo en el mensaje.
    const malo = new DestinoB2({ keyId: "kid", appKey: "kapp", bucket: "b" }, async () => json({ secreto: "cuerpo-del-proveedor" }, 500));
    const err = await malo.listar().catch((x) => x);
    expect(err).toBeInstanceOf(ErrorDestino);
    expect(String(err.message)).not.toContain("cuerpo-del-proveedor");
    expect(String(err.message)).not.toContain("kapp");
  });
});

describe("O3: descifrar y restaurar", () => {
  it("O3: el archivo subido se descifra y restaura en un servidor vacío con los mismos conteos", async () => {
    const m = await montar();
    m.servicio.fijarActivo(true);
    await m.servicio.nocturno(m.carpeta);
    const bytes = (m.destino as DestinoMemoria).archivos.get("lean-os-2026-03-10.json.enc")!;
    const vacio = abrirBase(":memory:", m.e.reloj);
    const conteos = await restaurarDesdeBytes(vacio, bytes, { clave: CLAVES.clave });
    expect(conteos).toEqual(contarTodo(m.db));
    expect(conteos.tarjetas).toBe(3);
    expect(conteos.tareas).toBe(1);
    expect(conteos.apuntes).toBeGreaterThanOrEqual(1);
    // Con servidor con datos se niega, igual que con un .json.
    await expect(restaurarDesdeBytes(vacio, bytes, { clave: CLAVES.clave })).rejects.toThrow(/ya tiene datos/);
  });

  it("O3: con una clave equivocada no restaura nada y avisa", async () => {
    const m = await montar();
    const bytes = await cifrarRespaldo(JSON.stringify(exportarTodo(m.db, m.e.reloj)), CLAVES.clave);
    const vacio = abrirBase(":memory:", m.e.reloj);
    await expect(restaurarDesdeBytes(vacio, bytes, { clave: "otra-clave" })).rejects.toThrow(/clave.*incorrecta/);
    await expect(restaurarDesdeBytes(vacio, bytes, {})).rejects.toBeInstanceOf(ErrorDescifrado);
    expect(Object.values(contarTodo(vacio)).every((n) => n === 0)).toBe(true);
    // Archivo dañado: tampoco restaura.
    const roto = Uint8Array.from(bytes);
    roto[roto.length - 1] = roto[roto.length - 1]! ^ 1;
    await expect(descifrarRespaldo(roto, CLAVES.clave)).rejects.toBeInstanceOf(ErrorDescifrado);
    expect(Object.values(contarTodo(vacio)).every((n) => n === 0)).toBe(true);
  });

  it("O3: el script restaurar.ts abre un .enc con RESPALDO_CLAVE y se niega con otra clave", async () => {
    const { spawnSync } = await import("node:child_process");
    const { writeFileSync } = await import("node:fs");
    const m = await montar();
    const bytes = await cifrarRespaldo(JSON.stringify(exportarTodo(m.db, m.e.reloj)), CLAVES.clave);
    const dir = mkdtempSync(join(tmpdir(), "rest-enc-"));
    const archivo = join(dir, "lean-os-2026-03-10.json.enc");
    writeFileSync(archivo, bytes);
    const correr = (clave: string, datos: string) =>
      spawnSync(process.execPath, [join(import.meta.dirname, "..", "scripts", "restaurar.ts"), archivo], {
        env: { ...process.env, RESPALDO_CLAVE: clave, DATA_DIR: datos }, encoding: "utf8",
      });
    const mala = correr("clave-mala", join(dir, "datos-mala"));
    expect(mala.status).toBe(1);
    expect(mala.stderr).toMatch(/incorrecta/);
    expect(mala.stderr + mala.stdout).not.toContain("clave-mala");
    const buena = correr(CLAVES.clave, join(dir, "datos-buena"));
    expect(buena.status, buena.stderr).toBe(0);
    expect(buena.stdout).toContain("tarjetas=3");
  }, 30_000);
});

describe("O4: sin claves o con destino que falla", () => {
  it("O4: activado sin claves: el local se hace, nada se rompe y se informa 'falta configurar'", async () => {
    const m = await montar(null);
    m.servicio.fijarActivo(true);
    await m.servicio.nocturno(m.carpeta);
    expect(readdirSync(m.carpeta).filter((f) => f.endsWith(".json"))).toHaveLength(1);
    expect((m.destino as DestinoMemoria).llamadas).toBe(0);
    const u = m.servicio.ultimoResultado()!;
    expect(u.ok).toBe(false);
    expect(u.mensaje).toMatch(/Falta configurar/);
    const login = await m.app.request("/ajustes/respaldo-externo", { headers: await token(m.app) });
    expect(await login.json()).toMatchObject({ activo: true, configurado: false });
    await m.c.motor.sincronizarAhora();
    expect(m.c.motor.estado().fase).toBe("sincronizado");
  });

  it("O4: destino que falla: el nocturno no lanza, el local queda y el mensaje está en castellano sin claves", async () => {
    const roto: DestinoRespaldo = {
      subir: async () => { throw new Error(`falló con ${CLAVES.b2AppKey} y ${CLAVES.clave}`); },
      listar: async () => [], borrar: async () => {},
    };
    const lineas: string[] = [];
    const m = await montar(CLAVES, roto, { registrar: (l) => lineas.push(l) });
    m.servicio.fijarActivo(true);
    await expect(m.servicio.nocturno(m.carpeta)).resolves.toBeUndefined();
    expect(readdirSync(m.carpeta).filter((f) => f.endsWith(".json"))).toHaveLength(1);
    const u = m.servicio.ultimoResultado()!;
    expect(u).toMatchObject({ ok: false });
    expect(u.mensaje).toMatch(/No se pudo subir/);
    for (const prohibido of [CLAVES.b2AppKey, CLAVES.clave, CLAVES.b2KeyId, TAREA]) {
      expect(u.mensaje).not.toContain(prohibido);
      expect(lineas.join("\n")).not.toContain(prohibido);
    }
  });

  it("O4: un destino que no responde se corta por tiempo y el nocturno termina", async () => {
    const colgado: DestinoRespaldo = { subir: () => new Promise(() => {}), listar: async () => [], borrar: async () => {} };
    const m = await montar(CLAVES, colgado, { tiempoMaximoMs: 40 });
    m.servicio.fijarActivo(true);
    await m.servicio.nocturno(m.carpeta);
    expect(m.servicio.ultimoResultado()).toMatchObject({ ok: false });
    expect(m.servicio.ultimoResultado()!.mensaje).toMatch(/no respondió/);
    expect(readdirSync(m.carpeta).filter((f) => f.endsWith(".json"))).toHaveLength(1);
  });

  it("O4: las variables ausentes dejan el respaldo sin configurar, sin error", () => {
    expect(leerClavesRespaldo({})).toBeNull();
    expect(leerClavesRespaldo({ B2_KEY_ID: "a", B2_APP_KEY: "b", B2_BUCKET: "c" })).toBeNull();
    expect(leerClavesRespaldo({ B2_KEY_ID: "a", B2_APP_KEY: "b", B2_BUCKET: "c", RESPALDO_CLAVE: "d" })).toEqual({ b2KeyId: "a", b2AppKey: "b", b2Bucket: "c", clave: "d" });
  });
});

describe("O5: retención de 30", () => {
  it("O5: tras más de 30 días simulados quedan solo los últimos 30", async () => {
    const m = await montar();
    m.servicio.fijarActivo(true);
    const nombres: string[] = [];
    for (let i = 0; i < 40; i++) {
      await m.servicio.nocturno(m.carpeta);
      nombres.push(`lean-os-${new Date(m.e.reloj.ahora().getTime() - 3 * 3_600_000).toISOString().slice(0, 10)}.json.enc`);
      m.e.reloj.avanzarDias(1);
    }
    const quedan = [...(m.destino as DestinoMemoria).archivos.keys()].sort();
    expect(quedan).toEqual(nombres.slice(10).sort());
    expect(quedan).toHaveLength(30);
  }, 60_000);

  it("O5: no toca archivos ajenos al formato de Lean OS", async () => {
    const d = new DestinoMemoria();
    for (let i = 1; i <= 35; i++) d.archivos.set(`lean-os-2026-01-${String(i).padStart(2, "0")}.json.enc`, new Uint8Array());
    d.archivos.set("lean-os-notas.txt", new Uint8Array());
    const m = await montar(CLAVES, d);
    m.servicio.fijarActivo(true);
    await m.servicio.subirAhora();
    expect(d.archivos.has("lean-os-notas.txt")).toBe(true);
    expect([...d.archivos.keys()].filter((n) => n.endsWith(".json.enc"))).toHaveLength(30);
  });
});

describe("O6: ajuste por la API, sesión y registros", () => {
  it("O6: activar y desactivar se guarda en el servidor y exige sesión", async () => {
    const m = await montar();
    for (const [metodo, ruta] of [["GET", ""], ["PUT", ""], ["POST", "/probar"]] as const) {
      const r = await m.app.request(`/ajustes/respaldo-externo${ruta}`, metodo === "PUT" ? { method: metodo, body: JSON.stringify({ activo: true }) } : { method: metodo });
      expect(r.status, `${metodo} ${ruta}`).toBe(401);
    }
    expect(m.servicio.activo()).toBe(false);
    const h = await token(m.app);
    const leer = async () => (await (await m.app.request("/ajustes/respaldo-externo", { headers: h })).json()) as Record<string, unknown>;
    expect(await leer()).toEqual({ activo: false, configurado: true, ultimo_resultado: null });
    expect((await m.app.request("/ajustes/respaldo-externo", { method: "PUT", headers: h, body: JSON.stringify({ activo: true }) })).status).toBe(200);
    expect(await leer()).toMatchObject({ activo: true });
    expect((await m.app.request("/ajustes/respaldo-externo", { method: "PUT", headers: h, body: JSON.stringify({ activo: "si" }) })).status).toBe(400);
    expect((await m.app.request("/ajustes/respaldo-externo", { method: "PUT", headers: h, body: "no json" })).status).toBe(400);
    // Persiste en la base (tabla ajustes_servidor).
    const fila = m.db.prepare("SELECT valor FROM ajustes_servidor WHERE clave = 'respaldo_externo_activo'").get() as { valor: string };
    expect(fila.valor).toBe("true");
    const p = await m.app.request("/ajustes/respaldo-externo/probar", { method: "POST", headers: h });
    expect(p.status).toBe(200);
    expect(await p.json()).toMatchObject({ ok: true });
    expect((m.destino as DestinoMemoria).archivos.size).toBe(1);
    await m.app.request("/ajustes/respaldo-externo", { method: "PUT", headers: h, body: JSON.stringify({ activo: false }) });
    expect((await m.app.request("/ajustes/respaldo-externo/probar", { method: "POST", headers: h })).status).toBe(409);
    expect((m.destino as DestinoMemoria).archivos.size).toBe(1);
  });

  it("O6: ni las respuestas ni los registros de una corrida contienen claves ni contenido", async () => {
    const lineas: string[] = [];
    for (const k of ["log", "info", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation((...a) => void lineas.push(a.join(" ")));
    const m = await montar(CLAVES, new DestinoMemoria(), { registrar: (l) => lineas.push(l) });
    const h = await token(m.app);
    const respuestas: string[] = [];
    respuestas.push(await (await m.app.request("/ajustes/respaldo-externo", { method: "PUT", headers: h, body: JSON.stringify({ activo: true }) })).text());
    respuestas.push(await (await m.app.request("/ajustes/respaldo-externo/probar", { method: "POST", headers: h })).text());
    respuestas.push(await (await m.app.request("/ajustes/respaldo-externo", { headers: h })).text());
    await m.servicio.nocturno(m.carpeta);
    const todo = [...lineas, ...respuestas].join("\n");
    expect(lineas.length).toBeGreaterThan(0);
    for (const prohibido of [CLAVES.b2KeyId, CLAVES.b2AppKey, CLAVES.clave, CLAVES.b2Bucket, TAREA, APUNTE, TARJETA]) expect(todo.includes(prohibido), prohibido).toBe(false);
  });

  async function abrirUI(m: Awaited<ReturnType<typeof montar>>, conSesion: boolean) {
    const c = m.c;
    if (!conSesion) await c.motor.cerrarSesion();
    const ventana = new Window({ url: "http://localhost/" });
    const raiz = ventana.document.createElement("div");
    ventana.document.body.append(raiz);
    const app = montarApp(raiz as unknown as HTMLElement, { almacen: c.almacen, reloj: m.e.reloj, persistencia: c.persistencia, sync: c.motor });
    app.ir("ajustes");
    await app.esperar();
    const quieto = async () => { await c.motor.esperar(); await new Promise((r) => setTimeout(r, 0)); await app.esperar(); };
    return { raiz, ventana, doc: ventana.document, quieto, app };
  }

  it("O6: en Ajustes, sin sesión dice 'Iniciá sesión para configurarlo' y no llama al servidor", async () => {
    const m = await montar();
    const antes = m.e.llamadas.length;
    const ui = await abrirUI(m, false);
    expect(ui.raiz.textContent).toContain("Respaldo externo (opcional)");
    expect(ui.raiz.textContent).toContain("CIFRADA");
    expect(ui.raiz.textContent).toContain("no sale nada");
    expect(ui.raiz.textContent).toContain("Iniciá sesión para configurarlo");
    expect(ui.doc.querySelector("#externo-activo")).toBeNull();
    expect(m.e.llamadas.slice(antes).filter((l) => l.includes("/ajustes"))).toEqual([]);
  });

  it("O6: en Ajustes con sesión se activa, se respalda ahora y se ve el estado y el último resultado", async () => {
    const m = await montar();
    const ui = await abrirUI(m, true);
    expect(ui.doc.querySelector("#externo-estado")?.textContent).toContain("desactivado");
    const boton = () => [...ui.doc.querySelectorAll("button")].find((b) => b.textContent === "Respaldar ahora")!;
    expect(boton().hasAttribute("disabled")).toBe(true);
    const interruptor = ui.doc.querySelector("#externo-activo") as unknown as HTMLInputElement;
    interruptor.checked = true;
    interruptor.dispatchEvent(new ui.ventana.Event("change", { bubbles: true }) as unknown as Event);
    await ui.quieto();
    expect(m.servicio.activo()).toBe(true);
    expect(ui.doc.querySelector("#externo-estado")?.textContent).toContain("activo");
    expect(boton().hasAttribute("disabled")).toBe(false);
    boton().click();
    await ui.quieto();
    expect((m.destino as DestinoMemoria).archivos.size).toBe(1);
    expect(ui.doc.querySelector("#externo-ultimo")?.textContent).toContain("Se subió el respaldo externo cifrado");
    // Desactivar de nuevo.
    const otro = ui.doc.querySelector("#externo-activo") as unknown as HTMLInputElement;
    otro.checked = false;
    otro.dispatchEvent(new ui.ventana.Event("change", { bubbles: true }) as unknown as Event);
    await ui.quieto();
    expect(m.servicio.activo()).toBe(false);
    expect(ui.doc.querySelector("#externo-estado")?.textContent).toContain("desactivado");
  });

  it("O6: en Ajustes, activado sin claves muestra 'falta configurar'", async () => {
    const m = await montar(null);
    m.servicio.fijarActivo(true);
    const ui = await abrirUI(m, true);
    expect(ui.doc.querySelector("#externo-estado")?.textContent).toContain("falta configurar");
  });
});
