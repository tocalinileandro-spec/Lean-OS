import "fake-indexeddb/auto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { montarApp } from "../src/cliente/ui/app.ts";
import { fijarHoraCambio } from "../src/compartido/dia.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { crearApp } from "../src/servidor/app.ts";
import { abrirBase } from "../src/servidor/base.ts";
import { leerConfig } from "../src/servidor/config.ts";
import { AUDIO_MAXIMO_BYTES, ErrorProveedor, MODELO_GROQ, ProveedorGroq, ServicioAudio, URL_GROQ } from "../src/servidor/audio.ts";
import type { ProveedorTranscripcion } from "../src/servidor/audio.ts";
import { PREFIJOS_API } from "../src/cliente/sw-logica.ts";
import { CLAVE, Entorno, hashDePrueba } from "./ayuda-sync.ts";

afterEach(() => {
  fijarHoraCambio();
  vi.restoreAllMocks();
});

const CLAVE_GROQ = "clave-groq-de-prueba-777";
const TEXTO = "idea dictada sobre molinos de viento";

/** Proveedor simulado: cuenta las llamadas y puede fallar. Si lo tocan estando desactivado, la prueba lo ve. */
class ProveedorSim implements ProveedorTranscripcion {
  llamadas: { bytes: Uint8Array; tipo: string }[] = [];
  falla: Error | null = null;
  texto = TEXTO;
  async transcribir(bytes: Uint8Array, tipo: string): Promise<string> {
    this.llamadas.push({ bytes, tipo });
    if (this.falla) throw this.falla;
    return this.texto;
  }
}

async function montar(opciones: { hayClave?: boolean; activo?: boolean; proveedor?: ProveedorTranscripcion | null; registrar?: (l: string) => void; base?: DatabaseSync } = {}) {
  const e = await Entorno.crear();
  const proveedor = opciones.proveedor === undefined ? new ProveedorSim() : opciones.proveedor;
  const db = opciones.base ?? e.servidor.db;
  const audio = new ServicioAudio({ db, hayClave: opciones.hayClave ?? true, proveedor });
  if (opciones.activo) audio.fijarActivo(true);
  const app = crearApp({ reloj: e.reloj, base: db, secretos: { passwordHash: await hashDePrueba(), sessionSecret: "s" }, registrar: opciones.registrar ?? (() => {}), audio });
  e.servidor = { app, db };
  const c = e.cliente();
  const r = await c.motor.iniciarSesion(CLAVE);
  if (!r.ok) throw new Error(r.mensaje);
  await c.motor.esperar();
  return { e, c, db, audio, app, proveedor: proveedor as ProveedorSim };
}
type M = Awaited<ReturnType<typeof montar>>;

