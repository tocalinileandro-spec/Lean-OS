/**
 * Sistema de diseño base (P12, P13, P14, P16) y la capa CSS/DOM de P15 y P17.
 * Se revisan el CSS y el HTML publicados y el DOM de la app en un navegador simulado (happy-dom).
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { AlmacenIndexedDB } from "../src/cliente/almacen-indexeddb.ts";
import { ARCHIVOS_APP } from "../src/cliente/sw-logica.ts";
import { montarApp, type AppMontada } from "../src/cliente/ui/app.ts";
import { aplicarTema, cargarAjustes, cargarTema, guardarAjustes, guardarTema, TEMAS, type Persistencia } from "../src/cliente/ui/logica.ts";
import { fijarHoraCambio } from "../src/compartido/dia.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (ruta: string) => readFileSync(join(raiz, ruta), "utf8");
const CSS = leer("src/cliente/estilos.css");
const HTML = leer("src/cliente/index.html");

// ---------- lector mínimo de CSS ----------

interface Regla { media: string | null; selector: string; decl: Map<string, string> }

function declaraciones(cuerpo: string): Map<string, string> {
  const m = new Map<string, string>();
  // Separa por ";" fuera de paréntesis (url(...), var(...)).
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

function parsearCss(css: string): Regla[] {
  const sin = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const reglas: Regla[] = [];
  const leerBloques = (texto: string, media: string | null) => {
    let i = 0;
    while (i < texto.length) {
      const a = texto.indexOf("{", i);
      if (a < 0) break;
      const cab = texto.slice(i, a).trim();
      let prof = 1, j = a + 1;
      while (j < texto.length && prof > 0) { if (texto[j] === "{") prof++; else if (texto[j] === "}") prof--; j++; }
      const cuerpo = texto.slice(a + 1, j - 1);
      if (cab.startsWith("@media")) leerBloques(cuerpo, cab.slice(6).trim());
      else for (const sel of cab.split(",")) reglas.push({ media, selector: sel.trim(), decl: declaraciones(cuerpo) });
      i = j;
    }
  };
  leerBloques(sin, null);
  return reglas;
}

const REGLAS = parsearCss(CSS);
const regla = (selector: string, media: string | null = null) => REGLAS.filter((r) => r.selector === selector && r.media === media);

type Tokens = Map<string, string>;
/** Tokens de un tema: claro = `:root` sin media; oscuro = `:root[data-tema="oscuro"]`. */
function tokens(tema: "claro" | "oscuro"): Tokens {
  const sel = tema === "claro" ? ":root" : ':root[data-tema="oscuro"]';
  const t: Tokens = new Map();
  for (const r of regla(sel)) for (const [k, v] of r.decl) if (k.startsWith("--")) t.set(k, v);
  return t;
}
const resolver = (t: Tokens, valor: string): string => valor.replace(/var\((--[a-z0-9-]+)\)/g, (_, n: string) => t.get(n) ?? `?${n}`);

// ---------- contraste WCAG ----------

function luminancia(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Color no válido: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

// ---------- DOM simulado ----------

class Memoria implements Persistencia {
  datos = new Map<string, string>();
  getItem(k: string) { return this.datos.get(k) ?? null; }
  setItem(k: string, v: string) { this.datos.set(k, v); }
}
afterEach(() => fijarHoraCambio());

async function abrirApp(persistencia: Persistencia = new Memoria()) {
  const ventana = new Window({ url: "http://localhost/" });
  const rootEl = ventana.document.createElement("div");
  ventana.document.body.append(rootEl);
  const almacen = await AlmacenIndexedDB.abrir("lean-os-diseno", new IDBFactory());
  const reloj = new RelojSimulado("2026-11-22T15:00:00.000Z");
  const app: AppMontada = montarApp(rootEl as unknown as HTMLElement, { almacen, reloj, persistencia });
  await app.esperar();
  return { ventana, doc: ventana.document, app, almacen, persistencia };
}

const dist = join(mkdtempSync(join(tmpdir(), "lean-os-diseno-")), "dist");
beforeAll(() => {
  const r = spawnSync(process.execPath, ["build.ts"], { cwd: raiz, encoding: "utf8", env: { ...process.env, LEAN_OS_DIST: dist } });
  expect(r.status, r.stderr).toBe(0);
}, 60_000);

const CSP_ANTERIOR = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'";
const CSP_NUEVA = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'";

function archivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const ruta = join(dir, f);
    return statSync(ruta).isDirectory() ? archivosTs(ruta) : ruta.endsWith(".ts") ? [ruta] : [];
  });
}

