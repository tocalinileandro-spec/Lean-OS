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

export interface Dependencias {
  reloj: Reloj;
  base: DatabaseSync;
  secretos: Secretos;
  /** Registro de eventos. Nunca recibe contraseñas, tokens ni contenido. */
  registrar?: (linea: string) => void;
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
