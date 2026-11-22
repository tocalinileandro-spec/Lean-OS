# Estado

- **Fase actual:** 2 (Tarjetas en local), en curso.
- **Hecho:** prototipo movido a `prototipo/`; package.json, tsconfig estricto, vitest; esquema de datos (tipos); reloj real y simulado; `npm run verificar` con REPORTE.md; CI escrito en `ci/ci.yml`; DECISIONES.md y BLOQUEOS.md.
- **F2-a hecha (rama actual, sin fusionar):** almacén (interfaz + memoria), normalización, parseo/validación, importar, deshacer, `diaLogico`. Exigibles hoy: B1, I1-I7 (ver `fase-actual.ts`). El resto figura como pendiente en REPORTE.md.
- **F2-b hecha (misma rama, sin fusionar):** `repaso.ts` (calificar, guardar, deshacer, cola del día, sesión). Exigibles suman R1-R8. R9 (UI) y S1 siguen pendientes.
- **F2-c hecha (misma rama, sin fusionar):** `AlmacenIndexedDB` (`src/cliente/`), `guardarLote` transaccional, papelera/gestión (`gestion.ts`), estadísticas mínimas, S1 (navegador, simulado con fake-indexeddb). Exigibles suman S1. **S1 se revalida con tareas en la fase 3.**
- **Pendiente del dueño:** copiar `ci/ci.yml` a `.github/workflows/ci.yml`; activar CODEOWNERS (verificar.ts, `.github/workflows`, `docs/VISION.md`) y la protección de `main`.
- **Próximo:** UI de repaso (R9) y pantallas de gestión/papelera/estadísticas; con eso cierra la fase 2.
- **Despliegue / secretos:** pendientes hasta la fase 4.
