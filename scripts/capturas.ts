/**
 * Capturas y medición real de la interfaz (criterios P18 y P15 de la visión).
 * Uso: `npm run capturas`.
 *
 * - Sirve `dist/` (lo arma con `npm run build` si falta) con un servidor propio en 127.0.0.1.
 * - Abre Chromium headless con el Playwright GLOBAL (no es dependencia del proyecto) y carga datos de ejemplo
 *   por la propia interfaz (importar con revisión, repasar, suspender) con un reloj fijo.
 * - Para 390, 768 y 1440 px, en claro y oscuro: guarda `docs/capturas/<pantalla>-<ancho>-<tema>.png`
 *   (Áreas, Repaso con la respuesta visible y Detalle de área, a escala 2) y mide todas las pantallas.
 * - Escribe `docs/capturas/medicion.json` y sale con código 1 si hay incumplimientos de P15.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { delimiter, dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(RAIZ, "dist");
const SALIDA = join(RAIZ, "docs", "capturas");

const ANCHOS = [390, 768, 1440] as const;
const ALTOS: Record<number, number> = { 390: 844, 768: 1024, 1440: 900 };
const TEMAS = ["claro", "oscuro"] as const;
const PANTALLAS = ["hoy", "repaso", "areas", "area", "tarjetas", "tareas", "apuntes", "ajustes"] as const;
const CON_CAPTURA = new Set<string>(["areas", "repaso", "area"]);
const MINIMO = 44;
/** Reloj fijo: los datos se importan y repasan el día 1 y se miran el día 2 (así hay tarjetas vencidas). */
const DIA_SIEMBRA = "2026-11-12T12:00:00-03:00";
const DIA_VISTA = "2026-11-23T12:00:00-03:00";

// ---------- datos de ejemplo ----------

type Par = [string, string];
interface Bloque { area: string; tema: string; resumen: string; preguntas: Par[] }

