# Estado

**COMPLETO** (2026-11-22). Todo el alcance pedido está terminado y fusionado en `main` con CI verde. Lo único que falta lo hacés vos: cargar los secretos y desplegar (ver "Qué tenés que hacer vos").

## Control de sesión (presupuesto de 20 h)

- **Sesión activa:** ninguna. Cerrada el 2026-11-22 23:52 UTC.
- **Horas trabajadas en esta sesión:** inicio 2026-11-22 21:54:43 UTC, cierre 23:52 UTC, unas 1,9 h.
- **Total acumulado:** 1,9 h de 20 h.
- Si otra sesión lee esto: dice COMPLETO, no hay nada que hacer.

## Qué quedó hecho (todo en `main`)

- **Fases 1 y 2:** base TypeScript, esquema, reloj simulado, `npm run verificar`, importación de tarjetas, repaso espaciado, papelera, copia local en IndexedDB y la interfaz del módulo 1.
- **Fase 3:** metas anual y trimestral, tareas, Hoy completa con tarea rápida, bandeja, apuntes con captura rápida, búsqueda y conversiones, y papelera con los cuatro tipos.
- **Fase 4:** servidor Node + Hono + SQLite (`node:sqlite`), login con argon2id, sesiones de 30 días, límite de intentos, redirección a HTTPS, sincronización (push/pull idempotente, conflictos por grupo, rechazo de borrado masivo), exportación, restauración, respaldo nocturno con retención de 30, cliente de sincronización, cuenta y respaldo manual en Ajustes, PWA instalable, Dockerfile, `fly.toml` y el despliegue preparado en el CI.
- **Fase 5:** app de Windows (`Lean-OS.exe`, Electron portable) que el CI compila en un runner de Windows, arranca y prueba (B2 y S1 dentro del .exe); queda como artefacto del CI por 30 días.
- **Opcionales (criterios O1-O24 agregados antes a la sección 4 y claves a la sección 7):** respaldo externo cifrado a Backblaze B2 (O1-O6), entrada por audio con Groq (O7-O12), tareas recurrentes (O13-O19) y gráficos de estadísticas (O20-O24). El respaldo externo y el audio vienen desactivados y la app funciona completa sin ellos.
- **Pruebas:** en un clon limpio de `main`, `npm run tipos`, `npm run build` y `npm run verificar` pasan (277 pruebas); todos los IDs de la sección 4 (I, R, T, A, S, G, B1-B3 y O1-O24) en verde. El CI de `main` (verificar y exe-windows) está verde. `npm audit --omit=dev`: 0 vulnerabilidades.
- **Guías:** `SECRETOS.md` (pasos exactos para cada secreto), `PROBAR.md` (correr en Windows con `cmd`), `README.md`.

## Qué tenés que hacer vos

1. Seguí `SECRETOS.md` de arriba abajo: crear la app y el volumen en Fly, cargar `FLY_API_TOKEN` en GitHub (Settings > Secrets > Actions) y `APP_PASSWORD_HASH` + `SESSION_SECRET` en Fly. Con eso, el próximo push a `main` despliega solo y consulta `/health`.
2. **B3 (despliegue real) sigue pendiente de ese token:** hasta que lo cargues, el paso de despliegue del CI se saltea con un aviso. La prueba B3 del repo verifica solo la configuración; que `https://<app>.fly.dev/health` responda "ok" se confirma recién después del primer despliegue.
3. Opcionales (cuando quieras): `SECRETOS.md` secciones 4 (Backblaze B2 + `RESPALDO_CLAVE`, guardá esa clave aparte) y 5 (Groq), y activarlos en Ajustes.

## Lo dudoso o sin poder probar (para tu revisión)

- **Claves de snapshot de Fly** (`scheduled_snapshots`, `snapshot_retention = 60` en `fly.toml`): escritas de memoria, sin acceso a la documentación. Si Fly las rechaza, el primer despliegue falla de forma visible (sin perder datos): corregí o quitá esas dos líneas. `SECRETOS.md` explica cómo verificar la retención real con `fly volumes show`.
- **Nombre `lean-os` en Fly:** puede estar tomado; si lo está, cambialo en `fly.toml` y en el job de despliegue (los pasos están en `SECRETOS.md`).
- **`DestinoB2` y `ProveedorGroq`:** escritos de memoria contra las APIs de Backblaze B2 y Groq, sin probarlos contra los servicios reales (aquí no hay claves ni acceso). Están aislados en `src/servidor/destino-b2.ts` y `src/servidor/audio.ts`; las pruebas usan servicios simulados. Probalos a mano al activarlos: "Respaldar ahora" en Ajustes y grabar un audio corto. Que Backblaze permita abrir la cuenta gratis sin tarjeta tampoco lo pude confirmar. La cuota gratuita de Groq tiene tope diario.
- **Navegador real:** la instalación como PWA, el uso sin conexión con el service worker y la grabación con micrófono se probaron solo con simuladores y la lógica; no en Chrome/Edge reales.
- **`.exe` sin firmar:** Windows SmartScreen puede avisar al abrirlo (firmarlo cuesta dinero; no se hizo). Funciona; en CI se compiló y se probó en Windows real.
- **Servidor restaurado con un `rev` mayor que el del cliente:** el cliente no lo detecta por sí solo (no pierde nada; resube lo que edite). Con un `rev` menor sí sube todo.
- **Registro de conflictos (`registro_sync`):** se guarda siempre al perdedor, así que puede acumular filas repetidas si un cliente reenvía una versión vieja de un grupo; no pierde ni duplica datos.
- **Purga de papelera:** es solo local; el servidor conserva lo borrado. Si vuelve en una resincronización completa, llega como borrado y se vuelve a purgar.
- **Varias pestañas:** el candado entre sincronización y ediciones protege dentro de una pestaña; entre dos pestañas abiertas del mismo navegador no hay exclusión.
- **Una sola máquina en Fly** (SQLite no se comparte): la máquina queda siempre encendida para que el respaldo de las 03:00 corra; ver costo en tu panel de Fly.
- **`node:sqlite`:** Node lo marca experimental y imprime un aviso al arrancar; funciona en Node 22 (el Dockerfile usa esa versión).
- **Acción de CI `setup-flyctl@master`:** Fly solo documenta `@master` para esa acción; no está fijada a una versión.
- **Dependencias de desarrollo:** `npm install` informa vulnerabilidades en paquetes de desarrollo (sin `npm audit fix`); no entran en la imagen de producción.
- **Migraciones de IndexedDB:** todavía no existe un esquema v2 del cliente, así que el respaldo previo a una migración de IndexedDB no hizo falta; el servidor sí respalda antes de migrar.

## Registro técnico

- Decisiones: `DECISIONES.md` (fecha, qué se eligió y por qué). Bloqueos: ninguno (`BLOQUEOS.md`). Ningún tope de 3 ciclos programador-revisor se superó (el máximo fue el ciclo 2).
- Pull requests fusionados en esta etapa: #2 al #13 (el #1 ya estaba fusionado al empezar).
