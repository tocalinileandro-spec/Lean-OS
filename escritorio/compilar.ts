/**
 * Prepara escritorio/app/ para electron-builder: compila principal.ts con esbuild (del raíz) y copia el ícono.
 * Requiere haber corrido `npm run build` en la raíz (dist/ lo copia electron-builder con extraResources).
 * Uso (desde la raíz): `node escritorio/compilar.ts`
 */
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";

if (!existsSync("dist/index.html")) {
  console.error("Falta dist/: corré `npm run build` en la raíz antes.");
  process.exit(1);
}
rmSync("escritorio/app", { recursive: true, force: true });
mkdirSync("escritorio/app", { recursive: true });
await build({
  entryPoints: ["escritorio/principal.ts"],
  outfile: "escritorio/app/principal.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  logLevel: "warning",
});
copyFileSync("src/cliente/publico/icono-512.png", "escritorio/app/icono.png");
console.log("escritorio/app/ listo.");
