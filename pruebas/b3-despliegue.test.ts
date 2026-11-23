import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IDS_EXIGIBLES } from "../fase-actual.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (f: string) => readFileSync(join(raiz, f), "utf8");

/** El despliegue real depende de FLY_API_TOKEN: se confirma al cargarlo (pendiente en ESTADO.md). Acá se verifica la configuración. */
describe("B3: despliegue en Fly.io (verificación estática)", () => {
  it("B3: fly.toml exige HTTPS, puerto 8080, health check a /health y el volumen en /data", () => {
    const t = leer("fly.toml");
    expect(t).toMatch(/^app = "lean-os"/m);
    expect(t).toMatch(/^primary_region = "eze"/m);
    expect(t).toMatch(/force_https = true/);
    expect(t).toMatch(/internal_port = 8080/);
    expect(t).toMatch(/\[\[http_service\.checks\]\][\s\S]*path = "\/health"/);
    expect(t).toMatch(/\[\[mounts\]\][\s\S]*source = "lean_os_data"[\s\S]*destination = "\/data"/);
    expect(t).not.toMatch(/scheduled_snapshots/);
    expect(t).toMatch(/snapshot_retention = \d+/);
    expect(t).toMatch(/DATA_DIR = "\/data"/);
    expect(t).toMatch(/min_machines_running = 1/);
    expect(t).not.toMatch(/\[\[mounts\]\][\s\S]*(auto_?extend|destroy)/);
    expect(buscarSecretos(t)).toBe(false);
  });

  it("B3: el Dockerfile es multi-etapa, corre sin root con /data, health check y el comando del servidor", () => {
    const d = leer("Dockerfile");
    expect((d.match(/^FROM node:22-slim/gm) ?? []).length).toBe(2);
    expect(d).toMatch(/npm run build/);
    expect(d).toMatch(/npm ci --omit=dev/);
    expect(d).toMatch(/DATA_DIR=\/data/);
    expect(d).toMatch(/PORT=8080/);
    expect(d).toMatch(/NODE_ENV=production/);
    expect(d).toMatch(/HEALTHCHECK[\s\S]*\/health/);
    expect(d).toMatch(/CMD \["node", "src\/servidor\/main\.ts"\]/);
    expect(d).toMatch(/ENTRYPOINT \["\/app\/scripts\/entrada\.sh"\]/);
    const entrada = leer("scripts/entrada.sh");
    expect(entrada).toMatch(/setpriv --reuid=node/); // el proceso de la app baja a un usuario sin privilegios
    expect(leer(".dockerignore")).toMatch(/^node_modules$/m);
    for (const ignorado of [".env", ".git", "prototipo", "datos"]) expect(leer(".dockerignore")).toMatch(new RegExp(`^${ignorado.replace(".", "\\.")}$`, "m"));
  });

  it("B3: el workflow despliega solo en push a main, solo tras `verificar`, con FLY_API_TOKEN, y consulta /health por HTTPS", () => {
    const w = leer(".github/workflows/ci.yml");
    expect(w).toMatch(/^permissions:\s*\n\s+contents: read/m);
    const trabajo = w.slice(w.indexOf("\n  desplegar:"));
    expect(trabajo).toMatch(/needs: verificar/);
    expect(trabajo).toMatch(/github\.event_name == 'push'/);
    expect(trabajo).toMatch(/github\.ref == 'refs\/heads\/main'/);
    expect(trabajo).toMatch(/flyctl deploy --remote-only/);
    expect(trabajo).toMatch(/secrets\.FLY_API_TOKEN/);
    expect(trabajo).toMatch(/https:\/\/\$FLY_APP\.fly\.dev\/health/);
    expect(trabajo).toMatch(/= "ok"/);
    // Sin token: se saltea con aviso y no falla.
    expect(trabajo).toMatch(/::warning/);
    expect(trabajo).toMatch(/steps\.token\.outputs\.hay == 'true'/);
    // Misma app en el workflow y en fly.toml.
    expect(trabajo).toMatch(/FLY_APP: lean-os/);
    // El job de verificación sigue corriendo las pruebas.
    expect(w.slice(0, w.indexOf("\n  desplegar:"))).toContain("npm run verificar");
  });

  it("B3: G5 y B3 son exigibles (la lista solo se amplía)", () => {
    expect(IDS_EXIGIBLES).toContain("G5");
    expect(IDS_EXIGIBLES).toContain("B3");
  });
});

function buscarSecretos(texto: string): boolean {
  return /FlyV1 |\$argon2|PRIVATE KEY|SESSION_SECRET\s*=\s*\S/.test(texto);
}
