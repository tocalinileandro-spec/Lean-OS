import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { crearApp } from "../src/servidor/app.ts";
import { abrirBase } from "../src/servidor/base.ts";
import { hashArgon2 } from "../src/servidor/config.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Patrones de secretos reales. Cada uno describe algo que NUNCA debe estar en un archivo versionado. */
export const PATRONES: { nombre: string; re: RegExp }[] = [
  { nombre: "token de Fly", re: /\bFlyV1 [A-Za-z0-9+/=_,-]{20,}/ },
  { nombre: "token de Fly (fm2)", re: /\bfm[12]_[A-Za-z0-9+/=_-]{20,}/ },
  { nombre: "token de GitHub", re: /\b(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,})/ },
  { nombre: "clave privada PEM", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { nombre: "clave de Groq", re: /\bgsk_[A-Za-z0-9]{20,}/ },
  { nombre: "hash argon2", re: /\$argon2(?:id|i|d)\$v=\d+\$m=\d+/ },
];
const ASIGNACION = /\b(SESSION_SECRET|APP_PASSWORD_HASH|FLY_API_TOKEN|B2_APP_KEY|B2_KEY_ID|RESPALDO_CLAVE|GROQ_API_KEY)[ \t]*=[ \t]*(\S*)/g;

/** Una asignación es un secreto real si tiene un valor que no es un marcador (<...>, $VAR, %VAR%, ..., vacío). */
export function valorReal(valorCrudo: string): boolean {
  const v = valorCrudo.replace(/^['"]+/, "").replace(/['"]+$/, "");
  if (v === "") return false;
  return !/^(<|\$|%|\.{3}|\{\{)/.test(v);
}

/** Excepciones explícitas (archivo -> motivo). Lista corta a propósito: nada de ignorados amplios. */
const EXCEPCIONES = new Map<string, string>([
  ["pruebas/g5-secretos.test.ts", "contiene los patrones y ejemplos falsos de esta misma prueba"],
]);

export function buscar(texto: string): string[] {
  const hallazgos: string[] = [];
  for (const p of PATRONES) if (p.re.test(texto)) hallazgos.push(p.nombre);
  for (const m of texto.matchAll(ASIGNACION)) if (valorReal(m[2] ?? "")) hallazgos.push(`asignación de ${m[1]}`);
  return hallazgos;
}

function archivosVersionados(): string[] {
  const r = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: raiz, encoding: "utf8" });
  if (r.status === 0 && r.stdout) return r.stdout.split("\0").filter((f) => f && existsSync(join(raiz, f)));
  // Sin git: se recorre el árbol salvo carpetas que git tampoco versionaría.
  const salida: string[] = [];
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      if ([".git", "node_modules", "dist", "coverage"].includes(nombre)) continue;
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else salida.push(relative(raiz, ruta).split("\\").join("/"));
    }
  };
  recorrer(raiz);
  return salida.filter((f) => !/^\.env($|\.(?!example))/.test(f));
}

describe("G5: el escaneo de secretos da vacío", () => {
  it("G5: el detector reconoce secretos falsos y no marcadores", () => {
    expect(buscar("FlyV1 " + "a".repeat(40))).toContain("token de Fly");
    expect(buscar("token ghp_" + "A1".repeat(20))).toContain("token de GitHub");
    expect(buscar("github_pat_" + "x".repeat(30))).toContain("token de GitHub");
    expect(buscar("-----BEGIN " + "PRIVATE KEY-----")).toContain("clave privada PEM");
    expect(buscar("$argon2id" + "$v=19$m=19456,t=3,p=1$abc$def")).toContain("hash argon2");
    expect(buscar("SESSION_SECRET=abc123")).toHaveLength(1);
    expect(buscar("set FLY_API_TOKEN=abc")).toHaveLength(1);
    expect(buscar("APP_PASSWORD_HASH='abc'")).toHaveLength(1);
    expect(buscar("B2_APP_KEY=K005abcdef")).toHaveLength(1);
    expect(buscar("RESPALDO_CLAVE=AbC+/123=")).toHaveLength(1);
    expect(buscar("GROQ_API_KEY=abc123")).toHaveLength(1);
    expect(buscar("GROQ_API_KEY='<tu clave de Groq>'")).toHaveLength(0);
    expect(buscar("clave gsk_" + "a1B2".repeat(8))).toContain("clave de Groq");
    expect(buscar("RESPALDO_CLAVE=")).toHaveLength(0);
    expect(buscar("B2_APP_KEY='<tu application key>'")).toHaveLength(0);
    expect(buscar("SESSION_SECRET=")).toHaveLength(0);
    expect(buscar("APP_PASSWORD_HASH='<pegá el valor>'")).toHaveLength(0);
    expect(buscar("FLY_API_TOKEN=$FLY_API_TOKEN")).toHaveLength(0);
    expect(buscar("SESSION_SECRET=%SESSION_SECRET%")).toHaveLength(0);
  });

  it("G5: ningún archivo versionado contiene secretos", () => {
    const archivos = archivosVersionados();
    expect(archivos.length).toBeGreaterThan(20);
    const encontrados: string[] = [];
    for (const f of archivos) {
      if (EXCEPCIONES.has(f)) continue;
      const buf = readFileSync(join(raiz, f));
      if (buf.includes(0)) continue; // binario (íconos)
      for (const h of buscar(buf.toString("utf8"))) encontrados.push(`${f}: ${h}`); // nunca se imprime el valor
    }
    expect(encontrados).toEqual([]);
  });

  it("G5: .env está ignorado y .env.example tiene los nombres sin valor", () => {
    const ignore = readFileSync(join(raiz, ".gitignore"), "utf8").split(/\r?\n/).map((l) => l.trim());
    expect(ignore).toContain(".env");
    const r = spawnSync("git", ["check-ignore", ".env"], { cwd: raiz });
    if (r.error === undefined && existsSync(join(raiz, ".git"))) expect(r.status).toBe(0);
    const ejemplo = readFileSync(join(raiz, ".env.example"), "utf8");
    for (const nombre of ["FLY_API_TOKEN", "GITHUB_TOKEN", "APP_PASSWORD_HASH", "SESSION_SECRET"]) {
      expect(ejemplo).toMatch(new RegExp(`^${nombre}=$`, "m"));
    }
    for (const linea of ejemplo.split(/\r?\n/)) {
      if (linea.trim() && !linea.startsWith("#")) expect(linea, linea).toMatch(/^[A-Z0-9_]+=$/);
    }
    expect(archivosVersionados()).not.toContain(".env");
  });
});

