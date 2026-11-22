import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { ARCHIVOS_APP, cachesObsoletas, decidir, nombreDeCache } from "../src/cliente/sw-logica.ts";
import { montarEstaticos } from "../src/servidor/estaticos.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(raiz, "dist");

beforeAll(() => {
  const r = spawnSync(process.execPath, ["build.ts"], { cwd: raiz, encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
}, 60_000);

describe("PWA: manifest, íconos y build", () => {
  const manifest = () => JSON.parse(readFileSync(join(raiz, "src/cliente/publico/manifest.webmanifest"), "utf8"));

  it("el manifest tiene los campos mínimos para instalarse", () => {
    const m = manifest();
    expect(m.name).toBe("Lean OS");
    expect(m.lang).toBe("es");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBeTruthy();
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    const tamanos = m.icons.map((i: { sizes: string }) => i.sizes);
    expect(tamanos).toContain("192x192");
    expect(tamanos).toContain("512x512");
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  });

  it("los íconos son PNG reales de 192 y 512 px", () => {
    for (const lado of [192, 512]) {
      const b = readFileSync(join(raiz, `src/cliente/publico/icono-${lado}.png`));
      expect([...b.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(b.readUInt32BE(16)).toBe(lado);
      expect(b.readUInt32BE(20)).toBe(lado);
    }
  });

  it("build genera dist con sw.js, manifest, íconos y la app; el sw lleva la versión del build", () => {
    for (const f of ["index.html", "app.js", "estilos.css", "sw.js", "manifest.webmanifest", "icono-192.png", "icono-512.png"]) {
      expect(existsSync(join(dist, f)), f).toBe(true);
    }
    const sw = readFileSync(join(dist, "sw.js"), "utf8");
    expect(sw).toMatch(/lean-os-/);
    expect(sw).not.toContain("__VERSION__");
    // Todo lo que el sw precarga existe en dist.
    for (const f of ARCHIVOS_APP) if (f !== "./") expect(existsSync(join(dist, f)), f).toBe(true);
  });

  it("index.html enlaza el manifest y su CSP permite manifest y worker del mismo origen", () => {
    const html = readFileSync(join(raiz, "src/cliente/index.html"), "utf8");
    expect(html).toContain('rel="manifest"');
    expect(html).toMatch(/manifest-src 'self'/);
    expect(html).toMatch(/worker-src 'self'/);
    expect(html).not.toContain("unsafe-inline");
  });

  it("main.ts registra el service worker solo en https o localhost y con try/catch", () => {
    const main = readFileSync(join(raiz, "src/cliente/main.ts"), "utf8");
    expect(main).toContain('serviceWorker.register("sw.js")');
    expect(main).toMatch(/https:/);
    expect(main).toMatch(/localhost/);
    expect(main).toMatch(/try \{[\s\S]*serviceWorker[\s\S]*\} catch/);
  });
});

describe("PWA: qué cachea el service worker", () => {
  const O = "https://lean.example";
  it("nunca cachea ni sirve desde caché /auth, /sync, /export ni /health", () => {
    for (const ruta of ["/auth/login", "/auth/yo", "/sync/pull?since=0", "/sync/push", "/export", "/health", "/health?x=1", "/auth", "//sync/pull"]) {
      expect(decidir("GET", O + ruta, O), ruta).toBe("red");
    }
  });
  it("solo maneja GET del mismo origen; sw.js tampoco se cachea", () => {
    expect(decidir("POST", O + "/", O)).toBe("red");
    expect(decidir("GET", "https://otro.example/app.js", O)).toBe("red");
    expect(decidir("GET", O + "/sw.js", O)).toBe("red");
    expect(decidir("GET", "no es una url", O)).toBe("red");
  });
  it("la app (index, js, estilos, íconos, manifest) sí usa la caché", () => {
    for (const ruta of ["/", "/index.html", "/app.js", "/estilos.css", "/manifest.webmanifest", "/icono-192.png", "/healthy.js"]) {
      expect(decidir("GET", O + ruta, O), ruta).toBe("app");
    }
  });
  it("una versión nueva reemplaza la caché vieja", () => {
    expect(nombreDeCache("abc")).not.toBe(nombreDeCache("def"));
    const hoy = nombreDeCache("nueva");
    expect(cachesObsoletas([nombreDeCache("vieja"), hoy, "otra-app-1"], "nueva")).toEqual([nombreDeCache("vieja")]);
  });
});

describe("servidor sirve la app (dist)", () => {
  function montar() {
    const app = new Hono();
    app.get("/health", (c) => c.text("ok"));
    app.get("/sync/pull", (c) => c.json({ ok: true }));
    montarEstaticos(app, dist);
    return app;
  }
  it("tipos MIME correctos y Cache-Control no-cache en sw.js e index.html", async () => {
    const app = montar();
    const caso: [string, string][] = [
      ["/", "text/html"],
      ["/index.html", "text/html"],
      ["/sw.js", "javascript"],
      ["/app.js", "javascript"],
      ["/estilos.css", "text/css"],
      ["/manifest.webmanifest", "application/manifest+json"],
      ["/icono-512.png", "image/png"],
    ];
    for (const [ruta, tipo] of caso) {
      const r = await app.request(ruta);
      expect(r.status, ruta).toBe(200);
      expect(r.headers.get("content-type"), ruta).toContain(tipo);
      if (ruta === "/" || ruta === "/sw.js" || ruta === "/index.html") expect(r.headers.get("cache-control")).toBe("no-cache");
    }
  });
  it("no rompe /health ni la API; rutas de API inexistentes dan 404 y las de navegación vuelven a la app", async () => {
    const app = montar();
    expect(await (await app.request("/health")).text()).toBe("ok");
    expect((await app.request("/sync/pull")).status).toBe(200);
    expect((await app.request("/sync/otra", { headers: { accept: "text/html" } })).status).toBe(404);
    expect((await app.request("/no-existe.js")).status).toBe(404);
    const nav = await app.request("/ruta/cualquiera", { headers: { accept: "text/html" } });
    expect(nav.status).toBe(200);
    expect(await nav.text()).toContain("<title>Lean OS</title>");
  });
});
