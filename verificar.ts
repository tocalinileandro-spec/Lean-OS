/**
 * `npm run verificar`: corre todas las pruebas con vitest y escribe REPORTE.md
 * con el resultado de cada ID de la sección 4. Falla si falta un ID exigible en
 * la fase actual, o si alguno está salteado o en rojo.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FASE_DE_CADA_ID, IDS_EXIGIBLES, TODOS_LOS_IDS } from "./fase-actual.ts";
import { armarReporte, evaluar, type ResultadoTest } from "./src/verificacion/evaluar.ts";

const raiz = dirname(fileURLToPath(import.meta.url));
const salidaJson = join(raiz, ".verificar-vitest.json");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

rmSync(salidaJson, { force: true });
const corrida = spawnSync(
  npx,
  ["vitest", "run", "--reporter=default", "--reporter=json", `--outputFile.json=${salidaJson}`],
  { cwd: raiz, stdio: "inherit", shell: process.platform === "win32" },
);

const tests: ResultadoTest[] = [];
let leyoJson = false;
try {
  const json = JSON.parse(readFileSync(salidaJson, "utf8")) as {
    testResults: { assertionResults: { fullName: string; title: string; status: string }[] }[];
  };
  for (const archivo of json.testResults)
    for (const a of archivo.assertionResults) tests.push({ nombre: a.title, estado: a.status });
  leyoJson = true;
} catch {
  // Sin JSON no hay resultados: se informa abajo y falla.
}
rmSync(salidaJson, { force: true });

const vitestFallo = corrida.status !== 0 || !leyoJson;
const ev = evaluar(tests, TODOS_LOS_IDS, IDS_EXIGIBLES, FASE_DE_CADA_ID, vitestFallo);
const nota = vitestFallo ? "Vitest terminó con error o no produjo resultados." : "";
writeFileSync(join(raiz, "REPORTE.md"), armarReporte(ev, new Date().toISOString(), nota), "utf8");

for (const r of ev.resultados) {
  if (r.exigible || r.estado !== "pendiente") console.log(`${r.id}: ${r.estado} (${r.detalle})`);
}
console.log(ev.ok ? "\nverificar: APROBADO (ver REPORTE.md)" : "\nverificar: FALLA (ver REPORTE.md)");
process.exit(ev.ok ? 0 : 1);
