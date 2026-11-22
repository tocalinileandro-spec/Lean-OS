import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { crearApp } from "../src/servidor/app.ts";
import { abrirBase, MIGRACIONES } from "../src/servidor/base.ts";
import { hashArgon2, leerConfig } from "../src/servidor/config.ts";

const CLAVE = "clave-de-prueba-123";
let hash = "";
beforeAll(async () => {
  hash = await hashArgon2(CLAVE);
});

function montar(secreto = "secreto-de-prueba", base?: DatabaseSync, reloj?: RelojSimulado) {
  const r = reloj ?? new RelojSimulado("2026-01-01T12:00:00Z");
  const db = base ?? abrirBase(":memory:", r);
  const logs: string[] = [];
  const app = crearApp({ reloj: r, base: db, secretos: { passwordHash: hash, sessionSecret: secreto }, registrar: (l) => logs.push(l) });
  return { app, reloj: r, db, logs };
}

const ip = (n: number) => ({ "fly-client-ip": `10.0.0.${n}` });
const login = (app: ReturnType<typeof montar>["app"], password: string, n = 1) =>
  app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...ip(n) },
    body: JSON.stringify({ password }),
  });
const yo = (app: ReturnType<typeof montar>["app"], token?: string) =>
  app.request("/auth/yo", { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe("servidor: seguridad", () => {
  it("G1: cualquier dato sin sesión devuelve 401", async () => {
    const { app } = montar();
    for (const ruta of ["/auth/yo", "/sync/pull?since=0", "/export"]) {
      expect((await app.request(ruta)).status).toBe(401);
    }
    expect((await app.request("/sync/push", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await yo(app, "token.falso")).status).toBe(401);
  });

  it("G2: la sexta contraseña equivocada en un minuto recibe 429 con Retry-After", async () => {
    const { app, reloj } = montar();
    for (let i = 0; i < 5; i++) expect((await login(app, "mala")).status).toBe(401);
    const sexta = await login(app, CLAVE); // aun con la clave correcta, ya está bloqueada
    expect(sexta.status).toBe(429);
    expect(Number(sexta.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await login(app, "mala", 2)).status).toBe(401); // otra IP no se ve afectada
    reloj.avanzarMinutos(1.1);
    expect((await login(app, CLAVE)).status).toBe(200);
  });

  it("G3: entrar por HTTP redirige a HTTPS", async () => {
    const { app } = montar();
    const r = await app.request("/health?x=1", { headers: { "x-forwarded-proto": "http", host: "lean.fly.dev" } });
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("https://lean.fly.dev/health?x=1");
    expect((await app.request("/health", { headers: { "x-forwarded-proto": "https" } })).status).toBe(200);
  });
});

describe("servidor: sesiones", () => {
  it("login correcto devuelve token y /auth/yo lo acepta", async () => {
    const { app } = montar();
    const r = await login(app, CLAVE);
    expect(r.status).toBe(200);
    const { token } = (await r.json()) as { token: string };
    expect((await yo(app, token)).status).toBe(200);
    expect((await login(app, "")).status).toBe(400);
  });

  it("la sesión se renueva al usarse y vence a los 30 días sin uso", async () => {
    const { app, reloj } = montar();
    const { token } = (await (await login(app, CLAVE)).json()) as { token: string };
    for (let i = 0; i < 3; i++) {
      reloj.avanzarDias(20);
      expect((await yo(app, token)).status).toBe(200); // 60 días en total, renovada cada vez
    }
    reloj.avanzarDias(30);
    expect((await yo(app, token)).status).toBe(401);
  });

  it("logout invalida el token", async () => {
    const { app } = montar();
    const { token } = (await (await login(app, CLAVE)).json()) as { token: string };
    const r = await app.request("/auth/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect(r.status).toBe(200);
    expect((await yo(app, token)).status).toBe(401);
  });

  it("cambiar SESSION_SECRET invalida todas las sesiones", async () => {
    const a = montar("secreto-uno");
    const { token } = (await (await login(a.app, CLAVE)).json()) as { token: string };
    const b = montar("secreto-dos", a.db, a.reloj);
    expect((await yo(b.app, token)).status).toBe(401);
    expect((await yo(a.app, token)).status).toBe(200);
  });

  it("/health responde ok sin sesión, con cabeceras seguras y los logs no traen secretos", async () => {
    const { app, logs } = montar();
    const r = await app.request("/health");
    expect(await r.text()).toBe("ok");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("strict-transport-security")).toBeTruthy();
    const { token } = (await (await login(app, CLAVE)).json()) as { token: string };
    await yo(app, token);
    const todo = logs.join("\n");
    expect(todo).not.toContain(CLAVE);
    expect(todo).not.toContain(token);
    expect(todo).not.toContain("Bearer");
  });
});

describe("servidor: configuración", () => {
  it("en production falla con mensaje claro si faltan secretos; en desarrollo usa valores locales", async () => {
    await expect(leerConfig({ NODE_ENV: "production" })).rejects.toThrow(/APP_PASSWORD_HASH y SESSION_SECRET/);
    const c = await leerConfig({}, () => {});
    expect(c.puerto).toBe(8080);
    expect(c.secretos.sessionSecret).not.toBe("");
  });
});

describe("servidor: migraciones", () => {
  it("una migración fallida restaura el respaldo previo y no arranca", () => {
    const dir = mkdtempSync(join(tmpdir(), "lean-os-"));
    const ruta = join(dir, "lean-os.sqlite");
    const reloj = new RelojSimulado("2026-01-01T12:00:00Z");
    const db1 = abrirBase(ruta, reloj);
    db1.prepare("INSERT INTO sesiones VALUES ('x', 1, 2, 1)").run();
    db1.close();
    const antes = readFileSync(ruta);

    const rota = [
      ...MIGRACIONES,
      {
        version: 2,
        aplicar: (db: DatabaseSync) => {
          db.exec("CREATE TABLE nueva (a INTEGER)");
          db.exec("DROP TABLE sesiones");
          writeFileSync(ruta, "basura"); // simula corrupción a mitad de migración
          throw new Error("falla simulada");
        },
      },
    ];
    expect(() => abrirBase(ruta, reloj, rota)).toThrow(/Se restauró el respaldo previo/);
    expect(readFileSync(ruta).equals(antes)).toBe(true);
    expect(readdirSync(join(dir, "respaldos-migracion"))).toHaveLength(1);

    const db2 = abrirBase(ruta, reloj);
    expect(db2.prepare("SELECT COUNT(*) AS n FROM sesiones").get()).toEqual({ n: 1 });
    db2.close();
  });
});
