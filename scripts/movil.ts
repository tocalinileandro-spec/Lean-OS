/**
 * QA de celular real (criterio P23 de la visión). Uso: `npm run movil` (arma dist/ con `npm run build` si falta).
 *
 * Por qué existe: medir con Chromium de escritorio y la ventana achicada NO reproduce un celular. Sin `isMobile`, el navegador no
 * achica la página cuando algo la ensancha (el "layout viewport" crece y la pantalla queda toda corrida), no hay zonas seguras
 * (notch, barra de gestos) ni escala de píxeles. Acá cada recorrido corre en un contexto de emulación de celular de verdad:
 * `isMobile`, táctil, escala 2 o 3, user agent móvil y zonas seguras simuladas con el protocolo de Chrome (solo en los modelos con notch: iPhone de 812 px de alto o más; los demás no tienen).
 *
 * - Usa el Playwright GLOBAL (no es dependencia del proyecto). Si falta, sale con un mensaje claro.
 * - Siembra datos por la propia interfaz (áreas con subáreas, tarjetas vencidas/nuevas/suspendidas, repasos, tareas, metas, apuntes,
 *   papelera, textos largos sin espacios) y guarda el estado del navegador (incluida IndexedDB) para reusarlo en cada contexto.
 * - Para 320x568, 360x640, 375x667, 390x844, 412x915 y 430x932 (y dispositivos de `playwright.devices` si existen), en vertical y
 *   apaisado, en claro y oscuro: recorre TODAS las pantallas y estados y mide cada uno (ver `medirPagina`).
 * - Escribe `docs/capturas/movil.json` (solo resultados) y sale con código 1 si hay problemas.
 *
 * Variables de depuración (opcionales): MOVIL_SOLO="390x844:vertical:claro" corre una sola combinación;
 * MOVIL_CAPTURAS=<carpeta> guarda un PNG por estado para mirarlos; MOVIL_NO_ESCRIBIR=1 no toca el JSON; MOVIL_SALIDA=<ruta> lo escribe en otro lado; MOVIL_PARALELO=<n>.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { delimiter, dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(RAIZ, "dist");
const SALIDA = join(RAIZ, "docs", "capturas", "movil.json");
const MINIMO = 44;
const DIA_SIEMBRA = "2026-11-10T12:00:00-03:00";
const DIA_VISTA = "2026-11-23T12:00:00-03:00";

// ---------- combinaciones ----------

interface Dispositivo { notch: boolean; nombre: string; ancho: number; alto: number; escala: number; origen: "tamano" | "playwright"; descriptor: Record<string, unknown> }
type Orientacion = "vertical" | "apaisado";
type Tema = "claro" | "oscuro";

const UA_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const TAMANOS: [number, number, number, string][] = [
  [320, 568, 2, UA_ANDROID], [360, 640, 3, UA_ANDROID], [375, 667, 2, UA_IPHONE], [390, 844, 3, UA_IPHONE], [412, 915, 2, UA_ANDROID], [430, 932, 3, UA_IPHONE],
];
const DEVICES_PW = ["iPhone SE", "iPhone 13", "iPhone 14", "Pixel 5", "Pixel 7", "Galaxy S9+"];
const ORIENTACIONES: Orientacion[] = ["vertical", "apaisado"];
const TEMAS: Tema[] = ["claro", "oscuro"];
const PANTALLAS = ["hoy", "repaso", "areas", "area", "tareas", "apuntes", "tarjetas", "ajustes"] as const;

// ---------- datos de ejemplo ----------

const L1 = "Supercalifragilisticoespialidosoincreiblementelargosinningunespacioquedeberiacortarse";
const URL_LARGA = "https://ejemplo.com/una/ruta/muy/larga/sin/espacios/que/nunca/termina/index.html?parametro=valorlargo&otro=otrovalormaslargo";
const AREA_LARGA = "Áreaconunnombremuylargosinespaciosquedesbordaelcontenedor";
const SUB_LARGA = "Subáreaconnombretambienlargosinespaciosparaprobarelcorte";
const TEMA_LARGO = "Tema_con_un_nombre_larguisimo_sin_espacios_para_probar_el_corte_del_texto";

type Par = [string, string, string];
interface Bloque { area: string; tema: string; resumen: string; preguntas: Par[] }
const BLOQUES: Bloque[] = [
  { area: "Programación > CS50", tema: "Punteros en C", resumen: "Un **puntero** guarda la dirección de memoria de otra variable.\n\n- Se declara con `*`\n- La dirección se obtiene con `&`", preguntas: [
    ["¿Qué guarda un puntero?", "La dirección de memoria de otra variable.", "Piensa en una dirección postal."],
    ["¿Qué operador devuelve la dirección de una variable?", "El operador & (ampersand).", ""],
    ["¿Qué es un puntero nulo?", "Un puntero que no apunta a ninguna dirección válida (NULL).", ""],
    ["¿Cuántos bytes ocupa un puntero en 64 bits?", "8 bytes.", ""],
  ] },
  { area: "Programación > IA aplicada", tema: "Prompts efectivos", resumen: "Un buen prompt da contexto, tarea, formato esperado y ejemplos.", preguntas: [
    ["¿Qué cuatro partes ayudan a armar un prompt claro?", "Contexto, tarea, formato de salida y ejemplos.", ""],
    ["¿Para qué sirven los ejemplos en un prompt?", "Para mostrar el estilo y el formato que se espera.", ""],
    ["¿Qué es un prompt de sistema?", "Instrucciones de fondo que fijan el rol y las reglas.", ""],
  ] },
  { area: "Negocios > Las 32 leyes", tema: "Ley del enfoque", resumen: "Hacer pocas cosas bien suele rendir más que hacer muchas a medias.", preguntas: [
    ["¿Qué plantea la ley del enfoque?", "Que concentrarse en pocas prioridades rinde más.", ""],
    ["¿Qué es el costo de oportunidad?", "Lo que se deja de ganar por elegir una opción en lugar de otra.", ""],
    ["¿Qué señal indica falta de enfoque?", "Muchos proyectos abiertos y ninguno terminado.", ""],
  ] },
  { area: `${AREA_LARGA} > ${SUB_LARGA}`, tema: TEMA_LARGO, resumen: `Resumen con **negrita**, una lista y un enlace.\n\n- elemento uno\n- elemento con ${URL_LARGA}\n\nY un [enlace](https://ejemplo.com/x) y la palabra ${L1}.`, preguntas: [
    [`${L1}${L1}`, `${URL_LARGA}${URL_LARGA}`, L1],
    [`¿Qué significa ${L1} dentro de una pregunta que además tiene muchas palabras normales para que haga varias líneas?`, `Una respuesta larga con ${L1} y ${URL_LARGA} para ver cómo corta.`, `Pista con ${L1}`],
    ["Pregunta corta", "Respuesta corta.", ""],
  ] },
  { area: "Idiomas", tema: "Phrasal verbs", resumen: "Los phrasal verbs combinan un verbo con una partícula.", preguntas: [
    ["¿Qué significa «give up»?", "Rendirse o dejar de intentar.", ""],
    ["¿Qué significa «look after»?", "Cuidar a alguien o algo.", ""],
    ["¿Qué significa «run out of»?", "Quedarse sin algo.", ""],
  ] },
];
const jsonDe = (bs: Bloque[]) => JSON.stringify(bs.map((b) => ({
  tipo: "aprendizaje", fecha: "2026-11-10", area: b.area, tema: b.tema, resumen: b.resumen,
  preguntas: b.preguntas.map(([p, r, pista]) => ({ p, r, pista })),
})));
const BLOQUE_NUEVO: Bloque = { area: `${AREA_LARGA} > ${SUB_LARGA}`, tema: `${TEMA_LARGO}_nuevo`, resumen: `Resumen nuevo ${L1}.`, preguntas: [
  [`¿${L1}${L1}?`, `Respuesta ${URL_LARGA}`, ""], ["¿Pregunta normal del bloque nuevo?", "Sí.", ""],
] };
const JSON_PARCIAL = JSON.stringify([
  JSON.parse(jsonDe([BLOQUE_NUEVO]))[0],
  { tipo: `${L1}${L1}`, fecha: "2026-11-10", area: "X", tema: "Y", preguntas: [{ p: "a", r: "b" }] },
]);
const JSON_MALO = `{"tipo": "aprendizaje", "area": "${L1}${L1}", "tema": ${L1}, "preguntas": [`;

// ---------- Playwright global y servidor ----------

/* eslint-disable @typescript-eslint/no-explicit-any */
type Cualquiera = any;

