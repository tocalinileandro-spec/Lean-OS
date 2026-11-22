/** Arranca el servidor real. Uso: `npm run servidor`. Variables: PORT, DATA_DIR, APP_PASSWORD_HASH, SESSION_SECRET, NODE_ENV y, opcionales, B2_KEY_ID, B2_APP_KEY, B2_BUCKET, RESPALDO_CLAVE, GROQ_API_KEY. */
import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { RelojReal } from "../compartido/reloj.ts";
import { crearApp } from "./app.ts";
import { abrirBase } from "./base.ts";
import { leerConfig } from "./config.ts";
import { montarEstaticos } from "./estaticos.ts";
import { PlanificadorDiario } from "./respaldo.ts";
import { ServicioRespaldoExterno } from "./respaldo-externo.ts";
import { ProveedorGroq, ServicioAudio } from "./audio.ts";

try {
  const config = await leerConfig(process.env);
  const reloj = new RelojReal();
  const base = abrirBase(join(config.dataDir, "lean-os.sqlite"), reloj);
  const respaldoExterno = new ServicioRespaldoExterno({ db: base, reloj, claves: config.respaldoExterno });
  const audio = new ServicioAudio({ db: base, hayClave: config.groqApiKey !== null, proveedor: config.groqApiKey ? new ProveedorGroq(config.groqApiKey) : null });
  const app = crearApp({ reloj, base, secretos: config.secretos, respaldoExterno, audio });
  const carpetaRespaldos = join(config.dataDir, "respaldos");
  new PlanificadorDiario(
    reloj,
    () => { void respaldoExterno.nocturno(carpetaRespaldos); },
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
