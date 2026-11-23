# Estado

**EN CURSO** (reabierto el 2026-11-23 por pedido del dueño). Etapa 7: paridad funcional con el Lean OS original (`prototipo/`) + diseño profesional según `docs/maqueta/`. Lo anterior (fases 1 a 5 y opcionales) sigue completo y en `main`.

## Control de sesión (presupuesto de 20 h)

- **Sesión activa:** desde 2026-11-23 02:24 UTC (Director). Marca de actividad: 2026-11-23 02:24 UTC.
- **Total acumulado antes de esta sesión:** 1,9 h de 20 h.
- **Inicio de esta sesión:** 2026-11-23 02:24:04 UTC. Al cerrar se suma lo trabajado.

## Etapa 7: plan y avance

Criterios nuevos: prefijo P en la sección 4 de `docs/VISION.md`. Auditoría y decisiones: `DECISIONES.md` ("Auditoría prototipo vs app nueva").

| Tarea | Qué entrega | IDs | Estado |
| --- | --- | --- | --- |
| p-docs | Maqueta a `docs/maqueta`, auditoría, criterios P, ESTADO | (docs) | en curso |
| p-logica | Lógica pura: resumen de áreas, temas, mover, borrar/restaurar en cascada, crear área/subárea | P1, P3, P6, P7 | pendiente |
| p-migracion | Leer el respaldo del Lean OS original (ZIP y JSON), sin duplicar | P10, P11 | pendiente |
| p-diseno-base | Tokens CSS, Inter local, barra superior/inferior, tema oscuro opcional, movimiento reducido | P12-P17 | pendiente |
| p-pantallas | Áreas (inicio), detalle de área, repaso con chips y etiqueta, importar con revisión, Ajustes | P2, P4, P5, P8, P9 | pendiente |
| p-rediseno | Hoy, Tareas, Apuntes, Tarjetas y Ajustes con el sistema de diseño | P12-P17 | pendiente |
| p-capturas | `npm run capturas`, capturas en `docs/capturas/`, revisión visual | P18 | pendiente |
| p-cierre | Todo verde, ESTADO, listo para desplegar | P19 | pendiente |

Próximo paso exacto: terminar `p-docs` (PR, CI verde, fusionar) y lanzar `p-logica`.

# Historial hasta el cierre anterior (2026-11-22)

## Qué quedó hecho (todo en `main`)

- **Fases 1 y 2:** base TypeScript, esquema, reloj simulado, `npm run verificar`, importación de tarjetas, repaso espaciado, papelera, copia local en IndexedDB y la interfaz del módulo 1.
- **Fase 3:** metas anual y trimestral, tareas, Hoy completa con tarea rápida, bandeja, apuntes con captura rápida, búsqueda y conversiones, y papelera con los cuatro tipos.
- **Fase 4:** servidor Node + Hono + SQLite (`node:sqlite`), login con argon2id, sesiones de 30 días, límite de intentos, redirección a HTTPS, sincronización (push/pull idempotente, conflictos por grupo, rechazo de borrado masivo), exportación, restauración, respaldo nocturno con retención de 30, cliente de sincronización, cuenta y respaldo manual en Ajustes, PWA instalable, Dockerfile, `fly.toml` y el despliegue preparado en el CI.
- **Fase 5:** app de Windows (`Lean-OS.exe`, Electron portable) que el CI compila en un runner de Windows, arranca y prueba (B2 y S1 dentro del .exe); queda como artefacto del CI por 30 días.
- **Opcionales (criterios O1-O24 agregados antes a la sección 4 y claves a la sección 7):** respaldo externo cifrado a Backblaze B2 (O1-O6), entrada por audio con Groq (O7-O12), tareas recurrentes (O13-O19) y gráficos de estadísticas (O20-O24). El respaldo externo y el audio vienen desactivados y la app funciona completa sin ellos.
- **Pruebas:** en un clon limpio de `main`, `npm run tipos`, `npm run build` y `npm run verificar` pasan (277 pruebas); todos los IDs de la sección 4 (I, R, T, A, S, G, B1-B3 y O1-O24) en verde. El CI de `main` (verificar, exe-windows y desplegar, que se saltea sin token) está verde. `npm audit --omit=dev`: 0 vulnerabilidades.
- **Guías:** `SECRETOS.md` (pasos exactos para cada secreto), `PROBAR.md` (correr en Windows con `cmd`), `README.md`.

## Qué tenés que hacer vos

1. Seguí `SECRETOS.md` de arriba abajo: crear la app y el volumen en Fly, cargar `FLY_API_TOKEN` en GitHub (Settings > Secrets > Actions) y `APP_PASSWORD_HASH` + `SESSION_SECRET` en Fly. Con eso, el próximo push a `main` despliega solo y consulta `/health`.
2. **B3 (despliegue real) sigue pendiente de ese token:** hasta que lo cargues, el paso de despliegue del CI se saltea con un aviso. La prueba B3 del repo verifica solo la configuración; que `https://<app>.fly.dev/health` responda "ok" se confirma recién después del primer despliegue.
3. Opcionales (cuando quieras): `SECRETOS.md` secciones 4 (Backblaze B2 + `RESPALDO_CLAVE`, guardá esa clave aparte) y 5 (Groq), y activarlos en Ajustes.