async function cabeceras(app: ReturnType<typeof crearApp>): Promise<Record<string, string>> {
  const r = await app.request("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: CLAVE }) });
  return { authorization: `Bearer ${((await r.json()) as { token: string }).token}` };
}
const enviar = (m: M, h: Record<string, string>, bytes: Uint8Array | string = "AUDIO", tipo = "audio/webm") =>
  m.app.request("/audio/transcribir", { method: "POST", headers: { ...h, "content-type": tipo }, body: bytes as BodyInit });

// ---------- simulación del navegador ----------
class GrabadoraFalsa {
  static ultima: GrabadoraFalsa | null = null;
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  #l = new Map<string, ((ev: unknown) => void)[]>();
  constructor(public flujo: unknown) { GrabadoraFalsa.ultima = this; }
  addEventListener(t: string, f: (ev: unknown) => void) { this.#l.set(t, [...(this.#l.get(t) ?? []), f]); }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    for (const f of this.#l.get("dataavailable") ?? []) f({ data: new Blob(["sonido-simulado"], { type: "audio/webm" }) });
    for (const f of this.#l.get("stop") ?? []) f({});
  }
}

async function abrirCaptura(m: M, opciones: { micro?: "ok" | "negado" | "ninguno" } = {}) {
  const ventana = new Window({ url: "http://localhost/" });
  const w = ventana as unknown as Record<string, unknown>;
  const pistas = { detenidas: 0 };
  const micro = opciones.micro ?? "ok";
  if (micro !== "ninguno") {
    w["MediaRecorder"] = GrabadoraFalsa;
    Object.defineProperty(ventana.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => { if (micro === "negado") throw new Error("NotAllowedError"); return { getTracks: () => [{ stop: () => { pistas.detenidas++; } }] }; } },
    });
  }
  const raiz = ventana.document.createElement("div");
  ventana.document.body.append(raiz);
  const app = montarApp(raiz as unknown as HTMLElement, { almacen: m.c.almacen, reloj: m.e.reloj, persistencia: m.c.persistencia, sync: m.c.motor }, "apuntes");
  const quieto = async () => { await m.c.motor.esperar(); await new Promise((r) => setTimeout(r, 0)); await app.esperar(); await new Promise((r) => setTimeout(r, 0)); await app.esperar(); };
  const doc = ventana.document;
  const boton = (texto: string) => [...doc.querySelectorAll("button")].find((b) => b.textContent === texto) as unknown as HTMLButtonElement | undefined;
  const abrir = async () => { await quieto(); boton("Nuevo apunte")!.click(); await quieto(); };
  const caja = () => doc.querySelector("#captura-texto") as unknown as HTMLTextAreaElement;
  const escribir = (t: string) => { caja().value = t; caja().dispatchEvent(new ventana.Event("input", { bubbles: true }) as unknown as Event); };
  return { ventana, doc, app, quieto, boton, abrir, caja, escribir, pistas, raiz };
}
const apuntes = async (m: M) => (await m.c.crudo.apuntes.listar()).length;

describe("O7: audio desactivado", () => {
  it("O7: desactivado el servidor responde 403, no toca al proveedor ni a la red y la UI no muestra el micrófono", async () => {
    const red = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("O7: se usó la red"); });
    const m = await montar({ activo: false });
    expect(m.audio.activo()).toBe(false);
    const h = await cabeceras(m.app);
    const r = await enviar(m, h);
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toMatch(/desactivad/);
    expect(m.proveedor.llamadas).toHaveLength(0);
    // Sin el servicio inyectado también queda desactivado.
    const e = await Entorno.crear();
    const h2 = await cabeceras(e.servidor.app);
    expect((await e.servidor.app.request("/audio/transcribir", { method: "POST", headers: { ...h2, "content-type": "audio/webm" }, body: "x" })).status).toBe(403);
    const ui = await abrirCaptura(m);
    await ui.abrir();
    expect(ui.caja()).not.toBeNull();
    expect(ui.doc.querySelector("#captura-mic")).toBeNull();
    expect(ui.doc.querySelector("#captura-parar")).toBeNull();
    expect(m.proveedor.llamadas).toHaveLength(0);
    expect(red).not.toHaveBeenCalled();
  });
});