describe("G5: los registros del servidor no tienen secretos", () => {
  const CLAVE = "clave-super-secreta-9876";
  const SECRETO_SESION = "secreto-de-sesion-abcdef-123456";
  const CONTENIDO = "contenido-privado-de-la-tarjeta-zzz";
  let hash = "";
  beforeAll(async () => {
    hash = await hashArgon2(CLAVE);
  });
  afterEach(() => vi.restoreAllMocks());

  const T0 = "2026-03-10T12:00:00.000Z";
  const tarjeta = (id: string) => ({
    tabla: "tarjetas",
    registro: {
      id, created_at: T0, updated_at: T0, deleted_at: null, rev: null, area_id: "a1", pregunta: CONTENIDO, respuesta: CONTENIDO,
      pista: null, suspendida: false, importacion_id: null, ease: 2.5, intervalo: 0, reps: 0, lapses: 0, vence: "2026-03-10",
      contenido_updated_at: T0, repaso_updated_at: T0,
    },
  });

  function sinSecretos(texto: string, tokens: string[]) {
    for (const prohibido of [CLAVE, SECRETO_SESION, CONTENIDO, hash, ...tokens]) expect(texto.includes(prohibido)).toBe(false);
    expect(buscar(texto)).toEqual([]);
  }

  it("G5: login, sync y error en el servidor en proceso no escriben contraseñas, tokens ni contenido", async () => {
    const lineas: string[] = [];
    for (const m of ["log", "info", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((...a) => void lineas.push(a.join(" ")));
    const reloj = new RelojSimulado(T0);
    const app = crearApp({ reloj, base: abrirBase(":memory:", reloj), secretos: { passwordHash: hash, sessionSecret: SECRETO_SESION } });
    const json = { "content-type": "application/json" };
    await app.request("/auth/login", { method: "POST", headers: json, body: JSON.stringify({ password: "otra-clave-mala" }) });
    const login = await app.request("/auth/login", { method: "POST", headers: json, body: JSON.stringify({ password: CLAVE }) });
    const token = ((await login.json()) as { token: string }).token;
    const h = { ...json, authorization: `Bearer ${token}` };
    const push = await app.request("/sync/push", { method: "POST", headers: h, body: JSON.stringify({ cambios: [tarjeta("k1")] }) });
    expect(push.status).toBe(200);
    await app.request("/sync/pull?since=0", { headers: h });
    const malo = await app.request("/sync/push", { method: "POST", headers: h, body: JSON.stringify({ cambios: [{ tabla: "nada", registro: { pregunta: CONTENIDO } }] }) });
    expect(malo.status).toBeGreaterThanOrEqual(400);
    await app.request("/export", { headers: h });
    await app.request("/sync/pull?since=0", { headers: { authorization: `Bearer ${token}x` } });
    expect(lineas.length).toBeGreaterThan(5);
    sinSecretos(lineas.join("\n"), [token, "otra-clave-mala"]);
  });

  it("G5: el servidor real (proceso) no escribe secretos en su salida con login, sync y error", async () => {
    const puerto = 20000 + Math.floor(Math.random() * 20000);
    const proc = spawn(process.execPath, ["src/servidor/main.ts"], {
      cwd: raiz,
      env: { PATH: process.env["PATH"] ?? "", PORT: String(puerto), DATA_DIR: mkdtempSync(join(tmpdir(), "lean-os-g5-")), NODE_ENV: "production", APP_PASSWORD_HASH: hash, SESSION_SECRET: SECRETO_SESION },
    });
    let salida = "";
    proc.stdout.on("data", (d) => (salida += d));
    proc.stderr.on("data", (d) => (salida += d));
    try {
      const base = `http://127.0.0.1:${puerto}`;
      for (let i = 0; i < 100 && !salida.includes("escuchando"); i++) await new Promise((r) => setTimeout(r, 100));
      expect(salida).toContain("escuchando");
      const json = { "content-type": "application/json" };
      await fetch(`${base}/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ password: "otra-clave-mala" }) });
      const login = await fetch(`${base}/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ password: CLAVE }) });
      const token = ((await login.json()) as { token: string }).token;
      const h = { ...json, authorization: `Bearer ${token}` };
      expect((await fetch(`${base}/sync/push`, { method: "POST", headers: h, body: JSON.stringify({ cambios: [tarjeta("k1")] }) })).status).toBe(200);
      await fetch(`${base}/sync/push`, { method: "POST", headers: h, body: "esto no es json " + CONTENIDO });
      expect(await (await fetch(`${base}/health`)).text()).toBe("ok");
      await new Promise((r) => setTimeout(r, 200));
      expect(salida).toContain("POST /sync/push");
      sinSecretos(salida, [token, "otra-clave-mala"]);
    } finally {
      proc.kill();
    }
  }, 30_000);
});
