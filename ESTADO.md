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
- **Falta de la UI:** exportar/importar respaldo, estado de sync, cerrar sesión y PWA (fase 4). F3-b hecha (rama `tarea/F3-b`): Tareas, Metas, Apuntes, Hoy completa y papelera con los 4 tipos.
- **Próximo:** fase 3: metas, tareas, Hoy completa y apuntes (T1, T2, A1, A2; revalidar S1 con tareas).
- **F3-a hecha (rama `tarea/F3-a`):** lógica de metas, tareas y apuntes sin UI (`tareas.ts`, `apuntes.ts`), almacén con metas/tareas, purga ampliada, S1 revalidado con tareas. Exigibles suman T1, T2, A1, A2. Falta F3-b: UI de Tareas y Apuntes y papelera con tareas/metas/apuntes.
- **Para tu revisión:** hay vulnerabilidades reportadas por `npm install` en dependencias de desarrollo (sin `npm audit fix` hecho); la purga de papelera es solo local (decidir en fase 4 cómo se propaga); migraciones de IndexedDB con respaldo previo faltan cuando exista un esquema v2.
- **Despliegue / secretos:** pendientes hasta la fase 4.

- **F4-b hecha (rama `tarea/F4-b`):** sync del servidor (push idempotente con conflictos por grupo, pull paginado, borrado masivo S6), export, restauración (`npm run restaurar`), respaldo nocturno con retención de 30 y planificador. Exigibles suman S3, S4, S5, S6, G4. Falta F4-c: cliente de sync (S2, S7, estado de sync, exportar/importar en Ajustes), PWA y despliegue.

- **F4-c hecha (rama `tarea/F4-c`):** cliente de sync (`src/cliente/sync/`), login/logout, indicador de estado, "Sincronizar ahora", confirmación de borrado masivo, Exportar/Importar respaldo (formato compartido en `src/compartido/respaldo-formato.ts`). Exigibles suman S2 y S7. Falta de la fase 4: PWA instalable, despliegue en Fly.io (B3) y G5 (escaneo de secretos), si no están hechos.

- **F4-d hecha (rama `tarea/F4-d`):** PWA instalable (manifest, íconos, service worker con versión por build que nunca toca /auth, /sync, /export ni /health), servidor que sirve `dist/`, `Dockerfile` (validado con docker real) y `.dockerignore`, `fly.toml`, job de despliegue en `ci.yml`, `SECRETOS.md`, `PROBAR.md`. Exigibles suman G5 y B3. Se arregló un bug: el servidor no arrancaba con Node plano por "parameter properties" (ver DECISIONES.md).
- **Pendiente (requiere al dueño):** B3 real. Cargar FLY_API_TOKEN, APP_PASSWORD_HASH y SESSION_SECRET (SECRETOS.md), crear app y volumen en Fly, y confirmar en el primer despliegue que `https://lean-os.fly.dev/health` responde "ok", que el nombre `lean-os` no esté tomado y que el volumen retiene 60 días de snapshots. Mientras no esté el token el CI saltea el despliegue con un aviso. La instalación como PWA y el uso sin conexión se probaron por lógica y por build, no en un navegador real.

- **F5-a hecha (rama `tarea/F5-a`):** app de Windows con Electron en `escritorio/` (paquete aparte), servidor local con proxy en `src/escritorio/servidor-local.ts`, modos de prueba por variable de entorno, `escritorio/probar-exe.ts` y job `exe-windows` en `ci.yml`. `B2` exigible. Verificado aquí: pruebas de vitest (B2, S1 estático), compilación del proceso principal y los tres modos de prueba corriendo Electron en Linux con xvfb.
- **Pendiente (requiere CI de Windows):** confirmar que `electron-builder` arma `Lean-OS.exe` en `windows-latest`, que el .exe pasa salud, s1-escribir y s1-leer, y el ícono (PNG 512). No se probó empaquetado ni ejecución real en Windows.
- **Dudoso / pendiente del dueño:** el .exe no está firmado (firmar cuesta dinero); la SmartScreen de Windows puede avisar al abrirlo (ver PROBAR.md sección 8).
