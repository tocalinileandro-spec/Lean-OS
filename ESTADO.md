# Estado

- **Fase actual:** 2 (Tarjetas en local), en curso.
- **Hecho:** prototipo movido a `prototipo/`; package.json, tsconfig estricto, vitest; esquema de datos (tipos); reloj real y simulado; `npm run verificar` con REPORTE.md; CI escrito en `ci/ci.yml`; DECISIONES.md y BLOQUEOS.md.
- **F2-a hecha (rama actual, sin fusionar):** almacén (interfaz + memoria), normalización, parseo/validación, importar, deshacer, `diaLogico`. Exigibles hoy: B1, I1-I7 (ver `fase-actual.ts`). El resto figura como pendiente en REPORTE.md.
- **Pendiente del dueño:** copiar `ci/ci.yml` a `.github/workflows/ci.yml`; activar CODEOWNERS (verificar.ts, `.github/workflows`, `docs/VISION.md`) y la protección de `main`.
- **Próximo:** IndexedDB del almacén, luego repaso (R1-R9), estadísticas, papelera y S1.
- **Despliegue / secretos:** pendientes hasta la fase 4.