describe("O8: audio activado, texto en la caja sin guardarse solo", () => {
  it("O8: graba, transcribe con el proveedor simulado, agrega el texto sin pisar lo escrito y solo Guardar crea el apunte", async () => {
    const m = await montar({ activo: true });
    const ui = await abrirCaptura(m);
    await ui.abrir();
    expect(ui.doc.querySelector("#captura-mic")).not.toBeNull();
    expect(ui.doc.querySelector("#captura-mic")!.hasAttribute("disabled")).toBe(false);
    ui.escribir("ya escrito");
    ui.boton("Micrófono")!.click();
    await ui.quieto();
    expect(ui.doc.querySelector("#audio-estado")?.textContent).toContain("Grabando");
    ui.boton("Parar")!.click();
    await ui.quieto();
    expect(m.proveedor.llamadas).toHaveLength(1);
    expect(m.proveedor.llamadas[0]!.tipo).toBe("audio/webm");
    expect(Buffer.from(m.proveedor.llamadas[0]!.bytes).toString()).toBe("sonido-simulado");
    expect(ui.caja().value).toBe(`ya escrito\n${TEXTO}`);
    expect(ui.pistas.detenidas).toBe(1);
    expect(await apuntes(m)).toBe(0);
    await m.c.motor.sincronizarAhora();
    expect((m.db.prepare("SELECT COUNT(*) AS n FROM apuntes").get() as { n: number }).n).toBe(0);
    ui.boton("Guardar apunte")!.click();
    await ui.quieto();
    const lista = await m.c.crudo.apuntes.listar();
    expect(lista).toHaveLength(1);
    expect(lista[0]!.texto).toBe(`ya escrito\n${TEXTO}`);
  });

  it("O8: el tope de 2 minutos corta la grabación y transcribe lo grabado", async () => {
    const real = globalThis.setTimeout;
    const topes: (() => void)[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((f: () => void, ms?: number, ...resto: unknown[]) => {
      if (ms === 120_000) { topes.push(f); return 0 as unknown as ReturnType<typeof setTimeout>; }
      return (real as (...a: unknown[]) => unknown)(f, ms, ...resto) as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);
    const m = await montar({ activo: true });
    const ui = await abrirCaptura(m);
    await ui.abrir();
    ui.boton("Micrófono")!.click();
    await ui.quieto();
    expect(GrabadoraFalsa.ultima!.state).toBe("recording");
    expect(topes).toHaveLength(1);
    topes[0]!();
    await ui.quieto();
    expect(GrabadoraFalsa.ultima!.state).toBe("inactive");
    expect(m.proveedor.llamadas).toHaveLength(1);
    expect(ui.caja().value).toBe(TEXTO);
  });

  it("O8: sin soporte de MediaRecorder o con el permiso negado hay mensaje claro y la captura por texto sigue", async () => {
    for (const micro of ["ninguno", "negado"] as const) {
      const m = await montar({ activo: true });
      const ui = await abrirCaptura(m, { micro });
      await ui.abrir();
      ui.escribir("sigo escribiendo");
      ui.boton("Micrófono")!.click();
      await ui.quieto();
      expect(ui.doc.querySelector("#audio-estado")?.textContent, micro).toMatch(/navegador|micrófono/);
      expect(ui.caja().value).toBe("sigo escribiendo");
      expect(m.proveedor.llamadas).toHaveLength(0);
      ui.boton("Guardar apunte")!.click();
      await ui.quieto();
      expect(await apuntes(m)).toBe(1);
    }
  });
});

describe("O9: sin clave, sin sesión o sin conexión", () => {
  it("O9: sin clave 409 'falta configurar' y sin sesión 401 en las dos rutas", async () => {
    const m = await montar({ activo: true, hayClave: false, proveedor: null });
    const h = await cabeceras(m.app);
    const r = await enviar(m, h);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toContain("Falta configurar");
    for (const [metodo, ruta] of [["POST", "/audio/transcribir"], ["GET", "/ajustes/audio"], ["PUT", "/ajustes/audio"]] as const) {
      const sin = await m.app.request(ruta, { method: metodo, headers: { "content-type": "audio/webm" }, ...(metodo === "GET" ? {} : { body: "x" }) });
      expect(sin.status, ruta).toBe(401);
      const mala = await m.app.request(ruta, { method: metodo, headers: { authorization: "Bearer inventado", "content-type": "audio/webm" }, ...(metodo === "GET" ? {} : { body: "x" }) });
      expect(mala.status, ruta).toBe(401);
    }
  });

  it("O9: en la UI, falta configurar, sin conexión e iniciá sesión: botón deshabilitado con el motivo y la captura por texto sigue", async () => {
    const m = await montar({ activo: true, hayClave: false, proveedor: null });
    let ui = await abrirCaptura(m);
    await ui.abrir();
    expect(ui.doc.querySelector("#captura-mic")!.hasAttribute("disabled")).toBe(true);
    expect(ui.doc.querySelector("#audio-estado")?.textContent).toContain("Falta configurar");

    // Sin conexión (el estado ya consultado queda en memoria; al reabrir la captura la consulta falla).
    const m2 = await montar({ activo: true });
    ui = await abrirCaptura(m2);
    await ui.abrir();
    expect(ui.doc.querySelector("#captura-mic")!.hasAttribute("disabled")).toBe(false);
    ui.boton("Cancelar")!.click();
    await ui.quieto();
    m2.e.red = false;
    ui.boton("Nuevo apunte")!.click();
    await ui.quieto();
    expect(ui.doc.querySelector("#captura-mic")!.hasAttribute("disabled")).toBe(true);
    expect(ui.doc.querySelector("#audio-estado")?.textContent).toContain("Sin conexión");
    ui.escribir("escrito sin red");
    ui.boton("Guardar apunte")!.click();
    await ui.quieto();
    expect((await m2.c.crudo.apuntes.listar()).map((a) => a.texto)).toEqual(["escrito sin red"]);

    // Sin sesión.
    const m3 = await montar({ activo: true });
    ui = await abrirCaptura(m3);
    await ui.abrir();
    ui.boton("Cancelar")!.click();
    await ui.quieto();
    await m3.c.motor.cerrarSesion();
    ui.boton("Nuevo apunte")!.click();
    await ui.quieto();
    expect(ui.doc.querySelector("#captura-mic")!.hasAttribute("disabled")).toBe(true);
    expect(ui.doc.querySelector("#audio-estado")?.textContent).toContain("Iniciá sesión");
    ui.escribir("sin sesión");
    ui.boton("Guardar apunte")!.click();
    await ui.quieto();
    expect(await apuntes(m3)).toBe(1);
  });

  it("O9: si la red se cae durante la transcripción, hay mensaje y lo escrito no se pierde", async () => {
    const m = await montar({ activo: true });
    const ui = await abrirCaptura(m);
    await ui.abrir();
    ui.escribir("no me pierdas");
    ui.boton("Micrófono")!.click();
    await ui.quieto();
    m.e.red = false;
    ui.boton("Parar")!.click();
    await ui.quieto();
    expect(ui.doc.querySelector("#audio-estado")?.textContent).toContain("Sin conexión");
    expect(ui.caja().value).toBe("no me pierdas");
  });
});

describe("O10: el audio no se guarda y los excesos se rechazan", () => {
  it("O10: no queda audio en disco, en la base ni en los registros", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audio-o10-"));
    const lineas: string[] = [];
    for (const k of ["log", "info", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation((...a) => void lineas.push(a.join(" ")));
    const reloj = new RelojSimulado("2026-03-10T12:00:00.000Z");
    const base = abrirBase(join(dir, "lean-os.sqlite"), reloj);
    const m = await montar({ activo: true, base, registrar: (l) => lineas.push(l) });
    const tablas = () => (base.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name).sort();
    const contenido = () => JSON.stringify(Object.fromEntries(tablas().map((t) => [t, base.prepare(`SELECT * FROM ${t}`).all().map((f) => JSON.stringify(f, (_k, v) => (typeof v === "bigint" ? String(v) : v)))])));
    const archivos = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? archivos(join(d, n)) : [join(d, n)]));
    const h = await cabeceras(m.app);
    const antes = contenido();
    const listaAntes = archivos(dir).sort();
    const MARCA = "MARCA-DE-AUDIO-UNICA-9f3a";
    const r = await enviar(m, h, new TextEncoder().encode(MARCA.repeat(50)));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { texto: string }).texto).toBe(TEXTO);
    expect(contenido()).toBe(antes);
    expect(contenido()).not.toContain(MARCA);
    expect(archivos(dir).sort()).toEqual(listaAntes);
    for (const a of archivos(dir)) expect(readFileSync(a).includes(Buffer.from(MARCA)), a).toBe(false);
    expect(lineas.length).toBeGreaterThan(0);
    expect(lineas.join("\n")).not.toContain(MARCA);
    expect(lineas.join("\n")).not.toContain(TEXTO);
    expect(lineas.some((l) => l.includes("POST /audio/transcribir 200"))).toBe(true);
    base.close();
  });

  it("O10: más de 10 MB da 413 y un tipo no permitido 415, ambos en castellano y sin llamar al proveedor", async () => {
    const m = await montar({ activo: true });
    const h = await cabeceras(m.app);
    const grande = await enviar(m, h, new Uint8Array(AUDIO_MAXIMO_BYTES + 1));
    expect(grande.status).toBe(413);
    expect(((await grande.json()) as { error: string }).error).toMatch(/demasiado grande/);
    const justo = await enviar(m, h, new Uint8Array(AUDIO_MAXIMO_BYTES));
    expect(justo.status).toBe(200);
    m.proveedor.llamadas.length = 0;
    for (const tipo of ["application/json", "text/plain", "audio/x-raro", "image/png"]) {
      const r = await enviar(m, h, "x", tipo);
      expect(r.status, tipo).toBe(415);
      expect(((await r.json()) as { error: string }).error).toMatch(/tipo de audio/);
    }
    for (const tipo of ["audio/webm;codecs=opus", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"]) expect((await enviar(m, h, "x", tipo)).status, tipo).toBe(200);
    expect((await enviar(m, h, "")).status).toBe(400);
    expect(m.proveedor.llamadas).toHaveLength(5 + 0);
  });
});

describe("O11: el proveedor falla", () => {
  it("O11: cuota, tiempo y fallo dan 429, 504 y 502 con mensaje en castellano sin datos del proveedor", async () => {
    const m = await montar({ activo: true });
    const h = await cabeceras(m.app);
    const casos: [Error, number, RegExp][] = [
      [new ErrorProveedor("cuota"), 429, /cuota/],
      [new ErrorProveedor("tiempo"), 504, /tardó demasiado/],
      [new ErrorProveedor("fallo"), 502, /No se pudo transcribir/],
      [new Error(`respuesta rara con ${CLAVE_GROQ} adentro`), 502, /No se pudo transcribir/],
    ];
    for (const [error, estado, patron] of casos) {
      m.proveedor.falla = error;
      const r = await enviar(m, h);
      expect(r.status).toBe(estado);
      const texto = await r.text();
      expect(texto).toMatch(patron);
      expect(texto).not.toContain(CLAVE_GROQ);
    }
  });

  it("O11: el proveedor real (con fetch simulado) arma el pedido de Groq y traduce 429, errores y tiempo agotado", async () => {
    const pedidos: { url: string; auth: string | null; campos: Record<string, string>; archivo: string }[] = [];
    const responder = (res: () => Response | Promise<Response>): typeof fetch => (async (url: string, init?: RequestInit) => {
      const form = init!.body as FormData;
      pedidos.push({ url, auth: new Headers(init!.headers).get("authorization"), archivo: (form.get("file") as File).name, campos: { model: String(form.get("model")), language: String(form.get("language")), response_format: String(form.get("response_format")) } });
      return res();
    }) as unknown as typeof fetch;
    const ok = new ProveedorGroq(CLAVE_GROQ, { fetch: responder(() => new Response(JSON.stringify({ text: "  hola mundo  " }), { status: 200 })) });
    expect(await ok.transcribir(new Uint8Array([1, 2, 3]), "audio/ogg")).toBe("hola mundo");
    expect(pedidos[0]).toEqual({ url: URL_GROQ, auth: `Bearer ${CLAVE_GROQ}`, archivo: "audio.ogg", campos: { model: MODELO_GROQ, language: "es", response_format: "json" } });
    const motivo = async (p: ProveedorGroq) => { try { await p.transcribir(new Uint8Array([1]), "audio/webm"); return "ok"; } catch (e) { expect((e as Error).message).not.toContain(CLAVE_GROQ); return (e as ErrorProveedor).motivo; } };
    expect(await motivo(new ProveedorGroq(CLAVE_GROQ, { fetch: responder(() => new Response("cuota", { status: 429 })) }))).toBe("cuota");
    expect(await motivo(new ProveedorGroq(CLAVE_GROQ, { fetch: responder(() => new Response(`error con ${CLAVE_GROQ}`, { status: 500 })) }))).toBe("fallo");
    expect(await motivo(new ProveedorGroq(CLAVE_GROQ, { fetch: responder(() => new Response("{}", { status: 200 })) }))).toBe("fallo");
    expect(await motivo(new ProveedorGroq(CLAVE_GROQ, { fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch }))).toBe("fallo");
    const colgado = (async (_u: string, init?: RequestInit) => new Promise((_r, rechazar) => init!.signal!.addEventListener("abort", () => rechazar(init!.signal!.reason)))) as unknown as typeof fetch;
    expect(await motivo(new ProveedorGroq(CLAVE_GROQ, { fetch: colgado, tiempoMs: 20 }))).toBe("tiempo");
  });

  it("O11: en la UI el error se muestra en castellano, lo escrito no se pierde y la sincronización sigue", async () => {
    const m = await montar({ activo: true });
    const ui = await abrirCaptura(m);
    await ui.abrir();
    ui.escribir("texto que no se pierde");
    m.proveedor.falla = new ErrorProveedor("cuota");
    ui.boton("Micrófono")!.click();
    await ui.quieto();
    ui.boton("Parar")!.click();
    await ui.quieto();
    expect(ui.doc.querySelector("#audio-estado")?.textContent).toMatch(/cuota/);
    expect(ui.caja().value).toBe("texto que no se pierde");
    expect(await apuntes(m)).toBe(0);
    ui.boton("Guardar apunte")!.click();
    await ui.quieto();
    await m.c.motor.sincronizarAhora();
    expect((m.db.prepare("SELECT COUNT(*) AS n FROM apuntes").get() as { n: number }).n).toBe(1);
    expect(m.c.motor.estado().fase).not.toBe("error");
  });
});

describe("O12: activar y desactivar, y la clave no se filtra", () => {
  it("O12: GET y PUT /ajustes/audio guardan el estado en el servidor, exigen sesión y no devuelven la clave", async () => {
    const lineas: string[] = [];
    for (const k of ["log", "info", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation((...a) => void lineas.push(a.join(" ")));
    const m = await montar({ registrar: (l) => lineas.push(l) });
    const h = { ...(await cabeceras(m.app)), "content-type": "application/json" };
    const cuerpos: string[] = [];
    const leer = async (r: Response) => { const t = await r.text(); cuerpos.push(t); return JSON.parse(t) as { activo: boolean; configurado: boolean }; };
    expect(await leer(await m.app.request("/ajustes/audio", { headers: h }))).toEqual({ activo: false, configurado: true });
    const r = await m.app.request("/ajustes/audio", { method: "PUT", headers: h, body: JSON.stringify({ activo: true }) });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await leer(r)).toEqual({ activo: true, configurado: true });
    // El estado vive en el servidor: otro servicio sobre la misma base lo ve.
    expect(new ServicioAudio({ db: m.db, hayClave: true, proveedor: null }).activo()).toBe(true);
    expect((await m.app.request("/ajustes/audio", { method: "PUT", headers: h, body: JSON.stringify({ activo: "si" }) })).status).toBe(400);
    expect(await leer(await m.app.request("/ajustes/audio", { method: "PUT", headers: h, body: JSON.stringify({ activo: false }) }))).toEqual({ activo: false, configurado: true });
    expect(m.audio.activo()).toBe(false);
    await enviar(m, h);
    const todo = [...cuerpos, ...lineas].join("\n");
    expect(todo).not.toContain(CLAVE_GROQ);
    expect(lineas.length).toBeGreaterThan(0);
  });

  it("O12: la clave de Groq solo viene del entorno del servidor: ausente no es un error y el valor no se imprime", async () => {
    const avisos: string[] = [];
    const sin = await leerConfig({ NODE_ENV: "development" }, (a) => avisos.push(a));
    expect(sin.groqApiKey).toBeNull();
    const con = await leerConfig({ NODE_ENV: "development", GROQ_API_KEY: CLAVE_GROQ }, (a) => avisos.push(a));
    expect(con.groqApiKey).toBe(CLAVE_GROQ);
    expect(avisos.join("\n")).not.toContain(CLAVE_GROQ);
    const e = await Entorno.crear();
    const h = await cabeceras(e.servidor.app);
    const r = await e.servidor.app.request("/ajustes/audio", { headers: h });
    expect(await r.json()).toEqual({ activo: false, configurado: false });
  });

  it("O12: el código del cliente no contiene la clave ni el endpoint del proveedor", () => {
    const bundle = join(process.cwd(), "dist", "app.js");
    expect(existsSync(bundle), "falta dist/app.js: corré npm run build").toBe(true);
    const codigo = readFileSync(bundle, "utf8");
    expect(codigo).not.toContain(CLAVE_GROQ);
    expect(codigo).not.toContain("GROQ_API_KEY");
    expect(codigo).not.toContain("api.groq.com");
    expect(codigo).toContain("/audio/transcribir");
  });

  it("O12: /audio nunca se cachea (service worker) y la CSP no abre dominios externos", () => {
    expect(PREFIJOS_API).toContain("/audio");
    const html = readFileSync(join(process.cwd(), "src", "cliente", "index.html"), "utf8");
    expect(html).toContain("connect-src 'self'");
    expect(html).not.toMatch(/https?:\/\/[^"' ]*groq/);
  });

  it("O12: en Ajustes, sin sesión pide iniciar sesión; con sesión muestra el aviso y activa y desactiva", async () => {
    const m = await montar();
    const abrir = async (conSesion: boolean) => {
      if (!conSesion) await m.c.motor.cerrarSesion();
      const ventana = new Window({ url: "http://localhost/" });
      const raiz = ventana.document.createElement("div");
      ventana.document.body.append(raiz);
      const app = montarApp(raiz as unknown as HTMLElement, { almacen: m.c.almacen, reloj: m.e.reloj, persistencia: m.c.persistencia, sync: m.c.motor });
      app.ir("ajustes");
      await app.esperar();
      const quieto = async () => { await m.c.motor.esperar(); await new Promise((r) => setTimeout(r, 0)); await app.esperar(); };
      return { ventana, doc: ventana.document, raiz, quieto };
    };
    const ui = await abrir(true);
    expect(ui.raiz.textContent).toContain("Entrada por audio (opcional)");
    expect(ui.raiz.textContent).toContain("Groq");
    expect(ui.raiz.textContent).toContain("No se guarda");
    expect(ui.doc.querySelector("#audio-ajustes-estado")?.textContent).toContain("desactivado");
    const sw = ui.doc.querySelector("#audio-activo") as unknown as HTMLInputElement;
    sw.checked = true;
    sw.dispatchEvent(new ui.ventana.Event("change", { bubbles: true }) as unknown as Event);
    await ui.quieto();
    expect(m.audio.activo()).toBe(true);
    expect(ui.doc.querySelector("#audio-ajustes-estado")?.textContent).toContain("activo");
    const sw2 = ui.doc.querySelector("#audio-activo") as unknown as HTMLInputElement;
    sw2.checked = false;
    sw2.dispatchEvent(new ui.ventana.Event("change", { bubbles: true }) as unknown as Event);
    await ui.quieto();
    expect(m.audio.activo()).toBe(false);
    expect(ui.doc.querySelector("#audio-ajustes-estado")?.textContent).toContain("desactivado");

    const antes = m.e.llamadas.length;
    const sin = await abrir(false);
    expect(sin.raiz.textContent).toContain("Entrada por audio (opcional)");
    expect(sin.doc.querySelector("#audio-ajustes-estado")?.textContent).toContain("Iniciá sesión para configurarlo");
    expect(sin.doc.querySelector("#audio-activo")).toBeNull();
    expect(m.e.llamadas.slice(antes).filter((l) => l.includes("/ajustes/audio"))).toEqual([]);
  });

  it("O12: sin clave configurada Ajustes muestra 'falta configurar'", async () => {
    const m = await montar({ hayClave: false, proveedor: null });
    m.audio.fijarActivo(true);
    const ventana = new Window({ url: "http://localhost/" });
    const raiz = ventana.document.createElement("div");
    ventana.document.body.append(raiz);
    const app = montarApp(raiz as unknown as HTMLElement, { almacen: m.c.almacen, reloj: m.e.reloj, persistencia: m.c.persistencia, sync: m.c.motor });
    app.ir("ajustes");
    await app.esperar();
    expect(ventana.document.querySelector("#audio-ajustes-estado")?.textContent).toContain("falta configurar");
  });
});