function cargarPlaywright(): Cualquiera {
  const rutas = [...(process.env["NODE_PATH"] ?? "").split(delimiter).filter(Boolean)];
  const g = spawnSync("npm", ["root", "-g"], { encoding: "utf8" });
  if (g.status === 0 && g.stdout.trim()) rutas.push(g.stdout.trim());
  const req = createRequire(join(RAIZ, "package.json"));
  try { return req(req.resolve("playwright", { paths: [RAIZ, ...rutas] })); } catch { return null; }
}

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
};

async function servirDist(): Promise<{ url: string; cerrar: () => void }> {
  const servidor = createServer((req, res) => {
    const ruta = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    if (ruta.startsWith("/api")) { res.writeHead(503).end(); return; } // sin servidor de sincronización: la app sigue local
    const archivo = normalize(join(DIST, ruta === "/" ? "index.html" : ruta));
    if (!archivo.startsWith(DIST) || !existsSync(archivo)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": TIPOS[extname(archivo)] ?? "application/octet-stream" }).end(readFileSync(archivo));
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  const dir = servidor.address();
  const puerto = typeof dir === "object" && dir ? dir.port : 0;
  return { url: `http://127.0.0.1:${puerto}/`, cerrar: () => servidor.close() };
}

// ---------- medición dentro de la página ----------

interface Insets { t: number; r: number; b: number; l: number }
interface Hallazgo { tipo: string; detalle: string }

/**
 * Se ejecuta DENTRO de la página (no puede usar nada de afuera). Devuelve los problemas de ese estado:
 * a) scroll horizontal (html y body); b) página achicada (visualViewport.scale, innerWidth); c) elementos y texto fuera de la pantalla
 * (salvo la fila de chips, que se desliza a propósito), texto recortado y contenido que desborda su caja; d) solapes con la barra
 * inferior y el acceso fijo, último elemento tapado, controles tapados, campos tapados al enfocar; e) controles menores de 44 px;
 * f) (lo arma quien llama: se vuelve a medir tras girar); g) elementos fijos o pegajosos que cubren demasiado alto; h) zonas seguras;
 * campos de formulario con letra menor a 16 px (iOS hace zoom al enfocarlos).
 */
function medirPagina(a: { ancho: number; alto: number; ins: Insets; minimo: number }): { problemas: Hallazgo[]; controles: number } {
  const problemas: Hallazgo[] = [];
  const add = (tipo: string, detalle: string) => { problemas.push({ tipo, detalle }); };
  const W = a.ancho, H = a.alto, I = a.ins;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const nom = (el: Element | null): string => {
    if (!el) return "(nada)";
    const id = el.id ? `#${el.id.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "ID")}` : "";
    const cl = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    const tx = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 28);
    return `${el.tagName.toLowerCase()}${id}${cl}${tx ? ` "${tx}"` : ""}`;
  };
  const est = (el: Element) => getComputedStyle(el);
  const visible = (el: Element): boolean => {
    const c = est(el);
    if (c.display === "none" || c.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  window.scrollTo(0, 0);

  // a) y b) la página no se ensancha ni se achica
  const html = document.documentElement;
  if (html.scrollWidth > window.innerWidth + 0.5) add("scroll-horizontal", `html scrollWidth ${html.scrollWidth} > innerWidth ${window.innerWidth}`);
  if (document.body.scrollWidth > window.innerWidth + 0.5) add("scroll-horizontal", `body scrollWidth ${document.body.scrollWidth} > innerWidth ${window.innerWidth}`);
  const vv = window.visualViewport;
  if (vv && Math.abs(vv.scale - 1) > 0.001) add("pagina-achicada", `visualViewport.scale ${r1(vv.scale)}`);
  if (window.innerWidth !== W) add("ancho-del-layout", `innerWidth ${window.innerWidth} distinto del ancho del dispositivo ${W}`);

  const todos = Array.from(document.body.querySelectorAll("*")).filter((el) => {
    if (el.closest(".solo-lectores")) return false;
    const svg = el.closest("svg");
    if (svg && svg !== el) return false;
    if (["SCRIPT", "STYLE", "OPTION", "OPTGROUP", "TEMPLATE"].includes(el.tagName)) return false;
    return visible(el);
  }) as HTMLElement[];
  const enChips = (el: Element): boolean => !!el.closest(".chips-fila");

  // c) fuera de la pantalla (elementos y texto)
  const fuera = new Set<Element>();
  for (const el of todos) {
    if (enChips(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.left < -0.5 || r.right > W + 0.5) fuera.add(el);
  }
  for (const el of fuera) {
    if (el.parentElement && fuera.has(el.parentElement)) continue;
    const r = el.getBoundingClientRect();
    add("fuera-de-pantalla", `${nom(el)} x ${r1(r.left)}..${r1(r.right)} de ${W}`);
  }
  for (const el of todos) {
    if (enChips(el) || fuera.has(el)) continue;
    let min = Infinity, max = -Infinity;
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType !== 3 || !(n.nodeValue ?? "").trim()) continue;
      const g = document.createRange();
      g.selectNodeContents(n);
      for (const r of Array.from(g.getClientRects())) { if (r.width > 0) { min = Math.min(min, r.left); max = Math.max(max, r.right); } }
    }
    if (min === Infinity) continue;
    if (min < -0.5 || max > W + 0.5) add("fuera-de-pantalla", `texto de ${nom(el)} x ${r1(min)}..${r1(max)} de ${W}`);
    else if (min < I.l - 0.5 || max > W - I.r + 0.5) add("area-segura", `texto de ${nom(el)} x ${r1(min)}..${r1(max)} fuera de ${I.l}..${W - I.r}`);
  }
  // c) texto recortado o que desborda su caja
  for (const el of todos) {
    if (["INPUT", "TEXTAREA", "SELECT", "PROGRESS", "svg", "IMG"].includes(el.tagName) || enChips(el)) continue;
    const c = est(el);
    const tieneTexto = (el.textContent ?? "").trim() !== "";
    if (!tieneTexto) continue;
    const recorta = ["hidden", "clip"].includes(c.overflowX) || ["hidden", "clip"].includes(c.overflowY);
    if (recorta && c.textOverflow !== "ellipsis" && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
      add("texto-recortado", `${nom(el)} contenido ${el.scrollWidth}x${el.scrollHeight} en caja ${el.clientWidth}x${el.clientHeight}`);
    } else if (!recorta && c.display !== "inline" && c.overflowX === "visible" && Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.nodeValue ?? "").trim())
      && el.scrollWidth > el.clientWidth + 1) {
      add("texto-desborda-su-caja", `${nom(el)} contenido ${el.scrollWidth} en caja ${el.clientWidth}`);
    } else if (["auto", "scroll"].includes(c.overflowX) && el.scrollWidth > el.clientWidth + 1) {
      add("scroll-interno-horizontal", `${nom(el)} contenido ${el.scrollWidth} en caja ${el.clientWidth}`);
    }
  }

  // e) controles de 44 px, zona segura y letra de los campos
  const SEL = 'button, a[href], input, select, textarea, summary, [role=button], [tabindex]:not([tabindex="-1"])';
  const modal = document.querySelector<HTMLElement>("#r-resumen");
  const todosControles = Array.from(document.querySelectorAll<HTMLElement>(SEL)).filter((el) => !(el instanceof HTMLInputElement && el.type === "hidden") && visible(el));
  const controles = modal ? todosControles.filter((el) => modal.contains(el)) : todosControles;
  for (const el of todosControles) {
    const r = el.getBoundingClientRect();
    if (r.width < a.minimo - 0.01 || r.height < a.minimo - 0.01) add("control-menor-44", `${nom(el)} ${r1(r.width)}x${r1(r.height)}`);
    if (!enChips(el) && (r.left < I.l - 0.5 || r.right > W - I.r + 0.5)) add("area-segura", `${nom(el)} x ${r1(r.left)}..${r1(r.right)} fuera de ${I.l}..${W - I.r}`);
    if (el.closest("nav") && est(el.closest("nav")!).position === "fixed" && r.bottom > H - I.b + 0.5) add("area-segura", `${nom(el)} termina en y ${r1(r.bottom)} y la zona segura llega a ${H - I.b}`);
    if (el.closest("header") && r.top < I.t - 0.5) add("area-segura", `${nom(el)} empieza en y ${r1(r.top)} y la zona segura empieza en ${I.t}`);
    if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && !["checkbox", "radio"].includes((el as HTMLInputElement).type)) {
      const fs = parseFloat(est(el).fontSize);
      if (fs < 16) add("zoom-ios-letra-menor-16", `${nom(el)} letra ${fs}px`);
    }
  }

  // g) fijos y pegajosos
  const fijos = todos.filter((el) => ["fixed", "sticky"].includes(est(el).position) && !el.closest(".resumen-fondo") && !el.classList.contains("resumen-fondo"));
  let cubierto = 0;
  const partes: string[] = [];
  for (const el of fijos) {
    const r = el.getBoundingClientRect();
    cubierto += r.height;
    partes.push(`${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(/\s+/)[0] : ""} ${Math.round(r.height)}`);
    if (est(el).position === "fixed" && (r.bottom > H + 0.5 || r.top < -0.5)) add("fijo-fuera-de-pantalla", `${nom(el)} y ${r1(r.top)}..${r1(r.bottom)} de ${H}`);
  }
  if (cubierto > H * 0.4) add("fijos-cubren-demasiado", `${Math.round((cubierto / H) * 100)}% de ${H}px (${partes.join(", ")})`);
  // d) solape entre fijos
  for (let i = 0; i < fijos.length; i++) {
    for (let j = i + 1; j < fijos.length; j++) {
      const x = fijos[i]!.getBoundingClientRect(), y = fijos[j]!.getBoundingClientRect();
      if (fijos[i]!.contains(fijos[j]!) || fijos[j]!.contains(fijos[i]!)) continue;
      if (Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1 && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1) add("solape-de-fijos", `${nom(fijos[i]!)} con ${nom(fijos[j]!)}`);
    }
  }
  const barrasAbajo = () => fijos.filter((el) => { const r = el.getBoundingClientRect(); return est(el).position === "fixed" && r.top > H / 2; });
  const barrasArriba = () => fijos.filter((el) => { const r = el.getBoundingClientRect(); return r.top <= 1 && r.bottom < H / 2; });

  if (modal) {
    const r = modal.getBoundingClientRect();
    if (r.top < -0.5 || r.bottom > H + 0.5 || r.left < -0.5 || r.right > W + 0.5) add("dialogo-fuera-de-pantalla", `${r1(r.left)},${r1(r.top)}..${r1(r.right)},${r1(r.bottom)} en ${W}x${H}`);
  } else {
    // d) con el scroll al fondo, lo último de la página queda por encima de las barras
    window.scrollTo(0, 1e7);
    const abajo = barrasAbajo();
    const topeBarras = abajo.length > 0 ? Math.min(...abajo.map((el) => el.getBoundingClientRect().top)) : H - I.b;
    let ultimo: Element | null = null, ultimoFondo = -Infinity;
    for (const el of todos) {
      if (!el.closest("#principal") || el.id === "principal") continue;
      if (el.closest(".acceso-fijo")) continue;
      const tiene = (el.textContent ?? "").trim() !== "" || /^(INPUT|TEXTAREA|SELECT|PROGRESS|svg|BUTTON)$/i.test(el.tagName);
      if (!tiene || el.children.length > 0 && !/^(BUTTON)$/i.test(el.tagName)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > ultimoFondo) { ultimoFondo = r.bottom; ultimo = el; }
    }
    if (ultimo && ultimoFondo > topeBarras + 0.5) add("ultimo-elemento-tapado", `${nom(ultimo)} termina en y ${r1(ultimoFondo)} y la barra empieza en ${r1(topeBarras)}`);
  }
  // d) controles tapados (se acerca cada uno al centro de la pantalla y se mira quién recibe el toque)
  for (const el of controles) {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const r = el.getBoundingClientRect();
    if (r.width === 0 || enChips(el)) continue;
    const y = r.top + (r.height > H * 0.5 ? 12 : r.height / 2);
    const x = Math.min(Math.max(r.left + r.width / 2, 1), W - 1);
    if (y < 0 || y > H) { add("control-fuera-de-vista", `${nom(el)} y ${r1(y)} de ${H}`); continue; }
    const golpe = document.elementFromPoint(x, y);
    if (!golpe || !(golpe === el || el.contains(golpe))) add("control-tapado", `${nom(el)} tapado por ${nom(golpe)}`);
  }
  // d) campos: al enfocarlos el navegador los acerca; no pueden quedar bajo la barra superior ni la inferior
  if (!modal) {
    for (const el of controles) {
      if (!["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || ["checkbox", "radio", "file"].includes((el as HTMLInputElement).type)) continue;
      for (const modo of ["desde-arriba", "desde-abajo"]) {
        window.scrollTo(0, modo === "desde-arriba" ? 0 : 1e7);
        el.scrollIntoView({ block: "nearest" });
        const r = el.getBoundingClientRect();
        const arriba = barrasArriba();
        const abajo = barrasAbajo();
        const limiteSup = arriba.length > 0 ? Math.max(...arriba.map((b) => b.getBoundingClientRect().bottom)) : 0;
        const limiteInf = abajo.length > 0 ? Math.min(...abajo.map((b) => b.getBoundingClientRect().top)) : H;
        if (r.top < limiteSup - 1 || r.bottom > limiteInf + 1) {
          add("campo-tapado-al-enfocar", `${nom(el)} ${modo} queda en y ${r1(r.top)}..${r1(r.bottom)} y lo libre es ${r1(limiteSup)}..${r1(limiteInf)}`);
          break;
        }
      }
    }
  }
  window.scrollTo(0, 0);
  return { problemas, controles: controles.length };
}

// ---------- recorrido ----------

interface Entorno {
  p: Cualquiera; ctx: Cualquiera; cdp: Cualquiera; url: string;
  ancho: number; alto: number; ins: Insets; apaisado: boolean;
  reg: (tipo: string, detalle: string) => void;
  /** Guarda la captura de ese estado si MOVIL_CAPTURAS está definido. */
  foto: (nombre: string) => Promise<void>;
}
interface Estado { pantalla: string; nombre: string; hacer: (e: Entorno) => Promise<void>; girar?: boolean }

const calma = async (e: Entorno): Promise<void> => {
  await e.p.evaluate(() => (document as any).fonts.ready);
  await e.p.waitForTimeout(110);
};

/** Toca un control como lo haría un dedo: si no se puede (algo lo tapa) queda anotado y se sigue con un clic forzado por código. */
async function tocar(e: Entorno, loc: Cualquiera, quien: string): Promise<void> {
  const el = loc.first();
  if ((await loc.count()) === 0) { e.reg("recorrido", `no existe ${quien}`); return; }
  try {
    await el.click({ timeout: 3500 });
  } catch (err) {
    const msg = String((err as Error).message);
    if (/intercepts pointer events|not visible|outside of the viewport|not stable/.test(msg)) {
      e.reg("no-se-puede-tocar", `${quien} (${/intercepts/.test(msg) ? "lo tapa otro elemento" : "fuera de la vista"})`);
      await el.evaluate((n: HTMLElement) => n.click());
    } else {
      e.reg("recorrido", `${quien}: ${msg.split("\n")[0]}`);
    }
  }
  await calma(e);
}
const porTexto = (e: Entorno, rol: string, re: RegExp | string): Cualquiera => e.p.locator(rol, { hasText: re });
const boton = (e: Entorno, re: RegExp | string): Cualquiera => e.p.locator("button", { hasText: re });
const irNav = async (e: Entorno, nombre: string): Promise<void> => { await tocar(e, e.p.locator("nav .nav-item", { hasText: nombre }), `pestaña ${nombre}`); };
const reiniciar = async (e: Entorno): Promise<void> => {
  await e.p.reload();
  await e.p.waitForSelector("nav .nav-item");
  await calma(e);
};
const llenar = async (e: Entorno, sel: string, texto: string): Promise<void> => {
  if ((await e.p.locator(sel).count()) === 0) { e.reg("recorrido", `no existe ${sel}`); return; }
  await e.p.fill(sel, texto);
  await calma(e);
};

async function abrirAreaLarga(e: Entorno): Promise<void> {
  await irNav(e, "Áreas");
  await tocar(e, e.p.locator("button.area-abrir", { hasText: /^Áreaconun/ }), "área larga");
}
async function abrirMenuTema(e: Entorno): Promise<void> {
  await tocar(e, e.p.locator('button[aria-label^="Más opciones de Tema_con"]'), "menú del tema largo");
}
async function terminarSesion(e: Entorno, veces = 12): Promise<void> {
  for (let i = 0; i < veces; i++) {
    const bien = e.p.locator("button.calificar-bien");
    const ver = e.p.locator("button", { hasText: /^Ver respuesta/ });
    if ((await bien.count()) > 0) await tocar(e, bien, "Bien");
    else if ((await ver.count()) > 0) await tocar(e, ver, "Ver respuesta");
    else break;
  }
}

const ESTADOS: Estado[] = [
  // ----- Hoy
  { pantalla: "hoy", nombre: "con estadisticas y tareas", girar: true, hacer: async (e) => { await reiniciar(e); await irNav(e, "Hoy"); } },
  { pantalla: "hoy", nombre: "tarea rapida con texto largo", hacer: async (e) => { await llenar(e, "#tarea-rapida", `${L1}${L1}`); await e.p.focus("#tarea-rapida"); } },
  { pantalla: "hoy", nombre: "panel de estadisticas abierto", girar: true, hacer: async (e) => { await llenar(e, "#tarea-rapida", ""); await tocar(e, e.p.locator("#ver-estadisticas"), "Ver estadísticas"); } },
  // ----- Repaso
  { pantalla: "repaso", nombre: "pregunta de la cola del dia", girar: true, hacer: async (e) => { await reiniciar(e); await irNav(e, "Repaso"); } },
  { pantalla: "repaso", nombre: "area larga: pregunta", girar: true, hacer: async (e) => { await tocar(e, e.p.locator("button.chip", { hasText: /^Áreaconun/ }), "chip del área larga"); } },
  { pantalla: "repaso", nombre: "area larga: pista", hacer: async (e) => { await tocar(e, boton(e, /^Ver pista/), "Ver pista"); } },
  { pantalla: "repaso", nombre: "resumen del tema (dialogo)", girar: true, hacer: async (e) => { await tocar(e, e.p.locator("#r-ver-resumen"), "Ver el resumen del tema"); } },
  { pantalla: "repaso", nombre: "area larga: respuesta", girar: true, hacer: async (e) => {
    await tocar(e, e.p.locator("#r-resumen-cerrar"), "Cerrar resumen");
    await tocar(e, boton(e, /^Ver respuesta/), "Ver respuesta");
  } },
  { pantalla: "repaso", nombre: "modo libre: pregunta", hacer: async (e) => { await tocar(e, e.p.locator("#r-modo-libre"), "Repasar todo"); } },
  { pantalla: "repaso", nombre: "modo libre: respuesta", girar: true, hacer: async (e) => { await tocar(e, boton(e, /^Ver respuesta/), "Ver respuesta"); } },
  { pantalla: "repaso", nombre: "modo libre: fin de sesion", girar: true, hacer: async (e) => { await terminarSesion(e, 12); } },
  { pantalla: "repaso", nombre: "modo libre: salir al repaso del dia", hacer: async (e) => { await tocar(e, e.p.locator("#r-volver-dia"), "Volver al repaso del día"); } },
  { pantalla: "repaso", nombre: "sin tarjetas para hoy", girar: true, hacer: async (e) => {
    await tocar(e, e.p.locator("button.chip", { hasText: /^Idiomas/ }), "chip Idiomas");
    await terminarSesion(e, 6);
  } },
  // ----- Áreas
  { pantalla: "areas", nombre: "con datos", girar: true, hacer: async (e) => { await reiniciar(e); await irNav(e, "Áreas"); } },
  { pantalla: "areas", nombre: "nueva area repetida (error)", hacer: async (e) => {
    await llenar(e, "#a-nueva-area", AREA_LARGA);
    await tocar(e, boton(e, /^Crear área/), "Crear área");
  } },
  // ----- Detalle de área
  { pantalla: "area", nombre: "detalle del area larga", girar: true, hacer: async (e) => { await reiniciar(e); await abrirAreaLarga(e); } },
  { pantalla: "area", nombre: "menu del tema abierto", hacer: async (e) => { await abrirMenuTema(e); } },
  { pantalla: "area", nombre: "resumen del tema", girar: true, hacer: async (e) => { await tocar(e, boton(e, /^Ver el resumen/), "Ver el resumen"); } },
  { pantalla: "area", nombre: "mover tema", girar: true, hacer: async (e) => {
    await abrirMenuTema(e);
    await tocar(e, boton(e, /^Mover…/), "Mover…");
  } },
  { pantalla: "area", nombre: "confirmar borrar tema", girar: true, hacer: async (e) => {
    await tocar(e, boton(e, /^Cancelar/), "Cancelar mover");
    await abrirMenuTema(e);
    await tocar(e, boton(e, /^Borrar tema/), "Borrar tema");
  } },
  { pantalla: "area", nombre: "confirmar borrar subarea", hacer: async (e) => {
    await tocar(e, boton(e, /^Cancelar/), "Cancelar");
    await tocar(e, e.p.locator('button[aria-label^="Borrar subárea"]'), "Borrar subárea");
  } },
  { pantalla: "area", nombre: "confirmar borrar area", girar: true, hacer: async (e) => {
    await tocar(e, boton(e, /^Cancelar/), "Cancelar");
    await tocar(e, e.p.locator("#a-borrar-area"), "Borrar área");
  } },
  { pantalla: "area", nombre: "aviso con deshacer", girar: true, hacer: async (e) => {
    await tocar(e, boton(e, /^Cancelar/), "Cancelar");
    await abrirMenuTema(e);
    await tocar(e, boton(e, /^Borrar tema/), "Borrar tema");
    await tocar(e, boton(e, /^Mover a la papelera/), "Mover a la papelera");
  } },
  { pantalla: "area", nombre: "detalle de area normal", hacer: async (e) => {
    await tocar(e, e.p.locator("#a-deshacer"), "Deshacer");
    await tocar(e, e.p.locator("#a-volver"), "Todas las áreas");
    await tocar(e, e.p.locator("button.area-abrir", { hasText: /^Programación/ }), "área Programación");
  } },
  { pantalla: "areas", nombre: "aviso con deshacer tras borrar un area", girar: true, hacer: async (e) => {
    await tocar(e, e.p.locator("#a-volver"), "Todas las áreas");
    await tocar(e, e.p.locator("button.area-abrir", { hasText: /^Negocios/ }), "área Negocios");
    await tocar(e, e.p.locator("#a-borrar-area"), "Borrar área");
    await tocar(e, boton(e, /^Mover a la papelera/), "Mover a la papelera");
  } },
  // ----- Tareas
  { pantalla: "tareas", nombre: "lista y metas", girar: true, hacer: async (e) => { await reiniciar(e); await irNav(e, "Tareas"); } },
  { pantalla: "tareas", nombre: "formulario nueva tarea", girar: true, hacer: async (e) => {
    await tocar(e, boton(e, /^Nueva tarea/), "Nueva tarea");
    await llenar(e, "#tarea-titulo", `${L1}${L1}`);
    await llenar(e, "#tarea-nota", `Nota con ${URL_LARGA}`);
  } },
  { pantalla: "tareas", nombre: "formulario con repeticion semanal", girar: true, hacer: async (e) => { await e.p.selectOption("#tarea-repetir", "semanal"); await calma(e); } },
  { pantalla: "tareas", nombre: "formulario con repeticion mensual", hacer: async (e) => { await e.p.selectOption("#tarea-repetir", "mensual"); await calma(e); } },
  { pantalla: "tareas", nombre: "editar una tarea", hacer: async (e) => {
    await tocar(e, boton(e, /^Cancelar/), "Cancelar");
    await tocar(e, e.p.locator("li", { hasText: L1 }).locator("button", { hasText: /^Editar/ }), "Editar tarea larga");
  } },
  { pantalla: "tareas", nombre: "formulario meta anual", girar: true, hacer: async (e) => {
    await tocar(e, boton(e, /^Cancelar/), "Cancelar");
    await tocar(e, boton(e, /^Nueva meta anual/), "Nueva meta anual");
    await llenar(e, "#meta-titulo", `${L1}${L1}`);
  } },
  { pantalla: "tareas", nombre: "formulario meta trimestral", girar: true, hacer: async (e) => {
    await tocar(e, boton(e, /^Cancelar/), "Cancelar");
    await tocar(e, boton(e, /^Nueva meta trimestral/), "Nueva meta trimestral");
    await llenar(e, "#meta-titulo", `${L1}${L1}`);
  } },
  // ----- Apuntes
  { pantalla: "apuntes", nombre: "lista de apuntes", girar: true, hacer: async (e) => { await reiniciar(e); await irNav(e, "Apuntes"); } },
  { pantalla: "apuntes", nombre: "captura abierta", girar: true, hacer: async (e) => {
    await tocar(e, boton(e, /^Nuevo apunte/), "Nuevo apunte");
    await llenar(e, "#captura-texto", `Texto con **negrita** y ${URL_LARGA}`);
  } },
  { pantalla: "apuntes", nombre: "filtros aplicados", hacer: async (e) => {
    await tocar(e, boton(e, /^Cancelar/), "Cancelar");
    await e.p.selectOption("#filtro-tipo", "idea");
    await calma(e);
  } },
  { pantalla: "apuntes", nombre: "busqueda sin resultados", hacer: async (e) => {
    await e.p.selectOption("#filtro-tipo", "");
    await llenar(e, "#busqueda-apuntes", `${L1}${L1}`);
  } },
  { pantalla: "apuntes", nombre: "edicion de un apunte", girar: true, hacer: async (e) => {
    await llenar(e, "#busqueda-apuntes", "");
    await tocar(e, e.p.locator("li.apunte", { hasText: URL_LARGA }).locator("button", { hasText: /^Editar/ }), "Editar apunte largo");
  } },
  { pantalla: "apuntes", nombre: "conversion a tarjeta", girar: true, hacer: async (e) => {
    await tocar(e, boton(e, /^Cancelar/), "Cancelar");
    await tocar(e, e.p.locator("li.apunte").first().locator("button", { hasText: /^Pasar a tarjeta/ }), "Pasar a tarjeta");
  } },
  // ----- Tarjetas
  { pantalla: "tarjetas", nombre: "lista de tarjetas", girar: true, hacer: async (e) => { await reiniciar(e); await irNav(e, "Áreas"); await tocar(e, e.p.locator("#a-ver-tarjetas"), "Ver todas las tarjetas"); } },
  { pantalla: "tarjetas", nombre: "busqueda con resultados", hacer: async (e) => { await llenar(e, "#busqueda", "puntero"); } },
  { pantalla: "tarjetas", nombre: "busqueda sin resultados", hacer: async (e) => { await llenar(e, "#busqueda", `${L1}${L1}`); } },
  { pantalla: "tarjetas", nombre: "edicion de una tarjeta", girar: true, hacer: async (e) => {
    await llenar(e, "#busqueda", "");
    await tocar(e, e.p.locator("li", { hasText: L1 }).first().locator("button", { hasText: /^Editar/ }), "Editar tarjeta larga");
  } },
  { pantalla: "tarjetas", nombre: "papelera con items", girar: true, hacer: async (e) => {
    await tocar(e, boton(e, /^Cancelar/), "Cancelar");
    await tocar(e, boton(e, /papelera \(/), "Ver papelera");
  } },
  { pantalla: "tarjetas", nombre: "importar vacio", girar: true, hacer: async (e) => {
    await tocar(e, boton(e, /papelera \(/), "Ocultar papelera");
    await tocar(e, boton(e, /^Importar/), "Importar");
  } },
  { pantalla: "tarjetas", nombre: "importar con recordatorio", hacer: async (e) => { await tocar(e, e.p.locator("#importar-revisar"), "Revisar"); } },
  { pantalla: "tarjetas", nombre: "importar con errores", girar: true, hacer: async (e) => {
    await llenar(e, "#caja-importar", JSON_MALO);
    await tocar(e, e.p.locator("#importar-revisar"), "Revisar");
  } },
  { pantalla: "tarjetas", nombre: "importar con vista previa y errores", girar: true, hacer: async (e) => {
    await llenar(e, "#caja-importar", JSON_PARCIAL);
    await tocar(e, e.p.locator("#importar-revisar"), "Revisar");
  } },
  { pantalla: "tarjetas", nombre: "importar con informe", girar: true, hacer: async (e) => { await tocar(e, e.p.locator("#importar-confirmar"), "Confirmar importación"); } },
  // ----- Ajustes
  { pantalla: "ajustes", nombre: "completo", girar: true, hacer: async (e) => { await reiniciar(e); await tocar(e, e.p.locator("#ir-ajustes"), "Ajustes"); } },
  { pantalla: "ajustes", nombre: "numero invalido", hacer: async (e) => { await llenar(e, "#ajuste-nuevas", "5000"); await e.p.dispatchEvent("#ajuste-nuevas", "change"); await calma(e); } },
  { pantalla: "ajustes", nombre: "inicio de sesion con error", girar: true, hacer: async (e) => {
    await e.p.fill("#ajuste-nuevas", "20");
    await e.p.dispatchEvent("#ajuste-nuevas", "change");
    await calma(e);
    if ((await e.p.locator("#cuenta-clave").count()) > 0) {
      await llenar(e, "#cuenta-clave", L1);
      await tocar(e, boton(e, /^Iniciar sesión/), "Iniciar sesión");
    }
  } },
  { pantalla: "ajustes", nombre: "respaldo con informe", girar: true, hacer: async (e) => {
    await e.p.setInputFiles("#archivo-respaldo", { name: `${L1}${L1}.json`, mimeType: "application/json", buffer: Buffer.from("esto no es un respaldo") });
    await calma(e);
  } },
  { pantalla: "ajustes", nombre: "migracion con informe", girar: true, hacer: async (e) => {
    await e.p.setInputFiles("#archivo-original", { name: `${L1}${L1}.json`, mimeType: "application/json", buffer: Buffer.from("{\"cosa\": 1}") });
    await calma(e);
  } },
];

/** Recorrido de la app sin datos (primera vez que se abre). */
const ESTADOS_VACIOS: Estado[] = [
  { pantalla: "hoy", nombre: "vacio", hacer: async (e) => { await reiniciar(e); await irNav(e, "Hoy"); } },
  { pantalla: "repaso", nombre: "vacio", hacer: async (e) => { await irNav(e, "Repaso"); } },
  { pantalla: "areas", nombre: "vacia", girar: true, hacer: async (e) => { await irNav(e, "Áreas"); } },
  { pantalla: "areas", nombre: "nueva area con error", hacer: async (e) => { await tocar(e, boton(e, /^Crear área/), "Crear área"); } },
  { pantalla: "tareas", nombre: "vacia", hacer: async (e) => { await irNav(e, "Tareas"); } },
  { pantalla: "apuntes", nombre: "vacio", hacer: async (e) => { await irNav(e, "Apuntes"); } },
  { pantalla: "tarjetas", nombre: "vacia", hacer: async (e) => { await irNav(e, "Áreas"); await tocar(e, e.p.locator("#a-importar"), "Importar"); } },
  { pantalla: "ajustes", nombre: "sin datos", hacer: async (e) => { await tocar(e, e.p.locator("#ir-ajustes"), "Ajustes"); } },
];

// ---------- siembra por la interfaz ----------

async function sembrar(navegador: Cualquiera, url: string, base: Record<string, unknown>): Promise<Cualquiera> {
  const ctx = await navegador.newContext({ ...base, viewport: { width: 1280, height: 900 } });
  await ctx.clock.setFixedTime(DIA_SIEMBRA);
  const p = await ctx.newPage();
  const errores: string[] = [];
  p.on("pageerror", (x: Error) => errores.push(x.message));
  const e: Entorno = { p, ctx, cdp: null, url, ancho: 1280, alto: 900, ins: { t: 0, r: 0, b: 0, l: 0 }, apaisado: false, reg: (t, d) => errores.push(`${t}: ${d}`), foto: async () => undefined };
  await p.goto(url);
  await p.waitForSelector("nav .nav-item");
  // importar tarjetas
  await irNav(e, "Áreas");
  await tocar(e, p.locator("#a-importar"), "Importar");
  await p.fill("#caja-importar", jsonDe(BLOQUES));
  await tocar(e, p.locator("#importar-revisar"), "Revisar");
  await tocar(e, p.locator("#importar-confirmar"), "Confirmar");
  await p.waitForSelector("#importar-informe");
  // repasos el día de la siembra (quedan vencidas, otras nuevas y otras al día)
  const repasar = async (area: RegExp, cuantas: number, nota: RegExp): Promise<void> => {
    await irNav(e, "Repaso");
    await tocar(e, p.locator("button.chip", { hasText: area }), "chip");
    for (let i = 0; i < cuantas; i++) {
      await tocar(e, p.locator("button", { hasText: /^Ver respuesta/ }), "Ver respuesta");
      await tocar(e, p.locator("button", { hasText: nota }), "calificar");
    }
  };
  await repasar(/^Negocios/, 2, /^Fácil/);
  await repasar(/^Programación/, 3, /^Bien/);
  await repasar(/^Programación/, 1, /^Difícil/);
  // se pasa al día de la vista: más repasos (estadísticas) y tarjetas suspendidas
  await ctx.clock.setFixedTime(DIA_VISTA);
  await p.reload();
  await p.waitForSelector("nav .nav-item");
  await repasar(/^Programación/, 1, /^Bien/);
  await irNav(e, "Áreas");
  await tocar(e, p.locator("#a-ver-tarjetas"), "Ver todas las tarjetas");
  for (const area of [/^Negocios/, /^Programación/]) {
    await tocar(e, p.locator("section.grupo-tarjetas", { has: p.locator("h2", { hasText: area }) }).locator("button", { hasText: /^Suspender$/ }), "Suspender");
  }
  // tarjeta a la papelera
  await tocar(e, p.locator("section.grupo-tarjetas", { has: p.locator("h2", { hasText: /^Negocios/ }) }).locator("button", { hasText: /^Borrar$/ }), "Borrar tarjeta");
  // metas
  await irNav(e, "Tareas");
  await tocar(e, p.locator("button", { hasText: /^Nueva meta anual/ }), "Nueva meta anual");
  await p.fill("#meta-titulo", `Meta anual ${L1}`);
  await tocar(e, p.locator("button", { hasText: /^Guardar meta/ }), "Guardar meta");
  await tocar(e, p.locator("button", { hasText: /^Nueva meta trimestral/ }), "Nueva meta trimestral");
  await p.fill("#meta-titulo", `Meta trimestral ${L1}${L1}`);
  await p.selectOption("#meta-padre", { index: 1 });
  await tocar(e, p.locator("button", { hasText: /^Guardar meta/ }), "Guardar meta");
  await tocar(e, p.locator("button", { hasText: /^Nueva meta trimestral/ }), "Nueva meta trimestral");
  await p.fill("#meta-titulo", "Meta trimestral corta");
  await tocar(e, p.locator("button", { hasText: /^Guardar meta/ }), "Guardar meta");
  // tareas: atrasada, de hoy, futura, sin fecha, con meta, con repeticiones
  const tarea = async (o: { titulo: string; fecha?: string; nota?: string; meta?: boolean; repetir?: "diaria" | "semanal" | "mensual" }): Promise<void> => {
    await tocar(e, p.locator("button", { hasText: /^Nueva tarea/ }), "Nueva tarea");
    await p.fill("#tarea-titulo", o.titulo);
    if (o.fecha) await p.fill("#tarea-fecha", o.fecha);
    if (o.nota) await p.fill("#tarea-nota", o.nota);
    if (o.meta) await p.selectOption("#tarea-meta", { index: 1 });
    if (o.repetir) {
      await p.selectOption("#tarea-repetir", o.repetir);
      await calma(e);
      if (o.repetir === "semanal") { await p.locator("label.chip-dia", { hasText: "L" }).first().click(); await p.locator("label.chip-dia", { hasText: "J" }).first().click(); }
      if (o.repetir === "mensual") await p.fill("#tarea-repetir-dia-mes", "15");
    }
    await tocar(e, p.locator("button", { hasText: /^Guardar tarea/ }), "Guardar tarea");
  };
  await tarea({ titulo: `Tarea atrasada ${L1}${L1}`, fecha: "2026-11-18", nota: `Una nota larga con ${URL_LARGA}`, meta: true });
  await tarea({ titulo: "Tarea de hoy que se repite", fecha: "2026-11-23", repetir: "semanal" });
  await tarea({ titulo: "Tarea diaria", fecha: "2026-11-23", repetir: "diaria" });
  await tarea({ titulo: "Tarea mensual", fecha: "2026-11-24", repetir: "mensual" });
  await tarea({ titulo: "Tarea futura", fecha: "2026-12-05" });
  await tarea({ titulo: `Tarea sin fecha ${L1}`, nota: "Nota corta", meta: true });
  await tarea({ titulo: "Tarea para marcar" });
  await tarea({ titulo: "Tarea para borrar" });
  await tocar(e, p.locator("input.casilla[aria-label*='Tarea para marcar']"), "tildar tarea");
  await tocar(e, p.locator("li", { hasText: "Tarea para borrar" }).locator("button", { hasText: /^Borrar/ }), "Borrar tarea");
  // apuntes: los tres tipos, con etiquetas, markdown y textos largos
  await irNav(e, "Apuntes");
  const apunte = async (texto: string, o: { titulo: string; tipo: string; etiquetas: string; area?: boolean }): Promise<void> => {
    await tocar(e, p.locator("button", { hasText: /^Nuevo apunte/ }), "Nuevo apunte");
    await p.fill("#captura-texto", texto);
    await tocar(e, p.locator("button", { hasText: /^Guardar apunte/ }), "Guardar apunte");
    await tocar(e, p.locator("li.apunte").first().locator("button", { hasText: /^Editar/ }), "Editar apunte");
    await p.fill("#apunte-titulo", o.titulo);
    await p.fill("#apunte-etiquetas", o.etiquetas);
    await p.selectOption("#apunte-tipo", o.tipo);
    if (o.area) await p.selectOption("#apunte-area", { index: 1 });
    await tocar(e, p.locator("button", { hasText: /^Guardar apunte/ }), "Guardar apunte");
  };
  await apunte(`Una **idea** con lista:\n\n- uno\n- dos con ${URL_LARGA}\n\nY un [enlace](https://ejemplo.com/x).`, { titulo: `Idea ${L1}`, tipo: "idea", etiquetas: `ideas, ${L1}, otra` });
  await apunte("Un apunte corto de clase con *cursiva* y **negrita**.", { titulo: "Apunte de clase", tipo: "apunte", etiquetas: "clase, estudio", area: true });
  await apunte(`Lo aprendido: ${L1}${L1} y 1. primero\n2. segundo`, { titulo: "", tipo: "aprendizaje", etiquetas: "aprendizaje" });
  await apunte("Apunte para borrar", { titulo: "Para borrar", tipo: "apunte", etiquetas: "" });
  await tocar(e, p.locator("li.apunte", { hasText: "Para borrar" }).locator("button", { hasText: /^Borrar/ }), "Borrar apunte");
  const estado = await ctx.storageState({ indexedDB: true });
  await ctx.close();
  if (errores.length > 0) throw new Error(`la siembra falló: ${[...new Set(errores)].slice(0, 5).join(" | ")}`);
  return estado;
}

// ---------- una combinación (tamaño x orientación x tema) ----------

interface Resultado { problemas: (Hallazgo & { dispositivo: string; orientacion: string; tema: string; pantalla: string; estado: string })[]; mediciones: number; estados: Set<string> }

const insetsDe = (apaisado: boolean, notch: boolean): Insets => (!notch ? { t: 0, r: 0, b: 0, l: 0 } : apaisado ? { t: 0, r: 47, b: 21, l: 47 } : { t: 47, r: 0, b: 34, l: 0 });

async function correrCombinacion(navegador: Cualquiera, url: string, base: Record<string, unknown>, estadoSembrado: Cualquiera, disp: Dispositivo, orient: Orientacion, tema: Tema): Promise<Resultado> {
  const res: Resultado = { problemas: [], mediciones: 0, estados: new Set() };
  const apaisado = orient === "apaisado";
  const ancho = apaisado ? disp.alto : disp.ancho;
  const alto = apaisado ? disp.ancho : disp.alto;
  const dir = process.env["MOVIL_CAPTURAS"];
  for (const conDatos of [true, false]) {
    const ctx = await navegador.newContext({
      ...base, ...disp.descriptor, viewport: { width: ancho, height: alto }, screen: { width: ancho, height: alto },
      deviceScaleFactor: disp.escala, isMobile: true, hasTouch: true, colorScheme: tema === "oscuro" ? "dark" : "light",
      ...(conDatos ? { storageState: estadoSembrado } : {}),
    });
    await ctx.clock.setFixedTime(DIA_VISTA);
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    const e: Entorno = {
      p, ctx, cdp, url, ancho, alto, ins: insetsDe(apaisado, disp.notch), apaisado,
      reg: () => undefined, foto: async () => undefined,
    };
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: e.ins.t, right: e.ins.r, bottom: e.ins.b, left: e.ins.l } });
    let actual: Estado = ESTADOS[0]!;
    let sufijo = "";
    const registrar = (tipo: string, detalle: string) => {
      res.problemas.push({ dispositivo: disp.nombre, orientacion: e.apaisado ? "apaisado" : "vertical", tema, pantalla: actual.pantalla, estado: actual.nombre + sufijo, tipo, detalle });
    };
    e.reg = registrar;
    p.on("pageerror", (x: Error) => registrar("error-de-pagina", x.message.slice(0, 160)));
    await p.goto(url);
    await p.waitForSelector("nav .nav-item");
    const medir = async (): Promise<void> => {
      await calma(e);
      const r = await p.evaluate(medirPagina, { ancho: e.ancho, alto: e.alto, ins: e.ins, minimo: MINIMO });
      res.mediciones++;
      for (const h of r.problemas) registrar(h.tipo, h.detalle);
      if (dir) {
        mkdirSync(dir, { recursive: true });
        const nombre = `${disp.nombre}-${e.apaisado ? "apaisado" : "vertical"}-${tema}-${actual.pantalla}-${actual.nombre}${sufijo}${conDatos ? "" : "-vacio"}`.replace(/[^A-Za-z0-9._-]+/g, "_");
        await p.screenshot({ path: join(dir, `${nombre}.png`), animations: "disabled" });
      }
    };
    const lista = conDatos ? ESTADOS : ESTADOS_VACIOS;
    for (const est of lista) {
      actual = est;
      sufijo = conDatos ? "" : " (sin datos)";
      res.estados.add(`${est.pantalla}: ${est.nombre}${sufijo}`);
      try { await est.hacer(e); } catch (err) { registrar("recorrido", String((err as Error).message).split("\n")[0]!.slice(0, 200)); }
      await medir();
      if (est.girar) {
        // f) al girar el celular: misma pantalla, sin scroll horizontal ni desplazamientos, y se vuelve a la posición de partida
        const antes = { ancho: e.ancho, alto: e.alto };
        e.apaisado = !e.apaisado; e.ancho = antes.alto; e.alto = antes.ancho; e.ins = insetsDe(e.apaisado, disp.notch);
        sufijo = (conDatos ? "" : " (sin datos)") + " [al girar]";
        await p.setViewportSize({ width: e.ancho, height: e.alto });
        await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: e.ins.t, right: e.ins.r, bottom: e.ins.b, left: e.ins.l } });
        await medir();
        e.apaisado = !e.apaisado; e.ancho = antes.ancho; e.alto = antes.alto; e.ins = insetsDe(e.apaisado, disp.notch);
        sufijo = conDatos ? "" : " (sin datos)";
        await p.setViewportSize({ width: e.ancho, height: e.alto });
        await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: e.ins.t, right: e.ins.r, bottom: e.ins.b, left: e.ins.l } });
        await calma(e);
      }
    }
    await ctx.close();
  }
  return res;
}