## Lo dudoso o sin poder probar (para tu revisión)

- **Claves de snapshot de Fly:** Fly rechazó `scheduled_snapshots` y el dueño la quitó a mano de `fly.toml` (commit 699ae7a); queda `snapshot_retention = 60` en el volumen. La prueba B3 ya no exige `scheduled_snapshots` (ver DECISIONES.md 2026-11-23). `SECRETOS.md` explica cómo verificar la retención real con `fly volumes show`.
- **Nombre `lean-os` en Fly:** puede estar tomado; si lo está, cambialo en `fly.toml` y en el job de despliegue (los pasos están en `SECRETOS.md`).
- **`DestinoB2` y `ProveedorGroq`:** escritos de memoria contra las APIs de Backblaze B2 y Groq, sin probarlos contra los servicios reales (aquí no hay claves ni acceso). Están aislados en `src/servidor/destino-b2.ts` y `src/servidor/audio.ts`; las pruebas usan servicios simulados. Probalos a mano al activarlos: "Respaldar ahora" en Ajustes y grabar un audio corto. Que Backblaze permita abrir la cuenta gratis sin tarjeta tampoco lo pude confirmar. La cuota gratuita de Groq tiene tope diario.
- **Navegador real:** la instalación como PWA, el uso sin conexión con el service worker y la grabación con micrófono se probaron solo con simuladores y la lógica; no en Chrome/Edge reales.
- **`.exe` sin firmar:** Windows SmartScreen puede avisar al abrirlo (firmarlo cuesta dinero; no se hizo). Funciona; en CI se compiló y se probó en Windows real.
- **Servidor restaurado con un `rev` mayor que el del cliente:** el cliente no lo detecta por sí solo (no pierde nada; resube lo que edite). Con un `rev` menor sí sube todo.
- **Registro de conflictos (`registro_sync`):** se guarda siempre al perdedor, así que puede acumular filas repetidas si un cliente reenvía una versión vieja de un grupo; no pierde ni duplica datos.
- **Purga de papelera:** corre al abrir la app y como mucho una vez por día lógico (solo elimina lo borrado hace 30 días o más; los repasos nunca se purgan) y es solo local: el servidor conserva lo borrado. Si en una resincronización completa vuelve un registro ya purgado, llega como borrado y se vuelve a purgar al día siguiente.
- **Borrado sin sincronizar por 30 días:** si un borrado hecho sin conexión lleva 30 días o más sin subirse, la purga local lo elimina sin que el servidor lo haya recibido y un pull posterior podría traerlo de vuelta como vivo. Es muy raro y no pierde datos (el registro sigue vivo en el servidor).
- **Retención en Backblaze B2:** `DestinoB2.borrar` elimina solo la versión más reciente de cada nombre; si el bucket guarda versiones ocultas (por ejemplo, por subir dos veces el mismo día), pueden quedar versiones viejas ocupando espacio y la retención de 30 no sería exacta. Conviene configurar en el bucket una regla de ciclo de vida que borre versiones viejas.
- **Tareas recurrentes:** la siguiente ocurrencia nace al marcar hecha la actual; si se borra la única ocurrencia pendiente de una serie, la serie no genera más hasta restaurarla. Los tipos de regla son diaria, semanal y mensual (anual y "cada N días" no se hicieron).
- **Varias pestañas:** el candado entre sincronización y ediciones protege dentro de una pestaña; entre dos pestañas abiertas del mismo navegador no hay exclusión.
- **Una sola máquina en Fly** (SQLite no se comparte): la máquina queda siempre encendida para que el respaldo de las 03:00 corra; ver costo en tu panel de Fly.
- **`node:sqlite`:** Node lo marca experimental y imprime un aviso al arrancar; funciona en Node 22 (el Dockerfile usa esa versión).
- **Acción de CI `setup-flyctl@master`:** Fly solo documenta `@master` para esa acción; no está fijada a una versión.
- **Dependencias de desarrollo:** `npm install` informa vulnerabilidades en paquetes de desarrollo (sin `npm audit fix`); no entran en la imagen de producción.
- **Migraciones de IndexedDB:** todavía no existe un esquema v2 del cliente, así que el respaldo previo a una migración de IndexedDB no hizo falta; el servidor sí respalda antes de migrar.

## Registro técnico

- Decisiones: `DECISIONES.md` (fecha, qué se eligió y por qué). Bloqueos: ninguno (`BLOQUEOS.md`). Ningún tope de 3 ciclos programador-revisor se superó (el máximo fue el ciclo 2).
- Pull requests fusionados en esta etapa: #2 al #13 (el #1 ya estaba fusionado al empezar).
