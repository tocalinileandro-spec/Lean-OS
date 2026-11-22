/** Aplicación Hono con dependencias inyectadas (reloj, base, secretos): se prueba con `app.request()` sin red. */
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { getConnInfo } from "@hono/node-server/conninfo";
import { argon2Verify } from "hash-wasm";
import type { DatabaseSync } from "node:sqlite";
import type { Reloj } from "../compartido/reloj.ts";
import type { Secretos } from "./config.ts";
import { Limitador } from "./limitador.ts";
import { Sesiones } from "./sesiones.ts";
import { aplicarPush, LIMITE_PULL, LIMITE_PULL_MAXIMO, leerPull, validarPush } from "./sync.ts";
import { exportarTodo } from "./respaldo.ts";
import { ServicioRespaldoExterno } from "./respaldo-externo.ts";
import { AUDIO_MAXIMO_BYTES, ErrorProveedor, ServicioAudio, TIPOS_AUDIO } from "./audio.ts";

export interface Dependencias {
  reloj: Reloj;
  base: DatabaseSync;
  secretos: Secretos;
  /** Registro de eventos. Nunca recibe contraseñas, tokens ni contenido. */
  registrar?: (linea: string) => void;
  /** Respaldo externo opcional. Si no se pasa, queda "sin configurar". */
  respaldoExterno?: ServicioRespaldoExterno;
  /** Entrada por audio opcional. Si no se pasa, queda "sin configurar". */
  audio?: ServicioAudio;
}

/** IP del cliente: Fly agrega Fly-Client-IP; si no, la del socket. No se confía en X-Forwarded-For (lo puede inventar el cliente). */
function ipDe(c: Context): string {
  const fly = c.req.header("fly-client-ip");
  if (fly) return fly;
  try {
    return getConnInfo(c).remote.address ?? "desconocida";
  } catch {
    return "desconocida";
  }
}

function tokenDe(c: Context): string | null {
  const cab = c.req.header("authorization") ?? "";
  const m = /^Bearer (\S+)$/.exec(cab);
  return m ? (m[1] as string) : null;
}