const BLOQUES: Bloque[] = [
  { area: "Programación > CS50", tema: "Punteros en C", resumen: "Un puntero guarda la dirección de memoria de otra variable. Se declara con * y la dirección se obtiene con &.", preguntas: [
    ["¿Qué guarda un puntero?", "La dirección de memoria de otra variable."],
    ["¿Qué operador devuelve la dirección de una variable?", "El operador & (ampersand)."],
    ["¿Para qué sirve * en un puntero ya declarado?", "Para acceder al valor guardado en esa dirección (desreferenciar)."],
    ["¿Qué es un puntero nulo?", "Un puntero que no apunta a ninguna dirección válida (NULL)."],
    ["¿Qué pasa si desreferenciás un puntero nulo?", "Falla de segmentación: el programa se cierra."],
    ["¿Cuántos bytes ocupa un puntero en un sistema de 64 bits?", "8 bytes."],
  ] },
  { area: "Programación > CS50", tema: "Arreglos y memoria", resumen: "Un arreglo es un bloque contiguo de memoria con elementos del mismo tipo.", preguntas: [
    ["¿Cómo se guardan los elementos de un arreglo en memoria?", "De forma contigua, uno a continuación del otro."],
    ["¿Qué índice tiene el primer elemento de un arreglo en C?", "El 0."],
    ["¿Qué es un desbordamiento de búfer?", "Escribir más allá del final de un arreglo, pisando memoria ajena."],
    ["¿Qué devuelve sizeof(arr) para int arr[10]?", "El tamaño total del arreglo en bytes (10 por el tamaño de un int)."],
    ["¿Un nombre de arreglo equivale a qué cuando se pasa a una función?", "A un puntero a su primer elemento."],
    ["¿Qué hace malloc?", "Reserva memoria dinámica en el heap y devuelve un puntero."],
  ] },
  { area: "Programación > CS50", tema: "Estructuras de datos", resumen: "Listas enlazadas, pilas, colas y tablas hash: cada una cambia velocidad por flexibilidad.", preguntas: [
    ["¿Qué ventaja tiene una lista enlazada sobre un arreglo?", "Se puede crecer o achicar sin mover todos los elementos."],
    ["¿Cuál es el orden de una pila?", "LIFO: el último en entrar es el primero en salir."],
    ["¿Cuál es el orden de una cola?", "FIFO: el primero en entrar es el primero en salir."],
    ["¿Qué es una colisión en una tabla hash?", "Dos claves distintas que dan el mismo índice."],
    ["¿Cuánto cuesta buscar en una tabla hash bien hecha?", "En promedio, tiempo constante O(1)."],
    ["¿Qué es un árbol binario de búsqueda?", "Un árbol donde lo menor va a la izquierda y lo mayor a la derecha de cada nodo."],
  ] },
  { area: "Programación > IA aplicada", tema: "Prompts efectivos", resumen: "Un buen prompt da contexto, tarea, formato esperado y ejemplos.", preguntas: [
    ["¿Qué cuatro partes ayudan a armar un prompt claro?", "Contexto, tarea, formato de salida y ejemplos."],
    ["¿Para qué sirven los ejemplos en un prompt?", "Para mostrar el estilo y el formato que se espera."],
    ["¿Qué es pedir razonamiento paso a paso?", "Indicarle al modelo que explique sus pasos antes de dar la respuesta."],
    ["¿Por qué conviene decir qué NO hacer?", "Acota el resultado y evita desvíos frecuentes."],
    ["¿Qué es un prompt de sistema?", "Instrucciones de fondo que fijan el rol y las reglas de la conversación."],
    ["¿Cómo se mejora un prompt que falla?", "Probando cambios de a uno y comparando los resultados."],
  ] },
  { area: "Programación > IA aplicada", tema: "Embeddings", resumen: "Un embedding es un vector que representa el significado de un texto.", preguntas: [
    ["¿Qué es un embedding?", "Un vector numérico que representa el significado de un texto."],
    ["¿Qué significa que dos embeddings estén cerca?", "Que los textos tienen significados parecidos."],
    ["¿Qué medida se usa a menudo para compararlos?", "La similitud del coseno."],
    ["¿Para qué sirve la búsqueda semántica?", "Para encontrar textos por significado, no solo por palabras exactas."],
    ["¿Qué es una base de datos vectorial?", "Una base optimizada para guardar y buscar vectores cercanos."],
    ["¿Se pueden comparar embeddings de modelos distintos?", "No: cada modelo tiene su propio espacio de vectores."],
  ] },
  { area: "Programación > IA aplicada", tema: "Evaluar modelos", resumen: "Se evalúa con un conjunto de casos fijo y métricas que reflejen el uso real.", preguntas: [
    ["¿Por qué usar un conjunto de pruebas fijo?", "Para comparar versiones del modelo o del prompt en igualdad de condiciones."],
    ["¿Qué es una alucinación?", "Una respuesta falsa dicha con seguridad."],
    ["¿Qué es la precisión de un clasificador?", "La proporción de aciertos entre lo que marcó como positivo."],
    ["¿Qué es la exhaustividad (recall)?", "La proporción de positivos reales que logró encontrar."],
    ["¿Qué riesgo tiene evaluar con los mismos ejemplos que se usaron para ajustar?", "Sobreestimar la calidad real: hay que separar ejemplos de prueba."],
    ["¿Cuándo conviene una revisión humana?", "Cuando la calidad es subjetiva o el error tiene un costo alto."],
  ] },
  { area: "Negocios > Las 32 leyes", tema: "Ley del enfoque", resumen: "Hacer pocas cosas bien suele rendir más que hacer muchas a medias.", preguntas: [
    ["¿Qué plantea la ley del enfoque?", "Que concentrarse en pocas prioridades rinde más que dispersarse."],
    ["¿Qué es el costo de oportunidad?", "Lo que se deja de ganar por elegir una opción en lugar de otra."],
    ["¿Cómo se elige qué priorizar?", "Por el impacto esperado sobre el objetivo principal."],
    ["¿Qué ayuda a decir que no a algo?", "Tener claro el objetivo y qué se posterga."],
    ["¿Qué señal indica falta de enfoque?", "Muchos proyectos abiertos y ninguno terminado."],
    ["¿Qué es una restricción útil?", "Un límite (tiempo, alcance) que obliga a decidir lo importante."],
  ] },
  { area: "Negocios > Las 32 leyes", tema: "Ley de la reputación", resumen: "La confianza se construye lento y se pierde rápido.", preguntas: [
    ["¿Por qué importa la reputación en un negocio?", "Porque reduce la desconfianza y hace más fácil vender y cobrar."],
    ["¿Cómo se construye confianza?", "Cumpliendo lo prometido, una y otra vez."],
    ["¿Qué hacer ante un error con un cliente?", "Reconocerlo pronto, repararlo y avisar qué cambia."],
    ["¿Qué son las referencias?", "Recomendaciones de clientes anteriores que respaldan tu trabajo."],
    ["¿Qué daña más la reputación?", "Prometer de más y entregar de menos."],
    ["¿Por qué importan los detalles chicos?", "Porque son lo que la gente recuerda y cuenta."],
  ] },
  { area: "Lógica > Brilliant", tema: "Silogismos", resumen: "Un silogismo saca una conclusión a partir de dos premisas.", preguntas: [
    ["¿Qué es un silogismo?", "Un razonamiento con dos premisas y una conclusión."],
    ["Todos los A son B y todos los B son C. ¿Qué se concluye?", "Todos los A son C."],
    ["¿Qué es una falacia?", "Un razonamiento que parece válido pero no lo es."],
    ["¿Qué diferencia hay entre válido y verdadero?", "Válido es la forma del argumento; verdadero depende de que las premisas lo sean."],
    ["¿Qué es la afirmación del consecuente?", "Concluir A de «si A entonces B» y B: es una falacia."],
    ["¿Qué es el modus ponens?", "De «si A entonces B» y A, se concluye B."],
  ] },
  { area: "Lógica > Brilliant", tema: "Probabilidad básica", resumen: "La probabilidad mide cuán posible es un suceso, de 0 a 1.", preguntas: [
    ["¿Qué valores toma una probabilidad?", "Entre 0 (imposible) y 1 (seguro)."],
    ["¿Cuál es la probabilidad de sacar cara en una moneda justa?", "1/2."],
    ["¿Cómo se calcula la probabilidad de dos sucesos independientes a la vez?", "Multiplicando las probabilidades."],
    ["¿Qué es la probabilidad condicional?", "La probabilidad de un suceso sabiendo que ocurrió otro."],
    ["¿Qué es la falacia del jugador?", "Creer que un resultado «está atrasado» cuando los sucesos son independientes."],
    ["¿Cuánto suman las probabilidades de todos los resultados posibles?", "1."],
  ] },
  { area: "Idiomas", tema: "Phrasal verbs", resumen: "Los phrasal verbs combinan un verbo con una partícula y cambian de significado.", preguntas: [
    ["¿Qué significa «give up»?", "Rendirse o dejar de intentar."],
    ["¿Qué significa «look after»?", "Cuidar a alguien o algo."],
    ["¿Qué significa «run out of»?", "Quedarse sin algo."],
    ["¿Qué significa «put off»?", "Posponer."],
    ["¿Qué significa «come across»?", "Encontrarse con algo o alguien por casualidad."],
    ["¿Qué significa «carry on»?", "Continuar."],
  ] },
  { area: "Idiomas", tema: "Verbos irregulares", resumen: "Los verbos irregulares no forman el pasado con -ed.", preguntas: [
    ["Pasado simple de «go»", "went."],
    ["Participio de «go»", "gone."],
    ["Pasado simple de «buy»", "bought."],
    ["Pasado simple de «think»", "thought."],
    ["Pasado simple de «teach»", "taught."],
    ["Participio de «write»", "written."],
  ] },
];

