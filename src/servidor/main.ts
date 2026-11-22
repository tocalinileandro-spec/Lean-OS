/** Arranca el servidor real. Uso: `npm run servidor`. Variables: PORT, DATA_DIR, APP_PASSWORD_HASH, SESSION_SECRET, NODE_ENV. */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { RelojReal } from "../compartido/reloj.ts";
import { crearApp } from "./app.ts";
import { abrirBase } from "./base.ts";
import { leerConfig } from "./config.ts";

try {
  const config = await leerConfig(process.env);
  const reloj = new RelojReal();
  const base = abrirBase(join(config.dataDir, "lean-os.sqlite"), reloj);
  const app = crearApp({ reloj, base, secretos: config.secretos });
  if (existsSync("dist")) {
    app.use("/*", serveStatic({ root: "./dist" }));
  }
  serve({ fetch: app.fetch, port: config.puerto }, (info) => {
    console.log(`Lean OS escuchando en el puerto ${info.port}`);
  });
} catch (e) {
  console.error(`No se pudo arrancar: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
