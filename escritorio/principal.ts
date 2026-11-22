/**
 * Proceso principal de la app de Windows (Electron). La lógica del servidor local y del proxy está en
 * src/escritorio/servidor-local.ts (sin Electron). Se compila con `node escritorio/compilar.ts` a app/principal.cjs.
 * Variables de entorno (solo para pruebas y configuración, ignoradas en el uso normal salvo que se definan):
 *   LEAN_OS_DATOS     carpeta de datos (por defecto %APPDATA%/Lean OS)
 *   LEAN_OS_PUERTO    puerto local (por defecto 47821)
 *   LEAN_OS_SERVIDOR  URL del servidor remoto (por defecto config.json o https://lean-os.fly.dev)
 *   LEAN_OS_PRUEBA    salud | s1-escribir | s1-leer (modos de prueba, ver PROBAR.md)
 */
import { app, BrowserWindow, dialog, Menu, session, shell } from "electron";
import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { resolverCarpetaDatos } from "../src/escritorio/datos.ts";
import { codigoEscribir, codigoLeer } from "../src/escritorio/prueba-s1.ts";
import { iniciarServidorLocal, resolverPuerto, resolverServidorRemoto, type ServidorLocal } from "../src/escritorio/servidor-local.ts";

const env = process.env;
let carpetaDatos: string;
try {
  carpetaDatos = resolverCarpetaDatos(env, () => join(app.getPath("appData"), "Lean OS"));
} catch (e) {
  // Antes de crear o tocar cualquier carpeta.
  const mensaje = e instanceof Error ? e.message : String(e);
  console.error(mensaje);
  dialog.showErrorBox("Lean OS", mensaje);
  app.exit(1);
  throw e;
}
mkdirSync(carpetaDatos, { recursive: true });
app.setPath("userData", carpetaDatos);

const modoPrueba = env["LEAN_OS_PRUEBA"] ?? "";
if (modoPrueba) rmSync(join(carpetaDatos, "resultado-prueba.txt"), { force: true });
let servidor: ServidorLocal | null = null;
let ventana: BrowserWindow | null = null;

/** En modo de prueba deja el resultado en stdout y en <datos>/resultado-prueba.txt (el .exe de Windows no siempre enlaza stdout). */
function informar(linea: string): void {
  console.log(linea);
  try {
    appendFileSync(join(carpetaDatos, "resultado-prueba.txt"), linea + "\n");
  } catch {
    // sin archivo, queda stdout
  }
}

function terminar(codigo: number): void {
  if (modoPrueba) informar(`CODIGO=${codigo}`);
  void (async () => {
    try { await servidor?.cerrar(); } catch { /* ya cerrado */ }
    app.exit(codigo);
  })();
}

function fallar(mensaje: string): void {
  if (modoPrueba) {
    informar(`FALLO: ${mensaje}`);
    terminar(1);
    return;
  }
  dialog.showErrorBox("Lean OS", mensaje);
  app.exit(1);
}

async function pruebaEnPagina(win: BrowserWindow): Promise<void> {
  if (modoPrueba === "salud") {
    const r = await fetch(`${servidor!.url}/health`);
    const t = await r.text();
    if (r.status !== 200 || t !== "ok") throw new Error(`/health respondió ${r.status} "${t}"`);
    const titulo = await win.webContents.executeJavaScript("document.title");
    if (titulo !== "Lean OS") throw new Error(`la ventana no cargó la app (título "${String(titulo)}")`);
    informar("SALUD_OK");
  } else if (modoPrueba === "s1-escribir") {
    const r = await win.webContents.executeJavaScript(codigoEscribir());
    if (r !== "OK") throw new Error("no se confirmó la escritura");
    informar("S1_ESCRITO");
  } else if (modoPrueba === "s1-leer") {
    const r = await win.webContents.executeJavaScript(codigoLeer());
    if (r !== "OK") throw new Error("no se pudo leer el registro");
    informar("S1_LEIDO");
  } else {
    throw new Error(`modo de prueba desconocido: "${modoPrueba}"`);
  }
}

async function arrancar(): Promise<void> {
  let contenidoConfig: string | null = null;
  try {
    contenidoConfig = readFileSync(join(carpetaDatos, "config.json"), "utf8");
  } catch {
    // sin config.json: servidor por defecto
  }
  const remoto = resolverServidorRemoto(env, contenidoConfig);
  if (remoto.aviso) console.warn(remoto.aviso);
  const carpetaApp = app.isPackaged ? join(process.resourcesPath, "dist") : join(__dirname, "..", "..", "dist");
  try {
    servidor = await iniciarServidorLocal({ carpeta: carpetaApp, puerto: resolverPuerto(env), servidorRemoto: remoto.url });
  } catch (e) {
    return fallar(e instanceof Error ? e.message : String(e));
  }
  const origen = servidor.url;
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_wc, _permiso, cb) => cb(false));
  ventana = new BrowserWindow({
    width: 1100, height: 800, title: "Lean OS", autoHideMenuBar: true, show: !modoPrueba,
    icon: join(__dirname, "icono.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const win = ventana;
  win.on("page-title-updated", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  const controlarNavegacion = (e: { preventDefault(): void }, url: string) => {
    let permitido = false;
    try {
      permitido = new URL(url).origin === origen;
    } catch {
      permitido = false; // dirección inválida: se bloquea
    }
    if (permitido) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  };
  win.webContents.on("will-navigate", controlarNavegacion);
  win.webContents.on("will-redirect", controlarNavegacion);
  if (modoPrueba) {
    win.webContents.once("did-finish-load", () => {
      pruebaEnPagina(win).then(() => terminar(0), (e: unknown) => fallar(e instanceof Error ? e.message : String(e)));
    });
    win.webContents.once("did-fail-load", (_e, _c, descripcion) => fallar(`la ventana no pudo cargar la app: ${descripcion}`));
  }
  await win.loadURL(origen + "/");
}

if (!app.requestSingleInstanceLock()) {
  app.exit(modoPrueba ? 1 : 0); // ya hay otra copia abierta con los mismos datos
} else {
  app.on("second-instance", () => {
    if (ventana) {
      if (ventana.isMinimized()) ventana.restore();
      ventana.focus();
    }
  });
  app.on("window-all-closed", () => { void servidor?.cerrar(); app.quit(); });
  void app.whenReady().then(arrancar).catch((e: unknown) => fallar(e instanceof Error ? e.message : String(e)));
}
