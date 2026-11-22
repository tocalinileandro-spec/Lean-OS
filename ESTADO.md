# Estado

## Control de sesión (presupuesto de 20 h)

- **Sesión activa:** desde 2026-11-22 21:54:43 UTC (marca de actividad: 2026-11-22 21:54:43 UTC). Si otra sesión ve esto con menos de 3 h de antigüedad, no hace nada.
- **Horas acumuladas de sesiones anteriores:** 0 h. Total consumido al cerrar cada sesión = anterior + (hora de cierre − hora de inicio).
- **Estado de `main`:** fases 1 y 2 fusionadas (PR #1).
- **Próximo paso exacto:** reglas nuevas (PR `tarea/meta-reglas`), luego fase 3.

- **Fase actual:** fases 1 y 2 CERRADAS (2026-11-22). Próxima: fase 3 (Tareas y apuntes).
- **Cierre de fase 2:** `npm run verificar` APROBADO con B1, I1-I7, R1-R9 y S1 en verde; revisión aprobada en cada tarea (F2-b y F2-c en el ciclo 2, F2-d en el ciclo 3; ningún tope superado). Fusionado a `main` (PR #1).
- **Hecho:** prototipo movido a `prototipo/`; package.json, tsconfig estricto, vitest; esquema de datos (tipos); reloj real y simulado; `npm run verificar` con REPORTE.md; CI en `.github/workflows/ci.yml`; DECISIONES.md y BLOQUEOS.md.
- **F2-a hecha:** almacén (interfaz + memoria), normalización, parseo/validación, importar, deshacer, `diaLogico`. Exigibles hoy: B1, I1-I7 (ver `fase-actual.ts`). El resto figura como pendiente en REPORTE.md.
- **F2-b hecha:** `repaso.ts` (calificar, guardar, deshacer, cola del día, sesión). Exigibles suman R1-R8. R9 (UI) y S1 siguen pendientes.
- **F2-c hecha:** `AlmacenIndexedDB` (`src/cliente/`), `guardarLote` transaccional, papelera/gestión (`gestion.ts`), estadísticas mínimas, S1 (navegador, simulado con fake-indexeddb). Exigibles suman S1. **S1 se revalida con tareas en la fase 3.**
- **F2-d hecha:** interfaz web del módulo 1 (`src/cliente/ui/`, `main.ts`, `index.html`, `estilos.css`), `npm run build` con esbuild, R9 exigible. Con esto la fase 2 tiene R9 y S1 en navegador; verificada a mano con Playwright (importar el ejemplo, repasar, recargar).
- **Correr la app local:** `npm run build` y abrir `dist/index.html` en el navegador (los datos quedan en IndexedDB del navegador). Pantallas: Hoy, Repaso, Tarjetas (importar, papelera, editar/mover/suspender/borrar), Ajustes (nuevas por día, hora de cambio).
- **Falta de la UI:** Tareas y Apuntes (fase 3); exportar/importar respaldo, estado de sync, cerrar sesión y PWA (fase 4). La papelera solo lista tarjetas.
- **Próximo:** fase 3: metas, tareas, Hoy completa y apuntes (T1, T2, A1, A2; revalidar S1 con tareas).
- **F3-a hecha (rama `tarea/F3-a`):** lógica de metas, tareas y apuntes sin UI (`tareas.ts`, `apuntes.ts`), almacén con metas/tareas, purga ampliada, S1 revalidado con tareas. Exigibles suman T1, T2, A1, A2. Falta F3-b: UI de Tareas y Apuntes y papelera con tareas/metas/apuntes.
- **Para tu revisión:** hay vulnerabilidades reportadas por `npm install` en dependencias de desarrollo (sin `npm audit fix` hecho); la purga de papelera es solo local (decidir en fase 4 cómo se propaga); migraciones de IndexedDB con respaldo previo faltan cuando exista un esquema v2.
- **Despliegue / secretos:** pendientes hasta la fase 4.
