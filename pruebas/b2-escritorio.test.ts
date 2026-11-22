import "fake-indexeddb/auto";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { IDS_EXIGIBLES } from "../fase-actual.ts";
import { AlmacenIndexedDB } from "../src/cliente/almacen-indexeddb.ts";
import { resolverCarpetaDatos } from "../src/escritorio/datos.ts";
import { ID_TARJETA_PRUEBA, PREGUNTA_PRUEBA, codigoEscribir, codigoLeer } from "../src/escritorio/prueba-s1.ts";
import {
  PUERTO_POR_DEFECTO, SERVIDOR_POR_DEFECTO, iniciarServidorLocal, resolverPuerto, resolverServidorRemoto, urlRemotaValida,
  type ServidorLocal,
} from "../src/escritorio/servidor-local.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (f: string) => readFileSync(join(raiz, f), "utf8");

function carpetaApp(): string {
  const d = mkdtempSync(join(tmpdir(), "lean-os-dist-"));
  writeFileSync(join(d, "index.html"), "<!doctype html><title>Lean OS</title>");
  writeFileSync(join(d, "app.js"), "console.log(1)");
  writeFileSync(join(d, "manifest.webmanifest"), "{}");
  return d;
}

const abiertos: { cerrar(): Promise<void> | void }[] = [];
afterEach(async () => { for (const a of abiertos.splice(0)) await a.cerrar(); });

async function local(op: Partial<Parameters<typeof iniciarServidorLocal>[0]> = {}): Promise<ServidorLocal> {
  const s = await iniciarServidorLocal({ carpeta: carpetaApp(), puerto: 0, ...op });
  abiertos.push(s);
  return s;
}

interface Pedido { metodo: string; url: string; auth: string | undefined; tipo: string | undefined; cuerpo: string }
async function remotoFalso(demoraMs = 0): Promise<{ url: string; pedidos: Pedido[] }> {
  const pedidos: Pedido[] = [];
  const srv: Server = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on("data", (p: Buffer) => partes.push(p));
    req.on("end", () => {
      pedidos.push({ metodo: req.method ?? "", url: req.url ?? "", auth: req.headers["authorization"], tipo: req.headers["content-type"], cuerpo: Buffer.concat(partes).toString() });
      setTimeout(() => {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ eco: "remoto" }));
      }, demoraMs);
    });
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  abiertos.push({ cerrar: () => new Promise<void>((ok) => { srv.close(() => ok()); srv.closeAllConnections(); }) });
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, pedidos };
}

