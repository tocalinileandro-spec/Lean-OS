# Decisiones

Formato: fecha, qué se eligió, por qué.

## 2026-11-22 (fase 1, F1-base)

- **Estructura simple, sin workspaces.** `src/compartido/` (esquema, reloj, lógica compartida), `src/verificacion/` (lógica pura de verificar), `pruebas/`, `servidor/` (vacío hasta la fase 4). Menos piezas; se parte en workspaces solo si hace falta.
- **Vitest como runner.** Entiende TypeScript sin configuración extra, es rápido, sirve igual para cliente y servidor, y tiene reporter JSON que verificar.ts lee para mapear cada prueba a su ID. Alternativa descartada: `node:test`, que obliga a cargar TypeScript aparte y tiene un reporte menos cómodo.
- **verificar.ts se ejecuta con `node verificar.ts`** (Node >= 22.18 saca los tipos solo): no hace falta `tsx` ni compilar. Por eso los imports relativos llevan extensión `.ts`. El CI usa Node 22.
- **Dependencias (solo desarrollo):** `vitest` (runner), `typescript` (chequeo de tipos con `npm run tipos`) y `@types/node` (tipos de Node). Ninguna en producción.
- **Convención de IDs:** el nombre de cada prueba empieza con su ID (`I1: ...`). verificar.ts toma el ID de ese prefijo.
- **Lista exigible por fase** en `fase-actual.ts` (`IDS_EXIGIBLES`), separada de `TODOS_LOS_IDS`. Los IDs no exigibles sin pruebas salen en REPORTE.md como "pendiente (fase N)" sin hacer fallar; si tienen una prueba en rojo, igual falla. La lista solo se amplía al empezar cada fase (al cerrar la fase 1: B1; fase 2: I1-I7, R1-R9, S1; fase 3: T1, T2, A1, A2; fase 4: S2-S7, G1-G5, B3; B2 con la fase 5). **Nunca se reduce ni se mueve un ID a pendiente para hacer pasar algo.** Una prueba B1 verifica que B1 siga en la lista.
- **Falla también** cualquier prueba en rojo sin ID, o si vitest termina con error o no produce resultados.
- **REPORTE.md va en .gitignore:** se regenera en cada corrida y versionarlo genera conflictos sin aportar. El CI lo genera de nuevo.
- **.gitignore:** se mantuvieron las reglas de datos del prototipo (`datos/`, `papelera/`, `respaldos/`) y las de Python; se agregó `.env` (con excepción de `.env.example`), `node_modules/`, `dist/`.
- **Esquema (`src/compartido/esquema.ts`):** `rev` es `number | null` (null hasta que el servidor lo asigna). Los repasos también llevan `deleted_at` por uniformidad (siempre null, solo se agregan). Tarjeta lleva `contenido_updated_at` y `repaso_updated_at` además de `updated_at`. Las fechas locales son AAAA-MM-DD y los instantes ISO en UTC. Las áreas se modelan con `padre_id` (Área > Subárea).
- **Reloj:** interfaz `Reloj` con `ahora(): Date`; `RelojReal` y `RelojSimulado` (fijar/avanzar). El cambio de día a las 04:00 de Buenos Aires se implementará en la fase 2 sobre esta interfaz.
- **CI en `ci/ci.yml`:** checkout, setup-node 22, `npm ci`, `npm run verificar`; sin despliegue. El dueño lo copia a `.github/workflows/`.
