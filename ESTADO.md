# Estado

- **Fase actual:** 2 (Tarjetas en local), en curso.
- **Hecho:** prototipo movido a `prototipo/`; package.json, tsconfig estricto, vitest; esquema de datos (tipos); reloj real y simulado; `npm run verificar` con REPORTE.md; CI escrito en `ci/ci.yml`; DECISIONES.md y BLOQUEOS.md.
- **F2-a hecha (rama actual, sin fusionar):** almacén (interfaz + memoria), normalización, parseo/validación, importar, deshacer, `diaLogico`. Exigibles hoy: B1, I1-I7 (ver `fase-actual.ts`). El resto figura como pendiente en REPORTE.md.
- **F2-b hecha (misma rama, sin fusionar):** `repaso.ts` (calificar, guardar, deshacer, cola del día, sesión). Exigibles suman R1-R8. R9 (UI) y S1 siguen pendientes.
- **F2-c hecha (misma rama, sin fusionar):** `AlmacenIndexedDB` (`src/cliente/`), `guardarLote` transaccional, papelera/gestión (`gestion.ts`), estadísticas mínimas, S1 (navegador, simulado con fake-indexeddb). Exigibles suman S1. **S1 se revalida con tareas en la fase 3.**
- **F2-d hecha (misma rama, sin fusionar):** interfaz web del módulo 1 (`src/cliente/ui/`, `main.ts`, `index.html`, `estilos.css`), `npm run build` con esbuild, R9 exigible. Con esto la fase 2 tiene R9 y S1 en navegador; verificada a mano con Playwright (importar el ejemplo, repasar, recargar).
- **Correr la app local:** `npm run build` y abrir `dist/index.html` en el navegador (los datos quedan en IndexedDB del navegador). Pantallas: Hoy, Repaso, Tarjetas (importar, papelera, editar/mover/suspender/borrar), Ajustes (nuevas por día, hora de cambio).
- **Falta de la UI:** Tareas y Apuntes (fase 3); exportar/importar respaldo, estado de sync, cerrar sesión y PWA (fase 4). La papelera solo lista tarjetas.
- **Pendiente del dueño:** copiar `ci/ci.yml` a `.github/workflows/ci.yml`; activar CODEOWNERS (verificar.ts, `.github/workflows`, `docs/VISION.md`) y la protección de `main`.
- **Próximo:** cierre de la fase 2 (revisión) y fase 3: metas, tareas, Hoy completa y apuntes.
- **Despliegue / secretos:** pendientes hasta la fase 4.