// Se intercalan las áreas para que las tarjetas nuevas del día (tope diario) queden repartidas entre todas.
const ORDEN = [0, 6, 8, 10, 3, 7, 9, 11, 1, 4, 2, 5];
const JSON_IMPORTAR = ORDEN.map((i) => BLOQUES[i]!).map((b) => ({
  tipo: "aprendizaje", fecha: "2026-11-12", area: b.area, tema: b.tema, resumen: b.resumen,
  preguntas: b.preguntas.map(([p, r]) => ({ p, r, pista: "" })),
}));

// ---------- Playwright global y servidor ----------

// Interfaces mínimas del Playwright global (no hay tipos en el proyecto a propósito).
/* eslint-disable @typescript-eslint/no-explicit-any */
type Pagina = any;

function cargarPlaywright(): any {
  const rutas = [...(process.env["NODE_PATH"] ?? "").split(delimiter).filter(Boolean)];
  const g = spawnSync("npm", ["root", "-g"], { encoding: "utf8" });
  if (g.status === 0 && g.stdout.trim()) rutas.push(g.stdout.trim());
  const req = createRequire(join(RAIZ, "package.json"));
  try {
    return req(req.resolve("playwright", { paths: [RAIZ, ...rutas] }));
  } catch {
    return null;
  }
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

// ---------- interacción ----------

async function esperarCalma(p: Pagina): Promise<void> {
  await p.evaluate(() => (document as any).fonts.ready);
  await p.waitForTimeout(250);
}

async function irA(p: Pagina, pantalla: string): Promise<void> {
  if (pantalla === "ajustes") await p.click("#ir-ajustes");
  else if (pantalla === "tarjetas") { await p.locator("nav .nav-item", { hasText: "Áreas" }).click(); await p.click("#a-ver-tarjetas"); }
  else if (pantalla === "area") {
    await p.locator("nav .nav-item", { hasText: "Áreas" }).click();
    await p.locator("button.area-abrir", { hasText: "Programación" }).click();
  } else {
    const nombre = { hoy: "Hoy", repaso: "Repaso", areas: "Áreas", tareas: "Tareas", apuntes: "Apuntes" }[pantalla]!;
    await p.locator("nav .nav-item", { hasText: nombre }).click();
  }
  await esperarCalma(p);
  if (pantalla === "repaso") {
    await p.locator("button", { hasText: /^Ver respuesta/ }).click();
    await esperarCalma(p);
  }
}

async function sembrar(p: Pagina, url: string, contexto: any): Promise<void> {
  await contexto.clock.setFixedTime(DIA_SIEMBRA);
  await p.goto(url);
  await p.waitForSelector("nav .nav-item");
  // Importar por la interfaz: Áreas > Ver todas las tarjetas > Importar > Revisar > Confirmar.
  await p.locator("nav .nav-item", { hasText: "Áreas" }).click();
  await p.click("#a-importar"); // con la app vacía, Áreas ofrece Importar y abre Tarjetas con la caja
  await p.fill("#caja-importar", JSON.stringify(JSON_IMPORTAR));
  await p.click("#importar-revisar");
  await p.click("#importar-confirmar");
  await p.waitForSelector("#importar-informe");
  // Repasar algunas tarjetas ese primer día, con distintas calificaciones.
  await p.locator("nav .nav-item", { hasText: "Repaso" }).click();
  const notas = [/^Bien/, /^Fácil/, /^Difícil/, /^Bien/, /^Otra vez/, /^Bien/, /^Fácil/, /^Bien/, /^Difícil/, /^Bien/, /^Bien/, /^Fácil/, /^Bien/, /^Bien/];
  for (const nota of notas) {
    await p.locator("button", { hasText: /^Ver respuesta/ }).click();
    await p.locator("button", { hasText: nota }).click();
    await p.waitForTimeout(60);
  }
  // Pasan once días: lo repasado hace tiempo vence; lo nuevo sigue nuevo.
  await contexto.clock.setFixedTime(DIA_VISTA);
  await p.reload();
  await p.waitForSelector("nav .nav-item");
  // Suspender unas tarjetas desde Tarjetas.
  await irA(p, "tarjetas");
  for (let i = 0; i < 4; i++) {
    await p.locator("button", { hasText: /^Suspender$/ }).nth(i * 3).click();
    await p.waitForTimeout(80);
  }
}

// ---------- medición ----------

interface Hallazgo { pantalla: string; ancho: number; tema: string; tipo: string; detalle: string }

async function medir(p: Pagina, pantalla: string, ancho: number, tema: string): Promise<{ controles: number; pequenos: Hallazgo[]; otros: Hallazgo[] }> {
  const r = await p.evaluate((minimo: number) => {
    const SEL = 'button, a[href], input, select, textarea, summary, [role=button], [tabindex]:not([tabindex="-1"])';
    const chicos: string[] = [];
    let controles = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(SEL))) {
      if (el instanceof HTMLInputElement && el.type === "hidden") continue;
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      if (cs.display === "none" || cs.visibility === "hidden" || b.width === 0 || b.height === 0) continue;
      controles++;
      if (b.width < minimo - 0.01 || b.height < minimo - 0.01) {
        const nombre = (el.getAttribute("aria-label") ?? el.textContent ?? el.getAttribute("placeholder") ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
        const id = el.id ? `#${el.id}` : el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/)[0]}` : "";
        chicos.push(`${el.tagName.toLowerCase()}${id} "${nombre}" ${Math.round(b.width * 10) / 10}x${Math.round(b.height * 10) / 10}`);
      }
    }
    const navs = Array.from(document.querySelectorAll("nav"));
    const nb = navs[0]?.getBoundingClientRect();
    return {
      controles, chicos,
      scroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollInfo: `${document.documentElement.scrollWidth} > ${document.documentElement.clientWidth}`,
      navs: navs.length, navTop: nb ? Math.round(nb.top) : -1, navBottom: nb ? Math.round(nb.bottom) : -1, alto: window.innerHeight,
    };
  }, MINIMO);
  const otros: Hallazgo[] = [];
  const base = { pantalla, ancho, tema };
  if (r.scroll) otros.push({ ...base, tipo: "scroll-horizontal", detalle: r.scrollInfo });
  const abajo = r.navBottom >= r.alto - 2 && r.navTop > r.alto / 2;
  const arriba = r.navBottom <= r.alto / 4; // barra en la cabecera, bien arriba
  const correcta = r.navs === 1 && (ancho <= 640 ? abajo : arriba);
  if (!correcta) otros.push({ ...base, tipo: "navegacion", detalle: `${r.navs} nav, top ${r.navTop}, bottom ${r.navBottom}, alto ${r.alto}: se esperaba barra ${ancho <= 640 ? "inferior" : "superior"}` });
  const pequenos = r.chicos.map((detalle: string) => ({ ...base, tipo: "control-menor-44", detalle }));
  return { controles: r.controles, pequenos, otros };
}

// ---------- principal ----------

async function main(): Promise<number> {
  const pw = cargarPlaywright();
  if (!pw) {
    console.error([
      "No se encontró Playwright. `npm run capturas` usa el Playwright instalado en el sistema (no es una dependencia del proyecto).",
      "Instalalo con:  npm install -g playwright && npx playwright install chromium",
      "Si ya está instalado en otra carpeta, apuntá NODE_PATH a la carpeta de módulos globales (por ejemplo: NODE_PATH=$(npm root -g) npm run capturas).",
    ].join("\n"));
    return 2;
  }
  if (!existsSync(join(DIST, "index.html"))) {
    console.log("Falta dist/: corriendo npm run build…");
    const b = spawnSync("npm", ["run", "build"], { cwd: RAIZ, stdio: "inherit" });
    if (b.status !== 0) { console.error("No se pudo armar dist/."); return 2; }
  }
  mkdirSync(SALIDA, { recursive: true });
  const srv = await servirDist();
  let navegador: any;
  try {
    try {
      navegador = await pw.chromium.launch();
    } catch (e) {
      console.error(`No se pudo abrir Chromium (${(e as Error).message.split("\n")[0]}). Instalalo con: npx playwright install chromium`);
      return 2;
    }
    const contexto = await navegador.newContext({
      viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires",
      serviceWorkers: "block", reducedMotion: "reduce",
    });
    const p: Pagina = await contexto.newPage();
    const errores: string[] = [];
    p.on("pageerror", (e: Error) => errores.push(e.message));
    await sembrar(p, srv.url, contexto);

    const incumplimientos: Hallazgo[] = [];
    const informativos: Hallazgo[] = [];
    let medidos = 0;
    for (const tema of TEMAS) {
      await p.emulateMedia({ colorScheme: tema === "oscuro" ? "dark" : "light", reducedMotion: "reduce" });
      await p.evaluate((t: string) => { document.documentElement.setAttribute("data-tema", t); localStorage.setItem("lean-os:tema", t); }, tema);
      for (const ancho of ANCHOS) {
        await p.setViewportSize({ width: ancho, height: ALTOS[ancho]! });
        for (const pantalla of PANTALLAS) {
          await irA(p, pantalla);
          const m = await medir(p, pantalla, ancho, tema);
          medidos += m.controles;
          (ancho === 390 ? incumplimientos : informativos).push(...m.pequenos);
          incumplimientos.push(...m.otros);
          if (CON_CAPTURA.has(pantalla)) {
            await p.screenshot({ path: join(SALIDA, `${pantalla}-${ancho}-${tema}.png`), animations: "disabled" });
          }
        }
      }
    }
    if (errores.length > 0) console.warn(`Avisos de la página: ${[...new Set(errores)].join(" | ")}`);

    const orden = (a: Hallazgo, b: Hallazgo) => JSON.stringify(a).localeCompare(JSON.stringify(b));
    const unicos = (l: Hallazgo[]) => [...new Map(l.map((h) => [JSON.stringify(h), h])).values()].sort(orden);
    const inc = unicos(incumplimientos);
    const info = unicos(informativos);
    const scroll = inc.filter((h) => h.tipo === "scroll-horizontal").length;
    const nav = inc.filter((h) => h.tipo === "navegacion").length;
    const medicion = {
      generado: new Date().toISOString().slice(0, 10),
      anchos: [...ANCHOS], temas: [...TEMAS], pantallas: [...PANTALLAS],
      incumplimientos: inc,
      informativos: info,
      resumen: { controlesMedidos: medidos, incumplimientos: inc.length, scrollHorizontal: scroll, navegacionCorrecta: nav === 0 },
    };
    writeFileSync(join(SALIDA, "medicion.json"), JSON.stringify(medicion, null, 2) + "\n");
    console.log(`Capturas en docs/capturas/ (${ANCHOS.length * TEMAS.length * CON_CAPTURA.size} PNG). Controles medidos: ${medidos}. Incumplimientos: ${inc.length}. Informativos (768/1440): ${info.length}.`);
    for (const h of inc.slice(0, 40)) console.log(`  [${h.tipo}] ${h.pantalla} ${h.ancho} ${h.tema}: ${h.detalle}`);
    return inc.length > 0 ? 1 : 0;
  } finally {
    await navegador?.close();
    srv.cerrar();
  }
}

process.exit(await main());
