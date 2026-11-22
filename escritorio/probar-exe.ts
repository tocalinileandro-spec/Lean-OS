/**
 * Prueba el Lean-OS.exe ya construido (B2 y S1 dentro del .exe). Solo Windows.
 * Uso (desde la raíz): `node escritorio/probar-exe.ts [ruta\al\Lean-OS.exe]` (por defecto escritorio/salida/Lean-OS.exe).
 * Corre los modos salud, s1-escribir y s1-leer con carpetas de datos temporales (nunca los datos reales).
 * El resultado se lee de <datos>/resultado-prueba.txt (el .exe no siempre enlaza stdout) y del código de salida.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const exe = resolve(process.argv[2] ?? "escritorio/salida/Lean-OS.exe");
const TIMEOUT_MS = 120_000;
// Puerto distinto del de uso normal para no chocar con una copia abierta; es el mismo en las tres corridas (mismo origen).
const PUERTO = "47822";

function correr(modo: string, datos: string): Promise<{ codigo: number | null; salida: string; vencio: boolean }> {
  return new Promise((listo) => {
    const hijo = spawn(exe, [], {
      env: { ...process.env, LEAN_OS_PRUEBA: modo, LEAN_OS_DATOS: datos, LEAN_OS_PUERTO: PUERTO, LEAN_OS_SERVIDOR: "http://127.0.0.1:1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let vencio = false;
    const reloj = setTimeout(() => {
      vencio = true;
      spawn("taskkill", ["/pid", String(hijo.pid), "/t", "/f"]);
    }, TIMEOUT_MS);
    hijo.stdout?.on("data", (d: Buffer) => process.stdout.write(d));
    hijo.stderr?.on("data", (d: Buffer) => process.stderr.write(d));
    hijo.on("error", () => { clearTimeout(reloj); listo({ codigo: null, salida: "", vencio }); });
    hijo.on("exit", (codigo) => {
      clearTimeout(reloj);
      const archivo = join(datos, "resultado-prueba.txt");
      listo({ codigo, salida: existsSync(archivo) ? readFileSync(archivo, "utf8") : "", vencio });
    });
  });
}

async function paso(modo: string, datos: string, marca: string): Promise<boolean> {
  console.log(`--- ${modo} ---`);
  const r = await correr(modo, datos);
  const codigoApp = /CODIGO=(\d+)/.exec(r.salida)?.[1];
  const ok = !r.vencio && r.salida.includes(marca) && codigoApp === "0";
  if (r.codigo !== 0) console.warn(`aviso: el .exe terminó con código ${String(r.codigo)} (resultado según el archivo: ${codigoApp ?? "sin datos"})`);
  console.log(ok ? `${modo}: ${marca}` : `${modo}: FALLA${r.vencio ? " (tiempo agotado)" : ""}\n${r.salida}`);
  return ok;
}

if (process.platform !== "win32") {
  console.error("probar-exe solo corre en Windows.");
  process.exit(1);
}
if (!existsSync(exe)) {
  console.error(`No existe ${exe}. Empaquetalo antes (ver PROBAR.md).`);
  process.exit(1);
}
const base = mkdtempSync(join(tmpdir(), "lean-os-prueba-"));
let todoOk = true;
try {
  todoOk = (await paso("salud", join(base, "salud"), "SALUD_OK")) && todoOk;
  const s1 = join(base, "s1");
  const escribio = await paso("s1-escribir", s1, "S1_ESCRITO");
  todoOk = escribio && todoOk;
  todoOk = escribio && (await paso("s1-leer", s1, "S1_LEIDO")) && todoOk;
} finally {
  rmSync(base, { recursive: true, force: true });
}
console.log(todoOk ? "\nprobar-exe: B2 y S1 en el .exe OK" : "\nprobar-exe: FALLA");
process.exit(todoOk ? 0 : 1);