describe("B2: servidor local de la app de Windows", () => {
  it("B2: responde GET /health con 'ok' y sirve la app empaquetada (index, estáticos, vuelta a la app)", async () => {
    const s = await local();
    const h = await fetch(`${s.url}/health`);
    expect(h.status).toBe(200);
    expect(await h.text()).toBe("ok");
    const i = await fetch(`${s.url}/`);
    expect(i.status).toBe(200);
    expect(i.headers.get("content-type")).toContain("text/html");
    expect(await i.text()).toContain("Lean OS");
    const js = await fetch(`${s.url}/app.js`);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(js.headers.get("cache-control")).toBe("no-cache");
    expect((await fetch(`${s.url}/manifest.webmanifest`)).headers.get("content-type")).toContain("manifest+json");
    const nav = await fetch(`${s.url}/otra/ruta`, { headers: { accept: "text/html" } });
    expect(nav.status).toBe(200);
    expect(await nav.text()).toContain("Lean OS");
    expect((await fetch(`${s.url}/no-existe.js`)).status).toBe(404);
  });

  it("B2: solo atiende a 127.0.0.1 y no sale de la carpeta de la app", async () => {
    const s = await local();
    const pedir = (ruta: string, host: string) => new Promise<number>((ok, mal) => {
      const q = request({ host: "127.0.0.1", port: s.puerto, path: ruta, headers: { host } }, (res) => { res.resume(); ok(res.statusCode ?? 0); });
      q.on("error", mal);
      q.end();
    });
    const estado = await pedir("/health", "evil.example");
    expect(estado).toBe(403);
    const traversal = await pedir("/..%2f..%2fpackage.json", `127.0.0.1:${s.puerto}`);
    expect(traversal).toBe(404);
  });

  it("B2: el proxy reenvía /auth, /sync y /export (método, cuerpo y Authorization tal cual)", async () => {
    const remoto = await remotoFalso();
    const s = await local({ servidorRemoto: remoto.url });
    const post = await fetch(`${s.url}/sync/push`, { method: "POST", headers: { authorization: "Bearer abc", "content-type": "application/json" }, body: '{"x":1}' });
    expect(post.status).toBe(201);
    expect(await post.json()).toEqual({ eco: "remoto" });
    const get = await fetch(`${s.url}/sync/pull?since=5&limite=10`, { headers: { authorization: "Bearer abc" } });
    expect(get.status).toBe(201);
    await fetch(`${s.url}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"p":"q"}' });
    await fetch(`${s.url}/export`, { headers: { authorization: "Bearer zzz" } });
    expect(remoto.pedidos).toEqual([
      { metodo: "POST", url: "/sync/push", auth: "Bearer abc", tipo: "application/json", cuerpo: '{"x":1}' },
      { metodo: "GET", url: "/sync/pull?since=5&limite=10", auth: "Bearer abc", tipo: undefined, cuerpo: "" },
      { metodo: "POST", url: "/auth/login", auth: undefined, tipo: "application/json", cuerpo: '{"p":"q"}' },
      { metodo: "GET", url: "/export", auth: "Bearer zzz", tipo: undefined, cuerpo: "" },
    ]);
  });

  it("B2: sin red (o sin servidor configurado, o con timeout) el proxy responde 502 con JSON en castellano", async () => {
    const remoto = await remotoFalso();
    const caido = await local({ servidorRemoto: "http://127.0.0.1:1" });
    const r = await fetch(`${caido.url}/sync/pull`);
    expect(r.status).toBe(502);
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(((await r.json()) as { error: string }).error).toMatch(/servidor/);
    const sin = await local({ servidorRemoto: null });
    expect((await fetch(`${sin.url}/auth/login`, { method: "POST", body: "{}" })).status).toBe(502);
    const lento = await remotoFalso(500);
    const conTimeout = await local({ servidorRemoto: lento.url, timeoutMs: 50 });
    expect((await fetch(`${conTimeout.url}/export`)).status).toBe(502);
    expect(remoto.pedidos).toHaveLength(0);
  });

  it("B2: las rutas no permitidas dan 404 y no llegan al servidor remoto", async () => {
    const remoto = await remotoFalso();
    const s = await local({ servidorRemoto: remoto.url });
    expect((await fetch(`${s.url}/admin`, { method: "POST", body: "{}" })).status).toBe(404);
    expect((await fetch(`${s.url}/authx/login`, { method: "POST", body: "{}" })).status).toBe(404);
    expect((await fetch(`${s.url}/otra`)).status).toBe(404);
    expect(remoto.pedidos).toHaveLength(0);
  });

  it("B2: con el puerto ocupado falla con un mensaje claro en castellano (no cambia de puerto)", async () => {
    const primero = await local();
    await expect(iniciarServidorLocal({ carpeta: carpetaApp(), puerto: primero.puerto })).rejects.toThrow(/ya está en uso/);
  });

  it("B2: configuración: puerto fijo por defecto, servidor por defecto, config.json y variables de entorno", () => {
    expect(PUERTO_POR_DEFECTO).toBe(47821);
    expect(resolverPuerto({})).toBe(47821);
    expect(resolverPuerto({ LEAN_OS_PUERTO: "50000" })).toBe(50000);
    expect(() => resolverPuerto({ LEAN_OS_PUERTO: "abc" })).toThrow(/LEAN_OS_PUERTO/);
    expect(resolverServidorRemoto({}, null).url).toBe(SERVIDOR_POR_DEFECTO);
    expect(SERVIDOR_POR_DEFECTO).toBe("https://lean-os.fly.dev");
    expect(resolverServidorRemoto({}, '{"servidor":"https://mi.servidor.com/"}').url).toBe("https://mi.servidor.com");
    expect(resolverServidorRemoto({ LEAN_OS_SERVIDOR: "http://127.0.0.1:8080" }, '{"servidor":"https://otro"}').url).toBe("http://127.0.0.1:8080");
    expect(resolverServidorRemoto({}, '{"servidor":"ftp://x"}')).toMatchObject({ url: SERVIDOR_POR_DEFECTO, aviso: expect.any(String) });
    expect(resolverServidorRemoto({}, "no es json")).toMatchObject({ url: SERVIDOR_POR_DEFECTO, aviso: expect.any(String) });
    expect(urlRemotaValida("file:///etc/passwd")).toBeNull();
    expect(urlRemotaValida("javascript:alert(1)")).toBeNull();
  });

  it("B2: con LEAN_OS_PRUEBA y sin LEAN_OS_DATOS falla antes de elegir carpeta (no toca los datos reales)", () => {
    let usada = false;
    const normal = () => { usada = true; return "C:/real"; };
    expect(() => resolverCarpetaDatos({ LEAN_OS_PRUEBA: "s1-escribir" }, normal)).toThrow(/falta LEAN_OS_DATOS/);
    expect(() => resolverCarpetaDatos({ LEAN_OS_PRUEBA: "salud", LEAN_OS_DATOS: "" }, normal)).toThrow(/LEAN_OS_DATOS/);
    expect(usada).toBe(false);
    expect(resolverCarpetaDatos({ LEAN_OS_PRUEBA: "salud", LEAN_OS_DATOS: "/tmp/x" }, normal)).toBe("/tmp/x");
    expect(resolverCarpetaDatos({}, normal)).toBe("C:/real");
    expect(resolverCarpetaDatos({ LEAN_OS_DATOS: "/otra" }, normal)).toBe("/otra");
  });

  it("B2: el workflow tiene el job exe-windows que compila el .exe en windows-latest, lo arranca en modo salud y sube el artefacto", () => {
    const ci = leer(".github/workflows/ci.yml");
    const job = ci.slice(ci.indexOf("  exe-windows:"), ci.indexOf("  # Despliegue (B3)"));
    expect(job).toMatch(/runs-on: windows-latest/);
    expect(job).toMatch(/contents: read/);
    expect(job).toMatch(/node-version: 22/);
    expect(job).toMatch(/npm run build/);
    expect(job).toMatch(/node escritorio\/compilar\.ts/);
    expect(job).toMatch(/working-directory: escritorio/);
    expect(job).toMatch(/npm run empaquetar/);
    expect(job).toMatch(/node escritorio\/probar-exe\.ts/);
    expect(job).toMatch(/actions\/upload-artifact@v4/);
    expect(job).toMatch(/Lean-OS\.exe/);
    expect(job).toMatch(/retention-days: 30/);
    // El despliegue no depende del .exe.
    expect(ci).toMatch(/desplegar:\s+needs: verificar\s/);
    const pe = leer("escritorio/probar-exe.ts");
    expect(pe).toMatch(/"salud"[\s\S]*SALUD_OK/);
    const principal = leer("escritorio/principal.ts");
    expect(principal).toMatch(/SALUD_OK/);
    expect(principal).toMatch(/contextIsolation: true/);
    expect(principal).toMatch(/nodeIntegration: false/);
    expect(principal).toMatch(/requestSingleInstanceLock/);
    const pkg = JSON.parse(leer("escritorio/package.json")) as { build: { portable: { artifactName: string }; win: { target: { target: string }[] } } };
    expect(pkg.build.portable.artifactName).toBe("Lean-OS.exe");
    expect(pkg.build.win.target[0]?.target).toBe("portable");
    // La raíz no depende de Electron.
    expect(leer("package.json")).not.toMatch(/electron/);
  });

  it("B2: B2 es exigible (la lista exigible solo se amplía)", () => {
    expect(IDS_EXIGIBLES).toContain("B2");
    expect(IDS_EXIGIBLES).toContain("S1");
  });
});

describe("S1 dentro del .exe (verificación en Linux; la real corre en el job exe-windows)", () => {
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (c: string) => () => Promise<unknown>;

  it("S1: el código que el .exe ejecuta en la página escribe una tarjeta real y luego la lee, sobre la base de la app", async () => {
    await (await AlmacenIndexedDB.abrir()).cerrar(); // la app ya creó la base al cargar
    await expect(new AsyncFunction(`return ${codigoLeer()}`)()).rejects.toThrow(/no está/);
    expect(await new AsyncFunction(`return ${codigoEscribir()}`)()).toBe("OK");
    expect(await new AsyncFunction(`return ${codigoLeer()}`)()).toBe("OK");
    const a = await AlmacenIndexedDB.abrir();
    const t = (await a.tarjetas.listar()).find((x) => x.id === ID_TARJETA_PRUEBA);
    expect(t?.pregunta).toBe(PREGUNTA_PRUEBA);
    expect(t?.reps).toBe(2);
    a.cerrar();
  });

  it("S1: el job exe-windows ejecuta s1-escribir y luego s1-leer sobre la misma carpeta de datos", () => {
    const pe = leer("escritorio/probar-exe.ts");
    const e = pe.indexOf('"s1-escribir"');
    const l = pe.indexOf('"s1-leer"');
    expect(e).toBeGreaterThan(-1);
    expect(l).toBeGreaterThan(e);
    expect(pe).toMatch(/const s1 = join\(base, "s1"\)[\s\S]*paso\("s1-escribir", s1[\s\S]*paso\("s1-leer", s1/);
    expect(leer(".github/workflows/ci.yml")).toMatch(/node escritorio\/probar-exe\.ts/);
    expect(leer("escritorio/principal.ts")).toMatch(/LEAN_OS_DATOS/);
  });
});
