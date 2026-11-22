/**
 * Servidor local de la app de Windows (sin dependencia de Electron).
 * Sirve dist/ en 127.0.0.1 con puerto fijo, responde GET /health "ok" y reenvía /auth, /sync y /export
 * al servidor remoto. No registra contenido ni tokens.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

export const PUERTO_POR_DEFECTO = 47821;
export const SERVIDOR_POR_DEFECTO = "https://lean-os.fly.dev";
const RUTAS_PROXY = ["/auth", "/sync", "/export"] as const;
const LIMITE_CUERPO = 50 * 1024 * 1024;
const TIMEOUT_POR_DEFECTO_MS = 30_000;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export interface OpcionesServidorLocal {
  /** Carpeta con la app compilada (dist/). */
  carpeta: string;
  /** Puerto fijo (el origen de IndexedDB lo incluye). 0 solo en pruebas. */
  puerto?: number;
  /** URL http(s) del servidor remoto. null = sin sincronización (502). */
  servidorRemoto?: string | null;
  timeoutMs?: number;
  /** Para pruebas. */
  fetchImpl?: typeof fetch;
}

export interface ServidorLocal {
  puerto: number;
  url: string;
  cerrar(): Promise<void>;
}

/** Devuelve la URL normalizada (sin barra final) si es http(s); si no, null. */
export function urlRemotaValida(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  try {
    const u = new URL(valor.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Puerto de LEAN_OS_PUERTO; si falta o es inválido, el de siempre. */
export function resolverPuerto(env: Record<string, string | undefined>): number {
  const v = env["LEAN_OS_PUERTO"];
  if (v === undefined || v === "") return PUERTO_POR_DEFECTO;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`LEAN_OS_PUERTO inválido: "${v}". Tiene que ser un número entre 1 y 65535.`);
  return n;
}

/** Servidor remoto: LEAN_OS_SERVIDOR, si no `servidor` de config.json (contenido ya leído), si no el de siempre. */
export function resolverServidorRemoto(env: Record<string, string | undefined>, contenidoConfig: string | null): { url: string; aviso?: string } {
  const deEnv = env["LEAN_OS_SERVIDOR"];
  if (deEnv !== undefined && deEnv !== "") {
    const u = urlRemotaValida(deEnv);
    if (u) return { url: u };
    return { url: SERVIDOR_POR_DEFECTO, aviso: "LEAN_OS_SERVIDOR no es una dirección http(s) válida; se usa la de siempre." };
  }
  if (contenidoConfig !== null) {
    try {
      const cfg = JSON.parse(contenidoConfig) as { servidor?: unknown };
      if (cfg.servidor !== undefined) {
        const u = urlRemotaValida(cfg.servidor);
        if (u) return { url: u };
        return { url: SERVIDOR_POR_DEFECTO, aviso: 'config.json: "servidor" no es una dirección http(s) válida; se usa la de siempre.' };
      }
    } catch {
      return { url: SERVIDOR_POR_DEFECTO, aviso: "config.json no es un JSON válido; se usa el servidor de siempre." };
    }
  }
  return { url: SERVIDOR_POR_DEFECTO };
}

const esRutaProxy = (ruta: string) => RUTAS_PROXY.some((p) => ruta === p || ruta.startsWith(`${p}/`));

function json(res: ServerResponse, estado: number, cuerpo: unknown): void {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(estado, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(texto);
}

async function leerCuerpo(req: IncomingMessage): Promise<Buffer | null> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const p of req) {
    const b = p as Buffer;
    total += b.length;
    if (total > LIMITE_CUERPO) return null;
    partes.push(b);
  }
  return Buffer.concat(partes);
}

async function reenviar(req: IncomingMessage, res: ServerResponse, url: URL, op: OpcionesServidorLocal): Promise<void> {
  const destino = op.servidorRemoto ? urlRemotaValida(op.servidorRemoto) : null;
  const sinRed = () => json(res, 502, { error: "No se pudo conectar con el servidor. Seguís trabajando sin conexión." });
  if (!destino) return sinRed();
  const metodo = req.method ?? "GET";
  let cuerpo: Buffer | undefined;
  if (metodo !== "GET" && metodo !== "HEAD") {
    const leido = await leerCuerpo(req);
    if (leido === null) return json(res, 413, { error: "El pedido es demasiado grande." });
    cuerpo = leido;
  }
  const cabeceras: Record<string, string> = {};
  const auth = req.headers["authorization"];
  if (typeof auth === "string") cabeceras["authorization"] = auth;
  const tipo = req.headers["content-type"];
  if (typeof tipo === "string") cabeceras["content-type"] = tipo;
  try {
    const r = await (op.fetchImpl ?? fetch)(destino + url.pathname + url.search, {
      method: metodo,
      headers: cabeceras,
      ...(cuerpo !== undefined ? { body: new Uint8Array(cuerpo) } : {}),
      redirect: "manual",
      signal: AbortSignal.timeout(op.timeoutMs ?? TIMEOUT_POR_DEFECTO_MS),
    });
    const datos = Buffer.from(await r.arrayBuffer());
    const salida: Record<string, string> = { "cache-control": "no-store" };
    const ct = r.headers.get("content-type");
    if (ct) salida["content-type"] = ct;
    res.writeHead(r.status, salida);
    res.end(datos);
  } catch {
    sinRed();
  }
}

async function servirEstatico(req: IncomingMessage, res: ServerResponse, url: URL, carpeta: string): Promise<void> {
  const raiz = resolve(carpeta);
  let ruta: string;
  try {
    ruta = decodeURIComponent(url.pathname);
  } catch {
    return json(res, 400, { error: "Dirección inválida." });
  }
  if (ruta.includes("\0")) return json(res, 400, { error: "Dirección inválida." });
  if (ruta.endsWith("/")) ruta += "index.html";
  const archivo = normalize(join(raiz, ruta));
  const pideHtml = (req.headers["accept"] ?? "").includes("text/html");
  let elegido: string | null = null;
  if (archivo === raiz || archivo.startsWith(raiz + sep)) {
    try {
      if ((await stat(archivo)).isFile()) elegido = archivo;
    } catch {
      // no existe
    }
  }
  if (!elegido && pideHtml) elegido = join(raiz, "index.html");
  if (!elegido) return json(res, 404, { error: "No encontrado." });
  try {
    const datos = await readFile(elegido);
    res.writeHead(200, { "content-type": MIME[extname(elegido)] ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : datos);
  } catch {
    json(res, 404, { error: "No encontrado." });
  }
}

export function iniciarServidorLocal(op: OpcionesServidorLocal): Promise<ServidorLocal> {
  const puertoPedido = op.puerto ?? PUERTO_POR_DEFECTO;
  let puertoReal = puertoPedido;
  const servidor: Server = createServer((req, res) => {
    void (async () => {
      try {
        // Solo se atiende a quien entra por 127.0.0.1/localhost con el puerto propio (evita rebinding de DNS).
        const host = (req.headers["host"] ?? "").toLowerCase();
        if (host !== `127.0.0.1:${puertoReal}` && host !== `localhost:${puertoReal}`) return json(res, 403, { error: "Acceso no permitido." });
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${puertoReal}`);
        const ruta = url.pathname;
        if (ruta === "/health") {
          if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Método no permitido." });
          res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
          return void res.end(req.method === "HEAD" ? undefined : "ok");
        }
        if (esRutaProxy(ruta)) return await reenviar(req, res, url, op);
        if (req.method !== "GET" && req.method !== "HEAD") return json(res, 404, { error: "No encontrado." });
        await servirEstatico(req, res, url, op.carpeta);
      } catch {
        if (!res.headersSent) json(res, 500, { error: "Error interno." });
        else res.end();
      }
    })();
  });
  return new Promise((resolver, rechazar) => {
    servidor.once("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EADDRINUSE")
        rechazar(new Error(`El puerto ${puertoPedido} ya está en uso. Cerrá la otra copia de Lean OS (o el programa que lo usa) y volvé a abrir. Si hace falta, elegí otro puerto con la variable LEAN_OS_PUERTO (ojo: con otro puerto no vas a ver los datos de siempre).`));
      else rechazar(new Error(`No se pudo abrir el servidor local: ${e.message}`));
    });
    servidor.listen(puertoPedido, "127.0.0.1", () => {
      const dir = servidor.address();
      puertoReal = typeof dir === "object" && dir ? dir.port : puertoPedido;
      resolver({
        puerto: puertoReal,
        url: `http://127.0.0.1:${puertoReal}`,
        cerrar: () => new Promise<void>((ok) => { servidor.close(() => ok()); servidor.closeAllConnections(); }),
      });
    });
  });
}