// ---------- principal ----------

async function main(): Promise<number> {
  const pw = cargarPlaywright();
  if (!pw) {
    console.error([
      "No se encontró Playwright. `npm run movil` usa el Playwright instalado en el sistema (no es una dependencia del proyecto).",
      "Instalalo con:  npm install -g playwright && npx playwright install chromium",
      "Si ya está instalado en otra carpeta, apuntá NODE_PATH a la carpeta de módulos globales (por ejemplo: NODE_PATH=$(npm root -g) npm run movil).",
    ].join("\n"));
    return 2;
  }
  if (!existsSync(join(DIST, "index.html"))) {
    console.log("Falta dist/: corriendo npm run build…");
    const b = spawnSync("npm", ["run", "build"], { cwd: RAIZ, stdio: "inherit" });
    if (b.status !== 0) { console.error("No se pudo armar dist/."); return 2; }
  }
  const dispositivos: Dispositivo[] = TAMANOS.map(([ancho, alto, escala, userAgent]) => ({
    nombre: `${ancho}x${alto}`, ancho, alto, escala, origen: "tamano" as const, descriptor: { userAgent }, notch: userAgent === UA_IPHONE && alto >= 812,
  }));
  for (const nombre of DEVICES_PW) {
    const d = pw.devices?.[nombre];
    if (!d) continue;
    dispositivos.push({ nombre, ancho: d.viewport.width, alto: d.viewport.height, escala: d.deviceScaleFactor, origen: "playwright", descriptor: { userAgent: d.userAgent }, notch: /iPhone 1[3-9]/.test(nombre) });
  }
  const srv = await servirDist();
  let navegador: Cualquiera;
  try {
    try {
      navegador = await pw.chromium.launch();
    } catch (e) {
      console.error(`No se pudo abrir Chromium (${(e as Error).message.split("\n")[0]}). Instalalo con: npx playwright install chromium`);
      return 2;
    }
    const base = { locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires", serviceWorkers: "block", reducedMotion: "reduce" };
    console.log("Sembrando datos por la interfaz…");
    const estadoSembrado = await sembrar(navegador, srv.url, base);
    type Tarea = { disp: Dispositivo; orient: Orientacion; tema: Tema };
    let tareas: Tarea[] = dispositivos.flatMap((disp) => ORIENTACIONES.flatMap((orient) => TEMAS.map((tema) => ({ disp, orient, tema }))));
    const solo = process.env["MOVIL_SOLO"];
    if (solo) tareas = tareas.filter((t) => `${t.disp.nombre}:${t.orient}:${t.tema}` === solo);
    const todos: Resultado[] = [];
    let siguiente = 0;
    const paralelo = Number(process.env["MOVIL_PARALELO"] ?? 4);
    const obrero = async (): Promise<void> => {
      for (;;) {
        const t = tareas[siguiente++];
        if (!t) return;
        const r = await correrCombinacion(navegador, srv.url, base, estadoSembrado, t.disp, t.orient, t.tema);
        todos.push(r);
        console.log(`  ${t.disp.nombre} ${t.orient} ${t.tema}: ${r.mediciones} mediciones, ${r.problemas.length} problemas`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(paralelo, tareas.length) }, obrero));

    const unicos = new Map<string, Resultado["problemas"][number]>();
    for (const r of todos) for (const pr of r.problemas) unicos.set(JSON.stringify(pr), pr);
    const problemas = [...unicos.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const estados = new Set<string>();
    for (const r of todos) for (const s of r.estados) estados.add(s);
    const mediciones = todos.reduce((n, r) => n + r.mediciones, 0);
    const salida = {
      generado: new Date().toISOString().slice(0, 10),
      dispositivos: dispositivos.map((d) => ({ nombre: d.nombre, ancho: d.ancho, alto: d.alto, escala: d.escala, origen: d.origen })),
      orientaciones: ORIENTACIONES, temas: TEMAS,
      pantallas: [...PANTALLAS],
      estados: estados.size,
      problemas,
      resumen: { mediciones, problemas: problemas.length },
    };
    if (!process.env["MOVIL_NO_ESCRIBIR"]) writeFileSync(process.env["MOVIL_SALIDA"] ?? SALIDA, JSON.stringify(salida, null, 2) + "\n");
    console.log(`Dispositivos: ${dispositivos.length}. Estados distintos: ${estados.size}. Mediciones: ${mediciones}. Problemas: ${problemas.length}.`);
    const porTipo = new Map<string, number>();
    for (const pr of problemas) porTipo.set(pr.tipo, (porTipo.get(pr.tipo) ?? 0) + 1);
    for (const [t, n] of [...porTipo].sort()) console.log(`  ${t}: ${n}`);
    for (const pr of problemas.slice(0, 60)) console.log(`  [${pr.tipo}] ${pr.dispositivo} ${pr.orientacion} ${pr.tema} · ${pr.pantalla} · ${pr.estado}: ${pr.detalle}`);
    return problemas.length > 0 ? 1 : 0;
  } finally {
    await navegador?.close();
    srv.cerrar();
  }
}

process.exit(await main());
