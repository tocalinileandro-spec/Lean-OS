/** Sirve la app compilada (dist/) desde el mismo servidor, sin pisar la API. */
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import { PREFIJOS_API } from "../cliente/sw-logica.ts";

export function montarEstaticos(app: Hono, carpeta: string): void {
  const opciones = { root: carpeta };
  // La app no tiene nombres con huella: lo que se sirve como archivo estático siempre se revalida (sw.js e index.html sí o sí).
  app.use("/*", async (c, next) => {
    await next();
    if (c.res.status === 200 && c.req.method === "GET") {
      const ruta = new URL(c.req.url).pathname;
      const esApi = PREFIJOS_API.some((p) => ruta === p || ruta.startsWith(`${p}/`));
      if (!esApi) c.res.headers.set("Cache-Control", "no-cache");
    }
  });
  app.use("/*", serveStatic(opciones));
  // Navegación a cualquier otra ruta que no sea de la API: vuelve a la app. Las rutas de la API siguen dando 404 reales.
  app.get("/*", async (c, next) => {
    const ruta = new URL(c.req.url).pathname;
    const esApi = PREFIJOS_API.some((p) => ruta === p || ruta.startsWith(`${p}/`));
    const pideHtml = (c.req.header("accept") ?? "").includes("text/html");
    if (esApi || !pideHtml) return next();
    return serveStatic({ ...opciones, rewriteRequestPath: () => "/index.html" })(c, next);
  });
}
