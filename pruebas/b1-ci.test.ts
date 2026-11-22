import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IDS_EXIGIBLES } from "../fase-actual.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("B1 integración continua", () => {
  it("B1: existe .github/workflows/ci.yml y corre `npm run verificar` (sin eso no hay despliegue)", () => {
    const ruta = join(raiz, ".github", "workflows", "ci.yml");
    expect(existsSync(ruta)).toBe(true);
    const texto = readFileSync(ruta, "utf8");
    expect(texto).toContain("npm ci");
    expect(texto).toContain("npm run verificar");
  });

  it("B1: B1 sigue siendo exigible (la lista exigible nunca se reduce)", () => {
    expect(IDS_EXIGIBLES).toContain("B1");
  });
});
