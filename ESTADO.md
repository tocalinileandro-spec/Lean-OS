# Estado

**EN CURSO** (2026-11-23, reabierto por pedido del dueño: repaso libre, P20-P22). La etapa 7 anterior sigue completa en `main`.

**COMPLETO (etapa 7)** (2026-11-23). Etapa 7 terminada: paridad funcional con el Lean OS original (`prototipo/`) y diseño profesional según `docs/maqueta/`, todo en `main` con CI verde. Para dejarlo en producción solo falta lo de siempre: cargar los secretos y desplegar (ver "Qué tenés que hacer vos" más abajo).

## Control de sesión (presupuesto de 20 h)

- **Sesión activa:** ninguna. Cerrada el 2026-11-23 04:40 UTC.
- **Esta sesión:** inicio 2026-11-23 02:24:04 UTC, cierre 04:40 UTC, unas 2,3 h.
- **Total acumulado:** 4,2 h de 20 h (1,9 h de antes + 2,3 h).
- Si otra sesión lee esto: dice COMPLETO, no hay nada que hacer.

## Etapa 7: qué quedó hecho

| Tarea | Qué entregó | IDs | PR |
| --- | --- | --- | --- |
| p-docs | Maqueta a `docs/maqueta/`, auditoría, criterios P1-P19, arreglo de la prueba B3 (Fly rechazó `scheduled_snapshots`) | (docs) | #15 |
| p-logica | Resumen de áreas, crear área/subárea, detalle, mover tema, borrar y restaurar en cascada, papelera con temas y áreas | P1, P3, P6, P7 | #16 |
| p-migracion | Lector ZIP propio + importar el respaldo del Lean OS original (ZIP real, JSON de área, bloques "aprendizaje") sin duplicar | P10, P11 | #17 |
| p-diseno-base | Tokens CSS, Inter propia, barra superior/inferior, tema Sistema/Claro/Oscuro, movimiento reducido, contraste AA | P12, P13, P14, P16 | #18 |
| p-areas-ui | Pantalla Áreas (inicio), detalle de área, mover y borrar con confirmación y Deshacer | P2 (+ UI de P3, P6, P7) | #19 |
| p-repaso-importar | Repaso con chips y etiqueta "Área › Subárea · Tema", resumen del tema, importar con revisión, caja limpia, migración en Ajustes | P4, P5, P8, P9 | #20 |
| p-rediseno | Hoy, Tareas, Apuntes, Tarjetas y Ajustes con el sistema de diseño | P15, P17 | #21 |
| p-capturas | `npm run capturas`, 18 capturas en `docs/capturas/`, medición real (`medicion.json`) | P15, P18 | #22 |
| p-cierre | Prueba de no regresión, README y PROBAR | P19 | (este) |

- **Pruebas:** `npm run verificar` da APROBADO con todos los IDs en verde (I, R, T, A, S, G, B, O y P1-P19). Ningún criterio de la sección 4 se cambió ni relajó. Un solo cambio de prueba previo: B3 (ver DECISIONES.md).
- **Ciclos:** el máximo fue el ciclo 2 en cada tarea (tope: 3, o 5 para diseño). Sin bloqueos.
- **Cómo se ve:** `docs/capturas/` (Áreas, Repaso con la respuesta visible y Detalle de área; 390, 768 y 1440 px; claro y oscuro). El revisor las miró una por una y las aprobó (DECISIONES.md, "P18: aprobación visual").
- **Migración:** en Ajustes, "Importar respaldo del Lean OS original". Nota: el "Exportar todo" del original produce un ZIP (no un JSON); la app lee ese ZIP, los JSON de área sueltos y los bloques "aprendizaje".

## Pendientes opcionales (no bloquean)

- El título derivado de un apunte sin título muestra marcas de markdown crudas (`**`, `#`), lógica previa de `tituloApunte`.
- "0 subáreas" en áreas sin subáreas podría decir "Sin subáreas".
- El medidor de 44 px no ejercita diálogos abiertos y mide Tareas y Apuntes sin datos.
- Las capturas no se regeneran solas: tras cambiar estilos, correr `npm run build && npm run capturas` y commitear.

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
