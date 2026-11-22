import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["pruebas/**/*.test.ts", "src/**/*.test.ts", "servidor/**/*.test.ts"],
    environment: "node",
  },
});
