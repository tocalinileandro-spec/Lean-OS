/** Arranca el servidor real. Uso: `npm run servidor`. Variables: PORT, DATA_DIR, APP_PASSWORD_HASH, SESSION_SECRET, NODE_ENV. */
import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { RelojReal } from "../compartido/reloj.ts";
import { crearApp } from "./app.ts";
import { abrirBase } from "./base.ts";
import { leerConfig } from "./config.ts";
import { montarEstaticos } from "./estaticos.ts";
import { PlanificadorDiario, respaldarAhora } from "./respaldo.ts";

try {
  const config = await leerConfig(process.env);
  const reloj = new RelojReal();
  const base = abrirBase(join(config.dataDir, "lean-os.sqlite"), reloj);
  const app = crearApp({ reloj, base, secretos: config.secretos });
  const carpetaRespaldos = join(config.dataDir, "respaldos");
  new PlanificadorDiario(
    reloj,
    () => {
      respaldarAhora(base, carpetaRespaldos, reloj);
      console.log("Respaldo nocturno escrito.");
    },
    undefined,
    undefined,
    (e) => console.error(`Falló el respaldo nocturno: ${e instanceof Error ? e.message : "error desconocido"}`),
  ).iniciar();
  if (existsSync("dist")) {
    montarEstaticos(app, "./dist");
  }
  serve({ fetch: app.fetch, port: config.puerto }, (info) => {
    console.log(`Lean OS escuchando en el puerto ${info.port}`);
  });
} catch (e) {
  console.error(`No se pudo arrancar: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
