/** Aplicación Hono con dependencias inyectadas (reloj, base, secretos): se prueba con `app.request()` sin red. */
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { getConnInfo } from "@hono/node-server/conninfo";
import { argon2Verify } from "hash-wasm";
import type { DatabaseSync } from "node:sqlite";
import type { Reloj } from "../compartido/reloj.ts";
import type { Secretos } from "./config.ts";
import { Limitador } from "./limitador.ts";
import { Sesiones } from "./sesiones.ts";

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

  app.get("/auth/yo", (c) => c.json({ ok: true }));

  app.post("/auth/logout", (c) => {
    const token = tokenDe(c);
    if (token) sesiones.invalidar(token);
    return c.json({ ok: true });
  });

  return app;
}