// =====================================================================
describe("P12: tokens, tipografía y recursos propios", () => {
  const VARIABLES = [
    "--fondo", "--superficie", "--texto", "--suave", "--borde", "--acento", "--acento-suave", "--acento-tinta", "--acento-texto",
    "--exito", "--peligro", "--aviso-fondo", "--aviso-texto",
    "--otra-fondo", "--otra-tinta", "--otra-borde", "--dificil-fondo", "--dificil-tinta", "--dificil-borde",
    "--bien-fondo", "--bien-tinta", "--bien-borde", "--facil-fondo", "--facil-tinta", "--facil-borde",
    "--sombra", "--sombra-grande", "--radio", "--radio-pastilla", "--fuente", "--e1", "--e4", "--e6", "--toque", "--alto-campo",
  ];

  it("P12: el CSS define color, sombras, radio, tipografía y espaciado en claro y en oscuro", () => {
    const claro = tokens("claro");
    const oscuro = tokens("oscuro");
    for (const v of VARIABLES) {
      expect(claro.has(v), `claro ${v}`).toBe(true);
      expect(oscuro.has(v) || ["--radio", "--radio-pastilla", "--fuente", "--e1", "--e4", "--e6", "--toque", "--alto-campo"].includes(v), `oscuro ${v}`).toBe(true);
    }
    // Colores de la maqueta (claro).
    expect(claro.get("--fondo")).toBe("#f7faff");
    expect(claro.get("--superficie")).toBe("#ffffff");
    expect(claro.get("--texto")).toBe("#0b1b3a");
    expect(claro.get("--suave")).toBe("#52617f");
    expect(claro.get("--acento")).toBe("#2563eb");
    expect(claro.get("--acento-suave")).toBe("#eaf1ff");
    expect(claro.get("--acento-tinta")).toBe("#1d4ed8");
    expect([claro.get("--otra-fondo"), claro.get("--otra-tinta")]).toEqual(["#fdecec", "#9b1c1c"]);
    expect([claro.get("--dificil-fondo"), claro.get("--dificil-tinta")]).toEqual(["#fff3e0", "#92400e"]);
    expect([claro.get("--bien-fondo"), claro.get("--bien-tinta")]).toEqual(["#eaf1ff", "#1d4ed8"]);
    expect([claro.get("--facil-fondo"), claro.get("--facil-tinta")]).toEqual(["#e8f7ee", "#166534"]);
    expect(claro.get("--radio")).toBe("20px");
    expect(claro.get("--radio-pastilla")).toBe("999px");
    expect(claro.get("--sombra")).toBe("0 1px 2px rgba(11, 27, 58, 0.04), 0 8px 24px rgba(37, 99, 235, 0.06)");
    expect(claro.get("--sombra-grande")).toContain("rgba(37, 99, 235, 0.08)");
    expect(claro.get("--fuente")).toMatch(/^Inter,/);
    expect(claro.get("--toque")).toBe("44px");
    expect(claro.get("--alto-campo")).toBe("46px");
    // El oscuro es propio: no copia el fondo ni el texto del claro.
    expect(oscuro.get("--fondo")).not.toBe(claro.get("--fondo"));
    expect(oscuro.get("--texto")).not.toBe(claro.get("--texto"));
  });

  it("P12: el tema oscuro por sistema (sin data-tema) repite exactamente el oscuro forzado; el claro forzado gana", () => {
    const oscuro = tokens("oscuro");
    const sistema = REGLAS.filter((r) => r.media === "(prefers-color-scheme: dark)" && r.selector === ':root:not([data-tema="claro"])');
    expect(sistema.length).toBe(1);
    const porMedia = new Map([...sistema[0]!.decl].filter(([k]) => k.startsWith("--")));
    const forzado = new Map([...oscuro].filter(([k]) => k.startsWith("--")));
    expect(porMedia).toEqual(forzado);
    expect(sistema[0]!.decl.get("color-scheme")).toBe("dark");
    expect(regla(':root[data-tema="oscuro"]')[0]!.decl.get("color-scheme")).toBe("dark");
    expect(regla(":root")[0]!.decl.get("color-scheme")).toBe("light");
  });

  it("P12: los botones son pastilla, las tarjetas y los campos redondeados con los tokens", () => {
    const t = tokens("claro");
    const boton = regla(".boton")[0]!;
    expect(resolver(t, boton.decl.get("border-radius")!)).toBe("999px");
    expect(resolver(t, boton.decl.get("min-height")!)).toBe("44px");
    expect(resolver(t, regla(".tarjeta-repaso")[0]!.decl.get("border-radius")!)).toBe("24px");
    expect(resolver(t, regla(".estadisticas > div")[0]!.decl.get("border-radius")!)).toBe("20px");
    expect(resolver(t, regla("input")[0]!.decl.get("min-height")!)).toBe("46px");
    expect(regla(".tarjeta-repaso")[0]!.decl.get("box-shadow")).toBe("var(--sombra-grande)");
    expect(resolver(t, regla("progress")[0]!.decl.get("height")!)).toBe("8px");
    expect(resolver(t, regla("progress")[0]!.decl.get("border-radius")!)).toBe("999px");
    expect(regla(".calificar-otra_vez").length + regla(".calificar-dificil").length + regla(".calificar-bien").length + regla(".calificar-facil").length).toBe(4);
  });

  it("P12: Inter propia con @font-face (swap), empaquetada en el build y precacheada; sin Google Fonts", () => {
    const ff = regla("@font-face")[0]!;
    expect(ff.decl.get("font-family")).toBe('"Inter"');
    expect(ff.decl.get("font-display")).toBe("swap");
    expect(ff.decl.get("src")).toBe('url("Inter.woff2") format("woff2")');
    expect(existsSync(join(raiz, "src/cliente/publico/Inter.woff2"))).toBe(true);
    expect(existsSync(join(raiz, "src/cliente/publico/LICENCIA-Inter.txt"))).toBe(true);
    expect([...readFileSync(join(dist, "Inter.woff2")).subarray(0, 4)]).toEqual([0x77, 0x4f, 0x46, 0x32]); // "wOF2"
    expect(existsSync(join(dist, "LICENCIA-Inter.txt"))).toBe(true);
    expect(ARCHIVOS_APP).toContain("Inter.woff2");
    for (const f of ARCHIVOS_APP) if (f !== "./") expect(existsSync(join(dist, f)), f).toBe(true);
    expect(CSS + HTML).not.toMatch(/googleapis|gstatic/i);
  });

  it("P12: index.html sin recursos externos ni style en línea; la CSP solo suma font-src 'self'", () => {
    expect(HTML).toContain(`content="${CSP_NUEVA}"`);
    // Quitar font-src 'self' devuelve exactamente la CSP anterior.
    expect(CSP_NUEVA.replace(" font-src 'self';", "")).toBe(CSP_ANTERIOR);
    expect(HTML).not.toMatch(/\sstyle\s*=/i);
    expect(HTML).not.toMatch(/<style[\s>]/i);
    expect(HTML).not.toContain("unsafe-inline");
    for (const m of HTML.matchAll(/\b(?:src|href)="([^"]*)"/g)) expect(m[1], m[0]).not.toMatch(/^(?:https?:)?\/\//i);
  });

  it("P12: ninguna URL http(s) externa en el CSS ni en el HTML publicados (dist)", () => {
    for (const f of ["index.html", "estilos.css"]) {
      const texto = readFileSync(join(dist, f), "utf8");
      expect(texto, f).not.toMatch(/https?:\/\//i);
      expect(texto, f).not.toMatch(/@import/i);
    }
    // Las únicas url() del CSS son locales (la fuente).
    for (const m of CSS.matchAll(/url\(([^)]*)\)/g)) expect(m[1]).toMatch(/^"?Inter\.woff2"?$/);
  });

  it("P12: el código de la UI no usa style en línea", () => {
    const archivos = [...archivosTs(join(raiz, "src/cliente/ui")), join(raiz, "src/cliente/main.ts")];
    for (const f of archivos) {
      const t = readFileSync(f, "utf8");
      expect(t, f).not.toMatch(/setAttribute\(\s*["']style["']/);
      expect(t, f).not.toMatch(/\.style\.|\.style\s*=|cssText|\bstyle\s*:/);
    }
  });
});

// =====================================================================
describe("P13: contraste AA de los tokens (claro y oscuro)", () => {
  /** [texto, fondo, mínimo, para qué] */
  const PARES: [string, string, number, string][] = [
    ["--texto", "--fondo", 4.5, "texto sobre fondo"],
    ["--texto", "--superficie", 4.5, "texto sobre superficie"],
    ["--texto", "--superficie-2", 4.5, "texto sobre bloque de respuesta"],
    ["--texto", "--acento-suave", 4.5, "texto sobre acento suave (botón al pasar el mouse)"],
    ["--suave", "--fondo", 4.5, "texto suave sobre fondo"],
    ["--suave", "--superficie", 4.5, "texto suave sobre superficie"],
    ["--suave", "--superficie-2", 4.5, "etiqueta RESPUESTA"],
    ["--suave", "--acento-suave", 4.5, "texto suave sobre acento suave"],
    ["--acento-texto", "--acento", 4.5, "texto sobre acento (botón principal, insignia, chip activo)"],
    ["--acento-texto", "--acento-hover", 4.5, "texto sobre acento al pasar el mouse"],
    ["--acento-tinta", "--acento-suave", 4.5, "acento tinta sobre acento suave (pestaña activa, píldora de contexto)"],
    ["--acento-tinta", "--superficie", 4.5, "acento tinta sobre superficie (grupos)"],
    ["--acento-tinta", "--fondo", 4.5, "acento tinta sobre fondo"],
    ["--acento", "--fondo", 4.5, "enlaces sobre fondo"],
    ["--acento", "--superficie", 4.5, "enlaces sobre superficie"],
    ["--otra-tinta", "--otra-fondo", 4.5, "calificación Otra vez"],
    ["--dificil-tinta", "--dificil-fondo", 4.5, "calificación Difícil"],
    ["--bien-tinta", "--bien-fondo", 4.5, "calificación Bien"],
    ["--facil-tinta", "--facil-fondo", 4.5, "calificación Fácil"],
    ["--peligro", "--fondo", 4.5, "peligro sobre fondo"],
    ["--peligro", "--superficie", 4.5, "peligro sobre superficie"],
    ["--peligro", "--peligro-fondo", 4.5, "peligro sobre su fondo"],
    ["--peligro", "--aviso-fondo", 4.5, "título de atrasadas"],
    ["--peligro", "--acento-suave", 4.5, "estado de sincronización con error al pasar el mouse"],
    ["--aviso-texto", "--aviso-fondo", 4.5, "aviso"],
    ["--exito", "--fondo", 4.5, "estado sincronizado sobre fondo"],
    ["--exito", "--superficie", 4.5, "estado sincronizado sobre superficie"],
    ["--exito", "--acento-suave", 4.5, "estado sincronizado al pasar el mouse"],
    // Bordes de componentes y foco: 3:1.
    ["--borde-control", "--superficie", 3, "borde de campos sobre superficie"],
    ["--borde-control", "--fondo", 3, "borde de campos sobre fondo"],
    ["--acento", "--fondo", 3, "anillo de foco sobre fondo"],
    ["--acento", "--superficie", 3, "anillo de foco sobre superficie"],
    ["--acento", "--acento-suave", 3, "anillo de foco sobre acento suave"],
    ["--acento", "--superficie-2", 3, "anillo de foco sobre el bloque de respuesta"],
  ];

  for (const tema of ["claro", "oscuro"] as const) {
    it(`P13: todos los pares de colores cumplen AA en el tema ${tema}`, () => {
      const t = tokens(tema);
      const fallas: string[] = [];
      for (const [a, b, minimo, que] of PARES) {
        const r = contraste(t.get(a)!, t.get(b)!);
        if (r < minimo) fallas.push(`${que}: ${a} ${t.get(a)} sobre ${b} ${t.get(b)} = ${r.toFixed(2)} (mínimo ${minimo})`);
      }
      expect(fallas).toEqual([]);
    });
  }

  it("P13: la función de contraste calcula valores conocidos de WCAG", () => {
    expect(contraste("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contraste("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contraste("#767676", "#ffffff")).toBeGreaterThan(4.5);
    expect(contraste("#777777", "#ffffff")).toBeLessThan(4.6);
  });
});

// =====================================================================
describe("P14: tema (Sistema, Claro u Oscuro) guardado en el dispositivo", () => {
  it("P14: por defecto sigue al sistema; guardar y leer; los valores inválidos valen sistema", () => {
    const p = new Memoria();
    expect(cargarTema(p)).toBe("sistema");
    for (const t of TEMAS) { guardarTema(p, t); expect(cargarTema(p)).toBe(t); }
    for (const malo of ["", "negro", "CLARO", "null", "{}", "undefined"]) { p.datos.set("lean-os:tema", malo); expect(cargarTema(p), malo).toBe("sistema"); }
    guardarTema(p, "oscuro");
    guardarTema(p, "azul" as never); // un valor inválido no pisa lo guardado
    expect(cargarTema(p)).toBe("oscuro");
    const roto: Persistencia = { getItem: () => { throw new Error("sin acceso"); }, setItem: () => undefined };
    expect(cargarTema(roto)).toBe("sistema");
  });

  it("P14: aplicarTema pone data-tema en <html> para claro y oscuro y lo quita para sistema", () => {
    const { documentElement } = new Window({ url: "http://localhost/" }).document;
    aplicarTema(documentElement as unknown as HTMLElement, "oscuro");
    expect(documentElement.getAttribute("data-tema")).toBe("oscuro");
    aplicarTema(documentElement as unknown as HTMLElement, "claro");
    expect(documentElement.getAttribute("data-tema")).toBe("claro");
    aplicarTema(documentElement as unknown as HTMLElement, "sistema");
    expect(documentElement.hasAttribute("data-tema")).toBe(false);
  });

  it("P14: main.ts aplica el tema guardado antes de dibujar", () => {
    const main = leer("src/cliente/main.ts");
    expect(main.indexOf("aplicarTema(document.documentElement")).toBeGreaterThan(0);
    expect(main.indexOf("aplicarTema(")).toBeLessThan(main.indexOf("montarApp("));
  });

  it("P14: Ajustes ofrece Sistema, Claro y Oscuro; elegir cambia data-tema y persiste sin tocar ajustes ni datos", async () => {
    const p = new Memoria();
    guardarAjustes(p, { nuevasPorDia: 7, horaCambio: "05:30" });
    const ajustesAntes = p.datos.get("lean-os:ajustes");
    const { doc, app, almacen } = await abrirApp(p);
    const tarjetasAntes = (await almacen.tarjetas.listar()).length;
    const colaAntes = (await almacen.cola.entradas()).length;
    app.ir("ajustes");
    await app.esperar();
    const radios = () => [...doc.querySelectorAll('#ajuste-tema input[type="radio"]')] as unknown as HTMLInputElement[];
    expect(radios().map((r) => r.value)).toEqual(["sistema", "claro", "oscuro"]);
    expect(doc.querySelector("#ajuste-tema")!.tagName).toBe("FIELDSET");
    expect(doc.querySelector("#ajuste-tema legend")!.textContent).toBe("Tema");
    expect(radios().map((r) => r.closest("label")!.textContent)).toEqual(["Sistema", "Claro", "Oscuro"]);
    expect(radios().find((r) => r.checked)!.value).toBe("sistema");
    const elegir = async (valor: string) => {
      const r = radios().find((x) => x.value === valor)!;
      r.checked = true;
      r.dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event("change", { bubbles: true }));
      await app.esperar();
    };
    await elegir("oscuro");
    expect(doc.documentElement.getAttribute("data-tema")).toBe("oscuro");
    expect(cargarTema(p)).toBe("oscuro");
    expect(radios().find((r) => r.checked)!.value).toBe("oscuro");
    await elegir("claro");
    expect(doc.documentElement.getAttribute("data-tema")).toBe("claro");
    expect(cargarTema(p)).toBe("claro");
    await elegir("sistema");
    expect(doc.documentElement.hasAttribute("data-tema")).toBe(false);
    expect(cargarTema(p)).toBe("sistema");
    await elegir("oscuro");
    // No mezcla con los ajustes que se sincronizan ni toca datos o la cola.
    expect(p.datos.get("lean-os:ajustes")).toBe(ajustesAntes);
    expect(cargarAjustes(p)).toEqual({ nuevasPorDia: 7, horaCambio: "05:30" });
    expect([...p.datos.keys()].sort()).toEqual(["lean-os:ajustes", "lean-os:tema"]);
    expect((await almacen.tarjetas.listar()).length).toBe(tarjetasAntes);
    expect((await almacen.cola.entradas()).length).toBe(colaAntes);
    // Al reabrir la app, la elección sigue.
    const otra = await abrirApp(p);
    otra.app.ir("ajustes");
    await otra.app.esperar();
    expect(([...otra.doc.querySelectorAll('#ajuste-tema input[type="radio"]')] as unknown as HTMLInputElement[]).find((r) => r.checked)!.value).toBe("oscuro");
  });
});

// =====================================================================
describe("P16: movimiento", () => {
  it("P16: con prefers-reduced-motion: reduce se anulan todas las transiciones y animaciones", () => {
    const r = REGLAS.filter((x) => x.media === "(prefers-reduced-motion: reduce)");
    expect(r.map((x) => x.selector)).toEqual(["*", "*::before", "*::after"]);
    for (const x of r) {
      expect(x.decl.get("transition")).toBe("none !important");
      expect(x.decl.get("animation")).toBe("none !important");
      expect(x.decl.get("scroll-behavior")).toBe("auto !important");
    }
    expect(CSS).toMatch(/\*,\s*\*::before,\s*\*::after/);
  });

  it("P16: ninguna duración de transición o animación supera 200 ms fuera de la regla de movimiento reducido", () => {
    const t = tokens("claro");
    for (const r of REGLAS) {
      if (r.media === "(prefers-reduced-motion: reduce)") continue;
      for (const [k, v] of r.decl) {
        if (!/^(transition|animation)/.test(k) && k !== "--duracion") continue;
        for (const m of resolver(t, v).matchAll(/(\d*\.?\d+)(ms|s)\b/g)) {
          const ms = m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]);
          expect(ms, `${r.selector} ${k}: ${v}`).toBeLessThanOrEqual(200);
        }
      }
    }
    expect(Number.parseInt(t.get("--duracion")!, 10)).toBeLessThanOrEqual(200);
  });

  it("P16: las transiciones solo tocan color, sombra o transform simple", () => {
    const t = tokens("claro");
    for (const r of REGLAS) {
      const v = r.decl.get("transition");
      if (!v || v.startsWith("none")) continue;
      const props = resolver(t, v).split(",").map((x) => x.trim().split(/\s+/)[0]!);
      for (const p of props) expect(["background-color", "color", "border-color", "box-shadow", "transform"], `${r.selector}: ${p}`).toContain(p);
    }
  });
});

// =====================================================================
describe("P15 (CSS) y P17 (DOM): navegación, tamaños táctiles e íconos", () => {
  const PX = (t: Tokens, v: string | undefined): number => {
    const r = resolver(t, v ?? "");
    const m = /^([\d.]+)(px|rem)$/.exec(r.trim());
    return m ? Number(m[1]) * (m[2] === "rem" ? 16 : 1) : 0;
  };

  it("P15 (CSS): a 640 px o menos la navegación es una barra inferior fija con 5 pestañas; desde 641 px, barra superior pegajosa", () => {
    const base = regla(".barra-superior")[0]!;
    expect(base.decl.get("position")).toBe("sticky");
    expect(base.decl.get("top")).toBe("0");
    const nav = regla(".nav", "(max-width: 640px)")[0]!;
    expect(nav.decl.get("position")).toBe("fixed");
    expect(nav.decl.get("bottom")).toBe("0");
    expect(nav.decl.get("grid-template-columns")).toBe("repeat(5, minmax(0, 1fr))");
    expect(nav.decl.get("padding")).toContain("env(safe-area-inset-bottom)");
    // El contenido no queda tapado por la barra inferior.
    expect(regla("main", "(max-width: 640px)")[0]!.decl.get("padding")).toContain("env(safe-area-inset-bottom)");
    expect(regla("main", "(max-width: 640px)")[0]!.decl.get("padding")).toContain("var(--alto-nav-movil)");
    // En escritorio el <nav> no es fijo.
    expect(regla(".nav")[0]!.decl.get("position")).toBeUndefined();
    // Los botones de calificación pasan de 4 a 2 columnas en el celular.
    expect(regla(".botones-respuesta")[0]!.decl.get("grid-template-columns")).toBe("repeat(4, minmax(0, 1fr))");
    expect(regla(".botones-respuesta", "(max-width: 640px)")[0]!.decl.get("grid-template-columns")).toBe("repeat(2, minmax(0, 1fr))");
  });

  it("P15 (CSS): los controles tienen al menos 44 px de alto o ancho mínimo", () => {
    const t = tokens("claro");
    expect(PX(t, "var(--toque)")).toBe(44);
    for (const sel of [".nav-item", ".boton", ".chip", ".boton-icono", ".estado-sync", ".tilde", ".segmentado .opcion"]) {
      const r = regla(sel)[0]!;
      const alto = Math.max(PX(t, r.decl.get("min-height")), PX(t, r.decl.get("height")));
      expect(alto, `${sel} alto`).toBeGreaterThanOrEqual(44);
    }
    for (const sel of [".nav-item", ".boton", ".boton-icono"]) {
      const r = regla(sel)[0]!;
      expect(Math.max(PX(t, r.decl.get("min-width")), PX(t, r.decl.get("width"))), `${sel} ancho`).toBeGreaterThanOrEqual(44);
    }
    expect(PX(t, regla(".boton.chico")[0]!.decl.get("min-height"))).toBeGreaterThanOrEqual(44);
    expect(PX(t, regla("input")[0]!.decl.get("min-height"))).toBeGreaterThanOrEqual(44);
    expect(PX(t, regla("select")[0]!.decl.get("min-height"))).toBeGreaterThanOrEqual(44);
    expect(PX(t, regla("textarea")[0]!.decl.get("min-height"))).toBeGreaterThanOrEqual(44);
    expect(PX(t, regla(".nav-item", "(max-width: 640px)")[0]!.decl.get("min-height"))).toBeGreaterThanOrEqual(44);
    expect(PX(t, regla(".nav-icono", "(max-width: 640px)")[0]!.decl.get("width"))).toBeGreaterThanOrEqual(44);
  });

  it("P15 (CSS): el foco visible mide 3 px", () => {
    expect(regla(":focus-visible")[0]!.decl.get("outline")).toBe("3px solid var(--acento)");
  });

  it("P17 (DOM): hay un solo <nav> con Hoy, Repaso, Áreas, Tareas y Apuntes; la activa lleva aria-current", async () => {
    const { doc, app } = await abrirApp();
    expect(doc.querySelectorAll("nav").length).toBe(1);
    const nombres = () => [...doc.querySelectorAll(".nav .nav-item .nav-texto")].map((x) => x.textContent);
    expect(nombres()).toEqual(["Hoy", "Repaso", "Áreas", "Tareas", "Apuntes"]);
    const activa = () => [...doc.querySelectorAll('.nav-item[aria-current="page"] .nav-texto')].map((x) => x.textContent);
    expect(activa()).toEqual(["Hoy"]);
    for (const [pantalla, texto] of [["repaso", "Repaso"], ["tareas", "Tareas"], ["apuntes", "Apuntes"], ["tarjetas", "Áreas"]] as const) {
      app.ir(pantalla);
      await app.esperar();
      expect(activa(), pantalla).toEqual([texto]);
      expect(doc.querySelectorAll("nav").length).toBe(1);
    }
    // Ajustes está en la cabecera, no en la barra, y también marca la pantalla activa.
    const ajustes = doc.querySelector("#ir-ajustes")!;
    expect(ajustes.closest("nav")).toBeNull();
    expect(ajustes.getAttribute("aria-label")).toBe("Ajustes");
    expect(ajustes.hasAttribute("aria-current")).toBe(false);
    (ajustes as unknown as HTMLElement).click();
    await app.esperar();
    expect(doc.querySelector("#ir-ajustes")!.getAttribute("aria-current")).toBe("page");
    expect(activa()).toEqual([]);
    expect(doc.querySelector("h1")!.textContent).toBe("Ajustes");
    // La barra es sticky y la marca tiene el punto.
    expect(doc.querySelector("header.barra-superior .marca")!.textContent).toBe("Lean OS");
  });

  it("P17 (DOM): los íconos son SVG propios inline con aria-hidden y focusable=false, siempre junto a texto o con etiqueta; sin emojis", async () => {
    const { doc } = await abrirApp();
    const svgs = [...doc.querySelectorAll("svg")];
    expect(svgs.length).toBe(6); // 5 pestañas + Ajustes
    for (const s of svgs) {
      expect(s.getAttribute("aria-hidden")).toBe("true");
      expect(s.getAttribute("focusable")).toBe("false");
      expect(s.getAttribute("stroke-linecap")).toBe("round");
      expect(s.namespaceURI).toBe("http://www.w3.org/2000/svg");
    }
    for (const b of doc.querySelectorAll(".nav-item")) expect(b.querySelector(".nav-texto")!.textContent!.length).toBeGreaterThan(0);
    expect(doc.querySelector("#ir-ajustes")!.getAttribute("aria-label")).toBeTruthy();
    expect(doc.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(CSS).not.toMatch(/font-family:\s*["']?(?:Material|Font ?Awesome|Bootstrap Icons)/i);
  });

  it("P17 (DOM): sin style en línea en el DOM dibujado", async () => {
    const { doc, app } = await abrirApp();
    for (const p of ["hoy", "repaso", "tareas", "apuntes", "tarjetas", "ajustes"] as const) {
      app.ir(p);
      await app.esperar();
      expect(doc.querySelectorAll("[style]").length, p).toBe(0);
    }
  });
});
