/** Genera dist/ (index.html, app.js, estilos.css) con esbuild. Uso: `npm run build`. */
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["src/cliente/main.ts"],
  outfile: "dist/app.js",
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  sourcemap: false,
  logLevel: "warning",
});
copyFileSync("src/cliente/index.html", "dist/index.html");
copyFileSync("src/cliente/estilos.css", "dist/estilos.css");
console.log("dist/ listo: abrí dist/index.html en el navegador.");