export function crearApp(deps: Dependencias): Hono {
  const app = new Hono();
  const sesiones = new Sesiones(deps.base, deps.reloj, deps.secretos.sessionSecret);
  const limitador = new Limitador(deps.reloj);
  const registrar = deps.registrar ?? ((l: string) => console.log(l));

  // HTTP -> HTTPS (Fly manda X-Forwarded-Proto).
  app.use("*", async (c, next) => {
    if (c.req.header("x-forwarded-proto") === "http") {
      const host = c.req.header("host") ?? new URL(c.req.url).host;
      const url = new URL(c.req.url);
      return c.redirect(`https://${host}${url.pathname}${url.search}`, 301);
    }
    await next();
  });

  app.use("*", secureHeaders());

  // Registro: solo método, ruta (sin query) y estado.
  app.use("*", async (c, next) => {
    await next();
    registrar(`${c.req.method} ${new URL(c.req.url).pathname} ${c.res.status}`);
  });

  app.use("/auth/*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  });

  const exigirSesion: MiddlewareHandler = async (c, next) => {
    const token = tokenDe(c);
    if (!token || !sesiones.validar(token)) {
      return c.json({ error: "Necesitás iniciar sesión." }, 401);
    }
    await next();
  };

  app.get("/health", (c) => c.text("ok"));

  const demasiadoGrande = (c: Context) => c.json({ error: "El pedido es demasiado grande." }, 413);
  app.post("/auth/login", bodyLimit({ maxSize: 1024, onError: demasiadoGrande }));
  app.post("/sync/push", bodyLimit({ maxSize: 10 * 1024 * 1024, onError: demasiadoGrande }));

  app.post("/auth/login", async (c) => {
    const espera = limitador.intentar(ipDe(c));
    if (espera !== null) {
      c.header("Retry-After", String(espera));
      return c.json({ error: "Demasiados intentos. Esperá un minuto y probá de nuevo." }, 429);
    }
    let password: unknown;
    try {
      password = ((await c.req.json()) as { password?: unknown }).password;
    } catch {
      return c.json({ error: "Falta la contraseña." }, 400);
    }
    if (typeof password !== "string" || password === "") return c.json({ error: "Falta la contraseña." }, 400);
    let ok = false;
    try {
      ok = await argon2Verify({ password, hash: deps.secretos.passwordHash });
    } catch {
      ok = false;
    }
    if (!ok) return c.json({ error: "Contraseña incorrecta." }, 401);
    const { token, expiraEn } = sesiones.crear();
    return c.json({ token, expira_en: new Date(expiraEn).toISOString() });
  });

  // Rutas protegidas. Las de sync (F4-b) cuelgan de /sync y /export.
  app.use("/auth/yo", exigirSesion);
  app.use("/auth/logout", exigirSesion);
  app.use("/sync/*", exigirSesion);
  app.use("/export", exigirSesion);
  app.use("/ajustes/*", exigirSesion);
  app.use("/audio/*", exigirSesion);
  app.use("/ajustes/*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  });
  const externo = deps.respaldoExterno ?? new ServicioRespaldoExterno({ db: deps.base, reloj: deps.reloj, claves: null, registrar });

  app.get("/ajustes/respaldo-externo", (c) =>
    c.json({ activo: externo.activo(), configurado: externo.configurado(), ultimo_resultado: externo.ultimoResultado() }));

  app.put("/ajustes/respaldo-externo", bodyLimit({ maxSize: 1024, onError: demasiadoGrande }), async (c) => {
    let activo: unknown;
    try {
      activo = ((await c.req.json()) as { activo?: unknown }).activo;
    } catch {
      return c.json({ error: "El cuerpo no es un JSON válido." }, 400);
    }
    if (typeof activo !== "boolean") return c.json({ error: "Falta activo (verdadero o falso)." }, 400);
    externo.fijarActivo(activo);
    return c.json({ activo, configurado: externo.configurado(), ultimo_resultado: externo.ultimoResultado() });
  });

  app.post("/ajustes/respaldo-externo/probar", async (c) => {
    if (!externo.activo()) return c.json({ error: "Activá el respaldo externo antes de probarlo." }, 409);
    return c.json(await externo.subirAhora());
  });

  const audio = deps.audio ?? new ServicioAudio({ db: deps.base, hayClave: false, proveedor: null });
  app.get("/ajustes/audio", (c) => c.json({ activo: audio.activo(), configurado: audio.configurado() }));
  app.put("/ajustes/audio", bodyLimit({ maxSize: 1024, onError: demasiadoGrande }), async (c) => {
    let activo: unknown;
    try {
      activo = ((await c.req.json()) as { activo?: unknown }).activo;
    } catch {
      return c.json({ error: "El cuerpo no es un JSON válido." }, 400);
    }
    if (typeof activo !== "boolean") return c.json({ error: "Falta activo (verdadero o falso)." }, 400);
    audio.fijarActivo(activo);
    return c.json({ activo, configurado: audio.configurado() });
  });

  app.use("/audio/*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  });
  app.post("/audio/transcribir", bodyLimit({
    maxSize: AUDIO_MAXIMO_BYTES,
    onError: (c) => c.json({ error: "El audio es demasiado grande (máximo 10 MB). Grabá algo más corto." }, 413),
  }), async (c) => {
    if (!audio.activo()) return c.json({ error: "La entrada por audio está desactivada. Activala en Ajustes." }, 403);
    if (!audio.configurado()) return c.json({ error: "Falta configurar la entrada por audio en el servidor (ver SECRETOS.md)." }, 409);
    const tipo = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!(TIPOS_AUDIO as readonly string[]).includes(tipo)) {
      return c.json({ error: "Ese tipo de audio no se admite (usá webm, ogg, mp4, mp3 o wav)." }, 415);
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length === 0) return c.json({ error: "No llegó ningún audio." }, 400);
    if (bytes.length > AUDIO_MAXIMO_BYTES) return c.json({ error: "El audio es demasiado grande (máximo 10 MB). Grabá algo más corto." }, 413);
    try {
      return c.json({ texto: await audio.transcribir(bytes, tipo) });
    } catch (e) {
      const motivo = e instanceof ErrorProveedor ? e.motivo : "fallo";
      if (motivo === "cuota") return c.json({ error: "Se agotó la cuota gratuita de transcripción por ahora. Probá más tarde; mientras tanto podés escribir el apunte." }, 429);
      if (motivo === "tiempo") return c.json({ error: "La transcripción tardó demasiado y se canceló. Probá de nuevo; lo escrito no se perdió." }, 504);
      return c.json({ error: "No se pudo transcribir el audio ahora. Probá de nuevo más tarde; podés escribir el apunte." }, 502);
    }
  });

  app.post("/sync/push", async (c) => {
    let cuerpo: unknown;
    try {
      cuerpo = await c.req.json();
    } catch {
      return c.json({ error: "El cuerpo no es un JSON válido." }, 400);
    }
    const v = validarPush(cuerpo);
    if ("error" in v) return c.json({ error: v.error }, 400);
    const r = aplicarPush(deps.base, deps.reloj, v.cambios, v.confirmar);
    if (!r.ok) return c.json(r.pedido, 409);
    return c.json(r.resultado);
  });

  app.get("/sync/pull", (c) => {
    const since = Number(c.req.query("since") ?? 0);
    const lim = Number(c.req.query("limite") ?? LIMITE_PULL);
    if (!Number.isInteger(since) || since < 0) return c.json({ error: "since debe ser un entero desde 0." }, 400);
    if (!Number.isInteger(lim) || lim < 1 || lim > LIMITE_PULL_MAXIMO) return c.json({ error: "limite fuera de rango." }, 400);
    return c.json(leerPull(deps.base, since, lim));
  });

  app.get("/export", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(exportarTodo(deps.base, deps.reloj));
  });

  app.get("/auth/yo", (c) => c.json({ ok: true }));

  app.post("/auth/logout", (c) => {
    const token = tokenDe(c);
    if (token) sesiones.invalidar(token);
    return c.json({ ok: true });
  });

  return app;
}
