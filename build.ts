/** Genera dist/ (index.html, app.js, estilos.css, sw.js, manifest e íconos) con esbuild. Uso: `npm run build`. */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";

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
for (const f of readdirSync("src/cliente/publico")) copyFileSync(`src/cliente/publico/${f}`, `dist/${f}`);

// Versión del caché = huella de los archivos de la app: cada build distinto reemplaza la caché vieja.
const huella = createHash("sha256");
for (const f of readdirSync("dist").sort()) huella.update(f).update(readFileSync(`dist/${f}`));
const version = huella.digest("hex").slice(0, 12);
await build({
  entryPoints: ["src/cliente/sw.ts"],
  outfile: "dist/sw.js",
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  define: { __VERSION__: JSON.stringify(version) },
  logLevel: "warning",
});
console.log(`dist/ listo (versión ${version}): abrí http://localhost:8080 con \`npm run servidor\` para usar la app y la PWA.`);
