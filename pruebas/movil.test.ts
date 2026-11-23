/**
 * P23: el celular real. Dos capas:
 *  1. CSS y HTML publicados: lo que hace que una pantalla de celular se salga o se desalinee (viewport-fit, 100vh, letra de los campos,
 *     min-width y overflow-wrap, zonas seguras, anchos fijos).
 *  2. El resultado de `npm run movil` (docs/capturas/movil.json): emulación real de celular (isMobile, táctil, escala 2 o 3)
 *     en 6 tamaños, vertical y apaisado, en claro y oscuro, en todas las pantallas y estados. Debe tener cero problemas.
 * Si cambia la interfaz, hay que volver a correr `npm run movil` (y `npm run capturas`) y commitear el resultado.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS = readFileSync(join(raiz, "src/cliente/estilos.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const HTML = readFileSync(join(raiz, "src/cliente/index.html"), "utf8");

interface Regla { media: string | null; selector: string; cuerpo: string; decl: Map<string, string> }

function declaraciones(cuerpo: string): Map<string, string> {
  const m = new Map<string, string>();
  let prof = 0, actual = "";
  const partes: string[] = [];
  for (const c of cuerpo) {
    if (c === "(") prof++;
    if (c === ")") prof--;
    if (c === ";" && prof === 0) { partes.push(actual); actual = ""; } else actual += c;
  }
  partes.push(actual);
  for (const p of partes) {
    const i = p.indexOf(":");
    if (i > 0) m.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
  }
  return m;
}

function parsear(css: string): Regla[] {
  const reglas: Regla[] = [];
  const leer = (texto: string, media: string | null) => {
    let i = 0;
    while (i < texto.length) {
      const a = texto.indexOf("{", i);
      if (a < 0) break;
      const cab = texto.slice(i, a).trim();
      let prof = 1, j = a + 1;
      while (j < texto.length && prof > 0) { if (texto[j] === "{") prof++; else if (texto[j] === "}") prof--; j++; }
      const cuerpo = texto.slice(a + 1, j - 1);
      if (cab.startsWith("@media")) leer(cuerpo, cab.slice(6).trim());
      else if (!cab.startsWith("@")) for (const sel of cab.split(",")) reglas.push({ media, selector: sel.trim(), cuerpo, decl: declaraciones(cuerpo) });
      i = j;
    }
  };
  leer(css, null);
  return reglas;
}

const REGLAS = parsear(CSS);
const conSelector = (s: string) => REGLAS.filter((r) => r.selector === s);

describe("P23: CSS y HTML pensados para un celular real", () => {
  it("P23: el viewport meta incluye viewport-fit=cover, ancho del dispositivo y no bloquea el zoom", () => {
    const m = /<meta name="viewport" content="([^"]*)"/.exec(HTML);
    expect(m, "falta <meta name=viewport>").not.toBeNull();
    const contenido = m![1]!;
    expect(contenido).toContain("width=device-width");
    expect(contenido).toContain("initial-scale=1");
    expect(contenido).toContain("viewport-fit=cover");
    expect(contenido).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/);
  });

  it("P23: no queda 100vh crudo: toda regla con 100vh trae su versión dinámica (dvh o svh) y #app la usa", () => {
    const bloques = CSS.match(/\{[^{}]*\}/g) ?? [];
    for (const b of bloques) {
      if (/\b100vh\b/.test(b)) expect(b, `100vh sin respaldo dinámico en ${b}`).toMatch(/\b100[ds]vh\b/);
    }
    expect(conSelector("#app").some((r) => /100dvh/.test(r.cuerpo))).toBe(true);
    // y el respaldo va antes que la versión dinámica (si el navegador no entiende dvh, queda 100vh)
    const app = conSelector("#app")[0]!.cuerpo;
    expect(app.indexOf("100vh")).toBeLessThan(app.indexOf("100dvh"));
  });

  it("P23: los campos de formulario (input, select, textarea) miden 16 px o más en celular (iOS hace zoom al enfocar si no)", () => {
    const base = REGLAS.find((r) => r.media === null && r.selector === "input" && r.cuerpo.includes("scroll-margin"));
    expect(base, "falta la regla base de campos").toBeDefined();
    expect(base!.decl.get("font-size")).toMatch(/^max\(16px, ?1rem\)$/);
    // ninguna otra regla puede bajar la letra de un campo
    const esCampo = (sel: string) => /(^|[\s>+~])(input|textarea|select)(?![\w-])[^\s>+~]*$/.test(sel.replace(/::?[\w-]+(\([^)]*\))?/g, ""));
    for (const r of REGLAS) {
      const fs = r.decl.get("font-size");
      if (!fs || !esCampo(r.selector)) continue;
      expect(fs, `${r.selector} baja la letra de un campo`).toMatch(/^(max\(16px, ?1rem\)|1rem|var\(--t-base\)|(1[6-9]|[2-9]\d)px)$/);
    }
    // y ningún selector de campo hereda la letra chica de su etiqueta: la regla base fija font-size explícito
    expect(base!.cuerpo).toContain("font: inherit");
  });

  it("P23: los contenedores clave tienen min-width: 0 y overflow-wrap para que un texto largo sin espacios no ensanche la página", () => {
    const claves = [".lista .texto", ".fila-cuerpo", ".area-tarjeta", ".pregunta", ".respuesta", ".contexto", ".resumen-cuerpo", ".fila-tema-texto", ".aviso", ".dato", ".markdown", ".apunte-titulo", ".bloque-previo > *", ".confirmacion"];
    for (const k of claves) {
      const rs = REGLAS.filter((r) => r.selector === k);
      expect(rs.length, `no hay reglas para ${k}`).toBeGreaterThan(0);
      const ok = rs.some((r) => /^(anywhere|break-word)$/.test(r.decl.get("overflow-wrap") ?? "") || r.decl.get("min-width") === "0" || r.decl.get("word-break") === "break-word");
      expect(ok, `${k} no corta ni encoge su contenido`).toBe(true);
    }
    // las grillas y filas flex usan minmax(0, ...) o min-width: 0, nunca un mínimo implícito
    for (const r of REGLAS) {
      const g = r.decl.get("grid-template-columns");
      if (!g || /^minmax\(0, ?1fr\)$/.test(g)) continue;
      expect(g, `${r.selector}: columnas sin minmax(0, 1fr)`).toMatch(/^(repeat\(\d+, minmax\(0, 1fr\)\)|repeat\(auto-fit, minmax\(7rem, 1fr\))/);
    }
  });

  it("P23: la barra inferior, el acceso fijo y el diálogo respetan el área segura (env(safe-area-inset-*))", () => {
    const enMovil = (s: string) => REGLAS.filter((r) => r.selector === s && r.media !== null && r.media.includes("max-width: 640px"));
    const nav = enMovil(".nav").find((r) => r.decl.get("position") === "fixed");
    expect(nav, "falta la barra inferior fija").toBeDefined();
    expect(nav!.decl.get("padding")).toContain("env(safe-area-inset-bottom)");
    expect(nav!.decl.get("padding")).toContain("env(safe-area-inset-left)");
    expect(nav!.decl.get("padding")).toContain("env(safe-area-inset-right)");
    const fijo = enMovil(".acceso-fijo").find((r) => r.decl.get("position") === "fixed");
    expect(fijo, "falta el acceso fijo").toBeDefined();
    expect(fijo!.decl.get("bottom")).toContain("env(safe-area-inset-bottom)");
    expect(fijo!.decl.get("left")).toContain("env(safe-area-inset-left)");
    expect(fijo!.decl.get("right")).toContain("env(safe-area-inset-right)");
    expect(enMovil("main")[0]!.decl.get("padding-bottom")).toContain("env(safe-area-inset-bottom)");
    expect(conSelector("main")[0]!.decl.get("padding")).toContain("env(safe-area-inset-left)");
    expect(conSelector(".barra-superior")[0]!.decl.get("padding")).toContain("env(safe-area-inset-top)");
    expect(enMovil(".resumen-dialogo")[0]!.decl.get("padding-bottom")).toContain("env(safe-area-inset-bottom)");
  });

  it("P23: en celular apaisado (poca altura) la barra superior no queda pegada y el acceso fijo fluye", () => {
    const corto = REGLAS.filter((r) => r.media !== null && r.media.includes("max-height: 500px"));
    expect(corto.find((r) => r.selector === ".barra-superior")?.decl.get("position")).toBe("static");
    expect(corto.find((r) => r.selector === ".acceso-fijo")?.decl.get("position")).toBe("static");
  });

  it("P23: ningún ancho fijo en px mayor a 320 en reglas de layout fuera de las media queries de escritorio", () => {
    for (const r of REGLAS) {
      if (r.media !== null && /min-width/.test(r.media)) continue;
      for (const prop of ["width", "min-width"]) {
        const v = r.decl.get(prop);
        if (!v) continue;
        for (const m of v.matchAll(/(\d+(?:\.\d+)?)px/g)) {
          expect(Number(m[1]), `${r.selector} { ${prop}: ${v} }`).toBeLessThanOrEqual(320);
        }
      }
    }
  });

  it("P23: los campos tienen margen de scroll para no quedar bajo las barras fijas al enfocarlos", () => {
    const base = REGLAS.find((r) => r.media === null && r.selector === "input")!;
    expect(base.decl.get("scroll-margin-top")).toBeTruthy();
    expect(base.decl.get("scroll-margin-bottom")).toContain("--margen-campo-inf");
    expect(CSS).toContain("env(safe-area-inset-bottom)");
  });
});

describe("P23: resultado de la emulación de celular real (docs/capturas/movil.json)", () => {
  const ruta = join(raiz, "docs", "capturas", "movil.json");
  const TAMANOS = ["320x568", "360x640", "375x667", "390x844", "412x915", "430x932"];
  const PANTALLAS = ["hoy", "repaso", "areas", "area", "tareas", "apuntes", "tarjetas", "ajustes"];

  it("P23: movil.json existe, es JSON válido y cubre 6 tamaños, vertical y apaisado, claro y oscuro y todas las pantallas", () => {
    expect(existsSync(ruta), "falta docs/capturas/movil.json: corré `npm run build && npm run movil`").toBe(true);
    const m = JSON.parse(readFileSync(ruta, "utf8"));
    expect(m.generado).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const nombres = (m.dispositivos as { nombre: string; escala: number }[]).map((d) => d.nombre);
    for (const t of TAMANOS) expect(nombres, `falta el tamaño ${t}`).toContain(t);
    for (const d of m.dispositivos as { escala: number }[]) expect(d.escala).toBeGreaterThanOrEqual(2);
    expect(m.orientaciones).toEqual(["vertical", "apaisado"]);
    expect(m.temas).toEqual(["claro", "oscuro"]);
    for (const p of PANTALLAS) expect(m.pantallas, `falta la pantalla ${p}`).toContain(p);
    expect(m.estados).toBeGreaterThanOrEqual(55);
    expect(m.resumen.mediciones).toBeGreaterThanOrEqual(TAMANOS.length * 2 * 2 * m.estados);
  });

  it("P23: cero problemas: sin scroll horizontal, página sin achicar, nada fuera de pantalla, nada tapado, controles de 44 px y área segura", () => {
    expect(existsSync(ruta), "falta docs/capturas/movil.json: corré `npm run build && npm run movil`").toBe(true);
    const m = JSON.parse(readFileSync(ruta, "utf8"));
    expect(Array.isArray(m.problemas)).toBe(true);
    const lista = (m.problemas as { dispositivo: string; orientacion: string; tema: string; pantalla: string; estado: string; tipo: string; detalle: string }[])
      .slice(0, 5).map((p) => `[${p.tipo}] ${p.dispositivo} ${p.orientacion} ${p.tema} ${p.pantalla}/${p.estado}: ${p.detalle}`);
    expect(m.problemas, `Problemas de celular (primeros 5): ${lista.join(" | ")}`).toEqual([]);
    expect(m.resumen.problemas).toBe(0);
  });
});
